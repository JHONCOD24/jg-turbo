/**
 * Base IndexedDB `jg_youtube`: el doblaje de cada video y la biblioteca.
 *
 * Tres almacenes, separados a propósito (igual que la biblioteca de PDF):
 *  - `doblajes` (v1): lo pesado que costó conseguir (texto con tiempos, traducciones, posición).
 *  - `videos`   (v2): la ficha liviana de la biblioteca. Pintar la biblioteca solo lee esto.
 *  - `voces`    (v2): la voz en español ya generada, frase por frase. Es lo ÚNICO que se
 *    descarta solo (se puede regenerar): tope `PRESUPUESTO_VOCES_BYTES`, sale lo menos usado.
 *
 * Desde v2 no se poda nada que la persona organizó: antes `podar()` borraba en
 * silencio el video 21 y siguientes. La versión de la base solo sube (TRAMPAS
 * §7.2) y la migración es aditiva: crea lo que falta y copia, nunca borra. Todo
 * falla hacia «no hay caché»: en modo privado la app funciona igual.
 */
import { entradaDesdeDoblaje, fusionarEntrada } from './bibliotecaVideos.js';

const BASE = 'jg_youtube';
const VERSION = 2;
const DOBLAJES = 'doblajes';
const VIDEOS = 'videos';
const VOCES = 'voces';
export const PRESUPUESTO_VOCES_BYTES = 300 * 1024 * 1024;
const DIA_MS = 24 * 60 * 60 * 1000;

function abrir() {
  return new Promise((resolver, rechazar) => {
    if (!globalThis.indexedDB) { rechazar(new Error('Sin IndexedDB')); return; }
    const pedido = indexedDB.open(BASE, VERSION);
    pedido.onupgradeneeded = (evento) => {
      const db = pedido.result;
      const tx = pedido.transaction;
      if (!db.objectStoreNames.contains(DOBLAJES)) db.createObjectStore(DOBLAJES, { keyPath: 'videoId' });
      if (!db.objectStoreNames.contains(VIDEOS)) {
        const videos = db.createObjectStore(VIDEOS, { keyPath: 'clave' });
        videos.createIndex('abierto', 'abierto');
        // v1 → v2: cada doblaje ya guardado entra a la biblioteca con su fecha.
        if (evento.oldVersion >= 1) {
          tx.objectStore(DOBLAJES).openCursor().onsuccess = (e) => {
            const cursor = e.target.result;
            if (!cursor) return;
            if (cursor.value?.videoId) videos.put(entradaDesdeDoblaje(cursor.value));
            cursor.continue();
          };
        }
      }
      if (!db.objectStoreNames.contains(VOCES)) {
        const voces = db.createObjectStore(VOCES, { keyPath: 'clave' });
        voces.createIndex('video', 'video');
        voces.createIndex('usado', 'usado');
      }
    };
    pedido.onsuccess = () => resolver(pedido.result);
    pedido.onerror = () => rechazar(pedido.error);
    pedido.onblocked = () => rechazar(new Error('La base de videos está abierta en otra pestaña con una versión anterior. Cierra las otras pestañas de JG Turbo.'));
  });
}

async function operar(almacenes, modo, trabajo) {
  const db = await abrir();
  try {
    return await new Promise((resolver, rechazar) => {
      const tx = db.transaction(almacenes, modo);
      const nombres = Array.isArray(almacenes) ? almacenes : [almacenes];
      const tiendas = Object.fromEntries(nombres.map((n) => [n, tx.objectStore(n)]));
      const pedido = trabajo(nombres.length === 1 ? tiendas[nombres[0]] : tiendas);
      tx.oncomplete = () => resolver(pedido && 'result' in pedido ? pedido.result : pedido);
      tx.onerror = () => rechazar(tx.error);
      tx.onabort = () => rechazar(tx.error);
    });
  } finally {
    db.close();
  }
}

// ── Doblajes (lo pesado) ─────────────────────────────────────────────────

export async function leerDoblaje(videoId) {
  try { return (await operar(DOBLAJES, 'readonly', (a) => a.get(videoId))) || null; } catch (_) { return null; }
}

export async function guardarDoblaje(registro) {
  try {
    await operar(DOBLAJES, 'readwrite', (a) => a.put({ ...registro, actualizado: Date.now() }));
    return true;
  } catch (_) {
    return false;
  }
}

/** Todos los doblajes, solo para «Buscar también en lo que se dice» (bajo demanda). */
export async function listarDoblajes() {
  try { return (await operar(DOBLAJES, 'readonly', (a) => a.getAll())) || []; } catch (_) { return []; }
}

// ── Biblioteca (la ficha liviana) ────────────────────────────────────────

export async function listarVideos() {
  try { return (await operar(VIDEOS, 'readonly', (a) => a.getAll())) || []; } catch (_) { return []; }
}

export async function leerVideo(clave) {
  try { return (await operar(VIDEOS, 'readonly', (a) => a.get(clave))) || null; } catch (_) { return null; }
}

/**
 * Leer y escribir en la MISMA transacción: el guardado automático corre cada 5 s
 * mientras se ve el video; si leyera antes y escribiera después, pisaría las
 * etiquetas que la persona acaba de editar en ese intervalo.
 */
function leerYEscribir(clave, cambiar) {
  return operar(VIDEOS, 'readwrite', (a) => {
    const salida = { entrada: null };
    a.get(clave).onsuccess = (e) => {
      salida.entrada = cambiar(e.target.result || null);
      if (salida.entrada) a.put(salida.entrada);
    };
    return salida;
  }).then((s) => s.entrada);
}

