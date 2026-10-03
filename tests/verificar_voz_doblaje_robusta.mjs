/* JG Turbo · La voz doblada en la app REAL (Chromium), sin red ni créditos.
 *
 * Complementa tests/test_voz_robusta.mjs (simulador, tiempo virtual) con audio de
 * verdad: elementos <audio> reales, reproductor de YouTube simulado, TTS simulado
 * (WAV con la duración de una voz real). Cuenta FRASES con eventos de los <audio>
 * (playing / pause / ended), no con el estado interno del motor:
 *   A. Reproducción continua: frases sonadas completas = esperadas, 0 cortes, latencia de entrada.
 *   B. Pausar y seguir con el reproductor (como la barra de YouTube).
 *   C. Adelantar y retroceder con la barra.
 *   D. Cambiar de pestaña de la app y volver.
 *   E. Pestaña oculta (otra pestaña al frente) y teléfono bloqueado (página congelada por CDP).
 *   F. Pantalla completa, giro del teléfono, volumen, cambio de voz y de ritmo a mitad.
 *   G. «Cambiar video» tres veces: oyentes de los audios y URLs de voz que se sueltan.
 *
 *   node tests/verificar_voz_doblaje_robusta.mjs
 *   node tests/verificar_voz_doblaje_robusta.mjs --headed
 */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, join, extname } from 'node:path';
import { pathToFileURL } from 'node:url';

