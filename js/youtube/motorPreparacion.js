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
  HORIZONTE_TRADUCCION_S, HORIZONTE_VOZ_S, VOZ_INICIAL_S, LOTE_ARRANQUE, vozReintentable,
} from './planificador.js';
import { prepararTextoDeUnidad } from './dubbingService.js';
import {
  esLimiteDeUso, traduccionesReutilizables, anotarIntentos, MAX_INTENTOS_TRADUCCION, MAX_SEGMENTOS_POR_LOTE,
} from './translationService.js';
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
/**
 * Ritmo de la traducción de FONDO (más allá de los 3 min de prisa): sin apuro,
 * para no gastar el cupo que necesita lo que se está viendo.
 */
export const INTERVALO_FONDO_TRADUCCION_MS = 1500;

export class MotorPreparacion {
  constructor({
    segmentos, servicioVoz, traductor, posicion,
    origen = 'en', tituloVideo = '',
    limitadorVoz = null, reloj = null, ahora = () => Date.now(),
    // 3 turnos de voz: una síntesis lenta ya no frena a las demás (el límite de
    // 18 por minuto lo sigue poniendo `limitadorVoz`).
    concurrenciaTraduccion = 2, concurrenciaVoz = 3,
    horizonteTraduccionS = HORIZONTE_TRADUCCION_S, horizonteVozS = HORIZONTE_VOZ_S,
    intervaloTraduccionMs = INTERVALO_MIN_TRADUCCION_MS,
    intervaloFondoMs = INTERVALO_FONDO_TRADUCCION_MS,
    onCambio = () => {}, onTraduccion = () => {}, signal = null,
  }) {
    Object.assign(this, {
      segmentos, servicioVoz, traductor, posicion, origen, tituloVideo, limitadorVoz, ahora,
      concurrenciaTraduccion, concurrenciaVoz, horizonteTraduccionS, horizonteVozS,
      intervaloTraduccionMs, intervaloFondoMs,
      onCambio, onTraduccion, signal,
    });
    this.traducciones = new Map();   // índice de segmento → texto | null (no se pudo)
    this.intentosFallidos = new Map();   // índice → aperturas en que volvió null (se guarda)
    this.enCurso = new Set();
    this.lotesActivos = 0;
    this.vozActiva = 0;
    this.pausaHasta = 0;
    this.ultimoLoteMs = -this.intervaloTraduccionMs;   // el primer lote sale al instante
    this.rachasLimite = 0;   // 429 seguidos (espera creciente)
    this.rachasFallo = 0;    // otros fallos seguidos (espera corta y creciente)
    this.errores = { traduccion: 0, voz: 0 };
    // Con la voz apagada (audio original + subtítulos) no se sintetiza nada:
    // la cuota de voz gratuita es limitada y nadie la oiría.
    this.vozEnPausa = false;
    this.reloj = reloj || crearReloj(() => this.paso(), { intervaloMs: 300 });
  }

  /**
   * Traducciones ya guardadas (caché, T3.1): no se vuelven a pagar. Un `null`
   * guardado se vuelve a pedir hasta MAX_INTENTOS_TRADUCCION aperturas (v167).
   */
  sembrar(entradas, intentosFallidos = []) {
    for (const [indice, texto] of traduccionesReutilizables(entradas, intentosFallidos)) this.traducciones.set(indice, texto);
    this.intentosFallidos = new Map(intentosFallidos || []);
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
    if (this.ahora() >= this.pausaHasta && this.lotesActivos < this.concurrenciaTraduccion) {
      const lote = this.#siguienteLote(t);
      if (lote) this.#traducir(lote.indices, { fondo: lote.fondo });
    }
    while (!this.vozEnPausa && this.vozActiva < this.concurrenciaVoz && (!this.limitadorVoz || this.limitadorVoz.disponible())) {
      const [indice] = unidadesAGenerar(this.servicioVoz.unidades, t, { horizonteS: this.horizonteVozS, limite: 1, ahoraMs: this.ahora() });
      if (indice === undefined) break;
      this.#generarVoz(indice);
    }
    this.servicioVoz.liberarAntesDe(t - LIBERAR_ATRAS_S);
  }

