/**
 * Doblaje de YouTube al español: orquesta reproductor, texto, traducción y voz.
 *
 * Flujo (auditoría 2026-09-25): el reproductor primero (se ve el video y da título y
 * duración gratis) → texto en el idioma original → regla de idioma → preparación por
 * ventanas alrededor de lo que se ve → voz encendida por defecto. Una sola sesión viva;
 * «Cancelar» y «Cerrar» la detienen entera.
 */
import { TranscriptionService, extraerVideoId } from './transcriptionService.js';
import { TranslationService } from './translationService.js';
import { YouTubePlayer } from './YouTubePlayer.js';
import { SyncEngine } from './syncEngine.js';
import { TranscriptionDisplay } from './TranscriptionDisplay.js';
import { DubbingService, agruparPorTiempo } from './dubbingService.js';
import { DubbingEngine } from './dubbingEngine.js';
import { MotorPreparacion } from './motorPreparacion.js';
import { crearLimitador } from './limitador.js';
import { VOZ_INICIAL_S } from './planificador.js';
import { decidirDoblaje, nombreIdioma, IDIOMAS_DOBLABLES } from './idiomaOrigen.js';
import { leerDoblaje, guardarDoblaje } from './cacheDoblaje.js';

const CLAVE_VOL_VOZ = 'jg_yt_vol_voz';
const CLAVE_VOL_ORIGINAL = 'jg_yt_vol_original';
const ESPERA_REPRODUCTOR_MS = 8000;
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