const app = resolve(import.meta.dirname, '..');
const { chromium } = await (async () => {
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
const { agruparPorTiempo } = await import(pathToFileURL(join(app, 'js/youtube/dubbingService.js')).href);
const { normalizarSegmentos } = await import(pathToFileURL(join(app, 'js/youtube/transcriptionService.js')).href);

// Habla continua y densa (un segmento cada 3 s durante 4 min): hay frase casi todo el tiempo y el español
// ocupa casi toda su ventana, como en una charla real. El video de prueba de otras pruebas deja 10 s entre frases.
const FRASES_BASE = ['Today we are going to talk about how to build a brand', 'that people actually remember after they see it once', 'because attention is the scarcest thing we all have',
  'and the first step is knowing exactly who you serve', 'then you tell them one clear story over and over', 'until it becomes part of how they see the world'];
const SEGMENTOS = Array.from({ length: 80 }, (_, i) => ({ startTime: i * 3, endTime: i * 3 + 2.9, duration: 2.9, text: FRASES_BASE[i % FRASES_BASE.length] + '.' }));   // con punto: el motor no las funde en frases largas
const fixture = { video_id: 'dNWkwrqAkcM', segments: SEGMENTOS };
const UNIDADES = agruparPorTiempo(normalizarSegmentos(fixture.segments));
const URL_A = 'https://www.youtube.com/watch?v=dNWkwrqAkcM';
const URL_B = 'https://www.youtube.com/watch?v=b2c3d4e5f6g';
const headed = process.argv.includes('--headed');

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
const percentil = (valores, p = 0.95) => {
  const d = [...valores].sort((a, b) => a - b);
  return d.length ? d[Math.min(d.length - 1, Math.max(0, Math.ceil(p * d.length) - 1))] : 0;
};
const ms = (s) => Math.round(s * 1000);

/* Reproductor de YouTube simulado (mismo contrato que la IFrame API). */
const YT_FALSO = `(() => {
  window.__ytVivos = 0; window.__ytCreados = 0;
  class JugadorFalso {
    constructor(elemento, opciones) {
      this.opciones = opciones || {}; this.base = 0; this.inicio = 0; this.tasa = 1; this.estado = -1; this.vol = 100; this.mudo = false;
      const arranque = Number(this.opciones.playerVars && this.opciones.playerVars.start) || 0;
      if (arranque > 0) this.base = arranque;
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
    buffering() { if (this.estado !== 1) return; this.base = this._t(); this.estado = 3; this._evento('onStateChange', 3); }
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

/** WAV con una nota suave (no silencio puro: así la medición del tramo hablado también corre). */
function wavVoz(segundos) {
  const hz = 8000;
  const muestras = Math.max(1, Math.round(hz * segundos));
  const b = Buffer.alloc(44 + muestras);
  b.write('RIFF', 0); b.writeUInt32LE(36 + muestras, 4); b.write('WAVE', 8); b.write('fmt ', 12);
  b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(hz, 24);
  b.writeUInt32LE(hz, 28); b.writeUInt16LE(1, 32); b.writeUInt16LE(8, 34); b.write('data', 36); b.writeUInt32LE(muestras, 40);
  for (let i = 0; i < muestras; i += 1) b[44 + i] = 128 + Math.round(20 * Math.sin((2 * Math.PI * 220 * i) / hz));
  return b;
}

/** Instrumentación de la página: eventos de los <audio> de la voz, oyentes y URLs de voz vivas. */
const INSTRUMENTO = () => {
  const v = window.__voz = { eventos: [], permitirHasta: 0, listeners: new WeakMap(), vistos: new Set(), urlsCreadas: 0, urlsSoltadas: 0, errores: [] };
  const ahora = () => performance.now();
  const esVoz = (el) => el && el.src && !String(el.src).startsWith('data:');
  const registrar = (tipo, el) => {
    if (!esVoz(el)) return;
    const d = typeof window.jgDoblajeDiagnostico === 'function' ? window.jgDoblajeDiagnostico() : null;
    v.eventos.push({
      tipo, src: String(el.src).slice(-14), t: ahora(), yt: window.__yt ? window.__yt.getCurrentTime() : -1,
      ytEstado: window.__yt ? window.__yt.estado : -9, ct: el.currentTime, dur: el.duration, terminado: el.ended,
      permitido: ahora() < v.permitirHasta, inicio: d && d.frase ? d.frase.inicio : null, oculta: document.hidden,
    });
  };
  const play0 = HTMLMediaElement.prototype.play;
  HTMLMediaElement.prototype.play = function (...a) {
    if (!v.vistos.has(this)) {
      v.vistos.add(this);
      for (const tipo of ['playing', 'pause', 'ended']) EventTarget.prototype.addEventListener.call(this, tipo, () => registrar(tipo, this));
    }
    return play0.apply(this, a);
  };
  // Oyentes «loadedmetadata» sobre <audio> (el motor pone uno por audio y por motor).
  const add0 = EventTarget.prototype.addEventListener;
  const rem0 = EventTarget.prototype.removeEventListener;
  EventTarget.prototype.addEventListener = function (tipo, f, o) {
    if (tipo === 'loadedmetadata' && this instanceof HTMLAudioElement) {
      const lista = v.listeners.get(this) || [];
      if (!lista.includes(f)) lista.push(f);
      v.listeners.set(this, lista);
    }
    return add0.call(this, tipo, f, o);
  };
  EventTarget.prototype.removeEventListener = function (tipo, f, o) {
    if (tipo === 'loadedmetadata' && this instanceof HTMLAudioElement) {
      const lista = v.listeners.get(this);
      if (lista) { const i = lista.indexOf(f); if (i >= 0) lista.splice(i, 1); }
    }
    return rem0.call(this, tipo, f, o);
  };
  v.oyentesVivos = () => [...v.vistos].reduce((n, el) => n + (v.listeners.get(el) || []).length, 0);
  const crear0 = URL.createObjectURL.bind(URL);
  const soltar0 = URL.revokeObjectURL.bind(URL);
  URL.createObjectURL = (b) => { if (b && b.type && /audio/.test(b.type)) v.urlsCreadas += 1; return crear0(b); };
  URL.revokeObjectURL = (u) => { v.urlsSoltadas += 1; return soltar0(u); };
  window.__sonando = () => [...v.vistos].filter((m) => !m.paused && !m.ended && esVoz(m)).length;
  // Pestaña oculta: document.hidden = true y los temporizadores cortos (≤ 200 ms) laten una de cada 10 veces (1 Hz), como Chrome.
  window.__oculta = false;
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => window.__oculta });
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => (window.__oculta ? 'hidden' : 'visible') });
  const intervalo0 = window.setInterval.bind(window);
  const limpiar0 = window.clearInterval.bind(window);
  window.__intervalos = new Set();   // temporizadores periódicos vivos: al cerrar la sesión no debe quedar ninguno suyo
  window.setInterval = (fn, espera, ...resto) => {
    let id;
    if (typeof fn !== 'function' || !(espera <= 200)) id = intervalo0(fn, espera, ...resto);
    else { let n = 0; id = intervalo0(() => { n += 1; if (!window.__oculta || n % 10 === 0) fn(...resto); }, espera); }
    window.__intervalos.add(id);
    return id;
  };
  window.clearInterval = (id) => { window.__intervalos.delete(id); return limpiar0(id); };
  window.addEventListener('error', (e) => v.errores.push(String(e.message).slice(0, 200)));
};

async function abrir(navegador, vp) {
  const ctx = await navegador.newContext({ viewport: vp.viewport, hasTouch: vp.movil, isMobile: vp.movil });
  const pagina = await ctx.newPage();
  const reg = { translate: 0, tts: 0, errores: [], consola: [] };
  pagina.on('pageerror', (e) => reg.errores.push(String(e).slice(0, 200)));
  pagina.on('console', (m) => { if (m.type() === 'error') reg.consola.push(m.text().slice(0, 200)); });
  await pagina.addInitScript(INSTRUMENTO);
  const responder = (r, datos) => r.fulfill(datos).catch(() => {});
  await pagina.route('https://www.youtube.com/iframe_api', (r) => responder(r, { contentType: 'text/javascript', body: YT_FALSO }));
  await pagina.route(/\/(health|session-config|ping|glossary|tts-voices|tts-warmup)(\?|$)/, (r) => {
    const u = r.request().url();
    if (u.includes('/health')) {
      return responder(r, { json: { status: 'ok', server: 'vercel', model: 'whisper-large-v3', model_state: 'listo', model_ready: true, ai_configured: true, groq_configured: true, ia_configured: true, youtube_auto: true, x_video: true, tts_azure: true, tts_fish: false } });
    }
    if (u.includes('/session-config')) return responder(r, { json: { token: 'vercel-bypass', ai_provider: 'mistral', ai_configured: true, groq_configured: true, ia_configured: true, limits: {} } });
    return responder(r, { json: {} });
  });
  await pagina.route(/\/youtube(\?|$)/, async (r) => { await esperar(200); await responder(r, respuestaYoutube()); });
  await pagina.route(/\/translate(\?|$)/, async (r) => {
    reg.translate += 1;
    const cuerpo = JSON.parse(r.request().postData() || '{}');
    const piezas = [...String(cuerpo.text || '').matchAll(/\[\[JG_SEG_(\d{6})\]\]\n([^\[]*)/g)];
    await esperar(60);
    const text = piezas.length ? piezas.map((m) => `[[JG_SEG_${m[1]}]]\nES ${m[2].trim()}`).join('\n\n') : `ES ${cuerpo.text}`;
    await responder(r, { json: { text, ia_used: true, provider: 'mistral', validation: { status: 'ok', integrity_score: 100 } } });
  });
  await pagina.route(/\/tts(\?|$)/, async (r) => {
    reg.tts += 1;
    const req = r.request();
    const datos = req.method() === 'GET' ? Object.fromEntries(new URL(req.url()).searchParams) : JSON.parse(req.postData() || '{}');
    await esperar(60);
    // Lo que dura una voz real de este texto (~21 caracteres por segundo sin los marcadores de la prueba).
    await responder(r, { status: 200, contentType: 'audio/wav', headers: { 'X-TTS-Engine': 'azure-neural-regional', 'X-TTS-Voice': 'es-CO-SalomeNeural', 'X-TTS-Fallback': '0' }, body: wavVoz(Math.max(1, String(datos.text || '').replace(/ES /g, '').length / 21)) });
  });
  await pagina.goto(`${base}/?tab=yt`, { waitUntil: 'domcontentloaded' });
  await pagina.waitForSelector('#ytUrl', { state: 'attached' });
  await pagina.waitForFunction(() => Boolean(window.jgVideoLocal), null, { timeout: 30000, polling: 100 });
  return { contexto: ctx, pagina, reg };
}

const listo = (pagina) => pagina.evaluate(() => { const r = document.getElementById('ytDubReproducir'); return Boolean(r && !r.hidden && !r.disabled); });
const esperarListo = (pagina, t = 40000) => hastaQue(() => listo(pagina), t, 150);
async function pegarYDoblar(pagina, url = URL_A) {
  await pagina.fill('#ytUrl', url);
  await pagina.waitForFunction(() => !document.getElementById('ytSyncBtn').disabled, null, { timeout: 10000, polling: 100 });
  await pagina.click('#ytSyncBtn');
}
const yt = (pagina, codigo) => pagina.evaluate(`(${codigo})()`);   // una cadena «() => …» no se invoca sola
const tiempoYt = (pagina) => yt(pagina, '() => window.__yt.getCurrentTime()');
const marca = (pagina) => pagina.evaluate(() => window.__voz.eventos.length);
const eventosDesde = (pagina, desde) => pagina.evaluate((d) => window.__voz.eventos.slice(d), desde);
const permitir = (pagina, msAdelante = 1500) => pagina.evaluate((m) => { window.__voz.permitirHasta = performance.now() + m; }, msAdelante);
const ocultar = (pagina) => pagina.evaluate(() => { window.__oculta = true; document.dispatchEvent(new Event('visibilitychange')); });
const mostrar = (pagina) => pagina.evaluate(() => { window.__oculta = false; document.dispatchEvent(new Event('visibilitychange')); });
const diag = (pagina) => pagina.evaluate(() => window.jgDoblajeDiagnostico && window.jgDoblajeDiagnostico());

/** Resume una ventana de eventos: frases que empezaron, terminaron enteras y cortes ajenos a la persona. */
function resumir(eventos) {
  const inicios = new Map();
  const terminadas = new Set();
  const cortes = [];
  for (const e of eventos) {
    if (e.tipo === 'playing' && !inicios.has(e.src)) inicios.set(e.src, e);
    else if (e.tipo === 'ended') terminadas.add(e.src);
    else if (e.tipo === 'pause' && !e.terminado && e.ytEstado === 1 && !e.permitido && e.ct < e.dur - 0.05) cortes.push(e);
  }
  // «Libre» = la frase anterior ya había terminado cuando el video llegó a su segundo: ahí solo cuenta la entrada.
  // (Si la voz anterior se alarga, la siguiente espera su turno: es la regla «la voz manda», no un retraso de entrada.)
  const fines = eventos.filter((e) => e.tipo === 'ended').map((e) => e.yt);
  const lista = [...inicios.values()].filter((e) => e.inicio !== null);
  const libres = lista.filter((e) => !fines.some((f) => f > e.inicio - 0.05 && f < e.yt - 0.001 && f !== e.yt) || e.yt - e.inicio < 0.3);
  const latencias = lista.map((e) => e.yt - e.inicio);
  const latenciasLibres = libres.map((e) => e.yt - e.inicio);
  return { inicios: [...inicios.values()], terminadas, cortes, latencias, latenciasLibres, libres: libres.length };
}
/** Frases del original cuyo inicio cae en [desde, hasta) del video. */
const esperadas = (desde, hasta) => UNIDADES.filter((u) => u.startTime >= desde && u.startTime < hasta);

async function conVoz(pagina) {
  await pagina.click('#ytDubReproducir');
  return hastaQue(async () => (await yt(pagina, '() => window.__sonando()')) > 0, 15000, 100);
}

const VIEWPORTS = [
  { nombre: 'teléfono 390×844', viewport: { width: 390, height: 844 }, movil: true },
  { nombre: 'escritorio 1440×900', viewport: { width: 1440, height: 900 }, movil: false },
];

const navegador = await chromium.launch({ headless: !headed, args: ['--autoplay-policy=no-user-gesture-required'] });
try {
  for (const vp of VIEWPORTS) {
    console.log(`\n══════════ ${vp.nombre} ══════════`);
    const { contexto, pagina, reg } = await abrir(navegador, vp);
    await pegarYDoblar(pagina);
    comprobar(`${vp.nombre}: el doblaje queda listo`, await esperarListo(pagina));
    comprobar(`${vp.nombre}: ${UNIDADES.length} frases de voz en el video de prueba`, UNIDADES.length >= 10, String(UNIDADES.length));

    console.log('\n── A. Reproducción continua ─────────────────────────────────────');
    {
      const m0 = await marca(pagina);
      comprobar('la voz arranca con el toque', await conVoz(pagina));
      const t0 = await tiempoYt(pagina);
      await esperar(24000);
      const t1 = await tiempoYt(pagina);
      const r = resumir(await eventosDesde(pagina, m0));
      const esp = esperadas(Math.max(0, t0 - 0.5), t1 - 8).map((u) => u.startTime);
      const sonadas = r.inicios.filter((e) => r.terminadas.has(e.src)).map((e) => e.inicio);
      const faltan = esp.filter((s) => !sonadas.some((x) => Math.abs(x - s) < 0.01));
      comprobar(`continua: ${sonadas.length} frases sonadas completas = ${esp.length} esperadas (video ${t0.toFixed(1)}→${t1.toFixed(1)} s)`, esp.length >= 2 && faltan.length === 0, `faltan ${faltan.join(',')}`);
      comprobar(`continua: 0 cortes de voz (${r.cortes.length})`, r.cortes.length === 0, JSON.stringify(r.cortes.slice(0, 2)));
      const d = await diag(pagina);
      comprobar(`continua: el motor no saltó ninguna frase (${d?.frasesSaltadas})`, d?.frasesSaltadas === 0);
      console.log('   frases: ' + r.inicios.map((e) => `${e.inicio}→${ms(e.yt - e.inicio)}ms`).join('  '));
      const libres = r.latenciasLibres.slice(1);   // la 1.ª frase paga el arranque de los audios en frío
      comprobar(`continua: latencia de entrada p95 ${ms(percentil(libres.map(Math.abs)))} ms ≤ 150 ms con la voz libre (n=${libres.length}; de ${ms(Math.min(...libres))} a ${ms(Math.max(...libres))} ms)`,
        libres.length >= 2 && percentil(libres.map(Math.abs)) <= 0.15);
    }

    console.log('\n── B. Pausar y seguir (barra de YouTube) ────────────────────────');
    {
      const m0 = await marca(pagina);
      const t0 = await tiempoYt(pagina);
      for (let k = 0; k < 2; k += 1) {
        await esperar(2300);
        await yt(pagina, '() => window.__yt.pauseVideo()');
        await esperar(1500);
        const mudo = (await yt(pagina, '() => window.__sonando()')) === 0;
        comprobar(`pausa ${k + 1}: al pausar el video la voz también calla`, mudo);
        await yt(pagina, '() => window.__yt.playVideo()');
      }
      await esperar(9000);
      const t1 = await tiempoYt(pagina);
      const r = resumir(await eventosDesde(pagina, m0));
      const sonadas = new Set(r.inicios.filter((e) => r.terminadas.has(e.src)).map((e) => e.inicio));
      const esp = esperadas(t0 + 0.5, t1 - 5).map((u) => u.startTime);
      comprobar(`pausas: ${esp.length} frases esperadas, todas terminan enteras`, esp.length >= 1 && esp.every((s) => sonadas.has(s)));
      comprobar(`pausas: 0 cortes ajenos a la persona (${r.cortes.length})`, r.cortes.length === 0);
    }

    console.log('\n── C. Adelantar y retroceder con la barra ───────────────────────');
    {
      const destino = UNIDADES.find((u) => u.startTime > 100);
      const m0 = await marca(pagina);
      await permitir(pagina, 2500);
      await yt(pagina, `() => window.__yt.seekTo(${destino.startTime + 1.0})`);
      const suena = await hastaQue(async () => (await eventosDesde(pagina, m0)).some((e) => e.tipo === 'playing' && e.inicio === destino.startTime), 5000, 100);
      comprobar(`barra adelante (${(destino.startTime + 1).toFixed(1)} s): suena la frase de ese punto en menos de 5 s`, suena);
      await esperar(5000);
      const r1 = resumir(await eventosDesde(pagina, m0));
      comprobar('barra adelante: no se cuela ninguna frase del lugar anterior', r1.inicios.every((e) => e.inicio === null || e.inicio >= destino.startTime - 0.01), JSON.stringify(r1.inicios.map((e) => e.inicio)));
      const atras = UNIDADES.find((u) => u.startTime > 40);
      const m1 = await marca(pagina);
      await permitir(pagina, 2500);
      await yt(pagina, `() => window.__yt.seekTo(${atras.startTime + 0.2})`);
      const suena2 = await hastaQue(async () => (await eventosDesde(pagina, m1)).some((e) => e.tipo === 'playing' && e.inicio === atras.startTime), 6000, 100);
      comprobar(`barra atrás (${(atras.startTime + 0.2).toFixed(1)} s): vuelve a sonar esa frase desde su principio`, suena2);
      await esperar(3000);
      const r2 = resumir(await eventosDesde(pagina, m1));
      comprobar(`barra: 0 cortes ajenos a la búsqueda (${r1.cortes.length + r2.cortes.length})`, r1.cortes.length + r2.cortes.length === 0);
    }

    console.log('\n── D. Cambiar de pestaña de la app y volver ─────────────────────');
    {
      await esperar(1500);
      const antes = await tiempoYt(pagina);
      await pagina.click('#tabPdf');
      await esperar(700);
      comprobar('al salir: el video queda en pausa y la voz calla', (await yt(pagina, '() => window.__yt.estado')) === 2 && (await yt(pagina, '() => window.__sonando()')) === 0);
      await esperar(1500);
      comprobar('en otra pestaña el segundo no avanza', Math.abs((await tiempoYt(pagina)) - antes) < 1.2);
      await pagina.click('#tabYt');
      await esperar(300);
      const m0 = await marca(pagina);
      await pagina.click('#ytDubReproducir');
      comprobar('al volver y tocar «Ver con voz», la voz suena otra vez', await hastaQue(async () => (await yt(pagina, '() => window.__sonando()')) > 0, 8000, 100));
      await esperar(5000);
      const r = resumir(await eventosDesde(pagina, m0));
      comprobar(`pestaña: 0 cortes tras volver (${r.cortes.length}) y la voz sigue (${r.inicios.length} frases)`, r.cortes.length === 0 && r.inicios.length >= 1);
    }

    console.log('\n── E. Pestaña oculta y teléfono bloqueado ───────────────────────');
    {
      const m0 = await marca(pagina);
      const t0 = await tiempoYt(pagina);
      await ocultar(pagina);
      comprobar('oculta: la página reporta document.hidden y sus temporizadores laten a 1 Hz', (await pagina.evaluate(() => document.hidden)) === true);
      await esperar(9000);
      await mostrar(pagina);
      await esperar(300);
      comprobar('visible otra vez: sigue sonando o espera su turno (nada colgado)', (await yt(pagina, '() => window.__yt.estado')) === 1);
      await esperar(4000);
      const t1 = await tiempoYt(pagina);
      const r = resumir(await eventosDesde(pagina, m0));
      const veces = r.inicios.map((e) => e.t).sort((a, b) => a - b);
      let rafagas = 0;
      for (let i = 1; i < veces.length; i += 1) if (veces[i] - veces[i - 1] < 1000) rafagas += 1;
      comprobar(`oculta→visible: 0 cortes (${r.cortes.length}) y 0 frases en ráfaga (${rafagas}); ${r.inicios.length} frases en ${(t1 - t0).toFixed(1)} s de video`, r.cortes.length === 0 && rafagas === 0);
      const trasVolver = r.inicios.filter((e) => !e.oculta && e.inicio !== null).slice(-3).map((e) => e.yt - e.inicio);
      comprobar(`visible: las frases siguientes entran en su segundo (${trasVolver.map((x) => ms(x)).join(', ')} ms)`, trasVolver.length >= 1 && trasVolver.every((x) => Math.abs(x) <= 0.25));

      // Teléfono bloqueado: la página queda congelada (sin JS) unos segundos y se reactiva.
      const cdp = await contexto.newCDPSession(pagina);
      const m1 = await marca(pagina);
      await cdp.send('Page.enable');
      await cdp.send('Page.setWebLifecycleState', { state: 'frozen' });
      await esperar(5000);
      await cdp.send('Page.setWebLifecycleState', { state: 'active' });
      await esperar(500);
      const tras = await eventosDesde(pagina, m1);
      const arranques = tras.filter((e) => e.tipo === 'playing' && e.t > 0);
      const d = await diag(pagina);
      await esperar(8000);
      const r2 = resumir(await eventosDesde(pagina, m1));
      const t2 = r2.inicios.map((e) => e.t).sort((a, b) => a - b);
      let rafagas2 = 0;
      for (let i = 1; i < t2.length; i += 1) if (t2[i] - t2[i - 1] < 1000) rafagas2 += 1;
      comprobar(`bloqueo: tras reactivar no hay ráfaga de frases viejas (${rafagas2}) ni cortes (${r2.cortes.length}); arrancaron ${arranques.length} al volver`, rafagas2 === 0 && r2.cortes.length === 0);
      const lat = r2.inicios.slice(-3).filter((e) => e.inicio !== null).map((e) => e.yt - e.inicio);
      comprobar(`bloqueo: las últimas frases vuelven a su segundo (${lat.map((x) => ms(x)).join(', ')} ms)`, lat.length >= 1 && lat.every((x) => Math.abs(x) <= 0.25), JSON.stringify(d));
      await cdp.detach().catch(() => {});
    }

    console.log('\n── F. Pantalla completa, giro, volumen, voz y ritmo a mitad ─────');
    {
      const m0 = await marca(pagina);
      await pagina.click('#ytPantallaCompleta');
      await esperar(1500);
      await yt(pagina, '() => window.__yt.buffering()');   // YouTube repinta
      await esperar(300);
      await yt(pagina, '() => window.__yt.playVideo()');
      await esperar(1000);
      await pagina.click('#ytSalirPantalla').catch(() => pagina.click('#ytPantallaCompleta'));
      await esperar(800);
      await pagina.setViewportSize({ width: vp.viewport.height, height: vp.viewport.width });   // giro del teléfono
      await yt(pagina, '() => window.__yt.buffering()');
      await esperar(300);
      await yt(pagina, '() => window.__yt.playVideo()');
      await esperar(1500);
      await pagina.setViewportSize(vp.viewport);
      await esperar(1200);
      await pagina.evaluate(() => { const v = document.getElementById('ytVolVoz'); v.value = '60'; v.dispatchEvent(new Event('input', { bubbles: true })); const o = document.getElementById('ytVolOriginal'); o.value = '20'; o.dispatchEvent(new Event('input', { bubbles: true })); });
      await esperar(800);
      await pagina.evaluate(() => { const v = document.getElementById('ytVolVoz'); v.value = '100'; v.dispatchEvent(new Event('input', { bubbles: true })); });
      await pagina.evaluate(() => { const r = document.getElementById('ytRitmoAuto'); if (r) { r.click(); } });
      await esperar(600);
      await pagina.evaluate(() => { const r = document.getElementById('ytRitmoAuto'); if (r) { r.click(); } });
      await esperar(4000);
      const r = resumir(await eventosDesde(pagina, m0));
      comprobar(`pantalla completa + giro + buffering + volumen + ritmo: 0 cortes (${r.cortes.length}), la voz sigue (${r.inicios.length} frases)`, r.cortes.length === 0 && r.inicios.length >= 1);
      const volumenes = await yt(pagina, '() => [...window.__voz.vistos].map((m) => m.volume)');
      comprobar(`el volumen de ambos audios es el elegido (${volumenes.join(', ')})`, volumenes.length >= 1 && volumenes.every((x) => Math.abs(x - 1) < 0.01));

      // Cambio de voz a mitad: la frase que suena sigue, la siguiente usa la voz nueva.
      const ttsAntes = reg.tts;
      const m1 = await marca(pagina);
      const opciones = await pagina.evaluate(() => [...document.getElementById('ytVozSelect').options].map((o) => o.value));
      const otra = opciones.find((o) => o !== 'auto' && o.startsWith('neural:')) || opciones[1];
      await pagina.selectOption('#ytVozSelect', otra);
      await esperar(9000);
      const r2 = resumir(await eventosDesde(pagina, m1));
      comprobar(`cambio de voz: 0 cortes de la frase en curso (${r2.cortes.length}) y la voz sigue (${r2.inicios.length} frases)`, r2.cortes.length === 0 && r2.inicios.length >= 1);
      comprobar(`cambio de voz: se pidió voz nueva (${reg.tts - ttsAntes} síntesis)`, reg.tts > ttsAntes);
      const lat = r2.inicios.filter((e) => e.inicio !== null).map((e) => e.yt - e.inicio);
      comprobar(`cambio de voz: la voz nueva no llega tarde (máx ${lat.length ? ms(Math.max(...lat)) : '—'} ms)`, lat.length >= 1 && Math.max(...lat) <= 1.2);
    }

    console.log('\n── G. «Cambiar video» tres veces: sin fugas ─────────────────────');
    {
      const base0 = await pagina.evaluate(() => ({ oyentes: window.__voz.oyentesVivos(), creadas: window.__voz.urlsCreadas, soltadas: window.__voz.urlsSoltadas }));
      comprobar(`sesión viva: ${base0.oyentes} oyentes «loadedmetadata» (uno por audio)`, base0.oyentes === 2, JSON.stringify(base0));
      for (let k = 0; k < 3; k += 1) {
        await pagina.click('#ytCambiarVideo');
        await esperar(400);
        comprobar(`cambiar ${k + 1}: nada suena y el reproductor se destruyó`, (await yt(pagina, '() => window.__sonando()')) === 0 && (await yt(pagina, '() => window.__ytVivos')) === 0);
        await pegarYDoblar(pagina, k % 2 ? URL_A : URL_B);
        await esperarListo(pagina);
        await conVoz(pagina);
        await esperar(1500);
      }
      await esperar(1000);
      const fin = await pagina.evaluate(() => ({ oyentes: window.__voz.oyentesVivos(), creadas: window.__voz.urlsCreadas, soltadas: window.__voz.urlsSoltadas }));
      comprobar(`tras 3 videos nuevos: ${fin.oyentes} oyentes (sigue siendo 1 motor × 2 audios, sin acumular)`, fin.oyentes === 2, JSON.stringify(fin));
      const abiertos = await pagina.evaluate(() => window.__intervalos.size);
      await pagina.click('#ytCambiarVideo');
      await esperar(800);
      const tras = await pagina.evaluate(() => window.__intervalos.size);
      comprobar(`al cerrar: los temporizadores periódicos de la sesión se detienen (${abiertos} → ${tras}; quedan solo los de la app)`, tras < abiertos && tras <= 4, `${abiertos} → ${tras}`);
      const cierre = await pagina.evaluate(() => ({ oyentes: window.__voz.oyentesVivos(), creadas: window.__voz.urlsCreadas, soltadas: window.__voz.urlsSoltadas, sonando: window.__sonando() }));
      comprobar(`al cerrar: 0 oyentes de voz, 0 sonando (${JSON.stringify(cierre)})`, cierre.oyentes === 0 && cierre.sonando === 0);
      comprobar(`al cerrar: las URLs de voz se sueltan (${cierre.creadas} creadas, ${cierre.soltadas} soltadas)`, cierre.soltadas >= cierre.creadas);
    }

    comprobar(`${vp.nombre}: sin errores de JavaScript`, reg.errores.length === 0, reg.errores.join(' | '));
    comprobar(`${vp.nombre}: sin errores en consola`, reg.consola.filter((t) => !/Failed to load resource|favicon|net::ERR/.test(t)).length === 0, reg.consola.join(' | ').slice(0, 300));
    await contexto.close();
  }
  console.log('\n── H. Panel del video en cuatro pantallas: toques, desborde y consola ──');
  for (const vp of [
    { nombre: '390×844', viewport: { width: 390, height: 844 }, movil: true },
    { nombre: '844×390', viewport: { width: 844, height: 390 }, movil: true },
    { nombre: '768×1024', viewport: { width: 768, height: 1024 }, movil: true },
    { nombre: '1440×900', viewport: { width: 1440, height: 900 }, movil: false },
  ]) {
    const { contexto, pagina, reg } = await abrir(navegador, vp);
    await pegarYDoblar(pagina);
    await esperarListo(pagina);
    await conVoz(pagina);
    await esperar(1500);
    const medida = await pagina.evaluate(() => {
      const area = document.getElementById('ytSyncArea');
      const visible = (e) => { const r = e.getBoundingClientRect(); const c = getComputedStyle(e); return r.width > 0 && r.height > 0 && c.visibility !== 'hidden' && !e.closest('[hidden]'); };
      const chicos = [...area.querySelectorAll('button, select, input[type=range], input[type=checkbox], a[href]')].filter(visible).map((e) => {
        const r = e.getBoundingClientRect();
        const caja = e.closest('label') ? e.closest('label').getBoundingClientRect() : r;
        return { id: e.id || e.textContent.trim().slice(0, 24), w: Math.round(Math.max(r.width, caja.width)), h: Math.round(Math.max(r.height, caja.height)) };
      }).filter((x) => x.h < 44 || x.w < 44);
      return { desborde: document.documentElement.scrollWidth - document.documentElement.clientWidth, chicos };
    });
    comprobar(`${vp.nombre}: sin desplazamiento horizontal (${medida.desborde} px)`, medida.desborde <= 1);
    comprobar(`${vp.nombre}: ningún control del panel mide menos de 44 px${medida.chicos.length ? ' · ' + JSON.stringify(medida.chicos) : ''}`, !vp.movil || medida.chicos.length === 0);
    comprobar(`${vp.nombre}: sin errores de JavaScript ni de consola`, reg.errores.length === 0 && reg.consola.filter((t) => !/Failed to load resource|favicon|net::ERR/.test(t)).length === 0, reg.errores.concat(reg.consola).join(' | ').slice(0, 300));
    await contexto.close();
  }
} finally {
  await navegador.close();
  servidor.close();
}

console.log(`\n${ok} comprobaciones OK · ${fallos.length} fallos`);
if (fallos.length) console.log('Fallaron:\n - ' + fallos.join('\n - '));
process.exit(fallos.length ? 1 : 0);
