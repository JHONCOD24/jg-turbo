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
import time
import uuid
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Optional

import httpx
import requests
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field
from youtube_transcript_api import (
    IpBlocked,
    NoTranscriptFound,
    RequestBlocked,
    YouTubeTranscriptApi,
)
from api.calidad_linguistica import (
    analizar_segmentos_asr,
    construir_prompt_asr,
    validar_texto_transformado,
    validar_traduccion,
)
from api.youtube_subs import segmentos_desde_fetched, texto_desde_fetched
from api import deteccion_idioma
from api import supadata
from api.supadata import SupadataError

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
MAX_YOUTUBE_AUDIO_MINUTES = int(os.environ.get("MAX_YOUTUBE_AUDIO_MINUTES", "30"))
YOUTUBE_HTTP_TIMEOUT_S = float(os.environ.get("YOUTUBE_HTTP_TIMEOUT_S", "8"))
YOUTUBE_GROQ_TIMEOUT_S = float(os.environ.get("YOUTUBE_GROQ_TIMEOUT_S", "25"))
GROQ_TIMEOUT_S = float(os.environ.get("GROQ_TIMEOUT_S", "90"))
GROQ_ASR_MODEL = os.environ.get("GROQ_ASR_MODEL", "whisper-large-v3")
# Turbo: ~2–3× más rápido; calidad alta en la práctica para notas y YouTube.
GROQ_ASR_MODEL_FAST = os.environ.get("GROQ_ASR_MODEL_FAST", "whisper-large-v3-turbo")
GEMINI_MODEL = os.environ.get("GEMINI_MODEL", "gemini-2.0-flash")
# Claude: endpoint /v1/messages con headers x-api-key + anthropic-version.
ANTHROPIC_MODEL = os.environ.get("ANTHROPIC_MODEL", "claude-sonnet-5")
ANTHROPIC_VERSION = "2023-06-01"

# Trozos para textos largos: si mandamos todo de una, el proveedor corta la
# respuesta en max_tokens y el usuario pierde la mitad de su texto.
LIMITE_BLOQUE_CHARS = int(os.environ.get("IA_CHUNK_CHARS", "3500"))
MAX_TOKENS_TECHO = int(os.environ.get("IA_MAX_TOKENS", "8192"))

YT_URL_RE = re.compile(
    r"(https?://)?(www\.)?(youtube\.com/watch\?v=|youtu\.be/|youtube\.com/shorts/)[\w\-]+"
)


class YouTubeBloqueoIP(RuntimeError):
    """YouTube rechazó la IP de nube antes de entregar los subtítulos."""


# Salida opcional por proxy. YouTube bloquea las IP de servidores en la nube;
# con un proxy residencial la extracción vuelve a funcionar sin tocar código.
# Formato: http://usuario:clave@servidor:puerto
YOUTUBE_PROXY_URL = (os.environ.get("YOUTUBE_PROXY_URL") or "").strip()

# Presupuesto para esperar un video largo dentro de la función (Vercel corta a
# 60 s). Si se agota, el identificador viaja al navegador y este sigue esperando.
SUPADATA_ESPERA_SERVIDOR_S = float(os.environ.get("SUPADATA_ESPERA_SERVIDOR_S", "22"))


class _SesionYouTubeConTimeout(requests.Session):
    """Aplica un timeout por defecto a cada petición interna de subtítulos."""

    def __init__(self):
        super().__init__()
        if YOUTUBE_PROXY_URL:
            self.proxies = {"http": YOUTUBE_PROXY_URL, "https": YOUTUBE_PROXY_URL}

    def request(self, method, url, **kwargs):
        kwargs.setdefault("timeout", YOUTUBE_HTTP_TIMEOUT_S)
        return super().request(method, url, **kwargs)


def _log_youtube(evento: str, video_id: str = "", **datos):
    """Log estructurado sin URL completa, cookies ni claves."""
    payload = {"evento": f"youtube.{evento}"}
    if video_id:
        payload["video_id"] = video_id
    payload.update(datos)
    print(json.dumps(payload, ensure_ascii=False, default=str), flush=True)


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
    (re.compile(r"\b(llm|l ?l ?m)\b", re.IGNORECASE), "LLM"),
]

# "prompt" se corrige aparte: forzar minúscula rompía el inicio de frase
# («Pront claro» → «. prompt claro»).
_RE_PROMPT_ASR = re.compile(r"\b(prompt|pront)(s)?\b", re.IGNORECASE)

# Muletillas reales. OJO: la muletilla es el alargamiento («esteee»), no el
# demostrativo «este»: `este+` con \b borraba palabras del usuario
# («Este documento es clave» → «. documento es clave»).
_MULETILLAS_HEURISTICAS = [
    re.compile(r"\b(?:e+h+|a+h+|o+h+|u+h+|mm+|hmm+|umm+|ehm+)\b", re.IGNORECASE),
    re.compile(r"\b(?:estee+|eeh+|aah+|uhh+)\b", re.IGNORECASE),
]
# El español repite a propósito: «muy muy», «no no», «sí sí», «casi casi».
# Por eso solo colapsamos palabras de 4+ letras y con lista de excepciones.
_REPETICIONES_VALIDAS = {
    "casi", "nada", "poco", "apenas", "vamos", "corre", "lento", "despacio",
    "ahora", "nunca", "siempre", "bien", "mira", "vale",
}
_RE_REPETICION_LEGITIMA = re.compile(r"\b(\w{4,})(\s+)\1\b", re.IGNORECASE)


def _sin_repeticion(m: "re.Match") -> str:
    """Colapsa «palabra palabra» salvo cuando la repetición es intencional."""
    if m.group(1).lower() in _REPETICIONES_VALIDAS:
        return m.group(0)
    return m.group(1)


_CONFUSIONES_FONETICAS = [
    (re.compile(r"\btambien\b", re.IGNORECASE), "también"),
    (re.compile(r"\bademas\b", re.IGNORECASE), "además"),
    (re.compile(r"\basi\b(?=\s)", re.IGNORECASE), "así"),
    (re.compile(r"\bapy\b", re.IGNORECASE), "API"),
    (re.compile(r"\bmuchas\s+gracia\b", re.IGNORECASE), "muchas gracias"),
]

