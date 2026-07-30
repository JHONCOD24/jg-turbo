"""Controles deterministas para ASR y traducción.

Este archivo se mantiene idéntico en ``api/`` y ``backend/`` para que la nube y
el servidor local apliquen las mismas reglas sin agregar dependencias.
"""

from __future__ import annotations

from collections import Counter
import re
from typing import Callable, Iterable, Optional


_PATRONES_ALUCINACION_ASR = [
    re.compile(r"subt[íi]tulos?\b.*\bamara\.org", re.IGNORECASE),
    re.compile(r"subtitles?\b.*\bamara\.org", re.IGNORECASE),
    re.compile(r"gracias por ver (el|este) v[íi]deo", re.IGNORECASE),
    re.compile(r"thanks? for watching", re.IGNORECASE),
    re.compile(r"please (like and )?subscribe", re.IGNORECASE),
]
_RE_NUMERO = re.compile(r"(?<!\w)[+-]?\d[\d.,]*\s?%?(?!\w)")
_RE_URL = re.compile(r"https?://[^\s<>\"]+|www\.[^\s<>\"]+", re.IGNORECASE)
_RE_EMAIL = re.compile(r"\b[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}\b")
_RE_TECNICO = re.compile(
    r"\b(?:[A-ZÁÉÍÓÚÑ]{2,}[A-ZÁÉÍÓÚÑ0-9.-]*|"
    r"[A-Za-zÁÉÍÓÚÑáéíóúñ]+(?:\.[A-Za-z0-9]+)+|"
    r"[A-Za-zÁÉÍÓÚÑáéíóúñ]+[A-Z][A-Za-z0-9]*)\b"
)


def construir_prompt_asr(idioma: str, glosario: str = "") -> str:
    """Crea contexto corto para Whisper respetando su límite de prompt."""
    lang = (idioma or "auto").split("-")[0].lower()
    if lang == "en":
        base = (
            "Accurate verbatim English transcription. Preserve proper names, "
            "technical terms, colloquial expressions, numbers, and acronyms."
        )
    elif lang == "es":
        base = (
            "Transcripción literal y precisa en español. Conserva nombres propios, "
            "términos técnicos, expresiones coloquiales, cifras y siglas."
        )
    else:
        base = (
            "Accurate verbatim transcription. Preserve proper names, technical "
            "terms, colloquial expressions, numbers, and acronyms."
        )

    terminos = [
        t.strip()
        for t in re.split(r"[\n,;]+", glosario or "")
        if t.strip()
    ][:45]
    if terminos:
        base += " Preferred spellings: " + ", ".join(terminos) + "."
    # Groq limita el prompt a 224 tokens; 850 caracteres dejan margen.
    return base[:850]


def _confianza_segmento(segmento: dict) -> float:
    logprob = float(segmento.get("avg_logprob", -0.3) or -0.3)
    confianza = (logprob + 1.5) / 1.4
    return round(max(0.0, min(1.0, confianza)), 3)


def _es_alucinacion_asr(segmento: dict) -> bool:
    texto = str(segmento.get("text") or "").strip()
    if not texto:
        return True
    no_voz = float(segmento.get("no_speech_prob", 0.0) or 0.0)
    logprob = float(segmento.get("avg_logprob", 0.0) or 0.0)
    compresion = float(segmento.get("compression_ratio", 1.0) or 1.0)
    if no_voz > 0.72 and logprob < -1.0:
        return True
    if compresion > 2.6 and logprob < -0.7:
        return True
    return any(p.search(texto) for p in _PATRONES_ALUCINACION_ASR)


def analizar_segmentos_asr(
    texto_total: str,
    segmentos: Iterable[dict],
    limpiar_texto: Optional[Callable[[str], str]] = None,
) -> dict:
    """Conserva voz útil, elimina basura inequívoca y marca zonas ambiguas."""
    limpiar = limpiar_texto or (lambda valor: valor.strip())
    segmentos_utiles = []
    retirados = 0
    dudosos = 0

    for original in segmentos or []:
        segmento = dict(original)
        if _es_alucinacion_asr(segmento):
            retirados += 1
            continue
        texto = limpiar(str(segmento.get("text") or ""))
        if not texto:
            continue
        confianza = _confianza_segmento(segmento)
        no_voz = float(segmento.get("no_speech_prob", 0.0) or 0.0)
        compresion = float(segmento.get("compression_ratio", 1.0) or 1.0)
        ambiguo = confianza < 0.42 or no_voz > 0.48 or compresion > 2.35
        if ambiguo:
            dudosos += 1
        segmentos_utiles.append({
            "start": round(float(segmento.get("start", 0.0) or 0.0), 2),
            "end": round(float(segmento.get("end", 0.0) or 0.0), 2),
            "text": texto,
            "confidence": confianza,
            "low_confidence": ambiguo,
        })

    texto = " ".join(s["text"] for s in segmentos_utiles).strip()
    if not texto:
        texto = limpiar(texto_total or "")
    total = len(segmentos_utiles)
    proporcion_dudosa = dudosos / total if total else 0.0
    requiere_confirmacion = retirados >= 2 or proporcion_dudosa > 0.35
    return {
        "text": texto,
        "segments": segmentos_utiles,
        "low_confidence_segments": dudosos,
        "removed_hallucinations": retirados,
        "needs_review": retirados > 0 or dudosos > 0,
        "requires_confirmation": requiere_confirmacion,
        "review_segments": [
            s for s in segmentos_utiles if s["low_confidence"]
        ],
    }


