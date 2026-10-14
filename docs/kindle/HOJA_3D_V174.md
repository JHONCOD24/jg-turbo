# Hoja curva 3D, v174

## 1. Objetivo

Sustituir el bloque que se desplazaba y giraba 55 grados por una hoja que
gira 180 grados, se curva, presenta anverso y reverso y proyecta una sombra.
Integrar el efecto con los gestos, la navegación y los cambios de capítulo.

## 2. Referencia y límites

El modelo previo (`MODELO_KINDLE.md`) documenta controles del lector web,
no una grabación de la animación nativa. No se dispone del teléfono del dueño
ni de una referencia grabada para afirmar igualdad exacta con Kindle.
Las capturas y el GIF son de la aplicación con libros de prueba.

WebKit/Windows inició y admitió 3D, pero importar el PDF dio
`Error preparing Blob/File data to be stored in object store`. Sus pruebas
de renderizado usan capítulos de texto guardados con la API real de la app.
No se modificó ni se simuló IndexedDB para sortearlo. No se presenta esa
prueba como importación de PDF en Safari ni como ejecución en iPhone físico.

## 3. Implementación

- `js/pdf/hoja3d.js`: geometría pura de diez franjas conectadas. Cada franja
  tiene posición en X/Z y tangente distinta. El giro completo va de 0 a 180
  grados; retroceder usa la geometría reflejada.
- La textura es una copia DOM de las palabras e imágenes visibles en sus
  coordenadas. Mantiene fuente, peso, espaciado, justificación y proporciones.
  No rasteriza HTML, no añade una biblioteca, no cambia el texto del libro.
- Antes de visitar palabras, una búsqueda por columnas limita el intervalo
  visible de cada nodo. Un párrafo de más de 130.000 caracteres no se mide palabra
  por palabra entero. Las franjas comparten los mismos recursos de imagen.
- Escena con perspectiva y `preserve-3d`, dos caras opacas por franja y
  `backface-visibility:hidden`. Recorte exterior separado de las caras.
  La iluminación varía por normal; repetir un gradiente por franja producía
  bandas visibles y se corrigió. El reverso recibe luz también en temas oscuros.
- El gesto aplica la geometría directamente; al soltar se completa o revierte.
  El cierre usa Web Animations con 17 muestras y solo transformaciones/opacidad.
  Un toque tiene un presupuesto de 420 ms incluyendo preparar la textura;
  al arrastrar solo cuenta el giro restante. No modifica el tamaño de la página real.
- Una copia que resulta lenta dos veces reduce a una franja: hoja rígida con
  reverso y giro de 180 grados, sin convertir Libro en un bloque deslizante.
- Al cruzar de capítulo se conserva la hoja saliente hasta el primer reparto
  del siguiente; al volver se entra en la última página. Hay limpieza ante
  cancelación, giro del dispositivo, pasos rápidos y cambio de preferencia.
- Permanecen Libro / Deslizar / Sin animación y movimiento reducido. Sin
  claves nuevas, migraciones, cambios en las voces ni modificaciones de la API.

## 4. Validación

- `test_pdf_hoja3d`: 32 comprobaciones de geometría, curvatura, profundidad,
  reverso, endpoints y respaldo rígido.
- `verificar_pdf_hoja3d`: Chromium 48 y WebKit 32. Vertical y horizontal;
  Chromium incluye CPU emulada ×4. Compara todos los caracteres visibles,
  coordenadas, figuras y proporciones; exige diez tangentes diferentes,
  frente/reverso, cancelación y hojas en ambos cruces de capítulo.
- `verificar_pdf_animacion`: 107; gestos reales por CDP, navegación rápida,
  temas, movimiento reducido y voz con dobles. Medido en Chromium en este
  equipo: p95 de aproximadamente 18 ms. No acredita 60 fps en el teléfono físico.
- Las ejecuciones finales del lector se registran en `CAMBIOS_PDF.md`.
- `verificar_arranque_ligero`: 9/10. El presupuesto total de menos de 1 MB
  falla también con v173 (1103 KB). Sí pasa la carga diferida: 0 KB de módulos
  de PDF al arrancar. No se amplió el umbral para ocultar el fallo previo.

## 5. Calidad visual y seguridad de lectura

Se inspeccionaron fotogramas en 15 %, 30 %, 50 % y 70 % del gesto: papel curvo,
texto deformado por la perspectiva, reverso y sombra sobre la página siguiente fija.
El texto real, su ancla y la voz mantienen el recorrido existente. La hoja
temporal es decorativa, inerte y ajena al área que calcula la paginación.
Las pruebas con voz usan audio simulado; falta aceptación en un teléfono real.

## 6. Entrega

Vista previa local: `.playwright-cli/hoja3d/hoja-3d.gif` y fotogramas en la
misma carpeta. Es un gesto renderizado por el lector con un libro de prueba,
no una grabación de Kindle. Publicación: `CAMBIOS_PDF.md`, entrada v174.

## 7. Criterio de cierre

La curvatura, profundidad, reverso y navegación tienen pruebas ejecutables,
además de revisión visual. La igualdad exacta con Kindle y el rendimiento
en el móvil del dueño quedan sin verificar hasta una comparación física.
