/* Simulador de la voz del doblaje (Video-C, 2026-10-03).
 * Reproductor, audios, reloj y síntesis VIRTUALES: sin navegador ni red, con
 * tiempo virtual (un paso = `pasoMs`). Lo comparten las pruebas de robustez de
 * la voz (tests/test_voz_robusta.mjs).
 *
 * Qué hace distinto del simulador de test_youtube_sincronia.mjs:
 *  - el audio sigue el algoritmo real de `src`/`load()` (pausa, vuelve a 0),
 *  - `play()` tarda `latenciaPlayMs` en sonar (el navegador real ronda 40 ms),
 *  - el reloj del motor se puede ESTRANGULAR (pestaña oculta: un tic por segundo)
 *    o CONGELAR (teléfono bloqueado: nada corre y los eventos llegan juntos),
 *  - la síntesis tiene latencia y cuota por minuto (Azure F0), como producción.
 */
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const modulo = (nombre) => import(pathToFileURL(path.join(raiz, 'js/youtube', nombre)).href);

export class JugadorVirtual {
  constructor() {
    this.t = 0; this.tasa = 1; this.estado = 2; this.vol = 100; this.mudo = false; this.duracion = 100000;
    this.estados = new Set(); this.velocidades = new Set(); this.tasasVistas = [1];
  }
  avanzar(ms) { if (this.estado === 1) this.t += (ms / 1000) * this.tasa; }
  getCurrentTime() { return this.t; }
  getDuration() { return this.duracion; }
  getPlaybackRate() { return this.tasa; }
  setPlaybackRate(r) { this.tasa = Number(r); this.tasasVistas.push(this.tasa); this.velocidades.forEach((f) => f(this.tasa)); }
  getPlayerState() { return this.estado; }
  playVideo() { if (this.estado === 1) return; this.estado = 1; this.estados.forEach((f) => f('playing')); }
  pauseVideo() { if (this.estado === 2) return; this.estado = 2; this.estados.forEach((f) => f('paused')); }
  /** Red lenta o giro: YouTube pasa por «buffering» y vuelve. */
  buffering() { this.estado = 3; this.estados.forEach((f) => f('buffering')); }
  seekTo(s) { this.t = Math.max(0, Number(s) || 0); }
  getVolume() { return this.vol; } setVolume(v) { this.vol = Number(v); }
  mute() { this.mudo = true; } unMute() { this.mudo = false; } isMuted() { return this.mudo; }
  suscribirEstado(f) { this.estados.add(f); return () => this.estados.delete(f); }
  suscribirVelocidad(f) { this.velocidades.add(f); return () => this.velocidades.delete(f); }
}

