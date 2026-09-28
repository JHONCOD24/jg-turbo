/* JG Turbo · Biblioteca de videos de punta a punta, SIN red ni créditos.
 *
 * La interfaz real (bibliotecaVista.js) contra su contrato: ids, roles y
 * conducta del PLAN_BIBLIOTECA_VIDEOS_IMPLEMENTACION_LLM.md §Contrato de la
 * vista. Si un selector no existe, la vista no cumple el contrato: se arregla
 * la vista, no la prueba. La base se siembra en su versión 1 (como la tiene hoy
 * el dueño) para medir también la migración.
 *
 *   node tests/verificar_biblioteca_videos.mjs
 *   node tests/verificar_biblioteca_videos.mjs --headed
 */
import { createServer } from 'node:http';
import { mkdir, readFile } from 'node:fs/promises';
import { resolve, join, extname } from 'node:path';
import { pathToFileURL } from 'node:url';

const app = resolve(import.meta.dirname, '..');
const capturar = process.argv.includes('--capturas');
const carpetaCapturas = join(app, '.impeccable', 'review');
if (capturar) await mkdir(carpetaCapturas, { recursive: true });
const { chromium, devices } = await (async () => {
  const candidatos = [
    resolve(app, 'node_modules/playwright/index.mjs'),
    resolve(app, '../node_modules/playwright/index.mjs'),
    resolve(app, '../JG Turbo_OLD/node_modules/playwright/index.mjs'),
  ];
  for (const ruta of candidatos) {
    try { return await import(pathToFileURL(ruta).href); } catch (_) { /* siguiente */ }
  }
  throw new Error('Playwright no encontrado en: ' + candidatos.join(' · '));
})();

const fixture = JSON.parse(await readFile(join(app, 'tests/fixtures/youtube_dNWkwrqAkcM_90s.json'), 'utf8'));
const WEBM = await readFile(join(app, 'tests/fixtures/x/video_prueba.webm'));
const MP4_X = await readFile(join(app, 'tests/fixtures/biblioteca/video_x_20s.mp4'));
const VOZ_MP3 = await readFile(join(app, 'tests/fixtures/biblioteca/voz_1s.mp3'));

const tipos = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.svg': 'image/svg+xml', '.css': 'text/css', '.png': 'image/png', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json', '.txt': 'text/plain' };
const servidor = createServer(async (q, r) => {
  try {
    const p = decodeURIComponent(new URL(q.url, 'http://localhost').pathname);
    // Página en blanco del mismo origen para sembrar la base v1 antes de abrir la app
    if (p === '/__semilla') { r.setHeader('Content-Type', 'text/html'); r.end('<!doctype html><meta charset="utf-8"><title>semilla</title>'); return; }
    const f = join(app, p === '/' ? 'index.html' : p);
    r.setHeader('Content-Type', tipos[extname(f)] || 'application/octet-stream');
    r.end(await readFile(f));
  } catch { r.writeHead(404, { 'Content-Type': 'text/plain' }).end(); }
});
await new Promise((ok) => servidor.listen(0, '127.0.0.1', ok));
const base = `http://127.0.0.1:${servidor.address().port}`;

let ok = 0;
const fallos = [];
function comprobar(nombre, condicion, detalle = '') {
  if (condicion) { ok += 1; console.log(`OK: ${nombre}`); }
  else { fallos.push(nombre); console.log(`FALLO: ${nombre}${detalle ? ` — ${detalle}` : ''}`); }
}
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

