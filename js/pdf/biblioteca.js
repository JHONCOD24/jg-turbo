/* JG Turbo · Biblioteca de documentos
 *
 * Guarda en el propio dispositivo, dentro del navegador (IndexedDB), todo lo
 * que hace falta para que un libro no haya que volver a subirlo nunca:
 * el PDF original, su texto ya limpio, su portada, su traducción y por dónde
 * ibas leyendo. Sin tope de documentos y sin que nada salga a internet.
 *
 * Está partido en cuatro almacenes a propósito:
 *   documentos   → lo ligero (título, capítulos, progreso). Es lo único que se
 *                  lee para pintar la biblioteca: con 200 libros sigue siendo
 *                  instantánea.
 *   contenido    → el texto por capítulos. Solo se carga al abrir un libro.
 *   archivos     → el PDF original y la portada. Solo cuando hacen falta.
 *   traducciones → el español de cada capítulo, para no pagarlo dos veces.
 */
import { progresoInicial, calcularPorcentaje, estadoDeLectura } from './progreso.js';

const BASE = 'jg-turbo-pdf';
/* Versión 5: compatibilidad hacia adelante. Encontramos dispositivos cuya base
 * ya está en 5 (un despliegue anterior la subió) mientras el código pedía 4:
 * IndexedDB se niega a abrir una base más nueva («requested version (4) is
 * less than the existing version (5)») y la biblioteca aparece vacía aunque
 * los libros están intactos. Subir a 5 la vuelve a abrir.
 *
 * La migración es aditiva a propósito: `onupgradeneeded` solo CREA los
 * almacenes que falten, jamás borra ni reescribe datos. Pasar de 4 a 5 no
 * cambia ni un registro; abrir una base que ya es 5 no migra nada. */
const VERSION = 5;
const DOCUMENTOS = 'documentos';
const CONTENIDO = 'contenido';
const ARCHIVOS = 'archivos';
const TRADUCCIONES = 'traducciones';
const PULIDOS = 'pulidos';
const AUDITORIA_BLOQUES = 'auditoria_bloques';
const AUDITORIA_PROG = 'auditoria_prog';
/* Almacén de la versión 1, que se migra y se abandona. */
const VIEJO = 'libros';

let conexion = null;

/* ── Apertura y migración ──────────────────────────────────────────── */

function abrir() {
  if (conexion) return conexion;
  conexion = new Promise((resolver, rechazar) => {
    if (!('indexedDB' in globalThis)) {
      rechazar(new Error('Este navegador no permite guardar la biblioteca.'));
      return;
    }
    const peticion = indexedDB.open(BASE, VERSION);

    peticion.onupgradeneeded = (evento) => {
      const bd = peticion.result;
      const tx = peticion.transaction;

      if (!bd.objectStoreNames.contains(DOCUMENTOS)) {
        const docs = bd.createObjectStore(DOCUMENTOS, { keyPath: 'id' });
        docs.createIndex('actualizado', 'actualizado');
        docs.createIndex('estado', 'estado');
      }
      if (!bd.objectStoreNames.contains(CONTENIDO)) bd.createObjectStore(CONTENIDO, { keyPath: 'id' });
      if (!bd.objectStoreNames.contains(ARCHIVOS)) bd.createObjectStore(ARCHIVOS, { keyPath: 'id' });
      if (!bd.objectStoreNames.contains(TRADUCCIONES)) bd.createObjectStore(TRADUCCIONES, { keyPath: 'clave' });
      if (!bd.objectStoreNames.contains(PULIDOS)) bd.createObjectStore(PULIDOS, { keyPath: 'clave' });
      if (!bd.objectStoreNames.contains(AUDITORIA_BLOQUES)) bd.createObjectStore(AUDITORIA_BLOQUES, { keyPath: 'clave' });
      if (!bd.objectStoreNames.contains(AUDITORIA_PROG)) bd.createObjectStore(AUDITORIA_PROG, { keyPath: 'clave' });

      /* Migración desde la versión 1: los libros que ya tenía el usuario no se
       * pierden. Solo había texto, así que quedan sin PDF ni portada. */
      if (evento.oldVersion < 2 && bd.objectStoreNames.contains(VIEJO)) {
        try {
          const viejos = tx.objectStore(VIEJO);
          const docs = tx.objectStore(DOCUMENTOS);
          const contenido = tx.objectStore(CONTENIDO);
          viejos.openCursor().onsuccess = (e) => {
            const cursor = e.target.result;
            if (!cursor) return;
            const libro = cursor.value || {};
            const partes = [{
              titulo: 'Documento completo',
              texto: String(libro.texto || ''),
              pagina: 1,
            }];
            docs.put({
              id: libro.id,
              titulo: libro.titulo || libro.nombre || 'Documento',
              nombreArchivo: libro.nombre || '',
              idioma: 'es',
              totalPaginas: libro.totalPaginas || 0,
              paginasLeidas: libro.paginasLeidas || 0,
              origen: libro.origen || 'texto',
              capitulos: Array.isArray(libro.capitulos) ? libro.capitulos : [],
              titulosPartes: ['Documento completo'],
              caracteres: String(libro.texto || '').length,
              bytes: 0,
              tieneArchivo: false,
              tienePortada: false,
              progreso: progresoInicial(),
              estado: 'sin-empezar',
              creado: libro.actualizado || Date.now(),
              actualizado: libro.actualizado || Date.now(),
            });
            contenido.put({ id: libro.id, partes });
            cursor.continue();
          };
        } catch (error) {
          console.warn('[jg-biblioteca] no se pudo migrar la biblioteca vieja', error);
        }
      }
    };

    peticion.onsuccess = () => resolver(peticion.result);
    peticion.onerror = () => {
      const original = peticion.error;
      /* Si algún día la base vuelve a ser más nueva que el código, decirlo en
       * palabras en vez del inglés críptico de IndexedDB. */
      if (original && original.name === 'VersionError') {
        rechazar(new Error('Tu biblioteca es más nueva que esta versión de la app. Recarga la página para actualizarla y vuelve a intentarlo.'));
        return;
      }
      rechazar(original || new Error('No se pudo abrir la biblioteca.'));
    };
    peticion.onblocked = () => rechazar(new Error('Cierra las otras pestañas de JG Turbo para actualizar la biblioteca.'));
  }).catch((error) => {
    conexion = null;
    throw error;
  });
  return conexion;
}

