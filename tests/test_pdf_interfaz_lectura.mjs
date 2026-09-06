/* Interfaz del lector: los ajustes de lectura en un solo sitio y nada de
 * mantenimiento debajo del texto.
 * Ejecutar: node tests/test_pdf_interfaz_lectura.mjs */
import { readFileSync } from 'node:fs';

let fallos = 0; let ok = 0;
function comprobar(cond, msg) {
  if (cond) { ok += 1; console.log(`OK: ${msg}`); }
  else { fallos += 1; console.error(`FALLO: ${msg}`); }
}

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const vista = readFileSync(new URL('../js/pdf/libroVista.js', import.meta.url), 'utf8');
const ctrl = readFileSync(new URL('../js/pdf/pdfController.js', import.meta.url), 'utf8');

console.log('--- los ajustes de lectura viven en un solo sitio ---');
{
  comprobar(!/<details class="pdf-apariencia"/.test(html),
    'la apariencia deja de ser un desplegable bajo el texto');
  comprobar(html.includes('id="btnPdfApariencia"'), 'hay un botón de apariencia en la cabecera');
  comprobar(html.includes('id="pdfAparienciaHoja"'), 'existe la hoja de apariencia');
  const i = html.indexOf('id="pdfAparienciaHoja"');
  const hoja = html.slice(i, i + 3000);
  comprobar(hoja.includes('btnPdfTemaPapel') && hoja.includes('btnPdfTemaNoche') && hoja.includes('btnPdfTemaSepia'),
    'los tres temas viven juntos dentro de la hoja');
  comprobar((html.match(/id="btnPdfTemaPapel"/g) || []).length === 1,
    'el tema Papel aparece una sola vez (no hay grupo duplicado)');
  comprobar((html.match(/id="btnPdfTemaNoche"/g) || []).length === 1,
    'el tema Noche aparece una sola vez');
}

console.log('--- debajo del texto solo queda lo que es de lectura ---');
{
  const lector = html.slice(html.indexOf('id="pdfLectura"'), html.indexOf('id="pdfDockNav"'));
  comprobar(!lector.includes('btnPdfVincular'),
    'vincular el PDF original no vive junto al texto: es mantenimiento');
  comprobar(html.includes('id="btnPdfVincular"'), 'pero sigue existiendo, en Opciones');
  comprobar(/id="btnPdfCortes"[^>]*hidden/.test(html),
    'Revisar cortes empieza oculto: solo aparece si hay cortes');
}

console.log('--- accesibilidad de la hoja ---');
{
  comprobar(/id="btnPdfApariencia"[\s\S]{0,300}aria-expanded/.test(html),
    'el botón de apariencia declara si la hoja está abierta');
  comprobar(/id="pdfAparienciaHoja"[\s\S]{0,200}role="dialog"/.test(html),
    'la hoja es un diálogo con nombre');
  comprobar(vista.includes("ev.key === 'Escape'"), 'Escape cierra la hoja');
  /* Se comprueba que el cierre devuelve el foco, sin fijar el nombre de la
     variable: quién lo recibe depende de la pantalla (en el teléfono «Aa»
     vive en la barra del pulgar). Que vuelva al botón CORRECTO lo mide
     `verificar_pdf_lector_integracion.mjs` en un navegador de verdad. */
  comprobar(/cerrarApariencia[\s\S]{0,200}api\.cerrarHoja/.test(vista)
    && ctrl.includes('devolverFocoHoja(origen') && ctrl.includes('focus({ preventScroll: true })'),
    'al cerrar, el foco vuelve a un botón que abre la hoja');
  const etiquetas = (html.match(/<label for="pdfApar/g) || []).length;
  comprobar(etiquetas >= 4, 'cada control de apariencia tiene su etiqueta asociada');
}

console.log('--- sin trabajo inútil ---');
{
  comprobar(!vista.includes('setInterval'), 'el botón Pausar deja de comprobarse cada segundo');
  comprobar(vista.includes('function refrescarPausa'), 'Pausar se refresca cuando cambia el estado');
  comprobar(ctrl.includes('libroVista.refrescarPausa'), 'el controlador avisa a la vista del cambio');
}

console.log(fallos ? `\n❌ ${fallos} fallos, ${ok} bien.` : `\n✅ Interfaz del lector: ${ok} comprobaciones bien.`);
process.exit(fallos ? 1 : 0);
