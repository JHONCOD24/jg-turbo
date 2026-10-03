/* JG Turbo · Unidades de lectura (oraciones y cláusulas) del resaltado de voz.
 *   node tests/test_pdf_unidades_lectura.mjs
 *
 * `partirEnUnidades` decide QUÉ se marca mientras suena la voz: la oración
 * completa; si es larguísima, cláusulas cortadas en `; : — ,`; nunca a
 * mitad de palabra, de abreviatura, de decimal ni dejando un cierre suelto.
 */
import { partirEnUnidades, unidadEn } from '../js/pdf/unidadesLectura.js';

let ok = 0;
let fallos = 0;
function comprobar(condicion, mensaje, detalle = '') {
  if (condicion) { ok += 1; console.log(`OK: ${mensaje}`); } else {
    fallos += 1;
    console.error(`FALLO: ${mensaje}${detalle ? ` — ${detalle}` : ''}`);
  }
}
const textos = (t) => partirEnUnidades(t).map(([a, b]) => t.slice(a, b));
const igual = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/* ── Bordes ── */
comprobar(igual(partirEnUnidades(''), []), 'texto vacío → ninguna unidad');
comprobar(igual(partirEnUnidades('  \n\n \t '), []), 'solo espacios → ninguna unidad');
comprobar(igual(partirEnUnidades(null), []) && igual(partirEnUnidades(undefined), []), 'null y undefined no rompen');
comprobar(igual(partirEnUnidades('a'), [[0, 1]]), 'un solo carácter → una unidad [0,1]');
comprobar(igual(partirEnUnidades('.'), [[0, 1]]), 'un solo punto no se cuelga');
comprobar(igual(textos('  Hola.  '), ['Hola.']), 'los espacios de los bordes no entran en la unidad');
comprobar(igual(partirEnUnidades('  Hola.  '), [[2, 7]]), 'las posiciones son del texto original (con sangría)');

/* ── Oraciones simples ── */
comprobar(
  igual(textos('Hola mundo. Esto es otra frase. ¿Y esta? ¡Sí!'), ['Hola mundo.', 'Esto es otra frase.', '¿Y esta?', '¡Sí!']),
  'cuatro oraciones con . ? !',
);
comprobar(igual(textos('Sin punto final'), ['Sin punto final']), 'una oración sin punto final es una unidad');
comprobar(igual(textos('Uno. Dos'), ['Uno.', 'Dos']), 'el resto sin punto también es unidad');

/* ── Abreviaturas ── */
comprobar(igual(textos('El Sr. Pérez llegó con la Dra. Gómez.'), ['El Sr. Pérez llegó con la Dra. Gómez.']), '«Sr.» y «Dra.» no cortan');
comprobar(igual(textos('Viven en EE. UU. desde 2010. Luego volvieron.'), ['Viven en EE. UU. desde 2010.', 'Luego volvieron.']), '«EE. UU.» no corta y «2010.» sí');
comprobar(igual(textos('Compró pan, leche, etc. y se fue.'), ['Compró pan, leche, etc. y se fue.']), '«etc.» seguido de minúscula no corta');
comprobar(igual(textos('Compró pan, leche, etc. Luego volvió.'), ['Compró pan, leche, etc.', 'Luego volvió.']), '«etc.» seguido de mayúscula sí corta');
comprobar(igual(textos('Mira el apartado, p. ej. el tercero, y sigue.'), ['Mira el apartado, p. ej. el tercero, y sigue.']), '«p. ej.» no corta');
comprobar(igual(textos('Lee la pág. 12 y la fig. 3. Después descansa.'), ['Lee la pág. 12 y la fig. 3.', 'Después descansa.']), '«pág. 12» no corta');
comprobar(igual(textos('Escribió J. R. R. Tolkien en Oxford.'), ['Escribió J. R. R. Tolkien en Oxford.']), 'las iniciales de un nombre no cortan');
comprobar(igual(textos('El prof. Ramírez dio clase.'), ['El prof. Ramírez dio clase.']), '«prof.» no corta');

/* ── Decimales y números ── */
comprobar(igual(textos('Mide 3.5 metros y pesa 1.200 kilos. Fin.'), ['Mide 3.5 metros y pesa 1.200 kilos.', 'Fin.']), 'decimales 3.5 y miles 1.200 no cortan');
comprobar(igual(textos('Salió a las 7.30 de la mañana.'), ['Salió a las 7.30 de la mañana.']), 'la hora 7.30 no corta');
comprobar(igual(textos('Fue en 2020. Luego cambió.'), ['Fue en 2020.', 'Luego cambió.']), 'un año al final de la oración sí corta');
comprobar(igual(textos('1. Primero\n2. Segundo\n3. Tercero'), ['1. Primero', '2. Segundo', '3. Tercero']), 'una lista numerada: «1.» no queda suelto');

