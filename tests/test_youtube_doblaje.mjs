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
  // `ajusteFino` desapareció con el motor v4 (2026-09-26): corregía el desfase
  // reposicionando y acelerando la voz para seguir al video, que es justo lo que
  // cortaba frases. La sincronía nueva se prueba en tests/test_youtube_sincronia.mjs.
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

// ── T2.6: velocidad de la voz (motor v4, 2026-09-26) ──────────────────────
// Antes: 0,95–1,20 dentro de una ventana fija y, si no cabía, se cortaba la
// frase. Ahora la voz va de 1× (nunca en cámara lenta) a 1,25×, cómoda hasta
// 1,12×, y si aun así no cabe se frena el VIDEO (tests/test_youtube_sincronia.mjs).
const rd = await modulo('ritmoDoblaje.js');
{
  const rango = rd.rangoVoz(1);
  comprobar(rango.min === 1 && rango.max === 1.25, 'la voz se mueve entre 1× y 1,25×');
  comprobar(rd.velocidadVoz({ restanteS: 10, tiempoVideo: 0, limiteSuave: 5, limiteDuro: 5 }) === 1.25, 'si no cabe, acelera hasta 1,25× y no más');
  comprobar(rd.velocidadVoz({ restanteS: 3, tiempoVideo: 0, limiteSuave: 6, limiteDuro: 6 }) === 1, 'si sobra tiempo, no se estira: suena a su ritmo natural');
  comprobar(cerca(rd.velocidadVoz({ restanteS: 5.5, tiempoVideo: 0, limiteSuave: 5, limiteDuro: 5, tasaVideo: 1.5, tasaBase: 1.5 }), 1.65), 'la velocidad elegida para el video se respeta encima');
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

// ── Velocidad del video (v4, 2026-09-26) ─────────────────────────────────
// El selector propio (presets finos + «Otra…») se retiró a pedido del dueño: la
// velocidad a mano va en el engranaje de YouTube y frenar lo hace el ritmo
// automático. Queda `normalizarTasa` para leer la velocidad recordada.
const se = await modulo('syncEngine.js');
{
  comprobar(typeof se.tasasParaSelector === 'undefined' && typeof se.presetDeTasa === 'undefined', 'el selector de velocidad propio ya no existe');
  comprobar(se.normalizarTasa('0,97') === 0.97, 'acepta coma decimal (0,97)');
  comprobar(se.normalizarTasa('0.85') === 0.85, 'acepta 0.85 tal cual');
  comprobar(se.normalizarTasa('5') === 2 && se.normalizarTasa('0.1') === 0.25, 'recorta a 0.25–2');
  comprobar(se.normalizarTasa('hola') === 1 && se.normalizarTasa('') === 1, 'sin número vuelve a 1x');
}

// ── Arranque rápido y traducción robusta (v4, 2026-09-26) ─────────────────
// Medido en producción: 13 llamadas y dos 500 antes del primer sonido. Un 500
// (Mistral en límite, disfrazado de «401» por el servidor) hacía partir el lote
// en mitades y multiplicaba las llamadas; y cada fallo costaba 15 s de espera.
{
  const segmentos = ts.normalizarSegmentos(fixture.segments);
  let llamadas = 0;
  const caido = new tr.TranslationService({ traducirTexto: async () => { llamadas += 1; throw new Error('Error 500: gemini: clave no autorizada (401)'); } });
  let lanzo = null;
  try { await caido.traducirLote([0, 1, 2, 3], segmentos, {}); } catch (error) { lanzo = error; }
  comprobar(lanzo && llamadas === 1, `un fallo del servidor no parte el lote: sube al motor para repetirlo entero (${llamadas} llamada)`);
  comprobar(tr.esFalloDeContenido(new Error('La IA devolvió una traducción incompleta o mezclada')) && tr.esFalloDeContenido(new Error('La IA alteró los marcadores temporales del doblaje.')), 'un problema DEL TEXTO sí se reconoce (ese sí se parte en mitades)');
  comprobar(!tr.esFalloDeContenido(new Error('No se pudo contactar al servidor')), 'un fallo de red no es un problema del texto');

  let respaldo = 0;
  const sinIA = new tr.TranslationService({ traducirTexto: async (texto) => { respaldo += 1; return { text: texto.replace(/\n(.+)/g, '\nMALA $1'), ia_used: false }; } });
  let rechazo = null;
  try { await sinIA.traducirLote([0, 1], segmentos, {}); } catch (error) { rechazo = error; }
  comprobar(rechazo && respaldo === 1, 'la traducción de respaldo sin IA no se usa para doblar (se reintenta con IA)');

  const conMarca = new tr.TranslationService({ traducirTexto: async (texto) => (/JG_SEG/.test(texto) ? { text: '' } : { text: '[[JG_SEG_000000]]\nHola, esto es una prueba', ia_used: true }) });
  const suelta = await conMarca.traducirLote([0], segmentos, {});
  comprobar(suelta.get(0) === 'Hola, esto es una prueba', `un marcador copiado del ejemplo no llega al subtítulo ni a la voz («${suelta.get(0)}»)`);

  // Zona gris: el español a veces es más compacto de verdad (0,74–0,83 medido).
  // Respuesta con cada segmento recortado a `fraccion` de su largo.
  const recortada = (texto, fraccion) => ({ ia_used: true, text: [...texto.matchAll(/\[\[JG_SEG_(\d{6})\]\]\n([^\[]*)/g)]
    .map((m) => `[[JG_SEG_${m[1]}]]\n${m[2].trim().slice(0, Math.max(1, Math.round(m[2].trim().length * fraccion)))}`).join('\n\n') });
  const conSecuencia = (fracciones) => {
    const pedidos = [];
    const servicio = new tr.TranslationService({ traducirTexto: async (texto) => { pedidos.push(texto); return recortada(texto, fracciones[Math.min(pedidos.length - 1, fracciones.length - 1)]); } });
    return { servicio, pedidos };
  };
  const compacto = conSecuencia([0.8, 0.78]);
  const aceptado = await compacto.servicio.traducirLote([4, 5, 6, 7], segmentos, {});
  comprobar(compacto.pedidos.length === 2 && [...aceptado.values()].every(Boolean), `dos respuestas igual de compactas se aceptan: es el idioma, no un hueco (${compacto.pedidos.length} llamadas; antes se partía hasta 7)`);
  const segundaCompleta = conSecuencia([0.8, 1]);
  const completo = await segundaCompleta.servicio.traducirLote([4, 5, 6, 7], segmentos, {});
  comprobar(segundaCompleta.pedidos.length === 2 && completo.get(7) === segmentos[7].text, 'si el segundo intento vuelve completo, se usa ese');
  const hueco = conSecuencia([0.5]);
  await hueco.servicio.traducirLote([4, 5, 6, 7], segmentos, {});
  comprobar(hueco.pedidos.length > 2 && /JG_SEG_000004[\s\S]*JG_SEG_000005/.test(hueco.pedidos[1]) && !/JG_SEG_000006/.test(hueco.pedidos[1]), 'con la mitad del texto (falta algo casi seguro), el lote se parte en mitades');
  const corto = conSecuencia([0.75]);
  await corto.servicio.traducirLote([4, 5], segmentos, {});
  comprobar(corto.pedidos.length === 1, 'un lote de 1-2 segmentos algo compacto se acepta sin repetir');
}
{
  // Ritmo común: ninguna llamada del traductor sale antes del intervalo mínimo
  // desde la anterior, aunque se pidan a la vez (reloj real, intervalo de 60 ms).
  const salidas = [];
  const servicio = new tr.TranslationService({
    intervaloMinMs: 60,
    traducirTexto: async (texto) => { salidas.push(Date.now()); return { ia_used: true, text: texto.replace(/\n(?!\[\[)/g, '\nES ') }; },
  });
  const segmentos = ts.normalizarSegmentos(fixture.segments);
  await Promise.all([servicio.traducirLote([0, 1], segmentos, {}), servicio.traducirLote([2, 3], segmentos, {}), servicio.traducirLote([4], segmentos, {})]);
  const pausas = salidas.slice(1).map((t, i) => t - salidas[i]);
  comprobar(salidas.length === 3 && pausas.every((p) => p >= 55), `las llamadas del traductor salen espaciadas aunque se pidan a la vez (${pausas.join(', ')} ms ≥ 60)`);
}
{
  // Primer lote corto (4 segmentos) y hasta 2 en vuelo, siempre a ≥1,1 s entre salidas.
  const segmentos = ts.normalizarSegmentos(repetir(fixture.segments, 4));
  const tiempo = { ms: 0 };
  const lotes = [];
  const pendientes = [];
  const traductor = { traducirLote: (indices) => new Promise((resolver) => { lotes.push({ indices, t: tiempo.ms }); pendientes.push(() => resolver(new Map(indices.map((i) => [i, `ES ${i}`])))); }) };
  const servicioVoz = new ds.DubbingService({ generarAudio: async () => ({ blob: new Blob(['x']) }) });
  servicioVoz.definirUnidades(ds.agruparPorTiempo(segmentos));
  const motor = new MotorPreparacion({ segmentos, servicioVoz, traductor, posicion: () => 0, reloj: { iniciar() {}, detener() {} }, ahora: () => tiempo.ms });
  motor.paso();
  comprobar(lotes.length === 1 && lotes[0].indices.length <= pl.LOTE_ARRANQUE, `el primer lote es corto (${lotes[0]?.indices.length} segmentos): la IA contesta antes`);
  motor.paso();
  comprobar(lotes.length === 1, 'el segundo no sale en el mismo instante (ritmo de Mistral)');
  tiempo.ms = 1100;
  motor.paso();
  comprobar(lotes.length === 2 && lotes[1].t - lotes[0].t >= 1100, 'a 1,1 s sale el segundo aunque el primero siga en vuelo (2 a la vez)');
  tiempo.ms = 2200;
  motor.paso();
  comprobar(lotes.length === 2, 'nunca más de 2 en vuelo');
  pendientes.forEach((f) => f());
  await new Promise((r) => setTimeout(r, 0));
  comprobar(pl.VOZ_INICIAL_S === 6, 'para arrancar basta la primera frase (6 s de voz lista; antes 20)');
}
{
  // Un fallo que no es límite de uso: espera corta (3 s) y creciente, y repite el mismo lote.
  const segmentos = ts.normalizarSegmentos(repetir(fixture.segments, 2));
  const tiempo = { ms: 0 };
  const mensajes = [];
  const pedidos = [];
  let fallar = 2;
  const traductor = { traducirLote: async (indices) => {
    pedidos.push(indices[0]);
    if (fallar > 0) { fallar -= 1; throw new Error('No se pudo contactar al servidor'); }
    return new Map(indices.map((i) => [i, `ES ${i}`]));
  } };
  const servicioVoz = new ds.DubbingService({ generarAudio: async () => ({ blob: new Blob(['x']) }) });
  servicioVoz.definirUnidades(ds.agruparPorTiempo(segmentos));
  const motor = new MotorPreparacion({ segmentos, servicioVoz, traductor, posicion: () => 0, reloj: { iniciar() {}, detener() {} }, ahora: () => tiempo.ms, onCambio: (e) => { if (e?.tipo === 'pausa') mensajes.push(e.mensaje); } });
  const tick = async () => { motor.paso(); await new Promise((r) => setTimeout(r, 0)); };
  await tick();
  comprobar(/3 s/.test(mensajes[0] || ''), `el primer fallo espera 3 s, no 15 («${mensajes[0] || ''}»)`);
  tiempo.ms = 3000; await tick();
  comprobar(/8 s/.test(mensajes[1] || ''), 'el segundo, 8 s');
  tiempo.ms = 11000; await tick();
  comprobar(pedidos.length === 3 && pedidos.every((p) => p === pedidos[0]), 'y se repite el MISMO lote, sin marcar nada como intraducible');
  comprobar(motor.traducciones.size > 0 && [...motor.traducciones.values()].every((t) => t !== null), 'al volver la red, el lote queda traducido');
}
{
  // La voz: duración por tamaño (sin decodificar) y fracciones para el subtítulo.
  const segundoMp3 = new Blob([new Uint8Array(6000)], { type: 'audio/mpeg' });   // 48 kbps = 6000 B/s
  comprobar(cerca(await ds.duracionPorBytes(segundoMp3, 'azure-neural-regional'), 1), 'un MP3 neural de 6000 bytes dura 1 s (48 kbps fijos)');
  comprobar(cerca(await ds.duracionPorBytes(new Blob([new Uint8Array(16000)], { type: 'audio/mpeg' }), 'fish-neural-regional'), 1), 'uno de Fish de 16000 bytes, 1 s (128 kbps)');
  comprobar(await ds.duracionPorBytes(new Blob(['x'])) === null, 'sin tipo conocido no se inventa una duración');
  const servicio = new ds.DubbingService({ generarAudio: async () => ({ blob: new Blob([new Uint8Array(12000)], { type: 'audio/mpeg' }), engineHdr: 'azure' }) });
  servicio.definirUnidades(ds.agruparPorTiempo(ts.normalizarSegmentos(fixture.segments)));
  servicio.fijarTexto(0, 'Hola mundo', [0.4, 1]);
  await servicio.asegurar(0);
  comprobar(cerca(servicio.unidades[0].duracionVoz, 2) && JSON.stringify(servicio.unidades[0].fracciones) === '[0.4,1]', 'cada frase guarda su duración real y dónde termina cada segmento');
  servicio.invalidarDesde(0);
  comprobar(servicio.unidades[0].duracionVoz === 0, 'al cambiar de voz, la duración se vuelve a medir');
}

// ── Un `null` guardado no es «ya traducido» (v167) ──────────────────────
// Un segmento que no se pudo traducir se guardaba como `null` y, al reabrir el
// video, contaba como hecho: ese tramo sonaba en inglés para siempre (medido el
// 2026-10-02: 3 de 36 subtítulos, por la protección de tecnicismos de v165).
{
  const segmentos = ts.normalizarSegmentos(fixture.segments);
  const crearMotor = (pedidos, respuesta = (i) => `ES ${i}`) => {
    const traductor = { traducirLote: async (indices) => { pedidos.push(...indices); return new Map(indices.map((i) => [i, respuesta(i)])); } };
    const servicioVoz = new ds.DubbingService({ generarAudio: async () => ({ blob: new Blob(['x']) }) });
    servicioVoz.definirUnidades(ds.agruparPorTiempo(segmentos));
    return new MotorPreparacion({ segmentos, servicioVoz, traductor, posicion: () => 0, reloj: { iniciar() {}, detener() {} }, ahora: () => 0 });
  };
  const guardadas = segmentos.map((_, i) => [i, i === 2 ? null : `ES ${i}`]);

  const pedidos = [];
  const motor = crearMotor(pedidos);
  motor.sembrar(guardadas);
  motor.paso();
  await new Promise((r) => setTimeout(r, 0));
  comprobar(pedidos.includes(2), `un null guardado (de una versión anterior) se vuelve a pedir al reabrir (pedidos: ${pedidos.join(',') || 'ninguno'})`);
  comprobar(!pedidos.includes(0) && !pedidos.includes(5), 'lo que sí estaba traducido no se vuelve a pagar');
  comprobar(motor.traducciones.get(2) === 'ES 2', 'y el tramo queda traducido');
  comprobar(!motor.intentosFallidos.has(2), 'al traducirse, se olvidan sus intentos fallidos');

  const pedidosTope = [];
  const motorTope = crearMotor(pedidosTope);
  motorTope.sembrar(guardadas, [[2, tr.MAX_INTENTOS_TRADUCCION]]);
  motorTope.paso();
  await new Promise((r) => setTimeout(r, 0));
  comprobar(!pedidosTope.includes(2) && motorTope.traducciones.get(2) === null, `tras ${tr.MAX_INTENTOS_TRADUCCION} aperturas fallidas no se insiste (no se quema cuota)`);

  const pedidosFallo = [];
  const motorFallo = crearMotor(pedidosFallo, (i) => (i === 2 ? null : `ES ${i}`));
  motorFallo.sembrar(guardadas, [[2, 1]]);
  motorFallo.paso();
  await new Promise((r) => setTimeout(r, 0));
  comprobar(motorFallo.intentosFallidos.get(2) === 2, 'si vuelve a fallar, se anota un intento más');
  motorFallo.paso();
  await new Promise((r) => setTimeout(r, 0));
  comprobar(pedidosFallo.filter((i) => i === 2).length === 1, 'y dentro de la misma sesión no se repite (un intento por apertura)');

  const ya = tr.traduccionesReutilizables([[0, 'a'], [1, null], [2, null]], [[2, tr.MAX_INTENTOS_TRADUCCION]]);
  comprobar(ya.get(0) === 'a' && !ya.has(1) && ya.get(2) === null, 'traduccionesReutilizables: deja fuera los null con intentos por delante');
  comprobar(tr.traduccionesReutilizables(undefined, undefined).size === 0, 'traduccionesReutilizables: un registro viejo sin datos no rompe');
  const intentos = tr.anotarIntentos([[1, 1], [4, 2]], [[1, null], [4, 'ok'], [7, null]]);
  comprobar(JSON.stringify(intentos) === '[[1,2],[7,1]]', `anotarIntentos: suma al que falló y olvida al que se tradujo (${JSON.stringify(intentos)})`);

  // Descargas: traducirTodo con lo guardado vuelve a pedir el null.
  const pedidosTodo = [];
  const servicio = new tr.TranslationService({ traducirTexto: async (texto) => { pedidosTodo.push(texto); return texto.replace(/(\]\]\n)/g, '$1ES '); } });
  const pocos = segmentos.slice(0, 3);
  await servicio.traducirTodo(pocos, { ya: tr.traduccionesReutilizables([[0, 'ES 0'], [1, 'ES 1'], [2, null]], []) });
  comprobar(pedidosTodo.length === 1 && pedidosTodo[0].includes('JG_SEG_000002') && !pedidosTodo[0].includes('JG_SEG_000000'), 'la descarga también vuelve a pedir el tramo que quedó sin traducir');
}

// ── Voz constante (v152) ────────────────────────────────────────────────
// Al cambiar de voz, una frase que se estaba generando con la voz vieja sonaba
// intercalada con la nueva. Ahora ese audio se descarta y se rehace.
{
  let soltar = null;
  let llamadas = 0;
  const servicio = new ds.DubbingService({ generarAudio: (texto) => { llamadas += 1; return llamadas === 1 ? new Promise((r) => { soltar = () => r({ blob: new Blob(['vieja']) }); }) : Promise.resolve({ blob: new Blob(['nueva']) }); } });
  servicio.definirUnidades(ds.agruparPorTiempo(ts.normalizarSegmentos(fixture.segments)));
  servicio.fijarTexto(0, 'Hola');
  const enCurso = servicio.asegurar(0);
  await new Promise((r) => setTimeout(r, 0));   // la síntesis ya salió
  servicio.invalidarDesde(0);   // la persona cambió de voz
  soltar();
  await enCurso;
  comprobar(servicio.unidades[0].estado === 'pendiente' && !servicio.unidades[0].url, 'el audio que se generaba con la voz vieja se descarta');
  await servicio.asegurar(0);
  comprobar(servicio.unidades[0].estado === 'listo' && llamadas === 2, 'y la frase se rehace con la voz nueva');
}
{
  const html = fs.readFileSync(path.join(raiz, 'index.html'), 'utf8');
  comprobar(/\{ text: texto, lang: 'es', idiomaFijo: true \}/.test(html), 'el doblaje pide la voz con idioma fijo (sin voz inglesa para frases con nombres)');
}

// ── Resumen ─────────────────────────────────────────────────────────────
{
  let llamadas = 0;
  const servicio = new ts.TranscriptionService({ fetchApi: async () => {
    llamadas += 1;
    return Response.json({ language: 'en', duration_s: 7200, segments: [
      { start: 0, end: 3, text: 'Use React hooks.' },
      { start: 7197, end: 7200, text: 'The final array.' },
    ] });
  } });
  const r = await servicio.obtenerParaDoblaje('https://youtu.be/abc123xyz00', { duracionS: 7200 });
  comprobar(llamadas === 1 && r.duracionS === 7200 && r.segmentos.at(-1).endTime === 7200, 'YouTube: 120:00 admite texto con tiempos hasta la última frase');
  let error = null;
  try { await servicio.obtenerParaDoblaje('https://youtu.be/abc123xyz00', { duracionS: 7200.001 }); } catch (e) { error = e; }
  comprobar(error?.codigo === 'video_largo' && llamadas === 1, 'YouTube: más de 120 min se rechaza antes de pedir transcripción');
  const largo = new ts.TranscriptionService({ fetchApi: async () => Response.json({ duration_s: 7201, segments: fixture.segments }) });
  error = null;
  try { await largo.obtenerParaDoblaje('https://youtu.be/abc123xyz00'); } catch (e) { error = e; }
  comprobar(error?.codigo === 'video_largo', 'YouTube: valida también la duración recibida del servidor');
}
console.log(`\n${ok} comprobaciones OK · ${fallos} fallos`);
process.exit(fallos ? 1 : 0);
