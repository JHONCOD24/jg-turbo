/* JG Turbo · Deslizar sin querer no rompe nada, y «atrás» no saca de la app.
 *
 *   node tests/verificar_pdf_gestos.mjs
 *
 * Con un dedo REAL (CDP: el navegador emite Touch Events y Pointer Events por
 * el mismo gesto, como un teléfono) en 390×844, y con ratón/teclado en
 * escritorio, se exige:
 *   · un arrastre vertical largo no pasa página;
 *   · un deslizamiento horizontal corto (bajo el umbral) no pasa página;
 *   · uno largo pasa EXACTAMENTE una (+1 / −1), aunque el navegador emita
 *     Touch y Pointer por el mismo gesto, y aunque el dedo recorra media
 *     pantalla;
 *   · un pellizco (dos dedos) no pasa página;
 *   · los botones del cromo siguen respondiendo a un toque real tras deslizar;
 *   · «tirar para recargar» queda anulado SOLO mientras se lee paginado
 *     (`overscroll-behavior` del documento) y vuelve a lo normal al salir del
 *     lector, en otras pestañas y en el modo desplazamiento;
 *   · «atrás» en el lector vuelve a la biblioteca sin salir de la app, y abrir
 *     y cerrar el lector con su botón no deja entradas colgando. */
import { cargarChromium, comprobar, cerrarPrueba, iniciarServidor, carpetaTemporal, crearLibroNarrativo, abrirLector, paginaActual, arrastrar, pellizcar } from './_paso.mjs';
import { join } from 'node:path';

const chromium = await cargarChromium();
const { servidor, base } = await iniciarServidor();
const temporal = await carpetaTemporal();
const ruta = join(temporal, 'libro.pdf');
crearLibroNarrativo(ruta, 6);
const navegador = await chromium.launch({ headless: !process.argv.includes('--headed') });

const irSiguiente = (p) => p.evaluate(() => document.getElementById('btnPdfPagNext').click());
const reposo = (p, ms = 900) => p.waitForTimeout(ms);
const caja = (p) => p.evaluate(() => { const r = document.getElementById('pdfLectura').getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; });
const overscroll = (p) => p.evaluate(() => ({
  html: getComputedStyle(document.documentElement).overscrollBehaviorY,
  body: getComputedStyle(document.body).overscrollBehaviorY,
}));
const sinRecarga = ({ html, body }) => (html === 'none' || html === 'contain') && (body === 'none' || body === 'contain' || body === 'auto');

