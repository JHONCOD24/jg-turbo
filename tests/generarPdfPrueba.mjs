/* Genera PDFs de prueba sin librerías: uno tipo libro (con encabezado
 * repetido, números de página, capítulos y palabras cortadas con guion),
 * uno «escaneado» (sin capa de texto) y uno dañado.
 *
 * Se generan al vuelo para no meter binarios en el repositorio.
 */
import { writeFileSync } from 'node:fs';

const ANCHO = 595;
const ALTO = 842;

const PARRAFO_1 = [
  'Aquella manana el camino estaba cubierto por una niebla espesa que apenas',
  'dejaba ver los arboles del sendero. Nadie del pueblo se atrevia a salir de',
  'su casa mientras la humedad siguiera pegada a las venta-',
  'nas y el frio se colara por debajo de las puertas.',
];
const PARRAFO_2 = [
  'Al dia siguiente el sol volvio con fuerza. Los ninos salieron a la plaza y',
  'las conversaciones regresaron a las esquinas, como si el invierno hubiera',
  'sido apenas un rumor.',
];
const PARRAFO_3 = [
  'El segundo capitulo comienza con una promesa que nadie penso que se fuera',
  'a cumplir. La historia, sin embargo, guarda siempre una vuelta mas.',
];
const ROMANOS = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X',
  'XI', 'XII', 'XIII', 'XIV', 'XV', 'XVI', 'XVII', 'XVIII', 'XIX', 'XX'];

const escapar = (t) => t.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');

function flujoDeTexto(lineas) {
  let salida = 'BT\n';
  for (const [texto, x, y, tam] of lineas) {
    salida += `/F1 ${tam} Tf\n1 0 0 1 ${x} ${y} Tm\n(${escapar(texto)}) Tj\n`;
  }
  return Buffer.from(salida + 'ET', 'latin1');
}

