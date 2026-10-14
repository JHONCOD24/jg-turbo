/* JG Turbo · Ajustes de lectura (hoja «Aa» del lector de PDF)
 *
 * Reglas puras, sin DOM, para que se puedan probar en Node. El modelo de
 * interacción se tomó del lector web de Kindle, observado con REA el
 * 2026-10-13 (docs/kindle/MODELO_KINDLE.md): hoja «Aa» con letra y tamaño
 * por pasos, colores de página, tocar los bordes para pasar página, el
 * centro para mostrar los controles, y un pie que dice por dónde vas y que
 * cambia de dato al tocarlo. No se copió código ni recursos de Amazon: solo
 * el comportamiento.
 *
 * Todo lo que llega del almacenamiento se normaliza aquí: un valor viejo,
 * roto o de otra versión nunca deja el lector en un estado imposible.
 */

export const TEMAS = ['papel', 'sepia', 'verde', 'noche', 'negro'];
export const FUENTES = ['serif', 'sans', 'legible'];
export const GROSORES = ['normal', 'medio', 'negrita'];
export const ALINEACIONES = ['auto', 'justificado', 'izquierda'];
export const ANCHOS = [52, 64, 76];
/* Qué dice el pie. El orden es el del ciclo al tocarlo. */
export const MODOS_PROGRESO = ['libro', 'tiempo-capitulo', 'tiempo-libro', 'pagina', 'nada'];

export const TAM_MIN = 14;
export const TAM_MAX = 34;
export const INTER_MIN = 1.2;
export const INTER_MAX = 2.2;
export const BRILLO_MIN = 40;
export const BRILLO_MAX = 100;

/* Estilos rápidos (en Kindle se llaman «temas»: Compacto, Estándar, Grande,
 * Baja visión). Solo tocan la métrica del texto; el color de página es aparte
 * para que «Grande» no le cambie a nadie el fondo. */
export const ESTILOS_RAPIDOS = {
  compacto: { nombre: 'Compacto', tam: 17, inter: 1.45, ancho: 76, grosor: 'normal' },
  estandar: { nombre: 'Estándar', tam: 19, inter: 1.7, ancho: 64, grosor: 'normal' },
  grande: { nombre: 'Grande', tam: 24, inter: 1.8, ancho: 64, grosor: 'medio' },
  'baja-vision': { nombre: 'Baja visión', tam: 30, inter: 1.9, ancho: 52, grosor: 'negrita' },
};

export const AJUSTES_BASE = Object.freeze({
  tam: 19, inter: 1.7, ancho: 64, fuente: 'sans', tema: null, modo: 'lectura',
  modoPagina: 'paginas', tamElegido: false, vozDesplegado: false,
  grosor: 'normal', alinear: 'auto', bordes: true, progreso: 'libro', brillo: 100,
});

function numeroEn(valor, min, max, base) {
  const n = Number(valor);
  if (!Number.isFinite(n)) return base;
  return Math.min(max, Math.max(min, n));
}
const unoDe = (valor, lista, base) => (lista.includes(valor) ? valor : base);

/** Ajustes válidos a partir de lo que haya guardado (o de nada). */
export function normalizarAjustes(crudo) {
  const c = crudo && typeof crudo === 'object' ? crudo : {};
  const b = AJUSTES_BASE;
  const ancho = Number(c.ancho);
  return {
    ...b,
    ...c,
    tam: Math.round(numeroEn(c.tam, TAM_MIN, TAM_MAX, b.tam)),
    inter: Math.round(numeroEn(c.inter, INTER_MIN, INTER_MAX, b.inter) * 100) / 100,
    ancho: ANCHOS.includes(ancho) ? ancho : b.ancho,
    fuente: unoDe(c.fuente, FUENTES, b.fuente),
    modo: c.modo === 'editar' ? 'editar' : 'lectura',
    modoPagina: c.modoPagina === 'scroll' ? 'scroll' : 'paginas',
    tamElegido: c.tamElegido === true,
    vozDesplegado: c.vozDesplegado === true,
    grosor: unoDe(c.grosor, GROSORES, b.grosor),
    alinear: unoDe(c.alinear, ALINEACIONES, b.alinear),
    bordes: c.bordes !== false,
    progreso: unoDe(c.progreso, MODOS_PROGRESO, b.progreso),
    brillo: Math.round(numeroEn(c.brillo, BRILLO_MIN, BRILLO_MAX, b.brillo)),
  };
}

export const temaValido = (tema) => (TEMAS.includes(tema) ? tema : 'noche');

