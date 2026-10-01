/**
 * Videos del equipo: reglas puras (sin Mediabunny ni DOM) para probarlas en Node.
 *
 * El video NUNCA se copia a la app (decisión del dueño, 2026-10-01): se guarda su
 * texto, traducción y voz con una huella del archivo como clave; para volver a
 * verlo se elige otra vez el mismo archivo y la huella lo reconoce.
 *
 * Medido el 2026-10-01 (Chrome, este PC; docs/video-local/MEDICIONES.md):
 *  - recodificar 60 min de audio a MP3 16 kHz mono 32 kbps: 16,7 s (≈ 9 s por
 *    parte de 6 min con la CPU 4× más lenta, como un teléfono);
 *  - copiar el audio sin recodificar: 0,6 s para 60 min, pero 51 MB a subir;
 *  - Whisper de producción aceptó MP3, Ogg/Opus, AAC (.m4a) y AC-3 copiado en MP4.
 */
import { BYTES_MAX_PARTE } from './transcripcionPartes.js';

export const PREFIJO_CLAVE = 'archivo:';
export const MAX_DURACION_S = 3 * 60 * 60;
export const TROZO_MAX_S = 360;          // MP3 32 kbps: 1,44 MB por parte (medido)
export const SOLAPE_S = 12;              // como X: ~4 trozos HLS de 3 s
export const TROZO_MIN_COPIA_S = 30;
export const MARGEN_BITRATE = 1.15;      // el audio VBR puede pasar su promedio
export const BYTES_HUELLA = 1024 * 1024; // 1 MiB del principio + 1 MiB del final (16 ms medido)
export const EXTENSIONES_VIDEO = Object.freeze(['mp4', 'm4v', 'mov', 'mkv', 'webm']);
/** Códecs de audio que Whisper acepta copiados tal cual (AC-3 medido en producción). */
export const COPIABLES = Object.freeze({
  aac: 'mp4', mp3: 'mp4', opus: 'mp4', flac: 'mp4', ac3: 'mp4', eac3: 'mp4', vorbis: 'webm',
});

const extension = (nombre) => (String(nombre || '').toLowerCase().match(/\.([a-z0-9]{2,5})$/) || [])[1] || '';

/** `codigo`: '' · 'vacio' · 'no_es_video'. */
export function validarArchivo(archivo) {
  if (!archivo || !Number(archivo.size)) {
    return { ok: false, codigo: 'vacio', motivo: 'Ese archivo está vacío. Elige otro video.' };
  }
  const tipo = String(archivo.type || '').toLowerCase();
  const ext = extension(archivo.name);
  if (tipo.startsWith('audio/') || (!tipo.startsWith('video/') && !EXTENSIONES_VIDEO.includes(ext))) {
    return {
      ok: false,
      codigo: 'no_es_video',
      motivo: 'Eso no parece un video (MP4, MOV, MKV o WebM). Para un audio usa la pestaña Archivo.',
    };
  }
  return { ok: true, codigo: '', motivo: '' };
}

/**
 * Huella estable del archivo: tamaño + 1 MiB del principio + 1 MiB del final.
 * No usa nombre ni fecha: renombrar o mover el archivo no pierde su doblaje.
 */
