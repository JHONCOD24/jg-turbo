const boton = document.getElementById('diagnosticar');
const copiar = document.getElementById('copiar');
const estado = document.getElementById('estado');
const resultado = document.getElementById('resultado');
let diagnostico = null;

async function pestanaClase() {
  const tabId = Number(new URLSearchParams(globalThis.location.search).get('tab'));
  const tab = Number.isInteger(tabId) && tabId > 0
    ? await chrome.tabs.get(tabId)
    : (await chrome.tabs.query({ active: true, currentWindow: true }))[0];
  if (!tab?.id || !/^https:\/\/www\.udemy\.com\/course\/[^/]+\/learn\//.test(tab.url || '')) {
    throw new Error('Abre una clase de Udemy en esta ventana.');
  }
  return tab;
}

boton.addEventListener('click', async () => {
  boton.disabled = true;
  copiar.disabled = true;
  estado.textContent = 'Revisando las pistas durante dos segundos…';
  resultado.textContent = '';
  try {
    const tab = await pestanaClase();
    const [clase, vtt] = await Promise.all([
      chrome.tabs.sendMessage(tab.id, { tipo: 'diagnosticarClase' }),
      chrome.runtime.sendMessage({ tipo: 'vttObservado', tabId: tab.id }),
    ]);
    if (clase?.error) throw new Error(clase.error);
    diagnostico = { ...clase, vttObservado: vtt };
    resultado.textContent = JSON.stringify(diagnostico, null, 2);
    copiar.disabled = false;
    estado.textContent = 'Diagnóstico listo. Puedes copiarlo para compartir el resultado.';
  } catch (error) {
    diagnostico = null;
    estado.textContent = `No se pudo revisar la clase: ${error.message}`;
  } finally {
    boton.disabled = false;
  }
});

copiar.addEventListener('click', async () => {
  if (!diagnostico) return;
  try {
    await navigator.clipboard.writeText(JSON.stringify(diagnostico, null, 2));
    estado.textContent = 'Diagnóstico copiado.';
  } catch {
    estado.textContent = 'No se pudo copiar. Selecciona el resultado y cópialo manualmente.';
  }
});
import { ReproductorRemoto } from './lib/reproductorRemoto.js';
import { leerVtt } from './lib/vtt.js';
import { crearApi } from './lib/api.js';
import { leerPreferencias, guardarPreferencias } from './lib/preferencias.js';
import { normalizarSegmentos } from './motor/transcriptionService.js';
import { TranslationService } from './motor/translationService.js';
import { crearLimitador } from './motor/limitador.js';
import { DubbingService, agruparPorTiempo } from './motor/dubbingService.js';
import { MotorPreparacion } from './motor/motorPreparacion.js';
import { DubbingEngine } from './motor/dubbingEngine.js';
import { SyncEngine } from './motor/syncEngine.js';
import { VOZ_INICIAL_S } from './motor/planificador.js';
import { medirHabla } from './motor/hablaVoz.js';


const ui = Object.fromEntries(['doblar', 'detener', 'voz', 'acento', 'volVoz', 'volOriginal', 'ritmoAuto', 'subtitulo', 'autoSiguiente', 'progreso', 'clase', 'anterior', 'actual', 'siguiente', 'valorVoz', 'valorOriginal'].map((id) => [id, document.getElementById(id)]));
const api = crearApi();
let preferencias;
let puerto, player, sesion = null, titulo = '', esperandoClase = false, solicitud = 0;
let velocidadPedida = null;

function pintarPreferencias() {
  for (const clave of ['voz', 'acento', 'volVoz', 'volOriginal']) ui[clave].value = preferencias[clave];
  for (const clave of ['ritmoAuto', 'subtitulo', 'autoSiguiente']) ui[clave].checked = preferencias[clave];
  ui.valorVoz.value = `${preferencias.volVoz} %`;
  ui.valorOriginal.value = `${preferencias.volOriginal} %`;
}

