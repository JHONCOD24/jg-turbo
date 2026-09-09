/* JG Turbo · Verificación E2E de Carátulas Movibles en Móvil, Tablet y Escritorio
 * Ejecutar: node tests/verificar_caratulas_movibles.mjs
 */
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { resolve, join, extname } from 'node:path';
import { pathToFileURL } from 'node:url';

const APP = resolve(import.meta.dirname, '..');
const { chromium } = await (async () => {
  const candidatos = [
    resolve(APP, 'node_modules', 'playwright', 'index.mjs'),
    resolve(APP, '..', 'node_modules', 'playwright', 'index.mjs'),
    resolve(APP, '..', 'JG Turbo_OLD', 'node_modules', 'playwright', 'index.mjs'),
  ];
  for (const ruta of candidatos) {
    try { return await import(pathToFileURL(ruta).href); } catch (_) {}
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
  '.svg': 'image/svg+xml', '.css': 'text/css', '.png': 'image/png',
  '.webmanifest': 'application/manifest+json', '.txt': 'text/plain; charset=utf-8',
};

const servidor = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    const archivo = join(APP, url.pathname === '/' ? 'index.html' : url.pathname);
    res.setHeader('Content-Type', TIPOS[extname(archivo)] || 'application/octet-stream');
    res.end(await readFile(archivo));
  } catch {
    res.writeHead(404).end();
  }
});

