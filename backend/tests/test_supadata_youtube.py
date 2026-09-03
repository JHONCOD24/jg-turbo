"""Vía automática de YouTube (Supadata): cliente y cadena del endpoint.

Todo con dobles: ninguna prueba sale a la red ni gasta créditos.
"""

import sys
import types
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

APP_ROOT = Path(__file__).resolve().parents[2]
if str(APP_ROOT) not in sys.path:
    sys.path.insert(0, str(APP_ROOT))

from api import index as api_module  # noqa: E402
from api import supadata as sd  # noqa: E402

URL_VIDEO = "https://www.youtube.com/watch?v=abc123xyz00"


@pytest.fixture
def con_clave(monkeypatch):
    monkeypatch.setattr(sd, "API_KEY", "clave-de-prueba")
    return "clave-de-prueba"


def _respuesta(status, payload):
    """Doble mínimo de requests.Response."""
    return types.SimpleNamespace(status_code=status, json=lambda: payload)


# ── Cliente ───────────────────────────────────────────────────────────────────

def test_texto_de_contenido_acepta_string_y_trozos():
    assert sd.texto_de_contenido("  hola mundo  ") == "hola mundo"
    trozos = [{"text": "hola"}, {"text": "\nmundo "}, {"text": ""}]
    assert sd.texto_de_contenido(trozos) == "hola mundo"
    assert sd.texto_de_contenido(None) == ""


def test_transcribir_pide_texto_plano_y_modo_auto(monkeypatch, con_clave):
    """mode=auto es lo que hace que un video sin subtítulos se genere con IA."""
    capturado = {}

    def get_falso(url, params=None, headers=None, timeout=None):
        capturado["url"] = url
        capturado["params"] = params
        capturado["headers"] = headers
        return _respuesta(200, {"content": "Texto del video.", "lang": "es"})

    monkeypatch.setattr(sd.requests, "get", get_falso)
    resultado = sd.transcribir(URL_VIDEO, "es")

    assert resultado == {"texto": "Texto del video.", "lang": "es", "disponibles": []}
    assert capturado["url"].endswith("/transcript")
    assert capturado["params"]["mode"] == "auto"
    assert capturado["params"]["text"] == "true"
    assert capturado["params"]["lang"] == "es"
    assert capturado["headers"]["x-api-key"] == "clave-de-prueba"


def test_transcribir_sin_idioma_no_manda_lang(monkeypatch, con_clave):
    capturado = {}

    def get_falso(url, params=None, headers=None, timeout=None):
        capturado.update(params or {})
        return _respuesta(200, {"content": "ok texto", "lang": "en"})

    monkeypatch.setattr(sd.requests, "get", get_falso)
    sd.transcribir(URL_VIDEO, None)
    assert "lang" not in capturado


def test_transcribir_devuelve_job_para_video_largo(monkeypatch, con_clave):
    monkeypatch.setattr(
        sd.requests, "get",
        lambda *a, **k: _respuesta(202, {"jobId": "job-777"}),
    )
    assert sd.transcribir(URL_VIDEO, "es") == {"job_id": "job-777"}


def test_error_de_cuenta_se_distingue_del_error_de_video(monkeypatch, con_clave):
    monkeypatch.setattr(
        sd.requests, "get",
        lambda *a, **k: _respuesta(402, {"error": "limit-exceeded"}),
    )
    with pytest.raises(sd.SupadataError) as exc:
        sd.transcribir(URL_VIDEO, "es")
    assert exc.value.es_de_cuenta
    assert "créditos" in str(exc.value)

    monkeypatch.setattr(
        sd.requests, "get",
        lambda *a, **k: _respuesta(404, {"error": "not-found"}),
    )
    with pytest.raises(sd.SupadataError) as exc2:
        sd.transcribir(URL_VIDEO, "es")
    assert not exc2.value.es_de_cuenta


def test_sin_clave_no_intenta_salir_a_la_red(monkeypatch):
    monkeypatch.setattr(sd, "API_KEY", "")

    def nunca(*a, **k):  # pragma: no cover - debe no llamarse
        raise AssertionError("no debería haber petición sin clave")

    monkeypatch.setattr(sd.requests, "get", nunca)
    assert sd.configurado() is False
    with pytest.raises(sd.SupadataError):
        sd.transcribir(URL_VIDEO, "es")