function enviar(mensaje) { if (player?.conectado) puerto.postMessage(mensaje); }

function pintarLineas(actual, indice) {
  if (actual !== sesion) return;
  actual.indice = indice;
  const texto = (i) => actual.motor?.traducciones.get(i) || '';
  ui.anterior.textContent = texto(indice - 1);
  ui.actual.textContent = texto(indice);
  ui.siguiente.textContent = texto(indice + 1);
  enviar({ tipo: 'subtitulo', texto: preferencias.subtitulo ? texto(indice) : '' });
}

function detener(mensaje = 'Doblaje apagado.') {
  const actual = sesion;
  sesion = null;
  esperandoClase = false;
  velocidadPedida = null;
  actual?.controlador.abort();
  clearTimeout(actual?.tope);
  actual?.motor?.detener();
  actual?.sync?.destruir();
  actual?.voz?.destruir();
  actual?.servicio?.liberar();
  for (const audio of actual?.audios || []) { audio.pause(); audio.removeAttribute('src'); audio.load(); }
  enviar({ tipo: 'restaurar' });
  enviar({ tipo: 'subtitulo', texto: '' });
  ui.doblar.disabled = !player?.conectado;
  ui.detener.disabled = true;
  ui.progreso.hidden = true;
  for (const clave of ['anterior', 'actual', 'siguiente']) ui[clave].textContent = '';
  if (mensaje) estado.textContent = mensaje;
}

function pedirSubtitulos(signal) {
  return new Promise((resolver, rechazar) => {
    const numero = ++solicitud;
    const limpiar = () => { clearTimeout(tope); puerto.onMessage.removeListener(atender); signal.removeEventListener('abort', cancelar); };
    const cancelar = () => { limpiar(); rechazar(new DOMException('Cancelado', 'AbortError')); };
    const atender = (mensaje) => { if (mensaje.tipo === 'subtitulos' && mensaje.solicitud === numero) { limpiar(); resolver(mensaje); } };
    const tope = setTimeout(() => { limpiar(); rechazar(new Error('No llegaron los subtítulos. Recarga la clase y activa CC en inglés.')); }, 12000);
    puerto.onMessage.addListener(atender);
    signal.addEventListener('abort', cancelar, { once: true });
    enviar({ tipo: 'leerSubtitulos', solicitud: numero });
  });
}

async function desbloquear(audios) {
  const bytes = new Uint8Array(844), vista = new DataView(bytes.buffer);
  const texto = (desde, valor) => [...valor].forEach((letra, i) => { bytes[desde + i] = letra.charCodeAt(0); });
  texto(0, 'RIFF'); vista.setUint32(4, 836, true); texto(8, 'WAVEfmt '); vista.setUint32(16, 16, true);
  vista.setUint16(20, 1, true); vista.setUint16(22, 1, true); vista.setUint32(24, 8000, true);
  vista.setUint32(28, 8000, true); vista.setUint16(32, 1, true); vista.setUint16(34, 8, true);
  texto(36, 'data'); vista.setUint32(40, 800, true); bytes.fill(128, 44);
  const url = URL.createObjectURL(new Blob([bytes], { type: 'audio/wav' }));
  try {
    await Promise.all(audios.map(async (audio) => { audio.src = url; audio.volume = 0; await audio.play(); audio.pause(); audio.removeAttribute('src'); audio.load(); }));
  } finally { URL.revokeObjectURL(url); }
}

