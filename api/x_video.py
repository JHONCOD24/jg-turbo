"""Videos de X (antes Twitter): de un enlace a las URLs del video.

Por qué existe: X no tiene una API gratuita que entregue el video. Sus propios
«embeds» leen `cdn.syndication.twimg.com/tweet-result`, un JSON público que exige
un `token` cualquiera (sin token devuelve `{}`; medido 2026-09-27). Si esa vía
falla, FxTwitter (servicio comunitario) da lo mismo. El navegador no puede llamar
a la sindicación: su CORS solo admite platform.twitter.com.

Solo se entregan URLs https de video.twimg.com (video) y pbs.twimg.com (portada):
un tercero no puede mandar al navegador a otro sitio.

Módulo puro (sin FastAPI) para probarlo sin red.
"""

from __future__ import annotations

import json
import random
import re
import urllib.parse
from typing import Any, Optional

import requests

TIMEOUT_S = 8.0
URL_SINDICACION = "https://cdn.syndication.twimg.com/tweet-result"
URL_FXTWITTER = "https://api.fxtwitter.com/status/{id}"
CABECERAS = {"User-Agent": "Mozilla/5.0", "Accept": "application/json"}
ALFABETO_TOKEN = "123456789abcdefghijklmnopqrstuvwxyz"

HOSTS_X = {
    "x.com", "twitter.com", "mobile.x.com", "mobile.twitter.com",
    "fxtwitter.com", "vxtwitter.com", "fixupx.com", "fixvx.com",
}
RUTA_POST = re.compile(
    r"^/(?:i/web|i|[A-Za-z0-9_]{1,15})/status(?:es)?/(\d{5,25})(?:/video/(\d))?", re.IGNORECASE
)
RE_DIMENSIONES = re.compile(r"/(\d{2,5})x(\d{2,5})/")
RE_TCO_FINAL = re.compile(r"\s*https://t\.co/\w+\s*$")


class XVideoError(RuntimeError):
    """El post no trae un video que se pueda doblar, con un motivo legible."""

    def __init__(self, mensaje: str, codigo: str, http_status: int):
        super().__init__(mensaje)
        self.codigo = codigo
        self.http_status = http_status


def _error(codigo: str) -> XVideoError:
    mensajes = {
        "enlace": ("Ese enlace no es de un post de X con video. Copia el enlace del post (x.com/usuario/status/…).", 400),
        "no_disponible": ("Ese post de X no existe, es privado o tiene restricción de edad.", 404),
        "sin_video": ("Ese post de X no tiene un video.", 404),
        "gif": ("Ese post de X es un GIF: no tiene sonido que doblar.", 422),
        "red": ("No pudimos consultar X en este momento. Intenta de nuevo en unos minutos.", 503),
    }
    mensaje, estado = mensajes[codigo]
    return XVideoError(mensaje, codigo, estado)


def extraer_id(url: str) -> Optional[tuple[str, int]]:
    """(id del post, índice del video desde 0) o None si no es un post de X."""
    texto = (url or "").strip()
    if not texto:
        return None
    if not re.match(r"^https?://", texto, re.IGNORECASE):
        texto = "https://" + texto
    try:
        partes = urllib.parse.urlsplit(texto)
    except ValueError:
        return None
    host = (partes.hostname or "").lower()
    if host.startswith("www."):
        host = host[4:]
    if host not in HOSTS_X:
        return None
    coincidencia = RUTA_POST.match(partes.path or "")
    if not coincidencia:
        return None
    return coincidencia.group(1), max(0, int(coincidencia.group(2) or 1) - 1)


def _segura(url: Any, host: str) -> str:
    try:
        partes = urllib.parse.urlsplit(str(url or ""))
    except ValueError:
        return ""
    return str(url) if partes.scheme == "https" and partes.hostname == host else ""


def _variantes(variantes) -> tuple[list[dict], str]:
    mp4: list[dict] = []
    hls = ""
    for variante in variantes or []:
        url = _segura(variante.get("url"), "video.twimg.com")
        if not url:
            continue
        tipo = str(variante.get("content_type") or variante.get("container") or "").lower()
        if tipo in ("video/mp4", "mp4"):
            dimensiones = RE_DIMENSIONES.search(url)
            mp4.append({
                "url": url,
                "bitrate": int(variante.get("bitrate") or 0),
                "ancho": int(dimensiones.group(1)) if dimensiones else 0,
                "alto": int(dimensiones.group(2)) if dimensiones else 0,
            })
        elif "mpegurl" in tipo or tipo == "m3u8":
            hls = url
    mp4.sort(key=lambda v: v["bitrate"])
    return mp4, hls


def _idioma(valor: Any) -> str:
    codigo = str(valor or "").lower()
    return "" if codigo in ("", "und", "zxx", "qme", "qht") else codigo


def _texto(valor: Any) -> str:
    return RE_TCO_FINAL.sub("", str(valor or "")).strip()[:280]


