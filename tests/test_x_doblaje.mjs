/* Doblaje de videos de X · funciones puras y servicio con dobles, sin red.
 * Ejecutar: node tests/test_x_doblaje.mjs
 * Cada tarea del PLAN_X_DOBLAJE_IMPLEMENTACION_LLM.md añade su sección antes del
 * bloque «Resumen». Cuenta las comprobaciones: si bajan, algo se cortó.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const modulo = (nombre) => import(pathToFileURL(path.join(raiz, 'js/youtube', nombre)).href);
const fixture = (nombre) => fs.readFileSync(path.join(raiz, 'tests/fixtures/x', nombre), 'utf8');

let ok = 0;
let fallos = 0;
function comprobar(condicion, mensaje) {
  if (condicion) { ok += 1; console.log(`OK: ${mensaje}`); }
  else { fallos += 1; console.error(`FALLO: ${mensaje}`); }
}

// ── T4: reconocer el enlace ─────────────────────────────────────────────
const fv = await modulo('fuenteVideo.js');
{
  for (const caso of JSON.parse(fixture('enlaces.json'))) {
    const post = fv.extraerPostX(caso.url);
    const esperado = caso.id ? `${caso.id}#${caso.indice}` : 'nada';
    comprobar((post ? `${post.id}#${post.indice}` : 'nada') === esperado, `extraerPostX(${caso.url || 'vacío'}) → ${esperado}`);
  }
  const yt = fv.detectarFuente('https://www.youtube.com/watch?v=dNWkwrqAkcM');
  comprobar(yt?.plataforma === 'youtube' && yt.clave === 'dNWkwrqAkcM', 'YouTube conserva su clave de caché sin prefijo');
  const x = fv.detectarFuente('https://x.com/BrooklynNets/status/1349794411333394432');
  comprobar(x?.plataforma === 'x' && x.clave === 'x:1349794411333394432', 'X usa la clave x:<id>');
  comprobar(fv.detectarFuente('https://x.com/a/status/2023659473466687994/video/2')?.clave === 'x:2023659473466687994:1', 'el 2.º video de un post tiene su propia clave');
  comprobar(fv.detectarFuente('https://example.com/nada') === null, 'otro sitio → null');
}

// ── T5: audio HLS en partes ─────────────────────────────────────────────
const ax = await modulo('audioX.js');
{
  const pista = ax.elegirPistaAudio(fixture('hls_maestra_1349774757969989634.m3u8'));
  comprobar(pista?.kbps === 64000 && pista.uri.includes('/mp4a/64000/'), 'la maestra real ofrece audio de 64 kbps y se elige');
  comprobar(ax.elegirPistaAudio('#EXTM3U\n#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="audio-32000",URI="/a/mp4a/32000/x.m3u8"')?.kbps === 32000, 'sin 64 kbps, se usa 32 kbps');
  comprobar(ax.elegirPistaAudio('#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1\n/v.m3u8') === null, 'sin pistas de audio → null');

  const lista = ax.leerListaAudio(fixture('hls_audio64k_1349774757969989634.m3u8'));
  comprobar(lista.init.endsWith('.mp4'), 'la lista real trae el inicial EXT-X-MAP');
  comprobar(lista.segmentos.length === 109, 'la lista real trae 109 trozos');
  comprobar(Math.abs(lista.duracionS - 324.49) < 0.05, 'la suma de EXTINF da la duración del video (324,49 s)');
  comprobar(lista.segmentos.every((s, i) => i === 0 || s.inicioS > lista.segmentos[i - 1].inicioS), 'los inicios crecen');

  comprobar(ax.urlTwimg('/amplify_video/1/aud/x.m4s') === 'https://video.twimg.com/amplify_video/1/aud/x.m4s', 'una ruta relativa va a video.twimg.com');
  let rechazo = false;
  try { ax.urlTwimg('https://evil.example/x.m4s'); } catch { rechazo = true; }
  comprobar(rechazo, 'una URL de otro dominio se rechaza');

  comprobar(ax.duracionMaximaTrozo(64000) === 360, '64 kbps: partes de 360 s (≈ 2,9 MB)');
  comprobar(ax.duracionMaximaTrozo(128000) === 209, '128 kbps: partes de 209 s para no pasar 3,2 MB');

  // Un video de 5 min cabe en una sola parte
  const unica = ax.planearTrozos(lista.segmentos, { maxS: 360 });
  comprobar(unica.length === 1 && unica[0].desde === 0 && unica[0].hasta === 109 && unica[0].limiteS === 0, '5 min → una sola parte');

  // Un video sintético de 60 min en trozos de 3 s
  const largo = Array.from({ length: 1200 }, (_, i) => ({ uri: `/s${i}.m4s`, inicioS: i * 3, duracionS: 3 }));
  const partes = ax.planearTrozos(largo, { maxS: 360 });
  comprobar(partes.length >= 10 && partes.length <= 12, `60 min → ${partes.length} partes (10 a 12)`);
  comprobar(partes.every((p) => (p.hasta - p.desde) * 3 <= 360), 'ninguna parte pasa de 360 s');
  comprobar(partes.every((p) => ((p.hasta - p.desde) * 3 * 64000) / 8 <= ax.BYTES_MAX_TROZO), 'ninguna parte pasa de 3,2 MB a 64 kbps');
  comprobar(partes.at(-1).hasta === 1200, 'la última parte llega al final');
  comprobar(partes.slice(1).every((p, k) => partes[k].hasta - p.desde === ax.SOLAPE_SEGMENTOS), 'cada parte se solapa 4 trozos con la anterior');
  comprobar(partes.slice(1).every((p, k) => p.limiteS === largo[p.desde + 2].inicioS && p.limiteS > partes[k].limiteS), 'la frontera cae en la mitad del solape');

  // Unir: una frase oída en las dos partes aparece una sola vez
  const trozos = [{ desde: 0, hasta: 124, inicioS: 0, limiteS: 0 }, { desde: 120, hasta: 200, inicioS: 360, limiteS: 366 }];
  const unidos = ax.unirTranscripciones(trozos, [
    [{ start: 0, end: 4, text: 'Hola.' }, { start: 363, end: 369, text: 'Cruza la frontera.' }, { start: 369.5, end: 371, text: 'Fin de la parte uno.' }],
    [{ start: 2, end: 9, text: 'la frontera.' }, { start: 9.2, end: 12, text: 'Sigue la parte dos.' }, { start: 12.5, end: 14, text: 'Y termina.' }],
  ]);
  comprobar(unidos.map((s) => s.text).join(' | ') === 'Hola. | Cruza la frontera. | Sigue la parte dos. | Y termina.',
    `sin duplicados ni pérdidas en la frontera (${unidos.map((s) => s.text).join(' | ')})`);
  comprobar(unidos[2].startTime === 369.2, 'los tiempos de la parte dos se desplazan 360 s');
  comprobar(unidos.every((s, i) => i === 0 || s.startTime >= unidos[i - 1].startTime), 'el resultado queda en orden');

  // La respuesta real de /api/transcribe (60 s) conserva sus 18 frases en una parte que empieza en 0
  const real = JSON.parse(fixture('transcribe_prod_audio64k_60s_1349774757969989634.json'));
  const soloUna = ax.unirTranscripciones([{ desde: 0, hasta: 20, inicioS: 0, limiteS: 0 }], [real.segments]);
  comprobar(soloUna.length === 18 && soloUna[0].text.startsWith('On the move'), 'la transcripción real de producción entra entera');

  const mp4s = [
    { url: 'a', bitrate: 288000, ancho: 480, alto: 270 },
    { url: 'b', bitrate: 832000, ancho: 640, alto: 360 },
    { url: 'c', bitrate: 2176000, ancho: 1280, alto: 720 },
    { url: 'd', bitrate: 10368000, ancho: 1920, alto: 1080 },
  ];
  comprobar(ax.elegirMp4(mp4s).url === 'c', 'normal: la mejor hasta 720p');
  comprobar(ax.elegirMp4(mp4s, { ahorroDatos: true }).url === 'b', 'ahorro de datos: hasta 360p');
  comprobar(ax.elegirMp4([{ url: 'v', bitrate: 950000, ancho: 720, alto: 1280 }]).url === 'v', 'un video vertical 720×1280 cuenta como 720p');
  comprobar(ax.elegirMp4([]) === null, 'sin variantes → null');
}

// ── T6: servicio de X con dobles (sin red) ──────────────────────────────
const sx = await modulo('servicioX.js');
{
  // fetchTwimg SIEMPRE manda sin Referer (H3)
  const fetchReal = globalThis.fetch;
  let opcionesVistas = null;
  globalThis.fetch = async (_url, opciones) => { opcionesVistas = opciones; return new Response('ok'); };
  await sx.fetchTwimg('https://video.twimg.com/a.m4s');
  globalThis.fetch = fetchReal;
  comprobar(opcionesVistas?.referrerPolicy === 'no-referrer', 'fetchTwimg pide sin Referer (X responde 403 con Referer ajeno)');

  comprobar(sx.tituloX({ autor: 'BrooklynNets', texto: 'WATCH: Sean Marks' }) === '@BrooklynNets · WATCH: Sean Marks', 'título: @autor · texto');
  comprobar(sx.tituloX({ autor: 'a', texto: '' }) === 'Video de @a', 'título sin texto');

  /** Un video sintético: N trozos de 3 s, audio de 64 kbps (24 000 bytes por trozo). */
  function escenario({ trozos = 250, idiomas = [], respuestas = [] } = {}) {
    const maestra = '#EXTM3U\n#EXT-X-MEDIA:NAME="Audio",TYPE=AUDIO,GROUP-ID="audio-64000",URI="/v/pl/mp4a/64000/a.m3u8"\n';
    const lista = ['#EXTM3U', '#EXT-X-MAP:URI="/v/aud/init.mp4"',
      ...Array.from({ length: trozos }, (_, i) => `#EXTINF:3.000,\n/v/aud/${i}.m4s`), '#EXT-X-ENDLIST'].join('\n');
    const registro = { twimg: [], subidas: [] };
    const pedirTwimg = async (url, { signal } = {}) => {
      if (signal?.aborted) throw new DOMException('Cancelado', 'AbortError');
      registro.twimg.push(url);
      if (url.endsWith('master.m3u8')) return new Response(maestra);
      if (url.endsWith('a.m3u8')) return new Response(lista);
      return new Response(new Uint8Array(url.endsWith('init.mp4') ? 800 : 24000));
    };
    const fetchApi = async (ruta, opciones = {}) => {
      if (opciones.signal?.aborted) throw new DOMException('Cancelado', 'AbortError');
      if (ruta.startsWith('/x-video')) return Response.json({ id: '1', autor: 'a', texto: 't', duracion_s: trozos * 3, hls: 'https://video.twimg.com/v/pl/master.m3u8', mp4: [] });
      const n = registro.subidas.length;
      const archivo = opciones.body.get('file');
      registro.subidas.push({ bytes: archivo.size, idioma: opciones.body.get('language'), nombre: archivo.name });
      const forzada = respuestas[n];
      if (forzada) return forzada();
      return Response.json({ language: idiomas[n] ?? 'en', segments: [{ start: 10, end: 13, text: `Frase de la parte ${n + 1}.` }] });
    };
    return { registro, fetchApi, pedirTwimg };
  }
  const info = { id: '1', autor: 'a', texto: 't', duracion_s: 750, hls: 'https://video.twimg.com/v/pl/master.m3u8', mp4: [] };

  {
    const { registro, fetchApi, pedirTwimg } = escenario();
    const progreso = [];
    const servicio = new sx.ServicioX({ fetchApi, pedirTwimg, esperar: async () => {} });
    const r = await servicio.obtenerParaDoblaje(info, { onProgress: (m, f) => progreso.push(f) });
    comprobar(registro.subidas.length === 3, `750 s → 3 partes subidas (${registro.subidas.length})`);
    comprobar(registro.subidas.every((s) => s.bytes <= 3.2 * 1024 * 1024), 'ninguna parte pasa de 3,2 MB');
    comprobar(registro.subidas[0].idioma === 'auto' && registro.subidas.slice(1).every((s) => s.idioma === 'en'), 'la 1.ª parte detecta el idioma y las demás lo reciben fijo');
    comprobar(registro.subidas.every((s) => s.nombre.endsWith('.m4a')), 'cada parte viaja como .m4a');
    comprobar(r.segmentos.length === 3 && r.segmentos[1].startTime > 300, 'los tiempos de cada parte se desplazan');
    comprobar(r.idioma === 'en' && r.fuente === 'audio' && r.confianza >= 0.9 && !r.conflicto, 'idioma oído por Whisper = fuente firme');
    comprobar(progreso.at(-1) === 1, 'el progreso termina en 1');
  }
  {
    const { registro, fetchApi, pedirTwimg } = escenario();
    const servicio = new sx.ServicioX({ fetchApi, pedirTwimg, esperar: async () => {} });
    const r = await servicio.obtenerParaDoblaje(info, { idiomaOrigen: 'fr' });
    comprobar(registro.subidas.every((s) => s.idioma === 'fr') && r.fuente === 'usuario', 'si la persona elige el idioma, todas las partes lo usan');
  }
  {
    const { registro, fetchApi, pedirTwimg } = escenario({ idiomas: ['es'] });
    const servicio = new sx.ServicioX({ fetchApi, pedirTwimg, esperar: async () => {} });
    const r = await servicio.obtenerParaDoblaje(info);
    comprobar(r.idioma === 'es' && registro.subidas.length === 1, 'video en español: se detiene tras la 1.ª parte (no gasta cuota)');
  }
  {
    const limite = () => Response.json({ detail: 'Límite de uso de Groq alcanzado. Espera un minuto e inténtalo de nuevo.' }, { status: 500 });
    const { registro, fetchApi, pedirTwimg } = escenario({ trozos: 20, respuestas: [limite] });
    const esperas = [];
    const servicio = new sx.ServicioX({ fetchApi, pedirTwimg, esperar: async (ms) => { esperas.push(ms); } });
    const r = await servicio.obtenerParaDoblaje({ ...info, duracion_s: 60 });
    comprobar(esperas[0] === 20000 && registro.subidas.length === 2 && r.segmentos.length === 1, 'ante «Límite de uso» espera 20 s y reintenta');
  }
  {
    const limite = () => Response.json({ detail: 'Límite de uso de Groq alcanzado.' }, { status: 500 });
    const { fetchApi, pedirTwimg } = escenario({ trozos: 20, respuestas: [limite, limite, limite] });
    const servicio = new sx.ServicioX({ fetchApi, pedirTwimg, esperar: async () => {} });
    let error = null;
    try { await servicio.obtenerParaDoblaje({ ...info, duracion_s: 60 }); } catch (e) { error = e; }
    comprobar(error?.codigo === 'x_transcripcion' && /Límite de uso/.test(error.message), 'tras 2 reintentos, el motivo real llega a la persona');
  }
  {
    const { registro, fetchApi, pedirTwimg } = escenario();
    const control = new AbortController();
    const fetchQueCancela = async (ruta, opciones) => {
      const r = await fetchApi(ruta, opciones);
      if (registro.subidas.length === 1) control.abort();
      return r;
    };
    const servicio = new sx.ServicioX({ fetchApi: fetchQueCancela, pedirTwimg, esperar: async () => {} });
    let error = null;
    try { await servicio.obtenerParaDoblaje(info, { signal: control.signal }); } catch (e) { error = e; }
    comprobar(error?.name === 'AbortError', 'cancelar corta con AbortError');
    comprobar(registro.subidas.length === 1, `tras cancelar no se sube nada más (${registro.subidas.length})`);
  }
  {
    const { registro, fetchApi, pedirTwimg } = escenario();
    const servicio = new sx.ServicioX({ fetchApi, pedirTwimg });
    let error = null;
    try { await servicio.obtenerParaDoblaje({ ...info, duracion_s: 2 * 3600 }); } catch (e) { error = e; }
    comprobar(error?.codigo === 'x_largo' && registro.twimg.length === 0, 'un video de 2 h se rechaza sin descargar nada');
  }
  {
    const servicio = new sx.ServicioX({
      fetchApi: async () => { throw new Error('no debía llamar'); },
      pedirTwimg: async () => new Response('#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1\n/v.m3u8'),
    });
    let error = null;
    try { await servicio.obtenerParaDoblaje(info); } catch (e) { error = e; }
    comprobar(error?.codigo === 'x_sin_audio', 'sin pista de audio → mensaje claro');
  }
  {
    const servicio = new sx.ServicioX({
      fetchApi: async () => Response.json({ detail: 'Ese post de X es un GIF: no tiene sonido que doblar.', code: 'gif' }, { status: 422 }),
    });
    let error = null;
    try { await servicio.info('https://x.com/a/status/123456'); } catch (e) { error = e; }
    comprobar(error?.codigo === 'x_gif' && /GIF/.test(error.message), 'info(): el motivo del servidor llega tal cual');
  }
}

// ── Resumen ─────────────────────────────────────────────────────────────
console.log(`\n${ok} comprobaciones OK · ${fallos} fallos`);
if (fallos) process.exit(1);
