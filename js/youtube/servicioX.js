/**
 * Videos de X: del post al texto con tiempos, listo para el mismo doblaje de YouTube.
 *
 * X casi nunca trae subtítulos (medido: 0 de 4 videos con voz), así que se escucha
 * el audio con Whisper (Groq, gratis) por /api/transcribe, en partes de ≤ 3,2 MB.
 * Toda petición a video.twimg.com va SIN Referer: con Referer de otro dominio X
 * responde 403 (medido 2026-09-27; curl no lo muestra porque no manda Referer).
 */
import { ErrorYoutube, normalizarSegmentos } from './transcriptionService.js';
import { transcribirPorPartes, enParalelo, esperarMs, cancelado } from './transcripcionPartes.js';
import {
  elegirPistaAudio, leerListaAudio, planearTrozos, unirTranscripciones, urlTwimg, duracionMaximaTrozo,
} from './audioX.js';

import { MAX_VIDEO_DURACION_S } from './limitesVideo.js';

export const MAX_DURACION_X_S = MAX_VIDEO_DURACION_S;
const ESPERA_INFO_MS = 20000;            // /api/x-video: ≤ 2 consultas de 8 s
const DESCARGAS_EN_PARALELO = 8;

export function fetchTwimg(url, { signal } = {}) {
  return fetch(url, { referrerPolicy: 'no-referrer', credentials: 'omit', signal });
}

export function tituloX(info) {
  const autor = info?.autor ? `@${info.autor}` : 'X';
  const texto = String(info?.texto || '').replace(/\s+/g, ' ').trim();
  if (!texto) return `Video de ${autor}`;
  const titulo = `${autor} · ${texto}`;
  return titulo.length > 120 ? `${titulo.slice(0, 119)}…` : titulo;
}

export class ServicioX {
  constructor({ fetchApi, pedirTwimg = fetchTwimg, esperar = esperarMs, esperasLimiteMs = [20000, 40000] }) {
    if (typeof fetchApi !== 'function') throw new Error('Falta el cliente de la API.');
    this.fetchApi = fetchApi;
    this.pedirTwimg = pedirTwimg;
    this.esperar = esperar;
    this.esperasLimiteMs = esperasLimiteMs;
  }

  async info(url, { signal = null } = {}) {
    const respuesta = await this.fetchApi(`/x-video?url=${encodeURIComponent(url)}`, { signal }, ESPERA_INFO_MS);
    const datos = await respuesta.json().catch(() => ({}));
    if (!respuesta.ok) {
      throw new ErrorYoutube(
        typeof datos?.detail === 'string' ? datos.detail : 'No se pudo leer el post de X.',
        `x_${datos?.code || 'servidor'}`, datos,
      );
    }
    return datos;
  }

  async obtenerParaDoblaje(info, {
    idiomaOrigen = 'auto', apiKey = '', context = '', signal = null, onProgress = () => {},
  } = {}) {
    const duracion = Number(info?.duracion_s) || 0;
    if (duracion > MAX_DURACION_X_S) {
      throw new ErrorYoutube(`Este video dura ${Math.round(duracion / 60)} min. Por ahora se doblan videos de X de hasta ${MAX_DURACION_X_S / 60} min.`, 'x_largo');
    }
    if (!info?.hls) throw new ErrorYoutube('Este video de X no trae una pista de audio que podamos leer.', 'x_sin_audio');
    onProgress('Leyendo el audio del video…', null);
    const pista = elegirPistaAudio(await this.#texto(info.hls, signal));
    if (!pista) throw new ErrorYoutube('Este video de X no trae una pista de audio separada.', 'x_sin_audio');
    const lista = leerListaAudio(await this.#texto(urlTwimg(pista.uri, info.hls), signal));
    if (!lista.init || !lista.segmentos.length) throw new ErrorYoutube('La pista de audio del video llegó vacía.', 'x_sin_audio');
    if (lista.duracionS > MAX_DURACION_X_S) {
      throw new ErrorYoutube(`La pista de audio supera el máximo de ${MAX_DURACION_X_S / 60} min (2 horas).`, 'x_largo');
    }
    const inicial = await this.#bytes(urlTwimg(lista.init, info.hls), signal);
    const trozos = planearTrozos(lista.segmentos, { maxS: duracionMaximaTrozo(pista.kbps) });

    const fabricarParte = async (k) => {
      const trozo = trozos[k];
      const urls = lista.segmentos.slice(trozo.desde, trozo.hasta).map((s) => urlTwimg(s.uri, info.hls));
      const bytes = new Array(urls.length);
      await enParalelo(urls, DESCARGAS_EN_PARALELO, async (url, i) => { bytes[i] = await this.#bytes(url, signal); });
      return { audio: new Blob([inicial, ...bytes], { type: 'audio/mp4' }), nombre: `x_parte_${k + 1}.m4a` };
    };
    const { resultados, usadas, soloPrimera, idioma, elegido } = await transcribirPorPartes({
      total: trozos.length, fabricarParte, fetchApi: this.fetchApi, idiomaOrigen, apiKey, context, signal, onProgress,
      esperar: this.esperar, esperasLimiteMs: this.esperasLimiteMs, codigoError: 'x_transcripcion',
    });
    const usados = trozos.slice(0, usadas);
    const segmentos = normalizarSegmentos(unirTranscripciones(usados, resultados.slice(0, usadas)));
    if (!segmentos.length && !soloPrimera) {
      throw new ErrorYoutube('No se oye voz que se pueda doblar en este video (¿solo música?).', 'sin_segmentos');
    }
    return {
      segmentos,
      idioma,
      solicitado: elegido,
      confianza: elegido ? 1 : 0.95,
      fuente: elegido ? 'usuario' : 'audio',
      conflicto: false,
      disponibles: [],
      titulo: tituloX(info),
      duracionS: duracion || lista.duracionS,
    };
  }

  async #texto(url, signal) {
    return new TextDecoder().decode(await this.#bytes(url, signal));
  }

  async #bytes(url, signal) {
    for (let intento = 0; ; intento += 1) {
      if (signal?.aborted) throw cancelado();
      try {
        const respuesta = await this.pedirTwimg(url, { signal });
        if (!respuesta.ok) throw new ErrorYoutube(`X no entregó el audio del video (HTTP ${respuesta.status}).`, 'x_red');
        return new Uint8Array(await respuesta.arrayBuffer());
      } catch (error) {
        if (error?.name === 'AbortError' || signal?.aborted) throw cancelado();
        if (intento >= 1) throw error instanceof ErrorYoutube ? error : new ErrorYoutube('Se cortó la descarga del audio de X. Revisa la conexión e intenta de nuevo.', 'x_red');
      }
    }
  }
}
