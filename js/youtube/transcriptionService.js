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
      const text = String(segmento.text || '').replace(/\s+/g, ' ').trim();
      if (!text || !Number.isFinite(startTime) || !Number.isFinite(endTime)) return null;
      const inicio = Math.max(0, startTime);
      const fin = Math.max(inicio + 0.01, endTime);
      return {
        startTime: Math.round(inicio * 1000) / 1000,
        endTime: Math.round(fin * 1000) / 1000,
        duration: Math.round((fin - inicio) * 1000) / 1000,
        text,
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

/** Umbrales de respaldo si el servidor es de una versión anterior. */
export const UMBRALES_IDIOMA = { aceptar: 0.85, preguntar: 0.6 };

const NOMBRES_IDIOMA = {
  en: 'inglés', es: 'español', pt: 'portugués', fr: 'francés', de: 'alemán',
  it: 'italiano', ja: 'japonés', ko: 'coreano', zh: 'chino', ru: 'ruso',
  ar: 'árabe', hi: 'hindi', nl: 'neerlandés', tr: 'turco', pl: 'polaco',
};

/** Nombres en inglés que devuelve Whisper cuando detecta el idioma él solo. */
const CODIGO_POR_NOMBRE = {
  english: 'en', spanish: 'es', castilian: 'es', french: 'fr', portuguese: 'pt',
  german: 'de', italian: 'it', dutch: 'nl', russian: 'ru', japanese: 'ja',
  korean: 'ko', chinese: 'zh', mandarin: 'zh', arabic: 'ar', hindi: 'hi',
  turkish: 'tr', polish: 'pl', catalan: 'ca', romanian: 'ro', swedish: 'sv',
  norwegian: 'no', danish: 'da', finnish: 'fi', greek: 'el', hebrew: 'he',
  indonesian: 'id', ukrainian: 'uk', czech: 'cs', vietnamese: 'vi', thai: 'th',
};

/**
 * Código ISO del idioma, venga como código ('en-US') o como nombre ('English').
 *
 * Por qué hace falta: cuando se pide «detectar idioma», Whisper no devuelve el
 * código sino el nombre en inglés. Tratarlo como código forma pares imposibles
 * ('english' → 'es'), la traducción se rechaza entera y el doblaje termina
 * leyendo el texto original en el idioma de partida.
 */
export function codigoIdioma(valor) {
  const crudo = String(valor || '').trim().toLowerCase().replace(/_/g, '-');
  if (!crudo) return '';
  const corto = crudo.split('-')[0];
  if (corto.length === 2) return corto;
  return CODIGO_POR_NOMBRE[corto] || corto;
}

export function nombreIdioma(codigo) {
  const corto = codigoIdioma(codigo);
  return NOMBRES_IDIOMA[corto] || corto || 'desconocido';
}

/**
 * Peso de cada señal: cuánto demuestra sobre el idioma del AUDIO.
 * Debe coincidir con `PESOS_FUENTE` de `api/deteccion_idioma.py`.
 */
export const PESOS_SENAL = {
  audio_declarado: 0.97,
  pista_automatica: 0.92,
  lexico_asr: 0.9,
  lexico: 0.72,
  proveedor: 0.62,
  pista_manual: 0.55,
};

/**
 * Funde señales en un veredicto, igual que hace el servidor: gana la más fuerte,
 * las que coinciden recortan parte de la duda y las contrarias la aumentan.
 */
export function combinarEvidencia(senales) {
  const validas = (senales || []).filter((s) => s && s.idioma);
  if (!validas.length) return { idioma: '', confianza: 0, conflicto: false };

  const mejor = validas.reduce((a, b) => (b.confianza > a.confianza ? b : a));
  const idioma = mejor.idioma;
  const aFavor = validas
    .filter((s) => s.idioma === idioma)
    .map((s) => s.confianza)
    .sort((a, b) => b - a)
    .slice(1);
  const enContra = validas.filter((s) => s.idioma !== idioma).map((s) => s.confianza);

  let confianza = mejor.confianza;
  for (const extra of aFavor) confianza += (1 - confianza) * extra * 0.45;
  if (enContra.length) confianza -= Math.max(...enContra) * 0.6;

  return {
    idioma,
    confianza: Math.max(0, Math.min(0.99, Math.round(confianza * 1000) / 1000)),
    conflicto: enContra.length > 0,
  };
}

/**
 * Traduce el veredicto del servidor a una decisión de negocio.
 * `aceptar` = doblar · `preguntar` = pedir confirmación · `rechazar` = no doblar.
 *
 * `pistaNavegador` es la señal que solo el navegador puede conseguir: el idioma
 * de la pista automática de YouTube. Sin ella, un video servido por un proveedor
 * externo se queda como mucho en 0,80 de confianza —medido en producción— y
 * siempre acabaría preguntando, aunque el audio esté clarísimamente en inglés.
 */
export function evaluarIdiomaAudio(datos, idiomaEsperado = 'en', pistaNavegador = null) {
  const umbrales = { ...UMBRALES_IDIOMA, ...(datos?.audio_language_thresholds || {}) };
  let idioma = String(datos?.audio_language || '').toLowerCase().split(/[-_]/)[0];
  const confianza = Number(datos?.audio_language_confidence);
  let seguro = Number.isFinite(confianza) ? confianza : 0;

  if (pistaNavegador?.idioma) {
    const fuente = pistaNavegador.automatica ? 'pista_automatica' : 'pista_manual';
    const combinado = combinarEvidencia([
      ...(datos?.audio_language_evidence || []),
      { fuente, idioma: pistaNavegador.idioma, confianza: PESOS_SENAL[fuente] },
    ]);
    idioma = combinado.idioma;
    seguro = combinado.confianza;
  }
  const coincide = idioma === idiomaEsperado;
  const porcentaje = Math.round(seguro * 100);

  if (coincide && seguro >= umbrales.aceptar) {
    return { decision: 'aceptar', idioma, confianza: seguro, porcentaje, mensaje: '' };
  }
  if (seguro < umbrales.preguntar) {
    return {
      decision: 'preguntar',
      idioma,
      confianza: seguro,
      porcentaje,
      // Sin certeza no se afirma nada: se le da la decisión al usuario en vez
      // de doblar a ciegas o rechazar un video que quizá sí estaba en inglés.
      mensaje: idioma
        ? `No pudimos confirmar el idioma del audio (parece ${nombreIdioma(idioma)}, con solo ${porcentaje} % de certeza).`
        : 'No pudimos determinar el idioma del audio de este video.',
    };
  }
  if (!coincide) {
    return {
      decision: 'rechazar',
      idioma,
      confianza: seguro,
      porcentaje,
      mensaje: `El audio de este video está en ${nombreIdioma(idioma)} (${porcentaje} % de certeza), no en inglés. El doblaje solo está preparado para videos hablados en inglés.`,
    };
  }
  return {
    decision: 'preguntar',
    idioma,
    confianza: seguro,
    porcentaje,
    mensaje: `El audio parece estar en inglés, pero con ${porcentaje} % de certeza. Puede que la transcripción sea una traducción y no el audio real.`,
  };
}

export class TranscriptionService {
  constructor({ fetchApi, pollIntervalMs = 3000, maxWaitMs = 240000 }) {
    if (typeof fetchApi !== 'function') throw new Error('Falta el cliente de la API.');
    this.fetchApi = fetchApi;
    this.pollIntervalMs = pollIntervalMs;
    this.maxWaitMs = maxWaitMs;
  }

  /**
   * Trae la transcripción del audio original con marcas de tiempo y verifica
   * que ese audio esté en inglés.
   *
   * Antes se pedía `language: 'en'`, y eso era el error de raíz: obligaba al
   * servidor a traer la pista inglesa aunque el video estuviera hablado en otro
   * idioma. Ahora se pide «auto» y el servidor informa qué idioma detectó en el
   * audio y con cuánta confianza.
   *
   * `confirmar` recibe el motivo de la duda y devuelve true/false. Si no se
   * pasa, la duda equivale a un no.
   */
  async obtenerParaDoblaje(url, {
    onProgress = () => {},
    apiKey = '',
    context = '',
    confirmar = null,
    pistaNavegador = null,
  } = {}) {
    if (!extraerVideoId(url)) throw new Error('El enlace de YouTube no es válido.');
    onProgress('Analizando el audio del video…');
    const respuesta = await this.fetchApi('/youtube', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url,
        language: 'auto',
        prefer_subtitles: true,
        fast_mode: false,
        include_timestamps: true,
        api_key: String(apiKey || ''),
        context: String(context || '').slice(0, 4000),
      }),
    }, 55000);
    let datos = await respuesta.json().catch(() => ({}));
    if (!respuesta.ok && respuesta.status !== 202) {
      throw new Error(detalleError(datos, 'No se pudo transcribir el video.'));
    }
    if (datos.pending && datos.job_id) {
      datos = await this.#esperarTrabajo(datos.job_id, onProgress);
    }
    const segmentos = normalizarSegmentos(datos.segments);
    if (!segmentos.length) {
      throw new Error('El servicio devolvió texto, pero no marcas de tiempo utilizables.');
    }

    // La señal del navegador se pide aquí, con la transcripción ya en mano: es
    // el único momento en que sabemos que el video existe y merece la espera.
    let pista = null;
    if (typeof pistaNavegador === 'function') {
      try {
        pista = await pistaNavegador();
      } catch (_) {
        pista = null; // Nunca bloquea: es una señal opcional.
      }
    }
    const veredicto = evaluarIdiomaAudio(datos, 'en', pista);
    if (veredicto.decision === 'rechazar') {
      const error = new Error(veredicto.mensaje);
      error.idiomaDetectado = veredicto.idioma;
      throw error;
    }
    if (veredicto.decision === 'preguntar') {
      const aprobado = typeof confirmar === 'function'
        ? await confirmar(veredicto)
        : false;
      if (!aprobado) {
        const error = new Error(`${veredicto.mensaje} El doblaje se detuvo sin gastar procesamiento.`);
        error.idiomaDetectado = veredicto.idioma;
        error.cancelado = true;
        throw error;
      }
    }

    return {
      ...datos,
      language: String(datos.language || 'en').toLowerCase(),
      segments: segmentos,
      veredictoIdioma: veredicto,
    };
  }

  async #esperarTrabajo(jobId, onProgress) {
    const limite = Date.now() + this.maxWaitMs;
    while (Date.now() < limite) {
      await new Promise((resolver) => setTimeout(resolver, this.pollIntervalMs));
      const segundos = Math.max(0, Math.round((limite - Date.now()) / 1000));
      onProgress(`El video sigue procesándose. Tiempo máximo restante: ${segundos} s.`);
      const respuesta = await this.fetchApi(
        `/youtube-job?id=${encodeURIComponent(jobId)}&include_timestamps=true`,
        {},
        30000,
      );
      if (respuesta.status === 202) continue;
      const datos = await respuesta.json().catch(() => ({}));
      if (!respuesta.ok) {
        throw new Error(detalleError(datos, 'Falló el procesamiento del video largo.'));
      }
      return datos;
    }
    throw new Error('El video sigue procesándose. Intenta de nuevo en un minuto.');
  }
}
