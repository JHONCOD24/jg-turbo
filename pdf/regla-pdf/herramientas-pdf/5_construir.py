# -*- coding: utf-8 -*-
"""JG Turbo · Paso 5 de 6 · Generación del PDF adaptado

    python3 5_construir.py "Título del libro" "Autor"

El formato NO es negociable: está elegido para que el extractor de JG Turbo
(pdf.js + limpiezaTexto.js) no tenga NADA que adivinar.

  A5 (420 × 595 pt)      cabe cómodo en un móvil y es el tamaño estándar
  Caladea 11 / 16,6      serif de pantalla con cursiva y negrita reales
  una sola columna       dos columnas rompen el orden de lectura
  justificado SIN partir  ReportLab no silabea: cero palabras cortadas
  párrafos separados 7,5 pt  el hueco vertical hace evidente dónde acaba uno
  sin cabeceras ni números   nada que se pueda colar a mitad de párrafo
  fuente incrustada con ToUnicode  cada glifo sabe qué letra es

Si una palabra no cabe de ancho (URLs larguísimas de las notas), ese párrafo
—y solo ese— se achica hasta que quepa. Así nunca se sale del margen ni se
parte, que es lo que la app leería mal.
"""
import json, os, re, sys
from reportlab.lib.pagesizes import A5
from reportlab.lib import colors
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.enums import TA_JUSTIFY, TA_CENTER, TA_LEFT
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfbase.pdfmetrics import registerFontFamily, stringWidth
from reportlab.platypus import (BaseDocTemplate, PageTemplate, Frame, Paragraph,
                                Spacer, PageBreak, Image, KeepTogether, NextPageTemplate)

TITULO = sys.argv[1] if len(sys.argv) > 1 else "Libro"
AUTOR = sys.argv[2] if len(sys.argv) > 2 else ""
SALIDA = re.sub(r"[^\w áéíóúñÁÉÍÓÚÑ-]", "", TITULO)[:60] + " - adaptado para lectura.pdf"

F = "/usr/share/fonts/truetype/crosextra/"
for n, f in [("Cal", "Caladea-Regular"), ("Cal-B", "Caladea-Bold"),
             ("Cal-I", "Caladea-Italic"), ("Cal-BI", "Caladea-BoldItalic")]:
    pdfmetrics.registerFont(TTFont(n, F + f + ".ttf"))
registerFontFamily("Cal", normal="Cal", bold="Cal-B", italic="Cal-I", boldItalic="Cal-BI")

ANCHO, ALTO = A5
MI = MD = 40
MS, MF = 44, 46
MARCO_W, MARCO_H = ANCHO - MI - MD, ALTO - MS - MF

def E(n, **kw):
    b = dict(fontName="Cal", fontSize=11, leading=16.6, alignment=TA_JUSTIFY,
             textColor=colors.HexColor("#14161a"), splitLongWords=0,
             allowWidows=0, allowOrphans=0)
    b.update(kw)
    return ParagraphStyle(n, **b)

S = {
    "cuerpo":     E("cuerpo", spaceAfter=7.5),
    "cita":       E("cita", fontSize=10.2, leading=15.4, leftIndent=22, rightIndent=14,
                    spaceBefore=7, spaceAfter=10, textColor=colors.HexColor("#2b2f36")),
    "cuerpo_min": E("cuerpo_min", fontSize=9.6, leading=14.2, spaceAfter=7),
    "pie":        E("pie", fontSize=9.4, leading=13.4, alignment=TA_LEFT, spaceBefore=5,
                    spaceAfter=12, textColor=colors.HexColor("#4a5058")),
    "seccion":    E("seccion", fontName="Cal-B", fontSize=13, leading=17.5,
                    alignment=TA_LEFT, spaceBefore=20, spaceAfter=8),
    "capitulo":   E("capitulo", fontName="Cal-B", fontSize=20, leading=25,
                    alignment=TA_LEFT, spaceAfter=8),
    "capitulo_sub": E("capitulo_sub", fontSize=13.5, leading=18, alignment=TA_LEFT,
                      spaceAfter=6, textColor=colors.HexColor("#6a7078")),
    "tit_autor":  E("tit_autor", fontSize=15, leading=20, alignment=TA_CENTER, spaceAfter=26),
    "tit_tit":    E("tit_tit", fontName="Cal-B", fontSize=30, leading=36, alignment=TA_CENTER,
                    spaceAfter=12),
    "indice":     E("indice", fontSize=10, leading=13.8, alignment=TA_LEFT,
                    spaceAfter=0.5, leftIndent=24, textColor=colors.HexColor("#3a4048")),
    "indice1":    E("indice1", fontName="Cal-B", fontSize=11.5, leading=16.5,
                    alignment=TA_LEFT, spaceBefore=10, spaceAfter=1),
    "indice2":    E("indice2", fontSize=11, leading=15.4, alignment=TA_LEFT,
                    spaceBefore=4, spaceAfter=0.5, leftIndent=10),
}

