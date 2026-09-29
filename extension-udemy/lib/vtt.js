import { normalizarSegmentos } from '../motor/transcriptionService.js';

function segundos(valor) {
  const partes = valor.split(':').map(Number);
  if (partes.some((v) => !Number.isFinite(v))) return NaN;
  return partes.reduce((total, v) => total * 60 + v, 0);
}

function limpiarTexto(texto) {
  const entidades = { amp: '&', gt: '>', lt: '<', quot: '"', apos: "'", nbsp: ' ' };
  return String(texto).replace(/<[^>]*>/g, '').replace(/&(#x[\da-f]+|#\d+|\w+);/gi, (entidad, clave) => {
    if (clave[0] !== '#') return entidades[clave.toLowerCase()] ?? entidad;
    const numero = clave[1].toLowerCase() === 'x' ? parseInt(clave.slice(2), 16) : Number(clave.slice(1));
    return numero > 0 && numero <= 0x10ffff ? String.fromCodePoint(numero) : '';
  }).replace(/\s+/g, ' ').trim();
}

export function leerVtt(texto) {
  const segmentos = [];
  const bloques = String(texto).replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').split(/\n\s*\n/);
  for (const bloque of bloques) {
    if (/^(?:WEBVTT|NOTE|STYLE|REGION)\b/.test(bloque.trim())) continue;
    const lineas = bloque.split('\n');
    const indice = lineas.findIndex((l) => l.includes('-->'));
    if (indice < 0) continue;
    const tiempos = lineas[indice].match(/^\s*((?:\d+:)?\d{2}:\d{2}\.\d{3})\s+-->\s+((?:\d+:)?\d{2}:\d{2}\.\d{3})/);
    if (!tiempos) continue;
    const startTime = segundos(tiempos[1]), endTime = segundos(tiempos[2]);
    const text = limpiarTexto(lineas.slice(indice + 1).join(' '));
    if (text && endTime > startTime) segmentos.push({ startTime, endTime, text });
  }
  return normalizarSegmentos(segmentos);
}

export function segmentosDesdeTextTrack(pista) {
  return normalizarSegmentos([...pista.cues || []].map((cue) => ({
    startTime: cue.startTime, endTime: cue.endTime, text: limpiarTexto(cue.text),
  })));
}
