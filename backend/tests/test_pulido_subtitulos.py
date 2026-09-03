"""Limpieza de subtítulos y pulido por bloques.

Todo con dobles: ninguna prueba sale a la red ni llama a una IA real.
"""

import sys
from pathlib import Path

import pytest

# api/ vive junto a backend/
_APP_ROOT = Path(__file__).resolve().parents[2]
if str(_APP_ROOT) not in sys.path:
    sys.path.insert(0, str(_APP_ROOT))

from api import pulido  # noqa: E402
from api.subtitulos_limpieza import (  # noqa: E402
    cortar_por_palabras,
    limpiar_texto_subtitulos,
    parece_subtitulo_sin_puntuar,
    solape_de_texto,
    texto_desde_vtt,
    unir_cues,
)


# ── Solape del modo rodante ──────────────────────────────────────────────────

def test_unir_cues_quita_el_solape_rodante():
    """El caso real: cada cue repite la cola del anterior."""
    cues = [
        "hoy vamos a hablar de",
        "vamos a hablar de un tema",
        "de un tema que cambia todo",
        "que cambia todo y por eso",
    ]
    assert unir_cues(cues) == "hoy vamos a hablar de un tema que cambia todo y por eso"


def test_unir_cues_descarta_cue_repetido_entero():
    assert unir_cues(["hola que tal", "hola que tal", "como estan"]) == "hola que tal como estan"


def test_unir_cues_no_toca_cues_sin_solape():
    cues = ["primera idea completa", "segunda idea distinta"]
    assert unir_cues(cues) == "primera idea completa segunda idea distinta"


def test_unir_cues_compara_sin_tildes_ni_signos():
    """«qué,» y «que» son el mismo solape: la puntuación del cue varía."""
    assert unir_cues(["dime por qué, esto", "por que esto importa"]) == "dime por qué, esto importa"


def test_unir_cues_conserva_repeticion_intencionada_corta():
    """Una sola palabra repetida no basta para recortar: perdería texto."""
    assert unir_cues(["no puedo", "puedo intentarlo"]) == "no puedo puedo intentarlo"


def test_vtt_rodante_queda_como_una_frase():
    vtt = "\n".join([
        "WEBVTT",
        "Kind: captions",
        "",
        "00:00:01.000 --> 00:00:03.000",
        "hola que tal",
        "",
        "00:00:03.000 --> 00:00:05.000",
        "hola que tal",
        "como estan hoy",
        "",
        "00:00:05.000 --> 00:00:07.000",
        "como estan hoy espero que bien",
    ])
    assert texto_desde_vtt(vtt) == "hola que tal como estan hoy espero que bien"


def test_vtt_vacio_no_revienta():
    assert texto_desde_vtt("") == ""
    assert unir_cues([]) == ""


# ── Ruido que no se habla ────────────────────────────────────────────────────

def test_quita_anotaciones_de_sonido():
    limpio = limpiar_texto_subtitulos("hola [Música] mundo [Aplausos] fin")
    assert "Música" not in limpio and "Aplausos" not in limpio
    assert "hola" in limpio and "mundo" in limpio and "fin" in limpio


def test_conserva_parentesis_con_frase_real():
    """«(y esto es clave)» sí se dice: no es una anotación de sonido."""
    assert "(y esto es clave)" in limpiar_texto_subtitulos("mira (y esto es clave) esto")


def test_marca_de_hablante_se_vuelve_frontera():
    limpio = limpiar_texto_subtitulos(">> primero >> segundo")
    assert ">>" not in limpio
    assert "primero" in limpio and "segundo" in limpio


# ── Troceado que ya no trunca ────────────────────────────────────────────────

def test_cortar_por_palabras_respeta_el_limite_sin_partir_palabras():
    texto = " ".join(f"palabra{i}" for i in range(200))
    trozos = cortar_por_palabras(texto, 100)
    assert all(len(t) <= 100 for t in trozos)
    assert " ".join(trozos).split() == texto.split()  # no se pierde nada


def test_cortar_por_palabras_con_palabra_mas_larga_que_el_limite():
    trozos = cortar_por_palabras("x" * 250, 100)
    assert "".join(trozos) == "x" * 250


