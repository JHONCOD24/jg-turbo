"""Doblaje: la voz no cambia a una voz inglesa en frases cortas con nombres.

Medido (2026-09-26): «Claude, ChatGPT.» es texto del doblaje en español, pero la
red de seguridad «tramo solo en inglés» lo mandaba a en-US: se oía OTRA voz a
media escena. Con `idioma_fijo` se usa siempre la voz del idioma pedido.
"""

import sys
from pathlib import Path

from fastapi.testclient import TestClient

_APP_ROOT = Path(__file__).resolve().parents[2]
if str(_APP_ROOT) not in sys.path:
    sys.path.insert(0, str(_APP_ROOT))

from api import index as api_module  # noqa: E402


def _cliente(monkeypatch):
    voces = []

    async def sintetizar(text, voice_id, *args, **kwargs):
        voces.append(voice_id)
        return b"ID3audio", "azure", "", ""

    monkeypatch.setattr(api_module, "_tts_synthesize", sintetizar)
    return TestClient(api_module.app), voces


def test_sin_idioma_fijo_la_red_de_seguridad_sigue_igual(monkeypatch):
    cliente, voces = _cliente(monkeypatch)
    cliente.get("/api/tts", params={"text": "Claude, ChatGPT.", "voice": "female", "language": "es", "locale": "es-CO"})
    assert voces and voces[0].startswith("en-"), "fuera del doblaje, un tramo solo en inglés sigue yendo a voz inglesa"


def test_con_idioma_fijo_siempre_la_voz_espanola(monkeypatch):
    cliente, voces = _cliente(monkeypatch)
    r = cliente.get("/api/tts", params={"text": "Claude, ChatGPT.", "voice": "female", "language": "es", "locale": "es-CO", "idioma_fijo": "true"})
    assert r.status_code == 200
    assert voces[0] == "es-CO-SalomeNeural"


def test_post_con_idioma_fijo(monkeypatch):
    cliente, voces = _cliente(monkeypatch)
    r = cliente.post("/api/tts", json={"text": "Gemini, OpenAI.", "voice": "male", "language": "es", "locale": "es-CO", "idioma_fijo": True})
    assert r.status_code == 200
    assert voces[0] == "es-CO-GonzaloNeural"


def test_el_precalentamiento_responde_ok(monkeypatch):
    """Desempaquetaba 3 valores de una función que devuelve 4: siempre decía «falló»."""
    cliente, _ = _cliente(monkeypatch)
    assert cliente.get("/api/tts-warmup").json()["ok"] is True
