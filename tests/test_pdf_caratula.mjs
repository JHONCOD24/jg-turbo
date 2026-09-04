/* Pruebas de la carátula automática: limpiar el nombre del archivo, elegir la
 * portada real correcta y el color de la portada dibujada.
 * Ejecutar: node tests/test_pdf_caratula.mjs
 */
import {
  limpiarNombreLibro, elegirMejorPortada, colorDeTitulo, iniciales,
} from '../js/pdf/caratula.js';

let fallos = 0;
function comprobar(condicion, mensaje) {
  if (condicion) console.log(`OK: ${mensaje}`);
  else { fallos += 1; console.error(`FALLO: ${mensaje}`); }
}

/* ── Limpiar el nombre del archivo ──────────────────────────────────────
 *
 * El título de la biblioteca sale del nombre del PDF, y los nombres reales
 * vienen con la basura de las descargas: «( PDFDrive )», «(1)», guiones bajos,
 * la extensión. Buscar la portada con eso no encuentra nada.
 */
{
  const caso = limpiarNombreLibro('How to write a good advertisement Victor O. Schwab (1)');
  comprobar(caso.titulo === 'How to write a good advertisement Victor O. Schwab',
    `quita el «(1)» del final (obtuvo: "${caso.titulo}")`);
}
{
  const c = limpiarNombreLibro('Pre-suasión_ Un método revolucionario para influir y persuadir ( PDFDrive )');
  comprobar(!c.titulo.includes('PDFDrive'), 'quita la marca de la web de descargas');
  comprobar(c.titulo.startsWith('Pre-suasión'), `conserva el título (obtuvo: "${c.titulo}")`);
  comprobar(!c.titulo.includes('_'), 'convierte el guion bajo en espacio o lo retira');
}
{
  comprobar(limpiarNombreLibro('el-placebo-eres-tu.pdf').titulo === 'El placebo eres tu',
    'convierte guiones en espacios, quita la extensión y pone mayúscula inicial');
  /* Muchas descargas traen «-pdf» pegado al nombre, sin punto: al convertir
   * los guiones queda un «pdf» suelto que se leería en la portada. */
  comprobar(limpiarNombreLibro('el-aprendiz-de-brujo-pdf').titulo === 'El aprendiz de brujo',
    `quita el «pdf» suelto del final (obtuvo: "${limpiarNombreLibro('el-aprendiz-de-brujo-pdf').titulo}")`);
  comprobar(limpiarNombreLibro('sex-code-pdfdrive-pdf').titulo === 'Sex code',
    'quita a la vez la marca de la web y el «pdf» suelto');
  /* Pero «PDF» dentro del título es contenido, no basura. */
  comprobar(limpiarNombreLibro('Guia del formato PDF para diseñadores').titulo.includes('PDF'),
    'no toca la palabra PDF cuando forma parte del título');
  comprobar(limpiarNombreLibro('LA_INTELIGENCIA_EMOCIONAL.PDF').titulo.toLowerCase() === 'la inteligencia emocional',
    'normaliza un nombre todo en mayúsculas con guiones bajos');
}
{
  /* Autor detectado cuando el nombre lo separa de forma reconocible. */
  const c = limpiarNombreLibro('Sapiens - Yuval Noah Harari');
  comprobar(c.titulo === 'Sapiens', `separa el título antes del guion (obtuvo: "${c.titulo}")`);
  comprobar(c.autor === 'Yuval Noah Harari', `y reconoce el autor (obtuvo: "${c.autor}")`);

  const d = limpiarNombreLibro('El aprendiz de brujo');
  comprobar(d.autor === '', 'sin separador no inventa un autor');
}
{
  /* Casos límite: nada de esto puede romper ni devolver basura. */
  comprobar(limpiarNombreLibro('').titulo === '', 'nombre vacío no rompe');
  comprobar(limpiarNombreLibro(null).titulo === '', 'null no rompe');
  comprobar(limpiarNombreLibro('   ').titulo === '', 'solo espacios queda vacío');
  comprobar(limpiarNombreLibro('(1)').titulo === '', 'un nombre que era solo basura queda vacío');
  comprobar(limpiarNombreLibro('a'.repeat(500)).titulo.length <= 200, 'un nombre larguísimo se acota');
  comprobar(typeof limpiarNombreLibro('###').titulo === 'string', 'solo signos no rompe');
}

