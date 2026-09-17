"""Un servicio de voz atascado no puede tumbar la petición entera.

Por qué existe esta prueba
--------------------------
La función tiene 60 s en la plataforma. Fish, cuando se atasca, se los comía
enteros: 25 s por intento, tres intentos, dos modelos — hasta 150 s. La
petición moría con `FUNCTION_INVOCATION_TIMEOUT` ANTES de que Edge llegara a
intentarlo, y Edge habría contestado en dos segundos. Medido contra producción
el 2026-09-17: cuatro de cuatro peticiones con voz de Fish daban 504 a los 60 s
justos. Para quien escucha, eso es la lectura que se frena y hay que reiniciar.

La regla que se protege aquí es una sola: **pase lo que pase con los servicios
de voz, el servidor contesta**. Antes del límite, y con audio.
"""

import asyncio
import sys
import time
import types

import pytest

sys.modules.setdefault("edge_tts", types.ModuleType("edge_tts"))

from api import index as api  # noqa: E402


@pytest.fixture
def fish_colgado(monkeypatch):
    """Fish que nunca contesta, como el que se vio en producción."""
    async def colgado(*_a, **_k):
        await asyncio.sleep(3600)
    monkeypatch.setattr(api, "_tts_fish_synthesize", colgado)
    monkeypatch.setattr(api, "FISH_API_KEY", "clave-de-prueba")
    monkeypatch.setattr(api, "_tts_fish_activo", lambda *a, **k: True)


@pytest.fixture
def edge_rapido(monkeypatch):
    async def rapido(*_a, **_k):
        await asyncio.sleep(0.05)
        return b"\xff\xfbAUDIO"
    monkeypatch.setattr(api, "_tts_edge_synthesize", rapido)


def test_fish_colgado_no_impide_que_el_bloque_llegue(fish_colgado, edge_rapido, monkeypatch):
    """Se le acota el rato a Fish y el respaldo sí alcanza a contestar."""
    # Presupuesto corto para que la prueba dure un suspiro, no 22 s.
    monkeypatch.setattr(api, "FISH_PRESUPUESTO_SEG", 1.0)
    monkeypatch.setattr(api, "TTS_PRESUPUESTO_SEG", 6.0)

    peticion = api.TtsRequest(
        text="Capítulo catorce de prueba.", voice="male", rate=1.0, language="es",
        locale="es-CO", tone="neutral", unified=True, source="pdf",
        prefer_fish=True, fish_voice="roberto",
    )
    t0 = time.monotonic()
    r = asyncio.run(api._tts_render(peticion, cache_seconds=86400))
    tardo = time.monotonic() - t0

    assert r.status_code == 200
    assert r.body, "tiene que venir audio, no una respuesta vacía"
    # Sonó el respaldo, así que ni se cachea ni se anuncia como la voz pedida.
    assert r.headers["x-tts-fallback"] == "1"
    assert r.headers["cache-control"] == "no-store"
    assert tardo < api.TTS_PRESUPUESTO_SEG, f"tardó {tardo:.1f}s, más que su propio presupuesto"


def test_el_presupuesto_cabe_en_el_limite_de_la_plataforma():
    """`vercel.json` da 60 s: el presupuesto tiene que dejar margen de sobra."""
    import json
    from pathlib import Path

    cfg = json.loads((Path(__file__).resolve().parents[1] / "vercel.json").read_text(encoding="utf-8"))
    limite = cfg["functions"]["api/index.py"]["maxDuration"]
    assert api.TTS_PRESUPUESTO_SEG < limite - 10, (
        f"el presupuesto ({api.TTS_PRESUPUESTO_SEG}s) se acerca demasiado al "
        f"límite de la plataforma ({limite}s)"
    )
    assert api.FISH_PRESUPUESTO_SEG < api.TTS_PRESUPUESTO_SEG - 15, (
        "a Fish no se le puede dar casi todo el presupuesto: el respaldo "
        "necesita tiempo para contestar"
    )
