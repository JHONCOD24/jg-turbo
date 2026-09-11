/* JG Turbo · Música de fondo para el módulo PDF
 *
 * Mezclador de audio web local-first para lectura concentrada.
 * Permite escuchar música instrumental de estudio en alta calidad mientras la voz
 * neural narra el texto, con volumen independiente, ducking automático
 * («bajar música cuando habla la voz»), fundidos suaves al pausar/reanudar,
 * reproducción aleatoria continua por categoría con fundido cruzado (crossfade)
 * de estudio y persistencia sin conexión.
 */

export const ANIMOS = {
  concentracion: {
    id: 'concentracion',
    label: 'Concentración',
    emoji: '🎯',
    desc: 'Enfoque y claridad mental (Deep Work Flow, Hypnotic Pulse, Resonant Mind)',
  },
  relax: {
    id: 'relax',
    label: 'Relax',
    emoji: '🌿',
    desc: 'Calma y lectura pausada (Felt & Cello, Quiet Pages, Reading Space, Still Waters Spa)',
  },
  noche: {
    id: 'noche',
    label: 'Noche',
    emoji: '🌙',
    desc: 'Tonos graves y reposo nocturno (Late Hours, Slow Waves)',
  },
  lluvia: {
    id: 'lluvia',
    label: 'Lluvia suave',
    emoji: '🌧️',
    desc: 'Ambiente reconfortante de lluvia y piano (Gentle Window Rain, Rain & Felt Piano)',
  },
};

export const CATALOGO_PISTAS = [
  // ── Concentración (3 pistas) ──
  {
    id: 'concentracion_deep_work_flow',
    animo: 'concentracion',
    nombre: 'Deep Work Flow',
    duracion: '2:25',
    duracionSeg: 145.98,
    desc: 'Pulso ambiental armónico para entrar en estado de flujo profundo',
    src: '/audio/musica/concentracion_deep_work_flow.mp3',
  },
  {
    id: 'concentracion_hypnotic_pulse',
    animo: 'concentracion',
    nombre: 'Hypnotic Pulse',
    duracion: '2:23',
    duracionSeg: 143.26,
    desc: 'Ritmo envolvente y constante que estimula la concentración activa',
    src: '/audio/musica/concentracion_hypnotic_pulse.mp3',
  },
  {
    id: 'concentracion_resonant_mind',
    animo: 'concentracion',
    nombre: 'Resonant Mind',
    duracion: '2:53',
    duracionSeg: 173.27,
    desc: 'Resonancia acústica suave para estudio intensivo y retención',
    src: '/audio/musica/concentracion_resonant_mind.mp3',
  },

  // ── Relax (4 pistas) ──
  {
    id: 'relax_felt_and_cello',
    animo: 'relax',
    nombre: 'Felt & Cello',
    duracion: '2:59',
    duracionSeg: 179.43,
    desc: 'Piano acústico aterciopelado y violonchelo cálido y reflexivo',
    src: '/audio/musica/relax_felt_and_cello.mp3',
  },
  {
    id: 'relax_quiet_pages',
    animo: 'relax',
    nombre: 'Quiet Pages',
    duracion: '3:00',
    duracionSeg: 180.37,
    desc: 'Atmósfera sosegada ideal para lectura de novelas y ensayos',
    src: '/audio/musica/relax_quiet_pages.mp3',
  },
  {
    id: 'relax_reading_space',
    animo: 'relax',
    nombre: 'Reading Space',
    duracion: '2:24',
    duracionSeg: 144.43,
    desc: 'Espacio sonoro abierto y luminoso para despejar la mente',
    src: '/audio/musica/relax_reading_space.mp3',
  },
  {
    id: 'relax_still_waters_spa',
    animo: 'relax',
    nombre: 'Still Waters Spa',
    duracion: '2:51',
    duracionSeg: 171.57,
    desc: 'Acordes armónicos cristalinos y relajación profunda antiestrés',
    src: '/audio/musica/relax_still_waters_spa.mp3',
  },

  // ── Noche (2 pistas) ──
  {
    id: 'noche_late_hours',
    animo: 'noche',
    nombre: 'Late Hours',
    duracion: '2:51',
    duracionSeg: 171.11,
    desc: 'Tonos aterciopelados y descanso visual para leer en la noche',
    src: '/audio/musica/noche_late_hours.mp3',
  },
  {
    id: 'noche_slow_waves',
    animo: 'noche',
    nombre: 'Slow Waves',
    duracion: '2:56',
    duracionSeg: 176.06,
    desc: 'Ondas lentas y frecuencias bajas para inducir el reposo',
    src: '/audio/musica/noche_slow_waves.mp3',
  },

  // ── Lluvia suave (2 pistas) ──
  {
    id: 'lluvia_gentle_window_rain',
    animo: 'lluvia',
    nombre: 'Gentle Window Rain',
    duracion: '2:35',
    duracionSeg: 155.16,
    desc: 'Lluvia constante y apacible golpeando suavemente el cristal',
    src: '/audio/musica/lluvia_gentle_window_rain.mp3',
  },
  {
    id: 'lluvia_rain_and_felt_piano',
    animo: 'lluvia',
    nombre: 'Rain & Felt Piano',
    duracion: '3:00',
    duracionSeg: 180.49,
    desc: 'Fusión reconfortante de gotas de lluvia y piano suave',
    src: '/audio/musica/lluvia_rain_and_felt_piano.mp3',
  },
];

