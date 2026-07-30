"""
JG Turbo · API Serverless (Vercel)
=================================
Transcripción con Groq Whisper (whisper-large-v3).
YouTube: subtítulos primero (rápido), audio solo como fallback.
Traducción y pulido de texto con Gemini/OpenRouter o fallbacks gratis.
"""

from __future__ import annotations

import json
import os
import re
import tempfile
import uuid
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Optional

import httpx
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field
from api.calidad_linguistica import (
    analizar_segmentos_asr,
    construir_prompt_asr,
    validar_traduccion,
)
from api.youtube_subs import texto_desde_fetched

app = FastAPI(title="JG Turbo Vercel API", version="3.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["*"],
)

TEMP_DIR = Path(tempfile.gettempdir()) / "jg_turbo_vercel"
TEMP_DIR.mkdir(exist_ok=True)

FORMATOS_AUDIO = {
    ".mp3", ".wav", ".m4a", ".ogg", ".flac", ".aac",
    ".wma", ".opus", ".webm", ".mp4", ".mpeg", ".mpga",
    ".amr", ".3gp",  # notas de voz antiguas / algunos export de WhatsApp
}
MIME_POR_EXT = {
    ".mp3": "audio/mpeg",
    ".mpeg": "audio/mpeg",
    ".mpga": "audio/mpeg",
    ".wav": "audio/wav",
    ".m4a": "audio/mp4",
    ".mp4": "audio/mp4",
    ".webm": "audio/webm",
    ".ogg": "audio/ogg",
    ".opus": "audio/ogg",
    ".flac": "audio/flac",
    ".aac": "audio/aac",
    ".wma": "audio/x-ms-wma",
    ".amr": "audio/amr",
    ".3gp": "audio/3gpp",
}

# Groq free/dev: ~25 MB. Dejamos margen de seguridad.
MAX_AUDIO_MB = int(os.environ.get("MAX_AUDIO_MB", "25"))
MAX_AUDIO_BYTES = MAX_AUDIO_MB * 1024 * 1024
MAX_YOUTUBE_MINUTES = int(os.environ.get("MAX_YOUTUBE_MINUTES", "180"))
GROQ_TIMEOUT_S = float(os.environ.get("GROQ_TIMEOUT_S", "90"))
GROQ_ASR_MODEL = os.environ.get("GROQ_ASR_MODEL", "whisper-large-v3")
GEMINI_MODEL = os.environ.get("GEMINI_MODEL", "gemini-2.0-flash")

YT_URL_RE = re.compile(
    r"(https?://)?(www\.)?(youtube\.com/watch\?v=|youtu\.be/|youtube\.com/shorts/)[\w\-]+"
)

_REP_BUCLE_PALABRA = re.compile(r"\b(\w+)(?:[\s,.;]+?\1){3,}\b", re.IGNORECASE)
_REP_BUCLE_PAR = re.compile(r"\b(\w+[\s,.;]+?\w+)(?:[\s,.;]+?\1){2,}\b", re.IGNORECASE)

_CORRECCIONES_TECNICAS = [
    (re.compile(r"\bjava ?script\b", re.IGNORECASE), "JavaScript"),
    (re.compile(r"\btype ?script\b", re.IGNORECASE), "TypeScript"),
    (re.compile(r"\bhtml\b", re.IGNORECASE), "HTML"),
    (re.compile(r"\bcss\b", re.IGNORECASE), "CSS"),
    (re.compile(r"\bjson\b", re.IGNORECASE), "JSON"),
    (re.compile(r"\bapi\b", re.IGNORECASE), "API"),
    (re.compile(r"\breact\b", re.IGNORECASE), "React"),
    (re.compile(r"\bnode(\.?js)?\b", re.IGNORECASE), "Node.js"),
    (re.compile(r"\bgit ?hub\b", re.IGNORECASE), "GitHub"),
    (re.compile(r"\bpython\b", re.IGNORECASE), "Python"),
    (re.compile(r"\bchat ?gpt\b", re.IGNORECASE), "ChatGPT"),
    (re.compile(r"\b(claude|clud|clod)\b", re.IGNORECASE), "Claude"),
    (re.compile(r"\b(gemini|gímini)\b", re.IGNORECASE), "Gemini"),
    (re.compile(r"\bwhisper\b", re.IGNORECASE), "Whisper"),
    (re.compile(r"\bfastapi\b", re.IGNORECASE), "FastAPI"),
    (re.compile(r"\b(prompt|pront)\b", re.IGNORECASE), "prompt"),
    (re.compile(r"\b(llm|l ?l ?m)\b", re.IGNORECASE), "LLM"),
]

_CONFUSIONES_FONETICAS = [
    (re.compile(r"\btambien\b", re.IGNORECASE), "también"),
    (re.compile(r"\bademas\b", re.IGNORECASE), "además"),
    (re.compile(r"\basi\b(?=\s)", re.IGNORECASE), "así"),
    (re.compile(r"\bapy\b", re.IGNORECASE), "API"),
    (re.compile(r"\bmuchas\s+gracia\b", re.IGNORECASE), "muchas gracias"),
]


# ── Modelos de request ────────────────────────────────────────────────────────

class SessionAIRequest(BaseModel):
    provider: str = "gemini"
    api_key: Optional[str] = None
    openrouter_model: Optional[str] = None


class YouTubeRequest(BaseModel):
    url: str
    language: str = "auto"
    prefer_subtitles: bool = True
    fast_mode: bool = True
    api_key: Optional[str] = None


class ImproveRequest(BaseModel):
    text: str
    language: str = "es"
    provider: str = "gemini"
    api_key: str = ""
    openrouter_model: Optional[str] = None


class TranslateRequest(BaseModel):
    text: str = Field(min_length=1, max_length=50000)
    direction: str = "en-es"  # pares ISO: en-es, es-fr, pt-en, etc.
    provider: str = "gemini"
    api_key: str = ""
    openrouter_model: Optional[str] = None


_LANG_NAMES = {
    "en": "English",
    "es": "Spanish",
    "fr": "French",
    "pt": "Portuguese",
    "de": "German",
    "it": "Italian",
}


def _parse_translate_direction(direction: str):
    """Acepta 'en-es', 'es-fr', etc. Devuelve (src_code, trg_code, src_name, trg_name)."""
    d = (direction or "").strip().lower().replace("_", "-")
    if "-" not in d:
        raise HTTPException(status_code=400, detail="direction debe ser un par ISO, ej. 'en-es' o 'es-fr'.")
    src_code, trg_code = d.split("-", 1)
    src_code = src_code[:2]
    trg_code = trg_code[:2]
    if src_code not in _LANG_NAMES or trg_code not in _LANG_NAMES:
        raise HTTPException(
            status_code=400,
            detail=f"Idiomas soportados: {', '.join(sorted(_LANG_NAMES))}. Recibido: {direction}",
        )
    if src_code == trg_code:
        raise HTTPException(status_code=400, detail="Origen y destino no pueden ser el mismo idioma.")
    return src_code, trg_code, _LANG_NAMES[src_code], _LANG_NAMES[trg_code]


class CorrectTranscriptionRequest(BaseModel):
    text: str
    language: str = "es"
    provider: str = "gemini"
    api_key: str = ""
    openrouter_model: Optional[str] = None


