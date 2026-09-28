/* JG Turbo · Biblioteca de videos: guardado v2 y descargas, en un navegador real.
 *
 * Sin la interfaz: importa los módulos en una página en blanco del mismo
 * servidor y los ejercita. Migración v1 → v2 con datos de verdad, «lo
 * automático nunca pisa lo que organizó la persona», quitar + deshacer, el
 * tope de las voces guardadas, y los tres archivos (MP3 doblado, MP4 de X
 * doblado, MP4 original) con voces y video de prueba hechos con FFmpeg.
 *
 * Corre dos veces: Chromium de Playwright (sin AAC ni H.264: el peor caso, usa
 * la extensión AAC y no puede mezclar el audio original) y Chrome instalado
 * (el caso del dueño). Si Chrome no está, esa pasada se informa OMITIDA.
 *
 *   node tests/verificar_biblioteca_datos.mjs
 */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, join, extname } from 'node:path';
import { pathToFileURL } from 'node:url';

const app = resolve(import.meta.dirname, '..');
const { chromium } = await (async () => {
  const candidatos = [
    resolve(app, 'node_modules/playwright/index.mjs'),
    resolve(app, '../node_modules/playwright/index.mjs'),
    resolve(app, '../JG Turbo_OLD/node_modules/playwright/index.mjs'),
  ];
  for (const ruta of candidatos) {
    try { return await import(pathToFileURL(ruta).href); } catch (_) { /* siguiente */ }
  }
  throw new Error('Playwright no encontrado en: ' + candidatos.join(' · '));
})();

const tipos = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.mp3': 'audio/mpeg', '.mp4': 'video/mp4' };
const servidor = createServer(async (q, r) => {
  try {
    const p = decodeURIComponent(new URL(q.url, 'http://localhost').pathname);
    if (p === '/prueba.html') { r.setHeader('Content-Type', 'text/html'); r.end('<!doctype html><meta charset="utf-8"><title>prueba</title><body></body>'); return; }
    const f = join(app, p);
    const cuerpo = await readFile(f);
    r.setHeader('Content-Type', tipos[extname(f)] || 'application/octet-stream');
    r.setHeader('Accept-Ranges', 'bytes');
    const rango = /bytes=(\d+)-(\d*)/.exec(q.headers.range || '');
    if (rango) {
      const desde = Number(rango[1]);
      const hasta = rango[2] ? Math.min(Number(rango[2]), cuerpo.length - 1) : cuerpo.length - 1;
      r.writeHead(206, { 'Content-Range': `bytes ${desde}-${hasta}/${cuerpo.length}`, 'Content-Length': hasta - desde + 1 });
      r.end(cuerpo.subarray(desde, hasta + 1));
      return;
    }
    r.end(cuerpo);
  } catch { r.writeHead(404).end(); }
});
await new Promise((ok) => servidor.listen(0, '127.0.0.1', ok));
const base = `http://127.0.0.1:${servidor.address().port}`;

let ok = 0;
const fallos = [];
function comprobar(nombre, condicion, detalle = '') {
  if (condicion) { ok += 1; console.log(`OK: ${nombre}`); }
  else { fallos.push(nombre); console.log(`FALLO: ${nombre}${detalle ? ` — ${detalle}` : ''}`); }
}

