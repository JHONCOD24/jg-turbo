/**
 * Doblaje de YouTube al español: orquesta reproductor, texto, traducción y voz.
 *
 * Flujo (auditoría 2026-09-25): el reproductor primero (se ve el video y da título y
 * duración gratis) → texto en el idioma original → regla de idioma → preparación por
 * ventanas alrededor de lo que se ve → voz encendida por defecto. Una sola sesión viva;
 * «Cancelar» y «Cerrar» la detienen entera.
 */
import { TranscriptionService, ErrorYoutube } from './transcriptionService.js';
import { detectarFuente } from './fuenteVideo.js';
import { ServicioX, tituloX } from './servicioX.js';
import { ServicioArchivo } from './servicioArchivo.js';
import { validarArchivo, huellaArchivo, resumenAntesDeEmpezar, esClaveArchivo } from './archivoLocal.js';
import { leerTextoSubtitulo, segmentosDesdeSubtitulos } from './subtitulosArchivo.js';
import { elegirMp4 } from './audioX.js';
import { XVideoPlayer } from './XVideoPlayer.js';
import { TranslationService } from './translationService.js';
import { YouTubePlayer } from './YouTubePlayer.js';
import { SyncEngine, normalizarTasa } from './syncEngine.js';
import { TranscriptionDisplay } from './TranscriptionDisplay.js';
import { DubbingService, agruparPorTiempo, prepararTextoDeUnidad } from './dubbingService.js';
import { DubbingEngine } from './dubbingEngine.js';
import { MotorPreparacion } from './motorPreparacion.js';
import { crearLimitador } from './limitador.js';
import { VOZ_INICIAL_S } from './planificador.js';
import { decidirDoblaje, nombreIdioma, codigoCorto, IDIOMAS_DOBLABLES } from './idiomaOrigen.js';
import {
  leerDoblaje, guardarDoblaje, registrarVideo, leerVoz, guardarVoz, podarVoces, pedirPersistencia,
  listarVideos, listarDoblajes, videosConVoz, actualizarVideo, quitarVideo, restaurarVideo, espacioYPersistencia,
} from './cacheDoblaje.js';
import { claveDeVoz } from './bibliotecaVideos.js';
import { medirHabla } from './hablaVoz.js';
import { estimarBytesMp3, estimarBytesVideo, opcionesCalidadX, nombreArchivo, BITRATE_AUDIO_DOBLADO, formatearBytes } from './descargaDestino.js';
import { crearDestino } from './destinoArchivo.js';
import {
  hayDialogo, elegirVocesAutomaticas, vozParaUnidad, generoDeVoz,
} from './vocesDoblaje.js';

const CLAVE_VOL_VOZ = 'jg_yt_vol_voz';
const CLAVE_VOL_ORIGINAL = 'jg_yt_vol_original';
const CLAVE_TASA = 'jg_yt_rate';
const CLAVE_RITMO_AUTO = 'jg_yt_ritmo_auto';
const ESPERA_REPRODUCTOR_MS = 8000;
// El texto del video ya no espera al reproductor: si en este tiempo da título y
// duración, viajan como pista; si no, el servidor los saca de la Data API.
const ESPERA_PISTAS_MS = 1200;
// 0,01 s de silencio: «desbloquea» el audio en Safari/iOS dentro del primer toque.
const SILENCIO_WAV = 'data:audio/wav;base64,UklGRnQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YVAAAACAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgA==';

function leer(clave) {
  try { return localStorage.getItem(clave); } catch (_) { return null; }
}
function guardar(clave, valor) {
  try { localStorage.setItem(clave, valor); } catch (_) { /* modo privado: no se recuerda */ }
}
function leerNumero(clave, porDefecto) {
  // `Number(null)` es 0: sin comprobar la ausencia, la primera visita arrancaba en silencio.
  const crudo = leer(clave);
  if (crudo === null || crudo === '') return porDefecto;
  const numero = Number(crudo);
  return Number.isFinite(numero) && numero >= 0 ? numero : porDefecto;
}
const formatoTiempo = (s) => (s < 60 ? `${Math.floor(s)} s` : `${Math.floor(s / 60)} min ${String(Math.floor(s % 60)).padStart(2, '0')} s`);
const cancelado = () => new DOMException('Cancelado', 'AbortError');

