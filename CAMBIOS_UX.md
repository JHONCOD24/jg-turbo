# Rediseño de experiencia de usuario y calidad — JG Turbo

Fecha base: 2026-07-30 · **UI actual: v3.6** (2026-08-02) · Prod: <https://jg-turbo.vercel.app>

---

## v3.6 — FAB Grabar/Detener + responsive de opciones · 2026-08-02

### Pedido

- En móvil, al grabar por fragmentos el texto empuja el scroll y se pierde el botón de grabar.
- El intento anterior (v3.5) dejó un botón flotante **solo para Detener**, y al mover el `.recBtn` original con `position: fixed` se rompió el layout (botones solapados).
- Revisar opciones de dictado / sensibilidad sin dañar la calidad de la transcripción Whisper.
- Desplegar en Vercel.

### Diagnóstico

- Flotar el mismo botón de grabar (`position: fixed` sobre `.recBtn` solo con `.recording-active`) sacaba el control del flujo del documento, dejaba un hueco raro en la cabecera del mic y solo servía mientras grababas: al detener y bajar a leer el texto, el usuario volvía a perder «Grabar».
- En la rejilla de chips, la fila de idiomas (`.lang-row`) no ocupaba las dos columnas → selects apretados o fuera de caja en pantallas estrechas.
- La sensibilidad ya era solo visual; no toca el audio ni Whisper.

### Solución

1. **FAB dedicado `#recFab` (móvil ≤640px, panel Mic):**
   - Botón flotante **aparte** del `.recBtn` (no se mueve el original → no se rompe el layout).
   - Sirve para **Iniciar y Detener** (mismo `toggleGrabacion` vía clic al principal).
   - Visible solo cuando el botón principal **sale del viewport** (`IntersectionObserver`). Si está a la vista, no se duplica.
   - Estado visual sincronizado (Grabar / Detener, animación `live`, disabled).
   - Posición: esquina inferior derecha, por encima de la barra sticky de acciones y del safe-area.
2. **Opciones de dictado:** idiomas a ancho completo (`grid-column: 1 / -1`); sensibilidad en grid estable; tooltips CSS de chips desactivados en táctil (siguen los `title`).
3. **Transcripción:** sin cambios en captura, MediaRecorder, segmentación, Whisper ni corrección contextual. Solo UI.

### Pruebas

- JavaScript inline de `index.html`: sintaxis válida (`new Function`).
- Marcadores: `id="recFab"`, `jgSincronizarRecFab`, sin `position:fixed` sobre `.recording-active .recBtn`.
- Lógica esperada móvil: scroll con texto largo → aparece FAB «Grabar»; al grabar y bajar → FAB «Detener»; pestaña Archivo/YouTube → FAB oculto; escritorio → sin FAB.

### Deploy

- Sync: `index.html` + este documento → `vercel_deploy/`.
- Deploy de producción: `D2SS7wuqehwuB7u3tGbUgacWF4n8` · Ready.
- Alias verificado: <https://jg-turbo.vercel.app> (marcador `#recFab` + `jgSincronizarRecFab` en el HTML).

---

## v3.5 — Grabación móvil, opciones claras y medidor estable · 2026-08-02

### Pedido

- Mantener el botón de grabar disponible mientras una transcripción móvil crece.
- Revisar las opciones de dictado y reducir el exceso de texto al desplegarlas.
- Evitar que la sensibilidad del medidor se salga de su tarjeta.
- Conservar la calidad actual de Whisper y revisar Archivo, detección de idioma y YouTube sin cambiar su flujo automático.

### Diagnóstico

- El panel de vista previa en vivo acumulaba todo el texto sin límite de alto y empujaba el resto de la aplicación hacia abajo.
- El botón de grabación seguía dentro del flujo normal del documento. Al crecer el contenido, dejaba de estar a mano.
- La fila de sensibilidad tenía una etiqueta que no podía encogerse en pantallas pequeñas.
- Las opciones sí funcionaban, pero sus etiquetas y descripciones no dejaban claro que puntuación, preguntas y código aplican al dictado en vivo; la transcripción final usa el audio completo y Whisper.

### Solución

- En móvil, la vista previa en vivo tiene scroll interno y altura máxima; ya no aumenta la altura de toda la página.
- Mientras se graba, el botón queda flotante sobre el viewport, por encima de la barra de acciones y respetando el área segura del teléfono. En escritorio no cambia.
- La sensibilidad usa una fila adaptable: etiqueta arriba, control y valor abajo. Se mantiene como control visual y no se presenta como una mejora de calidad del audio.
- Las seis opciones se muestran en una rejilla de dos columnas con nombres cortos y la explicación completa queda en tooltip accesible.
- El botón de comandos de voz continúa abriendo el modal desde móvil.
- Se mantuvo la cadena actual de precisión: audio acondicionado, Whisper completo `whisper-large-v3`, segmentación de audios largos y corrección contextual opcional.

