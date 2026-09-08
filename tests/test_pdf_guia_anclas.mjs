/* Pruebas del anclaje de bloques (guía de lectura).
 * Ejecutar: node tests/test_pdf_guia_anclas.mjs
 *
 * Caso que se caza: el arranque de un bloque se repite antes (estribillo) y
 * el ancla ingenua cae en la repetición temprana, con la guía arrastrándose
 * al ~30% de la voz. Aquí se exige el ancla tardía (la verdadera).
 */
import {
  compactarTexto, puntuarContinuacion, situarBloquesTexto, rellenarAnclas,
} from '../js/pdf/guiaAnclas.js';

let fallos = 0;
function comprobar(condicion, mensaje) {
  if (condicion) console.log(`OK: ${mensaje}`);
  else { fallos += 1; console.error(`FALLO: ${mensaje}`); }
}

comprobar(
  compactarTexto('Canción pingüino 123!').texto === 'cancionpinguino123',
  'compacta sin tildes ni mayúsculas',
);
comprobar(
  compactarTexto('abc').mapa.join(',') === '0,1,2',
  'el mapa devuelve posiciones originales',
);

/* Libro con estribillo: el arranque COMPLETO del bloque 2 (48 letras) aparece
 * antes, dentro del bloque 1. El ancla ingenua cae en la repetición temprana. */
const head = 'nadie del pueblo se atrevia a salir de noche mientras la humedad siguiera pegada a las ventanas y el frio se colaba por las rendijas ';
const rellenoA = 'aquella manana el camino estaba cubierto de niebla espesa que apenas dejaba ver los arboles del sendero y el frio se colaba por cada rendija de la puerta vieja de madera que crujia con el viento del norte que bajaba de las montanas altas y nevadas ';
const rellenoMedio = 'con la luna llena y las estrellas brillando sobre el tejado de pizarra mojada por la llovizna fria de la madrugada quieta y silenciosa donde solo se oia el canto lejano de un gallo madrugador ';
const colaFinal = 'y las lamparas temblaran en el techo de la cocina grande donde la abuela contaba historias de aparecidos que volvian con la niebla ';
const texto = (rellenoA + head + rellenoMedio + head + colaFinal).replace(/\s+/g, ' ');
const b0 = rellenoA.slice(0, 190).replace(/\s+/g, ' ');
const b1 = (rellenoA.slice(190) + ' ' + head + ' ' + rellenoMedio).replace(/\s+/g, ' ');
const b2 = (head + ' ' + colaFinal).replace(/\s+/g, ' ');
const textoC = compactarTexto(texto).texto;
const bloques = [b0, b1, b2].map((b) => compactarTexto(b).texto);

const aguja2 = bloques[2].slice(0, 48);
const primera = textoC.indexOf(aguja2);
const segunda = textoC.indexOf(aguja2, primera + 1);
comprobar(primera >= 0 && segunda > primera, `el fixture repite el arranque (${primera} y ${segunda})`);

const anclas = situarBloquesTexto(textoC, bloques);
comprobar(anclas[0] === 0, `bloque 0 al inicio (${anclas[0]})`);
comprobar(anclas[1] !== null && anclas[1] >= 0, 'bloque 1 situado');
comprobar(
  anclas[2] !== null && Math.abs(anclas[2] - segunda) < 5,
  `bloque 2 en la ocurrencia verdadera (${anclas[2]} vs ${segunda}), no en la temprana (${primera})`,
);

/* Sin repeticiones: igual que antes, al inicio de cada bloque. */
const simple = compactarTexto('abcdefghij klmnopqrst uvwxyz 0123456789').texto;
const ab = situarBloquesTexto(simple, ['abcdefghij', 'klmnopqrst', 'uvwxyz0123'].map((b) => compactarTexto(b).texto));
comprobar(ab[0] === 0 && ab[1] === 10 && ab[2] === 20, `texto simple ancla exacto (${ab})`);

/* Bloque cortito: no se inventa nada. */
const ac = situarBloquesTexto(simple, ['ab', 'zzzzzzzz']);
comprobar(ac[0] === null && ac[1] === null, 'agujas cortas o ausentes quedan en null');

/* Relleno proporcional de huecos. */
comprobar(
  rellenarAnclas([0, null, 100], 100).join(',') === '0,50,100',
  'el hueco se reparte entre vecinos',
);
comprobar(
  rellenarAnclas([null, null], 90).join(',') === '30,60',
  'sin anclas se reparte todo el texto',
);

console.log(fallos === 0 ? 'TODAS LAS COMPROBACIONES PASARON' : `FALLOS: ${fallos}`);
process.exit(fallos === 0 ? 0 : 1);
