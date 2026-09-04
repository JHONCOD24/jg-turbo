/* Pruebas de la biblioteca de voces: las retiradas no se ofrecen en ningún
 * listado (aunque el servidor las mande) y las guardadas se redirigen a las
 * equivalentes que quedan.
 * Las funciones viven dentro de index.html, así que se extraen y se ejecutan
 * de verdad (mismo patrón que test_tts_narracion.mjs).
 * Ejecutar: node tests/test_tts_voces_biblioteca.mjs
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

function extraer(nombre, palabra) {
  const cabecera = palabra === 'function' ? `\nfunction ${nombre}(` : `\n${palabra} ${nombre} `;
  const inicio = html.indexOf(cabecera);
  if (inicio < 0) return null;
  const desde = inicio + 1;
  const siguiente = html.slice(desde + 10).search(/\n(?:function |const |let |var |\/\*\*|window\.)/);
  const hasta = siguiente < 0 ? html.length : desde + 10 + siguiente;
  const bruto = html.slice(desde, hasta);
  const fin = palabra === 'function' ? '}' : ';';
  const cierre = bruto.lastIndexOf(fin);
  return cierre < 0 ? bruto : bruto.slice(0, cierre + 1);
}

const piezas = [
  ['TTS_NEURAL_ACCENTS', 'const'], ['TTS_FISH_CATALOGO_LOCAL', 'const'],
  ['TTS_FISH_RETIRADAS', 'const'], ['TTS_FISH_EQUIVALENTES', 'const'],
  ['ttsFishInfo', 'let'],
  ['ttsFishLista', 'function'], ['ttsFishIdioma', 'function'], ['ttsFishPorId', 'function'],
];
const fuente = [];
for (const [nombre, palabra] of piezas) {
  const trozo = extraer(nombre, palabra);
  if (!trozo) {
    console.error(`FALLO: no se pudo extraer ${nombre} de index.html`);
    fallos += 1;
  } else {
    fuente.push(trozo);
  }
}
if (fallos) { console.error('\nNo se pudo preparar la prueba.'); process.exit(1); }

let api;
try {
  // eslint-disable-next-line no-new-func
  const construir = new Function(`${fuente.join('\n')}
    return { TTS_NEURAL_ACCENTS, TTS_FISH_CATALOGO_LOCAL, TTS_FISH_RETIRADAS, ttsFishInfo, ttsFishLista, ttsFishPorId };`);
  api = construir();
} catch (error) {
  console.error(`FALLO: no se pudieron evaluar las funciones — ${error.message}`);
  process.exit(1);
}

/* ── Acentos regionales fuera ─────────────────────────────────────── */
{
  comprobar(Array.isArray(api.TTS_NEURAL_ACCENTS) && api.TTS_NEURAL_ACCENTS.length === 0,
    'la lista de acentos regionales queda vacía');
}

/* ── Fish retiradas fuera del catálogo local ──────────────────────── */
{
  const ids = api.TTS_FISH_CATALOGO_LOCAL.map((v) => v.id);
  for (const fuera of ['nico-robin', 'chica', 'nagi', 'locutor-k', 'narrador', 'loquendo', 'sarah', 'paula', 'adrian', 'ethan']) {
    comprobar(!ids.includes(fuera), `"${fuera}" ya no está en el catálogo`);
  }
  for (const queda of ['narradora', 'colombiana', 'latina', 'voz-a', 'valentino', 'sabio', 'terror', 'leonardo']) {
    comprobar(ids.includes(queda), `"${queda}" se conserva`);
  }
}

/* ── La lista ofrecida filtra aunque el servidor las mande ───────── */
{
  api.ttsFishInfo.list = [
    { id: 'nico-robin', gender: 'female', name: 'Nico Robin', lang: 'es' },
    { id: 'sarah', gender: 'female', name: 'Sarah', lang: 'en' },
    { id: 'narradora', gender: 'female', name: 'Narradora', lang: 'es' },
    { id: 'valentino', gender: 'male', name: 'Valentino', lang: 'es' },
  ];
  const ids = api.ttsFishLista().map((v) => v.id);
  comprobar(!ids.includes('nico-robin') && !ids.includes('sarah'),
    'las retiradas se filtran aunque vengan del servidor');
  comprobar(ids.includes('narradora') && ids.includes('valentino'),
    'las que quedan se siguen ofreciendo');
  api.ttsFishInfo.list = api.TTS_FISH_CATALOGO_LOCAL.slice();
}

/* ── Lo guardado se redirige, no se rompe ─────────────────────────── */
{
  comprobar(api.ttsFishPorId('nico-robin')?.id === 'narradora', 'nico-robin → narradora');
  comprobar(api.ttsFishPorId('female')?.id === 'narradora', 'fish:female histórico → narradora');
  comprobar(api.ttsFishPorId('locutor-k')?.id === 'valentino', 'locutor-k → valentino');
  comprobar(api.ttsFishPorId('male')?.id === 'valentino', 'fish:male histórico → valentino');
  comprobar(api.ttsFishPorId('narrador')?.id === 'valentino', 'narrador → valentino');
  comprobar(api.ttsFishPorId('sarah') === null, 'las inglesas no resuelven a nada');
  comprobar(api.ttsFishPorId('narradora')?.id === 'narradora', 'las que quedan resuelven igual');
  comprobar(api.ttsFishPorId('') === null && api.ttsFishPorId(null) === null, 'vacío no rompe');
}

console.log(fallos ? `\n${fallos} FALLO(S)` : '\nTodo en verde');
process.exit(fallos ? 1 : 0);
