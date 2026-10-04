/* JG Turbo · El lector de PDF en el teléfono horizontal y el giro.
 *
 *   node tests/verificar_pdf_orientacion.mjs
 *   JG_ESC=360 node tests/verificar_pdf_orientacion.mjs   (un solo escenario)
 *
 * Mide, con un libro de varias páginas y el motor real:
 *   (a) girar 390×844 ↔ 844×390 (y 360×800 ↔ 800×360) tres veces conserva el
 *       sitio: mismo carácter ancla, y al volver a vertical el mismo total de
 *       páginas y la misma página que antes de girar;
 *   (b) en horizontal el texto se lee como un libro: ≥ 8 renglones (≥ 7 en
 *       800×360), ni un píxel de la página vecina dentro de la caja visible, y
 *       el aviso del lector fuera del rectángulo del texto;
 *   (c) con la voz sonando, la página sigue a la voz tras cada giro;
 *   (d) recargar en horizontal (también en modo scroll) reabre el mismo libro,
 *       capítulo y página, y la voz queda parada y lista para seguir;
 *   (e) repaso responsive: sin desborde horizontal y con toques ≥ 44 px.
 */
import { createServer } from 'node:http';
import { readFile, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, extname, resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { armarPdf, flujoDeTexto } from './generarPdfPrueba.mjs';

const AQUI = dirname(fileURLToPath(import.meta.url));
const APP = resolve(AQUI, '..');
const R = Number(process.env.JG_R || 200); /* caracteres de voz por segundo */
const FILTRO = process.env.JG_ESC || '';

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

/* ── Libro de prosa variada y reproducible (frases únicas: la guía de voz
 * ancla cada bloque buscándolo en el texto) ── */
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
const REMATES = ['Nadie preguntó nada más.', 'Era suficiente.', '¿Quién podía asegurarlo?', 'Así empezó todo.', 'El resto es historia.', 'La puerta quedó abierta.'];
let aleatorio = azar(1);
const elegir = (lista) => lista[Math.floor(aleatorio() * lista.length)];
const usadas = new Set();
function oracion() {
  for (;;) {
    const n = `${Math.floor(2 + aleatorio() * 90)}.${Math.floor(aleatorio() * 10)}`;
    const s = `${elegir(SUJETOS)} ${elegir(ACCIONES)(elegir(LUGARES), n)}.`;
    const aguja = s.normalize('NFD').replace(/[^a-zA-Z0-9]/g, '').toLowerCase().slice(0, 64);
    if (!usadas.has(aguja)) { usadas.add(aguja); return s; }
  }
}
function parrafo() {
  const frases = [];
  const total = 3 + Math.floor(aleatorio() * 3);
  for (let j = 0; j < total; j += 1) {
    frases.push(oracion());
    if (aleatorio() < 0.35) frases.push(elegir(REMATES));
  }
  return frases.join(' ');
}
function renglones(texto, ancho = 78) {
  const salida = [];
  let actual = '';
  for (const p of texto.split(' ')) {
    if ((actual + ' ' + p).trim().length > ancho) { salida.push(actual); actual = p; } else actual = (actual + ' ' + p).trim();
  }
  if (actual) salida.push(actual);
  return salida;
}
function crearLibro(ruta, paginas) {
  aleatorio = azar(20261003 + paginas);
  usadas.clear();
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

/* ── Servidor: app + /api/tts falso de duración exacta ── */
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
      respuesta.end(wavSegundos(Math.max(0.5, String(texto).length / R)));
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
const BASE = process.env.JG_BASE || `http://127.0.0.1:${servidor.address().port}/`;
const temporal = await mkdtemp(join(tmpdir(), 'jg-orient-'));
const navegador = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });

