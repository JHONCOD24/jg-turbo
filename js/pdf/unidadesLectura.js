/* JG Turbo · Unidades de lectura (lo que el resaltado marca mientras suena la voz)
 *
 * Antes la marca cubría «tramos» de 55–135 caracteres cortados donde cayera un
 * espacio: a mitad de oración, de abreviatura o de cifra. Aquí la unidad es la
 * ORACIÓN completa. Solo si una oración es larguísima (> 240) se parte en
 * cláusulas, en este orden de preferencia: `;`  `:`  `—`  `,`  sin dejar
 * trozos de menos de 60 caracteres. Tope duro: 300; pasado eso se corta en un
 * espacio (y, si no hay ni uno, en el carácter 300: el texto no puede colgarse).
 *
 * Módulo puro: sin DOM, se prueba en Node (tests/test_pdf_unidades_lectura.mjs).
 * Las posiciones son del texto original, `[inicio, fin)`, sin espacios en los bordes.
 */

export const MAX_UNIDAD = 240;
export const TOPE_DURO = 300;
export const MIN_CLAUSULA = 60;

const TERMINADORES = '.!?…';
/* Lo que cierra y viaja con la oración que acaba de terminar. */
const CIERRES = '»”’"\')]}›';
/* Lo que abre y se salta al mirar con qué letra empieza la oración siguiente. */
const APERTURAS = '«“‘"\'([{¿¡';
const RAYAS = '—–';

/* Títulos de tratamiento: tras ellos siempre sigue un nombre, nunca se corta. */
const TRATAMIENTOS = new Set([
  'sr', 'sra', 'srta', 'sres', 'dr', 'dra', 'dres', 'prof', 'profa', 'lic', 'ing', 'arq', 'gral', 'cnel',
  'sgto', 'cap', 'mr', 'mrs', 'ms', 'st', 'fr', 'sta', 'sto', 'dña', 'excmo', 'ilmo', 'rvdo',
]);
/* Abreviaturas que van seguidas de un número («pág. 12», «fig. 3»). */
const ANTE_NUMERO = new Set([
  'pág', 'págs', 'pp', 'núm', 'nº', 'vol', 'vols', 'caps', 'fig', 'figs', 'art', 'arts', 'ed', 'eds', 'no', 'tel', 'cf', 'vs',
]);

const esMinuscula = (c) => !!c && /\p{Ll}/u.test(c);
const esMayuscula = (c) => !!c && /\p{Lu}/u.test(c);
const esEspacio = (c) => c === undefined || /\s/.test(c);

/** Primer índice con algo que no sea espacio en [a, b). */
function saltarEspacios(t, a, b) {
  let i = a;
  while (i < b && /\s/.test(t[i])) i += 1;
  return i;
}
function recortarFin(t, a, b) {
  let f = b;
  while (f > a && /\s/.test(t[f - 1])) f -= 1;
  return f;
}

