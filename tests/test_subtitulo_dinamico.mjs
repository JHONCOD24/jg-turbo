/* Subtítulo dinámico: trocear un segmento en trozos de ≤ 2 renglones y elegir el
 * trozo según el progreso de la voz. Puro: la medida del ancho se inyecta.
 *   node tests/test_subtitulo_dinamico.mjs
 */
import {
  normalizarTexto, trocearSubtitulo, lineasQueOcupa, pesosDeTrozos, trozoPorProgreso, progresoEnSegmento, costoDeHabla,
} from '../js/youtube/subtituloDinamico.js';

let ok = 0;
const fallos = [];
function comprobar(nombre, cond, detalle = '') {
  if (cond) { ok += 1; console.log(`OK: ${nombre}`); }
  else { fallos.push(nombre); console.log(`FALLO: ${nombre}${detalle ? ` — ${detalle}` : ''}`); }
}

// Medida inyectada: 10 px por carácter. Renglón de 300 px = 30 caracteres.
const medir = (t) => t.length * 10;
const ANCHO = 300;
const palabras = (t) => normalizarTexto(t).split(' ').filter(Boolean);

const LARGO = 'Cuando construyes una marca que vende en la nueva era de la inteligencia artificial, lo primero que debes entender es que la confianza se gana despacio; los atajos, en cambio, se pagan caros. Por eso conviene empezar por escuchar a tus clientes, medir lo que funciona, y repetirlo sin prisa ni miedo, día tras día, semana tras semana. Así, poco a poco, la marca deja de perseguir al público y el público empieza a buscarla.';

console.log('── normalizar ──');
comprobar('normalizar colapsa espacios y saltos', normalizarTexto('  hola \n\n  mundo\t!  ') === 'hola mundo !');
comprobar('normalizar de vacío/null da vacío', normalizarTexto('') === '' && normalizarTexto(null) === '' && normalizarTexto(undefined) === '');

console.log('── trocear ──');
const trozos = trocearSubtitulo(LARGO, { medir, anchoMax: ANCHO });
comprobar(`texto largo (${LARGO.length} car.) sale en varios trozos`, LARGO.length >= 400 && trozos.length >= 6, `${trozos.length}`);
comprobar('cada trozo cabe en ≤ 2 renglones', trozos.every((t) => lineasQueOcupa(t, medir, ANCHO) <= 2), trozos.filter((t) => lineasQueOcupa(t, medir, ANCHO) > 2).join(' | '));
comprobar('la unión de trozos es el texto original (ninguna palabra perdida ni repetida)', palabras(trozos.join(' ')).join(' ') === palabras(LARGO).join(' '));
comprobar('ningún trozo está vacío ni empieza/termina con espacio', trozos.every((t) => t.length > 0 && t === t.trim()));
comprobar('prefiere cortar en fin de oración o coma', trozos.slice(0, -1).filter((t) => /[.,;:!?…]$/.test(t)).length >= Math.floor((trozos.length - 1) / 2), JSON.stringify(trozos));
comprobar('no deja un trozo final de una sola palabra', palabras(trozos[trozos.length - 1]).length >= 2, trozos[trozos.length - 1]);
comprobar('un renglón más angosto da más trozos y sigue cabiendo', (() => {
  const t = trocearSubtitulo(LARGO, { medir, anchoMax: 180 });
  return t.length > trozos.length && t.every((x) => lineasQueOcupa(x, medir, 180) <= 2) && palabras(t.join(' ')).join(' ') === palabras(LARGO).join(' ');
})());
comprobar('maxLineas=1 cabe en 1 renglón', trocearSubtitulo(LARGO, { medir, anchoMax: ANCHO, maxLineas: 1 }).every((t) => lineasQueOcupa(t, medir, ANCHO) <= 1));

console.log('── casos límite del troceo ──');
comprobar('texto vacío → sin trozos', trocearSubtitulo('', { medir, anchoMax: ANCHO }).length === 0 && trocearSubtitulo(null, { medir, anchoMax: ANCHO }).length === 0);
comprobar('solo espacios → sin trozos', trocearSubtitulo('   \n ', { medir, anchoMax: ANCHO }).length === 0);
comprobar('una palabra → un trozo', JSON.stringify(trocearSubtitulo('Hola', { medir, anchoMax: ANCHO })) === '["Hola"]');
comprobar('texto corto que cabe → un solo trozo', trocearSubtitulo('Hola, ¿cómo estás hoy?', { medir, anchoMax: ANCHO }).length === 1);
comprobar('solo signos → un trozo con los signos', JSON.stringify(trocearSubtitulo('... ?! —', { medir, anchoMax: ANCHO })) === '["... ?! —"]');
{
  const t = trocearSubtitulo('hola supercalifragilisticoespialidosoincreible adiós y más', { medir, anchoMax: 200 });
  comprobar('palabra más ancha que el renglón: no se parte ni se pierde', t.some((x) => x.includes('supercalifragilisticoespialidosoincreible')) && palabras(t.join(' ')).join(' ') === 'hola supercalifragilisticoespialidosoincreible adiós y más', JSON.stringify(t));
  comprobar('esa palabra enorme va sola en su trozo', t.find((x) => x.includes('supercali')) === 'supercalifragilisticoespialidosoincreible', JSON.stringify(t));
}
comprobar('sin medida o ancho inválido → el texto entero en un trozo', trocearSubtitulo(LARGO, { medir: null, anchoMax: ANCHO }).length === 1 && trocearSubtitulo(LARGO, { medir, anchoMax: 0 }).length === 1);

