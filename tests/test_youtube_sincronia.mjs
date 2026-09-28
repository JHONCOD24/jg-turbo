/* Doblaje de YouTube · sincronía voz ↔ video (motor v4, 2026-09-26).
 * Sin navegador ni red: reproductor, audios y reloj VIRTUALES.
 * Ejecutar: node tests/test_youtube_sincronia.mjs
 *
 * El caso que reportó el dueño: en habla continua el español no cabe en el
 * tiempo del inglés y la voz «empieza una línea y salta a la otra». Aquí se
 * simula ese caso y se cuenta lo que importa: frases cortadas a mitad, frases
 * saltadas, orden, retraso de la voz y velocidad del video.
 */
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const modulo = (nombre) => import(pathToFileURL(path.join(raiz, 'js/youtube', nombre)).href);
const ritmo = await modulo('ritmoDoblaje.js');
const { DubbingEngine, RETRASO_MAXIMO_S, ANTICIPO_ARRANQUE_S } = await modulo('dubbingEngine.js');
const { SyncEngine } = await modulo('syncEngine.js');

let ok = 0;
let fallos = 0;
function comprobar(condicion, mensaje) {
  if (condicion) { ok += 1; console.log(`OK: ${mensaje}`); }
  else { fallos += 1; console.error(`FALLO: ${mensaje}`); }
}
const cerca = (a, b, tolerancia = 1e-6) => Math.abs(a - b) <= tolerancia;