await new Promise((r) => servidor.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${servidor.address().port}`;
console.log(`Probando carátulas movibles en ${BASE}/\n`);

const navegador = await chromium.launch({ headless: true });

try {
  // Preparamos 3 libros de prueba en IndexedDB
  const prepararLibros = async (page) => {
    await page.evaluate(async () => {
      const dbReq = indexedDB.open('jg-turbo-pdf', 5);
      await new Promise((resolver, rechazar) => {
        dbReq.onsuccess = () => resolver(dbReq.result);
        dbReq.onerror = () => rechazar(dbReq.error);
        dbReq.onupgradeneeded = (e) => {
          const bd = e.target.result;
          if (!bd.objectStoreNames.contains('documentos')) bd.createObjectStore('documentos', { keyPath: 'id' });
          if (!bd.objectStoreNames.contains('contenido')) bd.createObjectStore('contenido', { keyPath: 'id' });
          if (!bd.objectStoreNames.contains('archivos')) bd.createObjectStore('archivos', { keyPath: 'id' });
        };
      });
      const db = dbReq.result;
      const tx = db.transaction(['documentos', 'contenido'], 'readwrite');
      const docs = tx.objectStore('documentos');
      const cont = tx.objectStore('contenido');

      const libros = [
        { id: 'doc-alfa', titulo: 'Alfa y Omega', actualizado: 1000, creado: 1000, estado: 'leyendo', paginasLeidas: 10, totalPaginas: 50, tienePortada: true, origenPortada: 'real' },
        { id: 'doc-beta', titulo: 'Beta Reader', actualizado: 2000, creado: 2000, estado: 'sin-empezar', paginasLeidas: 0, totalPaginas: 80, tienePortada: true, origenPortada: 'real' },
        { id: 'doc-gamma', titulo: 'Gamma Rays', actualizado: 3000, creado: 3000, estado: 'terminado', paginasLeidas: 100, totalPaginas: 100, tienePortada: true, origenPortada: 'real' },
      ];

      for (const lib of libros) {
        docs.put(lib);
        cont.put({ id: lib.id, partes: [{ titulo: 'Capítulo 1', texto: 'Contenido de prueba para el libro ' + lib.titulo }] });
      }

      await new Promise((r) => { tx.oncomplete = r; });
      db.close();
    });
  };

  const ctx = await navegador.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true });
  const page = await ctx.newPage();

  /* ──────────────────────────────────────────────────────────────────────
   * 1. FORMATO MÓVIL (390 x 844)
   * ────────────────────────────────────────────────────────────────────── */
  console.log('── 1. Formato Móvil (390 x 844) ──');
  {
    await page.goto(`${BASE}/?tab=pdf`);
    await prepararLibros(page);
    await page.reload();
    await page.waitForSelector('#pdfBiblioteca:not([hidden])', { timeout: 6000 });

    // Verificar opción 'personalizado' en #pdfOrden
    const opcionPersonalizado = await page.$('#pdfOrden option[value="personalizado"]');
    comprobar(opcionPersonalizado !== null, 'el selector #pdfOrden incluye la opción "Personalizado"');

    await page.waitForTimeout(600);

    // Verificar tarjetas y tiradores
    const tarjetas = await page.locator('.pdf-libro').all();
    comprobar(tarjetas.length === 3, `se muestran las 3 tarjetas de libros (obtuvo: ${tarjetas.length})`);

    const tirador = await page.locator('.pdf-libro .pdf-libro-arrastre').first();
    comprobar((await tirador.count()) > 0, 'las tarjetas disponen de tirador de arrastre (.pdf-libro-arrastre)');

    // Verificar botones del menú de opciones del libro
    const menuSummary = page.locator('.pdf-libro .pdf-libro-menu summary').first();
    await menuSummary.click();
    const btnMoverFinal = page.locator('.pdf-libro-menu button:has-text("Mover al final")').first();
    comprobar((await btnMoverFinal.count()) > 0, 'el menú incluye acción táctil "Mover al final"');

    // Pulsar "Mover al final" para el primer libro visible
    const primerIdAntes = await page.evaluate(() => document.querySelector('.pdf-libro')?.dataset.docId);
    await btnMoverFinal.click();
    await page.waitForTimeout(400);

    const ultimoIdDespues = await page.evaluate(() => {
      const lista = document.querySelectorAll('.pdf-libro');
      return lista[lista.length - 1]?.dataset.docId;
    });
    comprobar(ultimoIdDespues === primerIdAntes, `el libro se movió al final (${ultimoIdDespues} === ${primerIdAntes})`);

    // Verificar que se guardó el orden manual en localStorage y cambió el selector
    const ordenGuardado = await page.evaluate(() => localStorage.getItem('jg_pdf_orden_manual'));
    const modoOrden = await page.evaluate(() => localStorage.getItem('jg_pdf_orden'));
    comprobar(ordenGuardado !== null && JSON.parse(ordenGuardado).length === 3, 'se guardó el orden manual en localStorage');
    comprobar(modoOrden === 'personalizado', 'el modo de orden se estableció automáticamente en "personalizado"');
    // No cerramos ctx aquí para mantener la base IndexedDB y localStorage
  }

  /* ──────────────────────────────────────────────────────────────────────
   * 2. FORMATO TABLET (820 x 1180)
   * ────────────────────────────────────────────────────────────────────── */
  console.log('\n── 2. Formato Tablet (820 x 1180) ──');
  {
    await page.setViewportSize({ width: 820, height: 1180 });
    await page.waitForTimeout(400);

    // Verificar menú "Mover al inicio"
    const ultimoMenu = page.locator('.pdf-libro:last-child .pdf-libro-menu summary');
    await ultimoMenu.click();
    const btnMoverInicio = page.locator('.pdf-libro:last-child .pdf-libro-menu button:has-text("Mover al inicio")');
    comprobar((await btnMoverInicio.count()) > 0, 'el menú en tablet incluye "Mover al inicio"');

    const ultimoIdAntes = await page.evaluate(() => {
      const lista = document.querySelectorAll('.pdf-libro');
      return lista[lista.length - 1]?.dataset.docId;
    });
    await btnMoverInicio.click();
    await page.waitForTimeout(400);

    const primerIdDespues = await page.evaluate(() => document.querySelector('.pdf-libro')?.dataset.docId);
    comprobar(primerIdDespues === ultimoIdAntes, `el último libro se reubicó en la primera posición (${primerIdDespues})`);
  }

  /* ──────────────────────────────────────────────────────────────────────
   * 3. FORMATO ESCRITORIO (1280 x 800)
   * ────────────────────────────────────────────────────────────────────── */
  console.log('\n── 3. Formato Escritorio (1280 x 800) ──');
  {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.waitForTimeout(400);

    // Verificar atajos de teclado accesibles: Alt + ArrowRight
    const primerLibro = page.locator('.pdf-libro:first-child');
    const idPrimero = await primerLibro.getAttribute('data-doc-id');
    await primerLibro.focus();
    await page.keyboard.press('Alt+ArrowRight');
    await page.waitForTimeout(400);

    const segundoId = await page.evaluate(() => document.querySelectorAll('.pdf-libro')[1]?.dataset.docId);
    comprobar(segundoId === idPrimero, 'teclado accesible (Alt+ArrowRight) mueve la tarjeta hacia la derecha');

    // Simular arrastre físico con puntero (ratón)
    const tirador1 = page.locator('.pdf-libro:first-child .pdf-libro-arrastre');
    const caja1 = await tirador1.boundingBox();
    const cajaDestino = await page.locator('.pdf-libro:last-child').boundingBox();
    if (caja1 && cajaDestino) {
      const idArrastrado = await page.locator('.pdf-libro:first-child').getAttribute('data-doc-id');
      await page.mouse.move(caja1.x + caja1.width / 2, caja1.y + caja1.height / 2);
      await page.mouse.down();
      await page.mouse.move(cajaDestino.x + cajaDestino.width / 2, cajaDestino.y + cajaDestino.height / 2, { steps: 10 });
      await page.waitForTimeout(150);
      await page.mouse.up();
      await page.waitForTimeout(400);
      const ultimoIdDespues = await page.evaluate(() => {
        const items = document.querySelectorAll('.pdf-libro');
        return items[items.length - 1]?.dataset.docId;
      });
      comprobar(ultimoIdDespues === idArrastrado, 'arrastre físico con puntero posiciona la carátula en su nueva ubicación');
    }

    // Verificar persistencia tras recarga F5
    const idsAntesRecarga = await page.evaluate(() => Array.from(document.querySelectorAll('.pdf-libro')).map(x => x.dataset.docId));
    await page.reload();
    await page.waitForSelector('#pdfBiblioteca:not([hidden])', { timeout: 6000 });
    await page.waitForTimeout(400);

    const idsDespuesRecarga = await page.evaluate(() => Array.from(document.querySelectorAll('.pdf-libro')).map(x => x.dataset.docId));
    comprobar(
      JSON.stringify(idsAntesRecarga) === JSON.stringify(idsDespuesRecarga),
      `el orden manual personalizado sobrevive la recarga F5 (${idsDespuesRecarga.join(', ')})`
    );

    await ctx.close();
  }

} finally {
  await navegador.close();
  servidor.close();
}

if (fallos > 0) {
  console.error(`\n❌ ${fallos} pruebas fallaron.`);
  process.exit(1);
} else {
  console.log('\n✔ Verificación completa de carátulas movibles en móvil, tablet y escritorio exitosa.');
}
