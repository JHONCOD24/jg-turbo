"""Un bloque de respaldo no se cachea, y su voz se parece a la que venía sonando.

Por qué existe esta prueba
--------------------------
El audio se pide por GET con `max-age=86400, immutable`. Si un bloque salía con
una voz de respaldo (Fish tropezó: timeout, 429, sin créditos), ese audio malo
quedaba pegado a esa dirección durante un día: el cliente reintentaba el MISMO
bloque y el navegador o el CDN le devolvían otra vez el audio equivocado. De ahí
que siempre fueran los mismos pasajes los que «cambiaban de voz» a media
lectura.

Se comprueba sin red: se sustituye la síntesis por una función que finge cada
desenlace. Lo que se mira son las cabeceras, que es donde vive la decisión.
"""

import asyncio
import sys
import types

import pytest

# `edge_tts` solo hace falta para sintetizar de verdad; aquí se finge.
sys.modules.setdefault("edge_tts", types.ModuleType("edge_tts"))

from api import index as api  # noqa: E402


def _render(caso, **campos):
    """Renderiza un fragmento fingiendo el desenlace `caso` de la síntesis."""

    async def falso(text, candidate, rate, pitch, volume, tone, source="",
                    speed=1.0, gender="female", prefer_fish=False, fish_voice=""):
        if prefer_fish and caso == "fish_ok":
            return b"\xff\xfbAUDIO", "fish", "", api.FISH_MODEL
        if prefer_fish and caso == "fish_gratis":
            return b"\xff\xfbAUDIO", "fish", "", api.FISH_MODEL_GRATIS
        return b"\xff\xfbAUDIO", "edge", "", ""

    original = api._tts_synthesize
    api._tts_synthesize = falso
    try:
        peticion = api.TtsRequest(
            text="Capítulo XIV: gané 10000 dólares.",
            voice="male", rate=1.0, language="es", locale="es-CO",
            tone="neutral", source="pdf", **campos,
        )
        return asyncio.run(api._tts_render(peticion, cache_seconds=86400))
    finally:
        api._tts_synthesize = original


FISH = dict(unified=True, prefer_fish=True, fish_voice="roberto")


def test_la_voz_pedida_si_se_cachea():
    r = _render("fish_ok", **FISH)
    assert r.headers["x-tts-fallback"] == "0"
    assert "max-age=86400" in r.headers["cache-control"]


def test_el_respaldo_no_se_cachea():
    r = _render("fish_cae", **FISH)
    assert r.headers["x-tts-fallback"] == "1"
    assert r.headers["cache-control"] == "no-store"


def test_el_modelo_de_fish_lo_juzga_el_cliente_no_el_servidor():
    """Sin créditos en el plan pagado, TODOS los bloques van por el gratuito.

    Eso es consistente —no hay cambio de timbre a media lectura—, así que el
    servidor no puede marcarlos como respaldo: dejaría la lectura entera sin
    caché y con tres intentos por bloque. Lo que sí hace es anunciar el modelo,
    para que el cliente compare con el del primer bloque de la sesión.
    """
    r = _render("fish_gratis", **FISH)
    assert r.headers["x-tts-voice"].startswith("fish:")
    assert r.headers["x-tts-model"] == api.FISH_MODEL_GRATIS
    assert r.headers["x-tts-fallback"] == "0"
    assert "max-age=86400" in r.headers["cache-control"]


def test_el_respaldo_de_fish_habla_con_el_acento_pedido():
    """Y no con la multilingüe `en-US-*`, que sonaba a otra persona."""
    r = _render("fish_cae", **FISH)
    assert r.headers["x-tts-voice"].startswith("es-")


def test_misma_voz_sin_fish_conserva_la_multilingue():
    """Quien elige «misma voz» pide justo eso: no se le cambia el orden."""
    r = _render("neural", unified=True, prefer_fish=False)
    assert "Multilingual" in r.headers["x-tts-voice"]
    assert r.headers["x-tts-fallback"] == "0"


@pytest.mark.parametrize("texto,trozo", [
    ("hola", 100),          # nunca por debajo del mínimo de la API
    ("x" * 250, 251),       # un bloque corto cabe entero en un trozo
    ("x" * 900, 300),       # y nunca se pide más del máximo de la API
])
def test_fish_recibe_un_trozo_que_abarca_el_bloque(texto, trozo):
    """Si Fish parte el bloque, reinicia la entonación y el tono se dispara."""
    cuerpo = api._tts_fish_cuerpo(texto, "ref", 1.0, "neutral")
    assert cuerpo["chunk_length"] == trozo