function esperar(peticion) {
  return new Promise((resolver, rechazar) => {
    peticion.onsuccess = () => resolver(peticion.result);
    peticion.onerror = () => rechazar(peticion.error);
  });
}

async function conAlmacenes(nombres, modo, trabajo) {
  const bd = await abrir();
  return new Promise((resolver, rechazar) => {
    const tx = bd.transaction(nombres, modo);
    let resultado;
    tx.oncomplete = () => resolver(resultado);
    tx.onerror = () => rechazar(tx.error);
    tx.onabort = () => rechazar(tx.error || new Error('La operación se canceló.'));
    Promise.resolve(trabajo(...nombres.map((n) => tx.objectStore(n))))
      .then((valor) => { resultado = valor; })
      .catch((error) => { try { tx.abort(); } catch (_) { /* ya abortada */ } rechazar(error); });
  });
}

/* ── Espacio en el dispositivo ─────────────────────────────────────── */

/** Pide al navegador que NO borre la biblioteca cuando ande escaso de espacio. */
export async function pedirPersistencia() {
  try {
    if (!navigator.storage?.persist) return { soportado: false, concedido: false };
    const yaEs = await navigator.storage.persisted?.();
    if (yaEs) return { soportado: true, concedido: true };
    const concedido = await navigator.storage.persist();
    return { soportado: true, concedido };
  } catch (_) {
    return { soportado: false, concedido: false };
  }
}

/** Cuánto ocupa la biblioteca y cuánto permite este dispositivo. */
export async function espacioUsado() {
  try {
    if (!navigator.storage?.estimate) return null;
    const { usage = 0, quota = 0 } = await navigator.storage.estimate();
    const persistente = await navigator.storage.persisted?.().catch(() => false);
    return {
      usado: usage,
      total: quota,
      porcentaje: quota ? Math.min(100, Math.round((usage / quota) * 100)) : 0,
      persistente: Boolean(persistente),
    };
  } catch (_) {
    return null;
  }
}

/* ── Guardar y leer documentos ─────────────────────────────────────── */

/**
 * Guarda un documento completo. `partes`, `pdf` y `portada` son opcionales:
 * si no vienen, se conserva lo que ya hubiera guardado.
 */
