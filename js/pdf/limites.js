/* JG Turbo · TextBoundary: cada posible separador entre átomos
 *
 * Se registra ANTES de insertar un espacio. El identificador es estable y
 * está ligado a los átomos originales: nunca se vuelve a buscar un corte
 * emparejando pares de palabras repetidas.
 */
import { primerFragmento, ultimoFragmento, normalizarAtomStr } from './unicodeTexto.js';
import { decidirPorLexico, parProhibido } from './lexico.js';

export const VERSION_LIMITES = 1;
export const ACCIONES = new Set(['join', 'space', 'paragraph', 'pending']);

const GUION_BLANDO = /\u00AD$/;
const GUIONES_CORTE = /[\u002D\u00AD\u2010\u2011\u2012]$/;
const GUION_DIALOGO_IZQ = /[—–]\s*$/;
const GUION_DIALOGO_DER = /^\s*[—–]/;
const PUNT_TERMINAL = /[.!?…»”"'")\]]\s*$/;

export function idLimite(leftAtomId, rightAtomId) {
  return `b:${leftAtomId}~${rightAtomId}`;
}

function mediana(numeros) {
  const v = (numeros || []).filter((n) => Number.isFinite(n) && n > 0).sort((a, b) => a - b);
  if (!v.length) return 0;
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}

function kindDe(izq, der, { infoCol, ancho }) {
  if (izq.page !== der.page) return 'page-break';
  if (infoCol && infoCol.columnas >= 2 && infoCol.divisionX != null) {
    const colI = izq.x < infoCol.divisionX ? 0 : 1;
    const colD = der.x < infoCol.divisionX ? 0 : 1;
    const anchoI = (izq.width || 0) > ancho * 0.7;
    const anchoD = (der.width || 0) > ancho * 0.7;
    if (!anchoI && !anchoD && colI !== colD) return 'column-break';
  }
  const alto = Math.max(izq.height || 0, der.height || 0, 8);
  const mismaLinea = Math.abs((izq.y || 0) - (der.y || 0)) <= Math.max(1.5, alto * 0.45);
  if (mismaLinea) return 'item-gap';
  return 'line-wrap';
}

function originalSeparator(izq, der) {
  const izqStr = String(izq.str || '');
  const derStr = String(der.str || '');
  if (/\s$/.test(izqStr) || /^\s/.test(derStr)) return 'space';
  if (GUION_BLANDO.test(izqStr)) return 'soft-hyphen';
  if (GUIONES_CORTE.test(izqStr)) return 'hyphen';
  if (izq.hasEOL) return 'eol';
  return '';
}

function evidenciaDe(izq, der, kind, medidas) {
  const font = Math.max(izq.height || 0, der.height || 0, medidas.alturaModal || 10);
  const finIzq = (izq.dir === 'rtl') ? izq.x : izq.x + (izq.width || 0);
  const gap = kind === 'item-gap' ? der.x - finIzq : 0;
  const yGap = (izq.y || 0) - (der.y || 0);
  const indent = (der.x || 0) - (medidas.xModal || 0);
  return {
    gap,
    fontSize: font,
    sameFont: (izq.fontName || '') === (der.fontName || ''),
    sameColumn: kind !== 'column-break',
    indentDelta: indent,
    yGap,
    leftHasEOL: !!izq.hasEOL,
    leftPunct: PUNT_TERMINAL.test(izq.str || ''),
    rightPunct: /^[.!?,;:]/.test(String(der.str || '').trim()),
    leftWidthRatio: medidas.anchoMaximo > 0 ? (izq.width || 0) / medidas.anchoMaximo : 1,
    pageChange: izq.page !== der.page,
    columnChange: kind === 'column-break',
    continuidadGeometrica: kind !== 'item-gap' || gap < font * 0.35,
  };
}

