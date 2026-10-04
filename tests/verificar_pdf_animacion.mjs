/* JG Turbo · El paso de página se siente como un libro, y no estorba a nadie.
 *
 *   node tests/verificar_pdf_animacion.mjs
 *
 * En modo «Libro» (por defecto) pasar página —botón, teclado, deslizamiento o
 * la voz— dibuja una hoja saliente encima del texto (`.lec-hoja`, un clon
 * visual de la página que se va) mientras el contenido real ya está en la
 * página destino. Se exige:
 *   · existe la hoja durante el paso y desaparece en ≤ 500 ms;
 *   · solo se animan `transform` y `opacity` (nada que remaquete);
 *   · el área de texto no cambia de tamaño ni de reparto durante la animación;
 *   · 10 pasos rápidos seguidos terminan en la página exacta, con una sola
 *     hoja viva a la vez;
 *   · con `prefers-reduced-motion` no hay animación;
 *   · «Paso de página» (Libro | Deslizar | Sin animación) se guarda en
 *     `jg_pdf_paso_pagina` y sobrevive a recargar;
 *   · con la voz sonando, la página sigue a la voz igual con animación que
 *     sin ella (0 adelantos, 0 retrocesos, 0 tardías).
 * La duración de los cuadros se mide con requestAnimationFrame SOLO para
 * informar (p95); no es un criterio de aprobación salvo un techo holgado. */
import { cargarChromium, comprobar, cerrarPrueba, iniciarServidor, carpetaTemporal, crearLibroNarrativo, abrirLector, paginaActual, RITMO_VOZ } from './_paso.mjs';
import { join } from 'node:path';

const chromium = await cargarChromium();
const { servidor, base } = await iniciarServidor();
const temporal = await carpetaTemporal();
const rutaLarga = join(temporal, 'largo.pdf');
crearLibroNarrativo(rutaLarga, 12);
const rutaVoz = join(temporal, 'voz.pdf');
crearLibroNarrativo(rutaVoz, 4);
const navegador = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'], headless: !process.argv.includes('--headed') });

const dormirCromo = async (p) => { await p.evaluate(() => document.body.classList.add('jg-inmersivo')); await p.waitForTimeout(500); };
const permitidas = new Set(['offset', 'computedOffset', 'easing', 'composite', 'transform', 'opacity']);

/* Dentro de la página: hace `accion()` y observa cada cuadro hasta que no queda hoja. */
function observarPaso(accion) {
  const art = document.getElementById('pdfLectura');
  const cajaAntes = art.getBoundingClientRect();
  const colAntes = document.querySelector('.pdf-texto-col').getBoundingClientRect();
  const totalAntes = window.__jgPaginas().total;
  const t0 = performance.now();
  accion();
  const hojasAlInstante = document.querySelectorAll('.lec-hoja').length;
  const animaciones = document.getAnimations().filter((a) => a.effect && a.effect.target && a.effect.target.closest && a.effect.target.closest('.lec-hoja'));
  const claves = new Set();
  for (const a of animaciones) for (const k of a.effect.getKeyframes().flatMap((f) => Object.keys(f))) claves.add(k);
  const hoja = document.querySelector('.lec-hoja');
  return new Promise((resolver) => {
    const cuadros = [];
    let previo = performance.now();
    let cambioCaja = 0;
    let cambioTotal = 0;
    let maxHojas = hojasAlInstante;
    const tic = () => {
      const ahora = performance.now();
      cuadros.push(ahora - previo);
      previo = ahora;
      const c = art.getBoundingClientRect();
      const k = document.querySelector('.pdf-texto-col').getBoundingClientRect();
      if (Math.abs(c.width - cajaAntes.width) > 0.01 || Math.abs(c.height - cajaAntes.height) > 0.01 || Math.abs(c.left - cajaAntes.left) > 0.01 || Math.abs(c.top - cajaAntes.top) > 0.01
        || Math.abs(k.width - colAntes.width) > 0.01 || Math.abs(k.height - colAntes.height) > 0.01) cambioCaja += 1;
      if (window.__jgPaginas().total !== totalAntes) cambioTotal += 1;
      maxHojas = Math.max(maxHojas, document.querySelectorAll('.lec-hoja').length);
      if (!document.querySelector('.lec-hoja') || ahora - t0 > 1500) {
        resolver({ hojasAlInstante, animaciones: animaciones.length, claves: [...claves], hoja: !!hoja, duracion: ahora - t0, cuadros, cambioCaja, cambioTotal, maxHojas, sigue: !!document.querySelector('.lec-hoja') });
      } else requestAnimationFrame(tic);
    };
    requestAnimationFrame(tic);
  });
}
const p95 = (xs) => { const o = [...xs].sort((a, b) => a - b); return o.length ? o[Math.min(o.length - 1, Math.floor(o.length * 0.95))] : 0; };

