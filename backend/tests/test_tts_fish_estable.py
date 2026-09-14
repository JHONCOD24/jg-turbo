"""Voz Fish estable en el PDF: el timbre no cambia a media frase.

Sin red: solo el cuerpo de la petición, el modelo por defecto y los
reintentos. La causa medida (2026-09-14): un tropiezo puntual de Fish mandaba
ESE bloque a Edge en silencio y sonaba con otra voz por segundos.
"""

import sys
from pathlib import Path

_APP_ROOT = Path(__file__).resolve().parents[2]
if str(_APP_ROOT) not in sys.path:
    sys.path.insert(0, str(_APP_ROOT))

from api import index as api_module  # noqa: E402


def test_modelo_por_defecto_es_el_pagado():
    """El plan de $15 ($15 = 1M bytes) solo sirve si se pide el modelo pagado."""
    assert api_module.FISH_MODEL == "s2.1-pro"
    assert api_module.FISH_MODEL_GRATIS == "s2.1-pro-free"
    assert api_module.FISH_MODEL != api_module.FISH_MODEL_GRATIS


def test_cuerpo_estable_misma_voz_entre_bloques():
    cuerpo = api_module._tts_fish_cuerpo("Hola mundo.", "ref123", 1.0, "neutral")
    assert cuerpo["reference_id"] == "ref123"
    assert cuerpo["format"] == "mp3"
    assert cuerpo["temperature"] == 0.35
    assert cuerpo["top_p"] == 0.7
    assert cuerpo["chunk_length"] == 300
    assert cuerpo["normalize"] is True
    assert cuerpo["latency"] == "normal"
    assert cuerpo["sample_rate"] == 44100
    assert cuerpo["mp3_bitrate"] == 128
    assert cuerpo["prosody"]["normalize_loudness"] is True
    assert cuerpo["prosody"]["volume"] == 0
    assert cuerpo["text"] == "Hola mundo."


def test_cuerpo_respeta_tono_y_velocidad():
    cuerpo = api_module._tts_fish_cuerpo("Hola.", "ref", 1.0, "warm")
    assert cuerpo["text"].startswith("[friendly]")
    assert api_module._tts_fish_cuerpo("Hola.", "ref", 5.0, "neutral")["prosody"]["speed"] == 2.0
    assert api_module._tts_fish_cuerpo("Hola.", "ref", 0.1, "neutral")["prosody"]["speed"] == 0.5


def test_hay_reintentos_antes_de_ceder_a_otra_voz():
    """Un solo tropiezo no puede cambiar el timbre: se reintenta el bloque."""
    assert api_module.FISH_REINTENTOS == 2
