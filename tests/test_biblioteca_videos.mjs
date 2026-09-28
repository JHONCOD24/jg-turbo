/* Biblioteca de videos y descargas · funciones puras, sin navegador ni red.
 * Ejecutar: node tests/test_biblioteca_videos.mjs
 * Cada tarea del PLAN_BIBLIOTECA_VIDEOS_IMPLEMENTACION_LLM.md añade su sección
 * antes del bloque «Resumen». Cuenta las comprobaciones: si bajan, algo se cortó.
 */
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const modulo = (nombre) => import(pathToFileURL(path.join(raiz, 'js/youtube', nombre)).href);

let ok = 0;
let fallos = 0;
function comprobar(condicion, mensaje) {
  if (condicion) { ok += 1; console.log(`OK: ${mensaje}`); }
  else { fallos += 1; console.error(`FALLO: ${mensaje}`); }
}
const DIA = 86400000;
const AHORA = Date.UTC(2026, 8, 28, 15, 0, 0);

// ── Datos de la biblioteca ───────────────────────────────────────────────
const bv = await modulo('bibliotecaVideos.js');
{
  comprobar(bv.normalizarTexto('  Inteligencía  ARTIFICIAL ') === 'inteligencia artificial', 'normalizar quita tildes, mayúsculas y espacios de más');
  comprobar(bv.limpiarEtiqueta('  #marketing, digital ') === 'Marketing digital', 'una etiqueta pierde # y comas y empieza en mayúscula');
  comprobar(bv.limpiarEtiqueta('x'.repeat(50)).length === bv.MAX_LARGO_ETIQUETA, 'una etiqueta larguísima se corta a 30 caracteres');
  comprobar(bv.agregarEtiqueta(['IA'], '   ').motivo === 'vacia', 'etiqueta vacía: se dice por qué no entra');
  comprobar(bv.agregarEtiqueta(['Negocio'], 'négocio').motivo === 'repetida', 'etiqueta repetida aunque cambie una tilde');
  const diez = Array.from({ length: 10 }, (_, i) => `Tema ${i}`);
  comprobar(bv.agregarEtiqueta(diez, 'Once').motivo === 'tope', 'el tope de 10 etiquetas se respeta y se explica');
  comprobar(bv.agregarEtiqueta(['IA'], 'ventas').etiquetas.join('|') === 'IA|Ventas', 'agregar conserva el orden');
  comprobar(bv.quitarEtiqueta(['IA', 'Ventas'], 'ventas').join('|') === 'IA', 'quitar no distingue mayúsculas');

  comprobar(bv.estadoDeAvance(5, 600) === 'nuevo', 'menos de 15 s vistos = nuevo');
  comprobar(bv.estadoDeAvance(200, 600) === 'viendo', 'a mitad = en curso');
  comprobar(bv.estadoDeAvance(580, 600) === 'visto', 'a menos de 30 s del final = visto');
  comprobar(bv.estadoDeAvance(200, 0) === 'viendo', 'sin duración conocida no se da por visto');
  comprobar(bv.fraccionVista(300, 600) === 0.5 && bv.fraccionVista(590, 600) === 1 && bv.fraccionVista(10, 0) === 0, 'fracción vista para la barra');

  comprobar(JSON.stringify(bv.datosDeClave('x:123:1')) === JSON.stringify({ plataforma: 'x', id: '123', indice: 1 }), 'la clave x:<id>:<n> se lee');
  comprobar(bv.datosDeClave('dNWkwrqAkcM').plataforma === 'youtube', 'una clave sin prefijo es de YouTube');
  comprobar(bv.urlCanonica({ plataforma: 'x', id: '123', indice: 1 }) === 'https://x.com/i/status/123/video/2', 'URL canónica de X con 2.º video');
  comprobar(bv.urlCanonica({ plataforma: 'youtube', id: 'abc' }) === 'https://www.youtube.com/watch?v=abc', 'URL canónica de YouTube');
  comprobar(bv.portadaPorDefecto({ plataforma: 'youtube', id: 'abc' }) === 'https://i.ytimg.com/vi/abc/mqdefault.jpg', 'miniatura de YouTube derivada del id');
  comprobar(bv.portadaPorDefecto({ plataforma: 'x', id: '1' }) === '', 'X no tiene miniatura derivable: viene de /api/x-video');

  const primera = bv.fusionarEntrada(null, { clave: 'abc', titulo: 'Charla de IA', duracionS: 600, posicionS: 0 }, AHORA);
  comprobar(primera.estado === 'nuevo' && primera.creado === AHORA && primera.etiquetas.length === 0 && primera.favorito === false, 'entrada nueva: sin etiquetas ni favorito');
  const organizada = { ...primera, etiquetas: ['IA'], favorito: true };
  const luego = bv.fusionarEntrada(organizada, { clave: 'abc', titulo: '', posicionS: 300 }, AHORA + DIA);
  comprobar(luego.etiquetas.join() === 'IA' && luego.favorito === true, 'lo automático nunca borra etiquetas ni favorito');
  comprobar(luego.titulo === 'Charla de IA' && luego.estado === 'viendo' && luego.creado === AHORA, 'un título vacío no pisa el bueno; el avance sí se actualiza');
  comprobar(bv.fusionarEntrada(null, { clave: 'x:9' }, AHORA).titulo === 'Video de X', 'sin título: nombre genérico por plataforma');
  const conVoces = bv.fusionarEntrada(null, { clave: 'v2', voz: 'neural:es-CO:female', vozSecundaria: 'ninguna' }, AHORA);
  comprobar(bv.fusionarEntrada(conVoces, { clave: 'v2', posicionS: 40 }, AHORA).vozSecundaria === 'ninguna', 'la 2.ª voz elegida se conserva (las descargas suenan como el video)');
  comprobar(bv.fusionarEntrada(null, { clave: 'v3' }, AHORA).vozSecundaria === undefined, 'sin elección guardada queda sin definir (fichas viejas)');

  const migrada = bv.entradaDesdeDoblaje({ videoId: 'x:5', titulo: 'Clip', duracionS: 120, idiomaOrigen: 'en', posicionS: 40, actualizado: AHORA - DIA, segmentos: [], traducciones: [] }, AHORA);
  comprobar(migrada.plataforma === 'x' && migrada.creado === AHORA - DIA && migrada.abierto === AHORA - DIA && migrada.estado === 'viendo', 'migración v1: la fecha de la caché se conserva');

  const videos = [
    { ...bv.fusionarEntrada(null, { clave: 'a1', titulo: 'Agentes de IA en ventas', autor: 'Canal Uno', duracionS: 900, posicionS: 300, abierto: AHORA - 1000, creado: AHORA - 5 * DIA }, AHORA), etiquetas: ['Inteligencia artificial', 'Negocio'], favorito: true },
    { ...bv.fusionarEntrada(null, { clave: 'x:22', titulo: 'Clip de marketing', autor: 'marca', duracionS: 60, posicionS: 58, abierto: AHORA - 5000, creado: AHORA - DIA }, AHORA), etiquetas: ['Negocio'] },
    { ...bv.fusionarEntrada(null, { clave: 'b2', titulo: 'Curso de Python', autor: 'Profe', duracionS: 3600, posicionS: 0, abierto: AHORA - 9000, creado: AHORA - 2 * DIA }, AHORA), etiquetas: ['Aprender'] },
  ];
  comprobar(bv.filtrarVideos(videos).map((v) => v.clave).join() === 'a1,x:22,b2', 'orden por defecto: abiertos más recientes primero');
  comprobar(bv.filtrarVideos(videos, { orden: 'antiguos' }).map((v) => v.clave).join() === 'a1,b2,x:22', 'orden: más antiguos primero (por fecha de llegada)');
  comprobar(bv.filtrarVideos(videos, { orden: 'duracion' })[0].clave === 'b2', 'orden por duración');
  comprobar(bv.filtrarVideos(videos, { orden: 'titulo' }).map((v) => v.clave).join() === 'a1,x:22,b2', 'orden alfabético en español');
  comprobar(bv.filtrarVideos(videos, { plataforma: 'x' }).map((v) => v.clave).join() === 'x:22', 'filtro por plataforma');
  comprobar(bv.filtrarVideos(videos, { vista: 'favoritos' }).map((v) => v.clave).join() === 'a1', 'filtro de favoritos');
  comprobar(bv.filtrarVideos(videos, { vista: 'vistos' }).map((v) => v.clave).join() === 'x:22', 'filtro de vistos');
  comprobar(bv.filtrarVideos(videos, { vista: 'viendo' }).map((v) => v.clave).join() === 'a1', 'filtro de en curso');
  comprobar(bv.filtrarVideos(videos, { etiqueta: 'negocio' }).length === 2, 'filtro por etiqueta sin distinguir mayúsculas');
  comprobar(bv.filtrarVideos(videos, { texto: 'ventas ia' }).map((v) => v.clave).join() === 'a1', 'buscar con varias palabras en cualquier orden');
  comprobar(bv.filtrarVideos(videos, { texto: 'profe' }).map((v) => v.clave).join() === 'b2', 'buscar también por canal o autor');
  comprobar(bv.filtrarVideos(videos, { texto: 'inteligencia' }).map((v) => v.clave).join() === 'a1', 'buscar también por etiqueta');
  comprobar(bv.filtrarVideos(videos, { texto: 'zzz' }).length === 0, 'sin coincidencias → lista vacía (la vista muestra el estado «sin resultados»)');
  comprobar(bv.filtrarVideos(videos, { texto: 'recursion', coincidenEnTexto: new Map([['b2', {}]]) }).map((v) => v.clave).join() === 'b2', 'una coincidencia en lo que se dice también cuenta');
  comprobar(bv.filtrarVideos(videos, { texto: 'IA', plataforma: 'x' }).length === 0, 'los filtros se combinan');
  comprobar(bv.filtrarVideos([], { texto: 'x' }).length === 0 && bv.filtrarVideos(undefined).length === 0, 'biblioteca vacía o sin datos no rompe');

  const conteo = bv.etiquetasConConteo(videos);
  comprobar(conteo[0].etiqueta === 'Negocio' && conteo[0].cantidad === 2, 'las etiquetas más usadas van primero');
  const sug = bv.sugerenciasDeEtiquetas(videos, ['Negocio'], '');
  comprobar(!sug.includes('Negocio') && sug.includes('Inteligencia artificial') && sug.includes('Aprender'), 'sugerencias: las usadas, sin las que ya tiene el video');
  comprobar(bv.sugerenciasDeEtiquetas([], [], 'apre').join() === 'Aprender', 'sin videos, sugiere los temas de arranque que coinciden');
  comprobar(bv.seguirViendo(videos)?.clave === 'a1' && bv.seguirViendo([]) === null, '«Seguir viendo» = el último en curso');

  const registro = {
    segmentos: [{ startTime: 0, text: 'Hello everyone' }, { startTime: 754.2, text: 'Recursion is simple' }],
    traducciones: [[0, 'Hola a todos'], [1, 'La recursión es sencilla']],
  };
  const hallado = bv.buscarEnTranscripcion(registro, 'recursion sencilla');
  comprobar(hallado?.segundo === 754.2 && hallado.fragmento.startsWith('La recursión'), 'buscar en lo que se dice devuelve el segundo exacto');
  comprobar(bv.buscarEnTranscripcion(registro, 'recursion simple')?.indice === 1, 'también busca en el texto original');
  comprobar(bv.buscarEnTranscripcion(registro, '') === null && bv.buscarEnTranscripcion(null, 'x') === null, 'consulta vacía o sin registro → null');

  comprobar(bv.huellaTexto('Hola') === bv.huellaTexto('Hola') && bv.huellaTexto('Hola') !== bv.huellaTexto('Hola.'), 'la huella cambia si el texto cambia');
  comprobar(bv.claveDeVoz('abc', 'neural:auto:female', 'Hola') !== bv.claveDeVoz('abc', 'neural:auto:female', 'Hola', 1.2), 'la voz a 1,2× se guarda aparte de la de 1×');
  comprobar(bv.formatearDuracion(65) === '1:05' && bv.formatearDuracion(3725) === '1:02:05' && bv.formatearDuracion(0) === '0:00', 'duración 1:05 · 1:02:05');
  comprobar(bv.fechaRelativa(AHORA, AHORA) === 'Hoy' && bv.fechaRelativa(AHORA - DIA, AHORA) === 'Ayer' && bv.fechaRelativa(AHORA - 3 * DIA, AHORA) === 'Hace 3 días', 'fecha relativa: hoy, ayer, hace N días');
  comprobar(/sept?/.test(bv.fechaRelativa(Date.UTC(2026, 8, 12, 15), AHORA)), 'más de una semana: fecha corta en español');
}

