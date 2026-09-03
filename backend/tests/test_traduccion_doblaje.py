"""Traducción para doblaje: modo literal, revisión de estilo y título del video.

El navegador manda `literal`, `revisar` y `titulo_video` desde que existe el
doblaje sincronizado. Antes no estaban declarados en TranslateRequest y pydantic
los descartaba en silencio: la traducción salía adaptada y sin revisar aunque la
interfaz dijera «traduciendo con español natural».

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

TEXTO = "It is important to note that this feature changes everything for creators."


@pytest.fixture
def cliente(monkeypatch):
    """Cliente con la IA sustituida por un doble que registra los prompts."""
    prompts = []

    def ia_falsa(client_key, provider, prompt, openrouter_model=None, max_tokens=None):
        prompts.append(prompt)
        if "corrector de estilo" in prompt:
            # Pasada de revisión: devuelve el texto marcado como revisado.
            cuerpo = prompt.rsplit("<<<", 1)[-1].split(">>>", 1)[0].strip()
            return cuerpo + " Revisado.", "gemini"
        return "Conviene señalar que esta función lo cambia todo para los creadores.", "gemini"

    monkeypatch.setattr(api_module, "_resolver_ia", lambda *a, **k: ("clave", "gemini"))
    monkeypatch.setattr(api_module, "_llamar_ia_con_respaldo", ia_falsa)
    # MyMemory nunca debe entrar: estas pruebas miden la vía de IA.
    monkeypatch.setattr(api_module, "_translate_mymemory_chunked", lambda *a, **k: None)
    return TestClient(api_module.app), prompts


def _pedir(cliente, **extra):
    cuerpo = {"text": TEXTO, "direction": "en-es", "prefer_fast": False}
    cuerpo.update(extra)
    r = cliente.post("/api/translate", json=cuerpo)
    assert r.status_code == 200, r.text
    return r.json()


def test_campos_de_doblaje_se_aceptan(cliente):
    """Antes pydantic los ignoraba: la peticion pasaba pero no hacian nada."""
    c, _ = cliente
    datos = _pedir(c, literal=True, revisar=True, titulo_video="Curso de Spring Boot")
    assert datos["text"]


def test_modo_literal_llega_al_prompt(cliente):
    c, prompts = cliente
    _pedir(c, literal=True)
    assert "LITERAL MODE (dubbing)" in prompts[0]
    assert "do not localize examples" in prompts[0]


def test_sin_modo_literal_se_pide_lenguaje_natural(cliente):
    c, prompts = cliente
    _pedir(c)
    assert "LITERAL MODE" not in prompts[0]
    assert "natural phrasing" in prompts[0]


def test_titulo_del_video_llega_como_contexto(cliente):
    c, prompts = cliente
    _pedir(c, titulo_video="Curso de Spring Boot")
    assert "Curso de Spring Boot" in prompts[0]
    assert "never to add content" in prompts[0]


def test_titulo_vacio_no_ensucia_el_prompt(cliente):
    c, prompts = cliente
    _pedir(c, titulo_video="   ")
    assert "titled" not in prompts[0]


def test_revisar_hace_una_segunda_pasada(cliente):
    c, prompts = cliente
    datos = _pedir(c, revisar=True)
    assert len(prompts) == 2, "debe haber traducción + revisión"
    assert "corrector de estilo" in prompts[1]
    assert datos["text"].endswith("Revisado.")


def test_sin_revisar_solo_hay_una_llamada(cliente):
    c, prompts = cliente
    datos = _pedir(c)
    assert len(prompts) == 1
    assert "Revisado" not in datos["text"]


def test_revisar_en_modo_literal_prohibe_reordenar(cliente):
    c, prompts = cliente
    _pedir(c, revisar=True, literal=True)
    assert "NO fusiones, dividas ni reordenes oraciones" in prompts[1]


def test_revisar_libre_permite_reordenar(cliente):
    c, prompts = cliente
    _pedir(c, revisar=True, literal=False)
    assert "Puedes reorganizar una frase" in prompts[1]


def test_revision_truncada_se_descarta(monkeypatch):
    """Si la revisión vuelve a medias, vale más la traducción sin revisar."""
    traduccion = "Conviene señalar que esta función lo cambia todo para los creadores de video."

    def ia_falsa(client_key, provider, prompt, openrouter_model=None, max_tokens=None):
        if "corrector de estilo" in prompt:
            return "Conviene señalar", "gemini"   # truncada a proposito
        return traduccion, "gemini"

    monkeypatch.setattr(api_module, "_resolver_ia", lambda *a, **k: ("clave", "gemini"))
    monkeypatch.setattr(api_module, "_llamar_ia_con_respaldo", ia_falsa)
    monkeypatch.setattr(api_module, "_translate_mymemory_chunked", lambda *a, **k: None)

    c = TestClient(api_module.app)
    datos = _pedir(c, revisar=True)
    assert datos["text"] == traduccion


def test_revision_que_falla_no_tumba_la_traduccion(monkeypatch):
    traduccion = "Conviene señalar que esta función lo cambia todo para los creadores."

    def ia_falsa(client_key, provider, prompt, openrouter_model=None, max_tokens=None):
        if "corrector de estilo" in prompt:
            raise RuntimeError("la IA de revisión se cayó")
        return traduccion, "gemini"

    monkeypatch.setattr(api_module, "_resolver_ia", lambda *a, **k: ("clave", "gemini"))
    monkeypatch.setattr(api_module, "_llamar_ia_con_respaldo", ia_falsa)
    monkeypatch.setattr(api_module, "_translate_mymemory_chunked", lambda *a, **k: None)

    c = TestClient(api_module.app)
    datos = _pedir(c, revisar=True)
    assert datos["text"] == traduccion


def test_los_dos_servidores_declaran_los_mismos_campos():
    """El backend local es el espejo de Vercel: si divergen, algo se olvidó."""
    import re

    def campos(ruta):
        src = (_APP_ROOT / ruta).read_text(encoding="utf-8")
        bloque = src.split("class TranslateRequest(BaseModel):", 1)[1]
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

    for campo in ("literal", "revisar", "titulo_video"):
        assert campo in campos("api/index.py"), f"falta {campo} en Vercel"
        assert campo in campos("backend/app.py"), f"falta {campo} en el backend local"