### Alcance real de las opciones

| Opción visible | Qué controla | Qué no controla |
|---|---|---|
| **Sensibilidad de la onda** | Cuánto se mueven las barras del medidor en pantalla. | No modifica el audio capturado ni la precisión de Whisper. |
| **Puntuación** | Convierte «punto», «coma», «nueva línea» y comandos similares durante el dictado en vivo del navegador. | No fuerza cambios artificiales sobre el resultado final de Whisper. |
| **Preguntas** | Añade `¿` y `?` a preguntas detectadas durante el dictado en vivo en español. | No cambia frases que Whisper ya entregó correctamente. |
| **Código** | Convierte comandos como «abrir paréntesis» o «abrir llave» durante el dictado en vivo. También puede activarse automáticamente al detectar señales claras de código. | No transforma texto normal ni altera el audio. |
| **Mayúsculas** | Ajusta mayúsculas al insertar fragmentos en el editor. | No corrige palabras mal escuchadas. |
| **Términos** | Normaliza marcas y términos técnicos usando el glosario local y reglas conocidas. | No reemplaza una revisión contextual completa. |
| **Contexto** | Activa el glosario, la corrección local y la corrección contextual con IA cuando está configurada. | No inventa contenido ni cambia el sentido intencionalmente. |

### Archivo, idioma y YouTube

- **Archivo** sigue enviando `language=auto` cuando se deja «Detectar idioma». Si se elige un idioma concreto, se respeta en la petición a Whisper.
- **Micrófono** conserva «Español (Colombia)» como valor inicial para que el dictado en vivo del navegador tenga una variante estable. Se puede cambiar a detección automática u otra variante.
- **Idioma del texto** sigue siendo independiente del idioma del audio. Si se selecciona otro idioma, la aplicación traduce después de transcribir.
- **YouTube** conserva la extracción automática: subtítulos gratuitos, Supadata, respaldo con Whisper y pegado manual como red de seguridad. No se retiró ningún camino de recuperación.
- No se modificaron `api/index.py`, `api/supadata.py`, `api/calidad_linguistica.py`, `backend/app.py` ni las claves `jg_*`. El cambio v3.5 fue de interfaz, comportamiento móvil y documentación.

### Archivos de esta entrega

- `Spech to text App/index.html`: estilos móviles, vista previa en vivo, botón flotante, panel de opciones y sincronización de estado del modo código.
- `Spech to text App/CAMBIOS_UX.md`: registro maestro de la entrega.
- `Spech to text App/DOCUMENTACION_DESPLIEGUE.md`: registro operativo del deploy y verificación.
- `Spech to text App/FICHA_TECNICA.md`: alcance funcional de las opciones y comportamiento móvil.
- Copias sincronizadas en `vercel_deploy/` antes del deploy.

### Decisiones de compatibilidad

- El botón usa `position: fixed` solo en móvil y solo mientras se graba.
- La animación de entrada del panel se desactiva durante la grabación para que no cree un contenedor que rompa el anclaje del botón al viewport.
- Se respetan el área segura inferior del teléfono, los objetivos táctiles de al menos 44 px y `prefers-reduced-motion`.
- No se agregaron dependencias ni se cambiaron nombres de preferencias persistentes.

### Pruebas

- JavaScript inline de `index.html`: sintaxis válida.
- Playwright móvil 360×732: sin overflow horizontal; sensibilidad dentro de la tarjeta; opciones en rejilla; interruptor y slider responden; comandos de voz abre el modal.
- Playwright móvil: botón flotante anclado al viewport (`position: fixed`) durante la grabación.
- Playwright escritorio 1280×900: botón conserva posición normal y no se aplica el estilo móvil.
- `backend/tests/test_segmentacion_upload.py`: 5 passed.
- `backend/tests/test_calidad_linguistica.py`: 4 passed.
- `backend/tests/test_supadata_youtube.py`: 25 passed.
- `backend/tests/test_transcribe.py`: pendiente por timeout del entorno local al cargar el stack de transcripción; no se modificó ese flujo.

### Deploy

- Sync: `index.html` y este documento hacia `vercel_deploy/`.
- Deploy de producción: `dpl_3ox2F8Pgk5m1JS21MGGQBHxBM4ij` · Ready.
- Alias verificado: <https://jg-turbo.vercel.app>.
- `/api/health` verificado: `status: ok`, `model_ready: true`, `groq_configured: true`, `youtube_auto: true`.

