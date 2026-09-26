import { crearReloj } from './reloj.js';
import { buscarIndiceSegmento } from './syncEngine.js';

// Objetivo de sincronía: el arranque de cada frase no debe separarse más de
// 150 ms de la voz original. Por debajo de eso el oído no lo nota.
export const DESFASE_OBJETIVO_S = 0.15;
// Por encima de esto ya no se disimula con velocidad: se salta al punto exacto.
export const DESFASE_SALTO_S = 0.4;
// Rango de velocidad en el que una voz sigue sonando natural. El límite viejo
// era 4x, que es ininteligible: el español ocupa más que el inglés y casi
// siempre pedía acelerar, así que la voz se volvía un chillido.
// Medido 2026-09-25: con 0,85–1,35 la voz saltaba de «cámara lenta» a «ardilla» entre frases. Con el silencio prestado (T2.1) casi siempre cabe sin pasar de 1,25.
// Ajuste 2026-09-26: 0,95–1,20. El 0,90 se oía frenado («frenos en la voz») y
// con 2 s de silencio prestado casi nunca hace falta bajar tanto ni subir de 1,20.
export const VELOCIDAD_MINIMA = 0.95;
export const VELOCIDAD_MAXIMA = 1.2;
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
    onFin = () => {},
    crearAudio = () => new Audio(),
    reloj = null,
    colchonSegundos = 90,
    modoSilenciarOriginal = false,
  }) {
    this.player = player;
    this.servicio = servicio;
    this.onStatus = onStatus;
    this.onMetricas = onMetricas;
    this.onFin = onFin;
    this.colchonSegundos = colchonSegundos;
    this.modoSilenciarOriginal = modoSilenciarOriginal;
    // Doble audio alternado (igual que el lector PDF desde v2.8.0): mientras
    // suena una frase, la otra ya tiene la siguiente cargada. Con un solo
    // elemento, cada cambio de frase era pausa + src + load + play: de ahí los
    // micro-cortes («frenos») entre frases seguidas.
    this.elementos = [crearAudio(), crearAudio()];
    for (const el of this.elementos) {
      el.preload = 'auto';
      el.preservesPitch = true;
      el.crossOrigin = 'anonymous';
    }
    this.cual = 0;
    this.audio = this.elementos[0];
    this.activo = false;
    this.reproduciendo = player.getPlayerState?.() === 1;
    this.indice = -1;
    this.reloj = reloj || crearReloj(() => this.#actualizar(), { intervaloMs: 100 });
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
    for (const el of this.elementos) {
      el.addEventListener('loadedmetadata', () => this.#actualizar(true));
      el.addEventListener('error', () => {
        if (this.activo) this.onStatus('No se pudo reproducir un bloque de voz.', 'error');
      });
    }
  }

  /** Enciende la voz sin tocar el reproductor: si el video ya corre, entra en el siguiente tic. */
  activar() {
    if (this.activo) return;
    this.activo = true;
    this.volumenOriginalPrevio = this.player.getVolume?.() ?? 100;
    if (this.player.isMuted?.()) this.player.unMute?.();
    for (const el of this.elementos) el.volume = this.volumenVoz;
    this.esperandoVoz = true;   // el original suena normal hasta que haya voz encima
    this.#actualizar(true);
    if (this.reproduciendo) this.reloj.iniciar();
  }

  activarYReproducir() {
    this.activar();
    this.reproduciendo = true;
    this.reloj.iniciar();
    if (this.audio.src) this.audio.play().catch(() => {});
    this.player.playVideo();
    this.onStatus('Voz en español activa.', 'activo');
  }

  desactivar() {
    if (!this.activo) return;
    this.activo = false;
    for (const el of this.elementos) {
      el.pause();
      el.removeAttribute('src');
      el.load();
    }
    this.cual = 0;
    this.audio = this.elementos[0];
    this.indice = -1;
    this.esperandoVoz = false;
    this.reloj.detener();
    if (this.modoSilenciarOriginal) this.player.unMute?.();
    this.player.setVolume?.(this.volumenOriginalPrevio);
    this.onStatus('Audio original activo.', 'inactivo');
  }

  /** Volumen del audio original bajo la voz doblada (0 a 100). */
  definirVolumenFondo(valor) {
    this.volumenFondo = Math.max(0, Math.min(100, Number(valor) || 0));
    if (this.modoSilenciarOriginal) return;
    if (this.activo && !this.esperandoVoz) this.player.setVolume?.(this.volumenFondo);
  }

  /** Volumen de la voz en español (0 a 1). */
  definirVolumenVoz(valor) {
    this.volumenVoz = Math.max(0, Math.min(1, Number(valor)));
    for (const el of this.elementos) el.volume = this.volumenVoz;
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
    if (estado === 'ended') this.onFin();
    this.reproduciendo = estado === 'playing';
    if (!this.activo) return;
    if (this.reproduciendo) {
      this.#actualizar(true);
      this.reloj.iniciar();
    } else {
      this.audio.pause();
      this.reloj.detener();
      this.#actualizar(true);
    }
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
      this.#cambiarA(indice, unidad);
      forzar = true;
    } else {
      this.#precargarSiguiente(indice);
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

  /** Cambia a la frase sin cortar la anterior a la fuerza: el elemento libre
   * ya suele traerla precargada, así que suena al instante (sin frenos). */
  #cambiarA(indice, unidad) {
    const anterior = this.audio;
    const siguiente = this.elementos[1 - this.cual];
    try { anterior.pause(); } catch (_) {}
    this.cual = 1 - this.cual;
    this.audio = siguiente;
    this.indice = indice;
    siguiente.volume = this.volumenVoz;
    if (siguiente.src !== unidad.url) {
      siguiente.src = unidad.url;
      siguiente.load();
    }
  }

  /** Deja la frase inmediata cargada en el elemento libre (sin sonarla). */
  #precargarSiguiente(indice) {
    const libre = this.elementos[1 - this.cual];
    // Si la fábrica devolvió el mismo elemento dos veces no hay libre: sin
    // este freno, la precarga pisaría la frase que está sonando.
    if (libre === this.audio) return;
    const siguiente = this.servicio.unidades[indice + 1];
    if (!siguiente || siguiente.estado !== 'listo' || !siguiente.url) return;
    if (libre.src === siguiente.url) return;
    try {
      libre.src = siguiente.url;
      libre.load();
      libre.volume = this.volumenVoz;
    } catch (_) {}
  }

  /** Sube el original mientras no hay voz que poner encima. */
  #audioOriginalEnPrimerPlano(hayVoz) {
    const esperando = !hayVoz;
    if (esperando === this.esperandoVoz) return;
    this.esperandoVoz = esperando;
    if (this.modoSilenciarOriginal) {
      // iPhone: Safari no deja bajar el volumen desde código; se silencia mientras hay voz.
      if (hayVoz) this.player.mute?.(); else this.player.unMute?.();
      return;
    }
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
    // Nunca se pausa el video: mientras falte la voz de este tramo suena el original.
    this.#audioOriginalEnPrimerPlano(false);
    this.audio.pause();
    const unidad = this.servicio.unidades[indice];
    if (unidad.estado === 'sin_voz' || unidad.estado === 'error') {
      if (this.avisoSinVoz !== indice) {
        this.avisoSinVoz = indice;
        this.onStatus('Este tramo suena en su idioma original.', 'error');
      }
      return;
    }
    if (unidad.estado === 'sin_traducir') {
      if (this.avisoPreparando !== indice) {
        this.avisoPreparando = indice;
        this.onStatus('Preparando el doblaje de este tramo…', 'cargando');
      }
      return;   // el motor de preparación ya va por él: prioriza la posición actual
    }
    if (this.cargaPendiente === indice) return;
    this.cargaPendiente = indice;
    this.onStatus('Preparando la voz de este tramo…', 'cargando');
    this.servicio.asegurar(indice).then(() => {
      this.cargaPendiente = null;
      this.#actualizar(true);
      if (this.activo) this.onStatus('Voz en español activa.', 'activo');
    }).catch(() => {
      this.cargaPendiente = null;   // quedó en «error»: el siguiente tic lo anuncia
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