// ── Pista doblada ────────────────────────────────────────────────────────
const pd = await modulo('pistaDoblada.js');
{
  comprobar(pd.tasaNecesaria(4, 5) === 1, 'si cabe, va a 1×');
  comprobar(pd.tasaNecesaria(5.4, 5) === 1.1, 'si no cabe, se acelera en pasos de 0,05 (5,4 s en 5 s → 1,1×)');
  comprobar(pd.tasaNecesaria(9, 5) === 1.25, 'nunca más de 1,25×');
  comprobar(pd.tasaNecesaria(0, 5) === 1 && pd.tasaNecesaria(3, 0) === 1.25, 'sin voz = 1×; sin espacio = tope');

  const unidades = [
    { indice: 0, startTime: 0, duracionVoz: 3 },
    { indice: 1, startTime: 4, duracionVoz: 4.5 },   // espacio 4 s → 1,15×
    { indice: 2, startTime: 8, duracionVoz: 2 },
  ];
  const { plan, corridas, maxRetrasoS } = pd.planearPista(unidades, { duracionVideoS: 20 });
  comprobar(plan[0].inicioS === 0 && plan[0].tasa === 1, 'la 1.ª frase empieza en su segundo, a 1×');
  comprobar(plan[1].tasa === 1.15 && plan[1].finS <= 8, 'la frase que no cabe se acelera lo justo y termina antes de la siguiente');
  comprobar(plan[2].inicioS === 8 && corridas === 0 && maxRetrasoS === 0, 'nadie se corre si todo cabe');
  const apretado = pd.planearPista([{ indice: 0, startTime: 0, duracionVoz: 10 }, { indice: 1, startTime: 4, duracionVoz: 2 }], { duracionVideoS: 30 });
  comprobar(apretado.corridas === 1 && apretado.plan[1].inicioS > 4 && apretado.plan[1].inicioS >= apretado.plan[0].finS, 'si ni a 1,25× cabe, empuja a la siguiente y lo cuenta (sin solaparse)');
  comprobar(apretado.duracionS === 30, 'la pista dura al menos lo que el video');
  const segunda = pd.planearPista([{ indice: 0, startTime: 0, duracionVoz: 3.9, tasa: 1.15 }], { acelerar: false, duracionVideoS: 10 });
  comprobar(segunda.plan[0].tasa === 1.15 && segunda.plan[0].duracionS === 3.9, 'segunda pasada: respeta la tasa ya aplicada y la duración real');
  comprobar(pd.planearPista([]).plan.length === 0, 'sin frases no rompe');

  const ventanas = pd.ventanasDeMezcla(75);
  comprobar(ventanas.length === 3 && ventanas[2].desdeS === 60 && ventanas[2].hastaS === 75, 'ventanas de 30 s hasta el final exacto');
  comprobar(pd.frasesEnVentana(plan, 2, 6).map((f) => f.indice).join() === '0,1', 'una frase que cruza el borde de la ventana entra');
  comprobar(pd.frasesEnVentana(plan, 3, 3.5).length === 0, 'una frase que termina justo donde empieza la ventana no entra');
  const costo = pd.resumenCosto(['Hola a todos.', '', 'x'.repeat(4987)]);
  comprobar(costo.frases === 2 && costo.caracteres === 5000 && costo.porcentajeAzureMes === 1, 'costo: 5 000 caracteres = 1 % de la cuota mensual de Azure');
}

