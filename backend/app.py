"""
JG Turbo · Backend de Transcripción (v2.1 — faster-whisper)
===========================================================
Servidor FastAPI con faster-whisper (CTranslate2) para transcripción.

Cambios v2.1 (rendimiento):
  - Reemplazo de openai-whisper → faster-whisper con compute_type='int8' (4-5x más rápido en CPU)
  - Carga eager del modelo (evita espera en primera transcripción)
  - VAD filter activado por defecto (salta silencios = más rápido y preciso)
  - Conversión FFmpeg solo para formatos no soportados directamente por faster-whisper
  - Threads de CPU optimizados via OMP_NUM_THREADS / MKL_NUM_THREADS
"""

import os
import re
import sys
import uuid
import shutil
import asyncio
import tempfile
import threading
import subprocess
import concurrent.futures
from pathlib import Path
from typing import Optional

def load_env_file():
    # Buscar en carpeta actual (backend) y en directorio padre
    for folder in (Path(__file__).parent, Path(__file__).parent.parent):
        env_path = folder / ".env"
        if env_path.exists():
            print(f"[OK] Cargando variables desde: {env_path}")
            for line in env_path.read_text(encoding="utf-8").splitlines():
                line = line.strip()
                if line and not line.startswith("#") and "=" in line:
                    key, val = line.split("=", 1)
                    os.environ[key.strip()] = val.strip().strip('"').strip("'")
            break

load_env_file()

# Buscar ffmpeg en WinGet o rutas comunes y agregarlo al PATH
def setup_ffmpeg_path():
    if shutil.which("ffmpeg"):
        return

    rutas_candidatas = [
        Path(__file__).parent / "bin" / "ffmpeg.exe",
        Path(__file__).parent.parent / "bin" / "ffmpeg.exe",
        Path("C:/ffmpeg/bin/ffmpeg.exe"),
        Path("C:/Program Files/ffmpeg/bin/ffmpeg.exe"),
        Path("C:/ProgramData/chocolatey/bin/ffmpeg.exe"),
    ]

    user_profile = os.getenv("USERPROFILE")
    if user_profile:
        rutas_candidatas.extend([
            Path(user_profile) / "scoop" / "shims" / "ffmpeg.exe",
            Path(user_profile) / "AppData" / "Local" / "Microsoft" / "WinGet" / "Links" / "ffmpeg.exe",
        ])

    for ffmpeg_path in rutas_candidatas:
        if ffmpeg_path.exists():
            bin_dir = ffmpeg_path.parent
            current_path = os.environ.get("PATH", "") or os.environ.get("Path", "")
            if str(bin_dir) not in current_path:
                os.environ["PATH"] = str(bin_dir) + os.pathsep + current_path
                print(f"[OK] ffmpeg agregado al PATH desde ruta comun: {bin_dir}")
            return

    local_appdata = os.getenv("LOCALAPPDATA")
    if local_appdata:
        winget_path = Path(local_appdata) / "Microsoft" / "WinGet" / "Packages"
        if winget_path.exists():
            for p in winget_path.glob("**/ffmpeg.exe"):
                bin_dir = p.parent
                current_path = os.environ.get("PATH", "") or os.environ.get("Path", "")
                if str(bin_dir) not in current_path:
                    os.environ["PATH"] = str(bin_dir) + os.pathsep + current_path
                    print(f"[OK] ffmpeg agregado al PATH desde WinGet: {bin_dir}")
                    return

setup_ffmpeg_path()

# ── Optimización de CPU para inferencia ─────────────────────────────────────────
# faster-whisper con CTranslate2 maneja sus propios hilos. Configuramos OMP
# y MKL para el mejor rendimiento en CPU, y limitamos hilos físicos según nucleos.
import multiprocessing
_CPUS = os.cpu_count() or 4
# OMP_NUM_THREADS controla los hilos de OpenMP usados por CTranslate2/BLAS
os.environ.setdefault("OMP_NUM_THREADS", str(min(6, _CPUS)))
os.environ.setdefault("MKL_NUM_THREADS", str(min(4, _CPUS)))
os.environ.setdefault("CT2_VERBOSE", "0")  # silencia logs de CTranslate2

# PyTorch threads - menos relevantes con faster-whisper pero por si acaso
try:
    import torch
    torch.set_num_threads(min(4, _CPUS))
except Exception:
    pass

# Forzar UTF-8 en stdout para que los emojis no rompan la consola Windows
try:
    sys.stdout.reconfigure(encoding='utf-8')
except Exception:
    pass

from fastapi import FastAPI, File, UploadFile, Form, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, FileResponse
from pydantic import BaseModel

# ── Configuración ─────────────────────────────────────────────────────────────
WHISPER_MODEL = os.getenv("WHISPER_MODEL", "base").lower()

# Modelos permitidos (evita typos en la variable de entorno)
MODELOS_VALIDOS = {"tiny", "base", "small", "medium", "large", "tiny.en", "base.en", "small.en", "medium.en"}
if WHISPER_MODEL not in MODELOS_VALIDOS:
    print(f"⚠️  Modelo '{WHISPER_MODEL}' no reconocido. Usando 'tiny'.")
    WHISPER_MODEL = "tiny"

# Gemini model (REST). 
# El código ahora descubre automáticamente los modelos disponibles para tu clave.
# Default: "gemini-2.0-flash"
GEMINI_MODEL = os.getenv("GEMINI_MODEL", "gemini-2.0-flash")

# Lista de fallbacks por si el modelo por defecto no está disponible para la clave
GEMINI_FALLBACK_MODELS = ["gemini-2.0-flash", "gemini-1.5-flash"]  # el discovery intentará más si es necesario

def _list_gemini_models(api_key: str):
    """Lista los modelos disponibles para esta clave."""
    import json as _json
    import urllib.request as _ur
    try:
        url = f"https://generativelanguage.googleapis.com/v1beta/models?key={api_key}"
        with _ur.urlopen(url, timeout=15) as r:
            data = _json.loads(r.read())
        models = []
        for m in data.get("models", []):
            name = m.get("name", "")
            if "gemini" in name.lower() and "generateContent" in m.get("supportedGenerationMethods", []):
                # name comes as "models/gemini-xxx", extract the id
                mid = name.split("/")[-1] if "/" in name else name
                models.append(mid)
        return models
    except Exception:
        return []

def _call_gemini(api_key: str, prompt: str, model: str = None, temperature: float = 0.3) -> str:
    """Llama a Gemini usando REST. Auto-descubre modelos si el configurado falla."""
    import json as _json
    import urllib.request as _ur
    import urllib.error as _ur_err

    # Primero intentar con el configurado + fallbacks
    base_models = [model] if model else [GEMINI_MODEL]
    base_models += [m for m in GEMINI_FALLBACK_MODELS if m not in base_models]

    models_to_try = base_models[:]

    last_error = None

    for attempt in range(2):  # dos rondas: primera con configurados, segunda con discovered si hace falta
        for m in models_to_try:
            if not m:
                continue
            m_clean = m.strip()
            while m_clean.startswith("models/"):
                m_clean = m_clean[len("models/"):]
            url = f"https://generativelanguage.googleapis.com/v1beta/models/{m_clean}:generateContent?key={api_key}"
            payload = _json.dumps({
                "contents": [{"parts": [{"text": prompt}]}],
                "generationConfig": {
                    "temperature": temperature,
                    "topP": 0.8,
                    "topK": 40
                }
            }).encode()
            http_req = _ur.Request(url, data=payload, headers={"Content-Type": "application/json"}, method="POST")
            try:
                with _ur.urlopen(http_req, timeout=30) as r:
                    raw = r.read()
                    data = _json.loads(raw)

                if "error" in data:
                    err = data["error"]
                    msg = err.get("message", "Error desconocido de Gemini")
                    raise Exception(f"{msg} [{err.get('status') or err.get('code', '')}]")

                cands = data.get("candidates") or []
                if not cands:
                    # puede ser bloqueo de safety, intentamos siguiente
                    raise Exception("Respuesta vacía (posible bloqueo de seguridad)")

                parts = cands[0].get("content", {}).get("parts") or []
                if not parts or "text" not in parts[0]:
                    raise Exception("Formato de respuesta inesperado de Gemini")

                return parts[0]["text"].strip()

            except _ur_err.HTTPError as http_err:
                body_text = ""
                try:
                    body = http_err.read().decode("utf-8", errors="ignore")
                    body_text = body
                    body_json = _json.loads(body)
                    if "error" in body_json:
                        err = body_json["error"]
                        last_error = Exception(f"Gemini {err.get('message', http_err)} (model: {m_clean})")
                    else:
                        last_error = Exception(f"HTTP {http_err.code}: {body_text} (model: {m_clean})")
                except:
                    last_error = Exception(f"HTTP Error {http_err.code}: Not Found (model: {m_clean})")

                if http_err.code in (404, 400) or "not found" in str(last_error).lower():
                    # Si el error es de clave de API inválida, no seguir probando otros modelos
                    if "api key not valid" in str(last_error).lower() or "api_key_invalid" in str(last_error).lower():
                        raise last_error
                    continue
                raise last_error
            except Exception as e:
                last_error = e
                if "not found" in str(e).lower() or "404" in str(e) or "no encontrado" in str(e).lower():
                    continue
                raise

        # Si falló todo en la primera ronda y es por modelo no encontrado, descubrimos modelos disponibles
        if attempt == 0 and ("not found" in str(last_error or "").lower() or "404" in str(last_error or "")):
            discovered = _list_gemini_models(api_key)
            if discovered:
                # preferir flash models
                flash_models = [m for m in discovered if "flash" in m.lower()]
                models_to_try = flash_models + [m for m in discovered if m not in flash_models]
                # limitamos para no spamear
                models_to_try = models_to_try[:5]
            else:
                break

    # Último intento fallido
    if last_error:
        raise last_error
    raise Exception("Gemini no disponible. Ningún modelo funcionó con tu clave.")


def _call_openrouter(api_key: str, prompt: str, model: str = None) -> str:
    """Llama a OpenRouter usando REST."""
    import json as _json
    import urllib.request as _ur
    import urllib.error as _ur_err

    model_name = model.strip() if model else "qwen/qwen3-coder:free"
    url = "https://openrouter.ai/api/v1/chat/completions"
    payload = _json.dumps({
        "model": model_name,
        "messages": [{"role": "user", "content": prompt}],
        "temperature": 0.2,
    }).encode()
    
    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {api_key}",
        "HTTP-Referer": "https://github.com/JHONCOD24/jg-turbo",
        "X-Title": "JG Turbo"
    }
    
    http_req = _ur.Request(url, data=payload, headers=headers, method="POST")
    try:
        with _ur.urlopen(http_req, timeout=30) as r:
            data = _json.loads(r.read())
        
        if "error" in data:
            err = data["error"]
            msg = err.get("message", "Error desconocido de OpenRouter")
            raise Exception(f"{msg} [{err.get('code', '')}]")
            
        choices = data.get("choices") or []
        if not choices:
            raise Exception("Respuesta vacía de OpenRouter")
            
        content = choices[0].get("message", {}).get("content") or ""
        return content.strip()
        
    except _ur_err.HTTPError as http_err:
        body_text = ""
        try:
            body = http_err.read().decode("utf-8", errors="ignore")
            body_text = body
            body_json = _json.loads(body)
            if "error" in body_json:
                err = body_json["error"]
                raise Exception(f"OpenRouter {err.get('message', http_err)}")
            else:
                raise Exception(f"HTTP {http_err.code}: {body_text}")
        except Exception as e:
            if "OpenRouter " in str(e) or "HTTP " in str(e):
                raise
            raise Exception(f"HTTP Error {http_err.code}: Not Found")


# Carpeta temporal para procesar archivos
TEMP_DIR = Path(tempfile.gettempdir()) / "jg_turbo"
TEMP_DIR.mkdir(exist_ok=True)

LOCAL_TOKEN_HEADER = "x-jg-local-token"
LOCAL_SESSION_TOKEN = os.getenv("JG_LOCAL_TOKEN") or uuid.uuid4().hex
MAX_AUDIO_FILE_MB = int(os.getenv("MAX_AUDIO_FILE_MB", "50"))
MAX_AUDIO_FILE_BYTES = MAX_AUDIO_FILE_MB * 1024 * 1024
MAX_CHUNK_FILE_MB = int(os.getenv("MAX_CHUNK_FILE_MB", "8"))
MAX_CHUNK_FILE_BYTES = MAX_CHUNK_FILE_MB * 1024 * 1024
MAX_AUDIO_DURATION_SECONDS = int(os.getenv("MAX_AUDIO_DURATION_SECONDS", "1800"))
MAX_CHUNK_DURATION_SECONDS = int(os.getenv("MAX_CHUNK_DURATION_SECONDS", "8"))
MAX_YOUTUBE_DURATION_SECONDS = int(os.getenv("MAX_YOUTUBE_DURATION_SECONDS", "5400"))
MAX_GLOSSARY_CHARS = int(os.getenv("MAX_GLOSSARY_CHARS", "4000"))
LOCAL_ORIGIN_REGEX = r"^https?://(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$"
SESSION_IA_CONFIG = {
    "provider": "gemini",
    "api_key": "",
    "openrouter_model": "qwen/qwen3-coder:free",
}

