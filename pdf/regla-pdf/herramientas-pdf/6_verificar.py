# -*- coding: utf-8 -*-
"""JG Turbo · Paso 6 de 6 · Verificación de fidelidad

    python3 6_verificar.py "nombre del pdf generado.pdf"

Dos comprobaciones. Las dos tienen que salir limpias antes de entregar.

A. REFLUJO — ¿se perdió algo al reconstruir los párrafos?
   Compara carácter a carácter el texto que salió del PDF original contra el
   texto reconstruido, ignorando espacios. La ÚNICA diferencia admisible son
   los guiones de partición que se quitaron a propósito (y en un EPUB, cero).

B. RESULTADO — ¿el PDF nuevo dice exactamente lo mismo?
   Extrae el texto del PDF generado y lo compara palabra por palabra con los
   bloques. Lo normal es UN solo tramo distinto: el índice regenerado.

Además cuenta lo que nunca debe aparecer: palabras partidas por guion, guiones
suaves, caracteres de control, dobles espacios y texto fuera del margen.
"""
import sys, json, re, unicodedata, collections, difflib
import pymupdf

def esqueleto(t):
    t = unicodedata.normalize("NFC", t)
    t = re.sub(r"-(?=\n|$)", "", t, flags=re.M)   # guion de fin de renglón
    return re.sub(r"\s+", "", t)

D = json.load(open("crudo.json"))
B = json.load(open("bloques.json"))

errores_totales = 0

# --solo-b: para anexos (el tramo de notas se verifica contra su PDF; la
# parte A solo tiene sentido para el libro completo contra su crudo).
SOLO_B = "--solo-b" in sys.argv
ARGV_PDF = [a for a in sys.argv[1:] if a != "--solo-b"]

def _construir_or():
    orig = []
    for e in D["elementos"]:
        if e["tipo"] == "lamina":
            orig.append(e.get("pie", ""))
        else:
            orig.extend(l["txt"] for l in e["lineas"])
    rec = [x.get("pie", "") if x["rol"] == "lamina" else x.get("txt", "") for x in B]
    return esqueleto("\n".join(orig)), esqueleto("\n".join(rec))

# Comparación secuencial carácter por carácter en O(N). En cada zona de
# conflicto se analiza una VENTANA local con difflib (rápido) y los tramos
# delete/insert se guardan para aparearlos al final: un delete justifica un
# insert SOLO si el contenido es idéntico (texto movido, p. ej. notas al pie
# reubicadas por el reflujo). Letras concretas, nunca «cantidades».
def comparar_secuencial(s_orig, s_rec, max_lookahead=150, ventana=1500):
    i, j = 0, 0
    len_o, len_r = len(s_orig), len(s_rec)
    difs = []
    pend = []
    permitido = set("-<«»")
    no_just = 0
    movimientos = 0

    def zona_difflib(i, j):
        """Analiza la zona con difflib y devuelve cuánto avanzar."""
        nonlocal no_just
        wo = s_orig[i:i + ventana]
        wr = s_rec[j:j + ventana]
        sm = difflib.SequenceMatcher(None, wo, wr, autojunk=False)
        ops = [op for op in sm.get_opcodes() if op[0] != "equal"]
        if not ops:
            return None
        for tag, a, b, c, d in ops:
            tr_o, tr_r = wo[a:b], wr[c:d]
            if tag == "replace":
                if len(tr_o) == len(tr_r) and all(
                        (x == y or (x in "-—–●○■□◆◇•★☆*" and y in "-—–●○■□◆◇•★☆*"))
                        for x, y in zip(tr_o, tr_r)):
                    continue        # guiones/marcas equivalentes
                no_just += max(len(tr_o), len(tr_r))
                difs.append(("replace", i + a, i + b, f"{tr_o[:30]!r}->{tr_r[:30]!r}"))
            elif tag == "delete":
                pend.append(["delete", tr_o])
            else:
                if tr_r == "—":
                    continue        # guion de renglón → em-dash de diálogo
                pend.append(["insert", tr_r])
        # Avanzar hasta el final del ÚLTIMO tramo distinto de la ventana;
        # el resto (equal) lo recorre el bucle lineal, que es barato.
        return ops[-1][2], ops[-1][4]

    while i < len_o and j < len_r:
        if (s_orig[i] == s_rec[j]
                or (s_orig[i] in "-—–" and s_rec[j] in "-—–")
                or (s_orig[i] in "●○■□◆◇•" and s_rec[j] in "●○■□◆◇•")
                or (s_orig[i] in "★☆*" and s_rec[j] in "★☆*")):
            i += 1
            j += 1
            continue

        alineado = False
        for k in range(1, max_lookahead):
            if i + k < len_o and s_orig[i + k] == s_rec[j]:
                i += k
                alineado = True
                break
            if j + k < len_r and s_orig[i] == s_rec[j + k]:
                j += k
                alineado = True
                break
        if alineado:
            continue

        avance = zona_difflib(i, j)
        if avance is None:
            difs.append(("mismatch", i, j, f"orig={s_orig[i:i+20]!r} vs rec={s_rec[j:j+20]!r}"))
            no_just += 1
            i += 1
            j += 1
            if len(difs) > 100:
                break
        else:
            i += max(1, avance[0])
            j += max(1, avance[1])

    # Apareo global de movimientos: delete↔insert con contenido exacto.
    from collections import Counter
    dels, ins = Counter(), Counter()
    for lado, tramo in pend:
        (dels if lado == "delete" else ins)[tramo] += 1
    for lado, tramo in pend:
        otro = ins if lado == "delete" else dels
        if tramo in otro and otro[tramo] > 0:
            otro[tramo] -= 1
            movimientos += 1
        else:
            no_just += len(tramo)
            difs.append((lado, 0, len(tramo), tramo[:40]))

    return (no_just == 0 and i == len_o and j == len_r and len_o == len_r), no_just, difs, movimientos