def test_esperar_devuelve_none_si_se_agota_el_presupuesto(monkeypatch, con_clave):
    monkeypatch.setattr(sd.time, "sleep", lambda s: None)
    monkeypatch.setattr(sd, "estado_job", lambda job, con_tiempos=False: {"estado": "en_proceso"})
    assert sd.esperar("job-777", 0.01) is None


def test_esperar_devuelve_el_texto_al_completarse(monkeypatch, con_clave):
    llamadas = {"n": 0}

    def estado(job, con_tiempos=False):
        llamadas["n"] += 1
        if llamadas["n"] < 2:
            return {"estado": "en_proceso"}
        return {"estado": "completado", "texto": "Listo.", "lang": "es"}

    monkeypatch.setattr(sd.time, "sleep", lambda s: None)
    monkeypatch.setattr(sd, "estado_job", estado)
    resultado = sd.esperar("job-777", 30)

    assert resultado["texto"] == "Listo."
    assert resultado["intentos"] == 2


# ── Elección de idioma en modo «auto» ─────────────────────────────────────────

def test_elegir_idioma_deja_pasar_lo_que_ya_sirve():
    assert sd.elegir_idioma("es", ["es", "en", "de"]) is None
    assert sd.elegir_idioma("en-US", ["en", "de"]) is None


def test_elegir_idioma_rescata_un_idioma_util():
    """Caso real: un video en inglés llegaba en alemán con «auto»."""
    assert sd.elegir_idioma("de", ["de", "en", "fr"]) == "en"
    assert sd.elegir_idioma("de", ["de", "es", "en"]) == "es"  # español primero


def test_elegir_idioma_no_fuerza_si_no_hay_nada_mejor():
    """Un video solo en francés debe quedarse en francés, no romperse."""
    assert sd.elegir_idioma("fr", ["fr"]) is None
    assert sd.elegir_idioma("de", []) is None


def test_auto_reintenta_para_no_devolver_un_idioma_arbitrario(monkeypatch):
    _bloquear_via_gratuita(monkeypatch)
    monkeypatch.setattr(sd, "API_KEY", "clave-de-prueba")
    pedidos = []

    def transcribir(url, idioma, con_tiempos=False):
        pedidos.append(idioma)
        if idioma is None:
            return {"texto": "Also hier sind wir.", "lang": "de", "disponibles": ["de", "en"]}
        return {"texto": "All right, so here we are.", "lang": "en", "disponibles": ["de", "en"]}

    monkeypatch.setattr(sd, "transcribir", transcribir)

    resp = TestClient(api_module.app).post(
        "/api/youtube",
        json={"url": URL_VIDEO, "language": "auto", "prefer_subtitles": True},
    )

    assert resp.status_code == 200
    assert resp.json()["language"] == "en"
    assert resp.json()["text"] == "All right, so here we are."
    assert pedidos == [None, "en"]


def test_con_idioma_explicito_no_hay_reintento(monkeypatch):
    """Si el usuario eligió idioma, se respeta y no se gasta otro crédito."""
    _bloquear_via_gratuita(monkeypatch)
    monkeypatch.setattr(sd, "API_KEY", "clave-de-prueba")
    pedidos = []

    def transcribir(url, idioma, con_tiempos=False):
        pedidos.append(idioma)
        return {"texto": "Texto.", "lang": "de", "disponibles": ["de", "en"]}

    monkeypatch.setattr(sd, "transcribir", transcribir)

    TestClient(api_module.app).post(
        "/api/youtube",
        json={"url": URL_VIDEO, "language": "de", "prefer_subtitles": True},
    )

    assert pedidos == ["de"]


