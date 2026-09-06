/* JG Turbo · Una pestaña a la vez
 *
 * Fallo real en producción (2026-09-05): en Micrófono, Archivo, YouTube y
 * Traducir aparecía además el contenido del panel de PDF. Todas las pestañas
 * parecían tener lo mismo.
 *
 * La causa fue una regla añadida al arreglar el hueco negro del panel PDF:
 *
 *     body:not(.jg-leyendo) #panelPdf { display:flex }
 *
 * Lleva un identificador, así que **le gana** a `.panel{display:none}` y al
 * atributo `hidden`. El panel se dibujaba siempre, activo o no.
 *
 * Esta prueba no vigila esa regla concreta: vigila la propiedad que importa
 * —solo hay un panel a la vista— para cualquier pestaña y cualquier panel.
 *
 *   node tests/verificar_pestanas.mjs
 *   JG_BASE=https://jg-turbo.vercel.app node tests/verificar_pestanas.mjs
 */
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { resolve, join, extname } from 'node:path';
import { pathToFileURL } from 'node:url';

const app = resolve(import.meta.dirname, '..');
const { chromium } = await import(pathToFileURL(resolve(app, '../JG Turbo_OLD/node_modules/playwright/index.mjs')));
const destino = resolve(app, '.playwright-cli/pestanas');
await mkdir(destino, { recursive: true });

const tipos = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.svg': 'image/svg+xml', '.txt': 'text/plain', '.css': 'text/css', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
const servidor = createServer(async (q, r) => {
  try {
    const p = new URL(q.url, 'http://localhost').pathname;
    const f = join(app, p === '/' ? 'index.html' : p);
    r.setHeader('Content-Type', tipos[extname(f)] || 'application/octet-stream');
    r.end(await readFile(f));
  } catch { r.writeHead(404).end(); }
});
await new Promise((r) => servidor.listen(0, '127.0.0.1', r));
const base = process.env.JG_BASE || `http://127.0.0.1:${servidor.address().port}`;

let ok = 0;
const fallos = [];
const comprobar = (n, c, d = '') => {
  if (c) { ok++; console.log(`OK: ${n}`); }
  else { fallos.push(`${n}${d ? ` — ${d}` : ''}`); console.log(`FALLO: ${n}${d ? ` — ${d}` : ''}`); }
};

const PESTANAS = [
  ['Micrófono', '#tabMic', 'panelMic'],
  ['Archivo', '#tabFile', 'panelFile'],
  ['YouTube', '#tabYt', 'panelYt'],
  ['PDF', '#tabPdf', 'panelPdf'],
  ['Traducir', '#tabTrans', 'panelTrans'],
];

/* Se mide en escritorio y en teléfono: la regla que lo rompió estaba acotada
   por ancho, así que un solo tamaño no habría bastado. */
const TAMANOS = [['escritorio', 1280, 900], ['teléfono', 390, 844]];

const navegador = await chromium.launch({ headless: !process.argv.includes('--headed') });

try {
  for (const [tam, w, h] of TAMANOS) {
    console.log(`\n── ${tam} · ${w}×${h} ──────────────────────────────────────────`);
    const ctx = await navegador.newContext({ viewport: { width: w, height: h } });
    const p = await ctx.newPage();
    p.on('pageerror', (e) => fallos.push(`error de JavaScript (${tam}): ${String(e).slice(0, 120)}`));
    await p.goto(base, { waitUntil: 'domcontentloaded' });
    await p.waitForTimeout(1500);

    for (const [nombre, sel, panelEsperado] of PESTANAS) {
      await p.locator(sel).click();
      await p.waitForTimeout(600);

      const m = await p.evaluate(() => {
        /* «A la vista» = ocupa sitio de verdad. `offsetParent` no basta con
           `position:fixed`, así que se mira también la caja. */
        const dibujado = (e) => {
          const cs = getComputedStyle(e);
          if (cs.display === 'none' || cs.visibility === 'hidden') return false;
          const r = e.getBoundingClientRect();
          return r.width > 1 && r.height > 1;
        };
        const paneles = [...document.querySelectorAll('.panel')];
        return {
          activos: paneles.filter((e) => e.classList.contains('active')).map((e) => e.id),
          dibujados: paneles.filter(dibujado).map((e) => e.id),
          marcadosOcultosPeroDibujados: paneles
            .filter((e) => e.hidden && dibujado(e)).map((e) => e.id),
        };
      });

      comprobar(`${tam}/${nombre}: solo un panel a la vista`,
        m.dibujados.length === 1, `se dibujan [${m.dibujados.join(', ')}]`);
      comprobar(`${tam}/${nombre}: el panel a la vista es el suyo`,
        m.dibujados.length === 1 && m.dibujados[0] === panelEsperado,
        `esperado ${panelEsperado}, se ve [${m.dibujados.join(', ')}]`);
      comprobar(`${tam}/${nombre}: nada marcado oculto se dibuja`,
        m.marcadosOcultosPeroDibujados.length === 0,
        `[${m.marcadosOcultosPeroDibujados.join(', ')}]`);

      if (nombre === 'Micrófono') {
        await p.screenshot({ path: join(destino, `${tam}-mic.png`) });
      }
    }
    await ctx.close();
  }
} finally {
  await navegador.close();
  servidor.close();
}

console.log(`\n${'─'.repeat(64)}`);
if (fallos.length) {
  console.log(`✖ ${ok} OK · ${fallos.length} fallos:`);
  fallos.slice(0, 12).forEach((f) => console.log(`   · ${f}`));
  process.exit(1);
}
console.log(`✔ Cada pestaña muestra lo suyo y nada más. ${ok} comprobaciones.`);
