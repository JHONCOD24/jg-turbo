"""Cadena de proveedores de IA (2026-09-26).

Medido en producción: la clave de Gemini está bloqueada (403) y se probaba
primero en cada traducción; si Mistral daba 429 en ese instante, el error final
salía como «401» y el doblaje partía el lote en mitades (13 llamadas y dos 500
antes del primer sonido). Con una clave de Mistral del navegador en límite,
nunca se probaba la del servidor.

Todo con dobles: ninguna prueba sale a la red.
"""

import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

_APP_ROOT = Path(__file__).resolve().parents[2]
if str(_APP_ROOT) not in sys.path:
    sys.path.insert(0, str(_APP_ROOT))

from api import index as api_module  # noqa: E402

CLAVES = ("GEMINI_API_KEY", "GOOGLE_API_KEY", "OPENROUTER_API_KEY", "MISTRAL_API_KEY",
          "XAI_API_KEY", "GROK_API_KEY", "ANTHROPIC_API_KEY")


@pytest.fixture
def entorno(monkeypatch):
    """Servidor con Gemini (bloqueada) y Mistral, como producción hoy."""
    for clave in CLAVES:
        monkeypatch.delenv(clave, raising=False)
    monkeypatch.setenv("GEMINI_API_KEY", "gemini-servidor")
    monkeypatch.setenv("MISTRAL_API_KEY", "mistral-servidor")
    monkeypatch.setattr(api_module, "_ia_cuarentena", {})
    monkeypatch.setattr(api_module.time, "sleep", lambda s: None)
    llamadas = []

    def instalar(respuestas):
        """respuestas: {clave: [excepción o texto, …]} consumidas en orden."""
        def llamar(prov, clave, prompt, openrouter_model=None, max_tokens=None):
            llamadas.append((prov, clave))
            cola = respuestas.get(clave, [])
            resultado = cola.pop(0) if cola else "traducido"
            if isinstance(resultado, Exception):
                raise resultado
            return resultado, prov
        monkeypatch.setattr(api_module, "_llamar_ia", llamar)
    return llamadas, instalar


def test_el_orden_es_navegador_preferida_y_resto_sin_repetir(entorno):
    candidatos = api_module._candidatos_ia("mistral-navegador", "mistral")
    assert [(p, c, o) for p, c, o in candidatos] == [
        ("mistral", "mistral-navegador", "navegador"),
        ("gemini", "gemini-servidor", "servidor"),
        ("mistral", "mistral-servidor", "servidor"),
    ]


def test_una_clave_groq_del_navegador_no_se_usa_para_traducir(entorno):
    candidatos = api_module._candidatos_ia("gsk_abc", "gemini")
    assert all(origen == "servidor" for _, _, origen in candidatos)


def test_la_clave_bloqueada_queda_en_cuarentena(entorno):
    llamadas, instalar = entorno
    instalar({"gemini-servidor": [Exception("HTTP 403: API has not been used or it is disabled")]})
    texto, prov = api_module._llamar_ia_con_respaldo("", "gemini", "p")
    assert (texto, prov) == ("traducido", "mistral")
    llamadas.clear()
    api_module._llamar_ia_con_respaldo("", "gemini", "p")
    assert llamadas == [("mistral", "mistral-servidor")], "la segunda vez ya no se pierde tiempo con Gemini"


def test_mistral_repite_una_vez_ante_un_429(entorno):
    llamadas, instalar = entorno
    instalar({
        "gemini-servidor": [Exception("HTTP 403: blocked")],
        "mistral-servidor": [Exception("Mistral HTTP 429: rate limit"), "hola"],
    })
    texto, prov = api_module._llamar_ia_con_respaldo("", "gemini", "p")
    assert (texto, prov) == ("hola", "mistral")
    assert llamadas.count(("mistral", "mistral-servidor")) == 2


def test_si_se_agota_el_cupo_el_error_dice_limite_de_uso(entorno):
    _, instalar = entorno
    instalar({
        "gemini-servidor": [Exception("HTTP 403: blocked")],
        "mistral-servidor": [Exception("Mistral HTTP 429: rate limit")] * 2,
    })
    with pytest.raises(Exception) as error:
        api_module._llamar_ia_con_respaldo("", "gemini", "p")
    assert "límite de uso" in str(error.value) and "429" in str(error.value), (
        "antes salía «clave no autorizada (401)» y el navegador partía el lote en mitades"
    )


def test_la_clave_del_navegador_en_limite_no_impide_usar_la_del_servidor(entorno):
    llamadas, instalar = entorno
    instalar({
        "mistral-navegador": [Exception("Mistral HTTP 429: rate limit")] * 2,
        "gemini-servidor": [Exception("HTTP 403: blocked")],
        "mistral-servidor": ["desde el servidor"],
    })
    texto, _ = api_module._llamar_ia_con_respaldo("mistral-navegador", "mistral", "p")
    assert texto == "desde el servidor"


def test_si_todo_falla_por_clave_se_explica_como_antes(entorno):
    _, instalar = entorno
    instalar({
        "gemini-servidor": [Exception("HTTP 403: blocked")],
        "mistral-servidor": [Exception("Mistral HTTP 401: Invalid API Key")],
    })
    with pytest.raises(Exception) as error:
        api_module._llamar_ia_con_respaldo("", "gemini", "p")
    assert "clave no autorizada" in str(error.value)


def test_un_marcador_suelto_no_llega_al_texto():
    salida = api_module._validar_marcadores_segmento("Hello there", "[[JG_SEG_000000]]\nHola")
    assert salida == "Hola"
    with pytest.raises(Exception):
        api_module._validar_marcadores_segmento("[[JG_SEG_000001]]\nHi", "[[JG_SEG_000002]]\nHola")


@pytest.fixture
def cliente_sin_cupo(monkeypatch):
    usos_mymemory = []

    def sin_cupo(*a, **k):
        raise Exception("mistral: límite de uso alcanzado (429). Detalle: rate limit")

    monkeypatch.setattr(api_module, "_resolver_ia", lambda *a, **k: ("clave", "mistral"))
    monkeypatch.setattr(api_module, "_llamar_ia_con_respaldo", sin_cupo)
    monkeypatch.setattr(api_module, "_translate_mymemory_chunked", lambda *a, **k: usos_mymemory.append(1) or "memoria ajena")
    monkeypatch.setattr(api_module, "_traduccion_parece_incompleta", lambda *a, **k: False)
    return TestClient(api_module.app), usos_mymemory


def test_el_doblaje_sin_cupo_recibe_429_y_no_una_traduccion_de_memoria(cliente_sin_cupo):
    cliente, usos = cliente_sin_cupo
    r = cliente.post("/api/translate", json={"text": "[[JG_SEG_000000]]\nHello", "direction": "en-es", "literal": True})
    assert r.status_code == 429
    assert "límite de uso" in r.json()["detail"]
    assert usos == [], "MyMemory no entra en el doblaje"


def test_fuera_del_doblaje_se_conserva_el_respaldo_de_siempre(cliente_sin_cupo):
    cliente, usos = cliente_sin_cupo
    r = cliente.post("/api/translate", json={"text": "Hello", "direction": "en-es"})
    assert r.status_code == 200 and r.json()["text"] == "memoria ajena"
    assert usos == [1]
