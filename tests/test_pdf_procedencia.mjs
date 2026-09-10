/* Píldora Adaptado/Original de la tarjeta (auditoría 2026-09-10).
 * Casos reales de la biblioteca en pdf/. Ejecutar: node tests/test_pdf_procedencia.mjs
 */
import { procedenciaLibro } from '../js/pdf/procedencia.js';
import { detectarOrigenContenido, origenTextoRegistro } from '../js/pdf/procedencia.js';
import { componerRegistroDocumento } from '../js/pdf/biblioteca.js';

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

/* ── Evidencia del contenido (manda sobre el nombre) ── */
comprobar(detectarOrigenContenido('Texto refluido para lectura\0 digital') === 'adaptado', 'el marcador NUL delata al adaptado');
comprobar(detectarOrigenContenido('Edición adaptada para lectura en JG Turbo') === 'adaptado', 'la mención de edición adaptada delata');
comprobar(detectarOrigenContenido('Érase una vez un libro cualquiera sin marcas.') === undefined, 'sin marcas no se afirma nada');
comprobar(detectarOrigenContenido('') === undefined, 'muestra vacía no afirma nada');
comprobar(origenTextoRegistro({ titulo: 'Libro X', nombreArchivo: 'libro.pdf', muestra: 'a\0b' }) === 'adaptado', 'el contenido manda sobre un nombre sin marcas');
comprobar(origenTextoRegistro({ titulo: 'Libro X', nombreArchivo: 'Libro X - edición adaptada.pdf', muestra: 'texto normal' }) === 'adaptado', 'sin marcas en texto vale el nombre');
comprobar(origenTextoRegistro({ titulo: 'Libro X', nombreArchivo: 'libro.pdf', muestra: 'texto normal' }) === undefined, 'sin evidencia no se guarda nada');

/* ── El registro lo guarda al importar y lo conserva después ── */
{
  const conPartes = componerRegistroDocumento({}, { id: 'a', titulo: 'Libro X', nombreArchivo: 'x.pdf' }, {
    partes: [{ titulo: 'P', texto: 'Edición adaptada para lectura en JG Turbo. Había una vez.' }], ahora: 1000,
  });
  comprobar(conPartes.origenTexto === 'adaptado', 'al importar con evidencia se guarda adaptado');
  const sinContenido = componerRegistroDocumento(conPartes, { id: 'a', titulo: 'Libro X' }, { ahora: 2000 });
  comprobar(sinContenido.origenTexto === 'adaptado', 'sin contenido nuevo se conserva el flag');
  const normal = componerRegistroDocumento({}, { id: 'b', titulo: 'Otro', nombreArchivo: 'otro.pdf' }, {
    partes: [{ titulo: 'P', texto: 'Texto normal sin marcas.' }], ahora: 1000,
  });
  comprobar(normal.origenTexto === undefined, 'sin evidencia no se inventa flag');
}

console.log(fallos ? `\n${fallos} FALLO(S)` : '\nTodo en verde');
process.exit(fallos ? 1 : 0);
