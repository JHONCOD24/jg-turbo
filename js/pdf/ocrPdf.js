/* JG Turbo · OCR para PDF escaneados
 *
 * Un PDF escaneado no tiene texto: son fotos de las páginas. Aquí se
 * reconocen esas letras con Tesseract, dentro del navegador y sin subir
 * nada a ningún servidor.
 *
 * Esto es LENTO a propósito de la vida, no del código: reconocer letras en
 * una imagen cuesta segundos por página. Por eso nunca se lanza solo: solo
 * cuando la persona lo pide, sobre el rango que elija, con avance visible,
 * tiempo estimado y botón de cancelar.
 *
 * El motor se descarga la primera vez que se usa y queda en la caché del
 * navegador: unos 6 MB (la variante que soporte el equipo, ~3,9 MB, más el
 * idioma elegido). Quien no use OCR no descarga nada de esto.
 */
import { cargarMotor } from './extractorPdf.js';

const RUTA_TESSERACT = '/js/vendor/tesseract/tesseract.esm.min.js';
const RUTA_WORKER = '/js/vendor/tesseract/worker.min.js';
const RUTA_NUCLEO = '/js/vendor/tesseract';
const RUTA_IDIOMAS = '/js/vendor/tesseract/lang';

/* Ancho al que se dibuja cada página antes de reconocerla. Más grande no
 * mejora el resultado y sí multiplica el tiempo y la memoria del teléfono. */
const ANCHO_RENDER = 1600;

/** Idiomas incluidos en el proyecto (los datos pesan, no se añaden gratis). */
export const IDIOMAS_OCR = [
  { codigo: 'spa', nombre: 'Español' },
  { codigo: 'eng', nombre: 'Inglés' },
  { codigo: 'spa+eng', nombre: 'Español e inglés' },
];

let tesseractCargando = null;

async function cargarTesseract() {
  if (!tesseractCargando) {
    tesseractCargando = import(RUTA_TESSERACT).catch((error) => {
      tesseractCargando = null;
      throw error;
    });
  }
  return tesseractCargando;
}

/** Dibuja una página del PDF en un lienzo, lista para reconocer. */
async function pintarPagina(doc, numero) {
  const pagina = await doc.getPage(numero);
  try {
    const base = pagina.getViewport({ scale: 1 });
    const escala = Math.min(3, Math.max(1.5, ANCHO_RENDER / (base.width || ANCHO_RENDER)));
    const vista = pagina.getViewport({ scale: escala });
    const lienzo = document.createElement('canvas');
    lienzo.width = Math.round(vista.width);
    lienzo.height = Math.round(vista.height);
    const contexto = lienzo.getContext('2d', { willReadFrequently: true });
    /* Fondo blanco: un PDF con transparencia saldría negro y el OCR fallaría. */
    contexto.fillStyle = '#ffffff';
    contexto.fillRect(0, 0, lienzo.width, lienzo.height);
    await pagina.render({ canvasContext: contexto, viewport: vista }).promise;
    return lienzo;
  } finally {
    try { pagina.cleanup(); } catch (_) { /* nada que hacer */ }
  }
}

/** Convierte lo que devuelve Tesseract en las mismas líneas que usa el lector. */
function lineasDelResultado(datos, altoImagen) {
  const lineas = [];
  const bloques = datos && Array.isArray(datos.blocks) ? datos.blocks : [];

  for (const bloque of bloques) {
    for (const parrafo of bloque.paragraphs || []) {
      for (const linea of parrafo.lines || []) {
        const textoFuente = String(linea.text || '');
        const texto = textoFuente.replace(/\s+/g, ' ').trim();
        if (!texto) continue;
        const caja = linea.bbox || {};
        const alto = Math.max(1, (caja.y1 || 0) - (caja.y0 || 0));
        const items = (linea.words || []).map((palabra) => {
          const pc = palabra.bbox || {};
          return {
            str: String(palabra.text || ''),
            x: pc.x0 || 0,
            y: altoImagen - (pc.y0 || 0),
            altura: Math.max(1, (pc.y1 || 0) - (pc.y0 || 0)),
            ancho: Math.max(1, (pc.x1 || 0) - (pc.x0 || 0)),
            confidence: Number.isFinite(Number(palabra.confidence)) ? Number(palabra.confidence) : null,
            source: 'ocr',
          };
        }).filter((palabra) => palabra.str);
        lineas.push({
          texto,
          textoFuente,
          x: caja.x0 || 0,
          /* En una imagen la Y crece hacia abajo; el lector espera lo contrario. */
          y: altoImagen - (caja.y0 || 0),
          altura: alto,
          ancho: Math.max(1, (caja.x1 || 0) - (caja.x0 || 0)),
          confianza: Number.isFinite(Number(linea.confidence)) ? Number(linea.confidence) : null,
          source: 'ocr',
          items,
        });
      }
    }
  }

  /* Respaldo: si esta versión no entrega bloques, se usa el texto plano y se
   * reparten posiciones parejas. La limpieza sigue funcionando. */
  if (!lineas.length && datos && datos.text) {
    const sueltas = String(datos.text).split('\n').filter((t) => t.trim());
    const paso = altoImagen / Math.max(1, sueltas.length + 1);
    sueltas.forEach((textoFuente, i) => {
      const texto = textoFuente.trim();
      lineas.push({
        texto,
        textoFuente,
        x: 70,
        y: altoImagen - paso * (i + 1),
        altura: paso * 0.6,
        ancho: texto.length * 8,
        confianza: Number.isFinite(Number(datos.confidence)) ? Number(datos.confidence) : null,
        source: 'ocr',
      });
    });
  }

  return lineas;
}

