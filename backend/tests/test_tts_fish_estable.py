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
    # Desde v2.86.0: un bloque = UNA sola generación interna. `chunk_length`
    # acompaña al texto (mínimo 100, tope 300): en cada corte interno Fish
    # reinicia la prosodia y el timbre podía subir de golpe («chillidos»).
    assert cuerpo["chunk_length"] == max(100, min(api_module.FISH_CHUNK_LENGTH, len("Hola mundo.") + 1))
    texto_largo = "x" * 500
    assert api_module._tts_fish_cuerpo(texto_largo, "ref", 1.0, "neutral")["chunk_length"] == 300
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


# ── Fusible (2026-09-17): Fish caído no puede quemar 22 s por bloque ────────

def _reiniciar_fusible():
    api_module._fish_fallos_seguidos = 0
    api_module._fish_fusible_hasta = 0.0
    api_module._fish_pagado_hasta = 0.0


def test_fusible_se_abre_tras_fallos_seguidos():
    """Tres bloques seguidos sin audio de Fish dejan el servicio en cuarentena."""
    _reiniciar_fusible()
    try:
        assert not api_module._tts_fish_fusible_abierto(ahora=100.0)
        api_module._tts_fish_registrar_fallo(ahora=100.0)
        api_module._tts_fish_registrar_fallo(ahora=101.0)
        assert not api_module._tts_fish_fusible_abierto(ahora=101.0)
        api_module._tts_fish_registrar_fallo(ahora=102.0)
        assert api_module._tts_fish_fusible_abierto(ahora=102.0)
        assert api_module._tts_fish_fusible_abierto(
            ahora=102.0 + api_module.FISH_FUSIBLE_SEG - 1
        )
        assert not api_module._tts_fish_fusible_abierto(
            ahora=102.0 + api_module.FISH_FUSIBLE_SEG + 1
        ), "pasado el descanso, Fish se vuelve a probar"
    finally:
        _reiniciar_fusible()


def test_fusible_un_exito_rearma_el_contador():
    _reiniciar_fusible()
    try:
        api_module._tts_fish_registrar_fallo(ahora=100.0)
        api_module._tts_fish_registrar_fallo(ahora=101.0)
        api_module._tts_fish_registrar_exito()
        api_module._tts_fish_registrar_fallo(ahora=102.0)
        api_module._tts_fish_registrar_fallo(ahora=103.0)
        assert not api_module._tts_fish_fusible_abierto(ahora=103.0), (
            "el éxito en medio de la racha reinicia la cuenta"
        )
    finally:
        _reiniciar_fusible()


def test_fusible_abierto_apaga_fish():
    """Con el fusible abierto, _tts_fish_activo dice que no: el bloque va
    directo al respaldo en 1-2 s en vez de quemar su presupuesto entero."""
    _reiniciar_fusible()
    clave_previa = api_module.FISH_API_KEY
    try:
        api_module.FISH_API_KEY = "clave-de-prueba"
        assert api_module._tts_fish_activo("pdf", "male", True, "roberto")
        # Con el reloj REAL: _tts_fish_activo mira time.monotonic(), así que
        # los fallos también se registran con el reloj real.
        for _ in range(api_module.FISH_FUSIBLE_UMBRAL):
            api_module._tts_fish_registrar_fallo()
        assert not api_module._tts_fish_activo("pdf", "male", True, "roberto")
    finally:
        api_module.FISH_API_KEY = clave_previa
        _reiniciar_fusible()


def test_402_se_recuerda_y_no_se_reintenta_cada_bloque():
    """El modelo pagado sin créditos (402) se salta un rato: reintentarlo
    por bloque solo gastaba tiempo que el respaldo necesitaba."""
    _reiniciar_fusible()
    try:
        modelos = api_module._tts_fish_modelos(ahora=100.0)
        assert modelos[0] == api_module.FISH_MODEL
        assert api_module.FISH_MODEL_GRATIS in modelos
        api_module._tts_fish_registrar_402(ahora=100.0)
        modelos = api_module._tts_fish_modelos(ahora=101.0)
        assert api_module.FISH_MODEL not in modelos, "el 402 fresco salta el pagado"
        assert modelos == [api_module.FISH_MODEL_GRATIS]
        modelos = api_module._tts_fish_modelos(
            ahora=100.0 + api_module.FISH_402_SEG + 1
        )
        assert api_module.FISH_MODEL in modelos, "pasada la memoria, se vuelve a probar"
    finally:
        _reiniciar_fusible()
