/* Pruebas de la carátula viajera: la portada va y vuelve intacta por la
 * sincronización (que solo mueve JSON), y lo inválido se descarta sin romper.
 * Ejecutar: node tests/test_pdf_portada.mjs
 */
import { blobADataURL, dataURLABlob } from '../js/pdf/biblioteca.js';

let fallos = 0;
function comprobar(condicion, mensaje) {
  if (condicion) console.log(`OK: ${mensaje}`);
  else { fallos += 1; console.error(`FALLO: ${mensaje}`); }
}

const bytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 1, 2, 3, 250, 251, 252]);
const original = new Blob([bytes], { type: 'image/jpeg' });

/* ── Ida y vuelta ─────────────────────────────────────────────────── */
{
  const texto = await blobADataURL(original);
  comprobar(typeof texto === 'string' && texto.startsWith('data:image/jpeg;base64,'),
    'convierte la imagen a texto para viajar');
  const deVuelta = await dataURLABlob(texto);
  comprobar(deVuelta instanceof Blob, 'el texto vuelve a ser imagen');
  comprobar(deVuelta.type === 'image/jpeg', 'conserva el tipo de imagen');
  const recBytes = new Uint8Array(await deVuelta.arrayBuffer());
  comprobar(recBytes.length === bytes.length && recBytes.every((b, i) => b === bytes[i]),
    'los bytes llegan intactos');
}

/* ── Lo inválido no rompe ─────────────────────────────────────────── */
{
  comprobar(await blobADataURL(null) === null, 'sin imagen devuelve null');
  comprobar(await dataURLABlob(null) === null, 'sin texto devuelve null');
  comprobar(await dataURLABlob('') === null, 'texto vacío devuelve null');
  comprobar(await dataURLABlob('data:text/plain;base64,aGk=') === null,
    'rechaza lo que no es imagen');
  comprobar(await dataURLABlob('no-es-un-data-url') === null,
    'rechaza texto cualquiera');
  comprobar(await dataURLABlob('data:image/png;base64,!!!') === null,
    'rechaza base64 roto');
}

console.log(fallos ? `\n${fallos} FALLO(S)` : '\nTodo en verde');
process.exit(fallos ? 1 : 0);
