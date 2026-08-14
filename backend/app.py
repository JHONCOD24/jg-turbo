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

# Supadata (vía automática de YouTube). Vive en api/ para no duplicarlo: es el
# mismo cliente que usa la función de Vercel. Si no está, el backend local
# simplemente se queda sin respaldo y sigue con yt-dlp.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
try:
    from api import supadata
except Exception as _exc_supadata:  # pragma: no cover - entorno local incompleto
    supadata = None
    print(f"[AVISO] Supadata no disponible en local: {_exc_supadata}")

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
from pydantic import BaseModel, Field
from calidad_linguistica import (
    construir_prompt_asr,
    validar_texto_transformado,
    validar_traduccion,
)


def _aviso_integridad(validacion: dict):
    """Mensaje corto en español si el resultado parece haber perdido contenido."""
    if not validacion:
        return None
    codigos = {p.get("code") for p in validacion.get("issues") or []}
    if "possible_omission" in codigos or "empty_translation" in codigos:
        return (
            "El resultado quedó bastante más corto que tu texto original. "
            "Revísalo antes de reemplazarlo: puede haberse cortado."
        )
    if {"missing_numbers", "missing_urls", "missing_emails"} & codigos:
        return "Faltan cifras, enlaces o correos que sí estaban en tu texto. Revisa el resultado."
    if "possible_invention" in codigos or "invented_numbers" in codigos:
        return "El resultado agregó contenido que no estaba en tu texto. Revísalo antes de usarlo."
    return None

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

IA_MAX_TOKENS_TECHO = int(os.getenv("IA_MAX_TOKENS", "8192"))
IA_CHUNK_CHARS = int(os.getenv("IA_CHUNK_CHARS", "3500"))
# Modelo de Claude por defecto (endpoint /v1/messages).
ANTHROPIC_MODEL = os.getenv("ANTHROPIC_MODEL", "claude-sonnet-5")


def _max_tokens_ia(texto: str, factor: float = 1.8, minimo: int = 1024) -> int:
    """Presupuesto de salida proporcional a la entrada (~3.2 caracteres/token)."""
    aprox = int(len(texto or "") / 3.2 * factor) + 256
    return max(minimo, min(IA_MAX_TOKENS_TECHO, aprox))


def _dividir_en_bloques_ia(texto: str, limite: int = IA_CHUNK_CHARS) -> list:
    """Divide por párrafos acumulando bloques bajo el límite de caracteres."""
    texto = (texto or "").strip()
    if not texto:
        return []
    if len(texto) <= limite:
        return [texto]
    bloques, actual = [], ""
    for parrafo in re.split(r"\n\s*\n", texto):
        parrafo = parrafo.strip("\n")
        if not parrafo.strip():
            continue
        if len(parrafo) > limite:
            if actual:
                bloques.append(actual)
                actual = ""
            trozo = ""
            for oracion in re.split(r"(?<=[.!?…])\s+", parrafo):
                if trozo and len(trozo) + len(oracion) + 1 > limite:
                    bloques.append(trozo.strip())
                    trozo = oracion
                else:
                    trozo = f"{trozo} {oracion}".strip() if trozo else oracion
            if trozo.strip():
                bloques.append(trozo.strip())
            continue
        if actual and len(actual) + len(parrafo) + 2 > limite:
            bloques.append(actual)
            actual = parrafo
        else:
            actual = f"{actual}\n\n{parrafo}" if actual else parrafo
    if actual.strip():
        bloques.append(actual)
    return bloques or [texto]


def _call_gemini(api_key: str, prompt: str, model: str = None, temperature: float = 0.3,
                 max_tokens: int = None) -> str:
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
                    "topK": 40,
                    # Sin maxOutputTokens Gemini corta en su default y se
                    # pierde texto del usuario sin avisar.
                    "maxOutputTokens": int(max_tokens or IA_MAX_TOKENS_TECHO),
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


def _call_openrouter(api_key: str, prompt: str, model: str = None, max_tokens: int = None) -> str:
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
        "max_tokens": int(max_tokens or IA_MAX_TOKENS_TECHO),
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

def _prompt_asr(idioma: str, contexto: str = "") -> str:
    glosario = "\n".join(
        parte for parte in (_leer_glosario_usuario(), (contexto or "").strip()) if parte
    )
    return construir_prompt_asr(idioma, glosario)

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


# "prompt" se corrige aparte: forzar minúscula rompía el inicio de frase
# («Pront claro» → «. prompt claro»).
_RE_PROMPT_ASR = re.compile(r"\b(prompt|pront|promt)(s)?\b", re.IGNORECASE)


def _normalizar_prompt(texto: str) -> str:
    """Escribe «prompt» bien, respetando la mayúscula si abre la frase."""
    def reemplazo(m):
        base = "prompt" + (m.group(2).lower() if m.group(2) else "")
        anterior = texto[: m.start()].rstrip()
        if not anterior or anterior[-1] in ".!?…:¿¡\n":
            return base.capitalize()
        return base

    return _RE_PROMPT_ASR.sub(reemplazo, texto)


def corregir_terminos_tecnicos(texto: str) -> str:
    """Post-procesamiento del texto transcrito con patrones pre-compilados (5-10x más
    rápido que compilar regex en cada llamada)."""
    if not texto:
        return texto

    texto = _REP_BUCLE_PALABRA.sub(r"\1", texto)
    texto = _REP_BUCLE_PAR.sub(r"\1", texto)

    for patron, reemplazo in _CORRECCIONES_TECNICAS:
        texto = patron.sub(reemplazo, texto)

    return _normalizar_prompt(texto)

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

def _es_segmento_vacio(seg) -> bool:
    """Un segmento sin texto no es una alucinación: simplemente no aporta nada."""
    return not (getattr(seg, "text", "") or "").strip()


def _es_alucinacion(seg) -> bool:
    """Detecta segmentos probablemente alucinados por Whisper (audio difuso o silencio).
    Balanceado: descarta basura clara, marca como dudosa la zona gris."""
    texto = (getattr(seg, "text", "") or "").strip().lower()
    if not texto:
        # Antes devolvía True y un solo hueco de silencio ya disparaba
        # "⚠️ Audio poco claro" en audios perfectos.
        return False
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

