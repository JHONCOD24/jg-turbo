/* JG Turbo · Fase A: Que recargar no expulse (F5 / Continuidad)
 *
 * Verifica que:
 * 1. Cambiar de pestaña usa replaceState (?tab=...) y persiste en localStorage.
 * 2. Recargar la página (F5) en cualquier pestaña preserva la pestaña activa.
 * 3. Recargar en móvil y escritorio dentro del lector PDF preserva el documento abierto y modo lector.
 * 4. Cerrar el lector y recargar preserva la biblioteca.
 * 5. Si el documento en curso desaparece, recargar vuelve a biblioteca con aviso limpio.
 *
 *   node tests/verificar_fase_a_recargar.mjs
 */
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { resolve, join, extname } from 'node:path';
import { pathToFileURL } from 'node:url';

const app = resolve(import.meta.dirname, '..');
const { chromium } = await import(pathToFileURL(resolve(app, '../JG Turbo_OLD/node_modules/playwright/index.mjs')));
const destino = resolve(app, '.playwright-cli/fase-a');
await mkdir(destino, { recursive: true });

const tipos = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain',
  '.css': 'text/css',
  '.png': 'image/png',
  '.webmanifest': 'application/manifest+json'
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

let ok = 0;
const fallos = [];
const comprobar = (nombre, condicion, detalle = '') => {
  if (condicion) {
    ok++;
    console.log(`OK: ${nombre}`);
  } else {
    fallos.push(`${nombre}${detalle ? ` — ${detalle}` : ''}`);
    console.log(`FALLO: ${nombre}${detalle ? ` — ${detalle}` : ''}`);
  }
};

const navegador = await chromium.launch({ headless: true });

