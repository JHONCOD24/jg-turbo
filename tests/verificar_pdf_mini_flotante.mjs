/* JG Turbo · El mini reproductor flotante no se desmejora solo
 *
 * Mide la interfaz real en un navegador, no cadenas en el código. Comprueba
 * lo que pidió el usuario para el botón que queda al cerrar Voz:
 *   1. arranca comprimido (círculo con el control, no la píldora entera),
 *   2. un toque lo expande (quién narra, velocidad, Ajustes),
 *   3. Ajustes abre la paleta sin apagar la voz,
 *   4. se arrastra con el dedo a cualquier sitio sin disparar toques,
 *   5. queda dentro de la pantalla y su punto se recuerda tras recargar.
 *
 *   node tests/verificar_pdf_mini_flotante.mjs
 *   JG_BASE=https://jg-turbo.vercel.app node tests/verificar_pdf_mini_flotante.mjs
 */
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { resolve, join, extname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { crearLibro } from './generarPdfPrueba.mjs';

const app = resolve(import.meta.dirname, '..');
/* Playwright no es dependencia del proyecto: se busca donde suela estar
 * (mismo patrón que verificar_pdf_geometria.mjs; la ruta única anterior
 * dejó de existir y esta verificación quedaba inejecutable). */
const { chromium } = await (async () => {
  const candidatos = [
    resolve(app, 'node_modules', 'playwright', 'index.mjs'),
    resolve(app, '..', 'node_modules', 'playwright', 'index.mjs'),
    resolve(app, '..', 'JG Turbo_OLD', 'node_modules', 'playwright', 'index.mjs'),
  ];
  for (const ruta of candidatos) {
    try { return await import(pathToFileURL(ruta).href); } catch (_) { /* siguiente */ }
  }
  console.error('FALLO: no se encontró Playwright. Instálalo con «npm i -D playwright».');
  process.exit(1);
})();
const destino = resolve(app, '.playwright-cli/pdf-mini');
await mkdir(destino, { recursive: true });
const pdf = join(destino, 'libro.pdf');
crearLibro(pdf, 24);

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
  const p = await navegador.newPage({ viewport: { width: 390, height: 844 } });
  p.on('pageerror', (e) => fallos.push(`error de JavaScript: ${e}`));
  await p.goto(base);
  await p.locator('#tabPdf').click();
  await p.locator('#pdfInput').setInputFiles(pdf);
  await p.locator('#btnPdfRead').click();
  await p.locator('#pdfLectura p').first().waitFor();
  await p.waitForTimeout(1500);
  await p.locator('#pdfLectura').click({ position: { x: 40, y: 40 } });
  await p.waitForTimeout(400);
  await p.locator('#btnPdfBmVoz').click();
  await p.waitForTimeout(400);
  /* El mini solo existe con voz activa, por diseño: se simula como en
   * `verificar_pdf_movil.mjs`, que hace lo mismo. */
  await p.evaluate(() => document.body.classList.add('jg-voz-activa'));
  await p.waitForTimeout(300);
  await p.locator('#btnPdfDockOcultar').click();
  await p.waitForTimeout(500);

  const mini = () => p.evaluate(() => {
    const m = document.querySelector('#pdfVozMini');
    const r = m.getBoundingClientRect();
    const cs = getComputedStyle(m);
    return { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height),
      estado: m.dataset.mini,
      visible: m.offsetParent !== null && cs.visibility !== 'hidden' && Number(cs.opacity) > 0.01 };
  });

  /* ── 1. Comprimido por defecto ─────────────────────────────────── */
  let m = await mini();
  comprobar('el mini arranca comprimido en círculo', m.visible && m.estado === 'no' && m.w <= 56 && m.h <= 56,
    JSON.stringify(m));
  await p.screenshot({ path: join(destino, 'mini-comprimido.png') });

  /* ── 2. Un toque lo expande ────────────────────────────────────── */
  await p.locator('#btnPdfVozMiniPausa').click();
  await p.waitForTimeout(400);
  m = await mini();
  const hayAjustes = await p.evaluate(() => {
    const b = document.querySelector('#btnPdfVozMiniAjustes');
    const r = b.getBoundingClientRect();
    return r.width > 40 && r.height > 30;
  });
  comprobar('un toque expande y muestra Ajustes', m.estado === 'si' && hayAjustes, JSON.stringify(m));
  await p.screenshot({ path: join(destino, 'mini-expandido.png') });

  /* ── 3. Ajustes abre la paleta sin apagar la voz ──────────────────
   * Vigila la regresión de la captura del puntero: tomarla en `pointerdown`
   * redirigía el `click` al contenedor y Ajustes dejaba de abrir. */
  await p.locator('#btnPdfVozMiniAjustes').click();
  await p.waitForTimeout(400);
  const dock = await p.evaluate(() => ({
    abierto: document.querySelector('#pdfDockNav')?.dataset.abierto,
    voz: document.body.classList.contains('jg-voz-activa'),
  }));
  comprobar('Ajustes abre la paleta y la voz sigue', dock.abierto === 'si' && dock.voz, JSON.stringify(dock));
  await p.locator('#btnPdfDockOcultar').click();
  await p.waitForTimeout(400);

  /* ── 4. Se arrastra con el dedo ─────────────────────────────────── */
  m = await mini();
  const desde = { x: m.x + m.w / 2, y: m.y + m.h / 2 };
  const dedo = await p.context().newCDPSession(p);
  await dedo.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: desde.x, y: desde.y }] });
  for (let i = 1; i <= 10; i += 1) {
    await dedo.send('Input.dispatchTouchEvent',
      { type: 'touchMove', touchPoints: [{ x: desde.x - (desde.x - 60) * (i / 10), y: 300 }] });
    await p.waitForTimeout(16);
  }
  await dedo.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await p.waitForTimeout(500);
  const m2 = await mini();
  comprobar('arrastrar lo mueve sin disparar toques', Math.abs(m2.x - m.x) > 60 && m2.estado === m.estado,
    `${JSON.stringify(m)} -> ${JSON.stringify(m2)}`);
  const dentro = await p.evaluate(() => {
    const r = document.querySelector('#pdfVozMini').getBoundingClientRect();
    return r.left >= 0 && r.top >= 0 && r.right <= innerWidth && r.bottom <= innerHeight;
  });
  comprobar('tras arrastrar queda dentro de la pantalla', dentro);
  await p.screenshot({ path: join(destino, 'mini-movido.png') });

  /* ── 5. El punto se recuerda ────────────────────────────────────── */
  const posGuardada = await p.evaluate(() => localStorage.getItem('jg_pdf_mini'));
  comprobar('la posición y el estado se guardan', !!posGuardada && posGuardada.includes('"x"'), posGuardada);
  await p.reload();
  await p.locator('#pdfLectura p').first().waitFor({ timeout: 30000 });
  await p.waitForTimeout(1500);
  const m3 = await p.evaluate(() => {
    document.body.classList.add('jg-voz-activa');
    return new Promise((res) => setTimeout(() => {
      const q = document.querySelector('#pdfVozMini').getBoundingClientRect();
      res({ x: Math.round(q.left), y: Math.round(q.top) });
    }, 400));
  });
  comprobar('tras recargar vuelve al punto guardado',
    Math.abs(m3.x - m2.x) <= 2 && Math.abs(m3.y - m2.y) <= 2, `${JSON.stringify(m2)} -> ${JSON.stringify(m3)}`);

  await p.close();
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
console.log(`✔ El mini flotante se comporta. ${ok} comprobaciones.`);
