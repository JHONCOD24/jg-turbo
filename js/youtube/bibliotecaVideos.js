/**
 * Biblioteca de videos doblados: reglas puras, sin IndexedDB ni DOM, para
 * probarlas en Node. El almacenamiento vive en cacheDoblaje.js y la vista en
 * bibliotecaVista.js.
 *
 * Regla que no se rompe: lo automático (título, duración, posición) se
 * actualiza solo; lo que organizó la persona (etiquetas, favorito) solo lo
 * cambia ella. `fusionarEntrada` nunca toca esos dos campos.
 */
export const MAX_ETIQUETAS = 10;
export const MAX_LARGO_ETIQUETA = 30;
/** Los temas que más dobla el dueño (PRODUCT.md): se ofrecen de arranque, no se imponen. */
export const ETIQUETAS_SUGERIDAS = Object.freeze(['Inteligencia artificial', 'Aprender', 'Negocio']);
export const UMBRAL_EMPEZADO_S = 15;
export const MARGEN_FINAL_S = 30;
export const ORDENES = Object.freeze(['recientes', 'antiguos', 'titulo', 'duracion']);
export const VISTAS = Object.freeze(['todos', 'favoritos', 'viendo', 'vistos']);

export function normalizarTexto(texto) {
  return String(texto ?? '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/\s+/g, ' ').trim();
}

export function limpiarEtiqueta(texto) {
  const limpia = String(texto ?? '').replace(/[#,;]/g, ' ').replace(/\s+/g, ' ').trim()
    .slice(0, MAX_LARGO_ETIQUETA).trim();
  return limpia ? limpia.charAt(0).toLocaleUpperCase('es') + limpia.slice(1) : '';
}

/** `motivo`: '' si se agregó · 'vacia' · 'repetida' · 'tope' (para decirlo en la interfaz). */
export function agregarEtiqueta(etiquetas, nueva) {
  const lista = Array.isArray(etiquetas) ? [...etiquetas] : [];
  const limpia = limpiarEtiqueta(nueva);
  if (!limpia) return { etiquetas: lista, motivo: 'vacia' };
  if (lista.some((e) => normalizarTexto(e) === normalizarTexto(limpia))) return { etiquetas: lista, motivo: 'repetida' };
  if (lista.length >= MAX_ETIQUETAS) return { etiquetas: lista, motivo: 'tope' };
  return { etiquetas: [...lista, limpia], motivo: '' };
}

export function quitarEtiqueta(etiquetas, etiqueta) {
  const clave = normalizarTexto(etiqueta);
  return (Array.isArray(etiquetas) ? etiquetas : []).filter((e) => normalizarTexto(e) !== clave);
}

export function estadoDeAvance(posicionS, duracionS) {
  const posicion = Number(posicionS) || 0;
  const duracion = Number(duracionS) || 0;
  if (posicion < UMBRAL_EMPEZADO_S) return 'nuevo';
  if (duracion > 0 && (posicion >= duracion - MARGEN_FINAL_S || posicion / duracion >= 0.95)) return 'visto';
  return 'viendo';
}

export function fraccionVista(posicionS, duracionS) {
  const duracion = Number(duracionS) || 0;
  if (!duracion) return 0;
  if (estadoDeAvance(posicionS, duracion) === 'visto') return 1;
  return Math.max(0, Math.min(1, (Number(posicionS) || 0) / duracion));
}

/** La clave de caché dice la plataforma: YouTube = id tal cual; X = «x:<id>» o «x:<id>:<n>». */
export function datosDeClave(clave) {
  const texto = String(clave || '');
  if (texto.startsWith('x:')) {
    const [, id = '', n = '0'] = texto.split(':');
    return { plataforma: 'x', id, indice: Number(n) || 0 };
  }
  return { plataforma: 'youtube', id: texto, indice: 0 };
}

export function urlCanonica({ plataforma, id, indice = 0 }) {
  if (plataforma === 'x') return `https://x.com/i/status/${id}${indice ? `/video/${indice + 1}` : ''}`;
  return `https://www.youtube.com/watch?v=${id}`;
}

export function portadaPorDefecto({ plataforma, id }) {
  return plataforma === 'youtube' && id ? `https://i.ytimg.com/vi/${encodeURIComponent(id)}/mqdefault.jpg` : '';
}

/** Une lo que ya había con lo nuevo. Nunca toca `etiquetas` ni `favorito`. */
export function fusionarEntrada(previa, nueva, ahora = Date.now()) {
  const base = previa || {};
  const clave = nueva?.clave ?? base.clave;
  const datos = datosDeClave(clave);
  const duracionS = Number(nueva?.duracionS) || Number(base.duracionS) || 0;
  const posicionS = Number(nueva?.posicionS ?? base.posicionS) || 0;
  const tituloPorDefecto = datos.plataforma === 'x' ? 'Video de X' : 'Video de YouTube';
  return {
    clave,
    plataforma: datos.plataforma,
    id: datos.id,
    indice: datos.indice,
    url: urlCanonica(datos),
    titulo: String(nueva?.titulo || base.titulo || '').trim() || tituloPorDefecto,
    autor: String(nueva?.autor || base.autor || '').trim(),
    portada: nueva?.portada || base.portada || portadaPorDefecto(datos),
    duracionS,
    idiomaOrigen: nueva?.idiomaOrigen || base.idiomaOrigen || '',
    voz: nueva?.voz || base.voz || '',
    // 2.ª voz de los diálogos tal como sonó: 'ninguna' = todo con la principal.
    // undefined en fichas anteriores a la auditoría (entonces, la del otro género).
    vozSecundaria: nueva?.vozSecundaria ?? base.vozSecundaria,
    etiquetas: Array.isArray(base.etiquetas) ? base.etiquetas : [],
    favorito: Boolean(base.favorito),
    posicionS,
    estado: estadoDeAvance(posicionS, duracionS),
    creado: base.creado || nueva?.creado || ahora,
    abierto: nueva?.abierto ?? base.abierto ?? ahora,
    actualizado: ahora,
  };
}

/** Migración v1 → v2: cada doblaje ya guardado entra a la biblioteca. */
export function entradaDesdeDoblaje(registro, ahora = Date.now()) {
  const cuando = Number(registro?.actualizado) || ahora;
  return fusionarEntrada(null, {
    clave: registro?.videoId,
    titulo: registro?.titulo,
    duracionS: registro?.duracionS,
    idiomaOrigen: registro?.idiomaOrigen,
    posicionS: registro?.posicionS,
    creado: cuando,
    abierto: cuando,
  }, cuando);
}

function compararPor(orden) {
  const titulo = (a, b) => String(a.titulo || '').localeCompare(String(b.titulo || ''), 'es', { sensitivity: 'base' });
  if (orden === 'antiguos') return (a, b) => (a.creado || 0) - (b.creado || 0) || titulo(a, b);
  if (orden === 'titulo') return (a, b) => titulo(a, b) || (b.abierto || 0) - (a.abierto || 0);
  if (orden === 'duracion') return (a, b) => (b.duracionS || 0) - (a.duracionS || 0) || titulo(a, b);
  return (a, b) => (b.abierto || 0) - (a.abierto || 0) || titulo(a, b);
}

/**
 * `coincidenEnTexto`: Map clave → coincidencia de `buscarEnTranscripcion`
 * (solo cuando la persona activó «Buscar también en lo que se dice»).
 */
export function filtrarVideos(videos, {
  texto = '', plataforma = 'todas', vista = 'todos', etiqueta = '', orden = 'recientes', coincidenEnTexto = null,
} = {}) {
  const palabras = normalizarTexto(texto).split(' ').filter(Boolean);
  const etiquetaBuscada = normalizarTexto(etiqueta);
  const lista = (Array.isArray(videos) ? videos : []).filter((video) => {
    if (plataforma !== 'todas' && video.plataforma !== plataforma) return false;
    if (vista === 'favoritos' && !video.favorito) return false;
    if (vista === 'viendo' && video.estado !== 'viendo') return false;
    if (vista === 'vistos' && video.estado !== 'visto') return false;
    if (etiquetaBuscada && !(video.etiquetas || []).some((e) => normalizarTexto(e) === etiquetaBuscada)) return false;
    if (!palabras.length) return true;
    const pajar = normalizarTexto([video.titulo, video.autor, ...(video.etiquetas || []), video.id].join(' '));
    return palabras.every((p) => pajar.includes(p)) || Boolean(coincidenEnTexto?.has(video.clave));
  });
  return lista.sort(compararPor(ORDENES.includes(orden) ? orden : 'recientes'));
}

export function etiquetasConConteo(videos) {
  const conteo = new Map();
  for (const video of Array.isArray(videos) ? videos : []) {
    for (const etiqueta of video.etiquetas || []) {
      const clave = normalizarTexto(etiqueta);
      const previo = conteo.get(clave);
      conteo.set(clave, { etiqueta: previo?.etiqueta || etiqueta, cantidad: (previo?.cantidad || 0) + 1 });
    }
  }
  return [...conteo.values()].sort((a, b) => b.cantidad - a.cantidad || a.etiqueta.localeCompare(b.etiqueta, 'es'));
}

/** Sugerencias para el editor: primero las que ya usa, luego las de arranque, sin repetir las del video. */
export function sugerenciasDeEtiquetas(videos, actuales = [], escrito = '') {
  const usadas = new Set((actuales || []).map(normalizarTexto));
  const consulta = normalizarTexto(escrito);
  const candidatas = [...etiquetasConConteo(videos).map((e) => e.etiqueta), ...ETIQUETAS_SUGERIDAS];
  const vistas = new Set();
  return candidatas.filter((e) => {
    const clave = normalizarTexto(e);
    if (usadas.has(clave) || vistas.has(clave)) return false;
    vistas.add(clave);
    return !consulta || clave.includes(consulta);
  }).slice(0, 8);
}

export function seguirViendo(videos) {
  return (Array.isArray(videos) ? videos : [])
    .filter((v) => v.estado === 'viendo')
    .sort((a, b) => (b.abierto || 0) - (a.abierto || 0))[0] || null;
}

/**
 * Busca en lo que se dice (texto original y traducción guardada). Devuelve
 * dónde: la tarjeta ofrece abrir el video en ese segundo.
 */
export function buscarEnTranscripcion(registro, texto) {
  const palabras = normalizarTexto(texto).split(' ').filter(Boolean);
  if (!palabras.length || !registro) return null;
  const traducciones = new Map(Array.isArray(registro.traducciones) ? registro.traducciones : []);
  const segmentos = Array.isArray(registro.segmentos) ? registro.segmentos : [];
  for (let i = 0; i < segmentos.length; i += 1) {
    const traducido = traducciones.get(i);
    for (const frase of [traducido, segmentos[i]?.text]) {
      if (!frase) continue;
      const normal = normalizarTexto(frase);
      if (palabras.every((p) => normal.includes(p))) {
        return { indice: i, segundo: Number(segmentos[i].startTime) || 0, fragmento: String(frase).slice(0, 140) };
      }
    }
  }
  return null;
}

/** Huella corta (FNV-1a de 32 bits) del texto de una frase: si la traducción cambia, la voz guardada ya no sirve. */
export function huellaTexto(texto) {
  let h = 0x811c9dc5;
  for (const c of String(texto ?? '')) {
    h ^= c.codePointAt(0);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(36);
}

/** Clave de una frase de voz guardada: video + voz + texto exacto (y velocidad, si no es 1×). */
export function claveDeVoz(claveVideo, voz, texto, tasa = 1) {
  const velocidad = Math.abs((Number(tasa) || 1) - 1) < 0.001 ? '' : `|${Number(tasa).toFixed(2)}`;
  return `${claveVideo}|${voz}|${huellaTexto(texto)}${velocidad}`;
}

export function formatearDuracion(segundos) {
  const total = Math.max(0, Math.round(Number(segundos) || 0));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
}

export function fechaRelativa(ms, ahora = Date.now()) {
  const dia = (t) => { const d = new Date(t); return Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()); };
  const dias = Math.round((dia(ahora) - dia(ms)) / 86400000);
  if (dias <= 0) return 'Hoy';
  if (dias === 1) return 'Ayer';
  if (dias < 7) return `Hace ${dias} días`;
  const fecha = new Date(ms);
  const mismoAno = fecha.getFullYear() === new Date(ahora).getFullYear();
  return fecha.toLocaleDateString('es-CO', { day: 'numeric', month: 'short', ...(mismoAno ? {} : { year: 'numeric' }) }).replace('.', '');
}
