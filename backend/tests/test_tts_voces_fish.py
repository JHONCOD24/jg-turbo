"""Voces Fish nuevas: el resolvedor del servidor las encuentra por slug y les
da su reference_id (sin red: solo el catálogo local del módulo).
"""

import sys
from pathlib import Path

_APP_ROOT = Path(__file__).resolve().parents[2]
if str(_APP_ROOT) not in sys.path:
    sys.path.insert(0, str(_APP_ROOT))

from api import index as api_module  # noqa: E402

NUEVAS = {
    "julio-ciencia": "49143b926e1043c491cfe386758d09a0",
    "farick": "dfa5b230c8054f429e434f4a6e9bbdec",
    "enrique-hoffman": "8926506428ad4ae898d35ede47524240",
    "voz-locutor": "4110ff39a33e46b8bac2a9e7f8e00ced",
    "mario-alonso-puig": "b9a077022c424e89b0705cb98085e36a",
    "tatiana-mae": "16cba2445c3749d7810a0b3f348ec0d7",
    "hilary-narrador": "937314c424504d10912e5eef334993a7",
    "jim-hopper": "b114d46e5ed6448fa0b197258e65b8d2",
    "roberto": "ab991f011ecf46a29c1aee96e109d8f7",
    "amy": "22f8c2742acd48f6a9c12962ae179251",
    "dora": "d0d60d228b744e2b9fc7fd00bc6f6b3a",
    "michael": "6b33f00f4d7a49d89a1c7a6f7abec6c4",
    "jg-narradora": "31cdd5b542c64e26be8aba2d9ee62ca2",
    "jg-narrador": "88d6dac3d12a402f9aa87ccf3a6c94b2",
}


def test_nuevas_resuelven_su_reference_id():
    for slug, ref in NUEVAS.items():
        voz = api_module._tts_fish_resolver(slug, "male")
        assert voz is not None, slug
        assert voz["reference_id"] == ref, slug


def test_nuevas_aceptan_prefijo_fish():
    voz = api_module._tts_fish_resolver("fish:tatiana-mae", "female")
    assert voz is not None and voz["id"] == "tatiana-mae"
    assert voz["gender"] == "female"


def test_nuevas_van_en_espanol():
    for slug in NUEVAS:
        voz = api_module._tts_fish_resolver(slug, "male")
        assert voz["lang"] == "es", slug


def test_catalogo_publico_las_ofrece():
    publicas = api_module._tts_fish_voces_publicas()
    ids = {v["id"] for v in publicas["voices"]["list"]}
    for slug in NUEVAS:
        assert slug in ids, slug


def test_desconocida_sigue_cayendo_a_una_valida():
    voz = api_module._tts_fish_resolver("no-existe", "female")
    assert voz is not None and voz.get("reference_id")


def test_roberto_es_masculina_espanol():
    voz = api_module._tts_fish_resolver("roberto", "female")
    assert voz is not None
    assert voz["id"] == "roberto"
    assert voz["gender"] == "male"
    assert voz["name"] == "Roberto"
    assert voz["lang"] == "es"
    assert voz["reference_id"] == "ab991f011ecf46a29c1aee96e109d8f7"


def test_clones_nuevos_genero_y_nombre():
    esperadas = {
        "amy": ("female", "Amy"),
        "dora": ("female", "Dora"),
        "michael": ("male", "Michael"),
    }
    for slug, (genero, nombre) in esperadas.items():
        voz = api_module._tts_fish_resolver(f"fish:{slug}", "male")
        assert voz is not None, slug
        assert voz["id"] == slug
        assert voz["gender"] == genero, slug
        assert voz["name"] == nombre, slug
        assert voz["lang"] == "es", slug


def test_voice_design_jg_genero_y_nombre():
    """Voces creadas con Voice Design: el slug lleva «jg-» porque «narrador»
    a secas es un alias histórico que redirige a Valentino."""
    esperadas = {
        "jg-narradora": ("female", "JG Narradora"),
        "jg-narrador": ("male", "JG Narrador"),
    }
    for slug, (genero, nombre) in esperadas.items():
        voz = api_module._tts_fish_resolver(f"fish:{slug}", "female")
        assert voz is not None, slug
        assert voz["id"] == slug
        assert voz["gender"] == genero, slug
        assert voz["name"] == nombre, slug
        assert voz["lang"] == "es", slug
    assert api_module._tts_fish_resolver("narrador", "male")["id"] != "jg-narrador"



RETIRADAS_0912 = {
    "narradora": "jg-narradora", "latina": "jg-narradora", "voz-a": "jg-narradora",
    "sheyla": "jg-narradora", "latina-kika": "jg-narradora", "voz-platica": "jg-narradora",
    "sabio": "valentino", "terror": "valentino", "sabio-expandido": "valentino",
    "brian-tracy": "valentino", "morgan-freeman": "valentino", "palabra-biblica": "valentino",
    "morillo": "valentino", "narrador-documental": "valentino",
}


def test_retiradas_0912_redirigen_y_salen_del_catalogo():
    """Un fish_voice guardado con una retirada suena la equivalente, no Nico Robin."""
    publicas = api_module._tts_fish_voces_publicas()
    ids = {v["id"] for v in publicas["voices"]["list"]}
    for viejo, destino in RETIRADAS_0912.items():
        voz = api_module._tts_fish_resolver(f"fish:{viejo}", "female")
        assert voz is not None and voz["id"] == destino, viejo
        assert viejo not in ids, viejo


def test_sandra_retirada_redirige_a_amy():
    voz = api_module._tts_fish_resolver("sandra-design-travel", "female")
    assert voz is not None
    assert voz["id"] == "amy"
    publicas = api_module._tts_fish_voces_publicas()
    ids = {v["id"] for v in publicas["voices"]["list"]}
    assert "sandra-design-travel" not in ids