## v3.4 — Micrófono: audios largos (4–10+ min) por partes · 2026-08-01

### Pedido

Audio de ~4 min en Micrófono «no funcionó». Querían límites claros y que 10+ min
transcriban bien en producción.

### Causa raíz

WAV acondicionado 16 kHz mono ≈ **1,92 MB/min** → 4 min ≈ **7,7 MB** > **~4,5 MB**
de body de Vercel Functions → rechazo 413 sin llegar a Groq.

### Solución

- Partir en el navegador en tramos de **~100 s** (~3,2 MB), techo **3,6 MB** en nube.
- Corte en valle de silencio (±6 s); solape 0,4 s; **1 reintento** por parte (1,5 s).
- En **local** no se parte si el WAV cabe en ~49 MB (una sola llamada).
- Progreso «parte X de Y»; UI «hasta 15 min en la nube».
- Tests: `backend/tests/test_segmentacion_upload.py` (5/5).
- Doc: `PRECISION_AUDIO.md` § «Grabaciones largas» + evidencia 413 medida.

### Archivos

`index.html`, `api/index.py` (limits en session-config), `PRECISION_AUDIO.md`, `FICHA_TECNICA.md`, este MD.

| Versión UI | Fecha | Qué cambió | Deploy prod (alias jg-turbo) |
|---|---|---|---|
| **v3.4** | 2026-08-01 | Micrófono largo: partes ~100 s + reintento (fix 4+ min) | `DfFAZGpykVus3fAzuq9aGJuQWEJf` · Ready |
| **v3.3** | 2026-08-01 | Tooltips de Corregir + botón **Párrafos** + más interlineado | `Gb98kfU548hEita66b1mY1YZQyYj` · Ready |
| **v3.2** | 2026-08-01 | TTS en franja horizontal (más texto en editores) | `CD7GVazANst7gZCovnGZRrYAq1A3` · Ready |
| **v3.1** | 2026-08-01 | «Más acciones» en rejilla móvil con aire | `H3wGeFciRqyyYRMnPwgE974X55yy` · Ready |
| docs | 2026-08-01 | Documentación v3.1+v3.2 en MD + sync prod | `DmUo7yn9jtym7BPBj2VQ5tsSWDLs` · Ready |
| v3 | 2026-07-30 | Rediseño «el texto manda» | ver historial abajo |

---

## v3.3 — Corregir explicado + Párrafos para leer mejor · 2026-08-01

### Pedido del usuario

1. Al pasar el cursor sobre **Corregir**, no se entiende qué hace.  
2. El texto de la transcripción queda **muy condensado**; quiere **párrafos** para leer más fácil (botón aparte o dentro de Corregir).

### Qué hace cada herramienta (para el usuario)

| Botón | Qué hace | Qué **no** hace |
|---|---|---|
| **Corregir** | Ortografía, tildes y errores típicos de Whisper (palabras mal oídas). Con IA si hay clave en Configuración. | No reescribe el estilo ni resume. |
| **Párrafos** *(nuevo)* | Separa el texto en párrafos cortos (saltos de línea). 100 % local, sin IA. | No cambia las palabras. |
| **Pulir** | Mejora claridad y fluidez (reescritura ligera). | No es “solo ortografía”. |
| **↩** | Vuelve al texto original de la transcripción. | — |

### Cambios técnicos

1. **Tooltips (`title` + `aria-label`)** en Corregir (mic/archivo/YouTube/modal), Pulir, deshacer y el nuevo Párrafos.  
2. **Botón `Párrafos`** en la barra primaria de cada panel y en el editor grande (desktop + toolbar móvil).  
   - Funciones: `formatearParrafosTexto`, `_partirEnOraciones`, `aplicarParrafos`.  
   - Agrupa 2–3 oraciones o ~240–340 caracteres; protege `Node.js`, `20.500`, abreviaturas.  
   - Respeta bloques que ya tienen ≥3 párrafos cortos (solo normaliza).  
   - Guarda snapshot para deshacer con ↩.  
3. **Legibilidad:** `line-height` de textareas **1.6 → 1.75** (modal 1.8).  
4. Botones en `sincronizarAccionesMic` / `ACCIONES_POR_PANEL` (se deshabilitan sin texto).

### Archivos

- `index.html` (HTML botones + CSS + JS)  
- Este documento · `Agents.md` (estado UI)

### Cómo probar

1. Transcribir o pegar un bloque largo sin saltos.  
2. Hover en **Corregir** → tooltip largo y claro.  
3. Pulsar **Párrafos** → aparecen bloques separados; toast “Texto en N párrafos”.  
4. ↩ → vuelve al original.  
5. Párrafos de nuevo sobre texto ya separado → “ya está bien separado”.