export function crearLimites(atomos, { ancho = 595, infoCol = null } = {}) {
  const lista = atomos || [];
  if (lista.length < 2) return [];
  const alturaModal = mediana(lista.map((a) => a.height));
  const xModal = mediana(lista.map((a) => a.x));
  const anchoMaximo = Math.max(0, ...lista.map((a) => a.width || 0));
  const medidas = { alturaModal, xModal, anchoMaximo };
  const limites = [];
  for (let i = 0; i + 1 < lista.length; i += 1) {
    const izq = lista[i];
    const der = lista[i + 1];
    const kind = kindDe(izq, der, { infoCol, ancho });
    const sep = originalSeparator(izq, der);
    const leftFragment = ultimoFragmento(izq.str);
    const rightFragment = primerFragmento(der.str);
    limites.push({
      id: idLimite(izq.id, der.id),
      leftAtomId: izq.id,
      rightAtomId: der.id,
      kind,
      originalSeparator: sep,
      leftFragment,
      rightFragment,
      evidence: evidenciaDe(izq, der, kind, medidas),
      decision: 'pending',
      source: 'pdf',
      quitarGuion: false,
    });
  }
  return limites;
}

function esGuionDeParticion(izq, der, limite) {
  const izqStr = String(izq.str || '');
  const derStr = String(der.str || '').trimStart();
  if (GUION_DIALOGO_IZQ.test(izqStr) || GUION_DIALOGO_DER.test(derStr)) return false;
  if (GUION_BLANDO.test(izqStr)) return true;
  if (!GUIONES_CORTE.test(izqStr)) return false;
  if (limite.kind === 'item-gap' && limite.evidence.gap > (limite.evidence.fontSize || 10) * 0.4) {
    return false;
  }
  if (/^\p{Lu}/u.test(derStr)) return false; /* franco-Alemán: guion léxico */
  return limite.kind === 'line-wrap' || limite.kind === 'page-break' || limite.kind === 'column-break'
    || limite.kind === 'item-gap';
}

function esTituloEstructural(atomo, lineaTexto, alturaModal) {
  const rol = String(atomo.rolEstructura || '').toLowerCase();
  if (/^h[1-6]$/.test(rol) || rol === 'title' || rol === 'heading') return true;
  const t = String(lineaTexto || atomo.str || '').trim();
  if (!t || t.length > 80) return false;
  if (/^(tabla|cuadro|figura)\s*\d*/i.test(t)) return false;
  if (/^(cap[íi]tulo|chapter|parte\b|part\b|secci[óo]n|pr[óo]logo|ep[íi]logo|anexo)\b/i.test(t)) return true;
  if (t === t.toUpperCase() && t.replace(/[^\p{L}]/gu, '').length >= 2 && t.length <= 60 && !/[.!?]$/.test(t)) {
    return true;
  }
  if (alturaModal > 0 && (atomo.height || 0) >= alturaModal * 1.25) return true;
  return false;
}

function esLista(atomo) {
  const rol = String(atomo.rolEstructura || '').toLowerCase();
  if (rol === 'l' || rol === 'li' || rol === 'lbl') return true;
  return /^[-•●]\s+\S/.test(String(atomo.str || '')) || /^\d+\.\s+\S/.test(String(atomo.str || ''));
}

/**
 * Decisiones inequívocas + léxico. No llama a la IA.
 * Los átomos se consideran inmutables; solo cambia el límite.
 */