/* ══════════ Modo Libro en el teléfono ══════════ */
{
  console.log('\n── modo Libro, teléfono 390×844 ──');
  const { p, contexto, errores } = await abrirLector(navegador, base, rutaLarga, { tactil: true });
  const info = await p.evaluate(() => window.__jgPaginas());
  comprobar(info.activo && info.total >= 11, `el capítulo tiene páginas de sobra para 10 pasos (${info.total})`);
  await dormirCromo(p);
  const control = await p.evaluate(() => { const s = document.getElementById('pdfAparPaso'); return s ? { valor: s.value, opciones: [...s.options].map((o) => o.value) } : null; });
  comprobar(!!control, 'existe el control «Paso de página» en Apariencia (#pdfAparPaso)');
  comprobar(control && control.valor === 'libro', `por defecto es «Libro» (${control && control.valor})`);
  comprobar(control && ['libro', 'deslizar', 'ninguno'].every((v) => control.opciones.includes(v)), 'ofrece Libro, Deslizar y Sin animación');

  /* Con función real: Playwright no serializa closures, así que se arma por texto. */
  const pasar = async (nombre, js, esperado) => {
    const antes = await paginaActual(p);
    const r = await p.evaluate(`(${observarPaso.toString()})(() => { ${js} })`);
    await p.waitForTimeout(300);
    const despues = await paginaActual(p);
    const fisica = await p.evaluate(() => document.getElementById('pdfLectura').scrollLeft / window.__jgPaginas().paso);
    comprobar(r.hojasAlInstante === 1 && r.hoja, `${nombre}: durante el paso existe la hoja (${r.hojasAlInstante})`);
    comprobar(r.animaciones >= 1, `${nombre}: la hoja se anima con la API de animaciones (${r.animaciones})`);
    comprobar(r.claves.length > 0 && r.claves.every((k) => permitidas.has(k)), `${nombre}: solo se animan transform y opacity (${r.claves.join(', ')})`);
    comprobar(!r.sigue && r.duracion <= 500, `${nombre}: la hoja desaparece en ≤ 500 ms (${Math.round(r.duracion)} ms)`);
    comprobar(r.duracion >= 180, `${nombre}: y se nota como animación, no como parpadeo (${Math.round(r.duracion)} ms)`);
    comprobar(r.cambioCaja === 0, `${nombre}: el alto y el ancho del área de texto no cambian durante el paso`);
    comprobar(r.cambioTotal === 0, `${nombre}: el reparto de páginas no cambia durante el paso`);
    comprobar(r.maxHojas === 1, `${nombre}: nunca hay más de una hoja viva (${r.maxHojas})`);
    comprobar(despues === antes + esperado, `${nombre}: la página es la exacta (${antes} → ${despues})`);
    comprobar(Math.abs(fisica - despues) < 0.02, `${nombre}: el texto real queda alineado (${fisica.toFixed(3)})`);
    console.log(`  · ${nombre}: ${r.cuadros.length} cuadros, p95 ${p95(r.cuadros).toFixed(1)} ms, máximo ${Math.max(...r.cuadros).toFixed(1)} ms`);
    return r;
  };
  const r1 = await pasar('botón siguiente', "document.getElementById('btnPdfPagNext').click()", 1);
  const r2 = await pasar('botón anterior', "document.getElementById('btnPdfPagPrev').click()", -1);
  const r3 = await pasar('flecha derecha', "document.getElementById('pdfLectura').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }))", 1);
  const todos = [...r1.cuadros, ...r2.cuadros, ...r3.cuadros];
  console.log(`  ▸ cuadros durante el paso (3 pasos): ${todos.length}, p95 ${p95(todos).toFixed(1)} ms`);
  comprobar(p95(todos) < 60, `la animación no da tirones serios (p95 ${p95(todos).toFixed(1)} ms < 60)`);

  /* 10 pasos rápidos, mezclando direcciones: 6 adelante, 3 atrás, 4 adelante = +7 neto en 13 pasos,
   * y 10 seguidos hacia delante. */
  const inicio0 = await paginaActual(p);
  const total = (await p.evaluate(() => window.__jgPaginas())).total;
  const rapido = await p.evaluate(() => new Promise((resolver) => {
    const art = document.getElementById('pdfLectura');
    let maxHojas = 0;
    let paso = 0;
    const cuenta = setInterval(() => { maxHojas = Math.max(maxHojas, document.querySelectorAll('.lec-hoja').length); }, 8);
    const tic = () => {
      art.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }));
      paso += 1;
      if (paso < 10) setTimeout(tic, 30); else setTimeout(() => { clearInterval(cuenta); resolver({ maxHojas }); }, 40);
    };
    tic();
  }));
  await p.waitForTimeout(700);
  const trasRapido = await paginaActual(p);
  const esperadoRapido = Math.min(total - 1, inicio0 + 10);
  comprobar(trasRapido === esperadoRapido, `10 pasos rápidos terminan en la página exacta (${inicio0} → ${trasRapido}, esperada ${esperadoRapido})`);
  comprobar(rapido.maxHojas <= 1, `10 pasos rápidos: nunca más de una hoja viva (${rapido.maxHojas})`);
  const asentado = await p.evaluate(() => ({ hojas: document.querySelectorAll('.lec-hoja').length, f: document.getElementById('pdfLectura').scrollLeft / window.__jgPaginas().paso, a: window.__jgPaginas().actual }));
  comprobar(asentado.hojas === 0, 'tras los pasos rápidos no queda ninguna hoja');
  comprobar(Math.abs(asentado.f - asentado.a) < 0.02, `y el texto real está en la página lógica (${asentado.f.toFixed(3)} ≈ ${asentado.a})`);
  /* Mezcla de direcciones. */
  const base1 = await paginaActual(p);
  await p.evaluate(() => new Promise((resolver) => {
    const art = document.getElementById('pdfLectura');
    const teclas = ['ArrowLeft', 'ArrowLeft', 'ArrowLeft', 'ArrowLeft', 'ArrowRight', 'ArrowLeft', 'ArrowRight', 'ArrowRight', 'ArrowLeft', 'ArrowLeft'];
    let i = 0;
    const tic = () => { art.dispatchEvent(new KeyboardEvent('keydown', { key: teclas[i], bubbles: true, cancelable: true })); i += 1; if (i < teclas.length) setTimeout(tic, 25); else resolver(); };
    tic();
  }));
  await p.waitForTimeout(700);
  comprobar(await paginaActual(p) === Math.max(0, base1 - 4), `mezclando direcciones (−4 netos) cae en la página exacta (${base1} → ${await paginaActual(p)})`);

  /* Con un deslizamiento del dedo la hoja sigue al dedo. */
  const cdp = await contexto.newCDPSession(p);
  const c = await p.evaluate(() => { const r = document.getElementById('pdfLectura').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
  const antesDedo = await paginaActual(p);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: c.x + 100, y: c.y, id: 1 }] });
  let posiciones = [];
  for (let i = 1; i <= 8; i += 1) {
    await new Promise((r) => setTimeout(r, 30));
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: c.x + 100 - i * 20, y: c.y, id: 1 }] });
    posiciones.push(await p.evaluate(() => { const h = document.querySelector('.lec-hoja'); if (!h) return null; const m = h.firstElementChild ? new DOMMatrixReadOnly(getComputedStyle(h.firstElementChild).transform) : null; return m ? m.m41 : null; }));
  }
  const vistas = posiciones.filter((x) => x != null);
  comprobar(vistas.length >= 5, `al arrastrar con el dedo hay hoja a la vista (${vistas.length}/8 cuadros)`);
  comprobar(vistas.length >= 5 && vistas[vistas.length - 1] < vistas[2] - 20, `la hoja sigue al dedo hacia la izquierda (${vistas.map((x) => Math.round(x)).join(', ')})`);
  comprobar(await paginaActual(p) === antesDedo, 'mientras el dedo no suelta, la página lógica no cambia aún');
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await p.waitForTimeout(700);
  comprobar(await paginaActual(p) === antesDedo + 1, `al soltar con distancia suficiente avanza una página (${antesDedo} → ${await paginaActual(p)})`);
  comprobar(await p.evaluate(() => document.querySelectorAll('.lec-hoja').length) === 0, 'y la hoja termina de irse');
  /* Soltar sin llegar al umbral: la hoja vuelve y la página es la misma. */
  await dormirCromo(p);
  const anclaCorto = await p.evaluate(() => window.__jgPaginas().ancla);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: c.x + 20, y: c.y, id: 1 }] });
  for (let i = 1; i <= 5; i += 1) { await new Promise((r) => setTimeout(r, 25)); await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: c.x + 20 - i * 6, y: c.y, id: 1 }] }); }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await p.waitForTimeout(700);
  /* Un recorrido corto es un toque tembloroso: trae el cromo y eso remaqueta
   * (P-01), así que «no cambia de página» se mide por el ancla. */
  const corto = await p.evaluate(() => ({ hojas: document.querySelectorAll('.lec-hoja').length, f: document.getElementById('pdfLectura').scrollLeft / window.__jgPaginas().paso, a: window.__jgPaginas().actual, ancla: window.__jgPaginas().ancla }));
  comprobar(corto.ancla === anclaCorto && corto.hojas === 0 && Math.abs(corto.f - corto.a) < 0.02, `un arrastre corto devuelve la hoja y no cambia nada (ancla ${anclaCorto} → ${corto.ancla}, hojas ${corto.hojas}, vista ${corto.f.toFixed(3)} ≈ ${corto.a})`);
  comprobar(errores.length === 0, 'modo Libro: sin errores de JavaScript', errores.join(' | '));
  await contexto.close();
}

