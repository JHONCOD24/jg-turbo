"""Idioma de origen del doblaje: se decide ANTES de pedir el texto.

Caso real (auditoría 2026-09-25, H1): `dNWkwrqAkcM` es inglés, pero YouTube le
creó doblajes automáticos y la primera pista era árabe. Todo con dobles: ninguna
prueba sale a la red ni gasta créditos.
"""
import sys
from pathlib import Path

import pytest

APP_ROOT = Path(__file__).resolve().parents[2]
if str(APP_ROOT) not in sys.path:
    sys.path.insert(0, str(APP_ROOT))

from api import deteccion_idioma as di  # noqa: E402
from api import idioma_video as iv  # noqa: E402
from api import youtube_datos as yd  # noqa: E402

TITULO = "The Marketing GENIUS: How To Build A Brand That Sells In The New Era Of AI (3 Laws Of Marketing)"


@pytest.mark.parametrize("texto,esperado", [
    ("هناك الكثير من الأشياء التي يمكننا بناؤها", "ar"),
    ("Привет, как у тебя дела сегодня", "ru"),
    ("नमस्ते दुनिया, आज हम बात करेंगे", "hi"),
    ("안녕하세요 여러분 오늘은", "ko"),
    ("こんにちは、今日はマーケティングの話です", "ja"),
    ("你好世界今天我们谈谈品牌", "zh"),
    ("Hello world, this is English", ""),
    ("Hola mundo, esto es español", ""),
])
def test_idioma_por_escritura(texto, esperado):
    assert di.idioma_por_escritura(texto)[0] == esperado


def test_detectar_reconoce_un_texto_arabe_con_alta_confianza():
    veredicto = di.detectar("هناك الكثير من الأشياء التي يمكننا بناؤها " * 10, idioma_pista="ar")
    assert veredicto["idioma"] == "ar"
    assert veredicto["confianza"] >= 0.9


def test_titulo_en_ingles():
    idioma, confianza = iv.idioma_del_titulo(TITULO)
    assert idioma == "en" and confianza >= 0.7


def test_titulo_en_espanol():
    assert iv.idioma_del_titulo("Cómo construir una marca que vende en la nueva era de la IA")[0] == "es"


def test_titulo_vacio_no_afirma_nada():
    assert iv.idioma_del_titulo("") == ("", 0.0)
    assert iv.idioma_del_titulo("🔥🔥🔥 2026") == ("", 0.0)


def test_orden_de_las_senales():
    assert iv.resolver_idioma_origen(pedido="pt", audio_declarado="en")["fuente"] == "usuario"
    assert iv.resolver_idioma_origen(pedido="auto", audio_declarado="en-US", titulo="Hola") == {"idioma": "en", "fuente": "youtube", "confianza": 0.97}
    assert iv.resolver_idioma_origen(idioma_metadatos="fr", titulo=TITULO)["idioma"] == "fr"
    por_titulo = iv.resolver_idioma_origen(titulo=TITULO, disponibles=["ar", "en", "de-DE"])
    assert por_titulo["idioma"] == "en" and por_titulo["fuente"] == "titulo"


def test_sin_titulo_decide_con_las_pistas():
    varias = iv.resolver_idioma_origen(disponibles=["ar", "en", "de-DE", "hi"])
    assert varias == {"idioma": "en", "fuente": "disponibles", "confianza": 0.55}
    assert iv.resolver_idioma_origen(disponibles=["fr"]) == {"idioma": "fr", "fuente": "disponibles", "confianza": 0.8}
    assert iv.resolver_idioma_origen() == {"idioma": "", "fuente": "desconocido", "confianza": 0.0}


def test_titulo_en_espanol_con_varias_pistas_no_basta():
    """Puede ser un título traducido por YouTube para quien mira desde Colombia."""
    r = iv.resolver_idioma_origen(titulo="Cómo construir una marca que vende en la nueva era", disponibles=["es", "en"])
    assert r["idioma"] == "es" and r["confianza"] < 0.5


def test_duracion_iso():
    assert yd.duracion_iso_a_segundos("PT1H28M34S") == 5314
    assert yd.duracion_iso_a_segundos("PT45S") == 45
    assert yd.duracion_iso_a_segundos("P1DT1H") == 90000
    assert yd.duracion_iso_a_segundos("") == 0


def test_consultar_sin_clave_no_sale_a_la_red(monkeypatch):
    monkeypatch.setattr(yd, "API_KEY", "")
    assert yd.configurado() is False
    assert yd.consultar("dNWkwrqAkcM") == {}


def test_consultar_lee_idioma_y_duracion(monkeypatch):
    monkeypatch.setattr(yd, "API_KEY", "clave-falsa")

    class Respuesta:
        status_code = 200

        def json(self):
            return {"items": [{
                "snippet": {"defaultAudioLanguage": "en-US", "defaultLanguage": "en", "title": TITULO},
                "contentDetails": {"duration": "PT1H28M34S", "caption": "true"},
            }]}

    pedidos = []
    monkeypatch.setattr(yd.requests, "get", lambda url, params=None, timeout=None: (pedidos.append(params), Respuesta())[1])
    assert yd.consultar("dNWkwrqAkcM") == {
        "audio": "en-US", "idioma_metadatos": "en", "titulo": TITULO, "duracion_s": 5314, "subtitulos": True,
    }
    assert pedidos[0]["part"] == "snippet,contentDetails" and pedidos[0]["id"] == "dNWkwrqAkcM"


def test_consultar_nunca_lanza(monkeypatch):
    monkeypatch.setattr(yd, "API_KEY", "clave-falsa")

    def sin_red(*a, **k):
        raise yd.requests.RequestException("sin red")

    monkeypatch.setattr(yd.requests, "get", sin_red)
    assert yd.consultar("dNWkwrqAkcM") == {}