/* ── Elegir la portada real correcta ────────────────────────────────────
 *
 * La búsqueda devuelve varios libros. Poner la portada equivocada es peor que
 * no poner ninguna: el usuario vería un libro que no es el suyo.
 */
{
  const resultados = [
    { titulo: 'Cocinar sin gluten', autor: 'Otra persona', portada: 'u1' },
    { titulo: 'How to Write a Good Advertisement', autor: 'Victor O. Schwab', portada: 'u2' },
    { titulo: 'Advertisement design', autor: 'Alguien', portada: 'u3' },
  ];
  const elegido = elegirMejorPortada(resultados, { titulo: 'How to write a good advertisement Victor O. Schwab' });
  comprobar(elegido && elegido.portada === 'u2', 'elige el libro que de verdad coincide');
}
{
  /* Si nada se parece lo suficiente, mejor ninguna que una equivocada. */
  const resultados = [{ titulo: 'Cocinar sin gluten', autor: 'X', portada: 'u1' }];
  comprobar(elegirMejorPortada(resultados, { titulo: 'El placebo eres tú' }) === null,
    'si ningún resultado se parece, no devuelve nada');
}
{
  /* Un resultado sin imagen no sirve aunque el título encaje. */
  const resultados = [{ titulo: 'El placebo eres tú', autor: 'Joe Dispenza', portada: '' }];
  comprobar(elegirMejorPortada(resultados, { titulo: 'El placebo eres tú' }) === null,
    'descarta un resultado sin portada');
}
{
  /* El acento y las mayúsculas no pueden impedir el reconocimiento. */
  const resultados = [{ titulo: 'LA INTELIGENCIA EMOCIONAL', autor: 'Daniel Goleman', portada: 'u9' }];
  const e = elegirMejorPortada(resultados, { titulo: 'La Inteligencia Emocional' });
  comprobar(e && e.portada === 'u9', 'reconoce el mismo título con otras mayúsculas y tildes');
}
{
  /* Coincidir también con el autor debe pesar más que el título solo. */
  const resultados = [
    { titulo: 'Sapiens', autor: 'Otro Autor', portada: 'malo' },
    { titulo: 'Sapiens', autor: 'Yuval Noah Harari', portada: 'bueno' },
  ];
  const e = elegirMejorPortada(resultados, { titulo: 'Sapiens', autor: 'Yuval Noah Harari' });
  comprobar(e && e.portada === 'bueno', 'con el mismo título, gana el que además acierta el autor');
}
{
  comprobar(elegirMejorPortada([], { titulo: 'X' }) === null, 'lista vacía devuelve null');
  comprobar(elegirMejorPortada(null, { titulo: 'X' }) === null, 'lista nula devuelve null');
  comprobar(elegirMejorPortada([{ titulo: 'X', portada: 'u' }], null) === null, 'sin libro devuelve null');
}

/* ── Color de la portada dibujada ───────────────────────────────────────
 *
 * Cada libro tiene su color, siempre el mismo, para poder reconocerlo de un
 * vistazo en la estantería.
 */
{
  const a = colorDeTitulo('El placebo eres tú');
  const b = colorDeTitulo('El placebo eres tú');
  comprobar(a.tono === b.tono, 'el mismo título da siempre el mismo color');
  comprobar(colorDeTitulo('Sapiens').tono !== colorDeTitulo('Pre-suasión').tono,
    'títulos distintos dan colores distintos');
  comprobar(a.tono >= 0 && a.tono < 360, `el tono es un ángulo válido (${a.tono})`);
  comprobar(typeof a.fondo === 'string' && a.fondo.includes('hsl'), 'devuelve un color CSS usable');
  comprobar(colorDeTitulo('').tono >= 0, 'un título vacío no rompe el color');
}

/* ── Iniciales para la portada ────────────────────────────────────────────
 *
 * Se saltan los artículos: de «La Inteligencia Emocional» dicen más «IE» que
 * «LI», que sería la inicial de «La». Es lo mismo que hace cualquiera al
 * abreviar el título de un libro.
 */
{
  comprobar(iniciales('La Inteligencia Emocional') === 'IE',
    'ignora el artículo y toma las palabras con significado');
  comprobar(iniciales('Sapiens') === 'S', 'una sola palabra da una inicial');
  comprobar(iniciales('el placebo eres tú') === 'PE',
    'funciona con el original en minúsculas, saltándose el artículo');
  comprobar(iniciales('') === '?', 'un título vacío da un símbolo neutro');
  comprobar(iniciales('   ') === '?', 'solo espacios da un símbolo neutro');
  comprobar(iniciales('123 456') === '14', 'funciona con números');
}

console.log(fallos ? `\n${fallos} FALLO(S)` : '\nTodo en verde');
process.exit(fallos ? 1 : 0);
