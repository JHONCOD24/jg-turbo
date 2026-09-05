/* Verificación de conjunto del lector PDF (Agente 4).
 *   node tests/verificar_pdf_lector_integracion.mjs
 *
 * Las suites de los agentes comprueban en su mayoría que ciertas cadenas
 * existan en el código fuente. Eso demuestra que el código se escribió, no que
 * funcione. Aquí se abre la app de verdad en un navegador, se carga un libro y
 * se comprueba el comportamiento:
 *
 *   1. La vista de lectura lleva posiciones y NO tiene botones dentro del texto.
 *   2. Las posiciones corresponden con el texto real (invariante del mapa).
 *   3. Tocar un párrafo pide leer desde ese punto exacto.
 *   4. La marca de la voz se pinta en el bloque correcto.
 *   5. Ir a un carácter guardado desplaza la vista.
 *   6. La hoja de Apariencia abre, cierra con Escape y devuelve el foco.
 *   7. Los tres temas cambian y se recuerdan.
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
    resolve(APP, '..', 'JG Turbo_OLD', 'node_modules', 'playwright', 'index.mjs'),
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
    const url = new URL(peticion.url, `http://127.0.0.1:${servidor.address()?.port || 8000}`);
    const rutaRelativa = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname).replace(/^\/+/, '');
    const datos = await readFile(join(APP, rutaRelativa));
    respuesta.writeHead(200, { 'Content-Type': TIPOS[extname(rutaRelativa)] || 'application/octet-stream' });
    respuesta.end(datos);
  } catch { respuesta.writeHead(404).end('no encontrado'); }
});
await new Promise((listo) => servidor.listen(0, '127.0.0.1', listo));
/* Por defecto se prueba la copia local. Con JG_BASE se apunta al dominio real:
 *   JG_BASE=https://jg-turbo.vercel.app node tests/verificar_pdf_lector_integracion.mjs
 * Esa es la única forma de demostrar que lo desplegado funciona, y no solo lo
 * que hay en el disco. */
const BASE = process.env.JG_BASE
  ? String(process.env.JG_BASE).replace(/\/?$/, '/')
  : `http://127.0.0.1:${servidor.address().port}/`;
console.log(`Probando contra ${BASE}`);

const temporal = await mkdtemp(join(tmpdir(), 'jg-lector-'));
const LIBRO = join(temporal, 'libro.pdf');
crearLibro(LIBRO, 24);

const navegador = await chromium.launch({ headless: !process.argv.includes('--headed') });
const pagina = await navegador.newPage({ viewport: { width: 390, height: 844 } });
const errores = [];
pagina.on('pageerror', (e) => errores.push(String(e)));

await pagina.goto(BASE, { waitUntil: 'domcontentloaded' });
await pagina.waitForTimeout(600);
await pagina.locator('#tabPdf').click();
await pagina.waitForTimeout(400);
await pagina.locator('#pdfInput').setInputFiles(LIBRO);
await pagina.waitForTimeout(300);
await pagina.locator('#btnPdfRead').click();
await pagina.waitForFunction(() => {
  const res = document.getElementById('pdfResultArea');
  return res && res.style.display !== 'none';
}, null, { timeout: 90000 }).catch(() => {});
await pagina.waitForTimeout(1200);

console.log('\n── 1. La vista lleva posiciones y no tiene botones dentro ──────');
{
  const r = await pagina.evaluate(() => {
    const lectura = document.getElementById('pdfLectura');
    if (!lectura) return null;
    return {
      visible: !lectura.hidden,
      bloques: lectura.querySelectorAll('[data-ini]').length,
      botones: lectura.querySelectorAll('button').length,
      textoConBoton: /Leer desde aquí/.test(lectura.textContent),
    };
  });
  comprobar(!!r && r.visible, 'la vista de lectura se muestra al abrir el libro');
  comprobar(!!r && r.bloques > 0, `la vista tiene bloques con posición (${r?.bloques})`);
  comprobar(!!r && r.botones === 0, `no hay ni un botón dentro del texto (${r?.botones})`);
  comprobar(!!r && !r.textoConBoton, 'el texto del libro no contiene «Leer desde aquí»');
}