**Archivo tocado en ambas entregas:** `index.html` (CSS; sin cambios de lógica de negocio).  
**Sync/deploy:** `Spech to text App/` → `vercel_deploy/` → `npx vercel --prod --yes` desde `vercel_deploy/`.

---

## v3.2 — TTS en franja horizontal (más texto visible) · 2026-08-01

### Pedido del usuario

> En los editores («Editar en grande»), abajo aparecen Escuchar, mujer, hombre y velocidad
> y **ocultan bastante el espacio del texto**. Ubicarlos en **un solo panel horizontal**
> más abajo para que el output se vea mejor.

### Problema

La consola `.tts-console` era **columna multi-fila**:

1. Cabecera («Leer en voz alta» + badge motor)  
2. Fila Escuchar / Detener / estado  
3. Bloque Voz (etiqueta + pastillas)  
4. Bloque Velocidad (etiqueta + select)  

En el modal móvil medía **~100–180 px** de alto y dejaba el textarea en ~**367 px**.

### Solución (CSS)

- `.tts-console` → `flex-direction: row` + `flex-wrap` controlado.  
- Filas internas (`.tts-console-head`, `.tts-console-row`, `.tts-console-opts`, `.tts-field`) → **`display: contents`** para aplanar en una sola franja.  
- Etiquetas «Leer en voz alta», «Voz», «Velocidad» → **solo lectores de pantalla** (clip/sr).  
- Layout visual:  
  **`[ Escuchar ] [ Detener ] [ estado si lee ] [ Mujer ] [ Hombre ] [ 1×▾ ]`**  
- Modal (`.tts-console--modal`): sin márgenes laterales, `border-top` fino, pegada al texto.  
- Móvil (≤640px):
  - `flex-wrap: nowrap` + scroll horizontal oculto por si no cabe.
  - Badge del motor oculto.
  - Estado «Lista» oculto hasta que `data-on="1"` (está leyendo).
  - Controles ~38 px de alto.

### Dónde aplica

| Superficie | Selector / consola |
|---|---|
| Editar en grande | `#textModal` · `data-tts-console="modal"` |
| Micrófono | `details.result-listen` · `data-tts-console="mic"` |
| Archivo | `data-tts-console="file"` |
| YouTube | `data-tts-console="yt"` |
| Traducir | `data-tts-console="trans"` |

### Verificación (Playwright, viewport móvil)

| Métrica | Antes (aprox.) | Después |
|---|---|---|
| Alto consola TTS (modal) | ~103–180 px / 2–3 filas | **53 px · 1 fila** |
| Alto textarea modal | ~367 px | **~417 px** |
| Controles en una línea | No | Sí (Escuchar · Mujer · Hombre · velocidad) |

**Motor TTS sin cambio de lógica:** sigue **v2.6.3** (voces, bilingüe, API). Solo layout.  
Detalle de módulo: `CAMBIOS_TTS.md` § UI compacta 2026-08-01.

### Deploy

- Inspección: `https://vercel.com/jhoncod24s-projects/jg-turbo/CD7GVazANst7gZCovnGZRrYAq1A3`  
- Alias: https://jg-turbo.vercel.app  

---

## v3.1 — Móvil: «Más acciones» con aire · 2026-08-01

### Pedido del usuario

> En la parte inferior, botones Traducir · Pulir · Prompt · TXT · Limpiar están **muy juntos**
> en móvil; no se ve agradable.

### Problema

En ≤640px, `.jg-fold--actions .actions--more` forzaba:

- `flex-wrap: nowrap !important`  
- `gap: 6px`  
- `overflow-x: auto`  

Cinco chips en una sola fila horizontal apretada (scroll lateral disimulado).

### Solución (CSS, solo ≤640px)

- Rejilla **2 columnas**, `gap: 10px`, botones **min-height: 48px**.  
- Distribución:  
  `[Traducir] [Pulir]`  
  `[Prompt]   [.txt]`  
  `[     Limpiar     ]` ← `grid-column: 1 / -1` (`.btn.ghost`)  
- Más padding en `.jg-fold-body` y bordes 12–14px.  
- Sin scroll horizontal en esa zona.  
- Escritorio **sin cambio** (`display: contents` en `.resultbar` ≥641px).

### Dónde aplica

Micrófono, Archivo y YouTube: `.resultbar` + `.jg-fold--actions` + `.actions--more`.

### Verificación (Playwright móvil, fold abierto)

| Control | Ancho × alto | Notas |
|---|---|---|
| Traducir / Pulir | ~137×48 | fila 1 |
| Prompt / .txt | ~137×48 | fila 2 |
| Limpiar | ~284×48 | fila completa |
| `gap` | 10px | grid |

