/* Pruebas del panel lateral de Contenido (ancho a gusto del lector).
 * Ejecutar: node tests/test_pdf_panel_indice.mjs
 */
import {
  limitarAnchoIndice, modoAnchoIndice, leerAnchoIndice,
  ANCHO_INDICE_MIN, ANCHO_INDICE_DEF, ANCHO_INDICE_MAX,
} from '../js/pdf/panelIndice.js';

let fallos = 0;
function comprobar(condicion, mensaje) {
  if (condicion) console.log(`OK: ${mensaje}`);
  else { fallos += 1; console.error(`FALLO: ${mensaje}`); }
}

comprobar(limitarAnchoIndice(220) === 220, 'el valor normal pasa igual');
comprobar(limitarAnchoIndice(100) === ANCHO_INDICE_MIN, 'por debajo recorta al mínimo');
comprobar(limitarAnchoIndice(900) === ANCHO_INDICE_MAX, 'por encima recorta al máximo');
comprobar(limitarAnchoIndice('abc') === ANCHO_INDICE_DEF, 'lo inválido vuelve al valor de siempre');
comprobar(limitarAnchoIndice(null) === ANCHO_INDICE_MIN, 'nulo cae al mínimo (Number(null)=0)');
comprobar(limitarAnchoIndice(undefined) === ANCHO_INDICE_DEF, 'indefinido vuelve al valor de siempre');
comprobar(limitarAnchoIndice(250.6) === 251, 'redondea a píxel entero');

comprobar(modoAnchoIndice(220) === 'angosto', 'angosto mantiene una línea');
comprobar(modoAnchoIndice(299) === 'angosto', 'justo bajo el umbral sigue angosto');
comprobar(modoAnchoIndice(300) === 'ancho', 'en el umbral despliega títulos');
comprobar(modoAnchoIndice(520) === 'ancho', 'al máximo sigue desplegado');

comprobar(leerAnchoIndice() === ANCHO_INDICE_DEF, 'sin memoria guardada usa el valor de siempre');

console.log(fallos === 0 ? 'TODAS LAS COMPROBACIONES PASARON' : `FALLOS: ${fallos}`);
process.exit(fallos === 0 ? 0 : 1);
