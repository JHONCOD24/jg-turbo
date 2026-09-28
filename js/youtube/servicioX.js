/**
 * Videos de X: del post al texto con tiempos, listo para el mismo doblaje de YouTube.
 *
 * X casi nunca trae subtítulos (medido: 0 de 4 videos con voz), así que se escucha
 * el audio con Whisper (Groq, gratis) por /api/transcribe, en partes de ≤ 3,2 MB.
 * Toda petición a video.twimg.com va SIN Referer: con Referer de otro dominio X
 * responde 403 (medido 2026-09-27; curl no lo muestra porque no manda Referer).
 */
import { ErrorYoutube, normalizarSegmentos } from './transcriptionService.js';
import { codigoCorto } from './idiomaOrigen.js';
import {
  elegirPistaAudio, leerListaAudio, planearTrozos, unirTranscripciones, urlTwimg, duracionMaximaTrozo,
} from './audioX.js';

export const MAX_DURACION_X_S = 60 * 60;
const ESPERA_INFO_MS = 20000;            // /api/x-video: ≤ 2 consultas de 8 s
const ESPERA_PARTE_MS = 90000;           // subir ~3 MB + Whisper sobre 6 min de audio
const DESCARGAS_EN_PARALELO = 8;
const PARTES_EN_PARALELO = 2;            // Groq gratis: 20 peticiones/min
const RE_LIMITE = /l[ií]mite de uso|rate limit|429/i;

const cancelado = () => new DOMException('Cancelado', 'AbortError');
const esperarMs = (ms, signal) => new Promise((resolver, rechazar) => {
  const t = setTimeout(resolver, ms);
  signal?.addEventListener('abort', () => { clearTimeout(t); rechazar(cancelado()); }, { once: true });
});

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

/** Corre `trabajo` sobre cada elemento con a lo sumo `limite` a la vez; el primer fallo detiene el resto. */
async function enParalelo(elementos, limite, trabajo) {
  let siguiente = 0;
  let fallo = null;
  const trabajadores = Array.from({ length: Math.min(limite, elementos.length) }, async () => {
    while (!fallo && siguiente < elementos.length) {
      const i = siguiente;
      siguiente += 1;
      try { await trabajo(elementos[i], i); } catch (error) { fallo = fallo || error; }
    }
  });
  await Promise.all(trabajadores);
  if (fallo) throw fallo;
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
    const inicial = await this.#bytes(urlTwimg(lista.init, info.hls), signal);
    const trozos = planearTrozos(lista.segmentos, { maxS: duracionMaximaTrozo(pista.kbps) });

    const elegido = idiomaOrigen && idiomaOrigen !== 'auto' ? codigoCorto(idiomaOrigen) : '';
    let idioma = elegido;
    const resultados = new Array(trozos.length);
    let hechas = 0;
    const transcribirParte = async (trozo, k) => {
      const partes = [inicial];
      const urls = lista.segmentos.slice(trozo.desde, trozo.hasta).map((s) => urlTwimg(s.uri, info.hls));
      const bytes = new Array(urls.length);
      await enParalelo(urls, DESCARGAS_EN_PARALELO, async (url, i) => { bytes[i] = await this.#bytes(url, signal); });
      partes.push(...bytes);
      const audio = new Blob(partes, { type: 'audio/mp4' });
      resultados[k] = await this.#subir(audio, k, { idioma: idioma || 'auto', apiKey, context, signal });
      hechas += 1;
      onProgress(`Transcribiendo el audio: ${hechas} de ${trozos.length} ${trozos.length === 1 ? 'parte' : 'partes'}…`, hechas / trozos.length);
    };

    onProgress(`Transcribiendo el audio: 0 de ${trozos.length} ${trozos.length === 1 ? 'parte' : 'partes'}…`, 0);
    // La 1.ª parte va sola: fija el idioma para las demás (Whisper podría cambiarlo parte a parte).
    await transcribirParte(trozos[0], 0);
    idioma = idioma || codigoCorto(resultados[0].idioma);
    const soloPrimera = !elegido && idioma === 'es';   // ya está en español: no se gasta cuota en el resto
    if (!soloPrimera) await enParalelo(trozos.slice(1), PARTES_EN_PARALELO, (trozo, i) => transcribirParte(trozo, i + 1));

    const usados = soloPrimera ? trozos.slice(0, 1) : trozos;
    const segmentos = normalizarSegmentos(unirTranscripciones(usados, resultados.slice(0, usados.length).map((r) => r.segmentos)));
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

  async #subir(audio, k, { idioma, apiKey, context, signal }) {
    const formulario = new FormData();
    formulario.append('file', audio, `x_parte_${k + 1}.m4a`);
    formulario.append('language', idioma);
    formulario.append('fast', 'false');   // verbose_json: Whisper entrega start/end por frase
    if (apiKey) formulario.append('api_key', apiKey);
    if (context) formulario.append('context', String(context).slice(0, 4000));
    for (let intento = 0; ; intento += 1) {
      if (signal?.aborted) throw cancelado();
      const respuesta = await this.fetchApi('/transcribe', { method: 'POST', body: formulario, signal }, ESPERA_PARTE_MS);
      const datos = await respuesta.json().catch(() => ({}));
      if (signal?.aborted) throw cancelado();
      if (respuesta.ok) {
        return { segmentos: Array.isArray(datos.segments) ? datos.segments : [], idioma: datos.language || '' };
      }
      const detalle = typeof datos?.detail === 'string' ? datos.detail : '';
      if ((respuesta.status === 429 || RE_LIMITE.test(detalle)) && intento < this.esperasLimiteMs.length) {
        await this.esperar(this.esperasLimiteMs[intento], signal);
        continue;
      }
      throw new ErrorYoutube(detalle || `No se pudo transcribir el audio del video (HTTP ${respuesta.status}).`, 'x_transcripcion', datos);
    }
  }
}
