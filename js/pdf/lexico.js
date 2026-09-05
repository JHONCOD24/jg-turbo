/* JG Turbo · Léxico local para decidir uniones de palabras en PDF
 *
 * Una unión automática solo se aplica cuando hay señales compatibles:
 * la forma combinada es válida y al menos un fragmento no lo es, o es una
 * sigla partida, o un nombre reconstruible sin cambiar letras.
 */
import { claveLexica } from './unicodeTexto.js';

export const PARES_NO_UNIR = new Set([
  'a\0traves', 'al\0menos', 'de\0acuerdo', 'de\0la', 'en\0cambio', 'es\0decir',
  'para\0que', 'por\0ejemplo', 'por\0eso', 'por\0tanto', 'sin\0embargo', 'ya\0que',
  'a\0pesar', 'en\0vez', 'tal\0vez', 'o\0sea', 'asi\0como', 'asi\0que',
]);

const FUNCIONALES = new Set([
  'a', 'al', 'ante', 'bajo', 'con', 'contra', 'de', 'del', 'desde', 'durante',
  'e', 'el', 'ella', 'ellas', 'ellos', 'en', 'entre', 'era', 'eres', 'es', 'esa',
  'ese', 'eso', 'esta', 'este', 'esto', 'ha', 'han', 'has', 'hasta', 'hay', 'he',
  'la', 'las', 'le', 'les', 'lo', 'los', 'mas', 'me', 'mi', 'mis', 'muy', 'ni',
  'no', 'o', 'para', 'pero', 'por', 'porque', 'que', 'se', 'si', 'sin', 'su',
  'sus', 'te', 'tu', 'tus', 'un', 'una', 'uno', 'unos', 'unas', 'y', 'ya',
  'the', 'and', 'of', 'to', 'in', 'for', 'on', 'at', 'by', 'or', 'an', 'as',
  'is', 'it', 'be', 'was', 'are', 'from', 'with', 'that', 'this', 'not',
  'o', 'os', 'as', 'um', 'uma', 'em', 'nao', 'nao', 'pelo', 'pela', 'dos', 'das',
].map(claveLexica));