/* ══════════ La hoja es OPACA y del color del papel ══════════
 * Una hoja translúcida deja ver dos textos superpuestos (el que se va sobre el
 * nuevo). A mitad del paso, en cada tema, el fondo computado de la hoja es
 * opaco y es el del papel, y su opacidad es ≥ 0,85. */
{
  console.log('\n── hoja opaca por tema ──');
  const { mkdir } = await import('node:fs/promises');
  const { APP } = await import('./_paso.mjs');
  const dirCap = join(APP, '.playwright-cli');
  await mkdir(dirCap, { recursive: true });
  for (const [ancho, alto] of [[390, 844], [1440, 900]]) {
    const { p, contexto, errores } = await abrirLector(navegador, base, rutaLarga, { ancho, alto });
    for (const tema of ['papel', 'sepia', 'noche']) {
      await p.evaluate((t) => document.querySelector(`[data-tema="${t}"]`).click(), tema);
      await p.waitForTimeout(500);
      await p.evaluate(() => document.body.classList.add('jg-inmersivo'));
      await p.waitForTimeout(400);
      await p.evaluate(() => document.getElementById('btnPdfPagNext').click());
      await p.waitForTimeout(110);
      await p.evaluate(() => document.getAnimations().forEach((a) => a.pause()));
      const m = await p.evaluate(() => {
        const h = document.querySelector('.lec-hoja');
        if (!h) return null;
        const cs = getComputedStyle(h.firstElementChild);
        let fondo = 'rgba(0, 0, 0, 0)';
        for (let n = document.getElementById('pdfLectura'); n; n = n.parentElement) {
          const c = getComputedStyle(n).backgroundColor;
          if (c && !/,\s*0\)$/.test(c)) { fondo = c; break; }
        }
        return { bg: cs.backgroundColor, op: Number(cs.opacity), fondo, tema: document.getElementById('pdfResultArea')?.dataset.tema || document.body.dataset.lecturaTema };
      });
      comprobar(!!m, `${ancho}px · ${tema}: hay hoja a mitad del paso`);
      if (m) {
        comprobar(/^rgb\(/.test(m.bg) || /,\s*1\)$/.test(m.bg), `${ancho}px · ${tema}: el fondo de la hoja es opaco (${m.bg})`);
        comprobar(m.bg === m.fondo, `${ancho}px · ${tema}: y es el del papel de ese tema (${m.bg} = ${m.fondo})`);
        comprobar(m.op >= 0.85, `${ancho}px · ${tema}: opacidad ≥ 0,85 a mitad del paso (${m.op.toFixed(3)})`);
      }
      await p.screenshot({ path: join(dirCap, `animacion-hoja-${tema}-${ancho}.png`) });
      await p.evaluate(() => document.getAnimations().forEach((a) => a.finish()));
      await p.waitForTimeout(500);
    }
    comprobar(errores.length === 0, `${ancho}px: hoja opaca sin errores de JavaScript`, errores.join(' | '));
    await contexto.close();
  }
}

