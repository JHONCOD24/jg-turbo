import { crearReloj } from './reloj.js';
import {
  velocidadVoz, limitesDeUnidad, demandaVoz, tasaVideoCruda, tasaVideoObjetivo, segmentoPorAvance,
  posicionVozEnVideo, avanceDeVideo, unidadEn, rangoVoz, duracionVozEstimada,
} from './ritmoDoblaje.js';

/*
 * Motor de voz del doblaje (v4, 2026-09-26): la voz ya no se corta.
 *
 * Antes mandaba el reloj del video: al entrar en la frase siguiente se cortaba la
 * anterior y la nueva arrancaba a mitad, así que en tramos rápidos se perdía el
 * final de una frase y el principio de otra («salta líneas»). Ahora cada frase
 * suena entera y la siguiente espera su turno. Para no quedarse atrás, la voz
 * acelera un poco (ritmoDoblaje.js) y, si no alcanza, el video se frena solo en
 * pasos de 0,05 (lo que acepta YouTube). Solo si la voz queda más de
 * RETRASO_MAXIMO_S por detrás (el video no deja frenarse, la voz no llegó a
 * tiempo) se salta al punto del video: es el único caso en que se omite algo.
 */

/** Más atrás que esto, la voz se rinde y salta al punto del video. */
export const RETRASO_MAXIMO_S = 5;
/** Un salto del reloj que el avance normal no explica = la persona buscó otro punto. */
const SALTO_S = 1.5;
/** Tras un salto, tan cerca del inicio de una frase se dice desde el principio. */
const ARRANQUE_DESDE_INICIO_S = 0.6;
/** Frenar el video como mucho una vez cada 1,5 s; volver a acelerar exige 4 s de calma. */
const BAJAR_TASA_CADA_MS = 1500;
const SUBIR_TASA_CADA_MS = 4000;
/** Si YouTube no aplicó la velocidad pedida en este tiempo, el video no la admite. */
const ESPERA_TASA_MS = 2500;
/**
 * No mover el video por diferencias menores que esta: la voz las absorbe (tiene
 * holgura entre 1,12× y 1,25×). Sin este margen, el plan saltaba 0,80 ↔ 0,75
 * por milésimas (32 cambios en 3 min, simulado).
 */
const HISTERESIS_TASA = 0.04;
const ESTADOS_SIN_VOZ = new Set(['sin_voz', 'error']);

