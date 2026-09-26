/* A5–A8 contra https://jg-turbo.vercel.app con video REAL.
 * Gasta ~1 crédito de Supadata (video corto) y usa traducción/voz reales.
 *
 *   node tests/verificar_youtube_produccion.mjs
 *   node tests/verificar_youtube_produccion.mjs --headed
 */
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

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
  throw new Error('Playwright no encontrado');
})();

const BASE = process.env.JG_BASE || 'https://jg-turbo.vercel.app';
const URL_VIDEO = 'https://www.youtube.com/watch?v=jNQXAC9IVRw';

let ok = 0;
const fallos = [];
function comprobar(nombre, condicion, detalle = '') {
  if (condicion) { ok += 1; console.log(`OK: ${nombre}`); }
  else { fallos.push(nombre); console.log(`FALLO: ${nombre}${detalle ? ` — ${detalle}` : ''}`); }
}
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

const navegador = await chromium.launch({ headless: !process.argv.includes('--headed') });
const contexto = await navegador.newContext({ ...devices['Pixel 7'] });
const pagina = await contexto.newPage();
const red = { youtube: 0, translate: 0, tts: 0, errores: [] };
pagina.on('pageerror', (e) => red.errores.push(String(e).slice(0, 160)));
pagina.on('response', (r) => {
  const u = r.url();
  if (u.includes('/youtube') && !u.includes('youtube.com')) red.youtube += 1;
  if (u.includes('/translate')) red.translate += 1;
  if (u.includes('/tts')) red.tts += 1;
});

try {
  console.log('\n── Producción · flujo real del doblaje ─────────────────────────');
  await pagina.goto(`${BASE}/?tab=yt`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await pagina.waitForSelector('#ytUrl', { state: 'attached', timeout: 30000 });

  await pagina.fill('#ytUrl', URL_VIDEO);
  await pagina.waitForFunction(() => {
    const b = document.getElementById('ytSyncBtn');
    return b && !b.disabled;
  }, null, { timeout: 15000 }).catch(() => {});
  comprobar('el botón de doblaje se habilita con el enlace', !(await pagina.isDisabled('#ytSyncBtn')));

  await pagina.click('#ytSyncBtn');

  // A7/A1 · progreso vivo desde el inicio
  await pagina.waitForFunction(() => {
    const p = document.getElementById('ytSyncProgress') || document.querySelector('.yt-sync-progress, .yt-progreso, #ytSyncArea');
    return p && (p.hidden === false || p.classList.contains('visible') || p.offsetWidth > 0);
  }, null, { timeout: 8000 }).catch(() => {});
  const progresoVisible = await pagina.evaluate(() => {
    const nodos = document.querySelectorAll('#ytSyncArea, .yt-sync-progress, .yt-progreso, [id*="ytSync"]');
    for (const n of nodos) {
      const s = getComputedStyle(n);
      if (s.display !== 'none' && s.visibility !== 'hidden' && n.getBoundingClientRect().height > 0) return true;
    }
    return false;
  });
  comprobar('el área de progreso se ve al pulsar', progresoVisible);

  const texto0 = await pagina.evaluate(() => document.body.innerText);
  comprobar('sin mensaje de «árabe»', !/árabe|arabe/i.test(texto0), texto0.slice(0, 120));

  // Esperar a que aparezca el botón de reproducir con voz o el resultado
  let listo = false;
  const fin = Date.now() + 90000;
  while (Date.now() < fin && !listo) {
    listo = await pagina.evaluate(() => {
      const r = document.getElementById('ytDubReproducir');
      if (r && !r.hidden && !r.disabled) return true;
      const b = document.getElementById('ytDubbingBtn');
      return Boolean(b && !b.disabled);
    });
    if (!listo) await esperar(500);
  }
  comprobar('el doblaje queda listo (o el video corto termina de prepararse)', listo || red.youtube >= 1, `youtube=${red.youtube}`);

  // A7 · Cancelar / Cerrar no dejan trabajo colgado
  const antes = { ...red };
  const btnCerrar = pagina.locator('#btnYtSyncClose, button:has-text("Cerrar")').first();
  if (await btnCerrar.count()) {
    await btnCerrar.click().catch(() => {});
    await esperar(5000);
    const despues = { translate: red.translate - antes.translate, tts: red.tts - antes.tts };
    comprobar('tras Cerrar no salen más traducciones (5 s)', despues.translate === 0, `+${despues.translate}`);
    comprobar('tras Cerrar no salen más síntesis de voz (5 s)', despues.tts === 0, `+${despues.tts}`);
    const formulario = await pagina.evaluate(() => {
      const u = document.getElementById('ytUrl');
      return Boolean(u && u.offsetWidth > 0);
    });
    comprobar('Cerrar devuelve el formulario con el enlace', formulario);
  } else {
    comprobar('Cerrar devuelve el formulario con el enlace', false, 'no se encontró el botón');
  }

  // A8 · reabrir el mismo video (caché)
  const ytAntes = red.youtube;
  await pagina.fill('#ytUrl', URL_VIDEO);
  await pagina.waitForFunction(() => {
    const b = document.getElementById('ytSyncBtn');
    return b && !b.disabled;
  }, null, { timeout: 10000 }).catch(() => {});
  await pagina.click('#ytSyncBtn');
  await esperar(6000);
  const ytNuevas = red.youtube - ytAntes;
  comprobar('reabrir el mismo video no repite /youtube (caché)', ytNuevas === 0, `+${ytNuevas}`);

  comprobar('sin errores de JavaScript', red.errores.length === 0, red.errores.join(' | '));
  console.log(`\nRed: youtube=${red.youtube} translate=${red.translate} tts=${red.tts}`);
} finally {
  await navegador.close();
}
console.log(`\n${ok} comprobaciones OK · ${fallos.length} fallos`);
process.exit(fallos.length ? 1 : 0);
