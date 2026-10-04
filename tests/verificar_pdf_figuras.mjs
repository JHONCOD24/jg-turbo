/* JG Turbo · Las figuras de un libro se ven en el lector, también escuchándolo.
 *
 *   node tests/verificar_pdf_figuras.mjs                 (libro sintético con figuras)
 *   JG_PDF_FIGURAS="ruta/libro.pdf" node tests/verificar_pdf_figuras.mjs
 *
 * Sube el PDF a la app real (Chromium, /api/tts falso) y exige:
 *   · todas las figuras que el lector extrae aparecen en algún capítulo,
 *     dibujadas (naturalWidth > 0) y con tamaño en pantalla;
 *   · siguen ahí al empezar a escuchar y mientras la voz pasa páginas;
 *   · siguen ahí tras recargar (F5) sin volver a barrer el PDF;
 *   · un libro marcado «sin figuras» por una versión anterior se vuelve a
 *     barrer (antes quedaba sin imágenes para siempre).
 */
import { createServer } from 'node:http';
import { readFile, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, extname, resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const AQUI = dirname(fileURLToPath(import.meta.url));
const APP = resolve(AQUI, '..');

const { chromium } = await (async () => {
  const candidatos = [
    resolve(APP, 'node_modules', 'playwright', 'index.mjs'),
    resolve(APP, '..', 'node_modules', 'playwright', 'index.mjs'),
    resolve(APP, '..', '..', '..', 'node_modules', 'playwright', 'index.mjs'),
    resolve(APP, '..', 'JG Turbo_OLD', 'node_modules', 'playwright', 'index.mjs'),
  ];
  for (const ruta of candidatos) {
    try { return await import(pathToFileURL(ruta).href); } catch (_) { /* siguiente */ }
  }
  console.error('FALLO: no se encontró Playwright.');
  process.exit(1);
})();

let comprobaciones = 0;
const fallos = [];
function comprobar(condicion, mensaje, detalle = '') {
  comprobaciones += 1;
  if (condicion) console.log(`OK: ${mensaje}`);
  else { fallos.push(mensaje); console.error(`FALLO: ${mensaje}${detalle ? ` — ${detalle}` : ''}`); }
}

/* ── Libro sintético: texto de varias páginas con tres imágenes reales ── */
function pngRojo(ancho, alto) {
  /* PNG sin compresión útil: filas de píxeles rojos en un IDAT «stored». */
  const zlib = globalThis.__zlib;
  const filas = Buffer.alloc((ancho * 3 + 1) * alto);
  for (let y = 0; y < alto; y += 1) {
    const o = y * (ancho * 3 + 1);
    filas[o] = 0;
    for (let x = 0; x < ancho; x += 1) { filas[o + 1 + x * 3] = 200; filas[o + 2 + x * 3] = 40; filas[o + 3 + x * 3] = 40; }
  }
  return zlib.deflateSync(filas);
}

async function crearLibroConFiguras(ruta) {
  globalThis.__zlib = await import('node:zlib');
  const objetos = [];
  const agregar = (cuerpo) => { objetos.push(cuerpo); return objetos.length; };
  const fuente = agregar('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
  const datosImg = pngRojo(60, 40);
  const imagen = agregar({ dict: `<< /Type /XObject /Subtype /Image /Width 60 /Height 40 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /FlateDecode /DecodeParms << /Predictor 15 /Colors 3 /BitsPerComponent 8 /Columns 60 >> /Length ${datosImg.length} >>`, datos: datosImg });
  const paginas = [];
  const frases = (n) => Array.from({ length: n }, (_, i) =>
    `Frase numero ${n * 7 + i} sobre el viaje de la expedicion ${String.fromCharCode(65 + (i % 26))}${i} que cruzo el valle.`);
  const TOTAL = 9;
  for (let p = 1; p <= TOTAL; p += 1) {
    const lineas = [];
    if (p === 1 || p === 4 || p === 7) lineas.push(`Capitulo ${Math.ceil(p / 3)} del libro de prueba ${p}`);
    lineas.push(...frases(14).map((f) => `${f} Pagina ${p}.`.slice(0, 95)));
    let cont = 'BT /F1 10 Tf 40 560 Td 13 TL\n';
    const conFigura = p === 2 || p === 5 || p === 8;
    lineas.forEach((l, i) => {
      if (conFigura && i === 8) cont += '0 -170 Td\n';
      cont += `(${l.replace(/[()\\]/g, '')}) Tj T*\n`;
    });
    cont += 'ET\n';
    if (conFigura) cont += `q 300 0 0 150 60 250 cm /Im1 Do Q\n`;
    const contenido = agregar({ dict: `<< /Length ${Buffer.byteLength(cont, 'latin1')} >>`, datos: Buffer.from(cont, 'latin1') });
    paginas.push(agregar(`<< /Type /Page /Parent PAGINAS /MediaBox [0 0 420 595] /Contents ${contenido} 0 R /Resources << /Font << /F1 ${fuente} 0 R >> /XObject << /Im1 ${imagen} 0 R >> >> >>`));
  }
  const raizPaginas = agregar(`<< /Type /Pages /Kids [${paginas.map((n) => `${n} 0 R`).join(' ')}] /Count ${paginas.length} >>`);
  const catalogo = agregar(`<< /Type /Catalog /Pages ${raizPaginas} 0 R >>`);
  const trozos = [Buffer.from('%PDF-1.4\n', 'latin1')];
  const offsets = [];
  let largo = trozos[0].length;
  objetos.forEach((o, i) => {
    offsets.push(largo);
    let b;
    if (typeof o === 'string') b = Buffer.from(`${i + 1} 0 obj\n${o.replace('PAGINAS', `${raizPaginas} 0 R`)}\nendobj\n`, 'latin1');
    else b = Buffer.concat([Buffer.from(`${i + 1} 0 obj\n${o.dict}\nstream\n`, 'latin1'), o.datos, Buffer.from('\nendstream\nendobj\n', 'latin1')]);
    trozos.push(b); largo += b.length;
  });
  const xref = `xref\n0 ${objetos.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${objetos.length + 1} /Root ${catalogo} 0 R >>\nstartxref\n${largo}\n%%EOF\n`;
  trozos.push(Buffer.from(xref, 'latin1'));
  await writeFile(ruta, Buffer.concat(trozos));
  return 3;
}

/* ── Servidor: app + /api/tts falso ── */
function wav(segundos) {
  const sr = 8000; const n = Math.max(1, Math.round(segundos * sr));
  const b = Buffer.alloc(44 + n * 2);
  b.write('RIFF', 0); b.writeUInt32LE(36 + n * 2, 4); b.write('WAVE', 8); b.write('fmt ', 12);
  b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(sr, 24);
  b.writeUInt32LE(sr * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(n * 2, 40);
  return b;
}
const TIPOS = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.pdf': 'application/pdf', '.wasm': 'application/wasm', '.mp3': 'audio/mpeg' };
const servidor = createServer(async (peticion, respuesta) => {
  try {
    const url = new URL(peticion.url, 'http://127.0.0.1');
    if (url.pathname === '/api/tts' || url.pathname === '/tts') {
      respuesta.writeHead(200, { 'Content-Type': 'audio/wav' });
      respuesta.end(wav(1.5));
      return;
    }
    if (url.pathname.startsWith('/api/')) { respuesta.writeHead(503).end('x'); return; }
    const rel = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname).replace(/^\/+/, '');
    const datos = await readFile(join(APP, rel));
    respuesta.writeHead(200, { 'Content-Type': TIPOS[extname(rel)] || 'application/octet-stream' });
    respuesta.end(datos);
  } catch { respuesta.writeHead(404).end('x'); }
});
await new Promise((l) => servidor.listen(0, '127.0.0.1', l));
const BASE = `http://127.0.0.1:${servidor.address().port}/`;

const temporal = await mkdtemp(join(tmpdir(), 'jg-figuras-'));
let ruta = process.env.JG_PDF_FIGURAS;
let esperadas = null;
if (!ruta) { ruta = join(temporal, 'libro-figuras.pdf'); esperadas = await crearLibroConFiguras(ruta); }

/* En la página: figuras dibujadas en el capítulo visible. */
function figurasVisibles() {
  const imgs = [...document.querySelectorAll('#pdfLectura .lec-figura img')];
  return {
    total: imgs.length,
    dibujadas: imgs.filter((i) => i.complete && i.naturalWidth > 0 && i.getBoundingClientRect().width > 20).length,
    ids: imgs.map((i) => i.closest('.lec-figura').dataset.fig),
  };
}

async function irAlPrimerCapitulo(p) {
  for (let k = 0; k < 400; k += 1) {
    const sigue = await p.evaluate(() => {
      const b = document.getElementById('btnPdfPrev');
      if (!b || b.disabled || b.closest('[hidden]') || !b.getClientRects().length) return false;
      b.click();
      return true;
    });
    if (!sigue) break;
    await p.waitForTimeout(150);
  }
  await p.waitForTimeout(600);
}

/* Recorre el libro capítulo a capítulo (hasta que «siguiente» se deshabilita)
 * y anota qué figuras aparecen dibujadas. Una figura cuenta una sola vez. */
async function recorrerCapitulos(p) {
  await irAlPrimerCapitulo(p);
  const vistas = new Set();
  let rotas = 0;
  let capitulos = 0;
  for (let i = 0; i < 400; i += 1) {
    capitulos += 1;
    await p.waitForTimeout(500);
    await p.waitForFunction(() => [...document.querySelectorAll('#pdfLectura .lec-figura img')].every((im) => im.complete), null, { timeout: 8000 }).catch(() => {});
    const f = await p.evaluate(figurasVisibles);
    f.ids.forEach((id) => vistas.add(id));
    rotas += f.total - f.dibujadas;
    const hay = await p.evaluate(() => {
      const b = document.getElementById('btnPdfNext');
      if (!b || b.disabled || b.closest('[hidden]') || !b.getClientRects().length) return false;
      b.click();
      return true;
    });
    if (!hay) break;
  }
  return { capitulos, vistas: vistas.size, rotas };
}

async function figurasGuardadas(p) {
  return p.evaluate(() => new Promise((listo) => {
    const req = indexedDB.open('jg-turbo-pdf');
    req.onerror = () => listo(null);
    req.onsuccess = () => {
      const db = req.result;
      const tx = db.transaction('documentos', 'readonly');
      const todos = tx.objectStore('documentos').getAll();
      todos.onsuccess = () => listo(todos.result.map((d) => ({ id: d.id, estado: d.figurasEstado, cuenta: d.figurasCuenta, version: d.figurasVersion })));
      todos.onerror = () => listo(null);
    };
  }));
}

const navegador = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
try {
  for (const [nombre, viewport] of [['teléfono', { width: 390, height: 844 }], ['escritorio', { width: 1440, height: 900 }]]) {
    console.log(`--- ${nombre} ---`);
    const contexto = await navegador.newContext({ viewport });
    const p = await contexto.newPage();
    const errores = [];
    p.on('pageerror', (e) => errores.push(String(e).slice(0, 200)));
    await p.goto(BASE, { waitUntil: 'domcontentloaded' });
    await p.waitForTimeout(600);
    await p.locator('#tabPdf').click();
    await p.locator('#pdfInput').setInputFiles(ruta);
    await p.locator('#btnPdfRead').click();
    await p.locator('#pdfLectura p').first().waitFor({ timeout: 180000 });
    if (process.env.JG_VER) {
      p.on('console', (m) => { if (m.text().startsWith('[vigia]') || /figuras/.test(m.text())) console.log('   ', m.text()); });
      await p.evaluate(() => {
        let ultimo = '';
        setInterval(() => {
          const req = indexedDB.open('jg-turbo-pdf', 5);
          req.onsuccess = () => {
            const bd = req.result;
            try {
              const t = bd.transaction('documentos', 'readonly').objectStore('documentos').getAll();
              t.onsuccess = () => {
                const v = JSON.stringify(t.result.map((d) => [d.id, d.figurasEstado, d.figurasCuenta, d.tieneArchivo]));
                if (v !== ultimo) { ultimo = v; console.log('[vigia] ' + Math.round(performance.now()) + ' ' + v); }
                bd.close();
              };
            } catch (_) { bd.close(); }
          };
        }, 250);
      });
    }
    /* Las figuras se extraen en segundo plano: se espera (de verdad: un bucle,
     * no waitForFunction con async, que devuelve una promesa siempre «verdadera»). */
    let crudo = [];
    for (let t = 0; t < 240; t += 1) {
      crudo = (await figurasGuardadas(p)) || [];
      if (crudo.some((d) => d.estado === 'listas' || d.estado === 'ninguna')) break;
      await p.waitForTimeout(1000);
    }
    if (process.env.JG_VER) console.log('  registros:', JSON.stringify(crudo));
    const guardadas = (crudo || []).find((d) => d.estado) || {};
    console.log(`  figuras extraídas: ${guardadas.cuenta} (${guardadas.estado})`);
    if (esperadas != null) comprobar(guardadas.cuenta === esperadas, `${nombre}: se extraen las ${esperadas} figuras del libro`, `salieron ${guardadas.cuenta}`);
    else comprobar(guardadas.cuenta > 0, `${nombre}: el libro real tiene figuras extraídas`, `estado ${guardadas.estado}`);

    const r1 = await recorrerCapitulos(p);
    console.log(`  capítulos=${r1.capitulos} figurasVistas=${r1.vistas} rotas=${r1.rotas}`);
    comprobar(r1.vistas === guardadas.cuenta, `${nombre}: cada figura extraída aparece en algún capítulo`, `${r1.vistas} de ${guardadas.cuenta}`);
    comprobar(r1.rotas === 0, `${nombre}: ninguna figura rota o de tamaño cero`, `${r1.rotas} rotas`);

    /* Escuchar: volver al capítulo con la primera figura y arrancar la voz. */
    await irAlPrimerCapitulo(p);
    await p.waitForTimeout(800);
    for (let i = 0; i < r1.capitulos; i += 1) {
      const hay = await p.evaluate(() => document.querySelectorAll('#pdfLectura .lec-figura img').length);
      if (hay) break;
      await p.evaluate(() => document.getElementById('btnPdfNext').click());
      await p.waitForTimeout(700);
    }
    const antesVoz = await p.evaluate(figurasVisibles);
    await p.evaluate(() => document.querySelector('[data-tts-console="pdf"] [data-tts-action="toggle"]').click());
    await p.waitForFunction(() => window.ttsState && window.ttsState.status === 'playing', null, { timeout: 60000 }).catch(() => {});
    let minimo = Infinity;
    for (let k = 0; k < 20; k += 1) {
      await p.waitForTimeout(400);
      const f = await p.evaluate(figurasVisibles);
      minimo = Math.min(minimo, f.dibujadas);
    }
    const estadoVoz = await p.evaluate(() => window.ttsState?.status);
    console.log(`  con voz (${estadoVoz}): antes=${antesVoz.dibujadas} mínimo durante=${minimo}`);
    comprobar(antesVoz.dibujadas > 0 && minimo >= antesVoz.dibujadas, `${nombre}: las figuras siguen visibles mientras suena la voz`, `antes ${antesVoz.dibujadas}, mínimo ${minimo}`);
    await p.evaluate(() => document.querySelector('[data-tts-console="pdf"] [data-tts-action="toggle"]')?.click());

    /* F5: lo guardado se pinta sin volver a barrer. */
    await p.reload({ waitUntil: 'domcontentloaded' });
    await p.locator('#pdfLectura p').first().waitFor({ timeout: 60000 }).catch(() => {});
    await p.waitForTimeout(2500);
    const r2 = await recorrerCapitulos(p);
    comprobar(r2.vistas === guardadas.cuenta && r2.rotas === 0, `${nombre}: tras recargar siguen todas las figuras`, `${r2.vistas} de ${guardadas.cuenta}`);

    comprobar(errores.length === 0, `${nombre}: sin errores de JavaScript`, errores.join(' | '));

    /* ── Dos aparatos: el libro llega por la nube a uno que no tiene el PDF ──
     * Se toma el paquete REAL que este aparato subiría (con su marca de
     * figuras) y se importa en un navegador limpio, como hace nube.js. */
    if (nombre === 'escritorio') {
      console.log('--- segundo aparato (libro llegado por la nube) ---');
      const envio = await p.evaluate(async () => {
        const b = await import('/js/pdf/biblioteca.js');
        const [doc] = (await b.listarDocumentos()).filter((d) => d.figurasEstado);
        return { paquete: await b.paqueteParaSubir(doc.id), partes: await b.cargarContenido(doc.id) };
      });
      comprobar(envio.paquete?.datos?.meta?.figurasEstado === 'listas', 'el paquete de nube del primer aparato lleva su marca de figuras (el caso real)');
      const otro = await navegador.newContext({ viewport });
      const q = await otro.newPage();
      const erroresB = [];
      q.on('pageerror', (e) => erroresB.push(String(e).slice(0, 200)));
      await q.goto(BASE, { waitUntil: 'domcontentloaded' });
      await q.waitForTimeout(600);
      const idB = await q.evaluate(async ({ paquete, partes }) => {
        const b = await import('/js/pdf/biblioteca.js');
        const id = await b.importarDeSincronizacion(paquete);
        await b.importarPartes(id, partes, { actualizado: paquete.actualizado });
        return id;
      }, envio);
      await q.reload({ waitUntil: 'domcontentloaded' });
      await q.waitForTimeout(800);
      await q.locator('#tabPdf').click();
      await q.locator(`.pdf-libro[data-doc-id="${idB}"]`).first().click();
      await q.locator('#pdfLectura p').first().waitFor({ timeout: 60000 });
      await q.waitForTimeout(2500);
      const aviso = await q.evaluate(() => [...document.querySelectorAll('.notice')].filter((n) => !n.hidden).map((n) => n.textContent).join(' '));
      const regB = (await figurasGuardadas(q)).find((d) => d.id === idB) || {};
      comprobar(/imágen|imagen/.test(aviso) && /PDF/.test(aviso), 'segundo aparato: avisa de que las imágenes necesitan el PDF y cómo verlas', aviso.slice(0, 160));
      comprobar(regB.estado === 'sinpdf', 'segundo aparato: no hereda «listas» del otro aparato', `estado ${regB.estado}`);

      /* Abrir aquí el mismo PDF: se une al libro (mismo id) y aparecen las figuras. */
      await q.locator('#pdfInput').setInputFiles(ruta, { force: true }).catch(async () => {
        await q.evaluate(() => document.getElementById('btnPdfVolver')?.click());
        await q.locator('#pdfInput').setInputFiles(ruta);
      });
      await q.locator('#btnPdfRead').click({ timeout: 10000 }).catch(() => q.evaluate(() => document.getElementById('btnPdfRead')?.click()));
      let regB2 = {};
      for (let t = 0; t < 240; t += 1) {
        const todos = (await figurasGuardadas(q)) || [];
        regB2 = todos.find((d) => d.estado === 'listas') || {};
        if (regB2.id) break;
        await q.waitForTimeout(1000);
      }
      const cuantos = ((await figurasGuardadas(q)) || []).length;
      comprobar(regB2.id === idB && cuantos === 1, 'segundo aparato: el mismo PDF se une al libro existente, sin duplicarlo', `id ${regB2.id} vs ${idB}, ${cuantos} registros`);
      const rB = await recorrerCapitulos(q);
      comprobar(rB.vistas === guardadas.cuenta && rB.rotas === 0, 'segundo aparato: tras abrir el PDF se ven todas las figuras', `${rB.vistas} de ${guardadas.cuenta}`);
      comprobar(erroresB.length === 0, 'segundo aparato: sin errores de JavaScript', erroresB.join(' | '));
      await otro.close();
    }
    await contexto.close();
  }
} finally {
  await navegador.close();
  servidor.close();
}

console.log(`\n${comprobaciones - fallos.length} de ${comprobaciones} comprobaciones OK`);
process.exit(fallos.length ? 1 : 0);
