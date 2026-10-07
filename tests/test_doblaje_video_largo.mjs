/**
 * Video LARGO de punta a punta con reloj virtual (2026-10-06).
 *
 * Caso del dueño: en videos de más de una hora el doblaje «se frena», la
 * persona sigue hablando en inglés uno o dos minutos y luego vuelve la voz; el
 * subtítulo también se queda atrás. Las otras pruebas miden piezas sueltas (el
 * motor con todas las voces ya listas, el planificador sin red); esta junta las
 * piezas REALES (MotorPreparacion + TranslationService + DubbingService +
 * DubbingEngine) contra una red simulada con lo que se mide en producción:
 * voces que tardan 40-90 s (edge-tts + reintento GET→POST), caídas de voz y
 * rachas de 429 del traductor. Todo el tiempo es virtual: 70 minutos de video
 * se simulan en segundos.
 *
 * Qué se mide (por cada décima de segundo con el video corriendo):
 *  - «inglés»: hay habla en el original y la voz en español no suena;
 *  - «sin subtítulo»: el segmento que se ve aún no tiene traducción;
 *  - el tramo seguido más largo de cada uno (lo que la persona percibe como «se frenó»).
 */
import { pathToFileURL } from 'node:url';
import path from 'node:path';

const raiz = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const modulo = (nombre) => import(pathToFileURL(path.join(raiz, 'js/youtube', nombre)).href);

let ok = 0;
let fallos = 0;
function comprobar(condicion, mensaje) {
  if (condicion) { ok += 1; console.log(`OK: ${mensaje}`); } else { fallos += 1; console.log(`FALLO: ${mensaje}`); }
}

// ── Tiempo virtual: setTimeout/setInterval/Date.now ─────────────────────
const real = { setTimeout, clearTimeout, setInterval, clearInterval, now: Date.now };
let ahoraV = 1_000_000;
let temporizadores = [];
let siguienteId = 1;
function programar(fn, ms, intervalo) {
  const id = siguienteId++;
  temporizadores.push({ id, en: ahoraV + Math.max(0, Number(ms) || 0), fn, intervalo: intervalo ? Math.max(1, Number(ms) || 1) : 0 });
  return id;
}
function quitar(id) { temporizadores = temporizadores.filter((t) => t.id !== id); }
function instalarTiempoVirtual() {
  globalThis.setTimeout = (fn, ms) => programar(fn, ms, false);
  globalThis.clearTimeout = quitar;
  globalThis.setInterval = (fn, ms) => programar(fn, ms, true);
  globalThis.clearInterval = quitar;
  Date.now = () => ahoraV;
}
function restaurarTiempo() {
  Object.assign(globalThis, { setTimeout: real.setTimeout, clearTimeout: real.clearTimeout, setInterval: real.setInterval, clearInterval: real.clearInterval });
  Date.now = real.now;
}
const vaciarMicrotareas = () => new Promise((r) => setImmediate(r));
async function avanzarHasta(meta) {
  for (let vueltas = 0; ; vueltas += 1) {
    if (vueltas === 5000) console.log('  [traza] bucle de temporizadores:', temporizadores.map((t) => `${t.en - ahoraV}ms/${t.intervalo}`).join(' '), String(temporizadores[0]?.fn).slice(0, 200));
    const proximo = temporizadores.filter((t) => t.en <= meta).sort((a, b) => a.en - b.en || a.id - b.id)[0];
    if (!proximo) break;
    ahoraV = Math.max(ahoraV, proximo.en);
    if (proximo.intervalo) proximo.en += proximo.intervalo; else quitar(proximo.id);
    try { proximo.fn(); } catch (error) { console.error(error); }
    await vaciarMicrotareas();
  }
  ahoraV = meta;
}
/** Promesa que se resuelve (o falla) tras `ms` de tiempo virtual. */
const tras = (ms, valor, signal = null) => new Promise((resolver, rechazar) => {
  const id = programar(() => (valor instanceof Error ? rechazar(valor) : resolver(valor)), ms, false);
  signal?.addEventListener?.('abort', () => { quitar(id); rechazar(new DOMException('Cancelado', 'AbortError')); }, { once: true });
});

