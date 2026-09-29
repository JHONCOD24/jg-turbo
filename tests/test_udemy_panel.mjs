import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const html = readFileSync(new URL('../extension-udemy/panel.html', import.meta.url), 'utf8');
let ok = 0;
for (const id of ['doblar', 'detener', 'voz', 'acento', 'volVoz', 'volOriginal', 'ritmoAuto', 'subtitulo', 'autoSiguiente', 'terminosWeb']) {
  assert.ok(html.includes(`id="${id}"`), `falta control ${id}`); console.log(`OK: control ${id}`); ok++;
}
const { limpiarPreferencias } = await import('../extension-udemy/lib/preferencias.js');
const pref = limpiarPreferencias({ voz: 'fish', curso: '123', subtitulos: 'texto', volOriginal: -5, volVoz: 180, acento: 'es-CO' });
assert.equal(pref.voz, 'female'); console.log('OK: voz limitada a neural'); ok++;
assert.equal(pref.volOriginal, 0); assert.equal(pref.volVoz, 100); console.log('OK: limites de volumen'); ok++;
assert.deepEqual(Object.keys(pref), ['voz', 'acento', 'volVoz', 'volOriginal', 'ritmoAuto', 'subtitulo', 'autoSiguiente', 'terminosWeb']); console.log('OK: solo preferencias permitidas'); ok++;
assert.equal(limpiarPreferencias({ voz: 'male-multi' }).voz, 'male-multi'); console.log('OK: conserva seleccion multilingue'); ok++;
assert.equal(limpiarPreferencias({ terminosWeb: false }).terminosWeb, false); console.log('OK: conserva interruptor de terminos'); ok++;
console.log(`${ok} comprobaciones OK · 0 fallos`);
