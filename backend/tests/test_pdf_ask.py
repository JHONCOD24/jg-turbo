"""Endpoint /api/pdf-ask: preguntarle a un PDF ya extraído en el navegador.

No se llama a ninguna IA real: se sustituye la llamada por un doble para
comprobar lo que de verdad importa — qué se valida, qué se manda en el
prompt y qué se devuelve.
"""
from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

_APP_ROOT = Path(__file__).resolve().parents[2]
_API = _APP_ROOT / "api" / "index.py"
if str(_APP_ROOT) not in sys.path:
    sys.path.insert(0, str(_APP_ROOT))

spec = importlib.util.spec_from_file_location("jg_api_index_pdf", _API)
api = importlib.util.module_from_spec(spec)
assert spec.loader is not None
# Registrarlo antes de ejecutarlo: si no, Pydantic no resuelve las anotaciones
# de los modelos (Optional[str]) y FastAPI no puede validar las peticiones.
sys.modules[spec.name] = api
try:
    spec.loader.exec_module(api)
except Exception as e:  # pragma: no cover
    pytest.skip(f"No se pudo cargar api/index.py: {e}", allow_module_level=True)


@pytest.fixture
def cliente():
    return TestClient(api.app)


@pytest.fixture
def ia_falsa(monkeypatch):
    """Reemplaza la llamada a la IA y guarda el prompt que recibió."""
    capturado = {}

    def doble(client_key, provider, prompt, openrouter_model=None, max_tokens=None):
        capturado["prompt"] = prompt
        capturado["max_tokens"] = max_tokens
        return "Respuesta de prueba.", "gemini"

    monkeypatch.setattr(api, "_llamar_ia_con_respaldo", doble)
    monkeypatch.setattr(api, "_resolver_ia", lambda *a, **k: ("clave-demo", "gemini"))
    return capturado


TEXTO = (
    "El documento habla de la niebla que cubrio el pueblo durante tres dias "
    "y de como los vecinos se organizaron para seguir con su vida. Cuenta que "
    "las familias compartieron lena, que la escuela siguio abierta y que nadie "
    "se quedo sin comida durante esos dias dificiles del invierno."
)


def test_pregunta_devuelve_texto(cliente, ia_falsa):
    resp = cliente.post("/api/pdf-ask", json={
        "text": TEXTO,
        "question": "¿Cuántos días duró la niebla?",
        "mode": "pregunta",
        "api_key": "clave-demo",
        "provider": "gemini",
    })
    assert resp.status_code == 200
    datos = resp.json()
    assert datos["text"] == "Respuesta de prueba."
    assert datos["ia_used"] is True
    assert datos["mode"] == "pregunta"
    # La pregunta y el texto del documento tienen que llegar al prompt.
    assert "¿Cuántos días duró la niebla?" in ia_falsa["prompt"]
    assert "niebla que cubrio el pueblo" in ia_falsa["prompt"]


def test_prohibe_inventar(cliente, ia_falsa):
    """La regla más importante: si no está en el documento, no se inventa."""
    cliente.post("/api/pdf-ask", json={
        "text": TEXTO, "question": "¿Y el precio?", "api_key": "k", "provider": "gemini",
    })
    prompt = ia_falsa["prompt"]
    assert "no dice nada sobre eso" in prompt
    assert "Nunca inventes datos" in prompt


def test_texto_vacio_es_error(cliente, ia_falsa):
    resp = cliente.post("/api/pdf-ask", json={
        "text": "   ", "question": "algo", "api_key": "k", "provider": "gemini",
    })
    assert resp.status_code == 400


def test_pregunta_vacia_es_error(cliente, ia_falsa):
    resp = cliente.post("/api/pdf-ask", json={
        "text": TEXTO, "question": "", "mode": "pregunta", "api_key": "k", "provider": "gemini",
    })
    assert resp.status_code == 400


def test_resumen_no_necesita_pregunta(cliente, ia_falsa):
    resp = cliente.post("/api/pdf-ask", json={
        "text": TEXTO, "mode": "resumen", "api_key": "k", "provider": "gemini",
    })
    assert resp.status_code == 200
    assert "resume el fragmento" in ia_falsa["prompt"]


def test_ideas_pide_lista(cliente, ia_falsa):
    resp = cliente.post("/api/pdf-ask", json={
        "text": TEXTO, "mode": "ideas", "api_key": "k", "provider": "gemini",
    })
    assert resp.status_code == 200
    assert "ideas clave" in ia_falsa["prompt"]


