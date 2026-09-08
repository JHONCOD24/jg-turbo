/* Regresión: la guía sigue a la voz sin arrastrarse (tablet/escritorio).
 *   node tests/verificar_pdf_guia_tiempo.mjs
 *
 * El servidor finge /api/tts con WAV silencioso de duración EXACTA y
 * proporcional al texto (ritmo constante conocido). El motor TTS, el relevo
 * entre audios, las anclas y la guía corren de verdad; solo la voz es
 * sintética. Se exige: anclas exactas y retraso máximo de un tramo (~95).
 * Caza el fallo de anclas en repeticiones (la guía avanzaba al ~30% y la
 * página saltaba tarde).
 */
import { createServer } from 'node:http';
import { readFile, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, extname, resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { crearLibro } from './generarPdfPrueba.mjs';

const AQUI = dirname(fileURLToPath(import.meta.url));
const APP = resolve(AQUI, '..');
const R = 80; // caracteres por segundo: ritmo constante conocido
const TRAMO = 95; // tamaño de la ventana de la guía

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
const servidor = createServer(async (peticion, respuesta) => {
  try {
    const url = new URL(peticion.url, 'http://127.0.0.1:8000');
    if (url.pathname === '/api/tts-voices' || url.pathname === '/tts-voices') {
      respuesta.writeHead(503).end('x'); return;
    }
    if (url.pathname === '/api/tts' || url.pathname === '/tts') {
      const leer = () => new Promise((res) => {
        if (peticion.method === 'GET') return res(url.searchParams.get('text') || '');
        let c = '';
        peticion.on('data', (t) => { c += t; });
        peticion.on('end', () => { try { res(JSON.parse(c).text || ''); } catch { res(''); } });
      });
      const texto = await leer();
      respuesta.writeHead(200, { 'Content-Type': 'audio/wav' });
      respuesta.end(wavSegundos(Math.max(0.5, String(texto).length / R)));
      return;
    }
    if (url.pathname.startsWith('/api/')) { respuesta.writeHead(503).end('x'); return; }
    const TIPOS = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.pdf': 'application/pdf' };
    const rel = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname).replace(/^\/+/, '');
    const datos = await readFile(join(APP, rel));
    respuesta.writeHead(200, { 'Content-Type': TIPOS[extname(rel)] || 'application/octet-stream' });
    respuesta.end(datos);
  } catch { respuesta.writeHead(404).end('x'); }
});
await new Promise((l) => servidor.listen(0, '127.0.0.1', l));
const BASE = `http://127.0.0.1:${servidor.address().port}/`;
const temporal = await mkdtemp(join(tmpdir(), 'jg-guia-t-'));
const LIBRO = join(temporal, 'libro.pdf');
crearLibro(LIBRO, 3);

const navegador = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
const contexto = await navegador.newContext({ viewport: { width: 1200, height: 800 } });
await contexto.addInitScript(() => {
  try { localStorage.setItem('jg_tts_rate', '1'); localStorage.setItem('jg_tts_engine', 'neural'); } catch (_) {}
});
const pagina = await contexto.newPage();
const errores = [];
pagina.on('pageerror', (e) => errores.push(String(e).slice(0, 200)));
await pagina.goto(BASE, { waitUntil: 'domcontentloaded' });
await pagina.waitForTimeout(600);
await pagina.locator('#tabPdf').click();
await pagina.locator('#pdfInput').setInputFiles(LIBRO);
await pagina.locator('#btnPdfRead').click();
await pagina.waitForFunction(() => {
  const res = document.getElementById('pdfResultArea');
  return res && res.style.display !== 'none';
}, null, { timeout: 90000 }).catch(() => {});
await pagina.waitForTimeout(1000);
await pagina.locator('[data-tts-console="pdf"] [data-tts-action="toggle"]').click();
await pagina.waitForFunction(() => {
  try { return window.ttsState && window.ttsState.status === 'playing'; } catch (_) { return false; }
}, null, { timeout: 60000 }).catch(() => console.log('AVISO: no llegó a playing'));

