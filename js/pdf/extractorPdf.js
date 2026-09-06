/* JG Turbo · Extractor de texto de PDF
 *
 * Todo ocurre dentro del navegador: el archivo nunca se sube a ningún
 * servidor. Por eso no hay límite de tamaño y un libro de 800 páginas
 * funciona igual que un recibo de una página.
 *
 * El motor (pdf.js) se descarga solo la primera vez que abres un PDF,
 * para no hacer más lenta la app a quien no use esta pestaña.
 */
import { agruparLineas, componerTexto } from './limpiezaTexto.js';
import { extraerAtomosDeTextContent, asociarEstructura } from './atomos.js';

const RUTA_MOTOR = '/js/vendor/pdfjs/pdf.min.mjs';
const RUTA_TRABAJADOR = '/js/vendor/pdfjs/pdf.worker.min.mjs';

/* Cada cuántas páginas devolvemos el control al navegador para que repinte
 * la barra de progreso y siga respondiendo a los clics. */
const PAGINAS_POR_TANDA = 4;

let motorCargando = null;

/** Carga pdf.js una sola vez y lo deja listo. */
export async function cargarMotor() {
  if (!motorCargando) {
    motorCargando = import(RUTA_MOTOR).then((pdfjs) => {
      pdfjs.GlobalWorkerOptions.workerSrc = RUTA_TRABAJADOR;
      return pdfjs;
    }).catch((error) => {
      motorCargando = null; /* Permite reintentar si falló la descarga. */
      throw error;
    });
  }
  return motorCargando;
}

/** Error con causa reconocible para dar un mensaje humano en la interfaz. */
export class ErrorPdf extends Error {
  constructor(motivo, mensaje, original) {
    super(mensaje);
    this.name = 'ErrorPdf';
    this.motivo = motivo;
    this.original = original;
  }
}

/**
 * Abre el PDF y devuelve el documento con sus datos básicos.
 * @param {File|Blob} archivo
 * @param {(porcentaje:number)=>void} [alProgresar] avance de la lectura del archivo
 */
export async function abrirPdf(archivo, alProgresar) {
  const pdfjs = await cargarMotor().catch((error) => {
    throw new ErrorPdf('motor', 'No se pudo cargar el lector de PDF. Revisa tu conexión y vuelve a intentarlo.', error);
  });

  let datos;
  try {
    datos = new Uint8Array(await archivo.arrayBuffer());
  } catch (error) {
    throw new ErrorPdf('lectura', 'No se pudo leer el archivo. Puede que sea demasiado grande para la memoria de este dispositivo.', error);
  }

  const tarea = pdfjs.getDocument({
    data: datos,
    /* Sin esto, muchos libros pierden acentos o salen con letras raras. */
    useSystemFonts: true,
    isEvalSupported: false,
  });
  if (typeof alProgresar === 'function') {
    tarea.onProgress = ({ loaded, total }) => {
      if (total > 0) alProgresar(Math.min(100, Math.round((loaded / total) * 100)));
    };
  }

  let doc;
  try {
    doc = await tarea.promise;
  } catch (error) {
    const nombre = (error && error.name) || '';
    if (nombre === 'PasswordException') {
      throw new ErrorPdf('clave', 'Este PDF está protegido con contraseña. Ábrelo con la clave y guárdalo sin protección para poder leerlo aquí.', error);
    }
    if (nombre === 'InvalidPDFException') {
      throw new ErrorPdf('invalido', 'El archivo no es un PDF válido o está dañado.', error);
    }
    throw new ErrorPdf('apertura', 'No se pudo abrir el PDF: ' + (error?.message || 'error desconocido'), error);
  }

  let titulo = '';
  try {
    const meta = await doc.getMetadata();
    titulo = String(meta?.info?.Title || '').trim();
  } catch (_) { /* Los metadatos son un extra: si fallan, seguimos. */ }

  return { doc, totalPaginas: doc.numPages, titulo };
}

/** Lee el índice interno del PDF (si el libro lo trae) como lista plana. */
export async function leerIndice(doc) {
  let esquema;
  try {
    esquema = await doc.getOutline();
  } catch (_) {
    return [];
  }
  if (!Array.isArray(esquema) || !esquema.length) return [];

  const plano = [];
  const recorrer = (nodos, nivel) => {
    for (const nodo of nodos) {
      plano.push({ titulo: String(nodo.title || '').trim(), destino: nodo.dest, nivel });
      /* Dos niveles bastan: más profundidad convierte el índice en ruido. */
      if (nivel < 1 && Array.isArray(nodo.items) && nodo.items.length) recorrer(nodo.items, nivel + 1);
    }
  };
  recorrer(esquema, 0);

  const entradas = [];
  for (const item of plano) {
    if (!item.titulo) continue;
    try {
      const destino = typeof item.destino === 'string'
        ? await doc.getDestination(item.destino)
        : item.destino;
      if (!Array.isArray(destino) || !destino[0]) continue;
      const indice = await doc.getPageIndex(destino[0]);
      entradas.push({ titulo: item.titulo, pagina: indice + 1, nivel: item.nivel });
    } catch (_) { /* Una entrada rota no invalida el resto del índice. */ }
  }
  return entradas;
}

/**
 * Recorre las páginas y devuelve sus líneas de texto ya ordenadas.
 *
 * @param {object} doc documento devuelto por abrirPdf
 * @param {object} opciones
 * @param {number} [opciones.desde=1] primera página (incluida)
 * @param {number} [opciones.hasta] última página (incluida)
 * @param {(hechas:number, total:number)=>void} [opciones.alProgresar]
 * @param {{cancelado:boolean}} [opciones.cancelacion] pon cancelado=true para parar
 */
