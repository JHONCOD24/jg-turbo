import { buscarIndiceSegmento } from './syncEngine.js';

// Objetivo de sincronía: el arranque de cada frase no debe separarse más de
// 150 ms de la voz original. Por debajo de eso el oído no lo nota.
export const DESFASE_OBJETIVO_S = 0.15;
// Por encima de esto ya no se disimula con velocidad: se salta al punto exacto.
export const DESFASE_SALTO_S = 0.4;
// Rango de velocidad en el que una voz sigue sonando natural. El límite viejo
// era 4x, que es ininteligible: el español ocupa más tiempo que el inglés y casi
// siempre pedía acelerar, así que la voz se volvía un chillido.
export const VELOCIDAD_MINIMA = 0.85;
export const VELOCIDAD_MAXIMA = 1.35;
// Corrección fina: empujar o frenar un 6 % es imperceptible y evita saltos.
const AJUSTE_FINO_MAXIMO = 0.06;
// Margen que se le concede a una frase para terminar su última sílaba.
const GRACIA_COLA_S = 0.45;

/**
 * Velocidad a la que debe sonar la voz para caber en su ventana de video.
 *
 * Ahora puede frenar además de acelerar (antes solo aceleraba), y se mantiene
 * dentro de un rango que sigue sonando a persona. Si ni al máximo cabe, se deja
 * desbordar: es preferible una frase que invade un poco a una ininteligible.
 */
export function calcularVelocidadAudio(duracionAudio, duracionVideo, velocidadVideo = 1) {
  const audio = Number(duracionAudio);
  const video = Number(duracionVideo);
  const velocidad = Number(velocidadVideo) || 1;
  if (!(audio > 0) || !(video > 0)) return velocidad;
  const necesaria = audio / video;
  const acotada = Math.min(VELOCIDAD_MAXIMA, Math.max(VELOCIDAD_MINIMA, necesaria));
  return acotada * velocidad;
}

export function calcularTiempoAudio(
  tiempoVideo,
  unidad,
  duracionAudio,
  velocidadVideo = 1,
  velocidadAudio = velocidadVideo,
) {
  const duracionVideo = Number(unidad?.endTime) - Number(unidad?.startTime);
  if (!(duracionVideo > 0) || !(duracionAudio > 0)) return 0;
  const avanceVideo = Math.min(duracionVideo, Math.max(0, tiempoVideo - unidad.startTime));
  const tasaVideo = Math.max(0.1, Number(velocidadVideo) || 1);
  const tasaAudio = Math.max(0.1, Number(velocidadAudio) || tasaVideo);
  return Math.min(duracionAudio, avanceVideo * tasaAudio / tasaVideo);
}

/** Factor suave para reabsorber un desfase pequeño sin que se oiga el ajuste. */
export function ajusteFino(desfase) {
  const error = Number(desfase) || 0;
  if (Math.abs(error) <= DESFASE_OBJETIVO_S) return 1;
  // desfase positivo = la voz va adelantada → frenar un poco.
  const correccion = Math.max(-AJUSTE_FINO_MAXIMO, Math.min(AJUSTE_FINO_MAXIMO, -error * 0.15));
  return 1 + correccion;
}

/** Percentil sobre una lista de números (para el p95 de desfase). */
export function percentil(valores, p = 0.95) {
  const datos = (valores || []).filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (!datos.length) return 0;
  const posicion = Math.min(datos.length - 1, Math.max(0, Math.ceil(p * datos.length) - 1));
  return datos[posicion];
}