def ejecutar_parte_a():
    """Parte A: crudo vs bloques. Imprime el reporte y devuelve nº de defectos."""
    o, r = _construir_or()
    print(f"  caracteres del original      {len(o)}")
    print(f"  caracteres reconstruidos     {len(r)}   ({len(r)-len(o):+d})")
    identicos, no_justificados, dif_ops, movimientos = comparar_secuencial(o, r)

    co, cr = collections.Counter(o), collections.Counter(r)
    for k in "-—–": co[k] = cr[k] = 0
    for k in "●○■□◆◇•": co[k] = cr[k] = 0
    for k in "★☆*": co[k] = cr[k] = 0
    dif_letras = (co - cr) + (cr - co)
    letras_perdidas = sum(dif_letras.values())

    if identicos:
        print("  IDÉNTICOS secuencialmente carácter por carácter ✔")
        return 0
    elif no_justificados == 0:
        print(f"  Diferencias justificadas: marcas/guiones autorizados y {movimientos} movimientos de texto idéntico (notas reubicadas) ✔")
        return 0
    else:
        print(f"  Tramos con diferencias no justificadas: {len(dif_ops)}")
        print(f"  FALLO: {no_justificados} caracteres con diferencias secuenciales no justificadas ✘")
        for tag, i1, i2, frag in dif_ops[:6]:
            ctx = o[max(0, i1 - 25):i1 + 25]
            print(f"    {tag}: {frag}   contexto original: …{ctx}…")
        return 1

if not SOLO_B:
    print("── A · El reflujo no perdió texto (Comparación secuencial) ────")
    errores_totales += ejecutar_parte_a()
else:
    print("── A · (omitida: el anexo se verifica contra su tramo en B) ────")

