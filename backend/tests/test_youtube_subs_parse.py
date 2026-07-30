"""Parseo de subtítulos YouTube (sin red ni UI)."""
import sys
from pathlib import Path
from types import SimpleNamespace

import pytest

# api/ vive junto a backend/ dentro de Spech to text App
_APP_ROOT = Path(__file__).resolve().parents[2]
if str(_APP_ROOT) not in sys.path:
    sys.path.insert(0, str(_APP_ROOT))

from api.youtube_subs import texto_desde_fetched  # noqa: E402


class _FetchedConRaw:
    language_code = "es"

    def to_raw_data(self):
        return [
            {"text": "Hola mundo"},
            {"text": "esto es una prueba\nlarga"},
        ]


class _FetchedConSnippets:
    language_code = "en"
    snippets = [
        SimpleNamespace(text="Hello world from snippets"),
        SimpleNamespace(text="second line"),
    ]


def test_parse_to_raw_data():
    texto, lang = texto_desde_fetched(_FetchedConRaw())
    assert lang == "es"
    assert "Hola mundo" in texto
    assert "prueba" in texto
    assert "\n" not in texto


def test_parse_snippets():
    texto, lang = texto_desde_fetched(_FetchedConSnippets())
    assert lang == "en"
    assert "Hello world" in texto
    assert "second line" in texto


def test_parse_iterable_dicts():
    data = [{"text": "uno dos tres cuatro cinco seis"}, {"text": "siete"}]
    texto, lang = texto_desde_fetched(data, idioma_fallback="es")
    assert texto is not None
    assert lang == "es"
    assert "siete" in texto


def test_texto_corto_devuelve_none():
    texto, lang = texto_desde_fetched([{"text": "corto"}])
    assert texto is None
    assert lang is None