/* ══════════ Las otras opciones, y que se guardan ══════════ */
{
  console.log('\n── Deslizar y Sin animación ──');
  const { p, contexto, errores } = await abrirLector(navegador, base, rutaLarga, { ancho: 1440, alto: 900 });
  const elegir = (valor) => p.evaluate((v) => { const s = document.getElementById('pdfAparPaso'); s.value = v; s.dispatchEvent(new Event('change', { bubbles: true })); }, valor);
  await elegir('ninguno');
  comprobar(await p.evaluate(() => localStorage.getItem('jg_pdf_paso_pagina')) === 'ninguno', 'elegir «Sin animación» lo guarda en jg_pdf_paso_pagina');
  const r = await p.evaluate(`(${observarPaso.toString()})(() => { document.getElementById('btnPdfPagNext').click() })`);
  comprobar(r.hojasAlInstante === 0 && r.animaciones === 0, 'Sin animación: no hay hoja ni animaciones');
  await p.waitForTimeout(200);
  const f = await p.evaluate(() => ({ f: document.getElementById('pdfLectura').scrollLeft / window.__jgPaginas().paso, a: window.__jgPaginas().actual }));
  comprobar(f.a === 1 && Math.abs(f.f - 1) < 0.01, `Sin animación: el texto salta de una vez a la página (${f.f.toFixed(3)})`);

  await elegir('deslizar');
  comprobar(await p.evaluate(() => localStorage.getItem('jg_pdf_paso_pagina')) === 'deslizar', 'elegir «Deslizar» lo guarda');
  const d = await p.evaluate(() => new Promise((resolver) => {
    const art = document.getElementById('pdfLectura');
    const ini = art.scrollLeft;
    document.getElementById('btnPdfPagNext').click();
    const hojas = document.querySelectorAll('.lec-hoja').length;
    setTimeout(() => resolver({ hojas, intermedio: art.scrollLeft, ini, destino: window.__jgPaginas().actual * window.__jgPaginas().paso }), 90);
  }));
  comprobar(d.hojas === 0, 'Deslizar: no se dibuja hoja');
  comprobar(d.intermedio > d.ini + 2 && d.intermedio < d.destino - 2, `Deslizar: el texto se desplaza de forma suave (${Math.round(d.ini)} → ${Math.round(d.intermedio)} → ${Math.round(d.destino)})`);
  await p.waitForTimeout(600);
  comprobar(await p.evaluate(() => Math.abs(document.getElementById('pdfLectura').scrollLeft - window.__jgPaginas().actual * window.__jgPaginas().paso)) < 1.5, 'Deslizar: termina alineado con la página');

  await elegir('ninguno');
  await p.reload({ waitUntil: 'domcontentloaded' });
  await p.waitForTimeout(500);
  if (await p.locator('#tabPdf').isVisible()) await p.locator('#tabPdf').click();
  await p.locator('#pdfLectura p').first().waitFor({ timeout: 60000 }).catch(() => {});
  await p.waitForTimeout(1500);
  comprobar(await p.evaluate(() => document.getElementById('pdfAparPaso')?.value) === 'ninguno', 'tras recargar, «Sin animación» sigue elegida');
  comprobar(await p.evaluate(() => localStorage.getItem('jg_pdf_paso_pagina')) === 'ninguno', 'y sigue guardada');
  if (await p.evaluate(() => !!window.__jgPaginas && window.__jgPaginas().activo)) {
    const r2 = await p.evaluate(`(${observarPaso.toString()})(() => { document.getElementById('btnPdfPagNext').click() })`);
    comprobar(r2.hojasAlInstante === 0, 'y al recargar sigue sin hoja');
  }
  /* Un valor basura no rompe nada: se toma el de siempre. */
  await p.evaluate(() => localStorage.setItem('jg_pdf_paso_pagina', 'giro-3d'));
  await p.reload({ waitUntil: 'domcontentloaded' });
  await p.waitForTimeout(800);
  if (await p.locator('#tabPdf').isVisible()) await p.locator('#tabPdf').click();
  await p.waitForTimeout(1200);
  comprobar(await p.evaluate(() => document.getElementById('pdfAparPaso')?.value) === 'libro', 'un valor guardado inválido cae en «Libro»');
  comprobar(errores.length === 0, 'opciones: sin errores de JavaScript', errores.join(' | '));
  await contexto.close();
}

