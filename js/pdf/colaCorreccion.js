/* JG Turbo · Cola persistente de corrección de lectura
 *
 * Recorre TODAS las partes del PDF. Un fallo de red, tiempo límite o
 * proveedor no se guarda como resultado ni detiene el resto del libro.
 * Lo ya corregido no se vuelve a pedir; lo fallido queda para reanudar
 * desde el mismo bloque, más pequeño si hace falta.
 */
import { mejorCorte } from './particion.js';
import { mismasPalabrasLectura } from './pulido.js';

export const VERSION_COLA_CORRECCION = 1;
export const CLAVE_COLA_CORRECCION = '__cola__';
export const TAMANOS_BLOQUE = Object.freeze([3000, 1500, 800, 400]);
export const MAX_REINTENTOS_POR_TAMANO = 2;

function textoDe(valor) {
  return valor == null ? '' : String(valor);
}

export function huellaParte(texto) {
  const t = textoDe(texto);
  return `${t.length}:${t.slice(0, 32)}:${t.slice(-32)}`;
}

export function clasificarCausa(error) {
  const msg = textoDe(error?.message || error?.causa || error);
  if (/validacion|palabra|union|estructura|cambio_no_autorizado/i.test(msg)) return 'validacion';
  if (/abort|timeout|tiempo|tardó|504|502/i.test(msg)) return 'tiempo_limite';
  if (/network|failed to fetch|fetch|red|offline|err_internet|typeerror: failed/i.test(msg)) return 'red';
  if (/402|503|401|proveedor|api.?key|credencial|unauthorized|no confirmó/i.test(msg)) return 'proveedor';
  return 'desconocido';
}

export function etiquetaCausa(causa) {
  switch (causa) {
    case 'tiempo_limite': return 'se agotó el tiempo';
    case 'red': return 'fallo de red';
    case 'proveedor': return 'el proveedor no respondió';
    case 'validacion': return 'el resultado no conservó las palabras';
    default: return 'error al corregir';
  }
}

function cortarSeguro(texto, desde, limite, cortar) {
  const fn = typeof cortar === 'function' ? cortar : mejorCorte;
  const t = textoDe(texto);
  const ini = Math.max(0, Math.floor(Number(desde) || 0));
  let hasta = fn(t, ini, limite);
  if (!Number.isFinite(hasta) || hasta <= ini) {
    hasta = Math.min(ini + Math.max(1, (Number(limite) || ini) - ini), t.length);
  }
  return Math.max(ini + 1, Math.min(t.length, hasta));
}

/**
 * Parte un texto en bloques del tamaño pedido, sin cortar a mitad de palabra.
 */
export function partirEnBloques(texto, tamano, cortar) {
  const t = textoDe(texto);
  const max = Math.max(200, Number(tamano) || TAMANOS_BLOQUE[0]);
  if (!t.length) return [{ desde: 0, hasta: 0, texto: '' }];
  if (t.length <= max) return [{ desde: 0, hasta: t.length, texto: t }];
  const cortes = [];
  let desde = 0;
  while (desde < t.length) {
    let hasta = Math.min(desde + max, t.length);
    if (hasta < t.length) hasta = cortarSeguro(t, desde, hasta, cortar);
    if (hasta <= desde) hasta = Math.min(desde + max, t.length);
    cortes.push({ desde, hasta, texto: t.slice(desde, hasta) });
    desde = hasta;
  }
  return cortes;
}

function idItem(parte, desde, hasta) {
  return `${parte}:${desde}:${hasta}`;
}

function crearItemsDeParte(parte, indice, tamano, cortar) {
  const bloques = partirEnBloques(parte?.texto, tamano, cortar);
  return bloques.map((b, bi) => ({
    id: idItem(indice, b.desde, b.hasta),
    parte: indice,
    bloque: bi,
    desde: b.desde,
    hasta: b.hasta,
    texto: b.texto,
    estado: 'pending',
    tamano,
    reintentos: 0,
    causa: '',
    textoCorregido: null,
  }));
}

function normalizarItem(it) {
  const estado = it?.estado === 'done' || it?.estado === 'failed' ? it.estado : 'pending';
  return {
    id: textoDe(it?.id),
    parte: Number(it?.parte) || 0,
    bloque: Number(it?.bloque) || 0,
    desde: Number(it?.desde) || 0,
    hasta: Number(it?.hasta) || 0,
    texto: textoDe(it?.texto),
    estado,
    tamano: Number(it?.tamano) || TAMANOS_BLOQUE[0],
    reintentos: Math.max(0, Number(it?.reintentos) || 0),
    causa: textoDe(it?.causa),
    textoCorregido: estado === 'done' ? (it?.textoCorregido != null ? String(it.textoCorregido) : null) : null,
  };
}

