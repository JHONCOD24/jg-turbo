/* Doblaje de videos del equipo · funciones puras y servicio con dobles, sin red.
 * Ejecutar: node tests/test_archivo_doblaje.mjs
 * Cada tarea del PLAN_VIDEO_LOCAL_DOBLAJE_IMPLEMENTACION_LLM.md añade su sección
 * antes del «Resumen». Cuenta las comprobaciones: si bajan, algo se cortó.
 */
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const modulo = (nombre) => import(pathToFileURL(path.join(raiz, 'js/youtube', nombre)).href);

let ok = 0;
let fallos = 0;
function comprobar(condicion, mensaje) {
  if (condicion) { ok += 1; console.log(`OK: ${mensaje}`); }
  else { fallos += 1; console.error(`FALLO: ${mensaje}`); }
}
/** Un «File» de Node: Blob con nombre (File existe en Node 20+). */
const archivo = (bytes, nombre, tipo = 'video/mp4') => new File([bytes], nombre, { type: tipo });
const bytesDe = (n, semilla = 1) => Uint8Array.from({ length: n }, (_, i) => (i * 31 + semilla) % 251);

// ── T1: transcribir por partes (compartido con X) ───────────────────────
const tp = await modulo('transcripcionPartes.js');
{
  function api({ idiomas = [], respuestas = [] } = {}) {
    const subidas = [];
    let enVuelo = 0;
    let maxEnVuelo = 0;
    const fetchApi = async (_ruta, opciones = {}) => {
      if (opciones.signal?.aborted) throw new DOMException('Cancelado', 'AbortError');
      const n = subidas.length;
      subidas.push({ idioma: opciones.body.get('language'), nombre: opciones.body.get('file').name, fast: opciones.body.get('fast') });
      enVuelo += 1; maxEnVuelo = Math.max(maxEnVuelo, enVuelo);
      await new Promise((r) => setTimeout(r, 5));
      enVuelo -= 1;
      const forzada = respuestas[n];
      if (forzada) return forzada();
      return Response.json({ language: idiomas[n] ?? 'en', segments: [{ start: 1, end: 2, text: `Parte ${n + 1}.` }] });
    };
    return { subidas, fetchApi, maxEnVuelo: () => maxEnVuelo };
  }
  const fabricarParte = async (k) => ({ audio: new Blob([new Uint8Array(2000)]), nombre: `p${k + 1}.mp3` });

  {
    const a = api();
    const r = await tp.transcribirPorPartes({ total: 5, fabricarParte, fetchApi: a.fetchApi, esperar: async () => {} });
    comprobar(a.subidas.length === 5 && a.subidas.every((s) => s.fast === 'false'), '5 partes, todas con tiempos (fast=false)');
    comprobar(a.subidas[0].idioma === 'auto' && a.subidas.slice(1).every((s) => s.idioma === 'en'), 'la 1.ª detecta el idioma y las demás lo reciben fijo (el servidor ya entrega «en», medido)');
    comprobar(a.maxEnVuelo() <= 2, `nunca más de 2 partes en vuelo (${a.maxEnVuelo()})`);
    comprobar(r.usadas === 5 && r.idioma === 'en' && !r.soloPrimera, 'resultado: 5 usadas, idioma en');
  }
  {
    const a = api({ idiomas: ['es'] });
    const r = await tp.transcribirPorPartes({ total: 4, fabricarParte, fetchApi: a.fetchApi });
    comprobar(a.subidas.length === 1 && r.soloPrimera && r.usadas === 1, 'en español: solo se paga la 1.ª parte');
  }
  {
    const a = api();
    const guardadas = [];
    const previas = new Map([[0, [{ start: 1, end: 2, text: 'ya' }]], [1, []], [2, [{ start: 3, end: 4, text: 'ya 3' }]]]);
    const r = await tp.transcribirPorPartes({
      total: 5, fabricarParte, fetchApi: a.fetchApi, previas, idiomaPrevio: 'en',
      alTerminarParte: (k, segs, idioma) => { guardadas.push([k, idioma]); },
    });
    comprobar(a.subidas.length === 2, `retomar: solo se suben las 2 partes que faltaban (${a.subidas.length})`);
    comprobar(a.subidas.every((s) => s.idioma === 'en'), 'retomar: las que faltan usan el idioma guardado');
    comprobar(r.resultados[0][0].text === 'ya' && r.resultados[4][0].text.startsWith('Parte'), 'retomar: mezcla lo guardado con lo nuevo en su lugar');
    comprobar(guardadas.map((g) => g[0]).sort().join(',') === '3,4' && guardadas.every((g) => g[1] === 'en'), 'alTerminarParte avisa cada parte nueva con su idioma');
  }
  {
    let fabricadas = 0;
    const a = api();
    const control = new AbortController();
    const fetchQueCancela = async (ruta, opciones) => { const r = await a.fetchApi(ruta, opciones); control.abort(); return r; };
    let error = null;
    try {
      await tp.transcribirPorPartes({ total: 6, fabricarParte: async (k) => { fabricadas += 1; return fabricarParte(k); }, fetchApi: fetchQueCancela, signal: control.signal });
    } catch (e) { error = e; }
    comprobar(error?.name === 'AbortError' && a.subidas.length === 1 && fabricadas === 1, 'cancelar tras la 1.ª: ni se fabrica ni se sube nada más');
  }
}

