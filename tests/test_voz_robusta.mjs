/* Doblaje · la voz no se pierde, no se corta y no llega tarde (Video-C, 2026-10-03).
 * Sin navegador ni red: simulador de tests/_simulador_voz.mjs (tiempo virtual).
 * Ejecutar: node tests/test_voz_robusta.mjs
 *
 * Cada escenario cuenta FRASES: esperadas = las que el video recorrió con la
 * persona presente; sonadas completas = las que llegaron al final de su voz.
 * Los cortes solo cuentan si la persona NO hizo nada (pausa, búsqueda, cambio).
 */
import { crearEscenario, unidadesContinuas, modulo, percentil, AudioVirtual } from './_simulador_voz.mjs';

let ok = 0;
let fallos = 0;
function comprobar(condicion, mensaje) {
  if (condicion) { ok += 1; console.log(`OK: ${mensaje}`); }
  else { fallos += 1; console.error(`FALLO: ${mensaje}`); }
}
const indiceDe = (url) => Number(String(url).split('-')[1]);
const ms = (s) => Math.round(s * 1000);
/** Índices (únicos) de las frases que sonaron completas. */
const sonadas = (sim) => [...new Set(sim.registro.completas.map(indiceDe))].sort((a, b) => a - b);
/** Frases cuyo inicio cae en [desdeS, hastaS) del video. */
const esperadas = (unidades, desdeS, hastaS) => unidades.filter((u) => u.startTime >= desdeS && u.startTime < hastaS).map((u) => u.indice);
const faltan = (esp, son) => esp.filter((i) => !son.includes(i));
/** Pares de inicios a menos de `ventanaMs` de distancia (una ráfaga). */
const rafagas = (sim, ventanaMs = 1000) => {
  const reales = sim.registro.inicios.filter((p) => p.desde < 0.3).map((p) => p.real).sort((a, b) => a - b);
  let n = 0;
  for (let i = 1; i < reales.length; i += 1) if (reales[i] - reales[i - 1] < ventanaMs) n += 1;
  return n;
};

// ── 1. Reproducción continua: cada frase suena, entera, en su segundo ────
{
  const unidades = unidadesContinuas(45, { voz: 3 });
  const s = await crearEscenario(unidades);
  s.motor.activarYReproducir();
  await s.correr(150);
  const esp = esperadas(unidades, 0, 146);
  const son = sonadas(s);
  const lat = s.latencias();
  comprobar(faltan(esp, son).length === 0, `continua: ${son.length} frases sonadas = ${esp.length} esperadas (0 saltadas)`);
  comprobar(s.registro.cortes.length === 0, `continua: 0 cortes (${s.registro.cortes.length})`);
  comprobar(s.motor.metricas().frasesSaltadas === 0, 'continua: el motor no dio ninguna frase por perdida');
  const p95 = percentil(lat.map(Math.abs), 0.95);
  comprobar(lat.length >= esp.length && p95 <= 0.15, `continua: latencia de entrada p95 ${ms(p95)} ms ≤ 150 ms (n=${lat.length}, de ${ms(Math.min(...lat))} a ${ms(Math.max(...lat))} ms)`);
  comprobar(rafagas(s) === 0, 'continua: nunca dos frases arrancan en el mismo segundo');
}

// ── 2. Pausar y seguir, varias veces y en puntos distintos ───────────────
{
  const unidades = unidadesContinuas(40, { voz: 3 });
  const s = await crearEscenario(unidades);
  s.motor.activarYReproducir();
  const pausas = [5.3, 17.9, 31.2, 44.6, 58.1, 70.4];   // casi todas caen a mitad de una frase
  let siguiente = 0;
  let reanudarEn = null;
  await s.correr(100, () => {
    const t = s.jugador.t;
    if (reanudarEn !== null && s.ahora >= reanudarEn) { reanudarEn = null; s.jugador.playVideo(); }
    else if (reanudarEn === null && siguiente < pausas.length && t >= pausas[siguiente]) {
      siguiente += 1; s.jugador.pauseVideo(); reanudarEn = s.ahora + 2500;
    }
  });
  const hasta = Math.floor(s.jugador.t) - 4;
  const esp = esperadas(unidades, 0, hasta);
  comprobar(siguiente === pausas.length, `pausas: ${siguiente} pausas hechas`);
  comprobar(faltan(esp, sonadas(s)).length === 0, `pausas: ${esp.length} frases esperadas, todas suenan completas tras pausar y seguir`);
  comprobar(s.registro.cortes.length === 0, `pausas: 0 cortes por pausar (${s.registro.cortes.length})`);
  // Una frase pausada retoma donde iba, no empieza de cero.
  const reinicios = s.registro.inicios.filter((p, i, l) => l.findIndex((q) => q.url === p.url) !== i && p.desde < 0.3);
  comprobar(reinicios.length === 0, `pausas: ninguna frase se repite desde cero (${reinicios.length})`);
}