const YT_FALSO = `(() => {
  class JugadorFalso {
    constructor(elemento, opciones) {
      this.opciones = opciones || {}; this.base = 0; this.inicio = 0; this.tasa = 1; this.estado = -1; this.vol = 100; this.mudo = false;
      const viejo = typeof elemento === 'string' ? document.getElementById(elemento) : elemento;
      const marco = document.createElement('div');
      marco.id = typeof elemento === 'string' ? elemento : ((viejo && viejo.id) || 'ytPlayer');
      marco.style.cssText = 'position:absolute;inset:0;background:#111';
      if (viejo) viejo.replaceWith(marco);
      window.__yt = this;
      setTimeout(() => this._evento('onReady'), 30);
    }
    _t() { return this.estado === 1 ? this.base + ((performance.now() - this.inicio) / 1000) * this.tasa : this.base; }
    _evento(nombre, data) { const f = this.opciones.events && this.opciones.events[nombre]; if (f) f({ data, target: this }); }
    getCurrentTime() { return Math.min(this._t(), this.getDuration()); }
    getDuration() { return this.opciones.videoId === 'b2c3d4e5f6g' ? 120 : 5314; }
    getVideoData() { return { title: this.opciones.videoId === 'b2c3d4e5f6g' ? 'Curso de Python desde cero' : 'The Marketing GENIUS', author: 'Canal de prueba', video_id: this.opciones.videoId }; }
    getPlaybackRate() { return this.tasa; }
    getAvailablePlaybackRates() { return [0.5, 0.75, 1, 1.25, 1.5, 2]; }
    setPlaybackRate(r) { this.base = this._t(); this.inicio = performance.now(); this.tasa = Number(r) || 1; this._evento('onPlaybackRateChange', this.tasa); }
    playVideo() { if (this.estado === 1) return; this.base = this._t(); this.inicio = performance.now(); this.estado = 1; this._evento('onStateChange', 1); }
    pauseVideo() { this.base = this._t(); this.estado = 2; this._evento('onStateChange', 2); }
    seekTo(s) { this.base = Math.max(0, Number(s) || 0); this.inicio = performance.now(); window.__ytSalto = this.base; }
    getPlayerState() { return this.estado; }
    getVolume() { return this.vol; } setVolume(v) { this.vol = Number(v); }
    mute() { this.mudo = true; } unMute() { this.mudo = false; } isMuted() { return this.mudo; }
    getOptions() { return []; } getOption() { return []; } setOption() {}
    unloadModule() {}
    destroy() { this.estado = -5; }
  }
  window.YT = { Player: JugadorFalso, PlayerState: { UNSTARTED: -1, ENDED: 0, PLAYING: 1, PAUSED: 2, BUFFERING: 3, CUED: 5 } };
  setTimeout(() => typeof window.onYouTubeIframeAPIReady === 'function' && window.onYouTubeIframeAPIReady(), 0);
})();`;

/** La base v1 del dueño: 3 doblajes (uno a medias, uno de X sin empezar, uno visto y corto). */
function semilla() {
  const segmentosCortos = [
    { startTime: 1, endTime: 4, duration: 3, text: 'Welcome to this Python course.' },
    { startTime: 5, endTime: 9, duration: 4, text: 'Recursion is simple once you see it.' },
    { startTime: 10, endTime: 14, duration: 4, text: 'Let us write our first function.' },
  ];
  return [
    {
      videoId: 'dNWkwrqAkcM', titulo: 'The Marketing GENIUS', duracionS: 5314, idiomaOrigen: 'en', posicionS: 40,
      segmentos: fixture.segments, traducciones: fixture.segments.map((s, i) => [i, `ES ${s.text}`]), actualizado: Date.UTC(2026, 8, 25),
    },
    {
      videoId: 'x:1349794411333394432', titulo: '@BrooklynNets · WATCH: Sean Marks', duracionS: 20, idiomaOrigen: 'en', posicionS: 0,
      segmentos: segmentosCortos, traducciones: [[0, 'Bienvenidos.'], [1, 'La recursión es sencilla.'], [2, 'Escribamos una función.']], actualizado: Date.UTC(2026, 8, 27),
    },
    {
      videoId: 'b2c3d4e5f6g', titulo: 'Curso de Python desde cero', duracionS: 120, idiomaOrigen: 'en', posicionS: 118,
      segmentos: segmentosCortos, traducciones: [[0, 'Bienvenidos al curso.'], [1, 'La recursión es sencilla cuando la ves.'], [2, 'Escribamos la primera función.']], actualizado: Date.UTC(2026, 8, 20),
    },
  ];
}

