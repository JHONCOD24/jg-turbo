"""Controles deterministas para ASR, traducción, pulido y corrección.

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
    re.compile(r"subt[íi]tulos? (realizados|creados) por", re.IGNORECASE),
    re.compile(r"gracias por ver (el|este) v[íi]deo", re.IGNORECASE),
    re.compile(r"thanks? for watching", re.IGNORECASE),
    re.compile(r"please (like and )?subscribe", re.IGNORECASE),
    re.compile(r"no olvides? suscribirte", re.IGNORECASE),
]
_RE_NUMERO = re.compile(r"(?<!\w)[+-]?\d[\d.,]*\s?%?(?!\w)")
_RE_URL = re.compile(r"https?://[^\s<>\"]+|www\.[^\s<>\"]+", re.IGNORECASE)
_RE_EMAIL = re.compile(r"\b[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}\b")
_RE_TECNICO = re.compile(
    r"\b(?:[A-ZÁÉÍÓÚÑ]{2,}[A-ZÁÉÍÓÚÑ0-9.-]*|"
    r"[A-Za-zÁÉÍÓÚÑáéíóúñ]+(?:\.[A-Za-z0-9]+)+|"
    r"[A-Za-zÁÉÍÓÚÑáéíóúñ]+[A-Z][A-Za-z0-9]*)\b"
)

# Groq/Whisper limitan el prompt a 224 tokens; 850 caracteres dejan margen.
LIMITE_PROMPT_ASR = 850

# El campo `prompt` de Whisper NO es una instrucción: es texto previo simulado
# del que el modelo copia estilo y vocabulario. Por eso va primero el glosario
# (lo que de verdad queremos que "recuerde" cómo se escribe) y después una frase
# corta de muestra en el MISMO idioma del audio. Nunca mezclamos idiomas: una
# etiqueta en inglés dentro de un audio en español empuja al modelo al inglés.
_MUESTRA_ASR = {
    "es": (
        "Transcripción en español con puntuación completa, tildes correctas "
        "y los nombres propios en mayúscula."
    ),
    "en": (
        "English transcript with full punctuation, correct capitalization "
        "and proper names spelled out."
    ),
    "pt": (
        "Transcrição em português com pontuação completa, acentuação correta "
        "e nomes próprios em maiúscula."
    ),
    "fr": (
        "Transcription en français avec ponctuation complète, accents corrects "
        "et noms propres en majuscule."
    ),
    "it": (
        "Trascrizione in italiano con punteggiatura completa, accenti corretti "
        "e nomi propri in maiuscolo."
    ),
    "de": (
        "Deutsche Transkription mit vollständiger Zeichensetzung, korrekten "
        "Umlauten und großgeschriebenen Eigennamen."
    ),
}
_ETIQUETA_GLOSARIO_ASR = {
    "es": "Términos frecuentes: ",
    "en": "Frequent terms: ",
    "pt": "Termos frequentes: ",
    "fr": "Termes fréquents : ",
    "it": "Termini frequenti: ",
    "de": "Häufige Begriffe: ",
}


def construir_prompt_asr(idioma: str, glosario: str = "") -> str:
    """Contexto previo (no instrucciones) para Whisper, en el idioma del audio.

    Devuelve el glosario primero y una muestra de estilo después, ambos en el
    idioma detectado. Si no sabemos el idioma, solo enviamos los términos: así
    no se contamina el audio con palabras de otro idioma.
    """
    lang = (idioma or "auto").split("-")[0].lower()
    muestra = _MUESTRA_ASR.get(lang, "")
    etiqueta = _ETIQUETA_GLOSARIO_ASR.get(lang, "")

    terminos = [t.strip() for t in re.split(r"[\n,;]+", glosario or "") if t.strip()]
    # Sin duplicados y sin perder el orden en el que los escribió la persona.
    vistos = set()
    unicos = []
    for termino in terminos:
        clave = termino.casefold()
        if clave not in vistos:
            vistos.add(clave)
            unicos.append(termino)

    presupuesto = LIMITE_PROMPT_ASR - len(muestra) - len(etiqueta) - 2
    seleccion = []
    usado = 0
    for termino in unicos[:60]:
        extra = len(termino) + (2 if seleccion else 0)
        if usado + extra > max(0, presupuesto):
            break
        seleccion.append(termino)
        usado += extra

    partes = []
    if seleccion:
        partes.append(f"{etiqueta}{', '.join(seleccion)}." if etiqueta else ", ".join(seleccion) + ".")
    if muestra:
        partes.append(muestra)
    return " ".join(partes)[:LIMITE_PROMPT_ASR].strip()


def _confianza_segmento(segmento: dict) -> float:
    logprob = float(segmento.get("avg_logprob", -0.3) or -0.3)
    confianza = (logprob + 1.5) / 1.4
    return round(max(0.0, min(1.0, confianza)), 3)


def clasificar_segmento_asr(segmento: dict) -> str:
    """Clasifica un segmento: 'vacio' | 'patron' | 'metrica' | 'ok'.

    Un segmento vacío NO es una alucinación: simplemente no aporta texto. Antes
    se contaba como alucinación y disparaba la advertencia en audios perfectos.
    """
    texto = str(segmento.get("text") or "").strip()
    if not texto:
        return "vacio"
    if any(p.search(texto) for p in _PATRONES_ALUCINACION_ASR):
        return "patron"
    no_voz = float(segmento.get("no_speech_prob", 0.0) or 0.0)
    logprob = float(segmento.get("avg_logprob", 0.0) or 0.0)
    compresion = float(segmento.get("compression_ratio", 1.0) or 1.0)
    if no_voz > 0.72 and logprob < -1.0:
        return "metrica"
    if compresion > 2.6 and logprob < -0.7:
        return "metrica"
    return "ok"


def _es_alucinacion_asr(segmento: dict) -> bool:
    """Compatibilidad: True solo si hay basura real (no por segmento vacío)."""
    return clasificar_segmento_asr(segmento) in {"patron", "metrica"}


def analizar_segmentos_asr(
    texto_total: str,
    segmentos: Iterable[dict],
    limpiar_texto: Optional[Callable[[str], str]] = None,
) -> dict:
    """Conserva voz útil, elimina basura inequívoca y marca zonas ambiguas."""
    limpiar = limpiar_texto or (lambda valor: valor.strip())
    segmentos_utiles = []
    retirados = 0
    retirados_patron = 0
    vacios = 0
    dudosos = 0
    total_entrada = 0

    for original in segmentos or []:
        total_entrada += 1
        segmento = dict(original)
        clase = clasificar_segmento_asr(segmento)
        if clase == "vacio":
            vacios += 1
            continue
        if clase in {"patron", "metrica"}:
            retirados += 1
            if clase == "patron":
                retirados_patron += 1
            continue
        texto = limpiar(str(segmento.get("text") or ""))
        if not texto:
            vacios += 1
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
    total = len(segmentos_utiles)
    aviso = None
    todo_filtrado = False

    if not texto:
        todo_filtrado = total_entrada > 0 and retirados > 0
        if todo_filtrado and retirados_patron >= max(1, retirados):
            # Todo lo que dijo el modelo son frases inventadas conocidas
            # («Subtítulos por Amara.org»): devolverlas sería mentirle al usuario.
            texto = ""
            aviso = (
                "No se detectó voz utilizable: todo el audio produjo frases que Whisper "
                "suele inventar sobre silencio o música. Revisa el archivo o graba de nuevo."
            )
        else:
            texto = limpiar(texto_total or "")
            if todo_filtrado:
                aviso = (
                    "Todos los fragmentos salieron con baja calidad. Se muestra la "
                    "transcripción sin filtrar: revísala antes de usarla."
                )

    proporcion_dudosa = dudosos / total if total else 0.0
    proporcion_retirada = retirados / total_entrada if total_entrada else 0.0
    requiere_confirmacion = (
        retirados_patron > 0 or proporcion_retirada > 0.25 or proporcion_dudosa > 0.35
    )
    # Antes bastaba UN segmento dudoso para gritar "audio poco claro" y la gente
    # aprendió a ignorar el aviso. Ahora exige proporción o alucinación explícita.
    necesita_revision = bool(
        retirados_patron > 0
        or todo_filtrado
        or proporcion_retirada > 0.15
        or proporcion_dudosa > 0.25
    )

    resultado = {
        "text": texto,
        "segments": segmentos_utiles,
        "low_confidence_segments": dudosos,
        "removed_hallucinations": retirados,
        "needs_review": necesita_revision,
        "requires_confirmation": requiere_confirmacion,
        "review_segments": [s for s in segmentos_utiles if s["low_confidence"]],
        # Campos nuevos (aditivos): la UI puede ignorarlos sin romperse.
        "empty_segments": vacios,
        "hallucination_patterns": retirados_patron,
        "all_segments_filtered": todo_filtrado,
    }
    if aviso:
        resultado["aviso"] = aviso
    return resultado


def _normalizar_numero(valor: str) -> str:
    return re.sub(r"[\s.,]", "", valor).casefold()


def _contador(texto: str, patron: re.Pattern, normalizar=str.casefold) -> Counter:
    return Counter(normalizar(m.group(0).rstrip(".,;:!?")) for m in patron.finditer(texto))


def _faltantes(origen: Counter, destino: Counter) -> list[str]:
    resultado = []
    for valor, cantidad in (origen - destino).items():
        resultado.extend([valor] * cantidad)
    return resultado


def _huella_digitos(texto: str) -> str:
    """Todos los dígitos del texto, en orden y sin nada más.

    Sirve para preguntar «¿estas cifras ya estaban?» sin exigir que aparezcan
    con el mismo formato.
    """
    return re.sub(r"\D+", "", texto or "")


# Números escritos con palabras. Traducir los reformula constantemente
# («16 milliseconds» → «dieciséis milisegundos», «twenty» → «20»), y sin esto
# el validador lo denunciaba como cifra perdida.
_NUMEROS_EN_PALABRAS = {
    "0": ("zero", "cero"), "1": ("one", "uno", "una", "un"), "2": ("two", "dos"),
    "3": ("three", "tres"), "4": ("four", "cuatro"), "5": ("five", "cinco"),
    "6": ("six", "seis"), "7": ("seven", "siete"), "8": ("eight", "ocho"),
    "9": ("nine", "nueve"), "10": ("ten", "diez"), "11": ("eleven", "once"),
    "12": ("twelve", "doce"), "13": ("thirteen", "trece"), "14": ("fourteen", "catorce"),
    "15": ("fifteen", "quince"), "16": ("sixteen", "dieciséis", "dieciseis"),
    "17": ("seventeen", "diecisiete"), "18": ("eighteen", "dieciocho"),
    "19": ("nineteen", "diecinueve"), "20": ("twenty", "veinte"),
    "30": ("thirty", "treinta"), "40": ("forty", "cuarenta"), "50": ("fifty", "cincuenta"),
    "60": ("sixty", "sesenta"), "70": ("seventy", "setenta"), "80": ("eighty", "ochenta"),
    "90": ("ninety", "noventa"), "100": ("hundred", "cien", "ciento"),
    "1000": ("thousand", "mil"), "1000000": ("million", "millón", "millon", "millones"),
}


def _cifra_escrita_en_palabras(cifra: str, texto_plano: str) -> bool:
    """¿La cifra aparece escrita con letras en el otro texto?"""
    for palabra in _NUMEROS_EN_PALABRAS.get(cifra, ()):
        if re.search(rf"\b{re.escape(palabra)}\b", texto_plano):
            return True
    return False


def _cifras_sin_respaldo(candidatos: list[str], huella_otro_lado: str) -> list[str]:
    """Filtra las diferencias de cifras que en realidad son legítimas.

    Traducir reformula los números todo el tiempo y los subtítulos vienen
    partidos por saltos de línea. Dos casos reales medidos el 2026-08-01:

    - «every 16.\\n\\n6\\nmilliseconds» (un `16.6` roto por el subtítulo) se leía
      como dos cifras, y la traducción correcta «16.6» parecía inventada.
    - «in the 1930s» → «en los años 30»: el `30` parecía inventado porque la
      cifra original iba pegada a una letra.

    Por eso una cifra solo se denuncia si sus dígitos **no aparecen** en el otro
    texto. Si la IA se inventa un «45 %» que no existía, sigue saltando.
    """
    return [c for c in candidatos if _huella_digitos(c) not in huella_otro_lado]


def _cifras_realmente_perdidas(candidatos: list[str], huella: str, texto_otro: str) -> list[str]:
    """Cifras que no están ni como dígitos ni escritas con palabras."""
    plano = (texto_otro or "").casefold()
    return [
        c for c in _cifras_sin_respaldo(candidatos, huella)
        if not _cifra_escrita_en_palabras(c, plano)
    ]


# Siglas que cambian legítimamente al traducir. Sin esto, una traducción
# impecable («ADHD» → «TDAH») se denunciaba como término técnico perdido.
_SIGLAS_EQUIVALENTES = {
    "adhd": {"tdah"}, "tdah": {"adhd"},
    "us": {"eeuu", "ee.uu", "ee.uu.", "eua"}, "usa": {"eeuu", "ee.uu", "ee.uu.", "eua"},
    "un": {"onu"}, "onu": {"un"},
    "who": {"oms"}, "oms": {"who"},
    "hiv": {"vih"}, "vih": {"hiv"},
    "ai": {"ia"}, "ia": {"ai"},
    "eu": {"ue"}, "ue": {"eu"},
    "nato": {"otan"}, "otan": {"nato"},
    "ceo": {"director", "consejero"},
    "phd": {"doctorado", "doctor"},
    "ui": {"interfaz"}, "uis": {"interfaces", "interfaz"},
    "id": {"identificacion", "identificador"},
}

# Siglas de dos letras: demasiadas son palabras corrientes en mayúsculas
# («IS», «OK», «MA», «BA», «US»). Denunciarlas generaba puro ruido.
_LARGO_MINIMO_SIGLA = 3


def _termino_tiene_equivalente(termino: str, texto_otro_plano: str) -> bool:
    for equivalente in _SIGLAS_EQUIVALENTES.get(termino, ()):
        if equivalente in texto_otro_plano:
            return True
    return False


def _terminos_realmente_perdidos(origen: str, salida: str) -> list[str]:
    """Términos técnicos que desaparecieron de verdad al traducir.

    Tres reglas, todas nacidas de falsos positivos medidos el 2026-08-01:

    1. **Presencia, no cantidad.** Que `console.log` salga 4 veces en vez de 2 no
       es un error; solo importa si desaparece del todo.
    2. **Nada de siglas de dos letras.** `IS`, `OK`, `MA`, `BA`, `US`, `UI` son
       palabras normales en mayúsculas, no términos técnicos.
    3. **Siglas equivalentes.** `ADHD` → `TDAH` y `US` → `EE. UU.` son
       traducciones correctas, no pérdidas.
    """
    en_origen = {t.casefold() for t in _RE_TECNICO.findall(origen)}
    en_salida = {t.casefold() for t in _RE_TECNICO.findall(salida)}
    plano_salida = (salida or "").casefold()
    perdidos = []
    for termino in en_origen - en_salida:
        limpio = termino.strip(".")
        if len(limpio.replace(".", "")) < _LARGO_MINIMO_SIGLA:
            continue
        if _termino_tiene_equivalente(limpio, plano_salida):
            continue
        # Puede seguir ahí con otra forma («Node.js» dentro de una frase).
        if limpio in plano_salida:
            continue
        perdidos.append(termino)
    return sorted(perdidos)


def _listar(elementos: list[str], maximo: int = 3) -> str:
    """«16, 782 y 1 más» — decir QUÉ falta es lo que hace útil el aviso."""
    unicos = list(dict.fromkeys(elementos))
    if not unicos:
        return ""
    if len(unicos) <= maximo:
        return ", ".join(unicos)
    return ", ".join(unicos[:maximo]) + f" y {len(unicos) - maximo} más"


# Umbrales de longitud por tipo de transformación. Pulir puede acortar (quita
# muletillas); corregir casi no debería cambiar el largo; traducir varía más.
_UMBRALES_LONGITUD = {
    "traduccion": {"min_critico": 0.48, "max_critico": 2.15, "min_ok": 0.62, "max_ok": 1.75},
    "pulido": {"min_critico": 0.55, "max_critico": 1.60, "min_ok": 0.72, "max_ok": 1.30},
    "correccion": {"min_critico": 0.78, "max_critico": 1.35, "min_ok": 0.90, "max_ok": 1.12},
}
_MENSAJES_MODO = {
    "traduccion": {
        "vacio": "El servicio devolvió una traducción vacía.",
        "corto": "La traducción es demasiado corta y puede omitir información.",
        "largo": "La traducción creció demasiado y puede incluir información nueva.",
    },
    "pulido": {
        "vacio": "El servicio devolvió un texto vacío.",
        "corto": "El texto pulido es mucho más corto: puede haberse cortado o resumido.",
        "largo": "El texto pulido creció demasiado: puede incluir frases inventadas.",
    },
    "correccion": {
        "vacio": "El servicio devolvió un texto vacío.",
        "corto": "El texto corregido es más corto que el original: pudo perderse contenido.",
        "largo": "El texto corregido creció demasiado: puede incluir frases inventadas.",
    },
}


def validar_texto_transformado(
    origen: str,
    salida: str,
    modo: str = "traduccion",
    idioma_origen: str = "",
    idioma_destino: str = "",
) -> dict:
    """Valida invariantes (cifras, URLs, correos, términos, párrafos, longitud).

    Sirve para traducir, pulir y corregir: solo cambian los umbrales de longitud
    y los mensajes. No le pide a la IA que se juzgue a sí misma.
    """
    modo = modo if modo in _UMBRALES_LONGITUD else "traduccion"
    umbrales = _UMBRALES_LONGITUD[modo]
    mensajes = _MENSAJES_MODO[modo]

    origen = (origen or "").strip()
    salida = (salida or "").strip()
    problemas = []

    def agregar(codigo: str, severidad: str, mensaje: str):
        problemas.append({"code": codigo, "severity": severidad, "message": mensaje})

    if not salida:
        agregar("empty_translation", "critical", mensajes["vacio"])

    palabras_origen = re.findall(r"\b[\w'-]+\b", origen, re.UNICODE)
    palabras_destino = re.findall(r"\b[\w'-]+\b", salida, re.UNICODE)
    razon_longitud = len(palabras_destino) / max(1, len(palabras_origen))
    if len(palabras_origen) >= 8 and razon_longitud < umbrales["min_critico"]:
        agregar("possible_omission", "critical", mensajes["corto"])
    elif len(palabras_origen) >= 8 and razon_longitud > umbrales["max_critico"]:
        agregar("possible_invention", "critical", mensajes["largo"])
    elif len(palabras_origen) >= 8 and not umbrales["min_ok"] <= razon_longitud <= umbrales["max_ok"]:
        agregar("length_warning", "warning", "La longitud cambió más de lo esperado; conviene revisar el resultado.")

    if (
        modo == "traduccion"
        and idioma_origen != idioma_destino
        and len(palabras_origen) >= 5
        and re.sub(r"\W+", "", origen).casefold() == re.sub(r"\W+", "", salida).casefold()
    ):
        agregar("unchanged", "critical", "El texto no cambió aunque los idiomas son diferentes.")

    numeros_origen = _contador(origen, _RE_NUMERO, _normalizar_numero)
    numeros_destino = _contador(salida, _RE_NUMERO, _normalizar_numero)
    huella_origen = _huella_digitos(origen)
    huella_salida = _huella_digitos(salida)
    faltan_cifras = _cifras_realmente_perdidas(
        _faltantes(numeros_origen, numeros_destino), huella_salida, salida
    )
    sobran_cifras = _cifras_realmente_perdidas(
        _faltantes(numeros_destino, numeros_origen), huella_origen, origen
    )
    if faltan_cifras:
        agregar("missing_numbers", "critical", f"Falta la cifra {_listar(faltan_cifras)}.")
    if sobran_cifras:
        agregar("invented_numbers", "critical", f"Aparece la cifra {_listar(sobran_cifras)}, que no está en el original.")

    for codigo, patron, etiqueta in (
        ("urls", _RE_URL, "URL"),
        ("emails", _RE_EMAIL, "correos"),
    ):
        faltan = _faltantes(_contador(origen, patron), _contador(salida, patron))
        sobran = _faltantes(_contador(salida, patron), _contador(origen, patron))
        if faltan:
            agregar(f"missing_{codigo}", "critical", f"Faltan {etiqueta} presentes en el texto original.")
        if sobran:
            agregar(f"invented_{codigo}", "critical", f"Aparecieron {etiqueta} que no existen en el original.")

    terminos_perdidos = _terminos_realmente_perdidos(origen, salida)
    if terminos_perdidos:
        agregar(
            "technical_terms", "warning",
            f"No aparece en la traducción: {_listar(terminos_perdidos)}.",
        )

    # Traducir reagrupa los párrafos casi siempre, y una transcripción de vídeo
    # llega con saltos de línea del subtítulo, no del texto. Solo avisamos si la
    # estructura se pierde de forma grosera (la mitad o menos de los párrafos).
    parrafos_origen = [p for p in re.split(r"\n\s*\n", origen) if p.strip()]
    parrafos_destino = [p for p in re.split(r"\n\s*\n", salida) if p.strip()]
    if len(parrafos_origen) > 3 and len(parrafos_destino) * 2 <= len(parrafos_origen):
        agregar("paragraphs", "warning", "El resultado juntó los párrafos del original.")

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
        "mode": modo,
        "method": "deterministic-invariants-v1",
    }


def validar_traduccion(origen: str, traduccion: str, idioma_origen: str, idioma_destino: str) -> dict:
    """Compatibilidad: misma firma y mismo comportamiento de siempre."""
    return validar_texto_transformado(
        origen, traduccion, "traduccion", idioma_origen, idioma_destino
    )
