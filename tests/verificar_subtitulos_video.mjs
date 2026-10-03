/* JG Turbo · Subtítulos del video: estilo dinámico (máx. 2 renglones al ritmo de la voz),
 * pantalla completa pegada a la imagen y modo horizontal del teléfono. Con API, voz y
 * reproductor simulados (mismo arnés que verificar_youtube_doblaje.mjs).
 *
 *   node tests/verificar_subtitulos_video.mjs
 *   node tests/verificar_subtitulos_video.mjs --headed
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
const base = process.env.JG_BASE || `http://127.0.0.1:${servidor.address().port}`;

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
    window.__cortes = [];
    const play = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function (...a) { window.__plays += 1; return play.apply(this, a); };
    // Un corte = una voz que sonaba y se detuvo (o se cambió) antes de su final
    // con el video andando. Es lo que reportó el dueño: «salta líneas».
    const cortada = (el) => {
      const d = Number(el.duration);
      return !el.paused && Number.isFinite(d) && el.currentTime < d - 0.15 && window.__yt && window.__yt.estado === 1;
    };
    const pausar = HTMLMediaElement.prototype.pause;
    HTMLMediaElement.prototype.pause = function (...a) {
      if (cortada(this)) window.__cortes.push({ en: this.currentTime, de: this.duration });
      return pausar.apply(this, a);
    };
    const src = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'src');
    Object.defineProperty(HTMLMediaElement.prototype, 'src', {
      ...src,
      set(valor) {
        if (cortada(this)) window.__cortes.push({ en: this.currentTime, de: this.duration, cambio: true });
        return src.set.call(this, valor);
      },
    });
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
    reg.tts.push({ t: Date.now(), texto: datos.text || '', voz: String(datos.voice || ''), fish: String(datos.prefer_fish) === 'true', fishVoz: datos.fish_voice || '', fijo: String(datos.idioma_fijo) === 'true' });
    await esperar(escenario.demoraVozMs ?? 150);
    const respaldo = escenario.vozRespaldo && String(datos.prefer_fish) === 'true';
    await responder(r, {
      status: 200, contentType: 'audio/wav',
      headers: { 'X-TTS-Engine': respaldo ? 'azure-neural-regional' : 'azure-neural-regional', 'X-TTS-Voice': 'es-CO-SalomeNeural', 'X-TTS-Fallback': respaldo ? '1' : '0' },
      // `vozCps` bajo = voz que ocupa más que el inglés (el caso que salta líneas).
      body: wavSilencio(Math.max(0.6, String(datos.text || '').length / (escenario.vozCps ?? 16))),
    });
  });
  await pagina.goto(`${base}/?tab=yt`, { waitUntil: 'domcontentloaded' });
  await pagina.waitForSelector('#ytUrl', { state: 'attached' });
  // El formulario existe antes de que termine la carga diferida del controlador.
  // Esperar su inicialización evita pulsar un botón sin su listener en red real.
  await pagina.waitForFunction(() => Boolean(window.jgVideoLocal)
    && Boolean(document.querySelector('link[data-vid-css]')?.sheet),
  null, { timeout: 30000, polling: 100 });
  return { contexto, pagina, reg };
}

async function pegarEnlace(pagina, url = URL_VIDEO) {
  await pagina.fill('#ytUrl', url);
  await pagina.waitForFunction(() => !document.getElementById('ytSyncBtn').disabled, null, { timeout: 10000, polling: 100 });
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
  console.log('DIAGNOSTICO: doblaje no listo', await pagina.evaluate(() => ({
    estado: document.getElementById('ytSyncStatus')?.textContent,
    mensaje: document.getElementById('ytDubMensaje')?.textContent,
    aviso: document.getElementById('ytStatus')?.textContent,
    boton: document.getElementById('ytSyncBtn')?.disabled,
    reproductor: Boolean(window.__yt),
  })));
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

/* ── Subtítulos legibles (estilo TikTok), pantalla completa y modo horizontal ── */
const MODULO = pathToFileURL(join(app, 'js/youtube/subtituloDinamico.js')).href;
const modulo = await import(MODULO);

