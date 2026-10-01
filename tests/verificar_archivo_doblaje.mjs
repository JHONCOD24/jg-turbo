/* JG Turbo · Doblar un video del equipo de punta a punta, SIN red ni créditos.
 *
 * /transcribe, /translate y /tts se responden desde aquí; Mediabunny, el
 * reproductor y la biblioteca son los reales. El video es un WebM (el Chromium
 * de Playwright no reproduce H.264). Mide lo que vive la persona: elegir el
 * archivo (o soltarlo, o traerlo de la pestaña Archivo), que solo viaje el audio
 * en partes pequeñas, que el video se vea y avance con la voz, que la biblioteca
 * lo guarde sin enlace, que reabrirlo pida el MISMO archivo y que los errores se lean.
 *
 *   node tests/verificar_archivo_doblaje.mjs
 *   node tests/verificar_archivo_doblaje.mjs --headed
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

const VIDEO = join(app, 'tests/fixtures/archivo/clase_en_40s.webm');
const OTRO = join(app, 'tests/fixtures/archivo/dos_pistas_40s.mkv');
const SIN_AUDIO = join(app, 'tests/fixtures/archivo/sin_audio_10s.webm');
const NOTA = join(app, 'tests/fixtures/biblioteca/voz_1s.mp3');
const SRT = join(app, 'tests/fixtures/archivo/clase_en_40s.srt');
const VTT = join(app, 'tests/fixtures/archivo/clase_en_40s.vtt');
const SRT_MALO = join(app, 'tests/fixtures/archivo/subtitulo_malo.srt');

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
const base = `http://127.0.0.1:${servidor.address().port}`;

let ok = 0;
const fallos = [];
function comprobar(nombre, condicion, detalle = '') {
  if (condicion) { ok += 1; console.log(`OK: ${nombre}`); }
  else { fallos.push(nombre); console.log(`FALLO: ${nombre}${detalle ? ` — ${detalle}` : ''}`); }
}
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

async function abrir(navegador, escenario = {}) {
  const contexto = escenario.contexto || (escenario.movil
    ? await navegador.newContext({ ...devices['Pixel 7'] })
    : await navegador.newContext({ viewport: { width: 1280, height: 800 } }));
  const pagina = await contexto.newPage();
  const reg = { subidas: [], tts: 0, errores: [] };
  pagina.on('pageerror', (e) => reg.errores.push(String(e).slice(0, 200)));
  const responder = (r, datos) => r.fulfill(datos).catch(() => {});
  await pagina.route(/\/(health|session-config|ping|glossary|tts-voices|tts-warmup)(\?|$)/, (r) => {
    const u = r.request().url();
    if (u.includes('/health')) return responder(r, { json: { status: 'ok', server: 'vercel', model: 'whisper-large-v3', model_state: 'listo', model_ready: true, ai_configured: true, groq_configured: true, ia_configured: true, youtube_auto: true, x_video: true, tts_azure: true, tts_fish: false } });
    if (u.includes('/session-config')) return responder(r, { json: { token: 'vercel-bypass', ai_provider: 'mistral', ai_configured: true, groq_configured: true, ia_configured: true, limits: {} } });
    return responder(r, { json: {} });
  });
  await pagina.route(/\/translate(\?|$)/, async (r) => {
    const cuerpo = JSON.parse(r.request().postData() || '{}');
    const piezas = [...String(cuerpo.text || '').matchAll(/\[\[JG_SEG_(\d{6})\]\]\n([^\[]*)/g)];
    await esperar(100);
    const text = piezas.length ? piezas.map((m) => `[[JG_SEG_${m[1]}]]\nES ${m[2].trim()}`).join('\n\n') : `ES ${cuerpo.text}`;
    await responder(r, { json: { text, ia_used: true, provider: 'mistral', validation: { status: 'ok', integrity_score: 100 } } });
  });
  await pagina.route(/\/tts(\?|$)/, async (r) => {
    const req = r.request();
    const datos = req.method() === 'GET' ? Object.fromEntries(new URL(req.url()).searchParams) : JSON.parse(req.postData() || '{}');
    reg.tts += 1;
    await esperar(80);
    await responder(r, { status: 200, contentType: 'audio/wav', headers: { 'X-TTS-Engine': 'azure-neural-regional', 'X-TTS-Voice': 'es-CO-SalomeNeural', 'X-TTS-Fallback': '0' }, body: wavSilencio(Math.max(0.6, String(datos.text || '').length / 16)) });
  });
  await pagina.route(/\/transcribe(\?|$)/, async (r) => {
    const cuerpo = r.request().postDataBuffer() || Buffer.alloc(0);
    const nombre = (cuerpo.toString('latin1').match(/filename="([^"]+)"/) || [])[1] || '';
    reg.subidas.push({ bytes: cuerpo.length, nombre });
    await esperar(escenario.retrasoTranscribeMs ?? 200);
    const segments = Array.from({ length: 6 }, (_, i) => ({ start: 1 + i * 6, end: 5 + i * 6, text: `Sentence number ${i + 1}.` }));
    await responder(r, { json: { text: 'x', language: 'en', segments } });
  });
  await pagina.goto(`${base}/?tab=${escenario.tab || 'yt'}`, { waitUntil: 'domcontentloaded' });
  await pagina.waitForSelector(escenario.tab === 'file' ? '#fileInput' : '#ytArchivo', { state: 'attached' });
  if (escenario.tab !== 'file') await pagina.waitForFunction(() => Boolean(window.jgVideoLocal), null, { timeout: 15000 });
  return { contexto, pagina, reg };
}

const listo = (pagina) => pagina.evaluate(() => {
  const r = document.getElementById('ytDubReproducir');
  if (r && !r.hidden && !r.disabled) return true;
  const b = document.getElementById('ytDubbingBtn');
  return Boolean(b && !b.disabled);
});
async function esperarListo(pagina, ms = 40000, mensajes = []) {
  const fin = Date.now() + ms;
  while (Date.now() < fin) {
    mensajes.push(await pagina.textContent('#ytDubMensaje').catch(() => ''));
    if (await listo(pagina)) return true;
    await esperar(100);
  }
  return false;
}
async function elegir(pagina, ruta) {
  await pagina.setInputFiles('#ytArchivo', ruta);
  await pagina.waitForFunction(() => !document.getElementById('ytSyncBtn').disabled, null, { timeout: 10000 }).catch(() => {});
}
const tiempoVideo = (pagina) => pagina.evaluate(() => document.getElementById('ytPlayer')?.contentDocument?.querySelector('video')?.currentTime ?? -1);
async function esperarTexto(pagina, selector, patron, ms = 15000) {
  const fin = Date.now() + ms;
  while (Date.now() < fin) {
    const texto = await pagina.textContent(selector).catch(() => '');
    if (patron.test(texto)) return texto;
    await esperar(100);
  }
  return await pagina.textContent(selector).catch(() => '');
}
const tarjeta = (pagina) => pagina.locator('.vid-tarjeta').filter({ hasText: 'Tu equipo' }).first();

const navegador = await chromium.launch({ headless: !process.argv.includes('--headed') });
try {
  console.log('\n── Elegir el archivo ──────────────────────────────────────────');
  {
    const { contexto, pagina } = await abrir(navegador);
    comprobar('se ve «Elegir un video de tu equipo»', await pagina.isVisible('#ytElegirArchivo'));
    await pagina.fill('#ytUrl', 'https://youtube.com/watch?v=dNWkwrqAkcM');
    await elegir(pagina, VIDEO);
    comprobar('al elegir un video se ve su ficha con el nombre', await pagina.isVisible('#ytFichaArchivo') && /clase_en_40s\.webm/.test(await pagina.textContent('#ytFichaNombre')));
    comprobar('el enlace pegado se borra (una sola fuente a la vez)', (await pagina.inputValue('#ytUrl')) === '');
    comprobar('y «Doblar al español» se habilita', !(await pagina.isDisabled('#ytSyncBtn')));
    await pagina.click('#ytFichaQuitar');
    comprobar('«Quitar» deshace la elección y apaga el botón', !(await pagina.isVisible('#ytFichaArchivo')) && await pagina.isDisabled('#ytSyncBtn'));
    await pagina.setInputFiles('#ytArchivo', NOTA);
    comprobar('un audio se rechaza diciendo adónde ir', /pestaña Archivo/.test(await pagina.textContent('#ytEquipoAviso')));
    await elegir(pagina, VIDEO);
    await pagina.fill('#ytUrl', 'https://youtube.com/watch?v=dNWkwrqAkcM');
    comprobar('pegar un enlace quita el archivo elegido', !(await pagina.isVisible('#ytFichaArchivo')));
    await contexto.close();
  }

  console.log('\n── Doblar, ver y guardar en la biblioteca ─────────────────────');
  {
    const contexto = await navegador.newContext({ viewport: { width: 1280, height: 800 } });
    const { pagina, reg } = await abrir(navegador, { contexto });
    await elegir(pagina, VIDEO);
    await pagina.click('#ytSyncBtn');
    const mensajes = [];
    const llego = await esperarListo(pagina, 40000, mensajes);
    comprobar('el doblaje queda listo', llego, mensajes.filter(Boolean).slice(-3).join(' | '));
    comprobar('se cuenta lo que pasará antes de esperar (partes, gratis, no sale del equipo)', /no sale de tu equipo/.test(await pagina.textContent('#ytDubAyuda')));
    comprobar('solo viaja el audio: 1 parte MP3 pequeña', reg.subidas.length === 1 && reg.subidas[0].nombre.endsWith('.mp3') && reg.subidas[0].bytes < 400000, JSON.stringify(reg.subidas));
    const rep = await pagina.evaluate(() => {
      const f = document.getElementById('ytPlayer');
      const v = f?.contentDocument?.querySelector('video');
      return { tag: f?.tagName, src: v?.src || '', dur: v ? v.duration : 0, titulo: f?.title };
    });
    comprobar('el video se ve en el reproductor de siempre, desde un blob: local', rep.tag === 'IFRAME' && rep.src.startsWith('blob:') && rep.dur > 30, JSON.stringify(rep));
    comprobar('el título sale del nombre del archivo', /Clase en 40s/.test(await pagina.textContent('#ytSyncTitle')));
    await pagina.click('#ytDubReproducir');
    const t0 = await tiempoVideo(pagina);
    await esperar(2500);
    const t1 = await tiempoVideo(pagina);
    comprobar('«Ver con voz en español» arranca el video y avanza', t1 > t0 + 1, `${t0.toFixed(1)} → ${t1.toFixed(1)} s`);
    comprobar('y se pide la voz en español', reg.tts > 0, String(reg.tts));
    comprobar('el motor de voz vive (jgDoblajeDiagnostico)', await pagina.evaluate(() => Boolean(window.jgDoblajeDiagnostico?.())));
    comprobar('sin diálogo hay botón «Aquí habla otra persona»', await pagina.isVisible('#ytOtraVoz'));
    const altoOtra = await pagina.evaluate(() => document.getElementById('ytOtraVoz').getBoundingClientRect().height);
    comprobar('«Aquí habla otra persona» mide al menos 44 px', altoOtra >= 44, `${altoOtra} px`);
    const ttsAntes = reg.tts;
    await pagina.click('#ytOtraVoz');
    comprobar('al tocarlo ofrece volver a la primera voz', /Volver a la primera voz/.test(await pagina.textContent('#ytOtraVoz')));
    await esperar(2500);
    const t2 = await tiempoVideo(pagina);
    comprobar('y el video sigue avanzando con la otra voz', t2 > t1 && reg.tts > ttsAntes, `${t1.toFixed(1)} → ${t2.toFixed(1)} s · tts ${reg.tts}`);
    await pagina.click('#ytOtraVoz');
    comprobar('al tocarlo de nuevo vuelve la primera voz', /Aquí habla otra persona/.test(await pagina.textContent('#ytOtraVoz')));

    await pagina.click('#btnYtSyncClose');
    await pagina.waitForSelector('.vid-tarjeta', { timeout: 10000 }).catch(() => {});
    const t = tarjeta(pagina);
    comprobar('la biblioteca guarda el video como «Tu equipo»', await t.count() === 1);
    comprobar('con una miniatura sacada del propio video', /^data:image\/jpeg/.test(await t.locator('img').getAttribute('src').catch(() => '') || ''));
    await t.locator('.vid-menu-btn').click();
    const items = await t.locator('[role="menuitem"]').allTextContents();
    comprobar('su menú no ofrece «Copiar enlace» ni «Abrir en…» (no tiene enlace)', !items.some((i) => /Copiar enlace|Abrir en/.test(i)), items.join(' · '));
    await t.locator('[data-accion="descargar"]').click();
    await esperarTexto(pagina, '#vidDescargaEstado', /Audio estimado/);
    const tiposVisibles = await pagina.$$eval('#vidDescargasDialogo [data-tipo]', (ls) => ls.filter((l) => !l.hidden).map((l) => l.dataset.tipo));
    comprobar('descargas: audio MP3 y video doblado MP4, nunca «original»', tiposVisibles.join() === 'mp3,mp4', tiposVisibles.join());
    await pagina.check('#vidDescargasDialogo input[value="mp4"]');
    comprobar('con el archivo a mano, el MP4 se ofrece con su tamaño', /Video doblado estimado/.test(await pagina.textContent('#vidDescargaEstado')) && await pagina.isHidden('#vidElegirOriginal'));
    await pagina.click('#vidDescargasCerrar');

    await t.locator('.vid-abrir').click();
    const otraVez = await esperarListo(pagina, 20000);
    comprobar('reabrir desde la biblioteca (mismo archivo en memoria) queda listo', otraVez);
    comprobar('y no vuelve a transcribir (caché archivo:<huella>)', reg.subidas.length === 1, String(reg.subidas.length));
    comprobar('sin errores de JavaScript', reg.errores.length === 0, reg.errores.join(' | '));
    await pagina.close();

    // Página nueva (como al volver otro día): el archivo ya no está en memoria.
    const nueva = await abrir(navegador, { contexto });
    const p2 = nueva.pagina;
    await p2.waitForSelector('.vid-tarjeta', { timeout: 10000 }).catch(() => {});
    await tarjeta(p2).locator('.vid-menu-btn').click();
    await tarjeta(p2).locator('[data-accion="descargar"]').click();
    await esperarTexto(p2, '#vidDescargaEstado', /Audio estimado/);
    await p2.check('#vidDescargasDialogo input[value="mp4"]');
    comprobar('sin el archivo, el MP4 pide «Elegir el video original» y no deja descargar', await p2.isVisible('#vidElegirOriginal') && await p2.isDisabled('#vidDescargar'));
    const [selectorMp4] = await Promise.all([p2.waitForEvent('filechooser'), p2.click('#vidElegirOriginal')]);
    await selectorMp4.setFiles(VIDEO);
    await esperarTexto(p2, '#vidDescargaEstado', /Video doblado estimado/, 5000);
    comprobar('al elegir el MISMO archivo, el MP4 queda disponible', await p2.isHidden('#vidElegirOriginal') && !(await p2.isDisabled('#vidDescargar')));
    await p2.click('#vidDescargasCerrar');
    await p2.close();

    const tercera = await abrir(navegador, { contexto });
    const p3 = tercera.pagina;
    await p3.waitForSelector('.vid-tarjeta', { timeout: 10000 }).catch(() => {});
    const [selector] = await Promise.all([p3.waitForEvent('filechooser'), tarjeta(p3).locator('.vid-abrir').click()]);
    comprobar('abrir la tarjeta pide el archivo y explica por qué', /Elige otra vez «clase_en_40s\.webm»/.test(await p3.textContent('#vidAviso')));
    await selector.setFiles(OTRO);
    comprobar('si eligen OTRO archivo, se dice claro y no se dobla', /no es «clase_en_40s\.webm»/.test(await esperarTexto(p3, '#vidAviso', /no es/)) && tercera.reg.subidas.length === 0);
    const [otraVezSelector] = await Promise.all([p3.waitForEvent('filechooser'), tarjeta(p3).locator('.vid-abrir').click()]);
    await otraVezSelector.setFiles(VIDEO);
    comprobar('con el MISMO archivo abre listo y sin transcribir de nuevo', await esperarListo(p3, 20000) && tercera.reg.subidas.length === 0, String(tercera.reg.subidas.length));
    await contexto.close();
  }

  console.log('\n── Con subtítulos propios (.srt/.vtt) ─────────────────────────');
  {
    const { contexto, pagina, reg } = await abrir(navegador);
    await elegir(pagina, VIDEO);
    comprobar('al elegir el video se ofrece agregar subtítulos', await pagina.isVisible('#ytSrt'));
    await pagina.setInputFiles('#ytSubtitulo', SRT);
    await pagina.waitForSelector('#ytSrtFicha:not([hidden])', { timeout: 10000 }).catch(() => {});
    comprobar('el .srt elegido muestra sus frases', /5 frases/.test(await pagina.textContent('#ytSrtDatos')));
    await pagina.click('#ytSyncBtn');
    await pagina.waitForSelector('#ytLangConfirm:not([hidden])', { timeout: 15000 }).catch(() => {});
    comprobar('sin idioma en el formulario, pregunta el de los subtítulos', await pagina.isVisible('#ytLangConfirm'));
    await pagina.click('#ytLangConfirmYes');
    const mensajes = [];
    const llego = await esperarListo(pagina, 40000, mensajes);
    comprobar('con .srt queda listo', llego, mensajes.filter(Boolean).slice(-3).join(' | '));
    comprobar('y no se transcribe nada (0 partes a Whisper)', reg.subidas.length === 0, String(reg.subidas.length));
    comprobar('con marcas >>, la segunda voz se ofrece sola', await pagina.isVisible('#ytVoz2Wrap'));
    await pagina.click('#ytDubReproducir');
    const s0 = await tiempoVideo(pagina);
    await esperar(2500);
    comprobar('la voz en español avanza sobre el texto exacto', (await tiempoVideo(pagina)) > s0 && reg.tts > 0, String(reg.tts));
    comprobar('sin errores de JavaScript', reg.errores.length === 0, reg.errores.join(' | '));
    await contexto.close();
  }
  {
    const { contexto, pagina } = await abrir(navegador);
    await elegir(pagina, VIDEO);
    await pagina.setInputFiles('#ytSubtitulo', SRT_MALO);
    await esperar(500);
    comprobar('un .srt sin tiempos se rechaza con motivo visible', /frases/.test(await pagina.textContent('#ytEquipoAviso')));
    comprobar('y el video sigue elegido (va por Whisper)', await pagina.isVisible('#ytFichaArchivo'));
    await pagina.setInputFiles('#ytSubtitulo', VTT);
    await pagina.waitForSelector('#ytSrtFicha:not([hidden])', { timeout: 10000 }).catch(() => {});
    comprobar('el .vtt también se acepta', /3 frases/.test(await pagina.textContent('#ytSrtDatos')));
    await contexto.close();
  }

  console.log('\n── Errores y cancelar ─────────────────────────────────────────');
  {
    const { contexto, pagina, reg } = await abrir(navegador);
    await elegir(pagina, SIN_AUDIO);
    await pagina.click('#ytSyncBtn');
    const texto = await esperarTexto(pagina, '#ytDubMensaje', /no tiene sonido/);
    comprobar('un video sin sonido: el motivo se lee y se ofrece «Volver»', /no tiene sonido/.test(texto) && (await pagina.textContent('#ytDubCancelar')).includes('Volver'), texto);
    comprobar('y no se sube nada', reg.subidas.length === 0);
    await contexto.close();
  }
  {
    const { contexto, pagina, reg } = await abrir(navegador, { retrasoTranscribeMs: 4000 });
    await elegir(pagina, VIDEO);
    await pagina.click('#ytSyncBtn');
    const fin = Date.now() + 15000;
    while (reg.subidas.length < 1 && Date.now() < fin) await esperar(50);
    await pagina.click('#ytDubCancelar');
    await esperar(1500);
    comprobar('cancelar a mitad devuelve el formulario', await pagina.evaluate(() => document.getElementById('ytSyncArea').hidden));
    comprobar('y no hay errores de JavaScript', reg.errores.length === 0, reg.errores.join(' | '));
    await contexto.close();
  }

  console.log('\n── Desde la pestaña Archivo (y lo compartido del celular) ─────');
  {
    const { contexto, pagina } = await abrir(navegador, { tab: 'file' });
    await pagina.setInputFiles('#fileInput', VIDEO);
    comprobar('un video en Archivo ofrece «Doblar este video al español»', await pagina.isVisible('#btnFileDoblarVideo'));
    await pagina.click('#btnFileDoblarVideo');
    await pagina.waitForSelector('#ytFichaArchivo:not([hidden])', { timeout: 15000 }).catch(() => {});
    comprobar('lleva a Videos con el archivo ya elegido', await pagina.isVisible('#panelYt') && /clase_en_40s/.test(await pagina.textContent('#ytFichaNombre')));
    await contexto.close();
  }

  console.log('\n── Teléfono ───────────────────────────────────────────────────');
  {
    const { contexto, pagina } = await abrir(navegador, { movil: true });
    const alto = await pagina.evaluate(() => document.getElementById('ytElegirArchivo').getBoundingClientRect().height);
    comprobar('«Elegir un video de tu equipo» mide al menos 44 px', alto >= 44, `${alto} px`);
    await elegir(pagina, VIDEO);
    const quitar = await pagina.evaluate(() => document.getElementById('ytFichaQuitar').getBoundingClientRect().height);
    comprobar('«Quitar» mide al menos 44 px', quitar >= 44, `${quitar} px`);
    let desborde = await pagina.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    comprobar('sin desborde horizontal con la ficha del archivo', desborde <= 0, `${desborde} px`);
    await pagina.click('#ytSyncBtn');
    await esperarListo(pagina);
    desborde = await pagina.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    comprobar('sin desborde horizontal con el video doblando', desborde <= 0, `${desborde} px`);
    await contexto.close();
  }
} finally {
  await navegador.close();
  servidor.close();
}

console.log(`\n${ok} comprobaciones OK · ${fallos.length} fallos`);
if (fallos.length) process.exit(1);