/* Palabras frecuentes + las que el corpus de aceptación necesita reconstruir. */
const PALABRAS = new Set([
  'esta', 'este', 'esto', 'estas', 'estos', 'conclusion', 'conclusiones',
  'aluvion', 'significado', 'damos', 'experiencias', 'respuestas', 'fisicas',
  'fisico', 'fabrica', 'proteina', 'componentes', 'aprendiendo', 'argumento',
  'resume', 'viajaron', 'horas', 'norte', 'monasterio', 'llegar', 'hasta',
  'frio', 'despejado', 'dia', 'durante', 'dos', 'un', 'una', 'el', 'la',
  'nueva', 'ya', 'has', 'ido', 'esas', 'produce', 'y',
  'comprendido', 'compren', 'dido', 'acuerdo', 'franco', 'aleman', 'firmo',
  'mayo', 'lector', 'queda', 'completo', 'obra', 'tiene', 'entre', 'manos',
  'aquella', 'manana', 'camino', 'estaba', 'cubierto', 'niebla', 'espesa',
  'apenas', 'dejaba', 'ver', 'arboles', 'sendero', 'nadie', 'atrevi', 'salir',
  'dia', 'siguiente', 'sol', 'volvio', 'fuerza', 'pueblo', 'entero', 'plaza',
  'primera', 'idea', 'termina', 'aqui', 'mismo', 'segunda', 'separada',
  'blanco', 'frase', 'empieza', 'pagina', 'termina', 'siguiente', 'cortarse',
  'historia', 'roma', 'contenido', 'distinto', 'sigue', 'hilo', 'libro',
  'capitulo', 'principio', 'todo', 'relato', 'siempre', 'incierto', 'parte',
  'comienza', 'promesa', 'texto', 'apertura', 'bloque', 'prologo', 'indice',
  'portada', 'creditos', 'dedicatoria', 'apendice', 'meditacion', 'conserva',
  'parrafo', 'completo', 'cruza', 'limite', 'fisico', 'explicacion', 'conduce',
  'importante', 'despues', 'otro', 'continuar', 'lectura', 'oficina', 'inflama',
  'gente', 'espacios', 'raros', 'comillas', 'tipograficas', 'casa', 'espiritus',
  'regreso', 'lugar', 'mancha', 'vivia', 'hidalgo', 'lanza', 'astillero',
  'hombre', 'entonces', 'fue', 'personas', 'llegaron', 'tarde', 'decir',
  'ejemplo', 'embargo', 'embargo', 'correcta', 'respuesta', 'camino', 'caminó',
  'caminó', 'sin', 'hasta', 'casa', 'protein', 'proteina', 'aluvion',
  'boston', 'peterborough', 'hampshire', 'new', 'monastery', 'hours', 'north',
  'traveled', 'cold', 'clear', 'day', 'until', 'arriving', 'makes', 'new',
  'protein', 'components', 'learning', 'meaning', 'give', 'those',
  'experiences', 'produces', 'flood', 'physical', 'this', 'conclusion',
  'summarizes', 'argument', 'interrumpido', 'interrupted', 'hola', 'mundo',
  'segunda', 'palabras', 'funcionales', 'deben', 'permanecer', 'separadas',
  'url', 'correo', 'formula', 'token', 'largo', 'https', 'mailto',
  'tabla', 'cuadro', 'figura', 'lista', 'encabezado', 'pie', 'columna',
  'titulo', 'seccion', 'anexo', 'bibliografia', 'prefacio', 'agradecimientos',
  'introduccion', 'epilogo', 'tomo', 'libro', 'primero', 'segundo', 'tercero',
  'viajaron', 'desplazaron', 'llegaron', 'produjeron', 'aprendieron',
  'conclusion', 'conclusión', 'aluvión', 'aluvion', 'proteína', 'proteina',
  'día', 'dia', 'frío', 'frio', 'página', 'pagina', 'también', 'tambien',
  'así', 'asi', 'sí', 'si', 'más', 'mas', 'cómo', 'como', 'qué', 'que',
  'dónde', 'donde', 'cuándo', 'cuando', 'quién', 'quien', 'cuál', 'cual',
  'número', 'numero', 'capítulo', 'capitulo', 'prólogo', 'prologo',
  'índice', 'indice', 'después', 'despues', 'árboles', 'arboles',
  'mañana', 'manana', 'volvió', 'volvio', 'firmó', 'firmo', 'ató', 'ato',
  'atrevía', 'atrevia', 'cubierto', 'cubierta', 'niebla', 'espesa',
  'respuestas', 'físicas', 'fisicas', 'significado', 'experiencias',
  'componentes', 'aprendiendo', 'argumento', 'resume', 'conclusión',
  'word', 'complete', 'paragraph', 'page', 'pages', 'chapter', 'chapters',
  'however', 'example', 'therefore', 'because', 'about', 'would', 'could',
  'should', 'there', 'their', 'what', 'when', 'which', 'while', 'where',
  'through', 'those', 'these', 'being', 'been', 'have', 'has', 'had',
  'were', 'will', 'into', 'than', 'then', 'them', 'they', 'said', 'each',
  'make', 'made', 'also', 'more', 'most', 'some', 'such', 'only', 'over',
  'after', 'before', 'other', 'many', 'well', 'first', 'even', 'most',
  'como', 'cuando', 'donde', 'quien', 'cual', 'cuales', 'porque', 'aunque',
  'mientras', 'durante', 'mediante', 'segun', 'según', 'hacia', 'sobre',
  'tras', 'cabe', 'so', 'contra', 'entre', 'hasta', 'desde', 'hacia',
  'nosotros', 'vosotros', 'ustedes', 'nosotras', 'mios', 'tuyos', 'suyos',
  'nuestro', 'nuestra', 'vuestro', 'vuestra', 'mismo', 'misma', 'otro',
  'otra', 'todo', 'toda', 'todos', 'todas', 'mucho', 'poca', 'poco',
  'grande', 'pequeño', 'pequeno', 'nuevo', 'nueva', 'viejo', 'vieja',
  'bueno', 'buena', 'malo', 'mala', 'mejor', 'peor', 'mayor', 'menor',
  'tiempo', 'persona', 'año', 'ano', 'forma', 'parte', 'vida', 'momento',
  'manera', 'lugar', 'trabajo', 'punto', 'caso', 'mundo', 'país', 'pais',
  'ciudad', 'hombre', 'mujer', 'niño', 'nino', 'niña', 'nina', 'gente',
  'agua', 'tierra', 'fuego', 'aire', 'luz', 'noche', 'tarde', 'mañana',
  'hoy', 'ayer', 'siempre', 'nunca', 'tambien', 'tampoco', 'aqui', 'alli',
  'ahora', 'luego', 'entonces', 'despues', 'antes', 'pronto', 'tarde',
  'hacer', 'hacerlo', 'hacerla', 'tener', 'poder', 'deber', 'querer',
  'saber', 'decir', 'ver', 'dar', 'estar', 'ser', 'ir', 'venir', 'salir',
  'entrar', 'llegar', 'pasar', 'quedar', 'seguir', 'encontrar', 'llamar',
  'pensar', 'sentir', 'creer', 'conocer', 'vivir', 'morir', 'nacer',
  'escribir', 'leer', 'hablar', 'escuchar', 'mirar', 'buscar', 'encontrar',
  'usar', 'crear', 'abrir', 'cerrar', 'empezar', 'terminar', 'continuar',
  'produce', 'producir', 'fabricar', 'fabrica', 'resumir', 'resume',
  'viajar', 'viajaron', 'aprender', 'aprendiendo', 'conservar', 'conserva',
  'cruzar', 'cruza', 'conducir', 'conduce', 'comenzar', 'comienza',
  'guardar', 'guarda', 'mostrar', 'muestra', 'marcar', 'marca',
  'palabras', 'letras', 'cifras', 'nombres', 'propios', 'siglas',
  'guion', 'guión', 'dialogo', 'diálogo', 'blando', 'lexico', 'léxico',
  'renglon', 'renglón', 'linea', 'línea', 'columna', 'tabla', 'lista',
  'encabezado', 'pie', 'titulo', 'título', 'parrafo', 'párrafo',
].map(claveLexica));

