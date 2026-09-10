# Correcciones posteriores a la auditoría UX/UI del lector PDF v117

## Instrucción para el agente implementador

Implementa únicamente las correcciones descritas en este documento. No propongas un rediseño nuevo, no cambies la lógica de negocio y no reabras decisiones ya aprobadas que funcionan correctamente.

La prioridad absoluta es corregir las dos regresiones críticas del lector PDF:

1. La carga inicial puede fallar después de una actualización por una mezcla de módulos nuevos y antiguos almacenados en caché.
2. En móvil, el texto paginado queda físicamente debajo del encabezado y de la paginación.

Después corrige las duplicaciones del encabezado, la composición de Apariencia y el corte de la pestaña Micrófono. Conserva el modo Organizar, la nueva jerarquía de voz, el acceso a Contenido, los estados de sincronización y todas las mejoras visuales existentes.

Antes de editar, lee completos:

- `Agents.md`
- `TRAMPAS.md`, especialmente §1, §3, §4, §8 y §9
- `CAMBIOS_PDF.md`
- `CONFIG_PERSISTENTE.md`
- `PLAN_UX_UI_PDF_IMPLEMENTACION_LLM.md`

No renombres claves de persistencia, no cambies la extracción local con PDF.js, no modifiques el motor TTS y no alteres el protocolo de sincronización.

## Estado de la auditoría

La implementación revisada corresponde a la versión UX/PWA v117. El modo Organizar, la agrupación de voz, el panel Contenido y la explicación del botón Traducir muestran mejoras reales. No deben reemplazarse ni simplificarse de nuevo.

La entrega no puede considerarse cerrada hasta resolver PDF-FIX-01 y PDF-FIX-02. Las demás correcciones son acotadas y deben realizarse en la misma tanda, con un solo incremento de versión y caché al final.

## Plan de corrección

