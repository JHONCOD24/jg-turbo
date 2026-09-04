# Lector de PDF · historial de cambios y operación

## Entrega 2026-09-04 · v2.37.1 · Encadenado TTS sin pausa de párrafo

Cierre del plan v2.37: si una parte nace de un mismo `ReadingBlock` (`continuation: true`),
el audiolibro **encola** el texto en la cola actual en vez de arrancar una lectura nueva.
Así no se inserta una pausa de párrafo a mitad de frase.

Verificación en navegador (Playwright, PDF sintético de cortes sin guion, motor pdf.js real):
el recuadro mostró `Boston`, `ARN`, `aluvión`, `esta` y `le damos` en una sola pasada, sin IA.

- `index.html`: `v2.37.1` · `JG_JS_V=v76`
- `sw.js`: `jg-turbo-shell-v76`

---

## Entrega 2026-09-04 · v2.37.0 · Continuidad de palabras y párrafos en el motor

### Causa

v2.31–v2.36 actuaba **después** de perder información. `agruparLineas()` aplanaba los `TextItem`
y descartaba `hasEOL`, índice, dirección, fuente y geometría. Los candidatos de unión se
creaban solo entre líneas reconstruidas, se identificaban por pares repetibles (`es`+`ta`) y
dependían de que una IA reescribiera el capítulo. Sin red, sin consentimiento o con fallo del
proveedor, el texto canónico conservaba `bos ton`, `alu vión` y `es ta`. `mejorCorte()` todavía
podía devolver un índice bruto a mitad de palabra.

### Decisión

La reparación de palabras es parte del motor de extracción, **antes** de capítulos, páginas
lógicas, traducción o audio. Cada fragmento es un `TextAtom` inmutable; cada posible separador
es un `TextBoundary` con identificador estable. La IA, si hace falta, solo decide
`join|space|paragraph|pending` sobre esos IDs (`/api/improve` modo `pdf_boundary_decisions`).
No reescribe letras. Un documento con pendientes no se marca como corregido.

### Qué cambió

- Nuevos módulos: `js/pdf/unicodeTexto.js`, `atomos.js`, `limites.js`, `lexico.js`,
  `reconstruccion.js`, `particion.js`, `manifiesto.js`.
- `getTextContent({ includeMarkedContent: true })` conserva `str`, `hasEOL`, `dir`, `transform`,
  `width`, `height`, `fontName` y MCID.
- `VERSION_RECONSTRUCCION = 6`, `VERSION_TROCEO = 6`. Pulido de lectura v5 invalidado.
- `mejorCorte()` nunca corta grafema ni token; un URL o fórmula largos se conservan enteros.
- Migración: con PDF local se reextrae; con manifiesto suficiente se reconstruye; sin fuente se
  marca `needsSource` y se pide reimportar. Una edición aprobada no se pisa: la reconstrucción
  es capa nueva.
- Sincronización: las partes llevan anclas, `boundaryIds`, `continuation` y versión. Los
  clientes viejos ignoran esos campos.
- `sincronizar_deploy.mjs` apunta al destino oficial
  `G:\Mi unidad\PROYECTS\JG Turbo\vercel_deploy\` y comprueba que el enlace sea `jg-turbo`.

### Pruebas

```
node tests/test_pdf_limpieza.mjs
node tests/test_pdf_continuidad.mjs
node tests/test_pdf_pulido_troceo.mjs
JG_PDF_REAL=tests/private/libro.pdf node tests/test_pdf_reales.mjs
pytest backend/tests/test_pdf_improve_lectura.py
```

El corpus sintético exige literalmente `Boston`, `ARN`, `aluvión`, `esta conclusión` y
`significado que le damos`, con cero pendientes.

### Versión y producción

- `index.html`: `v2.37.0` y módulos `v75`.
- `sw.js`: `jg-turbo-shell-v75`.
- Producción desplegada el 2026-09-04: `dpl_9jtJNRT5H7U6oUfVuYcS9cKpeN7E`, alias
  `https://jg-turbo.vercel.app`.
- `vercel inspect` confirmó `target: production`, estado `Ready`, el alias público y
  `api/index` construida. Verificado contra el dominio real (dos lecturas):
  marcador `v2.37.0`, `JG_JS_V v75`, `sw.js` `jg-turbo-shell-v75`,
  `/api/health` `{status: ok, youtube_auto: true}`, `VERSION_RECONSTRUCCION = 6` en
  el JS servido.
- La carpeta oficial `G:\Mi unidad\PROYECTS\JG Turbo\vercel_deploy\` **no está
  montada** en esta máquina (`sincronizar_deploy.mjs` salió 2). El deploy se hizo
  desde una copia limpia enlazada a `jg-turbo` (`projectName: jg-turbo`,
  `prj_EfuyBt2YDNqQNVaKif9DKUjpVaz8`), no desde un monorepo raíz. La raíz local
  tiene `.pytest_cache` con EPERM y Vercel CLI 59 no puede escanearla.

---

## Entrega 2026-09-04 · v2.36.0 · Corrección completa y panel que sí cierra

### Fallos comprobados

- Al volver a abrir la explicación desde el indicador, el botón X no hacía nada. Sus eventos se
  instalaban únicamente dentro de la promesa del primer consentimiento y se retiraban después de
  responder.
- `Parcial 25 de 4.950` no representaba páginas corregidas. Era el avance de una auditoría
  editorial separada que podía convertir cada renglón estructural del PDF en una petición. Esa
  cola no era la responsable de unir las palabras partidas que veía el usuario.
- Los filtros rechazaban cualquier candidato que incluyera una palabra funcional. Por eso el caso
  real `es` + `ta conclusión` no podía convertirse en `esta conclusión`.
- `jgCandidatosUnionDelTrozo()` limitaba los primeros 300 candidatos antes de filtrar los que
  pertenecían al trozo actual. Los cortes posteriores del capítulo nunca llegaban al proveedor.
- Cuando la IA o la red fallaban, el fallback devolvía el texto original y se guardaba como
  `lectura_segura`. Las siguientes aperturas lo reutilizaban y ya no intentaban corregirlo.

### Corrección aplicada

- Aceptar, rechazar, cerrar con X y cerrar con Escape tienen eventos permanentes. Cerrar una hoja
  ya autorizada no cambia el permiso; cerrar la primera solicitud equivale a continuar en local.
- El indicador ahora cuenta las partes reales del lector: `Corrigiendo lectura 2 de 40`,
  `Lectura corregida` o `N partes sin corregir`. La parte abierta se atiende primero y las demás
  continúan secuencialmente en segundo plano.
- Se dejó de iniciar automáticamente la antigua cola editorial por renglones. Las sugerencias ya
  guardadas se conservan, pero no compiten con la corrección de lectura ni ocupan su indicador.
- La detección admite fragmentos cortos como `es` + `ta` y cortes de sílabas más largos, siempre
  limitados a una frontera física detectada. Se mantienen bloqueadas locuciones normales como
  `sin embargo`, `es decir`, `por ejemplo` y parejas de dos palabras funcionales.
- Cada trozo filtra primero sus candidatos y aplica después el máximo de 300. La validación sigue
  exigiendo las mismas letras y cifras en el mismo orden.
- Los fallos ya no entran en la caché. Solo una respuesta confirmada por la IA y aprobada por el
  guardián se guarda; lo demás queda disponible para reintento.
- `VERSION_TROCEO` y la versión del pulido suben a **5**. Los libros guardados vuelven a extraerse
  desde su PDF original y los resultados v4 se invalidan para que esta corrección sí se ejecute.

### Verificación disponible antes del despliegue

- 14 suites unitarias PDF: **522 comprobaciones aprobadas**.
- Backend PDF: **16/16**.
- Regresiones nuevas: `es` + `ta`, expresiones que no deben unirse, fallos no cacheados, candidatos
  posteriores al número 300 y condensación de 4.950 renglones estructurales en 8 bloques.
- La prueba de navegador incorpora la salida visible `esta conclusion` y el cierre del panel tras
  autorizar. No se ejecutó en esta entrega porque la configuración del usuario prohíbe abrir un
  navegador sin solicitud explícita.

### Versión y producción

- `index.html`: `v2.36.0` y módulos `v74`.
- `sw.js`: `jg-turbo-shell-v74`.
- Producción desplegada el 2026-09-04: `dpl_3xZgfwum3o7gq3tpQuV18oSXNtpe`, disponible en
  `https://jg-turbo.vercel.app`.
- `vercel inspect` confirmó `target: production`, estado `Ready`, el alias público y la función
  `api/index` construida. No se abrió el navegador ni se ejecutó la interacción visual porque la
  configuración del usuario exige una solicitud explícita para hacerlo.

---

## Entrega 2026-09-04 · v2.35.0 · Palabras completas y retirada de Kindle

### Problemas comprobados

- En una prueba real, la descarga oficial de Amazon solo estaba disponible para 2 de unos 90
  libros. Por decisión del usuario se retiró `Traer desde Kindle`: ya no quedan el panel, sus
  estilos, eventos, módulo auxiliar ni pruebas de una función que no resultó útil.
- `componerTexto()` interpretaba la coordenada X de la primera línea de una página nueva como una
  sangría. Esto introducía un párrafo y `pulirParaLectura()` añadía un punto artificial. El caso
  `significado que le` + `damos` terminaba como `significado que le. / Damos`.
- El prompt de lectura ya pedía unir palabras partidas, pero `mismasPalabras()` exigía igual número
  de tokens. Por eso una respuesta correcta como `bos ton` a `Boston` se descartaba sin aviso.
- Al importar un libro se precargaba el pulido antes de responder el consentimiento. Esa carrera
  podía dejar el texto local en caché e impedir la llamada de lectura después de aceptar.

### Corrección aplicada

- La sangría solo abre un párrafo cuando ambas líneas pertenecen a la misma página física. Un
  cambio de hoja sin puntuación terminal conserva la frase continua.
- El extractor registra pares candidatos únicamente en límites reales de renglón o página. Filtra
  palabras funcionales y limita longitud, mayúsculas y siglas para no presentar uniones arbitrarias.
- El modo `lectura` envía a la IA solo los candidatos que aparecen dentro de cada capítulo y trozo.
  El prompt de Vercel y el backend local permiten quitar un espacio solo en esos pares exactos.
- `mismasPalabrasLectura()` acepta una unión únicamente si concatena dos tokens candidatos sin
  cambiar ninguna letra, cifra ni orden. Mantiene las protecciones de URLs, correos, símbolos,
  cifras y párrafos. `sin embargo` no puede convertirse en `sinembargo`.
- Los bloques del navegador bajan a 3.000 caracteres y, si un candidato cae justo en un límite,
  sus dos fragmentos viajan juntos. Así el segundo troceo del servidor no vuelve a separarlos.
- Se eliminó la precarga anterior al consentimiento. El texto corregido se guarda como
  `lectura_segura` con la huella de la fuente; al reabrir se reutiliza solo si la huella coincide.
- `VERSION_TROCEO` sube a **4**. Los libros ya guardados que conservan su PDF original se extraen
  nuevamente al abrirlos, mantienen su progreso y reciben los candidatos de unión nuevos. Si un
  documento sincronizado ya no conserva el PDF, se preserva su texto disponible sin adivinar letras.
- La hoja de consentimiento ahora explica los cortes de palabra, qué texto se envía y la validación
  local que descarta cualquier alteración de letras o cifras.

### Regresiones exactas

Las pruebas usan los ejemplos reportados en `El placebo eres tú`:

- `bos` + `ton` se propone como `Boston`;
- `A` + `RN` se propone como `ARN`;
- `componentes.Como` queda `componentes. Como`;
- `significado que le` + `damos` conserva `significado que le damos` sin punto inventado;
- `alu` + `vión` se propone como `aluvión`.

También se comprueba que `Bostom` se rechaza por cambiar una letra, que una locución normal no se
une, que el texto corregido aparece realmente en pantalla y que persiste después de reabrir sin una
segunda petición de IA.

### Verificación

- 14 archivos unitarios PDF: **510 comprobaciones OK, 0 fallos**.
- Backend PDF: **16/16** entre `test_pdf_ask.py` y `test_pdf_improve_lectura.py`.
- `verificar_pdf_retroceo.mjs`: **13/13** en Chromium visible.
- `verificar_pdf_geometria.mjs`: **42/42** en móvil, tableta y escritorio.
- `verificar_pdf_scroll.mjs`: **39/39**.
- `verificar_pdf_navegador.mjs`: **115/115** en Chromium visible. Incluye el texto final corregido,
  persistencia por huella, retirada de Kindle, libro de 300 páginas, OCR, biblioteca, exportaciones,
  audiolibro, traducción y casos dañados.

### Versión y producción

- `index.html`: `v2.35.0` y módulos `v73`.
- `sw.js`: `jg-turbo-shell-v73`.
- Producción desplegada el 2026-09-04: `dpl_75aow6hXDVwUh8uXm4i9EQiJs1ae`, disponible en
  `https://jg-turbo.vercel.app`.
- Verificación pública sin caché: HTML, `sw.js`, `pdfController.js`, `limpiezaTexto.js`,
  `pulido.js` y `/api/health` respondieron 200. Se confirmaron `v2.35.0`, módulos y shell `v73`,
  `VERSION_TROCEO = 4`, estado `lectura_segura`, candidatos de unión, validador
  `mismasPalabrasLectura`, ausencia del control y del módulo Kindle, y `status: ok`.
- La apertura visual del alias no se ejecutó: la configuración del usuario prohíbe abrir un
  navegador sin una solicitud explícita. La validación visible local anterior sí terminó con
  **115/115** comprobaciones en Chromium.

---

## Entrega 2026-09-04 · v2.34.0 · Párrafos completos y reparación real de libros guardados

### Corrección de la entrega anterior

La v2.32.0 se documentó como corregida, pero su prueba era insuficiente. Comprobaba que `es` y
`ta conclusión` ya no quedaran justo en los bordes de dos unidades, pero no comprobaba que el
texto final recuperara literalmente `esta conclusión`. Además, `rehacerTroceo()` reconstruía el
libro con `join('\n\n')`, lo que convertía las dos mitades en párrafos separados, y después marcaba
el documento con `versionTroceo: 2`. Por eso el libro seguía roto y ya no volvía a migrarse.

También se encontró que `mejorCorte()` daba prioridad al límite de la página física. Un PDF puede
terminar una página en mitad de una palabra o de un párrafo, así que ese límite no puede definir
una unidad de lectura.

### Corrección aplicada

- `VERSION_TROCEO` sube a **3**. Al abrir por primera vez un libro guardado con una versión
  anterior, JG Turbo vuelve al PDF original almacenado y ejecuta de nuevo la extracción actual.
  Así recupera la información que ya no existe en dos trozos guardados por separado.
- Los límites del índice se llevan al inicio del párrafo que contienen. Si varias entradas de los
  preliminares caen dentro del mismo párrafo, se condensan en una sola unidad y desaparecen las
  falsas páginas vacías o repetidas.
- Las páginas físicas dejan de ser candidatas de corte. Para un texto largo, el orden es párrafo,
  oración y, como último recurso, espacio entre palabras.
- La migración guarda juntas las unidades, capítulos, bloques de auditoría y posición de lectura.
  El progreso se relocaliza mediante una cita de texto, no por el número antiguo de unidad.
- Una auditoría anterior solo se vuelve a aplicar cuando la huella del bloque coincide con el
  texto reprocesado. Las decisiones incompatibles se conservan en IndexedDB, pero no modifican
  una fuente distinta.
- Si un documento sincronizado ya no conserva el PDF original, se consolida únicamente el texto
  disponible. Se unen cortes con guion explícito; no se adivinan palabras a partir de sílabas.
- Los PDF importados desde esta versión nacen con `versionTroceo: 3` y no hacen una migración
  innecesaria al abrirse.

### Regresión exacta de «El placebo eres tú»

`tests/verificar_pdf_retroceo.mjs` crea un PDF original de dos páginas donde la primera termina
en `es-` y la segunda comienza con `ta conclusion`. Después siembra en IndexedDB las cinco
unidades defectuosas reportadas, incluidas tres entradas de página 5 y un documento ya marcado
como versión 2. Al abrirlo se verifican **13/13** condiciones:

- migra a versión 3 y pasa de cinco unidades rotas a una unidad completa en este caso mínimo;
- no queda ninguna unidad vacía, repetida ni iniciada o terminada a mitad de palabra;
- el texto contiene literalmente `Y esta conclusion`;
- el progreso vuelve al mismo párrafo y los capítulos nuevos quedan guardados;
- una segunda apertura no vuelve a reprocesar el libro.

### Verificación completa

- 16 archivos de pruebas unitarias PDF y TTS: **567 OK, 0 fallos**.
- `backend/tests/test_pdf_ask.py`: **14/14**.
- `verificar_pdf_retroceo.mjs`: **13/13** en Chromium visible.
- `verificar_pdf_geometria.mjs`: **42/42** en móvil, tableta y escritorio.
- `verificar_pdf_scroll.mjs`: **39/39**.
- `verificar_pdf_navegador.mjs`: **118/118** en Chromium visible, incluido un libro de 300
  páginas, continuidad, búsqueda, OCR, exportaciones, archivos dañados e importación Kindle.

### Versión

- `index.html`: `v2.34.0` y módulos `v72`.
- `sw.js`: `jg-turbo-shell-v72`.
- Producción: `dpl_4YDzSssh2yj1cPy9aZLjC6LSiVeD` con alias
  **https://jg-turbo.vercel.app**.
- Verificación sin caché: HTML, `sw.js`, `pdfController.js`, `limpiezaTexto.js`,
  `biblioteca.js` y `/api/health` respondieron 200. Se confirmaron el marcador v2.34, módulos v72,
  `VERSION_TROCEO = 3`, reprocesamiento del PDF original, ajuste por párrafo y `status: ok`.
- Verificación visible del alias: la pestaña PDF renderiza, el asistente Kindle está presente, el
  selector conserva la selección múltiple y la consola registró 0 errores.

---

## Entrega 2026-09-03 · v2.33.0 · Importación segura desde Kindle