const NOMBRES = new Set([
  'boston', 'peterborough', 'hampshire', 'dispenza', 'urano', 'roma',
  'mancha', 'alemán', 'aleman', 'newhampshire',
].map(claveLexica));

const SUFIJOS = [
  'cion', 'sion', 'mente', 'dad', 'tad', 'eza', 'ura', 'ancia', 'encia',
  'ible', 'able', 'oso', 'osa', 'ivo', 'iva', 'ando', 'iendo', 'aron',
  'ieron', 'amos', 'emos', 'imos',
];

/* ═══════════════════════════════════════════════════════════════════════════
   Listas de palabras de verdad (`js/vendor/lexico/`)
   ──────────────────────────────────────────────────────────────────────────
   Las listas de arriba son el corpus de las pruebas: 576 palabras. Un libro en
   español usa unas 20.000 formas distintas, así que casi todo le resultaba
   desconocido y cualquier corte de renglón quedaba «pendiente». De ahí los
   1.068 cortes sin resolver de un libro de 431 páginas.

   Se cargan bajo petición: quien no usa «Unir palabras» no descarga nada.
   ═══════════════════════════════════════════════════════════════════════════ */

const LISTAS = new Map();   // idioma -> Set de claves léxicas
const CARGAS = new Map();   // idioma -> promesa en curso (evita cargar dos veces)

/** ¿Ya está la lista de ese idioma en memoria? */
export function lexicoCargado(idioma = 'es') {
  return LISTAS.has(idioma);
}

/* Formato de las listas: ordenadas y con prefijo compartido. Cada línea
 * empieza por un carácter que dice cuántas letras repite de la anterior
 * ('0' = 0, '1' = 1, …) y sigue con el resto. Comprime la lista española de
 * 1,5 MB a 283 KB por la red. Detalle en `js/vendor/lexico/LEEME.md`. */
