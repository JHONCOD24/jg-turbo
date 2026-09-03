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
  constructor({ player, segmentos, onSegmentChange, onPlaybackRateChange = () => {} }) {
    this.player = player;
    this.segmentos = segmentos;
    this.onSegmentChange = onSegmentChange;
    this.onPlaybackRateChange = onPlaybackRateChange;
    this.frame = 0;
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
  }

  #cambiarEstado(estado) {
    this.reproduciendo = estado === 'playing';
    if (this.reproduciendo) this.#programar();
    else {
      cancelAnimationFrame(this.frame);
      this.frame = 0;
      this.#actualizar();
    }
  }

  #programar() {
    if (this.frame || !this.reproduciendo) return;
    const tick = () => {
      this.frame = 0;
      this.#actualizar();
      if (this.reproduciendo) this.#programar();
    };
    this.frame = requestAnimationFrame(tick);
  }

  #actualizar() {
    const indice = buscarIndiceSegmento(this.segmentos, this.player.getCurrentTime());
    if (indice === this.indiceActivo) return;
    this.indiceActivo = indice;
    this.onSegmentChange(indice);
  }

  destruir() {
    this.reproduciendo = false;
    cancelAnimationFrame(this.frame);
    this.desuscribirEstado?.();
    this.desuscribirVelocidad?.();
  }
}