def test_parece_subtitulo_sin_puntuar():
    assert parece_subtitulo_sin_puntuar("palabra " * 60) is True
    assert parece_subtitulo_sin_puntuar("Esto es una frase. " * 20) is False
    assert parece_subtitulo_sin_puntuar("dos palabras") is False


def test_dividir_en_bloques_no_devuelve_bloques_gigantes():
    """La parrafada sin puntos era lo que se enviaba entero y volvía truncado."""
    from api import index as api_module

    crudo = "palabra " * 4000  # ~32 000 caracteres, ni un solo punto
    bloques = api_module._dividir_en_bloques(crudo, 2400)
    assert len(bloques) > 1
    assert all(len(b) <= 2400 for b in bloques)
    assert sum(len(b.split()) for b in bloques) == len(crudo.split())


# ── Motor de pulido ──────────────────────────────────────────────────────────

def _texto_largo():
    frase = ("entonces lo que pasa es que mucha gente cree que esto no funciona "
             "pero la realidad es distinta y te lo voy a demostrar ahora mismo ")
    return (frase * 40).strip()


def test_pulido_pasa_contexto_de_los_vecinos():
    vistos = []

    def pedir(prompt, bloque):
        vistos.append(("ANTERIOR>>>" in prompt, "SIGUE>>>" in prompt))
        return bloque

    pulido.pulir_por_bloques(_texto_largo(), pedir)
    assert len(vistos) >= 3
    assert vistos[0] == (False, True)     # el primero no tiene anterior
    assert vistos[1] == (True, True)      # los de en medio ven ambos lados
    assert vistos[-1] == (True, False)    # el último no tiene siguiente


def test_pulido_truncado_conserva_todo_el_texto():
    """Si la IA devuelve un trozo, se reintenta y al final se guarda el original."""
    def pedir_truncado(prompt, bloque):
        return " ".join(bloque.split()[:10])

    crudo = _texto_largo()
    salida, incidencias = pulido.pulir_por_bloques(crudo, pedir_truncado)
    assert incidencias, "debe avisar de que hubo bloques sin pulir"
    assert len(salida.split()) == len(crudo.split())


def test_pulido_respuesta_vacia_no_borra_el_bloque():
    crudo = _texto_largo()
    salida, incidencias = pulido.pulir_por_bloques(crudo, lambda p, b: "")
    assert incidencias
    assert len(salida.split()) == len(crudo.split())


def test_deteccion_de_truncado():
    entrada = " ".join(f"w{i}" for i in range(60))
    assert pulido.salida_truncada(entrada, " ".join(f"w{i}" for i in range(10))) is True
    assert pulido.salida_truncada(entrada, entrada) is False


def test_quita_el_eco_del_contexto():
    antes = "todo lo anterior y por eso hoy vamos a ver"
    salida = "y por eso hoy vamos a ver el resultado final."
    assert pulido.quitar_eco_de_contexto(salida, antes, bloque="el resultado final") == \
        "el resultado final."


def test_no_quita_texto_que_de_verdad_empieza_asi():
    """Si el bloque empieza igual que el contexto, es contenido, no eco."""
    antes = "y por eso hoy vamos a ver"
    bloque = "y por eso hoy vamos a ver otra vez"
    assert pulido.quitar_eco_de_contexto(bloque, antes, bloque) == bloque


def test_lead_in_alimenta_el_primer_bloque():
    prompts = []

    def pedir(prompt, bloque):
        prompts.append(prompt)
        return bloque

    pulido.pulir_por_bloques("texto corto que cabe en un bloque", pedir,
                             antes_inicial="lo que venia de la peticion anterior")
    assert "lo que venia de la peticion anterior" in prompts[0]


def test_prompt_de_doblaje_incluye_las_reglas_de_locucion():
    p = pulido.construir_prompt("bloque", lang="es-CO", modo="dub", glosario="ISPETSHOPE")
    assert "LOCUTAR" in p
    assert "español de Colombia" in p
    assert "ISPETSHOPE" in p
    normal = pulido.construir_prompt("bloque", lang="es", modo="transcript")
    assert "LOCUTAR" not in normal


@pytest.mark.parametrize("valor,esperado", [
    ("dub", "dub"), ("doblaje", "dub"), ("TTS", "dub"),
    ("transcript", "transcript"), ("", "transcript"), (None, "transcript"),
])
def test_normalizar_modo(valor, esperado):
    assert pulido.normalizar_modo(valor) == esperado


