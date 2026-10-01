/**
 * Videos del equipo: del archivo al texto con tiempos, listo para el MISMO doblaje
 * de YouTube y X (traducción, voces, ritmo, subtítulo, caché, biblioteca).
 *
 * El audio se saca en el navegador (medioLocal.js) y viaja por partes a Whisper
 * (transcripcionPartes.js). Lo ya transcrito se puede guardar parte por parte
 * (`alTerminarParte`) y se reutiliza (`previas`): si Groq llega a su límite a
 * mitad de un video de 3 h, la siguiente vez sigue donde iba sin volver a pagar.
 */
import { ErrorYoutube, normalizarSegmentos } from './transcriptionService.js';
import { transcribirPorPartes, esperarMs } from './transcripcionPartes.js';
import { unirTranscripciones } from './audioX.js';
import {
  MAX_DURACION_S, planearTrozosTiempo, tituloDeArchivo, validarArchivo, huellaArchivo,
} from './archivoLocal.js';

const RE_LIMITE = /l[ií]mite de uso|rate limit|429/i;

export class ServicioArchivo {
  /**
   * `abrir(archivo)` y `fabricar(abierto, trozo, k)`: por defecto los de medioLocal.js
   * (Mediabunny, solo navegador); las pruebas pasan dobles.
   */
  constructor({ fetchApi, abrir = null, fabricar = null, huella = huellaArchivo, esperar = esperarMs, esperasLimiteMs = [20000, 40000] }) {
    if (typeof fetchApi !== 'function') throw new Error('Falta el cliente de la API.');
    this.fetchApi = fetchApi;
    this.abrir = abrir;
    this.fabricar = fabricar;
    this.huella = huella;
    this.esperar = esperar;
    this.esperasLimiteMs = esperasLimiteMs;
  }

  async #medios() {
    if (!this.abrir || !this.fabricar) {
      const m = await import('./medioLocal.js');
      this.abrir = this.abrir || m.abrirArchivoLocal;
      this.fabricar = this.fabricar || m.fabricarParteLocal;
    }
  }

  /** Valida, saca la huella y abre el archivo. Devuelve la «ficha» que usa todo lo demás. */
  async inspeccionar(archivo) {
    const valido = validarArchivo(archivo);
    if (!valido.ok) throw new ErrorYoutube(valido.motivo, `archivo_${valido.codigo}`);
    await this.#medios();
    const [clave, abierto] = await Promise.all([this.huella(archivo), this.abrir(archivo)]);
    if (abierto.duracionS > MAX_DURACION_S) {
      abierto.cerrar();
      throw new ErrorYoutube(`Este video dura ${Math.round(abierto.duracionS / 60)} min. Por ahora se doblan videos de hasta ${MAX_DURACION_S / 3600} horas.`, 'archivo_largo');
    }
    if (abierto.extraccion.modo === 'imposible') {
      abierto.cerrar();
      throw new ErrorYoutube(abierto.extraccion.motivo, 'archivo_audio');
    }
    return {
      clave,
      titulo: tituloDeArchivo(archivo.name),
      nombreArchivo: String(archivo.name || ''),
      bytes: Number(archivo.size) || 0,
      duracionS: abierto.duracionS,
      audio: abierto.audio,
      video: abierto.video,
      extraccion: abierto.extraccion,
      // El navegador no decodifica ese audio: el <video> tampoco lo hará sonar (AC-3 en Chrome).
      originalMudo: !abierto.audio.decodifica,
      trozos: planearTrozosTiempo(abierto.duracionS, { maxS: abierto.extraccion.trozoS }),
      abierto,
    };
  }

  /**
   * Misma forma de respuesta que ServicioX.obtenerParaDoblaje.
   * `previas`: Map k → segmentos ya transcritos (de un intento anterior con el mismo plan).
   */
  async obtenerParaDoblaje(ficha, {
    idiomaOrigen = 'auto', apiKey = '', context = '', signal = null, onProgress = () => {},
    previas = new Map(), idiomaPrevio = '', alTerminarParte = () => {},
  } = {}) {
    const { trozos, abierto } = ficha;
    onProgress(ficha.extraccion.modo === 'copia' ? 'Copiando el audio del video…' : 'Sacando el audio del video…', null);
    let resultado;
    try {
      resultado = await transcribirPorPartes({
        total: trozos.length,
        fabricarParte: (k) => this.fabricar(abierto, trozos[k], k),
        fetchApi: this.fetchApi, idiomaOrigen, apiKey, context, signal, onProgress,
        esperar: this.esperar, esperasLimiteMs: this.esperasLimiteMs, codigoError: 'archivo_transcripcion',
        previas, idiomaPrevio, alTerminarParte,
      });
    } catch (error) {
      if (error?.codigo === 'archivo_transcripcion' && RE_LIMITE.test(error.message)) {
        throw new ErrorYoutube(
          'Groq llegó a su límite gratuito (unas 2 horas de audio por hora). Lo ya transcrito quedó guardado: vuelve a pulsar «Doblar al español» en un rato y seguirá donde iba.',
          'archivo_limite',
        );
      }
      throw error;
    }
    const { resultados, usadas, soloPrimera, idioma, elegido } = resultado;
    const segmentos = normalizarSegmentos(unirTranscripciones(trozos.slice(0, usadas), resultados.slice(0, usadas)));
    if (!segmentos.length && !soloPrimera) {
      throw new ErrorYoutube('No se oye voz que se pueda doblar en este video (¿solo música?).', 'sin_segmentos');
    }
    return {
      segmentos,
      idioma,
      solicitado: elegido,
      confianza: elegido ? 1 : 0.95,
      fuente: elegido ? 'usuario' : 'audio',
      conflicto: false,
      disponibles: [],
      titulo: ficha.titulo,
      duracionS: ficha.duracionS,
    };
  }
}