P = json.load(open("perfil.json"))
B = json.load(open("bloques.json"))
MAPA = json.load(open("mapa_img.json"))
CON_PORTADA = bool(P.get("portada_original")) and os.path.exists("portada.jpg")

def dibuja_portada(c, doc):
    """La portada original del libro, a página completa."""
    from PIL import Image as PILImage
    im = PILImage.open("portada.jpg")
    c.saveState()
    c.setFillColorRGB(0.043, 0.043, 0.055)
    c.rect(0, 0, ANCHO, ALTO, stroke=0, fill=1)
    h = ALTO
    w = h * im.width / im.height
    if w > ANCHO:
        w = ANCHO
        h = w * im.height / im.width
    c.drawImage("portada.jpg", (ANCHO - w) / 2.0, (ALTO - h) / 2.0,
                width=w, height=h, mask=None)
    c.restoreState()

class Libro(BaseDocTemplate):
    ultimo_nivel = -1
    def __init__(self, *a, **kw):
        BaseDocTemplate.__init__(self, *a, **kw)
        marco = lambda i: Frame(MI, MF, MARCO_W, MARCO_H, id=i, leftPadding=0,
                                rightPadding=0, topPadding=0, bottomPadding=0)
        plantillas = [PageTemplate(id="n", frames=[marco("t")])]
        if CON_PORTADA:
            plantillas.insert(0, PageTemplate(id="portada", frames=[marco("p")],
                                              onPage=dibuja_portada))
        self.addPageTemplates(plantillas)
    def afterFlowable(self, f):
        if hasattr(f, "_m"):
            t, niv, k = f._m
            niv = max(0, min(niv, self.ultimo_nivel + 1))   # el índice no salta niveles
            self.ultimo_nivel = niv
            self.canv.bookmarkPage(k)
            self.canv.addOutlineEntry(t, k, level=niv, closed=(niv == 0))

def ajusta(plano, est):
    st = S[est]
    anc = MARCO_W - st.leftIndent - st.rightIndent
    largo = max((stringWidth(w, st.fontName, st.fontSize) for w in plano.split()), default=0)
    if largo <= anc or largo == 0:
        return st
    f = max(6.0, st.fontSize * anc / largo * 0.97)
    return ParagraphStyle(st.name + "_aj", parent=st, fontSize=f, leading=f * 1.45)

def Pa(txt, est, m=None, plano=None):
    # Si un título con marcador se parte entre dos páginas, ReportLab dibuja
    # el FRAGMENTO (objeto nuevo sin `_m`): el marcador se perdía y el enlace
    # del índice quedaba roto (medido en «El aprendiz de brujo», m215). El
    # primer fragmento hereda el marcador; los demás, no (sin duplicados).
    cls = Tit if m else Paragraph
    p = cls(txt, ajusta(plano if plano is not None else re.sub(r"<[^>]+>", "", txt), est))
    if m:
        p._m = m
    return p


class Tit(Paragraph):
    def split(self, availWidth, availHeight):
        frags = Paragraph.split(self, availWidth, availHeight)
        if frags and getattr(self, "_m", None):
            frags[0]._m = self._m
        return frags

def figura(ruta, w, h):
    W = min(MARCO_W, w * 72.0 / 200.0)
    H = W * h / w
    tope = MARCO_H - 30
    if H > tope:
        H = tope
        W = H * w / h
    return Image(ruta, width=W, height=H, hAlign="CENTER")

hist, capitulos, n = [], [], 0
def clave():
    global n
    n += 1
    return f"m{n}"

if CON_PORTADA:
    hist += [NextPageTemplate("n"), Spacer(1, 1), PageBreak()]
hist += [Spacer(1, 90), Pa(AUTOR, "tit_autor"), Pa(TITULO, "tit_tit"), PageBreak()]
POS_INDICE = len(hist)
hist.append(PageBreak())

