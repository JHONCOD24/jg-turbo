/* Pruebas de la capa de voz COMÚN a todos los modos (micrófono, archivo,
 * YouTube y el PDF cuando pasa por el motor).
 *
 * Estas funciones viven dentro de index.html, así que la prueba las extrae del
 * archivo y las ejecuta de verdad: comprobar que el texto «está presente» con
 * un `includes` no dice nada sobre si la regla funciona.
 *
 * Ejecutar: node tests/test_tts_narracion.mjs
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');

let fallos = 0;
function comprobar(condicion, mensaje) {
  if (condicion) console.log(`OK: ${mensaje}`);
  else { fallos += 1; console.error(`FALLO: ${mensaje}`); }
}

/**
 * Saca del HTML una declaración completa.
 *
 * Contar llaves no sirve: estas funciones están llenas de expresiones
 * regulares («/^[A-Z]{2,6}$/») cuyas llaves y corchetes descuadran cualquier
 * contador. Como todas estas declaraciones están al principio de línea, se
 * corta en la siguiente declaración de nivel superior y se recorta hasta su
 * último cierre. Es sencillo y no se confunde con el contenido.
 */
function extraer(nombre, tipo) {
  const cabecera = tipo === 'function' ? `\nfunction ${nombre}(` : `\nconst ${nombre} `;
  const inicio = html.indexOf(cabecera);
  if (inicio < 0) return null;
  const desde = inicio + 1;

  /* Siguiente declaración de nivel superior tras esta. */
  const siguiente = html.slice(desde + 10).search(/\n(?:function |const |let |var |\/\*\*|window\.)/);
  const hasta = siguiente < 0 ? html.length : desde + 10 + siguiente;
  const bruto = html.slice(desde, hasta);

  const cierre = tipo === 'function' ? bruto.lastIndexOf('}') : bruto.lastIndexOf(';');
  return cierre < 0 ? bruto : bruto.slice(0, cierre + 1);
}

const piezas = [
  ['TTS_ES_WORDS', 'const'], ['TTS_EN_WORDS', 'const'], ['TTS_ES_SAFE', 'const'],
  ['TTS_ES_ACRONYMS', 'const'], ['TTS_ENGLISH_TERMS', 'const'],
  ['ttsLimpiarToken', 'function'], ['ttsPareceTokenIngles', 'function'],
  ['ttsNormalizarTextoNarracion', 'function'],
];

const fuente = [];
for (const [nombre, tipo] of piezas) {
  const trozo = extraer(nombre, tipo);
  if (!trozo) {
    console.error(`FALLO: no se pudo extraer ${nombre} de index.html`);
    fallos += 1;
  } else {
    fuente.push(trozo);
  }
}
if (fallos) { console.error('\nNo se pudo preparar la prueba.'); process.exit(1); }

let narrar; let pareceIngles; let acronimos;
try {
  // eslint-disable-next-line no-new-func
  const construir = new Function(`${fuente.join('\n')}
    return { ttsNormalizarTextoNarracion, ttsPareceTokenIngles, TTS_ES_ACRONYMS };`);
  const api = construir();
  narrar = api.ttsNormalizarTextoNarracion;
  pareceIngles = api.ttsPareceTokenIngles;
  acronimos = api.TTS_ES_ACRONYMS;
} catch (error) {
  console.error(`FALLO: no se pudieron evaluar las funciones — ${error.message}`);
  process.exit(1);
}

/* ── Lo que ya hacía debe seguir haciéndolo ────────────────────────── */
{
  comprobar(narrar('Ver **negrita** aquí').includes('negrita'), 'quita los asteriscos de Markdown');
  comprobar(!narrar('# Título grande').includes('#'), 'quita la almohadilla del encabezado');
  comprobar(narrar('Un [enlace](https://x.com) aquí').includes('enlace'),
    'de un enlace Markdown conserva el texto');
  comprobar(!narrar('Un [enlace](https://x.com) aquí').includes('https'),
    'y descarta la dirección');
  comprobar(narrar('') === '', 'texto vacío no rompe');
  comprobar(narrar(null) === '', 'null no rompe');
  comprobar(!narrar('Frase.\n\nOtra frase').includes('..'), 'no genera el doble punto');
}

/* ── Referencias de nota: no se leen ───────────────────────────────── */
{
  const sale = narrar('La teoría se impuso [12] y nadie la discutió.');
  comprobar(!sale.includes('12'), 'una referencia [12] no llega a la voz');
  comprobar(sale.includes('se impuso') && sale.includes('y nadie'), 'el texto de alrededor queda entero');
  comprobar(!/\s{2,}/.test(sale), 'no deja un hueco doble');

  comprobar(!narrar('Coinciden varios autores [3, 4].').includes('3'),
    'una lista de referencias no llega a la voz');
  comprobar(!narrar('Según el autor [ii] fue distinto.').includes('ii'),
    'una referencia romana no llega a la voz');
}
{
  /* Una acotación con palabras es contenido: se conserva. */
  comprobar(narrar('Dijo que [el rey] llegó.').includes('el rey'), 'una acotación [el rey] se conserva');
  comprobar(narrar('Escribió «haiga» [sic] ahí.').includes('sic'), 'la acotación [sic] se conserva');
}

/* ── El cambio de voz a inglés ─────────────────────────────────────── */
{
  /* Lo que SÍ debe leerse con voz inglesa sigue igual. */
  comprobar(pareceIngles('debugging') === true, 'un gerundio inglés sigue detectándose');
  comprobar(pareceIngles('deployment') === true, 'una raíz técnica inglesa sigue detectándose');
  comprobar(pareceIngles('GPT4') === true, 'un nombre técnico como GPT4 sigue en inglés');
  comprobar(pareceIngles('H264') === true, 'un códec como H264 sigue en inglés');
  comprobar(pareceIngles('OpenAI') === true, 'una marca CamelCase sigue en inglés');
  comprobar(pareceIngles('API') === true, 'un acrónimo técnico sigue en inglés');

  /* Lo que NO debe cambiar de voz en un libro español. */
  comprobar(pareceIngles('estudio12') === false,
    'una palabra española con nota pegada NO cambia la voz a inglés');
  comprobar(pareceIngles('evolucion3') === false,
    'otra palabra con nota pegada tampoco');
  comprobar(pareceIngles('capitulo7') === false, 'ni «capitulo7»');
  comprobar(pareceIngles('casa') === false, 'una palabra española normal no es inglés');
}
{
  /* Siglas hispanas: se leían con acento inglés a media frase. */
  for (const sigla of ['ONU', 'OMS', 'OTAN', 'PIB', 'UNESCO', 'DANE', 'RAE', 'FMI']) {
    comprobar(acronimos.has(sigla), `«${sigla}» está en la lista de siglas españolas`);
    comprobar(pareceIngles(sigla) === false, `«${sigla}» se lee con voz española`);
  }
}

/* ── Casos límite ──────────────────────────────────────────────────── */
{
  comprobar(typeof narrar('[[[') === 'string', 'corchetes sin cerrar no rompen');
  comprobar(typeof narrar('[1] [2] [3]') === 'string', 'varias referencias seguidas no rompen');
  comprobar(pareceIngles('') === false, 'token vacío no rompe');
  comprobar(pareceIngles(null) === false, 'token nulo no rompe');
}

console.log(fallos ? `\n${fallos} FALLO(S)` : '\nTodo en verde');
process.exit(fallos ? 1 : 0);
