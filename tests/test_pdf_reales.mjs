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
const cortes = [];
if (/\bBos\s+ton\b/i.test(r.texto) || /\bbos\s+ton\b/.test(r.texto)) cortes.push('Boston');
if (/\bA\s+RN\b/.test(r.texto)) cortes.push('ARN');
if (/alu\s+vió?n/i.test(r.texto)) cortes.push('aluvión');
if (/\bes\s+ta\s+conclus/i.test(r.texto)) cortes.push('esta');

console.log(`páginas=${totalPaginas} atomos=${atomos.length} pendientes=${r.pendientes} chars=${r.texto.length}`);
const fallos = [];
if (cortes.length || r.pendientes > 0) {
  fallos.push(`cortes=${cortes.join(',') || 'ninguno'} pendientes=${r.pendientes}`);
}
// Columnas, escaneado y omisiones: se informa, no se exige un valor concreto.
const porMotivo = {};
for (const o of r.omisiones || []) porMotivo[o.motivo] = (porMotivo[o.motivo] || 0) + 1;
console.log(`columnas=${r.esDobleColumna ? 2 : 1} omisiones=${JSON.stringify(porMotivo)}`);
// Palabras con guion: un guion minúscula-espacio-minúscula es una partición
// sin resolver (el léxico franco-Alemán lleva mayúscula y el diálogo usa —).
const sinResolver = r.texto.match(/[a-záéíóúüñ]- [a-záéíóúüñ]/g) || [];
if (sinResolver.length) fallos.push(`guiones_sin_resolver=${sinResolver.slice(0, 3).join('|')}`);
// Párrafos entre páginas: un page-break solo es párrafo con puntuación
// terminal o título/lista; si no, la frase debe continuar.
for (const lim of r.limites || []) {
  if (lim.kind === 'page-break' && lim.decision === 'paragraph') {
    const izq = (r.atomos || []).find((a) => a.id === lim.leftAtomId);
    if (izq && !/[.!?…»”"')\]]\s*$/.test(String(izq.str || '')) && !/^(capítulo|capitulo|parte|prólogo|anexo)/i.test(String(lim.rightFragment || ''))) {
      // Se permite si la línea era corta (final real de párrafo por geometría).
      if (!lim.evidence || (lim.evidence.leftWidthRatio || 1) > 0.72) {
        fallos.push(`parrafo_entre_paginas_sin_punto=${lim.id}`);
        break;
      }
    }
  }
}
if (!invarianteLetras(r.atomos, r.texto, r.limites)) fallos.push('invariante_de_letras');
// Páginas escaneadas (sin texto) se informan; el OCR es solo a petición.
const sinTexto = (r.paginasConTexto || 0) < totalPaginas
  ? `paginas_sin_texto=${totalPaginas - (r.paginasConTexto || 0)}` : null;
if (sinTexto) console.log(`aviso: ${sinTexto} (OCR disponible a petición)`);
if (fallos.length) {
  console.error(`FALLO: ${fallos.join(' ')}`);
  process.exit(1);
}
console.log('OK: cero cortes visibles, guiones resueltos, párrafos entre páginas y cero pendientes en el PDF real');
process.exit(0);