/**
 * Reconoce el texto de un rango de páginas de un PDF escaneado.
 *
 * @param {File|Blob} archivo el PDF
 * @param {object} opciones
 * @param {number} opciones.desde primera página
 * @param {number} opciones.hasta última página
 * @param {string} [opciones.idioma='spa'] «spa», «eng» o «spa+eng»
 * @param {(info:object)=>void} [opciones.alProgresar] avance página a página
 * @param {{cancelado:boolean}} [opciones.cancelacion]
 * @returns {Promise<{paginas:object[], cancelado:boolean}>} páginas con sus líneas
 */
export async function reconocerPaginas(archivo, opciones = {}) {
  const cancelacion = opciones.cancelacion || { cancelado: false };
  const avisar = typeof opciones.alProgresar === 'function' ? opciones.alProgresar : () => {};

  avisar({ etapa: 'motor', mensaje: 'Descargando el motor de reconocimiento…' });
  const [pdfjs, Tesseract] = await Promise.all([cargarMotor(), cargarTesseract()]);
  if (cancelacion.cancelado) return { paginas: [], cancelado: true };

  const datos = new Uint8Array(await archivo.arrayBuffer());
  const doc = await pdfjs.getDocument({ data: datos, isEvalSupported: false }).promise;

  const total = doc.numPages;
  const desde = Math.max(1, Math.min(opciones.desde || 1, total));
  const hasta = Math.max(desde, Math.min(opciones.hasta || total, total));
  const cuantas = hasta - desde + 1;

  let trabajador = null;
  const paginas = [];
  const arranque = Date.now();

  try {
    avisar({ etapa: 'motor', mensaje: 'Preparando el reconocimiento…' });
    /* Según cómo se empaquete, la función viene suelta o dentro de «default». */
    const crearTrabajador = Tesseract.createWorker || Tesseract.default?.createWorker;
    if (typeof crearTrabajador !== 'function') {
      throw new Error('El motor de reconocimiento no se cargó bien. Recarga la página e inténtalo de nuevo.');
    }
    trabajador = await crearTrabajador(opciones.idioma || 'spa', 1, {
      workerPath: RUTA_WORKER,
      corePath: RUTA_NUCLEO,
      langPath: RUTA_IDIOMAS,
      /* Los datos de idioma van sin comprimir dentro del proyecto. */
      gzip: false,
    });

    for (let numero = desde; numero <= hasta; numero += 1) {
      if (cancelacion.cancelado) break;
      const hechas = numero - desde;

      /* Con una página ya medida se puede estimar cuánto falta de verdad. */
      const transcurrido = Date.now() - arranque;
      const restantes = hechas > 0
        ? Math.round((transcurrido / hechas) * (cuantas - hechas) / 1000)
        : null;
      avisar({ etapa: 'ocr', pagina: numero, hechas, total: cuantas, segundosRestantes: restantes });

      let lienzo = null;
      try {
        lienzo = await pintarPagina(doc, numero);
        const { data } = await trabajador.recognize(lienzo, {}, { blocks: true, text: true });
        paginas.push({
          numero,
          lineas: lineasDelResultado(data, lienzo.height),
          ancho: lienzo.width,
          alto: lienzo.height,
          confianza: typeof data.confidence === 'number' ? data.confidence : null,
          source: 'ocr',
        });
      } catch (error) {
        console.warn('[jg-ocr] página', numero, error);
        paginas.push({ numero, lineas: [], ancho: 0, alto: 0, fallo: true });
      } finally {
        /* Liberar el lienzo: 300 páginas en memoria tumban un teléfono. */
        if (lienzo) { lienzo.width = 0; lienzo.height = 0; }
      }
    }

    avisar({ etapa: 'fin', hechas: paginas.length, total: cuantas });
    return { paginas, cancelado: cancelacion.cancelado };
  } finally {
    try { await trabajador?.terminate(); } catch (_) { /* liberar el worker */ }
    try { await doc.destroy(); } catch (_) { /* liberar memoria */ }
  }
}

/** Estimación honesta de cuánto puede tardar, para avisar ANTES de empezar. */
export function estimarMinutos(paginas) {
  const enMovil = /Android|iPhone|iPad/i.test(navigator.userAgent || '');
  const segundosPorPagina = enMovil ? 9 : 4;
  return Math.max(1, Math.round((paginas * segundosPorPagina) / 60));
}
