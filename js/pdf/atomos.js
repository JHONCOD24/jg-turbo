/* JG Turbo · TextAtom: procedencia de cada fragmento del PDF
 *
 * Se crea ANTES de normalizar espacios o agrupar líneas. Cada átomo conserva
 * los campos que pdf.js expone: str, hasEOL, dir, transform, width, height,
 * fontName y, si existe, el identificador de contenido marcado.
 */
import { normalizarAtomStr } from './unicodeTexto.js';

export function idAtomo(page, itemIndex) {
  return `a:${Number(page) || 0}:${Number(itemIndex) || 0}`;
}

export function crearAtomo(campos) {
  const page = Number(campos.page) || 0;
  const itemIndex = Number(campos.itemIndex) || 0;
  return {
    id: campos.id || idAtomo(page, itemIndex),
    page,
    itemIndex,
    str: String(campos.str ?? ''),
    x: Number(campos.x) || 0,
    y: Number(campos.y) || 0,
    width: Number(campos.width) || 0,
    height: Number(campos.height) || 0,
    dir: campos.dir || 'ltr',
    fontName: campos.fontName || '',
    hasEOL: Boolean(campos.hasEOL),
    markedContentId: campos.markedContentId ?? null,
    rolEstructura: campos.rolEstructura || null,
    transform: Array.isArray(campos.transform) ? campos.transform.slice() : null,
  };
}

/**
 * Recorre TextContent.items conservando TextItem y TextMarkedContent.
 * `viewport` debe ofrecer convertToViewportPoint y height, como pdf.js.
 */
export function extraerAtomosDeTextContent(textContent, { page, viewport } = {}) {
  const atomos = [];
  const pila = [];
  let itemIndex = 0;
  const items = textContent?.items || [];
  const alto = viewport?.height || 0;

  for (const item of items) {
    if (!item) continue;
    const tipo = item.type || '';
    if (tipo === 'beginMarkedContent' || tipo === 'beginMarkedContentProps') {
      pila.push(item.id ?? item.tag ?? null);
      continue;
    }
    if (tipo === 'endMarkedContent') {
      pila.pop();
      continue;
    }
    if (typeof item.str !== 'string') continue;

    const t = item.transform || [1, 0, 0, 1, 0, 0];
    let x = t[4] || 0;
    let y = t[5] || 0;
    if (viewport && typeof viewport.convertToViewportPoint === 'function') {
      const conv = viewport.convertToViewportPoint(t[4], t[5]);
      x = conv[0];
      y = alto - conv[1];
    }
    const altura = Math.hypot(t[2] || 0, t[3] || 0) || item.height || 0;
    atomos.push(crearAtomo({
      page,
      itemIndex,
      str: item.str,
      x,
      y,
      width: item.width || 0,
      height: altura,
      dir: item.dir || 'ltr',
      fontName: item.fontName || '',
      hasEOL: !!item.hasEOL,
      markedContentId: pila.length ? pila[pila.length - 1] : null,
      transform: t,
    }));
    itemIndex += 1;
  }
  return atomos;
}

/** Asocia roles del StructTree solo cuando el MCID coincide sin ambigüedad. */
export function asociarEstructura(atomos, structTree) {
  if (!structTree) return atomos;
  const porId = new Map();
  const recorrer = (nodo, rol) => {
    if (!nodo) return;
    const esteRol = nodo.role || nodo.S || rol;
    const id = nodo.id ?? nodo.mcid ?? null;
    if (id != null && esteRol) {
      if (porId.has(id) && porId.get(id) !== esteRol) porId.set(id, null);
      else if (!porId.has(id)) porId.set(id, esteRol);
    }
    const hijos = nodo.children || nodo.items || [];
    for (const h of hijos) recorrer(h, esteRol);
  };
  recorrer(structTree, null);
  for (const atomo of atomos) {
    if (atomo.markedContentId == null) continue;
    const rol = porId.get(atomo.markedContentId);
    if (rol) atomo.rolEstructura = String(rol);
  }
  return atomos;
}