// ── Funciones puras del ritmo ───────────────────────────────────────────
{
  comprobar(ritmo.redondearTasaVideo(0.87) === 0.85, 'la velocidad del video se redondea hacia abajo al paso de 0,05 (0,87 → 0,85)');
  comprobar(ritmo.redondearTasaVideo(0.97) === 0.95, '0,97 → 0,95, como hace YouTube (medido)');
  comprobar(ritmo.redondearTasaVideo(1) === 1 && ritmo.redondearTasaVideo(1.25) === 1.25, 'los pasos exactos se respetan');
  const r1 = ritmo.rangoVoz(1);
  comprobar(r1.min === 1 && r1.comoda === 1.12 && r1.max === 1.25, 'a 1×: la voz va de 1× (natural) a 1,25× como techo, cómoda hasta 1,12×');
  const r15 = ritmo.rangoVoz(1.5);
  comprobar(cerca(r15.comoda, 1.68) && cerca(r15.max, 1.875), 'si la persona elige 1,5× en YouTube, la voz también va más rápida');
  comprobar(ritmo.rangoVoz(0.75).min === 1, 'con el video lento la voz no se frena (sonaría en cámara lenta)');

  const base = { tiempoVideo: 10, limiteSuave: 14, limiteDuro: 14, tasaVideo: 1, tasaBase: 1 };
  comprobar(ritmo.velocidadVoz({ ...base, restanteS: 3 }) === 1, 'si sobra tiempo, la voz suena a su ritmo natural (no se estira)');
  comprobar(ritmo.velocidadVoz({ ...base, restanteS: 4.4 }) === 1.1, 'si falta un poco, acelera lo justo (1,10×)');
  comprobar(ritmo.velocidadVoz({ ...base, restanteS: 4.8, limiteDuro: 16 }) === 1.12, 'si hay un silencio después, no pasa del ritmo cómodo');
  comprobar(ritmo.velocidadVoz({ ...base, restanteS: 9 }) === 1.25, 'si no cabe ni al techo, va al techo (1,25×) y el video se encarga del resto');
  comprobar(ritmo.velocidadVoz({ ...base, tiempoVideo: 15, restanteS: 1 }) === 1.25, 'con la frase siguiente ya empezada, la voz se apura al techo');
  comprobar(ritmo.velocidadVoz({ ...base, restanteS: 4.4, tasaVideo: 0.8 }) === 1, 'con el video frenado, la misma frase cabe sin acelerar');

  const unidades = Array.from({ length: 10 }, (_, i) => ({ startTime: i * 4, finHabla: i * 4 + 3.9, endTime: i * 4 + 4, estado: 'listo', duracionVoz: 5.6, text: 'x' }));
  const densa = ritmo.demandaVoz({ unidades, tiempoVideo: 0, siguiente: 0 });
  comprobar(densa.necesarioS > densa.videoS, `en habla continua el español necesita más tiempo que el video (${densa.necesarioS.toFixed(1)} s de voz para ${densa.videoS} s)`);
  const tasa = ritmo.tasaVideoObjetivo({ ...densa, tasaBase: 1 });
  comprobar(tasa === 0.8, `el plan frena el video lo justo para que quepa a ritmo cómodo (${tasa}×)`);
  const holgada = unidades.map((u) => ({ ...u, duracionVoz: 3.4 }));
  comprobar(ritmo.tasaVideoObjetivo({ ...ritmo.demandaVoz({ unidades: holgada, tiempoVideo: 0, siguiente: 0 }), tasaBase: 1 }) === 1, 'si el español cabe, el video no se toca');
  const justa = unidades.map((u) => ({ ...u, duracionVoz: 4.55 }));
  comprobar(ritmo.tasaVideoObjetivo({ ...ritmo.demandaVoz({ unidades: justa, tiempoVideo: 0, siguiente: 0 }), tasaBase: 1 }) === 1, 'un déficit pequeño lo absorbe la voz, sin frenar el video');
  comprobar(ritmo.tasaVideoObjetivo({ necesarioS: 1, videoS: 20, tasaBase: 1, retrasoS: 2 }) === 0.85, 'con la voz 2 s atrasada, el video se frena aunque el plan diga que cabe');
  comprobar(ritmo.tasaVideoObjetivo({ necesarioS: 1, videoS: 20, tasaBase: 1, retrasoS: 4 }) === 0.75, 'con 4 s de atraso se frena al mínimo (0,75×)');
  comprobar(ritmo.tasaVideoObjetivo({ necesarioS: 100, videoS: 10, tasaBase: 1 }) === 0.75, 'nunca se frena por debajo de 0,75×');
  const conBase = ritmo.tasaVideoObjetivo({ ...densa, tasaBase: 1.25 });
  comprobar(conBase <= 1.25 && cerca(conBase * 20 % 1, 0, 1e-9), `a 1,25× elegido por la persona, el plan baja en pasos de 0,05 (${conBase}×)`);
  comprobar(ritmo.duracionVozEstimada({ text: 'x'.repeat(175) }) === 10, 'sin audio aún, la duración se estima por el texto (17,5 car/s medidos)');
  comprobar(ritmo.duracionVozEstimada({ estado: 'sin_voz', text: 'hola' }) === 0, 'una frase sin voz no pide tiempo (suena el original)');

  const unidad = { desde: 5, hasta: 7, startTime: 10, finHabla: 16 };
  const fracciones = ritmo.fraccionesDeUnidad(unidad, (i) => ({ 5: 'aaaa', 6: 'bbbbbbbbbbbb', 7: 'cccc' })[i]);
  comprobar(JSON.stringify(fracciones) === '[0.2,0.8,1]', 'las fracciones siguen el largo del texto de cada segmento');
  unidad.fracciones = fracciones;
  comprobar(ritmo.segmentoPorAvance(unidad, 0.1) === 5 && ritmo.segmentoPorAvance(unidad, 0.5) === 6 && ritmo.segmentoPorAvance(unidad, 0.95) === 7, 'el subtítulo muestra el segmento que va diciendo la voz');
  comprobar(ritmo.posicionVozEnVideo(unidad, 0.5) === 13, 'la voz a la mitad equivale a la mitad de lo dicho en el original');
  comprobar(cerca(ritmo.avanceDeVideo(unidad, 13), 0.5), 'y al revés: el video a la mitad es la voz a la mitad (retomar tras un salto)');
  comprobar(ritmo.unidadEn(unidades, 5) === 1 && ritmo.unidadEn(unidades, 0) === 0 && ritmo.unidadEn(unidades, 999) === -1, 'unidadEn encuentra la frase de cada instante');
}

