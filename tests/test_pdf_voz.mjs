/* Pruebas de la capa de voz: pausas que suenan bien SIN tocar el texto real.
 * Ejecutar: node tests/test_pdf_voz.mjs
 */
import { prepararParaVoz } from '../js/pdf/vozTexto.js';

let fallos = 0;
function comprobar(condicion, mensaje) {
  if (condicion) console.log(`OK: ${mensaje}`);
  else { fallos += 1; console.error(`FALLO: ${mensaje}`); }
}

/* ── Lo que ya funcionaba debe seguir funcionando ──────────────────── */
{
  comprobar(prepararParaVoz('Vivió en el S. XIX tranquilo', 'es').includes('siglo diecinueve'),
    'sigue expandiendo los siglos romanos');
  comprobar(prepararParaVoz('Fui a EE. UU. de vacaciones', 'es').includes('Estados Unidos'),
    'sigue expandiendo las siglas');
  comprobar(!prepararParaVoz('Párrafo.\n\nSiguiente', 'es').includes('..'),
    'sigue sin generar el doble punto');
  comprobar(prepararParaVoz('', 'es') === '', 'texto vacío devuelve vacío');
  comprobar(prepararParaVoz(null, 'es') === '', 'null no rompe');
}

/* ── Pausa después de un título ────────────────────────────────────── */
{
  /* Sin punto, el motor lee «CAPITULO PRIMERO En un lugar» de corrido. */
  const entra = 'CAPITULO PRIMERO\n\nEn un lugar de la Mancha vivia un hidalgo.';
  const sale = prepararParaVoz(entra, 'es');
  comprobar(/CAPITULO PRIMERO[.:]/.test(sale), 'cierra el titulo para que la voz haga pausa');
  comprobar(sale.includes('En un lugar'), 'el cuerpo sigue intacto');

  /* Un título que YA tiene punto no recibe otro. */
  const conPunto = prepararParaVoz('CAPITULO PRIMERO.\n\nEn un lugar.', 'es');
  comprobar(!conPunto.includes('..'), 'no duplica el punto de un titulo que ya lo tenia');

  /* Un párrafo normal no se toca: solo las líneas cortas y sueltas. */
  const parrafo = 'En un lugar de la Mancha de cuyo nombre no quiero acordarme vivia un hidalgo\n\nY tenia una espada.';
  const salida = prepararParaVoz(parrafo, 'es');
  comprobar(!/hidalgo\./.test(salida), 'un parrafo largo sin punto no recibe punto inventado');
}

/* ── Comas prosódicas: solo para la voz ────────────────────────────── */
{
  const entra = 'Quiso llegar temprano pero el tren se retraso una hora entera.';
  const sale = prepararParaVoz(entra, 'es');
  comprobar(sale.includes(', pero'), 'inserta pausa antes de "pero"');
  /* Y no la duplica si ya estaba. */
  const yaTenia = prepararParaVoz('Quiso llegar, pero no pudo.', 'es');
  comprobar(!yaTenia.includes(',, pero') && !yaTenia.includes(', , pero'),
    'no duplica una coma existente');
}

/* ── La invariante que no se puede romper ──────────────────────────── */
{
  /* Las mismas palabras, en el mismo orden. Solo cambian signos y espacios. */
  const entra = 'CAPITULO II\n\nQuiso llegar temprano pero el tren se retraso.';
  const sale = prepararParaVoz(entra, 'es');
  const palabras = (t) => t.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(Boolean);
  comprobar(JSON.stringify(palabras(entra)) === JSON.stringify(palabras(sale)),
    'NO cambia ninguna palabra del texto: solo signos');
}

/* ── Se puede desactivar ───────────────────────────────────────────── */
{
  const entra = 'CAPITULO PRIMERO\n\nQuiso llegar pero no pudo.';
  const crudo = prepararParaVoz(entra, 'es', { pausarTitulos: false, comasProsodicas: false });
  comprobar(!/CAPITULO PRIMERO\./.test(crudo), 'se puede desactivar la pausa de titulo');
  comprobar(!crudo.includes(', pero'), 'se puede desactivar la coma prosodica');
}

/* ── Otros idiomas no se tocan ─────────────────────────────────────── */
{
  const en = prepararParaVoz('CHAPTER ONE\n\nHe wanted to arrive but the train was late.', 'en');
  comprobar(!en.includes(', but'), 'no aplica reglas del español a otro idioma');
}

console.log(fallos ? `\n${fallos} FALLO(S)` : '\nTodo en verde');
process.exit(fallos ? 1 : 0);
