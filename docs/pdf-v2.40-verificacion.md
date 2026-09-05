# PDF v2.40.0: lector paginado y corrección conectada

Revisión del 5 de septiembre de 2026. Se retomaron los cambios sin terminar
en `index.html`, `libroVista.js` y `pdfController.js`, después de consultar los
planes de los cuatro agentes en `docs/superpowers/plans/` y su cierre v2.39.1.

## Fallos reproducidos y cambios

- El editor, la barra de edición y la hoja de cortes seguían ocupando altura
  aunque llevaban `hidden`. En escritorio el texto medía 0 px. El ocultamiento
  vuelve a aplicarse y las páginas se calculan con el espacio disponible.
- La lectura ocupa la pantalla, con navegación por páginas, índice accesible,
  apariencia, edición y reproductor. El tamaño disponible se recalcula al
  cambiar fuente, ancho, controles o tamaño de ventana.
- La posición se conserva por carácter, también dentro de un párrafo largo.
  Medir el diseño no sobrescribe el progreso guardado. Cerrar guarda el avance.
- La corrección se solicita desde Opciones. Abrir un PDF no muestra la hoja de
  consentimiento. El permiso para enviar texto sigue siendo por documento.
- «Unir» llamaba a una función vacía y «Deshacer» no reconstruía el texto.
  Ambas acciones ahora reconstruyen, validan las letras, guardan y muestran
  el resultado. Las ediciones aprobadas bloquean la reconstrucción automática.
- Las decisiones de IA ahora recomponen el texto. Los cortes omitidos siguen
  pendientes, pero no bloquean la puntuación del resto del documento.
- Abrir, traducir o escuchar un capítulo ya no inicia otro pulido competidor.
  Esos recorridos consultan revisiones guardadas compatibles con la fuente.
- La cola calcula su propia huella a partir de sus partes. Al reabrir se
  restaura la confirmación de guardado: no vuelve a marcar como pendientes
  partes terminadas ni repite solicitudes de IA para ellas.
- Se guardan átomos, decisiones y posiciones en el almacén existente de
  contenido. Los libros anteriores recuperan geometría del PDF local cuando
  se solicita corrección. Se mantiene la versión de IndexedDB.
- Vincular el original comparaba el hash del archivo con el hash del texto,
  y llamaba a un método de almacenamiento inexistente. Se valida la huella del
  archivo y se guarda conservando portada, contenido y progreso.

## Verificación local

- 21 suites PDF y la suite de narración: salida 0, 1.037 líneas OK. La nueva
  suite de decisiones agrupa ocho aserciones en una línea: 1.044 comprobaciones.
- Backend PDF: 18 pruebas aprobadas.
- `verificar_pdf_paginas.mjs`: carga un PDF de 24 páginas en 320, 390, 768 y
  1440 px. Comprueba altura útil, ausencia de desborde vertical, reproductor
  visible, paso de página, cambio de letra, edición, consentimiento, decisiones
  manuales, deshacer, puntuación con cortes pendientes, persistencia, reapertura,
  índice y vinculación del PDF. También prueba un párrafo de 6.300 caracteres.
- `verificar_pdf_lector_integracion.mjs`: 27 comprobaciones aprobadas, incluidos
  lectura desde un punto y resaltado de voz. El sonido se simula en esta prueba.
- `verificar_pdf_navegador.mjs`: recorrido completo aprobado, con marcador final.
- Verificaciones finales de geometría: 114 comprobaciones; scroll de biblioteca
  y otras pestañas: 39 comprobaciones. Ambas con salida 0.
- `test_pdf_reales.mjs` sobre el PDF privado de 431 páginas: 23.650 átomos,
  793.112 caracteres y 1.068 límites pendientes. La prueba verifica patrones
  concretos y conservación de letras; no demuestra ausencia de todo error editorial.

Las respuestas de IA de la prueba de navegador son simuladas. La calidad de
corrección de un proveedor real y la escucha humana no se deducen de esa prueba.
Los PDF privados y las capturas de prueba no se incluyen en el despliegue.

