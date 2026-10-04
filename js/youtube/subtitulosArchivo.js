// js/youtube/subtitulosArchivo.js
/**
 * Subtítulos (.srt/.vtt) que trae la persona junto a su video: texto exacto y
 * sin gastar transcripción (mejora 1 del doblaje de videos del equipo).
 *
 * Puro y probado en Node: parsear, tildes y validación no necesitan navegador.
 * Si el archivo marca quién habla (`>>`, «— Ana», «Ana: …»), `normalizarSegmentos`
 * lo detecta y la 2.ª voz entra sola, como en YouTube.
 */
import { ErrorYoutube, normalizarSegmentos } from './transcriptionService.js';
import { MAX_DURACION_S } from './archivoLocal.js';

/** Un .srt de 3 h pesa ~200 KB: con 2 MB sobra y no se lee basura infinita. */
export const MAX_BYTES_SRT = 2 * 1024 * 1024;

const esNombreSubtitulo = (nombre) => /\.(srt|vtt)$/i.test(String(nombre || ''));

const RE_TIEMPO = /^(?:(\d+):)?(\d{1,2}):(\d{2})[,.](\d{1,3})(?:\s+.*)?$/;
function aSegundos(texto) {
  const m = RE_TIEMPO.exec(String(texto || '').trim());
  if (!m) return NaN;
  const [, h = '0', min, seg, ms] = m;
  if (Number(min) >= 60 || Number(seg) >= 60) return NaN;
  return Number(h) * 3600 + Number(min) * 60 + Number(seg) + Number(ms.padEnd(3, '0')) / 1000;
}

const sinEtiquetas = (texto) => String(texto || '').replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();

function bloques(texto) {
  return String(texto || '')
    .replace(/^\uFEFF/, '')
    .replace(/\r\n?/g, '\n')
    .split(/\n{2,}/)
    .map((b) => b.split('\n').map((l) => l.trim()).filter(Boolean))
    .filter((lineas) => lineas.length);
}

/** Un bloque SRT: [índice] + tiempos + texto. Devuelve null si no es bloque. */
function bloqueSRT(lineas) {
  const resto = /^\d+$/.test(lineas[0] || '') ? lineas.slice(1) : lineas;
  if (resto.length < 2 || !resto[0].includes('-->')) return null;
  const [ini, fin] = resto[0].split('-->').map(aSegundos);
  if (!Number.isFinite(ini) || !Number.isFinite(fin) || fin <= ini) return null;
  // Las marcas de quién habla (>>, «Ana:») se conservan para la 2.ª voz;
  // las etiquetas (<i>, <font>) se quitan aquí (la limpieza general no las toca).
  const texto = sinEtiquetas(resto.slice(1).join(' '));
  if (!texto) return null;
  return { start: ini, end: fin, text: texto };
}

export function parsearSRT(texto) {
  const cues = [];
  for (const lineas of bloques(texto)) {
    const cue = bloqueSRT(lineas);
    if (cue) cues.push(cue);
  }
  return cues;
}

/** Un bloque VTT: [identificador] + tiempos + texto; NOTE/STYLE/REGION se saltan. */
function bloqueVTT(lineas) {
  const sinCabeza = /^(NOTE|STYLE|REGION)(?:\s|$)/i.test(lineas[0] || '') ? [] : lineas;
  const tiempos = sinCabeza.findIndex((l) => l.includes('-->'));
  if (tiempos < 0) return null;
  // La línea puede traer ajustes detrás (align:start): aSegundos busca el tiempo dentro.
  const [ini, fin] = sinCabeza[tiempos].split('-->').map(aSegundos);
  if (!Number.isFinite(ini) || !Number.isFinite(fin) || fin <= ini) return null;
  const texto = sinEtiquetas(sinCabeza.slice(tiempos + 1).join(' '));
  if (!texto) return null;
  return { start: ini, end: fin, text: texto };
}

