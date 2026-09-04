/* Verificación del lector de PDF en un navegador de verdad.
 *
 *   node tests/verificar_pdf_navegador.mjs
 *
 * Levanta su propio servidor, genera sus propios PDF y comprueba:
 *   1. Un documento normal, en escritorio y en móvil.
 *   2. Un libro de 300 páginas: capítulos, índice, progreso y descargas.
 *   3. Los casos feos: escaneado, dañado, no-PDF y cancelar a mitad.
 *   4. Audiolibro y exportación a Word, PDF y Markdown.
 *   5. OCR sobre un escaneado con letras de verdad.
 *   6. La biblioteca: guardar, cerrar la app, volver y seguir donde iba.
 *   7. Traducción: detectar el idioma y ofrecer leerlo en español.
 *   8. Kindle: lote local, formatos bloqueados, duplicados y cancelación.
 *
 * Requiere Playwright instalado en la raíz del repo (node_modules/playwright).
 */
import { createServer } from 'node:http';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, extname, resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { crearLibro, crearLibroIngles, crearEscaneado, crearRoto } from './generarPdfPrueba.mjs';
import { pintarPaginaComoImagen, pdfDeImagenes, PAGINAS_ESCANEADAS } from './generarPdfEscaneado.mjs';

const AQUI = dirname(fileURLToPath(import.meta.url));
const APP = resolve(AQUI, '..');

/* Playwright no es dependencia del proyecto: se busca donde suela estar. La
 * ruta única anterior dejó de existir al aplanar el repo y esta verificación
 * quedó inejecutable sin que nadie se enterara. */
const { chromium, devices } = await (async () => {
  const candidatos = [
    resolve(APP, 'node_modules', 'playwright', 'index.mjs'),
    resolve(APP, '..', 'node_modules', 'playwright', 'index.mjs'),
    resolve(APP, '..', 'JG Turbo_OLD', 'node_modules', 'playwright', 'index.mjs'),
  ];
  for (const ruta of candidatos) {
    try { return await import(pathToFileURL(ruta).href); } catch (_) { /* siguiente */ }
  }
  console.error('Falta Playwright: instálalo con «npm i -D playwright».');
  console.error('Buscado en:\n  ' + candidatos.join('\n  '));
  process.exit(1);
})();

let fallos = 0;
const comprobar = (condicion, mensaje) => {
  if (condicion) console.log(`OK: ${mensaje}`);
  else { fallos += 1; console.error(`FALLO: ${mensaje}`); }
};

/* ── Servidor estático mínimo ──────────────────────────────────────── */
const TIPOS = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.json': 'application/json',
  '.webmanifest': 'application/manifest+json', '.png': 'image/png',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.pdf': 'application/pdf',
};
const servidor = createServer(async (peticion, respuesta) => {
  try {
    const url = new URL(peticion.url, `http://127.0.0.1:${servidor.address()?.port || 8000}`);
    const rutaRelativa = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname).replace(/^\/+/, '');
    const ruta = join(APP, rutaRelativa);
    const datos = await readFile(ruta);
    respuesta.writeHead(200, { 'Content-Type': TIPOS[extname(ruta)] || 'application/octet-stream' });
    respuesta.end(datos);
  } catch {
    respuesta.writeHead(404).end('no encontrado');
  }
});
await new Promise((listo) => servidor.listen(0, '127.0.0.1', listo));
const PUERTO = servidor.address().port;
const BASE = `http://127.0.0.1:${PUERTO}/`;

