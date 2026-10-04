/* Figuras del PDF: estado por aparato, sincronización y colocación.
 *
 *   node tests/test_pdf_figuras.mjs
 *
 * Caso real que lo motivó (2026-10-04): un libro subido en el PC llegaba al
 * teléfono por la nube con `figurasEstado: 'listas'` y `tieneArchivo: true`
 * copiados del PC. El teléfono no tenía ni el PDF ni las imágenes, creía que
 * sí y el libro se leía SIN figuras para siempre, sin ningún aviso.
 */
import { componerRegistroDocumento } from '../js/pdf/biblioteca.js';
import { metaSinCamposDelAparato } from '../js/pdf/sincronizacion.js';
import { situarFiguras, VERSION_FIGURAS, figurasPorRehacer } from '../js/pdf/figurasPdf.js';

let ok = 0;
let fallos = 0;
function comprobar(condicion, nombre) {
  if (condicion) { ok += 1; console.log(`OK: ${nombre}`); }
  else { fallos += 1; console.error(`FALLO: ${nombre}`); }
}

console.log('--- lo que llega por la nube no trae el estado de figuras del otro aparato ---');
{
  const remota = {
    id: 'libro', titulo: 'Libro', tieneArchivo: true,
    figurasEstado: 'listas', figurasCuenta: 15, figurasVersion: VERSION_FIGURAS,
  };
  const limpia = metaSinCamposDelAparato(remota);
  comprobar(!('tieneArchivo' in limpia), 'no copia tieneArchivo: el PDF no viaja');
  comprobar(!('figurasEstado' in limpia) && !('figurasCuenta' in limpia) && !('figurasVersion' in limpia),
    'no copia el estado de figuras del otro aparato');
  comprobar(limpia.figurasEnOrigen === 15, 'recuerda cuántas figuras tiene el libro en su origen');
  comprobar(limpia.titulo === 'Libro' && limpia.id === 'libro', 'conserva el resto del registro');
  comprobar(remota.figurasEstado === 'listas', 'no muta el paquete recibido');
  comprobar(metaSinCamposDelAparato({ id: 'x', figurasEnOrigen: 4 }).figurasEnOrigen === 4,
    'un paquete que ya trae figurasEnOrigen la conserva');
  comprobar(!('figurasEnOrigen' in metaSinCamposDelAparato({ id: 'x' })), 'sin figuras no inventa el campo');

  /* Integración con el guardado: un registro local nuevo queda sin estado de
   * figuras (se buscarán o se avisará), y uno local existente conserva el suyo. */
  const nuevo = componerRegistroDocumento({}, limpia);
  comprobar(!nuevo.tieneArchivo && nuevo.figurasEstado === undefined, 'libro llegado de la nube: sin PDF y figuras por buscar');
  const local = { id: 'libro', tieneArchivo: true, figurasEstado: 'listas', figurasCuenta: 15 };
  const mezclado = componerRegistroDocumento(local, limpia);
  comprobar(mezclado.tieneArchivo && mezclado.figurasEstado === 'listas' && mezclado.figurasCuenta === 15,
    'en el aparato que sí tiene el PDF, la sincronización no borra sus figuras');
}

console.log('--- un PDF nuevo invalida las figuras del anterior ---');
{
  const previo = { id: 'l', tieneArchivo: true, figurasEstado: 'listas', figurasCuenta: 3, figurasVersion: VERSION_FIGURAS };
  const conPdf = componerRegistroDocumento(previo, { id: 'l' }, { pdf: { size: 10 } });
  comprobar(conPdf.figurasEstado === undefined && conPdf.figurasCuenta === undefined,
    'guardar otro PDF obliga a volver a buscar sus figuras');
  const sinPdf = componerRegistroDocumento(previo, { id: 'l', progreso: { parte: 2 } });
  comprobar(sinPdf.figurasEstado === 'listas', 'guardar el avance no toca las figuras');
}

console.log('--- cuándo hay que volver a buscar las figuras ---');
{
  comprobar(figurasPorRehacer({}, 0) === true, 'nunca buscadas → buscar');
  comprobar(figurasPorRehacer({ figurasEstado: 'sinpdf' }, 0) === true, 'sin PDF antes → reintentar (quizá ya está)');
  comprobar(figurasPorRehacer({ figurasEstado: 'listas', figurasCuenta: 15 }, 15) === false, 'listas y guardadas → no repetir');
  comprobar(figurasPorRehacer({ figurasEstado: 'listas', figurasCuenta: 15 }, 0) === true,
    'marcadas listas pero sin imágenes en este aparato → buscar de nuevo');
  comprobar(figurasPorRehacer({ figurasEstado: 'ninguna', figurasVersion: VERSION_FIGURAS }, 0) === false,
    '«ninguna» de esta versión → no repetir');
  comprobar(figurasPorRehacer({ figurasEstado: 'ninguna' }, 0) === true,
    '«ninguna» de una versión anterior → reintentar (un fallo viejo no condena el libro)');
}

console.log('--- colocación por ancla, también con capítulos ---');
{
  const texto = 'Primer párrafo del capítulo con su contenido.\n\nSegundo párrafo, que viene justo antes de la figura del ejemplo.\n\nTercer párrafo final.';
  const figs = [{ pagina: 3, ancla: 'quevienejustoantesdelafiguradelejemplo', anclaDespues: false }];
  const s = situarFiguras(texto, figs);
  comprobar(s.length === 1, 'la figura se sitúa en su capítulo');
  comprobar(s.length === 1 && texto.slice(0, s[0].posicion).endsWith('ejemplo'), 'queda justo después de su ancla');
  comprobar(situarFiguras('Otro capítulo sin relación alguna con nada.', figs).length === 0, 'no aparece en un capítulo ajeno');
}

console.log(`\n${ok} comprobaciones OK · ${fallos} fallos`);
process.exit(fallos ? 1 : 0);