export class AudioVirtual {
  constructor(sim) {
    this.sim = sim;
    this.srcActual = ''; this.currentTimeInterno = 0; this.duration = Number.NaN;
    this.paused = true; this.ended = false; this.playbackRate = 1; this.volume = 1;
    this.oyentes = {}; this.cargando = false; this.espera = 0; this.inicioAnotado = false;
  }
  get src() { return this.srcActual; }
  /** Fin de la voz dentro del archivo: lo que sigue es silencio. */
  finVoz() { return this.sim.finesVoz.get(this.srcActual) ?? this.duration; }
  #detener(motivo) {
    // Registra cómo terminó lo que sonaba: completa (llegó al final de la voz) o cortada.
    if (this.inicioAnotado && this.srcActual) {
      const completa = this.currentTimeInterno >= this.finVoz() - 0.05;
      const r = this.sim.registro;
      if (completa) r.completas.push(this.srcActual);
      else if (this.sim.jugador.estado === 1 && this.sim.ahora > this.sim.cortesPermitidosHasta) {
        r.cortes.push({ url: this.srcActual, en: this.currentTimeInterno, motivo });
      }
      r.paradas.push({ url: this.srcActual, completa, motivo });
    }
    this.inicioAnotado = false;
  }
  set src(valor) {
    if (!this.paused || this.inicioAnotado) this.#detener('src');
    this.srcActual = valor;
    this.paused = true; this.ended = false; this.currentTimeInterno = 0;
    this.duration = Number.NaN; this.cargando = Boolean(valor); this.espera = 0;
  }
  get currentTime() { return this.currentTimeInterno; }
  set currentTime(valor) {
    this.currentTimeInterno = Math.max(0, Math.min(valor, Number.isFinite(this.duration) ? this.duration : valor));
    this.ended = false;
  }
  addEventListener(tipo, f) { (this.oyentes[tipo] ||= []).push(f); this.sim.registro.oyentesAltas += 1; }
  removeEventListener(tipo, f) {
    const lista = this.oyentes[tipo] || [];
    const i = lista.indexOf(f);
    if (i >= 0) { lista.splice(i, 1); this.sim.registro.oyentesBajas += 1; }
  }
  totalOyentes() { return Object.values(this.oyentes).reduce((n, l) => n + l.length, 0); }
  emitir(tipo) {
    if (this.sim.congelado) { this.sim.diferidos.push(() => this.emitir(tipo)); return; }
    [...(this.oyentes[tipo] || [])].forEach((f) => f());
  }
  removeAttribute() { this.src = ''; }
  load() {
    if (this.inicioAnotado) this.#detener('load');
    this.currentTimeInterno = 0; this.ended = false; this.paused = true; this.duration = Number.NaN;
    this.cargando = Boolean(this.srcActual); this.espera = 0;
  }
  play() {
    if (!this.srcActual) return Promise.reject(Object.assign(new Error('sin src'), { name: 'NotSupportedError' }));
    if (this.paused) { this.espera = this.sim.latenciaPlayMs; this.paused = false; this.ended = false; this.sim.registro.llamadasPlay += 1; }
    return Promise.resolve();
  }
  pause() {
    if (this.paused) return;
    this.#detener('pause');
    this.paused = true;
  }
  avanzar(ms) {
    if (this.cargando) {
      this.cargando = false;
      this.duration = this.sim.duraciones.get(this.srcActual) ?? 1;
      this.emitir('loadedmetadata');
    }
    if (this.paused || this.ended || !Number.isFinite(this.duration)) return;
    if (this.espera > 0) { this.espera -= ms; if (this.espera > 0) return; }
    if (!this.inicioAnotado) {
      this.inicioAnotado = true;
      this.sim.registro.inicios.push({ url: this.srcActual, desde: this.currentTimeInterno, video: this.sim.jugador.t, real: this.sim.ahora });
    }
    this.currentTimeInterno += (ms / 1000) * this.playbackRate;
    if (this.currentTimeInterno >= this.duration) {
      this.currentTimeInterno = this.duration;
      this.ended = true; this.paused = true;
      this.#detener('ended');
      this.emitir('ended');
    }
  }
}

/** Frases contiguas de `ventana` s de video; la voz de cada una dura `voz` s a 1×. */
export function unidadesContinuas(cantidad, { ventana = 4, voz = 3, segmentosPorFrase = 1, estado = 'listo' } = {}) {
  return Array.from({ length: cantidad }, (_, i) => ({
    indice: i, startTime: i * ventana, finHabla: i * ventana + ventana - 0.1, endTime: (i + 1) * ventana,
    duration: ventana, desde: i * segmentosPorFrase, hasta: i * segmentosPorFrase + segmentosPorFrase - 1,
    text: 'x'.repeat(Math.round(voz * 17.5)), estado, url: estado === 'listo' ? `voz-${i}` : '', duracionVoz: voz,
  }));
}

/**
 * Síntesis virtual con latencia y cuota por minuto. Las unidades que no están
 * «listo» se fabrican al pedirlas (`asegurar`) y tardan `latenciaMs` más lo que
 * imponga la cuota. Lo urgente (la frase que ya toca) pasa delante del colchón.
 */