/** Segmentos de ~280 caracteres, separados por un hueco, para que cada uno sea su propia frase de voz. */
const TEXTO_LARGO = 'Cuando construyes una marca que vende en la nueva era de la inteligencia artificial, lo primero es entender que la confianza se gana despacio; los atajos se pagan caros. Por eso conviene escuchar a tus clientes, medir lo que funciona y repetirlo sin prisa, día tras día, semana tras semana.';
const SEGMENTOS_LARGOS = Array.from({ length: 8 }, (_, k) => ({ text: `${TEXTO_LARGO} ${k}`, startTime: k * 16, endTime: k * 16 + 13 }));
const ESCENARIO = { vozCps: 22, youtube: () => respuestaYoutube({ segmentos: SEGMENTOS_LARGOS, fuente: 'usuario', confianza: 1 }) };
const VISTAS = [['telefono', 390, 844], ['telefono-horizontal', 844, 390], ['telefono-horizontal-chico', 800, 360], ['tablet', 768, 1024], ['escritorio', 1440, 900]];

async function prepararSesion(navegador, ancho, alto) {
  const { contexto, pagina, reg } = await abrir(navegador, { ...ESCENARIO, viewport: { width: ancho, height: alto } });
  await pegarEnlace(pagina); await pagina.click('#ytSyncBtn'); await esperarListo(pagina);
  await pagina.check('#ytToggleCaption');
  await pagina.evaluate(() => {
    const play = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function (...a) { window.__av = this; return play.apply(this, a); };
  });
  return { contexto, pagina, reg };
}

/** Lo que mide la persona: alto del subtítulo, renglones reales, trozo y avance de la voz que suena. */
const muestrear = (pagina) => pagina.evaluate(() => {
  const c = document.getElementById('ytCaption');
  const cs = getComputedStyle(c);
  const lh = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.4;
  const relleno = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom);
  const r = document.createRange(); r.selectNodeContents(c);
  const cajas = [...r.getClientRects()].map((x) => Math.round(x.top));
  const av = window.__av && !window.__av.paused && window.__av.duration > 0 ? window.__av.currentTime / window.__av.duration : null;
  return {
    texto: c.textContent, trozo: Number(c.dataset.trozo ?? -1), total: Number(c.dataset.total ?? 0), estilo: c.dataset.estilo,
    alto: c.getBoundingClientRect().height, lh, relleno,
    renglones: new Set(cajas).size, desborda: c.scrollHeight > c.clientHeight + 1, avance: av,
    video: window.__yt ? window.__yt.getCurrentTime() : 0,
  };
});
const geometria = (pagina) => pagina.evaluate(() => {
  const f = document.querySelector('.yt-video-frame').getBoundingClientRect();
  const c = document.getElementById('ytCaption').getBoundingClientRect();
  return { fTop: f.top, fBottom: f.bottom, fLeft: f.left, fRight: f.right, fAlto: f.height, fAncho: f.width, cTop: c.top, cBottom: c.bottom, cLeft: c.left, cRight: c.right, cAncho: c.width, vw: innerWidth, vh: innerHeight };
});

