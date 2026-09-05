/* JG Turbo · Cada corte sabe en qué carácter del texto está
 *
 * Un límite guardaba solo los dos átomos que separa. Sin posición no se puede
 * acotar «los cortes de esta página» ni llevar a nadie al sitio del corte:
 * el intento de filtrar por página en v2.41 devolvía siempre todos porque el
 * dato no existía (anotado en TRAMPAS.md).
 *
 * `charStart` es la posición del corte en el texto FINAL, no en el borrador:
 * la normalización (`.Como` → `. Como`) cambia longitudes por el camino.
 *
 *   node tests/test_pdf_limites_posicion.mjs
 */
import { reconstruirDesdeAtomos } from '../js/pdf/reconstruccion.js';

let ok = 0;
const fallos = [];
const comprobar = (n, c, d = '') => {
  if (c) { ok++; console.log(`OK: ${n}`); }
  else { fallos.push(`${n}${d ? ` — ${d}` : ''}`); console.log(`FALLO: ${n}${d ? ` — ${d}` : ''}`); }
};

/* Átomos como los que entrega pdf.js: trozos con posición. Dos renglones de
 * un párrafo y una palabra partida al saltar de renglón. */
let n = 0;
const atomo = (str, x, y, extra = {}) => ({
  id: `a${n += 1}`, str, page: 1, x, y, width: str.length * 5.5, height: 11,
  fontName: 'g_d0_f1', hasEOL: false, dir: 'ltr', ...extra,
});
const atomos = [
  atomo('Comparto', 70, 700), atomo('mas', 120, 700), atomo('historias', 145, 700),
  atomo('sorprend', 200, 700, { hasEOL: true }),
  atomo('entes', 70, 686), atomo('sobre', 100, 686), atomo('los', 130, 686),
  atomo('talleres.', 150, 686),
];
const paginas = [{ numero: 1, ancho: 595, alto: 842 }];

const r = reconstruirDesdeAtomos(atomos, { paginas, lang: 'es' });
console.log(`\ntexto reconstruido: ${JSON.stringify(r.texto)}`);
console.log(`límites: ${r.limites.length}`);

console.log('\n── 1. Todos los cortes traen posición ──────────────────────────');
const conPos = r.limites.filter((l) => Number.isFinite(l.charStart));
comprobar('cada corte sabe dónde está', conPos.length === r.limites.length,
  `${conPos.length} de ${r.limites.length}`);
comprobar('ninguna posición se sale del texto',
  r.limites.every((l) => l.charStart >= 0 && l.charStart <= r.texto.length));
comprobar('las posiciones van en orden, como los átomos',
  r.limites.every((l, i) => i === 0 || l.charStart >= r.limites[i - 1].charStart));

console.log('\n── 2. La posición apunta al corte de verdad ────────────────────');
/* Para cada corte, el texto que empieza en `charStart` debe empezar por el
 * fragmento derecho: es lo que permite llevar a alguien al sitio exacto. */
const desalineados = r.limites.filter((l) => {
  if (!l.rightFragment) return false;
  const trozo = r.texto.slice(l.charStart, l.charStart + l.rightFragment.length);
  return trozo !== l.rightFragment;
});
comprobar('el texto en esa posición empieza por el fragmento derecho',
  desalineados.length === 0,
  desalineados.slice(0, 3).map((l) => `${l.rightFragment} vs ${JSON.stringify(r.texto.slice(l.charStart, l.charStart + 12))}`).join(' · '));

console.log('\n── 3. Sirve para acotar una página ─────────────────────────────');
/* Lo que no se podía hacer antes: quedarse con los cortes de un tramo. */
const mitad = Math.floor(r.texto.length / 2);
const primeraMitad = r.limites.filter((l) => l.charStart < mitad);
comprobar('se pueden separar los cortes de un tramo del texto',
  primeraMitad.length > 0 && primeraMitad.length < r.limites.length,
  `${primeraMitad.length} de ${r.limites.length} en la primera mitad`);

console.log('\n── 4. Sobrevive al guardado y a la recarga ─────────────────────');
/* El manifiesto compacto es lo que se guarda en la biblioteca. Si la posición
 * no viaja ahí, al reabrir el libro se pierde. */
const manifiesto = r.manifiesto || [];
comprobar('el manifiesto guarda la posición',
  manifiesto.length > 0 && manifiesto.every((l) => Number.isFinite(l.c ?? l.charStart)),
  `${manifiesto.filter((l) => Number.isFinite(l.c ?? l.charStart)).length} de ${manifiesto.length}`);

console.log(`\n${'─'.repeat(64)}`);
if (fallos.length) {
  console.log(`✖ ${ok} OK · ${fallos.length} fallos:`);
  fallos.forEach((f) => console.log(`   · ${f}`));
  process.exit(1);
}
console.log(`✔ Los cortes saben dónde están. ${ok} comprobaciones.`);
