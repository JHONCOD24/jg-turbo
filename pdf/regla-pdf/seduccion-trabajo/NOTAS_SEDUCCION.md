# El Arte de la Seducción (Robert Greene) · Notas de adaptación (regla-pdf, 2026-09-09)

Salida: `pdf/El Arte de la Seducción - edición adaptada para JG Turbo.pdf`
(731 págs A5, 1,90 MB, 167 marcadores). Taller reproducible en esta carpeta.
Libro ya en español (trad. Enrique Mercado, ePub base r1.2): no requirió
traducción.

## Diagnóstico (paso 1)

- Origen: 547 págs A4 (595×842), TimesNewRoman 15 pt, perfil «editorial»
  propuesto por el kit pero con particularidades de EPUB convertido por
  Calibre (créditos: «ePub base r1.2»). Español con escritura inclusiva
  («l@s seductor@s», «p/m-adre»): notación de la edición, se conserva.
- Solo 6 renglones acaban en guion en todo el libro: 5 compuestos reales
  (Saint-Germain, Anne-Marie, Middleton-Murry, LouisFrançois-Armand,
  Andreas-Salome) + 1 defecto («pare-» partido). Por eso
  `particion_silabas: false`: aquí no hay partición silábica que unir.
- Sin cabeceras ni números de página (banda 0). Sin notas al pie: los
  «XVII» a 11,2 pt son números de siglo en versalitas DENTRO de la línea
  (el tamaño de línea sigue siendo 15).

## Decisiones del perfil

- `empezar_en: 2`, `paginas_omitir: [2, 3]`: pág. 1 = carátula original
  (extraída a `portada.jpg`, 1151×1731, 0,44 % de blancos → el extractor
  de la app la acepta); pág. 2 = contraportada publicitaria (omisible por
  la regla); pág. 3 = portadilla duplicada por la que genera el paso 5.
  Los créditos (pág. 4), la dedicatoria y la biografía final con foto del
  autor (única figura interior) se conservan.
- `jerarquia`: 21,0 = capítulo · 18,7 normal = subtítulo de parte/fase ·
  18,7 **negrita** = sección (parche en `rol_linea`).
- `francesa_paginas: [543..546]`: la bibliografía va en sangría francesa
  (continuaciones sangradas); la regla normal la partiría renglón a renglón.
- Sin láminas, sin esquemas, sin `coser`.

## Defectos del origen medidos y reparados (`2b_parchear.py`, 24 parches)

1. **704 barras invertidas** (« \ ») marcando el fin de verso en poemas:
   convertidas en saltos reales (`\n` → `<br/>` en el paso 3).
2. **Fragmentos desplazados** (2): pág. 96 «pare-decir … cen Quieres» →
   «parecen decir … Quieres» (letras conservadas, solo recolocadas);
   pág. 60 «te en|cuadra» → «te encuadra» (ídem).
3. **Letras separadas** (2): «D e hecho» → «De hecho», «D e niñ@s» →
   «De niñ@s». Los «Y a…» NO se tocan: son español legítimo.
4. **Palabras pegadas** (1): «laintimidó» → «la intimidó».
5. **Errata** (1): «responsabilidaes» → «responsabilidades».
6. **Diálogo Shakespeare** (1): «A> NA:» → «ANA:» (pág. 384).
7. **Caja/puntuación corrupta en títulos** (3): «SoLO TÚ» → «SOLO TÚ»,
   «Apéndice A;» → «Apéndice A:», «Apéndice B;» → «Apéndice B:».
8. **11 guiones de partición intra-línea** del silabeador del ebook:
   retardar, consumado, Aventura, desvalido, Ronda, escuche, palabras,
   sospechas, descarriarlas, reencender, examantes. Conservados como
   compuestos reales: p/m-adre/materno (19×, notación de la edición),
   Kuei-fei, Pao-yu, Kai-shek, En-lai, close-up, franco-prusiana,
   dioses-héroes, pos-seducción y los 5 de fin de renglón.

## Desviaciones medidas de las herramientas (parches, solo en esta carpeta)

1. `2_extraer.py` · **fusión por línea base SIEMPRE**: Calibre partió 8
   líneas justificadas en un line-dict por palabra (pp. 147, 296, 317,
   541; verificado: no hay columnas ni diálogos lado a lado).
2. `2_extraer.py` · **epígrafes y citas en negrita** (4.547 líneas): en
   este libro TODAS las citas van en negrita indentada. Regla nueva
   `es_cita_negrita` (≥60 % negrita, 15 pt, x0 ≥ base+38): forman UN
   párrafo continuo por racha con nivel 1 (estilo cita); la atribución en
   versales abre párrafo propio. Sin esto cada renglón de cita era un
   párrafo (6,4 % en minúscula) o un marcador falso (regla negrita=
   sección del kit, desactivada). El umbral x0 ≥ base+38 separa las citas
   reales (x0 ≥ 85) de las 5 entradillas negrita-cursiva a la sangría
   (x0 67,5), medidas en todo el libro.
3. `2_extraer.py` · **bibliografía en sangría francesa** por rango de
   páginas (perfil `francesa_paginas`).
4. `3_reflujo.py` · **unión de palabras partidas SIN guion** en el borde
   de línea de las citas (pasajes «Símbolo» centrados): une solo si la
   palabra unida existe en el libro Y al menos una mitad NO existe por sí
   sola (guardián contra «mal humor» y «con que», que son dos palabras).
   3 uniones: pa|sado, de|saparecen, capaci|dad.
5. `3_reflujo.py` · `\n` sobrevive al rstrip de la fusión de líneas y se
   renderiza como `<br/>` (verso).
6. `5_construir.py` · ruta de fuentes Caladea relativa al taller
   (`fonts/`, copiada de aprendiz-trabajo).

## Resultados

- Reflujo: 1.917 párrafos de cuerpo, 1 en minúscula (0,05 %: la línea de
  créditos «ePub base r1.2», que es un párrafo propio a propósito).
- Paso 6A: única diferencia `{'-': 5}` (compuestos reales conservados).
- Paso 6B: 225.153 palabras = 225.153 en el PDF, **0 tramos distintos**.
- Paso 6b (pdf.js de la app): 0 partidas, 0 suaves, 0 dobles, 0 control.
- Higiene: 0 líneas fuera del margen, 0 páginas en blanco, carátula a
  sangre en pág. 1 (0,44 % blancos), Caladea ×4 subconjunto, A5, `es-ES`,
  índice con enlaces, 167 marcadores (46 capítulos + 121 secciones),
  foto del autor (pág. 547 del origen) conservada como figura.
- Bloques cortos (225): muestreados — todos son atribuciones de cita o
  versos, fieles a la maqueta.

## Pérdidas del origen (deliberadas y contadas)

- Pág. 2 (contraportada publicitaria, contiene además el error «Robert
  Green») y pág. 3 (portadilla de texto que duplica la portada): omitidas
  según la regla. Nada del cuerpo del libro se pierde (verificado por 6A).
