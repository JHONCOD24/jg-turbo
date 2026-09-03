/* Pruebas de la limpieza de texto de PDF (libros).
 * Ejecutar: node tests/test_pdf_limpieza.mjs
 *
 * Estas funciones son puras: reciben líneas ya extraídas por pdf.js y
 * devuelven el texto listo para leer, traducir o escuchar. Por eso se
 * prueban sin abrir ningún PDF real.
 */
import {
  agruparLineas,
  componerTexto,
  esNumeroDePagina,
  normalizarClave,
  pareceTitulo,
  clasificarBloque,
} from '../js/pdf/limpiezaTexto.js';

let fallos = 0;
function comprobar(condicion, mensaje) {
  if (condicion) {
    console.log(`OK: ${mensaje}`);
  } else {
    fallos += 1;
    console.error(`FALLO: ${mensaje}`);
  }
}

/* Ayuda: crea una línea con valores por defecto razonables. */
function linea(texto, { x = 70, y = 700, altura = 11, ancho = null } = {}) {
  return { texto, x, y, altura, ancho: ancho == null ? texto.length * 5 : ancho };
}
function pagina(numero, lineas) {
  return { numero, lineas, ancho: 595, alto: 842 };
}

/* ── 1) Agrupar fragmentos sueltos en líneas por su posición ───────── */
{
  const items = [
    { str: 'Hola', x: 70, y: 700, altura: 11, ancho: 22 },
    { str: 'mundo', x: 95, y: 700.4, altura: 11, ancho: 28 },
    { str: 'Segunda', x: 70, y: 686, altura: 11, ancho: 35 },
  ];
  const lineas = agruparLineas(items);
  comprobar(lineas.length === 2, 'los fragmentos con la misma altura forman una sola línea');
  comprobar(lineas[0].texto === 'Hola mundo', 'los fragmentos separados se unen con un espacio');
  comprobar(lineas[1].texto === 'Segunda', 'la línea siguiente queda aparte');
}

{
  const items = [
    { str: 'in', x: 70, y: 700, altura: 11, ancho: 8 },
    { str: 'terrumpido', x: 78.2, y: 700, altura: 11, ancho: 45 },
  ];
  const [l] = agruparLineas(items);
  comprobar(l.texto === 'interrumpido', 'los fragmentos pegados no inventan un espacio de más');
}

/* ── 2) Palabras cortadas con guion al final del renglón ───────────── */
{
  const paginas = [pagina(1, [
    linea('El lector queda compren-', { y: 700 }),
    linea('dido por completo en la obra que', { y: 686 }),
    linea('tiene entre las manos.', { y: 672 }),
  ])];
  const { texto } = componerTexto(paginas);
  comprobar(texto.includes('comprendido'), 'une la palabra cortada con guion al final del renglón');
  comprobar(!texto.includes('compren-'), 'no deja el guion suelto de la palabra cortada');
}

{
  const paginas = [pagina(1, [
    linea('El acuerdo franco-', { y: 700 }),
    linea('Alemán se firmó en mayo.', { y: 686 }),
  ])];
  const { texto } = componerTexto(paginas);
  comprobar(
    texto.includes('franco-Alemán'),
    'conserva el guion cuando la palabra siguiente empieza en mayúscula (compuesta real)'
  );
}

/* ── 3) Encabezados y pies repetidos en muchas páginas ─────────────── */
{
  const paginas = [1, 2, 3, 4, 5].map((n) =>
    pagina(n, [
      linea('HISTORIA DE ROMA', { y: 800 }),
      linea(`Contenido distinto de la página ${n} que sigue el hilo del libro.`, { y: 600 }),
      linea(String(n), { y: 40 }),
    ])
  );
  const { texto, descartadas } = componerTexto(paginas);
  comprobar(!texto.includes('HISTORIA DE ROMA'), 'elimina el encabezado repetido en todas las páginas');
  comprobar(texto.includes('Contenido distinto de la página 3'), 'conserva el contenido real de cada página');
  comprobar(descartadas >= 5, 'informa cuántas líneas de relleno se descartaron');
}

{
  // Un encabezado que aparece en solo una de diez páginas es contenido, no relleno.
  const paginas = Array.from({ length: 10 }, (_, i) =>
    pagina(i + 1, [
      linea(i === 0 ? 'Una frase que solo sale una vez.' : `Texto normal de la página ${i + 1}.`, { y: 800 }),
    ])
  );
  const { texto } = componerTexto(paginas);
  comprobar(
    texto.includes('Una frase que solo sale una vez.'),
    'no borra una línea que aparece pocas veces'
  );
}