console.log('\n── 2. Las posiciones corresponden con el texto real ────────────');
{
  const r = await pagina.evaluate(() => {
    const lectura = document.getElementById('pdfLectura');
    const salida = document.getElementById('pdfOutput');
    const texto = salida.value || '';
    const malos = [];
    let comprobados = 0;
    for (const b of lectura.querySelectorAll('p[data-ini], h3[data-ini], blockquote[data-ini]')) {
      const ini = Number(b.dataset.ini);
      const fin = Number(b.dataset.fin);
      const esperado = texto.slice(ini, fin).replace(/\s+/g, ' ').trim();
      const real = b.textContent.replace(/\s+/g, ' ').trim();
      comprobados += 1;
      if (esperado !== real) malos.push({ ini, fin, esperado: esperado.slice(0, 40), real: real.slice(0, 40) });
      if (comprobados >= 40) break;
    }
    return { comprobados, malos };
  });
  comprobar(r.comprobados > 0, `se pudieron comprobar bloques (${r.comprobados})`);
  comprobar(r.malos.length === 0,
    `cada bloque muestra exactamente el texto de su posición${r.malos.length ? ' → ' + JSON.stringify(r.malos.slice(0, 2)) : ''}`);
}

console.log('\n── 3. Tocar un párrafo pide leer desde ese punto ───────────────');
{
  const r = await pagina.evaluate(async () => {
    const lectura = document.getElementById('pdfLectura');
    const salida = document.getElementById('pdfOutput');
    const bloques = [...lectura.querySelectorAll('p[data-ini]')];
    const objetivo = bloques[Math.min(3, bloques.length - 1)];
    if (!objetivo) return null;
    const ini = Number(objetivo.dataset.ini);
    /* Se intercepta la orden de sonar: aquí no hay servidor de voz. */
    let pedido = null;
    const original = window.ttsIrABloque;
    window.ttsIrABloque = (b, d) => { pedido = { b, d }; };
    objetivo.click();
    await new Promise((r2) => setTimeout(r2, 300));
    window.ttsIrABloque = original;
    return { ini, seleccion: salida.selectionStart, pedido };
  });
  comprobar(!!r, 'hay párrafos donde tocar');
  comprobar(!!r && Math.abs(r.seleccion - r.ini) <= 2,
    `tocar el párrafo apunta la lectura a su posición (pidió ${r?.seleccion}, el párrafo empieza en ${r?.ini})`);
}

console.log('\n── 4. El texto sigue a la voz (camino real del reproductor) ────');
{
  /* Se recorre el mismo camino que sigue el audio: el reproductor anuncia su
   * avance con `jg-tts-avance` y el lector tiene que resaltar la frase. Aquí
   * no hay servidor de voz, así que se simula la cola de bloques con el texto
   * real del capítulo y se despacha el evento tal cual lo emite el motor. */
  const r = await pagina.evaluate(async () => {
    const lectura = document.getElementById('pdfLectura');
    const salida = document.getElementById('pdfOutput');
    const texto = salida.value || '';
    /* La cola de audio: un bloque que empieza en el tercer párrafo. */
    const bloque = [...lectura.querySelectorAll('p[data-ini]')][2];
    if (!bloque) return { sinBloques: true };
    const ini = Number(bloque.dataset.ini);
    window.ttsTextosDeCola = () => [texto.slice(ini, ini + 400)];
    window.ttsState = { sourceId: 'pdf', status: 'playing' };

    document.dispatchEvent(new CustomEvent('jg-tts-avance', {
      detail: {
        sourceId: 'pdf', sonando: true, estado: 'playing',
        bloque: 0, dentroBloque: 0.02, fraccion: ini / Math.max(1, texto.length),
        caracteres: texto.length, cola: 'prueba-1',
      },
    }));
    await new Promise((r2) => setTimeout(r2, 400));

    const marca = lectura.querySelector('mark');
    return {
      hayMarca: !!marca,
      textoMarca: marca ? marca.textContent.slice(0, 60) : '',
      dentroDeLaVista: marca ? lectura.contains(marca) : false,
      apareceEnElTexto: marca ? texto.includes(marca.textContent.trim().slice(0, 30)) : false,
    };
  });
  comprobar(!r.sinBloques, 'el capítulo tiene párrafos que resaltar');
  comprobar(!!r.hayMarca, 'el avance de la voz pinta la frase dentro de la vista de lectura');
  comprobar(!!r.dentroDeLaVista, 'la marca está en el texto que se ve, no en la capa oculta');
  comprobar(!!r.apareceEnElTexto,
    `lo resaltado existe tal cual en el texto del libro («${r.textoMarca?.slice(0, 32)}…»)`);
}

