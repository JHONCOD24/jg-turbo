/**
 * Archivos del doblaje, armados en el navegador con Mediabunny:
 *  - `exportarMp3`: la voz en español del video entero, cada frase en su segundo.
 *  - `exportarMp4DobladoX`: el video de X con la voz en español y el audio original bajito.
 *  - `descargarOriginalX`: el MP4 original de X, sin tocarlo.
 *
 * Nada de esto cabe en el servidor (60 s y ~4,5 MB por petición). Medido en
 * Chrome el 2026-09-28: 30 s de un video de X a 360p con la pista mezclada se
 * generan en 1,07 s; 60 s de MP3 se codifican en 0,44 s. Lo lento es pedir la
 * voz de cada frase, no armar el archivo.
 *
 * La mezcla se hace por ventanas de 30 s (`ventanasDeMezcla`): nunca hay más de
 * 30 s de audio sin comprimir en memoria, aunque el video dure una hora.
 */
import { planearPista, ventanasDeMezcla, frasesEnVentana } from './pistaDoblada.js';
import { cargarMedios, asegurarMp3, asegurarAac, RUTA_MEDIOS } from './medios.js';
import { limitesDeBuffer } from './hablaVoz.js';

export const HZ_MP3 = 24000;          // la voz neural llega a 24 kHz: más no suma calidad
export const HZ_MP4 = 48000;
export const VOLUMEN_ORIGINAL = 0.12; // el mismo 12 % con que arranca el doblaje en vivo
export const PARALELO_VOZ = 3;        // medido: 6 frases en 2,9 s con 3 en paralelo

const cancelado = () => new DOMException('Cancelado', 'AbortError');

async function enParalelo(elementos, limite, trabajo, signal) {
  let siguiente = 0;
  let fallo = null;
  const trabajadores = Array.from({ length: Math.min(limite, elementos.length) }, async () => {
    while (!fallo && siguiente < elementos.length) {
      if (signal?.aborted) { fallo = fallo || cancelado(); return; }
      const i = siguiente;
      siguiente += 1;
      try { await trabajo(elementos[i], i); } catch (error) { fallo = fallo || error; }
    }
  });
  await Promise.all(trabajadores);
  if (fallo) throw fallo;
}

/** Decodifica un audio (MP3 de la voz) sin abrir un AudioContext de reproducción. */
export async function decodificarAudio(blob) {
  const ctx = new OfflineAudioContext(1, 1, 44100);
  return ctx.decodeAudioData(await blob.arrayBuffer());
}

/**
 * Pide la voz de cada frase, la mide y la vuelve a pedir más rápida donde no cabe.
 * `frases`: [{ indice, startTime, texto, hablante }] (texto '' = sin voz, suena el original).
 * `sintetizar(texto, { tasa, signal, frase })` → Blob MP3 (la caché de voces va por
 * fuera; `frase.hablante` elige la 2.ª voz en los diálogos, como en vivo).
 */
export async function prepararVoces(frases, {
  sintetizar, decodificar = decodificarAudio, duracionVideoS = Infinity, signal = null, onProgreso = () => {},
}) {
  const conTexto = (frases || []).filter((f) => String(f.texto || '').trim());
  const audios = new Map();
  // Cada voz se guarda con su tramo hablado: el silencio que trae delante y
  // detrás (~1 s por frase, hablaVoz.js) no cuenta para el espacio ni suena.
  const pedir = async (frase, tasa) => {
    const buffer = await decodificar(await sintetizar(frase.texto, { tasa, signal, frase }));
    const { desdeS, hastaS } = limitesDeBuffer(buffer);
    return { buffer, tasa, desdeS, hastaS };
  };
  let hechas = 0;
  await enParalelo(conTexto, PARALELO_VOZ, async (frase) => {
    audios.set(frase.indice, await pedir(frase, 1));
    hechas += 1;
    onProgreso({ fase: 'voz', hechas, total: conTexto.length });
  }, signal);

  const medir = (acelerar) => planearPista(conTexto.map((f) => ({
    indice: f.indice, startTime: f.startTime,
    duracionVoz: audios.get(f.indice).hastaS - audios.get(f.indice).desdeS, tasa: audios.get(f.indice).tasa,
  })), { duracionVideoS, acelerar });

  const aAcelerar = medir(true).plan.filter((p) => p.tasa > 1);
  let ajustadas = 0;
  await enParalelo(aAcelerar, PARALELO_VOZ, async (p) => {
    const frase = conTexto.find((f) => f.indice === p.indice);
    audios.set(p.indice, await pedir(frase, p.tasa));
    ajustadas += 1;
    onProgreso({ fase: 'ajuste', hechas: ajustadas, total: aAcelerar.length });
  }, signal);

  return { audios, aceleradas: aAcelerar.length, ...medir(false) };
}