// ── Reproductor y audios virtuales ───────────────────────────────────────
class JugadorVirtual {
  constructor(duracion) { Object.assign(this, { t: 0, tasa: 1, estado: 2, vol: 100, duracion, estados: new Set(), velocidades: new Set() }); }
  avanzar(ms) { if (this.estado === 1) this.t = Math.min(this.duracion, this.t + (ms / 1000) * this.tasa); }
  getCurrentTime() { return this.t; }
  getDuration() { return this.duracion; }
  getPlaybackRate() { return this.tasa; }
  setPlaybackRate(r) { this.tasa = Number(r); this.velocidades.forEach((f) => f(this.tasa)); }
  getPlayerState() { return this.estado; }
  playVideo() { if (this.estado === 1) return; this.estado = 1; this.estados.forEach((f) => f('playing')); }
  pauseVideo() { if (this.estado === 2) return; this.estado = 2; this.estados.forEach((f) => f('paused')); }
  getVolume() { return this.vol; } setVolume(v) { this.vol = Number(v); }
  mute() {} unMute() {} isMuted() { return false; }
  suscribirEstado(f) { this.estados.add(f); return () => this.estados.delete(f); }
  suscribirVelocidad(f) { this.velocidades.add(f); return () => this.velocidades.delete(f); }
}

class AudioVirtual {
  constructor(duracionDe) { Object.assign(this, { duracionDe, s: '', currentTime: 0, duration: Number.NaN, paused: true, ended: false, playbackRate: 1, volume: 1, oyentes: {}, cargando: false }); }
  get src() { return this.s; }
  set src(v) { this.s = v; }
  addEventListener(tipo, f) { (this.oyentes[tipo] ||= []).push(f); }
  removeEventListener() {}
  emitir(tipo) { (this.oyentes[tipo] || []).forEach((f) => f()); }
  removeAttribute() { this.s = ''; }
  load() { this.currentTime = 0; this.ended = false; this.paused = true; this.duration = Number.NaN; this.cargando = Boolean(this.s); }
  play() { if (!this.s) return Promise.reject(new Error('sin src')); this.paused = false; this.ended = false; return Promise.resolve(); }
  pause() { this.paused = true; }
  avanzar(ms) {
    if (this.cargando) { this.cargando = false; this.duration = this.duracionDe(this.s) ?? 1; this.emitir('loadedmetadata'); }
    if (this.paused || this.ended || !Number.isFinite(this.duration)) return;
    this.currentTime += (ms / 1000) * this.playbackRate;
    if (this.currentTime >= this.duration) { this.currentTime = this.duration; this.ended = true; this.paused = true; this.emitir('ended'); }
  }
}

// ── Transcripción de un video largo (determinista) ───────────────────────
function aleatorio(semilla) {
  let s = semilla >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32; };
}
function transcripcion(minutos, semilla = 7) {
  const azar = aleatorio(semilla);
  const segmentos = [];
  let t = 1;
  while (t < minutos * 60 - 5) {
    const dura = 2.2 + azar() * 2.2;
    const cierra = azar() < 0.4;
    const texto = `${'palabra '.repeat(Math.round(dura * 2.6)).trim()}${cierra ? '.' : ''}`;
    segmentos.push({ startTime: t, endTime: t + dura, duration: dura, text: texto });
    t += dura + (azar() < 0.15 ? 0.9 + azar() * 1.5 : 0.05);
  }
  return segmentos;
}

/**
 * Escenario completo. `voz(n, ahoraMs)` y `traduccion(n, ahoraMs)` deciden la
 * latencia (ms) o el error de la llamada n-ésima.
 */
