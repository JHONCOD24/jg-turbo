/* JG Turbo · Unir también con espacio residual de fin de renglón
 *
 * El caso real: el PDF trae «...que to » (con blanco) al final del renglón
 * y «ma un pla» dos líneas abajo. El extractor daba ese blanco por espacio
 * sin preguntar, así que «Unir palabras» no lo veía ni como candidato y el
 * botón no hacía nada aunque el léxico sí supiera que «to»+«ma» es «toma».
 *
 * La regla no cambia: solo 'join' une; lo demás queda como espacio y NUNCA
 * pendiente (no se infla «Revisar cortes» ni la etapa 1 de la corrección).
 *
 *   node tests/test_pdf_espacio_renglon.mjs
 */
import { readFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { cargarLexico, decidirPorLexico } from '../js/pdf/lexico.js';
import { crearLimites, resolverLimitesDeterministas } from '../js/pdf/limites.js';

const app = resolve(import.meta.dirname, '..');
let ok = 0;
const fallos = [];
function comprobar(nombre, condicion, detalle = '') {
  if (condicion) { ok++; console.log(`OK: ${nombre}`); }
  else { fallos.push(`${nombre}${detalle ? ` — ${detalle}` : ''}`); console.log(`FALLO: ${nombre}${detalle ? ` — ${detalle}` : ''}`); }
}

const desdeDisco = (idioma) => readFile(join(app, `js/vendor/lexico/${idioma}.txt`), 'utf8');
await cargarLexico('es', desdeDisco);

/* Átomos como los entrega pdf.js: el de fin de renglón trae blanco. */
function atomos(casos) {
  return casos.map(([id, str, y], i) => ({
    id, str, x: 70, y, width: 60 + str.length * 5, height: 12,
    page: 1, hasEOL: / $/.test(str), fontName: 'F1',
  }));
}
function resolver(casos) {
  const lista = atomos(casos);
  const limites = crearLimites(lista);
  resolverLimitesDeterministas(limites, new Map(lista.map((a) => [a.id, a])), { lang: 'es' });
  return limites;
}

console.log('\n── 1. El caso del usuario: to/ma con blanco ────────────────────');
{
  const [lim] = resolver([['a1', 'que to ', 100], ['a2', 'ma un pla', 124]]);
  comprobar('el veredicto existe', decidirPorLexico('to', 'ma', { continuidadGeometrica: true }, 'es') === 'join');
  comprobar('el límite se une', lim.decision === 'join', `quedó ${lim.decision}`);
  comprobar('con fuente del léxico', lim.source === 'lexicon', `fuente ${lim.source}`);
}

console.log('\n── 2. Lo que NO se toca ────────────────────────────────────────');
{
  const [l1] = resolver([['b1', 'el estado de ', 100], ['b2', 'la cosa', 124]]);
  comprobar('de/la con blanco queda espacio', l1.decision === 'space', `quedó ${l1.decision}`);
  const [l2] = resolver([['c1', 'dijo el ', 100], ['c2', 'la verdad', 124]]);
  comprobar('el/la con blanco queda espacio', l2.decision === 'space', `quedó ${l2.decision}`);
  const [l3] = resolver([['d1', 'la casa ', 100], ['d2', 'el perro', 124]]);
  comprobar('dos palabras completas quedan espacio', l3.decision === 'space', `quedó ${l3.decision}`);
}

console.log('\n── 3. Nunca pendiente por un blanco ────────────────────────────');
{
  const limites = resolver([
    ['e1', 'que to ', 100], ['e2', 'ma un pla ', 124], ['e3', 'no sé ', 148], ['e4', 'qué más', 172],
  ]);
  comprobar('ningún blanco genera pendiente', limites.every((l) => l.decision !== 'pending'),
    limites.map((l) => `${l.leftFragment}+${l.rightFragment}=${l.decision}`).join(' '));
}

console.log('\n── 4. Cortes entre páginas con blanco ──────────────────────────');
{
  const lista = [
    { id: 'f1', str: 'termina en to ', x: 70, y: 700, width: 200, height: 12, page: 3, hasEOL: true, fontName: 'F1' },
    { id: 'f2', str: 'ma sigue aquí', x: 70, y: 100, width: 150, height: 12, page: 4, hasEOL: false, fontName: 'F1' },
  ];
  const limites = crearLimites(lista);
  resolverLimitesDeterministas(limites, new Map(lista.map((a) => [a.id, a])), { lang: 'es' });
  comprobar('el corte de página con blanco también se une', limites[0].decision === 'join',
    `quedó ${limites[0].decision}`);
}

if (fallos.length) {
  console.log(`\n✖ ${ok} OK · ${fallos.length} fallos:`);
  fallos.forEach((f) => console.log(`   · ${f}`));
  process.exit(1);
}
console.log(`\n✔ Espacio de renglón: ${ok} comprobaciones.`);
