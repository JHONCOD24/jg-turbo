"""Traducción de textos largos.

El fallo real (medido en producción el 2026-08-01): traducir 39 732 caracteres
de una sola vez devolvía `HTTP 504 FUNCTION_INVOCATION_TIMEOUT` a los 60,4 s,
porque Vercel corta la función a los 60 s. La solución es trocear en el
navegador; aquí se prueban las dos mitades del arreglo.
"""

import json
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

APP_ROOT = Path(__file__).resolve().parents[2]
if str(APP_ROOT) not in sys.path:
    sys.path.insert(0, str(APP_ROOT))

from api import index as api_module  # noqa: E402


# ── Backend: a quién se le pide la traducción ─────────────────────────────────

def _espiar_vias(monkeypatch):
    """Registra el orden en que se intentan MyMemory y la IA."""
    orden = []

    def mymemory(text, src, trg):
        orden.append("mymemory")
        return "Traducción de MyMemory."

    def ia(api_key, provider, prompt, modelo, max_tokens):
        orden.append("ia")
        return "Traducción de la IA.", "gemini"

    monkeypatch.setattr(api_module, "_translate_mymemory_chunked", mymemory)
    monkeypatch.setattr(api_module, "_llamar_ia_con_respaldo", ia)
    monkeypatch.setattr(api_module, "_resolver_ia", lambda *a, **k: ("clave", "gemini"))
    monkeypatch.setattr(
        api_module, "_traduccion_parece_incompleta", lambda *a, **k: False
    )
    return orden


def test_prefer_fast_false_usa_ia_aunque_el_texto_sea_largo(monkeypatch):
    """El bug: un `false` explícito se ignoraba pasando de 1200 caracteres."""
    orden = _espiar_vias(monkeypatch)
    largo = "This is a long transcription. " * 100  # ~3000 caracteres

    resp = TestClient(api_module.app).post(
        "/api/translate",
        json={"text": largo, "direction": "en-es", "prefer_fast": False},
    )

    assert resp.status_code == 200
    assert orden[0] == "ia", f"se pidió calidad y fue por MyMemory: {orden}"


def test_prefer_fast_true_sigue_usando_la_via_rapida(monkeypatch):
    orden = _espiar_vias(monkeypatch)

    resp = TestClient(api_module.app).post(
        "/api/translate",
        json={"text": "Hello world, this is a test.", "direction": "en-es", "prefer_fast": True},
    )

    assert resp.status_code == 200
    assert orden[0] == "mymemory"


def test_sin_prefer_fast_decide_el_tamano(monkeypatch):
    orden = _espiar_vias(monkeypatch)
    largo = "This is a long transcription. " * 100

    TestClient(api_module.app).post(
        "/api/translate", json={"text": largo, "direction": "en-es"}
    )
    assert orden[0] == "mymemory"  # texto largo sin preferencia → rápido primero

    orden.clear()
    TestClient(api_module.app).post(
        "/api/translate", json={"text": "Short text.", "direction": "en-es"}
    )
    assert orden[0] == "ia"  # texto corto → calidad


# ── Frontend: el troceo no puede perder texto ─────────────────────────────────

_NODE = shutil.which("node")
_JS_NECESARIO = (
    "const TRAD_MAX_CHARS_POR_PETICION",
    "function jgUnidadesDeTexto",
    "function jgTrocearParaTraducir",
)


def _extraer_js_troceo() -> str:
    """Saca del index.html solo las funciones de troceo, para probarlas en Node."""
    html = (APP_ROOT / "index.html").read_text(encoding="utf-8")
    inicio = html.index("const TRAD_MAX_CHARS_POR_PETICION")
    fin = html.index("async function jgMapaConLimite")
    return html[inicio:fin]


def test_el_troceo_existe_en_el_frontend():
    html = (APP_ROOT / "index.html").read_text(encoding="utf-8")
    for marcador in _JS_NECESARIO:
        assert marcador in html, f"falta {marcador}"
    # El troceo tiene que usarse de verdad, no quedarse definido.
    assert "jgTrocearParaTraducir(textoLimpio)" in html
    assert "jgMapaConLimite(trozos" in html


