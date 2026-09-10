# -*- coding: utf-8 -*-
"""JG Turbo · Paso 2b (parche propio de este libro) · Arreglos del origen

El PDF fuente (EPUB r1.2 convertido con Calibre) tiene defectos medidos de
conversión. Este script los corrige SOBRE crudo.json justo después de
2_extraer.py, aplicando los reemplazos tanto en `txt` como en los spans
(para que las cursivas y negritas se conserven).

Toda corrección queda contada y debe salir en NOTAS_SEDUCCION.md. Regla de
oro: no se inventa contenido; solo se recoloca o repara lo que el conversor
estropeó (verificado uno a uno sobre el original).

Se ejecuta SIEMPRE después de 2_extraer.py (ese lo sobrescribe).
"""
import json, re, collections

RUTA_LIBRO = "C:/Users/juanl/Documents/Proyectos/jg-turbo/pdf/El Arte de la Seducción ( PDFDrive ).pdf"

# (pagina, busca, reemplaza, motivo)
# La pagina es la del PDF original (1-based); 0 = en cualquier pagina.
PARCHES = [
    # — Espaciado de letras del justificado («D e hecho» = «De hecho») —
    (100, "D e hecho", "De hecho", "letras separadas por el conversor"),
    (21, "D e niñ@s", "De niñ@s", "letras separadas por el conversor"),
    # — Palabras pegadas —
    (100, "laintimidó", "la intimidó", "palabras pegadas por el conversor"),
    # — Página 96: el conversor partió «parecen» y desplazó el «cen» —
    # «pare-decir, ... atractivo. cen Quieres» → «parecen decir, ... Quieres»
    (96, "pare-", "parecen", "fragmento desplazado: pare- + cen → parecen"),
    (96, "atractivo. cen Quieres", "atractivo. Quieres", "fragmento desplazado: pare- + cen → parecen"),
    # — Página 60: «te en|cuadra» partida sin guion; el guardián del
    # diccionario no la une porque «en» y «cuadra» existen por sí solas —
    (60, "cualidades, te en", "cualidades, te", "fragmento desplazado: en|cuadra → encuadra"),
    (60, "cuadra en un mito", "encuadra en un mito", "fragmento desplazado: en|cuadra → encuadra"),
    # — Errata del ebook —
    (0, "responsabilidaes", "responsabilidades", "errata: falta una d"),
    # — Marcas del conversor dentro de un diálogo de Shakespeare —
    (384, "A> NA:", "ANA:", 'el conversor metió «>» dentro del nombre'),
    # — Caja rara en un título de sección —
    (0, "«SoLO TÚ»", "«SOLO TÚ»", "caja corrupta en título de sección"),
    # — Punto y coma por dos puntos en los apéndices —
    (0, "Apéndice A;", "Apéndice A:", "puntuación corrupta en título"),
    (0, "Apéndice B;", "Apéndice B:", "puntuación corrupta en título"),
    # — Guiones de sílabas que el ebook dejaba a mitad de línea —
    (0, "re-tardar", "retardar", "guion de partición intra-línea"),
    (0, "con-sumado", "consumado", "guion de partición intra-línea"),
    (0, "¿Aven-tura?", "¿Aventura?", "guion de partición intra-línea"),
    (0, "des-valido", "desvalido", "guion de partición intra-línea"),
    (0, "Ron-da la periferia", "Ronda la periferia", "guion de partición intra-línea"),
    (0, "es-cuche;", "escuche;", "guion de partición intra-línea"),
    (0, "pa-labras", "palabras", "guion de partición intra-línea"),
    (0, "sos-pechas", "sospechas", "guion de partición intra-línea"),
    (0, "descarriar-las", "descarriarlas", "guion de partición intra-línea"),
    (0, "re-encender", "reencender", "guion de partición intra-línea"),
    (0, "ex-amantes", "examantes", "guion de partición intra-línea"),
    # — Saint-Germain, Anne-Marie, Middleton-Murry, LouisFrançois-Armand,
    #    Andreas-Salome y pos-seducción NO se tocan: son compuestos reales —
]

D = json.load(open("crudo.json"))
hechos = collections.Counter()

def aplica(texto, busca, reemplaza):
    n = texto.count(busca)
    return texto.replace(busca, reemplaza), n

for e in D["elementos"]:
    if e["tipo"] != "pagina":
        continue
    pg = e["pag"]
    for ln in e["lineas"]:
        # 1) versos: « \ » marca el fin de verso en este ebook → salto real
        if "\\" in ln["txt"]:
            hechos["saltos de verso"] += ln["txt"].count("\\")
            nuevo = ln["txt"]
            nuevo = nuevo.replace(" \\ ", "\n").replace("\\ ", "\n").replace(" \\", "\n")
            nuevo = nuevo.replace("\\", "\n")
            ln["txt"] = nuevo
            for s in ln["spans"]:
                t = s["t"]
                t = t.replace(" \\ ", "\n").replace("\\ ", "\n").replace(" \\", "\n")
                t = t.replace("\\", "\n")
                s["t"] = t
        # 2) parches literales por página (o globales con pagina 0)
        for ppg, busca, reemplaza, motivo in PARCHES:
            if ppg and pg != ppg:
                continue
            if busca in ln["txt"]:
                nuevo, n = aplica(ln["txt"], busca, reemplaza)
                if n:
                    hechos[motivo] += n
                    ln["txt"] = nuevo
                    for s in ln["spans"]:
                        s["t"] = s["t"].replace(busca, reemplaza)
        # 3) página 4 (créditos): cada renglón es una entrada propia
        if pg == 4:
            ln["arranca"] = True

        # 4) blindaje: si un parche cayó entre dos spans y txt ya no coincide
        #    con la suma de spans, se colapsa a un solo span (3_reflujo
        #    construye los bloques desde los spans; divergir = texto perdido)
        unido = "".join(s["t"] for s in ln["spans"])
        if unido != ln["txt"]:
            base = max(ln["spans"], key=lambda s: len(s["t"]))
            ln["spans"] = [{"t": ln["txt"], "f": base["f"], "s": base["s"]}]
            hechos["línea colapsada a un span"] += 1

json.dump(D, open("crudo.json", "w"), ensure_ascii=False)
print("parches aplicados:")
for k, v in sorted(hechos.items()):
    print(f"   {v:4d}  {k}")
sin_respaldo = [p for p in PARCHES if hechos[p[3]] == 0]
if sin_respaldo:
    print("¡OJO! parches que NO encontraron su texto:")
    for p in sin_respaldo:
        print("   ", p[1], "->", p[2], "|", p[3])