| Orden | ID | Prioridad | Área | Problema confirmado | Cambio mínimo requerido | Archivos probables | Criterios de aceptación verificables | Pruebas obligatorias | Riesgo |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | PDF-FIX-01 | Crítica | PWA y carga del lector | En la primera entrada a producción apareció «No se pudo cargar el lector de PDF». La consola informó que `./progreso.js` no exportaba `etiquetaSeccion`. Una recarga recuperó el lector. El archivo actual sí exporta esa función, lo que indica una combinación de módulos de versiones distintas. | Hacer coherente y atómica la actualización del grafo de módulos del lector. Las dependencias importadas por módulos versionados no pueden resolverse desde una copia anterior. Aplicar la solución mínima compatible con el Service Worker actual y la carga dinámica. Añadir una prueba de actualización desde la caché inmediatamente anterior. | `index.html`, `sw.js`, `js/pdf/pdfController.js` y módulos importados por el lector. Confirmar el grafo antes de editar. | Una sesión con shell y módulos v117 almacenados abre la nueva versión al primer intento. No aparece error de exportación, mensaje de carga fallida, recarga manual ni necesidad de borrar datos. El modo sin conexión continúa funcionando después de que la versión nueva haya quedado instalada. | Prueba automatizada nueva de actualización v117→versión nueva; `verificar_arranque_ligero.mjs`; recorrido del lector; prueba online y luego offline. | Alto. Puede afectar actualización PWA y carga diferida. No convertir todos los recursos en carga inicial. |
| 2 | PDF-FIX-02 | Crítica | Geometría móvil | A 390×844, el encabezado termina aproximadamente en `y=68`, pero `#pdfLectura` comienza en `y=54`. La lectura llega hasta `y=800`, mientras `#pdfPaginacion` comienza cerca de `y=728`. La primera y la última línea quedan cubiertas. Las pruebas actuales pasan porque miden altura y overflow, no intersecciones. | Mantener una caja paginada estable entre modo normal e inmersivo, pero reservar dentro de ella el espacio realmente ocupado por encabezado, pie, paginación y zona segura. Ocultar o mostrar el cromo no debe cambiar página ni carácter ancla. Usar dimensiones calculadas, evitando nuevas constantes independientes. | `index.html`, `js/pdf/libroVista.js`, `js/pdf/pdfController.js`, `tests/verificar_pdf_movil.mjs`, `tests/verificar_pdf_paginas.mjs`, `tests/verificar_pdf_geometria.mjs`. | Con controles visibles, ninguna línea intersecta encabezado, pie, paginación o zona segura en 320×568, 390×844 y 430×932. La última línea se puede leer y seleccionar. Ocultar y recuperar controles conserva página y ancla. Avanzar mueve exactamente una página. No aparece scroll horizontal. Tablet y escritorio conservan su geometría. | Añadir aserciones de rectángulos y primera/última línea. Ejecutar `verificar_pdf_movil.mjs`, `verificar_pdf_paginas.mjs`, `verificar_pdf_geometria.mjs`, `verificar_pdf_scroll.mjs` y `verificar_movil_pantalla.mjs`. Prueba física obligatoria en un teléfono con barra del navegador expandida y contraída. | Alto. Puede alterar paginación, ancla y scroll. Medir antes y después. |
| 3 | PDF-FIX-03 | Alta | Encabezado y progreso | Se muestran frases duplicadas como «Página Página 1 de 7 de la sección» y «Cap. Sección 2 de 107». JavaScript ya produce frases completas, pero CSS todavía agrega los prefijos `Página` y `Cap.`. | Eliminar los prefijos generados que ya están incluidos en el texto de JavaScript. Conservar expresiones completas y con alcance: «Página X de Y de la sección», «X % del libro» y «~N min en esta sección». | `index.html`, especialmente `.pdf-pag-pos::before` y `#pdfNavPos::before`; `js/pdf/libroVista.js`; `js/pdf/pdfController.js`. | No aparece ninguna repetición de «Página», «Cap.» o la sección en desktop, tablet o móvil. El árbol accesible y el texto renderizado comunican la misma información. | Extender una prueba para inspeccionar texto renderizado y estilos generados, no solo `textContent`. Ejecutar pruebas de progreso, interfaz de lectura, páginas, móvil y voz. | Bajo. Evitar retirar un prefijo que todavía necesite otro contexto. |
| 4 | PDF-FIX-04 | Alta | Encabezado tablet | Al expandir el detalle en 768×1024, el título y la referencia física se comprimen entre las acciones y se fragmentan en varias líneas estrechas. | En el rango tablet, disponer contexto y acciones en dos filas cuando el ancho real no permita una composición legible. No ocultar el título completo ni la referencia física. Mantener una sola fila cuando haya espacio suficiente. | `index.html`; medición del encabezado en `js/pdf/libroVista.js` o `js/pdf/pdfController.js`. | A 768×1024 y 834×1112, un título largo se lee completo sin quedar comprimido entre botones. Ninguna acción se solapa o sale del viewport. Abrir y cerrar el detalle conserva el pasaje. | `verificar_pdf_geometria.mjs`, `verificar_pdf_paginas.mjs`, pruebas de menús y rotación tablet vertical/horizontal. | Moderado. Cambiar la altura exige remedir sin perder ancla. |
| 5 | PDF-FIX-05 | Media | Apariencia | En móvil, «Tamaño de letra (», el valor y «)» se distribuyen como elementos separados. Ocurre también con el interlineado. Los nombres accesibles de los deslizadores no incluyen el valor visible. | Componer cada etiqueta y su valor como una unidad visual estable. Asociar el valor actual al control mediante semántica accesible y actualizarlo al mover el deslizador. Conservar la fuente sans ya corregida y las preferencias existentes. | `index.html`, `js/pdf/libroVista.js`. | En 320 y 390 px, texto, paréntesis y valor no quedan aislados en líneas diferentes. Con teclado y puntero, el valor visible se actualiza. Un lector de pantalla anuncia nombre y valor actual. Recargar conserva la selección. | Prueba de Apariencia en desktop, tablet y móvil; teclado; tamaño de texto aumentado; recarga; comprobación del estilo calculado. | Bajo a moderado por repaginación. |
| 6 | APP-FIX-01 | Media | Pestañas móviles | A 320 px, «Micrófono» se parte dentro de la palabra y deja una letra aislada en una segunda línea. | Impedir cortes internos de palabra. Ajustar primero separación o padding y conservar icono sobre etiqueta, nombre completo, foco visible y objetivo táctil mínimo de 44 px. | `index.html`, estilos de `.tabs`, `.tab` y `.lbl`; `tests/verificar_pestanas.mjs`. | A 320, 390 y 430 px, las cinco pestañas muestran nombres completos sin elipsis, recorte ni corte dentro de una palabra. Con texto ampliado siguen siendo identificables y alcanzables. | `verificar_pestanas.mjs`, `verificar_movil_pantalla.mjs` y revisión visual de las cinco pestañas. | Bajo. Vigilar altura disponible para el contenido. |
| 7 | PDF-QA-01 | Alta | Validación pendiente | La organización se verificó en navegador, pero falta tacto real. Los estados de voz se simularon y falta un ciclo de audio real. Tampoco se documentó una comprobación con lector de pantalla. | Completar las validaciones pendientes después de corregir la interfaz. Corregir solo fallos reproducibles relacionados con las tareas aprobadas. | Sin archivo predeterminado. Registrar evidencia en el documento de cambios correspondiente. | Reordenamiento táctil con nueve libros funciona sin abrir tarjetas ni bloquear el scroll. Voz real prepara, reproduce, pausa, reanuda, detiene, finaliza y presenta un error legible. Cerrar ajustes no detiene audio. Contenido y overlays gestionan foco, Escape y retorno al disparador. | Teléfono físico; teclado completo; lector de pantalla en escritorio y móvil; ciclo real de TTS; modo inmersivo con mini reproductor. | Moderado. No usar esta validación para ampliar alcance. |

## Comprobaciones de regresión obligatorias