// ── T2: reglas puras del archivo ────────────────────────────────────────
const al = await modulo('archivoLocal.js');
{
  comprobar(al.validarArchivo(archivo(bytesDe(10), 'clase.mp4')).ok, 'un MP4 se acepta');
  comprobar(al.validarArchivo(archivo(bytesDe(10), 'peli.mkv', '')).ok, 'un MKV sin tipo MIME se acepta por la extensión');
  comprobar(al.validarArchivo(archivo(bytesDe(10), 'grabacion.MOV', 'video/quicktime')).ok, 'MOV en mayúsculas se acepta');
  comprobar(al.validarArchivo(archivo(new Uint8Array(0), 'vacio.mp4')).codigo === 'vacio', 'archivo vacío → vacio');
  comprobar(al.validarArchivo(archivo(bytesDe(10), 'nota.m4a', 'audio/mp4')).codigo === 'no_es_video', 'un audio → no_es_video (va a la pestaña Archivo)');
  comprobar(al.validarArchivo(archivo(bytesDe(10), 'doc.pdf', 'application/pdf')).codigo === 'no_es_video', 'un PDF → no_es_video');
  comprobar(al.validarArchivo(null).codigo === 'vacio', 'sin archivo → vacio');

  const contenido = bytesDe(3 * 1024 * 1024);
  const h1 = await al.huellaArchivo(archivo(contenido, 'a.mp4'));
  const h2 = await al.huellaArchivo(archivo(contenido, 'otro-nombre.mp4'));
  const cambiado = contenido.slice(); cambiado[cambiado.length - 10] ^= 1;
  const h3 = await al.huellaArchivo(archivo(cambiado, 'a.mp4'));
  comprobar(/^archivo:[0-9a-f]{16}$/.test(h1), `huella con prefijo y 16 hex (${h1})`);
  comprobar(h1 === h2, 'renombrar el archivo NO cambia la huella');
  comprobar(h1 !== h3, 'un byte distinto al final SÍ cambia la huella');
  comprobar(/^archivo:/.test(await al.huellaArchivo(archivo(bytesDe(100), 'corto.mp4'))), 'un archivo de menos de 1 MiB también tiene huella');
  comprobar(al.esClaveArchivo(h1) && !al.esClaveArchivo('x:123') && !al.esClaveArchivo('dNWkwrqAkcM'), 'esClaveArchivo distingue de YouTube y X');

  comprobar(al.planearTrozosTiempo(0).length === 0, '0 s → sin partes');
  const corto = al.planearTrozosTiempo(100);
  comprobar(corto.length === 1 && corto[0].inicioS === 0 && corto[0].finS === 100 && corto[0].limiteS === 0, '100 s → una parte [0, 100]');
  const hora = al.planearTrozosTiempo(3600);
  comprobar(hora.length === 11, `60 min → 11 partes de 6 min con solape (${hora.length})`);
  comprobar(hora.every((t) => t.finS - t.inicioS <= 360), 'ninguna parte pasa de 360 s');
  comprobar(hora.every((t, i) => i === 0 || t.inicioS < hora[i - 1].finS), 'cada parte se solapa con la anterior');
  comprobar(hora.every((t, i) => i === 0 || (t.limiteS > t.inicioS && t.limiteS < hora[i - 1].finS)), 'el límite de cada parte cae dentro del solape');
  comprobar(hora.at(-1).finS === 3600, 'la última parte llega al final');
  comprobar(al.planearTrozosTiempo(365).length === 1 || al.planearTrozosTiempo(365).at(-1).finS === 365, '365 s no deja un pedacito suelto sin cubrir');

  const cortas = al.planearTrozosTiempo(100, { maxS: 20 });
  comprobar(cortas.length <= 7 && cortas.at(-1).finS === 100, `partes cortas: el solape se achica y el avance no se come (${cortas.length} partes)`);

  const mp3 = al.elegirModoExtraccion({ codec: 'aac', decodifica: true });
  comprobar(mp3.modo === 'mp3' && mp3.trozoS === 360, 'audio que el navegador decodifica → MP3 en partes de 6 min');
  const ac3 = al.elegirModoExtraccion({ codec: 'ac3', decodifica: false, bitrate: 192000 });
  comprobar(ac3.modo === 'copia' && ac3.contenedor === 'mp4' && ac3.trozoS >= 100 && ac3.trozoS <= 125, `AC-3 a 192 kbps sin decodificar → copia en partes de ~2 min (${ac3.trozoS} s)`);
  comprobar(al.elegirModoExtraccion({ codec: 'aac', decodifica: false, bitrate: 64000 }).trozoS === 360, 'AAC liviano copiado: tope de 6 min');
  comprobar(al.elegirModoExtraccion({ codec: 'vorbis', decodifica: false, bitrate: 128000 }).contenedor === 'webm', 'Vorbis se copia en WebM (MP4 no lo lleva)');
  comprobar(al.elegirModoExtraccion({ codec: 'dts', decodifica: false }).modo === 'imposible', 'códec desconocido sin decodificar → imposible, con motivo');
  comprobar(al.elegirModoExtraccion({ codec: 'aac', decodifica: false, bitrate: 1500000 }).modo === 'imposible', 'audio de 1,5 Mbps sin decodificar → imposible (partes de < 30 s)');
  comprobar(al.elegirModoExtraccion({ codec: 'ac3', decodifica: false, bitrate: 0 }).trozoS > 0, 'sin tasa de bits medida se usa una prudente');

  comprobar(al.tituloDeArchivo('clase_03-intro.al.prompting.mp4') === 'Clase 03 intro al prompting', 'título legible desde el nombre del archivo');
  comprobar(al.tituloDeArchivo('.mp4') === 'Video de tu equipo', 'nombre vacío → «Video de tu equipo»');
  comprobar(al.tituloDeArchivo('a'.repeat(300) + '.mkv').length <= 120, 'nombre larguísimo se recorta a 120');
  comprobar(/60 min.*11 partes.*no sale de tu equipo/.test(al.resumenAntesDeEmpezar({ duracionS: 3600 })), 'el resumen dice duración, partes y que el video no sale del equipo');
}

