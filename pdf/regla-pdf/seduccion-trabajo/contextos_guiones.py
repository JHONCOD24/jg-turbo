# -*- coding: utf-8 -*-
"""Contextos de guiones internos ambiguos."""
import pymupdf, re

RUTA = "C:/Users/juanl/Documents/Proyectos/jg-turbo/pdf/El Arte de la Seducción ( PDFDrive ).pdf"
doc = pymupdf.open(RUTA)
todo = ""
for p in doc:
    todo += p.get_text().replace("\n", " ") + " "

dudosos = ["Aven-tura", "des-valido", "Ron-da", "es-cuche", "pa-labras",
           "sos-pechas", "descarriar-las", "pos-seducción", "re-encender",
           "ex-amantes", "p/m-adre"]
for pat in dudosos:
    for m in re.finditer(re.escape(pat), todo):
        print(pat, "→", repr(todo[max(0, m.start()-55):m.end()+45]))
    print()
