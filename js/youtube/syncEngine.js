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

/*
 * Velocidad del video (2026-09-26, v4): ya no hay selector propio. La persona
 * elige la suya en el engranaje de YouTube (lo pidió así) y el motor de voz
 * frena el video solo cuando el español necesita más tiempo (ritmoDoblaje.js).
 */
export const TASA_MINIMA = 0.25;
export const TASA_MAXIMA = 2;

/** Limpia una velocidad guardada: número entre 0.25 y 2, con 2 decimales. */
export function normalizarTasa(valor) {
  const texto = String(valor ?? '').trim().replace(',', '.');
  if (!texto) return 1;   // vacío = sin cambio (Number('') sería 0 → 0.25x por sorpresa)
  const numero = Number(texto);
  if (!Number.isFinite(numero)) return 1;
  return Math.round(Math.min(TASA_MAXIMA, Math.max(TASA_MINIMA, numero)) * 100) / 100;
}

export class SyncEngine {
  /**
   * `indiceExterno()` (opcional) = segmento que está diciendo la voz en
   * español. Si da un número, el texto muestra esa línea (la que se oye); si da
   * `null`, sigue al reloj del video como siempre.
   */
  constructor({ player, segmentos, onSegmentChange, onPlaybackRateChange = () => {}, reloj = null, indiceExterno = null, seguirEnPausa = () => false }) {
    this.player = player;
    this.segmentos = segmentos;
    this.onSegmentChange = onSegmentChange;
    this.onPlaybackRateChange = onPlaybackRateChange;
    this.indiceExterno = typeof indiceExterno === 'function' ? indiceExterno : null;
    this.seguirEnPausa = seguirEnPausa;
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
    if (this.reproduciendo || this.seguirEnPausa()) this.reloj.iniciar();
    else {
      this.reloj.detener();
    }
    this.#actualizar();
  }

  #actualizar() {
    const deLaVoz = this.indiceExterno?.();
    const indice = Number.isInteger(deLaVoz) && deLaVoz >= -1
      ? deLaVoz
      : buscarIndiceSegmento(this.segmentos, this.player.getCurrentTime());
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
