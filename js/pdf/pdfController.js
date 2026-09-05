/* JG Turbo · Lector de PDF (interfaz)
 *
 * Une las piezas: extraer el texto, limpiarlo, guardarlo para siempre en el
 * dispositivo, buscar dentro, traducirlo, escucharlo y exportarlo.
 *
 * Dos ideas mandan sobre el resto:
 *
 * 1. Lo que el usuario ya tiene va primero. Al abrir la pestaña ve «seguir
 *    leyendo» y su biblioteca, no un formulario para subir otro archivo.
 * 2. Un libro grande no se vuelca entero en el cuadro de edición (un textarea
 *    con tres millones de letras congela hasta un buen computador): se divide
 *    en capítulos y se muestra uno, sin perder el resto.
 */
import { procesarPdf, ErrorPdf } from './extractorPdf.js';
import { componerTexto, pulirParaLectura, prepararCapitulosLectura } from './limpiezaTexto.js';
import { partirTextoCanonico, mejorCorte as mejorCorteCanonico, LIMITE_PARTE as LIMITE_PARTE_CANONICO } from './particion.js';
import {
  crearColaDesdePartes, hidratarCola, serializarCola, correrCola,
  etiquetaColaCorreccion, resumenCola, prepararReanudacion,
  textoCorregidoDeParte, libroCorregidoEnOrden, componerLibroDesdePartes,
  parteCompleta, aplicarExito, validarResultadoCorreccion, validarCoberturaCola,
  validarUnionesEntreBloques, colaListaParaLibro,
} from './colaCorreccion.js';
import { VERSION_RECONSTRUCCION, VERSION_TROCEO as VERSION_TROCEO_MOTOR } from './reconstruccion.js';
import { contarPendientes, aceptarDecisionesIA, aplicarDecisionUsuario } from './limites.js';
import { planMigracionV7 as planMigracionV6, serializarReconstruccion, marcarNeedsSource } from './manifiesto.js';
import { sha256Hex } from './huella.js';
import { initLibroVista, ordenarDocumentos, paginarDocumentos } from './libroVista.js';
import { prepararParaVoz } from './vozTexto.js';
import { crearPulidor, crearAuditorPdf, tokenizarParaAuditoria, validarIntegridadEstructura, aplicarDecisiones, aplicarSignos } from './pulido.js';
import { dividirEnBloquesSemanticos, construirHuella, estadoAuditoriaTexto, estadoCorreccionLecturaTexto } from './auditoria.js';
import { construirIndice, buscarRelevantes } from './busqueda.js';
import { construirDocx, construirHtmlImpresion, construirMarkdown } from './exportar.js';
import { crearTraductor, necesitaTraduccion } from './traduccion.js';
import {
  progresoInicial, avanzarProgreso, calcularPorcentaje, estadoDeLectura,
  etiquetaEstado, etiquetaProgreso, progresoDeCapitulo, formatearTamano, etiquetaReanudar,
} from './progreso.js';
import { construirAncla, resolverAncla } from './anclaTexto.js';
import { limpiarNombreLibro, conseguirCaratula } from './caratula.js';
import * as almacen from './biblioteca.js';
import { crearNube } from './nube.js';

/* A partir de aquí el texto se parte para que el editor siga siendo ágil. */
const LIMITE_PARTE = LIMITE_PARTE_CANONICO;
/* Por debajo de esto no vale la pena partir por capítulos: un folleto de dos
 * páginas se lee entero de una vez, no en tres pedazos. */
const MINIMO_PARA_CAPITULOS = 8000;
/* Sube cuando cambie la forma de cortar el libro en unidades de lectura. Los
 * libros guardados con una versión anterior se rehacen solos al abrirlos: el
 * troceo se guarda con el documento, así que arreglar el código no arregla lo
 * que ya estaba en la biblioteca. */
const VERSION_TROCEO = VERSION_TROCEO_MOTOR;
/* Invalida el pulido v5 que reescribía capítulos para unir palabras. */
const VERSION_PULIDO_LECTURA = 7;
/* Cuánto texto se le manda a la IA como contexto de una pregunta. */
const LIMITE_CONTEXTO_IA = 12000;
const TAM_BLOQUE_BUSQUEDA = 2000;
/* Cada cuánto se guarda por dónde va la lectura mientras se desplaza. */
const ESPERA_GUARDADO_MS = 900;

const $ = (id) => document.getElementById(id);

