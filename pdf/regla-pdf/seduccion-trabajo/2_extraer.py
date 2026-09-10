# -*- coding: utf-8 -*-
"""JG Turbo · Paso 2 de 6 · Extracción estructurada

Lee `perfil.json` y `origen.pdf` y deja `crudo.json`: cada página con sus
líneas ya normalizadas, clasificadas (cuerpo, título, pie de figura) y con la
marca de dónde arranca cada párrafo. Aquí NO se une nada todavía: eso es el
paso 3. Aquí solo se decide, con la geometría delante.

    python3 2_extraer.py

Las tres cosas que se deciden aquí y que hay que entender:

1. FUSIÓN DE FRAGMENTOS (solo perfil «epub»). Al justificar, Calibre coloca
   cada palabra por separado. Sin fusionar por línea base, cada palabra parece
   una línea con su propia sangría y la detección de párrafos se vuelve loca.

2. CABECERA. Todo lo que esté por encima de `banda_cabecera` se tira. Es la
   causa número uno de que se cuele «el placebo eres tú 137» a mitad de
   párrafo. Si la banda vale 0, no se tira nada.

3. DÓNDE ARRANCA UN PÁRRAFO. Tres señales, por orden de fiabilidad:
   · la sangría de primera línea
   · el nivel de sangría del bloque (listas, citas, sangría francesa)
   · una línea que no llega al margen derecho cierra el párrafo
"""
import json, re, os, collections, unicodedata
import pymupdf

P = json.load(open("perfil.json"))
DOC = pymupdf.open(P["ruta"])
NPAG = len(DOC)
os.makedirs("figuras", exist_ok=True)

BASE = float(P["base"])
SANGRIA = float(P["sangria"] or (BASE + 14))
DERECHA = float(P["derecha"])
BANDA = float(P.get("banda_cabecera") or 0)
FUSIONAR = bool(P.get("fusionar_fragmentos"))
TAM_CUERPO = float(P["tam_cuerpo"])
TITULOS = sorted([float(t) for t in P.get("tam_titulos") or []], reverse=True)
TAM_CAP = TITULOS[0] if TITULOS else TAM_CUERPO + 6
TAM_SEC = TITULOS[-1] if TITULOS else TAM_CUERPO + 1.5
# Qué papel juega cada tamaño de título (lo propone el paso 1, se ajusta a mano)
JERARQUIA = {float(k): v for k, v in (P.get("jerarquia") or {}).items()}
NOTAS = P.get("notas_desde")
OMITIR = set(P.get("paginas_omitir") or [])
LAMINAS = set()
for x in P.get("laminas") or []:
    LAMINAS.update(range(x[0], x[1] + 1) if isinstance(x, (list, tuple)) else [x])
ESQUEMAS = {int(k): v for k, v in (P.get("esquemas") or {}).items()}
EMPEZAR = int(P.get("empezar_en") or 1)
FAMILIA = P.get("familia_cuerpo") or re.sub(r"[-,].*$", "", P.get("fuente_cuerpo", ""))

# ── Normalización de caracteres ───────────────────────────────────────
# Espacios raros, ligaduras y el guion suave (U+00AD) se van aquí. Si llegan
# al PDF nuevo, la app los lee como basura o parte palabras donde no toca.
SUST = {
    "­": "", "\t": " ",
    " ": " ", " ": " ", " ": " ", " ": " ", " ": " ",
    " ": " ", " ": " ", " ": " ", " ": " ", " ": " ",
    " ": " ", " ": " ", " ": " ", " ": " ",
    "ﬀ": "ff", "ﬁ": "fi", "ﬂ": "fl", "ﬃ": "ffi", "ﬄ": "ffl",
}

def norm(t):
    for a, b in SUST.items():
        t = t.replace(a, b)
    t = "".join(c for c in t if ord(c) >= 32)
    return re.sub(r" {2,}", " ", unicodedata.normalize("NFC", t))


FRANCESA_PAGINAS = set(P.get("francesa_paginas") or [])