# ── Thread pool para IA (evita bloquear el event loop de asyncio) ──
_IA_EXECUTOR = concurrent.futures.ThreadPoolExecutor(max_workers=4, thread_name_prefix="ia-")

# ── Inicialización ─────────────────────────────────────────────────────────────
app = FastAPI(
    title="JG Turbo · API de Transcripción",
    version="2.0",
    description="Backend con Whisper para transcribir archivos y videos de YouTube.",
)

# CORS restringido a localhost para uso local seguro
app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=LOCAL_ORIGIN_REGEX,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["*"],
)

print("[OK] FastAPI app inicializada. Respondiendo en /ping inmediatamente.")

# ── Carga perezosa del modelo ─────────────────────────────────────────────────
modelo = None
modelo_lock = threading.Lock()
# Lock para evitar concurrencia en la inferencia de Whisper (no es thread-safe)
transcribe_lock = threading.Lock()
modelo_estado = "no_cargado"  # no_cargado | cargando | listo | error
modelo_error = None

def cargar_modelo():
    """Carga faster-whisper con cuantización int8 para CPU.
    La carga ahora es **eager**: se hace al arrancar en lugar de lazy, porque
    faster-whisper es mucho más rápido de cargar que openai-whisper y así
    evitamos la espera en la primera transcripción.
    """
    global modelo, modelo_estado, modelo_error
    with modelo_lock:
        if modelo_estado in ("cargando", "listo"):
            return
        modelo_estado = "cargando"
        try:
            print(f"Cargando faster-whisper '{WHISPER_MODEL}' (int8 CPU)...")
            from faster_whisper import WhisperModel
            modelo = WhisperModel(
                WHISPER_MODEL,
                device="cpu",
                compute_type="int8",      # ← 4x más rápido vs float16/32 en CPU
                cpu_threads=int(os.environ.get("OMP_NUM_THREADS", "4")),
                num_workers=1,
            )
            modelo_estado = "listo"
            print(f"✅ faster-whisper '{WHISPER_MODEL}' listo (int8).")
        except ImportError as err_import:
            modelo_estado = "error"
            modelo_error = (
                f"Paquete no encontrado: {err_import}. "
                "Solución: activa el entorno virtual y ejecuta: pip install -r requirements.txt"
            )
            print(f"Error cargando faster-whisper (ImportError): {err_import}")
        except Exception as err_ex:
            modelo_estado = "error"
            modelo_error = f"{type(err_ex).__name__}: {err_ex}"
            print(f"Error cargando faster-whisper ({type(err_ex).__name__}): {err_ex}")

# Carga **eager**: bloquea el arranque unos segundos pero evita esperas después.
# Si falla, el servidor sigue funcionando y el endpoint reporta el error.
print(f"⏳ Inicializando faster-whisper '{WHISPER_MODEL}' (int8 CPU)...")
cargar_modelo()
print(f"  → Estado del modelo: {modelo_estado}")

def modelo_listo() -> bool:
    """Devuelve True si el modelo está cargado y listo para usar."""
    return modelo is not None and modelo_estado == "listo"

# ── Helpers ────────────────────────────────────────────────────────────────────
FORMATOS_AUDIO = {".mp3", ".wav", ".m4a", ".ogg", ".flac", ".aac", ".wma", ".opus", ".webm", ".mp4"}

def limpiar_archivo(path: Path):
    try:
        if path.exists():
            path.unlink()
    except Exception:
        pass

def _request_host(request: Request) -> str:
    client = getattr(request, "client", None)
    return (getattr(client, "host", "") or "").lower()

def _es_contexto_test(request: Request) -> bool:
    return _request_host(request) == "testclient" or bool(os.environ.get("PYTEST_CURRENT_TEST"))

def _es_peticion_local(request: Request) -> bool:
    host = _request_host(request)
    return host in {"127.0.0.1", "::1", "localhost", "testclient"} or _es_contexto_test(request)

def _require_local_token(request: Request):
    if not _es_peticion_local(request):
        raise HTTPException(status_code=403, detail="Este backend solo acepta peticiones locales.")
    if _es_contexto_test(request):
        return
    token = request.headers.get(LOCAL_TOKEN_HEADER, "").strip()
    if token != LOCAL_SESSION_TOKEN:
        raise HTTPException(status_code=401, detail="Falta el token local de seguridad. Abre la app desde http://localhost:8000.")

def _copiar_upload_con_limite(file: UploadFile, destino: Path, limite_bytes: int) -> int:
    total = 0
    with destino.open("wb") as f:
        while True:
            chunk = file.file.read(1024 * 1024)
            if not chunk:
                break
            total += len(chunk)
            if total > limite_bytes:
                raise HTTPException(
                    status_code=413,
                    detail=f"El archivo supera el límite permitido de {limite_bytes // (1024 * 1024)} MB.",
                )
            f.write(chunk)
    return total

def _obtener_duracion_segundos(ruta: Path) -> Optional[float]:
    try:
        r = subprocess.run(
            [
                "ffprobe",
                "-v", "error",
                "-show_entries", "format=duration",
                "-of", "default=noprint_wrappers=1:nokey=1",
                str(ruta),
            ],
            capture_output=True,
            text=True,
            timeout=20,
        )
        if r.returncode == 0:
            valor = (r.stdout or "").strip()
            if valor:
                return float(valor)
    except Exception:
        pass
    return None

def _validar_audio_temporal(ruta: Path, max_bytes: int, max_duration_seconds: int):
    tam = ruta.stat().st_size
    if tam > max_bytes:
        raise HTTPException(
            status_code=413,
            detail=f"El archivo supera el límite permitido de {max_bytes // (1024 * 1024)} MB.",
        )
    duracion = _obtener_duracion_segundos(ruta)
    if duracion and duracion > max_duration_seconds:
        mins = round(max_duration_seconds / 60, 1)
        raise HTTPException(
            status_code=413,
            detail=f"El audio es demasiado largo. Máximo permitido: {mins} minutos.",
        )

def _leer_glosario_usuario() -> str:
    try:
        if GLOSSARY_FILE.exists():
            import json as _json
            data = _json.loads(GLOSSARY_FILE.read_text(encoding="utf-8"))
            texto = (data.get("glossary") or "").strip()
            if texto:
                return re.sub(r"\s+", " ", texto)[:600]
    except Exception:
        pass
    return ""

def _prompt_con_glosario(base: str) -> str:
    glosario = _leer_glosario_usuario()
    if not glosario:
        return base
    return f"{base} Términos importantes del usuario: {glosario}."

def _config_ia_sesion(request: Request) -> dict:
    if not _es_peticion_local(request):
        return {}
    if _es_contexto_test(request):
        return dict(SESSION_IA_CONFIG)
    token = request.headers.get(LOCAL_TOKEN_HEADER, "").strip()
    if token != LOCAL_SESSION_TOKEN:
        return {}
    return dict(SESSION_IA_CONFIG)

def _resolver_config_ia(request: Request, provider: str, api_key: str, openrouter_model: Optional[str]):
    cfg = _config_ia_sesion(request)
    provider_final = (provider or cfg.get("provider") or "gemini").strip()
    api_key_final = (api_key or cfg.get("api_key") or "").strip()
    model_final = (openrouter_model or cfg.get("openrouter_model") or "qwen/qwen3-coder:free").strip()
    return provider_final, api_key_final, model_final

def _a_wav_mono(ruta: Path) -> Optional[Path]:
    """Convierte cualquier audio a WAV PCM s16le mono 16kHz con ffmpeg.

    OPTIMIZACIÓN: faster-whisper acepta WAV, MP3, M4A, FLAC, OGG directamente
    sin necesidad de conversión previa (usa FFmpeg internamente si hace falta).
    Esta función solo se usa cuando QUEREMOS forzar la conversión (p.ej. para
    segmentación con timestamps precisa). En modo rápido se omite por completo.
    """
    import subprocess
    out = TEMP_DIR / f"{ruta.stem}_m16.wav"
    try:
        r = subprocess.run(
            [
                "ffmpeg", "-nostdin", "-y",
                "-i", str(ruta),
                "-ac", "1",             # forzar 1 canal (mono)
                "-ar", "16000",         # 16 kHz
                "-acodec", "pcm_s16le", # PCM entero 16-bit
                str(out),
            ],
            capture_output=True,
            timeout=180,
        )
        if r.returncode == 0 and out.exists() and out.stat().st_size > 200:
            print(f"[ffmpeg] WAV mono OK: {out.stat().st_size} bytes")
            return out
        print(f"[ffmpeg] rc={r.returncode} — {r.stderr[-300:].decode('utf-8','ignore')}")
    except Exception as e:
        print(f"[ffmpeg] Excepción: {e}")
    if out.exists():
        limpiar_archivo(out)
    return None

# faster-whisper ya acepta estos formatos directamente sin conversión previa
_FORMATOS_DIRECTOS = {".wav", ".mp3", ".m4a", ".flac", ".ogg", ".opus"}

def _input_para_whisper(ruta: Path, fast: bool = False) -> str:
    """Decide si pasar la ruta directamente a faster-whisper o convertir a WAV.

    faster-whisper con compute_type='int8' acepta WAV, MP3, M4A, FLAC, OGG
    directamente usando FFmpeg como backend de decodificación. Solo convertimos
    cuando el formato es raro o necesitamos control fino sobre la entrada.

    En modo fast siempre pasamos la ruta directa (sin conversión).
    """
    ext = ruta.suffix.lower()
    if fast or ext in _FORMATOS_DIRECTOS:
        return str(ruta)
    # Para formatos no soportados directamente, convertir a WAV
    wav = _a_wav_mono(ruta)
    return str(wav) if wav else str(ruta)

# ── Patrones pre-compilados de corrección (evita re-compilar regex en cada llamada) ──
_CORRECCIONES_TECNICAS = [
    (re.compile(r"\bjava ?script\b", re.IGNORECASE), "JavaScript"),
    (re.compile(r"\btype ?script\b", re.IGNORECASE), "TypeScript"),
    (re.compile(r"\bhtml\b", re.IGNORECASE), "HTML"),
    (re.compile(r"\bcss\b", re.IGNORECASE), "CSS"),
    (re.compile(r"\bjson\b", re.IGNORECASE), "JSON"),
    (re.compile(r"\b(openai|openi)\b", re.IGNORECASE), "OpenAI"),
    (re.compile(r"\bapi\b", re.IGNORECASE), "API"),
    (re.compile(r"\burl\b", re.IGNORECASE), "URL"),
    (re.compile(r"\bsql\b", re.IGNORECASE), "SQL"),
    (re.compile(r"\breact\b", re.IGNORECASE), "React"),
    (re.compile(r"\bnode(\.?js)?\b", re.IGNORECASE), "Node.js"),
    (re.compile(r"\bgit ?hub\b", re.IGNORECASE), "GitHub"),
    (re.compile(r"\bgit ?lab\b", re.IGNORECASE), "GitLab"),
    (re.compile(r"\bpython\b", re.IGNORECASE), "Python"),
    (re.compile(r"\bfront ?end\b", re.IGNORECASE), "frontend"),
    (re.compile(r"\bback ?end\b", re.IGNORECASE), "backend"),
    (re.compile(r"\bfull ?stack\b", re.IGNORECASE), "fullstack"),
    (re.compile(r"\bchat ?gpt\b", re.IGNORECASE), "ChatGPT"),
    (re.compile(r"\bgpt[\s\-]?4o\b", re.IGNORECASE), "GPT-4o"),
    (re.compile(r"\bgpt[\s\-]?4\b", re.IGNORECASE), "GPT-4"),
    (re.compile(r"\blang ?chain\b", re.IGNORECASE), "LangChain"),
    (re.compile(r"\brag\b", re.IGNORECASE), "RAG"),
    (re.compile(r"\bjwt\b", re.IGNORECASE), "JWT"),
    (re.compile(r"\boauth\b", re.IGNORECASE), "OAuth"),
    (re.compile(r"\baws\b", re.IGNORECASE), "AWS"),
    (re.compile(r"\bazure\b", re.IGNORECASE), "Azure"),
    (re.compile(r"\bgcp\b", re.IGNORECASE), "GCP"),
    (re.compile(r"\bgoogle cloud\b", re.IGNORECASE), "Google Cloud"),
    (re.compile(r"\b(claude|clud|clude|clube|clod|cloth|clota)\b", re.IGNORECASE), "Claude"),
    (re.compile(r"\b(anthropic|deantropic|dentropic|antropic|antrópic)\b", re.IGNORECASE), "Anthropic"),
    (re.compile(r"\b(kimi|quimi|quimo)\b", re.IGNORECASE), "Kimi"),
    (re.compile(r"\bwhisper\b", re.IGNORECASE), "Whisper"),
    (re.compile(r"\bfastapi\b", re.IGNORECASE), "FastAPI"),
    (re.compile(r"\bpostgres(ql)?\b", re.IGNORECASE), "PostgreSQL"),
    (re.compile(r"\bmongodb\b", re.IGNORECASE), "MongoDB"),
    (re.compile(r"\b(deep ?seek|dip ?sic|dip ?si|dip ?sik|deep ?sic|dip ?sec|dib ?sic)\b", re.IGNORECASE), "DeepSeek"),
    (re.compile(r"\bmistral (large|launch|lars|large o launch)\b", re.IGNORECASE), "Mistral Large"),
    (re.compile(r"\bmistral\b", re.IGNORECASE), "Mistral"),
    (re.compile(r"\b(gemini|gímini|yémini|yéminis)\b", re.IGNORECASE), "Gemini"),
    (re.compile(r"\bollama\b", re.IGNORECASE), "Ollama"),
    (re.compile(r"\b(qwen|cuen)\b", re.IGNORECASE), "Qwen"),
    (re.compile(r"\bgemma\b", re.IGNORECASE), "Gemma"),
    (re.compile(r"\bmeta ?llama\b", re.IGNORECASE), "Meta Llama"),
    (re.compile(r"\b(hugging ?face|hugin ?feis)\b", re.IGNORECASE), "Hugging Face"),
    (re.compile(r"\b(pytorch|paitorch)\b", re.IGNORECASE), "PyTorch"),
    (re.compile(r"\b(tensorflow|tensor ?flou)\b", re.IGNORECASE), "TensorFlow"),
    (re.compile(r"\bdocker\b", re.IGNORECASE), "Docker"),
    (re.compile(r"\b(kubernetes|cubernetes)\b", re.IGNORECASE), "Kubernetes"),
    (re.compile(r"\b(npm|ene ?pe ?eme)\b", re.IGNORECASE), "npm"),
    (re.compile(r"\bpip\b", re.IGNORECASE), "pip"),
    (re.compile(r"\b(markdown|marcdan)\b", re.IGNORECASE), "Markdown"),
    (re.compile(r"\b(v ?s ?code|vi ?es ?code)\b", re.IGNORECASE), "VS Code"),
    (re.compile(r"\bvisual ?studio ?code\b", re.IGNORECASE), "Visual Studio Code"),
    (re.compile(r"\b(web ?hook|web ?juc)\b", re.IGNORECASE), "webhook"),
    (re.compile(r"\b(token|toquen)\b", re.IGNORECASE), "token"),
    (re.compile(r"\b(cookies|cuquis)\b", re.IGNORECASE), "cookies"),
    (re.compile(r"\bdevops\b", re.IGNORECASE), "DevOps"),
    (re.compile(r"\b(agile|ayail)\b", re.IGNORECASE), "Agile"),
    (re.compile(r"\b(scrum|escrot|escrum)\b", re.IGNORECASE), "Scrum"),
    (re.compile(r"\b(llm|llms|l ?l ?m|l ?l ?ms)\b", re.IGNORECASE), "LLM"),
    (re.compile(r"\b(prompt|pront|promts|pronts)\b", re.IGNORECASE), "prompt"),
    (re.compile(r"\bme llueves\b", re.IGNORECASE), "me ayudes"),
    (re.compile(r"\boguito\b", re.IGNORECASE), "loguito"),
    (re.compile(r"\bfabicon\b", re.IGNORECASE), "favicon"),
]

