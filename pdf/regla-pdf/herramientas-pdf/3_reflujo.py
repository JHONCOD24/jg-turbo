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

# Glosario del perfil: compuestos con guion propios del libro. Se define tras
# limpia_pal/VOCAB pero se usa en tiempo de ejecución (une_guion y bucles).
def _glosario():
    out = set()
    for g in P.get("glosario_compuestos") or []:
        w = limpia_pal(str(g))
        if w:
            out.add(w)
    return out

GLOSARIO = _glosario()

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
    # Glosario del perfil (nombres y términos del libro): manda sobre el
    # vocabulario observado («Sherwin-Williams» aunque solo salga partido).
    if conguion in GLOSARIO:
        CORTES["guion_real"] += 1
        return izq + der
    if VOCAB.get(junto, 0) > 0:
        CORTES["union"] += 1
        return izq[:-1] + der
    if VOCAB.get(conguion, 0) > 0:
        CORTES["guion_real"] += 1
        return izq + der
    CORTES["dudoso"] += 1
    if len(DUDOSOS) < 500:
        DUDOSOS.append((pag, a + "-" + b, a + b))
    # Si AMBAS partes existen como palabras completas en el propio libro, el
    # guion no parte una sílaba: cierra un inciso («ha dado- permite» ->
    # «ha dado — permite»). Une solo cuando la unión tiene sentido.
    if VOCAB.get(limpia_pal(a), 0) > 0 and VOCAB.get(limpia_pal(b), 0) > 0:
        CORTES["inciso"] += 1
        return izq[:-1] + " — " + der
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
    return "".join(out)

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
            abierto = None      # cualquier título o pie corta el párrafo en curso
            continue

        salto = None
        if abierto is not None and abierto["pag"] == ln["pag"]:
            salto = ln["bbox"][1] - abierto["lineas"][-1]["bbox"][3]
        if abierto is not None:
            if abierto["pag"] == ln["pag"]:
                salto = ln["bbox"][1] - abierto["lineas"][-1]["bbox"][3]
            else:
                prev_txt = abierto["lineas"][-1]["txt"].strip()
                derecha_b = float(P.get("derecha") or 480)
                prev_corta = (abierto["lineas"][-1]["bbox"][2] < derecha_b - 25)
                if prev_corta and prev_txt and prev_txt[-1] in ".?!»”:":
                    abierto = None
        arranca = (ln.get("arranca") or ln["txt"].lstrip().startswith("•")
                   or abierto is None
                   or abierto is not ultimo
                   or abierto["rol"] != r
                   or abierto["lineas"][-1].get("nivel", 0) != ln.get("nivel", 0)
                   or (salto is not None and salto > UMBRAL_SALTO))
        if arranca:
            # Una palabra cortada con guion al final de renglón nunca arranca bloque nuevo
            if abierto is not None and abierto["lineas"][-1]["txt"].rstrip().endswith("-") and (salto is None or salto <= UMBRAL_SALTO * 1.6):
                arranca = False
        if arranca or abierto is not ultimo:
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
        izq = fus[-1][1].rstrip()
        der = m[0][1].lstrip()
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
    # «<<» es el enlace de vuelta que deja Calibre al final de cada nota (y a
    # veces en el cuerpo). No es del libro y el lector de voz lo lee como
    # ruido: se quita siempre, no solo con notas_desde.
    for pz in fus:
        pz[1] = re.sub(r"\s*<<\s*", " ", pz[1])
    fus[-1][1] = fus[-1][1].rstrip()
    for pz in fus:
        pz[1] = re.sub(r"(?<=\s)-(?=[\wáéíóúüñÁÉÍÓÚÜÑ])", "—", pz[1])
        pz[1] = re.sub(r"(?<=[\wáéíóúüñÁÉÍÓÚÜÑ])-(?=\s)", "—", pz[1])
    txt = re.sub(r"[ \t]{2,}", " ", "".join(t for _, t in fus)).strip()
    if not txt:
        continue
    salida.append({"rol": b["rol"], "pag": b["pag"], "nivel": b.get("nivel", 0),
                   "txt": txt, "html": a_html(fus)})

# Unir palabras partidas entre páginas a través de notas al pie intercaladas.
# También vale para títulos partidos («Sherwin-» + «Williams»): un bloque que
# termina en guion de partición se une con el siguiente bloque de TEXTO
# (cualquiera que sea el rol del primero), no solo cuerpo con cuerpo.
ROLES_TEXTO = ("cuerpo", "cuerpo_min", "capitulo", "capitulo_sub", "seccion", "cita", "pie")