// ── T3: servicio de archivos con dobles (sin Mediabunny) ─────────────────
const sa = await modulo('servicioArchivo.js');
{
  const abrirDoble = (opciones = {}) => async () => ({
    duracionS: 750, audio: { codec: 'aac', decodifica: true, bitrate: 128000 }, video: { codec: 'avc' },
    extraccion: { modo: 'mp3', trozoS: 360, contenedor: 'mp3' }, cerrar: () => { opciones.cerrado = true; }, ...opciones.datos,
  });
  function apiDoble(respuestas = []) {
    const subidas = [];
    const fetchApi = async (_r, opciones = {}) => {
      const n = subidas.length;
      subidas.push(opciones.body.get('file').name);
      if (respuestas[n]) return respuestas[n]();
      // Cada parte «oye» una frase a los 10 s de su inicio y otra al final del solape
      return Response.json({ language: 'en', segments: [{ start: 10, end: 13, text: `Frase ${n + 1}.` }, { start: 352, end: 356, text: `Cierre ${n + 1}.` }] });
    };
    return { subidas, fetchApi };
  }
  const fabricar = async (_a, _t, k) => ({ audio: new Blob([new Uint8Array(4000)]), nombre: `equipo_parte_${k + 1}.mp3` });
  const video = archivo(bytesDe(5000), 'Curso IA - clase 1.mp4');

  {
    const a = apiDoble();
    const servicio = new sa.ServicioArchivo({ fetchApi: a.fetchApi, abrir: abrirDoble(), fabricar, esperar: async () => {} });
    const ficha = await servicio.inspeccionar(video);
    comprobar(/^archivo:[0-9a-f]{16}$/.test(ficha.clave) && ficha.titulo === 'Curso IA clase 1', 'inspeccionar: huella y título legible');
    comprobar(ficha.trozos.length === 3 && ficha.bytes === 5000 && ficha.nombreArchivo === 'Curso IA - clase 1.mp4', 'inspeccionar: 750 s → 3 partes; guarda nombre y tamaño');
    comprobar(ficha.originalMudo === false, 'audio decodificable: el original suena');
    const progreso = [];
    const r = await servicio.obtenerParaDoblaje(ficha, { onProgress: (m, f) => progreso.push(f) });
    comprobar(a.subidas.length === 3 && a.subidas.every((n) => /^equipo_parte_\d\.mp3$/.test(n)), 'se suben 3 partes MP3');
    comprobar(r.segmentos.some((s) => s.startTime > 348 + 9 && s.text === 'Frase 2.'), 'los tiempos de la parte 2 se desplazan a su lugar del video');
    comprobar(r.segmentos.filter((s) => /^Cierre/.test(s.text)).length <= 3, 'el solape no duplica frases');
    comprobar(r.idioma === 'en' && r.fuente === 'audio' && r.titulo === 'Curso IA clase 1', 'misma forma de respuesta que X');
    comprobar(progreso.at(-1) === 1, 'el progreso termina en 1');
  }
  {
    const servicio = new sa.ServicioArchivo({ fetchApi: async () => {}, abrir: abrirDoble(), fabricar });
    let error = null;
    try { await servicio.inspeccionar(archivo(bytesDe(10), 'nota.ogg', 'audio/ogg')); } catch (e) { error = e; }
    comprobar(error?.codigo === 'archivo_no_es_video' && /pestaña Archivo/.test(error.message), 'un audio se rechaza y dice adónde ir');
  }
  {
    const estado = {};
    const servicio = new sa.ServicioArchivo({ fetchApi: async () => {}, abrir: abrirDoble({ datos: { duracionS: 7200.001 }, ...estado }), fabricar });
    let error = null;
    try { await servicio.inspeccionar(video); } catch (e) { error = e; }
    comprobar(error?.codigo === 'archivo_largo' && /2 horas/.test(error.message), 'un video que supera 120 min se rechaza antes de gastar nada');
  }
  {
    const subidas = [];
    const servicio = new sa.ServicioArchivo({
      abrir: abrirDoble({ datos: { duracionS: 7200 } }), fabricar, esperar: async () => {},
      fetchApi: async (_ruta, opciones) => {
        subidas.push({ bytes: opciones.body.get('file').size, idioma: opciones.body.get('language') });
        return Response.json({ language: 'en', segments: [{ start: 10, end: 13, text: `Lesson ${subidas.length}: Use React hooks and arrays.` }] });
      },
    });
    const ficha = await servicio.inspeccionar(video);
    comprobar(ficha.trozos.length === 21 && ficha.trozos.at(-1).finS === 7200, '120:00 se admite completo: 21 partes, hasta el final');
    const r = await servicio.obtenerParaDoblaje(ficha, { idiomaOrigen: 'en' });
    comprobar(subidas.length === 21 && subidas.every((s) => s.bytes <= tp.BYTES_MAX_PARTE && s.idioma === 'en'), '120 min: todas las partes respetan el tamaño y el idioma inglés');
    comprobar(r.segmentos.length === 21 && r.segmentos.at(-1).startTime > 6900, '120 min: la transcripción incluye la última parte después de la primera hora');
    comprobar(r.segmentos.every((s, i) => s.text === `Lesson ${i + 1}: Use React hooks and arrays.`), '120 min: conserva exactamente las palabras inglesas de cada respuesta');
  }
  {
    const servicio = new sa.ServicioArchivo({
      fetchApi: async () => {}, fabricar,
      abrir: abrirDoble({ datos: { extraccion: { modo: 'imposible', motivo: 'Este navegador no puede leer el audio (dts).' } } }),
    });
    let error = null;
    try { await servicio.inspeccionar(video); } catch (e) { error = e; }
    comprobar(error?.codigo === 'archivo_audio' && /dts/.test(error.message), 'audio ilegible: el motivo llega tal cual');
  }
  {
    const servicio = new sa.ServicioArchivo({ fetchApi: async () => {}, abrir: abrirDoble({ datos: { audio: { codec: 'ac3', decodifica: false, bitrate: 192000 }, extraccion: { modo: 'copia', trozoS: 117, contenedor: 'mp4' } } }), fabricar });
    const ficha = await servicio.inspeccionar(video);
    comprobar(ficha.originalMudo === true && ficha.trozos.every((t) => t.finS - t.inicioS <= 117) && ficha.trozos.at(-1).finS === 750, `AC-3: avisa que el original no sonará y planea partes de ≤ 117 s (${ficha.trozos.length})`);
  }
  {
    const limite = () => Response.json({ detail: 'Límite de uso de Groq alcanzado. Espera un minuto e inténtalo de nuevo.' }, { status: 500 });
    const a = apiDoble([null, limite, limite, limite, limite, limite, limite]);
    const guardadas = new Map();
    const servicio = new sa.ServicioArchivo({ fetchApi: a.fetchApi, abrir: abrirDoble(), fabricar, esperar: async () => {} });
    const ficha = await servicio.inspeccionar(video);
    let error = null;
    try {
      await servicio.obtenerParaDoblaje(ficha, { alTerminarParte: (k, segs) => guardadas.set(k, segs) });
    } catch (e) { error = e; }
    comprobar(error?.codigo === 'archivo_limite' && /seguirá donde iba/.test(error.message), 'límite de Groq: mensaje honesto y que se retoma');
    comprobar(guardadas.has(0), 'la parte que sí se transcribió quedó guardada');
    const b = apiDoble();
    const servicio2 = new sa.ServicioArchivo({ fetchApi: b.fetchApi, abrir: abrirDoble(), fabricar });
    const r = await servicio2.obtenerParaDoblaje(await servicio2.inspeccionar(video), { previas: guardadas, idiomaPrevio: 'en' });
    comprobar(b.subidas.length === 2 && r.segmentos.length >= 3, `al volver: solo se suben las 2 que faltaban (${b.subidas.length})`);
  }
}

