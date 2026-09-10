# -*- coding: utf-8 -*-
"""JG Turbo · Paso 1 de 6 · Diagnóstico del PDF de origen

Nunca empieces a extraer sin haber pasado por aquí. Este script no toca nada:
mira el PDF y responde las preguntas de las que dependen TODAS las decisiones
posteriores. Al terminar deja un `perfil.json` que los pasos 2 y 3 leen.

    python3 1_diagnosticar.py origen.pdf

Lo que averigua:
  · qué familia de PDF es (editorial maquetado o EPUB convertido)
  · si parte palabras con guion al final de renglón
  · si el justificado rompe cada línea en trozos sueltos
  · dónde está la banda de cabecera/pie que hay que quitar
  · a qué distancia del margen empieza un párrafo nuevo
  · qué fuentes son cuerpo y cuáles son títulos
  · qué páginas llevan imágenes y cuáles están giradas
"""
import sys, json, re, collections, unicodedata, statistics
import pymupdf

RUTA = sys.argv[1] if len(sys.argv) > 1 else "origen.pdf"
DOC = pymupdf.open(RUTA)
N = len(DOC)


def texto_linea(l):
    return "".join(s["text"] for s in l["spans"])


def lineas_crudas(pag):
    out = []
    for b in pag.get_text("dict")["blocks"]:
        if b["type"] != 0:
            continue
        for l in b["lines"]:
            if texto_linea(l).strip():
                out.append(l)
    return out


