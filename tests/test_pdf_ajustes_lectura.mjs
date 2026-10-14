/* JG Turbo · Ajustes de lectura estilo Kindle (hoja «Aa»).
 *   node tests/test_pdf_ajustes_lectura.mjs
 *
 * Reglas puras de `js/pdf/ajustesLectura.js`: lo guardado se normaliza
 * siempre, los estilos rápidos no tocan el tema, el pie dice algo útil o
 * nada, y las zonas de toque no le quitan el centro al texto.
 */
import {
  normalizarAjustes, AJUSTES_BASE, TEMAS, temaValido, aplicarEstiloRapido, estiloRapidoActual,
  pasoTamano, siguienteModoProgreso, MODOS_PROGRESO, formatearMinutos, minutosRestantesLibro,
  textoProgreso, zonaDeToque, TAM_MIN, TAM_MAX, ESTILOS_RAPIDOS,
} from '../js/pdf/ajustesLectura.js';

let ok = 0;
let fallos = 0;
function comprobar(condicion, mensaje, detalle = '') {
  if (condicion) { ok += 1; console.log(`OK: ${mensaje}`); } else {
    fallos += 1;
    console.error(`FALLO: ${mensaje}${detalle ? ` — ${detalle}` : ''}`);
  }
}

/* ── Normalizar: nada guardado deja el lector en un estado imposible ── */
const vacio = normalizarAjustes(null);
comprobar(vacio.tam === 19 && vacio.inter === 1.7 && vacio.ancho === 64, 'sin nada guardado → valores base');
comprobar(vacio.bordes === true && vacio.progreso === 'libro' && vacio.brillo === 100, 'base: bordes activos, pie con % del libro, brillo 100');
comprobar(normalizarAjustes('basura').tam === 19, 'un texto en vez de objeto no rompe');
comprobar(normalizarAjustes({ tam: 999 }).tam === TAM_MAX, `tamaño enorme → ${TAM_MAX}`);
comprobar(normalizarAjustes({ tam: -4 }).tam === TAM_MIN, `tamaño negativo → ${TAM_MIN}`);
comprobar(normalizarAjustes({ tam: 'NaN' }).tam === 19, 'tamaño ilegible → base');
comprobar(normalizarAjustes({ tam: 20.6 }).tam === 21, 'tamaño con decimales se redondea');
comprobar(normalizarAjustes({ inter: 9 }).inter === 2.2 && normalizarAjustes({ inter: 0 }).inter === 1.2, 'interlineado acotado a 1,2–2,2');
comprobar(normalizarAjustes({ ancho: 70 }).ancho === 64, 'ancho fuera de la lista → normal');
comprobar(normalizarAjustes({ ancho: '52' }).ancho === 52, 'ancho como texto («52») vale');
comprobar(normalizarAjustes({ fuente: 'comic' }).fuente === 'sans', 'fuente desconocida → sans');
comprobar(normalizarAjustes({ fuente: 'legible' }).fuente === 'legible', 'fuente legible se conserva');
comprobar(normalizarAjustes({ grosor: 'extra' }).grosor === 'normal', 'grosor desconocido → normal');
comprobar(normalizarAjustes({ alinear: 'centro' }).alinear === 'auto', 'alineación desconocida → automática');
comprobar(normalizarAjustes({ bordes: false }).bordes === false, 'apagar los bordes se respeta');
comprobar(normalizarAjustes({ bordes: 'no' }).bordes === true, 'solo `false` apaga los bordes');
comprobar(normalizarAjustes({ progreso: 'x' }).progreso === 'libro', 'modo de pie desconocido → libro');
comprobar(normalizarAjustes({ brillo: 5 }).brillo === 40 && normalizarAjustes({ brillo: 300 }).brillo === 100, 'brillo acotado a 40–100 (nunca una pantalla negra)');
comprobar(normalizarAjustes({ modoPagina: 'scroll' }).modoPagina === 'scroll' && normalizarAjustes({ modoPagina: 'x' }).modoPagina === 'paginas', 'modo de página válido o páginas');
comprobar(normalizarAjustes({ tamElegido: 'si' }).tamElegido === false, 'tamElegido solo con `true`');
const viejo = { tam: 22, inter: 1.8, ancho: 52, fuente: 'serif', modo: 'lectura', modoPagina: 'paginas', tamElegido: true, vozDesplegado: true };
const migrado = normalizarAjustes(viejo);
comprobar(migrado.tam === 22 && migrado.fuente === 'serif' && migrado.vozDesplegado === true && migrado.grosor === 'normal',
  'un ajuste guardado por la versión anterior conserva todo y gana los campos nuevos');
