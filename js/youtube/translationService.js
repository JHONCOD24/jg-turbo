export const MAX_SEGMENTOS_POR_LOTE = 8;
export const MAX_CHARS_POR_LOTE = 2800;
const CONCURRENCIA = 2;

/* Cortar el lote en cada pausa suena bien, pero hay videos con un silencio
   entre CADA subtítulo: así el lote acababa teniendo un solo segmento, la IA
   traducía media frase suelta —justo lo que queríamos evitar— y salían tantas
   llamadas como segmentos. Medido: 150 segmentos → 150 lotes. Por eso una pausa
   solo cierra el lote cuando ya hay material suficiente dentro. */
export const MIN_SEGMENTOS_PARA_CERRAR = 3;
export const MIN_CHARS_PARA_CERRAR = 350;

/* Si la traducción de un lote sale mucho más corta que el original, la IA se
   comió segmentos: pasa cuando reparte el texto entre los marcadores y se queda
   sin sitio antes de llegar al final. Los marcadores siguen estando todos, así
   que contarlos no lo detecta; hay que mirar cuánto texto volvió.

   Umbral medido sobre 6 traducciones del mismo lote (24/08/2026): las tres
   correctas dieron 1,016 · 1,064 · 1,016 y las tres que perdieron segmentos
   dieron 0,769 · 0,804 · 0,785. 0,85 queda en medio, con margen a los dos lados.

   Pero el 2026-09-26 se midieron traducciones CORRECTAS de 0,74–0,83 en un video
   real («and that would be worth a million» → «eso valdría un millón»): el
   español a veces es más compacto. Rechazarlas partía el lote hasta frase por
   frase (7 llamadas y ~5 s en el arranque, y sin contexto). Como perder
   segmentos es intermitente (3 de 6), en la zona gris se repite UNA vez el lote
   entero: si vuelve completo se usa; si vuelve igual de compacto, es el idioma. */
const MIN_PROPORCION_TRADUCCION = 0.85;
/** Por debajo de esto falta texto casi seguro: se parte el lote sin más. */
const MIN_PROPORCION_POSIBLE = 0.6;
/** Dos intentos compactos «iguales» (±0,1) = español compacto, no un hueco. */
const TOLERANCIA_REPETICION = 0.1;

function marcador(indice) {
  return `[[JG_SEG_${String(indice).padStart(6, '0')}]]`;
}

export function piezaDeLote(indice, texto) {
  return `${marcador(indice)}\n${texto}`;
}

/* Un `null` guardado («no se pudo traducir») no es una traducción: al reabrir
   el video se vuelve a pedir. Antes contaba como hecho y ese tramo sonaba en el
   idioma original para siempre (v167). Tope: tras estas aperturas fallidas se
   deja como está, para no gastar cuota en un segmento que la IA no acepta. */
export const MAX_INTENTOS_TRADUCCION = 3;

/** Lo guardado que cuenta como ya traducido: índice → texto (o `null` si agotó sus intentos). */
export function traduccionesReutilizables(entradas, intentosFallidos) {
  const intentos = new Map(intentosFallidos || []);
  const salida = new Map();
  for (const [indice, texto] of entradas || []) {
    if (texto !== null || (intentos.get(Number(indice)) || 0) >= MAX_INTENTOS_TRADUCCION) salida.set(Number(indice), texto);
  }
  return salida;
}

/** Intentos fallidos tras una tanda: +1 a lo que volvió `null`, se olvida lo traducido. */
export function anotarIntentos(intentosFallidos, resultados) {
  const intentos = new Map(intentosFallidos || []);
  for (const [indice, texto] of resultados || []) {
    if (texto === null) intentos.set(indice, (intentos.get(indice) || 0) + 1);
    else intentos.delete(indice);
  }
  return [...intentos];
}

/** Un 429 o «límite de uso»: el motor hace una pausa y reintenta; no es culpa del texto. */
export function esLimiteDeUso(error) {
  return /\b429\b|l[ií]mite de uso|rate.?limit|too many requests/i.test(String(error?.message || error || ''));
}

/**
 * ¿Falló por el TEXTO (la IA rompió marcadores o dejó la traducción a medias)?
 * Solo entonces sirve partir el lote en mitades. Un fallo de red o del servidor
 * se arregla repitiendo el mismo lote: partirlo multiplicaba las llamadas
 * (13 llamadas y dos 500 antes del primer sonido, medido 2026-09-26).
 */
export function esFalloDeContenido(error) {
  return /incomplet|mezclad|marcador|JG_SEG/i.test(String(error?.message || error || ''));
}

/** Quita marcadores sueltos: el modelo a veces copia el del ejemplo del prompt. */
export function sinMarcadores(texto) {
  return String(texto || '').replace(/\[\[\s*JG_SEG_\d+\s*\]\]/gi, ' ').replace(/\s+/g, ' ').trim();
}