def test_ningun_camino_llama_a_translate_saltandose_el_troceo():
    """El bug que se escapó: el panel Traducir tenía su propia llamada.

    `traducirTranscripcionDetallada` es la única puerta a `/api/translate`,
    porque es la que trocea. Cualquier otro `fetchApi('/translate'…)` manda el
    texto entero, choca con el límite de 60 s de Vercel y el usuario ve
    «Error en la traducción del servidor».
    """
    html = (APP_ROOT / "index.html").read_text(encoding="utf-8")
    llamadas = re.findall(r"fetchApi\(\s*['\"]/translate['\"]", html)
    assert len(llamadas) == 1, (
        f"hay {len(llamadas)} llamadas directas a /translate; debe haber exactamente 1 "
        "(la de jgPedirTraduccion). Todo lo demás usa traducirTranscripcionDetallada."
    )
    # Y esa única llamada vive dentro del helper con troceo y reintento.
    inicio = html.index("async function jgPedirTraduccion")
    fin = html.index("async function traducirTranscripcionDetallada")
    assert "fetchApi('/translate'" in html[inicio:fin], (
        "la única llamada a /translate debe estar dentro de jgPedirTraduccion"
    )


def test_el_panel_traducir_usa_la_via_con_troceo():
    """El panel dedicado (pegar texto → «Traducir ahora») es el que usa el usuario."""
    html = (APP_ROOT / "index.html").read_text(encoding="utf-8")
    inicio = html.index("btnTransTranslate.addEventListener('click'")
    fin = html.index("// Copiar traducción", inicio)
    handler = html[inicio:fin]
    assert "traducirTranscripcionDetallada(" in handler
    assert "onProgreso" in handler, "el panel debe mostrar por qué bloque va"
    # El mensaje solo puede quedar en un comentario, nunca como fallback de una
    # llamada propia: era el síntoma de mandar el texto entero.
    assert "detail: 'Error en la traducción del servidor'" not in handler


@pytest.mark.skipif(not _NODE, reason="node no está instalado")
def test_el_troceo_no_pierde_ni_una_palabra():
    """Lo que entra tiene que salir: si el troceo come texto, la traducción miente."""
    guion = _extraer_js_troceo() + r"""
const casos = [
  "Palabra. ".repeat(9000),                       // largo y con puntos
  "sin puntuacion ".repeat(9000),                 // subtítulos sin puntos
  "Parrafo uno.\n\nParrafo dos.\n\n".repeat(2000),// con párrafos
  "x".repeat(30000),                              // una sola palabra enorme
  "corto",                                        // no debe trocearse
];
const salida = casos.map((texto) => {
  const trozos = jgTrocearParaTraducir(texto);
  // Lo que importa: que no se pierda ni se reordene ningún carácter con
  // contenido. Los separadores entre bloques sí pueden cambiar.
  const soloContenido = (s) => s.replace(/\s+/g, "");
  return {
    largo: texto.length,
    bloques: trozos.length,
    maximo: Math.max(...trozos.map((t) => t.length)),
    conserva: soloContenido(trozos.join("")) === soloContenido(texto),
  };
});
console.log(JSON.stringify(salida));
"""
    with tempfile.TemporaryDirectory() as tmp:
        f = Path(tmp) / "troceo.js"
        f.write_text(guion, encoding="utf-8")
        r = subprocess.run([_NODE, str(f)], capture_output=True, text=True)
    assert r.returncode == 0, r.stderr
    resultados = json.loads(r.stdout.strip().splitlines()[-1])

    for i, res in enumerate(resultados):
        assert res["conserva"], f"caso {i}: el troceo perdió o alteró texto"
        assert res["maximo"] <= 6000, f"caso {i}: bloque de {res['maximo']} caracteres"

    assert resultados[-1]["bloques"] == 1, "un texto corto no debe trocearse"
    assert resultados[0]["bloques"] > 1, "un texto largo sí debe trocearse"
    # Una palabra de 30 000 caracteres también tiene que partirse.
    assert resultados[3]["bloques"] > 1


@pytest.mark.skipif(not _NODE, reason="node no está instalado")
def test_el_texto_del_fallo_real_se_parte_en_bloques_seguros():
    """39 732 caracteres: el tamaño exacto que devolvía 504 en producción."""
    guion = _extraer_js_troceo() + r"""
const texto = "This is a real sentence from a talk. ".repeat(1104); // ~39 700
const trozos = jgTrocearParaTraducir(texto);
console.log(JSON.stringify({
  largo: texto.length,
  bloques: trozos.length,
  maximo: Math.max(...trozos.map((t) => t.length)),
}));
"""
    with tempfile.TemporaryDirectory() as tmp:
        f = Path(tmp) / "troceo2.js"
        f.write_text(guion, encoding="utf-8")
        r = subprocess.run([_NODE, str(f)], capture_output=True, text=True)
    assert r.returncode == 0, r.stderr
    res = json.loads(r.stdout.strip().splitlines()[-1])

    assert res["largo"] > 39000
    assert res["bloques"] >= 7, "debería repartirse en varias peticiones cortas"
    assert res["maximo"] <= 6000