export async function extraerPaginas(doc, opciones = {}) {
  const total = doc.numPages;
  const desde = Math.max(1, Math.min(opciones.desde || 1, total));
  const hasta = Math.max(desde, Math.min(opciones.hasta || total, total));
  const alProgresar = typeof opciones.alProgresar === 'function' ? opciones.alProgresar : null;
  const cancelacion = opciones.cancelacion || { cancelado: false };

  const paginas = [];
  const cuantas = hasta - desde + 1;
  let hechas = 0;

  for (let numero = desde; numero <= hasta; numero += 1) {
    if (cancelacion.cancelado) break;

    let pagina = null;
    try {
      pagina = await doc.getPage(numero);
      const vista = pagina.getViewport({ scale: 1 });
      // Intentar estructura marcada: si el PDF trae StructTree, se usa como fuente primaria
      let structInfo = null;
      try {
        if (typeof pagina.getStructTree === 'function') {
          const tree = await pagina.getStructTree();
          if (tree && tree.children) structInfo = tree;
        }
      } catch (_) {}
      const textContent = await pagina.getTextContent({ includeMarkedContent: true });
      const atomos = extraerAtomosDeTextContent(textContent, { page: numero, viewport: vista });
      asociarEstructura(atomos, structInfo);
      const trocitos = atomos.map((a) => ({
        str: a.str,
        x: a.x,
        y: a.y,
        altura: a.height,
        ancho: a.width,
        hasEOL: a.hasEOL,
        dir: a.dir,
        fontName: a.fontName,
        transform: a.transform,
        fontFamily: a.fontFamily,
        fontAscent: a.fontAscent,
        fontDescent: a.fontDescent,
        vertical: a.vertical,
        source: a.source,
      }));

      paginas.push({
        numero,
        atomos,
        lineas: agruparLineas(trocitos),
        ancho: vista.width,
        alto: vista.height,
        structTree: structInfo,
      });
    } catch (error) {
      /* Una página ilegible no puede tumbar la lectura de un libro entero. */
      console.warn('[jg-pdf] página', numero, error);
      paginas.push({ numero, lineas: [], ancho: 0, alto: 0, fallo: true });
    } finally {
      try { pagina?.cleanup(); } catch (_) { /* nada que hacer */ }
    }

    hechas += 1;
    if (alProgresar) alProgresar(hechas, cuantas);
    if (hechas % PAGINAS_POR_TANDA === 0) {
      await new Promise((listo) => setTimeout(listo, 0));
    }
  }

  return { paginas, cancelado: cancelacion.cancelado };
}

/**
 * Dibuja una página en pequeño y la devuelve como imagen: es la portada que
 * se ve en la biblioteca. Un libro se reconoce por su tapa mucho antes que
 * por su nombre de archivo.
 */
export async function renderizarPortada(doc, { ancho = 380, numero = 1 } = {}) {
  let pagina = null;
  try {
    pagina = await doc.getPage(numero);
    const base = pagina.getViewport({ scale: 1 });
    const escala = Math.max(0.2, Math.min(2, ancho / (base.width || ancho)));
    const vista = pagina.getViewport({ scale: escala });
    const lienzo = document.createElement('canvas');
    lienzo.width = Math.round(vista.width);
    lienzo.height = Math.round(vista.height);
    const contexto = lienzo.getContext('2d');
    /* Fondo blanco: sin esto, un PDF con transparencia sale negro. */
    contexto.fillStyle = '#ffffff';
    contexto.fillRect(0, 0, lienzo.width, lienzo.height);
    await pagina.render({ canvasContext: contexto, viewport: vista }).promise;
    const blob = await new Promise((listo) => lienzo.toBlob(listo, 'image/jpeg', 0.82));
    lienzo.width = 0;
    lienzo.height = 0;
    return blob;
  } catch (error) {
    /* Sin portada se vive: la biblioteca pinta una tapa genérica. */
    console.warn('[jg-pdf] portada', error);
    return null;
  } finally {
    try { pagina?.cleanup(); } catch (_) { /* nada que hacer */ }
  }
}

/**
 * Todo el proceso de una vez: abrir, leer el índice, extraer y limpiar.
 * Devuelve además el diagnóstico que la interfaz necesita para avisar
 * cuando el PDF es escaneado (páginas que son fotos, sin texto dentro).
 */
export async function procesarPdf(archivo, opciones = {}) {
  const { doc, totalPaginas, titulo } = await abrirPdf(archivo, opciones.alCargar);
  try {
    const indice = opciones.usarIndice === false ? [] : await leerIndice(doc);
    const { paginas, cancelado } = await extraerPaginas(doc, opciones);
    if (cancelado) return { cancelado: true };

    const resultado = componerTexto(paginas, { indice, origen: 'texto' });
    /* La portada se saca ahora, con el documento todavía abierto. */
    const portada = opciones.conPortada === false ? null : await renderizarPortada(doc);
    const caracteres = resultado.texto.length;
    const leidas = paginas.length || 1;
    const escaneado = resultado.paginasConTexto === 0 || caracteres / leidas < 40;

    return {
      cancelado: false,
      titulo,
      totalPaginas,
      paginasLeidas: paginas.length,
      escaneado,
      portada,
      ...resultado,
    };
  } finally {
    try { await doc.destroy(); } catch (_) { /* liberar memoria, sin drama */ }
  }
}
