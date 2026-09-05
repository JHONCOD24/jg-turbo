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