export function crearColaDesdePartes(partes, { tamano = TAMANOS_BLOQUE[0], cortar } = {}) {
  const actuales = Array.isArray(partes) ? partes : [];
  const items = [];
  actuales.forEach((parte, indice) => {
    items.push(...crearItemsDeParte(parte, indice, tamano, cortar));
  });
  return {
    version: VERSION_COLA_CORRECCION,
    totalPartes: actuales.length,
    huellas: actuales.map((p) => huellaParte(p?.texto)),
    items,
  };
}

function resumenPorParte(cola) {
  const n = Number(cola?.totalPartes) || 0;
  const mapa = new Map();
  for (let i = 0; i < n; i += 1) mapa.set(i, { pending: 0, done: 0, failed: 0 });
  for (const it of cola?.items || []) {
    const r = mapa.get(it.parte) || { pending: 0, done: 0, failed: 0 };
    r[it.estado] = (r[it.estado] || 0) + 1;
    mapa.set(it.parte, r);
  }
  return mapa;
}

export function resumenCola(cola) {
  const items = cola?.items || [];
  const nPartes = Number(cola?.totalPartes) || new Set(items.map((i) => i.parte)).size;
  const porParte = resumenPorParte({ ...cola, totalPartes: nPartes, items });
  let pendientes = 0;
  let completados = 0;
  let fallos = 0;
  for (let i = 0; i < nPartes; i += 1) {
    const r = porParte.get(i) || { pending: 0, done: 0, failed: 0 };
    if (r.pending > 0) pendientes += 1;
    else if (r.failed > 0) fallos += 1;
    else completados += 1;
  }
  const bloquesPending = items.filter((i) => i.estado === 'pending').length;
  const bloquesDone = items.filter((i) => i.estado === 'done').length;
  const bloquesFailed = items.filter((i) => i.estado === 'failed').length;
  const reintentos = items.reduce((suma, i) => suma + (Number(i.reintentos) || 0), 0);
  const conCausa = items.find((i) => i.causa && (i.estado === 'failed' || i.estado === 'pending')) || null;
  const causa = conCausa?.causa || '';
  const lista = nPartes > 0
    && pendientes === 0
    && fallos === 0
    && completados === nPartes
    && bloquesFailed === 0
    && bloquesPending === 0;
  return {
    total: nPartes,
    completados,
    fallos,
    pendientes,
    bloques: {
      pending: bloquesPending,
      done: bloquesDone,
      failed: bloquesFailed,
      total: items.length,
    },
    reintentos,
    causa,
    causaTexto: causa ? etiquetaCausa(causa) : '',
    lista: !!lista,
  };
}

/**
 * Etiqueta visible. Nunca dice «Libro corregido» si queda alguna
 * parte pendiente o fallida.
 */
export function etiquetaColaCorreccion(cola, { ejecutando = false, consentido = true } = {}) {
  if (!consentido) return 'Corrección opcional';
  const r = resumenCola(cola);
  if (!r.total) return 'Solo local';
  if (r.lista && !ejecutando) return 'Libro corregido';
  if (ejecutando) {
    const n = Math.min(r.total, Math.max(0, r.completados));
    return `Corrigiendo lectura ${n} de ${r.total}`;
  }
  const incompletas = r.pendientes + r.fallos;
  const causa = r.causaTexto ? ` · ${r.causaTexto}` : '';
  const reint = r.reintentos > 0
    ? ` · ${r.reintentos} reintento${r.reintentos === 1 ? '' : 's'}`
    : '';
  if (incompletas === 1) return `1 parte pendiente${causa}${reint}`;
  if (incompletas > 1) return `${incompletas} partes pendientes${causa}${reint}`;
  return `Corrigiendo lectura ${r.completados} de ${r.total}`;
}

export function siguienteItem(cola) {
  return (cola?.items || []).find((i) => i.estado === 'pending') || null;
}

function localizar(cola, item) {
  const id = item?.id;
  if (!id) return -1;
  return (cola.items || []).findIndex((i) => i.id === id);
}

export function aplicarExito(cola, item, textoCorregido) {
  const pos = localizar(cola, item);
  if (pos < 0) return cola;
  const it = cola.items[pos];
  it.estado = 'done';
  it.textoCorregido = textoCorregido == null ? it.texto : String(textoCorregido);
  it.causa = '';
  return cola;
}