async function iniciar() {
  if (!player?.conectado || sesion) return;
  const actual = { controlador: new AbortController(), audios: [new Audio(), new Audio()], indice: -1, metricas: null };
  sesion = actual;
  ui.doblar.disabled = true; ui.detener.disabled = false; ui.progreso.hidden = false; ui.progreso.value = 0;
  estado.textContent = 'Revisando los subtítulos en inglés…';
  const { signal } = actual.controlador;
  actual.tope = setTimeout(() => { if (sesion === actual) detener('La preparación tardó demasiado. Revisa la conexión e intenta de nuevo.'); }, 120000);
  try {
    await desbloquear(actual.audios);
    const datos = await pedirSubtitulos(signal);
    if (signal.aborted) return;
    if (datos.error) {
      const mensaje = datos.error === 'sin_ingles' ? 'Activa una vez los subtítulos en inglés (botón CC de Udemy) y vuelve a pulsar Doblar.'
        : datos.error === 'recargar_clase' ? 'Recarga la clase, activa CC en inglés y vuelve a pulsar Doblar.' : datos.error;
      throw new Error(mensaje);
    }
    if (datos.idioma !== 'en') throw new Error('Esta clase no está en inglés.');
    actual.segmentos = datos.textoVtt ? leerVtt(datos.textoVtt) : normalizarSegmentos(datos.segmentos);
    if (!actual.segmentos.length) throw new Error('La pista está vacía. Activa CC en inglés y recarga la clase.');
    api.calentar();
    const limitador = crearLimitador();
    const traductor = new TranslationService({ traducirTexto: api.traducirTexto, intervaloMinMs: 1100 });
    actual.servicio = new DubbingService({ limitador, generarAudio: async (texto) => {
      try {
        const voz = await api.generarAudio(texto, { voz: preferencias.voz, acento: preferencias.acento, signal });
        return { ...voz, habla: await medirHabla(voz.blob) };
      } catch (error) { if (!signal.aborted) estado.textContent = `La voz no se pudo preparar: ${error.message}`; throw error; }
    } });
    actual.servicio.definirUnidades(agruparPorTiempo(actual.segmentos));
    actual.motor = new MotorPreparacion({ segmentos: actual.segmentos, servicioVoz: actual.servicio, traductor,
      posicion: () => player.getCurrentTime(), origen: 'en', tituloVideo: titulo, limitadorVoz: limitador, signal,
      onCambio: (evento) => { if (sesion === actual && evento.mensaje) estado.textContent = evento.mensaje; },
      onTraduccion: () => pintarLineas(actual, actual.indice),
    });
    actual.motor.iniciar();
    estado.textContent = 'Traduciendo el comienzo al español…';
    await actual.motor.esperarArranque({ vozInicialS: VOZ_INICIAL_S, onProgreso: (resumen) => {
      if (sesion !== actual) return;
      ui.progreso.value = Math.min(1, resumen.vozHastaS / VOZ_INICIAL_S);
      if (resumen.traducidoHastaS >= VOZ_INICIAL_S && !resumen.errores.voz) estado.textContent = 'La voz se está preparando…';
    } });
    if (signal.aborted) return;
    clearTimeout(actual.tope);
    let entregados = 0;
    actual.voz = new DubbingEngine({ player, servicio: actual.servicio, crearAudio: () => actual.audios[entregados++],
      ritmoAutomatico: preferencias.ritmoAuto,
      onStatus: (mensaje) => { if (sesion === actual && !actual.ritmoRechazado) estado.textContent = mensaje; },
      onMetricas: (metricas) => { actual.metricas = metricas; },
      onFin: () => { if (sesion === actual) estado.textContent = 'La clase terminó.'; },
    });
    actual.voz.definirVolumenVoz(preferencias.volVoz / 100);
    actual.voz.definirVolumenFondo(preferencias.volOriginal);
    actual.sync = new SyncEngine({ player, segmentos: actual.segmentos, indiceExterno: () => actual.voz.indiceSegmentoVoz(),
      onSegmentChange: (indice) => pintarLineas(actual, indice) });
    actual.sync.iniciar(); actual.voz.activar();
    ui.progreso.hidden = true;
    estado.textContent = player.getPlayerState() === 1 ? 'Listo. Voz en español activa.' : 'Listo. Dale play a la clase en Udemy.';
  } catch (error) { if (sesion === actual) detener(signal.aborted ? 'Doblaje apagado.' : error.message); }
}

