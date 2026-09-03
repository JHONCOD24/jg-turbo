"""JG Turbo · Sincronización de la biblioteca entre dispositivos.

No hay usuarios ni correos: hay «bibliotecas», y quien tiene una llave de una
biblioteca puede leerla y escribirla. Así no se guarda ni un dato personal.

Cómo se entra desde un segundo dispositivo:

    1. El dispositivo que ya tiene llave pide un código de 6 dígitos.
    2. El nuevo escribe ese código (vive 10 minutos y se usa una sola vez).
    3. La base le fabrica **su propia llave** y se la entrega una vez.

El servidor nunca guarda ninguna llave en claro, solo su huella SHA-256.

**Dónde vive la seguridad.** No aquí: en la base. Las tablas están cerradas con
RLS y sin políticas (nadie las toca desde fuera), y lo único accesible son siete
funciones `SECURITY DEFINER` que validan la llave antes de hacer nada. Por eso
este módulo puede usar la clave PÚBLICA de Supabase: aunque alguien la copie del
código, no puede leer ni escribir nada sin una llave de biblioteca válida.

Esa decisión tiene además una ventaja práctica: no hace falta manejar la clave
secreta `service_role`, que habría obligado al dueño a copiarla a mano.

Las tablas y funciones llevan el prefijo «jgt_» porque esta base de Supabase la
comparte otra aplicación del mismo dueño.
"""
from __future__ import annotations

import os
from typing import Any, Optional

import httpx
from fastapi import APIRouter, Header, HTTPException
from pydantic import BaseModel

router = APIRouter()

TIEMPO_ESPERA_S = 25.0
# El texto viaja capítulo a capítulo, no libro entero: así no hay tope de
# tamaño de libro. Este techo es solo por CAPÍTULO, y con margen de sobra:
# el lector parte los capítulos en 90.000 caracteres, así que ninguno se
# acerca. Existe únicamente para que un dato corrupto no tumbe la petición.
MAX_BYTES_CAPITULO = 3_000_000

# Los errores que levantan las funciones de la base, traducidos a algo que una
# persona entienda. La regla: decir qué pasó y qué hacer.
ERRORES = {
    "LLAVE_INVALIDA": (
        401,
        "Esta llave no corresponde a ninguna biblioteca. Vuelve a vincular el dispositivo.",
    ),
    "CODIGO_INVALIDO": (400, "El código son 6 dígitos."),
    "CODIGO_NO_EXISTE": (404, "Ese código no existe. Pide uno nuevo en el otro dispositivo."),
    "CODIGO_USADO": (409, "Ese código ya se usó. Genera uno nuevo."),
    "CODIGO_BLOQUEADO": (429, "Demasiados intentos con ese código. Genera uno nuevo."),
    "CODIGO_VENCIDO": (410, "Ese código venció. Genera uno nuevo en el otro dispositivo."),
    "DOCUMENTO_GRANDE": (
        413,
        "Ese capítulo es demasiado grande para enviarlo de una vez. "
        "Vuelve a procesar el documento para que se divida en capítulos más pequeños.",
    ),
}


def _config() -> tuple[str, str]:
    url = (os.environ.get("SUPABASE_URL") or "").rstrip("/")
    # La clave pública basta: la seguridad está en la base, no en esta clave.
    clave = (
        os.environ.get("SUPABASE_ANON_KEY")
        or os.environ.get("SUPABASE_PUBLISHABLE_KEY")
        or os.environ.get("SUPABASE_SERVICE_KEY")
        or ""
    )
    if not url or not clave:
        raise HTTPException(
            status_code=503,
            detail=(
                "La sincronización no está configurada en el servidor. "
                "Faltan SUPABASE_URL y SUPABASE_ANON_KEY."
            ),
        )
    return url, clave


async def _rpc(funcion: str, argumentos: dict) -> Any:
    """Llama a una de las funciones de sincronización de la base."""
    url, clave = _config()
    cabeceras = {
        "apikey": clave,
        "Authorization": f"Bearer {clave}",
        "Content-Type": "application/json",
    }
    try:
        async with httpx.AsyncClient(timeout=TIEMPO_ESPERA_S) as cliente:
            respuesta = await cliente.post(
                f"{url}/rest/v1/rpc/{funcion}", headers=cabeceras, json=argumentos
            )
    except httpx.TimeoutException:
        raise HTTPException(
            status_code=504,
            detail="La sincronización no respondió a tiempo. Inténtalo de nuevo.",
        )
    except httpx.HTTPError as e:
        raise HTTPException(status_code=502, detail=f"No se pudo hablar con la base: {e}")

    if respuesta.status_code >= 400:
        texto = (respuesta.text or "")[:400]
        for marca, (codigo, mensaje) in ERRORES.items():
            if marca in texto:
                raise HTTPException(status_code=codigo, detail=mensaje)
        # Un proyecto de Supabase en plan gratis se pausa solo tras unos días
        # sin uso. Decirlo con claridad ahorra media hora de desconcierto.
        if respuesta.status_code in (503, 521, 544) or "paused" in texto.lower():
            raise HTTPException(
                status_code=503,
                detail=(
                    "Tu sincronización está dormida: el proyecto de Supabase se pausó por "
                    "inactividad. Entra a supabase.com y pulsa «Restore project» para despertarlo."
                ),
            )
        raise HTTPException(status_code=502, detail=f"La base rechazó la operación: {texto}")

    if respuesta.status_code == 204 or not respuesta.content:
        return None
    return respuesta.json()


# ── Modelos ──────────────────────────────────────────────────────────────────

class CrearRequest(BaseModel):
    dispositivo: str = ""


