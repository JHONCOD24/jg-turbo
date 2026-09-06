/* PDF reales de aceptación. No se publican.
 *
 *   JG_PDF_REAL=tests/private/libro.pdf node tests/test_pdf_reales.mjs
 *
 * Omite si no hay ruta. Nunca imprime el texto completo del libro.
 */
import { readFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { reconstruirDocumento, invarianteLetras } from '../js/pdf/reconstruccion.js';
import { extraerAtomosDeTextContent } from '../js/pdf/atomos.js';

const AQUI = dirname(fileURLToPath(import.meta.url));
const ruta = process.env.JG_PDF_REAL;
if (!ruta) {
  console.log('omitido: define JG_PDF_REAL para probar un PDF privado');
  process.exit(0);
}
if (!existsSync(ruta)) {
  console.error(`no existe ${ruta}`);
  process.exit(1);
}

/* En Node hace falta el build «legacy»: el moderno usa APIs que solo existen
 * en el navegador y fallaba con «n.toHex is not a function». Si no está el
 * legacy, se dice claramente en vez de morir a medias. */
const legacy = resolve(AQUI, '../js/vendor/pdfjs/pdf.legacy.min.mjs');
if (!existsSync(legacy)) {
  console.error('FALLO: falta js/vendor/pdfjs/pdf.legacy.min.mjs (build de PDF.js para Node).');
  process.exit(1);
}
const pdfjs = await import(pathToFileURL(legacy).href);
pdfjs.GlobalWorkerOptions.workerSrc = pathToFileURL(
  resolve(AQUI, '../js/vendor/pdfjs/pdf.worker.legacy.min.mjs')
).href;
/* Un fallo dentro de una promesa no puede seguir devolviendo «todo bien». */
process.on('unhandledRejection', (e) => { console.error('FALLO: ' + (e?.message || e)); process.exit(1); });

const datos = new Uint8Array(readFileSync(ruta));
/* En PDF.js 6 el destroy está en la tarea de carga, no en el documento. */
const tarea = pdfjs.getDocument({ data: datos, useSystemFonts: true, isEvalSupported: false });
const doc = await tarea.promise;
const totalPaginas = doc.numPages;
const atomos = [];
for (let n = 1; n <= totalPaginas; n += 1) {
  const pagina = await doc.getPage(n);
  const vista = pagina.getViewport({ scale: 1 });
  const tc = await pagina.getTextContent({ includeMarkedContent: true });
  atomos.push(...extraerAtomosDeTextContent(tc, { page: n, viewport: vista }));
  pagina.cleanup();
}
await tarea.destroy();

const r = reconstruirDocumento([], { atomos });
const porMotivo = {};
for (const o of r.omisiones || []) porMotivo[o.motivo] = (porMotivo[o.motivo] || 0) + 1;
console.log(`columnas=${r.esDobleColumna ? 2 : 1} omisiones=${JSON.stringify(porMotivo)}`);
const sinTexto = (r.paginasConTexto || 0) < totalPaginas
  ? `paginas_sin_texto=${totalPaginas - (r.paginasConTexto || 0)}` : null;
if (sinTexto) console.log(`aviso: ${sinTexto} (OCR disponible a petición)`);

/* Las cuatro palabras de antes solo servían para un libro. Aquí se mide lo que
 * de verdad importa: cuántos indicios de corte quedan en TODO el texto.
 *
 * - Un guion con espacio detrás es una partición que no se resolvió.
 * - Una minúscula pegada a una mayúscula en medio de palabra son dos palabras
 *   que se unieron sin espacio.
 * - Dos trozos cortos separados justo antes de un signo suelen ser una palabra
 *   partida por la mitad. */
/* Los patrones se afinaron tras medirlos contra un libro de 431 páginas: los
 * dos últimos daban 39 y 544 indicios y TODOS eran falsos positivos.
 *
 * - «eartMath», «hatsApp», «ouTube» venían de HeartMath, WhatsApp y YouTube:
 *   faltaba anclar al principio de palabra, así que cualquier nombre en
 *   mayúscula intercalada contaba como error. Con `\b` delante, un nombre
 *   propio bien escrito ya no cuenta y una unión real («casaMesa») sí.
 * - «in awe», «of him», «et al» son inglés normal, no palabras partidas. Dos
 *   trozos cortos solo son sospechosos si al unirlos forman una palabra que el
 *   propio documento usa entera en otro sitio: esa es la única evidencia que
 *   distingue «alu vión» de «in awe». */
const patrones = [
  [/\w+-\s+\w+/g, 'guion de partición sin resolver'],
  [/\b[a-záéíóúñ]{2,}[A-ZÁÉÍÓÚÑ][a-záéíóúñ]{2,}/g, 'dos palabras pegadas sin espacio'],
];
console.log(`páginas=${totalPaginas} atomos=${atomos.length} pendientes=${r.pendientes} chars=${r.texto.length}`);
console.log(`fidelidad=${r.estadoFidelidad?.estado || 'sin_datos'} transformaciones=${r.transformaciones?.length || 0}`);
for (const [patron, motivo] of patrones) {
  const hallados = r.texto.match(patron) || [];
  /* Solo un ejemplo corto: el libro es privado y no se vuelca en la consola. */
  if (hallados.length) console.log(`  · ${motivo}: ${hallados.length} (ej. «${hallados[0].slice(0, 40)}»)`);
}

/* Palabra partida con evidencia: dos trozos separados cuya unión aparece en el
 * propio documento como palabra entera, y que por separado no son palabras que
 * el documento use. Sin esa segunda condición, «in awe» (que sí une «inawe»
 * en ninguna parte) y cualquier par de artículos darían falso positivo. */
{
  /* El vocabulario incluye palabras de dos letras: «to» y «do» son palabras
   * reales, y sin ellas «to do» pasaba por partida solo porque «todo» existe. */
  const palabras = new Set((r.texto.toLowerCase().match(/[a-záéíóúñ]{2,}/g) || []));
  const sospechosas = [];
  const pares = r.texto.match(/\b[a-záéíóúñ]{2,5}\s+[a-záéíóúñ]{2,5}\b/g) || [];
  for (const par of pares) {
    const [izq, der] = par.toLowerCase().split(/\s+/);
    if (!palabras.has(izq + der)) continue;      /* la unión no existe en el libro */
    if (palabras.has(izq) && palabras.has(der)) continue; /* ambas son palabras reales */
    sospechosas.push(par);
    if (sospechosas.length >= 200) break;
  }
  if (sospechosas.length) {
    console.log(`  · palabra partida con evidencia: ${sospechosas.length} (ej. «${sospechosas[0]}»)`);
  }
}

const fallos = [];
/* El invariante mira los átomos que sí entraron al texto: los números de
 * página omitidos no cuentan (si se pasa la lista cruda, fallan 27 letras
 * que el motor descartó a propósito). */
if (!invarianteLetras(r.atomos, r.texto, r.limites)) fallos.push('el invariante de letras no se cumple');
if (r.estadoFidelidad?.integridad?.valido !== true
    || r.estadoFidelidad?.integridad?.coincidenciaExacta !== true) {
  fallos.push('la transcripción no se puede reproducir carácter por carácter desde su ledger');
}
/* «1962- author» y «alpha- and» son guion de rango o suspendido, no un
 * corte de renglón. Solo fallan los que no son cifra ni coordinador. */
const guiones = r.texto.match(/\w+-\s+\w+/g) || [];
const guionesSinResolver = guiones.filter((g) => {
  const m = String(g).match(/^(\S+)-(\s+)(\S+)$/);
  if (!m) return true;
  if (/^\d+$/.test(m[1])) return false;
  if (/^(and|or|y|o|e|to|the|a|an)$/i.test(m[3])) return false;
  return true;
});
if (guionesSinResolver.length) {
  fallos.push('quedan guiones de partición sin resolver');
  console.log(`  · partición real sin resolver: ${guionesSinResolver.length} (ej. «${guionesSinResolver[0].slice(0, 40)}»)`);
}
console.log(fallos.length
  ? `\n❌ ${fallos.join('; ')}`
  : '\n✅ Libro real reconstruido sin cortes sin resolver.');
process.exit(fallos.length ? 1 : 0);
