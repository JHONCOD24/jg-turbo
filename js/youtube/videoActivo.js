/**
 * El «video activo»: cuál video tenía abierto la persona y en qué segundo iba,
 * para que sobreviva a recargar la página, cerrar la app o cambiar de pestaña.
 *
 * Vive en `localStorage` (clave nueva, no toca ninguna existente) y es SOLO un
 * puntero: el doblaje, las traducciones y la voz siguen en la caché de
 * IndexedDB (`cacheDoblaje.js`). Restaurar = abrir ese video por el camino de
 * siempre; la caché evita volver a gastar texto, traducción y voz.
 *
 * Funciones puras con el almacenamiento inyectable, para probarlas sin navegador.
 */
export const CLAVE_VIDEO_ACTIVO = 'jg_yt_video_activo';
export const TIPOS_VIDEO_ACTIVO = Object.freeze(['youtube', 'x', 'archivo']);

const aTexto = (valor, tope) => (typeof valor === 'string' ? valor.slice(0, tope) : '');

/** Devuelve el registro limpio o `null` si no sirve (nunca lanza: viene de un almacenamiento que puede estar roto). */
export function normalizarVideoActivo(crudo) {
  if (!crudo || typeof crudo !== 'object') return null;
  const tipo = TIPOS_VIDEO_ACTIVO.includes(crudo.tipo) ? crudo.tipo : '';
  const clave = aTexto(crudo.clave, 200).trim();
  if (!tipo || !clave) return null;
  const url = aTexto(crudo.url, 2000).trim();
  if (tipo !== 'archivo' && !url) return null;   // YouTube y X se reabren por su enlace
  const segundo = Number(crudo.segundo);
  const registro = {
    tipo,
    clave,
    url,
    segundo: Number.isFinite(segundo) && segundo > 0 ? Math.floor(segundo) : 0,
    titulo: aTexto(crudo.titulo, 300),
    actualizado: Number.isFinite(Number(crudo.actualizado)) ? Number(crudo.actualizado) : 0,
    preparando: Boolean(crudo.preparando),
  };
  if (tipo === 'archivo') {
    registro.nombreArchivo = aTexto(crudo.nombreArchivo, 300);
    const bytes = Number(crudo.bytes);
    registro.bytes = Number.isFinite(bytes) && bytes > 0 ? bytes : 0;
  }
  return registro;
}

const almacenPorDefecto = () => {
  try { return globalThis.localStorage || null; } catch (_) { return null; }
};

export function leerVideoActivo(almacen = almacenPorDefecto()) {
  try {
    const crudo = almacen?.getItem(CLAVE_VIDEO_ACTIVO);
    return crudo ? normalizarVideoActivo(JSON.parse(crudo)) : null;
  } catch (_) {
    return null;   // JSON roto o almacenamiento bloqueado: como si no hubiera nada
  }
}

/** Guarda el registro (con la hora). Devuelve `true` si quedó escrito. */
export function guardarVideoActivo(datos, almacen = almacenPorDefecto(), ahora = Date.now()) {
  const registro = normalizarVideoActivo(datos);
  if (!registro) return false;
  registro.actualizado = ahora;
  try {
    almacen?.setItem(CLAVE_VIDEO_ACTIVO, JSON.stringify(registro));
    return Boolean(almacen);
  } catch (_) {
    return false;   // cuota llena o modo privado: el video sigue, solo no se recuerda
  }
}

/** Único camino que borra el puntero: la persona quitó el video o cambió de uno. */
export function olvidarVideoActivo(almacen = almacenPorDefecto()) {
  try { almacen?.removeItem(CLAVE_VIDEO_ACTIVO); } catch (_) { /* nada que hacer */ }
}

/** 754 → «12:34»; 3725 → «1:02:05». */
export function formatoReloj(segundos) {
  const total = Math.max(0, Math.floor(Number(segundos) || 0));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const dos = (n) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${dos(m)}:${dos(s)}` : `${m}:${dos(s)}`;
}
