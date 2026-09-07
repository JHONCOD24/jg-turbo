/* JG Turbo · Música de fondo para el módulo PDF
 *
 * Mezclador de audio web local-first para lectura concentrada.
 * Permite escuchar loops instrumentales libres de derechos mientras la voz
 * neural narra el texto, con volumen independiente, ducking automático
 * («bajar música cuando habla la voz»), fundidos suaves al pausar/reanudar
 * y persistencia sin conexión.
 */

export const ANIMOS = {
  concentracion: { id: 'concentracion', label: 'Concentración', emoji: '🎯', desc: 'Enfoque y claridad mental (68-72 BPM)' },
  relax: { id: 'relax', label: 'Relax', emoji: '🌿', desc: 'Calma, meditación y lectura pausada (60-65 BPM)' },
  noche: { id: 'noche', label: 'Noche', emoji: '🌙', desc: 'Tonos graves cálidos para no cansar la vista' },
  lluvia: { id: 'lluvia', label: 'Lluvia suave', emoji: '🌧️', desc: 'Sonido ambiental continuo de lluvia y brisa' },
};

export const CATALOGO_PISTAS = [
  {
    id: 'concentracion_1_pulso_alfa',
    animo: 'concentracion',
    nombre: 'Pulso Alfa',
    duracion: '14s loop',
    desc: 'Lo-Fi ambiental con armónicos alfa binaurales para concentración profunda',
    src: '/audio/musica/concentracion_1_pulso_alfa.mp3',
  },
  {
    id: 'concentracion_2_flujo_continuo',
    animo: 'concentracion',
    nombre: 'Flujo Continuo',
    duracion: '13s loop',
    desc: 'Pad atmosférico cálido de estudio con resonancia envolvente',
    src: '/audio/musica/concentracion_2_flujo_continuo.mp3',
  },
  {
    id: 'relax_1_ondas_de_calma',
    animo: 'relax',
    nombre: 'Ondas de Calma',
    duracion: '16s loop',
    desc: 'Acordes celestiales suaves a 60 BPM con reverberación espaciosa',
    src: '/audio/musica/relax_1_ondas_de_calma.mp3',
  },
  {
    id: 'relax_2_serenidad_acustica',
    animo: 'relax',
    nombre: 'Serenidad Acústica',
    duracion: '15s loop',
    desc: 'Campanas armónicas tenues y calidez acústica',
    src: '/audio/musica/relax_2_serenidad_acustica.mp3',
  },
  {
    id: 'noche_1_penumbra_serena',
    animo: 'noche',
    nombre: 'Penumbra Serena',
    duracion: '16s loop',
    desc: 'Sub-bass profundo con filtro cálido; cero brillos molestos a oscuras',
    src: '/audio/musica/noche_1_penumbra_serena.mp3',
  },
  {
    id: 'noche_2_nebulosa_estelar',
    animo: 'noche',
    nombre: 'Nebulosa Estelar',
    duracion: '16s loop',
    desc: 'Textura hipnagógica para lectura antes de dormir',
    src: '/audio/musica/noche_2_nebulosa_estelar.mp3',
  },
  {
    id: 'lluvia_1_lluvia_ventana',
    animo: 'lluvia',
    nombre: 'Lluvia en la Ventana',
    duracion: '12s loop',
    desc: 'Lluvia constante contra el cristal con filtrado acústico suave',
    src: '/audio/musica/lluvia_1_lluvia_ventana.mp3',
  },
  {
    id: 'lluvia_2_brisa_y_gotas',
    animo: 'lluvia',
    nombre: 'Brisa y Gotas',
    duracion: '12s loop',
    desc: 'Lluvia tenue de bosque con brisa pacífica',
    src: '/audio/musica/lluvia_2_brisa_y_gotas.mp3',
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

class GestorMusicaFondo {
  constructor() {
    this.audioCtx = null;
    this.gainNodo = null;
    this.duckingNodo = null;
    this.audioEl = null;
    this.mediaSourceNodo = null;
    
    // Estado interno
    this.activa = false;
    this.automatica = true;
    this.animo = 'concentracion';
    this.pistaId = 'concentracion_1_pulso_alfa';
    this.volumenMusica = 0.20; // 20% por defecto según plan
    this.volumenVoz = 1.00;    // 100% por defecto
    this.duckingActivo = true;
    
    this.estado = 'apagado'; // 'apagado' | 'cargando' | 'sonando' | 'pausado'
    this.vozHablando = false;
    this.temporizadorPausa = null;
    this.intervaloFadePausa = null;
    this.suscriptores = new Set();
  }

  inicializar() {
    this.cargarPreferencias();
    this.prepararElementoAudio();
    this.vincularEventosTTS();
    this.aplicarVolumenVoz();
  }

  cargarPreferencias() {
    try {
      const act = localStorage.getItem('jg_musica_activa');
      if (act !== null) this.activa = act === 'true';

      const auto = localStorage.getItem('jg_musica_automatica');
      if (auto !== null) this.automatica = auto === 'true';

      const animoGuardado = localStorage.getItem('jg_musica_animo');
      if (animoGuardado && ANIMOS[animoGuardado]) {
        this.animo = animoGuardado;
      } else if (this.automatica) {
        this.animo = resolverAnimoSegunHora();
      }

      const pistaGuardada = localStorage.getItem('jg_musica_pista');
      if (pistaGuardada && CATALOGO_PISTAS.some(p => p.id === pistaGuardada)) {
        this.pistaId = pistaGuardada;
      } else {
        const primera = CATALOGO_PISTAS.find(p => p.animo === this.animo);
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
    } catch (_) {}
  }

  guardarPreferencias() {
    try {
      localStorage.setItem('jg_musica_activa', String(this.activa));
      localStorage.setItem('jg_musica_automatica', String(this.automatica));
      localStorage.setItem('jg_musica_animo', this.animo);
      localStorage.setItem('jg_musica_pista', this.pistaId);
      localStorage.setItem('jg_musica_volumen', String(this.volumenMusica));
      localStorage.setItem('jg_musica_voz_volumen', String(this.volumenVoz));
      localStorage.setItem('jg_musica_ducking', String(this.duckingActivo));
    } catch (_) {}
  }

  prepararElementoAudio() {
    if (this.audioEl) return;
    this.audioEl = new Audio();
    this.audioEl.loop = true;
    this.audioEl.preload = 'auto';
    this.audioEl.volume = this.volumenMusica;

    this.audioEl.addEventListener('error', (e) => {
      console.warn('[MusicaFondo] Error cargando pista de audio:', e);
      this.estado = 'apagado';
      this.notificarCambio();
      this.mostrarAvisoError('Sin conexión para esa pista, sigue la voz');
    });

    this.audioEl.addEventListener('playing', () => {
      if (this.activa) {
        this.estado = 'sonando';
        this.notificarCambio();
      }
    });

    this.audioEl.addEventListener('waiting', () => {
      if (this.activa && this.estado === 'sonando') {
        this.estado = 'cargando';
        this.notificarCambio();
      }
    });
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
        if (this.audioEl) this.audioEl.volume = this.volumenMusica;
        return;
      }
      this.audioCtx = new AudioContextClass();
      
      this.gainNodo = this.audioCtx.createGain();
      this.gainNodo.gain.setValueAtTime(this.volumenMusica, this.audioCtx.currentTime);

      this.duckingNodo = this.audioCtx.createGain();
      this.duckingNodo.gain.setValueAtTime(1.0, this.audioCtx.currentTime);

      this.mediaSourceNodo = this.audioCtx.createMediaElementSource(this.audioEl);
      this.mediaSourceNodo.connect(this.gainNodo);
      this.gainNodo.connect(this.duckingNodo);
      this.duckingNodo.connect(this.audioCtx.destination);
      // Con Web Audio activo, el elemento se deja al 100% para que toda
      // la atenuación la controle el GainNode sin doble reducción.
      if (this.audioEl) this.audioEl.volume = 1.0;
    } catch (err) {
      console.info('[MusicaFondo] Fallback a HTMLAudioElement directo:', err.message);
      this.audioCtx = null;
      this.gainNodo = null;
      this.duckingNodo = null;
      if (this.audioEl) this.audioEl.volume = this.volumenMusica;
    }
  }

  vincularEventosTTS() {
    // Escuchar progreso y estado del TTS para aplicar ducking y coordinación
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

    // Manejar cuando la pestaña o el dispositivo interrumpe el audio
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && this.activa && this.estado === 'sonando') {
        // En segundo plano la música sigue si la voz sigue sonando
      }
    });
  }

  actualizarDucking() {
    if (!this.activa || this.estado !== 'sonando') return;
    const factor = (this.duckingActivo && this.vozHablando) ? FACTOR_DUCKING : 1.0;
    
    if (this.audioCtx && this.duckingNodo) {
      const t = this.audioCtx.currentTime;
      this.duckingNodo.gain.cancelScheduledValues(t);
      this.duckingNodo.gain.setTargetAtTime(factor, t, 0.25);
    } else if (this.audioEl) {
      this.audioEl.volume = this.volumenMusica * factor;
    }
  }

  pistaActual() {
    return CATALOGO_PISTAS.find(p => p.id === this.pistaId) || CATALOGO_PISTAS[0];
  }

  async reproducir({ suave = true } = {}) {
    if (!this.activa) {
      this.activa = true;
      this.guardarPreferencias();
    }
    this.cancelarTemporizadorPausa();
    this.conectarWebAudio();

    const pista = this.pistaActual();
    if (!pista || !this.audioEl) return;

    if (!this.audioEl.src || !this.audioEl.src.endsWith(pista.src)) {
      this.audioEl.src = pista.src;
    }

    this.estado = 'cargando';
    this.notificarCambio();

    try {
      if (this.audioCtx && this.audioCtx.state === 'suspended') {
        await this.audioCtx.resume().catch(() => {});
      }

      if (this.audioCtx && this.gainNodo) {
        if (this.audioEl) this.audioEl.volume = 1.0;
        const t = this.audioCtx.currentTime;
        this.gainNodo.gain.cancelScheduledValues(t);
        if (suave) {
          this.gainNodo.gain.setValueAtTime(0.01, t);
          this.gainNodo.gain.setTargetAtTime(this.volumenMusica, t, 0.35);
        } else {
          this.gainNodo.gain.setValueAtTime(this.volumenMusica, t);
        }
      } else if (this.audioEl) {
        const factor = (this.duckingActivo && this.vozHablando) ? FACTOR_DUCKING : 1.0;
        this.audioEl.volume = this.volumenMusica * factor;
      }

      await this.audioEl.play();
      this.estado = 'sonando';
      this.actualizarDucking();
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

    if (this.audioCtx && this.gainNodo) {
      const t = this.audioCtx.currentTime;
      this.gainNodo.gain.cancelScheduledValues(t);
      this.gainNodo.gain.setTargetAtTime(volDiezPorciento, t, 0.3);
    } else if (this.audioEl) {
      this.audioEl.volume = Math.max(0.01, volDiezPorciento);
    }

    this.temporizadorPausa = setTimeout(() => {
      if (this.audioCtx && this.gainNodo) {
        const t2 = this.audioCtx.currentTime;
        this.gainNodo.gain.setTargetAtTime(0.0001, t2, 0.5);
      }
      setTimeout(() => {
        try { this.audioEl.pause(); } catch (_) {}
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
    if (!this.audioEl) return;

    if (inmediato) {
      try { this.audioEl.pause(); this.audioEl.currentTime = 0; } catch (_) {}
      this.estado = this.activa ? 'pausado' : 'apagado';
      this.notificarCambio();
      return;
    }

    if (this.audioCtx && this.gainNodo) {
      const t = this.audioCtx.currentTime;
      this.gainNodo.gain.cancelScheduledValues(t);
      this.gainNodo.gain.setTargetAtTime(0.0001, t, 0.25);
    } else if (this.audioEl) {
      this.audioEl.volume = 0.01;
    }
    setTimeout(() => {
      try { this.audioEl.pause(); this.audioEl.currentTime = 0; } catch (_) {}
      this.estado = this.activa ? 'pausado' : 'apagado';
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
    const pista = CATALOGO_PISTAS.find(p => p.animo === animoId);
    if (pista) this.pistaId = pista.id;
    this.activa = true;
    this.guardarPreferencias();
    this.reproducir({ suave: true });
    this.notificarCambio();
  }

  setPista(pistaId) {
    const pista = CATALOGO_PISTAS.find(p => p.id === pistaId);
    if (!pista) return;
    this.pistaId = pistaId;
    this.animo = pista.animo;
    this.automatica = false;
    this.activa = true;
    this.guardarPreferencias();
    this.reproducir({ suave: true });
    this.notificarCambio();
  }

  setAutomatica(activa) {
    this.automatica = !!activa;
    if (this.automatica) {
      const animoAuto = resolverAnimoSegunHora();
      this.animo = animoAuto;
      const pista = CATALOGO_PISTAS.find(p => p.animo === animoAuto);
      if (pista) this.pistaId = pista.id;
      if (this.activa) {
        this.reproducir({ suave: true });
      }
    }
    this.guardarPreferencias();
    this.notificarCambio();
  }

  setVolumenMusica(vol) {
    const v = Math.max(0, Math.min(1, parseFloat(vol) || 0));
    this.volumenMusica = v;
    this.guardarPreferencias();

    if (this.audioCtx && this.gainNodo) {
      if (this.audioEl) this.audioEl.volume = 1.0;
      const t = this.audioCtx.currentTime;
      this.gainNodo.gain.cancelScheduledValues(t);
      this.gainNodo.gain.setTargetAtTime(v, t, 0.05);
    } else if (this.audioEl) {
      const factor = (this.duckingActivo && this.vozHablando) ? FACTOR_DUCKING : 1.0;
      this.audioEl.volume = v * factor;
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