export async function guardarDocumento({ meta, partes, pdf, portada }) {
  if (!meta || !meta.id) throw new Error('Falta el identificador del documento.');
  const ahora = Date.now();

  const almacenes = [DOCUMENTOS];
  if (partes) almacenes.push(CONTENIDO);
  if (pdf || portada) almacenes.push(ARCHIVOS);

  try {
    return await conAlmacenes(almacenes, 'readwrite', async (docs, ...resto) => {
      const previo = (await esperar(docs.get(meta.id))) || {};
      const registro = {
        ...previo,
        ...meta,
        titulosPartes: partes ? partes.map((p) => p.titulo) : (meta.titulosPartes || previo.titulosPartes || []),
        caracteres: partes
          ? partes.reduce((suma, p) => suma + String(p.texto || '').length, 0)
          : (meta.caracteres || previo.caracteres || 0),
        tieneArchivo: pdf ? true : Boolean(previo.tieneArchivo),
        tienePortada: portada ? true : Boolean(previo.tienePortada),
        progreso: meta.progreso || previo.progreso || progresoInicial(),
        estado: meta.estado || previo.estado || 'sin-empezar',
        creado: previo.creado || meta.creado || ahora,
        actualizado: meta.actualizado || ahora,
        /* Momento en que cambió el TEXTO (no la lectura). Guardar un documento
         * siempre implica contenido nuevo o editado. */
        contenidoActualizado: meta.contenidoActualizado || meta.actualizado || ahora,
        sincronizado: meta.sincronizado !== undefined ? meta.sincronizado : (previo.sincronizado || 0),
      };
      await esperar(docs.put(registro));

      let i = 0;
      if (partes) {
        await esperar(resto[i].put({ id: meta.id, partes }));
        i += 1;
      }
      if (pdf || portada) {
        const almacenArchivos = resto[i];
        const antes = (await esperar(almacenArchivos.get(meta.id))) || { id: meta.id };
        await esperar(almacenArchivos.put({
          id: meta.id,
          pdf: pdf || antes.pdf || null,
          portada: portada || antes.portada || null,
        }));
      }
      return registro;
    });
  } catch (error) {
    if (error && /quota|QuotaExceeded/i.test(String(error.name || error.message))) {
      throw new Error(
        'No queda espacio en el navegador para guardar este documento. ' +
        'Borra algún libro de la biblioteca y vuelve a intentarlo.'
      );
    }
    throw error;
  }
}

/** Lista para pintar la biblioteca: metadatos, sin el texto ni el PDF. */
export async function listarDocumentos() {
  try {
    const todos = await conAlmacenes([DOCUMENTOS], 'readonly', (docs) => esperar(docs.getAll()));
    return (todos || [])
      /* Los borrados se conservan como una marca para que el borrado llegue a
       * los otros dispositivos; en la biblioteca no se muestran. */
      .filter((doc) => !doc.borrado)
      .sort((a, b) => (b.actualizado || 0) - (a.actualizado || 0));
  } catch (_) {
    return [];
  }
}

export async function cargarDocumento(id) {
  try {
    return (await conAlmacenes([DOCUMENTOS], 'readonly', (docs) => esperar(docs.get(id)))) || null;
  } catch (_) {
    return null;
  }
}

/** El texto por capítulos. Se carga solo al abrir el documento. */
export async function cargarContenido(id) {
  try {
    const fila = await conAlmacenes([CONTENIDO], 'readonly', (c) => esperar(c.get(id)));
    return fila?.partes || null;
  } catch (_) {
    return null;
  }
}

/** El PDF original, para reprocesar o aplicar OCR sin volver a buscarlo. */
export async function cargarArchivo(id) {
  try {
    const fila = await conAlmacenes([ARCHIVOS], 'readonly', (a) => esperar(a.get(id)));
    return fila?.pdf || null;
  } catch (_) {
    return null;
  }
}

export async function cargarPortada(id) {
  try {
    const fila = await conAlmacenes([ARCHIVOS], 'readonly', (a) => esperar(a.get(id)));
    return fila?.portada || null;
  } catch (_) {
    return null;
  }
}

/* ── Progreso ──────────────────────────────────────────────────────── */

/**
 * Guarda por dónde va la lectura. Es la operación más frecuente de todas
 * (ocurre mientras se lee), así que solo toca el registro ligero.
 */
