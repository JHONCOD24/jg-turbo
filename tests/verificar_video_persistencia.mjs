/* JG Turbo · Cambiar el enlace fácil y que el video abierto no se pierda, SIN red ni créditos.
 *
 * Mide lo que vive la persona, en teléfono (390×844) y escritorio (1440×900):
 *  A. «Borrar» (×), Escape, Enter y el error de formato del campo del enlace.
 *  B. «Cambiar video» y reemplazar la sesión pegando otro enlace (una sola voz).
 *  C. Cambiar de pestaña y volver: mismo video, mismo segundo, en pausa, sin pedir nada.
 *  D. Recargar (F5) y cerrar/abrir la app: mismo video, en su segundo, en pausa, desde la
 *     caché (0 llamadas a /youtube, /transcribe ni /translate).
 *  E. Video del equipo: el archivo no se copia → «Vuelve a elegir el archivo para seguir».
 *  F. Quitar el video lo olvida; un fallo al restaurar se dice y deja el panel usable.
 *
 *   node tests/verificar_video_persistencia.mjs
 *   node tests/verificar_video_persistencia.mjs --headed
 */
import { createServer } from 'node:http';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join, extname } from 'node:path';
import { pathToFileURL } from 'node:url';

const app = resolve(import.meta.dirname, '..');
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
const URL_A = 'https://www.youtube.com/watch?v=dNWkwrqAkcM';
const URL_B = 'https://www.youtube.com/watch?v=b2c3d4e5f6g';
const MP4_X = await readFile(join(app, 'tests/fixtures/biblioteca/video_x_20s.mp4'));
const VIDEO = join(app, 'tests/fixtures/archivo/clase_en_40s.webm');
const OTRO = join(app, 'tests/fixtures/archivo/dos_pistas_40s.mkv');
const CLAVE = 'jg_yt_video_activo';
const capturar = process.argv.includes('--capturas');   // guarda imágenes en .impeccable/review para revisar el diseño
const carpetaCapturas = join(app, '.impeccable', 'review');
if (capturar) await mkdir(carpetaCapturas, { recursive: true });
const captura = async (pagina, nombre) => { if (capturar) await pagina.screenshot({ path: join(carpetaCapturas, `persistencia_${nombre}.png`) }); };

const respuestaYoutube = () => ({
  status: 200,
  json: {
    text: fixture.segments.map((s) => s.text).join(' '), language: 'en', title: fixture.video_id, source: 'subtitles', segments: fixture.segments,
    audio_language: 'en', audio_language_confidence: 0.9, audio_language_conflict: false,
    audio_language_evidence: [{ fuente: 'proveedor', idioma: 'en', confianza: 0.62, detalle: 'prueba' }],
    audio_language_thresholds: { aceptar: 0.85, preguntar: 0.6 },
    language_source: 'usuario', language_resolution_confidence: 0.9, requested_lang: 'en',
    available_langs: ['en'], duration_s: 5314,
  },
});

const tipos = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.svg': 'image/svg+xml', '.css': 'text/css', '.png': 'image/png', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json', '.txt': 'text/plain' };
const servidor = createServer(async (q, r) => {
  try {
    const p = decodeURIComponent(new URL(q.url, 'http://localhost').pathname);
    // Página en blanco del mismo origen: toca el almacenamiento sin que la app tenga abierta la base
    if (p === '/__blanco') { r.setHeader('Content-Type', 'text/html'); r.end('<!doctype html><meta charset="utf-8"><title>blanco</title>'); return; }
    const f = join(app, p === '/' ? 'index.html' : p);
    r.setHeader('Content-Type', tipos[extname(f)] || 'application/octet-stream');
    r.end(await readFile(f));
  } catch { r.writeHead(404).end(); }
});
await new Promise((ok) => servidor.listen(0, '127.0.0.1', ok));
const base = process.env.JG_BASE || `http://127.0.0.1:${servidor.address().port}`;

let ok = 0;
const fallos = [];
function comprobar(nombre, condicion, detalle = '') {
  if (condicion) { ok += 1; console.log(`OK: ${nombre}`); }
  else { fallos.push(nombre); console.log(`FALLO: ${nombre}${detalle ? ` — ${detalle}` : ''}`); }
}
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));
async function hastaQue(condicion, ms = 15000, cada = 100) {
  const fin = Date.now() + ms;
  while (Date.now() < fin) { if (await condicion()) return true; await esperar(cada); }
  return false;
}

/* Reproductor de YouTube simulado (mismo contrato que la IFrame API). Respeta playerVars.start
 * salvo que la prueba lo ignore a propósito (`__ignorarStart`), para cubrir el caso de un reproductor
 * que no lo honre. */