export function inicializarYoutubeSincronizado({ fetchApi, traducirTexto, generarAudioEspanol, estaServidorOnline }) {
  const $ = (id) => document.getElementById(id);
  const ui = {
    boton: $('ytSyncBtn'), url: $('ytUrl'), idioma: $('ytLang'), area: $('ytSyncArea'), titulo: $('ytSyncTitle'),
    estado: $('ytSyncStatus'), cerrar: $('btnYtSyncClose'), velocidad: $('ytSyncRate'),
    botonVoz: $('ytDubbingBtn'), etiquetaVoz: $('ytDubbingLabel'), insignia: $('ytLangBadge'),
    caption: $('ytCaption'), toggleCaption: $('ytToggleCaption'),
    elegir: $('ytLangConfirm'), elegirTexto: $('ytLangConfirmText'), elegirSelect: $('ytIdiomaElegido'),
    elegirSi: $('ytLangConfirmYes'), elegirNo: $('ytLangConfirmNo'),
    volVoz: $('ytVolVoz'), volVozVal: $('ytVolVozVal'), volOriginal: $('ytVolOriginal'), volOriginalVal: $('ytVolOriginalVal'),
    metricas: $('ytSyncMetrics'), reproducir: $('ytDubReproducir'), buffer: $('ytBuffer'),
    tarjeta: $('ytDubProgreso'), barra: $('ytDubBarra'), mensaje: $('ytDubMensaje'), tiempo: $('ytDubTiempo'),
    ayuda: $('ytDubAyuda'), cancelar: $('ytDubCancelar'),
  };
  const display = new TranscriptionDisplay($('ytSyncDisplay'), ui.caption);
  const transcripciones = new TranscriptionService({ fetchApi });
  const traductor = new TranslationService({ traducirTexto });
  const audioDoblaje = new Audio();   // uno solo, desbloqueado en el primer toque
  let sesion = null;

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
  ui.toggleCaption.addEventListener('change', () => { ui.caption.hidden = !ui.toggleCaption.checked; });

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
    ui.boton.disabled = estaOcupado() || !extraerVideoId(ui.url.value) || !estaServidorOnline();
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
    ui.velocidad.disabled = true;
    mostrarIdioma('Idioma del video: por confirmar', 'analizando');
    display.definirSegmentos([], () => null);
    display.mostrarVoz('cargando');
    progreso.terminar();
  }

  /** Guarda traducciones y posición en la caché del video (H23). */
  function guardarSesion(actual) {
    if (!actual?.registro) return;
    actual.registro.traducciones = [...(actual.motor?.traducciones || [])];
    const posicion = actual.player?.getCurrentTime?.() || 0;
    if (posicion > 0) actual.registro.posicionS = posicion;
    guardarDoblaje(actual.registro);
  }

  /** Detiene TODO lo de la sesión (H7) y, si se pide, devuelve el formulario (H8). */
  function terminarSesion({ restaurarFormulario = true } = {}) {
    const actual = sesion;
    sesion = null;
    if (actual) {
      clearTimeout(actual.temporizadorCache);
      clearInterval(actual.relojCache);
      guardarSesion(actual);
      actual.controlador.abort();
      actual.motor?.detener();
      actual.motorVoz?.destruir();
      actual.servicioVoz?.liberar();
      actual.sync?.destruir();
      actual.player?.destruir();
    }
    marcarOcupado(false);
    reiniciarVista();
    if (restaurarFormulario) {
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

  function desbloquearAudio() {
    try {
      audioDoblaje.src = SILENCIO_WAV;
      const intento = audioDoblaje.play();
      if (intento?.then) intento.then(() => { if (audioDoblaje.src === SILENCIO_WAV) audioDoblaje.pause(); }).catch(() => {});
    } catch (_) { /* si no se pudo, «Ver con voz en español» lo hace con su propio toque */ }
  }

  async function crearReproductor(videoId, signal) {
    recrearDestino();
    const player = new YouTubePlayer('ytPlayer', videoId);
    const listo = player.inicializar().then(() => true).catch(() => false);
    const tardo = new Promise((resolver) => setTimeout(() => resolver(false), ESPERA_REPRODUCTOR_MS));
    await Promise.race([listo, tardo]);
    if (signal.aborted) { player.destruir(); throw cancelado(); }
    return player;   // si tardó, se sigue: puede terminar de cargar después
  }

  function configurarVelocidades(player) {
    const tasas = player.getAvailablePlaybackRates();
    ui.velocidad.replaceChildren(...tasas.map((tasa) => {
      const opcion = document.createElement('option');
      opcion.value = String(tasa);
      opcion.textContent = `${tasa}x`;
      return opcion;
    }));
    ui.velocidad.value = String(player.getPlaybackRate());
    ui.velocidad.disabled = false;
    ui.velocidad.onchange = () => player.setPlaybackRate(ui.velocidad.value);
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
    ui.buffer.textContent = fallidos ? `${voz} · ${fallidos} tramos sonarán en su idioma original` : voz;
  }

  /** Preparación por ventanas (H3): lo de ahora primero; el resto, mientras se ve. */
  async function prepararDoblaje(actual, { datos, origen, tituloVideo, signal, traduccionesGuardadas = [] }) {
    const { player } = actual;
    const limitador = crearLimitador();
    const servicioVoz = new DubbingService({ generarAudio: (texto) => generarAudioEspanol(texto, { signal }), limitador });
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
      player, servicio: servicioVoz, crearAudio: () => audioDoblaje,
      onStatus: (mensaje, tipo) => { ui.estado.textContent = mensaje; display.mostrarVoz(tipo); },
      onMetricas: (metricas) => { actual.metricas = metricas; },   // solo diagnóstico (H28)
      onFin: () => { ui.estado.textContent = 'El video terminó.'; display.mostrarVoz('fin'); },
    });
    actual.motorVoz.definirVolumenVoz(Number(ui.volVoz.value) / 100);
    actual.motorVoz.definirVolumenFondo(Number(ui.volOriginal.value));
    actual.sync = new SyncEngine({
      player, segmentos: datos.segmentos,
      onSegmentChange: (indice) => display.mostrar(indice),
      onPlaybackRateChange: (velocidad) => { display.mostrarVelocidad(velocidad); ui.velocidad.value = String(velocidad); },
    });
    actual.sync.iniciar();
    configurarVelocidades(player);

    progreso.terminar();
    ui.botonVoz.disabled = false;
    // La voz queda encendida por defecto: si la persona ya le dio play, entra sola.
    actual.motorVoz.activar();
    ponerEstadoBotonVoz(true);
    display.mostrarVoz('activo');
    ui.reproducir.hidden = player.getPlayerState() === 1;
    if (!ui.reproducir.hidden) ui.reproducir.focus({ preventScroll: true });
    ui.estado.textContent = 'Listo. El resto del doblaje se prepara mientras ves el video.';
    pintarBuffer(actual);
    actual.relojCache = setInterval(() => guardarSesion(actual), 5000);
  }

  async function iniciarSesion() {
    const url = ui.url.value.trim();
    const videoId = extraerVideoId(url);
    if (!videoId || !estaServidorOnline()) return;
    terminarSesion({ restaurarFormulario: false });
    const controlador = new AbortController();
    const { signal } = controlador;
    const actual = { controlador, videoId };
    sesion = actual;
    marcarOcupado(true);
    ui.area.hidden = false;
    document.querySelector('.yt-area')?.classList.add('has-results', 'modo-doblaje');
    progreso.iniciar();
    ui.area.scrollIntoView({ block: 'start', behavior: 'smooth' });
    desbloquearAudio();
    try {
      actual.player = await crearReproductor(videoId, signal);
      const tituloVideo = actual.player.getVideoData()?.title || '';
      const duracionS = actual.player.getDuration() || 0;
      if (tituloVideo) ui.titulo.textContent = tituloVideo;
      if (duracionS > 1800) progreso.ayuda('Video largo: la primera vez puede tardar unos 30 s en leerse. Puedes darle play mientras tanto.');

      const guardado = await leerDoblaje(videoId);
      const elegidoEnFormulario = ui.idioma?.value || 'auto';
      const sirve = Boolean(guardado?.segmentos?.length)
        && (elegidoEnFormulario === 'auto' || elegidoEnFormulario === guardado.idiomaOrigen);
      let datos;
      let decision;
      if (sirve) {
        datos = { segmentos: guardado.segmentos, idioma: guardado.idiomaOrigen, confianza: 1, fuente: 'usuario', conflicto: false };
        decision = { accion: 'doblar', idioma: guardado.idiomaOrigen, mensaje: '' };
      } else {
        datos = await pedirTexto(url, { idiomaOrigen: elegidoEnFormulario, tituloVideo, duracionS, signal });
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
      actual.registro = {
        videoId,
        idiomaOrigen: decision.idioma,
        titulo: tituloVideo,
        duracionS,
        segmentos: datos.segmentos,
        traducciones: sirve ? guardado.traducciones : [],
        posicionS: sirve ? guardado.posicionS : 0,
      };
      guardarDoblaje(actual.registro);
      if (sirve && 15 < guardado.posicionS && guardado.posicionS < duracionS - 30) {
        actual.retomarEn = guardado.posicionS;
        ui.estado.textContent = `Retomamos donde ibas (${formatoTiempo(actual.retomarEn)}).`;
        $('ytDesdeInicio').hidden = false;
      }
      await prepararDoblaje(actual, {
        datos, origen: decision.idioma, tituloVideo, signal,
        traduccionesGuardadas: actual.registro.traducciones,
      });
    } catch (error) {
      if (signal.aborted || error?.name === 'AbortError') return;
      mostrarIdioma('No se pudo preparar el doblaje', 'no');
      progreso.error(textoDeError(error));
    } finally {
      if (sesion === actual) marcarOcupado(false);
    }
  }

  ui.boton.addEventListener('click', () => {
    if (estaOcupado()) return;
    iniciarSesion().catch((error) => {
      console.error('[jg-youtube]', error);
      progreso.error('Algo falló al preparar el doblaje. Vuelve a intentarlo.');   // nunca en silencio
    });
  });

  return { destruir: () => terminarSesion(), actualizarBoton };
}
