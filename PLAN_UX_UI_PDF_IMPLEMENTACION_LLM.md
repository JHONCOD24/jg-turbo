# JG Turbo: plan aprobado de mejora UX/UI del lector PDF

## Documento de entrega al LLM implementador

- Fecha: 9 de septiembre de 2026.
- Proyecto: `C:\Users\juanl\Documents\Proyectos\jg-turbo`.
- Propósito: implementar incrementalmente las mejoras UX/UI acordadas, conservando la funcionalidad y la identidad visual existentes.
- Alcance: 10 de 12 tareas corresponden a PDF. No requiere dependencias nuevas ni reescritura de la aplicación.
- Este documento transcribe el plan entregado en la conversación y añade al final el prompt solicitado para la auditoría posterior.

El plan es incremental, conserva la arquitectura actual y no requiere dependencias nuevas. Las decisiones siguientes quedan fijadas para el implementador.

## Convenciones para todas las tareas

- **Móvil:** ≤640 px. Comprobar 320×740, 390×844 y 430×932.
- **Tablet:** 641–1023 px. Comprobar 768×1024 y 820×1180.
- **Desktop:** ≥1024 px. Comprobar 1024×768, que también representa tablet horizontal, y 1440×900.
- La orientación horizontal de una tablet debe conservar objetivos táctiles de **44×44 px**, aunque utilice distribución de escritorio.
- Las rutas de la tabla son relativas a la raíz del proyecto.
- **Contrato transversal:** conservar texto, carátulas, filtros, preferencias y posición de lectura; mantener nombres accesibles, foco visible y operación por teclado; respetar movimiento reducido. Ninguna tarea autoriza reescribir contenido ni cambiar proveedores.
- Antes de editar, registrar la situación actual de los archivos afectados y preservar los cambios locales preexistentes.

## Plan técnico final

