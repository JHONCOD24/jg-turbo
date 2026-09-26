/**
 * Prepara el doblaje ALREDEDOR de lo que se está viendo, no el video entero.
 *
 * Antes, un video de 88 min exigía 702 llamadas a la IA antes del primer sonido
 * (auditoría H3). Aquí se traduce hasta 3 min por delante y se sintetiza hasta
 * 90 s por delante; si la persona salta a otro punto, lo siguiente que se prepara
 * es lo de ese punto. 1 traducción a la vez (Mistral gratis ≈ 1 petición/s) y 2
 * síntesis a la vez, dentro del límite de 18 por minuto.
 */
import {
  siguienteLoteTraduccion, unidadesAGenerar, segundosCubiertos, segundosTraducidos,
  HORIZONTE_TRADUCCION_S, HORIZONTE_VOZ_S, VOZ_INICIAL_S,
} from './planificador.js';
import { textoDeUnidad } from './dubbingService.js';
import { esLimiteDeUso } from './translationService.js';
import { crearReloj } from './reloj.js';

const PAUSA_TRAS_LIMITE_MS = 15000;
const LIBERAR_ATRAS_S = 60;

export class MotorPreparacion {
  constructor({
    segmentos, servicioVoz, traductor, posicion,
    origen = 'en', tituloVideo = '',
    limitadorVoz = null, reloj = null, ahora = () => Date.now(),
    concurrenciaTraduccion = 1, concurrenciaVoz = 2,
    horizonteTraduccionS = HORIZONTE_TRADUCCION_S, horizonteVozS = HORIZONTE_VOZ_S,
    onCambio = () => {}, onTraduccion = () => {}, signal = null,
  }) {
    Object.assign(this, {
      segmentos, servicioVoz, traductor, posicion, origen, tituloVideo, limitadorVoz, ahora,
      concurrenciaTraduccion, concurrenciaVoz, horizonteTraduccionS, horizonteVozS,
      onCambio, onTraduccion, signal,
    });
    this.traducciones = new Map();   // índice de segmento → texto | null (no se pudo)
    this.enCurso = new Set();
    this.lotesActivos = 0;
    this.vozActiva = 0;
    this.pausaHasta = 0;
    this.errores = { traduccion: 0, voz: 0 };
    this.reloj = reloj || crearReloj(() => this.paso(), { intervaloMs: 300 });
  }

  /** Traducciones ya guardadas (caché, T3.1): no se vuelven a pagar. */
  sembrar(entradas) {
    for (const [indice, texto] of entradas || []) this.traducciones.set(Number(indice), texto);
    this.#rellenarUnidades();
  }

  iniciar() { this.reloj.iniciar(); this.paso(); }

  detener() { this.reloj.detener(); }

  paso() {
    if (this.signal?.aborted) { this.detener(); return; }
    const t = Number(this.posicion()) || 0;
    if (this.ahora() >= this.pausaHasta) {
      while (this.lotesActivos < this.concurrenciaTraduccion) {
        const lote = siguienteLoteTraduccion(
          this.segmentos,
          { traducido: (i) => this.traducciones.has(i), enCurso: (i) => this.enCurso.has(i) },
          t,
          { horizonteS: this.horizonteTraduccionS },
        );
        if (!lote) break;
        this.#traducir(lote);
      }
    }
    while (this.vozActiva < this.concurrenciaVoz && (!this.limitadorVoz || this.limitadorVoz.disponible())) {
      const [indice] = unidadesAGenerar(this.servicioVoz.unidades, t, { horizonteS: this.horizonteVozS, limite: 1 });
      if (indice === undefined) break;
      this.#generarVoz(indice);
    }
    this.servicioVoz.liberarAntesDe(t - LIBERAR_ATRAS_S);
  }

  async #traducir(indices) {
    indices.forEach((i) => this.enCurso.add(i));
    this.lotesActivos += 1;
    try {
      const mapa = await this.traductor.traducirLote(indices, this.segmentos, {
        origen: this.origen, tituloVideo: this.tituloVideo, signal: this.signal,
      });
      for (const [indice, texto] of mapa) {
        this.traducciones.set(indice, texto);
        if (texto === null) this.errores.traduccion += 1;
        this.onTraduccion(indice, texto);
      }
      this.#rellenarUnidades();
    } catch (error) {
      if (this.signal?.aborted) return;
      // 429 u otro fallo general: respirar y reintentar más tarde, sin marcar el texto.
      this.pausaHasta = this.ahora() + PAUSA_TRAS_LIMITE_MS;
      this.onCambio({
        tipo: 'pausa',
        mensaje: esLimiteDeUso(error)
          ? 'El traductor pidió una pausa por límite de uso; seguimos en unos segundos.'
          : 'La traducción falló un momento; reintentamos en unos segundos.',
      });
    } finally {
      indices.forEach((i) => this.enCurso.delete(i));
      this.lotesActivos -= 1;
      this.onCambio({ tipo: 'progreso' });
    }
  }

  #rellenarUnidades() {
    for (const unidad of this.servicioVoz.unidades) {
      if (unidad.estado !== 'sin_traducir') continue;
      const texto = textoDeUnidad(unidad, this.traducciones);
      if (texto !== null) this.servicioVoz.fijarTexto(unidad.indice, texto);
    }
  }

  async #generarVoz(indice) {
    this.vozActiva += 1;
    try {
      await this.servicioVoz.asegurar(indice);
    } catch (_) {
      if (!this.signal?.aborted) this.errores.voz += 1;   // esa frase sonará en su idioma original
    } finally {
      this.vozActiva -= 1;
      this.onCambio({ tipo: 'progreso' });
    }
  }

  resumen() {
    const t = Number(this.posicion()) || 0;
    return {
      vozHastaS: segundosCubiertos(this.servicioVoz.unidades, t),
      traducidoHastaS: segundosTraducidos(this.segmentos, (i) => this.traducciones.has(i), t),
      errores: { ...this.errores },
    };
  }

  /** Se resuelve cuando hay `vozInicialS` segundos resueltos desde la posición actual. */
  esperarArranque({ vozInicialS = VOZ_INICIAL_S, onProgreso = () => {} } = {}) {
    return new Promise((resolver, rechazar) => {
      const revisar = () => {
        if (this.signal?.aborted) { rechazar(new DOMException('Cancelado', 'AbortError')); return true; }
        const resumen = this.resumen();
        onProgreso(resumen);
        if (resumen.vozHastaS >= vozInicialS) { resolver(resumen); return true; }
        return false;
      };
      if (revisar()) return;
      const id = setInterval(() => { if (revisar()) clearInterval(id); }, 250);
    });
  }
}