export class SintesisVirtual {
  constructor(sim, unidades, { latenciaMs = 1500, porMinuto = 18, voz = 3 } = {}) {
    Object.assign(this, { sim, unidades, latenciaMs, porMinuto, voz });
    this.cola = []; this.enCurso = []; this.inicios = []; this.completadas = 0; this.destruido = false;
  }
  segundosListosDesde(t) {
    let fin = t;
    for (const u of this.unidades) {
      if (u.endTime <= t) continue;
      if (u.estado !== 'listo' && u.estado !== 'sin_voz') break;
      fin = Math.max(fin, u.endTime);
    }
    return fin - t;
  }
  asegurarColchon(t, segundos) {
    const tareas = [];
    for (const u of this.unidades) {
      if (u.endTime <= t || u.startTime > t + segundos) continue;
      if (u.estado === 'pendiente' || u.estado === 'error') tareas.push(this.#pedir(u, false));
    }
    return Promise.allSettled(tareas);
  }
  asegurar(indice) { return this.#pedir(this.unidades[indice], true); }
  #pedir(u, urgente) {
    if (u.estado === 'listo') return Promise.resolve(u);
    if (u.promesa) {
      if (urgente) { const i = this.cola.findIndex((c) => c.u === u); if (i > 0) this.cola.unshift(this.cola.splice(i, 1)[0]); }
      return u.promesa;
    }
    u.estado = 'cargando';
    u.promesa = new Promise((resolver) => {
      const tarea = { u, resolver };
      if (urgente) this.cola.unshift(tarea); else this.cola.push(tarea);
    });
    return u.promesa;
  }
  invalidarDesde(t) {
    for (const u of this.unidades) {
      if (u.startTime < t || u.estado !== 'listo') continue;
      u.estado = 'pendiente'; u.url = '';
    }
  }
  liberarAntesDe() {}
  /** Se llama en cada paso de tiempo virtual. */
  avanzar(ahora) {
    this.inicios = this.inicios.filter((ms) => ahora - ms < 60000);
    while (this.cola.length && this.enCurso.length < 2 && this.inicios.length < this.porMinuto) {
      const tarea = this.cola.shift();
      this.inicios.push(ahora);
      this.enCurso.push({ ...tarea, listoEn: ahora + this.latenciaMs });
    }
    for (const trabajo of [...this.enCurso]) {
      if (ahora < trabajo.listoEn) continue;
      this.enCurso.splice(this.enCurso.indexOf(trabajo), 1);
      const u = trabajo.u;
      u.url = `voz-${u.indice}-${this.completadas}`;
      this.sim.duraciones.set(u.url, this.voz);
      u.duracionVoz = this.voz;
      u.estado = 'listo';
      u.promesa = null;
      this.completadas += 1;
      trabajo.resolver(u);
    }
  }
}

/**
 * Escenario completo. Opciones:
 *  - ritmoAutomatico / esperarVoz / esperarFrase: las del motor.
 *  - latenciaPlayMs: retardo entre `play()` y el sonido (por defecto 40 ms).
 *  - sintesis: { latenciaMs, porMinuto } → las unidades arrancan «pendiente» y se fabrican al pedirlas.
 */
export async function crearEscenario(unidades, {
  ritmoAutomatico = true, esperarVoz = false, esperarFrase, pasoMs = 20, latenciaPlayMs = 40,
  servicio = null, sintesis = null, voz = 3, DubbingEngine = null, motorExtra = {}, crearAudioCompartido = null,
} = {}) {
  // JG_MOTOR=_motor_viejo.js corre las mismas pruebas contra otra versión del motor (comparar antes/después).
  const { DubbingEngine: Motor } = await modulo(process.env.JG_MOTOR || 'dubbingEngine.js');
  const sim = {
    ahora: 0, pasoMs, latenciaPlayMs, congelado: false, diferidos: [], ticMs: 100, cortesPermitidosHasta: -1,
    duraciones: new Map(), finesVoz: new Map(),
    registro: {
      cortes: [], completas: [], paradas: [], inicios: [], estados: [], tasasBase: [], llamadasPlay: 0,
      oyentesAltas: 0, oyentesBajas: 0,
    },
  };
  for (const u of unidades) {
    if (u.url) sim.duraciones.set(u.url, u.audioS ?? u.duracionVoz);
    if (u.finVozS && u.url) sim.finesVoz.set(u.url, u.finVozS);
  }
  const jugador = new JugadorVirtual();
  sim.jugador = jugador;
  const sint = sintesis ? new SintesisVirtual(sim, unidades, { ...sintesis, voz }) : null;
  const audios = [];
  let tic = null;
  const motor = new (DubbingEngine || Motor)({
    player: jugador,
    servicio: servicio || sint || { unidades, asegurar: (i) => Promise.resolve(unidades[i]) },
    crearAudio: () => {
      const a = crearAudioCompartido ? crearAudioCompartido(sim) : new AudioVirtual(sim);
      audios.push(a);
      return a;
    },
    reloj: (f) => { tic = f; return { iniciar() {}, detener() {}, activo: true }; },
    ahora: () => sim.ahora,
    ritmoAutomatico, esperarVoz, ...(esperarFrase === undefined ? {} : { esperarFrase }),
    onStatus: (mensaje, tipo) => sim.registro.estados.push({ mensaje, tipo, en: sim.ahora }),
    onTasaBase: (tasa) => sim.registro.tasasBase.push(tasa),
    ...motorExtra,
  });
  Object.assign(sim, { motor, audios, sintesis: sint });

  /** Corre `segundos` de tiempo virtual. `alPaso(ahora)` se llama en cada paso. */
  sim.correr = async (segundos, alPaso = null) => {
    const pasos = Math.round((segundos * 1000) / pasoMs);
    for (let k = 0; k < pasos; k += 1) {
      sim.ahora += pasoMs;
      if (!sim.congelado) {
        jugador.avanzar(pasoMs);
        for (const a of audios) a.avanzar(pasoMs);
        if (sim.ahora % sim.ticMs === 0) tic?.();
        sint?.avanzar(sim.ahora);
      } else {
        // Congelado: el video (otro proceso) y el audio nativo siguen; el JS no corre.
        jugador.avanzar(pasoMs);
        for (const a of audios) a.avanzar(pasoMs);
      }
      if (alPaso) alPaso(sim.ahora);
      await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    }
  };
  /** Pestaña oculta: el navegador deja pasar un tic por segundo. */
  sim.ocultar = () => { sim.ticMs = 1000; };
  sim.mostrar = () => { sim.ticMs = 100; };
  /** Teléfono bloqueado: nada de JS hasta `descongelar` (los eventos llegan de golpe). */
  sim.congelar = () => { sim.congelado = true; };
  sim.descongelar = () => {
    sim.congelado = false;
    const pendientes = sim.diferidos.splice(0);
    pendientes.forEach((f) => f());
  };
  sim.permitirCortes = (ms = 800) => { sim.cortesPermitidosHasta = sim.ahora + ms; };
  sim.tic = () => tic?.();
  /** Latencia de entrada (s de video) de cada frase: cuándo suena frente a su segundo. */
  sim.latencias = () => sim.registro.inicios
    .filter((p) => p.desde < 0.3)
    .map((p) => {
      const unidad = unidades[Number(String(p.url).split('-')[1])];
      return unidad ? p.video - unidad.startTime : null;
    })
    .filter((x) => x !== null);
  return sim;
}

export function percentil(valores, p = 0.95) {
  const d = [...valores].sort((a, b) => a - b);
  return d.length ? d[Math.min(d.length - 1, Math.max(0, Math.ceil(p * d.length) - 1))] : 0;
}
