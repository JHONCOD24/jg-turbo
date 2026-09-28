/**
 * Pista de voz en español para un ARCHIVO (MP3 o MP4 doblado): dónde empieza
 * cada frase y a qué velocidad, con los tiempos del video original.
 *
 * En vivo, si el español no cabe, el video se frena (dubbingEngine). Un
 * archivo no puede frenar el video: la frase que no cabe en su espacio se
 * vuelve a pedir más rápida (la API aplica `rate` con prosodia: no cambia el
 * tono; medido 2026-09-28: a 1,2× la frase dura 16 % menos) hasta 1,25×, la
 * velocidad más alta que el doblaje en vivo considera cómoda. Si ni así cabe,
 * empuja a la siguiente y queda contada en `corridas`.
 */
export const TASA_MAX = 1.25;
export const PASO_TASA = 0.05;
export const RESPIRO_S = 0.08;
export const VENTANA_MEZCLA_S = 30;
export const CUOTA_AZURE_MES = 500000;
const redondear = (s) => Math.round(s * 1000) / 1000;

export function tasaNecesaria(duracionVoz, espacioS, tasaMax = TASA_MAX) {
  const voz = Number(duracionVoz) || 0;
  if (voz <= 0) return 1;
  if (!(espacioS > 0)) return tasaMax;
  const bruta = voz / espacioS;
  if (bruta <= 1) return 1;
  return Math.min(tasaMax, Math.round(Math.ceil(bruta / PASO_TASA - 1e-9) * PASO_TASA * 100) / 100);
}

/**
 * `unidades`: [{ indice, startTime, duracionVoz, tasa? }] en orden. Con
 * `acelerar: false` se respeta la `tasa` que ya trae cada frase (segunda
 * pasada, con la duración real del audio ya acelerado).
 */
export function planearPista(unidades, { duracionVideoS = Infinity, acelerar = true, tasaMax = TASA_MAX } = {}) {
  const lista = Array.isArray(unidades) ? unidades : [];
  const plan = [];
  let finAnterior = 0;
  let corridas = 0;
  let maxRetrasoS = 0;
  lista.forEach((unidad, k) => {
    const siguiente = lista[k + 1];
    const limite = siguiente ? Number(siguiente.startTime) : duracionVideoS;
    const inicio = Math.max(Number(unidad.startTime) || 0, k ? finAnterior + RESPIRO_S : 0);
    const tasa = acelerar ? tasaNecesaria(unidad.duracionVoz, limite - inicio, tasaMax) : (Number(unidad.tasa) || 1);
    const duracion = acelerar ? (Number(unidad.duracionVoz) || 0) / tasa : (Number(unidad.duracionVoz) || 0);
    const fin = inicio + duracion;
    if (fin > limite + 1e-6) corridas += 1;
    maxRetrasoS = Math.max(maxRetrasoS, inicio - (Number(unidad.startTime) || 0));
    plan.push({ indice: unidad.indice, inicioS: redondear(inicio), tasa, duracionS: redondear(duracion), finS: redondear(fin) });
    finAnterior = fin;
  });
  const cierre = Number.isFinite(duracionVideoS) ? Math.max(finAnterior, duracionVideoS) : finAnterior;
  return { plan, corridas, maxRetrasoS: redondear(maxRetrasoS), duracionS: redondear(cierre) };
}

/** Ventanas de mezcla: se renderiza de a 30 s para no tener la hora entera en memoria. */
export function ventanasDeMezcla(duracionS, tamanoS = VENTANA_MEZCLA_S) {
  const total = Math.max(0, Number(duracionS) || 0);
  const ventanas = [];
  for (let desde = 0; desde < total; desde += tamanoS) {
    ventanas.push({ desdeS: redondear(desde), hastaS: redondear(Math.min(total, desde + tamanoS)) });
  }
  return ventanas;
}

/** Frases que suenan (aunque sea en parte) dentro de una ventana. */
export function frasesEnVentana(plan, desdeS, hastaS) {
  return (plan || []).filter((f) => f.inicioS < hastaS && f.finS > desdeS);
}

/** Lo que se muestra ANTES de pedir el «sí» (PRODUCT.md: decir la verdad sobre lo que cuesta). */
export function resumenCosto(textos) {
  const caracteres = (textos || []).reduce((suma, t) => suma + String(t || '').length, 0);
  return {
    frases: (textos || []).filter((t) => String(t || '').trim()).length,
    caracteres,
    porcentajeAzureMes: Math.round((caracteres / CUOTA_AZURE_MES) * 1000) / 10,
  };
}