/* ── PDFs de prueba ────────────────────────────────────────────────── */
const temporal = await mkdtemp(join(tmpdir(), 'jg-pdf-'));
const LIBRO = join(temporal, 'libro_prueba.pdf');
const GRANDE = join(temporal, 'libro_grande.pdf');
const INGLES = join(temporal, 'english_book.pdf');
const ESCANEADO = join(temporal, 'escaneado.pdf');
const ROTO = join(temporal, 'roto.pdf');
const NO_PDF = join(temporal, 'notas.txt');
const KFX = join(temporal, 'libro_protegido.kfx');
const PROTEGIDO = join(temporal, 'pdf_con_clave.pdf');
crearLibro(LIBRO, 4);
crearLibro(GRANDE, 300);
crearLibroIngles(INGLES, 6);
crearEscaneado(ESCANEADO);
crearRoto(ROTO);
writeFileSync(NO_PDF, 'esto es un texto suelto, no un pdf');
writeFileSync(KFX, 'archivo de prueba que JG Turbo no debe intentar convertir');
writeFileSync(PROTEGIDO, Buffer.from(
  'JVBERi0xLjMKJeLjz9MKMSAwIG9iago8PAovUHJvZHVjZXIgPGI5ZDliOWY3ZTg+Cj4+CmVuZG9iagoyIDAgb2JqCjw8Ci9UeXBlIC9QYWdlcwovQ291bnQgMQovS2lkcyBbIDQgMCBSIF0KPj4KZW5kb2JqCjMgMCBvYmoKPDwKL1R5cGUgL0NhdGFsb2cKL1BhZ2VzIDIgMCBSCj4+CmVuZG9iago0IDAgb2JqCjw8Ci9UeXBlIC9QYWdlCi9SZXNvdXJjZXMgPDwKPj4KL01lZGlhQm94IFsgMC4wIDAuMCA2MTIgNzkyIF0KL1BhcmVudCAyIDAgUgo+PgplbmRvYmoKNSAwIG9iago8PAovViAyCi9SIDMKL0xlbmd0aCAxMjgKL1AgNDI5NDk2NzI5MgovRmlsdGVyIC9TdGFuZGFyZAovTyA8YWVkZGFjNDliZmUwNmI0NDcyYTRmZTYyMjdjNGZjMGY3YWUzOTZlYTNiZmVhMmJjMmM1OGE4NTIwYTQ2YmY0YT4KL1UgPDQxNGVlNGYzMGNhNzM3ZWEzMTNlZDcwNjRhZGJmM2MzMjhiZjRlNWU0ZTc1OGE0MTY0MDA0ZTU2ZmZmYTAxMDg+Cj4+CmVuZG9iagp4cmVmCjAgNgowMDAwMDAwMDAwIDY1NTM1IGYgCjAwMDAwMDAwMTUgMDAwMDAgbiAKMDAwMDAwMDA1OSAwMDAwMCBuIAowMDAwMDAwMTE4IDAwMDAwIG4gCjAwMDAwMDAxNjcgMDAwMDAgbiAKMDAwMDAwMDI2MSAwMDAwMCBuIAp0cmFpbGVyCjw8Ci9TaXplIDYKL1Jvb3QgMyAwIFIKL0luZm8gMSAwIFIKL0lEIFsgPDM1NjEzMTMyNjIzNzY0MzczODM1NjEzNjY0MzUzNTM3MzUzNjM5NjI2MjM3MzA2NDMyMzQzMjMyNjEzNzMwMzk+IDwzNTYxMzEzMjYyMzc2NDM3MzgzNTYxMzY2NDM1MzUzNzM1MzYzOTYyNjIzNzMwNjQzMjM0MzIzMjYxMzczMDM5PiBdCi9FbmNyeXB0IDUgMCBSCj4+CnN0YXJ0eHJlZgo0NzYKJSVFT0YK',
  'base64'
));

const navegador = await chromium.launch({ headless: !process.argv.includes('--headed') });

async function abrirPestana(pagina) {
  await pagina.goto(BASE, { waitUntil: 'domcontentloaded' });
  await pagina.waitForTimeout(600);
  await pagina.locator('#tabPdf').click();
  await pagina.waitForTimeout(400);
}

async function nuevaPagina(opciones) {
  const contexto = await navegador.newContext(opciones);
  /* En modo visible, la vista «PDF limpio» abre el diálogo nativo de
   * impresión. Ese diálogo no pertenece al DOM y bloquea Playwright. Se
   * neutraliza solo en la prueba; la página imprimible y su contenido se
   * siguen verificando completos en la pestaña nueva. */
  if (process.argv.includes('--headed')) {
    await contexto.addInitScript(() => { window.print = () => {}; });
  }
  const pagina = await contexto.newPage();
  /* La hoja de permiso para revisar la puntuación con IA puede aparecer en
   * cualquier momento (al elegir el archivo, al extraer, al cambiar de
   * capítulo). Cerrarla en un punto concreto no basta: en cuanto se abre, tapa
   * la pantalla y el siguiente clic falla con un timeout que no explica nada.
   * Se responde «solo local» en cuanto asoma, que además es lo que debe hacer
   * una prueba: no mandar ni una petición a la IA. */
  await pagina.addInitScript(() => {
    const cerrar = () => {
      const hoja = document.getElementById('pdfAuditoriaHoja');
      if (!hoja || hoja.hidden) return;
      const no = document.getElementById('btnPdfAuditoriaRechazar');
      if (no) no.click(); else hoja.hidden = true;
    };
    document.addEventListener('DOMContentLoaded', () => {
      cerrar();
      new MutationObserver(cerrar).observe(document.body, {
        subtree: true, attributes: true, attributeFilter: ['hidden'], childList: true,
      });
    });
  });
  const errores = [];
  pagina.on('pageerror', (e) => errores.push(String(e)));
  pagina.on('console', (m) => { if (m.type() === 'error') errores.push(m.text()); });
  await abrirPestana(pagina);
  return { pagina, errores, contexto };
}

const sinRuido = (errores) =>
  errores.filter((e) => !/favicon|manifest|sw\.js|Service Worker|api\/|health|Failed to load resource/i.test(e));

/* El aviso vive en dos sitios: en la biblioteca va en la columna y, con el
 * libro abierto, en el dock junto al reproductor. Aquí da igual cuál sea. */
const avisoVisible = (pagina) => pagina.evaluate(() => {
  const cajas = ['pdfNotice', 'pdfNoticeLector'].map((id) => document.getElementById(id));
  const activa = cajas.find((c) => c && !c.hidden);
  return { texto: (activa?.textContent || '').trim(), clase: activa?.className || '' };
});