// ── 3. Adelantar / retroceder con la barra de YouTube ────────────────────
{
  const unidades = unidadesContinuas(80, { voz: 3 });
  const s = await crearEscenario(unidades);
  s.motor.activarYReproducir();
  await s.correr(13);   // a mitad de la frase 3 (12–16)
  const inicial = s.registro.inicios.length;
  s.permitirCortes();
  s.jugador.seekTo(121);   // adelante, a mitad de la frase 30 (120–124)
  await s.correr(5);
  const tras1 = s.registro.inicios.slice(inicial);
  comprobar(tras1[0] && indiceDe(tras1[0].url) === 30 && tras1[0].desde > 0.5, `barra adelante: suena la frase del punto nuevo, retomada (${tras1[0]?.url}, desde ${tras1[0]?.desde.toFixed(2)})`);
  comprobar(!tras1.some((p) => indiceDe(p.url) < 30), 'barra adelante: ninguna frase del lugar anterior se cuela');
  const n2 = s.registro.inicios.length;
  s.permitirCortes();
  s.jugador.seekTo(40.2);   // atrás, muy cerca del principio de la frase 10 (40–44)
  await s.correr(6);
  const tras2 = s.registro.inicios.slice(n2);
  comprobar(tras2[0] && indiceDe(tras2[0].url) === 10 && tras2[0].desde < 0.4, `barra atrás: la frase del punto nuevo suena desde su principio (${tras2[0]?.url})`);
  comprobar(!tras2.some((p) => indiceDe(p.url) > 11 && s.jugador.t < 50), 'barra atrás: sin frases del futuro');
  // Salto chico (1 s): no se detecta como salto, pero la voz no debe quedar atrás para siempre.
  const antes = s.jugador.t;
  s.jugador.seekTo(antes + 1.0);
  await s.correr(20);
  const n3 = s.registro.inicios.length;
  await s.correr(20);
  const lat = s.latencias().slice(-4);
  comprobar(lat.length > 0 && lat.every((x) => Math.abs(x) <= 0.15), `barra, salto de 1 s: tras la siguiente frase la voz vuelve a entrar en su segundo (${lat.map((x) => ms(x)).join(', ')} ms)`);
  comprobar(s.registro.cortes.length === 0, `barra: 0 cortes ajenos a la búsqueda (${s.registro.cortes.length})`);
  void n3;
}

// ── 4. Cambiar de pestaña de la app y volver (pausarTodo + «Ver con voz») ─
{
  const unidades = unidadesContinuas(40, { voz: 3 });
  const s = await crearEscenario(unidades);
  s.motor.activarYReproducir();
  await s.correr(21.5);   // a mitad de la frase 5 (20–24)
  const hablaba = s.motor.hablando;
  s.motor.pausarTodo();
  await s.correr(8);
  comprobar(s.jugador.estado === 2 && s.audios.every((a) => a.paused), 'pestaña: al irse, video y voz quedan quietos');
  const t = s.jugador.t;
  const inicios = s.registro.inicios.length;
  s.motor.activarYReproducir();
  await s.correr(20);
  const reanudo = s.registro.inicios[inicios];
  comprobar(hablaba === 5 && reanudo && indiceDe(reanudo.url) === 5 && reanudo.desde > 0.5, `pestaña: al volver sigue la MISMA frase donde iba (${reanudo?.url}, desde ${reanudo?.desde.toFixed(2)})`);
  comprobar(s.jugador.t > t + 15 && faltan(esperadas(unidades, 0, 35), sonadas(s)).length === 0, 'pestaña: y el resto suena completo y en orden');
  comprobar(s.registro.cortes.length === 0, `pestaña: 0 cortes ajenos (${s.registro.cortes.length})`);
}