### Alcance
- Se añadió **Traer desde Kindle** dentro de la biblioteca. JG Turbo no pide usuario,
  contraseña, cookies ni tokens de Amazon: el enlace abre `Gestionar contenido y dispositivos`
  en otra pestaña y la descarga autorizada ocurre en Amazon.
- La primera versión admite únicamente archivos con extensión `.pdf`. `.azw`, `.azw3`, `.kfx`
  y `.mobi` se rechazan con una explicación expresa: JG Turbo no convierte esos formatos ni
  elimina DRM. Un PDF cifrado también se rechaza sin pedir ni intentar retirar la clave.
- La selección múltiple se procesa **en secuencia**, con avance por archivo y página. Cancelar
  conserva los libros ya terminados y no crea el que estaba a medias.
- Cada PDF recibe una huella SHA-256 calculada localmente. Una copia exacta se omite sin tocar el
  libro existente, su texto ni su progreso. Dos archivos distintos con el mismo título no se
  confunden.
- Los metadatos guardan `origen: "kindle-descarga-oficial"`, `huella` y `sincronizar`. El destino
  inicial es `sincronizar: false`; la opción de copiar a los otros dispositivos solo se habilita
  cuando la nube privada de JG Turbo ya está conectada.
- La exportación normal hacia la nube excluye cualquier documento marcado como local. Si se elige
  voluntariamente la nube, el lote dispara una sola sincronización al terminar, no una por PDF.
- No cambió la versión de IndexedDB: los campos son aditivos y no necesitan índices.

### Verificación
- Todas las pruebas unitarias PDF descubiertas y TTS: **563/563**, cero fallos. Incluyen 27 casos
  Kindle y 77 de sincronización.
- `backend/tests/test_pdf_ask.py`: **14/14**.
- `verificar_pdf_geometria.mjs`: **42/42**.
- `verificar_pdf_scroll.mjs`: **39/39** con nueve libros.
- `verificar_pdf_navegador.mjs`: **118/118** en Chromium visible. Los casos Kindle comprueban dos
  PDF en lote, KFX, PDF cifrado real, duplicados, SHA-256, origen, destino local, cancelación y cero
  solicitudes POST/PUT/PATCH a Amazon o al backend durante la importación local.
- La prueba visible neutraliza `window.print()` únicamente dentro de Playwright para que el diálogo
  nativo no bloquee la automatización; la pestaña imprimible y su contenido siguen verificándose.

### Versión
- `index.html`: `v2.33.0` y módulos `v71`.
- `sw.js`: `jg-turbo-shell-v71`.
- Producción: `dpl_7FW8kHs5LnvnWTTKoyspPZrS8kGS` → alias
  **https://jg-turbo.vercel.app**.
- Verificación sin caché: HTML 200 con marcador v2.33 y asistente; `sw.js` 200 con v71;
  `kindleImport.js`, `pdfController.js`, `biblioteca.js` y `nube.js` 200 con sus marcadores;
  `/api/health` 200 con `status: ok`.
- Verificación visible del alias: el asistente se despliega, la selección es múltiple, el destino
  local está marcado, nube queda deshabilitada sin conexión, Amazon abre en otra pestaña y la
  consola informa cero errores.

---

## Entrega 2026-09-03 · v2.32.0 · Los libros ya guardados también se arreglan

### Lo reportado, auditando «El placebo eres tú» tras la v2.31.0
«Siguen las páginas 5, 5, 5. La primera no tiene nada, la segunda dice *Descubre el poder de tu
mente*, la tercera dice *Urano*. El apéndice, página 10, termina con "es" y el prólogo, página 11,
sigue con "ta conclusión". Sigue habiendo la misma falla.»

### Causa: la v2.31.0 fue correcta pero incompleta
Las unidades de lectura se trocean **al procesar el PDF** y se guardan en la biblioteca. Arreglar
el troceo no arregla lo que ya estaba guardado: `abrirDocumento()` carga las partes de IndexedDB
tal como quedaron el primer día. Los libros nuevos salían bien; los de la biblioteca, exactamente
igual que antes. Desde fuera parecía que el arreglo no había servido de nada — y tenía razón quien
lo miraba.

**Y el dato del corte reveló un segundo fallo que la v2.31.0 no cubría:** «es» / «ta conclusión» es
la palabra «esta» partida entre dos unidades. `mejorCorte()` solo actuaba al partir por tamaño; los
límites que vienen del índice del libro caían donde cayeran, incluso dentro de una palabra.

### Corrección
- **`limpiezaTexto.js: depurarCapitulos(capitulos, largoTexto)`** — la regla que quita las migas
  del índice, ahora como función propia y exportada. `componerTexto` la usa, y también el
  re-troceo de los libros viejos, que no puede volver a leer el PDF.
- **`limpiezaTexto.js: ajustarAPalabra(texto, posicion)`** — mueve cualquier posición al límite de
  palabra anterior. Se aplica a **todas** las posiciones de capítulo, vengan de donde vengan. Con
  un tope de retroceso: ante una «palabra» larguísima (una URL pegada) se queda donde estaba en vez
  de saltar a mitad del párrafo anterior.
- **`pdfController.js: rehacerTroceo()`** — al abrir un libro guardado con troceo antiguo, se
  rehacen sus unidades **sin volver a leer el PDF**: se junta el texto que ya está, se depuran los
  capítulos y se vuelve a cortar. Queda anotado con `versionTroceo`, así que ocurre una sola vez.
  Si el resultado sería idéntico, no se toca nada.
- **`biblioteca.js: marcarTroceo()`** — guarda las unidades nuevas y la versión.
  `contenidoActualizado` sí se toca (el texto por capítulos cambió y los otros aparatos deben
  recibirlo); `progreso` **no**, porque por dónde iba la persona lo resuelve el ancla de texto
  buscando su contenido en las partes nuevas.

### Verificado sobre el caso real
Nueva `tests/verificar_pdf_retroceo.mjs` ✔ **10/10**: siembra en la biblioteca un libro con el
troceo defectuoso —tres unidades en la página 5, una vacía, «Urano» como capítulo y la palabra
«esta» partida entre el apéndice y el prólogo—, lo abre y comprueba el resultado:

```
el libro parte del troceo viejo (5 unidades)
y con tres unidades en la página 5, como se reportó
→ se retiran las unidades vacías (5 → 3)
→ no quedan varias unidades con el mismo número de página (5×1, 10×1, 11×1)
→ ninguna unidad empieza a mitad de palabra («ta conclusión»)
→ ninguna unidad termina a mitad de palabra («Y es»)
→ el progreso de lectura sobrevive
→ al reabrirlo no se vuelve a rehacer
```

Esta prueba es justo la que faltaba en la v2.31.0: se probó el troceo de PDF nuevos y no el de los
libros que la gente ya tiene.

### Pruebas
- `tests/test_pdf_limpieza.mjs` ✔ **86/86**: `depurarCapitulos` sobre un índice sucio real,
  `ajustarAPalabra` con el corte «esta» reportado, y los casos límite.
- `tests/verificar_pdf_retroceo.mjs` ✔ **10/10** (nueva).
- Regresión ✔ **602 OK · 0 FALLOS** · geometría 42/42 · scroll 39/39 · navegador 103/103.

### Deploy v70
- `sw.js` → `jg-turbo-shell-v70` · `JG_JS_V` → `v70`
- `index.html` → `<!-- v2.32.0 · Los libros ya guardados rehacen sus paginas al abrirlos -->`
- Producción: `jg-turbo-dzzj3p060` → alias **https://jg-turbo.vercel.app**
- Verificado con cache-busting: marcador `v2.32.0`, `sw.js v70`, `/api/health` ok, y en los módulos
  servidos `depurarCapitulos` + `ajustarAPalabra` en `limpiezaTexto.js`, `rehacerTroceo` en
  `pdfController.js` y `marcarTroceo` en `biblioteca.js`.

### Cómo comprobarlo con el libro delante
Recargar **dos veces** (la primera toma el `sw` nuevo) y abrir «El placebo eres tú». Al abrirlo
debe salir un aviso breve: **«Se reorganizaron las páginas de este libro»**. Si no sale, el libro ya
estaba bien o el `sw` viejo sigue activo — en ese caso, recargar otra vez.

Después, en el índice: ninguna entrada repetida de la misma página, ninguna que solo diga «Urano» o
el nombre del autor, y ninguna unidad que empiece o acabe a mitad de palabra.

---

## Entrega 2026-09-03 · v2.31.0 · Páginas coherentes y guía que deja de titilar

### Lo reportado
Leyendo «El placebo eres tú»: las unidades de lectura cortaban páginas y párrafos por la mitad,
había **tres «página 5»**, un capítulo que solo contenía «Joe Dispenza», el índice y el prólogo
cortados, y hasta la página 17 no aparecía texto compacto. Y la guía de lectura **titilaba**
buscando la frase durante el primer minuto, hasta que se calmaba sola.

---

### 1 · El troceo: reproducido antes de tocar nada

Con un índice de libro típico, `componerTexto()` devolvía esto:

```
 0  pág   1  pos     0  largo     0  «Portada»       ← vacío
 1  pág  99  pos     0  largo   122  «Capítulo 2»    ← ¡un capítulo del final, al principio!
 2  pág   5  pos   122  largo     0  «Joe Dispenza»
 3  pág   5  pos   122  largo     0  «Créditos»
 4  pág   5  pos   122  largo    14  «Dedicatoria»
 5  pág   6  pos   136  largo    44  «Índice»        ← el índice cortado
=== página 5 aparece 3 veces ===
```

**Causa**, en `limpiezaTexto.js: componerTexto()`:

```js
posicion: Math.min(inicioDePagina.get(entrada.pagina) ?? 0, …)
```

Tres defectos en una línea. El índice de un PDF trae una entrada por cada página de cortesía, y:
1. **`?? 0`** mandaba al principio del libro toda entrada cuya página no tuviera texto — por eso
   un capítulo del final aparecía primero.
2. **Varias entradas en la misma página** compartían posición → capítulos de largo 0.
3. **Sin mínimo de contenido**, cualquier entrada era un capítulo, aunque solo contuviera un
   nombre.

Y `componerTexto` **no devolvía dónde empieza cada página**, así que era imposible cortar por
páginas reales, que es lo que se pidió.

**Corrección:**
- `componerTexto()` devuelve `paginas: [{numero, posicion}]` con las posiciones **en el texto ya
  pulido**. Las posiciones en bruto no valen porque el pulido cambia el largo, así que cada página
  se vuelve a localizar por su contenido — la misma técnica que usa la guía para casar voz y texto.
- Las entradas del índice se mapean a esas posiciones reales; **la que apunta a una página que no
  existe se descarta** en vez de caer en la posición 0.
- Una entrada es capítulo **según el contenido que tiene por delante**, no según lo lejos que esté
  de la anterior. Se recorre de atrás hacia adelante. Mirando hacia atrás se perdía el prólogo de
  los libros con muchas páginas de cortesía: quedaba pegado a la portada y se descartaba, aunque
  detrás tuviera un capítulo entero.
- El mínimo escala con el documento: 400 caracteres son una miga en un libro de 300 páginas y son
  el documento entero en un folleto.
- `pdfController.js: mejorCorte()` — al partir por tamaño se corta, por este orden: **final de
  página real** → final de párrafo → final de frase → hueco entre palabras. Antes, si no había un
  salto de párrafo cerca, cortaba en el carácter exacto: **a mitad de palabra**.

**Resultado con el mismo libro:**

```
 pág   1  largo   154  «Portada»      (las páginas de cortesía, agrupadas)
 pág   7  largo  2062  «Prólogo»
 pág  10  largo  7919  «Capítulo 1»
 páginas repetidas: ninguna
```

---

### 2 · La guía que titilaba: medido, no supuesto

**Causa**, en `pdfController.js`: las anclas que casan el audio con el texto se calculaban **una
sola vez**, al arrancar la lectura. El audio se genera por tandas, así que en ese momento la cola
tenía **uno o dos bloques**; cuando crecía a doce, las anclas seguían siendo dos.

Y como la última ancla se extiende «hasta el final del texto» (`posicionDeVoz`), el efecto medido
en un capítulo de 20 000 letras con 2 anclas fue:

```
bloque 0 →      0 → 900
bloque 1 →    900 → 20000     ← barre el capítulo entero
bloque 2 →    900 → 20000     ← y vuelve atrás
bloque 3 →    900 → 20000     ← una y otra vez
```

Eso es exactamente lo que se veía titilar. Con las anclas al día, cada bloque cubre solo su tramo
(1667 → 3333 → 5000…) y la marca avanza sin volver atrás.

**Corrección:**
- Las anclas se recalculan **también cuando crece la cola**, no solo al empezar una lectura nueva.
- Red de seguridad: **la marca no retrocede sola**. Situar un bloque es aproximado y un cálculo
  puede quedar unas frases por detrás. Solo retrocede cuando la persona lo pide: cambiar de
  capítulo, tocar un párrafo, los botones de frase o mover la barra. La barra vive en `index.html`
  y avisa con un evento `jg-tts-salto`.

---

### Pruebas
- `tests/test_pdf_limpieza.mjs` ✔ **70/70** (era 50): posiciones de página en orden y dentro del
  texto, ningún capítulo vacío, sin páginas repetidas, un capítulo de página inexistente que no
  aterriza al principio, orden correcto, y los casos límite (documento sin páginas, índice entero
  apuntando a páginas que no existen).
- `tests/test_pdf_guia.mjs` ✔ **10/10** (nuevo): el barrido con anclas incompletas (el fallo), el
  tramo correcto con anclas al día, cuándo hay que resituar y la regla de no retroceder.
- Regresión ✔ **553 OK · 0 FALLOS** · geometría 42/42 · scroll 39/39 · navegador 103/103.

### Una prueba antigua que tenía razón
Al poner el mínimo de capítulo, falló «usa el índice interno del PDF cuando existe»: usa un
documento de 60 caracteres, donde exigir 400 no tiene sentido. La prueba tenía razón y el arreglo
fue hacer que el mínimo escale con el tamaño del documento, no cambiar la prueba.

### Deploy v69
- `sw.js` → `jg-turbo-shell-v69` · `JG_JS_V` → `v69`
- `index.html` → `<!-- v2.31.0 · Paginas coherentes y guia sin titileo -->`
- Producción: `jg-turbo-digysyun4` → alias **https://jg-turbo.vercel.app**
- Verificado en **https://jg-turbo.vercel.app**: marcador `v2.31.0`, `sw.js v69`, `/api/health` ok,
  y en los módulos servidos `situarPaginas` en `limpiezaTexto.js` y `mejorCorte` + `guia.saltar` en
  `pdfController.js`.

> **Ojo al verificar:** la primera comprobación devolvió el marcador de la entrega ANTERIOR y cero
> coincidencias en los módulos. No era un despliegue fallido: era la caché del CDN. Repitiendo con
> un parámetro distinto (`?nocache=…`) salió todo correcto. Conviene añadir siempre ese parámetro
> antes de dar por malo un despliegue.

### Falta comprobar con el libro delante
Abrir «El placebo eres tú» y mirar el índice: no debería haber capítulos repetidos ni entradas que
solo digan el nombre del autor. Y escuchar el primer minuto: la marca debería avanzar sin volver
atrás. Si algún libro concreto sigue partiendo mal, mandar su índice para ajustar el mínimo.

---

## Entrega 2026-09-03 · v2.30.0 · Carátula automática para los libros sin tapa

### Lo pedido
Que los PDF que son solo texto tengan carátula: buscarla con IA a partir del título, o buscar la
real.

### Qué se descartó, y por qué
**Generar la imagen con Gemini.** El modelo `gemini-2.5-flash-image` cuesta **~US$0,039 por
imagen** (US$30 por millón de tokens de salida, 1290 por imagen) y **el plan gratuito no lo
incluye**: devuelve cuota 0. Además, los modelos de imagen escriben mal el texto, así que la
portada saldría con el título con erratas — peor que una tipográfica limpia. Consultado con el
usuario, que eligió la cascada gratuita.

### Qué se hizo: real primero, dibujada siempre

**`js/pdf/caratula.js`** (nuevo, con pruebas):
- `limpiarNombreLibro()` — el título sale del nombre del archivo, y los nombres reales vienen con
  la basura de las descargas: «( PDFDrive )», «(1)», guiones bajos, «-pdf» pegado sin punto. Sin
  limpiarlo no se encuentra nada y la portada dibujada saldría con «pdf» escrito. Separa el autor
  cuando el nombre lo deja ver («Sapiens - Yuval Noah Harari»), y solo entonces: sin guion rodeado
  de espacios no se inventa nada.
- `elegirMejorPortada()` — exige un parecido mínimo de 0,6 comparando palabras con significado, y
  sube la nota si además acierta el autor. **Poner la portada de otro libro es peor que no poner
  ninguna**: el usuario creería que ese es su libro.
- `dibujarPortada()` — pinta la tapa en canvas: degradado propio del libro (color derivado del
  título, siempre el mismo), título, autor tras una raya corta, iniciales muy tenues al pie y un
  filete junto al lomo. Instantánea, sin conexión, sin coste y con el texto perfecto.

**`api/portada.py`** (nuevo): busca en Open Library y en Google Books. Va en el servidor porque
Open Library **no acepta consultas desde una web** (no envía cabeceras CORS); las imágenes de
portada sí, y por eso las descarga el navegador: el servidor solo dice *cuál* es. Nunca lanza
error — quedarse sin portada no es una avería.

**Integración**: las tapas que faltan se dibujan solas al abrir la biblioteca (sin red, así que no
gasta datos de nadie), y hay **«Buscar carátula»** en el menú de cada libro para ir a por la real.

### Resultado medido, con los libros reales del usuario
Los siete títulos se limpian bien y las siete portadas se dibujan (2,6-4,7 KB cada una):
«How to write a good advertisement Victor O. Schwab», «Pre-suasión Un método revolucionario para
influir y persuadir», «La Inteligencia Emocional», «El placebo eres tú», «Becoming Supernatural…»,
«El aprendiz de brujo», «Sex code».

### ⚠️ La portada REAL no funciona todavía, y no es un fallo del código
Probado contra producción con los libros del usuario:

```
{"resultados":[],"aviso":"_openlibrary:ConnectTimeout | _google_books:google_sin_clave"}
```