### Deploy

- Inspección: `https://vercel.com/jhoncod24s-projects/jg-turbo/H3wGeFciRqyyYRMnPwgE974X55yy`  
- Alias: https://jg-turbo.vercel.app  

---

## Qué se pidió (contexto v3 original)

> «No me siento convencido con el diseño ni con la experiencia. Todo está muy junto,
> muy arrumado. Hay que hacer mucho scroll hacia abajo, arriba y a los lados. El botón
> de copiar es una cosa larguísima. Y quiero que todas las opciones funcionen: que Pulir
> realmente pula, que el Prompt sea un buen prompt, que la Corrección corrija, y que
> tome mucho mejor el audio.»

Se trabajó en tres frentes: **layout**, **calidad de las funciones de IA** y **calidad
del audio**. Dos auditorías previas (UX y funcional) produjeron el inventario de causas;
este documento registra lo que se implementó y **cómo se verificó**.

---

## 1. Diseño y navegación

### La causa real del «todo arrumado»

No era falta de espaciado: era **reparto de espacio**. En el panel Micrófono a 1366×768,
el andamiaje (encabezado, controles, cajas informativas, dos filas de botones) ocupaba el
**62 % de la tarjeta** y el resultado —lo único que el usuario viene a buscar— el **20 %**.
El textarea quedaba con ~104 px visibles, unas 4,6 líneas. Al detener una grabación
aparecía el reproductor (126 px más) y el texto recién dictado quedaba **con 0 px visibles**:
había que hacer scroll dentro de un scroll para leerlo.

A eso se sumaban **7 contenedores con `overflow-x:auto`**, es decir, scroll lateral
deliberado: barras de botones que se desplazaban a los lados escondiendo acciones sin avisar.

### Principios aplicados

1. **El texto manda.** El resultado se lleva el alto que sobra; todo lo demás tiene
   presupuesto fijo y corto.
2. **Un solo scroll por pantalla y ninguno horizontal.** Si una barra no cabe, envuelve.
3. **Una sola barra de acciones**, siempre visible, sin desplegables anidados en escritorio.

Todo el rediseño vive en un bloque comentado al final del CSS (`UX v3 — El texto manda`),
lo que permite leerlo y revertirlo como una unidad sin tocar las ~1.900 líneas anteriores.

### Cambios concretos

| Cambio | Efecto |
|---|---|
| `.btn{flex:0 0 auto}` y `.btn.primary{min-width:112px}` | «Copiar» pasó de **~756 px a 116 px** |
| Nuevo contenedor `.resultbar` en los 4 paneles | Acciones primarias y secundarias en **una sola fila** en escritorio (`display:contents`); en móvil se mantienen «Copiar/Corregir» a mano y el resto en «Más acciones» |
| `overflow-x:clip` + `flex-wrap:wrap` en barras y áreas | **Cero scroll lateral** |
| `.result-promise` eliminada | −124 px de caja punteada que solo prometía «aquí aparecerá el resultado» |
| Reproductor de la grabación como barra fina | −78 px, y deja de empujar el texto justo cuando se quiere leer |
| Encabezado compacto (logo 38 px, sin subtítulo ni badge) | −50 px |
| Botón de grabar 84→62 px, onda 44→30 px, sin la pista de teclado | −45 px |
| `.result-head` y `.result-listen` compactadas | −45 px |
| `--h-header` medido por JS con `ResizeObserver` | La barra de pestañas ya no se monta sobre el encabezado (antes tenía un `top:52px` fijo que no correspondía al alto real) |
| Una sola tipografía para el texto en los 5 campos (Figtree 15 px/1.6) | Antes la transcripción se veía en monoespaciada en 3 paneles y en otra fuente y tamaño en Traducir |
| Alto de ventana: `.wrap` en `100dvh` con scroll interno (≥641 px) | La página **cabe entera**, sin scroll de documento |

En móvil se mantiene deliberadamente el scroll de documento: forzar un alto fijo rompe
cuando aparece el teclado virtual. Lo que se hizo allí fue recortar andamiaje y volver
la barra de acciones `sticky` al fondo.

### Editor grande

Las acciones (Copiar, Corregir, deshacer, Pulir, Prompt) pasaron de repartirse en tres
filas con huecos a **una sola fila**, con Copiar primero. Se corrigió el desbordamiento de
la etiqueta del motor de voz, que se salía de la tarjeta en pantallas de 390 px.

### Accesibilidad

- Los **6 interruptores de opciones eran `<div>`**: sin `role`, sin `tabindex`, inalcanzables
  con teclado. Ahora son `<button role="switch" aria-checked>` navegables con Tab y
  activables con Enter, con el estado anunciado.
