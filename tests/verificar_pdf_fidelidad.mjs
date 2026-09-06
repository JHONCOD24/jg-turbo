/* Verifica en navegador la comparación visual y su persistencia. */
import { createServer } from 'node:http';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, extname, resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { crearLibro } from './generarPdfPrueba.mjs';

const AQUI = dirname(fileURLToPath(import.meta.url));
const APP = resolve(AQUI, '..');
const { chromium } = await (async () => {
  for (const ruta of [
    resolve(APP, 'node_modules', 'playwright', 'index.mjs'),
    resolve(APP, '..', 'node_modules', 'playwright', 'index.mjs'),
    resolve(APP, '..', 'JG Turbo_OLD', 'node_modules', 'playwright', 'index.mjs'),
  ]) {
    try { return await import(pathToFileURL(ruta).href); } catch (_) {}
  }
  console.error('FALLO: no se encontró Playwright.');
  process.exit(1);
})();

const TIPOS = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.json': 'application/json',
  '.webmanifest': 'application/manifest+json', '.wasm': 'application/wasm',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.pdf': 'application/pdf',
};
const servidor = createServer(async (peticion, respuesta) => {
  try {
    const url = new URL(peticion.url, `http://127.0.0.1:${servidor.address()?.port || 8000}`);
    const relativa = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname).replace(/^\/+/, '');
    const datos = await readFile(join(APP, relativa));
    respuesta.writeHead(200, { 'Content-Type': TIPOS[extname(relativa)] || 'application/octet-stream' });
    respuesta.end(datos);
  } catch (_) { respuesta.writeHead(404).end('no encontrado'); }
});
await new Promise((ok) => servidor.listen(0, '127.0.0.1', ok));
const BASE = `http://127.0.0.1:${servidor.address().port}/`;
const temporal = await mkdtemp(join(tmpdir(), 'jg-fidelidad-'));
const libro = join(temporal, 'fidelidad.pdf');
crearLibro(libro, 1);

let fallos = 0;
const comprobar = (condicion, mensaje) => {
  if (condicion) console.log(`OK: ${mensaje}`);
  else { fallos += 1; console.error(`FALLO: ${mensaje}`); }
};

const navegador = await chromium.launch({ headless: !process.argv.includes('--headed') });
const contexto = await navegador.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
const pagina = await contexto.newPage();
const errores = [];
pagina.on('pageerror', (e) => errores.push(String(e)));

