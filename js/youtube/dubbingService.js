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

export function agruparSegmentosParaVoz(segmentos) {
  const unidades = [];
  let actual = null;

  const cerrar = () => {
    if (actual) unidades.push(actual);
    actual = null;
  };

  for (const segmento of segmentos || []) {
    const texto = String(segmento?.text || '').replace(/\s+/g, ' ').trim();
    const inicio = Number(segmento?.startTime);
    const fin = Number(segmento?.endTime);
    if (!texto || !Number.isFinite(inicio) || !Number.isFinite(fin) || fin <= inicio) continue;

    if (!actual) {
      actual = { startTime: inicio, endTime: fin, duration: fin - inicio, text: texto };
      continue;
    }

    const haySilencio = inicio - actual.endTime > MAXIMO_SALTO;
    const nuevoTexto = `${actual.text} ${texto}`;
    const duracionAcumulada = fin - actual.startTime;
    const duracionActual = actual.endTime - actual.startTime;

    // Cortar en un punto o una coma suena natural; cortar a mitad de frase, no.
    const puntoNatural = TERMINA_IDEA.test(actual.text)
      || (PAUSA_MEDIA.test(actual.text) && duracionActual >= DURACION_OBJETIVO);
    const debeCortar = haySilencio
      || duracionAcumulada > DURACION_MAXIMA
      || nuevoTexto.length > MAXIMO_CARACTERES
      || (puntoNatural && duracionActual >= DURACION_MINIMA);

    if (debeCortar) {
      cerrar();
      actual = { startTime: inicio, endTime: fin, duration: fin - inicio, text: texto };
      continue;
    }

    actual.endTime = fin;
    actual.duration = fin - actual.startTime;
    actual.text = nuevoTexto;
  }

  cerrar();
  return unidades.map((unidad, indice) => ({
    ...unidad,
    indice,
    estado: 'pendiente',
    blob: null,
    url: '',
    error: '',
    promesa: null,
  }));
}

/** Silencio posterior que una frase puede tomar prestado para no acelerar la voz. */
export const SILENCIO_PRESTADO_MAX_S = 1.5;

/**
 * Frases de voz definidas por el TIEMPO del original, no por la traducción.
 * Existen desde el primer segundo (el motor sabe dónde habrá voz aunque falte
 * traducir) y la traducción solo rellena su texto. Mismas reglas de corte que
 * `agruparSegmentosParaVoz`, aplicadas al texto original. Recibe segmentos ya
 * normalizados (`normalizarSegmentos`).
 */