- `.result-hint` pasó de `display:none` a `.sr-only`: el textarea la referencia con
  `aria-describedby` y con `display:none` los lectores de pantalla ya no la leían.
- Los globos de ayuda de los interruptores se recortaban por el `overflow:hidden` del
  desplegable. Corregido.
- En móvil, **ningún control por debajo de 44 px**.
- `transition:.15s` (equivalente a `transition:all`, que anima el layout) sustituida por
  transiciones explícitas de color, borde, sombra y transform.

---

## 2. Bugs que dañaban el trabajo del usuario

### 2.1 La app corrompía las transcripciones · `index.html`, `procesarFragmento()`

Los interruptores «Puntuación por voz» y «Modo código» convierten palabras dictadas en
símbolos («punto» → `.`). Se aplicaban **también al texto de Whisper**, que ya viene
puntuado. Resultado en cada dictado que contuviera esas palabras:

- *«el punto de venta»* → *«el . de venta»*
- *«coma bien»* → *«, bien»*
- *«lo puse entre comillas»* → *«lo puse entre "»*

**Fix:** las reglas ahora solo actúan sobre el dictado en vivo del navegador
(`if(!desdeWhisper && opt.punt)`), que es para lo que sirven.

### 2.2 El dictado en vivo por bloques nunca funcionó más de una vez

`enviarChunkWhisper()` conservaba solo los últimos 2 fragmentos
(`chunkingChunks.slice(-2)`), descartando el primero — el único que lleva la cabecera del
contenedor WebM. Del segundo envío en adelante enviaba **archivos indecodificables**, y el
error se tragaba en un `console.warn`. **Fix:** la cabecera se guarda en `chunkingCabecera`
y se antepone a cada envío.

### 2.3 «Autocorrección» no se aplicaba a la ruta principal

El interruptor solo actuaba sobre el dictado en vivo (`opt.auto && !desdeWhisper`), nunca
sobre el texto de Whisper. **Fix:** ahora se aplica en ambas rutas (los reemplazos son
idempotentes).

### 2.4 Los botones de IA quedaban apagados para siempre · regresión introducida y corregida

Al añadir el apagado de botones sin texto, la sincronización dependía de que **cada punto
del código avisara** al cambiar el texto. En Archivo y YouTube el texto se asigna desde
muchos sitios (transcribir, corregir, pulir, traducir, importar, editor grande) y bastaba
con que uno no avisara para dejar los botones bloqueados de forma permanente: el usuario
hacía clic y no pasaba nada.

**Fix:** además de los avisos puntuales, un repaso cada 500 ms lee el textarea real y ajusta
el estado. Barato y hace imposible ese estado, venga el texto por donde venga.

### 2.5 Etiquetas que no decían la verdad

| Decía | Realidad | Ahora |
|---|---|---|
| «A mayor bitrate, Whisper recibe más detalle de voz» | Opus mono de voz es transparente a ~48 kbps; subir a 128 no cambia la precisión | Explica que afecta al peso, no a la precisión, y describe el acondicionamiento real |
| «Sensibilidad del micrófono» | Solo cambia la altura de las barras del visualizador | «Sensibilidad del medidor de voz», con nota explícita |
| «Aplicar la skill maestro-prompts… técnicas 2025-2026» | No existía ninguna skill ni auditoría | Describe lo que realmente hace |
| Badge «IA (Claude)» con cualquier proveedor | Solo distinguía Gemini y Mistral | `nombreProveedorIA()` cubre Gemini, Mistral, Claude, Grok y OpenRouter (con modelo) |

---

## 3. Calidad del audio

Whisper trabaja internamente a **16 kHz mono**. Se le enviaba Opus comprimido, con
silencios largos y sin nivelar. Los silencios son el disparador principal de las frases
inventadas («gracias por ver el video», «subtítulos por Amara.org»); el filtro
anti-alucinación existía, pero es mejor no generarlas.

**`acondicionarAudioParaWhisper()`** (`index.html`) hace, antes de subir, lo que haría un
editor de audio:

1. Decodifica y remuestrea a **16 kHz mono** con `OfflineAudioContext`.
2. Estima el piso de ruido con el **percentil 20** de ventanas RMS de 20 ms —así el umbral
   se adapta a un cuarto silencioso o a una calle— y **recorta el silencio** inicial y final
   dejando 150 ms de aire para no comerse la primera consonante.
3. **Normaliza** el pico a −1 dBFS con tope de ganancia ×8, para no amplificar el ruido de
   una grabación casi muda.
4. Serializa a **WAV PCM 16 bits**, sin pérdida.

Si algo falla —formato raro, audio sin voz clara, más de 15 min o más de 20 MB— **se envía
la grabación original**: nunca se pierde audio. El nombre del archivo se ajusta a `.wav`
cuando corresponde.

