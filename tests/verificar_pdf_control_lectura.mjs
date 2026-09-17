/* Control de la lectura con el dedo, y la flecha para bajar al final.
 *   node tests/verificar_pdf_control_lectura.mjs
 *
 * No hace falta voz de verdad: se finge el estado «hay voz sonando» (que es
 * justo la condición que abre el gesto) y se comprueba a dónde va la lectura.
 */
import { createServer } from 'node:http';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, extname, resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { crearLibro } from './generarPdfPrueba.mjs';

const AQUI = dirname(fileURLToPath(import.meta.url));
const APP = resolve(AQUI, '..');

const { chromium } = await (async () => {
  const candidatos = [
    resolve(APP, 'node_modules', 'playwright', 'index.mjs'),
    resolve(APP, '..', 'node_modules', 'playwright', 'index.mjs'),
  ];
  for (const ruta of candidatos) {
    try { return await import(pathToFileURL(ruta).href); } catch (_) { /* siguiente */ }
  }
  console.error('FALLO: no se encontró Playwright.');
  process.exit(1);
})();

let fallos = 0;
const comprobar = (condicion, mensaje) => {
  if (condicion) console.log(`OK: ${mensaje}`);
  else { fallos += 1; console.error(`FALLO: ${mensaje}`); }
};

const TIPOS = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.json': 'application/json',
  '.webmanifest': 'application/manifest+json', '.png': 'image/png',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.pdf': 'application/pdf',
};
const servidor = createServer(async (peticion, respuesta) => {
  try {
    const url = new URL(peticion.url, 'http://127.0.0.1:8000');
    const rel = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname).replace(/^\/+/, '');
    const datos = await readFile(join(APP, rel));
    respuesta.writeHead(200, { 'Content-Type': TIPOS[extname(rel)] || 'application/octet-stream' });
    respuesta.end(datos);
  } catch {
    try { respuesta.writeHead(404).end('no encontrado'); } catch { /* ya respondido */ }
  }
});
await new Promise((listo) => servidor.listen(0, '127.0.0.1', listo));
const BASE = `http://127.0.0.1:${servidor.address().port}/`;

const temporal = await mkdtemp(join(tmpdir(), 'jg-control-'));
const LIBRO = join(temporal, 'libro.pdf');
crearLibro(LIBRO, 40);

