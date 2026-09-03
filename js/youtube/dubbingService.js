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

export class DubbingService {
  constructor({ generarAudio, onProgress = () => {} }) {
    if (typeof generarAudio !== 'function') {
      throw new Error('No está disponible el generador de voz en español.');
    }
    this.generarAudio = generarAudio;
    this.onProgress = onProgress;
    this.unidades = [];
    this.completadas = 0;
    this.destruido = false;
  }

  definirSegmentos(segmentos) {
    this.liberar();
    this.destruido = false;
    this.completadas = 0;
    this.unidades = agruparSegmentosParaVoz(segmentos);
    return this.unidades;
  }

  async asegurar(indice) {
    const unidad = this.unidades[indice];
    if (!unidad) throw new Error('El bloque de voz solicitado no existe.');
    if (unidad.estado === 'listo') return unidad;
    if (unidad.promesa) return unidad.promesa;

    unidad.estado = 'cargando';
    unidad.promesa = (async () => {
      try {
        const resultado = await this.generarAudio(unidad.text);
        const blob = resultado instanceof Blob ? resultado : resultado?.blob;
        if (!blob?.size) throw new Error('El servicio no devolvió audio.');
        if (this.destruido) throw new Error('La preparación de voz fue cancelada.');
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