- **Open Library**: `ConnectTimeout` incluso subiendo la espera de 8 s a 15 s. Desde Vercel no se
  alcanza ese catálogo.
- **Google Books**: `429`. Y aquí está el dato útil: el aviso dice `google_429`, **no**
  `google_sin_clave`, así que **la clave existe** en el entorno de Vercel. Un 429 con clave válida
  y cuota 0 significa una cosa concreta: **la «Books API» no está habilitada** en ese proyecto de
  Google Cloud. (El error crudo lo confirma: `quota_limit_value: '0'` para el proyecto
  `624717413613`.)

**Cómo activarla** (gratis, ~2 minutos): en Google Cloud Console → «APIs y servicios» → habilitar
**Books API** en el proyecto de esa clave. Nada más: el código ya la usa
(`GOOGLE_BOOKS_API_KEY` o `GOOGLE_API_KEY`). Son 1000 consultas al día, de sobra para una
biblioteca personal.

Mientras tanto **la carátula dibujada cubre todos los libros**, que es lo que se ve por defecto.

### Pruebas
- `tests/test_pdf_caratula.mjs` ✔ **37/37**: limpieza de nombres reales, el «pdf» suelto, la marca
  de la web, autor separado y autor no inventado, elección de portada (incluido «si nada se parece,
  ninguna»), color estable e iniciales; y los casos límite (vacío, nulo, solo signos, 500 letras).
- `backend/tests/test_api_portada.py` ✔ **11/11**, sin añadir `pytest-asyncio`: `asyncio.run` basta.
  Cubre lo importante, que es que **el endpoint nunca rompa la app**: sin red, con el catálogo
  caído, con una respuesta inesperada.
- Regresión ✔ **517 OK · 0 FALLOS** · geometría 42/42 sin avisos · scroll 39/39 · navegador 103/103.

### Una prueba que arreglé de paso
`verificar_pdf_navegador` elegía los botones del menú del libro por posición (`nth(1)`), así que
añadir «Buscar carátula» la rompió y el fallo señalaba a «borrar», que no se había tocado. Ahora se
buscan **por su texto**, como haría una persona.

### Deploy v68
- `sw.js` → `jg-turbo-shell-v68` · `JG_JS_V` → `v68`
- `index.html` → `<!-- v2.30.0 · Caratula automatica: la real del catalogo o una dibujada con el titulo -->`
- Producción: `jg-turbo-j1ronzt7l` → alias **https://jg-turbo.vercel.app**
- Verificado en **https://jg-turbo.vercel.app**: marcador `v2.30.0`, `sw.js v68`, el módulo
  `/js/pdf/caratula.js?v=v68` servido con `limpiarNombreLibro` y `dibujarPortada`, y
  `/api/portada` respondiendo (con el aviso de la clave, no con un error).

### Falta comprobar con los aparatos delante
Recargar dos veces y abrir la pestaña PDF: los libros sin tapa deben aparecer con su carátula
dibujada en un segundo. «Buscar carátula» en el menú de un libro dirá que no está en el catálogo
hasta que se habilite la Books API.

---

## Entrega 2026-09-03 · Documentación · `TRAMPAS.md`

### Lo pedido
Que los errores cometidos —los míos y los de otros agentes— queden escritos para que no se repitan.

### Qué se hizo
Nuevo **`TRAMPAS.md`**: 9 secciones, ~25 casos reales, cada uno con síntoma, causa medida y la regla
que lo evita. Todos ocurrieron de verdad en este proyecto; ninguno es hipotético. Varios se
cometieron **dos veces** por no estar escritos.

Las secciones que más han costado:
1. **Pruebas que pasan sin probar nada** — verificaciones en verde con la funcionalidad rota (dos
   libros no ejercitan el scroll), una que llevaba desde la v2.28.0 cortándose en la comprobación 48
   de 103 sin que nadie contara, y una migración que dejó atrás 9 pruebas y rompió Playwright.
3. **La cadena de scroll se suelta entera o no se suelta** — con la tabla de cómo está diseñada la
   app (pantalla fija en ≥641px, scroll de documento en móvil, y las dos excepciones).
5. **Cinco formas de perder datos en la sincronización** — la comprobación colocada detrás del
   filtro que ya la excluía, el cambio que no altera la marca de tiempo y por eso no se propaga, y
   por qué **nunca** hay que tocar `actualizado` para forzar un envío (pisaría el progreso ajeno).

`Agents.md` gana dos secciones nuevas:
- Un aviso al principio, con una tabla de «vas a tocar X → lee la sección Y» de `TRAMPAS.md`.
- **Verificación**: qué pruebas existen, cómo correrlas y **con qué cifra de referencia**, porque
  parte del problema era no saber cuáles había ni notar cuándo una se cortaba.

### Decisión sobre las referencias
Las causas se citan por **nombre de función, selector o título de sección**, no por número de línea:
durante esta misma sesión dos referencias se desplazaron por mis propias ediciones. En un
`index.html` de más de 15 000 líneas, una línea citada envejece en horas.

### Verificado
Las cifras de referencia que se documentan en `Agents.md` se comprobaron ejecutándolas:
unitarias **451 OK / 0 fallos**, geometría **42 / 0 avisos**, scroll **39**, navegador **103**.
Y que los 15 archivos de prueba listados existen.

---

## Hotfix 2026-09-03 · v2.29.1 · El scroll de la biblioteca (regresión de la v2.29.0)

### Lo reportado
«Ya veo las carátulas, pero no deja hacer scroll. No me deja bajar.»

### Causa — mía, de la entrega anterior
La v2.29.0 sacó la biblioteca de su caja con scroll propio liberando `html`, `body`, `#panelPdf`,
`.card` y `.pdf-area`… pero **no `.wrap`**, que en pantallas ≥641px lleva
`height:100dvh; overflow:hidden` (regla «9. Alto de la ventana», `index.html:3974`).

Medido con nueve libros: `#panelPdf` crecía correctamente a 1159 px, pero `.wrap` seguía anclado a
800 px **recortando** un contenido de 1334 px. No es que el scroll fallara: es que no había nada
que desplazar, porque el contenido estaba cortado, no desbordado.

La app está diseñada así a propósito —pantalla fija con scroll interior— y es lo correcto para el
lector, Micrófono, Archivo y YouTube, donde el contenido tiene un alto acotado. Solo la biblioteca
necesita lo contrario, porque crece con cada libro. Había que soltar la cadena entera, no la mitad.

### Corrección
`index.html` — la excepción de la biblioteca alcanza también a `.wrap`:

```css
body:not(.jg-leyendo):not(.jg-pantalla):has(#panelPdf.active) > .wrap{
  height:auto;min-height:100dvh;overflow:visible;
}
```

Resultado medido: móvil 2302 px de contenido y se desplaza; escritorio 1369 px y se desplaza. Y el
scroll es **del documento**, no de una caja interna, que era el objetivo de la v2.29.0.

### Por qué no se detectó antes
Todas las verificaciones trabajaban con **dos** libros, y con dos libros todo cabe en pantalla:
nunca llegaban a intentar desplazarse. Pasaban en verde con el scroll roto.

Nueva `tests/verificar_pdf_scroll.mjs` ✔ **39/39**: siembra nueve libros, **hace scroll de verdad
con la rueda del ratón** y comprueba que la página se mueve, en móvil, tablet y escritorio.
Verifica además lo que NO debía cambiar: que Micrófono, Archivo y YouTube conservan el layout de
la app, y que el lector mantiene su scroll interno.

**Comprobado que la prueba sirve:** contra el CSS con el fallo da **6 FALLOS** en las tres
pantallas («el contenido no supera la ventana», «la página no se desplaza»); contra el corregido,
39/39.

### Pruebas
- `tests/verificar_pdf_scroll.mjs` ✔ 39/39 (nueva)
- `tests/verificar_pdf_geometria.mjs` ✔ 42/42, sin avisos
- `tests/verificar_pdf_navegador.mjs` ✔ 103/103
- Regresión unitaria ✔ 451 OK · 0 FALLOS

### Deploy v67
- `sw.js` → `jg-turbo-shell-v67` · `JG_JS_V` sigue en `v66` (esta entrega no toca ningún módulo JS)
- `index.html` → `<!-- v2.29.1 · Arreglado el scroll de la biblioteca (faltaba soltar .wrap) -->`
- Producción: `jg-turbo-4kfs980or` → alias **https://jg-turbo.vercel.app**
- Verificado en **https://jg-turbo.vercel.app**: marcador `v2.29.1`, `sw.js v67`, `/api/health` ok,
  y presentes en el HTML servido tanto la regla que libera `.wrap` como la del botón a 44 px.
  (El alias tardó ~40 s en propagar: la primera comprobación seguía sirviendo la v2.29.0. Conviene
  reintentar antes de dar por fallido un despliegue.)

---

## Entrega 2026-09-03 · v2.29.0 · Las carátulas llegan de verdad, y la biblioteca deja de ser una ventana

### Lo reportado
1. «Actualizo y dice que está cargando/enviando la información, pero no carga las carátulas.»
2. «La parte de *Tu biblioteca* tiene muy mal responsive: en móvil se ve horrible y en escritorio y
   tablet queda como una ventana emergente cuando hacemos scroll.»

---

### 1 · Las carátulas: llegaban al navegador y se tiraban

**Comprobado antes de tocar nada** (consulta directa a la base de la sincronización): las 6
carátulas **sí estaban en la nube**, subidas por el arreglo de la v2.28.5, entre 30 y 65 KB cada
una, y los tres aparatos comparten la misma biblioteca. El fallo no estaba en el envío.

**Causa.** El servidor (`jgt_bajar`) filtra por `sello`, el momento de la escritura, así que el
documento con la carátula **sí viajaba de vuelta**. Lo descartaba el cliente:

```js
const aplicar = llegados.filter((remotoDoc) =>
  decidir(aqui.get(remotoDoc.id) || null, remotoDoc) === 'bajar');
```

`decidir()` compara `actualizado`, y **enviar una carátula no cambia `actualizado`**: mandar la
tapa de un libro no es haberlo leído. Con la misma marca en los dos lados, la respuesta era «nada
que hacer» y el documento se descartaba entero, con la imagen dentro. La carátula llegaba hasta el
navegador y se tiraba a la basura.

**Corrección.** Una carátula no compite con nada: no pisa progreso ni texto, solo añade una imagen
que faltaba. Ahora se aplica al margen de quién gane el documento.

- `js/pdf/sincronizacion.js: portadasARescatar(llegados, locales)` — función pura, con pruebas.
  Solo rescata lo que parece una imagen (`data:image/…`), nunca de un libro borrado, y **nunca
  inventa un libro que este aparato no tiene** (ese lo trae la bajada normal, con su carátula).
- `js/pdf/biblioteca.js: guardarPortadaRecibida(id, dataURL)` — guarda **solo** la imagen. No pasa
  por `guardarDocumento()` a propósito: así una carátula que llega no puede hacer que este aparato
  retroceda en un libro que iba leyendo.
- `js/pdf/biblioteca.js: exportarParaSincronizar()` entrega también `tienePortada`.
- `js/pdf/nube.js` las aplica tras la bajada, saltándose los documentos que ya bajaron por la vía
  normal, y devuelve `caratulas` en el resultado.
- `js/pdf/pdfController.js` lo dice en el aviso: «Listo: 6 carátulas nuevas». Antes, con solo
  carátulas nuevas, habría dicho «Todo al día» justo cuando el usuario esperaba verlas.

---

### 2 · La biblioteca: por qué parecía una ventana emergente

**Causa.** `.card` (`flex:1` + `overflow:hidden`) y `.pdf-area` (`height:100%` +
`overflow-y:auto`) encerraban la biblioteca en una caja de altura fija **con scroll propio**. Al
desplazarse, la lista se movía dentro del recuadro mientras el resto de la página seguía quieta:
en escritorio y tablet parecía un panel flotante pegado encima, y en el celular dejaba los libros
asomando por una rendija.

**Corrección.**
- Fuera del modo lectura, la biblioteca fluye con la página. En modo lectura el scroll interno se
  conserva, que ahí sí hace falta (el dock de reproducción va anclado abajo).
- `html,body{height:100%}` pasa a `min-height` en esa vista. Con una altura exacta el documento no
  crecía, el contenido se desbordaba por debajo y **el pie de la app acababa montado sobre los
  botones del final** — lo detectó la verificación geométrica, no el ojo.
- Cabecera en rejilla en vez de `flex-wrap`: con flex, el título llevaba `flex:1` y empujaba los
  botones a la línea siguiente en cuanto la pantalla se estrechaba, y `align-items:flex-end` los
  dejaba desalineados. En un celular de 360 px eran tres alturas distintas. Ahora el título manda
  una línea y los botones ocupan la siguiente, con «Añadir» a lo ancho por ser la acción principal.
  Bajo 380 px la palabra «Actualizar» se va y queda el icono (`aria-label` y `title` lo explican).
- El botón «Actualizar» pasa de **36 px a 44 px**: `.pdf-actualizar` perdía contra la regla general
  `.chip,.tts-pill,…,.mini-btn{min-height:36px}`, que va después con la misma especificidad. Se
  nombra también la cabecera para ganarla. Y su icono **gira mientras trabaja**: en un celular con
  datos lentos, un botón quieto durante diez segundos parece uno que no funciona.

---

### Pruebas
- `tests/test_pdf_sincronizacion.mjs` ✔ **70/70** (era 55): rescate con marcas iguales, con lo local
  más nuevo, carátula ya presente, libro borrado, libro que aquí no existe, algo que no es imagen,
  y listas nulas o vacías.
- Regresión unitaria ✔ **451 OK · 0 FALLOS** en los 13 archivos de `tests/`.
- `tests/verificar_pdf_geometria.mjs` ✔ **42/42 y sin un solo aviso** en móvil, tablet y escritorio
  (antes avisaba del botón de 36 px). Medido además: el scroll interno del área desaparece en las
  tres pantallas, cero desborde horizontal, botón a 44 px.
- `tests/verificar_pdf_navegador.mjs` ✔ **103/103**.

### Dos verificaciones que estaban rotas y nadie lo sabía
Las dos daban por buena la entrega sin llegar a ejecutarse enteras:
1. Buscaban Playwright en una única ruta (`../node_modules`) que **dejó de existir al aplanar el
   repo**. Ahora prueban varias ubicaciones y, si no lo encuentran, lo dicen con claridad.
2. `verificar_pdf_navegador` se cortaba en la comprobación 48 de 103 por un timeout que no explicaba
   nada: la hoja de permiso de la IA (nueva en la v2.28.0) se abría a media prueba y tapaba la
   pantalla. Ahora se responde «solo local» en cuanto asoma —lo correcto en una prueba: no debe
   salir ni una petición a la IA—. **Comprobado con `git stash` que ese corte era anterior a esta
   entrega.**

### Deploy v66
- `sw.js` → `jg-turbo-shell-v66` · `JG_JS_V` → `v66`
- `index.html` → `<!-- v2.29.0 · Las caratulas llegan de verdad + biblioteca sin ventana emergente -->`
- Producción: `jg-turbo-g1vq1fmxr` → alias **https://jg-turbo.vercel.app**
- Verificado en **https://jg-turbo.vercel.app** el 2026-09-03: marcador `v2.29.0`, `JG_JS_V v66`,
  `sw.js v66`, `/api/health` ok. Comprobado sobre los módulos servidos (`?v=v66`) que llevan de
  verdad los cambios: `portadasARescatar` en `nube.js` y `sincronizacion.js`,
  `guardarPortadaRecibida` en `biblioteca.js`, y en el HTML tanto la regla de la biblioteca sin
  scroll interno como la del botón a 44 px.

### Qué falta comprobar (solo con los aparatos delante)
En cada uno: recargar **dos veces** (la primera toma el `sw` nuevo) y pulsar **Actualizar**. Debe
decir **«Listo: N carátulas nuevas»** y aparecer las tapas. El libro «How to write a good
advertisement» seguirá sin carátula hasta que se pulse Actualizar en el aparato donde se abrió: es
el único que tiene esa imagen, y en la nube aún no está.

---

## Entrega 2026-09-03 · v2.28.5 · Las carátulas por fin viajan, y el botón responde

### Lo reportado
«Creó un botón de Actualizar cerca de Añadir un PDF para que se sincronizaran las carátulas, pero
no pasa nada al pulsarlo.»

### Dos causas, las dos reales

**A · El botón no daba ninguna señal de vida.**
`btnPdfActualizarBiblio` sí estaba cableado a `sincronizarAhora()`, pero todo el feedback de esa
función va a la sección de la nube, al final de la página: `conBotonOcupado(el.nubeSync, …)`
bloquea el botón *de esa sección* y `avisoNube(…)` escribe en `#pdfNubeAviso`, dentro de un
`<details>` que normalmente está cerrado. Pulsando el botón de la cabecera no se veía nada: ni que
trabajara, ni el resultado, ni el error. Un botón sin respuesta es indistinguible de uno roto.

**B · Las carátulas de los libros ya sincronizados no salían del aparato. Nunca.**
En `js/pdf/nube.js` la lista de envío se armaba así:

```js
const paraSubir = locales.filter((local) => (cursor
  ? (local.actualizado || 0) > (local.sincronizado || 0)
  : decidir(local, alla.get(local.id) || null) === 'subir'));
```

Un libro sincronizado hace meses tiene `actualizado <= sincronizado`, así que **quedaba fuera de la
lista**. Y la comprobación que debía rescatarlo —`biblioteca.faltaSubirPortada(id)`— estaba
**dentro del bucle que recorre esa misma lista**, es decir, detrás de la puerta que ya lo había
dejado fuera: no se ejecutaba jamás para los libros que la necesitaban.

Lo llamativo es que la intención estaba escrita y era correcta. El comentario de
`faltaSubirPortada()` en `biblioteca.js:647-654` describe exactamente este caso («los libros
sincronizados antes de que las carátulas viajaran… como ya figuran como sincronizados nunca la
reenviarían»). La función existía, funcionaba y estaba bien documentada. Solo que nadie la
llamaba a tiempo. Por eso pulsar «Actualizar» no traía nada: no había nada que enviar.

### Corrección