# ── Muestreo ──────────────────────────────────────────────────────────
# En un libro de 3.000 páginas no hace falta mirarlas todas para saber cómo
# está hecho; en uno de 200, sí. El paso es proporcional.
paso = max(1, N // 600)
muestra = list(range(0, N, paso))

fuentes = collections.Counter()
tamanos = collections.Counter()
x0 = collections.Counter()
x1 = collections.Counter()
alto_pag = collections.Counter()
chars = collections.Counter()
fragmentos = 0
lineas_total = 0
con_guion = 0
giradas = []
con_imagen = []
arriba = collections.Counter()   # texto en la banda superior
abajo = collections.Counter()    # texto en la banda inferior

for i in muestra:
    p = DOC[i]
    alto_pag[(round(p.rect.width), round(p.rect.height))] += 1
    dd = p.get_text("dict")
    if any(b["type"] == 1 for b in dd["blocks"]):
        con_imagen.append(i + 1)
    dirs = collections.Counter()
    ys = collections.Counter()
    for b in dd["blocks"]:
        if b["type"] != 0:
            continue
        for l in b["lines"]:
            t = texto_linea(l)
            if not t.strip():
                continue
            lineas_total += 1
            ys[round(l["bbox"][3])] += 1
            dirs[tuple(round(v) for v in l["dir"])] += len(t)
            x0[round(l["bbox"][0])] += 1
            x1[round(l["bbox"][2])] += 1
            if t.rstrip().endswith("-"):
                con_guion += 1
            if l["bbox"][3] < 0.12 * p.rect.height:
                arriba[re.sub(r"\d+", "#", t).strip()[:60]] += 1
            if l["bbox"][1] > 0.88 * p.rect.height:
                abajo[re.sub(r"\d+", "#", t).strip()[:60]] += 1
            for s in l["spans"]:
                fuentes[s["font"].split("+")[-1]] += len(s["text"])
                tamanos[round(s["size"], 1)] += len(s["text"])
    fragmentos += sum(v - 1 for v in ys.values() if v > 1)
    if dirs and dirs.most_common(1)[0][0] != (1, 0):
        giradas.append(i + 1)

for i in range(N):
    chars.update(DOC[i].get_text())

# ── Deducciones ───────────────────────────────────────────────────────
tam_cuerpo = tamanos.most_common(1)[0][0] if tamanos else 0
fuente_cuerpo = fuentes.most_common(1)[0][0] if fuentes else ""

def familia_de(f):
    """El apellido de la fuente, sin el estilo.

    «MinionPro-Regular» y «MinionPro-It» son la misma familia; «MyriadPro-…»
    no. Sirve para saber qué texto es prosa del libro y qué texto es un rótulo
    dentro de un gráfico, que casi siempre va en otra tipografía.
    """
    f = f.split("-")[0]
    return re.sub(r"(PS)?MT$", "", f) or f

familia_cuerpo = familia_de(fuente_cuerpo)
titulos = sorted({s for s, c in tamanos.items() if s >= tam_cuerpo + 1.5 and c > 200}, reverse=True)

niveles = [(x, n) for x, n in sorted(x0.items()) if n >= max(20, lineas_total * 0.01)]
base = niveles[0][0] if niveles else 0
sangria = None
for x, n in niveles[1:]:
    if 8 <= x - base <= 30:
        sangria = x
        break

derecha = max((x for x, n in x1.items() if n >= max(20, lineas_total * 0.01)), default=0)
tasa_guion = con_guion / max(1, lineas_total)
tasa_frag = fragmentos / max(1, lineas_total)

# Banda de cabecera: texto que se repite arriba en muchas páginas.
repetido_arriba = [t for t, c in arriba.items() if c >= max(3, len(muestra) * 0.25) and t]
repetido_abajo = [t for t, c in abajo.items() if c >= max(3, len(muestra) * 0.25) and t]

perfil = "epub" if tasa_frag > 0.05 and tasa_guion < 0.01 else "editorial"

# Dónde termina la banda de cabecera.
#
# Dos medidas y se elige la prudente: hasta dónde baja lo repetido, y desde
# dónde empieza el texto del cuerpo. La banda NUNCA puede morder una línea de
# cuerpo: si lo hiciera, la extracción perdería prosa de verdad.
banda = 0.0
cuerpo_arriba = None
mordidas = 0
if repetido_arriba:
    tope, cuerpo_top = [], []
    for i in muestra[:120]:
        for l in lineas_crudas(DOC[i]):
            t = re.sub(r"\d+", "#", texto_linea(l)).strip()[:60]
            es_cuerpo = any(abs(s["size"] - tam_cuerpo) < 0.3 for s in l["spans"])
            if t in repetido_arriba and not es_cuerpo:
                tope.append(l["bbox"][3])
            elif es_cuerpo:
                cuerpo_top.append(l["bbox"][1])
    if tope:
        # La MEDIANA, no el máximo: la cabecera está a la misma altura en todas
        # las páginas, así que la mediana la clava. El máximo se lo lleva
        # cualquier despiste —un número de capítulo grande a media página
        # también encaja con el patrón «#»— y la banda se iría al fondo.
        banda = round(statistics.median(tope) + 6, 1)
        # ¿Cuánta prosa de verdad quedaría por encima de esa raya?
        muerde = [y for y in cuerpo_top if y < banda]
        cuerpo_arriba = round(min(cuerpo_top), 1) if cuerpo_top else None
        mordidas = len(muerde)

# ── Informe ───────────────────────────────────────────────────────────
def pr(t=""):
    print(t)

pr(f"ARCHIVO           {RUTA}")
pr(f"PÁGINAS           {N}   (muestreadas {len(muestra)})")
pr(f"TAMAÑO DE PÁGINA  {alto_pag.most_common(1)[0][0]} puntos")
pr()
pr("── Familia ───────────────────────────────────────────────")
pr(f"  PERFIL PROPUESTO       {perfil}")
pr(f"  líneas que acaban en guion   {con_guion} de {lineas_total}  ({tasa_guion*100:.2f} %)")
pr(f"  trozos sueltos en la misma fila  {fragmentos}  ({tasa_frag*100:.1f} %)")
if perfil == "epub":
    pr("  → EPUB convertido (Calibre y similares). NO parte palabras: todo")
    pr("    guion al final de renglón es REAL. El justificado coloca cada")
    pr("    palabra por separado: hay que fusionar por línea base.")
else:
    pr("  → Libro maquetado (InDesign y similares). SÍ parte palabras:")
    pr("    hay que unir los guiones de fin de renglón con diccionario.")
pr()
pr("── Tipografía ────────────────────────────────────────────")
pr(f"  cuerpo   {fuente_cuerpo}  a  {tam_cuerpo} pt   (familia: {familia_cuerpo})")
for f, c in fuentes.most_common(8):
    pr(f"     {c:9d}  {f}")
pr(f"  tamaños de título detectados: {titulos[:6]}")
for _i, _t in enumerate(titulos[:6]):
    _papel = "capitulo" if _i == 0 else "capitulo_sub" if _i == 1 else "seccion"
    pr(f"     {_t} pt  →  {_papel}     (se puede cambiar en perfil.json → jerarquia)")
pr()
pr("── Geometría ─────────────────────────────────────────────")
pr(f"  margen izquierdo (base)   x = {base}")
pr(f"  sangría de párrafo        x = {sangria}   (+{(sangria-base) if sangria else 0})")
pr(f"  margen derecho            x = {derecha}")
pr(f"  otros niveles (listas, citas): {[x for x, n in niveles if x not in (base, sangria)][:6]}")
pr()
pr("── Cabeceras y pies ──────────────────────────────────────")
if repetido_arriba:
    pr(f"  banda superior propuesta: y = {banda}   ← se quita todo lo de arriba")
    pr(f"  la línea de cuerpo más alta está en y = {cuerpo_arriba}")
    if mordidas == 0:
        pr("  ninguna línea de cuerpo cae dentro de la banda: es seguro.")
    else:
        pr(f"  ¡OJO! {mordidas} líneas de cuerpo caen dentro. Baja `banda_cabecera`")
        pr("  a mano o comprueba con el paso 6 qué se estaría tirando.")
    for t in repetido_arriba[:5]:
        pr(f"     «{t}»")
else:
    pr("  no hay cabecera repetida")
if repetido_abajo:
    pr("  ojo: hay texto repetido ABAJO (pies de página):")
    for t in repetido_abajo[:5]:
        pr(f"     «{t}»")
pr()
pr("── Imágenes ──────────────────────────────────────────────")
pr(f"  páginas con imagen (en la muestra): {len(con_imagen)}  {con_imagen[:12]}")
pr(f"  páginas con texto GIRADO: {len(giradas)}  {giradas[:12]}")
pr()
pr("── Caracteres poco comunes ───────────────────────────────")
raros = [(c, n) for c, n in chars.items() if ord(c) > 127 or (ord(c) < 32 and c != "\n")]
for c, n in sorted(raros, key=lambda x: -x[1])[:14]:
    try:
        nom = unicodedata.name(c)
    except ValueError:
        nom = "?"
    pr(f"  U+{ord(c):04X}  {n:7d}  {repr(c):10s} {nom}")

perfil_json = {
    "ruta": RUTA,
    "paginas": N,
    "perfil": perfil,
    "fusionar_fragmentos": perfil == "epub",
    "particion_silabas": perfil == "editorial",
    "banda_cabecera": banda,
    "base": base,
    "sangria": sangria,
    "derecha": derecha,
    "fuente_cuerpo": fuente_cuerpo,
    "familia_cuerpo": familia_cuerpo,
    "tam_cuerpo": tam_cuerpo,
    "tam_titulos": titulos[:6],
    # Qué es cada tamaño de título. El mayor es el capítulo; el siguiente, su
    # subtítulo; el resto, secciones. Ajústalo mirando el libro: es lo que
    # decide el índice del PDF nuevo y sus marcadores.
    "jerarquia": {str(t): ("capitulo" if i == 0 else "capitulo_sub" if i == 1 else "seccion")
                  for i, t in enumerate(titulos[:6])},
    "paginas_giradas": giradas,
    "paginas_con_imagen": con_imagen,
    # A rellenar a mano tras mirar el libro (ver «REGLA ADAPTAR PDF.md»):
    "paginas_omitir": [],
    "notas_desde": None,
    "laminas": [],
    "esquemas": {},
    "portada_original": False,
    "empezar_en": 1,
}
json.dump(perfil_json, open("perfil.json", "w"), ensure_ascii=False, indent=1)
pr()
pr("Escrito perfil.json. Revísalo y ajusta a mano lo que el script no puede")
pr("saber solo: páginas a omitir, dónde empiezan las notas, láminas a color,")
pr("esquemas dibujados con texto y si hay que conservar la portada original.")
