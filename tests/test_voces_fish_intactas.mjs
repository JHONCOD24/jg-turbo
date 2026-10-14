/* JG Turbo · Las voces de Fish Audio predefinidas no cambian.
 *   node tests/test_voces_fish_intactas.mjs
 *
 * Pedido del dueño (2026-10-13, lector estilo Kindle): la configuración del
 * lector puede adaptar todo MENOS el catálogo de voces de Fish, que queda
 * estrictamente igual; solo se elige entre esas voces fijas.
 *
 * Se congela la huella SHA-256 de los cinco bloques que definen el catálogo
 * (cliente y servidor). Si esta prueba falla, alguien cambió una voz: eso
 * exige pedido expreso del dueño y actualizar aquí la huella a propósito,
 * nunca «para que pase».
 *
 * Además comprueba que la hoja «Aa» solo FILTRA lo que da el catálogo
 * (`data-tts-voice-solo-fish`) y que los temas nuevos se leen bien.
 */
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';

const raiz = resolve(import.meta.dirname, '..');
const html = readFileSync(resolve(raiz, 'index.html'), 'utf8');
const py = readFileSync(resolve(raiz, 'api', 'index.py'), 'utf8');

let ok = 0;
let fallos = 0;
function comprobar(condicion, mensaje, detalle = '') {
  if (condicion) { ok += 1; console.log(`OK: ${mensaje}`); } else {
    fallos += 1;
    console.error(`FALLO: ${mensaje}${detalle ? ` — ${detalle}` : ''}`);
  }
}
function tramo(texto, inicio, fin) {
  const i = texto.indexOf(inicio);
  if (i < 0) return '';
  const j = texto.indexOf(fin, i);
  return j < 0 ? '' : texto.slice(i, j + fin.length);
}
const sha = (t) => createHash('sha256').update(t).digest('hex');

/* Huellas tomadas del commit e4ce5af (v171), antes del lector estilo Kindle. */
const CONGELADAS = {
  'index.html · TTS_FISH_CATALOGO_LOCAL': [tramo(html, 'const TTS_FISH_CATALOGO_LOCAL', '];'), '461c134790e14b4bf8d8f7d73c74d196fc49862201eb99aefbaa5c035344ceb7'],
  'index.html · TTS_FISH_RETIRADAS': [tramo(html, 'const TTS_FISH_RETIRADAS', ']);'), '0819a324815cff7eabb867bd3e6a711e48fad79de4fefa51161fbf137035a9e4'],
  'index.html · TTS_FISH_EQUIVALENTES': [tramo(html, 'const TTS_FISH_EQUIVALENTES', '};'), '9bae61f71d9c197183ea7a4eea16b082fa0e17ef6432ae294626d9ecbd4dc68f'],
  'api/index.py · FISH_CATALOGO_BASE': [tramo(py, 'FISH_CATALOGO_BASE = (', '\n)'), 'bd4eb060ef7ce185af24159e309818552be78e54939611eb01ae8755fcc12317'],
  'api/index.py · FISH_VOCES_RETIRADAS': [tramo(py, 'FISH_VOCES_RETIRADAS = {', '\n}'), '52f3debb99c971f21a7bf943efb0223755d41b17ef1c58c4bdf7fea09501aa47'],
};
for (const [nombre, [bloque, huella]] of Object.entries(CONGELADAS)) {
  comprobar(bloque.length > 0, `${nombre}: el bloque existe`);
  comprobar(sha(bloque.replace(/\r\n/g, '\n')) === huella, `${nombre}: idéntico al catálogo fijo`, sha(bloque).slice(0, 12));
}

const ids = [...CONGELADAS['index.html · TTS_FISH_CATALOGO_LOCAL'][0].matchAll(/id:'([^']+)'/g)].map((m) => m[1]);
comprobar(ids.length === 18 && new Set(ids).size === 18, 'el catálogo local tiene 18 voces distintas', String(ids.length));
for (const id of ['roberto', 'amy', 'dora', 'michael', 'jg-narradora', 'jg-narrador']) {
  comprobar(ids.includes(id), `sigue la voz «${id}»`);
}

/* La hoja «Aa» usa el mismo llenado que los demás selectores y solo filtra. */
const hoja = tramo(html, 'id="pdfAparienciaHoja"', 'id="pdfMusicaHoja"');
comprobar(/<select[^>]*id="pdfAparVoz"[^>]*data-tts-voice-select[^>]*data-tts-voice-solo-fish/.test(hoja), 'la hoja «Aa» tiene su selector de voz conectado al catálogo y marcado «solo Fish»');
const rellenar = tramo(html, 'function ttsRellenarLocales(){', '\nfunction ttsBindUI');
comprobar(rellenar.includes("hasAttribute('data-tts-voice-solo-fish')") && /catalogo\.filter\(/.test(rellenar), 'el llenado filtra el catálogo (no lo copia ni lo amplía)');
comprobar(!/TTS_FISH_CATALOGO_LOCAL\s*\.\s*(push|splice|unshift|pop|shift)\(/.test(html) && !/TTS_FISH_CATALOGO_LOCAL\s*=(?!\s*\[)/.test(html.replace('const TTS_FISH_CATALOGO_LOCAL = [', '')), 'nadie añade, quita ni reasigna voces del catálogo en tiempo de ejecución');
const cambiar = tramo(html, "const vozSel = e.target.closest('[data-tts-voice-select]');", '}');
comprobar(cambiar.includes('ttsCambiarVozEnVivo'), 'elegir en «Aa» pasa por el mismo cambio de voz que el reproductor');

/* Contraste de los colores de página nuevos (WCAG: ≥ 4,5 para texto normal). */
function luminancia(hex) {
  const n = hex.replace('#', '');
  const c = n.length === 3 ? n.split('').map((x) => x + x) : n.match(/../g);
  const [r, g, b] = c.map((x) => parseInt(x, 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
const contraste = (a, b) => { const [x, y] = [luminancia(a), luminancia(b)].sort((m, n) => n - m); return (x + 0.05) / (y + 0.05); };
for (const tema of ['verde', 'negro']) {
  const regla = html.match(new RegExp(`#pdfResultArea\\[data-tema="${tema}"\\]\\{([^}]+)\\}`));
  comprobar(!!regla, `tema ${tema}: existe su paleta`);
  if (!regla) continue;
  const v = (nombre) => (regla[1].match(new RegExp(`--${nombre}:(#[0-9A-Fa-f]{3,6})`)) || [])[1];
  const fondo = v('lec-bg');
  const texto = v('lec-texto');
  const suave = v('lec-suave');
  const acento = v('lec-acento');
  comprobar(contraste(texto, fondo) >= 7, `tema ${tema}: texto principal ≥ 7:1`, contraste(texto, fondo).toFixed(2));
  comprobar(contraste(suave, fondo) >= 4.5, `tema ${tema}: texto suave ≥ 4,5:1`, contraste(suave, fondo).toFixed(2));
  comprobar(contraste(acento, fondo) >= 3, `tema ${tema}: acento ≥ 3:1 (bordes y marcas)`, contraste(acento, fondo).toFixed(2));
}

console.log(fallos === 0 ? `\n✔ voces Fish intactas · ${ok} comprobaciones, 0 fallos` : `\n❌ ${fallos} fallos de ${ok + fallos} comprobaciones`);
process.exit(fallos === 0 ? 0 : 1);
