"""
JG Turbo · API Serverless (Vercel)
=================================
Transcripción con Groq Whisper (whisper-large-v3-turbo).
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
}

# Groq free/dev: ~25 MB. Dejamos margen de seguridad.
MAX_AUDIO_MB = int(os.environ.get("MAX_AUDIO_MB", "25"))
MAX_AUDIO_BYTES = MAX_AUDIO_MB * 1024 * 1024
MAX_YOUTUBE_MINUTES = int(os.environ.get("MAX_YOUTUBE_MINUTES", "180"))
GROQ_TIMEOUT_S = float(os.environ.get("GROQ_TIMEOUT_S", "90"))
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
    text: str
    direction: str = "en-es"  # en-es | es-en
    provider: str = "gemini"
    api_key: str = ""
    openrouter_model: Optional[str] = None


class CorrectTranscriptionRequest(BaseModel):
    text: str
    language: str = "es"
    provider: str = "gemini"
    api_key: str = ""
    openrouter_model: Optional[str] = None


class CorrectRequest(BaseModel):
    text: str
    language: str = "es"


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


def _get_groq_api_key(client_key: Optional[str] = None) -> Optional[str]:
    if client_key and client_key.strip():
        return client_key.strip()
    key = os.environ.get("GROQ_API_KEY")
    return key.strip() if key else None


def _get_ai_key(client_key: str = "") -> Optional[str]:
    if client_key and client_key.strip():
        return client_key.strip()
    for env in ("GEMINI_API_KEY", "GOOGLE_API_KEY", "OPENROUTER_API_KEY"):
        val = os.environ.get(env)
        if val and val.strip():
            return val.strip()
    return None


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
    }


async def transcribe_with_groq(
    file_path: str,
    language: str = "auto",
    client_key: Optional[str] = None,
    original_name: str = "",
) -> dict:
    api_key = _get_groq_api_key(client_key)
    if not api_key:
        return {
            "_error": (
                "No hay clave de Groq. En Configuración pega tu GROQ_API_KEY "
                "(gratis en console.groq.com) o configúrala en Vercel → Environment Variables."
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
            "model": "whisper-large-v3-turbo",
            "response_format": "json",
        }
        lang_code = None
        if language and language != "auto":
            lang_code = language.split("-")[0].lower()
            data["language"] = lang_code

        if lang_code == "en":
            data["prompt"] = (
                "Clear English transcription. Technology, programming, and AI. "
                "Terms: JavaScript, Python, React, API, Claude, Gemini, Whisper."
            )
        else:
            data["prompt"] = (
                "Transcripción clara. Tecnología, programación e IA. "
                "Términos: JavaScript, Python, React, API, Claude, Gemini, Whisper."
            )

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
        return _resultado_transcripcion(texto, lang_out)
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
    try:
        from youtube_transcript_api import YouTubeTranscriptApi

        # API 1.x (instancia)
        try:
            api = YouTubeTranscriptApi()
            try:
                fetched = api.fetch(video_id, languages=langs)
            except Exception:
                listing = api.list(video_id)
                fetched = None
                for t in listing:
                    try:
                        fetched = t.fetch()
                        break
                    except Exception:
                        continue
            if fetched is not None:
                snippets = getattr(fetched, "snippets", None) or []
                partes = []
                for s in snippets:
                    txt = (getattr(s, "text", None) or "").replace("\n", " ").strip()
                    if txt:
                        partes.append(txt)
                texto = " ".join(partes).strip()
                if texto and len(texto) > 15:
                    lang = getattr(fetched, "language_code", None) or idioma_corto or "es"
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


def _llamar_ia(provider: str, api_key: str, prompt: str, openrouter_model: Optional[str]) -> tuple:
    p = (provider or "gemini").strip().lower()
    if p == "openrouter":
        return _call_openrouter(api_key, prompt, openrouter_model), "openrouter"
    # gemini por defecto (también si mandan "anthropic"/"mistral" sin SDK en serverless)
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
    return {
        "status": "ok",
        "server": "vercel",
        "model": "groq-whisper-large-v3-turbo",
        "model_state": "listo",
        "model_ready": True,
        "ai_configured": bool(_get_groq_api_key() or _get_ai_key()),
        "youtube_transcript_api": yt_transcript,
    }


@app.get("/api/session-config")
def session_config():
    return {
        "token": "vercel-bypass",
        "auth_header": "x-jg-local-token",
        "ai_provider": "gemini",
        "ai_configured": bool(_get_groq_api_key() or _get_ai_key()),
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
            str(tmp_path), language, api_key, original_name=nombre
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
    api_key = _get_ai_key(req.api_key)
    error_detail = None

    if api_key and (req.provider or "gemini") != "none":
        prompt = (
            f"EDITOR ESTRICTO DE TEXTOS — Idioma: {lang}\n\n"
            "Tu ÚNICO trabajo es corregir el texto. NO inventes contenido.\n"
            "1. Corrige ortografía, tildes, puntuación y mayúsculas.\n"
            "2. Elimina muletillas y repeticiones exactas.\n"
            "3. NO cambies el significado ni el orden de ideas.\n"
            "4. Devuelve SOLO el texto corregido, sin explicaciones.\n\n"
            f"TEXTO A CORREGIR:\n{txt}"
        )
        try:
            improved, provider_name = _llamar_ia(
                req.provider, api_key, prompt, req.openrouter_model
            )
            if improved:
                return {
                    "text": improved,
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

    if req.direction not in ("en-es", "es-en"):
        raise HTTPException(status_code=400, detail="direction debe ser 'en-es' o 'es-en'.")

    src_lang = "English" if req.direction == "en-es" else "Spanish"
    trg_lang = "Spanish" if req.direction == "en-es" else "English"
    src_code = "en" if req.direction == "en-es" else "es"
    trg_code = "es" if req.direction == "en-es" else "en"

    api_key = _get_ai_key(req.api_key)
    error_detail = None

    if api_key and (req.provider or "gemini") != "none":
        prompt = (
            f"Translate the following text from {src_lang} to {trg_lang}.\n"
            "Maintain the exact formatting, paragraph breaks, and style. "
            "Do not add explanations. Output only the translation.\n\n"
            f"Original text:\n{txt}"
        )
        try:
            translated, provider_name = _llamar_ia(
                req.provider, api_key, prompt, req.openrouter_model
            )
            if translated:
                return {
                    "text": translated,
                    "ia_used": True,
                    "provider": provider_name,
                    "model": req.openrouter_model if provider_name == "openrouter" else None,
                }
        except Exception as e:
            error_detail = str(e)

    # Fallback gratuito MyMemory
    try:
        translated_text = _translate_mymemory_chunked(txt, src_code, trg_code)
        if translated_text and translated_text.strip():
            return {
                "text": translated_text,
                "ia_used": False,
                "provider": None,
                "error_detail": error_detail,
            }
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
    api_key = _get_ai_key(req.api_key)
    error_detail = None

    if api_key and (req.provider or "gemini") != "none":
        lang = req.language if req.language != "auto" else "es"
        prompt = (
            f"Eres un especialista en corrección de transcripciones de voz a texto en {lang}.\n"
            "Corrige errores de Whisper (palabras inventadas, confusiones fonéticas, "
            "ortografía y puntuación). NO resumas ni agregues ideas nuevas. "
            "Devuelve SOLO el texto corregido.\n\n"
            f"TEXTO A CORREGIR:\n{corregido}"
        )
        try:
            improved, provider_name = _llamar_ia(
                req.provider, api_key, prompt, req.openrouter_model
            )
            if improved:
                return {
                    "text": improved,
                    "ia_used": True,
                    "provider": provider_name,
                    "method": "ia",
                }
        except Exception as e:
            error_detail = str(e)

    return {
        "text": corregido,
        "ia_used": False,
        "provider": None,
        "method": "local" if corregido != txt else "none",
        "error_detail": error_detail,
    }


@app.post("/api/correct")
async def correct_text(req: CorrectRequest):
    """Ortografía/gramática vía LanguageTool (gratis) o fallback local."""
    txt = (req.text or "").strip()
    if not txt:
        raise HTTPException(status_code=400, detail="Texto vacío.")

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
        return {"text": corregido, "matches": aplicados}
    except Exception as e:
        corregido = _mejorar_heuristico(txt)
        return {"text": corregido, "matches": 0, "error_detail": str(e)}


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

    api_key = _get_ai_key(req.api_key)
    error_detail = None

    if api_key and (req.provider or "gemini") != "none":
        system = (
            "Eres un experto en ingeniería de prompts (skill maestro-prompts).\n"
            f"Modalidad detectada: {modalidad}. Modelo destino: {target}.\n"
            "Entrega SIEMPRE este formato (en español), sin omitir secciones:\n\n"
            "## Diagnóstico\n"
            "- 3 a 6 fallas concretas del prompt original (vago, sin rol, sin formato, etc.)\n\n"
            "## Prompt mejorado\n"
            "```\n"
            "(el prompt reescrito listo para copiar y pegar)\n"
            "```\n\n"
            "## Por qué funciona\n"
            "- 3 razones técnicas\n\n"
            "## Cómo iterar\n"
            "- 2-3 variaciones o mejoras siguientes\n\n"
            "Reglas: no inventes datos del usuario; mantén la intención original; "
            "el prompt mejorado debe ser autocontenido y accionable."
        )
        user_msg = f"Prompt original a mejorar:\n\n```\n{prompt}\n```"
        try:
            improved, provider_name = _llamar_ia(
                req.provider, api_key, system + "\n\n" + user_msg, req.openrouter_model
            )
            if improved:
                return {
                    "improved": improved,
                    "ia_used": True,
                    "provider": provider_name,
                    "modalidad": modalidad,
                    "target_model": target,
                    "error_detail": None,
                }
        except Exception as e:
            error_detail = str(e)

    # Fallback local: plantilla reutilizable
    plantilla = (
        f"## Diagnóstico\n"
        f"- El prompt original es corto o genérico y no define rol, contexto ni formato.\n"
        f"- Falta criterio de calidad (qué se considera un buen resultado).\n"
        f"- No indica idioma, tono ni longitud.\n\n"
        f"## Prompt mejorado\n"
        f"```\n"
        f"[ROL]\n"
        f"Eres un experto que ayuda a completar esta tarea con precisión.\n\n"
        f"[CONTEXTO]\n"
        f"Pedido del usuario: {prompt}\n\n"
        f"[TAREA]\n"
        f"Resuelve el pedido de forma completa y práctica.\n\n"
        f"[CRITERIOS DE CALIDAD]\n"
        f"- Respuesta clara y accionable\n"
        f"- Sin inventar datos\n"
        f"- Estructura fácil de copiar\n\n"
        f"[FORMATO DE SALIDA]\n"
        f"- Idioma: español\n"
        f"- Secciones con títulos\n"
        f"- Tono profesional y cercano\n\n"
        f"[LÍMITES]\n"
        f"- Si falta información clave, pregunta antes de asumir.\n"
        f"```\n\n"
        f"## Por qué funciona\n"
        f"- Define rol y criterios (reduce ambigüedad).\n"
        f"- Fija formato de salida (fácil de usar).\n"
        f"- Conserva la intención del pedido original.\n\n"
        f"## Cómo iterar\n"
        f"- Añade ejemplos de entrada/salida.\n"
        f"- Configura una clave Gemini en Configuración para reescritura con IA completa.\n"
    )
    return {
        "improved": plantilla,
        "ia_used": False,
        "provider": None,
        "modalidad": modalidad,
        "target_model": target,
        "error_detail": error_detail,
    }


@app.post("/api/reload-model")
def reload_model(model_name: Optional[str] = None):
    """En Vercel el motor es siempre Groq whisper-large-v3-turbo (no hay modelos locales)."""
    return {
        "status": "ok",
        "message": (
            "En la nube el modelo de transcripción es fijo: groq-whisper-large-v3-turbo. "
            "No se puede cambiar a tiny/base/small (eso solo aplica en el backend local)."
        ),
        "model": "groq-whisper-large-v3-turbo",
    }


@app.get("/api/glossary")
def get_glossary():
    return {"glossary": ""}


@app.post("/api/glossary")
def set_glossary():
    return {"status": "ok"}