| Fase | ID | Prioridad | Área | Objetivo | Cambio concreto | Desktop | Tablet | Móvil | Componentes/archivos | Dependencias | Criterios de aceptación | Pruebas manuales | Riesgo |
| ---- | -- | --------- | ---- | -------- | --------------- | ------- | ------ | ----- | -------------------- | ------------ | ----------------------- | ---------------- | ------ |
| 1. Estados veraces | PDF-01 | Alta | Biblioteca y sincronización | Distinguir almacenamiento local y copia sincronizada. | Sustituir la deducción basada únicamente en `doc.sincronizar` por el estado real disponible. Estados: **Solo en este dispositivo**, **Pendiente de sincronizar**, **Sincronizado**, **No se pudo sincronizar**. Usar «Sincronizado» únicamente con confirmación vigente; si faltan datos, mostrar pendiente. Reutilizar la zona de estado de tarjeta y los eventos existentes. Anunciar cambios sin mover el foco. | Estado legible debajo de los metadatos. | Igual; permitir salto de línea. | Igual, sin desplazar título o portada. | `js/pdf/pdfController.js`, `biblioteca.js`, `nube.js`, `sincronizacion.js`. Confirmar campos/eventos existentes antes de implementar. | Ninguna. Leer `CONFIG_PERSISTENTE.md` y `CAMBIOS_SYNC.md`. | Un libro recién importado sin vinculación dice «Solo en este dispositivo». Un envío pendiente o fallido no dice «Sincronizado». La tarjeta y el panel de nube coinciden. | En los tres rangos: importar sin vincular; comprobar pendiente durante envío; interrumpir conexión; restaurarla y verificar resultado. Usar biblioteca de prueba. | **Moderado.** Representación del estado, sin cambiar protocolo, llaves ni resolución de conflictos. |
| 2. Preferencias fiables | PDF-02 | Alta | Apariencia | Hacer que los ajustes correspondan con el texto visible. | Corregir la cascada que impone serif sobre `data-fuente="sans"`. Mostrar tamaño e interlineado junto a sus etiquetas y actualizar sus valores accesibles. Reutilizar hoja y controles actuales. Estados: predeterminado, personalizado y restaurado tras recarga. | Sans y Serif corresponden con su selección; conservar ancho elegido. | Mismo comportamiento, incluida orientación. | La regla móvil respeta la fuente elegida y el mínimo de legibilidad existente. Si el tamaño es automático, indicarlo; al ajustar, mostrar el valor aplicado. | `index.html`; `js/pdf/libroVista.js`, especialmente `aplicarApariencia()`. | Ninguna. | Selección, valor visible y estilo computado coinciden. Al cambiar fuente, tamaño o interlineado permanece visible el pasaje de referencia. Recargar conserva ajustes. | En cada rango: alternar fuentes, modificar ambos deslizadores con teclado y puntero, cerrar, reabrir y recargar. Repetir con letra grande. | **Bajo a moderado.** Repaginación y conservación del ancla. |
| 3. Información de lectura | PDF-03 | Alta | Encabezado, progreso y contenido | Dar contexto sin duplicaciones ni cifras ambiguas. | Crear una presentación común de los datos existentes, sin recalcular progreso. Cabecera: título del libro y **una sola etiqueta de sección**. Pie: **«X % del libro»** y **«~N min en esta sección»**. Paginación: **«Página X de Y de la sección»**. La referencia física se muestra bajo demanda como **«Página N del PDF»**, aclarando si corresponde al inicio de la sección. Retirar porcentaje secundario y conteo de palabras de la vista principal. No presentar `estado.partes` como capítulos editoriales: usar título editorial si está identificado; en otro caso, «Sección X de Y». Estados: título largo, una sección, estimación desconocida y página física desconocida. | Título/contexto y acciones con espacio separado. Detalle bajo demanda accesible desde el resumen de progreso. | Cabecera en dos filas cuando las acciones no quepan: contexto arriba, acciones abajo. No comprimir información entre botones. | Una fila superior de navegación; contexto ampliado al pulsar el resumen de progreso. Pie compacto con porcentaje del libro y tiempo de sección. | `index.html`: `#pdfDocDonde`, `#pdfDocRef`, `#pdfPieLectura`, `#pdfPagPos`; `js/pdf/libroVista.js`, `pdfController.js`, `panelIndice.js`. | PDF-02. | No hay capítulo repetido en cabecera. Cada porcentaje y página tiene alcance identificable. El título completo y la referencia física son consultables sin abandonar lectura. Los valores desconocidos no se inventan. | En todos los tamaños: abrir título largo; ir a primera, intermedia y última sección; rotar; cambiar tamaño de letra y comprobar que solo cambia la paginación visual, no el significado del progreso. | **Moderado.** Diferenciar sección técnica y capítulo sin alterar partición ni cálculos. |
| 3. Información de lectura | PDF-04 | Media | Reanudación | Confirmar la posición recuperada sin tapar texto. | Sustituir el aviso flotante por **«Lectura reanudada»** dentro de la zona de estado del resumen, sin aumentar su altura. Anuncio `polite`, sin foco automático. Retirarlo después de unos segundos; no contendrá acciones temporizadas. Mover **«Ir al inicio del libro»** a Contenido: solo navega, no borra historial ni preferencias. Conservar los avisos de corrección como flujo separado. | Confirmación integrada en el resumen. | Igual, sin invadir cabecera ni acciones. | Igual; visible al entrar y compatible con inmersión. | `index.html`: `#pdfReanudar`, `#btnPdfReanudarInicio`; `js/pdf/pdfController.js`. | PDF-03. | Continuar abre el pasaje guardado. El aviso no cubre texto ni cambia la paginación. «Ir al inicio» sigue disponible después de desaparecer el aviso. | En cada rango: salir desde un pasaje identificable, continuar, esperar retirada del mensaje y acceder al inicio desde Contenido. Probar teclado. | **Bajo.** No mezclar este cambio con reinicio de progreso o corrección automática. |
| 4. Organización | PDF-05 | Alta | Biblioteca | Ordenar sin ocupar las portadas ni comprimir información. | Añadir **«Organizar»** junto a Orden/Vista. Al entrar, mostrar una lista temporal de filas con miniportada original, título, metadatos y zona propia de controles. Retirar el tirador permanente de las tarjetas habituales. No iniciar arrastre mediante pulsación prolongada sobre la portada en modo normal. Conservar Portadas/Compacta y restaurar la vista previa al salir. Estados: biblioteca vacía, un libro y varios. | Filas dentro del ancho de biblioteca; acción visible. | Igual, con objetivos táctiles. | Filas de ancho completo; controles separados del título. | `index.html`; `js/pdf/pdfController.js`: `tarjetaLibro()`, `activarRejillaMovible()`; `libroVista.js`. | PDF-01. | En vista normal se leen páginas y unidades sin que los controles las recorten. Portadas libres de superposiciones. «Organizar» está deshabilitado y explicado con menos de dos libros. Salir devuelve la vista y filtros anteriores. | En cada rango: bibliotecas de 0, 1 y ≥9 libros; título largo; Portadas y Compacta; entrar y salir con búsqueda/filtro activo. | **Moderado.** Separar presentación de organización y navegación habitual. |
| 4. Organización | PDF-06 | Alta | Reordenamiento accesible | Permitir orden preciso con ratón, táctil y teclado. | Dentro de Organizar, ofrecer tirador de 44×44 y botones **«Mover antes» / «Mover después»**. Mantener Alt+flechas como atajo explicado. Mostrar indicador de destino y anunciar «Título, posición X de Y». Trabajar sobre un orden temporal: **Guardar orden** persiste mediante la clave existente; **Cancelar** restaura el original. Escape cancela primero el arrastre activo. Al entrar, mostrar todos los libros y suspender filtros/búsqueda; restaurarlos al salir. Sin selección múltiple. | Arrastre y botones equivalentes; foco sigue al libro. | Igual; arrastre no impide desplazar la lista fuera del tirador. | Igual; autodesplazamiento del contenedor real al acercarse al borde. | `js/pdf/pdfController.js`: orden y eventos de puntero; `libroVista.js`; estilos en `index.html`. | PDF-05. Leer persistencia antes de tocar claves. | Guardar mantiene el orden tras recarga; Cancelar no cambia el orden guardado. Funciona sin arrastrar. Primer/último movimiento tienen estado deshabilitado correcto. Un gesto cancelado no guarda. No se abre el libro mientras se organiza. | En cada rango: mover primero al final y viceversa con ≥9 libros; probar botones, teclado y táctil real; cancelar; guardar y recargar. | **Moderado.** Persistencia, cancelación y desplazamiento. No renombrar claves existentes. |
| 5. Voz | PDF-07 | Alta | Acceso y reproducción | Priorizar escuchar frente a configurar. | Para usuarios sin preferencia guardada, iniciar la voz plegada. Reutilizar consola y motor. Estados explícitos: **inactivo, preparando, reproduciendo, pausado, finalizado y error**. Reproduciendo/pausado: reproducción, progreso y acceso a ajustes prioritarios. «Detener» separado de «Cerrar ajustes»: cerrar no detiene. No reiniciar audio por abrir paneles. | Acceso «Escuchar» visible; consola compacta durante reproducción. | Igual, evitando una consola completa al abrir el libro. | Mantener acceso Voz y mini reproductor existente durante inmersión cuando haya audio. | `js/pdf/libroVista.js`: preferencia inicial; `pdfController.js`; consola TTS y estilos de `index.html`. | PDF-03. | Primera entrada sin audio no despliega configuración completa. Preparando tiene feedback. Pausar, reanudar y detener son identificables. Cerrar ajustes conserva audio y posición. Las preferencias previas se respetan. | En cada rango: iniciar, pausar, reanudar, detener; abrir/cerrar Apariencia y Contenido mientras suena; comprobar final y error de generación. | **Moderado a alto.** Interacción con motor, guía y mini reproductor. No modificar generación ni sincronía voz-texto. |
| 5. Voz | PDF-08 | Alta | Ajustes de voz | Evitar saturación y desbordamiento. | Ordenar el panel existente: **reproducción**, después **voz y velocidad**, y un apartado secundario **Más ajustes** para música, temporizador y MP3. «Desde aquí» mantiene etiqueta visible y alcance explícito. Un único cierre del panel; suprimir cierres redundantes. Selectores con nombres accesibles y velocidad visible. Estados: controles no disponibles, generación y ajustes abiertos/cerrados. | Panel acotado; filas que se adaptan sin comprimir selectores. | Distribución de una o dos columnas según espacio real. | Hoja inferior con desplazamiento vertical interno; encabezado/cierre accesibles; sin desplazamiento horizontal. | `index.html`: `#pdfDockNav`, `#pdfTtsAjustes`; `js/pdf/pdfController.js`. | PDF-07. | `scrollWidth ≤ clientWidth + 1` en el panel. Controles táctiles ≥44×44. Ninguna acción principal depende solo de icono. MP3, música y temporizador siguen disponibles. No hay dos paneles modales competidores abiertos. | En todos los tamaños: desplegar cada apartado; usar nombre de voz largo; aumentar texto; recorrer con Tab/Shift+Tab y cerrar con Escape. | **Moderado.** Reutilizar controles, sin duplicar listeners ni estados. |
| 6. Geometría del lector | PDF-09 | Crítica | Lectura responsive | Mostrar el texto completo con controles visibles y ocultos. | Unificar medición de cabecera, pie y paginación. Mantener una **caja paginada estable** entre estados normal/inmersivo: el ocultamiento no modifica el reparto de páginas. Reservar espacio para las barras de navegación; las hojas abiertas pueden superponerse deliberadamente, pero su cierre debe recuperar el mismo pasaje. Usar mediciones reales y zona segura, no constantes independientes. Consolidar únicamente reglas conflictivas del lector. | Texto entre cabecera y controles; aprovechar altura disponible. | Recalcular tras orientación y cambios de cabecera, conservando ancla. | Corregir solapes superior/inferior; conservar retirada automática y recuperación de controles. | `index.html`; `js/pdf/libroVista.js`: medición/paginación; `pdfController.js`: inmersión y viewport. | PDF-02, PDF-03, PDF-04, PDF-07 y PDF-08. | Con barras visibles, ninguna línea intersecta cabecera, pie o navegación. Ocultar/mostrar controles no cambia página ni carácter ancla. Avanzar mueve exactamente una página. Sin scroll horizontal externo. Última línea de cada página accesible. | En toda la matriz: leer primera/última línea; avanzar y retroceder; mostrar/ocultar barras; cambiar letra; rotar; abrir/cerrar hojas. En teléfono físico, expandir/contraer barra del navegador y probar zonas seguras. | **Alto.** Paginación, scroll y conservación del contexto. Requiere medición antes/después. |
| 6. Navegación y foco | PDF-10 | Alta | Contenido y overlays | Mantener orientación y accesibilidad al ocultar controles. | Contenido identifica la sección actual, permite volver a ella y ofrece «Ir al inicio». Conservar búsqueda y navegación existentes. Aplicar el patrón de foco ya observado en Apariencia a las hojas de voz/progreso/contenido: foco al abrir, recorrido contenido cuando sean modales, Escape y retorno al disparador. Los controles invisibles por inmersión no deben recibir foco oculto: al navegar con teclado, revelar primero la interfaz. | Índice lateral existente; sin convertirlo innecesariamente en modal. | Panel acotado con sección actual localizable. | Hoja de Contenido con desplazamiento propio y cierre alcanzable. | `js/pdf/panelIndice.js`, `libroVista.js`, `pdfController.js`; estructura de hojas en `index.html`. | PDF-03, PDF-04, PDF-09. | Se localiza la sección actual sin recorrer todo el índice. Abrir/cerrar no cambia la lectura. No hay foco invisible. Los fondos modales no reciben interacción; el índice lateral no bloquea injustificadamente el lector. | En cada rango: teclado completo; abrir desde modo inmersivo; elegir sección; cerrar sin elegir; usar lector de pantalla en al menos un entorno de escritorio y uno móvil. | **Moderado.** Evitar aplicar comportamiento modal al índice persistente. |
| 7. Consistencia general | APP-01 | Media | Pestañas globales | Reconocer todos los destinos en móvil. | Conservar las cinco pestañas, orden e iconos. Reducir espaciado/padding antes de reducir texto. En ≤640 px mantener icono sobre etiqueta y nombres completos; con aumento de texto, permitir crecimiento vertical controlado. Reutilizar estructura ARIA y navegación actuales. | Sin cambio estructural. | Mantener nombres completos. | Micrófono, Archivo, YouTube, PDF y Traducir sin elipsis a tamaño normal. | `index.html`: `.tabs`, `.tab`, `.lbl`. | Ninguna; ejecutar tras estabilizar PDF. | Todos los nombres se leen a 320, 390 y 430 px. Objetivos ≥44 px de alto. Con texto ampliado siguen siendo identificables y alcanzables. Selección y foco visibles. | Abrir las cinco pestañas en cada rango; probar teclado y aumento de texto. | **Bajo.** Vigilar altura global y contenido disponible. |
| 7. Consistencia general | APP-02 | Media | Acciones deshabilitadas | Explicar por qué una acción no está disponible. | Homogeneizar el tratamiento de botones deshabilitados usando el patrón existente de Archivo/YouTube. En Traducir, mostrar «Escribe o importa texto para traducir». Diferenciar vacío, listo, procesando y error mediante texto y estado, no solo color. Asociar explicación al botón cuando corresponda. | Mismo patrón visual. | Igual. | Explicación junto a la acción, sin depender de tooltip. | `index.html`: estilos de botones y `#btnTransTranslate`; revisar equivalentes sin ampliar funciones. | Ninguna. | Vacío: botón deshabilitado con motivo visible. Con texto: activo. Procesando: feedback y protección frente a envíos duplicados. Error: mensaje legible y acción de reintento existente accesible. | En cada rango: vacío, texto presente y procesamiento; comprobar error con el mecanismo de prueba existente. No alterar servicios para provocarlo. | **Bajo.** No cambiar reglas de habilitación ni lógica de traducción. |

