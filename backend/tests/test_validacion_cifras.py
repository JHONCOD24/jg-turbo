"""El validador de traducción no puede dar falsas alarmas.

Cuando marca `critical`, la app pone `requires_confirmation` y le pregunta al
usuario «¿quieres usar esta traducción de todos modos?» mostrando
«Integridad 6/100». Si eso pasa con una traducción correcta, el usuario cree
que la app falló — que es justo lo que reportó.

Los dos casos de `datos/traduccion_falsas_alarmas.json` son texto real
capturado de producción el 2026-08-01 traduciendo una charla de YouTube.
"""

import json
import sys
from pathlib import Path

import pytest

APP_ROOT = Path(__file__).resolve().parents[2]
if str(APP_ROOT) not in sys.path:
    sys.path.insert(0, str(APP_ROOT))

from api.calidad_linguistica import validar_traduccion  # noqa: E402

DATOS = json.loads(
    (Path(__file__).parent / "datos" / "traduccion_falsas_alarmas.json").read_text(encoding="utf-8")
)


def _codigos(validacion):
    return {p["code"] for p in validacion["issues"]}


@pytest.mark.parametrize("caso", sorted(DATOS))
def test_una_traduccion_correcta_no_se_marca_como_anomalia(caso):
    datos = DATOS[caso]
    v = validar_traduccion(datos["origen"], datos["traduccion"], "en", "es")

    assert "invented_numbers" not in _codigos(v), f"{caso}: acusa de inventar cifras"
    assert "missing_numbers" not in _codigos(v), f"{caso}: acusa de perder cifras"
    assert not v["requires_confirmation"], f"{caso}: interrumpe al usuario sin motivo"
    assert v["status"] != "alert", f"{caso}: marcado como anomalía (score {v['integrity_score']})"


def test_el_numero_partido_por_el_subtitulo_no_es_invencion():
    """«every 16.\\n\\n6\\nmilliseconds» traducido a «16.6 milisegundos» está bien."""
    origen = "We repaint the screen every 16.\n\n6\nmilliseconds, 60 frames a second."
    traduccion = "Repintamos la pantalla cada 16.6 milisegundos, 60 fotogramas por segundo."
    v = validar_traduccion(origen, traduccion, "en", "es")
    assert "invented_numbers" not in _codigos(v)
    assert "missing_numbers" not in _codigos(v)


def test_la_decada_reformulada_no_es_invencion():
    """«in the 1930s» → «en los años 30» es una traducción correcta."""
    v = validar_traduccion(
        "This happened in the 1930s, long before anyone knew.",
        "Esto pasó en los años 30, mucho antes de que nadie lo supiera.",
        "en", "es",
    )
    assert "invented_numbers" not in _codigos(v)


def test_una_cifra_de_verdad_inventada_sigue_saltando():
    """La red de seguridad tiene que seguir funcionando: esto es lo que protege."""
    v = validar_traduccion(
        "The company grew a lot last year and hired many people.",
        "La empresa creció un 45 % el año pasado y contrató a 300 personas.",
        "en", "es",
    )
    assert "invented_numbers" in _codigos(v)
    assert v["requires_confirmation"]


def test_una_cifra_de_verdad_perdida_sigue_saltando():
    v = validar_traduccion(
        "We measured exactly 782 cases during the study.",
        "Medimos muchos casos durante el estudio.",
        "en", "es",
    )
    assert "missing_numbers" in _codigos(v)


# ── Ruido eliminado (todos medidos sobre traducciones correctas) ──────────────

@pytest.mark.parametrize(
    "origen,traduccion,motivo",
    [
        ("He was diagnosed with ADHD as a child.",
         "Le diagnosticaron TDAH de niño.",
         "ADHD → TDAH es la traducción correcta de la sigla"),
        ("She moved to the US in the nineties.",
         "Se mudó a EE. UU. en los noventa.",
         "US → EE. UU. es correcto"),
        ("The UN published the report.",
         "La ONU publicó el informe.",
         "UN → ONU es correcto"),
        ("It is OK, that IS the point.",
         "Está bien, ese es el punto.",
         "OK e IS son palabras corrientes, no siglas"),
        ("We repaint every 16 milliseconds.",
         "Repintamos cada dieciséis milisegundos.",
         "la cifra pasó a palabras, no se perdió"),
        ("It took twenty years to finish.",
         "Tardó 20 años en terminarse.",
         "la palabra pasó a cifra, no se inventó"),
        ("Call console.log twice. Then call console.log again to check.",
         "Llama a console.log. Llama a console.log. Y a console.log otra vez para comprobar.",
         "repetir un término más veces no es perderlo"),
    ],
)
def test_no_hay_aviso_en_traducciones_correctas(origen, traduccion, motivo):
    v = validar_traduccion(origen, traduccion, "en", "es")
    assert v["status"] == "ok", f"{motivo} · avisos: {[p['message'] for p in v['issues']]}"
    assert not v["requires_confirmation"]


# ── La red de seguridad tiene que seguir en pie ───────────────────────────────

def test_sigue_detectando_un_termino_tecnico_de_verdad_perdido():
    v = validar_traduccion(
        "The server runs on Node.js and talks to PostgreSQL every minute.",
        "El servidor se ejecuta y habla con la base de datos cada minuto.",
        "en", "es",
    )
    assert "technical_terms" in _codigos(v)


def test_sigue_detectando_un_texto_a_medias():
    v = validar_traduccion(
        "This is a long paragraph with plenty of content that must be translated "
        "completely, including every single one of its ideas and details.",
        "Esto es un párrafo.",
        "en", "es",
    )
    assert "possible_omission" in _codigos(v)
    assert v["status"] == "alert"


def test_sigue_detectando_texto_sin_traducir():
    frase = "The quick brown fox jumps over the lazy dog every morning."
    v = validar_traduccion(frase, frase, "en", "es")
    assert "unchanged" in _codigos(v)


def test_el_aviso_dice_que_cifra_falta():
    """«Faltan una o más cifras» no ayudaba a nadie a decidir."""
    v = validar_traduccion(
        "We measured exactly 782 cases during the study.",
        "Medimos muchos casos durante el estudio.",
        "en", "es",
    )
    mensaje = next(p["message"] for p in v["issues"] if p["code"] == "missing_numbers")
    assert "782" in mensaje, f"el aviso debe nombrar la cifra: {mensaje!r}"