Además de las pruebas específicas modificadas, ejecutar desde la raíz del repositorio:

```text
node tests/test_pdf_ancla.mjs
node tests/test_pdf_progreso.mjs
node tests/test_pdf_voz.mjs
node tests/test_pdf_mejora_apartado.mjs
node tests/test_pdf_continuidad.mjs
node tests/verificar_pdf_geometria.mjs
node tests/verificar_pdf_scroll.mjs
node tests/verificar_pdf_navegador.mjs
node tests/verificar_pdf_movil.mjs
node tests/verificar_pdf_voz_acordeon.mjs
node tests/verificar_pdf_mini_flotante.mjs
node tests/verificar_pdf_paginas.mjs
node tests/verificar_pdf_menus.mjs
node tests/verificar_movil_pantalla.mjs
node tests/verificar_pestanas.mjs
node tests/verificar_arranque_ligero.mjs
```

Cuenta las comprobaciones y compara con la referencia anterior. Un proceso con menos comprobaciones no se considera válido aunque termine sin `FALLO:`.

## Matriz manual mínima

| Entorno | Tamaños mínimos | Comprobaciones |
| --- | --- | --- |
| Móvil pequeño | 320×568 | Primera y última línea visibles; pestañas completas; Apariencia legible; voz sin overflow; abrir y cerrar cromo sin cambiar ancla. |
| Móvil habitual | 390×844 | Repetir lo anterior; barra real del navegador expandida y contraída; reordenamiento con nueve libros. |
| Móvil grande | 430×932 | Zonas seguras, mini reproductor, Contenido y orientación. |
| Tablet vertical | 768×1024 y 834×1112 | Encabezado de dos filas cuando corresponda; título largo; voz; Contenido; cambio de orientación. |
| Tablet horizontal | 1024×768 | Aprovechamiento de ancho, ausencia de compresión y conservación del pasaje. |
| Escritorio | 1280×800 y 1440×900 | Encabezado, teclado, foco, voz, actualización PWA y modo Organizar. |

## Elementos que deben preservarse

- Portadas originales y vistas Portadas/Compacta.
- Estados «Leyendo» y «Sin empezar».
- Progreso del libro, tiempo de la sección, página visual y referencia física bajo demanda.
- Ocultamiento de controles inferiores durante la lectura.
- Caja paginada estable y conservación del ancla.
- Modo Organizar temporal con Guardar y Cancelar.
- Reordenamiento alternativo mediante botones y teclado.
- Voz plegada por defecto, «Desde aquí» y «Más ajustes».
- Mini reproductor y continuidad del audio al cerrar ajustes.
- Panel Contenido con sección actual, volver a la sección e ir al inicio.
- Extracción y almacenamiento local del PDF.
- Claves de IndexedDB y `localStorage`, sincronización y resolución de conflictos.
- Carga diferida de PDF.js y funcionamiento sin conexión.

## Fuera de alcance

- Rediseñar por completo la biblioteca o el lector.
- Cambiar el motor de voz, proveedores, generación o sincronía voz-texto.
- Cambiar la lógica de progreso o la partición del documento.
- Cambiar el protocolo de nube, las llaves o la estrategia de conflictos.
- Introducir dependencias nuevas salvo necesidad técnica demostrada.
- Resolver defectos antiguos no relacionados con estas correcciones.
- Alterar archivos ajenos o trabajo local no relacionado.

## Cierre de la entrega

1. Documentar los cambios y las medidas antes/después en el MD correspondiente al lector/PDF.
2. Añadir a `TRAMPAS.md` cualquier error nuevo descubierto, siguiendo el formato existente.
3. Incrementar `JG_JS_V` y `CACHE_SHELL` una sola vez al terminar toda la tanda.
4. Ejecutar la batería local completa y la matriz manual.
5. Hacer un único despliegue final desde la raíz correcta del repositorio.
6. Verificar `https://jg-turbo.vercel.app` contra el dominio real, incluida una sesión con caché anterior.
7. Confirmar `/api/health`, versión publicada y funcionamiento online/offline.
8. Empujar el commit final y comprobar que `origin/main..HEAD` está vacío.

## Informe que debe devolver el implementador

Para cada ID, informar:

- Estado: cumplido, parcialmente cumplido o bloqueado.
- Archivos modificados.
- Decisión aplicada.
- Evidencia antes y después.
- Pruebas ejecutadas y número de comprobaciones.
- Resultado manual en cada rango.
- Resultado en teléfono físico y lector de pantalla.
- Riesgos o limitaciones restantes.
- Commit, versión, caché, despliegue y confirmación de `origin/main..HEAD`.

No declarar PDF-FIX-01 resuelto únicamente porque una instalación limpia funcione. Debe probarse el paso desde una caché anterior. No declarar PDF-FIX-02 resuelto únicamente por porcentajes de altura u overflow: debe medirse que los rectángulos del texto y del cromo no se intersecten y comprobarse la primera y la última línea visibles.
