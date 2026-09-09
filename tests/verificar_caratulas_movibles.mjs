/* JG Turbo · Verificación E2E del modo «Organizar» de la biblioteca PDF
 * (PDF-05/06 del plan UX/UI). Cubre: botón Organizar y su explicación con
 * <2 libros, filas temporales con tirador y botones, teclado Alt+flechas,
 * arrastre con Escape que cancela, Guardar que persiste y Cancelar que no.
 * Ejecutar: node tests/verificar_caratulas_movibles.mjs
 */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
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
console.log(`Probando el modo Organizar en ${BASE}/\n`);

const navegador = await chromium.launch({ headless: true });

const prepararLibros = async (page, cuantos = 3) => {
  await page.evaluate(async (n) => {
    /* Sin deleteDatabase: la app mantiene la base abierta y borrarla se
     * queda colgado en «blocked». Se limpian los almacenes y ya. */
    localStorage.removeItem('jg_pdf_orden_manual');
    localStorage.removeItem('jg_pdf_orden');
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
    docs.clear();
    cont.clear();
    const libros = [
      { id: 'doc-alfa', titulo: 'Alfa y Omega', actualizado: 1000, creado: 1000, estado: 'leyendo', paginasLeidas: 10, totalPaginas: 50, tienePortada: true, origenPortada: 'real' },
      { id: 'doc-beta', titulo: 'Beta Reader', actualizado: 2000, creado: 2000, estado: 'sin-empezar', paginasLeidas: 0, totalPaginas: 80, tienePortada: true, origenPortada: 'real' },
      { id: 'doc-gamma', titulo: 'Gamma Rays', actualizado: 3000, creado: 3000, estado: 'terminado', paginasLeidas: 100, totalPaginas: 100, tienePortada: true, origenPortada: 'real' },
    ].slice(0, n);
    for (const lib of libros) {
      docs.put(lib);
      cont.put({ id: lib.id, partes: [{ titulo: 'Capítulo 1', texto: 'Contenido de prueba para el libro ' + lib.titulo }] });
    }
    await new Promise((r) => { tx.oncomplete = r; });
    db.close();
  }, cuantos);
};

const abrirBiblioteca = async (page) => {
  /* Con la biblioteca vacía la sección está oculta: primero se espera a la
   * app, luego se siembran los libros y la recarga ya la muestra. */
  await page.goto(`${BASE}/?tab=pdf`);
  await page.waitForLoadState('load');
  await page.waitForTimeout(600);
};

const idsRejilla = (page) => page.evaluate(() =>
  Array.from(document.querySelectorAll('#pdfRejilla .pdf-libro')).map((x) => x.dataset.docId));

const idsOrganizar = (page) => page.evaluate(() =>
  Array.from(document.querySelectorAll('#pdfOrganizarLista .pdf-org-fila')).map((x) => x.dataset.docId));

