"""Cliente de Supadata: vía principal para sacar el texto de un video.

Por qué existe: YouTube bloquea de forma determinista a las IP de datacenter
(medido el 2026-08-01 contra producción: el mismo video falla 5 de 5 veces desde
Vercel). Supadata sale por su propia infraestructura y, con `mode=auto`,
transcribe con IA los videos que no tienen subtítulos.

Sin `SUPADATA_API_KEY` el módulo se comporta como "no configurado" y quien lo
llama sigue con la cadena gratuita de siempre. Nada se rompe.

Módulo puro (sin FastAPI) para que lo usen tanto `api/index.py` (Vercel) como
`backend/app.py` (local) sin duplicar la lógica.
"""

from __future__ import annotations

import os
import time
import urllib.parse
from typing import Any, Optional

import requests

API_KEY = (os.environ.get("SUPADATA_API_KEY") or "").strip()
BASE_URL = os.environ.get("SUPADATA_BASE_URL", "https://api.supadata.ai/v1").rstrip("/")
TIMEOUT_S = float(os.environ.get("SUPADATA_TIMEOUT_S", "30"))

# Errores de cuenta: el usuario no puede arreglarlos reintentando el video.
CODIGOS_DE_CUENTA = ("unauthorized", "limit-exceeded", "upgrade-required", "forbidden")

_MENSAJES = {
    "unauthorized": "La clave de Supadata no es válida (revisa SUPADATA_API_KEY en Vercel).",
    "forbidden": "La cuenta de Supadata no tiene permiso para este contenido.",
    "limit-exceeded": "Se agotaron los créditos de Supadata este mes.",
    "upgrade-required": "Este video necesita un plan de Supadata superior.",
    "transcript-unavailable": "Supadata no encontró texto en este video.",
    "not-found": "El video no existe o es privado.",
    "invalid-request": "Supadata rechazó la petición.",
}


class SupadataError(RuntimeError):
    """Supadata no pudo entregar la transcripción, con un motivo legible."""

    def __init__(self, mensaje: str, codigo: str = "", http_status: int = 0):
        super().__init__(mensaje)
        self.codigo = codigo
        self.http_status = http_status

    @property
    def es_de_cuenta(self) -> bool:
        return self.codigo in CODIGOS_DE_CUENTA


def configurado() -> bool:
    return bool(API_KEY)


# Con «auto» la API devuelve la primera pista que encuentre, que puede ser una
# traducción cualquiera. Estos son los idiomas que la app prefiere en ese caso.
IDIOMAS_PREFERIDOS = ("es", "en")


def elegir_idioma(lang_recibido: str, disponibles) -> Optional[str]:
    """En modo «auto», qué idioma reclamar si el recibido no sirve.

    Devuelve `None` si lo recibido ya está bien o si no hay nada mejor: así
    quien llama solo repite la petición cuando de verdad vale la pena.
    """
    recibido = (lang_recibido or "").split("-")[0].lower()
    if recibido in IDIOMAS_PREFERIDOS:
        return None
    cortos = {str(l).split("-")[0].lower() for l in (disponibles or [])}
    for preferido in IDIOMAS_PREFERIDOS:
        if preferido in cortos:
            return preferido
    return None


def texto_de_contenido(contenido: Any) -> str:
    """Normaliza `content`: con text=true llega un string; si no, trozos."""
    if isinstance(contenido, str):
        return contenido.strip()
    if isinstance(contenido, list):
        partes = []
        for trozo in contenido:
            if isinstance(trozo, dict):
                txt = (trozo.get("text") or "").replace("\n", " ").strip()
            else:
                txt = str(trozo or "").strip()
            if txt:
                partes.append(txt)
        return " ".join(partes).strip()
    return ""


def _get(ruta: str, params: Optional[dict] = None) -> tuple[int, dict]:
    """GET autenticado. Devuelve (status, json) sin lanzar por HTTP."""
    if not API_KEY:
        raise SupadataError("SUPADATA_API_KEY no está configurada.", "sin-clave")
    try:
        resp = requests.get(
            f"{BASE_URL}{ruta}",
            params=params or {},
            headers={"x-api-key": API_KEY},
            timeout=TIMEOUT_S,
        )
    except requests.RequestException as exc:
        raise SupadataError(f"No se pudo contactar a Supadata: {exc}", "red") from exc
    try:
        datos = resp.json()
    except ValueError:
        datos = {}
    return resp.status_code, datos if isinstance(datos, dict) else {}


def _fallo(status: int, datos: dict) -> SupadataError:
    codigo = str(datos.get("error") or "")
    detalle = str(datos.get("message") or datos.get("details") or "").strip()
    mensaje = _MENSAJES.get(codigo) or detalle or f"Supadata respondió HTTP {status}."
    return SupadataError(mensaje, codigo or "http", status)


def transcribir(url: str, idioma_corto: Optional[str] = None) -> dict:
    """Pide el texto del video.

    Devuelve {'texto', 'lang', 'disponibles'} o {'job_id': ...}.

    `mode=auto` = usa los subtítulos si existen y, si no, los genera con IA.

    Ojo con `lang`: si no se manda, la API devuelve «la primera disponible», que
    es arbitraria — un video en inglés puede llegar en alemán. Por eso quien
    llama debe revisar `disponibles` cuando el usuario pidió «auto».
    """
    params = {"url": url, "text": "true", "mode": "auto"}
    if idioma_corto:
        params["lang"] = idioma_corto
    status, datos = _get("/transcript", params)

    if status == 202 and datos.get("jobId"):
        return {"job_id": str(datos["jobId"])}
    if status == 200:
        texto = texto_de_contenido(datos.get("content"))
        if texto:
            return {
                "texto": texto,
                "lang": datos.get("lang") or idioma_corto or "es",
                "disponibles": datos.get("availableLangs") or [],
            }
        raise SupadataError("Supadata devolvió una transcripción vacía.", "vacio", status)
    raise _fallo(status, datos)


def estado_job(job_id: str) -> dict:
    """Consulta un trabajo. Devuelve {'estado': 'completado'|'en_proceso', ...}."""
    status, datos = _get(f"/transcript/{urllib.parse.quote(job_id)}")
    if status != 200:
        raise _fallo(status, datos)

    estado = str(datos.get("status") or "").lower()
    if estado == "completed":
        texto = texto_de_contenido(datos.get("content"))
        if not texto:
            raise SupadataError("El video terminó sin texto utilizable.", "vacio")
        return {"estado": "completado", "texto": texto, "lang": datos.get("lang") or "es"}
    if estado == "failed":
        error = datos.get("error")
        raise _fallo(200, error if isinstance(error, dict) else {"error": error})
    return {"estado": "en_proceso"}


def esperar(job_id: str, segundos: float) -> Optional[dict]:
    """Espera un trabajo dentro de un presupuesto. None = sigue en proceso."""
    limite = time.monotonic() + max(0.0, segundos)
    intento = 0
    while time.monotonic() < limite:
        # La documentación recomienda consultar cada segundo; después
        # espaciamos para no gastar la ventana entera en reintentos.
        time.sleep(1.0 if intento < 8 else 2.0)
        intento += 1
        estado = estado_job(job_id)
        if estado["estado"] == "completado":
            estado["intentos"] = intento
            return estado
    return None
