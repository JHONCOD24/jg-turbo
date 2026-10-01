/**
 * Transcribir un audio largo por partes con /api/transcribe (Whisper de Groq, gratis).
 *
 * Lo comparten X (audio HLS) y los videos del equipo (audio sacado con Mediabunny):
 * quien llama sabe FABRICAR cada parte; aquí vive lo común. Reglas medidas:
 *  - la 1.ª parte va sola y fija el idioma de las demás (Whisper podría cambiarlo
 *    parte a parte);
 *  - si el video ya está en español, se para tras la 1.ª parte (no se gasta cuota);
 *  - 2 partes en vuelo (Groq gratis: 20 peticiones/min);
 *  - ante «Límite de uso» se espera 20 s y 40 s y luego se explica el motivo real.
 * Cada parte viaja con ≤ 3,2 MB: Vercel rechaza cuerpos de ~4,5 MB y corta a los 60 s.
 */
import { ErrorYoutube } from './transcriptionService.js';
import { codigoCorto } from './idiomaOrigen.js';

export const BYTES_MAX_PARTE = 3.2 * 1024 * 1024;
export const PARTES_EN_PARALELO = 2;
const ESPERA_PARTE_MS = 90000;           // subir ~3 MB + Whisper sobre 6 min de audio
const RE_LIMITE = /l[ií]mite de uso|rate limit|429/i;

export const cancelado = () => new DOMException('Cancelado', 'AbortError');
export const esperarMs = (ms, signal) => new Promise((resolver, rechazar) => {
  const t = setTimeout(resolver, ms);
  signal?.addEventListener('abort', () => { clearTimeout(t); rechazar(cancelado()); }, { once: true });
});

/** Corre `trabajo` sobre cada elemento con a lo sumo `limite` a la vez; el primer fallo detiene el resto. */
export async function enParalelo(elementos, limite, trabajo) {
  let siguiente = 0;
  let fallo = null;
  const trabajadores = Array.from({ length: Math.min(limite, elementos.length) }, async () => {
    while (!fallo && siguiente < elementos.length) {
      const i = siguiente;
      siguiente += 1;
      try { await trabajo(elementos[i], i); } catch (error) { fallo = fallo || error; }
    }
  });
  await Promise.all(trabajadores);
  if (fallo) throw fallo;
}

/** Sube UNA parte y devuelve { segmentos, idioma } con tiempos locales a la parte. */
export async function subirParte(fetchApi, audio, nombre, {
  idioma = 'auto', apiKey = '', context = '', signal = null,
  esperar = esperarMs, esperasLimiteMs = [20000, 40000], codigoError = 'transcripcion',
} = {}) {
  const formulario = new FormData();
  formulario.append('file', audio, nombre);
  formulario.append('language', idioma);
  formulario.append('fast', 'false');   // verbose_json: Whisper entrega start/end por frase
  if (apiKey) formulario.append('api_key', apiKey);
  if (context) formulario.append('context', String(context).slice(0, 4000));
  for (let intento = 0; ; intento += 1) {
    if (signal?.aborted) throw cancelado();
    const respuesta = await fetchApi('/transcribe', { method: 'POST', body: formulario, signal }, ESPERA_PARTE_MS);
    const datos = await respuesta.json().catch(() => ({}));
    if (signal?.aborted) throw cancelado();
    if (respuesta.ok) {
      return { segmentos: Array.isArray(datos.segments) ? datos.segments : [], idioma: datos.language || '' };
    }
    const detalle = typeof datos?.detail === 'string' ? datos.detail : '';
    if ((respuesta.status === 429 || RE_LIMITE.test(detalle)) && intento < esperasLimiteMs.length) {
      await esperar(esperasLimiteMs[intento], signal);
      continue;
    }
    throw new ErrorYoutube(detalle || `No se pudo transcribir el audio del video (HTTP ${respuesta.status}).`, codigoError, datos);
  }
}

/**
 * `fabricarParte(k)` → { audio: Blob, nombre } (la parte k, lista para subir).
 * `previas`: Map k → segmentos ya transcritos (no se vuelven a pagar).
 * `alTerminarParte(k, segmentos, idioma)`: para guardarlas a medida que llegan.
 * Devuelve { resultados: [segmentos de cada parte], usadas, soloPrimera, idioma, elegido }.
 */
export async function transcribirPorPartes({
  total, fabricarParte, fetchApi, idiomaOrigen = 'auto', apiKey = '', context = '', signal = null,
  onProgress = () => {}, esperar = esperarMs, esperasLimiteMs = [20000, 40000], codigoError = 'transcripcion',
  previas = new Map(), idiomaPrevio = '', alTerminarParte = () => {}, enParaleloMax = PARTES_EN_PARALELO,
}) {
  const elegido = idiomaOrigen && idiomaOrigen !== 'auto' ? codigoCorto(idiomaOrigen) : '';
  let idioma = elegido || codigoCorto(idiomaPrevio);
  const resultados = new Array(total);
  let hechas = 0;
  const contar = () => onProgress(`Transcribiendo el audio: ${hechas} de ${total} ${total === 1 ? 'parte' : 'partes'}…`, hechas / total);
  const transcribir = async (k) => {
    if (previas.has(k)) {
      resultados[k] = previas.get(k);
    } else {
      if (signal?.aborted) throw cancelado();
      const { audio, nombre } = await fabricarParte(k);
      if (signal?.aborted) throw cancelado();
      const r = await subirParte(fetchApi, audio, nombre, {
        idioma: idioma || 'auto', apiKey, context, signal, esperar, esperasLimiteMs, codigoError,
      });
      resultados[k] = r.segmentos;
      if (!idioma) idioma = codigoCorto(r.idioma);
      await alTerminarParte(k, r.segmentos, idioma || codigoCorto(r.idioma));
    }
    hechas += 1;
    contar();
  };
  contar();
  await transcribir(0);   // sola: fija el idioma para las demás
  const soloPrimera = !elegido && idioma === 'es';   // ya está en español: no se gasta cuota en el resto
  if (!soloPrimera && total > 1) {
    await enParalelo(Array.from({ length: total - 1 }, (_, i) => i + 1), enParaleloMax, (k) => transcribir(k));
  }
  return { resultados, usadas: soloPrimera ? 1 : total, soloPrimera, idioma, elegido };
}
