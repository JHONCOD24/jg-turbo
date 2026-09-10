# Regla · Adaptar un PDF para el apartado PDF de JG Turbo

> Esto no es un tutorial: es el procedimiento. Cualquier agente que reciba
> «adáptame este libro para la app» sigue estos seis pasos, en este orden, y
> no entrega nada que no pase el paso 6.
>
> Herramientas: `herramientas-pdf/` (seis scripts, se ejecutan tal cual).
> Probado con dos libros reales de familias opuestas; los números de
> referencia están al final.

---

## 1. Qué problema resuelve

JG Turbo lee un PDF con `pdf.js` (`getTextContent()`) y después pasa el texto
por `limpiezaTexto.js`, que intenta adivinar dónde termina un párrafo, qué es
una cabecera y qué palabras venían partidas. Con un libro maquetado para
imprenta, **adivinar sale mal**:

- las palabras cortadas con guion al final de renglón se quedan cortadas
- «el placebo eres tú 137» aparece a mitad de una frase
- los párrafos se parten cada vez que cambian de página
- las citas y las listas se convierten en un párrafo por renglón

La solución no es hacer más lista a la app: es **entregarle un PDF que no
tenga nada que adivinar**. Ese PDF se genera una vez, con este procedimiento,
y a partir de ahí la app solo tiene que leerlo.

**Regla de oro:** el PDF adaptado no pierde ni inventa un solo carácter. Todo
lo que se quita (cabeceras, guiones de partición, enlaces de vuelta de un
EPUB) se quita a propósito y queda contado en el paso 6.

---

## 2. El contrato del formato de salida

Estos valores no se negocian. Están elegidos para que el extractor de la app
no tenga que decidir nada.

| Qué | Valor | Por qué |
|---|---|---|
| Tamaño | A5 (420 × 595 pt) | cómodo en móvil y estándar; coincide con el ancho de muchos libros |
| Fuente | Caladea 11 / interlínea 16,6 | serif pensada para pantalla, con cursiva y negrita **reales** |
| Columnas | una | dos columnas rompen el orden de lectura de `pdf.js` |
| Alineación | justificada **sin** silabear | ReportLab no parte palabras: cero guiones al final de renglón |
| Párrafos | separados 7,5 pt, sin sangría | el hueco vertical hace evidente dónde acaba uno |
| Cabeceras y pies | **ninguno** | nada que se pueda colar a mitad de párrafo |
| Números de página | **ninguno** | irían a contracorriente del reflujo de la app |
| Índice | regenerado, con enlaces | el original lleva números que ya no valen y puntos suspensivos que la voz lee uno a uno |
| Marcadores | uno por capítulo y sección | navegación real dentro de la app |
| Fuente incrustada | subconjunto TTF con ToUnicode | cada glifo sabe qué letra es |
| Idioma | `es-ES` en los metadatos | lectura en voz alta y accesibilidad |
| Carátula / Portada | página 1 obligatoria a sangre o canónica | garantiza que la biblioteca muestre siempre la portada original auténtica |
| Metadatos (título/autor) | título y autor limpios (nunca vacío ni anonymous) | evita que ReportLab guarde "(anonymous)" y OpenLibrary asigne un libro espurio |

**Las cursivas y negritas del original se conservan.** No son decoración:
distinguen los títulos de libros, los términos técnicos y el énfasis.

---

## 3. Antes de tocar nada: pregúntale al usuario

Cuatro preguntas. No las supongas.

1. **Imágenes y gráficos** — ¿se incluyen en su sitio, se omiten, o solo una
   nota de referencia? *(Por defecto: incluirlas.)*
2. **Cabeceras y números de página** — ¿se eliminan del todo? *(Por defecto:
   sí. Es la causa número uno de contaminación del texto.)*
3. **Cursivas y negritas** — ¿se preservan? *(Por defecto: sí.)*
4. **Alcance** — ¿libro completo con notas e índice analítico, o solo el
   cuerpo? *(Por defecto: completo.)*