def _cola_html(html, w1, nuevo):
    """Reemplaza «w1-» al final del html por `nuevo`, tolerando etiquetas de
    cierre (</b>, </i>): el `$` solo no matchea «<b>Sherwin-</b>» y el PDF
    pintaría lo viejo mientras el txt ya cambió (medido en Posicionamiento)."""
    return re.sub(re.escape(w1) + r"-(?=(?:<[^>]+>)*\s*$)", lambda _m: nuevo, html.rstrip())

def _cabeza_html(html, w2):
    """Quita «w2» + espacios del inicio del html, preservando etiquetas."""
    return re.sub(r"^((?:<[^>]+>|\s)*)" + re.escape(w2) + r"\s*", r"\1", html.lstrip())
for i in range(len(salida) - 1):
    b1 = salida[i]
    if b1["rol"] in ROLES_TEXTO:
        m = re.search(r"([\wáéíóúüñÁÉÍÓÚÜÑ]+)-$", b1["txt"])
        if m:
            # La continuación de un TÍTULO partido está justo después; para
            # cuerpo se mira más lejos (notas al pie intercaladas). Unir con
            # un bloque lejano inventa palabras («Sherwinmejores»).
            ventana = 3 if b1["rol"] in ("capitulo", "capitulo_sub", "seccion") else 10
            for j in range(i + 1, min(i + ventana, len(salida))):
                b2 = salida[j]
                if b2["rol"] not in ROLES_TEXTO:
                    continue
                if not (b2.get("txt") or "").strip():
                    continue
                m2 = re.match(r"^([\wáéíóúüñÁÉÍÓÚÜÑ]+)", b2["txt"])
                if not m2:
                    continue      # este bloque no continúa la palabra: seguir buscando
                w1, w2 = m.group(1), m2.group(1)
                # Un bloque de 1-2 palabras que termina en punto («mejores.»)
                # no es la continuación de una sílaba: es el final del párrafo
                # anterior. Se salta para no inventar («Sherwinmejores»).
                if len(b2["txt"].split()) <= 2 and re.search(r"[.!?…;:]$", b2["txt"].strip()):
                    continue
                # En español ninguna palabra partida continúa con mayúscula:
                # si el compuesto con guion existe en el libro o el glosario
                # («Sherwin-Williams») se conserva; si no, es inciso o título.
                if w2[0].isupper():
                    if (VOCAB.get(limpia_pal(w1) + "-" + limpia_pal(w2), 0) > 0
                            or (limpia_pal(w1) + "-" + limpia_pal(w2)) in GLOSARIO):
                        b1["txt"] = b1["txt"][: -len(w1) - 1] + w1 + "-" + w2
                        b1["html"] = _cola_html(b1["html"], w1, w1 + "-" + w2)
                        b2["txt"] = b2["txt"][len(w2):].lstrip()
                        b2["html"] = _cabeza_html(b2["html"], w2)
                    else:
                        b1["txt"] = b1["txt"][: -len(w1) - 1] + w1 + " —"
                        b1["html"] = _cola_html(b1["html"], w1, w1 + " —")
                    break
                completa1 = VOCAB.get(limpia_pal(w1), 0) > 0
                completa2 = VOCAB.get(limpia_pal(w2), 0) > 0
                if completa1 and completa2:
                    # Inciso que cierra en el corte: guion real con em-dash.
                    b1["txt"] = b1["txt"][: -len(w1) - 1] + w1 + " —"
                    b1["html"] = _cola_html(b1["html"], w1, w1 + " —")
                else:
                    w_unida = w1 + w2
                    # Actualizar txt
                    b1["txt"] = b1["txt"][:-len(w1)-1] + w_unida
                    b2["txt"] = b2["txt"][len(w2):].lstrip()
                    # Actualizar html
                    b1["html"] = _cola_html(b1["html"], w1, w_unida)
                    b2["html"] = _cabeza_html(b2["html"], w2)
                    print(f"   p{b1['pag']} corte entre páginas a través de notas: {w1}-{w2} -> {w_unida}")
                break

json.dump(salida, open("bloques.json", "w"), ensure_ascii=False)
print("bloques:", len(salida))
print("guiones ->", dict(CORTES))
print("vocabulario del libro:", len(VOCAB), "palabras distintas")
print("roles:", dict(collections.Counter(x["rol"] for x in salida)))
if DUDOSOS:
    print("\n-- uniones sin respaldo del diccionario (revisa una muestra) --")
    for pag, a, b in DUDOSOS[:15]:
        print(f"   p{pag:<5d} {a:34s} -> {b}")
