"""Utilidades de subtítulos YouTube (sin UI).

Parseo de objetos de youtube-transcript-api 1.x (fetch/list/to_raw_data)
y formas dict antiguas. Probable de unit test sin red.
"""

from __future__ import annotations

from typing import Any, Optional


def _valor(item: Any, nombre: str, defecto: Any = None) -> Any:
    """Lee un campo tanto de dicts antiguos como de objetos de la API 1.x."""
    if isinstance(item, dict):
        return item.get(nombre, defecto)
    return getattr(item, nombre, defecto)


def segmentos_desde_fetched(fetched: Any) -> list[dict]:
    """Normaliza subtítulos de YouTube a segundos sin perder sus timestamps.

    Contrato público: cada elemento contiene ``startTime``, ``endTime``,
    ``duration`` y ``text``. Los valores inválidos se descartan y los finales
    nunca quedan antes del inicio.
    """
    to_raw = getattr(fetched, "to_raw_data", None)
    if callable(to_raw):
        items = to_raw() or []
    else:
        items = getattr(fetched, "snippets", None)
        if items is None:
            try:
                items = list(fetched)
            except Exception:
                items = []

    salida: list[dict] = []
    for item in items or []:
        texto = str(_valor(item, "text", "") or "").replace("\n", " ").strip()
        if not texto:
            continue
        try:
            inicio = max(0.0, float(_valor(item, "start", 0.0) or 0.0))
            duracion = max(0.0, float(_valor(item, "duration", 0.0) or 0.0))
        except (TypeError, ValueError):
            continue
        fin = inicio + duracion
        salida.append({
            "startTime": round(inicio, 3),
            "endTime": round(fin, 3),
            "duration": round(duracion, 3),
            "text": texto,
        })
    return salida


def texto_desde_fetched(
    fetched: Any,
    idioma_fallback: str = "es",
    min_chars: int = 15,
) -> tuple[Optional[str], Optional[str]]:
    """Convierte un FetchedTranscript (1.x) o iterable/dicts en (texto, lang)."""
    partes = [segmento["text"] for segmento in segmentos_desde_fetched(fetched)]
    texto = " ".join(partes).strip()
    if texto and len(texto) > min_chars:
        lang = getattr(fetched, "language_code", None) or idioma_fallback or "es"
        return texto, lang
    return None, None
