"""Contrato del modo lectura para reparar cortes físicos de un PDF."""
from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient


RAIZ = Path(__file__).resolve().parents[2]
if str(RAIZ) not in sys.path:
    sys.path.insert(0, str(RAIZ))


def cargar_api_vercel():
    ruta = RAIZ / "api" / "index.py"
    spec = importlib.util.spec_from_file_location("jg_api_pdf_lectura", ruta)
    modulo = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    sys.modules[spec.name] = modulo
    spec.loader.exec_module(modulo)
    return modulo


@pytest.fixture(scope="module")
def api_vercel():
    try:
        return cargar_api_vercel()
    except Exception as error:  # pragma: no cover
        pytest.skip(f"No se pudo cargar api/index.py: {error}")


def cuerpo_lectura():
    return {
        "text": "al norte de bos ton. El A RN fabrica y produce un alu vión.",
        "language": "es",
        "provider": "gemini",
        "api_key": "clave-prueba",
        "mode": "lectura",
        "candidatos_union": [
            {"izquierda": "bos", "derecha": "ton"},
            {"izquierda": "A", "derecha": "RN"},
            {"izquierda": "alu", "derecha": "vión"},
        ],
    }


def test_vercel_limita_uniones_al_prompt(api_vercel, monkeypatch):
    prompts = []

    monkeypatch.setattr(api_vercel, "_resolver_ia", lambda *a, **k: ("clave", "gemini"))

    def ia_falsa(_key, _provider, prompt, _model=None, _max_tokens=None):
        prompts.append(prompt)
        return "al norte de Boston. El ARN fabrica y produce un aluvión.", "gemini"

    monkeypatch.setattr(api_vercel, "_llamar_ia_con_respaldo", ia_falsa)
    respuesta = TestClient(api_vercel.app).post("/api/improve", json=cuerpo_lectura())
    assert respuesta.status_code == 200
    assert prompts
    for par in ("bos + ton", "A + RN", "alu + vión"):
        assert par in prompts[0]
    assert "solo puedes quitar un espacio" in prompts[0].lower()


def test_backend_local_declara_el_mismo_contrato():
    codigo = (RAIZ / "backend" / "app.py").read_text(encoding="utf-8")
    assert "candidatos_union: Optional[list]" in codigo
    assert 'if (req.mode or "") == "lectura"' in codigo
    assert 'uniones.append(f"- {izquierda} + {derecha}")' in codigo
    assert "UNIONES PERMITIDAS" in codigo
