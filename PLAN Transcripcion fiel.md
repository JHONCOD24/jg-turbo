# Plan para una transcripción fiel del PDF

## Resumen

Crear una capa de **transcripción fiel** que conserve palabras, signos, mayúsculas, tildes, párrafos, títulos, listas y notas. La tipografía se adaptará al lector, pero el contenido no se corregirá automáticamente.

La aplicación solo podrá declarar:

- **Extraído sin alteraciones:** superó validaciones técnicas.
- **Pendiente de revisión:** existen límites, estructura u OCR dudosos.
- **Verificado:** el usuario confirmó los puntos dudosos comparándolos con el PDF.

## Cambios principales

- Mantener tres capas separadas:
  1. Fragmentos originales e inmutables de PDF.js.
  2. Transcripción fiel reconstruida.
  3. Correcciones opcionales aprobadas por el usuario.
- Eliminar de la transcripción fiel las modificaciones automáticas actuales de puntuación, espacios y gramática. La IA solo presentará propuestas.
- Conservar cada fragmento con página, coordenadas, dirección, fuente, saltos, función estructural y procedencia.
- Registrar toda unión, espacio, párrafo u omisión mediante un identificador estable. Ningún fragmento podrá desaparecer sin quedar registrado.
- Reconstruir títulos, párrafos, listas, citas, notas, columnas y tablas mediante estructura marcada y geometría. Los casos ambiguos pasarán a revisión.
- Añadir **Comparar con PDF**: página original junto al texto correspondiente, con los puntos dudosos resaltados.
- Mantener cabeceras, pies y números de página en la capa original. Podrán excluirse de la lectura, pero nunca eliminarse silenciosamente.
- Para escaneos, conservar palabras, cajas y confianza del OCR. Las páginas de baja confianza exigirán revisión. No se presentará OCR como exacto automáticamente.

## Integridad y compatibilidad

- Sustituir la validación actual, que ignora espacios y parte de la puntuación, por una comparación Unicode completa.
- Exigir que cada carácter original aparezca en orden o tenga una transformación autorizada y reversible.
- Guardar un historial exacto de cambios y permitir volver siempre a la extracción original.
- Subir la versión del modelo de reconstrucción. Los libros existentes se reprocesarán desde su PDF guardado; si ya no tienen fuente, conservarán su texto con estado **Legacy no verificable**.
- Ampliar el resultado de `procesarPdf()` con `estructura`, `calidadPorPagina`, `transformaciones`, `fragmentosFuente` y `estadoFidelidad`. No requiere una API pública nueva.

## Pruebas y aceptación

- Crear un corpus revisado manualmente con PDFs etiquetados y no etiquetados, columnas, listas, tablas, notas, ligaduras, guiones, signos y escaneos.
- Comparar carácter por carácter el resultado esperado, incluidos puntuación, tildes, mayúsculas y orden.
- Comprobar cobertura: cada fragmento debe aparecer exactamente una vez o figurar como exclusión explícita.
- Probar guardado, reapertura, migración, exportación y deshacer sin modificar la capa original.
- Hacer un piloto con 10 a 20 páginas representativas del PDF real del usuario antes de aplicarlo a libros completos.
- Publicar una sola vez después de superar pruebas locales, producción y revisión en un teléfono físico.

## Supuestos

- La prioridad es fidelidad textual y estructura semántica, con tipografía adaptable a cada pantalla.
- Ningún sistema puede garantizar automáticamente una transcripción exacta cuando el PDF contiene imágenes, fuentes mal codificadas o un orden de lectura ambiguo. Esos casos quedarán visibles y requerirán revisión.
- La corrección gramatical seguirá siendo opcional y nunca reemplazará la transcripción fiel.