ui.doblar.addEventListener('click', iniciar);
ui.detener.addEventListener('click', () => detener());
for (const clave of ['voz', 'acento', 'volVoz', 'volOriginal', 'ritmoAuto', 'subtitulo', 'autoSiguiente']) {
  ui[clave].addEventListener(['volVoz', 'volOriginal'].includes(clave) ? 'input' : 'change', async () => {
    preferencias[clave] = ui[clave].type === 'checkbox' ? ui[clave].checked : ui[clave].type === 'range' ? Number(ui[clave].value) : ui[clave].value;
    pintarPreferencias();
    if (clave === 'volVoz') sesion?.voz?.definirVolumenVoz(preferencias.volVoz / 100);
    if (clave === 'volOriginal') sesion?.voz?.definirVolumenFondo(preferencias.volOriginal);
    if (clave === 'ritmoAuto') sesion?.voz?.definirRitmoAutomatico(preferencias.ritmoAuto);
    if (['voz', 'acento'].includes(clave)) sesion?.servicio?.invalidarDesde(player.getCurrentTime() + 1);
    if (clave === 'subtitulo' && sesion) pintarLineas(sesion, sesion.indice);
    if (clave === 'autoSiguiente' && !preferencias.autoSiguiente) esperandoClase = false;
    try { await guardarPreferencias(preferencias); } catch { estado.textContent = 'No se pudieron guardar los ajustes. Siguen activos en este panel.'; }
  });
}

async function conectar() {
  try {
    preferencias = await leerPreferencias(); pintarPreferencias();
    const tab = await pestanaClase();
    puerto = chrome.tabs.connect(tab.id, { name: 'jgUdemy' });
    player = new ReproductorRemoto(puerto);
    const setTasa = player.setPlaybackRate.bind(player);
    player.setPlaybackRate = (tasa) => { velocidadPedida = { tasa, cuando: Date.now(), rechazos: 0 }; setTasa(tasa); };
    puerto.onMessage.addListener((mensaje) => {
      if (mensaje.tipo === 'clase') {
        titulo = mensaje.titulo || ''; ui.clase.textContent = titulo;
        const continuar = preferencias.autoSiguiente && (!!sesion || esperandoClase);
        if (sesion) detener('Nueva clase. Dale play en Udemy para doblarla.');
        esperandoClase = continuar;
      }
      if (mensaje.tipo === 'error') estado.textContent = mensaje.mensaje;
      if (mensaje.tipo !== 'estado') return;
      if (!sesion) ui.doblar.disabled = false;
      if (velocidadPedida && sesion && Date.now() - velocidadPedida.cuando < 10000 && Math.abs(mensaje.tasa - velocidadPedida.tasa) > .01) {
        if (++velocidadPedida.rechazos >= 3) {
          sesion.ritmoRechazado = true; sesion.voz?.definirRitmoAutomatico(false); velocidadPedida = null;
          ui.ritmoAuto.checked = false;
          estado.textContent = 'Udemy no deja cambiar la velocidad; la voz irá un poco más rápida.';
        }
      }
      if (esperandoClase && !mensaje.pausado && !mensaje.terminado) { esperandoClase = false; iniciar(); }
    });
    puerto.onDisconnect.addListener(() => { detener('Se perdió la conexión con la clase. Recarga la extensión y vuelve a abrir el panel.'); ui.doblar.disabled = true; });
    estado.textContent = 'Activa los subtítulos en inglés y pulsa Doblar al español.';
  } catch (error) { estado.textContent = error.message; }
}
globalThis.jgDoblajeDiagnostico = () => ({ activo: !!sesion, preparacion: sesion?.motor?.resumen() || null, voz: sesion?.metricas || null, conectado: !!player?.conectado });
globalThis.addEventListener('pagehide', () => { detener(''); player?.destruir(); });
if (!new URLSearchParams(globalThis.location.search).has('soloDiagnostico')) conectar();