comprobar(Object.isFrozen(AJUSTES_BASE), 'los valores base no se pueden alterar por accidente');

/* ── Temas ── */
comprobar(TEMAS.join() === 'papel,sepia,verde,noche,negro', 'cinco colores de página: papel, sepia, verde, noche y negro');
comprobar(temaValido('verde') === 'verde' && temaValido('negro') === 'negro', 'verde y negro son temas válidos');
comprobar(temaValido('rosa') === 'noche' && temaValido(undefined) === 'noche', 'tema desconocido → noche');

/* ── Estilos rápidos ── */
const conTema = { ...vacio, tema: 'sepia', modoPagina: 'scroll' };
const grande = aplicarEstiloRapido(conTema, 'grande');
comprobar(grande.tam === 24 && grande.grosor === 'medio', 'Grande sube la letra y el grosor');
comprobar(grande.tema === 'sepia' && grande.modoPagina === 'scroll', 'un estilo rápido no cambia el tema ni el modo de página');
comprobar(grande.tamElegido === true, 'un estilo rápido cuenta como tamaño elegido (no lo pisa el automático)');
comprobar(aplicarEstiloRapido(conTema, 'inexistente').tam === conTema.tam, 'estilo desconocido no cambia nada');
comprobar(estiloRapidoActual(grande) === 'grande', 'el estilo aplicado se reconoce como activo');
comprobar(estiloRapidoActual({ ...grande, tam: 25 }) === null, 'si la persona mueve el tamaño, ningún estilo queda marcado');
for (const clave of Object.keys(ESTILOS_RAPIDOS)) {
  const c = aplicarEstiloRapido(vacio, clave);
  comprobar(estiloRapidoActual(c) === clave, `estilo «${ESTILOS_RAPIDOS[clave].nombre}» queda dentro de los límites y se reconoce`);
}

/* ── A− / A+ ── */
comprobar(pasoTamano(vacio, +1).tam === 20 && pasoTamano(vacio, -1).tam === 18, 'A+ y A− mueven un punto');
comprobar(pasoTamano({ tam: TAM_MAX }, +1).tam === TAM_MAX, 'A+ no pasa del máximo');
comprobar(pasoTamano({ tam: TAM_MIN }, -1).tam === TAM_MIN, 'A− no baja del mínimo');
comprobar(pasoTamano(vacio, +1).tamElegido === true, 'A+ deja el tamaño como elegido');

