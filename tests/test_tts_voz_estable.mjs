/* Voz Fish estable en el PDF: ningún bloque cambia de timbre en silencio.
 * Causa medida (2026-09-14): si Fish tropezaba en UN bloque, el servidor lo
 * mandaba a Edge y sonaba con otra voz por segundos; el prefetch además
 * calentaba en modo 'regional' mientras el PDF lee en 'unified'.
 * Ejecutar: node tests/test_tts_voz_estable.mjs
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
const controlador = fs.readFileSync(path.join(__dirname, '../js/pdf/pdfController.js'), 'utf8');
const sw = fs.readFileSync(path.join(__dirname, '../sw.js'), 'utf8');

let fallos = 0;
function comprobar(condicion, mensaje) {
  if (condicion) console.log(`OK: ${mensaje}`);
  else { fallos += 1; console.error(`FALLO: ${mensaje}`); }
}

/* El bloque que llegó con otra voz se reintenta, no se acepta en silencio. */
comprobar(html.includes('reintenta el MISMO bloque') && html.includes('intento < 2'),
  'la cola reintenta el bloque que cambió de voz');
comprobar(html.includes('queriaFish') && html.includes('sonoFish'),
  'se compara la voz pedida (Fish) con la que de verdad sonó');
comprobar(html.includes('_avisoRespaldo'), 'si el respaldo suena, se avisa una vez en vez de callar');
comprobar(html.includes('ttsHablar') && html.includes('ttsState._avisoRespaldo = false'),
  'cada lectura nueva reinicia el aviso de respaldo');
comprobar(html.includes("resp.headers.get('X-TTS-Model')"),
  'el cliente lee el modelo Fish que sonó (pagado o gratuito)');

/* El prefetch calienta lo mismo que se va a oír. */
comprobar(!controlador.includes("prefs.bilingualMode || 'regional'"),
  'el prefetch ya no calienta en modo regional');
comprobar((controlador.match(/ttsCrearCola\(primerChunk, langPrefetch, 500, 'unified'\)/g) || []).length === 2,
  'los dos prefetch del PDF calientan en unified, como la lectura');

/* Sin regresiones de la corrección anterior. */
comprobar(html.includes('el.preservesPitch = true'),
  'la velocidad sigue conservando el tono (no hay voz aguda)');
comprobar(!/sourceId === 'pdf'[\s\S]{0,180}preferFish:\s*false/.test(html),
  'el PDF sigue sin apagar Fish');

/* Versión y caché suben juntas. */
{
  const js = (html.match(/const JG_JS_V = '(v\d+)'/) || [])[1];
  const shell = (sw.match(/CACHE_SHELL = '(jg-turbo-shell-v\d+)'/) || [])[1];
  comprobar(js === 'v141' && shell === 'jg-turbo-shell-v141',
    'JG_JS_V y CACHE_SHELL suben juntas a v141');
}

console.log(fallos ? `\n${fallos} FALLO(S)` : '\nTodo en verde');
process.exit(fallos ? 1 : 0);
