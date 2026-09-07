/* JG Turbo · Paleta de voz plegable en tablet y escritorio (acordeón)
 *
 * v2.54.0 dio al teléfono un dock de voz que se abre y se cierra tras el
 * botón «Voz». Esta prueba vigila que el MISMO interruptor de acordeón
 * (#btnPdfDockDesplegar) pliega y despliega la paleta entera en tablet y
 * escritorio, y que el teléfono conserva su comportamiento original
 * (la hoja abierta solo pliega voz/velocidad, no la consola).
 *
 * Lo que no se ve leyendo el CSS:
 *   1. que el estado plegado persiste tras recargar (F5),
 *   2. que plegar NO devuelve la lectura al principio del capítulo
 *      (TRAMPAS.md §«Con páginas, apartar el cromo remaqueta»),
 *   3. que el dock colapsado es una fila delgada de verdad (devuelve alto).
 *
 *   node tests/verificar_pdf_voz_acordeon.mjs
 *   JG_BASE=https://jg-turbo.vercel.app node tests/verificar_pdf_voz_acordeon.mjs
 */
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { resolve, join, extname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { crearLibro } from './generarPdfPrueba.mjs';
import { despertarCromo } from './_cromo.mjs';
import assert from 'node:assert/strict';

const app = resolve(import.meta.dirname, '..');

/* Playwright no es dependencia del proyecto: se busca donde suela estar
 * (mismo patrón que verificar_pdf_geometria.mjs). */
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

const destino = resolve(app, '.playwright-cli/pdf-voz-acordeon');
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

async function abrirLibro(width, height) {
  const p = await navegador.newPage({ viewport: { width, height } });
  p.on('pageerror', (e) => fallos.push(`error de JavaScript: ${e}`));
  await p.goto(base);
  await p.locator('#tabPdf').click();
  await p.locator('#pdfInput').setInputFiles(pdf);
  await p.locator('#btnPdfRead').click();
  await p.locator('#pdfLectura p').first().waitFor();
  await p.waitForTimeout(1800);
  return p;
}

/* Estado del dock y de la paleta, medido de verdad en el DOM. */
const estadoDock = (p) => p.evaluate(() => {
  const dock = document.querySelector('#pdfDockNav');
  const consola = dock?.querySelector('.tts-console');
  const cab = dock?.querySelector('.pdf-voz-cab');
  const btn = document.querySelector('#btnPdfDockDesplegar');
  const visible = (e) => !!e && e.offsetParent !== null && getComputedStyle(e).visibility !== 'hidden';
  const caja = (e) => (e ? Math.round(e.getBoundingClientRect().height) : 0);
  return {
    desplegado: dock?.dataset.desplegado || null,
    abierto: dock?.dataset.abierto || null,
    consolaVisible: visible(consola),
    cabVisible: visible(cab),
    btnVisible: visible(btn),
    btnExpandido: btn?.getAttribute('aria-expanded') === 'true',
    btnAlto: caja(btn),
    dockAlto: caja(dock),
    pagPos: document.querySelector('#pdfPagPos')?.textContent || '',
    selectorVozVisible: visible(dock?.querySelector('.tts-voice-select')),
  };
});

try {
  /* ── 1. Tablet y escritorio: acordeón de la paleta completa ─────────── */
  for (const [nombre, width, height] of [['tablet', 768, 1024], ['escritorio', 1440, 900]]) {
    console.log(`\n── ${nombre} (${width}×${height}) ──────────────────────────────`);
    const p = await abrirLibro(width, height);

    let e = await estadoDock(p);
    comprobar(`${nombre}: la paleta nace desplegada`, e.desplegado === 'si' && e.consolaVisible && e.btnExpandido,
      JSON.stringify({ desplegado: e.desplegado, consola: e.consolaVisible, aria: e.btnExpandido }));
    const altoDesplegado = e.dockAlto;

    /* Plegar con el interruptor. */
    await p.locator('#btnPdfDockDesplegar').click();
    await p.waitForTimeout(350);
    e = await estadoDock(p);
    comprobar(`${nombre}: plegar esconde la consola entera`, !e.consolaVisible, 'la consola sigue visible');
    comprobar(`${nombre}: plegada, la cabecera con el interruptor sigue a la vista`, e.cabVisible && e.btnVisible && !e.btnExpandido,
      JSON.stringify({ cab: e.cabVisible, btn: e.btnVisible, aria: e.btnExpandido }));
    comprobar(`${nombre}: el interruptor plegado se toca (≥44 px)`, e.btnAlto >= 44, `mide ${e.btnAlto} px`);
    comprobar(`${nombre}: el dock plegado es una fila delgada (pierde ≥40 px)`, (altoDesplegado - e.dockAlto) >= 40,
      `desplegado ${altoDesplegado} px → plegado ${e.dockAlto} px`);
    await p.screenshot({ path: join(destino, `${nombre}-plegada.png`) });

    /* Desplegar de nuevo. */
    await p.locator('#btnPdfDockDesplegar').click();
    await p.waitForTimeout(350);
    e = await estadoDock(p);
    comprobar(`${nombre}: desplegar devuelve la consola y el estado`, e.consolaVisible && e.btnExpandido && e.desplegado === 'si',
      JSON.stringify({ consola: e.consolaVisible, aria: e.btnExpandido }));
    await p.close();
  }

  /* ── 2. Plegar no devuelve la lectura al principio ────────────────────
     TRAMPAS.md: en un lector paginado, cambiar el alto del texto remaqua las
     páginas. La garantía es que el carácter visible se conserva (ancla): la
     página puede cambiar de número, pero JAMÁS vuelve a la 1 si estabas
     avanzado. Es el síntoma exacto de la trampa v2.41. */
  console.log('\n── La lectura no se pierde al plegar (escritorio) ───────────────');
  const p = await abrirLibro(1440, 900);
  const paginacionVisible = await p.evaluate(() => document.querySelector('#pdfPaginacion')?.hidden === false);
  if (paginacionVisible) {
    await p.locator('#btnPdfPagNext').click();
    await p.locator('#btnPdfPagNext').click();
    await p.waitForTimeout(250);
    const antes = await p.evaluate(() => document.querySelector('#pdfPagPos')?.textContent || '');
    await p.locator('#btnPdfDockDesplegar').click();
    await p.waitForTimeout(700); /* la remedición va con debounce de 80 ms */
    const despues = await p.evaluate(() => document.querySelector('#pdfPagPos')?.textContent || '');
    const pagina = parseInt(despues, 10) || 1;
    comprobar('plegar la paleta no devuelve la lectura a la página 1', pagina > 1,
      `antes «${antes}» → después «${despues}»`);
  } else {
    comprobar('plegar la paleta no devuelve la lectura a la página 1', true, '(sin paginación activa en este libro: nada que remaquetar)');
  }

  /* ── 3. Persistencia tras recargar (F5) ─────────────────────────────── */
  console.log('\n── El estado plegado sobrevive a F5 ────────────────────────────');
  let e = await estadoDock(p);
  if (e.desplegado !== 'no') {
    await p.locator('#btnPdfDockDesplegar').click();
    await p.waitForTimeout(250);
  }
  await p.reload();
  await p.waitForSelector('body.jg-leyendo', { timeout: 8000 });
  await p.locator('#pdfLectura p').first().waitFor({ timeout: 8000 }).catch(() => {});
  await p.waitForTimeout(1200);
  e = await estadoDock(p);
  comprobar('tras recargar, la paleta sigue plegada', e.desplegado === 'no' && !e.consolaVisible,
    JSON.stringify({ desplegado: e.desplegado, consola: e.consolaVisible }));
  await p.screenshot({ path: join(destino, 'escritorio-tras-f5.png') });

  /* Desplegar de nuevo para no dejar la preferencia plegada a la próxima. */
  await p.locator('#btnPdfDockDesplegar').click();
  await p.waitForTimeout(250);
  await p.close();

  /* ── 4. El teléfono conserva su comportamiento ────────────────────────
     Allí la paleta vive en una hoja tras el botón «Voz»: el acordeón solo
     pliega voz/velocidad DENTRO de la hoja abierta. Si esto se rompe, el
     teléfono se queda sin consola dentro de su propia hoja. */
  console.log('\n── Teléfono (390×844): la hoja sigue siendo la hoja ─────────────');
  const tel = await abrirLibro(390, 844);
  /* El lector del teléfono arranca con el cromo apartado: hay que
   * despertarlo con un toque, igual que haría una persona. */
  await despertarCromo(tel);
  await tel.locator('#btnPdfBmVoz').click();
  await tel.waitForTimeout(400);
  let m = await estadoDock(tel);
  comprobar('teléfono: la hoja «Voz» abre con la consola a la vista', m.abierto === 'si' && m.consolaVisible,
    JSON.stringify({ abierto: m.abierto, consola: m.consolaVisible }));
  await tel.locator('#btnPdfDockDesplegar').click();
  await tel.waitForTimeout(300);
  m = await estadoDock(tel);
  comprobar('teléfono: el acordeón NO esconde la consola (solo voz y velocidad)', m.consolaVisible,
    'la consola desapareció dentro de la hoja abierta');
  comprobar('teléfono: el selector de voz queda plegado dentro de la hoja', !m.selectorVozVisible && !m.btnExpandido,
    JSON.stringify({ selector: m.selectorVozVisible, aria: m.btnExpandido }));
  comprobar('teléfono: la hoja sigue abierta tras plegar los ajustes', m.abierto === 'si', `abierto=${m.abierto}`);
  await tel.screenshot({ path: join(destino, 'telefono-hoja-plegada.png') });
  await tel.close();
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
console.log(`✔ La paleta de voz pliega y despliega en todas las pantallas. ${ok} comprobaciones.`);
