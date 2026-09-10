# -*- coding: utf-8 -*-
"""Muestreo de bloques cortos para revisión manual."""
import json, random

B = json.load(open("bloques.json"))
cortos = [b for b in B if b["rol"] in ("cuerpo", "cuerpo_min") and len(b.get("txt", "")) < 45]
print(len(cortos), "bloques cortos")
random.seed(7)
for b in random.sample(cortos, 25):
    print(f"p{b['pag']:<4d} n{b.get('nivel')} {b['txt'][:70]!r}")