export async function guardarProgreso(id, progreso, partes) {
  try {
    return await conAlmacenes([DOCUMENTOS], 'readwrite', async (docs) => {
      const doc = await esperar(docs.get(id));
      if (!doc) return false;
      doc.progreso = progreso;
      /* El estado se recalcula aquí para que la biblioteca no tenga que
       * abrir cada libro para saber si está terminado. */
      if (partes) doc.estado = estadoDeLectura(calcularPorcentaje(progreso, partes));
      doc.actualizado = Date.now();
      /* `contenidoActualizado` NO se toca: leer no cambia el libro. Gracias a
       * esto la sincronización manda solo el registro ligero (unos bytes) en
       * vez de los capítulos enteros. */
      await esperar(docs.put(doc));
      return true;
    });
  } catch (_) {
    return false;
  }
}

/** Vuelve el documento al principio, sin borrar nada de lo guardado. */
export async function reiniciarDocumento(id) {
  try {
    return await conAlmacenes([DOCUMENTOS], 'readwrite', async (docs) => {
      const doc = await esperar(docs.get(id));
      if (!doc) return false;
      doc.progreso = progresoInicial();
      doc.estado = 'sin-empezar';
      doc.actualizado = Date.now();
      await esperar(docs.put(doc));
      return true;
    });
  } catch (_) {
    return false;
  }
}

/** El documento que se estaba leyendo, para ofrecer «seguir leyendo». */
export async function ultimoEnCurso() {
  const todos = await listarDocumentos();
  return todos.find((d) => d.estado === 'leyendo') || todos[0] || null;
}

/* ── Traducciones ──────────────────────────────────────────────────── */

const claveTraduccion = (id, idioma, indice) => `${id}|${idioma}|${indice}`;

/**
 * Marca que el TEXTO del documento cambió (traducción o pulido nuevo, edición
 * manual). Sin esto, la sincronización creería que solo avanzó la lectura y
 * mandaría únicamente el registro ligero: lo traducido no llegaría jamás al
 * otro dispositivo.
 *
 * Se marca `actualizado` además de `contenidoActualizado` para que el
 * documento sea elegido al sincronizar; si solo se marcara el contenido, nada
 * lo seleccionaría y la marca no serviría.
 */
export async function tocarContenido(id) {
  if (!id) return false;
  try {
    return await conAlmacenes([DOCUMENTOS], 'readwrite', async (docs) => {
      const doc = await esperar(docs.get(id));
      if (!doc) return false;
      const ahora = Date.now();
      doc.actualizado = ahora;
      doc.contenidoActualizado = ahora;
      await esperar(docs.put(doc));
      return true;
    });
  } catch (_) {
    return false;
  }
}

export async function guardarTraduccion(id, idioma, indice, texto, { marcar = true } = {}) {
  try {
    await conAlmacenes([TRADUCCIONES], 'readwrite', (t) => esperar(t.put({
      clave: claveTraduccion(id, idioma, indice),
      id, idioma, indice, texto,
      actualizado: Date.now(),
    })));
    /* Lo importado desde la nube (marcar:false) no se marca: ya viene de allá
     * y marcarlo provocaría que los dos aparatos se reenviaran lo mismo sin fin. */
    if (marcar) await tocarContenido(id);
    return true;
  } catch (_) {
    return false;
  }
}

export async function cargarTraduccion(id, idioma, indice) {
  try {
    const fila = await conAlmacenes([TRADUCCIONES], 'readonly',
      (t) => esperar(t.get(claveTraduccion(id, idioma, indice))));
    return fila?.texto || null;
  } catch (_) {
    return null;
  }
}

/** Qué capítulos de este documento ya están traducidos (para el índice). */
export async function traduccionesDe(id, idioma) {
  try {
    const todas = await conAlmacenes([TRADUCCIONES], 'readonly', (t) => esperar(t.getAll()));
    return new Set((todas || [])
      .filter((f) => f.id === id && f.idioma === idioma)
      .map((f) => f.indice));
  } catch (_) {
    return new Set();
  }
}

/* ── Pulidos (legado v3) + auditoría v4 ─────────────────────────── */

const clavePulido = (id, indice) => `${id}|${indice}`;

export async function guardarPulido(id, indice, texto, { marcar = true } = {}) {
  try {
    await conAlmacenes([PULIDOS], 'readwrite', (t) => esperar(t.put({
      clave: clavePulido(id, indice),
      id, indice, texto,
      actualizado: Date.now(),
      version: 4,
      huellaOrigen: '',
      estado: 'legado',
    })));
    if (marcar) await tocarContenido(id);
    return true;
  } catch (_) {
    return false;
  }
}