/** Determina el ánimo según la hora local del usuario. */
export function resolverAnimoSegunHora(fecha = new Date()) {
  const hora = fecha.getHours();
  if (hora >= 6 && hora < 14) return 'concentracion';
  if (hora >= 14 && hora < 20) return 'relax';
  return 'noche';
}

/* Factor de atenuación cuando la voz habla (ducking suave: ~35% del volumen fijado) */
const FACTOR_DUCKING = 0.35;
/* Tiempo de fundido al pausar lectura (5 segundos según el plan) */
const PAUSA_FUNDIDO_SEG = 5.0;
/* Duración de transición con fundido cruzado entre pistas (segundos) */
const CROSSFADE_SEG = 3.5;

class GestorMusicaFondo {
  constructor() {
    this.audioCtx = null;
    this.duckingNodo = null;

    // Arquitectura de doble canal para fundidos cruzados sin cortes (crossfade)
    this.canalA = {
      id: 'A',
      audio: null,
      gain: null,
      source: null,
    };
    this.canalB = {
      id: 'B',
      audio: null,
      gain: null,
      source: null,
    };
    this.canalActivo = 'A';
    this.estaTransicionando = false;

    // Estado interno
    this.activa = false;
    this.automatica = true;
    this.aleatoria = true; // Por defecto aleatorio continuo por categoría
    this.animo = 'concentracion';
    this.pistaId = 'concentracion_deep_work_flow';
    this.volumenMusica = 0.20; // 20% por defecto
    this.volumenVoz = 1.00;    // 100% por defecto
    this.duckingActivo = true;
    /* Prioridad acordada (plan §5): manual del usuario > perfil del libro >
     * música desactivada. `eleccionManual` se persiste para que sobreviva a
     * recargas; `pistasPerfilLibro` acota la aleatoriedad a la lista aprobada. */
    this.eleccionManual = false;
    this.pistasPerfilLibro = null;

    this.estado = 'apagado'; // 'apagado' | 'cargando' | 'sonando' | 'pausado'
    this.vozHablando = false;
    this.temporizadorPausa = null;
    this.intervaloFadePausa = null;
    this.suscriptores = new Set();
  }

  get audioEl() {
    return this.canalActivo === 'A' ? this.canalA.audio : this.canalB.audio;
  }

  get gainNodo() {
    return this.canalActivo === 'A' ? this.canalA.gain : this.canalB.gain;
  }

  inicializar() {
    this.cargarPreferencias();
    this.prepararCanales();
    this.vincularEventosTTS();
    this.aplicarVolumenVoz();
  }

