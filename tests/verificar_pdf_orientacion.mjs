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
  const columnas = art.dataset.columnas === '2' ? 2 : 1;
  const xPrimeraColumna = caja.left + (columnas === 2 ? (caja.width - (parseFloat(cs.columnGap) || 0)) / 2 + 1 : caja.width);
  /* Renglones REALES: alturas distintas de fragmentos de línea dentro de la
   * caja, solo en la primera columna visible (la segunda arranca a otra altura
   * si cae un título o un párrafo nuevo). */
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
      if (rc.left >= caja.left - 1 && rc.left < xPrimeraColumna && rc.top >= caja.top - 1 && rc.bottom <= caja.bottom + 1) tops.add(Math.round(rc.top / 3));
    }
  }
  return {
    ancho: Math.round(caja.width), alto: Math.round(caja.height), top: Math.round(caja.top), bottom: Math.round(caja.bottom),
    renglonesPorAlto: renglon > 0 ? Math.floor((art.clientHeight + 0.5) / renglon) : 0,
    renglonesVistos: tops.size,
    columnas,
    letra: parseFloat(cs.fontSize),
    ajenoPx: Math.round(ajeno * 10) / 10,
    total: p.total, actual: p.actual, ancla: p.ancla, paso: p.paso, activo: p.activo,
    visible: p.visible,
    inmersivo: document.body.classList.contains('jg-inmersivo'),
    desborde: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    modo: art.dataset.paginado || 'no',
  };
}

/* Aviso del lector: ¿se ve de verdad y cae fuera del texto? */
function medirAviso() {
  const a = document.getElementById('pdfNoticeLector');
  a.className = 'notice warn pdf-aviso-lector';
  a.textContent = 'No se pudo guardar el avance de este capítulo en la nube.';
  a.hidden = false;
  const art = document.getElementById('pdfLectura').getBoundingClientRect();
  const r = a.getBoundingClientRect();
  const cs = getComputedStyle(a);
  const dentro = Math.max(0, Math.min(r.right, art.right) - Math.max(r.left, art.left)) * Math.max(0, Math.min(r.bottom, art.bottom) - Math.max(r.top, art.top));
  const enPantalla = r.left >= -0.5 && r.top >= -0.5 && r.right <= innerWidth + 0.5 && r.bottom <= innerHeight + 0.5;
  /* Y no puede tapar los controles fijos (cabecera, paginación, barra). */
  let sobreCromo = 0;
  for (const sel of ['.pdf-doc-top', '#pdfPaginacion', '#pdfBarraMovil']) {
    const c = document.querySelector(sel);
    if (!c) continue;
    const cc = getComputedStyle(c);
    if (cc.display === 'none' || cc.visibility === 'hidden' || +cc.opacity === 0) continue;
    const q = c.getBoundingClientRect();
    sobreCromo += Math.max(0, Math.min(r.right, q.right) - Math.max(r.left, q.left)) * Math.max(0, Math.min(r.bottom, q.bottom) - Math.max(r.top, q.top));
  }
  const salida = {
    dentro: Math.round(dentro), enPantalla, sobreCromo: Math.round(sobreCromo),
    visible: r.width > 0 && r.height > 0 && cs.visibility === 'visible' && +cs.opacity > 0.5,
    aviso: [r, ].map((x) => [Math.round(x.left), Math.round(x.top), Math.round(x.right), Math.round(x.bottom)])[0],
  };
  a.hidden = true;
  return salida;
}

/* Toques ≥ 44 px entre lo visible del lector. */
function medirToques() {
  const malos = [];
  const ancho = innerWidth;
  const alto = innerHeight;
  for (const b of document.querySelectorAll('body.jg-leyendo button, body.jg-leyendo summary, body.jg-leyendo select, body.jg-leyendo input[type=range], body.jg-leyendo a[href]')) {
    const cs = getComputedStyle(b);
    if (cs.display === 'none' || cs.visibility === 'hidden' || +cs.opacity === 0) continue;
    const r = b.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) continue;
    if (r.bottom <= 0 || r.top >= alto || r.right <= 0 || r.left >= ancho) continue;
    if (b.closest('[hidden], [inert]')) continue;
    if (r.height < 43.5 || r.width < 43.5) malos.push(`${b.id || b.className || b.tagName}:${Math.round(r.width)}×${Math.round(r.height)}`);
  }
  return malos;
}

