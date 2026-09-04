/* Genera un PDF «escaneado»: páginas que son una imagen con letras dentro,
 * igual que la foto de la página de un libro.
 *
 * Sirve para probar el OCR de verdad. El texto se dibuja en un lienzo con el
 * propio navegador (Playwright), se exporta como JPEG y ese JPEG se incrusta
 * en un PDF. Para pdf.js no hay ni una letra: solo una imagen.
 */
import { writeFileSync } from 'node:fs';

const ANCHO = 1240;   /* ~150 ppp en una hoja A4 */
const ALTO = 1754;

/** Dibuja el texto en un lienzo dentro del navegador y devuelve el JPEG. */
export async function pintarPaginaComoImagen(pagina, lineas) {
  return pagina.evaluate(async ({ ancho, alto, lineas: textos }) => {
    const lienzo = document.createElement('canvas');
    lienzo.width = ancho;
    lienzo.height = alto;
    const ctx = lienzo.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, ancho, alto);
    ctx.fillStyle = '#111111';
    ctx.textBaseline = 'top';
    let y = 150;
    for (const linea of textos) {
      ctx.font = linea.grande
        ? 'bold 58px Georgia, "Times New Roman", serif'
        : '40px Georgia, "Times New Roman", serif';
      ctx.fillText(linea.texto, 120, y);
      y += linea.grande ? 110 : 62;
    }
    const url = lienzo.toDataURL('image/jpeg', 0.92);
    return url.slice(url.indexOf(',') + 1);
  }, { ancho: ANCHO, alto: ALTO, lineas });
}

/** Arma un PDF donde cada página es una de esas imágenes, a hoja completa. */
export function pdfDeImagenes(jpegsBase64, ruta) {
  const objetos = [];
  const n = jpegsBase64.length;
  /* 1 catálogo · 2 páginas · luego por página: página, contenido e imagen */
  const idsPagina = Array.from({ length: n }, (_, i) => 3 + i * 3);

  objetos.push(Buffer.from('<< /Type /Catalog /Pages 2 0 R >>', 'latin1'));
  objetos.push(Buffer.from(
    `<< /Type /Pages /Kids [${idsPagina.map((i) => `${i} 0 R`).join(' ')}] /Count ${n} >>`, 'latin1'));

  jpegsBase64.forEach((base64, i) => {
    const idPagina = idsPagina[i];
    const idContenido = idPagina + 1;
    const idImagen = idPagina + 2;
    const imagen = Buffer.from(base64, 'base64');
    const flujo = Buffer.from(`q ${ANCHO} 0 0 ${ALTO} 0 0 cm /Im0 Do Q`, 'latin1');

    objetos.push(Buffer.from(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${ANCHO} ${ALTO}] ` +
      `/Resources << /XObject << /Im0 ${idImagen} 0 R >> >> /Contents ${idContenido} 0 R >>`, 'latin1'));
    objetos.push(Buffer.concat([
      Buffer.from(`<< /Length ${flujo.length} >>\nstream\n`, 'latin1'), flujo,
      Buffer.from('\nendstream', 'latin1'),
    ]));
    objetos.push(Buffer.concat([
      Buffer.from(
        `<< /Type /XObject /Subtype /Image /Width ${ANCHO} /Height ${ALTO} ` +
        `/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${imagen.length} >>\nstream\n`,
        'latin1'),
      imagen,
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

/** Texto de las páginas de prueba: frases claras y fáciles de comprobar. */
export const PAGINAS_ESCANEADAS = [
  [
    { texto: 'CAPITULO PRIMERO', grande: true },
    { texto: 'La biblioteca del pueblo abria sus puertas' },
    { texto: 'todas las mananas a las ocho en punto.' },
    { texto: 'El bibliotecario se llamaba Ernesto y' },
    { texto: 'conocia cada libro de memoria.' },
  ],
  [
    { texto: 'Los ninos llegaban despues del colegio' },
    { texto: 'y se sentaban junto a la ventana grande.' },
    { texto: 'Ernesto les leia una historia distinta' },
    { texto: 'cada tarde, sin repetir ninguna.' },
  ],
];
