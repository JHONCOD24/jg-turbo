/* ¿Se puede desplazar la biblioteca?
 *   node tests/verificar_pdf_scroll.mjs
 *
 * Esta prueba existe por un fallo concreto: al sacar la biblioteca de su caja
 * con scroll propio se liberó el área del texto pero NO `.wrap`, que en
 * pantallas ≥641px lleva `height:100dvh; overflow:hidden`. El contenido quedó
 * recortado a la altura de la ventana y el scroll dejó de responder por
 * completo.
 *
 * No lo detectó ninguna verificación anterior porque todas trabajan con dos
 * libros, y con dos libros todo cabe en pantalla: nunca llegaban a intentar
 * desplazarse. Aquí se siembran nueve y **se hace scroll de verdad**, con la
 * rueda del ratón, comprobando que la página se mueve.
 *
 * Comprueba además que el arreglo no se llevó por delante lo que sí debía
 * seguir igual: las otras pestañas y el scroll interno del lector.
 */
import { createServer } from 'node:http';
import { readFile, mkdtemp } from 'node:fs/promises';
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
    resolve(APP, '..', 'JG Turbo_OLD', 'node_modules', 'playwright', 'index.mjs'),
  ];
  for (const ruta of candidatos) {
    try { return await import(pathToFileURL(ruta).href); } catch (_) { /* siguiente */ }
  }
  console.error('Falta Playwright: instálalo con «npm i -D playwright».');
  process.exit(1);
})();

const TIPOS = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.json': 'application/json', '.css': 'text/css',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json', '.wasm': 'application/wasm',
};
const servidor = createServer(async (peticion, respuesta) => {
  try {
    let ruta = decodeURIComponent(peticion.url.split('?')[0]);
    if (ruta === '/') ruta = '/index.html';
    const archivo = join(APP, ruta);
    const datos = await readFile(archivo);
    respuesta.writeHead(200, { 'Content-Type': TIPOS[extname(archivo)] || 'application/octet-stream' });
    respuesta.end(datos);
  } catch (_) { respuesta.writeHead(404); respuesta.end('no'); }
});
await new Promise((listo) => servidor.listen(0, listo));
const BASE = `http://127.0.0.1:${servidor.address().port}/`;

const temporal = await mkdtemp(join(tmpdir(), 'jg-scroll-'));
const LIBRO = join(temporal, 'libro.pdf');
crearLibro(LIBRO, 20);

let fallos = 0;
const comprobar = (condicion, mensaje) => {
  if (condicion) console.log(`OK: ${mensaje}`);
  else { fallos += 1; console.error(`FALLO: ${mensaje}`); }
};

/** Mete libros directamente en la base: más rápido y realista que abrir nueve PDF. */
async function sembrarLibros(pagina, cuantos) {
  await pagina.evaluate(async (n) => {
    const bd = await new Promise((ok, err) => {
      const p = indexedDB.open('jg-turbo-pdf', 5);
      p.onsuccess = () => ok(p.result); p.onerror = () => err(p.error);
    });
    const tx = bd.transaction(['documentos', 'contenido'], 'readwrite');
    for (let i = 0; i < n; i += 1) {
      tx.objectStore('documentos').put({
        id: `sembrado-${i}`, titulo: `Libro sembrado número ${i + 1}`,
        totalPaginas: 120, caracteres: 90000, idioma: 'es',
        titulosPartes: ['Capítulo único'], tieneArchivo: false, tienePortada: false,
        progreso: { parte: 0, desplazamiento: 0, maxParte: 0, actualizado: Date.now() },
        estado: 'sin-empezar', creado: Date.now(), actualizado: Date.now(),
        contenidoActualizado: Date.now(), sincronizado: 0,
      });
      tx.objectStore('contenido').put({
        id: `sembrado-${i}`, partes: [{ titulo: 'Capítulo único', texto: 'x'.repeat(500), pagina: 1 }],
      });
    }
    await new Promise((ok) => { tx.oncomplete = ok; tx.onerror = ok; });
  }, cuantos);
}

