/* Ayudante compartido de las pruebas de gestos y de paso de página.
 *
 * Reúne lo que las dos pruebas necesitan y que NO es lo que se prueba:
 * servidor local con un /api/tts falso de duración exacta, un libro con prosa
 * variada, abrir el lector, y un dedo real (CDP) para deslizar, pellizcar y
 * tocar. Con CDP el navegador emite Touch Events Y Pointer Events por el mismo
 * gesto, que es justo lo que hace un teléfono (TRAMPAS.md, «Un teléfono puede
 * emitir Touch Events y Pointer Events por el mismo gesto»). */
import { createServer } from 'node:http';
import { readFile, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, extname, resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { armarPdf, flujoDeTexto } from './generarPdfPrueba.mjs';

export const APP = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export async function cargarChromium() {
  const candidatos = [
    resolve(APP, 'node_modules', 'playwright', 'index.mjs'),
    resolve(APP, '..', 'node_modules', 'playwright', 'index.mjs'),
    resolve(APP, '..', '..', '..', 'node_modules', 'playwright', 'index.mjs'),
    resolve(APP, '..', 'JG Turbo_OLD', 'node_modules', 'playwright', 'index.mjs'),
  ];
  for (const ruta of candidatos) {
    try { return (await import(pathToFileURL(ruta).href)).chromium; } catch (_) { /* siguiente */ }
  }
  console.error('FALLO: no se encontró Playwright.');
  process.exit(1);
}

/* ── Conteo de comprobaciones ── */
let comprobaciones = 0;
const fallos = [];
export function comprobar(condicion, mensaje, detalle = '') {
  comprobaciones += 1;
  if (condicion) console.log(`OK: ${mensaje}`);
  else { fallos.push(mensaje); console.error(`FALLO: ${mensaje}${detalle ? ` — ${detalle}` : ''}`); }
}
export function cerrarPrueba(titulo) {
  console.log(fallos.length === 0
    ? `\n✔ ${titulo} · ${comprobaciones} comprobaciones, 0 fallos`
    : `\n❌ ${titulo} · ${fallos.length} fallos de ${comprobaciones} comprobaciones`);
  process.exit(fallos.length === 0 ? 0 : 1);
}

/* ── Libro de prosa variada (reproducible por semilla) ── */
function azar(semilla) {
  let a = semilla >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const SUJETOS = ['El Sr. Ramírez', 'La Dra. Pérez', 'Mi abuela Eulalia', 'El viajero holandés', 'Aquel pastor ciego', 'La maestra Elena', 'Don Aurelio', 'La joven Marta', 'El capitán Núñez', 'Una vecina del pueblo', 'El boticario', 'Los hermanos Salcedo'];
const LUGARES = ['Zapatoca', 'Mompox', 'Barichara', 'Salento', 'Jericó', 'Villa de Leyva', 'Guaduas', 'Támesis', 'Aranzazu', 'Sopetrán', 'Cocorná', 'Marinilla', 'Pacora', 'Salamina', 'Neira', 'Anserma', 'Honda', 'Girón', 'Socorro', 'Charalá', 'Oiba', 'Cabrera', 'Pinchote', 'Curití', 'Aratoca', 'Güepsa', 'Vélez', 'Chipatá', 'Puente Nacional', 'Sáchica'];
const ACCIONES = [
  (l, n) => `recorrió el valle de ${l} hacia las ${n} de la mañana, cuando la niebla todavía cubría los tejados`,
  (l, n) => `cruzó el puente de ${l}, que según los registros mide ${n} metros de ancho y resiste desde 1890`,
  (l, n) => `guardó las cartas de ${l} en el cajón y decidió no abrirlas hasta el invierno`,
  (l, n) => `escuchó el rumor del río junto a ${l}; luego, sin prisa, volvió a la casa donde la esperaban los demás`,
  (l, n) => `dijo con calma: «Nada de lo ocurrido en ${l} es casual», y todos guardaron silencio durante un buen rato`,
  (l, n) => `abrió la ventana que da a ${l} y, sin dejar de mirar el camino, repitió lo que había aprendido de su madre`,
  (l, n) => `pesó ${n} kilos de grano en la plaza de ${l} y anotó la cifra en un cuaderno viejo`,
  (l, n) => `contó que en ${l} el invierno dura ${n} semanas, y que cada una trae su propia costumbre`,
];
export function crearLibroNarrativo(ruta, paginas, semilla = 20261003) {
  const aleatorio = azar(semilla + paginas);
  const elegir = (lista) => lista[Math.floor(aleatorio() * lista.length)];
  const usadas = new Set();
  const oracion = () => {
    for (;;) {
      const n = `${Math.floor(2 + aleatorio() * 90)}.${Math.floor(aleatorio() * 10)}`;
      const s = `${elegir(SUJETOS)} ${elegir(ACCIONES)(elegir(LUGARES), n)}.`;
      const aguja = s.normalize('NFD').replace(/[^a-zA-Z0-9]/g, '').toLowerCase().slice(0, 64);
      if (!usadas.has(aguja)) { usadas.add(aguja); return s; }
    }
  };
  const parrafo = () => Array.from({ length: 3 + Math.floor(aleatorio() * 3) }, oracion).join(' ');
  const renglones = (texto, ancho = 78) => {
    const salida = []; let actual = '';
    for (const p of texto.split(' ')) {
      if ((`${actual} ${p}`).trim().length > ancho) { salida.push(actual); actual = p; } else actual = (`${actual} ${p}`).trim();
    }
    if (actual) salida.push(actual);
    return salida;
  };
  const flujos = [];
  for (let n = 1; n <= paginas; n += 1) {
    const lineas = [['HISTORIA DE PRUEBA', 70, 800, 9]];
    let y = 730;
    if (n === 1) { lineas.push(['CAPITULO I', 70, y, 18]); y -= 45; }
    for (let k = 0; k < 3; k += 1) {
      renglones(parrafo()).forEach((r, i) => { lineas.push([r, i === 0 ? 90 : 70, y, 11]); y -= 16; });
      y -= 8;
    }
    lineas.push([String(n), 295, 40, 9]);
    flujos.push(flujoDeTexto(lineas));
  }
  return armarPdf(flujos, ruta);
}

/* ── Servidor: la app y un /api/tts falso (WAV silencioso de duración exacta) ── */
function wavSegundos(segundos) {
  const sr = 8000;
  const n = Math.max(1, Math.round(segundos * sr));
  const buf = Buffer.alloc(44 + n * 2);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * 2, 4); buf.write('WAVE', 8);
  buf.write('fmt ', 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22); buf.writeUInt32LE(sr, 24); buf.writeUInt32LE(sr * 2, 28);
  buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34); buf.write('data', 36);
  buf.writeUInt32LE(n * 2, 40);
  return buf;
}
const TIPOS = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.pdf': 'application/pdf', '.wasm': 'application/wasm' };
/** Caracteres de voz por segundo del /api/tts falso. */
export const RITMO_VOZ = Number(process.env.JG_R || 200);
export async function iniciarServidor() {
  const servidor = createServer(async (peticion, respuesta) => {
    try {
      const url = new URL(peticion.url, 'http://127.0.0.1:8000');
      if (url.pathname === '/api/tts-voices' || url.pathname === '/tts-voices') { respuesta.writeHead(503).end('x'); return; }
      if (url.pathname === '/api/tts' || url.pathname === '/tts') {
        const texto = await new Promise((res) => {
          if (peticion.method === 'GET') return res(url.searchParams.get('text') || '');
          let c = '';
          peticion.on('data', (t) => { c += t; });
          peticion.on('end', () => { try { res(JSON.parse(c).text || ''); } catch { res(''); } });
        });
        respuesta.writeHead(200, { 'Content-Type': 'audio/wav' });
        respuesta.end(wavSegundos(Math.max(0.5, String(texto).length / RITMO_VOZ)));
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
  const base = process.env.JG_BASE || `http://127.0.0.1:${servidor.address().port}/`;
  return { servidor, base };
}

export async function carpetaTemporal() { return mkdtemp(join(tmpdir(), 'jg-paso-')); }

/** Abre la app, sube el PDF y deja el lector paginado con texto en pantalla. */
export async function abrirLector(navegador, base, ruta, { ancho = 390, alto = 844, tactil = false, reducido = false, init = null, esperarCierre = false } = {}) {
  const contexto = await navegador.newContext({
    viewport: { width: ancho, height: alto },
    hasTouch: tactil,
    isMobile: tactil,
    reducedMotion: reducido ? 'reduce' : 'no-preference',
  });
  await contexto.addInitScript(() => {
    try { localStorage.setItem('jg_tts_rate', '1'); localStorage.setItem('jg_tts_engine', 'neural'); } catch (_) { /* sin almacenamiento */ }
  });
  if (init) await contexto.addInitScript(init);
  const p = await contexto.newPage();
  const errores = [];
  p.on('pageerror', (e) => errores.push(String(e).slice(0, 200)));
  await p.goto(base, { waitUntil: 'domcontentloaded' });
  await p.waitForTimeout(500);
  await p.locator('#tabPdf').click();
  await p.locator('#pdfInput').setInputFiles(ruta);
  await p.locator('#btnPdfRead').click();
  await p.locator('#pdfLectura p').first().waitFor({ timeout: 90000 });
  await p.waitForTimeout(1800);
  /* «Unir palabras» hace una pasada al abrir el capítulo y eso cambia el texto. */
  await p.waitForFunction(() => document.body.dataset.pdfUnir === 'listo', null, { timeout: 30000 }).catch(() => {});
  await p.waitForTimeout(300);
  const cdp = tactil ? await contexto.newCDPSession(p) : null;
  return { p, contexto, cdp, errores };
}

export const paginaActual = (p) => p.evaluate(() => window.__jgPaginas().actual);

/* ── Dedo real (CDP) ── */
export async function arrastrar(cdp, { x, y, dx = 0, dy = 0, pasos = 10, msPaso = 14 }) {
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: 1 }] });
  for (let i = 1; i <= pasos; i += 1) {
    await new Promise((r) => setTimeout(r, msPaso));
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x + (dx * i) / pasos, y: y + (dy * i) / pasos, id: 1 }] });
  }
  await new Promise((r) => setTimeout(r, msPaso));
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}

/** Dos dedos que se separan (o se juntan): un pellizco. */
export async function pellizcar(cdp, { x, y, de = 40, a = 150, pasos = 8, msPaso = 14 }) {
  const puntos = (sep) => [{ x: x - sep, y, id: 1 }, { x: x + sep, y, id: 2 }];
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: puntos(de) });
  for (let i = 1; i <= pasos; i += 1) {
    await new Promise((r) => setTimeout(r, msPaso));
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: puntos(de + ((a - de) * i) / pasos) });
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}

/** Espera a que el lector deje de moverse (cierre del salto y de la hoja). */
export async function asentar(p, ms = 700) { await p.waitForTimeout(ms); }
