/* JG Turbo · Manifiesto compacto de límites y migración a la versión actual
 *
 * Los campos nuevos viven en los almacenes existentes. No se sube la versión
 * de IndexedDB. Un documento irrecuperable se marca needs_source: no se finge
 * una corrección. Una cola v1 completa no equivale por sí sola a contenido
 * íntegro: los libros existentes se revalidan desde su fuente.
 */
import { VERSION_RECONSTRUCCION, VERSION_TROCEO, reconstruirDesdeAtomos } from './reconstruccion.js';
import { expandirManifiesto, contarPendientes, VERSION_LIMITES } from './limites.js';
import { VERSION_FIDELIDAD } from './fidelidad.js';

export { VERSION_RECONSTRUCCION, VERSION_TROCEO, VERSION_LIMITES, VERSION_FIDELIDAD };

export function serializarReconstruccion(resultado) {
  if (!resultado) return null;
  return {
    versionReconstruccion: VERSION_RECONSTRUCCION,
    versionTroceo: VERSION_TROCEO,
    versionLimites: VERSION_LIMITES,
    versionFidelidad: VERSION_FIDELIDAD,
    pendientes: Number(resultado.pendientes) || 0,
    listoParaLectura: resultado.pendientes === 0,
    textoCanonico: String(resultado.textoCanonico ?? resultado.texto ?? ''),
    manifiesto: resultado.manifiesto || [],
    atomos: resultado.atomos || [],
    atomosTodos: resultado.atomosTodos || resultado.fragmentosFuente || [],
    fragmentosFuente: resultado.fragmentosFuente || [],
    transformaciones: resultado.transformaciones || [],
    estructura: resultado.estructura || [],
    calidadPorPagina: resultado.calidadPorPagina || [],
    estadoFidelidad: resultado.estadoFidelidad || null,
    omisiones: resultado.omisiones || [],
    paginas: resultado.paginas || [],
    offsets: [...(resultado.offsetDeAtomo || new Map())],
    bloques: (resultado.bloquesLectura || resultado.bloques || []).map((b) => ({
      id: b.id,
      type: b.type || b.tipo,
      pageStart: b.pageStart ?? b.pagina,
      pageEnd: b.pageEnd ?? b.pagina,
      atomStart: b.atomStart,
      atomEnd: b.atomEnd,
      boundaryIds: b.boundaryIds || [],
      continuation: Boolean(b.continuation),
    })),
  };
}

export function manifiestoSuficiente(manifiesto) {
  if (!Array.isArray(manifiesto) || !manifiesto.length) return false;
  return manifiesto.every((l) => l && l.id && (l.la || l.leftAtomId) && (l.ra || l.rightAtomId));
}

/**
 * Qué hacer con un documento guardado antes de la versión actual.
 *
 * @returns {{accion:'reextraer'|'reconstruir'|'needs_source'|'capa_nueva'|'nada', needsSource?:boolean, motivo:string}}
 */
export function planMigracionV8(doc = {}) {
  const version = Number(doc.versionReconstruccion || doc.versionTroceo || 0);
  const tienePdf = Boolean(doc.tieneArchivo || doc.pdf);
  const aprobado = Boolean(doc.tieneAprobado || doc.textoAprobado || doc.capaAprobado);

  if (version >= VERSION_RECONSTRUCCION) {
    return { accion: 'nada', motivo: 'version_actual' };
  }
  if (tienePdf) {
    if (aprobado) return { accion: 'capa_nueva', motivo: 'edicion_aprobada_con_pdf' };
    return { accion: 'reextraer', motivo: 'pdf_local' };
  }
  return {
    accion: 'needs_source',
    needsSource: true,
    motivo: 'sin_pdf_ni_manifiesto',
  };
}

export function planMigracionV6(doc = {}) {
  return planMigracionV8(doc);
}

export function planMigracionV7(doc = {}) {
  return planMigracionV8(doc);
}

export function reconstruirDesdeManifiesto({ atomos, manifiesto, decisiones, lang = 'es', paginas = [] }) {
  const limites = expandirManifiesto(manifiesto);
  return reconstruirDesdeAtomos(atomos, {
    paginas,
    lang,
    decisionesIA: decisiones || limites.filter((l) => l.source === 'ai' || l.source === 'user').map((l) => ({
      boundaryId: l.id,
      action: l.decision,
    })),
  });
}

export function marcarNeedsSource(meta) {
  return {
    ...meta,
    needsSource: true,
    pendientesLimites: Number(meta.pendientesLimites) || 0,
    versionReconstruccion: Number(meta.versionReconstruccion) || 0,
    listoParaLectura: false,
    avisoFuente: 'Necesita reimportar el PDF o una revisión manual de los límites pendientes.',
  };
}

export function camposSyncDocumento(meta = {}) {
  return {
    versionReconstruccion: meta.versionReconstruccion ?? VERSION_RECONSTRUCCION,
    versionTroceo: meta.versionTroceo ?? VERSION_TROCEO,
    pendientesLimites: meta.pendientesLimites ?? 0,
    needsSource: Boolean(meta.needsSource),
    listoParaLectura: meta.listoParaLectura !== false && !meta.needsSource && !(meta.pendientesLimites > 0),
    versionFidelidad: meta.versionFidelidad ?? VERSION_FIDELIDAD,
    estadoFidelidad: meta.estadoFidelidad || (meta.needsSource ? 'legacy_no_verificable' : 'pendiente_revision'),
    paginasVerificadas: Array.isArray(meta.paginasVerificadas) ? meta.paginasVerificadas.slice() : [],
  };
}