/**
 * Cierra la hoja que pide permiso para revisar la puntuación con IA.
 *
 * Apareció en la v2.28.0 y esta verificación no la conocía: se quedaba abierta
 * tapando la pantalla y todos los clics siguientes fallaban con un timeout que
 * no decía nada del problema real. Se responde «solo local», que además es lo
 * correcto en una prueba: no debe salir ni una petición a la IA.
 */
async function cerrarHojaConsentimiento(pagina) {
  const hoja = pagina.locator('#pdfAuditoriaHoja');
  if (!(await hoja.isVisible().catch(() => false))) return;
  await pagina.locator('#btnPdfAuditoriaRechazar').click({ timeout: 3000 }).catch(async () => {
    /* Si el botón no se deja pulsar, se cierra por código: aquí interesa
     * seguir verificando la app, no pelearse con una hoja. */
    await pagina.evaluate(() => {
      const h = document.getElementById('pdfAuditoriaHoja');
      if (h) h.hidden = true;
    });
  });
  await pagina.waitForTimeout(200);
}

async function leer(pagina, archivo, espera = 90000) {
  await pagina.locator('#pdfInput').setInputFiles(archivo);
  await pagina.waitForTimeout(300);
  await cerrarHojaConsentimiento(pagina);
  if (await pagina.locator('#btnPdfRead').isDisabled()) return null;
  await pagina.locator('#btnPdfRead').click();
  await pagina.waitForFunction(() => {
    const avisos = ['pdfNotice', 'pdfNoticeLector'].map((id) => document.getElementById(id));
    const res = document.getElementById('pdfResultArea');
    return avisos.some((a) => a && !a.hidden) || (res && res.style.display !== 'none');
  }, null, { timeout: espera }).catch(() => {});
  await pagina.waitForTimeout(700);
  /* Puede aparecer también al terminar de extraer, no solo al elegir. */
  await cerrarHojaConsentimiento(pagina);
  return (await avisoVisible(pagina)).texto;
}

/* ── 1) Documento normal, en las dos pantallas ─────────────────────── */
for (const [nombre, opciones] of [
  ['escritorio', { viewport: { width: 1280, height: 900 } }],
  ['móvil', devices['Pixel 7']],
]) {
  console.log(`\n── Documento normal · ${nombre} ──────────────`);
  const { pagina, errores, contexto } = await nuevaPagina(opciones);

  comprobar(await pagina.locator('#tabCap').count() === 0, 'la pestaña Captura ya no existe');
  comprobar(await pagina.locator('#panelPdf').isVisible(), 'el panel PDF se abre desde su pestaña');
  comprobar(await pagina.locator('#pdfBiblioteca').isHidden(), 'sin documentos guardados no se muestra la biblioteca');
  comprobar(await pagina.locator('#btnPdfRead').isDisabled(), 'el botón de leer arranca apagado');

  await leer(pagina, LIBRO);
  const texto = await pagina.locator('#pdfOutput').inputValue();
  comprobar(texto.length > 200, 'sale el texto del documento');
  comprobar(texto.includes('ventanas'), 'une la palabra cortada con guion al final del renglón');
  comprobar(!texto.includes('HISTORIA DE PRUEBA'), 'quita el encabezado repetido de todas las páginas');
  comprobar(!/\n\s*\d+\s*\n/.test(`\n${texto}\n`), 'quita los números de página sueltos');
  comprobar(texto.includes('CAPITULO I'), 'conserva los títulos de capítulo');
  comprobar(texto.includes('niebla espesa que apenas dejaba'), 'une los renglones del mismo párrafo');
  for (const id of ['btnPdfCopy', 'btnPdfTxt']) {
    comprobar(!(await pagina.locator(`#${id}`).isDisabled()), `el botón ${id} queda activo`);
  }
  comprobar(await pagina.locator('[data-tts-console="pdf"]').count() === 1, 'la consola de voz está montada');

  /* El buscador vive plegado tras la lupa de la cabecera: en el celular una
     fila fija de búsqueda le quitaba alto al texto durante toda la lectura. */
  await pagina.locator('#btnPdfBuscarToggle').click();
  await pagina.waitForTimeout(250);
  comprobar(!(await pagina.locator('#pdfSearchRow').isHidden()), 'la lupa despliega el buscador');

  await pagina.locator('#pdfSearch').fill('niebla');
  await pagina.waitForTimeout(500);
  comprobar(/\d+ de \d+/.test(await pagina.locator('#pdfSearchInfo').textContent() || ''), 'el buscador encuentra');
  await pagina.locator('#pdfSearch').fill('zzzznoexiste');
  await pagina.waitForTimeout(500);
  comprobar(
    (await pagina.locator('#pdfSearchInfo').textContent())?.includes('Sin resultados'),
    'el buscador avisa cuando no hay nada'
  );

  await pagina.locator('#btnPdfBack').click();
  await pagina.waitForTimeout(600);
  comprobar(await pagina.locator('#pdfResultArea').isHidden(), 'volver cierra el documento');
  comprobar((await pagina.locator('#pdfRejilla .pdf-libro').count()) === 1, 'el documento queda en la biblioteca');

  comprobar(sinRuido(errores).length === 0, `sin errores de JavaScript (${sinRuido(errores).length})`);
  sinRuido(errores).slice(0, 3).forEach((e) => console.error('   →', e.slice(0, 180)));
  await contexto.close();
}

