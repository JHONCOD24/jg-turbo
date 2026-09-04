/* JG Turbo · La carátula de un libro que no trae carátula
 *
 * Un PDF de solo texto no tiene tapa. En la estantería queda un rectángulo con
 * una letra, y todos los libros se parecen. Este archivo resuelve eso en dos
 * pasos, del mejor al peor:
 *
 *   1. Buscar la portada REAL del libro. El servidor la busca por título y
 *      autor (desde el navegador no se puede: el catálogo no permite
 *      consultas de otras webs).
 *   2. Si no aparece, DIBUJAR una: título, autor y un color propio de ese
 *      libro. Se hace en el aparato, al instante y sin conexión.
 *
 * Antes de las dos hay un paso previo que es el que decide si la primera
 * funciona: limpiar el nombre del archivo. Los PDF reales se llaman
 * «Pre-suasión_ Un método… ( PDFDrive ).pdf», y con eso no se encuentra nada.
 *
 * Las funciones de decisión son puras y están probadas; dibujar necesita
 * navegador y va al final.
 */

/* Restos que dejan las webs de descarga y los gestores de archivos. */
const BASURA = [
  /\(\s*pdfdrive(\.com)?\s*\)/gi,
  /\[\s*pdfdrive(\.com)?\s*\]/gi,
  /\bpdfdrive(\.com)?\b/gi,
  /\(\s*z-?lib(rary)?(\.org)?\s*\)/gi,
  /\bz-?lib(rary)?(\.org)?\b/gi,
  /\(\s*libgen\s*\)/gi,
  /\(\s*ebook\s*\)/gi,
  /\(\s*spanish\s+edition\s*\)/gi,
  /\(\s*edici[óo]n\s+en\s+espa[ñn]ol\s*\)/gi,
  /\b(copia|copy)\s*\d*\b/gi,
  /\(\s*\d{1,3}\s*\)\s*$/g,      /* el «(1)» de los duplicados, solo al final */
  /\b(final|definitivo|v\d+)\b\s*$/gi,
];

const EXTENSIONES = /\.(pdf|epub|mobi|djvu|txt|doc|docx)$/i;
const LARGO_MAXIMO = 200;

const sinTildes = (t) => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '');

/**
 * Convierte el nombre de un archivo en título y, si se deja ver, autor.
 *
 * @param {string} nombre
 * @returns {{titulo:string, autor:string}}
 */
export function limpiarNombreLibro(nombre) {
  let t = String(nombre || '').trim();
  if (!t) return { titulo: '', autor: '' };

  /* Si el nombre ORIGINAL no tiene espacios pero sí guiones, es una dirección
   * web convertida en archivo y los guiones son sus espacios. Se decide antes
   * de limpiar nada: quitar «pdfdrive» deja un hueco, y mirando el texto ya
   * limpio parecería que el nombre tenía espacios propios. */
  const guionesSonEspacios = !/\s/.test(t.replace(EXTENSIONES, '')) && t.includes('-');

  t = t.replace(EXTENSIONES, ' ');
  for (const patron of BASURA) t = t.replace(patron, ' ');

  /* Guiones bajos y puntos entre palabras son separadores disfrazados. */
  t = t.replace(/_/g, ' ').replace(/(?<=\p{L})\.(?=\p{L}{2,})/gu, ' ');
  t = t.trim();

  /* Si los guiones eran los espacios (decidido arriba sobre el nombre
   * original), se convierten. Cuando el nombre sí traía espacios propios no se
   * tocan, porque ahí el guion puede separar el título del autor. */
  if (guionesSonEspacios) t = t.replace(/-/g, ' ');

  /* Muchas descargas llaman al archivo «...-pdf», sin punto. Al convertir los
   * guiones queda un «pdf» suelto al final que se leería en la portada. Se
   * repasa dos veces porque puede haber quedado detrás de la marca de la web
   * («sex-code-pdfdrive-pdf»). Solo al final y como palabra entera: «Guía del
   * formato PDF para diseñadores» es un título legítimo y no se toca. */
  for (let i = 0; i < 2; i += 1) {
    t = t.replace(/[\s-]+(pdf|epub|mobi|djvu|ebook)\s*$/i, '').trim();
  }

  t = t.replace(/[\s ]+/g, ' ').trim();
  /* Signos sueltos en los extremos, pero conservando lo que sea una palabra. */
  t = t.replace(/^[\s\-–—_·:,.|(){}[\]]+|[\s\-–—_·:,.|(){}[\]]+$/g, '').trim();

  if (!/\p{L}|\p{N}/u.test(t)) return { titulo: '', autor: '' };
  if (t.length > LARGO_MAXIMO) t = t.slice(0, LARGO_MAXIMO).trim();

  /* ¿El nombre separa título y autor? Solo se acepta con un guion rodeado de
   * espacios («Sapiens - Yuval Noah Harari»): sin espacios puede ser parte del
   * propio título («Pre-suasión»). */
  let titulo = t;
  let autor = '';
  const corte = t.match(/^(.{3,})\s+[-–—]\s+(.{3,})$/);
  if (corte) {
    const izquierda = corte[1].trim();
    const derecha = corte[2].trim();
    /* El lado del autor son pocas palabras y ninguna cifra: así «Historia -
     * segunda parte» no se confunde con un nombre propio. */
    const palabras = derecha.split(/\s+/).filter(Boolean);
    if (palabras.length <= 5 && !/\d/.test(derecha)) {
      titulo = izquierda;
      autor = derecha;
    }
  }

  /* Un título todo en mayúsculas grita en la estantería. */
  if (titulo && titulo === titulo.toUpperCase() && /\p{L}/u.test(titulo)) {
    titulo = titulo.toLowerCase();
  }
  titulo = titulo.charAt(0).toUpperCase() + titulo.slice(1);

  return { titulo, autor };
}

