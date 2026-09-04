/* ¿Se rehacen las unidades de lectura de un libro YA guardado?
 *   node tests/verificar_pdf_retroceo.mjs
 *
 * Esta prueba existe por un fallo que se entregó como resuelto y no lo estaba.
 * Se arregló el troceo del texto, pero las partes se cortan **al procesar el
 * PDF** y se guardan así: los libros que ya estaban en la biblioteca seguían
 * mostrando los cortes viejos —capítulos vacíos, varios con el mismo número de
 * página, palabras partidas entre dos unidades— y desde fuera parecía que el
 * arreglo no había servido de nada.
 *
 * Aquí se siembra un libro con el troceo defectuoso, se abre, y se comprueba
 * que queda arreglado y que el progreso de lectura sobrevive.
 */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, extname, resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

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
await new Promise((listo) => servidor.listen(0, '127.0.0.1', listo));
const BASE = `http://127.0.0.1:${servidor.address().port}/`;

let fallos = 0;
const comprobar = (condicion, mensaje) => {
  if (condicion) console.log(`OK: ${mensaje}`);
  else { fallos += 1; console.error(`FALLO: ${mensaje}`); }
};

const navegador = await chromium.launch();
const pagina = await navegador.newPage({ viewport: { width: 1280, height: 860 } });
await pagina.goto(BASE, { waitUntil: 'domcontentloaded' });
await pagina.waitForTimeout(600);
await pagina.locator('#tabPdf').click();
await pagina.waitForTimeout(400);

/* Un libro tal como lo dejó el troceo antiguo: migas al principio, tres
 * unidades con la misma página, y una palabra partida entre dos partes. */
await pagina.evaluate(async () => {
  const bd = await new Promise((ok, err) => {
    const p = indexedDB.open('jg-turbo-pdf', 5);
    p.onsuccess = () => ok(p.result); p.onerror = () => err(p.error);
  });
  const cuerpo = 'Contenido corrido y extenso del libro que continúa sin cortes. '.repeat(90);
  const partes = [
    { titulo: 'Portada', texto: '', pagina: 5 },
    { titulo: 'Descubre el poder de tu mente', texto: 'Descubre el poder de tu mente', pagina: 5 },
    { titulo: 'Urano', texto: 'Urano', pagina: 5 },
    { titulo: 'Apéndice', texto: `${cuerpo}Y es`, pagina: 10 },
    { titulo: 'Prólogo', texto: `ta conclusión cierra el argumento. ${cuerpo}`, pagina: 11 },
  ];
  const tx = bd.transaction(['documentos', 'contenido'], 'readwrite');
  tx.objectStore('documentos').put({
    id: 'libro-viejo', titulo: 'El placebo eres tú', totalPaginas: 300,
    caracteres: partes.reduce((s, p) => s + p.texto.length, 0), idioma: 'es',
    titulosPartes: partes.map((p) => p.titulo), tieneArchivo: false, tienePortada: false,
    capitulos: [
      { titulo: 'Portada', pagina: 5, posicion: 0 },
      { titulo: 'Descubre el poder de tu mente', pagina: 5, posicion: 0 },
      { titulo: 'Urano', pagina: 5, posicion: 29 },
      { titulo: 'Apéndice', pagina: 10, posicion: 34 },
      { titulo: 'Prólogo', pagina: 11, posicion: 34 + cuerpo.length + 4 },
    ],
    progreso: { parte: 3, desplazamiento: 0.5, caracter: 100, cita: '', antes: '', maxParte: 3, actualizado: Date.now() },
    estado: 'leyendo', creado: Date.now(), actualizado: Date.now(),
    contenidoActualizado: Date.now(), sincronizado: 0,
    /* Sin `versionTroceo`: así estaban los libros de antes. */
  });
  tx.objectStore('contenido').put({ id: 'libro-viejo', partes });
  await new Promise((ok) => { tx.oncomplete = ok; tx.onerror = ok; });
});

await pagina.reload({ waitUntil: 'domcontentloaded' });
await pagina.locator('#tabPdf').click();
await pagina.waitForTimeout(1200);