### 3.1 Estándar permanente de Carátula (obligatorio)
**Todo libro adaptado debe mostrar siempre su carátula original auténtica.**

#### Procedimiento obligatorio para la carátula en cada libro:
1. **Obtener la portada gráfica:**
   - Si el PDF original trae portada a color en la pág. 1: extraerla como imagen con `fitz` o `pdftoppm`:
     ```bash
     python -c "import fitz; doc=fitz.open('origen.pdf'); page=doc[0]; pix=page.get_pixmap(dpi=150); pix.save('portada.jpg')"
     ```
   - Si el PDF original carece de portada gráfica (o tiene una portadilla de texto en blanco): descargar la carátula oficial de la editorial a alta resolución y guardarla como `portada.jpg`.
2. **Activar en el perfil:**
   - En `perfil.json`, fijar `"portada_original": true`.
   - La primera página del PDF generado **será esa imagen a sangre**. Queda prohibido que la primera página sea texto suelto o fondo blanco (>99.2% de píxeles blancos), pues el extractor la descartará.
3. **Metadatos limpios en compilación:**
   - Al ejecutar `5_construir.py`:
     ```bash
     python3 5_construir.py "Título Real Limpio" "Nombre del Autor"
     ```
   - **NUNCA omitir argumentos ni permitir `(anonymous)`**: esos metadatos viajan a la app y confunden las búsquedas en catálogos externos (OpenLibrary asignará novelas ajenas).
4. **Registro en catálogo canónico local (para libros base de la app):**
   - Guardar una copia optimizada en `img/portadas/{slug}.jpg` (ancho 380 px, JPEG calidad 85, ~15-50 KB).
   - Registrar en `PORTADAS_CANONICAS` en `js/pdf/caratula.js`:
     ```javascript
     { patron: /termino[\s-_]?clave/i, archivo: '/img/portadas/nombre-archivo.jpg' },
     ```
   - Añadir la ruta a la lista de precacheo de `sw.js` y subir la versión en `index.html` y `sw.js`.


---

## 4. El proceso, paso a paso

### Paso 1 · Diagnosticar (`1_diagnosticar.py`)

```bash
python3 1_diagnosticar.py origen.pdf
```

No toca nada: mira el PDF y escribe `perfil.json`. **Nunca empieces a extraer
sin haber leído esta salida.** Te dice:

- **de qué familia es el PDF** (ver §5) — decide reglas opuestas
- si parte palabras con guion y en qué proporción
- si el justificado rompe cada línea en trozos sueltos
- hasta qué altura llega la cabecera repetida, y si esa raya se comería alguna
  línea de cuerpo
- dónde está el margen izquierdo, la sangría de párrafo y el margen derecho
- qué tamaño de letra es cada nivel de título
- qué páginas tienen imágenes y cuáles están giradas
- el inventario de caracteres raros

**Después ajusta `perfil.json` a mano.** Hay cosas que un script no puede
saber solo y que exigen abrir el libro y mirarlo:

| Campo | Cuándo se rellena |
|---|---|
| `paginas_omitir` | portada, contraportada, páginas de publicidad |
| `empezar_en` | si el libro empieza en la página 6 y antes solo hay créditos |
| `notas_desde` | primera página de las notas finales (cambian las reglas) |
| `laminas` | rangos de cuadernillo a color: la página entera es una figura |
| `esquemas` | páginas con un cuadro dibujado con texto suelto en 2D |
| `coser` | pares de páginas donde un esquema quedó partido en dos |
| `jerarquia` | qué tamaño de letra es capítulo, subtítulo o sección |
| `portada_original` | conservar la carátula del libro |

### Paso 2 · Extraer (`2_extraer.py`)

```bash
python3 2_extraer.py     # lee perfil.json → escribe crudo.json y figuras/
```

