/**
 * Dónde empieza y dónde termina lo que se OYE dentro del audio de una frase.
 *
 * Medido el 2026-09-28 contra producción: edge-tts y Azure entregan cada frase
 * con ~0,21 s de silencio delante y ~0,85 s detrás (5,54 s de audio → 4,48 s de
 * voz; el mismo corte a -45, -60 y -70 dB, así que es silencio digital, no una
 * «s» final débil). Sin recortarlo, el doblaje esperaba ese silencio antes de
 * pasar a la frase siguiente y lo contaba como voz por decir: frenaba el video
 * de más y la voz arrancaba 0,2 s tarde respecto a los labios.
 *
 * `limitesDeHabla` es pura (se prueba en Node); `medirHabla` decodifica un Blob
 * en el navegador y devuelve null donde no se puede (entonces no se recorta).
 */
export const UMBRAL_SILENCIO = 0.001;   // -60 dB
/** Se deja un poco antes y después: el ataque y la caída de la voz no se tocan. */
export const MARGEN_ANTES_S = 0.02;
export const MARGEN_DESPUES_S = 0.08;
const VENTANA_S = 0.01;
const redondear = (s) => Math.round(s * 1000) / 1000;

export function limitesDeHabla(muestras, hz, {
  umbral = UMBRAL_SILENCIO, margenAntesS = MARGEN_ANTES_S, margenDespuesS = MARGEN_DESPUES_S,
} = {}) {
  const n = muestras?.length || 0;
  if (!n || !(hz > 0)) return null;
  const paso = Math.max(1, Math.round(hz * VENTANA_S));
  const suena = (desde) => {
    const hasta = Math.min(n, desde + paso);
    let suma = 0;
    for (let i = desde; i < hasta; i += 1) suma += muestras[i] * muestras[i];
    return Math.sqrt(suma / Math.max(1, hasta - desde)) > umbral;
  };
  let primera = -1;
  for (let i = 0; i < n; i += paso) if (suena(i)) { primera = i; break; }
  if (primera < 0) return null;   // todo silencio: mejor no recortar nada
  let ultima = n;
  for (let i = Math.floor((n - 1) / paso) * paso; i >= primera; i -= paso) {
    if (suena(i)) { ultima = Math.min(n, i + paso); break; }
  }
  const duracionS = n / hz;
  return {
    duracionS: redondear(duracionS),
    desdeS: redondear(Math.max(0, primera / hz - margenAntesS)),
    hastaS: redondear(Math.min(duracionS, ultima / hz + margenDespuesS)),
  };
}

/** Recorte de un audio ya decodificado (AudioBuffer). Sin datos, el audio entero. */
export function limitesDeBuffer(buffer) {
  const duracion = Number(buffer?.duration) || 0;
  const entero = { duracionS: duracion, desdeS: 0, hastaS: duracion };
  if (typeof buffer?.getChannelData !== 'function') return entero;
  return limitesDeHabla(buffer.getChannelData(0), buffer.sampleRate) || entero;
}

/** `{ duracionS, desdeS, hastaS }` de un Blob de voz, o null (sin Web Audio o sin decodificar). */
export async function medirHabla(blob) {
  const Contexto = globalThis.OfflineAudioContext || globalThis.webkitOfflineAudioContext;
  if (!Contexto || !(blob?.size > 0)) return null;
  try {
    const buffer = await new Contexto(1, 1, 44100).decodeAudioData(await blob.arrayBuffer());
    return limitesDeHabla(buffer.getChannelData(0), buffer.sampleRate);
  } catch (_) {
    return null;
  }
}