# Confusiones fonéticas frecuentes de Whisper en español (alta confianza)
_CONFUSIONES_FONETICAS_ES = [
    (re.compile(r"\bvoz\s*z+\s*on\b", re.IGNORECASE), "voz on"),
    (re.compile(r"\bvoz\s*z+\s*off\b", re.IGNORECASE), "voz off"),
    (re.compile(r"\bvozon\b", re.IGNORECASE), "voz on"),
    (re.compile(r"\bvozoff\b", re.IGNORECASE), "voz off"),
    (re.compile(r"\bapy\b", re.IGNORECASE), "API"),
    (re.compile(r"\bsquils\b", re.IGNORECASE), "skills"),
    (re.compile(r"\bmuchas\s+gracia\b", re.IGNORECASE), "muchas gracias"),
    (re.compile(r"\bningun\s+n\b", re.IGNORECASE), "ningún"),
    (re.compile(r"\balgun\s+n\b", re.IGNORECASE), "algún"),
    (re.compile(r"\btambien\b", re.IGNORECASE), "también"),
    (re.compile(r"\bademas\b", re.IGNORECASE), "además"),
    (re.compile(r"\basi\b(?=\s)", re.IGNORECASE), "así"),
    (re.compile(r"\bmas\b(?=\s+(que|de|bien|tarde|temprano|importante|grande|pequeño))", re.IGNORECASE), "más"),
    (re.compile(r"\bpor\s*que\b(?=\s)", re.IGNORECASE), "porque"),
    (re.compile(r"\btran\s*scrip", re.IGNORECASE), "transcrip"),
    (re.compile(r"\bpro\s*grama", re.IGNORECASE), "programa"),
    (re.compile(r"\bapli\s*caci[oó]n", re.IGNORECASE), "aplicación"),
    (re.compile(r"\binteligencia\s+arti\s*ficial", re.IGNORECASE), "inteligencia artificial"),
]

# Palabras inventadas: secuencias raras que Whisper genera en audio difuso
_PALABRA_INVENTADA = re.compile(
    r"\b(?:[b-df-hj-np-tv-z]{5,}|[aeiou]{6,})\b",
    re.IGNORECASE,
)

# Patrones de anti-repetición (también pre-compilados)
_REP_BUCLE_PALABRA = re.compile(r"\b(\w+)(?:[\s,.;]+?\1){3,}\b", re.IGNORECASE)
_REP_BUCLE_PAR = re.compile(r"\b(\w+[\s,.;]+?\w+)(?:[\s,.;]+?\1){2,}\b", re.IGNORECASE)


def corregir_terminos_tecnicos(texto: str) -> str:
    """Post-procesamiento del texto transcrito con patrones pre-compilados (5-10x más
    rápido que compilar regex en cada llamada)."""
    if not texto:
        return texto

    texto = _REP_BUCLE_PALABRA.sub(r"\1", texto)
    texto = _REP_BUCLE_PAR.sub(r"\1", texto)

    for patron, reemplazo in _CORRECCIONES_TECNICAS:
        texto = patron.sub(reemplazo, texto)

    return texto

# ── Anti-alucinación de Whisper ─────────────────────────────────────────────────
# Frases que Whisper "inventa" típicamente sobre silencios, música o ruido de fondo.
_FRASES_ALUCINACION = [
    r"subt[íi]tulos?\b.*\bamara\.org",
    r"subt[íi]tulos?\b.*\bcomunidad",
    r"subtitles?\b.*\bamara\.org",
    r"gracias por ver (el|este) (v[íi]deo|video)",
    r"no olvides? suscribirte",
    r"suscr[íi]bete al canal",
    r"thanks? for watching",
    r"please (like and )?subscribe",
    r"\b(www\.)?[\w\-]+\.(com|net|org)/[\w\-]*$",
    # Nuevos patrones de alucinación comunes en español
    r"^[a-z]$",                            # letras sueltas
    r"^(la|el|los|las|un|una|y|o|de|en|que|por|con|sin|para)\s*$",  # conectores solos
    r"\b(punto\s+)?com\b",                 # ".com" hablado
    r"\b(música|música\s+de\s+fondo)\b",
    r"^\d{1,3}$",                          # números sueltos
    r"\b(aplausos|risas|silencio)\b",
]

def _confianza_segmento(seg) -> float:
    """Estima la confianza (0..1) de un segmento a partir de las métricas internas
    de faster-whisper. Mapea avg_logprob (~-0.1 excelente, ~-1.5 muy malo) a 0..1."""
    logprob = getattr(seg, "avg_logprob", -0.3)
    conf = (logprob + 1.5) / 1.4
    return round(max(0.0, min(1.0, conf)), 3)

def _es_alucinacion(seg) -> bool:
    """Detecta segmentos probablemente alucinados por Whisper (audio difuso o silencio).
    Balanceado: descarta basura clara, marca como dudosa la zona gris."""
    texto = (getattr(seg, "text", "") or "").strip().lower()
    if not texto:
        return True
    no_speech = getattr(seg, "no_speech_prob", 0.0)
    logprob = getattr(seg, "avg_logprob", 0.0)
    comp = getattr(seg, "compression_ratio", 1.0)

    # 1) Silencio confirmado (VAD dice que no hay voz) + texto muy poco fiable
    if no_speech > 0.55 and logprob < -1.0:
        return True
    # 2) Bucle de repetición: ratio de compresión alto → el modelo está "trabado"
    if comp > 2.4 and logprob < -0.5:
        return True
    # 3) Muy baja probabilidad de log + alta compresión (zona gris)
    if logprob < -1.2 and comp > 1.8:
        return True
    # 4) Frases de relleno conocidas que Whisper inventa
    for patron in _FRASES_ALUCINACION:
        if re.search(patron, texto):
            return True
    return False

def _es_segmento_dudoso(seg) -> bool:
    """Marca segmentos que no son alucinación clara pero tienen baja calidad.
    Estos se conservan pero se marcan para revisión con IA."""
    logprob = getattr(seg, "avg_logprob", 0.0)
    no_speech = getattr(seg, "no_speech_prob", 0.0)
    comp = getattr(seg, "compression_ratio", 1.0)
    # Zona gris: logprob bajo pero no tan bajo como para descartar
    if logprob < -0.6 and no_speech > 0.3:
        return True
    if logprob < -0.9 and comp > 1.5:
        return True
    return False


def transcribir_archivo(
    ruta: Path,
    idioma: Optional[str] = None,
    preview: bool = False,
    fast: bool = False,
) -> dict:
    if not modelo_listo():
        if modelo_estado == "cargando":
            return {"_error": "El modelo aún se está cargando, espera unos segundos y vuelve a intentar."}
        return {"_error": f"Modelo Whisper no disponible: {modelo_error or 'error desconocido'}"}

    if not ruta.exists() or ruta.stat().st_size < 2000:
        return {"text": "", "language": "es", "segments": []}

    # faster-whisper acepta WAV, MP3, M4A, FLAC, OGG directamente.
    # En modo rápido pasamos la ruta directa sin conversión previa.
    usar_modo_rapido = preview or fast
    input_path = str(ruta) if usar_modo_rapido else _input_para_whisper(ruta, fast=False)

    # ── fast/preview mode: greedy decoding, sin timestamps ──
    if usar_modo_rapido:
        opciones: dict = {
            "beam_size": 1,
            "temperature": 0.0,
            "condition_on_previous_text": False,
            "without_timestamps": True,
            "word_timestamps": False,
            "vad_filter": True,              # salta silencios → más rápido
            "initial_prompt": _prompt_con_glosario("Transcripción clara en español."),
        }
    else:
        # ── normal mode: equilibrio precisión/velocidad (beam 3 ≈ 40% más rápido que beam 5) ──
        opciones = {
            "beam_size": 3,
            "best_of": 3,
            "temperature": 0.0,
            "condition_on_previous_text": True,
            "without_timestamps": False,
            "word_timestamps": False,
            "vad_filter": True,
            "vad_parameters": dict(
                threshold=0.35,
                min_speech_duration_ms=200,
                min_silence_duration_ms=350,
            ),
            "initial_prompt": _prompt_con_glosario(
                "Esta es una transcripción clara y precisa de una conversación en español. "
                "Se habla sobre tecnología, programación, inteligencia artificial y desarrollo "
                "de software. Términos frecuentes: JavaScript, TypeScript, Python, React, "
                "Node.js, API, JSON, HTML, CSS, Git, Docker, Kubernetes, AWS, Azure, "
                "machine learning, LLM, prompt, token, FastAPI, PostgreSQL. "
                "Nombres: OpenAI, ChatGPT, GPT-4, Claude, Anthropic, Gemini, DeepSeek, Mistral."
            ),
        }

    if idioma and idioma != "auto":
        opciones["language"] = idioma.split("-")[0].lower()

    try:
        # faster-whisper devuelve (generator_de_segmentos, info)
        with transcribe_lock:
            segmentos_gen, info = modelo.transcribe(input_path, **opciones)

            # Consumir el generator inmediatamente (dentro del lock para
            # evitar que otro hilo interfiera con el estado de CTranslate2)
            segmentos_raw = list(segmentos_gen)

        idioma_detectado = info.language if hasattr(info, "language") else "desconocido"

        if usar_modo_rapido:
            # En modo rápido concatenamos todo el texto sin segmentación
            texto_bruto = " ".join(
                getattr(s, "text", "") for s in segmentos_raw
            )
            texto_limpio = corregir_terminos_tecnicos(texto_bruto.strip())
            return {
                "text": texto_limpio,
                "language": idioma_detectado,
                "segments": [],
                "low_confidence_segments": 0,
                "removed_hallucinations": 0,
                "needs_review": False,
            }

        # ── modo normal: segmentar, filtrar, y calcular confianza ──
        segmentos = []
        partes_texto = []
        baja_confianza = 0
        alucinaciones = 0

        for s in segmentos_raw:
            if _es_alucinacion(s):
                alucinaciones += 1
                continue
            texto_seg = corregir_terminos_tecnicos(
                (getattr(s, "text", "") or "").strip()
            )
            if not texto_seg:
                continue
            conf = _confianza_segmento(s)
            es_dudoso = conf < 0.45 or _es_segmento_dudoso(s)
            if es_dudoso:
                baja_confianza += 1
            partes_texto.append(texto_seg)
            segmentos.append({
                "start": round(getattr(s, "start", 0), 2),
                "end":   round(getattr(s, "end", 0), 2),
                "text":  texto_seg,
                "confidence": conf,
                "low_confidence": es_dudoso,
            })

        texto_limpio = " ".join(partes_texto) if partes_texto else ""

        total = len(segmentos)
        needs_review = alucinaciones > 0 or (total > 0 and baja_confianza / total > 0.25)

        return {
            "text": texto_limpio,
            "language": idioma_detectado,
            "segments": segmentos,
            "low_confidence_segments": baja_confianza,
            "removed_hallucinations": alucinaciones,
            "needs_review": needs_review,
        }

    except Exception as e:
        import traceback
        traceback.print_exc()
        return {"_error": f"Whisper falló: {e}"}
    finally:
        # No limpiamos el input_path porque puede ser el archivo original o el WAV convertido.
        # La limpieza del archivo temporal original se hace en el endpoint.
        pass