## 1. Orden recomendado de ejecución

1. **PDF-01:** corregir estados engañosos.
2. **PDF-02:** estabilizar preferencias y valores visibles.
3. **PDF-03 y PDF-04:** fijar jerarquía informativa y reanudación.
4. **PDF-05 y PDF-06:** implementar organización como una entrega conjunta.
5. **PDF-07 y PDF-08:** simplificar voz manteniendo el motor.
6. **PDF-09 y PDF-10:** cerrar geometría, navegación y accesibilidad sobre los controles definitivos.
7. **APP-01 y APP-02:** aplicar los dos ajustes generales.
8. Ejecutar la validación completa y documentar resultados. Aplicar la regla del repositorio de **un despliegue final**, con verificación del dominio y respaldo en Git.

PDF-09 mantiene prioridad crítica. Su posición evita corregir dos veces la geometría antes y después de cambiar cabecera y voz.

## 2. Cambios fuera de alcance

- Reescritura de la SPA, adopción de un framework o nueva biblioteca de componentes.
- Cambios de extracción, OCR, partición, corrección editorial, traducción o generación de audio.
- Alteración de texto, carátulas originales o datos del usuario.
- Nuevo sistema de cuentas, sincronización o almacenamiento.
- Sincronizar entre dispositivos el orden personalizado si actualmente solo es local.
- Selección múltiple, carpetas, etiquetas u otras funciones de biblioteca no aprobadas.
- Rediseño general de colores, navegación o identidad visual.
- Cambios adicionales derivados de preferencias estéticas del implementador.

