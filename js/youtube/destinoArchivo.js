/**
 * Adónde va un archivo generado. Regla medida: `showSaveFilePicker` exige el
 * gesto de la persona (activación transitoria de ~5 s en Chrome). Por eso
 * `crearDestino` se llama PRIMERO en el clic de «Descargar», antes de pedir
 * voces o leer el video; si se llama después, el navegador lo rechaza.
 *
 * Cancelar el selector de archivos no es un error: `crearDestino` devuelve null.
 */
import { elegirDestino } from './descargaDestino.js';

const TIPOS = {
  'video/mp4': { description: 'Video MP4', accept: { 'video/mp4': ['.mp4'] } },
  'audio/mpeg': { description: 'Audio MP3', accept: { 'audio/mpeg': ['.mp3'] } },
};

export class ErrorDestino extends Error {
  constructor(mensaje, codigo, limite = 0) {
    super(mensaje);
    this.name = 'ErrorDestino';
    this.codigo = codigo;   // 'grande'
    this.limite = limite;
  }
}

function guardarBlob(blob, nombre) {
  const url = URL.createObjectURL(blob);
  const enlace = document.createElement('a');
  enlace.href = url;
  enlace.download = nombre;
  enlace.style.display = 'none';
  document.body.appendChild(enlace);
  enlace.click();
  enlace.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

export async function crearDestino({ nombre, tipoMime, bytesEstimados = 0, esMovil = false }) {
  const puede = typeof globalThis.showSaveFilePicker === 'function';
  const eleccion = elegirDestino({ puedeGuardarEnDisco: puede, esMovil, bytesEstimados });
  if (eleccion.tipo === 'grande') {
    throw new ErrorDestino('Este archivo es demasiado grande para armarlo en este equipo.', 'grande', eleccion.limite);
  }
  if (eleccion.tipo === 'disco') {
    let manejador;
    try {
      manejador = await globalThis.showSaveFilePicker({ suggestedName: nombre, types: [TIPOS[tipoMime]].filter(Boolean) });
    } catch (error) {
      if (error?.name === 'AbortError') return null;   // la persona cerró el selector
      throw error;
    }
    const escritura = await manejador.createWritable();
    return {
      tipo: 'disco',
      crearTarget: (mb) => new mb.StreamTarget(escritura, { chunked: true }),
      terminar: async () => {},   // Mediabunny cierra el archivo al finalizar
      recibirFlujo: (flujo, { signal } = {}) => flujo.pipeTo(escritura, { signal }),
      cancelar: () => escritura.abort?.().catch(() => {}),
    };
  }
  // En memoria el archivo sale con un clic automático MINUTOS después del toque
  // de la persona: Safari (iPhone) puede no guardarlo sin un gesto reciente.
  // `guardarOtraVez` lo vuelve a entregar desde un botón (con gesto nuevo).
  let listo = null;
  const entregar = (blob) => { listo = blob; guardarBlob(blob, nombre); };
  return {
    tipo: 'memoria',
    crearTarget: (mb) => new mb.BufferTarget(),
    terminar: async (output) => entregar(new Blob([output.target.buffer], { type: tipoMime })),
    recibirFlujo: async (flujo) => entregar(await new Response(flujo).blob()),
    guardarOtraVez: () => { if (listo) guardarBlob(listo, nombre); return Boolean(listo); },
    cancelar: () => { listo = null; },
  };
}
