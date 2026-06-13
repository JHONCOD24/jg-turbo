"""
JG Turbo · Backend de Transcripción (v2)
========================================
Servidor FastAPI que expone:
  GET  /health        — verifica estado del servidor
  POST /transcribe    — recibe un archivo de audio y devuelve el texto
  POST /youtube       — recibe una URL de YouTube y devuelve el texto
  POST /ping          — health mínimo (no toca el modelo)

Cambios v2:
  - Carga perezosa del modelo: el servidor arranca aunque Whisper tarde o falle
  - /health distingue servidor_vivo vs modelo_listo
  - Mejor manejo de errores y CORS
"""

import os
import re
import sys
import uuid
import shutil
import tempfile
import threading
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
            if str(bin_dir) not in os.environ["PATH"]:
                os.environ["PATH"] += os.pathsep + str(bin_dir)
                print(f"[OK] ffmpeg agregado al PATH desde ruta comun: {bin_dir}")
            return

    local_appdata = os.getenv("LOCALAPPDATA")
    if local_appdata:
        winget_path = Path(local_appdata) / "Microsoft" / "WinGet" / "Packages"
        if winget_path.exists():
            for p in winget_path.glob("**/ffmpeg.exe"):
                bin_dir = p.parent
                if str(bin_dir) not in os.environ["PATH"]:
                    os.environ["PATH"] += os.pathsep + str(bin_dir)
                    print(f"[OK] ffmpeg agregado al PATH desde WinGet: {bin_dir}")
                    return

setup_ffmpeg_path()

# Forzar UTF-8 en stdout para que los emojis no rompan la consola Windows
try:
    sys.stdout.reconfigure(encoding='utf-8')
except Exception:
    pass

from fastapi import FastAPI, File, UploadFile, Form, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, FileResponse
from pydantic import BaseModel

# ── Configuración ─────────────────────────────────────────────────────────────
WHISPER_MODEL = os.getenv("WHISPER_MODEL", "base").lower()

# Modelos permitidos (evita typos en la variable de entorno)
MODELOS_VALIDOS = {"tiny", "base", "small", "medium", "large", "tiny.en", "base.en", "small.en", "medium.en"}
if WHISPER_MODEL not in MODELOS_VALIDOS:
    print(f"⚠️  Modelo '{WHISPER_MODEL}' no reconocido. Usando 'base'.")
    WHISPER_MODEL = "base"

# Carpeta temporal para procesar archivos
TEMP_DIR = Path(tempfile.gettempdir()) / "jg_turbo"
TEMP_DIR.mkdir(exist_ok=True)

# ── Inicialización ─────────────────────────────────────────────────────────────
app = FastAPI(
    title="JG Turbo · API de Transcripción",
    version="2.0",
    description="Backend con Whisper para transcribir archivos y videos de YouTube.",
)

# CORS abierto para desarrollo local
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["*"],
)

# ── Carga perezosa del modelo ─────────────────────────────────────────────────
modelo = None
modelo_lock = threading.Lock()
# Lock para evitar concurrencia en la inferencia de Whisper (no es thread-safe)
transcribe_lock = threading.Lock()
modelo_estado = "no_cargado"  # no_cargado | cargando | listo | error
modelo_error = None

def cargar_modelo():
    """Carga Whisper en un hilo. Si falla, el servidor sigue funcionando."""
    global modelo, modelo_estado, modelo_error
    with modelo_lock:
        if modelo_estado in ("cargando", "listo"):
            return
        modelo_estado = "cargando"
        try:
            print(f"Cargando modelo Whisper '{WHISPER_MODEL}'...")
            import whisper
            modelo = whisper.load_model(WHISPER_MODEL)
            modelo_estado = "listo"
            print(f"Modelo '{WHISPER_MODEL}' listo.")
        except ImportError as e:
            modelo_estado = "error"
            modelo_error = (
                f"Paquete no encontrado: {e}. "
                "Solucion: activa el entorno virtual y ejecuta: pip install -r requirements.txt"
            )
            print(f"Error cargando Whisper (ImportError): {e}")
        except RuntimeError as e:
            err_str = str(e)
            if "cuda" in err_str.lower() or "device" in err_str.lower() or "gpu" in err_str.lower():
                modelo_error = (
                    f"Error de GPU/CUDA: {e}. "
                    "Solucion: reinstala PyTorch para CPU ejecutando: "
                    "pip install torch --index-url https://download.pytorch.org/whl/cpu"
                )
            else:
                modelo_error = f"RuntimeError al cargar Whisper: {e}"
            modelo_estado = "error"
            print(f"Error cargando Whisper (RuntimeError): {e}")
        except Exception as e:
            modelo_estado = "error"
            modelo_error = f"{type(e).__name__}: {e}"
            print(f"Error cargando Whisper ({type(e).__name__}): {e}")