  cargarPreferencias() {
    try {
      const act = localStorage.getItem('jg_musica_activa');
      if (act !== null) this.activa = act === 'true';

      const auto = localStorage.getItem('jg_musica_automatica');
      if (auto !== null) this.automatica = auto === 'true';

      const aleat = localStorage.getItem('jg_musica_aleatoria');
      if (aleat !== null) this.aleatoria = aleat === 'true';

      const animoGuardado = localStorage.getItem('jg_musica_animo');
      if (animoGuardado && ANIMOS[animoGuardado]) {
        this.animo = animoGuardado;
      } else if (this.automatica) {
        this.animo = resolverAnimoSegunHora();
      }

      const pistaGuardada = localStorage.getItem('jg_musica_pista');
      if (pistaGuardada && CATALOGO_PISTAS.some((p) => p.id === pistaGuardada)) {
        this.pistaId = pistaGuardada;
      } else {
        const primera = CATALOGO_PISTAS.find((p) => p.animo === this.animo);
        if (primera) this.pistaId = primera.id;
      }

      const volMusica = localStorage.getItem('jg_musica_volumen');
      if (volMusica !== null) {
        const v = parseFloat(volMusica);
        if (!isNaN(v)) this.volumenMusica = Math.max(0, Math.min(1, v));
      }

      const volVoz = localStorage.getItem('jg_musica_voz_volumen');
      if (volVoz !== null) {
        const v = parseFloat(volVoz);
        if (!isNaN(v)) this.volumenVoz = Math.max(0, Math.min(1, v));
      }

      const duck = localStorage.getItem('jg_musica_ducking');
      if (duck !== null) this.duckingActivo = duck !== 'false';

      const manual = localStorage.getItem('jg_musica_manual');
      if (manual !== null) this.eleccionManual = manual === 'true';
    } catch (_) {}
  }

  guardarPreferencias() {
    try {
      localStorage.setItem('jg_musica_activa', String(this.activa));
      localStorage.setItem('jg_musica_automatica', String(this.automatica));
      localStorage.setItem('jg_musica_aleatoria', String(this.aleatoria));
      localStorage.setItem('jg_musica_animo', this.animo);
      localStorage.setItem('jg_musica_pista', this.pistaId);
      localStorage.setItem('jg_musica_volumen', String(this.volumenMusica));
      localStorage.setItem('jg_musica_voz_volumen', String(this.volumenVoz));
      localStorage.setItem('jg_musica_ducking', String(this.duckingActivo));
      localStorage.setItem('jg_musica_manual', String(!!this.eleccionManual));
    } catch (_) {}
  }

  configurarElementoAudio(canal) {
    const el = new Audio();
    el.loop = false; // El bucle se maneja inteligentemente con crossfade continuo
    el.preload = 'auto';
    el.volume = this.volumenMusica;

    el.addEventListener('error', (e) => {
      console.warn(`[MusicaFondo] Error cargando pista en canal ${canal.id}:`, e);
      if (this.canalActivo === canal.id) {
        this.estado = 'apagado';
        this.notificarCambio();
        this.mostrarAvisoError('Sin conexión para esa pista, sigue la voz');
      }
    });

    el.addEventListener('playing', () => {
      if (this.activa && this.canalActivo === canal.id) {
        this.estado = 'sonando';
        this.notificarCambio();
      }
    });

    el.addEventListener('waiting', () => {
      if (this.activa && this.canalActivo === canal.id && this.estado === 'sonando') {
        this.estado = 'cargando';
        this.notificarCambio();
      }
    });

    // Detección anticipada de fin de pista para crossfade suave (4 segundos antes)
    el.addEventListener('timeupdate', () => {
      if (
        this.activa &&
        this.estado === 'sonando' &&
        this.canalActivo === canal.id &&
        !this.estaTransicionando &&
        el.duration > 10 &&
        el.duration - el.currentTime <= 4.0
      ) {
        this.transicionarSiguiente();
      }
    });

    // Fallback si timeupdate no alcanzó a disparar
    el.addEventListener('ended', () => {
      if (this.activa && this.canalActivo === canal.id && !this.estaTransicionando) {
        this.transicionarSiguiente();
      }
    });

    canal.audio = el;
  }