def _normalizar_numero(valor: str) -> str:
    return re.sub(r"[\s.,]", "", valor).casefold()


def _contador(texto: str, patron: re.Pattern, normalizar=str.casefold) -> Counter:
    return Counter(normalizar(m.group(0).rstrip(".,;:!?")) for m in patron.finditer(texto))


def _faltantes(origen: Counter, destino: Counter) -> list[str]:
    resultado = []
    for valor, cantidad in (origen - destino).items():
        resultado.extend([valor] * cantidad)
    return resultado


def validar_traduccion(origen: str, traduccion: str, idioma_origen: str, idioma_destino: str) -> dict:
    """Valida invariantes y estructura sin pedirle al traductor que se juzgue."""
    origen = (origen or "").strip()
    traduccion = (traduccion or "").strip()
    problemas = []

    def agregar(codigo: str, severidad: str, mensaje: str):
        problemas.append({"code": codigo, "severity": severidad, "message": mensaje})

    if not traduccion:
        agregar("empty_translation", "critical", "El servicio devolvió una traducción vacía.")

    palabras_origen = re.findall(r"\b[\w'-]+\b", origen, re.UNICODE)
    palabras_destino = re.findall(r"\b[\w'-]+\b", traduccion, re.UNICODE)
    razon_longitud = len(palabras_destino) / max(1, len(palabras_origen))
    if len(palabras_origen) >= 8 and razon_longitud < 0.48:
        agregar("possible_omission", "critical", "La traducción es demasiado corta y puede omitir información.")
    elif len(palabras_origen) >= 8 and razon_longitud > 2.15:
        agregar("possible_invention", "critical", "La traducción creció demasiado y puede incluir información nueva.")
    elif len(palabras_origen) >= 8 and not 0.62 <= razon_longitud <= 1.75:
        agregar("length_warning", "warning", "La longitud cambió más de lo esperado; conviene revisar el resultado.")

    if (
        idioma_origen != idioma_destino
        and len(palabras_origen) >= 5
        and re.sub(r"\W+", "", origen).casefold() == re.sub(r"\W+", "", traduccion).casefold()
    ):
        agregar("unchanged", "critical", "El texto no cambió aunque los idiomas son diferentes.")

    numeros_origen = _contador(origen, _RE_NUMERO, _normalizar_numero)
    numeros_destino = _contador(traduccion, _RE_NUMERO, _normalizar_numero)
    if _faltantes(numeros_origen, numeros_destino):
        agregar("missing_numbers", "critical", "Faltan una o más cifras del texto original.")
    if _faltantes(numeros_destino, numeros_origen):
        agregar("invented_numbers", "critical", "Aparecieron cifras que no existen en el texto original.")

    for codigo, patron, etiqueta in (
        ("urls", _RE_URL, "URL"),
        ("emails", _RE_EMAIL, "correos"),
    ):
        faltan = _faltantes(_contador(origen, patron), _contador(traduccion, patron))
        sobran = _faltantes(_contador(traduccion, patron), _contador(origen, patron))
        if faltan:
            agregar(f"missing_{codigo}", "critical", f"Faltan {etiqueta} presentes en el texto original.")
        if sobran:
            agregar(f"invented_{codigo}", "critical", f"Aparecieron {etiqueta} que no existen en el original.")

    tecnicos_origen = _contador(origen, _RE_TECNICO)
    tecnicos_destino = _contador(traduccion, _RE_TECNICO)
    if _faltantes(tecnicos_origen, tecnicos_destino):
        agregar("technical_terms", "warning", "Cambió o desapareció al menos un nombre o término técnico.")

    parrafos_origen = [p for p in re.split(r"\n\s*\n", origen) if p.strip()]
    parrafos_destino = [p for p in re.split(r"\n\s*\n", traduccion) if p.strip()]
    if len(parrafos_origen) > 1 and len(parrafos_origen) != len(parrafos_destino):
        agregar("paragraphs", "warning", "La traducción no conserva la estructura de párrafos.")

    criticos = sum(p["severity"] == "critical" for p in problemas)
    advertencias = sum(p["severity"] == "warning" for p in problemas)
    estado = "alert" if criticos else ("warning" if advertencias else "ok")
    puntuacion = max(0, 100 - criticos * 35 - advertencias * 12)
    return {
        "status": estado,
        "integrity_score": puntuacion,
        "requires_confirmation": criticos > 0,
        "issues": problemas,
        "checks": {
            "length_ratio": round(razon_longitud, 3),
            "numbers_preserved": not any(p["code"] in {"missing_numbers", "invented_numbers"} for p in problemas),
            "structure_preserved": not any(p["code"] == "paragraphs" for p in problemas),
        },
        "method": "deterministic-invariants-v1",
    }
