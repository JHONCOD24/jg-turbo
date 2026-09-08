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
export const UMBRAL_CONTINUACION = 0.55;
/* Por debajo de esto ni como último recurso: mejor el reparto proporcional. */
export const MINIMO_CONTINUACION = 0.45;
/* Cuántas repeticiones se revisan como máximo antes de rendirse. */
export const MAX_INTENTOS_ANCLA = 6;
/* La aguja larga es la que distingue un sitio de otro en un libro real: con
 * 36 letras (~7 palabras) cualquier frase hecha ("nadie del pueblo se
 * atrevía") aparece varias veces; con 64 (~12 palabras) casi siempre es
 * única. Más larga sería frágil ante las expansiones de la voz
 * ("EE. UU." → "Estados Unidos" cambia 9 letras seguidas). */
export const LARGO_AGUJA = 64;
/* La ventana absorbe la deriva acumulada entre voz y texto. La voz habla una
 * copia transformada (sin "[12]", con abreviaturas expandidas), así que cada
 * bloque se corre 10-30 letras frente al visible; tras 20 bloques son cientos.
 * La ventana de antes era de +220: a mitad de capítulo el sitio real ya no
 * estaba dentro y el ancla fallaba en cascada. */
export const VENTANA_ATRAS = 80;
export const VENTANA_ADELANTE = 600;
/* Cuánto tiene que avanzar cada ancla frente a la anterior (proporción del
 * bloque previo). Sin esto, un estribillo hacía caer el ancla en la
 * repetición temprana y la guía avanzaba al ~30% de la voz. */
export const AVANCE_MINIMO = 0.6;

/**
 * Dónde empieza, en texto compacto, cada bloque de audio, con detalle de
 * cuáles se situaron buscando de verdad y cuáles quedaron pendientes.
 *
 * Como la síntesis de voz divide el texto de forma secuencial y contigua,
 * cada bloque i DEBE arrancar en torno a donde termina el bloque i-1.
 * Buscar el arranque mediante una ventana local guiada por cursor evita
 * caer en estribillos, palabras repetidas o arranques previos de la página anterior,
 * eliminando por completo el desfase y el salto tardío de página.
 *
 * La diferencia con la versión ingenua: la aguja es larga (única), la ventana
 * absorbe la deriva que meten las transformaciones de voz, se revisan hasta
 * 6 ocurrencias quedándose con la de mejor continuación, y se exige un
 * avance mínimo frente al bloque previo (los estribillos quedan descartados
 * aunque suenen igual).
 *
 * @param {string} textoCompacto - capítulo compactado
 * @param {string[]} bloquesCompactos - cada bloque de la cola, compactado
 * @param {number} [inicioCompacto=0] - posición compacta inicial (para "leer desde aquí")
 * @returns {{anclas:(number|null)[], firmes:boolean[]}} ancla por bloque
 *   (null = no se encontró) y si se situó buscando (true) o quedó pendiente.
 */