Deja cada página con sus líneas normalizadas, clasificadas y marcadas con
dónde arranca cada párrafo. **Aquí no se une nada todavía**: solo se decide,
con la geometría delante.

### Paso 3 · Reconstruir los párrafos (`3_reflujo.py`)

```bash
python3 3_reflujo.py     # crudo.json → bloques.json
python3 3b_auditar.py    # ← NO te saltes esto
```

`3b_auditar.py` es el termómetro. El indicador que importa: **cuántos
párrafos empiezan en minúscula**. Un párrafo que empieza en minúscula casi
siempre es un párrafo que se partió por error.

| Porcentaje | Qué significa |
|---|---|
| **< 0,5 %** | correcto, sigue adelante |
| 0,5 – 2 % | mira las páginas que se repiten en el informe |
| **> 2 %** | hay algo mal en el perfil: vuelve al paso 2 |

### Paso 4 · Preparar las imágenes (`4_imagenes.py`)

```bash
python3 4_imagenes.py
```

Ajusta cada recorte al ancho real que va a tener, gira las láminas apaisadas,
cose los esquemas partidos y elige el formato: **PNG con paleta** para dibujo
de líneas (el JPEG les mete halos alrededor de las letras) y **JPEG** para
fotografías. En «El placebo» esto bajó de 41,7 MB a 6,1 MB.

### Paso 5 · Generar el PDF (`5_construir.py`)

```bash
python3 5_construir.py "El placebo eres tú" "Joe Dispenza"
```

**Regla crítica de metadatos y carátula:**
- Pasa **siempre** el título y autor limpios. Si no los pasas o si ReportLab escribe `(anonymous)` en los metadatos del PDF, la búsqueda de carátula en OpenLibrary fallará o asignará un libro romántico ajeno (ver `TRAMPAS.md`).
- Asegúrate de que `portada.jpg` esté presente y `"portada_original": true` en `perfil.json`.

### Paso 6 · Verificar (obligatorio)

```bash
python3 6_verificar.py "El placebo eres tú - adaptado para lectura.pdf"
node 6b_verificar_con_pdfjs.mjs "<pdf>" ruta/a/js/vendor/pdfjs
```

`6_verificar.py` hace comprobaciones estrictas:

**A · El reflujo no perdió texto.** Compara carácter a carácter el original
contra lo reconstruido. La única diferencia admisible son los guiones que se
quitaron a propósito y, en un EPUB, los `<<`. **Cualquier LETRA que aparezca
en esa lista es texto perdido: vuelve al paso 2.**

**B · El PDF nuevo dice lo mismo.** Palabra por palabra. Lo correcto es
**cero tramos distintos**.

**C · La carátula se renderiza en la página 1.** Comprueba que la primera
página del PDF nuevo sea la imagen gráfica a sangre (`portada.jpg`), y que no
sea una portadilla de texto blanco (>99.2% blanco), garantizando que la
biblioteca de JG Turbo muestre la portada auténtica de inmediato.

`6b_verificar_con_pdfjs.mjs` usa **el mismo `pdf.js` que lleva la app**, así
que responde a la única pregunta que de verdad importa: qué va a leer JG Turbo
cuando el usuario abra el libro. Deja `extraccion_pdfjs.txt` para inspección.

---

## 5. Las dos familias de PDF

Reconocerla es lo primero que hace el paso 1, y de ella dependen reglas
**opuestas**. Confundirlas destroza el libro.

| | **Editorial** (InDesign, imprenta) | **EPUB convertido** (Calibre) |
|---|---|---|
| Cómo se reconoce | 15–30 % de líneas acaban en guion | páginas diminutas, casi ningún guion |
| Páginas | pocas y grandes (410 de 420×638) | muchísimas y pequeñas (3.674 de 252×331) |
| **Guiones al final de renglón** | **partición de sílabas: se unen** | **guiones reales: NO se tocan nunca** |
| Justificado | líneas completas | cada palabra es un trozo suelto: **hay que fusionar por línea base** |
| Cabeceras | sí, hay que quitarlas | normalmente no hay |
| Márgenes | cambian entre páginas pares e impares | fijos |
| Separación de párrafos | sangría de primera línea | sangría de primera línea |
| Notas | al pie o al final, en letra pequeña | al final, con marcador `[n]` y enlace `<<` |

