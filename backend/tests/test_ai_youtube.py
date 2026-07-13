import sys
import types

from fastapi.testclient import TestClient

import app as app_module


def test_improve_con_mock_gemini():
    client = TestClient(app_module.app)
    original = app_module._mejorar_con_ia_sync

    def fake_mejorar(provider_resuelto, api_key, prompt, openrouter_model):
        assert api_key == "clave-demo"
        assert "TEXTO A CORREGIR:" in prompt
        return "Texto mejorado por mock.", "gemini"

    app_module._mejorar_con_ia_sync = fake_mejorar
    try:
        resp = client.post(
            "/improve",
            json={
                "text": "hola esto es una prueba",
                "provider": "gemini",
                "api_key": "clave-demo",
            },
        )
    finally:
        app_module._mejorar_con_ia_sync = original

    assert resp.status_code == 200
    data = resp.json()
    assert data["text"] == "Texto mejorado por mock."
    assert data["ia_used"] is True
    assert data["provider"] == "gemini"


def test_translate_con_mock_gemini():
    client = TestClient(app_module.app)
    original = app_module._mejorar_con_ia_sync

    def fake_mejorar(provider_resuelto, api_key, prompt, openrouter_model):
        assert api_key == "clave-demo"
        assert "Translate the following text" in prompt
        return "Hello world.", "gemini"

    app_module._mejorar_con_ia_sync = fake_mejorar
    try:
        resp = client.post(
            "/translate",
            json={
                "text": "Hola mundo.",
                "direction": "es-en",
                "provider": "gemini",
                "api_key": "clave-demo",
            },
        )
    finally:
        app_module._mejorar_con_ia_sync = original

    assert resp.status_code == 200
    data = resp.json()
    assert data["text"] == "Hello world."
    assert data["ia_used"] is True
    assert data["provider"] == "gemini"


def test_youtube_usa_subtitulos_con_mock():
    class FakeYDL:
        def __init__(self, opts):
            self.opts = opts

        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, tb):
            return False

        def extract_info(self, url, download=False):
            assert download is False
            return {
                "title": "Video de prueba",
                "duration": 120,
                "subtitles": {},
                "automatic_captions": {},
            }

    client = TestClient(app_module.app)
    original_obtener_subs = app_module._obtener_subtitulos
    original_yt_dlp = sys.modules.get("yt_dlp")
    sys.modules["yt_dlp"] = types.SimpleNamespace(YoutubeDL=FakeYDL)
    app_module._obtener_subtitulos = lambda info, idioma_corto: ("Texto desde subtítulos.", "es")
    try:
        resp = client.post(
            "/youtube",
            json={
                "url": "https://www.youtube.com/watch?v=abc123xyz00",
                "language": "es",
                "prefer_subtitles": True,
                "fast_mode": True,
            },
        )
    finally:
        app_module._obtener_subtitulos = original_obtener_subs
        if original_yt_dlp is None:
            sys.modules.pop("yt_dlp", None)
        else:
            sys.modules["yt_dlp"] = original_yt_dlp

    assert resp.status_code == 200
    data = resp.json()
    assert data["text"] == "Texto desde subtítulos."
    assert data["source"] == "subtitles"
    assert data["title"] == "Video de prueba"