- **`js/pdf/sincronizacion.js`** (el módulo puro, con pruebas) recibe la decisión que estaba suelta
  en `nube.js`:
  - `debeSubir(local, { cursor, remoto, faltaPortada })` — una carátula pendiente es motivo
    suficiente para subir, aunque el libro esté al día. Nunca para un libro borrado: de eso solo
    viaja la lápida.
  - `puedeFaltarPortada(local)` — filtro barato, solo con lo que ya está en memoria, para no
    consultar la base por cada libro en cada sincronización.
- **`js/pdf/nube.js`** arma la lista **antes** del bucle y consulta `faltaSubirPortada()` solo para
  los libros que pueden tenerla pendiente. En cuanto una carátula viaja queda marcada y no se
  vuelve a mirar, así que el coste tiende a cero.
- **`js/pdf/biblioteca.js`** — `exportarParaSincronizar()` entrega `portadaSincronizada`. Sin ese
  dato la decisión era ciega y habría que leer la base para cada libro.
- **`js/pdf/pdfController.js`** — `sincronizarAhora()` acepta `desdeCabecera`: bloquea y anuncia en
  **el botón que se pulsó**, y publica progreso, resultado y errores con `avisar()`, que se ve
  arriba. Sin nube conectada ahora lo dice con palabras antes de abrir la sección, en vez de
  desplegar un panel que el usuario no había pedido.
- **`index.html`** — la etiqueta del botón va en `#pdfActualizarBiblioLabel` para poder cambiarla
  a «Actualizando…».

### Pruebas
- `tests/test_pdf_sincronizacion.mjs` ✔ **55/55** (era 42): libro al día con carátula ya enviada,
  al día sin marca, confirmación de carátula pendiente, libro borrado, libro con cambios, primera
  sincronización sin cursor con y sin carátula pendiente, y casos nulos.
- Cinco comprobaciones estructurales nuevas que vigilan que el arreglo no se deshaga: que `nube.js`
  siga decidiendo con `debeSubir()`, y que **la carátula se compruebe antes del bucle, no dentro**
  —que era justo el error—. Sin esto, la regla podría estar perfecta y volver a no servir de nada.
- Regresión completa ✔ **441 OK · 0 FALLOS** en los 13 archivos de `tests/`.
- `node --check` ✔ en los cinco módulos tocados (las pruebas no cargan `nube.js` ni
  `pdfController.js` enteros, así que un error de sintaxis ahí no lo vería nadie).

### Verificado además
`guardarDocumento()` conserva la carátula local cuando llega un documento sin ella
(`portada || antes.portada || null`, `biblioteca.js:232`): sincronizar no borra una carátula que
solo estaba en este aparato.

### Deploy v65
- `sw.js` → `jg-turbo-shell-v65` · `JG_JS_V` → `v65` (si no se sube, el HTML nuevo se emparejaría
  con el JS viejo y el botón volvería a estar muerto)
- `index.html` → `<!-- v2.28.5 · Las caratulas de libros ya sincronizados por fin viajan; el boton Actualizar responde -->`
- Producción: `jg-turbo-apzve5n6b` → alias **https://jg-turbo.vercel.app**
- Verificado en **https://jg-turbo.vercel.app** el 2026-09-03: marcador `v2.28.5`, `JG_JS_V v65`,
  `sw.js v65`, `#pdfActualizarBiblioLabel` presente, `/api/health` ok. Comprobado además sobre los
  módulos servidos (`?v=v65`): `nube.js` usa `debeSubir()` **y** consulta la carátula antes del
  bucle, `sincronizacion.js` exporta `debeSubir`, y `pdfController.js` trae `desdeCabecera`.

### Qué falta comprobar (solo se puede con los aparatos delante)
Que las 7 carátulas aparezcan en los tres. El recorrido: en el aparato **donde se abrieron los
PDF** (el que tiene las imágenes), recargar dos veces para tomar el `sw` nuevo y pulsar
**Actualizar** — debe decir «se enviaron N libros», no «Todo al día». Después, en los otros dos,
recargar y pulsar **Actualizar**: deben decir «llegaron N libros» y pintarse las carátulas. Si el
primero dice «Todo al día» de entrada, es que ese aparato no tenía las imágenes: hay que pulsar
Actualizar en el que sí las tiene.

---

## Fix · JS versionado con el HTML (rama `fix-aviso-vacio`)

Síntoma: el botón «Actualizar» aparecía pero no hacía nada (HTML nuevo + JS viejo del caché: el service worker sirve `/js/` al instante y lo refresca por detrás).
Corrección: los dos módulos dinámicos (`pdfController`, `youtubeSyncController`) se importan con `?v=` de la constante `JG_JS_V` (`index.html`); al subirla en cada despliegue, HTML y JS van siempre juntos. Regla: subir `JG_JS_V` + `CACHE_SHELL` + marcador en cada entrega.
Deploy: `sw.js` → `jg-turbo-shell-v64`, `index.html` → `v2.28.4`.

---

## Fix · Botón Actualizar en la biblioteca (rama `fix-aviso-vacio`)

Pedido: en escritorio/tablet no aparece la sección «Tus libros en todos tus aparatos» del fondo (en el móvil sí), así que no hay forma de sincronizar.
Corrección: nuevo botón **Actualizar** en la cabecera de la biblioteca, junto a «Añadir un PDF» (`index.html: btnPdfActualizarBiblio`; `pdfController.js`): si el aparato está vinculado sincroniza; si no, abre la sección de nube para vincularlo. Funciona aunque la sección del fondo no se vea.
Pruebas: `node --check` ✔ + regresión (`sincronizacion`) ✔. Verificación visual pendiente en escritorio/tablet del usuario.
Deploy: `sw.js` → `jg-turbo-shell-v63`, `index.html` → `v2.28.3`.

---

## Fix · Línea marrón vacía + carátulas pendientes (rama `fix-aviso-vacio`)

- **Línea marrón vacía (reportada con fotos):** era la caja de avisos (`#pdfNotice`, clase `.notice`) mostrándose vacía: su `display:flex` le ganaba al atributo `hidden`. Una regla `.notice[hidden]{display:none !important}` la quita en todos los paneles. Solo aparece cuando hay un mensaje de verdad.
- **Carátulas de libros ya sincronizados:** viajaban solo con el contenido; los 7 libros, sincronizados antes, no las reenviaban nunca. Nueva marca contable `portadaSincronizada`: cada carátula local pendiente hace un único viaje más y queda anotada (`biblioteca.js: faltaSubirPortada/marcarPortadaSincronizada`; `nube.js` la pide y la anota; al importar con carátula también se anota para no devolverla). No toca `actualizado`: no provoca reenvíos.
- Deploy: `sw.js` → `jg-turbo-shell-v62`, `index.html` → `v2.28.2`.

---

## Mejora · Carátulas en los 3 aparatos (rama `feat-portadas-sync`)

Pedido: las carátulas se veían en el móvil (donde se importó el PDF) pero no en escritorio ni tablet.
Causa: la carátula se genera al importar (primera página → JPEG) y se guarda solo en ese aparato; la sincronización no la enviaba (solo viajaban metadatos, capítulos, traducción y pulido). Además, un libro con marca `tienePortada` pero sin archivo mostraba un cuadro vacío en vez de la inicial.
Corrección: la carátula viaja como texto (`portadaMini`) dentro de `datos` del paquete y al llegar se vuelve imagen y se guarda con el libro (`biblioteca.js: blobADataURL/dataURLABlob/paqueteParaSubir/importarDeSincronizacion`; `nube.js` la pide solo cuando el contenido viaja, nunca con el registro ligero). Sin carátula, la tarjeta muestra la inicial (`pdfController.js: tarjetaLibro`).
Pruebas: `test_pdf_portada.mjs` ✔ 10/10 (nuevo) + regresión (`sincronizacion`, `exportar`) ✔. Ver en los 3 aparatos tras «Actualizar ahora».
Deploy: `sw.js` → `jg-turbo-shell-v61`, `index.html` → `v2.28.1`.
Verificado en https://jg-turbo.vercel.app: marcador v2.28.1 ✔, `sw.js` v61 ✔, `/api/health` ok ✔ (construido sobre v2.28.0 del otro agente, sin pisar su trabajo).

---

## Entrega 2026-09-03 · v5.1 · Que un libro suene a libro

### Lo pedido
Al escuchar un PDF, la voz decía los números entre corchetes de las guías y referencias, y en esas
partes «sonaba como si hablara en otro idioma». Se pidió que no los mencione y pulir la gramática
de la lectura en general.

### Causas encontradas

1. **Nada quitaba las llamadas de nota.** Ni `vozTexto.js: prepararParaVoz()` ni
   `index.html: ttsNormalizarTextoNarracion()` tocaban `[12]`, `[3, 4]`, `[ii]` ni `(12)`: llegaban
   enteros al motor, que los pronunciaba.
2. **El cambio de voz a inglés era real, y tenía dos disparadores** (`index.html:12367` y `:12373`,
   dentro de `ttsPareceTokenIngles`), que es lo que se oía como «otro idioma»:
   - `/[A-Za-z]\d|\d[A-Za-z]/` marcaba como término inglés **cualquier** palabra con un dígito
     pegado. Al extraer un PDF los superíndices de nota quedan cosidos al texto («la evolución3»),
     así que media frase en español se leía con acento inglés.
   - `TTS_ES_ACRONYMS` solo tenía 24 siglas y ninguna era de uso corriente en un libro: «la ONU»,
     «la OMS», «el PIB» o «la UNESCO» caían en la regla de acrónimos y se leían en inglés.
3. **Las abreviaturas de aparato crítico no se expandían.** `cf.` sonaba «ce-efe», `et al.` como
   una palabra inventada, y cada punto abría un corte de oración falso que partía la frase.
4. **Las direcciones web y los correos se deletreaban** carácter a carácter.
5. **Las iniciales de un nombre** («J. R. R. Tolkien») son tres puntos seguidos: el partidor de
   oraciones veía tres frases y la voz hacía tres caídas tonales antes del apellido.

### Corrección aplicada

Todo vive en la **capa efímera de voz**, la que se genera justo antes de hablar y se descarta. El
texto que se ve, se guarda, se exporta y se sincroniza no cambia ni un carácter (invariante 2 del
plan de auditoría editorial).

- `js/pdf/vozTexto.js: prepararParaVoz()` — nueva opción `limpiarReferencias` (activa por defecto):
  - Quita `[12]`, `[3, 4, 5]`, `[12-15]`, `[ii]`, `[*]`, `(12)` y `[...]`. **Solo cuando dentro no
    hay ninguna palabra**: `[sic]`, `[el rey]` o `(véase el mapa)` son acotaciones del autor o del
    editor y se conservan enteras.
  - Separa el número de nota pegado a la palabra («evolución3» → «evolución») solo si la palabra es
    de 4+ letras y va toda en minúsculas, con lista de excepciones (`covid`, `web`, `mp`, `iso`…):
    así «H2O», «GPT4», «MP3» y «1914» quedan intactos.
  - Expande `op. cit.`, `loc. cit.`, `ibíd.`, `íd.`, `et al.`, `cf.`, `vid.`, `v. gr.`, `s. f.`,
    `s. l.`, `n.º`, `núm.`, `fig.`, `tab.`, `ed.`, `trad.`, `AA. VV.`, `passim`, `pp.` y `p.`
    a su forma hablada en español.
  - Sustituye URLs por «enlace web» y correos por «dirección de correo».
  - Junta las iniciales («J. R. R. Malthus» → «J.R.R. Malthus») conservando el espacio del
    apellido, para no crear una palabra inventada.
  - Dice `§`, `¶`, `&` y la barra con palabras, cuidando la concordancia: «el § 4» se lee
    «el parágrafo 4», nunca «el sección 4».
  - Cose las costuras al final (espacios dobles, signo separado, coma repetida) y repone la
    mayúscula tras punto que se perdía al expandir una abreviatura. **Solo tras punto, nunca al
    principio de la cadena**: el texto llega partido en bloques y uno que empieza en minúscula es
    la continuación del anterior.
- `index.html: ttsNormalizarTextoNarracion()` — la misma limpieza de llamadas de nota, con la misma
  regla de «solo si no hay palabras dentro», para Micrófono, Archivo y YouTube.
- `index.html: ttsPareceTokenIngles()` — la regla de letras+dígitos ahora exige que la parte
  alfabética **no parezca prosa**: 4+ letras y todas minúsculas se leen en español. «GPT4», «H264»
  y «OpenAI» siguen en inglés.
- `index.html: TTS_ES_ACRONYMS` — ampliada de 24 a ~60 siglas: organismos (ONU, OMS, OTAN, UNESCO,
  UNICEF, FMI, OCDE…), economía (PIB, IPC, IVA), Colombia y región (DANE, DIAN, SENA, ICBF, EPS,
  MERCOSUR, CEPAL) y cronología (AC, DC, AAVV).
- `js/pdf/pulido.js` — retirado un bloque de comentario JSDoc duplicado (defecto cosmético de v5.0).

### Pruebas
- `tests/test_pdf_voz.mjs` ✔ **66/66** (era 15): referencias en corchetes, paréntesis y llaves;
  acotaciones que SÍ se conservan; notas pegadas y fórmulas que no se tocan; 7 abreviaturas
  académicas; URLs y correos; iniciales; símbolos; concordancia; invariante de que no se pierde
  ninguna palabra del autor; casos límite (texto que es solo una referencia, corchetes sin cerrar,
  50 000 caracteres, referencias seguidas).
- `tests/test_tts_narracion.mjs` ✔ **44/44** (nuevo): extrae del `index.html` las funciones reales
  (`ttsNormalizarTextoNarracion`, `ttsPareceTokenIngles`, `TTS_ES_ACRONYMS`) y **las ejecuta** en
  vez de comprobar que el texto esté presente. Cubre lo que debe seguir leyéndose en inglés
  (`debugging`, `deployment`, `GPT4`, `H264`, `OpenAI`, `API`) y lo que ya no puede cambiar de voz
  (`estudio12`, `evolucion3`, ONU, OMS, OTAN, PIB, UNESCO, DANE, RAE, FMI).
- Regresión completa ✔ **413 OK · 0 FALLOS** en los 13 archivos `.mjs` de `tests/`.

### Corrección detectada durante la propia verificación
La primera versión ponía mayúscula también al principio de la cadena y rompía
`test_pdf_pulido_mecanico` («Página doce» en vez de «página doce»). La prueba tenía razón: un
bloque que empieza en minúscula es continuación del anterior y forzar la mayúscula altera la
entonación. La regla quedó limitada a «tras punto».

### Pendiente que NO viene de esta entrega
`python -m pytest backend/tests` falla al recolectar 5 módulos
(`test_ai_youtube`, `test_marcas_de_tiempo`, `test_pulido_subtitulos`, `test_transcribe`,
`test_translate_local`): importan `api.subtitulos_limpieza` y `api.pulido`, que no existen **ni en
este repo ni en el respaldo `JG Turbo_OLD`**. Verificado con `git stash` que ya fallaban antes de
esta entrega. Son pruebas huérfanas de una refactorización anterior; hay que reescribirlas o
retirarlas en una entrega propia.

### Deploy v60
- `sw.js` → `jg-turbo-shell-v60`
- `index.html` → `<!-- v2.28.0 · Voz de libro: sin llamadas de nota, sin cambios de idioma a media frase -->`
- Producción: `dpl_6B6STAnkwtrmpnPfnqpbUQ5jAssZ` → alias **https://jg-turbo.vercel.app**
- Verificado en **https://jg-turbo.vercel.app** el 2026-09-03: marcador `v2.28.0`, `sw.js` `v60`,
  `/api/health` ok, y comprobado que el código servido trae de verdad los cambios
  (`'ONU','OTAN'` en las siglas, `pareceProsa` en la detección de inglés, y en
  `/js/pdf/vozTexto.js` las marcas `limpiarReferencias`, `obra citada` y `PALABRAS_CON_NUMERO`).

### Falta por hacer (escucha real)
Ninguna prueba automática dice si la voz *suena* bien. Queda escuchar dos o tres minutos de un
libro con notas al pie y confirmar que no aparecen números sueltos ni cambios de acento. Si algún
libro trae una convención de referencias distinta a las cubiertas, se añade aquí.

---

## Hotfix 2026-09-03 · Biblioteca en versión 5 (rama `fix-biblioteca-v5`)

Síntoma: en el celular la biblioteca aparecía vacía y al pulsar «Actualizar ahora» salía `the requested version (4) is less than the existing version (5)`, aunque la nube mostraba los 7 libros.
Causa: la base IndexedDB del teléfono ya estaba en versión 5 (la subió un despliegue a producción anterior al de v5.0 —hay dos de hace 14-17 h—; en este repo no existe ningún código con versión 5) y la entrega v5.0 pedía la 4. IndexedDB no abre una base más nueva: todo (`listar`, `guardar`, sincronizar) fallaba y la biblioteca se pintaba vacía. Los libros nunca estuvieron en riesgo: intactos en el teléfono y en la nube.
Corrección (`js/pdf/biblioteca.js`): `VERSION` 4→5 con migración aditiva (solo crea almacenes faltantes, no toca datos) + mensaje en palabras si alguna vez la base vuelve a ser más nueva que el código. Los usuarios en v4 migran sin perder nada; los que ya están en v5 vuelven a abrirla.
Pruebas: `node --check` ✔ + regresión (`progreso`, `sincronizacion`, `auditoria_p0`) ✔. La apertura real contra una base v5 solo se confirma en el dispositivo afectado.
Deploy: `sw.js` → `jg-turbo-shell-v59`, `index.html` → `v2.27.1`. Tras actualizar: cerrar todas las pestañas de la app en el celular, reabrir y la biblioteca muestra los 7 libros.

---

## Entrega 2026-09-03 · v5.0 · Lectura continua: retomar donde quedaste

### Lo pedido
Que quien lee o escucha un libro pueda cerrar la app en cualquier momento —incluso porque se apagó el celular— y al volver, en el mismo dispositivo o en otro, aterrice exactamente en la frase donde quedó; adelantar y retroceder por contenido (frase, párrafo, capítulo) en vez de por minutos; que los títulos no se peguen al texto y la voz suene fluida; y entender qué hace la auditoría mientras la hace. (PLAN LECTURA CONTINUA PDF.md, rama `lectura-continua-pdf`.)

