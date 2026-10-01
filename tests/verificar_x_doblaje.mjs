/* JG Turbo · Doblaje de videos de X de punta a punta, SIN red ni créditos.
 *
 * /x-video, video.twimg.com (listas HLS, trozos de audio y el MP4), /transcribe,
 * /translate y /tts se responden desde aquí. El «MP4» es un WebM de 120 s: el
 * Chromium de Playwright no reproduce H.264. Mide lo que vive la persona: que
 * ninguna petición a X lleve Referer (X responde 403), que el audio viaje en
 * partes pequeñas, que el video se vea y avance con la voz, que cancelar pare
 * de verdad y que los errores se lean.
 *
 *   node tests/verificar_x_doblaje.mjs
 *   node tests/verificar_x_doblaje.mjs --headed
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

const WEBM = await readFile(join(app, 'tests/fixtures/x/video_prueba.webm'));
const URL_X = 'https://x.com/BrooklynNets/status/1349794411333394432';
const TROZOS = 250;   // 750 s de audio → 3 partes
const MAESTRA = '#EXTM3U\n#EXT-X-MEDIA:NAME="Audio",TYPE=AUDIO,GROUP-ID="audio-64000",URI="/v/pl/mp4a/64000/a.m3u8"\n';
const LISTA = ['#EXTM3U', '#EXT-X-MAP:URI="/v/aud/init.mp4"',
  ...Array.from({ length: TROZOS }, (_, i) => `#EXTINF:3.000,\n/v/aud/${i}.m4s`), '#EXT-X-ENDLIST'].join('\n');
const infoX = (extra = {}) => ({
  id: '1349794411333394432', indice: 0, autor: 'BrooklynNets', texto: 'WATCH: prueba', idioma_texto: 'en',
  duracion_s: TROZOS * 3, portada: '', fuente: 'sindicacion',
  hls: 'https://video.twimg.com/v/pl/master.m3u8',
  mp4: [{ url: 'https://video.twimg.com/v/vid/640x360/prueba.mp4', bitrate: 832000, ancho: 640, alto: 360 }],
  ...extra,
});

/** WAV de silencio con la duración pedida (el motor usa audio.duration). */
function wavSilencio(segundos) {
  const muestras = Math.max(1, Math.round(8000 * segundos));
  const b = Buffer.alloc(44 + muestras);
  b.write('RIFF', 0); b.writeUInt32LE(36 + muestras, 4); b.write('WAVE', 8); b.write('fmt ', 12);
  b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(8000, 24);
  b.writeUInt32LE(8000, 28); b.writeUInt16LE(1, 32); b.writeUInt16LE(8, 34); b.write('data', 36); b.writeUInt32LE(muestras, 40);
  b.fill(128, 44);
  return b;
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

/**
 * Página con todo simulado. `escenario`:
 *  info: { status, json } de /x-video · retrasoTranscribeMs · movil: viewport de teléfono
 */
async function abrir(navegador, escenario = {}) {
  const contexto = escenario.movil
    ? await navegador.newContext({ ...devices['Pixel 7'] })
    : await navegador.newContext({ viewport: { width: 1280, height: 800 } });
  const pagina = await contexto.newPage();
  const reg = { twimg: 0, listas: 0, conReferer: [], subidas: [], tts: 0, errores: [] };
  pagina.on('pageerror', (e) => reg.errores.push(String(e).slice(0, 200)));
  const responder = (r, datos) => r.fulfill(datos).catch(() => { /* la página ya abortó: correcto al cancelar */ });
  await pagina.route(/\/(health|session-config|ping|glossary|tts-voices|tts-warmup)(\?|$)/, (r) => {
    const u = r.request().url();
    if (u.includes('/health')) return responder(r, { json: { status: 'ok', server: 'vercel', model: 'whisper-large-v3', model_state: 'listo', model_ready: true, ai_configured: true, groq_configured: true, ia_configured: true, youtube_auto: true, x_video: true, tts_azure: true, tts_fish: false } });
    if (u.includes('/session-config')) return responder(r, { json: { token: 'vercel-bypass', ai_provider: 'mistral', ai_configured: true, groq_configured: true, ia_configured: true, limits: {} } });
    return responder(r, { json: {} });
  });
  await pagina.route(/\/translate(\?|$)/, async (r) => {
    const cuerpo = JSON.parse(r.request().postData() || '{}');
    const piezas = [...String(cuerpo.text || '').matchAll(/\[\[JG_SEG_(\d{6})\]\]\n([^\[]*)/g)];
    await esperar(150);
    const text = piezas.length
      ? piezas.map((m) => `[[JG_SEG_${m[1]}]]\nES ${m[2].trim()}`).join('\n\n')
      : `ES ${cuerpo.text}`;
    await responder(r, { json: { text, ia_used: true, provider: 'mistral', validation: { status: 'ok', integrity_score: 100 } } });
  });
  await pagina.route(/\/tts(\?|$)/, async (r) => {
    const req = r.request();
    const datos = req.method() === 'GET' ? Object.fromEntries(new URL(req.url()).searchParams) : JSON.parse(req.postData() || '{}');
    reg.tts += 1;
    await esperar(120);
    await responder(r, {
      status: 200, contentType: 'audio/wav',
      headers: { 'X-TTS-Engine': 'azure-neural-regional', 'X-TTS-Voice': 'es-CO-SalomeNeural', 'X-TTS-Fallback': '0' },
      body: wavSilencio(Math.max(0.6, String(datos.text || '').length / 16)),
    });
  });
  await pagina.route('https://video.twimg.com/**', async (r) => {
    const pedido = r.request();
    const u = pedido.url();
    reg.twimg += 1;
    if (pedido.headers().referer) reg.conReferer.push(u);
    const cors = { 'access-control-allow-origin': '*' };
    if (u.endsWith('.m3u8')) {
      reg.listas += 1;
      return responder(r, { status: 200, contentType: 'application/vnd.apple.mpegurl', body: u.endsWith('master.m3u8') ? MAESTRA : LISTA, headers: cors });
    }
    if (u.includes('/vid/')) return responder(r, { status: 200, contentType: 'video/webm', body: WEBM });
    return responder(r, { status: 200, contentType: 'video/mp4', body: Buffer.alloc(u.endsWith('init.mp4') ? 800 : 24000), headers: cors });
  });
  await pagina.route(/\/x-video(\?|$)/, (r) => {
    const { status = 200, json = infoX() } = escenario.info || {};
    return responder(r, { status, json });
  });
  await pagina.route(/\/transcribe(\?|$)/, async (r) => {
    const n = reg.subidas.length;
    reg.subidas.push(r.request().postDataBuffer()?.length || 0);
    await esperar(escenario.retrasoTranscribeMs ?? 300);
    const segments = Array.from({ length: 30 }, (_, i) => ({ start: 8 + i * 11, end: 12 + i * 11, text: `Sentence number ${i + 1} of part ${n + 1}.` }));
    await responder(r, { json: { text: 'x', language: 'en', segments } });
  });
  await pagina.goto(`${base}/?tab=yt`, { waitUntil: 'domcontentloaded' });
  await pagina.waitForSelector('#ytUrl', { state: 'attached' });
  return { contexto, pagina, reg };
}

async function pegarEnlace(pagina, url = URL_X) {
  await pagina.fill('#ytUrl', url);
  await pagina.waitForFunction(() => !document.getElementById('ytSyncBtn').disabled, null, { timeout: 10000 }).catch(() => {});
}
const listo = (pagina) => pagina.evaluate(() => {
  const r = document.getElementById('ytDubReproducir');
  if (r && !r.hidden && !r.disabled) return true;
  const b = document.getElementById('ytDubbingBtn');
  return Boolean(b && !b.disabled);
});
/** Espera a que el doblaje esté listo; de paso anota los mensajes de progreso vistos. */
async function esperarListo(pagina, ms = 30000, mensajes = []) {
  const fin = Date.now() + ms;
  while (Date.now() < fin) {
    mensajes.push(await pagina.textContent('#ytDubMensaje').catch(() => ''));
    if (await listo(pagina)) return true;
    await esperar(100);
  }
  return false;
}
const tiempoVideo = (pagina) => pagina.evaluate(() => {
  const v = document.getElementById('ytPlayer')?.contentDocument?.querySelector('video');
  return v ? v.currentTime : -1;
});
async function esperarMensaje(pagina, patron, ms = 15000) {
  const fin = Date.now() + ms;
  while (Date.now() < fin) {
    const texto = await pagina.textContent('#ytDubMensaje').catch(() => '');
    if (patron.test(texto)) return texto;
    await esperar(100);
  }
  return await pagina.textContent('#ytDubMensaje').catch(() => '');
}

const navegador = await chromium.launch({ headless: !process.argv.includes('--headed') });
try {
  console.log('\n── Enlaces: YouTube y X en el mismo campo ─────────────────────');
  {
    const { contexto, pagina } = await abrir(navegador);
    await pegarEnlace(pagina);
    comprobar('con un enlace de X el botón «Doblar al español» se habilita', !(await pagina.isDisabled('#ytSyncBtn')));
    comprobar('y se ve la nota que explica el enlace de X', await pagina.isVisible('#ytUrlNota'));
    await pagina.fill('#ytUrl', 'https://x.com/home');
    await esperar(200);
    comprobar('con x.com/home el botón queda deshabilitado y la nota oculta', (await pagina.isDisabled('#ytSyncBtn')) && !(await pagina.isVisible('#ytUrlNota')));
    await contexto.close();
  }

  console.log('\n── Flujo completo, caché y Referer ────────────────────────────');
  {
    const { contexto, pagina, reg } = await abrir(navegador);
    await pegarEnlace(pagina);
    await pagina.click('#ytSyncBtn');
    const mensajes = [];
    const llego = await esperarListo(pagina, 30000, mensajes);
    comprobar('se ve el avance «Transcribiendo el audio: n de 3 partes»', mensajes.some((m) => /Transcribiendo el audio: \d de 3 partes/.test(m)));
    comprobar('el audio viaja en 3 partes', reg.subidas.length === 3, `${reg.subidas.length}`);
    comprobar('ninguna parte pasa de 3,4 MB (límite de Vercel ~4,5 MB)', reg.subidas.every((b) => b <= 3.4 * 1024 * 1024), reg.subidas.join(', '));
    comprobar('NINGUNA petición a video.twimg.com lleva Referer (X responde 403)', reg.conReferer.length === 0, reg.conReferer.slice(0, 3).join(' · '));
    comprobar('el doblaje queda listo', llego && /Listo/.test(await pagina.textContent('#ytSyncStatus')));
    const rep = await pagina.evaluate(() => {
      const f = document.getElementById('ytPlayer');
      const v = f?.contentDocument?.querySelector('video');
      return { tag: f?.tagName, src: f?.getAttribute('src') || '', dur: v ? v.duration : 0 };
    });
    comprobar('el video vive en el iframe /x-reproductor.html', rep.tag === 'IFRAME' && rep.src.endsWith('/x-reproductor.html'), JSON.stringify(rep));
    comprobar('y cargó (duración conocida)', rep.dur > 100, String(rep.dur));
    comprobar('el título dice de quién es el post', /@BrooklynNets/.test(await pagina.textContent('#ytSyncTitle')));
    const ttsAntes = reg.tts;
    await pagina.click('#ytDubReproducir');
    const t0 = await tiempoVideo(pagina);
    await esperar(3000);
    const t1 = await tiempoVideo(pagina);
    comprobar('«Ver con voz en español» arranca el video y avanza', t1 > t0 + 1, `${t0.toFixed(1)} → ${t1.toFixed(1)} s`);
    comprobar('y se pide la voz en español', reg.tts > ttsAntes || reg.tts > 0, `${reg.tts}`);
    comprobar('el motor de voz vive (jgDoblajeDiagnostico)', await pagina.evaluate(() => Boolean(window.jgDoblajeDiagnostico && window.jgDoblajeDiagnostico())));
    comprobar('sin errores de JavaScript', reg.errores.length === 0, reg.errores.join(' | '));

    // Reabrir el mismo post: sale de la caché, sin volver a transcribir
    await pagina.click('#btnYtSyncClose');
    await pegarEnlace(pagina);
    await pagina.click('#ytSyncBtn');
    const otraVez = await esperarListo(pagina, 20000);
    comprobar('reabrir el mismo post queda listo', otraVez);
    comprobar('y no vuelve a transcribir (caché x:<id>)', reg.subidas.length === 3, `${reg.subidas.length}`);
    await contexto.close();
  }

  console.log('\n── Cancelar a mitad de la transcripción ───────────────────────');
  {
    const { contexto, pagina, reg } = await abrir(navegador, { retrasoTranscribeMs: 3000 });
    await pegarEnlace(pagina);
    await pagina.click('#ytSyncBtn');
    const fin = Date.now() + 15000;
    while (reg.subidas.length < 1 && Date.now() < fin) await esperar(50);
    await pagina.click('#ytDubCancelar');
    await esperar(5000);
    comprobar('tras cancelar no se sube ni una parte más', reg.subidas.length === 1, `${reg.subidas.length}`);
    comprobar('y el formulario vuelve', await pagina.evaluate(() => document.getElementById('ytSyncArea').hidden));
    await contexto.close();
  }

  console.log('\n── Errores que se leen ────────────────────────────────────────');
  {
    const casos = [
      ['post privado o borrado', { status: 404, json: { detail: 'Ese post de X no existe, es privado o tiene restricción de edad.', code: 'no_disponible' } }, /no existe, es privado/],
      ['un GIF', { status: 422, json: { detail: 'Ese post de X es un GIF: no tiene sonido que doblar.', code: 'gif' } }, /GIF/],
    ];
    for (const [nombre, info, patron] of casos) {
      const { contexto, pagina } = await abrir(navegador, { info });
      await pegarEnlace(pagina);
      await pagina.click('#ytSyncBtn');
      const texto = await esperarMensaje(pagina, patron);
      comprobar(`${nombre}: el motivo se lee y se ofrece «Volver»`, patron.test(texto) && (await pagina.textContent('#ytDubCancelar')).includes('Volver'), texto);
      await contexto.close();
    }
    const { contexto, pagina, reg } = await abrir(navegador, { info: { status: 200, json: infoX({ duracion_s: 7200 }) } });
    await pegarEnlace(pagina);
    await pagina.click('#ytSyncBtn');
    const texto = await esperarMensaje(pagina, /hasta 60 min/);
    comprobar('un video de 2 h se rechaza con el límite a la vista y sin bajar audio', /hasta 60 min/.test(texto) && reg.listas === 0, `${texto} · listas ${reg.listas}`);
    await contexto.close();
  }

  console.log('\n── Teléfono ───────────────────────────────────────────────────');
  {
    const { contexto, pagina } = await abrir(navegador, { movil: true });
    await pegarEnlace(pagina);
    const alto = await pagina.evaluate(() => document.getElementById('ytSyncBtn').getBoundingClientRect().height);
    comprobar('el botón de doblar mide al menos 44 px de alto', alto >= 44, `${alto} px`);
    await pagina.click('#ytSyncBtn');
    await esperarListo(pagina);
    const desborde = await pagina.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    comprobar('sin desborde horizontal con el reproductor de X', desborde <= 0, `${desborde} px`);
    await contexto.close();
  }
} finally {
  await navegador.close();
  servidor.close();
}

console.log(`\n${ok} comprobaciones OK · ${fallos.length} fallos`);
if (fallos.length) { console.log(fallos.map((f) => `   · ${f}`).join('\n')); process.exit(1); }