class VincularRequest(BaseModel):
    codigo: str
    dispositivo: str = ""


class DocumentoSync(BaseModel):
    id: str
    actualizado: int
    borrado: bool = False
    datos: Optional[dict] = None


class SubirRequest(BaseModel):
    documentos: list[DocumentoSync]


# ── Endpoints ────────────────────────────────────────────────────────────────

def _llave(cabecera: str) -> str:
    limpia = (cabecera or "").strip()
    if not limpia:
        raise HTTPException(status_code=401, detail="Falta la llave de la biblioteca.")
    return limpia


@router.post("/api/sync/crear")
async def crear_biblioteca(req: CrearRequest):
    """Crea una biblioteca nueva y entrega su primera llave (una sola vez)."""
    return await _rpc("jgt_crear", {"p_dispositivo": (req.dispositivo or "")[:80]})


@router.post("/api/sync/codigo")
async def crear_codigo(x_jg_llave: str = Header(default="")):
    """Genera el código de 6 dígitos que se escribe en el otro dispositivo."""
    return await _rpc("jgt_codigo", {"p_llave": _llave(x_jg_llave)})


@router.post("/api/sync/vincular")
async def vincular(req: VincularRequest):
    """Cambia un código válido por una llave propia para este dispositivo."""
    codigo = (req.codigo or "").strip().replace(" ", "")
    if not codigo.isdigit() or len(codigo) != 6:
        raise HTTPException(status_code=400, detail="El código son 6 dígitos.")
    return await _rpc(
        "jgt_vincular",
        {"p_codigo": codigo, "p_dispositivo": (req.dispositivo or "")[:80]},
    )


@router.get("/api/sync/estado")
async def estado(x_jg_llave: str = Header(default="")):
    """Resumen para la interfaz: cuántos documentos y cuántos dispositivos."""
    return await _rpc("jgt_estado", {"p_llave": _llave(x_jg_llave)})


@router.get("/api/sync/bajar")
async def bajar(desde: str = "", x_jg_llave: str = Header(default="")):
    """Documentos cambiados en la nube desde la última sincronización."""
    # El cursor es una fecha ISO con zona («…+00:00»). En una URL, el «+»
    # significa espacio, así que llega roto si el cliente no lo codifica bien.
    # Se repara aquí en vez de confiar en que todos los clientes lo hagan.
    cursor = (desde or "").strip().replace(" ", "+")
    return await _rpc("jgt_bajar", {"p_llave": _llave(x_jg_llave), "p_desde": cursor})


@router.post("/api/sync/subir")
async def subir(req: SubirRequest, x_jg_llave: str = Header(default="")):
    """Guarda los DATOS de los documentos (título, capítulos, progreso).

    El texto no viaja por aquí: va capítulo a capítulo por «/api/sync/parte».
    Separarlos es lo que quita el límite de tamaño y hace que mover el
    progreso no obligue a resubir el libro entero.
    """
    llave = _llave(x_jg_llave)
    if not req.documentos:
        return {"guardados": 0}

    documentos = [{
        "id": documento.id,
        "actualizado": documento.actualizado,
        "borrado": documento.borrado,
        "datos": None if documento.borrado else (documento.datos or {}),
    } for documento in req.documentos]

    return await _rpc("jgt_subir", {"p_llave": llave, "p_documentos": documentos})


class ParteSync(BaseModel):
    documento: str
    indice: int
    titulo: str = ""
    texto: str = ""
    traduccion: Optional[str] = None
    pulido: Optional[str] = None
    pagina: Optional[int] = None
    actualizado: int = 0


@router.post("/api/sync/parte")
async def subir_parte(req: ParteSync, x_jg_llave: str = Header(default="")):
    """Sube UN capítulo. Es la operación que se repite al sincronizar."""
    llave = _llave(x_jg_llave)
    if len(req.texto or "") > MAX_BYTES_CAPITULO:
        raise HTTPException(status_code=413, detail=ERRORES["DOCUMENTO_GRANDE"][1])
    # Intentar enviar pulido; si la función aún no lo conoce, degradar sin romper
    payload = {
        "p_llave": llave,
        "p_doc": req.documento,
        "p_indice": req.indice,
        "p_titulo": (req.titulo or "")[:300],
        "p_texto": req.texto or "",
        "p_traduccion": req.traduccion,
        "p_pagina": req.pagina,
        "p_actualizado": req.actualizado,
    }
    if req.pulido is not None:
        payload["p_pulido"] = req.pulido
    try:
        return await _rpc("jgt_subir_parte", payload)
    except HTTPException as e:
        # Si la base aún no acepta p_pulido, reintentar sin ese campo
        if req.pulido is not None and "p_pulido" in str(e.detail or "").lower():
            payload.pop("p_pulido", None)
            return await _rpc("jgt_subir_parte", payload)
        raise


@router.get("/api/sync/partes")
async def bajar_partes(documento: str, x_jg_llave: str = Header(default="")):
    """Los capítulos de un documento, en orden."""
    return await _rpc("jgt_bajar_partes", {"p_llave": _llave(x_jg_llave), "p_doc": documento})


@router.get("/api/sync/resumen-partes")
async def resumen_partes(x_jg_llave: str = Header(default="")):
    """Cuántos capítulos hay guardados de cada documento."""
    return await _rpc("jgt_resumen_partes", {"p_llave": _llave(x_jg_llave)})


@router.post("/api/sync/olvidar")
async def olvidar(x_jg_llave: str = Header(default="")):
    """Borra la biblioteca de la nube. Lo del dispositivo no se toca."""
    return await _rpc("jgt_olvidar", {"p_llave": _llave(x_jg_llave)})