export async function huellaArchivo(archivo, { subtle = globalThis.crypto?.subtle } = {}) {
  const tam = Number(archivo.size) || 0;
  const partes = [String(tam), archivo.slice(0, Math.min(tam, BYTES_HUELLA))];
  if (tam > BYTES_HUELLA) partes.push(archivo.slice(Math.max(BYTES_HUELLA, tam - BYTES_HUELLA)));
  const bytes = await new Blob(partes).arrayBuffer();
  const resumen = new Uint8Array(await subtle.digest('SHA-256', bytes));
  return PREFIJO_CLAVE + [...resumen.slice(0, 8)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export const esClaveArchivo = (clave) => String(clave || '').startsWith(PREFIJO_CLAVE);

/**
 * Partes por tiempo con solape, en la forma que `unirTranscripciones` (audioX.js)
 * ya sabe unir: cada parte k > 0 descarta lo que empieza antes de su `limiteS`.
 */
export function planearTrozosTiempo(duracionS, { maxS = TROZO_MAX_S, solapeS = SOLAPE_S } = {}) {
  const total = Math.max(0, Number(duracionS) || 0);
  if (!total) return [];
  const solape = Math.min(solapeS, maxS / 4);   // partes cortas: el solape no se come el avance
  const paso = Math.max(1, maxS - solape);
  const trozos = [];
  for (let inicio = 0; ; inicio += paso) {
    const fin = Math.min(total, inicio + maxS);
    trozos.push({
      inicioS: inicio,
      finS: Math.round(fin * 1000) / 1000,
      limiteS: inicio === 0 ? 0 : inicio + solape / 2,
    });
    if (fin >= total || total - (inicio + paso) <= solape) {
      trozos[trozos.length - 1].finS = Math.round(total * 1000) / 1000;
      break;
    }
  }
  return trozos;
}

/**
 * Cómo sacar el audio para Whisper.
 *  - 'mp3': el navegador decodifica el audio → MP3 16 kHz mono 32 kbps (partes de 6 min, ~1,4 MB).
 *  - 'copia': no lo decodifica (p. ej. AC-3 en Chrome) → se copia tal cual en partes
 *    que quepan en 3,2 MB según su tasa de bits.
 *  - 'imposible': ni lo uno ni lo otro: se explica.
 */
export function elegirModoExtraccion({ codec = '', decodifica = false, bitrate = 0 } = {}) {
  if (decodifica) return { modo: 'mp3', trozoS: TROZO_MAX_S, contenedor: 'mp3' };
  const contenedor = COPIABLES[codec];
  if (!contenedor) {
    return { modo: 'imposible', trozoS: 0, contenedor: '', motivo: `Este navegador no puede leer el audio de este video (${codec || 'formato desconocido'}). Prueba en Chrome de computador o conviértelo a MP4.` };
  }
  const bps = Number(bitrate) > 0 ? Number(bitrate) * MARGEN_BITRATE : 192000 * MARGEN_BITRATE;
  const trozoS = Math.floor((BYTES_MAX_PARTE * 8) / bps);
  if (trozoS < TROZO_MIN_COPIA_S) {
    return { modo: 'imposible', trozoS: 0, contenedor: '', motivo: 'El audio de este video es demasiado pesado para enviarlo por partes. Conviértelo a MP4 (AAC) e inténtalo otra vez.' };
  }
  return { modo: 'copia', trozoS: Math.min(TROZO_MAX_S, trozoS), contenedor };
}

/** «clase_03-intro.al.prompting.mp4» → «Clase 03 intro al prompting». */
export function tituloDeArchivo(nombre) {
  const base = String(nombre || '').replace(/\.[a-z0-9]{2,5}$/i, '')
    .replace(/[_.]+/g, ' ').replace(/\s*-\s*/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120).trim();
  if (!base) return 'Video de tu equipo';
  return base.charAt(0).toLocaleUpperCase('es') + base.slice(1);
}

/** Lo que se dice ANTES de empezar (principio «decir la verdad sobre lo que cuesta»). */
export function resumenAntesDeEmpezar({ duracionS = 0, modo = 'mp3', trozoS = TROZO_MAX_S } = {}) {
  const partes = Math.max(1, Math.ceil((Number(duracionS) || 0) / Math.max(1, trozoS - SOLAPE_S)));
  const minutos = Math.max(1, Math.round((Number(duracionS) || 0) / 60));
  const como = modo === 'copia' ? 'copiando su audio' : 'sacando su audio aquí mismo';
  return `Video de ${minutos} min: lo escuchamos ${como} y lo transcribimos en ${partes} ${partes === 1 ? 'parte' : 'partes'} (gratis). El video no sale de tu equipo; solo viaja el audio.`;
}
