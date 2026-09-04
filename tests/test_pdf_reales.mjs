/* PDF reales de aceptación. No se publican.
 *
 *   JG_PDF_REAL=tests/private/libro.pdf node tests/test_pdf_reales.mjs
 *
 * Omite si no hay ruta. Nunca imprime el texto completo del libro.
 */
import { readFileSync, existsSync } from 'node:fs';
import { reconstruirDocumento } from '../js/pdf/reconstruccion.js';
import { extraerAtomosDeTextContent } from '../js/pdf/atomos.js';

const ruta = process.env.JG_PDF_REAL;
if (!ruta) {
  console.log('omitido: define JG_PDF_REAL para probar un PDF privado');
  process.exit(0);
}
if (!existsSync(ruta)) {
  console.error(`no existe ${ruta}`);
  process.exit(1);
}

const pdfjs = await import('../js/vendor/pdfjs/pdf.min.mjs');
pdfjs.GlobalWorkerOptions.workerSrc = '../js/vendor/pdfjs/pdf.worker.min.mjs';

const datos = new Uint8Array(readFileSync(ruta));
const doc = await pdfjs.getDocument({ data: datos, useSystemFonts: true, isEvalSupported: false }).promise;
const totalPaginas = doc.numPages;
const atomos = [];
for (let n = 1; n <= totalPaginas; n += 1) {
  const pagina = await doc.getPage(n);
  const vista = pagina.getViewport({ scale: 1 });
  const tc = await pagina.getTextContent({ includeMarkedContent: true });
  atomos.push(...extraerAtomosDeTextContent(tc, { page: n, viewport: vista }));
  pagina.cleanup();
}
await doc.destroy();

const r = reconstruirDocumento([], { atomos });
const cortes = [];
if (/\bBos\s+ton\b/i.test(r.texto) || /\bbos\s+ton\b/.test(r.texto)) cortes.push('Boston');
if (/\bA\s+RN\b/.test(r.texto)) cortes.push('ARN');
if (/alu\s+vió?n/i.test(r.texto)) cortes.push('aluvión');
if (/\bes\s+ta\s+conclus/i.test(r.texto)) cortes.push('esta');

console.log(`páginas=${totalPaginas} atomos=${atomos.length} pendientes=${r.pendientes} chars=${r.texto.length}`);
if (cortes.length || r.pendientes > 0) {
  console.error(`FALLO: cortes=${cortes.join(',') || 'ninguno'} pendientes=${r.pendientes}`);
  process.exit(1);
}
console.log('OK: cero cortes visibles y cero pendientes en el PDF real');
process.exit(0);
