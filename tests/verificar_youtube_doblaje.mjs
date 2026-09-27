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

  console.log('\n── T1.4: la voz suena aunque la página no se pinte (sin rAF) ─');
  {
    const { contexto, pagina } = await abrir(navegador, { sinRaf: true, youtube: () => respuestaYoutube({ confianza: 0.9, fuente: 'usuario' }) });
    await pegarEnlace(pagina);
    await pagina.click('#ytSyncBtn');
    await esperarListo(pagina);
    const antes = await pagina.evaluate(() => window.__plays);
    await reproducirConVoz(pagina);
    await esperar(3500);
    const despues = await pagina.evaluate(() => window.__plays);
    comprobar('sin requestAnimationFrame, la voz en español arranca igual', despues > antes, `play() ${antes} → ${despues}`);
    const t = await pagina.evaluate(() => window.__yt.getCurrentTime());
    comprobar('y el video avanza mientras suena', t > 2, `${t.toFixed(1)} s`);
    await contexto.close();
  }

  console.log('\n── T1.8: sin subtítulos de YouTube encima ───────────────────────');
  {
    const { contexto, pagina } = await abrir(navegador, { youtube: () => respuestaYoutube({ fuente: 'usuario', confianza: 1 }) });
    await pegarEnlace(pagina); await pagina.click('#ytSyncBtn'); await esperarListo(pagina);
    await reproducirConVoz(pagina); await esperar(800);
    const modulos = await pagina.evaluate(() => window.__ytModulosDescargados || []);
    comprobar('al reproducir se quitan los subtítulos propios de YouTube', modulos.includes('captions'), JSON.stringify(modulos));
    const vars = await pagina.evaluate(() => window.__yt.opciones.playerVars || {});
    comprobar('el reproductor va en español, sin anotaciones ni subtítulos forzados', vars.hl === 'es' && vars.iv_load_policy === 3 && vars.cc_load_policy === 0);
    await contexto.close();
  }

  console.log('\n── T1.5: un solo clic cuenta; cerrar detiene todo ──────────────');
  {
    const { contexto, pagina, reg } = await abrir(navegador, {
      demoraTraduccionMs: 600,
      youtube: () => respuestaYoutube({ segmentos: segmentosRepetidos(6), confianza: 0.9, fuente: 'usuario' }),
    });
    await pegarEnlace(pagina);
    await pagina.click('#ytSyncBtn');
    await pagina.evaluate(() => {
      window.dispatchEvent(new CustomEvent('jg:server-status'));
      document.getElementById('ytUrl').dispatchEvent(new Event('input'));
    });
    comprobar('mientras trabaja, el botón sigue bloqueado aunque el servidor avise', await pagina.isDisabled('#ytSyncBtn'));
    await pagina.evaluate(() => document.getElementById('ytSyncBtn').click());
    await esperar(1500);
    comprobar('un doble clic no lanza una segunda petición', reg.youtube.length === 1, `${reg.youtube.length}`);
    const t0 = Date.now();
    while (!reg.translate.length && Date.now() - t0 < 15000) await esperar(100);
    await pagina.click('#btnYtSyncClose');
    const traduccionesAlCerrar = reg.translate.length;
    const vozAlCerrar = reg.tts.length;
    await esperar(3000);
    // +1: una petición que ya estaba saliendo justo al pulsar puede registrarse después.
    comprobar('después de cerrar no sale ni una traducción más', reg.translate.length <= traduccionesAlCerrar + 1, `${traduccionesAlCerrar} → ${reg.translate.length}`);
    comprobar('ni una síntesis de voz más', reg.tts.length === vozAlCerrar, `${vozAlCerrar} → ${reg.tts.length}`);
    comprobar('«Cerrar» devuelve el formulario con el enlace a la vista', await pagina.isVisible('#ytUrl'));
    comprobar('y no deja una transcripción vacía en pantalla', !(await pagina.isVisible('#ytResultArea')));
    await contexto.close();
  }

  console.log('\n── T1.6: idioma decidido sin rechazos ciegos ───────────────────');
  {
    const a = await abrir(navegador, { youtube: () => respuestaYoutube({ fuente: 'titulo', confianza: 0.8 }) });
    await pegarEnlace(a.pagina); await a.pagina.click('#ytSyncBtn'); await esperarListo(a.pagina);
    comprobar('con el idioma claro no se pregunta nada', !(await a.pagina.isVisible('#ytLangConfirm')));
    comprobar('y el doblaje queda listo', await listo(a.pagina));
    await a.contexto.close();

    const b = await abrir(navegador, { youtube: () => respuestaYoutube({ fuente: 'disponibles', confianza: 0.55, disponibles: ['ar', 'en', 'de-DE'] }) });
    await pegarEnlace(b.pagina); await b.pagina.click('#ytSyncBtn');
    await b.pagina.waitForSelector('#ytLangConfirm:not([hidden])', { timeout: 15000 }).catch(() => {});
    comprobar('con duda aparece el selector de idioma', await b.pagina.isVisible('#ytLangConfirm'));
    comprobar('con inglés preseleccionado', (await b.pagina.inputValue('#ytIdiomaElegido')) === 'en');
    await b.pagina.click('#ytLangConfirmYes'); await esperarListo(b.pagina);
    comprobar('confirmar el mismo idioma no vuelve a pedir el texto', b.reg.youtube.length === 1, `${b.reg.youtube.length}`);
    await b.contexto.close();

    const c = await abrir(navegador, { youtube: (cuerpo) => (cuerpo.language === 'pt'
      ? respuestaYoutube({ idioma: 'pt', fuente: 'usuario', confianza: 1 })
      : respuestaYoutube({ fuente: 'disponibles', confianza: 0.55 })) });
    await pegarEnlace(c.pagina); await c.pagina.click('#ytSyncBtn');
    await c.pagina.waitForSelector('#ytLangConfirm:not([hidden])', { timeout: 15000 }).catch(() => {});
    await c.pagina.selectOption('#ytIdiomaElegido', 'pt'); await c.pagina.click('#ytLangConfirmYes'); await esperarListo(c.pagina);
    comprobar('elegir portugués pide el texto en portugués', c.reg.youtube[1]?.cuerpo?.language === 'pt');
    comprobar('y traduce desde portugués', c.reg.translate.some((t) => t.cuerpo.direction === 'pt-es'));
    await c.contexto.close();

    const d = await abrir(navegador, { youtube: () => respuestaYoutube({ idioma: 'es', fuente: 'usuario', confianza: 1 }) });
    await pegarEnlace(d.pagina); await d.pagina.click('#ytSyncBtn'); await esperar(4000);
    comprobar('un video en español avisa que no necesita doblaje', /ya está en español/i.test(await d.pagina.textContent('#ytSyncArea')));
    comprobar('y no gasta traducciones', d.reg.translate.length === 0);
    await d.contexto.close();

    const e = await abrir(navegador, { youtube: () => respuestaYoutube({ fuente: 'usuario', confianza: 1 }) });
    await e.pagina.selectOption('#ytLang', 'en'); await pegarEnlace(e.pagina); await e.pagina.click('#ytSyncBtn'); await esperar(2500);
    comprobar('el idioma elegido en el formulario viaja en la petición', e.reg.youtube[0]?.cuerpo?.language === 'en');
    await e.contexto.close();
  }

  console.log('\n── T1.7: el progreso se ve desde el primer instante ────────────');
  {
    const { contexto, pagina, reg } = await abrir(navegador, { demoraYoutubeMs: 4000, youtube: () => respuestaYoutube({ fuente: 'usuario', confianza: 1 }) });
    await pegarEnlace(pagina);
    await pagina.click('#ytSyncBtn');
    await esperar(300);
    const caja = await pagina.locator('#ytDubProgreso').boundingBox();
    const alto = pagina.viewportSize()?.height || 800;
    comprobar('a los 300 ms ya se ve el progreso', await pagina.isVisible('#ytDubProgreso'));
    comprobar('y cae dentro de la pantalla del teléfono', Boolean(caja) && caja.y >= 0 && caja.y + 40 <= alto, JSON.stringify(caja));
    comprobar('el paso «Leer el video» está activo', (await pagina.getAttribute('#ytDubPasos [data-paso="leer"]', 'data-estado')) === 'activo');
    const t1 = await pagina.textContent('#ytDubTiempo');
    await esperar(2200);
    const t2 = await pagina.textContent('#ytDubTiempo');
    comprobar('el contador de tiempo avanza (se nota vivo)', t1 !== t2, `${t1} → ${t2}`);
    comprobar('el reproductor ya está creado mientras se lee el video', (await pagina.locator('#ytPlayer[data-yt-falso="1"]').count()) === 1);
    await esperarListo(pagina);
    comprobar('la petición lleva el título que dio el reproductor', /Marketing GENIUS/.test(reg.youtube[0]?.cuerpo?.title_hint || ''));
    comprobar('y la duración', reg.youtube[0]?.cuerpo?.duration_hint_s === 5314);
    comprobar('el panel muestra el título real, no el id', /Marketing GENIUS/.test(await pagina.textContent('#ytSyncTitle')));
    comprobar('al terminar, el progreso se retira', !(await pagina.isVisible('#ytDubProgreso')));
    await contexto.close();
  }
  {
    const { contexto, pagina, reg } = await abrir(navegador, { demoraYoutubeMs: 5000 });
    await pegarEnlace(pagina); await pagina.click('#ytSyncBtn'); await esperar(800);
    await pagina.click('#ytDubCancelar');
    await esperar(5500);
    comprobar('«Cancelar» vuelve al formulario', await pagina.isVisible('#ytUrl'));
    comprobar('y no sigue con traducción ni voz', reg.translate.length === 0 && reg.tts.length === 0, `${reg.translate.length}/${reg.tts.length}`);
    await contexto.close();
  }

  console.log('\n── T2.5: video largo — suena sin traducirlo entero ─────────────');
  {
    const largo = segmentosRepetidos(30);   // ≈45 min, 1320 segmentos
    const { contexto, pagina, reg } = await abrir(navegador, { youtube: () => respuestaYoutube({ segmentos: largo, fuente: 'usuario', confianza: 1 }) });
    await pegarEnlace(pagina);
    const inicio = Date.now();
    await pagina.click('#ytSyncBtn');
    await esperarListo(pagina);
    const segundos = (Date.now() - inicio) / 1000;
    comprobar('listo para escuchar en menos de 10 s (API simulada)', segundos < 10, `${segundos.toFixed(1)} s`);
    comprobar('para arrancar bastan unas pocas traducciones, no el video entero', reg.translate.length <= 10, `${reg.translate.length} (el video entero serían ~190 lotes)`);
    comprobar('al arrancar no se precarga la voz de todo el video', reg.tts.length <= 18, `${reg.tts.length}`);
    await esperar(8000);   // en pausa: la preparación se detiene en el horizonte
    const maximo = Math.max(...reg.translate.flatMap((t) => t.indices));
    comprobar('en pausa, la traducción se detiene en el horizonte de 3 minutos', largo[maximo].startTime <= 230, `${largo[maximo].startTime.toFixed(0)} s`);
    comprobar('y la voz también (≤ 18 síntesis)', reg.tts.length <= 18, `${reg.tts.length}`);
    const playsAntes = await pagina.evaluate(() => window.__plays);
    const lotesAntes = reg.translate.length;
    await pagina.evaluate(() => { window.__yt.seekTo(1800); window.__yt.playVideo(); });
    const t0 = Date.now();
    while (reg.translate.length === lotesAntes && Date.now() - t0 < 6000) await esperar(100);
    const primero = reg.translate[lotesAntes]?.indices?.[0];
    comprobar('tras saltar al minuto 30, lo primero que se traduce es ese tramo', primero !== undefined && largo[primero].startTime >= 1790,
      primero === undefined ? 'sin petición' : `${largo[primero].startTime.toFixed(0)} s`);
    await esperar(5000);
    comprobar('y la voz en español vuelve a sonar allí', (await pagina.evaluate(() => window.__plays)) > playsAntes);
    comprobar('no aparece una transcripción vacía bajo el video', !(await pagina.isVisible('#ytResultArea')));
    comprobar('sin errores de JavaScript', reg.errores.length === 0, reg.errores.join(' | '));
    await contexto.close();
  }

  console.log('\n── T3.1: volver a abrir el mismo video no gasta nada ────────────');
  {
    const { contexto, pagina, reg } = await abrir(navegador, { youtube: () => respuestaYoutube({ fuente: 'usuario', confianza: 1 }) });
    await pegarEnlace(pagina); await pagina.click('#ytSyncBtn'); await esperarListo(pagina);
    await esperar(3500);   // deja guardar la caché
    await pagina.click('#btnYtSyncClose');
    const traducciones = reg.translate.length;
    await pegarEnlace(pagina); await pagina.click('#ytSyncBtn');
    const t0 = Date.now(); await esperarListo(pagina); const segundos = (Date.now() - t0) / 1000;
    comprobar('la segunda vez no se vuelve a pedir el texto (créditos)', reg.youtube.length === 1, `${reg.youtube.length}`);
    // +1: el lote que iba volando al pulsar Cerrar se aborta y al reabrir se
    // pide de nuevo (nunca se guardó su respuesta). Misma tolerancia que T1.5.
    comprobar('ni se vuelve a traducir lo ya traducido', reg.translate.length <= traducciones + 1, `${traducciones} → ${reg.translate.length}`);
    comprobar('y queda listo en menos de 4 s', segundos < 4, `${segundos.toFixed(1)} s`);
    await pagina.evaluate(() => window.__yt.seekTo(700));
    await esperar(600);
    await pagina.click('#btnYtSyncClose');
    await pegarEnlace(pagina); await pagina.click('#ytSyncBtn'); await esperarListo(pagina);
    await pagina.click('#ytDubReproducir'); await esperar(800);
    const t = await pagina.evaluate(() => window.__yt.getCurrentTime());
    comprobar('al volver, retoma donde ibas', t >= 695, `${t.toFixed(0)} s`);
    await contexto.close();
  }

  console.log('\n── T3.2: la voz del doblaje se elige en el panel ────────────────');
  {
    const { contexto, pagina, reg } = await abrir(navegador, { youtube: () => respuestaYoutube({ fuente: 'usuario', confianza: 1 }) });
    await pegarEnlace(pagina); await pagina.click('#ytSyncBtn'); await esperarListo(pagina);
    const opciones = await pagina.locator('#ytVozSelect option').count();
    comprobar('el panel ofrece las voces predefinidas de la app', opciones >= 4, `${opciones}`);
    const masculina = await pagina.evaluate(() => [...document.querySelectorAll('#ytVozSelect option')].find((o) => /:male$/.test(o.value))?.value || '');
    const antes = reg.tts.length;
    await pagina.selectOption('#ytVozSelect', masculina);
    // El video de prueba trae diálogo (3 marcas >>): se fija la 2.ª voz en la
    // misma masculina para comprobar que el cambio de voz entra sin cortar.
    comprobar('con diálogo se ofrece la segunda voz', await pagina.isVisible('#ytVoz2Wrap'));
    await pagina.selectOption('#ytVoz2Select', masculina);
    await reproducirConVoz(pagina); await esperar(3000);
    const nuevas = reg.tts.slice(antes);
    comprobar('desde el cambio, las frases salen con la voz nueva', nuevas.length > 0 && nuevas.every((t) => t.voz === 'male'), nuevas.map((t) => t.voz).join(','));
    comprobar('la voz del doblaje se recuerda aparte de la global', (await pagina.evaluate(() => localStorage.getItem('jg_yt_voz'))) === masculina);
    await contexto.close();
  }
  {
    const { contexto, pagina, reg } = await abrir(navegador, { vozRespaldo: true, youtube: () => respuestaYoutube({ fuente: 'usuario', confianza: 1 }) });
    // La página simulada no anuncia Fish (/tts-voices → {}): se activa a mano y se elige
    // una voz Fish en el selector del doblaje, como haría la persona.
    await pagina.waitForFunction(() => document.querySelectorAll('#ytVozSelect option').length > 0, null, { timeout: 10000 });
    await pagina.evaluate(() => {
      ttsFishInfo.active = true;   // `let` global de index.html: accesible por nombre
      const selector = document.getElementById('ytVozSelect');
      if (![...selector.options].some((o) => o.value === 'fish:jg-narradora')) selector.add(new Option('JG Narradora (más lenta)', 'fish:jg-narradora'));
      selector.value = 'fish:jg-narradora';
      selector.dispatchEvent(new Event('change'));
    });
    await pegarEnlace(pagina); await pagina.click('#ytSyncBtn'); await esperarListo(pagina);
    await reproducirConVoz(pagina); await esperar(3000);
    const conFish = reg.tts.filter((t) => t.fish).length;
    const ultimas = reg.tts.slice(-3);
    comprobar('si Fish cae, el doblaje sigue entero con una sola voz neural (sin mezclar timbres)', conFish >= 1 && ultimas.every((t) => !t.fish), `${conFish} con Fish; últimas: ${ultimas.map((t) => t.fish).join(',')}`);
    comprobar('y lo dice una vez, con la causa real', /Fish no responde/i.test(await pagina.textContent('#ytSyncArea')));
    await contexto.close();
  }

  console.log('\n── T3.3: subtítulos a elección, pantalla completa e iPhone ──────');
  {
    const { contexto, pagina } = await abrir(navegador, { youtube: () => respuestaYoutube({ fuente: 'usuario', confianza: 1 }) });
    await pegarEnlace(pagina); await pagina.click('#ytSyncBtn'); await esperarListo(pagina);
    await pagina.check('#ytToggleCaption');
    await pagina.reload(); await pagina.waitForSelector('#ytUrl', { state: 'attached' });
    comprobar('el interruptor de subtítulos se recuerda', await pagina.isChecked('#ytToggleCaption'));
    await pegarEnlace(pagina); await pagina.click('#ytSyncBtn'); await esperarListo(pagina);
    await pagina.click('#ytPantallaCompleta'); await esperar(500);
    const agrandado = await pagina.evaluate(() => Boolean(document.fullscreenElement?.classList.contains('yt-player-shell'))
      || document.querySelector('.yt-player-shell').classList.contains('yt-pantalla-completa'));
    comprobar('pantalla completa agranda el contenedor (así se ve el subtítulo propio)', agrandado);
    await contexto.close();
  }
  {
    const { contexto, pagina } = await abrir(navegador, { dispositivo: 'iPhone 13', youtube: () => respuestaYoutube({ fuente: 'usuario', confianza: 1 }) });
    await pegarEnlace(pagina); await pagina.click('#ytSyncBtn'); await esperarListo(pagina);
    comprobar('en iPhone se explica que el original se silencia', await pagina.isVisible('#ytNotaIOS'));
    comprobar('y no se ofrece un volumen que Safari ignora', !(await pagina.isVisible('#ytVolOriginal')));
    await reproducirConVoz(pagina); await esperar(2500);
    comprobar('mientras suena la voz, el original queda en silencio', await pagina.evaluate(() => window.__yt.mudo === true));
    await contexto.close();
  }

  console.log('\n── T3.4: panel claro en teléfono, tableta y escritorio ─────────');
  for (const vista of [{ width: 360, height: 740 }, { width: 390, height: 844 }, { width: 768, height: 1024 }, { width: 1366, height: 768 }]) {
    const { contexto, pagina } = await abrir(navegador, { viewport: vista });
    await pegarEnlace(pagina);
    const desborde = await pagina.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    comprobar(`${vista.width} px: sin desborde horizontal`, desborde <= 1, `${desborde} px`);
    comprobar(`${vista.width} px: «Doblar al español» es la acción principal`, /\bprimary\b/.test(await pagina.getAttribute('#ytSyncBtn', 'class')));
    if (vista.width < 1024) {
      // Redondeo a píxel CSS: con coordenadas fraccionarias el alto llega como
      // 43,999999999999996 y una comparación exacta marcaría objetivos de 44 px.
      const pequenos = await pagina.evaluate(() => [...document.querySelectorAll('#panelYt button, #panelYt select, #panelYt input, #panelYt summary')]
        .map((e) => ({ e, alto: e.getBoundingClientRect().height }))
        .filter(({ e, alto }) => e.offsetParent && Math.round(alto) < 44)
        .map(({ e, alto }) => `${e.id || e.className || e.tagName}@${e.parentElement?.id || e.parentElement?.className}:${alto.toFixed(4)}`));
      comprobar(`${vista.width} px: todo lo tocable mide ≥ 44 px`, pequenos.length === 0, pequenos.join(', '));
    }
    await contexto.close();
  }
  {
    const { contexto, pagina, reg } = await abrir(navegador);
    await pegarEnlace(pagina);
    await pagina.click('.yt-opciones-texto > summary');
    await pagina.click('#ytBtn'); await esperar(2500);
    comprobar('«Solo el texto» sigue funcionando (flujo clásico)', reg.youtube.some((p) => p.cuerpo.fast_mode === true));
    await contexto.close();
  }

  console.log('\n── T3.5: sin subtítulos se pide permiso antes de gastar ─────────');
  {
    const respuesta = (cuerpo) => (cuerpo.allow_ai_generation
      ? { status: 202, json: { pending: true, job_id: 'job-ia', title: 'x', requested_lang: 'en', language_source: 'titulo', language_resolution_confidence: 0.8 } }
      : { status: 409, json: { detail: 'Este video no tiene subtítulos.', code: 'sin_subtitulos', duration_s: 600, estimated_credits: 20 } });
    const { contexto, pagina, reg } = await abrir(navegador, { youtube: respuesta });
    let consultas = 0;
    await pagina.route(/\/youtube-job(\?|$)/, async (r) => {
      consultas += 1;
      const datos = consultas < 2 ? { status: 202, json: { pending: true, job_id: 'job-ia' } } : respuestaYoutube({ fuente: 'titulo', confianza: 0.8 });
      await r.fulfill(datos).catch(() => {});
    });
    await pegarEnlace(pagina); await pagina.click('#ytSyncBtn');
    await pagina.waitForSelector('#ytIaConsentimiento:not([hidden])', { timeout: 15000 }).catch(() => {});
    comprobar('sin subtítulos aparece el permiso', await pagina.isVisible('#ytIaConsentimiento'));
    comprobar('con el costo estimado a la vista', /20 créditos/.test(await pagina.textContent('#ytIaConsentimiento')));
    comprobar('la primera petición no autoriza gastar IA', reg.youtube[0]?.cuerpo?.allow_ai_generation === false);
    await pagina.click('#ytIaSi');
    await esperarListo(pagina, 40000);
    comprobar('al aceptar, se pide con permiso', reg.youtube[1]?.cuerpo?.allow_ai_generation === true);
    comprobar('y el trabajo largo termina en doblaje listo', await listo(pagina));
    await contexto.close();
  }
  {
    const { contexto, pagina, reg } = await abrir(navegador, { youtube: () => ({ status: 409, json: { detail: 'Sin subtítulos', code: 'sin_subtitulos', duration_s: 600, estimated_credits: 20 } }) });
    await pegarEnlace(pagina); await pagina.click('#ytSyncBtn');
    await pagina.waitForSelector('#ytIaConsentimiento:not([hidden])', { timeout: 15000 }).catch(() => {});
    await pagina.click('#ytIaNo'); await esperar(1500);
    comprobar('al rechazar no se pide nada más', reg.youtube.length === 1);
    comprobar('y se dice claro que no se gastó ningún crédito', /ningún crédito/i.test(await pagina.textContent('#ytSyncArea')));
    await contexto.close();
  }

  console.log('\n── T3.6: el texto traducido completo, solo si se pide ──────────');
  {
    const { contexto, pagina } = await abrir(navegador, { youtube: () => respuestaYoutube({ segmentos: segmentosRepetidos(3), fuente: 'usuario', confianza: 1 }) });
    await pegarEnlace(pagina); await pagina.click('#ytSyncBtn'); await esperarListo(pagina);
    comprobar('mientras no se pide, no aparece una transcripción vacía', !(await pagina.isVisible('#ytResultArea')));
    await pagina.click('#ytTranscriptPanel > summary');
    await pagina.click('#ytTextoCompleto');
    await pagina.waitForFunction(() => (document.getElementById('ytOutput').value.match(/ES /g) || []).length >= 130, null, { timeout: 30000 }).catch(() => {});
    const cuenta = await pagina.evaluate(() => (document.getElementById('ytOutput').value.match(/ES /g) || []).length);
    comprobar('el texto completo queda traducido en el cuadro de resultado', cuenta >= 130, `${cuenta}`);
    comprobar('y se muestra, listo para copiar, descargar o escuchar', await pagina.isVisible('#ytResultArea'));
    await contexto.close();
  }

  console.log('\n── Voz automática + diálogo con 2 voces (2026-09-26) ────────');
  {
    const dialogo = [
      { startTime: 0, endTime: 3, duration: 3, text: 'Hello, welcome to the show' },
      { startTime: 3, endTime: 6, duration: 3, text: '>> Thanks, happy to be here today' },
      { startTime: 6, endTime: 9, duration: 3, text: '>> Tell us about your new book' },
      { startTime: 9, endTime: 12, duration: 3, text: '>> It is about marketing in the age of AI' },
    ];
    const { contexto, pagina, reg } = await abrir(navegador, { youtube: () => respuestaYoutube({ segmentos: dialogo, fuente: 'usuario', confianza: 1 }) });
    await pagina.waitForFunction(() => document.querySelectorAll('#ytVozSelect option').length > 1, null, { timeout: 10000 }).catch(() => {});
    comprobar('la voz inicial es Automática (según el video)', (await pagina.inputValue('#ytVozSelect')) === 'auto');
    await pegarEnlace(pagina); await pagina.click('#ytSyncBtn'); await esperarListo(pagina);
    comprobar('con diálogo aparece la segunda voz', await pagina.isVisible('#ytVoz2Wrap'));
    const voces = [...new Set(reg.tts.map((t) => t.voz))].sort().join(',');
    comprobar('el diálogo alterna voz femenina y masculina', voces === 'female,male', voces || 'sin voz aún');
    comprobar('sin errores de JavaScript', reg.errores.length === 0, reg.errores.join(' | '));
    await contexto.close();
  }
  {
    // Monólogo real (sin >>): una sola voz y sin segunda voz a la vista.
    const monologo = [
      { startTime: 0, endTime: 3, duration: 3, text: 'Hello, welcome to this tutorial' },
      { startTime: 3, endTime: 6, duration: 3, text: 'Today we talk about marketing basics' },
      { startTime: 6, endTime: 9, duration: 3, text: 'First, know your audience very well' },
      { startTime: 9, endTime: 12, duration: 3, text: 'Second, tell a story they remember' },
    ];
    const { contexto, pagina, reg } = await abrir(navegador, { youtube: () => respuestaYoutube({ segmentos: monologo, fuente: 'usuario', confianza: 1 }) });
    await pegarEnlace(pagina); await pagina.click('#ytSyncBtn'); await esperarListo(pagina);
    comprobar('un monólogo no ofrece segunda voz', !(await pagina.isVisible('#ytVoz2Wrap')));
    const voces = [...new Set(reg.tts.map((t) => t.voz))];
    comprobar('y todo suena con una sola voz', voces.length === 1, voces.join(','));
    await contexto.close();
  }

  console.log('\n── Velocidad a gusto de la persona (2026-09-26) ────────────────');
  {
    const { contexto, pagina, reg } = await abrir(navegador, { youtube: () => respuestaYoutube({ fuente: 'usuario', confianza: 1 }) });
    await pegarEnlace(pagina); await pagina.click('#ytSyncBtn'); await esperarListo(pagina);
    const presets = await pagina.locator('#ytSyncRate option').count();
    comprobar('el selector trae presets finos además de los de YouTube', presets >= 12, `${presets}`);
    await pagina.selectOption('#ytSyncRate', '0.85');
    comprobar('elegir 0.85 frena el video a 0.85x', (await pagina.evaluate(() => window.__yt.tasa)) === 0.85);
    comprobar('y se recuerda entre videos', (await pagina.evaluate(() => localStorage.getItem('jg_yt_rate'))) === '0.85');
    await pagina.selectOption('#ytSyncRate', 'libre');
    comprobar('«Otra…» muestra el campo libre', await pagina.isVisible('#ytRateCustomWrap'));
    await pagina.fill('#ytRateCustom', '0.97');
    await pagina.dispatchEvent('#ytRateCustom', 'change');
    comprobar('0.97 libre se aplica al video', (await pagina.evaluate(() => window.__yt.tasa)) === 0.97);
    comprobar('sin errores de JavaScript', reg.errores.length === 0, reg.errores.join(' | '));
    await contexto.close();
  }

} finally {
  await navegador.close();
  servidor.close();
}
console.log(`\n${ok} comprobaciones OK · ${fallos.length} fallos`);
process.exit(fallos.length ? 1 : 0);