export function detectarColumnas(atomos, ancho = 595) {
  const utiles = (atomos || []).filter((a) => a && String(a.str || '').trim());
  if (utiles.length < 6 || !ancho) return { columnas: 1, divisionX: null };
  const xs = utiles.map((a) => a.x).sort((a, b) => a - b);
  let maxHueco = 0;
  let idxHueco = -1;
  for (let i = 1; i < xs.length; i += 1) {
    const hueco = xs[i] - xs[i - 1];
    if (hueco > maxHueco) { maxHueco = hueco; idxHueco = i; }
  }
  if (maxHueco <= ancho * 0.22) return { columnas: 1, divisionX: null };
  const divisionX = (xs[idxHueco] + xs[idxHueco - 1]) / 2;
  const izq = utiles.filter((a) => a.x < divisionX).length;
  const der = utiles.filter((a) => a.x >= divisionX).length;
  if (izq < 2 || der < 2) return { columnas: 1, divisionX: null };
  return { columnas: 2, divisionX };
}

function columnaDe(atomo, info, ancho) {
  if (!info || info.columnas < 2 || info.divisionX == null) return 0;
  const cruza = (atomo.width || 0) > ancho * 0.7
    || (atomo.x < info.divisionX && atomo.x + (atomo.width || 0) > info.divisionX);
  if (cruza) return -1; /* ancho completo */
  return atomo.x < info.divisionX ? 0 : 1;
}

/**
 * Orden de lectura: columnas, luego baseline, luego dirección.
 * No mezcla columnas por cercanía vertical.
 */
function ordenarPagina(lista, { ancho = 595 } = {}) {
  if (lista.length <= 1) return lista.slice();
  const dirs = lista.map((a) => a.dir || 'ltr');
  const rtl = dirs.filter((d) => d === 'rtl').length > dirs.length / 2;
  const info = detectarColumnas(lista, ancho);

  const porColumna = new Map();
  for (const a of lista) {
    const col = columnaDe(a, info, ancho);
    if (!porColumna.has(col)) porColumna.set(col, []);
    porColumna.get(col).push(a);
  }

  const ordenarEnColumna = (grupo) => {
    const altura = mediana(grupo.map((a) => a.height).filter((n) => n > 0)) || 10;
    const tol = Math.max(1.5, altura * 0.45);
    const lineas = [];
    for (const item of grupo) {
      const linea = lineas.find((g) => Math.abs(g.y - item.y) <= tol);
      if (linea) {
        linea.items.push(item);
        linea.y = (linea.y * (linea.items.length - 1) + item.y) / linea.items.length;
      } else {
        lineas.push({ y: item.y, items: [item] });
      }
    }
    lineas.sort((a, b) => b.y - a.y);
    const salida = [];
    for (const linea of lineas) {
      linea.items.sort((a, b) => (rtl ? b.x - a.x : a.x - b.x));
      salida.push(...linea.items);
    }
    return salida;
  };

  // Títulos de ancho completo en su posición vertical: no se mueven todos
  // al principio. Se ordena por franjas horizontales: cada franja conserva
  // su Y, y dentro de la franja van primero los de ancho completo y luego
  // las columnas. Así un título entre dos párrafos queda entre ellos.
  const alturaRef = mediana(lista.map((a) => a.height).filter((n) => n > 0)) || 10;
  const tol = Math.max(1.5, alturaRef * 0.45);
  const franjas = [];
  for (const a of lista) {
    const f = franjas.find((g) => Math.abs(g.y - a.y) <= tol);
    if (f) {
      f.items.push(a);
      f.y = (f.y * (f.items.length - 1) + a.y) / f.items.length;
    } else franjas.push({ y: a.y, items: [a] });
  }
  franjas.sort((a, b) => b.y - a.y);
  const resultado = [];
  for (const franja of franjas) {
    const anchos = franja.items.filter((a) => columnaDe(a, info, ancho) === -1)
      .sort((a, b) => (rtl ? b.x - a.x : a.x - b.x));
    const porCol = new Map();
    for (const a of franja.items) {
      const col = columnaDe(a, info, ancho);
      if (col === -1) continue;
      if (!porCol.has(col)) porCol.set(col, []);
      porCol.get(col).push(a);
    }
    resultado.push(...anchos);
    const cols = [...porCol.keys()].sort((a, b) => (rtl ? b - a : a - b));
    for (const c of cols) {
      porCol.get(c).sort((a, b) => (rtl ? b.x - a.x : a.x - b.x));
      resultado.push(...porCol.get(c));
    }
  }
  return resultado;
}

