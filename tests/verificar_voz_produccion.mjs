import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';

if (!process.argv.includes('--dominio-real')) throw new Error('Usa --dominio-real para verificar solo JG Turbo, no Udemy.');
const raiz = resolve(import.meta.dirname, '..');
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
let ok = 0;
for (const archivo of ['index.html', 'sw.js', 'js/youtube/dubbingService.js',
  'js/youtube/motorPreparacion.js', 'js/youtube/youtubeSyncController.js', 'js/youtube/terminosWeb.js']) {
  const respuesta = await fetch(`https://jg-turbo.vercel.app/${archivo}?comprobar=v159`, {
    credentials: 'omit', cache: 'no-store', signal: AbortSignal.timeout(30000),
  });
  assert.equal(respuesta.status, 200, archivo);
  const remoto = Buffer.from(await respuesta.arrayBuffer());
  const esperado = execFileSync('git', ['show', `HEAD:${archivo}`], { cwd: raiz, maxBuffer: 5 * 1024 * 1024 });
  assert.equal(hash(remoto), hash(esperado), archivo);
  ok++; console.log(`OK: SHA-256 ${archivo} ${hash(remoto)}`);
  if (archivo === 'index.html') {
    assert.ok(remoto.toString().includes("const JG_JS_V = 'v159'"));
    ok++; console.log('OK: HTML v159');
  }
  if (archivo === 'sw.js') {
    assert.ok(remoto.toString().includes('jg-turbo-shell-v159'));
    ok++; console.log('OK: SW v159');
  }
}
const salud = await fetch('https://jg-turbo.vercel.app/api/health', {
  credentials: 'omit', signal: AbortSignal.timeout(30000),
});
assert.equal(salud.status, 200);
ok++; console.log('OK: salud HTTP 200');
console.log(`${ok} comprobaciones de produccion OK`);
