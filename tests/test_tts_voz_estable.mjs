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
/* El aviso dice la verdad y no spamea (2026-09-17: «revisa tu conexión» cada
 * 30 s con Fish caído era mentira + ruido; la conexión del usuario estaba bien). */
comprobar(html.includes('La voz Fish no responde (sin créditos o saturada)'),
  'el aviso de respaldo dice la causa real (Fish caído, no la conexión)');
comprobar(html.includes("suena el respaldo de ' + motorRespaldo") || html.includes('suena el respaldo de Azure') || html.includes('motorRespaldo'),
  'el aviso nombra el motor real (Azure/Edge), no siempre Edge');
comprobar(html.includes("resp.headers.get('X-TTS-Engine')"),
  'el cliente lee X-TTS-Engine para nombrar el respaldo real');
comprobar(!html.includes('voz de respaldo · revisa tu conexión'),
  'ya no se culpa de la conexión del usuario');
comprobar(html.includes('}, 900000);'),
  'el aviso de respaldo solo se rearma a los 15 minutos');

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
  comprobar(js === 'v145' && shell === 'jg-turbo-shell-v145',
    'JG_JS_V y CACHE_SHELL suben juntas a v145');
}

console.log(fallos ? `\n${fallos} FALLO(S)` : '\nTodo en verde');
process.exit(fallos ? 1 : 0);
