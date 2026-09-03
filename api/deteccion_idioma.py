"""Detección del idioma **hablado** de un video, con puntuación de confianza.

Por qué existe: el doblaje solo debe activarse cuando el audio original está en
inglés, y hasta ahora la app confundía dos cosas distintas:

* el idioma de la **pista de subtítulos** (que puede ser una traducción), y
* el idioma del **audio**, que es el que de verdad importa.

Un video hablado en español con subtítulos en inglés pasaba el filtro y se
"doblaba" al español. Este módulo separa las dos cosas: recoge varias señales,
le pone un peso a cada una según lo que realmente demuestra sobre el audio, y
entrega un veredicto con confianza de 0 a 1 para que la app pueda aplicar sus
reglas (aceptar, preguntar o rechazar).

No hace red ni depende de FastAPI: lo usan igual `api/index.py` (Vercel) y
`backend/app.py` (local).
"""

from __future__ import annotations

import re
import unicodedata
from typing import Any, Iterable, Optional

# Umbrales de negocio. Viven aquí para que servidor y navegador citen la misma
# fuente: el navegador los recibe en la respuesta y no los vuelve a inventar.
CONFIANZA_ACEPTAR = 0.85   # >= : se dobla sin preguntar
CONFIANZA_PREGUNTAR = 0.60  # entre ambos: se pide confirmación al usuario
                            # < CONFIANZA_PREGUNTAR: se rechaza

# Palabras muy frecuentes y poco compartidas entre los dos idiomas. No busca ser
# un identificador universal: solo separar inglés de español con pocas palabras.
_PALABRAS_EN = frozenset("""
the of and to in is that it for you was with on as are this have be at they
but not from or by we can what all your there their has will would about when
been if more which who them then than could should into our out how did does
because were his her him she he
""".split())

_PALABRAS_ES = frozenset("""
de la que el en los se del las un por con no una su para es al lo como más pero
sus le ya este cuando muy sin sobre también me hasta hay donde quien desde todo
nos durante todos uno les ni contra otros ese eso ante ellos esto mí antes algunos
qué unos yo otro otras otra tanto esa estos mucho quienes nada muchos cual sea
poco ella estar estas algunas algo nosotros
""".split())

# Marcas ortográficas que solo aparecen en uno de los dos idiomas.
_RE_SOLO_ES = re.compile(r"[ñ¿¡]|(?<=[a-z])[áéíóú]", re.IGNORECASE)
_RE_SOLO_EN = re.compile(r"\b\w+'(?:s|t|re|ve|ll|d|m)\b", re.IGNORECASE)
_RE_PALABRA = re.compile(r"[a-záéíóúüñ]+", re.IGNORECASE)

# Cuánto demuestra cada señal sobre el idioma del AUDIO (no del texto).
PESOS_FUENTE = {
    # YouTube declara el idioma del audio del video: es la señal más directa.
    "audio_declarado": 0.97,
    # Los subtítulos automáticos los genera YouTube escuchando el audio, así que
    # su idioma es el idioma hablado.
    "pista_automatica": 0.92,
    # Léxico medido sobre un texto que salió del audio (ASR): casi tan bueno.
    "lexico_asr": 0.90,
    # Léxico sobre un texto que podría ser una traducción hecha por humanos.
    "lexico": 0.72,
    # Una pista manual puede estar en cualquier idioma, incluso traducida.
    "pista_manual": 0.55,
    # Un proveedor externo nos dice el idioma del texto que entregó.
    "proveedor": 0.62,
}

NOMBRES_IDIOMA = {
    "en": "inglés", "es": "español", "pt": "portugués", "fr": "francés",
    "de": "alemán", "it": "italiano", "ja": "japonés", "ko": "coreano",
    "zh": "chino", "ru": "ruso", "ar": "árabe", "hi": "hindi", "nl": "neerlandés",
    "tr": "turco", "pl": "polaco", "id": "indonesio", "vi": "vietnamita",
}


