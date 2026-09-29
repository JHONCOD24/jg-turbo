import { readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
const archivos = ['reloj.js', 'ritmoDoblaje.js', 'planificador.js', 'translationService.js', 'motorPreparacion.js', 'dubbingService.js', 'hablaVoz.js', 'syncEngine.js', 'limitador.js', 'vocesDoblaje.js', 'idiomaOrigen.js', 'transcriptionService.js', 'dubbingEngine.js'];
let ok = 0, fallos = 0;
for (const nombre of archivos) {
  const origen = new URL(`../js/youtube/${nombre}`, import.meta.url);
  const destino = new URL(`../extension-udemy/motor/${nombre}`, import.meta.url);
  const hash = (texto) => createHash('sha256').update(texto.replace(/\r\n/g, '\n')).digest('hex');
  const copia = existsSync(destino) ? readFileSync(destino, 'utf8') : '';
  const igual = copia && hash(copia) === hash(readFileSync(origen, 'utf8'));
  console.log(`${igual ? 'OK' : 'FALLO'}: motor identico ${nombre}`);
  igual ? ok++ : fallos++;
  const externos = [...copia.matchAll(/(?:from\s+|import\s*)['"]([^'"]+)['"]/g)].filter((m) => !/^\.\/[^/]+\.js$/.test(m[1]));
  const valido = !!copia && !externos.length;
  console.log(`${valido ? 'OK' : 'FALLO'}: imports internos ${nombre}`);
  valido ? ok++ : fallos++;
}
console.log(`${ok} comprobaciones OK · ${fallos} fallos`);
if (fallos) process.exitCode = 1;
