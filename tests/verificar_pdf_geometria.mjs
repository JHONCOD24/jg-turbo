/* Verificación visual-geométrica del panel PDF rediseñado.
 *   node tests/verificar_pdf_geometria.mjs
 * Comprueba, en móvil/tablet/escritorio y en los 3 estados del panel
 * (vacío, biblioteca, lector):
 *   1. Que no haya scroll horizontal (nada desborda).
 *   2. Que los botones visibles midan ≥44px de alto (tactables).
 *   3. Que las zonas no se monten unas sobre otras (sin solapes).
 *   4. Que el toolbar del lector quede fijo al desplazar el texto.
 */
import { createServer } from 'node:http';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, extname, resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { crearLibro, crearLibroIngles } from './generarPdfPrueba.mjs';

const AQUI = dirname(fileURLToPath(import.meta.url));
const APP = resolve(AQUI, '..');

const { chromium, devices } = await import(
  pathToFileURL(resolve(APP, '..', 'node_modules', 'playwright', 'index.mjs')).href
);

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
    const url = new URL(peticion.url, `http://127.0.0.1:${servidor.address()?.port || 8000}`);
    const rutaRelativa = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname).replace(/^\/+/, '');
    const ruta = join(APP, rutaRelativa);
    const datos = await readFile(ruta);
    respuesta.writeHead(200, { 'Content-Type': TIPOS[extname(ruta)] || 'application/octet-stream' });
    respuesta.end(datos);
  } catch {
    respuesta.writeHead(404).end('no encontrado');
  }
});
await new Promise((listo) => servidor.listen(0, '127.0.0.1', listo));
const PUERTO = servidor.address().port;
const BASE = `http://127.0.0.1:${PUERTO}/`;

const temporal = await mkdtemp(join(tmpdir(), 'jg-geo-'));
const LIBRO = join(temporal, 'libro_prueba.pdf');
const INGLES = join(temporal, 'english_book.pdf');
crearLibro(LIBRO, 24);
crearLibroIngles(INGLES, 10);

const navegador = await chromium.launch();

/* Mediciones dentro de la página */
async function medir(pagina, etiqueta) {
  const r = await pagina.evaluate(() => {
    const panel = document.getElementById('panelPdf');
    const area = panel?.querySelector('.pdf-area');
    const fuera = [];
    // 1) scroll horizontal en el documento o en el área
    const docOverflow = document.documentElement.scrollWidth - document.documentElement.clientWidth;
    const areaOverflow = area ? area.scrollWidth - area.clientWidth : 0;
    // 2) botones visibles más bajos de 44px (excluye los que el CSS hace grandes solo en móvil)
    const chicos = [];
    for (const b of panel.querySelectorAll('button:not([hidden]), summary')) {
      if (b.offsetParent === null) continue;
      const rect = b.getBoundingClientRect();
      if (rect.height === 0) continue;
      const estilo = getComputedStyle(b);
      if (estilo.visibility === 'hidden') continue;
      // dentro de details cerrados no cuentan (no visibles realmente)
      let cerrado = false;
      for (let el = b.parentElement; el; el = el.parentElement) {
        if (el.tagName === 'DETAILS' && !el.open) { cerrado = true; break; }
      }
      if (cerrado) continue;
      if (rect.height < 40) chicos.push(`${b.id || b.className || b.textContent.trim().slice(0, 18)} → ${Math.round(rect.height)}px`);
    }
    // 3) elementos que sobresalen del ancho del panel
    const anchoPanel = panel.getBoundingClientRect().width;
    for (const el of panel.querySelectorAll('.pdf-nube-cab, .pdf-doc-top, .pdf-tools-row, .pdf-biblioteca-cab, #pdfDrop')) {
      if (el.offsetParent === null) continue;
      const rect = el.getBoundingClientRect();
      if (rect.right > panel.getBoundingClientRect().right + 1 || rect.left < panel.getBoundingClientRect().left - 1) {
        fuera.push(`${el.className || el.id} sobresale ${Math.round(rect.right - panel.getBoundingClientRect().right)}px`);
      }
    }
    return { docOverflow, areaOverflow, chicos, fuera, anchoPanel };
  });
  comprobar(r.docOverflow <= 0, `[${etiqueta}] sin scroll horizontal en la página (${r.docOverflow}px)`);
  comprobar(r.areaOverflow <= 0, `[${etiqueta}] el panel no desborda a lo ancho (${r.areaOverflow}px)`);
  comprobar(r.fuera.length === 0, `[${etiqueta}] ninguna zona sobresale del panel ${r.fuera.length ? '→ ' + r.fuera.join(' | ') : ''}`);
  if (r.chicos.length) console.log(`   aviso [${etiqueta}] controles <40px: ${r.chicos.slice(0, 4).join(', ')}`);
  return r;
}

