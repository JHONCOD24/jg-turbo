/* Prueba del adjunto estructurado jg-lectura.json (plan §4, auditoría H4/H5).
 *
 * Usa una candidata real generada por el lote (omisible sin ruta):
 *   JG_PDF_ADJUNTO="ruta/al - JG Turbo.pdf" node tests/test_pdf_adjunto.mjs
 *
 * Comprueba:
 * 1. El adjunto se lee: versión soportada, ids estables por bloque,
 *    total_bloques == bloques.length, títulos de libro.
 * 2. La correspondencia con las páginas del mismo PDF es válida.
 * 3. Un adjunto con versión desconocida (999) o truncado se RECHAZA
 *    (el caso exacto del hallazgo 4 de la auditoría).
 * 4. Las marcas de pausa estructural de la voz se generan tras títulos
 *    (700 ms) y al abrir capítulo (1000 ms).
 */
import { readFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const AQUI = dirname(fileURLToPath(import.meta.url));
const RUTAS = [
  process.env.JG_PDF_ADJUNTO,
  'pdf/Libros listos para JG Turbo/Candidatas/Cashvertising - Drew Eric Whitman - JG Turbo.pdf',
].filter(Boolean);

let ok = 0;
const bien = (nombre) => { ok += 1; console.log('OK: ' + nombre); };
const mal = (nombre) => { console.error('FALLO: ' + nombre); process.exitCode = 1; };

const { leerAdjuntoEstructurado, validarAdjuntoContrapaginas, extraerPaginas } =
  await import(pathToFileURL(resolve(AQUI, '../js/pdf/extractorPdf.js')).href);
const voz = await import(pathToFileURL(resolve(AQUI, '../js/pdf/vozTexto.js')).href);

/* ── Casos negativos con documentos falsos (hallazgo 4 de la auditoría) ── */
const falso999 = {
  getAttachments: async () => ({
    'jg-lectura.json': {
      content: new TextEncoder().encode(JSON.stringify({
        version: '999', id: 'x', titulo: 'T', autor: 'A',
        bloques: [{ id: 'b00001', rol: 'cuerpo', txt: 'hola mundo', pag: 1 }],
      })),
    },
  }),
};
const r999 = await leerAdjuntoEstructurado(falso999);
(r999 === null ? bien : mal)('adjunto con versión 999 se rechaza (no esEstructurado)');

const falsoTruncado = {
  getAttachments: async () => ({
    'jg-lectura.json': {
      content: new TextEncoder().encode(JSON.stringify({
        version: '1.1.0', id: 'x', total_bloques: 5,
        bloques: [{ id: 'b00001', rol: 'cuerpo', txt: 'hola mundo', pag: 1 }],
      })),
    },
  }),
};
const rTrunc = await leerAdjuntoEstructurado(falsoTruncado);
(rTrunc === null ? bien : mal)('adjunto truncado (1 de 5 bloques) se rechaza');

const falsoSinIds = {
  getAttachments: async () => ({
    'jg-lectura.json': {
      content: new TextEncoder().encode(JSON.stringify({
        version: '1.1.0', id: 'x',
        bloques: [{ rol: 'cuerpo', txt: 'hola mundo', pag: 1 }],
      })),
    },
  }),
};
const rSinId = await leerAdjuntoEstructurado(falsoSinIds);
(rSinId === null ? bien : mal)('adjunto sin ids por bloque se rechaza');

/* ── Marcas de pausa estructural ── */
const vozTitulo = voz.prepararParaVoz('Capítulo uno\n\nEl contenido sigue aquí con más texto.', 'es', { neural: true });
(/§P0700§/.test(vozTitulo) ? bien : mal)('título suelto genera pausa de 700 ms en neural');
const vozNavegador = voz.prepararParaVoz('Capítulo uno\n\nEl contenido sigue.', 'es', { neural: false });
(!/§P\d+§/.test(vozNavegador) && /[.:]$/.test(vozNavegador.split('\n\n')[0]) ? bien : mal)('navegador sin marcas (pausa con signo)');
const vozCap = voz.conPausaDeCapitulo('El cuerpo del capítulo.');
(vozCap.startsWith('§P1000§') ? bien : mal)('cambio de capítulo antepone pausa de 1000 ms');

/* ── Candidata real ── */
const ruta = RUTAS.find((r) => r && existsSync(resolve(AQUI, '..', r)));
if (!ruta) {
  console.log('omitido: sin candidata real (define JG_PDF_ADJUNTO)');
  console.log(`\n${ok} comprobaciones OK`);
  process.exit(process.exitCode || 0);
}

const legacy = resolve(AQUI, '../js/vendor/pdfjs/pdf.legacy.min.mjs');
const pdfjs = await import(pathToFileURL(legacy).href);
pdfjs.GlobalWorkerOptions.workerSrc = pathToFileURL(
  resolve(AQUI, '../js/vendor/pdfjs/pdf.worker.legacy.min.mjs')).href;

const datos = new Uint8Array(readFileSync(resolve(AQUI, '..', ruta)));
const tarea = pdfjs.getDocument({ data: datos, useSystemFonts: true, isEvalSupported: false });
const doc = await tarea.promise;

const adj = await leerAdjuntoEstructurado(doc);
(adj && adj.esEstructurado ? bien : mal)('candidata: adjunto leído y marcado esEstructurado');
(adj && /^1\.\d+\.\d+$/.test(adj.version) ? bien : mal)('candidata: versión soportada (' + (adj && adj.version) + ')');
if (adj) {
  (adj.bloques.every((b) => typeof b.id === 'string' && b.id) ? bien : mal)('candidata: todos los bloques con id');
  (adj.titulo && adj.autor ? bien : mal)(`candidata: título «${adj.titulo}» y autor «${adj.autor}»`);
  (adj.perfilMusical && adj.perfilMusical.animo ? bien : mal)('candidata: perfil musical normalizado (' + (adj.perfilMusical && adj.perfilMusical.animo) + ')');
  console.log(`  bloques: ${adj.bloques.length} | revisión ${adj.revision}`);

  const { paginas } = await extraerPaginas(doc, { hasta: doc.numPages });
  const comp = validarAdjuntoContrapaginas(adj, paginas);
  console.log('  correspondencia: ' + comp.detalle);
  (comp.valido ? bien : mal)('candidata: adjunto corresponde con las páginas');
}
await tarea.destroy();

console.log(`\n${ok} comprobaciones OK`);
process.exit(process.exitCode || 0);
