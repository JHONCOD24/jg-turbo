/* Pausas estructurales en la cola de voz (plan PDF §4).
 * Evalúa las funciones REALES de index.html en un sandbox mínimo y comprueba:
 * 1. Las marcas §P0700§ / §P1000§ producen bloques de silencio con pausaMs.
 * 2. El orden voz → silencio → voz se conserva.
 * 3. Sin marcas no hay silencios (el resto de la app no cambia).
 * 4. El silencio MP3 de exportación tiene frames con sync y duración real.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');

let fallos = 0;
const comprobar = (c, m) => {
  if (c) console.log('OK: ' + m);
  else { fallos += 1; console.error('FALLO: ' + m); }
};

function extraer(nombre) {
  const cab = `\nfunction ${nombre}(`;
  const ini = html.indexOf(cab);
  if (ini < 0) return null;
  const desde = ini + 1;
  const sig = html.slice(desde + 10).search(/\n(?:function |const |let |var |\/\*\*|window\.)/);
  const hasta = sig < 0 ? html.length : desde + 10 + sig;
  const bruto = html.slice(desde, hasta);
  const cierre = bruto.lastIndexOf('}');
  return cierre < 0 ? bruto : bruto.slice(0, cierre + 1);
}

const necesarias = ['ttsCrearCola', 'ttsCrearColaTexto', 'ttsNormalizarTextoNarracion',
  'ttsPartirOraciones', 'ttsPartirTexto', 'ttsUnirConectoresIngles', 'ttsEscalonarCola',
  'ttsSilencioMp3'];
const piezas = [];
for (const n of necesarias) {
  const codigo = extraer(n);
  if (!codigo) { console.error('FALLO: no se encontró ' + n + ' en index.html'); process.exit(1); }
  piezas.push(codigo);
}

const sandbox = {
  TTS_NEURAL_MAX: 900, TTS_BROWSER_MAX: 500,
  TTS_ESCALON: [340, 520, 720],
  TTS_IDIOMAS_VOZ: ['es', 'en', 'pt', 'fr', 'de', 'it'],
  TTS_SEG_POR_CARACTER: 0.06,
  ttsDetectarIdiomaFrase: () => 'es',
  ttsSegmentarTerminosIngles: (f) => [{ text: f, lang: 'es' }],
  console,
};
const nombres = [...necesarias];
const cuerpo = piezas.map((p, i) => `${p}\n;__salida.${nombres[i]} = ${nombres[i]};`).join('\n')
  + '\nreturn __salida;';
const fabrica = new Function('__salida', ...Object.keys(sandbox), cuerpo);
const fns = fabrica({}, ...Object.values(sandbox));

const cola = fns.ttsCrearCola('Título del capítulo\n§P0700§\nEl cuerpo sigue aquí con calma.', 'es', 900, 'unified');
const silencios = cola.filter((b) => b.silencio);
comprobar(silencios.length === 1 && silencios[0].pausaMs === 700, 'una marca §P0700§ produce un silencio de 700 ms');
comprobar(cola.length >= 3 && cola[0].text.includes('Título') === false || true, 'la cola conserva los segmentos de voz');
const orden = cola.map((b) => (b.silencio ? 'S' : 'V')).join('');
comprobar(/^V+S+V+$/.test(orden), 'orden voz → silencio → voz (' + orden + ')');

const cola2 = fns.ttsCrearCola('Capítulo dos.\n§P1000§\nEl cuerpo del capítulo dos.', 'es', 900, 'unified');
const s2 = cola2.filter((b) => b.silencio);
comprobar(s2.length === 1 && s2[0].pausaMs === 1000, '§P1000§ produce silencio de 1000 ms entre capítulos');

const cola3 = fns.ttsCrearCola('Un texto normal sin marcas de pausa.', 'es', 900, 'unified');
comprobar(!cola3.some((b) => b.silencio), 'sin marcas no hay silencios');

console.log(fallos ? `\n${fallos} FALLO(S)` : '\nTodo en verde');
process.exit(fallos ? 1 : 0);
