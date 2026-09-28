"""Videos de X: reconocer el enlace y leer el post sin salir a la red.

Las respuestas son capturas reales del 2026-09-27 (tests/fixtures/x/). Ninguna
prueba llama a X ni a FxTwitter.
"""
import json
import sys
from pathlib import Path

import pytest
import requests

APP_ROOT = Path(__file__).resolve().parents[2]
if str(APP_ROOT) not in sys.path:
    sys.path.insert(0, str(APP_ROOT))

from api import x_video as xv  # noqa: E402

FIX = APP_ROOT / "tests" / "fixtures" / "x"


def cargar(nombre):
    return json.loads((FIX / nombre).read_text(encoding="utf-8"))


@pytest.mark.parametrize("caso", cargar("enlaces.json"), ids=lambda c: c["url"] or "vacío")
def test_extraer_id_casos_compartidos_con_js(caso):
    esperado = (caso["id"], caso["indice"]) if caso["id"] else None
    assert xv.extraer_id(caso["url"]) == esperado


def test_sindicacion_con_media_details():
    info = xv.normalizar_sindicacion(cargar("sindicacion_mediaDetails_1585341984679469056.json"))
    assert info["id"] == "1585341984679469056"
    assert info["autor"] == "elonmusk"
    assert info["idioma_texto"] == "en"
    assert info["texto"] == "Entering Twitter HQ – let that sink in!"   # sin el t.co del final
    assert info["duracion_s"] == pytest.approx(9.301)
    assert [v["bitrate"] for v in info["mp4"]] == [256000, 832000, 2176000, 10368000]
    assert info["mp4"][0]["ancho"] == 480 and info["mp4"][0]["alto"] == 270
    assert info["hls"].startswith("https://video.twimg.com/") and ".m3u8" in info["hls"]
    assert info["portada"].startswith("https://pbs.twimg.com/")


def test_sindicacion_con_unified_card():
    info = xv.normalizar_sindicacion(cargar("sindicacion_unified_card_1349794411333394432.json"))
    assert info["duracion_s"] == pytest.approx(324.484)
    assert len(info["mp4"]) == 3
    assert info["hls"].endswith(".m3u8?tag=14")


def test_fxtwitter():
    info = xv.normalizar_fxtwitter(cargar("fxtwitter_1349794411333394432.json"))
    assert info["autor"] == "BrooklynNets"
    assert info["idioma_texto"] == "en"
    assert info["duracion_s"] == pytest.approx(324.484, abs=0.01)
    assert info["mp4"] and info["hls"]


def test_urls_de_otros_dominios_se_descartan():
    datos = cargar("sindicacion_mediaDetails_1585341984679469056.json")
    variantes = datos["mediaDetails"][0]["video_info"]["variants"]
    variantes.append({"content_type": "video/mp4", "bitrate": 999, "url": "https://evil.example/v.mp4"})
    variantes.append({"content_type": "video/mp4", "bitrate": 998, "url": "http://video.twimg.com/sin-https.mp4"})
    datos["mediaDetails"][0]["media_url_https"] = "https://evil.example/portada.jpg"
    info = xv.normalizar_sindicacion(datos)
    assert all(v["url"].startswith("https://video.twimg.com/") for v in info["mp4"])
    assert info["portada"] == ""


def test_gif_no_tiene_sonido():
    datos = {"__typename": "Tweet", "id_str": "1", "text": "", "user": {"screen_name": "a"},
             "mediaDetails": [{"type": "animated_gif", "video_info": {"variants": []}}]}
    with pytest.raises(xv.XVideoError) as exc:
        xv.normalizar_sindicacion(datos)
    assert exc.value.codigo == "gif" and exc.value.http_status == 422


@pytest.mark.parametrize("datos", [{}, {"__typename": "TweetTombstone"}])
def test_post_borrado_o_privado(datos):
    with pytest.raises(xv.XVideoError) as exc:
        xv.normalizar_sindicacion(datos)
    assert exc.value.codigo == "no_disponible" and exc.value.http_status == 404


