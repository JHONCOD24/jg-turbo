/* JG Turbo · El texto tal como debe SONAR, no como debe verse.
 *
 * El motor de voz lee «S. XIX» como ese-punto-equis-i-equis. Este archivo
 * traduce el texto escrito a texto hablado. Su salida NUNCA se muestra en
 * pantalla, ni se guarda, ni se exporta: se genera justo antes de hablar y
 * se tira. Por eso el texto del libro sigue siendo exactamente el del PDF.
 */

const UNIDADES = ['', 'un', 'dos', 'tres', 'cuatro', 'cinco', 'seis', 'siete', 'ocho', 'nueve'];
const DECENAS_10 = ['diez', 'once', 'doce', 'trece', 'catorce', 'quince', 'dieciséis', 'diecisiete', 'dieciocho', 'diecinueve'];
const DECENAS = ['', 'diez', 'veinte', 'treinta', 'cuarenta', 'cincuenta', 'sesenta', 'setenta', 'ochenta', 'noventa'];
const CENTENAS = ['', 'ciento', 'doscientos', 'trescientos', 'cuatrocientos', 'quinientos', 'seiscientos', 'setecientos', 'ochocientos', 'novecientos'];

const ROMANOS_SIGLOS = {
  I: 'uno', II: 'dos', III: 'tres', IV: 'cuatro', V: 'cinco',
  VI: 'seis', VII: 'siete', VIII: 'ocho', IX: 'nueve', X: 'diez',
  XI: 'once', XII: 'doce', XIII: 'trece', XIV: 'catorce', XV: 'quince',
  XVI: 'dieciséis', XVII: 'diecisiete', XVIII: 'dieciocho', XIX: 'diecinueve', XX: 'veinte',
  XXI: 'veintiuno', XXII: 'veintidós',
};

/* Conectores que en español piden una pausa antes: sin ella, el partidor de
 * bloques corta donde le toca y la frase se parte a mitad de idea. Se aplica
 * SOLO aquí, en la capa que se le entrega al motor de voz. */
const CONECTORES_PAUSA = /\s+(pero|aunque|sino|porque|mientras|entonces|además|sin embargo|no obstante|es decir|por tanto|por lo tanto)\s+/gi;

/**
 * ¿Esta línea suelta es un título? Versión mínima para la capa de voz: aquí
 * no hay geometría del PDF, solo el texto. Una línea corta, sola entre saltos
 * y sin signo final es, casi siempre, un título o un encabezado.
 */
function pareceTituloSuelto(linea) {
  const t = linea.trim();
  if (!t || t.length > 70) return false;
  if (/[.!?…:;,»)]$/.test(t)) return false;      /* ya cierra: no hace falta */
  const palabras = t.split(/\s+/).filter(Boolean);
  if (palabras.length > 10) return false;
  const letras = t.replace(/[^A-Za-zÁÉÍÓÚÜÑáéíóúüñ]/g, '');
  if (letras.length < 2) return false;
  /* Mayúsculas, o empieza con palabra de capítulo, o es numeración. */
  if (t === t.toUpperCase()) return true;
  if (/^(cap[íi]tulo|parte|secci[óo]n|libro|tomo|ep[íi]logo|pr[óo]logo|introducci[óo]n|conclusi[óo]n|anexo|ap[ée]ndice|prefacio)\b/i.test(t)) return true;
  if (/^(?:\d{1,3}|[IVXLCDM]{1,7})\s*[.\-–—:]?\s*\S*/.test(t) && palabras.length <= 6) return true;
  return false;
}

/**
 * Convierte un número entero (0 a 9999) a palabras en español.
 * @param {number} n
 * @returns {string}
 */