class CorrectRequest(BaseModel):
    text: str
    language: str = "es"
    provider: str = "gemini"
    api_key: str = ""
    openrouter_model: Optional[str] = None


class ImprovePromptRequest(BaseModel):
    prompt: str
    target_model: str = "auto"
    objetivo: str = ""
    idioma_salida: str = "es"
    provider: str = "gemini"
    api_key: str = ""
    openrouter_model: Optional[str] = None


# ── Helpers ───────────────────────────────────────────────────────────────────

def _limpiar(path: Path):
    try:
        if path.exists():
            path.unlink()
    except Exception:
        pass


def _parece_clave_groq(key: str) -> bool:
    """Groq usa gsk_… — no confundir con Grok/xAI (xai-…) u otros proveedores."""
    k = (key or "").strip()
    if not k:
        return False
    low = k.lower()
    if low.startswith(("xai-", "sk-or-", "sk-ant-", "aiza")):
        return False
    return low.startswith("gsk_") or len(k) > 20


def _mensaje_clave_equivocada(client_key: str) -> Optional[str]:
    k = (client_key or "").strip()
    if not k:
        return None
    low = k.lower()
    if low.startswith("xai-"):
        return (
            "Esa clave es de Grok (xAI: xai-…), no de Groq. "
            "La transcripción en la nube usa Groq (gratis en console.groq.com/keys, formato gsk_…). "
            "Grok/xAI solo sirve para pulir texto si lo eliges como proveedor de IA."
        )
    if low.startswith("sk-or-"):
        return (
            "Esa clave es de OpenRouter, no de Groq. "
            "Para Micrófono/Archivo en Vercel pega una clave Groq (gsk_…) o configúrala en el servidor."
        )
    if low.startswith("aiza"):
        return (
            "Esa clave parece de Gemini, no de Groq. "
            "La transcripción necesita GROQ (gsk_… en console.groq.com)."
        )
    return None


def _get_groq_api_key(client_key: Optional[str] = None) -> Optional[str]:
    if client_key and client_key.strip():
        k = client_key.strip()
        # Si el cliente mandó una clave claramente de otro servicio, no la usamos como Groq
        if _mensaje_clave_equivocada(k):
            return None
        if _parece_clave_groq(k):
            return k
        # Clave desconocida: intentar igual (por si Groq cambia prefijo)
        return k
    key = os.environ.get("GROQ_API_KEY")
    return key.strip() if key else None


def _get_ai_key(client_key: str = "", provider: str = "") -> Optional[str]:
    if client_key and client_key.strip():
        return client_key.strip()
    p = (provider or "").strip().lower()
    # Orden según proveedor preferido, luego fallbacks del servidor
    env_por_prov = {
        "gemini": ("GEMINI_API_KEY", "GOOGLE_API_KEY"),
        "openrouter": ("OPENROUTER_API_KEY",),
        "mistral": ("MISTRAL_API_KEY",),
        "xai": ("XAI_API_KEY", "GROK_API_KEY"),
        "grok": ("XAI_API_KEY", "GROK_API_KEY"),
        "anthropic": ("ANTHROPIC_API_KEY",),
    }
    orden = list(env_por_prov.get(p, ()))
    for env in (
        "GEMINI_API_KEY",
        "GOOGLE_API_KEY",
        "OPENROUTER_API_KEY",
        "MISTRAL_API_KEY",
        "XAI_API_KEY",
        "GROK_API_KEY",
        "ANTHROPIC_API_KEY",
    ):
        if env not in orden:
            orden.append(env)
    for env in orden:
        val = os.environ.get(env)
        if val and val.strip():
            return val.strip()
    return None


def _proveedor_ia_servidor() -> str:
    """Detecta qué proveedor de IA está configurado en el servidor (sin clave de cliente)."""
    if os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY"):
        return "gemini"
    if os.environ.get("OPENROUTER_API_KEY"):
        return "openrouter"
    if os.environ.get("MISTRAL_API_KEY"):
        return "mistral"
    if os.environ.get("XAI_API_KEY") or os.environ.get("GROK_API_KEY"):
        return "xai"
    if os.environ.get("ANTHROPIC_API_KEY"):
        return "anthropic"
    return "none"


def _inferir_proveedor_por_clave(key: str) -> Optional[str]:
    low = (key or "").strip().lower()
    if not low:
        return None
    if low.startswith("xai-"):
        return "xai"
    if low.startswith("sk-or-"):
        return "openrouter"
    if low.startswith("sk-ant"):
        return "anthropic"
    if low.startswith("aiza"):
        return "gemini"
    return None


def _resolver_ia(client_key: str = "", provider: str = "") -> tuple:
    """Devuelve (api_key, provider_efectivo).

    Si el cliente no manda clave, usa la del servidor y su proveedor real
    (evita llamar a Gemini con una clave Mistral).
    """
    p = (provider or "").strip().lower() or "gemini"
    if p == "none":
        return None, "none"

    if client_key and client_key.strip():
        k = client_key.strip()
        inferido = _inferir_proveedor_por_clave(k)
        return k, (inferido or p)

    # Sin clave en el navegador → clave + proveedor del servidor
    sp = _proveedor_ia_servidor()
    if sp == "none":
        return None, "none"
    return _get_ai_key("", sp), sp


def _limpiar_respuesta_ia(texto: str) -> str:
    """Quita markdown/envoltorios típicos para dejar texto listo para pegar."""
    if not texto:
        return ""
    t = texto.strip()
    # Bloque de código completo
    m = re.search(r"```(?:[a-zA-Z0-9_+-]*)\s*\n([\s\S]*?)```", t)
    if m and m.group(1).strip():
        t = m.group(1).strip()
    # Prefijos tipo "Texto corregido:"
    t = re.sub(
        r"^(aquí tienes|texto corregido|versión mejorada|prompt mejorado)\s*[:：-]?\s*",
        "",
        t,
        flags=re.IGNORECASE,
    )
    t = t.strip().strip("`").strip()
    return t


def _extraer_prompt_listo(texto: str) -> str:
    """Extrae solo el prompt copiable de una respuesta con secciones markdown."""
    if not texto:
        return ""
    t = texto.strip()
    # Preferir bloque bajo "## Prompt mejorado"
    m = re.search(
        r"##\s*Prompt mejorado\s*\n+```(?:[a-zA-Z0-9_+-]*)?\s*\n([\s\S]*?)```",
        t,
        flags=re.IGNORECASE,
    )
    if m and m.group(1).strip():
        return m.group(1).strip()
    m2 = re.search(
        r"##\s*Prompt mejorado\s*\n+([\s\S]*?)(?=\n##\s|\Z)",
        t,
        flags=re.IGNORECASE,
    )
    if m2 and m2.group(1).strip():
        bloque = m2.group(1).strip()
        # si hay fence suelto, limpiarlo
        return _limpiar_respuesta_ia(bloque)
    return _limpiar_respuesta_ia(t)


def _mime_for(path: str, filename: str = "") -> str:
    ext = Path(filename or path).suffix.lower()
    return MIME_POR_EXT.get(ext, "application/octet-stream")


