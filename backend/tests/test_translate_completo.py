"""Traducción completa: sin timestamps YouTube y sin mezcla de idiomas."""
from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

import pytest

_APP_ROOT = Path(__file__).resolve().parents[2]
_API = _APP_ROOT / "api" / "index.py"
if str(_APP_ROOT) not in sys.path:
    sys.path.insert(0, str(_APP_ROOT))

spec = importlib.util.spec_from_file_location("jg_api_index", _API)
api = importlib.util.module_from_spec(spec)
assert spec.loader is not None
# Cargar puede fallar si faltan deps de Vercel; importamos solo helpers si hace falta.
try:
    spec.loader.exec_module(api)
except Exception as e:  # pragma: no cover
    pytest.skip(f"No se pudo cargar api/index.py: {e}")


SAMPLE_YT = """ntro
0:00
I took Google's prompt engineering
0:01
course for you so here's the cliffnotes
0:03
version to save you to 9 hours but it's
Course structure
0:21
structure of this course prompting
1:00
prompting is the process of providing
"""


def test_limpiar_quita_horas_youtube():
    limpio = api._limpiar_transcripcion_youtube_cruda(SAMPLE_YT)
    assert "0:00" not in limpio
    assert "0:01" not in limpio
    assert "1:00" not in limpio
    assert "prompt engineering" in limpio
    assert "Course structure" in limpio
    assert "prompting is the process" in limpio


def test_limpiar_no_toca_texto_normal():
    t = "Hola mundo. Esto es una prueba sin marcas de tiempo."
    assert api._limpiar_transcripcion_youtube_cruda(t) == t


def test_limpiar_preambulo_ingles_de_ia():
    respuesta = "Here is the translation:\nHola mundo."
    assert api._limpiar_respuesta_ia(respuesta) == "Hola mundo."


def test_chunk_fallo_si_identico():
    assert api._chunk_fallo_traduccion("hello world there", "hello world there") is True
    assert api._chunk_fallo_traduccion("hello world there", "hola mundo alli") is False


def test_traduccion_incompleta_detecta_ingles():
    original = (
        "I took Google's prompt engineering course for you so here is the cliff notes "
        "version to save you nine hours but it is not enough just to listen to me talk "
        "about stuff so I have also included a little assessment at the end of the video"
    )
    # Falso "traducido" que sigue en inglés
    assert api._traduccion_parece_incompleta(original, original, "en", "es") is True
    bueno = (
        "Tomé el curso de ingeniería de prompts de Google por ti, así que aquí tienes "
        "el resumen para ahorrarte nueve horas, pero no basta con escucharme hablar "
        "de cosas, también incluí una pequeña evaluación al final del video"
    )
    assert api._traduccion_parece_incompleta(original, bueno, "en", "es") is False


def test_partir_texto_respeta_limite():
    largo = " ".join(["word"] * 200)
    trozos = api._partir_texto_mymemory(largo)
    assert all(len(t) <= 450 for t in trozos)
    assert "".join(trozos).replace(" ", "") == largo.replace(" ", "")