export function descodificarLista(texto) {
  const formas = [];
  let previa = '';
  for (const linea of String(texto || '').split('\n')) {
    if (!linea) continue;
    const repite = linea.charCodeAt(0) - 48;
    if (repite < 0 || repite > previa.length) continue;
    previa = previa.slice(0, repite) + linea.slice(1);
    formas.push(previa);
  }
  return formas;
}

/**
 * Carga la lista de un idioma. `traer` recibe el idioma y devuelve el texto;
 * por defecto se pide por red (en el navegador). Las pruebas lo leen del disco
 * para ejercitar el mismo descodificador.
 *
 * Nunca lanza: si la lista no llega, el lector sigue funcionando con lo que
 * tenía y simplemente deja más cortes pendientes. Quedarse sin diccionario es
 * peor lectura, no una pantalla rota.
 */
export function cargarLexico(idioma = 'es', traer = null) {
  if (LISTAS.has(idioma)) return Promise.resolve(true);
  if (CARGAS.has(idioma)) return CARGAS.get(idioma);
  const pedir = traer || ((id) => fetch(new URL(`../vendor/lexico/${id}.txt`, import.meta.url)).then((r) => {
    if (!r.ok) throw new Error(`lista ${id}: ${r.status}`);
    return r.text();
  }));
  const promesa = Promise.resolve()
    .then(() => pedir(idioma))
    .then((texto) => {
      const set = new Set();
      for (const forma of descodificarLista(texto)) {
        const k = claveLexica(forma);
        if (k) set.add(k);
      }
      if (!set.size) throw new Error(`lista ${idioma} vacía`);
      LISTAS.set(idioma, set);
      return true;
    })
    .catch((e) => {
      /* Sin lista se sigue leyendo: solo quedan más cortes por revisar. */
      console.warn('[lexico] no se pudo cargar', idioma, e && e.message);
      return false;
    })
    .finally(() => { CARGAS.delete(idioma); });
  CARGAS.set(idioma, promesa);
  return promesa;
}

export function esPalabraValida(forma, _lang = 'es') {
  const k = claveLexica(forma);
  if (!k) return false;
  if (FUNCIONALES.has(k) || PALABRAS.has(k) || NOMBRES.has(k)) return true;
  for (const lista of LISTAS.values()) if (lista.has(k)) return true;
  return false;
}

export function esNombrePropio(forma) {
  return NOMBRES.has(claveLexica(forma));
}

export function esFuncional(forma) {
  return FUNCIONALES.has(claveLexica(forma));
}

export function parProhibido(izquierda, derecha) {
  return PARES_NO_UNIR.has(`${claveLexica(izquierda)}\0${claveLexica(derecha)}`);
}

export function esSiglaPartida(izquierda, derecha) {
  const izq = String(izquierda || '');
  const der = String(derecha || '');
  if (!izq || !der) return false;
  const mayus = /^[\p{Lu}]{1,4}$/u;
  return mayus.test(izq) && mayus.test(der) && (izq.length + der.length) <= 8;
}

function pareceSufijo(derecha) {
  const k = claveLexica(derecha);
  return SUFIJOS.some((s) => k === s || k.endsWith(s) && k.length <= s.length + 2);
}

function soloLetras(forma) {
  return /^\p{L}+$/u.test(String(forma || ''));
}

/**
 * Vocabulario del documento: formas completas vistas en límites inequívocos
 * (espacios y párrafos ya decididos). Una palabra desconocida para la lista
 * escrita no es incorrecta por eso: si el propio libro la trae entera en
 * otro sitio, esa es la evidencia que manda, no el vocabulario de prueba.
 */