def test_reintento_que_se_vuelve_trabajo_largo_conserva_el_texto(monkeypatch):
    """Mejor un idioma imperfecto que hacer esperar de nuevo al usuario."""
    _bloquear_via_gratuita(monkeypatch)
    monkeypatch.setattr(sd, "API_KEY", "clave-de-prueba")

    def transcribir(url, idioma, con_tiempos=False):
        if idioma is None:
            return {"texto": "Texto en alemán.", "lang": "de", "disponibles": ["de", "en"]}
        return {"job_id": "job-lento"}

    monkeypatch.setattr(sd, "transcribir", transcribir)

    resp = TestClient(api_module.app).post(
        "/api/youtube",
        json={"url": URL_VIDEO, "language": "auto", "prefer_subtitles": True},
    )

    assert resp.status_code == 200
    assert resp.json()["text"] == "Texto en alemán."


# ── Cadena del endpoint ───────────────────────────────────────────────────────

def _bloquear_via_gratuita(monkeypatch):
    """YouTube bloquea al servidor: es lo que pasa de verdad en Vercel."""
    def bloqueado(video_id, idioma):
        raise api_module.YouTubeBloqueoIP("RequestBlocked")

    monkeypatch.setattr(api_module, "_subtitulos_via_transcript_api", bloqueado)


def test_youtube_usa_supadata_cuando_youtube_bloquea(monkeypatch):
    """El caso real: sin esto el usuario terminaba pegando el texto a mano."""
    _bloquear_via_gratuita(monkeypatch)
    monkeypatch.setattr(sd, "API_KEY", "clave-de-prueba")
    monkeypatch.setattr(
        sd, "transcribir",
        lambda url, idioma, con_tiempos=False: {"texto": "Texto traído por Supadata.", "lang": "es"},
    )

    resp = TestClient(api_module.app).post(
        "/api/youtube",
        json={"url": URL_VIDEO, "language": "es", "prefer_subtitles": True},
    )

    assert resp.status_code == 200
    assert resp.json()["text"] == "Texto traído por Supadata."
    assert resp.json()["source"] == "subtitles"


def test_la_via_gratuita_va_primero_y_no_gasta_creditos(monkeypatch):
    """Si YouTube responde, no se llama a Supadata (el plan gratis es de 100/mes)."""
    monkeypatch.setattr(
        api_module, "_subtitulos_via_transcript_api",
        lambda video_id, idioma: ("Subtítulos gratis.", "es", []),
    )
    monkeypatch.setattr(sd, "API_KEY", "clave-de-prueba")

    def nunca(*a, **k):  # pragma: no cover - debe no llamarse
        raise AssertionError("no debe gastarse un crédito si YouTube respondió")

    monkeypatch.setattr(sd, "transcribir", nunca)

    resp = TestClient(api_module.app).post(
        "/api/youtube",
        json={"url": URL_VIDEO, "language": "es", "prefer_subtitles": True},
    )

    assert resp.status_code == 200
    assert resp.json()["text"] == "Subtítulos gratis."


def test_video_largo_devuelve_202_con_identificador(monkeypatch):
    """Videos de +20 min: el navegador sigue esperando sin morir a los 60 s."""
    _bloquear_via_gratuita(monkeypatch)
    monkeypatch.setattr(sd, "API_KEY", "clave-de-prueba")
    monkeypatch.setattr(sd, "transcribir", lambda url, idioma, con_tiempos=False: {"job_id": "job-largo"})
    monkeypatch.setattr(sd, "esperar", lambda job, segundos, con_tiempos=False: None)

    resp = TestClient(api_module.app).post(
        "/api/youtube",
        json={"url": URL_VIDEO, "language": "es", "prefer_subtitles": True},
    )

    assert resp.status_code == 202
    assert resp.json()["pending"] is True
    assert resp.json()["job_id"] == "job-largo"


def test_video_largo_que_termina_a_tiempo_responde_texto(monkeypatch):
    _bloquear_via_gratuita(monkeypatch)
    monkeypatch.setattr(sd, "API_KEY", "clave-de-prueba")
    monkeypatch.setattr(sd, "transcribir", lambda url, idioma, con_tiempos=False: {"job_id": "job-largo"})
    monkeypatch.setattr(
        sd, "esperar",
        lambda job, segundos, con_tiempos=False: {"estado": "completado", "texto": "Charla larga.", "lang": "en"},
    )

    resp = TestClient(api_module.app).post(
        "/api/youtube",
        json={"url": URL_VIDEO, "language": "auto", "prefer_subtitles": True},
    )

    assert resp.status_code == 200
    assert resp.json()["text"] == "Charla larga."
    assert resp.json()["language"] == "en"


