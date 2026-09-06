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

/* Playwright no es dependencia del proyecto: se busca donde suela estar. La
 * ruta única anterior (`../node_modules`) dejó de existir al aplanar el repo y
 * esta verificación quedó inejecutable sin que nadie se enterara. */
const { chromium, devices } = await (async () => {
  const candidatos = [
    resolve(APP, 'node_modules', 'playwright', 'index.mjs'),
    resolve(APP, '..', 'node_modules', 'playwright', 'index.mjs'),
    resolve(APP, '..', 'JG Turbo_OLD', 'node_modules', 'playwright', 'index.mjs'),
  ];
  for (const ruta of candidatos) {
    try { return await import(pathToFileURL(ruta).href); } catch (_) { /* siguiente */ }
  }
  console.error('FALLO: no se encontró Playwright. Instálalo con «npm i -D playwright».');
  console.error('Buscado en:\n  ' + candidatos.join('\n  '));
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

const navegador = await chromium.launch({ headless: !process.argv.includes('--headed') });

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
      if (rect.height < 44) chicos.push(`${b.id || b.className || b.textContent.trim().slice(0, 18)} → ${Math.round(rect.height)}px`);
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
  comprobar(r.chicos.length === 0, `[${etiqueta}] controles de al menos 44×44px ${r.chicos.length ? '→ ' + r.chicos.slice(0, 4).join(', ') : ''}`);
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

async function volverBiblioteca(pagina) {
  const inmersivo = await pagina.evaluate(() => document.body.classList.contains('jg-inmersivo'));
  if (inmersivo) {
    await pagina.locator('#pdfLectura').click({ position: { x: 30, y: 30 } });
    await pagina.waitForTimeout(120);
  }
  await pagina.locator('#btnPdfBack').click();
}

for (const [nombre, opciones] of [
  ['móvil pequeño', { viewport: { width: 320, height: 640 } }],
  ['móvil', { viewport: { width: 390, height: 844 } }],
  ['tablet', { viewport: { width: 768, height: 1024 } }],
  ['tablet ancha', { viewport: { width: 1024, height: 768 } }],
  ['escritorio', { viewport: { width: 1280, height: 860 } }],
  ['escritorio ancho', { viewport: { width: 1440, height: 900 } }],
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
  await volverBiblioteca(pagina);
  await pagina.waitForTimeout(500);
  await leer(pagina, INGLES);
  await volverBiblioteca(pagina);
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

  /* Pantalla completa (solo escritorio): tiene que VERSE distinta — cromo
   * adelgazado y más alto de texto — y se sale con Escape. */
  if (nombre === 'escritorio ancho' && await pagina.locator('#btnPdfPantalla').isVisible()) {
    await pagina.keyboard.press('Escape'); // cierra hojas (el índice quedó abierto)
    await pagina.waitForTimeout(300);
    const altoAntes = await pagina.evaluate(() => document.querySelector('#pdfLectura').getBoundingClientRect().height);
    await pagina.locator('#btnPdfPantalla').click();
    await pagina.waitForTimeout(500);
    const pc = await pagina.evaluate(() => ({
      ident: getComputedStyle(document.querySelector('.pdf-doc-ident')).display,
      acciones: [...document.querySelectorAll('.pdf-doc-acciones > *')]
        .filter((e) => getComputedStyle(e).display !== 'none').map((e) => e.id),
      alto: document.querySelector('#pdfLectura').getBoundingClientRect().height,
    }));
    comprobar(pc.ident === 'none', `[${nombre}·pantalla] el título se aparta`);
    comprobar(pc.acciones.length === 1 && pc.acciones[0] === 'btnPdfPantalla',
      `[${nombre}·pantalla] solo queda salir`, pc.acciones.join(','));
    comprobar(pc.alto > altoAntes + 40, `[${nombre}·pantalla] el texto gana alto visible`,
      `${Math.round(altoAntes)} → ${Math.round(pc.alto)} px`);
    await pagina.keyboard.press('Escape');
    await pagina.waitForTimeout(300);
    comprobar(!(await pagina.evaluate(() => document.body.classList.contains('jg-pantalla'))),
      `[${nombre}·pantalla] Escape sale`);
  }

  /* Un solo eje de desplazamiento durante la lectura. Se excluyen los
   * desplegables cerrados (p. ej. el panel de Opciones dentro de su <details>)
   * y los overlays fijos (p. ej. la hoja modal de consentimiento): tienen
   * contenido que desborda y contarían como «ejes», pero el lector no se
   * desplaza por ellos. Medido con sonda: sin este filtro salen 3
   * (Opciones, consentimiento y el textarea de edición) en las seis pantallas,
   * aunque el eje visible sea uno solo. */
  const desplazables = await pagina.evaluate(() => {
    const zona = document.getElementById('pdfResultArea');
    if (!zona) return 0;
    return [...zona.querySelectorAll('*')].filter((n) => {
      const e = getComputedStyle(n);
      if (!/(auto|scroll)/.test(e.overflowY) || !(n.scrollHeight > n.clientHeight + 4)) return false;
      if (e.position === 'fixed') return false;
      for (let el = n.parentElement; el; el = el.parentElement) {
        if (el.tagName === 'DETAILS' && !el.open) return false;
      }
      return true;
    }).length;
  });
  comprobar(desplazables <= 1,
    `${nombre}: un solo contenedor se desplaza durante la lectura (hay ${desplazables})`);

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
