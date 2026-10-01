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
  cy: 'galés',
};

/* Whisper a veces devuelve el nombre en inglés («welsh») en vez del código («cy»):
 * el servidor lo pasa tal cual y Groq rechaza la parte siguiente con 400
 * (medido 2026-10-01 con un curso en inglés que abrió con silencio).
 * Aquí todo nombre se vuelve código; lo que no se reconoce se vuelve '' (auto),
 * nunca un texto que el servidor no pueda mandar. */
const CODIGO_POR_NOMBRE = {
  afrikaans: 'af', albanian: 'sq', amharic: 'am', arabic: 'ar', armenian: 'hy',
  assamese: 'as', azerbaijani: 'az', bashkir: 'ba', basque: 'eu', belarusian: 'be',
  bengali: 'bn', bosnian: 'bs', breton: 'br', bulgarian: 'bg', burmese: 'my',
  myanmar: 'my', catalan: 'ca', chinese: 'zh', mandarin: 'zh', cantonese: 'yue',
  croatian: 'hr', czech: 'cs', danish: 'da', dutch: 'nl', flemish: 'nl',
  english: 'en', estonian: 'et', finnish: 'fi', french: 'fr', fulah: 'ff',
  pulaar: 'ff', galician: 'gl', georgian: 'ka', german: 'de', greek: 'el',
  gujarati: 'gu', hausa: 'ha', hawaiian: 'haw', hebrew: 'he', hindi: 'hi',
  hungarian: 'hu', icelandic: 'is', indonesian: 'id', italian: 'it',
  japanese: 'ja', javanese: 'jv', kannada: 'kn', kazakh: 'kk', khmer: 'km',
  cambodian: 'km', korean: 'ko', lao: 'lo', latin: 'la', latvian: 'lv',
  lingala: 'ln', lithuanian: 'lt', luxembourgish: 'lb', macedonian: 'mk',
  malagasy: 'mg', malay: 'ms', malayalam: 'ml', maltese: 'mt', maori: 'mi',
  marathi: 'mr', mongolian: 'mn', nynorsk: 'nn', norwegian: 'no', occitan: 'oc',
  pashto: 'ps', pushto: 'ps', punjabi: 'pa', panjabi: 'pa', persian: 'fa',
  farsi: 'fa', polish: 'pl', portuguese: 'pt', romanian: 'ro', russian: 'ru',
  sanskrit: 'sa', serbian: 'sr', shona: 'sn', sindhi: 'sd', sinhala: 'si',
  sinhalese: 'si', slovak: 'sk', slovenian: 'sl', somali: 'so', spanish: 'es',
  castilian: 'es', swahili: 'sw', swedish: 'sv', tajik: 'tg', tamil: 'ta',
  tatar: 'tt', telugu: 'te', thai: 'th', tibetan: 'bo', turkish: 'tr',
  turkmen: 'tk', ukrainian: 'uk', urdu: 'ur', uzbek: 'uz', vietnamese: 'vi',
  welsh: 'cy', wolof: 'wo', yiddish: 'yi', yoruba: 'yo',
};

export function normalizarCodigoIdioma(valor) {
  const crudo = String(valor || '').trim().toLowerCase().replace(/_/g, '-');
  if (!crudo) return '';
  const corto = crudo.split('-')[0];
  if (/^[a-z]{2}$/.test(corto)) return corto;
  return CODIGO_POR_NOMBRE[corto] || '';
}

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
