# -*- coding: utf-8 -*-
"""Barras invertidas y otros caracteres sospechosos en el origen."""
import pymupdf, re, collections

RUTA = "C:/Users/juanl/Documents/Proyectos/jg-turbo/pdf/El Arte de la Seducción ( PDFDrive ).pdf"
doc = pymupdf.open(RUTA)

paginas_con = []
total = 0
ejemplos = []
for pn in range(len(doc)):
    t = doc[pn].get_text()
    n = t.count("\\")
    if n:
        total += n
        paginas_con.append(pn + 1)
        if len(ejemplos) < 12:
            for m in re.finditer(r".{0,40}\\.{0,40}", t):
                ejemplos.append((pn + 1, m.group(0).replace("\n", "|")))
print("backslashes:", total, "en", len(paginas_con), "paginas")
print(paginas_con)
for pg, e in ejemplos:
    print(f"  p{pg}: {e!r}")

# otros caracteres no tipograficos
todo = ""
for p in doc:
    todo += p.get_text()
raros = collections.Counter(c for c in todo if c in "\\|{}[]~^$#@_*<>`" or ord(c) > 0x2100)
print()
print("otros raros:", dict(raros))