export async function guardarPulidoEstructurado(id, indice, registro, { marcar = true } = {}) {
  // registro: { version, huellaOrigen, estado, progreso, textoSeguro, propuestas, decisiones, textoAprobado, advertencias, actualizado }
  try {
    await conAlmacenes([PULIDOS], 'readwrite', (t) => esperar(t.put({
      clave: clavePulido(id, indice),
      id, indice,
      ...registro,
      texto: registro.textoAprobado || registro.textoSeguro || '',
      actualizado: registro.actualizado || Date.now(),
    })));
    if (marcar) await tocarContenido(id);
    return true;
  } catch (_) { return false; }
}

export async function cargarPulido(id, indice) {
  try {
    const fila = await conAlmacenes([PULIDOS], 'readonly',
      (t) => esperar(t.get(clavePulido(id, indice))));
    return fila?.texto || fila?.textoAprobado || fila?.textoSeguro || null;
  } catch (_) {
    return null;
  }
}

export async function cargarPulidoRegistro(id, indice) {
  try {
    const fila = await conAlmacenes([PULIDOS], 'readonly', (t) => esperar(t.get(clavePulido(id, indice))));
    return fila || null;
  } catch (_) { return null; }
}

/** Qué capítulos de este documento ya están pulidos (para el índice/controlador). */
export async function pulidosDe(id) {
  try {
    const todas = await conAlmacenes([PULIDOS], 'readonly', (t) => esperar(t.getAll()));
    return new Set((todas || [])
      .filter((f) => f.id === id)
      .map((f) => f.indice));
  } catch (_) {
    return new Set();
  }
}

// ── Auditoría por bloques (nuevo) ──
const claveAuditoria = (docId, bloqueId) => `${docId}|${bloqueId}`;
export async function guardarBloqueAuditoria(docId, bloqueId, datos) {
  try {
    await conAlmacenes([AUDITORIA_BLOQUES], 'readwrite', (t) => esperar(t.put({
      clave: claveAuditoria(docId, bloqueId),
      docId, bloqueId, ...datos, actualizado: Date.now(),
    })));
    return true;
  } catch (_) { return false; }
}
export async function cargarBloqueAuditoria(docId, bloqueId) {
  try {
    const fila = await conAlmacenes([AUDITORIA_BLOQUES], 'readonly', (t) => esperar(t.get(claveAuditoria(docId, bloqueId))));
    return fila || null;
  } catch (_) { return null; }
}
export async function listarAuditoriaDoc(docId) {
  try {
    const todas = await conAlmacenes([AUDITORIA_BLOQUES], 'readonly', (t) => esperar(t.getAll()));
    return (todas || []).filter((f) => f.docId === docId);
  } catch (_) { return []; }
}
export async function guardarProgresoAuditoria(docId, clave, estado) {
  try {
    await conAlmacenes([AUDITORIA_PROG], 'readwrite', (t) => esperar(t.put({
      clave: `${docId}|${clave}`, docId, bloqueId: clave, estado, actualizado: Date.now(),
    })));
    return true;
  } catch (_) { return false; }
}
export async function cargarProgresoAuditoria(docId) {
  try {
    const todas = await conAlmacenes([AUDITORIA_PROG], 'readonly', (t) => esperar(t.getAll()));
    return (todas || []).filter((f) => f.docId === docId);
  } catch (_) { return []; }
}
export async function revalidarPulidosAntiguos(docId, fuenteHuella) {
  try {
    const todas = await conAlmacenes([PULIDOS], 'readonly', (t) => esperar(t.getAll()));
    const delDoc = (todas || []).filter((f) => f.id === docId);
    for (const fila of delDoc) {
      if (fila.huellaOrigen && fila.huellaOrigen !== fuenteHuella) {
        // marcar legado no auto-usable
        await conAlmacenes([PULIDOS], 'readwrite', (t) => esperar(t.put({ ...fila, estado: 'legado', version: fila.version || 3 })));
      }
    }
    return true;
  } catch (_) { return false; }
}

/* ── Bloques de auditoría del documento (para reanudar tras recargar) ──
 * Viven en «contenido» con una clave aparte: así la biblioteca sigue leyendo
 * solo metadatos ligeros y esto solo se carga al abrir el libro. */
export async function guardarBloquesDocumento(docId, bloques) {
  try {
    await conAlmacenes([CONTENIDO], 'readwrite', (c) => esperar(c.put({
      id: `bloques|${docId}`,
      bloques: (bloques || []).map((b) => ({ id: b.id, texto: b.texto, tipo: b.tipo, capitulo: b.capitulo })),
    })));
    return true;
  } catch (_) { return false; }
}