console.log('── sin palabra funcional colgando al final del trozo ──');
{
  const FUNC = ['de', 'del', 'la', 'el', 'los', 'las', 'un', 'una', 'y', 'o', 'que', 'en', 'a', 'al', 'con', 'por', 'para', 'se', 'su', 'sus', 'lo', 'le', 'no', 'sin', 'como', 'más'];
  const ultima = (t) => t.split(' ').pop().toLowerCase();
  const cuelga = (t) => FUNC.includes(ultima(t));   // sin puntuación pegada: «de,» no cuenta
  const MEDIDO = 'Cuando construyes una marca que vende en la nueva era de la inteligencia artificial, lo primero que debes entender es que la confianza se gana despacio';
  // El caso medido en el doblaje real: «…en la nueva era de la».
  const t320 = trocearSubtitulo(MEDIDO, { medir, anchoMax: 320 });
  comprobar('caso medido: el trozo ya no termina en «de la» (termina en «nueva era»)', t320[0].endsWith('nueva era') && !t320.some((t) => /\b(de la|era de)$/.test(t)), JSON.stringify(t320));
  comprobar('caso medido: lo retirado abre el trozo siguiente (ninguna palabra se pierde)', t320[1].startsWith('de la') && palabras(t320.join(' ')).join(' ') === palabras(MEDIDO).join(' '), JSON.stringify(t320));
  // Barrido: 4 textos × anchos de 150 a 500 px. Un trozo (salvo el último) solo puede colgar si retroceder lo dejaría < 40 % del renglón.
  const TEXTOS = [LARGO, MEDIDO,
    'Es la hora de que el equipo se ponga a trabajar con los datos y a mirar lo que de verdad importa para el cliente en la tienda y en la calle',
    'Una de las cosas que más me gusta de esto es que no hace falta saber de todo para empezar a hacer algo con lo que ya tienes en casa'];
  let trozosRevisados = 0; let colgando = 0; let colgandoInjustificado = 0; let rotos = 0;
  for (const texto of TEXTOS) {
    for (let ancho = 150; ancho <= 500; ancho += 10) {
      const lista = trocearSubtitulo(texto, { medir, anchoMax: ancho });
      if (palabras(lista.join(' ')).join(' ') !== palabras(texto).join(' ') || lista.some((t) => lineasQueOcupa(t, medir, ancho) > 2)) rotos += 1;
      lista.slice(0, -1).forEach((t, k) => {
        trozosRevisados += 1;
        if (!cuelga(t)) return;
        colgando += 1;
        // ¿Habría alternativa? Quitar las palabras funcionales del final debe dejar < 40 % de un renglón (o nada).
        const p = palabras(t);
        while (p.length && FUNC.includes(p[p.length - 1].toLowerCase())) p.pop();
        if (p.length && p.join(' ').length * 10 >= 0.4 * ancho) colgandoInjustificado += 1;
      });
    }
  }
  comprobar(`barrido: ${trozosRevisados} trozos revisados, ninguno cuelga sin motivo (${colgandoInjustificado}; ${colgando} cuelgan por la excepción del 40 %)`, trozosRevisados > 200 && colgandoInjustificado === 0);
  comprobar('barrido: la unión de trozos es el texto original y todos caben en 2 renglones', rotos === 0, `${rotos}`);
  // La excepción: si retroceder deja un trozo diminuto, se conserva el corte.
  const diminuto = trocearSubtitulo('a la supercalifragilisticoespialidosoincreible adiós y más cosas por hacer', { medir, anchoMax: 200 });
  comprobar('excepción: «a la» (< 40 % del renglón) no se vacía: retroceder dejaría un trozo inexistente', diminuto[0] === 'a la' && diminuto[1] === 'supercalifragilisticoespialidosoincreible', JSON.stringify(diminuto));
  const sobra = trocearSubtitulo('Hoy hablamos de la supercalifragilisticoespialidosoincreible manera de vivir en un mundo nuevo', { medir, anchoMax: 200 });
  comprobar('retroceder sí cuando queda ≥ 40 %: «Hoy hablamos» deja de colgar «de la»', sobra[0] === 'Hoy hablamos' && sobra[1] === 'de la', JSON.stringify(sobra));
  // Con puntuación el corte es legítimo: «…por eso, y» no, pero «…de la vida.» sí termina en palabra no funcional.
  const conComa = trocearSubtitulo('Llegamos tarde a casa y cenamos con calma, en la mesa de siempre, hablando de todo un poco y de nada', { medir, anchoMax: 300 });
  comprobar('con coma o punto el corte es legítimo y no se mueve', conComa.some((t) => /calma,$/.test(t)), JSON.stringify(conComa));
  // Varias funcionales seguidas retroceden todas.
  const dobles = trocearSubtitulo('Entramos juntos a contarte lo que pasa al final de la historia de un hombre que cambió el mundo', { medir, anchoMax: 280 });
  comprobar('varias funcionales seguidas («de la», «en el»…) retroceden juntas', !dobles.slice(0, -1).some(cuelga), JSON.stringify(dobles));
}