/**
 * Columnas por página y región: cada página decide su propio corte.
 * Un título de ancho completo no convierte la página en dos columnas.
 */
export function detectarColumnasPorPagina(atomos, ancho = 595) {
  const porPagina = new Map();
  for (const a of atomos || []) {
    const p = Number(a?.page) || 0;
    if (!porPagina.has(p)) porPagina.set(p, []);
    porPagina.get(p).push(a);
  }
  const mapa = new Map();
  for (const [p, lista] of porPagina) mapa.set(p, detectarColumnas(lista, ancho));
  return mapa;
}

/**
 * Orden de lectura: página, luego columnas, luego baseline, luego dirección.
 * No mezcla páginas ni columnas por cercanía vertical.
 */
export function ordenarAtomos(atomos, { ancho = 595 } = {}) {
  const lista = (atomos || []).slice();
  if (lista.length <= 1) return lista;
  const porPagina = new Map();
  for (const a of lista) {
    const p = Number(a.page) || 0;
    if (!porPagina.has(p)) porPagina.set(p, []);
    porPagina.get(p).push(a);
  }
  const resultado = [];
  for (const p of [...porPagina.keys()].sort((a, b) => a - b)) {
    resultado.push(...ordenarPagina(porPagina.get(p), { ancho }));
  }
  return resultado;
}

function mediana(numeros) {
  const v = (numeros || []).filter((n) => Number.isFinite(n)).sort((a, b) => a - b);
  if (!v.length) return 0;
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}

/**
 * Convierte páginas de prueba (líneas o ítems) en átomos.
 * Si ya traen `atomos`, se respetan.
 */
export function atomosDesdePaginas(paginas) {
  const salida = [];
  for (const pag of paginas || []) {
    const numero = Number(pag.numero) || 0;
    if (Array.isArray(pag.atomos) && pag.atomos.length) {
      for (const a of pag.atomos) salida.push(crearAtomo({ ...a, page: a.page || numero }));
      continue;
    }
    if (Array.isArray(pag.items) && pag.items.length) {
      pag.items.forEach((it, i) => {
        salida.push(crearAtomo({
          page: numero,
          itemIndex: i,
          str: it.str,
          x: it.x,
          y: it.y,
          width: it.ancho ?? it.width,
          height: it.altura ?? it.height,
          dir: it.dir,
          fontName: it.fontName,
          hasEOL: it.hasEOL,
          markedContentId: it.markedContentId,
          transform: it.transform,
        }));
      });
      continue;
    }
    const lineas = pag.lineas || [];
    lineas.forEach((l, i) => {
      if (Array.isArray(l.items) && l.items.length) {
        l.items.forEach((it, j) => {
          salida.push(crearAtomo({
            page: numero,
            itemIndex: i * 1000 + j,
            str: it.str ?? it.texto,
            x: it.x,
            y: it.y ?? l.y,
            width: it.ancho ?? it.width,
            height: it.altura ?? it.height ?? l.altura,
            hasEOL: j === l.items.length - 1,
            dir: it.dir,
            fontName: it.fontName,
          }));
        });
        return;
      }
      const texto = String(l.texto ?? l.str ?? '').replace(/[ \t]+/g, ' ').trim();
      if (!texto) return;
      salida.push(crearAtomo({
        page: numero,
        itemIndex: i,
        str: texto,
        x: l.x || 0,
        y: l.y || 0,
        width: l.ancho ?? l.width ?? String(texto).length * 5,
        height: l.altura ?? l.height ?? 11,
        hasEOL: true,
        dir: l.dir,
        fontName: l.fontName,
      }));
    });
  }
  return salida;
}

export function textoNormAtomo(atomo) {
  return normalizarAtomStr(atomo?.str || '');
}

export { mediana as medianaNumeros };
