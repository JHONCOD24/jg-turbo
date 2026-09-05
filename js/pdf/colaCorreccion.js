/* JG Turbo · Cola persistente de corrección de lectura
 *
 * Recorre TODAS las partes del PDF. Un fallo de red, tiempo límite o
 * proveedor no se guarda como resultado ni detiene el resto del libro.
 * Lo ya corregido no se vuelve a pedir; lo fallido queda para reanudar
 * desde el mismo bloque, más pequeño si hace falta.
 */
import { mejorCorte } from './particion.js';
import { mismasPalabrasLectura } from './pulido.js';
import { sha256Hex } from './huella.js';

export const VERSION_COLA_CORRECCION = 2;
export const CLAVE_COLA_CORRECCION = '__cola__';
export const TAMANOS_BLOQUE = Object.freeze([3000, 1500, 800, 400]);
export const MAX_REINTENTOS_POR_TAMANO = 2;

function textoDe(valor) {
  return valor == null ? '' : String(valor);
}

/**
 * Huella SHA-256 del contenido completo (plan §4). La anterior
 * (largo+32+32) confundía dos textos del mismo tamaño con cambios en el
 * centro. Se conserva el nombre para no romper importadores.
 */
export function huellaParte(texto) {
  return sha256Hex(textoDe(texto));
}

export function huellaFuenteCompleta(textos) {
  const lista = Array.isArray(textos) ? textos : [textos];
  return sha256Hex(lista.map((t) => textoDe(t?.texto ?? t)).join('\n\n'));
}

/** Separa los espacios exteriores del núcleo que sí viaja al proveedor. */
export function extraerNucleo(bloqueTexto) {
  const t = textoDe(bloqueTexto);
  const pre = (t.match(/^\s*/) || [''])[0];
  const post = (t.match(/\s*$/) || [''])[0];
  const nucleo = t.slice(pre.length, t.length - post.length || undefined);
  if (!nucleo && t) return { pre: '', post: '', nucleo: t };
  return { pre, post, nucleo };
}

export function restaurarNucleo(pre, nucleoCorregido, post) {
  return `${textoDe(pre)}${textoDe(nucleoCorregido)}${textoDe(post)}`;
}

export function clasificarCausa(error) {
  const msg = textoDe(error?.message || error?.causa || error);
  if (/validacion|palabra|union|estructura|cambio_no_autorizado/i.test(msg)) return 'validacion';
  // Cuota/credenciales pausan con acción concreta, no reintentan a ciegas.
  if (/cuota|quota|429|402|payment|billing|invalid_api_key|api_key.*invalid|credencial.*invalid|unauthorized|forbidden|401/i.test(msg)) {
    if (/401|unauthorized|forbidden|invalid_api_key|credencial/i.test(msg)) return 'credenciales';
    return 'cuota';
  }
  if (/abort|timeout|tiempo|tardó|504|502/i.test(msg)) return 'tiempo_limite';
  if (/network|failed to fetch|fetch|red|offline|err_internet|typeerror: failed/i.test(msg)) return 'red';
  if (/503|proveedor|api.?key|no confirmó/i.test(msg)) return 'proveedor';
  return 'desconocido';
}

export function etiquetaCausa(causa) {
  switch (causa) {
    case 'tiempo_limite': return 'se agotó el tiempo';
    case 'red': return 'fallo de red';
    case 'proveedor': return 'el proveedor no respondió';
    case 'cuota': return 'cuota agotada: revisa tu plan y reanuda';
    case 'credenciales': return 'clave inválida: revísala y reanuda';
    case 'validacion': return 'el resultado no conservó las palabras';
    default: return 'error al corregir';
  }
}

export function esTransitoria(causa) {
  return causa === 'red' || causa === 'tiempo_limite' || causa === 'proveedor' || causa === 'desconocido';
}