async function simular({ minutos = 70, voz, traduccion, configurar = () => {}, alPaso = () => {}, medirDesdeS = 0 }) {
  const { MotorPreparacion } = await modulo('motorPreparacion.js');
  const { TranslationService } = await modulo('translationService.js');
  const { DubbingService, agruparPorTiempo } = await modulo('dubbingService.js');
  const { DubbingEngine } = await modulo('dubbingEngine.js');
  const { crearLimitador } = await modulo('limitador.js');
  const { VOZ_INICIAL_S } = await modulo('planificador.js');

  ahoraV = 1_000_000;
  instalarTiempoVirtual();
  temporizadores = [];
  const segmentos = transcripcion(minutos);
  const jugador = new JugadorVirtual(minutos * 60);
  const control = new AbortController();
  let llamadasTraduccion = 0;
  let llamadasVoz = 0;
  const traductor = new TranslationService({
    intervaloMinMs: 1100,
    traducirTexto: async (texto, { signal } = {}) => {
      const n = llamadasTraduccion++;
      const r = traduccion(n, ahoraV);
      // Misma cantidad de texto: la proporción queda en 1 (lote aceptado).
      return tras(r.ms, r.error || { text: texto, ia_used: true }, signal);
    },
  });
  const duraciones = new Map();
  const limitador = crearLimitador({ ahora: () => ahoraV });
  const servicioVoz = new DubbingService({
    limitador,
    medirHabla: async () => null,
    medirDuracion: async (url) => duraciones.get(url) ?? null,
    generarAudio: async (texto, unidad, opciones = {}) => {
      const n = llamadasVoz++;
      const r = voz(n, ahoraV);
      const blob = await tras(r.ms, r.error || new Blob(['x'.repeat(texto.length)], { type: 'audio/mpeg' }), opciones.signal || control.signal);
      return blob;
    },
  });
  // La duración del audio de una frase: su texto a 17,5 car/s.
  const crearURL = URL.createObjectURL;
  URL.createObjectURL = (blob) => { const url = crearURL(blob); duraciones.set(url, Math.max(0.6, blob.size / 17.5)); return url; };
  servicioVoz.definirUnidades(agruparPorTiempo(segmentos));
  if (process.env.JG_TRAZA) {
    const original = servicioVoz.asegurar.bind(servicioVoz);
    let mismo = 0; let ultimo = 0;
    servicioVoz.asegurar = (i) => {
      if (ahoraV === ultimo) mismo += 1; else { mismo = 0; ultimo = ahoraV; }
      if (mismo === 2000) { const u = servicioVoz.unidades[i]; console.log('  [traza] asegurar en bucle', i, u.estado, Boolean(u.promesa), u.reintentosVoz, u.error); }
      return original(i);
    };
  }
  const motor = new MotorPreparacion({
    segmentos, servicioVoz, traductor, posicion: () => jugador.getCurrentTime(),
    limitadorVoz: limitador, signal: control.signal,
  });
  configurar({ motor, servicioVoz });
  motor.sembrar([], []);
  motor.iniciar();
  let listo = false;
  motor.esperarArranque({ vozInicialS: VOZ_INICIAL_S }).then(() => { listo = true; });
  while (!listo && ahoraV < 1_000_000 + 120_000) await avanzarHasta(ahoraV + 100);
  const arranqueS = (ahoraV - 1_000_000) / 1000;

  const audios = [];
  const engine = new DubbingEngine({
    player: jugador, servicio: servicioVoz, esperarVoz: true, esperarFrase: false,
    crearAudio: () => { const a = new AudioVirtual((u) => duraciones.get(u)); audios.push(a); return a; },
  });
  engine.activarYReproducir();

  const m = { ingles: 0, inglesRacha: 0, inglesMax: 0, sinSub: 0, sinSubRacha: 0, sinSubMax: 0, esperaVoz: 0, esperaMax: 0, esperaRacha: 0, traducidoAlFinal: 0 };
  const unidades = servicioVoz.unidades;
  const segmentoEn = (t) => segmentos.findIndex((s) => s.startTime <= t && t < s.endTime);
  let paso = 0;
  const finVirtual = ahoraV + minutos * 60 * 1000 * 1.6;
  while (jugador.t < jugador.duracion - 1 && ahoraV < finVirtual) {
    await avanzarHasta(ahoraV + 100);
    jugador.avanzar(100);
    for (const a of audios) a.avanzar(100);
    paso += 1;
    alPaso({ jugador, ahoraMs: ahoraV - 1_000_000, engine });
    const t = jugador.t;
    if (!m.todoTraducidoS && motor.traducciones.size === segmentos.length) m.todoTraducidoS = Math.round((ahoraV - 1_000_000) / 1000);
    if ((ahoraV - 1_000_000) / 1000 < medirDesdeS) continue;
    if (jugador.estado !== 1) {
      if (engine.pausaPorVoz) { m.esperaVoz += 0.1; m.esperaRacha += 0.1; m.esperaMax = Math.max(m.esperaMax, m.esperaRacha); }
      continue;
    }
    m.esperaRacha = 0;
    // ¿Habla el original aquí y la voz en español calla?
    const j = unidades.findIndex((u) => u.startTime <= t && t < (u.finHabla ?? u.endTime));
    const callada = j >= 0 && engine.hablando < 0 && unidades[j].duration > 0;
    if (callada) { m.ingles += 0.1; m.inglesRacha += 0.1; m.inglesMax = Math.max(m.inglesMax, m.inglesRacha); } else m.inglesRacha = 0;
    // Subtítulo: el segmento a la vista sin traducción.
    if (paso % 5 === 0) {
      const k = segmentoEn(t);
      const sinTexto = k >= 0 && !motor.traducciones.has(k);
      if (sinTexto) { m.sinSub += 0.5; m.sinSubRacha += 0.5; m.sinSubMax = Math.max(m.sinSubMax, m.sinSubRacha); } else m.sinSubRacha = 0;
    }
  }
  m.traducidoAlFinal = motor.traducciones.size / segmentos.length;
  m.arranqueS = arranqueS;
  m.terminó = jugador.t >= jugador.duracion - 1;
  m.llamadasVoz = llamadasVoz;
  m.llamadasTraduccion = llamadasTraduccion;
  control.abort();
  motor.detener();
  engine.destruir();
  URL.createObjectURL = crearURL;
  restaurarTiempo();
  for (const clave of ['ingles', 'inglesMax', 'sinSub', 'sinSubMax', 'esperaVoz', 'esperaMax']) m[clave] = Math.round(m[clave] * 10) / 10;
  return m;
}