/** Palabras que no ayudan a comparar dos títulos. */
const VACIAS = new Set([
  'el', 'la', 'los', 'las', 'un', 'una', 'unos', 'unas', 'de', 'del', 'y', 'o', 'a',
  'en', 'con', 'por', 'para', 'que', 'su', 'sus', 'al', 'lo',
  'the', 'a', 'an', 'of', 'and', 'or', 'to', 'in', 'on', 'for', 'how', 'is',
]);

function palabrasUtiles(texto) {
  return sinTildes(String(texto || ''))
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((p) => p.length > 1 && !VACIAS.has(p));
}

/** Cuánto se parecen dos textos: proporción de palabras del buscado que aparecen. */
function parecido(buscado, candidato) {
  const a = palabrasUtiles(buscado);
  const b = new Set(palabrasUtiles(candidato));
  if (!a.length || !b.size) return 0;
  let coinciden = 0;
  for (const palabra of a) if (b.has(palabra)) coinciden += 1;
  return coinciden / a.length;
}

/* Por debajo de esto no nos fiamos: poner la portada de otro libro es peor que
 * no poner ninguna, porque el usuario cree que ese es su libro. */
const PARECIDO_MINIMO = 0.6;

/**
 * De los resultados de la búsqueda, cuál es de verdad este libro.
 *
 * @param {{titulo:string, autor?:string, portada:string}[]} resultados
 * @param {{titulo:string, autor?:string}} libro
 * @returns {{titulo:string, autor?:string, portada:string}|null}
 */
export function elegirMejorPortada(resultados, libro) {
  if (!Array.isArray(resultados) || !resultados.length || !libro) return null;
  const buscado = String(libro.titulo || '');
  if (!buscado.trim()) return null;

  let mejor = null;
  let mejorNota = 0;
  for (const candidato of resultados) {
    if (!candidato || !candidato.portada) continue;   /* sin imagen no sirve */
    let nota = parecido(buscado, candidato.titulo);
    /* Acertar también el autor confirma que es el libro y desempata entre
     * varias ediciones con el mismo título. */
    if (libro.autor && candidato.autor && parecido(libro.autor, candidato.autor) >= 0.5) {
      nota += 0.25;
    }
    if (nota > mejorNota) { mejorNota = nota; mejor = candidato; }
  }
  return mejorNota >= PARECIDO_MINIMO ? mejor : null;
}

/**
 * Color propio y estable de un libro.
 *
 * Sale del título, así que el mismo libro tiene siempre el mismo color y se
 * reconoce de un vistazo. La luz y la saturación se fijan para que el texto
 * blanco encima siempre se lea.
 *
 * @param {string} titulo
 * @returns {{tono:number, fondo:string, fondo2:string}}
 */
