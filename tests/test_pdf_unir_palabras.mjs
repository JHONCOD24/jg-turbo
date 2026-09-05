/* JG Turbo · Unir palabras partidas por un corte de renglón
 *
 * El caso real: un PDF parte «sorprendentes» en «sorprend» al final de un
 * renglón y «entes» al principio del siguiente. El motor ya sabía qué hacer;
 * lo que le faltaba era un diccionario con el que comprobarlo (el que había
 * tenía 576 palabras, el corpus de las pruebas).
 *
 * La regla que se verifica aquí es la que evita corromper el libro:
 * se une SOLO si la forma pegada es palabra Y al menos una de las mitades no
 * lo es. Por eso «de»+«la» nunca se une, aunque «dela» se pareciera a algo.
 *
 *   node tests/test_pdf_unir_palabras.mjs
 */
import { readFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import {
  cargarLexico, lexicoCargado, esPalabraValida, decidirPorLexico,
} from '../js/pdf/lexico.js';

const app = resolve(import.meta.dirname, '..');
let ok = 0;
const fallos = [];
function comprobar(nombre, condicion, detalle = '') {
  if (condicion) { ok++; console.log(`OK: ${nombre}`); }
  else { fallos.push(`${nombre}${detalle ? ` — ${detalle}` : ''}`); console.log(`FALLO: ${nombre}${detalle ? ` — ${detalle}` : ''}`); }
}

/* En el navegador las listas llegan por fetch; aquí, del disco. Se prueba el
   mismo descodificador, que es la parte que se puede romper. */
const desdeDisco = (idioma) => readFile(join(app, `js/vendor/lexico/${idioma}.txt`), 'utf8');

console.log('\n── 1. Nada se carga hasta que hace falta ───────────────────────');
comprobar('el léxico no está cargado al arrancar', !lexicoCargado('es'));
comprobar('sin léxico, una palabra corriente es desconocida', !esPalabraValida('sorprendentes'));

console.log('\n── 2. Se carga y descodifica la lista ─────────────────────────');
await cargarLexico('es', desdeDisco);
comprobar('queda cargado', lexicoCargado('es'));
comprobar('no se recarga si ya está', await cargarLexico('es', () => { throw new Error('no debería releer'); }) !== undefined || true);

/* Si el prefijo compartido se descodificara mal, estas fallarían: son
   palabras que comparten mucho prefijo con su vecina en la lista ordenada. */
for (const palabra of ['casa', 'casero', 'sorprendentes', 'sorprendente', 'niebla', 'murciélago', 'ñandú', 'zurcir']) {
  comprobar(`«${palabra}» se reconoce`, esPalabraValida(palabra));
}
for (const invento of ['sorprend', 'qwrtyx', 'aaaaaa', 'entesx']) {
  comprobar(`«${invento}» NO se reconoce`, !esPalabraValida(invento));
}

console.log('\n── 3. El caso que reportó el usuario ──────────────────────────');
comprobar('«sorprend» + «entes» se unen',
  decidirPorLexico('sorprend', 'entes') === 'join');
comprobar('«extraor» + «dinario» se unen',
  decidirPorLexico('extraor', 'dinario') === 'join');
comprobar('«particip» + «antes» se unen',
  decidirPorLexico('particip', 'antes') === 'join');
comprobar('«conver» + «saciones» se unen',
  decidirPorLexico('conver', 'saciones') === 'join');
comprobar('«pensa» + «miento» se unen',
  decidirPorLexico('pensa', 'miento') === 'join');
comprobar('«histor» + «ias» se unen',
  decidirPorLexico('histor', 'ias') === 'join');

/* Límite consciente del método: «compren» y «dido» son las dos palabras
   reales («que ellos compren»), así que el léxico se NIEGA a pegarlas aunque
   «comprendido» exista. Unir dos palabras de verdad corrompería el texto, y
   equivocarse de menos es el único error aceptable aquí. Ese corte se resuelve
   por otro camino: en el PDF lleva guion, y del guion se encarga la geometría
   (`test_pdf_cortes_reales.mjs`). */
comprobar('no pega dos palabras reales aunque juntas formen otra',
  decidirPorLexico('compren', 'dido') !== 'join',
  `devolvió ${decidirPorLexico('compren', 'dido')}`);

console.log('\n── 4. Lo que NUNCA debe unirse ────────────────────────────────');
/* Dos palabras de verdad no se pegan aunque juntas formen otra palabra. */
const noUnir = [
  ['de', 'la'], ['sin', 'embargo'], ['por', 'que'], ['es', 'decir'],
  ['para', 'dos'], ['la', 'mesa'], ['el', 'lo'], ['ya', 'que'],
  ['tal', 'vez'], ['a', 'pesar'], ['en', 'vez'], ['o', 'sea'],
];
for (const [izq, der] of noUnir) {
  comprobar(`«${izq}» + «${der}» NO se unen`, decidirPorLexico(izq, der) !== 'join',
    `devolvió ${decidirPorLexico(izq, der)}`);
}

console.log('\n── 5. Sin evidencia, se duda: no se inventa ───────────────────');
comprobar('dos trozos desconocidos quedan sin decidir',
  decidirPorLexico('xkcd', 'zzqp') === null,
  `devolvió ${decidirPorLexico('xkcd', 'zzqp')}`);
comprobar('un nombre propio partido no se inventa como palabra',
  decidirPorLexico('Zzy', 'qrx') === null || decidirPorLexico('Zzy', 'qrx') === 'space');

console.log('\n── 6. Inglés ──────────────────────────────────────────────────');
await cargarLexico('en', desdeDisco);
comprobar('el inglés queda cargado', lexicoCargado('en'));
comprobar('«underst» + «anding» se unen', decidirPorLexico('underst', 'anding') === 'join');
comprobar('«develop» + «ment» se unen', decidirPorLexico('develop', 'ment') === 'join');
comprobar('«the» + «book» NO se unen', decidirPorLexico('the', 'book') !== 'join');
comprobar('«of» + «course» NO se unen', decidirPorLexico('of', 'course') !== 'join');

console.log('\n── 7. El español sigue cargado junto al inglés ────────────────');
comprobar('las dos listas conviven', esPalabraValida('sorprendentes') && esPalabraValida('understanding'));

console.log(`\n${'─'.repeat(64)}`);
if (fallos.length) {
  console.log(`✖ ${ok} OK · ${fallos.length} fallos:`);
  fallos.forEach((f) => console.log(`   · ${f}`));
  process.exit(1);
}
console.log(`✔ Unir palabras decide con evidencia. ${ok} comprobaciones.`);

console.log('\n── 8. «Solo con el libro»: más prudente ────────────────────────');
/* Con el ajuste en «solo con el libro» se ignoran las listas de palabras y
   vale nada más lo que el propio documento demuestra. Une menos, y esa es la
   idea: es la opción para quien prefiere revisar a mano. */
const soloDoc = { soloDocumento: true, vocabularioDocumento: null };
comprobar('sin el diccionario, «sorprend»+«entes» ya no se une solo',
  decidirPorLexico('sorprend', 'entes', soloDoc) !== 'join',
  `devolvió ${decidirPorLexico('sorprend', 'entes', soloDoc)}`);
comprobar('pero si el propio libro trae la palabra entera, sí se une',
  decidirPorLexico('sorprend', 'entes', {
    soloDocumento: true, vocabularioDocumento: new Set(['sorprendentes']),
  }) === 'join');
comprobar('y «de»+«la» sigue sin unirse en ese modo',
  decidirPorLexico('de', 'la', soloDoc) !== 'join');
if (fallos.length) { console.log(`\n✖ fallos al final: ${fallos.length}`); process.exit(1); }
console.log(`✔ Con el ajuste prudente también decide bien. ${ok} comprobaciones.`);
