# Mejora integral del apartado PDF de JG Turbo

## 1. Alcance y diagnóstico actual

Convertir el apartado PDF en un lector tipo libro, con edición separada, como elegiste: lectura cómoda en móvil, tableta y escritorio; palabras y párrafos continuos; corrección reanudable; comparación con el original.

La base actual es `main`, commit `30e83c9`, con PDF v2.38.0. Los arreglos anteriores ya están integrados. Esta intervención debe completar y corregir esa implementación.

Las 13 suites unitarias PDF ejecutadas terminaron con código cero. Sin embargo, las comprobaciones adicionales reprodujeron estos defectos:

| Caso probado | Resultado actual | Mejora necesaria |
|---|---|---|
| `bonito` al terminar una página y `pez` al empezar la siguiente | `bonitopez`, sin pendientes | Evitar uniones falsas |
| `extraor- ` seguido de `dinario` | Conserva `extraor- dinario`, sin advertencia | Resolver guiones aunque exista espacio residual |
| Corrección por bloques que recorta espacios exteriores | Produce `palabrapalabra` y declara la cola completa | Conservar los separadores al recomponer |
| Bloque de 1.000 caracteres que falla | Queda fallido sin probar tamaños de 800 o 400 | Corregir la reducción progresiva |
| Dos textos del mismo tamaño con cambios en el centro | Comparten la misma huella de caché | Identificar la fuente completa |

También se verificó en código que:

- La corrección v2.38 vuelve a autorizar uniones por parejas de palabras, aunque ya existen identificadores de límites.
- La función que solicita decisiones por identificador está definida, pero no está conectada al flujo actual del controlador.
- “Libro corregido” depende de la cola, sin exigir que estén resueltos los límites ni confirmado el guardado final.
- El texto corregido reemplaza `originalTexto`.
- La prueba de PDF reales solo busca cuatro ejemplos conocidos y se omite si no se proporciona un archivo.

La inspección visual en navegador quedó bloqueada por la aprobación automática, que informó un límite de uso agotado. Por tanto, las decisiones visuales siguientes son especificaciones propuestas, no resultados visuales comprobados.

## 2. Lectura, diseño y responsive

### Lector tipo libro

- Crear una vista principal con contenido HTML semántico: párrafos, títulos, listas, citas y tablas. El `textarea` quedará reservado para “Editar”.
- Mostrar una columna de lectura centrada, con ancho inicial de `64ch`, texto alineado a la izquierda y separación consistente entre párrafos.
- Usar tamaño inicial de 19 px e interlineado 1,7. Ofrecer tamaño de 16 a 28 px, interlineado de 1,4 a 2 y anchuras de 52, 64 y 76 caracteres.
- Permitir elegir tipografía serif de sistema o la sans-serif existente. Conservar los temas Papel y Noche y añadir Sepia; respetar la preferencia que ya tenga guardada cada persona.
- Reutilizar los colores y componentes actuales de JG Turbo. Reducir bordes, sombras y avisos repetidos alrededor del texto.
- Mantener el texto independiente de su presentación: cambiar tamaño, anchura o tema no modifica palabras, párrafos ni posición guardada.

### Navegación y controles

- Cabecera compacta con Biblioteca, título, Contenido, Buscar, Apariencia y Opciones.
- Mostrar capítulo y página física como referencias distintas. Las partes internas de procesamiento no se presentarán como páginas del libro.
- Índice lateral plegable desde 1.024 px. En pantallas menores, abrirlo como una hoja con cierre visible.
- Reproductor compacto con reproducir/pausar, frase anterior/siguiente y acceso a voz y velocidad. Descarga MP3, temporizador y opciones avanzadas irán en un panel secundario.
- Mantener la frase que se está escuchando resaltada dentro del contenido real, reemplazando la superposición de texto duplicado.
- Cuando la persona se desplace manualmente, suspender el seguimiento automático y mostrar “Volver a la lectura”. Añadir una alternativa accesible al gesto de doble toque: “Leer desde aquí”.
- Mostrar la búsqueda con coincidencias, contexto y ubicación, conservando el lugar anterior al cerrarla.

### Comportamiento responsive