const muestras = [];
const t0 = Date.now();
while (Date.now() - t0 < 45000) {
  const m = await pagina.evaluate(() => {
    let guia = null;
    try { guia = window.jgGuiaDebug ? window.jgGuiaDebug() : null; } catch (_) { guia = null; }
    return { t: Date.now(), idx: window.ttsState ? window.ttsState.idx : -99, status: window.ttsState ? window.ttsState.status : '?', guia };
  });
  muestras.push(m);
  if (m.status === 'idle' && muestras.length > 5) break;
  await pagina.waitForTimeout(250);
}
const datos = await pagina.evaluate(() => {
  let cola = [];
  try { cola = window.ttsTextosDeCola ? window.ttsTextosDeCola() : []; } catch (_) { cola = []; }
  return { cola, capitulo: document.getElementById('pdfOutput')?.value || '' };
});
await pagina.locator('[data-tts-console="pdf"] [data-tts-action="stop"]').click().catch(() => {});
await navegador.close();
servidor.close();

/* Verdad: bloques contiguos (ante repeticiones vale la ocurrencia contigua). */
const { cola, capitulo } = datos;
const inicios = [];
let esperado = 0;
cola.forEach((t) => {
  const aguja = String(t).slice(0, 40);
  const cands = [];
  let p = -1;
  while (cands.length < 8) {
    p = capitulo.indexOf(aguja, p + 1);
    if (p === -1) break;
    cands.push(p);
  }
  let mejor = cands.length ? cands[0] : -1;
  for (const c of cands) if (Math.abs(c - esperado) < Math.abs(mejor - esperado)) mejor = c;
  inicios.push(mejor);
  if (mejor >= 0) esperado = mejor + String(t).length;
});
/* Duraciones servidas ≈ longitud/R (el falso TTS es exacto). */
const durs = cola.map((t) => Math.max(0.5, String(t).length / R));
const tIni = {};
muestras.forEach((s) => { for (let k = 0; k <= s.idx; k += 1) if (!(k in tIni)) tIni[k] = s.t; });
const acum = [0];
durs.forEach((d) => acum.push(acum[acum.length - 1] + d));
const inicioMuestras = muestras[0].t;
function verdad(t) {
  const e = (t - inicioMuestras) / 1000;
  let k = 0;
  while (k < durs.length - 1 && e >= acum[k + 1]) k += 1;
  const f = Math.max(0, Math.min(1, (e - acum[k]) / durs[k]));
  return inicios[k] >= 0 ? Math.round(inicios[k] + f * cola[k].length) : -1;
}
const guiadas = muestras.filter((s) => s.guia && s.guia.desde >= 0);
comprobar(guiadas.length > 10, `la guía marcó durante la lectura (${guiadas.length} muestras)`);
const lags = guiadas.map((s) => verdad(s.t) - s.guia.hasta).filter((v) => Number.isFinite(v));
const mal = lags.filter((l) => l > TRAMO).length;
comprobar(mal <= Math.ceil(lags.length * 0.05), `retraso mayor a un tramo en pocas muestras (${mal}/${lags.length})`);
comprobar(Math.max(...lags) <= TRAMO * 2, `retraso máximo acotado (${Math.max(...lags)} caracteres)`);
const anclas = guiadas.length ? guiadas[guiadas.length - 1].guia.anclas : [];
const compacta = (s) => {
  const out = [];
  for (const ch of String(s)) {
    const l = ch.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().charAt(0);
    if ((l >= 'a' && l <= 'z') || (l >= '0' && l <= '9')) out.push(l);
  }
  return out.join('');
};
const aComp = (ch) => {
  let c = 0;
  for (let i = 0; i < ch && i < capitulo.length; i += 1) {
    const l = capitulo[i].normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().charAt(0);
    if ((l >= 'a' && l <= 'z') || (l >= '0' && l <= '9')) c += 1;
  }
  return c;
};
const capC = compacta(capitulo);
const fallosAncla = inicios.map((ini, k) => (ini < 0 ? false : Math.abs((anclas[k] ?? -9999) - aComp(ini)) > 60)).filter(Boolean).length;
comprobar(fallosAncla === 0, `anclas sobre el texto real (${anclas.length} bloques)`);
comprobar(errores.length === 0, `sin errores de JavaScript (${errores.length})${errores.length ? ' → ' + errores.slice(0, 3).join(' | ') : ''}`);
console.log(fallos === 0 ? '✔ guía a la par de la voz' : `❌ ${fallos} fallos`);
process.exit(fallos === 0 ? 0 : 1);