export function numeroAPalabras(n) {
  if (n === 0) return 'cero';
  if (n === 100) return 'cien';
  if (n < 0 || n > 9999 || !Number.isInteger(n)) return String(n);

  let palabras = '';

  // Miles
  const miles = Math.floor(n / 1000);
  const restoMiles = n % 1000;
  if (miles === 1) {
    palabras += 'mil ';
  } else if (miles > 1) {
    palabras += `${UNIDADES[miles]} mil `;
  }

  // Centenas
  const centenas = Math.floor(restoMiles / 100);
  const restoCentenas = restoMiles % 100;
  if (restoMiles === 100) {
    palabras += 'cien';
    return palabras.trim();
  } else if (centenas > 0) {
    palabras += `${CENTENAS[centenas]} `;
  }

  // Decenas y unidades
  if (restoCentenas >= 10 && restoCentenas <= 19) {
    palabras += DECENAS_10[restoCentenas - 10];
  } else if (restoCentenas >= 21 && restoCentenas <= 29) {
    const u = restoCentenas - 20;
    const veintis = ['', 'veintiuno', 'veintidós', 'veintitrés', 'veinticuatro', 'veinticinco', 'veintiséis', 'veintisiete', 'veintiocho', 'veintinueve'];
    palabras += veintis[u];
  } else {
    const d = Math.floor(restoCentenas / 10);
    const u = restoCentenas % 10;
    if (d > 0) palabras += DECENAS[d];
    if (d > 0 && u > 0) palabras += ' y ';
    if (u > 0) palabras += (u === 1 && (miles > 0 || centenas > 0 || d > 0) ? 'uno' : UNIDADES[u]);
  }

  return palabras.trim();
}

/**
 * Prepara el texto para que la voz sintética lo pronuncie de manera natural.
 * No modifica el DOM ni la base de datos: solo se entrega al motor TTS.
 *
 * @param {string} texto
 * @param {string} idioma  – 'es', 'en', etc.
 * @param {object} [opts]
 * @param {boolean} [opts.neural=true] – Si es true (por defecto), salta las
 *   conversiones numéricas (Edge TTS ya sabe pronunciar «2024» y «45 %») y
 *   no inyecta puntos al final de los párrafos (ttsNormalizarTextoNarracion
 *   ya los convierte en «. », y tenerlo dos veces producía caídas tonales
 *   dobles que sonaban robóticas y pausadas).
 * @param {boolean} [opts.pausarTitulos=true] – Cierra con dos puntos las
 *   líneas sueltas que parecen títulos, para que la voz pause antes del cuerpo.
 * @param {boolean} [opts.comasProsodicas=true] – Inserta una coma antes de
 *   conectores («pero», «aunque»…), para que las frases largas respiren.
 * @returns {string}
 */
