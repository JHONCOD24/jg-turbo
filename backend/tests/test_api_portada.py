"""Pruebas del endpoint que busca la portada real de un libro.

Lo importante aquí no es que encuentre portadas —eso depende de un catálogo
externo— sino que **nunca rompa la app**: sin red, con el catálogo caído o con
una respuesta rara, el lector tiene que poder seguir y dibujar la carátula.

Ejecutar: python -m pytest backend/tests/test_api_portada.py -q
"""
from __future__ import annotations

import asyncio
import sys
from pathlib import Path

RAIZ = Path(__file__).resolve().parents[2]
if str(RAIZ) not in sys.path:
    sys.path.insert(0, str(RAIZ))

from api.portada import _limpiar_consulta, buscar_portada  # noqa: E402


def correr(corrutina):
    """Ejecuta una corrutina sin depender de `pytest-asyncio`.

    El proyecto evita dependencias que el lenguaje ya resuelve, y `asyncio.run`
    hace exactamente lo que hace falta aquí.
    """
    return asyncio.run(corrutina)


class ClienteFalso:
    """Sustituye a `httpx.AsyncClient` para probar sin tocar la red."""

    respuesta = None
    error = None

    def __init__(self, *_a, **_k):
        pass

    async def __aenter__(self):
        return self

    async def __aexit__(self, *_a):
        return False

    async def get(self, *_a, **_k):
        if type(self).error:
            raise type(self).error
        return type(self).respuesta


def _con_cliente(monkeypatch, *, respuesta=None, error=None):
    import api.portada as modulo

    ClienteFalso.respuesta = respuesta
    ClienteFalso.error = error
    monkeypatch.setattr(modulo.httpx, "AsyncClient", ClienteFalso)


# ── Limpieza de la consulta ───────────────────────────────────────────────

def test_limpiar_quita_signos_y_espacios():
    assert _limpiar_consulta("  Sapiens:   de animales a dioses!! ") == "Sapiens de animales a dioses"


def test_limpiar_conserva_tildes_y_ene():
    # Sin tildes, «Pre-suasión» no encuentra el libro en español.
    assert "suasión" in _limpiar_consulta("Pre-suasión")
    assert "ñ" in _limpiar_consulta("El niño")


def test_limpiar_acota_el_largo():
    assert len(_limpiar_consulta("a" * 500)) <= 120


def test_limpiar_no_rompe_con_entradas_raras():
    assert _limpiar_consulta("") == ""
    assert _limpiar_consulta(None) == ""
    assert _limpiar_consulta("###") == ""


# ── El endpoint nunca revienta ────────────────────────────────────────────

def test_titulo_vacio_devuelve_lista_vacia():
    assert correr(buscar_portada(titulo="  ")) == {"resultados": []}


def test_sin_red_devuelve_lista_vacia_con_aviso(monkeypatch):
    """Si el catálogo no responde, se devuelve vacío y se dice por qué.

    Nunca un 500: quedarse sin portada no es un error que el usuario deba ver,
    y el cliente ya sabe dibujar una.
    """
    _con_cliente(monkeypatch, error=ConnectionError("sin red"))
    resultado = correr(buscar_portada(titulo="Sapiens"))
    assert resultado["resultados"] == []
    assert "aviso" in resultado


def test_descarta_los_libros_sin_imagen(monkeypatch):
    """Un resultado sin `cover_i` no sirve: no tiene portada que mostrar."""

    class Respuesta:
        status_code = 200

        @staticmethod
        def json():
            return {
                "docs": [
                    {"title": "Sin tapa", "author_name": ["X"]},                # sin cover_i
                    {"title": "Con tapa", "author_name": ["Y"], "cover_i": 42},
                ]
            }

    _con_cliente(monkeypatch, respuesta=Respuesta())
    resultado = correr(buscar_portada(titulo="Sapiens"))
    assert len(resultado["resultados"]) == 1
    unico = resultado["resultados"][0]
    assert unico["titulo"] == "Con tapa"
    assert unico["autor"] == "Y"
    assert unico["portada"].endswith("42-L.jpg")


def test_catalogo_con_error_http_no_rompe(monkeypatch):
    class Respuesta:
        status_code = 503

        @staticmethod
        def json():
            return {}

    _con_cliente(monkeypatch, respuesta=Respuesta())
    resultado = correr(buscar_portada(titulo="Sapiens"))
    assert resultado["resultados"] == []
    # El aviso nombra las dos fuentes: si solo dijera «503» no se sabría cuál
    # falló, y son dos catálogos distintos que fallan por motivos distintos.
    aviso = resultado.get("aviso", "")
    assert "503" in aviso
    assert "openlibrary" in aviso and "google" in aviso


def test_respuesta_sin_docs_no_rompe(monkeypatch):
    """El catálogo puede devolver 200 con un cuerpo inesperado."""

    class Respuesta:
        status_code = 200

        @staticmethod
        def json():
            return {"otra_cosa": 1}

    _con_cliente(monkeypatch, respuesta=Respuesta())
    assert correr(buscar_portada(titulo="Sapiens"))["resultados"] == []


# ── El router expone la ruta ──────────────────────────────────────────────

def test_el_router_expone_la_ruta():
    """La ruta tiene que existir en el router que `api/index.py` monta.

    Se comprueba sobre el router y no sobre `app.routes` a propósito: al
    importar el paquete a mano, el mismo `api` entra dos veces en el
    `sys.path` y el montaje local no refleja lo que ocurre en el servidor
    (a `/api/sync/*` le pasa lo mismo y en producción funciona). El montaje
    real se verifica contra el dominio tras desplegar.
    """
    from api.portada import router

    assert "/api/portada" in {r.path for r in router.routes}


def test_index_declara_el_montaje():
    """Y `api/index.py` tiene que incluirlo, o la ruta nunca existirá."""
    fuente = Path(__file__).resolve().parents[2] / "api" / "index.py"
    texto = fuente.read_text(encoding="utf-8")
    assert "from api.portada import router as portada_router" in texto
    assert "app.include_router(portada_router)" in texto