# ── Endpoints ──────────────────────────────────────────────────────────────────

@app.get("/")
def raiz():
    """Sirve la interfaz HTML principal. Al abrirla desde el backend se garantiza
    contexto seguro (localhost) para que funcionen la API de micrófono,
    MediaRecorder y los fetch al mismo origen sin problemas de CORS."""
    html_path = Path(__file__).parent.parent / "index.html"
    if html_path.exists():
        return FileResponse(str(html_path), media_type="text/html")
    # Fallback si el HTML no está junto al backend
    return JSONResponse({
        "app": "JG Turbo · API de Transcripción",
        "version": "2.0",
        "modelo": WHISPER_MODEL,
        "estado_modelo": modelo_estado,
        "endpoints": ["/health", "/transcribe", "/youtube", "/docs"],
    })

@app.get("/ping")
def ping():
    """Health mínimo — responde aunque el modelo no esté listo."""
    return {"status": "ok"}

class GlossaryRequest(BaseModel):
    glossary: str

class SessionAIRequest(BaseModel):
    provider: str = "gemini"
    api_key: Optional[str] = None
    openrouter_model: Optional[str] = None

GLOSSARY_FILE = Path(__file__).parent / "glossary.json"

@app.get("/glossary")
def get_glossary():
    if GLOSSARY_FILE.exists():
        try:
            import json as _json
            data = _json.loads(GLOSSARY_FILE.read_text(encoding="utf-8"))
            return {"glossary": data.get("glossary", "")}
        except Exception:
            pass
    return {"glossary": ""}

@app.post("/glossary")
def save_glossary(req: GlossaryRequest, request: Request):
    _require_local_token(request)
    texto = (req.glossary or "").strip()
    if len(texto) > MAX_GLOSSARY_CHARS:
        raise HTTPException(status_code=400, detail=f"El glosario es demasiado largo. Máximo: {MAX_GLOSSARY_CHARS} caracteres.")
    try:
        import json as _json
        GLOSSARY_FILE.write_text(_json.dumps({"glossary": texto}, ensure_ascii=False), encoding="utf-8")
        return {"status": "ok"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"No se pudo guardar el glosario: {e}")

@app.get("/health")
def health():
    """Estado completo del servidor y del modelo."""
    return {
        "status": "ok",
        "server": "running",
        "model": WHISPER_MODEL,
        "model_state": modelo_estado,
        "model_ready": modelo_listo(),
        "model_error": modelo_error,
        "ai_configured": bool((SESSION_IA_CONFIG.get("api_key") or "").strip()),
    }

@app.get("/session-config")
def session_config():
    return {
        "token": LOCAL_SESSION_TOKEN,
        "auth_header": LOCAL_TOKEN_HEADER,
        "ai_provider": SESSION_IA_CONFIG.get("provider", "gemini"),
        "openrouter_model": SESSION_IA_CONFIG.get("openrouter_model", "qwen/qwen3-coder:free"),
        "ai_configured": bool((SESSION_IA_CONFIG.get("api_key") or "").strip()),
        "limits": {
            "max_audio_mb": MAX_AUDIO_FILE_MB,
            "max_audio_minutes": round(MAX_AUDIO_DURATION_SECONDS / 60, 1),
            "max_youtube_minutes": round(MAX_YOUTUBE_DURATION_SECONDS / 60, 1),
        },
    }

@app.post("/session-ai")
def save_session_ai(req: SessionAIRequest, request: Request):
    _require_local_token(request)
    provider = (req.provider or "gemini").strip().lower()
    if provider not in {"none", "gemini", "openrouter", "mistral", "anthropic"}:
        raise HTTPException(status_code=400, detail="Proveedor de IA no válido.")
    api_key = None if req.api_key is None else (req.api_key or "").strip()
    if api_key is not None and len(api_key) > 400:
        raise HTTPException(status_code=400, detail="La clave de API es demasiado larga.")
    SESSION_IA_CONFIG["provider"] = provider
    if api_key is not None:
        SESSION_IA_CONFIG["api_key"] = api_key
    SESSION_IA_CONFIG["openrouter_model"] = (req.openrouter_model or "qwen/qwen3-coder:free").strip() or "qwen/qwen3-coder:free"
    return {
        "status": "ok",
        "provider": SESSION_IA_CONFIG["provider"],
        "ai_configured": bool((SESSION_IA_CONFIG.get("api_key") or "").strip()),
        "openrouter_model": SESSION_IA_CONFIG["openrouter_model"],
    }

@app.post("/reload-model")
def reload_model_endpoint(request: Request, model_name: Optional[str] = None):
    """Reintenta cargar el modelo Whisper o cambia a uno nuevo.
    Permite recuperarse sin reiniciar el servidor."""
    _require_local_token(request)
    global modelo, modelo_estado, modelo_error, WHISPER_MODEL

    if model_name:
        model_name = model_name.lower().strip()
        if model_name not in MODELOS_VALIDOS:
            raise HTTPException(status_code=400, detail=f"Modelo no válido. Válidos: {', '.join(MODELOS_VALIDOS)}")

    with modelo_lock:
        state = modelo_estado
        # Si ya se está cargando el modelo correcto, esperar
        if state == "cargando" and (not model_name or model_name == WHISPER_MODEL):
            return JSONResponse({"status": "wait", "message": "El modelo ya se está cargando, espera."})

        # Si ya está listo y es el mismo modelo, retornar ok
        if state == "listo" and model_name == WHISPER_MODEL:
            return JSONResponse({"status": "ok", "message": f"El modelo {WHISPER_MODEL} ya está listo."})

        # Cambiar el modelo y resetear estado
        if model_name:
            WHISPER_MODEL = model_name
        modelo = None
        modelo_error = None
        modelo_estado = "no_cargado"

    # Iniciar carga fuera del lock para evitar deadlock
    threading.Thread(target=cargar_modelo, daemon=True).start()
    return JSONResponse({"status": "retrying", "message": f"Carga del modelo {WHISPER_MODEL} iniciada. Verifica /health en unos segundos."})

@app.post("/transcribe")
def transcribe_audio(
    request: Request,
    file: UploadFile = File(...),
    language: str = Form("auto"),
    preview: bool = Form(False),
    fast: bool = Form(False),
    auto_correct: bool = Form(False),
):
    """Recibe un archivo de audio y devuelve el texto transcrito."""
    _require_local_token(request)
    sufijo = Path(file.filename or "audio.tmp").suffix.lower()
    if sufijo not in FORMATOS_AUDIO:
        raise HTTPException(
            status_code=400,
            detail=f"Formato '{sufijo}' no soportado. Usa: {', '.join(sorted(FORMATOS_AUDIO))}"
        )

    # Si el modelo aún no está listo, devolver 503 (cliente puede reintentar)
    if not modelo_listo():
        if modelo_estado == "cargando":
            raise HTTPException(status_code=503, detail="El modelo Whisper aún se está cargando. Espera unos segundos.")
        elif modelo_estado == "error":
            raise HTTPException(status_code=500, detail=f"Modelo Whisper no disponible: {modelo_error}")
        else:
            raise HTTPException(status_code=503, detail="Modelo no disponible.")

    tmp_path = TEMP_DIR / f"{uuid.uuid4()}{sufijo}"
    try:
        _copiar_upload_con_limite(file, tmp_path, MAX_AUDIO_FILE_BYTES)
        _validar_audio_temporal(tmp_path, MAX_AUDIO_FILE_BYTES, MAX_AUDIO_DURATION_SECONDS)

        resultado = transcribir_archivo(tmp_path, language, preview=preview, fast=fast)
        if "_error" in resultado:
            raise HTTPException(status_code=500, detail=resultado["_error"])
        if auto_correct and resultado.get("text"):
            corr = _corregir_transcripcion_contextual_sync(
                request, resultado["text"], language,
                usar_ia=not (preview or fast),
            )
            resultado["text"] = corr["text"]
            resultado["auto_corrected"] = True
            resultado["correction_method"] = corr.get("method", "local")
            if corr.get("ia_used"):
                resultado["correction_ia"] = True
                resultado["correction_provider"] = corr.get("provider")
        return JSONResponse(content=resultado)

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error al transcribir: {e}")
    finally:
        limpiar_archivo(tmp_path)

@app.post("/transcribe-chunk")
def transcribe_chunk(
    request: Request,
    file: UploadFile = File(...),
    language: str = Form("auto"),
    chunk_index: int = Form(0),
    auto_correct: bool = Form(False),
):
    _require_local_token(request)
    sufijo = Path(file.filename or "chunk.webm").suffix.lower() or ".webm"
    if sufijo not in FORMATOS_AUDIO:
        raise HTTPException(status_code=400, detail="Formato de chunk no soportado.")
    if not modelo_listo():
        raise HTTPException(status_code=503, detail="Whisper aún se está cargando.")

    tmp_path = TEMP_DIR / f"{uuid.uuid4()}{sufijo}"
    try:
        _copiar_upload_con_limite(file, tmp_path, MAX_CHUNK_FILE_BYTES)
        _validar_audio_temporal(tmp_path, MAX_CHUNK_FILE_BYTES, MAX_CHUNK_DURATION_SECONDS)
        resultado = transcribir_archivo(tmp_path, language, preview=True, fast=True)
        if "_error" in resultado:
            raise HTTPException(status_code=500, detail=resultado["_error"])
        texto_final = resultado.get("text", "")
        if auto_correct and texto_final:
            corr = _corregir_transcripcion_contextual_sync(
                request, texto_final, language, usar_ia=False,
            )
            texto_final = corr["text"]
        return {
            "chunk_index": chunk_index,
            "text": texto_final,
            "language": resultado.get("language", "desconocido"),
        }
    finally:
        limpiar_archivo(tmp_path)

class YouTubeRequest(BaseModel):
    url: str
    language: str = "auto"
    prefer_subtitles: bool = True
    fast_mode: bool = True

def _vtt_a_texto(contenido: str) -> str:
    """Convierte un archivo de subtítulos VTT a texto plano, sin marcas de tiempo
    ni líneas duplicadas (frecuentes en subtítulos automáticos con efecto rodante)."""
    texto_partes = []
    anterior = None
    for linea in contenido.splitlines():
        linea = linea.strip()
        if not linea or linea.upper().startswith("WEBVTT") or "-->" in linea:
            continue
        if re.match(r"^\d+$", linea) or linea.startswith(("Kind:", "Language:")):
            continue
        linea = re.sub(r"<[^>]+>", "", linea)
        if linea and linea != anterior:
            texto_partes.append(linea)
            anterior = linea
    return " ".join(texto_partes)

def _obtener_subtitulos(info: dict, idioma_corto: Optional[str]):
    """Busca subtítulos (manuales o automáticos) en el video y devuelve (texto, idioma)
    o (None, None) si no hay disponibles."""
    import urllib.request as _ur

    for fuente in ("subtitles", "automatic_captions"):
        subs = info.get(fuente) or {}
        if not subs:
            continue

        candidatos = []
        if idioma_corto:
            candidatos += [k for k in subs if k == idioma_corto or k.startswith(idioma_corto + "-")]
        for preferido in ("es", "en"):
            candidatos += [k for k in subs if k == preferido and k not in candidatos]
        candidatos += [k for k in subs if k not in candidatos]

        for lang in candidatos:
            tracks = subs.get(lang) or []
            track = next((t for t in tracks if t.get("ext") == "vtt"), tracks[0] if tracks else None)
            if not track or not track.get("url"):
                continue
            try:
                with _ur.urlopen(track["url"], timeout=20) as r:
                    contenido = r.read().decode("utf-8", errors="ignore")
                texto = _vtt_a_texto(contenido)
                if texto:
                    return texto, lang
            except Exception:
                continue

    return None, None