/** Una ventana de la pista: voz en su segundo + (opcional) el original bajito. */
export async function mezclarVentana({ desdeS, hastaS }, {
  plan, audios, hz, canales, original = null, volumenOriginal = VOLUMEN_ORIGINAL,
}) {
  const ctx = new OfflineAudioContext(canales, Math.max(1, Math.round((hastaS - desdeS) * hz)), hz);
  // `recorteDesde`/`recorteHasta`: la parte del audio que suena (la voz sin su silencio).
  const colocar = (buffer, instanteS, destino, recorteDesde = 0, recorteHasta = buffer.duration) => {
    const t = instanteS - desdeS;
    const largo = recorteHasta - recorteDesde;
    if (largo <= 0 || t + largo <= 0) return;
    const fuente = ctx.createBufferSource();
    fuente.buffer = buffer;
    fuente.connect(destino);
    if (t >= 0) fuente.start(t, recorteDesde, largo);
    else fuente.start(0, recorteDesde - t, largo + t);
  };
  if (original) {
    const ganancia = ctx.createGain();
    ganancia.gain.value = volumenOriginal;
    ganancia.connect(ctx.destination);
    for await (const { buffer, timestamp } of original.buffers(desdeS, hastaS)) colocar(buffer, timestamp, ganancia);
  }
  for (const frase of frasesEnVentana(plan, desdeS, hastaS)) {
    const voz = audios.get(frase.indice);
    colocar(voz.buffer, frase.inicioS, ctx.destination, voz.desdeS ?? 0, voz.hastaS ?? voz.buffer.duration);
  }
  return ctx.startRendering();
}

/**
 * `destino` (de `crearDestino`): { tipo: 'disco'|'memoria', crearTarget(mb), terminar(output) }.
 * Devuelve el resumen para el aviso final: frases, aceleradas, corridas.
 */
export async function exportarMp3({
  frases, duracionVideoS, sintetizar, destino, signal = null, onProgreso = () => {}, rutaMedios = RUTA_MEDIOS,
}) {
  const mb = await cargarMedios(rutaMedios);
  await asegurarMp3(mb, rutaMedios);
  const voces = await prepararVoces(frases, { sintetizar, duracionVideoS, signal, onProgreso });
  const output = new mb.Output({ format: new mb.Mp3OutputFormat(), target: destino.crearTarget(mb) });
  const fuente = new mb.AudioBufferSource({ codec: 'mp3', bitrate: 64e3 });
  output.addAudioTrack(fuente);
  await output.start();
  try {
    const ventanas = ventanasDeMezcla(voces.duracionS);
    for (let i = 0; i < ventanas.length; i += 1) {
      if (signal?.aborted) throw cancelado();
      await fuente.add(await mezclarVentana(ventanas[i], { plan: voces.plan, audios: voces.audios, hz: HZ_MP3, canales: 1 }));
      onProgreso({ fase: 'archivo', hechas: i + 1, total: ventanas.length });
    }
    fuente.close();
    await output.finalize();
  } catch (error) {
    await output.cancel().catch(() => {});
    throw error;
  }
  await destino.terminar(output);
  return { frases: voces.plan.length, aceleradas: voces.aceleradas, corridas: voces.corridas };
}