const YT_FALSO = `(() => {
  window.__ytVivos = 0; window.__ytCreados = 0;
  class JugadorFalso {
    constructor(elemento, opciones) {
      this.opciones = opciones || {}; this.base = 0; this.inicio = 0; this.tasa = 1; this.estado = -1; this.vol = 100; this.mudo = false;
      const arranque = Number(this.opciones.playerVars && this.opciones.playerVars.start) || 0;
      if (arranque > 0 && !window.__ignorarStart) this.base = arranque;
      const viejo = typeof elemento === 'string' ? document.getElementById(elemento) : elemento;
      const marco = document.createElement('div');
      marco.id = typeof elemento === 'string' ? elemento : ((viejo && viejo.id) || 'ytPlayer');
      marco.style.cssText = 'position:absolute;inset:0;background:#111';
      if (viejo) viejo.replaceWith(marco);
      window.__yt = this; window.__ytVivos += 1; window.__ytCreados += 1;
      setTimeout(() => this._evento('onReady'), 30);
    }
    _t() { return this.estado === 1 ? this.base + ((performance.now() - this.inicio) / 1000) * this.tasa : this.base; }
    _evento(nombre, data) { const f = this.opciones.events && this.opciones.events[nombre]; if (f) f({ data, target: this }); }
    getCurrentTime() { return Math.min(this._t(), this.getDuration()); }
    getDuration() { return 5314; }
    getVideoData() { return { title: 'The Marketing GENIUS', author: 'Canal de prueba', video_id: this.opciones.videoId }; }
    getPlaybackRate() { return this.tasa; }
    getAvailablePlaybackRates() { return [0.5, 0.75, 1, 1.25, 1.5, 2]; }
    setPlaybackRate(r) { this.base = this._t(); this.inicio = performance.now(); this.tasa = Number(r) || 1; this._evento('onPlaybackRateChange', this.tasa); }
    playVideo() { if (this.estado === 1) return; this.base = this._t(); this.inicio = performance.now(); this.estado = 1; this._evento('onStateChange', 1); }
    pauseVideo() { if (this.estado !== 1) return; this.base = this._t(); this.estado = 2; this._evento('onStateChange', 2); }
    seekTo(s) { this.base = Math.max(0, Number(s) || 0); this.inicio = performance.now(); }
    getPlayerState() { return this.estado; }
    getVolume() { return this.vol; } setVolume(v) { this.vol = Number(v); }
    mute() { this.mudo = true; } unMute() { this.mudo = false; } isMuted() { return this.mudo; }
    getOptions() { return []; } getOption() { return []; } setOption() {}
    unloadModule() {}
    destroy() { this.estado = -5; window.__ytVivos -= 1; }
  }
  window.YT = { Player: JugadorFalso, PlayerState: { UNSTARTED: -1, ENDED: 0, PLAYING: 1, PAUSED: 2, BUFFERING: 3, CUED: 5 } };
  setTimeout(() => typeof window.onYouTubeIframeAPIReady === 'function' && window.onYouTubeIframeAPIReady(), 0);
})();`;

function wavSilencio(segundos) {
  const muestras = Math.max(1, Math.round(8000 * segundos));
  const b = Buffer.alloc(44 + muestras);
  b.write('RIFF', 0); b.writeUInt32LE(36 + muestras, 4); b.write('WAVE', 8); b.write('fmt ', 12);
  b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(8000, 24);
  b.writeUInt32LE(8000, 28); b.writeUInt16LE(1, 32); b.writeUInt16LE(8, 34); b.write('data', 36); b.writeUInt32LE(muestras, 40);
  b.fill(128, 44);
  return b;
}

const VIEWPORTS = [
  { nombre: 'teléfono 390×844', viewport: { width: 390, height: 844 }, movil: true },
  { nombre: 'escritorio 1440×900', viewport: { width: 1440, height: 900 }, movil: false },
];

/** Contexto nuevo (o uno persistente ya abierto) con todo lo externo simulado. */
async function contextoNuevo(navegador, vp, { carpeta = null } = {}) {
  const opciones = { viewport: vp.viewport, hasTouch: vp.movil, isMobile: vp.movil };
  return carpeta ? chromium.launchPersistentContext(carpeta, { ...opciones, headless: !process.argv.includes('--headed') }) : navegador.newContext(opciones);
}

