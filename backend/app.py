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

def transcribir_archivo(ruta: Path, idioma: Optional[str] = None, preview: bool = False) -> dict:
    if not modelo_listo():
        if modelo_estado == "cargando":
            return {"_error": "El modelo aún se está cargando, espera unos segundos y vuelve a intentar."}
        return {"_error": f"Modelo Whisper no disponible: {modelo_error or 'error desconocido'}"}

    if not ruta.exists() or ruta.stat().st_size < 2000:
        return {"text": "", "language": "es", "segments": []}

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

        texto_limpio = corregir_terminos_tecnicos(resultado["text"].strip())
        return {
            "text": texto_limpio,
            "language": resultado.get("language", "desconocido"),
            "segments": [
                {
                    "start": round(s["start"], 2),
                    "end":   round(s["end"],   2),
                    "text":  corregir_terminos_tecnicos(s["text"].strip()),
                }
                for s in resultado.get("segments", [])
            ],
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
    html_path = Path(__file__).parent.parent / "jg_turbo.html"
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

@app.post("/youtube")
def transcribe_youtube(req: YouTubeRequest):
    """Recibe una URL de YouTube y devuelve el texto transcrito."""
    yt_pattern = re.compile(
        r"(https?://)?(www\.)?(youtube\.com/watch\?v=|youtu\.be/|youtube\.com/shorts/)[\w\-]+"
    )
    if not yt_pattern.search(req.url):
        raise HTTPException(status_code=400, detail="URL de YouTube no válida.")
    # Implementación del endpoint para YouTube
    # ...
