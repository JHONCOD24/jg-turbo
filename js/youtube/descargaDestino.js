/**
 * Descargas de la biblioteca: qué se puede bajar, cuánto pesa y adónde va.
 *
 * Chrome/Edge de escritorio escriben directo al disco (`showSaveFilePicker`):
 * sin tope práctico. En los demás el archivo se arma en memoria antes de
 * guardarse; por encima del límite el teléfono se queda sin memoria, así que
 * se ofrece una calidad menor en vez de fallar a mitad.
 */
export const MB = 1024 * 1024;
export const LIMITE_MEMORIA_BYTES = Object.freeze({ movil: 250 * MB, escritorio: 1500 * MB });
export const BITRATE_AUDIO_DOBLADO = 128000;
export const BITRATE_MP3 = 64000;
export const ALTOS_OFRECIDOS = Object.freeze([360, 480, 720, 1080]);

/** Tamaño de un MP4 de X: el `bitrate` de la variante ya incluye el audio (medido: techo, no exacto). */
export function estimarBytesVideo(bitrate, duracionS) {
  return Math.round(((Number(bitrate) || 0) / 8) * (Number(duracionS) || 0));
}

export function estimarBytesMp3(duracionS, bitrate = BITRATE_MP3) {
  return Math.round((bitrate / 8) * (Number(duracionS) || 0));
}

/** Calidades del video original de X, de menor a mayor, sin repetir alturas. */
export function opcionesCalidadX(variantes, duracionS) {
  const porAlto = new Map();
  for (const v of Array.isArray(variantes) ? variantes : []) {
    const lado = Math.min(Number(v.ancho) || 0, Number(v.alto) || 0);
    const alto = ALTOS_OFRECIDOS.find((a) => lado > 0 && lado <= a + 10);
    if (!alto || !v.url) continue;
    const previa = porAlto.get(alto);
    if (!previa || (Number(v.bitrate) || 0) > previa.bitrate) {
      porAlto.set(alto, { etiqueta: `${alto}p`, alto, url: v.url, bitrate: Number(v.bitrate) || 0 });
    }
  }
  return [...porAlto.values()]
    .sort((a, b) => a.alto - b.alto)
    .map((o) => ({ ...o, bytes: estimarBytesVideo(o.bitrate, duracionS) }));
}

/**
 * `tipo`: 'disco' (se escribe a medida que se genera) · 'memoria' (cabe) ·
 * 'grande' (no cabe en memoria en este equipo: ofrecer menos calidad).
 */
export function elegirDestino({ puedeGuardarEnDisco = false, esMovil = false, bytesEstimados = 0 } = {}) {
  if (puedeGuardarEnDisco && !esMovil) return { tipo: 'disco', limite: Infinity };
  const limite = esMovil ? LIMITE_MEMORIA_BYTES.movil : LIMITE_MEMORIA_BYTES.escritorio;
  return { tipo: bytesEstimados <= limite ? 'memoria' : 'grande', limite };
}

/** La mejor calidad que cabe en memoria (o la más baja si ninguna cabe). */
export function calidadQueCabe(opciones, limiteBytes) {
  const lista = Array.isArray(opciones) ? opciones : [];
  const caben = lista.filter((o) => o.bytes <= limiteBytes);
  return caben.length ? caben[caben.length - 1] : lista[0] || null;
}

export function formatearBytes(bytes) {
  const b = Number(bytes) || 0;
  if (b >= 1024 * MB) return `${(b / (1024 * MB)).toFixed(1).replace('.', ',')} GB`;
  if (b >= MB) return `${Math.round(b / MB)} MB`;
  return `${Math.max(1, Math.round(b / 1024))} KB`;
}

export function nombreArchivo({ titulo = '', plataforma = 'youtube', tipo = 'doblado', extension = 'mp4' } = {}) {
  const base = String(titulo).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60).replace(/-+$/, '') || 'video';
  const sufijo = { original: 'original', doblado: 'doblado-es', audio: 'audio-es' }[tipo] || tipo;
  return `jg-turbo-${plataforma === 'x' ? 'x' : 'youtube'}-${base}-${sufijo}.${extension}`;
}
