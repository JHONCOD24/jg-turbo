/* Doblaje de YouTube · funciones puras, sin navegador ni red.
 * Ejecutar: node tests/test_youtube_doblaje.mjs
 * Cada tarea del PLAN_YOUTUBE_DOBLAJE_IMPLEMENTACION_LLM.md añade su sección
 * antes del bloque «Resumen». Cuenta las comprobaciones: si bajan, algo se cortó.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const modulo = (nombre) => import(pathToFileURL(path.join(raiz, 'js/youtube', nombre)).href);
const fixture = JSON.parse(fs.readFileSync(path.join(raiz, 'tests/fixtures/youtube_dNWkwrqAkcM_90s.json'), 'utf8'));

let ok = 0;
let fallos = 0;
function comprobar(condicion, mensaje) {
  if (condicion) { ok += 1; console.log(`OK: ${mensaje}`); }
  else { fallos += 1; console.error(`FALLO: ${mensaje}`); }
}
const cerca = (a, b, tolerancia = 1e-6) => Math.abs(a - b) <= tolerancia;
/** El fixture de 90 s repetido `veces`: un video largo sin gastar créditos. */
function repetir(segmentos, veces) {
  const salida = [];
  for (let v = 0; v < veces; v += 1) {
    for (const s of segmentos) salida.push({ ...s, startTime: s.startTime + v * 90, endTime: s.endTime + v * 90 });
  }
  return salida;
}

// ── Línea base: lo que ya funciona y no se puede romper ─────────────────
const ts = await modulo('transcriptionService.js');
{
  const segs = ts.normalizarSegmentos(fixture.segments);
  comprobar(segs.length === 44, 'el fixture real trae 44 segmentos válidos');
  comprobar(segs.every((s, i) => i === 0 || s.startTime >= segs[i - 1].startTime), 'los segmentos quedan ordenados por tiempo');
  comprobar(segs.every((s, i) => i === segs.length - 1 || s.endTime <= segs[i + 1].startTime + 1e-9), 'recortarSolapes: ningún segmento invade al siguiente');
  comprobar(ts.extraerVideoId('https://www.youtube.com/watch?v=dNWkwrqAkcM') === 'dNWkwrqAkcM', 'extraerVideoId: watch?v=');
  comprobar(ts.extraerVideoId('https://youtu.be/jNQXAC9IVRw?t=3') === 'jNQXAC9IVRw', 'extraerVideoId: youtu.be');
  comprobar(ts.extraerVideoId('https://www.youtube.com/shorts/abcdefghijk') === 'abcdefghijk', 'extraerVideoId: shorts');
  comprobar(ts.extraerVideoId('https://example.com/watch?v=x') === '', 'extraerVideoId: rechaza otros dominios');
}
const de = await modulo('dubbingEngine.js');
{
  comprobar(de.ajusteFino(0.1) === 1, 'ajusteFino: dentro de 150 ms no toca la velocidad');
  comprobar(de.percentil([1, 2, 3, 4, 100], 0.95) === 100, 'percentil: p95');
}

// ── T1.3: lo que no es habla no se traduce ni se lee ───────────────────
{
  comprobar(ts.limpiarNoHabla('with your production processes, [music]') === 'with your production processes,', 'quita [music] del final de una frase');
  comprobar(ts.esSoloSonido('(baaaaaaaaaaahhh!!)'), '«(baaaah!!)» es un sonido, no diálogo');
  comprobar(ts.esSoloSonido('[clears throat]'), '[clears throat] es un sonido');
  comprobar(ts.esSoloSonido('♪ never gonna give you up ♪'), 'lo cantado entre ♪ no se dobla');
  comprobar(ts.limpiarNoHabla('>> At this point, you are') === 'At this point, you are', 'el >> de cambio de hablante no se lee');
  comprobar(ts.limpiarNoHabla('It was (and I mean it) great') === 'It was (and I mean it) great', 'un paréntesis con habla se conserva');
  comprobar(ts.limpiarNoHabla('(APPLAUSE) Thank you') === 'Thank you', 'un (APLAUSO) en mayúsculas se quita');
  const segs = ts.normalizarSegmentos([{ startTime: 0, endTime: 2, text: '[music]' }, { startTime: 2, endTime: 4, text: 'Hello there' }]);
  comprobar(segs.length === 1 && segs[0].text === 'Hello there', 'un segmento que solo era sonido desaparece');
  comprobar(ts.normalizarSegmentos(fixture.segments).length === 44, 'el fixture real conserva sus 44 segmentos (el [music] era parte de una frase)');
}