const navegador = await chromium.launch();

for (const [nombre, ancho, alto] of [['móvil', 390, 844], ['tablet', 834, 1112], ['escritorio', 1280, 800]]) {
  console.log(`\n── ${nombre} (${ancho}×${alto}) ──`);
  const pagina = await navegador.newPage({ viewport: { width: ancho, height: alto } });
  await pagina.goto(BASE, { waitUntil: 'domcontentloaded' });
  await pagina.waitForTimeout(500);
  await pagina.locator('#tabPdf').click();
  await pagina.waitForTimeout(400);

  await sembrarLibros(pagina, 9);
  await pagina.reload({ waitUntil: 'domcontentloaded' });
  await pagina.locator('#tabPdf').click();
  await pagina.waitForTimeout(1200);

  const libros = await pagina.locator('#pdfRejilla li').count();
  comprobar(libros >= 9, `la biblioteca muestra los libros sembrados (${libros})`);

  const antes = await pagina.evaluate(() => ({
    alto: document.documentElement.scrollHeight,
    ventana: document.documentElement.clientHeight,
  }));
  comprobar(antes.alto > antes.ventana,
    `con nueve libros el contenido supera la ventana (${antes.alto} > ${antes.ventana})`);

  /* El scroll de verdad: rueda del ratón, como una persona. */
  await pagina.mouse.move(ancho / 2, alto / 2);
  await pagina.mouse.wheel(0, 600);
  await pagina.waitForTimeout(400);
  const movido = await pagina.evaluate(() => window.scrollY
    || document.documentElement.scrollTop || document.body.scrollTop || 0);
  comprobar(movido > 0, `la página se desplaza al girar la rueda (${Math.round(movido)}px)`);

  const estado = await pagina.evaluate(() => ({
    areaOv: getComputedStyle(document.querySelector('#panelPdf .pdf-area')).overflowY,
    desborde: document.documentElement.scrollWidth - document.documentElement.clientWidth,
  }));
  comprobar(estado.areaOv === 'visible',
    `la lista no tiene scroll propio: se desplaza la página (${estado.areaOv})`);
  comprobar(estado.desborde <= 0, `sin desborde horizontal (${estado.desborde}px)`);

  /* Lo que NO debía cambiar: las otras pestañas conservan su layout. */
  for (const tab of ['#tabMic', '#tabFile', '#tabYt']) {
    if (!(await pagina.locator(tab).count())) continue;
    await pagina.locator(tab).click();
    await pagina.waitForTimeout(350);
    const otra = await pagina.evaluate(() => ({
      ov: getComputedStyle(document.querySelector('.wrap')).overflow,
      desborde: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    }));
    const conserva = ancho >= 641 ? otra.ov.includes('hidden') : true;
    comprobar(conserva, `${tab} conserva el layout de la app (overflow ${otra.ov})`);
    comprobar(otra.desborde <= 0, `${tab} sin desborde horizontal`);
  }

  /* Y el lector mantiene su scroll interno, que ahí sí hace falta. */
  await pagina.locator('#tabPdf').click();
  await pagina.waitForTimeout(400);
  await pagina.locator('#pdfInput').setInputFiles(LIBRO);
  await pagina.waitForTimeout(300);
  if (!(await pagina.locator('#btnPdfRead').isDisabled())) {
    await pagina.locator('#btnPdfRead').click();
    await pagina.waitForTimeout(5000);
    const lector = await pagina.evaluate(() => ({
      leyendo: document.body.classList.contains('jg-leyendo'),
      areaOv: getComputedStyle(document.querySelector('#panelPdf .pdf-area')).overflowY,
    }));
    comprobar(lector.leyendo, 'el lector se abre');
    comprobar(lector.areaOv === 'auto',
      `en lectura el área conserva su scroll interno (${lector.areaOv})`);
  }

  await pagina.close();
}

await navegador.close();
servidor.close();
console.log(fallos ? `\n${fallos} FALLO(S)` : '\nTodo en verde');
process.exit(fallos ? 1 : 0);
