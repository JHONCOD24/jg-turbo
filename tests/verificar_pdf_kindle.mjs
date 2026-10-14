/* JG Turbo · Lector estilo Kindle (hoja «Aa», bordes, pie, capítulos de corrido, voces Fish)
 *
 * Mide en un navegador real lo que la hoja «Aa» promete, en teléfono y tablet:
 *   · los cinco colores de página, y que sobreviven a recargar;
 *   · estilos rápidos, A−/A+, grosor, letra legible, alineación y brillo;
 *   · tocar los bordes pasa página, el centro trae los controles;
 *   · el pie cambia de dato al tocarlo;
 *   · pasar la última página entra al capítulo siguiente y volver atrás
 *     desde la primera cae en la ÚLTIMA página del anterior;
 *   · la voz se elige entre las voces fijas de Fish sin cambiar el catálogo.
 *
 *   node tests/verificar_pdf_kindle.mjs
 */
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { resolve, join, extname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { crearLibro } from './generarPdfPrueba.mjs';
import { despertarCromo } from './_cromo.mjs';

const app = resolve(import.meta.dirname, '..');
const { chromium } = await (async () => {
  const candidatos = [
    resolve(app, 'node_modules', 'playwright', 'index.mjs'),
    resolve(app, '..', 'node_modules', 'playwright', 'index.mjs'),
    resolve(app, '..', 'JG Turbo_OLD', 'node_modules', 'playwright', 'index.mjs'),
  ];
  for (const ruta of candidatos) {
    try { return await import(pathToFileURL(ruta).href); } catch (_) { /* siguiente */ }
  }
  return await import('playwright');
})();
const destino = resolve(app, '.playwright-cli/pdf-kindle');
await mkdir(destino, { recursive: true });
const pdf = join(destino, 'libro.pdf');
crearLibro(pdf, 34); // tres capítulos (cada 15 páginas uno nuevo)

const tipos = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.svg': 'image/svg+xml', '.css': 'text/css', '.woff2': 'font/woff2' };
const servidor = createServer(async (q, r) => {
  try {
    const p = new URL(q.url, 'http://localhost').pathname;
    const f = join(app, p === '/' ? 'index.html' : p);
    r.setHeader('Content-Type', tipos[extname(f)] || 'application/octet-stream');
    r.end(await readFile(f));
  } catch { r.writeHead(404).end(); }
});
await new Promise((r) => servidor.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${servidor.address().port}`;

let ok = 0;
const fallos = [];
function comprobar(nombre, condicion, detalle = '') {
  if (condicion) { ok++; console.log(`OK: ${nombre}`); }
  else { fallos.push(`${nombre}${detalle ? ` — ${detalle}` : ''}`); console.log(`FALLO: ${nombre}${detalle ? ` — ${detalle}` : ''}`); }
}

/* El catálogo Fish, leído del propio index.html: es la referencia que la
 * hoja «Aa» no puede alterar. */
const html = await readFile(join(app, 'index.html'), 'utf8');
const bloqueCatalogo = html.slice(html.indexOf('const TTS_FISH_CATALOGO_LOCAL'), html.indexOf('];', html.indexOf('const TTS_FISH_CATALOGO_LOCAL')));
const idsCatalogo = [...bloqueCatalogo.matchAll(/id:'([^']+)'/g)].map((m) => m[1]);
const bloqueRetiradas = html.slice(html.indexOf('const TTS_FISH_RETIRADAS'), html.indexOf(']);', html.indexOf('const TTS_FISH_RETIRADAS')));
const retiradas = new Set([...bloqueRetiradas.matchAll(/'([^']+)'/g)].map((m) => m[1]));
const fishEsperadas = idsCatalogo.filter((id) => !retiradas.has(id)).map((id) => `fish:${id}`).sort();

const navegador = await chromium.launch({ headless: !process.argv.includes('--headed') });

async function abrirLibro(width, height, { tactil = false, fish = true, contexto = null } = {}) {
  const ctx = contexto || await navegador.newContext({ viewport: { width, height }, hasTouch: tactil, isMobile: tactil });
  const p = await ctx.newPage();
  p.on('pageerror', (e) => fallos.push(`error de JavaScript (${width}): ${e}`));
  if (fish) {
    /* Fish activo sin lista del servidor: la app usa su catálogo local. */
    await p.route('**/api/tts-voices', (r) => r.fulfill({ contentType: 'application/json', body: JSON.stringify({ engines: { fish: { active: true, voices: {} } } }) }));
  }
  await p.goto(base);
  await p.locator('#tabPdf').click();
  await p.locator('#pdfInput').setInputFiles(pdf);
  await p.locator('#btnPdfRead').click();
  await p.locator('#pdfLectura p').first().waitFor();
  await p.waitForTimeout(1800);
  return { p, ctx };
}

async function abrirAa(p) {
  await despertarCromo(p);
  const enTel = await p.evaluate(() => matchMedia('(max-width:640px)').matches);
  await p.locator(enTel ? '#btnPdfBmApariencia' : '#btnPdfApariencia').click();
  await p.locator('#pdfAparienciaHoja').waitFor({ state: 'visible' });
}
const leer = (p, fn, arg) => p.evaluate(fn, arg);
const pagina = (p) => leer(p, () => {
  const t = document.getElementById('pdfPagPos')?.textContent || '';
  const m = t.match(/(\d+)\s+de\s+(\d+)/);
  return m ? { actual: Number(m[1]), total: Number(m[2]) } : null;
});
const capitulo = (p) => leer(p, () => document.getElementById('pdfNavPos')?.textContent || document.getElementById('pdfDocDonde')?.textContent || '');

/* ═══ Teléfono 390×844 (táctil) ═══ */
{
  const { p, ctx } = await abrirLibro(390, 844, { tactil: true });
  await abrirAa(p);

  /* Colores de página */
  const temas = await leer(p, () => [...document.querySelectorAll('#pdfAparienciaHoja [data-tema]')].map((b) => b.dataset.tema));
  comprobar('teléfono: cinco colores de página en la hoja', temas.join() === 'papel,sepia,verde,noche,negro', temas.join());
  await p.locator('#btnPdfTemaVerde').click();
  comprobar('teléfono: Verde tiñe el lector', await leer(p, () => document.getElementById('pdfResultArea').dataset.tema) === 'verde');
  comprobar('teléfono: Verde queda marcado (aria-pressed)', await p.locator('#btnPdfTemaVerde').getAttribute('aria-pressed') === 'true');
  const fondoVerde = await leer(p, () => getComputedStyle(document.getElementById('pdfResultArea')).getPropertyValue('--lec-bg').trim().toLowerCase());
  comprobar('teléfono: Verde usa su fondo propio', fondoVerde === '#dcead6', fondoVerde);

  /* Estilos rápidos */
  await p.locator('#pdfAparEstilos [data-estilo="grande"]').click();
  await p.waitForTimeout(250);
  const tamGrande = await leer(p, () => parseFloat(getComputedStyle(document.getElementById('pdfLectura')).fontSize));
  comprobar('teléfono: «Grande» pone la letra en 24 px', Math.abs(tamGrande - 24) < 0.6, String(tamGrande));
  comprobar('teléfono: «Grande» queda marcado', await p.locator('#pdfAparEstilos [data-estilo="grande"]').getAttribute('aria-pressed') === 'true');
  comprobar('teléfono: el estilo rápido no cambia el color de página', await leer(p, () => document.getElementById('pdfResultArea').dataset.tema) === 'verde');

  /* A− / A+ */
  await p.locator('#btnPdfAparMas').click();
  comprobar('teléfono: A+ sube un punto (25)', await p.locator('#pdfAparTam').inputValue() === '25');
  comprobar('teléfono: tras A+ ningún estilo rápido queda marcado', await leer(p, () => !document.querySelector('#pdfAparEstilos [aria-pressed="true"]')));
  await p.locator('#pdfAparTam').fill('14'); await p.locator('#pdfAparTam').dispatchEvent('input');
  comprobar('teléfono: en el mínimo, A− queda desactivado', await p.locator('#btnPdfAparMenos').isDisabled());
  await p.locator('#pdfAparEstilos [data-estilo="estandar"]').click();

  /* Grosor, letra legible, alineación */
  await p.locator('#pdfAparGrosor').selectOption('negrita');
  comprobar('teléfono: grosor Negrita = 600', await leer(p, () => getComputedStyle(document.querySelector('#pdfLectura p')).fontWeight) === '600');
  await p.locator('#pdfAparGrosor').selectOption('normal');
  await p.locator('#pdfAparFuente').selectOption('legible');
  const espaciado = await leer(p, () => parseFloat(getComputedStyle(document.querySelector('#pdfLectura p')).letterSpacing) || 0);
  comprobar('teléfono: letra Legible abre espacio entre letras', espaciado > 0.3, String(espaciado));
  await p.locator('#pdfAparFuente').selectOption('serif');
  await p.locator('#pdfAparAlinear').selectOption('izquierda');
  comprobar('teléfono: alineación a la izquierda manda sobre el justificado', await leer(p, () => getComputedStyle(document.querySelector('#pdfLectura p')).textAlign) !== 'justify');
  await p.locator('#pdfAparAlinear').selectOption('auto');
  comprobar('teléfono: «Automática» vuelve al justificado del teléfono', await leer(p, () => getComputedStyle(document.querySelector('#pdfLectura p')).textAlign) === 'justify');

  /* Brillo */
  await p.locator('#pdfAparBrillo').fill('60'); await p.locator('#pdfAparBrillo').dispatchEvent('input');
  const velo = await leer(p, () => { const s = getComputedStyle(document.body, '::after'); return { op: parseFloat(s.opacity), pe: s.pointerEvents, cont: s.content }; });
  comprobar('teléfono: brillo 60 % pone un velo de ~0,3', Math.abs(velo.op - 0.3) < 0.02 && velo.cont !== 'none', JSON.stringify(velo));
  comprobar('teléfono: el velo no se come los toques', velo.pe === 'none');

  /* Voz: solo las voces fijas de Fish, y son las del catálogo */
  /* La voz que suena ahora puede ir marcada aparte («Voz guardada»): no es
   * del catálogo y no cuenta. */
  const guardadas = await leer(p, () => [...document.querySelectorAll('#pdfAparVoz option[data-guardada]')].map((o) => o.value));
  comprobar('teléfono: a lo sumo una entrada aparte para la voz que suena ahora', guardadas.length <= 1 && guardadas.every((v) => !v.startsWith('fish:')), guardadas.join());
  const enAa = await leer(p, () => [...document.querySelectorAll('#pdfAparVoz option:not([data-guardada])')].map((o) => o.value));
  const enDock = await leer(p, () => [...document.querySelectorAll('#pdfDockNav [data-tts-voice-select] option')].map((o) => o.value).filter((v) => v.startsWith('fish:')));
  comprobar('teléfono: la hoja «Aa» ofrece solo voces de Fish', enAa.length > 0 && enAa.every((v) => v.startsWith('fish:')), enAa.slice(0, 3).join());
  comprobar('teléfono: son exactamente las del catálogo (ni una más, ni una menos)', JSON.stringify([...enAa].sort()) === JSON.stringify(fishEsperadas), `${enAa.length} vs ${fishEsperadas.length}`);
  comprobar('teléfono: y las mismas que el selector del reproductor', JSON.stringify([...enAa].sort()) === JSON.stringify([...enDock].sort()));
  await p.locator('#pdfAparVoz').selectOption('fish:roberto');
  await p.waitForTimeout(200);
  comprobar('teléfono: elegir Roberto en «Aa» lo elige también en el reproductor', await leer(p, () => document.querySelector('#pdfDockNav [data-tts-voice-select]').value) === 'fish:roberto');

  /* Pie: elegir y tocar para cambiar */
  await p.locator('#pdfAparProgreso').selectOption('pagina');
  const piePagina = await p.locator('#pdfPiePorcentaje').textContent();
  comprobar('teléfono: el pie muestra la página del capítulo', /^Página \d+ de \d+ del capítulo$/.test(piePagina.trim()), piePagina);
  await p.locator('#pdfAparienciaHoja .pdf-hoja-cerrar').click();
  await p.waitForTimeout(300);
  await p.locator('#pdfPieLectura').click();
  await p.waitForTimeout(150);
  comprobar('teléfono: tocar el pie pasa al siguiente dato («nada»)', (await p.locator('#pdfPiePorcentaje').textContent()).trim() === '');
  await p.locator('#pdfPieLectura').click();
  await p.waitForTimeout(150);
  comprobar('teléfono: y otro toque vuelve al % del libro', / % del libro$/.test((await p.locator('#pdfPiePorcentaje').textContent()).trim()));

  /* Bordes */
  const caja = await p.locator('#pdfLectura').boundingBox();
  const y = caja.y + caja.height * 0.5;
  const antes = await pagina(p);
  await p.touchscreen.tap(caja.x + caja.width - 20, y);
  await p.waitForTimeout(700);
  const tras = await pagina(p);
  comprobar('teléfono: tocar el borde derecho avanza una página', antes && tras && tras.actual === antes.actual + 1, `${JSON.stringify(antes)} → ${JSON.stringify(tras)}`);
  comprobar('teléfono: pasar página con el borde no despierta los controles', await leer(p, () => document.body.classList.contains('jg-inmersivo')));
  await p.touchscreen.tap(caja.x + 20, y);
  await p.waitForTimeout(700);
  comprobar('teléfono: tocar el borde izquierdo vuelve', (await pagina(p))?.actual === antes.actual);
  await p.touchscreen.tap(caja.x + caja.width / 2, y);
  await p.waitForTimeout(600);
  comprobar('teléfono: tocar el centro trae los controles y no pasa página', !(await leer(p, () => document.body.classList.contains('jg-inmersivo'))) && (await pagina(p))?.actual === antes.actual);

  /* Apagar los bordes */
  await abrirAa(p);
  await p.locator('#pdfAparBordes').uncheck();
  await p.locator('#pdfAparienciaHoja .pdf-hoja-cerrar').click();
  await p.waitForTimeout(300);
  await p.touchscreen.tap(caja.x + caja.width - 20, y);
  await p.waitForTimeout(700);
  comprobar('teléfono: con los bordes apagados, tocar el borde no pasa página', (await pagina(p))?.actual === antes.actual);

  /* Recargar conserva todo */
  await p.reload();
  await p.locator('#pdfLectura p').first().waitFor({ timeout: 20000 }).catch(() => {});
  await p.waitForTimeout(1500);
  const tras5 = await leer(p, () => ({ tema: document.getElementById('pdfResultArea').dataset.tema, cfg: JSON.parse(localStorage.getItem('jg_pdf_lectura') || '{}') }));
  comprobar('teléfono: tras recargar sigue en Verde (antes un tema distinto de papel/noche volvía a noche)', tras5.tema === 'verde', tras5.tema);
  comprobar('teléfono: tras recargar se conservan bordes apagados y brillo', tras5.cfg.bordes === false && tras5.cfg.brillo === 60, JSON.stringify(tras5.cfg));
  await ctx.close();
}

/* ═══ Tablet 1024×768: capítulos de corrido y hoja ═══ */
{
  const { p, ctx } = await abrirLibro(1024, 768);
  await abrirAa(p);
  const ancho = await leer(p, () => document.getElementById('pdfAparienciaHoja').getBoundingClientRect());
  comprobar('tablet: la hoja «Aa» flota y cabe en la pantalla', ancho.width <= 380 && ancho.right <= 1024 && ancho.bottom <= 768 + 1, JSON.stringify(ancho));
  const desborde = await leer(p, () => { const h = document.getElementById('pdfAparienciaHoja'); return h.scrollWidth - h.clientWidth; });
  comprobar('tablet: la hoja no desborda a lo ancho', desborde <= 1, String(desborde));
  await p.locator('#pdfAparAlinear').selectOption('justificado');
  comprobar('tablet: Justificada se aplica también fuera del teléfono', await leer(p, () => getComputedStyle(document.querySelector('#pdfLectura p')).textAlign) === 'justify');
  await p.locator('#btnPdfTemaNegro').click();
  comprobar('tablet: Negro es negro puro', await leer(p, () => getComputedStyle(document.getElementById('pdfResultArea')).getPropertyValue('--lec-bg').trim()) === '#000');
  await p.locator('#pdfAparienciaHoja .pdf-hoja-cerrar').click();
  await p.waitForTimeout(300);

  /* Pasar la última página entra al capítulo siguiente */
  const cap1 = await capitulo(p);
  await p.locator('#pdfLectura').focus();
  const info = await pagina(p);
  for (let i = 0; i < (info?.total || 1) - 1; i += 1) { await p.keyboard.press('ArrowRight'); await p.waitForTimeout(80); }
  await p.waitForTimeout(500);
  const alFinal = await pagina(p);
  comprobar('tablet: con las flechas se llega a la última página del capítulo', alFinal && alFinal.actual === alFinal.total, JSON.stringify(alFinal));
  await p.locator('#pdfLectura').focus();
  await p.keyboard.press('ArrowRight');
  await p.waitForTimeout(1500);
  const cap2 = await capitulo(p);
  comprobar('tablet: una página más entra al capítulo siguiente', cap2 !== cap1, `${cap1} → ${cap2}`);
  comprobar('tablet: y empieza por su primera página', (await pagina(p))?.actual === 1);
  await p.locator('#pdfLectura').focus();
  await p.keyboard.press('ArrowLeft');
  await p.waitForTimeout(1500);
  const vuelta = await pagina(p);
  comprobar('tablet: volver atrás desde la primera regresa al capítulo anterior', (await capitulo(p)) === cap1, await capitulo(p));
  comprobar('tablet: y cae en su ÚLTIMA página, como en un libro', vuelta && vuelta.actual === vuelta.total && vuelta.total === alFinal.total, JSON.stringify(vuelta));
  await ctx.close();
}

/* ═══ Sin Fish: la hoja no queda con un selector vacío ═══ */
{
  const { p, ctx } = await abrirLibro(390, 844, { fish: false });
  const n = await leer(p, () => document.querySelectorAll('#pdfAparVoz option').length);
  comprobar('sin Fish activo, «Voz de lectura» muestra el listado completo (no queda vacío)', n > 2, String(n));
  await ctx.close();
}

await navegador.close();
servidor.close();
console.log(fallos.length ? `\n❌ ${fallos.length} fallos de ${ok + fallos.length}:\n- ${fallos.join('\n- ')}` : `\n✔ lector estilo Kindle · ${ok} comprobaciones, 0 fallos`);
process.exit(fallos.length ? 1 : 0);