// ── T1.4: reloj con temporizador ────────────────────────────────────────
const { crearReloj } = await modulo('reloj.js');
{
  let llamadas = 0;
  let programado = null;
  let cancelado = null;
  const reloj = crearReloj(() => { llamadas += 1; }, {
    intervaloMs: 100,
    programar: (fn, ms) => { programado = { fn, ms }; return 7; },
    cancelar: (id) => { cancelado = id; },
  });
  reloj.iniciar();
  reloj.iniciar();
  comprobar(programado?.ms === 100 && reloj.activo, 'reloj: programa un intervalo de 100 ms una sola vez');
  programado.fn();
  programado.fn();
  comprobar(llamadas === 2, 'reloj: cada tic llama a la función');
  reloj.detener();
  comprobar(cancelado === 7 && !reloj.activo, 'reloj: detener cancela el intervalo');
  let sobrevivio = true;
  try { crearReloj(() => { throw new Error('x'); }, { programar: (fn) => { fn(); return 1; }, cancelar: () => {} }).iniciar(); } catch { sobrevivio = false; }
  comprobar(sobrevivio, 'reloj: un error en un tic no tumba el reloj');
}

// ── T2.1: frases de voz por el tiempo del original ─────────────────────
const ds = await modulo('dubbingService.js');
{
  const segmentos = ts.normalizarSegmentos(fixture.segments);
  const unidades = ds.agruparPorTiempo(segmentos);
  comprobar(unidades.length >= 8 && unidades.length <= 20, `el minuto y medio real queda en ${unidades.length} frases de voz`);
  const cubiertos = unidades.flatMap((u) => Array.from({ length: u.hasta - u.desde + 1 }, (_, k) => u.desde + k));
  comprobar(cubiertos.length === segmentos.length && cubiertos.every((v, i) => v === i), 'cada segmento pertenece a exactamente una frase, en orden');
  comprobar(unidades.every((u, i) => i === unidades.length - 1 || u.endTime <= unidades[i + 1].startTime + 1e-9), 'una frase nunca pisa a la siguiente');
  comprobar(unidades.every((u) => u.endTime - u.finHabla <= ds.SILENCIO_PRESTADO_MAX_S + 1e-9 && u.endTime >= u.finHabla), 'el silencio prestado va de 0 a 1,5 s');
  comprobar(unidades.every((u) => u.estado === 'sin_traducir' && u.text === ''), 'las frases nacen sin texto: la traducción las rellena');
  const traducciones = new Map();
  const u0 = unidades[0];
  comprobar(ds.textoDeUnidad(u0, traducciones) === null, 'sin traducción, la frase aún no tiene texto');
  for (let i = u0.desde; i <= u0.hasta; i += 1) traducciones.set(i, `ES ${i}`);
  const esperado = Array.from({ length: u0.hasta - u0.desde + 1 }, (_, k) => `ES ${u0.desde + k}`).join(' ');
  comprobar(ds.textoDeUnidad(u0, traducciones) === esperado, 'con todo traducido, la frase une sus segmentos');
  traducciones.set(u0.desde, null);
  comprobar(ds.textoDeUnidad(u0, traducciones) === '', 'un segmento sin traducción deja la frase sin voz (suena el original)');
  const servicio = new ds.DubbingService({ generarAudio: async () => ({ blob: new Blob(['x']) }) });
  servicio.definirUnidades(ds.agruparPorTiempo(segmentos));
  servicio.fijarTexto(0, 'Hola');
  servicio.fijarTexto(1, '');
  comprobar(servicio.unidades[0].estado === 'pendiente' && servicio.unidades[1].estado === 'sin_voz', 'fijarTexto: con texto queda pendiente; vacío, sin voz');
  await servicio.asegurar(0);
  comprobar(servicio.unidades[0].estado === 'listo' && servicio.unidades[0].url.startsWith('blob:'), 'asegurar genera la voz de una frase pendiente');
  servicio.liberarAntesDe(servicio.unidades[0].endTime + 1);
  comprobar(servicio.unidades[0].estado === 'pendiente' && !servicio.unidades[0].url, 'liberarAntesDe suelta la memoria de lo ya escuchado (y se puede regenerar)');
}