/* ── Código que corre DENTRO de la página ── */
/* Medidas del texto visible: renglones, página vecina asomada, aviso. */
function medirVista() {
  const art = document.getElementById('pdfLectura');
  const p = window.__jgPaginas();
  const caja = art.getBoundingClientRect();
  const cs = getComputedStyle(art);
  const renglon = parseFloat(cs.lineHeight);
  /* Renglones REALES: alturas distintas de fragmentos de línea dentro de la caja,
   * en la primera columna visible. */
  const tops = new Set();
  let ajeno = 0;
  const w = document.createTreeWalker(art, NodeFilter.SHOW_TEXT);
  const r = document.createRange();
  while (w.nextNode()) {
    const n = w.currentNode;
    if (!n.length || !/\S/.test(n.data)) continue;
    r.selectNodeContents(n);
    for (const rc of r.getClientRects()) {
      if (rc.width < 1 || rc.height < 1) continue;
      if (rc.bottom <= caja.top || rc.top >= caja.bottom) continue;
      const izq = rc.left - caja.left + art.scrollLeft; /* posición dentro del texto */
      const ini = p.actual * p.paso;
      const fin = ini + p.cajaAncho;
      /* Página vecina: el fragmento empieza después de esta página (hueco incluido). */
      if (rc.left < caja.right - 1 && izq >= fin + 1) ajeno = Math.max(ajeno, caja.right - rc.left);
      if (rc.right > caja.left + 1 && izq + rc.width <= ini - 1) ajeno = Math.max(ajeno, rc.right - caja.left);
      if (rc.left >= caja.left - 1 && rc.right <= caja.right + 1 && rc.top >= caja.top - 1) tops.add(Math.round(rc.top / 3));
    }
  }
  return {
    ancho: Math.round(caja.width), alto: Math.round(caja.height), top: Math.round(caja.top), bottom: Math.round(caja.bottom),
    renglonesPorAlto: renglon > 0 ? Math.floor((art.clientHeight + 0.5) / renglon) : 0,
    renglonesVistos: tops.size,
    ajenoPx: Math.round(ajeno * 10) / 10,
    total: p.total, actual: p.actual, ancla: p.ancla, paso: p.paso, activo: p.activo,
    estable: !!p.activo && Math.abs(caja.width - p.cajaAncho) <= 0.75 && Math.abs(caja.height - p.cajaAlto) <= 1.5,
    scrollIz: art.scrollLeft,
    desborde: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    modo: art.dataset.paginado || 'no',
  };
}

async function esperarEstable(p, ms = 400) {
  await p.waitForFunction(() => {
    const g = window.__jgPaginas && window.__jgPaginas();
    const art = document.getElementById('pdfLectura');
    if (!g || !g.activo || !art) return false;
    const c = art.getBoundingClientRect();
    return Math.abs(c.width - g.cajaAncho) <= 0.75 && Math.abs(c.height - g.cajaAlto) <= 1.5;
  }, null, { timeout: 8000 }).catch(() => {});
  await p.waitForTimeout(ms);
}

async function abrirLibro(ancho, alto, paginasPdf, { sinVoz = false } = {}) {
  const ruta = join(temporal, `libro-${paginasPdf}.pdf`);
  crearLibro(ruta, paginasPdf);
  const contexto = await navegador.newContext({ viewport: { width: ancho, height: alto } });
  await contexto.addInitScript(() => {
    try { localStorage.setItem('jg_tts_rate', '1'); localStorage.setItem('jg_tts_engine', 'neural'); } catch (_) {}
  });
  const p = await contexto.newPage();
  const errores = [];
  p.on('pageerror', (e) => errores.push(String(e).slice(0, 200)));
  await p.goto(BASE, { waitUntil: 'domcontentloaded' });
  await p.waitForTimeout(600);
  await p.locator('#tabPdf').click();
  await p.locator('#pdfInput').setInputFiles(ruta);
  await p.locator('#btnPdfRead').click();
  await p.locator('#pdfLectura p').first().waitFor({ timeout: 90000 });
  await p.waitForTimeout(1500);
  await esperarEstable(p, 300);
  return { p, errores, contexto };
}

/* Pasa páginas con el botón real hasta llegar a `n` (índice). */
async function irAPaginaN(p, n) {
  for (let i = 0; i < 30; i += 1) {
    const a = await p.evaluate(() => window.__jgPaginas().actual);
    if (a >= n) break;
    await p.evaluate(() => document.getElementById('btnPdfPagNext').click());
    await p.waitForTimeout(150);
  }
  await p.waitForTimeout(500);
}

const ESCENARIOS = [
  { nombre: 'teléfono 390×844 ↔ 844×390', v: [390, 844], h: [844, 390], minRenglones: 8 },
  { nombre: 'android 360×800 ↔ 800×360', v: [360, 800], h: [800, 360], minRenglones: 7 },
];