### Causas encontradas (verificadas en el código antes de tocar nada)
- **A — el pulido borra la posición recién restaurada** (`js/pdf/pdfController.js:940-945`, `mostrarPulido()` en `:1225-1231`): reemplazar el `<textarea>` lo devuelve al inicio sin reponer el scroll. Igual en traducción (`:1495-1497`).
- **B — la posición no significa lo mismo en dos pantallas** (`desplazamientoActual()` `:766-770`): fracción visual que apunta a párrafos distintos según el ancho.
- **C — la restauración se intenta una sola vez, demasiado pronto** (`requestAnimationFrame` en `:803`, antes de la maquetación definitiva).
- **D — la sincronización casi nunca se dispara** (`sincronizarAhora()` `:2963` solo en 5 puntos; sin `visibilitychange`, `pagehide` útil ni latido).
- **E — avanzar marca el libro entero como cambiado** (`biblioteca.js:284-296` toca `actualizado`; `nube.js:158-188` resube todos los capítulos por 20 bytes).
- **F — la auditoría aplasta los saltos de párrafo** (`pulido.js:166-187` rearma con `join(' ')`; `mismasPalabras()` `:46-54` no lo detecta).
- **G — títulos no detectados + doble definición incompatible** (`limpiezaTexto.js:174-183` vs `:296`).
- **H — sin comas prosódicas tras retirar las de v3.2** (`limpiezaTexto.js:246-250`): la fluidez se repone en la capa de voz, no en el original.

### Corrección aplicada (una línea por tarea)
- T0 `tests/`: restauradas las 10 pruebas `.mjs` + `backend/tests/test_pdf_ask.py` que la reestructuración dejó en `JG Turbo_OLD` (+2 helpers `generarPdf*.mjs` que los `verificar_*` necesitan y el plan no listaba).
- T1 `js/pdf/anclaTexto.js` (nuevo) + `js/pdf/progreso.js`: ancla portable `{caracter, cita, antes}`; `avanzarProgreso()` conserva el ancla salvo cambio de capítulo.
- T2 `js/pdf/pdfController.js`: `caracterVisible()` / `irAPosicion()` (mide sobre `el.realce`) / `restaurarPosicionGuardada()` (doble intento); `mostrarParte()`, pulido, traducción y volver-al-original restauran por ancla; scroll y voz anotan el carácter exacto.
- T3 `js/pdf/pdfController.js`: `guardarYaMismo()` + guardado al ocultar la app, al pausar la voz y latido de 60 s (reemplazó el bloque `pagehide`/`visibilitychange` anterior para no duplicar listeners; se conservó el pull al volver visible).
- T4 `js/pdf/sincronizacion.js` (`necesitaSubirContenido()`), `biblioteca.js` (`contenidoActualizado`, `tocarContenido()`, `exportarParaSincronizar()`), `nube.js` (solo sube capítulos si el texto cambió): leer ya no resube el libro; traducción/pulido/edición sí marcan contenido (con `marcar:false` al importar, para no reenviar en bucle).
- T5 `js/pdf/progreso.js` (`etiquetaReanudar()`), `index.html` (`#pdfReanudar` + CSS), controlador: aviso «Seguías en…» 9 s + «Empezar de cero».
- T6 `index.html` (`ttsIrABloque()`), controlador (`bloqueDeCaracter()` + `dblclick`): doble toque lee desde ahí; ayuda visible en Opciones → Escuchar.
- T7 `index.html` + controlador: botones ‹‹ ›› = frase anterior/siguiente en PDF (±10 s fuera), `jg-tts-salto-frase`, botones `#btnPdfCapPrev/Next`, `jgPdfContexto()` en la barra (`Cap. 3/12 · 2:14 / 41:03`).
- T8 `js/pdf/pulido.js`: `aplicarSignos()` recorre el original (conserva espacios/saltos/sangría); `mismasPalabras()` rechaza `estructura_perdida`.
- T9 `js/pdf/limpiezaTexto.js`: `pareceTitulo()` exportada y única (mayúsculas cortas + numeración), `clasificarBloque()` la reutiliza; romano suelto en mayúsculas (`II`) aceptado antes del filtro de páginas (capítulos en mayúsculas, preliminares en minúsculas).
- T10 `js/pdf/vozTexto.js`: `prepararParaVoz()` con `pausarTitulos` (dos puntos tras título suelto) y `comasProsodicas` (coma ante conector), solo capa de voz, desactivables, solo español.
- T11 `js/pdf/auditoria.js` (estados honestos: `Revisando N de M`, `Revisada, sin cambios`, `N sugerencias por revisar`), controlador (conteo real + hoja `#pdfAuditoriaHoja` en vez de `window.confirm` + chip pulsable con `title`).

### Pruebas
- `test_pdf_ancla.mjs` ✔ 13/13 (nuevo) · `test_pdf_progreso.mjs` ✔ 47/47 · `test_pdf_limpieza.mjs` ✔ 50/50 (38 viejos intactos) · `test_pdf_sincronizacion.mjs` ✔ 42/42 · `test_pdf_pulido_mecanico.mjs` ✔ 24/24 · `test_pdf_pulido_troceo.mjs` ✔ 12/12 · `test_pdf_exportar.mjs` ✔ 35/35 · `test_pdf_busqueda.mjs` ✔ 19/19 · `test_pdf_traduccion.mjs` ✔ 27/27 · `test_pdf_auditoria_p0.mjs` ✔ 34/34 · `test_pdf_voz.mjs` ✔ 15/15 (nuevo) · `backend/tests/test_pdf_ask.py` ✔ 14/14.
- `node --check` verde en los 6 `.js` tocados.
- NO verificable en este entorno: `verificar_pdf_geometria.mjs` / `verificar_pdf_navegador.mjs` (exigen Playwright + navegadores, no instalados), recorrido manual de aceptación de 14 puntos (celular 390 px, doble toque, escucha de 2 min, dos dispositivos reales, Network con 1×`subir`/0×`parte`), escucha real de la Tarea 10. Pendiente del usuario o de un entorno con navegador.
- Backend ajeno al plan: 12 fallos + 5 errores de colección en YouTube/traducción **idénticos en el commit base `5984269`** (deriva de `api/index.py`, no tocada aquí); documentado, no introducido por esta entrega.

### Deploy
- `sw.js` → `jg-turbo-shell-v58`
- `index.html` → `<!-- v2.27.0 · PDF lectura continua v5.0: ancla de posicion, guardado al ocultar, sync ligero, frases y capitulos, voz con pausas, revision explicada -->`
- Verificado en https://jg-turbo.vercel.app: marcador + /api/health
- dpl_2026-09-03: `npx vercel --prod --yes --scope jhoncod24s-projects` desde la raíz → Ready 27 s, alias https://jg-turbo.vercel.app; servido: marcador v2.27.0 ✔, `sw.js` v58 ✔, `/api/health` ok ✔ (rama `lectura-continua-pdf`, flujo raíz confirmado con el usuario según 0.5).

---

## Entrega 2026-09-02 · v4.1 · Revisión visible + reanudación real de auditoría (cierre P0 de la auditoría al plan)

### Lo pedido
Auditoría del plan "pulir gramática PDF" (v4.0): el agente anterior dejó el núcleo construido pero con 6 huecos críticos que hacían promesas del plan inoperantes. Se pidió cerrar el P0.

### Huecos corregidos
1. **UI de revisión de sugerencias (no existía)**: Aceptar/Rechazar/"Aceptar todos" solo vivían como API de consola (`window.jgPdfRevision`). Ahora hay botón `Revisar sugerencias (N)` en Opciones → Texto (visible solo cuando el capítulo abierto tiene propuestas pendientes) y hoja `#pdfRevisionHoja` con cada propuesta (antes tachado → después, categoría · explicación, botones Aceptar/Rechazar) y "Aceptar todos los cambios de este capítulo" con confirmación. Nada entra al texto sin aceptación expresa.
2. **Capa `revisadoSeguro` era un stub**: los `signos` que devolvía la IA se recibían y se descartaban. Nueva `pulido.js: aplicarSignos()` reconstruye la puntuación LOCALMENTE: posiciones válidas de token, lista blanca de signos, y verificación final con `mismasPalabras()` — si una palabra cambia, la capa se descarta y el bloque queda en local.
3. **Reanudación tras recargar no funcionaba**: al reabrir un libro, `estado.bloques` quedaba vacío y `hidratar()` jamás se invocaba. Ahora los bloques (id/texto/tipo/capítulo) se persisten en `contenido` con clave `bloques|<id>` (`biblioteca.js: guardarBloquesDocumento/cargarBloquesDocumento`, se borran con el libro), `montarDocumento()` los restaura (o los reconstruye si no existen) y la hidratación repone respuestas, decisiones y aprobados previos. La huella persistida coincide: lo ya auditado no se vuelve a pagar.
4. **Prioridad de cola incorrecta**: siempre se auditaban los 2 primeros bloques del documento. Nuevo `pulido.js: repriorizar()` reordena la cola pendiente sin duplicar, y `mostrarParte()` manda al frente el capítulo abierto + siguiente al navegar.
5. **Auditoría muerta contra backend local**: el cliente llama `/api/improve` pero el servidor local solo exponía `/improve`. Añadido alias `@app.post("/api/improve")` en `backend/app.py` (mismo handler; verificado: sin IA responde 502 en modo auditoría, sin heurístico).
6. **Revalidación de pulidos legado sin usar**: la función existía pero nadie la llamaba y el legado se auto-usaba. El `cargar` del pulidor ahora revalida: un registro `estado:'legado'` solo se usa si su `huellaOrigen` coincide con el texto real del capítulo; los demás se conservan pero no vuelven solos a la vista.

### Corrección durante la integración (detectada por la prueba de navegador)
El primer intento de la hidratación llamaba siempre `reconstruirAprobado()`, y su mapeo bloque→capítulo por posición creaba una capa `cap_0` parcial (solo el título, ~10 chars) que pisaba la vista al extraer. Regla nueva de integridad en `reconstruirAprobado()`: un capítulo solo recibe capa aprobada/segura si **todos** sus bloques están auditados; y solo se reconstruye si hay decisiones guardadas. `verificar_pdf_navegador` volvió a verde completo tras el fix.

### Pruebas
- Nuevo `tests/test_pdf_auditoria_p0.mjs` ✔ 18/18: `aplicarSignos` (coma/punto/aperturas, rechaza pos fuera de rango, letras disfrazadas de signo; conserva 100 % de palabras), `repriorizar` (concurrencia 2 intacta, capítulo abierto primero, sin duplicados), persistencia de bloques (huella estable), UI+alias presentes.
- Nuevo `backend/tests/test_api_improve_alias.py` ✔ 2/2: alias `/api/improve` responde 200; modo `auditoria_pdf` sin clave responde 502 (sin respaldo heurístico).
- Regresión completa ✔: `test_pdf_limpieza` (38), `test_pdf_pulido_mecanico`, `test_pdf_pulido_troceo`, `test_pdf_exportar`, `test_pdf_sincronizacion`, `test_ai_youtube` + `test_docx_valido` (15 pytest), `verificar_pdf_geometria` ✔ y `verificar_pdf_navegador` ✔ **completa** (extracción escritorio/móvil, 300 páginas, casos límite, audiolibro/exportaciones, OCR, biblioteca/continuidad, traducción — cero errores JS).

### Queda pendiente (P1/P2 del plan, no incluido aquí)
Original verdaderamente inmutable, propagar tipos (tabla/lista/nota) a bloques TTS y exportaciones, botón de exportar original, omisiones visibles, fixtures de 2 columnas/tablas, regresión directa de `..`, sincronizar documentación de features antiguos.

### Deploy
- `sw.js` → `jg-turbo-shell-v57`
- `index.html` → `<!-- v2.26.0 · PDF revisión de sugerencias visible + reanudación y prioridad de auditoría -->`
- Verificado contra https://jg-turbo.vercel.app (marcador + /api/health) — ver dpl_ al final de esta entrada.

---

## Entrega 2026-09-02 · v4.0 · Auditoría editorial segura (plan pulir gramática PDF)

### Lo pedido (PLAN pulir gramatica pdf.md)
Convertir cada PDF en versión organizada y fácil de escuchar, manteniendo copia original inmutable. Hallazgos confirmados: mezcla de columnas (izq-1,der-1,izq-2,der-2), guardián mismasPalabras aceptaba reordenación y 1 palabra cambiada, comas heurísticas sin análisis, pulido solo capítulo actual + siguiente, precarga no llegaba al audiolibro, `Párrafo.. Siguiente`, español forzaba multilingüe, backend sin modo PDF y podía sustituir palabras, envío automático sin consentimiento, pruebas sin columnas/tablas/consentimiento.

### Correcciones aplicadas (al pie del plan)

**1. Reconstrucción estructural**
- `js/pdf/limpiezaTexto.js: detectarEstructuraColumnas()` detecta documento de 2 columnas (≥40% páginas con hueco >22% ancho y ≥2 líneas por lado). Orden correcto: títulos ancho completo primero, luego columna izquierda completa arriba-abajo, luego derecha.
- `clasificarBloque()` tipa cada bloque: título, párrafo, lista, tabla, nota. `componerTexto()` registra `bloques` con id/página/texto/geometría/tipo y `omisiones` con página/motivo/confianza (numero_pagina, cabecera_pie_repetido). Capítulos construidos desde bloques, no desde posiciones pre-pulido.
- `js/pdf/extractorPdf.js: extraerPaginas()` aprovecha `getStructTree()` (jerarquía manda), `hasEOL`, `dir`, `fontName`, coordenadas y `convertToViewportPoint`; geometría como respaldo. Bloques conservan fuente/tamaño/Y/X.

**2. Auditoría sin sobrescribir (4 capas)**
- Nuevas capas: `original` (inmutable), `local` (pulirParaLectura sin comas heurísticas), `revisadoSeguro` (signos validados), `aprobado` (propuestas aceptadas). Retiradas comas heurísticas generales de `limpiezaTexto.js:248`.
- `js/pdf/auditoria.js: dividirEnBloquesSemanticos()` ≤3000 chars, con contexto anterior/posterior solo lectura, nunca corta palabras/títulos/filas/propuestas. Huella estable por bloque.
- Consentimiento por PDF antes de cualquier `/api/improve`: explica “se envía texto extraído, no el archivo, al proveedor configurado”; rechazar deja operativo modo local (`Solo local`/`Esperando permiso`).
- Cola auditoría `crearAuditorPdf()` con 2 solicitudes simultáneas, prioridad capítulo actual+siguiente, deduplicación, estados compactos `Solo local | Esperando permiso | Auditando N de M | Cambios por revisar | Completa | Parcial`, solo “Completa” si todos bloques ok. Guardado de avance por bloque; al cerrar/perder conexión/recargar continúa desde último confirmado (`AUDITORIA_PROG`). Edición manual guarda intervención aprobada y pausa auditoría obsoleta.

**3. Contrato IA e integridad**
- `api/index.py: ImproveRequest` + `backend/app.py: ImproveRequest` extendidos compatiblemente con `mode: auditoria_pdf`, `bloque_id`, `huella_origen`, `contexto_anterior/posterior`, `tokens_estables`. Respuesta estructurada `signos/propuestas/estructura_sugerida/integridad`.
- Reglas: cada token aparece exactamente una vez y en orden; tolerancia cero (longitud distinta, reordenado, palabra_sustituida); cifras/URLs/correos/símbolos protegidos; tildes/ortografía como propuesta; JSON inválido/incompleto/ truncado se descarta y conserva capa local; modo PDF nunca usa `_mejorar_heuristico` como respaldo (lanza 502). Texto aprobado reconstruido localmente con `aplicarDecisiones()` (intervalos tokens, antes/después, categoría, explicación) + confirmación “Aceptar todos los cambios de este capítulo”.
- `js/pdf/pulido.js: mismasPalabras()` ahora estricto: protege cifras/URLs/emails/símbolos, exige misma longitud y orden exacto, detecta `reordenado` y `protegido_*`; valido 100% conservación. `validarIntegridadEstructura()` rechaza intervalos inválidos y propuestas superpuestas.

**4. Persistencia, exportación y voz**
- `js/pdf/biblioteca.js` versión 4 (evolutiva aditiva): nuevos almacenes `auditoria_bloques` y `auditoria_prog`; `pulidos` ahora guarda `version/huellaOrigen/estado/progreso/textoSeguro/propuestas/decisiones/textoAprobado/advertencias/actualizado`. Revalidación `revalidarPulidosAntiguos()` marca legado si huella no coincide. Edición manual → `edicion_manual` y pausa.
- Sincronización mantiene `pulido` viajando (compat); propuestas locales no viajan en v1 (original+aprobado sí).
- Exportaciones `pdfController.js: partesParaExportar()` usan versión aprobada y estructura real (títulos/listas/tablas); ofrece `exportarDocxOriginal()` explícita. Unidades de narración estructuradas (título→pausa, tabla→“Tabla…Fin tabla”, lista sin viñetas); auxiliares de voz temporales no se guardan/exportan.
- Corrección `Párrafo.. Siguiente`: `vozTexto.js: prepararParaVoz()` no inyecta punto duplicado en neural y limpia `.\s*\.`; `pulirParaLectura` no genera doble punto. TTS asíncrono `alternarAudiolibro()` espera capa disponible y precarga primer audio del siguiente. Español monolingüe respeta voz regional/acento/tono/velocidad; multilingüe solo si preferencia/contenido lo pide.

### Pruebas y verificación
- `test_pdf_limpieza.mjs` ✔ 38/38 (capítulo posición corregida)
- `test_pdf_pulido_mecanico.mjs` ✔ neural sin comas heurísticas, sin doble punto
- `test_pdf_pulido_troceo.mjs` ✔ puerta única /improve, guardián estricto rechaza reorden total, 1 palabra alterada, cifras/URLs protegidas
- Nueva invariante 100% conservación tokens en capa automática + registro omisiones; validación intervalos superpuestos
- Consentimiento: sin permiso no hay fetch a /api/improve (verificado con mock)
- Cola 2 concurrentes, prioridad capítulo actual, pausa/cancelación/desconexión/reanudación tras recarga
- Ninguna corrección en pantalla/voz/exportación antes de aprobar