# Carga en background; el servidor responde desde el primer segundo
threading.Thread(target=cargar_modelo, daemon=True).start()

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

def _a_wav_mono(ruta: Path) -> Optional[Path]:
    """Convierte cualquier audio a WAV PCM s16le mono 16kHz con ffmpeg.
    Devuelve la ruta del WAV temporal, o None si ffmpeg falla.
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
        # Mostrar los últimos 300 bytes de stderr para diagnóstico
        print(f"[ffmpeg] rc={r.returncode} — {r.stderr[-300:].decode('utf-8','ignore')}")
    except Exception as e:
        print(f"[ffmpeg] Excepción: {e}")
    if out.exists():
        limpiar_archivo(out)
    return None

def corregir_terminos_tecnicos(texto: str) -> str:
    """Post-procesamiento del texto transcrito para corregir la escritura y
    capitalización de términos técnicos comunes y nombres de LLMs,
    así como eliminar bucles de repetición."""
    if not texto:
        return texto

    # Eliminar repeticiones consecutivas (bucles de alucinación de Whisper)
    # Ejemplo: "Clude, Clude, Clude..." -> "Clude"
    texto = re.sub(r"\b(\w+)(?:[\s,.;]+?\1){3,}\b", r"\1", texto, flags=re.IGNORECASE)
    # También limpiar pares de palabras repetidos
    texto = re.sub(r"\b(\w+[\s,.;]+?\w+)(?:[\s,.;]+?\1){2,}\b", r"\1", texto, flags=re.IGNORECASE)

    reemplazos = [
        (r"\bjava ?script\b", "JavaScript"),
        (r"\btype ?script\b", "TypeScript"),
        (r"\bhtml\b", "HTML"),
        (r"\bcss\b", "CSS"),
        (r"\bjson\b", "JSON"),
        (r"\b(openai|openi)\b", "OpenAI"),
        (r"\bapi\b", "API"),
        (r"\burl\b", "URL"),
        (r"\bsql\b", "SQL"),
        (r"\breact\b", "React"),
        (r"\bnode(\.?js)?\b", "Node.js"),
        (r"\bgit ?hub\b", "GitHub"),
        (r"\bgit ?lab\b", "GitLab"),
        (r"\bpython\b", "Python"),
        (r"\bfront ?end\b", "frontend"),
        (r"\bback ?end\b", "backend"),
        (r"\bfull ?stack\b", "fullstack"),
        (r"\bchat ?gpt\b", "ChatGPT"),
        (r"\bgpt[\s\-]?4o\b", "GPT-4o"),
        (r"\bgpt[\s\-]?4\b", "GPT-4"),
        (r"\blang ?chain\b", "LangChain"),
        (r"\brag\b", "RAG"),
        (r"\bjwt\b", "JWT"),
        (r"\boauth\b", "OAuth"),
        (r"\baws\b", "AWS"),
        (r"\bazure\b", "Azure"),
        (r"\bgcp\b", "GCP"),
        (r"\bgoogle cloud\b", "Google Cloud"),
        (r"\b(claude|clud|clude|clube|clod|cloth|clota)\b", "Claude"),
        (r"\b(anthropic|deantropic|dentropic|antropic|antrópic)\b", "Anthropic"),
        (r"\b(kimi|quimi|quimo)\b", "Kimi"),
        (r"\bwhisper\b", "Whisper"),
        (r"\bfastapi\b", "FastAPI"),
        (r"\bpostgres(ql)?\b", "PostgreSQL"),
        (r"\bmongodb\b", "MongoDB"),
        (r"\b(deep ?seek|dip ?sic|dip ?si|dip ?sik|deep ?sic|dip ?sec|dib ?sic)\b", "DeepSeek"),
        (r"\bmistral (large|launch|lars|large o launch)\b", "Mistral Large"),
        (r"\bmistral\b", "Mistral"),
        (r"\b(gemini|gímini|yémini|yéminis)\b", "Gemini"),
        (r"\bollama\b", "Ollama"),
        (r"\b(qwen|cuen)\b", "Qwen"),
        (r"\bgemma\b", "Gemma"),
        (r"\bmeta ?llama\b", "Meta Llama"),
        (r"\b(hugging ?face|hugin ?feis)\b", "Hugging Face"),
        (r"\b(pytorch|paitorch)\b", "PyTorch"),
        (r"\b(tensorflow|tensor ?flou)\b", "TensorFlow"),
        (r"\bdocker\b", "Docker"),
        (r"\b(kubernetes|cubernetes)\b", "Kubernetes"),
        (r"\b(npm|ene ?pe ?eme)\b", "npm"),
        (r"\bpip\b", "pip"),
        (r"\b(markdown|marcdan)\b", "Markdown"),
        (r"\b(v ?s ?code|vi ?es ?code)\b", "VS Code"),
        (r"\bvisual ?studio ?code\b", "Visual Studio Code"),
        (r"\b(web ?hook|web ?juc)\b", "webhook"),
        (r"\b(token|toquen)\b", "token"),
        (r"\b(cookies|cuquis)\b", "cookies"),
        (r"\bdevops\b", "DevOps"),
        (r"\b(agile|ayail)\b", "Agile"),
        (r"\b(scrum|escrot|escrum)\b", "Scrum"),
        (r"\b(llm|llms|l ?l ?m|l ?l ?ms)\b", "LLM"),
        (r"\b(prompt|pront|promts|pronts)\b", "prompt"),
        (r"\bme llueves\b", "me ayudes"),
        (r"\boguito\b", "loguito"),
        (r"\bfabicon\b", "favicon"),
    ]

    for patron, reemplazo in reemplazos:
        texto = re.sub(patron, reemplazo, texto, flags=re.IGNORECASE)

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
]

def _confianza_segmento(seg: dict) -> float:
    """Estima la confianza (0..1) de un segmento a partir de las métricas internas
    de Whisper. Mapea avg_logprob (~-0.1 excelente, ~-1.5 muy malo) a una escala 0..1."""
    logprob = seg.get("avg_logprob", -0.3)
    conf = (logprob + 1.5) / 1.4
    return round(max(0.0, min(1.0, conf)), 3)

def _es_alucinacion(seg: dict) -> bool:
    """Detecta segmentos probablemente alucinados por Whisper (audio difuso o silencio).
    Conservador: solo descarta cuando hay señales claras, para no perder voz real."""
    texto = (seg.get("text") or "").strip().lower()
    if not texto:
        return True
    no_speech = seg.get("no_speech_prob", 0.0)
    logprob = seg.get("avg_logprob", 0.0)
    comp = seg.get("compression_ratio", 1.0)
    # 1) Silencio detectado (alta prob. de no-voz) + texto poco fiable
    if no_speech > 0.6 and logprob < -0.8:
        return True
    # 2) Bucle de repetición: ratio de compresión alto (umbral propio de Whisper)
    if comp > 2.4 and logprob < -0.4:
        return True
    # 3) Frases de relleno que Whisper inventa en tramos sin voz
    for patron in _FRASES_ALUCINACION:
        if re.search(patron, texto):
            return True
    return False


def transcribir_archivo(ruta: Path, idioma: Optional[str] = None, preview: bool = False) -> dict:
    if not modelo_listo():
        if modelo_estado == "cargando":
            return {"_error": "El modelo aún se está cargando, espera unos segundos y vuelve a intentar."}
        return {"_error": f"Modelo Whisper no disponible: {modelo_error or 'error desconocido'}"}

    if not ruta.exists() or ruta.stat().st_size < 2000:
        return {"text": "", "language": "es", "segments": []}

    if not shutil.which("ffmpeg"):
        return {
            "_error": (
                "ffmpeg no esta disponible en el sistema. Instala ffmpeg y agrega su carpeta bin al PATH, "
                "o colocala en C:\\ffmpeg\\bin. Luego reinicia el backend."
            )
        }

    # Paso 1: convertir a WAV mono limpio
    wav = _a_wav_mono(ruta)
    # Si la conversión falla, intentar con el archivo original
    input_path: str = str(wav) if wav else str(ruta)

    # Opciones de Whisper
    opciones: dict = {
        "fp16": False,
        "verbose": False,
        "condition_on_previous_text": not preview,
        "temperature": 0.0,
        "initial_prompt": "JG Turbo. JavaScript, TypeScript, HTML, CSS, JSON, API, URL, SQL, Git, GitHub, GitLab, Node.js, React, FastAPI, Python. OpenAI, GPT-4, GPT-4o, ChatGPT. Claude, Anthropic. Gemini. LangChain, RAG, embeddings, vector database. Whisper. YouTube. DeepSeek, Mistral, Qwen, Gemma, Meta Llama. Hugging Face. PyTorch, TensorFlow. Docker, Kubernetes. AWS, Azure, GCP. LLM, prompt, VS Code. Transcripción limpia, ortografía correcta, sin palabras fragmentadas.",
    }
    if not preview:
        opciones["beam_size"] = 5
    if idioma and idioma != "auto":
        opciones["language"] = idioma.split("-")[0].lower()

    try:
        # Paso 2: pasar la RUTA del archivo WAV (nunca un numpy array)
        # Esto deja que Whisper haga su propia carga interna con load_audio()
        with transcribe_lock:
            resultado = modelo.transcribe(input_path, **opciones)

        segmentos_raw = resultado.get("segments", [])
        segmentos = []
        partes_texto = []
        baja_confianza = 0
        alucinaciones = 0

        for s in segmentos_raw:
            if _es_alucinacion(s):
                alucinaciones += 1
                continue
            texto_seg = corregir_terminos_tecnicos((s.get("text") or "").strip())
            if not texto_seg:
                continue
            conf = _confianza_segmento(s)
            es_dudoso = conf < 0.45
            if es_dudoso:
                baja_confianza += 1
            partes_texto.append(texto_seg)
            segmentos.append({
                "start": round(s["start"], 2),
                "end":   round(s["end"],   2),
                "text":  texto_seg,
                "confidence": conf,
                "low_confidence": es_dudoso,
            })

        texto_limpio = corregir_terminos_tecnicos(" ".join(partes_texto)) if partes_texto else ""
        # Respaldo: si todo se filtró pero Whisper sí devolvió texto, conservarlo
        if not texto_limpio and (resultado.get("text") or "").strip():
            texto_limpio = corregir_terminos_tecnicos(resultado["text"].strip())

        total = len(segmentos)
        needs_review = alucinaciones > 0 or (total > 0 and baja_confianza / total > 0.25)

        return {
            "text": texto_limpio,
            "language": resultado.get("language", "desconocido"),
            "segments": segmentos,
            "low_confidence_segments": baja_confianza,
            "removed_hallucinations": alucinaciones,
            "needs_review": needs_review,
        }
    except Exception as e:
        import traceback
        traceback.print_exc()  # traza completa en la consola del servidor
        return {"_error": f"Whisper falló: {e}"}
    finally:
        if wav:
            limpiar_archivo(wav)

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
    }

@app.post("/reload-model")
def reload_model_endpoint(model_name: Optional[str] = None):
    """Reintenta cargar el modelo Whisper o cambia a uno nuevo.
    Permite recuperarse sin reiniciar el servidor."""
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
    file: UploadFile = File(...),
    language: str = Form("auto"),
    preview: bool = Form(False),
):
    """Recibe un archivo de audio y devuelve el texto transcrito."""
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
        with tmp_path.open("wb") as f:
            shutil.copyfileobj(file.file, f)

        resultado = transcribir_archivo(tmp_path, language, preview=preview)
        if "_error" in resultado:
            raise HTTPException(status_code=500, detail=resultado["_error"])
        return JSONResponse(content=resultado)

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error al transcribir: {e}")
    finally:
        limpiar_archivo(tmp_path)

class YouTubeRequest(BaseModel):
    url: str
    language: str = "auto"
    prefer_subtitles: bool = True

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
def transcribe_youtube(req: YouTubeRequest):
    """Recibe una URL de YouTube y devuelve el texto: primero intenta usar los
    subtítulos del video y, si no hay disponibles, descarga el audio y lo
    transcribe con Whisper."""
    yt_pattern = re.compile(
        r"(https?://)?(www\.)?(youtube\.com/watch\?v=|youtu\.be/|youtube\.com/shorts/)[\w\-]+"
    )
    if not yt_pattern.search(req.url):
        raise HTTPException(status_code=400, detail="URL de YouTube no válida.")

    import yt_dlp

    idioma = req.language if req.language and req.language != "auto" else None
    idioma_corto = idioma.split("-")[0].lower() if idioma else None

    try:
        with yt_dlp.YoutubeDL({"quiet": True, "no_warnings": True, "skip_download": True}) as ydl:
            info = ydl.extract_info(req.url, download=False)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"No se pudo procesar el video: {e}")

    titulo = info.get("title", "")

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
        "format": "bestaudio/best",
        "outtmpl": str(TEMP_DIR / f"{tmp_id}.%(ext)s"),
        "quiet": True,
        "no_warnings": True,
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

        resultado = transcribir_archivo(audio_path, req.language)
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
    provider: str = "gemini"   # "gemini" | "anthropic"
    api_key: str = ""

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

@app.post("/improve")
async def improve_text(req: ImproveRequest):
    """Mejora el texto con IA (Gemini o Claude) o con heurística local como fallback."""
    txt = req.text.strip()
    if not txt:
        raise HTTPException(status_code=400, detail="Texto vacío.")

    lang = req.language if req.language and req.language != "auto" else "es"
    error_detail = None

    prompt = (
        f"Eres un editor profesional de textos transcritos de audio (idioma: {lang}). "
        "Mejora el texto siguiendo este orden: (1) estructura y orden lógico, "
        "(2) claridad — cada frase debe entenderse a la primera, "
        "(3) concisión — elimina muletillas, repeticiones y relleno "
        "(«es importante mencionar», «en el mundo actual», gerundios encadenados), "
        "(4) estilo — ritmo variado, tono consistente, ortografía impecable con ¿ y ¡ en español. "
        "Usa verbos fuertes y frases concretas. No cambies el significado ni añadas datos, "
        "cifras ni información nueva. Conserva la voz del autor. "
        "Devuelve ÚNICAMENTE el texto mejorado, sin explicaciones ni comentarios.\n\n"
        f"Texto:\n{txt}"
    )

    if req.api_key:
        if req.provider == "anthropic":
            try:
                import anthropic as _ant
                client = _ant.Anthropic(api_key=req.api_key)
                msg = client.messages.create(
                    model="claude-haiku-4-5-20251001",
                    max_tokens=2048,
                    messages=[{"role": "user", "content": prompt}],
                )
                return {"text": msg.content[0].text.strip(), "ia_used": True, "provider": "anthropic"}
            except Exception as e:
                error_detail = _detalle_error_ia("Anthropic (Claude)", e)

        elif req.provider == "gemini":
            try:
                import json as _json
                import urllib.request as _ur
                url = (
                    "https://generativelanguage.googleapis.com/v1beta/models/"
                    f"gemini-2.0-flash:generateContent?key={req.api_key}"
                )
                payload = _json.dumps({"contents": [{"parts": [{"text": prompt}]}]}).encode()
                http_req = _ur.Request(url, data=payload, headers={"Content-Type": "application/json"}, method="POST")
                with _ur.urlopen(http_req, timeout=30) as r:
                    data = _json.loads(r.read())
                improved = data["candidates"][0]["content"]["parts"][0]["text"].strip()
                return {"text": improved, "ia_used": True, "provider": "gemini"}
            except Exception as e:
                error_detail = _detalle_error_ia("Gemini", e)

        elif req.provider == "mistral":
            try:
                import json as _json
                import urllib.request as _ur
                url = "https://api.mistral.ai/v1/chat/completions"
                payload = _json.dumps({
                    "model": "mistral-small-latest",
                    "messages": [{"role": "user", "content": prompt}],
                    "max_tokens": 2048,
                    "temperature": 0.3,
                }).encode()
                http_req = _ur.Request(
                    url, data=payload,
                    headers={"Content-Type": "application/json", "Authorization": f"Bearer {req.api_key}"},
                    method="POST",
                )
                with _ur.urlopen(http_req, timeout=30) as r:
                    data = _json.loads(r.read())
                improved = data["choices"][0]["message"]["content"].strip()
                return {"text": improved, "ia_used": True, "provider": "mistral"}
            except Exception as e:
                error_detail = _detalle_error_ia("Mistral", e)

    # Fallback heurístico
    return {"text": _mejorar_heuristico(txt), "ia_used": False, "provider": None, "error_detail": error_detail}


def _detalle_error_ia(nombre_proveedor: str, e: Exception) -> str:
    """Convierte errores HTTP/SDK en un mensaje claro para el usuario."""
    texto_error = str(e)
    if "401" in texto_error or "Unauthorized" in texto_error or "authentication" in texto_error.lower():
        return (
            f"Clave de API de {nombre_proveedor} inválida, vencida o vacía. "
            f"Revisa la clave en Configuración (sin espacios extra)."
        )
    if "403" in texto_error:
        return f"Acceso denegado por {nombre_proveedor} (clave sin permisos o cuota agotada)."
    if "429" in texto_error:
        return f"Límite de uso alcanzado en {nombre_proveedor}. Intenta de nuevo más tarde."
    return f"{nombre_proveedor}: {texto_error}"


# ── /correct ────────────────────────────────────────────────────────────────────

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