// ── T2.2: traducir un lote con contexto; si falla, partirlo en mitades ─────
const tr = await modulo('translationService.js');
{
  const segmentos = ts.normalizarSegmentos(fixture.segments);
  const responder = (texto, quitarUltimo = false) => {
    const piezas = [...texto.matchAll(/\[\[JG_SEG_(\d{6})\]\]\n([^\[]*)/g)];
    const salida = quitarUltimo && piezas.length > 2 ? piezas.slice(0, -1) : piezas;
    return { text: salida.map((m) => `[[JG_SEG_${m[1]}]]\nES ${m[2].trim()}`).join('\n\n') };
  };
  const llamadas = [];
  const sano = new tr.TranslationService({ traducirTexto: async (texto, opciones) => { llamadas.push({ texto, opciones }); return responder(texto); } });
  const mapa = await sano.traducirLote([5, 6, 7], segmentos, { origen: 'en', tituloVideo: 'T' });
  comprobar(llamadas.length === 1, 'un lote sano es una sola llamada');
  comprobar(mapa.get(6)?.startsWith('ES '), 'cada índice recibe su traducción');
  comprobar(llamadas[0].opciones.origen === 'en' && llamadas[0].opciones.tituloVideo === 'T', 'el idioma de origen y el título viajan en la petición');
  comprobar(llamadas[0].opciones.contexto.anterior.includes(segmentos[4].text), 'el lote lleva como contexto lo dicho justo antes');
  comprobar(llamadas[0].opciones.contexto.siguiente === segmentos[8].text, 'y lo que viene justo después');

  let n = 0;
  const pierde = new tr.TranslationService({ traducirTexto: async (texto) => { n += 1; return responder(texto, true); } });
  const partido = await pierde.traducirLote([0, 1, 2, 3, 4, 5, 6, 7], segmentos, {});
  comprobar([...partido.values()].every((t) => t && t.startsWith('ES ')), 'tras partir el lote en mitades, todo queda traducido');
  comprobar(n <= 7, `partir en mitades gasta pocas llamadas (${n})`);

  const vacio = new tr.TranslationService({ traducirTexto: async () => ({ text: '' }) });
  const nada = await vacio.traducirLote([0, 1], segmentos, {});
  comprobar(nada.get(0) === null && nada.get(1) === null, 'si no hay forma de traducir, el tramo queda marcado (null), sin inventar');
  const limite = new tr.TranslationService({ traducirTexto: async () => { throw new Error('mistral: límite de uso alcanzado (429)'); } });
  let lanzo = false;
  try { await limite.traducirLote([0], segmentos, {}); } catch { lanzo = true; }
  comprobar(lanzo, 'un 429 sube al motor para que haga una pausa (no se marca como texto fallido)');
  comprobar(tr.crearLotes(segmentos).every((lote) => lote.length <= tr.MAX_SEGMENTOS_POR_LOTE), 'crearLotes respeta el máximo de 8 segmentos');
}
{
  const html = fs.readFileSync(path.join(raiz, 'index.html'), 'utf8');
  // `window.jgAsegurarYoutube` se cita antes (carga perezosa de la pestaña), así
  // que hay que recortar hasta la ÚLTIMA mención: la asignación bajo la función.
  const puente = html.slice(html.indexOf('function asegurarYoutubeSincronizado'), html.lastIndexOf('window.jgAsegurarYoutube'));
  comprobar(/revisar:\s*false/.test(puente), 'el doblaje ya no hace la segunda pasada de revisión (2× llamadas)');
}

// ── T2.4: limitador ─────────────────────────────────────────────────────
const lim = await modulo('limitador.js');
{
  let ahora = 0;
  const l = lim.crearLimitador({ maximo: 3, ventanaMs: 1000, ahora: () => ahora });
  l.registrar(); l.registrar(); l.registrar();
  comprobar(!l.disponible() && l.esperaMs() === 1000, 'limitador: con el cupo lleno hay que esperar');
  ahora = 999;
  comprobar(!l.disponible() && l.esperaMs() === 1, 'limitador: la espera baja con el tiempo');
  ahora = 1000;
  comprobar(l.disponible() && l.usados === 0, 'limitador: pasada la ventana, el cupo vuelve');
  comprobar(lim.MAXIMO_VOZ_POR_MINUTO === 18, 'el doblaje deja margen bajo las 20 síntesis/minuto de Azure F0');
}
// ── T2.4: planificador ──────────────────────────────────────────────────
const pl = await modulo('planificador.js');
{
  const segmentos = ts.normalizarSegmentos(repetir(fixture.segments, 10));
  const hechos = new Set();
  const estado = { traducido: (i) => hechos.has(i), enCurso: () => false };
  const primero = pl.siguienteLoteTraduccion(segmentos, estado, 0);
  comprobar(Array.isArray(primero) && primero[0] === 0 && primero.length <= 8, 'el primer lote empieza en el primer segmento y no pasa de 8');
  primero.forEach((i) => hechos.add(i));
  const segundo = pl.siguienteLoteTraduccion(segmentos, estado, 0);
  comprobar(segundo[0] === primero[primero.length - 1] + 1, 'el siguiente lote sigue donde terminó el anterior');
  const lejos = pl.siguienteLoteTraduccion(segmentos, { traducido: () => false, enCurso: () => false }, 400);
  comprobar(segmentos[lejos[0]].endTime > 398, 'desde otra posición, el lote empieza ahí (con 2 s de margen)');
  comprobar(pl.siguienteLoteTraduccion(segmentos, { traducido: () => true, enCurso: () => false }, 0) === null, 'si todo está traducido no hay lote');
  const fuera = pl.siguienteLoteTraduccion(segmentos, { traducido: (i) => segmentos[i].startTime < 200, enCurso: () => false }, 0, { horizonteS: 180 });
  comprobar(fuera === null, 'no se traduce más allá del horizonte');
  const unidades = [
    { startTime: 0, endTime: 5, estado: 'listo' }, { startTime: 5, endTime: 11, estado: 'pendiente' },
    { startTime: 11, endTime: 15, estado: 'sin_traducir' }, { startTime: 200, endTime: 205, estado: 'pendiente' },
  ];
  comprobar(JSON.stringify(pl.unidadesAGenerar(unidades, 0, { limite: 3 })) === '[1]', 'solo se sintetizan frases con texto y dentro del horizonte de voz');
  comprobar(pl.segundosCubiertos(unidades, 0) === 5, 'la voz cubre hasta la primera frase sin voz');
  comprobar(pl.segundosCubiertos([{ startTime: 30, endTime: 35, estado: 'pendiente' }], 0) === 30, 'un silencio inicial cuenta como cubierto');
  comprobar(pl.segundosCubiertos([{ startTime: 0, endTime: 5, estado: 'listo' }], 0) === Infinity, 'todo listo = cubierto hasta el final');
}
// ── T2.4: motor de preparación (con dobles, sin red) ────────────────────
const { MotorPreparacion } = await modulo('motorPreparacion.js');
{
  const segmentos = ts.normalizarSegmentos(repetir(fixture.segments, 20));   // ≈30 min
  const unidades = ds.agruparPorTiempo(segmentos);
  const ahora = 0;
  const limitador = lim.crearLimitador({ ahora: () => ahora });
  const pedidosVoz = [];
  const servicioVoz = new ds.DubbingService({ generarAudio: async (texto) => { pedidosVoz.push(texto); return { blob: new Blob(['x']) }; }, limitador });
  servicioVoz.definirUnidades(unidades);
  const lotes = [];
  const traductor = { traducirLote: async (indices) => { lotes.push(indices); return new Map(indices.map((i) => [i, `ES ${segmentos[i].text}`])); } };
  let posicion = 0;
  const reloj = { iniciar() {}, detener() {}, activo: false };   // los pasos se dan a mano
  const motor = new MotorPreparacion({ segmentos, servicioVoz, traductor, posicion: () => posicion, limitadorVoz: limitador, reloj, ahora: () => ahora, intervaloTraduccionMs: 0 });
  const pasos = async (n) => { for (let i = 0; i < n; i += 1) { motor.paso(); await new Promise((r) => setTimeout(r, 0)); } };
  await pasos(60);
  const maximo = Math.max(...lotes.flat());
  comprobar(segmentos[maximo].startTime <= 180 + 35, 'en pausa, la traducción se detiene en el horizonte de 3 min');
  comprobar(pedidosVoz.length <= 18, `no más de 18 síntesis en el primer minuto (${pedidosVoz.length})`);
  comprobar(motor.resumen().vozHastaS >= 20, 'hay al menos 20 s de voz para arrancar');
  posicion = 1200;
  const antes = lotes.length;
  await pasos(10);
  const nuevos = lotes.slice(antes).flat();
  // −10 s: el primer segmento que sigue sonando en 1198 s puede haber empezado unos segundos antes.
  comprobar(nuevos.length > 0 && segmentos[nuevos[0]].startTime >= 1200 - 10, 'tras un salto, lo primero que se traduce es lo de la nueva posición');
}
// ── Ritmo de traducción y espera creciente ante 429 (2026-09-26) ─────────
{
  const segmentos = ts.normalizarSegmentos(repetir(fixture.segments, 4));
  const fabrica = ({ falla429 = 0 } = {}) => {
    const reloj = { iniciar() {}, detener() {} };
    const tiempo = { ms: 0 };
    const inicios = [];
    let llamadas = 0;
    const traductor = { traducirLote: async (indices) => {
      llamadas += 1;
      inicios.push(tiempo.ms);
      if (llamadas <= falla429) throw new Error('429 Too Many Requests');
      return new Map(indices.map((i) => [i, `ES ${segmentos[i].text}`]));
    } };
    const unidades = ds.agruparPorTiempo(segmentos);
    const servicioVoz = new ds.DubbingService({ generarAudio: async () => ({ blob: new Blob(['x']) }) });
    servicioVoz.definirUnidades(unidades);
    const mensajes = [];
    const motor = new MotorPreparacion({
      segmentos, servicioVoz, traductor, posicion: () => 0, reloj,
      ahora: () => tiempo.ms,
      onCambio: (e) => { if (e?.tipo === 'pausa') mensajes.push(e.mensaje); },
    });
    return { motor, tiempo, inicios, mensajes, traductor };
  };
  const tick = async (motor, n = 1) => { for (let i = 0; i < n; i += 1) { motor.paso(); await new Promise((r) => setTimeout(r, 0)); } };
  {
    // Ritmo mínimo: los lotes arrancan con ≥1,1 s entre sí (Mistral gratis ≈1/s).
    const { motor, tiempo, inicios } = fabrica();
    await tick(motor, 3);
    tiempo.ms += 500;
    await tick(motor, 3);
    comprobar(inicios.length <= 1, 'a los 0,5 s solo arrancó un lote (no ráfaga)');
    tiempo.ms += 700;
    await tick(motor, 3);
    const pausas = inicios.slice(1).map((t, i) => t - inicios[i]);
    comprobar(inicios.length >= 2 && pausas.every((p) => p >= 1100), `los lotes respetan 1,1 s entre sí (${pausas.join(', ')})`);
  }
  {
    // 429: espera 15 → 30 s y mensaje con la espera real (nada de «segundos» a secas).
    const { motor, tiempo, mensajes } = fabrica({ falla429: 99 });
    await tick(motor, 3);
    comprobar(/15 s/.test(mensajes[0] || ''), `el primer 429 espera 15 s y lo dice («${mensajes[0] || ''}»)`);
    tiempo.ms += 15000;
    await tick(motor, 3);
    comprobar(/30 s/.test(mensajes[1] || '') && /van 2/.test(mensajes[1] || ''), `el segundo 429 espera 30 s («${mensajes[1] || ''}»)`);
    tiempo.ms += 30000;
    await tick(motor, 3);
    comprobar(/60 s/.test(mensajes[2] || ''), 'el tercero espera 60 s (tope)');
  }
  {
    // Un éxito olvida la racha: el siguiente 429 vuelve a 15 s.
    const { motor, tiempo, mensajes } = fabrica({ falla429: 1 });
    await tick(motor, 3);
    comprobar(/15 s/.test(mensajes[0] || ''), 'primer 429: 15 s');
    tiempo.ms += 15000 + 1100;
    await tick(motor, 5);   // reintento sale bien (solo fallaba 1 vez)
    const n = mensajes.length;
    motor.traductor = { traducirLote: async () => { throw new Error('429 rate limit'); } };
    tiempo.ms += 1100;
    await tick(motor, 3);
    comprobar(/15 s/.test(mensajes[n] || ''), 'tras un éxito, el siguiente 429 vuelve a 15 s');
  }
}

// ── T1.6: regla de idioma ───────────────────────────────────────────────
const io = await modulo('idiomaOrigen.js');
{
  const d = io.decidirDoblaje;
  comprobar(d({ idioma: 'en', confianza: 0.8, fuente: 'titulo' }).accion === 'doblar', 'inglés con buena señal: se dobla sin preguntar');
  comprobar(d({ idioma: 'pt', confianza: 0.3, fuente: 'usuario' }).accion === 'doblar', 'lo que eligió la persona no se vuelve a preguntar');
  comprobar(d({ idioma: 'en', confianza: 0.97, fuente: 'youtube' }).accion === 'doblar', 'lo que declara YouTube basta');
  comprobar(d({ idioma: 'en', confianza: 0.55, fuente: 'disponibles' }).accion === 'preguntar', 'con poca certeza se pregunta (nunca un rechazo a ciegas)');
  comprobar(d({ idioma: 'en', confianza: 0.9, fuente: 'titulo', conflicto: true }).accion === 'preguntar', 'si las señales se contradicen, se pregunta');
  comprobar(d({ idioma: 'es', confianza: 1, fuente: 'usuario' }).accion === 'sin_doblaje', 'un video en español no se dobla');
  comprobar(d({ idioma: 'es', confianza: 0.45, fuente: 'titulo' }).accion === 'preguntar', 'un título en español con duda no basta para decir «ya está en español»');
  comprobar(d({ idioma: 'ar', confianza: 0.95, fuente: 'proveedor' }).accion === 'no_soportado', 'un idioma aún no soportado lo dice claro');
  comprobar(d({}).accion === 'preguntar', 'sin datos se pregunta');
  comprobar(io.nombreIdioma('en-US') === 'inglés' && io.codigoCorto('pt_BR') === 'pt', 'nombres y códigos cortos');
}

// ── T2.6: velocidad estable ─────────────────────────────────────────────
// Ajuste 2026-09-26: 0,95–1,20. El 0,90 se oía frenado («frenos en la voz») y
// con 2 s de silencio prestado casi nunca hace falta bajar tanto ni pasar de 1,20.
{
  comprobar(de.VELOCIDAD_MINIMA === 0.95 && de.VELOCIDAD_MAXIMA === 1.2, 'la voz se mueve entre 0,95× y 1,20×');
  comprobar(cerca(de.calcularVelocidadAudio(10, 5, 1), 1.2), 'si no cabe, acelera hasta 1,20× y no más');
  comprobar(cerca(de.calcularVelocidadAudio(3, 6, 1), 0.95), 'si sobra tiempo, frena hasta 0,95× y no más');
  comprobar(cerca(de.calcularVelocidadAudio(5.5, 5, 1.5), 1.1 * 1.5), 'la velocidad elegida para el video se respeta encima');
  const unidades = ds.agruparPorTiempo(ts.normalizarSegmentos(fixture.segments));
  comprobar(unidades.some((u) => u.duration > u.finHabla - u.startTime), 'las frases usan el silencio prestado como tiempo extra');
}

// ── T3.6: traducir todo reaprovechando lo ya traducido ────────────────────
{
  const segmentos = ts.normalizarSegmentos(fixture.segments);
  const pedidos = [];
  const servicio = new tr.TranslationService({ traducirTexto: async (texto) => {
    const piezas = [...texto.matchAll(/\[\[JG_SEG_(\d{6})\]\]\n([^\[]*)/g)];
    pedidos.push(piezas.map((m) => Number(m[1])));
    return { text: piezas.map((m) => `[[JG_SEG_${m[1]}]]\nES ${m[2].trim()}`).join('\n\n') };
  } });
  const ya = new Map(segmentos.slice(0, 10).map((s, i) => [i, `YA ${i}`]));
  const todo = await servicio.traducirTodo(segmentos, { ya });
  comprobar(todo.size === segmentos.length && todo.get(3) === 'YA 3', 'traducirTodo completa el texto y conserva lo ya traducido');
  comprobar(pedidos.flat().every((i) => i >= 10), 'no vuelve a pagar lo que el doblaje ya tradujo');
}

// ── Voces del doblaje: automática y 2 hablantes (2026-09-26) ─────────────
const vd = await modulo('vocesDoblaje.js');
{
  // Detección de diálogo sobre el texto CRUDO (la limpieza borra el >>).
  comprobar(vd.esCambioHablante('>> At this point'), 'el >> marca cambio de hablante');
  comprobar(vd.esCambioHablante('— Hola, ¿cómo estás?'), 'el guion de diálogo marca cambio');
  comprobar(!vd.esCambioHablante('Hello world, this is English'), 'una frase normal no marca cambio');
  // normalizarSegmentos preserva la marca aunque limpie el texto.
  const conMarca = ts.normalizarSegmentos([
    { startTime: 0, endTime: 2, text: 'Hello there' },
    { startTime: 2, endTime: 4, text: '>> General Kenobi, you are a bold one' },
    { startTime: 4, endTime: 6, text: '>> Hello there again' },
  ]);
  comprobar(conMarca.length === 3 && !conMarca[0].cambioHablante, 'sin marca no hay campo cambioHablante');
  comprobar(conMarca[1].cambioHablante === true && conMarca[2].cambioHablante === true, 'la marca sobrevive a la limpieza');
  comprobar(!/>>/.test(conMarca[1].text), 'el >> no se lee en voz alta');
  comprobar(vd.hayDialogo(conMarca), 'dos cambios = hay diálogo');
  comprobar(!vd.hayDialogo(ts.normalizarSegmentos(fixture.segments.slice(0, 3))), 'un monólogo no es diálogo');
  // Las unidades alternan de hablante y cortan en el cambio (sin mezclar voces).
  const unidades = ds.agruparPorTiempo(conMarca);
  comprobar(unidades.length >= 2, 'el cambio de hablante corta la frase');
  comprobar(unidades[0].hablante === 0, 'el primer hablante es el 0');
  comprobar(unidades.some((u) => u.hablante === 1), 'hay al menos una frase del hablante 1');
  const mono = ds.agruparPorTiempo(ts.normalizarSegmentos([
    { startTime: 0, endTime: 2, text: 'Hello there' },
    { startTime: 2.5, endTime: 4, text: 'How are you today' },
  ]));
  comprobar(mono.every((u) => u.hablante === 0), 'el monólogo queda todo en el hablante 0');
  // Un >> suelto es un artefacto: ni corta ni voltea la voz.
  const suelto = ts.normalizarSegmentos([
    { startTime: 0, endTime: 2, text: 'Hello there' },
    { startTime: 2.5, endTime: 4.5, text: '>> How are you today' },
    { startTime: 5, endTime: 7, text: 'Nice to see you again' },
  ]);
  const uSuelto = ds.agruparPorTiempo(suelto);
  const uLimpio = ds.agruparPorTiempo(ts.normalizarSegmentos([
    { startTime: 0, endTime: 2, text: 'Hello there' },
    { startTime: 2.5, endTime: 4.5, text: 'How are you today' },
    { startTime: 5, endTime: 7, text: 'Nice to see you again' },
  ]));
  comprobar(uSuelto.every((u) => u.hablante === 0), 'un >> suelto no voltea la voz a mitad');
  comprobar(uSuelto.length === uLimpio.length, 'un >> suelto no parte frases de más');
  // Género: exige ventaja clara, si no, no afirma nada.
  comprobar(vd.inferirGenero('She told her sister that her mother would come with her') === 'female', 'pronombres femeninos claros');
  comprobar(vd.inferirGenero('He told his brother that his father would come with him') === 'male', 'pronombres masculinos claros');
  comprobar(vd.inferirGenero('Hello world, this is a test of the system') === '', 'sin pistas no se afirma género');
  comprobar(vd.inferirGenero('He said hello and she said hi to him and her') === '', 'sin ventaja clara no se afirma género');
  // Automática: siempre neural rápida, nunca Fish.
  const catalogo = [
    { value: 'neural:auto:female', group: 'Neural', label: 'Salomé' },
    { value: 'neural:auto:male', group: 'Neural', label: 'Gonzalo' },
    { value: 'fish:roberto', group: 'Fish', label: 'Roberto' },
  ];
  const autoF = vd.elegirVocesAutomaticas({ textosOriginales: ['She told her sister'], vozGlobal: 'neural:auto:male', catalogo });
  comprobar(autoF.principal === 'neural:auto:female' && vd.esNeuralRapida(autoF.principal), 'detectada mujer: principal neural femenina');
  comprobar(autoF.secundaria === 'neural:auto:male', 'la secundaria es del otro género');
  const autoSinPistas = vd.elegirVocesAutomaticas({ textosOriginales: ['Hello world test'], vozGlobal: 'neural:auto:male', catalogo });
  comprobar(autoSinPistas.principal === 'neural:auto:male', 'sin pistas manda la voz global');
  comprobar(vd.vozParaUnidad({ hablante: 0 }, { vozPrincipal: 'A', vozSecundaria: 'B' }) === 'A', 'hablante 0 usa la principal');
  comprobar(vd.vozParaUnidad({ hablante: 1 }, { vozPrincipal: 'A', vozSecundaria: 'B' }) === 'B', 'hablante 1 usa la secundaria');
}

// ── Velocidad a gusto de la persona (2026-09-26) ─────────────────────────
const se = await modulo('syncEngine.js');
{
  const tasas = se.tasasParaSelector([0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2]);
  comprobar(tasas.includes(0.8) && tasas.includes(0.85) && tasas.includes(0.97), 'el selector trae presets finos (0.80, 0.85, 0.97)');
  comprobar(tasas.includes(0.25) && tasas.includes(2), 'y conserva lo que ofrece YouTube');
  comprobar(JSON.stringify(tasas) === JSON.stringify([...tasas].sort((a, b) => a - b)), 'ordenadas y sin repetidos');
  comprobar(new Set(tasas).size === tasas.length, 'sin duplicados al unir con YouTube');
  comprobar(se.normalizarTasa('0,97') === 0.97, 'acepta coma decimal (0,97)');
  comprobar(se.normalizarTasa('0.85') === 0.85, 'acepta 0.85 tal cual');
  comprobar(se.normalizarTasa('5') === 2 && se.normalizarTasa('0.1') === 0.25, 'recorta a 0.25–2');
  comprobar(se.normalizarTasa('hola') === 1 && se.normalizarTasa('') === 1, 'sin número vuelve a 1x');
  comprobar(se.presetDeTasa(tasas, 0.97) === 0.97, '0.97 cae en su preset');
  comprobar(se.presetDeTasa(tasas, 0.93) === null, '0.93 va por valor libre');
}

// ── Resumen ─────────────────────────────────────────────────────────────
console.log(`\n${ok} comprobaciones OK · ${fallos} fallos`);
process.exit(fallos ? 1 : 0);
