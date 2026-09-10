# -*- coding: utf-8 -*-
"""Localiza los pasajes «Símbolo» y cualquier otra racha de líneas
centradas en negrita (el defecto de palabras partidas sin guion)."""
import pymupdf, re

RUTA = "C:/Users/juanl/Documents/Proyectos/jg-turbo/pdf/El Arte de la Seducción ( PDFDrive ).pdf"
doc = pymupdf.open(RUTA)

# paginas con «Símbolo:»
con_simbolo = [i + 1 for i in range(len(doc)) if "Símbolo:" in doc[i].get_text()]
print("paginas con Símbolo:", con_simbolo)

# rachas de lineas cuerpo en negrita mayormente centradas
for pn in range(len(doc)):
    d = doc[pn].get_text("dict")
    lin = []
    for b in d["blocks"]:
        if b["type"] != 0:
            continue
        for l in b["lines"]:
            spans = [(s["text"], s["font"], s["size"]) for s in l["spans"]]
            t = "".join(x[0] for x in spans)
            if not t.strip():
                continue
            neg = sum(len(x[0]) for x in spans if "Bold" in x[1])
            lin.append({"t": t, "neg": neg / max(1, len(t.strip())),
                        "x0": l["bbox"][0], "x1": l["bbox"][2],
                        "s": max(x[2] for x in spans), "y": l["bbox"][1]})
    lin.sort(key=lambda l: l["y"])
    racha = []
    for l in lin:
        if (l["neg"] >= 0.7 and abs(l["s"] - 15.0) < 0.3
                and l["x0"] > 51 and l["x1"] < 541):
            racha.append(l)
        else:
            if len(racha) >= 3:
                print(f"p{pn+1}: racha x{len(racha)}:", racha[0]["t"][:45], "…",
                      racha[-1]["t"][-35:])
            racha = []
    if len(racha) >= 3:
        print(f"p{pn+1}: racha x{len(racha)}:", racha[0]["t"][:45], "…",
              racha[-1]["t"][-35:])
