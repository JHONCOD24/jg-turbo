/* JG Turbo · El lector en un teléfono: reparto de pantalla y alcance del pulgar
 *
 * Mide la interfaz real en un navegador, no cadenas en el código. Comprueba
 * tres cosas que no se ven leyendo el CSS:
 *   1. cuánto de la pantalla es texto y cuánto son controles,
 *   2. que todo lo que se toca quepa bajo un dedo (44 px),
 *   3. que escritorio y tablet NO cambien.
 *
 *   node tests/verificar_pdf_movil.mjs
 *   JG_BASE=https://jg-turbo.vercel.app node tests/verificar_pdf_movil.mjs
 */
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { resolve, join, extname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { crearLibro } from './generarPdfPrueba.mjs';
import assert from 'node:assert/strict';

const app = resolve(import.meta.dirname, '..');
const { chromium } = await import(pathToFileURL(resolve(app, '../JG Turbo_OLD/node_modules/playwright/index.mjs')));
const destino = resolve(app, '.playwright-cli/pdf-movil');
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

/* Umbral del dedo. El propio proyecto ya lo exige en la prueba de geometría. */
const TACTIL = 44;
/* Con el cromo a la vista, el texto debe llevarse al menos esta parte de la
   pantalla. Hoy se lleva el 44 %: es justo el defecto que se corrige. */
const MIN_TEXTO_VISIBLE = 0.62;
/* El cromo se desvanece pero conserva su hueco: el texto NO crece, y esa es
   justo la garantía de que pasar de página no remaquete la lectura. Lo que se
   comprueba en modo inmersivo es que el reparto no cambie ni un píxel. */

const navegador = await chromium.launch();

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

const reparto = (p) => p.evaluate(() => {
  const lec = document.querySelector('#pdfLectura').getBoundingClientRect();
  const cab = document.querySelector('.pdf-doc-cab');
  /* Alcanzable = lo que el dedo puede tocar AHORA. Un control dentro de una
     hoja cerrada mide 30 px porque la hoja no tiene ancho, no porque esté mal
     hecho: medirlo ahí daría un fallo falso. Cada hoja se mide abierta, en su
     propio paso. */
  const visible = (e) => !!e && e.offsetParent !== null && getComputedStyle(e).visibility !== 'hidden'
    && Number(getComputedStyle(e).opacity) > 0.01
    && !e.closest('details:not([open])')
    && !e.closest('[hidden]');
  const barra = document.querySelector('#pdfBarraMovil');
  const modo = document.querySelector('.pdf-modo-barra');
  const tocables = [...document.querySelectorAll('button, [role="button"], select, summary')]
    .filter(visible)
    .map((b) => {
      const r = b.getBoundingClientRect();
      return { id: b.id || b.className.split(' ')[0] || b.tagName, w: Math.round(r.width), h: Math.round(r.height) };
    })
    .filter((b) => b.w > 0 && b.h > 0);
  return {
    ventana: innerHeight,
    anchoVentana: innerWidth,
    cabecera: cab ? Math.round(cab.getBoundingClientRect().height) : 0,
    cabeceraTop: cab ? Math.round(cab.getBoundingClientRect().top) : -1,
    textoAlto: Math.round(lec.height),
    parteTexto: lec.height / innerHeight,
    barraMovilVisible: visible(barra),
    accionesBarra: barra ? [...barra.querySelectorAll('button')].filter(visible).length : 0,
    filasModo: modo ? new Set([...modo.querySelectorAll('button')].filter(visible)
      .map((b) => Math.round(b.getBoundingClientRect().top))).size : 0,
    pequenos: tocables.filter((b) => b.h < 44 || b.w < 44),
    scrollHorizontal: document.documentElement.scrollWidth - document.documentElement.clientWidth,
  };
});

try {
  /* ── 0. La biblioteca, antes de abrir ningún libro ──────────────────
     Medido: la tarjeta del panel acababa a 653 px en una pantalla de 839 y
     dejaba 186 px de negro muerto debajo. Se veía como si la app se hubiera
     quedado a medias. */
  console.log('\n── 0. La biblioteca llena la pantalla ──────────────────────────');
  const biblio = await navegador.newPage({ viewport: { width: 390, height: 844 } });
  await biblio.goto(base);
  await biblio.locator('#tabPdf').click();
  await biblio.waitForTimeout(1500);
  const hueco = await biblio.evaluate(() => {
    const card = document.querySelector('#panelPdf > .card');
    if (!card) return { falta: true };
    const r = card.getBoundingClientRect();
    return { muerto: Math.round(innerHeight - r.bottom), alto: Math.round(r.height), ventana: innerHeight };
  });
  console.log('  hueco muerto bajo la tarjeta:', hueco.muerto, 'px');
  comprobar('la biblioteca no deja un hueco negro debajo', hueco.muerto <= 24,
    `sobran ${hueco.muerto} px`);

  /* Que la biblioteca SIGA desplazándose con volumen es obligatorio al tocar
     alturas (`TRAMPAS.md` §3: un intento anterior de llenar la pantalla dejó
     la lista sin scroll). No se duplica aquí a medias: lo mide de verdad
     `verificar_pdf_scroll.mjs`, que es la única que trabaja con nueve libros.
     Hay que correrla junto a esta. */
  await biblio.screenshot({ path: join(destino, 'biblioteca.png') });
  await biblio.close();

  /* ── 1. Teléfono 390×844: el texto manda ────────────────────────────── */
  console.log('\n── 1. Teléfono 390×844 ─────────────────────────────────────────');
  const tel = await abrirLibro(390, 844);
  let m = await reparto(tel);
  console.log('  reparto:', { cabecera: m.cabecera, texto: m.textoAlto, parte: `${Math.round(m.parteTexto * 100)} %` });

  comprobar('la cabecera del lector cabe en una fila', m.cabecera > 0 && m.cabecera <= 64, `mide ${m.cabecera} px`);
  comprobar('la cabecera completa queda dentro del borde superior', m.cabeceraTop >= 0,
    `empieza en ${m.cabeceraTop} px`);
  comprobar(`el texto se lleva al menos el ${Math.round(MIN_TEXTO_VISIBLE * 100)} % de la pantalla`,
    m.parteTexto >= MIN_TEXTO_VISIBLE, `se lleva ${Math.round(m.parteTexto * 100)} %`);
  comprobar('no hay desplazamiento horizontal', m.scrollHorizontal <= 1, `sobran ${m.scrollHorizontal} px`);
  comprobar('las acciones de lectura caben en una fila', m.filasModo === 1, `${m.filasModo} filas`);

  /* ── 2. La barra del pulgar ─────────────────────────────────────────── */
  console.log('\n── 2. La barra del pulgar ──────────────────────────────────────');
  comprobar('hay una barra inferior fija en el teléfono', m.barraMovilVisible);
  comprobar('la barra lleva exactamente 4 acciones', m.accionesBarra === 4, `lleva ${m.accionesBarra}`);
  comprobar(`todo lo que se toca mide ${TACTIL} px o más`, m.pequenos.length === 0,
    m.pequenos.map((b) => `${b.id} ${b.w}×${b.h}`).join(', '));

  /* ── 3. Controles estables y viewport real ────────────────────────── */
  console.log('\n── 3. Controles estables y viewport real ──────────────────────');
  const paginaAntes = await tel.locator('#pdfPagPos').textContent();
  await tel.locator('#btnPdfPagNext').click();
  await tel.waitForTimeout(1600);
  const dentro = await reparto(tel);
  const paginaDespues = await tel.locator('#pdfPagPos').textContent();
  console.log('  página:', { texto: dentro.textoAlto, pagina: paginaDespues });
  comprobar('los controles permanecen visibles al pasar de página', dentro.barraMovilVisible);
  comprobar('pasar página NO remaqueta el texto', dentro.textoAlto === m.textoAlto,
    `antes ${m.textoAlto} px, ahora ${dentro.textoAlto} px`);
  /* El fallo que esto vigila: al remaquetar, el reparto cambiaba y la lectura
     volvía al principio del capítulo. Pasabas de página y no pasabas nada. */
  comprobar('el salto de página se sostiene', paginaDespues.startsWith('2 de ') && paginaAntes.startsWith('1 de '),
    `${paginaAntes} → ${paginaDespues}`);
  comprobar('el número total de páginas no cambia',
    paginaAntes.split(' de ')[1] === paginaDespues.split(' de ')[1],
    `${paginaAntes} → ${paginaDespues}`);

  const viewportReal = await tel.evaluate(() => {
    const wrap = document.querySelector('body.jg-leyendo > .wrap')?.getBoundingClientRect();
    return { alto: Math.round(wrap?.height || 0), visual: Math.round(visualViewport?.height || innerHeight) };
  });
  comprobar('el lector usa la altura visible real del teléfono',
    Math.abs(viewportReal.alto - viewportReal.visual) <= 1,
    `${viewportReal.alto} px frente a ${viewportReal.visual} px`);

  /* La barra del navegador móvil reduce y amplía el viewport durante el uso.
     Reproducir ese cambio comprueba el hueco inferior que un viewport fijo no
     detecta. */
  const paginaAntesResize = await tel.locator('#pdfPagPos').textContent();
  await tel.setViewportSize({ width:390, height:720 });
  await tel.waitForTimeout(500);
  const ajustado = await tel.evaluate(() => {
    const wrap = document.querySelector('body.jg-leyendo > .wrap')?.getBoundingClientRect();
    const barra = document.querySelector('#pdfBarraMovil')?.getBoundingClientRect();
    return { alto:Math.round(wrap?.height || 0), visual:Math.round(visualViewport?.height || innerHeight),
      fondo:Math.round(barra?.bottom || 0) };
  });
  comprobar('al cambiar la barra del navegador no queda hueco inferior',
    Math.abs(ajustado.alto - ajustado.visual) <= 1 && Math.abs(ajustado.fondo - ajustado.visual) <= 1,
    JSON.stringify(ajustado));
  await tel.setViewportSize({ width:390, height:844 });
  await tel.waitForTimeout(500);
  comprobar('el cambio de alto conserva el lugar de lectura',
    (await tel.locator('#pdfPagPos').textContent()).split(' de ')[0] === paginaAntesResize.split(' de ')[0]);

  /* Un toque vacío no cambia la página ni oculta los destinos principales. */
  const paginaAntesToque = await tel.locator('#pdfPagPos').textContent();
  await tel.locator('#pdfLectura').click({ position: { x: 60, y: 60 } });
  await tel.waitForTimeout(600);
  const vuelta = await reparto(tel);
  comprobar('un toque conserva los controles', vuelta.barraMovilVisible);
  comprobar('un toque tampoco remaqueta', vuelta.textoAlto === m.textoAlto,
    `texto ${vuelta.textoAlto} px frente a ${m.textoAlto} px`);
  comprobar('un toque no cambia de página',
    await tel.locator('#pdfPagPos').textContent() === paginaAntesToque);
  /* El toque que devuelve los controles NO debe además ponerse a leer en voz
     alta: el gesto de «volver» y el de «lee desde aquí» son el mismo toque, y
     sin esto la app empezaba a narrar sola al recuperar la barra. Se pregunta
     al botón «Escuchar», que es quien sabe si suena algo. */
  comprobar('el toque no se puso a leer en voz alta',
    await tel.evaluate(() => {
      const b = document.querySelector('[data-tts-console="pdf"] [data-tts-action="toggle"]');
      return !b || b.getAttribute('aria-pressed') !== 'true';
    }));
  /* ── 4. Con la voz sonando nunca se queda sin pausa ─────────────────── */
  console.log('\n── 4. La voz siempre se puede parar ────────────────────────────');
  const conVoz = await tel.evaluate(async () => {
    document.body.classList.add('jg-voz-activa');
    document.body.classList.add('jg-inmersivo');
    await new Promise((r) => setTimeout(r, 300));
    const visible = (e) => !!e && e.offsetParent !== null && getComputedStyle(e).visibility !== 'hidden'
      && Number(getComputedStyle(e).opacity) > 0.01;
    const parar = document.querySelector('#pdfVozMini');
    const r = parar ? parar.getBoundingClientRect() : null;
    return { hay: visible(parar), w: r ? Math.round(r.width) : 0, h: r ? Math.round(r.height) : 0 };
  });
  comprobar('con la voz sonando queda un control de pausa a la vista', conVoz.hay);
  comprobar('ese control también cabe bajo el dedo', conVoz.h >= TACTIL && conVoz.w >= TACTIL,
    `mide ${conVoz.w}×${conVoz.h}`);
  await tel.evaluate(() => { document.body.classList.remove('jg-voz-activa', 'jg-inmersivo'); });

  /* ── 4c. Pasar página con el dedo ───────────────────────────────────
     En un teléfono, un lector paginado sin deslizamiento se siente roto: no
     hay scroll (es por páginas) y los únicos botones son dos flechas
     pequeñas. Lo primero que hace cualquiera es deslizar. */
  console.log('\n── 4c. Pasar página con el dedo ────────────────────────────────');
  const dedo = await tel.context().newCDPSession(tel);
  const deslizar = async (desde, hasta, y = 400) => {
    await dedo.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: desde, y }] });
    const pasos = 8;
    for (let i = 1; i <= pasos; i += 1) {
      const x = Math.round(desde + (hasta - desde) * (i / pasos));
      await dedo.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y }] });
      await tel.waitForTimeout(16);
    }
    await dedo.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await tel.waitForTimeout(700);
  };
  const pagina = () => tel.locator('#pdfPagPos').textContent();
  const numeroPagina = (etiqueta) => Number(String(etiqueta).split(' de ')[0]);

  const p0 = await pagina();
  await deslizar(330, 60);          // dedo hacia la izquierda = página siguiente
  const p1 = await pagina();
  comprobar('deslizar hacia la izquierda avanza exactamente 1 página',
    numeroPagina(p1) === numeroPagina(p0) + 1, `${p0} → ${p1}`);

  await deslizar(60, 330);          // hacia la derecha = página anterior
  const p2 = await pagina();
  comprobar('deslizar hacia la derecha retrocede exactamente 1 página',
    numeroPagina(p2) === numeroPagina(p1) - 1 && p2 === p0, `${p1} → ${p2}`);

  const fuenteVista = await readFile(join(app, 'js/pdf/libroVista.js'), 'utf8');
  comprobar('el gesto horizontal tiene un solo manejador',
    (fuenteVista.match(/el\.lectura\.addEventListener\('touchstart'/g) || []).length === 0
      && (fuenteVista.match(/el\.lectura\.addEventListener\('pointerup'/g) || []).length === 1);

  /* Un toque no es un deslizamiento: el gesto de leer desde un párrafo tiene
     que seguir intacto, y un roce mínimo no puede cambiar de página. */
  const p3antes = await pagina();
  await deslizar(200, 188);         // 12 px: eso es un toque tembloroso
  comprobar('un roce mínimo NO cambia de página', (await pagina()) === p3antes,
    `${p3antes} → ${await pagina()}`);

  /* ── 4b. Dentro de cada hoja, abierta de verdad ─────────────────────── */
  console.log('\n── 4b. Dentro de las hojas ─────────────────────────────────────');
  const medirHoja = () => tel.evaluate(() => {
    const visible = (e) => !!e && e.offsetParent !== null && getComputedStyle(e).visibility !== 'hidden'
      && Number(getComputedStyle(e).opacity) > 0.01 && !e.closest('details:not([open])') && !e.closest('[hidden]');
    return [...document.querySelectorAll('#pdfMasPanel button, #pdfMasPanel select, #pdfAparienciaHoja button, #pdfAparienciaHoja select, #pdfDockNav button, #pdfDockNav select')]
      .filter(visible)
      .map((b) => { const r = b.getBoundingClientRect(); return { id: b.id || b.className.split(' ')[0], w: Math.round(r.width), h: Math.round(r.height) }; })
      .filter((b) => b.w > 0 && b.h > 0 && (b.w < 44 || b.h < 44));
  });
  for (const [nombre, boton] of [['Opciones', '#btnPdfBmOpciones'], ['Apariencia', '#btnPdfBmApariencia'], ['Voz', '#btnPdfBmVoz']]) {
    await tel.locator(boton).click();
    await tel.waitForTimeout(500);
    const chicos = await medirHoja();
    comprobar(`en la hoja ${nombre} todo se toca con el dedo`, chicos.length === 0,
      chicos.map((b) => `${b.id} ${b.w}×${b.h}`).join(', '));
    await tel.keyboard.press('Escape');
    await tel.waitForTimeout(300);
  }

  await tel.screenshot({ path: join(destino, 'telefono.png') });
  await tel.close();

  /* ── 5. Pantalla estrecha 320×740 ───────────────────────────────────── */
  console.log('\n── 5. Pantalla estrecha 320×740 ────────────────────────────────');
  const estrecho = await abrirLibro(320, 740);
  m = await reparto(estrecho);
  console.log('  reparto:', { cabecera: m.cabecera, texto: m.textoAlto, parte: `${Math.round(m.parteTexto * 100)} %` });
  comprobar('en 320 px la cabecera sigue en una fila', m.cabecera > 0 && m.cabecera <= 64, `mide ${m.cabecera} px`);
  comprobar('en 320 px la cabecera no está cortada arriba', m.cabeceraTop >= 0,
    `empieza en ${m.cabeceraTop} px`);
  comprobar('en 320 px no aparece desplazamiento horizontal', m.scrollHorizontal <= 1, `sobran ${m.scrollHorizontal} px`);
  comprobar('en 320 px las acciones de lectura caben en una fila', m.filasModo === 1, `${m.filasModo} filas`);
  comprobar('en 320 px todo lo que se toca sigue cabiendo bajo el dedo', m.pequenos.length === 0,
    m.pequenos.map((b) => `${b.id} ${b.w}×${b.h}`).join(', '));
  await estrecho.screenshot({ path: join(destino, 'estrecho.png') });
  await estrecho.close();

  /* ── 6. Escritorio y tablet no se tocan ─────────────────────────────── */
  console.log('\n── 6. Escritorio y tablet intactos ─────────────────────────────');
  for (const [nombre, width, height, cabMax] of [['tablet', 768, 1024, 72], ['escritorio', 1440, 900, 72]]) {
    const p = await abrirLibro(width, height);
    const g = await reparto(p);
    console.log(`  ${nombre}:`, { cabecera: g.cabecera, texto: g.textoAlto, parte: `${Math.round(g.parteTexto * 100)} %` });
    comprobar(`${nombre} conserva su cabecera de una fila`, g.cabecera > 0 && g.cabecera <= cabMax, `mide ${g.cabecera} px`);
    comprobar(`${nombre} NO muestra la barra del teléfono`, !g.barraMovilVisible);
    comprobar(`${nombre} sigue sin desplazamiento horizontal`, g.scrollHorizontal <= 1, `sobran ${g.scrollHorizontal} px`);
    await p.screenshot({ path: join(destino, `${nombre}.png`) });
    await p.close();
  }
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
console.log(`✔ El lector se comporta en el teléfono. ${ok} comprobaciones.`);
