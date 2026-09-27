/**
 * Ritmo del doblaje: cuánto acelerar la voz y cuánto frenar el video para que
 * la voz diga TODO a tiempo, sin cortar frases ni saltar líneas.
 *
 * Por qué existe (2026-09-26): el motor anterior obedecía solo al reloj del
 * video. Cuando el video entraba en la frase siguiente, cortaba la voz de la
 * anterior (0,45 s de gracia) y arrancaba la nueva a mitad: se perdía el final
 * de una frase y el principio de la otra. El español ocupa un 20-30 % más que el
 * inglés y la voz solo podía acelerar hasta 1,20×, así que en los tramos rápidos
 * pasaba en casi todas las frases («empieza a leer una línea y salta a la otra»).
 *
 * Ahora la voz nunca se corta: cada frase termina entera y la siguiente espera
 * su turno. Para que la voz no se quede atrás, primero se acelera un poco (hasta
 * 1,12× no se nota) y, si aun así no cabe, el VIDEO se frena solo. Medido el
 * 2026-09-26 con el reproductor real: la IFrame API acepta velocidades en pasos
 * de 0,05 (0,95 · 0,90 · 0,85 · 0,80 · 0,75 exactas; 0,97 lo deja en 0,95).
 *
 * Todo puro: sin DOM, sin red, sin tiempo real.
 */

/** La voz no se frena: si le sobra tiempo, hay una pausa natural. */
export const VOZ_TASA_MIN = 1;
/** Hasta este ritmo nadie nota que la voz va acelerada. */
export const VOZ_TASA_COMODA = 1.12;
/** Techo para ponerse al día en una frase puntual. */
export const VOZ_TASA_MAX = 1.25;
/** Lo más que se frena el video por su cuenta. */
export const VIDEO_FACTOR_MIN = 0.75;
/** YouTube redondea a pasos de 0,05 (medido 2026-09-26). */
export const PASO_TASA_VIDEO = 0.05;
/** Ritmo medido de Salomé (es-CO) a 1× con 239 caracteres: 17,5 car/s (2026-09-26). */
export const CARACTERES_POR_SEGUNDO = 17.5;
/** Antes de traducir: el español ocupa ~15 % más que el inglés. */
export const RELACION_ES_EN = 1.15;
/** Cuánto video por delante mira el plan de ritmo. */
export const HORIZONTE_RITMO_S = 20;
/** Igual que `SILENCIO_PRESTADO_MAX_S` de dubbingService: pausa que una frase puede ocupar. */
export const SILENCIO_PRESTADO_S = 2;

const acotar = (valor, minimo, maximo) => Math.min(maximo, Math.max(minimo, valor));
const numero = (valor, porDefecto = 0) => (Number.isFinite(Number(valor)) ? Number(valor) : porDefecto);

/** Redondea HACIA ABAJO al paso que acepta YouTube (0,87 → 0,85). */
export function redondearTasaVideo(tasa) {
  const valor = numero(tasa, 1);
  if (valor <= 0) return 1;
  const pasos = Math.floor(valor / PASO_TASA_VIDEO + 1e-9);
  return acotar(Math.round(pasos * PASO_TASA_VIDEO * 100) / 100, 0.25, 2);
}

/**
 * Velocidades permitidas para la voz según la velocidad que eligió la persona
 * en el engranaje de YouTube. A 1,5× la voz también va más rápida; a 0,75× la
 * voz no se frena (sonaría en cámara lenta).
 */
export function rangoVoz(tasaBase = 1) {
  const base = Math.max(1, numero(tasaBase, 1));
  return {
    min: base === 1 ? VOZ_TASA_MIN : Math.min(2, base * 0.95),
    comoda: Math.min(2, VOZ_TASA_COMODA * base),
    max: Math.min(2, VOZ_TASA_MAX * base),
  };
}

/** Fin de lo que se dice en el original (sin el silencio prestado). */
const finDeHabla = (unidad) => numero(unidad?.finHabla ?? unidad?.endTime);

/**
 * Hasta cuándo (tiempo de video) debería terminar la voz de una frase.
 * `duro`: cuando empieza la frase siguiente (pasarse ahí es ir con retraso).
 * `suave`: el final de lo dicho más el silencio prestado, si llega antes.
 */
