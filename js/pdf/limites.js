/* JG Turbo · TextBoundary: cada posible separador entre átomos
 *
 * Se registra ANTES de insertar un espacio. El identificador es estable y
 * está ligado a los átomos originales: nunca se vuelve a buscar un corte
 * emparejando pares de palabras repetidas.
 */
import { primerFragmento, ultimoFragmento, normalizarAtomStr, claveLexica } from './unicodeTexto.js';
import { decidirPorLexico, parProhibido, esPalabraValida, esFuncional, vocabularioDelDocumento } from './lexico.js';

export const VERSION_LIMITES = 1;
export const ACCIONES = new Set(['join', 'space', 'paragraph', 'pending']);

const GUION_BLANDO = /\u00AD$/;
const GUIONES_CORTE = /[\u002D\u00AD\u2010\u2011\u2012]$/;
/* Guion al final aunque traiga espacios residuales: «extraor- dinario». */
const GUION_CORTE_RESIDUAL = /[\u002D\u00AD\u2010\u2011\u2012]\s*$/;
/* Guion no separable (U+2011): nunca es partición, se conserva siempre. */
const GUION_NO_SEPARABLE = /‑$/;
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

function kindDe(izq, der, { infoCol, infoColPorPagina, ancho }) {
  if (izq.page !== der.page) return 'page-break';
  // Columnas por página y región: cada página decide su propio corte.
  const info = (infoColPorPagina && infoColPorPagina.get
    ? infoColPorPagina.get(izq.page) || infoColPorPagina.get(der.page)
    : null) || infoCol;
  if (info && info.columnas >= 2 && info.divisionX != null) {
    const colI = izq.x < info.divisionX ? 0 : 1;
    const colD = der.x < info.divisionX ? 0 : 1;
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
  // El guion con espacio residual («extraor- ») es guion, no espacio.
  if (GUION_BLANDO.test(izqStr.replace(/\s+$/, ''))) return 'soft-hyphen';
  if (GUION_CORTE_RESIDUAL.test(izqStr)) return 'hyphen';
  if (/\s$/.test(izqStr) || /^\s/.test(derStr)) return 'space';
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

export function crearLimites(atomos, { ancho = 595, infoCol = null, infoColPorPagina = null } = {}) {
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
    const kind = kindDe(izq, der, { infoCol, infoColPorPagina, ancho });
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

/**
 * Clasifica el guion final del átomo izquierdo.
 * @returns {'particion'|'lexico'|'dialogo'|'no-separable'|'ninguno'}
 */
export function clasificarGuion(izqStr, derStr) {
  const izq = String(izqStr || '');
  const der = String(derStr || '');
  const derRecortada = der.trimStart();
  if (GUION_DIALOGO_IZQ.test(izq) || GUION_DIALOGO_DER.test(derRecortada)) return 'dialogo';
  // No separable U+2011: se conserva siempre, nunca es partición.
  if (GUION_NO_SEPARABLE.test(izq.replace(/\s+$/, ''))) return 'no-separable';
  if (GUION_BLANDO.test(izq.replace(/\s+$/, ''))) return 'particion';
  if (!GUION_CORTE_RESIDUAL.test(izq)) return 'ninguno';
  // Mayúscula tras guion en salto de línea: compuesto léxico (franco-Alemán).
  if (/^\p{Lu}/u.test(derRecortada)) return 'lexico';
  // 19th-century: el ordinal vive en el propio átomo, no en una lista.
  if (/\d+(st|nd|rd|th)[\u002D\u00AD\u2010\u2011\u2012]\s*$/i.test(izq)) return 'lexico';
  return 'particion';
}

function formaSinGuion(forma) {
  return String(forma || '').replace(/^[\u002D\u00AD\u2010\u2011\u2012]+|[\u002D\u00AD\u2010\u2011\u2012\s]+$/g, '');
}

function nucleoForma(forma, lado) {
  const piezas = formaSinGuion(forma).split(/[\u002D\u00AD\u2010\u2011\u2012]+/).filter(Boolean);
  if (!piezas.length) return '';
  return lado === 'der' ? piezas[0] : piezas[piezas.length - 1];
}

function formaCompletaObservada(forma, vocabulario, lado = 'izq') {
  const nucleo = nucleoForma(forma, lado);
  if (!nucleo) return false;
  if (esPalabraValida(nucleo) || esFuncional(nucleo)) return true;
  if (vocabulario && typeof vocabulario.has === 'function' && vocabulario.has(claveLexica(nucleo))) return true;
  return false;
}

function comboObservado(izq, der, vocabulario) {
  const combo = nucleoForma(izq, 'izq') + nucleoForma(der, 'der');
  if (!combo) return false;
  if (esPalabraValida(combo)) return true;
  if (vocabulario && typeof vocabulario.has === 'function' && vocabulario.has(claveLexica(combo))) return true;
  return false;
}

function esGuionDeParticion(izq, der, limite) {
  const izqStr = String(izq.str || '');
  const derStr = String(der.str || '').trimStart();
  const clase = clasificarGuion(izqStr, derStr);
  if (clase !== 'particion') return false;
  if (limite.kind === 'item-gap' && limite.evidence.gap > (limite.evidence.fontSize || 10) * 0.4) {
    return false;
  }
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
  anchoLineaPorAtomo = new Map(),
  vocabularioDocumento = null,
} = {}) {
  const vocabulario = vocabularioDocumento
    || vocabularioDelDocumento([...(atomosPorId?.values?.() || [])], []);
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

    // El espacio residual tras un guion («extraor- dinario») no es un
    // espacio real: se decide como partición antes de mirar espacios.
    const claseGuion = clasificarGuion(izqStr, derStr);
    if (claseGuion === 'dialogo') {
      lim.decision = lim.kind === 'line-wrap' && PUNT_TERMINAL.test(izqStr) ? 'paragraph' : 'space';
      lim.source = 'geometry';
      lim.quitarGuion = false;
      continue;
    }
    if (claseGuion === 'no-separable') {
      // Guion no separable: se conserva el guion, sin espacio.
      lim.decision = 'join';
      lim.source = 'geometry';
      lim.quitarGuion = false;
      continue;
    }
    if (claseGuion === 'particion' && esGuionDeParticion(izq, der, lim)) {
      const izqFrag = lim.leftFragment || ultimoFragmento(izqStr);
      const derFrag = lim.rightFragment || primerFragmento(derStr);
      const ambosCompletos = formaCompletaObservada(izqFrag, vocabulario, 'izq')
        && formaCompletaObservada(derFrag, vocabulario, 'der');
      const comboEsPalabra = comboObservado(izqFrag, derFrag, vocabulario);
      /* self-limiting: las dos formas existen en el documento y juntas no
       * son una palabra: el guion es del compuesto, no de una sílaba. */
      lim.decision = 'join';
      lim.source = 'geometry';
      lim.quitarGuion = !(ambosCompletos && !comboEsPalabra);
      continue;
    }
    if (claseGuion === 'lexico' && lim.kind !== 'item-gap') {
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
    const anchoLinea = anchoLineaPorAtomo.get(izq.id) || (izq.width || 0);
    const anchoRef = Math.max(anchoMaximo, 1);
    const anteriorCorta = anchoMaximo > 0
      && anchoLinea < anchoRef * 0.72
      && PUNT_TERMINAL.test((textoIzq || izqStr).trimEnd());

    /* La estructura se decide antes de interpretar blancos de borde. Una
     * sangría puede venir dentro de `str`; tratarla primero como un espacio
     * ordinario borraba el párrafo aunque la geometría fuera inequívoca. */
    if (tituloDer || tituloIzq || listaDer || (sangria && PUNT_TERMINAL.test(izqStr)) || huecoVertical || anteriorCorta) {
      if (lim.kind === 'page-break' && !tituloDer && !tituloIzq && !listaDer && !PUNT_TERMINAL.test(izqStr)) {
        /* Un cambio de página, por sí solo, no crea párrafo. */
      } else {
        lim.decision = 'paragraph';
        lim.source = 'geometry';
        continue;
      }
    }

    /* Espacio residual al cambiar de renglón («que to» / «ma un pla»): el
     * PDF trae un blanco donde el libro parte la palabra. Antes se daba por
     * espacio sin preguntar y «Unir palabras» no podía hacer nada (ni era
     * candidato). Se consulta al léxico con la misma regla de siempre: solo
     * 'join' une; lo demás queda como espacio y NUNCA pendiente (no se infla
     * «Revisar cortes» ni la etapa 1 de la corrección). */
    if ((lim.kind === 'line-wrap' || lim.kind === 'page-break' || lim.kind === 'column-break')
        && (/\s$/.test(izqStr) || /^\s/.test(derStr))) {
      const lexRenglon = decidirPorLexico(lim.leftFragment, lim.rightFragment, {
        continuidadGeometrica: true,
        vocabularioDocumento: vocabulario,
      }, lang);
      if (lexRenglon === 'join') {
        lim.decision = 'join';
        lim.source = 'lexicon';
        continue;
      }
      lim.decision = 'space';
      lim.source = 'pdf';
      continue;
    }

    if (/\s$/.test(izqStr) || /^\s/.test(derStr)) {
      lim.decision = 'space';
      lim.source = 'pdf';
      continue;
    }

    const lex = decidirPorLexico(lim.leftFragment, lim.rightFragment, {
      continuidadGeometrica: lim.evidence.continuidadGeometrica || lim.kind !== 'item-gap',
      vocabularioDocumento: vocabulario,
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

    /* Hueco diminuto: solo une si el documento o el léxico muestran la
     * forma completa (Bos+ton → Boston). you+Whoa no es una palabra: espacio. */
    if (lim.kind === 'item-gap') {
      const font = lim.evidence.fontSize || alturaModal || 10;
      if (lim.evidence.gap < Math.max(0.8, font * 0.12)
          && comboObservado(lim.leftFragment, lim.rightFragment, vocabulario)) {
        lim.decision = 'join';
        lim.source = 'lexicon';
        continue;
      }
    }

    if (lim.kind === 'item-gap' && lim.evidence.gap >= Math.max(1, (lim.evidence.fontSize || 10) * 0.18)) {
      // Espacio normal entre palabras completas: se conserva aunque ambas
      // sean desconocidas para la lista. Solo se duda (pending) si hay
      // evidencia de fragmentación: hueco diminuto o formas partidas.
      if (!lim.leftFragment || !lim.rightFragment || parProhibido(lim.leftFragment, lim.rightFragment)) {
        lim.decision = 'space';
        lim.source = 'geometry';
        continue;
      }
      const fragIzq = String(lim.leftFragment || '');
      const fragDer = String(lim.rightFragment || '');
      const parecenCompletas = fragIzq.length >= 2 && fragDer.length >= 2;
      if (parecenCompletas && lex === null) {
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
  // «extraor- dinario»: el espacio residual tras el guion se recorta junto
  // al guion; si no, quedaría «extraor dinario» con advertencia fantasma.
  const sinEspacios = String(texto || '').replace(/\s+$/, '');
  return sinEspacios.replace(GUION_BLANDO, '').replace(/[\u002D\u2010\u2011\u2012]$/, '');
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
    /* Dónde cae el corte en el texto. Viaja al manifiesto para que al reabrir
     * el libro se pueda seguir acotando por tramo y llevar al sitio exacto,
     * sin rehacer la reconstrucción entera. */
    c: Number.isFinite(l.charStart) ? l.charStart : undefined,
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
    /* Un manifiesto guardado antes de v2.42 no lo trae: se deja sin definir
     * en vez de inventar un cero, que apuntaría al principio del capítulo. */
    charStart: Number.isFinite(l.c) ? l.c : (Number.isFinite(l.charStart) ? l.charStart : undefined),
  }));
}

export function contarPendientes(limites) {
  return (limites || []).filter((l) => l.decision === 'pending').length;
}

export function documentoListoParaLectura(limites) {
  return contarPendientes(limites) === 0;
}
