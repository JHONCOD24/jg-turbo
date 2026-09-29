import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
export const archivos = ['reloj.js', 'ritmoDoblaje.js', 'planificador.js', 'translationService.js', 'motorPreparacion.js', 'dubbingService.js', 'hablaVoz.js', 'syncEngine.js', 'limitador.js', 'vocesDoblaje.js', 'idiomaOrigen.js', 'transcriptionService.js', 'dubbingEngine.js'];
const destino = new URL('./motor/', import.meta.url);
await mkdir(destino, { recursive: true });
const huellas = {};
for (const nombre of archivos) {
  const bytes = await readFile(new URL(`../js/youtube/${nombre}`, import.meta.url));
  await writeFile(new URL(nombre, destino), bytes);
  huellas[nombre] = createHash('sha256').update(bytes.toString('utf8').replace(/\r\n/g, '\n')).digest('hex');
}
await writeFile(new URL('HUELLAS.json', destino), JSON.stringify(huellas, null, 2) + '\r\n');
console.log(`${archivos.length} archivos copiados sin editar el motor original.`);