/* ══════════ Menos movimiento ══════════ */
{
  console.log('\n── prefers-reduced-motion ──');
  const { p, contexto, errores } = await abrirLector(navegador, base, rutaLarga, { tactil: true, reducido: true });
  await dormirCromo(p);
  comprobar(await p.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches), 'el navegador pide menos movimiento');
  const r = await p.evaluate(`(${observarPaso.toString()})(() => { document.getElementById('btnPdfPagNext').click() })`);
  comprobar(r.hojasAlInstante === 0 && r.animaciones === 0, 'con menos movimiento no hay hoja ni animación');
  await p.waitForTimeout(250);
  const f = await p.evaluate(() => ({ f: document.getElementById('pdfLectura').scrollLeft / window.__jgPaginas().paso, a: window.__jgPaginas().actual }));
  comprobar(f.a === 1 && Math.abs(f.f - 1) < 0.01, `y el cambio de página es inmediato y alineado (${f.f.toFixed(3)})`);
  const cdp = await contexto.newCDPSession(p);
  const c = await p.evaluate(() => { const r = document.getElementById('pdfLectura').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: c.x + 60, y: c.y, id: 1 }] });
  let hubo = false;
  for (let i = 1; i <= 6; i += 1) { await new Promise((q) => setTimeout(q, 25)); await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: c.x + 60 - i * 20, y: c.y, id: 1 }] }); hubo = hubo || await p.evaluate(() => !!document.querySelector('.lec-hoja')); }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await p.waitForTimeout(500);
  comprobar(!hubo, 'con menos movimiento, deslizar con el dedo tampoco dibuja hoja');
  comprobar(await paginaActual(p) === 2, `pero el deslizamiento sigue pasando página (${await paginaActual(p)})`);
  comprobar(errores.length === 0, 'menos movimiento: sin errores de JavaScript', errores.join(' | '));
  await contexto.close();
}

