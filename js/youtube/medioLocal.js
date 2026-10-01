/**
 * Leer un video del equipo con Mediabunny (js/vendor/mediabunny/, carga diferida):
 * qué trae, y su audio en partes listas para Whisper. El archivo se lee por
 * rangos (`BlobSource`): un video de 1 GB no se carga entero en memoria.
 *
 * WebCodecs (lo que decodifica el audio) solo existe en contexto seguro: https o
 * localhost. En http://otro-host todo sale «no se puede decodificar» (medido).
 */
import { cargarMedios, asegurarMp3, RUTA_MEDIOS } from './medios.js';
import { ErrorYoutube } from './transcriptionService.js';
import { BYTES_MAX_PARTE } from './transcripcionPartes.js';
import { elegirModoExtraccion } from './archivoLocal.js';

const BYTES_TOPE_SUBIDA = 4.2 * 1024 * 1024;   // Vercel rechaza ~4,5 MB por petición

/**
 * Abre el archivo y describe lo que trae. Devuelve un objeto con `input` vivo:
 * quien llama debe soltarlo con `cerrar()` al terminar.
 */
export async function abrirArchivoLocal(archivo, { rutaMedios = RUTA_MEDIOS } = {}) {
  const mb = await cargarMedios(rutaMedios);
  const input = new mb.Input({ source: new mb.BlobSource(archivo), formats: mb.ALL_FORMATS });
  const cerrar = () => { try { input.dispose?.(); } catch (_) { /* ya cerrado */ } };
  try {
    let formato = '';
    try { formato = (await input.getFormat()).name; } catch (_) {
      throw new ErrorYoutube('No reconocemos este formato de video. Prueba con un MP4, MOV, MKV o WebM.', 'archivo_formato');
    }
    const duracionS = Number(await input.computeDuration()) || 0;
    const pista = await input.getPrimaryAudioTrack();
    if (!pista) throw new ErrorYoutube('Este video no tiene sonido: no hay nada que doblar.', 'archivo_sin_audio');
    const decodifica = await pista.canDecode().catch(() => false);
    let bitrate = 0;
    if (!decodifica) {
      // Solo hace falta para copiar: 0,2 s en 60 min de MP4 (medido).
      try { bitrate = Math.round((await pista.computePacketStats()).averageBitrate) || 0; } catch (_) { bitrate = 0; }
    }
    const video = await input.getPrimaryVideoTrack();
    const audio = { codec: pista.codec || '', decodifica, bitrate, canales: pista.numberOfChannels, hz: pista.sampleRate };
    return {
      mb, rutaMedios, input, pista, formato, duracionS, cerrar,
      audio,
      video: video ? { codec: video.codec || '', ancho: video.displayWidth, alto: video.displayHeight } : null,
      extraccion: elegirModoExtraccion(audio),
    };
  } catch (error) {
    cerrar();
    throw error;
  }
}

async function opcionesDeSalida(mb, extraccion, rutaMedios) {
  if (extraccion.modo === 'mp3') {
    await asegurarMp3(mb, rutaMedios);
    return {
      format: new mb.Mp3OutputFormat(), ext: 'mp3', tipo: 'audio/mpeg',
      audio: { codec: 'mp3', numberOfChannels: 1, sampleRate: 16000, bitrate: 32000 },
    };
  }
  if (extraccion.contenedor === 'webm') return { format: new mb.WebMOutputFormat(), ext: 'webm', tipo: 'audio/webm', audio: {} };
  return { format: new mb.Mp4OutputFormat({ fastStart: 'in-memory' }), ext: 'm4a', tipo: 'audio/mp4', audio: {} };
}

/** La parte `trozo` ({ inicioS, finS }) del audio, como Blob listo para /api/transcribe. */
export async function fabricarParteLocal(abierto, trozo, k) {
  const { mb, input, pista, extraccion, rutaMedios = RUTA_MEDIOS } = abierto;
  const salida = await opcionesDeSalida(mb, extraccion, rutaMedios);
  const output = new mb.Output({ format: salida.format, target: new mb.BufferTarget() });
  const conversion = await mb.Conversion.init({
    input,
    output,
    video: { discard: true },
    // Con varias pistas de audio (MKV con doblajes) solo viaja la principal.
    audio: (t) => (t.id === pista.id ? salida.audio : { discard: true }),
    trim: { start: trozo.inicioS, end: trozo.finS },
  });
  if (!conversion.isValid) {
    throw new ErrorYoutube('Este navegador no pudo preparar el audio de este video. Prueba en Chrome de computador.', 'archivo_audio');
  }
  await conversion.execute();
  const bytes = output.target.buffer?.byteLength || 0;
  if (bytes > BYTES_TOPE_SUBIDA) {
    throw new ErrorYoutube('Una parte del audio salió más pesada de lo que acepta el servidor. Conviértelo a MP4 (AAC) e inténtalo otra vez.', 'archivo_parte_grande');
  }
  if (bytes > BYTES_MAX_PARTE) console.warn('[jg-archivo] parte por encima de 3,2 MB:', bytes);
  return { audio: new Blob([output.target.buffer], { type: salida.tipo }), nombre: `equipo_parte_${k + 1}.${salida.ext}` };
}

/**
 * Miniatura para la biblioteca: un cuadro del 10 % del video (máx. 30 s), en un
 * <video> aparte para no mover el del reproductor. JPEG de ≤ 320 px (~7 KB medido).
 * Si el navegador no puede, devuelve '' (la tarjeta muestra la inicial).
 */
export function capturarPortada(url, { anchoMax = 320, esperaMs = 8000 } = {}) {
  return new Promise((resolver) => {
    const video = document.createElement('video');
    video.muted = true;
    video.playsInline = true;
    video.preload = 'auto';
    let listo = false;
    const terminar = (valor) => {
      if (listo) return;
      listo = true;
      clearTimeout(tope);
      video.removeAttribute('src');
      video.load();
      resolver(valor);
    };
    const tope = setTimeout(() => terminar(''), esperaMs);
    video.addEventListener('error', () => terminar(''), { once: true });
    video.addEventListener('loadedmetadata', () => {
      const d = Number(video.duration) || 0;
      video.currentTime = Math.min(30, Math.max(0, d * 0.1));
    }, { once: true });
    video.addEventListener('seeked', () => {
      try {
        const escala = Math.min(1, anchoMax / (video.videoWidth || anchoMax));
        const lienzo = document.createElement('canvas');
        lienzo.width = Math.max(1, Math.round((video.videoWidth || anchoMax) * escala));
        lienzo.height = Math.max(1, Math.round((video.videoHeight || anchoMax * 0.5625) * escala));
        lienzo.getContext('2d').drawImage(video, 0, 0, lienzo.width, lienzo.height);
        terminar(lienzo.toDataURL('image/jpeg', 0.7));
      } catch (_) {
        terminar('');
      }
    }, { once: true });
    video.src = url;
  });
}