def rol_linea(l):
    """Qué es esta línea. El tamaño manda; la negrita afina."""
    s = l["size"]
    for tam, papel in JERARQUIA.items():
        if abs(s - tam) < 0.4:
            # Parche de este libro: 18,7 en NEGRIA = sección de capítulo
            # («CLAVES DE PERSONALIDAD»); 18,7 normal = subtítulo de parte
            # o fase («LA PERSONALIDAD SEDUCTORA»).
            if papel == "capitulo_sub" and "Bold" in l["font"]:
                return "seccion"
            return papel
    if s >= TAM_CAP - 0.4:
        return "capitulo"
    if s >= TAM_SEC - 0.4 and s > TAM_CUERPO + 1:
        return "capitulo_sub"
    txt = l["txt"].strip()
    if not txt:
        return "cuerpo"
    # Parche de este libro: NO existe la regla «negrita + indentado =
    # sección»: aquí los EPÍGRAFES de capítulo van en negrita 15 pt
    # indentados (medido: p8 «mujeres se volvió menos áspero»), y todas las
    # secciones reales son 18,7 pt (ya clasificadas arriba por jerarquía).
    # Sin esto, cada cita abría página y marcador propio.
    if FAMILIA and not l["font"].startswith(FAMILIA):
        return "pie"            # otra familia tipográfica: rótulo de figura
    if s <= TAM_CUERPO - 1.2:
        return "cuerpo_min"     # notas al final, créditos, letra pequeña
    return "cuerpo"


def gira(pag):
    """-90 si el texto de la página está girado (láminas apaisadas)."""
    c = collections.Counter()
    for b in pag.get_text("dict")["blocks"]:
        if b["type"] != 0:
            continue
        for l in b["lines"]:
            c[tuple(round(v) for v in l["dir"])] += len("".join(s["text"] for s in l["spans"]))
    return -90 if c and c.most_common(1)[0][0] == (0, -1) else 0


def lineas_de(pag):
    brutas = []
    banderas = pymupdf.TEXTFLAGS_DICT & ~pymupdf.TEXT_PRESERVE_LIGATURES
    for b in pag.get_text("dict", flags=banderas)["blocks"]:
        if b["type"] != 0:
            continue
        for l in b["lines"]:
            spans = []
            for s in l["spans"]:
                t = norm(s["text"])
                if t:
                    spans.append({"t": t, "f": s["font"].split("+")[-1], "s": round(s["size"], 1)})
            if not spans or not "".join(s["t"] for s in spans).strip():
                continue
            brutas.append({"bbox": [round(v, 1) for v in l["bbox"]], "spans": spans})

    # Parche de este libro: Calibre partió 8 líneas justificadas en un
    # line-dict por palabra (verificado: no hay columnas ni diálogos lado a
    # lado). Se fusiona SIEMPRE por línea base, también en perfil editorial.
    brutas.sort(key=lambda l: (l["bbox"][3], l["bbox"][0]))
    filas, act = [], []
    for l in brutas:
        if act and abs(l["bbox"][3] - act[-1]["bbox"][3]) <= 2.5:
            act.append(l)
        else:
            if act:
                filas.append(act)
            act = [l]
    if act:
        filas.append(act)

    out = []
    for fila in filas:
        fila.sort(key=lambda l: l["bbox"][0])
        spans = []
        for k, l in enumerate(fila):
            if k > 0 and spans:
                izq, der = spans[-1]["t"], l["spans"][0]["t"]
                if izq and der and not izq.endswith(" ") and not der.startswith(" "):
                    spans[-1]["t"] = izq + " "
            spans.extend(l["spans"])
        fus = []
        for s in spans:
            if fus and fus[-1]["f"] == s["f"] and fus[-1]["s"] == s["s"]:
                fus[-1]["t"] += s["t"]
            else:
                fus.append(dict(s))
        bb = [min(l["bbox"][0] for l in fila), min(l["bbox"][1] for l in fila),
              max(l["bbox"][2] for l in fila), max(l["bbox"][3] for l in fila)]
        out.append({"bbox": [round(v, 1) for v in bb], "spans": fus,
                    "txt": "".join(s["t"] for s in fus),
                    "size": max(s["s"] for s in fus),
                    "font": max(fus, key=lambda s: len(s["t"]))["f"]})

    if gira(pag) == -90:
        out.sort(key=lambda l: (round(l["bbox"][0] / 3), -l["bbox"][3]))
    else:
        out.sort(key=lambda l: (round(l["bbox"][1] / 3), l["bbox"][0]))
    return out