En un EPUB, unir los guiones destroza `hombre-mujer`, `asco-repulsión` o
`Self-Perceptions`. En un libro editorial, no unirlos deja `hacien-do`
partido en 3.000 sitios.

---

## 6. Las reglas de decisión

### 6.1 Dónde arranca un párrafo

Tres señales, por orden de fiabilidad:

1. **Sangría de primera línea.** Si `x0 > margen + 6`, empieza párrafo. El
   margen se mide **por página**: en un libro editorial las páginas pares e
   impares tienen márgenes distintos.
2. **Nivel de sangría del bloque.** Una racha de líneas más sangradas *y* con
   el margen derecho más corto es una **cita**. Si dentro de esa racha la
   primera línea está *menos* sangrada que las demás, es **sangría francesa**
   (listas numeradas, notas finales) y la regla se invierte.
3. **Una línea corta cierra el párrafo.** En texto justificado, una línea que
   no llega al margen derecho es la última de su párrafo — **salvo si termina
   en guion**, que entonces la palabra continúa.

Y una regla que no falla: **un párrafo que cruza de una página a la siguiente
es un solo párrafo.** El estado de «párrafo abierto» tiene que sobrevivir al
cambio de página, a las figuras y a los pies de figura. Un título sí lo cierra.

### 6.2 Guiones al final de renglón (solo perfil editorial)

Por orden:

1. Si lo que sigue al corte **empieza en mayúscula** → guion real, se conserva.
   En español ninguna palabra partida continúa con mayúscula.
2. Si la palabra unida **existe en el propio libro** → era partición, se une.
   El diccionario se construye con las palabras del libro, no con uno externo:
   así reconoce su vocabulario propio.
3. Si la forma **con** guion existe en el libro → era compuesta, se conserva.
4. Si no aparece ninguna de las dos → se une. En un libro maquetado la
   partición es mucho más frecuente que el compuesto.

Los casos del 4 se listan al final del paso 3 para que los revises.

### 6.3 Cabeceras y pies

Se quita todo lo que esté por encima de `banda_cabecera`. Para calcular esa
raya se usa la **mediana** de dónde termina el texto repetido, nunca el
máximo: la cabecera está a la misma altura en todas las páginas, así que la
mediana la clava, mientras que el máximo se lo lleva cualquier despiste (un
número de capítulo grande a media página también encaja con el patrón).

Después, **audita lo que tiraste**. Si en la lista de descartes aparece prosa
del libro, la banda está mal.

### 6.4 Figuras

- Los **rótulos pegados al gráfico** («FIGURA 3.1 A», «ESTÍMULO») entran en el
  recorte: son parte del dibujo.
- Un **renglón de prosa que cruza toda la caja** no entra: ya se lee en el
  texto y saldría duplicado.
- Las **láminas a página completa** se rinden enteras. Si el texto de la
  página está girado (`dir == (0,-1)`), se rota la imagen 90° y **también hay
  que cambiar el orden de lectura**: por `x` ascendente y luego `y`
  descendente.
- Un **cuadro dibujado con texto suelto en 2D** (una tabla hecha a base de
  cajas) se transcribe como un galimatías. Se rinde como imagen y se excluye
  su texto del flujo.

### 6.5 Notas finales de un EPUB

Cada nota empieza por su marcador `[n]` y termina con `<<`, que es el enlace
de vuelta del EPUB. Sin una regla específica, las 786 notas de «Sex code» se
funden en un solo párrafo. Y el `<<` hay que quitarlo: no es del libro y la
voz lo lee como ruido.

