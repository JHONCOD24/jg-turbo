import { TranscriptionService, extraerVideoId, nombreIdioma } from './transcriptionService.js';
import { TranslationService } from './translationService.js';
import { YouTubePlayer } from './YouTubePlayer.js';
import { SyncEngine } from './syncEngine.js';
import { TranscriptionDisplay } from './TranscriptionDisplay.js';
import { DubbingService } from './dubbingService.js';
import { DubbingEngine } from './dubbingEngine.js';

// Segundos de video con voz ya generada antes de dejar pulsar «Reproducir».
// Arrancar con poco y seguir llenando por detrás es mejor que hacer esperar:
// el generador de voz tarda entre 1 y 41 s por fragmento, así que esperar el
// video entero podría ser minutos.
const COLCHON_ARRANQUE_S = 25;
const COLCHON_OBJETIVO_S = 120;

const CLAVE_VOL_VOZ = 'jg_yt_vol_voz';
const CLAVE_VOL_ORIGINAL = 'jg_yt_vol_original';

function leerNumero(clave, porDefecto) {
  // Ojo: `Number(null)` es 0, así que sin comprobar la ausencia primero, la
  // primera visita arrancaba con el volumen en cero y no se oía nada.
  const crudo = localStorage.getItem(clave);
  if (crudo === null || crudo === '') return porDefecto;
  const guardado = Number(crudo);
  return Number.isFinite(guardado) && guardado >= 0 ? guardado : porDefecto;
}