// ── Silencio de la voz (hablaVoz.js · auditoría 2026-09-28) ─────────────
// Medido en producción: ~0,21 s de silencio delante y ~0,85 s detrás en cada frase.
const hv = await modulo('hablaVoz.js');
{
  const hz = 24000;
  const voz = (delante, habla, detras, nivel = 0.3) => {
    const muestras = new Float32Array(Math.round((delante + habla + detras) * hz));
    const desde = Math.round(delante * hz);
    for (let i = 0; i < Math.round(habla * hz); i += 1) muestras[desde + i] = nivel * Math.sin(i / 7);
    return muestras;
  };
  const medida = hv.limitesDeHabla(voz(0.21, 4.48, 0.85), hz);
  comprobar(Math.abs(medida.desdeS - 0.19) < 0.015 && Math.abs(medida.hastaS - 4.77) < 0.015,
    `el tramo hablado se encuentra con su margen (${medida.desdeS}–${medida.hastaS} s de ${medida.duracionS} s)`);
  const debil = hv.limitesDeHabla(voz(0.2, 1, 0.8, 0.004), hz);
  comprobar(debil && debil.hastaS > 1.2, 'una voz muy suave (−48 dB) no se toma por silencio');
  comprobar(hv.limitesDeHabla(new Float32Array(hz), hz) === null, 'un audio todo silencio no se recorta (null)');
  comprobar(hv.limitesDeHabla(new Float32Array(0), hz) === null && hv.limitesDeHabla(voz(0, 1, 0), 0) === null, 'sin muestras o sin frecuencia: null');
  const sinCola = hv.limitesDeHabla(voz(0, 2, 0), hz);
  comprobar(sinCola.desdeS === 0 && sinCola.hastaS === 2, 'si no hay silencio, el tramo es el audio entero (sin pasarse)');
  const buffer = { duration: 5.54, sampleRate: hz, getChannelData: () => voz(0.21, 4.48, 0.85) };
  comprobar(hv.limitesDeBuffer(buffer).hastaS < 4.8, 'un AudioBuffer se mide igual');
  comprobar(hv.limitesDeBuffer({ duration: 3 }).hastaS === 3, 'sin muestras (buffer simulado) se usa el audio entero');
  comprobar(await hv.medirHabla(new Blob(['x'])) === null, 'fuera del navegador (sin Web Audio) no mide: null, sin romper');

  // La pista usa el tramo hablado: el silencio no le quita espacio a nadie.
  const ex = await modulo('exportadorDoblaje.js');
  const frases = [{ indice: 0, startTime: 0, texto: 'uno' }, { indice: 1, startTime: 5, texto: 'dos' }];
  const tasas = [];
  const voces = await ex.prepararVoces(frases, {
    sintetizar: async (texto, { tasa }) => { tasas.push(tasa); return texto; },
    decodificar: async () => ({ duration: 5.54, sampleRate: hz, getChannelData: () => voz(0.21, 4.48, 0.85) }),
    duracionVideoS: 12,
  });
  comprobar(voces.aceleradas === 0 && tasas.every((t) => t === 1), '4,5 s de voz en 5 s de espacio: no se acelera (con el silencio contado habría pedido 1,15×)');
  comprobar(voces.plan[1].inicioS === 5 && voces.corridas === 0, 'y la frase siguiente entra en su segundo exacto');
  comprobar(voces.audios.get(0).desdeS > 0.15 && voces.audios.get(0).hastaS < 4.8, 'cada voz guarda su tramo para la mezcla');
  const sinDuracion = pd.planearPista([{ indice: 0, startTime: 0, duracionVoz: 3 }], { duracionVideoS: 0 });
  comprobar(sinDuracion.plan[0].tasa === 1 && sinDuracion.corridas === 0, 'video sin duración conocida: la última frase no se acelera ni se da por corrida');
}

