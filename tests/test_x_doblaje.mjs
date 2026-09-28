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

// ── Resumen ─────────────────────────────────────────────────────────────
console.log(`\n${ok} comprobaciones OK · ${fallos} fallos`);
if (fallos) process.exit(1);
