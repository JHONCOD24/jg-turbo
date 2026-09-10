# -*- coding: utf-8 -*-
"""JG Turbo · Paso 3 de 6 · Reconstrucción de párrafos

Lee `crudo.json` y deja `bloques.json`: el libro en párrafos de verdad, con
las cursivas y negritas conservadas y sin una sola palabra partida.

    python3 3_reflujo.py

Aquí ocurre LA decisión delicada del proceso: qué hacer con un guion al final
de renglón. Depende del perfil y no admite atajos:

  · perfil «editorial»  → el guion casi siempre es partición de sílabas. Se
    une, pero comprobando contra un diccionario construido con las palabras
    del propio libro. Si lo que sigue al corte empieza en MAYÚSCULA, es un
    guion real (en español ninguna palabra partida continúa con mayúscula).

  · perfil «epub» → la conversión NO parte palabras. TODO guion al final de
    renglón es real: no se une jamás. Unirlos destroza «hombre-mujer»,
    «asco-repulsión» o «Self-Perceptions».
"""
import json, re, collections, unicodedata

P = json.load(open("perfil.json"))
D = json.load(open("crudo.json"))
ELS = D["elementos"]
PARTE_SILABAS = bool(P.get("particion_silabas"))
NOTAS = P.get("notas_desde")
UMBRAL_SALTO = 14.0 if P.get("fusionar_fragmentos") else 7.0

# ── Diccionario del propio libro ──────────────────────────────────────
def limpia_pal(p):
    return re.sub(r"^[^\wáéíóúüñÁÉÍÓÚÜÑ-]+|[^\wáéíóúüñÁÉÍÓÚÜÑ-]+$", "", p).lower()

VOCAB = collections.Counter()
for e in ELS:
    if e["tipo"] != "pagina":
        continue
    for l in e["lineas"]:
        t = l["txt"].strip()
        pals = t.split()
        if not pals:
            continue
        if t.endswith("-"):
            pals = pals[:-1]     # esa palabra está partida: no cuenta
        for p in pals:
            w = limpia_pal(p)
            if w:
                VOCAB[w] += 1

CORTES = collections.Counter()
DUDOSOS = []
UNIONES_BORDE = []

def une_borde(izq, der, pag):
    """Parche de este libro: los pasajes «Símbolo» centrados vienen con
    palabras partidas SIN guion en el borde de línea (medido: «pa|sado»,
    «de|saparecen», «capac|dad»). Si la palabra unida existe en el propio
    libro, se une; si no, espacio normal. Solo se aplica en citas (nivel 1)
    y cada unión queda registrada para revisión.

    Devuelve (texto_para_izq, caracteres_consumidos_de_der)."""
    a = re.search(r"([a-záéíóúüñ]{2,})$", izq)
    b = re.match(r"^([a-záéíóúüñ]{3,})", der)
    if a and b:
        junto = limpia_pal(a.group(1) + b.group(1))
        # Si AMBAS partes son palabras reales del libro («mal|humor»,
        # «con|que»), son dos palabras: no se tocan. Solo se une cuando
        # una de las dos no existe por sí sola (es un fragmento).
        if (len(junto) >= 6 and VOCAB.get(junto, 0) >= 2
                and not (VOCAB.get(limpia_pal(a.group(1)), 0) >= 2
                         and VOCAB.get(limpia_pal(b.group(1)), 0) >= 2)):
            UNIONES_BORDE.append((pag, a.group(1) + "|" + b.group(1), junto))
            CORTES["union_borde"] += 1
            return izq[:a.start()] + a.group(1) + b.group(1), b.end()
    return izq + " ", 0

def une_guion(izq, der, pag):
    if not PARTE_SILABAS:
        CORTES["guion_real"] += 1
        return izq + der
    m = re.search(r"([\wáéíóúüñÁÉÍÓÚÜÑ]+)-$", izq)
    m2 = re.match(r"^([\wáéíóúüñÁÉÍÓÚÜÑ]+)", der)
    if not m or not m2:
        return izq + " " + der
    a, b = m.group(1), m2.group(1)
    if b[0].isupper():
        CORTES["guion_real"] += 1
        return izq + der
    junto = limpia_pal(a + b)
    conguion = limpia_pal(a + "-" + b)
    if VOCAB.get(junto, 0) > 0:
        CORTES["union"] += 1
        return izq[:-1] + der
    if VOCAB.get(conguion, 0) > 0:
        CORTES["guion_real"] += 1
        return izq + der
    CORTES["dudoso"] += 1
    if len(DUDOSOS) < 500:
        DUDOSOS.append((pag, a + "-" + b, a + b))
    return izq[:-1] + der      # lo normal en un libro: era partición

# ── Estilos ───────────────────────────────────────────────────────────
def marca(spans):
    partes = []
    for s in spans:
        it = ("It" in s["f"]) or ("Italic" in s["f"]) or ("Ita" in s["f"])
        bd = ("Bold" in s["f"]) or ("Semibold" in s["f"]) or ("Black" in s["f"])
        partes.append(("bi" if it and bd else "i" if it else "b" if bd else "", s["t"]))
    fus = []
    for st, t in partes:
        if fus and fus[-1][0] == st:
            fus[-1][1] += t
        else:
            fus.append([st, t])
    return fus

ETQ = {"": ("", ""), "i": ("<i>", "</i>"), "b": ("<b>", "</b>"), "bi": ("<b><i>", "</i></b>")}

def a_html(fus):
    out = []
    for st, t in fus:
        t = t.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
        a, b = ETQ[st]
        out.append(a + t + b if t.strip() else t)
    # El ebook original marcaba el fin de verso con una barra invertida;
    # 2b_parchear la convirtió en \n. En el PDF se renderiza como salto.
    return "".join(out).replace("\n", "<br/>")

