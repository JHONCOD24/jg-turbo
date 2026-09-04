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
    "sheyla": "c42d566a928a4049a01262e4f63a1efb",
    "farick": "dfa5b230c8054f429e434f4a6e9bbdec",
    "sabio-expandido": "60a33602dacc4d899cb671b024e66d8c",
    "enrique-hoffman": "8926506428ad4ae898d35ede47524240",
    "voz-locutor": "4110ff39a33e46b8bac2a9e7f8e00ced",
    "brian-tracy": "cd803cbf78a4454fa98b601abbf8966a",
    "morgan-freeman": "7c76e349434d4f1e97078d924acea65f",
    "mario-alonso-puig": "b9a077022c424e89b0705cb98085e36a",
}


def test_nuevas_resuelven_su_reference_id():
    for slug, ref in NUEVAS.items():
        voz = api_module._tts_fish_resolver(slug, "male")
        assert voz is not None, slug
        assert voz["reference_id"] == ref, slug


def test_nuevas_aceptan_prefijo_fish():
    voz = api_module._tts_fish_resolver("fish:sheyla", "female")
    assert voz is not None and voz["id"] == "sheyla"
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