export function colorDeTitulo(titulo) {
  const s = String(titulo || '');
  let h = 0;
  for (let i = 0; i < s.length; i += 1) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  const tono = Math.abs(h) % 360;
  return {
    tono,
    fondo: `hsl(${tono} 42% 26%)`,
    /* El segundo tono hace un degradado suave; +38° mantiene la armonía. */
    fondo2: `hsl(${(tono + 38) % 360} 46% 16%)`,
  };
}

/**
 * Iniciales grandes para la portada dibujada, cuando el título no cabe.
 * @param {string} titulo
 * @returns {string}
 */
export function iniciales(titulo) {
  const palabras = palabrasUtiles(titulo);
  const fuente = palabras.length ? palabras : String(titulo || '').trim().split(/\s+/).filter(Boolean);
  if (!fuente.length) return '?';
  return fuente.slice(0, 2).map((p) => p.charAt(0).toUpperCase()).join('');
}

/* ── Dibujar la portada (necesita navegador) ───────────────────────────── */

/** Parte un texto en las líneas que caben en `ancho`, con un máximo. */
function repartirEnLineas(ctx, texto, ancho, maxLineas) {
  const palabras = String(texto || '').split(/\s+/).filter(Boolean);
  const lineas = [];
  let actual = '';
  for (const palabra of palabras) {
    const prueba = actual ? `${actual} ${palabra}` : palabra;
    if (ctx.measureText(prueba).width <= ancho || !actual) {
      actual = prueba;
    } else {
      lineas.push(actual);
      actual = palabra;
      if (lineas.length === maxLineas) break;
    }
  }
  if (lineas.length < maxLineas && actual) lineas.push(actual);
  /* Si sobró texto, la última línea lo dice con puntos suspensivos. */
  if (lineas.length === maxLineas) {
    const unidas = lineas.join(' ');
    const total = palabras.join(' ');
    if (unidas.length < total.length) {
      let ultima = lineas[maxLineas - 1];
      while (ultima && ctx.measureText(`${ultima}…`).width > ancho) {
        ultima = ultima.slice(0, -1);
      }
      lineas[maxLineas - 1] = `${ultima}…`;
    }
  }
  return lineas;
}

/**
 * Dibuja una portada con el título, el autor y el color del libro.
 *
 * Es el respaldo garantizado: no necesita internet, no cuesta nada y el texto
 * sale perfecto (una imagen generada por IA escribe los títulos con erratas).
 * Mismo tamaño que las portadas extraídas del PDF, para que la estantería
 * quede pareja.
 *
 * @param {{titulo:string, autor?:string, ancho?:number}} datos
 * @returns {Promise<Blob|null>}
 */
