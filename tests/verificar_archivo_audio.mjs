/* JG Turbo · Audio de un video del equipo con Mediabunny REAL, sin red.
 *
 * Abre los videos de tests/fixtures/archivo/ como si la persona los eligiera
 * (input type=file), saca su audio en partes y comprueba lo que Whisper va a
 * recibir: formato, tamaño, duración de cada parte y que solo viaje UNA pista.
 * Corre en Chromium de Playwright y, si está instalado, en Chrome.
 *
 *   node tests/verificar_archivo_audio.mjs
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

const TIPOS = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css' };
const PAGINA = `<!doctype html><meta charset="utf-8"><input type="file" id="f">
<script type="module">
import { abrirArchivoLocal, fabricarParteLocal, capturarPortada } from '/js/youtube/medioLocal.js';
import { planearTrozosTiempo } from '/js/youtube/archivoLocal.js';
window.probar = async ({ maxS = 360 } = {}) => {
  const archivo = document.getElementById('f').files[0];
  let abierto;
  try { abierto = await abrirArchivoLocal(archivo); } catch (e) { return { error: e.codigo || e.message }; }
  const trozos = planearTrozosTiempo(abierto.duracionS, { maxS: Math.min(maxS, abierto.extraccion.trozoS) });
  const partes = [];
  for (let k = 0; k < trozos.length; k += 1) {
    const { audio, nombre } = await fabricarParteLocal(abierto, trozos[k], k);
    // Lo que se sube se vuelve a abrir: ¿cuántas pistas y cuánto dura?
    const otra = await abrirArchivoLocal(new File([audio], nombre)).catch((e) => ({ error: e.message }));
    const pistas = otra.input ? (await otra.input.getAudioTracks()).length : 0;
    partes.push({ nombre, bytes: audio.size, tipo: audio.type, duracion: otra.duracionS || 0, pistas, codec: otra.audio?.codec || '' });
    otra.cerrar?.();
  }
  const salida = { modo: abierto.extraccion.modo, codec: abierto.audio.codec, duracion: abierto.duracionS, trozos, partes };
  abierto.cerrar();
  return salida;
};
window.portada = () => capturarPortada(URL.createObjectURL(document.getElementById('f').files[0]));
window.exportar = async () => {
  const ex = await import('/js/youtube/exportadorDoblaje.js');
  const mb = await import('/js/vendor/mediabunny/mediabunny.min.mjs');
  const voz = await (await fetch('/tests/fixtures/biblioteca/voz_1s.mp3')).blob();
  let buffer = null;
  const destino = { tipo: 'memoria', crearTarget: (m) => new m.BufferTarget(), terminar: async (o) => { buffer = o.target.buffer; } };
  const frases = [{ indice: 0, startTime: 1, texto: 'hola' }, { indice: 1, startTime: 12, texto: 'adiós' }];
  const t0 = performance.now();
  const r = await ex.exportarMp4Doblado({ archivo: document.getElementById('f').files[0], frases, sintetizar: async () => voz, destino });
  const leido = new mb.Input({ source: new mb.BufferSource(buffer), formats: mb.ALL_FORMATS });
  return { ...r, ms: Math.round(performance.now() - t0), duracion: Math.round(await leido.computeDuration()),
    video: (await leido.getPrimaryVideoTrack())?.codec, audio: (await leido.getPrimaryAudioTrack())?.codec,
    pistasAudio: (await leido.getAudioTracks()).length };
};
window.listo = true;
</script>`;

const servidor = createServer(async (pedido, respuesta) => {
  const ruta = decodeURIComponent(new URL(pedido.url, 'http://x').pathname);
  if (ruta === '/prueba.html') { respuesta.writeHead(200, { 'Content-Type': 'text/html' }); respuesta.end(PAGINA); return; }
  try {
    const cuerpo = await readFile(join(app, ruta));
    respuesta.writeHead(200, { 'Content-Type': TIPOS[extname(ruta)] || 'application/octet-stream' });
    respuesta.end(cuerpo);
  } catch (_) { respuesta.writeHead(404); respuesta.end(); }
});
await new Promise((r) => servidor.listen(0, '127.0.0.1', r));
// localhost (no 127.0.0.1 a secas tampoco sirve igual en todos): WebCodecs exige contexto seguro.
const BASE = `http://localhost:${servidor.address().port}`;

let ok = 0;
const fallos = [];
function comprobar(nombre, condicion, detalle = '') {
  if (condicion) { ok += 1; console.log(`OK: ${nombre}`); }
  else { fallos.push(nombre); console.error(`FALLO: ${nombre} ${detalle}`); }
}
const fixture = (n) => join(app, 'tests/fixtures/archivo', n);
const MB32 = 3.2 * 1024 * 1024;

for (const canal of ['chromium', 'chrome']) {
  let navegador;
  try { navegador = await chromium.launch(canal === 'chrome' ? { channel: 'chrome' } : {}); }
  catch (_) { console.log(`(sin ${canal} instalado: se omite)`); continue; }
  const pagina = await navegador.newPage();
  await pagina.goto(`${BASE}/prueba.html`);
  await pagina.waitForFunction(() => window.listo);
  const probar = async (archivo, opciones) => {
    await pagina.setInputFiles('#f', fixture(archivo));
    return pagina.evaluate((o) => window.probar(o), opciones || {});
  };

  const webm = await probar('clase_en_40s.webm', { maxS: 20 });
  comprobar(`[${canal}] WebM/Opus: se decodifica y sale MP3`, webm.modo === 'mp3' && webm.codec === 'opus', JSON.stringify(webm).slice(0, 200));
  comprobar(`[${canal}] 40 s en partes de 20 s → ${webm.partes?.length} partes MP3`, webm.partes?.length === 3 && webm.partes.every((p) => p.nombre.endsWith('.mp3') && p.tipo === 'audio/mpeg'));
  comprobar(`[${canal}] cada parte dura lo planeado (±0,5 s)`, webm.partes?.every((p, k) => Math.abs(p.duracion - (webm.trozos[k].finS - webm.trozos[k].inicioS)) < 0.5), JSON.stringify(webm.partes?.map((p) => p.duracion)));
  comprobar(`[${canal}] MP3 mono 32 kbps: 20 s ≈ 80 KB`, webm.partes?.[0].bytes > 40000 && webm.partes[0].bytes < 120000, String(webm.partes?.[0].bytes));

  const ac3 = await probar('clase_en_40s_ac3.mkv');
  comprobar(`[${canal}] MKV con AC-3: el navegador no lo decodifica → se COPIA`, ac3.modo === 'copia' && ac3.codec === 'ac3', JSON.stringify(ac3).slice(0, 200));
  comprobar(`[${canal}] AC-3 copiado viaja como .m4a y sigue siendo AC-3`, ac3.partes?.every((p) => p.nombre.endsWith('.m4a') && p.codec === 'ac3'));
  comprobar(`[${canal}] ninguna parte copiada pasa de 3,2 MB`, ac3.partes?.every((p) => p.bytes <= MB32));

  const dos = await probar('dos_pistas_40s.mkv');
  comprobar(`[${canal}] video con 2 pistas de audio: cada parte lleva UNA`, dos.partes?.length > 0 && dos.partes.every((p) => p.pistas === 1), JSON.stringify(dos.partes));

  const mudo = await probar('sin_audio_10s.webm');
  comprobar(`[${canal}] video sin sonido → archivo_sin_audio`, mudo.error === 'archivo_sin_audio', JSON.stringify(mudo));

  await pagina.setInputFiles('#f', fixture('clase_en_40s.webm'));
  const portada = await pagina.evaluate(() => window.portada());
  comprobar(`[${canal}] miniatura JPEG pequeña desde el propio video`, /^data:image\/jpeg;base64,/.test(portada) && portada.length < 60000, String(portada).slice(0, 40));

  for (const [archivo, video] of [['clase_en_40s.webm', 'vp9'], ['clase_en_40s_ac3.mkv', 'avc']]) {
    if (canal === 'chromium' && video === 'avc') continue;   // el Chromium de Playwright no trae el codificador H.264… pero aquí solo se COPIA: se mide en Chrome
    await pagina.setInputFiles('#f', fixture(archivo));
    const mp4 = await pagina.evaluate(() => window.exportar()).catch((e) => ({ error: e.message }));
    comprobar(`[${canal}] MP4 doblado desde ${archivo}: video ${video} copiado + AAC, 40 s`, mp4.video === video && mp4.audio === 'aac' && mp4.pistasAudio === 1 && Math.abs(mp4.duracion - 40) <= 1, JSON.stringify(mp4));
    comprobar(`[${canal}] ${archivo}: el original de fondo solo si se puede decodificar`, mp4.conOriginal === (video === 'vp9'), String(mp4.conOriginal));
  }
  await navegador.close();
}
servidor.close();
console.log(`\n${ok} comprobaciones OK · ${fallos.length} fallos`);
if (fallos.length) process.exit(1);
