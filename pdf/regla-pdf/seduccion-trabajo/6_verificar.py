# -*- coding: utf-8 -*-
"""JG Turbo · Paso 6 de 6 · Verificación de fidelidad

    python3 6_verificar.py "nombre del pdf generado.pdf"

Dos comprobaciones. Las dos tienen que salir limpias antes de entregar.

A. REFLUJO — ¿se perdió algo al reconstruir los párrafos?
   Compara carácter a carácter el texto que salió del PDF original contra el
   texto reconstruido, ignorando espacios. La ÚNICA diferencia admisible son
   los guiones de partición que se quitaron a propósito (y en un EPUB, cero).

B. RESULTADO — ¿el PDF nuevo dice exactamente lo mismo?
   Extrae el texto del PDF generado y lo compara palabra por palabra con los
   bloques. Lo normal es UN solo tramo distinto: el índice regenerado.

Además cuenta lo que nunca debe aparecer: palabras partidas por guion, guiones
suaves, caracteres de control, dobles espacios y texto fuera del margen.
"""
import sys, json, re, unicodedata, collections, difflib
import pymupdf

def esqueleto(t):
    t = unicodedata.normalize("NFC", t)
    t = re.sub(r"-(?=\n|$)", "", t, flags=re.M)   # guion de fin de renglón
    return re.sub(r"\s+", "", t)

D = json.load(open("crudo.json"))
B = json.load(open("bloques.json"))

print("── A · El reflujo no perdió texto ────────────────────────")
orig = []
for e in D["elementos"]:
    if e["tipo"] == "lamina":
        orig.append(e.get("pie", ""))
    else:
        orig.extend(l["txt"] for l in e["lineas"])
rec = [x.get("pie", "") if x["rol"] == "lamina" else x.get("txt", "") for x in B]
o, r = esqueleto("\n".join(orig)), esqueleto("\n".join(rec))
print(f"  caracteres del original      {len(o)}")
print(f"  caracteres reconstruidos     {len(r)}   ({len(r)-len(o):+d})")
co, cr = collections.Counter(o), collections.Counter(r)
dif = {k: cr.get(k, 0) - co.get(k, 0) for k in set(co) | set(cr) if co.get(k, 0) != cr.get(k, 0)}
if not dif:
    print("  IDÉNTICOS carácter por carácter ✔")
else:
    print(f"  diferencias: {dif}")
    print("  Solo son aceptables: '-' (guiones compuestos que se conservaron")
    print("  a propósito) y '<' (los «<<» de un EPUB). Cualquier LETRA aquí es")
    print("  texto perdido: vuelve al paso 2.")

if len(sys.argv) > 1:
    print()
    print("── B · El PDF nuevo dice lo mismo ────────────────────────")
    doc = pymupdf.open(sys.argv[1])
    ext = "\n".join(doc[i].get_text() for i in range(len(doc)))
    # Las láminas guardan su texto en `pie`, no en `txt`: también cuenta.
    esp = "\n".join((x.get("txt") or x.get("pie") or "") for x in B
                    if x.get("txt") or x.get("pie"))
    # Se corta la portadilla y el índice que generamos nosotros: para eso se
    # busca el primer párrafo de cuerpo del libro, que es único.
    primer = next((x["txt"] for x in B
                   if x["rol"] == "cuerpo" and len(x.get("txt", "")) > 60), None)
    corte = 0
    if primer:
        aguja = primer[:50]
        pos = ext.find(aguja)
        if pos > 0:
            corte = pos
            esp = esp[esp.find(aguja):]
    cuerpo = ext[corte:]
    A, C = esp.split(), cuerpo.split()
    print(f"  palabras esperadas   {len(A)}")
    print(f"  palabras en el PDF   {len(C)}   ({len(C)-len(A):+d})")
    ops = [x for x in difflib.SequenceMatcher(None, A, C, autojunk=False).get_opcodes()
           if x[0] != "equal"]
    print(f"  tramos distintos     {len(ops)}   {'✔' if len(ops) == 0 else '← mira si son tuyos'}")
    if ops:
        print("  (un tramo «insert» que sea texto que TÚ generaste —portadilla,")
        print("   índice— es correcto. Un «delete» o un «replace» NO lo es.)")
    for tag, i1, i2, j1, j2 in ops[:6]:
        print(f"    {tag}: esperado={' '.join(A[i1:i2])[:60]!r} | leído={' '.join(C[j1:j2])[:60]!r}")

    print()
    print("── Lo que nunca debe aparecer ────────────────────────────")
    partidas = len(re.findall(r"[\wáéíóúñü]-\n[\wáéíóúñü]", ext))
    suaves = ext.count("\u00ad")
    control = sum(1 for c in ext if ord(c) < 32 and c != "\n")
    dobles = len(re.findall("  ", ext))
    print(f"  palabras partidas por guion   {partidas}")
    print(f"  guiones suaves (U+00AD)       {suaves}")
    print(f"  caracteres de control         {control}")
    print(f"  dobles espacios               {dobles}")
    W, MI, MD = doc[0].rect.width, 40, 40
    fuera = 0
    for i in range(len(doc)):
        for b in doc[i].get_text("dict")["blocks"]:
            if b["type"] != 0:
                continue
            for l in b["lines"]:
                if l["bbox"][2] > W - MD + 1.5 or l["bbox"][0] < MI - 1.5:
                    fuera += 1
    print(f"  líneas fuera del margen       {fuera}")
    print()
    print(f"  páginas {len(doc)} | marcadores {len(doc.get_toc())}")