export function parsearVTT(texto) {
  const cues = [];
  for (const lineas of bloques(texto)) {
    if (/^WEBVTT/i.test(lineas[0] || '')) {
      const resto = lineas.slice(1);
      if (!resto.length) continue;
      const cue = bloqueVTT(resto);
      if (cue) cues.push(cue);
      continue;
    }
    const cue = bloqueVTT(lineas);
    if (cue) cues.push(cue);
  }
  return cues;
}

export function detectarFormatoSubtitulo(nombre, texto) {
  if (/\.vtt$/i.test(String(nombre || ''))) return 'vtt';
  if (/\.srt$/i.test(String(nombre || ''))) return 'srt';
  const muestra = String(texto || '').slice(0, 1000);
  if (/^WEBVTT/m.test(muestra)) return 'vtt';
  if (!muestra.includes('-->')) return '';
  // El SRT separa milisegundos con coma (00:00:01,000); el VTT con punto.
  return /,\d{3}/.test(muestra) ? 'srt' : 'vtt';
}

/**
 * Lee el texto de un .srt/.vtt (límite 2 MB). Muchos salen de Windows en
 * Latin-1: si no es UTF-8 válido se lee como windows-1252 para no romper tildes.
 */
export async function leerTextoSubtitulo(archivo) {
  const tam = Number(archivo?.size) || 0;
  if (!tam) throw new ErrorYoutube('Ese archivo de subtítulos está vacío.', 'srt_vacio');
  if (tam > MAX_BYTES_SRT) {
    throw new ErrorYoutube('Ese archivo de subtítulos es demasiado grande (máximo 2 MB).', 'srt_grande');
  }
  if (!esNombreSubtitulo(archivo?.name)) {
    throw new ErrorYoutube('Eso no parece un archivo de subtítulos (.srt o .vtt).', 'srt_no_es');
  }
  const bytes = new Uint8Array(await archivo.arrayBuffer());
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(bytes);
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be').decode(bytes);
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch (_) {
    return new TextDecoder('windows-1252').decode(bytes);
  }
}

/**
 * Del archivo al texto con tiempos, en la forma del doblaje. `nombre` decide el
 * formato (.srt/.vtt); si la extensión falta, se adivina por el contenido.
 * Los errores traen código srt_* con mensaje para mostrar tal cual.
 */
export function segmentosDesdeSubtitulos(texto, nombre) {
  const formato = detectarFormatoSubtitulo(nombre, texto);
  if (!formato) throw new ErrorYoutube('No reconocimos esos subtítulos. Usa un .srt o un .vtt.', 'srt_formato');
  const crudos = formato === 'srt' ? parsearSRT(texto) : parsearVTT(texto);
  const declarados = bloques(texto).filter((ls) => !/^(NOTE|STYLE|REGION)(?:\s|$)/i.test(ls[0]) && ls.some((l) => l.includes('-->'))).length;
  if (crudos.length !== declarados) {
    throw new ErrorYoutube('Hay frases con tiempos o texto inválidos en esos subtítulos. Corrige el archivo y vuelve a elegirlo.', 'srt_formato');
  }
  const segmentos = normalizarSegmentos(crudos);
  if (!segmentos.length) {
    throw new ErrorYoutube('No encontramos frases en esos subtítulos. Revisa que sea un .srt o .vtt válido.', 'srt_formato');
  }
  const fin = segmentos[segmentos.length - 1].endTime;
  if (fin > MAX_DURACION_S) {
    throw new ErrorYoutube(`Esos subtítulos duran ${Math.round(fin / 60)} min. Por ahora se doblan videos de hasta ${MAX_DURACION_S / 3600} horas.`, 'srt_largo');
  }
  return { segmentos, formato };
}

/** Rechaza otro episodio o una línea fuera del video antes de traducir o sintetizar. */
export function validarSubtitulosParaVideo(segmentos, duracionS) {
  const fin = Math.max(0, ...segmentos.map((s) => s.endTime));
  if (duracionS > 0 && fin > duracionS + 2) {
    throw new ErrorYoutube('Los subtítulos llegan más allá del final del video. Elige los subtítulos de este mismo video.', 'srt_video');
  }
}
