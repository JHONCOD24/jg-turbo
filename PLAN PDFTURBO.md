# JG Turbo · Panel PDF v3 — rediseño y pulido automático para lectura en voz alta

> **Este documento es la orden de trabajo completa para el agente que lo implemente.**
> Está escrito para ejecutarse tal cual, sin necesidad de volver a investigar el
> código. Cada afirmación técnica lleva `archivo:línea` verificada el 2026-09-01.
> Lee entero el §1 antes de tocar nada: son trampas medidas de este proyecto que
> han costado arreglos repetidos.

---

## 0. Contexto — por qué se hace esto

El apartado PDF de JG Turbo (https://jg-turbo.vercel.app, pestaña **PDF**) ya
funciona: extrae texto de libros completos en el navegador, los guarda en una
biblioteca local, traduce y los lee en voz alta. Acaba de recibir un rediseño
(v2.1, 2026-09-01) que ordenó el panel. Pero el dueño del producto, usándolo de
verdad, encontró dos problemas que ese rediseño no resolvió:

**Problema 1 — la pantalla está saturada.** En el lector hay **~28 controles
visibles a la vez** compitiendo con el texto: una fila de 8 botones de texto
(Copiar · Corregir · ↺ · Párrafos · Traducir · Pulir · Prompt · Limpiar), cada
uno con su propio color de acento; encima una barra de herramientas, un índice,
una fila de navegación con buscador; debajo una consola de voz, una sección de
4 botones de descarga y un panel de preguntas a la IA. En móvil hay que
desplazar **~1.500 px** antes de leer la primera línea del libro. El texto —lo
único que importa— es lo que menos espacio ocupa.

**Problema 2 — «Pulir» da error y la voz suena robótica.** Al pulsar «Pulir»
con un capítulo de PDF sale `HTTP 504 en /improve`. Y al escuchar el documento,
la voz se frena, se atropella y suena mecánica porque al texto le faltan puntos
y comas donde el maquetado del PDF los perdió.

**Resultado esperado.** Un apartado PDF donde (a) leer y escuchar sea lo
principal y todo lo demás esté a un toque de distancia sin estorbar, en móvil,
tablet y escritorio; y (b) el texto quede pulido **automáticamente**, sin que el
usuario pulse nada, sin cambiar ni una palabra, de forma que la voz lo lea
natural.

**Decisiones ya tomadas por el dueño del producto (no reabrir):**

| Decisión | Elegido |
|---|---|
| Alcance del pulido con IA | **Capítulo actual + precarga del siguiente.** Solo se paga lo que se lee. |
| Botones heredados de transcripción en el PDF | **Quitar Corregir, Párrafos y Prompt** del panel PDF (siguen intactos en Micrófono, Archivo, YouTube y Traducir). |
| Identidad visual | **Modo lectura Papel / Noche solo dentro del lector.** La app sigue oscura; no se toca la identidad global. |

---

## 1. Reglas que NO se pueden romper

Estas reglas salen de fallos ya cometidos en este repositorio. Ignorar
cualquiera de ellas reintroduce un bug conocido.

1. **El límite de 60 s de Vercel manda.** `vercel.json:2-6` fija
   `maxDuration: 60` para `api/index.py`. Cualquier trabajo largo (traducir,
   pulir) **se trocea en el navegador**, nunca en el servidor. Medido: 39.732
   caracteres → `504 FUNCTION_INVOCATION_TIMEOUT` a los 60,4 s. Subir
   `maxDuration` solo mueve el techo; siempre existe un tamaño que falla.

2. **`.btn` está definida dos veces** en `index.html` (≈ línea 671 y otra más
   abajo). Gana la última. Una regla nueva de una sola clase
   (`.mi-boton{min-height:48px}`) se aplica en el editor pero **no** en el
   navegador, y el síntoma es silencioso. Usa siempre **dos clases**
   (`.pdf-lector .mi-boton{…}`) o verifica con `getComputedStyle`.

3. **Nunca se rompen los ganchos del controlador.** El JS busca los elementos
   por `id`. Antes de mover o borrar un nodo, comprueba que su `id` no esté en
   la lista del §7. Si un `id` desaparece, el lector deja de funcionar sin
   error visible en consola.

4. **`flex:none` en los bloques del lector** (`.pdf-doc-cab`, `.pdf-indice`,
   `.pdf-trad`…) no es decorativo. `#pdfResultArea` es una columna flexible y
   sin eso el índice se aplasta a 2 px y su contenido se desborda sobre el
   texto. Medido, no supuesto.

5. **El texto se extrae en el navegador con pdf.js, jamás en el servidor.**
   Vercel rechaza peticiones de más de ~4,5 MB. El motor vive en
   `js/vendor/pdfjs/` (v6.3.289), no en un CDN, porque la app es PWA.

6. **No volcar un libro entero en el `<textarea>`.** Por encima de
   `LIMITE_PARTE = 90000` (`js/pdf/pdfController.js:27`) el texto se parte en
   capítulos y se muestra uno solo. La fuente de verdad son las partes
   (`estado.partes`).

7. **Los tokens del panel mandan.** El ritmo visual sale de `--pdf-r`,
   `--pdf-r-sm`, `--pdf-gap`, `--pdf-pad` definidos en `.pdf-area`
   (`index.html:1426-1431`). **No poner radios ni márgenes sueltos** en este
   panel: es exactamente lo que se acaba de arreglar en v2.1.

8. **Una sola puerta por endpoint.** Solo `jgPedirTraduccion`
   (`index.html:6947`) puede llamar a `/api/translate`; hay una prueba que
   falla si alguien añade otra
   (`test_ningun_camino_llama_a_translate_saltandose_el_troceo`). **Este plan
   crea la misma regla para `/api/improve`.**

9. **Las claves de IA viven solo en variables de entorno de Vercel**
   (`GEMINI_API_KEY`, `MISTRAL_API_KEY`, `OPENROUTER_API_KEY`,
   `ANTHROPIC_API_KEY`, `XAI_API_KEY`). Nunca en código ni en Git. El navegador
   puede aportar la suya desde `localStorage.jg_api_key`.

10. **`api/calidad_linguistica.py` está duplicado a propósito** en
    `backend/calidad_linguistica.py`. Si se toca uno, se toca el otro igual.
    El validador está calibrado contra falsos positivos medidos: **no
    endurecerlo sin volver a medir**.

11. **Preferencias del usuario en `localStorage` con prefijo `jg_`.** Un deploy
    no las borra. No renombrar claves sin migración. Ver `CONFIG_PERSISTENTE.md`.

12. **Desplegar es parte de terminar.** Ningún cambio queda cerrado mientras
    solo exista en local. Ver §9.

---

## 2. Diagnóstico medido

### 2.1 Por qué «Pulir» devuelve 504 — cadena completa de evidencia

| # | Hecho | Ubicación |
|---|---|---|
| a | El frontend manda el **texto completo sin trocear** a `/improve` | `index.html:13235` — `jgFetchIaConRespaldo('/improve', {text: txt, …}, 90000)` donde `txt = ta.value` íntegro (`:13182`) |
| b | Un capítulo de PDF puede tener hasta **90.000 caracteres** | `js/pdf/pdfController.js:27` — `const LIMITE_PARTE = 90000` |
| c | El servidor **sí** trocea… pero en **serie**, un bloque tras otro | `api/index.py:765-771` — `for bloque in bloques:` sin paralelismo |
| d | El bloque es de 3.500 caracteres → **~26 llamadas encadenadas** | `api/index.py:97` — `LIMITE_BLOQUE_CHARS = 3500` |
| e | Gemini recorre hasta **4 modelos con 45 s de timeout cada uno** | `api/index.py:1402` |
| f | Vercel corta la función a los **60 s** | `vercel.json:2-6` |
| g | `ImproveRequest.text` **no tiene `max_length`**: no rechaza, se cuelga | `api/index.py:252` (compárese con `TranslateRequest.text`, `:264`, que sí lo tiene) |
| h | El 504 devuelve HTML, `resp.json()` falla y el usuario ve un mensaje inútil | `index.html:5496` → `:13241` → `:13411` → **«⚠ No se pudo mejorar: HTTP 504 en /improve»** |

**Techo práctico actual de `/api/improve`: ~21.000 caracteres.** Cualquier
capítulo mayor falla siempre, de forma determinista.

**«Corregir» tiene el mismo defecto**: `/correct-transcription` también trocea
en serie (`api/index.py:2961`) y el frontend manda todo con timeout de 60 s
(`index.html:10277`).

### 2.2 Por qué la voz suena robótica — causa raíz en el código

| # | Hecho | Ubicación |
|---|---|---|
| a | El troceador de voz corta por signos de puntuación | `index.html:11209` — `/[^.!?…;:\n]+(?:[.!?…;:\n]+|$)/g` |
| b | **Si no hay puntuación, cae a corte bruto por caracteres**, en el último espacio antes del límite | `index.html:11233-11245` — `s.slice(i, end)` |
| c | Ese corte a mitad de frase hace que la voz cierre entonación donde no hay final: **eso es el sonido robótico** | consecuencia de (b) |
| d | Antes de trocear, `\s+ → ' '` **destruye los saltos de párrafo** | `index.html:11199` y `:11220` |
| e | `\n` simple se convierte en espacio **sin punto**: frases que quedan pegadas | `index.html:11265` |
| f | **No existe ninguna normalización para voz**: ni números, ni siglas, ni abreviaturas, ni pausas | verificado en todo `index.html` |
| g | El propio código ya sabe que bloques más largos suenan mejor: *«cuanto más largo el bloque, más natural la entonación (menos cortes = menos robótico)»* | `index.html:10609-10615` |

**Conclusión clave:** el pulido no es cosmético. **Es lo que le da al troceador
de voz los puntos de corte que necesita.** Sin puntuación, el TTS corta a ciegas.

### 2.3 Qué hay que ya sirve y NO hay que reinventar

| Pieza | Dónde | Para qué se reutiliza |
|---|---|---|
| `jgUnidadesDeTexto(texto, max)` | `index.html:6883` | Parte por párrafos → frases → palabras sin perder un carácter. **Genérico.** |
| `jgTrocearParaTraducir(texto, max)` | `index.html:6907` | Agrupa unidades en bloques ≤ max. **Genérico pese al nombre.** |
| `jgMapaConLimite(items, limite, tarea)` | `index.html:6924` | Pool de workers que **conserva el orden**. **Genérico.** |
| `jgPeorValidacion` | `index.html:6938` | Consolida validaciones (`ok < warning < alert`). |
| `crearTraductor({traducir, guardar, cargar})` | `js/pdf/traduccion.js:30` | **Plantilla exacta** del pulidor perezoso: memoria de sesión, `enCurso` anti-duplicados, `precargar`, `sembrar`. |
| `guardarTraduccion / cargarTraduccion / traduccionesDe` | `js/pdf/biblioteca.js:323-356` | **Plantilla exacta** del almacén de pulidos. |
| `componerTexto(paginas, opts)` | `js/pdf/limpiezaTexto.js:207` | Limpieza mecánica ya existente (ligaduras, guiones de corte, cabeceras, números de página). Se amplía, no se reescribe. |
| `textoDeParte(indice)` | `js/pdf/pdfController.js:127` | **Punto único de verdad.** Todo lo lee de aquí: pantalla (`:534`), voz (`:1044`, `:1055`), exportar (`:140`), buscar (`:987`), texto completo (`:143`). |

---

## 3. Arquitectura de la solución

### 3.1 El pulido en tres capas

```
PDF subido
   │
   ├─ CAPA 1 · pulido mecánico          js/pdf/limpiezaTexto.js
   │   instantáneo · gratis · sin red · sin IA
   │   arregla: tipografía, comillas, guiones de diálogo, espacios
   │            antes de signos, párrafos sin punto final
   │   → se aplica SIEMPRE, a todo el libro, al extraer
   │
   ├─ CAPA 2 · pulido con IA            js/pdf/pulido.js + /api/improve?mode=lectura
   │   perezoso · automático · por capítulo · se guarda
   │   arregla: puntuación que el PDF nunca tuvo, comas, tildes,
   │            signos de apertura ¿ ¡, mayúsculas tras punto
   │   → capítulo que abres + precarga del siguiente
   │
   └─ CAPA 3 · guardián de integridad   js/pdf/pulido.js (función pura)
       compara palabra a palabra · si la IA cambió algo, se descarta
       → garantiza «no cambia el texto», de forma verificable
```

Y aparte, **solo para el motor de voz**, nunca visible ni guardado:

```
   CAPA 4 · texto para voz              js/pdf/vozTexto.js
   se genera al vuelo justo antes de hablar
   expande: 1997 → «mil novecientos noventa y siete», «etc.» → «etcétera»,
            «S. XIX» → «siglo diecinueve», «Dr.» → «doctor», «%» → «por ciento»
   → el texto en pantalla NO cambia; solo lo que escucha el oído
```

**Por qué la capa 4 va aparte:** el usuario exigió que el texto no se modifique.
Pero para que la voz lea bien «S. XIX» hay que decir «siglo diecinueve». La
solución honesta es separar **lo que se ve** (palabras idénticas al original) de
**lo que se pronuncia** (expandido). Nunca se guarda ni se exporta la versión de
voz.

### 3.2 Cómo se ve para el usuario

| Momento | Qué pasa | Qué ve |
|---|---|---|
| Sube el PDF | Capa 1 sobre todo el libro | Nada especial: es instantáneo |
| Se abre el capítulo 1 | Capa 2 sobre el capítulo 1, capa 3 lo verifica | Un punto discreto en la barra: «puliendo…» → desaparece |
| Lee el capítulo 1 | Capa 2 prepara el capítulo 2 en silencio | Nada |
| Pasa al capítulo 2 | Ya estaba listo | Aparece al instante |
| Pulsa Escuchar | Capa 4 al vuelo sobre el texto pulido | La voz lee con pausas naturales |
| Quiere el original | Interruptor `Original ⟷ Pulido` en el menú `⋯` | Vuelve al texto tal cual salió del PDF |

**Ningún botón que pulsar para que funcione.** Cumple el requisito de
«automáticamente al subir el PDF».

---

## 4. FASE 1 — Rediseño visual del apartado PDF

**Objetivo:** de ~28 controles visibles a **6** en el lector; el texto pasa a
ocupar el 70 % de la pantalla; y funciona igual de cómodo en móvil, tablet y
escritorio.

### 4.1 El principio rector

El panel PDF tiene **dos momentos que no deben compartir pantalla**:

- **Biblioteca** — elegir qué leer. Manda la rejilla de portadas.
- **Lector** — leer. Manda el texto. Todo lo demás está a un toque.

Hoy la regla `.pdf-area.has-results` (`index.html:1444-1449`) ya esconde el
lead, la subida, «Seguir leyendo», la biblioteca y la nube. **Se mantiene y se
amplía**: con documento abierto también se esconden el aviso de guardado, la
sección de exportar y el panel de preguntas (pasan al menú `⋯`).

### 4.2 Estado «Biblioteca» — qué cambia

| # | Cambio | Dónde | Por qué |
|---|---|---|---|
| 1 | **«Reiniciar» y «Borrar» salen de la cara de la tarjeta** y pasan a un menú `⋯` en la esquina superior derecha de cada portada | HTML de la tarjeta generado en `js/pdf/pdfController.js` (`pintarBiblioteca`, `:364`) | Hoy los dos únicos botones visibles de cada libro son **destructivos**. La jerarquía está invertida: lo que quieres que pulsen (abrir) no tiene botón. |
| 2 | **La tarjeta entera abre el libro** (ya lo hace `.pdf-libro-abrir`); se añade `cursor:pointer` en toda la tarjeta y estado `:active` con micro-escala | CSS `.pdf-libro` | Refuerza cuál es la acción principal |
| 3 | **El dropzone deja de ser un bloque aparte** cuando ya hay biblioteca: se convierte en **una tarjeta más de la rejilla**, con un `+` grande, al final | `#pdfSubir` / `#pdfDrop` (`index.html:4240-4249`) + CSS `.pdf-subir--secundaria` (`:1546`) | Ahorra ~200 px de altura y unifica «tus libros» y «añadir uno» en una sola lectura visual |
| 4 | **Los selectores de idioma y el rango de páginas se pliegan** dentro de un `<details>` «Opciones de lectura», cerrado por defecto | `.pdf-opts` (`:4251-4274`) y `#pdfRangeFold` (`:4276-4295`) | Son 3 controles siempre visibles que el 90 % de la gente no toca. En móvil ocupan ~400 px antes del botón de acción. |
| 5 | **El botón «Sacar el texto» desactivado deja de mostrar el gradiente naranja apagado**: en estado `:disabled` va plano, con el borde de `--line` y texto `--muted` | `.task-action .btn.primary:disabled` (usar **dos clases**, regla 1.2) | Hoy parece un botón roto, no un botón deshabilitado |
| 6 | **El aviso «Guardado en tu biblioteca: 30 páginas · 15.008 caracteres…» pasa a ser efímero**: aparece 6 s y se va solo | `avisar()` en `js/pdf/pdfController.js:145`, añadir opción `{efimero:true}` con `setTimeout` cancelable | Es información de proceso ya terminado; hoy ocupa un banner permanente encima del lector (4 líneas en móvil) |

### 4.3 Estado «Lector» — la reconstrucción

**Estructura nueva** (sustituye el bloque `index.html:4430-4643`):

```
┌───────────────────────────────────────────────────────────────┐
│ ← │ Título del libro                     ☰   🔊   ⋯          │  ← barra fija
│    │ CAPÍTULO III · 3 de 40 · 45 %                            │
│ ▓▓▓▓▓▓▓▓▓▓▓▓▓░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░  │  ← progreso
├───────────────────────────────────────────────────────────────┤
│                                                               │
│   CAPÍTULO III                                                │
│                                                               │
│   Aquella mañana el camino estaba cubierto por una niebla     │
│   espesa que apenas dejaba ver los árboles del sendero.       │
│   Nadie del pueblo se atrevía a salir de su casa mientras     │
│   la humedad siguiera pegada a las ventanas.                  │
│                                                               │
│              ( el texto ocupa el resto de la pantalla )       │
│                                                               │
├───────────────────────────────────────────────────────────────┤
│  ◀ Anterior            🔍 Buscar            Siguiente ▶       │  ← dock fijo
└───────────────────────────────────────────────────────────────┘
```

**Solo 6 controles visibles**: volver, índice, escuchar, más, anterior,
siguiente (+ buscar).

**El menú `⋯`** (un `<details>` o un panel deslizante; nativo y accesible)
recoge todo lo demás, agrupado con encabezados:

```
  TEXTO
    ( Original ‖ Pulido ✓ )        ← interruptor, aparece cuando hay pulido
    ( Original ‖ Español )         ← el que ya existe (#pdfTradCambio)
    Editar en grande               ← #btnPdfShowText
    Copiar                         ← #btnPdfCopy
  ESCUCHAR
    Voz, velocidad                 ← la consola TTS que ya existe
  DESCARGAR
    Texto .txt · Word .docx · PDF limpio · Markdown
  DOCUMENTO
    Preguntar al documento
    Modo lectura: ( ☀ Papel ‖ ☾ Noche )
    Vaciar el texto de pantalla
```

**Reglas de la reconstrucción:**

- **No se borra ningún `id` de la lista del §7.** Los nodos se **mueven**
  dentro del menú `⋯`, conservando su `id`, sus `title` y sus `aria-*`. El
  controlador los sigue encontrando.
- **Sí se eliminan del panel PDF** (decisión del dueño): `#btnPdfCorrect`,
  `#btnPdfCorrectUndo`, `#btnPdfParagraphs`, `#btnPdfPrompt` y sus etiquetas
  `#pdfCorrectLabel`, `#pdfParagraphsLabel`, `#pdfPromptLabel`. Hay que quitar
  también su cableado en `index.html:13479`, `:13508`, `:13533`, `:13793`
  **usando `?.`** para no romper si el nodo no existe (los demás paneles siguen
  usando las mismas funciones: `corregirTexto`, `aplicarParrafos`,
  `mejorarPrompt` **no se borran**).
- **Un solo acento por zona.** Se retiran del lector las clases de color propio
  `.btn-improve`, `.btn-translate`, `.btn-paragraphs`, `.btn-prompt`. Hoy hay 5
  colores distintos compitiendo en una fila.
- **El índice deja de ser un desplegable en escritorio**: pasa a columna
  lateral fija a la izquierda del texto (≥1024 px). En móvil y tablet sigue
  siendo un panel que se abre con `☰`.

### 4.4 Modo lectura Papel / Noche

Tokens nuevos, **solo dentro del lector** (no tocan la identidad global):

```css
/* Papel: para leer de día, como un libro */
#pdfResultArea[data-tema="papel"]{
  --lec-bg:#F7F3EA; --lec-texto:#1A1A1A; --lec-suave:#5C5750;
  --lec-linea:rgba(0,0,0,.10); --lec-acento:#0F766E;
}
/* Noche: coherente con la app, un punto menos duro que el fondo global */
#pdfResultArea[data-tema="noche"]{
  --lec-bg:#12161F; --lec-texto:#E9EDF6; --lec-suave:#9098AC;
  --lec-linea:rgba(255,255,255,.08); --lec-acento:#27E1C1;
}
```

Contraste verificado: `#1A1A1A` sobre `#F7F3EA` ≈ **15,8:1**; `#E9EDF6` sobre
`#12161F` ≈ **14,5:1**; acento `#0F766E` sobre papel ≈ **4,9:1** (AA). Todos
pasan WCAG AA con margen.

- Valor por defecto: **Noche** (no sorprende a quien ya usa la app).
- Se recuerda en `localStorage` con la clave **`jg_pdf_tema`** (prefijo `jg_`,
  regla 1.11). Leer con `jgCfgGet`/`jgCfgSet` si están disponibles, y siempre
  dentro de `try/catch`.
- El toggle vive en el menú `⋯`, sección DOCUMENTO.

### 4.5 Responsive — los tres tamaños

| | Móvil `<640px` | Tablet `640–1023px` | Escritorio `≥1024px` |
|---|---|---|---|
| Barra superior | 2 filas: (1) `←` + título; (2) acciones a **44 px** | 1 fila | 1 fila |
| Índice | Panel que se abre con `☰`, a pantalla completa | Panel que se abre con `☰` | **Columna lateral fija** 240 px a la izquierda |
| Texto | 17 px / interlineado **1,75** / padding 18 px | 17 px / 1,7 / ancho máx. **62ch** | 17 px / 1,7 / ancho máx. **68ch**, centrado |
| Navegación | **Dock fijo abajo** (`position:sticky; bottom:0`), 3 zonas de 44 px | Dock fijo abajo | Al final del texto, no fijo |
| Menú `⋯` | Panel deslizante desde abajo, ocupa 85 % del alto | Panel deslizante | Desplegable anclado al botón |
| Ancho del panel | 100 % | 100 % | El lector puede pasar de los 980 px de `.wrap` hasta **1200 px** para dar sitio a la columna del índice |

- En pantallas táctiles (`@media (pointer:coarse)`, ya existe en
  `index.html:1730`) **todos** los controles del lector suben a 44 px de alto.
- El dock inferior debe respetar el área segura de iOS:
  `padding-bottom: max(10px, env(safe-area-inset-bottom))`.
- **Ninguna zona puede provocar scroll horizontal.** Lo vigila
  `tests/verificar_pdf_geometria.mjs`.

### 4.6 Menos letra

Textos a acortar (hoy sobra explicación en pantalla):

| Hoy | Nuevo | Dónde |
|---|---|---|
| «Libros, manuales, apuntes o informes. Se lee **dentro de tu dispositivo**: el archivo no se sube a ningún servidor y no importa cuánto pese.» | «Libros, manuales o apuntes. **Se leen en tu dispositivo**, sin subirlos a internet.» | `index.html:4186` |
| «Libros completos, manuales o apuntes · se lee en tu dispositivo, sin subirlo a internet» (dentro del dropzone, repite lo de arriba) | *(se elimina: es la misma frase dos veces)* | `index.html:4244` |
| «Guardado en tu biblioteca: 30 página(s) · 15.008 caracteres · se quitaron 60 líneas de encabezados y numeración» | «Listo · 30 páginas» (efímero, 6 s). El detalle pasa al `title` | `js/pdf/pdfController.js:865-870` |
| «Encadena una parte tras otra sin que tengas que hacer nada, y recuerda dónde ibas.» | «Encadena los capítulos solo.» | `index.html:4508` |
| «Con sus capítulos, no solo la parte que ves» | *(pasa a `title` del grupo)* | `index.html:4594` |
| «El botón se activa cuando eliges un PDF.» | *(se elimina: el botón deshabilitado ya lo dice)* | `index.html:4302` |

### ✅ Criterios de aceptación de la Fase 1

1. En el lector, contando `button:not([hidden])` visibles dentro de
   `#pdfResultArea` con el menú `⋯` cerrado: **≤ 8** en los tres tamaños.
2. En móvil (Pixel 7), con un documento abierto, la primera línea de texto del
   libro está a **menos de 420 px** del borde superior del panel.
3. `node tests/verificar_pdf_geometria.mjs` → **0 fallos** en los cuatro
   estados y los tres tamaños.
4. `node tests/verificar_pdf_navegador.mjs` → las **105 comprobaciones**
   siguen en verde (el rediseño no rompe ninguna función).
5. El toggle Papel/Noche cambia el fondo del lector y **sobrevive a recargar**
   la página.
6. Cero errores de JavaScript en consola en móvil, tablet y escritorio.

---

## 5. FASE 2 — Pulido mecánico y texto para voz (sin IA, sin coste)

Esta fase sola ya elimina buena parte del sonido robótico, **sin gastar una
sola consulta de IA y sin conexión**.

### 5.1 Ampliar `js/pdf/limpiezaTexto.js`

Añadir una función pura exportada, aplicada al final de `componerTexto`
(`js/pdf/limpiezaTexto.js:303`, donde hoy se llama a `pulirTipografia`):

```js
/**
 * Deja el texto listo para leer y para que el motor de voz sepa dónde parar.
 * Función pura: NO cambia ninguna palabra, solo signos y espacios.
 */
export function pulirParaLectura(texto) { … }
```

Reglas a implementar, **en este orden**, todas conservando las palabras:

| # | Regla | Ejemplo |
|---|---|---|
| 1 | Comillas rectas → tipográficas por pares | `"hola"` → `«hola»` |
| 2 | Tres o más puntos → elipsis única | `....` → `…` |
| 3 | Guion largo de diálogo con espaciado correcto | `-Ven aquí -dijo.` → `—Ven aquí —dijo.` |
| 4 | Quitar espacio **antes** de `, . ; : ! ?` y garantizar uno **después** | `hola ,que tal` → `hola, que tal` |
| 5 | Cerrar párrafo que termina en letra sin signo (y **no** es un título ni acaba en `:` `;` `,`) | `…las puertas` → `…las puertas.` |
| 6 | Mayúscula tras `. ! ? …` seguido de espacio | `. aquella` → `. Aquella` |
| 7 | Colapsar 3+ saltos de línea a 2 (párrafo) | ya existe en `pulirTipografia` |
| 8 | Ligaduras tipográficas | ya existe (`LIGADURAS`, `:29-32`) |
| 9 | Unir palabra partida por guion de fin de renglón | ya existe (`GUIONES_DE_CORTE`, `:266-276`) |

> **La regla 5 es la que más cambia el sonido**: un párrafo sin punto final hace
> que el troceador de voz (`index.html:11209`) se lleve el párrafo siguiente
> pegado y luego corte por caracteres a mitad de frase.

**Nunca:** cambiar, añadir ni quitar una palabra. Ni tildes (eso es trabajo de
la capa 2, que sí pasa por el guardián).

### 5.2 Nuevo módulo `js/pdf/vozTexto.js`

```js
/* JG Turbo · El texto tal como debe SONAR, no como debe verse.
 *
 * El motor de voz lee «S. XIX» como ese-punto-equis-i-equis. Este archivo
 * traduce el texto escrito a texto hablado. Su salida NUNCA se muestra en
 * pantalla, ni se guarda, ni se exporta: se genera justo antes de hablar y
 * se tira. Por eso el texto del libro sigue siendo exactamente el del PDF.
 */
export function prepararParaVoz(texto, idioma = 'es') { … }
```

Conversiones (para español; si `idioma !== 'es'`, aplicar solo 1, 2 y 7):

| # | Regla | Ejemplo |
|---|---|---|
| 1 | Números enteros ≤ 9999 a palabras | `1997` → `mil novecientos noventa y siete` |
| 2 | Ordinales y porcentajes | `45 %` → `cuarenta y cinco por ciento` |
| 3 | Abreviaturas frecuentes | `etc.` → `etcétera` · `Dr.` → `doctor` · `Sr.` → `señor` · `pág.` → `página` · `cap.` → `capítulo` · `p. ej.` → `por ejemplo` |
| 4 | Siglos en romano | `S. XIX` → `siglo diecinueve` |
| 5 | Siglas que se deletrean vs. las que se leen | `ONU` se lee; `EE. UU.` → `Estados Unidos` |
| 6 | Guiones de rango | `1914-1918` → `de mil novecientos catorce a mil novecientos dieciocho` |
| 7 | **Marcar la pausa de párrafo**: el doble salto se convierte en `.\n\n` para que el troceador siempre encuentre ahí un corte limpio | resuelve `index.html:11264-11265` |

**Punto de aplicación exacto:** `js/pdf/pdfController.js:1044` y `:1055`, dentro
de `alternarAudiolibro`, envolviendo el texto justo antes de entregarlo:

```js
const texto = prepararParaVoz(textoDeParte(estado.parteActual), idiomaActual());
```

No tocar `ttsHablar` ni el motor de voz: la regla del proyecto es que la lógica
de PDF no entra en el motor de voz (`Agents.md:102-104`).

### 5.3 Pruebas nuevas

Crear `tests/test_pdf_pulido_mecanico.mjs` (mismo estilo que
`tests/test_pdf_limpieza.mjs`, que ya prueba funciones puras en Node):

- Cada una de las 9 reglas de `pulirParaLectura`, con su caso y su
  contraejemplo (que no toque lo que ya está bien).
- **La prueba clave: `pulirParaLectura` nunca cambia la lista de palabras.**
  Normaliza entrada y salida (minúsculas, sin signos) y exige igualdad exacta.
- Cada regla de `prepararParaVoz` con su ejemplo.
- Un texto real de PDF con párrafos sin punto: comprobar que después del
  pulido `ttsPartirTexto` (lógica equivalente) **no necesita el corte bruto**.

### ✅ Criterios de aceptación de la Fase 2

1. `node tests/test_pdf_pulido_mecanico.mjs` → todo en verde.
2. La prueba de «no cambia ni una palabra» pasa sobre los tres PDF de prueba
   (`tests/generarPdfPrueba.mjs`, `generarPdfEscaneado.mjs`).
3. Escuchar un capítulo real de libro: **ninguna frase se corta a mitad**.
4. Sin conexión a internet, el texto extraído ya sale con puntuación cerrada.

---

## 6. FASE 3 — Que «Pulir» deje de fallar (troceo en el navegador + guardián)

### 6.1 Backend: modo lectura en `/api/improve`

**No se crea un endpoint nuevo.** Se añade un campo opcional a
`ImproveRequest` (`api/index.py:251`):

```python
mode: Optional[str] = "transcripcion"   # "transcripcion" | "lectura"
```

En `construir_prompt` (`api/index.py:2493`), si `mode == "lectura"`, usar este
prompt en lugar del actual. El prompt de hoy dice *«editor conservador
especializado en texto hablado y transcripciones ASR»*: está pensado para
Whisper, no para un libro, y por eso pide *«conserva exactamente párrafos,
saltos y distribución»* — justo lo contrario de lo que necesita un PDF mal
maquetado.

```
Eres corrector de puntuación para lectura en voz alta, en «{lang_base}».

Este texto salió de un PDF. Al extraerlo se perdieron puntos, comas y signos
de apertura, y hay frases que quedaron pegadas o partidas. Alguien va a
ESCUCHARLO con una voz sintética: si falta un punto, la voz no respira; si
falta una coma, atropella.

TU ÚNICO TRABAJO es devolver EXACTAMENTE LAS MISMAS PALABRAS, EN EL MISMO
ORDEN, con la puntuación correcta.

SÍ debes:
1) Poner los puntos que faltan al final de cada oración.
2) Poner las comas que pide la sintaxis: incisos, enumeraciones, vocativos,
   y antes de «pero», «aunque», «sino», «porque» cuando corresponda.
3) Abrir los signos: ¿…? y ¡…!
4) Poner las tildes que falten y corregir las que estén mal.
5) Mayúscula después de punto y en nombres propios.
6) Separar en párrafos donde claramente cambia el tema, con una línea en blanco.
7) Unir una palabra que quedó partida («compren dido» → «comprendido»).

NUNCA debes:
- Cambiar una palabra por otra, ni siquiera por un sinónimo mejor.
- Añadir una sola palabra que no esté en el original.
- Quitar una sola palabra del original.
- Reordenar, resumir, ampliar, explicar ni embellecer.
- Traducir nada.
- Cambiar cifras, nombres propios, marcas, siglas, URLs ni unidades.
- Escribir comentarios, títulos, markdown ni comillas envolventes.

Si una frase te parece rara, DÉJALA IGUAL. No es tu trabajo arreglarla.
Se va a comparar tu salida palabra por palabra con el original: si cambias
una sola palabra, tu trabajo se descarta entero.

SALIDA: solo el texto, en texto plano.

TEXTO:
<<<
{bloque}
>>>
```

También en `api/index.py`: añadir `max_length=12000` a `ImproveRequest.text`
para que un error futuro devuelva un **422 claro** en vez de un 504 mudo
(regla 2.1.g). El troceo del cliente nunca superará ese tamaño.

### 6.2 Frontend: la puerta única a `/api/improve`

Junto a `jgPedirTraduccion` (`index.html:6947`), crear:

```js
/* Puerta ÚNICA a /api/improve. Igual que jgPedirTraduccion: nadie más
 * puede llamar a ese endpoint, porque quien lo haga se saltará el troceo
 * y volverá el 504. Hay una prueba que lo vigila. */
async function jgPedirPulido(cuerpo, timeoutMs) { … }   // 1 reintento en 504/502
```

Y el orquestador, calcado de `traducirTranscripcionDetallada`
(`index.html:6973-7038`):

```js
const PULIR_MAX_CHARS_POR_PETICION = 6000;   // mismo margen medido que traducir
const PULIR_PETICIONES_EN_PARALELO = 2;

async function jgPulirTextoDetallado(texto, idioma, { onProgreso } = {}) {
  const trozos = jgTrocearParaTraducir(texto, PULIR_MAX_CHARS_POR_PETICION);
  // … jgMapaConLimite(trozos, PULIR_PETICIONES_EN_PARALELO, …)
  // … cada bloque pasa por el guardián (§6.3) ANTES de aceptarse
  // … reensamblar con '\n\n' (coherente con api/index.py:790)
}
```

**Diferencia importante con la traducción:** la traducción es *todo o nada* (si
un bloque vuelve vacío, lanza error, `index.html:7027`). El pulido es
**degradable**: si un bloque falla o el guardián lo rechaza, **se usa el
original de ese bloque** y se sigue. Pulir es una mejora, no un requisito: nunca
debe impedir leer.

### 6.3 El guardián de integridad — la garantía de «no cambia el texto»

En `js/pdf/pulido.js`, función pura y exportada:

```js
/**
 * ¿El texto pulido dice exactamente lo mismo que el original?
 *
 * Compara solo las PALABRAS: quita signos, tildes y mayúsculas, porque
 * cambiarlos es justo lo que queremos que el pulido haga. Lo que no puede
 * hacer es inventar, borrar o sustituir una palabra.
 *
 * Devuelve { igual:boolean, parecido:number, motivo:string }
 */
export function mismasPalabras(original, pulido) { … }
```

Implementación:

1. Normalizar ambos: `NFD` sin diacríticos, minúsculas, quitar todo lo que no
   sea letra o dígito, colapsar espacios.
2. Si las cadenas normalizadas son idénticas → `igual: true`, `parecido: 1`.
3. Si no, comparar los arrays de palabras con multiconjunto:
   `parecido = comunes / Math.max(a.length, b.length)`.
4. **Umbral: `parecido >= 0.98` acepta; por debajo, rechaza** y se usa el
   original de ese bloque.
5. Rechazo inmediato, sin importar el parecido, si el pulido tiene **más del
   2 % de palabras** que el original (señal de invención) o **menos del 90 %**
   (señal de truncado).

Este guardián corre **en el navegador**, es determinista y no cuesta nada. Es
lo que convierte «no cambia el texto» de promesa en hecho verificable.

### 6.4 Limpiar los caminos rotos

- **Eliminar** el cableado de `#btnPdfImprove` y `#btnPdfCorrect` en el panel
  PDF (`index.html:13479`, `:13573`). El pulido pasa a ser automático.
- `mejorarTexto` (`index.html:13175`) **se conserva** para Micrófono, Archivo,
  YouTube y el editor grande, pero **debe pasar a usar el mismo troceo**: hoy
  manda el texto entero (`:13235`) y falla igual con cualquier transcripción
  larga. Cambiar su cuerpo para llamar a `jgPulirTextoDetallado`.
- Igual con `corregirTexto` (`index.html:10242`): mismo defecto, misma cura.

### 6.5 Pruebas nuevas

`tests/test_pdf_pulido_troceo.mjs` y un test en `backend/tests/`:

1. **`test_ningun_camino_llama_a_improve_saltandose_el_troceo`** — copia de
   `test_ningun_camino_llama_a_translate_saltandose_el_troceo`
   (`backend/tests/test_traducir_largo.py:237`): exige **exactamente una**
   llamada a `/improve` en todo `index.html`.
2. Un texto de 90.000 caracteres se parte en **≥ 15 bloques**, ninguno
   > 6.000.
3. El guardián acepta un pulido que solo añade puntos, comas y tildes.
4. El guardián **rechaza**: una palabra sustituida por un sinónimo; una frase
   añadida; un final truncado.
5. Si un bloque falla, el resultado contiene el original de ese bloque y el
   pulido de los demás (degradación).

### ✅ Criterios de aceptación de la Fase 3

1. Pulir un capítulo de **90.000 caracteres** termina **sin error**, con
   progreso visible bloque a bloque.
2. Pulir un libro completo de **300.000 caracteres** (todos los capítulos)
   termina sin un solo 504.
3. Todas las pruebas nuevas y las 27 de `test_pdf_traduccion.mjs` en verde.
4. `grep -c "'/improve'" index.html` → **1**.
5. Comparando original y pulido de un capítulo real: **la lista de palabras es
   idéntica**.

---

## 7. FASE 4 — Que sea automático

### 7.1 Almacén de pulidos en IndexedDB

En `js/pdf/biblioteca.js`:

- `const PULIDOS = 'pulidos';` y **subir `VERSION` de 2 a 3** (`:19`).
- En `onupgradeneeded` (`:40`): crear el almacén con `keyPath: 'clave'`, igual
  que `traducciones` (`:51`). **Conservar la migración de la versión 1**
  (`:55-94`): un usuario que no abre la app desde hace meses tiene que saltar
  de la 1 a la 3 de una vez.
- Añadir `guardarPulido(id, indice, texto)`, `cargarPulido(id, indice)` y
  `pulidosDe(id)` — copia literal de `guardarTraduccion` / `cargarTraduccion` /
  `traduccionesDe` (`:323-356`) con clave `` `${id}|${indice}` ``.
- Añadir `PULIDOS` a la lista de almacenes de `borrarDocumento` (`:362`) y
  `vaciarBiblioteca` (`:392`). **Si se olvida, borrar un libro deja basura.**

### 7.2 Nuevo módulo `js/pdf/pulido.js`

Copia estructural de `js/pdf/traduccion.js:30` (`crearTraductor`):

```js
export function crearPulidor({ pulir, guardar, cargar }) {
  const listas = new Map();     // memoria de esta sesión
  const enCurso = new Map();    // dos peticiones a la vez → una sola llamada
  const conocidos = new Set();  // pulidos de sesiones anteriores
  return {
    async obtener(indice, parte, { alProgresar } = {}) { … },
    precargar(indice, parte) { … },   // sin que nadie espere
    estaPulido(indice) { … },
    sembrar(indices) { … },
  };
}
```

Dentro de `obtener`, antes de guardar: pasar por `mismasPalabras` (§6.3). Si
rechaza, **guardar el original** y marcarlo, para no volver a pagar por el mismo
capítulo una y otra vez.

### 7.3 El interruptor en `textoDeParte`

`js/pdf/pdfController.js:127` pasa a:

```js
function textoDeParte(indice) {
  if (estado.vista === 'es' && estado.traducido.has(indice)) return estado.traducido.get(indice);
  if (estado.pulidoActivo && estado.pulido.has(indice)) return estado.pulido.get(indice);
  return estado.partes[indice]?.texto || '';
}
```

**Un solo cambio y la pantalla, la voz, el buscador y las exportaciones usan el
texto pulido**, porque todos leen de aquí (`:534`, `:1044`, `:1055`, `:140`,
`:987`, `:143`).

Ajustar también `fijarTextoDeParte` (`:132`) con la misma prioridad, para que
una edición manual sobre el texto pulido se guarde en el pulido y no en el
original.

`estado.pulidoActivo` arranca en `true`, y se recuerda en
`localStorage.jg_pdf_pulido`.

**Orden con la traducción:** si el documento está en otro idioma, se traduce el
texto **pulido** (mejor puntuación → mejor traducción). Es decir: pulir primero,
traducir después.

### 7.4 El disparo automático

- En `montarDocumento` (`js/pdf/pdfController.js:588`): `pulidor.sembrar(...)`
  con lo que ya haya en IndexedDB, y lanzar `pulidor.obtener(parteActual)`.
- En `mostrarParte` (`:528`): tras pintar, `pulidor.precargar(indice + 1)`.
- En `entregarDocumento` (`:768`), justo después de `guardarDocumento`: lanzar
  el pulido del capítulo 0 **sin `await`** para que no retrase la apertura.

**Reglas de comportamiento:**

- Si no hay clave de IA configurada o no hay conexión: **no se intenta**, no se
  muestra ningún error. El texto se queda con el pulido mecánico de la Fase 2,
  que ya es mejor que hoy. El pulido con IA es un extra, no un requisito.
- Mientras un capítulo se pule, el usuario **puede leer** el original: nunca se
  bloquea la pantalla. Se muestra un punto discreto «puliendo…» en la barra de
  progreso, no un overlay.
- Un capítulo se pule **una sola vez en la vida del documento** (queda guardado
  y viaja en la sincronización entre dispositivos).
- Cuando el capítulo pulido llega, si el usuario no ha desplazado la pantalla,
  se cambia el texto en el sitio; **si ya está leyendo, se espera** al cambio de
  capítulo. Cambiarle el texto bajo los ojos es peor que esperar.

### 7.5 Sincronización

`js/pdf/nube.js` y `js/pdf/biblioteca.js:439` (`partesParaSubir`) ya suben los
capítulos con su traducción. Añadir el pulido al mismo paquete, con el mismo
patrón. Si el servidor no lo soporta todavía, **degradar en silencio**: que
falte el pulido nunca puede romper una sincronización.

### ✅ Criterios de aceptación de la Fase 4

1. Subir un PDF en inglés de 40 capítulos: **sin tocar nada**, el capítulo 1 se
   pule solo y el 2 está listo antes de llegar.
2. Cerrar la app, volver al día siguiente: los capítulos pulidos **siguen
   pulidos** (no se vuelve a pagar).
3. El interruptor `Original ⟷ Pulido` cambia el texto en pantalla, lo que se
   escucha y lo que se descarga.
4. Sin clave de IA: la app funciona igual, sin un solo mensaje de error.
5. Borrar un libro no deja registros huérfanos en el almacén `pulidos`.
6. `node tests/verificar_sync_dos_dispositivos.mjs` sigue en verde.

---

## 8. Pruebas — la batería completa

| Comando | Qué cubre | Estado |
|---|---|---|
| `node tests/verificar_pdf_navegador.mjs` | 105 comprobaciones funcionales en navegador | existe · **no puede bajar de 105** |
| `node tests/verificar_pdf_geometria.mjs` | Geometría en 3 tamaños × 4 estados: sin overflow, táctil 44 px, toolbar fijo, 0 errores JS | existe · **ampliar** con el dock inferior y el menú `⋯` |
| `node tests/test_pdf_progreso.mjs` | 36 casos de progreso | existe |
| `node tests/test_pdf_traduccion.mjs` | 27 casos de traducción | existe |
| `node tests/test_pdf_limpieza.mjs` | Limpieza mecánica del PDF | existe · **ampliar** |
| `node tests/verificar_sync_dos_dispositivos.mjs` | Sincronización de punta a punta | existe |
| `node tests/test_pdf_pulido_mecanico.mjs` | **Nueva.** Las 9 reglas + «no cambia ni una palabra» + `prepararParaVoz` | crear en Fase 2 |
| `node tests/test_pdf_pulido_troceo.mjs` | **Nueva.** Troceo, guardián, degradación por bloque | crear en Fase 3 |
| `pytest backend/tests/test_traducir_largo.py` | Guardián de troceo · **añadir el equivalente para `/improve`** | ampliar en Fase 3 |
| `node tests/capturas_pdf.mjs` | Capturas antes/después en `tests/capturas/` | existe · correr al final |

**Antes de dar nada por terminado**, correr la batería entera y comparar las
capturas nuevas contra
`tests/capturas/despues_{pc,tablet,movil}_{vacio,biblioteca,lector}.png`, que
son el estado de partida.

> Nota para quien automatice: el panel scrollea por dentro y el clic por
> coordenadas de Playwright se pelea con ese scroll anidado (medido: oscila
> entre dos posiciones sin llegar nunca). Los clics dentro de `.pdf-area` se
> hacen **por DOM** (`element.click()`), no por coordenadas.

---

## 9. Entrega y despliegue (obligatorio)

Una mejora **no está cerrada** mientras solo exista en local.

1. Editar en `Spech to text App/`.
2. **Documentar todo en `CAMBIOS_PDF.md`**: versión (v3.0), qué se pidió, qué
   estaba mal, qué se hizo, pruebas, `dpl_…`.
3. Alinear `Agents.md` (sección PDF) con las decisiones nuevas: pulido
   automático, puerta única a `/api/improve`, modo Papel/Noche, versión 3 de
   IndexedDB.
4. Subir la versión visible: comentario de la línea 1 de `index.html`, el
   `console.log` de versión y el `CACHE_SHELL` de `sw.js`
   (`jg-turbo-shell-v44` → **`jg-turbo-shell-v45`**). Sin esto el deploy no es
   verificable y quien tenga la PWA instalada no recibe el cambio.
5. Sincronizar a `../vercel_deploy/`: `index.html`, `js/pdf/*`, `api/index.py`,
   `sw.js`, `vercel.json` y los `.md` tocados
   (`node sincronizar_deploy.mjs` si aplica).
6. Desplegar **solo** `vercel_deploy`:

   ```bash
   cd ../vercel_deploy
   npx vercel --prod --yes --scope jhoncod24s-projects
   ```

   - **No usar `--cwd`**: con Vercel CLI 59.x devuelve `Not authorized`.
   - **Nunca desde la raíz del monorepo**: sube ~1000 archivos y deja 404.
7. Verificar contra **https://jg-turbo.vercel.app** (no contra la URL que
   imprime el CLI): buscar los marcadores nuevos en el HTML servido, comprobar
   el `CACHE_SHELL` de `sw.js` y que `/api/health` responde en verde.