function armarPdf(flujos, ruta) {
  const n = flujos.length;
  const idsPagina = Array.from({ length: n }, (_, i) => 4 + i * 2);
  const objetos = [
    Buffer.from('<< /Type /Catalog /Pages 2 0 R >>', 'latin1'),
    Buffer.from(`<< /Type /Pages /Kids [${idsPagina.map((i) => `${i} 0 R`).join(' ')}] /Count ${n} >>`, 'latin1'),
    Buffer.from('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>', 'latin1'),
  ];
  flujos.forEach((flujo, i) => {
    objetos.push(Buffer.from(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${ANCHO} ${ALTO}] ` +
      `/Resources << /Font << /F1 3 0 R >> >> /Contents ${idsPagina[i] + 1} 0 R >>`, 'latin1'));
    objetos.push(Buffer.concat([
      Buffer.from(`<< /Length ${flujo.length} >>\nstream\n`, 'latin1'),
      flujo,
      Buffer.from('\nendstream', 'latin1'),
    ]));
  });

  const trozos = [Buffer.from('%PDF-1.4\n%\xe2\xe3\xcf\xd3\n', 'latin1')];
  let posicion = trozos[0].length;
  const posiciones = [];
  objetos.forEach((cuerpo, i) => {
    posiciones.push(posicion);
    const bloque = Buffer.concat([
      Buffer.from(`${i + 1} 0 obj\n`, 'latin1'), cuerpo, Buffer.from('\nendobj\n', 'latin1'),
    ]);
    trozos.push(bloque);
    posicion += bloque.length;
  });

  let xref = `xref\n0 ${objetos.length + 1}\n0000000000 65535 f \n`;
  for (const p of posiciones) xref += `${String(p).padStart(10, '0')} 00000 n \n`;
  xref += `trailer\n<< /Size ${objetos.length + 1} /Root 1 0 R >>\nstartxref\n${posicion}\n%%EOF\n`;
  trozos.push(Buffer.from(xref, 'latin1'));

  const pdf = Buffer.concat(trozos);
  writeFileSync(ruta, pdf);
  return pdf.length;
}

function paginaLibro(numero, tituloCapitulo, parrafos) {
  const lineas = [['HISTORIA DE PRUEBA', 70, 800, 9]];
  let y = 730;
  if (tituloCapitulo) { lineas.push([tituloCapitulo, 70, y, 18]); y -= 45; }
  for (const parrafo of parrafos) {
    let primera = true;
    for (const renglon of parrafo) {
      lineas.push([renglon, primera ? 90 : 70, y, 11]);
      y -= 16;
      primera = false;
    }
    y -= 8;
  }
  lineas.push([String(numero), 295, 40, 9]);
  return lineas;
}

const PARRAFO_EN_1 = [
  'That morning the road was covered by a thick fog that barely',
  'allowed anyone to see the trees along the path. Nobody in the',
  'village dared to leave the house while the damp stayed on the win-',
  'dows and the cold crept under the doors.',
];
const PARRAFO_EN_2 = [
  'The next day the sun came back with force. The children went out',
  'to the square and conversations returned to the corners, as if the',
  'winter had been only a rumour.',
];

/** Libro en inglés, para probar la detección de idioma y la traducción. */
export function crearLibroIngles(ruta, totalPaginas = 6) {
  const flujos = [];
  for (let n = 1; n <= totalPaginas; n += 1) {
    const capitulo = (n === 1 || (n - 1) % 3 === 0)
      ? `CHAPTER ${ROMANOS[Math.min(Math.floor((n - 1) / 3), ROMANOS.length - 1)]}`
      : null;
    const lineas = [['A HISTORY OF TESTS', 70, 800, 9]];
    let y = 730;
    if (capitulo) { lineas.push([capitulo, 70, y, 18]); y -= 45; }
    for (const parrafo of (n % 2 ? [PARRAFO_EN_1, PARRAFO_EN_2] : [PARRAFO_EN_2, PARRAFO_EN_1])) {
      let primera = true;
      for (const renglon of parrafo) {
        lineas.push([renglon, primera ? 90 : 70, y, 11]);
        y -= 16;
        primera = false;
      }
      y -= 8;
    }
    lineas.push([String(n), 295, 40, 9]);
    flujos.push(flujoDeTexto(lineas));
  }
  return armarPdf(flujos, ruta);
}

/** Libro con encabezados, numeración, capítulos y guiones de corte. */
export function crearLibro(ruta, totalPaginas = 4) {
  const flujos = [];
  for (let n = 1; n <= totalPaginas; n += 1) {
    const capitulo = (n === 1 || (n - 1) % 15 === 0)
      ? `CAPITULO ${ROMANOS[Math.min(Math.floor((n - 1) / 15), ROMANOS.length - 1)]}`
      : null;
    const cuerpo = n % 2 ? [PARRAFO_1, PARRAFO_2] : [PARRAFO_3, PARRAFO_1, PARRAFO_2];
    flujos.push(flujoDeTexto(paginaLibro(n, capitulo, cuerpo)));
  }
  return armarPdf(flujos, ruta);
}

/** Caso real de regresión: una palabra continúa entre dos páginas físicas. */
export function crearLibroConPalabraEntrePaginas(ruta) {
  const paginaUno = [
    ['APENDICE MEDITACION', 70, 730, 18],
    ['Este apendice conserva un parrafo completo que cruza el limite fisico', 90, 685, 11],
    ['de la pagina. La explicacion conduce a una idea importante y es-', 70, 669, 11],
    ['10', 295, 40, 9],
  ];
  const paginaDos = [
    ['ta conclusion debe seguir siendo una sola palabra y un solo parrafo.', 70, 730, 11],
    ['Despues comienza otro parrafo completo para continuar la lectura.', 90, 690, 11],
    ['11', 295, 40, 9],
  ];
  return armarPdf([flujoDeTexto(paginaUno), flujoDeTexto(paginaDos)], ruta);
}

/** Casos reales sin guion: la IA decide la unión, pero solo en cortes marcados. */
export function crearLibroConCortesSinGuion(ruta) {
  const paginaUno = [
    ['Un frio y despejado dia viajaron durante dos horas al norte de Bos', 70, 100, 11],
  ];
  const paginaDos = [
    ['ton, hasta llegar a un monasterio. El A', 92, 800, 11],
    ['RN fabrica una nueva proteina de los componentes.Como ya has ido aprendiendo,', 70, 784, 11],
    ['el significado que le', 70, 768, 11],
  ];
  const paginaTres = [
    ['damos a esas experiencias produce un alu', 92, 800, 11],
  ];
  const paginaCuatro = [
    ['vión de respuestas fisicas. Y es', 92, 800, 11],
  ];
  const paginaCinco = [
    ['ta conclusion conserva la palabra completa.', 92, 800, 11],
  ];
  return armarPdf([paginaUno, paginaDos, paginaTres, paginaCuatro, paginaCinco].map(flujoDeTexto), ruta);
}

/**
 * El caso que reportó el usuario: el PDF parte «sorprendentes» al final de un
 * renglón, SIN guion, y el resto aparece al empezar el siguiente. No hay
 * ninguna marca que delate el corte: solo el diccionario puede saber que
 * «sorprend» no es palabra y «sorprendentes» sí.
 *
 * Lleva además dos trampas que deben quedarse quietas: «de la» y «sin
 * embargo», dos palabras reales seguidas que nadie debe pegar.
 */
export function crearLibroConPalabraPartida(ruta) {
  const pagina = [
    ['CAPITULO I', 70, 760, 18],
    ['Comparto mas historias sorprend', 90, 710, 11],
    ['entes sobre algunos participantes de mis talleres. La', 70, 694, 11],
    ['conver', 70, 678, 11],
    ['sacion siguio de la mano de sin embargo otro asunto.', 70, 662, 11],
    ['1', 295, 40, 9],
  ];
  return armarPdf([flujoDeTexto(pagina)], ruta);
}

/** PDF sin capa de texto: solo un rectángulo, como una página escaneada. */
export function crearEscaneado(ruta, paginas = 6) {
  const flujo = Buffer.from('0.5 0.5 0.5 rg\n50 50 495 742 re f\n', 'latin1');
  return armarPdf(Array.from({ length: paginas }, () => flujo), ruta);
}

/** Archivo con extensión .pdf pero contenido inservible. */
export function crearRoto(ruta) {
  const basura = Buffer.concat([
    Buffer.from('%PDF-1.4\nesto no es un pdf de verdad, son bytes sueltos\n', 'latin1'),
    Buffer.alloc(600, 1),
  ]);
  writeFileSync(ruta, basura);
  return basura.length;
}