export function resolverLimitesDeterministas(limites, atomosPorId, {
  lang = 'es',
  alturaModal = 11,
  xModal = 70,
  anchoMaximo = 400,
  lineasPorAtomo = new Map(),
} = {}) {
  for (const lim of limites) {
    const izq = atomosPorId.get(lim.leftAtomId);
    const der = atomosPorId.get(lim.rightAtomId);
    if (!izq || !der) {
      lim.decision = 'pending';
      lim.source = 'pdf';
      continue;
    }

    const izqStr = String(izq.str || '');
    const derStr = String(der.str || '');

    if (/\s$/.test(izqStr) || /^\s/.test(derStr)) {
      lim.decision = 'space';
      lim.source = 'pdf';
      continue;
    }

    if (esGuionDeParticion(izq, der, lim)) {
      lim.decision = 'join';
      lim.source = 'geometry';
      lim.quitarGuion = true;
      continue;
    }
    if (GUIONES_CORTE.test(izqStr) && /^\p{Lu}/u.test(derStr.trimStart())
        && !GUION_DIALOGO_IZQ.test(izqStr) && !GUION_DIALOGO_DER.test(derStr)
        && lim.kind !== 'item-gap') {
      /* Guion léxico (franco-Alemán): se conserva y no se inserta espacio. */
      lim.decision = 'join';
      lim.source = 'geometry';
      lim.quitarGuion = false;
      continue;
    }

    const textoIzq = lineasPorAtomo.get(izq.id) || izqStr;
    const textoDer = lineasPorAtomo.get(der.id) || derStr;
    const tituloDer = esTituloEstructural(der, textoDer, alturaModal);
    const tituloIzq = esTituloEstructural(izq, textoIzq, alturaModal);
    const listaDer = esLista(der);
    const mismaPagina = izq.page === der.page && lim.kind !== 'page-break';
    const sangria = mismaPagina && (der.x - xModal) > Math.max(4, alturaModal * 0.4);
    const huecoVertical = mismaPagina && alturaModal > 0
      && lim.evidence.yGap > Math.max(alturaModal * 1.8, 6);
    const anteriorCorta = anchoMaximo > 0
      && (izq.width || 0) < anchoMaximo * 0.72
      && PUNT_TERMINAL.test(izqStr);

    if (tituloDer || tituloIzq || listaDer || (sangria && PUNT_TERMINAL.test(izqStr)) || huecoVertical || anteriorCorta) {
      if (lim.kind === 'page-break' && !tituloDer && !tituloIzq && !listaDer && !PUNT_TERMINAL.test(izqStr)) {
        /* Un cambio de página, por sí solo, no crea párrafo. */
      } else {
        lim.decision = 'paragraph';
        lim.source = 'geometry';
        continue;
      }
    }

    if (lim.kind === 'item-gap') {
      const font = lim.evidence.fontSize || alturaModal || 10;
      if (lim.evidence.gap < Math.max(0.8, font * 0.12)) {
        lim.decision = 'join';
        lim.source = 'geometry';
        continue;
      }
    }

    const lex = decidirPorLexico(lim.leftFragment, lim.rightFragment, {
      continuidadGeometrica: lim.evidence.continuidadGeometrica || lim.kind !== 'item-gap',
    }, lang);

    if (lex === 'join') {
      lim.decision = 'join';
      lim.source = 'lexicon';
      continue;
    }
    if (lex === 'space') {
      lim.decision = 'space';
      lim.source = 'lexicon';
      continue;
    }

    if (lim.kind === 'item-gap' && lim.evidence.gap >= Math.max(1, (lim.evidence.fontSize || 10) * 0.18)) {
      if (!lim.leftFragment || !lim.rightFragment || parProhibido(lim.leftFragment, lim.rightFragment)) {
        lim.decision = 'space';
        lim.source = 'geometry';
        continue;
      }
    }

    if ((lim.kind === 'line-wrap' || lim.kind === 'page-break' || lim.kind === 'column-break')
        && lim.leftFragment && lim.rightFragment) {
      /* Palabras completas a ambos lados: espacio. Fragmentos: léxico ya actuó. */
      if (lex === null && lim.leftFragment && lim.rightFragment) {
        lim.decision = 'pending';
        lim.source = 'lexicon';
        continue;
      }
    }

    if (!lim.leftFragment || !lim.rightFragment) {
      lim.decision = lim.kind === 'item-gap' && lim.evidence.gap < 1 ? 'join' : 'space';
      lim.source = 'geometry';
      continue;
    }

    lim.decision = 'pending';
    lim.source = 'lexicon';
  }
  return limites;
}

/**
 * Acepta respuestas de `/api/improve` modo `pdf_boundary_decisions`.
 * Rechaza IDs inexistentes o repetidos, acciones inválidas y cualquier
 * intento de cambiar letras. Los omitidos siguen pendientes.
 */
