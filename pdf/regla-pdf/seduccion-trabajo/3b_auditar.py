# -*- coding: utf-8 -*-
"""JG Turbo · Paso 3b · Auditoría del reflujo  (NO te saltes este paso)

Antes de generar nada, esto te dice si la detección de párrafos funcionó.
El indicador que importa: cuántos párrafos empiezan en MINÚSCULA. Un párrafo
que empieza en minúscula casi siempre es un párrafo partido por error.

    python3 3b_auditar.py

Referencia de los dos libros ya hechos:
    El placebo eres tú →   4 de 1.280  (0,3 %)
    Sex code          →   3 de 7.530  (0,04 %)

Por encima del 2 % hay algo mal en el perfil: vuelve al paso 2.
"""
import json, re, collections

B = json.load(open("bloques.json"))
c = [x for x in B if x["rol"].startswith("cuerpo")]
minus = [x for x in c if x["txt"][:1].islower()]
sinfin = [x for x in c if not re.search(r'[.!?»)"’…:;\]]$', x["txt"].strip())]
cortos = [x for x in c if len(x["txt"]) < 45]

print(f"párrafos de cuerpo        {len(c)}")
pc = 100 * len(minus) / max(1, len(c))
print(f"empiezan en MINÚSCULA     {len(minus)}  ({pc:.2f} %)   {'← REVISAR' if pc > 2 else 'bien'}")
print(f"no acaban en signo        {len(sinfin)}  (normal en listas y diálogos)")
print(f"muy cortos (<45 car.)     {len(cortos)}")
print(f"con «<<» sin limpiar      {sum(1 for x in B if '<<' in x.get('txt',''))}")
print(f"con caracteres de control {sum(1 for x in B for ch in x.get('txt','') if ord(ch) < 32)}")
print()
if minus:
    print("-- dónde empiezan en minúscula (las páginas que se repiten son el problema) --")
    for pag, n in collections.Counter(x["pag"] for x in minus).most_common(8):
        print(f"   página {pag}: {n}")
    print()
    for x in minus[:12]:
        print(f"   p{x['pag']:<5d} {x['txt'][:88]!r}")
