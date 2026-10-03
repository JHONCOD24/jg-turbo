/* JG Turbo · La página sigue a la voz y la marca cubre una unidad entera.
 *
 *   node tests/verificar_pdf_voz_pagina.mjs
 *   JG_VER=1 node tests/verificar_pdf_voz_pagina.mjs   (imprime la serie temporal)
 *
 * Lee un capítulo de varias páginas, de principio a fin, con el motor de voz
 * REAL y un /api/tts falso que sirve WAV silencioso de duración exacta
 * (ritmo constante conocido). En el navegador se muestrea cada ~40 ms:
 *   · el carácter que la guía cree que suena (`jgGuiaDebug().voz`),
 *   · el texto marcado en la vista (todas las <mark>),
 *   · la página lógica (`__jgPaginas().actual`) y la física (scrollLeft/paso),
 *   · la página donde cae ese carácter, medida con un Range sobre el DOM.
 *
 * Se exige, en teléfono (390×844) y escritorio (1440×900):
 *   (i)   la página visible = la página de la voz (≤ 450 ms tras cruzar),
 *   (ii)  páginas monótonas: 0 retrocesos mientras nadie las pide,
 *   (iii) 0 muestras con la página por DELANTE de la voz,
 *   (iv)  la marca nunca está vacía y es EXACTAMENTE la unidad (oración o
 *         cláusula) del carácter que suena,
 *   (v)   cromo (`jg-inmersivo`), resize y giro a mitad de lectura no sacan la
 *         página de la voz ni la hacen retroceder.
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
const TOLERANCIA_MS = 450;
const VERBOSO = !!process.env.JG_VER;

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

/* ── PDF con prosa variada: abreviaturas, decimales, diálogo, citas ──
 * Sin frases repetidas: la guía ancla cada bloque de voz buscándolo en el
 * texto, y un texto que se repite es un caso distinto (y ya cubierto en
 * test_pdf_guia_anclas). Aquí se mide la página, no el anclaje. */
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
  (l, n, m) => `recorrió el valle de ${l} hacia las ${n} de la mañana, cuando la niebla todavía cubría los tejados`,
  (l, n, m) => `cruzó el puente de ${l}, que según los registros mide ${n} metros de ancho y resiste desde 1890`,
  (l, n, m) => `viajó a EE. UU. para consultar los archivos de ${l}, aunque nadie creyó que regresaría`,
  (l, n, m) => `guardó las cartas de ${l} en el cajón, p. ej. las de marzo, y decidió no abrirlas hasta el invierno`,
  (l, n, m) => `escuchó el rumor del río junto a ${l}; luego, sin prisa, volvió a la casa donde la esperaban los demás`,
  (l, n, m) => `dijo con calma: «Nada de lo ocurrido en ${l} es casual», y todos guardaron silencio durante un buen rato`,
  (l, n, m) => `compró ${m} ladrillos, tejas, clavos, etc. antes de que subieran los precios en ${l}`,
  (l, n, m) => `abrió la ventana que da a ${l} y, sin dejar de mirar el camino, repitió lo que había aprendido de su madre`,
  (l, n, m) => `pesó ${n} kilos de grano en la plaza de ${l} y anotó la cifra en un cuaderno viejo`,
  (l, n, m) => `contó que en ${l} el invierno dura ${n} semanas, y que cada una trae su propia costumbre: la lluvia, la neblina o el viento`,
  (l, n, m) => `escribió desde ${l}: «Llegaremos tarde, pero llegaremos», y firmó con la letra torcida de siempre`,
  (l, n, m) => `reunió a ${m} personas en ${l} para decidir si el camino real pasaría por la ladera o por el río`,
];
const REMATES = ['Nadie preguntó nada más.', 'Era suficiente.', '¿Quién podía asegurarlo?', 'Así empezó todo.', 'El resto es historia.', '¡Qué tarde se había hecho!', 'Fue la última vez que lo vieron.', 'La puerta quedó abierta.', 'Nadie lo olvidó.', '¿Y después?'];
const aleatorio = azar(20261003);
const elegir = (lista) => lista[Math.floor(aleatorio() * lista.length)];
const usadas = new Set();
function oracion() {
  for (;;) {
    const n = `${Math.floor(2 + aleatorio() * 90)}.${Math.floor(aleatorio() * 10)}`;
    const m = `${Math.floor(1 + aleatorio() * 9)}.${String(Math.floor(aleatorio() * 1000)).padStart(3, '0')}`;
    const s = `${elegir(SUJETOS)} ${elegir(ACCIONES)(elegir(LUGARES), n, m)}.`;
    /* Única por sus primeras 64 letras: es la «aguja» con la que la guía
     * busca cada bloque de voz en el texto. */
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
function crearLibroNarrativo(ruta, paginas) {
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
const temporal = await mkdtemp(join(tmpdir(), 'jg-voz-pag-'));
const navegador = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });

/* Código que corre DENTRO de la página: muestrea la serie temporal. */
function instalarMuestreador() {
  const art = document.getElementById('pdfLectura');
  const salida = [];
  window.__serie = salida;
  window.__marcaDe = (c) => c;
  /* Página donde cae el carácter `c` del capítulo (Range sobre el DOM). */
  function paginaDeCaracter(c) {
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
  window.__paginaDeCaracter = paginaDeCaracter;
  window.__eventos = [];
  setInterval(() => {
    const dbg = window.jgGuiaDebug ? window.jgGuiaDebug() : {};
    const p = window.__jgPaginas ? window.__jgPaginas() : {};
    const marcas = [...art.querySelectorAll('mark')];
    salida.push({
      t: performance.now(),
      estado: window.ttsState ? window.ttsState.status : '?',
      voz: dbg.voz ?? -1,
      desde: dbg.desde ?? -1,
      hasta: dbg.hasta ?? -1,
      marca: marcas.map((m) => m.textContent).join(''),
      nMarcas: marcas.length,
      actual: p.actual ?? -1,
      total: p.total ?? -1,
      paso: p.paso ?? 0,
      activo: !!p.activo,
      fisica: p.paso ? art.scrollLeft / p.paso : -1,
      pagVoz: paginaDeCaracter(dbg.voz ?? -1),
    });
  }, 40);
}

async function abrirLibro(ancho, alto, paginasPdf) {
  const ruta = join(temporal, `libro-${paginasPdf}.pdf`);
  crearLibroNarrativo(ruta, paginasPdf);
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
  await p.waitForTimeout(1800);
  return { p, errores, contexto };
}

async function leerYMuestrear({ p }, { alto, ancho, perturbar }) {
  await p.evaluate(instalarMuestreador);
  await p.evaluate(() => document.querySelector('[data-tts-console="pdf"] [data-tts-action="toggle"]').click());
  await p.waitForFunction(() => window.ttsState && window.ttsState.status === 'playing', null, { timeout: 60000 }).catch(() => console.log('AVISO: no llegó a playing'));
  const inicio = Date.now();
  const marcas = {};
  let hecho = 0;
  const duracion = await p.evaluate(() => (document.getElementById('pdfOutput').value || '').length);
  const limite = (duracion / R) * 1000 + 40000;
  while (Date.now() - inicio < limite) {
    await p.waitForTimeout(200);
    const e = await p.evaluate(() => (window.ttsState ? window.ttsState.status : '?'));
    const fraccion = (Date.now() - inicio) / ((duracion / R) * 1000);
    if (perturbar) {
      for (const [k, paso] of perturbar.entries()) {
        if (hecho <= k && fraccion >= paso.en) {
          hecho = k + 1;
          marcas[paso.nombre] = await p.evaluate(() => performance.now());
          await paso.hacer(p);
        }
      }
    }
    if (e === 'idle' && Date.now() - inicio > 3000) break;
  }
  const serie = await p.evaluate(() => window.__serie);
  const texto = await p.evaluate(() => document.getElementById('pdfOutput').value || '');
  await p.locator('[data-tts-console="pdf"] [data-tts-action="stop"]').click({ timeout: 2000 }).catch(() => {});
  return { serie, texto, marcas };
}

/* La unidad que debería marcarse para un carácter (módulo puro de la app). */
async function unidadesEsperadas(p, texto, caracteres) {
  return p.evaluate(async ({ texto, caracteres }) => {
    try {
      const mod = await import('/js/pdf/unidadesLectura.js');
      const unidades = mod.partirEnUnidades(texto);
      return caracteres.map((c) => {
        const u = mod.unidadEn(unidades, c);
        return u ? texto.slice(u[0], u[1]) : null;
      });
    } catch (e) { return { error: String(e).slice(0, 160) }; }
  }, { texto, caracteres });
}

function analizar(nombre, serie, texto, { marcas = {} } = {}) {
  const t0 = serie[0]?.t ?? 0;
  /* Justo tras un resize/giro el DOM ya cambió pero el reparto (paso, total)
   * se rehace con un debounce de ~180 ms: esas muestras mezclan dos repartos
   * y no miden nada. Se descartan durante la misma tolerancia de 450 ms. */
  const enTransicion = (m) => Object.values(marcas).some((t) => m.t >= t && m.t < t + TOLERANCIA_MS);
  const sonando = serie.filter((m) => m.estado === 'playing' && m.voz >= 0 && m.activo && m.pagVoz >= 0 && !enTransicion(m));
  comprobar(sonando.length > 60, `${nombre}: hay serie temporal suficiente (${sonando.length} muestras con voz y páginas)`);
  const paginasVistas = new Set(sonando.map((m) => m.pagVoz));
  comprobar(paginasVistas.size >= 6, `${nombre}: la voz recorre ≥ 6 páginas (${paginasVistas.size})`);

  /* (i) página = página de la voz tras la tolerancia; (iii) nunca por delante. */
  let desde = null;
  let pagPrev = null;
  let tardias = 0;
  let adelantadas = 0;
  let maxRetraso = 0;
  const lista = [];
  for (const m of sonando) {
    if (m.pagVoz !== pagPrev) { desde = m.t; pagPrev = m.pagVoz; }
    const edad = m.t - desde;
    if (m.actual > m.pagVoz) { adelantadas += 1; lista.push(`adelantada t=${Math.round(m.t - t0)} voz=${m.voz} pagVoz=${m.pagVoz} actual=${m.actual}`); }
    if (m.actual < m.pagVoz) maxRetraso = Math.max(maxRetraso, edad);
    if (edad > TOLERANCIA_MS && (m.actual !== m.pagVoz || Math.abs(m.fisica - m.pagVoz) > 0.05)) {
      tardias += 1;
      if (lista.length < 8) lista.push(`tarde t=${Math.round(m.t - t0)} edad=${Math.round(edad)} voz=${m.voz} pagVoz=${m.pagVoz} actual=${m.actual} fisica=${m.fisica.toFixed(2)}`);
    }
  }
  const detalle = lista.slice(0, 8).join(' | ');
  comprobar(tardias === 0, `${nombre}: (i) la página visible es la de la voz tras ${TOLERANCIA_MS} ms (${tardias} muestras tarde)`, detalle);
  comprobar(adelantadas === 0, `${nombre}: (iii) la página nunca va por delante de la voz (${adelantadas} muestras)`, detalle);

  /* (ii) monotonía de la página lógica y de la voz. */
  let retrocesos = 0;
  const donde = [];
  for (let i = 1; i < sonando.length; i += 1) {
    const a = sonando[i - 1];
    const b = sonando[i];
    if (a.total !== b.total || a.paso !== b.paso) continue; /* se repartió de nuevo: otro conteo */
    if (b.actual < a.actual) { retrocesos += 1; if (donde.length < 5) donde.push(`t=${Math.round(b.t - t0)} ${a.actual}→${b.actual} voz=${b.voz}`); }
  }
  comprobar(retrocesos === 0, `${nombre}: (ii) la página no retrocede sola (${retrocesos} retrocesos)`, donde.join(' | '));
  let vozAtras = 0;
  for (let i = 1; i < sonando.length; i += 1) if (sonando[i].voz + 400 < sonando[i - 1].voz) vozAtras += 1;
  comprobar(vozAtras === 0, `${nombre}: el carácter de la voz solo avanza (${vozAtras} retrocesos > 400)`);
  return sonando;
}

async function comprobarMarca(nombre, p, serie, texto) {
  const sonando = serie.filter((m) => m.estado === 'playing' && m.voz >= 0 && m.activo);
  const arranque = sonando.length ? sonando[0].t + 1500 : 0;
  const tras = sonando.filter((m) => m.t > arranque);
  const vacias = tras.filter((m) => !m.marca || m.nMarcas === 0);
  comprobar(vacias.length === 0, `${nombre}: (iv) la marca nunca está vacía mientras suena (${vacias.length}/${tras.length} vacías)`);
  const unicos = [...new Set(tras.map((m) => m.voz))];
  const esperadas = await unidadesEsperadas(p, texto, unicos);
  if (!Array.isArray(esperadas)) {
    comprobar(false, `${nombre}: (iv) existe js/pdf/unidadesLectura.js`, esperadas.error);
    return;
  }
  const mapa = new Map(unicos.map((c, i) => [c, esperadas[i]]));
  const norm = (s) => String(s || '').replace(/\s+/g, ' ').trim();
  let distintas = 0;
  const ejemplos = [];
  for (const m of tras) {
    const esperada = norm(mapa.get(m.voz));
    if (norm(m.marca) !== esperada) {
      distintas += 1;
      if (ejemplos.length < 3) ejemplos.push(`voz=${m.voz} marcado="${norm(m.marca).slice(0, 70)}" esperado="${esperada.slice(0, 70)}"`);
    }
  }
  comprobar(distintas <= Math.ceil(tras.length * 0.01), `${nombre}: (iv) el texto marcado es la unidad de la voz (${distintas}/${tras.length} distintas)`, ejemplos.join(' | '));
}

/* ── Escenarios ── */
const ESCENARIOS = [
  { nombre: 'teléfono 390×844', ancho: 390, alto: 844, paginasPdf: 5 },
  { nombre: 'escritorio 1440×900', ancho: 1440, alto: 900, paginasPdf: 7 },
];

for (const esc of ESCENARIOS.filter((e) => !process.env.JG_ESC || e.nombre.includes(process.env.JG_ESC))) {
  console.log(`\n── ${esc.nombre} ──`);
  const sesion = await abrirLibro(esc.ancho, esc.alto, esc.paginasPdf);
  const info = await sesion.p.evaluate(() => ({ ...window.__jgPaginas(), caracteres: (document.getElementById('pdfOutput').value || '').length }));
  console.log(`  modo paginado=${info.activo} páginas=${info.total} caracteres=${info.caracteres}`);
  comprobar(info.activo && info.total >= 6, `${esc.nombre}: el capítulo tiene ≥ 6 páginas en modo paginado (${info.total})`);

  /* Perturbaciones a mitad de lectura (v). */
  const perturbar = [
    { nombre: 'cromo-on', en: 0.25, hacer: (p) => p.evaluate(() => document.body.classList.add('jg-inmersivo')) },
    { nombre: 'cromo-off', en: 0.35, hacer: (p) => p.evaluate(() => document.body.classList.remove('jg-inmersivo')) },
    { nombre: 'resize', en: 0.55, hacer: (p) => p.setViewportSize({ width: esc.ancho - 24, height: esc.alto - 70 }) },
    { nombre: 'resize-vuelta', en: 0.65, hacer: (p) => p.setViewportSize({ width: esc.ancho, height: esc.alto }) },
    { nombre: 'giro', en: 0.78, hacer: (p) => p.setViewportSize({ width: esc.alto, height: esc.ancho }) },
    { nombre: 'giro-vuelta', en: 0.88, hacer: (p) => p.setViewportSize({ width: esc.ancho, height: esc.alto }) },
  ];

  /* Lectura limpia (sin perturbar) en la sesión principal. */
  const limpia = await leerYMuestrear(sesion, { ancho: esc.ancho, alto: esc.alto, perturbar: null });
  if (VERBOSO) console.log(JSON.stringify(limpia.serie.filter((_, i) => i % 5 === 0).map((m) => [Math.round(m.t), m.voz, m.actual, m.pagVoz, m.marca.slice(0, 25)])));
  const sonando = analizar(`${esc.nombre} · limpia`, limpia.serie, limpia.texto);
  await comprobarMarca(`${esc.nombre} · limpia`, sesion.p, limpia.serie, limpia.texto);
  /* La marca pinta la unidad ENTERA aunque el bloque tenga varios nodos de
   * texto o un elemento en línea, y aunque cruce de un bloque a otro. */
  const multinodo = await sesion.p.evaluate(() => {
    const art = document.getElementById('pdfLectura');
    const ps = [...art.querySelectorAll('p[data-ini]')];
    const p1 = ps[1];
    const base = Number(p1.dataset.ini);
    const txt = p1.textContent;
    p1.textContent = '';
    p1.append(txt.slice(0, 20));
    const em = document.createElement('em');
    em.textContent = txt.slice(20, 60);
    p1.append(em, txt.slice(60));
    window.__jgMarcarRango(base + 10, base + 90);
    const unBloque = [...art.querySelectorAll('mark')].map((m) => m.textContent).join('');
    const p2 = ps[2];
    const fin1 = Number(p1.dataset.fin);
    const ini2 = Number(p2.dataset.ini);
    window.__jgMarcarRango(fin1 - 15, ini2 + 25);
    const dosBloques = [...art.querySelectorAll('mark')].map((m) => m.textContent).join('|');
    return { unBloque, esperado1: txt.slice(10, 90), dosBloques, esperado2: `${txt.slice(txt.length - 15)}|${p2.textContent.slice(0, 25)}`, marcas: art.querySelectorAll('mark').length };
  });
  comprobar(multinodo.unBloque === multinodo.esperado1, `${esc.nombre}: la marca cubre una unidad repartida en varios nodos (<em> en medio)`, `${JSON.stringify(multinodo.unBloque)} ≠ ${JSON.stringify(multinodo.esperado1)}`);
  comprobar(multinodo.dosBloques === multinodo.esperado2, `${esc.nombre}: la marca cubre una unidad que cruza dos bloques`, `${JSON.stringify(multinodo.dosBloques)} ≠ ${JSON.stringify(multinodo.esperado2)}`);
  comprobar(sesion.errores.length === 0, `${esc.nombre}: sin errores de JavaScript (${sesion.errores.length})`, sesion.errores.join(' | '));
  await sesion.contexto.close();

  /* Segunda lectura con perturbaciones: sesión nueva para partir de cero. */
  const sesion2 = await abrirLibro(esc.ancho, esc.alto, esc.paginasPdf);
  const turbada = await leerYMuestrear(sesion2, { ancho: esc.ancho, alto: esc.alto, perturbar });
  if (VERBOSO) console.log(JSON.stringify(turbada.serie.filter((_, i) => i % 5 === 0).map((m) => [Math.round(m.t), m.voz, m.actual, m.pagVoz, m.activo])));
  analizar(`${esc.nombre} · con cromo, resize y giro`, turbada.serie, turbada.texto, { marcas: turbada.marcas });
  await comprobarMarca(`${esc.nombre} · con cromo, resize y giro`, sesion2.p, turbada.serie, turbada.texto);
  comprobar(sesion2.errores.length === 0, `${esc.nombre} (perturbada): sin errores de JavaScript (${sesion2.errores.length})`, sesion2.errores.join(' | '));
  await sesion2.contexto.close();
}

/* ── La persona manda: pasar página a mano durante la lectura ──
 * Con la voz sonando, pasar página la reanuda en la página elegida. Volver una
 * página es PEDIR ir atrás: debe quedar exactamente una atrás (no dos, como
 * pasaba al arrancar la voz en el inicio de una oración que cruza el borde), la
 * voz debe sonar en ella, y desde ahí la voz vuelve a llevar la página. */
{
  console.log('\n── pasar página a mano mientras suena ──');
  const sesion = await abrirLibro(1440, 900, 7);
  const { p } = sesion;
  await p.evaluate(instalarMuestreador);
  await p.evaluate(() => document.querySelector('[data-tts-console="pdf"] [data-tts-action="toggle"]').click());
  await p.waitForFunction(() => window.__jgPaginas && window.__jgPaginas().actual >= 3, null, { timeout: 120000 }).catch(() => {});
  await p.waitForTimeout(500);
  const antes = await p.evaluate(() => window.__jgPaginas().actual);
  await p.evaluate(() => document.getElementById('btnPdfPagPrev').click());
  await p.waitForTimeout(1200);
  const trasClic = await p.evaluate(() => ({ actual: window.__jgPaginas().actual, voz: window.__serie[window.__serie.length - 1].pagVoz }));
  comprobar(trasClic.actual === antes - 1, `volver una página a mano deja exactamente una atrás (${antes} → ${trasClic.actual})`);
  comprobar(trasClic.voz === trasClic.actual, `la voz se reanuda en la página elegida (voz en ${trasClic.voz}, vista en ${trasClic.actual})`);
  await p.evaluate(() => document.getElementById('btnPdfPagNext').click());
  await p.waitForTimeout(1200);
  const trasSiguiente = await p.evaluate(() => ({ actual: window.__jgPaginas().actual, voz: window.__serie[window.__serie.length - 1].pagVoz }));
  comprobar(trasSiguiente.actual === trasClic.actual + 1 && trasSiguiente.voz === trasSiguiente.actual, `pasar a la siguiente: vista y voz en ${trasSiguiente.actual}`);
  await p.waitForFunction((a) => window.__jgPaginas().actual >= a + 2, trasSiguiente.actual, { timeout: 60000 }).catch(() => {});
  await p.waitForTimeout(700);
  const alFinal = await p.evaluate(() => ({ actual: window.__jgPaginas().actual, voz: window.__serie[window.__serie.length - 1].pagVoz }));
  comprobar(alFinal.actual === alFinal.voz && alFinal.actual >= trasSiguiente.actual + 2, `después la voz sigue llevando la página (${alFinal.actual} = ${alFinal.voz})`);
  await p.locator('[data-tts-console="pdf"] [data-tts-action="stop"]').click({ timeout: 2000 }).catch(() => {});
  comprobar(sesion.errores.length === 0, 'pasar página a mano: sin errores de JavaScript', sesion.errores.join(' | '));
  await sesion.contexto.close();
}

await navegador.close();
servidor.close();
console.log(fallos.length === 0
  ? `\n✔ voz y página a la par · ${comprobaciones} comprobaciones, 0 fallos`
  : `\n❌ ${fallos.length} fallos de ${comprobaciones} comprobaciones`);
process.exit(fallos.length === 0 ? 0 : 1);