  /**
   * Qué traducir ahora. Primero lo de los próximos 3 min, a ritmo normal; luego
   * el resto del video hasta el final y, después, lo que quedó ANTES de la
   * posición (si se empezó a mitad), a ritmo de fondo. Así el subtítulo nunca
   * espera a la IA: al rato de empezar, el video entero ya está traducido.
   */
  #siguienteLote(t) {
    const desde = this.ahora() - this.ultimoLoteMs;
    if (desde < this.intervaloTraduccionMs) return null;
    const traducido = (i) => this.traducciones.has(i);
    const estado = { traducido, enCurso: (i) => this.enCurso.has(i) };
    const cerca = segundosTraducidos(this.segmentos, traducido, t) < CERCA_DE_ARRANQUE_S;
    const urgente = siguienteLoteTraduccion(this.segmentos, estado, t, {
      horizonteS: this.horizonteTraduccionS, ...(cerca ? { maxSegmentos: LOTE_ARRANQUE } : {}),
    });
    if (urgente) return { indices: urgente, fondo: false };
    if (desde < this.intervaloFondoMs) return null;
    const fondo = siguienteLoteTraduccion(this.segmentos, estado, t, { horizonteS: Number.POSITIVE_INFINITY })
      || siguienteLoteTraduccion(this.segmentos, estado, 0, { horizonteS: Number.POSITIVE_INFINITY })
      || this.#loteParaRepetir();
    return fondo ? { indices: fondo, fondo: true } : null;
  }

  /**
   * Con todo lo demás traducido, se vuelve a pedir lo que la IA no devolvió
   * (`null`), con su tope de intentos. Antes ese tramo quedaba en inglés (voz y
   * subtítulo) hasta volver a abrir el video.
   */
  #loteParaRepetir() {
    const pendientes = [...this.traducciones]
      .filter(([indice, texto]) => texto === null && !this.enCurso.has(indice)
        && (this.intentosFallidos.get(indice) || 0) < MAX_INTENTOS_TRADUCCION)
      .map(([indice]) => indice)
      .sort((x, y) => x - y);
    const lote = [];
    for (const indice of pendientes) {
      if (lote.length && (indice !== lote[lote.length - 1] + 1 || lote.length >= MAX_SEGMENTOS_POR_LOTE)) break;
      lote.push(indice);
    }
    return lote.length ? lote : null;
  }

  /** Un tramo que se oía en el original porque faltaba su traducción vuelve a esperar texto. */
  #reabrirUnidad(indiceSegmento) {
    const unidad = this.servicioVoz.unidades.find((u) => u.desde <= indiceSegmento && indiceSegmento <= u.hasta && u.duration > 0);
    if (unidad && unidad.estado === 'sin_voz' && !unidad.text) unidad.estado = 'sin_traducir';
  }

  async #traducir(indices, { fondo = false } = {}) {
    indices.forEach((i) => this.enCurso.add(i));
    this.lotesActivos += 1;
    this.ultimoLoteMs = this.ahora();
    try {
      const mapa = await this.traductor.traducirLote(indices, this.segmentos, {
        origen: this.origen, tituloVideo: this.tituloVideo, signal: this.signal,
      });
      this.rachasLimite = 0;   // hubo éxito: se olvida la racha de 429
      this.rachasFallo = 0;
      this.intentosFallidos = new Map(anotarIntentos(this.intentosFallidos, mapa));
      for (const [indice, texto] of mapa) {
        if (texto !== null && this.traducciones.get(indice) === null) this.#reabrirUnidad(indice);
        this.traducciones.set(indice, texto);
        // Solo cuenta lo que ya no se volverá a pedir: eso sonará en el original.
        if (texto === null && (this.intentosFallidos.get(indice) || 0) >= MAX_INTENTOS_TRADUCCION) this.errores.traduccion += 1;
        this.onTraduccion(indice, texto);
      }
      this.#rellenarUnidades();
    } catch (error) {
      if (this.signal?.aborted) return;
      if (esLimiteDeUso(error)) {
        this.rachasLimite += 1;
        const espera = PAUSAS_LIMITE_MS[Math.min(this.rachasLimite, PAUSAS_LIMITE_MS.length) - 1];
        this.pausaHasta = this.ahora() + espera;
        // La traducción de fondo va minutos por delante: su pausa no afecta a
        // lo que se ve y anunciarla solo alarmaría.
        if (!fondo) this.onCambio({
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
      if (!fondo) this.onCambio({
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
      // Solo cuenta cuando ya no habrá otro intento: esa frase sonará en su idioma original.
      const unidad = this.servicioVoz.unidades[indice];
      if (!this.signal?.aborted && unidad && !vozReintentable(unidad)) this.errores.voz += 1;
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