# Variantes regionales: es-CO ≠ es-ES (vocabulario y trato distintos).
_NOMBRE_VARIANTE = {
    "es-co": "español de Colombia",
    "es-mx": "español de México",
    "es-ar": "español de Argentina",
    "es-cl": "español de Chile",
    "es-pe": "español de Perú",
    "es-ve": "español de Venezuela",
    "es-419": "español de Latinoamérica",
    "es-us": "español de Estados Unidos",
    "es-es": "español de España",
    "en-us": "inglés de Estados Unidos",
    "en-gb": "inglés británico",
    "pt-br": "portugués de Brasil",
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
    context: str = ""  # glosario / términos preferidos para Whisper
    # Campo aditivo: el flujo histórico sigue recibiendo texto plano por defecto.
    include_timestamps: bool = False


class ImproveRequest(BaseModel):
    text: str = Field(min_length=1, max_length=12000)
    language: str = "es"
    provider: str = "gemini"
    api_key: str = ""
    openrouter_model: Optional[str] = None
    # Glosario/tema del usuario (opcional, aditivo: la UI puede no enviarlo)
    context: str = ""
    # Protege los marcadores y límites temporales del doblaje de YouTube.
    preserve_segments: bool = False
    mode: Optional[str] = "transcripcion"  # "transcripcion" | "lectura" | "auditoria_pdf"
    # Auditoría PDF: bloque estructurado con contexto y huella
    bloque_id: Optional[str] = None
    huella_origen: Optional[str] = None
    contexto_anterior: Optional[str] = None
    contexto_posterior: Optional[str] = None
    tokens_estables: Optional[list] = None


class TranslateRequest(BaseModel):
    text: str = Field(min_length=1, max_length=50000)
    direction: str = "en-es"  # pares ISO: en-es, es-fr, pt-en, etc.
    provider: str = "gemini"
    api_key: str = ""
    openrouter_model: Optional[str] = None
    # OBSOLETO: se acepta pero se ignora. Existe solo para que un navegador con el
    # HTML viejo en caché no reciba un error. Con IA disponible siempre va la IA.
    prefer_fast: Optional[bool] = None
    # Mantiene marcadores y proporción temporal en el doblaje sincronizado.
    literal: bool = False
    # Segunda pasada de corrección; si falla, se conserva la traducción inicial.
    revisar: bool = False
    titulo_video: str = Field(default="", max_length=300)


_LANG_NAMES = {
    "en": "English",
    "es": "Spanish",
    "fr": "French",
    "pt": "Portuguese",
    "de": "German",
    "it": "Italian",
}

# Whisper con «detectar idioma» no devuelve el código ISO, sino el nombre del
# idioma en inglés («english», «spanish»…). Quien recibe eso creyéndolo un
# código arma pares imposibles como «english-es»: la traducción falla y el
# doblaje acaba leyendo el texto original. Aquí se vuelve a código ISO.
_CODIGO_POR_NOMBRE_IDIOMA = {
    "english": "en", "spanish": "es", "castilian": "es", "french": "fr",
    "portuguese": "pt", "german": "de", "italian": "it", "dutch": "nl",
    "russian": "ru", "japanese": "ja", "korean": "ko", "chinese": "zh",
    "mandarin": "zh", "arabic": "ar", "hindi": "hi", "turkish": "tr",
    "polish": "pl", "catalan": "ca", "galician": "gl", "basque": "eu",
    "romanian": "ro", "swedish": "sv", "norwegian": "no", "danish": "da",
    "finnish": "fi", "greek": "el", "hebrew": "he", "indonesian": "id",
    "ukrainian": "uk", "czech": "cs", "vietnamese": "vi", "thai": "th",
}


def _codigo_iso_idioma(valor: str) -> str:
    """Código ISO-639-1 ('en') venga un código ('en-US') o un nombre ('English')."""
    crudo = (valor or "").strip().lower().replace("_", "-")
    if not crudo:
        return ""
    corto = crudo.split("-")[0]
    if len(corto) == 2:
        return corto
    return _CODIGO_POR_NOMBRE_IDIOMA.get(corto, corto)


# El prompt de traducción va en español: pedirle el trabajo en el idioma en que
# debe pensar da mejores resultados que pedírselo en inglés.
_LANG_NAMES_ES = {
    "en": "inglés",
    "es": "español",
    "fr": "francés",
    "pt": "portugués",
    "de": "alemán",
    "it": "italiano",
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
    language: str = "es"   # acepta variante regional: es-CO, es-ES, es-MX…
    provider: str = "gemini"
    api_key: str = ""
    openrouter_model: Optional[str] = None
    # Glosario / términos del nicho (opcional, aditivo)
    context: str = ""


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
    # Groq (transcripción) no sirve para pulir/corregir/prompt
    if low.startswith("gsk_"):
        return "groq"
    return None


def _es_error_auth_ia(exc: BaseException) -> bool:
    msg = str(exc or "").lower()
    return any(
        token in msg
        for token in (
            "401",
            "403",
            "unauthorized",
            "invalid api key",
            "invalid_api_key",
            "authentication",
            "api key not valid",
            "permission denied",
        )
    )


def _es_error_rate_limit_ia(exc: BaseException) -> bool:
    msg = str(exc or "").lower()
    return any(
        token in msg
        for token in (
            "429",
            "rate limit",
            "rate_limit",
            "rate_limited",
            "too many requests",
            "quota exceeded",
            "code\":1300",
            "code':1300",
        )
    )


def _resolver_ia(client_key: str = "", provider: str = "") -> tuple:
    """Devuelve (api_key, provider_efectivo).

    Si el cliente no manda clave, usa la del servidor y su proveedor real
    (evita llamar a Gemini con una clave Mistral).
    Ignora claves de Groq (gsk_) en el navegador: son solo para Whisper.
    """
    p = (provider or "").strip().lower() or "gemini"
    if p in ("grok",):
        p = "xai"
    if p == "none":
        return None, "none"

    k = (client_key or "").strip()
    if k:
        inferido = _inferir_proveedor_por_clave(k)
        # Clave Groq pegada por error en el campo de IA → no la usamos
        if inferido == "groq":
            k = ""
        elif inferido:
            return k, inferido
        else:
            # Clave sin prefijo conocido: usarla con el provider pedido
            return k, p

    # Sin clave usable en el navegador → clave + proveedor del servidor
    sp = _proveedor_ia_servidor()
    if sp == "none":
        return None, "none"
    return _get_ai_key("", sp), sp


def _llamar_ia_con_respaldo(
    client_key: str,
    provider: str,
    prompt: str,
    openrouter_model: Optional[str] = None,
    max_tokens: Optional[int] = None,
) -> tuple:
    """Llama a la IA; si la clave del navegador da 401/403, reintenta con la del servidor.
    Si hay 429 (rate limit), intenta con un proveedor alternativo del servidor (Gemini/OpenRouter) antes de fallar."""
    api_key, provider_ef = _resolver_ia(client_key, provider)
    if not api_key or provider_ef == "none":
        raise Exception(
            "No hay clave de IA. Configura Gemini/Mistral/OpenRouter en el servidor "
            "o pega una clave válida en Configuración → IA para pulir texto."
        )

    try:
        return _llamar_ia(provider_ef, api_key, prompt, openrouter_model, max_tokens)
    except Exception as e:
        es_auth = _es_error_auth_ia(e)
        es_rate = _es_error_rate_limit_ia(e)
        if not es_auth and not es_rate:
            raise
        # Reintento con credenciales puras del servidor (ignora clave del navegador)
        server_key, server_prov = _resolver_ia("", "")
        if (
            not server_key
            or server_prov == "none"
            or (server_key == api_key and server_prov == provider_ef)
        ):
            if es_auth:
                raise Exception(
                    f"{provider_ef}: clave no autorizada (401). "
                    "Abre Configuración → IA para pulir texto y borra la clave inválida (jg_api_key) o pega una válida. "
                    "Si dejas el campo vacío, se usará la del servidor. Actualiza MISTRAL_API_KEY / GEMINI_API_KEY en Vercel si la del servidor también falla. "
                    f"Detalle: {e}"
                ) from e
            if es_rate:
                raise Exception(
                    f"{provider_ef}: límite de uso alcanzado (429). Espera 60s o cambia en Configuración el proveedor a Gemini (más generoso). "
                    f"Detalle: {e}"
                ) from e
            raise
        try:
            return _llamar_ia(server_prov, server_key, prompt, openrouter_model, max_tokens)
        except Exception as e2:
            # Si el servidor también está rate-limited, probar otro proveedor del servidor distinto
            if _es_error_rate_limit_ia(e2) or _es_error_rate_limit_ia(e):
                for alt_env, alt_prov in [
                    ("GEMINI_API_KEY", "gemini"),
                    ("OPENROUTER_API_KEY", "openrouter"),
                    ("MISTRAL_API_KEY", "mistral"),
                    ("XAI_API_KEY", "xai"),
                ]:
                    alt_key = os.environ.get(alt_env)
                    if alt_key and alt_prov not in (provider_ef, server_prov):
                        try:
                            return _llamar_ia(alt_prov, alt_key.strip(), prompt, openrouter_model, max_tokens)
                        except Exception:
                            continue
            raise Exception(
                f"La clave del navegador falló y la del servidor también. "
                f"Navegador ({provider_ef}): {e}. Servidor ({server_prov}): {e2}. "
                "Solución: borra la clave inválida en Configuración (deja vacío para usar la del servidor) y si el servidor está en 429, espera 60s o añade GEMINI_API_KEY en Vercel."
            ) from e2


# Preámbulos reales que sueltan Gemini/GPT/Claude antes del texto pedido.
_RE_PREAMBULO_IA = re.compile(
    r"^\s*(?:[¡!]?\s*(?:claro|por supuesto|perfecto|listo|entendido|ok|okay)\s*[!.,:]*\s*)?"
    r"(?:aqu[íi] (?:tienes|te dejo|va|está|estä|est[áa])(?:\s+\w+){0,6}"
    r"|te dejo(?:\s+\w+){0,6}"
    r"|este es(?:\s+\w+){0,6}"
    r"|texto (?:corregido|pulido|mejorado|final)"
    r"|versi[óo]n (?:mejorada|corregida|pulida|final)"
    r"|transcripci[óo]n corregida"
    r"|prompt mejorado"
    r"|here(?:'s| is)(?:\s+the)?(?:\s+(?:full|complete))?(?:\s+translation)?"
    r"|the translation"
    r"|resultado)"
    r"\s*[:：.\-–—]*\s*\n?",
    re.IGNORECASE,
)
# Postámbulos: la última línea del tipo "Espero que te sirva" o "¿Quieres que…?"
_RE_POSTAMBULO_IA = re.compile(
    r"^\s*(?:[¡!]?\s*(?:espero que (?:te )?(?:sirva|ayude|guste|sea útil)"
    r"|si (?:necesitas|quieres|deseas|te sirve)\b.*"
    r"|d[ée]jame saber\b.*"
    r"|av[íi]same\b.*"
    r"|cualquier (?:cosa|duda)\b.*"
    r"|[¿?].{0,120}\?)"
    r")\s*[!.]*\s*$",
    re.IGNORECASE,
)


def _limpiar_respuesta_ia(texto: str) -> str:
    """Quita markdown, preámbulos y postámbulos para dejar texto listo para pegar."""
    if not texto:
        return ""
    t = texto.strip()
    # Bloque de código completo
    m = re.search(r"```(?:[a-zA-Z0-9_+-]*)\s*\n([\s\S]*?)```", t)
    if m and m.group(1).strip():
        t = m.group(1).strip()
    # Prefijos tipo "Claro, aquí tienes el texto corregido:"
    anterior = None
    while anterior != t:
        anterior = t
        t = _RE_PREAMBULO_IA.sub("", t, count=1).strip()

    # Postámbulo: solo si el texto tiene más de una línea (si no, sería el texto)
    lineas = t.split("\n")
    while len(lineas) > 1 and _RE_POSTAMBULO_IA.match(lineas[-1].strip()):
        lineas.pop()
        while lineas and not lineas[-1].strip():
            lineas.pop()
    t = "\n".join(lineas)

    t = t.strip().strip("`").strip()
    return t


_RE_ENFASIS_MD = re.compile(r"(?<!\w)\*{1,2}([^*\n]{1,80}?)\*{1,2}(?!\w)")


def _sin_enfasis_markdown(texto: str) -> str:
    """Quita *cursivas* y **negritas** que la IA cuela pese a pedirle texto plano.

    Solo en traducción: el textarea no renderiza markdown, así que los asteriscos
    se ven como basura y el TTS los leería. Se limita a énfasis corto en una
    línea para no tocar un asterisco legítimo.
    """
    if not texto or "*" not in texto:
        return texto
    return _RE_ENFASIS_MD.sub(r"\1", texto)


def _modelo_de_proveedor(provider: Optional[str], openrouter_model: Optional[str] = None) -> Optional[str]:
    """Nombre real del modelo que respondió, para no mentir en la respuesta.

    Antes se devolvía siempre GEMINI_MODEL salvo en OpenRouter, así que un texto
    traducido por Mistral se reportaba como «gemini-2.0-flash» y confundía al
    leer los registros o la etiqueta de la interfaz.
    """
    p = (provider or "").strip().lower()
    if p == "openrouter":
        return openrouter_model or os.environ.get("OPENROUTER_MODEL") or "openrouter"
    if p == "gemini":
        return GEMINI_MODEL
    if p == "mistral":
        return os.environ.get("MISTRAL_MODEL", "mistral-small-latest")
    if p == "xai":
        return os.environ.get("XAI_MODEL", "grok-3-mini")
    if p == "anthropic":
        return ANTHROPIC_MODEL
    return None


def _extraer_prompt_listo(texto: str) -> str:
    """Extrae solo el prompt copiable de la respuesta de la IA.

    El prompt del sistema ya prohíbe encabezados, así que lo normal es que el
    modelo devuelva el prompt pelado; solo por si acaso quitamos un encabezado
    o un bloque de código envolvente.
    """
    if not texto:
        return ""
    t = texto.strip()
    # Bloque de código envolvente (el caso más común cuando se desobedece)
    m = re.search(r"^```(?:[a-zA-Z0-9_+-]*)\s*\n([\s\S]*?)```\s*$", t)
    if m and m.group(1).strip():
        t = m.group(1).strip()
    # Encabezado suelto tipo "## Prompt mejorado" o "PROMPT MEJORADO:"
    t = re.sub(
        r"^\s*(?:#{1,6}\s*)?(?:prompt\s+(?:mejorado|final|optimizado))\s*[:：]?\s*\n+",
        "",
        t,
        flags=re.IGNORECASE,
    )
    return _limpiar_respuesta_ia(t)


def _max_tokens_para(texto: str, factor: float = 1.8, minimo: int = 1024) -> int:
    """Presupuesto de salida generoso y proporcional a la entrada.

    ~3.2 caracteres por token en español; el factor deja aire para que la
    respuesta pueda ser más larga que la entrada sin cortarse.
    """
    aprox = int(len(texto or "") / 3.2 * factor) + 256
    return max(minimo, min(MAX_TOKENS_TECHO, aprox))


def _dividir_en_bloques(texto: str, limite: int = LIMITE_BLOQUE_CHARS) -> list:
    """Divide por párrafos acumulando bloques bajo el límite de caracteres."""
    texto = (texto or "").strip()
    if not texto:
        return []
    if len(texto) <= limite:
        return [texto]

    parrafos = re.split(r"\n\s*\n", texto)
    bloques = []
    actual = ""
    for parrafo in parrafos:
        parrafo = parrafo.strip("\n")
        if not parrafo.strip():
            continue
        if len(parrafo) > limite:
            if actual:
                bloques.append(actual)
                actual = ""
            # Párrafo enorme: cortar por oraciones sin partir palabras
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


def _procesar_por_bloques(
    texto: str,
    construir_prompt,
    ejecutar,
    continuidad: bool = False,
    procesar_salida=None,
) -> tuple:
    """Procesa el texto por bloques y reensambla. Devuelve (salida, proveedor)."""
    bloques = _dividir_en_bloques(texto)
    salidas = []
    terminos = []
    proveedor = None
    for bloque in bloques:
        prompt = (
            construir_prompt(bloque, salidas[-1][-300:] if salidas else "", terminos)
            if continuidad
            else construir_prompt(bloque)
        )
        respuesta, proveedor = ejecutar(prompt, _max_tokens_para(bloque))
        limpio = _limpiar_respuesta_ia(respuesta or "")
        if not limpio:
            raise Exception("La IA devolvió una respuesta vacía para parte del texto.")
        if procesar_salida:
            limpio = procesar_salida(bloque, limpio)
        salidas.append(limpio)
        if continuidad:
            vistos = {termino.casefold() for termino in terminos}
            candidatos = re.findall(
                r"\b(?:[A-ZÁÉÍÓÚÑ]{3,}|[A-ZÁÉÍÓÚÑ][\wÁÉÍÓÚÑáéíóúñ.-]{2,})\b",
                limpio,
            )
            for candidato in candidatos:
                if candidato.casefold() not in vistos:
                    terminos.append(candidato)
                    vistos.add(candidato.casefold())
                if len(terminos) >= 15:
                    break
    return "\n\n".join(salidas).strip(), proveedor


def _aviso_por_integridad(validacion: dict, texto_original: str, salida: str) -> Optional[str]:
    """Mensaje corto en español si la salida parece haber perdido contenido."""
    if not validacion:
        return None
    codigos = {p.get("code") for p in validacion.get("issues") or []}
    if "possible_omission" in codigos or "empty_translation" in codigos:
        return (
            "El resultado quedó bastante más corto que tu texto original. "
            "Revísalo antes de reemplazarlo: puede haberse cortado."
        )
    if "missing_numbers" in codigos or "missing_urls" in codigos or "missing_emails" in codigos:
        return "Faltan cifras, enlaces o correos que sí estaban en tu texto. Revisa el resultado."
    if "possible_invention" in codigos or "invented_numbers" in codigos:
        return "El resultado agregó contenido que no estaba en tu texto. Revísalo antes de usarlo."
    if len(salida or "") < len(texto_original or "") * 0.6 and len(texto_original or "") > 400:
        return "El resultado es mucho más corto que el original. Revísalo antes de reemplazarlo."
    return None


def _mime_for(path: str, filename: str = "") -> str:
    ext = Path(filename or path).suffix.lower()
    return MIME_POR_EXT.get(ext, "application/octet-stream")


def _normalizar_prompt(texto: str) -> str:
    """Escribe «prompt» bien, respetando la mayúscula si abre la frase."""
    def reemplazo(m):
        base = "prompt" + (m.group(2).lower() if m.group(2) else "")
        anterior = texto[: m.start()].rstrip()
        if not anterior or anterior[-1] in ".!?…:¿¡\n":
            return base.capitalize()
        return base

    return _RE_PROMPT_ASR.sub(reemplazo, texto)


def _postprocess_texto(texto: str) -> str:
    if not texto:
        return ""
    t = texto.strip()
    t = _REP_BUCLE_PALABRA.sub(r"\1", t)
    t = _REP_BUCLE_PAR.sub(r"\1", t)
    for patron, rep in _CORRECCIONES_TECNICAS:
        t = patron.sub(rep, t)
    t = _normalizar_prompt(t)
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
    fast: bool = False,
    timeout_override_s: Optional[float] = None,
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
        # No enviamos "temperature": la API de audio de Groq lo documenta como
        # UN número entre 0 y 1 (no acepta la cadena de reintentos
        # "0, 0.2, 0.4…" de OpenAI). Enviar "0" fijo anulaba el reintento
        # automático de Whisper cuando un segmento falla los umbrales de
        # compresión/logprob; omitirlo deja que Groq aplique su comportamiento
        # por defecto, que sí reintenta. Verificado en console.groq.com/docs
        # (speech-to-text y api-reference), julio 2026.
        modelo = GROQ_ASR_MODEL_FAST if fast else GROQ_ASR_MODEL
        # En modo rápido no pedimos segmentos verbose: menos JSON y menos post-proceso.
        data = {
            "model": modelo,
            "response_format": "json" if fast else "verbose_json",
        }
        if not fast:
            data["timestamp_granularities[]"] = "segment"
        lang_code = None
        if language and language != "auto":
            lang_code = language.split("-")[0].lower()
            data["language"] = lang_code

        data["prompt"] = construir_prompt_asr(lang_code or language, context)

        timeout_s = min(GROQ_TIMEOUT_S, 60.0) if fast else GROQ_TIMEOUT_S
        if timeout_override_s is not None:
            timeout_s = min(timeout_s, max(1.0, float(timeout_override_s)))
        timeout = httpx.Timeout(timeout_s, connect=12.0)
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
            clave_servidor = (os.environ.get("GROQ_API_KEY") or "").strip()
            # La clave que mandó el navegador no vale. Si el servidor tiene la
            # suya, se reintenta con ella: dejar sin transcripción a quien SÍ
            # tiene una clave buena en el servidor, por una clave caducada o de
            # otro servicio guardada en el navegador, es un fallo evitable.
            if client_key and clave_servidor and clave_servidor != (api_key or ""):
                resultado = await transcribe_with_groq(
                    file_path,
                    language,
                    None,
                    original_name,
                    context,
                    fast=fast,
                    timeout_override_s=timeout_override_s,
                )
                if isinstance(resultado, dict) and not resultado.get("_error"):
                    resultado["aviso_clave"] = (
                        "La clave de Groq guardada en este navegador no sirve (Groq la "
                        "rechazó), así que se usó la del servidor. Bórrala en "
                        "Configuración → Servidor e IA, o cámbiala por una nueva de "
                        "console.groq.com/keys (formato gsk_…)."
                    )
                return resultado
            return {"_error": (
                "Clave de Groq inválida o expirada (Groq respondió 401). "
                "Si pegaste una clave en Configuración → Servidor e IA, bórrala para usar "
                "la del servidor, o reemplázala por una nueva de console.groq.com/keys "
                "(formato gsk_…)."
            )}
        if resp.status_code == 413:
            return {"_error": f"Groq rechazó el archivo por tamaño (máx. ~{MAX_AUDIO_MB} MB)."}
        if resp.status_code == 429:
            return {"_error": "Límite de uso de Groq alcanzado. Espera un minuto e inténtalo de nuevo."}
        # Si turbo no está disponible en la cuenta, reintentar con el modelo completo.
        if resp.status_code != 200 and fast and modelo != GROQ_ASR_MODEL:
            return await transcribe_with_groq(
                file_path,
                language,
                client_key,
                original_name,
                context,
                fast=False,
                timeout_override_s=timeout_override_s,
            )
        if resp.status_code != 200:
            detalle = resp.text[:400]
            return {"_error": f"Groq Error {resp.status_code}: {detalle}"}

        result = resp.json()
        texto = (result.get("text") or "").strip()
        lang_out = language if language != "auto" else (_codigo_iso_idioma(result.get("language")) or "es")
        segmentos = result.get("segments") or []
        if segmentos and not fast:
            analisis = analizar_segmentos_asr(
                texto,
                segmentos,
                limpiar_texto=_postprocess_texto,
            )
            analisis["language"] = lang_out
            analisis["model"] = modelo
            return analisis
        resultado = _resultado_transcripcion(texto, lang_out)
        resultado["model"] = modelo
        return resultado
    except httpx.TimeoutException:
        return {
            "_error": (
                f"Groq tardó más de {int(timeout_s)}s. "
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

    Una IP bloqueada se propaga para impedir nuevos intentos desde la misma IP.
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

    bloqueo = None

    # --- Método A: youtube-transcript-api (innertube) ---
    # API 1.x: listar una sola vez evita repetir watch + innertube cuando falla fetch().
    try:
        api = YouTubeTranscriptApi(http_client=_SesionYouTubeConTimeout())
        listado = api.list(video_id)
        try:
            transcript = listado.find_transcript(langs)
        except NoTranscriptFound:
            transcript = next(iter(listado), None)
        if transcript is not None:
            fetched = transcript.fetch()
            texto, lang = texto_desde_fetched(
                fetched, idioma_fallback=idioma_corto or "es"
            )
            if texto:
                return texto, lang
    except (RequestBlocked, IpBlocked) as exc:
        # Antes se abortaba aquí y el método B nunca llegaba a ejecutarse.
        # El bloqueo se recuerda y solo se lanza si tampoco funciona el resto.
        bloqueo = type(exc).__name__
        _log_youtube("subtitulos_api_bloqueada", video_id, error_type=bloqueo)
    except Exception as exc:
        _log_youtube(
            "subtitulos_api_error",
            video_id,
            error_type=type(exc).__name__,
            error=str(exc)[:240],
        )

    # --- Método B: scrape de ytInitialPlayerResponse + timedtext ---
    try:
        texto, lang = _subtitulos_via_watch_page(video_id, idioma_corto)
        if texto:
            return texto, lang
    except Exception as exc:
        _log_youtube(
            "watch_page_error",
            video_id,
            error_type=type(exc).__name__,
            error=str(exc)[:240],
        )

    if bloqueo:
        raise YouTubeBloqueoIP(bloqueo)
    return None, None


def _elegir_pista_cronometrada(listado, idioma_corto: Optional[str]):
    """Elige qué pista de subtítulos usar y qué dice sobre el idioma del audio.

    Distinción clave para el doblaje: los subtítulos **automáticos** los genera
    YouTube escuchando el audio, así que su idioma ES el idioma hablado. Los
    manuales pueden estar traducidos a cualquier idioma y no demuestran nada
    sobre el audio. Antes se tomaba «cualquier pista» y por eso un video en
    español con subtítulos en inglés entraba al doblaje.

    Devuelve ``(transcript, idioma_audio, es_automatica)`` donde ``idioma_audio``
    queda vacío si ninguna pista permite deducirlo.
    """
    try:
        pistas = list(listado)
    except Exception:
        pistas = []
    if not pistas:
        return None, "", None

    generadas = [p for p in pistas if getattr(p, "is_generated", False)]
    manuales = [p for p in pistas if not getattr(p, "is_generated", False)]
    idioma_audio = ""
    if generadas:
        idioma_audio = str(getattr(generadas[0], "language_code", "") or "")

    def buscar(candidatas, codigo: str):
        corto = deteccion_idioma.codigo_corto(codigo)
        if not corto:
            return None
        for pista in candidatas:
            if deteccion_idioma.codigo_corto(getattr(pista, "language_code", "")) == corto:
                return pista
        return None

    # 1) Si sabemos el idioma del audio, la mejor pista es la que está en ese
    #    idioma: manual primero (mejor puntuación y sin errores de ASR).
    if idioma_audio:
        elegida = buscar(manuales, idioma_audio) or buscar(generadas, idioma_audio)
        if elegida is not None:
            return elegida, idioma_audio, bool(getattr(elegida, "is_generated", False))

    # 2) Sin pista automática: se respeta lo que pidió quien llama y, si no hay,
    #    se toma la primera manual. El idioma del audio queda por determinar.
    for codigo in [idioma_corto, "en", "es"]:
        elegida = buscar(manuales, codigo or "") or buscar(generadas, codigo or "")
        if elegida is not None:
            return elegida, idioma_audio, bool(getattr(elegida, "is_generated", False))

    elegida = pistas[0]
    return elegida, idioma_audio, bool(getattr(elegida, "is_generated", False))


def _subtitulos_cronometrados_via_transcript_api(
    video_id: str,
    idioma_corto: Optional[str],
):
    """Extrae (texto, idioma, segmentos, pistas) sin alterar el flujo de texto plano.

    ``pistas`` describe de dónde salió el texto: ``{"idioma_audio", "automatica"}``.
    Quien llama lo usa para decidir si el audio está en inglés de verdad.
    """
    vacio = {"idioma_audio": "", "automatica": None}
    try:
        api = YouTubeTranscriptApi(http_client=_SesionYouTubeConTimeout())
        listado = api.list(video_id)
        transcript, idioma_audio, automatica = _elegir_pista_cronometrada(
            listado, idioma_corto
        )
        if transcript is None:
            return None, None, [], vacio
        fetched = transcript.fetch()
        segmentos = segmentos_desde_fetched(fetched)
        texto, lang = texto_desde_fetched(
            fetched, idioma_fallback=idioma_corto or "en"
        )
        if texto and segmentos:
            _log_youtube(
                "pista_elegida",
                video_id,
                lang=lang,
                automatica=automatica,
                idioma_audio=idioma_audio,
            )
            return texto, lang, segmentos, {
                "idioma_audio": idioma_audio,
                "automatica": automatica,
            }
    except (RequestBlocked, IpBlocked) as exc:
        raise YouTubeBloqueoIP(type(exc).__name__) from exc
    except Exception as exc:
        _log_youtube(
            "subtitulos_cronometrados_error",
            video_id,
            error_type=type(exc).__name__,
            error=str(exc)[:240],
        )
    return None, None, [], vacio


def _idioma_audio_declarado(video_id: str, timeout: float = 8.0) -> str:
    """Lee `defaultAudioLanguage`: el idioma del audio según el propio YouTube.

    Es la señal más directa que existe, pero llega por la página del video, que
    YouTube bloquea desde datacenter. Por eso nunca es obligatoria: si falla, se
    devuelve cadena vacía y la detección sigue con las demás señales. Se llama
    solo cuando la confianza acumulada aún no alcanza para decidir.
    """
    if not video_id:
        return ""
    try:
        req = urllib.request.Request(
            f"https://www.youtube.com/watch?v={video_id}",
            headers={
                "User-Agent": (
                    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                    "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
                ),
                "Accept-Language": "en-US,en;q=0.9",
            },
        )
        with urllib.request.urlopen(req, timeout=timeout) as r:
            html = r.read(600000).decode("utf-8", "ignore")
        m = re.search(r'"defaultAudioLanguage"\s*:\s*"([\w\-]{2,12})"', html)
        if m:
            return m.group(1)
        m = re.search(r'"audioLanguage"\s*:\s*"([\w\-]{2,12})"', html)
        return m.group(1) if m else ""
    except Exception as exc:
        _log_youtube(
            "idioma_audio_no_disponible",
            video_id,
            error_type=type(exc).__name__,
        )
        return ""


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

def _call_gemini(api_key: str, prompt: str, temperature: float = 0.2, max_tokens: Optional[int] = None) -> str:
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
        generation = {"temperature": temperature, "topP": 0.8}
        # Sin maxOutputTokens Gemini corta en su default y se pierde texto.
        generation["maxOutputTokens"] = int(max_tokens or MAX_TOKENS_TECHO)
        payload = json.dumps({
            "contents": [{"parts": [{"text": prompt}]}],
            "generationConfig": generation,
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


def _call_openrouter(api_key: str, prompt: str, model: Optional[str] = None, max_tokens: Optional[int] = None) -> str:
    model_name = (model or "qwen/qwen3-coder:free").strip()
    url = "https://openrouter.ai/api/v1/chat/completions"
    payload = json.dumps({
        "model": model_name,
        "messages": [{"role": "user", "content": prompt}],
        "temperature": 0.2,
        "max_tokens": int(max_tokens or MAX_TOKENS_TECHO),
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
    max_tokens: Optional[int] = None,
) -> str:
    url = base_url.rstrip("/") + "/chat/completions"
    payload = json.dumps({
        "model": model,
        "messages": [{"role": "user", "content": prompt}],
        "temperature": 0.2,
        "max_tokens": int(max_tokens or MAX_TOKENS_TECHO),
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


def _call_mistral(api_key: str, prompt: str, max_tokens: Optional[int] = None) -> str:
    model = os.environ.get("MISTRAL_MODEL", "mistral-small-latest")
    return _call_openai_compatible(
        "https://api.mistral.ai/v1",
        api_key,
        prompt,
        model,
        label="Mistral",
        max_tokens=max_tokens,
    )


def _call_xai(api_key: str, prompt: str, max_tokens: Optional[int] = None) -> str:
    model = os.environ.get("XAI_MODEL", "grok-3-mini")
    return _call_openai_compatible(
        "https://api.x.ai/v1",
        api_key,
        prompt,
        model,
        label="Grok/xAI",
        max_tokens=max_tokens,
    )


def _call_anthropic(api_key: str, prompt: str, max_tokens: Optional[int] = None) -> str:
    """Claude vía API de mensajes (sin SDK: en Vercel no instalamos dependencias extra)."""
    url = "https://api.anthropic.com/v1/messages"
    payload = json.dumps({
        "model": ANTHROPIC_MODEL,
        # Máximo 16000 sin streaming para no chocar con el timeout HTTP.
        "max_tokens": max(1024, min(16000, int(max_tokens or MAX_TOKENS_TECHO))),
        # Claude Sonnet 5 rechaza temperature/top_p; y para editar texto el
        # razonamiento extendido solo gastaría presupuesto de salida.
        "thinking": {"type": "disabled"},
        "messages": [{"role": "user", "content": prompt}],
    }).encode()
    req = urllib.request.Request(
        url,
        data=payload,
        headers={
            "Content-Type": "application/json",
            "x-api-key": api_key,
            "anthropic-version": ANTHROPIC_VERSION,
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            data = json.loads(r.read())
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", errors="ignore")[:400]
        if e.code == 401:
            raise Exception(
                "Clave de Anthropic inválida o vencida. Genera una nueva en "
                "console.anthropic.com y pégala en Configuración (empieza por sk-ant-)."
            ) from e
        if e.code == 429:
            raise Exception("Límite de uso de Anthropic alcanzado. Espera un momento e inténtalo de nuevo.") from e
        raise Exception(f"Anthropic HTTP {e.code}: {body}") from e
    except Exception as e:
        raise Exception(f"No se pudo contactar a Anthropic: {e}") from e

    if isinstance(data, dict) and data.get("type") == "error":
        detalle = (data.get("error") or {}).get("message") or "error desconocido"
        raise Exception(f"Anthropic: {detalle}")
    if data.get("stop_reason") == "refusal":
        raise Exception("Claude rechazó procesar este texto por sus filtros de seguridad.")

    partes = [
        b.get("text", "")
        for b in (data.get("content") or [])
        if isinstance(b, dict) and b.get("type") == "text"
    ]
    texto = "\n".join(p for p in partes if p).strip()
    if not texto:
        raise Exception("Respuesta vacía de Anthropic")
    return texto


def _llamar_ia(
    provider: str,
    api_key: str,
    prompt: str,
    openrouter_model: Optional[str],
    max_tokens: Optional[int] = None,
) -> tuple:
    p = (provider or "gemini").strip().lower()
    if p == "openrouter":
        return _call_openrouter(api_key, prompt, openrouter_model, max_tokens), "openrouter"
    if p == "mistral":
        return _call_mistral(api_key, prompt, max_tokens), "mistral"
    if p in ("xai", "grok"):
        return _call_xai(api_key, prompt, max_tokens), "xai"
    if p in ("anthropic", "claude"):
        return _call_anthropic(api_key, prompt, max_tokens), "anthropic"
    return _call_gemini(api_key, prompt, max_tokens=max_tokens), "gemini"


def _mejorar_heuristico(texto: str) -> str:
    t = re.sub(r"\r\n|\r", "\n", texto)
    t = re.sub(r" {2,}", " ", t).strip()
    for patron in _MULETILLAS_HEURISTICAS:
        t = patron.sub(" ", t)
    t = _RE_REPETICION_LEGITIMA.sub(_sin_repeticion, t)
    # Al quitar muletillas quedan comas huérfanas («Eh, o sea, bueno» → «, , »).
    t = re.sub(r"\s+([,.:;!?])", r"\1", t)
    t = re.sub(r"(?:[,;:]\s*){2,}", ", ", t)
    t = re.sub(r"([.!?…])\s*[,;:]+\s*", r"\1 ", t)
    t = re.sub(r"^[\s,;:.]+", "", t)
    t = re.sub(r"\n[\s,;:]+", "\n", t)
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


_RE_TS_SOLO = re.compile(
    r"^\[?(?:\d{1,2}:)?\d{1,2}:\d{2}(?:[.,]\d{1,3})?\]?$"
)
_RE_TS_INLINE = re.compile(
    r"(?:^|\s)\[?(?:\d{1,2}:)?\d{1,2}:\d{2}(?:[.,]\d{1,3})?\]?(?=\s|$)"
)
_RE_TS_LINEA = re.compile(
    r"(?m)^\s*\[?(?:\d{1,2}:)?\d{1,2}:\d{2}(?:[.,]\d{1,3})?\]?\s*$"
)


def _limpiar_transcripcion_youtube_cruda(texto: str) -> str:
    """Quita marcas de tiempo y basura típica al pegar el panel de YouTube.

    Formato habitual: línea con hora (0:14) y línea de texto intercaladas.
    También limpia SRT/VTT y horas al inicio de línea.
    """
    if not texto:
        return ""
    crudo = str(texto).replace("\r", "")
    # Si no hay pistas de subtítulos con hora, no reescribir (evitar daño a texto normal)
    if not re.search(r"(?m)^\s*\d{1,2}:\d{2}\b", crudo) and "-->" not in crudo and "WEBVTT" not in crudo.upper():
        # Aun así, quitar horas sueltas tipo " 0:14 " repetidas muchas veces
        if len(re.findall(r"\b\d{1,2}:\d{2}\b", crudo)) < 3:
            return texto.strip()

    partes: list[str] = []
    anterior = ""
    for linea in crudo.split("\n"):
        linea = linea.strip()
        if not linea:
            continue
        if re.match(r"^WEBVTT", linea, re.I):
            continue
        if "-->" in linea:
            continue
        if re.match(r"^\d+$", linea):
            continue
        if re.match(r"^(Kind|Language|NOTE)\s*:", linea, re.I):
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
        # Ruido típico del panel (títulos de sección cortos ya son texto útil; no filtrar)
        partes.append(linea)
        anterior = linea
    limpio = " ".join(partes)
    limpio = re.sub(r"\s{2,}", " ", limpio).strip()
    return limpio or texto.strip()


def _chunk_fallo_traduccion(original: str, traducido: Optional[str]) -> bool:
    """True si el trozo no se tradujo (vacío, idéntico o casi igual)."""
    if not traducido or not str(traducido).strip():
        return True
    o = re.sub(r"\s+", " ", (original or "").strip()).lower()
    t = re.sub(r"\s+", " ", str(traducido).strip()).lower()
    if not t or o == t:
        return True
    # Eco de la API o respuesta que repite el origen
    if len(o) >= 12 and (o in t or t in o) and abs(len(o) - len(t)) < max(8, len(o) * 0.12):
        return True
    return False


def _traduccion_parece_incompleta(original: str, traducido: str, src: str, trg: str) -> bool:
    """Detecta mezclas EN+ES o traducciones que dejaron casi todo el original.

    MyMemory a veces devuelve el inglés sin traducir en trozos fallidos; el
    usuario ve 'mucha información en español y en inglés'. Aquí lo rechazamos
    para forzar IA o error claro.
    """
    if not (traducido or "").strip():
        return True
    o = (original or "").strip()
    t = (traducido or "").strip()
    if not o:
        return False
    if o == t:
        return True
    # Solapamiento de palabras ≥4 letras (sin contar números)
    wo = {w for w in re.findall(r"[A-Za-zÁÉÍÓÚÑáéíóúñ]{4,}", o.lower())}
    wt = {w for w in re.findall(r"[A-Za-zÁÉÍÓÚÑáéíóúñ]{4,}", t.lower())}
    if wo:
        solap = len(wo & wt) / max(1, len(wo))
        # Más del 45 % de las palabras largas del original siguen en la "traducción"
        if solap >= 0.45 and len(wo) >= 12:
            return True
    # Señales de idioma: en→es con muchos marcadores ingleses y pocos españoles
    if src == "en" and trg == "es":
        pad = f" {t.lower()} "
        en_m = (" the ", " and ", " you ", " that ", " with ", " this ", " for ",
                " are ", " have ", " from ", " your ", " about ", " just ", " like ")
        es_m = (" el ", " la ", " de ", " que ", " y ", " en ", " los ", " las ",
                " un ", " una ", " es ", " por ", " con ", " para ", " del ", " se ")
        en_c = sum(1 for m in en_m if m in pad)
        es_c = sum(1 for m in es_m if m in pad)
        if en_c >= 4 and en_c >= es_c:
            return True
    if src == "es" and trg == "en":
        pad = f" {t.lower()} "
        es_m = (" el ", " la ", " de ", " que ", " los ", " las ", " una ", " del ", " para ")
        en_m = (" the ", " and ", " you ", " that ", " with ", " this ", " for ", " are ")
        es_c = sum(1 for m in es_m if m in pad)
        en_c = sum(1 for m in en_m if m in pad)
        if es_c >= 4 and es_c >= en_c:
            return True
    # Longitud muy distinta (resumen u omisión masiva)
    if len(o) > 400 and len(t) < len(o) * 0.45:
        return True
    return False


def _partir_texto_mymemory(texto: str) -> list[str]:
    """Trozos ≤450 caracteres por límites de palabra (textos sin puntuación de YouTube)."""
    texto = (texto or "").strip()
    if not texto:
        return []
    if len(texto) <= 450:
        return [texto]
    trozos: list[str] = []
    for s in re.split(r"(?<=[.!?…])\s+", texto):
        s = s.strip()
        if not s:
            continue
        if len(s) <= 450:
            trozos.append(s)
            continue
        # Sin puntos: cortar por espacios cerca de 400
        palabras = s.split()
        buf: list[str] = []
        n = 0
        for p in palabras:
            extra = len(p) + (1 if buf else 0)
            if buf and n + extra > 400:
                trozos.append(" ".join(buf))
                buf = [p]
                n = len(p)
            else:
                buf.append(p)
                n += extra
        if buf:
            trozos.append(" ".join(buf))
    return trozos or [texto]


def _translate_mymemory_chunked(text: str, src: str, trg: str) -> Optional[str]:
    """Traduce por trozos. Si algún trozo falla, devuelve None (no mezcla idiomas).

    Antes devolvía el inglés original en los trozos fallidos → el usuario veía
    español e inglés a la vez. Ahora: o está completa, o fallamos limpio.
    """
    from concurrent.futures import ThreadPoolExecutor, as_completed

    paragraphs = text.split("\n")
    unidades: list[str] = []
    estructura: list[list[int]] = []

    for para in paragraphs:
        para = para.strip()
        idxs: list[int] = []
        if not para:
            estructura.append(idxs)
            continue
        for ch in _partir_texto_mymemory(para):
            idxs.append(len(unidades))
            unidades.append(ch)
        estructura.append(idxs)

    if not unidades:
        return text

    resultados: dict[int, str] = {}
    fallos = 0
    max_workers = min(8, max(1, len(unidades)))
    with ThreadPoolExecutor(max_workers=max_workers) as pool:
        futuros = {
            pool.submit(_translate_mymemory, ch, src, trg): uid
            for uid, ch in enumerate(unidades)
        }
        for fut in as_completed(futuros):
            uid = futuros[fut]
            original = unidades[uid]
            try:
                t = fut.result()
            except Exception:
                t = None
            if _chunk_fallo_traduccion(original, t):
                fallos += 1
                resultados[uid] = ""
            else:
                resultados[uid] = str(t).strip()

    # Cualquier fallo en texto largo = incompleto (mejor IA que mezcla)
    if fallos > 0:
        # Un solo trozo muy corto: reintento no aplica; señal de fallo total
        if len(unidades) == 1 or fallos / len(unidades) >= 0.05 or fallos >= 2:
            return None

    out_paras = []
    for idxs in estructura:
        if not idxs:
            out_paras.append("")
            continue
        partes = [resultados.get(i, "") for i in idxs]
        if any(not p for p in partes):
            return None
        out_paras.append(" ".join(partes))
    unido = "\n".join(out_paras).strip()
    if _traduccion_parece_incompleta(text, unido, src, trg):
        return None
    return unido


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

# Sincronización de la biblioteca entre dispositivos. Va en su propio módulo:
# este archivo ya es grande y aquello no tiene nada que ver con transcribir.
# El resto del proyecto importa sus módulos como «api.x»; este va igual.
try:
    from api.sync import router as sync_router
    app.include_router(sync_router)
except Exception as _e:  # pragma: no cover
    # Si el módulo falla, la app sigue funcionando sin sincronización, pero
    # el aviso tiene que verse en los registros: si no, el 404 desconcierta.
    print(f"[jg-sync] NO se cargó la sincronización: {type(_e).__name__}: {_e}")

# Portada real de un libro. Va aparte por lo mismo que la sincronización, y
# porque es opcional: sin ella el lector dibuja la carátula y sigue igual.
try:
    from api.portada import router as portada_router
    app.include_router(portada_router)
except Exception as _e:  # pragma: no cover
    print(f"[jg-portada] NO se cargó la búsqueda de portadas: {type(_e).__name__}: {_e}")


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
        # Booleano, nunca la clave: permite verificar el despliegue sin exponerla.
        "youtube_auto": supadata.configurado(),
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
            # Guía para el cliente: en Vercel el body de cada request ~4,5 MB;
            # el frontend parte en trozos de ~90 s / ~3,5 MB.
            "max_upload_chunk_mb": 3.5,
            "max_mic_minutes": 30,
            "max_audio_minutes": MAX_YOUTUBE_MINUTES,
            "max_youtube_minutes": MAX_YOUTUBE_MINUTES,
            "max_youtube_audio_minutes": MAX_YOUTUBE_AUDIO_MINUTES,
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
            str(tmp_path),
            language,
            api_key,
            original_name=nombre,
            context=context,
            fast=bool(fast),
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


def _detectar_idioma_audio(
    texto: str,
    lang_pista: Optional[str],
    pistas: Optional[dict] = None,
    video_id: str = "",
    permitir_consulta_extra: bool = False,
) -> dict:
    """Veredicto sobre el idioma **hablado**, con confianza y evidencia.

    Si las señales locales no alcanzan el umbral de decisión y quien llama lo
    autoriza, se hace un intento extra contra YouTube para leer el idioma de
    audio declarado. Ese intento puede fallar (Vercel está bloqueado) y no
    detiene nada: solo mejora la confianza cuando funciona.
    """
    datos = pistas or {}
    automatica = datos.get("automatica")
    idioma_audio_pista = datos.get("idioma_audio") or ""

    veredicto = deteccion_idioma.detectar(
        texto,
        idioma_pista=lang_pista,
        pista_automatica=automatica,
        audio_declarado=idioma_audio_pista if automatica else "",
    )
    if (
        permitir_consulta_extra
        and veredicto["confianza"] < deteccion_idioma.CONFIANZA_ACEPTAR
    ):
        declarado = _idioma_audio_declarado(video_id)
        if declarado:
            veredicto = deteccion_idioma.detectar(
                texto,
                idioma_pista=lang_pista,
                pista_automatica=automatica,
                audio_declarado=declarado,
            )
    _log_youtube(
        "idioma_audio",
        video_id or "",
        idioma=veredicto.get("idioma"),
        confianza=veredicto.get("confianza"),
        conflicto=veredicto.get("conflicto"),
    )
    return veredicto


def _respuesta_subtitulos(
    texto: str,
    lang: Optional[str],
    titulo: str,
    fuente: str,
    segmentos: Optional[list[dict]] = None,
    deteccion: Optional[dict] = None,
) -> JSONResponse:
    """Forma única de la respuesta de texto ya listo (sin pasar por Whisper)."""
    limpio = _postprocess_texto(texto)
    veredicto = deteccion or deteccion_idioma.detectar(limpio, idioma_pista=lang)
    return JSONResponse({
        "text": limpio,
        "language": lang or "es",
        "title": titulo,
        "source": fuente,
        "segments": segmentos or [],
        "low_confidence_segments": 0,
        "removed_hallucinations": 0,
        "needs_review": False,
        **deteccion_idioma.resumen_para_respuesta(veredicto),
    })


@app.get("/api/youtube-job")
def youtube_job(id: str = "", include_timestamps: bool = False):
    """Consulta un video largo que Supadata procesa en segundo plano.

    El navegador vuelve aquí cada pocos segundos: así un video de una hora no
    choca contra el límite de 60 s de la función.
    """
    job_id = (id or "").strip()
    if not job_id:
        raise HTTPException(status_code=400, detail="Falta el identificador del trabajo.")
    if not supadata.configurado():
        raise HTTPException(status_code=503, detail="El servidor no tiene Supadata configurado.")
    try:
        estado = supadata.estado_job(job_id)
    except SupadataError as exc:
        raise HTTPException(status_code=502, detail=str(exc))
    if estado["estado"] != "completado":
        return JSONResponse({"pending": True, "job_id": job_id}, status_code=202)
    segmentos = estado.get("segmentos") or []
    if include_timestamps and not segmentos:
        raise HTTPException(
            status_code=502,
            detail="La transcripción terminó sin marcas de tiempo utilizables.",
        )
    return _respuesta_subtitulos(
        estado["texto"], estado.get("lang"), "", "subtitles", segmentos,
        _detectar_idioma_audio(estado["texto"], estado.get("lang")),
    )


@app.post("/api/youtube")
async def transcribe_youtube(req: YouTubeRequest):
    if not YT_URL_RE.search(req.url or ""):
        raise HTTPException(status_code=400, detail="URL de YouTube no válida.")

    inicio = time.monotonic()
    idioma = req.language if req.language and req.language != "auto" else None
    idioma_corto = idioma.split("-")[0].lower() if idioma else None
    video_id = _extraer_video_id(req.url)
    titulo = ""
    bloqueo_subtitulos = None
    _log_youtube(
        "inicio",
        video_id or "",
        prefer_subtitles=bool(req.prefer_subtitles),
        fast_mode=bool(req.fast_mode),
    )

    # 1) Subtítulos vía youtube-transcript-api (rápido y suele funcionar en Vercel)
    if req.prefer_subtitles and video_id:
        pistas_subs = {}
        try:
            if req.include_timestamps:
                texto_subs, lang_subs, segmentos_subs, pistas_subs = (
                    _subtitulos_cronometrados_via_transcript_api(video_id, idioma_corto)
                )
            else:
                texto_subs, lang_subs = _subtitulos_via_transcript_api(
                    video_id, idioma_corto
                )
                segmentos_subs = []
        except YouTubeBloqueoIP as exc:
            bloqueo_subtitulos = str(exc)
            _log_youtube(
                "subtitulos_ip_bloqueada",
                video_id,
                error_type=bloqueo_subtitulos,
                elapsed_ms=round((time.monotonic() - inicio) * 1000),
            )
            texto_subs, lang_subs = None, None
        if texto_subs:
            _log_youtube(
                "subtitulos_listos",
                video_id,
                source="youtube-transcript-api",
                elapsed_ms=round((time.monotonic() - inicio) * 1000),
            )
            return _respuesta_subtitulos(
                texto_subs,
                lang_subs or idioma_corto,
                titulo or video_id,
                "subtitles",
                segmentos_subs,
                _detectar_idioma_audio(
                    texto_subs,
                    lang_subs or idioma_corto,
                    pistas_subs,
                    video_id,
                    permitir_consulta_extra=bool(req.include_timestamps),
                ),
            )

    # 2) Supadata: vía principal. Sale por su propia infraestructura (YouTube no
    #    la bloquea) y con mode=auto transcribe con IA los videos sin subtítulos.
    if supadata.configurado():
        try:
            resultado_sd = (
                supadata.transcribir(req.url, idioma_corto, True)
                if req.include_timestamps
                else supadata.transcribir(req.url, idioma_corto)
            )
            if resultado_sd.get("job_id"):
                # Videos de más de 20 min llegan como trabajo en segundo plano.
                job_id = resultado_sd["job_id"]
                _log_youtube("supadata_job", video_id or "", job_id=job_id)
                restante = SUPADATA_ESPERA_SERVIDOR_S - (time.monotonic() - inicio)
                listo = supadata.esperar(job_id, restante)
                if listo:
                    _log_youtube(
                        "supadata_job_listo", video_id or "",
                        intentos=listo.get("intentos", 0),
                    )
                    return _respuesta_subtitulos(
                        listo["texto"], listo.get("lang") or idioma_corto,
                        titulo or video_id, "subtitles", listo.get("segmentos"),
                        _detectar_idioma_audio(
                            listo["texto"], listo.get("lang") or idioma_corto,
                            None, video_id,
                            permitir_consulta_extra=bool(req.include_timestamps),
                        ),
                    )
                # Sigue en curso: el navegador continúa la espera sin bloquear.
                return JSONResponse(
                    {
                        "pending": True,
                        "job_id": job_id,
                        "title": titulo or video_id,
                        "message": "Video largo: se está transcribiendo…",
                    },
                    status_code=202,
                )
            # Con «auto» la API entrega «la primera pista disponible», que puede
            # ser una traducción cualquiera: un video en inglés llegaba en
            # alemán. Si hay una pista en un idioma que la app entiende, la
            # pedimos explícitamente.
            if not idioma_corto:
                mejor = supadata.elegir_idioma(
                    resultado_sd.get("lang", ""), resultado_sd.get("disponibles")
                )
                if mejor:
                    _log_youtube(
                        "supadata_reintento_idioma",
                        video_id or "",
                        recibido=resultado_sd.get("lang"),
                        pedido=mejor,
                    )
                    try:
                        otro = (
                            supadata.transcribir(req.url, mejor, True)
                            if req.include_timestamps
                            else supadata.transcribir(req.url, mejor)
                        )
                        # Si el reintento se vuelve trabajo en segundo plano,
                        # conservamos el texto que ya teníamos: peor idioma es
                        # mejor que hacer esperar al usuario otra vez.
                        if otro.get("texto"):
                            resultado_sd = otro
                    except SupadataError:
                        pass  # nos quedamos con lo que ya teníamos
            _log_youtube(
                "supadata_listo",
                video_id or "",
                lang=resultado_sd.get("lang"),
                elapsed_ms=round((time.monotonic() - inicio) * 1000),
            )
            return _respuesta_subtitulos(
                resultado_sd["texto"], resultado_sd.get("lang") or idioma_corto,
                titulo or video_id, "subtitles", resultado_sd.get("segmentos"),
                _detectar_idioma_audio(
                    resultado_sd["texto"], resultado_sd.get("lang") or idioma_corto,
                    None, video_id,
                    permitir_consulta_extra=bool(req.include_timestamps),
                ),
            )
        except SupadataError as exc:
            # Sin créditos o clave mala son problemas de cuenta: mejor decirlo
            # claro que dejar que el usuario crea que el video es el problema.
            _log_youtube(
                "supadata_error",
                video_id or "",
                codigo=exc.codigo,
                http_status=exc.http_status,
                error=str(exc)[:240],
            )
            if exc.codigo in ("unauthorized", "limit-exceeded", "upgrade-required"):
                raise HTTPException(status_code=402, detail=str(exc))

    # 3) Metadatos + subtítulos yt-dlp (respaldo; falla si YouTube ve datacenter)
    info = None
    ytdlp_error = None
    ydl_common = {
        "quiet": True,
        "no_warnings": True,
        "socket_timeout": 18,
        "retries": 0,
        "fragment_retries": 0,
        "noplaylist": True,
        "user_agent": (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
            "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
        ),
        # Dejar que yt-dlp seleccione el cliente vigente. Forzar "android"
        # provocaba el anti-bot en Vercel y omitía sus fallbacks actuales.
    }
    if YOUTUBE_PROXY_URL:
        ydl_common["proxy"] = YOUTUBE_PROXY_URL
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
            # Este lector histórico entrega texto plano. En el modo sincronizado
            # seguimos al respaldo Whisper para no fingir timestamps inexistentes.
            if req.include_timestamps:
                texto_subs = None
            if texto_subs:
                _log_youtube(
                    "subtitulos_listos",
                    video_id or "",
                    source="yt-dlp",
                    elapsed_ms=round((time.monotonic() - inicio) * 1000),
                )
                return _respuesta_subtitulos(
                    texto_subs, lang_subs or idioma_corto, titulo, "subtitles",
                    None,
                    _detectar_idioma_audio(
                        texto_subs, lang_subs or idioma_corto, None, video_id or "",
                    ),
                )
        if duracion and duracion > MAX_YOUTUBE_AUDIO_MINUTES * 60:
            raise HTTPException(
                status_code=422,
                detail=(
                    "El video no entregó subtítulos y su audio es demasiado largo "
                    f"para procesarlo dentro de Vercel. Máximo sin subtítulos: "
                    f"{MAX_YOUTUBE_AUDIO_MINUTES} minutos. Descarga el audio y súbelo "
                    "en Archivo."
                ),
            )
    except HTTPException:
        raise
    except Exception as e:
        info = None
        ytdlp_error = str(e)
        _log_youtube(
            "metadata_error",
            video_id or "",
            error_type=type(e).__name__,
            error=ytdlp_error[:300],
            elapsed_ms=round((time.monotonic() - inicio) * 1000),
        )

    # 4) Fallback: audio ligero + Whisper turbo (si fast_mode)
    if info is None and ytdlp_error:
        hint = ""
        bloqueado = (
            "Sign in" in ytdlp_error
            or "bot" in ytdlp_error.lower()
            or bool(bloqueo_subtitulos)
        )
        # El texto conserva «bloqueó»/«anti-bot»: el frontend los usa para abrir
        # el pegado de respaldo en vez de dejar al usuario sin salida.
        if bloqueado and not supadata.configurado():
            # Falta la vía principal: es configuración, no un problema del video.
            hint = (
                " YouTube bloqueó al servidor (anti-bot) y la vía automática no está "
                "configurada (falta SUPADATA_API_KEY en Vercel)."
            )
        elif bloqueado:
            hint = " YouTube bloqueó al servidor (anti-bot) y la vía automática tampoco pudo con este video."
        raise HTTPException(
            status_code=503 if hint else 400,
            detail=f"No se pudo procesar el video.{hint}",
        )

    try:
        import yt_dlp
    except ImportError:
        raise HTTPException(status_code=500, detail="yt-dlp no está instalado en el servidor.")

    tmp_id = uuid.uuid4()
    outtmpl = str(TEMP_DIR / f"{tmp_id}.%(ext)s")
    # Audio más pequeño = subida a Groq más rápida (calidad ASR sigue siendo buena)
    ydl_opts = {
        **ydl_common,
        "format": (
            "worstaudio[ext=m4a]/bestaudio[abr<=96][ext=m4a]/"
            "worstaudio[ext=webm]/bestaudio[abr<=96]/worstaudio/bestaudio"
        ),
        "outtmpl": outtmpl,
        "socket_timeout": 20,
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
        if audio_path.suffix.lower() not in FORMATOS_AUDIO:
            raise HTTPException(
                status_code=415,
                detail=(
                    f"YouTube entregó un formato de audio no compatible "
                    f"({audio_path.suffix or 'sin extensión'})."
                ),
            )
        if audio_path.stat().st_size > MAX_AUDIO_BYTES:
            raise HTTPException(
                status_code=413,
                detail=f"El audio del video supera {MAX_AUDIO_MB} MB. Usa un video más corto.",
            )

        # fast_mode (default) usa whisper-large-v3-turbo
        _log_youtube(
            "audio_descargado",
            video_id or "",
            extension=audio_path.suffix.lower(),
            bytes=audio_path.stat().st_size,
            elapsed_ms=round((time.monotonic() - inicio) * 1000),
        )
        resultado = await transcribe_with_groq(
            str(audio_path),
            req.language,
            req.api_key,
            original_name=audio_path.name,
            context=(req.context or "")[:4000],
            # verbose_json es necesario para que Whisper incluya start/end.
            fast=bool(req.fast_mode and not req.include_timestamps),
            timeout_override_s=YOUTUBE_GROQ_TIMEOUT_S,
        )
        if "_error" in resultado:
            raise HTTPException(status_code=500, detail=resultado["_error"])

        resultado["title"] = titulo
        resultado["source"] = "whisper-api"
        # Whisper escucha el audio: su idioma es el idioma hablado, no el de una
        # pista de subtítulos. Es la señal más fiable de toda la cadena.
        resultado.update(deteccion_idioma.resumen_para_respuesta(
            deteccion_idioma.detectar(
                resultado.get("text", ""),
                idioma_pista=resultado.get("language"),
                pista_automatica=True,
            )
        ))
        _log_youtube(
            "whisper_listo",
            video_id or "",
            model=resultado.get("model", ""),
            elapsed_ms=round((time.monotonic() - inicio) * 1000),
        )
        return JSONResponse(resultado)
    except HTTPException:
        raise
    except Exception as e:
        msg = str(e)
        _log_youtube(
            "audio_error",
            video_id or "",
            error_type=type(e).__name__,
            error=msg[:300],
            elapsed_ms=round((time.monotonic() - inicio) * 1000),
        )
        if "Sign in" in msg or "bot" in msg.lower() or "403" in msg:
            raise HTTPException(
                status_code=503,
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

    glosario = (req.context or "").strip()[:1200]

    if api_key and provider_ef != "none":
        def construir_prompt(bloque: str) -> str:
            if (getattr(req, "mode", "transcripcion") or "") == "auditoria_pdf":
                ctx_ant = (req.contexto_anterior or "")[:400]
                ctx_post = (req.contexto_posterior or "")[:400]
                huella = req.huella_origen or ""
                bloque_id = req.bloque_id or "bloque"
                ctx = ""
                if ctx_ant: ctx += f"CONTEXTO ANTERIOR (solo lectura, no lo reescribas):\n<<<\n{ctx_ant}\n>>>\n\n"
                if ctx_post: ctx += f"CONTEXTO POSTERIOR (solo lectura):\n<<<\n{ctx_post}\n>>>\n\n"
                return (
                    f"Eres auditor de puntuación y gramática para PDF en español. Bloque {bloque_id} huella {huella}.\n\n"
                    f"{ctx}"
                    "TAREA: revisa el BLOQUE ACTUAL y devuelve SOLO JSON válido, sin markdown ni texto extra, con:\n"
                    "{\n"
                    '  "signos": [{"pos": 12, "tipo": "coma|punto|apertura", "texto": ","}],\n'
                    '  "propuestas": [{"inicio": 5, "fin": 6, "original": "habia", "sustitucion": "había", "categoria": "tilde", "explicacion": "lleva tilde"}],\n'
                    '  "estructura_sugerida": null,\n'
                    '  "integridad": {"tokens_origen": 20, "tokens_propuestos": 20}\n'
                    "}\n\n"
                    "REGLAS:\n"
                    "- No agregues, elimines, sustituyas ni reordenes palabras léxicas automáticamente: solo signos y propuestas.\n"
                    "- Cifras, URLs, correos, símbolos, unidades y nombres propios NO se modifican.\n"
                    "- Tildes/ortografía/concordancia van como propuestas, no como reemplazo directo.\n"
                    "- Cada token debe aparecer exactamente una vez y en el mismo orden.\n"
                    "- Si no hay cambios, devuelve listas vacías.\n\n"
                    f"BLOQUE ACTUAL:\n<<<\n{bloque}\n>>>"
                )
            if getattr(req, "mode", "transcripcion") == "lectura":
                return (
                    f"Eres corrector de puntuación para lectura en voz alta, en «{lang_base}».\n\n"
                    "Este texto salió de un PDF. Al extraerlo se perdieron puntos, comas y signos "
                    "de apertura, y hay frases que quedaron pegadas o partidas. Alguien va a "
                    "ESCUCHARLO con una voz sintética: si falta un punto, la voz no respira; si "
                    "falta una coma, atropella.\n\n"
                    "TU ÚNICO TRABAJO es devolver EXACTAMENTE LAS MISMAS PALABRAS, EN EL MISMO "
                    "ORDEN, con la puntuación correcta.\n\n"
                    "SÍ debes:\n"
                    "1) Poner los puntos que faltan al final de cada oración.\n"
                    "2) Poner las comas que pide la sintaxis: incisos, enumeraciones, vocativos, "
                    "y antes de «pero», «aunque», «sino», «porque» cuando corresponda.\n"
                    "3) Abrir los signos: ¿…? y ¡…!\n"
                    "4) Poner las tildes que falten y corregir las que estén mal.\n"
                    "5) Mayúscula después de punto y en nombres propios.\n"
                    "6) Separar en párrafos donde claramente cambia el tema, con una línea en blanco.\n"
                    "7) Unir una palabra que quedó partida («compren dido» → «comprendido»).\n\n"
                    "NUNCA debes:\n"
                    "- Cambiar una palabra por otra, ni siquiera por un sinónimo mejor.\n"
                    "- Añadir una sola palabra que no esté en el original.\n"
                    "- Quitar una sola palabra del original.\n"
                    "- Reordenar, resumir, ampliar, explicar ni embellecer.\n"
                    "- Traducir nada.\n"
                    "- Cambiar cifras, nombres propios, marcas, siglas, URLs ni unidades.\n"
                    "- Escribir comentarios, títulos, markdown ni comillas envolventes.\n\n"
                    "Si una frase te parece rara, DÉJALA IGUAL. No es tu trabajo arreglarla. "
                    "Se va a comparar tu salida palabra por palabra con el original: si cambias "
                    "una sola palabra, tu trabajo se descarta entero.\n\n"
                    "SALIDA: solo el texto, en texto plano.\n\n"
                    f"TEXTO:\n<<<\n{bloque}\n>>>"
                )

            extra = (
                f"TÉRMINOS DEL USUARIO (respeta su escritura exacta): {glosario}\n\n"
                if glosario else ""
            )
            proteccion_segmentos = (
                "FORMATO SEGMENTADO OBLIGATORIO:\n"
                "- Copia cada marcador [[JG_SEG_000000]] exactamente, una sola vez y en el mismo orden.\n"
                "- Edita solo el texto que sigue a cada marcador.\n"
                "- No muevas palabras, ideas ni información de un segmento a otro.\n"
                "- No unas ni dividas segmentos. Los marcadores representan tiempos de video.\n\n"
                if req.preserve_segments else ""
            )
            return (
                "Eres un editor conservador especializado en texto hablado y transcripciones ASR.\n"
                f"Idioma de trabajo: «{lang_base}» (variante «{lang}»).\n\n"
                f"{extra}{proteccion_segmentos}"
                "OBJETIVO: corregir únicamente errores evidentes sin reescribir el texto.\n\n"
                "REGLAS OBLIGATORIAS:\n"
                "1) Conserva todas las palabras, significado, intención, orden, hechos, cifras y nombres.\n"
                "2) Corrige solo ortografía, tildes, mayúsculas, espacios y puntuación inequívoca.\n"
                "3) Solo elimina sonidos alargados sin contenido como «ehhh», «mmm» o «esteee» y una "
                "repetición exacta accidental. No elimines «o sea», «digamos», «bueno» ni otras expresiones.\n"
                "4) No reorganices, completes ni embellezcas frases. No cambies el estilo oral.\n"
                "5) Sustituye una palabra mal reconocida únicamente si la corrección es inequívoca. "
                "Ante cualquier duda, conserva la palabra original.\n"
                "6) No resumas, no simplifiques, no agregues y no elimines ideas.\n"
                "7) Conserva exactamente párrafos, saltos, listas y distribución.\n"
                "8) Si el texto se entiende, devuélvelo igual. Haz el mínimo cambio posible.\n\n"
                "SALIDA: solo el texto final, sin markdown, explicaciones, títulos ni comillas envolventes.\n\n"
                f"TEXTO A PULIR:\n<<<\n{bloque}\n>>>"
            )

        def ejecutar(prompt: str, max_tokens: int) -> tuple:
            return _llamar_ia_con_respaldo(
                req.api_key or "", req.provider or "", prompt, req.openrouter_model, max_tokens
            )

        try:
            if (getattr(req, "mode", "") or "") == "auditoria_pdf":
                # Auditoría estructurada: devolver JSON validado
                prompt = construir_prompt(txt)
                bruto, provider_name = _llamar_ia_con_respaldo(
                    req.api_key or "", req.provider or "", prompt, req.openrouter_model, _max_tokens_para(txt)
                )
                limpio = (bruto or "").strip()
                # Extraer JSON aunque venga con bloque
                import json as _js
                m = re.search(r"\{[\s\S]*\}", limpio)
                if m: limpio = m.group(0)
                try:
                    data = _js.loads(limpio)
                except Exception:
                    raise Exception("Respuesta no JSON de auditoría: " + limpio[:300])
                # Validar estructura mínima
                if not isinstance(data.get("signos"), list) and not isinstance(data.get("propuestas"), list):
                    raise Exception("JSON sin signos ni propuestas")
                # Integridad básica
                data.setdefault("bloque_id", req.bloque_id)
                data.setdefault("huella_origen", req.huella_origen)
                data["ia_used"] = True
                data["provider"] = provider_name
                return data
            limpio, provider_name = _procesar_por_bloques(txt, construir_prompt, ejecutar)
            if limpio:
                validacion = validar_texto_transformado(txt, limpio, "pulido")
                respuesta = {
                    "text": limpio,
                    "ia_used": True,
                    "provider": provider_name,
                    # Campos nuevos (aditivos): la UI vieja los ignora sin romperse
                    "validation": validacion,
                    "chunks": len(_dividir_en_bloques(txt)),
                }
                aviso = _aviso_por_integridad(validacion, txt, limpio)
                if aviso:
                    respuesta["aviso"] = aviso
                return respuesta
        except Exception as e:
            error_detail = str(e)
            if (getattr(req, "mode", "") or "") == "auditoria_pdf":
                raise HTTPException(status_code=502, detail=error_detail)

    if (getattr(req, "mode", "") or "") == "auditoria_pdf":
        raise HTTPException(status_code=502, detail=error_detail or "No se pudo auditar el bloque")
    local = _mejorar_heuristico(txt)
    # En auditoría PDF, no usar heurístico como respaldo porque cambia palabras
    if (getattr(req, "mode", "") or "") == "auditoria_pdf":
        raise HTTPException(status_code=502, detail="Auditoría no disponible y respaldo deshabilitado")
    validacion = validar_texto_transformado(txt, local, "pulido")
    respuesta = {
        "text": local,
        "ia_used": False,
        "provider": None,
        "error_detail": error_detail,
        "validation": validacion,
        "chunks": 1,
    }
    aviso = _aviso_por_integridad(validacion, txt, local)
    if aviso:
        respuesta["aviso"] = aviso
    return respuesta


# Calcos del inglés que arruinan una traducción al español. La lista va literal
# dentro del prompt: nombrar el error concreto funciona mucho mejor que pedirle
# al modelo «que suene natural».
_CALCOS_ES = (
    "- «hacer sentido» → «tener sentido»\n"
    "- «aplicar para» (apply) → «postularse a» / «solicitar»\n"
    "- «en orden a» (in order to) → «para»\n"
    "- «soportar» (support) → «admitir» / «permitir»\n"
    "- «remover» (remove) → «quitar»\n"
    "- «eventualmente» (eventually) → «con el tiempo» / «al final»\n"
    "- «asumir» (assume) → «suponer»\n"
    "- «realizar» (realize) → «darse cuenta»\n"
    "- «yo pienso que» → «creo que»: el español no repite el pronombre sujeto\n"
    "- «fue construido por X» → «lo construyó X»: evita la pasiva calcada\n"
)

_REGLAS_ES = (
    "REGLAS DEL ESPAÑOL (obligatorias):\n"
    "- Escribe TODAS las tildes, sobre todo las que cambian el significado: "
    "él/el, más/mas, sí/si, qué/que, cómo/como, sé/se, tú/tu, dé/de, aún/aun.\n"
    "- Abre los signos: ¿…? y ¡…!\n"
    "- Revisa la concordancia de género y número en cada frase.\n"
    "- Une las ideas con conectores naturales (entonces, además, sin embargo, "
    "por eso, así que) en vez de pegar frases sueltas.\n"
    "- Reordena las palabras al orden natural del español; no arrastres el orden "
    "del original.\n"
    "- Español neutro latinoamericano. Trata al lector de «tú» y mantén ese mismo "
    "tratamiento de principio a fin. Si el original ya distingue el trato formal "
    "(usted, señor, sir, Mr.), conserva el «usted».\n"
    "- PROHIBIDO EL VOSEO. Nunca escribas «vos», «tenés», «podés», «querés», "
    "«sabés», «hacés», «hacé», «mirá», «vení», «sos». Se dice «tú tienes», "
    "«puedes», «quieres», «sabes», «haces», «haz», «mira», «ven», «eres».\n"
    "- Evita los regionalismos de un solo país (platicar, ordenador, vale, guay, "
    "tío, chévere): usa la palabra que se entiende en toda Latinoamérica.\n\n"
    "NO USES ESTOS CALCOS DEL INGLÉS:\n" + _CALCOS_ES
)


def _prompt_traducir_bloque(
    src_lang: str,
    trg_lang: str,
    bloque: str,
    literal: bool = False,
    trg_code: str = "",
    titulo: str = "",
    continuidad: str = "",
    terminos: Optional[list] = None,
) -> str:
    """Prompt de traducción por sentido, no palabra por palabra.

    Los subtítulos de YouTube llegan sin puntuación y en minúsculas, así que el
    prompt tiene que reconstruir las oraciones antes de traducir: sin eso la
    salida sale entrecortada por más bueno que sea el modelo.

    ``literal`` es el modo del doblaje sincronizado: conserva los marcadores de
    tiempo intactos, pero YA NO prohíbe puntuar ni pulir (esa prohibición era
    justo lo que hacía sonar mal el español).
    """
    src_es = _LANG_NAMES_ES.get((src_lang or "").lower(), src_lang)
    trg_es = _LANG_NAMES_ES.get((trg_lang or "").lower(), trg_lang)

    contexto = ""
    if titulo or continuidad or terminos:
        contexto = "CONTEXTO (solo para entenderlo; NO lo traduzcas ni lo repitas):\n"
        if titulo:
            contexto += f"- Título del video: {titulo.strip()[:200]}\n"
        if continuidad:
            contexto += (
                "- El bloque anterior terminaba así, ya traducido. Continúa con el "
                "mismo tratamiento, el mismo tono y la misma terminología:\n"
                f"  «…{continuidad.strip()[-300:]}»\n"
            )
        if terminos:
            contexto += "- Terminología ya consolidada: " + ", ".join(terminos[:15]) + "\n"
        contexto += "\n"

    if literal:
        metodo = (
            "FORMATO SEGMENTADO (cada marcador es un tiempo exacto del video):\n"
            "1. Copia CADA marcador [[JG_SEG_000000]] una sola vez, en el mismo "
            "orden y sin cambiar sus dígitos.\n"
            "2. El texto que sigue a un marcador es la traducción DE ESE segmento y "
            "de ningún otro: el marcador 3 lleva lo que decía el segmento 3.\n"
            "3. Una oración puede atravesar varios marcadores. Lee todos los "
            "segmentos juntos para entenderla, y tradúcela de forma natural. Puedes "
            "pasar UNA palabra al marcador vecino si la gramática lo exige, pero "
            "NUNCA corras una idea completa a otro marcador.\n"
            "4. PROHIBIDO terminar antes de tiempo. El último marcador debe llevar "
            "la traducción del ÚLTIMO segmento del original. Si el español te sale "
            "más largo, acorta la redacción; jamás omitas un segmento ni dejes de "
            "traducir el final.\n"
            "5. Antes de responder, comprueba que cada marcador dice lo que decía su "
            "segmento y que no perdiste ninguna idea por el camino.\n"
            "6. Cada segmento traducido debe medir aproximadamente lo mismo que su "
            "original (±25 %), porque el audio tiene que seguir cuadrando con el video.\n"
            "7. Puntúa correctamente aunque el original no traiga puntuación.\n\n"
        )
    else:
        metodo = (
            "MÉTODO (en este orden):\n"
            "1. Lee el bloque completo y entiende de qué trata antes de traducir nada.\n"
            "2. El texto puede venir SIN PUNTUACIÓN y en minúsculas (subtítulos "
            "automáticos). Reconstruye dónde empieza y dónde termina cada oración.\n"
            "3. Traduce por unidades de sentido, no palabra por palabra, y entrega el "
            "texto ya puntuado y con las mayúsculas correctas.\n\n"
        )

    reglas_idioma = _REGLAS_ES if (trg_code or "").lower() == "es" else ""

    return (
        f"Eres un traductor profesional de {src_es} a {trg_es}, especializado en "
        "transcripciones de video habladas.\n"
        f"Objetivo: que el resultado se lea como si la persona del video hablara "
        f"{trg_es} desde el principio, no como una traducción.\n\n"
        f"{contexto}"
        f"{metodo}"
        "PROHIBIDO:\n"
        "- Traducir palabra por palabra o conservar el orden de palabras del original.\n"
        "- Resumir, omitir, agregar información, comentar o poner títulos.\n"
        "- Dejar cualquier frase sin traducir.\n"
        "- Traducir literalmente las muletillas del habla (you know, like, I mean, "
        "so, right?, kind of): se omiten o se resuelven con un conector natural.\n\n"
        "CONSERVA EXACTAMENTE: nombres propios, marcas, términos técnicos (API, AI, "
        "PowerPoint), URLs, correos, cifras, unidades y porcentajes.\n"
        "MANTÉN EL REGISTRO: si el original es informal, la traducción es informal; "
        "si es técnico, es técnico.\n\n"
        f"{reglas_idioma}"
        "SALIDA: solo la traducción, en texto plano. Sin markdown, sin comillas "
        "envolventes, sin explicaciones.\n\n"
        f"TEXTO A TRADUCIR:\n<<<\n{bloque}\n>>>"
    )


def _marcadores_segmento(texto: str) -> list:
    return re.findall(r"\[\[JG_SEG_\d{6}\]\]", texto or "")


def _validar_marcadores_segmento(original: str, salida: str) -> str:
    esperados = _marcadores_segmento(original)
    if esperados and _marcadores_segmento(salida) != esperados:
        raise Exception("La IA alteró los marcadores temporales del doblaje.")
    return salida


def _prompt_revisar_traduccion(
    src_lang: str,
    trg_lang: str,
    original: str,
    traduccion: str,
    trg_code: str = "",
) -> str:
    """Segunda pasada: corrige el idioma destino sin desviarse del sentido.

    Recibe el original Y la traducción a propósito. Un corrector que solo ve la
    traducción «arregla» inventando; viendo los dos lados corrige la forma sin
    tocar el fondo.
    """
    src_es = _LANG_NAMES_ES.get((src_lang or "").lower(), src_lang)
    trg_es = _LANG_NAMES_ES.get((trg_lang or "").lower(), trg_lang)
    reglas_idioma = _REGLAS_ES if (trg_code or "").lower() == "es" else ""

    return (
        f"Eres corrector de estilo de {trg_es}. Recibes un texto original en "
        f"{src_es} y su traducción al {trg_es}. Tu trabajo es dejar la traducción "
        "impecable, no volver a traducirla.\n\n"
        "CORRIGE SOLO ESTO:\n"
        "- Tildes y ortografía.\n"
        "- Concordancia de género y número.\n"
        "- Preposiciones y puntuación.\n"
        "- Orden de palabras antinatural, calcos del original y repeticiones torpes.\n"
        "- Frases pegadas sin conector.\n\n"
        "PROHIBIDO:\n"
        "- Cambiar el significado o el tono.\n"
        "- Agregar o quitar información, ejemplos o frases.\n"
        "- Alterar cifras, nombres propios, marcas, URLs o términos técnicos.\n"
        "- Resumir o alargar.\n"
        "- Comentar lo que corregiste.\n\n"
        f"{reglas_idioma}"
        f"SALIDA: solo la traducción corregida, en texto plano. Si ya está bien, "
        "devuélvela igual.\n\n"
        f"ORIGINAL EN {src_es.upper()} (referencia, NO lo traduzcas de nuevo):\n"
        f"<<<\n{original}\n>>>\n\n"
        f"TRADUCCIÓN AL {trg_es.upper()} (corrige esta):\n"
        f"<<<\n{traduccion}\n>>>"
    )


@app.post("/api/translate")
async def translate(req: TranslateRequest):
    txt = (req.text or "").strip()
    if not txt:
        raise HTTPException(status_code=400, detail="Texto vacío.")

    # Si el usuario pega la transcripción cruda de YouTube (con 0:00, 0:01…),
    # quitar marcas de tiempo antes de traducir para no ensuciar la salida.
    txt = _limpiar_transcripcion_youtube_cruda(txt)

    src_code, trg_code, src_lang, trg_lang = _parse_translate_direction(req.direction)

    api_key, provider_ef = _resolver_ia(req.api_key or "", req.provider or "")
    error_detail = None

    hay_ia = bool(api_key and provider_ef != "none")

    def _via_mymemory() -> Optional[dict]:
        try:
            translated_text = _translate_mymemory_chunked(txt, src_code, trg_code)
            if not translated_text or not translated_text.strip():
                return None
            if _traduccion_parece_incompleta(txt, translated_text, src_code, trg_code):
                return None
            return _respuesta_traduccion(
                txt,
                translated_text,
                src_code,
                trg_code,
                None,
                False,
                error_detail=None,
            )
        except Exception:
            return None

    def _via_ia() -> Optional[dict]:
        nonlocal error_detail
        revision_aplicada = bool(req.revisar)
        if not hay_ia:
            return None

        def construir(bloque: str, anterior: str = "", terminos=None) -> str:
            return _prompt_traducir_bloque(
                src_lang,
                trg_lang,
                bloque,
                req.literal,
                trg_code,
                req.titulo_video,
                anterior,
                terminos,
            )

        def ejecutar(prompt: str, max_tokens: int):
            return _llamar_ia_con_respaldo(
                req.api_key or "",
                req.provider or "",
                prompt,
                req.openrouter_model,
                max_tokens,
            )

        def revisar(original: str, traduccion: str) -> str:
            nonlocal revision_aplicada
            if not req.revisar:
                return traduccion
            try:
                corregido, _ = ejecutar(
                    _prompt_revisar_traduccion(
                        src_lang, trg_lang, original, traduccion, trg_code
                    ),
                    _max_tokens_para(traduccion),
                )
                corregido = _limpiar_respuesta_ia(corregido or "")
                if not corregido:
                    revision_aplicada = False
                    return traduccion
                _validar_marcadores_segmento(original, corregido)
                if _traduccion_parece_incompleta(original, corregido, src_code, trg_code):
                    revision_aplicada = False
                    return traduccion
                return corregido
            except Exception:
                revision_aplicada = False
                return traduccion

        try:
            if len(txt) > 2200:
                translated, provider_name = _procesar_por_bloques(
                    txt,
                    construir,
                    ejecutar,
                    continuidad=True,
                    procesar_salida=revisar,
                )
            else:
                translated, provider_name = ejecutar(construir(txt), _max_tokens_para(txt))
                translated = _limpiar_respuesta_ia(translated or "")
                _validar_marcadores_segmento(txt, translated)
                translated = revisar(txt, translated)
            if not translated or not str(translated).strip():
                return None
            translated = _sin_enfasis_markdown(str(translated).strip())
            _validar_marcadores_segmento(txt, translated)
            if _traduccion_parece_incompleta(txt, translated, src_code, trg_code):
                error_detail = (
                    "La IA devolvió una traducción incompleta o mezclada; "
                    "intenta de nuevo o divide el texto."
                )
                return None
            respuesta = _respuesta_traduccion(
                txt,
                translated,
                src_code,
                trg_code,
                provider_name,
                True,
                model=_modelo_de_proveedor(provider_name, req.openrouter_model),
            )
            respuesta["revisado"] = revision_aplicada
            return respuesta
        except Exception as e:
            error_detail = str(e)
        return None

    if hay_ia:
        ia = _via_ia()
        if ia:
            return ia

    rapido = _via_mymemory()
    if rapido:
        if error_detail and isinstance(rapido, dict):
            rapido = {**rapido, "error_detail": error_detail}
        rapido["revisado"] = False
        return rapido

    raise HTTPException(
        status_code=500,
        detail=(
            error_detail
            or "No se pudo traducir el texto completo. Revisa la conexión o la clave de IA "
            "en Configuración e inténtalo de nuevo."
        ),
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
        lang_base = lang.split("-")[0].lower()
        lang_name = {
            "es": "español", "en": "inglés", "fr": "francés",
            "pt": "portugués", "de": "alemán", "it": "italiano",
        }.get(lang_base, lang_base)
        variante = _NOMBRE_VARIANTE.get(lang.lower(), "")
        glosario = (req.context or "").strip()[:1200]

        def construir_prompt(bloque: str) -> str:
            bloque_variante = (
                f"Variante regional del hablante: {variante}. Respeta su vocabulario "
                "y su forma de tratar (tú/usted/vos); no lo cambies a otra variante.\n"
                if variante else ""
            )
            bloque_glosario = (
                f"TÉRMINOS DEL USUARIO (escritura correcta obligatoria): {glosario}\n"
                if glosario else ""
            )
            confusiones = _CONFUSIONES_PROMPT if lang_base == "es" else ""
            return (
                f"Eres un especialista en corrección de transcripciones de voz a texto en {lang_name}.\n"
                f"{bloque_variante}"
                "El texto fue generado por Whisper (ASR) y suele tener errores.\n\n"
                f"{bloque_glosario}"
                f"{confusiones}"
                "OTROS ERRORES TÍPICOS DEL ASR:\n"
                "- Homófonos y confusiones fonéticas (casa/caza, voto/boto, bello/vello)\n"
                "- Palabras inventadas, partidas («in formación») o pegadas («enel»)\n"
                "- Números escritos a medias («veinte mil quinientos» → 20.500 solo si el contexto lo pide)\n"
                "- Tildes, mayúsculas y signos ¿ ¡ ausentes\n"
                "- Puntuación rota y bucles de sílabas o frases\n\n"
                "INSTRUCCIONES:\n"
                "1) Lee todo el bloque y detecta el tema antes de corregir.\n"
                "2) Corrige solo lo necesario para que se lea como lo que un humano escribió de lo hablado.\n"
                "3) No resumas, no embellezcas el estilo, no cambies el tono ni el orden de las ideas.\n"
                "4) No inventes datos, ejemplos ni frases nuevas.\n"
                "5) Conserva jerga, tecnicismos y regionalismos.\n"
                "6) DEVUELVE EL TEXTO COMPLETO: nunca cortes ni uses «…» o «[continúa]».\n\n"
                "SALIDA: solo el texto corregido en texto plano. Sin markdown ni explicaciones.\n\n"
                f"TRANSCRIPCIÓN:\n<<<\n{bloque}\n>>>"
            )

        def ejecutar(prompt: str, max_tokens: int) -> tuple:
            return _llamar_ia_con_respaldo(
                req.api_key or "", req.provider or "", prompt, req.openrouter_model, max_tokens
            )

        try:
            limpio, provider_name = _procesar_por_bloques(corregido, construir_prompt, ejecutar)
            if limpio:
                validacion = validar_texto_transformado(txt, limpio, "correccion")
                respuesta = {
                    "text": limpio,
                    "ia_used": True,
                    "provider": provider_name,
                    "method": "ia",
                    "matches": 1 if limpio != txt else 0,
                    # Campos nuevos (aditivos)
                    "validation": validacion,
                    "chunks": len(_dividir_en_bloques(corregido)),
                }
                aviso = _aviso_por_integridad(validacion, txt, limpio)
                if aviso:
                    respuesta["aviso"] = aviso
                return respuesta
        except Exception as e:
            error_detail = str(e)

    validacion = validar_texto_transformado(txt, corregido, "correccion")
    respuesta = {
        "text": corregido,
        "ia_used": False,
        "provider": None,
        "method": "local" if corregido != txt else "none",
        "matches": 1 if corregido != txt else 0,
        "error_detail": error_detail,
        "validation": validacion,
        "chunks": 1,
    }
    aviso = _aviso_por_integridad(validacion, txt, corregido)
    if aviso:
        respuesta["aviso"] = aviso
    return respuesta


# LanguageTool mete reglas de estilo discutibles («redundancia», «palabra
# coloquial»). Solo aplicamos ortografía, tildes y gramática dura.
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
    # Baja confianza: varias alternativas muy distintas → mejor no tocar.
    if len(replacements) > 3:
        return False
    valor = (replacements[0].get("value") or "").strip()
    if not valor:
        return False
    return True


@app.post("/api/correct")
async def correct_text(req: CorrectRequest):
    """Corrección de texto: IA del servidor (preferida) + LanguageTool de respaldo."""
    txt = (req.text or "").strip()
    if not txt:
        raise HTTPException(status_code=400, detail="Texto vacío.")

    error_detail_ia = None

    # 1) IA (Mistral/Gemini/etc. del servidor o del cliente)
    api_key, provider_ef = _resolver_ia(req.api_key or "", req.provider or "")
    if api_key and provider_ef != "none":
        lang = req.language if req.language and req.language != "auto" else "es"
        lang_base = lang.split("-")[0]
        prompt = (
            f"Eres corrector ortográfico y gramatical en «{lang_base}».\n"
            "Corrige ortografía, tildes, gramática, puntuación y mayúsculas.\n"
            "No reescribas el estilo ni el contenido. No inventes datos.\n"
            "SALIDA: solo el texto corregido en texto plano. Sin markdown.\n\n"
            f"TEXTO:\n<<<\n{txt}\n>>>"
        )
        try:
            improved, provider_name = _llamar_ia_con_respaldo(
                req.api_key or "", req.provider or "", prompt,
                getattr(req, "openrouter_model", None),
                _max_tokens_para(txt),
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
        except Exception as e:
            # No silenciar: el fallback de LanguageTool/local incluye el detalle
            error_detail_ia = str(e)

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
        omitidos = 0
        for m in matches:
            if not _match_languagetool_confiable(m):
                omitidos += 1
                continue
            replacements = m.get("replacements") or []
            start = m["offset"]
            end = start + m["length"]
            corregido = corregido[:start] + replacements[0]["value"] + corregido[end:]
            aplicados += 1
        return {
            "text": corregido,
            "matches": aplicados,
            "ia_used": False,
            "method": "languagetool",
            "error_detail": error_detail_ia,
            # Campo nuevo (aditivo): sugerencias de estilo que NO aplicamos
            "skipped_suggestions": omitidos,
        }
    except Exception as e:
        corregido = _mejorar_heuristico(txt)
        return {
            "text": corregido,
            "matches": 1 if corregido != txt else 0,
            "ia_used": False,
            "method": "local",
            "error_detail": error_detail_ia or str(e),
        }


_KW_IMAGEN = (
    "midjourney", "dall-e", "dalle", "flux", "stable diffusion", "ideogram", "leonardo",
    "niji", "--ar", "--v ", "--style", "negative prompt", "ilustra", "dibuja", "pinta",
    "logo", "poster", "afiche", "fotografía de", "foto de", "render", "wallpaper",
    "imagen de", "retrato", "8k", "fotorrealista",
)
_KW_VIDEO = (
    "sora", "veo", "kling", "runway", "pika", "luma", "seedance", "hailuo",
    "video de", "vídeo de", "genera un video", "animación", "animacion", "clip de",
    "cámara lenta", "slow motion", "timelapse", "plano secuencia", "fps", "b-roll",
)


def _detectar_modalidad(texto: str) -> str:
    """Detecta si el prompt es para texto (llm), imagen o video."""
    t = (texto or "").lower()
    puntos_img = sum(1 for k in _KW_IMAGEN if k in t)
    puntos_vid = sum(1 for k in _KW_VIDEO if k in t)
    if puntos_vid and puntos_vid >= puntos_img:
        return "video"
    if puntos_img:
        return "imagen"
    return "llm"


# Motor unificado de «Mejorar prompt»: maestro-prompts + ingenieria-prompts-profesional.
_SKILL_PROMPT_DEFAULT = "prompt-maestro-unificado"


def _dialecto_modelo(target: str, modalidad: str) -> str:
    t = (target or "auto").lower()
    if modalidad == "imagen":
        if t in {"midjourney", "niji"}:
            return (
                "Dialecto Midjourney: una sola línea en inglés, de lo importante a lo accesorio; "
                "parámetros reales al final (--ar, --v, --style raw, --no). No inventes flags."
            )
        return (
            f"Dialecto imagen ({t}): prosa densa en inglés, 1–2 frases. Sin parámetros con guiones "
            "salvo que el modelo los documente. Sustantivos concretos > adjetivos vacíos (evita ultra/8K apilados)."
        )
    if modalidad == "video":
        return (
            f"Dialecto video ({t}): un plano cinematográfico en inglés; una acción por clip; "
            "movimiento de cámara explícito; audio (diálogo/ambiente/música) si el modelo lo soporta."
        )
    if t in {"claude", "anthropic"}:
        return (
            "Dialecto Claude: puedes usar etiquetas tipo <rol> <contexto> <tarea> <formato> "
            "o secciones claras en texto plano. Buen seguimiento de instrucciones largas."
        )
    if t in {"gpt", "chatgpt", "openai"}:
        return (
            "Dialecto GPT/ChatGPT: Markdown ligero o secciones ##; JSON si la salida alimenta un sistema. "
            "En GPTs personalizados, segunda persona («Eres…», «Cuando el usuario…»)."
        )
    if t in {"gemini"}:
        return (
            "Dialecto Gemini: Markdown claro; contexto al inicio y tarea crítica al final "
            "(evita perder el medio en prompts largos)."
        )
    return (
        "Dialecto neutro (texto plano): secciones con encabezados en MAYÚSCULAS entre corchetes "
        "solo si aportan claridad. Debe pegarse en cualquier chat sin editar."
    )


def _plantilla_ingenieria_prompt(modalidad: str, target: str, idioma: str) -> str:
    """System unificado: lo mejor de maestro-prompts + ingenieria-prompts-profesional.

    No fuerza plantilla rígida: adapta estructura a la complejidad del pedido.
    Salida: solo el prompt listo para pegar (la UI de JG Turbo lo muestra tal cual).
    """
    dialecto = _dialecto_modelo(target, modalidad)
    base = (
        "Eres el motor unificado «prompt-maestro-unificado» de JG Turbo.\n"
        "Combinas: (A) skill maestro-prompts — anatomía, dialectos por modelo, rúbrica de 8 fallas, "
        "positivo>negativo, 150–300 palabras; y (B) skill ingenieria-prompts-profesional — "
        "dirigir no comandar, R+A+T+F, 5 pasos, agentes con stop rule.\n\n"
        "META: reescribir el prompt del usuario para que, al pegarlo tal cual en la IA destino, "
        "produzca el resultado deseado a la primera. Debe sentirse natural y coherente con lo que "
        "el usuario pidió, NO un formulario genérico de corchetes vacíos.\n\n"
        "PROCESO INTERNO (no lo imprimas como ensayo):\n"
        "1) Conserva la intención, hechos y voz útil del original. No cambies el objetivo.\n"
        "2) Audita solo las fallas que apliquen (máx. 3–4 de alto impacto):\n"
        "   objetivo difuso · contexto ausente · sin formato · adjetivos vacíos · negaciones en cadena ·\n"
        "   sobrecarga de tareas · pide certeza imposible · dialecto equivocado del modelo.\n"
        "3) Elige complejidad (OBLIGATORIO respetar):\n"
        "   · SIMPLE (la mayoría de posts, emails, resúmenes, «hazme un…») →\n"
        "     rol breve + tarea + criterios + formato + 2 límites. SIN stop rule, SIN módulo de feedback,\n"
        "     SIN secciones de agente.\n"
        "   · MEDIA → rol + audiencia + contexto + tarea + criterios + formato + límites.\n"
        "   · COMPLEJA / system prompt de asistente → anatomía completa 7 capas.\n"
        "   · AGENTE solo si el usuario pide coach, simulación, rol interactivo o entrevista →\n"
        "     entonces sí: tipo de interacción + STOP RULE + feedback al cerrar.\n"
        "   PROHIBIDO añadir STOP RULE o «módulo de feedback» a un prompt simple de contenido.\n"
        "4) Técnicas solo si suman: few-shot (formato rígido), CoT (lógica/cálculo), JSON (integraciones).\n"
        "   No apiles CoT+ToT+10 ejemplos por relleno.\n"
        "5) Define adjetivos («profesional» → «tono formal, sin jerga, 2ª persona, frases ≤20 palabras»).\n"
        "6) Positivo > negativo; 2–5 «NO hagas…» solo si son críticos.\n"
        "7) Sin teatro («eres el mejor del universo con 50 años…»).\n"
        "8) Datos del negocio que falten: [COMPLETA: dato]. Nunca inventes precios, cifras ni nombres.\n"
        "9) Parámetros de modelo: solo reales. Si dudas: [VERIFICAR] o lenguaje natural universal.\n"
        "10) Extensión del prompt mejorado: ~120–320 palabras (salvo system de agente un poco más largo).\n"
        "11) Si el original ya es bueno en alguna parte, reutilízala; no reescribas por reescribir.\n\n"
        f"{dialecto}\n"
        f"Modalidad: {modalidad.upper()}. Destino: {target}.\n"
        f"Idioma del prompt de trabajo (texto): {idioma}. "
        "Imagen/video: prompt principal en INGLÉS + una línea ES: con traducción.\n\n"
    )

    if modalidad == "imagen":
        return (
            base
            + "SALIDA — SOLO el prompt de imagen mejorado:\n"
            "- Inglés, una o dos líneas (o una línea + parámetros Midjourney si aplica).\n"
            "- Orden: sujeto concreto + acción/pose + entorno + estilo + iluminación + "
            "cámara/composición + calidad útil (sin apilar ultra/8K).\n"
            "- Una idea por imagen. Texto en la imagen entre comillas solo si el usuario lo pidió.\n"
            f"- Última línea: ES: (traducción al {idioma}).\n"
            "- Sin markdown, sin diagnóstico, sin «aquí tienes».\n"
        )

    if modalidad == "video":
        return (
            base
            + "SALIDA — SOLO el prompt de video mejorado:\n"
            "- Inglés, prosa de UN plano: tipo de plano + movimiento de cámara + sujeto + "
            "UNA acción continua + entorno + iluminación + estilo + audio si aplica.\n"
            "- Duración implícita 5–10 s. Sin dos acciones que no quepan en un clip.\n"
            f"- Última línea: ES: (traducción al {idioma}).\n"
            "- Sin markdown, sin diagnóstico, sin «aquí tienes».\n"
        )

    return (
        base
        + "SALIDA — SOLO el prompt de texto mejorado en TEXTO PLANO:\n"
        "- Es un prompt dirigido a una IA (segunda persona o «Eres…»), listo para copiar y pegar.\n"
        "- Sin markdown pesado (evita ** y ```). Puedes usar líneas y guiones simples.\n"
        "- Pedidos simples de contenido (posts, copys, emails): estructura compacta, sin STOP RULE.\n"
        "- Solo si es un agente interactivo: [STOP RULE] y feedback al cerrar.\n"
        "- Si faltan datos del negocio del usuario (nombre de marca, ciudad, precio), usa "
        "[COMPLETA: …] una vez; no inventes la marca.\n"
        "- Si mezcla varias tareas: deja UNA principal.\n"
        f"- Idioma del prompt: {idioma}.\n"
        "- Anti-alucinación si pide datos/hechos: «Si no tienes la información, dilo; no inventes».\n"
    )


def _plantilla_local_por_modalidad(prompt: str, modalidad: str, target: str, objetivo: str) -> str:
    """Fallback sin IA: reestructura el pedido real del usuario (no plantilla vacía)."""
    pedido = " ".join((prompt or "").strip().split())
    if len(pedido) > 900:
        pedido = pedido[:900] + "…"
    linea_objetivo = f"Uso previsto: {objetivo.strip()}\n" if (objetivo or "").strip() else ""

    if modalidad == "imagen":
        params = (
            " --ar 16:9 --v 7 --style raw"
            if target in {"midjourney", "niji", "auto"}
            else ""
        )
        return (
            f"Professional image of the following idea, concrete subject and clear composition, "
            f"natural lighting, intentional camera angle, no cluttered background: {pedido}."
            f"{params}\n"
            f"ES: Imagen profesional de: {pedido}. Iluminación natural, composición clara, sin fondo saturado."
        )

    if modalidad == "video":
        return (
            f"Slow dolly-in shot: {pedido}, single continuous action, realistic motion, "
            f"cinematic lighting, shallow depth of field, ambient sound if supported.\n"
            f"ES: Plano con dolly-in lento: {pedido}. Una sola acción continua, luz cinematográfica."
        )

    # Texto/LLM: envolver el pedido del usuario en estructura mínima coherente
    return (
        f"[ROL]\n"
        f"Eres un especialista capaz de completar con precisión la siguiente petición del usuario.\n\n"
        f"[CONTEXTO]\n"
        f"{linea_objetivo}"
        f"Pedido original del usuario (conserva su intención y datos):\n{pedido}\n\n"
        f"[TAREA]\n"
        f"Resuelve el pedido de forma completa y accionable. Si faltan datos críticos del negocio, "
        f"marca [COMPLETA: dato] en lugar de inventar.\n\n"
        f"[CRITERIOS DE CALIDAD]\n"
        f"- Fidelidad a la intención del usuario\n"
        f"- Respuesta clara, concreta y usable sin relleno\n"
        f"- Sin inventar cifras, nombres, fuentes ni promesas\n\n"
        f"[FORMATO DE SALIDA]\n"
        f"Español; estructura legible con secciones cortas; listo para copiar y usar.\n\n"
        f"[LÍMITES]\n"
        f"- No uses teatro del tipo «eres el mejor del universo».\n"
        f"- Si no sabes algo con certeza, dilo en vez de inventarlo."
    )


@app.post("/api/improve-prompt")
async def improve_prompt(req: ImprovePromptRequest):
    """Mejora un prompt con el motor unificado maestro-prompts + ingenieria profesional."""
    prompt = (req.prompt or "").strip()
    if not prompt:
        raise HTTPException(status_code=400, detail="Prompt vacío. Escribe el prompt que quieres mejorar.")
    if len(prompt) > 8000:
        raise HTTPException(status_code=400, detail="El prompt es demasiado largo (máx. 8000 caracteres).")

    modalidad = _detectar_modalidad(prompt)
    target = (req.target_model or "auto").lower()
    if target == "auto":
        target = {"imagen": "midjourney", "video": "veo"}.get(modalidad, "gemini")

    api_key, provider_ef = _resolver_ia(req.api_key or "", req.provider or "")
    error_detail = None
    idioma_out = (req.idioma_salida or "es").strip() or "es"
    objetivo_extra = (req.objetivo or "").strip()

    if api_key and provider_ef != "none":
        system = _plantilla_ingenieria_prompt(modalidad, target, idioma_out)
        user_msg = (
            " Reescribe el prompt del usuario aplicando el motor unificado.\n"
            "IMPORTANTE: el resultado debe ser el prompt FINAL listo para pegar en la IA, "
            "no una plantilla con huecos inventados. Conserva la intención del original.\n\n"
            f"PROMPT ORIGINAL:\n<<<\n{prompt}\n>>>"
        )
        if objetivo_extra:
            user_msg += f"\n\nPARA QUÉ LO USARÁ: {objetivo_extra}"
        user_msg += (
            "\n\nDevuelve ÚNICAMENTE el prompt mejorado (texto plano). "
            "Sin diagnóstico, sin explicaciones, sin comillas envolventes, sin ```."
        )
        try:
            # Un poco más de creatividad controlada mejora reescrituras de prompts
            improved, provider_name = _llamar_ia_con_respaldo(
                req.api_key or "", req.provider or "",
                system + "\n\n" + user_msg, req.openrouter_model,
                _max_tokens_para(prompt, factor=3.2, minimo=1800),
            )
            if improved:
                listo = _extraer_prompt_listo(improved)
                # Evitar devolver plantillas casi vacías de corchetes
                if listo and listo.count("[") >= 6 and listo.count("COMPLETA") >= 3 and len(prompt) > 40:
                    # Si el modelo rellenó de huecos, forzar un reintento más directo
                    retry_msg = (
                        system
                        + "\n\nEl intento anterior quedó demasiado genérico. "
                        " Reescribe de nuevo el prompt del usuario de forma CONCRETA, "
                        "usando el contenido real del original. Mínimo de huecos [COMPLETA].\n\n"
                        f"PROMPT ORIGINAL:\n<<<\n{prompt}\n>>>\n\n"
                        "Solo el prompt final en texto plano."
                    )
                    try:
                        improved2, provider_name = _llamar_ia_con_respaldo(
                            req.api_key or "", req.provider or "",
                            retry_msg, req.openrouter_model,
                            _max_tokens_para(prompt, factor=3.2, minimo=1800),
                        )
                        listo2 = _extraer_prompt_listo(improved2 or "")
                        if listo2:
                            listo = listo2
                    except Exception:
                        pass
                if listo:
                    return {
                        "improved": listo,
                        "prompt_listo": listo,
                        "ia_used": True,
                        "provider": provider_name,
                        "modalidad": modalidad,
                        "target_model": target,
                        "skill": _SKILL_PROMPT_DEFAULT,
                        "error_detail": None,
                    }
        except Exception as e:
            error_detail = str(e)

    plantilla = _plantilla_local_por_modalidad(prompt, modalidad, target, objetivo_extra)
    return {
        "improved": plantilla,
        "prompt_listo": plantilla,
        "ia_used": False,
        "provider": None,
        "modalidad": modalidad,
        "target_model": target,
        "skill": _SKILL_PROMPT_DEFAULT,
        "error_detail": error_detail,
    }


class PdfAskRequest(BaseModel):
    """Pregunta sobre el contenido de un PDF ya extraído en el navegador.

    El texto llega recortado desde el cliente (los fragmentos relevantes),
    nunca el libro entero: no cabría en el prompt ni en el límite de subida.
    """
    text: str
    question: str = ""
    mode: str = "pregunta"          # pregunta | resumen | ideas
    title: str = ""
    language: str = "es"
    provider: str = "gemini"
    api_key: str = ""
    openrouter_model: Optional[str] = None


# Techo de contexto: por encima de esto el prompt se vuelve caro y lento sin
# mejorar la respuesta. El cliente ya manda solo los trozos que vienen al caso.
_PDF_MAX_CONTEXTO = 16000
# Por debajo de esto no hay nada que resumir de verdad (unas 30 palabras).
_PDF_MIN_PARA_RESUMIR = 200


@app.post("/api/pdf-ask")
async def pdf_ask(req: PdfAskRequest):
    texto = (req.text or "").strip()
    if not texto:
        raise HTTPException(status_code=400, detail="No hay texto del documento.")

    modo = (req.mode or "pregunta").strip().lower()
    if modo not in ("pregunta", "resumen", "ideas", "sintesis"):
        modo = "pregunta"

    pregunta = (req.question or "").strip()[:600]
    if modo == "pregunta" and not pregunta:
        raise HTTPException(status_code=400, detail="Escribe una pregunta sobre el documento.")

    # Resumir cuatro palabras no es resumir: es invitar al modelo a inventar un
    # documento entero (comprobado en producción con un texto de 21 caracteres).
    # Sin material suficiente, mejor no gastar una consulta y decirlo claro.
    if modo in ("resumen", "ideas", "sintesis") and len(texto) < _PDF_MIN_PARA_RESUMIR:
        raise HTTPException(
            status_code=400,
            detail=(
                "El texto es demasiado corto para resumirlo. "
                "Abre un documento con más contenido o usa «Preguntar» sobre lo que ya tienes."
            ),
        )

    contexto = texto[:_PDF_MAX_CONTEXTO]
    titulo = (req.title or "").strip()[:200]
    lang = (req.language or "es").split("-")[0].lower() or "es"

    api_key, provider_ef = _resolver_ia(req.api_key or "", req.provider or "")
    if not api_key or provider_ef == "none":
        raise HTTPException(
            status_code=400,
            detail=(
                "No hay clave de IA configurada. Añádela en «Servidor e IA» "
                "para poder preguntarle al documento."
            ),
        )

    encabezado = (
        "Eres un asistente que responde ÚNICAMENTE con lo que dice el documento "
        "que te entregan. No usas conocimiento propio ni rellenas huecos.\n\n"
        "REGLAS OBLIGATORIAS:\n"
        "1) Si el fragmento no contiene la respuesta, dilo con estas palabras: "
        "«El documento, en la parte que revisé, no dice nada sobre eso». "
        "Nunca inventes datos, cifras, nombres ni fechas.\n"
        "2) No cites números ni nombres que no aparezcan literalmente en el fragmento.\n"
        "3) Responde en el idioma «{lang}», con frases claras y cortas, "
        "como si se lo explicaras a alguien que no conoce el tema.\n"
        "4) Escribe texto plano: sin markdown, sin asteriscos, sin títulos "
        "ni comillas envolviendo toda la respuesta.\n"
        "5) No repitas la pregunta ni abras con «Claro» o «Aquí tienes».\n"
    ).format(lang=lang)

    if titulo:
        encabezado += f"\nDocumento: «{titulo}».\n"

    if modo == "resumen":
        tarea = (
            "TAREA: resume el fragmento en 5 a 8 frases seguidas, contando lo que "
            "realmente dice y en el orden en que lo dice. Sin listas."
        )
    elif modo == "ideas":
        tarea = (
            "TAREA: extrae entre 4 y 8 ideas clave del fragmento. Una por línea, "
            "empezando cada línea con «- ». Cada idea, una frase completa y concreta "
            "tomada del texto."
        )
    elif modo == "sintesis":
        # Lo que llega aquí no es el libro, son los resúmenes de sus partes ya
        # hechos por la IA: se unen en uno solo sin repetir lo mismo tres veces.
        tarea = (
            "TAREA: lo que sigue son los resúmenes de las partes de un mismo "
            "documento, en orden. Únelos en un solo resumen de 8 a 14 frases que "
            "cuente el documento completo de principio a fin.\n"
            "- Respeta el orden en que ocurren las cosas.\n"
            "- No repitas la misma idea en varias frases.\n"
            "- No añadas nada que no esté en los resúmenes.\n"
            "- Sin listas ni títulos: un texto seguido."
        )
    else:
        tarea = f"PREGUNTA DEL LECTOR: {pregunta}\n\nTAREA: responde esa pregunta usando solo el fragmento."

    prompt = (
        f"{encabezado}\n{tarea}\n\n"
        f"FRAGMENTO DEL DOCUMENTO:\n<<<\n{contexto}\n>>>"
    )

    try:
        salida, provider_name = _llamar_ia_con_respaldo(
            req.api_key or "", req.provider or "", prompt, req.openrouter_model, 1400
        )
    except Exception as e:
        raise HTTPException(status_code=502, detail=str(e))

    limpio = (_limpiar_respuesta_ia(salida) or "").strip()
    if not limpio:
        raise HTTPException(status_code=502, detail="La IA devolvió una respuesta vacía. Inténtalo de nuevo.")

    return {
        "text": limpio,
        "ia_used": True,
        "provider": provider_name,
        "mode": modo,
        "context_chars": len(contexto),
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


# ── TTS neural regional (Microsoft Edge voices, sin API key) ───────────
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
    "es-CL": {
        "label": "Chile",
        "female": "es-CL-CatalinaNeural",
        "male": "es-CL-LorenzoNeural",
    },
    "es-PE": {
        "label": "Perú",
        "female": "es-PE-CamilaNeural",
        "male": "es-PE-AlexNeural",
    },
    "es-US": {
        "label": "Latino de Estados Unidos",
        "female": "es-US-PalomaNeural",
        "male": "es-US-AlonsoNeural",
    },
    "en-US": {
        "label": "English (United States)",
        # Ava y Andrew: voces conversacionales nativas de inglés.
        "female": "en-US-AvaNeural",
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
        "female": [
            "es-CO-SalomeNeural",
            "es-MX-DaliaNeural",
            "es-AR-ElenaNeural",
            "es-CL-CatalinaNeural",
            "es-PE-CamilaNeural",
        ],
        "male": [
            "es-CO-GonzaloNeural",
            "es-MX-JorgeNeural",
            "es-AR-TomasNeural",
            "es-CL-LorenzoNeural",
            "es-PE-AlexNeural",
        ],
    },
    "en": {
        "female": [
            "en-US-AvaNeural",
            "en-US-EmmaNeural",
            "en-US-AriaNeural",
            "en-US-JennyNeural",
        ],
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
    "es": "es-CO",
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
    rate: float = Field(1.0, description="Velocidad 0.75–2.0")
    language: str = Field("es", description="Idioma del fragmento: es | en")
    locale: str = Field("es-CO", description="Acento español BCP-47 (es-CO por defecto)")
    tone: str = Field("neutral", description="neutral | warm | energetic")
    unified: bool = Field(
        False,
        description="Misma voz multilingüe para todo el texto (sin cambio de voz en inglés)",
    )
    source: str = Field(
        "",
        description="Origen del texto (mic | file | yt | trans).",
    )
    prefer_fish: bool = Field(
        False,
        description="True solo si la persona eligió una voz Fish Audio del listado",
    )
    fish_voice: str = Field(
        "",
        description="Slug del catálogo Fish (nico-robin, colombiana…). Vacío usa female/male.",
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
    value = max(0.75, min(2.0, float(rate or 1.0)))
    rate_pct = int(round((value - 1.0) * 100))
    normalized_tone = (tone or "neutral").strip().lower()
    if normalized_tone == "warm":
        rate_pct -= 3
        pitch = "+0Hz"
        volume = "+0%"
    elif normalized_tone == "energetic":
        rate_pct += 3
        pitch = "+0Hz"
        volume = "+1%"
    else:
        normalized_tone = "neutral"
        pitch = "+0Hz"
        volume = "+0%"
    rate_pct = max(-25, min(100, rate_pct))
    return f"{rate_pct:+d}%", pitch, volume, normalized_tone


# ── Motor Azure Speech (opcional): mismas voces, pero con SSML expresivo ──
#
# edge-tts habla con el mismo motor neural de Microsoft, pero por una vía no
# oficial que ignora el SSML: solo deja mover velocidad, tono y volumen. Con una
# clave de Azure podemos enviar SSML de verdad y pedir un *estilo* de
# interpretación ("friendly", "cheerful"), que es lo que quita la sensación de
# lectura robótica. Si no hay clave, o si Azure falla, se usa edge-tts como
# siempre: la voz nunca se queda sin sonar.
AZURE_SPEECH_KEY = (os.environ.get("AZURE_SPEECH_KEY") or "").strip()
AZURE_SPEECH_REGION = (os.environ.get("AZURE_SPEECH_REGION") or "").strip().lower()
AZURE_TTS_TIMEOUT = 15.0
AZURE_TTS_FORMAT = "audio-24khz-48kbitrate-mono-mp3"

# Cada tono de la interfaz se traduce al primer estilo que la voz elegida
# soporte de verdad. Pedir un estilo inexistente hace fallar la petición, así
# que preguntamos a Azure qué admite cada voz antes de usarlo.
TTS_AZURE_ESTILOS = {
    "warm": ("friendly", "gentle", "calm", "chat", "empathetic"),
    "energetic": ("cheerful", "excited", "lively", "chat"),
    "neutral": (),
}
# Se consulta una sola vez por instancia: {voz: {estilos soportados}}
_azure_estilos_cache: dict[str, set[str]] | None = None


# ── Motor Fish Audio (opcional): voz muy expresiva, pero entrena con el texto ──
#
# El plan gratuito de Fish advierte que las peticiones pueden usarse para
# mejorar su modelo. Por eso NO se le manda cualquier texto: solo los orígenes
# cuyo contenido es del propio usuario (lo que dicta y los videos públicos de
# YouTube). Las transcripciones de archivos de audio traen voz de terceros que
# no dieron su consentimiento, así que esas siempre van por Azure o edge-tts.
FISH_API_KEY = (os.environ.get("FISH_API_KEY") or "").strip()
FISH_MODEL = (os.environ.get("FISH_MODEL") or "s2.1-pro-free").strip()
# Las dos voces históricas se pueden sustituir por env. El resto del catálogo
# son fichas públicas de fish.audio (español, trained, sin DMCA): no hace
# falta una variable nueva por cada una.
FISH_VOICES = {
    "female": (os.environ.get("FISH_VOICE_FEMALE") or "e7e72305af4949b3ac95b75db790e254").strip(),
    "male": (os.environ.get("FISH_VOICE_MALE") or "3f45a7fd7a614655a61eb7027b955783").strip(),
}
FISH_VOICE_NAMES = {
    "female": (os.environ.get("FISH_VOICE_FEMALE_NAME") or "").strip(),
    "male": (os.environ.get("FISH_VOICE_MALE_NAME") or "").strip(),
}
# id, género, nombre en la app, reference_id público, alias histórico, idioma
FISH_CATALOGO_BASE = (
    ("nico-robin", "female", "Nico Robin", "e7e72305af4949b3ac95b75db790e254", "female", "es"),
    ("narradora", "female", "Narradora", "bfed5c0810a347dbb62e8ccce7f59c48", "", "es"),
    ("chica", "female", "Chica", "35929683c49c4ec0bf779dc07d22620b", "", "es"),
    ("nagi", "female", "Nagi", "70fb19852a484f3eb1d040423e2a8be7", "", "es"),
    ("colombiana", "female", "Colombiana", "e296306da5d449999f6e35c2b9f60aea", "", "es"),
    ("latina", "female", "Latina", "13d17017d63340a0b9751ffb04561c8d", "", "es"),
    ("voz-a", "female", "Voz A", "b8a36bb02e7f41c1b75a2909bbb04393", "", "es"),
    ("locutor-k", "male", "Locutor K", "3f45a7fd7a614655a61eb7027b955783", "male", "es"),
    ("narrador", "male", "Narrador", "35199d5438854f5d9157c500479ab684", "", "es"),
    ("loquendo", "male", "Loquendo", "bcdc2d4b044d4a6992d9260ce16715eb", "", "es"),
    ("valentino", "male", "Valentino", "a1fe2e1b6f324e27929d5088f2d09be3", "", "es"),
    ("sabio", "male", "Sabio", "60a33602dacc4d899cb671b024e66d8c", "", "es"),
    ("terror", "male", "Terror", "867d389fc01f4310bc381ff9429e6052", "", "es"),
    ("leonardo", "male", "Leonardo", "f765b445ca784776b1d444bd5f418050", "", "es"),
    ("sarah", "female", "Sarah", "933563129e564b19a115bedd57b7406a", "", "en"),
    ("paula", "female", "Paula", "c2623f0c075b4492ac367989aee1576f", "", "en"),
    ("adrian", "male", "Adrian", "bf322df2096a46f18c579d0baa36f41d", "", "en"),
    ("ethan", "male", "Ethan", "536d3a5e000945adb7038665781a4aca", "", "en"),
    # Voces nuevas pedidas por el usuario (2026-09): el slug es corto para la
    # app y el reference_id es la ficha pública de fish.audio.
    ("julio-ciencia", "male", "Julio Ciencia", "49143b926e1043c491cfe386758d09a0", "", "es"),
    ("sheyla", "female", "Sheyla", "c42d566a928a4049a01262e4f63a1efb", "", "es"),
    ("farick", "male", "Farick", "dfa5b230c8054f429e434f4a6e9bbdec", "", "es"),
    ("sabio-expandido", "male", "Sabio expandido", "60a33602dacc4d899cb671b024e66d8c", "", "es"),
    ("enrique-hoffman", "male", "Enrique Hoffman", "8926506428ad4ae898d35ede47524240", "", "es"),
    ("voz-locutor", "male", "Voz locutor", "4110ff39a33e46b8bac2a9e7f8e00ced", "", "es"),
    ("brian-tracy", "male", "Brian Tracy", "cd803cbf78a4454fa98b601abbf8966a", "", "es"),
    ("morgan-freeman", "male", "Morgan Freeman", "7c76e349434d4f1e97078d924acea65f", "", "es"),
    ("mario-alonso-puig", "male", "Mario Alonso Puig", "b9a077022c424e89b0705cb98085e36a", "", "es"),
)
# Voces que se retiraron del listado: si llega el slug viejo, suena la del mismo género.
FISH_VOCES_RETIRADAS = {"clara": "nico-robin", "nestor": "locutor-k"}
_fish_nombres_cache: dict[str, str] | None = None
FISH_TTS_TIMEOUT = 15.0
# Orígenes de la interfaz cuyo texto es del propio usuario. Se puede ampliar con
# FISH_ALLOWED_SOURCES, pero el valor por defecto es el prudente.
FISH_ORIGENES_PERMITIDOS = {
    s.strip()
    for s in (os.environ.get("FISH_ALLOWED_SOURCES") or "mic,yt,settings-test").split(",")
    if s.strip()
}
# Fish S2 controla la emoción con etiquetas dentro del propio texto
TTS_FISH_ETIQUETAS = {"warm": "[friendly]", "energetic": "[excited]", "neutral": ""}


def _tts_azure_activo() -> bool:
    return bool(AZURE_SPEECH_KEY and AZURE_SPEECH_REGION)


def _tts_fish_catalogo() -> list[dict]:
    """Voces que puede elegir la persona. Env solo pisa Nico Robin y Locutor K."""
    voces = []
    for slug, gender, name, ref, legacy, lang in FISH_CATALOGO_BASE:
        if legacy == "female" and FISH_VOICES.get("female"):
            ref = FISH_VOICES["female"]
            name = FISH_VOICE_NAMES.get("female") or name
        elif legacy == "male" and FISH_VOICES.get("male"):
            ref = FISH_VOICES["male"]
            name = FISH_VOICE_NAMES.get("male") or name
        if not ref:
            continue
        voces.append(
            {
                "id": slug,
                "gender": gender,
                "name": name,
                "reference_id": ref,
                "legacy": legacy,
                "lang": "en" if lang == "en" else "es",
            }
        )
    return voces


def _tts_fish_resolver(clave: str = "", gender: str = "female") -> dict | None:
    """Encuentra una voz por slug, alias histórico (female/male) o género."""
    raw = (clave or "").strip().lower()
    if raw.startswith("fish:"):
        raw = raw[5:]
    raw = FISH_VOCES_RETIRADAS.get(raw, raw)
    catalogo = _tts_fish_catalogo()
    if raw:
        for voz in catalogo:
            if voz["id"] == raw or voz["legacy"] == raw:
                return voz
    buscado = "male" if (gender or "").strip().lower() == "male" else "female"
    for voz in catalogo:
        if voz["legacy"] == buscado:
            return voz
    for voz in catalogo:
        if voz["gender"] == buscado:
            return voz
    return catalogo[0] if catalogo else None


def _tts_fish_activo(
    source: str,
    gender: str,
    prefer_fish: bool = False,
    fish_voice: str = "",
) -> bool:
    """Fish solo entra si la persona eligió esa voz y hay clave + modelo."""
    return bool(prefer_fish and FISH_API_KEY and _tts_fish_resolver(fish_voice, gender))


def _tts_fish_titulo_limpio(titulo: str) -> str:
    """Quita el prefijo «voz de» que a veces trae el catálogo de Fish."""
    limpio = re.sub(r"\s+", " ", (titulo or "").strip())
    limpio = re.sub(r"(?i)^voz de\s+", "", limpio).strip()
    if limpio.lower() == "locutor k":
        return "Locutor K"
    return limpio


def _tts_fish_resolver_nombres() -> dict[str, str]:
    """Nombres históricos (female/male) para no romper clientes viejos."""
    global _fish_nombres_cache
    if _fish_nombres_cache is not None:
        return _fish_nombres_cache
    nombres = {
        "female": FISH_VOICE_NAMES.get("female") or "Nico Robin",
        "male": FISH_VOICE_NAMES.get("male") or "Locutor K",
    }
    _fish_nombres_cache = nombres
    return nombres


def _tts_fish_nombre(gender: str, fish_voice: str = "") -> str:
    voz = _tts_fish_resolver(fish_voice, gender)
    if voz:
        return voz["name"]
    return "Hombre" if gender == "male" else "Mujer"


def _tts_fish_voces_publicas() -> dict:
    """Catálogo que consume la interfaz. No incluye la clave ni IDs internos."""
    catalogo = _tts_fish_catalogo()
    activo = bool(FISH_API_KEY and catalogo)
    lista = [
        {
            "id": voz["id"],
            "gender": voz["gender"],
            "name": voz["name"],
            "lang": voz.get("lang") or "es",
        }
        for voz in catalogo
    ]
    por_genero = {voz["gender"]: voz for voz in catalogo if voz.get("legacy")}
    female = por_genero.get("female") or next((v for v in catalogo if v["gender"] == "female"), None)
    male = por_genero.get("male") or next((v for v in catalogo if v["gender"] == "male"), None)
    return {
        "active": activo,
        "model": FISH_MODEL,
        "sources": sorted(FISH_ORIGENES_PERMITIDOS),
        "voices": {
            "female": {
                "id": (female or {}).get("id") or "nico-robin",
                "name": (female or {}).get("name") or "Nico Robin",
                "configured": bool(female),
            },
            "male": {
                "id": (male or {}).get("id") or "locutor-k",
                "name": (male or {}).get("name") or "Locutor K",
                "configured": bool(male),
            },
            "list": lista,
        },
    }


async def _tts_azure_estilos() -> dict[str, set[str]]:
    """Catálogo real de estilos por voz, según la cuenta de Azure configurada."""
    global _azure_estilos_cache
    if _azure_estilos_cache is not None:
        return _azure_estilos_cache
    import httpx

    catalogo: dict[str, set[str]] = {}
    try:
        url = f"https://{AZURE_SPEECH_REGION}.tts.speech.microsoft.com/cognitiveservices/voices/list"
        async with httpx.AsyncClient(timeout=10.0) as cliente:
            respuesta = await cliente.get(
                url, headers={"Ocp-Apim-Subscription-Key": AZURE_SPEECH_KEY}
            )
        respuesta.raise_for_status()
        for voz in respuesta.json():
            nombre = voz.get("ShortName")
            if nombre:
                catalogo[nombre] = {str(e).lower() for e in (voz.get("StyleList") or [])}
    except Exception:
        # Sin catálogo se sintetiza sin estilo: peor expresividad, nunca un error.
        catalogo = {}
    _azure_estilos_cache = catalogo
    return catalogo


def _tts_ssml(text: str, voice_id: str, rate: str, pitch: str, estilo: str) -> str:
    """Arma el SSML. El texto se escapa para que ningún símbolo rompa el XML."""
    from xml.sax.saxutils import escape

    # Los caracteres de control no son válidos en XML y provocarían un 400.
    limpio = escape(re.sub(r"[\x00-\x08\x0b\x0c\x0e-\x1f]", "", text))
    cuerpo = f'<prosody rate="{rate}" pitch="{pitch}">{limpio}</prosody>'
    if estilo:
        grado = "1.2" if estilo in {"cheerful", "excited", "lively"} else "1"
        cuerpo = f'<mstts:express-as style="{estilo}" styledegree="{grado}">{cuerpo}</mstts:express-as>'
    idioma = "-".join(voice_id.split("-")[:2]) or "es-CO"
    return (
        '<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" '
        f'xmlns:mstts="http://www.w3.org/2001/mstts" xml:lang="{idioma}">'
        f'<voice name="{voice_id}">{cuerpo}</voice></speak>'
    )


async def _tts_azure_synthesize(
    text: str, voice_id: str, rate: str, pitch: str, tone: str
) -> tuple[bytes, str]:
    """Sintetiza con Azure. Devuelve (audio, estilo aplicado)."""
    import httpx

    estilos_voz = (await _tts_azure_estilos()).get(voice_id, set())
    estilo = next(
        (e for e in TTS_AZURE_ESTILOS.get(tone, ()) if e in estilos_voz),
        "",
    )
    url = f"https://{AZURE_SPEECH_REGION}.tts.speech.microsoft.com/cognitiveservices/v1"
    async with httpx.AsyncClient(timeout=AZURE_TTS_TIMEOUT) as cliente:
        respuesta = await cliente.post(
            url,
            content=_tts_ssml(text, voice_id, rate, pitch, estilo).encode("utf-8"),
            headers={
                "Ocp-Apim-Subscription-Key": AZURE_SPEECH_KEY,
                "Content-Type": "application/ssml+xml",
                "X-Microsoft-OutputFormat": AZURE_TTS_FORMAT,
                "User-Agent": "JGTurbo",
            },
        )
    respuesta.raise_for_status()
    return respuesta.content, estilo


async def _tts_fish_synthesize(
    text: str, gender: str, speed: float, tone: str, fish_voice: str = ""
) -> tuple[bytes, str]:
    """Sintetiza con Fish Audio. Devuelve (audio, etiqueta aplicada)."""
    import httpx

    voz = _tts_fish_resolver(fish_voice, gender)
    if not voz:
        raise RuntimeError("No hay una voz Fish configurada.")
    etiqueta = TTS_FISH_ETIQUETAS.get(tone, "")
    async with httpx.AsyncClient(timeout=FISH_TTS_TIMEOUT) as cliente:
        respuesta = await cliente.post(
            "https://api.fish.audio/v1/tts",
            json={
                "text": f"{etiqueta} {text}".strip(),
                "reference_id": voz["reference_id"],
                "format": "mp3",
                "prosody": {"speed": max(0.5, min(2.0, speed))},
            },
            headers={
                "Authorization": f"Bearer {FISH_API_KEY}",
                "Content-Type": "application/json",
                "model": FISH_MODEL,
            },
        )
    respuesta.raise_for_status()
    return respuesta.content, etiqueta


async def _tts_edge_synthesize(text: str, voice_id: str, rate: str, pitch: str, volume: str) -> bytes:
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


async def _tts_synthesize(
    text: str,
    voice_id: str,
    rate: str,
    pitch: str,
    volume: str,
    tone: str = "neutral",
    source: str = "",
    speed: float = 1.0,
    gender: str = "female",
    prefer_fish: bool = False,
    fish_voice: str = "",
) -> tuple[bytes, str, str]:
    """Sintetiza un fragmento. Devuelve (audio, motor usado, estilo aplicado).

    Si la persona eligió Fish, se intenta primero esa voz. Si no, Azure y
    después edge-tts. Un fallo baja al siguiente: el navegador no oye un corte.
    """
    if _tts_fish_activo(source, gender, prefer_fish, fish_voice):
        try:
            audio, etiqueta = await _tts_fish_synthesize(
                text, gender, speed, tone, fish_voice
            )
            if audio:
                return audio, "fish", etiqueta
        except Exception:
            pass
    if _tts_azure_activo():
        try:
            audio, estilo = await _tts_azure_synthesize(text, voice_id, rate, pitch, tone)
            if audio:
                return audio, "azure", estilo
        except Exception:
            pass
    return await _tts_edge_synthesize(text, voice_id, rate, pitch, volume), "edge", ""


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
        modo = "unified"
        candidates = list(TTS_UNIFIED_VOICES[gender])
    else:
        language = _tts_resolve_language(req.language, text)
        modo = "regional"
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
            audio, motor, estilo = await _tts_synthesize(
                text, candidate, rate, pitch, volume, tone,
                source=req.source, speed=req.rate, gender=gender,
                prefer_fish=bool(req.prefer_fish),
                fish_voice=req.fish_voice or "",
            )
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
                    # Con Fish la voz real no es la del catálogo de Edge: se
                    # anuncia la que de verdad suena para no engañar a la UI.
                    "X-TTS-Voice": (
                        f"fish:{_tts_fish_nombre(gender, req.fish_voice)}"
                        if motor == "fish"
                        else candidate
                    ),
                    "X-TTS-Rate": rate,
                    "X-TTS-Pitch": pitch,
                    "X-TTS-Tone": tone,
                    "X-TTS-Language": language,
                    "X-TTS-Locale": actual_locale,
                    "X-TTS-Engine": f"{motor}-neural-{modo}",
                    # Estilo de interpretación aplicado (solo con motor Azure)
                    "X-TTS-Style": estilo or "none",
                },
            )
        except Exception as error:
            last_error = error

    detail = str(last_error or "servicio no disponible")[:180]
    raise HTTPException(status_code=502, detail=f"No se pudo sintetizar la voz: {detail}")


@app.post("/api/tts")
async def tts_neural(req: TtsRequest):
    """Sintetiza un fragmento (POST: sin límite práctico de longitud)."""
    return await _tts_render(req)


@app.get("/api/tts")
async def tts_neural_get(
    text: str,
    voice: str = "female",
    rate: float = 1.0,
    language: str = "es",
    locale: str = "es-CO",
    tone: str = "neutral",
    unified: bool = False,
    source: str = "",
    prefer_fish: bool = False,
    fish_voice: str = "",
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
            source=source,
            prefer_fish=prefer_fish,
            fish_voice=fish_voice,
        ),
        cache_seconds=86400,
    )


@app.get("/api/tts-warmup")
async def tts_warmup():
    """Abre la conexión con el servicio de voz antes de que haga falta.

    La primera síntesis paga el arranque (DNS, TLS y token del servicio):
    unos segundos. Llamando aquí en cuanto el usuario se acerca al botón
    de escuchar, ese coste ya está pagado cuando de verdad pulsa.
    """
    from fastapi.responses import JSONResponse

    motor = "edge"
    try:
        audio, motor, _ = await _tts_synthesize(
            ".", TTS_VOICE_CATALOG["es-CO"]["female"], "+0%", "+0Hz", "+0%"
        )
        listo = bool(audio)
        detalle = ""
    except Exception as error:  # el warmup nunca debe romper la página
        listo = False
        detalle = str(error)[:120]
    return JSONResponse(
        {"ok": listo, "detail": detalle, "engine": motor},
        headers={"Cache-Control": "no-store"},
    )


@app.get("/api/tts-azure")
async def tts_azure_info(locale: str = "es"):
    """Qué ofrece de verdad la cuenta de Azure configurada.

    Sirve para responder sin adivinar: ¿qué estilos admite cada voz española?,
    ¿hay voces HD disponibles en la región contratada? Sin clave responde
    `active: false` y la app sigue funcionando con edge-tts.
    """
    if not _tts_azure_activo():
        return {
            "active": False,
            "detail": "Faltan AZURE_SPEECH_KEY o AZURE_SPEECH_REGION.",
            "engine": "edge-neural-regional",
        }
    catalogo = await _tts_azure_estilos()
    if not catalogo:
        return {
            "active": True,
            "reachable": False,
            "region": AZURE_SPEECH_REGION,
            "detail": "No se pudo leer el catálogo de voces (clave o región inválidas).",
        }
    prefijo = (locale or "es").strip().lower()
    voces = {
        nombre: sorted(estilos)
        for nombre, estilos in catalogo.items()
        if nombre.lower().startswith(prefijo)
    }
    return {
        "active": True,
        "reachable": True,
        "region": AZURE_SPEECH_REGION,
        "total_voices": len(catalogo),
        "voices": dict(sorted(voces.items())),
        # Voces HD: timbre distinto al de edge-tts, se activan cambiando el catálogo
        "hd_voices": sorted(n for n in catalogo if "HD" in n and n.lower().startswith(prefijo)),
        "in_use": {
            voz: sorted(catalogo.get(voz, []))
            for voz in (
                TTS_VOICE_CATALOG["es-CO"]["female"],
                TTS_VOICE_CATALOG["es-CO"]["male"],
            )
        },
    }


@app.get("/api/tts-voices")
def tts_voices_info():
    return {
        "engine": "azure-neural-regional" if _tts_azure_activo() else "edge-neural-regional",
        "default_locale": "es-CO",
        "recommended": {
            "female_locale": "es-CO",
            "female_voice": "es-CO-SalomeNeural",
            "male_locale": "es-CO",
            "male_voice": "es-CO-GonzaloNeural",
            "english_female": "en-US-AvaNeural",
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
        "rate_range": [0.75, 2.0],
        "max_chars": TTS_MAX_CHARS,
        # Qué motores están disponibles y qué textos puede ver cada uno
        "engines": {
            "azure": {"active": _tts_azure_activo(), "sources": "todos"},
            "fish": _tts_fish_voces_publicas(),
            "edge": {"active": True, "sources": "todos"},
        },
    }
