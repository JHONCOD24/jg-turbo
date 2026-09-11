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

/* ── `#` de conteo en el camino que SÍ usa Escuchar ──────────────────
 * v2.70.0 dejó expandirNumeral solo en prepararParaVoz, que el audiolibro
 * llama y el botón Escuchar no. Esta función SÍ está en ttsCrearCola. */
{
  const s1 = narrar('Secreto #1: ¿Qué es el copywriting?');
  comprobar(s1.includes('número 1') && !s1.includes('#'),
    '«Secreto #1» suena «número 1» en ttsNormalizarTextoNarracion');
  comprobar(!/hashtag/i.test(s1), 'y no deja la palabra hashtag');
  comprobar(narrar('Secreto #10: Lo que de VERDAD vende').includes('número 10'),
    '«Secreto #10» suena «número 10»');
  comprobar(narrar('Nivel (LF#8) y zona LF8 #2').includes('número 8')
    && narrar('Nivel (LF#8) y zona LF8 #2').includes('número 2'),
    '«LF#8» y «LF8 #2» también son conteo');
  comprobar(narrar('The #1 brand in vended water').includes('número 1'),
    'sin idioma, `#1` de marca también es conteo (español por defecto)');
  comprobar(narrar('Principle #1: The Fear Factor', 'en').includes('number 1')
    && !narrar('Principle #1: The Fear Factor', 'en').includes('#'),
    'en inglés suena «number 1»');
  const url = narrar('Consulta https://www.ejemplo.com/page4#reference4.2 para más');
  comprobar(url.includes('https') && url.includes('#reference'),
    'el «#» de una URL no se vuelve conteo');
  comprobar(!narrar('# Título grande').includes('número'),
    'un encabezado Markdown `# Título` no se convierte en «número Título»');
  comprobar(!narrar('# Título grande').includes('#'),
    'y sigue sin dejar la almohadilla del encabezado');
}

/* ── El gancho tiene que estar en el botón que la gente pulsa ─────────
 * Una función auxiliar en vozTexto.js no basta: Escuchar, Desde aquí y
 * el MP3 tienen que llamarla. Si este bloque falla, el usuario vuelve a
 * oír «hashtag» con las unitarias en verde. */
{
  comprobar(html.includes('function ttsAplicarCapaVozPdf('),
    'existe ttsAplicarCapaVozPdf, el gancho de la capa PDF');
  const hablar = extraer('ttsHablar', 'function') || '';
  comprobar(hablar.includes('ttsAplicarCapaVozPdf'),
    'ttsHablar (Escuchar / Desde aquí) aplica la capa PDF');
  comprobar(/function ttsDescargarAudio[\s\S]{0,600}ttsAplicarCapaVozPdf/.test(html),
    'la descarga MP3 también aplica la capa PDF');
  const cola = extraer('ttsCrearColaTexto', 'function') || extraer('ttsCrearCola', 'function') || '';
  comprobar(/ttsNormalizarTextoNarracion\(\s*texto\s*,\s*langHint\s*\)/.test(cola),
    'ttsCrearCola pasa el idioma a ttsNormalizarTextoNarracion');
  /* Pausas estructurales del plan PDF §4: marcas §P0700§/§P1000§ → silencio. */
  const orquesta = extraer('ttsCrearCola', 'function') || '';
  comprobar(/§P\(\\d\{3,5\}\)§/.test(orquesta) && /silencio:\s*true/.test(orquesta),
    'ttsCrearCola convierte las marcas de pausa en bloques de silencio');
  comprobar(/function ttsSilencioMp3/.test(html),
    'existe el generador de silencio MP3 para la exportación');
  const relevo = extraer('ttsBloqueTerminado', 'function') || '';
  comprobar(/silencio/.test(relevo) && /pausaMs/.test(relevo),
    'el relevo entre bloques respeta el silencio estructural');
  const pdfCtrl = fs.readFileSync(path.join(__dirname, '../js/pdf/pdfController.js'), 'utf8');
  comprobar(pdfCtrl.includes('window.jgPrepararParaVoz'),
    'el lector de PDF expone window.jgPrepararParaVoz');
}

/* ── Secretos de Copywriting (2026-09-10): el chatter no se escucha ──
 * Aunque la capa PDF falle o tarde en cargar, Escuchar pasa por
 * ttsNormalizarTextoNarracion: el filtro vive en los dos caminos. */
{
  const frase = 'no hay texto para traducir, por favor proporciona el bloque de texto que necesitas convertir al español siguiendo las instrucciones dadas';
  const sale = narrar(`Hola mundo. ${frase} Siguiente párrafo.`);
  comprobar(!sale.toLowerCase().includes('no hay texto') && !sale.toLowerCase().includes('bloque de texto'),
    'ttsNormalizarTextoNarracion quita el chatter de traducción');
  comprobar(sale.includes('Hola mundo') && sale.includes('Siguiente'),
    'y conserva el texto real de alrededor');
}

console.log(fallos ? `\n${fallos} FALLO(S)` : '\nTodo en verde');
process.exit(fallos ? 1 : 0);