export function limitesDeUnidad(unidades, indice) {
  const unidad = unidades?.[indice];
  if (!unidad) return { suave: 0, duro: 0 };
  const siguiente = unidades[indice + 1];
  const conPausa = finDeHabla(unidad) + SILENCIO_PRESTADO_S;
  const duro = siguiente ? numero(siguiente.startTime, conPausa) : conPausa;
  return { suave: Math.min(duro, conPausa), duro };
}

/**
 * Velocidad de la voz para lo que le queda a la frase que suena.
 * Primero intenta terminar a tiempo sin pasar del ritmo cómodo; solo si no
 * llega, acelera hasta el techo. Si le sobra tiempo, suena a su ritmo natural.
 */
export function velocidadVoz({ restanteS, tiempoVideo, limiteSuave, limiteDuro, tasaVideo = 1, tasaBase = 1 }) {
  const { min, comoda, max } = rangoVoz(tasaBase);
  const resto = Math.max(0, numero(restanteS));
  if (!resto) return min;
  const video = Math.max(0.1, numero(tasaVideo, 1));
  const pared = (limite) => (numero(limite) - numero(tiempoVideo)) / video;   // segundos reales
  const necesaria = (limite) => {
    const segundos = pared(limite);
    return segundos > 0.05 ? resto / segundos : Number.POSITIVE_INFINITY;
  };
  const suave = necesaria(limiteSuave);
  if (suave <= comoda) return Math.round(Math.max(min, suave) * 100) / 100;
  const dura = necesaria(limiteDuro ?? limiteSuave);
  return Math.round(acotar(dura, comoda, max) * 100) / 100;
}

/**
 * Segundos de voz (a 1×) que tendrá una frase. Se usa la duración real si ya
 * se generó; si no, se estima por el texto (o por el original sin traducir).
 */
export function duracionVozEstimada(unidad, caracteresPorSegundo = CARACTERES_POR_SEGUNDO) {
  if (!unidad) return 0;
  if (numero(unidad.duracionVoz) > 0) return numero(unidad.duracionVoz);
  if (unidad.estado === 'sin_voz' || unidad.estado === 'error') return 0;   // ahí suena el original
  const texto = String(unidad.text || '');
  if (texto) return texto.length / caracteresPorSegundo;
  return String(unidad.textoOriginal || '').length * RELACION_ES_EN / caracteresPorSegundo;
}

/**
 * Cuánta voz hay que decir en los próximos segundos y cuánto video hay para
 * decirla. `siguiente` = primera frase que aún no empezó a sonar; `restanteS`
 * = lo que le falta (a 1×) a la que suena ahora.
 */
export function demandaVoz({ unidades, tiempoVideo, siguiente, restanteS = 0, horizonteS = HORIZONTE_RITMO_S }) {
  const lista = Array.isArray(unidades) ? unidades : [];
  const t = numero(tiempoVideo);
  let necesario = Math.max(0, numero(restanteS));
  let j = Math.max(0, numero(siguiente));
  for (; j < lista.length && numero(lista[j].startTime) < t + horizonteS; j += 1) {
    necesario += duracionVozEstimada(lista[j]);
  }
  let fin = t;
  if (j < lista.length) fin = numero(lista[j].startTime);
  else if (lista.length) fin = limitesDeUnidad(lista, lista.length - 1).duro;
  return { necesarioS: necesario, videoS: Math.max(0, fin - t) };
}

/**
 * Velocidad (sin redondear) a la que debe ir el video para que la voz quepa a
 * ritmo cómodo. Nunca más rápida que la elegida por la persona ni más lenta
 * que 0,75× de ella. `retrasoS` (cuánto va la voz por detrás) frena un poco más
 * aunque el plan diga que cabe: es la red de seguridad.
 */
export function tasaVideoCruda({ necesarioS, videoS, tasaBase = 1, retrasoS = 0 }) {
  const base = numero(tasaBase, 1) > 0 ? numero(tasaBase, 1) : 1;
  const { comoda } = rangoVoz(base);
  let factor = 1;
  if (necesarioS > 0.2 && videoS > 0.2) {
    // Voz: necesarioS / comoda segundos reales. Video: videoS / tasa.
    // Cabe si tasa ≤ videoS · comoda / necesarioS.
    factor = Math.min(1, (videoS * comoda) / necesarioS / base);
  } else if (necesarioS > 0.2) {
    factor = VIDEO_FACTOR_MIN;   // hay voz pendiente y ya no queda video: frenar lo máximo
  }
  // Un déficit pequeño lo absorbe la voz (de 1,12× a 1,25×) sin tocar el video.
  if (factor > 0.96) factor = 1;
  if (retrasoS > 1.5) factor = Math.min(factor, 0.85);
  if (retrasoS > 3) factor = Math.min(factor, VIDEO_FACTOR_MIN);
  return base * Math.max(VIDEO_FACTOR_MIN, factor);
}