/** Percentil sobre una lista de números (para el p95 del retraso). */
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
    onRitmo = () => {},
    onTasaBase = () => {},
    crearAudio = () => new Audio(),
    reloj = null,
    ahora = () => Date.now(),
    colchonSegundos = 90,
    modoSilenciarOriginal = false,
    ritmoAutomatico = true,
  }) {
    Object.assign(this, {
      player, servicio, onStatus, onMetricas, onFin, onRitmo, onTasaBase, ahora,
      colchonSegundos, modoSilenciarOriginal, ritmoAutomatico,
    });
    // Doble audio alternado (igual que el lector PDF): mientras suena una frase,
    // la siguiente ya está cargada en el otro elemento y entra sin micro-cortes.
    this.elementos = [crearAudio(), crearAudio()];
    for (const el of this.elementos) {
      el.preload = 'auto';
      el.preservesPitch = true;
      el.crossOrigin = 'anonymous';
      // Al terminar una frase, la siguiente entra en el acto (sin esperar al tic).
      el.addEventListener('ended', () => { if (this.activo && el === this.audio) this.#tic(); });
      el.addEventListener('loadedmetadata', () => {
        if (!this.activo || el !== this.audio) return;
        this.#aplicarAvancePendiente();
        this.#tic();
      });
      el.addEventListener('error', () => { if (this.activo && el === this.audio && this.hablando >= 0) this.#fraseFallida(); });
    }
    this.cual = 0;
    this.audio = this.elementos[0];
    this.activo = false;
    this.reproduciendo = player.getPlayerState?.() === 1;
    this.hablando = -1;       // frase que suena (o espera en pausa) en `this.audio`
    this.ultima = -1;         // última frase que empezó o se dio por pasada
    this.ultimaDicha = -1;    // última frase que terminó de decirse (para el subtítulo)
    this.avancePendiente = 0;
    this.tAnterior = null;
    this.relojAnterior = 0;
    this.tasaBase = this.#tasaReal();
    this.tasaSolicitada = null;   // la que pidió el motor y aún manda
    this.tasaPedidaEn = 0;
    this.ultimoCambioTasa = Number.NEGATIVE_INFINITY;
    this.ritmoNoDisponible = false;
    this.retrasoActual = 0;
    this.retrasos = [];
    this.ultimaMuestra = Number.NEGATIVE_INFINITY;
    this.frasesHabladas = 0;
    this.frasesSaltadas = 0;
    this.cambiosTasa = 0;
    // El video no se silencia: baja de volumen. Así la música y los efectos
    // siguen sonando debajo de la voz en español, que es como suena un doblaje.
    this.volumenOriginalPrevio = 100;
    this.volumenFondo = 12;
    this.volumenVoz = 1;
    this.esperandoVoz = false;
    this.colchonPedido = false;
    this.cargaPendiente = null;
    this.avisoSinVoz = null;
    this.avisoPreparando = null;
    // `reloj` puede ser una fábrica `(tic) => reloj`: así las pruebas simulan el
    // tiempo sin esperar de verdad (tests/test_youtube_sincronia.mjs).
    this.reloj = typeof reloj === 'function'
      ? reloj(() => this.#tic())
      : (reloj || crearReloj(() => this.#tic(), { intervaloMs: 100 }));
    this.desuscribirEstado = player.suscribirEstado((estado) => this.#cambiarEstado(estado));
    this.desuscribirVelocidad = player.suscribirVelocidad((velocidad) => this.#cambioDeVelocidad(velocidad));
  }

  /** Enciende la voz sin tocar el reproductor: si el video ya corre, entra en el siguiente tic. */
  activar() {
    if (this.activo) return;
    this.activo = true;
    this.volumenOriginalPrevio = this.player.getVolume?.() ?? 100;
    if (this.player.isMuted?.()) this.player.unMute?.();
    for (const el of this.elementos) el.volume = this.volumenVoz;
    this.esperandoVoz = true;   // el original suena normal hasta que haya voz encima
    const t = Number(this.player.getCurrentTime()) || 0;
    this.#resincronizar(t);
    this.tAnterior = t;
    this.relojAnterior = this.ahora();
    this.#tic();
    if (this.reproduciendo) this.reloj.iniciar();
  }

  activarYReproducir() {
    this.activar();
    this.reproduciendo = true;
    this.reloj.iniciar();
    this.player.playVideo();
    this.#tic();
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
    this.hablando = -1;
    this.ultima = -1;
    this.ultimaDicha = -1;
    this.esperandoVoz = false;
    this.reloj.detener();
    this.#restaurarTasa();   // con el audio original, el video vuelve a la velocidad de la persona
    if (this.modoSilenciarOriginal) this.player.unMute?.();
    this.player.setVolume?.(this.volumenOriginalPrevio);
    this.onStatus('Audio original activo.', 'inactivo');
  }

  /** Ritmo automático: frenar el video cuando el español necesita más tiempo. */
  definirRitmoAutomatico(activo) {
    this.ritmoAutomatico = Boolean(activo);
    if (!this.ritmoAutomatico) this.#restaurarTasa();
    else if (this.activo) this.#tic();
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

  /**
   * Segmento que está diciendo la voz, para que el subtítulo muestre lo que se
   * oye. En la pausa entre frases se queda la última línea dicha. `null` =
   * sin voz ahora: el subtítulo sigue al reloj del video.
   */
  indiceSegmentoVoz() {
    if (!this.activo) return null;
    const unidades = this.servicio.unidades;
    if (this.hablando >= 0 && unidades[this.hablando]) {
      return segmentoPorAvance(unidades[this.hablando], this.#avance());
    }
    const dicha = unidades[this.ultimaDicha];
    if (!dicha) return null;
    const siguiente = unidades[this.ultimaDicha + 1];
    const t = Number(this.player.getCurrentTime()) || 0;
    if (t >= dicha.startTime - 0.5 && (!siguiente || t < siguiente.startTime)) return dicha.hasta;
    return null;
  }

  /** Cómo va la sincronía: retraso de la voz frente al video y lo que tuvo que hacer el motor. */
  metricas() {
    const retrasos = this.retrasos;
    const suma = retrasos.reduce((total, valor) => total + valor, 0);
    return {
      muestras: retrasos.length,
      retrasoPromedioMs: retrasos.length ? Math.round((suma / retrasos.length) * 1000) : 0,
      retrasoP95Ms: Math.round(percentil(retrasos, 0.95) * 1000),
      dentroObjetivo: retrasos.length ? retrasos.filter((v) => v <= 0.5).length / retrasos.length : 1,
      frasesHabladas: this.frasesHabladas,
      frasesSaltadas: this.frasesSaltadas,
      cambiosTasa: this.cambiosTasa,
      tasaVideo: this.#tasaReal(),
      tasaBase: this.tasaBase,
    };
  }

  #tasaReal() {
    return Number(this.player.getPlaybackRate?.()) || 1;
  }

  /**
   * Parte del audio en la que de verdad se habla: sin el silencio que la voz
   * trae delante (~0,2 s) y detrás (~0,85 s), medido en `hablaVoz.js`. Sin
   * medición, el audio entero (como antes). null = aún sin duración.
   */
  #tramo(el = this.audio, unidad = this.servicio.unidades[this.hablando]) {
    const duracion = Number(el.duration);
    if (!Number.isFinite(duracion) || duracion <= 0) return null;
    const desde = Math.min(Math.max(0, Number(unidad?.vozDesdeS) || 0), duracion);
    const medido = Number(unidad?.vozHastaS);
    const hasta = medido > desde ? Math.min(duracion, medido) : duracion;
    return { desde, hasta, duracion };
  }

  #avance() {
    const tramo = this.#tramo();
    if (!tramo) return 0;
    return Math.max(0, Math.min(1, (this.audio.currentTime - tramo.desde) / Math.max(0.01, tramo.hasta - tramo.desde)));
  }

  #restanteAudio() {
    const tramo = this.#tramo();
    if (tramo) return Math.max(0, tramo.hasta - this.audio.currentTime);
    return duracionVozEstimada(this.servicio.unidades[this.hablando]);
  }

  #cambiarEstado(estado) {
    if (estado === 'ended') this.onFin();
    this.reproduciendo = estado === 'playing';
    if (!this.activo) return;
    const t = Number(this.player.getCurrentTime()) || 0;
    if (this.reproduciendo) {
      // ¿Buscó otro punto mientras estaba en pausa o cargando? (`tAnterior`
      // guarda el último instante visto sonando: en pausa el video no avanza.)
      if (this.tAnterior !== null && Math.abs(t - this.tAnterior) > 1) this.#resincronizar(t);
      this.tAnterior = t;
      this.relojAnterior = this.ahora();
      this.reloj.iniciar();
      this.#tic();
      return;
    }
    try { this.audio.pause(); } catch (_) {}
    this.reloj.detener();
    this.#duckear(t);
  }

  #cambioDeVelocidad(valor) {
    const tasa = Number(valor) || this.#tasaReal();
    const propia = this.tasaSolicitada !== null && Math.abs(tasa - this.tasaSolicitada) < 0.011;
    if (!propia) {
      // La persona la cambió en el engranaje de YouTube: esa es su velocidad.
      this.tasaBase = tasa;
      this.tasaSolicitada = null;
      this.ultimoCambioTasa = this.ahora();
      this.onTasaBase(tasa);
    }
    this.onRitmo(tasa, { automatica: tasa < this.tasaBase - 0.001, base: this.tasaBase });
    if (this.activo) this.#tic();
  }

  #tic() {
    if (!this.activo) return;
    const t = Number(this.player.getCurrentTime()) || 0;
    const ahora = this.ahora();
    const tasa = this.#tasaReal();
    if (this.#huboSalto(t, ahora, tasa)) this.#resincronizar(t);
    this.#mantenerColchon(t);
    if (this.reproduciendo) {
      if (this.hablando >= 0) this.#seguirFrase(t, tasa);
      if (this.hablando < 0) this.#quizasEmpezar(t, tasa);
      this.#precargarSiguiente();
      this.#ajustarRitmo(t, tasa, ahora);
    }
    this.#medir(t, ahora);
    this.#duckear(t);
  }

  #huboSalto(t, ahora, tasa) {
    const antes = this.tAnterior;
    const relojAntes = this.relojAnterior;
    if (!this.reproduciendo) return false;   // en pausa, `#cambiarEstado` compara al reanudar
    this.tAnterior = t;
    this.relojAnterior = ahora;
    if (antes === null) return false;
    const esperado = antes + ((ahora - relojAntes) / 1000) * tasa;
    return Math.abs(t - esperado) > SALTO_S;
  }

  /** La frase que suena: termina entera, a la velocidad que le toque. */
  #seguirFrase(t, tasa) {
    const el = this.audio;
    const tramo = this.#tramo(el);
    // Terminó de verdad: `ended`, quedó detenida en su último instante o llegó
    // al final MEDIDO de la voz (lo que sigue es silencio: hablaVoz.js). Nunca
    // «casi al final» a ojo: dar la frase por dicha antes cortaba su última sílaba.
    const vozDicha = tramo && tramo.hasta < tramo.duracion - 0.01 && el.currentTime >= tramo.hasta;
    if (el.ended || vozDicha || (tramo && el.paused && el.currentTime >= tramo.duracion - 0.05)) {
      if (vozDicha && !el.paused) { try { el.pause(); } catch (_) {} }
      this.ultimaDicha = this.hablando;
      this.hablando = -1;
      return;
    }
    if (tramo) {
      const { suave, duro } = limitesDeUnidad(this.servicio.unidades, this.hablando);
      const velocidad = velocidadVoz({
        restanteS: tramo.hasta - el.currentTime, tiempoVideo: t, limiteSuave: suave, limiteDuro: duro,
        tasaVideo: tasa, tasaBase: this.tasaBase,
      });
      if (Math.abs((Number(el.playbackRate) || 1) - velocidad) >= 0.03) el.playbackRate = velocidad;
    }
    if (el.paused) this.#reproducir(el);
  }

  /** Voz libre: ¿le toca ya a la siguiente frase? */
  #quizasEmpezar(t, tasa) {
    const unidades = this.servicio.unidades;
    let j = this.ultima + 1;
    // Frases sin voz posible: ahí suena el original y la voz sigue con la próxima.
    while (j < unidades.length && ESTADOS_SIN_VOZ.has(unidades[j].estado) && unidades[j].startTime <= t + 0.03) {
      this.#avisarSinVoz(j);
      this.ultima = j;
      j += 1;
    }
    const unidad = unidades[j];
    if (!unidad || unidad.startTime > t + 0.03) return;   // aún no le toca: pausa natural
    if (t - unidad.startTime > RETRASO_MAXIMO_S) {
      this.#resincronizar(t, { omitir: true });
      return;
    }
    if (unidad.estado !== 'listo') { this.#pedirFrase(j); return; }   // mientras, suena el original
    this.#empezar(j, 0, t, tasa);
  }

  /** Arranca una frase desde `avance` (0 = el principio). */
  #empezar(indice, avance = 0, t = Number(this.player.getCurrentTime()) || 0, tasa = this.#tasaReal()) {
    const unidad = this.servicio.unidades[indice];
    if (!unidad?.url) return;
    const anterior = this.audio;
    const libre = this.elementos[1 - this.cual];
    // El elemento libre suele traer esta frase precargada: suena al instante.
    if (libre !== anterior) {
      try { anterior.pause(); } catch (_) {}
      this.cual = 1 - this.cual;
    }
    this.audio = this.elementos[this.cual];
    const el = this.audio;
    if (el.src !== unidad.url) {
      el.src = unidad.url;
      el.load();
    }
    el.volume = this.volumenVoz;
    el.playbackRate = rangoVoz(this.tasaBase).min;
    this.hablando = indice;
    this.ultima = indice;
    this.frasesHabladas += 1;
    this.avisoPreparando = null;
    this.avancePendiente = Math.max(0, Math.min(1, Number(avance) || 0));
    this.#aplicarAvancePendiente();
    this.#seguirFrase(t, tasa);
  }

  /** Sitúa la frase en su punto en cuanto se conoce su duración. */
  #aplicarAvancePendiente() {
    if (this.hablando < 0 || this.avancePendiente === null) return;
    const tramo = this.#tramo();
    if (!tramo) return;
    // Avance 0 = donde empieza la voz: el silencio de delante no se oye.
    const punto = tramo.desde + this.avancePendiente * (tramo.hasta - tramo.desde);
    try { this.audio.currentTime = Math.min(punto, Math.max(0, tramo.hasta - 0.05)); } catch (_) {}
    this.avancePendiente = null;
  }

  #reproducir(el) {
    if (!this.reproduciendo || !el.src || el.jgPidiendo) return;
    el.jgPidiendo = true;
    let intento;
    try { intento = el.play(); } catch (_) { el.jgPidiendo = false; return; }
    Promise.resolve(intento).then(() => { el.jgPidiendo = false; }).catch((error) => {
      el.jgPidiendo = false;
      // Un cambio de frase aborta el play() anterior: eso no es un bloqueo.
      if (error?.name === 'NotAllowedError' && this.activo) {
        this.onStatus('Pulsa otra vez “Ver con voz en español” para habilitar el audio.', 'error');
      }
    });
  }

  /**
   * Vuelve a situar la voz en el punto del video (salto de la persona, o voz
   * demasiado atrasada). Dentro de una frase ya lista, se retoma en su punto.
   */
  #resincronizar(t, { omitir = false } = {}) {
    const unidades = this.servicio.unidades;
    try { this.audio.pause(); } catch (_) {}
    const antes = this.ultima;
    this.hablando = -1;
    this.ultimaDicha = -1;
    const j = unidadEn(unidades, t);
    if (j < 0) { this.ultima = unidades.length - 1; return; }
    const unidad = unidades[j];
    const finHabla = Number(unidad.finHabla ?? unidad.endTime);
    let retomar = false;
    if (t <= unidad.startTime + ARRANQUE_DESDE_INICIO_S) this.ultima = j - 1;
    else if (t < finHabla - 0.3 && unidad.estado === 'listo') { this.ultima = j - 1; retomar = true; }
    else this.ultima = j;
    if (omitir) this.frasesSaltadas += Math.max(0, this.ultima - antes);
    if (retomar) this.#empezar(j, avanceDeVideo(unidad, t), t);
  }

  #pedirFrase(indice) {
    const unidad = this.servicio.unidades[indice];
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
    Promise.resolve(this.servicio.asegurar(indice))
      .then(() => { if (this.activo) this.onStatus('Voz en español activa.', 'activo'); })
      .catch(() => { /* quedó en «error»: el siguiente tic la da por pasada y lo anuncia */ })
      .finally(() => {
        if (this.cargaPendiente === indice) this.cargaPendiente = null;
        if (this.activo) this.#tic();
      });
  }

  #avisarSinVoz(indice) {
    if (this.avisoSinVoz === indice) return;
    this.avisoSinVoz = indice;
    this.onStatus('Este tramo suena en su idioma original.', 'error');
  }

  #fraseFallida() {
    const unidad = this.servicio.unidades[this.hablando];
    if (unidad) unidad.estado = 'error';
    this.ultimaDicha = this.hablando;
    this.hablando = -1;
    this.onStatus('No se pudo reproducir un tramo de voz: suena el original.', 'error');
  }

  /** Deja la frase inmediata cargada en el elemento libre (sin sonarla). */
  #precargarSiguiente() {
    const libre = this.elementos[1 - this.cual];
    // Si la fábrica devolvió el mismo elemento dos veces no hay libre: sin
    // este freno, la precarga pisaría la frase que está sonando.
    if (libre === this.audio) return;
    const siguiente = this.servicio.unidades[(this.hablando >= 0 ? this.hablando : this.ultima) + 1];
    if (!siguiente || siguiente.estado !== 'listo' || !siguiente.url || libre.src === siguiente.url) return;
    try {
      libre.src = siguiente.url;
      libre.load();
      libre.volume = this.volumenVoz;
    } catch (_) {}
  }

  /** Frena el video lo justo para que la voz quepa; vuelve a la velocidad elegida cuando sobra tiempo. */
  #ajustarRitmo(t, tasa, ahora) {
    if (!this.ritmoAutomatico || this.ritmoNoDisponible) return;
    if (this.tasaSolicitada !== null && Math.abs(tasa - this.tasaSolicitada) > 0.011 && ahora - this.tasaPedidaEn > ESPERA_TASA_MS) {
      // YouTube ignoró la petición (directos, por ejemplo): no insistir.
      this.ritmoNoDisponible = true;
      this.tasaSolicitada = null;
      this.onStatus('Este video no deja cambiar su velocidad: la voz se pone al día en las pausas.', 'activo');
      return;
    }
    const siguiente = (this.hablando >= 0 ? this.hablando : this.ultima) + 1;
    // Esperando una voz que aún no llegó (traducción o síntesis demoradas):
    // frenar el video solo dejaría el inglés en cámara lenta. No se toca.
    const pendiente = this.servicio.unidades[siguiente];
    if (this.hablando < 0 && pendiente && pendiente.startTime <= t && pendiente.estado !== 'listo') return;
    const plan = {
      ...demandaVoz({
        unidades: this.servicio.unidades, tiempoVideo: t, siguiente,
        restanteS: this.hablando >= 0 ? this.#restanteAudio() : 0,
      }),
      tasaBase: this.tasaBase,
      retrasoS: this.retrasoActual,
    };
    const actual = this.tasaSolicitada ?? tasa;
    const cruda = tasaVideoCruda(plan);
    // Volver a la velocidad elegida sí se hace aunque la diferencia sea chica.
    if (Math.abs(cruda - actual) < HISTERESIS_TASA && !(cruda >= this.tasaBase - 1e-9 && actual < this.tasaBase)) return;
    const objetivo = tasaVideoObjetivo(plan);
    if (Math.abs(objetivo - actual) < 0.011) return;
    const desde = ahora - this.ultimoCambioTasa;
    if (objetivo < actual && desde < BAJAR_TASA_CADA_MS) return;
    if (objetivo > actual && (desde < SUBIR_TASA_CADA_MS || this.retrasoActual > 0.5)) return;
    this.#fijarTasaVideo(objetivo, ahora);
  }

  #fijarTasaVideo(tasa, ahora = this.ahora()) {
    this.tasaSolicitada = tasa;
    this.tasaPedidaEn = ahora;
    this.ultimoCambioTasa = ahora;
    this.cambiosTasa += 1;
    this.player.setPlaybackRate?.(tasa);
  }

  #restaurarTasa() {
    if (this.tasaSolicitada === null) return;
    if (Math.abs(this.#tasaReal() - this.tasaBase) > 0.011) this.#fijarTasaVideo(this.tasaBase);
    else this.tasaSolicitada = null;
  }

  /** Retraso de la voz frente al video (segundos), medido cada 250 ms. */
  #medir(t, ahora) {
    const unidades = this.servicio.unidades;
    let retraso = 0;
    if (this.hablando >= 0 && unidades[this.hablando]) {
      retraso = t - posicionVozEnVideo(unidades[this.hablando], this.#avance());
    } else {
      const siguiente = unidades[this.ultima + 1];
      if (siguiente && siguiente.startTime <= t && !ESTADOS_SIN_VOZ.has(siguiente.estado)) retraso = t - siguiente.startTime;
    }
    this.retrasoActual = Math.max(0, retraso);
    if (!this.reproduciendo || ahora - this.ultimaMuestra < 250) return;
    this.ultimaMuestra = ahora;
    this.retrasos.push(this.retrasoActual);
    if (this.retrasos.length > 1200) this.retrasos.shift();
    if (this.retrasos.length % 20 === 0) this.onMetricas(this.metricas());
  }

  /** El original baja mientras hay voz (o está por entrar); sube en los silencios y donde no hay doblaje. */
  #duckear(t) {
    let hayVoz = this.hablando >= 0;
    if (!hayVoz) {
      const unidades = this.servicio.unidades;
      const j = unidadEn(unidades, t);
      const unidad = unidades[j];
      hayVoz = Boolean(unidad && unidad.estado === 'listo' && unidad.startTime <= t && t < limitesDeUnidad(unidades, j).suave);
    }
    this.#audioOriginalEnPrimerPlano(hayVoz);
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

  destruir() {
    this.desactivar();
    this.desuscribirEstado?.();
    this.desuscribirVelocidad?.();
    this.audio.removeAttribute('src');
    this.audio.load();
  }
}