async function pasada(etiqueta, opciones) {
  let navegador;
  try { navegador = await chromium.launch(opciones); } catch (error) {
    console.log(`\n── ${etiqueta}: OMITIDA (${String(error.message).split('\n')[0]})`);
    return;
  }
  console.log(`\n── ${etiqueta} ─────────────────────────────────────────`);
  try {
    const contexto = await navegador.newContext({ acceptDownloads: true });
    const pagina = await contexto.newPage();
    const errores = [];
    pagina.on('pageerror', (e) => errores.push(String(e)));
    await pagina.goto(`${base}/prueba.html`);

    // 1) Base v1 con dos doblajes, como la tiene hoy el dueño
    await pagina.evaluate(() => new Promise((ok, mal) => {
      const pedido = indexedDB.open('jg_youtube', 1);
      pedido.onupgradeneeded = () => pedido.result.createObjectStore('doblajes', { keyPath: 'videoId' });
      pedido.onsuccess = () => {
        const tx = pedido.result.transaction('doblajes', 'readwrite');
        const a = tx.objectStore('doblajes');
        a.put({ videoId: 'dNWkwrqAkcM', titulo: 'The Marketing GENIUS', duracionS: 5314, idiomaOrigen: 'en', posicionS: 900, segmentos: [{ startTime: 0, endTime: 2, text: 'Hello' }], traducciones: [[0, 'Hola']], actualizado: Date.UTC(2026, 8, 20) });
        a.put({ videoId: 'x:1349794411333394432', titulo: '@BrooklynNets · WATCH', duracionS: 324, idiomaOrigen: 'en', posicionS: 0, segmentos: [], traducciones: [], actualizado: Date.UTC(2026, 8, 27) });
        tx.oncomplete = () => { pedido.result.close(); ok(); };
        tx.onerror = () => mal(tx.error);
      };
    }));

    const r = await pagina.evaluate(async () => {
      const cd = await import('/js/youtube/cacheDoblaje.js');
      const salida = {};
      const videos = await cd.listarVideos();
      salida.migrados = videos.map((v) => `${v.clave}|${v.plataforma}|${v.estado}|${v.portada ? 'con' : 'sin'}`).sort();
      salida.doblajeIntacto = (await cd.leerDoblaje('dNWkwrqAkcM'))?.traducciones?.[0]?.[1];
      await cd.actualizarVideo('dNWkwrqAkcM', { etiquetas: ['Negocio'], favorito: true });
      const auto = await cd.registrarVideo({ clave: 'dNWkwrqAkcM', titulo: 'Título nuevo', posicionS: 5300, duracionS: 5314 });
      salida.organizadoIntacto = auto.etiquetas.join() === 'Negocio' && auto.favorito === true && auto.estado === 'visto' && auto.titulo === 'Título nuevo';
      // El guardado automático (cada 5 s) y una edición de la persona al mismo tiempo
      await Promise.all([
        cd.registrarVideo({ clave: 'x:1349794411333394432', posicionS: 100, duracionS: 324 }),
        cd.actualizarVideo('x:1349794411333394432', { etiquetas: ['Deportes'] }),
        cd.registrarVideo({ clave: 'x:1349794411333394432', posicionS: 105, duracionS: 324 }),
      ]);
      const carrera = await cd.leerVideo('x:1349794411333394432');
      salida.carrera = `${carrera.etiquetas.join()}|${carrera.posicionS}`;
      await cd.guardarVoz('dNWkwrqAkcM|v|a', 'dNWkwrqAkcM', new Blob([new Uint8Array(1000)], { type: 'audio/mpeg' }), 'azure-neural-regional');
      const leida = await cd.leerVoz('dNWkwrqAkcM|v|a'); salida.vozGuardada = `${leida?.blob?.size}|${leida?.motor}|${leida?.habla}`;
      await cd.guardarVoz('dNWkwrqAkcM|v|b', 'dNWkwrqAkcM', new Blob([new Uint8Array(900)], { type: 'audio/mpeg' }), 'edge', { duracionS: 5.54, desdeS: 0.19, hastaS: 4.77, sobra: 1 });
      const conHabla = await cd.leerVoz('dNWkwrqAkcM|v|b'); salida.hablaGuardada = JSON.stringify(conHabla?.habla);
      const copia = await cd.quitarVideo('dNWkwrqAkcM');
      salida.quitado = !(await cd.leerVideo('dNWkwrqAkcM')) && !(await cd.leerDoblaje('dNWkwrqAkcM')) && !(await cd.leerVoz('dNWkwrqAkcM|v|a'));
      salida.restaurado = await cd.restaurarVideo(copia) && (await cd.leerVideo('dNWkwrqAkcM'))?.etiquetas?.join() === 'Negocio' && Boolean((await cd.leerDoblaje('dNWkwrqAkcM'))?.segmentos?.length);
      for (let i = 0; i < 5; i += 1) await cd.guardarVoz(`k${i}`, 'x:1349794411333394432', new Blob([new Uint8Array(400)]));
      salida.conVoz = [...(await cd.videosConVoz())].join();
      salida.podadas = await cd.podarVoces(1000);
      salida.vocesQueQuedan = (await Promise.all([0, 1, 2, 3, 4].map((i) => cd.leerVoz(`k${i}`)))).filter(Boolean).length;
      salida.masDeVeinte = await (async () => {
        for (let i = 0; i < 25; i += 1) await cd.guardarDoblaje({ videoId: `v${i}`, segmentos: [], traducciones: [] });
        return (await cd.listarDoblajes()).length;
      })();
      return salida;
    });
    comprobar(`[${etiqueta}] migración v1→v2: los 2 doblajes entran a la biblioteca con su plataforma`, r.migrados.join() === 'dNWkwrqAkcM|youtube|viendo|con,x:1349794411333394432|x|nuevo|sin', r.migrados.join());
    comprobar(`[${etiqueta}] la migración no toca el doblaje guardado`, r.doblajeIntacto === 'Hola');
    comprobar(`[${etiqueta}] lo automático no pisa etiquetas ni favorito`, r.organizadoIntacto);
    comprobar(`[${etiqueta}] guardado automático y edición a la vez: no se pierde la etiqueta`, r.carrera === 'Deportes|105', r.carrera);
    comprobar(`[${etiqueta}] la voz guardada se lee igual, con su motor (sin medida: null)`, r.vozGuardada === '1000|azure-neural-regional|null', r.vozGuardada);
    comprobar(`[${etiqueta}] la voz se guarda con su tramo hablado y vuelve igual`, r.hablaGuardada === '{"duracionS":5.54,"desdeS":0.19,"hastaS":4.77}', r.hablaGuardada);
    comprobar(`[${etiqueta}] quitar borra ficha, doblaje y voces`, r.quitado);
    comprobar(`[${etiqueta}] deshacer devuelve ficha (con etiquetas) y doblaje`, r.restaurado);
    comprobar(`[${etiqueta}] se sabe qué videos tienen voz guardada (sin leer los audios)`, r.conVoz === 'x:1349794411333394432', r.conVoz);
    comprobar(`[${etiqueta}] las voces pasan de presupuesto → salen las menos usadas`, r.podadas === 3 && r.vocesQueQuedan === 2, `${r.podadas} / ${r.vocesQueQuedan}`);
    comprobar(`[${etiqueta}] ya no se poda en silencio el video 21`, r.masDeVeinte >= 26, String(r.masDeVeinte));

    // 2) Archivos
    const a = await pagina.evaluate(async () => {
      const ex = await import('/js/youtube/exportadorDoblaje.js');
      const voz = {};
      for (const s of [1, 2, 3]) voz[s] = await (await fetch(`/tests/fixtures/biblioteca/voz_${s}s.mp3`)).blob();
      const pedidas = [];
      // La frase 1 dura 3 s y solo tiene 2,2 s: se vuelve a pedir acelerada (aquí, el MP3 de 2 s).
      const sintetizar = async (texto, { tasa }) => { pedidas.push(`${texto}@${tasa}`); return tasa > 1 ? voz[2] : voz[texto === 'larga' ? 3 : 1]; };
      const frases = [
        { indice: 0, startTime: 0.5, texto: 'corta' },
        { indice: 1, startTime: 3, texto: 'larga' },
        { indice: 2, startTime: 5.2, texto: 'corta' },
        { indice: 3, startTime: 8, texto: '' },
      ];
      const memoria = () => {
        let ultimo = null;
        return { tipo: 'memoria', crearTarget: (mb) => new mb.BufferTarget(), terminar: async (o) => { ultimo = o.target.buffer; }, recibirFlujo: async (f) => { ultimo = await new Response(f).arrayBuffer(); }, get buffer() { return ultimo; } };
      };
      const salida = {};
      const t0 = performance.now();
      const d1 = memoria();
      const mp3 = await ex.exportarMp3({ frases, duracionVideoS: 12, sintetizar, destino: d1 });
      const decod = await ex.decodificarAudio(new Blob([d1.buffer]));
      salida.mp3 = { ...mp3, ms: Math.round(performance.now() - t0), duracion: Math.round(decod.duration * 10) / 10, kb: Math.round(d1.buffer.byteLength / 1024), pedidas };
      // ¿La voz suena en su segundo? Energía en 0,5–1,5 s y silencio en 1,6–2,9 s
      const datos = decod.getChannelData(0);
      const energia = (a, b) => { let s = 0; for (let i = Math.floor(a * decod.sampleRate); i < Math.floor(b * decod.sampleRate); i += 1) s += datos[i] * datos[i]; return s / ((b - a) * decod.sampleRate); };
      salida.mp3.enSuSegundo = energia(0.6, 1.4) > 0.002 && energia(1.7, 2.8) < 0.0005;

      const t1 = performance.now();
      const d2 = memoria();
      const progreso = [];
      const mp4 = await ex.exportarMp4DobladoX({ mp4Url: '/tests/fixtures/biblioteca/video_x_20s.mp4', frases, sintetizar, destino: d2, onProgreso: (p) => progreso.push(p.fase) });
      const mb = await import('/js/vendor/mediabunny/mediabunny.min.mjs');
      const leido = new mb.Input({ source: new mb.BufferSource(d2.buffer), formats: mb.ALL_FORMATS });
      salida.mp4 = { ...mp4, ms: Math.round(performance.now() - t1), kb: Math.round(d2.buffer.byteLength / 1024),
        duracion: Math.round((await leido.computeDuration()) * 10) / 10,
        video: (await leido.getPrimaryVideoTrack())?.codec, audio: (await leido.getPrimaryAudioTrack())?.codec,
        fases: [...new Set(progreso)].join(',') };

      const d3 = memoria();
      const original = await ex.descargarOriginalX({ mp4Url: '/tests/fixtures/biblioteca/video_x_20s.mp4', destino: d3 });
      salida.original = { bytes: original.bytes, iguales: d3.buffer.byteLength === original.bytes };

      // Voz REAL de producción (edge-tts, 2026-09-28): 0,21 s de silencio delante y 0,85 s detrás.
      const hv = await import('/js/youtube/hablaVoz.js');
      const real = await (await fetch('/tests/fixtures/biblioteca/voz_real_es.mp3')).blob();
      salida.habla = await hv.medirHabla(real);
      // El motor en vivo recorta sobre el <audio>: su reloj debe coincidir con la decodificación.
      salida.duracionElemento = await new Promise((listo) => {
        const el = new Audio();
        el.addEventListener('loadedmetadata', () => listo(el.duration), { once: true });
        el.addEventListener('error', () => listo(-1), { once: true });
        el.src = URL.createObjectURL(real);
      });
      const pedidasReal = [];
      const d4 = memoria();
      const conReal = await ex.exportarMp3({
        frases: [{ indice: 0, startTime: 1, texto: 'real' }, { indice: 1, startTime: 6, texto: '' }], duracionVideoS: 8,
        sintetizar: async (t, { tasa }) => { pedidasReal.push(tasa); return real; }, destino: d4,
      });
      const salidaReal = await ex.decodificarAudio(new Blob([d4.buffer]));
      // Primer instante audible (−40 dB) en el archivo y en la voz original.
      const inicioAudible = (buffer) => {
        const canal = buffer.getChannelData(0);
        for (let i = 0; i < canal.length; i += 1) if (Math.abs(canal[i]) > 0.01) return i / buffer.sampleRate;
        return -1;
      };
      const enLaVoz = inicioAudible(await ex.decodificarAudio(real));
      const r3 = (x) => Math.round(x * 1000) / 1000;
      salida.real = {
        aceleradas: conReal.aceleradas, pedidas: pedidasReal.join(),
        arrancaS: r3(inicioAudible(salidaReal)), sinRecorteS: r3(1 + enLaVoz), esperadoS: r3(1 + enLaVoz - salida.habla.desdeS),
      };

      // Cancelar a mitad corta con AbortError y no deja el archivo a medias
      const control = new AbortController();
      const lenta = async (texto, o) => { await new Promise((r) => setTimeout(r, 200)); return sintetizar(texto, o); };
      setTimeout(() => control.abort(), 50);
      try { await ex.exportarMp3({ frases, duracionVideoS: 12, sintetizar: lenta, destino: memoria(), signal: control.signal }); salida.cancelar = 'no cortó'; }
      catch (e) { salida.cancelar = e.name; }
      return salida;
    });
    comprobar(`[${etiqueta}] MP3: dura lo que el video (12 s)`, Math.abs(a.mp3.duracion - 12) <= 0.2, `${a.mp3.duracion} s`);
    comprobar(`[${etiqueta}] MP3: la frase que no cabía se pidió acelerada (1,25×)`, a.mp3.aceleradas === 1 && a.mp3.pedidas.includes('larga@1.25'), a.mp3.pedidas.join(' '));
    comprobar(`[${etiqueta}] MP3: la voz suena en su segundo y hay silencio entre frases`, a.mp3.enSuSegundo);
    comprobar(`[${etiqueta}] MP3: una frase sin texto no se pide`, !a.mp3.pedidas.some((p) => p.startsWith('@')));
    comprobar(`[${etiqueta}] MP4 de X doblado: video copiado (avc) + audio aac, 20 s`, a.mp4.video === 'avc' && a.mp4.audio === 'aac' && Math.abs(a.mp4.duracion - 20) <= 0.3, JSON.stringify(a.mp4));
    comprobar(`[${etiqueta}] MP4: el progreso pasa por voz y archivo`, a.mp4.fases.includes('voz') && a.mp4.fases.includes('archivo'), a.mp4.fases);
    comprobar(`[${etiqueta}] MP4 original de X: llega entero`, a.original.iguales && a.original.bytes === 172412, JSON.stringify(a.original));
    comprobar(`[${etiqueta}] cancelar a mitad corta con AbortError`, a.cancelar === 'AbortError', a.cancelar);
    comprobar(`[${etiqueta}] voz real: se mide dónde se habla (sin el silencio de los lados)`, a.habla && a.habla.desdeS > 0.15 && a.habla.desdeS < 0.25 && a.habla.hastaS > 4.6 && a.habla.hastaS < 4.95 && a.habla.duracionS > 5.4, JSON.stringify(a.habla));
    comprobar(`[${etiqueta}] voz real: el <audio> y la decodificación miden igual (${a.duracionElemento} s)`, Math.abs(a.duracionElemento - a.habla.duracionS) < 0.06, `${a.duracionElemento} vs ${a.habla?.duracionS}`);
    comprobar(`[${etiqueta}] voz real: 4,5 s de habla caben en 5 s sin acelerar (con el silencio pedía 1,15×)`, a.real.aceleradas === 0 && a.real.pedidas === '1', JSON.stringify(a.real));
    // Margen: el retardo del códec MP3 del archivo (~0,05 s). Sin recorte arrancaría en `sinRecorteS`.
    comprobar(`[${etiqueta}] voz real: suena en su segundo, sin el silencio de delante (${a.real.arrancaS} s; sin recorte ${a.real.sinRecorteS} s)`,
      a.real.arrancaS >= a.real.esperadoS - 0.01 && a.real.arrancaS <= a.real.esperadoS + 0.07 && a.real.arrancaS < a.real.sinRecorteS - 0.12, JSON.stringify(a.real));
    comprobar(`[${etiqueta}] sin errores de JavaScript`, errores.length === 0, errores.join(' | '));
    console.log(`   medidas: MP3 ${a.mp3.ms} ms · MP4 ${a.mp4.ms} ms (${a.mp4.kb} KB) · audio original mezclado: ${a.mp4.conOriginal ? 'sí' : 'no (este navegador no decodifica AAC)'}`);
    await contexto.close();
  } finally {
    await navegador.close();
  }
}

try {
  await pasada('Chromium de Playwright (sin códecs propietarios)', {});
  await pasada('Chrome instalado', { channel: 'chrome' });
} finally {
  servidor.close();
}
console.log(`\n${ok} comprobaciones OK · ${fallos.length} fallos`);
if (fallos.length) { console.log(fallos.map((f) => `   · ${f}`).join('\n')); process.exit(1); }