def test_post_solo_con_fotos():
    datos = {"__typename": "Tweet", "id_str": "1", "text": "hola", "user": {"screen_name": "a"},
             "mediaDetails": [{"type": "photo"}]}
    with pytest.raises(xv.XVideoError) as exc:
        xv.normalizar_sindicacion(datos)
    assert exc.value.codigo == "sin_video"


def test_video_de_un_post_citado():
    citado = cargar("sindicacion_mediaDetails_1585341984679469056.json")
    datos = {"__typename": "Tweet", "id_str": "2", "text": "miren esto", "user": {"screen_name": "b"},
             "quoted_tweet": citado}
    info = xv.normalizar_sindicacion(datos)
    assert info["duracion_s"] == pytest.approx(9.301)


def test_indice_mayor_que_los_videos_usa_el_ultimo():
    info = xv.normalizar_sindicacion(cargar("sindicacion_mediaDetails_1585341984679469056.json"), indice=5)
    assert info["duracion_s"] == pytest.approx(9.301)


class RespuestaFalsa:
    def __init__(self, status=200, datos=None, tipo="application/json"):
        self.status_code = status
        self._datos = datos
        self.headers = {"content-type": tipo}

    def json(self):
        if self._datos is None:
            raise ValueError("no es JSON")
        return self._datos


class HttpFalso:
    """Responde según el dominio pedido; guarda cada llamada."""

    def __init__(self, sindicacion, fxtwitter):
        self.respuestas = {"cdn.syndication.twimg.com": sindicacion, "api.fxtwitter.com": fxtwitter}
        self.llamadas = []

    def get(self, url, params=None, headers=None, timeout=None):
        self.llamadas.append({"url": url, "params": params or {}, "timeout": timeout})
        for dominio, respuesta in self.respuestas.items():
            if dominio in url:
                if isinstance(respuesta, Exception):
                    raise respuesta
                return respuesta
        raise AssertionError(f"dominio inesperado: {url}")


URL = "https://x.com/BrooklynNets/status/1349794411333394432"


def test_consultar_usa_sindicacion_con_token():
    http = HttpFalso(RespuestaFalsa(datos=cargar("sindicacion_unified_card_1349794411333394432.json")), None)
    info = xv.consultar(URL, http=http)
    assert info["fuente"] == "sindicacion"
    params = http.llamadas[0]["params"]
    assert params["id"] == "1349794411333394432"
    assert len(params["token"]) == 10   # sin token la sindicación devuelve {} (H1)
    assert http.llamadas[0]["timeout"] <= 8


def test_consultar_cae_a_fxtwitter_si_la_sindicacion_falla():
    http = HttpFalso(requests.ConnectionError("bloqueado"),
                     RespuestaFalsa(datos=cargar("fxtwitter_1349794411333394432.json")))
    assert xv.consultar(URL, http=http)["fuente"] == "fxtwitter"


def test_consultar_sin_ninguna_fuente_es_error_de_red():
    http = HttpFalso(requests.Timeout("lento"), requests.ConnectionError("caído"))
    with pytest.raises(xv.XVideoError) as exc:
        xv.consultar(URL, http=http)
    assert exc.value.codigo == "red" and exc.value.http_status == 503


def test_consultar_prefiere_la_respuesta_definitiva_al_error_de_red():
    http = HttpFalso(RespuestaFalsa(datos={}), requests.ConnectionError("caído"))
    with pytest.raises(xv.XVideoError) as exc:
        xv.consultar(URL, http=http)
    assert exc.value.codigo == "no_disponible"


def test_consultar_enlace_invalido_no_sale_a_la_red():
    http = HttpFalso(None, None)
    with pytest.raises(xv.XVideoError) as exc:
        xv.consultar("https://x.com/home", http=http)
    assert exc.value.codigo == "enlace" and http.llamadas == []


def test_un_gif_no_se_busca_en_la_otra_fuente():
    gif = {"__typename": "Tweet", "id_str": "1", "text": "", "user": {"screen_name": "a"},
           "mediaDetails": [{"type": "animated_gif", "video_info": {"variants": []}}]}
    http = HttpFalso(RespuestaFalsa(datos=gif), None)
    with pytest.raises(xv.XVideoError) as exc:
        xv.consultar(URL, http=http)
    assert exc.value.codigo == "gif" and len(http.llamadas) == 1