i = 0
while i < len(B):
    x = B[i]
    r = x["rol"]
    if r == "capitulo":
        k = clave()
        sub = B[i + 1] if i + 1 < len(B) and B[i + 1]["rol"] == "capitulo_sub" else None
        etiqueta = x["txt"] + (f': {sub["txt"]}' if sub else "")
        hist += [PageBreak(), Spacer(1, 24),
                 Pa(x["html"], "capitulo", (etiqueta, 0, k), x["txt"])]
        if sub:
            hist.append(Pa(sub["html"], "capitulo_sub", plano=sub["txt"]))
            i += 1
        hist.append(Spacer(1, 6))
        capitulos.append((0, etiqueta, k))
        i += 1
        continue
    if r == "capitulo_sub":
        hist.append(Pa(x["html"], "capitulo_sub", plano=x["txt"]))
        i += 1
        continue
    if r == "seccion":
        k = clave()
        hist.append(Pa(x["html"], "seccion", (x["txt"], 1, k), x["txt"]))
        capitulos.append((1, x["txt"], k))
        i += 1
        continue
    if r in ("cuerpo", "cuerpo_min"):
        est = "cita" if x.get("nivel") == 1 else ("cuerpo_min" if r == "cuerpo_min" else "cuerpo")
        hist.append(Pa(x["html"], est, plano=x["txt"]))
        i += 1
        continue
    if r == "pie":
        hist.append(Pa(x["html"], "pie", plano=x["txt"]))
        i += 1
        continue
    if r == "img":
        ruta, w, h = MAPA[x["ruta"]]
        pies, j = [], i + 1
        while j < len(B) and B[j]["rol"] == "pie":
            pies.append(Pa(B[j]["html"], "pie", plano=B[j]["txt"]))
            j += 1
        f = figura(ruta, w, h)
        grupo = [Spacer(1, 6), f] + pies
        if f.drawHeight + 30 + 20 * len(pies) < MARCO_H * 0.92:
            hist.append(KeepTogether(grupo))
        else:
            hist += grupo
        i = j
        continue
    if r == "lamina":
        ruta, w, h = MAPA[x["img"]]
        hist += [PageBreak(), figura(ruta, w, h)]
        if x.get("pie"):
            hist.append(Pa(x["pie"].replace("&", "&amp;"), "pie", plano=x["pie"]))
        i += 1
        if not (i < len(B) and B[i]["rol"] == "lamina"):
            hist.append(PageBreak())
        continue
    i += 1

# Índice propio, con enlaces internos. El del libro original lleva números de
# página que ya no valen, y sus puntos suspensivos los lee la voz uno a uno.
idx = [Pa("Índice", "capitulo")]
EST = {0: "indice1", 1: "indice2"}
for niv, tit, k in capitulos:
    if niv > 1:
        continue
    idx.append(Pa(f'<a href="#{k}" color="#14161a">{tit.replace("&", "&amp;")}</a>', EST[niv]))
hist[POS_INDICE:POS_INDICE] = idx

# Sin páginas en blanco: nunca dos saltos de página seguidos.
limpio = []
for f in hist:
    if isinstance(f, PageBreak):
        j = len(limpio) - 1
        while j >= 0 and isinstance(limpio[j], Spacer):
            j -= 1
        if j >= 0 and isinstance(limpio[j], PageBreak):
            del limpio[j + 1:]
            continue
        if j < 0:
            continue
    limpio.append(f)

doc = Libro(SALIDA, pagesize=A5, leftMargin=MI, rightMargin=MD, topMargin=MS,
            bottomMargin=MF, title=TITULO, author=AUTOR,
            subject="Edición adaptada para lectura en app", lang="es-ES")
doc.build(limpio)

# ReportLab ignora el kwarg `lang` (BaseDocTemplate no lo tiene) y el catálogo
# quedaba sin /Lang (medido en dos libros). Se fija con PyMuPDF tras compilar.
import pymupdf
_tmp = SALIDA + ".tmplang"
_dd = pymupdf.open(SALIDA)
_dd.xref_set_key(_dd.pdf_catalog(), "Lang", "(es-ES)")
_dd.save(_tmp, garbage=3, deflate=True)
_dd.close()
os.replace(_tmp, SALIDA)

print(f"{SALIDA}\npáginas: {doc.page} | {os.path.getsize(SALIDA)/1e6:.2f} MB | capítulos: {len(capitulos)}")