try {
  /* ── 1. Móvil: entrar al modo, controles de fila y botones ────────── */
  console.log('── 1. Móvil (390×844): filas, botones y anuncio ──');
  {
    const ctx = await navegador.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true });
    const page = await ctx.newPage();
    await abrirBiblioteca(page);
    await prepararLibros(page, 3);
    await page.reload();
    await page.waitForSelector('#pdfBiblioteca:not([hidden])', { timeout: 8000 });
    await page.waitForTimeout(500);

    comprobar(await page.locator('#btnPdfOrganizar').isEnabled(), '«Organizar» está habilitado con 3 libros');
    comprobar((await page.locator('.pdf-libro .pdf-libro-arrastre').count()) === 0,
      'las tarjetas normales ya no llevan tirador permanente');

    await page.locator('#btnPdfOrganizar').click();
    await page.waitForTimeout(300);
    comprobar(await page.locator('#pdfOrganizar').isVisible(), 'al pulsar Organizar se abre la lista temporal');
    comprobar((await idsOrganizar(page)).length === 3, 'las filas muestran TODOS los libros (3)');
    comprobar(!(await page.locator('#pdfRejilla').isVisible()), 'la rejilla normal queda suspendida');
    comprobar(!(await page.locator('.pdf-biblioteca-filtros').isVisible()), 'los filtros quedan suspendidos');
    comprobar(!(await page.locator('#pdfBuscarLibro').isVisible()), 'la búsqueda queda suspendida');

    const tirador = page.locator('.pdf-org-fila').first().locator('.pdf-org-tirador');
    const cajaTirador = await tirador.boundingBox();
    comprobar(!!cajaTirador && cajaTirador.width >= 44 && cajaTirador.height >= 44,
      `el tirador mide ≥44×44 (${cajaTirador ? `${cajaTirador.width}×${cajaTirador.height}` : 'n/a'})`);

    const primera = page.locator('.pdf-org-fila').first();
    comprobar(await primera.locator('[data-mov="antes"]').isDisabled(), 'en la primera fila «Mover antes» está deshabilitado');
    const ultima = page.locator('.pdf-org-fila').last();
    comprobar(await ultima.locator('[data-mov="despues"]').isDisabled(), 'en la última fila «Mover después» está deshabilitado');

    const idPrimera = (await idsOrganizar(page))[0];
    await primera.locator('[data-mov="despues"]').click();
    await page.waitForTimeout(200);
    comprobar((await idsOrganizar(page))[1] === idPrimera, '«Mover después» baja la fila una posición');
    const anuncio = await page.locator('#pdfOrganizarLive').textContent();
    comprobar(/posición 2 de 3/.test(anuncio || ''), `el anuncio dice la posición («${anuncio}»)`);
    comprobar((await page.evaluate(() => localStorage.getItem('jg_pdf_orden_manual'))) === null,
      'mover con botones NO guarda todavía (orden temporal)');

    /* Teclado: Alt+flechas (sobre la fila que se movió, no sobre la que
     * ahora ocupa su sitio). */
    await page.locator(`.pdf-org-fila[data-doc-id="${idPrimera}"] .pdf-org-tirador`).focus();
    await page.keyboard.press('Alt+ArrowUp');
    await page.waitForTimeout(150);
    comprobar((await idsOrganizar(page))[0] === idPrimera, 'Alt+↑ devuelve la fila a la primera posición');

    /* Cancelar restaura y no persiste */
    await page.locator('#btnPdfOrganizarCancelar').click();
    await page.waitForTimeout(400);
    comprobar(!(await page.locator('#pdfOrganizar').isVisible()), 'Cancelar cierra el modo');
    comprobar(await page.locator('#pdfRejilla').isVisible(), 'y devuelve la rejilla');
    comprobar((await page.evaluate(() => localStorage.getItem('jg_pdf_orden_manual'))) === null,
      'Cancelar no escribió ningún orden en localStorage');
    await ctx.close();
  }

  /* ── 2. Guardar persiste; sobrevive F5 ─────────────────────────────── */
  console.log('\n── 2. Guardar orden persiste (tablet 820×1180) ──');
  {
    const ctx = await navegador.newContext({ viewport: { width: 820, height: 1180 }, hasTouch: true });
    const page = await ctx.newPage();
    await abrirBiblioteca(page);
    await prepararLibros(page, 3);
    await page.reload();
    await page.waitForSelector('#pdfBiblioteca:not([hidden])', { timeout: 8000 });
    await page.waitForTimeout(500);

    await page.locator('#btnPdfOrganizar').click();
    await page.waitForTimeout(300);
    const primera = page.locator('.pdf-org-fila').first();
    const idPrimera = (await idsOrganizar(page))[0];
    await primera.locator('[data-mov="despues"]').click();
    await page.locator('#btnPdfOrganizarGuardar').click();
    await page.waitForTimeout(500);
    const guardado = await page.evaluate(() => localStorage.getItem('jg_pdf_orden_manual'));
    comprobar(guardado !== null && JSON.parse(guardado).length === 3, 'Guardar escribió el orden completo en jg_pdf_orden_manual');
    comprobar(await page.evaluate(() => localStorage.getItem('jg_pdf_orden')) === 'personalizado',
      'y fijó el modo de orden en «personalizado»');
    comprobar((await idsRejilla(page))[1] === idPrimera, 'la rejilla refleja el orden guardado');

    await page.reload();
    await page.waitForSelector('#pdfBiblioteca:not([hidden])', { timeout: 8000 });
    await page.waitForTimeout(500);
    comprobar((await idsRejilla(page))[1] === idPrimera, 'el orden guardado sobrevive la recarga F5');
    await ctx.close();
  }

  /* ── 3. Escritorio: arrastre con puntero y Escape que cancela ─────── */
  console.log('\n── 3. Escritorio (1280×800): arrastre y Escape ──');
  {
    const ctx = await navegador.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await ctx.newPage();
    await abrirBiblioteca(page);
    await prepararLibros(page, 3);
    await page.reload();
    await page.waitForSelector('#pdfBiblioteca:not([hidden])', { timeout: 8000 });
    await page.waitForTimeout(500);

    await page.locator('#btnPdfOrganizar').click();
    await page.waitForTimeout(300);
    const ordenAlEntrar = await idsOrganizar(page);
    const idPrimera = ordenAlEntrar[0];

    const tirador = page.locator('.pdf-org-fila').first().locator('.pdf-org-tirador');
    const cajaTirador = await tirador.boundingBox();
    const destino = await page.locator('.pdf-org-fila').last().boundingBox();
    comprobar(!!cajaTirador && !!destino, 'hay filas medibles para arrastrar');
    if (cajaTirador && destino) {
      /* Se suta en la mitad INFERIOR de la última fila: ahí la fila
       * arrastrada queda al final. */
      const yDestino = destino.y + destino.height * 0.8;
      await page.mouse.move(cajaTirador.x + cajaTirador.width / 2, cajaTirador.y + cajaTirador.height / 2);
      await page.mouse.down();
      await page.mouse.move(destino.x + destino.width / 2, yDestino, { steps: 12 });
      await page.waitForTimeout(120);
      const duranteArrastre = await idsOrganizar(page);
      comprobar(duranteArrastre[duranteArrastre.length - 1] === idPrimera,
        'el arrastre lleva la primera fila al final (orden temporal)');
      comprobar((await page.evaluate(() => localStorage.getItem('jg_pdf_orden_manual'))) === null,
        'el arrastre tampoco guarda por sí solo');

      /* Escape durante el arrastre: cancela y repone el orden del inicio
       * del arrastre (PDF-06). */
      await page.keyboard.press('Escape');
      await page.waitForTimeout(200);
      comprobar(JSON.stringify(await idsOrganizar(page)) === JSON.stringify(ordenAlEntrar),
        'Escape cancela el arrastre y repone el orden de ese arrastre');
      await page.mouse.up();
      await page.waitForTimeout(150);

      /* Reponer, arrastrar de verdad y soltar fuera: sigue sin guardar. */
      await page.mouse.move(cajaTirador.x + cajaTirador.width / 2, cajaTirador.y + cajaTirador.height / 2);
      await page.mouse.down();
      await page.mouse.move(destino.x + destino.width / 2, yDestino, { steps: 12 });
      await page.mouse.up();
      await page.waitForTimeout(300);
      comprobar((await idsOrganizar(page)).at(-1) === idPrimera, 'soltar deja la fila donde se soltó');
      comprobar((await page.evaluate(() => localStorage.getItem('jg_pdf_orden_manual'))) === null,
        'soltar el arrastre sigue sin persistir: solo Guardar persiste');

      /* Escape sin arrastre: cancela el modo entero. */
      await page.keyboard.press('Escape');
      await page.waitForTimeout(400);
      comprobar(!(await page.locator('#pdfOrganizar').isVisible()),
        'Escape sin arrastre cancela el modo Organizar');
      comprobar(JSON.stringify(await idsRejilla(page)) === JSON.stringify(ordenAlEntrar),
        'y la rejilla conserva el orden anterior');
      comprobar((await page.evaluate(() => localStorage.getItem('jg_pdf_orden_manual'))) === null,
        'nada quedó guardado');
    }
    await ctx.close();
  }

  /* ── 4. Con un solo libro, Organizar deshabilitado y explicado ────── */
  console.log('\n── 4. Un libro: deshabilitado y explicado ──');
  {
    const ctx = await navegador.newContext({ viewport: { width: 390, height: 844 } });
    const page = await ctx.newPage();
    await abrirBiblioteca(page);
    await prepararLibros(page, 1);
    await page.reload();
    await page.waitForSelector('#pdfBiblioteca:not([hidden])', { timeout: 8000 });
    await page.waitForTimeout(500);
    const btn = page.locator('#btnPdfOrganizar');
    comprobar(await btn.isDisabled(), 'con un solo libro «Organizar» está deshabilitado');
    const titulo = await btn.getAttribute('title');
    comprobar(/al menos dos libros/.test(titulo || ''), `y su título explica por qué («${titulo}»)`);
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
  console.log('\n✔ Verificación del modo Organizar completada con éxito.');
}
