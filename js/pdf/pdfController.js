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
import { procesarPdf, abrirPdf, ErrorPdf, cargarMotor, renderizarPortada } from './extractorPdf.js';
import { extraerFiguras } from './figurasPdf.js';
import { componerTexto, pulirParaLectura, prepararCapitulosLectura } from './limpiezaTexto.js';
import { partirTextoCanonico, mejorCorte as mejorCorteCanonico, LIMITE_PARTE as LIMITE_PARTE_CANONICO } from './particion.js';
import {
  crearColaDesdePartes, hidratarCola, serializarCola, correrCola,
  etiquetaColaCorreccion, resumenCola, prepararReanudacion,
  textoCorregidoDeParte, libroCorregidoEnOrden, componerLibroDesdePartes,
  parteCompleta, aplicarExito, validarResultadoCorreccion, validarCoberturaCola,
  validarUnionesEntreBloques, colaListaParaLibro,
} from './colaCorreccion.js';
import { VERSION_RECONSTRUCCION, VERSION_TROCEO as VERSION_TROCEO_MOTOR, reconstruirDesdeAtomos, invarianteLetras } from './reconstruccion.js';
import { contarPendientes, aceptarDecisionesIA, aplicarDecisionUsuario, expandirManifiesto } from './limites.js';
import { planMigracionV7 as planMigracionV6, serializarReconstruccion, marcarNeedsSource, confiarEnCorreccionSync, estadoRevisionCortes } from './manifiesto.js';
import { compactarTexto, situarBloquesTexto, situarBloquesDetallado, rellenarAnclas, construirCostos, acumularCostos, posicionPorTiempo, tiempoPorPosicion } from './guiaAnclas.js';
import { limitarAnchoIndice, modoAnchoIndice, leerAnchoIndice, guardarAnchoIndice, ANCHO_INDICE_DEF } from './panelIndice.js';
import { componerAtomosFiel } from './fidelidad.js';
import { sha256Hex } from './huella.js';
import { initLibroVista, ordenarDocumentos, paginarDocumentos } from './libroVista.js';
import { prepararParaVoz } from './vozTexto.js';
import { crearPulidor, crearAuditorPdf, tokenizarParaAuditoria, validarIntegridadEstructura, aplicarDecisiones, aplicarSignos } from './pulido.js';
import { dividirEnBloquesSemanticos, construirHuella, estadoAuditoriaTexto, estadoCorreccionLecturaTexto } from './auditoria.js';
/* Fase B (§4.2.2): busqueda.js y exportar.js se cargan bajo demanda */
import { crearTraductor, necesitaTraduccion } from './traduccion.js';
import {
  progresoInicial, avanzarProgreso, calcularPorcentaje, estadoDeLectura,
  etiquetaEstado, etiquetaProgreso, progresoDeCapitulo, formatearTamano, etiquetaReanudar,
  etiquetaSeccion,
} from './progreso.js';
import { construirAncla, resolverAncla } from './anclaTexto.js';
import { limpiarNombreLibro, conseguirCaratula, buscarPortadaCanonica } from './caratula.js';
import * as almacen from './biblioteca.js';
import { crearNube } from './nube.js';
import { musicaFondo, CATALOGO_PISTAS, ANIMOS } from './musicaFondo.js';

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
    indiceColapsar: $('btnPdfIndiceColapsar'),
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
    reanudarCorreccion: $('pdfReanudarCorreccion'),
    reanudarCorreccionTxt: $('pdfReanudarCorreccionTxt'),
    btnReanudarCorreccion: $('btnPdfReanudarCorreccion'),
    btnReanudarCorreccionCerrar: $('btnPdfReanudarCorreccionCerrar'),

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
    nubeTraerCopia: $('btnPdfNubeTraerCopia'), nubeArchivoCopia: $('pdfNubeArchivoCopia'),
    nubeLlaveCaja: $('pdfNubeLlaveCaja'), nubeLlaveTexto: $('pdfNubeLlaveTexto'),
    nubeCopiarLlave: $('btnPdfNubeCopiarLlave'), nubeLlaveOk: $('btnPdfNubeLlaveOk'),
    lectura: $('pdfLectura'), vistaLectura: $('pdfVistaLectura'), vistaEditar: $('pdfVistaEditar'),
    modoEstados: $('pdfModoEstados'), editarBarra: $('pdfEditarBarra'),
    editarGuardar: $('pdfEditarGuardar'), editarCancelar: $('pdfEditarCancelar'),
    textoCaja: $('pdfTextoCaja'), docRef: $('pdfDocRef'),
    aparTam: $('pdfAparTam'), aparInter: $('pdfAparInter'), aparAncho: $('pdfAparAncho'),
    aparFuente: $('pdfAparFuente'), temaSepia: $('btnPdfTemaSepia'),
    btnApariencia: $('btnPdfApariencia'), aparienciaHoja: $('pdfAparienciaHoja'),
    btnMusica: $('btnPdfMusica'), musicaHoja: $('pdfMusicaHoja'),
    aparModo: $('pdfAparModo'), textoCol: document.querySelector('.pdf-texto-col'),
    paginacion: $('pdfPaginacion'), pagPrev: $('btnPdfPagPrev'),
    pagNext: $('btnPdfPagNext'), pagPos: $('pdfPagPos'),
    btnCortes: $('btnPdfCortes'), cortesCuenta: $('pdfCortesCuenta'),
    btnUnirPalabras: $('btnPdfUnirPalabras'), unirCuenta: $('pdfUnirCuenta'), unirModo: $('pdfUnirModo'),
    unirAviso: $('pdfUnirAviso'), unirAvisoTexto: $('pdfUnirAvisoTexto'),
    btnUnirDeshacer: $('btnPdfUnirDeshacer'),
    btnDesdeAqui: $('btnPdfDesdeAqui'),
    cortesHoja: $('pdfCortesHoja'), cortesLista: $('pdfCortesLista'), cortesCerrar: $('pdfCortesCerrar'),
    recorte: $('pdfRecorte'), recorteCerrar: $('pdfRecorteCerrar'),
    btnVincular: $('btnPdfVincular'), vincularInput: $('pdfVincularInput'),
    compararBtn: $('btnPdfComparar'), fidelidadEstado: $('pdfFidelidadEstado'),
    compararHoja: $('pdfCompararHoja'), compararCerrar: $('btnPdfCompararCerrar'),
    compararCanvas: $('pdfCompararCanvas'), compararTexto: $('pdfCompararTexto'),
    compararDudas: $('pdfCompararDudas'), compararPagina: $('pdfCompararPagina'),
    compararPrev: $('btnPdfCompararPrev'), compararNext: $('btnPdfCompararNext'),
    compararVerificada: $('btnPdfPaginaVerificada'),
    btnCorregirLibro: $('btnPdfCorregirLibro'),
    volverLectura: $('pdfVolverLectura'), btnPausar: $('btnPdfPausarCorreccion'),
    orden: $('pdfOrden'), vistaPortadas: $('pdfVistaPortadas'), vistaCompacta: $('pdfVistaCompacta'),
    mostrarMas: $('pdfMostrarMas'),
    btnOrganizar: $('btnPdfOrganizar'), organizar: $('pdfOrganizar'),
    organizarLista: $('pdfOrganizarLista'),
    organizarGuardar: $('btnPdfOrganizarGuardar'), organizarCancelar: $('btnPdfOrganizarCancelar'),
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
    fragmentosFuente: [],
    transformaciones: [],
    estructura: [],
    calidadPorPagina: [],
    estadoFidelidad: null,
    paginasFuente: [],
  };

  /* ── Estado veraz de sincronización (PDF-01) ─────────────────────
   *
   * La tarjeta decía «Sincronizado» a todo lo que no fuera privado, porque
   * solo miraba `doc.sincronizar`. Ahora se mira lo que de verdad se sabe:
   * si no hay vinculación, el libro solo está aquí; si hay cambios sin
   * confirmar en la nube, está pendiente; «Sincronizado» solo con la
   * confirmación vigente (`actualizado <= sincronizado` y `sincronizado > 0`).
   * El fallo no vive en el documento (no hay campo persistente para eso):
   * se recuerda el último fallo global y, mientras siga pendiente lo que
   * falló, la tarjeta lo dice en vez de fingir que está al día. */
  let sincronizandoAhora = false;
  let ultimoFalloSync = 0;
  try { ultimoFalloSync = Number(localStorage.getItem('jg_sync_ultimo_error')) || 0; } catch (_) {}
  function marcarFalloSync() {
    ultimoFalloSync = Date.now();
    try { localStorage.setItem('jg_sync_ultimo_error', String(ultimoFalloSync)); } catch (_) {}
  }
  function limpiarFalloSync() {
    ultimoFalloSync = 0;
    try { localStorage.removeItem('jg_sync_ultimo_error'); } catch (_) {}
  }
  function hayPendienteLocal(doc) {
    if (!doc || doc.sincronizar === false) return false;
    const act = Number(doc.actualizado) || 0;
    const sub = Number(doc.sincronizado) || 0;
    if (!sub) return true;   /* nunca se confirmó una subida: falta */
    return act > sub;
  }
  function estadoSincroniaDoc(doc) {
    if (!doc || doc.sincronizar === false) return 'local';
    if (!nube || !nube.estaVinculada || !nube.estaVinculada()) return 'local';
    if (hayPendienteLocal(doc)) {
      if (sincronizandoAhora) return 'pendiente';
      if (ultimoFalloSync) return 'error';
      return 'pendiente';
    }
    return 'sincronizado';
  }
  function etiquetaSincroniaDoc(doc) {
    const est = estadoSincroniaDoc(doc);
    if (est === 'local') return 'Solo en este dispositivo';
    if (est === 'pendiente') return 'Pendiente de sincronizar';
    if (est === 'error') return 'No se pudo sincronizar';
    return 'Sincronizado';
  }
  /* Anuncia sin mover el foco: la tarjeta y la nube coinciden en el texto. */
  function anunciarSync(mensaje) {
    if (!mensaje) return;
    try {
      const vivo = document.getElementById('pdfSyncLive');
      if (vivo) vivo.textContent = mensaje;
    } catch (_) {}
  }

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
    if (doc.tienePortada && !forzar && doc.origenPortada !== 'dibujada') return 'ninguna';
    try {
      const { titulo, autor } = limpiarNombreLibro(doc.titulo, doc.nombreArchivo);
      if (!titulo) return 'ninguna';
      const esAnonimo = !doc.titulo || doc.titulo.trim().toLowerCase() === '(anonymous)' || doc.titulo.trim().toLowerCase() === 'untitled';
      const nuevoTitulo = esAnonimo ? titulo : null;

      // 1. Portada canónica oficial del proyecto si coincide con los libros reconocidos
      const canonica = buscarPortadaCanonica(titulo || doc.nombreArchivo);
      if (canonica && typeof fetch !== 'undefined') {
        try {
          const resp = await fetch(canonica);
          if (resp.ok) {
            const blob = await resp.blob();
            if (blob && blob.size > 1000) {
              await almacen.guardarPortadaGenerada(doc.id, blob, 'real', { nuevoTitulo });
              return 'real';
            }
          }
        } catch (_) {}
      }

      // 2. Extraer directamente de la página 1 del PDF original si está guardado en este aparato
      const archivoPdf = await almacen.cargarArchivo(doc.id).catch(() => null);
      if (archivoPdf) {
        try {
          const { doc: pdfDoc } = await abrirPdf(archivoPdf);
          const portadaPdf = await renderizarPortada(pdfDoc, { ancho: 380, numero: 1 });
          if (portadaPdf && portadaPdf.size > 2500) {
            await almacen.guardarPortadaGenerada(doc.id, portadaPdf, 'pdf', { nuevoTitulo });
            return 'pdf';
          }
        } catch (ePdf) {
          console.warn('[jg-pdf] no se pudo extraer portada de PDF', ePdf);
        }
      }

      // 3. Portada real del catálogo (OpenLibrary / Google Books)
      if (buscarReal) {
        const { blob, origen } = await conseguirCaratula({ titulo, autor, buscarReal: true });
        if (blob && origen === 'real') {
          await almacen.guardarPortadaGenerada(doc.id, blob, 'real', { nuevoTitulo });
          return 'real';
        }
      }

      // 4. Red de seguridad: portada dibujada
      const { blob: blobDib, origen: origenDib } = await conseguirCaratula({ titulo, autor, buscarReal: false });
      if (blobDib) {
        await almacen.guardarPortadaGenerada(doc.id, blobDib, origenDib, { nuevoTitulo });
        return origenDib;
      }

      return 'ninguna';
    } catch (_) {
      return 'ninguna';   /* sin carátula el libro se abre igual */
    }
  }

  /**
   * Asegura que todos los libros muestren su carátula original auténtica.
   *
   * Revisa libros sin carátula, con carátula dibujada provisional o con título anónimo,
   * extrayendo la portada real del PDF o del catálogo oficial en segundo plano sin bloquear la app.
   */
  async function completarCaratulasQueFaltan(documentos) {
    const candidatos = (documentos || []).filter((d) =>
      d && !d.borrado && (
        !d.tienePortada ||
        d.origenPortada === 'dibujada' ||
        !d.titulo ||
        d.titulo.trim().toLowerCase() === '(anonymous)' ||
        (buscarPortadaCanonica(d.titulo || d.nombreArchivo) && d.origenPortada !== 'real' && d.origenPortada !== 'pdf')
      )
    );
    if (!candidatos.length) return;
    let puestas = 0;
    for (const doc of candidatos) {
      if (await ponerCaratula(doc, { buscarReal: true, forzar: true }) !== 'ninguna') puestas += 1;
    }
    if (puestas) {
      pintarBiblioteca();
      pintarContinuar();
    }
  }

  /* ── Modo Organizar (PDF-05/06) ──────────────────────────────────────
   *
   * Reordenar dejó de ser un tirador permanente sobre cada carátula: la
   * biblioteca normal es para leer. «Organizar» abre una lista temporal de
   * filas con controles propios (tirador 44×44, Mover antes/después,
   * Alt+flechas). Nada se guarda hasta «Guardar orden»; «Cancelar» y Escape
   * restauran el orden anterior. Al entrar se suspenden filtros y búsqueda
   * (se mueven TODOS los libros) y se restituyen al salir.
   */
  let organizando = false;
  let ordenTemporal = [];
  let previoOrganizar = null;
  let arrastreOrg = null;

  /** Título de verdad del documento (sin «(anonymous)» ni «untitled»). */
  function tituloLimpioDe(doc) {
    const info = limpiarNombreLibro(doc.titulo, doc.nombreArchivo);
    return (doc.titulo && doc.titulo.trim().toLowerCase() !== '(anonymous)' && doc.titulo.trim().toLowerCase() !== 'untitled')
      ? doc.titulo
      : (info.titulo || doc.nombreArchivo || 'Documento');
  }

  /** Persiste el orden manual con la clave de siempre (jg_pdf_orden_manual). */
  async function guardarOrdenIds(idsVisibles) {
    if (!Array.isArray(idsVisibles) || !idsVisibles.length) return;
    try {
      let idsCompletos = [];
      const guardado = typeof localStorage !== 'undefined' ? localStorage.getItem('jg_pdf_orden_manual') : null;
      if (guardado) { try { idsCompletos = JSON.parse(guardado) || []; } catch (_) {} }
      if (!idsCompletos.length) {
        const todos = await almacen.listarDocumentos();
        idsCompletos = (todos || []).map((d) => d.id);
      }
      const setVisibles = new Set(idsVisibles);
      let idxVisible = 0;
      const resultado = [];
      for (const id of idsCompletos) {
        if (setVisibles.has(id)) {
          if (idxVisible < idsVisibles.length) resultado.push(idsVisibles[idxVisible++]);
        } else {
          resultado.push(id);
        }
      }
      while (idxVisible < idsVisibles.length) resultado.push(idsVisibles[idxVisible++]);
      localStorage.setItem('jg_pdf_orden_manual', JSON.stringify(resultado));
      localStorage.setItem('jg_pdf_orden', 'personalizado');
    } catch (_) {
      try {
        localStorage.setItem('jg_pdf_orden_manual', JSON.stringify(idsVisibles));
        localStorage.setItem('jg_pdf_orden', 'personalizado');
      } catch (_) {}
    }
    if (el.orden) { try { el.orden.value = 'personalizado'; } catch (_) {} }
  }

  function anunciarOrganizar(texto) {
    const vivo = document.getElementById('pdfOrganizarLive');
    if (vivo) vivo.textContent = texto || '';
  }

  function anunciarPosicionFila(fila) {
    const filas = [...el.organizarLista.querySelectorAll('.pdf-org-fila')];
    const pos = filas.indexOf(fila) + 1;
    const titulo = fila.dataset.titulo || 'libro';
    anunciarOrganizar(`«${titulo}», posición ${pos} de ${filas.length}`);
  }

  function pintarBotonesFila(fila) {
    const filas = [...el.organizarLista.querySelectorAll('.pdf-org-fila')];
    const antes = fila.querySelector('[data-mov="antes"]');
    const despues = fila.querySelector('[data-mov="despues"]');
    if (antes) antes.disabled = filas.indexOf(fila) <= 0;
    if (despues) despues.disabled = filas.indexOf(fila) >= filas.length - 1;
  }

  function moverFila(fila, direccion) {
    if (!fila || !fila.parentElement) return;
    const lista = fila.parentElement;
    if (direccion === 'antes') {
      const ant = fila.previousElementSibling;
      if (!ant) return;
      lista.insertBefore(fila, ant);
    } else {
      const sig = fila.nextElementSibling;
      if (!sig) return;
      lista.insertBefore(sig, fila);
    }
    pintarBotonesFila(fila);
    anunciarPosicionFila(fila);
    try { if (navigator.vibrate) navigator.vibrate(10); } catch (_) {}
  }

  function filaOrganizar(doc) {
    const tituloDoc = tituloLimpioDe(doc);
    const li = document.createElement('li');
    li.className = 'pdf-org-fila';
    li.dataset.docId = doc.id;
    li.dataset.titulo = tituloDoc;

    const tapa = document.createElement('div');
    tapa.className = 'pdf-org-tapa';
    tapa.dataset.sinPortada = doc.tienePortada ? '0' : '1';
    tapa.dataset.inicial = (tituloDoc || '?').trim().charAt(0).toUpperCase();
    if (doc.tienePortada) {
      almacen.cargarPortada(doc.id).then((blob) => {
        if (blob && blob.size > 0) {
          const url = URL.createObjectURL(blob);
          estado.urlsPortada.push(url);
          tapa.style.backgroundImage = `url("${url}")`;
          tapa.dataset.sinPortada = '0';
        }
      }).catch(() => {});
    }

    const texto = document.createElement('div');
    texto.className = 'pdf-org-texto';
    const titulo = document.createElement('span');
    titulo.className = 'pdf-org-titulo';
    titulo.textContent = tituloDoc;
    titulo.title = tituloDoc;
    const meta = document.createElement('span');
    meta.className = 'pdf-org-meta';
    const partesGuardadas = (doc.titulosPartes || []).length || 1;
    meta.textContent = `${doc.paginasLeidas || 0} págs · ${partesGuardadas > 1 ? `${partesGuardadas} capítulos` : 'capítulo único'}`;
    texto.append(titulo, meta);

    const controles = document.createElement('div');
    controles.className = 'pdf-org-controles';

    const tirador = document.createElement('button');
    tirador.type = 'button';
    tirador.className = 'pdf-org-tirador';
    tirador.title = `Arrastrar para mover ${tituloDoc}. Con el teclado: Alt + flechas arriba o abajo.`;
    tirador.setAttribute('aria-label', `Mover ${tituloDoc} arrastrando, o con Alt más flechas`);
    tirador.innerHTML = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true" style="width:16px;height:16px;"><circle cx="6" cy="3" r="1.1" fill="currentColor" stroke="none"/><circle cx="10" cy="3" r="1.1" fill="currentColor" stroke="none"/><circle cx="6" cy="8" r="1.1" fill="currentColor" stroke="none"/><circle cx="10" cy="8" r="1.1" fill="currentColor" stroke="none"/><circle cx="6" cy="13" r="1.1" fill="currentColor" stroke="none"/><circle cx="10" cy="13" r="1.1" fill="currentColor" stroke="none"/></svg>';
    tirador.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 && e.pointerType === 'mouse') return;
      arrastreOrg = {
        fila: li,
        tirador,
        pointerId: e.pointerId,
        inicioX: e.clientX,
        inicioY: e.clientY,
        iniciado: false,
        ordenAlInicio: null,
      };
    });

    const btnAntes = document.createElement('button');
    btnAntes.type = 'button';
    btnAntes.className = 'mini-btn pdf-org-btn';
    btnAntes.dataset.mov = 'antes';
    btnAntes.textContent = 'Mover antes';
    btnAntes.setAttribute('aria-label', `Mover ${tituloDoc} una posición antes`);
    btnAntes.addEventListener('click', () => moverFila(li, 'antes'));

    const btnDespues = document.createElement('button');
    btnDespues.type = 'button';
    btnDespues.className = 'mini-btn pdf-org-btn';
    btnDespues.dataset.mov = 'despues';
    btnDespues.textContent = 'Mover después';
    btnDespues.setAttribute('aria-label', `Mover ${tituloDoc} una posición después`);
    btnDespues.addEventListener('click', () => moverFila(li, 'despues'));

    controles.append(tirador, btnAntes, btnDespues);

    /* Alt+flechas: atajo explicado en la ayuda del panel y en el tirador. */
    li.addEventListener('keydown', (e) => {
      if (!e.altKey) return;
      if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') { e.preventDefault(); moverFila(li, 'antes'); }
      if (e.key === 'ArrowDown' || e.key === 'ArrowRight') { e.preventDefault(); moverFila(li, 'despues'); }
    });

    li.append(tapa, texto, controles);
    return li;
  }

  function pintarOrganizador() {
    if (!el.organizarLista) return;
    el.organizarLista.innerHTML = '';
    for (const doc of ordenTemporal) el.organizarLista.appendChild(filaOrganizar(doc));
    el.organizarLista.querySelectorAll('.pdf-org-fila').forEach(pintarBotonesFila);
  }

  function entrarLayoutOrganizar() {
    document.querySelectorAll('.pdf-libro-menu[open]').forEach((m) => { m.open = false; });
  }
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.pdf-libro-menu')) entrarLayoutOrganizar();
  });

  window.addEventListener('pointermove', (e) => {
    if (!arrastreOrg) return;
    const a = arrastreOrg;
    if (!a.iniciado) {
      const dx = Math.abs(e.clientX - a.inicioX);
      const dy = Math.abs(e.clientY - a.inicioY);
      if (dx > 6 || dy > 6) {
        a.iniciado = true;
        a.ordenAlInicio = [...el.organizarLista.querySelectorAll('.pdf-org-fila')].map((f) => f.dataset.docId);
        try { a.tirador.setPointerCapture(a.pointerId); } catch (_) {}
        a.fila.classList.add('jg-arrastrando');
        try { if (navigator.vibrate) navigator.vibrate(15); } catch (_) {}
      } else {
        return;
      }
    }
    if (e.cancelable) e.preventDefault();
    /* Autodesplazamiento del contenedor real: la biblioteca vive en el
     * scroll del DOCUMENTO (ver TRAMPAS §3), así que el borde que se
     * vigila es el de la ventana. */
    if (e.clientY < 80) window.scrollBy({ top: -16, behavior: 'auto' });
    else if (e.clientY > window.innerHeight - 80) window.scrollBy({ top: 16, behavior: 'auto' });

    const bajo = document.elementFromPoint(e.clientX, e.clientY)?.closest('.pdf-org-fila');
    el.organizarLista.querySelectorAll('.pdf-org-fila.es-destino').forEach((f) => f.classList.remove('es-destino'));
    if (bajo && bajo !== a.fila) {
      bajo.classList.add('es-destino');
      const rect = bajo.getBoundingClientRect();
      const esDespues = e.clientY > rect.top + rect.height / 2;
      if (esDespues) {
        if (a.fila.previousElementSibling !== bajo) el.organizarLista.insertBefore(a.fila, bajo.nextSibling);
      } else if (a.fila.nextElementSibling !== bajo) {
        el.organizarLista.insertBefore(a.fila, bajo);
      }
    }
  }, { passive: false });

  function terminarArrastreOrg() {
    if (!arrastreOrg) return;
    const a = arrastreOrg;
    arrastreOrg = null;
    if (a.tirador && a.pointerId !== undefined) {
      try { a.tirador.releasePointerCapture(a.pointerId); } catch (_) {}
    }
    a.fila?.classList.remove('jg-arrastrando');
    el.organizarLista?.querySelectorAll('.pdf-org-fila.es-destino').forEach((f) => f.classList.remove('es-destino'));
    if (a.iniciado) anunciarPosicionFila(a.fila);
  }
  window.addEventListener('pointerup', terminarArrastreOrg);
  window.addEventListener('pointercancel', terminarArrastreOrg);

  /** Reordena las filas a partir de una lista de ids (para cancelar). */
  function reponerOrdenOrg(ids) {
    const mapa = new Map(ordenTemporal.map((d) => [d.id, d]));
    ordenTemporal = (ids || []).map((id) => mapa.get(id)).filter(Boolean);
    const faltantes = ordenTemporal.length !== (ids || []).length;
    if (faltantes) {
      const presentes = new Set(ordenTemporal.map((d) => d.id));
      for (const d of mapa.values()) if (!presentes.has(d.id)) ordenTemporal.push(d);
    }
    pintarOrganizador();
  }

  async function entrarOrganizar() {
    if (organizando) return;
    const documentos = await almacen.listarDocumentos();
    if (documentos.length < 2) return;
    organizando = true;
    let modoOrden = 'reciente';
    try { modoOrden = localStorage.getItem('jg_pdf_orden') || 'reciente'; } catch (_) {}
    ordenTemporal = ordenarDocumentos(documentos, modoOrden);
    previoOrganizar = {
      filtro: estado.filtro,
      consulta: estado.consulta,
      buscar: el.buscarLibro ? el.buscarLibro.value : '',
    };
    /* Suspender filtros y búsqueda: se organizan TODOS los libros. */
    estado.filtro = 'todos';
    estado.consulta = '';
    if (el.buscarLibro) el.buscarLibro.value = '';
    document.querySelectorAll('.pdf-filtro').forEach((b) => {
      b.classList.toggle('is-on', b.dataset.filtro === 'todos');
    });
    if (el.organizar) el.organizar.hidden = false;
    if (el.rejilla) el.rejilla.hidden = true;
    if (el.mostrarMas) el.mostrarMas.hidden = true;
    if (el.vacia) el.vacia.hidden = true;
    const filtros = document.querySelector('.pdf-biblioteca-filtros');
    if (filtros) filtros.hidden = true;
    if (el.orden) el.orden.closest('.pdf-biblio-barra')?.setAttribute('hidden', '');
    pintarOrganizador();
    anunciarOrganizar(`Organizando ${ordenTemporal.length} libros. Nada se guarda hasta que pulses Guardar orden.`);
    el.organizarLista?.querySelector('.pdf-org-tirador')?.focus({ preventScroll: false });
  }

  function salirOrganizar() {
    if (!organizando) return;
    organizando = false;
    arrastreOrg = null;
    ordenTemporal = [];
    if (el.organizar) el.organizar.hidden = true;
    if (el.rejilla) el.rejilla.hidden = false;
    const filtros = document.querySelector('.pdf-biblioteca-filtros');
    if (filtros) filtros.hidden = false;
    el.orden?.closest('.pdf-biblio-barra')?.removeAttribute('hidden');
    if (previoOrganizar) {
      estado.filtro = previoOrganizar.filtro;
      estado.consulta = previoOrganizar.consulta;
      if (el.buscarLibro) el.buscarLibro.value = previoOrganizar.buscar;
      document.querySelectorAll('.pdf-filtro').forEach((b) => {
        b.classList.toggle('is-on', b.dataset.filtro === estado.filtro);
      });
      previoOrganizar = null;
    }
    anunciarOrganizar('');
  }

  async function guardarOrganizacion() {
    if (!organizando) return;
    const ids = [...el.organizarLista.querySelectorAll('.pdf-org-fila')].map((f) => f.dataset.docId);
    salirOrganizar();
    await guardarOrdenIds(ids);
    await pintarBiblioteca();
    avisar('Orden guardado.', 'ok', { efimero: true });
    if (el.btnOrganizar) el.btnOrganizar.focus({ preventScroll: true });
  }

  function cancelarOrganizacion() {
    if (!organizando) return;
    salirOrganizar();
    pintarBiblioteca();
    avisar('Se conservó el orden anterior.', 'info', { efimero: true });
    if (el.btnOrganizar) el.btnOrganizar.focus({ preventScroll: true });
  }

  if (el.btnOrganizar) el.btnOrganizar.addEventListener('click', () => { entrarOrganizar(); });
  if (el.organizarGuardar) el.organizarGuardar.addEventListener('click', () => { guardarOrganizacion(); });
  if (el.organizarCancelar) el.organizarCancelar.addEventListener('click', cancelarOrganizacion);
  /* Escape cancela primero el arrastre activo (PDF-06); si no hay arrastre,
   * cancela el modo entero sin guardar. */
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || !organizando) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    if (arrastreOrg?.iniciado) {
      const ids = arrastreOrg.ordenAlInicio;
      terminarArrastreOrg();
      if (ids) reponerOrdenOrg(ids);
      anunciarOrganizar('Arrastre cancelado. El orden volvió a como estaba.');
      return;
    }
    if (arrastreOrg) terminarArrastreOrg();
    cancelarOrganizacion();
  }, true);

  function tarjetaLibro(doc) {
    const tituloDoc = tituloLimpioDe(doc);

    const item = document.createElement('li');
    item.className = 'pdf-libro';
    item.dataset.docId = doc.id;
    item.tabIndex = 0;
    item.setAttribute('role', 'button');
    item.setAttribute('aria-label', `Abrir ${tituloDoc}`);
    item.setAttribute('draggable', 'false');

    item.addEventListener('click', (e) => {
      if (e.target.closest('.pdf-libro-acciones')) return;
      abrirDocumento(doc.id);
    });
    item.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        if (e.target.closest('.pdf-libro-acciones')) return;
        e.preventDefault();
        abrirDocumento(doc.id);
      }
    });

    const tapa = document.createElement('div');
    tapa.className = 'pdf-libro-tapa';
    tapa.dataset.sinPortada = doc.tienePortada ? '0' : '1';
    tapa.dataset.inicial = (tituloDoc || '?').trim().charAt(0).toUpperCase();

    const estadoEl = document.createElement('span');
    estadoEl.className = 'pdf-libro-estado';
    estadoEl.dataset.estado = doc.estado || 'sin-empezar';
    estadoEl.textContent = etiquetaEstado(doc.estado);
    tapa.appendChild(estadoEl);

    // Menú ⋯ de opciones del libro
    const menu = document.createElement('details');
    menu.className = 'pdf-libro-menu';
    menu.addEventListener('click', (e) => e.stopPropagation());

    const summary = document.createElement('summary');
    summary.innerHTML = '<svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true" style="width:13px;height:13px;"><circle cx="3.5" cy="8" r="1.3"/><circle cx="8" cy="8" r="1.3"/><circle cx="12.5" cy="8" r="1.3"/></svg>';
    summary.title = 'Opciones del libro';
    summary.setAttribute('aria-label', `Opciones de ${doc.titulo || 'documento'}`);
    menu.addEventListener('toggle', () => {
      if (menu.open) {
        document.querySelectorAll('.pdf-libro-menu[open]').forEach((m) => {
          if (m !== menu) m.open = false;
        });
      }
    });

    const pop = document.createElement('div');
    pop.className = 'pdf-libro-menu-pop';

    /* El reordenamiento ya no vive aquí: desde PDF-05/06 existe el modo
     * «Organizar» (lista temporal con Guardar/Cancelar). El menú de la
     * tarjeta solo mantiene acciones sobre ESTE libro. */

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

    const buscarTapa = document.createElement('button');
    buscarTapa.type = 'button';
    buscarTapa.className = 'mini-btn';
    buscarTapa.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true" style="width:14px;height:14px;"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg><span>Buscar carátula</span>';
    buscarTapa.title = `Buscar la carátula real de ${tituloDoc}`;
    buscarTapa.setAttribute('aria-label', `Buscar la carátula real de ${tituloDoc}`);
    buscarTapa.addEventListener('click', async (e) => {
      e.stopPropagation();
      menu.open = false;
      avisar('Buscando la carátula…', 'info');
      const origen = await ponerCaratula(doc, { buscarReal: true, forzar: true });
      if (origen === 'real' || origen === 'pdf') avisar(`Carátula encontrada para «${tituloDoc}».`, 'ok', { efimero: true });
      else if (origen === 'dibujada') avisar('No aparece en el catálogo: se dibujó una carátula.', 'info', { efimero: true });
      else avisar('No se pudo poner carátula a este libro.', 'warn');
      await pintarBiblioteca();
      refrescarInicio();
    });

    const borrar = document.createElement('button');
    borrar.type = 'button';
    borrar.className = 'mini-btn btn-peligro';
    borrar.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true" style="width:14px;height:14px;"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/></svg><span>Borrar</span>';
    borrar.title = `Borrar ${doc.titulo || 'este documento'} de la biblioteca`;
    borrar.setAttribute('aria-label', `Borrar ${doc.titulo || 'este documento'}`);
    borrar.addEventListener('click', (e) => {
      e.stopPropagation();
      confirmarBorrado(borrar, doc);
    });

    const privado = document.createElement('button');
    privado.type = 'button';
    privado.className = 'mini-btn';
    const esPrivado = doc.sincronizar === false;
    privado.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true" style="width:14px;height:14px;"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg><span>${esPrivado ? 'Sincronizar' : 'Solo aquí'}</span>`;
    privado.title = esPrivado
      ? 'Volver a copiar este libro entre tus aparatos'
      : 'No copiar este libro a tus otros aparatos';
    privado.setAttribute('aria-label', privado.title);
    privado.addEventListener('click', async (e) => {
      e.stopPropagation();
      menu.open = false;
      const ok = await almacen.marcarPrivado(doc.id, !esPrivado);
      if (!ok) { avisar('No se pudo cambiar este libro.', 'warn'); return; }
      avisar(esPrivado
        ? `«${doc.titulo}» vuelve a copiarse entre tus aparatos.`
        : `«${doc.titulo}» queda solo en este aparato.`, 'info', { efimero: true });
      pintarBiblioteca();
      sincronizarAhora({ silencioso: true });
    });

    const compartir = document.createElement('button');
    compartir.type = 'button';
    compartir.className = 'mini-btn';
    compartir.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true" style="width:14px;height:14px;"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg><span>Compartir copia</span>';
    compartir.title = 'Descargar este libro en un archivo para pasarlo a alguien';
    compartir.setAttribute('aria-label', `Compartir una copia de ${doc.titulo || 'este documento'}`);
    compartir.addEventListener('click', async (e) => {
      e.stopPropagation();
      menu.open = false;
      await descargarCopiaLibro(doc.id);
    });

    let pedir = null;
    if (doc.sincronizar !== false && !doc.tieneArchivo) {
      pedir = document.createElement('button');
      pedir.type = 'button';
      pedir.className = 'mini-btn';
      pedir.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true" style="width:14px;height:14px;"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg><span>Pedir contenido</span>';
      pedir.title = 'Pedirle a tu otro aparato que mande este libro completo';
      pedir.setAttribute('aria-label', `Pedir el contenido completo de ${doc.titulo || 'este documento'}`);
      pedir.addEventListener('click', async (e) => {
        e.stopPropagation();
        menu.open = false;
        if (!nube?.estaVinculada?.()) {
          avisar('Primero conecta este aparato a tu nube con «Conectar otro aparato».', 'warn');
          return;
        }
        const ok = await almacen.pedirReenvio(doc.id, nombreEquipoSync());
        if (!ok) { avisar('No se pudo enviar el pedido.', 'warn'); return; }
        avisar('Pedido enviado. Abre JG Turbo en tu otro aparato para que lo mande.', 'info');
        sincronizarAhora({ silencioso: true });
      });
    }

    let reenviar = null;
    if (doc.pideFuente) {
      reenviar = document.createElement('button');
      reenviar.type = 'button';
      reenviar.className = 'mini-btn';
      reenviar.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true" style="width:14px;height:14px;"><path d="M21 2v6h-6"/><path d="M3 12a9 9 0 0 1 15-6.7L21 8"/><path d="M3 22v-6h6"/><path d="M21 12a9 9 0 0 1-15 6.7L3 16"/></svg><span>Reenviar ahora</span>';
      reenviar.title = `${doc.pideFuente.de || 'Tu otro aparato'} pidió este libro completo`;
      reenviar.setAttribute('aria-label', `Reenviar ${doc.titulo || 'este documento'} completo`);
      reenviar.addEventListener('click', async (e) => {
        e.stopPropagation();
        menu.open = false;
        avisar(`Enviando «${doc.titulo}» completo…`, 'info');
        const ok = await almacen.forzarReenvio(doc.id);
        if (!ok) { avisar('No se pudo preparar el envío.', 'warn'); return; }
        await sincronizarAhora();
      });
    }

    let conPdf = null;
    if (doc.tieneArchivo) {
      conPdf = document.createElement('button');
      conPdf.type = 'button';
      conPdf.className = 'mini-btn';
      conPdf.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true" style="width:14px;height:14px;"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg><span>Compartir con PDF</span>';
      conPdf.title = 'Descargar el libro junto con su PDF original';
      conPdf.setAttribute('aria-label', `Compartir ${doc.titulo || 'este documento'} con su PDF`);
      conPdf.addEventListener('click', async (e) => {
        e.stopPropagation();
        menu.open = false;
        await descargarCopiaLibro(doc.id, { conPdf: true });
      });
    }

    const div2 = document.createElement('div');
    div2.className = 'pdf-menu-divisor';

    pop.append(buscarTapa, reiniciar, privado, compartir);
    if (pedir) pop.append(pedir);
    if (reenviar) pop.append(reenviar);
    if (conPdf) pop.append(conPdf);
    pop.append(div2, borrar);
    menu.append(summary, pop);

    const cuerpo = document.createElement('div');
    cuerpo.className = 'pdf-libro-cuerpo';
    const titulo = document.createElement('span');
    titulo.className = 'pdf-libro-titulo';
    titulo.textContent = tituloDoc;
    titulo.title = tituloDoc;

    const pie = document.createElement('div');
    pie.className = 'pdf-libro-pie';

    const meta = document.createElement('span');
    meta.className = 'pdf-libro-meta';
    const partesGuardadas = (doc.titulosPartes || []).length || 1;
    const porcentaje = doc.progreso
      ? calcularPorcentaje(doc.progreso, (doc.titulosPartes || ['x']).map(() => ({ texto: 'x' })))
      : 0;
    meta.textContent = `${doc.paginasLeidas || 0} págs · ${partesGuardadas > 1 ? `${partesGuardadas} capítulos` : 'capítulo único'}`;

    const acciones = document.createElement('div');
    acciones.className = 'pdf-libro-acciones';
    acciones.append(menu);

    pie.append(meta, acciones);

    const barra = document.createElement('div');
    barra.className = 'pdf-barra';
    barra.setAttribute('role', 'progressbar');
    barra.setAttribute('aria-valuemin', '0');
    barra.setAttribute('aria-valuemax', '100');
    barra.setAttribute('aria-valuenow', String(porcentaje));
    barra.setAttribute('aria-label', `Progreso de ${tituloDoc}`);
    const relleno = document.createElement('div');
    relleno.className = 'pdf-barra-relleno';
    relleno.style.width = `${porcentaje}%`;
    barra.appendChild(relleno);

    cuerpo.append(titulo, pie, barra);
    // Avance de lectura, estado de corrección y sincronización por separado.
    try {
      const sub = document.createElement('span');
      sub.className = 'pdf-libro-sub';
      const lect = etiquetaEstado(doc.estado);
      const corr = doc.pendientesLimites > 0 ? (doc.pendientesLimites + ' cortes por revisar')
        : (doc.versionReconstruccion >= 7 ? 'Texto revisado' : 'Texto local');
      const sync = etiquetaSincroniaDoc(doc);
      sub.dataset.sync = estadoSincroniaDoc(doc);
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
        if (blob && blob.size > 0) {
          const url = URL.createObjectURL(blob);
          estado.urlsPortada.push(url);
          tapa.style.backgroundImage = `url("${url}")`;
          tapa.dataset.sinPortada = '0';
        } else {
          tapa.dataset.sinPortada = '1';
          ponerCaratula(doc, { buscarReal: true, forzar: true }).then((nuevoOrigen) => {
            if (nuevoOrigen !== 'ninguna') {
              almacen.cargarPortada(doc.id).then((nb) => {
                if (nb) {
                  const url = URL.createObjectURL(nb);
                  estado.urlsPortada.push(url);
                  tapa.style.backgroundImage = `url("${url}")`;
                  tapa.dataset.sinPortada = '0';
                }
              });
            }
          }).catch(() => {});
        }
      }).catch(() => { /* sin tapa se vive */ });
    } else {
      tapa.dataset.sinPortada = '1';
      ponerCaratula(doc, { buscarReal: true }).then((origen) => {
        if (origen !== 'ninguna') {
          almacen.cargarPortada(doc.id).then((nb) => {
            if (nb) {
              const url = URL.createObjectURL(nb);
              estado.urlsPortada.push(url);
              tapa.style.backgroundImage = `url("${url}")`;
              tapa.dataset.sinPortada = '0';
            }
          });
        }
      }).catch(() => {});
    }
    return item;
  }

  /* ── Copias para compartir (sin dar la llave a nadie) ──────────── */

  function nombreEquipoSync() {
    try {
      const ua = navigator.userAgent || '';
      if (/iPhone|iPad/i.test(ua)) return 'tu iPhone o iPad';
      if (/Android/i.test(ua)) return 'tu celular Android';
      if (/Macintosh/i.test(ua)) return 'tu Mac';
      if (/Windows/i.test(ua)) return 'tu Windows';
    } catch (_) { /* sin agente se vive */ }
    return 'tu otro aparato';
  }

  function nombreArchivoCopia(titulo) {
    const base = String(titulo || 'libro').toLowerCase().normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '').slice(0, 60);
    return `${base || 'libro'}.jgtcopia.json`;
  }

  async function descargarCopiaLibro(id, { conPdf = false } = {}) {
    try {
      avisar('Preparando la copia…', 'info');
      const copia = await almacen.exportarCopia(id, { conPdf });
      const texto = JSON.stringify(copia);
      const mb = texto.length / 1048576;
      const url = URL.createObjectURL(new Blob([texto], { type: 'application/json' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = nombreArchivoCopia(copia.titulo);
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
      avisar(conPdf
        ? `Copia con PDF lista (${mb.toFixed(1)} MB). Pásala al otro aparato e impórtala desde Opciones de la nube.`
        : 'Copia lista. Pásala al otro aparato e impórtala desde Opciones de la nube.', 'ok');
    } catch (error) {
      avisar(error?.message || 'No se pudo crear la copia.', 'warn');
    }
  }

  async function importarCopiaArchivo(archivo) {
    if (!archivo) return;
    try {
      avisar('Leyendo la copia…', 'info');
      const texto = await archivo.text();
      const objeto = JSON.parse(texto);
      const resultado = await almacen.importarCopia(objeto);
      await pintarBiblioteca();
      refrescarInicio();
      avisar(resultado.omitido
        ? `«${resultado.titulo}» ya estaba aquí más nuevo: se conservó lo local.`
        : `«${resultado.titulo}» quedó guardado solo en este aparato.`, 'ok');
    } catch (error) {
      avisar(error?.message || 'Ese archivo no se pudo importar.', 'error');
    }
  }

  /** Borrar pide confirmación en el propio botón: nada de ventanas modales. */
  function confirmarBorrado(boton, doc) {    if (boton.dataset.confirmando === '1') {
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
    /* Mientras se organiza, la rejilla está suspendida: repintar aquí
     * borraría las filas temporales y su orden sin guardar. Al salir del
     * modo se repinta de todos modos. */
    if (organizando) return;
    const documentos = await almacen.listarDocumentos();
    liberarPortadas();
    el.rejilla.innerHTML = '';
    el.rejilla.hidden = false;

    const hay = documentos.length > 0;
    el.biblioteca.hidden = !hay;
    if (el.lead) el.lead.hidden = hay;
    if (el.subir) el.subir.classList.toggle('pdf-subir--secundaria', hay);

    /* Con menos de dos libros no hay nada que organizar: el botón se
     * deshabilita y EXPLICA por qué (PDF-05). */
    if (el.btnOrganizar) {
      el.btnOrganizar.disabled = documentos.length < 2;
      el.btnOrganizar.title = documentos.length < 2
        ? 'Para organizar necesitas al menos dos libros en la biblioteca.'
        : 'Reordenar tus libros arrastrando, con botones o con el teclado.';
    }

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

    const infoTitulo = limpiarNombreLibro(doc.titulo, doc.nombreArchivo);
    const tituloDoc = (doc.titulo && doc.titulo.trim().toLowerCase() !== '(anonymous)' && doc.titulo.trim().toLowerCase() !== 'untitled')
      ? doc.titulo
      : (infoTitulo.titulo || doc.nombreArchivo || 'Documento');

    el.continuarTitulo.textContent = tituloDoc;
    const falsasPartes = (doc.titulosPartes || ['x']).map((t) => ({ titulo: t, texto: 'x' }));
    const porcentaje = calcularPorcentaje(doc.progreso, falsasPartes);
    el.continuarDonde.textContent = etiquetaProgreso(doc.progreso, falsasPartes);
    el.continuarRelleno.style.width = `${porcentaje}%`;
    el.continuarBarra.setAttribute('aria-valuenow', String(porcentaje));
    el.btnContinuar.onclick = () => abrirDocumento(doc.id);

    el.continuarTapa.style.backgroundImage = '';
    const canonica = buscarPortadaCanonica(tituloDoc || doc.nombreArchivo);
    if (canonica) {
      el.continuarTapa.style.backgroundImage = `url("${canonica}")`;
    }
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
      titulo.textContent = etiquetaSeccion(estado.partes, i);
      /* Con el panel angosto el título se corta: el completo vive en el tooltip. */
      titulo.title = parte.titulo || '';

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
      pagina.textContent = parte.pagina ? `pág. ${parte.pagina} del PDF` : '';
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
        `${etiquetaSeccion(estado.partes, i)}${parte.pagina ? `, página ${parte.pagina} del PDF` : ''}, ${
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
    actualizarRailIndice();
  }

  /* ── Contenido redimensionable (tablet horizontal y escritorio) ────
   *
   * El lector ya reparte las páginas conservando el sitio cuando cambia el
   * hueco (ResizeObserver + medirPaginas con ancla), así que jalar el divisor
   * no pierde la página: es como girar la tablet. En el teléfono no existe
   * (allí el Contenido es hoja inferior y el CSS lo esconde).
   */
  const cuerpoLector = () => el.resultArea?.querySelector('.pdf-lector-cuerpo');

  /* El ancho vigente en píxeles: manda sobre lo guardado mientras se arrastra. */
  let anchoIndiceVigente = leerAnchoIndice();

  function aplicarAnchoIndice(px, { guardar = false } = {}) {
    const ancho = limitarAnchoIndice(px);
    anchoIndiceVigente = ancho;
    try {
      cuerpoLector()?.style.setProperty('--pdf-indice-ancho', `${ancho}px`);
      if (el.indice) {
        el.indice.dataset.ancho = modoAnchoIndice(ancho);
        const divisor = document.getElementById('pdfIndiceDivisor');
        if (divisor) {
          divisor.setAttribute('aria-valuenow', String(ancho));
          divisor.setAttribute('aria-valuetext', `${ancho} píxeles`);
        }
      }
    } catch (_) { /* sin DOM no hay nada que pintar */ }
    if (guardar) guardarAnchoIndice(ancho);
    return ancho;
  }

  function actualizarRailIndice() {
    try {
      const rail = document.getElementById('btnPdfIndiceRail');
      if (!rail) return;
      const escritorio = window.matchMedia?.('(min-width:1024px)').matches;
      rail.classList.toggle('mostrar', Boolean(escritorio && el.indice?.hidden));
    } catch (_) { /* sin ventana no hay riel */ }
  }

  function montarDivisorIndice() {
    if (!el.indice || document.getElementById('pdfIndiceDivisor')) return;
    const divisor = document.createElement('div');
    divisor.className = 'pdf-indice-divisor';
    divisor.id = 'pdfIndiceDivisor';
    divisor.setAttribute('role', 'separator');
    divisor.setAttribute('aria-orientation', 'vertical');
    divisor.setAttribute('aria-label', 'Ajustar el ancho del contenido');
    divisor.tabIndex = 0;
    divisor.setAttribute('aria-valuemin', '200');
    divisor.setAttribute('aria-valuemax', '520');
    const linea = document.createElement('span');
    linea.className = 'pdf-indice-divisor-linea';
    linea.setAttribute('aria-hidden', 'true');
    divisor.appendChild(linea);
    el.indice.appendChild(divisor);
    /* Colapsar vive en la barra del panel (botón de 44px); aquí solo se
     * escucha. El botón no arrastra: su toque es suyo, no del divisor. */
    el.indiceColapsar?.addEventListener('pointerdown', (e) => e.stopPropagation());
    el.indiceColapsar?.addEventListener('click', (e) => {
      e.stopPropagation();
      cerrarIndice();
      actualizarRailIndice();
      document.getElementById('btnPdfIndiceRail')?.focus({ preventScroll: true });
    });

    /* Arrastre con cursor o dedo. Los movimientos se escuchan en el documento
     * entero: el cursor sale de la tira de 16px antes de superar el umbral y
     * si solo escuchara la tira, el arrastre moriría al salir. No se usa
     * captura del puntero: no hace falta y así ningún toque se roba. */
    let arrastre = null;
    let turnoPintura = 0;
    let clicTrasArrastre = false;
    divisor.addEventListener('pointerdown', (e) => {
      if (e.target.closest('button')) return;
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      arrastre = { x0: e.clientX, ancho0: anchoIndiceVigente, activo: false, id: e.pointerId };
    });
    document.addEventListener('pointermove', (e) => {
      if (!arrastre || e.pointerId !== arrastre.id) return;
      const dx = e.clientX - arrastre.x0;
      if (!arrastre.activo) {
        if (Math.abs(dx) <= 6) return;
        arrastre.activo = true;
        divisor.dataset.arrastrando = 'si';
      }
      cancelAnimationFrame(turnoPintura);
      const base = arrastre.ancho0;
      turnoPintura = requestAnimationFrame(() => aplicarAnchoIndice(base + dx));
    }, { passive: true });
    const terminarArrastre = (e) => {
      if (!arrastre || (e && e.pointerId !== arrastre.id)) return;
      const terminoArrastrando = arrastre.activo;
      arrastre = null;
      delete divisor.dataset.arrastrando;
      cancelAnimationFrame(turnoPintura);
      /* Solo se guarda al soltar lo que quedó vigente en pantalla. Y el clic
       * que cae donde se soltó no navega: era el final del arrastre. */
      if (terminoArrastrando) {
        guardarAnchoIndice(anchoIndiceVigente);
        clicTrasArrastre = true;
        setTimeout(() => { clicTrasArrastre = false; }, 120);
      }
    };
    document.addEventListener('pointerup', terminarArrastre);
    document.addEventListener('pointercancel', () => terminarArrastre(null));
    document.addEventListener('click', (e) => {
      if (!clicTrasArrastre) return;
      clicTrasArrastre = false;
      e.stopPropagation();
      e.preventDefault();
    }, true);
    /* Teclado: el divisor es operable sin cursor. */
    divisor.addEventListener('keydown', (e) => {
      const paso = e.shiftKey ? 48 : 16;
      const actual = anchoIndiceVigente;
      if (e.key === 'ArrowLeft') { e.preventDefault(); aplicarAnchoIndice(actual - paso, { guardar: true }); }
      else if (e.key === 'ArrowRight') { e.preventDefault(); aplicarAnchoIndice(actual + paso, { guardar: true }); }
      else if (e.key === 'Home') { e.preventDefault(); aplicarAnchoIndice(ANCHO_INDICE_DEF, { guardar: true }); }
    });

    /* Riel para volver a abrir cuando se colapsó (en escritorio el botón de
     * Contenido de la cabecera está oculto). */
    if (!document.getElementById('btnPdfIndiceRail')) {
      const rail = document.createElement('button');
      rail.type = 'button';
      rail.className = 'pdf-indice-rail';
      rail.id = 'btnPdfIndiceRail';
      rail.setAttribute('aria-label', 'Mostrar el contenido');
      rail.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" aria-hidden="true"><polyline points="9 18 15 12 9 6"/></svg><span>Contenido</span>';
      rail.addEventListener('click', () => {
        abrirHoja('indice', rail);
        actualizarRailIndice();
      });
      document.body.appendChild(rail);
    }
    /* El riel sigue al panel vaya por donde vaya (Escape, fondo, historial):
     * se observa el atributo en vez de cazar cada camino. */
    try {
      new MutationObserver(actualizarRailIndice)
        .observe(el.indice, { attributes: true, attributeFilter: ['hidden'] });
      window.matchMedia?.('(min-width:1024px)').addEventListener?.('change', actualizarRailIndice);
    } catch (_) { /* sin observadores se actualiza al abrir/cerrar a mano */ }
    aplicarAnchoIndice(leerAnchoIndice());
    actualizarRailIndice();
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

  /* Las cuatro hojas del lector comparten un mismo fondo y una misma regla:
   * solo una abierta a la vez. Antes Apariencia y Cortes se abrían sin fondo
   * y el texto de atrás seguía interactuable: en el teléfono se podía tocar
   * un párrafo (y leer en voz alta) sin ver lo que se tocaba. */
  const herramientas = $('pdfHerramientasMenu');
  const herramientasPanel = $('pdfHerramientasPanel');
  const btnHerramientas = $('btnPdfHerramientas');
  const barraTexto = el.resultArea.querySelector('.pdf-modo-barra');
  if (herramientasPanel && barraTexto) herramientasPanel.append(barraTexto);
  /* Las hojas no pertenecen al contenedor que pagina el texto. Dejar allí
     Apariencia disparaba su ResizeObserver al abrirla y al mover cada control. */
  for (const hoja of [el.aparienciaHoja, el.cortesHoja, el.musicaHoja]) if (hoja) el.resultArea.append(hoja);
  const hayHojaAbierta = () => (!el.indice.hidden) || !!(el.masMenu && el.masMenu.open) || !!herramientas?.open
    || !!(el.aparienciaHoja && !el.aparienciaHoja.hidden)
    || !!(el.cortesHoja && !el.cortesHoja.hidden)
    || !!(el.musicaHoja && !el.musicaHoja.hidden);

  function cerrarHojasFlotantes() {
    if (el.aparienciaHoja) el.aparienciaHoja.hidden = true;
    if (el.cortesHoja) el.cortesHoja.hidden = true;
    if (el.musicaHoja) el.musicaHoja.hidden = true;
    el.btnApariencia?.setAttribute('aria-expanded', 'false');
    el.btnMusica?.setAttribute('aria-expanded', 'false');
    if (herramientas) herramientas.open = false;
    btnHerramientas?.setAttribute('aria-expanded', 'false');
  }

  let hojaModal = null;
  const inertes = new Map();
  function pintarFondoHojas() {
    if (!el.hojaFondo) return;
    for (const [nodo, previo] of inertes) nodo.inert = previo;
    inertes.clear();
    hojaModal?.removeAttribute('aria-modal');
    hojaModal = el.aparienciaHoja && !el.aparienciaHoja.hidden ? el.aparienciaHoja
      : el.cortesHoja && !el.cortesHoja.hidden ? el.cortesHoja
      : el.musicaHoja && !el.musicaHoja.hidden ? el.musicaHoja
      : herramientas?.open ? herramientasPanel
      : el.masMenu?.open ? el.masPanel
      : !el.indice.hidden && innerWidth < 1024 ? el.indice : null;
    el.hojaFondo.hidden = !hojaModal;
    if (!hojaModal) return;
    hojaModal.setAttribute('aria-modal', 'true');
    /* Inert solo en las ramas ajenas: jamás en un ancestro de la hoja. */
    const aislar = nodo => {
      for (const hijo of nodo.children) {
        if (hijo === hojaModal || hijo === el.hojaFondo) continue;
        if (hijo.contains(hojaModal) || hijo.contains(el.hojaFondo)) aislar(hijo);
        else { inertes.set(hijo, hijo.inert); hijo.inert = true; }
      }
    };
    aislar(el.resultArea);
  }
  window.matchMedia('(min-width:1024px)').addEventListener('change', pintarFondoHojas);

  /* A quién devolver el foco al cerrar una hoja: al botón que la abrió y,
   * si ese no está a la vista (abierta desde la barra del pulgar y cerrada
   * en tablet, o al revés), al equivalente que sí lo esté. Nunca al <body>:
   * quien navega con teclado se quedaría sin a dónde ir. La hoja de
   * Apariencia ya hacía esto; Contenido, Opciones y Auditoría se quedaban
   * a medias. */
  function devolverFocoHoja(...candidatos) {
    for (const volver of candidatos) {
      if (!volver || volver.offsetParent === null) continue;
      volver.focus({ preventScroll: true });
      /* Un descendiente de <details> cerrado puede conservar geometría en
       * algunos navegadores aunque no acepte foco. En ese caso se prueba el
       * acceso visible equivalente, en vez de dejar el foco en <body>. */
      if (document.activeElement === volver) return;
    }
  }
  let hojaOrigen = null;

  function cerrarHojas({ desdeHistorial = false } = {}) {
    if (!hayHojaAbierta()) { pintarFondoHojas(); return; }
    const origen = hojaOrigen;
    const equivalentes = !el.aparienciaHoja.hidden ? [el.btnApariencia, $('btnPdfBmApariencia')]
      : (el.musicaHoja && !el.musicaHoja.hidden) ? [el.btnMusica]
      : !el.indice.hidden ? [el.btnIndice, $('btnPdfBmIndice')]
      : [el.btnMas, $('btnPdfBmOpciones')];
    cerrarIndice();
    if (el.masMenu) el.masMenu.open = false;
    if (el.btnMas) el.btnMas.setAttribute('aria-expanded', 'false');
    cerrarHojasFlotantes();
    pintarFondoHojas();
    devolverFocoHoja(origen, ...equivalentes, btnHerramientas);
    hojaOrigen = null;
    if (!desdeHistorial) capas.cerrar('hoja');
  }

  function abrirHoja(cual, origen) {
    /* Solo una hoja a la vez: dos capas superpuestas es justo lo que hacía
     * imposible saber dónde tocar para volver.
     *
     * El paso en el historial representa «hay una hoja abierta», no cada
     * hoja: si se pasa de Contenido a Opciones, sigue habiendo una sola, y
     * anotar dos obligaría a pulsar «atrás» dos veces para lo mismo. */
    const habiaOtra = capas.hay('hoja');
    hojaOrigen = origen || null;
    cerrarIndice();
    cerrarHojasFlotantes();
    if (el.masMenu) el.masMenu.open = false;
    let focoYaEnHoja = false;
    if (cual === 'indice') {
      pintarIndice();
      el.indice.hidden = false;
      el.btnIndice.setAttribute('aria-expanded', 'true');
      actualizarRailIndice();
      /* Que el capítulo actual quede a la vista sin tener que buscarlo. */
      const actual = el.indiceLista.querySelector('[aria-current="true"]');
      if (actual) {
        const lista = el.indiceLista;
        lista.scrollTop += actual.getBoundingClientRect().top - lista.getBoundingClientRect().top
          - lista.clientHeight / 2 + actual.clientHeight / 2;
        /* Foco en la sección actual al abrir (PDF-10): orienta sin recorrer
         * todo el índice. El cierre devuelve el foco al disparador, como en
         * Apariencia. */
        try { actual.focus({ preventScroll: true }); focoYaEnHoja = true; } catch (_) {}
      }
    } else if (cual === 'apariencia') {
      el.aparienciaHoja.hidden = false;
      el.btnApariencia?.setAttribute('aria-expanded', 'true');
    } else if (cual === 'musica') {
      if (el.musicaHoja) {
        el.musicaHoja.hidden = false;
        el.btnMusica?.setAttribute('aria-expanded', 'true');
      }
    } else if (cual === 'cortes') {
      el.cortesHoja.hidden = false;
    } else if (cual === 'herramientas') {
      herramientas.open = true;
      btnHerramientas.setAttribute('aria-expanded', 'true');
    } else if (el.masMenu) {
      el.masMenu.open = true;
      if (el.btnMas) el.btnMas.setAttribute('aria-expanded', 'true');
      if (el.masPanel) el.masPanel.scrollTop = 0;
    }
    pintarFondoHojas();
    /* Foco al abrir (PDF-10): el primer control ENFOCABLE Y VISIBLE de la
     * hoja. Sin el filtro, el primer botón del índice a <1024px es el
     * «colapsar» de escritorio (display:none): focus() no hacía nada, el
     * foco caía al <body> y la trampa de Tab, que vive en resultArea,
     * nunca se disparaba. Si el índice ya enfocó su sección actual, ese
     * foco manda y aquí no se pisa. */
    if (!focoYaEnHoja) {
      const enfocable = hojaModal
        ? [...hojaModal.querySelectorAll('button:not([disabled]), select, input, summary')]
          .find((n) => n.getClientRects().length && !n.closest('[hidden]'))
        : null;
      enfocable?.focus({ preventScroll: true });
    }
    if (!habiaOtra) capas.abrir('hoja', () => cerrarHojas({ desdeHistorial: true }));
  }

  btnHerramientas?.addEventListener('click', ev => {
    ev.preventDefault();
    if (herramientas.open) cerrarHojas(); else abrirHoja('herramientas', btnHerramientas);
  });
  herramientasPanel?.addEventListener('click', ev => {
    if (ev.target.closest('#pdfVistaLectura, #pdfVistaEditar, #btnPdfUnirPalabras, #btnPdfPausarCorreccion')) cerrarHojas();
  });
  el.resultArea.addEventListener('keydown', ev => {
    if (ev.key !== 'Tab' || !hojaModal) return;
    const controles = [...hojaModal.querySelectorAll('button:not([disabled]), select, input, summary, [tabindex="0"]')]
      .filter(n => n.getClientRects().length && !n.closest('[hidden], [inert]'));
    const primero = controles[0], ultimo = controles.at(-1);
    if (ev.shiftKey && (document.activeElement === primero || !hojaModal.contains(document.activeElement))) {
      ev.preventDefault(); ultimo?.focus({ preventScroll: true });
    } else if (!ev.shiftKey && (document.activeElement === ultimo || !hojaModal.contains(document.activeElement))) {
      ev.preventDefault(); primero?.focus({ preventScroll: true });
    }
  });

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
    /* Cabecera (PDF-03): el título del libro ya está en el h3; aquí va UNA
     * sola etiqueta de sección —el título editorial si se conoce, si no
     * «Sección X de Y»—, nunca el porcentaje ni los minutos (viven en el
     * pie) y nunca dos rótulos de capítulo a la vez. */
    const etiqueta = etiquetaSeccion(estado.partes, estado.parteActual);
    if (el.donde) {
      el.donde.textContent = etiqueta;
      el.donde.title = etiqueta;
      el.donde.setAttribute('aria-expanded', el.docRef && !el.docRef.hidden ? 'true' : 'false');
    }
    /* Detalle bajo demanda (PDF-03): título completo + referencia física.
     * La página del PDF es donde EMPIEZA esta sección, y se dice así; si no
     * se conoce, no se inventa: el detalle trae solo el título. */
    if (el.docRef) {
      const parte = estado.partes[estado.parteActual] || {};
      const titCompleto = String(estado.titulo || '').trim();
      const titSeccion = String(parte.titulo || '').trim();
      const pagFisica = parte.pagina || parte.pageStart || '';
      const trozos = [];
      if (titCompleto) trozos.push(titCompleto);
      if (titSeccion && titSeccion !== etiqueta) trozos.push(titSeccion);
      if (pagFisica) trozos.push(`Página ${pagFisica} del PDF (inicio de esta sección)`);
      el.docRef.textContent = trozos.join(' · ') || etiqueta;
    }
    if (varias) {
      el.navPos.textContent = `Sección ${estado.parteActual + 1} de ${estado.partes.length}`;
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
    /* El pie vive en la vista de libro; su % ahora es del libro y cambia
     * con el progreso, no solo al pasar página. */
    try { libroVista?.pintarPieLectura?.(); } catch (_) {}
  }

  /* El resumen de progreso se pulsa y amplía el contexto (PDF-03): título
   * completo + página física, sin abandonar la lectura. En el teléfono la
   * cabecera es fija: el detalle crece ENCIMA del texto, solo cuando la
   * persona lo pide. */
  if (el.donde && el.docRef && !el.donde.dataset.conDetalle) {
    el.donde.dataset.conDetalle = '1';
    el.donde.addEventListener('click', () => {
      const abierto = !el.docRef.hidden;
      el.docRef.hidden = abierto;
      el.donde.setAttribute('aria-expanded', abierto ? 'false' : 'true');
      const ident = el.donde.closest('.pdf-doc-ident');
      if (ident) ident.dataset.detalle = abierto ? 'no' : 'si';
      /* La cabecera cambió de alto: se remide sin perder el sitio (PDF-09). */
      try { libroVista?.remedirTrasCromo?.(); } catch (_) {}
    });
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

  let scrollAntesLector = 0;
  let restauracionScroll = 'auto';
  function abrirLector() {
    /* Si alguien abre un libro con el organizador puesto (p. ej. «Seguir
     * leyendo» o un PDF recién importado), el modo se retira sin guardar:
     * el lector manda. */
    if (organizando) salirOrganizar();
    const nuevo = !(el.area && el.area.classList.contains('has-results'));
    if (el.area) el.area.classList.add('has-results');
    el.resultArea.style.display = '';
    if (el.ocrBox) el.ocrBox.hidden = true;
    /* Modo lectura: el CSS aparta el encabezado y las pestañas de la app en
     * celular y tablet. Son ~120 px que pasan al texto. */
    if (!document.body.classList.contains('jg-leyendo')) {
      scrollAntesLector = window.scrollY || 0;
      restauracionScroll = history.scrollRestoration;
      history.scrollRestoration = 'manual';
    }
    document.body.classList.add('jg-leyendo');
    /* Entrar desde el selector de archivos puede dejar el documento desplazado
       cientos de píxeles. Al convertirlo en pantalla fija ese scroll seguía
       aplicado y cortaba la cabecera del lector por arriba. */
    window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
    /* La pantalla completa de escritorio se recuerda, pero solo mientras hay
     * un libro abierto: en la biblioteca haría falta el encabezado. */
    if (pantallaGuardada()) fijarPantallaCompleta(true);
    if (el.notice) el.notice.hidden = true;
    if (nuevo) capas.abrir('lector', () => volverABiblioteca({ desdeHistorial: true }));
  }

  function cerrarDocumento({ desdeHistorial = false } = {}) {
    cerrarComparacion({ devolverFoco: false });
    if (estado.id) {
      anotarPosicion();
      clearTimeout(temporizadorGuardado);
      almacen.guardarProgreso(estado.id, estado.progreso, estado.partes);
    }
    /* Cerrar el lector cierra también la hoja que estuviera encima: la pila
     * de capas retira las dos de un salto para no dejar entradas huérfanas
     * en el historial. */
    cerrarHojas({ desdeHistorial: true });
    cerrarHojaAuditoria(null);
    if (!desdeHistorial) capas.cerrar('lector');
    document.body.classList.remove('jg-leyendo');
    document.body.classList.remove('jg-pantalla');
    history.scrollRestoration = restauracionScroll;
    requestAnimationFrame(() => window.scrollTo({ top: scrollAntesLector, left: 0, behavior: 'auto' }));
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
    estado.fragmentosFuente = [];
    estado.transformaciones = [];
    estado.estructura = [];
    estado.calidadPorPagina = [];
    estado.estadoFidelidad = null;
    estado.paginasFuente = [];
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
    try {
      localStorage.removeItem('jg_pdf_doc_abierto');
      localStorage.setItem('jg_pdf_vista_activa', 'biblioteca');
      sessionStorage.removeItem('jg_pdf_en_lector');
    } catch (_) {}
  }

  /** Deja el documento en pantalla, listo para leer desde donde iba. */
  async function montarDocumento({ id, titulo, partes, totalPaginas, idioma, progreso, capitulos, bloques, fuenteRevision }) {
    estado.id = id;
    estado.titulo = titulo;
    estado.partes = partes;
    if (estado.figuras && estado.figuras.length) soltarFiguras();
    estado.figuras = estado.figuras || [];
    try {
      localStorage.setItem('jg_pdf_doc_abierto', id);
      localStorage.setItem('jg_pdf_vista_activa', 'lector');
      sessionStorage.setItem('jg_pdf_en_lector', id);
    } catch (_) {}
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
    actualizarEstadoFidelidad();
    await mostrarParte(estado.progreso.parte || 0, {
      desplazamiento: estado.progreso.desplazamiento || 0,
    });
    /* Confirmar la posición recuperada sin tapar texto (PDF-04): la
     * confirmación vive en la zona de estado del lector, no en un flotante
     * sobre el texto; no mueve el foco, no trae acciones temporizadas y se
     * retira sola. «Ir al inicio del libro» vive en Contenido. */
    if (el.modoEstados) {
      const frase = etiquetaReanudar(estado.progreso, estado.partes);
      if (frase) {
        el.modoEstados.textContent = 'Lectura reanudada';
        clearTimeout(estado.temporizadorReanudar);
        estado.temporizadorReanudar = setTimeout(() => {
          if (el.modoEstados && el.modoEstados.textContent === 'Lectura reanudada') {
            el.modoEstados.textContent = '';
          }
        }, 6000);
      }
    }
    if (estado.pulidoActivo && estado.vista === 'original' && estado.consentido) {
      iniciarCorreccionLibro({ automatica: true }).catch(() => {});
    }
    /* Los gráficos llegan después, sin `await`: el libro ya se puede leer. */
    asegurarFiguras(id);
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
    /* El metadato `tieneArchivo` de documentos antiguos puede estar atrasado.
     * La fuente de verdad es el blob que realmente existe en IndexedDB: si
     * está, se reextrae; si falta, se conserva el texto y se marca para
     * revisión sin adivinar uniones. */
    const archivo = await almacen.cargarArchivo(doc.id);
    const plan = planMigracionV6({
      versionTroceo: doc.versionTroceo,
      versionReconstruccion: doc.versionReconstruccion,
      tieneArchivo: Boolean(archivo),
      manifiesto: doc.manifiesto,
      tieneAprobado: Boolean(doc.tieneAprobado),
    });

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
      /* Antes de pedir el PDF: si la sincronización trajo el manifiesto con
       * sus decisiones y es de la versión actual, se confía en lo corregido.
       * Es el caso de la tablet que abre lo que el celular ya corrigió: el
       * texto guardado ya es el bueno y no hay que reextraer nada. */
      try {
        const sinc = await almacen.cargarManifiesto(doc.id);
        if (sinc && !sinc.conGeometria) {
          const decision = confiarEnCorreccionSync(doc, {
            v: 1,
            pendientes: Number.isFinite(sinc.pendientes) ? sinc.pendientes : 0,
            ver: sinc.ver || {},
            manifiesto: sinc.manifiesto,
          });
          if (decision.confiar) {
            return {
              partes,
              capitulos: doc.capitulos || reconstruido.capitulos,
              progreso: doc.progreso,
              bloques: [],
              correccionConfiable: true,
              pendientes: Number.isFinite(sinc.pendientes) ? sinc.pendientes : 0,
              limites: sinc.manifiesto,
            };
          }
        }
      } catch (_) { /* si no se pudo comprobar, se pide como antes */ }
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

  /* ── Figuras del libro ─────────────────────────────────────────────
   *
   * Los gráficos no están en el texto: hay que sacarlos del PDF aparte. Se
   * hace SIEMPRE en segundo plano y después de que el libro ya se pueda leer,
   * porque un barrido de mil páginas no puede retrasar la lectura ni un
   * segundo. Se hace una sola vez por libro y queda guardado.
   */
  let figurasEnCurso = null;

  function soltarFiguras() {
    for (const f of estado.figuras || []) {
      if (f.url) { try { URL.revokeObjectURL(f.url); } catch (_) { /* nada */ } }
    }
    estado.figuras = [];
    if (figurasEnCurso) figurasEnCurso.cancelado = true;
    figurasEnCurso = null;
  }

  /** Convierte lo guardado en algo que la vista pueda pintar. */
  function prepararFiguras(guardadas) {
    const salida = [];
    (guardadas || []).forEach((f, i) => {
      if (!f || !f.blob) return;
      let url = '';
      try { url = URL.createObjectURL(f.blob); } catch (_) { return; }
      salida.push({ ...f, indice: i, url });
    });
    return salida;
  }

  async function asegurarFiguras(id, doc) {
    if (!id) return;
    soltarFiguras();
    const registro = doc || await almacen.cargarDocumento(id).catch(() => null);
    if (estado.id !== id) return;          /* se abrió otro libro entretanto */
    const yaHechas = registro?.figurasEstado;

    /* Ya se buscaron alguna vez: se pintan y no se vuelve a barrer. */
    if (yaHechas === 'listas' || yaHechas === 'ninguna') {
      const guardadas = yaHechas === 'listas' ? await almacen.cargarFiguras(id) : [];
      if (guardadas.length) {
        estado.figuras = prepararFiguras(guardadas);
        if (libroVista) libroVista.renderLectura({ conservar: true });
      }
      return;
    }

    /* Primera vez (o libro de antes de esta versión): barrido en diferido. */
    const pdf = await almacen.cargarArchivo(id);
    if (!pdf) {
      await almacen.guardarFiguras(id, [], 'sinpdf');
      return;
    }

    const cancelacion = { cancelado: false };
    figurasEnCurso = cancelacion;
    try {
      const pdfjs = await cargarMotor();
      const docPdf = await pdfjs.getDocument({
        data: new Uint8Array(await pdf.arrayBuffer()),
        useSystemFonts: true,
        isEvalSupported: false,
      }).promise;
      try {
        const { figuras, cancelado } = await extraerFiguras(docPdf, pdfjs, {
          cancelacion,
          anchoObjetivo: 1000,
        });
        if (cancelado || estado.id !== id) return;
        await almacen.guardarFiguras(id, figuras, figuras.length ? 'listas' : 'ninguna');
        if (figuras.length) {
          estado.figuras = prepararFiguras(figuras);
          if (libroVista) libroVista.renderLectura({ conservar: true });
          avisar(figuras.length === 1
            ? 'Se añadió 1 gráfico del PDF a la lectura.'
            : `Se añadieron ${figuras.length} gráficos del PDF a la lectura.`,
          'info', { efimero: true });
        }
      } finally {
        try { await docPdf.destroy(); } catch (_) { /* nada */ }
      }
    } catch (error) {
      /* Que falten los gráficos no puede romper la lectura. */
      console.warn('[jg-figuras] no se pudieron extraer', error);
    } finally {
      if (figurasEnCurso === cancelacion) figurasEnCurso = null;
    }
  }

  async function abrirDocumento(id) {
    const doc = await almacen.cargarDocumento(id);
    let partes = await almacen.cargarContenido(id);
    if (!doc || !partes || !partes.length) {
      avisar('Ese documento ya no está guardado.', 'warn');
      try {
        localStorage.removeItem('jg_pdf_doc_abierto');
        localStorage.setItem('jg_pdf_vista_activa', 'biblioteca');
        sessionStorage.removeItem('jg_pdf_en_lector');
      } catch (_) {}
      refrescarInicio();
      return;
    }

    /* Libros guardados con el troceo antiguo: se rehacen una vez y queda
     * anotado, para no repetirlo en cada apertura. */
    let capitulos = doc.capitulos || [];
    let progreso = doc.progreso;
    let bloquesRehechos = null;
    let needsSourceActual = Boolean(doc.needsSource);
    if (doc.versionTroceo !== VERSION_TROCEO || doc.versionReconstruccion !== VERSION_RECONSTRUCCION) {
      avisar('Reconstruyendo el libro para unir palabras partidas…', 'info');
      const rehecho = await rehacerTroceo(doc, partes);
      if (rehecho?.needsSource) {
        needsSourceActual = true;
        avisar('Para reprocesar este libro hace falta el PDF original. Leer y escuchar funcionan con el texto guardado.', 'warn');
        await almacen.marcarTroceo(id, VERSION_TROCEO, {
          partes: rehecho.partes || partes,
          capitulos: rehecho.capitulos || capitulos,
          progreso,
          needsSource: true,
        });
      } else if (rehecho?.correccionConfiable) {
        /* Llegó corregido del otro aparato: se adopta su versión y sus
         * pendientes, y no se vuelve a pedir el PDF por esto. */
        needsSourceActual = false;
        partes = rehecho.partes;
        capitulos = rehecho.capitulos;
        progreso = rehecho.progreso;
        try {
          estado.limites = expandirManifiesto(rehecho.limites || []);
        } catch (_) { /* los límites se cargan al abrir como siempre */ }
        await almacen.marcarTroceo(id, VERSION_TROCEO, {
          versionReconstruccion: VERSION_RECONSTRUCCION,
          pendientesLimites: Number(rehecho.pendientes) || 0,
          needsSource: false,
        });
        if (Number(rehecho.pendientes) > 0) {
          avisar(`Llegó corregido de tu otro aparato con ${rehecho.pendientes} cortes por revisar. Puedes revisarlos aquí; el PDF no hace falta.`, 'info', { efimero: true });
        } else {
          avisar('Llegó corregido de tu otro aparato: no necesitas subir el PDF.', 'info', { efimero: true });
        }
      } else if (rehecho) {
        needsSourceActual = false;
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
    estado.atomos = [];
    estado.limites = [];
    estado.offsetDeAtomo = new Map();
    estado.localTexto = componerLibroDesdePartes(partes);
    estado.originalTexto = estado.localTexto;
    estado.needsSource = needsSourceActual;
    const reconstruccionGuardada = await almacen.cargarReconstruccion(id);
    if (reconstruccionGuardada?.atomos?.length) {
      estado.atomos = reconstruccionGuardada.atomos;
      estado.limites = expandirManifiesto(reconstruccionGuardada.manifiesto || []);
      estado.paginasFuente = reconstruccionGuardada.paginas || [];
      estado.offsetDeAtomo = new Map(reconstruccionGuardada.offsets || []);
      estado.fragmentosFuente = reconstruccionGuardada.fragmentosFuente || reconstruccionGuardada.atomosTodos || [];
      estado.transformaciones = reconstruccionGuardada.transformaciones || [];
      estado.estructura = reconstruccionGuardada.estructura || [];
      estado.calidadPorPagina = reconstruccionGuardada.calidadPorPagina || [];
      estado.estadoFidelidad = reconstruccionGuardada.estadoFidelidad || null;
      estado.omisiones = reconstruccionGuardada.omisiones || [];
    } else if (!estado.limites.length) {
      /* Sin geometría pero con manifiesto sincronizado, los límites se cargan
       * igual: los conteos y la hoja de cortes dicen la verdad aunque el PDF
       * esté en otro aparato. Solo se levanta la marca de fuente cuando el
       * manifiesto es vigente (confiarEnCorreccionSync). */
      try {
        const sinc = await almacen.cargarManifiesto(id);
        if (sinc && !sinc.conGeometria && Array.isArray(sinc.manifiesto) && sinc.manifiesto.length) {
          estado.limites = expandirManifiesto(sinc.manifiesto || []);
          if (needsSourceActual) {
            const decision = confiarEnCorreccionSync(doc, {
              v: 1,
              pendientes: Number.isFinite(sinc.pendientes) ? sinc.pendientes : 0,
              ver: sinc.ver || {},
              manifiesto: sinc.manifiesto,
            });
            if (decision.confiar) {
              estado.needsSource = false;
              needsSourceActual = false;
              try {
                await almacen.marcarTroceo(id, VERSION_TROCEO, {
                  versionReconstruccion: VERSION_RECONSTRUCCION,
                  pendientesLimites: Number.isFinite(sinc.pendientes) ? sinc.pendientes : 0,
                  needsSource: false,
                });
              } catch (_) { /* el aviso ya es correcto aunque no se anote */ }
            }
          }
        }
      } catch (_) { /* se mantiene el aviso anterior */ }
    }
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
    const mensaje = !p.ejecutando && r?.lista && pendientesLimites > 0
      ? 'Puntuación revisada · ' + pendientesLimites + ' cortes por revisar'
      : texto;
    if (incompletas > 0 || pendientesLimites > 0) mostrarPulidoEstado(mensaje, p.ejecutando ? '' : 'pendiente');
    else mostrarPulidoEstado(mensaje, lista ? 'ok' : '');
    const mostrarReanudar = !!(cola && !p.ejecutando && estado.consentido && r && !r.lista && incompletas > 0)
      && !estado.descartoReanudarCorreccion;
    if (el.reanudarCorreccion) {
      el.reanudarCorreccion.hidden = !mostrarReanudar;
      if (el.reanudarCorreccionTxt) el.reanudarCorreccionTxt.textContent = texto;
    }
    try { if (libroVista && libroVista.refrescarPausa) libroVista.refrescarPausa(); } catch (_) {}
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
    /* El foco vuelve de donde salió: al botón de corregir si su panel sigue
     * abierto, y si no, al estado de la corrección de la cabecera, que es
     * quien reabre esta hoja. Sin esto el foco caía al <body>. */
    if (hayDocumento()) {
      devolverFocoHoja(document.getElementById('btnPdfCorregirLibro'), el.pulidoEstado);
    }
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

  /* La corrección se pide desde Opciones, cuando la persona la busca: abrir un
   * libro ya no lanza ninguna hoja encima del texto. */
  if (el.btnCorregirLibro) {
    el.btnCorregirLibro.addEventListener('click', () => {
      if (!hayDocumento()) { avisar('Abre un libro primero.', 'info', { efimero: true }); return; }
      cerrarHojas();
      if (estado.consentido) {
        iniciarCorreccionLibro()
          .catch((e) => avisar('No se pudo corregir: ' + (e?.message || 'inténtalo de nuevo.'), 'warn'));
        return;
      }
      pedirConsentimientoAuditoria();
    });
  }

  if (el.auditoriaAceptar) el.auditoriaAceptar.addEventListener('click', () => cerrarHojaAuditoria(true));
  if (el.auditoriaRechazar) el.auditoriaRechazar.addEventListener('click', () => cerrarHojaAuditoria(false));
  if (el.auditoriaCerrar) el.auditoriaCerrar.addEventListener('click', () => cerrarHojaAuditoria(null));
  if (el.btnReanudarCorreccionCerrar) {
    el.btnReanudarCorreccionCerrar.addEventListener('click', () => {
      if (el.reanudarCorreccion) el.reanudarCorreccion.hidden = true;
      estado.descartoReanudarCorreccion = true;
    });
  }
  if (el.btnReanudarCorreccion) {
    el.btnReanudarCorreccion.addEventListener('click', () => {
      estado.descartoReanudarCorreccion = false;
      /* Sin este catch, un fallo aquí era silencio total: «el botón falla». */
      iniciarCorreccionLibro({ reanudar: true })
        .catch((e) => avisar('No se pudo reanudar: ' + (e?.message || 'inténtalo de nuevo.'), 'warn'));
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
        const meta = await almacen.cargarDocumento(docIdCola);
        if (estado.id !== docIdCola) return;
        estado.guardadoConfirmado = r.lista && meta?.revisionLectura === sha256Hex(componerLibroDesdePartes(estado.partes));
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
  async function resolverCortesPendientes({ abortado, onAvance, silencioso = false } = {}) {
    const pendientes = (estado.limites || []).filter((l) => l?.decision === 'pending');
    if (!pendientes.length) return { resueltos: 0, pendientes: 0 };
    const decidir = window.jgDecidirLimitesPdf || window.jgPedirDecisionesLimites;
    if (typeof decidir !== 'function') return { resueltos: 0, pendientes: pendientes.length };
    const LOTE = 24;
    const lotes = Math.ceil(pendientes.length / LOTE);
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
        if (abortado?.()) return { resueltos: 0, pendientes: pendientes.length };
        const decisiones = Array.isArray(resp?.decisions) ? resp.decisions : [];
        const { aplicadas } = aceptarDecisionesIA(estado.limites, decisiones);
        resueltos += aplicadas.length;
        /* La etapa 1 son N peticiones en serie: sin contar los lotes, la
         * etiqueta se queda clavada en «Etapa 1 de 3» y parece colgada. */
        try { onAvance?.({ lote: Math.floor(i / LOTE) + 1, lotes, resueltos }); } catch (_) {}
      } catch (error) {
        /* El arranque automático al abrir el libro sigue silencioso: un fallo
         * de red o de guardado no puede tapar el dock con un aviso flotante.
         * El estado queda en la píldora de Opciones («Reintenta desde
         * Opciones»), que es donde la persona lo busca. */
        if (!silencioso) avisar('No se pudo consultar la corrección de cortes. Puedes reintentar desde Opciones.', 'warn');
        break;
      }
    }
    if (resueltos > 0 && !abortado?.()) await reconstruirTrasDecision({ duranteCorreccion: true });
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
          libroVista?.renderLectura({ conservar: true });
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
      const guardado = await almacen.marcarTroceo(estado.id, VERSION_TROCEO, {
        partes: nuevas,
        capitulos: capsPrevias,
        progreso: estado.progreso,
        bloques: bloquesPrevios,
        versionReconstruccion: VERSION_RECONSTRUCCION,
        pendientesLimites: contarPendientes(estado.limites),
        fuenteRevision: revision,
        revisionLectura: sha256Hex(libro),
      });
      if (guardado === false) throw new Error('No se pudo guardar la revisión.');
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
    libroVista?.renderLectura({ conservar: true });
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
  async function iniciarCorreccionLibro({ reanudar = false, automatica = false } = {}) {
    if (!estado.consentido || !estado.partes.length) {
      /* Reanudar con el permiso caído no puede quedarse callado: desde fuera
       * se ve como «el botón falla». El arranque automático al abrir el libro
       * sí sigue silencioso. */
      if (reanudar && !automatica) avisar('Para reanudar, autoriza primero la corrección desde Opciones → Corregir.', 'info');
      return;
    }
    if (estado.correccionProgreso.ejecutando) return;
    const documentoSolicitado = estado.id;
    /* Si ya se sabe que no hay cortes pendientes, no hay nada que preparar:
     * pedir el PDF aquí era el aviso fantasma al abrir libros ya revisados. */
    if (estadoRevisionCortes(estado.limites) === 'revisado') {
      if (!automatica) avisar('Este libro ya está revisado: no hay palabras partidas pendientes.', 'info');
      return;
    }
    try { await prepararFuenteCorreccion(); }
    catch (error) {
      /* Igual que la falta de IA: el arranque automático al abrir es
       * silencioso. Solo la acción manual (Corregir / Reanudar) avisa. */
      if (!automatica) avisar('No se pudo preparar el PDF para corregir: ' + error.message, 'warn');
      return;
    }
    if (estado.id !== documentoSolicitado || !estado.atomos?.length) return;
    await colaLista;
    if (!estado.consentido || !estado.partes.length) return;
    if (estado.correccionProgreso.ejecutando) return;
    /* Sin IA no se arranca: antes se colgaba «Etapa 1 de 3» para nada. El
     * arranque automático al abrir (automatica) sigue silencioso. */
    if (typeof window.jgHayIAParaCorregir === 'function' && !window.jgHayIAParaCorregir()) {
      if (!automatica) avisar('Corregir necesita IA: configura una clave en Configuración → Servidor e IA (o revisa la cuota) y vuelve a intentarlo.', 'warn');
      return;
    }

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
      const r1 = await resolverCortesPendientes({ abortado, silencioso: !!automatica,
        onAvance: ({ lote, lotes, resueltos }) => {
          estado.correccionProgreso.etapa = `Etapa 1/3 · Cortes (lote ${lote} de ${lotes} · ${resueltos} resueltos)`;
          actualizarEstadoCorreccion();
        } });
      if (abortado()) return;
      if (Number(r1?.pendientes) > 0) {
        // La duda sobre un separador no impide revisar la puntuación del
        // resto. Se conserva el corte y el libro sigue marcado pendiente.
        // En automático no se grita: el conteo ya vive en la píldora de
        // Opciones y el aviso flotante taparía Anterior/Siguiente/Escuchar.
        if (!automatica) avisar('Quedan ' + r1.pendientes + ' cortes para revisión manual. Continúa la revisión de puntuación.', 'warn');
        else { estado.correccionProgreso.etapa = ''; actualizarEstadoCorreccion(); }
      }
    } catch (error) {
      console.warn('[jg-pdf] etapa 1 no completada', error);
      estado.correccionProgreso.ejecutando = false;
      estado.correccionProgreso.etapa = 'No se pudieron guardar los cortes';
      actualizarEstadoCorreccion();
      /* Fallo automático silencioso: el estado queda en «Reintenta desde
       * Opciones» sin flotante sobre el dock. Solo la orden manual avisa,
       * porque la persona acaba de pulsar y espera respuesta. */
      if (!automatica) avisar(error.message || 'No se pudieron guardar los cortes. Reintenta desde Opciones.', 'warn');
      return;
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
      sourceRevision: estado.colaCorreccion.sourceRevision,
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
    // Abrir, escuchar o traducir consulta lo guardado. Solo la cola del libro
    // pide correcciones: no se lanza otro proceso por capítulo en paralelo.
    const docId = estado.id;
    try {
      const registro = await almacen.cargarPulidoRegistro(docId, indice);
      if (estado.id !== docId || estado.partes[indice] !== parte) return false;
      if (!registro?.textoSeguro || registro.estado !== 'lectura_segura' || registro.version !== VERSION_PULIDO_LECTURA
          || registro.huellaOrigen !== construirHuella(parte.texto)) return false;
      estado.pulido.set(indice, registro.textoSeguro);
      if (el.pulidoCambio) el.pulidoCambio.hidden = false;
      if (mostrar && estado.pulidoActivo && estado.vista === 'original') volcarPulido(indice);
      return true;
    } catch (_) { return false; }
  }

  function volcarPulido(indice) {
    if (indice !== estado.parteActual || estado.vista !== 'original' || !estado.pulidoActivo) return;
    /* Con voz activa no se cambia el texto bajo la lectura: la cola suena lo
     * anterior y la guía lo sigue (textoFijado). El pulido entra al cambiar
     * de capítulo o al reiniciar, donde `textoDeParte` ya lo devuelve. */
    if (lecturaVozActiva()) return;
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
    estado.paginasFuente = resultado.paginas || [];
    estado.offsetDeAtomo = resultado.offsetDeAtomo || new Map();
    estado.fragmentosFuente = resultado.fragmentosFuente || resultado.atomosTodos || [];
    estado.transformaciones = resultado.transformaciones || [];
    estado.estructura = resultado.estructura || [];
    estado.calidadPorPagina = resultado.calidadPorPagina || [];
    estado.estadoFidelidad = resultado.estadoFidelidad || null;
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
    /* El id sale del nombre y el tamaño a propósito: volver a extraer el
     * mismo archivo actualiza el mismo registro y, si estaba borrado, lo
     * resucita. Un id aleatorio dejaría lápidas huérfanas en la nube. */
    const id = archivo
      ? `${(archivo.name || 'doc').toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40)}-${archivo.size || 0}`
      : `doc-${Date.now().toString(36)}`;

    /* La primera vez que se guarda algo, se pide al navegador que no lo borre. */
    const permiso = await almacen.pedirPersistencia();

    try {
      const huellaArchivo = archivo
        ? [...new Uint8Array(await crypto.subtle.digest('SHA-256', await archivo.arrayBuffer()))].map(b => b.toString(16).padStart(2, '0')).join('')
        : '';
      await almacen.guardarDocumento({
        meta: {
          ...(huellaArchivo ? { huella: huellaArchivo } : {}),
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
          estadoFidelidad: resultado.estadoFidelidad?.estado || 'pendiente_revision',
          paginasVerificadas: resultado.estadoFidelidad?.paginasVerificadas || [],
          versionFidelidad: resultado.estadoFidelidad ? 1 : 0,
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
    try { localStorage.setItem('jg_pdf_procesando', '1'); } catch (_) {}
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
      try { localStorage.removeItem('jg_pdf_procesando'); } catch (_) {}
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

      const resultado = componerTexto(paginas, { origen: 'ocr' });
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
    /* La guía sigue ESTE texto aunque el cuadro cambie después: la cola que
     * se genera abajo suena esto. También se olvida cualquier "leer desde
     * aquí" anterior: una lectura nueva del capítulo arranca desde el
     * principio, y anclarla con el desplazamiento viejo la corría entera. */
    guia.textoFijado = textoBruto;
    guia.desdeCaracter = -1;
    guia.saltar = true;
    guia.ultimoMarcadoVista = -1;
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

  async function exportarDocx() {
    try {
      const { construirDocx } = await import('./exportar.js');
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
  async function exportarDocxOriginal() {
    try {
      const { construirDocx } = await import('./exportar.js');
      descargar(nombreArchivo('original.docx'),
        construirDocx(estado.titulo || 'Documento (original)', partesParaExportarOriginal()),
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
      avisar('Documento original descargado.', 'ok');
    } catch (e) { avisar('No se pudo crear el original.', 'err'); }
  }

  async function exportarMarkdown() {
    try {
      const { construirMarkdown } = await import('./exportar.js');
      descargar(nombreArchivo('md'),
        construirMarkdown(estado.titulo || 'Documento', partesParaExportar({ usarAprobado: true })),
        'text/markdown;charset=utf-8');
      avisar('Markdown descargado (aprobado).', 'ok');
    } catch (e) { avisar('No se pudo crear el Markdown.', 'err'); }
  }

  async function exportarPdf() {
    try {
      const { construirHtmlImpresion } = await import('./exportar.js');
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
    } catch (e) { avisar('No se pudo crear la vista de impresión.', 'err'); }
  }

  /* ── Preguntar al documento ──────────────────────────────────────── */

  async function contextoPara(pregunta) {
    const completo = textoCompleto();
    if (completo.length <= LIMITE_CONTEXTO_IA) return completo;

    const bloques = [];
    for (let i = 0; i < completo.length; i += TAM_BLOQUE_BUSQUEDA) {
      bloques.push({ id: i, texto: completo.slice(i, i + TAM_BLOQUE_BUSQUEDA) });
    }
    const cuantos = Math.max(1, Math.floor(LIMITE_CONTEXTO_IA / TAM_BLOQUE_BUSQUEDA));
    const { construirIndice, buscarRelevantes } = await import('./busqueda.js');
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
      ? await contextoPara(textoPregunta)
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
    else abrirHoja('indice', document.activeElement?.id === 'btnPdfBmIndice' ? document.activeElement : el.btnIndice);
  });

  /* «Opciones» es un <details>. Se le quita el abrir/cerrar automático del
   * navegador (preventDefault sobre el <summary>) para que abrir y cerrar
   * pasen siempre por el mismo sitio: así el fondo, el foco y el paso en el
   * historial no se desincronizan nunca del estado real del panel. */
  if (el.btnMas && el.masMenu) {
    el.btnMas.addEventListener('click', (e) => {
      e.preventDefault();
      if (el.masMenu.open) cerrarHojas();
      else abrirHoja('opciones', document.activeElement?.id === 'btnPdfBmOpciones' ? document.activeElement : el.btnMas);
    });
  }

  /* Cerrar: el fondo, la ✕ de cada hoja y la tecla Escape. Tres caminos para
   * lo mismo porque cerrar no puede depender de adivinar dónde tocar. */
  if (el.hojaFondo) el.hojaFondo.addEventListener('click', () => cerrarHojas());
  /* En escritorio no hay fondo oscuro (el menú es un desplegable, no una
   * hoja), así que el «clic fuera» se detecta aquí: es lo que cualquiera
   * espera de un menú y evita que se quede abierto tapando el texto. */
  document.addEventListener('pointerdown', (e) => {
    if (innerWidth < 1024 || (!el.masMenu?.open && !herramientas?.open)) return;
    if (e.target.closest('#pdfMasMenu, #pdfHerramientasMenu')) return;
    if (e.target.closest('#pdfHojaFondo')) return;
    cerrarHojas();
  });
  el.resultArea.addEventListener('click', (e) => {
    const cerrar = e.target.closest('[data-cerrar-hoja]');
    if (cerrar) { e.preventDefault(); cerrarHojas(); }
  });
  el.masPanel?.addEventListener('click', e => {
    if (e.target.closest('#btnPdfComparar, #btnPdfRevision, #btnPdfShowText')) cerrarHojas();
  }, { capture: true });
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (el.compararHoja && !el.compararHoja.hidden) {
      e.preventDefault();
      cerrarComparacion();
      return;
    }
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
    if (abrir) el.buscar.focus({ preventScroll: true });
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

  /* «Ir al inicio del libro» vive en Contenido (PDF-04): solo navega a la
   * primera sección; no borra historial de lectura, decisiones ni
   * preferencias. Sigue disponible siempre, sin temporizador. */
  const btnIndiceInicio = $('btnPdfIndiceInicio');
  if (btnIndiceInicio) btnIndiceInicio.addEventListener('click', () => {
    if (!hayDocumento()) return;
    mostrarParte(0, { desplazamiento: 0 });
  });
  /* «Volver a la sección actual» (PDF-10): centra la lista en la sección
   * que se está leyendo y la enfoca, sin navegar ni cerrar el Contenido. */
  const btnIndiceActual = $('btnPdfIndiceActual');
  if (btnIndiceActual) btnIndiceActual.addEventListener('click', () => {
    const actual = el.indiceLista?.querySelector('[aria-current="true"]');
    if (!actual) return;
    const lista = el.indiceLista;
    lista.scrollTop += actual.getBoundingClientRect().top - lista.getBoundingClientRect().top
      - lista.clientHeight / 2 + actual.clientHeight / 2;
    try { actual.focus({ preventScroll: true }); } catch (_) {}
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

    /* Si ya hay voz sonando en este capítulo, se salta ahí al instante cuando
     * el bloque está situado de verdad; si el bloque se interpoló, el salto
     * instantáneo aproximaría y es mejor reiniciar exacto desde la frase. */
    const destino = bloqueDeCaracter(desde);
    if (destino && destino.firme && ttsSonandoAqui() && typeof window.ttsIrABloque === 'function') {
      guia.saltar = true;   /* salto pedido por la persona: puede ir hacia atrás */
      window.ttsIrABloque(destino.bloque, destino.dentro);
      avisar('Leyendo desde aquí.', 'info');
      return;
    }
    if (ttsSonandoAqui()) { leerDesdeCaracter(desde); return; }
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

  /* La voz puede estar sonando o cargando el siguiente bloque (entre
   * capítulos el estado pasa por `loading`/`buffering` sin dejar de ser la
   * misma lectura). Para cuidar la sincronía hay que contar todo ese rato. */
  function lecturaVozActiva() {
    try {
      if (deps.audiolibro && typeof deps.audiolibro.estaActivo === 'function'
        && deps.audiolibro.estaActivo()) return true;
    } catch (_) { /* sin adaptador no hay audiolibro */ }
    return ttsSonandoAqui();
  }

  /* El texto que la guía debe seguir: con voz activa es el que se mandó a
   * hablar (fijado al arrancar), no el del cuadro. El cuadro puede cambiar
   * después (llega el pulido, se edita) y la cola sigue sonando lo anterior:
   * re-anclar contra lo nuevo sería situar la voz en un texto que no lee. */
  function textoParaGuia() {
    if (lecturaVozActiva() && guia.textoFijado) return guia.textoFijado;
    return el.salida ? el.salida.value : '';
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
    texto: null, frases: [], palabras: [], tramos: [], desde: -1, hasta: -1, palabraDesde: -1, ultimoMarcadoVista: -1, cola: null, anclas: [], compacto: '', mapa: null,
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
    /* Texto visible que se mandó a hablar (fijado al arrancar la lectura).
     * La guía ancla contra él mientras la voz suena, aunque el cuadro cambie
     * después. Se renueva en cada arranque; con voz apagada no se usa. */
    textoFijado: null,
    /* Costo de habla acumulado por posición compacta (ver guiaAnclas.js):
     * convierte fracción de tiempo en posición y al revés, con pausas. */
    costosAcum: null,
    /* Qué anclas se situaron buscando de verdad (true) y cuáles se
     * interpolaron (false). Saltar a un bloque interpolado es aproximar:
     * en ese caso se reinicia exacto en vez de buscar por tiempo. */
    anclasFirmes: [],
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
  /** Idem: vive en guiaAnclas.js para poder probarse sin navegador. */
  function compactar(texto) {
    return compactarTexto(texto);
  }

  /** Idem: anclaje verificado (secuencial contiguo guiado por cursor) en guiaAnclas.js. */
  function situarBloques(textos) {
    const lista = (textos || []).map((bruto) => compactarTexto(String(bruto || '')).texto);
    let inicioCompacto = 0;
    if (guia.desdeCaracter > 0 && guia.mapa && guia.mapa.length) {
      const idx = guia.mapa.findIndex((pos) => pos >= guia.desdeCaracter);
      if (idx >= 0) inicioCompacto = idx;
    }
    guia.largosBloques = lista.map((b) => b.length);
    const detalle = situarBloquesDetallado(guia.compacto, lista, inicioCompacto);
    guia.anclasFirmes = detalle.firmes;
    return rellenarAnclas(detalle.anclas, guia.compacto.length, guia.largosBloques);
  }

  /** Punto del texto visible donde va la voz ahora mismo.
   *
   * El `dentroBloque` que manda el motor es fracción de TIEMPO, no de
   * letras: se convierte a posición con los costos de habla (las pausas
   * pesan), no con una regla de tres sobre las letras. */
  function posicionDeVoz(datos) {
    const anclas = guia.anclas;
    if (!anclas.length || !guia.mapa || !guia.mapa.length) return null;
    const i = Math.max(0, Math.min(anclas.length - 1, Number(datos.bloque) || 0));
    const inicio = anclas[i];
    const fin = i + 1 < anclas.length ? anclas[i + 1] : Math.min(guia.compacto.length, inicio + (guia.largosBloques?.[i] || 600));
    const dentro = Math.max(0, Math.min(1, Number(datos.dentroBloque) || 0));
    const enCompacto = (guia.costosAcum && guia.costosAcum.length)
      ? posicionPorTiempo(guia.costosAcum, inicio, fin, dentro)
      : Math.round(inicio + (fin - inicio) * dentro);
    const acotado = Math.max(0, Math.min(guia.mapa.length - 1, enCompacto));
    return guia.mapa[acotado];
  }

  /* Reconstruye el índice de la guía sobre un texto (frases, tramos,
   * compacto, mapa y costos). Es el único sitio que lo hace: así el mapa y
   * los costos nunca se desincronizan entre sí. */
  function reconstruirGuia(texto) {
    guia.texto = texto;
    guia.frases = partirEnFrases(texto);
    guia.palabras = partirEnPalabras(texto);
    guia.tramos = partirEnLineasLectura(texto);
    const compacto = compactar(texto);
    guia.compacto = compacto.texto;
    guia.mapa = compacto.mapa;
    try {
      guia.costosAcum = acumularCostos(construirCostos(texto, compacto.mapa));
    } catch (_) { guia.costosAcum = null; }
    guia.cola = null;
    guia.desde = -1;
    guia.hasta = -1;
    guia.palabraDesde = -1;
    guia.ultimoMarcadoVista = -1;
  }

  /**
   * Garantiza que el mapa y las anclas de la guía estén listos para hacer
   * búsquedas y saltos instantáneos (evita retrasos y recalcula perezosamente si la cola creció).
   */
  function asegurarGuiaSincronizada() {
    const texto = textoParaGuia();
    if (!texto) return;
    if (guia.texto !== texto || !guia.mapa || !guia.mapa.length) {
      reconstruirGuia(texto);
    }
    let textos = [];
    try { textos = (window.ttsTextosDeCola && window.ttsTextosDeCola()) || []; } catch (_) { textos = []; }
    if ((!guia.anclas || !guia.anclas.length || textos.length !== guia.bloques) && textos.length) {
      guia.cola = (window.ttsState && window.ttsState.queue) || guia.cola;
      guia.bloques = textos.length;
      guia.anclas = situarBloques(textos);
    }
  }

  /**
   * Camino inverso de `posicionDeVoz`: de un punto del texto al bloque de
   * audio que lo contiene.
   *
   * `guia.anclas` dice en qué carácter empieza cada bloque de la cola. Con eso
   * basta para saber a qué bloque saltar y en qué proporción de él caemos.
   * El `dentro` que devuelve es fracción de TIEMPO (lo que `ttsIrABloque`
   * espera: el motor razona en segundos), convertido con los costos de habla.
   * `firme` dice si ese bloque se situó buscando de verdad: si se interpoló,
   * el salto instantáneo aproximaría y es mejor reiniciar exacto.
   * Devuelve null si la guía todavía no está situada (no hay lectura en curso).
   */
  function bloqueDeCaracter(caracter) {
    asegurarGuiaSincronizada();
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
    const dentro = (guia.costosAcum && guia.costosAcum.length)
      ? tiempoPorPosicion(guia.costosAcum, inicio, fin, enCompacto)
      : (fin > inicio ? (enCompacto - inicio) / (fin - inicio) : 0);
    const firme = !guia.anclasFirmes || guia.anclasFirmes[i] !== false;
    return { bloque: i, dentro: Math.max(0, Math.min(1, dentro)), firme };
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

  /**
   * Trocea un texto en ventanas de lectura concentrada de unas 2 líneas (~80-130 caracteres).
   *
   * Respeta saltos de párrafo, signos de puntuación fuerte (. ? ! …) y cláusulas
   * intermedias (, ; : — – ) sin cortar palabras en medio, ofreciendo un campo visual
   * estable y confortable para el lector.
   */
  function partirEnLineasLectura(texto, { meta = 95, min = 55, max = 135 } = {}) {
    if (!texto) return [];
    const tramos = [];
    const largo = texto.length;
    let i = 0;

    while (i < largo) {
      while (i < largo && /\s/.test(texto[i])) i++;
      if (i >= largo) break;

      const inicio = i;
      const objetivo = Math.min(largo, inicio + meta);
      const limite = Math.min(largo, inicio + max);

      if (limite >= largo) {
        let fin = largo;
        while (fin > inicio && /\s/.test(texto[fin - 1])) fin--;
        if (fin > inicio) tramos.push([inicio, fin]);
        break;
      }

      const salto = texto.indexOf('\n', inicio);
      if (salto !== -1 && salto <= limite) {
        let fin = salto;
        while (fin > inicio && /\s/.test(texto[fin - 1])) fin--;
        if (fin > inicio) {
          tramos.push([inicio, fin]);
          i = salto + 1;
          continue;
        }
      }

      let mejorCorte = -1;
      const ventana = texto.slice(inicio, limite);

      const reFuerte = /[.!?…]+(?=[\s\n]|$)/g;
      let m;
      while ((m = reFuerte.exec(ventana)) !== null) {
        const idx = inicio + m.index + m[0].length;
        if (idx >= inicio + min && idx <= limite) {
          mejorCorte = idx;
        }
      }

      if (mejorCorte === -1) {
        const reMedia = /[,;:—–\)\]]+(?=[\s\n]|$)/g;
        while ((m = reMedia.exec(ventana)) !== null) {
          const idx = inicio + m.index + m[0].length;
          if (idx >= inicio + min && idx <= limite) {
            mejorCorte = idx;
          }
        }
      }

      if (mejorCorte === -1) {
        let uEspacio = -1;
        for (let k = limite; k >= inicio + min; k--) {
          if (/\s/.test(texto[k])) { uEspacio = k; break; }
        }
        if (uEspacio !== -1) {
          mejorCorte = uEspacio;
        } else {
          const pEspacio = texto.indexOf(' ', inicio + min);
          if (pEspacio !== -1 && pEspacio < inicio + max * 1.5) {
            mejorCorte = pEspacio;
          } else {
            mejorCorte = limite;
          }
        }
      }

      let fin = mejorCorte;
      while (fin > inicio && /\s/.test(texto[fin - 1])) fin--;
      if (fin > inicio) tramos.push([inicio, fin]);
      i = mejorCorte;
      while (i < largo && /\s/.test(texto[i])) i++;
    }
    return tramos.length ? tramos : [[0, largo]];
  }

  /** Tramo de lectura de ~2 líneas que contiene un punto del texto (búsqueda binaria). */
  function tramoEn(tramos, posicion) {
    if (!tramos || !tramos.length) return null;
    let bajo = 0;
    let alto = tramos.length - 1;
    while (bajo <= alto) {
      const medio = (bajo + alto) >> 1;
      const [ini, fin] = tramos[medio];
      if (posicion < ini) alto = medio - 1;
      else if (posicion >= fin) bajo = medio + 1;
      else return tramos[medio];
    }
    if (alto >= 0 && posicion >= tramos[alto][0] && (bajo >= tramos.length || posicion < tramos[bajo][0])) {
      return tramos[alto];
    }
    const idx = Math.max(0, Math.min(tramos.length - 1, bajo));
    return tramos[idx] || null;
  }

  /** Corta el texto en palabras respetando límites naturales y símbolos. */
  function partirEnPalabras(texto) {
    try {
      if (typeof Intl !== 'undefined' && Intl.Segmenter) {
        const seg = new Intl.Segmenter('es', { granularity: 'word' });
        const trozos = [];
        for (const s of seg.segment(texto)) {
          if (s.isWordLike) {
            trozos.push([s.index, s.index + s.segment.length]);
          }
        }
        if (trozos.length) return trozos;
      }
    } catch (_) {}
    const trozos = [];
    const re = /[\p{L}\p{N}]+/gu;
    let m;
    while ((m = re.exec(texto))) {
      trozos.push([m.index, m.index + m[0].length]);
    }
    return trozos;
  }

  /** Palabra que contiene un punto del texto o la más cercana anterior (búsqueda binaria). */
  function palabraEn(palabras, posicion) {
    if (!palabras || !palabras.length) return null;
    let bajo = 0;
    let alto = palabras.length - 1;
    while (bajo <= alto) {
      const medio = (bajo + alto) >> 1;
      const [ini, fin] = palabras[medio];
      if (posicion < ini) alto = medio - 1;
      else if (posicion >= fin) bajo = medio + 1;
      else return palabras[medio];
    }
    if (alto >= 0 && posicion >= palabras[alto][0] && (bajo >= palabras.length || posicion < palabras[bajo][0])) {
      return palabras[alto];
    }
    const idx = Math.max(0, Math.min(palabras.length - 1, bajo));
    return palabras[idx] || null;
  }

  function limpiarGuia() {
    guia.desde = -1;
    guia.hasta = -1;
    guia.palabraDesde = -1;
    guia.ultimoMarcadoVista = -1;
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
  document.addEventListener('jg-tts-cambio-voz', () => { guia.saltar = true; });

  /* Ventana de medición para pruebas: expone dónde cree la guía que va la
   * voz, sin tocar el DOM. Precedente: window.ttsTextosDeCola. */
  try {
    if (typeof window !== 'undefined' && !window.jgGuiaDebug) {
      window.jgGuiaDebug = () => ({
        desde: guia.desde,
        hasta: guia.hasta,
        bloques: guia.bloques,
        anclas: Array.isArray(guia.anclas) ? guia.anclas.slice() : [],
        textoLen: (guia.texto || '').length,
      });
    }
  } catch (_) { /* en pruebas sin ventana no existe */ }

  function sincronizarRealce() {
    if (el.realce) el.realce.scrollTop = el.salida.scrollTop;
  }

  function marcarFrase(datos) {
    if (!el.realce) return null;
    const texto = textoParaGuia();
    if (!texto) { limpiarGuia(); return null; }
    if (guia.texto !== texto) {
      reconstruirGuia(texto);
    }
    if (!guia.frases.length && !guia.tramos.length) return null;

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
    const rango = (guia.tramos && guia.tramos.length ? tramoEn(guia.tramos, punto) : null)
      || fraseEn(guia.frases, punto);
    if (!rango) return null;

    /* Si seguimos dentro de la misma ventana de ~2 líneas, no tocamos el DOM.
     * Mantiene una concentración visual relajada y sin parpadeos para el lector. */
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
    guia.hasta = rango[1];

    /* Se construye con nodos de texto, nunca con innerHTML: el contenido sale
     * de un PDF cualquiera y aquí no puede convertirse en marcado. */
    const marca = document.createElement('mark');
    marca.className = 'pdf-linea-guia pdf-frase-activa';
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
    const largo = textoParaGuia().length;
    const empezadaMasAbajo = guia.desdeCaracter >= 0;
    const parcial = !empezadaMasAbajo && datos.caracteres > 0 && largo > 0 && datos.caracteres < largo * 0.7;
    const marca = parcial ? null : marcarFrase(datos);
    if (parcial) { limpiarGuia(); return; }

    if (Date.now() - voz.pausaManual < ESPERA_TRAS_TOCAR_MS) return;

    /* En modo lectura se marca y se desplaza sobre el artículo visible; en
     * modo edición, sobre el textarea y su capa gemela, como siempre. */
    if (enModoLectura()) {
      if (libroVista && libroVista.marcarRango && guia.desde >= 0) {
        if (guia.desde !== guia.ultimoMarcadoVista) {
          const rango = (guia.tramos && guia.tramos.length ? tramoEn(guia.tramos, guia.desde) : null)
            || fraseEn(guia.frases, guia.desde);
          const pintada = rango
            ? libroVista.marcarRango(rango[0], rango[1])
            : null;
          if (pintada) {
            libroVista.desplazarA(pintada);
            guia.ultimoMarcadoVista = guia.desde;
          }
        }
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
    if (destino && destino.firme && typeof window.ttsIrABloque === 'function' && ttsSonandoAqui()) {
      window.ttsIrABloque(destino.bloque, destino.dentro);
      detalle.atendido = true;
      return;
    }
    if (ttsSonandoAqui() && typeof window.ttsHablar === 'function') {
      leerDesdeCaracter(caracter);
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

  /* ── Comparación fiel, página por página ─────────────────────────── */
  const comparacion = { doc: null, paginas: [], indice: 0, token: 0 };

  function paginasComparables() {
    const numeros = new Set();
    for (const p of estado.calidadPorPagina || []) if (Number(p.pagina) > 0) numeros.add(Number(p.pagina));
    for (const p of estado.paginasFuente || []) if (Number(p.numero) > 0) numeros.add(Number(p.numero));
    for (const a of estado.atomos || []) if (Number(a.page) > 0) numeros.add(Number(a.page));
    return [...numeros].sort((a, b) => a - b);
  }

  function actualizarEstadoFidelidad() {
    if (!el.fidelidadEstado) return;
    const dato = estado.estadoFidelidad;
    const tipo = dato?.estado || (estado.needsSource ? 'legacy_no_verificable' : 'sin_datos');
    const paginas = paginasComparables();
    const revisadas = new Set(dato?.paginasVerificadas || []);
    const textos = {
      verificado: `Verificado contra el PDF · ${revisadas.size} de ${paginas.length} páginas`,
      extraido_sin_alteraciones: 'Transcripción fiel · sin cambios editoriales automáticos',
      pendiente_revision: `Revisión pendiente · ${revisadas.size} de ${paginas.length} páginas comparadas`,
      inconsistente: 'Integridad inconsistente · vuelve a procesar el PDF',
      legacy_no_verificable: 'Texto anterior sin fuente verificable · vincula el PDF original',
      sin_datos: 'Fidelidad sin verificar',
    };
    el.fidelidadEstado.dataset.estado = tipo;
    el.fidelidadEstado.textContent = textos[tipo] || textos.sin_datos;
  }

  function textoFielDePagina(numero) {
    const atomos = (estado.atomos || []).filter((a) => Number(a.page) === Number(numero));
    if (!atomos.length) return '';
    const porPar = new Map((estado.limites || []).map((l) => [`${l.leftAtomId}|${l.rightAtomId}`, l]));
    const limites = [];
    for (let i = 0; i + 1 < atomos.length; i += 1) {
      limites.push(porPar.get(`${atomos[i].id}|${atomos[i + 1].id}`) || {
        id: `b:${atomos[i].id}~${atomos[i + 1].id}`,
        leftAtomId: atomos[i].id, rightAtomId: atomos[i + 1].id,
        decision: 'pending', source: 'missing', originalSeparator: '', quitarGuion: false,
      });
    }
    return componerAtomosFiel(atomos, limites).texto;
  }

  function dudasDePagina(numero) {
    const ids = new Set((estado.atomos || []).filter((a) => Number(a.page) === Number(numero)).map((a) => a.id));
    const dudas = [];
    for (const l of estado.limites || []) {
      if (l.decision === 'pending' && (ids.has(l.leftAtomId) || ids.has(l.rightAtomId))) {
        dudas.push(`Corte pendiente: «${l.leftFragment || ''}|${l.rightFragment || ''}»`);
      }
    }
    for (const o of estado.omisiones || []) {
      if (Number(o.pagina) === Number(numero)) dudas.push(`Excluido de la lectura (${o.motivo}): ${o.texto || '[fragmento vacío]'}`);
    }
    const calidad = (estado.calidadPorPagina || []).find((p) => Number(p.pagina) === Number(numero));
    if (calidad?.fallo) dudas.push('La extracción de esta página falló.');
    if (Number(calidad?.dudosos) > 0) dudas.push(`${calidad.dudosos} fragmento(s) OCR con confianza menor de 85 %.`);
    if (calidad?.fuente === 'ocr' && Number.isFinite(Number(calidad.confianza))) {
      dudas.push(`Confianza OCR media: ${Math.round(Number(calidad.confianza))} %.`);
    }
    return dudas;
  }

  async function cerrarComparacion({ devolverFoco = true } = {}) {
    const estabaAbierta = Boolean(el.compararHoja && !el.compararHoja.hidden);
    comparacion.token += 1;
    if (el.compararHoja) el.compararHoja.hidden = true;
    const doc = comparacion.doc;
    comparacion.doc = null;
    if (estabaAbierta && devolverFoco && el.compararBtn?.isConnected) {
      devolverFocoHoja(
        el.compararBtn,
        document.getElementById('btnPdfBmOpciones'),
        el.btnMas,
      );
    }
    try { await doc?.destroy(); } catch (_) {}
  }

  async function renderComparacion() {
    if (!comparacion.doc || !comparacion.paginas.length || !el.compararCanvas) return;
    const token = ++comparacion.token;
    const numero = comparacion.paginas[comparacion.indice];
    el.compararPagina.textContent = `Página ${numero} · ${comparacion.indice + 1} de ${comparacion.paginas.length}`;
    el.compararTexto.textContent = textoFielDePagina(numero) || '[Esta página no aportó texto a la lectura.]';
    const dudas = dudasDePagina(numero);
    el.compararDudas.replaceChildren();
    for (const duda of dudas.length ? dudas : ['Sin dudas automáticas registradas.']) {
      const li = document.createElement('li');
      li.textContent = duda;
      el.compararDudas.appendChild(li);
    }
    const revisadas = new Set(estado.estadoFidelidad?.paginasVerificadas || []);
    const revisada = revisadas.has(numero);
    el.compararVerificada.setAttribute('aria-pressed', revisada ? 'true' : 'false');
    el.compararVerificada.textContent = revisada ? 'Página revisada' : 'Marcar página revisada';
    el.compararPrev.disabled = comparacion.indice <= 0;
    el.compararNext.disabled = comparacion.indice >= comparacion.paginas.length - 1;

    let pagina = null;
    try {
      pagina = await comparacion.doc.getPage(numero);
      if (token !== comparacion.token) return;
      const base = pagina.getViewport({ scale: 1 });
      const caja = el.compararCanvas.parentElement;
      const anchoCss = Math.max(260, Math.min(680, (caja?.clientWidth || 680) - 24));
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const vista = pagina.getViewport({ scale: (anchoCss / Math.max(1, base.width)) * dpr });
      const canvas = el.compararCanvas;
      canvas.width = Math.round(vista.width);
      canvas.height = Math.round(vista.height);
      canvas.style.width = `${Math.round(vista.width / dpr)}px`;
      canvas.style.height = `${Math.round(vista.height / dpr)}px`;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      await pagina.render({ canvasContext: ctx, viewport: vista }).promise;
    } catch (error) {
      if (token === comparacion.token) avisar(`No se pudo mostrar la página ${numero}: ${error?.message || 'error desconocido'}`, 'err');
    } finally {
      try { pagina?.cleanup(); } catch (_) {}
    }
  }

  async function abrirComparacion() {
    if (!estado.id || !el.compararHoja) return;
    const archivo = await almacen.cargarArchivo(estado.id);
    if (!archivo) {
      avisar('Vincula el PDF original para compararlo con la transcripción.', 'warn');
      return;
    }
    await cerrarComparacion();
    try {
      const abierto = await abrirPdf(archivo);
      comparacion.doc = abierto.doc;
      comparacion.paginas = paginasComparables().filter((p) => p <= abierto.totalPaginas);
      if (!comparacion.paginas.length) comparacion.paginas = Array.from({ length: abierto.totalPaginas }, (_, i) => i + 1);
      const paginaLectura = Number(estado.partes?.[estado.parteActual]?.pagina || estado.paginasFuente?.[0]?.numero || comparacion.paginas[0]);
      comparacion.indice = Math.max(0, comparacion.paginas.indexOf(paginaLectura));
      el.compararHoja.hidden = false;
      await renderComparacion();
      el.compararCerrar?.focus({ preventScroll: true });
    } catch (error) {
      await cerrarComparacion();
      avisar(error instanceof ErrorPdf ? error.message : `No se pudo abrir el PDF original: ${error?.message || 'error desconocido'}`, 'err');
    }
  }

  async function alternarPaginaVerificada() {
    const numero = comparacion.paginas[comparacion.indice];
    if (!numero) return;
    const anterior = estado.estadoFidelidad || {
      estado: 'pendiente_revision', origen: 'texto', integridad: { valido: false }, paginasVerificadas: [], verificado: false,
    };
    const revisadas = new Set(anterior.paginasVerificadas || []);
    if (revisadas.has(numero)) revisadas.delete(numero); else revisadas.add(numero);
    const todas = comparacion.paginas.every((p) => revisadas.has(p));
    const valida = anterior.integridad?.valido === true;
    const sinPendientes = Number(estado.pendientesLimites) === 0;
    const verificado = todas && valida && sinPendientes;
    estado.estadoFidelidad = {
      ...anterior,
      estado: verificado ? 'verificado' : 'pendiente_revision',
      paginasVerificadas: [...revisadas].sort((a, b) => a - b),
      verificado,
      actualizado: Date.now(),
    };
    const guardado = await almacen.guardarEstadoFidelidad(estado.id, estado.estadoFidelidad);
    if (!guardado) {
      avisar('No se pudo guardar la revisión de esta página.', 'err');
      return;
    }
    actualizarEstadoFidelidad();
    await renderComparacion();
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

  function activarConDedoYTeclado(boton, accion) {
    if (!boton) return;
    let ultimoDedo = 0;
    boton.addEventListener('pointerup', (evento) => {
      if (evento.pointerType === 'mouse') return;
      ultimoDedo = performance.now();
      accion();
    });
    boton.addEventListener('click', () => {
      if (performance.now() - ultimoDedo < 650) return;
      accion();
    });
  }
  activarConDedoYTeclado(el.compararBtn, abrirComparacion);
  activarConDedoYTeclado(el.compararCerrar, cerrarComparacion);
  activarConDedoYTeclado(el.compararPrev, () => {
    if (comparacion.indice <= 0) return;
    comparacion.indice -= 1;
    renderComparacion();
  });
  activarConDedoYTeclado(el.compararNext, () => {
    if (comparacion.indice >= comparacion.paginas.length - 1) return;
    comparacion.indice += 1;
    renderComparacion();
  });
  activarConDedoYTeclado(el.compararVerificada, alternarPaginaVerificada);

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
      if (img) {
        img.alt = 'Código para escanear con la cámara del celular';
        img.style.maxWidth = '100%';
        img.style.height = 'auto';
        img.style.display = 'block';
      }
      el.nubeQr.hidden = false;
    } catch (error) {
      /* Sin QR se puede seguir: los seis dígitos hacen el mismo trabajo. */
      console.warn('[jg-sync] no se pudo dibujar el código', error);
      el.nubeQr.innerHTML = `<a href="${enlace}" target="_blank" style="font-size:12px;color:var(--cyan);word-break:break-all;padding:8px;display:block;">Abrir enlace de vinculación</a>`;
      el.nubeQr.hidden = false;
    }
  }

  /**
   * El botón único: enciende la sincronización (si hace falta) y muestra el
   * pase para el otro aparato de inmediato (código de 6 dígitos + QR).
   * La subida de libros ocurre en segundo plano para no demorar el código.
   */
  async function mostrarPase() {
    if (!nube) return;
    /* La nube va plegada para no estorbar: al pedir el pase se despliega,
     * porque el código QR vive dentro. */
    if (el.nube && el.nube.tagName === 'DETAILS') el.nube.open = true;
    try {
      await conBotonOcupado(el.nubeConectar, el.nubeConectarLabel, 'Preparando…', async () => {
        let pase = null;
        try {
          if (!nube.estaVinculada()) {
            const datos = await nube.activar();
            if (el.nubeLlaveTexto) el.nubeLlaveTexto.textContent = datos.llave;
          }
          pase = await nube.pedirCodigo();
        } catch (err) {
          // Auto-healing si la llave previa en localStorage ya no es válida en Supabase (401)
          const msg = String(err?.message || '').toLowerCase();
          if (msg.includes('llave') || msg.includes('401') || msg.includes('vincular') || msg.includes('autoriz')) {
            console.warn('[jg-sync] Llave previa rechazada o inválida, recreando biblioteca...', err);
            nube.desconectar();
            const datos = await nube.activar();
            if (el.nubeLlaveTexto) el.nubeLlaveTexto.textContent = datos.llave;
            pase = await nube.pedirCodigo();
          } else {
            throw err;
          }
        }

        const codigo = String(pase?.codigo || '');
        if (!codigo) throw new Error('No se pudo generar el código de emparejamiento.');

        el.nubeDigitos.textContent = codigo.replace(/(\d{3})(\d{3})/, '$1 $2');
        enlaceDelPase = `${location.origin}/?tab=pdf&unir=${codigo}`;
        el.nubePase.hidden = false;
        el.nubeQr.hidden = false;
        el.nubeCompartir.hidden = !navigator.share;

        // Renderizar el código QR de inmediato (sin esperar a que suban libros)
        await pintarQr(enlaceDelPase);

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

        // La subida de libros ocurre en segundo plano con avisos en vivo,
        // sin bloquear la aparición instantánea del código de 6 dígitos ni del QR
        sincronizarAhora({ silencioso: false }).catch((e) => {
          console.warn('[jg-sync] Sincronización en segundo plano tras pedir pase:', e);
        });
      });
      await pintarNube();
      avisoNube('');
    } catch (error) {
      console.error('[jg-sync] Error al mostrar pase:', error);
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
    sincronizandoAhora = true;
    try {
      const resultado = await conBotonOcupado(boton, etiqueta, 'Actualizando…',
        () => nube.sincronizar({
          alProgresar: (mensaje) => {
            if (silencioso) return;
            avisoNube(mensaje);
            if (desdeCabecera) avisar(mensaje, 'info');
          },
        }));
      sincronizandoAhora = false;
      limpiarFalloSync();
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
      /* Pedidos de reenvío: se anuncian donde está la persona, con la acción
       * al lado (en la ficha ⋯ del libro). */
      const pedidos = Array.isArray(resultado.pedidos) ? resultado.pedidos : [];
      if (pedidos.length && !silencioso) {
        const primero = pedidos[0];
        const mas = pedidos.length > 1 ? ` (+${pedidos.length - 1} más)` : '';
        const avisoPedido = `${primero.de} pide «${primero.titulo}» completo${mas}. Abre su ficha ⋯ y pulsa Reenviar.`;
        avisoNube(`${mensaje} ${avisoPedido}`, 'ok');
        avisar(avisoPedido, 'info');
      }
      await pintarBiblioteca();
      anunciarSync(mensaje);
      return resultado;
    } catch (error) {
      sincronizandoAhora = false;
      marcarFalloSync();
      const fallo = error?.message || 'No se pudo sincronizar.';
      if (!silencioso) {
        avisoNube(fallo, 'error');
        if (desdeCabecera) avisar(fallo, 'err');
      }
      el.nubePunto.dataset.estado = 'error';
      try { await pintarBiblioteca(); } catch (_) {}
      anunciarSync('No se pudo sincronizar. Revisa tu conexión e inténtalo de nuevo.');
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
  if (el.nubeTraerCopia) el.nubeTraerCopia.addEventListener('click', () => {
    if (el.nubeArchivoCopia) el.nubeArchivoCopia.click();
    else avisoNube('Actualiza la app para traer copias de archivo.', 'error');
  });
  if (el.nubeArchivoCopia) el.nubeArchivoCopia.addEventListener('change', async (e) => {
    const archivo = e.target?.files?.[0] || null;
    e.target.value = '';
    await importarCopiaArchivo(archivo);
  });
  if (el.nubeSalir) el.nubeSalir.addEventListener('click', () => {
    nube.desconectar();
    cerrarPase();
    el.nubeOpciones.hidden = true;
    pintarNube();
    avisoNube('Este aparato dejó de sincronizar. Tus libros siguen aquí.', 'ok');
  });

  pintarNube();

  /* Divisor del Contenido lateral: una sola vez (el panel es estático). */
  try { montarDivisorIndice(); } catch (_) { /* sin divisor se vive igual */ }

  /* Si se llegó escaneando el código (…/?unir=123456), se conecta solo: la
   * persona no tiene que escribir nada ni entender qué es un código. */
  (async () => {
    try {
      const parametros = new URLSearchParams(location.search);
      const codigo = (parametros.get('unir') || '').replace(/\D/g, '');
      if (codigo.length === 6 && nube) {
        /* Se llega por el QR del otro aparato: la caja de la nube va plegada
         * y aquí los avisos tienen que verse. */
        if (el.nube && el.nube.tagName === 'DETAILS') el.nube.open = true;
        avisar('Vinculando con tu otro aparato…', 'info');
        const exito = await unirDispositivo(codigo);
        if (exito) {
          avisar('✓ ¡Aparato emparejado! Tus libros ya están disponibles.', 'ok', { efimero: true });
        }
        const limpia = new URL(location.href);
        limpia.searchParams.delete('unir');
        history.replaceState({}, '', limpia.pathname + limpia.search + limpia.hash);
      } else if (nube && nube.estaVinculada()) {
        sincronizarAhora({ silencioso: true });
      }
    } catch (e) {
      console.warn('[jg-sync] Error al procesar enlace ?unir:', e);
    }
  })();

  // Vista de libro v2.39 (lectura HTML, apariencia, cortes, biblioteca).
  async function prepararFuenteCorreccion() {
    if (estado.atomos?.length) return;
    const docId = estado.id;
    const archivo = await almacen.cargarArchivo(docId);
    if (!archivo) {
      /* Sin el archivo aquí hay dos caminos de verdad, no uno: resolver donde
       * está el PDF, o traerlo (vincularlo a mano o importarlo con Compartir
       * con PDF). El mensaje los nombra para no dejar a la persona sin salida. */
      if ((estado.limites || []).length) {
        avisar('Los cortes de este libro se resuelven donde está su PDF original. O desde ese aparato: ficha ⋯ → Compartir con PDF. Vincular el PDF desde Opciones también sirve.', 'warn');
      } else {
        avisar('Para revisar palabras partidas, vincula el PDF original desde Opciones.', 'warn');
      }
      return;
    }
    mostrarPulidoEstado('Preparando los cortes del PDF…', '');
    const resultado = await procesarPdf(archivo, { conPortada: false });
    if (estado.id !== docId) return;
    estado.atomos = resultado.atomos || [];
    estado.limites = resultado.limites || [];
    estado.offsetDeAtomo = resultado.offsetDeAtomo || new Map();
    estado.paginasFuente = resultado.paginas || [];
    estado.fragmentosFuente = resultado.fragmentosFuente || resultado.atomosTodos || [];
    estado.transformaciones = resultado.transformaciones || [];
    estado.estructura = resultado.estructura || [];
    estado.calidadPorPagina = resultado.calidadPorPagina || [];
    estado.estadoFidelidad = resultado.estadoFidelidad || null;
    libroVista?.renderLectura({ conservar: true });
  }

  async function reconstruirTrasDecision({ duranteCorreccion = false } = {}) {
    if (!estado.atomos?.length) {
      throw new Error((estado.limites || []).length
        ? 'Sin el PDF original en este aparato no se puede aplicar. Resuélvelo donde está el PDF o tráelo con Compartir con PDF.'
        : 'Falta la geometría del PDF original.');
    }
    const docId = estado.id;
    const atomosFuente = estado.fragmentosFuente?.length ? estado.fragmentosFuente : estado.atomos;
    const resultado = reconstruirDesdeAtomos(atomosFuente, {
      paginas: estado.paginasFuente || [], lang: estado.idioma,
      origen: estado.estadoFidelidad?.origen || 'texto',
      limitesPrevios: estado.limites,
      ancho: estado.paginasFuente?.[0]?.ancho || 595,
      alto: estado.paginasFuente?.[0]?.alto || 842,
    });
    if (!invarianteLetras(resultado.atomos, resultado.texto, resultado.limites)
        || resultado.estadoFidelidad?.integridad?.valido === false) {
      throw new Error('No se pudo conservar el texto del PDF.');
    }
    const capitulos = prepararCapitulosLectura(resultado.texto, resultado.capitulos);
    const frescas = partirTexto(resultado.texto, capitulos, resultado.paginas, [], {
      bloques: resultado.bloquesLectura, limites: resultado.limites,
      atomos: resultado.atomos, offsetDeAtomo: resultado.offsetDeAtomo,
    });
    /* Una edición manual aprobada NO tumba nada: se conserva sobre el texto
     * recompuesto, igual que al finalizar la corrección. Antes esto lanzaba
     * error, y con una sola edición hecha a mano morían Unir, la etapa 1 y
     * Reanudar quedaba eterno. La edición manda sobre lo automático en su
     * capítulo; el resto se recompone normal.
     * Matiz honesto: las posiciones de cortes tras un capítulo editado son
     * aproximadas (el texto aprobado mide distinto), solo afecta a «llevar
     * al corte exacto», no a leer, buscar ni escuchar. */
    const partes = frescas.map((p, i) => {
      const bloqueId = estado.bloques?.[i]?.id || ('cap_' + i);
      const aprobada = estado.textoAprobadoPorBloque.get(bloqueId) ?? estado.textoAprobadoPorBloque.get('cap_' + i);
      if (aprobada && String(aprobada).trim()) return { ...p, texto: String(aprobada) };
      return p;
    });
    let off = 0;
    for (const p of partes) {
      p.desde = off;
      off += String(p.texto || '').length;
      p.hasta = off;
    }
    const textoLectura = componerLibroDesdePartes(partes);
    const progreso = reubicarProgreso(estado.progreso, estado.partes, partes);
    const guardado = await almacen.marcarTroceo(docId, VERSION_TROCEO, {
      partes, capitulos, progreso, versionReconstruccion: VERSION_RECONSTRUCCION,
      reconstruccion: serializarReconstruccion(resultado), pendientesLimites: resultado.pendientes,
    });
    if (guardado === false) throw new Error('No se pudo guardar el corte en este dispositivo.');
    if (estado.id !== docId) return;
    estado.partes = partes;
    estado.localTexto = textoLectura;
    estado.limites = resultado.limites;
    estado.offsetDeAtomo = resultado.offsetDeAtomo;
    estado.pendientesLimites = resultado.pendientes;
    estado.atomos = resultado.atomos || [];
    estado.fragmentosFuente = resultado.fragmentosFuente || resultado.atomosTodos || [];
    estado.transformaciones = resultado.transformaciones || [];
    estado.estructura = resultado.estructura || [];
    estado.calidadPorPagina = resultado.calidadPorPagina || [];
    estado.estadoFidelidad = resultado.estadoFidelidad || null;
    estado.omisiones = resultado.omisiones || [];
    estado.progreso = progreso;
    estado.pulido.clear();
    estado.colaCorreccion = crearColaDesdePartes(partes, {
      cortar: mejorCorteCanonico, documentId: docId, stage: 'puntuacion',
    });
    await almacen.guardarColaCorreccion(docId, serializarCola(estado.colaCorreccion));
    pintarIndice();
    await mostrarParte(Math.min(progreso.parte || 0, partes.length - 1));
    actualizarEstadoFidelidad();
    if (!duranteCorreccion) actualizarEstadoCorreccion();
  }

  let libroVista = null;
  try {
    libroVista = initLibroVista({
      el,
      estado,
      api: {
        textoDeParte: (i) => textoDeParte(i),
        /* Para el pie de lectura del teléfono: «restantes ~12 min». Ya se
         * calculaba aquí; solo faltaba dejárselo ver a la vista. */
        minutosRestantes: () => { try { return minutosRestantes(); } catch (_) { return ''; } },
        /* PDF-03: el pie muestra el % del LIBRO, no el de las páginas
         * visibles de la sección. */
        porcentajeLibro: () => { try { return calcularPorcentaje(estado.progreso, estado.partes); } catch (_) { return null; } },
        guardarEdicion: (forzar) => { if (forzar) guardarEdicionActual(); },
        avisar,
        pausar: () => { try { pausarCorreccionLibro(); } catch (_) {} },
        repintarBiblioteca: () => { try { pintarBiblioteca(); } catch (_) {} },
        mostrarMasBiblioteca: () => { estado.biblioLimite = (estado.biblioLimite || 40) + 40; try { pintarBiblioteca(); } catch (_) {} },
        reconstruirTrasDecision,
        anotarPagina: (caracter) => anotarPosicion({ caracter }),
        verRecorte: (lim) => { try { verRecortePagina(lim); } catch (_) {} },
        vincularArchivo: async (archivo) => { await vincularPdfOriginal(archivo); },
        leerDesdeCaracter: (caracter) => { try { leerDesdeCaracter(caracter); } catch (_) {} },
        onCambioPaginaUsuario: (caracter) => {
          try {
            if (ttsSonandoAqui()) {
              leerDesdeCaracter(caracter, { forzarNuevo: false });
            }
          } catch (_) {}
        },
        actualizarFondoHojas: () => { try { pintarFondoHojas(); } catch (_) {} },
        abrirHoja,
        cerrarHoja: () => cerrarHojas(),
      },
    });
  } catch (_) { libroVista = null; }

  function iniciarMusicaFondoUI() {
    try {
      musicaFondo.inicializar();
    } catch (err) {
      console.warn('[pdfController] Error inicializando musicaFondo:', err);
    }

    el.btnMusica?.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (el.musicaHoja && !el.musicaHoja.hidden) {
        cerrarHojas();
      } else {
        abrirHoja('musica', el.btnMusica);
      }
    });

    const listaPistas = $('pdfMusicaPistasLista');
    const badge = $('pdfMusicaEstadoBadge');
    const autoCheck = $('pdfMusicaAuto');
    const aleatCheck = $('pdfMusicaAleatoria');
    const duckingCheck = $('pdfMusicaDucking');
    const volMusica = $('pdfMusicaVolMusica');
    const valMusica = $('pdfMusicaValMusica');
    const volVoz = $('pdfMusicaVolVoz');
    const valVoz = $('pdfMusicaValVoz');

    function pintarPistas(animo, pistaId) {
      if (!listaPistas) return;
      const pistas = CATALOGO_PISTAS.filter((p) => p.animo === animo);
      listaPistas.innerHTML = pistas.map((p) => {
        const activa = p.id === pistaId;
        return `<button type="button" class="pdf-musica-pista-item ${activa ? 'is-active' : ''}" data-pista="${p.id}" role="radio" aria-checked="${activa ? 'true' : 'false'}">
          <div class="pdf-musica-pista-info">
            <span class="pdf-musica-pista-nombre">${p.nombre}</span>
            <span class="pdf-musica-pista-desc">${p.desc}</span>
          </div>
          <div class="pdf-musica-pista-meta">
            <span class="pdf-musica-pista-dur">${p.duracion}</span>
            <svg class="pdf-musica-pista-icono" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              ${activa ? '<polygon points="5 3 19 12 5 21 5 3"/>' : '<circle cx="12" cy="12" r="3"/>'}
            </svg>
          </div>
        </button>`;
      }).join('');

      listaPistas.querySelectorAll('[data-pista]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const id = btn.getAttribute('data-pista');
          musicaFondo.setPista(id);
        });
      });
    }

    const animoBtns = document.querySelectorAll('.pdf-musica-animo-btn');
    animoBtns.forEach((btn) => {
      btn.addEventListener('click', () => {
        const animo = btn.getAttribute('data-animo');
        if (animo === 'apagado') {
          musicaFondo.setActiva(false);
        } else {
          musicaFondo.setAnimo(animo);
        }
      });
    });

    autoCheck?.addEventListener('change', () => {
      musicaFondo.setAutomatica(autoCheck.checked);
    });

    aleatCheck?.addEventListener('change', () => {
      musicaFondo.setAleatoria(aleatCheck.checked);
    });

    duckingCheck?.addEventListener('change', () => {
      musicaFondo.setDucking(duckingCheck.checked);
    });

    volMusica?.addEventListener('input', () => {
      const v = parseFloat(volMusica.value);
      if (valMusica) valMusica.textContent = `${Math.round(v * 100)}%`;
      musicaFondo.setVolumenMusica(v);
    });

    volVoz?.addEventListener('input', () => {
      const v = parseFloat(volVoz.value);
      if (valVoz) valVoz.textContent = `${Math.round(v * 100)}%`;
      musicaFondo.setVolumenVoz(v);
    });

    musicaFondo.suscribir((st) => {
      if (el.btnMusica) {
        el.btnMusica.classList.toggle('is-playing', st.estado === 'sonando');
        el.btnMusica.classList.toggle('is-loading', st.estado === 'cargando');
        el.btnMusica.classList.toggle('is-off', !st.activa || st.estado === 'apagado');
        const estadoTxt = !st.activa ? 'Apagado' : (st.estado === 'sonando' ? 'Sonando' : (st.estado === 'cargando' ? 'Cargando…' : 'En pausa'));
        if (badge) badge.textContent = estadoTxt;
        el.btnMusica.setAttribute('aria-label', `Música de fondo: ${estadoTxt.toLowerCase()}`);
      }

      animoBtns.forEach((btn) => {
        const a = btn.getAttribute('data-animo');
        if (a === 'apagado') {
          btn.classList.toggle('is-active', !st.activa);
        } else {
          btn.classList.toggle('is-active', st.activa && st.animo === a);
        }
      });

      if (autoCheck) autoCheck.checked = st.automatica;
      if (aleatCheck) aleatCheck.checked = st.aleatoria;
      if (duckingCheck) duckingCheck.checked = st.duckingActivo;
      if (volMusica) volMusica.value = String(st.volumenMusica);
      if (valMusica) valMusica.textContent = `${Math.round(st.volumenMusica * 100)}%`;
      if (volVoz) volVoz.value = String(st.volumenVoz);
      if (valVoz) valVoz.textContent = `${Math.round(st.volumenVoz * 100)}%`;

      pintarPistas(st.animo, st.pistaId);
    });

    document.addEventListener('jg-tts-pausar', () => {
      musicaFondo.pausarLectura();
    });
    document.addEventListener('jg-tts-reanudar', () => {
      musicaFondo.reanudarLectura();
    });
    document.addEventListener('jg-tts-detener', () => {
      musicaFondo.detener({ inmediato: false });
    });

    musicaFondo.notificarCambio();
  }

  iniciarMusicaFondoUI();

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
      const doc = await almacen.cargarDocumento(estado.id);
      const original = await almacen.cargarArchivo(estado.id);
      const huellaOriginal = original
        ? [...new Uint8Array(await crypto.subtle.digest('SHA-256', await original.arrayBuffer()))].map(b => b.toString(16).padStart(2, '0')).join('')
        : doc?.huella;
      if (!huellaOriginal) {
        avisar('Este libro no conserva la huella del archivo. Vuelve a importar el PDF para reconstruir sus cortes.', 'warn');
        return;
      }
      if (hex !== huellaOriginal) {
        avisar('Ese PDF no corresponde a este documento.', 'warn');
        return;
      }
      await almacen.guardarArchivo(estado.id, archivo);
      await almacen.guardarHuella(estado.id, hex);
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
  function leerDesdeCaracter(caracter, { forzarNuevo = false } = {}) {
    if (!hayDocumento()) return;
    const texto = el.salida.value || '';
    if (!texto) return;
    const frases = partirEnFrases(texto);
    const punto = Math.max(0, Math.min(texto.length - 1, Math.floor(Number(caracter) || 0)));
    const rango = frases.length ? fraseEn(frases, punto) : null;
    const desde = rango ? rango[0] : punto;

    anotarPosicion({ caracter: desde });
    guia.saltar = true;               /* salto pedido por la persona */
    guia.ultimoMarcadoVista = -1;

    const usaNavegador = typeof window !== 'undefined' && window.ttsState?.engineUsed === 'browser';
    const destino = (forzarNuevo || usaNavegador) ? null : bloqueDeCaracter(desde);
    if (destino && destino.firme && ttsSonandoAqui() && typeof window.ttsIrABloque === 'function') {
      window.ttsIrABloque(destino.bloque, destino.dentro);
      /* Iluminar de inmediato la ventana de lectura en la vista libro para fluidez instantánea */
      if (enModoLectura() && libroVista && typeof libroVista.marcarRango === 'function') {
        const tramo = (guia.tramos && guia.tramos.length ? tramoEn(guia.tramos, desde) : null)
          || (guia.frases && guia.frases.length ? fraseEn(guia.frases, desde) : null)
          || [desde, Math.min(texto.length, desde + 80)];
        if (tramo) {
          guia.desde = tramo[0];
          guia.hasta = tramo[1];
          guia.ultimoMarcadoVista = tramo[0];
          libroVista.marcarRango(tramo[0], tramo[1]);
        }
      }
      avisar('Leyendo desde aquí.', 'info', { efimero: true });
      return;
    }
    guia.desdeCaracter = desde;
    /* La guía sigue este texto aunque el cuadro cambie después (pulido que
     * llega, edición): la cola nueva suena esto, no lo que haya luego. */
    guia.textoFijado = texto;
    try { el.salida.setSelectionRange(desde, texto.length); } catch (_) { /* textarea oculto */ }
    precargarSiguienteCapitulo();

    if (typeof window.ttsHablar === 'function') {
      const trozo = texto.slice(desde);
      window.ttsHablar(trozo, { sourceId: 'pdf', langHint: 'es' });
      avisar('Leyendo desde aquí.', 'info', { efimero: true });
      return;
    }

    const boton = document.querySelector('[data-tts-console="pdf"] [data-tts-action="toggle"]');
    if (ttsSonandoAqui()) {
      const parar = document.querySelector('[data-tts-console="pdf"] [data-tts-action="stop"]');
      if (parar) parar.click();
      setTimeout(() => { if (boton) boton.click(); }, 60);
    } else {
      if (boton) boton.click();
      else avisar('Pulsa Escuchar para leer desde aquí.', 'info', { efimero: true });
    }
  }

  function precargarSiguienteCapitulo() {
    let cfg = {};
    try {
      if (libroVista && typeof libroVista.obtenerConfig === 'function') {
        cfg = libroVista.obtenerConfig();
      } else {
        cfg = JSON.parse(localStorage.getItem('jg_pdf_lectura') || '{}');
      }
    } catch (_) {}
    if (cfg.modoPagina !== 'scroll') return;

    const siguienteIndice = estado.parteActual + 1;
    if (estado.partes && estado.partes[siguienteIndice] && typeof window.ttsFetchNeuralChunk === 'function') {
      try {
        const proximoBruto = textoDeParte(siguienteIndice) || estado.partes[siguienteIndice]?.texto || '';
        if (proximoBruto.trim()) {
          const langPrefetch = estado.vista === 'es' ? 'es' : idiomaActual();
          const textoPrefetch = prepararParaVoz(proximoBruto, langPrefetch);
          const primerChunk = textoPrefetch.slice(0, 500);
          if (primerChunk.length > 40) {
            setTimeout(() => {
              try {
                const prefs = typeof ttsPrefs === 'function' ? ttsPrefs() : { preferFish: false };
                const prefsPdf = { ...prefs, preferFish: false, fishId: '' };
                const probe = typeof ttsCrearCola === 'function' ? ttsCrearCola(primerChunk, langPrefetch, 500, prefsPdf.bilingualMode || 'regional') : [];
                if (probe && probe[0] && typeof window.ttsFetchNeuralChunk === 'function') {
                  window.ttsFetchNeuralChunk(probe[0], prefsPdf, 1, 'pdf').catch(()=>{});
                }
              } catch (_) {}
            }, 1500);
          }
        }
      } catch (_) {}
    }
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
      if (ttsSonandoAqui()) {
        const punto = (opts && opts.seleccionar && opts.seleccionar.desde) != null
          ? opts.seleccionar.desde
          : (caracterVisible() || 0);
        leerDesdeCaracter(punto, { forzarNuevo: true });
      }
    } catch (_) {}
    return r;
  };

  /* ── Lectura continua de corrido entre capítulos en modo scroll («Desplazando hacia abajo») ──
   * Cuando termina la narración de voz de un capítulo y el usuario tiene configurado
   * el modo scroll, la lectura continúa fluidamente al siguiente capítulo desde el inicio
   * hasta completar el libro (a menos que el usuario pause o detenga la lectura).
   * En modo "Pasando páginas", no avanza solo (se mantiene el comportamiento original).
   */
  window.jgPdfContinuarLectura = function () {
    if (!hayDocumento() || !enModoLectura()) return false;
    let cfg = {};
    try {
      if (libroVista && typeof libroVista.obtenerConfig === 'function') {
        cfg = libroVista.obtenerConfig();
      } else {
        cfg = JSON.parse(localStorage.getItem('jg_pdf_lectura') || '{}');
      }
    } catch (_) {}
    if (cfg.modoPagina !== 'scroll') return false;

    const capaDe = (i) => (
      estado.textoAprobadoPorBloque.get(`cap_${i}`)
      || estado.textoSeguroPorBloque.get(`cap_${i}`)
      || textoDeParte(i) || ''
    ).trim();

    let idx = estado.parteActual + 1;
    while (idx < estado.partes.length && !capaDe(idx)) idx += 1;
    if (idx >= estado.partes.length) {
      avisar('Terminó la lectura del documento.', 'ok');
      return false;
    }

    mostrarParte(idx).then(() => {
      setTimeout(() => {
        leerDesdeCaracter(0, { forzarNuevo: true });
      }, 60);
    });
    return true;
  };

  refrescarInicio();

  /* Fase A · Continuidad tras recarga / F5 */
  try {
    if (localStorage.getItem('jg_pdf_procesando') === '1') {
      localStorage.removeItem('jg_pdf_procesando');
      avisar('La carga anterior no terminó. Puedes volver a elegir el documento.', 'info');
    }
    const params = new URLSearchParams(window.location.search);
    const vistaGuardada = localStorage.getItem('jg_pdf_vista_activa');
    const docIdGuardado = localStorage.getItem('jg_pdf_doc_abierto');
    if (vistaGuardada === 'lector' && docIdGuardado && params.get('tab') === 'pdf') {
      abrirDocumento(docIdGuardado).catch((err) => {
        console.warn('[jg-pdf] No se pudo restaurar documento en curso:', err);
      });
    }
  } catch (_) {}

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