### 6.6 Palabras que no caben de ancho

Las URLs largas de las notas se salen del margen o se parten. La solución:
**achicar solo ese párrafo** hasta que la palabra más larga quepa. Nunca se
parte y nunca se sale.

---

## 7. Trampas conocidas

Todas son reales; todas costaron encontrarlas.

| Trampa | Síntoma | Solución |
|---|---|---|
| El párrafo abierto se reinicia en cada página | 268 párrafos empiezan en minúscula | El estado sobrevive al cambio de página |
| Un pie de figura cierra el párrafo | El texto se parte alrededor de cada gráfico | Solo los **títulos** cierran párrafo; los pies, no |
| Sangría francesa tratada como normal | Cada renglón de las notas es un párrafo | Detectar que la moda de `x0` está por encima del mínimo |
| Cita con la misma sangría que un párrafo | Diálogos partidos renglón a renglón | Discriminar por el **margen derecho**, más corto en una cita |
| Entradilla en negrita = título de sección | El párrafo se corta tras la entradilla | Un título va **todo** en negrita **y** centrado |
| El ancla cae en el índice del libro | La figura aparece en la página 2 | Buscar siempre **hacia delante** desde la anterior |
| Banda de cabecera calculada con el máximo | Se tira media página | Usar la **mediana** |
| Fusionar por familia tipográfica mal cortada | Las cursivas se clasifican como rótulos | La familia es el nombre **sin el estilo**: `TimesNewRomanPSMT` → `TimesNewRoman` |
| Fuente sin ToUnicode | La app extrae basura | TTF incrustada con subconjunto (ReportLab lo hace bien) |

**Y una que no depende de ti:** algunos PDF vienen ya con texto perdido. En
«Sex code», Calibre metió dos tablas más anchas que la página y **cortó la
columna derecha**; las palabras están truncadas a media sílaba en el archivo
de origen. No hay nada que recuperar. Lo que se hace es rendir la zona como
imagen —para que al menos se vea lo que el archivo sí tiene— y **avisar al
usuario**. Nunca inventar el texto que falta.

---

## 8. Criterios de aceptación

No se entrega si alguno falla:

- [ ] **Cero** palabras partidas por guion en el PDF final
- [ ] **Cero** guiones suaves (U+00AD) y **cero** caracteres de control
- [ ] **Cero** dobles espacios
- [ ] **Cero** líneas fuera del margen
- [ ] Paso 6A: sin diferencias de **letras** (solo `-` y `<` esperados)
- [ ] Paso 6B: **cero** tramos distintos
- [ ] Paso 3b: párrafos en minúscula por debajo del 0,5 %
- [ ] Auditoría de descartes: solo cabeceras y rótulos de figura
- [ ] El PDF abre con `pdf.js` y devuelve el texto correcto (paso 6b)
- [ ] Índice con enlaces y marcadores por capítulo
- [ ] Sin páginas en blanco
- [ ] **Nombres propios con mayúscula** (autor, traductor, editorial, personajes):
  buscar en el texto extraído `california`, `núria`, `pérez`, `candace`,
  `ph. d.` y cualquier ` [a-záéíóú]+ [A-ZÁÉÍÓÚ]` sospechoso antes de compilar
  (auditoría 2026-09-10: «El placebo» salió con cuatro en minúscula)
- [ ] **Títulos de capítulo con pausa para voz**: todo título sin signo final
  lo cierra la capa de voz (`pareceTituloSuelto` en `js/pdf/vozTexto.js`,
  probado en `tests/test_pdf_voz.mjs`); un `)`/`»` final solo NO cuenta como
  pausa (Secretos de Copywriting, 2026-09-10). En el flujo de fidelidad
  (texto original inmutable) en el PDF no se añade ni se quita ningún punto
  (§12); excepción: el resumen Bookey traducido sí asegura `.`/`?`/`!` final
  en compilación (`asegurar_punto` en `construir_bookey.py`), documentado en
  `CAMBIOS_PDF.md` v2.74.0/v2.74.2.