/* ── 1b) Un documento corto CON capítulos también trae índice ──────── */
console.log('\n── Documento corto con capítulos ─────────────');
{
  const { pagina, errores, contexto } = await nuevaPagina({ viewport: { width: 1280, height: 900 } });
  const MEDIANO = join(temporal, 'libro_mediano.pdf');
  crearLibro(MEDIANO, 60);
  await leer(pagina, MEDIANO, 60000);

  if (await pagina.locator('#btnPdfIndice').isVisible()) {
    await pagina.locator('#btnPdfIndice').click();
    await pagina.waitForTimeout(400);
  }
  const capitulos = await pagina.locator('#pdfIndiceLista .pdf-cap').count();
  comprobar(capitulos > 1, `un libro corto con capítulos sí muestra su índice (${capitulos})`);
  comprobar(await pagina.locator('#pdfNavbar').isVisible(), 'y su navegación entre capítulos');

  await pagina.locator('#pdfIndiceLista .pdf-cap').nth(2).click();
  await pagina.waitForTimeout(600);
  comprobar(
    (await pagina.locator('#pdfNavPos').textContent())?.startsWith('3 de'),
    'se puede saltar a un capítulo concreto'
  );

  comprobar(sinRuido(errores).length === 0, `sin errores de JavaScript (${sinRuido(errores).length})`);
  await contexto.close();
}

/* ── 2) Un libro de 300 páginas ────────────────────────────────────── */
console.log('\n── Libro de 300 páginas ──────────────────────');
{
  const { pagina, errores, contexto } = await nuevaPagina(devices['Pixel 7']);
  await pagina.locator('#pdfInput').setInputFiles(GRANDE);
  await pagina.waitForTimeout(250);
  const arranque = Date.now();
  await pagina.locator('#btnPdfRead').click();
  await pagina.waitForTimeout(1000);

  const etiqueta = await pagina.locator('#pdfProgLabel').textContent();
  comprobar(/página \d+ de \d+/.test(etiqueta || ''), `el avance dice por dónde va (${(etiqueta || '').trim()})`);

  await pagina.waitForFunction(
    () => document.getElementById('pdfResultArea')?.style.display !== 'none',
    null, { timeout: 120000 }
  );
  const segundos = (Date.now() - arranque) / 1000;
  await pagina.waitForTimeout(800);

  await pagina.locator('#btnPdfIndice').click();
  await pagina.waitForTimeout(400);
  const capitulos = await pagina.locator('#pdfIndiceLista .pdf-cap').count();
  const enPantalla = (await pagina.locator('#pdfOutput').inputValue()).length;
  console.log(`   ${segundos.toFixed(1)} s · ${capitulos} capítulos · ${enPantalla} caracteres en pantalla`);

  comprobar(segundos < 60, `300 páginas en menos de un minuto (${segundos.toFixed(1)} s)`);
  comprobar(capitulos > 1, `el libro se divide en capítulos navegables (${capitulos})`);
  comprobar(enPantalla < 200000, 'el editor carga un capítulo, no el libro entero');
  comprobar(
    (await pagina.locator('#pdfIndiceLista .pdf-cap').first().textContent())?.includes('CAPITULO'),
    'los capítulos llevan su nombre real'
  );
  comprobar(
    await pagina.locator('#pdfIndiceLista .pdf-cap[aria-current="true"]').count() === 1,
    'el índice marca el capítulo actual'
  );

  await pagina.locator('#pdfIndiceLista .pdf-cap').nth(4).click();
  await pagina.waitForTimeout(700);
  comprobar(
    (await pagina.locator('#pdfNavPos').textContent())?.startsWith('5 de'),
    'salta al capítulo elegido en el índice'
  );
  comprobar(
    Number(await pagina.locator('#pdfProgresoDoc').getAttribute('aria-valuenow')) > 0,
    'la barra de progreso del documento avanza'
  );

  await pagina.locator('#btnPdfNext').click();
  await pagina.waitForTimeout(500);
  comprobar(
    (await pagina.locator('#pdfNavPos').textContent())?.startsWith('6 de'),
    'el botón siguiente avanza de capítulo'
  );

  if (await pagina.locator('#pdfSearchRow').isHidden()) {
    await pagina.locator('#btnPdfBuscarToggle').click();
    await pagina.waitForTimeout(250);
  }
  await pagina.locator('#pdfSearch').fill('promesa');
  await pagina.waitForTimeout(700);
  comprobar(
    /\d+ de \d+/.test(await pagina.locator('#pdfSearchInfo').textContent() || ''),
    'el buscador recorre el libro completo, no solo el capítulo visible'
  );

  await pagina.evaluate(() => {
    const m = document.getElementById('pdfMasMenu');
    if (m) m.open = true;
  });
  await pagina.waitForTimeout(300);
  const descarga = await Promise.all([
    pagina.waitForEvent('download', { timeout: 20000 }),
    pagina.locator('#btnPdfTxt').click(),
  ]).then(([d]) => d).catch(() => null);
  if (!descarga) {
    comprobar(false, 'el botón .txt descarga el documento');
  } else {
    const guardado = readFileSync(await descarga.path(), 'utf8');
    comprobar(guardado.length > enPantalla * 2,
      `el .txt trae el libro completo (${guardado.length} caracteres, no ${enPantalla})`);
  }

  comprobar(sinRuido(errores).length === 0, `sin errores de JavaScript (${sinRuido(errores).length})`);
  await contexto.close();
}