// ── Piezas sueltas de los arreglos (tiempo real, rápidas) ───────────────
{
  const { DubbingEngine } = await modulo('dubbingEngine.js');
  // Bucle sin fin: una frase sin voz que empieza entre +0,03 y +0,08 s se
  // «pedía» y fallaba al instante; el finally volvía al tic, y otra vez.
  const jugador = new JugadorVirtual(60);
  jugador.t = 1;
  jugador.estado = 1;
  let pedidas = 0;
  const unidades = [
    { indice: 0, startTime: 1.05, endTime: 1.05, finHabla: 1.05, duration: 0, desde: 0, hasta: 0, estado: 'sin_voz', text: '' },
    { indice: 1, startTime: 4, endTime: 8, finHabla: 8, duration: 4, desde: 1, hasta: 1, estado: 'pendiente', text: 'hola' },
  ];
  const servicio = {
    unidades,
    asegurar() {
      pedidas += 1;
      // Si hubiera bucle, a la vuelta 500 se corta con una promesa que nunca acaba.
      return pedidas > 500 ? new Promise(() => {}) : Promise.reject(new Error('La frase aún no tiene texto para decir.'));
    },
  };
  const motor = new DubbingEngine({
    player: jugador, servicio, esperarVoz: true, esperarFrase: false,
    crearAudio: () => new AudioVirtual(() => 1),
    reloj: () => ({ iniciar() {}, detener() {}, activo: true }),
  });
  motor.activarYReproducir();
  for (let k = 0; k < 20; k += 1) await vaciarMicrotareas();
  comprobar(pedidas === 0, `una frase sin voz a +0,05 s se salta sin pedir su voz (pedidas: ${pedidas}; antes, bucle infinito que congelaba la página)`);
  motor.destruir();
}
{
  const { DubbingService, agruparPorTiempo } = await modulo('dubbingService.js');
  // Tope por síntesis: una voz colgada no ocupa su turno 90 s.
  let senal = null;
  const lenta = new DubbingService({
    tiempoMaxMs: 60, medirHabla: async () => null, medirDuracion: async () => 1,
    generarAudio: (texto, unidad, opciones) => { senal = opciones?.signal; return new Promise(() => {}); },
  });
  lenta.definirUnidades(agruparPorTiempo([{ startTime: 0, endTime: 3, text: 'hola mundo.' }]));
  lenta.fijarTexto(0, 'hola mundo');
  const inicio = Date.now();
  const error = await lenta.asegurar(0).then(() => null, (e) => e);
  comprobar(error && Date.now() - inicio < 1000 && lenta.unidades[0].estado === 'error', 'una síntesis colgada se abandona al pasar su tope (no a los 90 s)');
  comprobar(senal?.aborted === true, 'y su petición se aborta (la señal llega a quien genera la voz)');
  comprobar(lenta.unidades[0].reintentarEn > Date.now(), 'la frase fallida espera su pausa antes de reintentarse');

  // El proveedor vuelve: las frases que fallaron EN LA CAÍDA recuperan sus intentos.
  let caido = true;
  const voz = new DubbingService({
    tiempoMaxMs: 0, medirHabla: async () => null, medirDuracion: async () => 1,
    generarAudio: async () => { if (caido) throw new Error('HTTP 503'); return new Blob(['x']); },
  });
  voz.definirUnidades(agruparPorTiempo([
    { startTime: 0, endTime: 3, text: 'uno.' }, { startTime: 4, endTime: 7, text: 'dos.' }, { startTime: 8, endTime: 11, text: 'tres.' },
  ]));
  voz.unidades.forEach((u, i) => voz.fijarTexto(i, `frase ${i}`));
  for (let vuelta = 0; vuelta < 6; vuelta += 1) {
    await voz.asegurar(0).catch(() => {});
    await voz.asegurar(1).catch(() => {});
  }
  comprobar(voz.unidades[0].reintentosVoz === 6 && voz.unidades[1].reintentosVoz === 6, 'en una caída larga las frases agotan sus intentos');
  caido = false;
  await voz.asegurar(2);
  comprobar(voz.unidades[0].reintentosVoz === 0 && voz.unidades[1].reintentosVoz === 0 && !(voz.unidades[0].reintentarEn > 0),
    'al volver la voz, las frases de la caída recuperan sus intentos (no quedan en inglés para siempre)');
}

