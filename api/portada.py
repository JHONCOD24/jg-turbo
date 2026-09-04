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

import re
from typing import Any, Optional

import httpx
from fastapi import APIRouter, Query

router = APIRouter()

BUSQUEDA = "https://openlibrary.org/search.json"
PORTADA = "https://covers.openlibrary.org/b/id/{id}-L.jpg"

# Open Library pide identificarse con un contacto. Es su norma de uso.
CABECERAS = {"User-Agent": "JG-Turbo/1.0 (https://jg-turbo.vercel.app)"}

# Suficiente para elegir; pedir más solo alarga la espera.
MAX_RESULTADOS = 5
ESPERA_SEG = 8.0


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

    parametros: dict[str, Any] = {
        "title": consulta,
        "limit": MAX_RESULTADOS,
        "fields": "title,author_name,cover_i,first_publish_year",
    }
    autor_limpio = _limpiar_consulta(autor or "")
    if autor_limpio:
        parametros["author"] = autor_limpio

    try:
        async with httpx.AsyncClient(timeout=ESPERA_SEG, headers=CABECERAS) as cliente:
            respuesta = await cliente.get(BUSQUEDA, params=parametros)
            if respuesta.status_code != 200:
                return {"resultados": [], "aviso": f"catalogo_{respuesta.status_code}"}
            datos = respuesta.json()
    except Exception as error:  # noqa: BLE001 - sin portada se vive
        return {"resultados": [], "aviso": type(error).__name__}

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

    return {"resultados": resultados}
