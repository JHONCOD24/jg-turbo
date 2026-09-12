/* Prueba funcional del Contenido: scroll visible con ratón y marcas manuales.
 *   node tests/verificar_pdf_indice_marcas.mjs
 * Comprueba en 1280px (escritorio): la lista se desplaza con la rueda del
 * ratón, la barra es ancha y visible, saltar adelante chulea las anteriores,
 * tocar la marca deschulea sin moverse del sitio, volver a tocarla chulea, y
 * visitar el capítulo borra la marca manual.
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

const temporal = await mkdtemp(join(tmpdir(), 'jg-marcas-'));
const LIBRO = join(temporal, 'libro_marcas.pdf');
crearLibro(LIBRO, 300);

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
await pagina.locator('#btnPdfIndice').click();
await pagina.waitForTimeout(400);

/* ── Estructura: dos botones por fila, marca a tamaño de dedo ── */
{
  const filas = await pagina.locator('#pdfIndiceLista .pdf-cap').count();
  comprobar(filas >= 10, `el índice lista los capítulos (${filas})`);
  const marcas = await pagina.locator('#pdfIndiceLista .pdf-cap-marca').count();
  const cuerpos = await pagina.locator('#pdfIndiceLista .pdf-cap-cuerpo').count();
  comprobar(marcas === filas && cuerpos === filas, 'cada fila trae marca y cuerpo por separado');
  const caja = await pagina.locator('#pdfIndiceLista .pdf-cap-marca').first().boundingBox();
  comprobar((caja?.width || 0) >= 40 && (caja?.height || 0) >= 40,
    `la marca se puede tocar sin puntería (${Math.round(caja?.width || 0)}×${Math.round(caja?.height || 0)})`);
}

/* ── Scroll con ratón: la rueda mueve la lista y la barra se ve ── */
{
  const hayScroll = await pagina.evaluate(() => {
    const lista = document.getElementById('pdfIndiceLista');
    return lista && lista.scrollHeight > lista.clientHeight + 50;
  });
  comprobar(hayScroll, 'con 20 capítulos la lista necesita desplazarse');
  const antes = await pagina.evaluate(() => document.getElementById('pdfIndiceLista').scrollTop);
  await pagina.locator('#pdfIndiceLista').hover();
  await pagina.mouse.wheel(0, 600);
  await pagina.waitForTimeout(300);
  const despues = await pagina.evaluate(() => document.getElementById('pdfIndiceLista').scrollTop);
  comprobar(despues > antes, 'la rueda del ratón desplaza el Contenido');
  const barraAncha = await pagina.evaluate(async () => {
    /* Chromium no expone las reglas ::-webkit-scrollbar por cssRules; se
     * comprueba el CSS servido (lo mismo que recibe el escritorio real). */
    const html = await fetch('/index.html').then((r) => r.text());
    const pista = html.match(/\.pdf-indice-lista::-webkit-scrollbar\{([^}]*)\}/);
    const pulgar = html.match(/\.pdf-indice-lista::-webkit-scrollbar-thumb\{([^}]*)\}/);
    return {
      pista: pista ? pista[1] : '',
      pulgar: pulgar ? pulgar[1] : '',
    };
  });
  comprobar(Number.parseInt(barraAncha.pista, 10) >= 12 || /width:\s*14px/.test(barraAncha.pista),
    'la barra del Contenido es ancha (agarrable con el ratón)');
  comprobar(/var\(--lec-suave|var\(--muted/.test(barraAncha.pulgar),
    'el pulgar se ve siempre (no solo al pasar el cursor)');
  await pagina.evaluate(() => { document.getElementById('pdfIndiceLista').scrollTop = 0; });
}

/* ── Saltar a la 7 chulea las anteriores ── */
const seccion = async () => Number(String(
  (await pagina.locator('#pdfNavPos').textContent()) || ''
).replace(/^\D+/, '').split(' de ')[0]);
await pagina.locator('#pdfIndiceLista .pdf-cap-cuerpo').nth(6).click();
await pagina.waitForTimeout(700);
comprobar(await seccion() === 7, 'saltar a la fila 7 lleva a la sección 7');
{
  const estado3 = await pagina.locator('#pdfIndiceLista .pdf-cap').nth(3).getAttribute('data-estado');
  comprobar(estado3 === 'leido', 'las anteriores quedan chuleadas en automático');
}

/* ── Tocar la marca deschulea SIN moverse del sitio ── */
await pagina.locator('#pdfIndiceLista .pdf-cap-marca').nth(3).click();
await pagina.waitForTimeout(500);
{
  const estado3 = await pagina.locator('#pdfIndiceLista .pdf-cap').nth(3).getAttribute('data-estado');
  comprobar(estado3 === 'pendiente', 'tocar la marca deschulea el capítulo');
  comprobar(await seccion() === 7, 'y no te mueve del capítulo donde estabas');
  const pressed = await pagina.locator('#pdfIndiceLista .pdf-cap-marca').nth(3).getAttribute('aria-pressed');
  comprobar(pressed === 'true', 'la marca queda anotada como manual');
}

/* ── Volver a tocarla la chulea de nuevo ── */
await pagina.locator('#pdfIndiceLista .pdf-cap-marca').nth(3).click();
await pagina.waitForTimeout(500);
{
  const estado3 = await pagina.locator('#pdfIndiceLista .pdf-cap').nth(3).getAttribute('data-estado');
  comprobar(estado3 === 'leido', 'tocarla otra vez la vuelve a chulear');
}

/* ── Chulear una pendiente que no se ha visitado ── */
await pagina.locator('#pdfIndiceLista .pdf-cap-marca').nth(15).click();
await pagina.waitForTimeout(500);
{
  const estado15 = await pagina.locator('#pdfIndiceLista .pdf-cap').nth(15).getAttribute('data-estado');
  comprobar(estado15 === 'leido', 'también se puede chulear un capítulo pendiente');
}

/* ── Visitar el capítulo borra su marca manual ── */
await pagina.locator('#pdfIndiceLista .pdf-cap-cuerpo').nth(3).click();
await pagina.waitForTimeout(700);
{
  comprobar(await seccion() === 4, 'el cuerpo navega al capítulo elegido');
  const pressed = await pagina.locator('#pdfIndiceLista .pdf-cap-marca').nth(3).getAttribute('aria-pressed');
  comprobar(pressed === 'false', 'visitar el capítulo borra la marca manual');
}

comprobar(errores.length === 0, `sin errores de JavaScript (${errores.length})`);
await navegador.close();
servidor.close();
console.log(fallos === 0 ? '✔ Contenido: scroll y marcas en orden' : `\n${fallos} FALLO(S)`);
process.exit(fallos === 0 ? 0 : 1);
