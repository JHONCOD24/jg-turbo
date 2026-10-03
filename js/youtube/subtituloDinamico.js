/**
 * Subtítulo dinámico (estilo TikTok): el texto de un segmento se muestra en
 * trozos de máximo 2 renglones que avanzan a la par con la voz.
 *
 * Todo es puro y se prueba en Node: el ancho de un texto lo da `medir(texto)`
 * (en el navegador, `canvas.measureText` con la fuente real del subtítulo),
 * nunca un número fijo de caracteres. Ninguna palabra se pierde, se repite ni
 * se parte: la unión de los trozos es el texto original normalizado.
 */
const acotar = (v, min, max) => Math.min(max, Math.max(min, v));
const numero = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

export function normalizarTexto(texto) {
  return String(texto ?? '').replace(/\s+/g, ' ').trim();
}

/**
 * Renglones que ocupa un texto al ancho dado, envolviendo palabra por palabra
 * como el navegador. Una palabra más ancha que el renglón cuenta los que
 * necesite (`overflow-wrap:anywhere` la parte en pantalla).
 */
export function lineasQueOcupa(texto, medir, anchoMax) {
  const palabras = normalizarTexto(texto).split(' ').filter(Boolean);
  if (!palabras.length) return 0;
  let lineas = 1;
  let actual = '';
  for (const palabra of palabras) {
    const candidata = actual ? `${actual} ${palabra}` : palabra;
    if (medir(candidata) <= anchoMax) { actual = candidata; continue; }
    if (actual) lineas += 1;
    const ancho = medir(palabra);
    if (ancho > anchoMax) { lineas += Math.ceil(ancho / anchoMax) - 1; actual = ''; } else actual = palabra;
  }
  return lineas;
}

const FIN_ORACION = /[.!?…]["'”’)\]»]*$/;
const FIN_CLAUSULA = /[,;:–—]["'”’)\]»]*$/;

/**
 * Parte `texto` en trozos que caben en `maxLineas` renglones de `anchoMax`.
 * Corte preferido: fin de oración; luego `, ; :`; si no, lo último que cabe.
 */
export function trocearSubtitulo(texto, { medir, anchoMax, maxLineas = 2 } = {}) {
  const palabras = normalizarTexto(texto).split(' ').filter(Boolean);
  if (!palabras.length) return [];
  if (typeof medir !== 'function' || !(anchoMax > 0)) return [palabras.join(' ')];
  const cabe = (i, j) => lineasQueOcupa(palabras.slice(i, j + 1).join(' '), medir, anchoMax) <= maxLineas;
  const trozos = [];
  let i = 0;
  while (i < palabras.length) {
    let j = i;   // al menos una palabra, aunque no quepa
    while (j + 1 < palabras.length && cabe(i, j + 1)) j += 1;
    if (j === palabras.length - 1) { trozos.push(palabras.slice(i).join(' ')); break; }
    const n = j - i + 1;
    let corte = -1;
    for (let k = j; k >= i + Math.ceil(n * 0.5) - 1; k -= 1) if (FIN_ORACION.test(palabras[k])) { corte = k; break; }
    if (corte < 0) for (let k = j; k >= i + Math.ceil(n * 0.6) - 1; k -= 1) if (FIN_CLAUSULA.test(palabras[k])) { corte = k; break; }
    if (corte < 0) corte = j;
    // Sin dejar una palabra huérfana como último trozo.
    if (palabras.length - 1 - corte === 1 && corte > i) corte -= 1;
    trozos.push(palabras.slice(i, corte + 1).join(' '));
    i = corte + 1;
  }
  return trozos;
}

/** Costo de decir un texto: letras + pausas por signos (punto 6, coma 3, raya 2). */
export function costoDeHabla(texto) {
  const t = String(texto ?? '');
  const letras = (t.match(/[\p{L}\p{N}]/gu) || []).length;
  const fuertes = (t.match(/[.!?…]/g) || []).length;
  const suaves = (t.match(/[,;:]/g) || []).length;
  const rayas = (t.match(/[–—]/g) || []).length;
  return letras + fuertes * 6 + suaves * 3 + rayas * 2;
}

/** Fracción acumulada (0–1) en la que termina cada trozo; el último es 1. */
export function pesosDeTrozos(trozos) {
  const lista = Array.isArray(trozos) ? trozos : [];
  const costos = lista.map((t) => Math.max(0, costoDeHabla(t)));
  const total = costos.reduce((a, b) => a + b, 0);
  const base = total > 0 ? total : costos.length;
  let acumulado = 0;
  return costos.map((c, k) => {
    acumulado += total > 0 ? c : 1;
    return k === costos.length - 1 ? 1 : acumulado / base;
  });
}

/** Índice del trozo que corresponde al progreso (0–1) del habla. -1 si no hay trozos. */
export function trozoPorProgreso(trozos, progreso) {
  if (!Array.isArray(trozos) || !trozos.length) return -1;
  const p = acotar(numero(progreso), 0, 1);
  const fin = pesosDeTrozos(trozos);
  for (let k = 0; k < fin.length; k += 1) if (p < fin[k]) return k;
  return trozos.length - 1;
}

/**
 * Avance (0–1) dentro de UN segmento a partir del avance de la frase de voz
 * que lo contiene (una frase puede abarcar varios segmentos: `fracciones`).
 */
export function progresoEnSegmento(unidad, avance, indice) {
  if (!unidad) return 0;
  const cantidad = unidad.hasta - unidad.desde + 1;
  if (!(cantidad > 0)) return 0;
  const fracciones = Array.isArray(unidad.fracciones) && unidad.fracciones.length === cantidad
    ? unidad.fracciones
    : Array.from({ length: cantidad }, (_, k) => (k + 1) / cantidad);
  const k = acotar(Math.trunc(numero(indice)) - unidad.desde, 0, cantidad - 1);
  const inicio = k > 0 ? fracciones[k - 1] : 0;
  const fin = fracciones[k];
  if (!(fin > inicio)) return 1;
  return acotar((numero(avance) - inicio) / (fin - inicio), 0, 1);
}