/* ── 3) Los casos feos ─────────────────────────────────────────────── */
console.log('\n── Casos límite ──────────────────────────────');
{
  const { pagina, errores, contexto } = await nuevaPagina({ viewport: { width: 1280, height: 900 } });

  const avisoEscaneado = await leer(pagina, ESCANEADO);
  comprobar(/imágenes|escaneo|no tiene texto/i.test(avisoEscaneado || ''), 'explica que un PDF escaneado no trae texto');
  comprobar(await pagina.locator('#pdfOcrBox').isVisible(), 'ofrece reconocerlo con OCR');
  comprobar(await pagina.locator('#pdfResultArea').isHidden(), 'no abre un resultado vacío');

  const avisoRoto = await leer(pagina, ROTO);
  comprobar(/dañado|no es un PDF|no se pudo/i.test(avisoRoto || ''), 'avisa cuando el archivo está dañado');

  await pagina.locator('#pdfInput').setInputFiles(NO_PDF);
  await pagina.waitForTimeout(400);
  comprobar(
    /no es un PDF/i.test((await avisoVisible(pagina)).texto),
    'rechaza un archivo que no es PDF'
  );

  await pagina.locator('#pdfInput').setInputFiles(GRANDE);
  await pagina.waitForTimeout(250);
  await pagina.locator('#btnPdfRead').click();
  await pagina.locator('#btnPdfCancel').waitFor({ state: 'visible', timeout: 8000 });
  await pagina.locator('#btnPdfCancel').click({ force: true });
  await pagina.waitForTimeout(2500);
  comprobar(/cancel/i.test((await avisoVisible(pagina)).texto), 'confirma la cancelación');
  comprobar(await pagina.locator('#pdfProgArea').isHidden(), 'la barra de progreso se va al cancelar');

  await leer(pagina, LIBRO, 40000);
  comprobar(await pagina.locator('#pdfResultArea').isVisible(), 'tras cancelar, otro documento se lee bien');

  comprobar(sinRuido(errores).length === 0, `sin errores de JavaScript (${sinRuido(errores).length})`);
  sinRuido(errores).slice(0, 3).forEach((e) => console.error('   →', e.slice(0, 180)));
  await contexto.close();
}

/* ── 4) Audiolibro y exportación ───────────────────────────────────── */
console.log('\n── Audiolibro y exportación ──────────────────');
{
  const { pagina, errores, contexto } = await nuevaPagina({ viewport: { width: 1366, height: 950 } });
  await leer(pagina, GRANDE, 120000);

  await pagina.evaluate(() => {
    const m = document.getElementById('pdfMasMenu');
    if (m) m.open = true;
  });
  await pagina.waitForTimeout(400);
  comprobar(await pagina.locator('#pdfAudiolibroBox').isVisible(), 'el audiolibro aparece en un libro largo');
  await pagina.locator('#btnPdfAudiolibro').click();
  await pagina.waitForTimeout(800);
  comprobar(
    await pagina.locator('#btnPdfAudiolibro').evaluate((b) => b.classList.contains('is-on')),
    'al pulsarlo queda en marcha'
  );

  const encadenado = await pagina.evaluate(() => {
    const enlace = window.jgAudiolibro;
    if (!enlace || !enlace.activo || typeof enlace.siguiente !== 'function') return null;
    const primera = enlace.siguiente();
    const segunda = enlace.siguiente();
    return {
      posicion: document.getElementById('pdfNavPos').textContent,
      /* El libro de prueba repite el mismo párrafo en las 300 páginas, así que
         dos capítulos seguidos SÍ pueden tener el mismo texto: lo que importa
         es que cada eslabón traiga algo que leer y que la posición avance. */
      ok: Boolean(primera?.texto?.length > 50 && segunda?.texto?.length > 50),
    };
  });
  comprobar(encadenado?.ok === true, 'cada capítulo encadenado trae texto que leer');
  comprobar(/3 de \d+/.test(encadenado?.posicion || ''), `avanza al encadenar (${encadenado?.posicion})`);

  await pagina.locator('#btnPdfAudiolibro').click();
  await pagina.waitForTimeout(400);
  comprobar(
    !(await pagina.locator('#btnPdfAudiolibro').evaluate((b) => b.classList.contains('is-on'))),
    'se puede detener la lectura'
  );

  const enPantalla = (await pagina.locator('#pdfOutput').inputValue()).length;
  for (const [boton, extension, minimo] of [
    ['#btnPdfDocx', '.docx', 20000],
    ['#btnPdfMd', '.md', enPantalla * 2],
  ]) {
    const descarga = await Promise.all([
      pagina.waitForEvent('download', { timeout: 20000 }),
      pagina.locator(boton).click(),
    ]).then(([d]) => d).catch(() => null);
    if (!descarga) { comprobar(false, `${boton} descarga un archivo`); continue; }
    const bytes = readFileSync(await descarga.path());
    comprobar(descarga.suggestedFilename().endsWith(extension), `el archivo descargado es un ${extension}`);
    comprobar(bytes.length > minimo, `el ${extension} trae el documento completo (${bytes.length} bytes)`);
    if (extension === '.docx') {
      comprobar(bytes[0] === 0x50 && bytes[1] === 0x4b, 'el .docx es un paquete ZIP válido');
    }
  }

  const nueva = await Promise.all([
    contexto.waitForEvent('page', { timeout: 15000 }),
    pagina.locator('#btnPdfPrint').click(),
  ]).then(([p]) => p).catch(() => null);
  if (!nueva) comprobar(false, 'el botón de PDF abre la vista de impresión');
  else {
    await nueva.waitForTimeout(600);
    const contenido = await nueva.content();
    comprobar(contenido.includes('<h1>'), 'la vista de impresión trae el título');
    comprobar((contenido.match(/<h2>/g) || []).length > 1, 'y conserva los capítulos');
    await nueva.close();
  }

  await pagina.evaluate(() => {
    const m = document.getElementById('pdfMasMenu');
    if (m) m.open = true;
    const p = document.getElementById('pdfDocPreguntas');
    if (p) p.open = true;
  });
  await pagina.waitForTimeout(300);
  comprobar(await pagina.locator('#btnPdfSummaryAll').isVisible(), 'ofrece resumir el documento completo');
  comprobar(sinRuido(errores).length === 0, `sin errores de JavaScript (${sinRuido(errores).length})`);
  await contexto.close();
}

