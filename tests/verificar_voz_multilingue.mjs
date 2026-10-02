import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { chromium } from 'playwright';
const raiz = resolve(import.meta.dirname, '..');
const servidor = createServer(async (q, r) => {
  try {
    const ruta = resolve(raiz, '.' + (new URL(q.url, 'http://local').pathname === '/' ? '/index.html' : new URL(q.url, 'http://local').pathname));
    assert.ok(ruta.startsWith(raiz + '\\') || ruta.startsWith(raiz + '/'));
    const tipos = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg', '.json': 'application/json' };
    r.setHeader('Content-Type', tipos[extname(ruta)] || 'application/octet-stream');
    r.end(await readFile(ruta));
  } catch { r.writeHead(404).end(); }
});
await new Promise((r) => servidor.listen(0, '127.0.0.1', r));
const base = process.env.JG_BASE || `http://127.0.0.1:${servidor.address().port}`;
const navegador = await chromium.launch({ headless: true, args: ['--autoplay-policy=no-user-gesture-required'] });
let ok = 0;
const comprobar = (c, m) => { assert.ok(c, m); ok++; console.log(`OK: ${m}`); };
try {
  const contexto = await navegador.newContext({ serviceWorkers: 'block', viewport: { width: 1280, height: 900 } });
  const cuerpos = [];
  const textosTraducidos = [];
  // Respuesta real de producción (2026-10-02) al lote 14-15 de la clase medida:
  // el traductor quitó las marcas, dejó «hook» en inglés y se comió «array».
  const respuestaReal1415 = '[[JG_SEG_000014]]\nEl hook más usado es useState, y te da dos cosas\n\n[[JG_SEG_000015]]\nel valor actual y una función para actualizarlo';
  const voz = await readFile(resolve(raiz, 'tests/fixtures/biblioteca/voz_real_es.mp3'));
  await contexto.route('**/api/**', async (ruta) => {
    const q = ruta.request(); const url = new URL(q.url());
    if (url.pathname === '/api/tts') {
      const datos = q.method() === 'POST' ? q.postDataJSON() : Object.fromEntries(url.searchParams);
      cuerpos.push(datos);
      return ruta.fulfill({ contentType: 'audio/mpeg', headers: { 'X-TTS-Voice': 'en-US-AvaMultilingualNeural', 'X-TTS-Engine': 'azure-neural-unified' }, body: voz });
    }
    if (url.pathname === '/api/translate') {
      const datos = q.postDataJSON(); cuerpos.push(datos); textosTraducidos.push(datos.text);
      if (datos.text.includes('[[JG_SEG_000014]]') && datos.text.includes('[[JG_SEG_000015]]')) {
        return ruta.fulfill({ json: { text: respuestaReal1415, ia_used: true } });
      }
      return ruta.fulfill({ json: { text: datos.text.replaceAll('Use ', 'Usa ').replaceAll(' and ', ' y '), ia_used: true } });
    }
    return ruta.fulfill({ json: { status: 'ok', online: true, ai_provider_server: 'gemini' } });
  });
  const pagina = await contexto.newPage();
  await pagina.goto(base, { waitUntil: 'domcontentloaded' });
  await pagina.waitForFunction(() => typeof ttsCatalogoVoces === 'function');
  await pagina.evaluate((b) => { SERVER_URL = b + '/api'; }, base);
  comprobar(await pagina.evaluate(() => ttsCatalogoVoces().some((v) => v.value === 'neural:multi:female')), 'Ava en selector de PDF');
  comprobar(await pagina.evaluate(() => ttsVocesParaDoblaje().some((v) => v.value === 'neural:multi:male')), 'Andrew en selector de videos');
  const conservada = await pagina.evaluate(() => {
    localStorage.setItem('jg_tts_voice', 'neural:es-CO:female'); ttsRellenarLocales();
    return document.querySelector('[data-tts-voice-select]').value;
  });
  comprobar(conservada === 'neural:es-CO:female', 'selector muestra la voz anterior sin cambiarla por Ava');
  await pagina.evaluate(() => {
    localStorage.setItem('jg_tts_engine', 'neural'); localStorage.setItem('jg_tts_voice', 'neural:multi:female');
    localStorage.setItem('jg_tts_terminos_web', '1');
    ttsHablar('Si quiero que vuelva por completo al inicio, solo tengo que llamar otra vez a esta función, siempre\n\ny cuando la escriba exactamente igual a como la definí al principio. Usa JavaScript y Node.js.', { sourceId: 'pdf', langHint: 'es' });
  });
  try {
    await pagina.waitForFunction(() => ttsState.queue.some((b) => b.estado === 'listo'));
  } catch (error) {
    console.log(await pagina.evaluate(() => ({ estado: ttsState.status, prefs: ttsPrefs(), cola: ttsState.queue.map((b) => ({ texto: b.text, estado: b.estado, error: String(b.error || '') })) })));
    console.log(cuerpos);
    throw error;
  }
  comprobar(await pagina.evaluate(() => ttsState.modo === 'unified'), 'PDF respeta multilingue elegida');
  comprobar(await pagina.evaluate(() => ttsState.queue.some((b) => b.text.includes('siempre y cuando'))), 'PDF conserva conector completo en una sintesis');
  comprobar(cuerpos.some((c) => c.unified === true || c.unified === 'true'), 'PDF solicita modo multilingue al servidor');
  await pagina.evaluate(() => ttsDetener());
  const configuracion = await pagina.evaluate(() => {
    ttsSincronizarConfigVoz(); ttsGuardarConfigVoz();
    return { modo: document.getElementById('settingsTtsBilingual').value, voz: ttsPrefs().voiceKey };
  });
  comprobar(configuracion.modo === 'unified' && configuracion.voz === 'neural:multi:female', 'guardar configuracion conserva Ava multilingue');
  const traducido = await pagina.evaluate(async () => jgPedirTraduccion({ text: 'Use JavaScript and Node.js.', direction: 'en-es', provider: 'gemini', literal: true }, 20000));
  comprobar(textosTraducidos.at(-1) === 'Use `JavaScript` and `Node.js`.', 'traductor recibe los tecnicismos marcados como codigo');
  comprobar(traducido.text === 'Usa JavaScript y Node.js.', 'traduccion comun restaura tecnicismos antes de mostrar texto');
  comprobar(!/JGWEB|`/.test(traducido.text), 'sin fichas ni comillas en texto visible');
  // Lote real del doblaje por el TranslationService real y la única puerta a
  // /api/translate. La protección vieja rechazaba esta respuesta correcta y
  // partía el lote (12 de 25 llamadas rechazadas, medido el 2026-10-02).
  const llamadasAntes = textosTraducidos.length;
  const loteReal = await pagina.evaluate(async () => {
    const { TranslationService } = await import('/js/youtube/translationService.js?v=' + JG_JS_V);
    // Mismo cableado que asegurarYoutubeSincronizado en index.html.
    const servicio = new TranslationService({ traducirTexto: (texto, opciones = {}) => traducirTranscripcionDetallada(texto, opciones.origen || 'en', 'es', {
      literal: true, revisar: false, contexto: opciones.contexto || null, signal: opciones.signal,
    }) });
    const clase = {
      12: 'When the data needs to change over time, we use state,',
      13: 'and in modern React we handle state with hooks.',
      14: 'The most common hook is useState, and it gives you an array',
      15: 'with two things: the current value and a function to update it.',
    };
    const segmentos = Array.from({ length: 16 }, (_, i) => ({ text: clase[i] || '', startTime: i * 4, endTime: i * 4 + 3.7 }));
    return Object.fromEntries(await servicio.traducirLote([14, 15], segmentos));
  });
  comprobar(textosTraducidos.length - llamadasAntes === 1 && textosTraducidos.at(-1)
    === '[[JG_SEG_000014]]\nThe most common `hook` is useState, and it gives you an `array`\n\n[[JG_SEG_000015]]\nwith two things: the current value and a function to update it.',
  'lote real del doblaje sale en una sola llamada, sin partirse');
  comprobar(loteReal[14] === 'El hook más usado es useState, y te da dos cosas' && loteReal[15] === 'el valor actual y una función para actualizarlo',
    'traduccion correcta sin marcas se usa tal como vino');
  await pagina.evaluate(async () => {
    localStorage.removeItem('jg_tts_terminos_web');
    await jgPedirTraduccion({ text: 'Use JavaScript and Node.js.', direction: 'en-es', provider: 'gemini', literal: true }, 20000);
  });
  comprobar(textosTraducidos.at(-1) === 'Use JavaScript and Node.js.', 'sin la opcion el texto viaja intacto');
  const cuerpoVoz = await pagina.evaluate(async () => {
    const prefs = ttsPrefsParaVoz('neural:multi:male');
    await ttsFetchNeuralChunk({ text: 'Usa React y hooks.', lang: 'es', idiomaFijo: true }, prefs, 1, 'yt');
    return prefs;
  });
  comprobar(cuerpoVoz.bilingualMode === 'unified', 'video resuelve voz propia multilingue');
  comprobar(cuerpos.some((c) => c.voice === 'male' && (c.unified === true || c.unified === 'true')), 'voz en vivo de video solicita Andrew multilingue');
  await pagina.setViewportSize({ width: 390, height: 844 });
  comprobar(await pagina.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'telefono sin desborde');
  comprobar(await pagina.evaluate(() => localStorage.getItem('jg_tts_voice') === 'neural:multi:female'), 'voz de video no pisa eleccion del PDF');
  await contexto.close();
  console.log(`${ok} comprobaciones OK · 0 fallos`);
} finally { await navegador.close(); await new Promise((r) => servidor.close(r)); }