def _medios_sindicacion(datos: dict) -> list[dict]:
    medios = [m for m in datos.get("mediaDetails") or [] if m.get("type") in ("video", "animated_gif")]
    if medios:
        return medios
    tarjeta = (((datos.get("card") or {}).get("binding_values") or {}).get("unified_card") or {})
    try:
        unificada = json.loads(tarjeta.get("string_value") or "{}")
    except (TypeError, ValueError):
        unificada = {}
    return [m for m in (unificada.get("media_entities") or {}).values() if m.get("type") in ("video", "animated_gif")]


def normalizar_sindicacion(datos: dict, indice: int = 0, _profundidad: int = 0) -> dict:
    if not isinstance(datos, dict) or datos.get("__typename") == "TweetTombstone" or not datos.get("id_str"):
        raise _error("no_disponible")
    medios = _medios_sindicacion(datos)
    if not medios and datos.get("quoted_tweet") and _profundidad == 0:
        return normalizar_sindicacion(datos["quoted_tweet"], indice, 1)
    if not medios:
        raise _error("sin_video")
    medio = medios[min(indice, len(medios) - 1)]
    if medio.get("type") == "animated_gif":
        raise _error("gif")
    info_video = medio.get("video_info") or {}
    mp4, hls = _variantes(info_video.get("variants"))
    if not mp4 and not hls:
        raise _error("sin_video")
    return {
        "id": str(datos.get("id_str")),
        "indice": indice,
        "autor": str((datos.get("user") or {}).get("screen_name") or ""),
        "texto": _texto(datos.get("text")),
        "idioma_texto": _idioma(datos.get("lang")),
        "duracion_s": round(float(info_video.get("duration_millis") or 0) / 1000, 3),
        "portada": _segura(medio.get("media_url_https"), "pbs.twimg.com"),
        "mp4": mp4,
        "hls": hls,
    }


def normalizar_fxtwitter(datos: dict, indice: int = 0, _profundidad: int = 0) -> dict:
    post = datos.get("tweet") if isinstance(datos, dict) else None
    if not isinstance(post, dict) or (datos.get("code") not in (None, 200) and _profundidad == 0):
        raise _error("no_disponible")
    medios = post.get("media") or {}
    videos = medios.get("videos") or []
    if not videos and post.get("quote") and _profundidad == 0:
        return normalizar_fxtwitter({"code": 200, "tweet": post["quote"]}, indice, 1)
    if not videos:
        if any(m.get("type") == "gif" for m in medios.get("all") or []):
            raise _error("gif")
        raise _error("sin_video")
    video = videos[min(indice, len(videos) - 1)]
    mp4, hls = _variantes(video.get("variants") or video.get("formats"))
    if not mp4 and not hls:
        raise _error("sin_video")
    return {
        "id": str(post.get("id") or ""),
        "indice": indice,
        "autor": str((post.get("author") or {}).get("screen_name") or ""),
        "texto": _texto(post.get("text")),
        "idioma_texto": _idioma(post.get("lang")),
        "duracion_s": round(float(video.get("duration") or 0), 3),
        "portada": _segura(video.get("thumbnail_url"), "pbs.twimg.com"),
        "mp4": mp4,
        "hls": hls,
    }


def _pedir_sindicacion(id_post: str, http) -> dict:
    token = "".join(random.choices(ALFABETO_TOKEN, k=10))
    respuesta = http.get(URL_SINDICACION, params={"id": id_post, "token": token, "lang": "es"},
                         headers=CABECERAS, timeout=TIMEOUT_S)
    if respuesta.status_code == 404 or "json" not in str(respuesta.headers.get("content-type", "")):
        return {}
    if respuesta.status_code >= 400:
        raise requests.HTTPError(f"sindicación {respuesta.status_code}")
    return respuesta.json()


def _pedir_fxtwitter(id_post: str, http) -> dict:
    respuesta = http.get(URL_FXTWITTER.format(id=id_post), headers=CABECERAS, timeout=TIMEOUT_S)
    if respuesta.status_code == 404:
        return {"code": 404}
    if respuesta.status_code >= 400:
        raise requests.HTTPError(f"fxtwitter {respuesta.status_code}")
    return respuesta.json()


def consultar(url: str, http=requests) -> dict:
    """Info del video de un post de X. Sindicación primero; FxTwitter de respaldo."""
    identificado = extraer_id(url)
    if not identificado:
        raise _error("enlace")
    id_post, indice = identificado
    errores: list[XVideoError] = []
    fuentes = (
        ("sindicacion", _pedir_sindicacion, normalizar_sindicacion),
        ("fxtwitter", _pedir_fxtwitter, normalizar_fxtwitter),
    )
    for nombre, pedir, normalizar in fuentes:
        try:
            info = normalizar(pedir(id_post, http), indice)
            info["fuente"] = nombre
            return info
        except XVideoError as exc:
            if exc.codigo == "gif":
                raise   # respuesta definitiva: la otra fuente dirá lo mismo
            errores.append(exc)
        except (requests.RequestException, ValueError):
            errores.append(_error("red"))
    for exc in errores:
        if exc.codigo != "red":
            raise exc
    raise errores[-1]
