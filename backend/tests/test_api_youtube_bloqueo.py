"""Regresiones del flujo YouTube usado por la API de Vercel."""

import sys
import types
from pathlib import Path

import pytest
import requests
from fastapi.testclient import TestClient
from youtube_transcript_api import RequestBlocked

APP_ROOT = Path(__file__).resolve().parents[2]
if str(APP_ROOT) not in sys.path:
    sys.path.insert(0, str(APP_ROOT))

from api import index as api_module  # noqa: E402


def test_transcript_api_propaga_bloqueo_ip(monkeypatch):
    sesiones = []

    class ApiBloqueada:
        def __init__(self, http_client):
            sesiones.append(http_client)

        def list(self, video_id):
            raise RequestBlocked(video_id)

    monkeypatch.setattr(api_module, "YouTubeTranscriptApi", ApiBloqueada)

    with pytest.raises(api_module.YouTubeBloqueoIP, match="RequestBlocked"):
        api_module._subtitulos_via_transcript_api("abc123xyz00", "es")

    assert len(sesiones) == 1
    assert isinstance(sesiones[0], api_module._SesionYouTubeConTimeout)


def test_sesion_youtube_aplica_timeout_por_defecto(monkeypatch):
    timeouts = []

    def request_falso(self, method, url, **kwargs):
        timeouts.append(kwargs.get("timeout"))
        return types.SimpleNamespace(status_code=200)

    monkeypatch.setattr(requests.Session, "request", request_falso)
    sesion = api_module._SesionYouTubeConTimeout()

    sesion.get("https://example.test")
    sesion.get("https://example.test", timeout=2)

    assert timeouts == [api_module.YOUTUBE_HTTP_TIMEOUT_S, 2]


def test_bloqueo_de_subtitulos_conserva_fallback_ytdlp(monkeypatch):
    def subtitulos_bloqueados(video_id, idioma):
        raise api_module.YouTubeBloqueoIP("IpBlocked")

    class YdlConSubtitulos:
        def __init__(self, opciones):
            self.opciones = opciones

        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, tb):
            return False

        def extract_info(self, url, download=False):
            assert download is False
            return {
                "title": "Video recuperado",
                "duration": 60,
                "subtitles": {"es": [{"ext": "vtt", "url": "https://example.test"}]},
                "automatic_captions": {},
            }

    monkeypatch.setattr(
        api_module,
        "_subtitulos_via_transcript_api",
        subtitulos_bloqueados,
    )
    monkeypatch.setattr(
        api_module,
        "_obtener_subtitulos",
        lambda info, idioma: ("Texto recuperado por yt-dlp.", "es"),
    )
    monkeypatch.setitem(
        sys.modules,
        "yt_dlp",
        types.SimpleNamespace(YoutubeDL=YdlConSubtitulos),
    )

    respuesta = TestClient(api_module.app).post(
        "/api/youtube",
        json={
            "url": "https://www.youtube.com/watch?v=abc123xyz00",
            "language": "es",
            "prefer_subtitles": True,
        },
    )

    assert respuesta.status_code == 200
    assert respuesta.json()["text"] == "Texto recuperado por yt-dlp."
    assert respuesta.json()["source"] == "subtitles"


def test_doble_bloqueo_responde_503(monkeypatch):
    def subtitulos_bloqueados(video_id, idioma):
        raise api_module.YouTubeBloqueoIP("RequestBlocked")

    class YdlBloqueado:
        def __init__(self, opciones):
            self.opciones = opciones

        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, tb):
            return False

        def extract_info(self, url, download=False):
            raise RuntimeError("Sign in to confirm you’re not a bot")

    monkeypatch.setattr(
        api_module,
        "_subtitulos_via_transcript_api",
        subtitulos_bloqueados,
    )
    monkeypatch.setitem(
        sys.modules,
        "yt_dlp",
        types.SimpleNamespace(YoutubeDL=YdlBloqueado),
    )

    respuesta = TestClient(api_module.app).post(
        "/api/youtube",
        json={
            "url": "https://www.youtube.com/watch?v=abc123xyz00",
            "language": "es",
            "prefer_subtitles": True,
        },
    )

    assert respuesta.status_code == 503
    assert "anti-bot" in respuesta.json()["detail"]


def test_video_largo_sin_subtitulos_no_descarga_audio(monkeypatch):
    descargas = []

    class YdlFalso:
        def __init__(self, opciones):
            self.opciones = opciones

        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, tb):
            return False

        def extract_info(self, url, download=False):
            assert download is False
            return {
                "title": "Video largo",
                "duration": (api_module.MAX_YOUTUBE_AUDIO_MINUTES + 1) * 60,
                "subtitles": {},
                "automatic_captions": {},
            }

        def download(self, urls):
            descargas.append(urls)

    monkeypatch.setitem(
        sys.modules,
        "yt_dlp",
        types.SimpleNamespace(YoutubeDL=YdlFalso),
    )

    respuesta = TestClient(api_module.app).post(
        "/api/youtube",
        json={
            "url": "https://www.youtube.com/watch?v=abc123xyz00",
            "language": "es",
            "prefer_subtitles": False,
        },
    )

    assert respuesta.status_code == 422
    assert "demasiado largo" in respuesta.json()["detail"]
    assert descargas == []


def test_frontend_mantiene_error_visible():
    html = (APP_ROOT / "index.html").read_text(encoding="utf-8")

    assert (
        "area.style.display = (activo || esExito || esError) ? 'block' : 'none';"
        in html
    )
    assert 'id="ytProgArea" role="status" aria-live="polite"' in html


def test_ip_bloqueada_no_cancela_el_segundo_metodo(monkeypatch):
    """Antes, RequestBlocked abortaba y la página del video nunca se intentaba."""
    intentos = []

    class ApiBloqueada:
        def __init__(self, http_client):
            pass

        def list(self, video_id):
            raise RequestBlocked(video_id)

    def watch_page_con_texto(video_id, idioma):
        intentos.append(video_id)
        return "Texto recuperado de la página del video.", "es"

    monkeypatch.setattr(api_module, "YouTubeTranscriptApi", ApiBloqueada)
    monkeypatch.setattr(api_module, "_subtitulos_via_watch_page", watch_page_con_texto)

    texto, lang = api_module._subtitulos_via_transcript_api("abc123xyz00", "es")

    assert intentos == ["abc123xyz00"]
    assert texto == "Texto recuperado de la página del video."
    assert lang == "es"


def test_proxy_opcional_se_aplica_a_la_sesion(monkeypatch):
    """Con YOUTUBE_PROXY_URL la salida cambia de IP sin tocar el código."""
    monkeypatch.setattr(api_module, "YOUTUBE_PROXY_URL", "http://user:clave@proxy.test:8080")
    sesion = api_module._SesionYouTubeConTimeout()
    assert sesion.proxies["https"] == "http://user:clave@proxy.test:8080"

    monkeypatch.setattr(api_module, "YOUTUBE_PROXY_URL", "")
    assert api_module._SesionYouTubeConTimeout().proxies == {}


def test_frontend_ofrece_pegar_la_transcripcion():
    """La vía manual es la única que no depende de que YouTube deje pasar."""
    html = (APP_ROOT / "index.html").read_text(encoding="utf-8")

    assert 'id="ytPasteInput"' in html
    assert 'id="btnYtUsePaste"' in html
    assert "function jgLimpiarTranscripcionPegada(crudo)" in html
    # Al fallar el servidor, el bloque debe abrirse solo.
    assert "ytManual.open = true;" in html