export function inicializarLectorPdf(deps = {}) {
  const el = {
    area: document.querySelector('.pdf-area'),
    lead: document.querySelector('#panelPdf .panel-lead'),
    subir: $('pdfSubir'), drop: $('pdfDrop'), input: $('pdfInput'), nombre: $('pdfName'),
    lang: $('pdfLang'), outputLang: $('pdfOutputLang'),
    rangeBody: $('pdfRangeBody'), rangeMeta: $('pdfRangeMeta'), from: $('pdfFrom'), to: $('pdfTo'),
    leer: $('btnPdfRead'), hint: $('pdfActionHint'),
    progArea: $('pdfProgArea'), prog: $('pdfProg'), progLabel: $('pdfProgLabel'), cancelar: $('btnPdfCancel'),
    notice: $('pdfNotice'), noticeLector: $('pdfNoticeLector'), resultArea: $('pdfResultArea'),
    hojaFondo: $('pdfHojaFondo'), buscarToggle: $('btnPdfBuscarToggle'), buscarFila: $('pdfSearchRow'),
    pantalla: $('btnPdfPantalla'),

    continuar: $('pdfContinuar'), continuarTapa: $('pdfContinuarTapa'),
    continuarTitulo: $('pdfContinuarTitulo'), continuarDonde: $('pdfContinuarDonde'),
    continuarBarra: $('pdfContinuarBarra'), continuarRelleno: $('pdfContinuarRelleno'),
    btnContinuar: $('btnPdfContinuar'),

    biblioteca: $('pdfBiblioteca'), conteo: $('pdfBibliotecaConteo'), rejilla: $('pdfRejilla'),
    vacia: $('pdfBibliotecaVacia'), espacio: $('pdfEspacio'), anadir: $('btnPdfAnadir'),
    buscarLibro: $('pdfBuscarLibro'),

    titulo: $('pdfResultTitle'), donde: $('pdfDocDonde'), count: $('pdfCount'),
    salida: $('pdfOutput'), realce: $('pdfRealce'), volver: $('btnPdfBack'),
    capPrev: $('btnPdfCapPrev'), capNext: $('btnPdfCapNext'),
    actualizarBiblio: $('btnPdfActualizarBiblio'),
    actualizarBiblioLabel: $('pdfActualizarBiblioLabel'),
    barraDoc: $('pdfProgresoDoc'), barraRelleno: $('pdfProgresoRelleno'),
    btnIndice: $('btnPdfIndice'), indice: $('pdfIndice'), indiceLista: $('pdfIndiceLista'),
    navbar: $('pdfNavbar'), prev: $('btnPdfPrev'), next: $('btnPdfNext'), navPos: $('pdfNavPos'),
    buscar: $('pdfSearch'), buscarPrev: $('btnPdfSearchPrev'), buscarNext: $('btnPdfSearchNext'),
    buscarInfo: $('pdfSearchInfo'),

    masMenu: $('pdfMasMenu'),
    masPanel: $('pdfMasPanel'),
    btnMas: $('btnPdfMas'),
    pulidoCambio: $('pdfPulidoCambio'),
    verSinPulir: $('btnPdfVerOriginalPulido'),
    verPulido: $('btnPdfVerPulido'),
    pulidoEstado: $('pdfPulidoEstado'),
    docTapa: $('pdfDocTapa'),
    temaPapel: $('btnPdfTemaPapel'),
    temaNoche: $('btnPdfTemaNoche'),
    btnPdfClear: $('btnPdfClear'),
    btnPdfCopy: $('btnPdfCopy'),
    btnPdfShowText: $('btnPdfShowText'),

    tradBar: $('pdfTradBar'), tradTexto: $('pdfTradTexto'), tradBtn: $('btnPdfTraducirDoc'),
    tradLabel: $('pdfTraducirDocLabel'), tradCambio: $('pdfTradCambio'),
    verOriginal: $('btnPdfVerOriginal'), verEspanol: $('btnPdfVerEspanol'),

    askInput: $('pdfAskInput'), askBtn: $('btnPdfAsk'), askLabel: $('pdfAskLabel'),
    askAnswer: $('pdfAskAnswer'), askClear: $('btnPdfAskClear'),
    resumen: $('btnPdfSummary'), ideas: $('btnPdfKeyIdeas'), resumenTodo: $('btnPdfSummaryAll'),
    askProgArea: $('pdfAskProgArea'), askProg: $('pdfAskProg'), askProgLabel: $('pdfAskProgLabel'),
    askCancel: $('btnPdfAskCancel'),

    audiolibroBox: $('pdfAudiolibroBox'), audiolibro: $('btnPdfAudiolibro'),
    seccionEscuchar: $('pdfSeccionEscuchar'),
    seguirSi: $('btnPdfSeguirSi'), seguirNo: $('btnPdfSeguirNo'),
    dormir: $('pdfDormir'), dormirEstado: $('pdfDormirEstado'),
    audiolibroLabel: $('pdfAudiolibroLabel'), audiolibroHint: $('pdfAudiolibroHint'),
    txt: $('btnPdfTxt'), docx: $('btnPdfDocx'), imprimir: $('btnPdfPrint'), markdown: $('btnPdfMd'),
    ocrBox: $('pdfOcrBox'), ocrTexto: $('pdfOcrTexto'), ocrLang: $('pdfOcrLang'),
    ocrPaginas: $('pdfOcrPaginas'), ocrBtn: $('btnPdfOcr'), ocrLabel: $('pdfOcrLabel'), ocrHint: $('pdfOcrHint'),
    revisionBtn: $('btnPdfRevision'), revisionCuenta: $('pdfRevisionCuenta'),
    revisionHoja: $('pdfRevisionHoja'), revisionTitulo: $('pdfRevisionTitulo'),
    revisionLista: $('pdfRevisionLista'), revisionVacio: $('pdfRevisionVacio'),
    revisionAceptarTodo: $('btnPdfRevisionAceptarTodo'), revisionCerrar: $('btnPdfRevisionCerrar'),
    auditoriaHoja: $('pdfAuditoriaHoja'), auditoriaProveedor: $('pdfAuditoriaProveedor'),
    auditoriaAceptar: $('btnPdfAuditoriaAceptar'), auditoriaRechazar: $('btnPdfAuditoriaRechazar'),
    auditoriaCerrar: $('btnPdfAuditoriaCerrar'),
    reanudar: $('pdfReanudar'), reanudarTxt: $('pdfReanudarTxt'),
    reanudarInicio: $('btnPdfReanudarInicio'),
    reanudarCorreccion: $('pdfReanudarCorreccion'),
    reanudarCorreccionTxt: $('pdfReanudarCorreccionTxt'),
    btnReanudarCorreccion: $('btnPdfReanudarCorreccion'),

    nube: $('pdfNube'), nubePunto: $('pdfNubePunto'), nubeEstado: $('pdfNubeEstado'),
    nubeMas: $('btnPdfNubeMas'), nubeOpciones: $('pdfNubeOpciones'),
    nubeConectar: $('btnPdfNubeConectar'), nubeConectarLabel: $('pdfNubeConectarLabel'),
    nubeSync: $('btnPdfNubeSync'), nubeSyncLabel: $('pdfNubeSyncLabel'),
    nubePase: $('pdfNubePase'), nubeQr: $('pdfNubeQr'), nubeDigitos: $('pdfNubeDigitos'),
    nubeCaduca: $('pdfNubeCaduca'), nubeCompartir: $('btnPdfNubeCompartir'),
    nubeCopiarEnlace: $('btnPdfNubeCopiarEnlace'), nubeCerrarPase: $('btnPdfNubeCerrarPase'),
    nubeUnirse: $('pdfNubeUnirse'), nubeTengo: $('btnPdfNubeTengo'),
    nubeEntradaCaja: $('pdfNubeEntradaCaja'), nubeEntrada: $('pdfNubeEntrada'),
    nubeUnir: $('btnPdfNubeUnir'), nubeAviso: $('pdfNubeAviso'),
    nubeLlave: $('btnPdfNubeLlave'), nubeSalir: $('btnPdfNubeSalir'),
    nubeLlaveCaja: $('pdfNubeLlaveCaja'), nubeLlaveTexto: $('pdfNubeLlaveTexto'),
    nubeCopiarLlave: $('btnPdfNubeCopiarLlave'), nubeLlaveOk: $('btnPdfNubeLlaveOk'),
    lectura: $('pdfLectura'), vistaLectura: $('pdfVistaLectura'), vistaEditar: $('pdfVistaEditar'),
    modoEstados: $('pdfModoEstados'), editarBarra: $('pdfEditarBarra'),
    editarGuardar: $('pdfEditarGuardar'), editarCancelar: $('pdfEditarCancelar'),
    textoCaja: $('pdfTextoCaja'), docRef: $('pdfDocRef'),
    aparTam: $('pdfAparTam'), aparInter: $('pdfAparInter'), aparAncho: $('pdfAparAncho'),
    aparFuente: $('pdfAparFuente'), temaSepia: $('btnPdfTemaSepia'),
    btnCortes: $('btnPdfCortes'), cortesCuenta: $('pdfCortesCuenta'),
    btnDesdeAqui: $('btnPdfDesdeAqui'),
    cortesHoja: $('pdfCortesHoja'), cortesLista: $('pdfCortesLista'), cortesCerrar: $('pdfCortesCerrar'),
    recorte: $('pdfRecorte'), recorteCerrar: $('pdfRecorteCerrar'),
    btnVincular: $('btnPdfVincular'), vincularInput: $('pdfVincularInput'),
    volverLectura: $('pdfVolverLectura'), btnPausar: $('btnPdfPausarCorreccion'),
    orden: $('pdfOrden'), vistaPortadas: $('pdfVistaPortadas'), vistaCompacta: $('pdfVistaCompacta'),
    mostrarMas: $('pdfMostrarMas'),
  };
  if (!el.drop || !el.salida) return null;

  const estado = {
    archivo: null,
    id: '',
    titulo: '',
    idioma: 'es',
    partes: [],
    parteActual: 0,
    totalPaginas: 0,
    progreso: progresoInicial(),
    temporizadorReanudar: null,
    traductor: null,
    traducido: new Map(),
    pulidor: null,
    pulido: new Map(),
    pulidoActivo: true,
    vista: 'original',
    cancelacion: null,
    trabajando: false,
    busqueda: { termino: '', golpes: [], indice: -1 },
    audiolibro: { vigilante: null },
    tareaIA: null,
    filtro: 'todos',
    consulta: '',
    urlsPortada: [],
    // Capas auditoría
    originalTexto: '',
    localTexto: '',
    bloques: [],
    bloquesEstructurales: [],
    omisiones: [],
    auditor: null,
    consentido: false,
    auditoriaEstado: 'Solo local',
    auditoriaProgreso: { total: 0, completados: 0, fallos: 0 },
    correccionProgreso: { total: 0, completados: 0, fallos: 0, ejecutando: false, token: 0, etapa: '' },
    colaCorreccion: null,
    // Fuente inmutable (lo extraído del PDF) y revisión de lectura derivada.
    // La corrección nunca reemplaza el original: genera una revisión nueva.
    fuenteTexto: '',
    fuenteRevision: '',
    revisionLectura: '',
    guardadoConfirmado: false,
    correccionPausada: false,
    capa: { original: '', local: '', revisadoSeguro: '', aprobado: '' },
    textoAprobadoPorBloque: new Map(),
    textoSeguroPorBloque: new Map(),
    propuestasPorBloque: new Map(),
    decisionesPorBloque: new Map(),
    limites: [],
    atomos: [],
    offsetDeAtomo: new Map(),
    pendientesLimites: 0,
    needsSource: false,
  };

  /* ── Ayudas ──────────────────────────────────────────────────────── */

  const idiomaActual = () => (el.lang && el.lang.value !== 'auto' ? el.lang.value : 'es');
  const hayDocumento = () => estado.partes.length > 0;
  /* Qué se está viendo: la vista de libro o el textarea de edición. Todo lo
   * que mida, marque o desplace tiene que preguntar por aquí, porque medir un
   * elemento oculto devuelve ceros: ese era el motivo de que la lectura no
   * siguiera a la voz. */
  const enModoLectura = () => !!el.lectura && !el.lectura.hidden;

  /** Texto de un capítulo según se esté viendo el original o el español (con pulido si aplica). */
  function textoDeParte(indice) {
    if (estado.vista === 'es' && estado.traducido.has(indice)) return estado.traducido.get(indice);
    if (estado.pulidoActivo && estado.pulido.has(indice)) return estado.pulido.get(indice);
    return estado.partes[indice]?.texto || '';
  }

  function fijarTextoDeParte(indice, texto) {
    if (estado.vista === 'es' && estado.traducido.has(indice)) {
      estado.traducido.set(indice, texto);
    } else if (estado.pulidoActivo && estado.pulido.has(indice)) {
      estado.pulido.set(indice, texto);
    } else if (estado.partes[indice]) {
      estado.partes[indice].texto = texto;
    }
  }

  /** Las partes tal como se ven ahora: es lo que se exporta y se escucha. */
  function partesVisibles() {
    guardarEdicionActual();
    return estado.partes.map((parte, i) => ({ titulo: parte.titulo, texto: textoDeParte(i) }));
  }

  const textoCompleto = () => partesVisibles().map((p) => p.texto).join('\n\n');

  let temporizadorAviso = null;
  /**
   * Un aviso, dos sitios: en la biblioteca va en la columna, y con el libro
   * abierto va al dock, junto al reproductor.
   *
   * Y en el lector SIEMPRE se va solo. Antes un `warn` se quedaba fijo: una
   * franja de color encima del texto durante toda la lectura, ocupando
   * pantalla sin que nadie volviera a leerla. Los errores duran más que las
   * confirmaciones, que es lo único que justifica la diferencia.
   */
  function avisar(mensaje, tipo = 'warn', { efimero = false } = {}) {
    clearTimeout(temporizadorAviso);
    const leyendo = hayDocumento();
    const destino = (leyendo && el.noticeLector) ? el.noticeLector : el.notice;
    const otro = destino === el.notice ? el.noticeLector : el.notice;
    if (otro) otro.hidden = true;
    if (!mensaje) { destino.hidden = true; return; }
    destino.className = destino === el.noticeLector
      ? `notice ${tipo} pdf-aviso-lector`
      : `notice ${tipo}`;
    destino.textContent = mensaje;
    destino.hidden = false;
    const grave = tipo === 'warn' || tipo === 'err';
    if (leyendo || tipo === 'info' || tipo === 'ok' || efimero) {
      temporizadorAviso = setTimeout(() => {
        if (destino.textContent === mensaje) destino.hidden = true;
      }, leyendo && grave ? 12000 : 6000);
    }
  }

  function mostrarProgreso(visible, etiqueta = '', porcentaje = null) {
    el.progArea.hidden = !visible;
    if (etiqueta) el.progLabel.textContent = etiqueta;
    if (porcentaje != null) el.prog.style.width = `${Math.max(0, Math.min(100, porcentaje))}%`;
  }

  function bloquear(trabajando) {
    estado.trabajando = trabajando;
    el.leer.disabled = trabajando || !estado.archivo;
    el.drop.setAttribute('aria-disabled', trabajando ? 'true' : 'false');
    if (el.input) el.input.disabled = trabajando;
    if (el.ocrBtn) el.ocrBtn.disabled = trabajando;
  }

  function actualizarContador() {
    const contar = deps.contarPalabras || ((t) => (t.trim() ? t.trim().split(/\s+/).length : 0));
    el.count.textContent = `${contar(el.salida.value)} palabras`;
  }

  /* ── Partir el texto en capítulos manejables ─────────────────────── */

  /**
   * Dónde conviene cortar antes de `limite`, de mejor a peor:
   * final de párrafo → final de frase → hueco entre palabras.
   *
   * Nunca a mitad de palabra, que es lo que hacía antes cuando no encontraba
   * un salto de párrafo: la unidad de lectura empezaba con media palabra y la
   * voz la leía partida.
   *
   * @param {string} texto
   * @param {number} desde  – dónde empieza este trozo
   * @param {number} limite – tope al que no se debe llegar
   */
  function mejorCorte(texto, desde, limite) {
    return mejorCorteCanonico(texto, desde, limite);
  }

  function partirTexto(texto, capitulos, paginas = [], _candidatosUnion = [], extra = {}) {
    if (!texto) return [];
    const capitulosLectura = prepararCapitulosLectura(texto, capitulos);
    return partirTextoCanonico(texto, {
      capitulos: capitulosLectura,
      bloques: extra.bloques || estado.bloquesLectura || [],
      limites: extra.limites || estado.limites || [],
      atomos: extra.atomos || estado.atomos || [],
      offsetDeAtomo: extra.offsetDeAtomo || estado.offsetDeAtomo || new Map(),
      limiteParte: LIMITE_PARTE,
    });
  }

  /* ── Biblioteca ──────────────────────────────────────────────────── */

  function liberarPortadas() {
    for (const url of estado.urlsPortada) URL.revokeObjectURL(url);
    estado.urlsPortada = [];
  }

  /* ── Carátulas de los libros que no traen ninguna ───────────────────
   *
   * Un PDF de solo texto no tiene tapa, y una estantería de rectángulos con
   * una letra no se puede recorrer con la vista. Se resuelve en dos pasos:
   * se busca la portada REAL del libro y, si no aparece, se dibuja una con su
   * título, su autor y un color propio.
   *
   * La dibujada no necesita internet ni cuesta nada, así que se pone sola. La
   * búsqueda de la real sí sale a la red: se hace al pulsar «Buscar carátula»
   * y al procesar un libro nuevo, no cada vez que se abre la biblioteca.
   */
  async function ponerCaratula(doc, { buscarReal = false, forzar = false } = {}) {
    if (!doc || !doc.id) return 'ninguna';
    if (doc.tienePortada && !forzar) return 'ninguna';
    try {
      const { titulo, autor } = limpiarNombreLibro(doc.titulo || doc.nombreArchivo || '');
      if (!titulo) return 'ninguna';
      const { blob, origen } = await conseguirCaratula({ titulo, autor, buscarReal });
      if (!blob) return 'ninguna';
      await almacen.guardarPortadaGenerada(doc.id, blob, origen);
      return origen;
    } catch (_) {
      return 'ninguna';   /* sin carátula el libro se abre igual */
    }
  }

  /**
   * Da carátula dibujada a todos los libros que no tengan ninguna.
   *
   * Sin red y sin bloquear: se lanza tras pintar la biblioteca y cada libro
   * aparece en cuanto está listo. Solo dibuja; la portada real se busca a
   * petición, porque salir a internet por cada libro al abrir la app sería
   * gastar datos sin que nadie lo haya pedido.
   */
  async function completarCaratulasQueFaltan(documentos) {
    const sinTapa = (documentos || []).filter((d) => d && !d.borrado && !d.tienePortada);
    if (!sinTapa.length) return;
    let puestas = 0;
    for (const doc of sinTapa) {
      if (await ponerCaratula(doc, { buscarReal: false }) !== 'ninguna') puestas += 1;
    }
    if (puestas) pintarBiblioteca();
  }

  function tarjetaLibro(doc) {
    const item = document.createElement('li');
    item.className = 'pdf-libro';
    item.tabIndex = 0;
    item.setAttribute('role', 'button');
    item.setAttribute('aria-label', `Abrir ${doc.titulo || 'documento'}`);

    item.addEventListener('click', (e) => {
      if (e.target.closest('.pdf-libro-menu')) return;
      abrirDocumento(doc.id);
    });
    item.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        if (e.target.closest('.pdf-libro-menu')) return;
        e.preventDefault();
        abrirDocumento(doc.id);
      }
    });

    const tapa = document.createElement('div');
    tapa.className = 'pdf-libro-tapa';
    tapa.dataset.sinPortada = doc.tienePortada ? '0' : '1';
    tapa.dataset.inicial = (doc.titulo || '?').trim().charAt(0).toUpperCase();

    const estadoEl = document.createElement('span');
    estadoEl.className = 'pdf-libro-estado';
    estadoEl.dataset.estado = doc.estado || 'sin-empezar';
    estadoEl.textContent = etiquetaEstado(doc.estado);
    tapa.appendChild(estadoEl);

    // Menú ⋯ en la esquina superior derecha
    const menu = document.createElement('details');
    menu.className = 'pdf-libro-menu';
    menu.addEventListener('click', (e) => e.stopPropagation());

    const summary = document.createElement('summary');
    summary.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true" style="width:16px;height:16px;"><circle cx="12" cy="12" r="1.5"/><circle cx="19" cy="12" r="1.5"/><circle cx="5" cy="12" r="1.5"/></svg>';
    summary.title = 'Opciones del libro';
    summary.setAttribute('aria-label', `Opciones de ${doc.titulo || 'documento'}`);

    const pop = document.createElement('div');
    pop.className = 'pdf-libro-menu-pop';

    const reiniciar = document.createElement('button');
    reiniciar.type = 'button';
    reiniciar.className = 'mini-btn';
    reiniciar.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true" style="width:14px;height:14px;"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg><span>Reiniciar</span>';
    reiniciar.title = `Volver al principio de ${doc.titulo || 'este documento'}`;
    reiniciar.setAttribute('aria-label', `Volver al principio de ${doc.titulo || 'este documento'}`);
    reiniciar.addEventListener('click', async (e) => {
      e.stopPropagation();
      menu.open = false;
      await almacen.reiniciarDocumento(doc.id);
      if (estado.id === doc.id) {
        estado.progreso = progresoInicial();
        mostrarParte(0);
      }
      pintarBiblioteca();
      avisar(`«${doc.titulo}» vuelve a empezar desde el principio.`, 'info');
      sincronizarAhora({ silencioso: true });
    });

    /* Buscar la carátula de verdad. Se ofrece siempre, no solo a los libros
     * sin tapa: una portada dibujada puede cambiarse por la real si el libro
     * aparece en el catálogo. */
    const buscarTapa = document.createElement('button');
    buscarTapa.type = 'button';
    buscarTapa.className = 'mini-btn';
    buscarTapa.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true" style="width:14px;height:14px;"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg><span>Buscar carátula</span>';
    buscarTapa.title = `Buscar la carátula real de ${doc.titulo || 'este libro'}`;
    buscarTapa.setAttribute('aria-label', `Buscar la carátula real de ${doc.titulo || 'este libro'}`);
    buscarTapa.addEventListener('click', async (e) => {
      e.stopPropagation();
      menu.open = false;
      avisar('Buscando la carátula…', 'info');
      const origen = await ponerCaratula(doc, { buscarReal: true, forzar: true });
      if (origen === 'real') avisar(`Carátula encontrada para «${doc.titulo}».`, 'ok', { efimero: true });
      else if (origen === 'dibujada') avisar('No aparece en el catálogo: se dibujó una carátula.', 'info', { efimero: true });
      else avisar('No se pudo poner carátula a este libro.', 'warn');
      await pintarBiblioteca();
      refrescarInicio();
    });

    const borrar = document.createElement('button');
    borrar.type = 'button';
    borrar.className = 'mini-btn';
    borrar.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true" style="width:14px;height:14px;"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/></svg><span>Borrar</span>';
    borrar.title = `Borrar ${doc.titulo || 'este documento'} de la biblioteca`;
    borrar.setAttribute('aria-label', `Borrar ${doc.titulo || 'este documento'}`);
    borrar.addEventListener('click', (e) => {
      e.stopPropagation();
      confirmarBorrado(borrar, doc);
    });

    pop.append(reiniciar, buscarTapa, borrar);
    menu.append(summary, pop);
    item.appendChild(menu);

    const cuerpo = document.createElement('div');
    cuerpo.className = 'pdf-libro-cuerpo';
    const titulo = document.createElement('span');
    titulo.className = 'pdf-libro-titulo';
    titulo.textContent = doc.titulo || doc.nombreArchivo || 'Documento';
    titulo.title = doc.titulo || doc.nombreArchivo || 'Documento';
    const meta = document.createElement('span');
    meta.className = 'pdf-libro-meta';
    const partesGuardadas = (doc.titulosPartes || []).length || 1;
    const porcentaje = doc.progreso
      ? calcularPorcentaje(doc.progreso, (doc.titulosPartes || ['x']).map(() => ({ texto: 'x' })))
      : 0;
    meta.textContent = `${doc.paginasLeidas || 0} págs · ${partesGuardadas > 1 ? `${partesGuardadas} capítulos` : 'capítulo único'}`;

    const barra = document.createElement('div');
    barra.className = 'pdf-barra';
    barra.setAttribute('role', 'progressbar');
    barra.setAttribute('aria-valuemin', '0');
    barra.setAttribute('aria-valuemax', '100');
    barra.setAttribute('aria-valuenow', String(porcentaje));
    barra.setAttribute('aria-label', `Progreso de ${doc.titulo || 'documento'}`);
    const relleno = document.createElement('div');
    relleno.className = 'pdf-barra-relleno';
    relleno.style.width = `${porcentaje}%`;
    barra.appendChild(relleno);

    cuerpo.append(titulo, meta, barra);
    // Avance de lectura, estado de corrección y sincronización por separado.
    try {
      const sub = document.createElement('span');
      sub.className = 'pdf-libro-sub';
      const lect = etiquetaEstado(doc.estado);
      const corr = doc.pendientesLimites > 0 ? (doc.pendientesLimites + ' cortes por revisar')
        : (doc.versionReconstruccion >= 7 ? 'Texto revisado' : 'Texto local');
      const sync = doc.sincronizar === false ? 'Solo en este aparato' : 'Sincronizado';
      sub.textContent = lect + ' · ' + corr + ' · ' + sync;
      sub.title = 'Lectura: ' + lect + '. Corrección: ' + corr + '. Nube: ' + sync;
      cuerpo.appendChild(sub);
      if (doc.errorBiblioteca) {
        const err = document.createElement('span');
        err.className = 'pdf-libro-error';
        err.textContent = String(doc.errorBiblioteca);
        const reintentar = document.createElement('button');
        reintentar.type = 'button';
        reintentar.className = 'mini-btn';
        reintentar.textContent = 'Reintentar';
        reintentar.addEventListener('click', (e) => {
          e.stopPropagation();
          pintarBiblioteca();
        });
        err.appendChild(reintentar);
        cuerpo.appendChild(err);
      }
    } catch (_) {}

    const abrir = document.createElement('div');
    abrir.className = 'pdf-libro-abrir';
    abrir.append(tapa, cuerpo);
    item.appendChild(abrir);

    /* La portada se pide aparte: la lista se pinta sin esperar por las tapas. */
    if (doc.tienePortada) {
      almacen.cargarPortada(doc.id).then((blob) => {
        /* El registro dice que hay carátula pero el archivo no está (libro que
         * llegó por sincronización antes de que las carátulas viajaran):
         * se muestra la inicial en vez de un cuadro vacío. */
        if (!blob) { tapa.dataset.sinPortada = '1'; return; }
        const url = URL.createObjectURL(blob);
        estado.urlsPortada.push(url);
        tapa.style.backgroundImage = `url("${url}")`;
        tapa.dataset.sinPortada = '0';
      }).catch(() => { /* sin tapa se vive */ });
    }
    return item;
  }

  /** Borrar pide confirmación en el propio botón: nada de ventanas modales. */
  function confirmarBorrado(boton, doc) {
    if (boton.dataset.confirmando === '1') {
      clearTimeout(Number(boton.dataset.temporizador));
      almacen.borrarDocumento(doc.id).then(() => {
        if (estado.id === doc.id) cerrarDocumento();
        pintarBiblioteca();
        pintarContinuar();
        avisar(`«${doc.titulo}» se borró de la biblioteca.`, 'info');
        sincronizarAhora({ silencioso: true });
      });
      return;
    }
    const original = boton.innerHTML;
    boton.dataset.confirmando = '1';
    boton.classList.add('danger');
    boton.innerHTML = '<span>¿Seguro?</span>';
    boton.dataset.temporizador = String(setTimeout(() => {
      boton.dataset.confirmando = '0';
      boton.classList.remove('danger');
      boton.innerHTML = original;
    }, 4000));
  }

  function coincideFiltro(doc) {
    if (estado.filtro !== 'todos' && (doc.estado || 'sin-empezar') !== estado.filtro) return false;
    if (!estado.consulta) return true;
    return String(doc.titulo || '').toLowerCase().includes(estado.consulta);
  }

  async function pintarBiblioteca() {
    const documentos = await almacen.listarDocumentos();
    liberarPortadas();
    el.rejilla.innerHTML = '';

    const hay = documentos.length > 0;
    el.biblioteca.hidden = !hay;
    if (el.lead) el.lead.hidden = hay;
    if (el.subir) el.subir.classList.toggle('pdf-subir--secundaria', hay);

    if (!hay) { el.espacio.textContent = ''; return; }

    let modoOrden = 'reciente';
    try { modoOrden = localStorage.getItem('jg_pdf_orden') || 'reciente'; } catch (_) {}
    if (el.orden) { try { el.orden.value = modoOrden; } catch (_) {} }
    const visibles = ordenarDocumentos(documentos.filter(coincideFiltro), modoOrden);
    if (documentos.length === 1) el.conteo.textContent = '1 documento guardado en este dispositivo';
    else el.conteo.textContent = documentos.length + ' documentos guardados en este dispositivo';
    el.vacia.hidden = visibles.length > 0;
    const limite = estado.biblioLimite || 40;
    const pagina = paginarDocumentos(visibles, limite);
    for (const doc of pagina.visibles) el.rejilla.appendChild(tarjetaLibro(doc));
    if (el.mostrarMas) {
      el.mostrarMas.hidden = !(pagina.resto > 0);
      el.mostrarMas.textContent = 'Mostrar más (' + pagina.resto + ' restantes)';
    }

    const espacio = await almacen.espacioUsado();
    if (espacio && espacio.total) {
      el.espacio.textContent = `${formatearTamano(espacio.usado)} usados` +
        (espacio.persistente ? ' · guardado protegido' : ' · el navegador podría liberarlo si falta espacio');
      if (espacio.porcentaje >= 85) {
        avisar('Queda poco espacio en el navegador. Borra algún documento para poder guardar más.', 'warn');
      }
    } else {
      el.espacio.textContent = '';
    }

    /* Los libros sin tapa reciben la suya dibujada, sin bloquear el pintado.
     * `pintarBiblioteca` se llama sola al terminar, y como para entonces ya
     * tienen portada, no vuelve a entrar aquí: no hay bucle. */
    completarCaratulasQueFaltan(documentos).catch(() => {});
  }

  async function pintarContinuar() {
    const doc = await almacen.ultimoEnCurso();
    const enCurso = doc && doc.estado === 'leyendo';
    el.continuar.hidden = !enCurso;
    if (!enCurso) return;

    el.continuarTitulo.textContent = doc.titulo || 'Documento';
    const falsasPartes = (doc.titulosPartes || ['x']).map((t) => ({ titulo: t, texto: 'x' }));
    const porcentaje = calcularPorcentaje(doc.progreso, falsasPartes);
    el.continuarDonde.textContent = etiquetaProgreso(doc.progreso, falsasPartes);
    el.continuarRelleno.style.width = `${porcentaje}%`;
    el.continuarBarra.setAttribute('aria-valuenow', String(porcentaje));
    el.btnContinuar.onclick = () => abrirDocumento(doc.id);

    el.continuarTapa.style.backgroundImage = '';
    if (doc.tienePortada) {
      almacen.cargarPortada(doc.id).then((blob) => {
        if (!blob) return;
        const url = URL.createObjectURL(blob);
        estado.urlsPortada.push(url);
        el.continuarTapa.style.backgroundImage = `url("${url}")`;
      }).catch(() => {});
    }
  }

  async function refrescarInicio() {
    await pintarBiblioteca();
    await pintarContinuar();
  }

  /* ── Abrir, mostrar y cerrar un documento ────────────────────────── */

  function guardarEdicionActual() {
    if (!hayDocumento()) return;
    const nuevo = el.salida.value;
    const antes = textoDeParte(estado.parteActual);
    if (nuevo !== antes && nuevo.trim() && antes.trim()) {
      // edición manual: guardar como intervención aprobada, detener auditoría obsoleta y ofrecer reauditar
      const bloqueId = estado.bloques[estado.parteActual]?.id || `cap_${estado.parteActual}`;
      estado.textoAprobadoPorBloque.set(bloqueId, nuevo);
      estado.textoAprobadoPorBloque.set(`cap_${estado.parteActual}`, nuevo);
      almacen.guardarPulidoEstructurado(estado.id, estado.parteActual, {
        version: VERSION_PULIDO_LECTURA,
        huellaOrigen: construirHuella(nuevo),
        estado: 'edicion_manual',
        progreso: { total: 1, aceptadas: 1 },
        textoSeguro: antes,
        propuestas: [],
        decisiones: {},
        textoAprobado: nuevo,
        advertencias: ['edición manual: auditoría detenida para este capítulo, puedes reauditar'],
        actualizado: Date.now(),
      });
      if (estado.auditor) estado.auditor.pausar();
      avisar('Editaste el capítulo: se guardó como aprobado y se pausó la auditoría. Recarga para reauditar.', 'info');
    }
    fijarTextoDeParte(estado.parteActual, nuevo);
  }

  function pintarIndice() {
    el.indiceLista.innerHTML = '';
    estado.partes.forEach((parte, i) => {
      const fila = document.createElement('li');
      const boton = document.createElement('button');
      boton.type = 'button';
      boton.className = 'pdf-cap';
      boton.dataset.cap = String(i);
      const situacion = progresoDeCapitulo(i, estado.progreso);
      boton.dataset.estado = situacion;
      if (i === estado.parteActual) boton.setAttribute('aria-current', 'true');

      const marca = document.createElement('span');
      marca.className = 'pdf-cap-marca';
      marca.setAttribute('aria-hidden', 'true');
      marca.textContent = situacion === 'leido' ? '✓' : String(i + 1);

      const titulo = document.createElement('span');
      titulo.className = 'pdf-cap-titulo';
      titulo.textContent = parte.titulo;

      const datos = document.createElement('span');
      datos.className = 'pdf-cap-datos';
      if (estado.traductor?.estaTraducido(i)) {
        const marcaTrad = document.createElement('span');
        marcaTrad.className = 'pdf-cap-traducido';
        marcaTrad.textContent = 'ES';
        marcaTrad.title = 'Ya traducido al español';
        datos.appendChild(marcaTrad);
      }
      const pagina = document.createElement('span');
      pagina.textContent = parte.pagina ? `pág. ${parte.pagina}` : '';
      datos.appendChild(pagina);

      /* Barra fina bajo el capítulo en curso: dice cuánto llevas DENTRO de
       * él. El ✓ solo aparece al terminarlo, así que sin esto un capítulo
       * largo se veía igual al empezarlo que al ir por el 90 %. */
      const avance = document.createElement('span');
      avance.className = 'pdf-cap-avance';
      avance.setAttribute('aria-hidden', 'true');
      const relleno = document.createElement('span');
      relleno.className = 'pdf-cap-avance-relleno';
      avance.appendChild(relleno);

      boton.append(marca, titulo, datos, avance);
      boton.addEventListener('click', () => {
        mostrarParte(i);
        cerrarHojas();
      });
      /* El texto accesible dice todo lo que el color y la marca cuentan. */
      boton.setAttribute('aria-label',
        `${parte.titulo}${parte.pagina ? `, página ${parte.pagina}` : ''}, ${
          { leido: 'leído', leyendo: 'leyendo ahora', pendiente: 'pendiente' }[situacion]}`);

      fila.appendChild(boton);
      el.indiceLista.appendChild(fila);
    });
    actualizarAvanceIndice();
  }

  /**
   * Refresca solo la barra del capítulo en curso.
   *
   * Se llama en cada latido de la lectura, y un libro puede tener cientos de
   * capítulos: repintar la lista entera cada segundo la dejaría a tirones. Lo
   * demás (el ✓, el estado) solo cambia al cambiar de capítulo, y de eso ya
   * se encarga pintarIndice.
   */
  function actualizarAvanceIndice() {
    if (!el.indiceLista.children.length) return;
    const dentro = Math.round(Math.max(0, Math.min(1, Number(estado.progreso?.desplazamiento) || 0)) * 100);
    const actual = el.indiceLista.querySelector(`.pdf-cap[data-cap="${estado.parteActual}"]`);
    if (actual) {
      const relleno = actual.querySelector('.pdf-cap-avance-relleno');
      if (relleno) relleno.style.width = `${dentro}%`;
    }
  }

  function cerrarIndice() {
    el.indice.hidden = true;
    el.btnIndice.setAttribute('aria-expanded', 'false');
  }

  /* ── Hojas del lector y botón «atrás» ─────────────────────────────
   *
   * Dos cosas que faltaban y que dejaban a la persona encerrada:
   *
   * 1. «Contenido» y «Opciones» se abrían sin fondo, sin botón de cerrar y
   *    sin reaccionar al toque fuera. La única salida era el botón atrás del
   *    teléfono, que cerraba la app entera y obligaba a empezar de nuevo.
   * 2. El lector tampoco registraba nada en el historial, así que atrás
   *    tampoco servía para volver a la biblioteca.
   *
   * Regla: **atrás cierra lo último que se abrió** — primero la hoja, luego
   * el libro, y solo entonces sale. Es lo que hace cualquier lector móvil.
   */
  /* La pila de capas vive en index.html y la comparten el lector, la ventana
   * grande y los modales: es lo que garantiza que un «atrás» cierre una sola
   * cosa. Si por lo que sea no está, el lector sigue funcionando sin el botón
   * atrás del teléfono (los botones de cerrar no dependen de ella). */
  const capas = (typeof window !== 'undefined' && window.jgCapas) || {
    abrir: () => {}, cerrar: () => false, hay: () => false,
  };

  const hayHojaAbierta = () => (!el.indice.hidden) || !!(el.masMenu && el.masMenu.open);

  function pintarFondoHojas() {
    if (!el.hojaFondo) return;
    el.hojaFondo.hidden = !hayHojaAbierta();
  }

  function cerrarHojas({ desdeHistorial = false } = {}) {
    if (!hayHojaAbierta()) { pintarFondoHojas(); return; }
    cerrarIndice();
    if (el.masMenu) el.masMenu.open = false;
    if (el.btnMas) el.btnMas.setAttribute('aria-expanded', 'false');
    pintarFondoHojas();
    if (!desdeHistorial) capas.cerrar('hoja');
  }

  function abrirHoja(cual) {
    /* Solo una hoja a la vez: dos capas superpuestas es justo lo que hacía
     * imposible saber dónde tocar para volver.
     *
     * El paso en el historial representa «hay una hoja abierta», no cada
     * hoja: si se pasa de Contenido a Opciones, sigue habiendo una sola, y
     * anotar dos obligaría a pulsar «atrás» dos veces para lo mismo. */
    const habiaOtra = cual === 'indice'
      ? !!(el.masMenu && el.masMenu.open)
      : !el.indice.hidden;
    cerrarIndice();
    if (el.masMenu) el.masMenu.open = false;
    if (cual === 'indice') {
      pintarIndice();
      el.indice.hidden = false;
      el.btnIndice.setAttribute('aria-expanded', 'true');
      /* Que el capítulo actual quede a la vista sin tener que buscarlo. */
      const actual = el.indiceLista.querySelector('[aria-current="true"]');
      if (actual) actual.scrollIntoView({ block: 'center' });
    } else if (el.masMenu) {
      el.masMenu.open = true;
      if (el.btnMas) el.btnMas.setAttribute('aria-expanded', 'true');
      if (el.masPanel) el.masPanel.scrollTop = 0;
    }
    pintarFondoHojas();
    if (!habiaOtra) capas.abrir('hoja', () => cerrarHojas({ desdeHistorial: true }));
  }

  /* Palabras por minuto de una lectura tranquila. Es una media, no una
   * medición: por eso lo que se muestra siempre lleva «~». */
  const PALABRAS_POR_MINUTO = 200;

  /** «quedan ~8 min» de lo que falta del capítulo que se está leyendo. */
  function minutosRestantes() {
    const texto = textoDeParte(estado.parteActual) || '';
    if (!texto.trim()) return '';
    const restante = Math.max(0, 1 - (Number(estado.progreso?.desplazamiento) || 0));
    const palabras = texto.trim().split(/\s+/).length * restante;
    const minutos = Math.round(palabras / PALABRAS_POR_MINUTO);
    if (minutos < 1) return 'menos de 1 min';
    if (minutos < 60) return `~${minutos} min`;
    const horas = Math.floor(minutos / 60);
    const resto = minutos % 60;
    return resto ? `~${horas} h ${resto} min` : `~${horas} h`;
  }

  function actualizarBarraDoc() {
    const porcentaje = calcularPorcentaje(estado.progreso, estado.partes);
    el.barraRelleno.style.width = `${porcentaje}%`;
    el.barraDoc.setAttribute('aria-valuenow', String(porcentaje));
    const varias = estado.partes.length > 1;
    /* Las tres cosas que se preguntan al abrir un libro: dónde voy, cuánto
     * llevo y cuánto me falta. El título del capítulo no va aquí: ya está en
     * el índice y en la barra de capítulos, y en un celular solo empujaba
     * fuera lo demás. */
    const falta = minutosRestantes();
    const trozos = [];
    if (varias) trozos.push(`Cap. ${estado.parteActual + 1} de ${estado.partes.length}`);
    trozos.push(`${porcentaje} % leído`);
    if (falta) trozos.push(`quedan ${falta}`);
    el.donde.textContent = trozos.join(' · ');
    el.donde.title = varias
      ? `${estado.partes[estado.parteActual]?.titulo || ''} — ${trozos.join(' · ')}`
      : trozos.join(' · ');
    if (varias) {
      el.navPos.textContent = `${estado.parteActual + 1} de ${estado.partes.length}`;
      el.prev.disabled = estado.parteActual === 0;
      el.next.disabled = estado.parteActual >= estado.partes.length - 1;
    }
    if (el.capPrev) el.capPrev.disabled = estado.parteActual <= 0;
    if (el.capNext) el.capNext.disabled = estado.parteActual + 1 >= estado.partes.length;
    el.navbar.hidden = !varias;
    if (el.audiolibroBox) el.audiolibroBox.hidden = !varias;
    if (el.resumenTodo) el.resumenTodo.hidden = !varias;
    /* El CSS de escritorio usa esto para no reservar la columna del índice
     * cuando el documento es de una sola pieza. */
    el.resultArea.dataset.varias = varias ? 'si' : 'no';
    actualizarAvanceIndice();
  }

  let temporizadorGuardado = null;
  function guardarProgresoPronto() {
    clearTimeout(temporizadorGuardado);
    temporizadorGuardado = setTimeout(() => {
      if (!estado.id) return;
      almacen.guardarProgreso(estado.id, estado.progreso, estado.partes);
    }, ESPERA_GUARDADO_MS);
  }

  /** Fracción desplazada dentro del capítulo (se conserva por compatibilidad). */
  function desplazamientoActual() {
    const alto = el.salida.scrollHeight - el.salida.clientHeight;
    if (alto <= 0) return 0;
    return Math.max(0, Math.min(1, el.salida.scrollTop / alto));
  }

  /**
   * Carácter que está arriba del todo en la pantalla.
   *
   * Un <textarea> no dice qué carácter se ve, así que se estima por la
   * proporción desplazada y luego se ajusta al comienzo de la frase más
   * cercana: aterrizar a mitad de una frase se siente como un error, y
   * empezar la frase de nuevo se siente natural.
   */
  function caracterVisible() {
    if (enModoLectura() && libroVista && libroVista.caracterVisible) return libroVista.caracterVisible();
    const texto = el.salida.value || '';
    if (!texto) return 0;
    const bruto = Math.round(desplazamientoActual() * texto.length);
    const frases = partirEnFrases(texto);
    if (!frases.length) return Math.max(0, Math.min(texto.length, bruto));
    const rango = fraseEn(frases, Math.max(0, Math.min(texto.length - 1, bruto)));
    return rango ? rango[0] : bruto;
  }

  /**
   * Lleva la vista a un carácter del texto.
   *
   * Se mide sobre `el.realce`, la capa gemela que ya existe para resaltar la
   * frase que suena: tiene el mismo texto, la misma tipografía y los mismos
   * márgenes que el textarea, pero sus nodos SÍ se pueden medir. Sin ella
   * habría que adivinar.
   */
  function irAPosicion(caracter, { centrar = true } = {}) {
    const texto = el.salida.value || '';
    /* En modo lectura el textarea está oculto: medirlo devuelve ceros y la
     * vista se quedaba arriba. Se desplaza el contenedor que de verdad se ve. */
    if (enModoLectura() && libroVista && libroVista.irACaracter) {
      libroVista.irACaracter(Math.max(0, Math.floor(Number(caracter) || 0)));
      return;
    }
    if (!texto) return;
    const pos = Math.max(0, Math.min(texto.length, Math.floor(Number(caracter) || 0)));
    const alto = el.salida.scrollHeight - el.salida.clientHeight;
    if (alto <= 0) return;

    let destino = null;
    if (el.realce) {
      /* Se pinta el texto partido en el punto buscado y se mide dónde cae. */
      const marca = document.createElement('span');
      marca.textContent = '\u200b';           /* invisible, pero ocupa una posición */
      el.realce.textContent = '';
      el.realce.append(
        document.createTextNode(texto.slice(0, pos)),
        marca,
        document.createTextNode(texto.slice(pos)),
      );
      destino = marca.offsetTop - (centrar ? el.salida.clientHeight * 0.30 : 0);
      /* La guía se limpia: quien la necesite la volverá a pintar. */
      limpiarGuia();
    }
    if (destino == null) destino = alto * (pos / Math.max(1, texto.length));
    el.salida.scrollTop = Math.max(0, Math.min(alto, destino));
    sincronizarRealce();
  }

  /**
   * Restaura la posición guardada del capítulo abierto.
   *
   * Se llama en cada momento en que el texto del textarea se reemplaza (montar,
   * pulir, traducir, volver al original): reemplazar el contenido de un
   * <textarea> lo devuelve al principio, y ese era el motivo por el que un
   * libro «volvía a empezar el capítulo» al reabrirlo.
   *
   * Se intenta en dos tiempos porque la primera vez el navegador todavía no ha
   * terminado de maquetar y `scrollHeight` aún no es el definitivo.
   */
  function restaurarPosicionGuardada() {
    const progreso = estado.progreso;
    if (!progreso) return;
    const aplicar = () => {
      const texto = el.salida.value || '';
      if (!texto) return;
      if (progreso.cita || progreso.caracter) {
        irAPosicion(resolverAncla(texto, progreso));
      } else {
        /* Documento guardado antes de esta versión: solo hay la fracción. */
        const alto = el.salida.scrollHeight - el.salida.clientHeight;
        if (alto > 0) el.salida.scrollTop = alto * Math.max(0, Math.min(1, progreso.desplazamiento || 0));
      }
    };
    requestAnimationFrame(() => {
      aplicar();
      /* Segundo intento tras la maquetación real (fuentes, imágenes, envolturas). */
      setTimeout(aplicar, 120);
    });
  }

  function anotarPosicion({ desplazamiento, caracter } = {}) {
    const texto = el.salida.value || '';
    /* Si quien llama sabe el carácter exacto (la voz lo sabe), se usa; si no,
     * se deduce de la pantalla. */
    const punto = caracter != null ? caracter : caracterVisible();
    const ancla = construirAncla(texto, punto);
    estado.progreso = avanzarProgreso(estado.progreso, {
      parte: estado.parteActual,
      desplazamiento: desplazamiento != null ? desplazamiento : desplazamientoActual(),
      caracter: ancla.caracter,
      cita: ancla.cita,
      antes: ancla.antes,
    });
    actualizarBarraDoc();
    guardarProgresoPronto();
  }

  async function mostrarParte(indice, { seleccionar = null, desplazamiento = 0 } = {}) {
    if (!hayDocumento()) return;
    const nuevo = Math.max(0, Math.min(indice, estado.partes.length - 1));
    /* ¿Estamos volviendo al capítulo que el progreso dice que se estaba
     * leyendo? Solo entonces hay una posición guardada que respetar. */
    const indiceEsElGuardado = nuevo === (estado.progreso?.parte ?? -1);
    if (nuevo !== estado.parteActual) guardarEdicionActual();
    estado.parteActual = nuevo;

    /* Al moverse de capítulo, la auditoría pendiente pasa a atender primero
     * este capítulo y el siguiente: lo que se está leyendo manda. */
    if (estado.auditor && estado.consentido && estado.bloques.length) {
      estado.auditor.repriorizar(idsBloquesDeCapitulos([nuevo, nuevo + 1]));
    }
    actualizarBotonRevision();
    if (el.revisionHoja && !el.revisionHoja.hidden) pintarRevision();

    el.salida.value = textoDeParte(nuevo);
    /* El resalte pertenece al capítulo anterior: se borra antes de repintar
     * para que no se quede una frase marcada donde ya no corresponde. */
    limpiarGuia();
    el.salida.dispatchEvent(new Event('input', { bubbles: true }));
    actualizarContador();

    /* Restaurar el punto exacto donde se quedó la lectura. */
    estado.progreso = avanzarProgreso(estado.progreso, {
      parte: nuevo,
      desplazamiento,
      /* Al llegar a un capítulo nuevo (no al reabrir el que se leía) no hay
       * ancla que conservar: se entra por el principio. */
      ...(indiceEsElGuardado ? {} : { caracter: 0, cita: '', antes: '' }),
    });
    restaurarPosicionGuardada();
    actualizarBarraDoc();
    pintarIndice();
    guardarProgresoPronto();

    if (seleccionar) {
      try {
        el.salida.focus({ preventScroll: true });
        el.salida.setSelectionRange(seleccionar.desde, seleccionar.hasta);
        const proporcion = seleccionar.desde / Math.max(1, el.salida.value.length);
        el.salida.scrollTop = Math.max(0, el.salida.scrollHeight * proporcion - el.salida.clientHeight / 2);
      } catch (_) { /* la selección es un extra */ }
    }

    /* Si se está leyendo en español, preparar este capítulo y el siguiente. */
    if (estado.vista === 'es') await asegurarTraduccion(nuevo, { mostrar: true });
    else if (estado.pulidoActivo) asegurarPulido(nuevo, { mostrar: true }).catch(() => {});
  }

  function abrirLector() {
    const nuevo = !(el.area && el.area.classList.contains('has-results'));
    if (el.area) el.area.classList.add('has-results');
    el.resultArea.style.display = '';
    if (el.ocrBox) el.ocrBox.hidden = true;
    /* Modo lectura: el CSS aparta el encabezado y las pestañas de la app en
     * celular y tablet. Son ~120 px que pasan al texto. */
    document.body.classList.add('jg-leyendo');
    /* La pantalla completa de escritorio se recuerda, pero solo mientras hay
     * un libro abierto: en la biblioteca haría falta el encabezado. */
    if (pantallaGuardada()) fijarPantallaCompleta(true);
    if (el.notice) el.notice.hidden = true;
    if (nuevo) capas.abrir('lector', () => volverABiblioteca({ desdeHistorial: true }));
  }

  function cerrarDocumento({ desdeHistorial = false } = {}) {
    /* Cerrar el lector cierra también la hoja que estuviera encima: la pila
     * de capas retira las dos de un salto para no dejar entradas huérfanas
     * en el historial. */
    cerrarHojas({ desdeHistorial: true });
    cerrarHojaAuditoria(null);
    if (!desdeHistorial) capas.cerrar('lector');
    document.body.classList.remove('jg-leyendo');
    document.body.classList.remove('jg-pantalla');
    /* El temporizador es de esta sesión de escucha: al salir del libro no
     * tiene sentido que siga corriendo contra el siguiente. */
    pararTemporizadorDormir();
    dormir.modo = '0';
    if (el.dormir) el.dormir.value = '0';
    pintarDormir();
    if (el.noticeLector) el.noticeLector.hidden = true;
    if (el.buscarFila) el.buscarFila.hidden = true;
    if (el.buscarToggle) el.buscarToggle.setAttribute('aria-expanded', 'false');
    detenerAudiolibro();
    guardarEdicionActual();
    clearTimeout(estado.temporizadorReanudar);
    if (estado.id && estado.auditor) { try { estado.auditor.pausar(); } catch(_){} }
    estado.id = '';
    estado.partes = [];
    estado.bloques = [];
    estado.bloquesEstructurales = [];
    estado.omisiones = [];
    estado.traducido = new Map();
    estado.pulido = new Map();
    estado.pulidor = null;
    estado.auditor = null;
    estado.consentido = false;
    estado.auditoriaEstado = 'Solo local';
    estado.auditoriaProgreso = { total: 0, completados: 0, fallos: 0 };
    estado.correccionProgreso.token += 1;
    estado.correccionProgreso = { total: 0, completados: 0, fallos: 0, ejecutando: false, token: estado.correccionProgreso.token };
    estado.colaCorreccion = null;
    if (el.reanudarCorreccion) el.reanudarCorreccion.hidden = true;
    estado.textoAprobadoPorBloque = new Map();
    estado.textoSeguroPorBloque = new Map();
    estado.propuestasPorBloque = new Map();
    estado.decisionesPorBloque = new Map();
    estado.traductor = null;
    estado.vista = 'original';
    estado.parteActual = 0;
    el.salida.value = '';
    limpiarGuia();
    el.salida.dispatchEvent(new Event('input', { bubbles: true }));
    el.resultArea.style.display = 'none';
    el.tradBar.hidden = true;
    if (el.pulidoCambio) el.pulidoCambio.hidden = true;
    if (el.revisionHoja) el.revisionHoja.hidden = true;
    if (el.revisionBtn) el.revisionBtn.hidden = true;
    if (el.docTapa) { el.docTapa.hidden = true; el.docTapa.style.backgroundImage = ''; el.docTapa.title = ''; }
    el.askAnswer.hidden = true;
    el.askClear.hidden = true;
    if (el.masMenu) el.masMenu.open = false;
    cerrarIndice();
    if (el.area) el.area.classList.remove('has-results');
  }

  /** Deja el documento en pantalla, listo para leer desde donde iba. */
  async function montarDocumento({ id, titulo, partes, totalPaginas, idioma, progreso, capitulos, bloques, fuenteRevision }) {
    estado.id = id;
    estado.titulo = titulo;
    estado.partes = partes;
    // Fuente inmutable: lo extraído del PDF. La corrección genera una
    // revisión derivada y nunca la reemplaza.
    try {
      estado.fuenteTexto = componerLibroDesdePartes(partes);
      estado.fuenteRevision = fuenteRevision || sha256Hex(estado.fuenteTexto);
      estado.revisionLectura = sha256Hex(estado.fuenteTexto);
    } catch (_) {
      estado.fuenteTexto = '';
      estado.fuenteRevision = '';
      estado.revisionLectura = '';
    }
    estado.guardadoConfirmado = false;
    estado.correccionPausada = false;
    estado.correccionProgreso.etapa = '';
    estado.totalPaginas = totalPaginas || 0;
    estado.idioma = idioma || 'es';
    estado.progreso = progreso || progresoInicial();
    estado.traducido = new Map();
    estado.pulido = new Map();
    estado.vista = 'original';
    estado.busqueda = { termino: '', golpes: [], indice: -1 };
    /* Reanudación de auditoría: los bloques vienen del procesado reciente o,
     * al reabrir un libro guardado, de lo persistido; si no hay nada, se
     * reconstruyen desde el texto. Con esto la cola puede seguir donde iba. */
    estado.bloques = Array.isArray(bloques) && bloques.length
      ? bloques
      : (await almacen.cargarBloquesDocumento(id))
        || construirBloquesAuditoria(partes.map((p) => p.texto).join('\n\n'), [], capitulos || []);
    estado.auditoriaProgreso = { total: estado.bloques.length, completados: 0, fallos: 0 };
    el.buscar.value = '';
    el.buscarInfo.textContent = '';
    el.titulo.textContent = titulo || 'Documento';
    el.titulo.title = titulo || '';
    // Portada siempre visible en lector (móvil, tablet y escritorio) si existe
    if (el.docTapa) {
      el.docTapa.hidden = true;
      el.docTapa.style.backgroundImage = '';
      el.docTapa.title = titulo || '';
      // Cargar portada sin bloquear la apertura del texto
      almacen.cargarPortada(id).then((blob) => {
        if (!blob || !el.docTapa) return;
        const url = URL.createObjectURL(blob);
        estado.urlsPortada.push(url);
        el.docTapa.style.backgroundImage = `url("${url}")`;
        el.docTapa.hidden = false;
        el.docTapa.title = titulo || 'Portada del libro';
      }).catch(() => {});
    }

    prepararPulidor();
    prepararTraduccion();
    abrirLector();
    await mostrarParte(estado.progreso.parte || 0, {
      desplazamiento: estado.progreso.desplazamiento || 0,
    });
    /* Decirle a la persona que la app se acordó de dónde iba. Se retira solo:
     * es una confirmación, no un cartel permanente. */
    if (el.reanudar && el.reanudarTxt) {
      const frase = etiquetaReanudar(estado.progreso, estado.partes);
      el.reanudar.hidden = !frase;
      el.reanudarTxt.textContent = frase;
      if (frase) {
        clearTimeout(estado.temporizadorReanudar);
        estado.temporizadorReanudar = setTimeout(() => {
          if (el.reanudar) el.reanudar.hidden = true;
        }, 9000);
      }
    }
    if (estado.pulidoActivo && estado.vista === 'original' && estado.consentido) {
      iniciarCorreccionLibro().catch(() => {});
    }
  }

  /**
   * Rehace las unidades de lectura de un libro que ya estaba guardado.
   *
   * Las partes se trocean **al procesar el PDF** y se guardan así para
   * siempre. Cuando se arregló el troceo (v2.31.0), los libros que ya estaban
   * en la biblioteca siguieron mostrando los cortes viejos: capítulos vacíos,
   * varios con el mismo número de página y palabras partidas entre dos
   * unidades. Arreglar el troceo no bastaba; había que rehacer lo guardado.
   *
   * Se vuelve a leer el PDF original guardado, porque es la única fuente que
   * todavía sabe que «es» y «ta» eran una sola palabra. Si el archivo ya no
   * existe, se conserva el texto disponible sin adivinar uniones. El progreso
   * se relocaliza mediante una ancla de texto.
   *
   * @returns {Promise<{partes:object[],capitulos:object[],progreso:object,bloques:object[]}|null>}
   */
  function reconstruirPartesGuardadas(partes) {
    let texto = '';
    const capitulos = [];
    for (const parte of partes || []) {
      const trozo = String(parte?.texto || '').trim();
      if (!trozo) continue;
      let separador = texto ? '\n\n' : '';
      if (texto) {
        const ultima = texto.match(/([A-Za-zÁÉÍÓÚÜÑáéíóúüñ]+)[-‐­‑]?$/)?.[1] || '';
        const primera = trozo.match(/^([a-záéíóúüñ]+)/)?.[1] || '';
        if (/[-‐­‑]$/.test(texto) && primera) {
          texto = texto.replace(/[-‐­‑]$/, '');
          separador = '';
        } else if (ultima && primera) {
          /* Sin el PDF original no hay evidencia para decidir si dos sílabas
           * eran una palabra o dos palabras reales. Se conserva el contenido
           * y se evita inventar una unión. */
          separador = ' ';
        }
      }
      const posicion = texto.length + separador.length;
      texto += separador + trozo;
      capitulos.push({
        titulo: parte?.titulo || 'Parte',
        pagina: parte?.pagina || 1,
        posicion,
      });
    }
    return { texto, capitulos };
  }

  function reubicarProgreso(progreso, anteriores, nuevas) {
    const base = progreso || progresoInicial();
    if (!anteriores?.length || !nuevas?.length) return base;
    const unir = (lista) => lista.map((p) => String(p?.texto || '')).join('\n\n');
    const textoAnterior = unir(anteriores);
    const textoNuevo = unir(nuevas);
    if (!textoAnterior || !textoNuevo) return base;

    const indiceAnterior = Math.max(0, Math.min(anteriores.length - 1, Number(base.parte) || 0));
    let absolutoAnterior = 0;
    for (let i = 0; i < indiceAnterior; i += 1) absolutoAnterior += String(anteriores[i]?.texto || '').length + 2;
    absolutoAnterior += resolverAncla(String(anteriores[indiceAnterior]?.texto || ''), base);
    const anclaGlobal = construirAncla(textoAnterior, absolutoAnterior);
    const absolutoNuevo = resolverAncla(textoNuevo, anclaGlobal);

    let inicio = 0;
    let parte = nuevas.length - 1;
    for (let i = 0; i < nuevas.length; i += 1) {
      const fin = inicio + String(nuevas[i]?.texto || '').length;
      if (absolutoNuevo <= fin) { parte = i; break; }
      inicio = fin + 2;
    }
    const textoParte = String(nuevas[parte]?.texto || '');
    const caracter = Math.max(0, Math.min(textoParte.length, absolutoNuevo - inicio));
    const anclaLocal = construirAncla(textoParte, caracter);

    /* maxParte es un hito de avance, no la posición actual. Se conserva por
     * proporción para que reorganizar preliminares no devuelva capítulos a
     * «pendiente». */
    const maxAnterior = Math.max(indiceAnterior, Math.min(anteriores.length - 1, Number(base.maxParte) || 0));
    const proporcionMax = anteriores.length <= 1 ? 0 : maxAnterior / (anteriores.length - 1);
    const maxParte = Math.max(parte, Math.round(proporcionMax * Math.max(0, nuevas.length - 1)));
    return {
      ...base,
      parte,
      caracter: anclaLocal.caracter,
      cita: anclaLocal.cita,
      antes: anclaLocal.antes,
      desplazamiento: textoParte.length ? caracter / textoParte.length : 0,
      maxParte,
    };
  }

  async function rehacerTroceo(doc, partes) {
    if (!Array.isArray(partes) || !partes.length) return null;
    const plan = planMigracionV6({
      versionTroceo: doc.versionTroceo,
      versionReconstruccion: doc.versionReconstruccion,
      tieneArchivo: doc.tieneArchivo,
      manifiesto: doc.manifiesto,
      tieneAprobado: Boolean(doc.tieneAprobado),
    });

    const archivo = await almacen.cargarArchivo(doc.id);
    if (archivo && (plan.accion === 'reextraer' || plan.accion === 'capa_nueva')) {
      try {
        const resultado = await procesarPdf(archivo, { conPortada: false });
        if (!resultado.cancelado && !resultado.escaneado && resultado.texto?.trim()) {
          const capitulos = prepararCapitulosLectura(resultado.texto, resultado.capitulos);
          const nuevas = partirTexto(resultado.texto, capitulos, resultado.paginas, [], {
            bloques: resultado.bloquesLectura || resultado.bloques,
            limites: resultado.limites,
            atomos: resultado.atomos,
            offsetDeAtomo: resultado.offsetDeAtomo,
          });
          if (nuevas.length) {
            return {
              partes: nuevas,
              capitulos,
              progreso: reubicarProgreso(doc.progreso, partes, nuevas),
              bloques: construirBloquesAuditoria(resultado.texto, resultado.bloques, capitulos),
              reconstruccion: serializarReconstruccion(resultado),
              pendientesLimites: resultado.pendientes || 0,
              capaNueva: plan.accion === 'capa_nueva',
              resultado,
            };
          }
        }
      } catch (error) {
        console.warn('[jg-pdf] no se pudo reprocesar el PDF guardado; se usará el texto local', error);
      }
    }

    if (plan.accion === 'needs_source' || (!archivo && plan.accion !== 'reconstruir')) {
      const reconstruido = reconstruirPartesGuardadas(partes);
      if (!reconstruido.texto.trim()) return { needsSource: true, partes, capitulos: doc.capitulos || [] };
      return {
        partes,
        capitulos: doc.capitulos || reconstruido.capitulos,
        progreso: doc.progreso,
        bloques: [],
        needsSource: true,
      };
    }

    const reconstruido = reconstruirPartesGuardadas(partes);
    if (!reconstruido.texto.trim()) return null;
    const capitulos = prepararCapitulosLectura(reconstruido.texto, reconstruido.capitulos);
    const nuevas = partirTexto(reconstruido.texto, capitulos, []);
    if (!nuevas.length) return null;
    return {
      partes: nuevas,
      capitulos,
      progreso: reubicarProgreso(doc.progreso, partes, nuevas),
      bloques: construirBloquesAuditoria(reconstruido.texto, [], capitulos),
    };
  }

  async function abrirDocumento(id) {
    const doc = await almacen.cargarDocumento(id);
    let partes = await almacen.cargarContenido(id);
    if (!doc || !partes || !partes.length) {
      avisar('Ese documento ya no está guardado.', 'warn');
      refrescarInicio();
      return;
    }

    /* Libros guardados con el troceo antiguo: se rehacen una vez y queda
     * anotado, para no repetirlo en cada apertura. */
    let capitulos = doc.capitulos || [];
    let progreso = doc.progreso;
    let bloquesRehechos = null;
    if (doc.versionTroceo !== VERSION_TROCEO || doc.versionReconstruccion !== VERSION_RECONSTRUCCION) {
      avisar('Reconstruyendo el libro para unir palabras partidas…', 'info');
      const rehecho = await rehacerTroceo(doc, partes);
      if (rehecho?.needsSource) {
        estado.needsSource = true;
        avisar('Necesita reimportar el PDF o una revisión manual de los límites pendientes.', 'warn');
        await almacen.marcarTroceo(id, VERSION_TROCEO, {
          partes: rehecho.partes || partes,
          capitulos: rehecho.capitulos || capitulos,
          progreso,
          needsSource: true,
        });
      } else if (rehecho) {
        if (rehecho.capaNueva) {
          avisar('Se reconstruyó una capa nueva; el texto que ya habías aprobado se conserva.', 'info', { efimero: true });
        } else {
          partes = rehecho.partes;
          capitulos = rehecho.capitulos;
          progreso = rehecho.progreso;
          bloquesRehechos = rehecho.bloques;
          avisar('Se reorganizó el libro sin cortar palabras ni párrafos.', 'info', { efimero: true });
        }
        await almacen.marcarTroceo(id, VERSION_TROCEO, {
          partes,
          capitulos,
          progreso,
          bloques: rehecho.bloques,
          versionReconstruccion: VERSION_RECONSTRUCCION,
          pendientesLimites: rehecho.pendientesLimites || 0,
          reconstruccion: rehecho.reconstruccion,
        });
      } else {
        await almacen.marcarTroceo(id, VERSION_TROCEO, null);
      }
    }

    estado.archivo = null;
    await montarDocumento({
      id: doc.id,
      titulo: doc.titulo,
      partes,
      totalPaginas: doc.totalPaginas,
      idioma: doc.idioma,
      progreso,
      capitulos,
      bloques: bloquesRehechos,
      fuenteRevision: doc.fuenteRevision || '',
    });
    avisar('');
    el.resultArea.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }

  /* ── Pulido con IA — ahora auditoría segura con 4 capas ─────────────
   * capas: original (inmutable), local (pulirParaLectura), revisadoSeguro (signos IA), aprobado (propuestas aceptadas)
   * El texto enviado a IA requiere consentimiento explícito por PDF.
   */

  function actualizarSwitchPulido() {
    if (el.verSinPulir) el.verSinPulir.classList.toggle('is-on', !estado.pulidoActivo);
    if (el.verPulido) el.verPulido.classList.toggle('is-on', !!estado.pulidoActivo);
  }

  let temporizadorPulidoEstado = null;
  function mostrarPulidoEstado(texto, tipo = '') {
    if (!el.pulidoEstado) return;
    clearTimeout(temporizadorPulidoEstado);
    el.pulidoEstado.textContent = texto;
    el.pulidoEstado.hidden = false;
    if (tipo) el.pulidoEstado.dataset.estado = tipo;
    else el.pulidoEstado.removeAttribute('data-estado');
  }
  function ocultarPulidoEstado(ms = 2800) {
    if (!el.pulidoEstado) return;
    clearTimeout(temporizadorPulidoEstado);
    temporizadorPulidoEstado = setTimeout(() => {
      if (el.pulidoEstado) el.pulidoEstado.hidden = true;
    }, ms);
  }
  if (typeof window !== 'undefined') window.jgMostrarPulidoEstado = mostrarPulidoEstado;
  if (typeof window !== 'undefined') {
    window.jgPdfContexto = () => {
      if (!hayDocumento() || estado.partes.length <= 1) return '';
      return `Cap. ${estado.parteActual + 1}/${estado.partes.length}`;
    };
  }

  function actualizarEstadoAuditoria() {
    const total = estado.auditoriaProgreso.total || estado.bloques.length || 0;
    const comp = estado.auditoriaProgreso.completados || 0;
    const fallos = estado.auditoriaProgreso.fallos || 0;
    /* Cuántas sugerencias esperan decisión: solo así el indicador puede decir
     * la verdad en vez de «cambios por revisar» siempre. */
    let pendientesRevision = 0;
    for (const [, lista] of estado.propuestasPorBloque || []) {
      pendientesRevision += Array.isArray(lista) ? lista.length : 0;
    }
    for (const [, decs] of estado.decisionesPorBloque || []) {
      pendientesRevision -= decs ? decs.size : 0;
    }
    pendientesRevision = Math.max(0, pendientesRevision);

    const est = estadoAuditoriaTexto(total, comp, fallos, total - comp, estado.consentido,
      comp >= total ? pendientesRevision : null);
    estado.auditoriaEstado = est;
    if (estado.consentido === false && total > 0) estado.auditoriaEstado = 'Esperando permiso';
    else if (!estado.bloques.length) estado.auditoriaEstado = 'Solo local';
    /* Esta auditoría produce signos seguros y sugerencias editoriales. Ya no
     * ocupa el indicador principal: ese indicador pertenece a la corrección
     * de lectura que realmente une palabras partidas. */
    actualizarBotonRevision();
  }

  function actualizarEstadoCorreccion() {
    const p = estado.correccionProgreso;
    const cola = estado.colaCorreccion;
    const r = cola ? resumenCola(cola) : null;
    const etapa = p.etapa || '';
    const texto = cola
      ? etiquetaColaCorreccion(cola, { ejecutando: p.ejecutando, consentido: estado.consentido, etapa })
      : (etapa ? etapa + ' · ' + estadoCorreccionLecturaTexto(p.total, p.completados, p.fallos, estado.consentido) : estadoCorreccionLecturaTexto(p.total, p.completados, p.fallos, estado.consentido));
    const incompletas = r ? (r.pendientes + r.fallos) : p.fallos;
    const pendientesLimites = (estado.limites || []).filter((l) => l?.decision === 'pending').length;
    const chequeoLibro = cola ? colaListaParaLibro(cola, {
      pendientesLimites,
      integridadOk: true,
      guardadoOk: estado.guardadoConfirmado,
    }) : { lista: false };
    const lista = r
      ? (chequeoLibro.lista && !p.ejecutando)
      : (!p.ejecutando && p.total > 0 && p.fallos === 0 && p.completados >= p.total && pendientesLimites === 0);
    if (incompletas > 0) mostrarPulidoEstado(texto, p.ejecutando ? '' : 'pendiente');
    else mostrarPulidoEstado(texto, lista ? 'ok' : '');
    const mostrarReanudar = !!(cola && !p.ejecutando && estado.consentido && r && !r.lista && incompletas > 0);
    if (el.reanudarCorreccion) {
      el.reanudarCorreccion.hidden = !mostrarReanudar;
      if (el.reanudarCorreccionTxt) el.reanudarCorreccionTxt.textContent = texto;
    }
  }

  /**
   * Pide permiso para enviar el texto a la IA, explicando de verdad qué pasa.
   *
   * Antes era un `window.confirm` con un párrafo dentro: bloqueante, feo en
   * celular, y sin espacio para explicar qué se envía y qué no. Ahora es una
   * hoja de la propia app, con el mismo aspecto que el resto.
   */
  let resolverConsentimientoAuditoria = null;
  let colaLista = Promise.resolve();

  function cerrarHojaAuditoria(decision = null) {
    if (!el.auditoriaHoja) return;
    const estabaEsperando = typeof resolverConsentimientoAuditoria === 'function';
    /* Cerrar la primera solicitud equivale a no autorizar. Al cerrar una hoja
     * reabierta solo se oculta la explicación y se conserva la decisión. */
    if (decision == null && estabaEsperando) decision = false;
    el.auditoriaHoja.hidden = true;

    if (decision != null) {
      estado.consentido = !!decision;
      try { localStorage.setItem(`jg_pdf_consent_${estado.id}`, decision ? '1' : '0'); } catch (_) {}
      if (!decision) {
        estado.correccionProgreso.token += 1;
        estado.correccionProgreso.ejecutando = false;
        if (estado.auditor) estado.auditor.pausar();
        mostrarPulidoEstado('Solo local', 'mecanico');
      } else {
        mostrarPulidoEstado('Preparando corrección de lectura…', '');
      }
    }

    const resolver = resolverConsentimientoAuditoria;
    resolverConsentimientoAuditoria = null;
    if (resolver) resolver(decision === true);
    if (decision === true) setTimeout(() => iniciarCorreccionLibro(), 0);
  }

  function pedirConsentimientoAuditoria() {
    if (estado.consentido) return Promise.resolve(true);
    if (!el.auditoriaHoja) {
      /* Sin la hoja (HTML antiguo en caché), no se envía nada: ante la duda,
       * la opción segura es no mandar el texto a ningún sitio. */
      return Promise.resolve(false);
    }
    const prov = (typeof window.jgCfgGet === 'function' ? window.jgCfgGet('jg_provider', 'gemini') : deps.provider || 'gemini');
    if (el.auditoriaProveedor) el.auditoriaProveedor.textContent = prov;

    return new Promise((resolver) => {
      resolverConsentimientoAuditoria = resolver;
      el.auditoriaHoja.hidden = false;
      el.auditoriaAceptar.focus();
    });
  }

  if (el.auditoriaAceptar) el.auditoriaAceptar.addEventListener('click', () => cerrarHojaAuditoria(true));
  if (el.auditoriaRechazar) el.auditoriaRechazar.addEventListener('click', () => cerrarHojaAuditoria(false));
  if (el.auditoriaCerrar) el.auditoriaCerrar.addEventListener('click', () => cerrarHojaAuditoria(null));
  if (el.btnReanudarCorreccion) {
    el.btnReanudarCorreccion.addEventListener('click', () => {
      iniciarCorreccionLibro({ reanudar: true }).catch(() => {});
    });
  }
  if (el.auditoriaHoja) el.auditoriaHoja.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.preventDefault(); cerrarHojaAuditoria(null); }
  });

  /* El chip del estado explica qué hace la revisión: pulsarlo reabre la hoja. */
  if (el.pulidoEstado) {
    const reabrirAuditoria = () => {
      if (!el.auditoriaHoja) return;
      el.auditoriaHoja.hidden = false;
      if (el.auditoriaProveedor && typeof window.jgCfgGet === 'function') {
        el.auditoriaProveedor.textContent = window.jgCfgGet('jg_provider', 'gemini');
      }
    };
    el.pulidoEstado.addEventListener('click', reabrirAuditoria);
    el.pulidoEstado.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); reabrirAuditoria(); }
    });
  }

  function prepararPulidor() {
    if (el.pulidoCambio) el.pulidoCambio.hidden = true;
    if (el.pulidoEstado) el.pulidoEstado.hidden = true;
    estado.pulido = new Map();
    estado.textoSeguroPorBloque = new Map();
    estado.propuestasPorBloque = new Map();
    estado.decisionesPorBloque = new Map();
    estado.textoAprobadoPorBloque = new Map();
    estado.auditoriaProgreso = { total: 0, completados: 0, fallos: 0 };
    estado.correccionProgreso.token += 1;
    estado.correccionProgreso = {
      total: estado.partes.length,
      completados: 0,
      fallos: 0,
      ejecutando: false,
      token: estado.correccionProgreso.token,
    };
    estado.colaCorreccion = null;
    // consentimiento previo por documento
    try {
      const v = localStorage.getItem(`jg_pdf_consent_${estado.id}`);
      estado.consentido = v === '1';
      if (v === '0') estado.consentido = false;
      else if (v == null) estado.consentido = false;
    } catch (_) { estado.consentido = false; }

    // Cargar pulidos legados v3 y auditoría v4
    estado.pulidor = crearPulidor({
      pulir: async (texto, opciones) => {
        // modo legacy lectura: mantener para compatibilidad pero sin IA si no hay consentimiento
        if (!estado.consentido) return texto;
        if (typeof window.jgPulirTextoDetallado === 'function') {
          const res = await window.jgPulirTextoDetallado(texto, estado.idioma, opciones);
          /* Antes, un error de red devolvía el original y se guardaba como si
           * hubiese sido revisado. Debe quedar pendiente para poder reintentar. */
          if (opciones?.mode === 'lectura' && (!res?.ia_used || Number(res?.bloques_fallidos) > 0)) {
            throw new Error('La IA no confirmó la revisión');
          }
          return res.text;
        }
        if (deps.pulirTexto) return await deps.pulirTexto(texto, opciones);
        return texto;
      },
      guardar: (indice, texto) => {
        const fuente = estado.partes[indice]?.texto || '';
        return almacen.guardarPulidoEstructurado(estado.id, indice, {
          version: VERSION_PULIDO_LECTURA,
          huellaOrigen: construirHuella(fuente),
          estado: 'lectura_segura',
          textoSeguro: texto,
          propuestas: [],
          decisiones: {},
          advertencias: [],
          actualizado: Date.now(),
        });
      },
      /* Revalidación contra la fuente: un registro «legado» solo se usa solo
       * si su huella coincide con el texto real del capítulo; los demás se
       * conservan pero no vuelven a la vista por su cuenta. */
      cargar: async (indice) => {
        const reg = await almacen.cargarPulidoRegistro(estado.id, indice);
        if (!reg) return null;
        const parte = estado.partes[indice];
        const huellaFuente = parte ? construirHuella(parte.texto) : '';
        if (reg.huellaOrigen && reg.huellaOrigen !== huellaFuente) return null;
        if (reg.estado === 'lectura_segura' && Number(reg.version) !== VERSION_PULIDO_LECTURA) return null;
        if (reg.estado === 'legado') {
          if (!reg.huellaOrigen) return null;
        }
        return reg.texto || reg.textoAprobado || reg.textoSeguro || null;
      },
    });

    // Inicializar auditor nuevo con 2 concurrentes
    estado.auditor = crearAuditorPdf({
      pedirAuditoria: async (bloque) => {
        const huella = construirHuella(bloque.texto);
        // llamar a /api/improve modo auditoria_pdf con contexto
        const body = {
          text: bloque.texto,
          language: 'es',
          provider: (typeof window.jgCfgGet === 'function' ? window.jgCfgGet('jg_provider', 'gemini') : 'gemini'),
          api_key: (typeof window.jgCfgGet === 'function' ? window.jgCfgGet('jg_api_key', '') : ''),
          openrouter_model: (typeof window.jgCfgGet === 'function' ? window.jgCfgGet('jg_openrouter_model', '') : ''),
          mode: 'auditoria_pdf',
          bloque_id: bloque.id,
          huella_origen: huella,
          contexto_anterior: bloque.contextoAnterior || '',
          contexto_posterior: bloque.contextoPosterior || '',
          tokens_estables: tokenizarParaAuditoria(bloque.texto).tokens,
        };
        const resp = await fetch('/api/improve', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
        if (!resp.ok) throw new Error('Auditoría falló ' + resp.status);
        const data = await resp.json();
        // si viene como {signos, propuestas}, conservar
        if (data.signos || data.propuestas) {
          /* Capa revisadoSeguro: se reconstruye LOCALMENTE aplicando solo los
           * signos validados. Si el resultado no preserva las palabras
           * exactas (mismasPalabras), se descarta y el bloque se queda en su
           * capa local — nunca texto del modelo aplicado directo. */
          let seguro = bloque.texto;
          if (Array.isArray(data.signos) && data.signos.length) {
            const conSignos = aplicarSignos(bloque.texto, body.tokens_estables, data.signos);
            if (conSignos) seguro = conSignos;
          }
          estado.textoSeguroPorBloque.set(bloque.id, seguro);
          estado.propuestasPorBloque.set(bloque.id, data.propuestas || []);
          estado.decisionesPorBloque.set(bloque.id, new Map());
          await almacen.guardarBloqueAuditoria(estado.id, bloque.id, { signos: data.signos || [], propuestas: data.propuestas || [], huella, textoSeguro: seguro });
          await almacen.guardarProgresoAuditoria(estado.id, bloque.id, 'completo');
          return data;
        }
        // fallback texto plano (compat)
        return { signos: [], propuestas: [], texto: data.text || '' };
      },
      guardarBloque: (id, datos) => almacen.guardarBloqueAuditoria(estado.id, id, datos),
      cargarBloque: (id) => almacen.cargarBloqueAuditoria(estado.id, id),
      guardarProgreso: (id, est) => almacen.guardarProgresoAuditoria(estado.id, id, est),
      cargarProgreso: () => almacen.cargarProgresoAuditoria(estado.id),
    });

    // Hidratar auditoría previa (respuestas, decisiones y caché) para que
    // cerrar y reabrir el libro NO pierda el trabajo ya hecho.
    almacen.listarAuditoriaDoc(estado.id).then(async (filas) => {
      const bloquesActuales = new Map(estado.bloques.map((b) => [b.id, b]));
      const compatibles = filas.filter((fila) => {
        const actual = bloquesActuales.get(fila.bloqueId);
        if (!actual) return false;
        /* El re-troceo puede conservar el id b0 pero cambiar su texto. Las
         * decisiones antiguas se preservan en IndexedDB, pero no se aplican
         * sobre una fuente distinta. */
        return !fila.huella || fila.huella === construirHuella(actual.texto);
      });
      for (const b of compatibles) {
        if (b.propuestas) estado.propuestasPorBloque.set(b.bloqueId, b.propuestas);
        if (b.textoSeguro) estado.textoSeguroPorBloque.set(b.bloqueId, b.textoSeguro);
      }
      await Promise.all(compatibles.map(async (b) => {
        const reg = await almacen.cargarPulidoRegistro(estado.id, `bloque_${b.bloqueId}`);
        const actual = bloquesActuales.get(b.bloqueId);
        const mismaFuente = !reg?.huellaOrigen || reg.huellaOrigen === construirHuella(actual?.texto || '');
        if (mismaFuente && reg?.decisiones && typeof reg.decisiones === 'object') {
          estado.decisionesPorBloque.set(b.bloqueId, new Map(Object.entries(reg.decisiones)));
          if (reg.textoAprobado) estado.textoAprobadoPorBloque.set(b.bloqueId, reg.textoAprobado);
        }
      }));
      if (estado.auditor && compatibles.length) await estado.auditor.hidratar(compatibles.map((b) => b.bloqueId));
      /* Solo hay algo que reconstruir si el trabajo previo incluyó decisiones:
       * sin ellas, la vista sigue en su capa local (nada aprobado que aplicar). */
      const conDecisiones = compatibles.some((b) => (estado.decisionesPorBloque.get(b.bloqueId)?.size || 0) > 0);
      if (conDecisiones) reconstruirAprobado({ guardar: false });
      actualizarEstadoAuditoria();
    }).catch(()=>{});
    almacen.cargarProgresoAuditoria(estado.id).then((prog) => {
      const comp = prog.filter((p) => p.estado === 'completo').length;
      const fallos = prog.filter((p) => String(p.estado).startsWith('fallo') || String(p.estado).startsWith('error')).length;
      estado.auditoriaProgreso = { total: estado.bloques.length || prog.length, completados: comp, fallos };
      actualizarEstadoAuditoria();
    }).catch(()=>{});

    almacen.pulidosDe(estado.id).then((indices) => {
      if (!indices.size || !estado.pulidor) return;
      estado.pulidor.sembrar([...indices]);
      if (el.pulidoCambio) el.pulidoCambio.hidden = false;
      if (indices.size && el.pulidoEstado) {
        actualizarEstadoAuditoria();
      }
    }).catch(() => {});

    /* La cola editorial anterior enviaba una petición por bloque estructural
     * y podía mostrar 4.950 renglones pendientes. Se conserva únicamente para
     * leer sugerencias ya guardadas. La corrección automática nueva recorre
     * las partes reales del lector mediante `iniciarCorreccionLibro`. */
    const docIdCola = estado.id;
    colaLista = (async () => {
      try {
        const serial = await almacen.cargarColaCorreccion(docIdCola);
        if (estado.id !== docIdCola) return;
        if (!serial) return;
        estado.colaCorreccion = hidratarCola(serial, estado.partes, { cortar: mejorCorteCanonico });
        aplicarPartesYaCorregidas();
        const r = resumenCola(estado.colaCorreccion);
        estado.correccionProgreso.total = r.total;
        estado.correccionProgreso.completados = r.completados;
        estado.correccionProgreso.fallos = r.fallos;
        actualizarEstadoCorreccion();
      } catch (_) { /* sin cola guardada se crea al arrancar */ }
    })();
    actualizarEstadoAuditoria();
  }

  /** Ids de los bloques de auditoría que pertenecen a los capítulos dados. */
  function idsBloquesDeCapitulos(indices) {
    const set = new Set(indices);
    return estado.bloques.filter((b) => set.has(b.capitulo)).map((b) => b.id);
  }

  function candidatosDeItem(_item) {
    // Obsoleto en el flujo v7: las uniones las decide la etapa 1 por
    // boundaryId. Se conserva la firma para no romper llamadores viejos,
    // pero ya no autoriza nada (la etapa 2 es estricta).
    return [];
  }

  function contextoDeLimite(lim, radio = 80) {
    // Contexto anterior/posterior legible para la etapa 1 (el servidor lo
    // incorpora a la petición al proveedor; antes lo recogía y lo ignoraba).
    try {
      const texto = estado.fuenteTexto || estado.localTexto || '';
      const off = estado.offsetDeAtomo?.get?.(lim.leftAtomId);
      if (!Number.isFinite(off)) return { anterior: '', posterior: '' };
      return {
        anterior: texto.slice(Math.max(0, off - radio), off),
        posterior: texto.slice(off, off + radio),
      };
    } catch (_) { return { anterior: '', posterior: '' }; }
  }

  async function pedirCorreccionBloque(item) {
    if (typeof window.jgCorregirBloqueLectura !== 'function') {
      const err = new Error('el proveedor no está disponible');
      err.causa = 'proveedor';
      throw err;
    }
    const nucleo = item?.texto ?? '';
    const resp = await window.jgCorregirBloqueLectura(nucleo, estado.idioma || 'es', {
      candidatosUnion: [],
    });
    return { texto: resp?.text || resp?.texto || '', ia_used: resp?.ia_used };
  }

  /**
   * Etapa 1/3 · Resolver cortes y estructura por identificador.
   * Conecta el modo pdf_boundary_decisions: cada límite viaja con su id,
   * revisión de origen, contexto y evidencia; cada respuesta se aplica solo
   * a su límite. Lo ambiguo o inválido queda pendiente (Revisar cortes).
   */
  async function resolverCortesPendientes({ abortado } = {}) {
    const pendientes = (estado.limites || []).filter((l) => l?.decision === 'pending');
    if (!pendientes.length) return { resueltos: 0, pendientes: 0 };
    const decidir = window.jgDecidirLimitesPdf || window.jgPedirDecisionesLimites;
    if (typeof decidir !== 'function') return { resueltos: 0, pendientes: pendientes.length };
    const LOTE = 24;
    let resueltos = 0;
    for (let i = 0; i < pendientes.length; i += LOTE) {
      if (abortado?.()) break;
      const lote = pendientes.slice(i, i + LOTE);
      const peticion = lote.map((lim) => {
        const ctx = contextoDeLimite(lim);
        return {
          boundaryId: lim.id,
          leftFragment: lim.leftFragment || '',
          rightFragment: lim.rightFragment || '',
          kind: lim.kind || '',
          language: estado.idioma || 'es',
          evidence: lim.evidence || {},
          leftContext: ctx.anterior,
          rightContext: ctx.posterior,
          sourceRevision: estado.fuenteRevision || '',
        };
      });
      try {
        const decidir2 = window.jgDecidirLimitesPdf || window.jgPedirDecisionesLimites;
        const resp = await decidir2(peticion, estado.idioma || 'es');
        const decisiones = Array.isArray(resp?.decisions) ? resp.decisions : [];
        const { aplicadas } = aceptarDecisionesIA(estado.limites, decisiones);
        resueltos += aplicadas.length;
      } catch (_) {
        break;
      }
    }
    estado.pendientesLimites = (estado.limites || []).filter((l) => l?.decision === 'pending').length;
    return { resueltos, pendientes: estado.pendientesLimites };
  }

  function aplicarPartesYaCorregidas() {
    if (!estado.colaCorreccion) return;
    for (let i = 0; i < estado.partes.length; i += 1) {
      if (!parteCompleta(estado.colaCorreccion, i)) continue;
      const t = textoCorregidoDeParte(estado.colaCorreccion, i, '');
      if (t) estado.pulido.set(i, t);
    }
  }

  async function persistirCola(cola) {
    estado.colaCorreccion = cola;
    const r = resumenCola(cola);
    estado.correccionProgreso.total = r.total;
    estado.correccionProgreso.completados = r.completados;
    estado.correccionProgreso.fallos = r.fallos;
    actualizarEstadoCorreccion();
    if (parteCompleta(cola, estado.parteActual)) {
      const t = textoCorregidoDeParte(cola, estado.parteActual, '');
      if (t) {
        estado.pulido.set(estado.parteActual, t);
        if (el.pulidoCambio) el.pulidoCambio.hidden = false;
        if (estado.pulidoActivo && estado.vista === 'original' && el.salida) {
          el.salida.value = t;
          el.salida.dispatchEvent(new Event('input', { bubbles: true }));
          actualizarContador();
        }
      }
    }
    if (estado.id) await almacen.guardarColaCorreccion(estado.id, serializarCola(cola));
  }

  async function finalizarCorreccionLibro(cola) {
    // Antes de guardar: comprobar documento, revisión y cancelación.
    const docId = estado.id;
    const revision = estado.fuenteRevision || '';
    if (!docId || !cola) return;
    const cobertura = validarCoberturaCola(cola, estado.partes);
    if (!cobertura.ok) {
      avisar('La corrección no cubre todo el libro; se conserva la revisión anterior.', 'warn');
      return;
    }
    const textos = libroCorregidoEnOrden(cola, estado.partes);
    // Validar también las uniones entre bloques antes de guardar.
    for (let i = 0; i < textos.length; i += 1) {
      const v = validarUnionesEntreBloques(textos[i], estado.partes[i]?.texto || '');
      if (!v.ok) {
        avisar('La corrección pegó palabras al recomponer; se conserva la revisión anterior.', 'warn');
        return;
      }
    }
    // Una corrección posterior no reemplaza una edición aprobada silenciosamente.
    const nuevas = estado.partes.map((p, i) => {
      const bloqueId = estado.bloques?.[i]?.id || ('cap_' + i);
      const aprobada = estado.textoAprobadoPorBloque.get(bloqueId) ?? estado.textoAprobadoPorBloque.get('cap_' + i);
      if (aprobada && String(aprobada).trim()) return { ...p, texto: String(aprobada) };
      return { ...p, texto: textos[i] };
    });
    let off = 0;
    for (const p of nuevas) {
      p.desde = off;
      off += String(p.texto || '').length;
      p.hasta = off;
    }
    const libro = componerLibroDesdePartes(nuevas);
    // Guardado atómico: si el almacenamiento falla, se conserva la anterior
    // y se muestra Corrección terminada, pendiente de guardar.
    const anteriores = estado.partes;
    const libroAnterior = estado.localTexto;
    estado.guardadoConfirmado = false;
    try {
      const capsPrevias = prepararCapitulosLectura(
        libro,
        nuevas.filter((p) => !p.continuation).map((p) => ({ titulo: p.titulo, posicion: p.desde || 0 })),
      );
      const bloquesPrevios = construirBloquesAuditoria(libro, estado.bloquesEstructurales, capsPrevias);
      await almacen.marcarTroceo(estado.id, VERSION_TROCEO, {
        partes: nuevas,
        capitulos: capsPrevias,
        progreso: estado.progreso,
        bloques: bloquesPrevios,
        versionReconstruccion: VERSION_RECONSTRUCCION,
        pendientesLimites: contarPendientes(estado.limites),
        fuenteRevision: revision,
        revisionLectura: sha256Hex(libro),
      });
      await almacen.guardarBloquesDocumento(estado.id, bloquesPrevios);
      if (estado.id !== docId) return;
      estado.partes = nuevas;
      estado.localTexto = libro;
      estado.revisionLectura = sha256Hex(libro);
      estado.guardadoConfirmado = true;
      estado.bloques = bloquesPrevios;
      var capsConfirmadas = capsPrevias;
    } catch (error) {
      console.warn('[jg-pdf] guardado atómico fallido, se conserva la anterior', error);
      estado.partes = anteriores;
      estado.localTexto = libroAnterior;
      estado.guardadoConfirmado = false;
      avisar('Corrección terminada, pendiente de guardar: no se pudo escribir en este dispositivo.', 'warn');
      actualizarEstadoCorreccion();
      return;
    }
    estado.pulido = new Map(nuevas.map((p, i) => [i, p.texto]));

    // Recalcular anclas, índice, búsqueda y TTS desde la revisión confirmada.
    const caps = (typeof capsConfirmadas !== 'undefined' && capsConfirmadas) || prepararCapitulosLectura(
      libro,
      nuevas.filter((p) => !p.continuation).map((p) => ({ titulo: p.titulo, posicion: p.desde || 0 })),
    );
    if (!estado.bloques || !estado.bloques.length) {
      estado.bloques = construirBloquesAuditoria(libro, estado.bloquesEstructurales, caps);
    }

    for (let i = 0; i < nuevas.length; i += 1) {
      const bloqueId = estado.bloques?.[i]?.id || ('cap_' + i);
      const aprobada = estado.textoAprobadoPorBloque.get(bloqueId) ?? estado.textoAprobadoPorBloque.get('cap_' + i);
      if (aprobada && String(aprobada).trim()) continue;
      await almacen.guardarPulidoEstructurado(estado.id, i, {
        version: VERSION_PULIDO_LECTURA,
        huellaOrigen: construirHuella(nuevas[i].texto),
        estado: 'lectura_segura',
        textoSeguro: nuevas[i].texto,
        propuestas: [],
        decisiones: {},
        advertencias: [],
        actualizado: Date.now(),
      });
    }

    const colaFinal = crearColaDesdePartes(nuevas, {
      cortar: mejorCorteCanonico,
      documentId: estado.id || '',
      sourceRevision: estado.revisionLectura || sha256Hex(libro),
      stage: 'puntuacion',
    });
    for (const it of colaFinal.items) aplicarExito(colaFinal, it, it.texto);
    estado.colaCorreccion = colaFinal;
    await almacen.guardarColaCorreccion(estado.id, serializarCola(colaFinal));
    // Solo se invalidan las traducciones cuya fuente cambió.
    try {
      const fuenteCambio = (estado.fuenteRevision || '') !== (estado.revisionLectura || '');
      if (fuenteCambio) {
        await almacen.borrarTraduccionesDe(estado.id);
        estado.traducido.clear();
        prepararTraduccion();
      }
    } catch (_) {
      await almacen.borrarTraduccionesDe(estado.id);
      estado.traducido.clear();
      prepararTraduccion();
    }
    if (estado.vista === 'es') {
      asegurarTraduccion(estado.parteActual, { mostrar: true }).catch(() => {});
    }

    if (el.salida && estado.vista === 'original') {
      el.salida.value = textoDeParte(estado.parteActual);
      el.salida.dispatchEvent(new Event('input', { bubbles: true }));
      actualizarContador();
    }
    pintarIndice();
    sincronizarAhora({ silencioso: true });
  }

  /** Recorre todas las partes con cola persistente, reintentos y bloques más chicos. */
  function pausarCorreccionLibro() {
    // Pausar conserva la cola y el último bloque confirmado; Reanudar sigue
    // donde iba (una recarga también recupera ese punto).
    if (!estado.correccionProgreso.ejecutando) return;
    estado.correccionProgreso.token += 1;
    estado.correccionProgreso.ejecutando = false;
    estado.correccionPausada = true;
    estado.correccionProgreso.etapa = 'En pausa';
    actualizarEstadoCorreccion();
    avisar('Corrección en pausa. Puedes reanudar cuando quieras.', 'info');
  }

  /**
   * Una única corrección del libro en tres etapas (§3):
   * 1. Resolver cortes y estructura (límites por identificador).
   * 2. Revisar puntuación por bloques (una sola cola compartida).
   * 3. Validar y guardar la nueva revisión (atómico).
   * Abrir un capítulo no inicia otro proceso competidor: si ya hay uno en
   * curso, se vuelve sin hacer nada.
   */
  async function iniciarCorreccionLibro({ reanudar = false } = {}) {
    if (!estado.consentido || !estado.partes.length) return;
    if (estado.correccionProgreso.ejecutando) return;
    await colaLista;
    if (!estado.consentido || !estado.partes.length) return;
    if (estado.correccionProgreso.ejecutando) return;

    if (!estado.fuenteRevision) {
      try {
        estado.fuenteTexto = estado.fuenteTexto || estado.localTexto || '';
        estado.fuenteRevision = sha256Hex(estado.fuenteTexto || '');
      } catch (_) {}
    }
    if (reanudar && estado.colaCorreccion) prepararReanudacion(estado.colaCorreccion);
    if (!estado.colaCorreccion) {
      estado.colaCorreccion = crearColaDesdePartes(estado.partes, {
        cortar: mejorCorteCanonico,
        documentId: estado.id || '',
        sourceRevision: estado.fuenteRevision || '',
        stage: 'puntuacion',
      });
    }

    const previo = resumenCola(estado.colaCorreccion);
    const pendientesPrevios = (estado.limites || []).filter((l) => l?.decision === 'pending').length;
    const listoPrevio = colaListaParaLibro(estado.colaCorreccion, {
      pendientesLimites: pendientesPrevios,
      integridadOk: true,
      guardadoOk: estado.guardadoConfirmado,
    });
    if (previo.lista && listoPrevio.lista && !reanudar) {
      estado.correccionProgreso = {
        total: previo.total,
        completados: previo.completados,
        fallos: 0,
        ejecutando: false,
        etapa: '',
        token: estado.correccionProgreso.token + 1,
      };
      actualizarEstadoCorreccion();
      return;
    }

    const docId = estado.id;
    const revision = estado.fuenteRevision || '';
    const token = estado.correccionProgreso.token + 1;
    estado.correccionPausada = false;
    estado.correccionProgreso = {
      total: previo.total || estado.partes.length,
      completados: previo.completados,
      fallos: previo.fallos,
      ejecutando: true,
      etapa: 'Etapa 1/3 · Cortes',
      token,
    };
    actualizarEstadoCorreccion();

    const abortado = () => (
      estado.id !== docId
      || estado.correccionProgreso.token !== token
      || !estado.consentido
    );

    // Etapa 1/3 · Resolver cortes y estructura.
    try {
      const r1 = await resolverCortesPendientes({ abortado });
      if (abortado()) return;
      if (Number(r1?.pendientes) > 0) {
        // Quedan cortes por revisar a mano: no se finge integridad.
        estado.correccionProgreso.ejecutando = false;
        estado.correccionProgreso.etapa = 'Etapa 1/3 · Revisar cortes';
        actualizarEstadoCorreccion();
        avisar('Quedan ' + r1.pendientes + ' cortes por revisar a mano.', 'warn');
        return;
      }
    } catch (error) {
      console.warn('[jg-pdf] etapa 1 no completada', error);
    }
    if (abortado()) return;

    // Etapa 2/3 · Puntuación por bloques (la corrección automática por parte
    // y la del libro comparten esta misma cola).
    estado.correccionProgreso.etapa = 'Etapa 2/3 · Puntuación';
    actualizarEstadoCorreccion();
    const esperarMs = (ms) => new Promise((res) => setTimeout(res, Math.max(0, Number(ms) || 0)));
    const resultado = await correrCola(estado.colaCorreccion, {
      pedir: pedirCorreccionBloque,
      persistir: persistirCola,
      validar: validarResultadoCorreccion,
      candidatosDe: () => [],
      cortar: mejorCorteCanonico,
      abortado,
      esperar: esperarMs,
      documentId: docId,
      sourceRevision: revision,
      onAvance: (cola) => {
        const r = resumenCola(cola);
        estado.correccionProgreso.completados = r.completados;
        estado.correccionProgreso.fallos = r.fallos;
        estado.correccionProgreso.total = r.total;
        estado.correccionProgreso.etapa = 'Etapa 2/3 · Puntuación';
        actualizarEstadoCorreccion();
      },
    });

    if (abortado()) return;
    if (resultado?.pausa) {
      estado.correccionProgreso.ejecutando = false;
      estado.correccionProgreso.etapa = 'En pausa · revisa la clave o la cuota';
      actualizarEstadoCorreccion();
      const causa = resultado?.motivo === 'credenciales'
        ? 'La clave es inválida: revísala en Configuración y pulsa Reanudar corrección.'
        : 'Se agotó la cuota del proveedor: revisa tu plan y pulsa Reanudar corrección.';
      avisar(causa, 'warn');
      return;
    }
    estado.correccionProgreso.ejecutando = false;
    // Etapa 3/3 · Validar y guardar (atómico, con fuente inmutable).
    if (resultado.completa) {
      estado.correccionProgreso.etapa = 'Etapa 3/3 · Validando';
      actualizarEstadoCorreccion();
      try { await finalizarCorreccionLibro(estado.colaCorreccion); }
      catch (error) { console.warn('[jg-pdf] no se pudo guardar el libro corregido', error); }
    }
    estado.correccionProgreso.etapa = '';
    actualizarEstadoCorreccion();
  }

  async function asegurarPulido(indice, { mostrar = false } = {}) {
    if (!estado.pulidor) return false;
    const parte = estado.partes[indice];
    if (!parte) return false;
    if (estado.pulido.has(indice)) {
      if (mostrar && estado.pulidoActivo && estado.vista === 'original') volcarPulido(indice);
      return true;
    }
    const esActual = indice === estado.parteActual;
    if (esActual) mostrarPulidoEstado('Puliendo para voz…', '');
    try {
      // Sin consentimiento nunca se llama ni se guarda una falsa revisión.
      if (!estado.consentido) {
        const ok = await pedirConsentimientoAuditoria();
        if (!ok) { if (esActual) { mostrarPulidoEstado('Solo local', 'mecanico'); ocultarPulidoEstado(2000); } return false; }
      }
      const texto = await estado.pulidor.obtener(indice, parte);
      const resultado = estado.pulidor.resultado?.(indice);
      if (!texto || !resultado?.ok) {
        if (esActual && !estado.correccionProgreso.ejecutando) {
          mostrarPulidoEstado('No se pudo corregir esta parte', 'mecanico');
        }
        return false;
      }
      estado.pulido.set(indice, texto);
      if (el.pulidoCambio) el.pulidoCambio.hidden = false;
      if (mostrar && estado.pulidoActivo && estado.vista === 'original') volcarPulido(indice);
      if (esActual && !estado.correccionProgreso.ejecutando) {
        const cambio = texto !== parte.texto;
        mostrarPulidoEstado(cambio ? '✓ Pulido para voz' : '✓ Listo para escuchar', cambio ? 'ok' : 'mecanico');
        ocultarPulidoEstado(2600);
      }
      return true;
    } catch (error) {
      if (esActual) { mostrarPulidoEstado('Pulido mecánico activo', 'mecanico'); ocultarPulidoEstado(2200); }
      return false;
    }
  }

  function volcarPulido(indice) {
    if (indice !== estado.parteActual || estado.vista !== 'original' || !estado.pulidoActivo) return;
    // Si hay texto aprobado/revisadoSeguro para este capítulo, preferirlo
    const progAprobado = estado.textoAprobadoPorBloque.get(`cap_${indice}`);
    if (progAprobado) {
      el.salida.value = progAprobado;
      el.salida.dispatchEvent(new Event('input', { bubbles: true }));
      actualizarContador();
      restaurarPosicionGuardada();   /* reemplazar el texto manda el scroll a 0 */
      return;
    }
    const seguro = estado.textoSeguroPorBloque.get(`cap_${indice}`);
    if (seguro) {
      el.salida.value = seguro;
      el.salida.dispatchEvent(new Event('input', { bubbles: true }));
      actualizarContador();
      restaurarPosicionGuardada();
      return;
    }
    el.salida.value = estado.pulido.get(indice) || el.salida.value;
    el.salida.dispatchEvent(new Event('input', { bubbles: true }));
    actualizarContador();
    restaurarPosicionGuardada();
  }

  function activarPulido() {
    guardarEdicionActual();
    estado.pulidoActivo = true;
    try { localStorage.setItem('jg_pdf_pulido', '1'); } catch (_) {}
    actualizarSwitchPulido();
    mostrarPulidoEstado('Pulido activado', 'ok');
    ocultarPulidoEstado(1800);
    if (estado.vista === 'original') {
      el.salida.value = textoDeParte(estado.parteActual);
      el.salida.dispatchEvent(new Event('input', { bubbles: true }));
      actualizarContador();
      restaurarPosicionGuardada();
      asegurarPulido(estado.parteActual, { mostrar: true });
    }
  }

  function desactivarPulido() {
    guardarEdicionActual();
    estado.pulidoActivo = false;
    try { localStorage.setItem('jg_pdf_pulido', '0'); } catch (_) {}
    actualizarSwitchPulido();
    mostrarPulidoEstado('Texto original', 'mecanico');
    ocultarPulidoEstado(1800);
    if (estado.vista === 'original') {
      el.salida.value = estado.partes[estado.parteActual]?.texto || '';
      el.salida.dispatchEvent(new Event('input', { bubbles: true }));
      actualizarContador();
      restaurarPosicionGuardada();
    }
  }

  // Revisión por capítulo: antes/después con motivo y acciones Aceptar/Rechazar/Aceptar todos
  function obtenerRevisionDeCapitulo(indice) {
    const parte = estado.partes[indice];
    if (!parte) return null;
    let bloquesDelCap = estado.bloques.filter((b) => b.capitulo === indice);
    /* Compatibilidad con documentos antiguos sin capítulo asignado: si no hay
     * mapeo, todo el documento pertenece a su único capítulo visible. */
    if (!bloquesDelCap.length && indice === 0) bloquesDelCap = estado.bloques;
    const propuestas = [];
    for (const b of bloquesDelCap) {
      const props = estado.propuestasPorBloque.get(b.id) || [];
      for (let i = 0; i < props.length; i += 1) {
        propuestas.push({ bloqueId: b.id, idx: i, ...props[i] });
      }
    }
    return { parte, bloquesDelCap, propuestas };
  }
  function aceptarPropuesta(bloqueId, idx) {
    const mapa = estado.decisionesPorBloque.get(bloqueId) || new Map();
    mapa.set(String(idx), 'aceptar');
    estado.decisionesPorBloque.set(bloqueId, mapa);
    reconstruirAprobado();
    actualizarBotonRevision();
    if (el.revisionHoja && !el.revisionHoja.hidden) pintarRevision();
  }
  function rechazarPropuesta(bloqueId, idx) {
    const mapa = estado.decisionesPorBloque.get(bloqueId) || new Map();
    mapa.set(String(idx), 'rechazar');
    estado.decisionesPorBloque.set(bloqueId, mapa);
    reconstruirAprobado();
    actualizarBotonRevision();
    if (el.revisionHoja && !el.revisionHoja.hidden) pintarRevision();
  }
  function aceptarTodasDelCapitulo(indice) {
    const rev = obtenerRevisionDeCapitulo(indice);
    if (!rev) return;
    if (!window.confirm('¿Aceptar todos los cambios de este capítulo?')) return;
    for (const p of rev.propuestas) aceptarPropuesta(p.bloqueId, p.idx);
  }
  function reconstruirAprobado({ guardar = true } = {}) {
    // reconstruye textoAprobado por bloque aplicando decisiones
    for (const b of estado.bloques) {
      const props = estado.propuestasPorBloque.get(b.id) || [];
      const dec = estado.decisionesPorBloque.get(b.id) || new Map();
      const base = estado.textoSeguroPorBloque.get(b.id) || b.texto;
      const toks = tokenizarParaAuditoria(base).tokens;
      const aprobado = aplicarDecisiones(base, toks, props, dec);
      estado.textoAprobadoPorBloque.set(b.id, aprobado);
      if (!guardar) continue;
      // guardar estructurado
      almacen.guardarPulidoEstructurado(estado.id, `bloque_${b.id}`, {
        version: 4,
        huellaOrigen: construirHuella(b.texto),
        estado: 'aprobado_parcial',
        progreso: { total: props.length, aceptadas: [...dec.values()].filter(v=>v==='aceptar').length },
        textoSeguro: base,
        propuestas: props,
        decisiones: Object.fromEntries(dec),
        textoAprobado: aprobado,
        advertencias: [],
        actualizado: Date.now(),
      });
    }
    // mapear a capítulos para vista y voz. Regla de integridad: un capítulo
    // solo recibe capa aprobada/segura si TODOS sus bloques están auditados —
    // una capa parcial (p. ej. solo el título) jamás pisa la vista.
    for (let i = 0; i < estado.partes.length; i += 1) {
      let bloquesDelCap = estado.bloques.filter((b) => b.capitulo === i);
      if (!bloquesDelCap.length && i === 0) bloquesDelCap = estado.bloques;
      if (!bloquesDelCap.length) continue;
      const cubierto = bloquesDelCap.every((b) => estado.textoSeguroPorBloque.get(b.id) || estado.textoAprobadoPorBloque.get(b.id));
      if (!cubierto) continue;
      const textos = bloquesDelCap.map((b) => estado.textoAprobadoPorBloque.get(b.id) || estado.textoSeguroPorBloque.get(b.id) || b.texto);
      estado.textoAprobadoPorBloque.set(`cap_${i}`, textos.join('\n\n'));
      const seguros = bloquesDelCap.map((b) => estado.textoSeguroPorBloque.get(b.id)).filter(Boolean);
      if (seguros.length) estado.textoSeguroPorBloque.set(`cap_${i}`, seguros.join('\n\n'));
    }
    if (estado.pulidoActivo && estado.vista === 'original') volcarPulido(estado.parteActual);
    actualizarBotonRevision();
  }

  /* ── UI de revisión: hoja con las propuestas del capítulo abierto ──── */

  /** Propuestas del capítulo actual que aún no tienen decisión. */
  function propuestasPendientesDelCapitulo(indice) {
    const rev = obtenerRevisionDeCapitulo(indice);
    if (!rev) return [];
    return rev.propuestas.filter((p) => {
      const d = estado.decisionesPorBloque.get(p.bloqueId)?.get(String(p.idx));
      return d !== 'aceptar' && d !== 'rechazar';
    });
  }

  /** Muestra/oculta el botón del menú con el contador de sugerencias pendientes. */
  function actualizarBotonRevision() {
    if (!el.revisionBtn) return;
    const pend = propuestasPendientesDelCapitulo(estado.parteActual);
    el.revisionBtn.hidden = pend.length === 0;
    if (el.revisionCuenta) el.revisionCuenta.textContent = String(pend.length);
  }

  /** Pinta la lista de propuestas (antes → después, motivo, dos acciones). */
  function pintarRevision() {
    if (!el.revisionLista) return;
    const pend = propuestasPendientesDelCapitulo(estado.parteActual);
    if (el.revisionTitulo) {
      el.revisionTitulo.textContent = `Sugerencias de gramática · capítulo ${estado.parteActual + 1}`;
    }
    el.revisionLista.innerHTML = '';
    if (el.revisionVacio) el.revisionVacio.hidden = pend.length > 0;
    if (el.revisionAceptarTodo) el.revisionAceptarTodo.hidden = pend.length === 0;
    const modelo = document.createElement('template');
    for (const p of pend) {
      const item = document.createElement('div');
      item.className = 'pdf-rev-item';
      const textos = document.createElement('div');
      textos.className = 'pdf-rev-textos';
      const antes = document.createElement('span');
      antes.className = 'pdf-rev-antes';
      antes.textContent = p.original || '';
      const despues = document.createElement('span');
      despues.className = 'pdf-rev-despues';
      despues.textContent = p.sustitucion || '';
      const motivo = document.createElement('span');
      motivo.className = 'pdf-rev-motivo';
      motivo.textContent = [p.categoria, p.explicacion].filter(Boolean).join(' · ');
      textos.append(antes, despues, motivo);
      const acciones = document.createElement('div');
      acciones.className = 'pdf-rev-acciones';
      const si = document.createElement('button');
      si.type = 'button';
      si.className = 'mini-btn';
      si.textContent = 'Aceptar';
      si.dataset.accion = 'aceptar';
      const no = document.createElement('button');
      no.type = 'button';
      no.className = 'mini-btn';
      no.textContent = 'Rechazar';
      no.dataset.accion = 'rechazar';
      for (const b of [si, no]) {
        b.dataset.bloque = p.bloqueId;
        b.dataset.idx = String(p.idx);
      }
      acciones.append(si, no);
      item.append(textos, acciones);
      modelo.content.append(item);
    }
    el.revisionLista.append(modelo.content);
  }

  if (typeof window !== 'undefined') {
    window.jgPdfRevision = { obtenerRevisionDeCapitulo, aceptarPropuesta, rechazarPropuesta, aceptarTodasDelCapitulo };
  }

  /* ── Traducción al español ───────────────────────────────────────── */

  function prepararTraduccion() {
    el.tradBar.hidden = true;
    el.tradCambio.hidden = true;
    estado.traductor = null;
    if (!deps.traducirTexto || !necesitaTraduccion(estado.idioma)) return;

    estado.traductor = crearTraductor({
      idiomaOrigen: estado.idioma,
      traducir: (texto, opciones) => deps.traducirTexto(texto, opciones),
      guardar: (indice, texto) => almacen.guardarTraduccion(estado.id, 'es', indice, texto),
      cargar: (indice) => almacen.cargarTraduccion(estado.id, 'es', indice),
    });

    const nombre = { en: 'inglés', fr: 'francés', pt: 'portugués', de: 'alemán', it: 'italiano' }[estado.idioma]
      || 'otro idioma';
    el.tradTexto.textContent = `Este documento está en ${nombre}. Puedes leerlo y escucharlo en español.`;
    el.tradBar.hidden = false;

    /* Lo ya traducido en sesiones anteriores se marca en el índice. */
    almacen.traduccionesDe(estado.id, 'es').then((indices) => {
      if (!indices.size || !estado.traductor) return;
      estado.traductor.sembrar([...indices]);
      pintarIndice();
    }).catch(() => {});
  }

  async function asegurarTraduccion(indice, { mostrar = false } = {}) {
    if (!estado.traductor) return false;
    const parte = estado.partes[indice];
    if (!parte) return false;

    if (estado.traducido.has(indice)) {
      if (mostrar) volcarTraduccion(indice);
      return true;
    }

    // Pulir primero, traducir después: si el capítulo ya tiene versión pulida,
    // se traduce esa (mejor puntuación → mejor traducción). Si está puliéndose,
    // se espera al pulido antes de traducir.
    if (estado.pulidoActivo && estado.pulidor && !estado.pulido.has(indice)) {
      try { await asegurarPulido(indice, { mostrar: false }); } catch (_) {}
    }
    const textoFuente = (estado.pulidoActivo && estado.pulido.get(indice)) || parte.texto;
    const parteParaTraducir = textoFuente !== parte.texto ? { ...parte, texto: textoFuente } : parte;

    el.tradLabel.textContent = 'Traduciendo…';
    el.tradBtn.disabled = true;
    try {
      const texto = await estado.traductor.obtener(indice, parteParaTraducir, {
        alProgresar: (hechos, total) => {
          if (total > 1) el.tradLabel.textContent = `Traduciendo… ${Math.min(hechos + 1, total)} de ${total}`;
        },
      });
      if (!texto) return false;
      estado.traducido.set(indice, texto);
      if (mostrar) volcarTraduccion(indice);
      pintarIndice();

      /* Adelantar el siguiente capítulo mientras la persona lee este. */
      const siguiente = estado.partes[indice + 1];
      if (siguiente) {
        const textoSig = (estado.pulidoActivo && estado.pulido.get(indice + 1)) || siguiente.texto;
        const parteSig = textoSig !== siguiente.texto ? { ...siguiente, texto: textoSig } : siguiente;
        estado.traductor.precargar(indice + 1, parteSig);
      }
      return true;
    } catch (error) {
      avisar(`No se pudo traducir: ${error?.message || 'error desconocido'}`, 'err');
      return false;
    } finally {
      el.tradBtn.disabled = false;
      el.tradLabel.textContent = estado.vista === 'es' ? 'Traducir este capítulo' : 'Leer en español';
    }
  }

  function volcarTraduccion(indice) {
    if (indice !== estado.parteActual) return;
    el.salida.value = estado.traducido.get(indice) || el.salida.value;
    el.salida.dispatchEvent(new Event('input', { bubbles: true }));
    actualizarContador();
    restaurarPosicionGuardada();
  }

  async function activarEspanol() {
    if (!estado.traductor) return;
    guardarEdicionActual();
    estado.vista = 'es';
    el.tradCambio.hidden = false;
    el.verEspanol.classList.add('is-on');
    el.verOriginal.classList.remove('is-on');
    const listo = await asegurarTraduccion(estado.parteActual, { mostrar: true });
    if (!listo) {
      estado.vista = 'original';
      el.verOriginal.classList.add('is-on');
      el.verEspanol.classList.remove('is-on');
      return;
    }
    avisar('Leyendo en español. Lo traducido queda guardado: no se vuelve a traducir.', 'ok');
  }

  function verOriginal() {
    guardarEdicionActual();
    estado.vista = 'original';
    el.verOriginal.classList.add('is-on');
    el.verEspanol.classList.remove('is-on');
    el.salida.value = estado.partes[estado.parteActual]?.texto || '';
    el.salida.dispatchEvent(new Event('input', { bubbles: true }));
    actualizarContador();
    restaurarPosicionGuardada();
  }

  /* ── Procesar un PDF nuevo ───────────────────────────────────────── */

  function seleccionarArchivo(archivo) {
    if (!archivo) return;
    const esPdf = archivo.type === 'application/pdf' || /\.pdf$/i.test(archivo.name || '');
    if (!esPdf) {
      avisar('Ese archivo no es un PDF. Elige uno que termine en .pdf', 'err');
      return;
    }
    estado.archivo = archivo;
    if (el.ocrBox) el.ocrBox.hidden = true;
    if (el.nombre) el.nombre.textContent = archivo.name || 'documento.pdf';
    const megas = archivo.size ? (archivo.size / (1024 * 1024)) : 0;
    if (el.hint) {
      el.hint.textContent = megas >= 1
        ? `Listo: ${megas.toFixed(1)} MB. Pulsa «Sacar el texto».`
        : 'Listo. Pulsa «Sacar el texto».';
    }
    if (el.leer) el.leer.disabled = false;
    avisar('');
  }

  function leerRango() {
    const desde = el.from ? parseInt(el.from.value, 10) : 1;
    const hasta = el.to ? parseInt(el.to.value, 10) : null;
    const limpio = {
      desde: Number.isFinite(desde) && desde > 0 ? desde : 1,
      hasta: Number.isFinite(hasta) && hasta > 0 ? hasta : null,
    };
    if (limpio.hasta && limpio.hasta < limpio.desde) {
      const giro = limpio.desde;
      limpio.desde = limpio.hasta;
      limpio.hasta = giro;
    }
    if (el.rangeMeta) {
      el.rangeMeta.textContent = limpio.hasta
        ? `${limpio.desde} a ${limpio.hasta}`
        : (limpio.desde > 1 ? `desde la ${limpio.desde}` : 'Todo');
    }
    return limpio;
  }

  /** Divide el texto en bloques de auditoría y les asigna su capítulo. */
  function construirBloquesAuditoria(texto, bloquesEstructurales, capitulos) {
    const bloques = dividirEnBloquesSemanticos(texto, bloquesEstructurales || [], 3000);
    bloques.forEach((b, idx) => {
      const pos = texto.indexOf(String(b.texto || '').slice(0, 40));
      const capIdx = (capitulos || []).findIndex((c, i, arr) => {
        const ini = c.posicion;
        const fin = arr[i + 1]?.posicion ?? texto.length;
        return pos >= ini && pos < fin;
      });
      b.capitulo = capIdx >= 0 ? capIdx : 0;
      b.id = `bloq_${idx}`;
    });
    return bloques;
  }

  /** Guarda el documento entero y lo deja abierto para leer. */
  async function entregarDocumento(resultado, {
    origen = 'texto', portada = null, archivo = estado.archivo,
  } = {}) {
    // Capas: original inmutable + local (orden/espacios/guiones ya aplicados en componerTexto)
    estado.originalTexto = resultado.texto;
    estado.localTexto = resultado.texto;
    estado.bloquesEstructurales = resultado.bloques || [];
    estado.omisiones = resultado.omisiones || [];
    estado.limites = resultado.limites || [];
    estado.atomos = resultado.atomos || [];
    estado.offsetDeAtomo = resultado.offsetDeAtomo || new Map();
    estado.pendientesLimites = Number(resultado.pendientes) || 0;
    estado.needsSource = false;
    const capitulos = prepararCapitulosLectura(resultado.texto, resultado.capitulos);
    // dividir en bloques semánticos de 3000 para auditoría, con contexto
    const bloques = construirBloquesAuditoria(resultado.texto, resultado.bloques, capitulos);
    estado.bloques = bloques;
    estado.auditoriaProgreso = { total: bloques.length, completados: 0, fallos: 0 };
    estado.capa = { original: resultado.texto, local: resultado.texto, revisadoSeguro: '', aprobado: '' };

    const partes = partirTexto(resultado.texto, capitulos, resultado.paginas, [], {
      bloques: resultado.bloquesLectura || resultado.bloques,
      limites: resultado.limites,
      atomos: resultado.atomos,
      offsetDeAtomo: resultado.offsetDeAtomo,
    });
    const titulo = resultado.titulo
      || (archivo?.name || 'Documento').replace(/\.pdf$/i, '');
    const idioma = deps.detectarIdioma
      ? deps.detectarIdioma(resultado.texto.slice(0, 4000))
      : 'es';
    const id = archivo
      ? `${(archivo.name || 'doc').toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40)}-${archivo.size || 0}`
      : `doc-${Date.now().toString(36)}`;

    /* La primera vez que se guarda algo, se pide al navegador que no lo borre. */
    const permiso = await almacen.pedirPersistencia();

    try {
      await almacen.guardarDocumento({
        meta: {
          id,
          titulo,
          nombreArchivo: archivo?.name || '',
          idioma,
          totalPaginas: resultado.totalPaginas || 0,
          paginasLeidas: resultado.paginasLeidas || 0,
          origen,
          versionTroceo: VERSION_TROCEO,
          versionReconstruccion: VERSION_RECONSTRUCCION,
          pendientesLimites: estado.pendientesLimites,
          listoParaLectura: estado.pendientesLimites === 0,
          needsSource: false,
          sincronizar: true,
          capitulos,
          bytes: archivo?.size || 0,
          progreso: progresoInicial(),
          estado: 'sin-empezar',
        },
        partes,
        pdf: archivo || null,
        portada,
        reconstruccion: serializarReconstruccion(resultado),
      });
      /* Los bloques viajan aparte para poder reanudar la auditoría al
       * reabrir el libro sin recomputar nada ni repetir gastos de IA. */
      await almacen.guardarBloquesDocumento(id, bloques).catch(() => {});
    } catch (error) {
      avisar(error.message || 'No se pudo guardar el documento en la biblioteca.', 'err');
      return { ok: false, error };
    }

    await montarDocumento({ id, titulo, partes, totalPaginas: resultado.totalPaginas, idioma, capitulos, bloques });
    await refrescarInicio();
    sincronizarAhora({ silencioso: true });

    if (permiso.soportado && !permiso.concedido) {
      console.info('[jg-pdf] el navegador no concedió almacenamiento persistente');
    }
    return { ok: true, id, titulo };
  }

  async function procesar() {
    if (!estado.archivo || estado.trabajando) return;
    const rango = leerRango();
    estado.cancelacion = { cancelado: false };
    bloquear(true);
    avisar('');
    if (el.ocrBox) el.ocrBox.hidden = true;
    mostrarProgreso(true, 'Abriendo el documento…', 2);

    try {
      const resultado = await procesarPdf(estado.archivo, {
        desde: rango.desde,
        hasta: rango.hasta,
        cancelacion: estado.cancelacion,
        alCargar: (pct) => mostrarProgreso(true, 'Abriendo el documento…', Math.min(12, pct / 8)),
        alProgresar: (hechas, total) => {
          const pct = 12 + Math.round((hechas / Math.max(1, total)) * 86);
          mostrarProgreso(true, `Leyendo página ${hechas} de ${total}…`, pct);
        },
      });

      if (resultado.cancelado) {
        mostrarProgreso(false);
        avisar('Lectura cancelada. El documento sigue elegido por si quieres reintentarlo.', 'info');
        return;
      }

      if (resultado.escaneado) {
        mostrarProgreso(false);
        avisar(
          'Este PDF no tiene texto dentro: son imágenes de las páginas (un escaneo o una foto). ' +
          'Puedes reconocer las letras aquí mismo con OCR, o convertirlo antes en Google Drive ' +
          '(abrirlo con «Documentos de Google» y descargarlo de nuevo).',
          'warn'
        );
        if (el.ocrBox) {
          el.ocrBox.hidden = false;
          el.ocrTexto.textContent =
            `Este documento tiene ${resultado.totalPaginas} página(s) de imágenes. ` +
            'Reconocer las letras es lento: se hace página por página, en tu dispositivo. ' +
            'Empieza por unas pocas para ver qué tal sale.';
        }
        return;
      }

      const guardado = await entregarDocumento(resultado, { origen: 'texto', portada: resultado.portada });
      if (!guardado?.ok) return;
      mostrarProgreso(false);

      const recorte = rango.hasta || rango.desde > 1
        ? ` · páginas ${rango.desde}-${rango.hasta || resultado.totalPaginas}`
        : '';
      const detalleGuardado = `${resultado.paginasLeidas} págs${recorte} · ${resultado.texto.length.toLocaleString('es-CO')} caracteres` +
        (resultado.descartadas ? ` · se quitaron ${resultado.descartadas} líneas de encabezados` : '');
      avisar(`Listo · ${resultado.paginasLeidas} páginas${recorte} · en tu biblioteca`, 'ok', { efimero: true });
      // Detalle completo en el title para quien lo necesite, sin ocupar 4 líneas en móvil
      if (el.notice) el.notice.title = `Guardado: ${detalleGuardado}`;
    } catch (error) {
      mostrarProgreso(false);
      const mensaje = error instanceof ErrorPdf
        ? error.message
        : `No se pudo leer el PDF: ${error?.message || 'error desconocido'}`;
      avisar(mensaje, 'err');
      console.warn('[jg-pdf]', error);
    } finally {
      bloquear(false);
      estado.cancelacion = null;
    }
  }

  /* ── OCR ─────────────────────────────────────────────────────────── */

  async function ejecutarOcr() {
    if (!estado.archivo || estado.trabajando) return;
    const tope = parseInt(el.ocrPaginas.value, 10) || 0;
    const idioma = el.ocrLang.value || 'spa';

    let reconocer;
    try {
      ({ reconocerPaginas: reconocer } = await import('./ocrPdf.js'));
    } catch (error) {
      avisar('No se pudo cargar el motor de reconocimiento. Revisa tu conexión e inténtalo de nuevo.', 'err');
      console.warn('[jg-ocr]', error);
      return;
    }

    estado.cancelacion = { cancelado: false };
    bloquear(true);
    el.ocrLabel.textContent = 'Reconociendo…';
    mostrarProgreso(true, 'Preparando el reconocimiento…', 1);

    try {
      const { paginas, cancelado } = await reconocer(estado.archivo, {
        desde: 1,
        hasta: tope || undefined,
        idioma,
        cancelacion: estado.cancelacion,
        alProgresar: (info) => {
          if (info.etapa === 'motor') { mostrarProgreso(true, info.mensaje, 3); return; }
          if (info.etapa !== 'ocr') return;
          const pct = 5 + Math.round((info.hechas / Math.max(1, info.total)) * 93);
          const falta = info.segundosRestantes != null && info.segundosRestantes > 0
            ? ` · faltan unos ${info.segundosRestantes >= 60
              ? `${Math.round(info.segundosRestantes / 60)} min`
              : `${info.segundosRestantes} s`}`
            : '';
          mostrarProgreso(true, `Reconociendo página ${info.hechas + 1} de ${info.total}${falta}`, pct);
        },
      });

      if (cancelado && !paginas.length) {
        mostrarProgreso(false);
        avisar('Reconocimiento cancelado.', 'info');
        return;
      }

      const resultado = componerTexto(paginas, {});
      if (!resultado.texto.trim()) {
        mostrarProgreso(false);
        avisar(
          'El reconocimiento no encontró letras legibles. Puede que el escaneo esté muy borroso o torcido. ' +
          'Prueba con otro idioma en la lista, o con una copia del documento de mejor calidad.',
          'warn'
        );
        return;
      }

      const leidas = paginas.filter((p) => p.lineas && p.lineas.length).length;
      resultado.totalPaginas = estado.totalPaginas || paginas.length;
      resultado.paginasLeidas = paginas.length;
      await entregarDocumento(resultado, { origen: 'ocr' });
      mostrarProgreso(false);
      avisar(
        `Reconocidas ${leidas} de ${paginas.length} página(s) con OCR` +
        (cancelado ? ' (cancelaste antes de terminar; queda lo que alcanzó a leer)' : '') +
        '. Revisa el texto: el reconocimiento se equivoca más que un PDF con texto de verdad.',
        cancelado ? 'warn' : 'ok'
      );
    } catch (error) {
      mostrarProgreso(false);
      avisar(`No se pudo reconocer el documento: ${error?.message || 'error desconocido'}`, 'err');
      console.warn('[jg-ocr]', error);
    } finally {
      bloquear(false);
      el.ocrLabel.textContent = 'Leer con OCR';
      estado.cancelacion = null;
    }
  }

  function actualizarAvisoOcr() {
    if (!el.ocrHint) return;
    const paginas = parseInt(el.ocrPaginas.value, 10) || estado.totalPaginas || 0;
    import('./ocrPdf.js').then(({ estimarMinutos }) => {
      const minutos = estimarMinutos(paginas || 10);
      el.ocrHint.textContent =
        `Unos ${minutos} minuto(s) para ${paginas || 'todas las'} página(s). ` +
        'La primera vez descarga el motor (unos 6 MB). Todo pasa en tu dispositivo.';
    }).catch(() => {});
  }

  /* ── Buscador dentro del documento ───────────────────────────────── */

  function buscar(termino) {
    guardarEdicionActual();
    const limpio = String(termino || '').trim();
    estado.busqueda = { termino: limpio, golpes: [], indice: -1 };
    if (limpio.length < 2) {
      el.buscarInfo.textContent = '';
      el.buscarInfo.removeAttribute('data-estado');
      return;
    }
    const aguja = limpio.toLowerCase();
    estado.partes.forEach((parte, iParte) => {
      const heno = textoDeParte(iParte).toLowerCase();
      let desde = 0;
      while (estado.busqueda.golpes.length < 500) {
        const pos = heno.indexOf(aguja, desde);
        if (pos < 0) break;
        estado.busqueda.golpes.push({ parte: iParte, desde: pos, hasta: pos + limpio.length });
        desde = pos + limpio.length;
      }
    });
    if (!estado.busqueda.golpes.length) {
      el.buscarInfo.textContent = 'Sin resultados';
      el.buscarInfo.dataset.estado = 'vacio';
      return;
    }
    el.buscarInfo.removeAttribute('data-estado');
    irAResultado(0);
  }

  function irAResultado(indice) {
    const golpes = estado.busqueda.golpes;
    if (!golpes.length) return;
    const total = golpes.length;
    const i = ((indice % total) + total) % total;
    estado.busqueda.indice = i;
    const golpe = golpes[i];
    el.buscarInfo.textContent = `${i + 1} de ${total}`;
    mostrarParte(golpe.parte, { seleccionar: { desde: golpe.desde, hasta: golpe.hasta } });
  }

  /* ── Audiolibro ──────────────────────────────────────────────────── */

  function pintarBotonAudiolibro(activo) {
    if (!el.audiolibro) return;
    el.audiolibro.classList.toggle('is-on', activo);
    el.audiolibro.setAttribute('aria-pressed', activo ? 'true' : 'false');
    el.audiolibroLabel.textContent = activo
      ? 'Detener la lectura del documento'
      : 'Escuchar el documento completo';
    el.audiolibroHint.textContent = activo
      ? `Leyendo el capítulo ${estado.parteActual + 1} de ${estado.partes.length}. Al terminar sigue con el próximo.`
      : 'Encadena un capítulo tras otro sin que tengas que hacer nada, y recuerda dónde ibas.';
  }

  function detenerAudiolibro() {
    if (estado.audiolibro.vigilante) {
      clearInterval(estado.audiolibro.vigilante);
      estado.audiolibro.vigilante = null;
    }
    if (deps.audiolibro?.estaActivo?.()) deps.audiolibro.detener();
    pintarBotonAudiolibro(false);
  }

  async function alternarAudiolibro() {
    if (!deps.audiolibro || !hayDocumento()) return;
    if (deps.audiolibro.estaActivo()) { detenerAudiolibro(); return; }

    guardarEdicionActual();
    // TTS asíncrono: esperar capa disponible (aprobada→segura→local→original) y precargar primer audio del siguiente
    const esperarCapa = async (idx) => {
      if (estado.textoAprobadoPorBloque.has(`cap_${idx}`)) return estado.textoAprobadoPorBloque.get(`cap_${idx}`);
      if (estado.textoSeguroPorBloque.has(`cap_${idx}`)) return estado.textoSeguroPorBloque.get(`cap_${idx}`);
      if (estado.pulido.has(idx)) return estado.pulido.get(idx);
      // si auditoría en curso, esperar hasta 3s
      if (estado.auditor && estado.auditoriaEstado.startsWith('Auditando')) {
        try { await Promise.race([new Promise(r=>setTimeout(r, 2500)), asegurarPulido(idx, { mostrar: false })]); } catch(_){}
        if (estado.textoSeguroPorBloque.has(`bloq_${idx}`)) return estado.textoSeguroPorBloque.get(`bloq_${idx}`);
      }
      return null;
    };
    const capaActual = await esperarCapa(estado.parteActual);
    const textoBruto = capaActual || textoDeParte(estado.parteActual);
    if (!textoBruto.trim()) return;
    // En español monolingüe, respetar voz regional (no forzar multilingüe); solo usar multi si preferencia o contenido lo pide
    const langVoz = estado.vista === 'es' ? 'es' : idiomaActual();
    // unidades de narración estructuradas: títulos con pausa mayor, tablas con indicación temporal
    let textoParaVoz = textoBruto;
    const bloqueTipo = estado.bloques[estado.parteActual]?.tipo;
    if (bloqueTipo === 'titulo') textoParaVoz = textoBruto + '\n\n';
    else if (bloqueTipo === 'tabla') textoParaVoz = 'Tabla. ' + textoBruto + ' Fin tabla.';
    else if (bloqueTipo === 'lista') textoParaVoz = textoBruto.replace(/^[-•]\s*/gm, '');
    const texto = prepararParaVoz(textoParaVoz, langVoz, { neural: true });

    // Prefetch del siguiente capítulo en segundo plano para encadenado sin huecos
    const siguienteIndice = estado.parteActual + 1;
    if (estado.partes[siguienteIndice] && typeof window.ttsFetchNeuralChunk === 'function') {
      try {
        const proximoBrutoPrefetch = textoDeParte(siguienteIndice) || estado.partes[siguienteIndice]?.texto || '';
        if (proximoBrutoPrefetch.trim()) {
          const langPrefetch = estado.vista === 'es' ? 'es' : idiomaActual();
          const textoPrefetch = prepararParaVoz(proximoBrutoPrefetch, langPrefetch);
          // Calentar el primer bloque (~500 caracteres) en caché GET del servidor/CDN
          const primerChunk = textoPrefetch.slice(0, 500);
          if (primerChunk.length > 40) {
            // No bloquear: si el usuario eligió Fish, igualmente calienta neural (más rápido y estable para PDF largo)
            setTimeout(() => {
              try {
                const prefs = typeof ttsPrefs === 'function' ? ttsPrefs() : { preferFish: false };
                // Forzar neural para prefetch PDF
                const prefsPdf = { ...prefs, preferFish: false, fishId: '' };
                const probe = typeof ttsCrearCola === 'function' ? ttsCrearCola(primerChunk, langPrefetch, 500, prefsPdf.bilingualMode || 'regional') : [];
                if (probe && probe[0] && typeof window.ttsFetchNeuralChunk === 'function') {
                  window.ttsFetchNeuralChunk(probe[0], prefsPdf, 1, 'pdf').catch(()=>{});
                }
              } catch (_) {}
            }, 1200);
          }
        }
      } catch (_) {}
    }

    deps.audiolibro.iniciar({
      sourceId: 'pdf',
      texto,
      lang: langVoz,
      siguiente: () => {
        /* Capa disponible de un capítulo (aprobada → segura → la que se ve). */
        const capaDe = (i) => (
          estado.textoAprobadoPorBloque.get(`cap_${i}`)
          || estado.textoSeguroPorBloque.get(`cap_${i}`)
          || textoDeParte(i) || ''
        ).trim();

        /* Un capítulo que quedó vacío al limpiar el PDF no tiene nada que
         * leer, pero devolver null aquí el motor lo entendía como «se acabó
         * el libro»: la lectura del audiolibro se paraba en seco a mitad.
         * Ahora se salta hasta encontrar uno con texto. */
        let idx = estado.parteActual + 1;
        while (idx < estado.partes.length && !capaDe(idx)) idx += 1;
        if (idx >= estado.partes.length) return null;

        const capaSig = capaDe(idx);
        mostrarParte(idx);
        pintarBotonAudiolibro(true);
        const proximoLang = estado.vista === 'es' ? 'es' : idiomaActual();
        return {
          texto: prepararParaVoz(capaSig, proximoLang, { neural: true }),
          lang: proximoLang,
          continuation: Boolean(estado.partes[idx]?.continuation),
        };
      },
      alTerminar: () => {
        detenerAudiolibro();
        avisar('Terminó la lectura del documento.', 'ok');
      },
    });

    pintarBotonAudiolibro(true);
    estado.audiolibro.vigilante = setInterval(() => {
      if (!deps.audiolibro.estaActivo()) detenerAudiolibro();
    }, 1500);
  }

  /* ── Exportar ────────────────────────────────────────────────────── */

  function nombreArchivo(extension) {
    const base = (estado.titulo || 'documento')
      .toLowerCase()
      .normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 45) || 'documento';
    return `jg-turbo-${base}-${new Date().toISOString().slice(0, 10)}.${extension}`;
  }

  function descargar(nombre, datos, tipo) {
    const blob = datos instanceof Blob ? datos : new Blob([datos], { type: tipo });
    const enlace = document.createElement('a');
    const url = URL.createObjectURL(blob);
    enlace.href = url;
    enlace.download = nombre;
    enlace.click();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
  }

  function partesParaExportar({ usarAprobado = true } = {}) {
    // usarAprobado: por defecto la exportación usa la versión aprobada (revisadoSeguro + aceptadas),
    // con fallback a textoDeParte (que ya resuelve pulido/aprobado). Original explícito vía flag.
    const visibles = partesVisibles();
    if (usarAprobado) {
      // mapear aprobados por capítulo si existen
      return visibles.map((p, i) => {
        const aprobado = estado.textoAprobadoPorBloque.get(`cap_${i}`) || estado.textoSeguroPorBloque.get(`bloq_${i}`) || p.texto;
        return { titulo: p.titulo, texto: aprobado, tipo: 'parrafo' };
      });
    }
    if (visibles.length === 1) return [{ titulo: '', texto: visibles[0].texto }];
    return visibles;
  }
  function partesParaExportarOriginal() {
    return estado.partes.map((p, i) => ({ titulo: p.titulo, texto: p.texto }));
  }

  function exportarDocx() {
    try {
      // Usar estructura real de títulos/listas/tablas y versión aprobada
      descargar(nombreArchivo('docx'),
        construirDocx(estado.titulo || 'Documento', partesParaExportar({ usarAprobado: true })),
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
      avisar('Documento de Word descargado (versión aprobada, con estructura).', 'ok');
    } catch (error) {
      avisar('No se pudo crear el documento de Word.', 'err');
      console.warn('[jg-pdf] docx', error);
    }
  }
  function exportarDocxOriginal() {
    try {
      descargar(nombreArchivo('original.docx'),
        construirDocx(estado.titulo || 'Documento (original)', partesParaExportarOriginal()),
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
      avisar('Documento original descargado.', 'ok');
    } catch (e) { avisar('No se pudo crear el original.', 'err'); }
  }

  function exportarMarkdown() {
    descargar(nombreArchivo('md'),
      construirMarkdown(estado.titulo || 'Documento', partesParaExportar({ usarAprobado: true })),
      'text/markdown;charset=utf-8');
    avisar('Markdown descargado (aprobado).', 'ok');
  }

  function exportarPdf() {
    const html = construirHtmlImpresion(estado.titulo || 'Documento', partesParaExportar({ usarAprobado: true }));
    const ventana = window.open('', '_blank');
    if (!ventana) {
      avisar(
        'El navegador bloqueó la ventana de impresión. Permite las ventanas emergentes de esta página ' +
        'y vuelve a pulsar «PDF limpio».', 'warn');
      return;
    }
    ventana.document.write(html);
    ventana.document.close();
    avisar('Se abrió la vista de impresión (aprobado). Original disponible en exportación TXT original.', 'info');
  }

  /* ── Preguntar al documento ──────────────────────────────────────── */

  function contextoPara(pregunta) {
    const completo = textoCompleto();
    if (completo.length <= LIMITE_CONTEXTO_IA) return completo;

    const bloques = [];
    for (let i = 0; i < completo.length; i += TAM_BLOQUE_BUSQUEDA) {
      bloques.push({ id: i, texto: completo.slice(i, i + TAM_BLOQUE_BUSQUEDA) });
    }
    const cuantos = Math.max(1, Math.floor(LIMITE_CONTEXTO_IA / TAM_BLOQUE_BUSQUEDA));
    const elegidos = buscarRelevantes(construirIndice(bloques), pregunta, { maximo: cuantos });
    if (!elegidos.length) return completo.slice(0, LIMITE_CONTEXTO_IA);

    return elegidos
      .map((r) => bloques.find((b) => b.id === r.id))
      .filter(Boolean)
      .sort((a, b) => a.id - b.id)
      .map((b) => b.texto)
      .join('\n\n[…]\n\n')
      .slice(0, LIMITE_CONTEXTO_IA);
  }

  function bloquearIA(ocupado, etiqueta) {
    [el.askBtn, el.resumen, el.ideas, el.resumenTodo].forEach((b) => { if (b) b.disabled = ocupado; });
    el.askLabel.textContent = etiqueta || 'Preguntar';
  }

  function responder(texto, situacion = 'ok') {
    el.askAnswer.hidden = false;
    el.askClear.hidden = false;
    el.askAnswer.dataset.estado = situacion;
    el.askAnswer.textContent = texto;
  }

  async function preguntar(pregunta, modo = 'pregunta') {
    if (!deps.preguntarIA || !hayDocumento()) return;
    const textoPregunta = String(pregunta || '').trim();
    if (modo === 'pregunta' && !textoPregunta) { el.askInput.focus(); return; }

    guardarEdicionActual();
    const contexto = modo === 'pregunta'
      ? contextoPara(textoPregunta)
      : el.salida.value.slice(0, LIMITE_CONTEXTO_IA);
    if (!contexto.trim()) { responder('No hay texto sobre el que preguntar.', 'error'); return; }

    bloquearIA(true, 'Pensando…');
    responder('Leyendo el documento y preparando la respuesta…', 'cargando');
    try {
      const respuesta = await deps.preguntarIA({
        text: contexto,
        question: textoPregunta,
        mode: modo,
        title: estado.titulo,
        language: estado.vista === 'es' ? 'es' : idiomaActual(),
      });
      responder(respuesta || 'La IA no devolvió respuesta. Intenta de nuevo.', 'ok');
    } catch (error) {
      responder(error?.message || 'No se pudo consultar a la IA. Revisa tu conexión o la clave en «Servidor e IA».', 'error');
    } finally {
      bloquearIA(false);
    }
  }

  async function resumirTodo() {
    if (!deps.preguntarIA || estado.partes.length < 2) return;
    guardarEdicionActual();

    const tarea = { cancelado: false };
    estado.tareaIA = tarea;
    const total = estado.partes.length;
    bloquearIA(true, 'Resumiendo…');
    el.askProgArea.hidden = false;
    responder(`Resumiendo los ${total} capítulos del documento, uno por uno…`, 'cargando');

    const avance = (hechas, mensaje) => {
      el.askProg.style.width = `${Math.round((hechas / (total + 1)) * 100)}%`;
      el.askProgLabel.textContent = mensaje;
    };

    try {
      const resumenes = [];
      for (let i = 0; i < total; i += 1) {
        if (tarea.cancelado) break;
        avance(i, `Capítulo ${i + 1} de ${total}: ${estado.partes[i].titulo}`);
        const trozo = textoDeParte(i).slice(0, LIMITE_CONTEXTO_IA);
        if (!trozo.trim()) continue;
        try {
          const resumen = await deps.preguntarIA({
            text: trozo,
            mode: 'resumen',
            title: `${estado.titulo} · ${estado.partes[i].titulo}`,
            language: estado.vista === 'es' ? 'es' : idiomaActual(),
          });
          if (resumen) resumenes.push(`${estado.partes[i].titulo}: ${resumen}`);
        } catch (_) {
          resumenes.push(`${estado.partes[i].titulo}: (no se pudo resumir este capítulo)`);
        }
      }

      if (tarea.cancelado) {
        responder(resumenes.length
          ? `Resumen incompleto (cancelaste): \n\n${resumenes.join('\n\n')}`
          : 'Resumen cancelado.', 'ok');
        return;
      }
      if (!resumenes.length) { responder('No se pudo resumir ningún capítulo.', 'error'); return; }

      avance(total, 'Uniendo los resúmenes en uno solo…');
      let sintesis = '';
      try {
        sintesis = await deps.preguntarIA({
          text: resumenes.join('\n\n').slice(0, LIMITE_CONTEXTO_IA),
          mode: 'sintesis',
          title: estado.titulo,
          language: 'es',
        });
      } catch (_) { /* si falla la unión, quedan los resúmenes */ }

      responder(sintesis
        ? `${sintesis}\n\n———\nResumen por capítulos:\n\n${resumenes.join('\n\n')}`
        : resumenes.join('\n\n'), 'ok');
    } finally {
      estado.tareaIA = null;
      el.askProgArea.hidden = true;
      el.askProg.style.width = '0%';
      bloquearIA(false);
    }
  }

  /* ── Eventos ─────────────────────────────────────────────────────── */

  el.drop.addEventListener('click', () => { if (!estado.trabajando) el.input.click(); });
  el.drop.addEventListener('keydown', (evento) => {
    if (evento.key !== 'Enter' && evento.key !== ' ') return;
    evento.preventDefault();
    if (!estado.trabajando) el.input.click();
  });
  ['dragenter', 'dragover'].forEach((tipo) => el.drop.addEventListener(tipo, (e) => {
    e.preventDefault();
    el.drop.classList.add('dragover');
  }));
  ['dragleave', 'drop'].forEach((tipo) => el.drop.addEventListener(tipo, (e) => {
    e.preventDefault();
    el.drop.classList.remove('dragover');
  }));
  el.drop.addEventListener('drop', (e) => {
    const archivo = e.dataTransfer?.files?.[0];
    if (archivo) seleccionarArchivo(archivo);
  });
  el.input.addEventListener('change', () => seleccionarArchivo(el.input.files?.[0]));
  el.input.addEventListener('input', () => seleccionarArchivo(el.input.files?.[0]));
  if (el.input.files?.[0]) seleccionarArchivo(el.input.files[0]);

  el.leer.addEventListener('click', procesar);
  el.cancelar.addEventListener('click', () => {
    if (estado.cancelacion) estado.cancelacion.cancelado = true;
    mostrarProgreso(true, 'Cancelando…');
  });
  el.from.addEventListener('input', leerRango);
  el.to.addEventListener('input', leerRango);

  if (el.anadir) el.anadir.addEventListener('click', () => {
    el.subir?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    setTimeout(() => el.input.click(), 260);
  });

  document.querySelectorAll('.pdf-filtro').forEach((boton) => {
    boton.addEventListener('click', () => {
      document.querySelectorAll('.pdf-filtro').forEach((b) => b.classList.toggle('is-on', b === boton));
      estado.filtro = boton.dataset.filtro || 'todos';
      pintarBiblioteca();
    });
  });
  let temporizadorLibros = null;
  if (el.buscarLibro) el.buscarLibro.addEventListener('input', () => {
    clearTimeout(temporizadorLibros);
    temporizadorLibros = setTimeout(() => {
      estado.consulta = el.buscarLibro.value.trim().toLowerCase();
      pintarBiblioteca();
    }, 200);
  });

  el.btnIndice.addEventListener('click', () => {
    if (!el.indice.hidden) cerrarHojas();
    else abrirHoja('indice');
  });

  /* «Opciones» es un <details>. Se le quita el abrir/cerrar automático del
   * navegador (preventDefault sobre el <summary>) para que abrir y cerrar
   * pasen siempre por el mismo sitio: así el fondo, el foco y el paso en el
   * historial no se desincronizan nunca del estado real del panel. */
  if (el.btnMas && el.masMenu) {
    el.btnMas.addEventListener('click', (e) => {
      e.preventDefault();
      if (el.masMenu.open) cerrarHojas();
      else abrirHoja('opciones');
    });
  }

  /* Cerrar: el fondo, la ✕ de cada hoja y la tecla Escape. Tres caminos para
   * lo mismo porque cerrar no puede depender de adivinar dónde tocar. */
  if (el.hojaFondo) el.hojaFondo.addEventListener('click', () => cerrarHojas());
  /* En escritorio no hay fondo oscuro (el menú es un desplegable, no una
   * hoja), así que el «clic fuera» se detecta aquí: es lo que cualquiera
   * espera de un menú y evita que se quede abierto tapando el texto. */
  document.addEventListener('pointerdown', (e) => {
    if (!el.masMenu || !el.masMenu.open) return;
    if (e.target.closest('#pdfMasMenu')) return;
    if (e.target.closest('#pdfHojaFondo')) return;
    cerrarHojas();
  });
  el.resultArea.addEventListener('click', (e) => {
    const cerrar = e.target.closest('[data-cerrar-hoja]');
    if (cerrar) { e.preventDefault(); cerrarHojas(); }
  });
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (hayHojaAbierta()) { e.preventDefault(); cerrarHojas(); return; }
    if (document.body.classList.contains('jg-pantalla')) { e.preventDefault(); fijarPantallaCompleta(false); }
  });

  /* Pantalla completa en escritorio: aparta encabezado y pestañas, como ya
   * hace el celular al abrir un libro. Se recuerda entre sesiones porque
   * quien lee en el computador suele querer siempre lo mismo. */
  function fijarPantallaCompleta(activa) {
    document.body.classList.toggle('jg-pantalla', activa);
    if (el.pantalla) {
      el.pantalla.setAttribute('aria-pressed', activa ? 'true' : 'false');
      const texto = activa ? 'Salir de pantalla completa' : 'Leer a pantalla completa';
      el.pantalla.title = texto;
      el.pantalla.setAttribute('aria-label', texto);
    }
    try { localStorage.setItem('jg_pdf_pantalla', activa ? '1' : '0'); } catch (_) { /* solo esta sesión */ }
  }
  function pantallaGuardada() {
    try { return localStorage.getItem('jg_pdf_pantalla') === '1'; } catch (_) { return false; }
  }
  if (el.pantalla) {
    el.pantalla.addEventListener('click', () => {
      fijarPantallaCompleta(!document.body.classList.contains('jg-pantalla'));
    });
  }

  /* Buscar: plegado por defecto. En el celular, una fila fija de búsqueda le
   * quitaba 60 px al texto durante toda la lectura. */
  if (el.buscarToggle) el.buscarToggle.addEventListener('click', () => {
    const abrir = el.buscarFila.hidden;
    el.buscarFila.hidden = !abrir;
    el.buscarToggle.setAttribute('aria-expanded', abrir ? 'true' : 'false');
    if (abrir) el.buscar.focus();
    else { el.buscar.value = ''; buscar(''); }
  });
  el.prev.addEventListener('click', () => mostrarParte(estado.parteActual - 1));
  el.next.addEventListener('click', () => mostrarParte(estado.parteActual + 1));

  let temporizadorBusqueda = null;
  el.buscar.addEventListener('input', () => {
    clearTimeout(temporizadorBusqueda);
    temporizadorBusqueda = setTimeout(() => buscar(el.buscar.value), 250);
  });
  el.buscar.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    if (estado.busqueda.golpes.length) irAResultado(estado.busqueda.indice + 1);
    else buscar(el.buscar.value);
  });
  el.buscarNext.addEventListener('click', () => irAResultado(estado.busqueda.indice + 1));
  el.buscarPrev.addEventListener('click', () => irAResultado(estado.busqueda.indice - 1));

  function volverABiblioteca({ desdeHistorial = false } = {}) {
    cerrarDocumento({ desdeHistorial });
    refrescarInicio();
    sincronizarAhora({ silencioso: true });
  }

  el.volver.addEventListener('click', () => volverABiblioteca());

  if (el.capPrev) el.capPrev.addEventListener('click', () => {
    if (hayDocumento() && estado.parteActual > 0) mostrarParte(estado.parteActual - 1);
  });
  if (el.capNext) el.capNext.addEventListener('click', () => {
    if (hayDocumento() && estado.parteActual + 1 < estado.partes.length) mostrarParte(estado.parteActual + 1);
  });

  /* Actualizar la biblioteca desde la cabecera: trae los libros de los otros
   * aparatos sin tener que bajar hasta la sección de sincronización. Si este
   * aparato aún no está vinculado, abre esa sección para vincularlo. */
  if (el.actualizarBiblio) el.actualizarBiblio.addEventListener('click', () => {
    if (!nube || !nube.estaVinculada()) {
      /* Sin nube no hay nada que traer. Se dice con palabras Y se abre la
       * sección: abrirla sin explicar por qué dejaba al usuario mirando un
       * panel que no había pedido. */
      avisar('Este aparato aún no está conectado con los otros. Conéctalo aquí abajo para traer tus libros y sus carátulas.', 'info');
      if (el.nube) {
        el.nube.hidden = false;
        el.nube.open = true;
        el.nube.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      }
      return;
    }
    sincronizarAhora({ desdeCabecera: true });
  });

  if (el.reanudarInicio) el.reanudarInicio.addEventListener('click', () => {
    if (!hayDocumento()) return;
    el.reanudar.hidden = true;
    mostrarParte(0, { desplazamiento: 0 });
    estado.progreso = avanzarProgreso(estado.progreso, { parte: 0, desplazamiento: 0, caracter: 0, cita: '', antes: '' });
    irAPosicion(0, { centrar: false });
    guardarProgresoPronto();
  });

  el.salida.addEventListener('input', () => {
    guardarEdicionActual();
    actualizarContador();
  });

  /* Al desplazarse se anota el avance; al llegar al final, el capítulo
   * siguiente se abre solo: leer no debería exigir buscar un botón. */
  let temporizadorScroll = null;
  el.salida.addEventListener('scroll', () => {
    /* Si el movimiento lo acaba de hacer la voz, no cuenta como «la persona
     * se desplazó»: anotar ahí duplicaría el progreso y, peor, dispararía el
     * salto de capítulo a mitad de una lectura en voz alta. */
    if (voz.desplazando) return;
    if (voz.siguiendo && ttsSonandoAqui()) voz.pausaManual = Date.now();
    clearTimeout(temporizadorScroll);
    temporizadorScroll = setTimeout(() => {
      if (!hayDocumento()) return;
      const fraccion = desplazamientoActual();
      /* Sin `caracter`: `anotarPosicion` lo deduce de lo que se ve. */
      anotarPosicion({ desplazamiento: fraccion });
      if (fraccion > 0.995 && estado.parteActual + 1 < estado.partes.length) {
        mostrarParte(estado.parteActual + 1);
      }
    }, 220);
  });

  /* ── Tocar dos veces el texto: leer desde ahí ───────────────────────
   *
   * Doble toque y no toque simple: el textarea es editable y seleccionable, y
   * un toque simple tiene que seguir sirviendo para poner el cursor. El doble
   * toque no compite con nada y es el gesto que la gente ya usa para
   * seleccionar una palabra, así que se descubre solo.
   */
  el.salida.addEventListener('dblclick', () => {
    if (!hayDocumento()) return;
    const punto = el.salida.selectionStart;
    if (punto == null) return;

    /* Se ancla al comienzo de la frase: empezar a media frase suena a error. */
    const frases = partirEnFrases(el.salida.value || '');
    const rango = frases.length ? fraseEn(frases, punto) : null;
    const desde = rango ? rango[0] : punto;

    anotarPosicion({ caracter: desde });

    /* Si ya hay voz sonando en este capítulo, se salta ahí al instante. */
    const destino = bloqueDeCaracter(desde);
    if (destino && ttsSonandoAqui() && typeof window.ttsIrABloque === 'function') {
      guia.saltar = true;   /* salto pedido por la persona: puede ir hacia atrás */
      window.ttsIrABloque(destino.bloque, destino.dentro);
      avisar('Leyendo desde aquí.', 'info');
      return;
    }
    /* Si no había voz, se marca el punto y se ofrece empezar. */
    irAPosicion(desde);
    avisar('Marcado. Pulsa Escuchar para leer desde aquí.', 'info');
  });

  /* ── El texto sigue a la voz ───────────────────────────────────────
   *
   * Escuchando un libro, la pregunta constante es «¿por dónde va?». Aquí el
   * texto se desplaza solo al ritmo del audio, y el progreso del libro avanza
   * mientras se escucha (antes solo avanzaba leyendo con los ojos: podías
   * oír tres capítulos y el libro seguía marcando 0 %).
   *
   * Si la persona se desplaza a mano, se aparta unos segundos —para poder
   * mirar atrás sin pelearse con la pantalla— y luego retoma. */
  const ESPERA_TRAS_TOCAR_MS = 8000;
  const voz = { siguiendo: leerPreferenciaSeguir(), desplazando: false, pausaManual: 0 };

  function leerPreferenciaSeguir() {
    try { return localStorage.getItem('jg_pdf_seguir_voz') !== '0'; } catch (_) { return true; }
  }
  function ttsSonandoAqui() {
    const s = (typeof window !== 'undefined' && window.ttsState) || null;
    return !!s && s.sourceId === 'pdf' && s.status === 'playing';
  }

  /* ── Guía visual: la frase que suena, resaltada ────────────────────
   *
   * El texto vive en un <textarea>, que no admite marcas por dentro. La
   * solución es una capa gemela justo debajo, con la misma tipografía y los
   * mismos márgenes: ahí se pinta la frase y se ve a través del textarea,
   * que sigue siendo editable, seleccionable y buscable.
   *
   * Precisión: el servidor devuelve el audio como MP3, sin marcas de tiempo
   * por palabra, así que la posición se deduce del avance del audio y se
   * ajusta al comienzo de la frase más cercana. Es una guía de lectura
   * fiable, no un karaoke palabra por palabra.
   */
  const guia = {
    texto: null, frases: [], desde: -1, cola: null, anclas: [], compacto: '', mapa: null,
    /* Cuántos bloques tenía la cola cuando se situaron las anclas: si crece,
     * hay que volver a situarlas o la marca barre el capítulo entero. */
    bloques: 0,
    /* Lo levanta quien salta a propósito (capítulo, doble toque, botones,
     * barra): es el único caso en que la marca puede ir hacia atrás. */
    saltar: false,
    /* Carácter desde el que arrancó esta lectura (−1 = desde el principio).
     * Sirve para saber que un audio más corto que el capítulo NO es una
     * selección suelta, sino este capítulo empezado más abajo. */
    desdeCaracter: -1,
  };

  /**
   * Reduce un texto a sus caracteres con significado (letras y números, sin
   * tildes ni mayúsculas) y recuerda de dónde salió cada uno.
   *
   * Es la pieza que permite casar lo que suena con lo que se ve: el motor de
   * voz reescribe el texto antes de hablarlo —junta espacios, mete puntos al
   * final de los párrafos, separa términos en inglés—, así que buscarlo tal
   * cual no encuentra nada. Comparando solo letras y números, sí encaja.
   */
  const TILDES = /[\u0300-\u036f]/g;   /* marcas de tilde, ya separadas por NFD */
  function compactar(texto) {
    const letras = [];
    const posiciones = [];
    /* Se recorre carácter a carácter —y no sobre el texto ya normalizado—
     * porque descomponer tildes cambia las longitudes y descuadraría el mapa
     * que devuelve las posiciones al texto original. */
    for (let i = 0; i < texto.length; i += 1) {
      const suelto = texto[i].normalize('NFD').replace(TILDES, '').toLowerCase();
      const c = suelto.charAt(0);
      if ((c >= 'a' && c <= 'z') || (c >= '0' && c <= '9')) {
        letras.push(c);
        posiciones.push(i);
      }
    }
    return { texto: letras.join(''), mapa: posiciones };
  }

  /**
   * Dónde empieza, en el texto de la pantalla, cada bloque de audio.
   *
   * Se busca solo el arranque de cada bloque (unas decenas de letras): si el
   * motor reescribió algo por dentro, el comienzo casi siempre sigue igual.
   * Un bloque que no se encuentre queda a null y luego se rellena repartiendo
   * el hueco entre sus vecinos, así que un fallo suelto no descoloca la guía.
   */
  function situarBloques(textos) {
    const anclas = new Array(textos.length).fill(null);
    let desde = 0;
    textos.forEach((bruto, i) => {
      const aguja = compactar(String(bruto || '')).texto.slice(0, 48);
      if (aguja.length < 6) return;
      let donde = guia.compacto.indexOf(aguja, desde);
      /* Si no aparece hacia delante puede ser un bloque reescrito: se prueba
       * con menos letras antes de rendirse. */
      if (donde === -1 && aguja.length > 16) donde = guia.compacto.indexOf(aguja.slice(0, 16), desde);
      if (donde === -1) return;
      anclas[i] = donde;
      desde = donde + Math.max(1, Math.floor(aguja.length / 2));
    });

    /* Relleno de los huecos: reparto proporcional entre anclas conocidas. */
    let previo = 0;
    for (let i = 0; i < anclas.length; i += 1) {
      if (anclas[i] != null) { previo = anclas[i]; continue; }
      let siguiente = guia.compacto.length;
      let j = i + 1;
      while (j < anclas.length && anclas[j] == null) j += 1;
      if (j < anclas.length) siguiente = anclas[j];
      const huecos = j - i + 1;
      anclas[i] = Math.round(previo + ((siguiente - previo) * (1 / huecos)));
      previo = anclas[i];
    }
    return anclas;
  }

  /** Punto del texto visible donde va la voz ahora mismo. */
  function posicionDeVoz(datos) {
    const anclas = guia.anclas;
    if (!anclas.length || !guia.mapa || !guia.mapa.length) return null;
    const i = Math.max(0, Math.min(anclas.length - 1, Number(datos.bloque) || 0));
    const inicio = anclas[i];
    const fin = i + 1 < anclas.length ? anclas[i + 1] : guia.compacto.length;
    const dentro = Math.max(0, Math.min(1, Number(datos.dentroBloque) || 0));
    const enCompacto = Math.round(inicio + (fin - inicio) * dentro);
    const acotado = Math.max(0, Math.min(guia.mapa.length - 1, enCompacto));
    return guia.mapa[acotado];
  }

  /**
   * Camino inverso de `posicionDeVoz`: de un punto del texto al bloque de
   * audio que lo contiene.
   *
   * `guia.anclas` dice en qué carácter empieza cada bloque de la cola. Con eso
   * basta para saber a qué bloque saltar y en qué proporción de él caemos.
   * Devuelve null si la guía todavía no está situada (no hay lectura en curso).
   */
  function bloqueDeCaracter(caracter) {
    const anclas = guia.anclas;
    if (!anclas || !anclas.length || !guia.mapa || !guia.mapa.length) return null;
    /* Las anclas están en el texto compacto; el carácter viene del texto real. */
    let enCompacto = guia.mapa.indexOf(Math.floor(caracter));
    if (enCompacto < 0) {
      /* El carácter puede ser un espacio o un signo, que no está en el mapa:
       * se busca el siguiente que sí lo esté. */
      for (let c = Math.floor(caracter); c < guia.mapa.length + Math.floor(caracter); c += 1) {
        const donde = guia.mapa.indexOf(c);
        if (donde >= 0) { enCompacto = donde; break; }
      }
    }
    if (enCompacto < 0) return null;

    let i = 0;
    while (i + 1 < anclas.length && anclas[i + 1] <= enCompacto) i += 1;
    const inicio = anclas[i];
    const fin = i + 1 < anclas.length ? anclas[i + 1] : guia.compacto.length;
    const dentro = fin > inicio ? (enCompacto - inicio) / (fin - inicio) : 0;
    return { bloque: i, dentro: Math.max(0, Math.min(1, dentro)) };
  }

  /** Corta el texto en frases. Intl.Segmenter respeta abreviaturas («Sr.»). */
  function partirEnFrases(texto) {
    try {
      if (typeof Intl !== 'undefined' && Intl.Segmenter) {
        const cortador = new Intl.Segmenter('es', { granularity: 'sentence' });
        const trozos = [];
        for (const trozo of cortador.segment(texto)) {
          trozos.push([trozo.index, trozo.index + trozo.segment.length]);
        }
        if (trozos.length) return trozos;
      }
    } catch (_) { /* abajo hay un plan B sencillo */ }
    const trozos = [];
    const patron = /[^.!?…\n]*[.!?…]+[\s"'»)\]]*|[^\n]+\n*|\n+/g;
    let hallazgo;
    while ((hallazgo = patron.exec(texto))) {
      if (!hallazgo[0]) { patron.lastIndex += 1; continue; }
      trozos.push([hallazgo.index, hallazgo.index + hallazgo[0].length]);
    }
    return trozos;
  }

  /** Frase que contiene un punto del texto (búsqueda binaria: hay miles). */
  function fraseEn(frases, posicion) {
    let bajo = 0;
    let alto = frases.length - 1;
    while (bajo <= alto) {
      const medio = (bajo + alto) >> 1;
      if (posicion < frases[medio][0]) alto = medio - 1;
      else if (posicion >= frases[medio][1]) bajo = medio + 1;
      else return frases[medio];
    }
    return frases[Math.min(bajo, frases.length - 1)] || null;
  }

  function limpiarGuia() {
    guia.desde = -1;
    guia.cola = null;
    guia.bloques = 0;
    /* Se viene de un cambio de capítulo o de parar la lectura: la próxima
     * posición es legítima venga de donde venga. */
    guia.saltar = true;
    if (el.realce) el.realce.textContent = '';
    guia.desdeCaracter = -1;
  }

  /* La barra de posición del reproductor avisa de sus saltos: son
   * intencionados y la guía sí puede retroceder con ellos. */
  document.addEventListener('jg-tts-salto', () => { guia.saltar = true; });

  function sincronizarRealce() {
    if (el.realce) el.realce.scrollTop = el.salida.scrollTop;
  }

  function marcarFrase(datos) {
    if (!el.realce) return null;
    const texto = el.salida.value;
    if (!texto) { limpiarGuia(); return null; }
    if (guia.texto !== texto) {
      guia.texto = texto;
      guia.frases = partirEnFrases(texto);
      const compacto = compactar(texto);
      guia.compacto = compacto.texto;
      guia.mapa = compacto.mapa;
      guia.cola = null;          /* el texto cambió: hay que resituar la cola */
      guia.desde = -1;
    }
    if (!guia.frases.length) return null;

    /* Situar los bloques cuesta un rato en un capítulo largo, así que solo se
     * hace cuando hace falta: al empezar una lectura nueva y **cada vez que la
     * cola crece**.
     *
     * Lo segundo es lo que faltaba, y era la causa del parpadeo. El audio se
     * genera por tandas: cuando arranca la lectura la cola tiene uno o dos
     * bloques, y solo se calculaban esas dos anclas. Como la última ancla se
     * extiende «hasta el final del texto» (ver `posicionDeVoz`), cada bloque
     * que sonaba después hacía que la marca barriera el capítulo entero de
     * principio a fin y volviera atrás en el siguiente. Medido: con 2 anclas
     * en un capítulo de 20 000 letras, la marca iba de 900 a 20 000 y vuelta,
     * una y otra vez. Eso es lo que se veía titilar. */
    let textos = [];
    try { textos = (window.ttsTextosDeCola && window.ttsTextosDeCola()) || []; } catch (_) { textos = []; }
    if (guia.cola !== datos.cola || textos.length !== guia.bloques) {
      guia.cola = datos.cola;
      guia.bloques = textos.length;
      guia.anclas = textos.length ? situarBloques(textos) : [];
    }

    /* Anclado al bloque que suena; si no se pudo situar, se cae al reparto
     * proporcional de antes, que al menos no deja la guía a ciegas. */
    const porBloque = datos.bloque >= 0 ? posicionDeVoz(datos) : null;
    const punto = porBloque != null
      ? porBloque
      : Math.max(0, Math.min(texto.length - 1, Math.round((Number(datos.fraccion) || 0) * texto.length)));
    const rango = fraseEn(guia.frases, punto);
    if (!rango) return null;
    if (rango[0] === guia.desde) return el.realce.querySelector('mark');

    /* La guía no vuelve atrás sola.
     *
     * Aunque las anclas ya se recalculan, situar un bloque es aproximado: un
     * cálculo puede quedar unas frases por detrás del anterior y la marca
     * daría un salto hacia atrás. Leyendo, eso se ve como un parpadeo y
     * desorienta más que ayudar. Mientras la lectura avanza, la marca solo
     * avanza; solo retrocede cuando el usuario lo pide (cambiar de capítulo,
     * tocar un párrafo, saltar de frase o mover la barra), y esos sitios
     * levantan `guia.saltar`. */
    if (!guia.saltar && guia.desde >= 0 && rango[0] < guia.desde) {
      return el.realce.querySelector('mark');
    }
    guia.saltar = false;
    guia.desde = rango[0];

    /* Se construye con nodos de texto, nunca con innerHTML: el contenido sale
     * de un PDF cualquiera y aquí no puede convertirse en marcado. */
    const marca = document.createElement('mark');
    marca.textContent = texto.slice(rango[0], rango[1]);
    el.realce.textContent = '';
    el.realce.append(
      document.createTextNode(texto.slice(0, rango[0])),
      marca,
      document.createTextNode(texto.slice(rango[1])),
    );
    sincronizarRealce();
    return marca;
  }

  el.salida.addEventListener('scroll', sincronizarRealce, { passive: true });

  document.addEventListener('jg-tts-avance', (evento) => {
    const datos = evento.detail || {};
    if (datos.sourceId !== 'pdf' || !hayDocumento()) return;

    /* En pausa la guía se queda donde está: quien pausa quiere justamente
     * volver a ese punto, y borrar la marca sería perderlo. Solo desaparece
     * cuando la lectura termina o se detiene.
     * Además, pausar suele significar «lo dejo aquí»: buen momento para que
     * el punto llegue a los demás dispositivos. */
    if (datos.estado === 'paused') {
      guardarYaMismo().then(() => sincronizarAhora({ silencioso: true }));
      return;
    }
    if (!datos.sonando) { limpiarGuia(); return; }

    /* El progreso del libro se anota siempre que suene, se siga el texto o no.
     * Cuando la guía pudo situar el bloque, se conoce el carácter EXACTO que
     * está sonando: es la mejor posición que puede guardarse. */
    const exacto = datos.bloque >= 0 ? posicionDeVoz(datos) : null;
    anotarPosicion({ desplazamiento: datos.fraccion, caracter: exacto != null ? exacto : undefined });
    if (!voz.siguiendo) { limpiarGuia(); return; }

    /* Si lo que suena es una selección suelta, la posición relativa no
     * corresponde con el texto de la pantalla. Pero una lectura pedida con
     * «leer desde aquí» también es más corta que el capítulo y SÍ corresponde:
     * `guia.desdeCaracter` las distingue. */
    const largo = el.salida.value.length;
    const empezadaMasAbajo = guia.desdeCaracter >= 0;
    const parcial = !empezadaMasAbajo && datos.caracteres > 0 && largo > 0 && datos.caracteres < largo * 0.7;
    const marca = parcial ? null : marcarFrase(datos);
    if (parcial) { limpiarGuia(); return; }

    if (Date.now() - voz.pausaManual < ESPERA_TRAS_TOCAR_MS) return;

    /* En modo lectura se marca y se desplaza sobre el artículo visible; en
     * modo edición, sobre el textarea y su capa gemela, como siempre. */
    if (enModoLectura()) {
      if (libroVista && libroVista.marcarRango && guia.desde >= 0) {
        const rango = fraseEn(guia.frases, guia.desde);
        const pintada = rango ? libroVista.marcarRango(rango[0], rango[1]) : null;
        if (pintada) libroVista.desplazarA(pintada);
      }
      return;
    }

    const alto = el.salida.scrollHeight - el.salida.clientHeight;
    if (alto <= 0) return;
    const destino = marca
      ? marca.offsetTop - el.salida.clientHeight * 0.38
      : alto * datos.fraccion;
    const acotado = Math.max(0, Math.min(alto, destino));
    /* Un salto de menos de 4 px no se ve y sí interrumpe la selección. */
    if (Math.abs(el.salida.scrollTop - acotado) < 4) return;
    voz.desplazando = true;
    el.salida.scrollTop = acotado;
    sincronizarRealce();
    requestAnimationFrame(() => { voz.desplazando = false; });
  });

  /* ── Saltar de frase en frase ───────────────────────────────────────
   *
   * El reproductor pide el salto; aquí se resuelve, porque este módulo es el
   * que conoce el texto del capítulo. Si no se puede atender (todavía no hay
   * guía situada), se deja `atendido` en falso y el reproductor salta por
   * tiempo como antes: nunca se queda sin respuesta.
   */
  document.addEventListener('jg-tts-salto-frase', (evento) => {
    const detalle = evento.detail || {};
    if (!hayDocumento()) return;

    const texto = el.salida.value || '';
    const frases = partirEnFrases(texto);
    if (!frases.length) return;

    /* De dónde partimos: de lo que suena si hay voz, de lo que se ve si no. */
    const actual = ttsSonandoAqui() && guia.desde >= 0 ? guia.desde : caracterVisible();
    let i = frases.findIndex(([desde, hasta]) => actual >= desde && actual < hasta);
    if (i < 0) i = 0;

    const destinoIdx = Math.max(0, Math.min(frases.length - 1, i + (detalle.haciaDelante ? 1 : -1)));
    const caracter = frases[destinoIdx][0];

    anotarPosicion({ caracter });
    guia.saltar = true;     /* salto pedido por la persona */
    const destino = bloqueDeCaracter(caracter);
    if (destino && typeof window.ttsIrABloque === 'function' && ttsSonandoAqui()) {
      window.ttsIrABloque(destino.bloque, destino.dentro);
      detalle.atendido = true;
      return;
    }
    /* Sin voz sonando, el salto es visual. */
    irAPosicion(caracter);
    detalle.atendido = true;
  });

  function pintarSeguirVoz() {
    if (el.seguirSi) el.seguirSi.classList.toggle('is-on', voz.siguiendo);
    if (el.seguirNo) el.seguirNo.classList.toggle('is-on', !voz.siguiendo);
  }
  function fijarSeguirVoz(valor) {
    voz.siguiendo = valor;
    voz.pausaManual = 0;
    pintarSeguirVoz();
    try { localStorage.setItem('jg_pdf_seguir_voz', valor ? '1' : '0'); } catch (_) { /* solo esta sesión */ }
  }
  if (el.seguirSi) el.seguirSi.addEventListener('click', () => fijarSeguirVoz(true));
  if (el.seguirNo) el.seguirNo.addEventListener('click', () => fijarSeguirVoz(false));
  pintarSeguirVoz();

  /* ── Temporizador de apagado ───────────────────────────────────────
   *
   * Escuchar un libro en la cama es el caso normal, y sin esto la única
   * salida era despertarse a apagarlo o dejar que corriera el libro entero y
   * perder el sitio. Pausa (no detiene): al volver se sigue donde quedó. */
  const dormir = { limite: null, tic: null, modo: '0' };

  function pintarDormir() {
    if (!el.dormirEstado) return;
    if (dormir.modo === 'capitulo') {
      el.dormirEstado.hidden = false;
      el.dormirEstado.textContent = 'La voz parará al terminar este capítulo.';
      return;
    }
    if (!dormir.limite) { el.dormirEstado.hidden = true; return; }
    const faltan = Math.max(0, dormir.limite - Date.now());
    const min = Math.floor(faltan / 60000);
    const seg = Math.floor((faltan % 60000) / 1000);
    el.dormirEstado.hidden = false;
    el.dormirEstado.textContent = `La voz se apagará en ${min}:${String(seg).padStart(2, '0')}.`;
  }

  function pararTemporizadorDormir() {
    clearInterval(dormir.tic);
    dormir.tic = null;
    dormir.limite = null;
  }

  function dormirAhora() {
    pararTemporizadorDormir();
    dormir.modo = '0';
    if (el.dormir) el.dormir.value = '0';
    pintarDormir();
    detenerAudiolibro();
    try { window.ttsPausar?.(); } catch (_) { /* no había nada sonando */ }
    avisar('La voz se apagó, como pediste. Sigue donde la dejaste.', 'info');
  }

  function programarDormir(valor) {
    pararTemporizadorDormir();
    dormir.modo = valor;
    if (valor === 'capitulo') {
      /* Basta con cortar el encadenado: el audio del capítulo termina y ya. */
      try { if (window.jgAudiolibro) window.jgAudiolibro.activo = false; } catch (_) { /* nada que cortar */ }
      pintarDormir();
      return;
    }
    const minutos = Number(valor) || 0;
    if (minutos <= 0) { pintarDormir(); return; }
    dormir.limite = Date.now() + minutos * 60000;
    dormir.tic = setInterval(() => {
      if (Date.now() >= dormir.limite) dormirAhora();
      else pintarDormir();
    }, 1000);
    pintarDormir();
  }

  if (el.dormir) el.dormir.addEventListener('change', () => programarDormir(el.dormir.value));

  if (el.tradBtn) el.tradBtn.addEventListener('click', () => {
    if (estado.vista === 'es') asegurarTraduccion(estado.parteActual, { mostrar: true });
    else activarEspanol();
  });
  if (el.verOriginal) el.verOriginal.addEventListener('click', verOriginal);
  if (el.verEspanol) el.verEspanol.addEventListener('click', activarEspanol);

  /* ── Temas y opciones de lectura ─────────────────────────────────── */

  function aplicarTema(tema) {
    const elegido = tema === 'papel' ? 'papel' : 'noche';
    if (el.resultArea) el.resultArea.dataset.tema = elegido;
    /* En lectura a pantalla completa, el tema tiñe TODA la pantalla, no solo
     * el recuadro del texto: sin esto quedaba un marco oscuro alrededor del
     * papel. Lo lee el CSS desde <body>, que es quien envuelve la tarjeta. */
    document.body.dataset.lecturaTema = elegido;
    if (el.temaPapel) el.temaPapel.classList.toggle('is-on', elegido === 'papel');
    if (el.temaNoche) el.temaNoche.classList.toggle('is-on', elegido === 'noche');
    try { localStorage.setItem('jg_pdf_tema', elegido); } catch (_) {}
  }

  const temaInicial = (() => {
    try { return localStorage.getItem('jg_pdf_tema'); } catch (_) { return null; }
  })() || 'noche';
  aplicarTema(temaInicial);

  const pulidoInicial = (() => {
    try { return localStorage.getItem('jg_pdf_pulido'); } catch (_) { return null; }
  })();
  estado.pulidoActivo = pulidoInicial !== '0';
  actualizarSwitchPulido();

  if (el.temaPapel) el.temaPapel.addEventListener('click', () => aplicarTema('papel'));
  if (el.temaNoche) el.temaNoche.addEventListener('click', () => aplicarTema('noche'));
  if (el.verSinPulir) el.verSinPulir.addEventListener('click', desactivarPulido);
  if (el.verPulido) el.verPulido.addEventListener('click', activarPulido);

  if (el.btnPdfClear) el.btnPdfClear.addEventListener('click', () => {
    cerrarDocumento();
    refrescarInicio();
    sincronizarAhora({ silencioso: true });
  });

  if (el.btnPdfCopy) el.btnPdfCopy.addEventListener('click', async () => {
    try {
      const texto = el.salida.value || '';
      await navigator.clipboard.writeText(texto);
      avisar('Texto del capítulo copiado al portapapeles.', 'ok');
    } catch (_) {
      avisar('No se pudo copiar automáticamente. Selecciona el texto para copiarlo.', 'warn');
    }
  });

  if (el.btnPdfShowText) el.btnPdfShowText.addEventListener('click', () => {
    if (typeof window.abrirTextModal === 'function') {
      window.abrirTextModal(el.salida, estado.titulo || 'Documento PDF');
    }
  });

  /* ── Hoja de revisión de sugerencias de gramática ─────────────────── */
  if (el.revisionBtn) el.revisionBtn.addEventListener('click', () => {
    pintarRevision();
    if (el.revisionHoja) el.revisionHoja.hidden = false;
  });
  if (el.revisionCerrar) el.revisionCerrar.addEventListener('click', () => {
    if (el.revisionHoja) el.revisionHoja.hidden = true;
  });
  if (el.revisionLista) el.revisionLista.addEventListener('click', (evento) => {
    const boton = evento.target.closest('button[data-bloque]');
    if (!boton) return;
    const { bloque, idx, accion } = boton.dataset;
    if (accion === 'aceptar') aceptarPropuesta(bloque, Number(idx));
    else rechazarPropuesta(bloque, Number(idx));
  });
  if (el.revisionAceptarTodo) el.revisionAceptarTodo.addEventListener('click', () => {
    aceptarTodasDelCapitulo(estado.parteActual);
    pintarRevision();
  });

  if (el.audiolibro) el.audiolibro.addEventListener('click', alternarAudiolibro);
  if (el.docx) el.docx.addEventListener('click', exportarDocx);
  if (el.markdown) el.markdown.addEventListener('click', exportarMarkdown);
  if (el.imprimir) el.imprimir.addEventListener('click', exportarPdf);
  if (el.ocrBtn) el.ocrBtn.addEventListener('click', ejecutarOcr);
  if (el.ocrPaginas) el.ocrPaginas.addEventListener('change', actualizarAvisoOcr);

  el.askBtn.addEventListener('click', () => preguntar(el.askInput.value, 'pregunta'));
  el.askInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); preguntar(el.askInput.value, 'pregunta'); }
  });
  el.resumen.addEventListener('click', () => preguntar('', 'resumen'));
  el.ideas.addEventListener('click', () => preguntar('', 'ideas'));
  if (el.resumenTodo) el.resumenTodo.addEventListener('click', resumirTodo);
  if (el.askCancel) el.askCancel.addEventListener('click', () => {
    if (estado.tareaIA) estado.tareaIA.cancelado = true;
    el.askProgLabel.textContent = 'Cancelando…';
  });
  el.askClear.addEventListener('click', () => {
    el.askAnswer.hidden = true;
    el.askClear.hidden = true;
    el.askAnswer.textContent = '';
  });

  /* ── Que no se pierda nada al desaparecer la app ────────────────────
   *
   * El guardado normal espera 900 ms por si llegan más cambios
   * (`guardarProgresoPronto`). Cuando el sistema se lleva la app —el usuario
   * cambia de aplicación, bloquea el celular, o el celular se apaga— esos
   * 900 ms no llegan a cumplirse y el avance se pierde.
   *
   * `visibilitychange` es el único evento fiable en móvil: `beforeunload` no
   * se dispara en Android ni en iOS cuando el sistema mata la pestaña.
   */
  async function guardarYaMismo() {
    if (!hayDocumento() || !estado.id) return;
    clearTimeout(temporizadorGuardado);
    anotarPosicion();
    try {
      await almacen.guardarProgreso(estado.id, estado.progreso, estado.partes);
    } catch (_) { /* si IndexedDB falla, lo local sigue en memoria */ }
  }

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      guardarYaMismo().then(() => sincronizarAhora({ silencioso: true }));
    } else if (document.visibilityState === 'visible') {
      /* Al volver a la app se trae lo que haya cambiado en otros aparatos. */
      sincronizarAhora({ silencioso: true });
    }
  });

  /* Respaldo para navegadores de escritorio, donde sí es fiable. */
  window.addEventListener('pagehide', () => { guardarYaMismo(); });

  /* Mientras se lee, un latido tranquilo: si alguien lee dos horas seguidas sin
   * salir de la app, su avance ya está en la nube por si cambia de dispositivo.
   * Un minuto es suficiente y no molesta a la batería ni a la cuota. */
  const LATIDO_SYNC_MS = 60000;
  setInterval(() => {
    if (!hayDocumento()) return;
    if (document.visibilityState !== 'visible') return;
    guardarYaMismo().then(() => sincronizarAhora({ silencioso: true }));
  }, LATIDO_SYNC_MS);

  /* ── Sincronización entre dispositivos ───────────────────────────── */
  /*
   * Un solo botón hace todo: enciende la sincronización si hace falta y
   * enseña un código QR. La persona apunta la cámara del otro aparato y
   * listo. Los seis dígitos siguen ahí, pero como respaldo, no como el
   * camino principal: escribir números a mano es lo que se sentía complicado.
   */

  const nube = deps.pedirApi
    ? crearNube({ pedir: deps.pedirApi, biblioteca: almacen })
    : null;
  let temporizadorCodigo = null;
  let enlaceDelPase = '';

  function avisoNube(mensaje, situacion = '') {
    if (!el.nubeAviso) return;
    el.nubeAviso.hidden = !mensaje;
    el.nubeAviso.textContent = mensaje || '';
    if (situacion) el.nubeAviso.dataset.estado = situacion;
    else el.nubeAviso.removeAttribute('data-estado');
  }

  async function pintarNube() {
    if (!el.nube || !nube) { if (el.nube) el.nube.hidden = true; return; }
    const conectado = nube.estaVinculada();

    el.nubePunto.dataset.estado = conectado ? 'encendida' : 'apagada';
    el.nubeSync.hidden = !conectado;
    el.nubeMas.hidden = !conectado;
    el.nubeUnirse.hidden = conectado;
    el.nubeConectarLabel.textContent = conectado ? 'Conectar otro aparato' : 'Conectar otro aparato';
    el.nubeEstado.textContent = conectado
      ? 'Tus libros se copian solos entre tus aparatos'
      : 'Ahora mismo solo están en este';

    if (!conectado) return;
    try {
      const estado = await nube.estado();
      const docs = Number(estado.documentos) || 0;
      const aparatos = Number(estado.dispositivos) || 1;
      el.nubeEstado.textContent =
        `${docs} ${docs === 1 ? 'libro guardado' : 'libros guardados'} · ` +
        `${aparatos} ${aparatos === 1 ? 'aparato' : 'aparatos'} conectados`;
    } catch (error) {
      el.nubePunto.dataset.estado = 'error';
      el.nubeEstado.textContent = 'No se pudo consultar la nube';
      avisoNube(error?.message || 'La sincronización no respondió.', 'error');
    }
  }

  async function conBotonOcupado(boton, etiqueta, texto, trabajo) {
    const original = etiqueta ? etiqueta.textContent : '';
    if (boton) boton.disabled = true;
    if (etiqueta) etiqueta.textContent = texto;
    try {
      return await trabajo();
    } finally {
      if (boton) boton.disabled = false;
      if (etiqueta) etiqueta.textContent = original;
    }
  }

  /** Dibuja el código para escanear. Si la librería falla, quedan los dígitos. */
  async function pintarQr(enlace) {
    if (!el.nubeQr) return;
    el.nubeQr.innerHTML = '';
    try {
      /* La librería es UMD, no un módulo ES: con import() no se registra en
       * «window». Se carga como script clásico, que es lo que espera. */
      if (!window.qrcode) {
        await new Promise((listo, falla) => {
          const guion = document.createElement('script');
          guion.src = '/js/vendor/qr/qrcode.js';
          guion.onload = listo;
          guion.onerror = () => falla(new Error('no se pudo cargar el generador de códigos'));
          document.head.appendChild(guion);
        });
      }
      if (typeof window.qrcode !== 'function') throw new Error('generador de códigos no disponible');
      const generador = window.qrcode(0, 'M');
      generador.addData(enlace);
      generador.make();
      el.nubeQr.innerHTML = generador.createImgTag(6, 0);
      const img = el.nubeQr.querySelector('img');
      if (img) img.alt = 'Código para escanear con la cámara del celular';
    } catch (error) {
      /* Sin QR se puede seguir: los seis dígitos hacen el mismo trabajo. */
      console.warn('[jg-sync] no se pudo dibujar el código', error);
      el.nubeQr.hidden = true;
    }
  }

  /**
   * El botón único: enciende la sincronización (si hace falta) y muestra el
   * pase para el otro aparato. Dos pasos que antes eran del usuario.
   */
  async function mostrarPase() {
    if (!nube) return;
    /* La nube va plegada para no estorbar: al pedir el pase se despliega,
     * porque el código QR vive dentro. */
    if (el.nube && el.nube.tagName === 'DETAILS') el.nube.open = true;
    try {
      await conBotonOcupado(el.nubeConectar, el.nubeConectarLabel, 'Preparando…', async () => {
        if (!nube.estaVinculada()) {
          const datos = await nube.activar();
          /* La llave se guarda sola; se enseña solo si la persona la pide. */
          if (el.nubeLlaveTexto) el.nubeLlaveTexto.textContent = datos.llave;
        }
        await sincronizarAhora({ silencioso: true });
        const pase = await nube.pedirCodigo();
        const codigo = String(pase.codigo || '');
        el.nubeDigitos.textContent = codigo.replace(/(\d{3})(\d{3})/, '$1 $2');
        enlaceDelPase = `${location.origin}/?unir=${codigo}`;
        el.nubeQr.hidden = false;
        await pintarQr(enlaceDelPase);
        el.nubePase.hidden = false;
        el.nubeCompartir.hidden = !navigator.share;

        clearInterval(temporizadorCodigo);
        let restan = (pase.minutos || 10) * 60;
        const cuenta = () => {
          if (restan <= 0) {
            clearInterval(temporizadorCodigo);
            el.nubeCaduca.textContent = 'El código venció. Pulsa otra vez «Conectar otro aparato».';
            el.nubeDigitos.textContent = '— — — — — —';
            el.nubeQr.innerHTML = '';
            return;
          }
          const minutos = Math.floor(restan / 60);
          el.nubeCaduca.textContent = `Sirve durante ${minutos}:${String(restan % 60).padStart(2, '0')} minutos`;
          restan -= 1;
        };
        cuenta();
        temporizadorCodigo = setInterval(cuenta, 1000);
      });
      await pintarNube();
      avisoNube('');
    } catch (error) {
      avisoNube(error?.message || 'No se pudo preparar la conexión.', 'error');
    }
  }

  function cerrarPase() {
    clearInterval(temporizadorCodigo);
    el.nubePase.hidden = true;
    el.nubeQr.innerHTML = '';
  }

  async function unirDispositivo(codigoDado) {
    if (!nube) return false;
    const codigo = String(codigoDado || el.nubeEntrada.value || '').replace(/\D/g, '');
    if (codigo.length !== 6) {
      avisoNube('El código son 6 números.', 'error');
      el.nubeEntradaCaja.hidden = false;
      el.nubeEntrada.focus();
      return false;
    }
    try {
      avisoNube('Conectando con tu otro aparato…');
      await nube.vincular(codigo);
      el.nubeEntrada.value = '';
      el.nubeEntradaCaja.hidden = true;
      await pintarNube();
      avisoNube('Conectado. Trayendo tus libros…', 'ok');
      await sincronizarAhora();
      return true;
    } catch (error) {
      avisoNube(error?.message || 'No se pudo conectar este aparato.', 'error');
      return false;
    }
  }

  /**
   * Sincroniza con la nube.
   *
   * `desdeCabecera` importa más de lo que parece: el aviso de esta función
   * vive dentro de la sección plegable de la nube, al final de la página. Al
   * pulsar el botón «Actualizar» de la cabecera —que está arriba— no se veía
   * absolutamente nada: ni que estuviera trabajando, ni el resultado, ni el
   * error. Parecía un botón muerto aunque estuviera sincronizando.
   */
  async function sincronizarAhora({ silencioso = false, desdeCabecera = false } = {}) {
    if (!nube || !nube.estaVinculada()) return;
    /* El botón desde el que se pulsó es el que se bloquea y anuncia: así no
     * hay dobles envíos por pulsar dos veces mientras trabaja. */
    const boton = desdeCabecera ? el.actualizarBiblio : el.nubeSync;
    const etiqueta = desdeCabecera ? el.actualizarBiblioLabel : el.nubeSyncLabel;
    const contar = (n, uno, varios) => `${n} ${n === 1 ? uno : varios}`;
    try {
      const resultado = await conBotonOcupado(boton, etiqueta, 'Actualizando…',
        () => nube.sincronizar({
          alProgresar: (mensaje) => {
            if (silencioso) return;
            avisoNube(mensaje);
            if (desdeCabecera) avisar(mensaje, 'info');
          },
        }));
      await refrescarInicio();
      await pintarNube();
      const nada = !resultado.subidos && !resultado.bajados && !resultado.caratulas;
      const partes = [];
      if (resultado.bajados) partes.push(`llegaron ${contar(resultado.bajados, 'libro', 'libros')}`);
      if (resultado.caratulas) partes.push(`${contar(resultado.caratulas, 'carátula nueva', 'carátulas nuevas')}`);
      if (resultado.subidos) partes.push(`se enviaron ${contar(resultado.subidos, 'libro', 'libros')}`);
      const mensaje = nada ? 'Todo al día.' : `Listo: ${partes.join(' · ')}.`;
      avisoNube(mensaje, 'ok');
      /* Arriba también, para quien pulsó arriba. */
      if (desdeCabecera && !silencioso) avisar(mensaje, 'ok', { efimero: true });
      return resultado;
    } catch (error) {
      const fallo = error?.message || 'No se pudo sincronizar.';
      if (!silencioso) {
        avisoNube(fallo, 'error');
        if (desdeCabecera) avisar(fallo, 'err');
      }
      el.nubePunto.dataset.estado = 'error';
      return null;
    }
  }

  if (el.nubeConectar) el.nubeConectar.addEventListener('click', mostrarPase);
  if (el.nubeSync) el.nubeSync.addEventListener('click', () => sincronizarAhora());
  if (el.nubeCerrarPase) el.nubeCerrarPase.addEventListener('click', cerrarPase);
  if (el.nubeUnir) el.nubeUnir.addEventListener('click', () => unirDispositivo());
  if (el.nubeTengo) el.nubeTengo.addEventListener('click', () => {
    const abierto = el.nubeEntradaCaja.hidden;
    el.nubeEntradaCaja.hidden = !abierto;
    el.nubeTengo.setAttribute('aria-expanded', abierto ? 'true' : 'false');
    if (abierto) el.nubeEntrada.focus();
  });
  if (el.nubeEntrada) el.nubeEntrada.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); unirDispositivo(); }
  });
  if (el.nubeMas) el.nubeMas.addEventListener('click', () => {
    const abierto = el.nubeOpciones.hidden;
    el.nubeOpciones.hidden = !abierto;
    el.nubeMas.setAttribute('aria-expanded', abierto ? 'true' : 'false');
  });
  if (el.nubeLlave) el.nubeLlave.addEventListener('click', () => {
    el.nubeLlaveCaja.hidden = !el.nubeLlaveCaja.hidden;
    if (!el.nubeLlaveTexto.textContent) {
      el.nubeLlaveTexto.textContent = nube?.llaveGuardada?.() || '(no disponible en este aparato)';
    }
  });
  if (el.nubeCompartir) el.nubeCompartir.addEventListener('click', async () => {
    try {
      await navigator.share({
        title: 'JG Turbo',
        text: 'Abre este enlace en tu otro aparato para traer tus libros:',
        url: enlaceDelPase,
      });
    } catch (_) { /* si cancela el diálogo, no pasa nada */ }
  });
  if (el.nubeCopiarEnlace) el.nubeCopiarEnlace.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(enlaceDelPase);
      el.nubeCopiarEnlace.textContent = '¡Copiado!';
      setTimeout(() => { el.nubeCopiarEnlace.textContent = 'Copiar enlace'; }, 1600);
    } catch (_) {
      avisoNube('No se pudo copiar. Escribe los números a mano en el otro aparato.', 'error');
    }
  });
  if (el.nubeCopiarLlave) el.nubeCopiarLlave.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(el.nubeLlaveTexto.textContent || '');
      el.nubeCopiarLlave.textContent = '¡Copiada!';
      setTimeout(() => { el.nubeCopiarLlave.textContent = 'Copiar'; }, 1600);
    } catch (_) {
      avisoNube('No se pudo copiar. Selecciónala y cópiala a mano.', 'error');
    }
  });
  if (el.nubeLlaveOk) el.nubeLlaveOk.addEventListener('click', () => { el.nubeLlaveCaja.hidden = true; });
  if (el.nubeSalir) el.nubeSalir.addEventListener('click', () => {
    nube.desconectar();
    cerrarPase();
    el.nubeOpciones.hidden = true;
    pintarNube();
    avisoNube('Este aparato dejó de sincronizar. Tus libros siguen aquí.', 'ok');
  });

  pintarNube();

  /* Si se llegó escaneando el código (…/?unir=123456), se conecta solo: la
   * persona no tiene que escribir nada ni entender qué es un código. */
  (async () => {
    try {
      const parametros = new URLSearchParams(location.search);
      const codigo = (parametros.get('unir') || '').replace(/\D/g, '');
      if (codigo.length === 6 && nube && !nube.estaVinculada()) {
        /* Se llega por el QR del otro aparato: la caja de la nube va plegada
         * y aquí los avisos tienen que verse. */
        if (el.nube && el.nube.tagName === 'DETAILS') el.nube.open = true;
        await unirDispositivo(codigo);
        const limpia = new URL(location.href);
        limpia.searchParams.delete('unir');
        history.replaceState({}, '', limpia.pathname + limpia.search + limpia.hash);
      } else if (nube && nube.estaVinculada()) {
        sincronizarAhora({ silencioso: true });
      }
    } catch (_) { /* llegar por enlace es un extra, no puede romper la app */ }
  })();

  // Vista de libro v2.39 (lectura HTML, apariencia, cortes, biblioteca).
  let libroVista = null;
  try {
    libroVista = initLibroVista({
      el,
      estado,
      api: {
        textoDeParte: (i) => textoDeParte(i),
        guardarEdicion: (forzar) => { if (forzar) guardarEdicionActual(); },
        avisar,
        pausar: () => { try { pausarCorreccionLibro(); } catch (_) {} },
        repintarBiblioteca: () => { try { pintarBiblioteca(); } catch (_) {} },
        mostrarMasBiblioteca: () => { estado.biblioLimite = (estado.biblioLimite || 40) + 40; try { pintarBiblioteca(); } catch (_) {} },
        reconstruirTrasDecision: () => {},
        verRecorte: (lim) => { try { verRecortePagina(lim); } catch (_) {} },
        vincularArchivo: async (archivo) => { await vincularPdfOriginal(archivo); },
        leerDesdeCaracter: (caracter) => { try { leerDesdeCaracter(caracter); } catch (_) {} },
      },
    });
  } catch (_) { libroVista = null; }

  async function verRecortePagina(lim) {
    // Recorte de la página original mediante PDF.js, cargado bajo demanda.
    const canvas = el.recorte;
    if (!canvas) return;
    const archivo = await almacen.cargarArchivo(estado.id).catch(() => null);
    if (!archivo) {
      avisar('Vincula el PDF original para ver el recorte de la página.', 'warn');
      return;
    }
    try {
      const pdfjs = await import('../vendor/pdfjs/pdf.min.mjs');
      const buf = await archivo.arrayBuffer();
      const pdf = await pdfjs.getDocument({ data: buf }).promise;
      const atomo = (estado.atomos || []).find((a) => a.id === (lim && lim.leftAtomId));
      const pagina = atomo?.page || 1;
      const page = await pdf.getPage(Math.max(1, Math.min(pdf.numPages, Number(pagina) || 1)));
      const viewport = page.getViewport({ scale: 1.2 });
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      canvas.hidden = false;
      if (el.recorteCerrar) el.recorteCerrar.hidden = false;
      await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
    } catch (_) {
      avisar('No se pudo mostrar el recorte de la página.', 'warn');
    }
  }

  async function vincularPdfOriginal(archivo) {
    if (!archivo || !estado.id) return;
    try {
      const buf = await archivo.arrayBuffer();
      const resumen = await crypto.subtle.digest('SHA-256', buf);
      const hex = [...new Uint8Array(resumen)].map((b) => b.toString(16).padStart(2, '0')).join('');
      if (estado.fuenteRevision && hex !== estado.fuenteRevision) {
        avisar('Ese PDF no corresponde a este documento.', 'warn');
        return;
      }
      await almacen.guardarArchivo(estado.id, archivo);
      avisar('PDF original vinculado.', 'ok');
    } catch (_) {
      avisar('No se pudo vincular el PDF.', 'warn');
    }
  }

  /**
   * Lee en voz alta desde un punto exacto del texto.
   *
   * Es el mismo camino que ya usaba el doble toque en el textarea, ahora
   * disponible desde la vista de libro: se ancla al comienzo de la frase
   * (empezar a media frase suena a error), se anota el progreso y, si ya hay
   * voz sonando, se salta al bloque de audio correspondiente. Si no había voz,
   * se selecciona del punto al final y se pulsa Escuchar: el motor lee la
   * selección, y `guia.desdeCaracter` permite seguir resaltando.
   */
  function leerDesdeCaracter(caracter) {
    if (!hayDocumento()) return;
    const texto = el.salida.value || '';
    if (!texto) return;
    const frases = partirEnFrases(texto);
    const punto = Math.max(0, Math.min(texto.length - 1, Math.floor(Number(caracter) || 0)));
    const rango = frases.length ? fraseEn(frases, punto) : null;
    const desde = rango ? rango[0] : punto;

    anotarPosicion({ caracter: desde });
    guia.saltar = true;               /* salto pedido por la persona */

    const destino = bloqueDeCaracter(desde);
    if (destino && ttsSonandoAqui() && typeof window.ttsIrABloque === 'function') {
      window.ttsIrABloque(destino.bloque, destino.dentro);
      avisar('Leyendo desde aquí.', 'info', { efimero: true });
      return;
    }
    guia.desdeCaracter = desde;
    try { el.salida.setSelectionRange(desde, texto.length); } catch (_) { /* textarea oculto */ }
    const boton = document.querySelector('[data-tts-console="pdf"] [data-tts-action="toggle"]');
    if (boton) boton.click();
    else avisar('Pulsa Escuchar para leer desde aquí.', 'info', { efimero: true });
  }

  /* Mismo gesto, para quien usa teclado o lector de pantalla: lee desde el
   * primer párrafo visible, sin tener que apuntar con el dedo. */
  if (el.btnDesdeAqui) {
    el.btnDesdeAqui.addEventListener('click', () => {
      try { leerDesdeCaracter(caracterVisible()); } catch (_) {}
    });
  }

  const mostrarParteOriginal = mostrarParte;
  mostrarParte = async function (indice, opts) {
    const r = await mostrarParteOriginal(indice, opts);
    try {
      if (libroVista) libroVista.renderLectura();
      if (el.salida && el.textoCaja) {
        const cfg = JSON.parse(localStorage.getItem('jg_pdf_lectura') || '{}');
        if (cfg.modo === 'editar') { el.textoCaja.hidden = false; if (el.lectura) el.lectura.hidden = true; }
        else { el.textoCaja.hidden = true; if (el.lectura) el.lectura.hidden = false; }
      } else if (libroVista && el.salida) {
        const cfg2 = JSON.parse(localStorage.getItem('jg_pdf_lectura') || '{}');
        el.salida.hidden = cfg2.modo === 'lectura' && !!el.lectura;
      }
    } catch (_) {}
    return r;
  };

  refrescarInicio();

  return {
    cargarPdfExterno(archivo) {
      seleccionarArchivo(archivo);
      if (estado.archivo) procesar();
    },
    obtenerTextoCompleto() { return textoCompleto(); },
    obtenerTitulo: () => estado.titulo,
    tieneVariasPartes: () => estado.partes.length > 1,
    limpiar: () => { cerrarDocumento(); refrescarInicio(); },
    refrescarBiblioteca: refrescarInicio,
  };
}