export function situarBloquesDetallado(textoCompacto, bloquesCompactos, inicioCompacto = 0) {
  const texto = String(textoCompacto || '');
  const bloques = Array.isArray(bloquesCompactos) ? bloquesCompactos : [];
  const anclas = new Array(bloques.length).fill(null);
  const firmes = new Array(bloques.length).fill(false);
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
    const avanceMinimo = ultimoAncla != null
      ? ultimoAncla + Math.floor(ultimoLargo * AVANCE_MINIMO)
      : 0;
    const lenAguja = Math.min(LARGO_AGUJA, bloque.length);
    const aguja = bloque.slice(0, lenAguja);

    // Ventana local alrededor de cursorEsperado, con aire hacia atrás por si
    // el cursor viene corrido de bloques anteriores.
    const winMin = Math.max(0, cursorEsperado - VENTANA_ATRAS);
    const winMax = Math.min(texto.length, cursorEsperado + Math.max(VENTANA_ADELANTE, lenAguja + 120));
    const trozo = texto.slice(winMin, winMax);

    // Juntar candidatas (hasta 6) dentro de la ventana, de la aguja larga a
    // la corta: la larga es única pero frágil ante expansiones; la corta
    // aparece en más sitios pero la continuación la desempata.
    const agujas = [aguja];
    if (lenAguja > 40) agujas.push(bloque.slice(0, 40));
    if (lenAguja > 20) agujas.push(bloque.slice(0, 20));
    if (lenAguja > 12) agujas.push(bloque.slice(0, 12));
    const vistas = new Set();
    const candidatas = [];
    for (const ag of agujas) {
      if (!ag || ag.length < 6) continue;
      let desde = 0;
      while (candidatas.length < MAX_INTENTOS_ANCLA) {
        const p = trozo.indexOf(ag, desde);
        if (p === -1) break;
        const global = winMin + p;
        if (!vistas.has(global)) {
          vistas.add(global);
          candidatas.push(global);
        }
        desde = p + 1;
      }
      if (candidatas.length) break;
    }

    // Quedarse con la de mejor continuación que cumpla el avance mínimo.
    // Si ninguna lo cumple pero alguna puntúa bien, se acepta la mejor que
    // no retroceda (un salto atrás se ve como parpadeo y desorienta).
    let mejor = -1;
    let mejorPuntaje = -1;
    let mejorSinRetroceso = -1;
    let mejorPuntajeSinRetroceso = -1;
    for (const cand of candidatas) {
      const puntaje = puntuarContinuacion(texto, bloque, cand, 240);
      if (puntaje > mejorPuntajeSinRetroceso && (ultimoAncla == null || cand > ultimoAncla)) {
        mejorPuntajeSinRetroceso = puntaje;
        mejorSinRetroceso = cand;
      }
      if (cand < avanceMinimo) continue;
      if (puntaje > mejorPuntaje) {
        mejorPuntaje = puntaje;
        mejor = cand;
      }
    }
    let elegido = -1;
    if (mejor !== -1 && mejorPuntaje >= UMBRAL_CONTINUACION) {
      elegido = mejor;
    } else if (mejorSinRetroceso !== -1 && mejorPuntajeSinRetroceso >= MINIMO_CONTINUACION
      && mejorSinRetroceso >= avanceMinimo - Math.floor(ultimoLargo * 0.2)) {
      elegido = mejorSinRetroceso;
    }

    // Último recurso: mirar un poco más adelante (la deriva acumulada puede
    // haber sacado el sitio de la ventana).
    if (elegido === -1) {
      const trozoExt = texto.slice(cursorEsperado, Math.min(texto.length, cursorEsperado + 900));
      const pExt = trozoExt.indexOf(bloque.slice(0, Math.min(24, lenAguja)));
      if (pExt !== -1) {
        const cExt = cursorEsperado + pExt;
        if (cExt >= avanceMinimo && puntuarContinuacion(texto, bloque, cExt, 240) >= MINIMO_CONTINUACION) {
          elegido = cExt;
        }
      }
    }

    if (elegido !== -1) {
      anclas[i] = elegido;
      firmes[i] = true;
      ultimoAncla = elegido;
      ultimoLargo = bloque.length;
      cursor = elegido + bloque.length;
    } else {
      // Se deja en null para interpolar después; el cursor avanza lo que
      // mediría este bloque para no arrastrar la deriva a los siguientes.
      cursor = cursorEsperado + bloque.length;
    }
  }
  return { anclas, firmes };
}

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
  return situarBloquesDetallado(textoCompacto, bloquesCompactos, inicioCompacto).anclas;
}

/**
 * Rellena los huecos (null) repartiendo proporcionalmente entre anclas
 * conocidas, como antes: un fallo suelto no descoloca la guía.
 *
 * Si se pasan los largos de cada bloque, el hueco se reparte según lo que
 * mide cada bloque (un bloque largo ocupa más sitio que uno corto); sin
 * ellos se reparte a partes iguales, como siempre.
 */
export function rellenarAnclas(anclas, largoTotal, largos) {
  const lista = Array.isArray(anclas) ? anclas.slice() : [];
  const total = Number(largoTotal) || 0;
  const tieneLargos = Array.isArray(largos) && largos.length === lista.length
    && largos.some((l) => (Number(l) || 0) > 0);
  let i = 0;
  while (i < lista.length) {
    if (lista[i] != null) { i += 1; continue; }
    const huecoIni = i;
    while (i < lista.length && lista[i] == null) i += 1;
    const huecoFin = i; // primer conocido después, o lista.length
    const previo = huecoIni > 0 ? (lista[huecoIni - 1] ?? 0) : 0;
    const siguiente = huecoFin < lista.length ? lista[huecoFin] : total;
    const m = huecoFin - huecoIni; // anclas desconocidas en este hueco
    if (!tieneLargos) {
      for (let k = 0; k < m; k += 1) {
        lista[huecoIni + k] = Math.round(previo + ((siguiente - previo) * ((k + 1) / (m + 1))));
      }
      continue;
    }
    // Cada tramo entre `previo` y `siguiente` pertenece a un bloque: el
    // primero al bloque anterior al hueco (o al primero si el hueco abre),
    // los demás a cada bloque del hueco. Un bloque largo ocupa más sitio.
    const pesos = [];
    for (let t = 0; t <= m; t += 1) {
      const bloque = Math.max(0, Math.min(lista.length - 1, huecoIni - 1 + t));
      pesos.push(Math.max(1, Number(largos[bloque]) || 0));
    }
    const suma = pesos.reduce((a, b) => a + b, 0) || 1;
    let acumulado = 0;
    for (let k = 0; k < m; k += 1) {
      acumulado += pesos[k];
      lista[huecoIni + k] = Math.round(previo + ((siguiente - previo) * (acumulado / suma)));
    }
  }
  return lista;
}