/* ── 4) Números de página sueltos ──────────────────────────────────── */
{
  comprobar(esNumeroDePagina('12'), 'reconoce un número de página suelto');
  comprobar(esNumeroDePagina('— 128 —'), 'reconoce el número de página entre rayas');
  comprobar(esNumeroDePagina('· 7 ·'), 'reconoce el número de página entre puntos');
  comprobar(esNumeroDePagina('xiv'), 'reconoce la numeración romana en minúscula');
  comprobar(!esNumeroDePagina('12 personas llegaron tarde'), 'no confunde una frase que empieza con número');
  comprobar(!esNumeroDePagina('1984'), 'no borra un año suelto usado como título');
}

/* ── 5) Reconstrucción de párrafos ─────────────────────────────────── */
{
  const paginas = [pagina(1, [
    linea('Aquella mañana el camino estaba cubierto por una niebla', { y: 700, ancho: 400 }),
    linea('espesa que apenas dejaba ver los árboles del sendero.', { y: 686, ancho: 380 }),
    linea('Nadie se atrevía a salir.', { y: 672, ancho: 160 }),
    linea('    Al día siguiente el sol volvió con fuerza y el pueblo', { x: 90, y: 650, ancho: 400 }),
    linea('entero salió a la plaza.', { y: 636, ancho: 170 }),
  ])];
  const { texto } = componerTexto(paginas);
  comprobar(
    texto.includes('una niebla espesa que apenas'),
    'une los renglones del mismo párrafo con un espacio, no con un salto'
  );
  comprobar(
    /Nadie se atrevía a salir\.\n\n\s*Al día siguiente/.test(texto),
    'abre párrafo nuevo cuando la línea anterior es corta y la nueva viene con sangría'
  );
}

{
  // Sin sangría: el salto vertical grande también marca párrafo nuevo.
  const paginas = [pagina(1, [
    linea('Primera idea que termina aquí mismo.', { y: 700, ancho: 200 }),
    linea('Segunda idea, ya separada por un blanco.', { y: 660, ancho: 220 }),
  ])];
  const { texto } = componerTexto(paginas);
  comprobar(
    /aquí mismo\.\n\nSegunda idea/.test(texto),
    'abre párrafo nuevo cuando hay un espacio vertical grande entre renglones'
  );
}

{
  // El párrafo continúa aunque cambie de página.
  const paginas = [
    pagina(1, [linea('La frase empieza en una página y', { y: 100, ancho: 400 })]),
    pagina(2, [linea('termina en la siguiente sin cortarse.', { y: 800, ancho: 380 })]),
  ];
  const { texto } = componerTexto(paginas);
  comprobar(
    texto.includes('y termina en la siguiente'),
    'no parte el párrafo cuando el texto salta de página'
  );
}

/* ── 6) Capítulos ──────────────────────────────────────────────────── */
{
  const paginas = [
    pagina(1, [
      linea('CAPÍTULO I', { y: 700, altura: 18, ancho: 120 }),
      linea('El principio de todo relato es siempre incierto.', { y: 660, ancho: 380 }),
    ]),
    pagina(2, [
      linea('CAPÍTULO II', { y: 700, altura: 18, ancho: 130 }),
      linea('La segunda parte comienza con una promesa.', { y: 660, ancho: 380 }),
    ]),
  ];
  const { texto, capitulos } = componerTexto(paginas);
  comprobar(capitulos.length === 2, 'detecta los dos capítulos del libro');
  comprobar(capitulos[0].titulo === 'CAPÍTULO I', 'guarda el título del capítulo tal cual');
  comprobar(capitulos[1].pagina === 2, 'guarda en qué página empieza cada capítulo');
  comprobar(
    capitulos[1].posicion > capitulos[0].posicion && capitulos[1].posicion < texto.length,
    'la posición del capítulo apunta dentro del texto final'
  );
}

{
  // Un índice del propio PDF manda sobre la detección automática.
  const paginas = [
    pagina(1, [linea('Texto de apertura del libro.', { y: 700 })]),
    pagina(2, [linea('Sigue el segundo bloque del libro.', { y: 700 })]),
  ];
  const indice = [{ titulo: 'Prólogo', pagina: 1 }, { titulo: 'Primera parte', pagina: 2 }];
  const { capitulos } = componerTexto(paginas, { indice });
  comprobar(capitulos.length === 2, 'usa el índice interno del PDF cuando existe');
  comprobar(capitulos[1].titulo === 'Primera parte', 'respeta los títulos del índice interno');
}