export function inicializarYoutubeSincronizado({
  fetchApi,
  traducirTexto,
  generarAudioEspanol,
  estaServidorOnline,
}) {
  const boton = document.getElementById('ytSyncBtn');
  const urlInput = document.getElementById('ytUrl');
  const area = document.getElementById('ytSyncArea');
  const estado = document.getElementById('ytSyncStatus');
  const cerrar = document.getElementById('btnYtSyncClose');
  const selectorVelocidad = document.getElementById('ytSyncRate');
  const botonVoz = document.getElementById('ytDubbingBtn');
  const etiquetaVoz = document.getElementById('ytDubbingLabel');
  const insigniaIdioma = document.getElementById('ytLangBadge');
  const caption = document.getElementById('ytCaption');
  const toggleCaption = document.getElementById('ytToggleCaption');
  const confirmacion = document.getElementById('ytLangConfirm');
  const confirmacionTexto = document.getElementById('ytLangConfirmText');
  const confirmacionSi = document.getElementById('ytLangConfirmYes');
  const confirmacionNo = document.getElementById('ytLangConfirmNo');
  const volVoz = document.getElementById('ytVolVoz');
  const volVozVal = document.getElementById('ytVolVozVal');
  const volOriginal = document.getElementById('ytVolOriginal');
  const volOriginalVal = document.getElementById('ytVolOriginalVal');
  const metricas = document.getElementById('ytSyncMetrics');
  const panelTranscripcion = document.getElementById('ytTranscriptPanel');
  const display = new TranscriptionDisplay(document.getElementById('ytSyncDisplay'), caption);
  const transcriptionService = new TranscriptionService({ fetchApi });
  const translationService = new TranslationService({ traducirTexto });
  let player = null;
  let motor = null;
  let servicioVoz = null;
  let motorVoz = null;

  volVoz.value = String(leerNumero(CLAVE_VOL_VOZ, 100));
  volOriginal.value = String(leerNumero(CLAVE_VOL_ORIGINAL, 12));

  const pintarVolumenes = () => {
    volVozVal.textContent = `${volVoz.value} %`;
    volOriginalVal.textContent = `${volOriginal.value} %`;
  };
  pintarVolumenes();

  volVoz.addEventListener('input', () => {
    pintarVolumenes();
    localStorage.setItem(CLAVE_VOL_VOZ, volVoz.value);
    motorVoz?.definirVolumenVoz(Number(volVoz.value) / 100);
  });
  volOriginal.addEventListener('input', () => {
    pintarVolumenes();
    localStorage.setItem(CLAVE_VOL_ORIGINAL, volOriginal.value);
    motorVoz?.definirVolumenFondo(Number(volOriginal.value));
  });

  toggleCaption.addEventListener('change', () => {
    caption.hidden = !toggleCaption.checked;
  });

  const mostrarIdioma = (texto, tipo) => {
    insigniaIdioma.textContent = texto;
    insigniaIdioma.dataset.estado = tipo;
  };

  /** Panel de confirmación cuando el idioma no es seguro. Devuelve true/false. */
  const pedirConfirmacion = (veredicto) => new Promise((resolver) => {
    confirmacionTexto.textContent =
      `${veredicto.mensaje} Puedes doblarlo igual, pero la traducción podría no tener sentido.`;
    confirmacion.hidden = false;
    confirmacionSi.focus();
    const responder = (respuesta) => {
      confirmacion.hidden = true;
      confirmacionSi.removeEventListener('click', aceptar);
      confirmacionNo.removeEventListener('click', rechazar);
      resolver(respuesta);
    };
    const aceptar = () => responder(true);
    const rechazar = () => responder(false);
    confirmacionSi.addEventListener('click', aceptar);
    confirmacionNo.addEventListener('click', rechazar);
  });

  /** Crea el reproductor una sola vez por video. */
  const asegurarPlayer = async (videoId) => {
    if (!player) player = await new YouTubePlayer('ytPlayer', videoId).inicializar();
    return player;
  };

  /**
   * Espera a que el módulo de subtítulos del reproductor publique sus pistas.
   * Tarda un poco en cargar y a veces no aparece nunca: si no llega en ~2,4 s
   * se sigue sin ella, porque es una mejora de la detección, no un requisito.
   */
  const leerPistasConEspera = async (intentos = 8, esperaMs = 300) => {
    for (let i = 0; i < intentos; i += 1) {
      const pista = player?.idiomaSegunPistas?.();
      if (pista?.idioma) return pista;
      await new Promise((resolver) => setTimeout(resolver, esperaMs));
    }
    return null;
  };

  const recrearDestino = () => {
    const contenedor = area.querySelector('.yt-player-shell');
    // Solo se reemplaza el iframe: el subtítulo sobre el video vive aquí y debe
    // sobrevivir a cada reinicio del reproductor.
    contenedor.querySelector('#ytPlayer')?.remove();
    const destino = document.createElement('div');
    destino.id = 'ytPlayer';
    contenedor.prepend(destino);
  };

  const ponerEstadoBotonVoz = (activo) => {
    botonVoz.setAttribute('aria-pressed', activo ? 'true' : 'false');
    etiquetaVoz.textContent = activo ? 'Volver al audio original' : 'Escuchar en español';
  };

  const limpiarReproductor = () => {
    motorVoz?.destruir();
    servicioVoz?.liberar();
    motor?.destruir();
    player?.destruir();
    motorVoz = null;
    servicioVoz = null;
    motor = null;
    player = null;
    botonVoz.disabled = true;
    botonVoz.setAttribute('aria-pressed', 'false');
    etiquetaVoz.textContent = 'Preparando voz en español…';
    confirmacion.hidden = true;
    metricas.hidden = true;
    caption.textContent = '';
    mostrarIdioma('Analizando el idioma del audio…', 'analizando');
    display.mostrarVoz('cargando');
    recrearDestino();
  };

  const actualizarBoton = () => {
    boton.disabled = !extraerVideoId(urlInput.value) || !estaServidorOnline();
  };
  urlInput.addEventListener('input', actualizarBoton);
  window.addEventListener('jg:server-status', actualizarBoton);
  actualizarBoton();

  cerrar.addEventListener('click', () => {
    limpiarReproductor();
    area.hidden = true;
  });

  botonVoz.addEventListener('click', () => {
    if (!motorVoz || botonVoz.disabled) return;
    if (motorVoz.activo) {
      motorVoz.desactivar();
      ponerEstadoBotonVoz(false);
      display.mostrarVoz('inactivo');
      return;
    }
    motorVoz.definirVolumenVoz(Number(volVoz.value) / 100);
    motorVoz.definirVolumenFondo(Number(volOriginal.value));
    motorVoz.activarYReproducir();
    ponerEstadoBotonVoz(true);
    display.mostrarVoz('activo');
  });

  boton.addEventListener('click', async () => {
    const url = urlInput.value.trim();
    if (!extraerVideoId(url) || !estaServidorOnline()) return;
    limpiarReproductor();
    area.hidden = false;
    document.querySelector('.yt-area')?.classList.add('has-results');
    boton.disabled = true;
    boton.setAttribute('aria-busy', 'true');
    const textoOriginalBoton = boton.textContent;
    boton.textContent = 'Preparando el doblaje…';
    selectorVelocidad.disabled = true;
    botonVoz.disabled = true;
    estado.textContent = 'Analizando el audio del video…';
    display.definirSegmentos([]);

    try {
      const videoId = extraerVideoId(url);
      const transcripcion = await transcriptionService.obtenerParaDoblaje(url, {
        onProgress: (mensaje) => { estado.textContent = mensaje; },
        apiKey: localStorage.getItem('jg_groq_api_key') || '',
        context: localStorage.getItem('jg_glossary') || '',
        confirmar: pedirConfirmacion,
        // El reproductor se crea antes de decidir: sus pistas dicen el idioma
        // del audio, y el servidor no puede conseguir ese dato desde Vercel.
        pistaNavegador: async () => {
          estado.textContent = 'Comprobando el idioma del audio en el reproductor…';
          await asegurarPlayer(videoId);
          return leerPistasConEspera();
        },
      });
      const veredicto = transcripcion.veredictoIdioma;
      mostrarIdioma(
        veredicto.decision === 'aceptar'
          ? `Audio en inglés confirmado (${veredicto.porcentaje} % de certeza)`
          : `Idioma sin confirmar (${nombreIdioma(veredicto.idioma)}, ${veredicto.porcentaje} %) — doblaje forzado por ti`,
        veredicto.decision === 'aceptar' ? 'ok' : 'duda',
      );

      estado.textContent = 'Traduciendo al español…';
      const segmentos = await translationService.traducirSegmentos(transcripcion.segments, {
        onProgress: (hechos, total) => {
          estado.textContent = total
            ? `Traduciendo al español: ${hechos} de ${total} frases.`
            : 'Preparando la traducción…';
        },
      });
      display.definirSegmentos(segmentos);

      const textoCompleto = segmentos.map((segmento) => segmento.text).join(' ').trim();
      const salida = document.getElementById('ytOutput');
      salida.value = textoCompleto;
      salida.dispatchEvent(new Event('input'));
      document.getElementById('ytResultArea').style.display = 'block';
      document.getElementById('ytCount').textContent =
        `${textoCompleto.split(/\s+/).filter(Boolean).length} palabras · traducción fiel sincronizada`;

      await asegurarPlayer(videoId);
      const tasas = player.getAvailablePlaybackRates();
      selectorVelocidad.replaceChildren(...tasas.map((tasa) => {
        const opcion = document.createElement('option');
        opcion.value = String(tasa);
        opcion.textContent = `${tasa}x`;
        return opcion;
      }));
      selectorVelocidad.value = String(player.getPlaybackRate());
      selectorVelocidad.disabled = false;
      selectorVelocidad.onchange = () => player?.setPlaybackRate(selectorVelocidad.value);

      motor = new SyncEngine({
        player,
        segmentos,
        onSegmentChange: (indice) => display.mostrar(indice),
        onPlaybackRateChange: (velocidad) => {
          display.mostrarVelocidad(velocidad);
          selectorVelocidad.value = String(velocidad);
        },
      });
      motor.iniciar();

      const fallidos = segmentos.filter((segmento) => segmento.translationError).length;
      servicioVoz = new DubbingService({
        generarAudio: generarAudioEspanol,
        onProgress: (hechos, total) => {
          if (!motorVoz?.activo) {
            estado.textContent = `Generando la voz en español: ${hechos} de ${total} frases.`;
          }
        },
      });
      const unidades = servicioVoz.definirSegmentos(segmentos);
      if (!unidades.length) throw new Error('No hay frases válidas para generar la voz.');

      estado.textContent = 'Generando los primeros segundos de voz…';
      await servicioVoz.asegurarColchon(0, COLCHON_ARRANQUE_S, 3);
      const servicioActual = servicioVoz;
      motorVoz = new DubbingEngine({
        player,
        servicio: servicioVoz,
        colchonSegundos: COLCHON_OBJETIVO_S,
        onStatus: (mensaje, tipo) => {
          estado.textContent = mensaje;
          display.mostrarVoz(tipo);
        },
        onMetricas: (datos) => {
          metricas.hidden = false;
          metricas.textContent =
            `Sincronía medida: desfase típico ${datos.promedioMs} ms · p95 ${datos.p95Ms} ms · `
            + `${Math.round(datos.dentroObjetivo * 100)} % dentro del objetivo de 150 ms.`;
        },
      });
      motorVoz.definirVolumenVoz(Number(volVoz.value) / 100);
      motorVoz.definirVolumenFondo(Number(volOriginal.value));

      botonVoz.disabled = false;
      ponerEstadoBotonVoz(false);
      display.mostrarVoz('lista');
      const listos = Math.round(servicioActual.segundosListosDesde(0));
      estado.textContent = fallidos
        ? `Listo para escuchar. ${fallidos} frases conservaron el inglés por un fallo de traducción.`
        : `Listo para escuchar: ${listos} s de voz preparados; el resto se genera mientras ves el video.`;

      // El colchón sigue creciendo por detrás; si la reproducción lo alcanza, el
      // motor deja sonar el audio original en vez de congelar el video.
      servicioActual.asegurarColchon(0, COLCHON_OBJETIVO_S, 3)
        .then(() => servicioActual.precargarResto(0, 2))
        .then(() => {
          if (!motorVoz?.activo && servicioVoz === servicioActual && !servicioActual.destruido) {
            const fallosVoz = servicioActual.unidades.filter((u) => u.estado === 'error').length;
            estado.textContent = fallosVoz
              ? `Voz preparada parcialmente: ${fallosVoz} frases no pudieron generarse.`
              : 'Toda la voz en español está preparada.';
            display.mostrarVoz(fallosVoz ? 'error' : 'lista');
          }
        })
        .catch(() => {});
    } catch (error) {
      const mensaje = String(error?.message || error);
      limpiarReproductor();
      if (error?.idiomaDetectado || error?.cancelado) {
        mostrarIdioma(
          error.idiomaDetectado
            ? `Audio en ${nombreIdioma(error.idiomaDetectado)}: sin doblaje`
            : 'Idioma del audio sin confirmar',
          'no',
        );
      }
      estado.textContent = mensaje;
    } finally {
      boton.removeAttribute('aria-busy');
      boton.textContent = textoOriginalBoton;
      actualizarBoton();
    }
  });

  return { destruir: limpiarReproductor, actualizarBoton, panelTranscripcion };
}
