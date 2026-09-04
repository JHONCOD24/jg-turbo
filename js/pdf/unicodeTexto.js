/* JG Turbo · Segmentación Unicode para el motor de PDF
 *
 * El texto de un libro no es «letras A-Z». Hay tildes, ñ, ligaduras, apóstrofes
 * y grafemas que ocupan más de un code point. Todas las particiones del lector
 * pasan por aquí para no cortar en medio de un carácter.
 */

const LIGADURAS = [
  [/ﬀ/g, 'ff'], [/ﬁ/g, 'fi'], [/ﬂ/g, 'fl'],
  [/ﬃ/g, 'ffi'], [/ﬄ/g, 'ffl'], [/ﬅ/g, 'st'], [/ﬆ/g, 'st'],
];

/** Normalizaciones documentadas: ligaduras, espacios duros, guion blando suelto. */
export function normalizarAtomStr(str) {
  let salida = String(str ?? '');
  for (const [patron, reemplazo] of LIGADURAS) salida = salida.replace(patron, reemplazo);
  return salida
    .replace(/[\u00A0\u2007\u202F]/g, ' ')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');
}

export function segmentarGrafemas(texto) {
  const t = String(texto ?? '');
  if (!t) return [];
  if (typeof Intl !== 'undefined' && Intl.Segmenter) {
    return [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(t)]
      .map((s) => s.segment);
  }
  return Array.from(t);
}

export function segmentarPalabras(texto, locale = 'es') {
  const t = String(texto ?? '');
  if (!t) return [];
  if (typeof Intl !== 'undefined' && Intl.Segmenter) {
    try {
      return [...new Intl.Segmenter(locale, { granularity: 'word' }).segment(t)];
    } catch (_) {
      return [...new Intl.Segmenter(undefined, { granularity: 'word' }).segment(t)];
    }
  }
  const salida = [];
  const re = /(\p{L}[\p{L}\p{M}'’-]*)|(\s+)|([^\p{L}\s]+)/gu;
  let m;
  while ((m = re.exec(t))) {
    salida.push({
      segment: m[0],
      index: m.index,
      isWordLike: Boolean(m[1]),
    });
  }
  return salida;
}

/** ¿`pos` cae en el interior de un grafema? */
export function estaDentroDeGrafema(texto, pos) {
  const t = String(texto ?? '');
  const p = Math.max(0, Math.min(Math.floor(Number(pos) || 0), t.length));
  if (p === 0 || p === t.length) return false;
  let acc = 0;
  for (const g of segmentarGrafemas(t)) {
    const fin = acc + g.length;
    if (p > acc && p < fin) return true;
    acc = fin;
  }
  return false;
}

/** ¿`pos` cae en el interior de un token de palabra (o URL/correo/fórmula)? */
export function estaDentroDeToken(texto, pos) {
  const t = String(texto ?? '');
  const p = Math.max(0, Math.min(Math.floor(Number(pos) || 0), t.length));
  if (p === 0 || p === t.length) return false;
  if (estaDentroDeGrafema(t, p)) return true;
  for (const seg of segmentarPalabras(t)) {
    const inicio = seg.index ?? t.indexOf(seg.segment);
    const fin = inicio + seg.segment.length;
    const esToken = seg.isWordLike || esTokenLargo(seg.segment);
    if (esToken && p > inicio && p < fin) return true;
  }
  return false;
}

export function esTokenLargo(fragmento) {
  const t = String(fragmento || '');
  if (!t) return false;
  if (/^https?:\/\/\S+/i.test(t) || /^www\.\S+/i.test(t)) return true;
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(t)) return true;
  if (/^[\d.,+\-*/^=()\[\]{}\\]+$/.test(t) && t.length > 12) return true;
  return t.length > 80 && !/\s/.test(t);
}

export function ultimoFragmento(texto) {
  const t = String(texto ?? '');
  const m = t.match(/(\p{L}[\p{L}\p{M}'’-]*)\s*$/u);
  return m ? m[1] : '';
}

export function primerFragmento(texto) {
  const t = String(texto ?? '');
  const m = t.match(/^\s*(\p{L}[\p{L}\p{M}'’-]*)/u);
  return m ? m[1] : '';
}

/** Letras y cifras, sin separadores: sirve para la invariante de procedencia. */
export function caracteresNoSeparadores(texto) {
  return String(texto ?? '')
    .replace(/\u00AD/g, '')
    .replace(/\s+/g, '');
}

export function claveLexica(texto) {
  return String(texto ?? '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase();
}