/* ══════════ Teléfono: dedo real ══════════ */
{
  console.log('\n── teléfono 390×844, dedo real ──');
  const { p, cdp, contexto, errores } = await abrirLector(navegador, base, ruta, { tactil: true });
  const info = await p.evaluate(() => window.__jgPaginas());
  comprobar(info.activo && info.total >= 5, `el capítulo se reparte en páginas (${info.total})`);
  await irSiguiente(p); await reposo(p);
  await irSiguiente(p); await reposo(p);
  const base0 = await paginaActual(p);
  comprobar(base0 === 2, `se parte de la página 3 (índice ${base0})`);
  const c = await caja(p);
  const cx = c.x + c.w / 2;
  const cy = c.y + c.h / 2;
  const tras = async (nombre, gesto, esperado) => {
    const antes = await paginaActual(p);
    await gesto();
    await reposo(p);
    const ahora = await paginaActual(p);
    const fisica = await p.evaluate(() => { const a = document.getElementById('pdfLectura'); return a.scrollLeft / window.__jgPaginas().paso; });
    comprobar(ahora === antes + esperado, `${nombre}: ${esperado === 0 ? 'misma página' : `${esperado > 0 ? '+' : ''}${esperado} exacto`} (${antes} → ${ahora})`);
    comprobar(Math.abs(fisica - ahora) < 0.03, `${nombre}: la vista queda alineada con la página (${fisica.toFixed(3)} ≈ ${ahora})`);
  };

  await tras('arrastre vertical hacia arriba 300 px', () => arrastrar(cdp, { x: cx, y: cy + 150, dy: -300 }), 0);
  await tras('arrastre vertical hacia abajo 300 px', () => arrastrar(cdp, { x: cx, y: cy - 150, dy: 300 }), 0);
  await tras('diagonal casi vertical (60 × 220)', () => arrastrar(cdp, { x: cx, y: cy + 110, dx: -60, dy: -220 }), 0);
  await tras('horizontal corto 20 px', () => arrastrar(cdp, { x: cx + 10, y: cy, dx: -20 }), 0);
  await tras('horizontal corto 20 px al revés', () => arrastrar(cdp, { x: cx - 10, y: cy, dx: 20 }), 0);
  await tras('horizontal 120 px hacia la izquierda', () => arrastrar(cdp, { x: cx + 60, y: cy, dx: -120 }), 1);
  await tras('horizontal 120 px hacia la derecha', () => arrastrar(cdp, { x: cx - 60, y: cy, dx: 120 }), -1);
  await tras('arrastre largo de media pantalla (300 px) cuenta UNA sola página', () => arrastrar(cdp, { x: cx + 150, y: cy, dx: -300 }), 1);
  await tras('arrastre horizontal lento (60 pasos)', () => arrastrar(cdp, { x: cx + 70, y: cy, dx: -140, pasos: 60, msPaso: 8 }), 1);

  /* Dos dedos: ni un pellizco ni un arrastre con dos dedos pasan página, y tras
   * pellizcar el lector sigue alineado con su página (con el zoom del dedo el
   * alto del documento no puede colapsar). */
  await tras('pellizco (dos dedos que se separan)', () => pellizcar(cdp, { x: cx, y: cy, de: 30, a: 90 }), 0);
  const zoom = await p.evaluate(() => ({ escala: visualViewport.scale, alto: document.getElementById('pdfLectura').clientHeight }));
  comprobar(zoom.alto > 300, `con el zoom del pellizco el texto conserva su alto (${zoom.alto} px, escala ${zoom.escala.toFixed(2)})`);
  await cdp.send('Emulation.setPageScaleFactor', { pageScaleFactor: 1 });
  await reposo(p, 600);
  await tras('arrastre con dos dedos en la misma dirección', async () => {
    const tp = (x) => [{ x, y: cy, id: 1 }, { x, y: cy + 60, id: 2 }];
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: tp(cx + 60) });
    for (let i = 1; i <= 10; i += 1) { await new Promise((r) => setTimeout(r, 14)); await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: tp(cx + 60 - 12 * i) }); }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  }, 0);

  /* Dos gestos seguidos son dos páginas, no una ni tres. */
  const previa = await paginaActual(p);
  await arrastrar(cdp, { x: cx + 60, y: cy, dx: -120 });
  await arrastrar(cdp, { x: cx + 60, y: cy, dx: -120 });
  await reposo(p, 1100);
  comprobar(await paginaActual(p) === previa + 2, `dos deslizamientos seguidos pasan dos páginas (${previa} → ${await paginaActual(p)})`);

  /* El gesto no deja el puntero capturado: un toque real en un botón del cromo
   * sigue siendo un toque en ese botón (TRAMPAS: «Capturar el puntero al
   * tocar rompe los botones que hay debajo»). */
  await p.evaluate(() => document.body.classList.remove('jg-inmersivo'));
  await reposo(p, 500);
  const antesToque = await paginaActual(p);
  const bn = await p.evaluate(() => { const r = document.getElementById('btnPdfPagNext').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, ok: r.width > 0 && !document.getElementById('btnPdfPagNext').disabled }; });
  if (bn.ok) {
    await p.touchscreen.tap(bn.x, bn.y);
    await reposo(p);
    comprobar(await paginaActual(p) === antesToque + 1, `un toque real en «página siguiente» tras deslizar pasa una página (${antesToque} → ${await paginaActual(p)})`);
    const bp = await p.evaluate(() => { const r = document.getElementById('btnPdfPagPrev').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
    await p.evaluate(() => document.body.classList.remove('jg-inmersivo'));
    await p.touchscreen.tap(bp.x, bp.y);
    await reposo(p);
    comprobar(await paginaActual(p) === antesToque, `y un toque real en «página anterior» la devuelve (${await paginaActual(p)})`);
  } else comprobar(false, 'el botón «página siguiente» se puede tocar');

  /* ── «Tirar para recargar» ── */
  const enLector = await overscroll(p);
  comprobar(sinRecarga(enLector), `leyendo paginado, el documento no encadena el arrastre (html=${enLector.html}, body=${enLector.body})`);
  comprobar(enLector.html === 'none' || enLector.html === 'contain', 'y es el documento (html) quien lo declara');
  /* Modo desplazamiento: el documento debe ser normal. */
  await p.evaluate(() => { const s = document.getElementById('pdfAparModo'); s.value = 'scroll'; s.dispatchEvent(new Event('change', { bubbles: true })); });
  await reposo(p, 700);
  const enScroll = await overscroll(p);
  comprobar(enScroll.html === 'auto', `leyendo con desplazamiento, vuelve a lo normal (html=${enScroll.html})`);
  await p.evaluate(() => { const s = document.getElementById('pdfAparModo'); s.value = 'paginas'; s.dispatchEvent(new Event('change', { bubbles: true })); });
  await reposo(p, 900);
  const devuelto = await overscroll(p);
  comprobar(devuelto.html === 'none' || devuelto.html === 'contain', `al volver a las páginas se anula otra vez (html=${devuelto.html})`);
  /* Salir del lector. */
  await p.evaluate(() => document.body.classList.remove('jg-inmersivo'));
  await p.locator('#btnPdfBack').click();
  await reposo(p, 700);
  const enBiblioteca = await overscroll(p);
  comprobar(enBiblioteca.html === 'auto', `en la biblioteca el documento es normal (html=${enBiblioteca.html})`);
  await p.locator('#tabMic').click();
  await reposo(p, 300);
  const enOtra = await overscroll(p);
  comprobar(enOtra.html === 'auto', `en otra pestaña el documento es normal (html=${enOtra.html})`);
  comprobar(errores.length === 0, 'teléfono: sin errores de JavaScript', errores.join(' | '));
  await contexto.close();
}

/* ══════════ Escritorio: teclado y ratón ══════════ */
{
  console.log('\n── escritorio 1440×900 ──');
  const { p, contexto, errores } = await abrirLector(navegador, base, ruta, { ancho: 1440, alto: 900 });
  const info = await p.evaluate(() => window.__jgPaginas());
  comprobar(info.activo && info.total >= 4, `escritorio: capítulo paginado (${info.total} páginas)`);
  await p.locator('#pdfLectura').focus();
  const a0 = await paginaActual(p);
  await p.keyboard.press('ArrowRight'); await reposo(p);
  comprobar(await paginaActual(p) === a0 + 1, `la flecha derecha pasa exactamente una página (${a0} → ${await paginaActual(p)})`);
  const c = await caja(p);
  const antes = await paginaActual(p);
  await p.mouse.move(c.x + c.w / 2 + 100, c.y + c.h / 2);
  await p.mouse.down(); await p.mouse.move(c.x + c.w / 2 - 100, c.y + c.h / 2, { steps: 12 }); await p.mouse.up();
  await reposo(p, 500);
  comprobar(await paginaActual(p) === antes, `arrastrar con el ratón selecciona texto, no pasa página (${antes} → ${await paginaActual(p)})`);
  const ov = await overscroll(p);
  comprobar(ov.html === 'none' || ov.html === 'contain', `escritorio leyendo paginado: sin encadenar (html=${ov.html})`);
  await p.locator('#btnPdfBack').click(); await reposo(p, 600);
  comprobar((await overscroll(p)).html === 'auto', 'escritorio en la biblioteca: documento normal');
  comprobar(errores.length === 0, 'escritorio: sin errores de JavaScript', errores.join(' | '));
  await contexto.close();
}

/* ══════════ «Atrás» ══════════ */
for (const [nombre, opciones] of [['teléfono', { tactil: true }], ['escritorio', { ancho: 1440, alto: 900 }]]) {
  console.log(`\n── «atrás» (${nombre}) ──`);
  /* Una entrada previa real: así «salir de la app» se nota (volvería a ella). */
  const ctx = await navegador.newContext({ viewport: { width: opciones.ancho || 390, height: opciones.alto || 844 }, hasTouch: !!opciones.tactil, isMobile: !!opciones.tactil });
  const p = await ctx.newPage();
  const errores = [];
  p.on('pageerror', (e) => errores.push(String(e).slice(0, 200)));
  await p.goto('about:blank');
  await p.goto(base, { waitUntil: 'domcontentloaded' });
  await p.waitForTimeout(500);
  await p.locator('#tabPdf').click();
  await p.locator('#pdfInput').setInputFiles(ruta);
  await p.locator('#btnPdfRead').click();
  await p.locator('#pdfLectura p').first().waitFor({ timeout: 90000 });
  await p.waitForTimeout(1500);
  const origen = await p.evaluate(() => ({ url: location.href, indice: navigation.currentEntry.index }));
  /* El lector ya abrió: el índice debe ser el de origen + 1 (UNA entrada). */
  const abierto = await p.evaluate(() => ({ url: location.href, indice: navigation.currentEntry.index, leyendo: document.body.classList.contains('jg-leyendo') }));
  comprobar(abierto.leyendo, `${nombre}: el lector está abierto`);
  /* «Atrás» del sistema. */
  await p.evaluate(() => history.back());
  await p.waitForTimeout(700);
  const trasAtras = await p.evaluate(() => ({
    url: location.href, indice: navigation.currentEntry.index,
    leyendo: document.body.classList.contains('jg-leyendo'),
    lecturaVisible: !!document.getElementById('pdfLectura').offsetParent,
    rejilla: !!document.getElementById('pdfRejilla')?.offsetParent,
  }));
  comprobar(!trasAtras.leyendo && !trasAtras.lecturaVisible, `${nombre}: «atrás» cierra el lector`);
  comprobar(trasAtras.url === abierto.url, `${nombre}: la app sigue en su URL (${trasAtras.url})`);
  comprobar(trasAtras.rejilla, `${nombre}: la biblioteca queda a la vista`);
  comprobar(trasAtras.indice === abierto.indice - 1, `${nombre}: «atrás» solo retrocedió una entrada, la del lector (${abierto.indice} → ${trasAtras.indice})`);

  /* Abrir y cerrar con el botón, tres veces: sin entradas colgando. */
  const inicio = await p.evaluate(() => ({ indice: navigation.currentEntry.index, total: navigation.entries().length }));
  for (let i = 1; i <= 3; i += 1) {
    await p.locator('#pdfRejilla .pdf-libro').first().click();
    await p.locator('#pdfLectura p').first().waitFor({ timeout: 30000 });
    await p.waitForTimeout(900);
    const dentro = await p.evaluate(() => ({ indice: navigation.currentEntry.index, leyendo: document.body.classList.contains('jg-leyendo'), capas: window.jgCapas.nombres.join(',') }));
    comprobar(dentro.leyendo && dentro.indice === inicio.indice + 1 && dentro.capas === 'lector', `${nombre}: apertura ${i} apila una sola entrada (índice ${dentro.indice}, capas «${dentro.capas}»)`);
    await p.evaluate(() => document.body.classList.remove('jg-inmersivo'));
    await p.locator('#btnPdfBack').click();
    await p.waitForTimeout(700);
  }
  const fin = await p.evaluate(() => ({ indice: navigation.currentEntry.index, total: navigation.entries().length, url: location.href, capas: window.jgCapas.nombres.length, leyendo: document.body.classList.contains('jg-leyendo') }));
  comprobar(fin.indice === inicio.indice, `${nombre}: tras abrir y cerrar 3 veces el historial sigue en el mismo punto (${inicio.indice} → ${fin.indice})`);
  comprobar(fin.total <= inicio.total, `${nombre}: no se acumulan entradas (${inicio.total} → ${fin.total})`);
  comprobar(fin.capas === 0 && !fin.leyendo, `${nombre}: no queda ninguna capa abierta`);
  comprobar(errores.length === 0, `${nombre}: sin errores de JavaScript`, errores.join(' | '));
  await ctx.close();
}

await navegador.close();
servidor.close();
cerrarPrueba('gestos y «atrás» del lector');