def cajas_imagen(pag, minimo=18):
    cajas = []
    for b in pag.get_text("dict")["blocks"]:
        if b["type"] == 1:
            r = pymupdf.Rect(b["bbox"])
            if r.width > minimo and r.height > minimo:
                cajas.append(r)
    cambio = True
    while cambio:
        cambio = False
        for i in range(len(cajas)):
            for j in range(i + 1, len(cajas)):
                if (cajas[i] + (-6, -6, 6, 6)).intersects(cajas[j]):
                    cajas[i] |= cajas[j]
                    cajas.pop(j)
                    cambio = True
                    break
            if cambio:
                break
    return cajas


# ── Recorrido ─────────────────────────────────────────────────────────
elementos, stats = [], collections.Counter()
seg_previo = None      # nivel del bloque sangrado en curso (cruza páginas)
previa_corta = False   # la última línea no llegaba al margen derecho
cita_run_abierta = False  # parche de este libro: racha de cita en negrita

def proporcion_negrita(l):
    txt = l["txt"].strip()
    neg = sum(len(sp["t"].strip()) for sp in l["spans"] if "Bold" in sp["f"])
    return neg / max(1, len(txt))

def es_cita_negrita(l):
    """Epígrafes y citas largas de ESTE libro: cuerpo 15 pt en negrita e
    indentado. Medido en todo el libro: las citas arrancan en x0 ≥ 85; las
    entradillas en negrita-cursiva de párrafo (5 en todo el libro) van a la
    sangría de párrafo (x0 = 67,5) y NO son citas. Las líneas a pleno margen
    (prosa con énfasis) tampoco."""
    return (proporcion_negrita(l) >= 0.6
            and abs(l["size"] - TAM_CUERPO) < 0.4
            and l["bbox"][0] >= BASE + 38)

def es_atribucion(l):
    """La fuente de una cita: va en VERSALES al final de la cita."""
    letras = [c for c in l["txt"] if c.isalpha()]
    if len(letras) < 6:
        return False
    mayus = sum(1 for c in letras if c.isupper())
    return mayus / len(letras) >= 0.8

