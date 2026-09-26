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

/**
 * Velocidad del video a gusto de la persona (2026-09-26).
 *
 * Por qué: en videos muy rápidos el español no cabe y la voz se acelera hasta
 * sonar mal. Al desacelerar el video, cada frase tiene MÁS tiempo y la voz
 * cabe sin acelerar: el doblaje la sigue solo (el motor multiplica por la
 * velocidad del video). YouTube solo ofrece 0.25/0.5/0.75/1/…/2, así que aquí
 * hay presets finos (0.80, 0.85, 0.97…) más un valor libre. Si el reproductor
 * redondea un valor libre, se lee la tasa REAL y se muestra esa.
 */
export const TASAS_SUGERIDAS = [0.5, 0.6, 0.7, 0.75, 0.8, 0.85, 0.9, 0.95, 0.97, 1, 1.05, 1.1, 1.25, 1.5, 1.75, 2];
export const TASA_MINIMA = 0.25;
export const TASA_MAXIMA = 2;
export const VALOR_TASA_LIBRE = 'libre';

/** Unión ordenada sin repetidos de lo que ofrece YouTube y los presets. */
export function tasasParaSelector(disponibles) {
  const conjunto = new Set(TASAS_SUGERIDAS);
  for (const tasa of Array.isArray(disponibles) ? disponibles : []) {
    const numero = Number(tasa);
    if (Number.isFinite(numero)) conjunto.add(Math.round(numero * 100) / 100);
  }
  return [...conjunto].sort((a, b) => a - b);
}

/** Limpia lo que escribe la persona: número entre 0.25 y 2, con 2 decimales. */
export function normalizarTasa(valor) {
  const texto = String(valor ?? '').trim().replace(',', '.');
  if (!texto) return 1;   // vacío = sin cambio (Number('') sería 0 → 0.25x por sorpresa)
  const numero = Number(texto);
  if (!Number.isFinite(numero)) return 1;
  return Math.round(Math.min(TASA_MAXIMA, Math.max(TASA_MINIMA, numero)) * 100) / 100;
}

/** ¿Hay un preset igual (a 0.005) a esta tasa? Si no, va por la libre. */
export function presetDeTasa(tasas, valor) {
  const numero = Number(valor);
  if (!Number.isFinite(numero)) return null;
  return (Array.isArray(tasas) ? tasas : []).find((t) => Math.abs(t - numero) < 0.005) ?? null;
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