/** El video de X con la voz en español. El video se copia tal cual (no se recodifica). */
export async function exportarMp4DobladoX({
  mp4Url, frases, sintetizar, destino, signal = null, onProgreso = () => {},
  volumenOriginal = VOLUMEN_ORIGINAL, rutaMedios = RUTA_MEDIOS,
}) {
  const mb = await cargarMedios(rutaMedios);
  await asegurarAac(mb, rutaMedios);
  // X responde 403 a peticiones con Referer de otro dominio (TRAMPAS.md): Mediabunny pide por rangos con esto.
  const input = new mb.Input({
    source: new mb.UrlSource(mp4Url, { requestInit: { referrerPolicy: 'no-referrer', credentials: 'omit' } }),
    formats: mb.ALL_FORMATS,
  });
  let output = null;
  try {
    const duracionVideoS = await input.computeDuration();
    const voces = await prepararVoces(frases, { sintetizar, duracionVideoS, signal, onProgreso });
    const pistaOriginal = await input.getPrimaryAudioTrack();
    const original = pistaOriginal && await pistaOriginal.canDecode() ? new mb.AudioBufferSink(pistaOriginal) : null;
    const hz = pistaOriginal?.sampleRate || HZ_MP4;
    output = new mb.Output({
      // Al disco, el índice va al final (se escribe por posiciones); en memoria, al principio.
      format: new mb.Mp4OutputFormat({ fastStart: destino.tipo === 'disco' ? false : 'in-memory' }),
      target: destino.crearTarget(mb),
    });
    const conversion = await mb.Conversion.init({ input, output, audio: { discard: true }, composable: true });
    const fuente = new mb.AudioBufferSource({ codec: 'aac', bitrate: 128e3 });
    output.addAudioTrack(fuente);
    await output.start();
    const alimentar = async () => {
      const ventanas = ventanasDeMezcla(Math.max(duracionVideoS, voces.duracionS));
      for (let i = 0; i < ventanas.length; i += 1) {
        if (signal?.aborted) throw cancelado();
        await fuente.add(await mezclarVentana(ventanas[i], {
          plan: voces.plan, audios: voces.audios, hz, canales: 2, original, volumenOriginal,
        }));
        onProgreso({ fase: 'archivo', hechas: i + 1, total: ventanas.length });
      }
      fuente.close();
    };
    await Promise.all([conversion.execute(), alimentar()]);
    await output.finalize();
    await destino.terminar(output);
    return {
      frases: voces.plan.length, aceleradas: voces.aceleradas, corridas: voces.corridas,
      conOriginal: Boolean(original),
    };
  } catch (error) {
    await output?.cancel().catch(() => {});
    throw error;
  } finally {
    input.dispose?.();
  }
}

/** El MP4 original de X, de un tirón: al disco en escritorio, en memoria en el celular. */
export async function descargarOriginalX({ mp4Url, destino, signal = null, onProgreso = () => {} }) {
  const respuesta = await fetch(mp4Url, { referrerPolicy: 'no-referrer', credentials: 'omit', signal });
  if (!respuesta.ok || !respuesta.body) throw new Error(`X no entregó el video (HTTP ${respuesta.status}).`);
  const total = Number(respuesta.headers.get('content-length')) || 0;   // cabecera permitida por CORS
  let recibidos = 0;
  const contador = new TransformStream({
    transform(trozo, control) {
      recibidos += trozo.byteLength;
      onProgreso({ fase: 'descarga', hechas: recibidos, total });
      control.enqueue(trozo);
    },
  });
  const flujo = respuesta.body.pipeThrough(contador);
  await destino.recibirFlujo(flujo, { signal });
  return { bytes: recibidos };
}
