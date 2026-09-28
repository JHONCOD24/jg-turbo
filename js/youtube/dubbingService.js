// Unidades de voz: trozos cortos y con sentido, no bloques largos.
//
// Por qué cambió: antes se fusionaban en bloques de 26 a 34 segundos y dentro
// de cada bloque la posición del audio se calculaba interpolando. Con bloques
// tan largos, cualquier diferencia entre el ritmo del inglés y el del español
// se acumulaba hasta desfases de varios segundos. Con unidades de 3 a 8 s el
// error se corrige en cada frase y nunca alcanza a notarse.
export const DURACION_MINIMA = 2.2;
export const DURACION_OBJETIVO = 6;
export const DURACION_MAXIMA = 9;
const MAXIMO_CARACTERES = 240;
const MAXIMO_SALTO = 0.8;

const TERMINA_IDEA = /[.!?…]["'»)\]]?$/;
const PAUSA_MEDIA = /[,;:—-]["'»)\]]?$/;



/** Silencio posterior que una frase puede tomar prestado para no acelerar la voz. */
export const SILENCIO_PRESTADO_MAX_S = 2;

/**
 * Frases de voz definidas por el TIEMPO del original, no por la traducción.
 * Existen desde el primer segundo (el motor sabe dónde habrá voz aunque falte
 * traducir) y la traducción solo rellena su texto. Mismas reglas de corte que
 * `agruparSegmentosParaVoz`, aplicadas al texto original. Recibe segmentos ya
 * normalizados (`normalizarSegmentos`).
 *
 * Cada unidad lleva `hablante` (0 o 1): cada marca `>>` alterna de hablante
 * para que el diálogo suene con 2 voces distintas. Un monólogo queda todo en 0.
 */
export function agruparPorTiempo(segmentos) {
  const grupos = [];
  let actual = null;
  let hablante = 0;
  // Un >> suelto es un artefacto, no un diálogo: solo con 2 cambios
  // confirmados se alternan voces (y se corta en el cambio). Sin diálogo, las
  // unidades quedan idénticas a las de antes: un monólogo = 1 voz.
  const lista = Array.isArray(segmentos) ? segmentos : [];
  const dialogo = lista.filter((s) => s?.cambioHablante).length >= 2;
  const abrir = (segmento, indice) => ({
    startTime: segmento.startTime, finHabla: segmento.endTime, desde: indice, hasta: indice, textoOriginal: segmento.text,
    hablante,
  });
  (segmentos || []).forEach((segmento, indice) => {
    const texto = String(segmento?.text || '').trim();
    const inicio = Number(segmento?.startTime);
    const fin = Number(segmento?.endTime);
    if (!texto || !Number.isFinite(inicio) || !Number.isFinite(fin) || fin <= inicio) return;
    const cambio = dialogo && segmento?.cambioHablante;
    // La primera marca (>>) abre la conversación, no alterna: el primer
    // hablante siempre es el 0. Las siguientes sí alternan 0 ↔ 1.
    if (cambio && (actual || grupos.length)) hablante = hablante === 0 ? 1 : 0;
    if (!actual) { actual = abrir(segmento, indice); return; }
    const haySilencio = inicio - actual.finHabla > MAXIMO_SALTO;
    const nuevoTexto = `${actual.textoOriginal} ${texto}`;
    const duracionActual = actual.finHabla - actual.startTime;
    const puntoNatural = TERMINA_IDEA.test(actual.textoOriginal)
      || (PAUSA_MEDIA.test(actual.textoOriginal) && duracionActual >= DURACION_OBJETIVO);
    const debeCortar = haySilencio
      || Boolean(cambio)
      || fin - actual.startTime > DURACION_MAXIMA
      || nuevoTexto.length > MAXIMO_CARACTERES
      || (puntoNatural && duracionActual >= DURACION_MINIMA);
    if (debeCortar) {
      grupos.push(actual);
      actual = abrir(segmento, indice);
      return;
    }
    actual.finHabla = fin;
    actual.hasta = indice;
    actual.textoOriginal = nuevoTexto;
  });
  if (actual) grupos.push(actual);
  return grupos.map((grupo, indice) => {
    const siguiente = grupos[indice + 1];
    const tope = grupo.finHabla + SILENCIO_PRESTADO_MAX_S;
    const endTime = siguiente ? Math.max(grupo.finHabla, Math.min(siguiente.startTime, tope)) : tope;
    return {
      ...grupo, indice, endTime, duration: endTime - grupo.startTime,
      text: '', estado: 'sin_traducir', blob: null, url: '', error: '', promesa: null,
    };
  });
}

/**
 * Texto de la frase si TODOS sus segmentos ya tienen respuesta de la traducción.
 * `null` = aún falta alguno. `''` = alguno no se pudo traducir: es mejor oír el
 * original que leer inglés con voz española (auditoría H11).
 */
export function textoDeUnidad(unidad, traducciones) {
  const partes = [];
  for (let i = unidad.desde; i <= unidad.hasta; i += 1) {
    if (!traducciones.has(i)) return null;
    const texto = traducciones.get(i);
    if (texto === null) return '';
    if (texto) partes.push(texto);
  }
  return partes.join(' ').replace(/\s+/g, ' ').trim();
}

/**
 * Duración de un audio por su tamaño, sin decodificarlo. La voz neural llega en
 * MP3 de 48 kbps fijos (`audio-24khz-48kbitrate-mono-mp3`, Azure y Edge) y la de
 * Fish en 128 kbps; un WAV trae su ritmo de bytes en la cabecera.
 */
export async function duracionPorBytes(blob, motor = '') {
  const bytes = Number(blob?.size) || 0;
  if (!bytes) return null;
  const tipo = String(blob.type || '').toLowerCase();
  if (tipo.includes('wav')) {
    try {
      const cabecera = new DataView(await blob.slice(0, 44).arrayBuffer());
      const porSegundo = cabecera.getUint32(28, true);
      return porSegundo > 0 ? Math.max(0, bytes - 44) / porSegundo : null;
    } catch (_) { return null; }
  }
  if (!tipo.includes('mpeg') && !tipo.includes('mp3')) return null;   // tipo desconocido: por metadatos
  const kbps = /fish/i.test(String(motor || '')) ? 128 : 48;
  return (bytes * 8) / (kbps * 1000);
}

/**
 * Duración real (s) de un audio ya generado. El plan de ritmo la necesita ANTES
 * de que la frase suene para frenar el video a tiempo. Primero por el tamaño
 * (instantáneo); si no se puede, por los metadatos. `null` si nada funcionó:
 * entonces se estima por el texto.
 */
export async function medirDuracionAudio(url, {
  blob = null, motor = '',
  crear = () => (typeof Audio === 'function' ? new Audio() : null), esperaMs = 1500,
} = {}) {
  const porBytes = await duracionPorBytes(blob, motor);
  if (porBytes > 0) return porBytes;
  const audio = crear();
  if (!audio || !url) return null;
  return new Promise((resolver) => {
    let hecho = false;
    const terminar = (valor) => {
      if (hecho) return;
      hecho = true;
      clearTimeout(temporizador);
      try { audio.removeAttribute('src'); audio.load(); } catch (_) {}
      resolver(valor);
    };
    const temporizador = setTimeout(() => terminar(null), esperaMs);
    audio.preload = 'metadata';
    audio.addEventListener('loadedmetadata', () => {
      const duracion = Number(audio.duration);
      terminar(Number.isFinite(duracion) && duracion > 0 ? duracion : null);
    });
    audio.addEventListener('error', () => terminar(null));
    audio.src = url;
  });
}

export class DubbingService {
  constructor({ generarAudio, onProgress = () => {}, limitador = null, onRespaldo = null, medirDuracion = medirDuracionAudio, buscarGuardada = null }) {
    if (typeof generarAudio !== 'function') {
      throw new Error('No está disponible el generador de voz en español.');
    }
    this.generarAudio = generarAudio;
    this.onProgress = onProgress;
    this.limitador = limitador;
    this.onRespaldo = onRespaldo;
    this.medirDuracion = medirDuracion;
    this.buscarGuardada = buscarGuardada;
    this.unidades = [];
    this.completadas = 0;
    this.destruido = false;
    // Sube con cada cambio de voz: un audio que se estaba generando con la voz
    // anterior se descarta al llegar (antes sonaba intercalado con la nueva).
    this.versionVoz = 0;
    this.invalidadoDesde = Number.POSITIVE_INFINITY;
  }

  /** Frases ya armadas con `agruparPorTiempo` (sin texto todavía). */
  definirUnidades(unidades) {
    this.liberar();
    this.destruido = false;
    this.completadas = 0;
    this.unidades = unidades;
    return this.unidades;
  }

  /**
   * Llegó la traducción de una frase: '' = sin voz (se oye el original).
   * `fracciones` = dónde termina cada segmento dentro del texto (subtítulo que
   * sigue a la voz, `ritmoDoblaje.fraccionesDeUnidad`).
   */
  fijarTexto(indice, texto, fracciones = null) {
    const unidad = this.unidades[indice];
    if (!unidad || unidad.estado !== 'sin_traducir') return;
    unidad.text = texto;
    unidad.estado = texto ? 'pendiente' : 'sin_voz';
    if (Array.isArray(fracciones)) unidad.fracciones = fracciones;
  }

  /** Espera turno en el limitador (Azure F0: 20 síntesis/minuto). */
  async #cupo() {
    if (!this.limitador) return;
    for (let vuelta = 0; vuelta < 120 && !this.limitador.disponible(); vuelta += 1) {
      await new Promise((r) => setTimeout(r, Math.min(1000, Math.max(50, this.limitador.esperaMs()))));
      if (this.destruido) throw new Error('La preparación de voz fue cancelada.');
    }
    this.limitador.registrar();
  }

  /** Suelta el audio de lo que quedó atrás; si la persona retrocede, se regenera. */
  liberarAntesDe(tiempoS) {
    for (const unidad of this.unidades) {
      if (unidad.endTime >= tiempoS) break;
      if (unidad.estado !== 'listo') continue;
      if (unidad.url) URL.revokeObjectURL(unidad.url);
      unidad.url = '';
      unidad.blob = null;
      unidad.estado = 'pendiente';
    }
  }

  /** Descarta la voz ya generada desde un instante (cambio de voz, T3.2). */
  invalidarDesde(tiempoS) {
    this.versionVoz += 1;
    this.invalidadoDesde = tiempoS;
    for (const unidad of this.unidades) {
      if (unidad.startTime < tiempoS || unidad.estado !== 'listo') continue;
      if (unidad.url) URL.revokeObjectURL(unidad.url);
      unidad.url = '';
      unidad.blob = null;
      unidad.duracionVoz = 0;   // otra voz, otro ritmo: se vuelve a medir
      unidad.estado = 'pendiente';
    }
  }



  asegurar(indice) {
    const unidad = this.unidades[indice];
    if (!unidad) return Promise.reject(new Error('La frase de voz pedida no existe.'));
    if (unidad.estado === 'listo') return Promise.resolve(unidad);
    if (unidad.promesa) return unidad.promesa;
    if (!['pendiente', 'error'].includes(unidad.estado)) {
      return Promise.reject(new Error('La frase aún no tiene texto para decir.'));
    }
    unidad.estado = 'cargando';
    const version = this.versionVoz;
    unidad.promesa = (async () => {
      try {
        // Voz ya guardada (biblioteca): no gasta turno del limitador de Azure,
        // que existe para no pasar de 20 síntesis/min; sin esto, volver a un
        // video con toda su voz guardada seguiría sonando a 18 frases por minuto.
        const guardada = await Promise.resolve(this.buscarGuardada?.(unidad.text, unidad)).catch(() => null);
        if (!guardada) await this.#cupo();
        // Se pasa la unidad completa: el controlador elige la voz según el
        // hablante (diálogos con 2 voces). Las funciones viejas que solo
        // reciben el texto siguen funcionando: el 2.º argumento se ignora.
        const resultado = guardada || await this.generarAudio(unidad.text, unidad);
        const blob = resultado instanceof Blob ? resultado : resultado?.blob;
        if (!blob?.size) throw new Error('El servicio no devolvió audio.');
        if (this.destruido) throw new Error('La preparación de voz fue cancelada.');
        if (resultado?.respaldoHdr) this.onRespaldo?.(resultado, unidad);
        if (version !== this.versionVoz && unidad.startTime >= this.invalidadoDesde) {
          // La voz cambió mientras se generaba: este audio es de la voz vieja.
          unidad.estado = 'pendiente';
          return unidad;
        }
        unidad.blob = blob;
        unidad.url = URL.createObjectURL(blob);
        // La duración real deja al plan de ritmo frenar el video ANTES de que haga falta.
        const duracion = await Promise.resolve(this.medirDuracion?.(unidad.url, { blob, motor: resultado?.engineHdr })).catch(() => null);
        if (Number(duracion) > 0) unidad.duracionVoz = Number(duracion);
        if (this.destruido) throw new Error('La preparación de voz fue cancelada.');
        unidad.estado = 'listo';
        unidad.error = '';
        this.completadas += 1;
        this.onProgress(this.completadas, this.unidades.length);
        return unidad;
      } catch (error) {
        unidad.estado = 'error';
        unidad.error = String(error?.message || error || 'No se pudo generar la voz.');
        throw error;
      } finally {
        unidad.promesa = null;
      }
    })();
    return unidad.promesa;
  }



  liberar() {
    this.destruido = true;
    for (const unidad of this.unidades) {
      if (unidad.url) URL.revokeObjectURL(unidad.url);
      unidad.url = '';
      unidad.blob = null;
    }
    this.unidades = [];
  }
}