// ── T4: la biblioteca reconoce los videos del equipo ─────────────────────
const bv = await modulo('bibliotecaVideos.js');
const dd = await modulo('descargaDestino.js');
{
  const d = bv.datosDeClave('archivo:0123456789abcdef');
  comprobar(d.plataforma === 'archivo' && d.id === '0123456789abcdef', 'clave archivo: → plataforma archivo');
  comprobar(bv.datosDeClave('x:123').plataforma === 'x' && bv.datosDeClave('dNWkwrqAkcM').plataforma === 'youtube', 'YouTube y X no cambian');
  const e = bv.fusionarEntrada(null, { clave: 'archivo:0123456789abcdef', nombreArchivo: 'clase 1.mp4', bytes: 412e6, duracionS: 1800 });
  comprobar(e.url === '' && e.portada === '' && e.titulo === 'Video de tu equipo', 'sin enlace, sin portada inventada y con título por defecto');
  comprobar(e.nombreArchivo === 'clase 1.mp4' && e.bytes === 412e6, 'guarda nombre y tamaño del archivo');
  const despues = bv.fusionarEntrada({ ...e, etiquetas: ['Aprender'], favorito: true }, { clave: e.clave, posicionS: 300 });
  comprobar(despues.nombreArchivo === 'clase 1.mp4' && despues.etiquetas[0] === 'Aprender' && despues.favorito, 'el guardado automático no borra nombre, temas ni favorito');
  comprobar(bv.filtrarVideos([e, bv.fusionarEntrada(null, { clave: 'x:1' })], { plataforma: 'archivo' }).length === 1, 'filtro «Tu equipo» deja solo los del equipo');
  comprobar(dd.nombreArchivo({ titulo: 'Clase 1', plataforma: 'archivo', tipo: 'doblado' }) === 'jg-turbo-equipo-clase-1-doblado-es.mp4', 'archivo descargado: jg-turbo-equipo-…');
  comprobar(dd.nombreArchivo({ titulo: 'a', plataforma: 'x', tipo: 'audio', extension: 'mp3' }) === 'jg-turbo-x-a-audio-es.mp3', 'X conserva su nombre de archivo');
}