/* ¿Algún control clave está tapado por otro elemento? (centro del control) */
function medirTapados() {
  const tapados = [];
  for (const id of ['btnPdfBack', 'btnPdfPagPrev', 'btnPdfPagNext', 'btnPdfBmVoz', 'btnPdfBmApariencia', 'btnPdfBmIndice', 'btnPdfBmOpciones']) {
    const n = document.getElementById(id);
    if (!n) continue;
    const cs = getComputedStyle(n);
    if (cs.display === 'none' || cs.visibility === 'hidden' || n.closest('[hidden]')) continue;
    /* El cromo apartado (inmersivo) está a propósito sin opacidad ni toques. */
    let apartado = false;
    for (let e = n; e; e = e.parentElement) { const c = getComputedStyle(e); if (+c.opacity === 0 || c.pointerEvents === 'none') { apartado = true; break; } }
    if (apartado) continue;
    const r = n.getBoundingClientRect();
    if (r.width < 1) continue;
    const x = r.left + r.width / 2;
    const y = r.top + r.height / 2;
    if (x < 0 || y < 0 || x > innerWidth || y > innerHeight) { tapados.push(`${id}:fuera`); continue; }
    const arriba = document.elementFromPoint(x, y);
    if (!arriba || (arriba !== n && !n.contains(arriba))) tapados.push(`${id}:${arriba ? (arriba.id || arriba.className.toString().slice(0, 24)) : 'nada'}`);
  }
  return tapados;
}

/* Contraste AA (4,5:1) del texto del lector y de su cromo, con el fondo REAL. */
function medirContraste() {
  const parsear = (c) => { const m = c.match(/rgba?\(([^)]+)\)/); if (!m) return null; const [r, g, b, a = 1] = m[1].split(/[ ,\/]+/).filter(Boolean).map(Number); return { r, g, b, a }; };
  const luz = ({ r, g, b }) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
  const fondoReal = (n) => {
    let capas = [];
    for (let e = n; e; e = e.parentElement) {
      const c = parsear(getComputedStyle(e).backgroundColor);
      if (c && c.a > 0) { capas.push(c); if (c.a >= 0.99) break; }
    }
    let base = { r: 255, g: 255, b: 255 };
    for (const c of capas.reverse()) base = { r: c.r * c.a + base.r * (1 - c.a), g: c.g * c.a + base.g * (1 - c.a), b: c.b * c.a + base.b * (1 - c.a) };
    return base;
  };
  const ratio = (n, op) => {
    const cs = getComputedStyle(n);
    const t = parsear(cs.color);
    if (!t) return null;
    t.a *= op;
    const f = fondoReal(n);
    const tc = { r: t.r * t.a + f.r * (1 - t.a), g: t.g * t.a + f.g * (1 - t.a), b: t.b * t.a + f.b * (1 - t.a) };
    const a = luz(tc); const b = luz(f);
    return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
  };
  const salida = {};
  const muestras = { texto: '#pdfLectura p', titulo: '#pdfResultTitle', pagina: '#pdfPagPos', barra: '#btnPdfBmVoz span', pie: '.pdf-pie-lectura' };
  for (const [k, sel] of Object.entries(muestras)) {
    const n = document.querySelector(sel);
    if (!n) continue;
    const cs = getComputedStyle(n);
    if (cs.display === 'none' || cs.visibility === 'hidden') continue;
    /* El pie va a .75 de opacidad: se mide como se ve. */
    let op = 1; for (let e = n; e; e = e.parentElement) op *= +getComputedStyle(e).opacity;
    const base = ratio(n, op);
    if (base != null) salida[k] = Math.round(base * 100) / 100;
  }
  return salida;
}