## 3. Checklist final de validación UX/UI

- [ ] Ejecutar la matriz completa de tamaños; añadir tablet horizontal táctil y PWA instalada en escritorio.
- [ ] Probar biblioteca vacía, un libro y ≥9 libros, con títulos largos y ambas vistas.
- [ ] Conservar filtros, orden, carátulas, preferencias y pasaje de lectura tras recarga.
- [ ] Ordenar con arrastre, botones y teclado; verificar Guardar y Cancelar.
- [ ] Leer sin líneas cubiertas, con controles visibles y en inmersión.
- [ ] Cambiar página exactamente una vez por gesto o pulsación.
- [ ] Verificar capítulo/sección, porcentaje, tiempo y página con alcance explícito.
- [ ] Comprobar tipografía elegida, tamaño e interlineado en todos los rangos.
- [ ] Probar voz inactiva, preparando, activa, pausada, detenida, finalizada y con error.
- [ ] Cerrar ajustes sin detener audio; conservar sincronía y mini reproductor.
- [ ] Revisar foco, Escape, nombres accesibles, anuncios y objetivos táctiles.
- [ ] Medir contraste: texto normal ≥4,5:1; texto grande y elementos gráficos esenciales ≥3:1. No atribuir conformidad completa solo a estas mediciones.
- [ ] Probar aumento de texto y movimiento reducido.
- [ ] Confirmar que no existen desplazamientos horizontales involuntarios.
- [ ] Verificar manualmente barra del navegador y zonas seguras en dispositivos físicos.
- [ ] Ejecutar las pruebas exigidas por el repositorio y contar comprobaciones; incluir geometría, scroll, móvil, voz/acordeón y mini reproductor según las áreas modificadas.
- [ ] Registrar por separado pruebas locales, producción y comprobaciones pendientes. Una captura o una suite aprobada no sustituye el recorrido manual.