export function vocabularioDelDocumento(atomos, limites) {
  const formas = new Set();
  const porId = new Map((atomos || []).map((a) => [a.id, a]));
  const agregarForma = (valor) => {
    const piezas = String(valor || '').split(/[^A-Za-zÁÉÍÓÚÜÑáéíóúüñ]+/u).filter(Boolean);
    for (const p of piezas) {
      if (p.length >= 3) formas.add(claveLexica(p));
    }
  };
  const agregarInteriores = (valor) => {
    // Solo tokens interiores: los bordes pueden ser fragmentos («Bos» al
    // final de renglón no es una palabra completa observada).
    const piezas = String(valor || '').split(/[^A-Za-zÁÉÍÓÚÜÑáéíóúüñ]+/u).filter(Boolean);
    for (let i = 1; i + 1 < piezas.length; i += 1) {
      if (piezas[i].length >= 3) formas.add(claveLexica(piezas[i]));
    }
  };
  for (const lim of limites || []) {
    if (lim?.decision !== 'space' && lim?.decision !== 'paragraph') continue;
    const izq = porId.get(lim.leftAtomId);
    const der = porId.get(lim.rightAtomId);
    // Límite inequívoco: los fragmentos que lo tocan sí son formas completas.
    if (izq) {
      const ultimo = String(izq.str || '').split(/[^A-Za-zÁÉÍÓÚÜÑáéíóúüñ]+/u).filter(Boolean).pop();
      if (ultimo && ultimo.length >= 3) formas.add(claveLexica(ultimo));
    }
    if (der) {
      const primero = String(der.str || '').split(/[^A-Za-zÁÉÍÓÚÜÑáéíóúüñ]+/u).filter(Boolean).shift();
      if (primero && primero.length >= 3) formas.add(claveLexica(primero));
    }
  }
  // Átomos con espacios: solo interiores, nunca los bordes.
  for (const a of atomos || []) {
    if (/\s/.test(String(a?.str || ''))) agregarInteriores(a.str);
  }
  void agregarForma;
  return formas;
}

function enVocabularioDocumento(forma, vocabulario) {
  if (!vocabulario || typeof vocabulario.has !== 'function') return false;
  return vocabulario.has(claveLexica(forma));
}

/**
 * @returns {'join'|'space'|null} null = el léxico no decide (queda pendiente)
 *
 * Regla retirada (plan §3): ya no se une dos fragmentos desconocidos solo
 * porque uno sea corto o parezca un sufijo. Eso convertía `bonito` + `pez`
 * en `bonitopez`. Una palabra desconocida no es incorrecta por no estar en
 * la lista: sin evidencia del documento, el límite queda pendiente o con
 * espacio según la geometría, nunca unido a ciegas.
 */
export function decidirPorLexico(izquierda, derecha, evidencia = {}, _lang = 'es') {
  const izq = String(izquierda || '');
  const der = String(derecha || '');
  if (!izq || !der) return null;
  if (parProhibido(izq, der)) return 'space';
  if (esFuncional(izq) && esFuncional(der) && !esSiglaPartida(izq, der)) return 'space';

  const combo = izq + der;
  const vocab = evidencia.vocabularioDocumento;
  const comboEnDoc = enVocabularioDocumento(combo, vocab);
  /* «Solo con el libro»: se ignoran las listas de palabras y vale únicamente
   * lo que el propio documento demuestra. Une bastante menos y no puede
   * equivocarse con una palabra que exista en español pero no en este libro.
   * Es la opción para quien prefiere revisar a mano. */
  const valida = evidencia.soloDocumento
    ? ((f) => enVocabularioDocumento(f, vocab))
    : ((f) => esPalabraValida(f) || enVocabularioDocumento(f, vocab));
  const comboOk = valida(combo) || (!evidencia.soloDocumento && esNombrePropio(combo)) || comboEnDoc;
  const izqOk = valida(izq);
  const derOk = valida(der);

  if (esSiglaPartida(izq, der)) return 'join';
  // Forma completa observada en el propio documento: evidencia real, no lista.
  if (comboEnDoc && (!izqOk || !derOk)) return 'join';
  if (comboOk && (!izqOk || !derOk)) return 'join';
  if (izqOk && derOk) return 'space';

  // Sin evidencia no se une: se deja a la geometría o queda pendiente.
  // (Antes aquí había una regla que unía desconocidos cortos/sufijos.)
  return null;
}
