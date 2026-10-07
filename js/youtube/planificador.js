/**
 * Qué preparar a continuación, siempre a partir de lo que se está viendo.
 * Funciones puras: sin red, sin DOM, sin tiempo real.
 */
import {
  MAX_SEGMENTOS_POR_LOTE, MAX_CHARS_POR_LOTE, MIN_SEGMENTOS_PARA_CERRAR, MIN_CHARS_PARA_CERRAR, piezaDeLote,
} from './translationService.js';

/**
 * Lo que se traduce con prisa (ritmo normal). Más allá se sigue traduciendo,
 * pero con calma, hasta cubrir el video ENTERO (2026-10-06): con solo 3 min por
 * delante, una racha de 429 de pocos minutos dejaba el subtítulo vacío y la voz
 * muda (simulado: 4 min de 429 → 90 s de video detenido esperando).
 */
export const HORIZONTE_TRADUCCION_S = 180;
/**
 * Voz preparada por delante. Con 90 s, una caída del proveedor de 2 min dejaba
 * 101 s de inglés en un video de 70 min (simulado, test_doblaje_video_largo).
 * El límite de 18 síntesis/min sigue mandando: el colchón crece despacio.
 */
export const HORIZONTE_VOZ_S = 300;
// 6 s de voz lista bastan para arrancar (en la práctica, la primera frase): la
// preparación va mucho más rápido que el video (≈1 s por lote de traducción,
// ≈1 s por frase de voz) y, si un tramo no llega a tiempo, el motor v4 lo espera
// con el audio original y lo dice entero al llegar, sin cortar nada. Medido en
// producción (2026-09-26): con 10 s, en un video real hacían falta TRES frases
// (la tercera empezaba en 9,0 s) y tres lotes de traducción antes del primer sonido.
export const VOZ_INICIAL_S = 6;
export const MARGEN_ATRAS_S = 2;
// Una voz que falló (proveedor caído justo al abrir) quedaba en inglés para
// siempre: nada la volvía a pedir. Se reintenta en segundo plano, con tope
// para no quemar cuota si el proveedor sigue caído (medido 2026-10-02 con un
// video del equipo: las primeras 5–6 frases sonaron en inglés y luego entró).
//
// v171: los reintentos se ESPACIAN (una caída de minutos agotaba los 2 en
// segundos y la frase quedaba en inglés aunque el proveedor volviera al rato).
export const MAX_REINTENTOS_VOZ = 6;
/** Espera antes de cada reintento de una voz fallida (ms). */
export const PAUSAS_REINTENTO_VOZ_MS = [3000, 8000, 15000, 30000, 45000, 60000];
// Lote corto cuando no hay nada traducido cerca: la IA contesta antes con 4
// segmentos que con 8 (2,4 s medidos en el primer lote de un video real).
export const LOTE_ARRANQUE = 4;

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
export function siguienteLoteTraduccion(segmentos, { traducido, enCurso }, posicionS, {
  horizonteS = HORIZONTE_TRADUCCION_S, maxSegmentos = MAX_SEGMENTOS_POR_LOTE,
} = {}) {
  const limite = posicionS + horizonteS;
  let i = indiceDesde(segmentos, Math.max(0, posicionS - MARGEN_ATRAS_S));
  while (i < segmentos.length && (traducido(i) || enCurso(i))) i += 1;
  if (i >= segmentos.length || segmentos[i].startTime > limite) return null;
  const lote = [];
  let caracteres = 0;
  for (; i < segmentos.length; i += 1) {
    if (traducido(i) || enCurso(i)) break;
    const pieza = piezaDeLote(i, segmentos[i].text);
    if (lote.length && (lote.length >= maxSegmentos || caracteres + pieza.length > MAX_CHARS_POR_LOTE)) break;
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
export function unidadesAGenerar(unidades, posicionS, { horizonteS = HORIZONTE_VOZ_S, limite = 2, ahoraMs = Date.now() } = {}) {
  const fin = posicionS + horizonteS;
  const salida = [];
  const reintentable = (u) => u.estado === 'pendiente'
    || (u.estado === 'error' && vozReintentable(u) && !(Number(u.reintentarEn) > ahoraMs));
  for (let i = indiceDesde(unidades, posicionS); i < unidades.length && salida.length < limite; i += 1) {
    if (unidades[i].startTime > fin) break;
    if (reintentable(unidades[i])) salida.push(i);
  }
  return salida;
}

/** ¿A esta voz fallida le quedan reintentos? (Si no, suena en su idioma original.) */
export function vozReintentable(unidad) {
  return (Number(unidad?.reintentosVoz) || 0) < MAX_REINTENTOS_VOZ;
}

/** Cuándo (ms) puede reintentarse una voz que acaba de fallar por `n`-ésima vez. */
export function proximoReintentoVoz(n, ahoraMs = Date.now()) {
  const pausas = PAUSAS_REINTENTO_VOZ_MS;
  return ahoraMs + pausas[Math.min(Math.max(1, n), pausas.length) - 1];
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
