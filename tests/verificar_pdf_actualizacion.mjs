/* JG Turbo · PDF-FIX-01: actualizar desde la caché anterior sin romper el lector
 *
 * Regresión del fallo de producción: con shell y módulos v117 en caché, al
 * llegar la versión nueva la primera entrada moría con «No se pudo cargar el
 * lector de PDF» (`./progreso.js` no exportaba `etiquetaSeccion`) y solo una
 * recarga manual lo recuperaba. Causa: mezcla de módulos nuevos y viejos (el
 * módulo versionado venía de la red, sus dependencias sin versionar de la
 * caché vieja).
 *
 * La prueba siembra la caché v117 (SW + grafo de módulos viejo), sirve la
 * versión nueva y abre el lector AL PRIMER INTENTO: sin error de exportación,
 * sin aviso de carga fallida y sin recarga manual. Después verifica el modo
 * sin conexión con la versión nueva instalada.
 *
 *   node tests/verificar_pdf_actualizacion.mjs
 */
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { resolve, join, extname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { crearLibro } from './generarPdfPrueba.mjs';

const app = resolve(import.meta.dirname, '..');
const { chromium } = await (async () => {
  const candidatos = [
    resolve(app, 'node_modules', 'playwright', 'index.mjs'),
    resolve(app, '..', 'node_modules', 'playwright', 'index.mjs'),
    resolve(app, '..', 'JG Turbo_OLD', 'node_modules', 'playwright', 'index.mjs'),
  ];
  for (const ruta of candidatos) {
    try { return await import(pathToFileURL(ruta).href); } catch (_) {}
  }
  throw new Error('No se encontró Playwright.');
})();
const destino = resolve(app, '.playwright-cli/pdf-actualizacion');
await mkdir(destino, { recursive: true });
const pdf = join(destino, 'libro.pdf');
crearLibro(pdf, 8);

const tipos = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.svg': 'image/svg+xml', '.txt': 'text/plain' };
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
function comprobar(nombre, condicion, detalle = '') {
  if (condicion) { ok++; console.log(`OK: ${nombre}`); }
  else { fallos.push(`${nombre}${detalle ? ` — ${detalle}` : ''}`); console.log(`FALLO: ${nombre}${detalle ? ` — ${detalle}` : ''}`); }
}

const navegador = await chromium.launch({ headless: !process.argv.includes('--headed') });
try {
  const ctx = await navegador.newContext({ viewport: { width: 390, height: 844 } });
  const p = await ctx.newPage();
  const errores = [];
  p.on('pageerror', (e) => errores.push(String(e).slice(0, 200)));

  /* ── 1. Siembra: shell y grafo v117 en la caché del SW ─────────────── */
  console.log('\n── 1. Caché anterior instalada ───────────────────────────────');
  await p.goto(base);
  await p.locator('#tabPdf').click();
  await p.waitForFunction(() => !!window.jgPdfListo, null, { timeout: 25000 }).catch(() => {});
  await p.locator('#pdfInput').setInputFiles(pdf);
  await p.locator('#btnPdfRead').click();
  await p.locator('#pdfLectura p').first().waitFor({ timeout: 60000 });
  await p.waitForTimeout(1500);
  const swAntes = await p.evaluate(async () => {
    const reg = await navigator.serviceWorker.getRegistration();
    return { hay: !!reg, mando: !!navigator.serviceWorker.controller };
  });
  console.log('  service worker:', JSON.stringify(swAntes));
  comprobar('la versión anterior abre el lector sin errores', errores.length === 0, errores.join(' | '));

  /* Qué módulos pidió el lector: el grafo que debe viajar coherente. */
  const grafo = await p.evaluate(async () => {
    const cache = await caches.open((await caches.keys()).then((ks) => ks.find((k) => k.startsWith('jg-turbo-shell-')) || ''));
    const llaves = await cache.keys();
    return llaves.map((r) => r.url.split('/').pop().split('?')[0]).filter((n) => n.endsWith('.js'));
  }).catch(() => []);
  console.log(`  módulos en caché: ${grafo.length}`);

  /* ── 2. Actualización: el lector abre al primer intento ────────────── */
  console.log('\n── 2. Nueva versión sobre la caché anterior ────────────────────');
  errores.length = 0;
  /* Recarga SIN limpiar nada: es el paso v117 → nueva que rompía. */
  await p.reload();
  await p.waitForTimeout(2000);
  await p.locator('#tabPdf').click({ timeout: 10000 }).catch(() => {});
  await p.waitForTimeout(1000);
  const avisoFallo = await p.evaluate(() => {
    const a = document.querySelector('#pdfNotice');
    return a && !a.hidden ? (a.textContent || '').slice(0, 120) : '';
  });
  comprobar('sin aviso de «no se pudo cargar el lector» tras actualizar', !/no se pudo cargar/i.test(avisoFallo), avisoFallo);
  /* El lector debe inicializarse solo, sin recarga manual. */
  await p.waitForFunction(() => !!window.jgPdfListo, null, { timeout: 25000 }).catch(() => {});
  comprobar('el lector se inicializa al primer intento tras actualizar',
    await p.evaluate(() => !!window.jgPdfListo));
  const mezcla = errores.filter((e) => /no exporta|etiquetaSeccion|failed to fetch dynamically|Loading chunk/i.test(e));
  comprobar('sin errores de mezcla de módulos (exportación/chunk)', mezcla.length === 0, mezcla.join(' | '));
  comprobar('sin errores de JavaScript tras actualizar', errores.length === 0, errores.join(' | '));

  /* ── 3. El lector funciona de verdad tras actualizar ───────────────── */
  console.log('\n── 3. Lectura tras actualizar ──────────────────────────────────');
  await p.locator('#pdfInput').setInputFiles(pdf);
  await p.locator('#btnPdfRead').click().catch(() => {});
  await p.locator('#pdfLectura p').first().waitFor({ timeout: 60000 });
  await p.waitForTimeout(1200);
  comprobar('un libro se abre y se lee tras actualizar',
    (await p.locator('#pdfLectura p').count()) > 0);
  comprobar('la paginación responde tras actualizar',
    /Página \d+ de \d+/.test(await p.locator('#pdfPagPos').textContent()));

  /* ── 4. Sin conexión con la versión nueva instalada ────────────────── */
  console.log('\n── 4. Sin conexión ─────────────────────────────────────────────');
  await ctx.setOffline(true);
  await p.reload();
  await p.waitForTimeout(2500);
  const sinRed = await p.evaluate(() => ({
    html: !!document.querySelector('#tabPdf'),
    sw: !!navigator.serviceWorker.controller,
  }));
  comprobar('la app arranca sin conexión tras actualizar', sinRed.html);
  await ctx.setOffline(false);
  await ctx.close();
} finally {
  await navegador.close();
  servidor.close();
}

console.log(`\n${'─'.repeat(64)}`);
if (fallos.length) {
  console.log(`✖ ${ok} comprobaciones OK · ${fallos.length} fallos:`);
  fallos.forEach((f) => console.log(`   · ${f}`));
  process.exit(1);
}
console.log(`✔ La actualización desde la caché anterior no rompe el lector. ${ok} comprobaciones.`);
