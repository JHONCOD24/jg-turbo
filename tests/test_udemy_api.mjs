import assert from 'node:assert/strict';
const { crearApi } = await import('../extension-udemy/lib/api.js');
let ok = 0;
const igual = (a, b, m) => { assert.deepEqual(a, b, m); console.log(`OK: ${m}`); ok++; };
const llamadas = [];
let fallo = true;
const api = crearApi({ storage: { get: async () => ({}) }, fetchImpl: async (url, opciones = {}) => {
  llamadas.push({ url, opciones });
  if (url.endsWith('/health')) return Response.json({ ai_provider_server: 'mistral' });
  if (url.endsWith('/translate')) {
    if (fallo) { fallo = false; return new Response('fallo', { status: 502 }); }
    return Response.json({ text: 'Hola', ia_used: true });
  }
  return new Response('audio', { headers: { 'X-TTS-Engine': 'azure', 'X-TTS-Fallback': 'edge' } });
} });
igual(await api.traducirTexto('Hello', { tituloVideo: 'Clase', contexto: { anterior: 'antes', siguiente: 'despues' } }), { text: 'Hola', ia_used: true }, 'JSON de traduccion intacto');
const traducciones = llamadas.filter((l) => l.url.endsWith('/translate'));
igual(traducciones.length, 2, 'repite una vez el 502');
igual(JSON.parse(traducciones[0].opciones.body), { text: 'Hello', direction: 'en-es', provider: 'mistral', api_key: '', literal: true, revisar: false, titulo_video: 'Clase', contexto_previo: 'antes', contexto_siguiente: 'despues' }, 'contrato de traduccion');
const voz = await api.generarAudio('Hola', { voz: 'female', acento: 'es-CO' });
igual(voz.engineHdr, 'azure', 'motor de voz devuelto');
igual(voz.respaldoHdr, 'edge', 'respaldo de voz devuelto');
igual(JSON.parse(llamadas.at(-1).opciones.body), { text: 'Hola', voice: 'female', language: 'es', locale: 'es-CO', rate: 1, tone: 'neutral', idioma_fijo: true, source: 'yt' }, 'voz neural sin Fish');
api.calentar(); await new Promise((r) => setTimeout(r, 0));
igual(llamadas.at(-1).url.endsWith('/tts-warmup'), true, 'precalienta sin bloquear');
const local = crearApi({ storage: { get: async () => ({ jg_api_base: 'http://127.0.0.1:8123/api' }) }, fetchImpl: async (url) => { igual(url.startsWith('http://127.0.0.1:8123/api/'), true, 'base de pruebas desde storage'); return Response.json({}); } });
await local.traducirTexto('x');
const error = crearApi({ storage: { get: async () => ({}) }, fetchImpl: async () => Response.json({ detail: 'Límite de uso' }, { status: 429 }) });
await assert.rejects(error.generarAudio('x'), /Límite de uso/); ok++; console.log('OK: error legible de voz');
console.log(`${ok} comprobaciones OK · 0 fallos`);