function siguienteTamano(tamano) {
  const idx = TAMANOS_BLOQUE.indexOf(Number(tamano));
  if (idx < 0) return TAMANOS_BLOQUE[TAMANOS_BLOQUE.length - 1];
  if (idx >= TAMANOS_BLOQUE.length - 1) return null;
  return TAMANOS_BLOQUE[idx + 1];
}

function encogerItem(cola, pos, causa, cortar) {
  const it = cola.items[pos];
  const nuevoTam = siguienteTamano(it.tamano);
  if (!nuevoTam || textoDe(it.texto).length <= nuevoTam) {
    it.estado = 'failed';
    it.textoCorregido = null;
    it.causa = causa;
    return cola;
  }
  const hijos = partirEnBloques(it.texto, nuevoTam, cortar).map((b, bi) => ({
    id: idItem(it.parte, it.desde + b.desde, it.desde + b.hasta),
    parte: it.parte,
    bloque: it.bloque * 100 + bi,
    desde: it.desde + b.desde,
    hasta: it.desde + b.hasta,
    texto: b.texto,
    estado: 'pending',
    tamano: nuevoTam,
    reintentos: 0,
    causa,
    textoCorregido: null,
  }));
  /* El bloque fallido sale de la cola; los hijos van al final para no
   * detener el resto del libro. */
  cola.items.splice(pos, 1);
  cola.items.push(...hijos);
  return cola;
}

/**
 * Un fallo no guarda resultado. Reintenta; si se agota, encoge el bloque;
 * si ya no se puede encoger, deja la parte fallida para reanudar.
 */
export function aplicarFallo(cola, item, error, { cortar, encogerYa = false } = {}) {
  const pos = localizar(cola, item);
  if (pos < 0) return cola;
  const it = cola.items[pos];
  const causa = error?.causa || clasificarCausa(error);
  it.causa = causa;
  it.textoCorregido = null;
  if (!encogerYa) {
    it.reintentos = (Number(it.reintentos) || 0) + 1;
    if (it.reintentos < MAX_REINTENTOS_POR_TAMANO) {
      it.estado = 'pending';
      return cola;
    }
  }
  return encogerItem(cola, pos, causa, cortar);
}

export function prepararReanudacion(cola) {
  for (const it of cola?.items || []) {
    if (it.estado === 'failed') {
      it.estado = 'pending';
      it.reintentos = 0;
    }
  }
  return cola;
}

export function serializarCola(cola) {
  return {
    version: VERSION_COLA_CORRECCION,
    totalPartes: Number(cola?.totalPartes) || 0,
    huellas: Array.isArray(cola?.huellas) ? [...cola.huellas] : [],
    items: (cola?.items || []).map((it) => ({
      id: it.id,
      parte: it.parte,
      bloque: it.bloque,
      desde: it.desde,
      hasta: it.hasta,
      estado: it.estado,
      tamano: it.tamano,
      reintentos: it.reintentos,
      causa: it.causa,
      textoCorregido: it.estado === 'done' ? it.textoCorregido : null,
    })),
  };
}

export function hidratarCola(serializada, partes, { cortar } = {}) {
  const actuales = Array.isArray(partes) ? partes : [];
  if (!serializada || !Array.isArray(serializada.items)
      || Number(serializada.version) !== VERSION_COLA_CORRECCION) {
    return crearColaDesdePartes(actuales, { cortar });
  }
  if (Number(serializada.totalPartes) !== actuales.length) {
    return crearColaDesdePartes(actuales, { cortar });
  }
  const porParte = new Map();
  for (const it of serializada.items) {
    const lista = porParte.get(it.parte) || [];
    lista.push(it);
    porParte.set(it.parte, lista);
  }
  const huellas = serializada.huellas || [];
  const items = [];
  actuales.forEach((parte, indice) => {
    const h = huellaParte(parte?.texto);
    const previos = porParte.get(indice);
    const textoParte = textoDe(parte?.texto);
    let usable = Array.isArray(previos) && previos.length > 0
      && (!huellas[indice] || huellas[indice] === h);
    if (usable) {
      for (const it of previos) {
        const desde = Number(it.desde) || 0;
        const hasta = Number(it.hasta) || 0;
        if (desde < 0 || hasta < desde || hasta > textoParte.length) {
          usable = false;
          break;
        }
      }
    }
    if (!usable) {
      items.push(...crearItemsDeParte(parte, indice, TAMANOS_BLOQUE[0], cortar));
      return;
    }
    for (const it of previos) {
      const desde = Number(it.desde) || 0;
      const hasta = Number(it.hasta) || 0;
      items.push(normalizarItem({
        ...it,
        texto: textoParte.slice(desde, hasta),
        textoCorregido: it.estado === 'done' ? it.textoCorregido : null,
      }));
    }
  });
  return {
    version: VERSION_COLA_CORRECCION,
    totalPartes: actuales.length,
    huellas: actuales.map((p) => huellaParte(p?.texto)),
    items,
  };
}

