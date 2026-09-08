/* Prueba funcional del Contenido lateral redimensionable (tablet/escritorio).
 *   node tests/verificar_pdf_indice_panel.mjs
 * Comprueba en 1280px: el divisor existe y se ve, arrastrar cambia el ancho y
 * lo guarda, el teclado lo mueve, colapsar muestra el riel y el riel reabre.
 */
import { createServer } from 'node:http';
import { readFile, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, extname, resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { crearLibro } from './generarPdfPrueba.mjs';

const AQUI = dirname(fileURLToPath(import.meta.url));
const APP = resolve(AQUI, '..');

const { chromium } = await (async () => {
  const candidatos = [
    resolve(APP, 'node_modules', 'playwright', 'index.mjs'),
    resolve(APP, '..', 'node_modules', 'playwright', 'index.mjs'),
    resolve(APP, '..', 'JG Turbo_OLD', 'node_modules', 'playwright', 'index.mjs'),
  ];
  for (const ruta of candidatos) {
    try { return await import(pathToFileURL(ruta).href); } catch (_) { /* siguiente */ }
  }
  console.error('FALLO: no se encontró Playwright.');
  process.exit(1);
})();

let fallos = 0;
const comprobar = (condicion, mensaje) => {
  if (condicion) console.log(`OK: ${mensaje}`);
  else { fallos += 1; console.error(`FALLO: ${mensaje}`); }
};

const TIPOS = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.json': 'application/json',
  '.webmanifest': 'application/manifest+json', '.png': 'image/png',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.pdf': 'application/pdf',
};
const servidor = createServer(async (peticion, respuesta) => {
  try {
    const url = new URL(peticion.url, 'http://127.0.0.1:8000');
    const rutaRelativa = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname).replace(/^\/+/, '');
    const datos = await readFile(join(APP, rutaRelativa));
    respuesta.writeHead(200, { 'Content-Type': TIPOS[extname(rutaRelativa)] || 'application/octet-stream' });
    respuesta.end(datos);
  } catch {
    respuesta.writeHead(404).end('no encontrado');
  }
});
await new Promise((listo) => servidor.listen(0, '127.0.0.1', listo));
const BASE = `http://127.0.0.1:${servidor.address().port}/`;

const temporal = await mkdtemp(join(tmpdir(), 'jg-indice-'));
const LIBRO = join(temporal, 'libro_prueba.pdf');
crearLibro(LIBRO, 20);

const navegador = await chromium.launch();
const pagina = await (await navegador.newContext({ viewport: { width: 1280, height: 860 } })).newPage();
const errores = [];
pagina.on('pageerror', (e) => errores.push(String(e)));

await pagina.goto(BASE, { waitUntil: 'domcontentloaded' });
await pagina.waitForTimeout(600);
await pagina.locator('#tabPdf').click();
await pagina.locator('#pdfInput').setInputFiles(LIBRO);
await pagina.locator('#btnPdfRead').click();
await pagina.waitForFunction(() => {
  const aviso = document.getElementById('pdfNotice');
  const res = document.getElementById('pdfResultArea');
  return (aviso && !aviso.hidden) || (res && res.style.display !== 'none');
}, null, { timeout: 90000 }).catch(() => {});
await pagina.waitForTimeout(700);

/* Abrir el Contenido desde la cabecera (visible en escritorio). */
await pagina.locator('#btnPdfIndice').click();
await pagina.waitForTimeout(400);

const visible = await pagina.evaluate(() => {
  const nav = document.getElementById('pdfIndice');
  const div = document.getElementById('pdfIndiceDivisor');
  if (!nav || nav.hidden || !div) return { nav: false };
  const r = div.getBoundingClientRect();
  return { nav: true, alto: Math.round(r.height), ancho: Math.round(r.width) };
});
comprobar(visible.nav === true, 'el Contenido abre con su divisor en escritorio');
comprobar(visible.alto > 100, `el divisor cubre el alto del panel (${visible.alto}px)`);

/* Arrastre: 150px a la derecha ensancha y persiste. */
const antes = await pagina.evaluate(() => ({
  var: getComputedStyle(document.querySelector('.pdf-lector-cuerpo')).getPropertyValue('--pdf-indice-ancho'),
  guardado: localStorage.getItem('jg_pdf_indice_ancho'),
}));
const caja = await pagina.locator('#pdfIndiceDivisor').boundingBox();
await pagina.mouse.move(caja.x + caja.width / 2, caja.y + 60);
await pagina.mouse.down();
await pagina.mouse.move(caja.x + caja.width / 2 + 150, caja.y + 60, { steps: 12 });
await pagina.mouse.up();
await pagina.waitForTimeout(300);
const despues = await pagina.evaluate(() => ({
  var: getComputedStyle(document.querySelector('.pdf-lector-cuerpo')).getPropertyValue('--pdf-indice-ancho'),
  guardado: localStorage.getItem('jg_pdf_indice_ancho'),
  modo: document.getElementById('pdfIndice')?.dataset.ancho,
}));
const px = (t) => Number(String(t || '').replace('px', '').trim());
comprobar(px(despues.var) - px(antes.var || '220px') >= 100, `arrastrar ensancha el panel (${antes.var.trim() || '?'} → ${despues.var.trim()})`);
comprobar(px(despues.guardado) === px(despues.var), `el ancho queda guardado (${despues.guardado})`);
comprobar(despues.modo === 'ancho', 'panel ancho despliega los títulos');

/* Teclado: flecha izquierda angosta. */
await pagina.locator('#pdfIndiceDivisor').focus();
await pagina.keyboard.press('ArrowLeft');
await pagina.waitForTimeout(200);
const teclado = await pagina.evaluate(() => getComputedStyle(document.querySelector('.pdf-lector-cuerpo')).getPropertyValue('--pdf-indice-ancho'));
comprobar(px(teclado) < px(despues.var), `el teclado angosta el panel (${despues.var.trim()} → ${teclado.trim()})`);

/* Colapsar muestra el riel; el riel reabre. */
await pagina.locator('#btnPdfIndiceColapsar').click();
await pagina.waitForTimeout(300);
const colapsado = await pagina.evaluate(() => ({
  oculto: document.getElementById('pdfIndice').hidden,
  riel: document.getElementById('btnPdfIndiceRail')?.classList.contains('mostrar'),
  caja: document.getElementById('btnPdfIndiceRail')?.getBoundingClientRect().height || 0,
}));
comprobar(colapsado.oculto === true, 'colapsar oculta el panel');
comprobar(colapsado.riel === true && colapsado.caja >= 44, `el riel aparece a tamaño de dedo (${Math.round(colapsado.caja)}px)`);

await pagina.locator('#btnPdfIndiceRail').click();
await pagina.waitForTimeout(300);
const reabierto = await pagina.evaluate(() => !document.getElementById('pdfIndice').hidden);
comprobar(reabierto === true, 'el riel vuelve a abrir el panel');

comprobar(errores.length === 0, `sin errores de JavaScript (${errores.length})${errores.length ? ' → ' + errores.join(' | ') : ''}`);

await navegador.close();
servidor.close();
console.log(fallos === 0 ? '✔ panel de Contenido en orden' : `❌ ${fallos} fallos`);
process.exit(fallos === 0 ? 0 : 1);