// ── 5. Pestaña oculta: el reloj pasa a un tic por segundo ────────────────
{
  const unidades = unidadesContinuas(45, { voz: 3 });
  const s = await crearEscenario(unidades);
  s.motor.activarYReproducir();
  await s.correr(20);
  s.ocultar();
  const inicioOculta = s.registro.inicios.length;
  await s.correr(30);
  const finOculta = s.registro.inicios.length;
  s.mostrar();
  await s.correr(40);
  const hasta = Math.floor(s.jugador.t) - 4;
  const esp = esperadas(unidades, 0, hasta);
  comprobar(faltan(esp, sonadas(s)).length === 0, `oculta: ${esp.length} frases esperadas (20 s a la vista, 30 s oculta, 40 s a la vista), ninguna se pierde`);
  comprobar(s.registro.cortes.length === 0, `oculta: 0 cortes (${s.registro.cortes.length})`);
  comprobar(s.motor.metricas().frasesSaltadas === 0, 'oculta: ninguna frase dada por perdida');
  comprobar(rafagas(s) === 0, `oculta: sin ráfagas de frases atrasadas (${rafagas(s)})`);
  const ocultas = s.registro.inicios.slice(inicioOculta, finOculta).filter((p) => p.desde < 0.3);
  const atrasoOculta = ocultas.map((p) => p.video - unidades[indiceDe(p.url)].startTime);
  comprobar(Math.max(...atrasoOculta) <= 1.1, `oculta: con un tic por segundo la voz llega como mucho ${ms(Math.max(...atrasoOculta))} ms tarde (≤ 1,1 s)`);
  const trasMostrar = s.latencias().slice(-6);
  comprobar(trasMostrar.every((x) => Math.abs(x) <= 0.15), `oculta→visible: tras volver, las frases entran en su segundo (${trasMostrar.map((x) => ms(x)).join(', ')} ms)`);
  comprobar(Math.min(...s.jugador.tasasVistas) === 1, `oculta: el reloj lento no frena el video por error (mínimo ${Math.min(...s.jugador.tasasVistas)}×)`);
}

// ── 6. Teléfono bloqueado y desbloqueado: el JS se congela, el video sigue ─
{
  const unidades = unidadesContinuas(45, { voz: 3 });
  const s = await crearEscenario(unidades);
  s.motor.activarYReproducir();
  await s.correr(21.5);   // a mitad de la frase 5
  s.congelar();
  await s.correr(7);   // 7 s sin JS: el audio nativo termina su frase y se calla
  const tCongelado = s.jugador.t;
  const inicios = s.registro.inicios.length;
  s.descongelar();
  s.mostrar();
  s.tic();
  await s.correr(0.6);
  const nuevos = s.registro.inicios.slice(inicios);
  const esperada = unidades.findIndex((u) => u.startTime <= s.jugador.t && s.jugador.t < u.endTime);
  comprobar(nuevos.length <= 1, `bloqueo: al volver arranca como mucho UNA frase, no una ráfaga (${nuevos.length})`);
  comprobar(nuevos.length === 0 || indiceDe(nuevos[0].url) === esperada, `bloqueo: la frase que suena es la del segundo actual (${nuevos[0]?.url ?? 'ninguna aún'}; video en ${s.jugador.t.toFixed(1)} s, estaba en ${tCongelado.toFixed(1)} s)`);
  await s.correr(25);
  const posteriores = s.registro.inicios.slice(inicios).filter((p) => p.desde < 0.3);
  comprobar(rafagas(s) === 0, `bloqueo: 0 frases en ráfaga (${rafagas(s)})`);
  const latPost = s.latencias().slice(-5);
  comprobar(latPost.every((x) => Math.abs(x) <= 0.15), `bloqueo: tras desbloquear, la voz vuelve a su segundo (${latPost.map((x) => ms(x)).join(', ')} ms)`);
  comprobar(posteriores.every((p) => indiceDe(p.url) >= esperada), 'bloqueo: no suena ninguna frase de los segundos que pasaron con el teléfono bloqueado');
}

// ── 7. Pantalla completa y giro del teléfono: el video «parpadea» en buffering ─
{
  const unidades = unidadesContinuas(40, { voz: 3 });
  const s = await crearEscenario(unidades);
  s.motor.activarYReproducir();
  await s.correr(22);
  s.jugador.buffering();           // YouTube repinta al girar o entrar en pantalla completa
  await s.correr(0.4);
  s.jugador.playVideo();
  await s.correr(10);
  s.jugador.buffering();
  await s.correr(0.3);
  s.jugador.playVideo();
  await s.correr(30);
  const hasta = Math.floor(s.jugador.t) - 4;
  comprobar(faltan(esperadas(unidades, 0, hasta), sonadas(s)).length === 0, 'giro/pantalla completa: dos parpadeos de buffering y todas las frases suenan completas');
  comprobar(s.registro.cortes.length === 0, `giro/pantalla completa: 0 cortes (${s.registro.cortes.length})`);
}

