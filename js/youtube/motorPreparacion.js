/**
 * Prepara el doblaje ALREDEDOR de lo que se está viendo, no el video entero.
 *
 * Antes, un video de 88 min exigía 702 llamadas a la IA antes del primer sonido
 * (auditoría H3). Aquí se traduce hasta 3 min por delante y se sintetiza hasta
 * 90 s por delante; si la persona salta a otro punto, lo siguiente que se prepara
 * es lo de ese punto. Hasta 2 traducciones en vuelo, pero nunca dos salidas en
 * menos de 1,1 s (Mistral gratis ≈ 1 petición/s), y 2 síntesis a la vez dentro
 * del límite de 18 por minuto.
 */
import {
  siguienteLoteTraduccion, unidadesAGenerar, segundosCubiertos, segundosTraducidos,
  HORIZONTE_TRADUCCION_S, HORIZONTE_VOZ_S, VOZ_INICIAL_S, LOTE_ARRANQUE,
} from './planificador.js';
import { prepararTextoDeUnidad } from './dubbingService.js';
import { esLimiteDeUso } from './translationService.js';
import { fraccionesDeUnidad } from './ritmoDoblaje.js';
import { crearReloj } from './reloj.js';

// Un fallo que NO es límite de uso (red, servidor) suele ser pasajero: se repite
// el mismo lote pronto y, si sigue fallando, cada vez con más calma. Antes eran
// 15 s fijos: un solo tropiezo al arrancar dejaba al video esperando 15 s.
const PAUSAS_FALLO_MS = [3000, 8000, 15000];
const LIBERAR_ATRAS_S = 60;
/** Con menos de estos segundos traducidos por delante, se piden lotes cortos. */
const CERCA_DE_ARRANQUE_S = 8;
// Ante un 429 no basta con reintentar cada 15 s: si el cupo sigue lleno, cada
// reintento falla y el video se atasca «en unos segundos» para siempre. La
// espera crece (15 → 30 → 60 s) y el mensaje dice la espera real y van cuántos.
const PAUSAS_LIMITE_MS = [15000, 30000, 60000];
/**
 * Ritmo mínimo entre llamadas de traducción. El plan gratuito de Mistral da
 * ~1 petición/s: los lotes cortos vuelven en menos de 1 s y sin este freno la
 * propia app se auto-limita (429) en videos de habla rápida.
 */
export const INTERVALO_MIN_TRADUCCION_MS = 1100;

export class MotorPreparacion {
  constructor({
    segmentos, servicioVoz, traductor, posicion,
    origen = 'en', tituloVideo = '',
    limitadorVoz = null, reloj = null, ahora = () => Date.now(),
    concurrenciaTraduccion = 2, concurrenciaVoz = 2,
    horizonteTraduccionS = HORIZONTE_TRADUCCION_S, horizonteVozS = HORIZONTE_VOZ_S,
    intervaloTraduccionMs = INTERVALO_MIN_TRADUCCION_MS,
    onCambio = () => {}, onTraduccion = () => {}, signal = null,
  }) {
    Object.assign(this, {
      segmentos, servicioVoz, traductor, posicion, origen, tituloVideo, limitadorVoz, ahora,
      concurrenciaTraduccion, concurrenciaVoz, horizonteTraduccionS, horizonteVozS,
      intervaloTraduccionMs,
      onCambio, onTraduccion, signal,
    });
    this.traducciones = new Map();   // índice de segmento → texto | null (no se pudo)
    this.enCurso = new Set();
    this.lotesActivos = 0;
    this.vozActiva = 0;
    this.pausaHasta = 0;
    this.ultimoLoteMs = -this.intervaloTraduccionMs;   // el primer lote sale al instante
    this.rachasLimite = 0;   // 429 seguidos (espera creciente)
    this.rachasFallo = 0;    // otros fallos seguidos (espera corta y creciente)
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
    // Ritmo mínimo: un lote nuevo solo si pasó el intervalo desde el anterior
    // (uno por paso, aunque quepan dos en vuelo). Sin esto, los lotes cortos
    // (habla rápida) salen a >1/s y Mistral gratis responde 429: la app se
    // limitaba a sí misma.
    if (
      this.ahora() >= this.pausaHasta
      && this.ahora() - this.ultimoLoteMs >= this.intervaloTraduccionMs
      && this.lotesActivos < this.concurrenciaTraduccion
    ) {
      const traducido = (i) => this.traducciones.has(i);
      const cerca = segundosTraducidos(this.segmentos, traducido, t) < CERCA_DE_ARRANQUE_S;
      const lote = siguienteLoteTraduccion(
        this.segmentos,
        { traducido, enCurso: (i) => this.enCurso.has(i) },
        t,
        { horizonteS: this.horizonteTraduccionS, ...(cerca ? { maxSegmentos: LOTE_ARRANQUE } : {}) },
      );
      if (lote) this.#traducir(lote);
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
    this.ultimoLoteMs = this.ahora();
    try {
      const mapa = await this.traductor.traducirLote(indices, this.segmentos, {
        origen: this.origen, tituloVideo: this.tituloVideo, signal: this.signal,
      });
      this.rachasLimite = 0;   // hubo éxito: se olvida la racha de 429
      this.rachasFallo = 0;
      for (const [indice, texto] of mapa) {
        this.traducciones.set(indice, texto);
        if (texto === null) this.errores.traduccion += 1;
        this.onTraduccion(indice, texto);
      }
      this.#rellenarUnidades();
    } catch (error) {
      if (this.signal?.aborted) return;
      if (esLimiteDeUso(error)) {
        this.rachasLimite += 1;
        const espera = PAUSAS_LIMITE_MS[Math.min(this.rachasLimite, PAUSAS_LIMITE_MS.length) - 1];
        this.pausaHasta = this.ahora() + espera;
        this.onCambio({
          tipo: 'pausa',
          mensaje: `El traductor pidió una pausa por límite de uso (van ${this.rachasLimite}): seguimos en unos ${Math.round(espera / 1000)} s…`,
        });
        return;
      }
      // Otro fallo (red, servidor): se repite el MISMO lote tras una pausa corta
      // que crece si insiste. Nunca se marca el texto como intraducible por esto.
      this.rachasFallo += 1;
      const espera = PAUSAS_FALLO_MS[Math.min(this.rachasFallo, PAUSAS_FALLO_MS.length) - 1];
      this.pausaHasta = this.ahora() + espera;
      this.onCambio({
        tipo: 'pausa',
        mensaje: `La traducción falló un momento; reintentamos en unos ${Math.round(espera / 1000)} s.`,
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
      const texto = prepararTextoDeUnidad(this.servicioVoz.unidades, unidad.indice, this.traducciones);
      if (texto === null) continue;
      // Fracciones de cada segmento dentro de la frase: el subtítulo sigue a la voz.
      this.servicioVoz.fijarTexto(unidad.indice, texto, fraccionesDeUnidad(unidad, (i) => this.traducciones.get(i)));
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