export function agruparPorTiempo(segmentos) {
  const grupos = [];
  let actual = null;
  const abrir = (segmento, indice) => ({
    startTime: segmento.startTime, finHabla: segmento.endTime, desde: indice, hasta: indice, textoOriginal: segmento.text,
  });
  (segmentos || []).forEach((segmento, indice) => {
    const texto = String(segmento?.text || '').trim();
    const inicio = Number(segmento?.startTime);
    const fin = Number(segmento?.endTime);
    if (!texto || !Number.isFinite(inicio) || !Number.isFinite(fin) || fin <= inicio) return;
    if (!actual) { actual = abrir(segmento, indice); return; }
    const haySilencio = inicio - actual.finHabla > MAXIMO_SALTO;
    const nuevoTexto = `${actual.textoOriginal} ${texto}`;
    const duracionActual = actual.finHabla - actual.startTime;
    const puntoNatural = TERMINA_IDEA.test(actual.textoOriginal)
      || (PAUSA_MEDIA.test(actual.textoOriginal) && duracionActual >= DURACION_OBJETIVO);
    const debeCortar = haySilencio
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

export class DubbingService {
  constructor({ generarAudio, onProgress = () => {}, limitador = null, onRespaldo = null }) {
    if (typeof generarAudio !== 'function') {
      throw new Error('No está disponible el generador de voz en español.');
    }
    this.generarAudio = generarAudio;
    this.onProgress = onProgress;
    this.limitador = limitador;
    this.onRespaldo = onRespaldo;
    this.unidades = [];
    this.completadas = 0;
    this.destruido = false;
  }

  /** Frases ya armadas con `agruparPorTiempo` (sin texto todavía). */
  definirUnidades(unidades) {
    this.liberar();
    this.destruido = false;
    this.completadas = 0;
    this.unidades = unidades;
    return this.unidades;
  }

  /** Llegó la traducción de una frase: '' = sin voz (se oye el original). */
  fijarTexto(indice, texto) {
    const unidad = this.unidades[indice];
    if (!unidad || unidad.estado !== 'sin_traducir') return;
    unidad.text = texto;
    unidad.estado = texto ? 'pendiente' : 'sin_voz';
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
    for (const unidad of this.unidades) {
      if (unidad.startTime < tiempoS || unidad.estado !== 'listo') continue;
      if (unidad.url) URL.revokeObjectURL(unidad.url);
      unidad.url = '';
      unidad.blob = null;
      unidad.estado = 'pendiente';
    }
  }

  definirSegmentos(segmentos) {
    this.liberar();
    this.destruido = false;
    this.completadas = 0;
    this.unidades = agruparSegmentosParaVoz(segmentos);
    return this.unidades;
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
    unidad.promesa = (async () => {
      try {
        await this.#cupo();
        const resultado = await this.generarAudio(unidad.text);
        const blob = resultado instanceof Blob ? resultado : resultado?.blob;
        if (!blob?.size) throw new Error('El servicio no devolvió audio.');
        if (this.destruido) throw new Error('La preparación de voz fue cancelada.');
        if (resultado?.respaldoHdr) this.onRespaldo?.(resultado, unidad);
        unidad.blob = blob;
        unidad.url = URL.createObjectURL(blob);
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

  async prepararInicial(cantidad = 3) {
    const limite = Math.min(Math.max(1, cantidad), this.unidades.length);
    await Promise.all(Array.from({ length: limite }, (_, indice) => this.asegurar(indice)));
    return limite;
  }

  /**
   * Segundos de video ya cubiertos por voz a partir de un instante dado.
   *
   * Es la medida que importa, no el número de bloques: el servicio de voz tarda
   * entre 1 y 41 segundos por fragmento, así que lo único que evita cortes es
   * saber cuánto tiempo de reproducción hay resuelto por delante.
   */
  segundosListosDesde(tiempo) {
    const indice = this.#indiceDesde(tiempo);
    if (indice < 0) return 0;
    let fin = Math.max(tiempo, this.unidades[indice].startTime);
    for (let i = indice; i < this.unidades.length; i += 1) {
      const unidad = this.unidades[i];
      if (unidad.estado !== 'listo') break;
      fin = unidad.endTime;
    }
    return Math.max(0, fin - tiempo);
  }

  /** Genera lo necesario para tener `segundos` de video resueltos por delante. */
  async asegurarColchon(tiempo, segundos = 90, concurrencia = 3) {
    const desde = Math.max(0, this.#indiceDesde(tiempo));
    const limite = tiempo + Math.max(0, segundos);
    const pendientes = [];
    for (let i = desde; i < this.unidades.length; i += 1) {
      const unidad = this.unidades[i];
      if (unidad.startTime > limite) break;
      if (unidad.estado !== 'listo') pendientes.push(i);
    }
    if (!pendientes.length) return 0;

    let siguiente = 0;
    const trabajar = async () => {
      while (!this.destruido && siguiente < pendientes.length) {
        const indice = pendientes[siguiente];
        siguiente += 1;
        try {
          await this.asegurar(indice);
        } catch (_) {
          // Un bloque fallido no detiene al resto: el motor lo informa aparte.
        }
      }
    };
    await Promise.all(Array.from(
      { length: Math.min(Math.max(1, concurrencia), pendientes.length) },
      trabajar,
    ));
    return pendientes.length;
  }

  precargarResto(desde = 0, concurrencia = 2) {
    let siguiente = Math.max(0, desde);
    const trabajar = async () => {
      while (!this.destruido) {
        const indice = siguiente;
        siguiente += 1;
        if (indice >= this.unidades.length) return;
        try {
          await this.asegurar(indice);
        } catch (_) {
          // Un bloque fallido queda aislado. El motor podrá informar el error
          // sin cancelar los audios que sí pudieron generarse.
        }
      }
    };
    return Promise.all(Array.from(
      { length: Math.min(Math.max(1, concurrencia), this.unidades.length || 1) },
      trabajar,
    ));
  }

  /** Primera unidad que termina después de `tiempo` (o -1 si no queda ninguna). */
  #indiceDesde(tiempo) {
    const objetivo = Number(tiempo) || 0;
    let izquierda = 0;
    let derecha = this.unidades.length - 1;
    let encontrado = -1;
    while (izquierda <= derecha) {
      const mitad = Math.floor((izquierda + derecha) / 2);
      if (this.unidades[mitad].endTime > objetivo) {
        encontrado = mitad;
        derecha = mitad - 1;
      } else {
        izquierda = mitad + 1;
      }
    }
    return encontrado;
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
