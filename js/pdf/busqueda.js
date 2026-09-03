/* JG Turbo · Búsqueda por relevancia dentro de un documento
 *
 * Cuando le preguntas algo a un libro, el libro entero no cabe en una
 * consulta a la IA. Hay que elegir qué trozos mandarle, y elegir mal es la
 * diferencia entre una respuesta útil y un «no dice nada sobre eso».
 *
 * Aquí se usa BM25, la fórmula que usan los buscadores: una palabra vale
 * más cuanto más rara es en el documento (si «pueblo» sale en todas las
 * páginas, encontrarla no dice nada; si «astrolabio» sale en una sola,
 * esa es la página). Todo pasa en el navegador, sin llamar a nadie.
 */

/* Palabras que aparecen en todas partes y no ayudan a distinguir nada. */
const VACIAS = new Set([
  'el', 'la', 'los', 'las', 'un', 'una', 'unos', 'unas', 'lo', 'al', 'del',
  'de', 'a', 'ante', 'bajo', 'con', 'contra', 'desde', 'en', 'entre', 'hacia',
  'hasta', 'para', 'por', 'segun', 'sin', 'sobre', 'tras', 'durante', 'mediante',
  'y', 'e', 'ni', 'o', 'u', 'pero', 'sino', 'aunque', 'porque', 'pues', 'que',
  'como', 'cuando', 'donde', 'quien', 'cual', 'cuyo', 'si', 'no', 'se', 'su',
  'sus', 'mi', 'mis', 'tu', 'tus', 'me', 'te', 'le', 'les', 'nos', 'os',
  'yo', 'ti', 'ti', 'el', 'ella', 'ellos', 'ellas', 'usted', 'ustedes',
  'este', 'esta', 'estos', 'estas', 'ese', 'esa', 'esos', 'esas', 'aquel',
  'aquella', 'esto', 'eso', 'aquello', 'es', 'son', 'era', 'eran', 'fue',
  'fueron', 'ser', 'estar', 'esta', 'estan', 'estaba', 'hay', 'ha', 'han',
  'habia', 'he', 'has', 'hemos', 'muy', 'mas', 'menos', 'ya', 'aun', 'tambien',
  'solo', 'todo', 'toda', 'todos', 'todas', 'otro', 'otra', 'otros', 'otras',
  'mismo', 'misma', 'tan', 'tanto', 'cada', 'algun', 'alguna', 'algunos',
  'algunas', 'ningun', 'ninguna', 'nada', 'algo', 'alguien', 'nadie',
  /* Inglés, porque muchos libros técnicos vienen en inglés. */
  'the', 'a', 'an', 'and', 'or', 'but', 'if', 'then', 'of', 'to', 'in', 'on',
  'at', 'by', 'for', 'with', 'from', 'as', 'is', 'are', 'was', 'were', 'be',
  'been', 'this', 'that', 'these', 'those', 'it', 'its', 'his', 'her', 'their',
  'not', 'no', 'so', 'than', 'too', 'very', 'can', 'will', 'would', 'there',
  'what', 'which', 'who', 'when', 'where', 'how', 'all', 'any', 'some',
]);

/* Ajustes clásicos de BM25: cuánto pesa repetir una palabra (k1) y cuánto
 * se penaliza que el bloque sea largo (b). */
const K1 = 1.5;
const B = 0.75;

const sinTildes = (texto) => texto.normalize('NFD').replace(/[̀-ͯ]/g, '');

/** Reduce plurales y algunas terminaciones para que «casas» encuentre «casa». */
function raiz(palabra) {
  let p = palabra;
  if (p.length > 6 && p.endsWith('mente')) p = p.slice(0, -5);
  if (p.length > 5 && (p.endsWith('ces'))) return `${p.slice(0, -3)}z`;
  if (p.length > 4 && (p.endsWith('es'))) p = p.slice(0, -2);
  else if (p.length > 3 && p.endsWith('s')) p = p.slice(0, -1);
  return p;
}

/** Convierte un texto en la lista de palabras que sirven para buscar. */
export function tokenizar(texto) {
  const limpio = sinTildes(String(texto || '').toLowerCase());
  const crudas = limpio.split(/[^a-z0-9ñ]+/u).filter(Boolean);
  const utiles = [];
  for (const palabra of crudas) {
    if (palabra.length < 2 || VACIAS.has(palabra)) continue;
    const base = raiz(palabra);
    if (base.length < 2 || VACIAS.has(base)) continue;
    utiles.push(base);
  }
  return utiles;
}

/**
 * Prepara el documento para buscar en él.
 * @param {{id:*, texto:string}[]} bloques
 */
export function construirIndice(bloques) {
  const lista = Array.isArray(bloques) ? bloques : [];
  const documentos = [];
  const apariciones = new Map(); /* palabra → en cuántos bloques aparece */

  for (const bloque of lista) {
    const palabras = tokenizar(bloque && bloque.texto);
    if (!palabras.length) continue;
    const frecuencias = new Map();
    for (const palabra of palabras) {
      frecuencias.set(palabra, (frecuencias.get(palabra) || 0) + 1);
    }
    for (const palabra of frecuencias.keys()) {
      apariciones.set(palabra, (apariciones.get(palabra) || 0) + 1);
    }
    documentos.push({ id: bloque.id, frecuencias, largo: palabras.length });
  }

  const largoMedio = documentos.length
    ? documentos.reduce((suma, d) => suma + d.largo, 0) / documentos.length
    : 0;

  return { documentos, apariciones, largoMedio, total: documentos.length };
}

/**
 * Devuelve los bloques más relacionados con la consulta, de más a menos.
 * @param {object} indice el que devuelve construirIndice
 * @param {string} consulta pregunta en lenguaje normal
 * @param {{maximo?:number}} opciones
 */
export function buscarRelevantes(indice, consulta, opciones = {}) {
  if (!indice || !indice.total) return [];
  const maximo = Math.max(1, opciones.maximo || 6);
  const palabras = [...new Set(tokenizar(consulta))];
  if (!palabras.length) return [];

  const { documentos, apariciones, largoMedio, total } = indice;
  const puntajes = [];

  for (const doc of documentos) {
    let puntaje = 0;
    for (const palabra of palabras) {
      const frecuencia = doc.frecuencias.get(palabra);
      if (!frecuencia) continue;
      const df = apariciones.get(palabra) || 0;
      /* Cuanto en menos bloques aparezca la palabra, más vale encontrarla. */
      const idf = Math.log(1 + (total - df + 0.5) / (df + 0.5));
      const normalizacion = 1 - B + B * (doc.largo / (largoMedio || 1));
      puntaje += idf * ((frecuencia * (K1 + 1)) / (frecuencia + K1 * normalizacion));
    }
    if (puntaje > 0) puntajes.push({ id: doc.id, puntaje });
  }

  return puntajes.sort((a, b) => b.puntaje - a.puntaje).slice(0, maximo);
}