- [ ] **Cero chatter de traducción en el texto extraído** (ver §13): buscar
  en la extracción del paso 6b `no hay texto para traducir`,
  `bloque de texto que necesitas`, `qué necesitas que traduzca` y
  `bienvenidos a este video`. Cero apariciones o el libro no se entrega.
- [ ] **Prueba de escucha de 2 minutos**: índice + primera página de un
  capítulo con voz real antes de entregar (caza run-ons que el ojo no ve)

---

## 9. Números de referencia

Dos libros ya hechos, uno de cada familia. Si tus cifras se parecen, vas bien.

### El placebo eres tú (Joe Dispenza) · perfil **editorial**

```
origen         410 páginas, 17 MB, 420×638 pt, MinionPro 10,8
cabeceras      674 líneas quitadas
guiones        2.638 unidos por diccionario · 430 por defecto · 6 reales conservados
párrafos       1.271 de cuerpo, 4 empiezan en minúscula (0,31 %)
figuras        36 gráficos + 26 láminas a color (41,7 MB → 6,1 MB)
salida         452 páginas, 10,7 MB, 127 marcadores
verificación   116.178 palabras esperadas = 116.178 en el PDF · 0 tramos distintos
```

Los 6 guiones reales: `chino-estadounidenses`, `Internal-Mammary`,
`Self-Perceptions`, `Oxytocin-Receptor`.

### Sex code (Mario Luna) · perfil **epub**

```
origen         3.674 páginas, 5,3 MB, 252×331 pt, Times 15
fragmentos     10.872 trozos sueltos fusionados por línea base
guiones        15 reales conservados · 0 unidos
notas          786 notas separadas por su marcador · 1.572 caracteres «<<» quitados
párrafos       7.537 de cuerpo, 3 empiezan en minúscula (0,04 %)
figuras        5 reales · 8 viñetas de capítulo descartadas
portada        la original del libro, conservada a sangre
salida         1.145 páginas, 3,0 MB, 1.029 marcadores
verificación   271.750 palabras esperadas = 271.750 en el PDF · 0 tramos distintos
```

---

## 10. El kit

```
herramientas-pdf/
  1_diagnosticar.py            mira el PDF y escribe perfil.json
  2_extraer.py                 perfil.json + origen.pdf → crudo.json + figuras/
  3_reflujo.py                 crudo.json → bloques.json (párrafos, cursivas, guiones)
  3b_auditar.py                el termómetro: ¿se partió algún párrafo?
  4_imagenes.py                recortes al peso y formato correctos
  5_construir.py               bloques.json → el PDF adaptado
  6_verificar.py               fidelidad carácter a carácter y palabra a palabra
  6b_verificar_con_pdfjs.mjs   la prueba definitiva, con el pdf.js de la app
```

Dependencias: `pip install pymupdf reportlab pillow` y la fuente Caladea
(`fonts-crosextra-caladea` en Debian/Ubuntu; en Windows, cualquier ruta a los
cuatro `.ttf`, que se cambia en la cabecera de `5_construir.py`).

Receta completa:

```bash
python3 1_diagnosticar.py origen.pdf
#   ← lee la salida y ajusta perfil.json a mano
python3 2_extraer.py
python3 3_reflujo.py && python3 3b_auditar.py
#   ← si hay más de un 2 % en minúscula, vuelve al paso 2
python3 4_imagenes.py
python3 5_construir.py "Título" "Autor"
python3 6_verificar.py "Título - adaptado para lectura.pdf"
node 6b_verificar_con_pdfjs.mjs "Título - adaptado para lectura.pdf" js/vendor/pdfjs
```

---

## 11. Y del lado de la app

