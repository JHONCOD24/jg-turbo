"""Marcas de tiempo para el doblaje sincronizado (`include_timestamps`).

`js/youtube/transcriptionService.js` pide `include_timestamps: true` y necesita
`segments` con `startTime`, `duration` y `text`. Sin eso el botón «Traducir y
doblar al español» moría con «no hay marcas de tiempo utilizables».

Todo con dobles: ninguna prueba sale a la red ni gasta créditos.
"""

import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

_APP_ROOT = Path(__file__).resolve().parents[2]
if str(_APP_ROOT) not in sys.path:
    sys.path.insert(0, str(_APP_ROOT))

from api import index as api_module  # noqa: E402
from api import supadata as sd  # noqa: E402
from api.subtitulos_limpieza import segmentos_desde_vtt, unir_segmentos  # noqa: E402
from api.youtube_subs import segmentos_desde_fetched  # noqa: E402

URL_VIDEO = "https://www.youtube.com/watch?v=abc123xyz00"

VTT_RODANTE = "\n".join([
    "WEBVTT",
    "Kind: captions",
    "",
    "00:00:01.000 --> 00:00:04.000",
    "hoy vamos a hablar de",
    "",
    "00:00:03.500 --> 00:00:07.000",
    "hoy vamos a hablar de",
    "un tema que cambia todo",
    "",
    "00:00:06.500 --> 00:00:10.000",
    "un tema que cambia todo y por eso",
])


# ── Parseo con tiempos ──────────────────────────────────────────────────────

def test_vtt_conserva_los_tiempos_y_quita_el_solape():
    segs = segmentos_desde_vtt(VTT_RODANTE)
    assert [s["texto"] for s in segs] == [
        "hoy vamos a hablar de",
        "un tema que cambia todo",
        "y por eso",
    ]
    assert [s["inicio"] for s in segs] == [1.0, 3.5, 6.5]
    assert segs[0]["duracion"] == pytest.approx(3.0)


def test_srt_con_coma_decimal():
    srt = "1\n00:00:01,000 --> 00:00:03,500\nprimera\n\n2\n00:00:03,500 --> 00:00:06,000\nsegunda\n"
    segs = segmentos_desde_vtt(srt)
    assert [s["inicio"] for s in segs] == [1.0, 3.5]


def test_hora_de_mas_de_una_hora():
    largo = "WEBVTT\n\n01:02:03.500 --> 01:02:06.000\ntexto tardio\n"
    assert segmentos_desde_vtt(largo)[0]["inicio"] == pytest.approx(3723.5)


def test_json3_conserva_tiempos():
    import json
    raw = json.dumps({"events": [
        {"tStartMs": 1000, "dDurationMs": 3000, "segs": [{"utf8": "hola"}, {"utf8": " mundo"}]},
        {"tStartMs": 4000, "dDurationMs": 2000, "segs": [{"utf8": "hola mundo cruel"}]},
    ]})
    segs = api_module._json3_a_segmentos(raw)
    assert [s["texto"] for s in segs] == ["hola mundo", "cruel"]
    assert [s["inicio"] for s in segs] == [1.0, 4.0]


def test_srv3_conserva_tiempos():
    raw = '<transcript><text start="1.5" dur="2.5">primera parte</text>' \
          '<text start="4.0" dur="2.0">segunda parte</text></transcript>'
    segs = api_module._xml_captions_a_segmentos(raw)
    assert [s["inicio"] for s in segs] == [1.5, 4.0]
    assert [s["duracion"] for s in segs] == [2.5, 2.0]


def test_snippets_de_youtube_transcript_api():
    datos = [
        {"text": "hoy vamos a hablar de", "start": 1.0, "duration": 3.0},
        {"text": "vamos a hablar de un tema", "start": 3.5, "duration": 3.5},
    ]
    segs, lang = segmentos_desde_fetched(datos, idioma_fallback="es")
    assert [s["texto"] for s in segs] == ["hoy vamos a hablar de", "un tema"]
    assert lang == "es"


def test_supadata_offset_en_milisegundos():
    trozos = [
        {"text": "primera frase", "offset": 1500, "duration": 2500},
        {"text": "segunda frase", "offset": 4000, "duration": 2000},
    ]
    segs = sd.segmentos_de_contenido(trozos)
    assert [s["inicio"] for s in segs] == [1.5, 4.0]
    assert [s["duracion"] for s in segs] == [2.5, 2.0]


def test_supadata_texto_plano_no_da_segmentos():
    """Con `text=true` llega un string: no hay tiempos que sacar."""
    assert sd.segmentos_de_contenido("solo texto") == []


def test_unir_segmentos_tolera_basura():
    assert unir_segmentos(None) == []
    assert unir_segmentos([{"texto": "  "}, "no-dict", {"texto": "vale", "inicio": "x"}]) == [
        {"texto": "vale", "inicio": 0.0, "duracion": 0.0}
    ]


# ── Endpoint ────────────────────────────────────────────────────────────────

@pytest.fixture
def con_subtitulos(monkeypatch):
    """La vía gratuita responde con segmentos."""
    segs = segmentos_desde_vtt(VTT_RODANTE)
    monkeypatch.setattr(
        api_module, "_subtitulos_via_transcript_api",
        lambda video_id, idioma: ("hoy vamos a hablar de un tema que cambia todo y por eso", "es", segs),
    )
    return TestClient(api_module.app)