// ── T5: el idioma detectado viaja como código (fallo real 2026-10-01) ──────
// Whisper devolvió «welsh» (nombre) en la 1.ª parte de un curso en inglés y las
// demás se subieron con language=welsh: Groq 400 y todo el video se perdió.
// Ahora viaja «cy» (código, que Groq sí acepta) y el flujo pregunta el idioma.
const io = await modulo('idiomaOrigen.js');
{
  comprobar(io.normalizarCodigoIdioma('welsh') === 'cy', '«welsh» se vuelve «cy»');
  comprobar(io.normalizarCodigoIdioma('english') === 'en', '«english» se vuelve «en»');
  comprobar(io.normalizarCodigoIdioma('en-US') === 'en' && io.normalizarCodigoIdioma('en') === 'en', 'los códigos pasan tal cual');
  comprobar(io.normalizarCodigoIdioma('') === '' && io.normalizarCodigoIdioma('xxinventado') === '', 'vacío o raro → auto, nunca un texto inválido');
  const subidas = [];
  const fetchGales = async (_ruta, opciones = {}) => {
    subidas.push(opciones.body.get('language'));
    const n = subidas.length;
    return Response.json({ language: n === 1 ? 'welsh' : 'cy', segments: [{ start: 1, end: 2, text: `Parte ${n}.` }] });
  };
  const r = await tp.transcribirPorPartes({
    total: 3, fabricarParte: async (k) => ({ audio: new Blob([new Uint8Array(2000)]), nombre: `p${k + 1}.mp3` }),
    fetchApi: fetchGales, esperar: async () => {},
  });
  comprobar(subidas[0] === 'auto' && subidas.slice(1).every((s) => s === 'cy'), 'tras detectar «welsh», las demás viajan con «cy» (nunca «welsh»)');
  comprobar(r.idioma === 'cy', 'el idioma fijado es el código «cy»');
}