// ── Simulador: reproductor, audios y reloj virtuales ────────────────────
class JugadorVirtual {
  constructor() {
    this.t = 0; this.tasa = 1; this.estado = 2; this.vol = 100; this.mudo = false;
    this.estados = new Set(); this.velocidades = new Set(); this.tasasVistas = [1];
  }
  avanzar(ms) { if (this.estado === 1) this.t += (ms / 1000) * this.tasa; }
  getCurrentTime() { return this.t; }
  getPlaybackRate() { return this.tasa; }
  setPlaybackRate(r) { this.tasa = Number(r); this.tasasVistas.push(this.tasa); this.velocidades.forEach((f) => f(this.tasa)); }
  getPlayerState() { return this.estado; }
  playVideo() { if (this.estado === 1) return; this.estado = 1; this.estados.forEach((f) => f('playing')); }
  pauseVideo() { this.estado = 2; this.estados.forEach((f) => f('paused')); }
  seekTo(s) { this.t = Math.max(0, Number(s) || 0); }
  getVolume() { return this.vol; } setVolume(v) { this.vol = Number(v); }
  mute() { this.mudo = true; } unMute() { this.mudo = false; } isMuted() { return this.mudo; }
  suscribirEstado(f) { this.estados.add(f); return () => this.estados.delete(f); }
  suscribirVelocidad(f) { this.velocidades.add(f); return () => this.velocidades.delete(f); }
}

class AudioVirtual {
  constructor(duraciones, registro, jugador, finesVoz = new Map()) {
    Object.assign(this, { duraciones, registro, jugador, finesVoz });
    this.srcActual = ''; this.currentTimeInterno = 0; this.duration = Number.NaN;
    this.paused = true; this.ended = false; this.playbackRate = 1; this.volume = 1;
    this.oyentes = {}; this.cargando = false;
  }
  get src() { return this.srcActual; }
  /** Hasta dónde hay voz: cortar después (en el silencio final) no pierde nada. */
  finVoz() { return this.finesVoz.get(this.srcActual) ?? this.duration; }
  set src(valor) {
    if (!this.paused && !this.ended && this.currentTimeInterno < this.finVoz() - 0.05 && this.jugador.estado === 1) {
      this.registro.cortes.push({ url: this.srcActual, en: this.currentTimeInterno, de: this.duration });
    }
    this.srcActual = valor;
  }
  get currentTime() { return this.currentTimeInterno; }
  set currentTime(valor) {
    // Un salto DENTRO de una frase que ya se oye (no el punto de arranque).
    if (!this.paused && !this.porAnotar && valor > this.currentTimeInterno + 0.15) this.registro.saltosDentro.push({ url: this.srcActual, de: this.currentTimeInterno, a: valor });
    this.currentTimeInterno = Math.max(0, Math.min(valor, Number.isFinite(this.duration) ? this.duration : valor));
    this.ended = false;
  }
  addEventListener(tipo, f) { (this.oyentes[tipo] ||= []).push(f); }
  emitir(tipo) { (this.oyentes[tipo] || []).forEach((f) => f()); }
  removeAttribute() { this.src = ''; }
  load() { this.currentTimeInterno = 0; this.ended = false; this.paused = true; this.duration = Number.NaN; this.cargando = Boolean(this.srcActual); }
  play() {
    if (!this.srcActual) return Promise.reject(Object.assign(new Error('sin src'), { name: 'NotSupportedError' }));
    if (this.paused) this.porAnotar = true;   // se anota al sonar de verdad (ya con datos)
    this.paused = false; this.ended = false;
    return Promise.resolve();
  }
  pause() {
    if (!this.paused && this.currentTimeInterno < this.finVoz() - 0.05 && this.jugador.estado === 1) {
      this.registro.cortes.push({ url: this.srcActual, en: this.currentTimeInterno, de: this.duration });
    }
    if (!this.paused && this.currentTimeInterno >= this.finVoz() - 0.05) this.registro.completas.push(this.srcActual);
    this.paused = true;
  }
  avanzar(ms) {
    if (this.cargando) {
      this.cargando = false;
      this.duration = this.duraciones.get(this.srcActual) ?? 1;
      this.emitir('loadedmetadata');
    }
    if (this.paused || this.ended || !Number.isFinite(this.duration)) return;
    if (this.porAnotar) {
      this.porAnotar = false;
      this.registro.plays.push({ url: this.srcActual, desde: this.currentTimeInterno, video: this.jugador.t });
    }
    this.currentTimeInterno += (ms / 1000) * this.playbackRate;
    this.registro.tasasVoz.push(this.playbackRate);
    if (this.currentTimeInterno >= this.duration) {
      this.currentTimeInterno = this.duration;
      this.ended = true; this.paused = true;
      this.registro.completas.push(this.srcActual);
      this.emitir('ended');
    }
  }
}