/** Aplica un estilo rápido sin tocar lo que no es suyo (tema, modo, voz…). */
export function aplicarEstiloRapido(cfg, clave) {
  const estilo = ESTILOS_RAPIDOS[clave];
  if (!estilo) return normalizarAjustes(cfg);
  const { nombre, ...metrica } = estilo;
  return normalizarAjustes({ ...cfg, ...metrica, tamElegido: true });
}

/** Qué estilo rápido coincide con la métrica actual (para marcarlo). */
export function estiloRapidoActual(cfg) {
  const c = normalizarAjustes(cfg);
  for (const [clave, e] of Object.entries(ESTILOS_RAPIDOS)) {
    if (c.tam === e.tam && Math.abs(c.inter - e.inter) < 0.001 && c.ancho === e.ancho && c.grosor === e.grosor) return clave;
  }
  return null;
}

/** A− / A+: un paso por toque, como los botones de Kindle. */
export function pasoTamano(cfg, delta) {
  const c = normalizarAjustes(cfg);
  return normalizarAjustes({ ...c, tam: c.tam + (delta < 0 ? -1 : 1), tamElegido: true });
}

export function siguienteModoProgreso(modo) {
  const i = MODOS_PROGRESO.indexOf(modo);
  return MODOS_PROGRESO[(i + 1) % MODOS_PROGRESO.length];
}

/** «~8 min», «~1 h 20 min», «menos de 1 min». */
export function formatearMinutos(minutos) {
  const m = Math.round(Number(minutos));
  if (!Number.isFinite(m) || m < 0) return '';
  if (m < 1) return 'menos de 1 min';
  if (m < 60) return `~${m} min`;
  const h = Math.floor(m / 60);
  const resto = m % 60;
  return resto ? `~${h} h ${resto} min` : `~${h} h`;
}

const palabrasCache = new Map();
function palabrasDe(texto) {
  const t = String(texto || '');
  if (!t.trim()) return 0;
  /* La clave es el largo y las puntas: barato y basta para no recontar un
   * capítulo que no cambió en cada paso de página. */
  const clave = `${t.length}|${t.slice(0, 24)}|${t.slice(-24)}`;
  let n = palabrasCache.get(clave);
  if (n == null) {
    n = t.trim().split(/\s+/).length;
    if (palabrasCache.size > 400) palabrasCache.clear();
    palabrasCache.set(clave, n);
  }
  return n;
}

/** Minutos que faltan del libro entero, a una lectura tranquila. */
export function minutosRestantesLibro(textos, progreso, ppm = 200) {
  const lista = Array.isArray(textos) ? textos : [];
  if (!lista.length) return null;
  const parte = Math.min(lista.length - 1, Math.max(0, Math.floor(Number(progreso?.parte) || 0)));
  const dentro = Math.min(1, Math.max(0, Number(progreso?.desplazamiento) || 0));
  let palabras = palabrasDe(lista[parte]) * (1 - dentro);
  for (let i = parte + 1; i < lista.length; i += 1) palabras += palabrasDe(lista[i]);
  return palabras / Math.max(1, ppm);
}

/** Texto del pie según el modo elegido. Devuelve '' si no hay dato. */
export function textoProgreso(modo, datos = {}) {
  switch (modo) {
    case 'nada': return '';
    case 'tiempo-capitulo': {
      const t = datos.minutosCapitulo ? String(datos.minutosCapitulo) : '';
      return t ? `${t} para terminar el capítulo` : '';
    }
    case 'tiempo-libro': {
      const t = formatearMinutos(datos.minutosLibro);
      return t ? `${t} para terminar el libro` : '';
    }
    case 'pagina': {
      const actual = Number(datos.pagina) || 0;
      const total = Number(datos.paginas) || 0;
      return actual > 0 && total > 0 ? `Página ${Math.min(actual, total)} de ${total} del capítulo` : '';
    }
    default: {
      const p = Number(datos.porcentaje);
      return Number.isFinite(p) ? `${Math.min(100, Math.max(0, Math.round(p)))} % del libro` : '';
    }
  }
}

/* Zonas de toque: el borde izquierdo vuelve, el derecho avanza y el centro
 * muestra los controles. Cada borde se lleva el 22 % del ancho, sin bajar de
 * 48 px (un pulgar) ni pasar de 160 px (en tablet el centro tiene que seguir
 * siendo el lugar natural para tocar el texto). */
export function zonaDeToque(x, izquierda, ancho) {
  const a = Number(ancho);
  const pos = Number(x) - Number(izquierda || 0);
  if (!Number.isFinite(a) || a <= 0 || !Number.isFinite(pos)) return 'centro';
  const borde = Math.min(160, Math.max(48, a * 0.22));
  if (pos < borde) return 'anterior';
  if (pos > a - borde) return 'siguiente';
  return 'centro';
}