// ── T6: subtítulos .srt/.vtt junto al video (mejora 1) ───────────────────
const st = await modulo('subtitulosArchivo.js');
{
  const srt = `1\n00:00:01,000 --> 00:00:04,000\n<i>Hello world.</i>\n\n2\n00:00:05,000 --> 00:00:08,500\n>> Good morning, class.\nSecond line.\n\n3\n00:00:10,000 --> 00:00:12,000\nAna: let's begin.\n`;
  const cues = st.parsearSRT(srt);
  comprobar(cues.length === 3 && cues[0].start === 1 && cues[0].end === 4, 'SRT: 3 frases con sus tiempos');
  comprobar(cues[1].text.includes('>>') && cues[2].text.startsWith('Ana:'), 'SRT: las marcas de quién habla se conservan');
  const { segmentos, formato } = st.segmentosDesdeSubtitulos(srt, 'clase.srt');
  comprobar(formato === 'srt' && segmentos.length === 3, 'SRT válido → 3 segmentos con tiempos');
  comprobar(segmentos[0].text === 'Hello world.' && !/<|>/.test(segmentos[0].text), 'las etiquetas <i> se limpian');
  comprobar(segmentos[1].cambioHablante === true && segmentos[2].cambioHablante === true, '«>>» y «Ana:» marcan cambio de hablante (la 2.ª voz entra sola)');

  const vtt = `WEBVTT\n\nNOTE intro\n\ncorta-1\n00:00.500 --> 00:03.000 align:start\nFirst <b>line</b>.\n\n00:05,000 --> 00:07.000\nSecond line.\n`;
  const { segmentos: sv, formato: fv } = st.segmentosDesdeSubtitulos(vtt, 'clase.vtt');
  comprobar(fv === 'vtt' && sv.length === 2 && sv[0].startTime === 0.5 && sv[0].text === 'First line.', 'VTT con NOTE e identificador se lee (punto o coma valen)');

  comprobar(st.detectarFormatoSubtitulo('x.srt') === 'srt' && st.detectarFormatoSubtitulo('x.vtt') === 'vtt', 'la extensión decide');
  comprobar(st.detectarFormatoSubtitulo('x.txt', 'WEBVTT\n\n00:01.000 --> 00:02.000\nhi\n') === 'vtt', 'sin extensión se adivina por el contenido');

  const latin1 = new File([new Uint8Array([0x6e, 0x69, 0xf1, 0x6f])], 'n.srt', { type: 'text/plain' });
  comprobar((await st.leerTextoSubtitulo(latin1)) === 'niño', 'un .srt de Windows (Latin-1) no rompe las tildes');

  const tiro = async (archivo, nombre, codigo) => {
    let error = null;
    try { await st.leerTextoSubtitulo(archivo); st.segmentosDesdeSubtitulos('xx', nombre); } catch (e) { error = e; }
    return error?.codigo === codigo;
  };
  comprobar(await tiro(new File([], 'v.srt'), 'v.srt', 'srt_vacio'), 'subtítulo vacío → srt_vacio');
  comprobar(await tiro(archivo(bytesDe(10), 'nota.mp3', 'audio/mp3'), 'nota.mp3', 'srt_no_es'), 'un audio → srt_no_es');
  comprobar(await tiro(archivo(bytesDe(10), 'mal.srt'), 'mal.srt', 'srt_formato'), 'texto sin tiempos → srt_formato');
}