/** Frases contiguas de `ventana` s de video; la voz de cada una dura `voz` s a 1×. */
function unidadesContinuas(cantidad, { ventana = 4, voz = 5.6, segmentosPorFrase = 1 } = {}) {
  return Array.from({ length: cantidad }, (_, i) => ({
    indice: i, startTime: i * ventana, finHabla: i * ventana + ventana - 0.1, endTime: (i + 1) * ventana,
    duration: ventana, desde: i * segmentosPorFrase, hasta: i * segmentosPorFrase + segmentosPorFrase - 1,
    text: 'x'.repeat(Math.round(voz * 17.5)), estado: 'listo', url: `voz-${i}`, duracionVoz: voz,
  }));
}

function escenario(unidades, { ritmoAutomatico = true, pasoMs = 20, servicio = null } = {}) {
  let ahora = 0;
  const registro = { cortes: [], completas: [], plays: [], saltosDentro: [], tasasVoz: [], estados: [], tasasBase: [] };
  // `audioS`: lo que dura el archivo (con silencios); `duracionVoz`: lo que se habla.
  const duraciones = new Map(unidades.map((u) => [u.url, u.audioS ?? u.duracionVoz]));
  const finesVoz = new Map(unidades.filter((u) => u.finVozS).map((u) => [u.url, u.finVozS]));
  const jugador = new JugadorVirtual();
  const audios = [];
  let tic = null;
  const motor = new DubbingEngine({
    player: jugador,
    servicio: servicio || { unidades, asegurar: (i) => Promise.resolve(unidades[i]) },
    crearAudio: () => { const a = new AudioVirtual(duraciones, registro, jugador, finesVoz); audios.push(a); return a; },
    reloj: (f) => { tic = f; return { iniciar() {}, detener() {}, activo: true }; },
    ahora: () => ahora,
    ritmoAutomatico,
    onStatus: (mensaje) => registro.estados.push(mensaje),
    onTasaBase: (tasa) => registro.tasasBase.push(tasa),
  });
  const indicesVoz = [];
  async function correr(segundos, alPaso = null) {
    const pasos = Math.round((segundos * 1000) / pasoMs);
    for (let k = 0; k < pasos; k += 1) {
      ahora += pasoMs;
      jugador.avanzar(pasoMs);
      for (const a of audios) a.avanzar(pasoMs);
      if (ahora % 100 === 0) {
        tic?.();
        indicesVoz.push({ t: jugador.t, indice: motor.indiceSegmentoVoz(), hablando: motor.hablando });
      }
      if (alPaso) alPaso(ahora);
      if (k % 50 === 0) await Promise.resolve();   // deja resolver promesas (asegurar)
    }
  }
  return { motor, jugador, registro, correr, indicesVoz, get ahora() { return ahora; } };
}

/** ¿Las frases completas son 0,1,2… sin huecos ni repeticiones? */
function enOrdenSinHuecos(completas) {
  return completas.every((url, i) => url === `voz-${i}`);
}

// ── El caso reportado: habla continua, el español no cabe (ritmo automático) ─
{
  const unidades = unidadesContinuas(40, { voz: 5.6 });   // necesitaría 1,4× sin ayuda
  const s = escenario(unidades);
  s.motor.activarYReproducir();
  await s.correr(175);
  const m = s.motor.metricas();
  const dichas = s.registro.completas.length;
  comprobar(s.registro.cortes.length === 0, `ninguna frase se corta a mitad (antes se cortaban casi todas) · cortes=${s.registro.cortes.length}`);
  comprobar(enOrdenSinHuecos(s.registro.completas) && dichas >= 30, `las frases suenan enteras, en orden y sin saltarse ninguna (${dichas} seguidas)`);
  comprobar(s.registro.plays.every((p) => p.desde < 0.05), 'cada frase empieza por su principio, no a mitad');
  comprobar(s.registro.saltosDentro.length === 0, 'y ninguna brinca por dentro (antes se reposicionaba para alcanzar al video)');
  comprobar(m.frasesSaltadas === 0, 'el motor no tuvo que saltar nada');
  const minima = Math.min(...s.jugador.tasasVistas);
  comprobar(minima < 1 && minima >= 0.75, `el video se frenó solo lo justo (${minima}×)`);
  comprobar(m.retrasoP95Ms <= 1500, `la voz no se queda atrás: retraso p95 ${m.retrasoP95Ms} ms`);
  comprobar(Math.max(...s.registro.tasasVoz) <= 1.25 + 1e-9, `la voz nunca pasa de 1,25× (máx ${Math.max(...s.registro.tasasVoz).toFixed(2)})`);
  comprobar(m.cambiosTasa <= 6, `la velocidad del video no sube y baja a cada rato (${m.cambiosTasa} cambios)`);
}

