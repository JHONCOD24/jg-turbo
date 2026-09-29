import assert from 'node:assert/strict';
import { crearApi } from '../extension-udemy/lib/api.js';
if (!process.argv.includes('--api-real')) throw new Error('Esta prueba exige --api-real y usa solo la API de JG Turbo, no Udemy.');
let ok = 0;
const api = crearApi({ storage: { get: async () => ({}) } });
const traduccion = await api.traducirTexto('[[JG_SEG_000000]]\nUse JavaScript and Node.js in the backend.\n[[JG_SEG_000001]]\nReact hooks work with arrays.', { terminosWeb: true });
assert.ok(traduccion.ia_used);
assert.ok(['JavaScript', 'Node.js', 'backend', 'React', 'hooks', 'arrays'].every((termino) => traduccion.text.includes(termino)));
assert.ok(!traduccion.text.includes('JGWEB'));
ok++; console.log('OK: traduccion real conserva seis tecnicismos en sus segmentos');
for (const voice of ['female', 'male']) {
  const respuesta = await fetch('https://jg-turbo.vercel.app/api/tts', {
    method: 'POST', credentials: 'omit', signal: AbortSignal.timeout(45000),
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: 'Usa JavaScript y Node.js en el backend. React utiliza hooks.', voice,
      unified: true, language: 'es', locale: 'es-CO', rate: 1, tone: 'neutral', idioma_fijo: true, source: 'yt', prefer_fish: false }),
  });
  assert.ok(respuesta.ok, `HTTP ${respuesta.status}`);
  const bytes = await respuesta.arrayBuffer();
  assert.ok(bytes.byteLength > 1000);
  assert.match(respuesta.headers.get('X-TTS-Voice'), /MultilingualNeural$/);
  assert.match(respuesta.headers.get('X-TTS-Engine'), /neural-unified$/);
  ok++; console.log(`OK: ${voice} ${respuesta.headers.get('X-TTS-Voice')} ${bytes.byteLength} bytes, sin guardar audio`);
}
console.log(`${ok} comprobaciones OK · 0 fallos`);
