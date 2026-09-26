import { codigoCorto } from './idiomaOrigen.js';
import { esCambioHablante } from './vocesDoblaje.js';

/**
 * @typedef {Object} SegmentoTranscripcion
 * @property {number} startTime
 * @property {number} endTime
 * @property {number} duration
 * @property {string} text
 */

function detalleError(datos, respaldo) {
  if (typeof datos?.detail === 'string') return datos.detail;
  if (typeof datos?.message === 'string') return datos.message;
  return respaldo;
}

/* Lo que no es habla no se traduce ni se dice en voz alta (auditoría H10):
 * etiquetas de sonido de YouTube («[music]», «[clears throat]»), efectos
 * escritos entre paréntesis («(baaaaaaaaaaahhh!!)», «(APPLAUSE)»), lo cantado
 * entre notas «♪…♪» y el «>>» con que los subtítulos automáticos marcan un
 * cambio de hablante. Un paréntesis con habla normal se conserva. */
const RE_CORCHETES = /\[[^\]]{0,60}\]/gu;
const RE_PARENTESIS = /\(([^)]{0,40})\)/gu;
const RE_CANTADO = /[♪♫♬][^♪♫♬]*[♪♫♬]/gu;
const RE_NOTAS = /[♪♫♬]+/gu;
const RE_CAMBIO_HABLANTE = /(^|\s)(?:>>|&gt;&gt;)+\s*/gu;
const SONIDOS = /^(?:music|m[uú]sica|applause|aplausos?|laughter|laughs?|risas?|cheering|cheers|silence|silencio|inaudible|snorts?|sighs?|coughs?|clears throat|noise|ruido|sound|sonido|gasps?|groans?|screams?|suspira|tose)\b/iu;

function esSonidoEntreParentesis(contenido) {
  const texto = contenido.trim();
  if (!texto) return true;
  if (SONIDOS.test(texto)) return true;
  if (/(\p{L})\1{3,}/u.test(texto)) return true;                      // «baaaaah», «ohhhh»
  return /\p{L}/u.test(texto) && texto === texto.toUpperCase();        // «(MUSIC)», «(APLAUSOS)»
}