const navegador = await chromium.launch();
try {
  const pagina = await (await navegador.newContext({ viewport: { width: 1280, height: 860 } })).newPage();
  const errores = [];
  pagina.on('pageerror', (e) => errores.push(String(e)));

  await pagina.goto(BASE, { waitUntil: 'domcontentloaded' });
  await pagina.waitForTimeout(600);
  await pagina.locator('#tabPdf').click();
  await pagina.locator('#pdfInput').setInputFiles(LIBRO);
  await pagina.locator('#btnPdfRead').click();
  await pagina.waitForFunction(() => {
    const r = document.getElementById('pdfResultArea');
    return r && r.style.display !== 'none';
  }, null, { timeout: 90000 }).catch(() => {});
  await pagina.waitForTimeout(1200);

  /* `leerDesdeCaracter` es una funcion interna del controlador: no se puede
     enganchar desde fuera. Lo que SI se ve es a donde manda a narrar, que es
     lo que de verdad importa. Se sustituye el motor de voz por un cuaderno. */
  await pagina.evaluate(() => {
    window.__saltos = [];
    window.ttsHablar = (texto) => { window.__saltos.push(String(texto || '').slice(0, 40)); return true; };
  });

  /* ── Sin voz sonando, un toque NO empieza a narrar ── */
  {
    await pagina.evaluate(() => document.body.classList.remove('jg-voz-activa'));
    const parrafo = pagina.locator('#pdfLectura [data-ini]').nth(2);
    if (await parrafo.count()) await parrafo.click();
    await pagina.waitForTimeout(300);
    const saltos = await pagina.evaluate(() => window.__saltos.length);
    comprobar(saltos === 0, 'sin voz, un toque en el párrafo no arranca la lectura');
  }

  /* ── Con voz sonando, el toque lleva la lectura a ESE párrafo ── */
  {
    await pagina.evaluate(() => { document.body.classList.add('jg-voz-activa'); window.__saltos = []; });
    const parrafo = pagina.locator('#pdfLectura [data-ini]').nth(3);
    const suyo = (await parrafo.textContent() || '').trim().replace(/\s+/g, ' ').slice(0, 18);
    await parrafo.click();
    await pagina.waitForTimeout(400);
    const saltos = await pagina.evaluate(() => window.__saltos);
    comprobar(saltos.length === 1, `con voz, el toque manda a narrar (${saltos.length} vez)`);
    const dicho = (saltos[0] || '').replace(/\s+/g, ' ');
    comprobar(suyo.length > 6 && dicho.includes(suyo.slice(0, 12)),
      `y empieza por el párrafo tocado (dijo «${dicho.slice(0, 30)}…», esperaba «${suyo}…»)`);
  }

  /* ── Un toque para seleccionar texto no secuestra la lectura ── */
  {
    await pagina.evaluate(() => { window.__saltos = []; });
    await pagina.evaluate(() => {
      const p = document.querySelectorAll('#pdfLectura [data-ini]')[4];
      const r = document.createRange();
      r.selectNodeContents(p);
      const s = document.getSelection();
      s.removeAllRanges();
      s.addRange(r);
    });
    await pagina.locator('#pdfLectura [data-ini]').nth(4).click();
    await pagina.waitForTimeout(300);
    comprobar(await pagina.evaluate(() => window.__saltos.length) === 0,
      'con texto seleccionado, el toque no secuestra la lectura');
    await pagina.evaluate(() => document.getSelection().removeAllRanges());
  }

  /* ── La flecha de bajar: solo leyendo con desplazamiento y con recorrido ── */
  {
    /* Pasando páginas no hay scroll que salvar: la flecha no pinta nada. */
    await pagina.evaluate(() => {
      const cfg = JSON.parse(localStorage.getItem('jg_pdf_lectura') || '{}');
      cfg.modoPagina = 'paginas';
      localStorage.setItem('jg_pdf_lectura', JSON.stringify(cfg));
    });
    await pagina.reload({ waitUntil: 'domcontentloaded' });
    await pagina.waitForTimeout(3500);
    comprobar(await pagina.locator('#pdfIrAbajo').isHidden(), 'pasando páginas la flecha no aparece');

    await pagina.evaluate(() => {
      const cfg = JSON.parse(localStorage.getItem('jg_pdf_lectura') || '{}');
      cfg.modoPagina = 'scroll';
      localStorage.setItem('jg_pdf_lectura', JSON.stringify(cfg));
    });
    await pagina.reload({ waitUntil: 'domcontentloaded' });
    await pagina.waitForTimeout(3500);

    const antes = await pagina.evaluate(() => {
      const b = document.getElementById('pdfIrAbajo');
      const caja = b ? b.getBoundingClientRect() : null;
      return { visible: b && !b.hidden, ancho: Math.round(caja?.width || 0), alto: Math.round(caja?.height || 0) };
    });
    comprobar(antes.visible, 'con desplazamiento y capítulo largo, la flecha aparece');
    comprobar(antes.ancho >= 44 && antes.alto >= 44,
      `la flecha se toca sin puntería (${antes.ancho}×${antes.alto})`);

    await pagina.locator('#pdfIrAbajo').click();
    await pagina.waitForTimeout(1200);
    const despues = await pagina.evaluate(() => {
      const busca = (n) => {
        while (n && n !== document.body) {
          const cs = getComputedStyle(n);
          if (/(auto|scroll)/.test(cs.overflowY) && n.scrollHeight > n.clientHeight + 40) return n;
          n = n.parentElement;
        }
        const d = document.scrollingElement || document.documentElement;
        return d.scrollHeight > d.clientHeight + 40 ? d : null;
      };
      const c = busca(document.getElementById('pdfLectura'));
      return {
        queda: c ? Math.round(c.scrollHeight - c.scrollTop - c.clientHeight) : -1,
        oculta: document.getElementById('pdfIrAbajo')?.hidden,
      };
    });
    comprobar(despues.queda >= 0 && despues.queda < 150, `la flecha lleva al final (quedan ${despues.queda} px)`);
    comprobar(despues.oculta === true, 'y una vez abajo, se retira');
  }

  /* ── Volver del libro NO reinicia la lectura ──
   *
   * Salir a la biblioteca con la voz sonando y volver reiniciaba la lectura:
   * al montar el lector, el envoltorio de `mostrarParte` veía voz activa, lo
   * tomaba por un salto de capítulo y volvía a narrar desde el principio de
   * lo visible. Se finge «hay voz sonando en el PDF» y se comprueba que abrir
   * el libro no manda narrar nada. */
  {
    await pagina.evaluate(() => {
      window.__saltos = [];
      window.ttsHablar = (texto) => { window.__saltos.push(String(texto || '').slice(0, 30)); return true; };
      /* Estado mínimo que `ttsSonandoAqui()` da por «sonando aquí». */
      window.ttsState = window.ttsState || {};
      window.ttsState.sourceId = 'pdf';
      window.ttsState.status = 'playing';
    });
    await pagina.locator('#btnPdfBack').click();
    await pagina.waitForTimeout(900);
    comprobar(await pagina.evaluate(() => window.__saltos.length) === 0,
      'salir a la biblioteca no manda narrar de nuevo');
    await pagina.evaluate(() => {
      window.ttsState.sourceId = 'pdf';
      window.ttsState.status = 'playing';
    });
    await pagina.locator('#pdfRejilla .pdf-libro').first().click();
    await pagina.waitForTimeout(2500);
    const saltos = await pagina.evaluate(() => window.__saltos);
    comprobar(saltos.length === 0,
      `volver al libro con la voz sonando NO la reinicia (${saltos.length} reinicio(s))`);
  }

  /* ── El vigilante destraba una lectura clavada ──
   *
   * Un bloque se puede quedar quieto sin disparar `ended` ni `error`: el
   * estado sigue diciendo «sonando» y antes la unica salida era volver a
   * pulsar Escuchar. Se finge esa situacion y se comprueba que el vigilante
   * sube de escalon en vez de quedarse mirando. */
  {
    const pasos = await pagina.evaluate(async () => {
      const pool = window.ttsPool();
      const el = pool[pool.activo];
      /* Un audio real, corto y mudo, que se deja parado a proposito. */
      el.src = 'data:audio/mpeg;base64,SUQzBAAAAAAAI1RTU0UAAAAPAAADTGF2ZjU4Ljc2LjEwMAAAAAAAAAAAAAAA//tAwAAAAAAAAAAAAAAAAAAAAAAASW5mbwAAAA8AAAAEAAABIADAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDA//////////////////////////////////8AAAAATGF2YzU4LjEzAAAAAAAAAAAAAAAAJAAAAAAAAAAAASDs90hvAAAAAAAAAAAAAAAAAAAA';
      el.dataset.bloque = '0';
      window.ttsState.queue = [{ text: 'hola', estado: 'listo', url: el.src, dur: 30 }];
      window.ttsState.idx = 0;
      window.ttsState.status = 'playing';
      window.ttsState.engineUsed = 'neural';
      window.ttsState.silencioTimer = null;
      window.ttsState.sourceId = 'pdf';

      const vistos = [];
      window.ttsVigilarReproduccion();           // primera pasada: toma referencia
      for (const seg of [9, 19, 33]) {
        window.ttsVigia.desde = Date.now() - seg * 1000;
        window.ttsVigia.tiempo = el.currentTime; // sigue clavado en el mismo punto
        window.ttsVigilarReproduccion();
        vistos.push(window.ttsVigia.paso);
      }
      return vistos;
    });
    comprobar(pasos[0] === 1, `a los 9 s quieto, el vigilante reintenta el play (paso ${pasos[0]})`);
    comprobar(pasos[1] === 2, `a los 19 s, recarga el bloque (paso ${pasos[1]})`);
    comprobar(pasos[2] === 3, `a los 33 s, pasa al siguiente (paso ${pasos[2]})`);
  }

  comprobar(errores.length === 0, `sin errores de JavaScript (${errores.length})`);
} finally {
  await navegador.close();
  servidor.close();
  await rm(temporal, { recursive: true, force: true });
}

console.log(fallos === 0 ? '\n✔ Control de la lectura en orden' : `\n${fallos} FALLO(S)`);
process.exit(fallos === 0 ? 0 : 1);
