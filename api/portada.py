"""JG Turbo · Buscar la portada real de un libro.

Un PDF de solo texto no trae tapa. Antes de dibujarle una, vale la pena mirar
si existe la de verdad: reconocer un libro por su portada es mucho más rápido
que leer su título.

Por qué esto vive en el servidor y no en el navegador: el catálogo de Open
Library **no permite consultas desde otras webs** (no envía las cabeceras CORS
que el navegador exige), así que una petición desde la página se bloquea. Las
imágenes de portada sí las permiten, y por eso el navegador se las descarga
solo: aquí únicamente se busca *cuál* es la portada, no se mueve la imagen.

No hay claves ni cuentas: Open Library es abierto. Si no responde o no
encuentra nada, se devuelve una lista vacía y el cliente dibuja la portada.
"""
from __future__ import annotations

import os
import re
from typing import Any, Optional

import httpx
from fastapi import APIRouter, Query

router = APIRouter()

BUSQUEDA = "https://openlibrary.org/search.json"
PORTADA = "https://covers.openlibrary.org/b/id/{id}-L.jpg"
GOOGLE = "https://www.googleapis.com/books/v1/volumes"

# Open Library pide identificarse con un contacto. Es su norma de uso.
CABECERAS = {"User-Agent": "JG-Turbo/1.0 (https://jg-turbo.vercel.app)"}

# Suficiente para elegir; pedir más solo alarga la espera.
MAX_RESULTADOS = 5
# Open Library tarda: con 8 s se agotaba el tiempo desde Vercel antes de
# recibir nada. 15 s sigue siendo una espera aceptable para el usuario, que
# mientras tanto ya está viendo la carátula dibujada.
ESPERA_SEG = 15.0


def _limpiar_consulta(texto: str) -> str:
    """Deja solo lo que sirve para buscar: sin signos raros ni relleno."""
    t = re.sub(r"[^\w\sáéíóúüñÁÉÍÓÚÜÑ-]", " ", str(texto or ""), flags=re.UNICODE)
    t = re.sub(r"\s+", " ", t).strip()
    return t[:120]


@router.get("/api/portada")
async def buscar_portada(
    titulo: str = Query(..., min_length=2, max_length=200),
    autor: Optional[str] = Query(None, max_length=120),
) -> dict[str, Any]:
    """Candidatos de portada para un libro.

    Devuelve `{"resultados": [{titulo, autor, portada, anio}]}`. Quien decide
    cuál vale es el cliente (`js/pdf/caratula.js: elegirMejorPortada`), que ya
    tiene las pruebas de esa comparación: aquí no se adivina.

    Nunca lanza error: sin portada el libro sigue funcionando igual, así que un
    fallo de red se devuelve como lista vacía y no como un 500 que el usuario
    tendría que entender.
    """
    consulta = _limpiar_consulta(titulo)
    if not consulta:
        return {"resultados": []}
    autor_limpio = _limpiar_consulta(autor or "")

    # Se prueban dos catálogos porque ninguno los tiene todos y ambos fallan a
    # ratos: Open Library tiene mejor cobertura de ediciones en español, y
    # Google Books responde más rápido. El primero que devuelva algo, gana.
    avisos: list[str] = []
    for fuente in (_openlibrary, _google_books):
        try:
            resultados, aviso = await fuente(consulta, autor_limpio)
        except Exception as error:  # noqa: BLE001 - sin portada se vive
            avisos.append(f"{fuente.__name__}:{type(error).__name__}")
            continue
        if resultados:
            return {"resultados": resultados}
        if aviso:
            avisos.append(f"{fuente.__name__}:{aviso}")

    return {"resultados": [], "aviso": " | ".join(avisos) or "sin_resultados"}


async def _openlibrary(consulta: str, autor: str) -> tuple[list[dict[str, Any]], str]:
    parametros: dict[str, Any] = {
        "title": consulta,
        "limit": MAX_RESULTADOS,
        "fields": "title,author_name,cover_i,first_publish_year",
    }
    if autor:
        parametros["author"] = autor

    async with httpx.AsyncClient(timeout=ESPERA_SEG, headers=CABECERAS) as cliente:
        respuesta = await cliente.get(BUSQUEDA, params=parametros)
        if respuesta.status_code != 200:
            return [], f"catalogo_{respuesta.status_code}"
        datos = respuesta.json()

    resultados = []
    for documento in (datos.get("docs") or [])[:MAX_RESULTADOS]:
        identificador = documento.get("cover_i")
        if not identificador:
            continue  # sin imagen no sirve de nada
        autores = documento.get("author_name") or []
        resultados.append(
            {
                "titulo": documento.get("title") or "",
                "autor": autores[0] if autores else "",
                "portada": PORTADA.format(id=identificador),
                "anio": documento.get("first_publish_year"),
            }
        )
    return resultados, ""


async def _google_books(consulta: str, autor: str) -> tuple[list[dict[str, Any]], str]:
    """Segunda fuente.

    **Necesita clave.** Sin ella Google responde 429 con cuota 0 (comprobado el
    2026-09-03 desde Vercel y desde un equipo cualquiera): ya no hay acceso
    anónimo. Con `GOOGLE_API_KEY` en el entorno y la «Books API» activada en
    ese proyecto de Google Cloud funciona, y es gratis: 1000 consultas al día,
    de sobra para una biblioteca personal.

    Sin clave devuelve vacío como cualquier otro fallo y el libro se queda con
    su carátula dibujada, que es la que se ve por defecto.
    """
    busqueda = f'intitle:"{consulta}"'
    if autor:
        busqueda += f' inauthor:"{autor}"'

    parametros: dict[str, Any] = {
        "q": busqueda,
        "maxResults": MAX_RESULTADOS,
        "printType": "books",
    }
    clave = os.environ.get("GOOGLE_BOOKS_API_KEY") or os.environ.get("GOOGLE_API_KEY")
    if clave:
        parametros["key"] = clave

    async with httpx.AsyncClient(timeout=ESPERA_SEG, headers=CABECERAS) as cliente:
        respuesta = await cliente.get(GOOGLE, params=parametros)
        if respuesta.status_code != 200:
            # El 429 sin clave es el caso normal, no una avería: se distingue
            # para que quien lea el aviso sepa que solo falta configurarla.
            if respuesta.status_code == 429 and not clave:
                return [], "google_sin_clave"
            return [], f"google_{respuesta.status_code}"
        datos = respuesta.json()

    resultados = []
    for volumen in (datos.get("items") or [])[:MAX_RESULTADOS]:
        info = volumen.get("volumeInfo") or {}
        imagenes = info.get("imageLinks") or {}
        enlace = imagenes.get("thumbnail") or imagenes.get("smallThumbnail")
        if not enlace:
            continue
        autores = info.get("authors") or []
        resultados.append(
            {
                "titulo": info.get("title") or "",
                "autor": autores[0] if autores else "",
                # Sin `zoom=1` llega una miniatura diminuta; y en https, que si
                # no el navegador bloquea la imagen por contenido mixto.
                "portada": enlace.replace("http://", "https://") + "&zoom=1",
                "anio": (info.get("publishedDate") or "")[:4] or None,
            }
        )
    return resultados, ""