export function prepararParaVoz(texto, idioma = 'es', opts = {}) {
  if (!texto || typeof texto !== 'string') return '';
  const neural = opts.neural !== false; // por defecto true
  const pausarTitulos = opts.pausarTitulos !== false; // por defecto true
  const comasProsodicas = opts.comasProsodicas !== false; // por defecto true
  let salida = texto;

  // Si no es español, aplicar solo limpieza básica
  if (idioma !== 'es') {
    if (!neural) salida = salida.replace(/(\d+)\s*%/g, '$1 percent');
    return salida;
  }

  // 1. Siglos romanos: «S. XIX», «s. XXI», «siglo IV», «siglos XVIII y XIX»
  salida = salida.replace(/\b[Ss]iglos?\s+([IVXLCDM]+)\s+y\s+([IVXLCDM]+)\b/g, (match, s1, s2) => {
    const p1 = ROMANOS_SIGLOS[s1.toUpperCase()] || s1;
    const p2 = ROMANOS_SIGLOS[s2.toUpperCase()] || s2;
    return `siglos ${p1} y ${p2}`;
  });
  salida = salida.replace(/\b(?:[Ss]\.?\s*|siglo\s+)([IVXLCDM]+)\b/g, (match, romano) => {
    const val = ROMANOS_SIGLOS[romano.toUpperCase()];
    return val ? `siglo ${val}` : match;
  });

  // 2. Siglas y abreviaciones compuestas (siempre útil: evita que el motor
  //    deletree «EE. UU.» como cuatro letras sueltas)
  salida = salida
    .replace(/\bEE\.\s*UU\./g, 'Estados Unidos')
    .replace(/\bFF\.\s*AA\./g, 'Fuerzas Armadas')
    .replace(/\ba\.\s*C\./g, 'antes de Cristo')
    .replace(/\bd\.\s*C\./g, 'después de Cristo')
    .replace(/\bp\.\s*ej\./g, 'por ejemplo')
    .replace(/\bp\.\s*ejemplo\b/g, 'por ejemplo');

  // 3. Abreviaturas comunes (siempre útil: «Dr.» como punto final falso
  //    corta la oración en el partidor de voz)
  salida = salida
    .replace(/\betc\./g, 'etcétera')
    .replace(/\bDr\./g, 'doctor')
    .replace(/\bDra\./g, 'doctora')
    .replace(/\bSr\./g, 'señor')
    .replace(/\bSra\./g, 'señora')
    .replace(/\bSrta\./g, 'señorita')
    .replace(/\bvs\./gi, 'versus');

  // Las abreviaturas con número (pág., cap.) se expanden siempre porque
  // el punto dispararía un corte de oración falso.
  salida = salida
    .replace(/\bpág\.\s*(\d+)/gi, (_, n) => `página ${numeroAPalabras(parseInt(n, 10))}`)
    .replace(/\bpágs\.\s*(\d+)\s*[-–—]\s*(\d+)/gi, (_, d, h) => `páginas ${numeroAPalabras(parseInt(d, 10))} a ${numeroAPalabras(parseInt(h, 10))}`)
    .replace(/\bcap\.\s*(\d+)/gi, (_, n) => `capítulo ${numeroAPalabras(parseInt(n, 10))}`)
    .replace(/\bart\.\s*(\d+)/gi, (_, n) => `artículo ${numeroAPalabras(parseInt(n, 10))}`)
    .replace(/\bvol\.\s*(\d+)/gi, (_, n) => `volumen ${numeroAPalabras(parseInt(n, 10))}`);

  // ── Reglas 4-6: conversión numérica ──
  // Edge TTS (y Azure) ya pronuncian «2024» como «dos mil veinticuatro» y
  // «45 %» como «cuarenta y cinco por ciento» con prosodia natural. Expandir
  // los números a palabras INFLA el texto (×6 en fechas y rangos), causando
  // más bloques de audio, más cortes y más pausas robóticas.
  // Solo se activan para el fallback del navegador (speechSynthesis), que sí
  // pronuncia los dígitos uno por uno.
  // ── Reglas 4-6: conversión numérica ── solo en fallback navegador
  if (!neural) {
    // 4. Rangos de años o números: «1914-1918» → «de mil ... a mil ...»
    salida = salida.replace(/\b(\d{1,4})\s*[-–—]\s*(\d{1,4})\b/g, (match, n1, n2) => {
      const num1 = parseInt(n1, 10);
      const num2 = parseInt(n2, 10);
      if (num1 <= 9999 && num2 <= 9999) {
        return `de ${numeroAPalabras(num1)} a ${numeroAPalabras(num2)}`;
      }
      return match;
    });
    // 5. Porcentajes
    salida = salida.replace(/\b(\d+)\s*%/g, (_, num) => {
      const n = parseInt(num, 10);
      return `${numeroAPalabras(n)} por ciento`;
    });
    // 6. Números enteros aislados
    salida = salida.replace(/\b(\d{1,4})\b/g, (match) => {
      const n = parseInt(match, 10);
      return numeroAPalabras(n);
    });
    // 7. Pausa de párrafo solo para navegador
    const parrafos = salida.split(/\n\n+/);
    salida = parrafos.map((p) => {
      let tr = p.trim();
      if (!tr) return '';
      if (!/[.!?…:;]$/.test(tr)) tr += '.';
      return tr;
    }).filter(Boolean).join('\n\n');
  }
  // En modo neural, evitar ".." y colapsar saltos
  if (neural) {
    salida = salida.replace(/\.\s*\.\s*/g, '. ');
    salida = salida.replace(/\n{3,}/g, '\n\n');
  } else {
    salida = salida.replace(/\n{3,}/g, '\n\n');
  }

  /* ── Respiración: pausas que solo existen para el oído ──────────────
   *
   * Nada de lo que sigue toca el texto que la persona ve, guarda o exporta:
   * esta cadena se genera justo antes de hablar y se descarta. Por eso se
   * puede añadir puntuación aquí sin romper la promesa de original inmutable.
   */
  if (pausarTitulos) {
    salida = salida.split(/\n\n+/).map((bloque) => {
      const t = bloque.trim();
      if (!t) return '';
      /* Un título sin cierre hace que la voz siga de largo hasta el párrafo
       * siguiente. Los dos puntos suenan mejor que el punto: dejan la
       * entonación abierta, como cuando alguien anuncia un capítulo. */
      return pareceTituloSuelto(t) ? `${t}:` : t;
    }).filter(Boolean).join('\n\n');
  }

  if (comasProsodicas) {
    /* Coma antes del conector solo si no había ya un signo delante. */
    salida = salida.replace(CONECTORES_PAUSA, (coincidencia, conector, desplazamiento, completo) => {
      const anterior = completo[desplazamiento - 1] || '';
      if (/[,;:.!?…]/.test(anterior)) return coincidencia;
      return `, ${conector} `;
    });
  }

  return salida;
}
