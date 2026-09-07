/* Prueba de fundido cruzado (crossfade) en navegador headless
 *   node tests/test_pdf_musica_crossfade.mjs
 */
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
const base = `http://localhost:${puerto}`;

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();

await page.goto(base);
await page.waitForTimeout(500);

const resultado = await page.evaluate(async () => {
  const { musicaFondo, CATALOGO_PISTAS } = await import('/js/pdf/musicaFondo.js');

  // Iniciar módulo
  musicaFondo.inicializar();

  // Iniciar en concentración
  musicaFondo.setAnimo('concentracion');
  await new Promise(r => setTimeout(r, 600));

  const inicio = {
    canalActivo: musicaFondo.canalActivo,
    pistaId: musicaFondo.pistaId,
    estado: musicaFondo.estado,
    canalA_paused: musicaFondo.canalA.audio?.paused,
    canalB_paused: musicaFondo.canalB.audio?.paused,
  };

  // Disparar transición a siguiente pista (crossfade)
  const siguientePista = CATALOGO_PISTAS.find(p => p.id === 'concentracion_hypnotic_pulse');
  await musicaFondo.reproducirPista(siguientePista, { suave: true, fundidoCruzado: true });

  // A mitad del crossfade (después de 800ms) ambos canales deben estar activos
  await new Promise(r => setTimeout(r, 800));
  const enTransicion = {
    estaTransicionando: musicaFondo.estaTransicionando,
    canalA_paused: musicaFondo.canalA.audio?.paused,
    canalB_paused: musicaFondo.canalB.audio?.paused,
  };

  // Al finalizar el crossfade (después de 4000ms total)
  await new Promise(r => setTimeout(r, 3200));
  const finTransicion = {
    canalActivo: musicaFondo.canalActivo,
    pistaId: musicaFondo.pistaId,
    canalA_paused: musicaFondo.canalA.audio?.paused,
    canalB_paused: musicaFondo.canalB.audio?.paused,
  };

  musicaFondo.setActiva(false);

  return { inicio, enTransicion, finTransicion };
});

console.log('PRUEBA CROSSFADE:');
console.log('Inicio:', resultado.inicio);
console.log('En transición (ambos canales sonando en paralelo):', resultado.enTransicion);
console.log('Fin de transición (canal alternado y canal previo en pausa):', resultado.finTransicion);

await browser.close();
servidor.close();
