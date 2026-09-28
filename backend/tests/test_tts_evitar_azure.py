"""Descargas largas de la biblioteca: la voz va por edge-tts, no por Azure F0.

Azure F0 permite 20 síntesis por minuto: un video de 60 min (~600 frases) a 18
por minuto tardaría ~33 min en generarse. Con `evitar_azure` la misma voz
neural (es-CO-SalomeNeural) sale de edge-tts, sin cuota. El doblaje en vivo no
lo manda y sigue igual. Todo con dobles: ninguna prueba sale a la red.
"""

import sys
from pathlib import Path

from fastapi.testclient import TestClient

_APP_ROOT = Path(__file__).resolve().parents[2]
if str(_APP_ROOT) not in sys.path:
    sys.path.insert(0, str(_APP_ROOT))

from api import index as api_module  # noqa: E402


def _cliente(monkeypatch):
    llamadas = []

    async def azure(text, voice_id, rate, pitch, tone):
        llamadas.append(("azure", voice_id))
        return b"ID3azure", ""

    async def edge(text, voice_id, rate, pitch, volume):
        llamadas.append(("edge", voice_id))
        return b"ID3edge"

    monkeypatch.setattr(api_module, "_tts_azure_activo", lambda: True)
    monkeypatch.setattr(api_module, "_tts_azure_synthesize", azure)
    monkeypatch.setattr(api_module, "_tts_edge_synthesize", edge)
    return TestClient(api_module.app), llamadas


CUERPO = {"text": "Hola a todos.", "voice": "female", "language": "es", "locale": "es-CO", "idioma_fijo": True}


def test_sin_evitar_azure_la_cadena_sigue_igual(monkeypatch):
    cliente, llamadas = _cliente(monkeypatch)
    r = cliente.post("/api/tts", json=CUERPO)
    assert r.status_code == 200
    assert llamadas == [("azure", "es-CO-SalomeNeural")]
    assert r.headers["X-TTS-Engine"].startswith("azure")


def test_con_evitar_azure_va_directo_a_edge_con_la_misma_voz(monkeypatch):
    cliente, llamadas = _cliente(monkeypatch)
    r = cliente.post("/api/tts", json={**CUERPO, "evitar_azure": True})
    assert r.status_code == 200
    assert llamadas == [("edge", "es-CO-SalomeNeural")]
    assert r.headers["X-TTS-Engine"].startswith("edge")
    assert r.headers["X-TTS-Fallback"] == "0"   # no es un respaldo: se pidió así


def test_get_tambien_acepta_evitar_azure(monkeypatch):
    cliente, llamadas = _cliente(monkeypatch)
    r = cliente.get("/api/tts", params={**CUERPO, "idioma_fijo": "true", "evitar_azure": "true"})
    assert r.status_code == 200
    assert llamadas[0][0] == "edge"


def test_evitar_azure_respeta_la_velocidad_pedida(monkeypatch):
    cliente, _ = _cliente(monkeypatch)
    r = cliente.post("/api/tts", json={**CUERPO, "evitar_azure": True, "rate": 1.2})
    assert r.headers["X-TTS-Rate"] == "+20%"