for (const esc of ESCENARIOS.filter((e) => !FILTRO || e.nombre.includes(FILTRO))) {
  console.log(`\n── ${esc.nombre} ──`);
  const s = await abrirLibro(esc.v[0], esc.v[1], 6);
  const { p } = s;
  const ini = await p.evaluate(medirVista);
  comprobar(ini.activo && ini.total >= 8, `${esc.nombre}: el capítulo tiene ≥ 8 páginas en vertical (${ini.total})`);
  await irAPaginaN(p, 3);
  const base = await p.evaluate(medirVista);
  comprobar(base.actual === 3, `${esc.nombre}: se llegó a la página 4 (índice ${base.actual})`);
  console.log(`  vertical: total=${base.total} actual=${base.actual} ancla=${base.ancla} renglones=${base.renglonesVistos}/${base.renglonesPorAlto}`);

  for (let vuelta = 1; vuelta <= 3; vuelta += 1) {
    await p.setViewportSize({ width: esc.h[0], height: esc.h[1] });
    await esperarEstable(p, 500);
    const h = await p.evaluate(medirVista);
    const t = `${esc.nombre} · giro ${vuelta} horizontal`;
    console.log(`  horizontal ${vuelta}: total=${h.total} actual=${h.actual} ancla=${h.ancla} renglones=${h.renglonesVistos}/${h.renglonesPorAlto} ajeno=${h.ajenoPx}px caja=${h.ancho}×${h.alto}`);
    comprobar(h.activo, `${t}: sigue paginado`);
    comprobar(h.ancla === base.ancla, `${t}: el carácter ancla no cambia (${base.ancla} → ${h.ancla})`);
    comprobar(h.renglonesPorAlto >= esc.minRenglones, `${t}: ≥ ${esc.minRenglones} renglones por alto (${h.renglonesPorAlto})`);
    comprobar(h.renglonesVistos >= esc.minRenglones, `${t}: ≥ ${esc.minRenglones} renglones realmente dibujados (${h.renglonesVistos})`);
    comprobar(h.ajenoPx <= 1, `${t}: ningún texto de la página vecina dentro de la caja (${h.ajenoPx} px)`);
    comprobar(h.desborde <= 0, `${t}: sin desborde horizontal de la página (${h.desborde} px)`);
    await p.setViewportSize({ width: esc.v[0], height: esc.v[1] });
    await esperarEstable(p, 500);
    const v = await p.evaluate(medirVista);
    const tv = `${esc.nombre} · vuelta ${vuelta} a vertical`;
    comprobar(v.total === base.total, `${tv}: mismo total de páginas (${base.total} → ${v.total})`);
    comprobar(v.actual === base.actual, `${tv}: misma página (${base.actual} → ${v.actual})`);
    comprobar(v.ancla === base.ancla, `${tv}: mismo carácter ancla (${base.ancla} → ${v.ancla})`);
    comprobar(v.ajenoPx <= 1, `${tv}: ningún texto de la página vecina (${v.ajenoPx} px)`);
  }

  /* El aviso del lector cae fuera del rectángulo del texto, en horizontal. */
  await p.setViewportSize({ width: esc.h[0], height: esc.h[1] });
  await esperarEstable(p, 500);
  const aviso = await p.evaluate(() => {
    const a = document.getElementById('pdfNoticeLector');
    a.className = 'notice warn pdf-aviso-lector';
    a.textContent = 'No se pudo guardar el avance de este capítulo en la nube.';
    a.hidden = false;
    const art = document.getElementById('pdfLectura').getBoundingClientRect();
    const r = a.getBoundingClientRect();
    const dentro = Math.max(0, Math.min(r.right, art.right) - Math.max(r.left, art.left)) * Math.max(0, Math.min(r.bottom, art.bottom) - Math.max(r.top, art.top));
    const salida = { dentro: Math.round(dentro), aviso: [Math.round(r.left), Math.round(r.top), Math.round(r.right), Math.round(r.bottom)], visible: r.width > 0 && r.height > 0 };
    a.hidden = true;
    return salida;
  });
  comprobar(aviso.visible && aviso.dentro === 0, `${esc.nombre} horizontal: el aviso del lector no tapa el texto (${aviso.dentro} px² encima; aviso ${aviso.aviso})`);

  /* Repaso responsive en horizontal: toques ≥ 44 px, nada fuera de la pantalla. */
  const toques = await p.evaluate(() => {
    const malos = [];
    const ancho = innerWidth;
    const alto = innerHeight;
    for (const b of document.querySelectorAll('body.jg-leyendo button, body.jg-leyendo summary, body.jg-leyendo select, body.jg-leyendo input[type=range]')) {
      const cs = getComputedStyle(b);
      if (cs.display === 'none' || cs.visibility === 'hidden' || +cs.opacity === 0) continue;
      const r = b.getBoundingClientRect();
      if (r.width < 1 || r.height < 1) continue;
      if (r.bottom < 0 || r.top > alto || r.right < 0 || r.left > ancho) continue;
      if (b.closest('[hidden], [inert]')) continue;
      if (r.height < 43.5 || r.width < 43.5) malos.push(`${b.id || b.className || b.tagName}:${Math.round(r.width)}×${Math.round(r.height)}`);
    }
    return malos;
  });
  comprobar(toques.length === 0, `${esc.nombre} horizontal: todos los toques visibles miden ≥ 44 px`, toques.slice(0, 8).join(' | '));
  comprobar(s.errores.length === 0, `${esc.nombre}: sin errores de JavaScript`, s.errores.join(' | '));
  await s.contexto.close();
}

await navegador.close();
servidor.close();
console.log(fallos.length === 0
  ? `\n✔ orientación y giro · ${comprobaciones} comprobaciones, 0 fallos`
  : `\n❌ ${fallos.length} fallos de ${comprobaciones} comprobaciones`);
process.exit(fallos.length === 0 ? 0 : 1);
