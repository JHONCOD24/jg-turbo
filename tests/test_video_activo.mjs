/* El «video activo» (jg_yt_video_activo) · funciones puras, sin navegador.
 * Ejecutar: node tests/test_video_activo.mjs
 * Cuenta las comprobaciones: si bajan de las de la última vez, algo se cortó.
 */
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const va = await import(pathToFileURL(path.join(raiz, 'js/youtube/videoActivo.js')).href);

let ok = 0;
let fallos = 0;
function comprobar(condicion, mensaje) {
  if (condicion) { ok += 1; console.log(`OK: ${mensaje}`); }
  else { fallos += 1; console.error(`FALLO: ${mensaje}`); }
}
/** Un localStorage mínimo, con la opción de romperse como en un modo privado. */
function almacenFalso({ roto = false } = {}) {
  const datos = new Map();
  return {
    datos,
    getItem: (k) => { if (roto) throw new Error('bloqueado'); return datos.has(k) ? datos.get(k) : null; },
    setItem: (k, v) => { if (roto) throw new Error('cuota'); datos.set(k, String(v)); },
    removeItem: (k) => { if (roto) throw new Error('bloqueado'); datos.delete(k); },
  };
}

comprobar(va.CLAVE_VIDEO_ACTIVO === 'jg_yt_video_activo', 'la clave es nueva y lleva el prefijo jg_');

// ── Normalizar ────────────────────────────────────────────────────────────
{
  const n = va.normalizarVideoActivo({ tipo: 'youtube', clave: 'dNWkwrqAkcM', url: 'https://youtu.be/dNWkwrqAkcM', segundo: 754.9, titulo: 'T' });
  comprobar(n && n.tipo === 'youtube' && n.clave === 'dNWkwrqAkcM' && n.segundo === 754, 'YouTube válido: el segundo se redondea hacia abajo');
  comprobar(va.normalizarVideoActivo(null) === null && va.normalizarVideoActivo('x') === null && va.normalizarVideoActivo(7) === null, 'basura (null, texto, número) no es un video activo');
  comprobar(va.normalizarVideoActivo({ tipo: 'tiktok', clave: 'a', url: 'u' }) === null, 'un tipo desconocido se descarta');
  comprobar(va.normalizarVideoActivo({ tipo: 'youtube', clave: '', url: 'u' }) === null, 'sin clave no sirve');
  comprobar(va.normalizarVideoActivo({ tipo: 'youtube', clave: 'a', url: '' }) === null, 'YouTube sin enlace no sirve: no hay cómo reabrirlo');
  comprobar(va.normalizarVideoActivo({ tipo: 'x', clave: 'x:1', url: '' }) === null, 'X sin enlace tampoco');
  const ar = va.normalizarVideoActivo({ tipo: 'archivo', clave: 'archivo:abc', nombreArchivo: 'clase.mp4', bytes: 5000, segundo: 30 });
  comprobar(ar && ar.tipo === 'archivo' && ar.url === '' && ar.nombreArchivo === 'clase.mp4' && ar.bytes === 5000, 'archivo del equipo: sin enlace, con nombre y tamaño');
  comprobar(va.normalizarVideoActivo({ tipo: 'youtube', clave: 'a', url: 'u', segundo: -5 }).segundo === 0, 'un segundo negativo queda en 0');
  comprobar(va.normalizarVideoActivo({ tipo: 'youtube', clave: 'a', url: 'u', segundo: 'NaN' }).segundo === 0, 'un segundo que no es número queda en 0');
  comprobar(va.normalizarVideoActivo({ tipo: 'youtube', clave: 'a', url: 'u', titulo: 'x'.repeat(900) }).titulo.length === 300, 'un título larguísimo se corta');
  comprobar(va.normalizarVideoActivo({ tipo: 'youtube', clave: 'a', url: 'u', preparando: 1 }).preparando === true, 'el indicador «preparando» es booleano');
}

// ── Guardar / leer / olvidar ──────────────────────────────────────────────
{
  const a = almacenFalso();
  comprobar(va.leerVideoActivo(a) === null, 'almacenamiento vacío: no hay video activo');
  const bien = va.guardarVideoActivo({ tipo: 'x', clave: 'x:99', url: 'https://x.com/a/status/99', segundo: 12 }, a, 1234);
  const leido = va.leerVideoActivo(a);
  comprobar(bien === true && leido?.clave === 'x:99' && leido.segundo === 12 && leido.actualizado === 1234, 'guardar y leer devuelven lo mismo, con la hora');
  comprobar(va.guardarVideoActivo({ tipo: 'youtube', clave: 'a' }, a) === false && va.leerVideoActivo(a)?.clave === 'x:99', 'un registro inválido NO pisa al bueno');
  va.olvidarVideoActivo(a);
  comprobar(va.leerVideoActivo(a) === null && !a.datos.has(va.CLAVE_VIDEO_ACTIVO), 'olvidar borra la clave');
  a.datos.set(va.CLAVE_VIDEO_ACTIVO, '{no es json');
  comprobar(va.leerVideoActivo(a) === null, 'JSON roto se lee como «nada», sin lanzar');
  a.datos.set(va.CLAVE_VIDEO_ACTIVO, JSON.stringify({ tipo: 'youtube', clave: 'a', url: 'u', segundo: 8 }));
  comprobar(va.leerVideoActivo(a)?.segundo === 8, 'un JSON válido se lee');
}

// ── Almacenamiento bloqueado (modo privado, cuota llena) ──────────────────
{
  const roto = almacenFalso({ roto: true });
  let lanzo = false;
  try {
    comprobar(va.leerVideoActivo(roto) === null, 'leer con el almacenamiento roto devuelve null');
    comprobar(va.guardarVideoActivo({ tipo: 'youtube', clave: 'a', url: 'u' }, roto) === false, 'guardar con el almacenamiento roto devuelve false');
    va.olvidarVideoActivo(roto);
  } catch (_) { lanzo = true; }
  comprobar(!lanzo, 'ninguna función lanza con el almacenamiento roto');
  comprobar(va.leerVideoActivo(null) === null && va.guardarVideoActivo({ tipo: 'youtube', clave: 'a', url: 'u' }, null) === false, 'sin almacenamiento (null) tampoco lanza');
}

// ── Reloj ─────────────────────────────────────────────────────────────────
{
  comprobar(va.formatoReloj(754) === '12:34', '754 s = 12:34');
  comprobar(va.formatoReloj(5) === '0:05', '5 s = 0:05');
  comprobar(va.formatoReloj(3725) === '1:02:05', '3725 s = 1:02:05');
  comprobar(va.formatoReloj(-3) === '0:00' && va.formatoReloj('x') === '0:00' && va.formatoReloj(NaN) === '0:00', 'valores raros no rompen el reloj');
}

console.log(`\n${ok} comprobaciones OK · ${fallos} fallos`);
if (fallos) process.exit(1);