  prepararCanales() {
    if (!this.canalA.audio) this.configurarElementoAudio(this.canalA);
    if (!this.canalB.audio) this.configurarElementoAudio(this.canalB);
  }

  conectarWebAudio() {
    if (this.audioCtx) {
      if (this.audioCtx.state === 'suspended') {
        this.audioCtx.resume().catch(() => {});
      }
      return;
    }
    try {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextClass) {
        this.aplicarVolumenElementoDirecto();
        return;
      }
      this.audioCtx = new AudioContextClass();

      // Master Ducking Node que alimenta la salida final
      this.duckingNodo = this.audioCtx.createGain();
      this.duckingNodo.gain.setValueAtTime(1.0, this.audioCtx.currentTime);
      this.duckingNodo.connect(this.audioCtx.destination);

      // Conexión Canal A
      this.canalA.gain = this.audioCtx.createGain();
      this.canalA.gain.gain.setValueAtTime(this.canalActivo === 'A' ? this.volumenMusica : 0.0001, this.audioCtx.currentTime);
      this.canalA.source = this.audioCtx.createMediaElementSource(this.canalA.audio);
      this.canalA.source.connect(this.canalA.gain);
      this.canalA.gain.connect(this.duckingNodo);
      this.canalA.audio.volume = 1.0;

      // Conexión Canal B
      this.canalB.gain = this.audioCtx.createGain();
      this.canalB.gain.gain.setValueAtTime(this.canalActivo === 'B' ? this.volumenMusica : 0.0001, this.audioCtx.currentTime);
      this.canalB.source = this.audioCtx.createMediaElementSource(this.canalB.audio);
      this.canalB.source.connect(this.canalB.gain);
      this.canalB.gain.connect(this.duckingNodo);
      this.canalB.audio.volume = 1.0;
    } catch (err) {
      console.info('[MusicaFondo] Fallback a audio directo sin Web Audio nodes:', err.message);
      this.audioCtx = null;
      this.duckingNodo = null;
      this.canalA.gain = null;
      this.canalB.gain = null;
      this.aplicarVolumenElementoDirecto();
    }
  }

  aplicarVolumenElementoDirecto() {
    const factor = this.duckingActivo && this.vozHablando ? FACTOR_DUCKING : 1.0;
    const vol = this.volumenMusica * factor;
    if (this.canalA.audio) {
      this.canalA.audio.volume = this.canalActivo === 'A' ? vol : 0.001;
    }
    if (this.canalB.audio) {
      this.canalB.audio.volume = this.canalActivo === 'B' ? vol : 0.001;
    }
  }

  vincularEventosTTS() {
    document.addEventListener('jg-tts-avance', (ev) => {
      const d = ev && ev.detail;
      if (!d) return;
      const habla = d.sonando === true;
      if (this.activa && habla && this.estado !== 'sonando' && this.estado !== 'cargando') {
        this.reproducir({ suave: true });
      }
      if (habla !== this.vozHablando) {
        this.vozHablando = habla;
        this.actualizarDucking();
      }
    });

    document.addEventListener('visibilitychange', () => {
      if (document.hidden && this.activa && this.estado === 'sonando') {
        // En segundo plano la música sigue activa
      }
    });
  }

  actualizarDucking() {
    if (!this.activa || this.estado !== 'sonando') return;
    const factor = this.duckingActivo && this.vozHablando ? FACTOR_DUCKING : 1.0;

    if (this.audioCtx && this.duckingNodo) {
      const t = this.audioCtx.currentTime;
      this.duckingNodo.gain.cancelScheduledValues(t);
      this.duckingNodo.gain.setTargetAtTime(factor, t, 0.25);
    } else {
      this.aplicarVolumenElementoDirecto();
    }
  }

  pistaActual() {
    return CATALOGO_PISTAS.find((p) => p.id === this.pistaId) || CATALOGO_PISTAS[0];
  }

  /**
   * Obtiene la siguiente pista aleatoria dentro del ánimo actual
   * (evitando repetir la misma de inmediato si hay más de 1 pista).
   */
  obtenerSiguienteAleatoria() {
    const animoActual = this.automatica ? resolverAnimoSegunHora() : this.animo;
    let pistas = CATALOGO_PISTAS.filter((p) => p.animo === animoActual);
    /* Con perfil de libro, la aleatoriedad solo elige entre las pistas
     * aprobadas de ese perfil (plan §5: perfil por libro, no por hora). */
    if (Array.isArray(this.pistasPerfilLibro) && this.pistasPerfilLibro.length) {
      const aprobadas = new Set(this.pistasPerfilLibro);
      const filtradas = pistas.filter((p) => aprobadas.has(p.id));
      if (filtradas.length) pistas = filtradas;
    }
    if (!pistas.length) return CATALOGO_PISTAS[0];

    // Excluir la pista actual para evitar repetir la misma de forma consecutiva
    const candidatas = pistas.length > 1
      ? pistas.filter((p) => p.id !== this.pistaId)
      : pistas;

    const elegida = candidatas[Math.floor(Math.random() * candidatas.length)];
    return elegida || pistas[0];
  }

  /**
   * Transición automática a la siguiente pista:
   * Si 'aleatoria' es true, elige otra canción del ánimo con fundido cruzado.
   * Si 'aleatoria' es false, repite la misma pista también con fundido cruzado sin cortes.
   */
  transicionarSiguiente() {
    if (this.estaTransicionando || !this.activa) return;
    this.estaTransicionando = true;

    let siguientePista = null;
    if (this.aleatoria) {
      siguientePista = this.obtenerSiguienteAleatoria();
    } else {
      siguientePista = this.pistaActual();
    }

    if (siguientePista) {
      this.reproducirPista(siguientePista, { suave: true, fundidoCruzado: true });
    } else {
      this.estaTransicionando = false;
    }
  }

  async reproducir({ suave = true } = {}) {
    if (!this.activa) {
      this.activa = true;
      this.guardarPreferencias();
    }
    const pista = this.pistaActual();
    await this.reproducirPista(pista, { suave, fundidoCruzado: false });
  }

  /**
   * Reproduce una pista con soporte para:
   * - Inicio directo con fundido de entrada suave
   * - Transición con fundido cruzado (crossfade) de 3.5 segundos entre canal A y canal B
   */
  async reproducirPista(pista, { suave = true, fundidoCruzado = false } = {}) {
    if (!pista) return;
    this.activa = true;
    this.cancelarTemporizadorPausa();
    this.conectarWebAudio();

    if (fundidoCruzado && this.audioCtx && this.canalA.gain && this.canalB.gain) {
      // ── Fundido cruzado de estudio entre canales ──
      const saliente = this.canalActivo === 'A' ? this.canalA : this.canalB;
      const entrante = this.canalActivo === 'A' ? this.canalB : this.canalA;

      try {
        if (this.audioCtx.state === 'suspended') {
          await this.audioCtx.resume().catch(() => {});
        }

        entrante.audio.src = pista.src;
        entrante.audio.currentTime = 0;
        await entrante.audio.play();

        const t = this.audioCtx.currentTime;
        // Canal entrante sube de 0 a volumenMusica
        entrante.gain.gain.cancelScheduledValues(t);
        entrante.gain.gain.setValueAtTime(0.0001, t);
        entrante.gain.gain.linearRampToValueAtTime(this.volumenMusica, t + CROSSFADE_SEG);

        // Canal saliente baja a 0
        saliente.gain.gain.cancelScheduledValues(t);
        saliente.gain.gain.setValueAtTime(this.volumenMusica, t);
        saliente.gain.gain.linearRampToValueAtTime(0.0001, t + CROSSFADE_SEG);

        setTimeout(() => {
          try {
            saliente.audio.pause();
            saliente.audio.currentTime = 0;
          } catch (_) {}
          this.canalActivo = entrante.id;
          this.pistaId = pista.id;
          this.animo = pista.animo;
          this.estaTransicionando = false;
          this.guardarPreferencias();
          this.notificarCambio();
        }, Math.round((CROSSFADE_SEG + 0.1) * 1000));

        this.estado = 'sonando';
        this.pistaId = pista.id;
        this.animo = pista.animo;
        this.notificarCambio();
        return;
      } catch (err) {
        console.warn('[MusicaFondo] Fallback en fundido cruzado:', err.message);
        this.estaTransicionando = false;
        // Si falla el crossfade simultáneo, continúa al inicio normal abajo
      }
    }

    // ── Inicio o cambio directo en el canal activo ──
    this.estaTransicionando = false;
    const canal = this.canalActivo === 'A' ? this.canalA : this.canalB;
    const otroCanal = this.canalActivo === 'A' ? this.canalB : this.canalA;

    // Detener otro canal si estaba sonando
    try {
      if (otroCanal.audio) {
        otroCanal.audio.pause();
        otroCanal.audio.currentTime = 0;
      }
    } catch (_) {}

    if (!canal.audio) return;
    if (!canal.audio.src || !canal.audio.src.endsWith(pista.src)) {
      canal.audio.src = pista.src;
    }

    this.pistaId = pista.id;
    this.animo = pista.animo;
    this.estado = 'cargando';
    this.notificarCambio();

    try {
      if (this.audioCtx && this.audioCtx.state === 'suspended') {
        await this.audioCtx.resume().catch(() => {});
      }

      if (this.audioCtx && canal.gain) {
        canal.audio.volume = 1.0;
        const t = this.audioCtx.currentTime;
        canal.gain.gain.cancelScheduledValues(t);
        if (suave) {
          canal.gain.gain.setValueAtTime(0.01, t);
          canal.gain.gain.setTargetAtTime(this.volumenMusica, t, 0.35);
        } else {
          canal.gain.gain.setValueAtTime(this.volumenMusica, t);
        }
      } else {
        this.aplicarVolumenElementoDirecto();
      }

      await canal.audio.play();
      this.estado = 'sonando';
      this.actualizarDucking();
      this.guardarPreferencias();
      this.notificarCambio();
    } catch (err) {
      console.warn('[MusicaFondo] Reproducción diferida o bloqueada:', err.message);
      this.estado = 'pausado';
      this.notificarCambio();
    }
  }

  cancelarTemporizadorPausa() {
    if (this.temporizadorPausa) {
      clearTimeout(this.temporizadorPausa);
      this.temporizadorPausa = null;
    }
    if (this.intervaloFadePausa) {
      clearInterval(this.intervaloFadePausa);
      this.intervaloFadePausa = null;
    }
  }

  /**
   * Pausa de lectura según el plan:
   * «la voz pausa, la música baja a 10% y sigue 5 segundos en fundido, luego pausa».
   */
  pausarLectura() {
    if (!this.activa || this.estado !== 'sonando') return;
    this.cancelarTemporizadorPausa();

    const volDiezPorciento = this.volumenMusica * 0.10;
    const duracionMs = PAUSA_FUNDIDO_SEG * 1000;
    const canal = this.canalActivo === 'A' ? this.canalA : this.canalB;

    if (this.audioCtx && canal.gain) {
      const t = this.audioCtx.currentTime;
      canal.gain.gain.cancelScheduledValues(t);
      canal.gain.gain.setTargetAtTime(volDiezPorciento, t, 0.3);
    } else if (canal.audio) {
      canal.audio.volume = Math.max(0.01, volDiezPorciento);
    }

    this.temporizadorPausa = setTimeout(() => {
      if (this.audioCtx && canal.gain) {
        const t2 = this.audioCtx.currentTime;
        canal.gain.gain.setTargetAtTime(0.0001, t2, 0.5);
      }
      setTimeout(() => {
        try { canal.audio.pause(); } catch (_) {}
        this.estado = 'pausado';
        this.notificarCambio();
      }, 600);
    }, duracionMs);
  }

  /**
   * Reanudación de lectura según el plan:
   * «Al reanudar, entra primero la música en fundido y luego la voz».
   */
  async reanudarLectura() {
    if (!this.activa) return;
    this.cancelarTemporizadorPausa();
    await this.reproducir({ suave: true });
  }

  detener({ inmediato = false } = {}) {
    this.cancelarTemporizadorPausa();
    const canal = this.canalActivo === 'A' ? this.canalA : this.canalB;
    const otro = this.canalActivo === 'A' ? this.canalB : this.canalA;

    if (inmediato) {
      try {
        if (canal.audio) { canal.audio.pause(); canal.audio.currentTime = 0; }
        if (otro.audio) { otro.audio.pause(); otro.audio.currentTime = 0; }
      } catch (_) {}
      this.estado = this.activa ? 'pausado' : 'apagado';
      this.estaTransicionando = false;
      this.notificarCambio();
      return;
    }

    if (this.audioCtx && canal.gain) {
      const t = this.audioCtx.currentTime;
      canal.gain.gain.cancelScheduledValues(t);
      canal.gain.gain.setTargetAtTime(0.0001, t, 0.25);
    } else if (canal.audio) {
      canal.audio.volume = 0.01;
    }
    setTimeout(() => {
      try {
        if (canal.audio) { canal.audio.pause(); canal.audio.currentTime = 0; }
        if (otro.audio) { otro.audio.pause(); otro.audio.currentTime = 0; }
      } catch (_) {}
      this.estado = this.activa ? 'pausado' : 'apagado';
      this.estaTransicionando = false;
      this.notificarCambio();
    }, 700);
  }

  setActiva(activa) {
    this.activa = !!activa;
    this.guardarPreferencias();
    if (!this.activa) {
      this.detener({ inmediato: false });
      this.estado = 'apagado';
    } else {
      this.reproducir({ suave: true });
    }
    this.notificarCambio();
  }

  setAnimo(animoId) {
    if (!ANIMOS[animoId]) return;
    this.animo = animoId;
    this.automatica = false;
    this.eleccionManual = true;
    this.activa = true;

    // Si está en modo aleatorio, seleccionar una pista al azar del ánimo
    let pista = null;
    if (this.aleatoria) {
      const pistas = CATALOGO_PISTAS.filter((p) => p.animo === animoId);
      pista = pistas[Math.floor(Math.random() * pistas.length)];
    }
    if (!pista) {
      pista = CATALOGO_PISTAS.find((p) => p.animo === animoId);
    }

    if (pista) this.pistaId = pista.id;
    this.guardarPreferencias();
    this.reproducirPista(pista, { suave: true, fundidoCruzado: false });
    this.notificarCambio();
  }

  setPista(pistaId) {
    const pista = CATALOGO_PISTAS.find((p) => p.id === pistaId);
    if (!pista) return;
    this.pistaId = pistaId;
    this.animo = pista.animo;
    this.automatica = false;
    this.eleccionManual = true;
    this.activa = true;
    this.guardarPreferencias();
    this.reproducirPista(pista, { suave: true, fundidoCruzado: false });
    this.notificarCambio();
  }

  /**
   * Aplica el perfil musical por libro según el Plan Maestro (§5).
   * Prioridad:
   * 1. Elección manual del usuario (siempre preservada, persistida).
   * 2. Perfil del libro asignado (desactiva el modo horario y acota la
   *    aleatoriedad a las pistas aprobadas del perfil).
   * 3. Si no existe perfil y no hay elección manual: música desactivada.
   * Nunca inicia la reproducción por sí sola: sin interacción no hay audio.
   */
  aplicarPerfilLibro(perfil) {
    if (this.eleccionManual) return;
    if (!perfil || typeof perfil !== 'object') {
      this.pistasPerfilLibro = null;
      if (this.activa) this.setActiva(false);
      return;
    }
    const pistas = perfil.pistas || perfil.pistas_aprobadas || perfil.pistasAprobadas;
    const aprobadas = Array.isArray(pistas)
      ? pistas.map((x) => String(x)).filter((x) => CATALOGO_PISTAS.some((c) => c.id === x))
      : [];
    this.pistasPerfilLibro = aprobadas.length ? aprobadas : null;
    this.automatica = false;               // el perfil manda sobre la hora
    const animo = perfil.animo || perfil.animo_recomendado;
    if (animo && ANIMOS[animo]) {
      this.animo = animo;
    }
    const candidatas = this.pistasPerfilLibro
      ? CATALOGO_PISTAS.filter((c) => this.pistasPerfilLibro.includes(c.id) && c.animo === this.animo)
      : [];
    const p = (candidatas.length ? candidatas : CATALOGO_PISTAS.filter((c) => c.animo === this.animo))[0];
    if (p) this.pistaId = p.id;
    this.guardarPreferencias();
    /* Si el usuario ya había encendido la música, pasa a la pista del perfil
     * con fundido; si no, solo queda lista (sin reproducción automática). */
    if (this.activa && p) {
      this.reproducirPista(p, { suave: true, fundidoCruzado: true });
    }
    this.notificarCambio();
  }

  setAutomatica(activa) {
    this.automatica = !!activa;
    if (this.automatica) {
      const animoAuto = resolverAnimoSegunHora();
      this.animo = animoAuto;
      let pista = null;
      if (this.aleatoria) {
        const pistas = CATALOGO_PISTAS.filter((p) => p.animo === animoAuto);
        pista = pistas[Math.floor(Math.random() * pistas.length)];
      }
      if (!pista) {
        pista = CATALOGO_PISTAS.find((p) => p.animo === animoAuto);
      }
      if (pista) this.pistaId = pista.id;
      if (this.activa) {
        this.reproducirPista(pista, { suave: true, fundidoCruzado: false });
      }
    }
    this.guardarPreferencias();
    this.notificarCambio();
  }

  setAleatoria(activa) {
    this.aleatoria = !!activa;
    this.guardarPreferencias();
    this.notificarCambio();
  }

  setVolumenMusica(vol) {
    const v = Math.max(0, Math.min(1, parseFloat(vol) || 0));
    this.volumenMusica = v;
    this.guardarPreferencias();

    const canal = this.canalActivo === 'A' ? this.canalA : this.canalB;
    if (this.audioCtx && canal.gain) {
      if (canal.audio) canal.audio.volume = 1.0;
      const t = this.audioCtx.currentTime;
      canal.gain.gain.cancelScheduledValues(t);
      canal.gain.gain.setTargetAtTime(v, t, 0.05);
    } else {
      this.aplicarVolumenElementoDirecto();
    }
    this.notificarCambio();
  }

  setVolumenVoz(vol) {
    const v = Math.max(0, Math.min(1, parseFloat(vol) || 0));
    this.volumenVoz = v;
    this.guardarPreferencias();
    this.aplicarVolumenVoz();
    this.notificarCambio();
  }

  aplicarVolumenVoz() {
    if (typeof window === 'undefined') return;
    try {
      if (typeof window.ttsPool === 'function') {
        const p = window.ttsPool();
        if (p && p.a) p.a.volume = this.volumenVoz;
        if (p && p.b) p.b.volume = this.volumenVoz;
      }
    } catch (_) {}
  }

  setDucking(activo) {
    this.duckingActivo = !!activo;
    this.guardarPreferencias();
    this.actualizarDucking();
    this.notificarCambio();
  }

  mostrarAvisoError(mensaje) {
    if (typeof window === 'undefined') return;
    const aviso = document.getElementById('pdfNoticeLector');
    if (aviso) {
      aviso.textContent = mensaje;
      aviso.hidden = false;
      setTimeout(() => { aviso.hidden = true; }, 5000);
    }
  }

  suscribir(fn) {
    this.suscriptores.add(fn);
    return () => this.suscriptores.delete(fn);
  }

  notificarCambio() {
    const estadoActual = {
      activa: this.activa,
      automatica: this.automatica,
      aleatoria: this.aleatoria,
      animo: this.animo,
      pistaId: this.pistaId,
      pista: this.pistaActual(),
      volumenMusica: this.volumenMusica,
      volumenVoz: this.volumenVoz,
      duckingActivo: this.duckingActivo,
      estado: this.activa ? this.estado : 'apagado',
    };
    for (const fn of this.suscriptores) {
      try { fn(estadoActual); } catch (_) {}
    }
  }
}

export const musicaFondo = new GestorMusicaFondo();
if (typeof window !== 'undefined') {
  window.musicaFondo = musicaFondo;
}
