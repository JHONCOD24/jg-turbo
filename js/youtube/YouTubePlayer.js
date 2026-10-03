let promesaApi = null;

function cargarApiYouTube() {
  if (window.YT?.Player) return Promise.resolve(window.YT);
  if (promesaApi) return promesaApi;
  promesaApi = new Promise((resolver, rechazar) => {
    const anterior = window.onYouTubeIframeAPIReady;
    let temporizador = null;
    window.onYouTubeIframeAPIReady = () => {
      if (typeof anterior === 'function') anterior();
      clearTimeout(temporizador);
      resolver(window.YT);
    };
    let script = document.getElementById('youtube-iframe-api');
    if (!script) {
      script = document.createElement('script');
      script.id = 'youtube-iframe-api';
      script.src = 'https://www.youtube.com/iframe_api';
      script.async = true;
      script.onerror = () => { promesaApi = null; rechazar(new Error('No se pudo cargar el reproductor de YouTube.')); };
      document.head.appendChild(script);
    }
    temporizador = setTimeout(() => { promesaApi = null; rechazar(new Error('El reproductor de YouTube tardó demasiado en cargar.')); }, 15000);
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
  constructor(elemento, videoId, { pantallaCompletaPropia = false, inicioS = 0 } = {}) {
    this.elemento = elemento;
    this.inicioS = Math.max(0, Math.floor(Number(inicioS) || 0));   // segundo donde queda cargado (sin reproducir)
    this.videoId = videoId;
    this.pantallaCompletaPropia = pantallaCompletaPropia;
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
        playerVars: {
          playsinline: 1,
          rel: 0,
          hl: 'es',                         // controles del reproductor en español
          cc_load_policy: 0,                // no forzar subtítulos de YouTube: la app pone los suyos
          iv_load_policy: 3,                // sin anotaciones encima del video
          fs: this.pantallaCompletaPropia ? 0 : 1,
          origin: window.location.origin,   // recomendado por la documentación de la IFrame API
          ...(this.inicioS > 0 ? { start: this.inicioS } : {}),   // retomar: queda en ese segundo, en pausa
        },
        events: {
          onReady: () => resolver(),
          onStateChange: (evento) => {
            const estado = ESTADOS[evento.data] || 'unstarted';
            if (estado === 'playing') this.ocultarSubtitulosDeYouTube();
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

  getDuration() {
    return Number(this.player?.getDuration?.() || 0);
  }

  getVideoData() {
    try { return this.player?.getVideoData?.() || {}; } catch (_) { return {}; }
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

  seekTo(segundos) {
    this.player?.seekTo?.(Math.max(0, Number(segundos) || 0), true);
  }

  getPlayerState() {
    return this.player?.getPlayerState?.();
  }

  /**
   * Quita los subtítulos propios de YouTube (salieron en alemán encima de la voz
   * en español, auditoría H12). `unloadModule` no está en la documentación
   * oficial: si no existe, no pasa nada. [POR CONFIRMAR en navegador real, T4.3]
   */
  ocultarSubtitulosDeYouTube() {
    for (const modulo of ['captions', 'cc']) {
      try { this.player?.unloadModule?.(modulo); } catch (_) { /* opcional */ }
    }
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