{
  // Un tramo que la IA no devolvió (null) se vuelve a pedir en la MISMA sesión
  // y, al llegar, su frase recupera la voz (antes quedaba en inglés hasta reabrir).
  const { MotorPreparacion } = await modulo('motorPreparacion.js');
  const { DubbingService, agruparPorTiempo } = await modulo('dubbingService.js');
  const segmentos = [
    { startTime: 0, endTime: 3, text: 'One.' }, { startTime: 3.1, endTime: 6, text: 'Two.' },
    { startTime: 6.1, endTime: 9, text: 'Three.' }, { startTime: 9.1, endTime: 12, text: 'Four.' },
  ];
  const servicioVoz = new DubbingService({ generarAudio: async () => new Blob(['x']), medirHabla: async () => null, medirDuracion: async () => 1, tiempoMaxMs: 0 });
  servicioVoz.definirUnidades(agruparPorTiempo(segmentos));
  let veces = 0;
  const pedidos = [];
  const traductor = {
    async traducirLote(indices) {
      pedidos.push(indices.join());
      veces += 1;
      return new Map(indices.map((i) => [i, i === 2 && veces === 1 ? null : `es ${i}`]));
    },
  };
  let reloj = 0;
  const motor = new MotorPreparacion({
    segmentos, servicioVoz, traductor, posicion: () => 0, ahora: () => reloj,
    reloj: { iniciar() {}, detener() {} }, intervaloTraduccionMs: 0, intervaloFondoMs: 0,
  });
  for (let k = 0; k < 10; k += 1) { reloj += 5000; motor.paso(); await vaciarMicrotareas(); }
  const unidad = servicioVoz.unidades.find((u) => u.desde <= 2 && 2 <= u.hasta);
  comprobar(motor.traducciones.get(2) === 'es 2', `el tramo sin traducción se volvió a pedir y llegó (pedidos: ${pedidos.join(' | ')})`);
  comprobar(unidad && unidad.text.includes('es 2') && unidad.estado !== 'sin_voz', 'y su frase recupera la voz en español');
  comprobar(motor.errores.traduccion === 0, 'un fallo que se recuperó no se anuncia como tramo en inglés');
}