/**
 * La misma velocidad, en el paso de 0,05 MÁS CERCANO (no hacia abajo): la voz
 * tiene holgura (de 1,12× a 1,25×) para el resto. Redondear siempre hacia abajo
 * hacía saltar 0,80 ↔ 0,75 por milésimas (32 cambios en 3 min, simulado).
 */
export function tasaVideoObjetivo(datos) {
  const base = numero(datos?.tasaBase, 1) > 0 ? numero(datos?.tasaBase, 1) : 1;
  const cruda = tasaVideoCruda(datos);
  if (cruda >= base - 1e-9) return base;
  const paso = Math.round(cruda / PASO_TASA_VIDEO + 1e-9) * PASO_TASA_VIDEO;
  // El mínimo también en la rejilla de 0,05 (a 1,25× elegido, 0,9375 → 0,95).
  const minimo = Math.ceil((base * VIDEO_FACTOR_MIN) / PASO_TASA_VIDEO - 1e-9) * PASO_TASA_VIDEO;
  return Math.round(acotar(paso, minimo, base) * 100) / 100;
}

/**
 * Dónde termina cada segmento dentro del texto de la frase (fracciones 0–1,
 * acumuladas). Sirve para mostrar en el subtítulo la línea que la voz está
 * diciendo: la voz habla en proporción al texto.
 */
export function fraccionesDeUnidad(unidad, textoDe) {
  if (!unidad) return [];
  const largos = [];
  for (let i = unidad.desde; i <= unidad.hasta; i += 1) {
    largos.push(Math.max(1, String((typeof textoDe === 'function' ? textoDe(i) : '') || '').length));
  }
  const total = largos.reduce((suma, largo) => suma + largo, 0) || 1;
  let acumulado = 0;
  return largos.map((largo) => {
    acumulado += largo;
    return Math.round((acumulado / total) * 10000) / 10000;
  });
}

/** Segmento que está diciendo la voz según su avance (0–1) dentro de la frase. */
export function segmentoPorAvance(unidad, avance) {
  if (!unidad) return -1;
  const cantidad = unidad.hasta - unidad.desde + 1;
  const fracciones = Array.isArray(unidad.fracciones) && unidad.fracciones.length === cantidad
    ? unidad.fracciones
    : Array.from({ length: cantidad }, (_, k) => (k + 1) / cantidad);
  const p = acotar(numero(avance), 0, 1);
  for (let k = 0; k < fracciones.length; k += 1) if (p < fracciones[k]) return unidad.desde + k;
  return unidad.hasta;
}

/** Punto del video (en segundos) al que corresponde lo que dice la voz. */
export function posicionVozEnVideo(unidad, avance) {
  if (!unidad) return 0;
  const inicio = numero(unidad.startTime);
  return inicio + acotar(numero(avance), 0, 1) * Math.max(0, finDeHabla(unidad) - inicio);
}

/** Avance (0–1) que le corresponde a una frase en un instante del video (tras un salto). */
export function avanceDeVideo(unidad, tiempoVideo) {
  if (!unidad) return 0;
  const inicio = numero(unidad.startTime);
  const fin = finDeHabla(unidad);
  if (!(fin > inicio)) return 0;
  return acotar((numero(tiempoVideo) - inicio) / (fin - inicio), 0, 1);
}

/** Frase que cubre el instante `t` o, si cae en un silencio, la siguiente. -1 si no queda ninguna. */
export function unidadEn(unidades, t) {
  const lista = Array.isArray(unidades) ? unidades : [];
  let izquierda = 0;
  let derecha = lista.length - 1;
  let candidata = -1;
  while (izquierda <= derecha) {
    const mitad = (izquierda + derecha) >> 1;
    if (numero(lista[mitad].startTime) <= t) { candidata = mitad; izquierda = mitad + 1; } else derecha = mitad - 1;
  }
  if (candidata < 0) return lista.length ? 0 : -1;
  if (t < limitesDeUnidad(lista, candidata).duro) return candidata;
  return candidata + 1 < lista.length ? candidata + 1 : -1;
}
