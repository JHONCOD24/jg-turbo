const CODIGOS = { unstarted: -1, ended: 0, playing: 1, paused: 2, buffering: 3 };
export class ReproductorRemoto {
  constructor(puerto, { ahora = () => Date.now() } = {}) {
    this.puerto = puerto;
    this.ahora = ahora;
    this.datos = { t: 0, tasa: 1, pausado: true, terminado: false, esperando: false, volumen: 1, silenciado: false, duracion: 0 };
    this.recibidoEn = ahora();
    this.estado = 'unstarted';
    this.titulo = '';
    this.estados = new Set();
    this.velocidades = new Set();
    this.conectado = true;
    this.recibir = (mensaje) => {
      if (mensaje.tipo === 'clase') this.titulo = mensaje.titulo || '';
      if (mensaje.tipo !== 'estado') return;
      const anterior = this.estado, tasaAnterior = this.datos.tasa;
      this.datos = { ...this.datos, ...mensaje };
      this.recibidoEn = ahora();
      this.estado = mensaje.terminado ? 'ended' : mensaje.pausado ? 'paused' : mensaje.esperando ? 'buffering' : 'playing';
      if (this.estado !== anterior) this.estados.forEach((f) => f(this.estado));
      if (this.datos.tasa !== tasaAnterior) this.velocidades.forEach((f) => f(this.datos.tasa));
    };
    this.desconectar = () => {
      this.datos.t = this.getCurrentTime();
      this.datos.pausado = true;
      this.estado = 'paused';
      this.conectado = false;
      this.estados.forEach((f) => f('paused'));
    };
    puerto.onMessage.addListener(this.recibir);
    puerto.onDisconnect.addListener(this.desconectar);
  }
  getCurrentTime() {
    const extra = !this.datos.pausado && !this.datos.esperando && !this.datos.terminado ? Math.max(0, this.ahora() - this.recibidoEn) / 1000 * this.datos.tasa : 0;
    return this.datos.t + extra;
  }
  getDuration() { return this.datos.duracion; }
  getVideoData() { return { title: this.titulo }; }
  getPlaybackRate() { return this.datos.tasa; }
  getAvailablePlaybackRates() { return Array.from({ length: 31 }, (_, i) => Math.round((.5 + i * .05) * 100) / 100); }
  getPlayerState() { return CODIGOS[this.estado]; }
  getVolume() { return this.datos.volumen * 100; }
  isMuted() { return this.datos.silenciado; }
  orden(accion, valor) { if (this.conectado) this.puerto.postMessage({ tipo: 'orden', accion, valor }); }
  setPlaybackRate(valor) {
    this.datos.t = this.getCurrentTime(); this.recibidoEn = this.ahora();
    this.datos.tasa = Number(valor); this.orden('velocidad', Number(valor));
  }
  setVolume(valor) { this.datos.volumen = Math.max(0, Math.min(100, Number(valor))) / 100; this.orden('volumen', this.datos.volumen); }
  mute() { this.datos.silenciado = true; this.orden('silencio', true); }
  unMute() { this.datos.silenciado = false; this.orden('silencio', false); }
  playVideo() { this.datos.pausado = false; this.estado = 'playing'; this.recibidoEn = this.ahora(); this.orden('play'); }
  pauseVideo() { this.datos.t = this.getCurrentTime(); this.datos.pausado = true; this.estado = 'paused'; this.orden('pausa'); }
  ocultarSubtitulosDeYouTube() {}
  suscribirEstado(f) { this.estados.add(f); return () => this.estados.delete(f); }
  suscribirVelocidad(f) { this.velocidades.add(f); return () => this.velocidades.delete(f); }
  destruir() {
    if (this.conectado) { this.puerto.postMessage({ tipo: 'restaurar' }); this.puerto.disconnect(); }
    this.puerto.onMessage.removeListener(this.recibir);
    this.puerto.onDisconnect.removeListener(this.desconectar);
    this.estados.clear(); this.velocidades.clear();
  }
}
