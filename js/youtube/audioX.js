/**
 * Audio de un video de X para transcribirlo, en partes que caben en una petición.
 *
 * X publica cada video también como HLS con pistas de SOLO audio (32/64/128 kbps,
 * trozos fMP4 de ~3 s). El inicial (EXT-X-MAP) + trozos seguidos, concatenados,
 * forman un .m4a válido que Whisper transcribe (medido 2026-09-27: 60 s de audio
 * → 2,5 s en /api/transcribe). El troceo vive en el navegador: Vercel rechaza
 * cuerpos de más de ~4,5 MB y corta la función a los 60 s.
 */
export const KBPS_PREFERIDOS = Object.freeze([64000, 32000, 128000]);   // 64k: 32k cortó palabras (medido)
export const TROZO_MAX_S = 360;
export const BYTES_MAX_TROZO = 3.2 * 1024 * 1024;
export const SOLAPE_SEGMENTOS = 4;
const ORIGEN_TWIMG = 'https://video.twimg.com';
const redondear = (s) => Math.round(s * 1000) / 1000;

/** URL absoluta de video.twimg.com; cualquier otro destino se rechaza. */
export function urlTwimg(ruta, base = ORIGEN_TWIMG) {
  const url = new URL(String(ruta || ''), base);
  if (url.protocol !== 'https:' || url.hostname !== 'video.twimg.com') {
    throw new Error('El audio del video no viene de video.twimg.com.');
  }
  return url.href;
}

export function elegirPistaAudio(maestra, preferidos = KBPS_PREFERIDOS) {
  const pistas = [];
  for (const linea of String(maestra || '').split(/\r?\n/)) {
    if (!linea.startsWith('#EXT-X-MEDIA:') || !linea.includes('TYPE=AUDIO')) continue;
    const uri = (linea.match(/URI="([^"]+)"/) || [])[1];
    if (!uri) continue;
    const kbps = Number((uri.match(/\/mp4a\/(\d+)\//) || [])[1])
      || Number((linea.match(/GROUP-ID="audio-(\d+)"/) || [])[1]) || 0;
    pistas.push({ uri, kbps });
  }
  for (const kbps of preferidos) {
    const pista = pistas.find((p) => p.kbps === kbps);
    if (pista) return pista;
  }
  return pistas[0] || null;
}

export function leerListaAudio(texto) {
  const lineas = String(texto || '').split(/\r?\n/).map((l) => l.trim());
  const init = (lineas.find((l) => l.startsWith('#EXT-X-MAP:'))?.match(/URI="([^"]+)"/) || [])[1] || '';
  const segmentos = [];
  let t = 0;
  for (let i = 0; i < lineas.length; i += 1) {
    if (!lineas[i].startsWith('#EXTINF:')) continue;
    const duracionS = parseFloat(lineas[i].slice(8));
    const uri = lineas[i + 1];
    if (!uri || uri.startsWith('#') || !Number.isFinite(duracionS)) continue;
    segmentos.push({ uri, inicioS: redondear(t), duracionS });
    t += duracionS;
  }
  return { init, segmentos, duracionS: redondear(t) };
}

export function duracionMaximaTrozo(kbps) {
  const bitsPorSegundo = Number(kbps) > 0 ? Number(kbps) : 64000;
  return Math.min(TROZO_MAX_S, Math.floor((BYTES_MAX_TROZO * 8) / bitsPorSegundo));
}

export function planearTrozos(segmentos, { maxS = TROZO_MAX_S, solape = SOLAPE_SEGMENTOS } = {}) {
  const trozos = [];
  let desde = 0;
  while (desde < segmentos.length) {
    let hasta = desde;
    let duracion = 0;
    while (hasta < segmentos.length && (hasta === desde || duracion + segmentos[hasta].duracionS <= maxS)) {
      duracion += segmentos[hasta].duracionS;
      hasta += 1;
    }
    trozos.push({ desde, hasta, inicioS: segmentos[desde].inicioS, limiteS: 0 });
    if (hasta >= segmentos.length) break;
    desde = Math.max(desde + 1, hasta - solape);   // siempre avanza
  }
  for (let k = 1; k < trozos.length; k += 1) {
    const compartidos = Math.max(0, trozos[k - 1].hasta - trozos[k].desde);
    trozos[k].limiteS = segmentos[trozos[k].desde + Math.floor(compartidos / 2)].inicioS;
  }
  return trozos;
}

export function unirTranscripciones(trozos, resultados) {
  const salida = [];
  let ultimoFin = -Infinity;
  trozos.forEach((trozo, k) => {
    const finS = trozos[k + 1]?.limiteS ?? Infinity;
    for (const frase of resultados[k] || []) {
      const inicio = trozo.inicioS + Number(frase.start ?? frase.startTime ?? NaN);
      const fin = trozo.inicioS + Number(frase.end ?? frase.endTime ?? NaN);
      const texto = String(frase.text || '').trim();
      if (!texto || !Number.isFinite(inicio) || inicio < trozo.limiteS || inicio >= finS) continue;
      if (k > 0 && inicio < ultimoFin - 0.25) continue;   // la misma frase oída en las dos partes
      const cierre = Number.isFinite(fin) ? Math.max(fin, inicio + 0.01) : inicio + 0.01;
      salida.push({ startTime: redondear(inicio), endTime: redondear(cierre), text: texto });
      ultimoFin = Math.max(ultimoFin, cierre);
    }
  });
  return salida;
}

export function elegirMp4(variantes, { ahorroDatos = false } = {}) {
  const lista = (variantes || []).filter((v) => v?.url).slice().sort((a, b) => a.bitrate - b.bitrate);
  if (!lista.length) return null;
  const lado = (v) => Math.min(Number(v.ancho) || 0, Number(v.alto) || 0);
  const tope = ahorroDatos ? 360 : 720;
  const aptas = lista.filter((v) => lado(v) > 0 && lado(v) <= tope);
  return aptas.length ? aptas[aptas.length - 1] : lista[0];
}