const sano = (azar) => () => ({ ms: 700 + azar() * 1800 });
const resumen = (m) => `inglés ${m.ingles} s (racha máx ${m.inglesMax} s) · sin subtítulo ${m.sinSub} s (máx ${m.sinSubMax} s) · video esperando voz ${m.esperaVoz} s (máx ${m.esperaMax} s) · traducido al final ${Math.round(m.traducidoAlFinal * 100)} % (todo a los ${m.todoTraducidoS ?? '—'} s)`;

// 1) Red sana: nada debe frenarse.
{
  const azar = aleatorio(11);
  const m = await simular({ minutos: Number(process.env.JG_MIN || 70), voz: sano(azar), traduccion: sano(azar) });
  console.log(`  red sana: ${resumen(m)}`);
  comprobar(m.terminó, 'red sana: el video de 70 min llega al final');
  comprobar(m.inglesMax < 3, 'red sana: ningún tramo seguido en inglés de 3 s o más');
  comprobar(m.sinSubMax === 0, 'red sana: nunca falta el subtítulo');
  comprobar(m.todoTraducidoS > 0 && m.todoTraducidoS < 12 * 60, 'red sana: el video de 70 min queda traducido entero en menos de 12 min (subtítulos y biblioteca completos)');
}

// 2) Voz con latencias como las medidas (edge-tts 1-41 s; GET 45 s que falla + POST).
//    1 de cada 25 síntesis se cuelga 90 s; 1 de cada 10 tarda 15-40 s.
{
  const azar = aleatorio(23);
  const voz = () => {
    const x = azar();
    if (x < 0.04) return { ms: 90_000 };
    if (x < 0.14) return { ms: 15_000 + azar() * 25_000 };
    return { ms: 700 + azar() * 1800 };
  };
  const m = await simular({ minutos: Number(process.env.JG_MIN || 70), voz, traduccion: sano(aleatorio(5)) });
  console.log(`  voz lenta a ratos: ${resumen(m)}`);
  comprobar(m.terminó, 'voz lenta a ratos: el video llega al final');
  comprobar(m.inglesMax < 6, 'voz lenta a ratos: ningún tramo seguido en inglés de 6 s o más');
  comprobar(m.ingles < 60, 'voz lenta a ratos: menos de 1 min en inglés en 70 min');
  comprobar(m.esperaMax < 31, 'voz lenta a ratos: el video nunca espera la voz más de 30 s seguidos');
}

// 3) La voz se cae 2 minutos (minuto 30 a 32 de reloj): falla rápido con 503.
{
  const azar = aleatorio(31);
  const inicio = 1_000_000 + 30 * 60_000;
  const voz = (n, ahora) => (ahora >= inicio && ahora < inicio + 120_000
    ? { ms: 400, error: new Error('La voz no respondió (HTTP 503).') }
    : { ms: 700 + azar() * 1800 });
  const m = await simular({ minutos: Number(process.env.JG_MIN || 70), voz, traduccion: sano(aleatorio(9)) });
  console.log(`  voz caída 2 min: ${resumen(m)}`);
  comprobar(m.terminó, 'voz caída 2 min: el video llega al final');
  comprobar(m.inglesMax < 10, 'voz caída 2 min: el colchón cubre la caída (ningún tramo en inglés de 10 s)');
}