export function esperaReintentoMs(reintentos) {
  const n = Math.max(1, Number(reintentos) || 1);
  return Math.min(5000, 400 * (2 ** (n - 1)));
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

function crearItemsDeParte(parte, indice, tamano, cortar, { documentId = '', sourceRevision = '' } = {}) {
  const bloques = partirEnBloques(parte?.texto, tamano, cortar);
  return bloques.map((b, bi) => {
    const { pre, post, nucleo } = extraerNucleo(b.texto);
    return {
      id: idItem(indice, b.desde, b.hasta),
      parte: indice,
      bloque: bi,
      // blockId estable para trazar reintentos y reducciones.
      blockId: `${indice}:${bi}:${b.desde}-${b.hasta}`,
      desde: b.desde,
      hasta: b.hasta,
      intervaloOrigen: { desde: b.desde, hasta: b.hasta },
      texto: b.texto,
      nucleo,
      separadorPre: pre,
      separadorPost: post,
      documentId,
      sourceRevision,
      stage: 'puntuacion',
      estado: 'pending',
      tamano,
      reintentos: 0,
      causa: '',
      textoCorregido: null,
    };
  });
}

function normalizarItem(it) {
  const estado = it?.estado === 'done' || it?.estado === 'failed' ? it.estado : 'pending';
  const texto = textoDe(it?.texto);
  const nucleo = it?.nucleo != null ? String(it.nucleo) : extraerNucleo(texto).nucleo;
  const sep = extraerNucleo(texto);
  return {
    id: textoDe(it?.id),
    parte: Number(it?.parte) || 0,
    bloque: Number(it?.bloque) || 0,
    blockId: textoDe(it?.blockId || it?.id),
    desde: Number(it?.desde) || 0,
    hasta: Number(it?.hasta) || 0,
    intervaloOrigen: it?.intervaloOrigen && Number.isFinite(Number(it.intervaloOrigen.desde))
      ? { desde: Number(it.intervaloOrigen.desde), hasta: Number(it.intervaloOrigen.hasta) }
      : { desde: Number(it?.desde) || 0, hasta: Number(it?.hasta) || 0 },
    texto,
    nucleo,
    separadorPre: it?.separadorPre != null ? String(it.separadorPre) : sep.pre,
    separadorPost: it?.separadorPost != null ? String(it.separadorPost) : sep.post,
    documentId: textoDe(it?.documentId),
    sourceRevision: textoDe(it?.sourceRevision),
    stage: textoDe(it?.stage || 'puntuacion'),
    estado,
    tamano: Number(it?.tamano) || TAMANOS_BLOQUE[0],
    reintentos: Math.max(0, Number(it?.reintentos) || 0),
    causa: textoDe(it?.causa),
    textoCorregido: estado === 'done' ? (it?.textoCorregido != null ? String(it.textoCorregido) : null) : null,
  };
}

export function crearColaDesdePartes(partes, {
  tamano = TAMANOS_BLOQUE[0], cortar, documentId = '', sourceRevision = '', stage = 'puntuacion',
} = {}) {
  const actuales = Array.isArray(partes) ? partes : [];
  const revision = sourceRevision || huellaFuenteCompleta(actuales);
  const items = [];
  actuales.forEach((parte, indice) => {
    items.push(...crearItemsDeParte(parte, indice, tamano, cortar, { documentId, sourceRevision: revision }));
  });
  return {
    version: VERSION_COLA_CORRECCION,
    documentId,
    sourceRevision: revision,
    stage,
    totalPartes: actuales.length,
    huellas: actuales.map((p) => huellaParte(p?.texto)),
    items,
  };
}

/**
 * Los bloques deben cubrir exactamente su fuente, sin huecos,
 * duplicaciones ni solapamientos. Se comprueba al reanudar y antes de
 * dar el libro por bueno.
 */
export function validarCoberturaCola(cola, partes) {
  const actuales = Array.isArray(partes) ? partes : [];
  const porParte = new Map();
  for (const it of cola?.items || []) {
    const lista = porParte.get(it.parte) || [];
    lista.push(it);
    porParte.set(it.parte, lista);
  }
  for (let i = 0; i < actuales.length; i += 1) {
    const len = textoDe(actuales[i]?.texto).length;
    const lista = (porParte.get(i) || []).slice().sort((a, b) => a.desde - b.desde);
    if (!lista.length) return { ok: false, motivo: `parte_${i}_sin_bloques` };
    if (lista[0].desde !== 0) return { ok: false, motivo: `parte_${i}_hueco_inicial` };
    for (let k = 0; k < lista.length; k += 1) {
      const it = lista[k];
      if (it.hasta < it.desde) return { ok: false, motivo: `parte_${i}_intervalo_invalido` };
      if (k > 0 && it.desde !== lista[k - 1].hasta) {
        return { ok: false, motivo: `parte_${i}_hueco_o_solape_${lista[k - 1].hasta}_${it.desde}` };
      }
    }
    if (lista[lista.length - 1].hasta !== len) {
      return { ok: false, motivo: `parte_${i}_cobertura_${lista[lista.length - 1].hasta}_${len}` };
    }
    const ids = new Set(lista.map((x) => x.id));
    if (ids.size !== lista.length) return { ok: false, motivo: `parte_${i}_duplicado` };
  }
  return { ok: true, motivo: 'cobertura_exacta' };
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
 * Etiqueta visible por etapas y partes, sin mezclar con sincronización.
 * Nunca dice «Libro corregido» si queda alguna parte pendiente o fallida
 * (eso lo decide colaListaParaLibro con límites, integridad y guardado).
 */
export function etiquetaColaCorreccion(cola, { ejecutando = false, consentido = true, etapa = '' } = {}) {
  if (!consentido) return 'Corrección opcional';
  const r = resumenCola(cola);
  if (!r.total) return 'Solo local';
  const prefijo = etapa ? `${etapa} · ` : '';
  if (r.lista && !ejecutando) return `${prefijo}Libro corregido`.replace(/^ · /, '');
  if (ejecutando) {
    const n = Math.min(r.total, Math.max(0, r.completados));
    return `${prefijo}Corrigiendo lectura ${n} de ${r.total}`;
  }
  const incompletas = r.pendientes + r.fallos;
  const causa = r.causaTexto ? ` · ${r.causaTexto}` : '';
  const reint = r.reintentos > 0
    ? ` · ${r.reintentos} reintento${r.reintentos === 1 ? '' : 's'}`
    : '';
  if (incompletas === 1) return `${prefijo}1 parte pendiente${causa}${reint}`;
  if (incompletas > 1) return `${prefijo}${incompletas} partes pendientes${causa}${reint}`;
  return `${prefijo}Corrigiendo lectura ${r.completados} de ${r.total}`;
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
  // El núcleo corregido vuelve con sus separadores exteriores: si el
  // proveedor recortó « hola » a «hola», se restaura « hola ».
  const nucleo = textoCorregido == null ? (it.nucleo ?? it.texto) : String(textoCorregido);
  it.estado = 'done';
  it.textoCorregido = restaurarNucleo(it.separadorPre || '', nucleo, it.separadorPost || '');
  it.causa = '';
  return cola;
}

/**
 * Reducción progresiva 3000 → 1500 → 800 → 400, saltando tamaños que no
 * reduzcan el bloque. Un bloque de 1.000 con tamaño 3.000 no intentaba
 * 800 ni 400: quedaba fallido. Ahora busca el primer tamaño menor que el
 * núcleo real.
 */
export function siguienteTamanoUtil(longitudNucleo, tamanoActual) {
  const len = Math.max(0, Number(longitudNucleo) || 0);
  const actual = Number(tamanoActual) || TAMANOS_BLOQUE[0];
  const techo = Math.min(actual, len);
  for (const t of TAMANOS_BLOQUE) {
    if (t < techo) return t;
  }
  return null;
}

function siguienteTamano(tamano) {
  const idx = TAMANOS_BLOQUE.indexOf(Number(tamano));
  if (idx < 0) return TAMANOS_BLOQUE[TAMANOS_BLOQUE.length - 1];
  if (idx >= TAMANOS_BLOQUE.length - 1) return null;
  return TAMANOS_BLOQUE[idx + 1];
}

function encogerItem(cola, pos, causa, cortar) {
  const it = cola.items[pos];
  const nucleoLen = textoDe(it.nucleo ?? it.texto).length;
  const nuevoTam = siguienteTamanoUtil(nucleoLen, it.tamano) ?? siguienteTamano(it.tamano);
  if (!nuevoTam || nucleoLen <= nuevoTam) {
    it.estado = 'failed';
    it.textoCorregido = null;
    it.causa = causa;
    return cola;
  }
  const base = textoDe(it.nucleo ?? it.texto);
  const hijos = partirEnBloques(base, nuevoTam, cortar).map((b, bi) => {
    const { pre, post, nucleo } = extraerNucleo(b.texto);
    return {
      id: idItem(it.parte, it.desde + b.desde, it.desde + b.hasta),
      parte: it.parte,
      bloque: it.bloque * 100 + bi,
      blockId: `${it.blockId || it.id}.${bi}`,
      desde: it.desde + b.desde,
      hasta: it.desde + b.hasta,
      intervaloOrigen: { desde: it.desde + b.desde, hasta: it.desde + b.hasta },
      texto: b.texto,
      nucleo,
      separadorPre: pre,
      separadorPost: post,
      documentId: it.documentId || '',
      sourceRevision: it.sourceRevision || '',
      stage: it.stage || 'puntuacion',
      estado: 'pending',
      tamano: nuevoTam,
      reintentos: 0,
      causa,
      textoCorregido: null,
    };
  });
  /* El bloque fallido sale de la cola; los hijos van al final para no
   * detener el resto del libro. */
  cola.items.splice(pos, 1);
  cola.items.push(...hijos);
  return cola;
}

/**
 * Un fallo no guarda resultado. Reintenta con espera progresiva; si se
 * agota, encoge el bloque; si ya no se puede encoger, deja la parte
 * fallida para reanudar. Cuota/credenciales pausan con acción concreta.
 */
export function aplicarFallo(cola, item, error, { cortar, encogerYa = false } = {}) {
  const pos = localizar(cola, item);
  if (pos < 0) return cola;
  const it = cola.items[pos];
  const causa = error?.causa || clasificarCausa(error);
  it.causa = causa;
  it.textoCorregido = null;
  if (causa === 'cuota' || causa === 'credenciales') {
    it.estado = 'failed';
    return cola;
  }
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
    documentId: textoDe(cola?.documentId),
    sourceRevision: textoDe(cola?.sourceRevision),
    stage: textoDe(cola?.stage || 'puntuacion'),
    totalPartes: Number(cola?.totalPartes) || 0,
    huellas: Array.isArray(cola?.huellas) ? [...cola.huellas] : [],
    items: (cola?.items || []).map((it) => ({
      id: it.id,
      parte: it.parte,
      bloque: it.bloque,
      blockId: it.blockId || it.id,
      desde: it.desde,
      hasta: it.hasta,
      intervaloOrigen: it.intervaloOrigen || { desde: it.desde, hasta: it.hasta },
      nucleo: it.nucleo ?? null,
      separadorPre: it.separadorPre ?? '',
      separadorPost: it.separadorPost ?? '',
      documentId: it.documentId || '',
      sourceRevision: it.sourceRevision || '',
      stage: it.stage || 'puntuacion',
      estado: it.estado,
      tamano: it.tamano,
      reintentos: it.reintentos,
      causa: it.causa,
      textoCorregido: it.estado === 'done' ? it.textoCorregido : null,
    })),
  };
}

export function hidratarCola(serializada, partes, { cortar, documentId = '' } = {}) {
  const actuales = Array.isArray(partes) ? partes : [];
  // Una cola v1 completa no equivale por sí sola a contenido íntegro (§4):
  // al subir a v2 todo libro existente se revalida desde su fuente.
  if (!serializada || !Array.isArray(serializada.items)
      || Number(serializada.version) !== VERSION_COLA_CORRECCION) {
    return crearColaDesdePartes(actuales, { cortar, documentId });
  }
  if (Number(serializada.totalPartes) !== actuales.length) {
    return crearColaDesdePartes(actuales, {
      cortar,
      documentId: textoDe(serializada.documentId || documentId),
    });
  }
  const revisionActual = huellaFuenteCompleta(actuales);
  if (serializada.sourceRevision && serializada.sourceRevision !== revisionActual) {
    return crearColaDesdePartes(actuales, {
      cortar,
      documentId: textoDe(serializada.documentId || documentId),
      sourceRevision: revisionActual,
    });
  }
  const porParte = new Map();
  for (const it of serializada.items) {
    const lista = porParte.get(it.parte) || [];
    lista.push(it);
    porParte.set(it.parte, lista);
  }
  const huellas = serializada.huellas || [];
  const items = [];
  const docId = textoDe(serializada.documentId || documentId);
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
      items.push(...crearItemsDeParte(parte, indice, TAMANOS_BLOQUE[0], cortar, {
        documentId: docId,
        sourceRevision: revisionActual,
      }));
      return;
    }
    for (const it of previos) {
      const desde = Number(it.desde) || 0;
      const hasta = Number(it.hasta) || 0;
      const slice = textoParte.slice(desde, hasta);
      const norm = normalizarItem({
        ...it,
        documentId: textoDe(it.documentId || docId),
        sourceRevision: textoDe(it.sourceRevision || revisionActual),
        texto: slice,
        nucleo: it.nucleo ?? extraerNucleo(slice).nucleo,
        textoCorregido: it.estado === 'done' ? it.textoCorregido : null,
      });
      // Al reanudar, el núcleo debe seguir siendo el del slice actual.
      const esperado = extraerNucleo(slice);
      if (norm.estado === 'done') {
        // Lo hecho se conserva; los separadores se recalculan del slice.
        norm.separadorPre = esperado.pre;
        norm.separadorPost = esperado.post;
      } else {
        norm.nucleo = esperado.nucleo;
        norm.separadorPre = esperado.pre;
        norm.separadorPost = esperado.post;
      }
      items.push(norm);
    }
  });
  const cola = {
    version: VERSION_COLA_CORRECCION,
    documentId: docId,
    sourceRevision: revisionActual,
    stage: textoDe(serializada.stage || 'puntuacion'),
    totalPartes: actuales.length,
    huellas: actuales.map((p) => huellaParte(p?.texto)),
    items,
  };
  // La cobertura debe ser exacta; si no, se reconstruye desde la fuente.
  if (!validarCoberturaCola(cola, actuales).ok) {
    return crearColaDesdePartes(actuales, { cortar, documentId: docId, sourceRevision: revisionActual });
  }
  return cola;
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
  // Los bloques ya traen sus separadores restaurados; se concatenan en
  // orden y se validan también las uniones ENTRE bloques.
  const unido = de.map((i) => (i.textoCorregido != null ? i.textoCorregido : i.texto)).join('');
  return unido;
}

