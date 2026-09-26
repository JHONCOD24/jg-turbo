"""Qué idioma pedirle a Supadata ANTES de descargar el texto de un video.

Por qué existe (medido el 2026-09-25 contra producción): con `lang` vacío
Supadata devuelve «la primera pista disponible». YouTube dobla videos solo
(doblaje automático) y cada idioma doblado trae su propia pista `asr`: en
`dNWkwrqAkcM` (inglés, 88 min) hay 7 y la primera es árabe. La app recibía el
texto en árabe y rechazaba un video en inglés.

Regla: el idioma se decide ANTES de pedir el texto, con la mejor señal que
haya, y se pide explícito. Módulo puro (sin red, sin FastAPI).
"""

from __future__ import annotations

import re
from typing import Iterable, Optional

from api import deteccion_idioma

IDIOMAS_DOBLABLES = ("en", "pt", "fr", "de", "it")

# Palabras muy frecuentes por idioma, pensadas para TÍTULOS (pocas palabras):
# solo se afirma algo si la ventaja es clara.
_FRECUENTES = {
    "en": set("the a an of and to in is it you your how what why with for on this that are be can will from my we our new all about when".split()),
    "es": set("el la los las de del y en que un una por para con cómo como qué es tu mi más sin sobre este esta nuevo nueva".split()),
    "pt": set("o a os as de do da dos das e em que um uma por para com como é você seu sua mais sem sobre este esta novo nova não".split()),
    "fr": set("le la les de des du et en un une pour avec comment est vous votre plus sans sur ce cette nouveau nouvelle pas qui".split()),
    "de": set("der die das und ist ein eine zu mit für wie was nicht auf von den dem des ich du sie wir neue neuen".split()),
    "it": set("il lo la gli le di del della e in un una per con come è tuo tua più senza su questo questa nuovo nuova non che".split()),
}
_RE_PALABRA = re.compile(r"[a-záéíóúüñàâçèêëïîôûùäöß'ãõ]+", re.IGNORECASE)


def idioma_del_titulo(titulo: str) -> tuple[str, float]:
    """(idioma, confianza) a partir del título. Títulos cortos → confianza baja."""
    texto = str(titulo or "").strip()
    if not texto:
        return "", 0.0
    escritura, confianza = deteccion_idioma.idioma_por_escritura(texto)
    if escritura:
        return escritura, confianza
    palabras = [p.lower() for p in _RE_PALABRA.findall(texto)]
    if not palabras:
        return "", 0.0
    puntos = {idioma: sum(1 for p in palabras if p in lista) for idioma, lista in _FRECUENTES.items()}
    (mejor, a), (_, b) = sorted(puntos.items(), key=lambda kv: kv[1], reverse=True)[:2]
    if a == 0 or a == b:
        return "", 0.0
    margen = (a - b) / a          # 1 = sin competencia
    cantidad = min(1.0, a / 4)    # 4 palabras comunes ya bastan en un título
    return mejor, round(min(0.8, 0.35 + 0.5 * margen * cantidad), 3)


def resolver_idioma_origen(
    *,
    pedido: str = "",
    audio_declarado: str = "",
    idioma_metadatos: str = "",
    titulo: str = "",
    disponibles: Optional[Iterable[str]] = None,
) -> dict:
    """Mejor idioma de origen conocido ANTES de descargar el texto.

    Orden: lo que eligió la persona (1.0) > idioma de audio que declara YouTube
    (0.97) > idioma de los metadatos del video (0.75) > idioma del título (≤ 0.8)
    > pistas que ofrece Supadata (0.4–0.8). Idioma vacío = no se sabe.
    """
    corto = deteccion_idioma.codigo_corto
    if corto(pedido) and corto(pedido) != "auto":
        return {"idioma": corto(pedido), "fuente": "usuario", "confianza": 1.0}
    if corto(audio_declarado):
        return {"idioma": corto(audio_declarado), "fuente": "youtube", "confianza": 0.97}
    if corto(idioma_metadatos):
        return {"idioma": corto(idioma_metadatos), "fuente": "metadatos", "confianza": 0.75}
    lista = [corto(x) for x in (disponibles or []) if corto(x)]
    varias = len(set(lista)) > 1
    idioma_t, confianza_t = idioma_del_titulo(titulo)
    if idioma_t:
        # Con varias pistas, un título «en español» puede ser una traducción de
        # YouTube para quien lo mira desde Colombia: no basta para afirmar nada.
        if idioma_t == "es" and varias:
            confianza_t = min(confianza_t, 0.45)
        return {"idioma": idioma_t, "fuente": "titulo", "confianza": confianza_t}
    if lista:
        if not varias:
            return {"idioma": lista[0], "fuente": "disponibles", "confianza": 0.8}
        if "en" in lista:
            return {"idioma": "en", "fuente": "disponibles", "confianza": 0.55}
        return {"idioma": lista[0], "fuente": "disponibles", "confianza": 0.4}
    return {"idioma": "", "fuente": "desconocido", "confianza": 0.0}