**Medido** con una grabación sintética de 1,5 s de silencio + 2 s de voz floja + 1,5 s de
silencio: **5 s → 2,3 s**, ganancia ×8, y **468 KB → 72 KB (−85 %)**, lo que además aleja
del límite de 25 MB de Groq.

### Prompt de transcripción

El campo `prompt` de Whisper **no es una instrucción**: es texto previo simulado del que el
modelo imita estilo y vocabulario. Se enviaba *«Transcripción literal y precisa en
español…»* (sin efecto, gastando presupuesto de 224 tokens) y, con glosario, se añadía
**`"Preferred spellings:"` — una frase en inglés dentro de un contexto en español**, lo que
empuja al modelo hacia el inglés.

`construir_prompt_asr()` se reescribió: el vocabulario del usuario va **primero** y la
etiqueta va **en el idioma del audio** («Términos frecuentes:» en español).

### Temperatura en Groq

Se enviaba `temperature: "0"` fijo, lo que **anula el reintento automático** de Whisper
cuando un segmento falla los umbrales de compresión/logprob. Se verificó en la
documentación de Groq que su API de audio espera **un número**, no la cadena de reintentos
de OpenAI (`"0, 0.2, 0.4…"`). Solución: **omitir el parámetro** para que Groq aplique su
comportamiento por defecto, que sí reintenta.

---

## 4. Las funciones de IA

Base común nueva en `api/index.py`: `_dividir_en_bloques()`, `_procesar_por_bloques()`,
`_aviso_por_integridad()` y `validar_texto_transformado()` en `calidad_linguistica.py`.

### 4.1 Truncado silencioso — el fallo más grave

Ni `/improve` ni `/correct-transcription` limitaban longitud ni dividían el texto. Con
Mistral o xAI el corte llegaba a los 4096 tokens, y **el botón «Usar esta versión»
reemplazaba el texto completo del usuario por el truncado**: pérdida de datos.

Ahora: `max_tokens` explícito y proporcional a la entrada en todos los proveedores,
**troceado por párrafos con reensamblado**, y validación de integridad que compara cifras,
URLs, emails, términos técnicos, estructura y ratio de longitud. Si detecta pérdida, la
respuesta incluye el campo **`aviso`**, que la interfaz muestra antes de que el usuario
acepte reemplazar su original.

### 4.2 Pulir

Prompt reescrito como editor de textos hablados: conserva hechos, cifras, nombres, URLs y
formalidad; elimina muletillas sin resumir; corrige errores fonéticos del ASR solo cuando
son claros; **devuelve el texto completo** con prohibición explícita de cortar o escribir
«[continúa]». Recibe además el **glosario del usuario**.

También se corrigió `_mejorar_heuristico()` —el camino por defecto de quien no tiene clave
de IA—, cuyo regex `este+` con `\b` **borraba el demostrativo «este»**: *«Este documento es
clave»* → *«. documento es clave»*. La muletilla real es el alargamiento («esteee»).

### 4.3 Prompt

Era el más flojo: toda su guía era «hazlo claro, con rol, tarea y formato de salida», y la
modalidad detectada (texto/imagen/video) se interpolaba como una palabra suelta sin
enseñarle al modelo ningún formato. La plantilla sin IA solo envolvía el texto en cinco
líneas de relleno.

Ahora hay **tres plantillas reales por modalidad**
(`_plantilla_ingenieria_prompt()` y `_plantilla_local_por_modalidad()`): LLM (rol, tarea,
contexto, criterios verificables, restricciones, formato de salida y qué hacer si falta
información), imagen (sujeto → acción → entorno → estilo → iluminación → composición, con
los parámetros del destino) y video (toma, movimiento de cámara, sujeto, ambiente,
duración, iluminación).

### 4.4 Corregir

Se le decía «corrige confusiones típicas de Whisper» **sin decirle cuáles**. Ahora recibe
el glosario, la variante regional (es-CO ≠ es-ES) y ejemplos explícitos de confusiones del
español: haya/halla/aya, hecho/echo, a ver/haber, sino/si no, porque/porqué/por qué,
ahí/hay/ay, valla/vaya/baya, tubo/tuvo.

El respaldo con LanguageTool aplicaba **siempre la primera sugerencia a ciegas**, incluidas
reglas de estilo discutibles; ahora filtra por categoría y descarta las de baja confianza.

### 4.5 Traducir

Su prompt ya era el mejor de los cuatro y **no se tocó**. Lo que faltaba: no pasaba por
`_limpiar_respuesta_ia()`, así que un preámbulo del modelo («Here is the translation:»)
quedaba en el texto final. Corregido.