async function abrir(navegador, vp, { contexto = null, ignorarStart = false, tab = 'yt', servidorCaido = false } = {}) {
  const ctx = contexto || await contextoNuevo(navegador, vp);
  const pagina = await ctx.newPage();
  const reg = { youtube: 0, translate: 0, transcribe: 0, tts: 0, errores: [], consola: [], servidorCaido };
  pagina.on('pageerror', (e) => reg.errores.push(String(e).slice(0, 200)));
  pagina.on('console', (m) => { if (m.type() === 'error') reg.consola.push(m.text().slice(0, 200)); });
  await pagina.addInitScript(({ ignorar }) => {
    window.__ignorarStart = ignorar;
    // Cuenta de elementos de audio/video que SUENAN (los Audio() de la voz no están en el DOM)
    window.__medios = new Set();
    const play = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function (...a) { window.__medios.add(this); return play.apply(this, a); };
    // Sin contar el WAV de silencio con que la app «desbloquea» sus elementos de audio
    window.__sonando = () => [...window.__medios].filter((m) => !m.paused && !m.ended && !String(m.src).startsWith('data:')).length;
  }, { ignorar: ignorarStart });
  const responder = (r, datos) => r.fulfill(datos).catch(() => {});
  await pagina.route('https://www.youtube.com/iframe_api', (r) => responder(r, { contentType: 'text/javascript', body: YT_FALSO }));
  await pagina.route(/\/(health|session-config|ping|glossary|tts-voices|tts-warmup)(\?|$)/, (r) => {
    const u = r.request().url();
    if (reg.servidorCaido && /\/(health|ping)(\?|$)/.test(u)) return r.abort('failed').catch(() => {});
    if (u.includes('/health')) {
      return responder(r, { json: { status: 'ok', server: 'vercel', model: 'whisper-large-v3', model_state: 'listo', model_ready: true, ai_configured: true, groq_configured: true, ia_configured: true, youtube_auto: true, x_video: true, tts_azure: true, tts_fish: false } });
    }
    if (u.includes('/session-config')) return responder(r, { json: { token: 'vercel-bypass', ai_provider: 'mistral', ai_configured: true, groq_configured: true, ia_configured: true, limits: {} } });
    return responder(r, { json: {} });
  });
  await pagina.route(/\/youtube(\?|$)/, async (r) => {
    reg.youtube += 1;
    await esperar(300);
    await responder(r, respuestaYoutube());
  });
  await pagina.route(/\/translate(\?|$)/, async (r) => {
    reg.translate += 1;
    const cuerpo = JSON.parse(r.request().postData() || '{}');
    const piezas = [...String(cuerpo.text || '').matchAll(/\[\[JG_SEG_(\d{6})\]\]\n([^\[]*)/g)];
    await esperar(100);
    const text = piezas.length ? piezas.map((m) => `[[JG_SEG_${m[1]}]]\nES ${m[2].trim()}`).join('\n\n') : `ES ${cuerpo.text}`;
    await responder(r, { json: { text, ia_used: true, provider: 'mistral', validation: { status: 'ok', integrity_score: 100 } } });
  });
  await pagina.route(/\/transcribe(\?|$)/, async (r) => {
    reg.transcribe += 1;
    await esperar(150);
    const segments = Array.from({ length: 6 }, (_, i) => ({ start: 1 + i * 6, end: 5 + i * 6, text: `Sentence number ${i + 1}.` }));
    await responder(r, { json: { text: 'x', language: 'en', segments } });
  });
  await pagina.route(/\/x-video(\?|$)/, (r) => responder(r, { json: {
    id: '1349794411333394432', indice: 0, autor: 'BrooklynNets', texto: 'WATCH: Sean Marks', idioma_texto: 'en', duracion_s: 20, portada: '', fuente: 'sindicacion',
    hls: 'https://video.twimg.com/v/pl/master.m3u8',
    mp4: [{ url: 'https://video.twimg.com/v/vid/640x360/descarga.mp4', bitrate: 832000, ancho: 640, alto: 360 }],
  } }));
  await pagina.route('https://video.twimg.com/**', async (r) => {
    const rango = /bytes=(\d+)-(\d*)/.exec(r.request().headers().range || '');
    const cors = { 'access-control-allow-origin': '*', 'accept-ranges': 'bytes' };
    if (rango) {
      const desde = Number(rango[1]);
      const hasta = rango[2] ? Math.min(Number(rango[2]), MP4_X.length - 1) : MP4_X.length - 1;
      return responder(r, { status: 206, contentType: 'video/mp4', headers: { ...cors, 'content-range': `bytes ${desde}-${hasta}/${MP4_X.length}` }, body: MP4_X.subarray(desde, hasta + 1) });
    }
    return responder(r, { status: 200, contentType: 'video/mp4', headers: cors, body: MP4_X });
  });
  await pagina.route(/i\.ytimg\.com|pbs\.twimg\.com/, (r) => responder(r, { status: 404, body: '' }));
  await pagina.route(/\/tts(\?|$)/, async (r) => {
    reg.tts += 1;
    const req = r.request();
    const datos = req.method() === 'GET' ? Object.fromEntries(new URL(req.url()).searchParams) : JSON.parse(req.postData() || '{}');
    await esperar(80);
    await responder(r, { status: 200, contentType: 'audio/wav', headers: { 'X-TTS-Engine': 'azure-neural-regional', 'X-TTS-Voice': 'es-CO-SalomeNeural', 'X-TTS-Fallback': '0' }, body: wavSilencio(Math.max(1.5, String(datos.text || '').length / 12)) });
  });
  await pagina.goto(`${base}/?tab=${tab}`, { waitUntil: 'domcontentloaded' });
  await esperarPanel(pagina);
  return { contexto: ctx, pagina, reg };
}
async function esperarPanel(pagina) {
  await pagina.waitForSelector('#ytUrl', { state: 'attached' });
  await pagina.waitForFunction(() => Boolean(window.jgVideoLocal), null, { timeout: 30000, polling: 100 });
}

const listo = (pagina) => pagina.evaluate(() => {
  const r = document.getElementById('ytDubReproducir');
  return Boolean(r && !r.hidden && !r.disabled);
});
const esperarListo = (pagina, ms = 30000) => hastaQue(() => listo(pagina), ms, 150);
async function pegarYDoblar(pagina, url = URL_A) {
  await pagina.fill('#ytUrl', url);
  await pagina.waitForFunction(() => !document.getElementById('ytSyncBtn').disabled, null, { timeout: 10000, polling: 100 });
  await pagina.click('#ytSyncBtn');
}
const sonando = (pagina) => pagina.evaluate(() => window.__sonando());
const tiempoYt = (pagina) => pagina.evaluate(() => window.__yt?.getCurrentTime() ?? -1);
const estadoYt = (pagina) => pagina.evaluate(() => window.__yt?.getPlayerState() ?? -9);
const llave = (pagina) => pagina.evaluate((k) => localStorage.getItem(k), CLAVE);
const visible = (pagina, selector) => pagina.evaluate((s) => {
  const e = document.querySelector(s);
  if (!e || e.hidden) return false;
  const r = e.getBoundingClientRect();
  const c = getComputedStyle(e);
  return r.width > 0 && r.height > 0 && c.visibility !== 'hidden' && c.display !== 'none';
}, selector);
const enfocado = (pagina) => pagina.evaluate(() => document.activeElement?.id || '');
const llamadas = (reg) => `${reg.youtube}/${reg.transcribe}/${reg.translate}`;
async function verErrores(reg, nombre) {
  comprobar(`${nombre}: sin errores de JavaScript`, reg.errores.length === 0, reg.errores.join(' | '));
}
/** Pulsa «Ver con voz en español» y espera a que alguna voz suene. */
async function verConVoz(pagina) {
  await pagina.click('#ytDubReproducir');
  return hastaQue(async () => (await sonando(pagina)) > 0, 12000, 100);
}

const navegador = await chromium.launch({ headless: !process.argv.includes('--headed') });
const carpetasTemporales = [];
try {
  for (const vp of VIEWPORTS.filter((v) => !process.argv.includes('--escritorio') || !v.movil)) {
    console.log(`\n══════════ ${vp.nombre} ══════════`);

    console.log('\n── A. Corregir el enlace sin esfuerzo ─────────────────────────');
    {
      const { contexto, pagina, reg } = await abrir(navegador, vp);
      comprobar('vacío: el botón Borrar no se ve', !(await visible(pagina, '#ytUrlBorrar')));
      await pagina.fill('#ytUrl', 'hola');
      comprobar('con texto: aparece el botón Borrar', await visible(pagina, '#ytUrlBorrar'));
      await captura(pagina, `${vp.movil ? 'movil' : 'escritorio'}_borrar`);
      const caja = await pagina.locator('#ytUrlBorrar').boundingBox();
      comprobar('Borrar mide al menos 44×44 px (toque cómodo)', caja && caja.width >= 43.9 && caja.height >= 43.9, JSON.stringify(caja));
      comprobar('Borrar tiene nombre accesible «Borrar el enlace»', (await pagina.getAttribute('#ytUrlBorrar', 'aria-label')) === 'Borrar el enlace');
      const dentro = await pagina.evaluate(() => {
        const i = document.getElementById('ytUrl').getBoundingClientRect();
        const b = document.getElementById('ytUrlBorrar').getBoundingClientRect();
        return { dentro: b.left >= i.left && b.right <= i.right + 0.5 && b.top >= i.top - 0.5 && b.bottom <= i.bottom + 0.5, i: [i.left, i.top, i.right, i.bottom], b: [b.left, b.top, b.right, b.bottom] };
      });
      comprobar('Borrar está DENTRO del campo', dentro.dentro, JSON.stringify(dentro));
      comprobar('un texto que no es enlace muestra el error de formato con ejemplo', (await visible(pagina, '#ytUrlError')) && /youtube\.com\/watch/.test(await pagina.textContent('#ytUrlError')));
      comprobar('con enlace inválido el botón Doblar sigue apagado', await pagina.isDisabled('#ytSyncBtn'));
      await pagina.click('#ytUrlBorrar');
      comprobar('clic en Borrar: el campo queda vacío', (await pagina.inputValue('#ytUrl')) === '');
      comprobar('clic en Borrar: el foco vuelve al campo', (await enfocado(pagina)) === 'ytUrl');
      comprobar('clic en Borrar: el botón y el error desaparecen', !(await visible(pagina, '#ytUrlBorrar')) && !(await visible(pagina, '#ytUrlError')));
      comprobar('clic en Borrar: Doblar sigue apagado', await pagina.isDisabled('#ytSyncBtn'));
      await pagina.fill('#ytUrl', URL_A);
      comprobar('enlace válido: sin error y Doblar se enciende', !(await visible(pagina, '#ytUrlError')) && !(await pagina.isDisabled('#ytSyncBtn')));
      await pagina.click('#ytUrlBorrar');
      comprobar('Borrar apaga Doblar de inmediato', await pagina.isDisabled('#ytSyncBtn'));
      await pagina.fill('#ytUrl', 'https://x.com/BrooklynNets/status/1349794411333394432');
      comprobar('enlace de X también es válido (sin error)', !(await visible(pagina, '#ytUrlError')));
      await pagina.press('#ytUrl', 'Escape');
      comprobar('Escape vacía el campo, lo deja enfocado y apaga Doblar', (await pagina.inputValue('#ytUrl')) === '' && (await enfocado(pagina)) === 'ytUrl' && await pagina.isDisabled('#ytSyncBtn'));
      await pagina.fill('#ytUrl', 'esto no sirve');
      await pagina.press('#ytUrl', 'Enter');
      comprobar('Enter con enlace inválido NO falla en silencio: el error sigue a la vista', await visible(pagina, '#ytUrlError') && reg.youtube === 0);
      await pagina.press('#ytUrl', 'Escape');
      await verErrores(reg, 'campo del enlace');
      await contexto.close();
    }

    console.log('\n── B. Cambiar video / reemplazar la sesión ─────────────────────');
    {
      const { contexto, pagina, reg } = await abrir(navegador, vp);
      comprobar('sin video abierto no hay «Cambiar video» a la vista', !(await visible(pagina, '#ytCambiarVideo')));
      await pegarYDoblar(pagina);
      comprobar('el doblaje queda listo', await esperarListo(pagina));
      comprobar('con un video abierto «Cambiar video» se ve', await visible(pagina, '#ytCambiarVideo'));
      await captura(pagina, `${vp.movil ? 'movil' : 'escritorio'}_cambiar`);
      const cajaCambiar = await pagina.locator('#ytCambiarVideo').boundingBox();
      comprobar('«Cambiar video» mide al menos 44 px de alto', cajaCambiar && cajaCambiar.height >= 43.9, JSON.stringify(cajaCambiar));
      comprobar('la voz suena antes de cambiar', await verConVoz(pagina));
      const antes = llamadas(reg);
      await pagina.click('#ytCambiarVideo');
      comprobar('Cambiar video: 0 elementos de audio sonando', (await sonando(pagina)) === 0);
      comprobar('Cambiar video: la sesión se cierra (panel del reproductor oculto)', !(await visible(pagina, '#ytSyncArea')));
      comprobar('Cambiar video: el campo queda vacío', (await pagina.inputValue('#ytUrl')) === '');
      comprobar('Cambiar video: el campo queda enfocado y a la vista', (await enfocado(pagina)) === 'ytUrl' && await visible(pagina, '#ytUrl'));
      comprobar('Cambiar video: el reproductor se destruyó', (await pagina.evaluate(() => window.__ytVivos)) === 0);
      comprobar('Cambiar video: olvida el video activo', (await llave(pagina)) === null);
      await esperar(1500);
      comprobar('Cambiar video: no sigue sonando nada ni quedan peticiones', (await sonando(pagina)) === 0 && llamadas(reg) === antes, `${antes} → ${llamadas(reg)}`);

      // Reemplazar pegando otro enlace con la sesión abierta
      await pegarYDoblar(pagina, URL_A);
      comprobar('reemplazo: la primera sesión queda lista', await esperarListo(pagina));
      comprobar('reemplazo: la primera voz suena', await verConVoz(pagina));
      await pagina.evaluate((u) => { const i = document.getElementById('ytUrl'); i.value = u; i.dispatchEvent(new Event('input')); document.getElementById('ytSyncBtn').click(); }, URL_B);
      comprobar('reemplazo: la voz de la sesión anterior calla de inmediato', (await sonando(pagina)) === 0);
      comprobar('reemplazo: la segunda sesión queda lista', await esperarListo(pagina));
      comprobar('reemplazo: una sola sesión viva (un reproductor)', (await pagina.evaluate(() => window.__ytVivos)) === 1 && (await pagina.evaluate(() => window.__ytCreados)) >= 3);
      comprobar('reemplazo: el video activo apunta al nuevo', JSON.parse(await llave(pagina) || '{}').clave === 'b2c3d4e5f6g');
      await verConVoz(pagina);
      await esperar(600);
      comprobar('reemplazo: una sola voz suena a la vez', (await sonando(pagina)) <= 1, String(await sonando(pagina)));
      await verErrores(reg, 'cambiar video');
      await contexto.close();
    }

    console.log('\n── C. Cambiar de pestaña y volver ──────────────────────────────');
    {
      const { contexto, pagina, reg } = await abrir(navegador, vp);
      await pegarYDoblar(pagina);
      await esperarListo(pagina);
      await pagina.evaluate(() => { window.__yt.__marca = 'misma-sesion'; });
      comprobar('la voz suena antes de irse', await verConVoz(pagina));
      await esperar(1500);
      // La preparación del resto del video sigue en segundo plano; se espera a que termine para medir «no se vuelve a pedir nada»
      let previo = '';
      await hastaQue(async () => { const ahora = llamadas(reg); const quieto = ahora === previo; previo = ahora; return quieto; }, 20000, 2500);
      await pagina.click('#tabPdf');
      await esperar(500);
      const tFuera = await tiempoYt(pagina);
      comprobar('al salir de la pestaña el video queda en pausa', (await estadoYt(pagina)) === 2);
      comprobar('al salir de la pestaña la voz calla (0 sonando)', (await sonando(pagina)) === 0);
      const antesVolver = llamadas(reg);
      await esperar(1200);
      comprobar('en otra pestaña el segundo no avanza', Math.abs((await tiempoYt(pagina)) - tFuera) < 0.3, `${tFuera} → ${await tiempoYt(pagina)}`);
      await pagina.click('#tabYt');
      await esperar(300);
      comprobar('al volver, el panel del reproductor sigue abierto', await visible(pagina, '#ytSyncArea'));
      comprobar('al volver, es el MISMO reproductor (no se recreó)', (await pagina.evaluate(() => window.__yt?.__marca)) === 'misma-sesion' && (await pagina.evaluate(() => window.__ytCreados)) === 1);
      comprobar('al volver, mismo segundo (±1 s)', Math.abs((await tiempoYt(pagina)) - tFuera) <= 1, `${tFuera} → ${await tiempoYt(pagina)}`);
      comprobar('al volver, sigue en pausa y sin nada sonando', (await estadoYt(pagina)) === 2 && (await sonando(pagina)) === 0);
      comprobar('al volver, hay un toque visible para seguir', await visible(pagina, '#ytDubReproducir'));
      comprobar('al volver, 0 peticiones nuevas de texto, transcripción ni traducción', llamadas(reg) === antesVolver, `${antesVolver} → ${llamadas(reg)}`);
      await pagina.click('#ytDubReproducir');
      comprobar('con el toque, el video sigue desde ahí', await hastaQue(async () => (await estadoYt(pagina)) === 1, 3000) && (await tiempoYt(pagina)) >= tFuera - 1);

      // Salir con el video en pausa NO lo reproduce al volver
      await pagina.evaluate(() => window.__yt.pauseVideo());
      await pagina.click('#tabTrans');
      await esperar(300);
      await pagina.click('#tabYt');
      await esperar(300);
      comprobar('si ya estaba en pausa, volver no lo reproduce solo', (await estadoYt(pagina)) === 2);
      await verErrores(reg, 'cambio de pestaña');
      await contexto.close();
    }

    console.log('\n── D. Recargar y volver a abrir la app ─────────────────────────');
    for (const ignorarStart of [false, true]) {
      const etiqueta = ignorarStart ? 'reproductor que ignora start' : 'recarga (F5)';
      const { contexto, pagina, reg } = await abrir(navegador, vp, { ignorarStart });
      await pegarYDoblar(pagina);
      await esperarListo(pagina);
      await verConVoz(pagina);
      await pagina.evaluate(() => window.__yt.seekTo(300));
      await esperar(4200);
      const tReal = await tiempoYt(pagina);
      const antes = llamadas(reg);
      await pagina.reload({ waitUntil: 'domcontentloaded' });
      await esperarPanel(pagina);
      comprobar(`${etiqueta}: la app abre en la pestaña de video`, await pagina.evaluate(() => document.getElementById('panelYt').classList.contains('active')));
      comprobar(`${etiqueta}: el panel del video reaparece`, await hastaQue(() => visible(pagina, '#ytSyncArea'), 15000));
      comprobar(`${etiqueta}: el doblaje queda listo para seguir`, await esperarListo(pagina));
      const t = await tiempoYt(pagina);
      comprobar(`${etiqueta}: el video está en su segundo (±3 s)`, Math.abs(t - tReal) <= 3 && t > 250, `${tReal} → ${t}`);
      comprobar(`${etiqueta}: queda en pausa, sin reproducir solo`, (await estadoYt(pagina)) !== 1 && (await sonando(pagina)) === 0);
      await captura(pagina, `${vp.movil ? 'movil' : 'escritorio'}_restaurado${ignorarStart ? '_b' : ''}`);
      comprobar(`${etiqueta}: avisa «Seguimos donde ibas: 5:0x»`, (await visible(pagina, '#ytReanudar')) && /Seguimos donde ibas: 5:\d\d/.test(await pagina.textContent('#ytReanudarTitulo')), await pagina.textContent('#ytReanudarTitulo'));
      comprobar(`${etiqueta}: 0 llamadas a texto, transcripción y traducción (todo salió de la caché)`, llamadas(reg) === antes, `antes ${antes} · ahora ${llamadas(reg)}`);
      comprobar(`${etiqueta}: el campo del enlace sigue conectado al video`, JSON.parse(await llave(pagina) || '{}').clave === 'dNWkwrqAkcM');
      const visibleReproducir = await visible(pagina, '#ytDubReproducir');
      comprobar(`${etiqueta}: hay un botón para reproducir`, visibleReproducir);
      await pagina.click('#ytDubReproducir');
      comprobar(`${etiqueta}: al tocarlo reproduce desde su segundo`, await hastaQue(async () => (await estadoYt(pagina)) === 1, 3000) && (await tiempoYt(pagina)) >= t - 1);
      comprobar(`${etiqueta}: el aviso se va al reproducir`, !(await visible(pagina, '#ytReanudar')));
      await verErrores(reg, etiqueta);
      await contexto.close();
    }
    {
      // Cerrar la app de verdad y volver a abrirla: mismo almacenamiento en disco
      const carpeta = await mkdtemp(join(tmpdir(), 'jg-persistencia-'));
      carpetasTemporales.push(carpeta);
      const ctx1 = await contextoNuevo(navegador, vp, { carpeta });
      const a = await abrir(navegador, vp, { contexto: ctx1 });
      await pegarYDoblar(a.pagina);
      await esperarListo(a.pagina);
      await verConVoz(a.pagina);
      await a.pagina.evaluate(() => window.__yt.seekTo(420));
      await esperar(4200);
      const tReal = await tiempoYt(a.pagina);
      await ctx1.close();
      const ctx2 = await contextoNuevo(navegador, vp, { carpeta });
      const b = await abrir(navegador, vp, { contexto: ctx2 });
      comprobar('cerrar y abrir: el panel del video reaparece', await hastaQue(() => visible(b.pagina, '#ytSyncArea'), 15000));
      comprobar('cerrar y abrir: listo para seguir', await esperarListo(b.pagina));
      const t = await tiempoYt(b.pagina);
      comprobar('cerrar y abrir: en su segundo (±3 s) y en pausa', Math.abs(t - tReal) <= 3 && (await estadoYt(b.pagina)) !== 1, `${tReal} → ${t}`);
      comprobar('cerrar y abrir: 0 llamadas a texto/transcripción/traducción', b.reg.youtube === 0 && b.reg.transcribe === 0 && b.reg.translate === 0, llamadas(b.reg));
      comprobar('cerrar y abrir: avisa dónde iba', /Seguimos donde ibas: 7:\d\d/.test(await b.pagina.textContent('#ytReanudarTitulo')));
      await verErrores(b.reg, 'cerrar y abrir');
      await ctx2.close();
    }

    {
      // Un post de X ya doblado (sembrado en la base): se restaura desde la caché, en pausa y en su segundo
      const contexto = await contextoNuevo(navegador, vp);
      const semilla = await contexto.newPage();
      await semilla.goto(`${base}/__blanco`);
      await semilla.evaluate(() => new Promise((ok, mal) => {
        const segs = [{ startTime: 1, endTime: 4, duration: 3, text: 'Welcome to this Python course.' }, { startTime: 5, endTime: 9, duration: 4, text: 'Recursion is simple once you see it.' }, { startTime: 10, endTime: 14, duration: 4, text: 'Let us write our first function.' }];
        const pedido = indexedDB.open('jg_youtube', 1);
        pedido.onupgradeneeded = () => { if (!pedido.result.objectStoreNames.contains('doblajes')) pedido.result.createObjectStore('doblajes', { keyPath: 'videoId' }); };
        pedido.onsuccess = () => {
          const tx = pedido.result.transaction('doblajes', 'readwrite');
          tx.objectStore('doblajes').put({ videoId: 'x:1349794411333394432', titulo: '@BrooklynNets · WATCH: Sean Marks', duracionS: 20, idiomaOrigen: 'en', posicionS: 0, segmentos: segs, traducciones: [[0, 'Bienvenidos.'], [1, 'La recursión es sencilla.'], [2, 'Escribamos una función.']], actualizado: Date.now() });
          tx.oncomplete = () => { pedido.result.close(); ok(); };
          tx.onerror = () => mal(tx.error);
        };
        pedido.onerror = () => mal(pedido.error);
      }));
      await semilla.evaluate(([k]) => localStorage.setItem(k, JSON.stringify({ tipo: 'x', clave: 'x:1349794411333394432', url: 'https://x.com/BrooklynNets/status/1349794411333394432', titulo: '@BrooklynNets', segundo: 12 })), [CLAVE]);
      await semilla.close();
      const { pagina, reg } = await abrir(navegador, vp, { contexto });
      comprobar('post de X: el panel reaparece y queda listo desde la caché', await hastaQue(() => visible(pagina, '#ytSyncArea'), 20000) && await esperarListo(pagina, 40000));
      const v = await pagina.evaluate(() => { const e = document.getElementById('ytPlayer')?.contentDocument?.querySelector('video'); return e ? { t: e.currentTime, pausado: e.paused } : null; });
      comprobar('post de X: queda en pausa en su segundo (±3 s)', v && v.pausado && Math.abs(v.t - 12) <= 3, JSON.stringify(v));
      comprobar('post de X: avisa «Seguimos donde ibas: 0:12» y no transcribe ni traduce', /Seguimos donde ibas: 0:12/.test(await pagina.textContent('#ytReanudarTitulo')) && reg.transcribe === 0 && reg.youtube === 0);
      await verErrores(reg, 'post de X');
      await contexto.close();
    }
    {
      // Recargar apenas termina de preparar (sin esperar): el video reaparece igual
      const { contexto, pagina, reg } = await abrir(navegador, vp);
      await pegarYDoblar(pagina);
      await esperarListo(pagina);
      const antes = llamadas(reg);
      await pagina.reload({ waitUntil: 'domcontentloaded' });
      await esperarPanel(pagina);
      comprobar('recarga inmediata: el video reaparece y queda listo', await hastaQue(() => visible(pagina, '#ytSyncArea'), 15000) && await esperarListo(pagina));
      comprobar('recarga inmediata: no vuelve a pedir el texto del video', reg.youtube === 1 && reg.transcribe === 0, `${antes} → ${llamadas(reg)}`);
      console.log(`INFO recarga inmediata: llamadas texto/transcripción/traducción ${antes} → ${llamadas(reg)}`);
      await verErrores(reg, 'recarga inmediata');
      await contexto.close();
    }

    console.log('\n── E. Video del equipo: el archivo no se copia ─────────────────');
    {
      const { contexto, pagina, reg } = await abrir(navegador, vp);
      await pagina.setInputFiles('#ytArchivo', VIDEO);
      await pagina.waitForFunction(() => !document.getElementById('ytSyncBtn').disabled, null, { timeout: 10000 });
      await pagina.click('#ytSyncBtn');
      comprobar('el video del equipo queda listo', await esperarListo(pagina, 40000));
      const subidas = reg.transcribe;
      await pagina.evaluate(() => { document.getElementById('ytPlayer').contentDocument.querySelector('video').currentTime = 20; });
      await esperar(4200);
      comprobar('el video activo guarda tipo archivo SIN el contenido del video', await (async () => {
        const v = JSON.parse(await llave(pagina) || '{}');
        return v.tipo === 'archivo' && /^archivo:/.test(v.clave) && v.nombreArchivo === 'clase_en_40s.webm' && !('contenido' in v) && (await llave(pagina)).length < 600;
      })());
      await pagina.reload({ waitUntil: 'domcontentloaded' });
      await esperarPanel(pagina);
      comprobar('archivo tras recargar: la ficha ofrece «Vuelve a elegir el archivo para seguir»', await hastaQue(() => visible(pagina, '#ytReanudarAccion'), 15000) && /Vuelve a elegir el archivo para seguir/.test(await pagina.textContent('#ytReanudarAccion')));
      await captura(pagina, `${vp.movil ? 'movil' : 'escritorio'}_archivo`);
      comprobar('archivo tras recargar: explica con honestidad que no se copia', /no se copian/.test(await pagina.textContent('#ytReanudarMensaje')));
      comprobar('archivo tras recargar: no hay reproductor ni voz sonando', !(await visible(pagina, '#ytSyncArea')) && (await sonando(pagina)) === 0);
      comprobar('archivo tras recargar: sin errores de consola ni de JavaScript', reg.errores.length === 0 && reg.consola.filter((c) => !/Failed to load resource/.test(c)).length === 0, [...reg.errores, ...reg.consola].join(' | '));
      // Otro archivo: se dice y no se dobla
      const [otro] = await Promise.all([pagina.waitForEvent('filechooser'), pagina.click('#ytReanudarAccion')]);
      await otro.setFiles(OTRO);
      comprobar('con OTRO archivo se dice claro y no se transcribe', await hastaQue(async () => /no es/.test(await pagina.textContent('#ytReanudarMensaje')), 10000) && reg.transcribe === subidas);
      // El mismo archivo: retoma en su segundo, sin transcribir
      const [mismo] = await Promise.all([pagina.waitForEvent('filechooser'), pagina.click('#ytReanudarAccion')]);
      await mismo.setFiles(VIDEO);
      comprobar('con el MISMO archivo abre listo', await esperarListo(pagina, 40000));
      const tVideo = await pagina.evaluate(() => document.getElementById('ytPlayer').contentDocument.querySelector('video').currentTime);
      comprobar('con el mismo archivo retoma en el segundo guardado (±3 s) y en pausa', Math.abs(tVideo - 20) <= 3 && await pagina.evaluate(() => document.getElementById('ytPlayer').contentDocument.querySelector('video').paused), String(tVideo));
      comprobar('con el mismo archivo no vuelve a transcribir', reg.transcribe === subidas, `${subidas} → ${reg.transcribe}`);
      comprobar('con el mismo archivo avisa «Seguimos donde ibas»', /Seguimos donde ibas: 0:\d\d/.test(await pagina.textContent('#ytReanudarTitulo')));
      await verErrores(reg, 'archivo');
      await contexto.close();
    }

    console.log('\n── F. Quitar lo olvida · y si falla, se dice ──────────────────');
    {
      // Quitar con «Cerrar» → recargar → vacío
      const { contexto, pagina, reg } = await abrir(navegador, vp);
      await pegarYDoblar(pagina);
      await esperarListo(pagina);
      comprobar('con video abierto hay un video activo guardado', (await llave(pagina)) !== null);
      const antesCerrar = llamadas(reg);
      await pagina.click('#btnYtSyncClose');
      comprobar('Cerrar borra el video activo', (await llave(pagina)) === null);
      await pagina.reload({ waitUntil: 'domcontentloaded' });
      await esperarPanel(pagina);
      await esperar(1500);
      comprobar('tras Cerrar y recargar: el panel está vacío (sin reproductor ni aviso)', !(await visible(pagina, '#ytSyncArea')) && !(await visible(pagina, '#ytReanudar')) && (await pagina.inputValue('#ytUrl')) === '');
      comprobar('tras Cerrar y recargar: no se pidió nada', llamadas(reg) === antesCerrar, `${antesCerrar} → ${llamadas(reg)}`);
      // Quitar con «Cambiar video» → recargar → vacío
      await pegarYDoblar(pagina);
      await esperarListo(pagina);
      await pagina.click('#ytCambiarVideo');
      await pagina.reload({ waitUntil: 'domcontentloaded' });
      await esperarPanel(pagina);
      await esperar(1200);
      comprobar('tras Cambiar video y recargar: panel vacío', !(await visible(pagina, '#ytSyncArea')) && (await llave(pagina)) === null);
      // Cancelar a mitad de preparación también lo olvida
      await verErrores(reg, 'quitar');
      await contexto.close();
    }
    {
      // El video activo desaparece de la caché → aviso claro y panel usable
      const { contexto, pagina, reg } = await abrir(navegador, vp);
      await pegarYDoblar(pagina);
      await esperarListo(pagina);
      await esperar(1800);
      const guardado = await llave(pagina);
      await pagina.goto(`${base}/__blanco`);
      await pagina.evaluate(() => new Promise((ok) => { const p = indexedDB.deleteDatabase('jg_youtube'); p.onsuccess = p.onerror = p.onblocked = () => ok(); }));
      await pagina.evaluate(([k, v]) => localStorage.setItem(k, v), [CLAVE, guardado]);
      reg.youtube = 0; reg.translate = 0; reg.transcribe = 0;
      await pagina.goto(`${base}/?tab=yt`, { waitUntil: 'domcontentloaded' });
      await esperarPanel(pagina);
      comprobar('sin caché: aviso claro de que no se pudo retomar', await hastaQue(() => visible(pagina, '#ytReanudar'), 10000) && /no alcanzó a prepararse/.test(await pagina.textContent('#ytReanudarTitulo')));
      comprobar('sin caché: el enlace queda en el campo para doblarlo de nuevo', (await pagina.inputValue('#ytUrl')) === URL_A);
      comprobar('sin caché: el panel sigue usable (Doblar encendido) y no hay pantalla en blanco', !(await pagina.isDisabled('#ytSyncBtn')) && await visible(pagina, '#ytUrl'));
      comprobar('sin caché: no gastó nada por su cuenta', llamadas(reg) === '0/0/0', llamadas(reg));
      await pagina.click('#ytSyncBtn');
      comprobar('sin caché: pulsando Doblar vuelve a prepararlo', await esperarListo(pagina) && reg.youtube === 1);
      await verErrores(reg, 'sin caché');
      await contexto.close();
    }
    {
      // Servidor caído al restaurar → aviso claro, enlace en el campo, y no pisa lo que la persona hizo
      const { contexto, pagina, reg } = await abrir(navegador, vp);
      await pegarYDoblar(pagina);
      await esperarListo(pagina);
      await esperar(1800);
      reg.servidorCaido = true;
      reg.youtube = 0; reg.translate = 0; reg.transcribe = 0;
      await pagina.reload({ waitUntil: 'domcontentloaded' });
      await esperarPanel(pagina);
      const avisoCaido = await hastaQue(() => visible(pagina, '#ytReanudar'), 20000) && /No hay conexión/.test(await pagina.textContent('#ytReanudarTitulo'));
      if (!avisoCaido) console.log('DIAGNOSTICO', await pagina.evaluate(() => ({ titulo: document.getElementById('ytReanudarTitulo').textContent, online: typeof serverInfo !== 'undefined' && serverInfo.online, area: !document.getElementById('ytSyncArea').hidden })));
      comprobar('servidor caído: aviso claro (sin conexión) y no pantalla en blanco', avisoCaido);
      comprobar('servidor caído: el enlace queda en el campo', (await pagina.inputValue('#ytUrl')) === URL_A);
      comprobar('servidor caído: sigue guardado el video activo', (await llave(pagina)) !== null);
      reg.servidorCaido = false;
      await pagina.evaluate(() => checkServer());
      await hastaQue(async () => !(await pagina.isDisabled('#ytSyncBtn')), 10000);
      comprobar('al volver el servidor, Doblar se enciende y reanuda sin gastar de más', !(await pagina.isDisabled('#ytSyncBtn')));
      await verErrores(reg, 'servidor caído');
      await contexto.close();
    }
    {
      // Carrera: la persona ya pegó algo mientras la restauración esperaba al servidor
      const { contexto, pagina, reg } = await abrir(navegador, vp);
      await pegarYDoblar(pagina);
      await esperarListo(pagina);
      await esperar(1800);
      reg.servidorCaido = true;
      await pagina.reload({ waitUntil: 'domcontentloaded' });
      await esperarPanel(pagina);
      await pagina.fill('#ytUrl', URL_B);
      reg.servidorCaido = false;
      await pagina.evaluate(() => checkServer());
      await hastaQue(async () => !(await pagina.isDisabled('#ytSyncBtn')), 10000);
      await esperar(1500);
      comprobar('carrera: lo que la persona pegó NO se pisa con la restauración', (await pagina.inputValue('#ytUrl')) === URL_B && !(await visible(pagina, '#ytSyncArea')));
      await pagina.click('#ytSyncBtn');
      comprobar('carrera: la persona abre su propio video y es el único', await esperarListo(pagina) && (await pagina.evaluate(() => window.__ytVivos)) === 1 && JSON.parse(await llave(pagina) || '{}').clave === 'b2c3d4e5f6g');
      await verErrores(reg, 'carrera');
      await contexto.close();
    }
    {
      // «Descartar» el aviso de un video del equipo olvida lo guardado
      const { contexto, pagina, reg } = await abrir(navegador, vp);
      await pagina.evaluate(([k]) => localStorage.setItem(k, JSON.stringify({ tipo: 'archivo', clave: 'archivo:0123456789abcdef', titulo: 'Clase', nombreArchivo: 'clase.mp4', bytes: 1000, segundo: 90 })), [CLAVE]);
      await pagina.goto(`${base}/?tab=yt`, { waitUntil: 'domcontentloaded' });
      await esperarPanel(pagina);
      comprobar('archivo sin doblaje guardado: dice que ya no está preparado y ofrece elegirlo', await hastaQue(() => visible(pagina, '#ytReanudar'), 10000) && /ya no está preparado/.test(await pagina.textContent('#ytReanudarTitulo')) && await visible(pagina, '#ytReanudarAccion'));
      const cerrarCaja = await pagina.locator('#ytReanudarCerrar').boundingBox();
      comprobar('«Descartar» mide al menos 44 px', cerrarCaja && cerrarCaja.width >= 43.9 && cerrarCaja.height >= 43.9, JSON.stringify(cerrarCaja));
      await pagina.click('#ytReanudarCerrar');
      comprobar('Descartar oculta el aviso y olvida el video activo', !(await visible(pagina, '#ytReanudar')) && (await llave(pagina)) === null);
      await verErrores(reg, 'descartar');
      await contexto.close();
    }
    {
      // Datos basura en la clave: no rompe nada
      const { contexto, pagina, reg } = await abrir(navegador, vp);
      await pagina.evaluate(([k]) => localStorage.setItem(k, '{esto no es json'), [CLAVE]);
      await pagina.goto(`${base}/?tab=yt`, { waitUntil: 'domcontentloaded' });
      await esperarPanel(pagina);
      await esperar(800);
      comprobar('clave con basura: el panel abre normal, sin aviso ni errores', !(await visible(pagina, '#ytReanudar')) && !(await visible(pagina, '#ytSyncArea')) && reg.errores.length === 0);
      await contexto.close();
    }
  }
} finally {
  await navegador.close();
  servidor.close();
  for (const c of carpetasTemporales) await rm(c, { recursive: true, force: true }).catch(() => {});
}

console.log(`\n${ok} comprobaciones OK · ${fallos.length} fallos`);
if (fallos.length) { console.log('Fallos:\n - ' + fallos.join('\n - ')); process.exit(1); }
