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
  const motor = new MotorPreparacion({ segmentos, servicioVoz, traductor, posicion: () => posicion, limitadorVoz: limitador, reloj, ahora: () => ahora });
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

// ── Resumen ─────────────────────────────────────────────────────────────
console.log(`\n${ok} comprobaciones OK · ${fallos} fallos`);
process.exit(fallos ? 1 : 0);