### 4.6 Higiene y proveedores

- El limpiador de preámbulos solo cubría 4 variantes; se amplió con las reales de Gemini
  y se añadió limpieza de **postámbulos** («Espero que te sirva», «¿Quieres que…?»).
- **Anthropic** aparecía en el selector pero el servidor lanzaba una excepción con claves
  `sk-ant`. Implementado de verdad: `_call_anthropic()` contra `/v1/messages` con
  `x-api-key` y `anthropic-version`.
- `needs_review` («⚠️ Audio poco claro») se disparaba con casi cualquier audio porque
  **un segmento vacío contaba como alucinación**. Ajustado para que la advertencia signifique
  algo y el usuario no aprenda a ignorarla.

---

## Verificación realizada

Automatizada con Playwright (Chromium) a **1366×768** y **390×844**, contra el local
limpio y contra producción:

| Comprobación | Resultado |
|---|---|
| Scroll horizontal, 4 pestañas × 2 tamaños | **ninguno** |
| Alto de página vs. viewport | 768/768 y 844/844 → **sin scroll de documento** |
| Ancho del botón Copiar | **116 px** (antes ~756) |
| Alto del textarea | **304 px** escritorio · **338 px** móvil (antes 104) |
| Acciones del resultado | 8 botones en **1 fila** en escritorio |
| Botones apagados sin texto / encendidos con texto | 7/7 y 7/7 |
| Interruptores con teclado (Tab + Enter) | cambian `aria-checked` |
| Foco visible por teclado | sí |
| Objetivos táctiles < 44 px en móvil | **ninguno** |
| Flechas del teclado en pestañas | navegan |
| Errores de consola | ninguno |
| Acondicionamiento de audio | 5 s → 2,3 s · ganancia ×8 · −85 % de peso |
| `/api/improve`, `/api/correct-transcription`, `/api/improve-prompt` en producción | 200 · `ia_used:true` · proveedor `mistral` |
| `node --check` del JS embebido | OK |
| `python -m py_compile` de los 4 módulos | OK |

**No verificado** (requiere intervención humana): una grabación real con voz en un ambiente
con ruido, y Pulir/Corregir con un texto de más de 3.000 palabras para ver el troceado y el
aviso de integridad en condiciones reales.

---

## Archivos modificados

| Archivo | Qué cambió |
|---|---|
| `index.html` | Rediseño v3, acondicionamiento de audio, bugs 2.1–2.5, accesibilidad, etiquetas honestas |
| `api/index.py` | Prompts de Pulir/Corregir/Prompt, troceado, validación de integridad, Anthropic, temperatura Groq |
| `api/calidad_linguistica.py` | `construir_prompt_asr()`, `validar_texto_transformado()`, `needs_review` |
| `backend/calidad_linguistica.py` | Sincronizado con el de `api/` |
| `backend/app.py` | Ajustes equivalentes en el backend local |
| `sw.js` | `CACHE_SHELL` a `jg-turbo-shell-v4` — **imprescindible**: sin esto, quien tenga la PWA instalada seguiría viendo la versión anterior en caché |
| `CAMBIOS_UX.md` | Este documento |

## Qué no se tocó

- Claves `jg_*` de `localStorage` (la configuración del usuario sobrevive al despliegue).
- IDs de botones, paneles y nombres de campos JSON de la API: los campos nuevos
  (`aviso`, `validation`, `chunks`) son **aditivos**.
- Identidad visual: paleta naranja/fucsia con cian, logo, y los cuatro flujos.
- Motor TTS (v2.6.3), fuera del alcance de este pase.

## Despliegue

- Proyecto `jg-turbo` · equipo `jhoncod24s-projects` · destino **production**, estado `Ready`.
- Publicado desde `vercel_deploy/` con `npx vercel --prod --yes` (**nunca** desde la raíz
  del monorepo).
- `/api/health` en vivo: `ok` · `whisper-large-v3` · modelo listo · Groq e IA configurados.
- Alias público: <https://jg-turbo.vercel.app>.

## Siguientes mejoras, priorizadas

1. **Probar el recorte de silencios con voz real en ambiente ruidoso.** Si corta inicios de
   frase, el margen de 150 ms es el valor a subir (`_audioLimitesDeVoz`).
2. **Resaltar en el editor los tramos de baja confianza** que Whisper ya reporta por
   segmento: hoy esa información se resume en un aviso y se desperdicia.
3. **Reducir las cinco copias de la consola de voz** (~175 líneas de HTML repetido) a una
   sola compartida: menos peso y una sola cosa que mantener.
4. **Historial local opcional** de las últimas transcripciones, con control explícito para
   activarlo o desactivarlo.
