/* JG Turbo · Medición de rendimiento y fluidez (Fase B)
 *
 * Mide:
 * 1. Latencia de respuesta al pulsar la pestaña PDF.
 * 2. Tiempo de extracción y renderizado de primera página.
 * 3. Tareas largas (> 50ms) en el hilo principal durante la extracción.
 *
 *   node tests/medir_rendimiento_pdf.mjs
 */
import { createServer } from 'node:http';
import { readFile, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join, extname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { crearLibro } from './generarPdfPrueba.mjs';

const app = resolve(import.meta.dirname, '..');
const { chromium } = await (async () => {
  const candidatos = [
    resolve(app, 'node_modules', 'playwright', 'index.mjs'),
    resolve(app, '..', 'node_modules', 'playwright', 'index.mjs'),
    resolve(app, '..', 'JG Turbo_OLD', 'node_modules', 'playwright', 'index.mjs'),
  ];
  for (const ruta of candidatos) {
    try { return await import(pathToFileURL(ruta).href); } catch (_) {}
  }
  throw new Error('No se encontró Playwright (ni en el repo ni en las carpetas vecinas).');
})();

const temporal = await mkdtemp(join(tmpdir(), 'jg-medir-'));
const LIBRO_MEDIANO = join(temporal, 'libro_medicion_50p.pdf');
crearLibro(LIBRO_MEDIANO, 50);

const tipos = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain',
  '.css': 'text/css',
  '.png': 'image/png',
  '.webmanifest': 'application/manifest+json',
  '.pdf': 'application/pdf'
};

const servidor = createServer(async (req, res) => {
  try {
    const p = new URL(req.url, 'http://localhost').pathname;
    const f = join(app, p === '/' ? 'index.html' : p);
    res.setHeader('Content-Type', tipos[extname(f)] || 'application/octet-stream');
    res.end(await readFile(f));
  } catch {
    res.writeHead(404).end();
  }
});
await new Promise((r) => servidor.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${servidor.address().port}`;

const navegador = await chromium.launch({ headless: true });

try {
  const contexto = await navegador.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true
  });

  const pagina = await contexto.newPage();

  // Instalar observador de tareas largas antes de navegar
  await pagina.addInitScript(() => {
    window.__longTasks = [];
    try {
      const observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          window.__longTasks.push({
            name: entry.name,
            startTime: entry.startTime,
            duration: entry.duration
          });
        }
      });
      observer.observe({ entryTypes: ['longtask'] });
    } catch (_) {}
  });

  await pagina.goto(base);
  await pagina.waitForSelector('#tabMic.active');

  // ── Métrica 1: Latencia de cambio a pestaña PDF ──
  const t0 = Date.now();
  await pagina.locator('#tabPdf').click();
  await pagina.waitForSelector('#panelPdf.active');
  await pagina.waitForSelector('#pdfDrop');
  const latenciaPestanaMs = Date.now() - t0;

  // ── Métrica 2 y 3: Extracción de documento de 50 páginas y tareas largas ──
  await pagina.locator('#pdfInput').setInputFiles(LIBRO_MEDIANO);
  await pagina.waitForTimeout(300);
  // Cerrar hoja de consentimiento si aparece
  await pagina.evaluate(() => {
    const h = document.getElementById('pdfAuditoriaHoja');
    if (h) h.hidden = true;
    window.__longTasks = [];
  });

  const tExtraccion0 = Date.now();
  await pagina.locator('#btnPdfRead').click();
  await pagina.waitForSelector('body.jg-leyendo', { timeout: 40000 });
  const tiempoExtraccionMs = Date.now() - tExtraccion0;

  const longTasks = await pagina.evaluate(() => window.__longTasks || []);
  const totalLongTaskDuration = longTasks.reduce((acc, t) => acc + t.duration, 0);
  const maxLongTask = longTasks.length ? Math.max(...longTasks.map(t => t.duration)) : 0;

  console.log('────────────────────────────────────────────────────────────────');
  console.log('📊 RESULTADOS DE RENDIMIENTO (Fase B):');
  console.log(`  - Latencia cambio a pestaña PDF: ${latenciaPestanaMs} ms`);
  console.log(`  - Tiempo de procesamiento (50 páginas): ${tiempoExtraccionMs} ms`);
  console.log(`  - Tareas largas (>50ms) en hilo principal: ${longTasks.length}`);
  console.log(`  - Duración acumulada de bloqueo: ${Math.round(totalLongTaskDuration)} ms`);
  console.log(`  - Tarea bloqueante más larga: ${Math.round(maxLongTask)} ms`);
  console.log('────────────────────────────────────────────────────────────────');

  await contexto.close();
} finally {
  await navegador.close();
  servidor.close();
}
