/* Herramienta de medida (no es una prueba): reconstruye el mismo libro dos
   veces —sin y con las listas de palabras— y compara las decisiones de corte.
   Responde a «¿cuántas palabras partidas recompone de verdad el diccionario?».

     JG_PDF_REAL=tests/private/becoming.pdf node tests/_impacto_lexico.mjs
*/
import { readFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';

const app = resolve(import.meta.dirname, '..');
const ruta = process.env.JG_PDF_REAL;
if (!ruta) { console.log('define JG_PDF_REAL'); process.exit(0); }

const pdfjs = await import(pathToFileURL(join(app, 'js/vendor/pdfjs/pdf.legacy.min.mjs')).href);
pdfjs.GlobalWorkerOptions.workerSrc = pathToFileURL(join(app, 'js/vendor/pdfjs/pdf.worker.legacy.min.mjs')).href;
const { reconstruirDesdeAtomos } = await import('../js/pdf/reconstruccion.js');
const { extraerAtomosDeTextContent } = await import('../js/pdf/atomos.js');
const lexico = await import('../js/pdf/lexico.js');

const datos = new Uint8Array(await readFile(resolve(app, ruta)));
const doc = await pdfjs.getDocument({ data: datos, useSystemFonts: false }).promise;
const atomos = [];
const paginas = [];
for (let n = 1; n <= doc.numPages; n += 1) {
  const p = await doc.getPage(n);
  const vista = p.getViewport({ scale: 1 });
  paginas.push({ numero: n, ancho: vista.width, alto: vista.height });
  const contenido = await p.getTextContent();
  for (const a of extraerAtomosDeTextContent(contenido, n)) atomos.push(a);
}

const contar = (r) => {
  const c = { join: 0, space: 0, paragraph: 0, pending: 0 };
  for (const l of r.limites) c[l.decision] = (c[l.decision] || 0) + 1;
  return c;
};
const opciones = { paginas, lang: 'es' };
const sin = reconstruirDesdeAtomos(atomos, opciones);
const antes = contar(sin);

await lexico.cargarLexico('es', (i) => readFile(join(app, `js/vendor/lexico/${i}.txt`), 'utf8'));
await lexico.cargarLexico('en', (i) => readFile(join(app, `js/vendor/lexico/${i}.txt`), 'utf8'));
const con = reconstruirDesdeAtomos(atomos, opciones);
const despues = contar(con);

console.log(`\nlibro: ${doc.numPages} páginas · ${atomos.length} átomos · ${sin.limites.length} límites\n`);
console.log('decisión    sin dicc.   con dicc.   diferencia');
for (const k of ['join', 'space', 'paragraph', 'pending']) {
  const a = antes[k] || 0; const d = despues[k] || 0;
  console.log(`${k.padEnd(11)} ${String(a).padStart(8)} ${String(d).padStart(11)} ${String(d - a > 0 ? '+' + (d - a) : d - a).padStart(12)}`);
}
console.log(`\npendientes: ${antes.pending} → ${despues.pending} (${Math.round((1 - despues.pending / antes.pending) * 100)} % resueltos)`);
console.log(`uniones nuevas: ${(despues.join || 0) - (antes.join || 0)}`);