for (const [nombre, ancho, alto] of VISTAS) {
  console.log(`\n── Subtítulos: ${nombre} (${ancho}×${alto}) ──`);
  const { contexto, pagina, reg } = await prepararSesion(navegador, ancho, alto);
  comprobar(`[${nombre}] el estilo inicial es dinámico`, (await pagina.inputValue('#ytEstiloSubtitulo')) === 'dinamico');
  await reproducirConVoz(pagina);
  const muestras = [];
  for (let i = 0; i < 90; i += 1) { await esperar(130); muestras.push(await muestrear(pagina)); }
  const con = muestras.filter((m) => m.texto);
  comprobar(`[${nombre}] hay subtítulo mientras suena la voz`, con.length >= 40, `${con.length}`);
  comprobar(`[${nombre}] nunca supera 2 renglones (alto medido y renglones reales)`, con.every((m) => m.renglones <= 2 && m.alto <= 2 * m.lh + m.relleno + 2), JSON.stringify(con.filter((m) => m.renglones > 2 || m.alto > 2 * m.lh + m.relleno + 2).slice(0, 2)));
  comprobar(`[${nombre}] el texto nunca desborda su caja`, con.every((m) => !m.desborda));
  comprobar(`[${nombre}] el alto reservado no salta (siempre el mismo)`, new Set(muestras.map((m) => Math.round(m.alto))).size === 1, [...new Set(muestras.map((m) => Math.round(m.alto)))].join(','));
  comprobar(`[${nombre}] el subtítulo cambia de trozo mientras suena la voz`, new Set(con.map((m) => m.trozo)).size >= 3, [...new Set(con.map((m) => m.trozo))].join(','));
  // Un segmento a la vez: los trozos vistos mientras es el mismo segmento, en orden.
  const segmentoDe = (t) => Number(String(t).trim().split(' ').pop());
  let bajadas = 0;
  for (let i = 1; i < con.length; i += 1) if (con[i].total === con[i - 1].total && con[i].trozo < con[i - 1].trozo && con[i].trozo !== 0) bajadas += 1;   // volver a 0 = otro segmento
  comprobar(`[${nombre}] dentro de un mismo segmento el trozo nunca retrocede`, bajadas === 0, `${bajadas}`);
  // El texto de los trozos de un segmento, unido, es el segmento entero (ninguna palabra perdida).
  const porTotal = new Map();
  for (const m of con.filter((x) => x.total > 1)) { const k = `${m.total}`; if (!porTotal.has(k)) porTotal.set(k, new Map()); porTotal.get(k).set(m.trozo, m.texto); }
  const unionOk = [...porTotal.values()].some((trozos) => {
    const lista = [...trozos.entries()].sort((a, b) => a[0] - b[0]);
    if (lista.length < 2 || lista[0][0] !== 0) return false;
    const texto = lista.map(([, t]) => t).join(' ');
    return lista.every(([k], idx) => k === idx) && texto.replace(/ \d+$/, '').startsWith('ES Cuando construyes');
  });
  comprobar(`[${nombre}] los trozos vistos empiezan por el principio y siguen en orden`, unionOk);
  // Correspondencia con el progreso de la voz: el trozo visible es el que toca (±1 por el tic de 150 ms).
  const vistos = new Map(); for (const m of con) vistos.set(`${m.total}:${m.trozo}`, m.texto);
  const conAvance = con.filter((m) => m.avance !== null && m.total > 1 && m.avance > 0.03 && m.avance < 0.97);
  const desvios = conAvance.filter((m) => {
    const trozos = [...Array(m.total).keys()].map((k) => vistos.get(`${m.total}:${k}`));
    if (trozos.some((t) => t === undefined)) return false;   // aún no se vieron todos
    return Math.abs(modulo.trozoPorProgreso(trozos, m.avance) - m.trozo) > 1;
  });
  comprobar(`[${nombre}] el trozo visible corresponde al avance de la voz`, conAvance.length >= 15 && desvios.length === 0, `${desvios.length} de ${conAvance.length}`);

  // ── Tamaños: en ambos estilos el subtítulo respeta 2 renglones ──
  for (const tam of ['pequeno', 'grande', 'mediano']) {
    await pagina.selectOption('#ytTamanoSubtitulo', tam);
    const m = [];
    for (let i = 0; i < 12; i += 1) { await esperar(130); m.push(await muestrear(pagina)); }
    const c = m.filter((x) => x.texto);
    comprobar(`[${nombre}] tamaño ${tam}: máximo 2 renglones y sin desbordar`, c.length >= 6 && c.every((x) => x.renglones <= 2 && !x.desborda && x.alto <= 2 * x.lh + x.relleno + 2), JSON.stringify(c.find((x) => x.renglones > 2 || x.desborda)));
  }

  // ── Subtítulos apagados: sigue oculto aunque haya una regla con id ──
  await pagina.uncheck('#ytToggleCaption');
  comprobar(`[${nombre}] apagado con el interruptor, el subtítulo no se ve`, await pagina.evaluate(() => getComputedStyle(document.getElementById('ytCaption')).display === 'none'));
  await pagina.check('#ytToggleCaption');
  await esperar(300);

  // ── Controles táctiles ≥ 44 px y sin desborde horizontal ──
  const ctl = await pagina.evaluate(() => {
    const ids = ['ytDubbingBtn', 'ytPantallaCompleta', 'ytTamanoSubtitulo', 'ytEstiloSubtitulo', 'ytVoz', 'ytVozSelect', 'ytRitmoAuto', 'ytVolVoz', 'ytVolOriginal'];
    const els = ids.map((id) => document.getElementById(id)).filter((e) => e && e.getClientRects().length);
    return { pequenos: els.filter((e) => Math.max(e.getBoundingClientRect().height, e.closest('label')?.getBoundingClientRect().height || 0) < 44).map((e) => `${e.id}:${Math.round(e.getBoundingClientRect().height)}`), desborde: document.documentElement.scrollWidth - document.documentElement.clientWidth, n: els.length };
  });
  comprobar(`[${nombre}] sin desplazamiento horizontal de la página`, ctl.desborde <= 0, `${ctl.desborde}`);
  comprobar(`[${nombre}] controles de voz y subtítulos alcanzables con toques de ≥ 44 px`, ctl.n >= 5 && ctl.pequenos.length === 0, ctl.pequenos.join(', '));

  // ── Modo horizontal del teléfono: el video cabe en el alto visible con su subtítulo debajo ──
  if (alto <= 500) {
    await pagina.locator('.yt-player-shell').scrollIntoViewIfNeeded();
    await pagina.evaluate(() => document.querySelector('.yt-player-shell').scrollIntoView({ block: 'start' }));
    await esperar(200);
    const g = await geometria(pagina);
    comprobar(`[${nombre}] horizontal: imagen y subtítulo caben juntos en el alto visible`, g.fBottom - g.fTop > 150 && g.cBottom <= g.vh + 1 && g.fTop >= -1, JSON.stringify(g));
    comprobar(`[${nombre}] horizontal: el subtítulo queda justo debajo de la imagen`, g.cTop >= g.fBottom - 1 && g.cTop - g.fBottom <= 16, `${g.cTop - g.fBottom}`);
    comprobar(`[${nombre}] horizontal: la imagen no es más pequeña de lo necesario (≥ 60 % del alto visible)`, g.fAlto >= g.vh * 0.6, `${g.fAlto} de ${g.vh}`);
  }

  // ── Pantalla completa: real y con la clase de respaldo ──
  for (const modo of ['real', 'respaldo']) {
    if (modo === 'real') {
      await pagina.click('#ytPantallaCompleta');
      const entro = await pagina.waitForFunction(() => document.fullscreenElement || document.querySelector('.yt-pantalla-completa'), null, { timeout: 5000 }).then(() => true).catch(() => false);
      comprobar(`[${nombre}] entra en pantalla completa`, entro);
      if (!(await pagina.evaluate(() => Boolean(document.fullscreenElement)))) { console.log(`   (sin Fullscreen API en este navegador; la clase de respaldo cubre ${nombre})`); }
    } else {
      if (await pagina.evaluate(() => Boolean(document.fullscreenElement))) { await pagina.evaluate(() => document.exitFullscreen()); await pagina.waitForFunction(() => !document.fullscreenElement); }
      await pagina.evaluate(() => { document.querySelector('.yt-pantalla-completa')?.classList.remove('yt-pantalla-completa'); document.querySelector('.yt-player-shell').classList.add('yt-pantalla-completa'); });
    }
    await esperar(500);
    const g = await geometria(pagina);
    const s = await muestrear(pagina);
    if (process.env.CAPTURAS) await pagina.screenshot({ path: join(process.env.CAPTURAS, `${nombre}-${modo}.png`) });
    const debajo = g.cTop >= g.fBottom - 1 && g.cTop - g.fBottom <= 16;
    const tercio = g.cTop >= g.fTop + (g.fBottom - g.fTop) * (2 / 3) - 1 && g.cBottom <= g.fBottom + 1;
    comprobar(`[${nombre}/${modo}] pantalla completa: subtítulo pegado bajo la imagen (0–16 px) o dentro de su tercio inferior`, debajo || tercio, JSON.stringify(g));
    comprobar(`[${nombre}/${modo}] pantalla completa: el subtítulo nunca flota en la franja negra lejos del video`, g.cTop <= g.fBottom + 16 && g.cBottom >= g.fTop, JSON.stringify(g));
    if (debajo) comprobar(`[${nombre}/${modo}] pantalla completa: subtítulo centrado al ancho de la imagen`, Math.abs((g.cLeft + g.cRight) / 2 - (g.fLeft + g.fRight) / 2) <= 2 && g.cAncho <= g.fAncho + 2, JSON.stringify(g));
    comprobar(`[${nombre}/${modo}] pantalla completa: todo cabe en la ventana`, g.fTop >= -1 && g.fLeft >= -1 && g.fRight <= g.vw + 1 && g.cBottom <= g.vh + 1 && g.cRight <= g.vw + 1, JSON.stringify(g));
    comprobar(`[${nombre}/${modo}] pantalla completa: máximo 2 renglones`, s.renglones <= 2 && !s.desborda, JSON.stringify(s));
    comprobar(`[${nombre}/${modo}] pantalla completa: la imagen conserva 16:9`, Math.abs(g.fAncho / g.fAlto - 16 / 9) < 0.03, `${(g.fAncho / g.fAlto).toFixed(3)}`);
    const salir = await pagina.evaluate(() => { const b = document.getElementById('ytSalirPantalla').getBoundingClientRect(); const c = document.getElementById('ytCaption').getBoundingClientRect(); return { alto: b.height, choca: !(b.right < c.left || b.left > c.right || b.bottom < c.top || b.top > c.bottom), visible: b.width > 0 }; });
    comprobar(`[${nombre}/${modo}] el botón de salir se ve, mide ≥ 44 px y no lo tapa el subtítulo`, salir.visible && salir.alto >= 44 && !salir.choca, JSON.stringify(salir));
    // Fondo con contraste AA sobre la imagen/negro: texto claro y, si se superpone, fondo oscuro translúcido.
    const estilo = await pagina.evaluate(() => { const cs = getComputedStyle(document.getElementById('ytCaption')); return { color: cs.color, fondo: cs.backgroundColor, sombra: cs.textShadow }; });
    const claro = (estilo.color.match(/\d+/g) || []).slice(0, 3).map(Number).every((v) => v >= 200);
    comprobar(`[${nombre}/${modo}] pantalla completa: texto claro con sombra o fondo translúcido`, claro && (estilo.sombra !== 'none' || !/rgba\(0, 0, 0, 0\)|transparent/.test(estilo.fondo)), JSON.stringify(estilo));
  }
  // Salir de pantalla completa deja todo como estaba.
  if (await pagina.evaluate(() => Boolean(document.fullscreenElement))) { await pagina.evaluate(() => document.exitFullscreen()); await pagina.waitForFunction(() => !document.fullscreenElement); }
  await pagina.evaluate(() => document.querySelector('.yt-player-shell').classList.remove('yt-pantalla-completa'));
  await esperar(300);
  const tras = await geometria(pagina);
  comprobar(`[${nombre}] al salir, el subtítulo vuelve debajo de la imagen`, tras.cTop >= tras.fBottom - 1 && tras.cTop - tras.fBottom <= 2, JSON.stringify(tras));

  // ── Estilo «Completo»: texto entero, y se recuerda tras recargar ──
  await pagina.selectOption('#ytEstiloSubtitulo', 'completo');
  await esperar(500);
  const comp = await muestrear(pagina);
  comprobar(`[${nombre}] «Completo» muestra el texto entero del segmento`, comp.estilo === 'completo' && comp.texto.replace(/ \d+$/, '').endsWith('semana tras semana.') && comp.texto.startsWith('ES Cuando'), comp.texto.slice(0, 60));
  comprobar(`[${nombre}] la elección se guarda en jg_yt_subtitulo_estilo`, (await pagina.evaluate(() => localStorage.getItem('jg_yt_subtitulo_estilo'))) === 'completo');
  await pagina.reload();
  await pagina.waitForSelector('#ytEstiloSubtitulo', { state: 'attached' });
  await pagina.waitForFunction(() => document.getElementById('ytCaption')?.dataset.estilo, null, { timeout: 10000 }).catch(() => {});
  comprobar(`[${nombre}] «Completo» sobrevive a la recarga`, (await pagina.inputValue('#ytEstiloSubtitulo')) === 'completo' && (await pagina.getAttribute('#ytCaption', 'data-estilo')) === 'completo');
  comprobar(`[${nombre}] sin errores de JavaScript`, reg.errores.length === 0, reg.errores.join(' | '));
  await contexto.close();
}

