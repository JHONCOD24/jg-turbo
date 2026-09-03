const MAX_SEGMENTOS_POR_LOTE = 8;
const MAX_CHARS_POR_LOTE = 2800;
const CONCURRENCIA = 2;

/* Cortar el lote en cada pausa suena bien, pero hay videos con un silencio
   entre CADA subtítulo: así el lote acababa teniendo un solo segmento, la IA
   traducía media frase suelta —justo lo que queríamos evitar— y salían tantas
   llamadas como segmentos. Medido: 150 segmentos → 150 lotes. Por eso una pausa
   solo cierra el lote cuando ya hay material suficiente dentro. */
const MIN_SEGMENTOS_PARA_CERRAR = 3;
const MIN_CHARS_PARA_CERRAR = 350;

/* Si la traducción de un lote sale mucho más corta que el original, la IA se
   comió segmentos: pasa cuando reparte el texto entre los marcadores y se queda
   sin sitio antes de llegar al final. Los marcadores siguen estando todos, así
   que contarlos no lo detecta; hay que mirar cuánto texto volvió.

   Umbral medido sobre 6 traducciones del mismo lote (24/08/2026): las tres
   correctas dieron 1,016 · 1,064 · 1,016 y las tres que perdieron segmentos
   dieron 0,769 · 0,804 · 0,785. 0,85 queda en medio, con margen a los dos lados. */
const MIN_PROPORCION_TRADUCCION = 0.85;

function marcador(indice) {
  return `[[JG_SEG_${String(indice).padStart(6, '0')}]]`;
}

function crearLotes(segmentos) {
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
    const pieza = `${marcador(indice)}\n${segmento.text}`;
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

/** ¿Volvió todo el texto del lote, o la IA se dejó segmentos por el camino? */
function conservaElContenido(lote, traducciones) {
  let original = 0;
  let traducido = 0;
  for (const { indice, segmento } of lote) {
    original += String(segmento.text || '').length;
    traducido += String(traducciones.get(indice) || '').length;
  }
  if (!original) return true;
  return traducido / original >= MIN_PROPORCION_TRADUCCION;
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
  constructor({ traducirTexto }) {
    if (typeof traducirTexto !== 'function') throw new Error('Falta el servicio de traducción.');
    this.traducirTexto = traducirTexto;
  }

  /** Pide un lote y lo rechaza si volvió incompleto. Devuelve el mapa o null. */
  async pedirLote(lote) {
    const respuesta = await this.traducirTexto(lote.map(({ pieza }) => pieza).join('\n\n'));
    const traducciones = extraerTraducciones(respuesta?.text ?? respuesta, lote);
    if (!traducciones) return null;
    return conservaElContenido(lote, traducciones) ? traducciones : null;
  }

  /** Traduce sin modificar startTime/endTime; un fallo queda aislado al segmento. */
  async traducirSegmentos(segmentos, { onProgress = () => {} } = {}) {
    const lotes = crearLotes(segmentos);
    const resultados = new Array(segmentos.length);
    let terminados = 0;
    onProgress(0, segmentos.length);

    await mapaConLimite(lotes, CONCURRENCIA, async (lote) => {
      let traducciones = null;
      // Dos intentos: la IA acorta el lote de forma intermitente, así que
      // reintentar arregla la mayoría de los casos sin bajar a traducir suelto.
      for (let intento = 0; intento < 2 && !traducciones; intento += 1) {
        try {
          traducciones = await this.pedirLote(lote);
        } catch {
          traducciones = null;
        }
      }

      for (const { indice, segmento } of lote) {
        let text = traducciones?.get(indice) || '';
        let translationError = '';
        if (!text) {
          try {
            const respuesta = await this.traducirTexto(segmento.text);
            text = String(respuesta?.text ?? respuesta ?? '').trim();
            if (!text) throw new Error('Traducción vacía.');
          } catch (error) {
            text = segmento.text;
            translationError = error?.message || 'No se pudo traducir este segmento.';
          }
        }
        resultados[indice] = {
          ...segmento,
          text,
          originalText: segmento.text,
          ...(translationError ? { translationError } : {}),
        };
        terminados += 1;
        onProgress(terminados, segmentos.length);
      }
    });
    return resultados;
  }
}