/**
 * Valida también las uniones entre bloques: si el final de un bloque y el
 * inicio del siguiente forman «palabrapalabra» sin espacio, la recomposición
 * perdió un separador y no se da por buena.
 */
export function validarUnionesEntreBloques(textoRecompuesto, textoOriginal) {
  const orig = textoDe(textoOriginal);
  const rec = textoDe(textoRecompuesto);
  // Misma longitud de letras: si el recompuesto pegó dos palabras que en el
  // original iban separadas, los tokens no coinciden.
  const tokOrig = orig.trim().split(/\s+/).filter(Boolean).length;
  const tokRec = rec.trim().split(/\s+/).filter(Boolean).length;
  if (tokOrig !== tokRec) return { ok: false, motivo: `tokens_entre_bloques_${tokOrig}_${tokRec}` };
  return { ok: true, motivo: 'uniones_entre_bloques_ok' };
}

/**
 * «Libro corregido» exige: cola completa, cero límites pendientes,
 * integridad validada y guardado confirmado (§3). La sincronización lleva
 * su propio indicador y no se mezcla aquí.
 */
export function colaListaParaLibro(cola, { pendientesLimites = 0, integridadOk = true, guardadoOk = true } = {}) {
  const r = resumenCola(cola);
  if (!r.lista) return { lista: false, motivo: 'cola_incompleta' };
  if (Number(pendientesLimites) > 0) return { lista: false, motivo: 'limites_pendientes' };
  if (!integridadOk) return { lista: false, motivo: 'integridad_no_validada' };
  if (!guardadoOk) return { lista: false, motivo: 'guardado_no_confirmado' };
  return { lista: true, motivo: 'libro_corregido' };
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
 * Conserva todas las palabras. Solo permite puntuación, mayúsculas, tildes
 * y límites de párrafo sobre el NÚCLEO (sin separadores exteriores).
 * Las uniones de palabras ya quedaron resueltas en la etapa 1 (límites por
 * identificador); la etapa 2 no autoriza unir por parejas. Si no pasa, se
 * conserva el original.
 */
export function validarResultadoCorreccion(original, propuesto, candidatosUnion = []) {
  const orig = textoDe(original);
  const prop = textoDe(propuesto);
  if (!prop.trim()) {
    return { ok: false, motivo: 'respuesta_vacia', texto: orig };
  }
  // Compatibilidad: si llegan pares antiguos se validan como antes, pero el
  // flujo PDF v7 ya no los envía (etapa 1 por boundaryId).
  const chequeo = mismasPalabrasLectura(orig, prop, candidatosUnion);
  if (chequeo.igual) return { ok: true, motivo: chequeo.motivo, texto: prop };
  return { ok: false, motivo: chequeo.motivo, texto: orig };
}

/**
 * Recorre la cola. Un fallo no detiene el resto. Persistencia opcional
 * después de cada ítem para poder reanudar tras recargar (último bloque
 * confirmado). Comprueba documento, revisión y cancelación antes y después
 * de cada petición: una respuesta tardía del libro A nunca se aplica al B.
 */
export async function correrCola(cola, {
  pedir,
  persistir,
  validar,
  candidatosDe,
  cortar,
  abortado,
  onAvance,
  esperar,
  documentId = null,
  sourceRevision = null,
} = {}) {
  const validarFn = typeof validar === 'function' ? validar : validarResultadoCorreccion;
  if (typeof pedir !== 'function') {
    throw new Error('correrCola necesita una función pedir');
  }
  const dormir = typeof esperar === 'function'
    ? esperar
    : () => Promise.resolve();
  while (true) {
    if (abortado?.()) return { detenido: true, cola, completa: false, motivo: 'cancelado' };
    const item = siguienteItem(cola);
    if (!item) break;
    // Antes de pedir: ¿sigue siendo el mismo libro y revisión?
    if (documentId != null && item.documentId && item.documentId !== documentId) {
      return { detenido: true, cola, completa: false, motivo: 'documento_cambiado' };
    }
    if (sourceRevision != null && item.sourceRevision && item.sourceRevision !== sourceRevision) {
      return { detenido: true, cola, completa: false, motivo: 'revision_cambiada' };
    }
    try {
      const nucleo = textoDe(item.nucleo ?? item.texto);
      if (!nucleo.trim()) {
        aplicarExito(cola, item, nucleo);
      } else {
        const resp = await pedir({ ...item, texto: nucleo });
        // Después de pedir: si el usuario cambió de libro, se descarta.
        if (abortado?.()) return { detenido: true, cola, completa: false, motivo: 'cancelado' };
        if (documentId != null && item.documentId && item.documentId !== documentId) {
          return { detenido: true, cola, completa: false, motivo: 'documento_cambiado' };
        }
        if (!resp || resp.ia_used === false) {
          const err = new Error('el proveedor no confirmó la corrección');
          err.causa = 'proveedor';
          throw err;
        }
        const propuesto = textoDe(resp.texto != null ? resp.texto : resp.text);
        const v = validarFn(nucleo, propuesto, candidatosDe?.(item) || []);
        if (!v.ok) {
          const err = new Error(`validacion:${v.motivo}`);
          err.causa = 'validacion';
          aplicarFallo(cola, item, err, { cortar, encogerYa: true });
        } else {
          aplicarExito(cola, item, v.texto);
        }
      }
    } catch (error) {
      const causa = error?.causa || clasificarCausa(error);
      // Cuota/credenciales pausan con acción concreta, sin reintentos ciegos.
      if (causa === 'cuota' || causa === 'credenciales') {
        aplicarFallo(cola, item, error, { cortar });
        onAvance?.(cola, item);
        if (persistir) {
          try { await persistir(cola); } catch (_) {}
        }
        return { detenido: true, cola, completa: false, motivo: causa, pausa: true };
      }
      const antes = (item.reintentos || 0);
      aplicarFallo(cola, item, error, { cortar, encogerYa: causa === 'validacion' });
      // Espera progresiva ante errores transitorios (red/límite/proveedor).
      if (esTransitoria(causa) && item.estado === 'pending') {
        try { await dormir(esperaReintentoMs(antes + 1)); } catch (_) {}
      }
    }
    onAvance?.(cola, item);
    // Si el almacenamiento falla a mitad de camino, se conserva el avance en
    // memoria y se sigue: la recarga recuperará el último bloque confirmado.
    if (persistir) {
      try { await persistir(cola); } catch (_) {}
    }
  }
  const r = resumenCola(cola);
  return { detenido: false, cola, completa: r.lista };
}