/* ── 5) OCR sobre un escaneado de verdad ───────────────────────────── */
console.log('\n── OCR de un escaneado con letras ────────────');
{
  const { pagina, errores, contexto } = await nuevaPagina({ viewport: { width: 1366, height: 900 } });

  const jpegs = [];
  for (const lineas of PAGINAS_ESCANEADAS) jpegs.push(await pintarPaginaComoImagen(pagina, lineas));
  const CON_LETRAS = join(temporal, 'escaneado_con_letras.pdf');
  pdfDeImagenes(jpegs, CON_LETRAS);

  await leer(pagina, CON_LETRAS);
  comprobar(await pagina.locator('#pdfOcrBox').isVisible(), 'ofrece reconocer las letras con OCR');

  await pagina.locator('#pdfOcrLang').selectOption('spa');
  await pagina.locator('#pdfOcrPaginas').selectOption('10');
  const arranque = Date.now();
  await pagina.locator('#btnPdfOcr').click();
  await pagina.waitForFunction(
    () => document.getElementById('pdfResultArea')?.style.display !== 'none' ||
          ['pdfNotice','pdfNoticeLector'].some((id)=>(document.getElementById(id)?.className||'').includes('err') && !document.getElementById(id).hidden),
    null, { timeout: 240000 }
  );
  await pagina.waitForTimeout(600);

  const texto = (await pagina.locator('#pdfOutput').inputValue()).toLowerCase();
  console.log(`   OCR de 2 páginas en ${((Date.now() - arranque) / 1000).toFixed(1)} s`);
  comprobar(texto.includes('biblioteca'), 'reconoce la palabra «biblioteca»');
  comprobar(texto.includes('ernesto'), 'reconoce el nombre propio «Ernesto»');
  comprobar(
    ((await avisoVisible(pagina)).texto).includes('OCR'),
    'avisa que el texto salió de un reconocimiento'
  );

  comprobar(sinRuido(errores).length === 0, `sin errores de JavaScript (${sinRuido(errores).length})`);
  await contexto.close();
}

