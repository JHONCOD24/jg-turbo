import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, join, extname } from 'node:path';
import { pathToFileURL } from 'node:url';

const app = resolve(import.meta.dirname, '..');
const candidatos = [
  resolve(app, 'node_modules/playwright/index.mjs'),
  resolve(app, '../node_modules/playwright/index.mjs'),
  resolve(app, '../JG Turbo_OLD/node_modules/playwright/index.mjs'),
];
let playwright;
for (const r of candidatos) {
  try { playwright = await import(pathToFileURL(r).href); break; } catch (_) {}
}
const { chromium } = playwright;

// Iniciar servidor local para probar los archivos modificados
const tipos = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.mp3': 'audio/mpeg',
  '.css': 'text/css'
};
const servidor = createServer(async (q, r) => {
  try {
    const p = new URL(q.url, 'http://localhost').pathname;
    const f = join(app, p === '/' ? 'index.html' : p);
    r.setHeader('Content-Type', tipos[extname(f)] || 'application/octet-stream');
    r.end(await readFile(f));
  } catch {
    r.writeHead(404).end();
  }
});
await new Promise(res => servidor.listen(0, res));
const puerto = servidor.address().port;
const base = process.env.JG_BASE || `http://localhost:${puerto}`;

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
page.on('console', msg => console.log('PAGE LOG:', msg.text()));
page.on('pageerror', err => console.log('PAGE ERROR:', err.message));

await page.goto(base);
await page.waitForTimeout(500);

const resultados = await page.evaluate(async () => {
  // 1. Activar pestaña PDF
  const tabPdf = document.getElementById('tabPdf');
  if (tabPdf) tabPdf.click();
  if (typeof window.jgAsegurarLectorPdf === 'function') {
    await window.jgAsegurarLectorPdf();
  }

  const { musicaFondo } = await import('/js/pdf/musicaFondo.js');

  // 2. Abrir hoja de música
  const btnMusica = document.getElementById('btnPdfMusica');
  btnMusica?.click();

  // 3. Pulsar en botón de Concentración
  const btnConc = document.querySelector('[data-animo="concentracion"]');
  btnConc?.click();

  // Esperar a que comience la reproducción
  await new Promise(r => setTimeout(r, 600));

  const paso1 = {
    activa: musicaFondo.activa,
    estado: musicaFondo.estado,
    pistaId: musicaFondo.pistaId,
    audioPaused: musicaFondo.audioEl?.paused,
    audioSrc: musicaFondo.audioEl?.src,
    audioVolume: musicaFondo.audioEl?.volume,
    volumenMusica: musicaFondo.volumenMusica,
    ctxState: musicaFondo.audioCtx?.state
  };

  // 4. Cambiar de pista dentro del ánimo
  const btnPista2 = document.querySelector('[data-pista="concentracion_hypnotic_pulse"]');
  btnPista2?.click();
  await new Promise(r => setTimeout(r, 600));

  const paso2 = {
    pistaId: musicaFondo.pistaId,
    audioPaused: musicaFondo.audioEl?.paused,
    audioSrc: musicaFondo.audioEl?.src,
    estado: musicaFondo.estado
  };

  // 5. Apagar música
  const btnApagado = document.querySelector('[data-animo="apagado"]');
  btnApagado?.click();
  await new Promise(r => setTimeout(r, 800));

  const paso3 = {
    activa: musicaFondo.activa,
    estado: musicaFondo.estado,
    audioPaused: musicaFondo.audioEl?.paused
  };

  return { paso1, paso2, paso3 };
});

console.log('RESULTADOS DE PRUEBA DE INTERACCION:');
console.log('Paso 1 (Tocar Concentración):', resultados.paso1);
console.log('Paso 2 (Tocar Pista 2):', resultados.paso2);
console.log('Paso 3 (Tocar Apagado):', resultados.paso3);

await browser.close();
servidor.close();
