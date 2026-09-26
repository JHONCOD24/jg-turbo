"""Metadatos oficiales de un video con la YouTube Data API v3 (opcional).

Para qué: `snippet.defaultAudioLanguage` es «el idioma hablado en la pista de
audio por defecto» (documentación oficial): justo el dato que faltó con los
videos con doblaje automático. Cuesta 1 unidad de una cuota gratuita de 10.000
diarias y, al ser una API con clave, no la afecta el bloqueo de YouTube a las IP
de centros de datos.

Sin `YOUTUBE_DATA_API_KEY` todo sigue funcionando con las demás señales.
Nunca lanza: ante cualquier fallo devuelve {} y deja rastro en el log (sin la clave).
"""

from __future__ import annotations

import json
import os
import re

import requests

API_KEY = (os.environ.get("YOUTUBE_DATA_API_KEY") or "").strip()
URL = "https://www.googleapis.com/youtube/v3/videos"
_RE_DURACION = re.compile(r"^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$")


def configurado() -> bool:
    return bool(API_KEY)


def duracion_iso_a_segundos(valor) -> int:
    """`PT1H28M34S` → 5314. Formato no reconocido → 0."""
    m = _RE_DURACION.match(str(valor or "").strip())
    if not m or not any(m.groups()):
        return 0
    dias, horas, minutos, segundos = (int(x or 0) for x in m.groups())
    return ((dias * 24 + horas) * 60 + minutos) * 60 + segundos


def _log(evento: str, **datos) -> None:
    print(json.dumps({"evento": f"youtube.datos_{evento}", **datos}, ensure_ascii=False), flush=True)


def consultar(video_id: str, timeout: float = 5.0) -> dict:
    if not API_KEY or not video_id:
        return {}
    try:
        resp = requests.get(
            URL,
            params={"part": "snippet,contentDetails", "id": video_id, "key": API_KEY},
            timeout=timeout,
        )
        if resp.status_code != 200:
            _log("error", video_id=video_id, http_status=resp.status_code)
            return {}
        items = (resp.json() or {}).get("items") or []
        if not items:
            return {}
        snippet = items[0].get("snippet") or {}
        detalles = items[0].get("contentDetails") or {}
        return {
            "audio": snippet.get("defaultAudioLanguage") or "",
            "idioma_metadatos": snippet.get("defaultLanguage") or "",
            "titulo": snippet.get("title") or "",
            "duracion_s": duracion_iso_a_segundos(detalles.get("duration")),
            "subtitulos": str(detalles.get("caption") or "").lower() == "true",
        }
    except Exception as exc:  # noqa: BLE001 — nunca debe tumbar la transcripción
        _log("error", video_id=video_id, error_type=type(exc).__name__)
        return {}