// ── Mismo caso con el ritmo automático apagado: nada se corta a mitad ────
{
  const unidades = unidadesContinuas(40, { voz: 5.6 });
  const s = escenario(unidades, { ritmoAutomatico: false });
  s.motor.activarYReproducir();
  await s.correr(160);
  const m = s.motor.metricas();
  comprobar(s.registro.cortes.length === 0, `sin ritmo automático tampoco se corta ninguna frase a mitad (cortes=${s.registro.cortes.length})`);
  comprobar(s.jugador.tasasVistas.every((t) => t === 1), 'y el video no se toca');
  comprobar(m.frasesSaltadas > 0, `pero la voz se atrasa y a veces salta una frase entera (${m.frasesSaltadas}): por eso el automático viene encendido`);
}

// ── Habla holgada: el video no se toca y la voz no se atrasa ────────────
{
  const unidades = unidadesContinuas(30, { voz: 3.3 });
  const s = escenario(unidades);
  s.motor.activarYReproducir();
  await s.correr(100);
  const m = s.motor.metricas();
  comprobar(s.jugador.tasasVistas.every((t) => t === 1), 'si el español cabe, el video va a la velocidad elegida');
  comprobar(s.registro.cortes.length === 0 && enOrdenSinHuecos(s.registro.completas), 'todas las frases enteras y en orden');
  comprobar(m.retrasoP95Ms <= 300, `retraso p95 ${m.retrasoP95Ms} ms (≤ 300)`);
  comprobar(s.registro.tasasVoz.every((r) => r === 1), 'y la voz suena a su ritmo natural (1×)');
}

// ── Salto: la persona busca otro punto ─────────────────────────────────
{
  const unidades = unidadesContinuas(60, { voz: 3.3 });
  const s = escenario(unidades);
  s.motor.activarYReproducir();
  await s.correr(10);
  const antes = s.registro.plays.length;
  s.jugador.seekTo(121);   // mitad de la frase 30 (120–124)
  await s.correr(6);
  const siguientes = s.registro.plays.slice(antes);
  comprobar(siguientes[0]?.url === 'voz-30', `tras el salto suena la frase del punto nuevo (${siguientes[0]?.url})`);
  comprobar(siguientes[0] && siguientes[0].desde > 0.5, 'y retoma en su punto, no desde el principio de la frase');
  comprobar(!siguientes.some((p) => ['voz-3', 'voz-4', 'voz-5'].includes(p.url)), 'sin arrastrar frases de donde estaba antes');
  comprobar(s.motor.metricas().frasesSaltadas === 0, 'un salto de la persona no cuenta como frase saltada');
}

// ── Pausa y reanudar: la frase sigue donde iba ──────────────────────────
{
  const unidades = unidadesContinuas(10, { voz: 3.3 });
  const s = escenario(unidades);
  s.motor.activarYReproducir();
  await s.correr(5.5);   // a mitad de la frase 1
  s.jugador.pauseVideo();
  await s.correr(3);
  const enPausa = s.motor.hablando;
  s.jugador.playVideo();
  await s.correr(20);
  comprobar(enPausa === 1, 'en pausa la frase queda a la espera (no se descarta)');
  comprobar(s.registro.completas.filter((u) => u === 'voz-1').length === 1 && enOrdenSinHuecos(s.registro.completas), 'al reanudar termina la misma frase y sigue en orden');
}

// ── Una frase sin voz (no se pudo traducir): suena el original y sigue ──
{
  const unidades = unidadesContinuas(10, { voz: 3.3 });
  unidades[3].estado = 'sin_voz';
  const s = escenario(unidades);
  s.motor.activarYReproducir();
  await s.correr(40);
  comprobar(!s.registro.completas.includes('voz-3') && s.registro.completas.includes('voz-4'), 'la frase sin voz se deja al original y la siguiente suena');
  comprobar(s.registro.estados.some((e) => /idioma original/.test(e)), 'y se avisa que ese tramo suena en su idioma');
}