// ── 8. Volumen y ritmo a mitad de una frase ─────────────────────────────
{
  const unidades = unidadesContinuas(30, { voz: 3 });
  const s = await crearEscenario(unidades);
  s.motor.activarYReproducir();
  await s.correr(21.5);
  s.motor.definirVolumenVoz(0.4);
  s.motor.definirVolumenFondo(30);
  await s.correr(0.5);
  s.motor.definirVolumenVoz(1);
  s.motor.definirRitmoAutomatico(false);
  await s.correr(0.5);
  s.motor.definirRitmoAutomatico(true);
  await s.correr(20);
  comprobar(s.audios.every((a) => Math.abs(a.volume - 1) < 1e-9), 'volumen: ambos audios quedan al volumen elegido');
  comprobar(s.registro.cortes.length === 0 && faltan(esperadas(unidades, 0, 38), sonadas(s)).length === 0, 'volumen y ritmo a mitad de frase: nada se corta ni se pierde');
}

// ── 9. Cambiar la voz a mitad (DubbingService real, síntesis virtual) ────
{
  const { DubbingService } = await modulo('dubbingService.js');
  const unidades = unidadesContinuas(40, { voz: 3, estado: 'pendiente' });
  const infoDeUrl = new Map();   // blob:… → { indice, version }
  let s = null;
  let version = 1;
  const trabajos = [];
  const servicio = new DubbingService({
    generarAudio: (texto, unidad) => new Promise((resolver) => { trabajos.push({ unidad, version, resolver, listoEn: s.ahora + 900 }); }),
    medirDuracion: async (url, { blob }) => {
      const [, v, i] = /voz(\d)-(\d+)/.exec(await blob.text());
      infoDeUrl.set(url, { indice: Number(i), version: Number(v) });
      s.duraciones.set(url, 3);
      return 3;
    },
    medirHabla: null,
  });
  servicio.definirUnidades(unidades);
  s = await crearEscenario(unidades, { servicio });
  const completarTrabajos = () => {
    for (const t of [...trabajos]) {
      if (s.ahora < t.listoEn) continue;
      trabajos.splice(trabajos.indexOf(t), 1);
      t.resolver({ blob: new Blob([`voz${t.version}-${unidades.indexOf(t.unidad)}`]) });
    }
  };
  const pedirCercanas = () => {
    for (let i = 0; i < unidades.length; i += 1) {
      if (unidades[i].startTime < s.jugador.t + 30 && unidades[i].estado === 'pendiente') servicio.asegurar(i).catch(() => {});
    }
  };
  pedirCercanas();
  await s.correr(2.5, completarTrabajos);
  s.motor.activarYReproducir();
  let tCambio = null;
  await s.correr(60, () => {
    completarTrabajos();
    pedirCercanas();
    if (tCambio === null && s.jugador.t >= 21.7) {
      tCambio = s.jugador.t; version = 2; servicio.invalidarDesde(tCambio + 1);
    }
  });
  const inicios = s.registro.inicios.filter((p) => p.desde < 0.3 && infoDeUrl.has(p.url)).map((p) => ({ ...p, ...infoDeUrl.get(p.url) }));
  const despues = inicios.filter((p) => unidades[p.indice].startTime >= tCambio + 1);
  const viejas = despues.filter((p) => p.version === 1);
  comprobar(tCambio !== null && despues.length > 5, `cambio de voz: ${despues.length} frases suenan después del cambio`);
  comprobar(viejas.length === 0, `cambio de voz: ninguna frase posterior suena con la voz vieja (${viejas.length})`);
  const completas = new Set(s.registro.completas.map((u) => infoDeUrl.get(u)?.indice));
  const hasta = Math.floor(s.jugador.t) - 4;
  const esp = esperadas(unidades, 0, hasta);
  comprobar(faltan(esp, [...completas]).length === 0, `cambio de voz: las ${esp.length} frases esperadas suenan, antes y después (faltan ${faltan(esp, [...completas]).join(',') || 'ninguna'})`);
  comprobar(s.registro.cortes.length === 0, `cambio de voz: la frase que sonaba no se corta (${s.registro.cortes.length})`);
  const latCambio = inicios.filter((p) => unidades[p.indice].startTime >= tCambio + 1).map((p) => p.video - unidades[p.indice].startTime);
  comprobar(Math.max(...latCambio.map(Math.abs)) <= 0.15, `cambio de voz: la voz nueva entra en su segundo (máx ${ms(Math.max(...latCambio.map(Math.abs)))} ms)`);
  servicio.liberar();
}

