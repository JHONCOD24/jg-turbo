/* JG Turbo · «Unir palabras» en el lector, en un navegador de verdad
 *
 * Abre un PDF donde «sorprendentes» quedó partido en «sorprend» + «entes» sin
 * guion —el caso que reportó el usuario— y comprueba el comportamiento
 * completo: el tercer botón junto a Lectura y Editar, la unión automática al
 * abrir la página, el aviso con Deshacer, y que dos palabras reales seguidas
 * («de la», «sin embargo») no se peguen nunca.
 *
 *   node tests/verificar_pdf_unir_palabras.mjs
 */
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { resolve, join, extname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { crearLibroConPalabraPartida } from './generarPdfPrueba.mjs';

const app = resolve(import.meta.dirname, '..');
const { chromium } = await import(pathToFileURL(resolve(app, '../JG Turbo_OLD/node_modules/playwright/index.mjs')));
const destino = resolve(app, '.playwright-cli/pdf-unir');
await mkdir(destino, { recursive: true });
const pdf = join(destino, 'partida.pdf');
crearLibroConPalabraPartida(pdf);

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
const comprobar = (nombre, cond, detalle = '') => {
  if (cond) { ok++; console.log(`OK: ${nombre}`); }
  else { fallos.push(`${nombre}${detalle ? ` — ${detalle}` : ''}`); console.log(`FALLO: ${nombre}${detalle ? ` — ${detalle}` : ''}`); }
};

const navegador = await chromium.launch({ headless: !process.argv.includes('--headed') });
const pagina = await navegador.newPage({ viewport: { width: 1280, height: 900 } });
pagina.on('pageerror', (e) => fallos.push(`error de JavaScript: ${e}`));

try {
  await pagina.goto(base);
  await pagina.locator('#tabPdf').click();
  await pagina.locator('#pdfInput').setInputFiles(pdf);
  await pagina.locator('#btnPdfRead').click();
  await pagina.locator('#pdfLectura p').first().waitFor();
  await pagina.waitForTimeout(2500);

  console.log('\n── 1. El tercer cuadrito, junto a los otros dos ────────────────');
  await pagina.locator('#btnPdfHerramientas').click();
  const trio = await pagina.evaluate(() => {
    const barra = document.querySelector('.pdf-modo-barra');
    const ids = [...barra.querySelectorAll('button')].map((b) => b.id);
    const b = document.getElementById('btnPdfUnirPalabras');
    const est = b ? getComputedStyle(b) : null;
    const ref = document.getElementById('pdfVistaEditar');
    return {
      ids,
      existe: !!b,
      mismaClase: !!b && b.className.split(' ')[0] === ref.className.split(' ')[0],
      mismoAlto: !!b && Math.round(b.getBoundingClientRect().height) === Math.round(ref.getBoundingClientRect().height),
      visible: !!b && b.offsetParent !== null && est.visibility !== 'hidden',
    };
  });
  comprobar('existe el botón «Unir palabras»', trio.existe);
  comprobar('va junto a Lectura y Editar, en ese orden',
    trio.ids.slice(0, 3).join(',') === 'pdfVistaLectura,pdfVistaEditar,btnPdfUnirPalabras',
    trio.ids.join(','));
  comprobar('se ve igual que los otros dos', trio.mismaClase && trio.mismoAlto);
  comprobar('está a la vista', trio.visible);
  await pagina.keyboard.press('Escape');

  console.log('\n── 2. Se une solo, sin pedir nada ──────────────────────────────');
  await pagina.waitForFunction(
    () => (document.querySelector('#pdfOutput')?.value || '').includes('sorprendentes'),
    null, { timeout: 20000 },
  ).catch(() => {});
  const texto = await pagina.locator('#pdfOutput').inputValue();
  comprobar('«sorprend» + «entes» quedó unido en «sorprendentes»', texto.includes('sorprendentes'),
    `el texto dice: ${JSON.stringify(texto.slice(0, 120))}`);
  comprobar('ya no queda el trozo suelto «sorprend »', !/sorprend\s/.test(texto));
  comprobar('«conver» + «sacion» también se unió', texto.includes('conversacion'),
    `el texto dice: ${JSON.stringify(texto.slice(0, 200))}`);

  console.log('\n── 3. Lo que NO debe tocar ─────────────────────────────────────');
  comprobar('«de la» sigue separado', texto.includes('de la'));
  comprobar('«sin embargo» sigue separado', texto.includes('sin embargo'));
  comprobar('no aparecen palabras pegadas de más', !texto.includes('dela') && !texto.includes('sinembargo'));

  console.log('\n── 4. El aviso dice qué hizo y deja deshacerlo ─────────────────');
  const aviso = await pagina.evaluate(() => {
    const a = document.getElementById('pdfUnirAviso');
    return {
      existe: !!a,
      visible: !!a && !a.hidden,
      texto: a ? a.textContent.trim() : '',
      tieneDeshacer: !!document.getElementById('btnPdfUnirDeshacer'),
      educado: !!a && a.getAttribute('role') === 'status',
    };
  });
  comprobar('aparece el aviso', aviso.existe && aviso.visible);
  comprobar('el aviso dice cuántas unió', /\d+\s+palabra/.test(aviso.texto), aviso.texto);
  comprobar('el aviso no interrumpe a quien usa lector de pantalla', aviso.educado);
  comprobar('el aviso trae «Deshacer»', aviso.tieneDeshacer);

  console.log('\n── 5. Deshacer devuelve el texto exacto ────────────────────────');
  await pagina.locator('#btnPdfUnirDeshacer').click();
  await pagina.waitForTimeout(1500);
  const tras = await pagina.locator('#pdfOutput').inputValue();
  comprobar('deshacer separa lo que se había unido', !tras.includes('sorprendentes'),
    `el texto dice: ${JSON.stringify(tras.slice(0, 120))}`);
  comprobar('deshacer no borra ni una letra del resto', tras.includes('talleres') && tras.includes('sin embargo'));

  console.log('\n── 6. A mano, desde el botón ───────────────────────────────────');
  await pagina.locator('#btnPdfHerramientas').click();
  await pagina.locator('#btnPdfUnirPalabras').click();
  await pagina.waitForTimeout(2000);
  const otraVez = await pagina.locator('#pdfOutput').inputValue();
  comprobar('el botón vuelve a unir cuando se pulsa', otraVez.includes('sorprendentes'),
    `el texto dice: ${JSON.stringify(otraVez.slice(0, 120))}`);

  console.log('\n── 7. Sin errores de JavaScript ────────────────────────────────');
  comprobar('sin errores de JavaScript', fallos.filter((f) => f.startsWith('error de JavaScript')).length === 0);
  await pagina.screenshot({ path: join(destino, 'unir.png') });
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
console.log(`✔ Unir palabras funciona en el lector. ${ok} comprobaciones.`);