export function camposSyncParte(parte = {}) {
  return {
    atomStart: parte.atomStart || null,
    atomEnd: parte.atomEnd || null,
    boundaryIds: Array.isArray(parte.boundaryIds) ? parte.boundaryIds : [],
    continuation: Boolean(parte.continuation),
    anclaInicio: parte.anclaInicio || null,
    anclaFin: parte.anclaFin || null,
  };
}

export { contarPendientes };

/* ── Corrección portable entre dispositivos ──────────────────────────
 *
 * El manifiesto compacto ya trae por cada corte su decisión y los dos
 * fragmentos (lf/rf): es todo lo que el otro aparato necesita para confiar
 * en lo corregido sin tener el PDF. Este paquete viaja dentro de
 * `datos.correccion` (JSON opaco: el servidor lo guarda sin entenderlo, así
 * que no hace falta migrar la base). La geometría (átomos) NO viaja: pesa
 * demasiado y para leer, escuchar y revisar no hace falta.
 */
export const VERSION_CORRECCION_SYNC = 1;
/* Techo del paquete: un libro típico trae manifiesto de decenas de KB; con
 * este techo un libro enorme se trunca con aviso en vez de tumbar la subida. */
export const MAX_CORRECCION_SYNC_BYTES = 400000;

function tamanoAprox(valor) {
  try {
    return JSON.stringify(valor)?.length || 0;
  } catch (_) {
    return Infinity;
  }
}

/**
 * Arma el paquete portable a partir del manifiesto compacto guardado.
 * Prioriza lo decidido por la persona; si hay que truncar, se avisa con
 * `truncado: true` en vez de fallar en silencio.
 */
export function paqueteCorreccionSync(manifiestoCompacto, meta = {}) {
  const lista = (Array.isArray(manifiestoCompacto) ? manifiestoCompacto : [])
    .filter((l) => l && (l.id || l.la || l.ra));
  const esPendiente = (l) => {
    const d = l.d || l.decision || 'pending';
    return d === 'pending';
  };
  const decididos = lista.filter((l) => !esPendiente(l));
  const pendientes = lista.filter(esPendiente);
  const base = {
    v: VERSION_CORRECCION_SYNC,
    pendientes: Number(meta.pendientesLimites),
    ver: {
      rec: Number(meta.versionReconstruccion) || VERSION_RECONSTRUCCION,
      tro: Number(meta.versionTroceo) || VERSION_TROCEO,
      lim: VERSION_LIMITES,
      fid: Number(meta.versionFidelidad) ?? VERSION_FIDELIDAD,
    },
    manifiesto: [],
    truncado: false,
  };
  if (!Number.isFinite(base.pendientes)) {
    base.pendientes = contarPendientes(expandirManifiesto(lista));
  }
  /* Primero lo decidido (es lo que evita repetir trabajo), luego pendientes. */
  const elegidos = [];
  for (const grupo of [decididos, pendientes]) {
    for (const l of grupo) {
      elegidos.push(l);
      base.manifiesto = elegidos;
      if (tamanoAprox(base) > MAX_CORRECCION_SYNC_BYTES) {
        elegidos.pop();
        base.manifiesto = elegidos;
        base.truncado = true;
        return base;
      }
    }
  }
  base.manifiesto = elegidos;
  return base;
}

/** ¿Este paquete sirve para confiar sin pedir el PDF? */
export function correccionSyncValida(correccion) {
  if (!correccion || typeof correccion !== 'object') return false;
  if (correccion.v !== VERSION_CORRECCION_SYNC) return false;
  if (!Array.isArray(correccion.manifiesto)) return false;
  return manifiestoSuficiente(correccion.manifiesto);
}

/**
 * Estado de revisión a partir de los límites cargados (ya expandidos).
 * 'revisado' solo cuando SE SABE que no hay pendientes; 'desconocido' cuando
 * no hay límites cargados (libro viejo sin manifiesto): ahí no se puede
 * prometer nada y se sigue el camino de antes.
 * Pura y con pruebas.
 */
export function estadoRevisionCortes(limitesExpandidos) {
  if (!Array.isArray(limitesExpandidos) || !limitesExpandidos.length) return 'desconocido';
  return contarPendientes(limitesExpandidos) === 0 ? 'revisado' : 'pendientes';
}

/**
 * Decide si el aparato que NO tiene el PDF puede confiar en la corrección
 * que llegó por sincronización, en vez de pedir el archivo original.
 * Pura y con pruebas: aquí no se toca ningún almacén.
 */
export function confiarEnCorreccionSync(doc = {}, correccion = null) {
  if (!correccionSyncValida(correccion)) {
    return { confiar: false, motivo: 'manifiesto_insuficiente' };
  }
  const ver = correccion.ver || {};
  if (Number(ver.rec || 0) < VERSION_RECONSTRUCCION) {
    return { confiar: false, motivo: 'version_anterior' };
  }
  if (doc && doc.tieneArchivo) {
    return { confiar: true, motivo: 'con_archivo_local' };
  }
  return { confiar: true, motivo: 'correccion_sincronizada' };
}
