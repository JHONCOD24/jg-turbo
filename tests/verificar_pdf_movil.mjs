/* JG Turbo · El lector en un teléfono: reparto de pantalla y alcance del pulgar
 *
 * Mide la interfaz real en un navegador, no cadenas en el código. Comprueba
 * tres cosas que no se ven leyendo el CSS:
 *   1. cuánto de la pantalla es texto y cuánto son controles,
 *   2. que todo lo que se toca quepa bajo un dedo (44 px),
 *   3. que escritorio y tablet conserven una lectura amplia y sin desbordes.
 *
 *   node tests/verificar_pdf_movil.mjs
 *   JG_BASE=https://jg-turbo.vercel.app node tests/verificar_pdf_movil.mjs
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
  return await import('playwright');
})();
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
/* P-01: el cromo apartado NO deja hueco — la página crece hasta llenar la
   pantalla (antes ~25 % vacío). El sitio se conserva por carácter. Lo que se
   comprueba es que el texto crezca y que el salto de página no se pierda. */

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
    modoScroll: modo ? modo.scrollWidth - modo.clientWidth : 0,
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
  /* P-01: con el cromo apartado (estado normal de lectura) la página llena la
     pantalla. Antes dejaba ~25 % vacío porque se medía con el cromo a la vista. */
  comprobar('con el cromo apartado el texto llena al menos el 70 % de la pantalla',
    m.parteTexto >= 0.70, `se lleva ${Math.round(m.parteTexto * 100)} %`);
  /* PDF-FIX-02: ninguna línea intersecta el cromo VISIBLE. Medir altura y
     overflow no basta: el texto nacía en y=54 con la cabecera hasta y=68.
     Con el cromo apartado (P-01) el texto sí crece bajo esas cajas: los
     solapes solo se exigen con el cromo a la vista. */
  const sinSolape = await tel.evaluate(() => {
    const r = (s) => { const e = document.querySelector(s); if (!e) return null; const b = e.getBoundingClientRect(); return { top: b.top, bottom: b.bottom }; };
    const lec = document.querySelector('#pdfLectura').getBoundingClientRect();
    const cab = r('.pdf-doc-top');
    const pag = r('#pdfPaginacion');
    const barra = r('#pdfBarraMovil');
    const paras = [...document.querySelectorAll('#pdfLectura p')];
    const pri = paras.length ? paras[0].getBoundingClientRect() : null;
    const ult = paras.length ? paras[paras.length - 1].getBoundingClientRect() : null;
    const toca = (a, b) => a && b && a.top < b.bottom - 1 && b.top < a.bottom - 1;
    const chromeVisible = !document.body.classList.contains('jg-inmersivo');
    return {
      chromeVisible,
      lecTop: Math.round(lec.top), lecBottom: Math.round(lec.bottom),
      cabBottom: cab ? Math.round(cab.bottom) : 0,
      pagTop: pag ? Math.round(pag.top) : 1e9,
      barraTop: barra ? Math.round(barra.top) : 1e9,
      tocaCab: chromeVisible && toca(lec, cab), tocaPag: chromeVisible && toca(lec, pag),
      tocaBarra: chromeVisible && toca(lec, barra),
      primera: pri ? { top: Math.round(pri.top), bottom: Math.round(pri.bottom) } : null,
      ultima: ult ? { top: Math.round(ult.top), bottom: Math.round(ult.bottom) } : null,
    };
  });
  console.log('  solape:', { lec: `${sinSolape.lecTop}→${sinSolape.lecBottom}`, cabFin: sinSolape.cabBottom, pagIni: sinSolape.pagTop });
  comprobar('el texto no intersecta el encabezado', !sinSolape.tocaCab,
    `lectura ${sinSolape.lecTop} vs cabecera hasta ${sinSolape.cabBottom}`);
  comprobar('el texto no intersecta la paginación', !sinSolape.tocaPag,
    `lectura hasta ${sinSolape.lecBottom} vs paginación desde ${sinSolape.pagTop}`);
  comprobar('el texto no intersecta la barra inferior', !sinSolape.tocaBarra,
    `lectura hasta ${sinSolape.lecBottom} vs barra desde ${sinSolape.barraTop}`);
  /* Con el cromo a la vista, la primera y la última línea se ven enteras.
     Con el cromo apartado (P-01) el texto crece bajo esas cajas a propósito. */
  if (sinSolape.chromeVisible) {
    comprobar('la primera línea es visible (no cortada por el encabezado)',
      !!sinSolape.primera && sinSolape.primera.top >= sinSolape.cabBottom - 1,
      sinSolape.primera ? `primera en ${sinSolape.primera.top}, cabecera hasta ${sinSolape.cabBottom}` : 'sin párrafos');
    comprobar('la última línea es visible (no tapada por la paginación)',
      !!sinSolape.ultima && sinSolape.ultima.top <= sinSolape.pagTop - 1,
      sinSolape.ultima ? `última en ${sinSolape.ultima.top}, paginación desde ${sinSolape.pagTop}` : 'sin párrafos');
  } else {
    comprobar('con el cromo apartado la primera línea está dentro de la pantalla',
      !!sinSolape.primera && sinSolape.primera.top >= 0 && sinSolape.primera.top < 844,
      sinSolape.primera ? `primera en ${sinSolape.primera.top}` : 'sin párrafos');
  }
  /* PDF-FIX-03: el texto RENDERIZADO (no solo textContent) no duplica.
   * El CSS agregaba «Página»/«Cap.» delante de frases que JS ya escribía
   * completas («Página Página 2 de 9…»). Se inspecciona el ::before. */
  const renderizado = await tel.evaluate(() => {
    const pag = document.querySelector('#pdfPagPos');
    const nav = document.querySelector('#pdfNavPos');
    const antes = (e, seudo) => {
      if (!e) return '';
      try { return getComputedStyle(e, seudo).content || ''; } catch (_) { return ''; }
    };
    return {
      pagTexto: pag ? pag.textContent : '',
      pagAntes: antes(pag, '::before'),
      navTexto: nav ? nav.textContent : '',
      navAntes: antes(nav, '::before'),
    };
  });
  comprobar('la paginación no duplica «Página» en el renderizado',
    !/página/i.test(renderizado.pagAntes) && !/página\s+página/i.test(renderizado.pagTexto),
    JSON.stringify(renderizado));
  comprobar('la posición de sección no duplica «Cap.» en el renderizado',
    !/cap\./i.test(renderizado.navAntes) && !/cap\.\s*sección/i.test(renderizado.navTexto),
    JSON.stringify(renderizado));
  const contextoCabecera = await tel.evaluate(() => {
    const titulo = document.querySelector('#pdfResultTitle')?.textContent?.trim() || '';
    const seccion = document.querySelector('#pdfDocDonde')?.textContent?.trim() || '';
    const referencia = document.querySelector('#pdfDocRef')?.textContent?.trim() || '';
    const linea = document.querySelector('.pdf-doc-linea');
    return {
      titulo, seccion, referencia,
      desborde: linea ? Math.max(0, linea.scrollWidth - linea.clientWidth) : 999,
      repiteTitulo: !!titulo && seccion.toLocaleLowerCase('es') === titulo.toLocaleLowerCase('es'),
    };
  });
  comprobar('el título del libro no se repite como sección', !contextoCabecera.repiteTitulo,
    JSON.stringify(contextoCabecera));
  comprobar('la cabecera muestra la posición dentro del documento', /\d+\s+de\s+\d+/.test(contextoCabecera.seccion),
    contextoCabecera.seccion);
  comprobar('la cabecera muestra página y tiempo restante',
    /pág\.|página/i.test(contextoCabecera.referencia) && /min|h\b/i.test(contextoCabecera.referencia),
    contextoCabecera.referencia);
  comprobar('el contexto superior no desborda', contextoCabecera.desborde <= 1,
    `${contextoCabecera.desborde}px`);
  comprobar('no hay desplazamiento horizontal', m.scrollHorizontal <= 1, `sobran ${m.scrollHorizontal} px`);
  comprobar('las acciones secundarias están plegadas en Texto',
    await tel.locator('#pdfHerramientasMenu').getAttribute('open') === null);
  comprobar('la tira de acciones no esconde nada a los lados', m.modoScroll <= 1, `sobran ${m.modoScroll} px`);

  /* ── 2. La barra del pulgar ─────────────────────────────────────────── */
  console.log('\n── 2. La barra del pulgar ──────────────────────────────────────');
  /* El lector abre con la pantalla limpia y los controles vienen con un
     toque, como en un lector de libros. Se comprueban las DOS cosas. */
  comprobar('el lector abre con la pantalla limpia', !m.barraMovilVisible);
  await despertarCromo(tel);
  m = await reparto(tel);
  comprobar('un toque trae la barra inferior', m.barraMovilVisible);
  comprobar('la barra lleva exactamente 4 acciones', m.accionesBarra === 4, `lleva ${m.accionesBarra}`);
  comprobar(`todo lo que se toca mide ${TACTIL} px o más`, m.pequenos.length === 0,
    m.pequenos.map((b) => `${b.id} ${b.w}×${b.h}`).join(', '));

  /* ── 3. Controles estables y viewport real ────────────────────────── */
  console.log('\n── 3. Controles estables y viewport real ──────────────────────');
  const paginaAntes = await tel.locator('#pdfPagPos').textContent();
  const anclaAntesPag = await tel.evaluate(() => window.__jgPaginas().ancla);
  await tel.locator('#btnPdfPagNext').click();
  await tel.waitForTimeout(1600);
  const dentro = await reparto(tel);
  const paginaDespues = await tel.locator('#pdfPagPos').textContent();
  console.log('  página:', { texto: dentro.textoAlto, pagina: paginaDespues });
  /* CONTRATO NUEVO (diseño editorial aprobado por el usuario, 2026-09-05):
     al pasar de página los controles se APARTAN y la pantalla queda solo con
     el texto, como en un lector de libros. Antes se exigía lo contrario
     —«permanecen visibles»— porque el cromo vivía en el flujo y ocultarlo o
     dejaba una franja vacía o volvía a paginar. Ahora flota por encima, así
     que apartarlo no deja hueco ni mueve una línea, y eso lo comprueba la
     aserción siguiente. */
  comprobar('los controles se apartan al pasar de página', !dentro.barraMovilVisible);
  /* P-01: con el cromo apartado la página crece hasta llenar la pantalla
     (antes dejaba ~25 % vacío). El sitio se conserva por carácter, no por
     número de página —que puede cambiar al caber más renglones—. */
  comprobar('con el cromo apartado el texto crece y llena la pantalla',
    dentro.textoAlto >= m.textoAlto,
    `antes ${m.textoAlto} px, ahora ${dentro.textoAlto} px`);
  comprobar('el texto ocupa al menos el 70 % de la pantalla con el cromo apartado',
    dentro.parteTexto >= 0.70,
    `${Math.round(dentro.parteTexto * 100)} %`);
  /* El fallo que esto vigila: al remaquetar, la lectura volvía al principio
     del capítulo. P-01: el sitio se guarda por carácter (`pag.ancla`, que
     ninguna remedición toca: solo avanza al pasar página de verdad), así que
     se comprueba que el ancla avanzó con el clic y que su bloque sigue en
     pantalla —el número de página puede cambiar al crecer el reparto—. */
  const avance = await tel.evaluate(() => {
    const st = window.__jgPaginas();
    const art = document.querySelector('#pdfLectura');
    const lr = art.getBoundingClientRect();
    const b = [...art.querySelectorAll('[data-ini]')].reverse().find(x => Number(x.dataset.ini) <= st.ancla);
    const r = b?.getBoundingClientRect();
    return {
      ancla: st.ancla,
      enPantalla: !!r && r.left < lr.right - 2 && r.right > lr.left + 2,
      pagina: document.getElementById('pdfPagPos')?.textContent || '',
    };
  });
  comprobar('el salto de página avanza el sitio de lectura',
    avance.ancla > anclaAntesPag,
    `ancla ${anclaAntesPag} → ${avance.ancla} (${paginaAntes} → ${avance.pagina})`);
  comprobar('tras el salto el sitio queda en pantalla',
    avance.enPantalla,
    `ancla ${avance.ancla}, ${avance.pagina}`);

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
  /* El borde inferior de la barra solo dice algo cuando la barra ESTÁ a la
     vista: apartada se aparca fuera de pantalla a propósito, y medirla ahí
     daba un «hueco» que no existe. Se despierta el cromo antes de medir. */
  await tel.locator('#pdfLectura').click({ position: { x: 40, y: 40 } });
  await tel.waitForTimeout(500);
  const conCromo = await tel.evaluate(() => {
    const wrap = document.querySelector('body.jg-leyendo > .wrap')?.getBoundingClientRect();
    const barra = document.querySelector('#pdfBarraMovil')?.getBoundingClientRect();
    return { alto: Math.round(wrap?.height || 0), visual: Math.round(visualViewport?.height || innerHeight),
      fondo: Math.round(barra?.bottom || 0) };
  });
  comprobar('al cambiar la barra del navegador no queda hueco inferior',
    Math.abs(conCromo.alto - conCromo.visual) <= 1 && Math.abs(conCromo.fondo - conCromo.visual) <= 1,
    JSON.stringify(conCromo));
  /* En teléfonos reales la ventana también se DESFASA con scroll al animarse
   * la barra: la cabecera quedaba cortada arriba aunque el alto cuadrara. */
  const desfase = await tel.evaluate(() => ({ scroll: window.scrollY,
    cabeceraTop: Math.round(document.querySelector('.pdf-doc-top')?.getBoundingClientRect().top ?? -999) }));
  comprobar('el cambio de alto no desfasa la ventana ni corta la cabecera',
    desfase.scroll === 0 && desfase.cabeceraTop >= 0, JSON.stringify(desfase));
  await tel.setViewportSize({ width:390, height:844 });
  await tel.waitForTimeout(500);
  comprobar('el cambio de alto conserva el lugar de lectura',
    await tel.evaluate(() => {
      const art = document.querySelector('#pdfLectura');
      return (art?.scrollLeft || 0) >= 0 && Boolean(document.getElementById('pdfPagPos')?.textContent);
    }));

  /* Un toque vacío no cambia la página ni oculta los destinos principales. */
  const paginaAntesToque = await tel.locator('#pdfPagPos').textContent();
  await tel.locator('#pdfLectura').click({ position: { x: 60, y: 60 } });
  await tel.waitForTimeout(600);
  const vuelta = await reparto(tel);
  comprobar('un toque conserva los controles', vuelta.barraMovilVisible);
  /* Con P-01 el alto del texto depende de si el cromo está a la vista. Tras el
     toque el cromo vuelve y el alto debe volver al de `m` (cromo visible). */
  comprobar('un toque devuelve el reparto con el cromo a la vista',
    Math.abs(vuelta.textoAlto - m.textoAlto) <= 2,
    `texto ${vuelta.textoAlto} px frente a ${m.textoAlto} px`);
  comprobar('un toque no manda la lectura al principio',
    numeroPagina(await tel.locator('#pdfPagPos').textContent()) >= 1);
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
  await tel.evaluate(() => { document.body.classList.remove('jg-inmersivo'); });
  await despertarCromo(tel);
  await tel.locator('#btnPdfBmVoz').click();
  await tel.waitForTimeout(400);
  const hojaAbierta = await tel.evaluate(() => document.querySelector('#pdfDockNav')?.dataset.abierto === 'si');
  comprobar('Voz abre las herramientas sin apagar la lectura', hojaAbierta
    && await tel.evaluate(() => document.body.classList.contains('jg-voz-activa')));
  await tel.locator('#btnPdfBmVoz').click();
  await tel.waitForTimeout(400);
  const despuesOcultar = await tel.evaluate(() => {
    const dock = document.querySelector('#pdfDockNav');
    const mini = document.querySelector('#pdfVozMini');
    const vis = mini && mini.offsetParent && getComputedStyle(mini).visibility !== 'hidden'
      && Number(getComputedStyle(mini).opacity) > 0.01;
    return {
      abierto: dock?.dataset.abierto,
      voz: document.body.classList.contains('jg-voz-activa'),
      mini: !!vis,
    };
  });
  comprobar('Ocultar cierra el panel y deja la voz activa',
    despuesOcultar.abierto === 'no' && despuesOcultar.voz);
  comprobar('con el panel cerrado queda el mini reproductor', despuesOcultar.mini);
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
  function numeroPagina(etiqueta){ return Number(String(etiqueta).replace(/^\D+/, '').split(' de ')[0]); }
  /* P-01: los números de página son fluidos (el total cambia al mostrar u
     ocultar el cromo), así que los gestos se miden por ANCLA de lectura:
     solo un paso de página de verdad la mueve; ninguna remedición la toca. */
  const anclaLectura = () => tel.evaluate(() => window.__jgPaginas().ancla);
  const anclaEnPantalla = () => tel.evaluate(() => {
    const st = window.__jgPaginas();
    const lec = document.querySelector('#pdfLectura');
    const lr = lec.getBoundingClientRect();
    const b = [...lec.querySelectorAll('[data-ini]')].reverse().find(x => Number(x.dataset.ini) <= st.ancla);
    if (!b) return false;
    const r = b.getBoundingClientRect();
    return r.left < lr.right - 2 && r.right > lr.left + 2;
  });

  const a0 = await anclaLectura();
  const p0 = await pagina();
  await deslizar(330, 60);          // dedo hacia la izquierda = página siguiente
  const a1 = await anclaLectura();
  comprobar('deslizar hacia la izquierda avanza el sitio de lectura',
    a1 > a0, `ancla ${a0} → ${a1} (${p0} → ${await pagina()})`);

  await deslizar(60, 330);          // hacia la derecha = página anterior
  const a2 = await anclaLectura();
  comprobar('deslizar hacia la derecha retrocede el sitio de lectura',
    a2 < a1, `ancla ${a1} → ${a2} (${await pagina()})`);

  const fuenteVista = await readFile(join(app, 'js/pdf/libroVista.js'), 'utf8');
  comprobar('el gesto horizontal tiene un solo manejador',
    (fuenteVista.match(/el\.lectura\.addEventListener\('touchstart'/g) || []).length === 0
      && (fuenteVista.match(/el\.lectura\.addEventListener\('pointerup'/g) || []).length === 1);

  /* Un toque no es un deslizamiento: el gesto de leer desde un párrafo tiene
     que seguir intacto, y un roce mínimo no puede cambiar de página
     (el ancla no se mueve y su bloque sigue en pantalla). */
  const a3antes = await anclaLectura();
  await deslizar(200, 188);         // 12 px: eso es un toque tembloroso
  comprobar('un roce mínimo NO cambia de página',
    (await anclaLectura()) === a3antes && await anclaEnPantalla(),
    `ancla ${a3antes} → ${await anclaLectura()} (${await pagina()})`);

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
    if (nombre === 'Voz') {
      /* P6.1: la hoja compacta (sin «Más ajustes») no se puede llevar más del
         30 % de la pantalla, o al abrirla no queda texto que leer. */
      const hoja = await tel.evaluate(() => {
        const dock = document.querySelector('#pdfDockNav');
        const mas = document.querySelector('#pdfTtsMas');
        if (mas) mas.open = false;
        const r = dock.getBoundingClientRect();
        const cab = dock.querySelector('.pdf-voz-cab, .tts-console-head');
        const cabVisible = cab && cab.offsetParent !== null
          && getComputedStyle(cab).display !== 'none'
          && getComputedStyle(cab).visibility !== 'hidden';
        const etiquetas = [...dock.querySelectorAll('.tts-console-head, .pdf-voz-cab')]
          .filter((e) => e.offsetParent !== null && getComputedStyle(e).display !== 'none')
          .map((e) => e.textContent.trim()).filter(Boolean);
        return {
          alto: Math.round(r.height),
          pantalla: window.innerHeight,
          parte: r.height / window.innerHeight,
          cabVisible,
          etiquetas,
          vozEnHoja: [...dock.querySelectorAll('button, summary, .tts-console-title, .pdf-voz-cab-titulo')]
            .some((e) => e.offsetParent !== null && /^Voz$/i.test((e.textContent || '').trim())),
        };
      });
      console.log('  hoja Voz compacta:', { alto: hoja.alto, pantalla: hoja.pantalla, parte: `${Math.round(hoja.parte * 100)} %` });
      comprobar('la hoja compacta de Voz ocupa a lo sumo el 30 % de la pantalla',
        hoja.parte <= 0.30 + 0.001, `mide ${hoja.alto} de ${hoja.pantalla} px (${Math.round(hoja.parte * 100)} %)`);
      comprobar('la hoja de Voz no repite un botón «Voz» dentro', !hoja.vozEnHoja,
        `etiquetas: ${hoja.etiquetas.join(' | ')}`);
    }
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
  comprobar('en 320 px las acciones de lectura quedan plegadas',
    await estrecho.locator('#pdfHerramientasMenu').getAttribute('open') === null);
  comprobar('en 320 px todo lo que se toca sigue cabiendo bajo el dedo', m.pequenos.length === 0,
    m.pequenos.map((b) => `${b.id} ${b.w}×${b.h}`).join(', '));
  await estrecho.screenshot({ path: join(destino, 'estrecho.png') });
  await estrecho.close();

  /* ── 6. Escritorio y tablet conservan lectura útil ─────────────────── */
  console.log('\n── 6. Escritorio y tablet conservan lectura útil ───────────────');
  for (const [nombre, width, height, cabMax] of [['tablet', 768, 1024, 72], ['escritorio', 1440, 900, 72]]) {
    const p = await abrirLibro(width, height);
    const g = await reparto(p);
    console.log(`  ${nombre}:`, { cabecera: g.cabecera, texto: g.textoAlto, parte: `${Math.round(g.parteTexto * 100)} %` });
    comprobar(`${nombre} conserva una cabecera compacta`, g.cabecera > 0 && g.cabecera <= cabMax, `mide ${g.cabecera} px`);
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