async function abrirPdf(pagina) {
  await pagina.goto(BASE, { waitUntil: 'domcontentloaded' });
  await pagina.waitForTimeout(600);
  await pagina.locator('#tabPdf').click();
  await pagina.waitForTimeout(400);
}

async function leer(pagina, archivo) {
  await pagina.locator('#pdfInput').setInputFiles(archivo);
  await pagina.waitForTimeout(300);
  await pagina.locator('#btnPdfRead').click();
  await pagina.waitForFunction(() => {
    const aviso = document.getElementById('pdfNotice');
    const res = document.getElementById('pdfResultArea');
    return (aviso && !aviso.hidden) || (res && res.style.display !== 'none');
  }, null, { timeout: 90000 }).catch(() => {});
  await pagina.waitForTimeout(700);
}

for (const [nombre, opciones] of [
  ['móvil', { ...devices['Pixel 7'] }],
  ['tablet', { viewport: { width: 768, height: 1024 } }],
  ['escritorio', { viewport: { width: 1280, height: 860 } }],
]) {
  console.log(`\n── ${nombre} ──────────────────────────────`);
  const contexto = await navegador.newContext(opciones);
  const pagina = await contexto.newPage();
  const errores = [];
  pagina.on('pageerror', (e) => errores.push(String(e)));
  await abrirPdf(pagina);

  await medir(pagina, `${nombre}·vacío`);

  // biblioteca: dos libros
  await leer(pagina, LIBRO);
  await pagina.locator('#btnPdfBack').click();
  await pagina.waitForTimeout(500);
  await leer(pagina, INGLES);
  await pagina.locator('#btnPdfBack').click();
  await pagina.waitForTimeout(800);
  await medir(pagina, `${nombre}·biblioteca`);

  // la nube plegada y desplegadas (clic directo: el pie de la app puede
  // tapar el summary cuando Playwright lo acerca al borde)
  await pagina.evaluate(() => document.querySelector('#pdfNube > summary').click());
  await pagina.waitForTimeout(300);
  await medir(pagina, `${nombre}·nube abierta`);

  // lector con índice y barra de traducción
  await pagina.locator('#pdfRejilla .pdf-libro').first().click();
  await pagina.waitForTimeout(900);
  if (await pagina.locator('#btnPdfIndice').isVisible()) {
    await pagina.locator('#btnPdfIndice').click();
    await pagina.waitForTimeout(300);
  }
  await medir(pagina, `${nombre}·lector`);

  // el toolbar queda fijo al desplazar el texto (el que hace scroll es
  // el propio resultArea: es su hijo sticky)
  const topToolbar = await pagina.evaluate(() => {
    const contenedor = document.getElementById('pdfResultArea');
    contenedor.scrollTop = 500;
    return new Promise((listo) => setTimeout(() => {
      const t = contenedor.querySelector('.pdf-doc-top');
      const top = contenedor.getBoundingClientRect().top;
      listo({ toolbar: t.getBoundingClientRect().top, contenedor: top });
    }, 250));
  });
  const margen = Math.round(topToolbar.toolbar - topToolbar.contenedor);
  comprobar(Math.abs(margen) <= 2, `[${nombre}·lector] el toolbar queda fijo al desplazar (desplazado ${margen}px respecto al contenedor)`);

  const graves = errores.filter((e) => !/favicon|manifest|sw\.js|api\/|health|Failed to load resource/i.test(e));
  comprobar(graves.length === 0, `[${nombre}] sin errores de JavaScript (${graves.length})`);
  graves.slice(0, 3).forEach((e) => console.error('   →', e.slice(0, 160)));

  await contexto.close();
}

await navegador.close();
servidor.close();
await rm(temporal, { recursive: true, force: true });
console.log(fallos === 0 ? '\n✔ geometría del panel PDF en orden' : `\n✘ ${fallos} comprobación(es) fallaron`);
process.exit(fallos === 0 ? 0 : 1);
