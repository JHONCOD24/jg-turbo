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

/* Pausas estructurales (plan §4 «Voz y pausas»): marcas que el motor de voz
 * convierte en silencio real en la cola (700 ms tras títulos, 1000 ms entre
 * capítulos). Se generan solo para el motor neural y se descartan antes de
 * sintetizar: nunca llegan al sintetizador ni al texto visible. */
export const MARCA_PAUSA_TITULO = '§P0700§';
export const MARCA_PAUSA_CAPITULO = '§P1000§';
export const REGEX_MARCA_PAUSA = /§P(\d{3,5})§/g;

/** Antepone la pausa de cambio de capítulo al texto del capítulo siguiente. */
export function conPausaDeCapitulo(texto) {
  const t = String(texto || '');
  return t ? `${MARCA_PAUSA_CAPITULO}\n\n${t}` : t;
}

/**
 * Sanea lo que el PDF deja cosido al texto y el motor no sabe decir.
 *
 * Medido en lectura real (2026-09-12): una palabra normal («petición») sonaba
 * deletreada por letras y algunos tramos cambiaban de timbre a media frase.
 * Las causas viven en la extracción, no en la voz:
 * - el PDF trae tildes desarmadas (`o` + acento suelto) en vez de `ó`;
 * - guiones blandos e invisibles (`\u00AD`, ancho cero) partidos en la palabra;
 * - títulos con tracking ancho que llegan como `P E T I C I O N`;
 * - cortes de renglón con guion (`palabra-\ncontinuación`).
 * Cada uno convierte una palabra en fichas sueltas, y el sintetizador las
 * deletrea o las manda a otra voz. Se juntan aquí, solo en la copia que se
 * habla: el visible, el guardado y el exportado no se tocan.
 */
export function sanearTextoParaVoz(texto) {
  let t = String(texto || '');
  if (!t) return t;
  if (typeof t.normalize === 'function') t = t.normalize('NFC');
  /* Invisibles: guion blando, ancho cero, juntador de palabras, BOM. */
  t = t.replace(/[\u00AD\u200B-\u200D\uFEFF\u2060\u180E]/g, '');
  /* Controles sueltos que a veces deja el extractor. */
  t = t.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '');
  /* Palabra partida al final del renglón: «palabra-\ncontinuación» → una sola.
   * Solo con salto real en medio: un guion con espacios («autor - lector»)
   * es un inciso del autor y se conserva. */
  t = t.replace(/(\p{L})-\s*\n\s*(\p{L})/gu, '$1$2');
  /* Letras espaciadas («P E T I C I O N»): el tracking del título las separó y
   * el motor las deletrea. Se juntan solo con 4+ letras: con 3 o menos son
   * iniciales o sigla («U S A», «a b c») y deletrearlas es lo correcto. Las
   * iniciales con puntos («J. R. R.») no se tocan: otra regla las junta
   * conservando los puntos para que suenen de corrido. */
  t = t.replace(/\b(?:\p{L}\s){3,}\p{L}\b/gu, (m) => m.replace(/\s/g, ''));
  return t;
}

/* Conectores que en español piden una pausa antes: sin ella, el partidor de
 * bloques corta donde le toca y la frase se parte a mitad de idea. Se aplica
 * SOLO aquí, en la capa que se le entrega al motor de voz. */
const CONECTORES_PAUSA = /\s+(pero|aunque|sino|porque|mientras|entonces|además|sin embargo|no obstante|es decir|por tanto|por lo tanto)\s+/gi;

/**
 * `#` de conteo → palabra, según contexto.
 *
 * Medido en la biblioteca pública (2026-09-09): `Secreto #1`…`#32`,
 * `Principle #1`, `Ad Agency Secret #18`, `LF8 #2`, `The #1 brand`. Cero
 * etiquetas sociales (`#amor`): en estos libros TODO `#` + dígito es conteo,
 * y Fish/Edge lo leen como «hashtag» porque aprendieron en inglés.
 *
 * - `#` + dígitos, con o sin espacio (`#1`, `# 12`, `LF#8`) → `número N`.
 * - `#etiqueta` (pegado a letras) → `hashtag etiqueta`: si un libro futuro
 *   habla de redes, la etiqueta se conserva en vez de perderse.
 * - `#` solo ante espacio, puntuación o fin → `número`.
 *
 * Llamar DESPUÉS de enmascarar URLs y correos: el `#` de un ancla web
 * (`page4#reference`) no es conteo. Solo capa voz: el visible no se toca.
 * La cifra se deja en dígitos a propósito: en modo neural el motor la
 * pronuncia solo (v2.25.0), y en navegador la expande la regla 6.
 */
