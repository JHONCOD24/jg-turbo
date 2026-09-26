/**
 * Qué preparar a continuación, siempre a partir de lo que se está viendo.
 * Funciones puras: sin red, sin DOM, sin tiempo real.
 */
import {
  MAX_SEGMENTOS_POR_LOTE, MAX_CHARS_POR_LOTE, MIN_SEGMENTOS_PARA_CERRAR, MIN_CHARS_PARA_CERRAR, piezaDeLote,
} from './translationService.js';

export const HORIZONTE_TRADUCCION_S = 180;
export const HORIZONTE_VOZ_S = 90;
export const VOZ_INICIAL_S = 20;
export const MARGEN_ATRAS_S = 2;

/** Primer elemento (ordenado por tiempo) que termina después de `t`. */
export function indiceDesde(lista, t) {
  let izquierda = 0;
  let derecha = lista.length - 1;
  let resultado = lista.length;
  while (izquierda <= derecha) {
    const mitad = (izquierda + derecha) >> 1;
    if (lista[mitad].endTime > t) { resultado = mitad; derecha = mitad - 1; } else izquierda = mitad + 1;
  }
  return resultado;
}

/**
 * Siguiente lote a traducir: el primer tramo de segmentos pendientes (ni
 * traducidos ni en curso) desde la posición, cortado con las MISMAS reglas que
 * `crearLotes` para no partir ideas. `null` si no hay nada dentro del horizonte.
 */
export function siguienteLoteTraduccion(segmentos, { traducido, enCurso }, posicionS, { horizonteS = HORIZONTE_TRADUCCION_S } = {}) {
  const limite = posicionS + horizonteS;
  let i = indiceDesde(segmentos, Math.max(0, posicionS - MARGEN_ATRAS_S));
  while (i < segmentos.length && (traducido(i) || enCurso(i))) i += 1;
  if (i >= segmentos.length || segmentos[i].startTime > limite) return null;
  const lote = [];
  let caracteres = 0;
  for (; i < segmentos.length; i += 1) {
    if (traducido(i) || enCurso(i)) break;
    const pieza = piezaDeLote(i, segmentos[i].text);
    if (lote.length && (lote.length >= MAX_SEGMENTOS_POR_LOTE || caracteres + pieza.length > MAX_CHARS_POR_LOTE)) break;
    lote.push(i);
    caracteres += pieza.length + 2;
    const siguiente = segmentos[i + 1];
    const pausa = siguiente ? siguiente.startTime - segmentos[i].endTime : 0;
    const hayMaterial = lote.length >= MIN_SEGMENTOS_PARA_CERRAR || caracteres >= MIN_CHARS_PARA_CERRAR;
    const finDeIdea = pausa > 0.6 || /[.!?]\s*$/.test(segmentos[i].text);
    if (siguiente && finDeIdea && hayMaterial) break;
  }
  return lote.length ? lote : null;
}

/** Frases con texto listo para sintetizar, dentro del horizonte, en orden. */
export function unidadesAGenerar(unidades, posicionS, { horizonteS = HORIZONTE_VOZ_S, limite = 2 } = {}) {
  const fin = posicionS + horizonteS;
  const salida = [];
  for (let i = indiceDesde(unidades, posicionS); i < unidades.length && salida.length < limite; i += 1) {
    if (unidades[i].startTime > fin) break;
    if (unidades[i].estado === 'pendiente') salida.push(i);
  }
  return salida;
}

/**
 * Segundos por delante que ya no necesitan trabajo: hasta el inicio de la primera
 * frase que aún no está resuelta. Un silencio sin frases cuenta como cubierto.
 */
export function segundosCubiertos(unidades, posicionS, estados = ['listo', 'sin_voz', 'error']) {
  const resueltos = new Set(estados);
  for (let i = indiceDesde(unidades, posicionS); i < unidades.length; i += 1) {
    if (!resueltos.has(unidades[i].estado)) return Math.max(0, unidades[i].startTime - posicionS);
  }
  return Number.POSITIVE_INFINITY;
}

/** Segundos por delante ya traducidos (hasta el primer segmento pendiente). */
export function segundosTraducidos(segmentos, traducido, posicionS) {
  for (let i = indiceDesde(segmentos, posicionS); i < segmentos.length; i += 1) {
    if (!traducido(i)) return Math.max(0, segmentos[i].startTime - posicionS);
  }
  return Number.POSITIVE_INFINITY;
}