for i in range(EMPEZAR - 1, NPAG):
    npag = i + 1
    if npag in OMITIR:
        stats["omitidas"] += 1
        continue
    pag = DOC[i]
    lns = lineas_de(pag)
    imgs = cajas_imagen(pag)

    # --- Lámina a página completa: la página entera es una figura ---
    if npag in LAMINAS or (imgs and sum(r.get_area() for r in imgs) > 0.55 * pag.rect.get_area()):
        ruta = f"figuras/lam_{npag:04d}.png"
        if not os.path.exists(ruta):
            pag.get_pixmap(dpi=200).save(ruta)
        pie = re.sub(r"\s{2,}", " ", " ".join(l["txt"].strip() for l in lns)).strip()
        elementos.append({"tipo": "lamina", "pag": npag, "img": ruta,
                          "pie": pie, "giro": gira(pag)})
        stats["laminas"] += 1
        seg_previo, previa_corta = None, False
        continue

    # --- Qué líneas pertenecen a una figura ---
    en_fig = set()
    for k, l in enumerate(lns):
        r = pymupdf.Rect(l["bbox"])
        for c in imgs:
            dentro = (r & c).get_area() > 0.45 * r.get_area()
            rotulo = ((c + (-6, -14, 6, 16)) & r).get_area() > 0.6 * r.get_area()
            if dentro or rotulo:
                en_fig.add(k)
                break
    if npag in ESQUEMAS:
        y0e, y1e = ESQUEMAS[npag]
        for k, l in enumerate(lns):
            if l["bbox"][3] > y0e and l["bbox"][1] < y1e:
                en_fig.add(k)
        imgs = [pymupdf.Rect(0, max(0, y0e - 4), pag.rect.width,
                             min(pag.rect.height, y1e))]

    # --- Cabecera fuera ---
    cabecera = {k for k, l in enumerate(lns)
                if BANDA and l["bbox"][3] < BANDA and k not in en_fig}
    stats["lineas_cabecera"] += len(cabecera)

    # --- Recorte de las figuras ---
    figs = []
    for c in imgs:
        clip = pymupdf.Rect(c)
        cerca = c + (-12, -22, 12, 26)
        for k in en_fig:
            rk = pymupdf.Rect(lns[k]["bbox"])
            anchoL = max(1, rk.width)
            if (cerca & rk).get_area() > 0.6 * rk.get_area() and anchoL <= 1.05 * c.width:
                clip |= rk
        clip = (clip + (-5, -5, 5, 7)) & pag.rect
        ruta = f"figuras/fig_{npag:04d}_{int(clip.y0)}.png"
        if not os.path.exists(ruta):
            pag.get_pixmap(clip=clip, dpi=250).save(ruta)
        figs.append({"ruta": ruta, "y": clip.y0, "alto": clip.height, "ancho": clip.width})
    stats["figuras"] += len(figs)

    cuerpo = [l for k, l in enumerate(lns) if k not in en_fig and k not in cabecera]
    if not cuerpo and not figs:
        continue
    for l in cuerpo:
        l["rol"] = rol_linea(l)
        l["pag"] = npag
    cps = [l for l in cuerpo if l["rol"].startswith("cuerpo")]

    # ── Dónde arranca cada párrafo ────────────────────────────────────
    if NOTAS and npag >= NOTAS:
        # Las notas finales de un EPUB no llevan sangría: cada una empieza
        # con su marcador [n]. Sin esta regla se funden en un solo párrafo.
        for l in cps:
            l["arranca"] = bool(re.match(r"^\s*\[\d+\]", l["txt"]))
            l["nivel"] = 0
        seg_previo, previa_corta = None, False

    elif FUSIONAR:
        # Perfil EPUB: los niveles son globales y estables.
        def clase(l):
            x, xr = l["bbox"][0], l["bbox"][2]
            if abs(x - BASE) <= 3:
                return "base"
            if abs(x - SANGRIA) <= 3 and xr >= DERECHA - 12:
                return "sangria"
            return "otro"
        n = len(cps)
        k = 0
        while k < n:
            if clase(cps[k]) != "otro":
                cps[k]["arranca"] = (clase(cps[k]) == "sangria") or previa_corta
                cps[k]["nivel"] = 0
                previa_corta = (cps[k]["bbox"][2] < DERECHA - 8
                                and not cps[k]["txt"].rstrip().endswith("-"))
                seg_previo = None
                k += 1
            else:
                j = k
                while j < n and clase(cps[j]) == "otro":
                    j += 1
                seg = cps[k:j]
                borde = max(l["bbox"][2] for l in seg)
                mrg = min(l["bbox"][0] for l in seg)
                nivel = 0 if (len(seg) == 1 and abs(mrg - SANGRIA) <= 3) else (1 if mrg >= BASE + 9 else 0)
                for u, l in enumerate(seg):
                    if u == 0:
                        sigue = (seg_previo is not None and l["bbox"][1] < 20 and not previa_corta)
                        l["arranca"] = not sigue
                    else:
                        # En texto justificado, una línea corta cierra párrafo.
                        l["arranca"] = seg[u - 1]["bbox"][2] < borde - 8
                    l["nivel"] = nivel
                seg_previo = seg[-1]["bbox"][0]
                previa_corta = (seg[-1]["bbox"][2] < borde - 8
                                and not seg[-1]["txt"].rstrip().endswith("-"))
                k = j

    else:
        # Perfil EDITORIAL: el margen se mide por página (las pares y las
        # impares no coinciden) y las citas se reconocen porque van sangradas
        # Y con el margen derecho más corto.
        xs = [l["bbox"][0] for l in cps]
        margen = min(xs) if xs else BASE
        derecha_p = max([l["bbox"][2] for l in cps], default=DERECHA)
        minis = [l for l in cuerpo if l["rol"] == "cuerpo_min"]
        francesa = False
        if len(xs) >= 5 and len(minis) > 0.7 * len(xs):
            moda = collections.Counter(round(x) for x in xs).most_common(1)[0][0]
            en_margen = sum(1 for x in xs if x - min(xs) <= 6)
            francesa = (moda - min(xs)) > 6 and en_margen < 0.45 * len(xs)

        esang = [((l["bbox"][0] - margen) >= 10 and l["bbox"][2] <= derecha_p - 5) for l in cps]
        cita = [False] * len(cps)
        # Parche de este libro: la bibliografía final (pp. 543-546) va en
        # sangría francesa (primera línea al margen, continuaciones
        # sangradas): la regla normal de «sangría = párrafo nuevo» la
        # destrozaría renglón a renglón.
        if npag in FRANCESA_PAGINAS:
            francesa = True
        k = 0 if not francesa else len(cps)
        while k < len(cps):
            if esang[k]:
                j = k
                while j < len(cps) and esang[j]:
                    j += 1
                if (j - k) >= 2:
                    hueco = (cps[k]["bbox"][1] - cps[k - 1]["bbox"][3]) if k > 0 else 99
                    if (j - k) >= 3 or hueco > 20:
                        for t in range(k, j):
                            cita[t] = True
                k = j
            else:
                k += 1

        t = 0
        while t < len(cps):
            if cita[t]:
                j = t
                while j < len(cps) and cita[j]:
                    j += 1
                sub = cps[t:j]
                mrg = min(l["bbox"][0] for l in sub)
                for l in sub:
                    l["nivel"] = 1
                    l["arranca"] = (l["bbox"][0] - mrg) > 6
                t = j
            else:
                l = cps[t]
                l["nivel"] = 0
                if francesa:
                    l["arranca"] = (l["bbox"][0] - margen) <= 6
                else:
                    l["arranca"] = (l["bbox"][0] - margen) > 6
                if t > 0 and cita[t - 1]:
                    l["arranca"] = True
                t += 1

        # ── Parche de este libro: epígrafes y citas en negrita ──────
        # Forman UN párrafo continuo por racha (nivel 1 = cita). Solo
        # abre párrafo la primera línea de la racha, una atribución en
        # versales, o un salto vertical grande (nueva cita tras un hueco).
        stats["lineas_cita_negrita"] += 0
        u = 0
        while u < len(cps):
            if es_cita_negrita(cps[u]):
                v = u
                while v < len(cps) and es_cita_negrita(cps[v]):
                    v += 1
                racha = cps[u:v]
                stats["lineas_cita_negrita"] += len(racha)
                for w, l in enumerate(racha):
                    l["nivel"] = 1
                    if w == 0:
                        l["arranca"] = not cita_run_abierta
                    elif es_atribucion(l):
                        l["arranca"] = True
                    elif w > 0 and (l["bbox"][1] - racha[w - 1]["bbox"][3]) > 30:
                        l["arranca"] = True
                    else:
                        l["arranca"] = False
                cita_run_abierta = (v == len(cps))
                u = v
            else:
                cita_run_abierta = False
                u += 1

    for l in cuerpo:
        if not l["rol"].startswith("cuerpo"):
            l["arranca"] = True
            l["nivel"] = 0
        l.setdefault("arranca", False)
        l.setdefault("nivel", 0)
        l["corto"] = l["bbox"][2] < 0.80 * DERECHA

    elementos.append({"tipo": "pagina", "pag": npag, "lineas": cuerpo, "figs": figs})

json.dump({"elementos": elementos, "stats": dict(stats)},
          open("crudo.json", "w"), ensure_ascii=False)
print("páginas procesadas:", sum(1 for e in elementos if e["tipo"] == "pagina"))
print("stats:", dict(stats))
