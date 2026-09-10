# -*- coding: utf-8 -*-
"""Escaneo de artefactos del origen (seducción): guiones internos,
fragmentos desplazados, letras sueltas y palabras pegadas."""
import pymupdf, re, collections

RUTA = "C:/Users/juanl/Documents/Proyectos/jg-turbo/pdf/El Arte de la Seducción ( PDFDrive ).pdf"
doc = pymupdf.open(RUTA)
todo = ""
for p in doc:
    todo += p.get_text().replace("\n", " ") + " "

# 1 · guiones intra-línea
h = re.findall(r"\S*[a-záéíóúñ]-[a-záéíóúñ]\S*", todo)
c = collections.Counter(w.strip(".,;:«»()[]¡!¿?\"") for w in h)
print("== guiones internos:", sum(c.values()), "tokens,", len(c), "unicos ==")
for w, n in c.most_common(60):
    print(f"  {n:3d}  {w}")

# 2 · fragmento minuscula suelto entre punto y palabra con mayuscula
print("== desplazados (punto + min + MAY) ==")
for m in re.finditer(r"[\.\?\!]\s+([a-záéíóúñ]{2,3})\s+([A-ZÁÉÍÓÚÑ])", todo):
    print("  ", repr(m.group(0)), "→", repr(todo[max(0, m.start()-40):m.end()+30]))

# 3 · letras sueltas dentro de palabra (D e hecho) — solo MAYUS
print("== letras sueltas MAYUS ==")
for m in re.finditer(r"\b([A-ZÁÉÍÓÚÑ]) ([a-záéíóúñ]) (?=[a-záéíóúñ])", todo):
    print("  ", repr(todo[max(0, m.start()-30):m.end()+20]))