// ── 10. «Cambiar video»: cinco sesiones seguidas con los MISMOS dos audios ─
{
  const compartidos = [];
  const simVacio = { registro: { oyentesAltas: 0, oyentesBajas: 0, llamadasPlay: 0, inicios: [], completas: [], cortes: [], paradas: [] }, jugador: { estado: 2 }, finesVoz: new Map(), duraciones: new Map(), latenciaPlayMs: 0, ahora: 0, cortesPermitidosHasta: -1, diferidos: [] };
  let pedidos = 0;
  const reutilizar = (sim) => {
    pedidos += 1;
    const i = (pedidos - 1) % 2;
    compartidos[i] ||= new AudioVirtual(simVacio);
    compartidos[i].sim = sim;
    return compartidos[i];
  };
  const unidades = unidadesContinuas(10, { voz: 3 });
  let ultima = null;
  for (let k = 0; k < 5; k += 1) {
    const s = await crearEscenario(unidades, { crearAudioCompartido: reutilizar });
    s.motor.activarYReproducir();
    await s.correr(6);
    s.motor.destruir();
    ultima = s;
  }
  const total = compartidos.reduce((n, a) => n + a.totalOyentes(), 0);
  comprobar(compartidos.length === 2, 'sesiones: la app reutiliza dos audios (desbloqueados por el primer toque)');
  comprobar(total <= 6, `sesiones: tras 5 videos los dos audios llevan ${total} oyentes (≤ 6; 3 por audio, sin acumular)`);
  const quietos = compartidos.every((a) => a.paused);
  comprobar(quietos, 'sesiones: al cerrar la última no queda ninguna voz sonando');
  void ultima;
}

// ── 11. La síntesis se atrasa (cuota Azure, red lenta): el video espera ──
// Antes la voz entraba tarde (hasta 5 s) y luego se saltaban frases enteras.
for (const [etiqueta, opciones] of [['YouTube/X', { esperarVoz: true, esperarFrase: false }], ['archivo', { esperarVoz: true }]]) {
  const unidades = unidadesContinuas(30, { ventana: 3, voz: 2.4, estado: 'pendiente' });
  const s = await crearEscenario(unidades, { ...opciones, sintesis: { latenciaMs: 5000, porMinuto: 18 }, voz: 2.4 });
  s.motor.activarYReproducir();
  await s.correr(260);
  const hasta = Math.floor(s.jugador.t) - 4;
  const esp = esperadas(unidades, 0, hasta);
  const lat = s.latencias();
  comprobar(esp.length >= 15 && faltan(esp, sonadas(s)).length === 0, `${etiqueta}, síntesis lenta: ${sonadas(s).length} frases sonadas = ${esp.length} esperadas, 0 saltadas`);
  comprobar(s.motor.metricas().frasesSaltadas === 0, `${etiqueta}, síntesis lenta: el motor no tuvo que saltar frases`);
  comprobar(s.registro.cortes.length === 0, `${etiqueta}, síntesis lenta: 0 cortes`);
  comprobar(lat.length > 0 && percentil(lat, 0.95) <= 0.15 && Math.min(...lat) >= -0.1, `${etiqueta}, síntesis lenta: la voz nunca entra tarde, p95 ${ms(percentil(lat, 0.95))} ms (máx ${ms(Math.max(...lat))} ms)`);
  comprobar(s.registro.estados.some((e) => /Preparando la voz/.test(e.mensaje) && e.tipo === 'cargando'), `${etiqueta}, síntesis lenta: avisa «Preparando la voz…» mientras el video espera`);
  comprobar(s.registro.estados.every((e) => !/^El video espera/.test(e.mensaje)), `${etiqueta}, síntesis lenta: el aviso es breve y no técnico`);
  comprobar(Math.min(...s.jugador.tasasVistas) >= 0.75, `${etiqueta}, síntesis lenta: la espera es una pausa, no cámara lenta (mínimo ${Math.min(...s.jugador.tasasVistas)}×)`);
}

// ── 12. Si la persona pausa mientras el video espera la voz, se respeta ──
{
  const unidades = unidadesContinuas(10, { ventana: 3, voz: 2.4, estado: 'pendiente' });
  const s = await crearEscenario(unidades, { esperarVoz: true, esperarFrase: false, sintesis: { latenciaMs: 8000, porMinuto: 18 }, voz: 2.4 });
  s.motor.activarYReproducir();
  await s.correr(3);   // el video espera la frase 0 (síntesis a 8 s)
  s.motor.pausarTodo();   // la persona cambió de pestaña mientras esperaba
  await s.correr(14);     // la voz ya está lista, pero nadie debe arrancar el video
  comprobar(s.jugador.estado === 2, 'espera + pestaña: la voz lista NO reanuda un video que la persona dejó en pausa');
}

console.log(`\n${ok} comprobaciones OK · ${fallos} fallos`);
process.exit(fallos ? 1 : 0);