export function inicializarYoutubeSincronizado({
  fetchApi,
  traducirTexto,
  generarAudioEspanol,
  generarAudioArchivo = null,
  estaServidorOnline,
  listarVoces = () => [],
  vozPorDefecto = () => 'neural:auto:female',
  esIOS = false,
}) {
  const $ = (id) => document.getElementById(id);
  const ui = {
    boton: $('ytSyncBtn'), url: $('ytUrl'), idioma: $('ytLang'), area: $('ytSyncArea'), titulo: $('ytSyncTitle'),
    estado: $('ytSyncStatus'), cerrar: $('btnYtSyncClose'), ritmoAuto: $('ytRitmoAuto'),
    botonVoz: $('ytDubbingBtn'), etiquetaVoz: $('ytDubbingLabel'), insignia: $('ytLangBadge'),
    caption: $('ytCaption'), toggleCaption: $('ytToggleCaption'),
    elegir: $('ytLangConfirm'), elegirTexto: $('ytLangConfirmText'), elegirSelect: $('ytIdiomaElegido'),
    elegirSi: $('ytLangConfirmYes'), elegirNo: $('ytLangConfirmNo'),
    volVoz: $('ytVolVoz'), volVozVal: $('ytVolVozVal'), volOriginal: $('ytVolOriginal'), volOriginalVal: $('ytVolOriginalVal'),
      metricas: $('ytSyncMetrics'), reproducir: $('ytDubReproducir'), buffer: $('ytBuffer'),
      voz: $('ytVozSelect'), voz2: $('ytVoz2Select'), voz2Wrap: $('ytVoz2Wrap'),
      otraVoz: $('ytOtraVoz'),
    tarjeta: $('ytDubProgreso'), barra: $('ytDubBarra'), mensaje: $('ytDubMensaje'), tiempo: $('ytDubTiempo'),
    ayuda: $('ytDubAyuda'), cancelar: $('ytDubCancelar'),
    archivo: $('ytArchivo'), elegirArchivo: $('ytElegirArchivo'), ficha: $('ytFichaArchivo'),
    fichaNombre: $('ytFichaNombre'), fichaDatos: $('ytFichaDatos'), fichaQuitar: $('ytFichaQuitar'),
    avisoEquipo: $('ytEquipoAviso'),
    srt: $('ytSrt'), elegirSubtitulo: $('ytElegirSubtitulo'), subtitulo: $('ytSubtitulo'),
    srtFicha: $('ytSrtFicha'), srtNombre: $('ytSrtNombre'), srtDatos: $('ytSrtDatos'), srtQuitar: $('ytSrtQuitar'),
  };
  const display = new TranscriptionDisplay($('ytSyncDisplay'), ui.caption);
  const transcripciones = new TranscriptionService({ fetchApi });
  const servicioX = new ServicioX({ fetchApi });
  const servicioArchivo = new ServicioArchivo({ fetchApi });
  // Video del equipo elegido en el formulario (uno a la vez) y el último que se abrió:
  // el MP4 doblado necesita el archivo original y la app no lo copia.
  let archivoElegido = null;
  let ultimoArchivo = null;   // { clave, archivo }
  // Ritmo de Mistral gratis (≈1 petición/s) para TODA llamada del traductor:
  // lotes, mitades de un lote partido y el texto completo.
  const traductor = new TranslationService({ traducirTexto, intervaloMinMs: 1100 });
  // Doble audio alternado (sin micro-cortes entre frases): los dos se crean y
  // desbloquean dentro del primer toque (iOS solo deja desbloquear en gesto).
  const audioDoblaje = new Audio();
  const audioDoblaje2 = new Audio();
  let audiosEntregados = 0;
  let sesion = null;
  // Biblioteca (bibliotecaVista.js): se monta sola si existe #vidBiblioteca.
  let biblioteca = null;
  let abrirEnPendiente = 0;
  let vocesDesdePoda = 0;
  const avisarBiblioteca = () => { Promise.resolve(biblioteca?.refrescar?.()).catch(() => {}); };
  /** La voz guardada tiene tope (300 MB): se revisa cada 50 frases nuevas, no en cada una. */
  const contarVozGuardada = (guardada) => {
    if (!guardada) return;
    vocesDesdePoda += 1;
    if (vocesDesdePoda >= 50) { vocesDesdePoda = 0; podarVoces(); }
  };

  // ── Volúmenes y subtítulo (se recuerdan) ────────────────────────────────
  ui.volVoz.value = String(leerNumero(CLAVE_VOL_VOZ, 100));
  ui.volOriginal.value = String(leerNumero(CLAVE_VOL_ORIGINAL, 12));
  const pintarVolumenes = () => {
    ui.volVozVal.textContent = `${ui.volVoz.value} %`;
    ui.volOriginalVal.textContent = `${ui.volOriginal.value} %`;
  };
  pintarVolumenes();
  ui.volVoz.addEventListener('input', () => {
    pintarVolumenes();
    guardar(CLAVE_VOL_VOZ, ui.volVoz.value);
    sesion?.motorVoz?.definirVolumenVoz(Number(ui.volVoz.value) / 100);
  });
  ui.volOriginal.addEventListener('input', () => {
    pintarVolumenes();
    guardar(CLAVE_VOL_ORIGINAL, ui.volOriginal.value);
    sesion?.motorVoz?.definirVolumenFondo(Number(ui.volOriginal.value));
  });
    ui.toggleCaption.checked = leer('jg_yt_subtitulos') === '1';
    ui.caption.hidden = !ui.toggleCaption.checked;
    ui.toggleCaption.addEventListener('change', () => {
      ui.caption.hidden = !ui.toggleCaption.checked;
      guardar('jg_yt_subtitulos', ui.toggleCaption.checked ? '1' : '0');
    });

    // Tamaño del subtítulo (Pequeño = el de siempre). Mediano por defecto: el
    // dueño notó el texto pequeño. Solo cambia el tamaño de letra.
    const tamano = $('ytTamanoSubtitulo');
    const TAMANOS = ['pequeno', 'mediano', 'grande'];
    const aplicarTamano = (valor) => {
      const elegido = TAMANOS.includes(valor) ? valor : 'mediano';
      ui.caption.dataset.tamano = elegido;
      if (tamano) tamano.value = elegido;
      return elegido;
    };
    aplicarTamano(leer('jg_yt_subtitulo_tamano'));
    tamano?.addEventListener('change', () => guardar('jg_yt_subtitulo_tamano', aplicarTamano(tamano.value)));

    // ── Ritmo automático (encendido por defecto, se recuerda) ──────────────
    // Frena el video lo justo cuando el español necesita más tiempo que el
    // inglés, para que la voz diga todo sin saltarse líneas. Apagado, la voz
    // se pone al día en las pausas y el video va a la velocidad de la persona.
    const ritmoAutomatico = () => !ui.ritmoAuto || ui.ritmoAuto.checked;
    if (ui.ritmoAuto) {
      ui.ritmoAuto.checked = leer(CLAVE_RITMO_AUTO) !== '0';
      ui.ritmoAuto.addEventListener('change', () => {
        guardar(CLAVE_RITMO_AUTO, ui.ritmoAuto.checked ? '1' : '0');
        sesion?.motorVoz?.definirRitmoAutomatico(ui.ritmoAuto.checked);
      });
    }

    // ── Voz del doblaje (propia; la voz global no se toca) ─────────────────
    // «Automática (según el video)» = neural rápida del género detectado (o del
    // global si no hay pistas). Si el video trae diálogo (>>), aparece la 2.ª
    // voz para el otro hablante. Fish sigue a mano: tarda 6-8 s en preparar
    // cada tramo (medido 2026-09-26) aunque hable rápido, de ahí su etiqueta.
    const CLAVE_VOZ = 'jg_yt_voz';
    const CLAVE_VOZ2 = 'jg_yt_voz2';
    const VALOR_AUTO = 'auto';
    // 2.ª voz «Ninguna»: todo el video con la voz principal, aunque sea un diálogo.
    const VALOR_SIN_SEGUNDA = 'ninguna';
    function llenarSelectorVoz(select, conAuto) {
      const grupos = new Map();
      for (const item of listarVoces()) {
        const etiqueta = String(item.value || '').startsWith('fish:') ? `${item.label} (tarda más en cargar)` : item.label;
        if (!grupos.has(item.group)) grupos.set(item.group, document.createElement('optgroup'));
        grupos.get(item.group).label = item.group;
        const opcion = document.createElement('option');
        opcion.value = item.value;
        opcion.textContent = etiqueta;
        grupos.get(item.group).appendChild(opcion);
      }
      select.replaceChildren(...grupos.values());
      if (conAuto) {
        const auto = document.createElement('option');
        auto.value = VALOR_AUTO;
        auto.textContent = 'Automática (según el video)';
        select.prepend(auto);
      }
    }
    function vozValida(select, valor) {
      return [...select.options].some((o) => o.value === valor);
    }
    /** Voces efectivas de la sesión (resuelve «auto» una vez por video). */
    function resolverVocesSesion(actual) {
      const catalogo = listarVoces();
      const elegida = ui.voz?.value || VALOR_AUTO;
      if (elegida === VALOR_AUTO) {
        const auto = elegirVocesAutomaticas({
          textosOriginales: (actual.segmentos || []).map((s) => s.text),
          vozGlobal: vozPorDefecto(),
          catalogo,
        });
        actual.voz = auto.principal;
        actual.vozSecundaria = auto.secundaria;
        // En automático también manda la 2.ª voz que la persona eligió a mano.
        const segunda = ui.voz2?.value;
        if (segunda && segunda !== VALOR_SIN_SEGUNDA && vozValida(ui.voz2, segunda) && leer(CLAVE_VOZ2)) actual.vozSecundaria = segunda;
      } else {
        actual.voz = elegida;
        const genero = generoDeVoz(elegida);
        const contraria = catalogo.find((v) => String(v.value).startsWith('neural:') && generoDeVoz(v.value) !== genero);
        const segunda = ui.voz2?.value;
        actual.vozSecundaria = (segunda && vozValida(ui.voz2, segunda))
          ? segunda
          : (contraria ? contraria.value : `neural:auto:${genero === 'male' ? 'female' : 'male'}`);
      }
      if (ui.voz2?.value === VALOR_SIN_SEGUNDA) actual.vozSecundaria = null;
      // La 2.ª voz solo se ofrece cuando el video trae diálogo.
      const dialogo = hayDialogo(actual.segmentos || []);
      if (ui.voz2Wrap) ui.voz2Wrap.hidden = !dialogo;
      return dialogo;
    }
    function vozNuevaDesde(select, clave) {
      guardar(clave, select.value);
      if (!sesion) return;
      sesion.otroHablante = false;
      pintarOtraVoz();
      resolverVocesSesion(sesion);
      if (sesion.registro) registrarVideo({ clave: sesion.videoId, voz: sesion.voz || '', vozSecundaria: sesion.vozSecundaria || 'ninguna' });
      // La voz nueva entra desde la próxima frase, sin cortar la actual.
      if (sesion?.servicioVoz) sesion.servicioVoz.invalidarDesde((sesion.player?.getCurrentTime?.() || 0) + 1);
    }
    if (ui.voz) {
      llenarSelectorVoz(ui.voz, true);
      const recordada = leer(CLAVE_VOZ);
      ui.voz.value = (recordada && vozValida(ui.voz, recordada)) ? recordada : VALOR_AUTO;
      ui.voz.addEventListener('change', () => vozNuevaDesde(ui.voz, CLAVE_VOZ));
    }
    if (ui.voz2) {
      llenarSelectorVoz(ui.voz2, false);
      ui.voz2.prepend(new Option('Ninguna: una sola voz para todo', VALOR_SIN_SEGUNDA));
      const recordada2 = leer(CLAVE_VOZ2);
      ui.voz2.value = (recordada2 && vozValida(ui.voz2, recordada2)) ? recordada2 : vozPorDefecto();
      ui.voz2.addEventListener('change', () => vozNuevaDesde(ui.voz2, CLAVE_VOZ2));
    }
    // Videos del equipo sin diálogo: lo transcrito no dice quién habla, así que
    // la 2.ª voz no entra sola. La persona toca cuando cambia quien habla y desde
    // ahí suena la otra voz, hasta que lo vuelve a tocar (estilo pódcast).
    function pintarOtraVoz() {
      if (!ui.otraVoz) return;
      ui.otraVoz.setAttribute('aria-pressed', String(Boolean(sesion?.otroHablante)));
      ui.otraVoz.textContent = sesion?.otroHablante ? 'Volver a la primera voz' : 'Aquí habla otra persona';
    }
    ui.otraVoz?.addEventListener('click', () => {
      const viva = sesion;
      if (!viva || !viva.servicioVoz) return;
      if (!viva.vozSecundaria) {
        viva.vozSecundaria = `neural:auto:${generoDeVoz(viva.voz) === 'male' ? 'female' : 'male'}`;
      }
      const ahora = Number(viva.player?.getCurrentTime?.()) || 0;
      const anterior = viva.voz;
      viva.voz = viva.vozSecundaria;
      viva.vozSecundaria = anterior;
      viva.otroHablante = !viva.otroHablante;
      viva.servicioVoz.invalidarDesde(ahora + 1);
      if (viva.registro) registrarVideo({ clave: viva.videoId, voz: viva.voz || '', vozSecundaria: viva.vozSecundaria || 'ninguna' });
      pintarOtraVoz();
      ui.estado.textContent = viva.otroHablante
        ? 'Desde aquí habla la otra voz. Tócalo de nuevo cuando vuelva la primera.'
        : 'De nuevo la primera voz.';
    });

  async function alternarPantallaCompleta() {
    const shell = ui.area.querySelector('.yt-player-shell');
    const boton = $('ytPantallaCompleta');
    if (document.fullscreenElement) { await document.exitFullscreen().catch(() => {}); return; }
    if (shell.classList.contains('yt-pantalla-completa')) {
      shell.classList.remove('yt-pantalla-completa');
      boton.setAttribute('aria-pressed', 'false');
      return;
    }
    if (shell.requestFullscreen) {
      try { await shell.requestFullscreen({ navigationUI: 'hide' }); return; } catch (_) { /* iPhone: sin pantalla completa de elementos */ }
    }
    shell.classList.add('yt-pantalla-completa');   // respaldo: ocupa toda la ventana
    boton.setAttribute('aria-pressed', 'true');
  }
  $('ytPantallaCompleta').addEventListener('click', alternarPantallaCompleta);
  $('ytSalirPantalla').addEventListener('click', alternarPantallaCompleta);
  document.addEventListener('fullscreenchange', () => $('ytPantallaCompleta').setAttribute('aria-pressed', document.fullscreenElement ? 'true' : 'false'));
  if (esIOS) {
    // Safari no deja fijar el volumen desde código: el original se silencia y se explica.
    ui.volVoz.closest('.yt-mixer-fila').hidden = true;
    ui.volOriginal.closest('.yt-mixer-fila').hidden = true;
    $('ytNotaIOS').hidden = false;
  }

  $('ytTextoCompleto').addEventListener('click', async () => {
    const actual = sesion;
    if (!actual?.motor || actual.textoEnCurso) return;
    actual.textoEnCurso = true;
    const boton = $('ytTextoCompleto');
    const aviso = $('ytTextoProgreso');
    boton.disabled = true;
    try {
      const mapa = await traductor.traducirTodo(actual.segmentos, {
        origen: actual.origen, tituloVideo: actual.tituloVideo, signal: actual.controlador.signal,
        ya: actual.motor.traducciones,
        onProgress: (hechos, total) => { aviso.textContent = total ? `Traduciendo el texto completo: ${hechos} de ${total} partes…` : ''; },
      });
      for (const [indice, texto] of mapa) actual.motor.traducciones.set(indice, texto);
      const texto = actual.segmentos.map((s, i) => mapa.get(i) ?? s.text).join(' ').replace(/\s+/g, ' ').trim();
      const salida = $('ytOutput');
      salida.value = texto;
      salida.dispatchEvent(new Event('input'));
      $('ytCount').textContent = `${texto.split(/\s+/).filter(Boolean).length} palabras · traducción fiel`;
      document.querySelector('.yt-area')?.classList.add('con-texto');
      aviso.textContent = 'Listo: el texto completo está abajo.';
      $('ytResultArea').scrollIntoView({ block: 'start', behavior: 'smooth' });
    } catch (error) {
      if (!actual.controlador.signal.aborted) aviso.textContent = `No se pudo terminar el texto: ${error?.message || error}`;
    } finally {
      actual.textoEnCurso = false;
      boton.disabled = false;
    }
  });

  // ── Progreso visible (TRAMPAS §8.1) ─────────────────────────────────────
  const progreso = {
    cronometro: null,
    iniciar() {
      const inicio = Date.now();
      delete ui.tarjeta.dataset.estado;
      ui.tarjeta.hidden = false;
      ui.cancelar.textContent = 'Cancelar';
      ui.tiempo.textContent = '0 s';
      ui.ayuda.textContent = 'Mientras tanto puedes darle play: el video suena en su idioma y la voz en español entra sola cuando esté lista.';
      clearInterval(this.cronometro);
      this.cronometro = setInterval(() => { ui.tiempo.textContent = formatoTiempo((Date.now() - inicio) / 1000); }, 1000);
      this.paso('leer', 'Leyendo el video…');
      this.barra(null);
    },
    paso(nombre, mensaje) {
      let despues = false;
      for (const li of ui.tarjeta.querySelectorAll('[data-paso]')) {
        if (li.dataset.paso === nombre) { li.dataset.estado = 'activo'; despues = true; }
        else li.dataset.estado = despues ? 'espera' : 'hecho';
      }
      if (mensaje) ui.mensaje.textContent = mensaje;
    },
    barra(fraccion) {
      ui.barra.classList.toggle('es-indeterminada', fraccion === null);
      ui.barra.style.width = fraccion === null ? '' : `${Math.round(Math.max(0, Math.min(1, fraccion)) * 100)}%`;
    },
    mensaje(texto) { ui.mensaje.textContent = texto; },
    ayuda(texto) { ui.ayuda.textContent = texto; },
    terminar() { clearInterval(this.cronometro); this.cronometro = null; ui.tarjeta.hidden = true; },
    error(texto) {
      clearInterval(this.cronometro);
      this.cronometro = null;
      ui.tarjeta.hidden = false;
      ui.tarjeta.dataset.estado = 'error';
      this.barra(0);
      ui.mensaje.textContent = texto;
      ui.cancelar.textContent = 'Volver';
    },
  };

  // ── Botón principal: ocupado mientras trabaja (auditoría H7) ────────────
  const estaOcupado = () => ui.boton.dataset.ocupado === '1';
  function actualizarBoton() {
    ui.boton.disabled = estaOcupado() || !(archivoElegido || detectarFuente(ui.url.value)) || !estaServidorOnline();
  }
  function marcarOcupado(activo) {
    if (activo) ui.boton.dataset.ocupado = '1';
    else delete ui.boton.dataset.ocupado;
    ui.boton.setAttribute('aria-busy', activo ? 'true' : 'false');
    actualizarBoton();
  }
  ui.url.addEventListener('input', actualizarBoton);
  window.addEventListener('jg:server-status', actualizarBoton);
  actualizarBoton();

  // Un enlace de X no sirve para «Solo el texto» (ese camino es de YouTube): se explica, no se esconde.
  const notaUrl = $('ytUrlNota');
  const pintarNotaUrl = () => {
    if (!notaUrl) return;
    notaUrl.hidden = detectarFuente(ui.url.value)?.plataforma !== 'x';
  };
  ui.url.addEventListener('input', pintarNotaUrl);
  pintarNotaUrl();

  // ── Video del equipo: elegir, arrastrar, quitar ─────────────────────────
  const ACEPTA_VIDEO = 'video/*,.mp4,.m4v,.mov,.mkv,.webm';
  const avisarEquipo = (texto) => { if (ui.avisoEquipo) ui.avisoEquipo.textContent = texto || ''; };
  function quitarArchivo() {
    archivoElegido = null;
    quitarSubtitulo();
    if (ui.ficha) ui.ficha.hidden = true;
    if (ui.srt) ui.srt.hidden = true;
    if (ui.archivo) ui.archivo.value = '';
    actualizarBoton();
  }
  /** Pone el archivo en el formulario (no empieza: el idioma y «Doblar» siguen siendo de la persona). */
  function ponerArchivo(archivo) {
    const valido = validarArchivo(archivo);
    if (!valido.ok) { avisarEquipo(valido.motivo); quitarArchivo(); return false; }
    avisarEquipo('');
    archivoElegido = archivo;
    if (ui.url.value) { ui.url.value = ''; pintarNotaUrl(); }
    if (ui.ficha) {
      ui.fichaNombre.textContent = archivo.name || 'Video de tu equipo';   // nombre ajeno: textContent, nunca innerHTML
      ui.fichaDatos.textContent = `${formatearBytes(archivo.size)} · listo para doblar`;
      ui.ficha.hidden = false;
    }
    quitarSubtitulo();
    if (ui.srt) ui.srt.hidden = false;
    actualizarBoton();
    return true;
  }
  // ── Subtítulos del usuario (.srt/.vtt, opcional) ──────────────────────
  // Si los trae, el doblaje usa ese texto exacto sin transcribir (gratis).
  // Se validan al elegirlos: un error se dice aquí y el video sigue (por Whisper).
  let subtituloElegido = null;   // { archivo, segmentos, formato }
  function quitarSubtitulo() {
    subtituloElegido = null;
    if (ui.srtFicha) ui.srtFicha.hidden = true;
    if (ui.subtitulo) ui.subtitulo.value = '';
    if (ui.srt) ui.srt.hidden = !archivoElegido;
  }
  async function ponerSubtitulo(archivo) {
    if (!archivoElegido) { avisarEquipo('Elige primero el video y luego sus subtítulos.'); return false; }
    try {
      const texto = await leerTextoSubtitulo(archivo);
      const { segmentos, formato } = segmentosDesdeSubtitulos(texto, archivo.name);
      subtituloElegido = { archivo, segmentos, formato };
      avisarEquipo('');
      if (ui.srtFicha) {
        ui.srtNombre.textContent = archivo.name || 'Subtítulos';   // nombre ajeno: textContent, nunca innerHTML
        ui.srtDatos.textContent = `${segmentos.length} frases · se usan tal cual, sin transcribir`;
        ui.srtFicha.hidden = false;
      }
      if (ui.srt) ui.srt.hidden = true;
      actualizarBoton();
      return true;
    } catch (error) {
      avisarEquipo(error?.message || 'No pudimos leer esos subtítulos.');
      quitarSubtitulo();
      return false;
    }
  }
  /** Un selector de archivo para un solo uso, abierto DENTRO del gesto que lo pide. */
  function pedirArchivo() {
    return new Promise((resolver) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = ACEPTA_VIDEO;
      input.hidden = true;
      document.body.append(input);
      const terminar = (archivo) => { input.remove(); resolver(archivo || null); };
      input.addEventListener('change', () => terminar(input.files?.[0]), { once: true });
      input.addEventListener('cancel', () => terminar(null), { once: true });
      input.click();
    });
  }
  ui.elegirArchivo?.addEventListener('click', () => ui.archivo.click());
  ui.archivo?.addEventListener('change', () => { if (ui.archivo.files?.[0]) ponerArchivo(ui.archivo.files[0]); });
  ui.fichaQuitar?.addEventListener('click', () => { quitarArchivo(); ui.elegirArchivo?.focus(); });
  ui.elegirSubtitulo?.addEventListener('click', () => ui.subtitulo.click());
  ui.subtitulo?.addEventListener('change', () => {
    if (ui.subtitulo.files?.[0]) ponerSubtitulo(ui.subtitulo.files[0]).catch(() => avisarEquipo('No pudimos leer esos subtítulos.'));
  });
  ui.srtQuitar?.addEventListener('click', () => { quitarSubtitulo(); ui.elegirSubtitulo?.focus(); });
  ui.url.addEventListener('input', () => { if (ui.url.value.trim() && archivoElegido) quitarArchivo(); });
  // Escritorio: soltar el video sobre el panel.
  const zona = document.querySelector('.yt-area');
  if (zona) {
    const conArchivos = (e) => [...(e.dataTransfer?.types || [])].includes('Files');
    zona.addEventListener('dragover', (e) => { if (!conArchivos(e)) return; e.preventDefault(); zona.classList.add('yt-soltando'); });
    zona.addEventListener('dragleave', (e) => { if (!zona.contains(e.relatedTarget)) zona.classList.remove('yt-soltando'); });
    zona.addEventListener('drop', (e) => {
      if (!conArchivos(e)) return;
      e.preventDefault();
      zona.classList.remove('yt-soltando');
      const archivo = e.dataTransfer.files?.[0];
      if (archivo && !estaOcupado()) ponerArchivo(archivo);
    });
  }
  // La pestaña Archivo (y lo compartido desde el celular) entrega aquí un video.
  window.jgVideoLocal = { elegir: (archivo) => ponerArchivo(archivo) };

  // ── Vista ───────────────────────────────────────────────────────────────
  const mostrarIdioma = (texto, tipo) => { ui.insignia.textContent = texto; ui.insignia.dataset.estado = tipo; };
  function ponerEstadoBotonVoz(activo) {
    ui.botonVoz.setAttribute('aria-pressed', activo ? 'true' : 'false');
    ui.etiquetaVoz.textContent = activo ? 'Volver al audio original' : 'Escuchar en español';
  }
  function recrearDestino() {
    const contenedor = ui.area.querySelector('.yt-player-shell');
    contenedor.querySelector('#ytPlayer')?.remove();
    const destino = document.createElement('div');
    destino.id = 'ytPlayer';
    contenedor.prepend(destino);
  }
  function reiniciarVista() {
    ui.botonVoz.disabled = true;
    if (ui.voz2Wrap) ui.voz2Wrap.hidden = true;
    if (ui.otraVoz) ui.otraVoz.hidden = true;
    $('ytDesdeInicio').hidden = true;
    ponerEstadoBotonVoz(false);
    ui.etiquetaVoz.textContent = 'Voz en español';
    ui.elegir.hidden = true;
    ui.metricas.hidden = true;
    ui.reproducir.hidden = true;
    ui.buffer.textContent = '';
    ui.estado.textContent = '';
    ui.caption.textContent = '';
    ui.titulo.textContent = 'Video doblado al español';
    mostrarIdioma('Idioma del video: por confirmar', 'analizando');
    display.definirSegmentos([], () => null);
    display.mostrarVoz('cargando');
    progreso.terminar();
  }

  /** Guarda traducciones y posición en la caché del video (H23) y el avance en la biblioteca. */
  function guardarSesion(actual) {
    if (!actual?.registro) return;
    actual.registro.traducciones = [...(actual.motor?.traducciones || [])];
    const posicion = actual.player?.getCurrentTime?.() || 0;
    if (posicion > 0) actual.registro.posicionS = posicion;
    guardarDoblaje(actual.registro);
    if (posicion > 0) registrarVideo({ clave: actual.videoId, posicionS: posicion, duracionS: actual.registro.duracionS });
  }

  /** Detiene TODO lo de la sesión (H7) y, si se pide, devuelve el formulario (H8). */
  function terminarSesion({ restaurarFormulario = true } = {}) {
    const actual = sesion;
    sesion = null;
    if (actual) {
      if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
      const shell = ui.area.querySelector('.yt-player-shell');
      shell?.classList.remove('yt-pantalla-completa');
      $('ytPantallaCompleta')?.setAttribute('aria-pressed', 'false');
      $('ytTextoProgreso').textContent = '';
      clearTimeout(actual.temporizadorCache);
      clearInterval(actual.relojCache);
      guardarSesion(actual);
      actual.controlador.abort();
      actual.motor?.detener();
      actual.motorVoz?.destruir();
      actual.servicioVoz?.liberar();
      actual.sync?.destruir();
      actual.player?.destruir();
      actual.cerrarArchivo?.();
      if (actual.urlArchivo) URL.revokeObjectURL(actual.urlArchivo);
    }
    marcarOcupado(false);
    reiniciarVista();
    if (restaurarFormulario) {
      biblioteca?.plegar?.(false);
      if (actual) avisarBiblioteca();   // el avance y «Listo al instante» cambian al cerrar
      ui.area.hidden = true;
      document.querySelector('.yt-area')?.classList.remove('has-results', 'modo-doblaje', 'con-texto');
      ui.url.focus({ preventScroll: true });
    }
  }
  ui.cerrar.addEventListener('click', () => terminarSesion());
  ui.cancelar.addEventListener('click', () => terminarSesion());
  $('ytDesdeInicio').addEventListener('click', () => {
    if (sesion) sesion.retomarEn = 0;
    $('ytDesdeInicio').hidden = true;
  });

  ui.botonVoz.addEventListener('click', () => {
    const motorVoz = sesion?.motorVoz;
    if (!motorVoz || ui.botonVoz.disabled) return;
    if (motorVoz.activo) {
      motorVoz.desactivar();
      ponerEstadoBotonVoz(false);
      display.mostrarVoz('inactivo');
      return;
    }
    motorVoz.activar();
    ponerEstadoBotonVoz(true);
    display.mostrarVoz('activo');
  });
  ui.reproducir.addEventListener('click', () => {
    const motorVoz = sesion?.motorVoz;
    if (!motorVoz) return;
    if (sesion.retomarEn) {
      sesion.player.seekTo(sesion.retomarEn);   // el salto va con el clic: antes, la API lo pone a reproducir sola
      sesion.retomarEn = 0;
      $('ytDesdeInicio').hidden = true;
    }
    motorVoz.activarYReproducir();
    ponerEstadoBotonVoz(true);
    display.mostrarVoz('activo');
    ui.reproducir.hidden = true;
  });

  /** Ante la duda se ofrece elegir el idioma; nunca un rechazo a ciegas (H2, H6). */
  function pedirPermisoIA(datos, signal) {
    const creditos = Number(datos?.estimated_credits) || 0;
    const minutos = Math.ceil((Number(datos?.duration_s) || 0) / 60);
    const texto = creditos
      ? `Este video no tiene subtítulos. Para doblarlo hay que transcribirlo con IA: gasta unos ${creditos} créditos de Supadata (${minutos} min × 2). El plan gratuito trae 100 al mes.`
      : 'Este video no tiene subtítulos. Para doblarlo hay que transcribirlo con IA: gasta 2 créditos de Supadata por minuto de video.';
    return new Promise((resolver) => {
      $('ytIaTexto').textContent = texto;
      const caja = $('ytIaConsentimiento');
      caja.hidden = false;
      $('ytIaSi').focus();
      const terminar = (valor) => {
        caja.hidden = true;
        $('ytIaSi').removeEventListener('click', si);
        $('ytIaNo').removeEventListener('click', no);
        signal.removeEventListener('abort', no);
        resolver(valor);
      };
      const si = () => terminar(true);
      const no = () => terminar(false);
      $('ytIaSi').addEventListener('click', si);
      $('ytIaNo').addEventListener('click', no);
      signal.addEventListener('abort', no, { once: true });
    });
  }

  function elegirIdioma(decision, signal) {
    return new Promise((resolver) => {
      ui.elegirTexto.textContent = decision.mensaje || '¿En qué idioma habla el video?';
      ui.elegirSelect.value = IDIOMAS_DOBLABLES.includes(decision.idioma) ? decision.idioma : 'en';
      ui.elegir.hidden = false;
      ui.elegirSi.focus();
      const terminar = (valor) => {
        ui.elegir.hidden = true;
        ui.elegirSi.removeEventListener('click', aceptar);
        ui.elegirNo.removeEventListener('click', rechazar);
        signal.removeEventListener('abort', rechazar);
        resolver(valor);
      };
      const aceptar = () => terminar(ui.elegirSelect.value);
      const rechazar = () => terminar(null);
      ui.elegirSi.addEventListener('click', aceptar);
      ui.elegirNo.addEventListener('click', rechazar);
      signal.addEventListener('abort', rechazar, { once: true });
    });
  }

  function desbloquearElemento(elemento) {
    try {
      elemento.src = SILENCIO_WAV;
      const intento = elemento.play();
      if (intento?.then) intento.then(() => { if (elemento.src === SILENCIO_WAV) elemento.pause(); }).catch(() => {});
    } catch (_) { /* si no se pudo, «Ver con voz en español» lo hace con su propio toque */ }
  }

  function desbloquearAudio() {
    // Los dos elementos se desbloquean en el gesto: en iPhone un elemento que
    // nunca sonó dentro de un toque no puede arrancar solo a mitad del video.
    desbloquearElemento(audioDoblaje);
    desbloquearElemento(audioDoblaje2);
  }

  async function crearReproductor(videoId, signal) {
    recrearDestino();
    const player = new YouTubePlayer('ytPlayer', videoId, { pantallaCompletaPropia: true });
    const listo = player.inicializar().then(() => true).catch(() => false);
    const tardo = new Promise((resolver) => setTimeout(() => resolver(false), ESPERA_REPRODUCTOR_MS));
    await Promise.race([listo, tardo]);
    if (signal.aborted) { player.destruir(); throw cancelado(); }
    return player;   // si tardó, se sigue: puede terminar de cargar después
  }

  async function crearReproductorX(info, signal) {
    recrearDestino();
    const mp4 = elegirMp4(info.mp4, { ahorroDatos: Boolean(navigator.connection?.saveData) });
    if (!mp4) throw new ErrorYoutube('Este post de X no trae un video que el navegador pueda reproducir.', 'x_sin_video');
    const player = new XVideoPlayer('ytPlayer', { mp4: mp4.url, portada: info.portada || '', titulo: tituloX(info) });
    // A diferencia de YouTube, un fallo de carga sí se informa: sin video no hay qué doblar.
    await Promise.race([player.inicializar(), new Promise((r) => setTimeout(r, ESPERA_REPRODUCTOR_MS))]);
    if (signal.aborted) { player.destruir(); throw cancelado(); }
    return player;
  }

  async function crearReproductorArchivo(url, titulo, signal) {
    recrearDestino();
    const player = new XVideoPlayer('ytPlayer', {
      mp4: url, titulo, etiqueta: 'Video de tu equipo',
      mensajeError: 'Este navegador no puede reproducir este video (formato o códec). Ábrelo en Chrome de computador o conviértelo a MP4 (H.264 + AAC).',
    });
    await Promise.race([player.inicializar(), new Promise((r) => setTimeout(r, ESPERA_REPRODUCTOR_MS))]);
    if (signal.aborted) { player.destruir(); throw cancelado(); }
    return player;
  }

  /**
   * Velocidad de partida del video: la que la persona eligió en el engranaje de
   * YouTube en videos anteriores. Con el ritmo automático no se reaplica una
   * velocidad menor que 1: frenar ya lo hace el motor solo, y una 0.85 vieja
   * (del selector manual que existía antes) dejaría el video lento sin motivo.
   */
  function aplicarTasaGuardada(player) {
    let base = normalizarTasa(leer(CLAVE_TASA));
    if (ritmoAutomatico() && base < 1) base = 1;
    if (Math.abs(base - (Number(player.getPlaybackRate?.()) || 1)) > 0.001) player.setPlaybackRate(base);
    display.mostrarVelocidad(Number(player.getPlaybackRate?.()) || base, false);
  }

  /** La etiqueta del texto sincronizado cuenta la velocidad real y si el ritmo automático la bajó. */
  function mostrarRitmo(actual, tasa, { automatica }) {
    display.mostrarVelocidad(tasa, automatica);
    if (automatica && !actual.avisoRitmo) {
      // Una sola vez por video: que se entienda por qué el video va un poco más lento.
      actual.avisoRitmo = true;
      ui.estado.textContent = `Ritmo automático: el video va a ${String(tasa).replace('.', ',')}× en este tramo para que la voz diga todo sin saltarse nada.`;
    }
  }

  function textoDeError(error) {
    if (!error?.codigo && /abort|timeout|tiempo l[ií]mite/i.test(String(error?.message))) {
      return 'El servidor tardó demasiado. Intenta de nuevo en un momento.';
    }
    return String(error?.message || error || 'No se pudo preparar el doblaje.');
  }

  async function pedirTexto(url, { idiomaOrigen, tituloVideo, duracionS, signal, permitirIA = false }) {
    progreso.paso('leer', 'Leyendo el video…');
    progreso.barra(null);
    return transcripciones.obtenerParaDoblaje(url, {
      idiomaOrigen, tituloVideo, duracionS, permitirIA, signal,
      apiKey: leer('jg_groq_api_key') || '',
      context: leer('jg_glossary') || '',
      onProgress: (mensaje) => progreso.mensaje(mensaje),
    });
  }

  function pintarBuffer(actual) {
    if (sesion !== actual || !actual.motor) return;
    const { vozHastaS, errores } = actual.motor.resumen();
    const voz = Number.isFinite(vozHastaS) ? `Voz lista para los próximos ${formatoTiempo(vozHastaS)}` : 'Voz lista hasta el final';
    const fallidos = errores.traduccion + errores.voz;
    /* El relevo de voz es un aviso permanente: la línea de estado se sobrescribe
     * con cada cambio («Listo…», «Voz en español activa…») y la persona que
     * vuelve al panel tiene que poder seguir viendo la causa real. */
    const relevo = actual.avisoRespaldo ? ' · La voz Fish no responde (sin créditos o saturada): el doblaje sigue con la voz neural para no cambiar de timbre a media escena.' : '';
    ui.buffer.textContent = fallidos ? `${voz} · ${fallidos} tramos sonarán en su idioma original${relevo}` : `${voz}${relevo}`;
  }

  /** Fish cayó a mitad de sesión: todo el resto con voces neurales, sin mezclar timbres (TRAMPAS §6.14). */
  function pasarANeural(actual) {
    const esFish = (v) => String(v || '').startsWith('fish:');
    if ((!esFish(actual.voz) && !esFish(actual.vozSecundaria)) || actual.avisoRespaldo) return;
    if (esFish(actual.voz)) actual.voz = `neural:auto:${generoDeVoz(actual.voz)}`;
    if (esFish(actual.vozSecundaria)) actual.vozSecundaria = `neural:auto:${generoDeVoz(actual.vozSecundaria)}`;
    actual.avisoRespaldo = true;
    actual.servicioVoz.invalidarDesde(actual.player.getCurrentTime() + 1);
    ui.estado.textContent = 'La voz Fish no responde (sin créditos o saturada): el doblaje sigue con la voz neural para no cambiar de timbre a media escena.';
  }

  /** Preparación por ventanas (H3): lo de ahora primero; el resto, mientras se ve. */
  async function prepararDoblaje(actual, { datos, origen, tituloVideo, signal, traduccionesGuardadas = [] }) {
    const { player } = actual;
    actual.segmentos = datos.segmentos;
    actual.origen = origen;
    actual.tituloVideo = tituloVideo;
    resolverVocesSesion(actual);
    // Sin diálogo y del equipo: se ofrece el cambio manual de voz (la
    // automática necesita marcas de quién habla y lo transcrito no las trae).
    if (ui.otraVoz) {
      actual.otroHablante = false;
      ui.otraVoz.hidden = !(esClaveArchivo(actual.videoId) && ui.voz2Wrap?.hidden);
      pintarOtraVoz();
    }
    const limitador = crearLimitador();
    const servicioVoz = new DubbingService({
      // Cada frase suena con su hablante: monólogo = 1 voz, diálogo = 2.
      // La voz ya generada se reutiliza (biblioteca: «Listo al instante») y no
      // gasta turno del limitador de Azure: DubbingService la consulta ANTES.
      // Cada voz se guarda con su tramo hablado ya medido (hablaVoz.js): al
      // volver al video no se decodifica ninguna frase. Las guardadas antes de
      // v157 (o desde una descarga) se miden la primera vez y se completan.
      buscarGuardada: async (texto, unidad) => {
        const voz = vozParaUnidad(unidad, { vozPrincipal: actual.voz, vozSecundaria: actual.vozSecundaria });
        const clave = claveDeVoz(actual.videoId, voz, texto);
        const guardada = await leerVoz(clave);
        if (!guardada) return null;
        let { habla } = guardada;
        if (!habla) {
          habla = await medirHabla(guardada.blob);
          if (habla) guardarVoz(clave, actual.videoId, guardada.blob, guardada.motor, habla);
        }
        return { blob: guardada.blob, engineHdr: guardada.motor, habla };
      },
      generarAudio: async (texto, unidad) => {
        const voz = vozParaUnidad(unidad, { vozPrincipal: actual.voz, vozSecundaria: actual.vozSecundaria });
        const resultado = await generarAudioEspanol(texto, { voz, signal });
        const blob = resultado instanceof Blob ? resultado : resultado?.blob;
        if (!blob?.size) return resultado;
        const habla = await medirHabla(blob);
        // Un respaldo (sonó otra voz) no se guarda: al volver al video sonaría con otro timbre.
        if (!resultado?.respaldoHdr) {
          guardarVoz(claveDeVoz(actual.videoId, voz, texto), actual.videoId, blob, resultado?.engineHdr || '', habla).then(contarVozGuardada);
        }
        return resultado instanceof Blob ? { blob, habla } : { ...resultado, habla };
      },
      limitador,
      onRespaldo: () => pasarANeural(actual),
    });
    servicioVoz.definirUnidades(agruparPorTiempo(datos.segmentos));
    actual.servicioVoz = servicioVoz;
    const motor = new MotorPreparacion({
      segmentos: datos.segmentos, servicioVoz, traductor,
      posicion: () => actual.retomarEn || player.getCurrentTime(),
      origen, tituloVideo, limitadorVoz: limitador, signal,
      onCambio: (evento) => {
        if (evento?.tipo === 'pausa') ui.estado.textContent = evento.mensaje;
        pintarBuffer(actual);
      },
      onTraduccion: () => {
        display.refrescar();
        clearTimeout(actual.temporizadorCache);
        actual.temporizadorCache = setTimeout(() => guardarSesion(actual), 3000);
      },
    });
    actual.motor = motor;
    motor.sembrar(traduccionesGuardadas);
    display.definirSegmentos(datos.segmentos, (i) => {
      if (!motor.traducciones.has(i)) return null;
      return motor.traducciones.get(i) ?? datos.segmentos[i].text;   // sin traducción: se lee el original
    });
    motor.iniciar();
    progreso.paso('traducir', 'Traduciendo el comienzo al español…');
    progreso.barra(0);
    await motor.esperarArranque({
      vozInicialS: VOZ_INICIAL_S,
      onProgreso: (resumen) => {
        const traducido = Math.min(1, resumen.traducidoHastaS / VOZ_INICIAL_S);
        if (traducido < 1) {
          progreso.paso('traducir');
          progreso.barra(traducido);
        } else {
          progreso.paso('voz', 'Preparando la voz en español…');
          progreso.barra(Math.min(1, resumen.vozHastaS / VOZ_INICIAL_S));
        }
      },
    });
    if (signal.aborted) throw cancelado();

    actual.motorVoz = new DubbingEngine({
      player, servicio: servicioVoz,
      // Dos elementos distintos (doble búfer): si la fábrica devolviera el
      // mismo dos veces, la precarga pisaría la frase actual y no sonaría.
      crearAudio: () => {
        audiosEntregados += 1;
        if (audiosEntregados === 1) return audioDoblaje;
        if (audiosEntregados === 2) return audioDoblaje2;
        return new Audio();
      },
      modoSilenciarOriginal: esIOS,
      ritmoAutomatico: ritmoAutomatico(),
      onStatus: (mensaje, tipo) => { ui.estado.textContent = mensaje; display.mostrarVoz(tipo); },
      onMetricas: (metricas) => { actual.metricas = metricas; },   // solo diagnóstico (H28)
      onFin: () => { ui.estado.textContent = 'El video terminó.'; display.mostrarVoz('fin'); },
      onRitmo: (tasa, detalle) => mostrarRitmo(actual, tasa, detalle),
      // La persona cambió la velocidad en el engranaje de YouTube: se recuerda
      // para el próximo video (lo que baja el ritmo automático, no).
      onTasaBase: (tasa) => guardar(CLAVE_TASA, String(normalizarTasa(tasa))),
    });
    actual.motorVoz.definirVolumenVoz(Number(ui.volVoz.value) / 100);
    actual.motorVoz.definirVolumenFondo(Number(ui.volOriginal.value));
    actual.sync = new SyncEngine({
      player, segmentos: datos.segmentos,
      onSegmentChange: (indice) => display.mostrar(indice),
      // Con la voz en español sonando, el texto muestra la línea que se OYE.
      indiceExterno: () => actual.motorVoz?.indiceSegmentoVoz() ?? null,
    });
    actual.sync.iniciar();
    aplicarTasaGuardada(player);

    progreso.terminar();
    ui.botonVoz.disabled = false;
    // La voz queda encendida por defecto: si la persona ya le dio play, entra sola.
    actual.motorVoz.activar();
    ponerEstadoBotonVoz(true);
    display.mostrarVoz('activo');
    ui.reproducir.hidden = player.getPlayerState() === 1;
    if (!ui.reproducir.hidden) ui.reproducir.focus({ preventScroll: true });
    // Si alguna voz del comienzo falló, el motor ya la está repitiendo en segundo
    // plano: se dice en vez de prometer un «Listo» perfecto (TRAMPAS §8.2).
    const fallosVoz = Number(motor?.errores?.voz) || 0;
    ui.estado.textContent = fallosVoz > 0
      ? 'Listo. Algunas frases del comienzo aún preparan su voz y pueden sonar en inglés un momento; se corrigen solas. El resto del doblaje se prepara mientras ves el video.'
      : 'Listo. El resto del doblaje se prepara mientras ves el video.';
    pintarBuffer(actual);
    actual.relojCache = setInterval(() => guardarSesion(actual), 5000);
  }

  /** Lo común al abrir cualquier video (YouTube o X): corta la sesión anterior y prepara la vista. */
  function abrirSesion(videoId) {
    terminarSesion({ restaurarFormulario: false });
    const controlador = new AbortController();
    const actual = { controlador, videoId, abrirEn: abrirEnPendiente };
    abrirEnPendiente = 0;
    sesion = actual;
    marcarOcupado(true);
    ui.area.hidden = false;
    document.querySelector('.yt-area')?.classList.add('has-results', 'modo-doblaje');
    biblioteca?.plegar?.(true);   // mientras se ve un video, la biblioteca no estorba
    progreso.iniciar();
    ui.area.scrollIntoView({ block: 'start', behavior: 'smooth' });
    audiosEntregados = 0;
    desbloquearAudio();
    // La primera síntesis paga el arranque del servicio de voz (2-4 s medidos):
    // se paga ahora, mientras se lee el video, y no cuando la persona espera oírla.
    Promise.resolve().then(() => fetchApi('/tts-warmup', { signal: controlador.signal }, 15000)).catch(() => {});
    return actual;
  }

  /**
   * Lo común con el idioma ya decidido: caché del video, ficha de la biblioteca,
   * «retomar donde ibas» (o el segundo que se buscó) y preparación.
   * `meta`: { autor, portada } de la plataforma, para la tarjeta.
   */
  async function completarSesion(actual, { decision, datos, tituloVideo, duracionS, guardado, sirve, meta = {} }) {
    const { signal } = actual.controlador;
    actual.registro = {
      videoId: actual.videoId,
      idiomaOrigen: decision.idioma,
      titulo: tituloVideo,
      duracionS,
      segmentos: datos.segmentos,
      traducciones: sirve ? guardado.traducciones : [],
      posicionS: sirve ? guardado.posicionS : 0,
    };
    guardarDoblaje(actual.registro);
    registrarVideo({
      clave: actual.videoId, titulo: tituloVideo, duracionS, idiomaOrigen: decision.idioma,
      autor: meta.autor || '', portada: meta.portada || '', posicionS: actual.registro.posicionS, abierto: Date.now(),
      nombreArchivo: meta.nombreArchivo, bytes: meta.bytes,
    }).then((entrada) => {
      if (!entrada) return;
      pedirPersistencia();   // sin esto iOS borra la biblioteca tras días sin uso
      avisarBiblioteca();
    });
    const abrirEn = Number(actual.abrirEn) || 0;
    if (abrirEn > 0 && abrirEn < duracionS - 1) {
      actual.retomarEn = abrirEn;
      ui.estado.textContent = `Abrimos en ${formatoTiempo(abrirEn)}, donde se dice lo que buscaste.`;
      $('ytDesdeInicio').hidden = false;
    } else if (sirve && 15 < guardado.posicionS && guardado.posicionS < duracionS - 30) {
      actual.retomarEn = guardado.posicionS;
      ui.estado.textContent = `Retomamos donde ibas (${formatoTiempo(actual.retomarEn)}).`;
      $('ytDesdeInicio').hidden = false;
    }
    await prepararDoblaje(actual, {
      datos, origen: decision.idioma, tituloVideo, signal,
      traduccionesGuardadas: actual.registro.traducciones,
    });
    // Las voces ya resueltas («auto» → la neural del video): las usan las
    // descargas, para que el archivo suene como sonó el video.
    registrarVideo({ clave: actual.videoId, voz: actual.voz || '', vozSecundaria: actual.vozSecundaria || 'ninguna' });
  }

  async function iniciarSesion() {
    if (archivoElegido) {
      if (!estaServidorOnline()) return;
      return iniciarSesionArchivo(archivoElegido);
    }
    const url = ui.url.value.trim();
    const fuente = detectarFuente(url);
    if (!fuente || !estaServidorOnline()) return;
    if (fuente.plataforma === 'x') return iniciarSesionX(url, fuente);
    const videoId = fuente.id;
    const actual = abrirSesion(videoId);
    const { signal } = actual.controlador;
    try {
      // El reproductor y el texto van EN PARALELO: antes el texto esperaba a que
      // el reproductor estuviera listo (hasta 8 s en un teléfono lento).
      const promesaPlayer = crearReproductor(videoId, signal).then((player) => {
        if (sesion === actual) actual.player = player; else player.destruir();
        const titulo = player.getVideoData()?.title || '';
        if (titulo && sesion === actual) ui.titulo.textContent = titulo;
        if (player.getDuration() > 1800 && sesion === actual && !ui.tarjeta.hidden) {
          progreso.ayuda('Video largo: la primera vez se tarda más en leer el texto. Puedes darle play mientras tanto.');
        }
        return player;
      });
      promesaPlayer.catch(() => {});   // un fallo se atiende abajo, al esperarlo

      const guardado = await leerDoblaje(videoId);
      const elegidoEnFormulario = ui.idioma?.value || 'auto';
      const sirve = Boolean(guardado?.segmentos?.length)
        && (elegidoEnFormulario === 'auto' || elegidoEnFormulario === guardado.idiomaOrigen);
      let datos;
      let decision;
      // Pistas del reproductor para el servidor (título y duración), solo si
      // llegan pronto: el texto no espera al reproductor.
      let tituloVideo = '';
      let duracionS = 0;
      if (sirve) {
        datos = { segmentos: guardado.segmentos, idioma: guardado.idiomaOrigen, confianza: 1, fuente: 'usuario', conflicto: false };
        decision = { accion: 'doblar', idioma: guardado.idiomaOrigen, mensaje: '' };
      } else {
        const pronto = await Promise.race([promesaPlayer.catch(() => null), new Promise((r) => setTimeout(() => r(null), ESPERA_PISTAS_MS))]);
        if (signal.aborted) throw cancelado();
        tituloVideo = pronto?.getVideoData()?.title || '';
        duracionS = pronto?.getDuration() || 0;
        try {
          datos = await pedirTexto(url, { idiomaOrigen: elegidoEnFormulario, tituloVideo, duracionS, signal });
        } catch (error) {
          if (error?.codigo !== 'sin_subtitulos') throw error;
          // Sin subtítulos hay que transcribir con IA: se pide permiso ANTES de gastar (H24).
          progreso.mensaje('Este video no tiene subtítulos.');
          const permitir = await pedirPermisoIA(error.datos, signal);
          if (!permitir) {
            mostrarIdioma('Sin doblaje', 'no');
            progreso.error('Sin subtítulos no se puede doblar sin transcribir con IA. No se gastó ningún crédito.');
            return;
          }
          progreso.paso('leer', 'Transcribiendo con IA…');
          progreso.ayuda('Los videos largos pueden tardar varios minutos. Puedes cancelar cuando quieras.');
          datos = await pedirTexto(url, { idiomaOrigen: elegidoEnFormulario, tituloVideo, duracionS, signal, permitirIA: true });
        }
        decision = decidirDoblaje(datos);
        if (decision.accion === 'preguntar' || decision.accion === 'no_soportado') {
          progreso.mensaje('Confirma el idioma del video para seguir.');
          const elegido = await elegirIdioma(decision, signal);
          if (!elegido) { terminarSesion(); return; }
          if (elegido !== datos.idioma) {
            datos = await pedirTexto(url, { idiomaOrigen: elegido, tituloVideo, duracionS, signal });
          }
          decision = { accion: 'doblar', idioma: elegido, mensaje: '' };
        }
      }
      if (decision.accion === 'sin_doblaje') {
        mostrarIdioma('El video ya está en español', 'ok');
        progreso.error(decision.mensaje);
        return;
      }
      mostrarIdioma(`Idioma del video: ${nombreIdioma(decision.idioma)}`, 'ok');
      // Para doblar sí hace falta el reproductor (casi siempre ya está listo).
      actual.player = await promesaPlayer;
      if (signal.aborted) throw cancelado();
      tituloVideo = actual.player.getVideoData()?.title || tituloVideo || datos.titulo || guardado?.titulo || '';
      duracionS = actual.player.getDuration() || duracionS || datos.duracionS || guardado?.duracionS || 0;
      if (tituloVideo) ui.titulo.textContent = tituloVideo;
      await completarSesion(actual, {
        decision, datos, tituloVideo, duracionS, guardado, sirve,
        meta: { autor: actual.player.getVideoData?.()?.author || '' },
      });
    } catch (error) {
      if (signal.aborted || error?.name === 'AbortError') return;
      mostrarIdioma('No se pudo preparar el doblaje', 'no');
      progreso.error(textoDeError(error));
    } finally {
      if (sesion === actual) marcarOcupado(false);
    }
  }

  async function iniciarSesionX(url, fuente) {
    const actual = abrirSesion(fuente.clave);
    const { signal } = actual.controlador;
    try {
      progreso.paso('leer', 'Buscando el video en X…');
      const info = await servicioX.info(url, { signal });
      if (signal.aborted) throw cancelado();
      const tituloVideo = tituloX(info);
      ui.titulo.textContent = tituloVideo;
      const promesaPlayer = crearReproductorX(info, signal).then((player) => {
        if (sesion === actual) actual.player = player; else player.destruir();
        return player;
      });
      promesaPlayer.catch(() => {});   // un fallo se atiende abajo, al esperarlo

      const guardado = await leerDoblaje(fuente.clave);
      const elegidoEnFormulario = ui.idioma?.value || 'auto';
      const sirve = Boolean(guardado?.segmentos?.length)
        && (elegidoEnFormulario === 'auto' || elegidoEnFormulario === guardado.idiomaOrigen);
      const transcribir = (idiomaOrigen) => servicioX.obtenerParaDoblaje(info, {
        idiomaOrigen, signal,
        apiKey: leer('jg_groq_api_key') || '',
        context: leer('jg_glossary') || '',
        onProgress: (mensaje, fraccion) => { progreso.mensaje(mensaje); progreso.barra(fraccion ?? null); },
      });
      let datos;
      let decision;
      if (sirve) {
        datos = { segmentos: guardado.segmentos, idioma: guardado.idiomaOrigen, confianza: 1, fuente: 'usuario', conflicto: false };
        decision = { accion: 'doblar', idioma: guardado.idiomaOrigen, mensaje: '' };
      } else {
        progreso.ayuda('X no trae subtítulos: escuchamos el audio del video para sacar el texto (gratis). Mientras tanto puedes darle play.');
        datos = await transcribir(elegidoEnFormulario);
        decision = decidirDoblaje(datos);
        if (decision.accion === 'preguntar' || decision.accion === 'no_soportado') {
          progreso.mensaje('Confirma el idioma del video para seguir.');
          const elegido = await elegirIdioma(decision, signal);
          if (!elegido) { terminarSesion(); return; }
          if (elegido !== datos.idioma) datos = await transcribir(elegido);
          decision = { accion: 'doblar', idioma: elegido, mensaje: '' };
        }
      }
      if (decision.accion === 'sin_doblaje') {
        mostrarIdioma('El video ya está en español', 'ok');
        progreso.error(decision.mensaje);
        return;
      }
      mostrarIdioma(`Idioma del video: ${nombreIdioma(decision.idioma)}`, 'ok');
      actual.player = await promesaPlayer;
      if (signal.aborted) throw cancelado();
      const duracionS = actual.player.getDuration() || Number(info.duracion_s) || datos.duracionS || 0;
      await completarSesion(actual, {
        decision, datos, tituloVideo, duracionS, guardado, sirve,
        meta: { autor: info.autor || '', portada: info.portada || '' },
      });
    } catch (error) {
      if (signal.aborted || error?.name === 'AbortError') return;
      mostrarIdioma('No se pudo preparar el doblaje', 'no');
      progreso.error(textoDeError(error));
    } finally {
      if (sesion === actual) marcarOcupado(false);
    }
  }

  async function iniciarSesionArchivo(archivo) {
    let clave;
    try { clave = await huellaArchivo(archivo); } catch (_) {
      avisarEquipo('No pudimos leer ese archivo. Elígelo otra vez.');
      return;
    }
    const actual = abrirSesion(clave);
    const { signal } = actual.controlador;
    try {
      progreso.paso('leer', 'Abriendo tu video…');
      const ficha = await servicioArchivo.inspeccionar(archivo);
      actual.cerrarArchivo = () => ficha.abierto.cerrar();
      if (signal.aborted) throw cancelado();
      ultimoArchivo = { clave: ficha.clave, archivo };
      ui.titulo.textContent = ficha.titulo;
      actual.urlArchivo = URL.createObjectURL(archivo);
      const promesaPlayer = crearReproductorArchivo(actual.urlArchivo, ficha.titulo, signal).then((player) => {
        if (sesion === actual) actual.player = player; else player.destruir();
        return player;
      });
      promesaPlayer.catch(() => {});   // un fallo se atiende abajo, al esperarlo
      const promesaPortada = import('./medioLocal.js').then((m) => m.capturarPortada(actual.urlArchivo)).catch(() => '');

      const guardado = await leerDoblaje(ficha.clave);
      const elegidoEnFormulario = ui.idioma?.value || 'auto';
      // Con subtítulos del usuario manda su texto: la caché no sirve (otra
      // segmentación) y no se transcribe nada.
      const conSubtitulos = Boolean(subtituloElegido?.segmentos?.length);
      const sirve = !conSubtitulos && Boolean(guardado?.segmentos?.length)
        && (elegidoEnFormulario === 'auto' || elegidoEnFormulario === guardado.idiomaOrigen);
      // Lo que ya se transcribió en un intento anterior (Groq llegó a su límite, se cerró…) no se vuelve a pagar.
      const parcial = !sirve && guardado?.parcial?.trozoS === ficha.extraccion.trozoS ? guardado.parcial : null;
      const transcribir = (idiomaOrigen, conPrevias) => {
        const previas = new Map(conPrevias ? parcial?.partes || [] : []);
        return servicioArchivo.obtenerParaDoblaje(ficha, {
          idiomaOrigen, signal, previas, idiomaPrevio: conPrevias ? parcial?.idioma || '' : '',
          apiKey: leer('jg_groq_api_key') || '',
          context: leer('jg_glossary') || '',
          onProgress: (mensaje, fraccion) => { progreso.mensaje(mensaje); progreso.barra(fraccion ?? null); },
          alTerminarParte: (k, segmentos, idioma) => {
            previas.set(k, segmentos);
            return guardarDoblaje({
              videoId: ficha.clave, titulo: ficha.titulo, duracionS: ficha.duracionS,
              parcial: { trozoS: ficha.extraccion.trozoS, idioma, partes: [...previas] },
            });
          },
        });
      };
      let datos;
      let decision;
      if (sirve) {
        datos = { segmentos: guardado.segmentos, idioma: guardado.idiomaOrigen, confianza: 1, fuente: 'usuario', conflicto: false };
        decision = { accion: 'doblar', idioma: guardado.idiomaOrigen, mensaje: '' };
      } else if (conSubtitulos) {
        progreso.ayuda('Usamos tus subtítulos tal cual: no se transcribe ni se gasta nada. Mientras tanto puedes darle play.');
        progreso.paso('leer', 'Leyendo los subtítulos…');
        const elegido = elegidoEnFormulario === 'auto' ? '' : codigoCorto(elegidoEnFormulario);
        datos = {
          segmentos: subtituloElegido.segmentos, idioma: elegido, solicitado: elegido,
          confianza: elegido ? 1 : 0, fuente: elegido ? 'usuario' : 'subtitulos',
          conflicto: false, disponibles: [], titulo: ficha.titulo, duracionS: ficha.duracionS,
        };
        decision = decidirDoblaje(datos);
        if (decision.accion === 'preguntar' || decision.accion === 'no_soportado') {
          progreso.mensaje('Confirma el idioma de los subtítulos para seguir.');
          const picked = await elegirIdioma(decision, signal);
          if (!picked) { terminarSesion(); return; }
          datos.idioma = picked;
          datos.confianza = 1;
          datos.fuente = 'usuario';
          decision = { accion: 'doblar', idioma: picked, mensaje: '' };
        }
      } else {
        progreso.ayuda(`${resumenAntesDeEmpezar({ duracionS: ficha.duracionS, modo: ficha.extraccion.modo, trozoS: ficha.extraccion.trozoS })} Mientras tanto puedes darle play.`);
        const conPrevias = Boolean(parcial) && (elegidoEnFormulario === 'auto' || elegidoEnFormulario === parcial.idioma);
        datos = await transcribir(elegidoEnFormulario, conPrevias);
        decision = decidirDoblaje(datos);
        if (decision.accion === 'preguntar' || decision.accion === 'no_soportado') {
          progreso.mensaje('Confirma el idioma del video para seguir.');
          const elegido = await elegirIdioma(decision, signal);
          if (!elegido) { terminarSesion(); return; }
          if (elegido !== datos.idioma) datos = await transcribir(elegido, false);
          decision = { accion: 'doblar', idioma: elegido, mensaje: '' };
        }
      }
      if (decision.accion === 'sin_doblaje') {
        mostrarIdioma('El video ya está en español', 'ok');
        progreso.error(decision.mensaje);
        return;
      }
      mostrarIdioma(`Idioma del video: ${nombreIdioma(decision.idioma)}`, 'ok');
      actual.player = await promesaPlayer;
      if (signal.aborted) throw cancelado();
      const duracionS = actual.player.getDuration() || ficha.duracionS;
      await completarSesion(actual, {
        decision, datos, tituloVideo: ficha.titulo, duracionS, guardado, sirve,
        meta: { portada: await promesaPortada, nombreArchivo: ficha.nombreArchivo, bytes: ficha.bytes },
      });
      if (ficha.originalMudo && sesion === actual) {
        ui.estado.textContent = 'Este navegador no reproduce el sonido original de este archivo (por ejemplo AC-3). La voz en español sí suena.';
      }
      quitarArchivo();   // ya está en la biblioteca; el formulario queda libre
    } catch (error) {
      if (signal.aborted || error?.name === 'AbortError') return;
      mostrarIdioma('No se pudo preparar el doblaje', 'no');
      progreso.error(textoDeError(error));
    } finally {
      if (sesion === actual) marcarOcupado(false);
    }
  }

  // ── Biblioteca: abrir un video guardado y bajar sus archivos ───────────

  /**
   * Abre un video de la biblioteca por el camino de siempre: la caché hace que
   * no se vuelva a pedir texto ni traducción, y la voz guardada suena al
   * instante. `segundo`: abrir donde se dijo lo que se buscó.
   */
  function abrirDesdeBiblioteca(video, { segundo = 0 } = {}) {
    if (video?.plataforma === 'archivo') return abrirArchivoDeBiblioteca(video, segundo);
    if (!video?.url) return { abierto: false, motivo: 'Este video no tiene enlace guardado.' };
    if (estaOcupado()) return { abierto: false, motivo: 'Espera a que termine de prepararse el video actual.' };
    if (!estaServidorOnline()) return { abierto: false, motivo: 'Conecta el servidor (indicador de arriba) para abrir el video.' };
    ui.url.value = video.url;
    if (ui.idioma) ui.idioma.value = 'auto';   // con «auto» la caché del video sirve siempre
    ui.url.dispatchEvent(new Event('input'));
    abrirEnPendiente = Number(segundo) || 0;
    iniciarSesion().catch((error) => {
      console.error('[jg-youtube]', error);
      progreso.error('Algo falló al abrir el video. Vuelve a intentarlo.');
    });
    return { abierto: true, motivo: '' };
  }

  /**
   * El video del equipo no se copió: se pide el mismo archivo (en el MISMO toque,
   * o el navegador no abre el selector) y la huella confirma que es ese.
   * Devuelve `pendiente`: la vista avisa cuando se sepa si abrió.
   */
  function abrirArchivoDeBiblioteca(video, segundo) {
    if (estaOcupado()) return { abierto: false, motivo: 'Espera a que termine de prepararse el video actual.' };
    if (!estaServidorOnline()) return { abierto: false, motivo: 'Conecta el servidor (indicador de arriba) para abrir el video.' };
    const empezar = (archivo) => {
      ponerArchivo(archivo);
      if (ui.idioma) ui.idioma.value = 'auto';   // con «auto» la caché del video sirve siempre
      abrirEnPendiente = Number(segundo) || 0;
      iniciarSesion().catch((error) => {
        console.error('[jg-youtube]', error);
        progreso.error('Algo falló al abrir el video. Vuelve a intentarlo.');
      });
      return { abierto: true, motivo: '' };
    };
    if (ultimoArchivo?.clave === video.clave) return empezar(ultimoArchivo.archivo);
    const nombre = video.nombreArchivo || video.titulo;
    const pendiente = pedirArchivo().then(async (archivo) => {
      if (!archivo) return { abierto: false, motivo: '' };
      if (await huellaArchivo(archivo).catch(() => '') !== video.clave) {
        return { abierto: false, motivo: `Ese archivo no es «${nombre}». Elige el mismo video que doblaste.` };
      }
      return empezar(archivo);
    });
    return { abierto: false, pendiente, motivo: `Elige otra vez «${nombre}» en tu equipo: los videos no se copian a la app.` };
  }

  /** Para el MP4 doblado hace falta el original: se pide y se confirma por la huella. */
  async function elegirArchivoPara(video) {
    const archivo = await pedirArchivo();
    if (!archivo) return { ok: false, motivo: '' };
    if (await huellaArchivo(archivo).catch(() => '') !== video.clave) {
      return { ok: false, motivo: `Ese archivo no es «${video.nombreArchivo || video.titulo}». Elige el mismo video que doblaste.` };
    }
    ultimoArchivo = { clave: video.clave, archivo };
    return { ok: true, motivo: '' };
  }

  const esMovil = () => Boolean(navigator.userAgentData?.mobile ?? /Android|iPhone|iPad|iPod/i.test(navigator.userAgent));

  /**
   * Voz neural de los archivos: la que sonó en el video si era neural; si era
   * Fish o «auto», la neural de su género (Fish tarda 6-8 s por frase). La 2.ª
   * voz sigue la elección del dueño («Ninguna» = todo con la principal).
   */
  function vozDeArchivo(video, hablante = 0) {
    const neural = (voz) => (String(voz).startsWith('neural:') ? String(voz) : `neural:auto:${generoDeVoz(voz)}`);
    const principal = neural(String(video?.voz || '') || vozPorDefecto());
    if (hablante !== 1) return principal;
    const segunda = video?.vozSecundaria;
    if (segunda === 'ninguna') return principal;
    if (segunda) return neural(segunda);
    return `neural:auto:${generoDeVoz(principal) === 'male' ? 'female' : 'male'}`;
  }

  /**
   * Una frase del archivo: primero la voz guardada; si no, edge-tts (sin cuota,
   * `evitarAzure`) dos veces y, al tercer intento, Azure. Se guarda para la próxima.
   */
  async function sintetizarArchivo(video, texto, { tasa = 1, signal = null, frase = null } = {}) {
    if (typeof generarAudioArchivo !== 'function') throw new Error('Falta el generador de voz para archivos.');
    const voz = vozDeArchivo(video, frase?.hablante);
    const clave = claveDeVoz(video.clave, voz, texto, tasa);
    const guardada = await leerVoz(clave);
    if (guardada) return guardada.blob;
    let ultimoError = null;
    for (const evitarAzure of [true, true, false]) {
      if (signal?.aborted) throw cancelado();
      try {
        const blob = await generarAudioArchivo(texto, { voz, tasa, signal, evitarAzure });
        if (blob?.size) {
          guardarVoz(clave, video.clave, blob, evitarAzure ? 'edge' : 'azure').then(contarVozGuardada);
          return blob;
        }
      } catch (error) {
        if (error?.name === 'AbortError' || signal?.aborted) throw cancelado();
        ultimoError = error;
      }
    }
    throw new Error(`No se pudo generar la voz de una frase: ${ultimoError?.message || 'el servicio no respondió'}`);
  }

  /** Frases del video entero, traduciendo solo lo que falte (y guardándolo). */
  async function frasesParaArchivo(video, { signal = null, onProgreso = () => {} } = {}) {
    const registro = await leerDoblaje(video.clave);
    if (!registro?.segmentos?.length) throw new Error('Este video todavía no tiene texto guardado. Ábrelo una vez para doblarlo.');
    const mapa = await traductor.traducirTodo(registro.segmentos, {
      origen: registro.idiomaOrigen, tituloVideo: registro.titulo, signal,
      ya: new Map(registro.traducciones || []),
      onProgress: (hechas, total) => onProgreso({ fase: 'traduccion', hechas, total }),
    });
    registro.traducciones = [...mapa];
    guardarDoblaje(registro);
    const unidades = agruparPorTiempo(registro.segmentos);
    return unidades.map((unidad) => ({
      indice: unidad.indice, startTime: unidad.startTime, hablante: unidad.hablante,
      texto: prepararTextoDeUnidad(unidades, unidad.indice, mapa) || '',
    })).filter((unidad) => unidad.texto);
  }

  /** Lo que el diálogo de descargas necesita ANTES del clic (tamaños, calidades). */
  async function opcionesDescarga(video) {
    const movil = esMovil();
    const salida = {
      esMovil: movil,
      puedeGuardarEnDisco: typeof window.showSaveFilePicker === 'function' && !movil,
      mp3: { bytes: estimarBytesMp3(video.duracionS) },
      calidades: [],
    };
    if (video.plataforma === 'archivo') {
      salida.mp4 = { bytes: (Number(video.bytes) || 0) + estimarBytesVideo(BITRATE_AUDIO_DOBLADO, video.duracionS) };
      salida.archivoListo = ultimoArchivo?.clave === video.clave;
    }
    if (video.plataforma === 'x') {
      const info = await servicioX.info(video.url);
      salida.calidades = opcionesCalidadX(info.mp4, Number(info.duracion_s) || video.duracionS);
    }
    return salida;
  }

  /**
   * `tipo`: 'original' (MP4 de X) · 'mp3' (audio doblado) · 'mp4' (video de X doblado).
   * Se llama DIRECTO en el clic: `crearDestino` abre el selector de archivo y el
   * navegador solo lo permite durante el gesto. Cerrar el selector = `{ cancelado: true }`.
   */
  async function descargarDeBiblioteca(video, tipo, { calidad = null, signal = null, onProgreso = () => {} } = {}) {
    const esX = video?.plataforma === 'x';
    const esArchivo = video?.plataforma === 'archivo';
    if (tipo !== 'mp3' && !esX && !esArchivo) throw new Error('De YouTube solo se descarga el audio doblado.');
    if (esArchivo && tipo === 'original') throw new Error('El original ya está en tu equipo.');
    if (esArchivo && tipo === 'mp4' && ultimoArchivo?.clave !== video.clave) {
      throw new Error(`Para el video doblado elige primero el original («${video.nombreArchivo || video.titulo}»).`);
    }
    if (esX && tipo !== 'mp3' && !calidad?.url) throw new Error('Elige una calidad del video.');
    const bytesEstimados = tipo === 'mp3'
      ? estimarBytesMp3(video.duracionS)
      : (esArchivo ? Number(video.bytes) || 0 : calidad.bytes) + (tipo === 'mp4' ? estimarBytesVideo(BITRATE_AUDIO_DOBLADO, video.duracionS) : 0);
    const destino = await crearDestino({
      nombre: nombreArchivo({
        titulo: video.titulo, plataforma: video.plataforma,
        tipo: { original: 'original', mp3: 'audio', mp4: 'doblado' }[tipo], extension: tipo === 'mp3' ? 'mp3' : 'mp4',
      }),
      tipoMime: tipo === 'mp3' ? 'audio/mpeg' : 'video/mp4',
      bytesEstimados,
      esMovil: esMovil(),
    });
    if (!destino) return { cancelado: true };
    const conRespaldo = (resultado) => ({ ...resultado, guardarOtraVez: destino.guardarOtraVez || null });
    try {
      const archivos = await import('./exportadorDoblaje.js');
      if (tipo === 'original') return conRespaldo(await archivos.descargarOriginalX({ mp4Url: calidad.url, destino, signal, onProgreso }));
      const frases = await frasesParaArchivo(video, { signal, onProgreso });
      const sintetizar = (texto, opciones) => sintetizarArchivo(video, texto, opciones);
      if (tipo === 'mp3') {
        return conRespaldo(await archivos.exportarMp3({ frases, duracionVideoS: video.duracionS, sintetizar, destino, signal, onProgreso }));
      }
      return conRespaldo(await archivos.exportarMp4Doblado({
        ...(esArchivo ? { archivo: ultimoArchivo.archivo } : { mp4Url: calidad.url }),
        frases, sintetizar, destino, signal, onProgreso,
        volumenOriginal: Number(ui.volOriginal.value) / 100,
      }));
    } catch (error) {
      await destino.cancelar?.();
      throw error;
    }
  }

  // La vista vive en su propio módulo: se carga solo si el panel trae la sección.
  const raizBiblioteca = $('vidBiblioteca');
  if (raizBiblioteca) {
    import('./bibliotecaVista.js').then(({ montarBibliotecaVideos }) => {
      biblioteca = montarBibliotecaVideos(raizBiblioteca, {
        listarVideos, listarDoblajes, videosConVoz, actualizarVideo, quitarVideo, restaurarVideo, espacioYPersistencia,
        abrir: abrirDesdeBiblioteca, opcionesDescarga, descargar: descargarDeBiblioteca, elegirArchivoPara,
        servidorEnLinea: () => Boolean(estaServidorOnline()),
      });
    }).catch((error) => {
      console.error('[jg-biblioteca]', error);
      raizBiblioteca.hidden = true;   // sin biblioteca, el doblaje sigue igual
    });
  }

  ui.boton.addEventListener('click', () => {
    if (estaOcupado()) return;
    iniciarSesion().catch((error) => {
      console.error('[jg-youtube]', error);
      progreso.error('Algo falló al preparar el doblaje. Vuelve a intentarlo.');   // nunca en silencio
    });
  });

  // Diagnóstico de solo lectura (consola y pruebas): cómo va la sincronía de
  // la voz. No cambia nada; sirve para medir en un video real que ninguna
  // frase se corta ni se salta (tests/verificar_youtube_doblaje.mjs).
  window.jgDoblajeDiagnostico = () => {
    const motor = sesion?.motorVoz;
    if (!motor) return null;
    const unidad = sesion.servicioVoz?.unidades?.[motor.hablando];
    return {
      ...motor.metricas(),
      activo: motor.activo,
      hablando: motor.hablando,
      frase: unidad ? { desde: unidad.desde, hasta: unidad.hasta, inicio: unidad.startTime } : null,
      segmentoVoz: motor.indiceSegmentoVoz(),
    };
  };

  return { destruir: () => terminarSesion(), actualizarBoton };
}