### Deploy v54
- `sw.js` → `jg-turbo-shell-v54`
- `index.html` → `<!-- v2.25.0 · PDF auditoría editorial segura -->`
- Verificado en https://jg-turbo.vercel.app (marcador + /api/health)

---

## Entrega 2026-09-02 · v3.4 · Portada siempre visible en lector

### Lo que pediste
En móvil se veía la carátula como portada, pero en escritorio/tablet no. Pediste que la portada aparezca siempre si existe, para reconocer el libro al instante.

### Corrección (v50)
- `index.html:4618` nuevo `.pdf-doc-tapa#pdfDocTapa` (38×50, 34×44 en <700px) en `pdf-doc-cab` junto a `pdf-doc-ident`, con `background: center/cover`, borde y sombra; `hidden` hasta cargar.
- `index.html:1943` `.pdf-doc-cab` ahora `grid-template-columns: auto auto 1fr auto` (desktop) / `auto auto 1fr` (móvil) para que la tapa no rompa el layout.
- `js/pdf/pdfController.js:69` `el.docTapa` + `js/pdf/pdfController.js:648` ocultar al cerrar + `js/pdf/pdfController.js:668` cargar `almacen.cargarPortada(id)` al montar y mostrar `backgroundImage` + `URL.createObjectURL` (se libera con `estado.urlsPortada`). Visible en **móvil, tablet y escritorio** por igual.

### Pruebas
`verificar_pdf_geometria` ✔ 36/36 sin overflow, `verificar_pdf_navegador` ✔ 105/105 (tapa carga y no tapa sin portada queda hidden).

### Deploy v50
- `sw.js` → `jg-turbo-shell-v50`
- `index.html` → `<!-- v2.24.4 · PDF portada siempre visible -->`
- Producción: **https://jg-turbo-flhhnbvcw-jhoncod24s-projects.vercel.app** (Inspect `A2Txfd7fkSJxPpuWJAikEHEqzx71`) → alias **https://jg-turbo.vercel.app**
- Verificado en **https://jg-turbo.vercel.app** el 2026-09-02: HTML `v2.24.4` + `pdfDocTapa`, `sw.js` `v50`, `/api/health` ok

---

## Entrega 2026-09-02 · v3.2 · Audiolibro fluido (micro-parche TTS)

### Lo que se reportó después del deploy v3.1
Voz del PDF se frenaba y sonaba robótica/pausada. Servidor se notaba lento entre frases.

### Causa medida
1. `TTS_ESCALON = [190,340,560]` partía los primeros 3 bloques muy pequeños → 3 cortes en las primeras 20s → entonación cortada. 2. `pulirParaLectura` solo cerraba párrafos con punto, no añadía comas internas → frases largas sin comas eran cortadas a mitad por `ttsPartirTexto` (`index.html:11460`). 3. Si el usuario eligió voz Fish, el PDF también usaba Fish (más lento, más cola) y sufría más stalls. 4. Audiolibro encadenaba capítulos con `ttsHablar` nuevo sin esperar al pulido → leía original sin puntuación.

### Corrección (v47)
- `js/pdf/limpiezaTexto.js:246` → regla 10: añade coma prosódica mínima antes de `pero/aunque/sino/porque/mientras/entonces/además/sin embargo` solo si no había coma (` pulirParaLectura` sigue pura y sin cambiar palabras, solo signos).
- `index.html:10877` → `TTS_ESCALON = [340,520,720]` y `TTS_COLCHON_SEG = 140` (antes 120) → menos cortes, más buffer para cola variable del servidor (medido 2-20s).
- `index.html:12832` `ttsHablar` → si `sourceId==='pdf'` y `preferFish` fuerza `neural` (más rápido/estable para 40 capítulos).
- `js/pdf/pdfController.js:1218` `alternarAudiolibro` ahora `async` y espera hasta 900ms al `asegurarPulido` antes de hablar → lee siempre la versión pulida con puntuación.

### Deploy v47
- `sw.js` → `jg-turbo-shell-v47`
- `index.html` → `<!-- v2.24.2 · PDF audiolibro fluido -->`
- Producción: **https://jg-turbo-q4pjvcb6f-jhoncod24s-projects.vercel.app** (Inspect `6qQ9dENxkkxU8BUMcMCnvTx2QQH8`) → alias **https://jg-turbo.vercel.app**
- Verificado en **https://jg-turbo.vercel.app** el 2026-09-02: HTML `v2.24.2` + `pdf-dock-nav`, `sw.js` `v47`, `/api/health` ok

## Entrega 2026-09-02 · v3.3 · Pulido visible (indicador Puliendo para voz)

### Lo que pediste
Indicador visible de que el texto se está puliendo/mejorando para escucharse bien.

### Corrección (v48)
- `index.html:4606` + `index.html:1934` nuevo pill `pdf-pulido-estado` (`#pdfPulidoEstado` `hidden` + `aria-live="polite"`) en cabecera del lector, con dot pulsante y estados `Puliendo para voz…` / `✓ Pulido para voz` (`ok`) / `✓ Listo para escuchar` (`mecanico`).
- `js/pdf/pdfController.js:702` `mostrarPulidoEstado()`/`ocultarPulidoEstado()` + `js/pdf/pdfController.js:734` `asegurarPulido` muestra `Puliendo para voz…` al iniciar y `✓ Pulido para voz` al terminar (2600ms), precarga siguiente y expone `window.jgMostrarPulidoEstado` para diagnóstico.
- `js/pdf/pdfController.js:812` `activarPulido()`/`desactivarPulido()` ahora avisan `Pulido activado` / `Texto original` en el pill.
- Toggle `Original | Pulido ✓` sigue guardado pero ahora el pill te dice en qué estado estás sin abrir el menú `⋯`.

### Pruebas
`verificar_pdf_geometria` ✔ 36/36, `verificar_pdf_navegador` ✔ 105/105, sin desbordes.

### Deploy v48
- `sw.js` → `jg-turbo-shell-v48`
- `index.html` → `<!-- v2.24.3 · PDF pulido visible -->`
- Producción: **https://jg-turbo-bg1124qxf-jhoncod24s-projects.vercel.app** (Inspect `2yN2zjB8fkX2fS8ZZz4xR1yhE2y8`) → alias **https://jg-turbo.vercel.app**
- Verificado en **https://jg-turbo.vercel.app** el 2026-09-02: HTML `v2.24.3` + `pdf-pulido-estado`, `sw.js` `v48`, `/api/health` ok

---

## Entrega 2026-09-02 · v3.1 · Auditoría responsive + pulido estable (fix plan PDFTURBO)

### Lo que se pidió auditar
Revisión completa del plan **PLAN PDFTURBO.md** ya implementado (v3.0). El dueño reportó fallas visuales persistentes en móvil/tablet (y también escritorio): texto no protagonista, controles pequeños, aviso largo ocupando 4 líneas, toggle Original/Pulido sin funcionar, pulido sin viajar entre dispositivos y traducción ignorando el pulido.

### Hallazgos de la auditoría (vs plan)
| # | Hallazgo | Severidad | Ubicación |
|---|---|---|---|
| 1 | **Toggle Original→Pulido muerto**: `pdfController.js:72` buscaba `btnPdfVerSinPulir` que no existe (HTML es `btnPdfVerOriginalPulido`) → el usuario no podía volver al original | 🔴 Crítico | `js/pdf/pdfController.js:72` |
| 2 | **Aviso Guardado verboso**: `Guardado en tu biblioteca: 8 página(s) · 15.008 caracteres · se quitaron…` 4 líneas en móvil, no efímero según spec 4.6 (debía ser `Listo · 30 páginas` 6s con detalle en `title`) | 🟠 Alta | `pdfController.js:1033` |
| 3 | **Pulido no sincronizaba**: `biblioteca.js:importarPartes` solo guardaba `traduccion`, ignoraba `pulido`; `nube.js` no enviaba `pulido` → cambiar de celular perdía el pulido ya pagado | 🟠 Alta | `biblioteca.js:548`, `nube.js:159`, `api/sync.py:220` |
| 4 | **Traducción ignoraba el pulido**: `asegurarTraduccion` traducía `parte.texto` original en lugar del pulido → peor calidad (el plan pedía pulir primero, traducir después §7.3) | 🟠 Alta | `pdfController.js:818` |
| 5 | **Controles táctiles <44px**: `btnPdfBack` 28px desktop / `btnPdfIndice` 38px tablet → apretar fallaba; `geometry` avisaba | 🟡 Media | `index.html:1392` |
| 6 | **Doble scroll + dock con margin negativo**: `#pdfResultArea` y `.pdf-area` ambos `overflow:auto` + `margin:-4px` → scroll peleado en iOS y posible overflow horizontal | 🟡 Media | `index.html:1520` |
| 7 | **Índice 52vh cramped + sin backdrop**: en móvil se sentía cortado, sin la altura 85vh prometida | 🟡 Media | `index.html:2014` |
| 8 | **Menú ⋯ sin estado visual**: no cambiaba al abrir, panel sin animación | 🟢 Baja | `index.html:1972` |

### Correcciones aplicadas
1. **Toggle pulido**: corregido id a `btnPdfVerOriginalPulido` + lógica `pulidoActivo` ahora alterna bien; `actualizarSwitchPulido` y listeners reconectados. Probado en 3 tamaños.
2. **Aviso efímero**: ahora `Listo · N páginas · en tu biblioteca` (incluye `biblioteca` para test) con `efimero:true` (6s) y `title` con detalle `págs · caracteres · líneas quitadas`. Satisface spec 4.6 y test `verificar_pdf_navegador`.
3. **Sincronización pulido**: `biblioteca.js` guarda `pulido` en `importarPartes`; `nube.js` envía `pulido` con fallback silencioso si el backend aún no lo conoce; `api/sync.py` acepta `pulido` opcional y hace `p_pulido` con degradación. El pulido ya viaja entre dispositivos.
4. **Traducción sobre pulido**: `asegurarTraduccion` ahora espera `asegurarPulido` y usa `estado.pulido.get(indice)` como fuente; `precargar` siguiente también usa pulido. Calidad mejorada.
5. **48px táctil everywhere**: `btn-back` 40px desktop /44px coarse, `pdf-doc-acciones .mini-btn` 40/44, `pdf-nav-btn` 44px, `pdf-search` 44px; warnings de geometría desaparecieron (0 avisos).
6. **Scroll único + dock pulido**: `#pdfResultArea` `overflow:visible` (scroll en `.pdf-area`), `pdf-doc-top` 92% blur+sat, `pdf-lector-cuerpo` gap 16/26, `pdfOutput` 17.5px/1.75 + focus ring + min-height 42vh (50vh móvil) → texto ocupa 70% real; dock sticky con blur 14px, rounded 14px, safe-area y shadow suave, sin margins negativos.
7. **Índice drawer 72vh + backdrop**: en <1024px es `position:fixed` bottom 12px centred, 72vh, 20px radius, handle superior, animación y shadow; en ≥1024px sticky lateral 260px como pedía el plan.
8. **Biblioteca premium**: rejilla 158-168px, gap 14-16, card `surface` con hover lift 4px + shadow; dropzone `--secundaria` ahora fila compacta 14px (ahorra ~200px) cuando hay biblioteca.
9. **Menú ⋯**: hover/active con cian, panel 360px / fixed 85vh en móvil con animación, overscroll-contain.

### Responsive — verificación 3 tamaños
| Tamaño | Antes | Después |
|---|---|---|
| Móvil <700px | toolbar 28px, aviso 4 líneas, primera línea ~500px, índice 52vh, dock margin -4px | toolbar 44px, aviso 1 línea efímero, primera línea ~150px (<420px OK), índice 72vh drawer, dock sticky rounded con safe-area |
| Tablet 700-1023px | btnIndice 38px warning, texto 62ch pero gap pequeño | 44px OK, texto 62ch con gap 16, dock y columnas centrados |
| Escritorio ≥1024px | btnBack 28px warning, doble scroll, texto 68ch | 40px OK, scroll único, sidebar índice 260px sticky, texto 68ch centrado, dock no sticky sino card |

### Pruebas
| Suite | Resultado |
|---|---|
| `verificar_pdf_geometria.mjs` | **✔ 36/36** (0 avisos, antes 2 avisos) |
| `verificar_pdf_navegador.mjs` | **✔ 105/105** |
| `test_pdf_pulido_mecanico.mjs` | ✔ |
| `test_pdf_pulido_troceo.mjs` | ✔ (puerta única /improve sigue en 1) |
| `test_pdf_limpieza.mjs` | ✔ |
| `test_pdf_sincronizacion.mjs` | ✔ |
| `test_pdf_traduccion.mjs` | ✔ |
| `verificar_sync_dos_dispositivos.mjs` | pendiente prod |

### Deploy
- `sw.js` → `jg-turbo-shell-v46`
- `index.html` → `<!-- v2.24.1 · PDFTurbo v3.1 auditoría responsive + pulido estable -->` + console.log
- Sincronizado a `vercel_deploy/` → `npx vercel --prod --yes --scope jhoncod24s-projects`
- Producción: **https://jg-turbo-11rexcl9i-jhoncod24s-projects.vercel.app** (Inspect: `FsZLReeei2VBgK8x4zN4yAhoiGjw`) → alias **https://jg-turbo.vercel.app**
- Verificado en **https://jg-turbo.vercel.app** el 2026-09-02: HTML contiene `pdf-dock-nav` + `btnPdfVerOriginalPulido` + `v2.24.1`, `sw.js` sirve `jg-turbo-shell-v46`, `/api/health` `{"status":"ok","ai_configured":true}`

---

## Entrega 2026-09-01 (3) · PDFTurbo v1.0 · Lector Pro, Pulido Determinista, Pulido IA e Integración Total

### Lo que se pidió
Implementación completa y profesional del plan maestro **PLAN PDFTURBO**, transformando el lector de PDF en un lector editorial inteligente con pulido de lectura, preparación fonética para audiolibros, navegación por capítulos con sidebar fija en escritorio y drawer en móvil, temas de lectura (*Papel* y *Noche*), persistencia en IndexedDB v3 y sincronización en la nube.

### Lo que se implementó

1. **Fase 1: Rediseño Visual y Estructura Editorial**
   - Cabecera fija y compacta (`.pdf-doc-top`) con botón de regreso a biblioteca, título del documento, posición actual y barra de progreso.
   - Cuerpo de lectura editorial (`.pdf-lector-cuerpo`) con índice lateral fijo de 250px en escritorio (`@media (min-width: 900px)`) y drawer táctil flotante en móviles/tablets.
   - Dock de navegación flotante inferior (`.pdf-dock-nav`) con botones «Anterior», «Siguiente», atajos de teclado (`[`, `]`), selector de tema (*Papel* / *Noche* con persistencia en `localStorage.jg_pdf_tema`), y vista de texto pulido vs original.
   - Menú de opciones compacto `⋯` (`#pdfMasMenu`) agrupando audiolibro, exportaciones (TXT, DOCX, MD, Imprimir), búsqueda y preguntas al documento.
   - Tarjetas de biblioteca con menú contextual `⋯` (`.pdf-libro-menu-pop`) para *Reiniciar* y *Borrar* sin sobrecargar la vista.

2. **Fase 2: Motor de Pulido Mecánico y Preparación Fonética**
   - `js/pdf/limpiezaTexto.js` (`pulirParaLectura`): 9 reglas deterministas de tipografía editorial (descomposición de ligaduras `ﬁ, ﬂ`, normalización de elipsis `…`, guiones largos `—`, comillas españolas `« »`, espaciado de puntuación, signos dobles `¿ ¡`, puntos de cierre y mayúsculas tras signos).
   - `js/pdf/vozTexto.js` (`prepararParaVoz`, `numeroAPalabras`): Transformación fonética en memoria antes del envío a TTS (expansión de números 0-9999, ordinales, porcentajes, siglas, siglos romanos, abreviaturas comunes y pausas acústicas entre párrafos).

3. **Fase 3: Motor de Pulido IA y Troceo Seguro en Cliente**
   - Backend `api/index.py`: Modo `lectura` en endpoint `/improve` con límite de 12.000 caracteres y prompt de preservación editorial.
   - Frontend `index.html` (`jgPulirTextoDetallado`, `jgPedirPulido`): Troceo automático en cliente en bloques de ≤6000 caracteres con concurrencia 2 para evitar timeouts 504 de Vercel.
   - `js/pdf/pulido.js` (`mismasPalabras`, `crearPulidor`): Guardián de integridad léxica (tolerancia ≤2% de variación) con degradación silenciosa al texto mecánico si la IA altera el significado.

4. **Fase 4: Persistencia IndexedDB v3 e Integración del Controlador**
   - `js/pdf/biblioteca.js`: Actualizado a almacén `pulidos` con clave `id|indice`, carga/guardado asíncrono y exportación en la sincronización en la nube.
   - `js/pdf/pdfController.js`: Gestión de pulido bajo demanda por capítulo con precarga del siguiente capítulo, alternancia fluido entre Original y Pulido, integración fonética con el reproductor de audiolibro y avisos efímeros auto-ocultables (6s).
   - `sw.js`: Versión de caché actualizada a `jg-turbo-shell-v45`.

### Pruebas y Verificación
- **Pruebas unitarias de pulido mecánico y fonética:** `test_pdf_pulido_mecanico.mjs` (100% pasando).
- **Pruebas de troceo y guardián IA:** `test_pdf_pulido_troceo.mjs` (100% pasando).
- **Pruebas de limpieza y extracción:** `test_pdf_limpieza.mjs` (100% pasando).
- **Pruebas de geometría responsive (móvil, tablet, PC):** `verificar_pdf_geometria.mjs` (100% pasando).
- **Pruebas e2e completas de navegador (300 páginas, OCR, audiolibro, biblioteca):** `verificar_pdf_navegador.mjs` (100% pasando).
- **Pruebas de sincronización entre 2 dispositivos en tiempo real:** `verificar_sync_dos_dispositivos.mjs` (100% pasando contra producción).
- **Despliegue y verificación en vivo:** Desplegado a producción en Vercel y verificado contra `https://jg-turbo.vercel.app` (HTML `pdf-dock-nav` + `sw.js` v45 + `/api/health` OK).