const antes = await pagina.evaluate(async () => {
  const bd = await new Promise((ok) => { const p = indexedDB.open('jg-turbo-pdf', 5); p.onsuccess = () => ok(p.result); });
  const c = await new Promise((ok) => {
    const r = bd.transaction(['contenido']).objectStore('contenido').get('libro-viejo');
    r.onsuccess = () => ok(r.result);
  });
  return (c?.partes || []).map((p) => ({ titulo: p.titulo, pagina: p.pagina, largo: p.texto.length }));
});
comprobar(antes.length === 5, `el libro parte del troceo viejo (${antes.length} unidades)`);
comprobar(antes.filter((p) => p.pagina === 5).length === 3, 'y con tres unidades en la página 5, como se reportó');

/* Abrir el libro: aquí es donde debe rehacerse. */
await pagina.locator('#pdfRejilla .pdf-libro').first().click();
await pagina.waitForTimeout(2500);

const despues = await pagina.evaluate(async () => {
  const bd = await new Promise((ok) => { const p = indexedDB.open('jg-turbo-pdf', 5); p.onsuccess = () => ok(p.result); });
  const [c, d] = await Promise.all([
    new Promise((ok) => { const r = bd.transaction(['contenido']).objectStore('contenido').get('libro-viejo'); r.onsuccess = () => ok(r.result); }),
    new Promise((ok) => { const r = bd.transaction(['documentos']).objectStore('documentos').get('libro-viejo'); r.onsuccess = () => ok(r.result); }),
  ]);
  return {
    partes: (c?.partes || []).map((p) => ({ titulo: p.titulo, pagina: p.pagina, largo: p.texto.length, texto: p.texto })),
    version: d?.versionTroceo,
    progreso: d?.progreso,
    enPantalla: document.querySelectorAll('#pdfIndiceLista .pdf-cap').length,
  };
});

comprobar(despues.version === 2, `queda anotada la versión del troceo (${despues.version})`);
comprobar(despues.partes.length < antes.length,
  `se retiran las unidades vacías (${antes.length} → ${despues.partes.length})`);
comprobar(despues.partes.every((p) => p.largo > 0), 'ninguna unidad queda vacía');

const porPagina = new Map();
for (const p of despues.partes) porPagina.set(p.pagina, (porPagina.get(p.pagina) || 0) + 1);
comprobar([...porPagina.values()].every((n) => n === 1),
  `no quedan varias unidades con el mismo número de página (${[...porPagina.entries()].map(([a, b]) => `${a}×${b}`).join(', ')})`);

/* La palabra partida: ninguna unidad puede empezar por el final de otra. */
const empiezaMalCortada = despues.partes.some((p) => /^ta conclusión/.test(p.texto.trim()));
comprobar(!empiezaMalCortada, 'ninguna unidad empieza a mitad de palabra («ta conclusión»)');
const acabaMalCortada = despues.partes.some((p) => /\bY es$/.test(p.texto.trim()));
comprobar(!acabaMalCortada, 'ninguna unidad termina a mitad de palabra («Y es»)');

comprobar(despues.progreso && Number.isFinite(despues.progreso.parte),
  'el progreso de lectura sobrevive al rehacer las unidades');

/* Al reabrir no debe volver a rehacerse. */
await pagina.locator('#btnPdfBack').click();
await pagina.waitForTimeout(600);
await pagina.locator('#pdfRejilla .pdf-libro').first().click();
await pagina.waitForTimeout(1800);
const segunda = await pagina.evaluate(async () => {
  const bd = await new Promise((ok) => { const p = indexedDB.open('jg-turbo-pdf', 5); p.onsuccess = () => ok(p.result); });
  const c = await new Promise((ok) => { const r = bd.transaction(['contenido']).objectStore('contenido').get('libro-viejo'); r.onsuccess = () => ok(r.result); });
  return (c?.partes || []).length;
});
comprobar(segunda === despues.partes.length, 'al reabrirlo no se vuelve a rehacer (queda anotado)');

await navegador.close();
servidor.close();
console.log(fallos ? `\n${fallos} FALLO(S)` : '\nTodo en verde');
process.exit(fallos ? 1 : 0);