// ── Una frase que aún no tiene voz: se espera sin cortar nada ───────────
{
  const unidades = unidadesContinuas(12, { voz: 3.3 });
  let listaEn = null;
  unidades[4].estado = 'pendiente';
  const servicio = {
    unidades,
    asegurar: (i) => new Promise((resolver) => { listaEn = () => { unidades[i].estado = 'listo'; resolver(unidades[i]); }; }),
  };
  const s = escenario(unidades, { servicio });
  s.motor.activarYReproducir();
  await s.correr(17.5);   // el video ya entró en la frase 4 (16–20 s) sin voz lista
  comprobar(typeof listaEn === 'function', 'el motor pide la voz de la frase que falta');
  await s.correr(2);
  comprobar(s.jugador.tasa === 1, 'mientras espera una voz que no llegó, no frena el video (sería inglés en cámara lenta)');
  listaEn();
  await s.correr(20);
  comprobar(s.registro.completas.includes('voz-4') && s.registro.cortes.length === 0, 'al llegar, la frase suena entera (con el retraso que la espera impuso)');
  comprobar(enOrdenSinHuecos(s.registro.completas), 'y las siguientes siguen en orden');
}

// ── La persona cambia la velocidad en el engranaje de YouTube ───────────
{
  const unidades = unidadesContinuas(10, { voz: 3.3 });
  const s = escenario(unidades);
  s.motor.activarYReproducir();
  await s.correr(2);
  s.jugador.setPlaybackRate(1.25);   // como si la persona usara el engranaje
  await s.correr(2);
  comprobar(s.motor.tasaBase === 1.25 && s.registro.tasasBase.includes(1.25), 'la velocidad del engranaje pasa a ser la base (y se recuerda)');
  comprobar(s.registro.tasasVoz.slice(-10).every((r) => r >= 1.25 * 0.95 - 1e-9), 'y la voz la acompaña (va más rápida)');
}

// ── El subtítulo muestra la línea que dice la voz ───────────────────────
{
  const unidades = unidadesContinuas(8, { voz: 5.6, segmentosPorFrase: 2 }).map((u) => ({ ...u, fracciones: [0.5, 1] }));
  const s = escenario(unidades);
  s.motor.activarYReproducir();
  await s.correr(30);
  const conVoz = s.indicesVoz.filter((m) => m.hablando >= 0);
  const coherente = conVoz.every((m) => m.indice === unidades[m.hablando].desde || m.indice === unidades[m.hablando].hasta);
  comprobar(conVoz.length > 50 && coherente, 'mientras suena una frase, el subtítulo es un segmento de ESA frase');
  const primera = conVoz.filter((m) => m.hablando === 2).map((m) => m.indice);
  comprobar(primera[0] === 4 && primera[primera.length - 1] === 5, 'y avanza con la voz: primera mitad → segmento 4, segunda → segmento 5');
  const voz = { indiceSegmentoVoz: () => 7 };
  const jugador = new JugadorVirtual();
  jugador.t = 1;
  const vistos = [];
  const sync = new SyncEngine({ player: jugador, segmentos: [{ startTime: 0, endTime: 2 }, { startTime: 2, endTime: 4 }], onSegmentChange: (i) => vistos.push(i), indiceExterno: () => voz.indiceSegmentoVoz(), reloj: { iniciar() {}, detener() {} } });
  sync.iniciar();
  comprobar(vistos[0] === 7, 'el texto sincronizado usa el índice de la voz cuando hay voz');
  voz.indiceSegmentoVoz = () => null;
  jugador.estados.forEach((f) => f('paused'));
  comprobar(vistos[vistos.length - 1] === 0, 'y el reloj del video cuando no la hay');
  sync.destruir();
}

// ── Si YouTube no deja cambiar la velocidad, no se insiste ──────────────
{
  const unidades = unidadesContinuas(20, { voz: 5.6 });
  const s = escenario(unidades);
  s.jugador.setPlaybackRate = function () { this.tasasVistas.push('ignorada'); };   // directo: la velocidad no cambia
  s.motor.activarYReproducir();
  await s.correr(30);
  const pedidas = s.jugador.tasasVistas.filter((t) => t === 'ignorada').length;
  comprobar(pedidas <= 2, `si el video no admite otra velocidad, se deja de pedir (${pedidas} intentos)`);
  comprobar(s.registro.estados.some((e) => /no deja cambiar su velocidad/.test(e)), 'y se explica');
  comprobar(s.registro.cortes.length === 0, 'aun así ninguna frase se corta a mitad');
}