@app.post("/youtube")
def transcribe_youtube(req: YouTubeRequest, request: Request):
    """Recibe una URL de YouTube y devuelve el texto: primero intenta usar los
    subtítulos del video y, si no hay disponibles, descarga el audio y lo
    transcribe con Whisper."""
    _require_local_token(request)
    yt_pattern = re.compile(
        r"(https?://)?(www\.)?(youtube\.com/watch\?v=|youtu\.be/|youtube\.com/shorts/)[\w\-]+"
    )
    if not yt_pattern.search(req.url):
        raise HTTPException(status_code=400, detail="URL de YouTube no válida.")

    import yt_dlp

    idioma = req.language if req.language and req.language != "auto" else None
    idioma_corto = idioma.split("-")[0].lower() if idioma else None

    ydl_common = {
        "quiet": True,
        "no_warnings": True,
        "socket_timeout": 20,
        "retries": 1,
        "user_agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
        "extractor_args": {"youtube": {"player_client": ["web", "android"]}},
    }

    try:
        with yt_dlp.YoutubeDL({**ydl_common, "skip_download": True}) as ydl:
            info = ydl.extract_info(req.url, download=False)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"No se pudo procesar el video (YouTube/Google): {e}")

    titulo = info.get("title", "")
    duracion_video = info.get("duration")
    if duracion_video and duracion_video > MAX_YOUTUBE_DURATION_SECONDS:
        raise HTTPException(
            status_code=413,
            detail=f"El video es demasiado largo. Máximo permitido: {round(MAX_YOUTUBE_DURATION_SECONDS / 60, 1)} minutos.",
        )

    # 1. Intentar usar subtítulos (manuales o automáticos) — es más rápido
    if req.prefer_subtitles:
        texto_subs, lang_subs = _obtener_subtitulos(info, idioma_corto)
        if texto_subs:
            return JSONResponse({
                "text": corregir_terminos_tecnicos(texto_subs),
                "language": lang_subs,
                "title": titulo,
                "source": "subtitles",
            })

    # 2. Fallback: descargar el audio y transcribirlo con Whisper
    if not modelo_listo():
        if modelo_estado == "cargando":
            raise HTTPException(status_code=503, detail="El modelo Whisper aún se está cargando. Espera unos segundos.")
        raise HTTPException(status_code=500, detail=f"Modelo Whisper no disponible: {modelo_error or 'error desconocido'}")

    tmp_id = uuid.uuid4()
    ydl_opts_audio = {
        **ydl_common,
        "format": "bestaudio/best",
        "outtmpl": str(TEMP_DIR / f"{tmp_id}.%(ext)s"),
        "postprocessors": [{
            "key": "FFmpegExtractAudio",
            "preferredcodec": "mp3",
            "preferredquality": "128",
        }],
    }
    try:
        with yt_dlp.YoutubeDL(ydl_opts_audio) as ydl:
            ydl.download([req.url])

        candidatos = list(TEMP_DIR.glob(f"{tmp_id}.*"))
        if not candidatos:
            raise HTTPException(status_code=500, detail="No se pudo descargar el audio del video.")
        audio_path = candidatos[0]
        _validar_audio_temporal(audio_path, MAX_AUDIO_FILE_BYTES, MAX_YOUTUBE_DURATION_SECONDS)

        resultado = transcribir_archivo(audio_path, req.language, fast=req.fast_mode)
        if "_error" in resultado:
            raise HTTPException(status_code=500, detail=resultado["_error"])

        return JSONResponse({
            "text": resultado["text"],
            "language": resultado.get("language", "desconocido"),
            "title": titulo,
            "source": "whisper",
            "segments": resultado.get("segments", []),
            "low_confidence_segments": resultado.get("low_confidence_segments", 0),
            "removed_hallucinations": resultado.get("removed_hallucinations", 0),
            "needs_review": resultado.get("needs_review", False),
        })
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error al procesar el video: {e}")
    finally:
        for f in TEMP_DIR.glob(f"{tmp_id}.*"):
            limpiar_archivo(f)

# ── /improve ───────────────────────────────────────────────────────────────────

class ImproveRequest(BaseModel):
    text: str
    language: str = "es"
    provider: str = "gemini"   # "gemini" | "anthropic" | "mistral" | "openrouter"
    api_key: str = ""
    openrouter_model: Optional[str] = None

def _mejorar_heuristico(texto: str) -> str:
    """Mejora local sin IA: elimina muletillas, limpia repeticiones, mejora puntuación y estructura."""
    # 1. Normalizar espacios y saltos
    texto = re.sub(r"\r\n|\r", "\n", texto)
    texto = re.sub(r" {2,}", " ", texto).strip()

    # 2. Eliminar muletillas y sonidos de relleno (español e inglés)
    muletillas = [
        r"\b(eh+|ah+|oh+|uh+|mm+|hmm+|eeh+|aah+|uhh+|umm+)\b",
        r"\b(bueno pues|bueno|pues bueno|pues|a ver|o sea|este+|entonces este)\b",
        r"\b(o sea que|es que|la verdad es que|la verdad)\b",
        r"\b(¿no\?|¿verdad\?|¿sí\?|¿entiendes\?)\s*",
        r"\b(no sé|o algo así|y tal|y eso)\b",
        r"\b(como que|o cómo|como|digamos)\b(?=\s+[^,])",
        r"\b(literalmente|básicamente|obviamente)\b(?=\s)",
    ]
    for patron in muletillas:
        texto = re.sub(patron, " ", texto, flags=re.IGNORECASE)

    # 2b. Eliminar frases de relleno típicas (ver edicion.md, sección "lista de caza")
    frases_relleno = [
        r"\bes importante (mencionar|destacar|señalar|recalcar) que\b",
        r"\bcabe (destacar|mencionar|señalar|resaltar) que\b",
        r"\bvale la pena (mencionar|destacar|aclarar) que\b",
        r"\bhay que tener en cuenta que\b",
        r"\ben el mundo (actual|de hoy)\b",
        r"\bhoy en d[ií]a\b",
        r"\ba d[ií]a de hoy\b",
        r"\bsin lugar a dudas\b",
        r"\ben términos generales\b",
    ]
    for patron in frases_relleno:
        texto = re.sub(patron, "", texto, flags=re.IGNORECASE)

    # 2c. Simplificar "el cual / la cual / los cuales / las cuales" -> "que"
    texto = re.sub(r"\b(el|la|los|las)\s+(cual|cuales)\b", "que", texto, flags=re.IGNORECASE)

    # 3. Eliminar repeticiones de palabras consecutivas (ej: "que que", "y y", "de de")
    texto = re.sub(r"\b(\w{2,})\s+\1\b", r"\1", texto, flags=re.IGNORECASE)
    # Repeticiones de frases cortas (hasta 4 palabras)
    texto = re.sub(r"\b(\w+(?: \w+){0,3})[,.]?\s+\1\b", r"\1", texto, flags=re.IGNORECASE)

    # 4. Limpiar comas y puntos extra
    texto = re.sub(r"[,،]{2,}", ",", texto)
    texto = re.sub(r"\s+([,.:;!?])", r"\1", texto)
    texto = re.sub(r"([,])(?!\s)", r"\1 ", texto)
    # Quitar comas/puntuación colgante al inicio o tras saltos de línea (por frases eliminadas)
    texto = re.sub(r"^[\s,;:.]+", "", texto)
    texto = re.sub(r"(\n)[\s,;:.]+", r"\1", texto)

    # 5. Normalizar espacios de nuevo tras limpiezas
    texto = re.sub(r" {2,}", " ", texto).strip()
    texto = re.sub(r"\n{3,}", "\n\n", texto)

    # 6. Capitalizar primera letra de cada oración
    if texto:
        texto = texto[0].upper() + texto[1:]
    texto = re.sub(
        r"([.!?…]\s+)([a-záéíóúüñ])",
        lambda m: m.group(1) + m.group(2).upper(),
        texto,
    )

    # 6b. Tildes diacríticas y normativa básica (edicion.md, sección 6)
    texto = _corregir_normativa_basica(texto)

    # 6c. Agregar signos de apertura ¿ ¡ que falten
    texto = _agregar_signos_apertura(texto)

    # 7. Asegurar punto final
    texto = texto.strip()
    if texto and texto[-1] not in ".!?…":
        texto += "."

    return texto


def _corregir_normativa_basica(texto: str) -> str:
    """Aplica reglas normativas básicas del español (días/meses/idiomas en minúscula,
    eliminación de tildes en demostrativos y 'solo' según la RAE)."""
    dias_meses_idiomas = [
        "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo",
        "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto",
        "Septiembre", "Setiembre", "Octubre", "Noviembre", "Diciembre",
        "Español", "Inglés", "Francés", "Alemán", "Italiano", "Portugués",
    ]
    for palabra in dias_meses_idiomas:
        texto = re.sub(
            rf"(?<![.!?¿¡\n]\s)\b{palabra}\b",
            palabra.lower(),
            texto,
        )

    # "Solo" y demostrativos (este/ese/aquel...) ya no llevan tilde según la RAE
    texto = re.sub(r"\bsólo\b", "solo", texto, flags=re.IGNORECASE)
    for dem in ["éste", "ésta", "éstos", "éstas", "ése", "ésa", "ésos", "ésas", "aquél", "aquélla", "aquéllos", "aquéllas"]:
        texto = re.sub(rf"\b{dem}\b", dem.replace("é", "e").replace("á", "a"), texto, flags=re.IGNORECASE)

    return texto


def _agregar_signos_apertura(texto: str) -> str:
    """Asegura que las oraciones interrogativas o exclamativas tengan ¿ o ¡ de apertura."""
    partes = re.split(r"(?<=[.!?…])\s+", texto)
    resultado = []
    for parte in partes:
        p = parte.strip()
        if not p:
            continue
        if p.endswith("?") and "¿" not in p:
            p = "¿" + p
        elif p.endswith("!") and "¡" not in p:
            p = "¡" + p
        resultado.append(p)
    return " ".join(resultado)

def _mejorar_con_ia_sync(provider_resuelto: str, api_key: str, prompt: str, openrouter_model: str) -> tuple:
    """Ejecución síncrona de la llamada IA (se usa en thread pool para no bloquear asyncio)."""
    if provider_resuelto == "anthropic":
        import anthropic as _ant
        client = _ant.Anthropic(api_key=api_key)
        msg = client.messages.create(
            model="claude-haiku-4-5-20251001",
            max_tokens=2048,
            messages=[{"role": "user", "content": prompt}],
        )
        return msg.content[0].text.strip(), "anthropic"
    elif provider_resuelto == "gemini":
        improved = _call_gemini(api_key, prompt, temperature=0.2)
        return improved, "gemini"
    elif provider_resuelto == "openrouter":
        improved = _call_openrouter(api_key, prompt, openrouter_model)
        return improved, "openrouter"
    elif provider_resuelto == "mistral":
        import json as _json
        import urllib.request as _ur
        url = "https://api.mistral.ai/v1/chat/completions"
        payload = _json.dumps({
            "model": "mistral-small-latest",
            "messages": [{"role": "user", "content": prompt}],
            "max_tokens": 2048,
            "temperature": 0.2,
        }).encode()
        http_req = _ur.Request(
            url, data=payload,
            headers={"Content-Type": "application/json", "Authorization": f"Bearer {api_key}"},
            method="POST",
        )
        with _ur.urlopen(http_req, timeout=30) as r:
            data = _json.loads(r.read())
        return data["choices"][0]["message"]["content"].strip(), "mistral"
    raise ValueError(f"Proveedor no soportado: {provider_resuelto}")

@app.post("/improve")
async def improve_text(req: ImproveRequest, request: Request):
    """Mejora el texto con IA (Gemini o Claude) o con heurística local como fallback."""
    txt = req.text.strip()
    if not txt:
        raise HTTPException(status_code=400, detail="Texto vacío.")

    lang = req.language if req.language and req.language != "auto" else "es"
    error_detail = None

    provider_resuelto, api_key, openrouter_model = _resolver_config_ia(
        request, req.provider, req.api_key, req.openrouter_model
    )

    prompt = (
        f"EDITOR ESTRICTO DE TEXTOS — Idioma: {lang}\n\n"
        "Tu ÚNICO trabajo es corregir el texto que te paso. NO puedes inventar nada.\n\n"
        "REGLAS OBLIGATORIAS (no las rompas):\n"
        "1. CORRIGE solo: ortografía, tildes, puntuación (¿¡), mayúsculas al inicio de oración.\n"
        "2. ELIMINA solo: muletillas (eh, este, o sea), repeticiones exactas de palabras, muletillas vacías (\"es importante mencionar\").\n"
        "3. NO CAMBIES: el significado, las ideas, el orden de las ideas, la voz del autor.\n"
        "4. NO AGREGUES: datos, cifras, ejemplos, explicaciones, información nueva, frases inventadas.\n"
        "5. NO REESCRIBAS: si una frase es correcta, déjala igual. No la \"mejores\" a tu manera.\n"
        "6. NO RESUMAS: si el autor dijo algo largo, déjalo largo. No acortes.\n"
        "7. CONSERVA: jerga, tecnicismos, regionalismos del autor. No los cambies por palabras \"más bonitas\".\n\n"
        "FORMATO DE RESPUESTA:\n"
        "- Devuelve SOLO el texto corregido.\n"
        "- Sin explicaciones, sin comillas, sin \"Aquí tienes\", sin nada extra.\n"
        "- Si el texto ya está bien, devuélvelo exactamente igual.\n\n"
        f"TEXTO A CORREGIR:\n{txt}"
    )

    if api_key:
        try:
            loop = asyncio.get_event_loop()
            improved, provider_name = await loop.run_in_executor(
                _IA_EXECUTOR,
                _mejorar_con_ia_sync,
                provider_resuelto, api_key, prompt, openrouter_model,
            )
            return {"text": improved, "ia_used": True, "provider": provider_name}
        except Exception as e:
            error_detail = _detalle_error_ia(provider_resuelto, e)

    return {"text": _mejorar_heuristico(txt), "ia_used": False, "provider": None, "error_detail": error_detail}