def nombre_idioma(codigo: str) -> str:
    corto = codigo_corto(codigo)
    return NOMBRES_IDIOMA.get(corto, corto or "desconocido")


def codigo_corto(codigo: Any) -> str:
    """`en-US` → `en`. Tolera None y objetos raros sin reventar."""
    texto = str(codigo or "").strip().lower()
    if not texto:
        return ""
    return re.split(r"[-_]", texto)[0]


def _sin_marcas(texto: str) -> str:
    """Quita tildes para comparar contra las listas de palabras."""
    descompuesto = unicodedata.normalize("NFD", texto)
    return "".join(c for c in descompuesto if unicodedata.category(c) != "Mn")


def analizar_lexico(texto: str, max_chars: int = 6000) -> dict:
    """Estima el idioma del texto contando palabras muy comunes.

    Devuelve ``{"idioma", "confianza", "palabras", "densidad"}``. La confianza
    sube con tres cosas: cuánta ventaja saca el ganador, qué tan densas son sus
    palabras comunes y cuánto texto hubo para mirar. Con poco texto nunca pasa
    de media, porque con veinte palabras no se puede afirmar nada.
    """
    muestra = str(texto or "")[:max_chars]
    if not muestra.strip():
        return {"idioma": "", "confianza": 0.0, "palabras": 0, "densidad": 0.0}

    palabras = _RE_PALABRA.findall(muestra.lower())
    total = len(palabras)
    if not total:
        return {"idioma": "", "confianza": 0.0, "palabras": 0, "densidad": 0.0}

    planas = [_sin_marcas(p) for p in palabras]
    aciertos_en = sum(1 for p in planas if p in _PALABRAS_EN)
    aciertos_es = sum(1 for p in planas if p in _PALABRAS_ES)

    # Las marcas exclusivas valen como varias palabras: «ñ» o «¿» no aparecen
    # por accidente en inglés, ni «don't» en español.
    aciertos_es += min(12, len(_RE_SOLO_ES.findall(muestra)) * 3)
    aciertos_en += min(12, len(_RE_SOLO_EN.findall(muestra)) * 3)

    if aciertos_en == aciertos_es:
        return {"idioma": "", "confianza": 0.0, "palabras": total, "densidad": 0.0}

    gana_ingles = aciertos_en > aciertos_es
    idioma = "en" if gana_ingles else "es"
    mayor, menor = (aciertos_en, aciertos_es) if gana_ingles else (aciertos_es, aciertos_en)

    margen = (mayor - menor) / (mayor + menor)          # 0 = empate, 1 = limpio
    densidad = mayor / total                            # ~0.20 en habla normal
    factor_densidad = min(1.0, densidad / 0.12)
    factor_muestra = min(1.0, total / 80)               # 80 palabras ya bastan

    confianza = margen * factor_densidad * factor_muestra
    # Solo con léxico nunca se afirma al 100 %: siempre queda margen de error.
    confianza = max(0.0, min(0.95, round(confianza, 3)))
    return {
        "idioma": idioma,
        "confianza": confianza,
        "palabras": total,
        "densidad": round(densidad, 3),
    }


def senal(fuente: str, idioma: Any, confianza: Optional[float] = None, detalle: str = "") -> dict:
    """Construye una señal ya normalizada. `confianza=None` usa el peso base."""
    corto = codigo_corto(idioma)
    if not corto:
        return {}
    base = PESOS_FUENTE.get(fuente, 0.5)
    valor = base if confianza is None else min(base, max(0.0, float(confianza)))
    return {"fuente": fuente, "idioma": corto, "confianza": round(valor, 3), "detalle": detalle}


