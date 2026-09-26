/* JG Turbo · Doblaje de YouTube de punta a punta, SIN red ni créditos.
 *
 * /health, /youtube, /youtube-job, /translate, /tts y el reproductor de YouTube
 * se responden desde aquí. El video «largo» es el fixture real de 90 s repetido
 * (hasta ≈90 min, como el que falló el 2026-09-25). Mide lo que vive la persona:
 * que el progreso se vea, que la voz arranque sin traducir el video entero, que
 * cancelar pare de verdad.
 *
 *   node tests/verificar_youtube_doblaje.mjs
 *   node tests/verificar_youtube_doblaje.mjs --headed
 */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
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
const URL_VIDEO = 'https://www.youtube.com/watch?v=dNWkwrqAkcM';

function segmentosRepetidos(veces) {
  const salida = [];
  for (let v = 0; v < veces; v += 1) {
    for (const s of fixture.segments) salida.push({ ...s, startTime: s.startTime + v * 90, endTime: s.endTime + v * 90 });
  }
  return salida;
}

/** Respuesta de /youtube con los campos nuevos (los viejos siguen presentes). */
function respuestaYoutube({ segmentos = fixture.segments, idioma = 'en', fuente = 'titulo', confianza = 0.8, disponibles = ['en'], conflicto = false } = {}) {
  return {
    status: 200,
    json: {
      text: segmentos.map((s) => s.text).join(' '), language: idioma, title: fixture.video_id, source: 'subtitles', segments: segmentos,
      audio_language: idioma, audio_language_confidence: confianza, audio_language_conflict: conflicto,
      audio_language_evidence: [{ fuente: 'proveedor', idioma, confianza: 0.62, detalle: 'prueba' }],
      audio_language_thresholds: { aceptar: 0.85, preguntar: 0.6 },
      language_source: fuente, language_resolution_confidence: confianza, requested_lang: idioma,
      available_langs: disponibles, duration_s: 5314,
    },
  };
}

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
const base = `http://127.0.0.1:${servidor.address().port}`;

let ok = 0;
const fallos = [];
function comprobar(nombre, condicion, detalle = '') {
  if (condicion) { ok += 1; console.log(`OK: ${nombre}`); }
  else { fallos.push(nombre); console.log(`FALLO: ${nombre}${detalle ? ` — ${detalle}` : ''}`); }
}
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

/* Reproductor de YouTube simulado: el mismo contrato de la IFrame API que usa la app. */
const YT_FALSO = `(() => {
  class JugadorFalso {
    constructor(elemento, opciones) {
      this.opciones = opciones || {}; this.base = 0; this.inicio = 0; this.tasa = 1; this.estado = -1; this.vol = 100; this.mudo = false;
      const viejo = typeof elemento === 'string' ? document.getElementById(elemento) : elemento;
      const marco = document.createElement('div');
      marco.id = typeof elemento === 'string' ? elemento : ((viejo && viejo.id) || 'ytPlayer');
      marco.dataset.ytFalso = '1';
      marco.style.cssText = 'position:absolute;inset:0;background:#111';
      if (viejo) viejo.replaceWith(marco);
      window.__yt = this;
      setTimeout(() => this._evento('onReady'), 30);
    }
    _t() { return this.estado === 1 ? this.base + ((performance.now() - this.inicio) / 1000) * this.tasa : this.base; }
    _evento(nombre, data) { const f = this.opciones.events && this.opciones.events[nombre]; if (f) f({ data, target: this }); }
    getCurrentTime() { return Math.min(this._t(), this.getDuration()); }
    getDuration() { return window.__ytDuracion || 5314; }
    getVideoData() { return { title: window.__ytTitulo || 'The Marketing GENIUS: How To Build A Brand That Sells In The New Era Of AI', video_id: this.opciones.videoId }; }
    getPlaybackRate() { return this.tasa; }
    getAvailablePlaybackRates() { return [0.5, 0.75, 1, 1.25, 1.5, 2]; }
    setPlaybackRate(r) { this.base = this._t(); this.inicio = performance.now(); this.tasa = Number(r) || 1; this._evento('onPlaybackRateChange', this.tasa); }
    playVideo() { if (this.estado === 1) return; this.base = this._t(); this.inicio = performance.now(); this.estado = 1; this._evento('onStateChange', 1); }
    pauseVideo() { this.base = this._t(); this.estado = 2; this._evento('onStateChange', 2); }
    seekTo(s) { this.base = Math.max(0, Number(s) || 0); this.inicio = performance.now(); }
    getPlayerState() { return this.estado; }
    getVolume() { return this.vol; } setVolume(v) { this.vol = Number(v); }
    mute() { this.mudo = true; } unMute() { this.mudo = false; } isMuted() { return this.mudo; }
    getOptions() { return []; } getOption() { return []; } setOption() {}
    unloadModule(m) { window.__ytModulosDescargados = (window.__ytModulosDescargados || []).concat(m); }
    destroy() { this.estado = -5; }
  }
  window.YT = { Player: JugadorFalso, PlayerState: { UNSTARTED: -1, ENDED: 0, PLAYING: 1, PAUSED: 2, BUFFERING: 3, CUED: 5 } };
  setTimeout(() => typeof window.onYouTubeIframeAPIReady === 'function' && window.onYouTubeIframeAPIReady(), 0);
})();`;