/** Respuesta de la IA o error: la traducción de respaldo sin IA no sirve para doblar. */
function textoDeIA(respuesta) {
  if (respuesta && typeof respuesta === 'object' && respuesta.ia_used === false) {
    throw new Error('La IA de traducción no respondió; se reintenta en unos segundos.');
  }
  return respuesta?.text ?? respuesta;
}

export function crearLotes(segmentos) {
  const lotes = [];
  let actual = [];
  let caracteres = 0;
  const cerrar = () => {
    if (!actual.length) return;
    lotes.push(actual);
    actual = [];
    caracteres = 0;
  };
  segmentos.forEach((segmento, indice) => {
    const pieza = piezaDeLote(indice, segmento.text);
    if (
      actual.length &&
      (actual.length >= MAX_SEGMENTOS_POR_LOTE || caracteres + pieza.length > MAX_CHARS_POR_LOTE)
    ) cerrar();
    actual.push({ indice, segmento, pieza });
    caracteres += pieza.length + 2;
    const siguiente = segmentos[indice + 1];
    const pausa = siguiente ? Number(siguiente.startTime) - Number(segmento.endTime) : 0;
    const hayMaterial =
      actual.length >= MIN_SEGMENTOS_PARA_CERRAR || caracteres >= MIN_CHARS_PARA_CERRAR;
    const finDeIdea = pausa > 0.6 || /[.!?]\s*$/.test(String(segmento.text || ''));
    if (siguiente && finDeIdea && hayMaterial) cerrar();
  });
  cerrar();
  return lotes;
}

function extraerTraducciones(texto, lote) {
  const esperado = new Set(lote.map(({ indice }) => indice));
  const encontrados = [];
  const re = /\[\[\s*JG_SEG_(\d{6})\s*\]\]/gi;
  let coincidencia;
  while ((coincidencia = re.exec(String(texto || '')))) {
    encontrados.push({ indice: Number(coincidencia[1]), inicio: coincidencia.index, fin: re.lastIndex });
  }
  if (encontrados.length !== esperado.size) return null;
  const salida = new Map();
  encontrados.forEach((item, posicion) => {
    const fin = encontrados[posicion + 1]?.inicio ?? String(texto).length;
    const traduccion = String(texto).slice(item.fin, fin).trim();
    if (esperado.has(item.indice) && traduccion) salida.set(item.indice, traduccion);
  });
  return salida.size === esperado.size ? salida : null;
}

/** Cuánto texto volvió frente al original (1 = lo mismo). */
function proporcionDelLote(lote, traducciones) {
  let original = 0;
  let traducido = 0;
  for (const { indice, segmento } of lote) {
    original += String(segmento.text || '').length;
    traducido += String(traducciones.get(indice) || '').length;
  }
  return original ? traducido / original : 1;
}

async function mapaConLimite(items, limite, tarea) {
  const salida = new Array(items.length);
  let siguiente = 0;
  const trabajador = async () => {
    while (siguiente < items.length) {
      const indice = siguiente++;
      salida[indice] = await tarea(items[indice], indice);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limite, items.length) }, trabajador));
  return salida;
}

export class TranslationService {
  /**
   * `intervaloMinMs`: pausa mínima entre DOS llamadas cualesquiera de este
   * servicio (Mistral gratis ≈ 1 petición/s para toda la app). Antes solo se
   * espaciaban los lotes; las mitades de un lote partido salían seguidas y
   * provocaban 429 (medido en producción el 2026-09-26).
   */
  constructor({ traducirTexto, intervaloMinMs = 0, ahora = () => Date.now(), esperar = (ms) => new Promise((r) => setTimeout(r, ms)) }) {
    if (typeof traducirTexto !== 'function') throw new Error('Falta el servicio de traducción.');
    this.traducirTexto = traducirTexto;
    this.intervaloMinMs = intervaloMinMs;
    this.ahora = ahora;
    this.esperar = esperar;
    this.proximoTurno = 0;
  }