export function aceptarDecisionesIA(limites, respuestas) {
  const porId = new Map((limites || []).map((l) => [l.id, l]));
  const vistos = new Set();
  const aplicadas = [];
  const rechazadas = [];

  for (const r of respuestas || []) {
    if (!r || typeof r !== 'object') {
      rechazadas.push({ respuesta: r, motivo: 'invalida' });
      continue;
    }
    const id = String(r.boundaryId || '');
    if (!id) {
      rechazadas.push({ respuesta: r, motivo: 'sin_id' });
      continue;
    }
    if (vistos.has(id)) {
      rechazadas.push({ respuesta: r, motivo: 'duplicado' });
      continue;
    }
    vistos.add(id);
    const lim = porId.get(id);
    if (!lim) {
      rechazadas.push({ respuesta: r, motivo: 'inexistente' });
      continue;
    }
    const action = String(r.action || '');
    if (!ACCIONES.has(action)) {
      rechazadas.push({ respuesta: r, motivo: 'accion_invalida' });
      continue;
    }
    if (r.leftFragment != null && String(r.leftFragment) !== String(lim.leftFragment)) {
      rechazadas.push({ respuesta: r, motivo: 'cambio_de_letras' });
      continue;
    }
    if (r.rightFragment != null && String(r.rightFragment) !== String(lim.rightFragment)) {
      rechazadas.push({ respuesta: r, motivo: 'cambio_de_letras' });
      continue;
    }
    if (typeof r.text === 'string' && r.text.length) {
      rechazadas.push({ respuesta: r, motivo: 'cambio_de_letras' });
      continue;
    }
    lim.decision = action;
    lim.source = 'ai';
    lim.confidence = Number(r.confidence);
    lim.reason = r.reason ? String(r.reason).slice(0, 240) : '';
    if (action === 'join' && (lim.originalSeparator === 'hyphen' || lim.originalSeparator === 'soft-hyphen')) {
      lim.quitarGuion = lim.originalSeparator === 'soft-hyphen'
        || (lim.kind !== 'item-gap');
    }
    aplicadas.push(lim.id);
  }
  return { aplicadas, rechazadas };
}

export function aplicarDecisionUsuario(limite, action) {
  if (!limite || !ACCIONES.has(action)) return false;
  limite.decision = action;
  limite.source = 'user';
  return true;
}

function quitarGuionFinal(texto) {
  return String(texto || '').replace(GUION_BLANDO, '').replace(/[\u002D\u2010\u2011\u2012]$/, '');
}

export function separadorDe(limite, izq) {
  if (!limite) return '';
  if (limite.decision === 'join') return '';
  if (limite.decision === 'paragraph') return '\n\n';
  if (limite.decision === 'space' || limite.decision === 'pending') return ' ';
  return ' ';
}

export function textoIzquierdoAjustado(izq, limite) {
  const bruto = normalizarAtomStr(izq?.str || '');
  if (limite?.decision === 'join' && limite.quitarGuion) return quitarGuionFinal(bruto);
  return bruto.replace(/\s+$/, limite?.decision === 'join' ? '' : bruto.match(/\s+$/) ? bruto.match(/\s+$/)[0] : '');
}

export function compactarManifiesto(limites) {
  return (limites || []).map((l) => ({
    id: l.id,
    k: l.kind,
    d: l.decision,
    s: l.source,
    q: l.quitarGuion ? 1 : 0,
    lf: l.leftFragment,
    rf: l.rightFragment,
    la: l.leftAtomId,
    ra: l.rightAtomId,
    os: l.originalSeparator,
  }));
}

export function expandirManifiesto(compacto) {
  return (compacto || []).map((l) => ({
    id: l.id,
    kind: l.k || l.kind,
    decision: l.d || l.decision || 'pending',
    source: l.s || l.source || 'pdf',
    quitarGuion: Boolean(l.q || l.quitarGuion),
    leftFragment: l.lf || l.leftFragment || '',
    rightFragment: l.rf || l.rightFragment || '',
    leftAtomId: l.la || l.leftAtomId,
    rightAtomId: l.ra || l.rightAtomId,
    originalSeparator: l.os || l.originalSeparator || '',
    evidence: l.evidence || {},
  }));
}

export function contarPendientes(limites) {
  return (limites || []).filter((l) => l.decision === 'pending').length;
}

export function documentoListoParaLectura(limites) {
  return contarPendientes(limites) === 0;
}