def test_sintesis_une_resumenes_sin_pregunta(cliente, ia_falsa):
    """El resumen de un libro entero: se resumen las partes y luego los resúmenes."""
    resp = cliente.post("/api/pdf-ask", json={
        "text": TEXTO + " Segunda parte: la primavera llego tarde ese ano y el rio "
                        "crecio mas de lo normal, pero el puente aguanto sin dano.",
        "mode": "sintesis", "api_key": "k", "provider": "gemini",
    })
    assert resp.status_code == 200
    assert resp.json()["mode"] == "sintesis"
    prompt = ia_falsa["prompt"]
    assert "resúmenes de las partes" in prompt
    assert "Respeta el orden" in prompt
    assert "No añadas nada que no esté" in prompt, "tampoco al unir se puede inventar"


def test_modo_desconocido_cae_en_pregunta(cliente, ia_falsa):
    resp = cliente.post("/api/pdf-ask", json={
        "text": TEXTO, "question": "¿de qué trata?", "mode": "inventado",
        "api_key": "k", "provider": "gemini",
    })
    assert resp.status_code == 200
    assert resp.json()["mode"] == "pregunta"


def test_texto_larguisimo_se_recorta(cliente, ia_falsa):
    """Un libro entero no cabe en un prompt: se manda un trozo acotado."""
    resp = cliente.post("/api/pdf-ask", json={
        "text": "palabra " * 60000, "mode": "resumen", "api_key": "k", "provider": "gemini",
    })
    assert resp.status_code == 200
    assert resp.json()["context_chars"] <= api._PDF_MAX_CONTEXTO


def test_sin_clave_de_ia_avisa_claro(cliente, monkeypatch):
    monkeypatch.setattr(api, "_resolver_ia", lambda *a, **k: (None, "none"))
    resp = cliente.post("/api/pdf-ask", json={
        "text": TEXTO, "question": "¿de qué trata?", "api_key": "", "provider": "none",
    })
    assert resp.status_code == 400
    assert "clave de IA" in resp.json()["detail"]


def test_error_de_la_ia_no_tumba_el_servidor(cliente, monkeypatch):
    monkeypatch.setattr(api, "_resolver_ia", lambda *a, **k: ("k", "gemini"))

    def revienta(*a, **k):
        raise Exception("proveedor caído")

    monkeypatch.setattr(api, "_llamar_ia_con_respaldo", revienta)
    resp = cliente.post("/api/pdf-ask", json={
        "text": TEXTO, "question": "¿de qué trata?", "api_key": "k", "provider": "gemini",
    })
    assert resp.status_code == 502
    assert "proveedor caído" in resp.json()["detail"]


def test_respuesta_vacia_de_la_ia_se_reporta(cliente, monkeypatch):
    monkeypatch.setattr(api, "_resolver_ia", lambda *a, **k: ("k", "gemini"))
    monkeypatch.setattr(api, "_llamar_ia_con_respaldo", lambda *a, **k: ("   ", "gemini"))
    resp = cliente.post("/api/pdf-ask", json={
        "text": TEXTO, "question": "¿de qué trata?", "api_key": "k", "provider": "gemini",
    })
    assert resp.status_code == 502


def test_no_resume_un_texto_sin_sustancia(cliente, ia_falsa):
    """Con cuatro palabras el modelo se inventa un documento entero.

    Comprobado en producción: con «Resumen 1. Resumen 2.» devolvió ocho frases
    sobre gestión de proyectos que no estaban en ninguna parte. Sin material
    suficiente no se llama a la IA.
    """
    for modo in ("resumen", "ideas", "sintesis"):
        resp = cliente.post("/api/pdf-ask", json={
            "text": "Resumen 1. Resumen 2.", "mode": modo,
            "api_key": "k", "provider": "gemini",
        })
        assert resp.status_code == 400, f"el modo {modo} debería rechazarlo"
        assert "demasiado corto" in resp.json()["detail"]
    assert "prompt" not in ia_falsa, "no se debe gastar una consulta a la IA"


def test_una_pregunta_si_funciona_con_poco_texto(cliente, ia_falsa):
    """Preguntar sobre un texto corto es legítimo: ahí la IA no tiene que rellenar."""
    resp = cliente.post("/api/pdf-ask", json={
        "text": "El precio es de 50.000 pesos.", "question": "¿Cuánto cuesta?",
        "api_key": "k", "provider": "gemini",
    })
    assert resp.status_code == 200