// ── Descargas ────────────────────────────────────────────────────────────
const dd = await modulo('descargaDestino.js');
{
  const variantes = [
    { url: 'a', bitrate: 288000, ancho: 480, alto: 270 },
    { url: 'b', bitrate: 832000, ancho: 640, alto: 360 },
    { url: 'c', bitrate: 2176000, ancho: 1280, alto: 720 },
    { url: 'd', bitrate: 10368000, ancho: 1920, alto: 1080 },
  ];
  const opciones = dd.opcionesCalidadX(variantes, 1595);
  comprobar(opciones.map((o) => o.etiqueta).join() === '360p,720p,1080p', 'calidades ofrecidas sin repetir (270p y 360p cuentan como 360p; gana la mejor)');
  comprobar(opciones[0].url === 'b' && opciones[0].bytes === Math.round(832000 / 8 * 1595), 'el tamaño se estima con el bitrate × duración');
  comprobar(dd.opcionesCalidadX([{ url: 'v', bitrate: 950000, ancho: 720, alto: 1280 }], 60)[0].etiqueta === '720p', 'un video vertical se nombra por su lado corto');
  comprobar(dd.opcionesCalidadX([], 60).length === 0, 'sin variantes, sin opciones');
  comprobar(dd.elegirDestino({ puedeGuardarEnDisco: true, esMovil: false, bytesEstimados: 5e9 }).tipo === 'disco', 'Chrome de escritorio: directo al disco, sin tope');
  comprobar(dd.elegirDestino({ puedeGuardarEnDisco: false, esMovil: true, bytesEstimados: 100 * dd.MB }).tipo === 'memoria', 'celular: en memoria si cabe');
  comprobar(dd.elegirDestino({ puedeGuardarEnDisco: true, esMovil: true, bytesEstimados: 400 * dd.MB }).tipo === 'grande', 'celular: más de 250 MB no cabe (aunque diga que puede guardar en disco)');
  comprobar(dd.calidadQueCabe(opciones, 250 * dd.MB).etiqueta === '360p', 'la mejor calidad que cabe (26 min: 360p ≈ 158 MB)');
  comprobar(dd.calidadQueCabe(opciones, 1).etiqueta === '360p' && dd.calidadQueCabe([], 1) === null, 'si nada cabe, la más baja; sin opciones, null');
  comprobar(dd.estimarBytesMp3(3600) === 28800000, 'MP3 de 1 h a 64 kbps ≈ 27 MB');
  comprobar(dd.formatearBytes(158 * dd.MB) === '158 MB' && dd.formatearBytes(1.5 * 1024 * dd.MB) === '1,5 GB' && dd.formatearBytes(10) === '1 KB', 'tamaños legibles');
  comprobar(dd.nombreArchivo({ titulo: '¿Qué es la IA? — Parte 1', plataforma: 'x', tipo: 'doblado', extension: 'mp4' }) === 'jg-turbo-x-que-es-la-ia-parte-1-doblado-es.mp4', 'nombre de archivo limpio y en minúsculas');
  comprobar(dd.nombreArchivo({ titulo: '', tipo: 'audio', extension: 'mp3' }) === 'jg-turbo-youtube-video-audio-es.mp3', 'sin título: «video»');
}

