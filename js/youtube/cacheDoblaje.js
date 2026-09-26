/**
 * Caché por video en IndexedDB (base propia `jg_youtube`, aparte de la biblioteca de PDF).
 *
 * Guarda lo que costó conseguir: el texto con tiempos (créditos de Supadata), el
 * idioma decidido y cada traducción (llamadas a la IA). Reabrir el mismo video no
 * gasta nada y retoma donde ibas (auditoría H23). No guarda audios: pesan mucho y
 * se regeneran en segundos. La versión de la base solo sube (TRAMPAS §7.2). Todo
 * falla hacia «no hay caché»: en modo privado la app funciona igual.
 */
const BASE = 'jg_youtube';
const VERSION = 1;
const ALMACEN = 'doblajes';
export const MAX_VIDEOS = 20;

function abrir() {
  return new Promise((resolver, rechazar) => {
    if (!globalThis.indexedDB) { rechazar(new Error('Sin IndexedDB')); return; }
    const pedido = indexedDB.open(BASE, VERSION);
    pedido.onupgradeneeded = () => {
      const db = pedido.result;
      if (!db.objectStoreNames.contains(ALMACEN)) db.createObjectStore(ALMACEN, { keyPath: 'videoId' });
    };
    pedido.onsuccess = () => resolver(pedido.result);
    pedido.onerror = () => rechazar(pedido.error);
    pedido.onblocked = () => rechazar(new Error('La base de YouTube está bloqueada por otra pestaña.'));
  });
}

async function operar(modo, trabajo) {
  const db = await abrir();
  try {
    return await new Promise((resolver, rechazar) => {
      const tx = db.transaction(ALMACEN, modo);
      const pedido = trabajo(tx.objectStore(ALMACEN));
      tx.oncomplete = () => resolver(pedido ? pedido.result : undefined);
      tx.onerror = () => rechazar(tx.error);
      tx.onabort = () => rechazar(tx.error);
    });
  } finally {
    db.close();
  }
}

export async function leerDoblaje(videoId) {
  try { return (await operar('readonly', (almacen) => almacen.get(videoId))) || null; } catch (_) { return null; }
}

export async function guardarDoblaje(registro) {
  try {
    await operar('readwrite', (almacen) => almacen.put({ ...registro, actualizado: Date.now() }));
    await podar();
    return true;
  } catch (_) {
    return false;
  }
}

/** Deja solo los `max` videos más recientes. */
export async function podar(max = MAX_VIDEOS) {
  try {
    const todos = (await operar('readonly', (almacen) => almacen.getAll())) || [];
    const sobran = todos.sort((a, b) => (b.actualizado || 0) - (a.actualizado || 0)).slice(max);
    if (sobran.length) await operar('readwrite', (almacen) => { sobran.forEach((r) => almacen.delete(r.videoId)); return null; });
  } catch (_) { /* sin caché no pasa nada */ }
}