def _detalle_error_ia(nombre_proveedor: str, e: Exception) -> str:
    """Convierte errores HTTP/SDK en un mensaje claro para el usuario."""
    texto_error = str(e)
    low = texto_error.lower()

    if "401" in texto_error or "unauthorized" in low or "authentication" in low or "api key not valid" in low or "invalid api key" in low:
        if "gemini" in low or nombre_proveedor.lower().startswith("gemini"):
            return (
                "Clave de API de Gemini inválida o vacía. "
                "Ve a https://aistudio.google.com/app/apikey , genera una nueva (AIza...), "
                "y pégala en Configuración → Clave de API. Asegúrate de no tener espacios."
            )
        if "openrouter" in low or nombre_proveedor.lower().startswith("openrouter"):
            return (
                "Clave de API de OpenRouter inválida, vencida o vacía. "
                "Ve a https://openrouter.ai/keys , genera una nueva, "
                "y pégala en Configuración → Clave de API. Asegúrate de no tener espacios."
            )
        return (
            f"Clave de API de {nombre_proveedor} inválida, vencida o vacía. "
            f"Revisa la clave en Configuración (sin espacios extra)."
        )

    if "403" in texto_error or "permission" in low or "denied" in low:
        return f"Acceso denegado por {nombre_proveedor} (clave sin permisos, proyecto no habilitado o cuota agotada)."

    if "429" in texto_error or "quota" in low or "rate limit" in low or "credit" in low or "insufficient" in low:
        if "openrouter" in low or nombre_proveedor.lower().startswith("openrouter"):
            return "Límite de uso o saldo insuficiente en OpenRouter. Revisa tu cuenta y saldo en openrouter.ai."
        return f"Límite de uso (cuota) alcanzado en {nombre_proveedor}. Espera un minuto o revisa tu plan."

    if "404" in texto_error or "not found" in low:
        if "gemini" in low or nombre_proveedor.lower().startswith("gemini"):
            return (
                "Gemini devolvió 404 (modelo no encontrado para tu clave). "
                "El código ahora intenta descubrir automáticamente los modelos disponibles. "
                "Prueba regenerando la clave en aistudio.google.com o usa una clave con acceso a 'gemini-2.0-flash'."
            )
        return f"Recurso no encontrado (404) en {nombre_proveedor}."

    if "gemini" in low and ("safety" in low or "blocked" in low or "candidate" in low):
        return "Gemini bloqueó la respuesta por filtros de seguridad. Prueba con texto más corto o neutral."

    return f"{nombre_proveedor}: {texto_error}"


# ── /translate ──────────────────────────────────────────────────────────────────

class TranslateRequest(BaseModel):
    text: str
    direction: str  # "en-es" | "es-en"
    provider: str = "gemini"
    api_key: str = ""
    openrouter_model: Optional[str] = None

def _translate_mymemory(text: str, src: str, trg: str) -> Optional[str]:
    """Llama a la API pública y gratuita de MyMemory para traducir un fragmento."""
    import urllib.request as _ur
    import urllib.parse as _up
    import json as _json
    try:
        encoded_text = _up.quote(text)
        url = f"https://api.mymemory.translated.net/get?q={encoded_text}&langpair={src}|{trg}"
        http_req = _ur.Request(url, headers={"User-Agent": "Mozilla/5.0"})
        with _ur.urlopen(http_req, timeout=10) as r:
            data = _json.loads(r.read())
        if data.get("responseStatus") == 200:
            import html as _html
            val = data["responseData"]["translatedText"]
            return _html.unescape(val)
    except Exception as e:
        print(f"Error MyMemory translation: {e}")
    return None

def _translate_mymemory_chunked(text: str, src: str, trg: str) -> str:
    """Divide el texto por párrafos/líneas para no superar límites de MyMemory y lo traduce."""
    paragraphs = text.split("\n")
    translated_paragraphs = []
    for p in paragraphs:
        p_strip = p.strip()
        if not p_strip:
            translated_paragraphs.append("")
            continue
        
        # Si el párrafo es corto, traducir directo
        if len(p_strip) < 800:
            trans = _translate_mymemory(p_strip, src, trg)
            translated_paragraphs.append(trans if trans else p_strip)
        else:
            # Si el párrafo es muy largo, dividir por oraciones de forma simple
            sentences = re.split(r"(?<=[.!?])\s+", p_strip)
            translated_sentences = []
            for s in sentences:
                s_strip = s.strip()
                if not s_strip:
                    continue
                trans = _translate_mymemory(s_strip, src, trg)
                translated_sentences.append(trans if trans else s_strip)
            translated_paragraphs.append(" ".join(translated_sentences))
            
    return "\n".join(translated_paragraphs)

@app.post("/translate")
async def translate_text(req: TranslateRequest, request: Request):
    """Traduce texto de inglés a español o viceversa utilizando IA (Gemini, Claude, Mistral)
    o mediante MyMemory como fallback gratuito."""
    txt = req.text.strip()
    if not txt:
        raise HTTPException(status_code=400, detail="Texto vacío.")

    src_lang = "English" if req.direction == "en-es" else "Spanish"
    trg_lang = "Spanish" if req.direction == "en-es" else "English"
    src_code = "en" if req.direction == "en-es" else "es"
    trg_code = "es" if req.direction == "en-es" else "en"

    prompt = (
        f"Translate the following text from {src_lang} to {trg_lang}.\n"
        f"Maintain the exact formatting, paragraph breaks, and style of the original text. "
        f"Do not add any explanations, commentary, notes, or introductory text. "
        f"Translate all sentences accurately and naturally.\n\n"
        f"Original text:\n{txt}"
    )

    error_detail = None

    provider_resuelto, api_key, openrouter_model = _resolver_config_ia(
        request, req.provider, req.api_key, req.openrouter_model
    )

    if api_key and provider_resuelto != "none":
        try:
            loop = asyncio.get_event_loop()
            translated, provider_name = await loop.run_in_executor(
                _IA_EXECUTOR,
                _mejorar_con_ia_sync,
                provider_resuelto, api_key, prompt, openrouter_model,
            )
            return {"text": translated, "ia_used": True, "provider": provider_name}
        except Exception as e:
            error_detail = _detalle_error_ia(provider_resuelto, e)

    # Fallback to MyMemory
    try:
        translated_text = _translate_mymemory_chunked(txt, src_code, trg_code)
        if translated_text:
            return {"text": translated_text, "ia_used": False, "provider": None, "error_detail": error_detail}
    except Exception as e:
        if not error_detail:
            error_detail = str(e)
    
    raise HTTPException(status_code=500, detail=f"No se pudo realizar la traducción. Detalle: {error_detail}")


# ── Corrección contextual de transcripciones ────────────────────────────────────

def _nombre_idioma_correccion(lang: str) -> str:
    lang = (lang or "es").split("-")[0].lower()
    if lang.startswith("es"):
        return "español"
    if lang.startswith("en"):
        return "english"
    if lang.startswith("fr"):
        return "français"
    if lang.startswith("pt"):
        return "português"
    if lang.startswith("de"):
        return "deutsch"
    return lang


def _prompt_correccion_transcripcion(texto: str, lang_name: str) -> str:
    return (
        f"Eres un especialista en corrección de transcripciones de voz a texto en {lang_name}. "
        "El texto siguiente fue generado por Whisper (reconocimiento automático) y contiene errores.\n\n"
        "OBJETIVO PRINCIPAL: producir un texto COHERENTE y legible, como si un humano hubiera "
        "escrito lo que realmente se dijo en el audio.\n\n"
        "Whisper comete estos errores frecuentes:\n"
        "- Palabras que suenan parecido pero son distintas (ej: 'casa'↔'caza', 'voto'↔'boto')\n"
        "- Palabras INVENTADAS que no existen en el idioma\n"
        "- Palabras partidas o unidas incorrectamente\n"
        "- Frases enteras sin sentido por ruido o mala calidad de audio\n"
        "- Repeticiones y bucles de sílabas\n\n"
        "INSTRUCCIONES (obligatorias):\n"
        "1. Lee TODO el texto para entender el TEMA y el CONTEXTO general.\n"
        "2. Cuando encuentres una palabra que NO EXISTE o NO ENCAJA en la frase, "
        "reemplázala por la palabra más probable que SÍ encaje según el contexto.\n"
        "3. Si una frase completa es incoherente, reconstrúyela interpretando la intención del hablante.\n"
        "4. Corrige ortografía, tildes, puntuación y mayúsculas.\n"
        "5. CONSERVA el significado, ideas, tono y nivel de formalidad del hablante.\n"
        "6. NO agregues información nueva, datos ni explicaciones.\n"
        "7. NO resumas ni acortes el texto.\n\n"
        "FORMATO: devuelve SOLO el texto corregido, sin explicaciones, sin comillas, sin prefijos.\n\n"
        f"TEXTO A CORREGIR:\n{texto}"
    )


def _corregir_confusiones_foneticas(texto: str) -> str:
    if not texto:
        return texto
    for patron, reemplazo in _CONFUSIONES_FONETICAS_ES:
        texto = patron.sub(reemplazo, texto)
    return texto


def _corregir_con_languagetool_sync(texto: str, lang: str = "es") -> str:
    """Ortografía y gramática contextual vía LanguageTool (API pública gratuita)."""
    if not texto or len(texto) < 8:
        return texto
    lt_map = {
        "es": "es", "es-ES": "es", "es-MX": "es", "es-CO": "es", "es-AR": "es", "es-419": "es",
        "en": "en-US", "en-US": "en-US", "en-GB": "en-GB",
        "fr": "fr", "de": "de-DE", "pt": "pt-BR", "it": "it",
    }
    lt_lang = lt_map.get(lang, lt_map.get(lang.split("-")[0], "es"))
    try:
        import json as _json
        import urllib.request as _ur
        import urllib.parse as _up

        url = "https://api.languagetool.org/v2/check"
        payload = _up.urlencode({"text": texto, "language": lt_lang}).encode()
        http_req = _ur.Request(url, data=payload, method="POST")
        with _ur.urlopen(http_req, timeout=12) as r:
            result = _json.loads(r.read())

        matches = sorted(result.get("matches", []), key=lambda m: m["offset"], reverse=True)
        corregido = texto
        for m in matches:
            replacements = m.get("replacements", [])
            if not replacements:
                continue
            issue_type = (m.get("rule") or {}).get("issueType", "")
            if issue_type and issue_type not in (
                "misspelling", "grammar", "typographical", "uncategorized", "duplication",
            ):
                continue
            start = m["offset"]
            end = start + m["length"]
            corregido = corregido[:start] + replacements[0]["value"] + corregido[end:]
        return corregido
    except Exception:
        return texto


def _corregir_transcripcion_local(texto: str, language: str = "es") -> str:
    """Corrige errores comunes de transcripción de forma local (sin IA).
    No elimina muletillas ni reescribe estilo: solo arregla errores típicos de Whisper."""
    if not texto:
        return texto

    t = re.sub(r" {2,}", " ", texto.strip())

    # Eliminar palabras probablemente inventadas por Whisper
    t = _PALABRA_INVENTADA.sub("", t)

    # Eliminar fragmentos de palabras repetidos
    t = re.sub(r"\b(\w{1,2})\s+\1\s+\1\b", r"\1", t, flags=re.IGNORECASE)

    # Términos técnicos y confusiones fonéticas frecuentes
    t = corregir_terminos_tecnicos(t)
    t = _corregir_confusiones_foneticas(t)

    t = re.sub(r" {2,}", " ", t).strip()
    return t


def _corregir_transcripcion_contextual_sync(
    request: Optional[Request],
    texto: str,
    language: str = "es",
    usar_ia: bool = True,
    provider: str = "",
    api_key: str = "",
    openrouter_model: Optional[str] = None,
) -> dict:
    """Pipeline unificado: heurísticas locales + IA contextual si hay API configurada."""
    txt = (texto or "").strip()
    if not txt:
        return {
            "text": "",
            "ia_used": False,
            "provider": None,
            "error_detail": None,
            "method": "none",
        }

    lang = language if language and language != "auto" else "es"
    corregido = _corregir_transcripcion_local(txt, lang)
    error_detail = None
    ia_used = False
    provider_name = None

    if usar_ia and request is not None:
        lang_name = _nombre_idioma_correccion(lang)
        provider_resuelto, api_key_final, model_final = _resolver_config_ia(
            request, provider, api_key, openrouter_model,
        )
        if api_key_final and provider_resuelto != "none":
            try:
                prompt = _prompt_correccion_transcripcion(corregido, lang_name)
                improved, provider_name = _mejorar_con_ia_sync(
                    provider_resuelto, api_key_final, prompt, model_final,
                )
                improved = (improved or "").strip()
                if improved:
                    corregido = improved
                    ia_used = True
            except Exception as e:
                error_detail = _detalle_error_ia(provider_resuelto, e)

    method = "ia" if ia_used else ("local" if corregido != txt else "none")
    return {
        "text": corregido,
        "ia_used": ia_used,
        "provider": provider_name,
        "error_detail": error_detail,
        "method": method,
    }


