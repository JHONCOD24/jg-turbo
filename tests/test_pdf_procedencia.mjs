/* Píldora Adaptado/Original de la tarjeta (auditoría 2026-09-10).
 * Casos reales de la biblioteca en pdf/. Ejecutar: node tests/test_pdf_procedencia.mjs
 */
import { procedenciaLibro } from '../js/pdf/procedencia.js';

let fallos = 0;
function comprobar(condicion, mensaje) {
  if (condicion) console.log(`OK: ${mensaje}`);
  else { fallos += 1; console.error(`FALLO: ${mensaje}`); }
}

/* Adaptados: los tres generados para la app. */
comprobar(procedenciaLibro({ titulo: 'Secretos de Copywriting', nombreArchivo: 'Secretos de Copywriting - edición adaptada para JG Turbo.pdf' }) === 'adaptado', 'el adaptado de Secretos es adaptado');
comprobar(procedenciaLibro({ titulo: 'El placebo eres tú', nombreArchivo: 'El placebo eres tú - edición adaptada para JG Turbo.pdf' }) === 'adaptado', 'el adaptado de Placebo es adaptado');
comprobar(procedenciaLibro({ titulo: 'Conversaciones con Dios 1', nombreArchivo: 'Conversaciones con Dios 1 - edición adaptada para JG Turbo.pdf' }) === 'adaptado', 'el adaptado de Conversaciones 1 es adaptado');

/* Originales: escaneos y copias de internet. */
comprobar(procedenciaLibro({ titulo: 'El Arte de la Seducción', nombreArchivo: 'El Arte de la Seducción ( PDFDrive ).pdf' }) === 'original', 'Seducción PDFDrive es original');
comprobar(procedenciaLibro({ titulo: 'Conversaciones con Dios 2', nombreArchivo: 'Conversaciones con Dios 2 ( PDFDrive ).pdf' }) === 'original', 'Conversaciones 2 PDFDrive es original');
/* Sin señales en el nombre: no se muestra píldora (mejor callar que
 * etiquetar mal). Es el caso de «El Aprendiz de Brujo.pdf» o
 * «Conversaciones con Dios 3 Neal Donald Walsh.pdf»: se sabe que son
 * originales solo abriendo el texto, y la tarjeta no carga textos a
 * propósito (la biblioteca pinta solo metadatos para seguir instantánea). */
comprobar(procedenciaLibro({ titulo: 'El Aprendiz de Brujo', nombreArchivo: 'El Aprendiz de Brujo.pdf' }) === 'desconocida', 'sin marca en el nombre es desconocida (no se adivina)');
comprobar(procedenciaLibro({ titulo: 'Cashvertising', nombreArchivo: 'cashvertising.pdf', needsSource: true }) === 'original', 'con needsSource es original');

/* Sin señales: no se muestra píldora (mejor callar que etiquetar mal). */
comprobar(procedenciaLibro({ titulo: 'Mi documento', nombreArchivo: 'notas.pdf' }) === 'desconocida', 'sin señales es desconocida');
comprobar(procedenciaLibro({}) === 'desconocida', 'documento vacío es desconocida');
comprobar(procedenciaLibro(null) === 'desconocida', 'null no rompe');

console.log(fallos ? `\n${fallos} FALLO(S)` : '\nTodo en verde');
process.exit(fallos ? 1 : 0);
