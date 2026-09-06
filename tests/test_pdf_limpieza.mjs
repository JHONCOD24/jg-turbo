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
  depurarCapitulos,
  ajustarAPalabra,
  ajustarAParrafo,
  prepararCapitulosLectura,
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

{
  /* Regresión real reportada en «El placebo eres tú». La primera línea de
   * una página puede venir desplazada horizontalmente y eso no significa que
   * empiece un párrafo: la página anterior puede haber terminado a mitad de
   * frase o incluso a mitad de palabra. */
  const paginas = [
    pagina(1, [
      linea('Un frío y despejado día viajaron durante dos horas al norte de Bos', { y: 100, ancho: 410 }),
    ]),
    pagina(2, [
      linea('ton, hasta llegar a un monasterio de peterborough, en new Hampshire. El A', { x: 92, y: 800, ancho: 430 }),
      linea('RN fabrica una nueva proteína de los componentes.Como ya has ido aprendiendo,', { y: 786, ancho: 430 }),
      linea('el significado que le', { y: 772, ancho: 180 }),
    ]),
    pagina(3, [
      linea('damos a esas experiencias produce un alu', { x: 92, y: 800, ancho: 260 }),
    ]),
    pagina(4, [
      linea('vión de respuestas físicas. Y es', { x: 92, y: 800, ancho: 230 }),
    ]),
    pagina(5, [
      linea('ta conclusión resume el argumento.', { x: 92, y: 800, ancho: 210 }),
    ]),
  ];
  const resultado = componerTexto(paginas);
  comprobar(
    resultado.texto.includes('norte de Boston, hasta llegar')
      && !/Bos\s+ton/i.test(resultado.texto),
    'el texto canónico contiene Boston, no bos ton'
  );
  comprobar(
    resultado.texto.includes('El ARN fabrica') && !resultado.texto.includes('A RN'),
    'el texto canónico contiene ARN, no A RN'
  );
  comprobar(
    resultado.texto.includes('un aluvión de respuestas') && !resultado.texto.includes('alu vión'),
    'el texto canónico contiene aluvión, no alu vión'
  );
  comprobar(
    resultado.texto.includes('esta conclusión') && !resultado.texto.includes('es ta conclusión'),
    'el texto canónico contiene esta conclusión, no es ta'
  );
  comprobar(
    resultado.texto.includes('significado que le damos a esas experiencias'),
    'conserva el espacio entre «le» y «damos»: son dos palabras'
  );
  comprobar(
    resultado.texto.includes('componentes.Como ya has ido aprendiendo'),
    'conserva la puntuación exacta y no inserta un espacio editorial'
  );
  comprobar(
    resultado.pendientes === 0 && resultado.listoParaLectura === true,
    'el corpus de aceptación no deja límites pendientes'
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
  comprobar(texto.includes('Texto  con   espacios raros'), 'conserva la cantidad de espacios del fragmento fuente');
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

/* ── El índice del PDF y las unidades de lectura ────────────────────────
 *
 * Caso real, «El placebo eres tú»: el índice del libro tenía tres entradas
 * apuntando a la página 5, una a una página que no existe, y varias a páginas
 * de cortesía casi vacías. El resultado eran «tres páginas 5» en el índice,
 * capítulos que solo contenían «Joe Dispenza», el índice y el prólogo cortados
 * a mitad, y un capítulo del final colocado al principio del libro.
 */
function paginaDe(numero, lineas) {
  return {
    numero,
    alto: 800,
    ancho: 600,
    lineas: lineas.map((texto, i) => ({
      texto, x: 60, y: 700 - i * 20, altura: 11, ancho: Math.min(480, texto.length * 6),
    })),
  };
}

const LIBRO_CON_INDICE = {
  paginas: [
    paginaDe(1, ['EL PLACEBO ERES TÚ']),
    paginaDe(2, ['Joe Dispenza']),
    paginaDe(3, ['Título original: You Are the Placebo']),
    paginaDe(4, ['Todos los derechos reservados.']),
    paginaDe(5, ['Joe Dispenza']),
    paginaDe(6, ['ÍNDICE', 'Prólogo .... 11', 'Capítulo 1 .... 25']),
    paginaDe(7, ['PRÓLOGO', 'Este libro nace de una pregunta que me persigue desde hace muchos años y que nunca supe responder del todo.']),
    ...Array.from({ length: 10 }, (_, k) => paginaDe(8 + k,
      [`Contenido corrido y extenso de la página ${8 + k} del libro. `.repeat(18)])),
  ],
  indice: [
    { titulo: 'Portada', pagina: 1 },
    { titulo: 'Joe Dispenza', pagina: 5 },
    { titulo: 'Créditos', pagina: 5 },
    { titulo: 'Dedicatoria', pagina: 5 },
    { titulo: 'Índice', pagina: 6 },
    { titulo: 'Prólogo', pagina: 7 },
    { titulo: 'Capítulo 1', pagina: 10 },
    { titulo: 'Capítulo 2', pagina: 999 },   /* página que no existe */
  ],
};

{
  const r = componerTexto(LIBRO_CON_INDICE.paginas, { indice: LIBRO_CON_INDICE.indice });

  /* 1) Las posiciones de página tienen que salir de componerTexto: sin ellas
   *    no se puede cortar por páginas reales. */
  comprobar(Array.isArray(r.paginas) && r.paginas.length > 0,
    'componerTexto devuelve dónde empieza cada página en el texto final');
  if (Array.isArray(r.paginas) && r.paginas.length) {
    const ordenadas = r.paginas.every((p, i) => i === 0 || p.posicion >= r.paginas[i - 1].posicion);
    comprobar(ordenadas, 'las páginas salen en orden y sin posiciones hacia atrás');
    comprobar(r.paginas.every((p) => p.posicion >= 0 && p.posicion <= r.texto.length),
      'ninguna posición de página se sale del texto');
    comprobar(r.paginas.every((p) => Number.isFinite(p.numero)),
      'cada página lleva su número real');
  }

  /* 2) Ningún capítulo puede quedar vacío ni ser una miga. */
  const largos = r.capitulos.map((c, i) => {
    const sig = r.capitulos[i + 1];
    return (sig ? sig.posicion : r.texto.length) - c.posicion;
  });
  comprobar(largos.every((n) => n > 0),
    `ningún capítulo queda vacío (mínimo obtenido: ${Math.min(...largos)})`);
  /* El primero puede ser corto: son las páginas de cortesía, y el libro tiene
   * que empezar en algún sitio. Los del cuerpo, no. */
  comprobar(largos.slice(1).every((n) => n >= 200),
    `en el cuerpo del libro no quedan migas (mínimo obtenido: ${Math.min(...largos.slice(1))})`);
  comprobar(largos.filter((n) => n < 200).length <= 1,
    'como mucho un capítulo corto, y es el de los preliminares');

  /* 3) «Tres páginas 5» era el síntoma más visible. */
  const porPagina = new Map();
  for (const c of r.capitulos) porPagina.set(c.pagina, (porPagina.get(c.pagina) || 0) + 1);
  const repetidas = [...porPagina.entries()].filter(([, n]) => n > 1);
  comprobar(repetidas.length === 0,
    `no hay dos capítulos con el mismo número de página${repetidas.length ? ' → ' + repetidas.map(([p, n]) => `pág ${p}×${n}`).join(', ') : ''}`);

  /* 4) Un capítulo cuya página no existe no puede aterrizar al principio. */
  const fantasma = r.capitulos.find((c) => c.titulo === 'Capítulo 2');
  comprobar(!fantasma || fantasma.posicion > 0,
    'un capítulo cuya página no existe no se coloca al principio del libro');

  /* 5) Y el orden tiene que ser el del libro. */
  const enOrden = r.capitulos.every((c, i) => i === 0 || c.posicion >= r.capitulos[i - 1].posicion);
  comprobar(enOrden, 'los capítulos salen en el orden en que aparecen en el libro');
  comprobar(r.capitulos.every((c) => c.titulo && c.titulo.trim()), 'todos los capítulos tienen título');
}

{
  /* Un libro sin índice interno sigue funcionando como antes. */
  const r = componerTexto(LIBRO_CON_INDICE.paginas, {});
  comprobar(typeof r.texto === 'string' && r.texto.length > 0, 'sin índice el texto se compone igual');
  comprobar(Array.isArray(r.paginas), 'sin índice también se informan las páginas');
}
{
  /* Casos límite: nada de esto puede romper. */
  const vacio = componerTexto([], { indice: [{ titulo: 'X', pagina: 1 }] });
  comprobar(Array.isArray(vacio.capitulos) && Array.isArray(vacio.paginas),
    'un documento sin páginas no rompe');
  const soloIndiceMalo = componerTexto(LIBRO_CON_INDICE.paginas, {
    indice: [{ titulo: 'A', pagina: 998 }, { titulo: 'B', pagina: 999 }],
  });
  comprobar(Array.isArray(soloIndiceMalo.capitulos),
    'un índice entero apuntando a páginas inexistentes no rompe');
}

/* ── Depurar capítulos de un libro YA guardado ──────────────────────────
 *
 * Los libros que ya estaban en la biblioteca guardan sus capítulos tal como
 * salieron la primera vez, con los defectos de entonces: varios en la misma
 * posición, alguno en la 0 por apuntar a una página inexistente, y migas que
 * solo contienen el nombre del autor o el nombre de la editorial.
 *
 * `depurarCapitulos` es la misma regla que usa `componerTexto`, sacada aparte
 * para poder aplicarla también al reabrir un libro viejo sin volver a leer
 * el PDF.
 */
{
  const LARGO = 20000;
  const sucios = [
    { titulo: 'Portada', pagina: 1, posicion: 0 },
    { titulo: 'Descubre el poder de tu mente', pagina: 5, posicion: 40 },
    { titulo: 'Urano', pagina: 5, posicion: 40 },
    { titulo: 'Créditos', pagina: 5, posicion: 55 },
    { titulo: 'Índice', pagina: 6, posicion: 120 },
    { titulo: 'Prólogo', pagina: 11, posicion: 900 },
    { titulo: 'Capítulo 1', pagina: 25, posicion: 4000 },
    { titulo: 'Apéndice', pagina: 300, posicion: 0 },   /* el que «vuela» al principio */
  ];
  const limpios = depurarCapitulos(sucios, LARGO);

  comprobar(limpios.length < sucios.length, `se retiran las migas (${sucios.length} → ${limpios.length})`);
  const porPagina = new Map();
  for (const c of limpios) porPagina.set(c.pagina, (porPagina.get(c.pagina) || 0) + 1);
  comprobar([...porPagina.values()].every((n) => n === 1),
    'no quedan dos capítulos con el mismo número de página');
  comprobar(limpios.every((c, i) => i === 0 || c.posicion > limpios[i - 1].posicion),
    'las posiciones quedan en orden y sin repetirse');
  comprobar(limpios.some((c) => c.titulo === 'Prólogo'), 'el prólogo sobrevive: tiene contenido detrás');
  comprobar(limpios.some((c) => c.titulo === 'Capítulo 1'), 'y el capítulo 1 también');
  comprobar(!limpios.some((c) => c.titulo === 'Urano'), 'el nombre de la editorial no es un capítulo');

  /* Casos límite. */
  comprobar(Array.isArray(depurarCapitulos(null, 100)), 'lista nula no rompe');
  comprobar(depurarCapitulos([], 100).length === 0, 'lista vacía devuelve vacía');
  const uno = depurarCapitulos([{ titulo: 'Único', pagina: 1, posicion: 0 }], 5000);
  comprobar(uno.length === 1, 'un solo capítulo se conserva siempre');
}

/* ── Ninguna posición puede caer a mitad de palabra ─────────────────────
 *
 * Reportado en «El placebo eres tú»: el apéndice terminaba en «es» y el
 * prólogo empezaba en «ta conclusión». La palabra «esta» quedaba partida
 * entre dos unidades de lectura, y la voz la leía en dos trozos.
 */
{
  const texto = 'Primera parte del libro. Y esta conclusión cierra el argumento del autor.';
  const mitadDePalabra = texto.indexOf('ta conclusión');   /* dentro de «esta» */

  comprobar(ajustarAPalabra(texto, mitadDePalabra) !== mitadDePalabra,
    'una posición a mitad de palabra se mueve');
  const ajustada = ajustarAPalabra(texto, mitadDePalabra);
  comprobar(/^\s|^[A-ZÁÉÍÓÚÑ]|^esta/i.test(texto.slice(ajustada, ajustada + 6).trim()) || texto[ajustada - 1] === ' ' || ajustada === 0,
    `la posición ajustada cae en un límite de palabra (quedó: «${texto.slice(ajustada, ajustada + 14)}»)`);
  comprobar(!/^[a-záéíóúüñ]/.test(texto.slice(ajustada).trim().slice(0, 1)) || texto.slice(ajustada).trim().startsWith('esta'),
    'no empieza a mitad de una palabra');

  /* Una posición que ya está bien no se mueve. */
  const buena = texto.indexOf('Y esta');
  comprobar(ajustarAPalabra(texto, buena) === buena, 'una posición ya correcta se respeta');
  comprobar(ajustarAPalabra(texto, 0) === 0, 'el principio del texto se respeta');
  comprobar(ajustarAPalabra(texto, texto.length) === texto.length, 'el final del texto se respeta');
  comprobar(ajustarAPalabra('', 5) === 0, 'texto vacío no rompe');
}

/* ── Los cambios de unidad respetan párrafos completos ─────────────── */
{
  const texto = [
    'Portada y datos editoriales.',
    'Y esta conclusión empieza en la página física anterior y termina completa en la siguiente.',
    'PRÓLOGO\nContenido completo del prólogo que debe comenzar después del título.',
  ].join('\n\n');
  const dentroDeEsta = texto.indexOf('ta conclusión');
  const inicioParrafo = texto.indexOf('Y esta conclusión');
  comprobar(ajustarAParrafo(texto, dentroDeEsta) === inicioParrafo,
    'un corte dentro de «esta conclusión» vuelve al inicio del párrafo completo');

  const capitulos = prepararCapitulosLectura(texto, [
    { titulo: 'Portada', pagina: 5, posicion: 0 },
    { titulo: 'Descubre el poder de tu mente', pagina: 5, posicion: 4 },
    { titulo: 'Urano', pagina: 5, posicion: 10 },
    { titulo: 'Prólogo', pagina: 11, posicion: dentroDeEsta },
  ]);
  comprobar(capitulos.filter((c) => c.pagina === 5).length === 1,
    'las tres entradas diminutas de la página 5 se condensan en una');
  comprobar(capitulos.every((c) => c.posicion === 0 || texto.slice(c.posicion - 2, c.posicion) === '\n\n'),
    'todos los capítulos empiezan entre párrafos, nunca dentro de uno');
}

console.log(fallos === 0 ? '\nTodas las pruebas pasaron.' : `\n${fallos} prueba(s) fallaron.`);
process.exit(fallos === 0 ? 0 : 1);