Los gráficos del PDF **no** están en el texto: viven en la lista de
operaciones de dibujo de cada página. JG Turbo los extrae aparte con
`js/pdf/figurasPdf.js` y los coloca dentro de la lectura. Eso está documentado
en `CAMBIOS_PDF.md` (entrada del 2026-09-08) y no hace falta hacer nada
especial en el PDF para que funcione: basta con que las figuras estén donde
les toca, que es lo que hace este procedimiento.

---

## 12. Símbolos que la voz dice con palabras: NO tocar el PDF

> Regla permanente (2026-09-10). Si el usuario reporta que el audiolibro dice
> mal un símbolo («hashtag» en vez de «número», «arroba» deletreada, etc.),
> **el PDF adaptado NO se cambia**: el texto del libro es inmutable y la
> verificación del paso 6 exige fidelidad carácter a carácter. Lo que se
> ajusta es la **capa de voz**, que se genera justo antes de hablar y se
> descarta (`TRAMPAS.md` §6.3).

### 12.1 Dónde vive

- `js/pdf/vozTexto.js` → `prepararParaVoz()` (capa completa: títulos,
  abreviaturas, `#` de conteo, notas). El lector la expone como
  `window.jgPrepararParaVoz` y **todos** los caminos de voz del PDF la
  usan: Escuchar, Desde aquí, MP3 y audiolibro. Exportar, traducir y
  guardar no la tocan.
- Red de seguridad en `ttsNormalizarTextoNarracion` (`index.html`):
  `#` + dígitos → `número N` aunque alguien se salte la capa PDF. Esta
  función SÍ está en `ttsCrearCola`, que es por donde pasa Escuchar.
- Pruebas: `tests/test_pdf_voz.mjs` (capa completa) **y**
  `tests/test_tts_narracion.mjs` (el camino de Escuchar). Si solo pasa
  la primera, el usuario sigue oyendo «hashtag».

### 12.2 Tabla vigente (medida en la biblioteca pública, 2026-09-09)

| Símbolo | Contexto | La voz dice | Ejemplo real |
|---|---|---|---|
| `#` + dígitos (`#1`, `# 12`, `LF#8`) | conteo | `número N` (`number N` en inglés) | `Secreto #1`, `Principle #1`, `The #1 brand` |
| `#` solo | conteo | `número` | `El capítulo # cierra` |
| `#etiqueta` (pegado a letras) | etiqueta social | `hashtag etiqueta` | futuro: libros sobre redes |
| `#` dentro de URL/correo | ancla web | nada (ya es `enlace web`) | `page4#reference4.2` |
| `§`, `¶`, `&`, `/`, `n.º`, `pág.`, `cf.`… | varios | ver `vozTexto.js` §3–3 quater | — |

La cifra se deja en dígitos a propósito: en modo neural Fish/Edge la
pronuncia sola (v2.25.0); solo el respaldo del navegador la expande.
Los libros ya guardados reciben el arreglo solos, sin reprocesar: la
capa se aplica al hablar, no al extraer (`TRAMPAS.md` §1.4 no aplica aquí).

### 12.3 Cómo agregar un símbolo nuevo

1. Escuchar el caso real del libro y anotar la frase exacta.
2. Añadir la regla en `vozTexto.js` **después** de enmascarar URLs/correos
   (si no, un `#` de ancla web se volvería conteo).
3. Añadir comprobaciones en `test_pdf_voz.mjs` y correr la batería unitaria.
4. No tocar el PDF adaptado ni lo guardado en biblioteca: si una prueba de
   exportación falla tras cambiar la voz, la regla se coló donde no debía.

---

## 13. Anti-chatter de traducción y pausa de títulos: que no se repita

> Guía permanente (Secretos de Copywriting, 2026-09-10). El libro salió con
> dos defectos que el ojo no caza y el oído sí: (1) la frase «no hay texto
> para traducir, por favor proporciona el bloque de texto que necesitas
> convertir al español siguiendo las instrucciones dadas» sonando en la
> narración; (2) títulos sin punto leídos de corrido con el párrafo
> siguiente. Todo libro nuevo que se adapte pasa por esta sección.