## 4. Instrucciones de handoff para el LLM implementador

- Leer las instrucciones vigentes del repositorio y los documentos del área antes de editar. Preservar cambios ajenos.
- Implementar los **IDs y decisiones de esta tabla**. No sustituirlos por un rediseño alternativo.
- Reutilizar tokens, hojas, controles, motores y funciones existentes. No duplicar controles TTS ni mantener dos fuentes de estado.
- Para cada tarea, entregar: archivos afectados, comportamiento resultante, pruebas realizadas, evidencia y limitaciones pendientes.
- En cambios de alturas, registrar rectángulos de texto y barras antes/después, además de capturas. En organización, verificar persistencia con varios libros.
- Si los datos existentes no permiten satisfacer un criterio, describir el bloqueo concreto antes de ampliar arquitectura o lógica de negocio.
- Considerar completada cada tarea únicamente cuando cumpla sus criterios en desktop, tablet y móvil.

## 5. Auditoría posterior a la implementación

La auditoría se realizará cuando la implementación esté disponible, comparando contra los IDs de este documento. Es una revisión separada de la implementación: no autoriza escribir código ni proponer otro rediseño.

### Prompt del usuario para el auditor

Actúa como auditor UX/UI y revisor técnico.

Compara la implementación actual con el plan aprobado. No escribas código ni propongas un rediseño nuevo.

Entrega una tabla con:

- Requisito o tarea original.
- Estado: cumplido, parcialmente cumplido o no cumplido.
- Evidencia observada.
- Problema o regresión detectada.
- Severidad.
- Corrección mínima recomendada.
- Criterio de aceptación pendiente.

Prioriza PDF / lector PDF, responsive móvil y tablet, controles de voz, encabezado de progreso, reordenamiento de PDFs y preservación de las mejoras visuales existentes.

### Formato de salida de la auditoría

| Requisito o tarea original | Estado | Evidencia observada | Problema o regresión detectada | Severidad | Corrección mínima recomendada | Criterio de aceptación pendiente |
| --- | --- | --- | --- | --- | --- | --- |

Relacionar los resultados con los IDs PDF-01 a PDF-10 y APP-01 a APP-02. Indicar expresamente cualquier comprobación que no se haya podido realizar, sin presentarla como cumplida.