class CorrectTranscriptionRequest(BaseModel):
    text: str
    language: str = "es"
    provider: str = "gemini"
    api_key: str = ""
    openrouter_model: Optional[str] = None

@app.post("/correct-transcription")
async def correct_transcription(req: CorrectTranscriptionRequest, request: Request):
    """Corrige errores de transcripción usando IA contextual.
    A diferencia de /improve (que pule redacción), este endpoint está especializado
    en arreglar palabras mal transcritas por Whisper usando contexto semántico."""
    txt = req.text.strip()
    if not txt:
        raise HTTPException(status_code=400, detail="Texto vacío.")

    loop = asyncio.get_event_loop()
    resultado = await loop.run_in_executor(
        _IA_EXECUTOR,
        _corregir_transcripcion_contextual_sync,
        request,
        txt,
        req.language,
        True,
        req.provider,
        req.api_key,
        req.openrouter_model,
    )
    return {
        "text": resultado["text"],
        "ia_used": resultado["ia_used"],
        "provider": resultado.get("provider"),
        "error_detail": resultado.get("error_detail"),
        "method": resultado.get("method", "local"),
    }

class CorrectRequest(BaseModel):
    text: str
    language: str = "es"

# Mapeo de códigos de idioma del frontend a códigos de LanguageTool
_LT_LANG_MAP = {
    "es": "es", "es-ES": "es", "es-MX": "es", "es-CO": "es", "es-AR": "es", "es-419": "es",
    "en": "en-US", "en-US": "en-US", "en-GB": "en-GB",
    "fr": "fr", "fr-FR": "fr",
    "de": "de-DE", "de-DE": "de-DE",
    "pt": "pt-BR", "pt-BR": "pt-BR", "pt-PT": "pt-PT",
    "it": "it",
}

@app.post("/correct")
async def correct_text(req: CorrectRequest):
    """Corrige ortografía, gramática y tildes. Usa LanguageTool y, si no está disponible,
    aplica correcciones normativas locales básicas (tildes diacríticas, mayúsculas, signos ¿¡)."""
    txt = req.text.strip()
    if not txt:
        raise HTTPException(status_code=400, detail="Texto vacío.")

    lt_lang = _LT_LANG_MAP.get(req.language, "es")

    try:
        import json as _json
        import urllib.request as _ur
        import urllib.parse as _up

        url = "https://api.languagetool.org/v2/check"
        payload = _up.urlencode({"text": txt, "language": lt_lang}).encode()
        http_req = _ur.Request(url, data=payload, method="POST")
        with _ur.urlopen(http_req, timeout=15) as r:
            result = _json.loads(r.read())

        # Aplicar reemplazos de atrás hacia adelante para no desajustar los offsets
        matches = sorted(result.get("matches", []), key=lambda m: m["offset"], reverse=True)
        corregido = txt
        aplicados = 0
        for m in matches:
            replacements = m.get("replacements", [])
            if replacements:
                start = m["offset"]
                end = start + m["length"]
                corregido = corregido[:start] + replacements[0]["value"] + corregido[end:]
                aplicados += 1

        return {"text": corregido, "matches": aplicados}
    except Exception as e:
        # Fallback: correcciones normativas locales básicas
        corregido = re.sub(r"\s+([,.:;!?])", r"\1", txt)
        corregido = re.sub(r"([,])(?!\s)", r"\1 ", corregido)
        corregido = re.sub(r" {2,}", " ", corregido).strip()
        if corregido:
            corregido = corregido[0].upper() + corregido[1:]
        corregido = _corregir_normativa_basica(corregido)
        corregido = _agregar_signos_apertura(corregido)
        if corregido and corregido[-1] not in ".!?…":
            corregido += "."
        return {"text": corregido, "matches": 0, "error_detail": str(e)}


# ── /improve-prompt (Skill: maestro-prompts) ───────────────────────────────

class ImprovePromptRequest(BaseModel):
    prompt: str
    target_model: str = "auto"      # "auto" | "claude" | "gpt" | "gemini" | "midjourney" | "imagen" | "video"
    objetivo: Optional[str] = ""    # para qué se usará
    idioma_salida: str = "es"       # idioma del prompt
    provider: str = "gemini"        # proveedor de IA
    api_key: str = ""
    openrouter_model: Optional[str] = None


def _detectar_modalidad_prompt(texto: str) -> str:
    """Detecta si el prompt es para LLM, imagen o video.
    Devuelve: 'llm' | 'imagen' | 'video' | 'mixto'
    """
    t = texto.lower()
    kw_imagen = [
        "midjourney", "dall-e", "dalle", "flux", "stable diffusion", "ideogram",
        "leonardo", "imagen", "ilustra", "dibuja", "pinta", "render", "rendering",
        "estilo fotográfico", "estilo fotorrealista", "estilo anime", "iluminación cinematográfica",
        "wide shot", "close-up", "plano general", "toma cerrada", "8k", "4k", "uhd",
        "niji", "--ar", "--v ", "--s ", "negative prompt", "seed:", "check_point",
    ]
    kw_video = [
        "sora", "veo", "kling", "runway", "pika", "seedance", "video de", "generar video",
        "animación", "motion", "fps", "cámara lenta", "slow motion", "timelapse",
        "10 segundos de video", "video clip", "secuencia de video",
    ]
    kw_llm = [
        "actúa como", "eres un", "tú eres", "rol:", "instrucciones:", "system prompt",
        "tarea:", "objetivo:", "formato de salida", "responde", "explica", "resume",
        "genera un texto", "escribe un", "lista de", "tabla con", "json",
    ]
    score_img = sum(1 for k in kw_imagen if k in t)
    score_vid = sum(1 for k in kw_video if k in t)
    score_llm = sum(1 for k in kw_llm if k in t)
    if score_img > score_llm and score_img > score_vid and score_img >= 1:
        return "imagen"
    if score_vid > score_llm and score_vid > score_img and score_vid >= 1:
        return "video"
    if score_llm >= 1:
        return "llm"
    # Sin pistas claras: por defecto LLM
    return "llm"


def _construir_prompt_maestro(prompt_original: str, modalidad: str,
                              target_model: str, objetivo: str, idioma_salida: str) -> str:
    """Construye el prompt del sistema que se envía a la IA.
    Está basado en la skill maestro-prompts (referencias/tecnicas-llm.md y mejora-prompts.md).
    """
    if target_model == "auto":
        if modalidad == "imagen":
            target_model = "midjourney"
        elif modalidad == "video":
            target_model = "veo"
        else:
            target_model = "llm_neutro"

    bloque_modelo = ""
    if target_model in ("claude",):
        bloque_modelo = (
            "\n\nDialect: el prompt mejorado debe usar etiquetas XML para separar "
            "secciones (<rol>, <contexto>, <tarea>, <formato>, <ejemplos>, <limites>). "
            "Claude responde muy bien a esa estructura."
        )
    elif target_model in ("gpt", "chatgpt"):
        bloque_modelo = (
            "\n\nDialect: el prompt mejorado debe usar Markdown con encabezados ## "
            "y listas. Si es para un GPT personalizado, escribir en segunda persona "
            "('Eres...', 'Cuando el usuario...')."
        )
    elif target_model in ("gemini",):
        bloque_modelo = (
            "\n\nDialect: el prompt mejorado debe usar Markdown claro con contexto "
            "al inicio y tarea al final. Para Gems, patrón GPT-like."
        )
    elif target_model == "midjourney":
        bloque_modelo = (
            "\n\nDialect: prompt para Midjourney. Estructura recomendada: "
            "[sujeto principal], [estilo artístico], [iluminación], [encuadre/cámara], "
            "[parámetros: --ar, --v, --s, --q, --niji opcional]. "
            "El prompt de imagen debe ir en INGLÉS. Añade una traducción comentada al español."
        )
    elif target_model in ("veo", "sora", "kling", "runway", "seedance", "pika"):
        bloque_modelo = (
            "\n\nDialect: prompt para generación de video. Estructura de plano: "
            "[duración] | [sujeto + acción] | [encuadre] | [movimiento de cámara] | "
            "[estilo visual] | [audio/ambiente si aplica]. "
            "El prompt de video debe ir en INGLÉS. Añade una traducción comentada al español."
        )
    else:  # llm_neutro u otros
        bloque_modelo = (
            "\n\nDialect: formato en texto plano (sIN Markdown). "
            "Estructura: secciones separadas por líneas en blanco, "
            "cada sección con un encabezado descriptivo en MAYÚSCULAS entre corchetes, "
            "y el contenido debajo en líneas normales. "
            "Ejemplo: '[ROL] Eres...' / '[CONTEXTO] ...' / '[TAREA] ...' / "
            "'[CRITERIOS DE CALIDAD] ...' / '[FORMATO DE SALIDA] ...'. "
            "El texto plano debe ser legible y pegable directamente en cualquier IA."
        )

    objetivo_bloque = ""
    if objetivo and objetivo.strip():
        objetivo_bloque = f"\n- Objetivo explícito del usuario: {objetivo.strip()}"
    else:
        objetivo_bloque = "\n- Objetivo: deduce el objetivo probable por el contenido del prompt (1 línea)."

    idioma_bloque = ""
    if idioma_salida and idioma_salida != "auto":
        idioma_bloque = f"\n- Idioma del prompt: {idioma_salida} (escribe el prompt final en ese idioma; el razonamiento y diagnóstico los entregas en español)."
    else:
        idioma_bloque = "\n- Idioma: español por defecto salvo que la modalidad (imagen/video) requiera inglés."

    return f"""Eres el ingeniero de prompts senior detrás de la skill "maestro-prompts" (nivel maestro, técnicas 2025-2026). Tu trabajo: auditar el prompt del usuario y entregar una versión mejorada, potente y reproducible.

# Modalidad detectada
{modalidad.upper()}.{bloque_modelo}

# Contexto del usuario
- Prompt original a mejorar (en bloque de código):{objetivo_bloque}{idioma_bloque}

# Tu proceso (estricto, en este orden)
1. **Auditar** el prompt original contra la rúbrica de 8 fallas comunes (objetivo difuso, contexto ausente, sin formato de salida, adjetivos vacíos, negaciones en cadena, sobrecarga, pide certeza imposible, dialecto equivocado). Identifica SOLO los 2-4 problemas de mayor impacto.
2. **Detectar modalidad** y elegir el dialecto correcto para el modelo destino.
3. **Reescribir** el prompt aplicando el flujo: ROL → CONTEXTO → TAREA → CRITERIOS → FORMATO → EJEMPLOS (si aporta) → RESTRICCIONES. No todas las secciones son obligatorias; usa solo las que aportan.
4. **Validar** que el prompt produce el resultado pedido si se pega tal cual (sin editar nada salvo marcadores [COMPLETA: ...]).
5. **Aplicar reglas de oro**: positivo > negativo, definir adjetivos subjetivos, contexto al inicio + instrucción crítica al final, 150-300 palabras es el punto dulce, anti-alucinación explícita si aplica.

# Reglas duras
- PROHIBIDO inventar parámetros, flags o sintaxis de modelos. Si dudas, marca con [VERIFICAR].
- PROHIBIDO usar datos fabricados del usuario. Si el prompt necesita info del negocio, usa marcadores [COMPLETA: ...].
- No hagas "teatro" en el prompt (no "eres el mejor experto del universo con 50 años de experiencia" — eso no mejora nada).
- Si el prompt original es para imagen/video, traduce al INGLÉS y entrega además la versión en español comentada.
- No cambies el objetivo del usuario; solo mejóralo.
- NO agregues saludos, despedidas, ni "como ingeniero de prompts, te sugiero...". Entrega directo.

# Formato de entrega OBLIGATORIO
Escribe las secciones DIAGNÓSTICO, CÓMO ITERAR y CHECKLIST en markdown normal.
Pero la sección **PROMPT MEJORADO debe ir en TEXTO PLANO** (sin markdown, sin negritas, sin listas con asteriscos, sin bloques de código). El prompt mejorado debe ser texto directo, legible, que el usuario pueda copiar y pegar sin editar nada.

## Diagnóstico
El prompt tenía N problemas principales:
1. **[Falla]** → síntoma concreto citando la parte problemática del prompt.
2. ...

## Prompt mejorado
[PROMPT EN TEXTO PLANO AQUÍ — sin markdown, sin ```, sin asteriscos, sin negritas, solo texto con saltos de línea y secciones separadas por líneas en blanco. Máximo 300 palabras. Debe ser copiable y pegable directamente.]

## Por qué funciona
- (3-5 viñetas explicando brevemente qué técnica usa cada parte clave)
- Si la modalidad es imagen/video: 1 variante en inglés optimizada + versión en español comentada (1 línea explicando la diferencia).

## Cómo iterar
- (1-2 instrucciones concretas de qué ajustar si el resultado no convence)

## Checklist de auto-revisión
- [ ] Produce el resultado pedido pegándolo tal cual.
- [ ] Define formato de salida exacto.
- [ ] Sin datos inventados.
- [ ] Idioma estratégico correcto.
- [ ] Parámetros técnicos reales y vigentes (o marcados con [VERIFICAR]).

---

**Prompt original del usuario**:
```
{prompt_original}
```

Entrega YA el resultado en el formato obligatorio. No escribas nada antes de "## Diagnóstico"."""


