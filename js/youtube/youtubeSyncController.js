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
import { SyncEngine, normalizarTasa } from './syncEngine.js';
import { TranscriptionDisplay } from './TranscriptionDisplay.js';
import { DubbingService, agruparPorTiempo } from './dubbingService.js';
import { DubbingEngine } from './dubbingEngine.js';
import { MotorPreparacion } from './motorPreparacion.js';
import { crearLimitador } from './limitador.js';
import { VOZ_INICIAL_S } from './planificador.js';
import { decidirDoblaje, nombreIdioma, IDIOMAS_DOBLABLES } from './idiomaOrigen.js';
import { leerDoblaje, guardarDoblaje } from './cacheDoblaje.js';
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
    tarjeta: $('ytDubProgreso'), barra: $('ytDubBarra'), mensaje: $('ytDubMensaje'), tiempo: $('ytDubTiempo'),
    ayuda: $('ytDubAyuda'), cancelar: $('ytDubCancelar'),
  };
  const display = new TranscriptionDisplay($('ytSyncDisplay'), ui.caption);
  const transcripciones = new TranscriptionService({ fetchApi });
  // Ritmo de Mistral gratis (≈1 petición/s) para TODA llamada del traductor:
  // lotes, mitades de un lote partido y el texto completo.
  const traductor = new TranslationService({ traducirTexto, intervaloMinMs: 1100 });
  // Doble audio alternado (sin micro-cortes entre frases): los dos se crean y
  // desbloquean dentro del primer toque (iOS solo deja desbloquear en gesto).
  const audioDoblaje = new Audio();
  const audioDoblaje2 = new Audio();
  let audiosEntregados = 0;
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
      resolverVocesSesion(sesion);
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
    if (ui.voz2Wrap) ui.voz2Wrap.hidden = true;
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
    const limitador = crearLimitador();
    const servicioVoz = new DubbingService({
      // Cada frase suena con su hablante: monólogo = 1 voz, diálogo = 2.
      generarAudio: (texto, unidad) => generarAudioEspanol(texto, {
        voz: vozParaUnidad(unidad, { vozPrincipal: actual.voz, vozSecundaria: actual.vozSecundaria }),
        signal,
      }),
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
    ui.estado.textContent = 'Listo. El resto del doblaje se prepara mientras ves el video.';
    pintarBuffer(actual);
    actual.relojCache = setInterval(() => guardarSesion(actual), 5000);
  }

  /** Lo común al abrir cualquier video (YouTube o X): corta la sesión anterior y prepara la vista. */
  function abrirSesion(videoId) {
    terminarSesion({ restaurarFormulario: false });
    const controlador = new AbortController();
    const actual = { controlador, videoId };
    sesion = actual;
    marcarOcupado(true);
    ui.area.hidden = false;
    document.querySelector('.yt-area')?.classList.add('has-results', 'modo-doblaje');
    progreso.iniciar();
    ui.area.scrollIntoView({ block: 'start', behavior: 'smooth' });
    audiosEntregados = 0;
    desbloquearAudio();
    // La primera síntesis paga el arranque del servicio de voz (2-4 s medidos):
    // se paga ahora, mientras se lee el video, y no cuando la persona espera oírla.
    Promise.resolve().then(() => fetchApi('/tts-warmup', { signal: controlador.signal }, 15000)).catch(() => {});
    return actual;
  }

  /** Lo común con el idioma ya decidido: caché del video, «retomar donde ibas» y preparación. */
  async function completarSesion(actual, { decision, datos, tituloVideo, duracionS, guardado, sirve }) {
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
    if (sirve && 15 < guardado.posicionS && guardado.posicionS < duracionS - 30) {
      actual.retomarEn = guardado.posicionS;
      ui.estado.textContent = `Retomamos donde ibas (${formatoTiempo(actual.retomarEn)}).`;
      $('ytDesdeInicio').hidden = false;
    }
    await prepararDoblaje(actual, {
      datos, origen: decision.idioma, tituloVideo, signal,
      traduccionesGuardadas: actual.registro.traducciones,
    });
  }

  async function iniciarSesion() {
    const url = ui.url.value.trim();
    const videoId = extraerVideoId(url);
    if (!videoId || !estaServidorOnline()) return;
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
      await completarSesion(actual, { decision, datos, tituloVideo, duracionS, guardado, sirve });
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