/* ── Tiempo de habla: el habla no avanza a ritmo parejo por letra ────────
 *
 * La guía suponía que la mitad del tiempo de un bloque corresponde a la
 * mitad de sus letras. Pero la voz se detiene en la puntuación: una coma es
 * una pausa corta y un punto es una larga. En un bloque de 900 letras con
 * varios puntos, el error de suponer ritmo parejo es de varias líneas: la
 * voz va por delante en el texto corrido y se queda atrás en la puntuación.
 *
 * El modelo es deliberadamente simple (pesos fijos, sin red ni idioma): lo
 * único que necesita es ordenar bien "dónde cae la mitad del tiempo", no
 * predecir milisegundos. Funciones puras y con pruebas.
 */

/** Cuánto "tiempo de habla" cuesta una letra según lo que viene después. */
export function costoHablaDe(letra, colaTrasElla) {
  void letra;
  const cola = String(colaTrasElla || '');
  if (/\n\s*\n/.test(cola.slice(0, 3))) return 27;   // párrafo: pausa larga
  if (/^\n/.test(cola)) return 11;                    // renglón: pausa media
  const hallado = cola.match(/^\s*[»"'’”)\]]*\s*([.!?…]+|[,;:\u2014\u2013—–-])/);
  const signo = (hallado && hallado[1]) || '';
  if (/[.!?…]/.test(signo)) return 19;                // punto: la voz respira
  if (signo) return 8;                                // coma y familia: pausa corta
  return 1;                                           // letra normal
}

/**
 * Costo de habla por cada posición compacta, mirando la puntuación real que
 * quedó entre esa letra y la siguiente (el compacto no trae signos, pero el
 * mapa dice dónde estaba cada letra en el texto real).
 */
export function construirCostos(textoReal, mapa) {
  const real = String(textoReal || '');
  const posiciones = Array.isArray(mapa) ? mapa : [];
  const costos = new Array(posiciones.length);
  for (let i = 0; i < posiciones.length; i += 1) {
    const desde = Number(posiciones[i]) || 0;
    const cola = real.slice(desde + 1, Math.min(real.length, desde + 6));
    costos[i] = costoHablaDe(real[desde] || '', cola);
  }
  return costos;
}

/** Suma acumulada de costos: acum[i] = costo de las posiciones [0, i). */
export function acumularCostos(costos) {
  const lista = Array.isArray(costos) ? costos : [];
  const acum = new Array(lista.length + 1);
  acum[0] = 0;
  for (let i = 0; i < lista.length; i += 1) acum[i + 1] = acum[i] + (Number(lista[i]) || 0);
  return acum;
}

function costoEntre(acum, desde, hasta) {
  const a = Array.isArray(acum) ? acum : [0];
  const d = Math.max(0, Math.min(a.length - 1, Math.round(desde)));
  const h = Math.max(0, Math.min(a.length - 1, Math.round(hasta)));
  return Math.max(0, (a[h] || 0) - (a[d] || 0));
}

/**
 * De fracción de tiempo (0-1 dentro del tramo) a posición compacta.
 * Con pausas al final del tramo, la mitad del tiempo cae antes de la mitad
 * de las letras: justo lo que el modelo lineal hacía mal.
 */
export function posicionPorTiempo(acum, inicio, fin, fraccion) {
  const ini = Math.max(0, Math.round(inicio));
  const limite = Math.max(ini, Math.round(fin));
  const f = Math.max(0, Math.min(1, Number(fraccion) || 0));
  if (!(limite > ini)) return ini;
  if (f <= 0) return ini;
  if (f >= 1) return limite;
  const total = costoEntre(acum, ini, limite);
  if (!(total > 0)) return Math.round(ini + (limite - ini) * f);
  const objetivo = f * total;
  const base = (Array.isArray(acum) ? acum : [0])[ini] || 0;
  let bajo = ini;
  let alto = limite;
  while (bajo < alto) {
    const medio = Math.floor((bajo + alto) / 2);
    const c = ((Array.isArray(acum) ? acum : [0])[medio + 1] || 0) - base;
    if (c < objetivo) bajo = medio + 1;
    else alto = medio;
  }
  return Math.max(ini, Math.min(limite, bajo));
}

/**
 * Camino inverso: de posición compacta a fracción de tiempo dentro del tramo.
 * Es lo que se le entrega a `ttsIrABloque` al saltar a un párrafo: el motor
 * razona en segundos, así que hay que pedirle tiempo, no letras.
 */
export function tiempoPorPosicion(acum, inicio, fin, posicion) {
  const ini = Math.max(0, Math.round(inicio));
  const limite = Math.max(ini, Math.round(fin));
  const pos = Math.max(ini, Math.min(limite, Math.round(posicion)));
  if (!(limite > ini)) return 0;
  const total = costoEntre(acum, ini, limite);
  if (!(total > 0)) return (pos - ini) / (limite - ini);
  return costoEntre(acum, ini, pos) / total;
}
