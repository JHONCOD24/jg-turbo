/* JG Turbo · Panel lateral de Contenido: ancho a gusto del lector
 *
 * Solo tablet horizontal y escritorio (el móvil usa hoja inferior y no cambia).
 * Funciones puras + persistencia segura: el arrastre y el teclado viven en el
 * controlador; aquí solo la aritmética, el modo y la memoria.
 */

export const ANCHO_INDICE_MIN = 200;
export const ANCHO_INDICE_DEF = 220;
export const ANCHO_INDICE_MAX = 520;
/* A partir de este ancho los títulos dejan el puntos suspensivos y se
 * despliegan en varias líneas: se lee el capítulo completo. */
export const ANCHO_INDICE_UMBRAL_ANCHO = 300;

const CLAVE_ANCHO = 'jg_pdf_indice_ancho';

/** Recorta al rango válido; lo inválido vuelve al valor de siempre. */
export function limitarAnchoIndice(valor) {
  const n = Number(valor);
  if (!Number.isFinite(n)) return ANCHO_INDICE_DEF;
  return Math.min(ANCHO_INDICE_MAX, Math.max(ANCHO_INDICE_MIN, Math.round(n)));
}

/** 'ancho' (títulos desplegados) o 'angosto' (una línea con puntos). */
export function modoAnchoIndice(valor) {
  return limitarAnchoIndice(valor) >= ANCHO_INDICE_UMBRAL_ANCHO ? 'ancho' : 'angosto';
}

/** Lo que el lector dejó la última vez, o el valor de siempre. Nunca rompe. */
export function leerAnchoIndice() {
  try {
    const guardado = globalThis.localStorage?.getItem(CLAVE_ANCHO);
    if (guardado == null || guardado === '') return ANCHO_INDICE_DEF;
    return limitarAnchoIndice(guardado);
  } catch (_) {
    return ANCHO_INDICE_DEF;
  }
}

/** Guarda el ancho elegido. Devuelve si quedó guardado. */
export function guardarAnchoIndice(valor) {
  try {
    globalThis.localStorage?.setItem(CLAVE_ANCHO, String(limitarAnchoIndice(valor)));
    return true;
  } catch (_) {
    return false;
  }
}
