/* JG Turbo · Paso 6b · La prueba definitiva
 *
 * Las comprobaciones del paso 6 usan PyMuPDF. Esta usa EL MISMO pdf.js que
 * lleva la app, así que responde a la única pregunta que de verdad importa:
 * ¿qué va a leer JG Turbo cuando el usuario abra este libro?
 *
 *   node 6b_verificar_con_pdfjs.mjs <ruta-al-pdf> <ruta-a-js/vendor/pdfjs>
 *
 * Sale bien cuando: 0 palabras partidas, 0 guiones suaves, 0 dobles espacios,
 * y el número de palabras coincide con bloques.json salvo el índice.
 */
import fs from 'node:fs';
import path from 'node:path';

const pdf = process.argv[2];
const vendor = process.argv[3] || './js/vendor/pdfjs';
const pdfjs = await import('file://' + path.resolve(vendor, 'pdf.legacy.min.mjs'));
pdfjs.GlobalWorkerOptions.workerSrc = path.resolve(vendor, 'pdf.worker.legacy.min.mjs');

const doc = await pdfjs.getDocument({
  data: new Uint8Array(fs.readFileSync(pdf)),
  useSystemFonts: true, isEvalSupported: false,
}).promise;

const lineas = [];
for (let p = 1; p <= doc.numPages; p += 1) {
  const tc = await (await doc.getPage(p)).getTextContent();
  let l = '';
  for (const it of tc.items) {
    if (it.str !== undefined) l += it.str;
    if (it.hasEOL) { lineas.push(l); l = ''; }
  }
  if (l) lineas.push(l);
}
const texto = lineas.join('\n');
fs.writeFileSync('extraccion_pdfjs.txt', texto, 'utf8');

const partidas = lineas.filter((l) => /[\p{L}]-$/u.test(l)).length;
const suaves = (texto.match(/­/g) || []).length;
const dobles = (texto.match(/ {2}/g) || []).length;
const control = [...texto].filter((c) => c.charCodeAt(0) < 32 && c !== '\n').length;

console.log(`páginas            ${doc.numPages}`);
console.log(`líneas             ${lineas.length}`);
console.log(`palabras           ${texto.split(/\s+/).filter(Boolean).length}`);
console.log(`partidas por guion ${partidas}   ${partidas === 0 ? '✔' : '← MAL'}`);
console.log(`guiones suaves     ${suaves}   ${suaves === 0 ? '✔' : '← MAL'}`);
console.log(`dobles espacios    ${dobles}   ${dobles === 0 ? '✔' : '← MAL'}`);
console.log(`car. de control    ${control}   ${control === 0 ? '✔' : '← MAL'}`);
console.log('\nEscrito extraccion_pdfjs.txt (lo que la app va a leer, tal cual).');