def _postprocess_texto(texto: str) -> str:
    if not texto:
        return ""
    t = texto.strip()
    t = _REP_BUCLE_PALABRA.sub(r"\1", t)
    t = _REP_BUCLE_PAR.sub(r"\1", t)
    for patron, rep in _CORRECCIONES_TECNICAS:
        t = patron.sub(rep, t)
    for patron, rep in _CONFUSIONES_FONETICAS:
        t = patron.sub(rep, t)
    t = re.sub(r" {2,}", " ", t).strip()
    return t


def _resultado_transcripcion(texto: str, language: str) -> dict:
    return {
        "text": _postprocess_texto(texto),
        "language": language if language and language != "auto" else "es",
        "segments": [],
        "low_confidence_segments": 0,
        "removed_hallucinations": 0,
        "needs_review": False,
        "requires_confirmation": False,
        "review_segments": [],
    }


async def transcribe_with_groq(
    file_path: str,
    language: str = "auto",
    client_key: Optional[str] = None,
    original_name: str = "",
    context: str = "",
) -> dict:
    msg_eq = _mensaje_clave_equivocada(client_key or "")
    if msg_eq and not os.environ.get("GROQ_API_KEY"):
        return {"_error": msg_eq}
    api_key = _get_groq_api_key(client_key)
    if not api_key:
        if msg_eq:
            return {"_error": msg_eq}
        return {
            "_error": (
                "No hay clave de Groq (transcripción). "
                "No es lo mismo que Grok de xAI. "
                "En Configuración pega tu clave Groq (gsk_…, gratis en console.groq.com/keys) "
                "o pide que la configuren en Vercel → Environment Variables → GROQ_API_KEY."
            )
        }

    path = Path(file_path)
    if not path.exists() or path.stat().st_size < 500:
        return {"_error": "El archivo de audio está vacío o es demasiado corto."}
    if path.stat().st_size > MAX_AUDIO_BYTES:
        return {
            "_error": (
                f"El audio supera el límite de {MAX_AUDIO_MB} MB de Groq. "
                "Comprímelo o recórtalo e inténtalo de nuevo."
            )
        }

    url = "https://api.groq.com/openai/v1/audio/transcriptions"
    nombre = original_name or path.name
    mime = _mime_for(str(path), nombre)

    try:
        data = {
            "model": GROQ_ASR_MODEL,
            "response_format": "verbose_json",
            "temperature": "0",
            "timestamp_granularities[]": "segment",
        }
        lang_code = None
        if language and language != "auto":
            lang_code = language.split("-")[0].lower()
            data["language"] = lang_code

        data["prompt"] = construir_prompt_asr(lang_code or language, context)

        timeout = httpx.Timeout(GROQ_TIMEOUT_S, connect=15.0)
        async with httpx.AsyncClient(timeout=timeout) as client:
            with open(path, "rb") as f:
                files = {"file": (nombre, f, mime)}
                resp = await client.post(
                    url,
                    headers={"Authorization": f"Bearer {api_key}"},
                    files=files,
                    data=data,
                )

        if resp.status_code == 401:
            return {"_error": "Clave de Groq inválida o expirada. Revisa la API key en Configuración."}
        if resp.status_code == 413:
            return {"_error": f"Groq rechazó el archivo por tamaño (máx. ~{MAX_AUDIO_MB} MB)."}
        if resp.status_code == 429:
            return {"_error": "Límite de uso de Groq alcanzado. Espera un minuto e inténtalo de nuevo."}
        if resp.status_code != 200:
            detalle = resp.text[:400]
            return {"_error": f"Groq Error {resp.status_code}: {detalle}"}

        result = resp.json()
        texto = (result.get("text") or "").strip()
        lang_out = language if language != "auto" else (result.get("language") or "es")
        segmentos = result.get("segments") or []
        if segmentos:
            analisis = analizar_segmentos_asr(
                texto,
                segmentos,
                limpiar_texto=_postprocess_texto,
            )
            analisis["language"] = lang_out
            analisis["model"] = GROQ_ASR_MODEL
            return analisis
        resultado = _resultado_transcripcion(texto, lang_out)
        resultado["model"] = GROQ_ASR_MODEL
        return resultado
    except httpx.TimeoutException:
        return {
            "_error": (
                f"Groq tardó más de {int(GROQ_TIMEOUT_S)}s. "
                "Prueba un audio más corto o vuelve a intentar."
            )
        }
    except Exception as e:
        return {"_error": f"Error comunicando con Groq: {e}"}


# ── YouTube subtítulos ────────────────────────────────────────────────────────

def _vtt_a_texto(contenido: str) -> str:
    partes = []
    anterior = None
    for linea in contenido.splitlines():
        linea = linea.strip()
        if not linea or linea.upper().startswith("WEBVTT") or "-->" in linea:
            continue
        if re.match(r"^\d+$", linea) or linea.startswith(("Kind:", "Language:")):
            continue
        linea = re.sub(r"<[^>]+>", "", linea)
        if linea and linea != anterior:
            partes.append(linea)
            anterior = linea
    return " ".join(partes)


def _extraer_video_id(url: str) -> Optional[str]:
    m = re.search(r"(?:v=|/shorts/|youtu\.be/)([\w\-]{6,})", url or "")
    return m.group(1) if m else None


def _subtitulos_via_transcript_api(video_id: str, idioma_corto: Optional[str]):
    """Extrae subtítulos sin yt-dlp. Devuelve (texto, lang) o (None, None).

    Nota: en algunas IPs de datacenter YouTube bloquea; por eso hay varios intentos.
    """
    preferidos = []
    if idioma_corto:
        preferidos.append(idioma_corto)
    preferidos += ["es", "en", "es-419", "es-ES", "en-US"]
    seen = set()
    langs = []
    for l in preferidos:
        if l not in seen:
            seen.add(l)
            langs.append(l)

    # --- Método A: youtube-transcript-api (innertube) ---
    # API 1.x (Context7 / jdepoix): instancia + fetch/list; 0.x: get_transcript estático.
    try:
        from youtube_transcript_api import YouTubeTranscriptApi

        # API 1.x (instancia)
        try:
            api = YouTubeTranscriptApi()
            fetched = None
            try:
                fetched = api.fetch(video_id, languages=langs)
            except Exception:
                try:
                    listing = api.list(video_id)
                    for t in listing:
                        try:
                            fetched = t.fetch()
                            break
                        except Exception:
                            continue
                except Exception:
                    fetched = None
            if fetched is not None:
                texto, lang = texto_desde_fetched(
                    fetched, idioma_fallback=idioma_corto or "es"
                )
                if texto:
                    return texto, lang
        except Exception:
            pass

        # API 0.x (métodos de clase, por si el build instaló versión antigua)
        try:
            get_transcript = getattr(YouTubeTranscriptApi, "get_transcript", None)
            if callable(get_transcript):
                data = get_transcript(video_id, languages=langs)
                partes = [(x.get("text") or "").replace("\n", " ").strip() for x in data]
                texto = " ".join(p for p in partes if p).strip()
                if texto and len(texto) > 15:
                    return texto, (idioma_corto or "es")
        except Exception:
            pass
    except ImportError:
        pass

    # --- Método B: scrape de ytInitialPlayerResponse + timedtext ---
    try:
        texto, lang = _subtitulos_via_watch_page(video_id, idioma_corto)
        if texto:
            return texto, lang
    except Exception:
        pass

    return None, None