/* ── Pie de progreso ── */
let modo = 'libro';
const vistos = [];
for (let i = 0; i < MODOS_PROGRESO.length; i += 1) { vistos.push(modo); modo = siguienteModoProgreso(modo); }
comprobar(modo === 'libro' && new Set(vistos).size === MODOS_PROGRESO.length, 'tocar el pie recorre los cinco modos y vuelve al primero');
comprobar(siguienteModoProgreso('raro') === 'libro', 'desde un modo raro, el ciclo arranca en el primero');
comprobar(textoProgreso('libro', { porcentaje: 37.4 }) === '37 % del libro', 'pie: porcentaje del libro');
comprobar(textoProgreso('libro', { porcentaje: 140 }) === '100 % del libro', 'pie: el porcentaje no pasa de 100');
comprobar(textoProgreso('libro', {}) === '', 'pie: sin porcentaje no inventa una cifra');
comprobar(textoProgreso('tiempo-capitulo', { minutosCapitulo: '~8 min' }) === '~8 min para terminar el capítulo', 'pie: tiempo del capítulo');
comprobar(textoProgreso('tiempo-libro', { minutosLibro: 95 }) === '~1 h 35 min para terminar el libro', 'pie: tiempo del libro');
comprobar(textoProgreso('pagina', { pagina: 3, paginas: 12 }) === 'Página 3 de 12 del capítulo', 'pie: página del capítulo');
comprobar(textoProgreso('pagina', { pagina: 0, paginas: 0 }) === '', 'pie: sin páginas medidas no dice «0 de 0»');
comprobar(textoProgreso('nada', { porcentaje: 50 }) === '', 'pie: «nada» deja el pie limpio');

comprobar(formatearMinutos(0.3) === 'menos de 1 min' && formatearMinutos(45) === '~45 min' && formatearMinutos(120) === '~2 h', 'minutos con formato legible');
comprobar(formatearMinutos(NaN) === '' && formatearMinutos(-2) === '', 'minutos inválidos → vacío');

const textos = ['uno dos tres cuatro', 'cinco seis', 'siete ocho nueve diez'];
comprobar(Math.abs(minutosRestantesLibro(textos, { parte: 0, desplazamiento: 0 }, 1) - 10) < 1e-9, 'libro sin empezar: cuenta todas las palabras');
comprobar(Math.abs(minutosRestantesLibro(textos, { parte: 1, desplazamiento: 0.5 }, 1) - 5) < 1e-9, 'a mitad del capítulo 2: mitad del 2 + todo el 3');
comprobar(minutosRestantesLibro(textos, { parte: 2, desplazamiento: 1 }, 1) === 0, 'al final del libro no queda nada');
comprobar(Math.abs(minutosRestantesLibro(textos, { parte: 99, desplazamiento: 0 }, 1) - 4) < 1e-9, 'una parte fuera de rango se recorta al último capítulo');
comprobar(minutosRestantesLibro([], {}) === null, 'sin capítulos → null (no 0, que diría «ya terminaste»)');
comprobar(minutosRestantesLibro(['', '   '], { parte: 0 }) === 0, 'capítulos vacíos no rompen');

/* ── Zonas de toque ── */
comprobar(zonaDeToque(10, 0, 390) === 'anterior', 'teléfono: tocar el borde izquierdo vuelve');
comprobar(zonaDeToque(380, 0, 390) === 'siguiente', 'teléfono: tocar el borde derecho avanza');
comprobar(zonaDeToque(195, 0, 390) === 'centro', 'teléfono: el centro muestra los controles');
comprobar(zonaDeToque(85, 0, 390) === 'anterior' && zonaDeToque(90, 0, 390) === 'centro', 'teléfono: cada borde es el 22 % (≈86 px)');
comprobar(zonaDeToque(40, 0, 200) === 'anterior' && zonaDeToque(60, 0, 200) === 'centro', 'pantalla diminuta: el borde no baja de 48 px');
comprobar(zonaDeToque(170, 0, 1200) === 'centro' && zonaDeToque(150, 0, 1200) === 'anterior', 'tablet ancha: el borde no pasa de 160 px');
comprobar(zonaDeToque(120, 100, 390) === 'anterior', 'cuenta desde el borde real del texto, no de la ventana');
comprobar(zonaDeToque(10, 0, 0) === 'centro' && zonaDeToque(NaN, 0, 390) === 'centro', 'sin medidas → centro (nunca pasa página por error)');

console.log(fallos === 0 ? `\n✔ ajustes de lectura · ${ok} comprobaciones, 0 fallos` : `\n❌ ${fallos} fallos de ${ok + fallos} comprobaciones`);
process.exit(fallos === 0 ? 0 : 1);