// ── Voz guardada: no gasta el limitador de Azure (dubbingService.js) ──────
const ds = await modulo('dubbingService.js');
{
  let turnos = 0;
  let generadas = 0;
  const limitador = { disponible: () => true, esperaMs: () => 0, registrar: () => { turnos += 1; } };
  const blob = new Blob([new Uint8Array(6000)], { type: 'audio/mpeg' });
  const servicio = new ds.DubbingService({
    generarAudio: async () => { generadas += 1; return { blob }; },
    buscarGuardada: async (texto) => (texto === 'guardada' ? { blob, engineHdr: 'azure' } : null),
    limitador,
    medirDuracion: async () => 1,
  });
  servicio.definirUnidades([
    { indice: 0, startTime: 0, endTime: 2, estado: 'sin_traducir' },
    { indice: 1, startTime: 2, endTime: 4, estado: 'sin_traducir' },
  ]);
  servicio.fijarTexto(0, 'guardada');
  servicio.fijarTexto(1, 'nueva');
  await servicio.asegurar(0);
  await servicio.asegurar(1);
  comprobar(turnos === 1 && generadas === 1, 'la voz guardada no gasta turno del limitador ni se vuelve a pedir');
  comprobar(servicio.unidades[0].estado === 'listo' && servicio.unidades[0].duracionVoz === 1, 'la frase guardada queda lista y medida');
  const sinGuardado = new ds.DubbingService({ generarAudio: async () => ({ blob }), limitador, medirDuracion: async () => 1 });
  sinGuardado.definirUnidades([{ indice: 0, startTime: 0, endTime: 2, estado: 'sin_traducir' }]);
  sinGuardado.fijarTexto(0, 'x');
  await sinGuardado.asegurar(0);
  comprobar(turnos === 2, 'sin buscarGuardada todo sigue igual que antes (una frase = un turno)');

  // v157: la voz guardada trae su tramo hablado ya medido → no se decodifica otra vez.
  let medidas = 0;
  const habla = { duracionS: 5.54, desdeS: 0.19, hastaS: 4.77 };
  const conMedida = new ds.DubbingService({
    generarAudio: async () => ({ blob }), limitador, medirDuracion: async () => 5.54,
    buscarGuardada: async (texto) => (texto === 'medida' ? { blob, engineHdr: 'azure', habla } : null),
    medirHabla: async () => { medidas += 1; return { duracionS: 5.54, desdeS: 0.2, hastaS: 4.7 }; },
  });
  conMedida.definirUnidades([
    { indice: 0, startTime: 0, endTime: 5, estado: 'sin_traducir' },
    { indice: 1, startTime: 5, endTime: 10, estado: 'sin_traducir' },
  ]);
  conMedida.fijarTexto(0, 'medida');
  conMedida.fijarTexto(1, 'nueva');
  await conMedida.asegurar(0);
  const u0 = conMedida.unidades[0];
  comprobar(medidas === 0 && u0.vozDesdeS === 0.19 && u0.vozHastaS === 4.77 && Math.abs(u0.duracionVoz - 4.58) < 1e-9,
    'la voz guardada con su medida se usa tal cual: 0 decodificaciones');
  await conMedida.asegurar(1);
  comprobar(medidas === 1 && conMedida.unidades[1].vozHastaS === 4.7, 'una voz sin medida (nueva o vieja) se mide una vez');
  const medidaRota = new ds.DubbingService({
    generarAudio: async () => ({ blob, habla: { desdeS: 3, hastaS: 1 } }), medirDuracion: async () => 2,
    medirHabla: async () => { medidas += 1; return null; },
  });
  medidaRota.definirUnidades([{ indice: 0, startTime: 0, endTime: 2, estado: 'sin_traducir' }]);
  medidaRota.fijarTexto(0, 'x');
  await medidaRota.asegurar(0);
  comprobar(medidas === 2 && medidaRota.unidades[0].vozHastaS === 0 && medidaRota.unidades[0].duracionVoz === 2,
    'una medida guardada imposible se descarta y, si no se puede medir, se usa el audio entero');
  conMedida.liberar();
  medidaRota.liberar();
  servicio.liberar();
  sinGuardado.liberar();
}

// ── Resumen ─────────────────────────────────────────────────────────────
console.log(`\n${ok} comprobaciones OK · ${fallos} fallos`);
if (fallos) process.exit(1);