  /** Toda llamada pasa por aquí: respeta el ritmo mínimo entre peticiones. */
  async #llamar(texto, opciones) {
    if (this.intervaloMinMs > 0) {
      const ahora = this.ahora();
      const turno = Math.max(ahora, this.proximoTurno);
      this.proximoTurno = turno + this.intervaloMinMs;
      if (turno > ahora) await this.esperar(turno - ahora);
      if (opciones?.signal?.aborted) throw new DOMException('Cancelado', 'AbortError');
    }
    return this.traducirTexto(texto, opciones);
  }

  /** Pide un lote: `{ traducciones, proporcion }`, o `null` si los marcadores volvieron rotos. */
  async #pedirConProporcion(lote, opciones) {
    const respuesta = await this.#llamar(lote.map(({ pieza }) => pieza).join('\n\n'), opciones);
    const traducciones = extraerTraducciones(textoDeIA(respuesta), lote);
    return traducciones ? { traducciones, proporcion: proporcionDelLote(lote, traducciones) } : null;
  }

  /**
   * Pide un lote y lo acepta solo si volvió completo. Devuelve el mapa o null.
   * Zona gris (0,6–0,85): se repite una vez; dos respuestas igual de compactas
   * son español compacto, no un segmento perdido (ver MIN_PROPORCION_TRADUCCION).
   */
  async pedirLote(lote, opciones) {
    const primero = await this.#pedirConProporcion(lote, opciones);
    if (!primero || primero.proporcion < MIN_PROPORCION_POSIBLE) return null;
    if (primero.proporcion >= MIN_PROPORCION_TRADUCCION || lote.length <= 2) return primero.traducciones;
    const segundo = await this.#pedirConProporcion(lote, opciones);
    if (segundo && segundo.proporcion >= MIN_PROPORCION_TRADUCCION) return segundo.traducciones;
    if (segundo && segundo.proporcion >= MIN_PROPORCION_POSIBLE
      && Math.abs(segundo.proporcion - primero.proporcion) <= TOLERANCIA_REPETICION) {
      return (segundo.proporcion > primero.proporcion ? segundo : primero).traducciones;
    }
    return null;
  }

  /**
   * Traduce índices consecutivos. Nunca lanza por un fallo del texto: devuelve
   * índice → traducción, o `null` si ese segmento no se pudo traducir. Si el lote
   * vuelve roto se parte en dos mitades, cada una con su contexto; frase por frase
   * y sin contexto se perdía el sentido («trunks» → «troncos», auditoría H11).
   */
  async traducirLote(indices, segmentos, { origen = 'en', tituloVideo = '', signal = null, profundidad = 0 } = {}) {
    if (signal?.aborted) throw new DOMException('Cancelado', 'AbortError');
    const primero = indices[0];
    const ultimo = indices[indices.length - 1];
    const contexto = {
      anterior: segmentos.slice(Math.max(0, primero - 2), primero).map((s) => s.text).join(' '),
      siguiente: segmentos.slice(ultimo + 1, ultimo + 2).map((s) => s.text).join(' '),
    };
    const lote = indices.map((indice) => ({ indice, segmento: segmentos[indice], pieza: piezaDeLote(indice, segmentos[indice].text) }));
    const opciones = { origen, tituloVideo, contexto, signal };
    let mapa = null;
    try {
      mapa = await this.pedirLote(lote, opciones);
    } catch (error) {
      if (signal?.aborted || error?.name === 'AbortError' || esLimiteDeUso(error)) throw error;
      // Red o servidor: el motor espera un poco y repite ESTE lote entero.
      if (!esFalloDeContenido(error)) throw error;
    }
    if (mapa) return mapa;
    if (indices.length > 1 && profundidad < 3) {
      const mitad = Math.ceil(indices.length / 2);
      const izquierda = await this.traducirLote(indices.slice(0, mitad), segmentos, { origen, tituloVideo, signal, profundidad: profundidad + 1 });
      const derecha = await this.traducirLote(indices.slice(mitad), segmentos, { origen, tituloVideo, signal, profundidad: profundidad + 1 });
      return new Map([...izquierda, ...derecha]);
    }
    if (indices.length === 1) {
      // Último intento, sin marcadores: a veces el modelo los pierde en una sola frase.
      try {
        const respuesta = await this.#llamar(segmentos[primero].text, opciones);
        const texto = sinMarcadores(textoDeIA(respuesta) ?? '');
        if (texto) return new Map([[primero, texto]]);
      } catch (error) {
        if (signal?.aborted || error?.name === 'AbortError' || esLimiteDeUso(error)) throw error;
        if (!esFalloDeContenido(error)) throw error;
      }
    }
    return new Map(indices.map((indice) => [indice, null]));
  }

  /** Todo el video, lote a lote, reaprovechando lo ya traducido (`ya`). */
  async traducirTodo(segmentos, { origen = 'en', tituloVideo = '', signal = null, ya = new Map(), onProgress = () => {} } = {}) {
    const resultado = new Map(ya);
    const lotes = crearLotes(segmentos)
      .map((lote) => lote.map(({ indice }) => indice).filter((indice) => !resultado.has(indice)))
      .filter((indices) => indices.length);
    let hechos = 0;
    onProgress(hechos, lotes.length);
    for (const indices of lotes) {
      const mapa = await this.#loteConReintentos(indices, segmentos, { origen, tituloVideo, signal });
      for (const [indice, texto] of mapa) resultado.set(indice, texto);
      hechos += 1;
      onProgress(hechos, lotes.length);
    }
    return resultado;
  }

  /** Un lote del texto completo: ante red, servidor o límite de uso, espera y repite (no se rinde a la primera). */
  async #loteConReintentos(indices, segmentos, opciones, { intentos = 4, esperaMs = 3000 } = {}) {
    for (let intento = 1; ; intento += 1) {
      try {
        return await this.traducirLote(indices, segmentos, opciones);
      } catch (error) {
        if (opciones.signal?.aborted || error?.name === 'AbortError') throw error;
        if (intento >= intentos) return new Map(indices.map((indice) => [indice, null]));
        const pausa = esLimiteDeUso(error) ? esperaMs * 5 : esperaMs * intento;
        await new Promise((resolver) => setTimeout(resolver, pausa));
      }
    }
  }

}