export async function cargarBloquesDocumento(docId) {
  try {
    const fila = await conAlmacenes([CONTENIDO], 'readonly', (c) => esperar(c.get(`bloques|${docId}`)));
    return Array.isArray(fila?.bloques) ? fila.bloques : null;
  } catch (_) { return null; }
}

/* ── Borrar ────────────────────────────────────────────────────────── */

export async function borrarDocumento(id) {
  try {
    await conAlmacenes([DOCUMENTOS, CONTENIDO, ARCHIVOS, TRADUCCIONES, PULIDOS, AUDITORIA_BLOQUES, AUDITORIA_PROG], 'readwrite',
      async (docs, contenido, archivos, traducciones, pulidos, audBloques, audProg) => {
        /* El contenido pesado se va de verdad (el espacio se libera ya). Del
         * documento queda solo una marca de borrado: sin ella, al sincronizar
         * el otro dispositivo lo devolvería como si nada. */
        const ahora = Date.now();
        const previo = await esperar(docs.get(id));
        await esperar(docs.put({
          id,
          titulo: previo?.titulo || '',
          borrado: ahora,
          actualizado: ahora,
          sincronizado: previo?.sincronizado || 0,
        }));
        await esperar(contenido.delete(id));
        await esperar(contenido.delete(`bloques|${id}`));
        await esperar(archivos.delete(id));
        /* Las traducciones tienen clave compuesta: se buscan las de este libro. */
        const todasTrad = await esperar(traducciones.getAll());
        for (const fila of todasTrad || []) {
          if (fila.id === id) traducciones.delete(fila.clave);
        }
        /* Los pulidos también tienen clave compuesta. */
        const todosPul = await esperar(pulidos.getAll());
        for (const fila of todosPul || []) {
          if (fila.id === id) pulidos.delete(fila.clave);
        }
        const todosAud = await esperar(audBloques.getAll());
        for (const fila of todosAud || []) { if (fila.docId === id) audBloques.delete(fila.clave); }
        const todosProg = await esperar(audProg.getAll());
        for (const fila of todosProg || []) { if (fila.docId === id) audProg.delete(fila.clave); }
      });
    return true;
  } catch (_) {
    return false;
  }
}

export async function vaciarBiblioteca() {
  try {
    await conAlmacenes([DOCUMENTOS, CONTENIDO, ARCHIVOS, TRADUCCIONES, PULIDOS, AUDITORIA_BLOQUES, AUDITORIA_PROG], 'readwrite',
      async (...almacenes) => {
        for (const almacen of almacenes) await esperar(almacen.clear());
      });
    return true;
  } catch (_) {
    return false;
  }
}


/* ── Puente con la sincronización ──────────────────────────────────── */

/* Tope para una carátula viajera: una primera página en JPEG de 380 px pesa
 * decenas de KB; por encima de esto algo anda mal y no se envía. */
const MAX_BYTES_PORTADA = 1_500_000;

/**
 * Imagen ↔ texto para que la carátula pueda viajar por la sincronización
 * (que solo mueve JSON). Funciona en el navegador y en Node (pruebas).
 */
export async function blobADataURL(blob) {
  if (!blob) return null;
  const bytes = new Uint8Array(await blob.arrayBuffer());
  if (!bytes.length || bytes.length > MAX_BYTES_PORTADA) return null;
  let bin = '';
  const PASO = 8192;
  for (let i = 0; i < bytes.length; i += PASO) {
    bin += String.fromCharCode(...bytes.subarray(i, i + PASO));
  }
  return `data:${blob.type || 'image/jpeg'};base64,${btoa(bin)}`;
}

/** Inversa de `blobADataURL`. Devuelve null si no es una imagen válida. */
export async function dataURLABlob(dataURL) {
  const texto = String(dataURL || '');
  const cabe = texto.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,/);
  if (!cabe) return null;
  try {
    const bin = atob(texto.slice(cabe[0].length));
    if (!bin.length || bin.length > MAX_BYTES_PORTADA) return null;
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
    return new Blob([bytes], { type: cabe[1] });
  } catch (_) {
    return null;
  }
}

/**
 * ¿Tiene este libro carátula local que la nube aún no recibió?
 *
 * Los libros sincronizados antes de que las carátulas viajaran quedaron con
 * la imagen en el aparato y sin ella en la nube, y como ya figuran como
 * sincronizados nunca la reenviarían. Esta marca (`portadaSincronizada`,
 * solo contabilidad: no toca `actualizado`) les da un único viaje más.
 */
