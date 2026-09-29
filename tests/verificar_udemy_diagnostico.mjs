import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

const raiz = resolve(import.meta.dirname, '..');
const candidatos = [
  resolve(raiz, 'node_modules/playwright/index.mjs'),
  resolve(raiz, '../node_modules/playwright/index.mjs'),
  resolve(raiz, '../JG Turbo_OLD/node_modules/playwright/index.mjs'),
];
let chromium;
for (const ruta of candidatos) {
  try { ({ chromium } = await import(pathToFileURL(ruta).href)); break; } catch { /* siguiente */ }
}
if (!chromium) throw new Error('Playwright no encontrado.');

const extension = resolve(raiz, 'extension-udemy');
const perfil = mkdtempSync(resolve(tmpdir(), 'jg-udemy-diagnostico-'));
let contexto;
let ok = 0;
let fallos = 0;
function comprobar(condicion, mensaje) {
  if (condicion) { ok++; console.log(`OK: ${mensaje}`); }
  else { fallos++; console.error(`FALLO: ${mensaje}`); }
}

try {
  contexto = await chromium.launchPersistentContext(perfil, {
    headless: true,
    channel: 'chromium',
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
  });
  await contexto.route('https://www.udemy.com/**', async (ruta) => {
    await ruta.fulfill({ contentType: 'text/html', body: `<!doctype html>
      <h1 data-purpose="lecture-title">Clase de prueba</h1>
      <div data-purpose="transcript-panel"><p data-purpose="transcript-line">Hello</p></div>
      <iframe src="about:blank"></iframe><video controls></video>
      <script>
        const pista = document.querySelector('video').addTextTrack('subtitles', 'English', 'en');
        pista.addCue(new VTTCue(0, 4, 'Hello'));
        document.querySelector('iframe').contentDocument.body.innerHTML = '<video></video>';
      </script>` });
  });
  await contexto.route('https://*.udemycdn.com/**', async (ruta) => {
    await ruta.fulfill({ contentType: 'text/vtt', headers: { 'access-control-allow-origin': '*' }, body: 'WEBVTT\n\n00:00:00.000 --> 00:00:04.000\nHello\n' });
  });
  const pagina = await contexto.newPage();
  await pagina.goto('https://www.udemy.com/course/prueba/learn/lecture/123');
  const modoOriginal = await pagina.locator('video').evaluate((v) => v.textTracks[0].mode);
  const trabajador = contexto.serviceWorkers()[0] || await contexto.waitForEvent('serviceworker');
  const extensionId = new URL(trabajador.url()).host;
  const tabId = await trabajador.evaluate(async () => {
    const [tab] = await chrome.tabs.query({ url: 'https://www.udemy.com/course/*' });
    return tab?.id;
  });
  comprobar(Number.isInteger(tabId), 'la extension identifica la clase falsa');
  const panel = await contexto.newPage();
  await panel.goto(`chrome-extension://${extensionId}/panel.html?tab=${tabId}`);
  await panel.getByRole('button', { name: 'Diagnóstico de esta clase' }).click();
  await panel.getByText('Diagnóstico listo.').waitFor({ timeout: 10000 });
  const dato = JSON.parse(await panel.locator('#resultado').textContent());
  comprobar(dato.videos.documentoPrincipal === 1 && dato.videos.enIframeAccesible === 1
    && dato.videos.iframes === 1 && dato.videos.iframesSinAcceso === 0, 'cuenta videos del documento y marco accesible');
  comprobar(dato.textTracks?.[0]?.cues === 1 && dato.textTracks[0].language === 'en', 'cuenta la pista en ingles');
  comprobar(dato.textTracks[0].mode === modoOriginal, 'informa el modo original');
  comprobar(await pagina.locator('video').evaluate((v) => v.textTracks[0].mode) === modoOriginal, 'restaura el modo original');
  comprobar(dato.transcripcion.panel && dato.transcripcion.lineas === 1, 'detecta la transcripcion');
  comprobar(dato.titulo === 'Clase de prueba', 'lee el titulo de la clase');
  comprobar(!JSON.stringify(dato).includes('lecture/123'), 'no incluye la direccion de la clase');

  await pagina.evaluate(() => fetch('https://p.udemycdn.com/subtitles/987654/english.vtt?signature=secreto'));
  await pagina.waitForTimeout(500);
  await panel.getByRole('button', { name: 'Diagnóstico de esta clase' }).click();
  await panel.getByText('Diagnóstico listo.').waitFor({ timeout: 10000 });
  const conVtt = JSON.parse(await panel.locator('#resultado').textContent());
  comprobar(conVtt.vttObservado?.host === 'p.udemycdn.com', 'observa el VTT que cargo el reproductor');
  comprobar(!JSON.stringify(conVtt).includes('signature') && !JSON.stringify(conVtt).includes('987654'), 'oculta firma e identificadores del VTT');
} finally {
  await contexto?.close();
  const destino = resolve(perfil);
  if (destino.startsWith(resolve(tmpdir()) + sep)) rmSync(destino, { recursive: true, force: true });
}
console.log(`\n${ok} comprobaciones OK · ${fallos} fallos`);
if (fallos) process.exitCode = 1;