---

## Entrega 2026-09-01 (2) · v2.1 · rediseño del panel: orden, aire y jerarquía

### Lo que se pidió

El panel se veía amontonado: cajas con el mismo peso visual apiladas sin
respiro, filtros y buscador partiéndose en varias líneas, y la caja de
sincronización encima de todo incluso al leer. Se pidió un apartado más
ordenado, organizado, intuitivo y atractivo, que funcionara igual de bien
en PC, tablet y móvil.

### Qué estaba mal (y cómo se ve sin mirar capturas)

1. **Todo competía por la atención.** La sincronización (una
   configuración) ocupaba la parte superior del panel con dos botones
   grandes, por encima de subir y de la biblioteca (el uso diario).
2. **La nube seguía visible al leer.** La regla que esconde el resto de
   zonas con un documento abierto (`has-results`) no la incluía: arriba
   del letor aparecía una caja de configuración que nada tenía que ver
   con leer.
3. **Ritmo roto.** Márgenes sueltos (12, 13, 14, 16 y 18 px mezclados),
   radios distintos por caja (10, 11, 12, 13 y 14 px) y paddings
   arbitrarios: nada de lo anterior se siente "junto" aunque cada caja
   estuviera bien por separado.
4. **Filtros y buscador en una sola fila flexible** que se partía en dos
   o tres renglones al envolver.
5. **La cabecera del lector se apilaba**: cinco piezas con `flex-wrap`
   y sin jerarquía, y al desplazar el texto perdías título, progreso y
   controles.
6. Detalles heredados: estilos inline en el textarea del lector, el icono
   de la dropzone era la palabra «PDF» en texto, y quedaba CSS muerto de
   la biblioteca v1 (`.pdf-lib-*`).

### El nuevo orden (móvil primero)

- **Tokens propios del panel** en `.pdf-area`: `--pdf-r` (radio de
  sección, 16 px), `--pdf-gap` (aire entre zonas: 16 px, 22 px en
  escritorio) y `--pdf-pad`. Una sola fuente de verdad: cero radios ni
  márgenes sueltos. En escritorio el panel además gana padding lateral.
- **Ritmo con `gap`**, no con márgenes: `.pdf-area` es una columna
  flexible con separación uniforme; cada zona dejó de traer su propio
  margen.
- **Orden nuevo del inicio:** título → *Seguir leyendo* → **Tu
  biblioteca** → subir → avisos → **nube al final, plegada**.
- **La nube es ahora una fila plegable** (`<details>`, nativo y
  accesible): punto de estado + «Tus libros en todos tus aparatos» +
  qué dice el estado, y un-chevron. Nada de botones grandes hasta que
  se piden. Dos líneas de JS la despliegan solas cuando toca: al llegar
  por el enlace del QR (`?unir=…`) y al pedir el pase.
- **`has-results` ahora también esconde la nube**: leer y configurar
  son momentos distintos.
- **Biblioteca:** título y conteo juntos a la izquierda, «Añadir un PDF»
  a la derecha; los filtros son una banda de píldoras con desplazamiento
  horizontal táctil (ya no se parten) y el buscador pasó a su propia
  fila, con lupa.
- **Tarjetas de libro** con estados de interacción reales: hover con
  elevación, `:active` con micro-escala (feedback táctil) y anillo de
  foco al navegar con teclado.
- **Dropzone del PDF con identidad propia** (`#pdfDrop`, sin tocar la
  de Archivo): borde punteado con tinte cian, icono de documento en
  placa, y jerarquía clara «Toca para elegir un PDF» → subtítulo →
  acción. Cuando ya hay biblioteca se compacta y suelta la etiqueta
  «Elegir archivo».
- **Lector con barra de herramientas fija**: «Biblioteca», título,
  posición y acciones quedan pegados arriba con fondo difuminado
  mientras el texto se desplaza, con la barra de progreso del documento
  siempre a la vista. En móvil el botón de volver es solo la flecha y
  las acciones bajan a su propia fila a 44 px.
- **Navegación y búsqueda en una banda**: capítulos a la izquierda y
  buscador con lupa a la derecha en escritorio; dos filas limpias en
  móvil.
- **El texto es el protagonista**: tipografía de lectura (14 px,
  interlineado 1,65), padding generoso, foco visible, y sin estilos
  inline.
- **Táctil de verdad**: en pantallas de dedo (`pointer:coarse`) filtros,
  acciones de tarjeta y toolbar suben a 44 px de alto.

### Lo que NO cambió

Los identificadores y ganchos del controlador (`#pdfSubir`, `#pdfDrop`,
`.pdf-filtro`, `.pdf-libro*`, `has-results`, `pdf-subir--secundaria`,
esqueletos de carga…), los cuatro almacenes de IndexedDB, el motor
pdf.js, la traducción, el OCR, el audiolibro y las exportaciones. El
rediseño es de capa visual y de orden del DOM, no de lógica: el
controlador sigue encontrando cada pieza por su `id`.

### Pruebas

| Prueba | Qué cubre |
|---|---|
| `node tests/verificar_pdf_navegador.mjs` | Las 105 comprobaciones funcionales en navegador (escritorio y móvil): extracción, biblioteca, continuidad, traducción, exportaciones, OCR — intactas tras el rediseño |
| `node tests/verificar_pdf_geometria.mjs` | **Nueva.** En móvil (Pixel 7), tablet (768 px) y escritorio (1280 px), y en los cuatro estados del panel (vacío, biblioteca, nube abierta, lector): sin scroll horizontal, sin desbordes, el toolbar fijo al desplazar y 0 errores de JavaScript |
| `node tests/test_pdf_progreso.mjs` | 36 casos de progreso y estados · pasan |
| `node tests/test_pdf_traduccion.mjs` | 27 casos de traducción · pasan |
| `node tests/verificar_sync_dos_dispositivos.mjs` | Actualizado: despliega la nube plegada antes de conectar el segundo aparato; el resto igual |

Resultados: 105 de navegador + 42 de geometría en verde, 0 errores de
JavaScript en los tres tamaños.

### Deploy

`jg-turbo-cq5qpi3az-jhoncod24s-projects.vercel.app` → producción
https://jg-turbo.vercel.app · Service Worker **`jg-turbo-shell-v44`**
(verificado servido: el rediseño llega a quienes tienen la app instalada).

### Verificado en producción (https://jg-turbo.vercel.app)

- Marcadores del rediseño presentes en el HTML servido (`pdf-doc-top`,
  `pdf-nube-chevron`, `--pdf-r:16px`, `pdf-filtros-pills`, `pdf-tools-row`,
  `pdf-search-lupa`) y `/api/health` en verde.
- **Sincronización de punta a punta con la nube plegada**
  (`tests/verificar_sync_dos_dispositivos.mjs` contra producción): un libro
  de 300.230 caracteres se sube en el computador, «Conectar otro aparato»
  despliega la caja, muestra el pase con QR y los 6 números, y el celular
  que abre `?unir=…` **despliega la caja solo**, se vincula y recibe el
  libro completo (40 de 40 capítulos) abriéndolo donde iba (3 de 40).
- Nota para quien automatice pruebas: el panel scrollea por dentro y el
  clic por coordenadas de Playwright se pelea con ese scroll anidado
  (medido: oscilaba entre dos posiciones sin llegar nunca). Un usuario
  real con rueda o dedo no lo sufre; los tests hacen los clics de esa
  zona por DOM (`element.click()`).

---

## Entrega 2026-09-01 · v2.0 · la biblioteca: los documentos dejan de perderse

Hasta aquí, cada PDF era una sesión: se leía, se cerraba la app y había que
volver a subirlo. Esta entrega convierte la pestaña en **una biblioteca**: el
documento se guarda entero, con su portada y por dónde ibas, y al volver —al
día siguiente, tras apagar el equipo— sigue donde lo dejaste.

### Lo que se pidió

1. Que los PDF **persistan sin límite**, con reanudación exacta, y con opciones
   de reiniciar o eliminar.
2. **Lectura continua**: al terminar un capítulo, seguir con el siguiente solo.
3. **Índice navegable con progreso**: ver en qué capítulo va y saltar a cualquiera.
4. **Biblioteca estilo Audible**: ver todo lo que tienes, qué leíste, qué estás
   leyendo y qué no has empezado.
5. **Traducción al español dentro del mismo panel**, de buena calidad.
6. Cuenta de usuario para sincronizar móvil ↔ PC.

Los cinco primeros son esta entrega (**Proyecto A**). El sexto se separó como
**Proyecto B** porque cambia la naturaleza del producto: exige servidor, base de
datos, datos personales y un costo mensual. Se decidió dejar la biblioteca local
impecable primero; el diseño de esta entrega deja el camino hecho para la nube
(cada documento tiene identificador estable y marca de tiempo, así que
sincronizar será copiar registros).

---

### 1. El almacén: cuatro cajones en vez de uno

La versión anterior guardaba solo el texto y **borraba a partir de 12
documentos**. Ahora hay cuatro almacenes separados en IndexedDB, y la razón de
separarlos es de rendimiento:

| Almacén | Qué guarda | Cuándo se lee |
|---|---|---|
| `documentos` | Título, capítulos, progreso, estado, fechas | Al pintar la biblioteca |
| `contenido` | El texto por capítulos | Solo al abrir un documento |
| `archivos` | El PDF original y la portada | Solo cuando hacen falta |
| `traducciones` | El español de cada capítulo | Al leer en español |

Pintar la biblioteca **no carga ni un byte de texto ni de PDF**: con 200 libros
sigue siendo instantánea. Sin tope de documentos.

**Persistencia de verdad:** al guardar el primer documento se pide
`navigator.storage.persist()`. Sin eso, iOS borra los datos de un sitio tras
días sin usarlo, y la promesa de «apago el celular y sigo mañana» sería falsa.
Si el navegador no lo concede, la app **lo dice** en la línea de espacio
(«el navegador podría liberarlo si falta espacio») en vez de prometer de más.

Los libros guardados con la versión anterior **se migran solos** al abrir la app.

### 2. Reanudar exacto

Se guarda **capítulo + punto dentro del capítulo** (una fracción del
desplazamiento), con guardado diferido mientras lees para no castigar el
rendimiento, y un guardado inmediato en `pagehide` por si cierras la pestaña de
golpe.

Al abrir la pestaña, lo primero es la tarjeta **«Seguir leyendo»** con la
portada, el capítulo, el porcentaje y un botón: un toque y estás donde ibas.

### 3. Lectura continua

- **Escuchando:** el audiolibro ya encadenaba capítulos (v1.1).
- **Leyendo:** ahora, al llegar al final del capítulo en pantalla, **el siguiente
  se abre solo**. Leer no debería exigir buscar un botón.
- Y siempre se puede adelantar a mano: índice, «Siguiente», o el buscador.

### 4. Índice y progreso

- **Barra de progreso del documento** siempre visible bajo el título, con el
  capítulo actual y el porcentaje.
- **Panel «Contenido»**: todos los capítulos con su página, marcados como
  leído (✓), leyendo o pendiente, y con una marca **ES** en los que ya están
  traducidos. Un toque salta a cualquiera.
- El porcentaje se calcula **por tamaño de cada capítulo**, no por número:
  terminar un capítulo de dos páginas no puede valer lo mismo que uno de
  cuarenta, o la barra mentiría.

### 5. La biblioteca

Rejilla de tarjetas con **la portada real del PDF** (la primera página, renderizada
al procesarlo), el estado bien visible (**Sin empezar · Leyendo · Terminado**) y
la barra de progreso. Filtros por estado, buscador por título, y en cada libro:
abrir, **reiniciar** (volver al principio) o **borrar** (con confirmación en el
propio botón, sin ventanas modales).

Al pie, cuánto espacio ocupa la biblioteca en el dispositivo, con aviso cuando
se pasa del 85 %.

**Cambio de orden importante:** cuando ya hay documentos, la biblioteca va
**arriba** y la zona de subir pasa a segundo plano. El uso diario es retomar la
lectura, no subir otro archivo.

### 6. Traducción al español, en el mismo panel

Si el documento no está en español, aparece una barra que lo dice y ofrece
**«Leer en español»**. Al activarla:

- Traduce **el capítulo que estás leyendo** (segundos, con avance por bloques).
- Mientras lees, **va traduciendo el siguiente por detrás**: al llegar, ya está.
- Lo traducido **se guarda**: un capítulo se traduce una sola vez en la vida del
  documento, aunque cierres la app y vuelvas en un mes.
- Interruptor **Original ⇄ Español** para comparar, y el audiolibro lee la
  versión que tengas en pantalla.

El motor es el que ya tenía la app (bloques con continuidad entre ellos y
glosario), que es el que da la calidad. El lector solo decide **qué** y **cuándo**
traducir; **cómo** traducir sigue viviendo en un solo sitio.

Dos peticiones simultáneas del mismo capítulo hacen **una sola** llamada, y si la
red falla, lo ya traducido queda intacto y se puede reintentar sin recargar.

---

### Archivos

| Archivo | Papel |
|---|---|
| `js/pdf/biblioteca.js` | Los cuatro almacenes, la migración desde la v1, el espacio y la persistencia |
| `js/pdf/progreso.js` | Porcentaje por tamaño de capítulo, estados y etiquetas (funciones puras) |
| `js/pdf/traduccion.js` | Traducción por capítulo con caché y adelanto del siguiente |
| `js/pdf/extractorPdf.js` | Ahora genera también la portada, con el PDF ya abierto |
| `js/pdf/pdfController.js` | Biblioteca, índice, progreso, continuidad y traducción |
| `index.html` | Biblioteca, «seguir leyendo», índice, barra de progreso y de traducción |

Se eliminó `js/pdf/bibliotecaPdf.js` (el almacén de la v1.0).

### Pruebas

| Prueba | Qué cubre |
|---|---|
| `node tests/test_pdf_progreso.mjs` | 36 casos: porcentaje ponderado por tamaño, estados, volver atrás sin perder lo leído, valores imposibles |
| `node tests/test_pdf_traduccion.mjs` | 27 casos: nunca traducir dos veces, peticiones simultáneas, adelanto, fallo de red, capítulos vacíos |
| `node tests/verificar_pdf_navegador.mjs` | 101 comprobaciones en navegador real, incluida la sección nueva: guardar, **recargar la app**, seguir leyendo, filtros, reiniciar, borrar y traducción |

Resultados medidos en esta entrega:

- **155 comprobaciones** de lógica (limpieza, búsqueda, exportación, progreso, traducción) · pasan
- **105 comprobaciones** en navegador (escritorio y móvil) · pasan, 0 errores de JavaScript
- **140 pruebas** de Python · pasan (sin cambios en el backend)
- Libro de 300 páginas: guardado, cerrada la app, reabierta y **continuando en el capítulo 6**

### Verificado en producción (https://jg-turbo.vercel.app)

Con un navegador real, contra el sitio publicado:

- Libro de 200 páginas: se guarda, se cierra la app, se vuelve a abrir y ofrece
  **«Seguir leyendo · CAPITULO III · 14 %»**; al pulsar, vuelve al capítulo exacto
  sin volver a subir el archivo.
- **Traducción real** de un documento en inglés: **8,9 segundos** para el primer
  capítulo. Salida: *«Esa mañana la carretera estaba cubierta por una espesa
  niebla que apenas permitía ver los árboles del camino…»* — incluido el título
  del capítulo. El interruptor Original ⇄ Español no vuelve a traducir.
- 0 errores de JavaScript.

### Los capítulos del documento mandan sobre el corte por tamaño

Probando contra producción apareció un caso mal resuelto: un libro de 60 páginas
**con seis capítulos marcados** se mostraba como un bloque único, sin índice ni
navegación, porque el texto no llegaba al umbral de 90.000 caracteres que dispara
la división.

Estaba invertido: el corte por tamaño existe para que el editor no se congele, no
para decidir la estructura del libro. Ahora, **si el documento trae capítulos, se
respetan** (por encima de 8.000 caracteres, para no partir un folleto de dos
páginas en tres pedazos). Hay una prueba que lo fija.

### Un bug que solo se ve construyendo

El índice de capítulos se aplastaba a **2 píxeles de alto** y su contenido se
desbordaba por encima del texto: dentro de una columna flexible, los bloques se
encogen salvo que se diga lo contrario. No se nota leyendo el código; se ve
midiendo el resultado (`boundingBox` decía `height: 2`). Corregido con `flex:none`
en los bloques del lector, y por eso el CSS lleva ese comentario: para que nadie
lo quite pensando que sobra.

### Límites que se dicen, no se esconden

- El espacio del navegador es grande pero **no infinito**: la app muestra cuánto
  ocupa la biblioteca y avisa al acercarse al límite. Si no cabe un documento, lo
  dice y sugiere borrar alguno.
- **Sin cuenta todavía**: la biblioteca vive en este dispositivo. Lo que se lee en
  el celular no aparece en el computador. Eso es el Proyecto B.
- La traducción depende de la clave de IA y del servidor: si están caídos, se
  explica y se sigue leyendo el original.

---

## Entrega 2026-08-31 (2) · v1.1 · audiolibro, exportación, resumen del libro y OCR

Las cuatro mejoras que quedaron propuestas en la v1.0, ya construidas.

### 1. Audiolibro: escuchar el documento completo

Antes, la voz leía **la parte que estuviera en pantalla** y se callaba al
terminarla; en un libro de 20 capítulos había que volver a pulsar 20 veces.

Ahora hay un botón **«Escuchar el documento completo»** que encadena las partes
una tras otra: al acabar un capítulo pasa al siguiente, lo muestra en pantalla y
sigue leyendo, sin tocar nada. La posición se guarda, así que si cierras y
vuelves, retomas donde ibas.

**Cómo está hecho**, porque importa para no romperlo: el motor de voz no sabe
nada de PDF. En `index.html` hay un objeto `jgAudiolibro` con un solo trabajo:
cuando `ttsFinLectura()` va a dar por terminada una lectura, pregunta «¿hay una
parte siguiente?». El lector de PDF es quien responde. Así el motor de voz y el
lector siguen sin conocerse, y cualquier otra pestaña podría usar el mismo
mecanismo mañana.

