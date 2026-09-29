import { readFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { mkdtempSync, rmSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createServer } from 'node:http';
const raiz = resolve(import.meta.dirname, '..');
let chromium;
for (const ruta of ['node_modules', '../node_modules', '../JG Turbo_OLD/node_modules', '../../node_modules', '../../../node_modules', '../../../JG Turbo_OLD/node_modules']) {
  try { ({ chromium } = await import(pathToFileURL(resolve(raiz, ruta, 'playwright/index.mjs')))); break; } catch { /* siguiente */ }
}
if (!chromium) throw new Error('Playwright no encontrado');
const extension = resolve(raiz, 'extension-udemy');
const perfil = mkdtempSync(resolve(tmpdir(), 'jg-udemy-prueba-'));
const cacheNavegadores = resolve(process.env.LOCALAPPDATA, 'ms-playwright');
const ejecutable = existsSync(chromium.executablePath()) ? chromium.executablePath()
  : readdirSync(cacheNavegadores).filter((n) => /^chromium-\d+$/.test(n)).sort().reverse()
    .map((n) => resolve(cacheNavegadores, n, 'chrome-win64/chrome.exe')).find(existsSync);
if (!ejecutable) throw new Error('No hay Chromium instalado para esta prueba.');
const contexto = await chromium.launchPersistentContext(perfil, { headless: true, executablePath: ejecutable, args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`] });
contexto.setDefaultTimeout(10000);
let ok = 0;
const comprobar = (c, m) => { if (!c) throw new Error(`FALLO: ${m}`); ok++; console.log(`OK: ${m}`); };
const cuerpos = [];
let peticionesApi = 0, demorar = false, canceladas = 0, vozFalla = false;
let vozReal;
const servidor = createServer(async (q, r) => {
  peticionesApi++;
  r.setHeader('Access-Control-Allow-Origin', '*');
  r.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (q.method === 'OPTIONS') { r.writeHead(204).end(); return; }
  let texto = ''; for await (const pieza of q) texto += pieza;
  if (texto) cuerpos.push(JSON.parse(texto));
  if (q.url === '/api/health') { r.setHeader('Content-Type', 'application/json'); r.end(JSON.stringify({ ai_provider_server: 'gemini' })); }
  else if (q.url === '/api/translate') {
    r.setHeader('Content-Type', 'application/json');
    const datos = JSON.parse(texto);
    const contestar = () => r.end(JSON.stringify({ text: datos.text.replaceAll('Hello this is our first lesson today.', 'Hola esta es nuestra primera clase de hoy.').replaceAll('We are learning to build a useful project.', 'Estamos aprendiendo a crear un proyecto útil.'), ia_used: true }));
    if (demorar) { const reloj = setTimeout(contestar, 20000); r.on('close', () => { clearTimeout(reloj); if (!r.writableEnded) canceladas++; }); }
    else contestar();
  } else if (q.url === '/api/tts') {
    if (vozFalla) { r.writeHead(503, { 'Content-Type': 'application/json' }); r.end(JSON.stringify({ detail: 'La voz no está disponible' })); }
    else { r.setHeader('Content-Type', 'audio/mpeg'); r.setHeader('X-TTS-Engine', 'azure'); r.end(vozReal); }
  }
  else r.end('{}');
});
await new Promise((r) => servidor.listen(0, '127.0.0.1', r));
try {
  const worker = contexto.serviceWorkers()[0] || await contexto.waitForEvent('serviceworker');
  const webm = await readFile(resolve(raiz, 'tests/fixtures/x/video_prueba.webm'));
  vozReal = await readFile(resolve(raiz, 'tests/fixtures/biblioteca/voz_real_es.mp3'));
  await worker.evaluate((base) => chrome.storage.local.set({ jg_api_base: base }), `http://127.0.0.1:${servidor.address().port}/api`);
  let vttPeticiones = 0, udemyPeticiones = 0;
  const origenesVtt = [];
  const tiempo = (s) => `00:${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}.000`;
  const vtt = 'WEBVTT\n\n' + Array.from({ length: 20 }, (_, i) => `${tiempo(i * 3)} --> ${tiempo(i * 3 + 3)}\nHello this is our first lesson today.\n`).join('\n');
  const htmlClase = await readFile(resolve(raiz, 'tests/fixtures/udemy/clase.html'), 'utf8');
  await contexto.route('https://www.udemy.com/**', async (ruta) => {
    udemyPeticiones++;
    if (ruta.request().url().endsWith('video.webm')) return ruta.fulfill({ contentType: 'video/webm', body: webm });
    await ruta.fulfill({ contentType: 'text/html', body: htmlClase });
  });
  await contexto.route('https://*.udemycdn.com/**', async (ruta) => {
    vttPeticiones++;
    origenesVtt.push(ruta.request().headers().origin);
    await ruta.fulfill({ contentType: 'text/vtt', headers: { 'access-control-allow-origin': '*' }, body: vtt });
  });
  const pagina = await contexto.newPage();
  await pagina.goto('https://www.udemy.com/course/prueba/learn/lecture/123', { waitUntil: 'domcontentloaded' });
  const id = new URL(worker.url()).host;
  const tabId = await worker.evaluate(async () => (await chrome.tabs.query({ url: 'https://www.udemy.com/course/*' }))[0].id);
  const panel = await contexto.newPage();
  await panel.goto(`chrome-extension://${id}/panel.html?tab=${tabId}${process.argv.includes('--puente') ? '&soloDiagnostico=1' : ''}`);
  if (!process.argv.includes('--puente')) {
    await panel.waitForFunction(() => !document.getElementById('doblar').disabled);
    await pagina.reload({ waitUntil: 'load' });
    await panel.waitForFunction(() => !document.getElementById('doblar').disabled, null, { timeout: 10000 });
    comprobar(true, 'recargar la clase con panel abierto recupera conexion y habilita Doblar');
    await panel.evaluate(() => {
      globalThis.audiosProbados = new Set();
      const play = HTMLMediaElement.prototype.play;
      HTMLMediaElement.prototype.play = function() { if (this instanceof HTMLAudioElement) audiosProbados.add(this); return play.call(this); };
    });
    const udemyInicial = udemyPeticiones;
    await pagina.locator('video').evaluate((v) => v.play());
    await panel.getByRole('button', { name: 'Doblar al español' }).click();
    await panel.waitForFunction(() => document.getElementById('estado').textContent.includes('Listo'), null, { timeout: 20000 });
    comprobar(true, 'panel prepara voz con el motor copiado');
    await panel.waitForFunction(() => document.getElementById('actual').textContent.startsWith('Hola'), null, { timeout: 10000 });
    comprobar(true, 'linea actual muestra el español');
    await panel.waitForFunction(() => [...audiosProbados].some((a) => !a.paused && a.currentTime > .1));
    comprobar(await panel.evaluate(() => audiosProbados.size === 2), 'dos audios distintos y voz reproduciendose');
    await panel.setViewportSize({ width: 400, height: 1000 });
    comprobar(await panel.evaluate(() => document.documentElement.scrollWidth <= innerWidth
      && [...document.querySelectorAll('button,select,input[type=range],.interruptor')].filter((e) => e.getClientRects().length).every((e) => e.getBoundingClientRect().height >= 44)), 'panel sin desborde y controles de 44 px');
    await mkdir(resolve(raiz, 'tmp'), { recursive: true });
    await panel.screenshot({ path: resolve(raiz, 'tmp/panel-udemy.png'), fullPage: true });
    comprobar(cuerpos.some((c) => c.voice === 'female' && c.idioma_fijo === true), 'voz neural del contrato');
    comprobar(cuerpos.every((c) => !/udemy|lecture|123/.test(JSON.stringify(c))), 'API recibe texto sin URL ni id de clase');
    await pagina.locator('video').evaluate((v) => v.pause());
    await pagina.locator('[data-jg-subtitulo]').waitFor();
    comprobar(await pagina.locator('[data-jg-subtitulo]').evaluate((h) => h.shadowRoot === null && getComputedStyle(h).pointerEvents === 'none'), 'subtitulo aislado y no roba clics');
    await panel.locator('#subtitulo').uncheck();
    await pagina.waitForFunction(() => !document.querySelector('[data-jg-subtitulo]'));
    comprobar(true, 'apagar subtitulo retira host');
    await panel.locator('#subtitulo').check();
    await pagina.bringToFront();
    await pagina.getByRole('button', { name: 'Pantalla completa', exact: true }).click();
    await pagina.waitForFunction(() => document.fullscreenElement?.contains(document.querySelector('[data-jg-subtitulo]')));
    comprobar(true, 'subtitulo dentro de pantalla completa');
    await pagina.evaluate(() => document.exitFullscreen());
    await panel.getByRole('button', { name: 'Detener', exact: true }).click();
    await pagina.waitForFunction(() => document.querySelector('video').volume === .73);
    comprobar(await pagina.locator('video').evaluate((v) => !v.muted && v.playbackRate === 1), 'detener panel restaura volumen silencio y velocidad');
    comprobar(await pagina.locator('[data-jg-subtitulo]').count() === 0, 'detener retira subtitulo');
    comprobar(udemyPeticiones === udemyInicial, 'cero peticiones propias del doblaje a Udemy');
    comprobar(vttPeticiones === 3, 'dos cargas de pagina y solo una peticion extra VTT en la clase');
    comprobar(origenesVtt.every((origen) => origen === 'https://www.udemy.com'), 'VTT se pide desde el origen de la pagina');

    await panel.getByRole('button', { name: 'Doblar al español' }).click();
    await panel.waitForFunction(() => document.getElementById('estado').textContent.includes('Listo'), null, { timeout: 20000 });
    await pagina.evaluate(() => {
      history.pushState({}, '', '/course/prueba/learn/lecture/456');
      const previo = document.querySelector('video'); const nuevo = previo.cloneNode(true);
      nuevo.volume = .61; nuevo.muted = true; nuevo.playbackRate = 1.25; previo.replaceWith(nuevo);
      fetch('https://p.udemycdn.com/ingles/en_US/segunda.vtt?firma=secreto');
    });
    await panel.waitForFunction(() => document.getElementById('estado').textContent.includes('Nueva clase'));
    await panel.waitForTimeout(350);
    const antesPlay = peticionesApi;
    await panel.waitForTimeout(500);
    comprobar(peticionesApi === antesPlay && await pagina.locator('video').evaluate((v) => v.paused), 'nueva clase no se prepara ni reproduce antes del play de la persona');
    await pagina.locator('video').evaluate((v) => v.play());
    try { await panel.waitForFunction(() => document.getElementById('estado').textContent.includes('Listo'), null, { timeout: 20000 }); }
    catch (error) { console.log('Estado segunda clase:', await panel.locator('#estado').textContent()); console.log('Diagnostico:', await panel.evaluate(() => jgDoblajeDiagnostico())); throw error; }
    comprobar(true, 'siguiente clase se dobla tras play');
    await panel.close();
    await pagina.waitForFunction(() => document.querySelector('video').volume === .61 && document.querySelector('video').muted && document.querySelector('video').playbackRate === 1.25);
    comprobar(true, 'cerrar panel restaura tambien silencio y velocidad originales de la nueva clase');
    comprobar(await pagina.locator('[data-jg-subtitulo]').count() === 0, 'cerrar retira subtitulo');
    comprobar(vttPeticiones === 5, 'segunda clase tambien tiene una sola peticion extra VTT');

    async function abrirCaso(parametro) {
      const clase = await contexto.newPage();
      await clase.goto(`https://www.udemy.com/course/caso/learn/lecture/789?${parametro}`, { waitUntil: 'domcontentloaded' });
      const tab = await worker.evaluate(async () => (await chrome.tabs.query({ url: 'https://www.udemy.com/course/caso/*' })).at(-1).id);
      const consola = await contexto.newPage();
      await consola.goto(`chrome-extension://${id}/panel.html?tab=${tab}`);
      return { clase, consola };
    }
    const sinIngles = await abrirCaso('sin_ingles=1');
    const antesIngles = peticionesApi;
    await sinIngles.consola.getByRole('button', { name: 'Doblar al español' }).click();
    await sinIngles.consola.waitForFunction(() => document.getElementById('estado').textContent.includes('subtítulos en inglés'));
    comprobar(peticionesApi === antesIngles, 'sin ingles hay aviso visible y ninguna llamada API');
    await sinIngles.consola.close(); await sinIngles.clase.close();

    const rechazo = await abrirCaso('rechaza_tasa=1');
    await rechazo.clase.locator('video').evaluate((v) => v.play());
    await rechazo.consola.getByRole('button', { name: 'Doblar al español' }).click();
    try { await rechazo.consola.waitForFunction(() => document.getElementById('estado').textContent.includes('Udemy no deja cambiar'), null, { timeout: 15000 }); }
    catch (error) { console.log('Estado rechazo:', await rechazo.consola.locator('#estado').textContent()); console.log('Tasas pedidas:', await rechazo.clase.evaluate(() => pedidosTasa)); console.log('Voz:', await rechazo.consola.evaluate(() => jgDoblajeDiagnostico())); throw error; }
    comprobar(!await rechazo.consola.locator('#ritmoAuto').isChecked(), 'velocidad revertida apaga ritmo con aviso');
    const tasasAntes = await rechazo.clase.evaluate(() => pedidosTasa.length);
    await rechazo.consola.waitForTimeout(2500);
    comprobar(await rechazo.clase.evaluate(() => pedidosTasa.length) === tasasAntes, 'no insiste con ordenes de velocidad');
    await rechazo.consola.close(); await rechazo.clase.close();

    demorar = true;
    const cancelacion = await abrirCaso('cancelar=1');
    await cancelacion.consola.getByRole('button', { name: 'Doblar al español' }).click();
    await cancelacion.consola.waitForTimeout(400);
    await cancelacion.consola.getByRole('button', { name: 'Detener', exact: true }).click();
    await cancelacion.consola.waitForTimeout(400);
    comprobar(canceladas > 0, 'cancelar aborta la peticion de traduccion en curso');
    comprobar(await cancelacion.clase.locator('video').evaluate((v) => v.volume === .73 && v.paused), 'cancelar preparacion conserva video sin reproducir');
    await cancelacion.consola.close(); await cancelacion.clase.close(); demorar = false;

    vozFalla = true;
    const falloVoz = await abrirCaso('voz_falla=1');
    await falloVoz.consola.getByRole('button', { name: 'Doblar al español' }).click();
    await falloVoz.consola.waitForFunction(() => document.getElementById('estado').textContent.includes('voz no se pudo preparar'), null, { timeout: 15000 });
    comprobar(true, 'error de voz visible en lenguaje simple');
    await falloVoz.consola.getByRole('button', { name: 'Detener', exact: true }).click();
    await falloVoz.consola.close(); await falloVoz.clase.close(); vozFalla = false;
    comprobar(cuerpos.every((c) => !/udemy|lecture|789|456/.test(JSON.stringify(c))), 'ningun caso envia datos de Udemy al servidor');
  } else {
  await panel.evaluate((tab) => {
    globalThis.mensajes = [];
    globalThis.puertoPrueba = chrome.tabs.connect(tab, { name: 'jgUdemy' });
    puertoPrueba.onMessage.addListener((m) => mensajes.push(m));
  }, tabId);
  await panel.waitForFunction(() => mensajes.some((m) => m.tipo === 'estado'), { timeout: 5000 });
  comprobar(true, 'el puente informa el estado');
  await panel.evaluate(() => puertoPrueba.postMessage({ tipo: 'leerSubtitulos', solicitud: 1 }));
  await panel.waitForFunction(() => mensajes.some((m) => m.tipo === 'subtitulos'), { timeout: 5000 });
  const respuesta = await panel.evaluate(() => mensajes.find((m) => m.tipo === 'subtitulos'));
  comprobar(respuesta.idioma === 'en' && respuesta.textoVtt.includes('Hello'), 'lee VTT observado en ingles');
  await panel.evaluate(() => puertoPrueba.postMessage({ tipo: 'leerSubtitulos', solicitud: 2 }));
  await panel.waitForFunction(() => mensajes.some((m) => m.solicitud === 2), { timeout: 5000 });
  comprobar(vttPeticiones === 2, 'una sola peticion extra de subtitulos');
  const original = await pagina.locator('video').evaluate((v) => [v.volume, v.muted, v.playbackRate]);
  const solicitudesUdemy = udemyPeticiones;
  await panel.evaluate(() => {
    puertoPrueba.postMessage({ tipo: 'orden', accion: 'volumen', valor: .12 });
    puertoPrueba.postMessage({ tipo: 'orden', accion: 'silencio', valor: true });
    puertoPrueba.postMessage({ tipo: 'orden', accion: 'velocidad', valor: .8 });
  });
  await pagina.waitForFunction(() => document.querySelector('video').volume === .12);
  comprobar(await pagina.locator('video').evaluate((v) => v.muted && v.playbackRate === .8), 'ordenes solo sobre el video');
  await panel.evaluate(() => puertoPrueba.postMessage({ tipo: 'restaurar' }));
  await pagina.waitForFunction(() => document.querySelector('video').volume === .73);
  comprobar(JSON.stringify(await pagina.locator('video').evaluate((v) => [v.volume, v.muted, v.playbackRate])) === JSON.stringify(original), 'detener restaura valores exactos');
  await panel.evaluate(() => puertoPrueba.postMessage({ tipo: 'orden', accion: 'volumen', valor: .1 }));
  await pagina.waitForFunction(() => document.querySelector('video').volume === .1);
  await panel.close();
  await pagina.waitForFunction(() => document.querySelector('video').volume === .73);
  comprobar(JSON.stringify(await pagina.locator('video').evaluate((v) => [v.volume, v.muted, v.playbackRate])) === JSON.stringify(original), 'cerrar panel restaura valores exactos');
  comprobar(udemyPeticiones === solicitudesUdemy, 'cero peticiones propias a Udemy');
  }
} finally { await contexto.close(); await new Promise((r) => servidor.close(r)); if (resolve(perfil).startsWith(resolve(tmpdir()))) rmSync(perfil, { recursive: true, force: true }); }
console.log(`${ok} comprobaciones OK · 0 fallos`);