try {
  // ── 1. Pestañas y F5 en escritorio y móvil ──
  for (const [dispositivo, ancho, alto] of [['escritorio', 1280, 900], ['teléfono', 390, 844]]) {
    const contexto = await navegador.newContext({
      viewport: { width: ancho, height: alto },
      isMobile: dispositivo === 'teléfono'
    });
    const pagina = await contexto.newPage();

    // Arrancar sin parámetros
    await pagina.goto(base);
    await pagina.waitForSelector('#tabMic.active');
    comprobar(`${dispositivo}: arranque inicial en mic`, await pagina.locator('#tabMic.active').isVisible());

    // Cambiar a Archivo
    await pagina.click('#tabFile');
    await pagina.waitForSelector('#tabFile.active');
    const urlFile = new URL(pagina.url());
    comprobar(`${dispositivo}: cambio a file actualiza URL ?tab=file`, urlFile.searchParams.get('tab') === 'file');
    const tabFileLs = await pagina.evaluate(() => localStorage.getItem('jg_tab_activa'));
    comprobar(`${dispositivo}: cambio a file guarda localStorage`, tabFileLs === 'file');

    // F5 (recargar)
    await pagina.reload();
    await pagina.waitForSelector('#tabFile.active');
    comprobar(`${dispositivo}: F5 en file mantiene panelFile activo`, await pagina.locator('#panelFile.active').isVisible());
    comprobar(`${dispositivo}: F5 en file mantiene tabFile activo`, await pagina.locator('#tabFile.active').isVisible());

    // Cambiar a PDF
    await pagina.click('#tabPdf');
    await pagina.waitForSelector('#tabPdf.active');
    const urlPdf = new URL(pagina.url());
    comprobar(`${dispositivo}: cambio a pdf actualiza URL ?tab=pdf`, urlPdf.searchParams.get('tab') === 'pdf');

    // F5 (recargar en PDF)
    await pagina.reload();
    await pagina.waitForSelector('#tabPdf.active');
    comprobar(`${dispositivo}: F5 en pdf mantiene panelPdf activo`, await pagina.locator('#panelPdf.active').isVisible());
    comprobar(`${dispositivo}: F5 en pdf mantiene tabPdf activo`, await pagina.locator('#tabPdf.active').isVisible());

    // Esperar a que inicialice drop area
    await pagina.waitForSelector('#pdfDrop');
    comprobar(`${dispositivo}: panel PDF inicializado tras recarga`, await pagina.locator('#pdfDrop').isVisible());

    await contexto.close();
  }

  // ── 2. Continuidad del lector PDF al recargar ──
  {
    const contexto = await navegador.newContext({
      viewport: { width: 390, height: 844 },
      isMobile: true
    });
    const pagina = await contexto.newPage();

    await pagina.goto(`${base}/?tab=pdf`);
    await pagina.waitForSelector('#tabPdf.active');
    await pagina.waitForSelector('#pdfDrop');

    // Cargar un documento de prueba sintético directamente en IndexedDB de la biblioteca
    const docCreado = await pagina.evaluate(async () => {
      const { guardarDocumento } = await import('/js/pdf/biblioteca.js');
      const id = 'test-doc-recarga-' + Date.now();
      const partes = [
        { titulo: 'Capítulo Uno', texto: 'Este es el texto del capítulo uno para probar la recarga.' },
        { titulo: 'Capítulo Dos', texto: 'Continuación en el capítulo dos.' }
      ];
      await guardarDocumento({
        meta: {
          id,
          titulo: 'Libro de Prueba Continuidad',
          totalPaginas: 2,
          idioma: 'es',
          titulosPartes: partes.map(p => p.titulo),
          capitulos: [{ indice: 0, titulo: 'Capítulo Uno' }, { indice: 1, titulo: 'Capítulo Dos' }],
          progreso: { parte: 0, caracter: 10 },
          versionTroceo: 3,
          versionReconstruccion: 2
        },
        partes
      });
      return id;
    });

    comprobar('documento insertado en biblioteca', !!docCreado);

    // Recargar biblioteca para ver el libro en lista
    await pagina.reload();
    await pagina.waitForSelector('#tabPdf.active');
    const tarjeta = pagina.locator(`[data-doc-id="${docCreado}"]`);
    await tarjeta.waitFor({ state: 'visible', timeout: 5000 });
    comprobar('tarjeta de documento visible en biblioteca', await tarjeta.isVisible());

    // Abrir el libro tocando la tarjeta
    await tarjeta.click();
    await pagina.waitForSelector('body.jg-leyendo');
    comprobar('lector abierto: body tiene jg-leyendo', await pagina.evaluate(() => document.body.classList.contains('jg-leyendo')));
    const docAbiertoLs = await pagina.evaluate(() => localStorage.getItem('jg_pdf_doc_abierto'));
    comprobar('localStorage registra doc abierto', docAbiertoLs === docCreado);
    const vistaActivaLs = await pagina.evaluate(() => localStorage.getItem('jg_pdf_vista_activa'));
    comprobar('localStorage registra vista lector', vistaActivaLs === 'lector');

    // F5 EN EL LECTOR
    await pagina.reload();
    await pagina.waitForSelector('body.jg-leyendo', { timeout: 8000 });
    comprobar('F5 en lector: restaura body.jg-leyendo', await pagina.evaluate(() => document.body.classList.contains('jg-leyendo')));
    const tituloEnLector = await pagina.locator('#pdfResultTitle').textContent();
    comprobar('F5 en lector: restaura título del documento', tituloEnLector.includes('Libro de Prueba Continuidad'));
    comprobar('F5 en lector: resultArea está visible', await pagina.locator('#pdfResultArea').isVisible());

    // Esperar a que el layout se estabilice tras restaurar
    await pagina.waitForTimeout(600);

    // Volver a la biblioteca
    await pagina.evaluate(() => document.getElementById('btnPdfBack').click());
    await pagina.waitForSelector('#pdfBiblioteca');
    comprobar('volver a biblioteca: quita jg-leyendo', await pagina.evaluate(() => !document.body.classList.contains('jg-leyendo')));
    const vistaTrasCerrar = await pagina.evaluate(() => localStorage.getItem('jg_pdf_vista_activa'));
    comprobar('localStorage registra vista biblioteca tras volver', vistaTrasCerrar === 'biblioteca');
    const docTrasCerrar = await pagina.evaluate(() => localStorage.getItem('jg_pdf_doc_abierto'));
    comprobar('localStorage limpió doc abierto tras volver', !docTrasCerrar);

    // F5 EN LA BIBLIOTECA
    await pagina.reload();
    await pagina.waitForSelector('#tabPdf.active');
    await pagina.waitForSelector('#pdfBiblioteca');
    comprobar('F5 en biblioteca: permanece en biblioteca', await pagina.locator('#pdfBiblioteca').isVisible());
    comprobar('F5 en biblioteca: no activa jg-leyendo', await pagina.evaluate(() => !document.body.classList.contains('jg-leyendo')));

    // Caso límite: si el documento abierto fue borrado externamente y se recarga
    await pagina.evaluate(async (id) => {
      localStorage.setItem('jg_pdf_doc_abierto', id);
      localStorage.setItem('jg_pdf_vista_activa', 'lector');
      const { borrarDocumento } = await import('/js/pdf/biblioteca.js');
      await borrarDocumento(id);
    }, docCreado);

    await pagina.reload();
    await pagina.waitForSelector('#tabPdf.active');
    await pagina.waitForSelector('#pdfNotice');
    const aviso = await pagina.locator('#pdfNotice').textContent();
    comprobar('F5 con doc borrado: muestra aviso amigable', aviso.includes('Ese documento ya no está guardado'));
    comprobar('F5 con doc borrado: no deja body.jg-leyendo', await pagina.evaluate(() => !document.body.classList.contains('jg-leyendo')));

    await contexto.close();
  }
} finally {
  await navegador.close();
  servidor.close();
}

console.log('\n────────────────────────────────────────────────────────────────');
if (fallos.length > 0) {
  console.error(`❌ FALLOS: ${fallos.length}`);
  for (const f of fallos) console.error(`  - ${f}`);
  process.exit(1);
} else {
  console.log(`✔ Fase A verificada con éxito: ${ok} comprobaciones OK.`);
}