/* ── 6) Biblioteca: guardar, cerrar la app y volver ────────────────── */
console.log('\n── Biblioteca y continuidad ──────────────────');
{
  /* Un solo contexto para toda la sección: hay que recargar la página y
   * comprobar que lo guardado sigue ahí, que es lo que hace el usuario al
   * apagar el equipo y volver al día siguiente. */
  const contexto = await navegador.newContext({ viewport: { width: 1280, height: 1000 } });
  const pagina = await contexto.newPage();
  const errores = [];
  pagina.on('pageerror', (e) => errores.push(String(e)));
  pagina.on('console', (m) => { if (m.type() === 'error') errores.push(m.text()); });

  await abrirPestana(pagina);
  await leer(pagina, GRANDE, 120000);
  comprobar(
    ((await avisoVisible(pagina)).texto).includes('biblioteca'),
    'al procesarlo avisa que quedó guardado'
  );

  if (await pagina.locator('#btnPdfIndice').isVisible()) {
    await pagina.locator('#btnPdfIndice').click();
    await pagina.waitForTimeout(400);
  }
  await pagina.locator('#pdfIndiceLista .pdf-cap').nth(5).click();
  await pagina.waitForTimeout(1500);   /* deja que se guarde el progreso */

  await abrirPestana(pagina);          /* recarga completa: como cerrar la app */
  comprobar(await pagina.locator('#pdfBiblioteca').isVisible(), 'la biblioteca sobrevive al cierre');
  comprobar((await pagina.locator('#pdfRejilla .pdf-libro').count()) >= 1, 'el documento sigue guardado');
  comprobar(await pagina.locator('#pdfContinuar').isVisible(), 'ofrece «seguir leyendo»');

  await pagina.locator('#btnPdfContinuar').click();
  await pagina.waitForTimeout(1300);
  comprobar(await pagina.locator('#pdfResultArea').isVisible(), 'continúa sin volver a subir el archivo');
  comprobar(
    (await pagina.locator('#pdfNavPos').textContent())?.startsWith('6 de'),
    'vuelve al capítulo exacto donde se quedó'
  );
  comprobar(
    (await pagina.locator('#pdfOutput').inputValue()).length > 100,
    'el texto está completo, sin reprocesar el PDF'
  );

  await pagina.locator('#btnPdfBack').click();
  await pagina.waitForTimeout(700);
  comprobar(
    (await pagina.locator('#pdfRejilla .pdf-libro-estado').first().textContent()) === 'Leyendo',
    'el documento en curso se marca como «Leyendo»'
  );

  await pagina.locator('.pdf-filtro[data-filtro="terminado"]').click();
  await pagina.waitForTimeout(400);
  comprobar(
    (await pagina.locator('#pdfRejilla .pdf-libro').count()) === 0 &&
    !(await pagina.locator('#pdfBibliotecaVacia').isHidden()),
    'el filtro «Terminados» no muestra nada y lo dice'
  );
  await pagina.locator('.pdf-filtro[data-filtro="todos"]').click();
  await pagina.waitForTimeout(400);

  /* Los botones del menú se buscan por su texto, no por su posición: con
   * `nth(1)` la prueba se rompía en cuanto se añadía una opción al menú, y el
   * fallo señalaba a «borrar» cuando el cambio no tenía nada que ver. */
  const tarjeta = pagina.locator('#pdfRejilla .pdf-libro').first();
  const opcion = (nombre) => tarjeta.locator('.pdf-libro-menu-pop .mini-btn', { hasText: nombre });

  await tarjeta.locator('details.pdf-libro-menu').evaluate((m) => { m.open = true; });
  await opcion('Reiniciar').click();
  await pagina.waitForTimeout(800);
  comprobar(
    (await tarjeta.locator('.pdf-libro-estado').textContent()) === 'Sin empezar',
    'reiniciar devuelve el documento al principio'
  );

  await tarjeta.locator('details.pdf-libro-menu').evaluate((m) => { m.open = true; });
  const borrarBtn = opcion('Borrar');
  await borrarBtn.click();
  await pagina.waitForTimeout(300);
  comprobar(
    (await tarjeta.locator('.pdf-libro-menu-pop .mini-btn.danger').textContent())?.includes('Seguro'),
    'borrar pide confirmación'
  );
  await tarjeta.locator('.pdf-libro-menu-pop .mini-btn.danger').click();
  await pagina.waitForTimeout(900);
  await abrirPestana(pagina);
  comprobar((await pagina.locator('#pdfRejilla .pdf-libro').count()) === 0, 'el borrado persiste tras recargar');

  comprobar(sinRuido(errores).length === 0, `sin errores de JavaScript (${sinRuido(errores).length})`);
  sinRuido(errores).slice(0, 3).forEach((e) => console.error('   →', e.slice(0, 180)));
  await contexto.close();
}

/* ── 7) Traducción de un documento en inglés ───────────────────────── */
console.log('\n── Documento en inglés ───────────────────────');
{
  const { pagina, errores, contexto } = await nuevaPagina({ viewport: { width: 1280, height: 950 } });
  await leer(pagina, INGLES, 60000);

  comprobar(await pagina.locator('#pdfTradBar').isVisible(), 'detecta que el documento no está en español');
  comprobar(
    /inglés/i.test(await pagina.locator('#pdfTradTexto').textContent() || ''),
    'nombra el idioma detectado'
  );
  comprobar(
    (await pagina.locator('#pdfTraducirDocLabel').textContent())?.includes('español'),
    'ofrece leerlo en español'
  );

  /* Sin servidor de traducción, el fallo tiene que explicarse, no romperse. */
  await pagina.locator('#btnPdfTraducirDoc').click();
  await pagina.waitForTimeout(5000);
  const aviso = (await avisoVisible(pagina)).texto;
  comprobar(/traduc|servidor|conex|API/i.test(aviso), `sin servidor lo explica en vez de romperse (${aviso.slice(0, 70)}…)`);
  comprobar(
    (await pagina.locator('#pdfOutput').inputValue()).length > 50,
    'el texto original sigue en pantalla tras fallar la traducción'
  );
  comprobar(!(await pagina.locator('#btnPdfTraducirDoc').isDisabled()), 'se puede reintentar');

  /* Un documento en español no muestra la barra. */
  await pagina.locator('#btnPdfBack').click();
  await pagina.waitForTimeout(500);
  await leer(pagina, LIBRO, 40000);
  comprobar(await pagina.locator('#pdfTradBar').isHidden(), 'un documento en español no ofrece traducción');

  comprobar(sinRuido(errores).length === 0, `sin errores de JavaScript (${sinRuido(errores).length})`);
  sinRuido(errores).slice(0, 3).forEach((e) => console.error('   →', e.slice(0, 180)));
  await contexto.close();
}