export function parteCompleta(cola, indice) {
  const de = (cola?.items || []).filter((i) => i.parte === indice);
  return de.length > 0 && de.every((i) => i.estado === 'done');
}

export function textoCorregidoDeParte(cola, indice, fallback = '') {
  const de = (cola?.items || [])
    .filter((i) => i.parte === indice)
    .sort((a, b) => a.desde - b.desde);
  if (!de.length || !de.every((i) => i.estado === 'done')) return fallback;
  return de.map((i) => (i.textoCorregido != null ? i.textoCorregido : i.texto)).join('');
}

export function libroCorregidoEnOrden(cola, partes) {
  return (Array.isArray(partes) ? partes : []).map((p, i) => (
    textoCorregidoDeParte(cola, i, p?.texto || '')
  ));
}

export function componerLibroDesdePartes(partes) {
  const lista = Array.isArray(partes) ? partes : [];
  if (!lista.length) return '';
  let secuencial = lista[0]?.desde != null && lista[0]?.hasta != null;
  if (secuencial) {
    let esperado = lista[0].desde;
    for (const p of lista) {
      if (p.desde !== esperado) { secuencial = false; break; }
      esperado = p.hasta;
    }
  }
  if (secuencial) return lista.map((p) => textoDe(p.texto)).join('');
  return lista.map((p, i) => {
    const t = textoDe(p.texto);
    if (i === 0) return t;
    if (p.continuation) return t;
    return `\n\n${t}`;
  }).join('');
}

/**
 * Conserva todas las palabras. Solo permite uniones autorizadas,
 * puntuación, mayúsculas, tildes y límites de párrafo.
 * Si no pasa, se conserva el original.
 */
export function validarResultadoCorreccion(original, propuesto, candidatosUnion = []) {
  const orig = textoDe(original);
  const prop = textoDe(propuesto);
  if (!prop.trim()) {
    return { ok: false, motivo: 'respuesta_vacia', texto: orig };
  }
  const chequeo = mismasPalabrasLectura(orig, prop, candidatosUnion);
  if (chequeo.igual) return { ok: true, motivo: chequeo.motivo, texto: prop };
  return { ok: false, motivo: chequeo.motivo, texto: orig };
}

/**
 * Recorre la cola. Un fallo no detiene el resto. Persistencia opcional
 * después de cada ítem para poder reanudar tras recargar.
 */
export async function correrCola(cola, {
  pedir,
  persistir,
  validar,
  candidatosDe,
  cortar,
  abortado,
  onAvance,
} = {}) {
  const validarFn = typeof validar === 'function' ? validar : validarResultadoCorreccion;
  if (typeof pedir !== 'function') {
    throw new Error('correrCola necesita una función pedir');
  }
  while (true) {
    if (abortado?.()) return { detenido: true, cola, completa: false };
    const item = siguienteItem(cola);
    if (!item) break;
    try {
      if (!textoDe(item.texto).trim()) {
        aplicarExito(cola, item, item.texto);
      } else {
        const resp = await pedir(item);
        if (!resp || resp.ia_used === false) {
          const err = new Error('el proveedor no confirmó la corrección');
          err.causa = 'proveedor';
          throw err;
        }
        const propuesto = textoDe(resp.texto != null ? resp.texto : resp.text);
        const v = validarFn(item.texto, propuesto, candidatosDe?.(item) || []);
        if (!v.ok) {
          const err = new Error(`validacion:${v.motivo}`);
          err.causa = 'validacion';
          aplicarFallo(cola, item, err, { cortar, encogerYa: true });
        } else {
          aplicarExito(cola, item, v.texto);
        }
      }
    } catch (error) {
      aplicarFallo(cola, item, error, { cortar, encogerYa: clasificarCausa(error) === 'validacion' });
    }
    onAvance?.(cola, item);
    if (persistir) await persistir(cola);
  }
  const r = resumenCola(cola);
  return { detenido: false, cola, completa: r.lista };
}