export async function faltaSubirPortada(id) {
  try {
    const doc = await cargarDocumento(id);
    if (!doc || doc.borrado || doc.portadaSincronizada) return false;
    const archivos = await conAlmacenes([ARCHIVOS], 'readonly', (a) => esperar(a.get(id)));
    return Boolean(archivos?.portada);
  } catch (_) {
    return false;
  }
}

/**
 * Guarda SOLO la carátula que llegó de otro aparato.
 *
 * No pasa por `guardarDocumento()` a propósito: aquí no se toca el progreso de
 * lectura, ni el título, ni las marcas de tiempo. Una carátula que llega no
 * puede hacer que este aparato «retroceda» en un libro que iba leyendo.
 *
 * @param {string} id
 * @param {string} dataURL – imagen en texto, tal como viaja
 * @returns {Promise<boolean>}
 */
export async function guardarPortadaRecibida(id, dataURL) {
  if (!id) return false;
  try {
    const portada = await dataURLABlob(dataURL);
    if (!portada) return false;
    await conAlmacenes([ARCHIVOS], 'readwrite', async (archivos) => {
      const antes = (await esperar(archivos.get(id))) || { id };
      await esperar(archivos.put({ id, pdf: antes.pdf || null, portada }));
    });
    await conAlmacenes([DOCUMENTOS], 'readwrite', async (docs) => {
      const doc = await esperar(docs.get(id));
      if (!doc) return;
      doc.tienePortada = true;
      /* Si la carátula llegó de la nube, la nube ya la tiene: no hay que
       * devolvérsela. Y `actualizado` no se toca: esto no es un cambio del
       * usuario, así que no debe competir con lo que hagan los otros aparatos. */
      doc.portadaSincronizada = Date.now();
      await esperar(docs.put(doc));
    });
    return true;
  } catch (_) {
    return false;
  }
}

/** Anota que la carátula de este libro ya está en la nube. */
export async function marcarPortadaSincronizada(id, marca = Date.now()) {
  try {
    return await conAlmacenes([DOCUMENTOS], 'readwrite', async (docs) => {
      const doc = await esperar(docs.get(id));
      if (!doc) return false;
      doc.portadaSincronizada = marca;
      await esperar(docs.put(doc));
      return true;
    });
  } catch (_) {
    return false;
  }
}

/**
 * Metadatos de todo lo que hay aquí (incluidas las marcas de borrado), sin
 * el texto: sirve para decidir qué mover, no para moverlo.
 */
export async function exportarParaSincronizar() {
  try {
    const todos = await conAlmacenes([DOCUMENTOS], 'readonly', (docs) => esperar(docs.getAll()));
    return (todos || []).map(({
      id, actualizado, contenidoActualizado, sincronizado, borrado, titulo,
      portadaSincronizada, tienePortada,
    }) => ({
      id, actualizado: actualizado || 0, contenidoActualizado: contenidoActualizado || 0,
      sincronizado: sincronizado || 0, borrado, titulo,
      /* Van aquí para que las decisiones sobre carátulas se tomen sin volver a
       * leer la base: a cuáles les falta enviarla, y a cuáles les falta
       * recibirla. */
      portadaSincronizada: portadaSincronizada || 0,
      tienePortada: Boolean(tienePortada),
    }));
  } catch (_) {
    return [];
  }
}

/**
 * Datos del documento para subirlo: título, capítulos, progreso… **sin el
 * texto**. El texto viaja aparte, capítulo a capítulo, y por eso no hay
 * límite de tamaño de libro.
 */
export async function paqueteParaSubir(id, { conPortada = false } = {}) {
  const doc = await cargarDocumento(id);
  if (!doc) return null;
  if (doc.borrado) return { id, actualizado: doc.actualizado, borrado: true, datos: null };
  const { ...meta } = doc;
  const paquete = {
    id,
    actualizado: doc.actualizado || Date.now(),
    borrado: false,
    datos: { meta },
  };
  /* La carátula solo viaja cuando viaja el contenido (libro nuevo o texto
   * cambiado): pesa decenas de KB y no tiene sentido reenviarla cada minuto
   * con el registro ligero de progreso. Quien la llama decide con
   * `necesitaSubirContenido()`. */
  if (conPortada) {
    try {
      const archivos = await conAlmacenes([ARCHIVOS], 'readonly', (a) => esperar(a.get(id)));
      const mini = await blobADataURL(archivos?.portada || null);
      if (mini) paquete.datos.portadaMini = mini;
    } catch (_) { /* sin carátula se vive: queda la inicial */ }
  }
  return paquete;
}

