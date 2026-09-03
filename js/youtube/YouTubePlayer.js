let promesaApi = null;

function cargarApiYouTube() {
  if (window.YT?.Player) return Promise.resolve(window.YT);
  if (promesaApi) return promesaApi;
  promesaApi = new Promise((resolver, rechazar) => {
    const anterior = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      if (typeof anterior === 'function') anterior();
      resolver(window.YT);
    };
    let script = document.getElementById('youtube-iframe-api');
    if (!script) {
      script = document.createElement('script');
      script.id = 'youtube-iframe-api';
      script.src = 'https://www.youtube.com/iframe_api';
      script.async = true;
      script.onerror = () => rechazar(new Error('No se pudo cargar el reproductor de YouTube.'));
      document.head.appendChild(script);
    }
    setTimeout(() => rechazar(new Error('El reproductor de YouTube tardó demasiado en cargar.')), 15000);
  });
  return promesaApi;
}

const ESTADOS = {
  '-1': 'unstarted',
  0: 'ended',
  1: 'playing',
  2: 'paused',
  3: 'buffering',
  5: 'cued',
};

export class YouTubePlayer {
  constructor(elemento, videoId) {
    this.elemento = elemento;
    this.videoId = videoId;
    this.player = null;
    this.estadoListeners = new Set();
    this.velocidadListeners = new Set();
  }

  async inicializar() {
    const YT = await cargarApiYouTube();
    await new Promise((resolver, rechazar) => {
      this.player = new YT.Player(this.elemento, {
        width: '100%',
        height: '100%',
        videoId: this.videoId,
        playerVars: { playsinline: 1, rel: 0 },
        events: {
          onReady: () => resolver(),
          onStateChange: (evento) => {
            const estado = ESTADOS[evento.data] || 'unstarted';
            this.estadoListeners.forEach((listener) => listener(estado));
          },
          onPlaybackRateChange: (evento) => {
            const velocidad = Number(evento.data) || this.getPlaybackRate();
            this.velocidadListeners.forEach((listener) => listener(velocidad));
          },
          onError: () => rechazar(new Error('YouTube no pudo reproducir este video.')),
        },
      });
    });
    return this;
  }

  getCurrentTime() {
    return Number(this.player?.getCurrentTime?.() || 0);
  }

  getPlaybackRate() {
    return Number(this.player?.getPlaybackRate?.() || 1);
  }

  getAvailablePlaybackRates() {
    const tasas = this.player?.getAvailablePlaybackRates?.();
    return Array.isArray(tasas) && tasas.length ? tasas.map(Number) : [1];
  }

  setPlaybackRate(velocidad) {
    this.player?.setPlaybackRate?.(Number(velocidad));
  }

  playVideo() {
    this.player?.playVideo?.();
  }

  pauseVideo() {
    this.player?.pauseVideo?.();
  }

  /**
   * Pistas de subtítulos que el reproductor conoce, si las expone.
   *
   * Vale la pena aunque sea una API no documentada: el navegador del usuario
   * consulta YouTube desde una IP doméstica, que no está bloqueada como sí lo
   * está la de Vercel. Una pista con `kind: 'asr'` la genera YouTube escuchando
   * el audio, así que su idioma **es** el idioma hablado — la única señal que
   * demuestra el idioma del audio y que el servidor no logra conseguir.
   *
   * Devuelve [] ante cualquier problema: es una mejora, nunca un requisito.
   */
  getTracklist() {
    for (const modulo of ['captions', 'cc']) {
      try {
        const pistas = this.player?.getOption?.(modulo, 'tracklist');
        if (Array.isArray(pistas) && pistas.length) return pistas;
      } catch (_) {
        // El módulo de subtítulos aún no cargó o esta versión no lo expone.
      }
    }
    return [];
  }

  /**
   * Idioma del audio según las pistas: el de la pista automática, si existe.
   * Devuelve `{ idioma, automatica }` o null si no se puede afirmar nada.
   */
  idiomaSegunPistas() {
    const pistas = this.getTracklist();
    if (!pistas.length) return null;
    const codigo = (pista) => String(
      pista?.languageCode || pista?.language_code || pista?.lc || '',
    ).toLowerCase().split(/[-_]/)[0];
    const esAutomatica = (pista) => String(pista?.kind || pista?.vss_id || '')
      .toLowerCase().includes('asr');

    const automatica = pistas.find((pista) => esAutomatica(pista) && codigo(pista));
    if (automatica) return { idioma: codigo(automatica), automatica: true };
    const primera = pistas.find((pista) => codigo(pista));
    return primera ? { idioma: codigo(primera), automatica: false } : null;
  }

  /** Volumen del video, 0 a 100. Permite bajar el original sin silenciarlo. */
  getVolume() {
    const valor = Number(this.player?.getVolume?.());
    return Number.isFinite(valor) ? valor : 100;
  }

  setVolume(valor) {
    const numero = Math.max(0, Math.min(100, Number(valor)));
    if (Number.isFinite(numero)) this.player?.setVolume?.(numero);
  }

  mute() {
    this.player?.mute?.();
  }

  unMute() {
    this.player?.unMute?.();
  }

  isMuted() {
    return Boolean(this.player?.isMuted?.());
  }

  suscribirEstado(listener) {
    this.estadoListeners.add(listener);
    return () => this.estadoListeners.delete(listener);
  }

  suscribirVelocidad(listener) {
    this.velocidadListeners.add(listener);
    return () => this.velocidadListeners.delete(listener);
  }

  destruir() {
    this.estadoListeners.clear();
    this.velocidadListeners.clear();
    this.player?.destroy?.();
    this.player = null;
  }
}