async function abrir(navegador, { movil = false, sembrar = true } = {}) {
  const contexto = movil
    ? await navegador.newContext({ ...devices['Pixel 7'], viewport: { width: capturar ? 390 : 412, height: 844 }, acceptDownloads: true })
    : await navegador.newContext({ viewport: { width: capturar ? 1440 : 1280, height: 900 }, acceptDownloads: true });
  const pagina = await contexto.newPage();
  const reg = { youtube: 0, transcribe: 0, tts: [], errores: [] };
  pagina.on('pageerror', (e) => reg.errores.push(String(e).slice(0, 200)));
  // Descargas a memoria (el selector de archivos de Chrome no se puede automatizar sin ventana)
  await pagina.addInitScript(() => { try { delete window.showSaveFilePicker; } catch (_) { window.showSaveFilePicker = undefined; } });
  const responder = (r, datos) => r.fulfill(datos).catch(() => {});
  await pagina.route('https://www.youtube.com/iframe_api', (r) => responder(r, { contentType: 'text/javascript', body: YT_FALSO }));
  await pagina.route(/\/(health|session-config|ping|glossary|tts-voices|tts-warmup)(\?|$)/, (r) => {
    const u = r.request().url();
    if (u.includes('/health')) return responder(r, { json: { status: 'ok', server: 'vercel', model: 'whisper-large-v3', model_state: 'listo', model_ready: true, ai_configured: true, groq_configured: true, ia_configured: true, youtube_auto: true, x_video: true, tts_azure: true, tts_fish: false } });
    if (u.includes('/session-config')) return responder(r, { json: { token: 'vercel-bypass', ai_provider: 'mistral', ai_configured: true, groq_configured: true, ia_configured: true, limits: {} } });
    return responder(r, { json: {} });
  });
  await pagina.route(/\/youtube(\?|$)/, (r) => { reg.youtube += 1; return responder(r, { status: 503, json: { detail: 'No debía pedirse: el video está en caché.' } }); });
  await pagina.route(/\/transcribe(\?|$)/, (r) => { reg.transcribe += 1; return responder(r, { status: 503, json: { detail: 'No debía pedirse.' } }); });
  await pagina.route(/\/translate(\?|$)/, async (r) => {
    const cuerpo = JSON.parse(r.request().postData() || '{}');
    const piezas = [...String(cuerpo.text || '').matchAll(/\[\[JG_SEG_(\d{6})\]\]\n([^\[]*)/g)];
    const text = piezas.length ? piezas.map((m) => `[[JG_SEG_${m[1]}]]\nES ${m[2].trim()}`).join('\n\n') : `ES ${cuerpo.text}`;
    await responder(r, { json: { text, ia_used: true, provider: 'mistral', validation: { status: 'ok', integrity_score: 100 } } });
  });
  await pagina.route(/\/tts(\?|$)/, async (r) => {
    const req = r.request();
    const datos = req.method() === 'GET' ? Object.fromEntries(new URL(req.url()).searchParams) : JSON.parse(req.postData() || '{}');
    reg.tts.push({ evitarAzure: String(datos.evitar_azure) === 'true', rate: Number(datos.rate) || 1 });
    await responder(r, { status: 200, contentType: 'audio/mpeg', headers: { 'X-TTS-Engine': 'edge-neural-regional', 'X-TTS-Voice': 'es-CO-SalomeNeural', 'X-TTS-Fallback': '0' }, body: VOZ_MP3 });
  });
  await pagina.route(/\/x-video(\?|$)/, (r) => responder(r, { json: {
    id: '1349794411333394432', indice: 0, autor: 'BrooklynNets', texto: 'WATCH: Sean Marks', idioma_texto: 'en', duracion_s: 20, portada: '', fuente: 'sindicacion',
    hls: 'https://video.twimg.com/v/pl/master.m3u8',
    mp4: [{ url: 'https://video.twimg.com/v/vid/640x360/descarga.mp4', bitrate: 832000, ancho: 640, alto: 360 }],
  } }));
  await pagina.route('https://video.twimg.com/**', async (r) => {
    const u = r.request().url();
    const cuerpo = u.includes('descarga.mp4') ? MP4_X : WEBM;
    const rango = /bytes=(\d+)-(\d*)/.exec(r.request().headers().range || '');
    const cors = { 'access-control-allow-origin': '*', 'accept-ranges': 'bytes' };
    if (rango) {
      const desde = Number(rango[1]);
      const hasta = rango[2] ? Math.min(Number(rango[2]), cuerpo.length - 1) : cuerpo.length - 1;
      return responder(r, { status: 206, contentType: 'video/mp4', headers: { ...cors, 'content-range': `bytes ${desde}-${hasta}/${cuerpo.length}` }, body: cuerpo.subarray(desde, hasta + 1) });
    }
    return responder(r, { status: 200, contentType: u.includes('descarga.mp4') ? 'video/mp4' : 'video/webm', headers: cors, body: cuerpo });
  });
  await pagina.route(/i\.ytimg\.com|pbs\.twimg\.com/, (r) => responder(r, { status: 404, body: '' }));   // miniaturas rotas: la tarjeta no puede romperse
  if (sembrar) {
    await pagina.goto(`${base}/__semilla`);
    await pagina.evaluate((registros) => new Promise((ok, mal) => {
      const pedido = indexedDB.open('jg_youtube', 1);
      pedido.onupgradeneeded = () => pedido.result.createObjectStore('doblajes', { keyPath: 'videoId' });
      pedido.onsuccess = () => {
        const tx = pedido.result.transaction('doblajes', 'readwrite');
        registros.forEach((x) => tx.objectStore('doblajes').put(x));
        tx.oncomplete = () => { pedido.result.close(); ok(); };
        tx.onerror = () => mal(tx.error);
      };
    }), semilla());
  }
  await pagina.goto(`${base}/?tab=yt`, { waitUntil: 'domcontentloaded' });
  await pagina.waitForSelector('#vidBiblioteca[data-estado="listo"]', { timeout: 20000 }).catch(() => {});
  return { contexto, pagina, reg };
}

const tarjetas = (pagina) => pagina.$$eval('#vidLista .vid-tarjeta', (xs) => xs.map((x) => x.dataset.clave));
async function hastaQue(condicion, ms = 10000) {
  const fin = Date.now() + ms;
  while (Date.now() < fin) { if (await condicion()) return true; await esperar(100); }
  return false;
}
async function menuDe(pagina, clave, accion) {
  await pagina.click(`#vidLista .vid-tarjeta[data-clave="${clave}"] .vid-menu-btn`);
  await pagina.click(`#vidLista .vid-tarjeta[data-clave="${clave}"] [role="menuitem"][data-accion="${accion}"]`);
}

const navegador = await chromium.launch({ headless: !process.argv.includes('--headed') });
try {
  console.log('\n── Primer uso ─────────────────────────────────────────────────');
  {
    const { contexto, pagina, reg } = await abrir(navegador, { sembrar: false });
    comprobar('la pestaña se llama «Videos»', (await pagina.textContent('#tabYt .lbl')).trim() === 'Videos');
    comprobar('la biblioteca aparece y queda lista', await pagina.isVisible('#vidBiblioteca') && (await pagina.getAttribute('#vidBiblioteca', 'data-estado')) === 'listo');
    comprobar('biblioteca vacía: se ve el estado vacío, sin tarjetas', await pagina.isVisible('#vidVacio') && (await tarjetas(pagina)).length === 0);
    comprobar('sin errores de JavaScript', reg.errores.length === 0, reg.errores.join(' | '));
    if (capturar) await pagina.locator('#vidBiblioteca').screenshot({ path: join(carpetaCapturas, 'desktop-empty.png') });
    await contexto.close();
  }

  console.log('\n── Migración, «Seguir viendo», búsqueda y filtros ─────────────');
  {
    const { contexto, pagina, reg } = await abrir(navegador);
    comprobar('los 3 videos que ya estaban en caché entran a la biblioteca', (await tarjetas(pagina)).length === 3, (await tarjetas(pagina)).join());
    comprobar('el conteo lo dice', /3 videos/.test(await pagina.textContent('#vidConteo')));
    comprobar('«Seguir viendo» muestra el que quedó a medias', await pagina.isVisible('#vidSeguir') && (await pagina.getAttribute('#vidSeguir', 'data-clave')) === 'dNWkwrqAkcM');
    comprobar('una miniatura rota no rompe la tarjeta', (await pagina.$$('#vidLista .vid-tarjeta .vid-abrir')).length === 3);
    comprobar('cada tarjeta dice su plataforma', (await pagina.textContent('#vidLista .vid-tarjeta[data-clave^="x:"] .vid-plataforma')).trim() === 'X');
    await pagina.fill('#vidBuscar', 'marketing');
    comprobar('buscar filtra al instante', await hastaQue(async () => (await tarjetas(pagina)).join() === 'dNWkwrqAkcM'));
    await pagina.fill('#vidBuscar', 'zzzz');
    comprobar('sin coincidencias se ofrece limpiar', await hastaQue(() => pagina.isVisible('#vidSinResultados')));
    await pagina.click('#vidLimpiar');
    comprobar('«Limpiar búsqueda» devuelve todo', await hastaQue(async () => (await tarjetas(pagina)).length === 3));
    await pagina.click('#vidFiltros [data-plataforma="x"]');
    comprobar('filtro X: solo el de X', await hastaQue(async () => (await tarjetas(pagina)).join() === 'x:1349794411333394432'));
    comprobar('la ficha activa lo anuncia (aria-pressed)', (await pagina.getAttribute('#vidFiltros [data-plataforma="x"]', 'aria-pressed')) === 'true');
    await pagina.click('#vidFiltros [data-vista="vistos"]');
    comprobar('filtro Vistos', await hastaQue(async () => (await tarjetas(pagina)).join() === 'b2c3d4e5f6g'));
    await pagina.click('#vidFiltros [data-vista="todos"]');
    await pagina.selectOption('#vidOrden', 'duracion');
    comprobar('ordenar por duración', await hastaQue(async () => (await tarjetas(pagina))[0] === 'dNWkwrqAkcM'));
    if (capturar) await pagina.locator('#vidBiblioteca').screenshot({ path: join(carpetaCapturas, 'desktop.png') });

    console.log('\n── Temas, favorito, quitar y deshacer ─────────────────────────');
    await menuDe(pagina, 'b2c3d4e5f6g', 'temas');
    comprobar('el editor de temas se abre', await pagina.isVisible('#vidTemasDialogo'));
    await pagina.fill('#vidTemaNuevo', 'aprender');
    await pagina.press('#vidTemaNuevo', 'Enter');
    comprobar('el tema nuevo aparece en el editor (con mayúscula inicial)', await hastaQue(async () => /Aprender/.test(await pagina.textContent('#vidTemasActuales'))));
    await pagina.fill('#vidTemaNuevo', 'Aprender');
    await pagina.press('#vidTemaNuevo', 'Enter');
    comprobar('un tema repetido se explica y no se duplica', /ya está/i.test(await pagina.textContent('#vidTemasMensaje')));
    await pagina.click('#vidTemasListo');
    comprobar('el tema aparece como filtro', await hastaQue(() => pagina.isVisible('#vidTemas [data-etiqueta="Aprender"]')));
    await pagina.click('#vidTemas [data-etiqueta="Aprender"]');
    comprobar('filtrar por el tema', await hastaQue(async () => (await tarjetas(pagina)).join() === 'b2c3d4e5f6g'));
    await pagina.click('#vidTemas [data-etiqueta="Aprender"]');
    await menuDe(pagina, 'x:1349794411333394432', 'favorito');
    await pagina.click('#vidFiltros [data-vista="favoritos"]');
    comprobar('favorito', await hastaQue(async () => (await tarjetas(pagina)).join() === 'x:1349794411333394432'));
    await pagina.click('#vidFiltros [data-vista="todos"]');
    await pagina.reload({ waitUntil: 'domcontentloaded' });
    await pagina.waitForSelector('#vidBiblioteca[data-estado="listo"]', { timeout: 20000 }).catch(() => {});
    comprobar('tema y favorito siguen tras recargar', await hastaQue(() => pagina.isVisible('#vidTemas [data-etiqueta="Aprender"]')) && Boolean(await pagina.$('#vidLista .vid-tarjeta[data-clave^="x:"] .vid-favorito')));
    await menuDe(pagina, 'b2c3d4e5f6g', 'quitar');
    comprobar('quitar lo saca de la lista y ofrece deshacer', await hastaQue(async () => !(await tarjetas(pagina)).includes('b2c3d4e5f6g')) && await pagina.isVisible('#vidDeshacer'));
    await pagina.click('#vidDeshacer');
    comprobar('deshacer lo devuelve con su tema', await hastaQue(async () => (await tarjetas(pagina)).includes('b2c3d4e5f6g')) && /Aprender/.test(await pagina.textContent('#vidLista .vid-tarjeta[data-clave="b2c3d4e5f6g"]')));

    console.log('\n── Teclado ────────────────────────────────────────────────────');
    await pagina.focus('#vidLista .vid-tarjeta[data-clave="b2c3d4e5f6g"] .vid-menu-btn');
    await pagina.keyboard.press('Enter');
    comprobar('Enter abre el menú y el foco entra en él', await hastaQue(() => pagina.evaluate(() => document.activeElement?.getAttribute('role') === 'menuitem')));
    await pagina.keyboard.press('Escape');
    comprobar('Escape cierra el menú y devuelve el foco al botón', await hastaQue(() => pagina.evaluate(() => document.activeElement?.classList.contains('vid-menu-btn') && document.activeElement.getAttribute('aria-expanded') === 'false')));

    console.log('\n── Buscar en lo que se dice y abrir ahí ───────────────────────');
    await pagina.check('#vidEnTexto');
    await pagina.fill('#vidBuscar', 'recursión sencilla');
    comprobar('encuentra el video por lo que se dijo', await hastaQue(async () => (await tarjetas(pagina)).length === 2 && Boolean(await pagina.$('#vidLista .vid-coincidencia'))));
    await pagina.click('#vidLista .vid-tarjeta[data-clave="b2c3d4e5f6g"] [data-accion="abrir-aqui"]');
    await hastaQue(() => pagina.isVisible('#ytDubReproducir'), 20000);
    await pagina.click('#ytDubReproducir');
    comprobar('«Abrir aquí» abre el video en el segundo donde se dijo (5 s)', await hastaQue(() => pagina.evaluate(() => window.__ytSalto === 5)), String(await pagina.evaluate(() => window.__ytSalto)));
    comprobar('sin volver a pedir el texto (caché)', reg.youtube === 0, `${reg.youtube} peticiones a /youtube`);
    comprobar('la biblioteca se pliega mientras se ve el video', (await pagina.getAttribute('#vidPlegar', 'aria-expanded')) === 'false');
    await pagina.click('#btnYtSyncClose');
    comprobar('al cerrar vuelve a desplegarse', await hastaQue(async () => (await pagina.getAttribute('#vidPlegar', 'aria-expanded')) === 'true'));
    comprobar('sin errores de JavaScript', reg.errores.length === 0, reg.errores.join(' | '));
    await contexto.close();
  }

  console.log('\n── Abrir desde la tarjeta y volver al instante ────────────────');
  {
    const { contexto, pagina, reg } = await abrir(navegador);
    await pagina.click('#vidLista .vid-tarjeta[data-clave="dNWkwrqAkcM"] .vid-abrir');
    comprobar('tocar la tarjeta abre el video por el camino de siempre', await hastaQue(() => pagina.isVisible('#ytDubReproducir'), 20000));
    comprobar('sin pedir texto a /youtube', reg.youtube === 0);
    await pagina.click('#ytDubReproducir');
    comprobar('retoma donde iba (40 s)', await hastaQue(() => pagina.evaluate(() => window.__ytSalto === 40)), String(await pagina.evaluate(() => window.__ytSalto)));
    await esperar(2500);
    await pagina.click('#btnYtSyncClose');
    const tts1 = reg.tts.length;
    comprobar('la voz del video quedó guardada («Listo al instante»)', await hastaQue(() => pagina.$('#vidLista .vid-tarjeta[data-clave="dNWkwrqAkcM"] [data-listo]').then(Boolean)), `tts pedidas: ${tts1}`);
    // v157: cada voz se guarda con su tramo hablado ya medido (no se decodifica al volver).
    const medidas = await pagina.evaluate(() => new Promise((listo) => {
      const pedido = indexedDB.open('jg_youtube');
      pedido.onsuccess = () => {
        const todas = pedido.result.transaction('voces').objectStore('voces').getAll();
        todas.onsuccess = () => { const v = todas.result.filter((x) => x.video === 'dNWkwrqAkcM'); listo({ total: v.length, conHabla: v.filter((x) => x.habla?.hastaS > x.habla?.desdeS).length }); pedido.result.close(); };
      };
      pedido.onerror = () => listo({ total: -1, conHabla: -1 });
    }));
    comprobar('cada voz guardada lleva su tramo hablado medido', medidas.total > 0 && medidas.conHabla === medidas.total, JSON.stringify(medidas));
    await contexto.close();
  }

  console.log('\n── Descargas ──────────────────────────────────────────────────');
  {
    const { contexto, pagina, reg } = await abrir(navegador);
    await menuDe(pagina, 'b2c3d4e5f6g', 'descargar');
    comprobar('YouTube: solo se ofrece el audio doblado', await pagina.isVisible('#vidDescargasDialogo') && !(await pagina.isVisible('#vidDescargasDialogo input[value="original"]')) && !(await pagina.isVisible('#vidDescargasDialogo input[value="mp4"]')));
    const [mp3] = await Promise.all([pagina.waitForEvent('download', { timeout: 60000 }).catch(() => null), pagina.click('#vidDescargar')]);
    comprobar('el MP3 doblado se descarga con buen nombre', /^jg-turbo-youtube-curso-de-python-desde-cero-audio-es\.mp3$/.test(mp3?.suggestedFilename() || ''), mp3?.suggestedFilename());
    comprobar('las frases del archivo se piden sin Azure (evitar_azure)', reg.tts.length > 0 && reg.tts.every((t) => t.evitarAzure), JSON.stringify(reg.tts.slice(0, 3)));
    // Auditoría 2026-09-28: en memoria (teléfono) el archivo sale minutos después del toque;
    // Safari puede no guardarlo sin gesto, así que queda un botón para entregarlo otra vez.
    comprobar('al terminar se dice «Archivo guardado» y se ofrece «Guardar archivo» por si no se guardó', await hastaQue(() => pagina.isVisible('#vidGuardarOtraVez')) && /Archivo guardado\./.test(await pagina.textContent('#vidDescargaEstado')), await pagina.textContent('#vidDescargaEstado'));
    const [otraVez] = await Promise.all([pagina.waitForEvent('download', { timeout: 10000 }).catch(() => null), pagina.click('#vidGuardarOtraVez')]);
    comprobar('«Guardar archivo» vuelve a entregar el mismo MP3 (con el toque nuevo)', otraVez?.suggestedFilename() === mp3?.suggestedFilename(), otraVez?.suggestedFilename());
    await pagina.click('#vidDescargasCerrar');
    await menuDe(pagina, 'b2c3d4e5f6g', 'descargar');
    comprobar('al cerrar y volver a abrir, el botón de respaldo no queda colgado', !(await pagina.isVisible('#vidGuardarOtraVez')));
    await pagina.click('#vidDescargasCerrar');

    await menuDe(pagina, 'x:1349794411333394432', 'descargar');
    comprobar('X: se ofrecen original, audio y video doblado', await hastaQue(() => pagina.isVisible('#vidDescargasDialogo input[value="mp4"]')) && await pagina.isVisible('#vidDescargasDialogo input[value="original"]'));
    comprobar('la calidad muestra su tamaño estimado', /360p · \d+ (KB|MB)/.test(await pagina.textContent('#vidCalidad')));
    await pagina.check('#vidDescargasDialogo input[value="original"]');
    const [original] = await Promise.all([pagina.waitForEvent('download', { timeout: 60000 }).catch(() => null), pagina.click('#vidDescargar')]);
    comprobar('el video original de X se descarga entero', /-original\.mp4$/.test(original?.suggestedFilename() || '') && (await original?.path().then((p) => readFile(p)).then((b) => b.length).catch(() => 0)) === MP4_X.length);
    await pagina.check('#vidDescargasDialogo input[value="mp4"]');
    const [doblado] = await Promise.all([pagina.waitForEvent('download', { timeout: 90000 }).catch(() => null), pagina.click('#vidDescargar')]);
    comprobar('el video de X doblado se genera y se descarga', /-doblado-es\.mp4$/.test(doblado?.suggestedFilename() || ''), doblado?.suggestedFilename());
    comprobar('sin errores de JavaScript', reg.errores.length === 0, reg.errores.join(' | '));
    await contexto.close();
  }

  console.log('\n── Teléfono ───────────────────────────────────────────────────');
  {
    const { contexto, pagina } = await abrir(navegador, { movil: true });
    const desborde = await pagina.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    comprobar('sin desborde horizontal con la biblioteca', desborde <= 0, `${desborde} px`);
    const chicos = await pagina.$$eval('#vidBiblioteca button, #vidBiblioteca input, #vidBiblioteca select', (xs) => xs
      .filter((x) => x.offsetParent !== null && x.type !== 'checkbox' && x.type !== 'radio')
      .map((x) => ({ id: x.id || x.className || x.textContent.trim().slice(0, 20), alto: Math.round(x.getBoundingClientRect().height) }))
      .filter((x) => x.alto < 44));
    comprobar('todo lo tocable de la biblioteca mide ≥ 44 px', chicos.length === 0, JSON.stringify(chicos.slice(0, 5)));
    const letra = await pagina.$$eval('#vidBiblioteca *', (xs) => Math.min(...xs.filter((x) => x.offsetParent !== null && x.childNodes.length && [...x.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())).map((x) => parseFloat(getComputedStyle(x).fontSize))));
    comprobar('ningún texto de la biblioteca mide menos de 13 px', letra >= 13, `${letra} px`);
    if (capturar) await pagina.locator('#vidBiblioteca').screenshot({ path: join(carpetaCapturas, 'mobile.png') });
    await contexto.close();
  }
  if (capturar) {
    const { contexto, pagina } = await abrir(navegador, { movil: true, sembrar: false });
    await pagina.locator('#vidBiblioteca').screenshot({ path: join(carpetaCapturas, 'mobile-empty.png') });
    await contexto.close();
  }
} finally {
  await navegador.close();
  servidor.close();
}

console.log(`\n${ok} comprobaciones OK · ${fallos.length} fallos`);
if (fallos.length) { console.log(fallos.map((f) => `   · ${f}`).join('\n')); process.exit(1); }