def test_solape_de_texto():
    assert solape_de_texto("y por eso hoy vamos a ver", "vamos a ver el resultado") == 3
    assert solape_de_texto("algo distinto", "nada que ver") is None


# ── Endpoint /api/polish-transcript ──────────────────────────────────────────

@pytest.fixture
def cliente_con_ia(monkeypatch):
    """TestClient de la API de Vercel con la IA sustituida por un doble."""
    from fastapi.testclient import TestClient

    from api import index as api_module

    llamadas = []

    def ia_falsa(client_key, provider, prompt, openrouter_model=None, max_tokens=None):
        llamadas.append(prompt)
        # El bloque real viene entre <<< y >>> al final del prompt.
        bloque = prompt.rsplit("<<<", 1)[-1].split(">>>", 1)[0].strip()
        return bloque.capitalize() + ".", "gemini"

    monkeypatch.setattr(api_module, "_resolver_ia", lambda *a, **k: ("clave", "gemini"))
    monkeypatch.setattr(api_module, "_llamar_ia_con_respaldo", ia_falsa)
    return TestClient(api_module.app), llamadas


def test_endpoint_pule_y_marca_listo_para_doblar(cliente_con_ia):
    cliente, llamadas = cliente_con_ia
    crudo = "hola que tal como estan hoy espero que muy bien todos ustedes"
    r = cliente.post("/api/polish-transcript", json={"text": crudo, "language": "es-CO", "mode": "dub"})
    assert r.status_code == 200
    datos = r.json()
    assert datos["ia_used"] is True
    assert datos["mode"] == "dub"
    assert datos["ready_for_dub"] is True
    assert datos["text"].endswith(".")
    assert "LOCUTAR" in llamadas[0]


def test_endpoint_limpia_horas_y_anotaciones_antes_de_pulir(cliente_con_ia):
    cliente, llamadas = cliente_con_ia
    pegado = "0:00\nhoy vamos a hablar de\n0:03\nvamos a hablar de un tema\n0:06\n[Música]"
    r = cliente.post("/api/polish-transcript", json={"text": pegado, "language": "es"})
    assert r.status_code == 200
    enviado = llamadas[0]
    assert "0:00" not in enviado and "Música" not in enviado
    # Y sin el solape del modo rodante.
    assert enviado.count("vamos a hablar de") == 1


def test_endpoint_texto_vacio_es_400(cliente_con_ia):
    cliente, _ = cliente_con_ia
    assert cliente.post("/api/polish-transcript", json={"text": "   "}).status_code == 400


def test_endpoint_sin_ia_cae_a_la_limpieza_local(monkeypatch):
    from fastapi.testclient import TestClient

    from api import index as api_module

    monkeypatch.setattr(api_module, "_resolver_ia", lambda *a, **k: ("", "none"))
    cliente = TestClient(api_module.app)
    r = cliente.post("/api/polish-transcript", json={"text": "eh o sea esto es una prueba"})
    assert r.status_code == 200
    datos = r.json()
    assert datos["ia_used"] is False
    assert datos["ready_for_dub"] is False
    assert datos["text"]           # nunca devuelve vacío
    assert datos["aviso"]


def test_endpoint_lead_in_llega_al_prompt(cliente_con_ia):
    cliente, llamadas = cliente_con_ia
    cliente.post("/api/polish-transcript", json={
        "text": "y entonces seguimos con la idea",
        "lead_in": "lo que venia de la peticion anterior",
    })
    assert "lo que venia de la peticion anterior" in llamadas[0]


def test_respuesta_de_subtitulos_marca_needs_polish():
    from api import index as api_module

    sin_puntuar = "palabra " * 60
    resp = api_module._respuesta_subtitulos(sin_puntuar, "es", "titulo", "subtitles")
    import json as _json
    datos = _json.loads(resp.body)
    assert datos["needs_polish"] is True

    puntuado = "Esto es una frase. " * 20
    datos2 = _json.loads(
        api_module._respuesta_subtitulos(puntuado, "es", "t", "subtitles").body
    )
    assert datos2["needs_polish"] is False