def test_sin_include_timestamps_no_hay_segmentos(con_subtitulos):
    """La respuesta de siempre no cambia: quien no los pide no los recibe."""
    r = con_subtitulos.post("/api/youtube", json={"url": URL_VIDEO, "language": "es"})
    assert r.status_code == 200
    assert r.json()["segments"] == []


def test_con_include_timestamps_llegan_los_segmentos(con_subtitulos):
    r = con_subtitulos.post(
        "/api/youtube",
        json={"url": URL_VIDEO, "language": "es", "include_timestamps": True},
    )
    assert r.status_code == 200
    segs = r.json()["segments"]
    assert len(segs) == 3
    # La forma exacta que lee js/youtube/transcriptionService.js
    for s in segs:
        assert set(s) == {"text", "startTime", "duration"}
        assert isinstance(s["startTime"], (int, float))
    assert segs[0]["text"] == "hoy vamos a hablar de"
    assert segs[0]["startTime"] == 1.0
    assert [s["startTime"] for s in segs] == sorted(s["startTime"] for s in segs)


def test_el_texto_es_el_mismo_con_y_sin_tiempos(con_subtitulos):
    a = con_subtitulos.post("/api/youtube", json={"url": URL_VIDEO, "language": "es"}).json()
    b = con_subtitulos.post(
        "/api/youtube",
        json={"url": URL_VIDEO, "language": "es", "include_timestamps": True},
    ).json()
    assert a["text"] == b["text"]


def test_supadata_recibe_con_tiempos(monkeypatch):
    """`include_timestamps` tiene que llegar hasta Supadata (`text=false`)."""
    pedidos = {}

    def bloqueada(video_id, idioma):
        return None, None, []

    def transcribir(url, idioma, con_tiempos=False):
        pedidos["con_tiempos"] = con_tiempos
        return {
            "texto": "primera frase segunda frase",
            "lang": "es",
            "segmentos": [
                {"texto": "primera frase", "inicio": 1.5, "duracion": 2.5},
                {"texto": "segunda frase", "inicio": 4.0, "duracion": 2.0},
            ],
        }

    monkeypatch.setattr(api_module, "_subtitulos_via_transcript_api", bloqueada)
    monkeypatch.setattr(sd, "API_KEY", "clave-de-prueba")
    monkeypatch.setattr(sd, "transcribir", transcribir)

    r = TestClient(api_module.app).post(
        "/api/youtube",
        json={"url": URL_VIDEO, "language": "es", "include_timestamps": True},
    )
    assert r.status_code == 200
    assert pedidos["con_tiempos"] is True
    assert r.json()["segments"][0]["startTime"] == 1.5


def test_job_largo_pasa_include_timestamps(monkeypatch):
    pedidos = {}

    def estado_job(job, con_tiempos=False):
        pedidos["con_tiempos"] = con_tiempos
        return {
            "estado": "completado",
            "texto": "Charla larga.",
            "lang": "en",
            "segmentos": [{"texto": "Charla larga.", "inicio": 0.5, "duracion": 2.0}],
        }

    monkeypatch.setattr(sd, "API_KEY", "clave-de-prueba")
    monkeypatch.setattr(sd, "estado_job", estado_job)

    r = TestClient(api_module.app).get(
        "/api/youtube-job?id=job-largo&include_timestamps=true"
    )
    assert r.status_code == 200
    assert pedidos["con_tiempos"] is True
    assert r.json()["segments"][0]["startTime"] == 0.5


def test_supadata_sin_tiempos_no_revienta(monkeypatch):
    """Si Supadata ignora `text=false`, se entrega el texto y `segments` vacío.

    El módulo del navegador muestra entonces su mensaje claro en vez de fallar.
    """
    monkeypatch.setattr(
        api_module, "_subtitulos_via_transcript_api", lambda v, i: (None, None, [])
    )
    monkeypatch.setattr(sd, "API_KEY", "clave-de-prueba")
    monkeypatch.setattr(
        sd, "transcribir",
        lambda url, idioma, con_tiempos=False: {"texto": "Solo texto.", "lang": "es"},
    )

    r = TestClient(api_module.app).post(
        "/api/youtube",
        json={"url": URL_VIDEO, "language": "es", "include_timestamps": True},
    )
    assert r.status_code == 200
    assert r.json()["text"] == "Solo texto."
    assert r.json()["segments"] == []


def test_los_dos_servidores_aceptan_include_timestamps():
    import re

    def campos(ruta):
        src = (_APP_ROOT / ruta).read_text(encoding="utf-8")
        bloque = src.split("class YouTubeRequest(BaseModel):", 1)[1]
        out = set()
        for linea in bloque.splitlines():
            if not linea.strip():
                continue
            if not linea.startswith((" ", "\t")):
                break
            m = re.match(r"\s+([a-z_]+)\s*:\s*\w", linea)
            if m:
                out.add(m.group(1))
        return out

    assert "include_timestamps" in campos("api/index.py")
    assert "include_timestamps" in campos("backend/app.py")