// Auditoría: un subtítulo parcialmente roto no puede omitir frases en silencio.
{
  const malo = '1\n00:00:01,000 --> 00:00:02,000\nHi.\n\n2\n00:99:02,000 --> 00:99:04,000\nLost phrase.';
  let fallo = null;
  try { st.segmentosDesdeSubtitulos(malo, 'bad.srt'); } catch (e) { fallo = e; }
  comprobar(fallo?.codigo === 'srt_formato', 'SRT mixto: rechaza tiempos inválidos en vez de perder una frase');
  comprobar(st.parsearSRT('1\n-00:00:01,000 --> 00:00:02,000\nHi.').length === 0, 'SRT: un tiempo negativo no se convierte en positivo');
  fallo = null;
  try { st.validarSubtitulosParaVideo([{ endTime: 100 }], 40); } catch (e) { fallo = e; }
  comprobar(fallo?.codigo === 'srt_video', 'SRT de otro video: rechaza antes de gastar traducción y voz');
  st.validarSubtitulosParaVideo([{ endTime: 40.5 }], 40);
  comprobar(true, 'SRT: admite redondeo de hasta 2 s al final del video');
  const utf16 = new Uint8Array([0xff, 0xfe, 0x6e, 0, 0x69, 0, 0xf1, 0, 0x6f, 0]);
  comprobar(await st.leerTextoSubtitulo(new File([utf16], 'utf16.srt')) === 'niño', 'SRT UTF-16 de Windows: conserva tildes');
}

// ── Resumen ──────────────────────────────────────────────────────────────
{
  for (const nombre of ['limite.srt', 'limite.vtt']) {
    const prefijo = nombre.endsWith('.vtt') ? 'WEBVTT\n\n' : '1\n';
    const { segmentos } = st.segmentosDesdeSubtitulos(prefijo + '01:59:58.000 --> 02:00:00.000\nUse React hooks.', nombre);
    comprobar(segmentos.at(-1).endTime === 7200 && segmentos.at(-1).text === 'Use React hooks.', `${nombre}: conserva texto y tiempos hasta 120:00`);
    let error = null;
    try { st.segmentosDesdeSubtitulos(prefijo + '01:59:59.000 --> 02:00:00.001\nToo long.', nombre); } catch (e) { error = e; }
    comprobar(error?.codigo === 'srt_largo' && /2 horas/.test(error.message), `${nombre}: rechaza subtítulos fuera del máximo`);
  }
}
console.log(`\n${ok} comprobaciones OK · ${fallos} fallos`);
if (fallos) process.exit(1);