/** Lo automático (título, duración, posición…): nunca pisa etiquetas ni favorito. */
export async function registrarVideo(datos) {
  if (!datos?.clave) return null;
  try { return await leerYEscribir(datos.clave, (previa) => fusionarEntrada(previa, datos)); } catch (_) { return null; }
}

/** Lo que decide la persona: `{ etiquetas }`, `{ favorito }`. */
export async function actualizarVideo(clave, cambios) {
  try {
    return await leerYEscribir(clave, (previa) => (previa ? { ...previa, ...cambios, clave, actualizado: Date.now() } : null));
  } catch (_) {
    return null;
  }
}

/**
 * Quita un video de la biblioteca con TODO lo suyo. Devuelve lo borrado para
 * que «Deshacer» lo restaure tal cual (`restaurarVideo`).
 */
export async function quitarVideo(clave) {
  try {
    return await operar([VIDEOS, DOBLAJES, VOCES], 'readwrite', (t) => {
      const copia = { video: null, doblaje: null };
      t[VIDEOS].get(clave).onsuccess = (e) => { copia.video = e.target.result || null; t[VIDEOS].delete(clave); };
      t[DOBLAJES].get(clave).onsuccess = (e) => { copia.doblaje = e.target.result || null; t[DOBLAJES].delete(clave); };
      t[VOCES].index('video').openKeyCursor(IDBKeyRange.only(clave)).onsuccess = (e) => {
        const cursor = e.target.result;
        if (!cursor) return;
        t[VOCES].delete(cursor.primaryKey);
        cursor.continue();
      };
      return copia;
    });
  } catch (_) {
    return null;
  }
}

/** Deshacer: la voz no vuelve (se regenera sola); ficha y doblaje sí, intactos. */
export async function restaurarVideo(copia) {
  if (!copia?.video) return false;
  try {
    await operar([VIDEOS, DOBLAJES], 'readwrite', (t) => {
      t[VIDEOS].put(copia.video);
      if (copia.doblaje) t[DOBLAJES].put(copia.doblaje);
      return null;
    });
    return true;
  } catch (_) {
    return false;
  }
}

// ── Voces (se regeneran: lo único que se descarta solo) ──────────────────

/** `{ blob, motor }` o null. El motor importa: la duración de Fish se mide a otro ritmo de bytes. */
export async function leerVoz(clave) {
  try {
    const registro = await operar(VOCES, 'readonly', (a) => a.get(clave));
    if (!registro?.blob) return null;
    // «Usado» solo ordena la poda: basta con anotarlo una vez al día. Hacerlo en
    // cada lectura reescribía el audio entero por cada frase que sonaba.
    if (Date.now() - (registro.usado || 0) > DIA_MS) {
      operar(VOCES, 'readwrite', (a) => a.put({ ...registro, usado: Date.now() })).catch(() => {});
    }
    return { blob: registro.blob, motor: registro.motor || '' };
  } catch (_) {
    return null;
  }
}

export async function guardarVoz(clave, video, blob, motor = '') {
  if (!(blob?.size > 0)) return false;
  try {
    await operar(VOCES, 'readwrite', (a) => a.put({ clave, video, blob, motor, bytes: blob.size, usado: Date.now() }));
    return true;
  } catch (_) {
    return false;
  }
}

/** Claves de los videos que tienen voz guardada (distintivo «Listo al instante»). Solo lee el índice. */
export async function videosConVoz() {
  try {
    return await operar(VOCES, 'readonly', (a) => {
      const claves = new Set();
      a.index('video').openKeyCursor(null, 'nextunique').onsuccess = (e) => {
        const cursor = e.target.result;
        if (!cursor) return;
        claves.add(cursor.key);
        cursor.continue();
      };
      return claves;
    });
  } catch (_) {
    return new Set();
  }
}

/** Si la voz guardada pasa del presupuesto, salen las frases menos usadas. */
export async function podarVoces(presupuesto = PRESUPUESTO_VOCES_BYTES) {
  try {
    const todas = (await operar(VOCES, 'readonly', (a) => a.getAll())) || [];
    let total = todas.reduce((s, v) => s + (v.bytes || 0), 0);
    if (total <= presupuesto) return 0;
    const sobran = [];
    for (const voz of todas.sort((a, b) => (a.usado || 0) - (b.usado || 0))) {
      if (total <= presupuesto * 0.9) break;
      sobran.push(voz.clave);
      total -= voz.bytes || 0;
    }
    await operar(VOCES, 'readwrite', (a) => { sobran.forEach((c) => a.delete(c)); return null; });
    return sobran.length;
  } catch (_) {
    return 0;
  }
}

/** Espacio usado por la app en este navegador y si el navegador prometió no borrarlo. */
export async function espacioYPersistencia() {
  try {
    const [estimado, persistente] = await Promise.all([
      navigator.storage?.estimate?.(),
      navigator.storage?.persisted?.(),
    ]);
    return { usado: estimado?.usage || 0, cuota: estimado?.quota || 0, persistente: Boolean(persistente) };
  } catch (_) {
    return { usado: 0, cuota: 0, persistente: false };
  }
}

/** Se pide al guardar el primer video: sin esto iOS borra la biblioteca tras días sin uso. */
export async function pedirPersistencia() {
  try {
    if (await navigator.storage?.persisted?.()) return true;
    return Boolean(await navigator.storage?.persist?.());
  } catch (_) {
    return false;
  }
}