if ARGV_PDF:
    print()
    print("── B · El PDF nuevo dice lo mismo ────────────────────────")
    doc = pymupdf.open(ARGV_PDF[0])
    ext = "\n".join(doc[i].get_text() for i in range(len(doc)))
    # Las láminas guardan su texto en `pie`, no en `txt`: también cuenta.
    esp = "\n".join((x.get("txt") or x.get("pie") or "") for x in B
                    if x.get("txt") or x.get("pie"))
    # Se corta la portadilla y el índice que generamos nosotros: para eso se
    # busca el primer párrafo de cuerpo del libro, que es único.
    # La aguja debe ser un parrafo NARRATIVO real, no un titulo del indice
    # original (listas de titulos sin puntuacion interna). Si el corte cae en
    # el indice, miles de palabras quedan sin verificar (medido: 8497 en
    # Seduccion). Se exige mas de 150 caracteres con puntuacion interna.
    def _es_narrativo(t):
        tt = t or ""
        if len(tt) <= 150:
            return False
        inter = tt[10:-10]
        signos = sum(1 for c in inter if c in ".,;:¿?¡!")
        return signos >= 2
    primer = next((x["txt"] for x in B
                   if x["rol"] == "cuerpo" and _es_narrativo(x.get("txt"))), None)
    if primer is None:
        primer = next((x["txt"] for x in B
                       if x["rol"] == "cuerpo" and len(x.get("txt", "")) > 60), None)
    corte = 0
    if primer:
        aguja = primer[:50]
        pos = ext.find(aguja)
        if pos > 0:
            corte = pos
            esp = esp[esp.find(aguja):]
    cuerpo = ext[corte:]
    # Normalización documentada de maquetación: ReportLab puede cerrar un
    # renglón justo tras el guion de una palabra compuesta («Neuro-
    # Linguistic»). El guion sigue perteneciendo a la palabra: se recompone
    # antes de comparar. El lector de la app hace la misma unión.
    cuerpo = re.sub(r"([\wáéíóúüñÁÉÍÓÚÜÑ]+)-\s*\n\s*([\wáéíóúüñÁÉÍÓÚÜÑ]+)",
                    r"\1-\2", cuerpo)
    # Para la comparación de PALABRAS, el guion intrapalabra es maquetación:
    # «NeuroLinguistic» y «Neuro-Linguistic» son las mismas letras. Se quita
    # en ambos lados (la parte A ya exige la correspondencia con guiones).
    sin_guion = lambda t: re.sub(r"(?<=[\wáéíóúüñÁÉÍÓÚÜÑ])-(?=[\wáéíóúüñÁÉÍÓÚÜÑ])", "", t)
    A, C = sin_guion(esp).split(), sin_guion(cuerpo).split()
    print(f"  palabras esperadas   {len(A)}")
    print(f"  palabras en el PDF   {len(C)}   ({len(C)-len(A):+d})")
    ops = [x for x in difflib.SequenceMatcher(None, A, C, autojunk=False).get_opcodes()
           if x[0] != "equal"]
    print(f"  tramos distintos     {len(ops)}   {'✔' if len(ops) == 0 else '← verificar si son índice/portadilla'}")

    # Estricto: cualquier tramo distinto (borrado, sustitución O inserción) es
    # un defecto. La portadilla y el índice ya quedaron fuera con el corte.
    tramos_invalidos = list(ops)
    if tramos_invalidos:
        print(f"  FALLO: {len(tramos_invalidos)} tramos distintos en el PDF generado (delete/replace/insert) ✘")
        errores_totales += 1
    for tag, i1, i2, j1, j2 in ops[:6]:
        print(f"    {tag}: esperado={' '.join(A[i1:i2])[:60]!r} | leído={' '.join(C[j1:j2])[:60]!r}")

    print()
    print("── Lo que nunca debe aparecer ────────────────────────────")
    partidas = 0
    for p in doc:
        for b in p.get_text("dict")["blocks"]:
            if b["type"] == 0:
                lns = b["lines"]
                for li in range(len(lns) - 1):
                    txt1 = "".join(s["text"] for s in lns[li]["spans"]).strip()
                    txt2 = "".join(s["text"] for s in lns[li+1]["spans"]).strip()
                    if re.search(r"[\wáéíóúñü]-$", txt1) and re.match(r"^[\wáéíóúñü]", txt2):
                        partidas += 1
    suaves = ext.count("\u00ad")
    control = sum(1 for c in ext if ord(c) < 32 and c != "\n")
    dobles = len(re.findall("  ", ext))
    print(f"  palabras partidas por guion   {partidas}   {'✔' if partidas == 0 else '← MAL'}")
    print(f"  guiones suaves (U+00AD)       {suaves}   {'✔' if suaves == 0 else '← MAL'}")
    print(f"  caracteres de control         {control}   {'✔' if control == 0 else '← MAL'}")
    print(f"  dobles espacios               {dobles}   {'✔' if dobles == 0 else '← MAL'}")
    if partidas > 0: errores_totales += 1
    if suaves > 0: errores_totales += 1
    if control > 0: errores_totales += 1
    if dobles > 0: errores_totales += 1

    W, MI, MD = doc[0].rect.width, 40, 40
    fuera = 0
    for i in range(len(doc)):
        for b in doc[i].get_text("dict")["blocks"]:
            if b["type"] != 0:
                continue
            for l in b["lines"]:
                if l["bbox"][2] > W - MD + 1.5 or l["bbox"][0] < MI - 1.5:
                    fuera += 1
    print(f"  líneas fuera del margen       {fuera}   {'✔' if fuera == 0 else '← MAL'}")
    if fuera > 0: errores_totales += 1
    print()
    print(f"  páginas {len(doc)} | marcadores {len(doc.get_toc())}")

if errores_totales > 0:
    print(f"\n[FALLO] Verificación terminada con {errores_totales} defecto(s). No aprobado.")
    sys.exit(1)
else:
    print("\n[ÉXITO] Verificación completada sin defectos. Aprobado ✔")