def test_endpoint_de_trabajo_entrega_el_texto(monkeypatch):
    monkeypatch.setattr(sd, "API_KEY", "clave-de-prueba")
    monkeypatch.setattr(
        sd, "estado_job",
        lambda job, con_tiempos=False: {"estado": "completado", "texto": "Terminado.", "lang": "es"},
    )

    resp = TestClient(api_module.app).get("/api/youtube-job?id=job-largo")
    assert resp.status_code == 200
    assert resp.json()["text"] == "Terminado."


def test_endpoint_de_trabajo_responde_202_mientras_procesa(monkeypatch):
    monkeypatch.setattr(sd, "API_KEY", "clave-de-prueba")
    monkeypatch.setattr(sd, "estado_job", lambda job, con_tiempos=False: {"estado": "en_proceso"})

    resp = TestClient(api_module.app).get("/api/youtube-job?id=job-largo")
    assert resp.status_code == 202
    assert resp.json()["pending"] is True


def test_creditos_agotados_se_reporta_como_problema_de_cuenta(monkeypatch):
    _bloquear_via_gratuita(monkeypatch)
    monkeypatch.setattr(sd, "API_KEY", "clave-de-prueba")

    def sin_creditos(url, idioma, con_tiempos=False):
        raise sd.SupadataError("Se agotaron los créditos de Supadata este mes.", "limit-exceeded", 402)

    monkeypatch.setattr(sd, "transcribir", sin_creditos)

    resp = TestClient(api_module.app).post(
        "/api/youtube",
        json={"url": URL_VIDEO, "language": "es", "prefer_subtitles": True},
    )

    assert resp.status_code == 402
    assert "créditos" in resp.json()["detail"]


def test_sin_supadata_la_cadena_antigua_sigue_intacta(monkeypatch):
    """Quitar la clave no puede romper lo que ya funcionaba."""
    _bloquear_via_gratuita(monkeypatch)
    monkeypatch.setattr(sd, "API_KEY", "")

    class YdlConSubtitulos:
        def __init__(self, opciones):
            pass

        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

        def extract_info(self, url, download=False):
            return {
                "title": "Video",
                "duration": 60,
                "subtitles": {"es": [{"ext": "vtt", "url": "https://example.test"}]},
                "automatic_captions": {},
            }

    monkeypatch.setattr(
        api_module, "_obtener_subtitulos", lambda info, idioma: ("Texto por yt-dlp.", "es", [])
    )
    monkeypatch.setitem(sys.modules, "yt_dlp", types.SimpleNamespace(YoutubeDL=YdlConSubtitulos))

    resp = TestClient(api_module.app).post(
        "/api/youtube",
        json={"url": URL_VIDEO, "language": "es", "prefer_subtitles": True},
    )

    assert resp.status_code == 200
    assert resp.json()["text"] == "Texto por yt-dlp."


def test_health_avisa_si_la_via_automatica_esta_lista(monkeypatch):
    """Permite verificar el despliegue sin ver nunca la clave."""
    monkeypatch.setattr(sd, "API_KEY", "clave-de-prueba")
    assert TestClient(api_module.app).get("/api/health").json()["youtube_auto"] is True

    monkeypatch.setattr(sd, "API_KEY", "")
    assert TestClient(api_module.app).get("/api/health").json()["youtube_auto"] is False


# ── Frontend ──────────────────────────────────────────────────────────────────

def test_frontend_espera_los_videos_largos():
    html = (APP_ROOT / "index.html").read_text(encoding="utf-8")
    assert "async function jgEsperarTrabajoYoutube(" in html
    assert "'/youtube-job?id=' + encodeURIComponent(jobId)" in html
    assert "data.pending && data.job_id" in html


def test_el_pegado_manual_ya_no_se_ofrece_como_camino_principal():
    html = (APP_ROOT / "index.html").read_text(encoding="utf-8")
    assert "Pegar transcripción de YouTube (siempre funciona)" not in html
    # Sigue existiendo como red de seguridad.
    assert 'id="ytPasteInput"' in html
    assert "ytManual.open = true;" in html