/* ── 8) Importación Kindle oficial y solo local ────────────────────── */
console.log('\n── Importación Kindle segura ──────────────────');
{
  const { pagina, errores, contexto } = await nuevaPagina({ viewport: { width: 1280, height: 1000 } });
  const peticionesDeSalida = [];
  pagina.on('request', (peticion) => {
    if (['POST', 'PUT', 'PATCH'].includes(peticion.method())) peticionesDeSalida.push(peticion.url());
  });

  comprobar(await pagina.locator('#pdfKindle').isVisible(), 'muestra el asistente «Traer desde Kindle»');
  await pagina.locator('#pdfKindle').evaluate((detalle) => { detalle.open = true; });
  comprobar(
    (await pagina.locator('#pdfKindle a[href="https://www.amazon.com/mycd"]').getAttribute('target')) === '_blank',
    'la gestión de Amazon se abre fuera de JG Turbo'
  );
  comprobar(await pagina.locator('#pdfKindleLocal').isChecked(), 'el destino inicial es solo este dispositivo');
  comprobar(await pagina.locator('#pdfKindleNube').isDisabled(), 'no ofrece sincronizar si la nube no está conectada');

  await pagina.locator('#pdfKindleInput').setInputFiles([LIBRO, INGLES, KFX, PROTEGIDO]);
  await pagina.waitForFunction(
    () => document.getElementById('pdfKindleEstado')?.textContent?.startsWith('Importación terminada:'),
    null, { timeout: 120000 }
  );
  comprobar((await pagina.locator('#pdfRejilla .pdf-libro').count()) === 2, 'guarda secuencialmente los dos PDF válidos');
  comprobar(/KFX|DRM/i.test(await pagina.locator('#pdfKindleResultados').textContent() || ''), 'rechaza KFX y explica el límite de DRM');
  comprobar(/pdf_con_clave\.pdf.*protegido.*no quita contraseñas ni DRM/i.test(await pagina.locator('#pdfKindleResultados').textContent() || ''), 'rechaza un PDF cifrado sin intentar quitar la protección');

  const documentos = await pagina.evaluate(() => new Promise((resolver, rechazar) => {
    const peticion = indexedDB.open('jg-turbo-pdf', 5);
    peticion.onerror = () => rechazar(peticion.error);
    peticion.onsuccess = () => {
      const lectura = peticion.result.transaction('documentos', 'readonly').objectStore('documentos').getAll();
      lectura.onerror = () => rechazar(lectura.error);
      lectura.onsuccess = () => resolver(lectura.result);
    };
  }));
  comprobar(documentos.every((doc) => doc.origen === 'kindle-descarga-oficial'), 'registra el origen oficial en los metadatos');
  comprobar(documentos.every((doc) => /^[a-f0-9]{64}$/.test(doc.huella || '')), 'guarda una huella SHA-256 por PDF');
  comprobar(documentos.every((doc) => doc.sincronizar === false), 'marca ambos libros para que no entren en la nube');

  await pagina.locator('#pdfKindleEstado').evaluate((nodo) => { nodo.textContent = ''; });
  await pagina.locator('#pdfKindleInput').setInputFiles([LIBRO, INGLES]);
  await pagina.waitForFunction(
    () => document.getElementById('pdfKindleEstado')?.textContent?.startsWith('Importación terminada:'),
    null, { timeout: 120000 }
  );
  comprobar((await pagina.locator('#pdfRejilla .pdf-libro').count()) === 2, 'un lote repetido no crea copias');
  comprobar(/2 duplicados omitidos/i.test(await pagina.locator('#pdfKindleEstado').textContent() || ''), 'informa los duplicados exactos omitidos');

  await pagina.locator('#pdfKindleEstado').evaluate((nodo) => { nodo.textContent = ''; });
  await pagina.locator('#pdfKindleInput').setInputFiles(GRANDE);
  await pagina.locator('#btnPdfKindleCancelar').waitFor({ state: 'visible', timeout: 10000 });
  await pagina.locator('#btnPdfKindleCancelar').click();
  await pagina.waitForFunction(
    () => document.getElementById('pdfKindleEstado')?.textContent?.startsWith('Importación cancelada:'),
    null, { timeout: 120000 }
  );
  comprobar((await pagina.locator('#pdfRejilla .pdf-libro').count()) === 2, 'cancelar no borra lo ya terminado ni deja un registro incompleto');
  comprobar(peticionesDeSalida.length === 0, 'la importación local no envía archivos a Amazon ni al backend');

  comprobar(sinRuido(errores).length === 0, `sin errores de JavaScript (${sinRuido(errores).length})`);
  sinRuido(errores).slice(0, 3).forEach((e) => console.error('   →', e.slice(0, 180)));
  await contexto.close();
}

await navegador.close();
servidor.close();
await rm(temporal, { recursive: true, force: true });

console.log(fallos === 0
  ? '\n✔ El lector de PDF pasa todas las verificaciones del navegador.'
  : `\n✘ ${fallos} verificación(es) fallaron.`);
process.exit(fallos === 0 ? 0 : 1);