// 4) El traductor responde 429 durante 4 minutos (minuto 20 a 24).
{
  const azar = aleatorio(41);
  const inicio = 1_000_000 + 20 * 60_000;
  const traduccion = (n, ahora) => (ahora >= inicio && ahora < inicio + 240_000
    ? { ms: 600, error: new Error('mistral: límite de uso alcanzado (429).') }
    : { ms: 700 + azar() * 1800 });
  const m = await simular({ minutos: Number(process.env.JG_MIN || 70), voz: sano(aleatorio(3)), traduccion });
  console.log(`  traductor en 429 4 min: ${resumen(m)}`);
  comprobar(m.terminó, 'traductor en 429: el video llega al final');
  comprobar(m.sinSubMax === 0, 'traductor en 429: nunca falta el subtítulo (ya estaba traducido por delante)');
  comprobar(m.inglesMax < 3, 'traductor en 429: la voz no se frena');
  comprobar(m.traducidoAlFinal === 1, 'traductor en 429: al final el video entero quedó traducido (subtítulos completos)');
}

// 5) La voz se cae 6 MINUTOS (más que el colchón): al volver, la voz vuelve sola
//    y en poco tiempo (antes, las frases de la caída quedaban en inglés para siempre).
{
  const inicio = 25 * 60_000;
  const fin = inicio + 6 * 60_000;
  const vozCaida = (azar) => (n, ahora) => {
    const reloj = ahora - 1_000_000;
    return reloj >= inicio && reloj < fin ? { ms: 400, error: new Error('La voz no respondió (HTTP 503).') } : { ms: 700 + azar() * 1800 };
  };
  const minutos = Number(process.env.JG_MIN || 70);
  const durante = await simular({ minutos, voz: vozCaida(aleatorio(53)), traduccion: sano(aleatorio(13)) });
  console.log(`  voz caída 6 min (todo): ${resumen(durante)}`);
  const despues = await simular({ minutos, voz: vozCaida(aleatorio(53)), traduccion: sano(aleatorio(13)), medirDesdeS: fin / 1000 + 60 });
  console.log(`  voz caída 6 min (desde 1 min después de volver): ${resumen(despues)}`);
  comprobar(durante.terminó, 'voz caída 6 min: el video llega al final');
  comprobar(durante.esperaMax < 31, 'voz caída 6 min: el video nunca queda detenido más de 30 s seguidos');
  comprobar(despues.inglesMax < 3, 'voz caída 6 min: 1 min después de volver el proveedor, ya no hay tramos en inglés');
}

// 6) La persona salta del minuto 5 al 50: la voz y el subtítulo se ponen al día rápido.
{
  let salto = false;
  const m = await simular({
    minutos: 70, voz: sano(aleatorio(61)), traduccion: sano(aleatorio(67)),
    alPaso: ({ jugador }) => {
      if (!salto && jugador.t >= 5 * 60) { salto = true; jugador.t = 50 * 60; }
    },
  });
  console.log(`  salto 5 → 50 min: ${resumen(m)}`);
  comprobar(salto && m.terminó, 'salto: el video llega al final');
  comprobar(m.esperaMax < 8, 'salto: tras el salto la voz espera menos de 8 s');
  // Lo que tarda UNA traducción corta (0,7-2,5 s): el resto ya viene hecho de fondo.
  comprobar(m.sinSubMax <= 3, 'salto: el subtítulo del punto nuevo aparece en 3 s como mucho');
  comprobar(m.inglesMax < 3, 'salto: sin tramos en inglés');
}

console.log(`\n${ok} comprobaciones OK · ${fallos} fallos`);
process.exit(fallos ? 1 : 0);