def combinar(senales: Iterable[dict]) -> dict:
    """Funde las señales en un veredicto único sobre el idioma del audio.

    Gana la señal más fuerte. Si otra señal apunta a un idioma distinto, la
    confianza baja en proporción a lo fuerte que sea esa contradicción: dos
    fuentes que se contradicen no pueden dar un resultado tan seguro como dos
    que coinciden.
    """
    validas = [s for s in senales if s and s.get("idioma")]
    if not validas:
        return {
            "idioma": "",
            "confianza": 0.0,
            "evidencia": [],
            "conflicto": False,
        }

    mejor = max(validas, key=lambda s: s["confianza"])
    idioma = mejor["idioma"]
    a_favor = [s for s in validas if s["idioma"] == idioma]
    en_contra = [s for s in validas if s["idioma"] != idioma]

    confianza = mejor["confianza"]
    # Una segunda señal independiente que coincide recorta parte de la duda que
    # quedaba, sin llegar nunca a la certeza absoluta.
    for extra in sorted((s["confianza"] for s in a_favor), reverse=True)[1:]:
        confianza += (1.0 - confianza) * extra * 0.45
    if en_contra:
        contraria = max(s["confianza"] for s in en_contra)
        confianza -= contraria * 0.6

    return {
        "idioma": idioma,
        "confianza": max(0.0, min(0.99, round(confianza, 3))),
        "evidencia": sorted(validas, key=lambda s: -s["confianza"]),
        "conflicto": bool(en_contra),
    }


def detectar(
    texto: str = "",
    *,
    idioma_pista: Any = "",
    pista_automatica: Optional[bool] = None,
    audio_declarado: Any = "",
    idioma_proveedor: Any = "",
) -> dict:
    """Punto de entrada único: junta lo que se sepa y devuelve el veredicto.

    Args:
        texto: transcripción obtenida (se analiza su léxico).
        idioma_pista: código de la pista de subtítulos usada.
        pista_automatica: True si esa pista la generó YouTube desde el audio.
        audio_declarado: `defaultAudioLanguage` del video, si se pudo leer.
        idioma_proveedor: idioma que declara un proveedor externo (Supadata).
    """
    lexico = analizar_lexico(texto)
    senales = []

    if audio_declarado:
        senales.append(senal("audio_declarado", audio_declarado, detalle="idioma de audio declarado por YouTube"))

    if idioma_pista:
        if pista_automatica is True:
            senales.append(senal("pista_automatica", idioma_pista, detalle="subtítulos generados desde el audio"))
        elif pista_automatica is False:
            senales.append(senal("pista_manual", idioma_pista, detalle="subtítulos escritos a mano (pueden ser traducción)"))
        else:
            senales.append(senal("proveedor", idioma_pista, detalle="idioma declarado por la pista"))

    if idioma_proveedor:
        senales.append(senal("proveedor", idioma_proveedor, detalle="idioma declarado por el proveedor"))

    if lexico["idioma"]:
        # Si el texto vino del audio, su léxico habla del audio. Si vino de una
        # pista escrita a mano, solo habla del texto.
        fuente = "lexico_asr" if pista_automatica is True else "lexico"
        senales.append(senal(
            fuente,
            lexico["idioma"],
            lexico["confianza"],
            detalle=f"{lexico['palabras']} palabras analizadas",
        ))

    veredicto = combinar(senales)
    veredicto["lexico"] = lexico
    return veredicto


def resumen_para_respuesta(veredicto: dict) -> dict:
    """Los campos que viajan al navegador, con nombres estables."""
    idioma = veredicto.get("idioma") or ""
    confianza = float(veredicto.get("confianza") or 0.0)
    return {
        "audio_language": idioma,
        "audio_language_name": nombre_idioma(idioma) if idioma else "",
        "audio_language_confidence": round(confianza, 3),
        "audio_language_evidence": [
            {"fuente": s["fuente"], "idioma": s["idioma"], "confianza": s["confianza"], "detalle": s["detalle"]}
            for s in veredicto.get("evidencia") or []
        ],
        "audio_language_conflict": bool(veredicto.get("conflicto")),
        "audio_language_thresholds": {
            "aceptar": CONFIANZA_ACEPTAR,
            "preguntar": CONFIANZA_PREGUNTAR,
        },
    }