/* ── 1. Líneas duras: dónde un salto de línea SÍ separa unidades ──────────── */
function esMarcaDeLista(linea) {
  return /^([-•●▪*]|\d{1,3}[.)])\s+\S/.test(linea);
}
function empiezaFrase(linea) {
  const p = linea.search(/[^\s«“‘"'([{¿¡—–-]/);
  if (p < 0) return false;
  return !esMinuscula(linea[p]);
}
/** ¿El salto simple entre `previa` y `siguiente` separa unidades? */
function saltoSeparaUnidades(previa, siguiente) {
  if (!previa || !siguiente) return true;
  if (esMarcaDeLista(siguiente)) return true;
  if (/[.!?…:»”"]$/.test(previa)) return true;
  if (/\)$/.test(previa) && empiezaFrase(siguiente)) return true;
  /* Renglón corto sin cierre y otro que arranca como frase: título o ítem. */
  if (previa.length <= 90 && empiezaFrase(siguiente) && !/[,;]$/.test(previa)) return true;
  return false;
}

function segmentosDuros(t) {
  const lineas = [];
  let pos = 0;
  for (const cruda of t.split('\n')) {
    const ini = pos;
    pos += cruda.length + 1;
    const a = saltarEspacios(t, ini, ini + cruda.length);
    const b = recortarFin(t, a, ini + cruda.length);
    lineas.push({ a, b, vacia: b <= a });
  }
  const segmentos = [];
  let actual = null;
  for (let i = 0; i < lineas.length; i += 1) {
    const l = lineas[i];
    if (l.vacia) { if (actual) { segmentos.push(actual); actual = null; } continue; }
    if (!actual) { actual = [l.a, l.b]; continue; }
    const previa = t.slice(actual[0], actual[1]).split('\n').pop().trim();
    if (saltoSeparaUnidades(previa, t.slice(l.a, l.b))) {
      segmentos.push(actual);
      actual = [l.a, l.b];
    } else {
      actual[1] = l.b;
    }
  }
  if (actual) segmentos.push(actual);
  return segmentos;
}

/* ── 2. Oraciones ────────────────────────────────────────────────────────── */
/** ¿El punto que acaba en `j` (y sigue `p`) cierra de verdad una oración? */
function cierraOracion(t, ini, i, j, p, b) {
  /* Con qué empieza lo que viene: se saltan aperturas («, ¿, comillas…). */
  let q = p;
  if (RAYAS.includes(t[q])) {
    /* Acotación del narrador: «—¿Vienes? —preguntó». No es otra oración. */
    const r = saltarEspacios(t, q + 1, b);
    return !esMinuscula(t[r]);
  }
  while (q < b && APERTURAS.includes(t[q])) q += 1;
  const primera = t[q];
  if (q >= b) return true;
  if (esMinuscula(primera)) return false;

  const unico = i === j; /* un solo «.», no «...» ni «?!» */
  if (t[i] !== '.' || !unico) return true;

  /* Palabra que precede al punto. */
  const antes = t.slice(Math.max(ini, i - 24), i);
  const m = /([\p{L}\p{N}ºª]+)$/u.exec(antes);
  const palabra = m ? m[1] : '';
  const clave = palabra.toLowerCase();

  /* «1.» «2.» al principio de la unidad: el número de una lista. */
  if (/^\d{1,3}$/.test(t.slice(ini, i).trim())) return false;
  /* «Sr. Pérez», «Dra. Gómez». */
  if (TRATAMIENTOS.has(clave)) return false;
  /* «pág. 12», «fig. 3». */
  if (ANTE_NUMERO.has(clave) && /\d/.test(primera)) return false;
  /* «EE. UU.»: el primer «EE.» nunca cierra. */
  if (clave === 'ee' && /^UU\b/.test(t.slice(q, q + 4))) return false;
  /* Una sola letra: «p. ej.», «a. C.», o inicial de nombre («J. R. R. Tolkien»). */
  if (palabra.length === 1 && /\p{L}/u.test(palabra)) {
    if (esMinuscula(palabra)) return false;
    const previa = /([\p{L}]+)\s+$/u.exec(t.slice(Math.max(ini, i - 28), i - 1));
    const sigueInicial = /^\p{Lu}\./u.test(t.slice(q, q + 2));
    if (esMayuscula(primera) && (sigueInicial || !previa || esMayuscula(previa[1][0]))) return false;
  }
  return true;
}

/** Corta [a, b) (ya recortado) en oraciones. Empuja pares a `fuera`. */
function oraciones(t, a, b, fuera) {
  let ini = a;
  let i = a;
  while (i < b) {
    const c = t[i];
    if (!TERMINADORES.includes(c)) { i += 1; continue; }
    let j = i;
    while (j + 1 < b && TERMINADORES.includes(t[j + 1])) j += 1;
    let k = j + 1;
    while (k < b && CIERRES.includes(t[k])) k += 1;
    /* «3.5», «1.200», «sitio.com»: el punto no va seguido de espacio. */
    if (k < b && !/\s/.test(t[k])) { i = k; continue; }
    const p = saltarEspacios(t, k, b);
    if (p >= b) break;
    if (cierraOracion(t, ini, i, j, p, b)) {
      fuera.push([ini, recortarFin(t, ini, k)]);
      ini = p;
    }
    i = Math.max(k, p);
  }
  if (ini < b) fuera.push([ini, recortarFin(t, ini, b)]);
}

/* ── 3. Cláusulas de una oración larguísima ──────────────────────────────── */
/** Posiciones donde se puede cortar por `signos`: [finIzquierda, inicioDerecha]. */
function candidatos(t, a, b, signos) {
  const salida = [];
  for (let i = a; i < b - 1; i += 1) {
    if (!signos.includes(t[i])) continue;
    if (RAYAS.includes(t[i]) && !/\s/.test(t[i + 1])) continue; /* «—dijo»: abre acotación */
    let k = i + 1;
    while (k < b && CIERRES.includes(t[k])) k += 1;
    if (k < b && !/\s/.test(t[k])) continue;
    const p = saltarEspacios(t, k, b);
    if (p >= b) continue;
    if (CIERRES.includes(t[p])) continue;
    const fin = recortarFin(t, a, k);
    if (APERTURAS.includes(t[fin - 1]) && fin - 1 > a) continue;
    salida.push([fin, p]);
  }
  return salida;
}

function cortarEnClausulas(t, a, b, fuera) {
  if (b - a <= MAX_UNIDAD) { fuera.push([a, b]); return; }
  const medio = (a + b) / 2;
  for (const signos of [';', ':', RAYAS, ',']) {
    let mejor = null;
    for (const c of candidatos(t, a, b, signos)) {
      if (c[0] - a < MIN_CLAUSULA || b - c[1] < MIN_CLAUSULA) continue;
      if (!mejor || Math.abs(c[0] - medio) < Math.abs(mejor[0] - medio)) mejor = c;
    }
    if (mejor) {
      cortarEnClausulas(t, a, mejor[0], fuera);
      cortarEnClausulas(t, mejor[1], b, fuera);
      return;
    }
  }
  tope(t, a, b, fuera);
}

/** Sin puntuación útil: corta en un espacio; lo que pase de 300 se parte sí o sí. */
function tope(t, a, b, fuera) {
  let ini = a;
  while (b - ini > TOPE_DURO) {
    let corte = -1;
    for (let k = ini + TOPE_DURO; k >= ini + MIN_CLAUSULA; k -= 1) {
      if (/\s/.test(t[k])) { corte = k; break; }
    }
    if (corte < 0) {
      /* Ni un espacio en 300 caracteres: se corta ahí, y sale una palabra
       * descomunal partida, que es mejor que dejar el texto sin marca. */
      fuera.push([ini, ini + TOPE_DURO]);
      ini += TOPE_DURO;
      continue;
    }
    fuera.push([ini, recortarFin(t, ini, corte)]);
    ini = saltarEspacios(t, corte, b);
  }
  if (ini < b) fuera.push([ini, b]);
}

/**
 * El texto partido en unidades de lectura: `[[inicio, fin], …]`, en orden.
 * Nunca devuelve una unidad vacía ni con espacios en los bordes.
 */
export function partirEnUnidades(texto) {
  const t = String(texto ?? '');
  if (!t.trim()) return [];
  const frases = [];
  for (const [a, b] of segmentosDuros(t)) oraciones(t, a, b, frases);
  const unidades = [];
  for (const [a, b] of frases) {
    if (b <= a) continue;
    if (b - a <= MAX_UNIDAD) unidades.push([a, b]);
    else cortarEnClausulas(t, a, b, unidades);
  }
  return unidades.filter(([a, b]) => b > a);
}

/**
 * La unidad que contiene un punto del texto (búsqueda binaria). Un punto en el
 * hueco entre dos unidades pertenece a la que acaba de sonar; fuera de los
 * extremos, a la primera o a la última.
 */
export function unidadEn(unidades, posicion) {
  if (!unidades || !unidades.length) return null;
  let bajo = 0;
  let alto = unidades.length - 1;
  while (bajo <= alto) {
    const medio = (bajo + alto) >> 1;
    const [ini, fin] = unidades[medio];
    if (posicion < ini) alto = medio - 1;
    else if (posicion >= fin) bajo = medio + 1;
    else return unidades[medio];
  }
  return unidades[Math.max(0, Math.min(unidades.length - 1, alto))] || null;
}