### 13.1 De dónde salió el chatter

El resumen Bookey trae párrafos dummy de extracción (`'1.'`, `'-'`, `': -'`).
Al mandarlos a traducir, el modelo devolvía rechazos («no hay texto para
traducir…», «¿qué necesitas que traduzca?», «hola a todos, bienvenidos a este
video…») y esos rechazos quedaban guardados como si fueran contenido del libro.

### 13.2 Prevención en compilación (el defecto no debe nacer)

1. **Filtrar los párrafos dummy ANTES de traducir**: números sueltos, guiones
   solos y cualquier fragmento que solo tenga dígitos y signos. Referencia:
   `es_parrafo_invalido()` en `pdf/_adaptacion/construir_bookey.py`.
2. **Filtrar los rechazos DESPUÉS de traducir**: si la traducción contiene
   `no hay texto para traducir`, `bloque de texto que necesitas`,
   `qué necesitas que traduzca` o `bienvenidos a este video`, se descarta el
   párrafo, no se guarda. Ojo: filtrar por subcadena dentro de un párrafo
   largo y legítimo (un CTA real que diga «suscríbete») borraría contenido de
   verdad — en la voz se quita solo la frase del rechazo, nunca la palabra
   suelta.
3. **Asegurar el punto final de cada título** en compilación (`asegurar_punto`:
   añade `.` si no cierra en `.`, `…`, `?` o `!`; nunca tras `?`/`!`). Cada
   H1, H2, resumen, cita, pregunta y respuesta sale del compilador con cierre.

### 13.3 Verificación obligatoria antes de entregar (paso 6 + esto)

```bash
# 1. Cero chatter en el PDF construido (extracción con el motor real)
python -c "import pymupdf; d=pymupdf.open('Mi libro - edición adaptada para JG Turbo.pdf'); t=' '.join(p.get_text() for p in d).lower(); print('chatter:', t.count('no hay texto para traducir'), '| bloque:', t.count('bloque de texto que necesitas'))"
# → chatter: 0 | bloque: 0, o no se entrega.

# 2. Títulos H1/H2 con cierre: listar los que no terminen en . ? ! …
# (los que salgan deben ser portada o citas partidas por el ancho de línea,
# nunca un título de sección).

# 3. Escucha de 2 minutos con voz real: índice + primera página de un capítulo.
```

### 13.4 Red defensiva en la app (por si algo se coló igual)

- `js/pdf/vozTexto.js` (`prepararParaVoz`, filtro inicial) y
  `js/pdf/limpiezaTexto.js` (`pulirParaLectura`) quitan el chatter exacto y
  sus variantes. La voz además pausa los títulos sueltos con `:`.
- `index.html` (`ttsNormalizarTextoNarracion`) repite el filtro: es el camino
  que SÍ usa Escuchar/MP3. Un arreglo que solo viva en `vozTexto.js` deja al
  usuario oyendo el defecto con las pruebas en verde (`TRAMPAS.md` §6.11).
- Pruebas que lo vigilan: `tests/test_pdf_voz.mjs` (chatter + pausa tras
  `)`/`»`) y `tests/test_tts_narracion.mjs` (camino de Escuchar). Si adaptas
  un libro con un rechazo nuevo del traductor, agrégalo a los tres filtros y
  a las dos pruebas.

### 13.5 Lo ya guardado no se arregla solo con código nuevo

Un libro que el usuario guardó con el defecto lo conserva en su biblioteca
(`TRAMPAS.md` §1.4): la voz lo silencia sola, pero el texto visible solo queda
limpio borrando ese libro y volviendo a subir el PDF adaptado. Al entregar un
adaptado corregido, avísalo en una línea.