function expandirNumeral(texto, numero = 'número') {
  /* `#` ASCII y las copias de ancho completo que a veces salen de un PDF. */
  return String(texto || '')
    .replace(/[#＃﹟]\s*(\d[\d.,]*)/g, ` ${numero} $1`)
    .replace(/[#＃﹟]([\p{L}][\p{L}\p{N}_]*)/gu, ' hashtag $1')
    .replace(/[#＃﹟]/g, ` ${numero} `);
}

/**
 * Quita las palabras que expandirNumeral AÑADE, para que la guía pueda
 * buscar el bloque de voz dentro del texto visible.
 *
 * Visible `Secreto #1` compacta a `secreto1` (`#` no es letra). La voz dice
 * `Secreto número 1` → `secretonumero1`. Esa aguja no aparece en el visible:
 * el ancla falla y la marca cae 1-2 párrafos más abajo (el cursor avanza
 * con el largo de la voz, que es mayor). Al quitar `número`/`number` antes
 * de compactar, las dos cadenas vuelven a ser `secreto1`.
 *
 * No se usa para hablar: solo para anclar. El audio sigue diciendo «número».
 */
export function textoVozParaAncla(texto) {
  return String(texto || '')
    .replace(/\bn[uú]mero\s+(?=\d)/gi, '')
    .replace(/\bnumber\s+(?=\d)/gi, '')
    .replace(/\bhashtag\s+/gi, '');
}

/**
 * Elige el compacto del bloque de voz que sí aparece en el visible.
 *
 * Si el autor escribió la palabra «número 1», el compacto crudo (`elnumero1`)
 * está en el visible y se conserva. Si la voz insertó «número» sobre un `#`,
 * el crudo no aparece y se usa el alineado (`secreto1`).
 */
export function elegirCompactoVoz(crudo, alineado, visibleCompacto) {
  const c = String(crudo || '');
  const a = String(alineado || '');
  if (!a || a === c) return c;
  const aguja = (t) => t.slice(0, Math.min(20, t.length));
  const aparece = (t) => {
    const ag = aguja(t);
    return ag.length >= 6 && String(visibleCompacto || '').includes(ag);
  };
  const hayCrudo = aparece(c);
  const hayAlin = aparece(a);
  if (hayAlin && !hayCrudo) return a;
  if (hayCrudo) return c;
  return a;
}

/**
 * ¿Esta línea suelta es un título? Versión mínima para la capa de voz: aquí
 * no hay geometría del PDF, solo el texto. Una línea corta, sola entre saltos
 * y sin signo final es, casi siempre, un título o un encabezado.
 */
function pareceTituloSuelto(linea) {
  const t = linea.trim();
  if (!t || t.length > 70) return false;
  /* Un cierre real de frase (punto, interrogación, exclamación, puntos
   * suspensivos, dos puntos, punto y coma, coma) ya da pausa en el motor.
   * Un paréntesis, comilla o corchete de cierre SOLO («(FRED)», «…libro»)
   * NO da pausa: si el título viejo viene sin punto, la voz lo lee de
   * corrido con el párrafo siguiente (Secretos de Copywriting, 2026-09-10).
   * Por eso aquí solo valen signos que pausan de verdad. */
  if (/[.!?…:;,]$/.test(t)) return false;
  const palabras = t.split(/\s+/).filter(Boolean);
  if (palabras.length > 10) return false;
  const letras = t.replace(/[^A-Za-zÁÉÍÓÚÜÑáéíóúüñ]/g, '');
  if (letras.length < 2) return false;
  /* Mayúsculas, o empieza con palabra de capítulo, o es numeración. */
  if (t === t.toUpperCase()) return true;
  if (/^(cap[íi]tulo|chapter|secreto|secret|parte|part|secci[óo]n|libro|tomo|ep[íi]logo|pr[óo]logo|introducci[óo]n|conclusi[óo]n|anexo|ap[ée]ndice|prefacio|respaldo|dedicatoria|sobre\s+el|índice|citas|preguntas|cuestionario)\b/i.test(t)) return true;
  if (/^(?:\d{1,3}|[IVXLCDM]{1,7})\s*[.\-–—:]?\s*\S*/.test(t) && palabras.length <= 6) return true;
  /* Título breve en mayúscula inicial sin palabra clave («Una decisión
   * radical», «El placebo eres tú», «Jim Edwards»): pocas palabras, sin
   * coma ni conjunción inicial. Medido en la biblioteca (2026-09-10): sin
   * esto la voz los lee de corrido con el párrafo siguiente. Incluye
   * títulos que cierran con paréntesis («Definir a tu cliente ideal (FRED)»,
   * Secretos de Copywriting): el «)» solo no pausa. Solo capa
   * voz: el visible no se toca y la invariante (mismas palabras) vale. */
  if (t.length <= 70 && palabras.length >= 2 && palabras.length <= 10
    && /^[A-ZÁÉÍÓÚÑ]/.test(t) && !/[,;]/.test(t)
    /* Solo las coordinantes que nunca abren un título en esta biblioteca
     * («Y en algún momento…» es frase, no título). «Cómo», «Qué», «Cuando»,
     * «Si» o «Porque» SÍ abren títulos reales («Cómo colaboran las historias…»,
     * Secretos de Copywriting): excluirlos dejaba esos títulos sin pausa. */
    && !/^(y|e|o|u|pero|aunque|mientras)\b/i.test(t)) return true;
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
    /* «uno», nunca «un»: aquí el número se dice, no acompaña a un sustantivo.
     * Antes «pág. 1» sonaba «página un». */
    if (u > 0) palabras += (u === 1 ? 'uno' : UNIDADES[u]);
  }

  return palabras.trim();
}

const ROMANO_VALOR = { I: 1, V: 5, X: 10, L: 50, C: 100, D: 500, M: 1000 };

/** «XIV» → 14. Devuelve 0 si la cadena no es un romano bien formado. */
export function romanoANumero(romano) {
  const t = String(romano || '').toUpperCase();
  /* Forma canónica: así «VV» o «IIII» no cuelan como números, y un renglón
   * que solo trae iniciales no se convierte en una cifra inventada. */
  if (!t || !/^M{0,3}(?:CM|CD|D?C{0,3})(?:XC|XL|L?X{0,3})(?:IX|IV|V?I{0,3})$/.test(t)) return 0;
  let total = 0;
  for (let i = 0; i < t.length; i += 1) {
    const actual = ROMANO_VALOR[t[i]];
    const siguiente = ROMANO_VALOR[t[i + 1]] || 0;
    total += actual < siguiente ? -actual : actual;
  }
  return total > 0 && total < 4000 ? total : 0;
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
 * @param {boolean} [opts.limpiarReferencias=true] – Quita las llamadas de nota
 *   («[12]», «estudio12»), las direcciones web y los símbolos de aparato
 *   crítico, que en un audiolibro solo estorban.
 * @returns {string}
 */
export function prepararParaVoz(texto, idioma = 'es', opts = {}) {
  if (!texto || typeof texto !== 'string') return '';
  /* Primero lo que el extractor deja roto (tildes desarmadas, invisibles,
   * letras espaciadas): si no, el motor deletrea o cambia de voz. */
  texto = sanearTextoParaVoz(texto);
  if (!texto) return '';
  const neural = opts.neural !== false; // por defecto true
  const pausarTitulos = opts.pausarTitulos !== false; // por defecto true
  const comasProsodicas = opts.comasProsodicas !== false; // por defecto true
  const limpiarReferencias = opts.limpiarReferencias !== false; // por defecto true
  /* Pausas estructurales (plan §4 «Voz y pausas»): 700 ms tras títulos y
   * 1000 ms entre capítulos, como silencio real en la cola de audio. Las
   * marcas §P0700§ / §P1000§ las reconoce el motor (ttsCrearCola) y nunca
   * llegan al sintetizador ni al texto visible. */
  const pausasEstructurales = neural && opts.pausasEstructurales !== false;
  let salida = texto.replace(/§P(\d{3,5})§/g, 'ZZJGPAUSA$1ZZ');
  const restaurarPausas = (valor) => valor.replace(/ZZJGPAUSA(\d{3,5})ZZ/gi, '§P$1§');
  /* Filtro defensivo contra alucinaciones y rechazos de traducción automática */
  salida = salida
    .replace(/(?:no hay texto para traducir[,.]?\s*)?por favor proporciona el bloque de texto que necesitas convertir al español siguiendo las instrucciones dadas[.]?/gi, '')
    .replace(/no hay texto para traducir[.,]?/gi, '')
    .replace(/¿qué necesitas que traduzca\?[^.!?\n]*[.!?]?/gi, '')
    .replace(/¡?dime qué necesitas que traduzca[^.!?\n]*[.!?]?/gi, '')
    .replace(/aquí tienes la traducción[^.!?\n]*[:.]?/gi, '')
    .replace(/hola a todos,?\s+bienvenidos a este video[^.!?\n]*[.!?]?/gi, '');

  // Si no es español, aplicar solo limpieza básica
  if (idioma !== 'es') {
    const enIngles = /^en/i.test(idioma || '');
    /* Las direcciones se enmascaran también aquí: si no, el `#` de un ancla
     * web caería en la regla de conteo de abajo. */
    salida = salida
      .replace(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi, enIngles ? 'email address' : 'dirección de correo')
      .replace(/\b(?:https?:\/\/|www\.)[^\s<>"']+/gi, enIngles ? 'web link' : 'enlace web');
    salida = expandirNumeral(salida, enIngles ? 'number' : 'número');
    /* Esta rama sale antes de «Cerrar las costuras»: se colapsa aquí para no
     * entregar dobles espacios al motor. */
    salida = salida.replace(/[ \t]{2,}/g, ' ').trim();
    if (!neural) salida = salida.replace(/(\d+)\s*%/g, '$1 percent');
    return restaurarPausas(salida);
  }

  /* ── 0. El aparato crítico no se lee ────────────────────────────────
   *
   * Un libro serio está lleno de marcas que existen para el ojo, no para el
   * oído: llamadas de nota, referencias bibliográficas, direcciones web. Al
   * oírlas, la lectura se interrumpe con números sueltos y, peor, el motor de
   * voz las toma por términos técnicos y CAMBIA DE VOZ a media frase (por eso
   * «suena como si hablara en otro idioma»).
   *
   * Todo esto se quita solo aquí, en la capa que se le entrega al motor. El
   * texto que se ve en pantalla y el que se exporta conservan cada marca.
   */
  if (limpiarReferencias) {
    /* Foliación y cabeceras heredadas de la fuente, aisladas en su renglón. */
    salida = salida
      .replace(/^\s*\d{1,4}\s*$/gmu, '')
      .replace(/^\s*[\p{L}'’. -]{2,50}:\s*\d{1,4}\s*$/gmu, '');
    /* Primero las direcciones: llevan puntos y barras que confundirían a las
     * reglas de abreviaturas que vienen después. */
    salida = salida
      .replace(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi, 'dirección de correo')
      .replace(/\b(?:https?:\/\/|www\.)[^\s<>"']+/gi, 'enlace web');

    /* Elipsis editorial: «[...]» y «[…]» marcan texto omitido por el editor.
     * Se dice con el silencio que ya deja la puntuación de alrededor. */
    salida = salida.replace(/[[(]\s*(?:\.{3}|…)\s*[\])]/g, '');

    /* Llamadas y referencias: lo que va entre corchetes, paréntesis o llaves y
     * NO contiene ni una letra de palabra. Cubre «[12]», «[3, 4, 5]»,
     * «[12-15]», «[ii]», «[*]» y «(12)».
     *
     * La condición es deliberadamente estricta: en cuanto hay una palabra de
     * verdad dentro —«[el rey]», «[sic]», «(véase el mapa)»— es una acotación
     * del autor o del editor y se conserva entera. Perder una acotación sería
     * perder contenido; perder un número de nota no. */
    salida = salida.replace(/[[{(]\s*(?:[\divxlcdmIVXLCDM*†‡§¶]+\s*[,;:–—-]?\s*)+\]?\s*[\]})]/g, (m) => (
      /[a-záéíóúüñA-ZÁÉÍÓÚÜÑ]{2,}/.test(m.replace(/[ivxlcdmIVXLCDM]/g, '')) ? m : ''
    ));

    /* Números de nota pegados a la palabra. Al extraer un PDF, los
     * superíndices pierden su formato y quedan cosidos al texto:
     * «la evolución3 de la especie». El motor lee «evolución tres» y además
     * ese token con dígitos es justo el que le hace cambiar a voz inglesa.
     *
     * Solo se quitan cuando la palabra es larga y va toda en minúsculas: así
     * «H2O», «GPT4», «MP3» o «1914» quedan intactos, que son nombres y cifras
     * de verdad. La lista de excepciones cubre lo poco que se escapa. */
    const PALABRAS_CON_NUMERO = /^(covid|web|mp|html|css|sha|utf|iso|rgb|base|ipv|http|x)$/i;
    salida = salida.replace(/\b([a-záéíóúüñ]{4,})(\d{1,3})(?![\w-])/g, (m, palabra) => (
      PALABRAS_CON_NUMERO.test(palabra) ? m : palabra
    ));
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

  /* 3 bis. Abreviaturas de aparato crítico.
   *
   * Son latinajos que el motor no sabe leer: «cf.» sale como «ce-efe», «et
   * al.» como una palabra inventada, «ibíd.» con el acento donde no va. Y
   * cada punto abre un corte de oración falso que parte la frase en dos.
   * Se dicen en español, que es como las leería una persona en voz alta. */
  salida = salida
    .replace(/\bop\.\s*cit\./gi, 'obra citada')
    .replace(/\bloc\.\s*cit\./gi, 'lugar citado')
    .replace(/\bib[íi]d(?:em)?\./gi, 'en la misma obra')
    .replace(/\b[íi]d\./gi, 'el mismo')
    .replace(/\bet\s*al\./gi, 'y otros')
    .replace(/\bcf\./gi, 'compárese con')
    .replace(/\bvid\./gi, 'véase')
    .replace(/\bv\.\s*gr\./gi, 'por ejemplo')
    .replace(/\bs\.\s*f\./gi, 'sin fecha')
    .replace(/\bs\.\s*l\./gi, 'sin lugar')
    .replace(/\bn\.\s*[ºo°]\s*/gi, 'número ')
    .replace(/\bn[úu]m\.\s*/gi, 'número ')
    .replace(/\bfig\.\s*/gi, 'figura ')
    .replace(/\btab\.\s*/gi, 'tabla ')
    .replace(/\bed\.\s*/gi, 'edición ')
    .replace(/\btrad\.\s*/gi, 'traducción de ')
    .replace(/\bAA\.\s*VV\./g, 'varios autores')
    .replace(/\bpassim\b/gi, 'en varios lugares');

  // Las abreviaturas con número (pág., cap.) se expanden siempre porque
  // el punto dispararía un corte de oración falso.
  salida = salida
    .replace(/\bpág\.\s*(\d+)/gi, (_, n) => `página ${numeroAPalabras(parseInt(n, 10))}`)
    .replace(/\bpágs\.\s*(\d+)\s*[-–—]\s*(\d+)/gi, (_, d, h) => `páginas ${numeroAPalabras(parseInt(d, 10))} a ${numeroAPalabras(parseInt(h, 10))}`)
    .replace(/\bpp\.\s*(\d+)\s*[-–—]\s*(\d+)/gi, (_, d, h) => `páginas ${numeroAPalabras(parseInt(d, 10))} a ${numeroAPalabras(parseInt(h, 10))}`)
    .replace(/\bp\.\s*(\d+)/gi, (_, n) => `página ${numeroAPalabras(parseInt(n, 10))}`)
    .replace(/\bcap\.\s*(\d+)/gi, (_, n) => `capítulo ${numeroAPalabras(parseInt(n, 10))}`)
    .replace(/\bart\.\s*(\d+)/gi, (_, n) => `artículo ${numeroAPalabras(parseInt(n, 10))}`)
    .replace(/\bvol\.\s*(\d+)/gi, (_, n) => `volumen ${numeroAPalabras(parseInt(n, 10))}`);

  /* 3 ter. Iniciales de nombres propios: «J. R. R. Tolkien».
   *
   * Tres puntos seguidos son, para el partidor de oraciones, tres frases: la
   * voz hace tres caídas tonales y una pausa larga antes del apellido. Al
   * juntarlas queda un solo bloque y el nombre suena de corrido. */
  salida = salida.replace(/\b((?:[A-ZÁÉÍÓÚÑ]\.\s*){2,})(?=[A-ZÁÉÍÓÚÑ][a-záéíóúüñ])/g,
    /* El espacio ANTES del apellido se conserva: juntarlo también daría
     * «J.R.R.Malthus», que el motor lee como una palabra inventada. */
    (m) => `${m.trim().replace(/\.\s+/g, '.')} `);

  /* 3 quater. Símbolos que se dicen con palabras.
   *
   * Sueltos, el motor los ignora o los nombra en inglés. Se dicen como los
   * diría una persona, cuidando la concordancia: «el § 4» tiene que sonar
   * «el parágrafo 4», nunca «el sección 4». */
  salida = salida
    .replace(/\b(el|del|al|un|este|ese|dicho)\s+§\s*/gi, '$1 parágrafo ')
    .replace(/§\s*/g, 'sección ')
    .replace(/¶\s*/g, 'párrafo ')
    .replace(/\s*&\s*/g, ' y ')
    .replace(/(\d\s*)km\s*\/\s*h\b/gi, '$1kilómetros por hora')
    .replace(/(\d\s*)m\s*\/\s*s\b/g, '$1metros por segundo')
    .replace(/\by\s*\/\s*o\b/gi, 'y o')      /* «y/o»: no es «y o o» */
    /* Dos palabras de verdad («autor/lector»), no siglas ni unidades: con una
     * sola letra a un lado, «km/h» sonaba «km o h». */
    .replace(/(\p{L}{2,})\/(\p{L}{2,})/gu, '$1 o $2')
    .replace(/[~|_]+/g, ' ')
    .replace(/[†‡]/g, '');

  /* 3 quinquies. `#` de conteo → `número` (ver `expandirNumeral`).
   *
   * Va DESPUÉS de enmascarar URLs y correos (regla 0): el `#` de un ancla
   * web ya es «enlace web» y no llega hasta aquí. */
  salida = expandirNumeral(salida, 'número');

  /* 3 sexies. Nombres propios que el origen trae en minúscula.
   *
   * Medido en la biblioteca (2026-09-10): «El placebo eres tú» trae
   * «núria Martí pérez», «Hay House, california», «Jeffrey Fannin ph. D.»
   * y «a candace». Son errores de captura del PDF adaptado, no del libro
   * (el original trae las mayúsculas). Se corrige SOLO la caja: el
   * compacto de la guía va en minúsculas sin tildes, así que el ancla no
   * se mueve y el visible/guardado/exportado no se tocan. */
  salida = salida
    .replace(/\bcalifornia\b/g, 'California')
    .replace(/\bn[úu]ria\b/gi, 'Núria')
    .replace(/\bp[eé]rez\b/gi, 'Pérez')
    .replace(/\bcandace\b/gi, 'Candace')
    .replace(/\bph\.\s*D\./g, 'Ph. D.');

  /* 3 septies. Cifras que el motor lee mal aunque «sepa» números.
   *
   * Medido en la biblioteca (libros traducidos del inglés): el separador de
   * millares inglés («10,000 dólares», «$1,500») lo lee una voz española como
   * lo que es en español, un decimal: «diez coma cero cero cero». Eso es el
   * «la voz dice coma» que se oía. Quitando la coma del grupo de millares, el
   * motor vuelve a decir «diez mil».
   *
   * A cambio, un decimal español escrito con TRES decimales exactos («3,141»)
   * se leería como millar. Es mucho más raro en prosa que un precio en miles,
   * y el error que produce es mucho menos molesto que el actual. */
  salida = salida.replace(/\b\d{1,3}(?:,\d{3})+\b/g, (m) => m.replace(/,/g, ''));

  /* Rango de cifras («1914-1918», «páginas 20 – 25»). El guion se lee «guion»
   * o «menos»; en voz alta un rango se dice «de … a …», y detrás de «entre»
   * se dice «… y …» («entre de 1914 a 1918» no es castellano). Se piden 2-4
   * dígitos a cada lado y ningún guion pegado, para no tocar fechas completas
   * («12-05-2024») ni códigos («978-84-…»). */
  salida = salida.replace(
    /(\b(?:entre|desde|del|de)\s+)?(?<![\d–—-])(\d{2,4})\s*[–—-]\s*(\d{2,4})(?![\d–—-])/gi,
    (m, prep, uno, dos) => {
      const previo = (prep || '').trim().toLowerCase();
      if (previo === 'entre') return `${prep}${uno} y ${dos}`;
      if (prep) return `${prep}${uno} a ${dos}`;
      return `de ${uno} a ${dos}`;
    },
  );

  /* Numeración romana de las divisiones del libro: «Capítulo XIV» sale como
   * «capítulo equis i uve», porque son letras y el motor las deletrea. Solo
   * se convierte detrás de la palabra que la nombra; el renglón que ES el
   * número entero se convierte más abajo, cuando ya tiene su pausa. */
  salida = salida.replace(
    /\b(cap[íi]tulos?|partes?|secci[óo]n(?:es)?|libros?|tomos?|actos?|escenas?|lecci[óo]n(?:es)?|unidades?|volumen|vol[úu]menes|cantos?)\s+([IVXLCDM]{1,8})\b/gi,
    (m, palabra, romano) => {
      const n = romanoANumero(romano);
      return n ? `${palabra} ${numeroAPalabras(n)}` : m;
    },
  );

  // ── Reglas 4-6: conversión numérica ──
  // Edge TTS (y Azure) ya pronuncian «2024» como «dos mil veinticuatro» y
  // «45 %» como «cuarenta y cinco por ciento» con prosodia natural. Expandir
  // los números a palabras INFLA el texto (×6 en fechas y rangos), causando
  // más bloques de audio, más cortes y más pausas robóticas.
  // Solo se activan para el fallback del navegador (speechSynthesis), que sí
  // pronuncia los dígitos uno por uno.
  // ── Reglas 4-6: conversión numérica ── solo en fallback navegador
  if (!neural) {
    /* Los rangos ya se dijeron con palabras («de … a …», «entre … y …») en la
     * regla 3 septies, que vale para los dos motores. Aquí solo quedan las
     * cifras sueltas, que expande la regla 6. */
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
       * siguiente. Con motor neural, la pausa es un silencio real de 700 ms
       * en la cola (marca §P0700§); con las voces del navegador, los dos
       * puntos dejan la entonación abierta, como anunciando un capítulo. */
      if (!pareceTituloSuelto(t)) return t;
      return pausasEstructurales ? `${t}\n${MARCA_PAUSA_TITULO}` : `${t}:`;
    }).filter(Boolean).join('\n\n');
  }

  /* Un renglón que es SOLO un romano es el rótulo del capítulo («XVII»). Se
   * convierte aquí, después de marcar la pausa de título: mientras sigue en
   * letras mayúsculas, pareceTituloSuelto lo reconoce y le pone su silencio;
   * si se cambiara antes, «Diecisiete» ya no parecería un título y el capítulo
   * empezaría pegado al primer párrafo. */
  salida = salida.replace(/^[ \t]*([IVXLCDM]{1,8})\.?[ \t]*$/gm, (m, romano) => {
    const n = romanoANumero(romano);
    if (!n) return m;
    const palabra = numeroAPalabras(n);
    return palabra.charAt(0).toUpperCase() + palabra.slice(1);
  });

  if (comasProsodicas) {
    /* Coma antes del conector solo si no había ya un signo delante. */
    salida = salida.replace(CONECTORES_PAUSA, (coincidencia, conector, desplazamiento, completo) => {
      const anterior = completo[desplazamiento - 1] || '';
      if (/[,;:.!?…]/.test(anterior)) return coincidencia;
      return `, ${conector} `;
    });
  }

  /* ── Cerrar las costuras ────────────────────────────────────────────
   *
   * Quitar una referencia deja un hueco: «pronto  y nadie» con dos espacios,
   * o «consolidó .» con el punto separado. Son huecos que el motor convierte
   * en una vacilación audible, así que se cosen aquí, al final, cuando ya no
   * queda ninguna regla por aplicar. */
  salida = salida
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/[ \t]+([,.;:!?…»)\]])/g, '$1')
    .replace(/([¡¿«([])[ \t]+/g, '$1')
    .replace(/,\s*,/g, ',')
    .replace(/\s+\n/g, '\n')
    .replace(/\n[ \t]+/g, '\n')
    .trim();

  /* Expandir una abreviatura que abría la frase la dejaba en minúscula
   * («Todo cambió. compárese con…»). Cambiar mayúsculas no cambia la palabra,
   * pero sí la entonación: el motor baja el tono como si siguiera la frase
   * anterior.
   *
   * Solo TRAS un punto, nunca al principio de la cadena: este texto llega
   * partido en bloques y un bloque que empieza en minúscula es la
   * continuación del anterior, no una frase nueva. */
  salida = salida.replace(/([.!?…]\s+)([a-záéíóúüñ])/g,
    (_, signo, letra) => signo + letra.toUpperCase());

  return restaurarPausas(salida);
}