/** WAV de silencio con la duración pedida (el motor usa audio.duration). */
function wavSilencio(segundos) {
  const muestras = Math.max(1, Math.round(8000 * segundos));
  const b = Buffer.alloc(44 + muestras);
  b.write('RIFF', 0); b.writeUInt32LE(36 + muestras, 4); b.write('WAVE', 8); b.write('fmt ', 12);
  b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(8000, 24);
  b.writeUInt32LE(8000, 28); b.writeUInt16LE(1, 32); b.writeUInt16LE(8, 34); b.write('data', 36); b.writeUInt32LE(muestras, 40);
  b.fill(128, 44);   // 8 bits sin signo: 128 es silencio
  return b;
}

/**
 * Página con todo simulado. `escenario`:
 *  youtube(cuerpo) → { status, json } de /youtube · demoraYoutubeMs · demoraTraduccionMs · demoraVozMs
 *  sinRaf: requestAnimationFrame no dispara nunca (ventana sin pintar)
 *  dispositivo: nombre de `devices` de Playwright (por defecto 'Pixel 7') · viewport: {width, height}
 *  vozRespaldo: /tts responde X-TTS-Fallback: 1 cuando se pidió Fish
 */
async function abrir(navegador, escenario = {}) {
  const contexto = escenario.viewport
    ? await navegador.newContext({ viewport: escenario.viewport, hasTouch: escenario.viewport.width < 1024, isMobile: escenario.viewport.width < 768 })
    : await navegador.newContext({ ...devices[escenario.dispositivo || 'Pixel 7'] });
  const pagina = await contexto.newPage();
  const reg = { youtube: [], translate: [], tts: [], errores: [] };
  pagina.on('pageerror', (e) => reg.errores.push(String(e).slice(0, 200)));
  await pagina.addInitScript(({ sinRaf }) => {
    window.__plays = 0;
    const play = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function (...a) { window.__plays += 1; return play.apply(this, a); };
    if (sinRaf) { window.requestAnimationFrame = () => 0; window.cancelAnimationFrame = () => {}; }
  }, { sinRaf: Boolean(escenario.sinRaf) });
  const responder = (r, datos) => r.fulfill(datos).catch(() => { /* la página ya abortó: correcto al cancelar */ });
  await pagina.route('https://www.youtube.com/iframe_api', (r) => responder(r, { contentType: 'text/javascript', body: YT_FALSO }));
  await pagina.route(/\/(health|session-config|ping|glossary|tts-voices|tts-warmup)(\?|$)/, (r) => {
    const u = r.request().url();
    if (u.includes('/health')) return responder(r, { json: { status: 'ok', server: 'vercel', model: 'whisper-large-v3', model_state: 'listo', model_ready: true, ai_configured: true, groq_configured: true, ia_configured: true, youtube_auto: true, tts_azure: true, tts_fish: false } });
    if (u.includes('/session-config')) return responder(r, { json: { token: 'vercel-bypass', ai_provider: 'mistral', ai_configured: true, groq_configured: true, ia_configured: true, limits: {} } });
    return responder(r, { json: {} });
  });
  await pagina.route(/\/youtube(\?|$)/, async (r) => {
    const cuerpo = JSON.parse(r.request().postData() || '{}');
    reg.youtube.push({ t: Date.now(), cuerpo });
    await esperar(escenario.demoraYoutubeMs ?? 1200);
    const { status, json } = (escenario.youtube || (() => respuestaYoutube()))(cuerpo);
    await responder(r, { status, json });
  });
  await pagina.route(/\/translate(\?|$)/, async (r) => {
    const cuerpo = JSON.parse(r.request().postData() || '{}');
    const piezas = [...String(cuerpo.text || '').matchAll(/\[\[JG_SEG_(\d{6})\]\]\n([^\[]*)/g)];
    reg.translate.push({ t: Date.now(), indices: piezas.map((m) => Number(m[1])), cuerpo });
    await esperar(escenario.demoraTraduccionMs ?? 250);
    const text = piezas.length
      ? piezas.map((m) => `[[JG_SEG_${m[1]}]]\nES ${m[2].trim()}`).join('\n\n')
      : `ES ${cuerpo.text}`;
    await responder(r, { json: { text, ia_used: true, provider: 'mistral', validation: { status: 'ok', integrity_score: 100 } } });
  });
  await pagina.route(/\/tts(\?|$)/, async (r) => {
    const req = r.request();
    const datos = req.method() === 'GET' ? Object.fromEntries(new URL(req.url()).searchParams) : JSON.parse(req.postData() || '{}');
    reg.tts.push({ t: Date.now(), texto: datos.text || '', voz: String(datos.voice || ''), fish: String(datos.prefer_fish) === 'true', fishVoz: datos.fish_voice || '' });
    await esperar(escenario.demoraVozMs ?? 150);
    const respaldo = escenario.vozRespaldo && String(datos.prefer_fish) === 'true';
    await responder(r, {
      status: 200, contentType: 'audio/wav',
      headers: { 'X-TTS-Engine': respaldo ? 'azure-neural-regional' : 'azure-neural-regional', 'X-TTS-Voice': 'es-CO-SalomeNeural', 'X-TTS-Fallback': respaldo ? '1' : '0' },
      body: wavSilencio(Math.max(0.6, String(datos.text || '').length / 16)),
    });
  });
  await pagina.goto(`${base}/?tab=yt`, { waitUntil: 'domcontentloaded' });
  await pagina.waitForSelector('#ytUrl', { state: 'attached' });
  return { contexto, pagina, reg };
}

async function pegarEnlace(pagina, url = URL_VIDEO) {
  await pagina.fill('#ytUrl', url);
  await pagina.waitForFunction(() => !document.getElementById('ytSyncBtn').disabled, null, { timeout: 10000 }).catch(() => {});
}
/** ¿Está el doblaje listo para sonar? (vale antes y después de T1.7) */
const listo = (pagina) => pagina.evaluate(() => {
  const r = document.getElementById('ytDubReproducir');
  if (r && !r.hidden && !r.disabled) return true;
  const b = document.getElementById('ytDubbingBtn');
  return Boolean(b && !b.disabled);
});
async function esperarListo(pagina, ms = 30000) {
  const fin = Date.now() + ms;
  while (Date.now() < fin) { if (await listo(pagina)) return true; await esperar(150); }
  return false;
}
/** Pulsa lo que la interfaz ofrezca para ver el video con voz en español. */
async function reproducirConVoz(pagina) {
  if (await pagina.locator('#ytDubReproducir:visible').count()) { await pagina.click('#ytDubReproducir'); return; }
  if ((await pagina.getAttribute('#ytDubbingBtn', 'aria-pressed')) !== 'true') await pagina.click('#ytDubbingBtn');
  await pagina.evaluate(() => window.__yt && window.__yt.playVideo());
}

const navegador = await chromium.launch({ headless: !process.argv.includes('--headed') });
try {
  console.log('\n── Línea base (T0.2): lo que hoy ya funciona ───────────────────');
  {
    const { contexto, pagina, reg } = await abrir(navegador, { youtube: () => respuestaYoutube({ confianza: 0.9, fuente: 'usuario' }) });
    await pegarEnlace(pagina);
    comprobar('con enlace válido y servidor en línea, el botón de doblaje se habilita', !(await pagina.isDisabled('#ytSyncBtn')));
    await pagina.click('#ytSyncBtn');
    await esperarListo(pagina);
    comprobar('un clic manda exactamente una petición a /youtube', reg.youtube.length === 1, `${reg.youtube.length}`);
    comprobar('la petición pide marcas de tiempo', reg.youtube[0]?.cuerpo?.include_timestamps === true);
    comprobar('el doblaje de un video corto queda listo para escuchar', await listo(pagina));
    comprobar('sin errores de JavaScript', reg.errores.length === 0, reg.errores.join(' | '));
    await contexto.close();
  }

  // ── Escenarios de las tareas ────────────────────────────────────────────

} finally {
  await navegador.close();
  servidor.close();
}
console.log(`\n${ok} comprobaciones OK · ${fallos.length} fallos`);
process.exit(fallos.length ? 1 : 0);