/* ── Cierres: comillas, paréntesis ── */
{
  const t = 'Dijo: «No voy». Luego se fue.';
  comprobar(igual(textos(t), ['Dijo: «No voy».', 'Luego se fue.']), 'el cierre » viaja con su oración');
  const t2 = 'Gritó "hola." Y salió corriendo.';
  comprobar(igual(textos(t2), ['Gritó "hola."', 'Y salió corriendo.']), 'el cierre " viaja con su oración');
  const t3 = 'Lo dijo (con calma.) Después calló.';
  comprobar(igual(textos(t3), ['Lo dijo (con calma.)', 'Después calló.']), 'el cierre ) viaja con su oración');
  const todos = [...textos(t), ...textos(t2), ...textos(t3)];
  comprobar(todos.every((u) => !/^[»)"”\]]/.test(u)), 'ninguna unidad empieza con un signo de cierre');
}
comprobar(igual(textos('¿Quién? dijo ella, sin mirar.'), ['¿Quién? dijo ella, sin mirar.']), '«?» seguido de minúscula no corta');
comprobar(igual(textos('Esperó… y luego habló.'), ['Esperó… y luego habló.']), '«…» seguido de minúscula no corta');
comprobar(igual(textos('Esperó... Luego habló.'), ['Esperó...', 'Luego habló.']), '«...» seguido de mayúscula corta');

/* ── Diálogo con raya ── */
comprobar(
  igual(textos('—¿Vienes? —preguntó Ana.\n—Sí —respondió él.'), ['—¿Vienes? —preguntó Ana.', '—Sí —respondió él.']),
  'diálogo con raya: la acotación del narrador no se separa y cada intervención es una unidad',
);
comprobar(
  igual(textos('—Ven —dijo. —No quiero.'), ['—Ven —dijo.', '—No quiero.']),
  'una nueva intervención con raya empieza otra unidad',
);

/* ── Títulos y renglones sueltos ── */
comprobar(igual(textos('CAPITULO I\n\nEl camino era largo.'), ['CAPITULO I', 'El camino era largo.']), 'un título (párrafo aparte) sin punto es su unidad');
comprobar(
  igual(textos('Título sin punto\nEl texto sigue aquí con suficientes palabras para ser un renglón.'), ['Título sin punto', 'El texto sigue aquí con suficientes palabras para ser un renglón.']),
  'un renglón corto sin punto seguido de mayúscula es unidad propia',
);
comprobar(
  igual(textos('La frase continúa en el renglón\nsiguiente sin cortarse nunca.'), ['La frase continúa en el renglón\nsiguiente sin cortarse nunca.']),
  'un salto suave dentro de una oración no la parte',
);

/* ── Oraciones larguísimas: cláusulas ── */
{
  const trozo = (n) => `fragmento ${n} con bastantes palabras para ocupar espacio útil`;
  const largo = `${trozo(1)}, ${trozo(2)}, ${trozo(3)}; ${trozo(4)}, ${trozo(5)}, ${trozo(6)}: ${trozo(7)}, ${trozo(8)}, ${trozo(9)}, ${trozo(10)}.`;
  comprobar(largo.length > 500, `la oración de prueba es larga (${largo.length})`);
  const us = partirEnUnidades(largo);
  comprobar(us.length >= 3, `se parte en cláusulas (${us.length})`);
  comprobar(us.every(([a, b]) => b - a >= 60), 'ninguna cláusula mide menos de 60');
  comprobar(us.every(([a, b]) => b - a <= 300), 'ninguna cláusula pasa de 300');
  const sinEspacios = (s) => s.replace(/\s+/g, '');
  comprobar(sinEspacios(us.map(([a, b]) => largo.slice(a, b)).join('')) === sinEspacios(largo), 'las cláusulas cubren todo el texto, sin perder ni repetir');
  comprobar(us.every(([a, b]) => (a === 0 || /\s/.test(largo[a - 1])) && (b === largo.length || /\s/.test(largo[b]))), 'ningún corte cae dentro de una palabra');
  comprobar(us.some(([, b]) => largo[b - 1] === ';') || us.some(([, b]) => largo[b - 1] === ':'), 'prefiere cortar en ; o : antes que en comas');
}
{
  /* Con ; disponible, ese es el corte aunque haya comas más cerca del centro. */
  const a = 'primero una parte inicial bastante extensa que habla de cosas distintas, y sigue con otra idea más, y otra más todavía';
  const b = 'después viene la segunda parte de la oración con más contenido, algunas comas internas, y un cierre un poco más largo que el resto';
  const t = `${a}; ${b}; y por último una tercera parte final que termina la oración con bastante texto.`;
  const us = textos(t);
  comprobar(us.length >= 2 && us[0].endsWith(';'), 'la primera cláusula termina en «;»', JSON.stringify(us.map((u) => u.slice(-12))));
}
{
  const t = 'Una oración larga ' + 'con muchas palabras seguidas sin ninguna puntuación interna que permita cortar con criterio '.repeat(8) + 'y termina aquí.';
  const us = partirEnUnidades(t);
  comprobar(us.length >= 3, `oración sin puntuación interna se parte en espacios (${us.length})`);
  comprobar(us.every(([a, b]) => b - a <= 300), 'tope duro: ninguna pasa de 300');
  comprobar(us.every(([a, b]) => (a === 0 || /\s/.test(t[a - 1])) && (b === t.length || /\s/.test(t[b]))), 'sin puntuación: igualmente nunca a mitad de palabra');
}
{
  const t = 'palabra '.repeat(250); /* 2 000 caracteres sin puntuación */
  const t0 = Date.now();
  const us = partirEnUnidades(t.trim());
  comprobar(Date.now() - t0 < 200, `2 000 caracteres sin puntuación no se cuelgan (${Date.now() - t0} ms)`);
  comprobar(us.length >= 7 && us.every(([a, b]) => b - a <= 300), `ninguna unidad gigante (${us.length} unidades, máx ${Math.max(...us.map(([a, b]) => b - a))})`);
}
{
  const t = 'x'.repeat(2000);
  const us = partirEnUnidades(t);
  comprobar(us.length >= 7 && us.every(([a, b]) => b > a && b - a <= 300), 'texto sin espacios: termina y respeta el tope');
  comprobar(us[0][0] === 0 && us[us.length - 1][1] === 2000, 'texto sin espacios: cubre de 0 a 2000');
}

/* ── Invariantes sobre prosa generada ── */
{
  const piezas = [
    'El Sr. Ramírez viajó a EE. UU. en 2019, aunque nadie lo creyó.', 'Midió 3.5 metros; luego, sin prisa, volvió a medir.',
    '—¿Quién anda ahí? —preguntó la Dra. Pérez.', 'CAPITULO II', 'Compró pan, leche, etc. y regresó a casa.',
    '«Nada de esto es casual», dijo con calma. Todos callaron.', 'Era tarde. Nadie respondió.', '¡Qué día! Fue la última vez.',
    'Una frase muy larga '.padEnd(380, 'con relleno de palabras y más palabras, ') + 'y fin.',
  ];
  let texto = '';
  for (let i = 0; i < 400; i += 1) texto += piezas[(i * 7) % piezas.length] + (i % 5 === 4 ? '\n\n' : ' ');
  const t0 = Date.now();
  const us = partirEnUnidades(texto);
  const ms = Date.now() - t0;
  comprobar(ms < 300, `${texto.length} caracteres de prosa en ${ms} ms (< 300)`);
  let ordenadas = true;
  let vacias = 0;
  let largas = 0;
  let sueltos = 0;
  for (let i = 0; i < us.length; i += 1) {
    const [a, b] = us[i];
    if (b <= a) vacias += 1;
    if (i > 0 && a < us[i - 1][1]) ordenadas = false;
    if (b - a > 300) largas += 1;
    if (/^[»)"”\]]/.test(texto.slice(a, b)) || /[«(¿¡]$/.test(texto.slice(a, b))) sueltos += 1;
    if (/\s/.test(texto[a]) || /\s/.test(texto[b - 1])) vacias += 1;
  }
  comprobar(ordenadas && vacias === 0, `${us.length} unidades ordenadas, sin solapes ni vacías ni con espacios en el borde`);
  comprobar(largas === 0, 'ninguna pasa de 300 caracteres');
  comprobar(sueltos === 0, 'ninguna empieza con un cierre ni acaba con una apertura');
  const sinEsp = (s) => s.replace(/\s+/g, '');
  comprobar(sinEsp(us.map(([a, b]) => texto.slice(a, b)).join('')) === sinEsp(texto), 'la unión de todas las unidades es el texto completo');
}

/* ── unidadEn ── */
{
  const t = 'Primera frase. Segunda frase larga. Tercera.';
  const us = partirEnUnidades(t);
  comprobar(igual(unidadEn(us, 0), us[0]) && igual(unidadEn(us, 5), us[0]), 'unidadEn: dentro de la primera');
  comprobar(igual(unidadEn(us, t.indexOf('Segunda') + 3), us[1]), 'unidadEn: dentro de la segunda');
  comprobar(igual(unidadEn(us, t.indexOf('Segunda') - 1), us[0]), 'unidadEn: el espacio entre dos oraciones pertenece a la que acaba de sonar');
  comprobar(igual(unidadEn(us, 999), us[us.length - 1]), 'unidadEn: después del final → la última');
  comprobar(igual(unidadEn(us, -5), us[0]), 'unidadEn: antes del inicio → la primera');
  comprobar(unidadEn([], 3) === null, 'unidadEn: sin unidades → null');
}

console.log(fallos === 0 ? `\n✔ unidades de lectura · ${ok} comprobaciones, 0 fallos` : `\n❌ ${fallos} fallos de ${ok + fallos} comprobaciones`);
process.exit(fallos === 0 ? 0 : 1);