export async function dibujarPortada({ titulo, autor = '', ancho = 380 } = {}) {
  if (typeof document === 'undefined') return null;
  const texto = String(titulo || '').trim() || 'Documento';
  const alto = Math.round(ancho * 1.4);          /* proporción de libro */
  const lienzo = document.createElement('canvas');
  lienzo.width = ancho;
  lienzo.height = alto;
  const ctx = lienzo.getContext('2d');
  if (!ctx) return null;

  const color = colorDeTitulo(texto);

  /* Fondo con un degradado suave: plano se ve barato. */
  const degradado = ctx.createLinearGradient(0, 0, ancho, alto);
  degradado.addColorStop(0, color.fondo);
  degradado.addColorStop(1, color.fondo2);
  ctx.fillStyle = degradado;
  ctx.fillRect(0, 0, ancho, alto);

  /* Filete vertical junto al lomo: detalle que dice «esto es un libro». */
  ctx.fillStyle = 'rgba(255,255,255,.16)';
  ctx.fillRect(Math.round(ancho * 0.075), 0, 2, alto);

  const margen = Math.round(ancho * 0.13);
  const util = ancho - margen * 2;

  /* Título. El cuerpo se reduce hasta que quepa en cuatro líneas. */
  ctx.textBaseline = 'top';
  ctx.fillStyle = 'rgba(255,255,255,.97)';
  let cuerpo = Math.round(ancho * 0.108);
  let lineas = [];
  const MAX_LINEAS = 4;
  for (; cuerpo >= Math.round(ancho * 0.055); cuerpo -= 2) {
    ctx.font = `700 ${cuerpo}px "Bricolage Grotesque", Georgia, serif`;
    lineas = repartirEnLineas(ctx, texto, util, MAX_LINEAS);
    if (lineas.join(' ').length >= texto.length || lineas.length < MAX_LINEAS) break;
  }
  ctx.font = `700 ${cuerpo}px "Bricolage Grotesque", Georgia, serif`;

  const interlineado = Math.round(cuerpo * 1.22);
  let y = Math.round(alto * 0.30);
  for (const linea of lineas) {
    ctx.fillText(linea, margen, y);
    y += interlineado;
  }

  /* Autor, más discreto y separado por una raya corta. */
  if (autor && String(autor).trim()) {
    const yRaya = y + Math.round(cuerpo * 0.55);
    ctx.fillStyle = 'rgba(255,255,255,.34)';
    ctx.fillRect(margen, yRaya, Math.round(util * 0.28), 2);

    ctx.fillStyle = 'rgba(255,255,255,.78)';
    const cuerpoAutor = Math.max(11, Math.round(ancho * 0.052));
    ctx.font = `500 ${cuerpoAutor}px system-ui, -apple-system, "Segoe UI", sans-serif`;
    const lineasAutor = repartirEnLineas(ctx, String(autor).trim(), util, 2);
    let ya = yRaya + Math.round(cuerpoAutor * 0.9);
    for (const linea of lineasAutor) {
      ctx.fillText(linea, margen, ya);
      ya += Math.round(cuerpoAutor * 1.25);
    }
  }

  /* Iniciales muy tenues abajo: dan carácter sin robar atención. */
  ctx.fillStyle = 'rgba(255,255,255,.09)';
  ctx.font = `700 ${Math.round(ancho * 0.30)}px "Bricolage Grotesque", Georgia, serif`;
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(iniciales(texto), margen - Math.round(ancho * 0.02), alto - Math.round(alto * 0.05));

  const blob = await new Promise((listo) => {
    lienzo.toBlob((b) => listo(b), 'image/jpeg', 0.86);
  });
  lienzo.width = 0;
  lienzo.height = 0;
  return blob;
}

/**
 * Pide al servidor la portada real del libro.
 *
 * La búsqueda va por el servidor porque el catálogo no acepta consultas
 * directas desde una página web. Si no hay red, no hay resultado o el que hay
 * no se parece lo suficiente, devuelve null y manda la portada dibujada.
 *
 * @param {{titulo:string, autor?:string}} libro
 * @returns {Promise<Blob|null>}
 */
export async function buscarPortadaReal({ titulo, autor = '' } = {}) {
  const consulta = String(titulo || '').trim();
  if (!consulta) return null;
  try {
    const parametros = new URLSearchParams({ titulo: consulta });
    if (autor) parametros.set('autor', autor);
    const respuesta = await fetch(`/api/portada?${parametros}`);
    if (!respuesta.ok) return null;
    const datos = await respuesta.json();
    const elegido = elegirMejorPortada(datos?.resultados || [], { titulo: consulta, autor });
    if (!elegido) return null;

    /* La imagen se descarga desde el navegador: el catálogo de portadas sí lo
     * permite, y así el servidor no mueve archivos. */
    const imagen = await fetch(elegido.portada);
    if (!imagen.ok) return null;
    const blob = await imagen.blob();
    if (!blob || !blob.type.startsWith('image/') || blob.size < 1200) return null;
    return blob;
  } catch (_) {
    return null;   /* sin portada real se vive: queda la dibujada */
  }
}

/**
 * La carátula de este libro, por el mejor camino disponible.
 * @param {{titulo:string, autor?:string, buscarReal?:boolean}} libro
 * @returns {Promise<{blob:Blob|null, origen:'real'|'dibujada'|'ninguna'}>}
 */
export async function conseguirCaratula({ titulo, autor = '', buscarReal = true } = {}) {
  if (buscarReal) {
    const real = await buscarPortadaReal({ titulo, autor });
    if (real) return { blob: real, origen: 'real' };
  }
  const dibujada = await dibujarPortada({ titulo, autor });
  return { blob: dibujada, origen: dibujada ? 'dibujada' : 'ninguna' };
}