// ── La voz real trae silencio delante (0,21 s) y detrás (0,85 s) ───────
// Medido en producción el 2026-09-28 (edge-tts y Azure). Antes el motor lo
// esperaba y lo contaba como voz por decir: frenaba el video de más.
{
  const DELANTE = 0.21;
  const DETRAS = 0.85;
  const conSilencio = (medido) => unidadesContinuas(40, { voz: 4.2 }).map((u) => ({
    ...u,
    audioS: u.duracionVoz + DELANTE + DETRAS,
    // Sin medición: el motor solo conoce el archivo entero (como antes).
    ...(medido
      ? { vozDesdeS: DELANTE - 0.02, vozHastaS: DELANTE + u.duracionVoz + 0.08, duracionVoz: u.duracionVoz + 0.1, finVozS: DELANTE + u.duracionVoz }
      : { duracionVoz: u.duracionVoz + DELANTE + DETRAS, finVozS: DELANTE + u.duracionVoz }),
  }));
  const correrCaso = async (medido) => {
    const s = escenario(conSilencio(medido));
    s.motor.activarYReproducir();
    await s.correr(170);
    return { s, m: s.motor.metricas(), minima: Math.min(1, ...s.jugador.tasasVistas) };
  };
  const antes = await correrCaso(false);
  const ahora = await correrCaso(true);
  comprobar(ahora.s.registro.cortes.length === 0, `con el silencio recortado ninguna frase pierde voz · cortes=${ahora.s.registro.cortes.length}`);
  comprobar(ahora.s.registro.plays.every((p) => Math.abs(p.desde - (DELANTE - 0.02)) < 0.03), 'cada frase arranca donde empieza la voz (se salta el silencio de delante)');
  comprobar(enOrdenSinHuecos(ahora.s.registro.completas.filter((u, i, l) => l.indexOf(u) === i)) && ahora.m.frasesSaltadas === 0, 'y todas suenan, en orden, sin saltarse ninguna');
  comprobar(ahora.minima > antes.minima + 0.04,
    `el video se frena menos: mínimo ${ahora.minima}× (antes ${antes.minima}×)`);
  comprobar(ahora.m.retrasoP95Ms <= 500 && ahora.m.dentroObjetivo >= 0.95,
    `y la voz sigue pegada al video: p95 ${ahora.m.retrasoP95Ms} ms, ${Math.round(ahora.m.dentroObjetivo * 100)} % de muestras ≤ 0,5 s`);
  comprobar(ahora.s.jugador.t > antes.s.jugador.t + 5,
    `en el mismo tiempo real se ve más video: ${ahora.s.jugador.t.toFixed(1)} s (antes ${antes.s.jugador.t.toFixed(1)} s)`);
}

// ── Cada frase entra en su segundo, no un tic tarde ─────────────────────
// Los inicios caen ENTRE tics (paso de 4,137 s), como en un video real: con
// inicios múltiplos de 100 ms el simulador coincidía siempre con el tic y
// nunca mostraba el atraso de arranque.
{
  const unidades = unidadesContinuas(30, { voz: 3 }).map((u, i) => ({ ...u, startTime: i * 4.137, finHabla: i * 4.137 + 3.9, endTime: (i + 1) * 4.137 }));
  const s = escenario(unidades);
  s.motor.activarYReproducir();
  await s.correr(130);
  const desfases = s.registro.plays.map((p) => p.video - unidades[Number(p.url.split('-')[1])].startTime);
  const media = desfases.reduce((a, b) => a + b, 0) / desfases.length;
  comprobar(ANTICIPO_ARRANQUE_S === 0.08 && desfases.length === 30, `las 30 frases arrancan (adelanto ${ANTICIPO_ARRANQUE_S} s)`);
  comprobar(Math.abs(media) <= 0.03, `la voz entra centrada en su segundo: ${Math.round(media * 1000)} ms de media (antes +40 ms)`);
  comprobar(Math.max(...desfases) <= 0.05 && Math.min(...desfases) >= -0.07,
    `ninguna llega un tic tarde ni se adelanta de forma notoria (${Math.round(Math.min(...desfases) * 1000)} a ${Math.round(Math.max(...desfases) * 1000)} ms)`);
}

comprobar(RETRASO_MAXIMO_S === 5, 'la voz solo se rinde con más de 5 s de atraso');

// ── Resumen ─────────────────────────────────────────────────────────────
console.log(`\n${ok} comprobaciones OK · ${fallos} fallos`);
process.exit(fallos ? 1 : 0);
