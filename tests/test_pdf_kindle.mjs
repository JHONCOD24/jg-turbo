/* Pruebas del límite seguro de la importación Kindle.
 * Ejecutar: node tests/test_pdf_kindle.mjs
 */
import { readFileSync } from 'node:fs';
import {
  calcularHuellaArchivo, clasificarArchivoKindle, extensionArchivo,
  idKindleDesdeHuella, mensajeErrorKindle,
} from '../js/pdf/kindleImport.js';

let fallos = 0;
function comprobar(condicion, mensaje) {
  if (condicion) console.log(`OK: ${mensaje}`);
  else { fallos += 1; console.error(`FALLO: ${mensaje}`); }
}

const archivo = (name, type = '', texto = 'contenido') => {
  const blob = new Blob([texto], { type });
  Object.defineProperty(blob, 'name', { value: name });
  return blob;
};

comprobar(extensionArchivo('Mi.Libro.PDF') === 'pdf', 'reconoce la extensión sin importar mayúsculas');
comprobar(extensionArchivo('sin-extension') === '', 'un nombre sin extensión no rompe');
comprobar(clasificarArchivoKindle(archivo('libro.pdf')).aceptado, 'acepta un PDF por extensión');
comprobar(
  !clasificarArchivoKindle(archivo('descarga', 'application/pdf')).aceptado,
  'exige la extensión PDF aunque el navegador declare el MIME'
);
comprobar(
  !clasificarArchivoKindle(archivo('protegido.azw', 'application/pdf')).aceptado,
  'un MIME incorrecto no disfraza un AZW como PDF'
);

for (const extension of ['azw', 'azw3', 'kfx', 'mobi']) {
  const resultado = clasificarArchivoKindle(archivo(`libro.${extension}`));
  comprobar(!resultado.aceptado && resultado.codigo === 'formato-kindle', `rechaza ${extension.toUpperCase()} sin convertirlo`);
  comprobar(/no abre|no elimina DRM/i.test(resultado.mensaje), `${extension.toUpperCase()} explica el límite de DRM`);
}
comprobar(
  clasificarArchivoKindle(archivo('notas.txt')).codigo === 'no-pdf',
  'rechaza otros formatos sin tratarlos como Kindle'
);

const uno = archivo('uno.pdf', 'application/pdf', 'el mismo contenido');
const copia = archivo('copia.pdf', 'application/pdf', 'el mismo contenido');
const distinto = archivo('otro.pdf', 'application/pdf', 'contenido distinto');
const huellaUno = await calcularHuellaArchivo(uno);
const huellaCopia = await calcularHuellaArchivo(copia);
const huellaDistinta = await calcularHuellaArchivo(distinto);
comprobar(/^[a-f0-9]{64}$/.test(huellaUno), 'la huella SHA-256 tiene 64 caracteres hexadecimales');
comprobar(huellaUno === huellaCopia, 'dos archivos idénticos producen la misma huella');
comprobar(huellaUno !== huellaDistinta, 'dos contenidos diferentes no se confunden por el título');
comprobar(idKindleDesdeHuella(huellaUno).startsWith('kindle-'), 'el identificador estable sale de la huella');

let errorHuella = null;
try { idKindleDesdeHuella('no-valida'); } catch (error) { errorHuella = error; }
comprobar(Boolean(errorHuella), 'rechaza una huella inválida');
comprobar(
  /no quita contraseñas ni DRM/i.test(mensajeErrorKindle({ motivo: 'clave' }, 'Protegido.pdf')),
  'un PDF cifrado no recibe instrucciones para quitar la protección'
);

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const inicio = html.indexOf('id="pdfKindle"');
const fin = html.indexOf('</details>', inicio);
const asistente = html.slice(inicio, fin);
comprobar(inicio > 0 && fin > inicio, 'la interfaz incluye el asistente Traer desde Kindle');
comprobar(/id="pdfKindleInput"[^>]*multiple/.test(asistente), 'el selector permite varios archivos');
comprobar(/https:\/\/www\.amazon\.com\/mycd/.test(asistente), 'el asistente abre la gestión oficial de Amazon');
comprobar(!/type="password"|amazon[_-]?(token|cookie|session)/i.test(asistente), 'el asistente no pide credenciales ni sesión de Amazon');

const controlador = readFileSync(new URL('../js/pdf/pdfController.js', import.meta.url), 'utf8');
comprobar(controlador.includes("origen: 'kindle-descarga-oficial'"), 'los documentos conservan su origen autorizado');
comprobar(controlador.includes('sincronizarAlGuardar: false'), 'cada archivo del lote no dispara una sincronización propia');
comprobar(controlador.includes('sincronizarDocumento: quiereNube'), 'el destino local o nube se guarda por documento');

console.log(fallos === 0 ? '\nTodas las pruebas Kindle pasaron.' : `\n${fallos} prueba(s) fallaron.`);
process.exit(fallos === 0 ? 0 : 1);