/** Los capítulos de un documento, cada uno con su traducción si la tiene. */
export async function partesParaSubir(id) {
  const partes = (await cargarContenido(id)) || [];
  if (!partes.length) return [];
  const traducciones = await conAlmacenes([TRADUCCIONES], 'readonly', (t) => esperar(t.getAll()))
    .catch(() => []);
  const pulidos = await conAlmacenes([PULIDOS], 'readonly', (t) => esperar(t.getAll()))
    .catch(() => []);
  const espanol = new Map(
    (traducciones || []).filter((f) => f.id === id && f.idioma === 'es')
      .map((f) => [f.indice, f.texto])
  );
  const pulidosMap = new Map(
    (pulidos || []).filter((f) => f.id === id)
      .map((f) => [f.indice, f.texto])
  );
  return partes.map((parte, indice) => ({
    indice,
    titulo: parte.titulo || '',
    texto: parte.texto || '',
    traduccion: espanol.get(indice) || null,
    pulido: pulidosMap.get(indice) || null,
    pagina: parte.pagina || null,
  }));
}

/** Guarda los DATOS de un documento que llegó de otro dispositivo. */
export async function importarDeSincronizacion(documento) {
  if (!documento || !documento.id) return false;
  const { id, datos, borrado, actualizado } = documento;

  if (borrado) {
    await borrarDocumento(id);
    await conAlmacenes([DOCUMENTOS], 'readwrite', async (docs) => {
      const previo = await esperar(docs.get(id));
      if (previo) await esperar(docs.put({ ...previo, actualizado, sincronizado: actualizado }));
    }).catch(() => {});
    return true;
  }

  const meta = datos?.meta || {};
  /* La carátula viaja como texto dentro de `datos` porque la sincronización
   * solo mueve JSON. Al llegar se vuelve imagen y se guarda con el libro:
   * así la biblioteca se ve igual en el celular, la tablet y el escritorio. */
  let portada = null;
  try {
    portada = await dataURLABlob(datos?.portadaMini || null);
  } catch (_) { portada = null; }
  await guardarDocumento({
    meta: { ...meta, id, actualizado, sincronizado: actualizado },
    ...(portada ? { portada } : {}),
  });
  /* Lo que llegó con carátula no necesita reenviarla: ya la tienen los dos. */
  if (portada) await marcarPortadaSincronizada(id, actualizado);
  return true;
}

/** Guarda los capítulos que llegaron de otro dispositivo. */
export async function importarPartes(id, partes) {
  if (!id || !Array.isArray(partes) || !partes.length) return false;
  const ordenadas = [...partes].sort((a, b) => (a.indice || 0) - (b.indice || 0));
  const doc = await cargarDocumento(id);
  const sincronizado = doc?.sincronizado || doc?.actualizado || Date.now();
  await guardarDocumento({
    meta: {
      id,
      actualizado: doc?.actualizado || sincronizado,
      sincronizado,
    },
    partes: ordenadas.map((p) => ({
      titulo: p.titulo || 'Parte',
      texto: p.texto || '',
      pagina: p.pagina || 1,
    })),
  });
  /* Lo que ya venga traducido no hay que volver a traducirlo (ni pagarlo).
   * Se importa sin marcar: ya viene de la nube y marcarlo haría que los dos
   * aparatos se reenviaran los mismos capítulos sin fin. */
  for (const parte of ordenadas) {
    if (parte.traduccion) await guardarTraduccion(id, 'es', parte.indice, parte.traduccion, { marcar: false });
    if (parte.pulido) await guardarPulido(id, parte.indice, parte.pulido, { marcar: false });
  }
  return true;
}

/** ¿Tiene este documento su texto aquí, o solo sus datos? */
export async function tieneContenido(id) {
  const partes = await cargarContenido(id);
  return Boolean(partes && partes.length);
}

/** Recuerda que este documento ya viajó, para no subirlo dos veces. */
export async function marcarSincronizado(id, marca) {
  try {
    return await conAlmacenes([DOCUMENTOS], 'readwrite', async (docs) => {
      const doc = await esperar(docs.get(id));
      if (!doc) return false;
      doc.sincronizado = marca;
      await esperar(docs.put(doc));
      return true;
    });
  } catch (_) {
    return false;
  }
}
