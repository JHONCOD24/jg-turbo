/* JG Turbo · Lo que cuesta abrir la app
 *
 * Medido antes de esta prueba, en la pantalla de inicio (pestaña Micrófono,
 * sin tocar nada): **614 KB de módulos del lector de PDF**, con
 * `pdfController.js` solo aportando 202 KB. El comentario del código decía
 * «quien no use esta pestaña no paga ese peso», pero el `import()` se
 * disparaba al arrancar, así que lo pagaba todo el mundo.
 *
 * Aquí se comprueba lo contrario: al abrir la app no se pide ni un módulo de
 * `js/pdf/`, y al entrar en la pestaña PDF sí llegan y el lector funciona.
 *
 *   node tests/verificar_arranque_ligero.mjs
 */
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { resolve, join, extname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { crearLibro } from './generarPdfPrueba.mjs';

const app = resolve(import.meta.dirname, '..');
const { chromium, devices } = await import(pathToFileURL(resolve(app, '../JG Turbo_OLD/node_modules/playwright/index.mjs')));
const destino = resolve(app, '.playwright-cli/arranque');
await mkdir(destino, { recursive: true });
const pdf = join(destino, 'libro.pdf');
crearLibro(pdf, 8);

const tipos = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.svg': 'image/svg+xml', '.txt': 'text/plain', '.css': 'text/css', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
const servidor = createServer(async (q, r) => {
  try {
    const p = new URL(q.url, 'http://localhost').pathname;
    const f = join(app, p === '/' ? 'index.html' : p);
    r.setHeader('Content-Type', tipos[extname(f)] || 'application/octet-stream');
    r.end(await readFile(f));
  } catch { r.writeHead(404).end(); }
});
await new Promise((r) => servidor.listen(0, '127.0.0.1', r));
const base = process.env.JG_BASE || `http://127.0.0.1:${servidor.address().port}`;

let ok = 0;
const fallos = [];
const comprobar = (n, c, d = '') => {
  if (c) { ok++; console.log(`OK: ${n}`); }
  else { fallos.push(`${n}${d ? ` — ${d}` : ''}`); console.log(`FALLO: ${n}${d ? ` — ${d}` : ''}`); }
};

/* Techo generoso a propósito: no se persigue un número bonito, se persigue
   que el lector de PDF no viaje con quien no lo ha pedido. */
const TECHO_PDF_AL_ARRANCAR = 20 * 1024;

const navegador = await chromium.launch();
const ctx = await navegador.newContext({ ...devices['Pixel 7'] });
const pagina = await ctx.newPage();
const errores = [];
pagina.on('pageerror', (e) => errores.push(String(e).slice(0, 160)));

const pedidos = [];
pagina.on('response', async (r) => {
  const url = r.url();
  let kb = 0;
  try { const b = await r.body(); kb = b ? b.length : 0; } catch { /* redirecciones */ }
  pedidos.push({ url, bytes: kb });
});
const pdfPedidos = () => pedidos.filter((p) => /\/js\/pdf\//.test(p.url));
const sumaPdf = () => pdfPedidos().reduce((a, p) => a + p.bytes, 0);

try {
  console.log('\n── 1. Abrir la app sin tocar nada ──────────────────────────────');
  await pagina.goto(base, { waitUntil: 'domcontentloaded' });
  await pagina.waitForSelector('#tabPdf', { state: 'visible' });
  await pagina.waitForLoadState('networkidle').catch(() => {});
  await pagina.waitForTimeout(1500);

  const alArrancar = sumaPdf();
  const listaArranque = pdfPedidos().map((p) => `${(p.bytes / 1024).toFixed(0)} KB ${p.url.split('/').pop().split('?')[0]}`);
  console.log(`   módulos de js/pdf/ al arrancar: ${(alArrancar / 1024).toFixed(0)} KB`);
  if (listaArranque.length) console.log('   ' + listaArranque.slice(0, 6).join(' · '));
  comprobar('el lector de PDF no viaja con quien abre la app',
    alArrancar <= TECHO_PDF_AL_ARRANCAR, `llegaron ${(alArrancar / 1024).toFixed(0)} KB`);

  const total = pedidos.reduce((a, p) => a + p.bytes, 0);
  console.log(`   total descargado al arrancar: ${(total / 1024).toFixed(0)} KB`);
  comprobar('la app abre pidiendo menos de 1 MB', total < 1024 * 1024,
    `${(total / 1024).toFixed(0)} KB`);
  comprobar('sin errores de JavaScript al arrancar', errores.length === 0, errores.join(' | '));

  console.log('\n── 2. Al entrar en PDF, el lector llega y funciona ─────────────');
  await pagina.locator('#tabPdf').click();
  await pagina.waitForFunction(() => !!window.jgPdfListo, null, { timeout: 20000 });
  comprobar('el lector se inicializa al abrir la pestaña', await pagina.evaluate(() => !!window.jgPdfListo));
  comprobar('y entonces sí llegan sus módulos', sumaPdf() > TECHO_PDF_AL_ARRANCAR,
    `${(sumaPdf() / 1024).toFixed(0)} KB`);

  await pagina.locator('#pdfInput').setInputFiles(pdf);
  await pagina.locator('#btnPdfRead').click();
  await pagina.locator('#pdfLectura p').first().waitFor({ timeout: 60000 });
  comprobar('un libro se abre y se lee con normalidad',
    (await pagina.locator('#pdfLectura p').count()) > 0);
  comprobar('sin errores de JavaScript tras usar el lector', errores.length === 0, errores.join(' | '));
} finally {
  await navegador.close();
  servidor.close();
}

console.log(`\n${'─'.repeat(64)}`);
if (fallos.length) {
  console.log(`✖ ${ok} OK · ${fallos.length} fallos:`);
  fallos.forEach((f) => console.log(`   · ${f}`));
  process.exit(1);
}
console.log(`✔ La app abre ligera y el lector llega cuando se pide. ${ok} comprobaciones.`);