/* ── Muestreador de la voz (como verificar_pdf_voz_pagina) ── */
function instalarMuestreador() {
  const art = document.getElementById('pdfLectura');
  const salida = [];
  window.__serie = salida;
  function paginaExacta(c) {
    const p = window.__jgPaginas && window.__jgPaginas();
    if (!p || !p.activo || !p.paso || c < 0) return -1;
    const bloques = [...art.querySelectorAll('[data-ini]')]
      .filter((b) => !b.querySelector('[data-ini]'))
      .filter((b) => Number(b.dataset.ini) <= c && Number(b.dataset.fin) > c);
    const b = bloques[bloques.length - 1];
    if (!b) return -1;
    let resto = c - Number(b.dataset.ini);
    const w = document.createTreeWalker(b, NodeFilter.SHOW_TEXT);
    while (w.nextNode()) {
      const n = w.currentNode;
      if (resto < n.length) {
        const r = document.createRange(); r.setStart(n, resto); r.setEnd(n, resto + 1);
        const rect = r.getClientRects()[0];
        if (!rect) return -1;
        return Math.max(0, Math.floor((rect.left - art.getBoundingClientRect().left + art.scrollLeft + 2) / p.paso));
      }
      resto -= n.length;
    }
    return -1;
  }
  function paginaDeCaracter(c) {
    const txt = document.getElementById('pdfOutput').value;
    let k = c;
    while (k > 0 && /\s/.test(txt[k] || ' ')) k -= 1;
    return paginaExacta(k);
  }
  window.__paginaDeCaracter = paginaDeCaracter;
  setInterval(() => {
    const dbg = window.jgGuiaDebug ? window.jgGuiaDebug() : {};
    const p = window.__jgPaginas ? window.__jgPaginas() : {};
    const caja = art.getBoundingClientRect();
    salida.push({
      t: performance.now(),
      estado: window.ttsState ? window.ttsState.status : '?',
      voz: dbg.voz ?? -1,
      actual: p.actual ?? -1,
      total: p.total ?? -1,
      paso: p.paso ?? 0,
      activo: !!p.activo,
      estable: !!p.activo && Math.abs(caja.width - p.cajaAncho) <= 0.75 && Math.abs(caja.height - p.cajaAlto) <= 1.5,
      fisica: p.paso ? art.scrollLeft / p.paso : -1,
      pagVoz: paginaDeCaracter(dbg.voz ?? -1),
    });
  }, 40);
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

async function abrirLibro(ancho, alto, paginasPdf, { almacen = {}, movil = false } = {}) {
  const ruta = join(temporal, `libro-${paginasPdf}.pdf`);
  crearLibro(ruta, paginasPdf);
  const contexto = await navegador.newContext({ viewport: { width: ancho, height: alto }, ...(movil ? { isMobile: true, hasTouch: true } : {}) });
  await contexto.addInitScript((extra) => {
    try {
      /* Solo en la primera carga de la sesión: una recarga conserva lo guardado. */
      if (!sessionStorage.getItem('__orient_init')) {
        sessionStorage.setItem('__orient_init', '1');
        localStorage.setItem('jg_tts_rate', '1'); localStorage.setItem('jg_tts_engine', 'neural');
        for (const [k, v] of Object.entries(extra)) localStorage.setItem(k, v);
      }
    } catch (_) {}
  }, almacen);
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

const iniciarVoz = (p) => p.evaluate(() => document.querySelector('[data-tts-console="pdf"] [data-tts-action="toggle"]').click());
const pararVoz = (p) => p.locator('[data-tts-console="pdf"] [data-tts-action="stop"]').click({ timeout: 2000 }).catch(() => {});

const ESCENARIOS = [
  { nombre: 'teléfono 390×844 ↔ 844×390', v: [390, 844], h: [844, 390], minRenglones: 8 },
  { nombre: 'android 360×800 ↔ 800×360', v: [360, 800], h: [800, 360], minRenglones: 7 },
];

/* Sin ruido de «estado» de las muestras: una muestra de la voz es válida si ya
 * suena, el reparto corresponde a la caja actual y pasó la tolerancia del giro. */
function analizarVoz(nombre, serie, marcas = []) {
  const TOL = 450;
  const enTransicion = (m) => marcas.some((t) => m.t >= t && m.t < t + TOL);
  const sonando = serie.filter((m) => m.estado === 'playing' && m.voz >= 0 && m.activo && m.estable && m.pagVoz >= 0 && !enTransicion(m));
  comprobar(sonando.length > 40, `${nombre}: hay serie temporal suficiente (${sonando.length} muestras)`);
  let desde = null; let prev = null; let tarde = 0; let adelantadas = 0; const lista = [];
  for (const m of sonando) {
    if (m.pagVoz !== prev) { desde = m.t; prev = m.pagVoz; }
    if (m.actual > m.pagVoz) { adelantadas += 1; if (lista.length < 5) lista.push(`adelantada voz=${m.voz} pagVoz=${m.pagVoz} actual=${m.actual}`); }
    if (m.t - desde > TOL && (m.actual !== m.pagVoz || Math.abs(m.fisica - m.pagVoz) > 0.05)) { tarde += 1; if (lista.length < 5) lista.push(`tarde voz=${m.voz} pagVoz=${m.pagVoz} actual=${m.actual} fisica=${m.fisica.toFixed(2)}`); }
  }
  comprobar(tarde === 0, `${nombre}: la página visible es la de la voz (${tarde} muestras tarde)`, lista.join(' | '));
  comprobar(adelantadas === 0, `${nombre}: la página nunca va por delante de la voz (${adelantadas})`, lista.join(' | '));
  let atras = 0;
  for (let i = 1; i < sonando.length; i += 1) {
    const a = sonando[i - 1]; const b = sonando[i];
    if (a.total === b.total && a.paso === b.paso && b.actual < a.actual) atras += 1;
  }
  comprobar(atras === 0, `${nombre}: la página no retrocede sola (${atras})`);
}

for (const esc of ESCENARIOS.filter((e) => !FILTRO || e.nombre.includes(FILTRO))) {
  console.log(`\n── ${esc.nombre} ──`);
  const s = await abrirLibro(esc.v[0], esc.v[1], 6);
  const { p } = s;
  const ini = await p.evaluate(medirVista);
  comprobar(ini.activo && ini.total >= 8, `${esc.nombre}: el capítulo tiene ≥ 8 páginas en vertical (${ini.total})`);
  await irAPaginaN(p, 3);
  const base = await p.evaluate(medirVista);
  comprobar(base.actual === 3, `${esc.nombre}: se llegó a la página 4 (índice ${base.actual})`);
  console.log(`  vertical: total=${base.total} actual=${base.actual} ancla=${base.ancla} letra=${base.letra} inmersivo=${base.inmersivo}`);

  for (let vuelta = 1; vuelta <= 3; vuelta += 1) {
    await p.setViewportSize({ width: esc.h[0], height: esc.h[1] });
    await esperarEstable(p, 500);
    const h = await p.evaluate(medirVista);
    const t = `${esc.nombre} · giro ${vuelta} horizontal`;
    console.log(`  horizontal ${vuelta}: total=${h.total} actual=${h.actual} ancla=${h.ancla} renglones=${h.renglonesVistos}/${h.renglonesPorAlto} columnas=${h.columnas} ajeno=${h.ajenoPx}px letra=${h.letra} caja=${h.ancho}×${h.alto}`);
    comprobar(h.activo, `${t}: sigue paginado`);
    comprobar(h.ancla === base.ancla, `${t}: el carácter ancla no cambia (${base.ancla} → ${h.ancla})`);
    comprobar(h.inmersivo === base.inmersivo, `${t}: el modo inmersivo se conserva (${base.inmersivo} → ${h.inmersivo})`);
    comprobar(h.renglonesPorAlto >= esc.minRenglones, `${t}: ≥ ${esc.minRenglones} renglones por alto (${h.renglonesPorAlto})`);
    comprobar(h.renglonesVistos >= esc.minRenglones - 1, `${t}: ≥ ${esc.minRenglones - 1} renglones con letra dibujados (el espacio entre párrafos come uno) (${h.renglonesVistos})`);
    comprobar(h.letra >= base.letra - 0.01, `${t}: la letra no es menor que en vertical (${base.letra} → ${h.letra})`);
    comprobar(h.ajenoPx <= 1, `${t}: ningún texto de la página vecina dentro de la caja (${h.ajenoPx} px)`);
    comprobar(h.desborde <= 0, `${t}: sin desborde horizontal (${h.desborde} px)`);
    await p.setViewportSize({ width: esc.v[0], height: esc.v[1] });
    await esperarEstable(p, 500);
    const v = await p.evaluate(medirVista);
    const tv = `${esc.nombre} · vuelta ${vuelta} a vertical`;
    comprobar(v.total === base.total, `${tv}: mismo total de páginas (${base.total} → ${v.total})`);
    comprobar(v.actual === base.actual, `${tv}: misma página (${base.actual} → ${v.actual})`);
    comprobar(v.ancla === base.ancla, `${tv}: mismo carácter ancla (${base.ancla} → ${v.ancla})`);
    comprobar(v.ajenoPx <= 1, `${tv}: ningún texto de la página vecina (${v.ajenoPx} px)`);
  }

  /* Con el cromo a la vista (se despierta con un toque) también se lee como un
   * libro y el aviso cae fuera del texto. Estado inmersivo y cromo, ambos. */
  await p.setViewportSize({ width: esc.h[0], height: esc.h[1] });
  await esperarEstable(p, 500);
  for (const conCromo of [false, true]) {
    const etiqueta = `${esc.nombre} horizontal ${conCromo ? 'con cromo' : 'inmersivo'}`;
    if (conCromo) { await p.evaluate(() => document.body.classList.remove('jg-inmersivo')); await esperarEstable(p, 700); }
    const m = await p.evaluate(medirVista);
    /* «Dibujados» cuenta renglones con letra: el espacio entre párrafos se come
     * hasta un renglón, así que se permite uno menos que el cálculo por alto. */
    comprobar(m.renglonesPorAlto >= esc.minRenglones && m.renglonesVistos >= esc.minRenglones - 1, `${etiqueta}: ≥ ${esc.minRenglones} renglones (alto ${m.renglonesPorAlto}, dibujados ${m.renglonesVistos})`);
    comprobar(m.ajenoPx <= 1 && m.desborde <= 0, `${etiqueta}: sin página vecina ni desborde (${m.ajenoPx} px, ${m.desborde} px)`);
    const aviso = await p.evaluate(medirAviso);
    comprobar(aviso.visible && aviso.enPantalla, `${etiqueta}: el aviso del lector se VE y cabe en pantalla (${aviso.aviso})`);
    comprobar(aviso.dentro === 0 && aviso.sobreCromo === 0, `${etiqueta}: el aviso no tapa el texto ni el cromo (${aviso.dentro} px² / ${aviso.sobreCromo} px²)`);
    const toques = await p.evaluate(medirToques);
    comprobar(toques.length === 0, `${etiqueta}: toques visibles ≥ 44 px`, toques.slice(0, 6).join(' | '));
    const tapados = await p.evaluate(medirTapados);
    comprobar(tapados.length === 0, `${etiqueta}: ningún control clave tapado`, tapados.join(' | '));
  }

  /* Contraste AA en los tres temas, horizontal. */
  for (const tema of ['noche', 'papel', 'sepia']) {
    await p.evaluate((t) => { document.body.dataset.lecturaTema = t; document.getElementById('pdfResultArea').dataset.tema = t; }, tema);
    await p.waitForTimeout(150);
    const c = await p.evaluate(medirContraste);
    const peor = Object.entries(c).filter(([, v]) => v < 4.5);
    comprobar(Object.keys(c).length >= 3 && peor.length === 0, `${esc.nombre} horizontal tema ${tema}: contraste AA (${JSON.stringify(c)})`);
  }
  await p.evaluate(() => { document.body.dataset.lecturaTema = 'noche'; document.getElementById('pdfResultArea').dataset.tema = 'noche'; });
  comprobar(s.errores.length === 0, `${esc.nombre}: sin errores de JavaScript`, s.errores.join(' | '));
  await s.contexto.close();

  /* ── La página sigue a la voz tras cada giro ── */
  {
    const sv = await abrirLibro(esc.v[0], esc.v[1], 6);
    const { p: pv } = sv;
    await pv.evaluate(instalarMuestreador);
    await iniciarVoz(pv);
    await pv.waitForFunction(() => window.ttsState && window.ttsState.status === 'playing', null, { timeout: 60000 }).catch(() => {});
    await pv.waitForFunction(() => window.__jgPaginas().actual >= 1, null, { timeout: 90000 }).catch(() => {});
    const marcas = [];
    for (const [i, medida] of [esc.h, esc.v, esc.h, esc.v].entries()) {
      await pv.waitForTimeout(3500);
      marcas.push(await pv.evaluate(() => performance.now()));
      await pv.setViewportSize({ width: medida[0], height: medida[1] });
      console.log(`  giro ${i + 1} con la voz sonando → ${medida.join('×')}`);
    }
    await pv.waitForTimeout(5000);
    const serie = await pv.evaluate(() => window.__serie);
    await pararVoz(pv);
    analizarVoz(`${esc.nombre} · con la voz y 4 giros`, serie, marcas);
    comprobar(sv.errores.length === 0, `${esc.nombre} (voz): sin errores de JavaScript`, sv.errores.join(' | '));
    await sv.contexto.close();
  }
}

/* ── Recargar en horizontal reabre el mismo libro, capítulo y página ── */
for (const modo of ['paginas', 'scroll']) {
  if (FILTRO && !'horizontal 844×390'.includes(FILTRO) && !modo.includes(FILTRO)) continue;
  console.log(`\n── recargar en horizontal 844×390 · modo ${modo} ──`);
  const almacen = modo === 'scroll' ? { jg_pdf_lectura: JSON.stringify({ modoPagina: 'scroll' }) } : {};
  const s = await abrirLibro(844, 390, 6, { almacen });
  const { p } = s;
  const nombre = `recarga 844×390 (${modo})`;
  let antes;
  if (modo === 'paginas') {
    /* La voz suena y se pasa de página con el botón (la voz sigue a la página
     * elegida): así queda sonando en la página 5. */
    await iniciarVoz(p);
    await p.waitForFunction(() => window.ttsState && window.ttsState.status === 'playing', null, { timeout: 60000 }).catch(() => {});
    for (let i = 0; i < 4; i += 1) {
      await p.waitForTimeout(900);
      await p.evaluate(() => document.getElementById('btnPdfPagNext').click());
    }
    await p.waitForTimeout(1200);
    /* Pausa justo en esta página (con la voz parada la página no se mueve). */
    await iniciarVoz(p);
    await p.waitForTimeout(900);
    antes = await p.evaluate(() => ({ ...window.__jgPaginas(), voz: window.jgGuiaDebug ? window.jgGuiaDebug().voz : -1, estado: window.ttsState.status }));
    console.log(`  antes: página ${antes.actual + 1}/${antes.total} ancla=${antes.ancla} voz=${antes.voz} estado=${antes.estado}`);
    comprobar(antes.estado === 'paused', `${nombre}: la voz quedó en pausa antes de recargar (${antes.estado})`);
    comprobar(antes.actual >= 4, `${nombre}: se recargará desde la página ≥ 5 (${antes.actual + 1})`);
  } else {
    await p.evaluate(() => {
      const c = document.getElementById('pdfLectura');
      const bloques = [...c.querySelectorAll('[data-ini]')];
      bloques[Math.floor(bloques.length * 0.6)].scrollIntoView({ block: 'start' });
    });
    await p.waitForTimeout(900);
    antes = await p.evaluate(() => ({ ...window.__jgPaginas() }));
    console.log(`  antes (scroll): visible=${antes.visible}`);
    comprobar(antes.visible > 500, `${nombre}: hay un punto de lectura lejos del inicio (${antes.visible})`);
    antes.activo = false;
  }
  await p.waitForTimeout(1800);
  const idAntes = await p.evaluate(() => localStorage.getItem('jg_pdf_doc_abierto'));
  const tituloAntes = await p.evaluate(() => document.getElementById('pdfResultTitle').textContent);
  await p.reload({ waitUntil: 'domcontentloaded' });
  await p.waitForSelector('body.jg-leyendo', { timeout: 15000 }).catch(() => {});
  await p.locator('#pdfLectura p').first().waitFor({ timeout: 30000 }).catch(() => {});
  await p.waitForTimeout(1800);
  await esperarEstable(p, 600);
  const despues = await p.evaluate(() => ({
    leyendo: document.body.classList.contains('jg-leyendo'),
    id: localStorage.getItem('jg_pdf_doc_abierto'),
    titulo: (document.getElementById('pdfResultTitle') || {}).textContent,
    ...window.__jgPaginas(),
    estado: window.ttsState.status,
  }));
  console.log(`  después: leyendo=${despues.leyendo} página ${despues.actual + 1}/${despues.total} visible=${despues.visible} estado=${despues.estado}`);
  comprobar(despues.leyendo && despues.id === idAntes && despues.titulo === tituloAntes, `${nombre}: reabre el mismo libro (${tituloAntes})`);
  comprobar(despues.estado !== 'playing', `${nombre}: la voz no arranca sola (${despues.estado})`);
  if (modo === 'paginas') {
    comprobar(despues.activo && despues.total === antes.total, `${nombre}: mismo total de páginas (${antes.total} → ${despues.total})`);
    comprobar(despues.actual === antes.actual, `${nombre}: misma página (${antes.actual + 1} → ${despues.actual + 1})`);
    /* Un toque en «Escuchar»: la voz sigue desde esta página, no desde el inicio. */
    await p.evaluate(instalarMuestreador);
    await iniciarVoz(p);
    await p.waitForFunction(() => window.ttsState && window.ttsState.status === 'playing', null, { timeout: 60000 }).catch(() => {});
    await p.waitForTimeout(1500);
    const reanuda = await p.evaluate(() => { const m = window.__serie[window.__serie.length - 1]; return { voz: m.voz, pagVoz: m.pagVoz, actual: window.__jgPaginas().actual, estado: m.estado }; });
    console.log(`  al seguir: voz=${reanuda.voz} página de la voz=${reanuda.pagVoz + 1} vista=${reanuda.actual + 1}`);
    comprobar(reanuda.estado === 'playing' && reanuda.pagVoz === despues.actual && reanuda.actual === despues.actual,
      `${nombre}: con un toque la voz sigue desde la misma página (voz en ${reanuda.pagVoz + 1}, vista ${reanuda.actual + 1}, antes ${despues.actual + 1})`);
    await pararVoz(p);
  } else {
    comprobar(!despues.activo, `${nombre}: sigue en modo desplazamiento`);
    comprobar(Math.abs(despues.visible - antes.visible) < 600, `${nombre}: mismo punto de lectura (${antes.visible} → ${despues.visible})`);
  }
  comprobar(s.errores.length === 0, `${nombre}: sin errores de JavaScript`, s.errores.join(' | '));
  await s.contexto.close();
}

/* ── Abrir DIRECTAMENTE en horizontal (también con emulación móvil/táctil) y
 * P-01: la caja paginada mide igual con el cromo visible u oculto ── */
for (const [w, h, minR] of [[844, 390, 8], [800, 360, 7]]) {
  for (const movil of [false, true]) {
    if (FILTRO && !`${w}${h}`.includes(FILTRO)) continue;
    const nombre = `abrir en ${w}×${h}${movil ? ' (móvil táctil)' : ''}`;
    console.log(`
── ${nombre} ──`);
    const s = await abrirLibro(w, h, 6, { movil });
    const { p } = s;
    const a = await p.evaluate(medirVista);
    comprobar(a.activo && a.total >= 4 && a.alto > 100, `${nombre}: texto paginado (${a.total} páginas, caja ${a.ancho}×${a.alto})`);
    comprobar(a.renglonesPorAlto >= minR, `${nombre}: ≥ ${minR} renglones por alto (${a.renglonesPorAlto})`);
    comprobar(a.columnas === 2, `${nombre}: dos columnas (${a.columnas})`);
    await irAPaginaN(p, 2);
    const antes = await p.evaluate(medirVista);
    const lista = [];
    for (const ver of [true, false, true, false]) {
      await p.evaluate((v) => document.body.classList.toggle('jg-inmersivo', !v), ver);
      await p.waitForTimeout(450);
      lista.push(await p.evaluate(medirVista));
    }
    const mismo = lista.every((m) => m.total === antes.total && m.actual === antes.actual && m.alto === antes.alto && m.ancho === antes.ancho && m.ancla === antes.ancla);
    comprobar(mismo, `${nombre}: la caja paginada es igual con cromo visible u oculto (total ${antes.total}, página ${antes.actual + 1}, caja ${antes.ancho}×${antes.alto}; vistos ${lista.map((m) => `${m.total}/${m.actual + 1}/${m.alto}`).join(' ')})`);
    comprobar(s.errores.length === 0, `${nombre}: sin errores de JavaScript`, s.errores.join(' | '));
    await s.contexto.close();
  }
}

/* ── Repaso responsive: biblioteca y lector en 7 tamaños ── */
const TAMANOS = [[360, 800], [390, 844], [844, 390], [800, 360], [768, 1024], [1024, 768], [1440, 900]];
for (const [w, h] of TAMANOS) {
  if (FILTRO && !`${w}`.includes(FILTRO) && !`${h}`.includes(FILTRO)) continue;
  console.log(`\n── repaso ${w}×${h} ──`);
  const s = await abrirLibro(w, h, 6);
  const { p } = s;
  const nombre = `repaso ${w}×${h}`;
  const m = await p.evaluate(medirVista);
  comprobar(m.desborde <= 0, `${nombre} lector: sin desborde horizontal (${m.desborde} px)`);
  comprobar(m.ajenoPx <= 1, `${nombre} lector: sin texto de la página vecina (${m.ajenoPx} px)`);
  /* En horizontal bajo el aviso cae en la franja del pie; en las demás pantallas
   * flota sobre el dock (transitorio, hasta 12 s) y solo se exige no tapar el cromo. */
  const horizontalBajo = w > h && h <= 500;
  const avisoInm = await p.evaluate(medirAviso);
  comprobar(avisoInm.visible && avisoInm.enPantalla && avisoInm.sobreCromo === 0 && (!horizontalBajo || avisoInm.dentro === 0),
    `${nombre} lector (${m.inmersivo ? 'inmersivo' : 'cromo fijo'}): el aviso se ve${horizontalBajo ? ' y no tapa el texto' : ''} y no tapa el cromo (texto ${avisoInm.dentro} px², cromo ${avisoInm.sobreCromo} px²)`);
  /* El cromo apartado no se puede tocar ni leer: se despierta como lo haría un toque. */
  if (m.inmersivo) { await p.evaluate(() => document.body.classList.remove('jg-inmersivo')); await esperarEstable(p, 700); }
  const tapados = await p.evaluate(medirTapados);
  comprobar(tapados.length === 0, `${nombre} lector: nada tapado`, tapados.join(' | '));
  const toques = await p.evaluate(medirToques);
  comprobar(toques.length === 0, `${nombre} lector: toques visibles ≥ 44 px`, toques.slice(0, 6).join(' | '));
  for (const tema of ['noche', 'papel', 'sepia']) {
    await p.evaluate((t) => { document.body.dataset.lecturaTema = t; document.getElementById('pdfResultArea').dataset.tema = t; }, tema);
    await p.waitForTimeout(120);
    const c = await p.evaluate(medirContraste);
    const peor = Object.entries(c).filter(([, v]) => v < 4.5);
    comprobar(peor.length === 0, `${nombre} tema ${tema}: contraste AA (${JSON.stringify(c)})`);
  }
  /* Biblioteca: se vuelve con «Biblioteca». */
  await p.evaluate(() => document.getElementById('btnPdfBack').click());
  await p.waitForSelector('body:not(.jg-leyendo)', { timeout: 8000 }).catch(() => {});
  await p.waitForTimeout(900);
  const bib = await p.evaluate(() => {
    const malos = [];
    for (const b of document.querySelectorAll('#panelPdf button, #panelPdf summary, #panelPdf select, #panelPdf a[href]')) {
      const cs = getComputedStyle(b);
      if (cs.display === 'none' || cs.visibility === 'hidden' || +cs.opacity === 0) continue;
      const r = b.getBoundingClientRect();
      if (r.width < 1 || r.height < 1) continue;
      if (b.closest('[hidden], [inert]')) continue;
      /* Solo lo que se ve ahora o está en el primer pantallazo de la lista. */
      if (r.height < 43.5 || r.width < 43.5) malos.push(`${b.id || b.className || b.tagName}:${Math.round(r.width)}×${Math.round(r.height)}`);
    }
    return { malos, desborde: document.documentElement.scrollWidth - document.documentElement.clientWidth, tarjetas: document.querySelectorAll('[data-doc-id]').length };
  });
  comprobar(bib.tarjetas >= 1, `${nombre} biblioteca: aparece el libro (${bib.tarjetas})`);
  comprobar(bib.desborde <= 0, `${nombre} biblioteca: sin desborde horizontal (${bib.desborde} px)`);
  comprobar(bib.malos.length === 0, `${nombre} biblioteca: toques visibles ≥ 44 px`, bib.malos.slice(0, 6).join(' | '));
  comprobar(s.errores.length === 0, `${nombre}: sin errores de JavaScript`, s.errores.join(' | '));
  await s.contexto.close();
}

await navegador.close();
servidor.close();
console.log(fallos.length === 0
  ? `\n✔ orientación y giro · ${comprobaciones} comprobaciones, 0 fallos`
  : `\n❌ ${fallos.length} fallos de ${comprobaciones} comprobaciones`);
process.exit(fallos.length === 0 ? 0 : 1);