/* ══════════ La voz manda ══════════ */
async function leerConVoz(modo) {
  const { p, contexto, errores } = await abrirLector(navegador, base, rutaVoz, { ancho: 390, alto: 844, init: `try { localStorage.setItem('jg_pdf_paso_pagina', '${modo}'); } catch (_) {}` });
  const info = await p.evaluate(() => window.__jgPaginas());
  comprobar(info.activo && info.total >= 5, `voz (${modo}): capítulo paginado de ${info.total} páginas`);
  await p.evaluate(() => {
    const art = document.getElementById('pdfLectura');
    const serie = (window.__serie = []);
    window.__hojasCreadas = 0;
    new MutationObserver((ms) => { for (const m of ms) for (const n of m.addedNodes) if (n.classList && n.classList.contains('lec-hoja')) window.__hojasCreadas += 1; }).observe(art.parentElement, { childList: true });
    setInterval(() => {
      const dbg = window.jgGuiaDebug ? window.jgGuiaDebug() : {};
      const s = window.__jgPaginas();
      const caja = art.getBoundingClientRect();
      serie.push({
        t: performance.now(), estado: window.ttsState ? window.ttsState.status : '?', voz: dbg.voz ?? -1,
        actual: s.actual, total: s.total, paso: s.paso, activo: s.activo,
        estable: !!s.activo && Math.abs(caja.width - s.cajaAncho) <= 0.75 && Math.abs(caja.height - s.cajaAlto) <= 1.5,
        fisica: s.paso ? art.scrollLeft / s.paso : -1,
        pagVoz: (dbg.voz ?? -1) >= 0 ? window.__jgPaginaDeCaracter(dbg.voz) : -1,
      });
    }, 40);
  });
  await p.evaluate(() => document.querySelector('[data-tts-console="pdf"] [data-tts-action="toggle"]').click());
  await p.waitForFunction(() => window.ttsState && window.ttsState.status === 'playing', null, { timeout: 60000 }).catch(() => console.log('AVISO: no llegó a playing'));
  const caracteres = await p.evaluate(() => (document.getElementById('pdfOutput').value || '').length);
  const inicio = Date.now();
  const limite = (caracteres / RITMO_VOZ) * 1000 + 40000;
  while (Date.now() - inicio < limite) {
    await p.waitForTimeout(250);
    const e = await p.evaluate(() => (window.ttsState ? window.ttsState.status : '?'));
    if (e === 'idle' && Date.now() - inicio > 3000) break;
  }
  const serie = await p.evaluate(() => window.__serie);
  const hojas = await p.evaluate(() => window.__hojasCreadas);
  await p.locator('[data-tts-console="pdf"] [data-tts-action="stop"]').click({ timeout: 2000 }).catch(() => {});
  await contexto.close();
  return { serie, hojas, errores };
}
function analizarVoz(modo, { serie, hojas, errores }) {
  const sonando = serie.filter((m) => m.estado === 'playing' && m.voz >= 0 && m.activo && m.estable && m.pagVoz >= 0);
  comprobar(sonando.length > 60, `voz (${modo}): serie suficiente (${sonando.length} muestras)`);
  const paginas = new Set(sonando.map((m) => m.pagVoz));
  comprobar(paginas.size >= 4, `voz (${modo}): la voz recorre ≥ 4 páginas (${paginas.size})`);
  let desde = null; let previa = null; let tardias = 0; let adelantadas = 0; let retrocesos = 0; const donde = [];
  for (let i = 0; i < sonando.length; i += 1) {
    const m = sonando[i];
    if (m.pagVoz !== previa) { desde = m.t; previa = m.pagVoz; }
    if (m.actual > m.pagVoz) { adelantadas += 1; if (donde.length < 5) donde.push(`adelantada voz=${m.voz} pagVoz=${m.pagVoz} actual=${m.actual}`); }
    if (m.t - desde > 450 && (m.actual !== m.pagVoz || Math.abs(m.fisica - m.pagVoz) > 0.05)) { tardias += 1; if (donde.length < 5) donde.push(`tarde edad=${Math.round(m.t - desde)} voz=${m.voz} pagVoz=${m.pagVoz} actual=${m.actual} fisica=${m.fisica.toFixed(2)}`); }
    if (i > 0 && sonando[i - 1].total === m.total && sonando[i - 1].paso === m.paso && m.actual < sonando[i - 1].actual) { retrocesos += 1; if (donde.length < 5) donde.push(`retroceso ${sonando[i - 1].actual}→${m.actual}`); }
  }
  comprobar(tardias === 0, `voz (${modo}): la página visible es la de la voz tras 450 ms (${tardias} muestras tarde)`, donde.join(' | '));
  comprobar(adelantadas === 0, `voz (${modo}): la página nunca va por delante de la voz (${adelantadas})`, donde.join(' | '));
  comprobar(retrocesos === 0, `voz (${modo}): la página no retrocede sola (${retrocesos})`, donde.join(' | '));
  if (modo === 'libro') comprobar(hojas >= 3, `voz (libro): mientras sigue a la voz se dibujaron hojas (${hojas})`);
  else comprobar(hojas === 0, `voz (${modo}): no se dibujó ninguna hoja (${hojas})`);
  comprobar(errores.length === 0, `voz (${modo}): sin errores de JavaScript`, errores.join(' | '));
}
for (const modo of ['libro', 'ninguno']) {
  console.log(`\n── la voz lleva la página (${modo}) ──`);
  analizarVoz(modo, await leerConVoz(modo));
}

await navegador.close();
servidor.close();
cerrarPrueba('paso de página tipo libro');
