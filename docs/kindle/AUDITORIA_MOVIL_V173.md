# Auditoría del apartado PDF móvil, v173

Fecha: 2026-10-13. Base revisada: `b12e9a7`, incluida la implementación
`4ad7718` de v172. Se audita el lector de la aplicación y sus cambios, con
PDF de prueba y contextos de navegador aislados. No se recibió un libro
concreto del teléfono del dueño. No se comparó con Kindle nativo ni se
volvió a ejecutar REA: sus herramientas no estaban expuestas en esta sesión.
La referencia de comportamiento es `MODELO_KINDLE.md`, cuya distinción entre
observado y conocido se conserva. No se presenta esto como réplica exacta.

Publicado: v173, commit `40fd76b`, despliegue
`dpl_9pZj4QP1omEJuMxXXB3MsgMgjUBk` READY. Dominio
`https://jg-turbo.vercel.app`: seis archivos con sha256 igual al commit,
marcador v173 y `/api/health` ok. Las cuatro suites que se repitieron en el
dominio sumaron 162 comprobaciones aprobadas (41 + 24 + 60 + 37).

## Hallazgos

1) Biblioteca / carátulas provisionales:
   - Problema: una tapa dibujada vuelve a generarse al pintar la biblioteca.
   - Evidencia: controlador original servido en un contexto sin Service
     Worker, catálogo sin resultados y libro sin PDF: 241 repintados en 8 s.
     La generación cambiaba también `actualizado` y `portadaSincronizada`.
   - Corrección aplicada: compartir generación en curso por id, deduplicar
     intentos según fuente y conservar una provisional existente si no se
     consigue una imagen mejor. La prueba corregida observa 8 s sin repintados
     ni cambios de fecha. Se conserva Buscar carátula como reintento manual.
   - Prioridad: alta.

2) Biblioteca / Seguir leyendo / lector / sincronización:
   - Problema: la rejilla revocaba todas las URLs, incluidas las del lector
     y Seguir leyendo. Los paquetes sin imagen podían afirmar `tienePortada`.
   - Evidencia: `liberarPortadas` revocaba la lista compartida antes de borrar
     la rejilla; `metaSinCamposDelAparato` conservaba la marca remota de portada.
   - Corrección aplicada: URLs asociadas a sus elementos, liberación solo de
     elementos retirados o de la imagen sustituida; no importar marcas de
     presencia de otro aparato sin su imagen. Conservar la procedencia de las
     portadas completas recibidas. Evitar aplicar al lector un resultado
     tardío que pertenece al libro anterior.
   - Prioridad: alta.

3) Lector inmersivo / acceso a Aa:
   - Problema: todos los destinos de la barra móvil se ocultan; el acceso
     depende de descubrir un toque central. No se reprodujo que Aa fuera
     imposible de abrir después de ese toque en los dispositivos simulados.
   - Evidencia: CSS de `jg-inmersivo` deja la barra con opacidad 0 y sin toques.
     Los 41 casos de v172 pasaban, pero no exigían un acceso visible inicial.
   - Corrección aplicada: Aa de 44 × 44 px visible en lectura inmersiva; abre
     la misma hoja y cierra conservando el libro y la página.
   - Prioridad: alta.

4) Ajustes / teléfono horizontal:
   - Problema: la hoja usaba reglas de tablet según el ancho del teléfono.
   - Evidencia: en 844 × 390 se midió y=64, alto=378, final=442, fuera de la
     ventana. El usuario no podía ver toda la hoja.
   - Corrección aplicada: aplicar también el modelo móvil al horizontal bajo,
     hoja inferior dentro de la ventana, máximo 68 % del alto, desplazamiento
     propio y cierre persistente al recorrer sus controles.
   - Prioridad: alta.

5) Lector / aviso al abrir:
   - Problema: confirmación translúcida sobre el texto del libro.
   - Evidencia: captura inicial 390 × 844: «Listo · 34 páginas · en tu
     biblioteca» se mezcla con un párrafo detrás del recuadro.
   - Corrección aplicada: fondo opaco del tema, texto como bloque, sin mezcla
     de líneas; en horizontal el aviso breve ocupa la franja del pie. La
     prueba de orientación detectó y se corrigió un solapamiento intermedio.
     El aviso de unir aclara que se repararon palabras partidas, con Deshacer.
     La notificación auxiliar de gráficos no reemplaza el aviso activo de OCR.
   - Prioridad: media.

6) Pasar página / animación:
   - Problema: la animación ya existía; no era una reproducción del giro
     original de Kindle y su inclinación de 20 grados era leve.
   - Evidencia: `crearHoja`, sombra y tres opciones de paso existían antes de
     v172. La ausencia concreta reportada en el teléfono no se reprodujo.
   - Corrección aplicada: giro visible de 55 grados, sombra de pliegue y
     transición de 420 ms; mantiene selección de Libro / Deslizar / Sin
     animación y respeta la preferencia de movimiento reducido.
   - Prioridad: media.

## Checklist de cumplimiento Kindle

- Sí: estilos, colores, tamaño, alineación, brillo y voces en la hoja Aa;
  `verificar_pdf_kindle`: 41 comprobaciones.
- Sí: bordes y centro táctiles, navegación entre capítulos, pie configurable;
  pruebas de v172 y regresiones de móvil.
- Sí: acceso visible inicial a Aa y cierre sin abandonar el libro; teléfono
  vertical y horizontal, comprobación de página antes/después.
- Sí: ausencia del bucle de repintado en el escenario que lo producía.
- Sí: imagen de portada y procedencia transferidas entre dos contextos;
  metadatos sin imagen no afirman disponer de ella.
- Sí: animación y arrastre; `verificar_pdf_animacion`: 107 comprobaciones.
- Sí: catálogo Fish intacto; 29 comprobaciones de huellas.
- No: equivalencia exacta con Kindle nativo o animación original comprobada.
- No verificado: los libros privados, cuenta de sincronización y teléfono
  físico del dueño; la prueba de transferencia usa paquetes reales de la app
  entre dos contextos, sin una cuenta de nube personal.
- No: carátula auténtica disponible para todo archivo sin fuente; cuando
  faltan PDF e imagen de catálogo se conserva la provisional.

## Resumen de acciones

Validación local: 58 archivos `test_*.mjs` con código 0; navegador completo
157, Kindle 41, móvil 60, geometría 137, scroll 39, figuras 18, orientación
236, organización 37, Unir palabras 18, estabilidad 24 y animación 107,
sin fallos en sus ejecuciones finales. Las pruebas usan PDF controlados y
dobles para voz; no acreditan escucha de voces reales ni uso de un teléfono físico.

1. Corregido el bucle, la vida de las imágenes y las marcas sincronizadas.
2. Corregido el acceso y encaje de ajustes; aclarado el aviso.
3. Reforzada la animación y añadida regresión de estabilidad móvil.
4. Publicación y resultados finales: `CAMBIOS_PDF.md`, apartado v173.
