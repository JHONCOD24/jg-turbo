/* JG Turbo · Dónde estaba leyendo, dicho de una forma que sobrevive a los cambios
 *
 * Guardar «iba por el carácter 5820» funciona hasta que el capítulo cambia de
 * tamaño: la auditoría añade signos, el pulido reacomoda espacios, la traducción
 * lo reescribe entero. Entonces el 5820 apunta a cualquier parte.
 *
 * Por eso el ancla guarda dos cosas: el índice (rápido, casi siempre correcto) y
 * un trocito del texto que había ahí (la «cita»). Si el índice ya no encaja, se
 * busca la cita. Es lo mismo que hace un lector de libros electrónicos cuando
 * cambias el tamaño de la letra.
 *
 * Funciones puras: entran textos, salen números. Se prueban sin navegador.
 */

/* Suficiente para ser único en un capítulo, corto para sobrevivir a retoques. */
const LARGO_CITA = 40;
const LARGO_ANTES = 24;

const acotar = (valor, minimo, maximo) => Math.max(minimo, Math.min(maximo, valor));

/** Quita tildes y mayúsculas: así «comprendio» y «comprendió» son la misma aguja. */
function normalizar(texto) {
  return String(texto || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

/**
 * Describe una posición de forma que se pueda recuperar más tarde.
 * @param {string} texto
 * @param {number} caracter
 * @returns {{caracter:number, cita:string, antes:string}}
 */
export function construirAncla(texto, caracter) {
  const t = String(texto || '');
  const pos = acotar(Math.floor(Number(caracter) || 0), 0, t.length);
  return {
    caracter: pos,
    cita: t.slice(pos, pos + LARGO_CITA),
    antes: t.slice(Math.max(0, pos - LARGO_ANTES), pos),
  };
}

/**
 * Devuelve el índice de carácter que corresponde al ancla en este texto.
 * Nunca falla: si no puede encontrar nada, devuelve una posición válida.
 * @param {string} texto
 * @param {{caracter:number, cita:string, antes:string}|null} ancla
 * @returns {number}
 */
export function resolverAncla(texto, ancla) {
  const t = String(texto || '');
  if (!t.length) return 0;
  if (!ancla) return 0;

  const indice = acotar(Math.floor(Number(ancla.caracter) || 0), 0, t.length);
  const cita = String(ancla.cita || '');

  /* Sin cita solo queda el índice: es lo que hacía la versión anterior. */
  if (cita.length < 8) return indice;

  /* 1) ¿El texto no cambió? Comprobación barata primero. */
  if (t.startsWith(cita, indice)) return indice;

  /* 2) Buscar la cita, empezando cerca de donde estaba: en un libro la misma
   *    frase puede repetirse, y la copia correcta es la más cercana. */
  const tn = normalizar(t);
  const cn = normalizar(cita);
  const encontrado = buscarMasCercano(tn, cn, indice);
  if (encontrado >= 0) return encontrado;

  /* 3) La cita completa no aparece (el capítulo se reescribió). Se prueba con
   *    su primera mitad, que aguanta mejor los retoques de puntuación. */
  const mitad = cn.slice(0, Math.max(10, Math.floor(cn.length / 2)));
  const porMitad = buscarMasCercano(tn, mitad, indice);
  if (porMitad >= 0) return porMitad;

  /* 4) Último recurso: el fragmento anterior, por si la cita cambió pero lo
   *    que venía justo antes sobrevivió. */
  const antes = normalizar(ancla.antes || '');
  if (antes.length >= 8) {
    const porAntes = buscarMasCercano(tn, antes, indice);
    if (porAntes >= 0) return acotar(porAntes + antes.length, 0, t.length);
  }

  /* Nada encajó: se conserva el índice acotado. Puede estar desplazado, pero
   * es mejor que mandar al usuario al principio del capítulo. */
  return indice;
}

/** Ocurrencia de `aguja` más cercana a `referencia` (o -1 si no hay ninguna). */
function buscarMasCercano(pajar, aguja, referencia) {
  if (!aguja) return -1;
  let mejor = -1;
  let mejorDistancia = Infinity;
  let desde = 0;
  for (let vueltas = 0; vueltas < 500; vueltas += 1) {
    const donde = pajar.indexOf(aguja, desde);
    if (donde === -1) break;
    const distancia = Math.abs(donde - referencia);
    if (distancia < mejorDistancia) {
      mejor = donde;
      mejorDistancia = distancia;
    }
    desde = donde + 1;
  }
  return mejor;
}
