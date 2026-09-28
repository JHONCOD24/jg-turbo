/**
 * Carga diferida de Mediabunny (js/vendor/mediabunny/, MPL-2.0): solo cuando la
 * persona pide una descarga. Quien solo abre la app no descarga nada de esto
 * (tests/verificar_arranque_ligero.mjs).
 *
 * Las extensiones MP3 y AAC importan «mediabunny» por nombre; al guardarlas en
 * vendor se cambió ese import por './mediabunny.min.mjs'. Tienen que registrar
 * su codificador en la MISMA copia de la librería que usa este módulo: con dos
 * copias, el registro no se ve y el MP3 falla con «codec not supported».
 */
export const RUTA_MEDIOS = '/js/vendor/mediabunny/';
let promesa = null;

export function cargarMedios(ruta = RUTA_MEDIOS) {
  if (!promesa) {
    promesa = import(`${ruta}mediabunny.min.mjs`).catch((error) => {
      promesa = null;
      throw new Error(`No se pudo cargar el generador de archivos: ${error?.message || error}`);
    });
  }
  return promesa;
}

/** Ningún navegador codifica MP3 por sí mismo (medido en Chrome 2026-09-28): siempre hace falta la extensión. */
export async function asegurarMp3(mb, ruta = RUTA_MEDIOS) {
  if (await mb.canEncodeAudio('mp3')) return;
  const { registerMp3Encoder } = await import(`${ruta}mediabunny-mp3-encoder.mjs`);
  registerMp3Encoder();
}

/** Chrome codifica AAC; Firefox y Chromium sin códecs no: ahí entra la extensión (≈ 1 MB). */
export async function asegurarAac(mb, ruta = RUTA_MEDIOS) {
  if (await mb.canEncodeAudio('aac')) return;
  const { registerAacEncoder } = await import(`${ruta}mediabunny-aac-encoder.mjs`);
  registerAacEncoder();
}
