  /* Doblaje de YouTube · funciones puras, sin navegador ni red.
* Ejecutar: node tests/test_youtube_doblaje.mjs
* Cada tarea del PLAN_YOUTUBE_DOBLAJE_IMPLEMENTACION_LLM.md añade su sección
* antes del bloque «Resumen». Cuenta las comprobaciones: si bajan, algo se cortó.
*/
  import fs from 'node:fs';
  import path from 'node:path';
  import { fileURLToPath, pathToFileURL } from 'node:url';

  const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const modulo = (nombre) => import(pathToFileURL(path.join(raiz, 'js/youtube', nombre)).href);
  const fixture = JSON.parse(fs.readFileSync(path.join(raiz, 'tests/fixtures/youtube_dNWkwrqAkcM_90s.json'), 'utf8'));

  let ok = 0;
  let fallos = 0;
  function comprobar(condicion, mensaje) {
 if (condicion) { ok += 1; console.log(`OK: ${mensaje}`); }
 else { fallos += 1; console.error(`FALLO: ${mensaje}`); }
  }
  const cerca = (a, b, tolerancia = 1e-6) => Math.abs(a - b) <= tolerancia;
  /** El fixture de 90 s repetido `veces`: un video largo sin gastar créditos. */
  function repetir(segmentos, veces) {
 const salida = [];
 for (let v = 0; v < veces; v += 1) {
   for (const s of segmentos) salida.push({ ...s, startTime: s.startTime + v * 90, endTime: s.endTime + v * 90 });
 }
 return salida;
  }

  // ── Línea base: lo que ya funciona y no se puede romper ─────────────────
  const ts = await modulo('transcriptionService.js');
  {
 const segs = ts.normalizarSegmentos(fixture.segments);
 comprobar(segs.length === 44, 'el fixture real trae 44 segmentos válidos');
 comprobar(segs.every((s, i) => i === 0 || s.startTime >= segs[i - 1].startTime), 'los segmentos quedan ordenados por tiempo');
 comprobar(segs.every((s, i) => i === segs.length - 1 || s.endTime <= segs[i + 1].startTime + 1e-9), 'recortarSolapes: ningún segmento invade al siguiente');
 comprobar(ts.extraerVideoId('https://www.youtube.com/watch?v=dNWkwrqAkcM') === 'dNWkwrqAkcM', 'extraerVideoId: watch?v=');
 comprobar(ts.extraerVideoId('https://youtu.be/jNQXAC9IVRw?t=3') === 'jNQXAC9IVRw', 'extraerVideoId: youtu.be');
 comprobar(ts.extraerVideoId('https://www.youtube.com/shorts/abcdefghijk') === 'abcdefghijk', 'extraerVideoId: shorts');
 comprobar(ts.extraerVideoId('https://example.com/watch?v=x') === '', 'extraerVideoId: rechaza otros dominios');
  }
  const de = await modulo('dubbingEngine.js');
  {
 comprobar(de.ajusteFino(0.1) === 1, 'ajusteFino: dentro de 150 ms no toca la velocidad');
 comprobar(de.percentil([1, 2, 3, 4, 100], 0.95) === 100, 'percentil: p95');
  }

  // ── Resumen ─────────────────────────────────────────────────────────────
  console.log(`\n${ok} comprobaciones OK · ${fallos} fallos`);
  process.exit(fallos ? 1 : 0);
