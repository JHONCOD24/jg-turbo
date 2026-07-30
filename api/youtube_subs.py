"""Utilidades de subtítulos YouTube (sin UI).

Parseo de objetos de youtube-transcript-api 1.x (fetch/list/to_raw_data)
y formas dict antiguas. Probable de unit test sin red.
"""

from __future__ import annotations

from typing import Any, Optional


def texto_desde_fetched(
    fetched: Any,
    idioma_fallback: str = "es",
    min_chars: int = 15,
) -> tuple[Optional[str], Optional[str]]:
    """Convierte un FetchedTranscript (1.x) o iterable/dicts en (texto, lang)."""
    partes: list[str] = []
    to_raw = getattr(fetched, "to_raw_data", None)
    if callable(to_raw):
        for item in to_raw() or []:
            if isinstance(item, dict):
                txt = (item.get("text") or "").replace("\n", " ").strip()
            else:
                txt = (getattr(item, "text", None) or "").replace("\n", " ").strip()
            if txt:
                partes.append(txt)
    if not partes:
        snippets = getattr(fetched, "snippets", None)
        if snippets is None:
            try:
                snippets = list(fetched)
            except Exception:
                snippets = []
        for s in snippets or []:
            if isinstance(s, dict):
                txt = (s.get("text") or "").replace("\n", " ").strip()
            else:
                txt = (getattr(s, "text", None) or "").replace("\n", " ").strip()
            if txt:
                partes.append(txt)
    texto = " ".join(partes).strip()
    if texto and len(texto) > min_chars:
        lang = getattr(fetched, "language_code", None) or idioma_fallback or "es"
        return texto, lang
    return None, None
