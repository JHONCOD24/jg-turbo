import { crearReloj } from './reloj.js';

export function buscarIndiceSegmento(segmentos, tiempo) {
  let izquierda = 0;
  let derecha = segmentos.length - 1;
  let candidato = -1;
  while (izquierda <= derecha) {
    const mitad = Math.floor((izquierda + derecha) / 2);
    if (segmentos[mitad].startTime <= tiempo) {
      candidato = mitad;
      izquierda = mitad + 1;
    } else {
      derecha = mitad - 1;
    }
  }
  if (candidato < 0) return -1;
  return tiempo < segmentos[candidato].endTime ? candidato : -1;
}

export class SyncEngine {
  constructor({ player, segmentos, onSegmentChange, onPlaybackRateChange = () => {}, reloj = null }) {
    this.player = player;
    this.segmentos = segmentos;
    this.onSegmentChange = onSegmentChange;
    this.onPlaybackRateChange = onPlaybackRateChange;
    this.reloj = reloj || crearReloj(() => this.#actualizar(), { intervaloMs: 150 });
    this.indiceActivo = -2;
    this.reproduciendo = false;
    this.desuscribirEstado = player.suscribirEstado((estado) => this.#cambiarEstado(estado));
    this.desuscribirVelocidad = player.suscribirVelocidad((velocidad) => {
      // Los timestamps pertenecen al tiempo del video. Una tasa distinta solo
      // cambia qué tan rápido avanza getCurrentTime(), no exige recalcularlos.
      this.onPlaybackRateChange(velocidad);
      this.#actualizar();
    });
  }

  iniciar() {
    this.#actualizar();
    this.onPlaybackRateChange(this.player.getPlaybackRate());
    if (this.player.getPlayerState?.() === 1) { this.reproduciendo = true; this.reloj.iniciar(); }
  }

  #cambiarEstado(estado) {
    this.reproduciendo = estado === 'playing';
    if (this.reproduciendo) this.reloj.iniciar();
    else {
      this.reloj.detener();
      this.#actualizar();
    }
  }

  #actualizar() {
    const indice = buscarIndiceSegmento(this.segmentos, this.player.getCurrentTime());
    if (indice === this.indiceActivo) return;
    this.indiceActivo = indice;
    this.onSegmentChange(indice);
  }

  destruir() {
    this.reproduciendo = false;
    this.reloj.detener();
    this.desuscribirEstado?.();
    this.desuscribirVelocidad?.();
  }
}