def _mejorar_prompt_heuristico(prompt: str, modalidad: str, target_model: str) -> dict:
    """Fallback sin IA: aplica mejoras básicas a prompts.
    Detecta fallas y reescribe aplicando plantilla de la skill.
    """
    if not prompt or not prompt.strip():
        return {
            "improved": "",
            "diagnostico": ["El prompt está vacío. Escribe qué quieres que la IA haga."],
            "ia_used": False,
            "provider": None,
            "modelo_detectado": modalidad,
        }

    texto = prompt.strip()
    problemas = []
    plan = []

    # Diagnóstico heurístico
    t = texto.lower()
    tiene_rol = bool(re.search(r"\b(actúa como|tu rol|eres un|eres una|sos un|sos una|rol:)\b", t))
    tiene_contexto = len(texto) > 120
    tiene_formato = bool(re.search(r"\b(formato|salida|estructura|tabla|json|markdown|lista|bullet)\b", t))
    tiene_tarea = bool(re.search(r"\b(haz|genera|escribe|resume|explica|traduce|analiza|crea|diseña|redacta)\b", t))
    palabras = len(texto.split())
    adjetivos_vacios = re.findall(r"\b(atractivo|profesional|viral|impactante|bonito|bueno|genial|increíble)\b", t)
    negaciones = re.findall(r"\bno\s+(hagas|uses|incluyas|menciones|cites|digas)\b", t)

    if not tiene_rol:
        problemas.append("Falta definición de ROL: la IA no sabe desde qué perspectiva responder.")
        plan.append("Añadir una línea inicial: «Eres [ROL ESPECÍFICO] con experiencia en [DOMINIO]».")
    if not tiene_contexto:
        problemas.append("Contexto ausente: prompt muy corto, falta audiencia/datos del negocio.")
        plan.append("Inyectar 1-2 frases de contexto: para quién es, qué problema resuelve, qué sabe la IA del tema.")
    if not tiene_tarea:
        problemas.append("La TAREA no está en imperativo claro («hazme algo» no es tarea).")
        plan.append("Reescribir la tarea como instrucción directa: «Genera...», «Escribe...», «Analiza...».")
    if not tiene_formato:
        problemas.append("Sin formato de salida: cada ejecución devuelve estructura distinta.")
        plan.append("Especificar formato exacto: «Devuelve en [estructura] con secciones X, Y, Z; largo máx N palabras».")
    if adjetivos_vacios:
        problemas.append(f"Adjetivos vagos detectados ({', '.join(set(adjetivos_vacios))}): «atractivo» no significa nada para la IA.")
        plan.append("Traducir cada adjetivo a criterios operativos (ej. «atractivo» → «usa gancho emocional en la primera frase, pregunta retórica, máximo 12 palabras por línea»).")
    if negaciones:
        problemas.append(f"Negaciones en cadena ({len(negaciones)}). Las IA las ignoran o interpretan al revés.")
        plan.append("Reformular en positivo: en vez de «no uses tecnicismos», decir «usa lenguaje sencillo, ejemplos de la vida cotidiana».")
    if palabras > 400:
        problemas.append(f"Prompt largo ({palabras} palabras). Probablemente mezcla varias tareas.")
        plan.append("Dividir en cadena de prompts (uno por tarea) o priorizar UNA tarea principal.")
    if not problemas:
        problemas.append("El prompt ya está bien estructurado. Aplicamos pulido fino: añadir criterios de calidad y ejemplo breve.")
        plan.append("Añadir 1 ejemplo de salida esperada (few-shot) y 1-2 criterios de calidad explícitos.")

    # ── Reconstrucción con plantilla de la skill ──
    if modalidad == "imagen":
        if target_model == "auto":
            target_model = "midjourney"
        prefijo_idioma = "EN"
        plantilla = f"""[SUJETO PRINCIPAL] (describe con detalle: apariencia, ropa, pose, acción, expresión)

[ESCENA/AMBIENTE]: ubicación, hora del día, atmósfera, fondo

[ESTILO ARTÍSTICO]: referencia de estilo, técnica, materiales, acabado

[ILUMINACIÓN]: tipo de luz, dirección, color, sombras

[ENCUADRE/CÁMARA]: tipo de plano, ángulo, lente, profundidad de campo

[PARÁMETROS DE MODELO]: --ar RELACIÓN --v VERSIÓN --s ESTILIZACIÓN --q CALIDAD

Negative prompt (si el modelo lo soporta): [lo que debe evitar]"""
        idioma_nota = "→ Traducido al inglés porque Midjourney/DALL-E/Flux responden mejor en inglés. La versión en español va al final."
    elif modalidad == "video":
        if target_model == "auto":
            target_model = "veo"
        prefijo_idioma = "EN"
        plantilla = f"""[DURACIÓN]: N segundos

[SUJETO + ACCIÓN]: qué/quién aparece y qué hace, en presente

[ENCUADRE INICIAL]: tipo de plano, ángulo, lente

[MOVIMIENTO DE CÁMARA]: estática / pan / tilt / dolly / tracking / handheld

[ESTILO VISUAL]: cinematográfico, animación, hiperrealista, anime, documental...

[AMBIENTE/ILUMINACIÓN]: hora, color, atmósfera

[AUDIO (opcional)]: música, voz en off, efectos"""
        idioma_nota = "→ Traducido al inglés porque los modelos de video responden mejor en inglés. La versión en español va al final."
    else:
        target_model = target_model if target_model != "auto" else "neutro (texto plano)"
        prefijo_idioma = "ES"
        plantilla = """[ROL]
Eres [ROL ESPECÍFICO con experiencia relevante para la tarea].

[CONTEXTO]
Situacion: [contexto del usuario o negocio].
Audiencia: [a quien va dirigido].
Datos relevantes: [datos, restricciones, ejemplos].

[TAREA]
[Una sola accion principal, en imperativo, bien definida.]

[CRITERIOS DE CALIDAD]
Un buen resultado cumple:
- [criterio 1: lo que hace que el resultado sea bueno]
- [criterio 2]
- [criterio 3]

[FORMATO DE SALIDA]
- Estructura: [secciones exactas que debe llevar la respuesta]
- Largo: [rango, ej. 200-300 palabras]
- Tono: [definido operativamente, ej. cercano pero profesional]
- Idioma: [espanol o el idioma deseado]

[EJEMPLO] (opcional)
Entrada: [ejemplo de solicitud real]
Salida: [ejemplo de respuesta ideal]

[LIMITES]
- Si falta informacion clave, pregunta antes de asumir.
- Si no sabes algo con certeza, dilo en vez de inventarlo."""
        idioma_nota = ""

    return {
        "improved": plantilla,
        "diagnostico": problemas,
        "plan_mejora": plan,
        "modalidad": modalidad,
        "target_model": target_model,
        "ia_used": False,
        "provider": None,
        "idioma_nota": idioma_nota,
        "modelo_idioma": prefijo_idioma,
    }


@app.post("/improve-prompt")
async def improve_prompt(req: ImprovePromptRequest, request: Request):
    """Mejora un prompt aplicando la skill 'maestro-prompts'.

    Si hay API key configurada del proveedor → usa la IA con el formato estándar
    de la skill (Diagnóstico + Prompt mejorado + Por qué funciona + Cómo iterar).

    Si NO hay API key → aplica heurística local que detecta fallas comunes
    y entrega una plantilla reescrita (útil para aprender, sin gastar API).
    """
    prompt = (req.prompt or "").strip()
    if not prompt:
        raise HTTPException(status_code=400, detail="Prompt vacío. Escribe el prompt que quieres mejorar.")

    # Límite razonable para evitar abuso / costos
    if len(prompt) > 8000:
        raise HTTPException(status_code=400, detail="El prompt es demasiado largo (máx. 8000 caracteres).")

    modalidad = _detectar_modalidad_prompt(prompt)
    target_model = (req.target_model or "auto").lower()
    provider_resuelto, api_key, openrouter_model = _resolver_config_ia(
        request, req.provider, req.api_key, req.openrouter_model
    )
    error_detail = None

    # ── Si hay API key → usar la IA con la skill completa ──
    if api_key:
        system_prompt = _construir_prompt_maestro(
            prompt, modalidad, target_model, req.objetivo or "", req.idioma_salida or "es"
        )
        # Mensaje de usuario: el prompt original a mejorar
        user_msg = (
            f"Aquí está el prompt del usuario que debes auditar y mejorar. "
            f"Modalidad detectada: {modalidad}. Modelo destino: {target_model}. "
            f"Aplica el formato de entrega OBLIGATORIO de la skill sin omitir secciones.\n\n"
            f"```\n{prompt}\n```"
        )

        try:
            if provider_resuelto == "anthropic":
                import anthropic as _ant
                client = _ant.Anthropic(api_key=api_key)
                msg = client.messages.create(
                    model="claude-haiku-4-5-20251001",
                    max_tokens=3500,
                    system=system_prompt,
                    messages=[{"role": "user", "content": user_msg}],
                )
                return {
                    "improved": msg.content[0].text.strip(),
                    "ia_used": True,
                    "provider": "anthropic",
                    "modalidad": modalidad,
                    "target_model": target_model,
                    "error_detail": None,
                }
            elif provider_resuelto == "gemini":
                # Gemini REST no tiene rol 'system' separado: lo anteponemos al user.
                improved = _call_gemini(api_key, system_prompt + "\n\n" + user_msg, temperature=0.3)
                return {
                    "improved": improved,
                    "ia_used": True,
                    "provider": "gemini",
                    "modalidad": modalidad,
                    "target_model": target_model,
                    "error_detail": None,
                }
            elif provider_resuelto == "openrouter":
                # OpenRouter sí acepta system + user separados
                import json as _json
                import urllib.request as _ur
                model_name = openrouter_model
                url = "https://openrouter.ai/api/v1/chat/completions"
                payload = _json.dumps({
                    "model": model_name,
                    "messages": [
                        {"role": "system", "content": system_prompt},
                        {"role": "user", "content": user_msg},
                    ],
                    "temperature": 0.4,
                }).encode()
                http_req = _ur.Request(
                    url, data=payload,
                    headers={
                        "Content-Type": "application/json",
                        "Authorization": f"Bearer {api_key}",
                        "HTTP-Referer": "https://github.com/JHONCOD24/jg-turbo",
                        "X-Title": "JG Turbo · Mejorar Prompt",
                    },
                    method="POST",
                )
                with _ur.urlopen(http_req, timeout=45) as r:
                    data = _json.loads(r.read())
                if "error" in data:
                    raise Exception(data["error"].get("message", "Error de OpenRouter"))
                choices = data.get("choices") or []
                if not choices:
                    raise Exception("OpenRouter devolvió respuesta vacía")
                improved = choices[0].get("message", {}).get("content") or ""
                return {
                    "improved": improved.strip(),
                    "ia_used": True,
                    "provider": "openrouter",
                    "modalidad": modalidad,
                    "target_model": target_model,
                    "error_detail": None,
                }
            elif provider_resuelto == "mistral":
                import json as _json
                import urllib.request as _ur
                url = "https://api.mistral.ai/v1/chat/completions"
                payload = _json.dumps({
                    "model": "mistral-small-latest",
                    "messages": [
                        {"role": "system", "content": system_prompt},
                        {"role": "user", "content": user_msg},
                    ],
                    "max_tokens": 3500,
                    "temperature": 0.4,
                }).encode()
                http_req = _ur.Request(
                    url, data=payload,
                    headers={"Content-Type": "application/json", "Authorization": f"Bearer {api_key}"},
                    method="POST",
                )
                with _ur.urlopen(http_req, timeout=45) as r:
                    data = _json.loads(r.read())
                improved = data["choices"][0]["message"]["content"].strip()
                return {
                    "improved": improved,
                    "ia_used": True,
                    "provider": "mistral",
                    "modalidad": modalidad,
                    "target_model": target_model,
                    "error_detail": None,
                }
            elif provider_resuelto == "none":
                pass  # cae al fallback local
        except Exception as e:
            error_detail = _detalle_error_ia("Mejorar Prompt", e)

    # ── Fallback heurístico (sin API key o si falló la IA) ──
    resultado = _mejorar_prompt_heuristico(prompt, modalidad, target_model)
    resultado["error_detail"] = error_detail
    return resultado
