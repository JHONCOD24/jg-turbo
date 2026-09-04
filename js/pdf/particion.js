/* JG Turbo · Partición segura del texto canónico
 *
 * Ninguna parte empieza o termina dentro de un grafema o token.
 * Si un token (URL, fórmula) supera el máximo, se conserva entero.
 */
import { estaDentroDeGrafema, estaDentroDeToken, esTokenLargo, segmentarPalabras } from './unicodeTexto.js';

export const LIMITE_PARTE = 90000;
export const MINIMO_PARA_CAPITULOS = 8000;

function acotar(pos, texto) {
  const t = String(texto || '');
  return Math.max(0, Math.min(Math.floor(Number(pos) || 0), t.length));
}

function limiteSeguro(texto, pos) {
  const t = String(texto || '');
  let p = acotar(pos, t);
  if (!estaDentroDeGrafema(t, p) && !estaDentroDeToken(t, p)) return p;
  for (let i = p; i >= 0 && p - i <= 200; i -= 1) {
    if (!estaDentroDeGrafema(t, i) && !estaDentroDeToken(t, i)) return i;
  }
  for (let i = p; i <= t.length && i - p <= Math.max(200, t.length); i += 1) {
    if (!estaDentroDeGrafema(t, i) && !estaDentroDeToken(t, i)) return i;
  }
  return t.length;
}

/**
 * Dónde cortar antes de `limite`. Nunca devuelve un índice bruto a mitad
 * de palabra. Si no hay hueco hacia atrás, busca hacia delante. Un token
 * más largo que el máximo se deja entero.
 */
export function mejorCorte(texto, desde, limite) {
  const t = String(texto || '');
  const ini = acotar(desde, t);
  let tope = acotar(limite, t);
  if (tope <= ini) return ini;
  if (tope >= t.length) return t.length;

  const minimo = ini + Math.floor((tope - ini) * 0.5);

  const parrafo = t.lastIndexOf('\n\n', tope);
  if (parrafo > minimo) return limiteSeguro(t, parrafo);

  for (let i = tope; i > minimo; i -= 1) {
    if ('.!?…'.includes(t[i]) && /\s/.test(t[i + 1] || ' ')) return limiteSeguro(t, i + 1);
  }

  for (let i = tope; i > minimo; i -= 1) {
    if (/\s/.test(t[i]) && !estaDentroDeToken(t, i) && !estaDentroDeGrafema(t, i)) return i;
  }

  /* Hacia delante: no cortar el token. */
  for (let i = tope; i < t.length; i += 1) {
    if ((/\s/.test(t[i]) || i === t.length) && !estaDentroDeToken(t, i) && !estaDentroDeGrafema(t, i)) {
      return i;
    }
  }

  const resto = t.slice(ini);
  if (esTokenLargo(resto.trim()) || !/\s/.test(resto)) return t.length;
  return t.length;
}

function anclaDe(texto, pos) {
  const t = String(texto || '');
  const p = acotar(pos, t);
  return {
    caracter: p,
    cita: t.slice(p, p + 40),
    antes: t.slice(Math.max(0, p - 24), p),
  };
}

/**
 * Parte el texto canónico en unidades de lectura.
 * Concatenar `parte.texto` en orden reconstruye exactamente el original.
 */
