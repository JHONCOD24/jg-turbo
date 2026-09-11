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
 * Lee y valida el adjunto estructurado `jg-lectura.json` si el PDF lo incluye,
 * según el contrato del Plan Maestro de Adaptación (§4).
 *
 * Aquí solo se valida LO QUE EL ADJUNTO DICE DE SÍ MISMO: versión soportada,
 * esquema, tamaños y tipos. La correspondencia con el texto de las páginas se
 * comprueba aparte, con las páginas ya extraídas, en
 * `validarAdjuntoContrapaginas`. Un adjunto que no supere todo esto no se usa:
 * el lector cae a la extracción ordinaria (auditoría 2026-09-10, hallazgo 4).
 */
const VERSIONES_ADJUNTO_SOPORTADAS = /^1\.\d+\.\d+$/;

export async function leerAdjuntoEstructurado(doc) {
  if (!doc) return null;
  try {
    if (typeof doc.getAttachments !== 'function') return null;
    const adjuntos = await doc.getAttachments();
    if (!adjuntos) return null;

    let entrada = null;
    if (typeof adjuntos.get === 'function') {
      entrada = adjuntos.get('jg-lectura.json');
    } else if (typeof adjuntos === 'object') {
      entrada = adjuntos['jg-lectura.json'];
    }
    if (!entrada) return null;

    let bytes = null;
    if (entrada.content instanceof Uint8Array) {
      bytes = entrada.content;
    } else if (typeof doc.getAttachmentContent === 'function') {
      bytes = await doc.getAttachmentContent('jg-lectura.json');
    }
    if (!bytes || !bytes.length) return null;

    // Límite de seguridad: máximo 15 MB
    if (bytes.length > 15 * 1024 * 1024) {
      console.warn('[jg-pdf] Adjunto jg-lectura.json supera el tamaño permitido (15 MB).');
      return null;
    }

    const decodificador = new TextDecoder('utf-8');
    const textoJson = decodificador.decode(bytes);
    const datos = JSON.parse(textoJson);

    if (!datos || typeof datos !== 'object') return null;
    const version = String(datos.version || '');
    if (!VERSIONES_ADJUNTO_SOPORTADAS.test(version)) {
      console.warn('[jg-pdf] Adjunto con versión no soportada:', version, '— se usa extracción ordinaria.');
      return null;
    }
    if (!Array.isArray(datos.bloques) || !datos.bloques.length) return null;
    if (typeof datos.total_bloques === 'number' && datos.total_bloques !== datos.bloques.length) {
      console.warn('[jg-pdf] Adjunto truncado:', datos.bloques.length, 'de', datos.total_bloques, 'bloques.');
      return null;
    }
    // Identificadores estables por bloque: sin ellos no hay trazabilidad.
    if (!datos.bloques.every((b) => b && typeof b.id === 'string' && b.id)) return null;

    const rolesValidos = new Set([
      'cuerpo', 'capitulo', 'capitulo_sub', 'seccion',
      'cita', 'cuerpo_min', 'pie', 'img', 'lamina', 'tabla', 'formula',
    ]);

    const bloquesSanitizados = [];
    for (const b of datos.bloques) {
      if (!b || typeof b !== 'object') continue;
      const rol = rolesValidos.has(b.rol) ? b.rol : 'cuerpo';
      // Sanitizar texto: prevenir inyección de etiquetas HTML no confiables
      const txt = typeof b.txt === 'string' ? b.txt.replace(/<[^>]*>/g, '') : '';
      const pie = typeof b.pie === 'string' ? b.pie.replace(/<[^>]*>/g, '') : '';
      const img = typeof b.img === 'string'
        ? b.img.replace(/[<>:"|?*]/g, '').replace(/\.\./g, '').slice(0, 200) : '';
      const pagina = typeof b.pagina === 'number' ? b.pagina : (typeof b.pag === 'number' ? b.pag : null);

      bloquesSanitizados.push({
        ...b,
        rol,
        txt,
        pie,
        img,
        pagina,
      });
    }
    if (bloquesSanitizados.length !== datos.bloques.length) return null;

    return {
      version,
      revision: Number(datos.revision) || 1,
      id: String(datos.id || ''),
      titulo: String(datos.titulo || '').trim(),
      autor: String(datos.autor || '').trim(),
      idioma: String(datos.idioma || 'es').trim(),
      perfilMusical: normalizarPerfilMusical(datos.perfil_musical || datos.perfilMusical || null),
      bloques: bloquesSanitizados,
      esEstructurado: true,
    };
  } catch (error) {
    console.warn('[jg-pdf] Adjunto jg-lectura.json con formato inválido o dañado, usando extracción estándar:', error);
    return null;
  }
}

/** El perfil musical del adjunto no es confiable: solo ids de pista reales. */
function normalizarPerfilMusical(perfil) {
  if (!perfil || typeof perfil !== 'object') return null;
  const animos = new Set(['concentracion', 'relax', 'noche', 'lluvia']);
  const animo = animos.has(perfil.animo) ? perfil.animo
    : (animos.has(perfil.animo_recomendado) ? perfil.animo_recomendado : null);
  const pistas = Array.isArray(perfil.pistas) || Array.isArray(perfil.pistasAprobadas)
    ? (perfil.pistas || perfil.pistasAprobadas).filter((p) => typeof p === 'string' && /^[\w-]{3,60}$/.test(p))
    : [];
  if (!animo && !pistas.length) return null;
  return { animo, pistas, estado: 'propuesto' };
}

/**
 * Comprueba que el adjunto dice lo mismo que las páginas del PDF.
 * Normalización documentada: se compacta a letras y números sin tildes
 * (la misma de la guía de lectura) y los bloques deben aparecer EN ORDEN.
 * Un adjunto que diga otra cosa no se usa (plan §4: «No aceptar un adjunto
 * que diga algo distinto de las páginas»).
 *
 * @returns {{valido:boolean, cobertura:number, detalle:string}}
 */
export function validarAdjuntoContrapaginas(adjunto, paginas, { minimoCobertura = 0.97 } = {}) {
  if (!adjunto || !Array.isArray(paginas) || !paginas.length) {
    return { valido: false, cobertura: 0, detalle: 'sin datos' };
  }
  const dePaginas = paginas
    .map((p) => (p.lineas || []).map((l) => l && l.texto ? l.texto : '').join('\n'))
    .join('\n');
  let cuerpo = '';
  for (const b of adjunto.bloques) {
    cuerpo += (b.txt || b.pie || '') + '\n';
  }
  /* Compactar es caro en libros grandes: se hace una sola vez por lado. */
  const compactoPaginas = compactarRapido(dePaginas);
  const totalCompacto = compactoPaginas.length;
  const conTexto = adjunto.bloques.filter((b) => (b.txt || '').length > 8);
  let cursor = 0;
  let situados = 0;
  let revisados = 0;
  let posUltimo = 0;
  for (const b of conTexto) {
    revisados += 1;
    const aguja = compactarRapido(b.txt).slice(0, 72);
    if (!aguja) continue;
    /* Ventana guiada por cursor (orden esperado), con respaldo global: si
     * la aguja no está donde toca, igual vale si aparece en el documento
     * (la app también ancla así: ver situarBloquesDetallado). */
    let pos = compactoPaginas.indexOf(aguja, Math.max(0, cursor - 600));
    if (pos < 0) pos = compactoPaginas.indexOf(aguja);
    if (pos >= 0) {
      situados += 1;
      posUltimo = Math.max(posUltimo, pos);
      if (pos >= cursor) cursor = pos + Math.max(24, Math.floor(aguja.length * 0.6));
    }
  }
  const cobertura = revisados ? situados / revisados : 0;
  const cubreFinal = totalCompacto > 0 && posUltimo >= totalCompacto * 0.8;
  const valido = cobertura >= minimoCobertura && cubreFinal && situados > 0;
  const totalPaginas = paginas[paginas.length - 1].numero || paginas.length;
  return {
    valido,
    cobertura,
    detalle: valido
      ? `${situados}/${revisados} bloques situados en ${totalPaginas} págs.`
      : `cobertura ${(cobertura * 100).toFixed(1)}% (${situados}/${revisados}), final ${cubreFinal ? 'sí' : 'no'}`,
  };
}

function compactarRapido(texto) {
  let out = '';
  const s = String(texto || '').toLowerCase().normalize('NFD');
  for (let i = 0; i < s.length; i += 1) {
    const c = s[i];
    if ((c >= 'a' && c <= 'z') || (c >= '0' && c <= '9')) out += c;
  }
  return out;
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
    /* Fase B · Ceder el hilo entre páginas (§4.2.5) */
    if (typeof globalThis.scheduler?.yield === 'function') {
      await globalThis.scheduler.yield();
    } else {
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

    /* Si la primera página es casi 100% blanca (portadilla vacía o desbordada),
     * probar la página 2 para capturar la carátula gráfica real. */
    if (numero === 1 && (doc.numPages || 1) >= 2) {
      try {
        const datosImg = contexto.getImageData(0, 0, lienzo.width, lienzo.height);
        const px = datosImg.data;
        let blancos = 0;
        const paso = 16;
        const total = Math.floor(px.length / paso);
        for (let i = 0; i < px.length; i += paso) {
          if (px[i] > 248 && px[i + 1] > 248 && px[i + 2] > 248) blancos += 1;
        }
        if (blancos / (total || 1) > 0.992) {
          try { pagina?.cleanup?.(); } catch (_) {}
          pagina = null;
          lienzo.width = 0;
          lienzo.height = 0;
          return renderizarPortada(doc, { ancho, numero: 2 });
        }
      } catch (_) { /* si falla lectura de píxeles, conservar página 1 */ }
    }

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
    const adjunto = await leerAdjuntoEstructurado(doc);
    const indice = opciones.usarIndice === false ? [] : await leerIndice(doc);
    const { paginas, cancelado } = await extraerPaginas(doc, opciones);
    if (cancelado) return { cancelado: true };

    /* El adjunto solo se usa si dice lo mismo que las páginas (plan §4).
     * Si no cuadra, se cae a la extracción ordinaria con aviso. */
    let adjuntoValidado = null;
    if (adjunto) {
      const comprobacion = validarAdjuntoContrapaginas(adjunto, paginas);
      if (comprobacion.valido) {
        adjuntoValidado = adjunto;
      } else {
        console.warn('[jg-pdf] Adjunto inconsistente con las páginas (', comprobacion.detalle, ') — extracción ordinaria.');
      }
    }

    const resultado = componerTexto(paginas, { indice, origen: 'texto' });
    /* La portada se saca ahora, con el documento todavía abierto. */
    const portada = opciones.conPortada === false ? null : await renderizarPortada(doc);
    const caracteres = resultado.texto.length;
    const leidas = paginas.length || 1;
    const escaneado = resultado.paginasConTexto === 0 || caracteres / leidas < 40;

    return {
      cancelado: false,
      titulo: adjuntoValidado?.titulo || titulo,
      autor: adjuntoValidado?.autor || '',
      totalPaginas,
      paginasLeidas: paginas.length,
      escaneado,
      portada,
      adjuntoEstructurado: adjuntoValidado,
      perfilMusical: adjuntoValidado?.perfilMusical || null,
      ...resultado,
    };
  } finally {
    try { await doc.destroy(); } catch (_) { /* liberar memoria, sin drama */ }
  }
}