/* ── 7) Rango de páginas ───────────────────────────────────────────── */
{
  const paginas = [1, 2, 3, 4].map((n) => pagina(n, [linea(`Página ${n} del libro.`, { y: 700 })]));
  const { texto } = componerTexto(paginas.filter((p) => p.numero >= 2 && p.numero <= 3));
  comprobar(texto.includes('Página 2') && texto.includes('Página 3'), 'respeta el rango pedido');
  comprobar(!texto.includes('Página 4'), 'deja fuera las páginas ajenas al rango');
}

/* ── 8) Casos límite: nada que leer ────────────────────────────────── */
{
  const { texto, capitulos } = componerTexto([]);
  comprobar(texto === '', 'un PDF sin páginas devuelve texto vacío sin reventar');
  comprobar(Array.isArray(capitulos) && capitulos.length === 0, 'sin páginas no hay capítulos');
}
{
  const { texto } = componerTexto([pagina(1, []), pagina(2, [])]);
  comprobar(texto === '', 'un PDF escaneado (páginas sin texto) devuelve vacío, no basura');
}
{
  const { texto } = componerTexto([pagina(1, [linea('   ', { y: 700 }), linea('Hola.', { y: 686 })])]);
  comprobar(texto === 'Hola.', 'descarta las líneas en blanco');
}

/* ── 9) Espacios y basura tipográfica ──────────────────────────────── */
{
  const paginas = [pagina(1, [
    linea('Texto  con   espacios raros y “comillas” tipográficas.', { y: 700 }),
    linea('La oﬁcina se inﬂama de gente.', { y: 686 }),
  ])];
  const { texto } = componerTexto(paginas);
  comprobar(
    texto.includes('oficina') && texto.includes('inflama'),
    'deshace las ligaduras tipográficas (ﬁ, ﬂ) que traen los libros'
  );
  comprobar(!/ {2}/.test(texto), 'colapsa los espacios repetidos');
  comprobar(!texto.includes(' '), 'convierte el espacio duro en espacio normal');
  comprobar(texto.includes('“comillas”'), 'no destruye las comillas tipográficas del original');
}

{
  comprobar(normalizarClave('Página 12 · HISTORIA') === 'pagina · historia', 'la clave ignora números y mayúsculas');
}

/* ── Detección de títulos: un criterio único ───────────────────────── */
{
  const modal = 10;   /* altura de línea típica del cuerpo */
  const linea = (texto, extra = {}) => ({ texto, altura: modal, x: 50, ancho: 200, y: 700, ...extra });

  /* Los que ya funcionaban deben seguir funcionando. */
  comprobar(pareceTitulo(linea('CAPÍTULO PRIMERO'), modal), 'reconoce "CAPÍTULO PRIMERO"');
  comprobar(pareceTitulo(linea('Prólogo'), modal), 'reconoce "Prólogo"');
  comprobar(pareceTitulo(linea('Texto grande', { altura: modal * 1.4 }), modal), 'reconoce por tamaño mayor');

  /* Los que se escapaban. */
  comprobar(pareceTitulo(linea('LA CASA DE LOS ESPÍRITUS'), modal),
    'reconoce un titulo en mayusculas del mismo tamaño');
  comprobar(pareceTitulo(linea('II'), modal), 'reconoce un numero romano solo');
  comprobar(pareceTitulo(linea('3. El regreso'), modal), 'reconoce "3. El regreso"');

  /* Y lo que NO debe confundirse con un título. */
  comprobar(!pareceTitulo(linea('En un lugar de la Mancha vivia un hidalgo de los de lanza en astillero.'), modal),
    'una frase larga no es titulo');
  comprobar(!pareceTitulo(linea('dijo el hombre,'), modal), 'algo que acaba en coma no es titulo');
  comprobar(!pareceTitulo(linea('Y entonces se fue.'), modal), 'algo que acaba en punto no es titulo');
  comprobar(!pareceTitulo(linea('12'), modal), 'un numero de pagina no es titulo');

  /* Los dos criterios del archivo deben coincidir: antes no lo hacían. */
  comprobar(clasificarBloque('CAPÍTULO PRIMERO', { altura: modal }) === 'titulo',
    'clasificarBloque coincide con pareceTitulo en un titulo claro');
  comprobar(clasificarBloque('LA CASA DE LOS ESPÍRITUS', { altura: modal }) === 'titulo',
    'clasificarBloque tambien reconoce mayusculas');
}

console.log(fallos === 0 ? '\nTodas las pruebas pasaron.' : `\n${fallos} prueba(s) fallaron.`);
process.exit(fallos === 0 ? 0 : 1);
