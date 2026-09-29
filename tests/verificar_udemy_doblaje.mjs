import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
const raiz = resolve(import.meta.dirname, '..');
let chromium;
for (const ruta of ['node_modules', '../node_modules', '../JG Turbo_OLD/node_modules', '../../node_modules', '../../../node_modules', '../../../JG Turbo_OLD/node_modules']) {
  try { ({ chromium } = await import(pathToFileURL(resolve(raiz, ruta, 'playwright/index.mjs')))); break; } catch { /* siguiente */ }
}
if (!chromium) throw new Error('Playwright no encontrado');
const extension = resolve(raiz, 'extension-udemy');
const perfil = mkdtempSync(resolve(tmpdir(), 'jg-udemy-prueba-'));
const contexto = await chromium.launchPersistentContext(perfil, { headless: true, channel: 'chromium', args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`] });
contexto.setDefaultTimeout(10000);
let ok = 0;
const comprobar = (c, m) => { if (!c) throw new Error(`FALLO: ${m}`); ok++; console.log(`OK: ${m}`); };
try {
  const worker = contexto.serviceWorkers()[0] || await contexto.waitForEvent('serviceworker');
  const webm = await readFile(resolve(raiz, 'tests/fixtures/x/video_prueba.webm'));
  let vttPeticiones = 0, udemyPeticiones = 0;
  const vtt = 'WEBVTT\n\n00:00:00.000 --> 00:00:04.000\nHello this is our first lesson today.\n\n00:00:04.000 --> 00:00:08.000\nWe are learning to build a useful project.\n';
  await contexto.route('https://www.udemy.com/**', async (ruta) => {
    udemyPeticiones++;
    if (ruta.request().url().endsWith('video.webm')) return ruta.fulfill({ contentType: 'video/webm', body: webm });
    await ruta.fulfill({ contentType: 'text/html', body: `<!doctype html><h1 data-purpose="lecture-title">Clase de prueba</h1><div style="position:relative;width:640px"><video controls width="640" src="/video.webm"></video></div><script>const v=document.querySelector('video');v.volume=.73;fetch('https://p.udemycdn.com/ingles/en_US/clase.vtt?firma=secreto');</script>` });
  });
  await contexto.route('https://*.udemycdn.com/**', async (ruta) => {
    vttPeticiones++;
    await ruta.fulfill({ contentType: 'text/vtt', headers: { 'access-control-allow-origin': '*' }, body: vtt });
  });
  const pagina = await contexto.newPage();
  await pagina.goto('https://www.udemy.com/course/prueba/learn/lecture/123', { waitUntil: 'domcontentloaded' });
  const id = new URL(worker.url()).host;
  const tabId = await worker.evaluate(async () => (await chrome.tabs.query({ url: 'https://www.udemy.com/course/*' }))[0].id);
  const panel = await contexto.newPage();
  await panel.goto(`chrome-extension://${id}/panel.html?tab=${tabId}`);
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
} finally { await contexto.close(); if (resolve(perfil).startsWith(resolve(tmpdir()))) rmSync(perfil, { recursive: true, force: true }); }
console.log(`${ok} comprobaciones OK · 0 fallos`);
