/**
 * Voces del doblaje: automática según el video y segunda voz para diálogos.
 *
 * Por qué existe: con una sola voz fija, una entrevista suena a monólogo y una
 * voz Fish lenta (2,6–4,8 s por frase) frena todo el doblaje. Aquí se decide:
 * 1) si el video trae diálogo (marca `>>` de los subtítulos automáticos o
 *    guiones de diálogo), para ofrecer una segunda voz; 2) qué género suena
 *    mejor, con una heurística honesta sobre el texto ORIGINAL en inglés
 *    (pronombres y nombres); 3) qué valores concretos usar en modo automático:
 *    siempre neurales rápidas (Azure 0,4–1,1 s), nunca Fish.
 *
 * Todo puro: sin red, sin DOM. La lista de voces la pone el controlador.
 */

/** Marca de cambio de hablante en subtítulos automáticos de YouTube. */
const RE_CAMBIO_HABLANTE = /(^|\s)(?:>>|&gt;&gt;)+\s*/;

/** Guion de diálogo al inicio de una línea («— Hola», «- Hola»). */
const RE_GUION_DIALOGO = /^\s*[—–-]\s+\p{L}/u;

/** «Nombre: frase» típico de transcripciones con hablantes etiquetados. */
const RE_ETIQUETA_HABLANTE = /^\s*[A-ZÁÉÍÓÚÑ][\wÁÉÍÓÚÑáéíóúñ' .-]{1,30}:\s+\p{L}/u;

export function esCambioHablante(textoCrudo) {
  const texto = String(textoCrudo || '');
  return RE_CAMBIO_HABLANTE.test(texto)
    || RE_GUION_DIALOGO.test(texto)
    || RE_ETIQUETA_HABLANTE.test(texto);
}

/**
 * ¿El video trae conversación entre 2 personas? Se cuenta sobre los segmentos
 * ya normalizados usando su campo `cambioHablante` (lo pone
 * `normalizarSegmentos` ANTES de limpiar el texto, porque la limpieza borra
 * las marcas). Mínimo 2 cambios = diálogo real, no un falso positivo.
 */
export function hayDialogo(segmentos) {
  const lista = Array.isArray(segmentos) ? segmentos : [];
  let cambios = 0;
  for (const segmento of lista) {
    if (segmento && segmento.cambioHablante) cambios += 1;
    if (cambios >= 2) return true;
  }
  return false;
}

// Pronombres y apelativos en inglés (idioma de origen más común) + español.
const MASCULINAS = /\b(he|him|his|man|men|boy|boys|guy|guys|gentleman|mr|sir|father|dad|brother|son|husband|king|actor|waiter|él|ellos|hombre|hombres|señor|caballero|padre|hermano|hijo|esposo|rey)\b/gi;
const FEMENINAS = /\b(she|her|hers|woman|women|girl|girls|lady|ladies|ms|mrs|miss|madam|mother|mom|sister|daughter|wife|queen|actress|waitress|ella|ellas|mujer|mujeres|señora|señorita|dama|madre|hermana|hija|esposa|reina)\b/gi;

/**
 * Género probable de la voz que habla (`male`/`female`/`''` sin pistas).
 * Heurística sobre el texto original: cuenta menciones y exige ventaja clara
 * (3 de cada 4). Sin ventaja = '' y manda la voz global de la persona.
 */
export function inferirGenero(textos) {
  const junto = (Array.isArray(textos) ? textos : [textos])
    .map((t) => String(t || ''))
    .join(' ');
  const el = (junto.match(MASCULINAS) || []).length;
  const ella = (junto.match(FEMENINAS) || []).length;
  const total = el + ella;
  if (total < 3) return '';
  if (ella >= total * 0.75) return 'female';
  if (el >= total * 0.75) return 'male';
  return '';
}

export function esNeuralRapida(valor) {
  return String(valor || '').startsWith('neural:');
}

export function generoDeVoz(valor) {
  const texto = String(valor || '');
  if (/:male$/.test(texto)) return 'male';
  if (/:female$/.test(texto)) return 'female';
  if (/valentino|narrador(?!a)|leonardo|julio-ciencia|farick|enrique-hoffman|voz-locutor|mario-alonso-puig|hilary-narrador|jim-hopper|roberto|michael|jg-narrador/i.test(texto)) return 'male';
  return 'female';
}

/**
 * Voces concretas para el modo automático. Siempre neurales (rápidas y de
 * timbre estable): `neural:auto:<genero>` suena con Salomé/Gonzalo en el
 * servidor aunque la biblioteca ya no liste acentos.
 */
export function elegirVocesAutomaticas({ textosOriginales = [], vozGlobal = '', catalogo = [] } = {}) {
  const detectado = inferirGenero(textosOriginales);
  const global = generoDeVoz(vozGlobal) || 'female';
  const principalGenero = detectado || global;
  const principal = `neural:auto:${principalGenero}`;
  const secundariaGenero = principalGenero === 'male' ? 'female' : 'male';
  let secundaria = `neural:auto:${secundariaGenero}`;
  // Si el catálogo trae esa voz exacta, se usa tal cual; si no, igual vale:
  // el servidor resuelve `neural:auto:*` aunque no esté listada.
  if (Array.isArray(catalogo) && catalogo.length) {
    const valores = new Set(catalogo.map((v) => String(v.value)));
    if (!valores.has(principal)) {
      const misma = catalogo.find((v) => esNeuralRapida(v.value) && generoDeVoz(v.value) === principalGenero);
      if (misma) return { principal: misma.value, secundaria, genero: principalGenero };
    }
    if (!valores.has(secundaria)) {
      const otra = catalogo.find((v) => esNeuralRapida(v.value) && generoDeVoz(v.value) === secundariaGenero);
      if (otra) secundaria = otra.value;
    }
  }
  return { principal, secundaria, genero: principalGenero };
}

/**
 * Voz que le toca a cada unidad: en diálogo, el hablante 1 usa la secundaria.
 * `vozFija` = la elegida en el selector; `auto` = la resuelta al abrir el video.
 */
export function vozParaUnidad(unidad, { vozPrincipal, vozSecundaria }) {
  if (unidad && unidad.hablante === 1 && vozSecundaria) return vozSecundaria;
  return vozPrincipal;
}
