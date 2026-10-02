// Mide, contra PRODUCCIÓN, la protección de tecnicismos por el camino real de la
// app publicada: el frontend de jg-turbo.vercel.app (TranslationService + la única
// puerta traducirTranscripcionDetallada → jgPedirTraduccion → terminosWeb.js) y el
// traductor real de /api/translate. Usa red y unas 10 llamadas de traducción:
// correrlo solo cuando haga falta volver a medir.
//   node tests/medir_terminos_web.mjs --red-real
import { chromium } from 'playwright';

if (!process.argv.includes('--red-real')) throw new Error('Usa --red-real: mide contra producción y gasta cuota de traducción.');
const BASE = process.env.JG_BASE || 'https://jg-turbo.vercel.app';
// Clase inventada de desarrollo web, cortada como subtítulos: la misma de la
// medición del 2026-10-02 (docs/udemy/mediciones/2026-10-02/clase_web.mjs).
const LINEAS = [
  "Alright, so in this lecture we're going to build our first React",
  'component and connect it to a real API.',
  'First, open your terminal and run npm install',
  'so that all the dependencies from the package file are ready.',
  'If you remember, in the last section we talked about the DOM',
  'and how JavaScript can change the page without reloading it.',
  'React does the same thing, but it keeps the state',
  'of your component in memory and updates only what changed.',
  'Now, a component is basically a function that returns some HTML,',
  "well, technically it's JSX, but for now think of it as HTML.",
  'We pass data into it using props, and props are read only,',
  'so the component should never modify them directly.',
  'When the data needs to change over time, we use state,',
  'and in modern React we handle state with hooks.',
  'The most common hook is useState, and it gives you an array',
  'with two things: the current value and a function to update it.',
  "Let's say we want to fetch a list of users from our backend.",
  'Our Express server has an endpoint called slash users',
  'that returns JSON, and the data lives in MongoDB.',
  "On the frontend we'll use fetch, which returns a promise,",
  'so we need async and await to wait for the response.',
  'Be careful here, because if you forget the await keyword,',
  "you'll get a pending promise instead of the actual array of users.",
  'Once we have the data, we store it in state with the setter,',
  'and React re-renders the component automatically.',
  'Then we map over the array and return one list item per user,',
  'and each item needs a unique key, usually the id from the database.',
  'If you see a warning in the console about keys,',
  "that's exactly what it means: React can't track your items.",
  "Okay, let's save the file and check the browser.",
  'Great, the list is there, and if I add a user in MongoDB',
  'and refresh, the new user shows up as well.',
  "Before we move on, let's commit this to Git.",
  'Create a new branch called feature users,',
  'commit your changes, and push them to GitHub.',
  "In the next lecture we'll open a pull request and review the code together.",
];

const navegador = await chromium.launch({ headless: true });
try {
  const pagina = await navegador.newPage();
  await pagina.goto(BASE, { waitUntil: 'domcontentloaded' });
  await pagina.waitForFunction(() => typeof traducirTranscripcionDetallada === 'function', null, { timeout: 60000 });
  const r = await pagina.evaluate(async (lineas) => {
    localStorage.setItem('jg_tts_terminos_web', '1');
    const v = '?v=' + JG_JS_V;
    const { TranslationService, crearLotes } = await import('/js/youtube/translationService.js' + v);
    const { normalizarSegmentos } = await import('/js/youtube/transcriptionService.js' + v);
    const { protegerTerminos } = await import('/js/youtube/terminosWeb.js' + v);
    const segmentos = normalizarSegmentos(lineas.map((text, i) => ({ startTime: i * 4, endTime: i * 4 + 3.7, text })));
    let llamadas = 0;
    const errores = [];
    // Mismo cableado y ritmo que la app (asegurarYoutubeSincronizado + youtubeSyncController).
    const servicio = new TranslationService({
      intervaloMinMs: 1100,
      traducirTexto: async (texto, opciones = {}) => {
        llamadas += 1;
        try {
          return await traducirTranscripcionDetallada(texto, opciones.origen || 'en', 'es', {
            literal: true, revisar: false, tituloVideo: opciones.tituloVideo || '', contexto: opciones.contexto || null, signal: opciones.signal,
          });
        } catch (error) { errores.push(String(error?.message || error)); throw error; }
      },
    });
    const enIngles = (termino, texto) => new RegExp(`(?<![\\p{L}\\p{N}_])${termino.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\p{L}\\p{N}_])`, 'iu').test(texto);
    const inicio = performance.now();
    const lotes = [];
    for (const lote of crearLotes(segmentos)) {
      const indices = lote.map(({ indice }) => indice);
      const antes = llamadas;
      let mapa = new Map();
      try { mapa = await servicio.traducirLote(indices, segmentos, { tituloVideo: 'Building your first React component' }); } catch (error) { errores.push(`lote ${indices[0]}: ${error?.message || error}`); }
      const original = indices.map((i) => segmentos[i].text).join(' ');
      const traducido = indices.map((i) => mapa.get(i) ?? '').join(' ');
      const terminos = [...protegerTerminos(original).texto.matchAll(/`([^`]+)`/g)].map((m) => m[1]);
      lotes.push({
        desde: indices[0], hasta: indices.at(-1), llamadas: llamadas - antes,
        sinTraducir: indices.filter((i) => !mapa.get(i)).length,
        terminos: terminos.length, perdidos: terminos.filter((t) => !enIngles(t, traducido)),
        conMarcas: /`|JGWEB/.test(traducido), texto: indices.map((i) => mapa.get(i) ?? '∅').join(' | '),
      });
      await new Promise((listo) => setTimeout(listo, 1200));
    }
    return { version: JG_JS_V, segundos: (performance.now() - inicio) / 1000, llamadas, errores, lotes, segmentos: segmentos.length };
  }, LINEAS);
  for (const l of r.lotes) {
    console.log(`lote ${l.desde}-${l.hasta}: ${l.llamadas} llamada(s) · sin traducir ${l.sinTraducir} · ${l.terminos - l.perdidos.length}/${l.terminos} en inglés${l.perdidos.length ? ` · se tradujo/perdió: ${l.perdidos.join(', ')}` : ''}${l.conMarcas ? ' · ¡QUEDARON MARCAS!' : ''}`);
    console.log(`    ${l.texto.slice(0, 400)}`);
  }
  const suma = (k) => r.lotes.reduce((a, l) => a + (Array.isArray(l[k]) ? l[k].length : l[k]), 0);
  console.log(`== ${r.version} · ${r.segmentos} segmentos · ${r.lotes.length} lotes · ${r.llamadas} llamadas · ${r.errores.length} errores · ${suma('sinTraducir')} sin traducir · ${suma('terminos') - suma('perdidos')}/${suma('terminos')} tecnicismos en inglés · marcas en el texto: ${r.lotes.some((l) => l.conMarcas) ? 'SÍ' : 'no'} · ${r.segundos.toFixed(1)} s (incluye 1,2 s de pausa por lote)`);
  for (const e of r.errores) console.log(`   error: ${e}`);
} finally { await navegador.close(); }