8. Anotar el `dpl_…` en `CAMBIOS_PDF.md`.

---

## 10. Archivos que se tocan

| Archivo | Qué se hace |
|---|---|
| `Spech to text App/index.html` | Rediseño del panel PDF (HTML ≈ `4180-4647`, CSS ≈ `1426-2026`); `jgPedirPulido` + `jgPulirTextoDetallado` junto a `:6947`; quitar cableado de Corregir/Párrafos/Prompt del PDF; `prepararParaVoz` en el audiolibro |
| `Spech to text App/js/pdf/pdfController.js` | `textoDeParte` (`:127`), `fijarTextoDeParte` (`:132`), `mostrarParte` (`:528`), `montarDocumento` (`:588`), `entregarDocumento` (`:768`), `alternarAudiolibro` (`:1039`), `pintarBiblioteca` (`:364`), `avisar` efímero (`:145`) |
| `Spech to text App/js/pdf/limpiezaTexto.js` | Nueva `pulirParaLectura`, aplicada en `componerTexto` (`:303`) |
| `Spech to text App/js/pdf/vozTexto.js` | **Nuevo.** `prepararParaVoz` |
| `Spech to text App/js/pdf/pulido.js` | **Nuevo.** `crearPulidor` + `mismasPalabras` |
| `Spech to text App/js/pdf/biblioteca.js` | Almacén `pulidos`, `VERSION` 2 → 3, tres funciones nuevas, borrado |
| `Spech to text App/js/pdf/nube.js` | Subir/bajar el pulido con degradación silenciosa |
| `Spech to text App/api/index.py` | `ImproveRequest.mode` + `max_length`; prompt de modo lectura en `construir_prompt` (`:2493`) |
| `Spech to text App/sw.js` | `CACHE_SHELL` → `jg-turbo-shell-v45` + registrar los módulos nuevos |
| `Spech to text App/tests/*` | Dos suites nuevas, dos ampliadas |
| `Spech to text App/CAMBIOS_PDF.md`, `Agents.md` | Documentación de la entrega v3.0 |

---

## 11. Orden de ejecución

```
Fase 1  Rediseño visual          ← lo primero que pidió el dueño
Fase 2  Pulido mecánico + voz    ← mejora el sonido sin IA ni coste
Fase 3  Pulir sin errores        ← arregla el 504
Fase 4  Pulido automático        ← enciende el interruptor
Fase 5  Batería de pruebas + despliegue + documentación
```

Cada fase deja la app **funcionando y desplegable**. No pasar a la siguiente sin
cerrar los criterios de aceptación de la anterior.