export function partirTextoCanonico(texto, {
  capitulos = [],
  bloques = [],
  limites = [],
  atomos = [],
  offsetDeAtomo = new Map(),
  limiteParte = LIMITE_PARTE,
} = {}) {
  const t = String(texto || '');
  if (!t) return [];

  const cortes = [];
  const caps = (capitulos || [])
    .filter((c) => c && Number.isFinite(Number(c.posicion)))
    .map((c) => ({ ...c, posicion: acotar(c.posicion, t) }))
    .sort((a, b) => a.posicion - b.posicion);

  if (caps.length > 1 && t.length > MINIMO_PARA_CAPITULOS) {
    caps.forEach((cap, i) => {
      const inicio = cap.posicion;
      const fin = i + 1 < caps.length ? caps[i + 1].posicion : t.length;
      if (i === 0 && inicio > 0) {
        cortes.push({ titulo: 'Antes del primer capítulo', desde: 0, hasta: inicio, pagina: 1, continuation: false });
      }
      if (fin > inicio) {
        cortes.push({
          titulo: cap.titulo || `Capítulo ${i + 1}`,
          desde: inicio,
          hasta: fin,
          pagina: cap.pagina || 1,
          continuation: false,
        });
      }
    });
  }

  if (!cortes.length) {
    if (t.length <= limiteParte) {
      cortes.push({ titulo: 'Documento completo', desde: 0, hasta: t.length, pagina: 1, continuation: false });
    } else {
      let desde = 0;
      let n = 1;
      while (desde < t.length) {
        let hasta = Math.min(desde + limiteParte, t.length);
        if (hasta < t.length) hasta = mejorCorte(t, desde, hasta);
        if (hasta <= desde) hasta = t.length;
        cortes.push({ titulo: `Parte ${n}`, desde, hasta, pagina: 1, continuation: desde > 0 });
        desde = hasta;
        n += 1;
      }
    }
  }

  const partes = [];
  for (const corte of cortes) {
    const trozoLen = corte.hasta - corte.desde;
    if (trozoLen <= 0) continue;
    if (trozoLen <= limiteParte * 1.6) {
      partes.push(armarParte(t, corte, { atomos, offsetDeAtomo, limites, bloques }));
      continue;
    }
    let desde = corte.desde;
    let sub = 1;
    while (desde < corte.hasta) {
      let hasta = Math.min(desde + limiteParte, corte.hasta);
      if (hasta < corte.hasta) hasta = mejorCorte(t.slice(0, corte.hasta), desde, hasta);
      if (hasta <= desde) hasta = corte.hasta;
      const continuation = desde > corte.desde || (bloques || []).some((b) => (
        Number(b.atomStart) >= 0 && desde > (offsetDeAtomo.get?.(b.id) || 0)
      ));
      partes.push(armarParte(t, {
        titulo: sub === 1 ? corte.titulo : `${corte.titulo} (${sub})`,
        desde,
        hasta,
        pagina: corte.pagina,
        continuation: desde !== corte.desde,
      }, { atomos, offsetDeAtomo, limites, bloques }));
      desde = hasta;
      sub += 1;
    }
  }
  return partes.length ? partes : [armarParte(t, {
    titulo: 'Documento completo', desde: 0, hasta: t.length, pagina: 1, continuation: false,
  }, { atomos, offsetDeAtomo, limites, bloques })];
}

function atomoEn(offsetDeAtomo, pos) {
  let elegido = null;
  let mejor = Infinity;
  for (const [id, off] of offsetDeAtomo || []) {
    if (off <= pos && pos - off < mejor) {
      mejor = pos - off;
      elegido = id;
    }
  }
  return elegido;
}

function armarParte(texto, corte, { atomos, offsetDeAtomo, limites }) {
  const slice = texto.slice(corte.desde, corte.hasta);
  const atomStart = atomoEn(offsetDeAtomo, corte.desde);
  const atomEnd = atomoEn(offsetDeAtomo, Math.max(corte.desde, corte.hasta - 1));
  const boundaryIds = (limites || [])
    .filter((l) => {
      const a = offsetDeAtomo.get(l.leftAtomId);
      const b = offsetDeAtomo.get(l.rightAtomId);
      if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
      return a >= corte.desde && b <= corte.hasta;
    })
    .map((l) => l.id);
  return {
    titulo: corte.titulo,
    texto: slice,
    pagina: corte.pagina || 1,
    continuation: Boolean(corte.continuation),
    atomStart,
    atomEnd,
    boundaryIds,
    anclaInicio: anclaDe(texto, corte.desde),
    anclaFin: anclaDe(texto, corte.hasta),
    desde: corte.desde,
    hasta: corte.hasta,
  };
}

export function reconstruirCanonicoDesdePartes(partes) {
  return (partes || []).map((p) => p.texto || '').join('');
}

export function parteCortaToken(parte, textoCanonico) {
  const t = String(parte?.texto || '');
  if (!t) return false;
  if (estaDentroDeGrafema(t, 0) || estaDentroDeToken(t, 0)) return true;
  if (estaDentroDeGrafema(t, t.length) || estaDentroDeToken(t, t.length)) return true;
  const full = String(textoCanonico || '');
  if (!full || parte.desde == null) return false;
  return estaDentroDeGrafema(full, parte.desde) || estaDentroDeToken(full, parte.desde)
    || estaDentroDeGrafema(full, parte.hasta) || estaDentroDeToken(full, parte.hasta);
}

export { segmentarPalabras };
