/* Diagnóstico: ¿qué figuras de un PDF real llegan a verse en el lector?
 *
 *   node tests/diag_figuras_libro.mjs "ruta/al/libro.pdf" [--detalle]
 *
 * Usa el mismo código que la app: extraerPaginas + componerTexto para el
 * texto, extraerFiguras (solo barrido, sin recortar) para los gráficos y
 * situarFiguras para colocarlos. Cuenta las que se pierden y por qué.
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const AQUI = dirname(fileURLToPath(import.meta.url));
const ruta = process.argv[2];
const detalle = process.argv.includes('--detalle');
if (!ruta) { console.error('uso: node tests/diag_figuras_libro.mjs <libro.pdf> [--detalle]'); process.exit(2); }

const pdfjs = await import(pathToFileURL(resolve(AQUI, '../js/vendor/pdfjs/pdf.legacy.min.mjs')).href);
pdfjs.GlobalWorkerOptions.workerSrc = pathToFileURL(resolve(AQUI, '../js/vendor/pdfjs/pdf.worker.legacy.min.mjs')).href;
const { extraerPaginas } = await import(pathToFileURL(resolve(AQUI, '../js/pdf/extractorPdf.js')).href);
const { componerTexto } = await import(pathToFileURL(resolve(AQUI, '../js/pdf/limpiezaTexto.js')).href);
const { extraerFiguras, situarFiguras } = await import(pathToFileURL(resolve(AQUI, '../js/pdf/figurasPdf.js')).href);

const tarea = pdfjs.getDocument({ data: new Uint8Array(readFileSync(ruta)), useSystemFonts: true, isEvalSupported: false });
const doc = await tarea.promise;
const { paginas } = await extraerPaginas(doc, { hasta: doc.numPages });
const { texto } = componerTexto(paginas, { indice: [], origen: 'texto' });
const { barrido, paginasConFigura } = await extraerFiguras(doc, pdfjs, { soloBarrido: true });
await tarea.destroy();

const situadas = situarFiguras(texto, barrido);
const puestas = new Set(situadas.map((f) => f.indice));
const perdidas = barrido.map((f, i) => ({ ...f, i })).filter((f) => !puestas.has(f.i));
const motivo = (f) => (!f.ancla ? 'sin_ancla' : f.ancla.length < 10 ? 'ancla_corta' : 'ancla_no_hallada');
const porMotivo = {};
for (const f of perdidas) porMotivo[motivo(f)] = (porMotivo[motivo(f)] || 0) + 1;

console.log(`páginas=${doc.numPages} conImagen=${paginasConFigura} figuras=${barrido.length} situadas=${situadas.length} perdidas=${perdidas.length} ${JSON.stringify(porMotivo)}`);
if (detalle) {
  for (const f of perdidas.slice(0, 40)) {
    console.log(`  p${f.pagina} ${motivo(f)} despues=${f.anclaDespues} ancla=«${String(f.ancla).slice(0, 60)}»`);
  }
}