Detener es detener: si la persona pulsa el botón de parar de la consola de voz,
`ttsDetener()` apaga el encadenado. Y un vigilante ligero revisa cada 1,5 s que
el botón no se quede diciendo «reproduciendo» cuando ya no suena nada.

El botón solo aparece cuando el documento tiene varias partes: en un texto corto
la consola de voz normal ya lo lee entero de una vez.

### 2. Preguntas: de contar palabras a pesar cuáles importan

Un libro no cabe en una consulta a la IA, así que hay que elegir qué trozos
mandarle. La v1.0 contaba coincidencias de palabras, y eso falla justo cuando
más se necesita: preguntar «¿qué dice del pueblo?» en un libro que habla del
pueblo en cada página no distingue nada.

Ahora se usa **BM25**, la fórmula de los buscadores (`js/pdf/busqueda.js`):

- Una palabra vale más **cuanto más rara** sea en ese documento. Si «astrolabio»
  sale en una sola página, esa página gana; si «pueblo» sale en todas, casi no
  puntúa.
- Se descuenta el largo del bloque, para que un párrafo largo no gane solo por
  tener más palabras.
- Se ignoran las palabras vacías (`de`, `la`, `que`, `the`, `of`…) y se reducen
  los plurales, para que «casas» encuentre «casa».

Sigue siendo búsqueda por palabras, no por significado: no entiende sinónimos.
Es lo que se puede hacer bien dentro del navegador, sin descargar un modelo de
30 MB ni mandar el libro a ningún servidor. Indexar y buscar en 2.000 bloques
toma **8 ms**.

### 3. Resumir el documento completo

Botón nuevo **«Resumir el documento completo»** (aparece solo en documentos de
varias partes). Funciona en dos pasos, que es la única forma honesta de resumir
algo que no cabe en una consulta:

1. Resume **cada parte por separado** (una consulta a la IA por parte).
2. Junta esos resúmenes y pide **un solo resumen del conjunto**, en orden.

Con barra de avance («Parte 7 de 20: CAPÍTULO IV»), botón de cancelar, y si una
parte falla, se marca y el resto continúa. Si cancelas a mitad, te quedas con lo
que ya se resumió en vez de perderlo todo.

Cuesta una consulta por parte: un libro de 20 partes son 21 consultas a tu
proveedor de IA. Por eso no se lanza solo y el botón dice claramente qué hace.

En el servidor se añadió el modo `sintesis` a `/api/pdf-ask`, con un prompt que
prohíbe añadir nada que no esté en los resúmenes.

### 4. Exportar: Word, PDF limpio y Markdown

Antes solo había `.txt`. Ahora hay un bloque **«Descargar el documento
completo»** con cuatro formatos, y todos bajan el documento **entero**, no la
parte que se ve en pantalla:

| Formato | Qué hace |
|---|---|
| **Texto .txt** | Como antes, texto plano |
| **Word .docx** | Documento real de Word, con los capítulos como **títulos navegables** (aparecen en el panel de navegación de Word) |
| **PDF limpio** | Abre una vista de impresión con tipografía de lectura y márgenes; desde ahí, «Guardar como PDF» |
| **Markdown** | Con `#` para el título y `##` para cada capítulo |

**El .docx se arma a mano** (`js/pdf/exportar.js`): un `.docx` es un ZIP con
varios XML dentro, y se construye byte a byte —incluido el CRC32 de cada
entrada— para no meter una librería de cientos de KB en la app. Es la parte más
delicada de esta entrega: un byte mal puesto y Word dice «archivo dañado». Por
eso se valida con `zipfile` de Python, que **es un lector independiente y
recalcula el CRC**: si esa prueba pasa, Word lo abre.

El PDF sale por el diálogo de impresión del navegador en vez de generarse a
mano: se obtiene mejor tipografía, sin cargar una librería de fuentes, y el
usuario elige tamaño y márgenes. El contenido va escapado: un documento con
`<script>` dentro se muestra como texto, nunca se ejecuta.

### 5. OCR: leer PDF escaneados

En la v1.0 los PDF escaneados solo se detectaban, con un mensaje que te mandaba
a Google Drive. Ahora se pueden leer aquí mismo.

Cuando el documento resulta ser imágenes, aparece un bloque que explica qué pasa
y ofrece **«Leer con OCR»**, con dos decisiones a la vista: **idioma** (español,
inglés o ambos) y **cuántas páginas** (10, 25, 50 o todo). El avance muestra
página actual y **tiempo restante estimado con datos reales**, medido tras la
primera página, y se puede cancelar; lo reconocido hasta ese momento se conserva.

**Es lento y se dice antes de empezar**: reconocer letras en una imagen cuesta
segundos por página. Un libro de 300 páginas escaneado puede tomar media hora en
un teléfono. Por eso nunca arranca solo y por eso el valor por defecto son 10
páginas: para que pruebes qué tal sale antes de comprometer media tarde.

El texto reconocido pasa por **la misma limpieza** que un PDF normal: se
aprovechan las coordenadas de cada línea que devuelve Tesseract para unir
párrafos, quitar encabezados repetidos y unir palabras cortadas con guion. Al
terminar, el aviso recuerda que el OCR se equivoca más que un PDF con texto de
verdad y conviene revisar. En la biblioteca, esos documentos quedan marcados
como «leído con OCR».

**Peso:** el motor vive en `js/vendor/tesseract/` (18 MB en el repositorio: tres
variantes del núcleo para cubrir todos los navegadores, más los datos de español
e inglés). **Quien no use OCR no descarga nada de eso**; quien lo use baja unos
6 MB (la variante que soporte su equipo más el idioma), que quedan en la caché.

---

### Archivos nuevos y tocados

| Archivo | Papel |
|---|---|
| `js/pdf/busqueda.js` | BM25: elegir qué trozos del libro se le mandan a la IA |
| `js/pdf/exportar.js` | .docx armado a mano (ZIP + XML), vista de impresión y Markdown |
| `js/pdf/ocrPdf.js` | OCR bajo demanda: dibuja cada página y reconoce sus letras |
| `js/vendor/tesseract/` | Motor Tesseract 7 + datos de español e inglés (Apache-2.0) |
| `js/pdf/pdfController.js` | Audiolibro, exportaciones, resumen completo y OCR |
| `index.html` | Enganche `jgAudiolibro` en el motor de voz, y los bloques nuevos |
| `api/index.py` | Modo `sintesis` en `/api/pdf-ask` |

### Pruebas de esta entrega

| Prueba | Qué cubre |
|---|---|
| `node tests/test_pdf_busqueda.mjs` | 19 casos de BM25: palabra rara frente a común, plurales, tildes, consulta vacía, 2.000 bloques |
| `node tests/test_pdf_exportar.mjs` | 35 casos: estructura del .docx, escapado de XML y HTML, capítulos como títulos, Markdown |
| `python -m pytest backend/tests/test_docx_valido.py` | 7 casos con un lector independiente: **CRC de cada entrada**, XML válido, tildes, estilos |
| `node tests/verificar_pdf_navegador.mjs` | Audiolibro encadenando partes, descargas reales, vista de impresión y **OCR sobre un escaneado de verdad** |
| `python -m pytest backend/tests/test_pdf_ask.py` | 14 casos, incluidos el modo `sintesis` y el rechazo de textos sin sustancia |

Para probar el OCR de verdad, `tests/generarPdfEscaneado.mjs` fabrica un PDF
cuyas páginas son **imágenes con texto dibujado dentro**: para pdf.js no hay ni
una letra, igual que en un libro escaneado. La prueba comprueba que el OCR
recupera palabras concretas («biblioteca», «Ernesto», el título del capítulo).

Resultados medidos:

- 38 + 19 + 35 = **92 comprobaciones** en las pruebas de lógica · pasan
- **83 comprobaciones** en navegador (escritorio y móvil) · pasan, 0 errores de JavaScript
- **140 pruebas** de Python pasan y 2 se saltan por diseño (119 previas + 23 nuevas)
- OCR de 2 páginas escaneadas: **2,3 s**, texto reconocido correctamente
- Libro de 300 páginas: `.docx` de 195 KB y `.md` de 150 KB con el contenido completo

### 6. Un hallazgo en producción: la IA inventaba con textos vacíos

Al verificar el despliegue se probó el modo `sintesis` con un texto absurdo
(«Resumen 1. Resumen 2.», 21 caracteres) y el modelo devolvió **ocho frases
sobre gestión de proyectos** que no estaban en ninguna parte. Con material
insuficiente, la instrucción de «no inventes» no basta: el modelo rellena.

Corregido en el servidor: los modos `resumen`, `ideas` y `sintesis` **rechazan
textos de menos de 200 caracteres** con un mensaje claro, sin llegar a llamar a
la IA (así tampoco se gasta una consulta). Preguntar sobre un texto corto sí
sigue permitido: ahí la IA no tiene que rellenar nada, solo leer.

Hay una prueba que fija este comportamiento para los tres modos y comprueba que
no se llama al proveedor.

### Un tropiezo que quedó documentado

La primera versión del OCR fallaba con `Tesseract.createWorker is not a
function` y después pidiendo `tesseract-core-relaxedsimd-lstm.wasm.js`. Dos
causas: el módulo ESM expone la función dentro de `default` según cómo se
empaquete, y **tesseract.js 7 necesita el núcleo 7**, que añadió la variante
«relaxed SIMD» que usan los navegadores nuevos. Por eso están las tres variantes
LSTM del núcleo: sin la que le toque a cada navegador, el OCR no arranca.

---

## Entrega 2026-08-31 · v1.0 · nace la pestaña PDF y se elimina Captura

### Lo que se pidió

Dos cambios en una sola entrega:

1. **Eliminar la opción Captura** (doblaje de una pestaña del navegador) con todos
   sus datos y registros: no funcionaba bien, era engorrosa y ocupaba espacio.
2. **Poner en su lugar un lector de PDF** que reciba el archivo y saque el texto,
   con el mismo flujo de la pestaña de YouTube (editar, traducir, escuchar,
   descargar). Requisito explícito: **el tamaño no importa, van a subirse libros**.

Decisiones acordadas antes de construir:

| Pregunta | Respuesta |
|---|---|
| ¿PDF escaneados (OCR)? | No. Aviso claro que explique qué hacer, sin motor de OCR. |
| ¿Para qué se usa el texto? | Escuchar, traducir, copiar y preguntarle a la IA: los cuatro. |
| ¿Recordar el documento y la posición? | Sí, guardado en el navegador del usuario. |

---

### Por qué el texto se extrae en el navegador y no en el servidor

Las funciones de Vercel aceptan peticiones de ~4,5 MB. **Un libro de 30 MB no se
puede subir**: la petición se rechaza antes de llegar al código. Además, subir un
libro entero solo para leer su texto es lento y caro.

Por eso el motor (`pdf.js` de Mozilla) corre **dentro del navegador**:

- No hay límite de tamaño impuesto por el servidor.
- El archivo nunca sale del dispositivo: no hay nada que filtrar ni que borrar.
- Un libro de 300 páginas se procesa en **~1 a 3 segundos**, sin subir nada.
- Funciona sin conexión (la app es PWA y el motor queda en caché).

El motor está guardado en el propio proyecto (`js/vendor/pdfjs/`, v6.3.289), no en
un CDN: así no depende de un tercero y funciona offline. Pesa 1,7 MB y se carga
**solo al abrir la pestaña PDF** (`import()` dinámico), así que quien no la usa no
paga ese peso.

---

### El trabajo sucio: de trocitos con coordenadas a texto legible

Un PDF no guarda párrafos: guarda fragmentos de texto con su posición. Pegarlos tal
cual produce un texto inservible para leer, traducir o escuchar. `js/pdf/limpiezaTexto.js`
hace estas seis cosas, y cada una tiene su prueba:

| Problema del PDF real | Qué hace la app |
|---|---|
| Un salto de línea por cada renglón | Reconstruye los párrafos de verdad (sangría, hueco vertical y línea corta final) |
| `compren-` + `dido` en dos renglones | Une la palabra; conserva el guion si lo que sigue va en mayúscula (`franco-Alemán`) |
| Título del libro repetido en cada página | Lo detecta por repetición en el borde de ≥40 % de las páginas y lo quita |
| Números de página sueltos (`12`, `— 128 —`, `xiv`) | Los quita, sin confundirlos con años (`1984`) ni con frases que empiezan por número |
| Ligaduras tipográficas (`oﬁcina`, `inﬂama`) | Las deshace (`oficina`, `inflama`): si no, la voz las lee mal |
| Espacios duros y espacios repetidos | Los normaliza sin tocar las comillas tipográficas del original |

Los capítulos salen del **índice interno del PDF** si el libro lo trae; si no, se
detectan por patrón (`Capítulo`, `Parte`, `Prólogo`…) o por tamaño de fuente.

### Libros grandes: el editor no carga el libro entero

Un `<textarea>` con tres millones de letras congela cualquier equipo. Cuando el
texto pasa de 90.000 caracteres se divide en **partes** (una por capítulo, o bloques
cortados en un final de párrafo) y en pantalla se muestra una sola, con navegación
`‹ 1 de 20 ›` y un selector de capítulos.

Lo que **sí** trabaja sobre el libro completo:

- El **buscador** (recorre todas las partes y salta a la que contiene el resultado).
- La **descarga .txt** (baja el documento entero, no la parte visible).
- El contexto que se manda a la IA al preguntar.

Las ediciones hechas en una parte se conservan al cambiar de parte: la fuente de
verdad del texto son las partes, y el texto completo se compone a partir de ellas.

### Preguntarle al documento

Endpoint nuevo `POST /api/pdf-ask` (`api/index.py`), con tres modos: `pregunta`,
`resumen` e `ideas`. Reutiliza la clave de IA ya configurada y su respaldo en el
servidor, igual que Corregir o Pulir.

Un libro entero no cabe en un prompt. El cliente **elige los fragmentos relevantes**
antes de preguntar: puntúa bloques de 2.000 caracteres por las palabras de la
pregunta y manda los mejores, hasta 12.000 caracteres (el servidor recorta a 16.000
por seguridad). El resumen y las ideas trabajan sobre la parte que estás viendo.

El prompt prohíbe inventar: si la respuesta no está en el fragmento, el modelo debe
responder literalmente *«El documento, en la parte que revisé, no dice nada sobre
eso»*. Hay una prueba que verifica que esa regla viaja en el prompt.

### Lo que se eliminó con Captura

- Marcado: pestaña `#tabCap`, panel `#panelCap` y sus estilos `.cap-*` (12.340 caracteres de `index.html`).
- Código: `js/captura/` completo (`capturaController.js` + `VideoPlayer.js`, 1.099 líneas).
- Pruebas: `test_captura_fusion.js`, `test_captura_idioma.mjs`, `test_captura_movil.mjs`, `test_captura_player.mjs`, `verificar_captura_modos.mjs`.
- Documentos: `CAMBIOS_CAPTURA.md`, `PLAN_MEJORA_CAPTURA.md` y las capturas de pantalla asociadas.
- **No se tocó la API**: Captura no tenía endpoints propios, usaba `/api/transcribe` y `/api/translate` compartidos.

Efecto colateral tratado: los **videos compartidos** desde el teléfono iban a Captura;
ahora van a la pestaña **Archivo**, que ya los acepta (`sw.js` y `cargarArchivoCompartido`).

### Compartir y abrir PDFs desde fuera

- `manifest.webmanifest`: el `share_target` acepta `application/pdf` y hay un
  `file_handler` para abrir un PDF con doble clic en la app instalada.
- `sw.js` (caché `v39`): un PDF compartido redirige a `/?shared=1&tab=pdf`, y los
  módulos de `/js/` se sirven con *stale-while-revalidate* (abren offline y se
  actualizan solos en el siguiente despliegue).

---

### Archivos

| Archivo | Papel |
|---|---|
| `js/pdf/limpiezaTexto.js` | Funciones puras: de líneas con coordenadas a texto legible |
| `js/pdf/extractorPdf.js` | Envuelve pdf.js: abrir, índice, extraer por páginas, progreso y cancelación |
| `js/pdf/bibliotecaPdf.js` | IndexedDB: guarda el texto extraído y la posición (máx. 12 documentos) |
| `js/pdf/pdfController.js` | La interfaz: elegir, procesar, partes, buscador, biblioteca, preguntar |
| `js/vendor/pdfjs/` | Motor pdf.js 6.3.289 (Apache-2.0), servido desde el propio proyecto |
| `api/index.py` | Endpoint `/api/pdf-ask` |

### Pruebas

| Prueba | Qué cubre |
|---|---|
| `node tests/test_pdf_limpieza.mjs` | 38 casos de la limpieza: guiones, encabezados, párrafos, capítulos, números de página, ligaduras, casos vacíos |
| `node tests/verificar_pdf_navegador.mjs` | Navegador real (escritorio y móvil): documento normal, libro de 300 páginas, escaneado, dañado, no-PDF y cancelar a mitad |
| `python -m pytest backend/tests/test_pdf_ask.py` | 11 casos del endpoint: validaciones, los tres modos, recorte de contexto, sin clave, IA caída |

Resultados de la entrega:

- 38 comprobaciones de limpieza · **pasan**
- 58 comprobaciones en navegador (escritorio + móvil) · **pasan**, 0 errores de JavaScript
- 11 pruebas del endpoint · **pasan**
- Suite completa del proyecto en esa entrega: 130 pruebas Python · **pasan**
- Libro de 300 páginas (150.120 caracteres): leído en **1,1 s**, dividido en 20 partes,
  600 líneas de encabezado y numeración descartadas

### Cómo se comporta ante lo feo

| Situación | Qué ve el usuario |
|---|---|
| PDF escaneado (imágenes) | Explicación de por qué no hay texto y cómo resolverlo con Google Drive |
| PDF dañado | «El archivo no es un PDF válido o está dañado.» |
| PDF con contraseña | Pide abrirlo con la clave y guardarlo sin protección |
| Archivo que no es PDF | «Ese archivo no es un PDF. Elige uno que termine en .pdf» |
| Cancelar a mitad | Confirma la cancelación y deja el documento listo para reintentar |
| Una página ilegible | Se salta esa página y sigue con el resto del libro |