export class DubbingEngine {
  constructor({
    player,
    servicio,
    onStatus = () => {},
    onMetricas = () => {},
    crearAudio = () => new Audio(),
    colchonSegundos = 90,
  }) {
    this.player = player;
    this.servicio = servicio;
    this.onStatus = onStatus;
    this.onMetricas = onMetricas;
    this.colchonSegundos = colchonSegundos;
    this.audio = crearAudio();
    this.audio.preload = 'auto';
    this.audio.preservesPitch = true;
    this.audio.crossOrigin = 'anonymous';
    this.activo = false;
    this.reproduciendo = false;
    this.indice = -1;
    this.frame = 0;
    this.cargaPendiente = null;
    this.colchonPedido = false;
    this.esperandoVoz = false;
    this.volumenOriginalPrevio = 100;
    // El video no se silencia: baja de volumen. Así la música y los efectos
    // siguen sonando debajo de la voz en español, que es como suena un doblaje.
    this.volumenFondo = 12;
    this.volumenVoz = 1;
    this.desfases = [];
    this.ultimaMuestra = 0;
    this.desuscribirEstado = player.suscribirEstado((estado) => this.#cambiarEstado(estado));
    this.desuscribirVelocidad = player.suscribirVelocidad(() => this.#actualizar(true));
    this.audio.addEventListener('loadedmetadata', () => this.#actualizar(true));
    this.audio.addEventListener('error', () => {
      if (this.activo) this.onStatus('No se pudo reproducir un bloque de voz.', 'error');
    });
  }

  activarYReproducir() {
    if (this.activo) return;
    this.activo = true;
    this.volumenOriginalPrevio = this.player.getVolume?.() ?? 100;
    if (this.player.isMuted?.()) this.player.unMute?.();
    this.player.setVolume?.(this.volumenFondo);
    this.audio.volume = this.volumenVoz;
    this.reproduciendo = true;
    this.#actualizar(true);
    // Se intenta iniciar el elemento de audio dentro del clic del usuario. Esto
    // respeta el bloqueo de reproducción automática de los navegadores móviles.
    if (this.audio.src) this.audio.play().catch(() => {});
    this.player.playVideo();
    this.onStatus('Voz en español activa.', 'activo');
  }

  desactivar() {
    if (!this.activo) return;
    this.activo = false;
    this.audio.pause();
    this.audio.removeAttribute('src');
    this.audio.load();
    this.indice = -1;
    this.esperandoVoz = false;
    cancelAnimationFrame(this.frame);
    this.frame = 0;
    this.player.setVolume?.(this.volumenOriginalPrevio);
    this.onStatus('Audio original activo.', 'inactivo');
  }

  /** Volumen del audio original bajo la voz doblada (0 a 100). */
  definirVolumenFondo(valor) {
    this.volumenFondo = Math.max(0, Math.min(100, Number(valor) || 0));
    if (this.activo && !this.esperandoVoz) this.player.setVolume?.(this.volumenFondo);
  }

  /** Volumen de la voz en español (0 a 1). */
  definirVolumenVoz(valor) {
    this.volumenVoz = Math.max(0, Math.min(1, Number(valor)));
    this.audio.volume = this.volumenVoz;
  }

  /** Desfase medido: promedio y p95 en milisegundos. */
  metricas() {
    const absolutos = this.desfases.map((d) => Math.abs(d));
    const suma = absolutos.reduce((total, valor) => total + valor, 0);
    return {
      muestras: absolutos.length,
      promedioMs: absolutos.length ? Math.round((suma / absolutos.length) * 1000) : 0,
      p95Ms: Math.round(percentil(absolutos, 0.95) * 1000),
      dentroObjetivo: absolutos.length
        ? absolutos.filter((v) => v <= DESFASE_OBJETIVO_S).length / absolutos.length
        : 1,
    };
  }

  #cambiarEstado(estado) {
    this.reproduciendo = estado === 'playing';
    if (!this.activo) return;
    if (this.reproduciendo) {
      this.#actualizar(true);
      this.#programar();
    } else {
      this.audio.pause();
      cancelAnimationFrame(this.frame);
      this.frame = 0;
      this.#actualizar(true);
    }
  }

  #programar() {
    if (this.frame || !this.activo || !this.reproduciendo) return;
    const tick = () => {
      this.frame = 0;
      this.#actualizar();
      this.#programar();
    };
    this.frame = requestAnimationFrame(tick);
  }

  #actualizar(forzar = false) {
    if (!this.activo) return;
    const tiempoVideo = this.player.getCurrentTime();
    this.#mantenerColchon(tiempoVideo);
    const indice = buscarIndiceSegmento(this.servicio.unidades, tiempoVideo);
    if (indice < 0) {
      // Hueco sin diálogo: el audio original sube y se oye el video tal cual.
      this.audio.pause();
      this.indice = -1;
      this.#audioOriginalEnPrimerPlano(false);
      return;
    }

    const unidad = this.servicio.unidades[indice];
    if (unidad.estado !== 'listo') {
      this.#resolverBloqueFaltante(indice);
      return;
    }
    this.#audioOriginalEnPrimerPlano(true);

    // Gracia de cola: si el video ya entró en la frase siguiente pero a la
    // anterior le faltan milésimas, se la deja terminar. Cortar la última
    // sílaba se nota mucho más que un solapamiento mínimo.
    if (indice === this.indice + 1 && !this.audio.paused && !this.audio.ended) {
      const restante = Number(this.audio.duration) - this.audio.currentTime;
      if (Number.isFinite(restante) && restante > 0 && restante <= GRACIA_COLA_S) return;
    }

    if (indice !== this.indice || this.audio.src !== unidad.url) {
      this.indice = indice;
      this.audio.src = unidad.url;
      this.audio.load();
      forzar = true;
    }

    const duracionAudio = Number(this.audio.duration);
    if (!Number.isFinite(duracionAudio) || duracionAudio <= 0) return;
    const velocidadVideo = this.player.getPlaybackRate();
    const velocidadBase = calcularVelocidadAudio(
      duracionAudio,
      unidad.duration,
      velocidadVideo,
    );
    const esperado = calcularTiempoAudio(
      tiempoVideo,
      unidad,
      duracionAudio,
      velocidadVideo,
      velocidadBase,
    );
    const desfase = this.audio.currentTime - esperado;
    this.#medir(desfase);

    // Tres niveles de corrección: nada si ya está en objetivo, un empujón
    // imperceptible si se desvió poco, y un salto solo cuando el salto ya se
    // nota menos que el desfase.
    this.audio.playbackRate = velocidadBase * ajusteFino(desfase);
    if (forzar || Math.abs(desfase) > DESFASE_SALTO_S) {
      try {
        this.audio.currentTime = Math.min(esperado, Math.max(0, duracionAudio - 0.02));
      } catch (_) {}
    }
    if (this.reproduciendo && this.audio.paused && !this.audio.ended && esperado < duracionAudio - 0.04) {
      this.audio.play().catch(() => {
        this.onStatus('Pulsa otra vez “Reproducir con voz” para habilitar el audio.', 'error');
      });
    }
  }