## Publicación

Publicada, con autorización explícita del usuario, en https://jg-turbo.vercel.app.
Versión v2.40.0, módulos v80 y shell v80.

- Despliegue: `dpl_3EpViMULsw7FFzi6mZoPiqsNsRid`, estado `READY`, producción.
- URL inmutable: https://jg-turbo-1o29aqk0v-jhoncod24s-projects.vercel.app.
- Los 27 módulos de `js/pdf/`, `index.html` y `sw.js` coinciden byte por byte
  con la copia local, comprobados por SHA-256 en el dominio público.
- `/api/health`: HTTP 200.
- `verificar_pdf_paginas.mjs` contra producción: salida 0 en los cuatro tamaños,
  incluyendo corrección simulada, Unir/Deshacer, reapertura sin nuevas peticiones,
  ausencia de aviso falso de pendientes, vinculación y párrafo largo.
- `verificar_pdf_lector_integracion.mjs` contra producción: 27 comprobaciones,
  salida 0 y sin errores JavaScript.
- Se revisaron las capturas reales de escritorio y móvil.

El despliegue usó una copia temporal de los archivos productivos de la raíz
actual, vinculada al mismo proyecto. No incluyó `.env`, PDF privados, pruebas
ni capturas. La copia evita recorrer `.pytest_cache`, cuyo acceso está denegado
en este equipo. No se utilizó código del respaldo `JG Turbo_OLD`.

## Cierre en Git y recomprobación (2026-09-05)

La publicación quedó verificada, pero el repositorio no: `origin/main` estaba en
v2.38.0 (`30e83c9`), catorce commits por detrás de producción, y `js/pdf/huella.js`
—que `libroVista.js`, `pdfController.js` y `colaCorreccion.js` importan— no existía
en GitHub. Se avanzó `main` con `merge --ff-only` desde
`fix/pdf-paginacion-y-correccion` y se empujó: `30e83c9..c31a967`, sin forzar.
El proyecto de Vercel no tiene integración con GitHub, así que el push no creó
ningún despliegue: producción sigue en `dpl_3EpViMULsw7FFzi6mZoPiqsNsRid`.

Medido después del push, no antes:

- 23 suites de Node: **1.077 líneas OK, 0 fallos** (la referencia de v2.39.1 eran
  ~1.000; menos habría significado una corrida cortada).
- `index.html`, `sw.js` y los **27** módulos de `js/pdf/`: SHA-256 idéntico entre
  el disco y `https://jg-turbo.vercel.app`.
- `/api/health`: HTTP 200. Marcadores servidos: `v2.40.0`, `JG_JS_V=v80`,
  `jg-turbo-shell-v80`.
- `JG_BASE=https://jg-turbo.vercel.app node tests/verificar_pdf_paginas.mjs`:
  salida 0 en escritorio, tablet, móvil y 320 px, incluido el párrafo largo y la
  restauración por carácter.
- `JG_BASE=… node tests/verificar_pdf_lector_integracion.mjs`: salida 0, sin
  errores de JavaScript.
- Ningún módulo importado por `js/pdf/*.js` queda fuera de Git (comprobación de
  `TRAMPAS.md`).

- `JG_PDF_REAL=tests/private/becoming.pdf node tests/test_pdf_reales.mjs`: salida 0,
  con las mismas cifras de v2.39.1 — 431 páginas, 23.650 átomos, 793.112 caracteres,
  1.068 límites pendientes y 3 guiones no resueltos (`1962- author`, `alpha- and`,
  `five- and`: rango de año y guion suspendido del inglés, no particiones). El libro
  vive en `tests/private/`, ignorado por `.gitignore`: está en este equipo, no en el
  repositorio, así que la prueba se salta sola en un clon limpio.

Los 1.068 límites pendientes (4,5 %) siguen sin resolver a propósito: sin evidencia no
se adivinan y no bloquean la lectura ni la puntuación del resto. Quedan disponibles en
«Revisar cortes» para quien quiera decidirlos a mano.
