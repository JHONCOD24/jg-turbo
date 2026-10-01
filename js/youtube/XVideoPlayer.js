/**
 * Reproductor de videos de X con el mismo contrato que YouTubePlayer, para que el
 * doblaje (dubbingEngine, syncEngine) no sepa de qué plataforma es el video.
 *
 * El <video> vive en /x-reproductor.html (mismo origen, sin Referer): X responde
 * 403 a peticiones con Referer de otro dominio. Al ser del mismo origen, esta
 * clase maneja ese <video> directamente y recibe sus eventos.
 */
const VELOCIDADES = Object.freeze([0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2]);
export const CODIGO_ESTADO = Object.freeze({ unstarted: -1, ended: 0, playing: 1, paused: 2, buffering: 3 });
const ESPERA_METADATOS_MS = 15000;

export function estadoDeVideo(video, { arranco = false } = {}) {
  if (!video) return 'unstarted';
  if (video.ended) return 'ended';
  if (video.paused) return arranco ? 'paused' : 'unstarted';
  return video.readyState < 3 ? 'buffering' : 'playing';
}

export class XVideoPlayer {
  /**
   * `etiqueta` y `mensajeError`: los videos del equipo usan este mismo reproductor
   * (un blob: del mismo origen carga igual dentro del iframe, medido 2026-10-01).
   */
  constructor(elemento, {
    mp4 = '', portada = '', titulo = '', etiqueta = 'Video de X',
    mensajeError = 'X no dejó reproducir este video aquí. Prueba de nuevo o ábrelo en x.com.',
  } = {}) {
    this.destino = typeof elemento === 'string' ? document.getElementById(elemento) : elemento;
    this.etiqueta = etiqueta;
    this.mensajeError = mensajeError;
    this.mp4 = mp4;
    this.portada = portada;
    this.titulo = titulo;
    this.marco = null;
    this.video = null;
    this.arranco = false;
    this.estadoListeners = new Set();
    this.velocidadListeners = new Set();
    this.quitarEventos = [];
  }

  async inicializar() {
    if (!this.destino) throw new Error('No hay dónde poner el reproductor de X.');
    const marco = document.createElement('iframe');
    marco.id = this.destino.id || 'ytPlayer';
    marco.title = this.titulo ? `${this.etiqueta}: ${this.titulo}` : this.etiqueta;
    marco.setAttribute('allow', 'autoplay; fullscreen; picture-in-picture');
    marco.setAttribute('referrerpolicy', 'no-referrer');
    const cargado = new Promise((resolver) => marco.addEventListener('load', resolver, { once: true }));
    marco.src = '/x-reproductor.html';
    this.destino.replaceWith(marco);
    this.marco = marco;
    await cargado;
    const video = marco.contentDocument?.querySelector('video');
    if (!video) throw new Error('No se pudo preparar el reproductor de X.');
    this.video = video;

    const avisar = (estado) => this.estadoListeners.forEach((fn) => fn(estado));
    const escuchar = (evento, fn) => {
      video.addEventListener(evento, fn);
      this.quitarEventos.push(() => video.removeEventListener(evento, fn));
    };
    escuchar('playing', () => { this.arranco = true; avisar('playing'); });
    escuchar('pause', () => avisar(video.ended ? 'ended' : 'paused'));
    escuchar('waiting', () => avisar('buffering'));
    escuchar('ended', () => avisar('ended'));
    escuchar('ratechange', () => this.velocidadListeners.forEach((fn) => fn(this.getPlaybackRate())));

    await new Promise((resolver, rechazar) => {
      const limpiar = () => { clearTimeout(tope); video.removeEventListener('loadedmetadata', listo); video.removeEventListener('error', fallo); };
      const listo = () => { limpiar(); resolver(); };
      const fallo = () => { limpiar(); rechazar(new Error(this.mensajeError)); };
      const tope = setTimeout(() => { limpiar(); resolver(); }, ESPERA_METADATOS_MS);   // lento ≠ roto: se sigue
      video.addEventListener('loadedmetadata', listo);
      video.addEventListener('error', fallo);
      if (this.portada) video.poster = this.portada;
      video.src = this.mp4;
    });
    return this;
  }

  getCurrentTime() { return Number(this.video?.currentTime || 0); }
  getDuration() { const d = Number(this.video?.duration); return Number.isFinite(d) ? d : 0; }
  getVideoData() { return { title: this.titulo }; }
  getPlaybackRate() { return Number(this.video?.playbackRate || 1); }
  getAvailablePlaybackRates() { return [...VELOCIDADES]; }
  setPlaybackRate(velocidad) {
    const v = Math.max(0.25, Math.min(2, Number(velocidad) || 1));
    if (this.video) this.video.playbackRate = v;
  }
  playVideo() {
    const intento = this.video?.play?.();
    // Si el navegador exige un toque, el estado queda en pausa y la app muestra «Ver con voz en español».
    intento?.catch?.(() => this.estadoListeners.forEach((fn) => fn('paused')));
  }
  pauseVideo() { this.video?.pause?.(); }
  seekTo(segundos) { if (this.video) this.video.currentTime = Math.max(0, Number(segundos) || 0); }
  getPlayerState() { return CODIGO_ESTADO[estadoDeVideo(this.video, { arranco: this.arranco })]; }
  getVolume() { return Math.round(Number(this.video?.volume ?? 1) * 100); }
  setVolume(valor) {
    const numero = Math.max(0, Math.min(100, Number(valor)));
    if (this.video && Number.isFinite(numero)) this.video.volume = numero / 100;   // iPhone lo ignora: ahí se silencia
  }
  mute() { if (this.video) this.video.muted = true; }
  unMute() { if (this.video) this.video.muted = false; }
  isMuted() { return Boolean(this.video?.muted); }
  ocultarSubtitulosDeYouTube() { /* X no pinta subtítulos propios encima */ }
  suscribirEstado(fn) { this.estadoListeners.add(fn); return () => this.estadoListeners.delete(fn); }
  suscribirVelocidad(fn) { this.velocidadListeners.add(fn); return () => this.velocidadListeners.delete(fn); }

  destruir() {
    this.estadoListeners.clear();
    this.velocidadListeners.clear();
    this.quitarEventos.forEach((quitar) => quitar());
    this.quitarEventos = [];
    if (this.video) {
      this.video.pause();
      this.video.removeAttribute('src');
      this.video.load();   // suelta la conexión: si no, el navegador sigue bajando el MP4
    }
    this.marco?.remove();
    this.video = null;
    this.marco = null;
  }
}
