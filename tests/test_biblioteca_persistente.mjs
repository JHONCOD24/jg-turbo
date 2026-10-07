/**
 * Guardián de la colección de videos (2026-10-06, pedido del dueño): «que los
 * videos que el usuario guarde sean persistentes ante cualquier actualización o
 * cambio». Un despliegue no toca IndexedDB; lo que puede borrar la colección es
 * un CAMBIO de código. Esta prueba falla si alguien introduce cualquiera de las
 * formas conocidas de perderla:
 *  - borrar la base `jg_youtube` o vaciar sus almacenes;
 *  - bajar la versión de la base (el navegador rechaza abrirla) o quitar un almacén en la migración;
 *  - borrar fichas o doblajes fuera de `quitarVideo` (la única puerta, con «Deshacer»);
 *  - que el service worker toque IndexedDB al actualizarse;
 *  - dejar de pedir el almacenamiento persistente.
 * Si de verdad hace falta cambiar algo de esto, primero se escribe la migración
 * y se actualiza esta prueba con su porqué (TRAMPAS.md §7.2).
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

const raiz = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const leer = (ruta) => readFileSync(path.join(raiz, ruta), 'utf8');
let ok = 0;
let fallos = 0;
function comprobar(condicion, mensaje) {
  if (condicion) { ok += 1; console.log(`OK: ${mensaje}`); } else { fallos += 1; console.log(`FALLO: ${mensaje}`); }
}

/** Todo el código de la app que corre en el navegador (sin vendor ni pruebas). */
function archivosApp() {
  const salida = ['index.html', 'sw.js'];
  const recorrer = (dir) => {
    for (const nombre of readdirSync(path.join(raiz, dir))) {
      const ruta = path.join(dir, nombre);
      if (statSync(path.join(raiz, ruta)).isDirectory()) { if (nombre !== 'vendor') recorrer(ruta); } else if (/\.(m?js|html)$/.test(nombre)) salida.push(ruta);
    }
  };
  recorrer('js');
  return salida;
}

const cache = leer('js/youtube/cacheDoblaje.js');
const version = Number((cache.match(/const VERSION = (\d+);/) || [])[1]);
comprobar(/const BASE = 'jg_youtube';/.test(cache), 'la base sigue llamándose jg_youtube (renombrarla = colección vacía)');
comprobar(version >= 2, `la versión de la base solo sube (es ${version}; mínimo 2)`);
for (const almacen of ['doblajes', 'videos', 'voces']) {
  comprobar(new RegExp(`=\\s*'${almacen}';`).test(cache), `el almacén «${almacen}» sigue existiendo`);
}
const migracion = cache.slice(cache.indexOf('onupgradeneeded'), cache.indexOf('pedido.onsuccess'));
comprobar(migracion.length > 0 && !/deleteObjectStore|\.clear\(|\.delete\(/.test(migracion), 'la migración solo crea y copia: nunca borra almacenes ni datos');

// Borrados de fichas y doblajes: solo dentro de quitarVideo.
const quitar = cache.slice(cache.indexOf('export async function quitarVideo'), cache.indexOf('export async function restaurarVideo'));
const borradosFuera = cache.replace(quitar, '').match(/\[(VIDEOS|DOBLAJES)\]\.delete|\b(VIDEOS|DOBLAJES)\b[^;\n]*\.delete\(/g) || [];
comprobar(quitar.length > 0 && borradosFuera.length === 0, 'fichas y doblajes solo se borran en quitarVideo (a mano, con «Deshacer»)');
comprobar(/podarVoces[\s\S]*?operar\(VOCES/.test(cache) && !/function podar\(/.test(cache), 'lo único que se poda solo es la voz (se regenera); la poda de videos no vuelve');

let peligrosos = [];
for (const archivo of archivosApp()) {
  const texto = leer(archivo);
  if (/deleteDatabase\s*\(/.test(texto)) peligrosos.push(`${archivo}: deleteDatabase`);
  if (/jg_youtube/.test(texto) && archivo !== path.join('js', 'youtube', 'cacheDoblaje.js')) peligrosos.push(`${archivo}: abre jg_youtube por su cuenta`);
}
comprobar(peligrosos.length === 0, `nadie borra ni abre por su cuenta la base de videos (${peligrosos.join(' · ') || 'ninguno'})`);

const sw = leer('sw.js');
comprobar(!/indexedDB/i.test(sw), 'el service worker no toca IndexedDB al actualizarse (solo sus cachés de archivos)');

const controlador = leer('js/youtube/youtubeSyncController.js');
comprobar((controlador.match(/pedirPersistencia\(\)/g) || []).length >= 2, 'se pide almacenamiento persistente al guardar un video y al abrir la app con videos guardados');

console.log(`\n${ok} comprobaciones OK · ${fallos} fallos`);
process.exit(fallos ? 1 : 0);
