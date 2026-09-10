# -*- coding: utf-8 -*-
"""JG Turbo · Paso 4 de 6 · Preparación de las imágenes

Los recortes que dejó el paso 2 están a 250 dpi y pesan una barbaridad. Aquí
se ajustan al ancho real que van a tener en la página nueva y se guarda cada
uno en el formato que le conviene:

  · dibujo de líneas (esquemas, diagramas) → PNG con paleta reducida. El JPEG
    les mete halos alrededor de las letras.
  · fotografía (escáneres cerebrales, retratos) → JPEG. Un PNG de una foto
    pesa cuatro veces más sin verse mejor.

También hace dos cosas que solo se descubren mirando el libro:
  · gira las láminas apaisadas (muchos cuadernillos a color van a 90°)
  · cose en una sola imagen los esquemas partidos entre dos páginas

    python3 4_imagenes.py
"""
import json, os, glob
from PIL import Image

P = json.load(open("perfil.json"))
B = json.load(open("bloques.json"))
os.makedirs("img", exist_ok=True)

DPI = 200.0
ANCHO_MARCO = 335.0        # puntos útiles de una página A5 con márgenes de 40

def preparar(ruta, ancho_pt, giro=0):
    im = Image.open(ruta).convert("RGB")
    if giro == -90:
        im = im.rotate(-90, expand=True)
    px = int(round(ancho_pt * DPI / 72.0))
    if px < im.width:
        im = im.resize((px, int(im.height * px / im.width)), Image.LANCZOS)
    peq = im.resize((min(im.width, 240), min(im.height, 240)))
    ncolores = len(peq.getcolors(maxcolors=100000) or [1] * 99999)
    dst = "img/" + os.path.basename(ruta).rsplit(".", 1)[0]
    if ncolores < 6000:
        im.quantize(colors=64, method=Image.MEDIANCUT).convert("P").save(dst + ".png", optimize=True)
        salida = dst + ".png"
    else:
        im.save(dst + ".jpg", "JPEG", quality=86, optimize=True, progressive=True)
        salida = dst + ".jpg"
    return salida, im.width, im.height

# ── Coser esquemas partidos entre dos páginas ─────────────────────────
COSER = [tuple(x) for x in (P.get("coser") or [])]
cosidos = {}
for a, b in COSER:
    fa = sorted(glob.glob(f"figuras/fig_{a:04d}_*.png"))
    fb = sorted(glob.glob(f"figuras/fig_{b:04d}_*.png"))
    if not fa or not fb:
        print(f"  aviso: no encontré las dos mitades de {a}+{b}")
        continue
    ia, ib = Image.open(fa[0]), Image.open(fb[0])
    w = max(ia.width, ib.width)
    out = Image.new("RGB", (w, ia.height + ib.height), "white")
    out.paste(ia, ((w - ia.width) // 2, 0))
    out.paste(ib, ((w - ib.width) // 2, ia.height))
    ruta = f"figuras/esq_{a:04d}.png"
    out.save(ruta)
    cosidos[fa[0]] = ruta
    cosidos[fb[0]] = None      # la segunda mitad desaparece
    print(f"  cosido {a}+{b} -> {ruta} ({out.size[0]}x{out.size[1]})")

# ── Portada original ──────────────────────────────────────────────────
if P.get("portada_original"):
    import pymupdf
    doc = pymupdf.open(P["ruta"])
    pag = doc[0]
    imgs = pag.get_images(full=True)
    if imgs:
        pix = pymupdf.Pixmap(doc, imgs[0][0])
        if pix.n > 3:
            pix = pymupdf.Pixmap(pymupdf.csRGB, pix)
        pix.save("portada_bruta.png")
    else:
        pag.get_pixmap(dpi=200).save("portada_bruta.png")
    im = Image.open("portada_bruta.png").convert("RGB")
    im.save("portada.jpg", "JPEG", quality=92, optimize=True)
    print(f"  portada original: {im.size[0]}x{im.size[1]} -> portada.jpg")

# ── Recortes y láminas ────────────────────────────────────────────────
mapa, bloques = {}, []
for x in B:
    if x["rol"] == "img":
        ruta = cosidos.get(x["ruta"], x["ruta"])
        if ruta is None:
            continue                       # mitad ya cosida en la anterior
        if ruta != x["ruta"]:
            im = Image.open(ruta)
            x["ancho"] = im.width * 72 / 300
            x["alto"] = im.height * 72 / 300
            x["ruta"] = ruta
        if ruta not in mapa:
            mapa[ruta] = preparar(ruta, min(ANCHO_MARCO, x["ancho"] * 1.4))
    elif x["rol"] == "lamina":
        if x["img"] not in mapa:
            mapa[x["img"]] = preparar(x["img"], ANCHO_MARCO, x.get("giro", 0))
    bloques.append(x)

json.dump(mapa, open("mapa_img.json", "w"))
json.dump(bloques, open("bloques.json", "w"), ensure_ascii=False)

def peso(carpeta):
    return sum(os.path.getsize(f) for f in glob.glob(carpeta + "/*")) / 1e6

print(f"imágenes: {len(mapa)}   originales {peso('figuras'):.1f} MB → optimizadas {peso('img'):.1f} MB")