def _subtitulos_via_watch_page(video_id: str, idioma_corto: Optional[str]):
    """Intenta leer captionTracks desde la página del video y bajar el VTT/XML."""
    watch_url = f"https://www.youtube.com/watch?v={video_id}"
    req = urllib.request.Request(
        watch_url,
        headers={
            "User-Agent": (
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
            ),
            "Accept-Language": "es-CO,es;q=0.9,en;q=0.8",
        },
    )
    with urllib.request.urlopen(req, timeout=20) as r:
        html = r.read().decode("utf-8", "ignore")

    m = re.search(
        r"ytInitialPlayerResponse\s*=\s*(\{.+?\});\s*(?:var|</script>|if\s*\()",
        html,
        re.DOTALL,
    )
    if not m:
        return None, None
    data = json.loads(m.group(1))
    tracks = (
        data.get("captions", {})
        .get("playerCaptionsTracklistRenderer", {})
        .get("captionTracks", [])
    )
    if not tracks:
        return None, None

    def score(track: dict) -> int:
        code = (track.get("languageCode") or "").lower()
        s = 0
        if idioma_corto and code.startswith(idioma_corto):
            s += 10
        if code.startswith("es"):
            s += 5
        if code.startswith("en"):
            s += 3
        if track.get("kind") == "asr":
            s -= 1  # preferir manuales
        return s

    tracks = sorted(tracks, key=score, reverse=True)
    for track in tracks[:4]:
        base = track.get("baseUrl") or ""
        if not base:
            continue
        if base.startswith("/"):
            base = "https://www.youtube.com" + base
        for fmt in ("srv3", "vtt", "json3", ""):
            url = base if not fmt else (base + ("&" if "?" in base else "?") + f"fmt={fmt}")
            try:
                treq = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
                with urllib.request.urlopen(treq, timeout=15) as tr:
                    raw = tr.read().decode("utf-8", "ignore")
                if not raw or len(raw) < 30:
                    continue
                if fmt == "vtt" or raw.lstrip().startswith("WEBVTT"):
                    texto = _vtt_a_texto(raw)
                elif fmt == "json3" or raw.lstrip().startswith("{"):
                    texto = _json3_a_texto(raw)
                else:
                    # srv3 / xml
                    texto = _xml_captions_a_texto(raw)
                if texto and len(texto) > 15:
                    return texto, track.get("languageCode") or idioma_corto or "es"
            except Exception:
                continue
    return None, None


def _json3_a_texto(raw: str) -> str:
    try:
        data = json.loads(raw)
    except Exception:
        return ""
    partes = []
    for ev in data.get("events") or []:
        for seg in ev.get("segs") or []:
            t = (seg.get("utf8") or "").replace("\n", " ").strip()
            if t and t != "\n":
                partes.append(t)
    return " ".join(partes).strip()


def _xml_captions_a_texto(raw: str) -> str:
    # Formato srv3/xml: <text start=".." dur="..">contenido</text>
    partes = []
    for m in re.finditer(r"<text[^>]*>(.*?)</text>", raw, re.DOTALL | re.IGNORECASE):
        t = m.group(1)
        t = re.sub(r"<[^>]+>", "", t)
        t = (
            t.replace("&amp;", "&")
            .replace("&lt;", "<")
            .replace("&gt;", ">")
            .replace("&#39;", "'")
            .replace("&quot;", '"')
            .replace("\n", " ")
            .strip()
        )
        if t:
            partes.append(t)
    return " ".join(partes).strip()


def _obtener_subtitulos(info: dict, idioma_corto: Optional[str]):
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
                req = urllib.request.Request(
                    track["url"],
                    headers={"User-Agent": "Mozilla/5.0"},
                )
                with urllib.request.urlopen(req, timeout=20) as r:
                    contenido = r.read().decode("utf-8", errors="ignore")
                texto = _vtt_a_texto(contenido)
                if texto and len(texto) > 20:
                    return texto, lang
            except Exception:
                continue
    return None, None


# ── IA (Gemini / OpenRouter) ──────────────────────────────────────────────────

def _call_gemini(api_key: str, prompt: str, temperature: float = 0.2) -> str:
    models = [GEMINI_MODEL, "gemini-2.0-flash", "gemini-1.5-flash", "gemini-flash-latest"]
    seen = set()
    last_error = None
    for m in models:
        if not m or m in seen:
            continue
        seen.add(m)
        m_clean = m.replace("models/", "").strip()
        url = (
            f"https://generativelanguage.googleapis.com/v1beta/models/"
            f"{m_clean}:generateContent?key={api_key}"
        )
        payload = json.dumps({
            "contents": [{"parts": [{"text": prompt}]}],
            "generationConfig": {"temperature": temperature, "topP": 0.8},
        }).encode()
        req = urllib.request.Request(
            url, data=payload,
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        try:
            with urllib.request.urlopen(req, timeout=45) as r:
                data = json.loads(r.read())
            if "error" in data:
                last_error = data["error"].get("message", str(data["error"]))
                continue
            cands = data.get("candidates") or []
            if not cands:
                last_error = "Respuesta vacía de Gemini"
                continue
            parts = cands[0].get("content", {}).get("parts") or []
            if parts and "text" in parts[0]:
                return parts[0]["text"].strip()
        except urllib.error.HTTPError as e:
            body = e.read().decode("utf-8", errors="ignore")[:300]
            last_error = f"HTTP {e.code}: {body}"
            if e.code in (400, 404):
                continue
            raise Exception(last_error)
        except Exception as e:
            last_error = str(e)
            continue
    raise Exception(last_error or "Gemini no disponible")


def _call_openrouter(api_key: str, prompt: str, model: Optional[str] = None) -> str:
    model_name = (model or "qwen/qwen3-coder:free").strip()
    url = "https://openrouter.ai/api/v1/chat/completions"
    payload = json.dumps({
        "model": model_name,
        "messages": [{"role": "user", "content": prompt}],
        "temperature": 0.2,
    }).encode()
    req = urllib.request.Request(
        url,
        data=payload,
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {api_key}",
            "HTTP-Referer": "https://jg-turbo.vercel.app",
            "X-Title": "JG Turbo",
        },
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=45) as r:
        data = json.loads(r.read())
    if "error" in data:
        raise Exception(data["error"].get("message", str(data["error"])))
    choices = data.get("choices") or []
    if not choices:
        raise Exception("Respuesta vacía de OpenRouter")
    return (choices[0].get("message", {}).get("content") or "").strip()


