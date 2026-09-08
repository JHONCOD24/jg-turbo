/* JG Turbo · Anclaje de bloques de audio en el texto visible
 *
 * La guía de lectura casa cada bloque de audio con su sitio en el capítulo
 * buscando el arranque del bloque en el texto. El fallo clásico: el arranque
 * se repite antes (estribillos, fórmulas, "Capítulo X") y el ancla cae en la
 * repetición temprana. El bloque entonces se barre en menos sitio del real:
 * la guía avanza más despacio que la voz y al cambiar de bloque pega un salto.
 * Medido: retraso creciente hasta 566 caracteres con ritmo de voz constante.
 *
 * La cura: no basta encontrar el arranque, hay que comprobar que el bloque
 * CONTINÚA ahí (puntaje de continuación) y que el ancla no cae demasiado cerca
 * de la anterior (avance mínimo proporcional al bloque previo). Funciones
 * puras y con pruebas.
 */

const TILDES = /[\u0300-\u036f]/g; /* marcas de tilde, ya separadas por NFD */

/**
 * Reduce un texto a sus caracteres con significado (letras y números, sin
 * tildes ni mayúsculas) y recuerda de dónde salió cada uno.
 */
export function compactarTexto(texto) {
  const letras = [];
  const posiciones = [];
  const original = String(texto || '');
  for (let i = 0; i < original.length; i += 1) {
    const suelto = original[i].normalize('NFD').replace(TILDES, '').toLowerCase();
    const c = suelto.charAt(0);
    if ((c >= 'a' && c <= 'z') || (c >= '0' && c <= '9')) {
      letras.push(c);
      posiciones.push(i);
    }
  }
  return { texto: letras.join(''), mapa: posiciones };
}

/**
 * ¿Qué tanto del bloque sigue igual desde esta posición? 0 a 1.
 * Solo mira el arranque (ventana): el motor de voz reescribe por dentro y el
 * final del bloque casi nunca coincide letra a letra.
 */
export function puntuarContinuacion(textoCompacto, bloqueCompacto, desde, ventana = 160) {
  if (desde == null || desde < 0) return 0;
  const n = Math.min(ventana, bloqueCompacto.length);
  if (!n) return 0;
  let ok = 0;
  for (let k = 0; k < n; k += 1) {
    if (textoCompacto[desde + k] === bloqueCompacto[k]) ok += 1;
  }
  return ok / n;
}

/* A partir de este puntaje una ocurrencia se acepta sin seguir buscando. */
export const UMBRAL_CONTINUACION = 0.6;
/* Por debajo de esto ni como último recurso: mejor el reparto proporcional. */
export const MINIMO_CONTINUACION = 0.4;
/* Cuántas repeticiones se revisan como máximo antes de rendirse. */
export const MAX_INTENTOS_ANCLA = 6;

/**
 * Dónde empieza, en texto compacto, cada bloque de audio.
 *
 * @param {string} textoCompacto - capítulo compactado
 * @param {string[]} bloquesCompactos - cada bloque de la cola, compactado
 * @returns {(number|null)[]} ancla por bloque (null = no se encontró)
 */
export function situarBloquesTexto(textoCompacto, bloquesCompactos) {
  const texto = String(textoCompacto || '');
  const bloques = Array.isArray(bloquesCompactos) ? bloquesCompactos : [];
  const anclas = new Array(bloques.length).fill(null);
  let desde = 0;
  let ultimoAncla = 0;
  bloques.forEach((bloque, i) => {
    const aguja = String(bloque || '').slice(0, 48);
    if (aguja.length < 6) return;
    /* El ancla no puede caer pegada a la anterior: el bloque previo ocupa
     * sitio (al menos la mitad de su largo). Así una repetición temprana
     * dentro del bloque anterior ni siquiera se considera. */
    const largoPrevio = i === 0 ? 0 : String(bloques[i - 1] || '').length;
    const baseMin = i === 0 ? 0 : ultimoAncla + Math.floor(largoPrevio * 0.5);
    let buscarDesde = Math.max(desde, 0);
    let primero = -1;
    let mejor = -1;
    let mejorPuntaje = -1;
    for (let intento = 0; intento < MAX_INTENTOS_ANCLA; intento += 1) {
      const cand = texto.indexOf(aguja, buscarDesde);
      if (cand === -1) break;
      if (primero === -1) primero = cand;
      if (cand >= baseMin) {
        const puntaje = puntuarContinuacion(texto, String(bloques[i] || ''), cand);
        if (puntaje > mejorPuntaje) {
          mejorPuntaje = puntaje;
          mejor = cand;
        }
        if (puntaje >= UMBRAL_CONTINUACION) break;
      }
      buscarDesde = cand + 1;
    }
    let elegido = -1;
    if (mejor >= 0 && mejorPuntaje >= MINIMO_CONTINUACION) elegido = mejor;
    else if (primero >= 0) elegido = primero;
    else {
      /* Último recurso de antes: aguja corta. Sin verificación porque ya es
       * aproximado; el reparto proporcional lo acota. */
      if (aguja.length > 16) {
        const corto = texto.indexOf(aguja.slice(0, 16), desde);
        if (corto !== -1) elegido = corto;
      }
      if (elegido === -1) return;
    }
    anclas[i] = elegido;
    ultimoAncla = elegido;
    desde = elegido + Math.max(1, Math.floor(aguja.length / 2));
  });
  return anclas;
}

/**
 * Rellena los huecos (null) repartiendo proporcionalmente entre anclas
 * conocidas, como antes: un fallo suelto no descoloca la guía.
 */
export function rellenarAnclas(anclas, largoTotal) {
  const lista = Array.isArray(anclas) ? anclas.slice() : [];
  let previo = 0;
  for (let i = 0; i < lista.length; i += 1) {
    if (lista[i] != null) { previo = lista[i]; continue; }
    let siguiente = largoTotal;
    let j = i + 1;
    while (j < lista.length && lista[j] == null) j += 1;
    if (j < lista.length) siguiente = lista[j];
    const huecos = j - i + 1;
    lista[i] = Math.round(previo + ((siguiente - previo) * (1 / huecos)));
    previo = lista[i];
  }
  return lista;
}