# ── Agrupar líneas en bloques ─────────────────────────────────────────
bloques = []
abierto = None      # párrafo de cuerpo aún abierto (sobrevive a las páginas)
ultimo = None       # último bloque añadido (para títulos de varias líneas)
TITULOS = ("capitulo", "capitulo_sub", "seccion", "pie")

def nuevo_bloque(rol, ln):
    global ultimo
    bloques.append({"rol": rol, "lineas": [ln], "pag": ln["pag"], "nivel": ln.get("nivel", 0)})
    ultimo = bloques[-1]
    return bloques[-1]

for e in ELS:
    if e["tipo"] == "lamina":
        bloques.append({"rol": "lamina", "img": e["img"], "pie": e.get("pie", ""),
                        "pag": e["pag"], "giro": e.get("giro", 0)})
        abierto, ultimo = None, bloques[-1]
        continue
    lns = e["lineas"]
    figs = sorted(e["figs"], key=lambda f: f["y"])
    fi = 0
    for ln in lns:
        while fi < len(figs) and figs[fi]["y"] < ln["bbox"][1]:
            bloques.append({"rol": "img", **figs[fi], "pag": e["pag"]})
            fi += 1
            ultimo = bloques[-1]
        r = ln["rol"]
        if r in TITULOS:
            prev = ultimo["lineas"][-1] if (ultimo and "lineas" in ultimo) else None
            junta = False
            if prev is not None and ultimo.get("rol") == r:
                if ultimo["pag"] == ln["pag"]:
                    junta = abs(prev["bbox"][3] - ln["bbox"][1]) < 12
                elif ln["pag"] - prev["pag"] == 1:
                    # título partido entre dos páginas diminutas de un EPUB
                    junta = prev["bbox"][3] > 300 and ln["bbox"][1] < 22
            if junta:
                ultimo["lineas"].append(ln)
            else:
                nuevo_bloque(r, ln)
            if r != "pie":
                abierto = None      # un título corta el párrafo; un pie no
            continue

        salto = None
        if abierto is not None and abierto["pag"] == ln["pag"]:
            salto = ln["bbox"][1] - abierto["lineas"][-1]["bbox"][3]
        arranca = (ln.get("arranca") or ln["txt"].lstrip().startswith("•")
                   or abierto is None
                   or abierto["rol"] != r
                   or abierto["lineas"][-1].get("nivel", 0) != ln.get("nivel", 0)
                   or (salto is not None and salto > UMBRAL_SALTO))
        if arranca:
            abierto = nuevo_bloque(r, ln)
        else:
            abierto["lineas"].append(ln)
    while fi < len(figs):
        bloques.append({"rol": "img", **figs[fi], "pag": e["pag"]})
        fi += 1
        ultimo = bloques[-1]

# ── Unir las líneas de cada bloque ────────────────────────────────────
salida = []
for b in bloques:
    if b["rol"] in ("img", "lamina"):
        salida.append(b)
        continue
    fus = []
    for k, ln in enumerate(b["lineas"]):
        m = marca(ln["spans"])
        if k == 0:
            fus = [list(x) for x in m]
            continue
        izq = fus[-1][1].rstrip(" ")
        der = m[0][1].lstrip(" ")
        if izq.endswith("-"):
            unido = une_guion(izq, der, ln["pag"])
            if fus[-1][0] == m[0][0]:
                fus[-1][1] = unido
                m = m[1:]
            else:
                fus[-1][1] = izq if not PARTE_SILABAS else izq[:-1]
                m = [list(x) for x in m]
                m[0][1] = der
        else:
            if b.get("nivel") == 1:
                texto, consumido = une_borde(izq, der, ln["pag"])
                fus[-1][1] = texto
                m = [list(x) for x in m]
                m[0][1] = der[consumido:]
            else:
                fus[-1][1] = izq + " "
                m = [list(x) for x in m]
                m[0][1] = der
        for st, t in m:
            if fus and fus[-1][0] == st:
                fus[-1][1] += t
            else:
                fus.append([st, t])
    if not fus:
        continue
    fus[0][1] = fus[0][1].lstrip()
    fus[-1][1] = fus[-1][1].rstrip()
    if NOTAS and b["pag"] >= NOTAS:
        # «<<» es el enlace de vuelta que deja Calibre al final de cada nota.
        # No es del libro y el lector de voz lo lee como ruido.
        for pz in fus:
            pz[1] = re.sub(r"\s*<<\s*", " ", pz[1])
        fus[-1][1] = fus[-1][1].rstrip()
    txt = re.sub(r"[ \t]{2,}", " ", "".join(t for _, t in fus)).strip()
    if not txt:
        continue
    salida.append({"rol": b["rol"], "pag": b["pag"], "nivel": b.get("nivel", 0),
                   "txt": txt, "html": a_html(fus)})

json.dump(salida, open("bloques.json", "w"), ensure_ascii=False)
print("bloques:", len(salida))
print("guiones ->", dict(CORTES))
print("vocabulario del libro:", len(VOCAB), "palabras distintas")
print("roles:", dict(collections.Counter(x["rol"] for x in salida)))
if DUDOSOS:
    print("\n-- uniones sin respaldo del diccionario (revisa una muestra) --")
    for pag, a, b in DUDOSOS[:15]:
        print(f"   p{pag:<5d} {a:34s} -> {b}")
if UNIONES_BORDE:
    print(f"\n-- palabras unidas en el borde de línea ({len(UNIONES_BORDE)}) --")
    for pag, a, b in UNIONES_BORDE[:30]:
        print(f"   p{pag:<5d} {a:26s} -> {b}")
