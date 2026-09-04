/* Pruebas de la guía de lectura: la frase resaltada mientras suena la voz.
 * Ejecutar: node tests/test_pdf_guia.mjs
 *
 * Estas dos reglas nacen de un fallo concreto: la marca «titilaba», saltando
 * adelante y atrás durante el primer minuto de lectura hasta que se calmaba.
 *
 * La causa medida: el audio se genera por tandas. Al arrancar, la cola tiene
 * uno o dos bloques y solo se calculaban esas anclas; como la última se
 * extiende «hasta el final del texto», cada bloque posterior hacía que la
 * marca barriera el capítulo entero y volviera al principio en el siguiente.
 *
 * La lógica vive dentro del controlador (necesita DOM), así que aquí se
 * comprueban las dos reglas por separado, que es donde estaba el error.
 */

let fallos = 0;
function comprobar(condicion, mensaje) {
  if (condicion) console.log(`OK: ${mensaje}`);
  else { fallos += 1; console.error(`FALLO: ${mensaje}`); }
}

/* Copia exacta de `posicionDeVoz` del controlador, sin el DOM. */
function posicionDeVoz({ bloque, dentroBloque }, anclas, largoCompacto) {
  if (!anclas.length) return null;
  const i = Math.max(0, Math.min(anclas.length - 1, Number(bloque) || 0));
  const inicio = anclas[i];
  const fin = i + 1 < anclas.length ? anclas[i + 1] : largoCompacto;
  const dentro = Math.max(0, Math.min(1, Number(dentroBloque) || 0));
  return Math.round(inicio + (fin - inicio) * dentro);
}

const LARGO = 20000;

/* ── 1) Anclas incompletas: el barrido que se veía como parpadeo ────── */
{
  const pocas = [0, 900];                    /* lo que había al arrancar */
  const recorrido = [0, 0.5, 1].map((d) => posicionDeVoz({ bloque: 3, dentroBloque: d }, pocas, LARGO));
  const barre = recorrido[2] - recorrido[0];
  comprobar(barre > LARGO * 0.5,
    `con anclas incompletas un solo bloque barre casi todo el texto (${barre} de ${LARGO}) — el fallo`);

  const completas = Array.from({ length: 12 }, (_, i) => Math.round((LARGO / 12) * i));
  const conTodas = [0, 0.5, 1].map((d) => posicionDeVoz({ bloque: 3, dentroBloque: d }, completas, LARGO));
  const barreBien = conTodas[2] - conTodas[0];
  comprobar(barreBien < LARGO * 0.2,
    `con las anclas al día cada bloque cubre solo su tramo (${barreBien} de ${LARGO})`);
  comprobar(conTodas[0] < conTodas[1] && conTodas[1] < conTodas[2],
    'y dentro del bloque la marca avanza, nunca retrocede');
}

/* ── 2) Hay que resituar cuando la cola crece ───────────────────────── */
{
  /* Réplica de la condición del controlador. */
  const hayQueResituar = (guia, datos, textos) =>
    guia.cola !== datos.cola || textos.length !== guia.bloques;

  const guia = { cola: 'tok1', bloques: 2 };
  comprobar(hayQueResituar(guia, { cola: 'tok1' }, new Array(9)),
    'la cola creció de 2 a 9 bloques: hay que volver a situar las anclas');
  comprobar(!hayQueResituar(guia, { cola: 'tok1' }, new Array(2)),
    'si no ha cambiado nada, no se recalcula (situar cuesta en un capítulo largo)');
  comprobar(hayQueResituar(guia, { cola: 'tok2' }, new Array(2)),
    'una lectura nueva siempre resitúa');
}

/* ── 3) La marca no vuelve atrás sola ───────────────────────────────── */
{
  /* Réplica de la regla del controlador. */
  const aceptaRetroceso = (guia, nuevoInicio) => {
    if (!guia.saltar && guia.desde >= 0 && nuevoInicio < guia.desde) return false;
    return true;
  };

  comprobar(aceptaRetroceso({ desde: 500, saltar: false }, 800),
    'avanzar siempre se acepta');
  comprobar(!aceptaRetroceso({ desde: 500, saltar: false }, 200),
    'retroceder solo, sin que nadie lo pida, se ignora: eso era el parpadeo');
  comprobar(aceptaRetroceso({ desde: 500, saltar: true }, 200),
    'pero si la persona saltó atrás (barra, doble toque, botón), se acepta');
  comprobar(aceptaRetroceso({ desde: -1, saltar: false }, 0),
    'al empezar, sin marca previa, cualquier posición vale');
}

console.log(fallos ? `\n${fallos} FALLO(S)` : '\nTodo en verde');
process.exit(fallos ? 1 : 0);