def _call_openai_compatible(
    base_url: str,
    api_key: str,
    prompt: str,
    model: str,
    extra_headers: Optional[dict] = None,
    label: str = "IA",
) -> str:
    url = base_url.rstrip("/") + "/chat/completions"
    payload = json.dumps({
        "model": model,
        "messages": [{"role": "user", "content": prompt}],
        "temperature": 0.2,
        "max_tokens": 4096,
    }).encode()
    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {api_key}",
    }
    if extra_headers:
        headers.update(extra_headers)
    req = urllib.request.Request(url, data=payload, headers=headers, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            data = json.loads(r.read())
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", errors="ignore")[:400]
        raise Exception(f"{label} HTTP {e.code}: {body}") from e
    if "error" in data:
        err = data["error"]
        if isinstance(err, dict):
            raise Exception(err.get("message") or err.get("error") or str(err))
        raise Exception(str(err))
    choices = data.get("choices") or []
    if not choices:
        raise Exception(f"Respuesta vacía de {label}")
    return (choices[0].get("message", {}).get("content") or "").strip()


def _call_mistral(api_key: str, prompt: str) -> str:
    model = os.environ.get("MISTRAL_MODEL", "mistral-small-latest")
    return _call_openai_compatible(
        "https://api.mistral.ai/v1",
        api_key,
        prompt,
        model,
        label="Mistral",
    )


def _call_xai(api_key: str, prompt: str) -> str:
    model = os.environ.get("XAI_MODEL", "grok-3-mini")
    return _call_openai_compatible(
        "https://api.x.ai/v1",
        api_key,
        prompt,
        model,
        label="Grok/xAI",
    )


def _llamar_ia(provider: str, api_key: str, prompt: str, openrouter_model: Optional[str]) -> tuple:
    p = (provider or "gemini").strip().lower()
    if p == "openrouter":
        return _call_openrouter(api_key, prompt, openrouter_model), "openrouter"
    if p == "mistral":
        return _call_mistral(api_key, prompt), "mistral"
    if p in ("xai", "grok"):
        return _call_xai(api_key, prompt), "xai"
    # gemini por defecto (anthropic sin SDK dedicado cae a gemini si la clave lo permite)
    if p == "anthropic":
        # Sin SDK Anthropic en serverless: redirigir a OpenAI-compatible solo si la clave no es sk-ant
        if (api_key or "").strip().lower().startswith("sk-ant"):
            raise Exception(
                "Anthropic Claude requiere integración dedicada. "
                "Usa Gemini, OpenRouter, Mistral o Grok (xAI) en Configuración."
            )
    return _call_gemini(api_key, prompt), "gemini"


def _mejorar_heuristico(texto: str) -> str:
    t = re.sub(r"\r\n|\r", "\n", texto)
    t = re.sub(r" {2,}", " ", t).strip()
    muletillas = [
        r"\b(eh+|ah+|oh+|uh+|mm+|hmm+|eeh+|aah+|uhh+|umm+)\b",
        r"\b(o sea|este+|a ver|pues bueno|bueno pues)\b",
        r"\b(¿no\?|¿verdad\?|¿sí\?)\s*",
    ]
    for p in muletillas:
        t = re.sub(p, " ", t, flags=re.IGNORECASE)
    t = re.sub(r"\b(\w{2,})\s+\1\b", r"\1", t, flags=re.IGNORECASE)
    t = re.sub(r" {2,}", " ", t).strip()
    if t and t[0].islower():
        t = t[0].upper() + t[1:]
    t = re.sub(
        r"([.!?…]\s+)([a-záéíóúüñ])",
        lambda m: m.group(1) + m.group(2).upper(),
        t,
    )
    if t and t[-1] not in ".!?…":
        t += "."
    return t


def _corregir_transcripcion_local(texto: str) -> str:
    return _postprocess_texto(texto)


def _translate_mymemory(text: str, src: str, trg: str) -> Optional[str]:
    if not text or not text.strip():
        return text
    try:
        q = urllib.parse.urlencode({"q": text[:450], "langpair": f"{src}|{trg}"})
        url = f"https://api.mymemory.translated.net/get?{q}"
        req = urllib.request.Request(url, headers={"User-Agent": "JG-Turbo/3.0"})
        with urllib.request.urlopen(req, timeout=15) as r:
            data = json.loads(r.read())
        translated = (data.get("responseData") or {}).get("translatedText")
        if translated and "MYMEMORY WARNING" not in translated.upper():
            return translated
    except Exception:
        pass
    return None


def _translate_mymemory_chunked(text: str, src: str, trg: str) -> str:
    # Divide por párrafos y oraciones para no saturar el límite de MyMemory
    paragraphs = text.split("\n")
    out_paras = []
    for para in paragraphs:
        para = para.strip()
        if not para:
            out_paras.append("")
            continue
        if len(para) <= 450:
            trans = _translate_mymemory(para, src, trg)
            out_paras.append(trans if trans else para)
            continue
        sentences = re.split(r"(?<=[.!?…])\s+", para)
        parts = []
        for s in sentences:
            s = s.strip()
            if not s:
                continue
            if len(s) > 450:
                # troceo duro
                for i in range(0, len(s), 400):
                    chunk = s[i:i + 400]
                    t = _translate_mymemory(chunk, src, trg)
                    parts.append(t if t else chunk)
            else:
                t = _translate_mymemory(s, src, trg)
                parts.append(t if t else s)
        out_paras.append(" ".join(parts))
    return "\n".join(out_paras)


def _respuesta_traduccion(
    original: str,
    traducido: str,
    src_code: str,
    trg_code: str,
    provider: Optional[str],
    ia_used: bool,
    model: Optional[str] = None,
    error_detail: Optional[str] = None,
) -> dict:
    return {
        "text": traducido,
        "ia_used": ia_used,
        "provider": provider,
        "model": model,
        "error_detail": error_detail,
        "direction": f"{src_code}-{trg_code}",
        "validation": validar_traduccion(original, traducido, src_code, trg_code),
    }


# ── Endpoints ─────────────────────────────────────────────────────────────────

@app.get("/api/ping")
def ping():
    return {"status": "ok"}


@app.get("/api/health")
def health():
    yt_transcript = False
    try:
        import youtube_transcript_api  # noqa: F401
        yt_transcript = True
    except Exception:
        yt_transcript = False
    groq_ok = bool(_get_groq_api_key())
    ai_ok = bool(_get_ai_key())
    return {
        "status": "ok",
        "server": "vercel",
        "model": GROQ_ASR_MODEL,
        "model_state": "listo",
        "model_ready": True,
        # Compat: antes se mezclaba Groq con IA
        "ai_configured": ai_ok or groq_ok,
        "groq_configured": groq_ok,
        "ia_configured": ai_ok,
        "ai_provider_server": _proveedor_ia_servidor(),
        "youtube_transcript_api": yt_transcript,
    }


@app.get("/api/session-config")
def session_config():
    groq_ok = bool(_get_groq_api_key())
    ai_ok = bool(_get_ai_key())
    return {
        "token": "vercel-bypass",
        "auth_header": "x-jg-local-token",
        "ai_provider": _proveedor_ia_servidor() if ai_ok else "gemini",
        "ai_configured": ai_ok or groq_ok,
        "groq_configured": groq_ok,
        "ia_configured": ai_ok,
        "limits": {
            "max_audio_mb": MAX_AUDIO_MB,
            "max_audio_minutes": MAX_YOUTUBE_MINUTES,
            "max_youtube_minutes": MAX_YOUTUBE_MINUTES,
        },
    }


@app.post("/api/session-ai")
def session_ai(req: SessionAIRequest):
    return {"status": "ok", "provider": req.provider, "ai_configured": True}


@app.post("/api/transcribe")
async def transcribe(
    file: UploadFile = File(...),
    language: str = Form("auto"),
    preview: bool = Form(False),
    fast: bool = Form(False),
    auto_correct: bool = Form(False),
    api_key: Optional[str] = Form(None),
    context: str = Form("", max_length=4000),
):
    nombre = file.filename or "audio.tmp"
    sufijo = Path(nombre).suffix.lower() or ".webm"
    if sufijo not in FORMATOS_AUDIO:
        raise HTTPException(
            status_code=400,
            detail=f"Formato '{sufijo}' no soportado. Usa: {', '.join(sorted(FORMATOS_AUDIO))}",
        )

    tmp_path = TEMP_DIR / f"{uuid.uuid4()}{sufijo}"
    try:
        total = 0
        with open(tmp_path, "wb") as f:
            while True:
                chunk = await file.read(1024 * 1024)
                if not chunk:
                    break
                total += len(chunk)
                if total > MAX_AUDIO_BYTES:
                    raise HTTPException(
                        status_code=413,
                        detail=f"El archivo supera el límite de {MAX_AUDIO_MB} MB.",
                    )
                f.write(chunk)

        resultado = await transcribe_with_groq(
            str(tmp_path), language, api_key, original_name=nombre, context=context
        )
        if "_error" in resultado:
            raise HTTPException(status_code=500, detail=resultado["_error"])

        # Corrección ligera local si el cliente lo pide (sin bloquear con IA pesada)
        if auto_correct and resultado.get("text"):
            resultado["text"] = _corregir_transcripcion_local(resultado["text"])
            resultado["auto_corrected"] = True
            resultado["correction_method"] = "local"

        return JSONResponse(content=resultado)
    finally:
        _limpiar(tmp_path)


@app.post("/api/youtube")
async def transcribe_youtube(req: YouTubeRequest):
    if not YT_URL_RE.search(req.url or ""):
        raise HTTPException(status_code=400, detail="URL de YouTube no válida.")

    idioma = req.language if req.language and req.language != "auto" else None
    idioma_corto = idioma.split("-")[0].lower() if idioma else None
    video_id = _extraer_video_id(req.url)
    titulo = ""

    # 1) Subtítulos vía youtube-transcript-api (rápido y suele funcionar en Vercel)
    if req.prefer_subtitles and video_id:
        texto_subs, lang_subs = _subtitulos_via_transcript_api(video_id, idioma_corto)
        if texto_subs:
            return JSONResponse({
                "text": _postprocess_texto(texto_subs),
                "language": lang_subs or idioma_corto or "es",
                "title": titulo or video_id,
                "source": "subtitles",
                "segments": [],
                "low_confidence_segments": 0,
                "removed_hallucinations": 0,
                "needs_review": False,
            })

    # 2) Intentar metadatos + subtítulos con yt-dlp (puede fallar por bot check)
    info = None
    ydl_common = {
        "quiet": True,
        "no_warnings": True,
        "socket_timeout": 25,
        "retries": 1,
        "user_agent": (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
            "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
        ),
        "extractor_args": {"youtube": {"player_client": ["android", "web"]}},
    }
    try:
        import yt_dlp
        with yt_dlp.YoutubeDL({**ydl_common, "skip_download": True}) as ydl:
            info = ydl.extract_info(req.url, download=False)
        titulo = (info or {}).get("title") or titulo
        duracion = (info or {}).get("duration") or 0
        if duracion and duracion > MAX_YOUTUBE_MINUTES * 60:
            raise HTTPException(
                status_code=413,
                detail=f"El video es demasiado largo. Máximo: {MAX_YOUTUBE_MINUTES} minutos.",
            )
        if req.prefer_subtitles and info:
            texto_subs, lang_subs = _obtener_subtitulos(info, idioma_corto)
            if texto_subs:
                return JSONResponse({
                    "text": _postprocess_texto(texto_subs),
                    "language": lang_subs or idioma_corto or "es",
                    "title": titulo,
                    "source": "subtitles",
                    "segments": [],
                    "low_confidence_segments": 0,
                    "removed_hallucinations": 0,
                    "needs_review": False,
                })
    except HTTPException:
        raise
    except Exception as e:
        # Sin metadatos aún podemos fallar con mensaje claro más abajo
        info = None
        ytdlp_error = str(e)
    else:
        ytdlp_error = None

    # 3) Fallback: descargar audio y mandar a Groq (suele fallar en IPs de datacenter)
    if info is None and ytdlp_error:
        hint = ""
        if "Sign in" in ytdlp_error or "bot" in ytdlp_error.lower():
            hint = (
                " YouTube bloqueó el servidor (anti-bot). "
                "Prueba un video con subtítulos activados, o descarga el audio y úsalo en Archivo."
            )
        raise HTTPException(
            status_code=400,
            detail=f"No se pudo procesar el video.{hint}",
        )

    try:
        import yt_dlp
    except ImportError:
        raise HTTPException(status_code=500, detail="yt-dlp no está instalado en el servidor.")

    tmp_id = uuid.uuid4()
    outtmpl = str(TEMP_DIR / f"{tmp_id}.%(ext)s")
    ydl_opts = {
        **ydl_common,
        "format": "bestaudio[ext=m4a]/bestaudio[ext=webm]/bestaudio/best",
        "outtmpl": outtmpl,
    }

    try:
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            ydl.download([req.url])

        candidatos = list(TEMP_DIR.glob(f"{tmp_id}.*"))
        if not candidatos:
            raise HTTPException(
                status_code=500,
                detail=(
                    "No se pudo descargar el audio. "
                    "Prueba un video con subtítulos o sube el audio en la pestaña Archivo."
                ),
            )
        audio_path = candidatos[0]
        if audio_path.stat().st_size > MAX_AUDIO_BYTES:
            raise HTTPException(
                status_code=413,
                detail=f"El audio del video supera {MAX_AUDIO_MB} MB. Usa un video más corto.",
            )

        resultado = await transcribe_with_groq(
            str(audio_path),
            req.language,
            req.api_key,
            original_name=audio_path.name,
        )
        if "_error" in resultado:
            raise HTTPException(status_code=500, detail=resultado["_error"])

        resultado["title"] = titulo
        resultado["source"] = "whisper-api"
        return JSONResponse(resultado)
    except HTTPException:
        raise
    except Exception as e:
        msg = str(e)
        if "Sign in" in msg or "bot" in msg.lower() or "403" in msg:
            raise HTTPException(
                status_code=500,
                detail=(
                    "YouTube bloqueó la descarga de audio desde el servidor. "
                    "Usa un video con subtítulos o descarga el audio y súbelo en Archivo."
                ),
            )
        raise HTTPException(status_code=500, detail=f"Error YouTube: {e}")
    finally:
        for f in TEMP_DIR.glob(f"{tmp_id}.*"):
            _limpiar(f)


@app.post("/api/improve")
async def improve(req: ImproveRequest):
    txt = (req.text or "").strip()
    if not txt:
        raise HTTPException(status_code=400, detail="Texto vacío.")

    lang = req.language if req.language and req.language != "auto" else "es"
    # Normalizar códigos tipo es-CO → es
    lang_base = (lang or "es").split("-")[0].lower()
    api_key, provider_ef = _resolver_ia(req.api_key or "", req.provider or "")
    error_detail = None

    if api_key and provider_ef != "none":
        prompt = (
            f"Eres un editor profesional de textos en idioma «{lang_base}».\n"
            "Recibes una transcripción de voz a texto (puede tener errores de Whisper).\n\n"
            "REGLAS OBLIGATORIAS:\n"
            "1) Corrige ortografía, tildes, puntuación y mayúsculas.\n"
            "2) Mejora claridad y fluidez sin cambiar el sentido ni inventar datos.\n"
            "3) Elimina muletillas (eh, este, o sea) y repeticiones inútiles.\n"
            "4) Conserva nombres propios, términos técnicos y el tono del autor.\n"
            "5) Devuelve ÚNICAMENTE el texto final listo para copiar y pegar.\n"
            "6) PROHIBIDO: markdown, comillas envolventes, títulos, explicaciones o listas.\n\n"
            f"TEXTO:\n{txt}"
        )
        try:
            improved, provider_name = _llamar_ia(
                provider_ef, api_key, prompt, req.openrouter_model
            )
            if improved:
                limpio = _limpiar_respuesta_ia(improved)
                if limpio:
                    return {
                        "text": limpio,
                        "ia_used": True,
                        "provider": provider_name,
                    }
        except Exception as e:
            error_detail = str(e)

    return {
        "text": _mejorar_heuristico(txt),
        "ia_used": False,
        "provider": None,
        "error_detail": error_detail,
    }


@app.post("/api/translate")
async def translate(req: TranslateRequest):
    txt = (req.text or "").strip()
    if not txt:
        raise HTTPException(status_code=400, detail="Texto vacío.")

    src_code, trg_code, src_lang, trg_lang = _parse_translate_direction(req.direction)

    api_key, provider_ef = _resolver_ia(req.api_key or "", req.provider or "")
    error_detail = None

    if api_key and provider_ef != "none":
        prompt = (
            f"Translate the following text from {src_lang} to {trg_lang}.\n"
            "Translate every sentence faithfully and in the same order. Preserve paragraph "
            "breaks, names, technical terms, URLs, emails, numbers, units, and uncertainty. "
            "Never infer missing context, add facts, summarize, explain, or improve the ideas. "
            "Before answering, silently compare source and target sentence by sentence. "
            "Output only the translation.\n\n"
            f"Original text:\n{txt}"
        )
        try:
            translated, provider_name = _llamar_ia(
                provider_ef, api_key, prompt, req.openrouter_model
            )
            if translated:
                return _respuesta_traduccion(
                    txt,
                    translated,
                    src_code,
                    trg_code,
                    provider_name,
                    True,
                    model=req.openrouter_model if provider_name == "openrouter" else GEMINI_MODEL,
                )
        except Exception as e:
            error_detail = str(e)

    # Fallback gratuito MyMemory (soporta la mayoría de pares ISO)
    try:
        translated_text = _translate_mymemory_chunked(txt, src_code, trg_code)
        if translated_text and translated_text.strip():
            return _respuesta_traduccion(
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
        detail=f"No se pudo traducir. Detalle: {error_detail or 'servicio no disponible'}",
    )


@app.post("/api/correct-transcription")
async def correct_transcription(req: CorrectTranscriptionRequest):
    txt = (req.text or "").strip()
    if not txt:
        raise HTTPException(status_code=400, detail="Texto vacío.")

    corregido = _corregir_transcripcion_local(txt)
    api_key, provider_ef = _resolver_ia(req.api_key or "", req.provider or "")
    error_detail = None

    if api_key and provider_ef != "none":
        lang = req.language if req.language and req.language != "auto" else "es"
        lang_base = lang.split("-")[0]
        prompt = (
            f"Eres un corrector de transcripciones de voz a texto en «{lang_base}».\n"
            "El texto viene de un reconocimiento de voz y puede tener errores fonéticos, "
            "palabras mal oídas, tildes faltantes y puntuación rota.\n\n"
            "TAREA: devolver el mismo contenido, ya corregido y legible.\n"
            "REGLAS:\n"
            "- Corrige ortografía, tildes, mayúsculas y puntuación.\n"
            "- Corrige confusiones típicas de Whisper sin cambiar el mensaje.\n"
            "- No resumas, no agregues ideas, no uses markdown.\n"
            "- Responde SOLO con el texto corregido, listo para copiar y pegar.\n\n"
            f"TEXTO:\n{corregido}"
        )
        try:
            improved, provider_name = _llamar_ia(
                provider_ef, api_key, prompt, req.openrouter_model
            )
            if improved:
                limpio = _limpiar_respuesta_ia(improved)
                if limpio:
                    return {
                        "text": limpio,
                        "ia_used": True,
                        "provider": provider_name,
                        "method": "ia",
                        "matches": 1 if limpio != txt else 0,
                    }
        except Exception as e:
            error_detail = str(e)

    return {
        "text": corregido,
        "ia_used": False,
        "provider": None,
        "method": "local" if corregido != txt else "none",
        "matches": 1 if corregido != txt else 0,
        "error_detail": error_detail,
    }


@app.post("/api/correct")
async def correct_text(req: CorrectRequest):
    """Corrección de texto: IA del servidor (preferida) + LanguageTool de respaldo."""
    txt = (req.text or "").strip()
    if not txt:
        raise HTTPException(status_code=400, detail="Texto vacío.")

    # 1) IA (Mistral/Gemini/etc. del servidor o del cliente)
    api_key, provider_ef = _resolver_ia(req.api_key or "", req.provider or "")
    if api_key and provider_ef != "none":
        lang = req.language if req.language and req.language != "auto" else "es"
        lang_base = lang.split("-")[0]
        prompt = (
            f"Corrige este texto en «{lang_base}» (ortografía, tildes, puntuación, mayúsculas).\n"
            "No cambies el significado. No uses markdown. Solo el texto corregido.\n\n"
            f"{txt}"
        )
        try:
            improved, provider_name = _llamar_ia(
                provider_ef, api_key, prompt, getattr(req, "openrouter_model", None)
            )
            limpio = _limpiar_respuesta_ia(improved or "")
            if limpio:
                return {
                    "text": limpio,
                    "matches": 1 if limpio != txt else 0,
                    "ia_used": True,
                    "provider": provider_name,
                    "method": "ia",
                }
        except Exception:
            pass

    # 2) LanguageTool (gratis)
    lt_map = {
        "es": "es", "es-ES": "es", "es-MX": "es", "es-CO": "es", "es-AR": "es", "es-419": "es",
        "en": "en-US", "en-US": "en-US", "en-GB": "en-GB",
        "fr": "fr", "de": "de-DE", "pt": "pt-BR", "it": "it",
    }
    lang = req.language if req.language and req.language != "auto" else "es"
    lt_lang = lt_map.get(lang, lt_map.get(lang.split("-")[0], "es"))

    try:
        payload = urllib.parse.urlencode({"text": txt[:20000], "language": lt_lang}).encode()
        http_req = urllib.request.Request(
            "https://api.languagetool.org/v2/check",
            data=payload,
            method="POST",
        )
        with urllib.request.urlopen(http_req, timeout=15) as r:
            result = json.loads(r.read())
        matches = sorted(result.get("matches", []), key=lambda m: m["offset"], reverse=True)
        corregido = txt
        aplicados = 0
        for m in matches:
            replacements = m.get("replacements") or []
            if not replacements:
                continue
            start = m["offset"]
            end = start + m["length"]
            corregido = corregido[:start] + replacements[0]["value"] + corregido[end:]
            aplicados += 1
        return {
            "text": corregido,
            "matches": aplicados,
            "ia_used": False,
            "method": "languagetool",
        }
    except Exception as e:
        corregido = _mejorar_heuristico(txt)
        return {
            "text": corregido,
            "matches": 1 if corregido != txt else 0,
            "ia_used": False,
            "method": "local",
            "error_detail": str(e),
        }


@app.post("/api/improve-prompt")
async def improve_prompt(req: ImprovePromptRequest):
    """Mejora un prompt (skill maestro-prompts). Con clave Gemini/OpenRouter usa IA;
    sin clave devuelve plantilla local usable."""
    prompt = (req.prompt or "").strip()
    if not prompt:
        raise HTTPException(status_code=400, detail="Prompt vacío. Escribe el prompt que quieres mejorar.")
    if len(prompt) > 8000:
        raise HTTPException(status_code=400, detail="El prompt es demasiado largo (máx. 8000 caracteres).")

    t = prompt.lower()
    if any(k in t for k in ("midjourney", "dall-e", "dalle", "flux", "ilustra", "dibuja", "--ar")):
        modalidad = "imagen"
    elif any(k in t for k in ("sora", "veo", "kling", "runway", "video de", "animación")):
        modalidad = "video"
    else:
        modalidad = "llm"

    target = (req.target_model or "auto").lower()
    if target == "auto":
        target = {"imagen": "midjourney", "video": "veo"}.get(modalidad, "gemini")

    api_key, provider_ef = _resolver_ia(req.api_key or "", req.provider or "")
    error_detail = None

    if api_key and provider_ef != "none":
        system = (
            "Eres un experto en ingeniería de prompts.\n"
            f"Modalidad: {modalidad}. Destino sugerido: {target}.\n"
            "Reescribe el prompt del usuario para que quede listo para copiar y pegar.\n"
            "REGLAS:\n"
            "- Devuelve SOLO el prompt mejorado en texto plano.\n"
            "- Sin markdown (#, **, ```), sin títulos, sin diagnósticos ni explicaciones.\n"
            "- Mantén la intención original; hazlo claro, con rol, tarea y formato de salida.\n"
            "- Idioma: español.\n"
        )
        user_msg = f"Prompt original:\n{prompt}"
        try:
            improved, provider_name = _llamar_ia(
                provider_ef, api_key, system + "\n\n" + user_msg, req.openrouter_model
            )
            if improved:
                listo = _extraer_prompt_listo(improved)
                return {
                    "improved": listo,
                    "prompt_listo": listo,
                    "ia_used": True,
                    "provider": provider_name,
                    "modalidad": modalidad,
                    "target_model": target,
                    "error_detail": None,
                }
        except Exception as e:
            error_detail = str(e)

    # Fallback local: prompt plano listo para pegar (sin markdown)
    plantilla = (
        f"Eres un experto que ayuda a completar esta tarea con precisión.\n\n"
        f"Pedido del usuario: {prompt}\n\n"
        f"Resuelve el pedido de forma completa y práctica.\n"
        f"Criterios: respuesta clara y accionable, sin inventar datos, fácil de copiar.\n"
        f"Formato: español, secciones cortas, tono profesional y cercano.\n"
        f"Si falta información clave, pregunta antes de asumir."
    )
    return {
        "improved": plantilla,
        "prompt_listo": plantilla,
        "ia_used": False,
        "provider": None,
        "modalidad": modalidad,
        "target_model": target,
        "error_detail": error_detail,
    }


@app.post("/api/reload-model")
def reload_model(model_name: Optional[str] = None):
    """En Vercel el motor es siempre Groq Whisper de máxima precisión."""
    return {
        "status": "ok",
        "message": (
            f"En la nube el modelo de transcripción es fijo: {GROQ_ASR_MODEL}. "
            "No se puede cambiar a tiny/base/small (eso solo aplica en el backend local)."
        ),
        "model": GROQ_ASR_MODEL,
    }


@app.get("/api/glossary")
def get_glossary():
    return {"glossary": ""}


@app.post("/api/glossary")
def set_glossary():
    return {"status": "ok"}


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
TTS_MAX_CHARS = 2800


class TtsRequest(BaseModel):
    text: str = Field(..., description="Texto a leer en voz alta")
    voice: str = Field("female", description="female | male")
    rate: float = Field(1.0, description="Velocidad 0.8–2.0")
    language: str = Field("es", description="Idioma del fragmento: es | en")
    locale: str = Field("es-MX", description="Acento español BCP-47 (es-MX recomendado para mujer)")
    tone: str = Field("neutral", description="neutral | warm | energetic")


def _tts_gender(voice: str) -> str:
    return "male" if (voice or "").strip().lower() in {"male", "m", "hombre", "masculina"} else "female"


def _tts_language(language: str) -> str:
    return "en" if (language or "").strip().lower().startswith("en") else "es"


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
    if lang == "en":
        return "en"
    if _tts_fragment_is_english(text):
        return "en"
    return "es"


def _tts_locale(locale: str) -> str:
    # Predeterminado México (Dalia) si el cliente no envía acento válido
    value = (locale or "es-MX").strip()
    return value if value in TTS_VOICE_CATALOG and value != "en-US" else "es-MX"


def _tts_pick_voice(voice: str, language: str, locale: str) -> tuple[str, str, str]:
    requested = (voice or "").strip()
    gender = _tts_gender(requested)
    lang = _tts_language(language)
    selected_locale = "en-US" if lang == "en" else _tts_locale(locale)
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


@app.post("/api/tts")
async def tts_neural(req: TtsRequest):
    """Sintetiza fragmentos con voz neural latina o inglesa según el idioma."""
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

    language = _tts_resolve_language(req.language, text)
    voice_id, selected_locale, gender = _tts_pick_voice(req.voice, language, req.locale)
    rate, pitch, volume, tone = _tts_prosody(req.rate, req.tone)
    candidates = [voice_id] + [
        candidate
        for candidate in TTS_FALLBACK_VOICES[language][gender]
        if candidate != voice_id
    ]
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
                    "Cache-Control": "no-store",
                    "X-TTS-Voice": candidate,
                    "X-TTS-Rate": rate,
                    "X-TTS-Pitch": pitch,
                    "X-TTS-Tone": tone,
                    "X-TTS-Language": language,
                    "X-TTS-Locale": actual_locale,
                    "X-TTS-Engine": "edge-neural-bilingual",
                },
            )
        except Exception as error:
            last_error = error

    detail = str(last_error or "servicio no disponible")[:180]
    raise HTTPException(status_code=502, detail=f"No se pudo sintetizar la voz: {detail}")


@app.get("/api/tts-voices")
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
        "tones": ["neutral", "warm", "energetic"],
        "rate_range": [0.8, 2.0],
        "max_chars": TTS_MAX_CHARS,
    }