- Hasta 767 px: una columna, controles secundarios en hojas y reproductor compacto.
- De 768 a 1.023 px: columna centrada y mayor anchura disponible, sin forzar un índice lateral.
- Desde 1.024 px: índice y lectura, con posibilidad de ocultar el índice.
- Usar un único contenedor principal de desplazamiento durante la lectura. La biblioteca conservará su desplazamiento de documento.
- Reservar espacio para cabecera y reproductor, incluyendo áreas seguras del teléfono. Contemplar orientación horizontal y teclado abierto durante edición o búsqueda.
- Exigir controles de al menos 44 × 44 px, foco visible y navegación completa con teclado. Las hojas deberán gestionar foco, Escape, retorno al botón de origen y contenido de fondo inactivo.
- Aplicar reducción de movimiento y comprobar contraste en todos los temas. Estos criterios siguen las [guías de interfaz revisadas](https://raw.githubusercontent.com/vercel-labs/web-interface-guidelines/main/command.md).

### Biblioteca

- Conservar búsqueda, filtros, portadas y “Seguir leyendo”.
- Incorporar orden por última lectura, título y fecha de incorporación.
- Mostrar por separado avance de lectura, estado de corrección y estado de sincronización.
- Ofrecer vista de portadas y vista compacta, con títulos completos accesibles.
- Cargar portadas progresivamente y paginar la biblioteca en grupos de 40 documentos. Mantener búsqueda y filtros sobre todos los metadatos.
- Situar los errores y sus acciones de recuperación junto al documento afectado.

## 3. Reconstrucción y corrección del texto

### Evitar cortes y uniones incorrectas

- Conservar los átomos y límites incorporados en v2.37. Reparar sus decisiones y su integración.
- Retirar la regla que une dos fragmentos desconocidos únicamente porque uno sea corto o parezca un sufijo.
- Sustituir el vocabulario escrito para los ejemplos de prueba por evidencia del documento: formas completas observadas en límites inequívocos, idioma, estructura y geometría. Una palabra desconocida no será considerada incorrecta por no estar en una lista.
- Conservar espacios normales entre palabras completas. Marcar como sospechosos los límites con evidencia de fragmentación, evitando convertir todas las palabras desconocidas en pendientes.
- Tratar el espacio residual posterior a un guion antes de decidir si existe una partición.
- Diferenciar guiones de partición, guiones léxicos, guiones de diálogo y guiones no separables.
- Calcular líneas y columnas por página y región. Los títulos de ancho completo permanecerán en su posición vertical; no se moverán todos al principio.
- Reconstruir párrafos usando líneas completas y estructura, no el ancho de un fragmento individual.
- Calcular texto, bloques, páginas y posiciones en una misma composición. Toda normalización que cambie la longitud deberá actualizar sus correspondencias.

### Resolver los casos ambiguos

- Conectar el modo existente `pdf_boundary_decisions` al controlador.
- Enviar cada límite con identificador, revisión de origen, contexto anterior y posterior y evidencia disponible. El servidor debe incluir ese contexto en la petición al proveedor; actualmente lo recoge, pero no lo incorpora al texto enviado.
- Aplicar una respuesta exclusivamente al límite solicitado. Retirar del flujo PDF la autorización por parejas repetibles.
- Conservar como pendientes las respuestas ambiguas, incompletas o inválidas.
- Añadir “Revisar cortes”: contexto legible, propuesta, página de origen y acciones Unir, Mantener separado, Separar párrafo y Deshacer.
- Mostrar el recorte de la página original mediante PDF.js, cargado bajo demanda. Si no existe el archivo local, ofrecer “Vincular PDF original” y validar que corresponde al documento.
- Si faltan letras realmente, tratarlas como recuperación de contenido: comparación con el original y propuesta explícita. El OCR se ejecutará solo por petición sobre las páginas seleccionadas, conservando ubicación y confianza.

### Una única corrección de libro

El botón “Corregir cortes y puntuación” ejecutará una sola operación con tres etapas:

1. Resolver cortes y estructura.
2. Revisar puntuación por bloques.
3. Validar y guardar la nueva revisión.

- La corrección automática por parte y la del libro compartirán la misma cola. Abrir un capítulo no iniciará otro proceso competidor.
- Guardar los separadores exteriores de cada bloque fuera del texto enviado al proveedor y restaurarlos al recomponer. Validar también las uniones entre bloques.
- Corregir la secuencia de reducción `3000 → 1500 → 800 → 400`, saltando tamaños que no reduzcan el bloque.
- Reintentar errores transitorios con espera progresiva. Respetar límites del proveedor; credenciales inválidas o cuota agotada pausarán la operación con una acción concreta.
- Ofrecer Pausar y Reanudar. Una recarga recuperará el último bloque confirmado.
- Comprobar documento, revisión y cancelación antes y después de cada petición y antes de guardar. Una respuesta tardía del libro A no podrá aplicarse al libro B.
- Mostrar progreso por etapas y partes, sin mezclar corrección con sincronización.
- “Libro corregido” exigirá: cola completa, cero límites pendientes, integridad validada y guardado confirmado. La sincronización tendrá su propio indicador.

## 4. Datos, edición y mantenimiento

- Conservar una fuente inmutable y una revisión de lectura derivada. La corrección no reemplazará el original.
- Identificar fuente, revisión y bloques mediante SHA-256 del contenido completo.
- Añadir a la cola `documentId`, `sourceRevision`, `stage`, `blockId`, intervalo de origen y separadores exteriores.
- Validar al reanudar que los bloques cubren exactamente su fuente, sin huecos, duplicaciones ni solapamientos.
- Guardar la nueva revisión de forma atómica. Ante un fallo de almacenamiento, conservar la anterior y mostrar “Corrección terminada, pendiente de guardar”.
- Recalcular anclas, índice, búsqueda y correspondencia con TTS desde la revisión confirmada.
- Actualizar únicamente las traducciones y partes sincronizadas cuya fuente cambió.
- Mantener las ediciones manuales separadas. “Editar” mostrará Guardar y Cancelar; una corrección posterior no reemplazará una edición aprobada silenciosamente.
- Subir la reconstrucción y el troceo a versión 7 y la cola a versión 2. Los libros existentes deberán revalidarse; una cola v1 completa no equivaldrá por sí sola a contenido íntegro.
- Mantener los almacenes existentes de IndexedDB y ampliar sus registros de manera compatible.
- Encapsular estilos y componentes dentro del apartado PDF. Cualquier adaptación al motor compartido de voz deberá respetar sus demás consumidores.
- Corregir la documentación contradictoria sobre rutas y despliegue, usando el procedimiento vigente del repositorio aplanado.

## 5. Pruebas y criterio de entrega

La implementación comenzará convirtiendo los fallos reproducidos en pruebas que fallen contra v2.38.

- Comprobar tanto cortes no reparados como palabras pegadas incorrectamente. Incluir casos desconocidos para el vocabulario de prueba.
- Probar separadores entre bloques después de puntuación, reintentos, reducción y recarga.
- Probar libros de 40, 50, 100 y 120 partes mediante el controlador real, incluyendo clic en Corregir, cambios de libro, pausas y reapertura.
- Inyectar errores de red, cuota, validación y almacenamiento. Ninguno podrá producir un falso estado de finalización.
- Comparar literalmente texto visible, texto exportado y contenido entregado a TTS.
- Incorporar PDF reales con un resultado esperado revisado, incluyendo columnas, páginas escaneadas, palabras con guion y párrafos entre páginas. La ausencia de esos archivos debe dejar la aceptación real como pendiente.
- Validar interfaz en 320, 360, 390, 768, 1.024, 1.280 y 1.440 px; orientación horizontal, zoom al 200 %, teclado abierto, títulos largos y biblioteca de 200 libros.
- Corregir la prueba geométrica: los controles menores de 44 px deben causar fallo, y la prueba de scroll debe desplazar el contenedor que realmente se mueve.
- Capturar y revisar Biblioteca, Lectura, Apariencia, Corrección, Error y Reanudación en móvil y escritorio. Esta comprobación visual continúa pendiente por el bloqueo indicado.
- Comparar rendimiento contra v2.38 con el mismo documento y dispositivo; evitar reconstrucciones completas durante cada avance de voz.
- Documentar los resultados, integrar en `main`, desplegar mediante el procedimiento vigente y verificar el dominio real, los módulos servidos y la actualización de la PWA.

El cierre exige texto íntegro, corrección recuperable, revisiones conservadas y lectura responsive comprobada. Pasar las pruebas sintéticas, por sí solo, no completará la entrega.
