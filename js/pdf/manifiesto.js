/* JG Turbo · Manifiesto compacto de límites y migración v5 → v6
 *
 * Los campos nuevos viven en los almacenes existentes. No se sube la versión
 * de IndexedDB. Un documento irrecuperable se marca needs_source: no se finge
 * una corrección.
 */
import { VERSION_RECONSTRUCCION, VERSION_TROCEO, reconstruirDesdeAtomos } from './reconstruccion.js';
import { expandirManifiesto, contarPendientes, VERSION_LIMITES } from './limites.js';

export { VERSION_RECONSTRUCCION, VERSION_TROCEO, VERSION_LIMITES };

export function serializarReconstruccion(resultado) {
  if (!resultado) return null;
  return {
    versionReconstruccion: VERSION_RECONSTRUCCION,
    versionTroceo: VERSION_TROCEO,
    versionLimites: VERSION_LIMITES,
    pendientes: Number(resultado.pendientes) || 0,
    listoParaLectura: resultado.pendientes === 0,
    manifiesto: resultado.manifiesto || [],
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
 * Qué hacer con un documento guardado antes de v6.
 *
 * @returns {{accion:'reextraer'|'reconstruir'|'needs_source'|'capa_nueva', needsSource?:boolean, motivo:string}}
 */
export function planMigracionV6(doc = {}) {
  const version = Number(doc.versionReconstruccion || doc.versionTroceo || 0);
  const tienePdf = Boolean(doc.tieneArchivo || doc.pdf);
  const manifiesto = doc.manifiesto || doc.manifiestoLimites || [];
  const aprobado = Boolean(doc.tieneAprobado || doc.textoAprobado || doc.capaAprobado);

  if (version >= VERSION_RECONSTRUCCION && !aprobado) {
    return { accion: 'nada', motivo: 'ya_v6' };
  }
  if (tienePdf) {
    if (aprobado) return { accion: 'capa_nueva', motivo: 'edicion_aprobada_con_pdf' };
    return { accion: 'reextraer', motivo: 'pdf_local' };
  }
  if (manifiestoSuficiente(manifiesto) && Array.isArray(doc.atomos) && doc.atomos.length) {
    return { accion: 'reconstruir', motivo: 'manifiesto_suficiente' };
  }
  return {
    accion: 'needs_source',
    needsSource: true,
    motivo: 'sin_pdf_ni_manifiesto',
  };
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