try {
  await pagina.goto(BASE, { waitUntil: 'domcontentloaded' });
  await pagina.locator('#tabPdf').click();
  await pagina.locator('#pdfInput').setInputFiles(libro);
  await pagina.locator('#btnPdfRead').click();
  await pagina.waitForFunction(() => document.querySelector('#pdfResultArea')?.style.display !== 'none', null, { timeout: 90000 });
  await pagina.waitForTimeout(900);

  const estadoInicial = (await pagina.locator('#pdfFidelidadEstado').textContent()) || '';
  if (!/Transcripción fiel|Revisión pendiente/.test(estadoInicial)) {
    const diagnostico = await pagina.evaluate(async () => {
      const bd = await new Promise((ok) => { const p = indexedDB.open('jg-turbo-pdf', 5); p.onsuccess = () => ok(p.result); });
      const filas = await new Promise((ok) => {
        const p = bd.transaction(['contenido']).objectStore('contenido').getAll();
        p.onsuccess = () => ok(p.result || []);
      });
      const r = filas.find((f) => !String(f.id).includes('|'))?.reconstruccion;
      const fuente = new Map((r?.fragmentosFuente || []).map((f) => [f.id, f.str]));
      const distinta = (r?.atomos || []).find((a) => fuente.has(a.id) && String(fuente.get(a.id)) !== String(a.str));
      const destinos = [...(r?.atomos || []).map((a) => a.id), ...(r?.omisiones || []).flatMap((o) => o.atomIds || [])];
      const repetidos = [...new Set(destinos.filter((id, i) => destinos.indexOf(id) !== i))];
      return {
        integridad: r?.estadoFidelidad?.integridad || null,
        atomos: (r?.atomos || []).length,
        omisiones: (r?.omisiones || []).map((o) => ({ motivo: o.motivo, ids: o.atomIds })),
        repetidos, distinta, fuente: distinta ? fuente.get(distinta.id) : null,
      };
    });
    console.log('diagnóstico inicial=' + JSON.stringify(diagnostico));
  }
  comprobar(/Transcripción fiel|Revisión pendiente/.test(estadoInicial), `muestra el estado de fidelidad al procesar (${estadoInicial.trim()})`);

  await pagina.evaluate(() => {
    document.querySelector('#pdfMasMenu').open = true;
    document.querySelector('#btnPdfComparar').click();
  });
  await pagina.waitForFunction(() => !document.querySelector('#pdfCompararHoja')?.hidden);
  await pagina.waitForTimeout(700);
  const comparacion = await pagina.evaluate(() => ({
    ancho: document.querySelector('#pdfCompararCanvas')?.width || 0,
    alto: document.querySelector('#pdfCompararCanvas')?.height || 0,
    texto: document.querySelector('#pdfCompararTexto')?.textContent || '',
    pagina: document.querySelector('#pdfCompararPagina')?.textContent || '',
  }));
  comprobar(comparacion.ancho > 100 && comparacion.alto > 100, `renderiza la página original (${comparacion.ancho}×${comparacion.alto})`);
  comprobar(comparacion.texto.trim().length > 20, 'muestra la transcripción correspondiente a la página');
  comprobar(/Página 1/.test(comparacion.pagina), 'identifica la página comparada');

  await pagina.locator('#btnPdfPaginaVerificada').tap();
  comprobar(true, 'el botón de revisión recibe el toque');
  await pagina.waitForTimeout(900);
  const estadoRevisado = await pagina.locator('#pdfFidelidadEstado').textContent();
  const diagnosticoRevision = await pagina.evaluate(async () => {
    const aviso = document.querySelector('#pdfNoticeLector')?.textContent || '';
    const pulsado = document.querySelector('#btnPdfPaginaVerificada')?.getAttribute('aria-pressed');
    const bd = await new Promise((ok) => { const p = indexedDB.open('jg-turbo-pdf', 5); p.onsuccess = () => ok(p.result); });
    const filas = await new Promise((ok) => {
      const p = bd.transaction(['contenido']).objectStore('contenido').getAll();
      p.onsuccess = () => ok(p.result || []);
    });
    return { aviso, pulsado, guardado: filas.find((f) => !String(f.id).includes('|'))?.reconstruccion?.estadoFidelidad || null };
  });
  if (!/1 de 1 páginas comparadas/.test(estadoRevisado)) console.log('diagnóstico=' + JSON.stringify(diagnosticoRevision));
  comprobar(/1 de 1 páginas comparadas/.test(estadoRevisado), `registra la página comparada (${estadoRevisado.trim()})`);
  comprobar(!/Verificado contra el PDF/.test(estadoRevisado), 'no declara el libro verificado mientras quedan cortes pendientes');
  await pagina.keyboard.press('Escape');
  await pagina.waitForTimeout(250);
  comprobar(await pagina.locator('#pdfCompararHoja').isHidden(), 'Escape cierra la comparación');
  const focoAlCerrar = await pagina.evaluate(() => document.activeElement?.id || document.activeElement?.tagName || '');
  if (!['btnPdfComparar', 'btnPdfBmOpciones', 'btnPdfMas'].includes(focoAlCerrar)) {
    console.log('diagnóstico foco=' + JSON.stringify(await pagina.evaluate(() => ({
      body: document.body.className,
      menu: document.querySelector('#pdfMasMenu')?.open,
      candidatos: ['btnPdfComparar', 'btnPdfBmOpciones', 'btnPdfMas'].map((id) => {
        const e = document.getElementById(id); const css = e ? getComputedStyle(e) : null;
        return { id, existe: Boolean(e), offset: Boolean(e?.offsetParent), display: css?.display, visibility: css?.visibility, opacity: css?.opacity };
      }),
    }))));
  }
  comprobar(['btnPdfComparar', 'btnPdfBmOpciones', 'btnPdfMas'].includes(focoAlCerrar),
    `al cerrar devuelve el foco al acceso de Opciones (${focoAlCerrar})`);

  await pagina.reload({ waitUntil: 'domcontentloaded' });
  await pagina.locator('#tabPdf').click();
  await pagina.waitForTimeout(900);
  await pagina.locator('#pdfRejilla .pdf-libro').first().click();
  await pagina.waitForTimeout(900);
  comprobar((await pagina.locator('#pdfFidelidadEstado').textContent()).includes('1 de 1 páginas comparadas'), 'la revisión sobrevive al cierre y reapertura');
  comprobar(errores.length === 0, `no hay errores JavaScript (${errores.length})`);
} finally {
  await navegador.close();
  servidor.close();
  await rm(temporal, { recursive: true, force: true });
}

if (fallos) {
  console.error(`\n${fallos} prueba(s) fallaron.`);
  process.exit(1);
}
console.log('\nComparación fiel en navegador: todas las pruebas pasaron.');
