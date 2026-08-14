"""Regresiones del flujo de traduccion en el backend local."""
from __future__ import annotations

import sys
from pathlib import Path

from fastapi.testclient import TestClient

_APP_ROOT = Path(__file__).resolve().parents[2]
_BACKEND_ROOT = _APP_ROOT / "backend"
if str(_BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(_BACKEND_ROOT))

import app as backend_app  # noqa: E402


def test_mymemory_no_reutiliza_un_trozo_fallido(monkeypatch):
    def fake_translate(texto, _src, _trg):
        return None if "FALLA" in texto else "Texto traducido"

    monkeypatch.setattr(backend_app, "_translate_mymemory", fake_translate)

    resultado = backend_app._translate_mymemory_chunked(
        "Primera frase. FALLA segunda frase.", "en", "es"
    )

    assert resultado is None


def test_endpoint_local_limpia_horas_y_no_mezcla(monkeypatch):
    def fake_translate(texto, _src, _trg):
        assert "0:00" not in texto
        assert "0:01" not in texto
        return "Hola mundo. Esto es una prueba."

    monkeypatch.setattr(backend_app, "_translate_mymemory", fake_translate)
    client = TestClient(backend_app.app)

    respuesta = client.post(
        "/translate",
        json={
            "text": "0:00 Hello world.\n0:01 This is a test.",
            "direction": "en-es",
            "provider": "none",
            "prefer_fast": True,
        },
    )

    assert respuesta.status_code == 200
    datos = respuesta.json()
    assert datos["text"] == "Hola mundo. Esto es una prueba."
    assert "0:00" not in datos["text"]


def test_endpoint_local_devuelve_error_si_mymemory_falla(monkeypatch):
    monkeypatch.setattr(backend_app, "_translate_mymemory", lambda *_args: None)
    client = TestClient(backend_app.app)

    respuesta = client.post(
        "/translate",
        json={
            "text": "Hello world.",
            "direction": "en-es",
            "provider": "none",
        },
    )

    assert respuesta.status_code == 500
    assert "Hello world" not in respuesta.json()["detail"]


def test_endpoint_local_limpia_prefacio_de_ia(monkeypatch):
    def fake_ia(_provider, _key, prompt, _model):
        assert "Translate the following text" in prompt
        return "Here is the translation:\nHello world.", "gemini"

    monkeypatch.setattr(backend_app, "_mejorar_con_ia_sync", fake_ia)
    client = TestClient(backend_app.app)

    respuesta = client.post(
        "/translate",
        json={
            "text": "Hola mundo.",
            "direction": "es-en",
            "provider": "gemini",
            "api_key": "clave-demo",
        },
    )

    assert respuesta.status_code == 200
    assert respuesta.json()["text"] == "Hello world."
