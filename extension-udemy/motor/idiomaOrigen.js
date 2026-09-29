/**
 * Qué hacer según el idioma del video: la única regla de negocio del cliente.
 *
 * El servidor decide el idioma y explica de dónde salió (`language_source`) y con
 * cuánta certeza (auditoría H1). Aquí solo se aplica la regla: doblar, preguntar,
 * avisar que ya está en español o decir que ese idioma aún no se soporta. Antes el
 * cliente rehacía la cuenta de confianza (dos fuentes de verdad) y rechazaba todo
 * lo que no fuera inglés.
 */
export const IDIOMA_DESTINO = 'es';
export const IDIOMAS_DOBLABLES = Object.freeze(['en', 'pt', 'fr', 'de', 'it']);
export const CONFIANZA_SIN_PREGUNTAR = 0.7;
/** Fuentes que no se preguntan: lo eligió la persona o lo declara YouTube. */
const FUENTES_FIRMES = new Set(['usuario', 'youtube']);

const NOMBRES = {
  en: 'inglés', es: 'español', pt: 'portugués', fr: 'francés', de: 'alemán', it: 'italiano',
  ar: 'árabe', ru: 'ruso', hi: 'hindi', ja: 'japonés', ko: 'coreano', zh: 'chino',
  pl: 'polaco', tr: 'turco', nl: 'neerlandés', he: 'hebreo', el: 'griego', th: 'tailandés',
};

export function codigoCorto(valor) {
  return String(valor || '').trim().toLowerCase().replace(/_/g, '-').split('-')[0];
}

export function nombreIdioma(codigo) {
  const corto = codigoCorto(codigo);
  return NOMBRES[corto] || corto || 'un idioma desconocido';
}

export function decidirDoblaje({ idioma = '', confianza = 0, fuente = '', conflicto = false } = {}) {
  const corto = codigoCorto(idioma);
  const firme = FUENTES_FIRMES.has(String(fuente)) || Number(confianza) >= CONFIANZA_SIN_PREGUNTAR;
  if (!corto) {
    return { accion: 'preguntar', idioma: '', mensaje: 'No pudimos saber en qué idioma habla el video. Elígelo para seguir.' };
  }
  if (conflicto || !firme) {
    return { accion: 'preguntar', idioma: corto, mensaje: `Parece que el video está en ${nombreIdioma(corto)}. ¿Es correcto?` };
  }
  if (corto === IDIOMA_DESTINO) {
    return { accion: 'sin_doblaje', idioma: corto, mensaje: 'Este video ya está en español: no necesita doblaje.' };
  }
  if (!IDIOMAS_DOBLABLES.includes(corto)) {
    return {
      accion: 'no_soportado',
      idioma: corto,
      mensaje: `El video parece estar en ${nombreIdioma(corto)}. Por ahora el doblaje funciona desde inglés, portugués, francés, alemán o italiano. Si no es ese idioma, elígelo abajo.`,
    };
  }
  return { accion: 'doblar', idioma: corto, mensaje: '' };
}