export function limpiarNoHabla(texto) {
  return String(texto || '')
    .replace(RE_CORCHETES, ' ')
    .replace(RE_PARENTESIS, (entero, contenido) => (esSonidoEntreParentesis(contenido) ? ' ' : entero))
    .replace(RE_CANTADO, ' ')
    .replace(RE_NOTAS, ' ')
    .replace(RE_CAMBIO_HABLANTE, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

/** true si, quitando los sonidos, no queda ni una letra ni una cifra. */
export function esSoloSonido(texto) {
  return !/[\p{L}\p{N}]/u.test(limpiarNoHabla(texto));
}

/** Duración mínima que se le deja a un segmento tras recortar su solape. */
const DURACION_MINIMA_SEGMENTO = 0.25;

/**
 * Recorta el final de cada segmento al inicio del siguiente.
 *
 * Por qué hace falta: YouTube deja cada línea de subtítulo en pantalla mientras
 * entra la siguiente, así que los `endTime` vienen inflados y casi todos los
 * segmentos se solapan (medido en un video real: duración declarada 4,69 s pero
 * el siguiente empieza 2,34 s después, en el 99,9 % de los casos). El texto no
 * se repite —solo el tiempo—, pero el doblaje leía esa ventana inflada como
 * «tengo 4,69 s para decir esta frase», hablaba demasiado lento e invadía la
 * frase siguiente. El error se acumulaba a lo largo del video.
 */
export function recortarSolapes(segmentos) {
  for (let i = 0; i < segmentos.length - 1; i += 1) {
    const actual = segmentos[i];
    const siguiente = segmentos[i + 1];
    if (actual.endTime <= siguiente.startTime) continue;
    const fin = Math.max(
      actual.startTime + DURACION_MINIMA_SEGMENTO,
      Math.min(actual.endTime, siguiente.startTime),
    );
    actual.endTime = Math.round(fin * 1000) / 1000;
    actual.duration = Math.round((actual.endTime - actual.startTime) * 1000) / 1000;
  }
  return segmentos;
}

/** Normaliza los formatos Supadata, youtube-transcript-api y Whisper. */
export function normalizarSegmentos(segmentos) {
  const limpios = (Array.isArray(segmentos) ? segmentos : [])
    .map((segmento) => {
      const startTime = Number(segmento.startTime ?? segmento.start ?? 0);
      const endRecibido = Number(segmento.endTime ?? segmento.end);
      const durationRecibida = Number(segmento.duration);
      const endTime = Number.isFinite(endRecibido)
        ? endRecibido
        : startTime + (Number.isFinite(durationRecibida) ? durationRecibida : 0);
      const crudo = String(segmento.text || '').replace(/\s+/g, ' ');
      // La marca de cambio de hablante (>>) se detecta ANTES de limpiar: la
      // limpieza la borra y el doblaje la necesita para alternar 2 voces.
      const cambioHablante = esCambioHablante(crudo);
      const text = limpiarNoHabla(crudo);
      if (!text || esSoloSonido(text) || !Number.isFinite(startTime) || !Number.isFinite(endTime)) return null;
      const inicio = Math.max(0, startTime);
      const fin = Math.max(inicio + 0.01, endTime);
      return {
        startTime: Math.round(inicio * 1000) / 1000,
        endTime: Math.round(fin * 1000) / 1000,
        duration: Math.round((fin - inicio) * 1000) / 1000,
        text,
        ...(cambioHablante ? { cambioHablante: true } : {}),
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.startTime - b.startTime);
  return recortarSolapes(limpios);
}

export function extraerVideoId(urlCruda) {
  try {
    const url = new URL(String(urlCruda || '').trim());
    const host = url.hostname.toLowerCase().replace(/^www\./, '');
    let id = '';
    if (host === 'youtu.be') id = url.pathname.split('/').filter(Boolean)[0] || '';
    if (host === 'youtube.com' || host.endsWith('.youtube.com')) {
      id = url.searchParams.get('v') || '';
      if (!id) {
        const partes = url.pathname.split('/').filter(Boolean);
        if (['shorts', 'embed', 'live'].includes(partes[0])) id = partes[1] || '';
      }
    }
    return /^[\w-]{6,20}$/.test(id) ? id : '';
  } catch {
    return '';
  }
}

export class ErrorYoutube extends Error {
  constructor(mensaje, codigo, datos = {}) {
    super(mensaje);
    this.name = 'ErrorYoutube';
    this.codigo = codigo;   // enlace | sin_subtitulos | cuenta | servidor | sin_segmentos
    this.datos = datos;
  }
}

/** Idioma tal como lo decidió el servidor: una sola fuente de verdad. */
function leerIdioma(datos) {
  const idioma = codigoCorto(datos?.language);
  const solicitado = codigoCorto(datos?.requested_lang);
  const audio = codigoCorto(datos?.audio_language);
  const resolucion = datos?.language_resolution_confidence;
  return {
    idioma,
    solicitado,
    confianza: Number(resolucion ?? datos?.audio_language_confidence) || 0,
    fuente: String(datos?.language_source || 'proveedor'),
    conflicto: Boolean(datos?.audio_language_conflict)
      || Boolean(audio && idioma && audio !== idioma)
      || Boolean(solicitado && idioma && solicitado !== idioma),
    disponibles: Array.isArray(datos?.available_langs) ? datos.available_langs : [],
  };
}

/** Hasta 85 s: Supadata tardó 26,7 s con un video de 88 min (auditoría H14). */
const ESPERA_PETICION_MS = 85000;

export class TranscriptionService {
  constructor({ fetchApi, pollIntervalMs = 3000, maxWaitMs = 20 * 60 * 1000 }) {
    if (typeof fetchApi !== 'function') throw new Error('Falta el cliente de la API.');
    this.fetchApi = fetchApi;
    this.pollIntervalMs = pollIntervalMs;
    this.maxWaitMs = maxWaitMs;
  }

  /**
   * Texto con marcas de tiempo en el idioma original del video. No decide si se
   * dobla: eso es `decidirDoblaje` (idiomaOrigen.js), con lo que aquí se devuelve.
   */
  async obtenerParaDoblaje(url, {
    idiomaOrigen = 'auto', tituloVideo = '', duracionS = 0, permitirIA = false,
    apiKey = '', context = '', signal = null, onProgress = () => {},
  } = {}) {
    if (!extraerVideoId(url)) throw new ErrorYoutube('El enlace de YouTube no es válido.', 'enlace');
    onProgress('Leyendo el video…');
    const respuesta = await this.fetchApi('/youtube', {
      method: 'POST',
      signal,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url,
        language: idiomaOrigen || 'auto',
        prefer_subtitles: true,
        fast_mode: false,
        include_timestamps: true,
        title_hint: String(tituloVideo || '').slice(0, 300),
        duration_hint_s: Number(duracionS) || 0,
        allow_ai_generation: Boolean(permitirIA),
        api_key: String(apiKey || ''),
        context: String(context || '').slice(0, 4000),
      }),
    }, ESPERA_PETICION_MS);
    let datos = await respuesta.json().catch(() => ({}));
    if (respuesta.status === 409 && datos?.code === 'sin_subtitulos') {
      throw new ErrorYoutube(detalleError(datos, 'Este video no tiene subtítulos.'), 'sin_subtitulos', datos);
    }
    if (respuesta.status === 402) {
      throw new ErrorYoutube(detalleError(datos, 'Hay un problema con la cuenta de Supadata.'), 'cuenta', datos);
    }
    if (!respuesta.ok && respuesta.status !== 202) {
      throw new ErrorYoutube(detalleError(datos, 'No se pudo leer el video.'), 'servidor', datos);
    }
    if (datos.pending && datos.job_id) {
      // El 202 trae qué se pidió y por qué; el trabajo trae el texto.
      datos = { ...datos, ...(await this.#esperarTrabajo(datos.job_id, { signal, onProgress })) };
    }
    const segmentos = normalizarSegmentos(datos.segments);
    if (!segmentos.length) {
      throw new ErrorYoutube('El video no trae frases con tiempos que se puedan doblar.', 'sin_segmentos', datos);
    }
    return {
      segmentos,
      ...leerIdioma(datos),
      titulo: tituloVideo || datos.title || '',
      duracionS: Number(datos.duration_s) || Number(duracionS) || 0,
    };
  }

  async #esperarTrabajo(jobId, { signal, onProgress }) {
    const inicio = Date.now();
    const limite = inicio + this.maxWaitMs;
    while (Date.now() < limite) {
      await new Promise((resolver) => setTimeout(resolver, this.pollIntervalMs));
      if (signal?.aborted) throw new DOMException('Cancelado', 'AbortError');
      const segundos = Math.round((Date.now() - inicio) / 1000);
      onProgress(`Transcribiendo el video: ${segundos} s (los videos largos pueden tardar varios minutos)…`);
      const respuesta = await this.fetchApi(
        `/youtube-job?id=${encodeURIComponent(jobId)}&include_timestamps=true`,
        { signal },
        30000,
      );
      if (respuesta.status === 202) continue;
      const datos = await respuesta.json().catch(() => ({}));
      if (!respuesta.ok) throw new ErrorYoutube(detalleError(datos, 'Falló la transcripción del video largo.'), 'servidor', datos);
      return datos;
    }
    throw new ErrorYoutube('El video sigue procesándose. Intenta de nuevo en unos minutos.', 'servidor');
  }
}