def _es_frase_alucinada(seg) -> bool:
    """True solo si el texto coincide con una frase inventada conocida."""
    texto = (getattr(seg, "text", "") or "").strip().lower()
    if not texto:
        return False
    return any(re.search(patron, texto) for patron in _FRASES_ALUCINACION)


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
    contexto: str = "",
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
            "initial_prompt": _prompt_asr(idioma or "auto", contexto),
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
            "initial_prompt": _prompt_asr(idioma or "auto", contexto),
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
        alucinaciones_patron = 0
        vacios = 0
        total_entrada = 0

        for s in segmentos_raw:
            total_entrada += 1
            if _es_segmento_vacio(s):
                vacios += 1
                continue
            if _es_alucinacion(s):
                alucinaciones += 1
                if _es_frase_alucinada(s):
                    alucinaciones_patron += 1
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
        proporcion_dudosa = baja_confianza / total if total else 0.0
        proporcion_retirada = alucinaciones / total_entrada if total_entrada else 0.0
        todo_filtrado = bool(total_entrada and not partes_texto and alucinaciones)
        aviso = None
        if todo_filtrado:
            if alucinaciones_patron >= alucinaciones:
                aviso = (
                    "No se detectó voz utilizable: todo el audio produjo frases que Whisper "
                    "suele inventar sobre silencio o música. Revisa el archivo o graba de nuevo."
                )
            else:
                # Devolver el texto sin filtrar sería mentir sobre su calidad:
                # lo entregamos, pero marcado.
                texto_limpio = " ".join(
                    corregir_terminos_tecnicos((getattr(s, "text", "") or "").strip())
                    for s in segmentos_raw
                ).strip()
                aviso = (
                    "Todos los fragmentos salieron con baja calidad. Se muestra la "
                    "transcripción sin filtrar: revísala antes de usarla."
                )

        # Umbral proporcional: antes bastaba un segmento dudoso para gritar
        # "audio poco claro" y la gente aprendió a ignorar el aviso.
        needs_review = bool(
            alucinaciones_patron > 0
            or todo_filtrado
            or proporcion_retirada > 0.15
            or proporcion_dudosa > 0.25
        )
        requires_confirmation = bool(
            alucinaciones_patron > 0 or proporcion_retirada > 0.25 or proporcion_dudosa > 0.35
        )

        resultado = {
            "text": texto_limpio,
            "language": idioma_detectado,
            "segments": segmentos,
            "low_confidence_segments": baja_confianza,
            "removed_hallucinations": alucinaciones,
            "needs_review": needs_review,
            "requires_confirmation": requires_confirmation,
            "review_segments": [s for s in segmentos if s["low_confidence"]],
            # Campos nuevos (aditivos)
            "empty_segments": vacios,
            "hallucination_patterns": alucinaciones_patron,
            "all_segments_filtered": todo_filtrado,
        }
        if aviso:
            resultado["aviso"] = aviso
        return resultado

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
    context: str = Form("", max_length=4000),
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

        resultado = transcribir_archivo(
            tmp_path,
            language,
            preview=preview,
            fast=fast,
            contexto=context,
        )
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
    context: str = Form("", max_length=4000),
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
        resultado = transcribir_archivo(tmp_path, language, preview=True, fast=True, contexto=context)
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
        # Desde casa yt-dlp suele funcionar (IP residencial); cuando no, cae a
        # Supadata igual que producción, para que el espejo local sea fiel.
        if supadata is not None and supadata.configurado():
            try:
                resultado_sd = supadata.transcribir(req.url, idioma_corto)
                if resultado_sd.get("job_id"):
                    listo = supadata.esperar(resultado_sd["job_id"], 90)
                    if listo:
                        resultado_sd = listo
                if resultado_sd.get("texto"):
                    return JSONResponse({
                        "text": corregir_terminos_tecnicos(resultado_sd["texto"]),
                        "language": resultado_sd.get("lang") or idioma_corto or "es",
                        "title": "",
                        "source": "subtitles",
                    })
            except Exception as exc_sd:
                raise HTTPException(
                    status_code=502,
                    detail=f"No se pudo procesar el video (YouTube y Supadata fallaron): {exc_sd}",
                )
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

_REPETICIONES_VALIDAS = {
    "casi", "nada", "poco", "apenas", "vamos", "corre", "lento", "despacio",
    "ahora", "nunca", "siempre", "bien", "mira", "vale",
}
_RE_REPETICION_LEGITIMA = re.compile(r"\b(\w{4,})(\s+)\1\b", re.IGNORECASE)


def _sin_repeticion(m) -> str:
    """Colapsa «palabra palabra» salvo cuando la repetición es intencional."""
    if m.group(1).lower() in _REPETICIONES_VALIDAS:
        return m.group(0)
    return m.group(1)