console.log('\n── Girar el teléfono con una sesión abierta ──');
{
  const { contexto, pagina, reg } = await prepararSesion(navegador, 390, 844);
  await reproducirConVoz(pagina);
  await esperar(2500);
  const antes = { video: await pagina.evaluate(() => window.__yt.getCurrentTime()), plays: await pagina.evaluate(() => window.__plays) };
  const vertical = await geometria(pagina);
  await pagina.setViewportSize({ width: 844, height: 390 });
  await esperar(700);
  const horizontal = await pagina.evaluate(() => ({ desborde: document.documentElement.scrollWidth - document.documentElement.clientWidth, estado: window.__yt.estado, video: window.__yt.getCurrentTime(), diag: window.jgDoblajeDiagnostico?.() }));
  comprobar('al girar a horizontal no hay desplazamiento horizontal', horizontal.desborde <= 0, `${horizontal.desborde}`);
  comprobar('al girar, el video sigue andando y sin volver al inicio', horizontal.estado === 1 && horizontal.video >= antes.video, `${antes.video} → ${horizontal.video}`);
  await pagina.setViewportSize({ width: 390, height: 844 });
  await esperar(700);
  const vuelta = await geometria(pagina);
  const fin = await pagina.evaluate(() => ({ estado: window.__yt.estado, video: window.__yt.getCurrentTime(), cortes: window.__cortes.length, saltadas: window.jgDoblajeDiagnostico?.().frasesSaltadas }));
  comprobar('al volver a vertical todo queda como estaba (misma imagen y subtítulo debajo)', Math.abs(vuelta.fAlto - vertical.fAlto) < 1 && Math.abs(vuelta.fAncho - vertical.fAncho) < 1 && vuelta.cTop >= vuelta.fBottom - 1, JSON.stringify({ vertical, vuelta }));
  comprobar('y no se pierde la posición del video ni la voz', fin.estado === 1 && fin.video >= horizontal.video && fin.cortes === 0 && !fin.saltadas, JSON.stringify(fin));
  comprobar('sin errores de JavaScript al girar', reg.errores.length === 0, reg.errores.join(' | '));
  await contexto.close();
}

} finally {
  await navegador.close();
  servidor.close();
}
console.log(`\n${ok} comprobaciones OK · ${fallos.length} fallos`);
process.exit(fallos.length ? 1 : 0);
