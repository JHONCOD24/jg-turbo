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