  /** Sube el original mientras no hay voz que poner encima. */
  #audioOriginalEnPrimerPlano(hayVoz) {
    const esperando = !hayVoz;
    if (esperando === this.esperandoVoz) return;
    this.esperandoVoz = esperando;
    this.player.setVolume?.(esperando ? this.volumenOriginalPrevio : this.volumenFondo);
  }

  #medir(desfase) {
    const ahora = Date.now();
    if (ahora - this.ultimaMuestra < 250) return;
    this.ultimaMuestra = ahora;
    this.desfases.push(desfase);
    if (this.desfases.length > 600) this.desfases.shift();
    if (this.desfases.length % 20 === 0) this.onMetricas(this.metricas());
  }

  /** Pide voz por adelantado para que la reproducción no alcance al generador. */
  #mantenerColchon(tiempoVideo) {
    if (!this.reproduciendo || this.colchonPedido) return;
    if (typeof this.servicio.segundosListosDesde !== 'function') return;
    if (this.servicio.segundosListosDesde(tiempoVideo) >= this.colchonSegundos * 0.5) return;
    this.colchonPedido = true;
    Promise.resolve(this.servicio.asegurarColchon(tiempoVideo, this.colchonSegundos))
      .catch(() => {})
      .finally(() => { this.colchonPedido = false; });
  }

  #resolverBloqueFaltante(indice) {
    // Ya no se pausa el video: se deja sonar el audio original mientras llega la
    // voz. Congelar la imagen era peor que un tramo en inglés, y el servicio de
    // voz puede tardar hasta 41 s en un fragmento.
    this.#audioOriginalEnPrimerPlano(false);
    this.audio.pause();
    if (this.cargaPendiente === indice) return;
    if (this.servicio.unidades[indice]?.estado === 'error') {
      this.onStatus('Este tramo se quedó sin voz: sigue en su idioma original.', 'error');
      return;
    }
    this.cargaPendiente = indice;
    this.onStatus('Alcanzamos la voz generada: suena el audio original un momento…', 'cargando');
    this.servicio.asegurar(indice).then(() => {
      this.cargaPendiente = null;
      this.#actualizar(true);
      if (this.activo) this.onStatus('Voz en español activa.', 'activo');
    }).catch((error) => {
      this.cargaPendiente = null;
      this.onStatus(`No se pudo generar este tramo: ${error?.message || error}`, 'error');
    });
  }

  destruir() {
    this.desactivar();
    this.desuscribirEstado?.();
    this.desuscribirVelocidad?.();
    this.audio.removeAttribute('src');
    this.audio.load();
  }
}