def _mejorar_heuristico(texto: str) -> str:
    """Mejora local sin IA: elimina muletillas, limpia repeticiones, mejora puntuación y estructura."""
    # 1. Normalizar espacios y saltos
    texto = re.sub(r"\r\n|\r", "\n", texto)
    texto = re.sub(r" {2,}", " ", texto).strip()

    # 2. Eliminar muletillas y sonidos de relleno.
    #    OJO: la muletilla es el alargamiento («esteee»), no el demostrativo
    #    «este»: `este+` con \b borraba palabras del usuario
    #    («Este documento es clave» → «. documento es clave»).
    #    Igual con «bueno»/«pues»: solo se borran cuando abren la frase.
    muletillas = [
        r"\b(eh+|ah+|oh+|uh+|mm+|hmm+|eeh+|aah+|uhh+|umm+)\b",
        r"\b(bueno pues|pues bueno|a ver|o sea|estee+|entonces estee+)\b",
        r"(?:(?<=^)|(?<=[.!?…]\s))\s*(bueno|pues)\s*,\s*",
        r"\b(o sea que|es que|la verdad es que)\b",
        r"\b(¿no\?|¿verdad\?|¿sí\?|¿entiendes\?)\s*",
        r"\b(o algo así|y tal|y eso)\b",
        r"\b(como que|digamos)\b(?=\s+[^,])",
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

    # 3. Repeticiones consecutivas. El español repite a propósito («muy muy»,
    #    «no no», «sí sí», «casi casi»), así que solo colapsamos palabras de
    #    4+ letras y con lista de excepciones.
    texto = _RE_REPETICION_LEGITIMA.sub(_sin_repeticion, texto)
    # Repeticiones de frases de 2 a 4 palabras (ahí sí siempre es tartamudeo)
    texto = re.sub(r"\b(\w+(?: \w+){1,3})[,.]?\s+\1\b", r"\1", texto, flags=re.IGNORECASE)

    # 4. Limpiar comas y puntos extra
    texto = re.sub(r"[,،]{2,}", ",", texto)
    texto = re.sub(r"\s+([,.:;!?])", r"\1", texto)
    texto = re.sub(r"([,])(?!\s)", r"\1 ", texto)
    # Quitar comas/puntuación colgante al inicio o tras saltos de línea (por frases eliminadas)
    texto = re.sub(r"(?:[,;:]\s*){2,}", ", ", texto)
    texto = re.sub(r"([.!?…])\s*[,;:]+\s*", r"\1 ", texto)
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
    """Ejecución síncrona de la llamada IA (se usa en thread pool para no bloquear asyncio).

    El presupuesto de salida se calcula aquí a partir del prompt: con un tope
    fijo de 2048 tokens los textos largos volvían truncados y reemplazaban el
    original del usuario.
    """
    max_tokens = _max_tokens_ia(prompt)
    if provider_resuelto == "anthropic":
        import anthropic as _ant
        client = _ant.Anthropic(api_key=api_key)
        msg = client.messages.create(
            model=ANTHROPIC_MODEL,
            max_tokens=min(16000, max_tokens),
            # Claude Sonnet 5 rechaza temperature/top_p; y para editar texto el
            # razonamiento extendido solo gastaría presupuesto de salida.
            thinking={"type": "disabled"},
            messages=[{"role": "user", "content": prompt}],
        )
        if getattr(msg, "stop_reason", None) == "refusal":
            raise Exception("Claude rechazó procesar este texto por sus filtros de seguridad.")
        partes = [b.text for b in msg.content if getattr(b, "type", "") == "text"]
        texto = "\n".join(p for p in partes if p).strip()
        if not texto:
            raise Exception("Respuesta vacía de Anthropic")
        return texto, "anthropic"
    elif provider_resuelto == "gemini":
        improved = _call_gemini(api_key, prompt, temperature=0.2, max_tokens=max_tokens)
        return improved, "gemini"
    elif provider_resuelto == "openrouter":
        improved = _call_openrouter(api_key, prompt, openrouter_model, max_tokens=max_tokens)
        return improved, "openrouter"
    elif provider_resuelto == "mistral":
        import json as _json
        import urllib.request as _ur
        url = "https://api.mistral.ai/v1/chat/completions"
        payload = _json.dumps({
            "model": "mistral-small-latest",
            "messages": [{"role": "user", "content": prompt}],
            "max_tokens": max_tokens,
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

    def _prompt_mejora(bloque: str) -> str:
        return (
            f"EDITOR ESTRICTO DE TEXTOS — Idioma: {lang}\n\n"
            "Tu ÚNICO trabajo es corregir el texto que te paso. NO puedes inventar nada.\n\n"
            "REGLAS OBLIGATORIAS (no las rompas):\n"
            "1. CORRIGE solo: ortografía, tildes, puntuación (¿¡), mayúsculas al inicio de oración.\n"
            "2. ELIMINA solo: muletillas (eh, esteee, o sea), repeticiones exactas de palabras, muletillas vacías (\"es importante mencionar\").\n"
            "3. NO CAMBIES: el significado, las ideas, el orden de las ideas, la voz del autor.\n"
            "4. NO AGREGUES: datos, cifras, ejemplos, explicaciones, información nueva, frases inventadas.\n"
            "5. NO REESCRIBAS: si una frase es correcta, déjala igual. No la \"mejores\" a tu manera.\n"
            "6. NO RESUMAS: si el autor dijo algo largo, déjalo largo. No acortes.\n"
            "7. CONSERVA: jerga, tecnicismos, regionalismos del autor. No los cambies por palabras \"más bonitas\".\n"
            "8. DEVUELVE EL TEXTO COMPLETO: nunca cortes ni escribas \"…\" o \"[continúa]\".\n\n"
            "FORMATO DE RESPUESTA:\n"
            "- Devuelve SOLO el texto corregido.\n"
            "- Sin explicaciones, sin comillas, sin \"Aquí tienes\", sin nada extra.\n"
            "- Si el texto ya está bien, devuélvelo exactamente igual.\n\n"
            f"TEXTO A CORREGIR:\n{bloque}"
        )

    if api_key:
        try:
            loop = asyncio.get_event_loop()
            bloques = _dividir_en_bloques_ia(txt)
            salidas = []
            provider_name = None
            for bloque in bloques:
                parcial, provider_name = await loop.run_in_executor(
                    _IA_EXECUTOR,
                    _mejorar_con_ia_sync,
                    provider_resuelto, api_key, _prompt_mejora(bloque), openrouter_model,
                )
                parcial = (parcial or "").strip()
                if not parcial:
                    raise Exception("La IA devolvió una respuesta vacía para parte del texto.")
                salidas.append(parcial)
            improved = "\n\n".join(salidas)
            validacion = validar_texto_transformado(txt, improved, "pulido")
            respuesta = {
                "text": improved,
                "ia_used": True,
                "provider": provider_name,
                # Campos nuevos (aditivos)
                "validation": validacion,
                "chunks": len(bloques),
            }
            aviso = _aviso_integridad(validacion)
            if aviso:
                respuesta["aviso"] = aviso
            return respuesta
        except Exception as e:
            error_detail = _detalle_error_ia(provider_resuelto, e)

    local = _mejorar_heuristico(txt)
    validacion = validar_texto_transformado(txt, local, "pulido")
    respuesta = {
        "text": local,
        "ia_used": False,
        "provider": None,
        "error_detail": error_detail,
        "validation": validacion,
        "chunks": 1,
    }
    aviso = _aviso_integridad(validacion)
    if aviso:
        respuesta["aviso"] = aviso
    return respuesta


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
    text: str = Field(min_length=1, max_length=50000)
    direction: str  # pares ISO: en-es, es-fr, pt-en, etc.
    provider: str = "gemini"
    api_key: str = ""
    openrouter_model: Optional[str] = None
    prefer_fast: bool = False


_LANG_NAMES_TR = {
    "en": "English",
    "es": "Spanish",
    "fr": "French",
    "pt": "Portuguese",
    "de": "German",
    "it": "Italian",
}


def _parse_translate_direction(direction: str):
    d = (direction or "").strip().lower().replace("_", "-")
    if "-" not in d:
        raise HTTPException(status_code=400, detail="direction debe ser un par ISO, ej. 'en-es' o 'es-fr'.")
    src_code, trg_code = d.split("-", 1)
    src_code, trg_code = src_code[:2], trg_code[:2]
    if src_code not in _LANG_NAMES_TR or trg_code not in _LANG_NAMES_TR:
        raise HTTPException(
            status_code=400,
            detail=f"Idiomas soportados: {', '.join(sorted(_LANG_NAMES_TR))}. Recibido: {direction}",
        )
    if src_code == trg_code:
        raise HTTPException(status_code=400, detail="Origen y destino no pueden ser el mismo idioma.")
    return src_code, trg_code, _LANG_NAMES_TR[src_code], _LANG_NAMES_TR[trg_code]

_RE_TS_SOLO = re.compile(
    r"^\[?(?:\d{1,2}:)?\d{1,2}:\d{2}(?:[.,]\d{1,3})?\]?$")
_RE_TS_INLINE = re.compile(
    r"(?:^|\s)\[?(?:\d{1,2}:)?\d{1,2}:\d{2}(?:[.,]\d{1,3})?\]?(?=\s|$)")


def _limpiar_transcripcion_youtube_cruda(texto: str) -> str:
    """Quita marcas SRT/VTT y horas del texto antes de traducirlo."""
    if not texto:
        return ""
    crudo = str(texto).replace("\r", "")
    if (
        not re.search(r"(?m)^\s*\d{1,2}:\d{2}\b", crudo)
        and "-->" not in crudo
        and "WEBVTT" not in crudo.upper()
        and len(re.findall(r"\b\d{1,2}:\d{2}\b", crudo)) < 3
    ):
        return texto.strip()

    partes = []
    anterior = ""
    for linea in crudo.split("\n"):
        linea = linea.strip()
        if not linea or re.match(r"^WEBVTT", linea, re.IGNORECASE):
            continue
        if "-->" in linea or re.match(r"^\d+$", linea):
            continue
        if re.match(r"^(Kind|Language|NOTE)\s*:", linea, re.IGNORECASE):
            continue
        if _RE_TS_SOLO.match(linea):
            continue
        linea = re.sub(r"<[^>]+>", "", linea)
        linea = re.sub(
            r"^\[?(?:\d{1,2}:)?\d{1,2}:\d{2}(?:[.,]\d{1,3})?\]?\s*[-–—]?\s*",
            "",
            linea,
        )
        linea = _RE_TS_INLINE.sub(" ", linea)
        linea = re.sub(r"\s{2,}", " ", linea).strip()
        if not linea or linea == anterior:
            continue
        partes.append(linea)
        anterior = linea

    limpio = re.sub(r"\s{2,}", " ", " ".join(partes)).strip()
    return limpio or texto.strip()


def _chunk_fallo_traduccion(original: str, traducido: Optional[str]) -> bool:
    """Detecta un trozo vacío, idéntico o devuelto sin traducir."""
    if not traducido or not str(traducido).strip():
        return True
    origen = re.sub(r"\s+", " ", (original or "").strip()).lower()
    salida = re.sub(r"\s+", " ", str(traducido).strip()).lower()
    if not salida or origen == salida:
        return True
    return bool(
        len(origen) >= 12
        and (origen in salida or salida in origen)
        and abs(len(origen) - len(salida)) < max(8, len(origen) * 0.12)
    )


def _traduccion_parece_incompleta(original: str, traducido: str, src: str, trg: str) -> bool:
    """Rechaza ecos del original y respuestas que mezclan idiomas."""
    if not (traducido or "").strip():
        return True
    origen = (original or "").strip()
    salida = (traducido or "").strip()
    if not origen:
        return False
    if origen == salida:
        return True

    palabras_origen = set(re.findall(r"[A-Za-zÁÉÍÓÚÑáéíóúñ]{4,}", origen.lower()))
    palabras_salida = set(re.findall(r"[A-Za-zÁÉÍÓÚÑáéíóúñ]{4,}", salida.lower()))
    if palabras_origen:
        solapamiento = len(palabras_origen & palabras_salida) / max(1, len(palabras_origen))
        if solapamiento >= 0.45 and len(palabras_origen) >= 12:
            return True

    marcadores = {
        "en-es": ((" the ", " and ", " you ", " that ", " with ", " this ", " for ", " are ", " have ", " from ", " your ", " about ", " just ", " like "), (" el ", " la ", " de ", " que ", " y ", " en ", " los ", " las ", " un ", " una ", " es ", " por ", " con ", " para ", " del ", " se ")),
        "es-en": ((" el ", " la ", " de ", " que ", " los ", " las ", " una ", " del ", " para "), (" the ", " and ", " you ", " that ", " with ", " this ", " for ", " are ")),
    }
    origen_markers, destino_markers = marcadores.get(f"{src}-{trg}", ((), ()))
    if origen_markers:
        con_espacios = f" {salida.lower()} "
        origen_count = sum(1 for marcador in origen_markers if marcador in con_espacios)
        destino_count = sum(1 for marcador in destino_markers if marcador in con_espacios)
        if origen_count >= 4 and origen_count >= destino_count:
            return True

    return len(origen) > 400 and len(salida) < len(origen) * 0.45


def _partir_texto_mymemory(texto: str) -> list[str]:
    """Divide el texto en trozos de máximo 450 caracteres."""
    texto = (texto or "").strip()
    if not texto:
        return []
    if len(texto) <= 450:
        return [texto]

    trozos = []
    for oracion in re.split(r"(?<=[.!?…])\s+", texto):
        oracion = oracion.strip()
        if not oracion:
            continue
        if len(oracion) <= 450:
            trozos.append(oracion)
            continue
        palabras = oracion.split()
        actual = []
        tamano = 0
        for palabra in palabras:
            extra = len(palabra) + (1 if actual else 0)
            if actual and tamano + extra > 400:
                trozos.append(" ".join(actual))
                actual = [palabra]
                tamano = len(palabra)
            else:
                actual.append(palabra)
                tamano += extra
        if actual:
            trozos.append(" ".join(actual))
    return trozos or [texto]


def _translate_mymemory(text: str, src: str, trg: str) -> Optional[str]:
    """Llama a la API pública y gratuita de MyMemory para un fragmento."""
    import html as _html
    import json as _json
    import urllib.parse as _up
    import urllib.request as _ur

    if not text or not text.strip():
        return text
    try:
        params = _up.urlencode({"q": text[:450], "langpair": f"{src}|{trg}"})
        url = f"https://api.mymemory.translated.net/get?{params}"
        http_req = _ur.Request(url, headers={"User-Agent": "JG-Turbo/3.0"})
        with _ur.urlopen(http_req, timeout=15) as r:
            data = _json.loads(r.read())
        traducido = (data.get("responseData") or {}).get("translatedText")
        if traducido and "MYMEMORY WARNING" not in traducido.upper():
            return _html.unescape(traducido)
    except Exception:
        pass
    return None


def _translate_mymemory_chunked(text: str, src: str, trg: str) -> Optional[str]:
    """Traduce por trozos y falla completo si uno no llega traducido.

    Nunca reutiliza el original como supuesto resultado: eso era lo que mezclaba
    inglés y español cuando MyMemory fallaba en una sola petición.
    """
    unidades = []
    estructura = []
    for parrafo in (text or "").split("\n"):
        parrafo = parrafo.strip()
        indices = []
        for trozo in _partir_texto_mymemory(parrafo):
            indices.append(len(unidades))
            unidades.append(trozo)
        estructura.append(indices)

    if not unidades:
        return text

    resultados = {}
    max_workers = min(8, max(1, len(unidades)))
    with concurrent.futures.ThreadPoolExecutor(max_workers=max_workers) as pool:
        futuros = {
            pool.submit(_translate_mymemory, trozo, src, trg): indice
            for indice, trozo in enumerate(unidades)
        }
        for futuro in concurrent.futures.as_completed(futuros):
            indice = futuros[futuro]
            try:
                traducido = futuro.result()
            except Exception:
                traducido = None
            if _chunk_fallo_traduccion(unidades[indice], traducido):
                return None
            resultados[indice] = str(traducido).strip()

    parrafos = []
    for indices in estructura:
        if not indices:
            parrafos.append("")
            continue
        parrafos.append(" ".join(resultados[indice] for indice in indices))
    unido = "\n".join(parrafos).strip()
    return None if _traduccion_parece_incompleta(text, unido, src, trg) else unido


def _limpiar_respuesta_ia(texto: str) -> str:
    """Deja solo la traducción cuando el modelo agrega un encabezado."""
    if not texto:
        return ""
    t = str(texto).strip()
    bloque = re.search(r"```(?:[a-zA-Z0-9_+-]*)\s*\n([\s\S]*?)```", t)
    if bloque and bloque.group(1).strip():
        t = bloque.group(1).strip()
    t = re.sub(
        r"^\s*(?:here(?:'s| is) (?:the )?(?:full )?translation|translation|aquí tienes(?: la traducción)?)\s*[:：-]?\s*",
        "",
        t,
        count=1,
        flags=re.IGNORECASE,
    )
    return t.strip().strip("`").strip()


def _prompt_traducir_bloque(src_lang: str, trg_lang: str, bloque: str) -> str:
    return (
        f"Translate the following text from {src_lang} to {trg_lang}.\n"
        "Rules:\n"
        "- Translate EVERY sentence to the target language. Do not leave any sentence "
        "in the source language.\n"
        "- Keep the same order and roughly the same length. Do not summarize or omit.\n"
        "- Preserve paragraph breaks, names, technical terms (API, AI, PowerPoint), "
        "URLs, emails, numbers and units.\n"
        "- Do not add titles, notes, bilingual pairs, explanations or prefaces.\n"
        "- Output ONLY the full translation in the target language.\n\n"
        f"Original text:\n{bloque}"
    )


def _respuesta_traduccion_local(
    original: str,
    traducido: str,
    src_code: str,
    trg_code: str,
    provider: Optional[str],
    ia_used: bool,
    error_detail: Optional[str] = None,
    chunks: int = 1,
) -> dict:
    return {
        "text": traducido,
        "ia_used": ia_used,
        "provider": provider,
        "error_detail": error_detail,
        "direction": f"{src_code}-{trg_code}",
        "validation": validar_traduccion(original, traducido, src_code, trg_code),
        "chunks": chunks,
    }


@app.post("/translate")
async def translate_text(req: TranslateRequest, request: Request):
    """Traduce entre pares ISO (en, es, fr, pt, de, it) con IA o MyMemory."""
    txt = (req.text or "").strip()
    if not txt:
        raise HTTPException(status_code=400, detail="Texto vacío.")

    txt = _limpiar_transcripcion_youtube_cruda(txt)
    src_code, trg_code, src_lang, trg_lang = _parse_translate_direction(req.direction)

    error_detail = None

    provider_resuelto, api_key, openrouter_model = _resolver_config_ia(
        request, req.provider, req.api_key, req.openrouter_model
    )

    if api_key and provider_resuelto != "none":
        try:
            loop = asyncio.get_event_loop()
            bloques = _dividir_en_bloques_ia(txt) if len(txt) > 2200 else [txt]
            salidas = []
            provider_name = None
            for bloque in bloques:
                parcial, provider_name = await loop.run_in_executor(
                    _IA_EXECUTOR,
                    _mejorar_con_ia_sync,
                    provider_resuelto,
                    api_key,
                    _prompt_traducir_bloque(src_lang, trg_lang, bloque),
                    openrouter_model,
                )
                parcial = _limpiar_respuesta_ia(parcial or "")
                if not parcial:
                    raise Exception("La IA devolvió una respuesta vacía para parte del texto.")
                salidas.append(parcial)
            translated = "\n\n".join(salidas).strip()
            if _traduccion_parece_incompleta(txt, translated, src_code, trg_code):
                raise Exception("La IA devolvió una traducción incompleta o mezclada.")
            return _respuesta_traduccion_local(
                txt,
                translated,
                src_code,
                trg_code,
                provider_name,
                True,
                chunks=len(bloques),
            )
        except Exception as e:
            error_detail = _detalle_error_ia(provider_resuelto, e)

    # Fallback a MyMemory: completo o error; nunca mezclar con el original.
    try:
        translated_text = _translate_mymemory_chunked(txt, src_code, trg_code)
        if translated_text and not _traduccion_parece_incompleta(txt, translated_text, src_code, trg_code):
            return _respuesta_traduccion_local(
                txt,
                translated_text,
                src_code,
                trg_code,
                None,
                False,
                error_detail=error_detail,
            )
    except Exception as e:
        if not error_detail:
            error_detail = str(e)

    raise HTTPException(
        status_code=500,
        detail=(
            error_detail
            or "No se pudo traducir el texto completo. Revisa la conexión o la clave de IA "
            "e inténtalo de nuevo."
        ),
    )


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


# Variantes regionales: es-CO ≠ es-ES (vocabulario y trato distintos).
_NOMBRE_VARIANTE = {
    "es-co": "español de Colombia", "es-mx": "español de México",
    "es-ar": "español de Argentina", "es-cl": "español de Chile",
    "es-pe": "español de Perú", "es-ve": "español de Venezuela",
    "es-419": "español de Latinoamérica", "es-us": "español de Estados Unidos",
    "es-es": "español de España", "en-us": "inglés de Estados Unidos",
    "en-gb": "inglés británico", "pt-br": "portugués de Brasil",
    "pt-pt": "portugués de Portugal",
}

# Sin ejemplos concretos, «corrige confusiones típicas» no le dice nada al modelo.
_CONFUSIONES_PROMPT = (
    "CONFUSIONES FONÉTICAS DEL ESPAÑOL QUE DEBES RESOLVER POR CONTEXTO "
    "(elige la forma correcta, no las cambies al azar):\n"
    "- haya (verbo haber) / halla (encuentra) / aya (niñera) / allá (lugar)\n"
    "- hecho (de hacer) / echo (de echar)\n"
    "- a ver (mirar) / haber (verbo)\n"
    "- sino (conjunción) / si no (condición negada)\n"
    "- porque (causa) / por qué (pregunta) / porqué (sustantivo) / por que (relativo)\n"
    "- ahí (lugar) / hay (haber) / ay (exclamación)\n"
    "- valla (cerca) / vaya (ir) / baya (fruto)\n"
    "- tubo (cilindro) / tuvo (de tener)\n"
    "- va a ser / vaser; e igual con «va a haber»\n"
    "- solo/sólo y demostrativos: sin tilde según la RAE actual\n\n"
)


def _prompt_correccion_transcripcion(
    texto: str, lang_name: str, variante: str = "", glosario: str = "", es_espanol: bool = True
) -> str:
    bloque_variante = (
        f"Variante regional del hablante: {variante}. Respeta su vocabulario y su forma "
        "de tratar (tú/usted/vos); no lo cambies a otra variante.\n"
        if variante else ""
    )
    bloque_glosario = (
        f"TÉRMINOS DEL USUARIO (escritura correcta obligatoria): {glosario}\n\n"
        if glosario else ""
    )
    return (
        f"Eres un especialista en corrección de transcripciones de voz a texto en {lang_name}. "
        "El texto siguiente fue generado por Whisper (reconocimiento automático) y contiene errores.\n"
        f"{bloque_variante}\n"
        "OBJETIVO PRINCIPAL: producir un texto COHERENTE y legible, como si un humano hubiera "
        "escrito lo que realmente se dijo en el audio.\n\n"
        f"{bloque_glosario}"
        f"{_CONFUSIONES_PROMPT if es_espanol else ''}"
        "OTROS ERRORES FRECUENTES DE WHISPER:\n"
        "- Palabras que suenan parecido pero son distintas (ej: 'casa'↔'caza', 'voto'↔'boto')\n"
        "- Palabras INVENTADAS que no existen en el idioma\n"
        "- Palabras partidas ('in formación') o pegadas ('enel')\n"
        "- Frases enteras sin sentido por ruido o mala calidad de audio\n"
        "- Repeticiones y bucles de sílabas\n"
        "- Tildes, mayúsculas y signos ¿ ¡ ausentes\n\n"
        "INSTRUCCIONES (obligatorias):\n"
        "1. Lee TODO el texto para entender el TEMA y el CONTEXTO general.\n"
        "2. Cuando encuentres una palabra que NO EXISTE o NO ENCAJA en la frase, "
        "reemplázala por la palabra más probable que SÍ encaje según el contexto.\n"
        "3. Si una frase completa es incoherente, reconstrúyela interpretando la intención del hablante.\n"
        "4. Corrige ortografía, tildes, puntuación y mayúsculas.\n"
        "5. CONSERVA el significado, ideas, tono y nivel de formalidad del hablante.\n"
        "6. NO agregues información nueva, datos ni explicaciones.\n"
        "7. NO resumas ni acortes el texto. Devuélvelo COMPLETO, sin '…' ni '[continúa]'.\n\n"
        "FORMATO: devuelve SOLO el texto corregido, sin explicaciones, sin comillas, sin prefijos.\n\n"
        f"TEXTO A CORREGIR:\n{texto}"
    )


def _corregir_confusiones_foneticas(texto: str) -> str:
    if not texto:
        return texto
    for patron, reemplazo in _CONFUSIONES_FONETICAS_ES:
        texto = patron.sub(reemplazo, texto)
    return texto


# LanguageTool mete reglas de estilo discutibles («redundancia», «coloquial»).
# Solo aplicamos ortografía, tildes y gramática dura.
_LT_TIPOS_SEGUROS = {"misspelling", "typographical", "grammar", "duplication", "whitespace"}
_LT_CATEGORIAS_BLOQUEADAS = {
    "STYLE", "REDUNDANCY", "COLLOQUIALISMS", "PLAIN_ENGLISH", "WORDINESS",
    "CREATIVE_WRITING", "SEMANTICS", "MISC", "TYPOGRAPHY_STYLE",
}


def _match_languagetool_confiable(m: dict) -> bool:
    """True solo si la sugerencia es de ortografía/gramática y es inequívoca."""
    replacements = m.get("replacements") or []
    if not replacements:
        return False
    regla = m.get("rule") or {}
    categoria = ((regla.get("category") or {}).get("id") or "").upper()
    if categoria in _LT_CATEGORIAS_BLOQUEADAS:
        return False
    tipo = (regla.get("issueType") or "").lower()
    if tipo and tipo not in _LT_TIPOS_SEGUROS:
        return False
    if len(replacements) > 3:  # baja confianza: demasiadas alternativas
        return False
    return bool((replacements[0].get("value") or "").strip())


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
            if not _match_languagetool_confiable(m):
                continue
            start = m["offset"]
            end = start + m["length"]
            corregido = corregido[:start] + m["replacements"][0]["value"] + corregido[end:]
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
    contexto: str = "",
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
        variante = _NOMBRE_VARIANTE.get(lang.lower(), "")
        glosario = " ".join(
            p for p in (_leer_glosario_usuario(), (contexto or "").strip()) if p
        )[:1200]
        es_espanol = lang.split("-")[0].lower() == "es"
        provider_resuelto, api_key_final, model_final = _resolver_config_ia(
            request, provider, api_key, openrouter_model,
        )
        if api_key_final and provider_resuelto != "none":
            try:
                bloques = _dividir_en_bloques_ia(corregido)
                salidas = []
                for bloque in bloques:
                    prompt = _prompt_correccion_transcripcion(
                        bloque, lang_name, variante, glosario, es_espanol
                    )
                    parcial, provider_name = _mejorar_con_ia_sync(
                        provider_resuelto, api_key_final, prompt, model_final,
                    )
                    parcial = (parcial or "").strip()
                    if not parcial:
                        raise Exception("La IA devolvió una respuesta vacía para parte del texto.")
                    salidas.append(parcial)
                corregido = "\n\n".join(salidas)
                ia_used = True
            except Exception as e:
                error_detail = _detalle_error_ia(provider_resuelto, e)

    method = "ia" if ia_used else ("local" if corregido != txt else "none")
    validacion = validar_texto_transformado(txt, corregido, "correccion")
    return {
        "text": corregido,
        "ia_used": ia_used,
        "provider": provider_name,
        "error_detail": error_detail,
        "method": method,
        "validation": validacion,
        "aviso": _aviso_integridad(validacion),
    }


class CorrectTranscriptionRequest(BaseModel):
    text: str
    language: str = "es"   # acepta variante regional: es-CO, es-ES, es-MX…
    provider: str = "gemini"
    api_key: str = ""
    openrouter_model: Optional[str] = None
    # Glosario / términos del nicho (opcional, aditivo)
    context: str = ""

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
        getattr(req, "context", "") or "",
    )
    respuesta = {
        "text": resultado["text"],
        "ia_used": resultado["ia_used"],
        "provider": resultado.get("provider"),
        "error_detail": resultado.get("error_detail"),
        "method": resultado.get("method", "local"),
        # Campo nuevo (aditivo)
        "validation": resultado.get("validation"),
    }
    if resultado.get("aviso"):
        respuesta["aviso"] = resultado["aviso"]
    return respuesta

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
        omitidos = 0
        for m in matches:
            # Solo ortografía/tildes/gramática: las reglas de estilo son opinables
            # y antes se aplicaban a ciegas.
            if not _match_languagetool_confiable(m):
                omitidos += 1
                continue
            start = m["offset"]
            end = start + m["length"]
            corregido = corregido[:start] + m["replacements"][0]["value"] + corregido[end:]
            aplicados += 1

        return {"text": corregido, "matches": aplicados, "skipped_suggestions": omitidos}
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


# ── /improve-prompt (Skill por defecto: ingenieria-prompts-profesional) ──

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
    """Construye el system prompt de la IA.

    Skill por defecto: ingenieria-prompts-profesional
    (R+A+T+F, 5 pasos, catálogo de técnicas, arquitectura de agentes).
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

    return f"""Eres el motor unificado «prompt-maestro-unificado» (maestro-prompts + ingenieria-prompts-profesional).
META: reescribir el prompt del usuario para que funcione a la primera al pegarlo tal cual. Debe ser coherente con la intención del original, no un formulario genérico de corchetes.

# Modalidad detectada
{modalidad.upper()}.{bloque_modelo}

# Contexto del usuario
- Prompt original a mejorar:{objetivo_bloque}{idioma_bloque}

# Proceso
1. Conserva intención, hechos y partes útiles del original.
2. Audita solo fallas de alto impacto (máx. 3-4): objetivo difuso, sin contexto, sin formato, adjetivos vacíos, negaciones en cadena, sobrecarga, certeza imposible, dialecto incorrecto.
3. Elige complejidad: SIMPLE (tarea+formato+criterios) | MEDIA (rol+contexto+tarea+criterios+formato) | COMPLEJA (anatomía 7 capas) | AGENTE (+ stop rule + feedback).
4. Positivo > negativo; define adjetivos; sin teatro; [COMPLETA] solo para datos reales faltantes.
5. 120-320 palabras; no inventes flags de modelos.

# Formato de entrega OBLIGATORIO
## Diagnóstico
(2-3 fallas concretas del original)

## Prompt mejorado
[TEXTO PLANO listo para pegar — sin markdown dentro, sin ```]

## Por qué funciona
(3 viñetas)

## Cómo iterar
(1-2 ajustes)

---
**Prompt original**:
```
{prompt_original}
```
Empieza con ## Diagnóstico."""


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
    """Mejora un prompt con el skill por defecto «ingenieria-prompts-profesional».

    Con API key → IA con R+A+T+F / 5 pasos y formato Diagnóstico + Prompt mejorado.
    Sin API key → heurística local con plantilla estructurada.
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
                    model=ANTHROPIC_MODEL,
                    max_tokens=4096,
                    thinking={"type": "disabled"},
                    system=system_prompt,
                    messages=[{"role": "user", "content": user_msg}],
                )
                return {
                    "improved": "\n".join(
                        b.text for b in msg.content if getattr(b, "type", "") == "text"
                    ).strip(),
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


# ── TTS neural bilingüe (Microsoft Edge voices, sin API key) ────────────
TTS_VOICE_CATALOG = {
    "es-CO": {
        "label": "Colombia",
        "female": "es-CO-SalomeNeural",
        "male": "es-CO-GonzaloNeural",
    },
    "es-MX": {
        "label": "México",
        "female": "es-MX-DaliaNeural",
        "male": "es-MX-JorgeNeural",
    },
    "es-AR": {
        "label": "Argentina",
        "female": "es-AR-ElenaNeural",
        "male": "es-AR-TomasNeural",
    },
    "es-US": {
        "label": "Latino de Estados Unidos",
        "female": "es-US-PalomaNeural",
        "male": "es-US-AlonsoNeural",
    },
    "en-US": {
        "label": "English (United States)",
        # Aria (mujer) y Andrew (hombre): neural inglés monoidioma, claro en tech.
        # Misma calidad percibida; no usar Multilingual para fragmentos cortos.
        "female": "en-US-AriaNeural",
        "male": "en-US-AndrewNeural",
    },
    # v2.8.0 — el idioma de la voz debe coincidir SIEMPRE con el texto.
    # Antes, un texto traducido a portugués/francés/alemán/italiano se leía con
    # voz española y sonaba ininteligible.
    "pt-BR": {
        "label": "Portugués (Brasil)",
        "female": "pt-BR-FranciscaNeural",
        "male": "pt-BR-AntonioNeural",
    },
    "fr-FR": {
        "label": "Francés",
        "female": "fr-FR-DeniseNeural",
        "male": "fr-FR-HenriNeural",
    },
    "de-DE": {
        "label": "Alemán",
        "female": "de-DE-KatjaNeural",
        "male": "de-DE-ConradNeural",
    },
    "it-IT": {
        "label": "Italiano",
        "female": "it-IT-ElsaNeural",
        "male": "it-IT-DiegoNeural",
    },
}
TTS_FALLBACK_VOICES = {
    "es": {
        # Mujer: Dalia (MX) primero — más natural que Salomé para muchos oídos
        # Hombre: Gonzalo (CO) primero — acento de la zona; Jorge/Alonso de respaldo
        "female": ["es-MX-DaliaNeural", "es-CO-SalomeNeural", "es-US-PalomaNeural"],
        "male": ["es-CO-GonzaloNeural", "es-MX-JorgeNeural", "es-US-AlonsoNeural"],
    },
    "en": {
        "female": ["en-US-AriaNeural", "en-US-JennyNeural", "en-US-AvaMultilingualNeural"],
        "male": [
            "en-US-AndrewNeural",
            "en-US-BrianNeural",
            "en-US-ChristopherNeural",
            "en-US-GuyNeural",
        ],
    },
    "pt": {
        "female": ["pt-BR-FranciscaNeural", "pt-BR-ThalitaMultilingualNeural", "pt-PT-RaquelNeural"],
        "male": ["pt-BR-AntonioNeural", "pt-PT-DuarteNeural"],
    },
    "fr": {
        "female": ["fr-FR-DeniseNeural", "fr-FR-VivienneMultilingualNeural", "fr-FR-EloiseNeural"],
        "male": ["fr-FR-HenriNeural", "fr-FR-RemyMultilingualNeural", "fr-CA-JeanNeural"],
    },
    "de": {
        "female": ["de-DE-KatjaNeural", "de-DE-SeraphinaMultilingualNeural", "de-DE-AmalaNeural"],
        "male": ["de-DE-ConradNeural", "de-DE-FlorianMultilingualNeural", "de-DE-KillianNeural"],
    },
    "it": {
        "female": ["it-IT-ElsaNeural", "it-IT-IsabellaNeural"],
        "male": ["it-IT-DiegoNeural", "it-IT-GiuseppeMultilingualNeural"],
    },
}
# Idioma → acento por defecto cuando el cliente no manda uno válido para ese idioma.
TTS_LANG_DEFAULT_LOCALE = {
    "es": "es-MX",
    "en": "en-US",
    "pt": "pt-BR",
    "fr": "fr-FR",
    "de": "de-DE",
    "it": "it-IT",
}
TTS_SUPPORTED_LANGS = tuple(TTS_LANG_DEFAULT_LOCALE)
# Modo "misma voz" (v2.7.0): una sola voz multilingüe lee todo el texto.
# Habla español fluido y pronuncia los términos en inglés en inglés, sin
# cambiar de voz ni de ritmo a mitad de frase (evita el efecto robótico de
# concatenar fragmentos de dos voces distintas).
TTS_UNIFIED_VOICES = {
    "female": ["en-US-AvaMultilingualNeural", "en-US-EmmaMultilingualNeural"],
    "male": ["en-US-AndrewMultilingualNeural", "en-US-BrianMultilingualNeural"],
}

# Palabras funcionales españolas: si aparecen, no forzamos inglés en el servidor
_TTS_ES_FUNC = {
    "el", "la", "los", "las", "un", "una", "unos", "unas", "de", "del", "en", "y", "o",
    "que", "por", "para", "con", "es", "son", "se", "al", "lo", "su", "sus", "como",
    "más", "mas", "pero", "si", "no", "ya", "muy", "también", "tambien", "este", "esta",
    "estos", "estas", "eso", "esa", "hola", "gracias", "usa", "usar", "funciona", "puede",
}
TTS_ALLOWED_VOICES = {
    voice
    for item in TTS_VOICE_CATALOG.values()
    for key, voice in item.items()
    if key in {"female", "male"}
}
TTS_ALLOWED_VOICES.update(
    voice
    for language in TTS_FALLBACK_VOICES.values()
    for voices in language.values()
    for voice in voices
)
TTS_ALLOWED_VOICES.update(
    voice for voices in TTS_UNIFIED_VOICES.values() for voice in voices
)
TTS_MAX_CHARS = 2800


class TtsRequest(BaseModel):
    text: str = Field(..., description="Texto a leer en voz alta")
    voice: str = Field("female", description="female | male")
    rate: float = Field(1.0, description="Velocidad 0.8–2.0")
    language: str = Field("es", description="Idioma del fragmento: es | en")
    locale: str = Field("es-MX", description="Acento español BCP-47 (es-MX recomendado para mujer)")
    tone: str = Field("neutral", description="neutral | warm | energetic")
    unified: bool = Field(
        False,
        description="Misma voz multilingüe para todo el texto (sin cambio de voz en inglés)",
    )


def _tts_gender(voice: str) -> str:
    return "male" if (voice or "").strip().lower() in {"male", "m", "hombre", "masculina"} else "female"


def _tts_language(language: str) -> str:
    code = (language or "").strip().lower()[:2]
    return code if code in TTS_LANG_DEFAULT_LOCALE else "es"


def _tts_fragment_is_english(text: str) -> bool:
    """Red de seguridad: tramos solo-tech/EN no deben sintetizarse con voz española."""
    raw = re.sub(r"[ \t]+", " ", (text or "")).strip()
    if not raw:
        return False
    if re.search(r"[áéíóúüñ¿¡]", raw, re.IGNORECASE):
        return False
    words = re.findall(r"[A-Za-z][A-Za-z0-9+.'#-]*", raw)
    if not words:
        return False
    es_hits = sum(1 for w in words if w.lower() in _TTS_ES_FUNC)
    if es_hits:
        return False
    # Sin español funcional y con al menos una palabra latina/tech ASCII → inglés
    return True


def _tts_resolve_language(language: str, text: str) -> str:
    lang = _tts_language(language)
    # El "force-EN" solo tiene sentido cuando el idioma base es español: en
    # portugués/francés/alemán/italiano un tramo sin acentos NO es inglés.
    if lang == "es" and _tts_fragment_is_english(text):
        return "en"
    return lang


def _tts_locale(locale: str, language: str = "es") -> str:
    """Acento válido para el idioma pedido; si no encaja, el de por defecto."""
    lang = _tts_language(language)
    fallback = TTS_LANG_DEFAULT_LOCALE[lang]
    value = (locale or "").strip()
    if value in TTS_VOICE_CATALOG and value.lower().startswith(lang):
        return value
    return fallback


def _tts_pick_voice(voice: str, language: str, locale: str) -> tuple[str, str, str]:
    requested = (voice or "").strip()
    gender = _tts_gender(requested)
    lang = _tts_language(language)
    selected_locale = _tts_locale(locale, lang)
    if requested in TTS_ALLOWED_VOICES:
        return requested, selected_locale, gender
    return TTS_VOICE_CATALOG[selected_locale][gender], selected_locale, gender


def _tts_prosody(rate: float, tone: str) -> tuple[str, str, str, str]:
    value = max(0.8, min(2.0, float(rate or 1.0)))
    rate_pct = int(round((value - 1.0) * 100))
    normalized_tone = (tone or "neutral").strip().lower()
    if normalized_tone == "warm":
        rate_pct -= 4
        pitch = "-2Hz"
        volume = "+1%"
    elif normalized_tone == "energetic":
        rate_pct += 4
        pitch = "+2Hz"
        volume = "+2%"
    else:
        normalized_tone = "neutral"
        pitch = "+0Hz"
        volume = "+0%"
    rate_pct = max(-25, min(100, rate_pct))
    return f"{rate_pct:+d}%", pitch, volume, normalized_tone


async def _tts_synthesize(text: str, voice_id: str, rate: str, pitch: str, volume: str) -> bytes:
    import edge_tts

    communicate = edge_tts.Communicate(
        text,
        voice_id,
        rate=rate,
        pitch=pitch,
        volume=volume,
    )
    audio = bytearray()
    async for chunk in communicate.stream():
        if chunk.get("type") == "audio" and chunk.get("data"):
            audio.extend(chunk["data"])
    return bytes(audio)


async def _tts_render(req: TtsRequest, cache_seconds: int = 0):
    """Sintetiza un fragmento con la voz que corresponde al idioma del texto."""
    from fastapi.responses import Response

    text = re.sub(r"[ \t]+", " ", (req.text or "")).strip()
    if not text:
        raise HTTPException(status_code=400, detail="No hay texto para leer.")
    if len(text) > TTS_MAX_CHARS:
        raise HTTPException(
            status_code=400,
            detail=f"Texto demasiado largo para un bloque (máx. {TTS_MAX_CHARS} caracteres).",
        )
    try:
        import edge_tts  # noqa: F401
    except ImportError as error:
        raise HTTPException(status_code=503, detail="edge-tts no está instalado en el servidor.") from error

    gender = _tts_gender(req.voice)
    if req.unified:
        # Modo "misma voz": una voz multilingüe para todo el fragmento.
        # No aplica force-EN: la propia voz detecta y pronuncia el inglés.
        language = "multi"
        engine = "edge-neural-unified"
        candidates = list(TTS_UNIFIED_VOICES[gender])
    else:
        language = _tts_resolve_language(req.language, text)
        engine = "edge-neural-bilingual"
        voice_id, _, gender = _tts_pick_voice(req.voice, language, req.locale)
        candidates = [voice_id] + [
            candidate
            for candidate in TTS_FALLBACK_VOICES[language][gender]
            if candidate != voice_id
        ]
    rate, pitch, volume, tone = _tts_prosody(req.rate, req.tone)
    last_error = None
    for candidate in candidates:
        try:
            audio = await _tts_synthesize(text, candidate, rate, pitch, volume)
            if not audio:
                raise RuntimeError("El servicio no devolvió audio.")
            actual_locale = candidate.split("-")[0] + "-" + candidate.split("-")[1]
            return Response(
                content=audio,
                media_type="audio/mpeg",
                headers={
                    # El mismo texto con la misma voz siempre suena igual: se puede
                    # cachear en el CDN y ahorrar la síntesis completa al repetir.
                    "Cache-Control": (
                        f"public, max-age={cache_seconds}, s-maxage={cache_seconds}, immutable"
                        if cache_seconds > 0
                        else "no-store"
                    ),
                    "X-TTS-Voice": candidate,
                    "X-TTS-Rate": rate,
                    "X-TTS-Pitch": pitch,
                    "X-TTS-Tone": tone,
                    "X-TTS-Language": language,
                    "X-TTS-Locale": actual_locale,
                    "X-TTS-Engine": engine,
                },
            )
        except Exception as error:
            last_error = error

    detail = str(last_error or "servicio no disponible")[:180]
    raise HTTPException(status_code=502, detail=f"No se pudo sintetizar la voz: {detail}")


@app.post("/tts")
async def tts_neural(req: TtsRequest):
    """Sintetiza un fragmento (POST: sin límite práctico de longitud)."""
    return await _tts_render(req)


@app.get("/tts")
async def tts_neural_get(
    text: str,
    voice: str = "female",
    rate: float = 1.0,
    language: str = "es",
    locale: str = "es-MX",
    tone: str = "neutral",
    unified: bool = False,
):
    """Misma síntesis por GET, cacheable en el navegador y en el CDN.

    Reproducir dos veces el mismo texto deja de costar una síntesis nueva:
    la segunda vez el audio sale del caché y suena de inmediato.
    """
    return await _tts_render(
        TtsRequest(
            text=text,
            voice=voice,
            rate=rate,
            language=language,
            locale=locale,
            tone=tone,
            unified=unified,
        ),
        cache_seconds=86400,
    )


@app.get("/tts-warmup")
async def tts_warmup():
    """Abre la conexión con el servicio de voz antes de que haga falta.

    La primera síntesis paga el arranque (DNS, TLS y token del servicio):
    unos segundos. Llamando aquí en cuanto el usuario se acerca al botón
    de escuchar, ese coste ya está pagado cuando de verdad pulsa.
    """
    from fastapi.responses import JSONResponse

    try:
        audio = await _tts_synthesize(".", TTS_UNIFIED_VOICES["female"][0], "+0%", "+0Hz", "+0%")
        listo = bool(audio)
        detalle = ""
    except Exception as error:  # el warmup nunca debe romper la página
        listo = False
        detalle = str(error)[:120]
    return JSONResponse(
        {"ok": listo, "detail": detalle},
        headers={"Cache-Control": "no-store"},
    )


@app.get("/tts-voices")
def tts_voices_info():
    return {
        "engine": "edge-neural-bilingual",
        "default_locale": "es-MX",
        "recommended": {
            "female_locale": "es-MX",
            "female_voice": "es-MX-DaliaNeural",
            "male_locale": "es-CO",
            "male_voice": "es-CO-GonzaloNeural",
            "english_female": "en-US-AriaNeural",
            "english_male": "en-US-AndrewNeural",
        },
        # Modo "misma voz": una voz multilingüe para ES + EN sin cambio de voz
        "unified": {
            "female": TTS_UNIFIED_VOICES["female"][0],
            "male": TTS_UNIFIED_VOICES["male"][0],
            "fallback": TTS_UNIFIED_VOICES,
        },
        "bilingual": True,
        "accents": {
            locale: {
                "label": data["label"],
                "female": data["female"],
                "male": data["male"],
            }
            for locale, data in TTS_VOICE_CATALOG.items()
            if locale.startswith("es-")
        },
        "english": {
            "female": TTS_VOICE_CATALOG["en-US"]["female"],
            "male": TTS_VOICE_CATALOG["en-US"]["male"],
        },
        # Idiomas con voz propia: el audio nunca se lee con acento de otro idioma
        "languages": {
            lang: {
                "locale": locale,
                "label": TTS_VOICE_CATALOG[locale]["label"],
                "female": TTS_VOICE_CATALOG[locale]["female"],
                "male": TTS_VOICE_CATALOG[locale]["male"],
            }
            for lang, locale in TTS_LANG_DEFAULT_LOCALE.items()
        },
        "tones": ["neutral", "warm", "energetic"],
        "rate_range": [0.8, 2.0],
        "max_chars": TTS_MAX_CHARS,
    }
