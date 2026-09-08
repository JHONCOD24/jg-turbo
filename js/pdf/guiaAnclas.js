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
 * Como la síntesis de voz divide el texto de forma secuencial y contigua,
 * cada bloque i DEBE arrancar en torno a donde termina el bloque i-1.
 * Buscar el arranque mediante una ventana local guiada por cursor evita
 * caer en estribillos, palabras repetidas o arranques previos de la página anterior,
 * eliminando por completo el desfase y el salto tardío de página.
 *
 * @param {string} textoCompacto - capítulo compactado
 * @param {string[]} bloquesCompactos - cada bloque de la cola, compactado
 * @param {number} [inicioCompacto=0] - posición compacta inicial (para "leer desde aquí")
 * @returns {(number|null)[]} ancla por bloque (null = no se encontró)
 */
export function situarBloquesTexto(textoCompacto, bloquesCompactos, inicioCompacto = 0) {
  const texto = String(textoCompacto || '');
  const bloques = Array.isArray(bloquesCompactos) ? bloquesCompactos : [];
  const anclas = new Array(bloques.length).fill(null);
  let cursor = Math.max(0, Math.min(texto.length, Number(inicioCompacto) || 0));
  let ultimoAncla = null;
  let ultimoLargo = 0;

  for (let i = 0; i < bloques.length; i += 1) {
    const bloque = String(bloques[i] || '');
    if (bloque.length < 6) {
      if (ultimoAncla != null) cursor = ultimoAncla + ultimoLargo + bloque.length;
      continue;
    }

    const cursorEsperado = ultimoAncla != null ? ultimoAncla + ultimoLargo : cursor;
    const lenAguja = Math.min(36, bloque.length);
    const aguja = bloque.slice(0, lenAguja);

    // Ventana local alrededor de cursorEsperado: [cursorEsperado - 40, cursorEsperado + ...]
    const winMin = Math.max(0, cursorEsperado - 40);
    const winMax = Math.min(texto.length, cursorEsperado + Math.max(220, lenAguja + 60));
    const trozo = texto.slice(winMin, winMax);

    let p = trozo.indexOf(aguja);
    if (p === -1 && lenAguja > 20) p = trozo.indexOf(bloque.slice(0, 20));
    if (p === -1 && lenAguja > 12) p = trozo.indexOf(bloque.slice(0, 12));

    let cand = -1;
    if (p !== -1) {
      cand = winMin + p;
      const score = puntuarContinuacion(texto, bloque, cand);
      if (score < 0.3 && i > 0) cand = -1;
    }

    // Si no se encontró en la ventana local, buscar un poco más adelante
    if (cand === -1) {
      const trozoExt = texto.slice(cursorEsperado, Math.min(texto.length, cursorEsperado + 500));
      const pExt = trozoExt.indexOf(bloque.slice(0, Math.min(24, lenAguja)));
      if (pExt !== -1) {
        const cExt = cursorEsperado + pExt;
        if (puntuarContinuacion(texto, bloque, cExt) >= 0.4) {
          cand = cExt;
        }
      }
    }

    if (cand !== -1) {
      // Garantizar avance estrictamente monótono: no retroceder
      if (ultimoAncla != null && cand <= ultimoAncla) {
        cand = ultimoAncla + Math.max(1, Math.floor(ultimoLargo * 0.5));
      }
      anclas[i] = cand;
      ultimoAncla = cand;
      ultimoLargo = bloque.length;
      cursor = cand + bloque.length;
    } else {
      // Dejar null para que rellenarAnclas interpole, y avanzar el cursor
      cursor = cursorEsperado + bloque.length;
    }
  }
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
