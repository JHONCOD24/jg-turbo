# -*- coding: utf-8 -*-
"""Comprueba que TODAS las filas con varios line-dicts en la misma línea base
son fragmentos de justificación (y no columnas/diálogos legítimos)."""
import pymupdf, collections

RUTA = "C:/Users/juanl/Documents/Proyectos/jg-turbo/pdf/El Arte de la Seducción ( PDFDrive ).pdf"
doc = pymupdf.open(RUTA)

filas_multi = 0
sospechosas = []
for pn in range(len(doc)):
    d = doc[pn].get_text("dict")
    lineas = []
    for b in d["blocks"]:
        if b["type"] != 0:
            continue
        for l in b["lines"]:
            t = "".join(s["text"] for s in l["spans"])
            if t.strip():
                lineas.append(l)
    lineas.sort(key=lambda l: (l["bbox"][3], l["bbox"][0]))
    fila = []
    for l in lineas:
        if fila and abs(l["bbox"][3] - fila[-1]["bbox"][3]) <= 2.5:
            fila.append(l)
        else:
            if len(fila) > 1:
                filas_multi += 1
                texto = "".join("".join(s["text"] for s in x["spans"]) for x in fila)
                # un fragmento de justificación: ninguna pieza llega al margen derecho
                llega = [x for x in fila if x["bbox"][2] > 540]
                if llega or len(fila) > 12:
                    sospechosas.append((pn + 1, len(fila), texto[:80]))
            fila = [l]
    if len(fila) > 1:
        filas_multi += 1

print("filas con mas de un line-dict:", filas_multi)
print("sospechosas (algun fragmento llega al margen derecho o fila enorme):", len(sospechosas))
for pg, n, t in sospechosas[:20]:
    print(f"  p{pg} x{n}: {t!r}")