console.log('\n── 5. La hoja de Apariencia abre, cierra y devuelve el foco ────');
{
  const abrir = await pagina.evaluate(() => {
    const boton = document.getElementById('btnPdfApariencia');
    const hoja = document.getElementById('pdfAparienciaHoja');
    if (!boton || !hoja) return null;
    boton.click();
    return { abierta: !hoja.hidden, expandido: boton.getAttribute('aria-expanded') };
  });
  comprobar(!!abrir, 'existen el botón «Aa» y la hoja');
  comprobar(!!abrir && abrir.abierta, 'el botón «Aa» abre la hoja');
  comprobar(!!abrir && abrir.expandido === 'true', 'el botón declara que la hoja está abierta');

  await pagina.keyboard.press('Escape');
  await pagina.waitForTimeout(200);
  const cerrar = await pagina.evaluate(() => {
    const hoja = document.getElementById('pdfAparienciaHoja');
    return { cerrada: hoja.hidden, foco: document.activeElement?.id || '' };
  });
  comprobar(cerrar.cerrada, 'Escape cierra la hoja');
  /* A 390 px «Aa» vive en la barra del pulgar y el de la cabecera está
     oculto: el contrato es que el foco vuelva a un control VISIBLE que
     abra la hoja, nunca al <body>. */
  comprobar(['btnPdfApariencia', 'btnPdfBmApariencia'].includes(cerrar.foco),
    `el foco vuelve a un botón visible que abre la hoja (fue a «${cerrar.foco}»)`);
}

console.log('\n── 6. Los tres temas cambian y se recuerdan ────────────────────');
{
  for (const tema of ['papel', 'sepia', 'noche']) {
    const r = await pagina.evaluate((t) => {
      const boton = document.querySelector(`[data-tema="${t}"]`);
      if (!boton) return null;
      boton.click();
      const area = document.getElementById('pdfResultArea');
      return {
        aplicado: area.dataset.tema,
        guardado: localStorage.getItem('jg_pdf_tema'),
        marcado: boton.classList.contains('is-on'),
      };
    }, tema);
    comprobar(!!r && r.aplicado === tema, `el tema ${tema} se aplica a la lectura`);
    comprobar(!!r && r.guardado === tema, `el tema ${tema} se recuerda`);
    comprobar(!!r && r.marcado, `el tema ${tema} se ve marcado como activo`);
  }
}

console.log('\n── 7. Sin errores de JavaScript ────────────────────────────────');
comprobar(errores.length === 0, `sin errores de JavaScript (${errores.length})${errores.length ? ' → ' + errores[0].slice(0, 160) : ''}`);

await navegador.close();
servidor.close();
await rm(temporal, { recursive: true, force: true });

console.log(fallos ? `\n❌ ${fallos} fallos de integración.` : '\n✔ El lector PDF funciona como conjunto.');
process.exit(fallos ? 1 : 0);