console.log('── lineasQueOcupa ──');
comprobar('cabe justo en un renglón', lineasQueOcupa('a'.repeat(30), medir, ANCHO) === 1);
comprobar('31 caracteres sin espacios (palabra ancha) ocupan 2', lineasQueOcupa('a'.repeat(31), medir, ANCHO) === 2);
comprobar('dos palabras de 20 car. ocupan 2 renglones', lineasQueOcupa(`${'a'.repeat(20)} ${'b'.repeat(20)}`, medir, ANCHO) === 2);
comprobar('vacío ocupa 0', lineasQueOcupa('', medir, ANCHO) === 0);

console.log('── costo de habla y pesos ──');
comprobar('costo crece con las letras', costoDeHabla('hola mundo') < costoDeHabla('hola mundo amigo'));
comprobar('un punto final cuesta más que nada', costoDeHabla('hola.') > costoDeHabla('hola'));
comprobar('un punto pesa más que una coma', costoDeHabla('hola.') > costoDeHabla('hola,'));
comprobar('vacío cuesta 0', costoDeHabla('') === 0);
{
  const p = pesosDeTrozos(['hola.', 'esto es una frase bastante más larga']);
  comprobar('pesos acumulados terminan en 1 y son crecientes', p.length === 2 && p[1] === 1 && p[0] > 0 && p[0] < p[1]);
  comprobar('el trozo largo pesa más que el corto', (p[1] - p[0]) > p[0]);
}

console.log('── trozo según progreso ──');
{
  const t = trocearSubtitulo(LARGO, { medir, anchoMax: ANCHO });
  let previo = -1; let monotono = true;
  for (let i = 0; i <= 200; i += 1) {
    const k = trozoPorProgreso(t, i / 200);
    if (k < previo) monotono = false;
    previo = k;
  }
  comprobar('progreso 0→1 es monótono', monotono);
  comprobar('progreso 0 → primer trozo; 1 → último', trozoPorProgreso(t, 0) === 0 && trozoPorProgreso(t, 1) === t.length - 1);
  const visitados = new Set(); for (let i = 0; i <= 1000; i += 1) visitados.add(trozoPorProgreso(t, i / 1000));
  comprobar('recorre todos los trozos en orden, sin saltarse ninguno', visitados.size === t.length);
  comprobar('progreso fuera de rango se acota', trozoPorProgreso(t, -5) === 0 && trozoPorProgreso(t, 7) === t.length - 1 && trozoPorProgreso(t, NaN) === 0 && trozoPorProgreso(t, undefined) === 0);
  comprobar('el trozo cambia hacia la mitad del habla: el medio no es el primero ni el último', (() => { const k = trozoPorProgreso(t, 0.5); return k > 0 && k < t.length - 1; })());
  comprobar('el reparto es por costo de habla, no por cantidad de trozos', (() => {
    const u = ['a.', 'una frase muy larga que tarda bastante en decirse completa.'];
    return trozoPorProgreso(u, 0.05) === 0 && trozoPorProgreso(u, 0.2) === 1;
  })());
}
comprobar('sin trozos → -1', trozoPorProgreso([], 0.5) === -1 && trozoPorProgreso(null, 0.5) === -1);
comprobar('un solo trozo → siempre 0', trozoPorProgreso(['hola'], 0) === 0 && trozoPorProgreso(['hola'], 1) === 0);

console.log('── progreso dentro del segmento ──');
{
  const unidad = { desde: 4, hasta: 6, fracciones: [0.2, 0.7, 1] };
  comprobar('primer segmento: 0.1 de la frase = mitad del segmento', Math.abs(progresoEnSegmento(unidad, 0.1, 4) - 0.5) < 1e-9);
  comprobar('segundo segmento arranca en 0 al llegar a 0.2', progresoEnSegmento(unidad, 0.2, 5) === 0);
  comprobar('segundo segmento: 0.45 = mitad', Math.abs(progresoEnSegmento(unidad, 0.45, 5) - 0.5) < 1e-9);
  comprobar('último: 1 → 1', progresoEnSegmento(unidad, 1, 6) === 1);
  comprobar('fuera de rango se acota a [0,1]', progresoEnSegmento(unidad, 0.9, 4) === 1 && progresoEnSegmento(unidad, 0.0, 6) === 0);
  comprobar('sin fracciones reparte en partes iguales', Math.abs(progresoEnSegmento({ desde: 0, hasta: 1 }, 0.25, 0) - 0.5) < 1e-9);
  comprobar('unidad nula → 0', progresoEnSegmento(null, 0.5, 0) === 0);
}

console.log(`\n${ok} comprobaciones OK · ${fallos.length} fallos`);
process.exit(fallos.length ? 1 : 0);
