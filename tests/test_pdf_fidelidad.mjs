import { crearAtomo, atomosDesdePaginas } from '../js/pdf/atomos.js';
import { reconstruirDesdeAtomos, VERSION_RECONSTRUCCION, VERSION_TROCEO } from '../js/pdf/reconstruccion.js';
import { crearInformeFidelidad, validarFidelidadUnicode, VERSION_FIDELIDAD } from '../js/pdf/fidelidad.js';
import { serializarReconstruccion, planMigracionV8 } from '../js/pdf/manifiesto.js';

let fallos = 0;
function comprobar(condicion, nombre) {
  if (condicion) console.log(`OK: ${nombre}`);
  else { console.error(`FALLO: ${nombre}`); fallos += 1; }
}

function atomo(i, str, extras = {}) {
  return crearAtomo({
    page: extras.page || 1, itemIndex: i, str,
    x: extras.x ?? i * 60, y: extras.y ?? 700,
    width: extras.width ?? Math.max(10, str.length * 7), height: 12,
    hasEOL: extras.hasEOL ?? false,
    ...extras,
  });
}

console.log('--- fidelidad exacta de signos, mayúsculas y Unicode ---');
{
  const atomos = [atomo(0, '¿Hola,mundo?'), atomo(1, 'Árbol—niño', { x: 120 })];
  const r = reconstruirDesdeAtomos(atomos);
  comprobar(r.texto === '¿Hola,mundo? Árbol—niño', 'no corrige automáticamente puntuación ni mayúsculas');
  comprobar(r.estadoFidelidad.integridad.coincidenciaExacta, 'la reconstrucción coincide carácter por carácter');
  comprobar(r.estadoFidelidad.integridad.valido, 'todos los fragmentos tienen un destino único');
}

console.log('--- normalizaciones reversibles y fuente inmutable ---');
{
  const raw = [atomo(0, 'ﬁcción\u00A0exacta')];
  const r = reconstruirDesdeAtomos(raw);
  comprobar(r.texto === 'ficción exacta', 'la normalización Unicode documentada se aplica');
  comprobar(r.fragmentosFuente[0].str === 'ﬁcción\u00A0exacta', 'el fragmento fuente conserva ligadura y espacio duro');
  const cambio = r.transformaciones.find((t) => t.tipo === 'normalizacion_unicode');
  comprobar(cambio?.antes === 'ﬁcción\u00A0exacta' && cambio?.despues === 'ficción exacta' && cambio?.reversible, 'la normalización guarda antes y después');
}

console.log('--- omisiones explícitas y cobertura completa ---');
{
  const atomos = [];
  for (let p = 1; p <= 3; p += 1) {
    atomos.push(atomo(p * 10, 'CABECERA', { page: p, y: 820 }));
    atomos.push(atomo(p * 10 + 1, `Contenido ${p}.`, { page: p, y: 700 }));
  }
  const paginas = [1, 2, 3].map((numero) => ({ numero, ancho: 595, alto: 842 }));
  const r = reconstruirDesdeAtomos(atomos, { paginas });
  comprobar(r.omisiones.some((o) => o.motivo === 'cabecera_pie_repetido' && o.atomIds.length), 'la cabecera excluida conserva sus IDs fuente');
  comprobar(r.estadoFidelidad.integridad.fragmentosFuente === 6, 'se conservan los seis fragmentos fuente');
  comprobar(r.estadoFidelidad.integridad.valido, 'incluidos y omitidos cubren la fuente sin huecos');
  comprobar(r.estadoFidelidad.estado === 'pendiente_revision', 'una omisión queda pendiente de revisión humana');
}

console.log('--- OCR conserva palabra, caja y confianza ---');
{
  const atomos = atomosDesdePaginas([{ numero: 2, source: 'ocr', confianza: 81, lineas: [{
    texto: 'Texto OCR', y: 500, source: 'ocr', confianza: 82,
    items: [{ str: 'Texto', x: 10, y: 500, ancho: 35, altura: 12, confidence: 79, source: 'ocr' }, { str: 'OCR', x: 50, y: 500, ancho: 24, altura: 12, confidence: 88, source: 'ocr' }],
  }] }]);
  const r = reconstruirDesdeAtomos(atomos, { paginas: [{ numero: 2, confianza: 81 }], origen: 'ocr' });
  comprobar(r.fragmentosFuente.every((f) => f.source === 'ocr'), 'la procedencia OCR viaja por fragmento');
  comprobar(r.fragmentosFuente[0].confidence === 79 && r.fragmentosFuente[0].x === 10, 'la confianza y la caja OCR se conservan');
  comprobar(r.estadoFidelidad.estado === 'pendiente_revision', 'OCR nunca se declara verificado automáticamente');
}

console.log('--- serialización y migración ---');
{
  const r = reconstruirDesdeAtomos([atomo(0, 'Texto exacto.')]);
  const s = serializarReconstruccion(r);
  comprobar(VERSION_RECONSTRUCCION === 8 && VERSION_TROCEO === 8 && VERSION_FIDELIDAD === 1, 'versiones del contrato fiel');
  comprobar(s.textoCanonico === r.texto && s.fragmentosFuente.length === 1, 'el texto y la fuente sobreviven al guardado');
  comprobar(Array.isArray(s.transformaciones) && s.estadoFidelidad.integridad.valido, 'el libro guarda ledger e integridad');
  comprobar(planMigracionV8({ versionReconstruccion: 7, tieneArchivo: true }).accion === 'reextraer', 'un libro v7 con PDF se reextrae');
  comprobar(planMigracionV8({ versionReconstruccion: 7 }).accion === 'needs_source', 'un libro v7 sin fuente no finge verificación');
  comprobar(planMigracionV8({ versionReconstruccion: 7, atomos: r.atomos, manifiesto: r.manifiesto }).accion === 'needs_source', 'un manifiesto antiguo sin PDF sigue siendo no verificable');
}

console.log('--- detección de alteración no registrada ---');
{
  const atomos = [atomo(0, 'Tal cual.')];
  const r = reconstruirDesdeAtomos(atomos);
  const informe = crearInformeFidelidad(r);
  const invalida = validarFidelidadUnicode({
    fragmentosFuente: informe.fragmentosFuente,
    atomos: r.atomos,
    limites: r.limites,
    omisiones: r.omisiones,
    texto: 'Tal cual. ',
  });
  comprobar(!invalida.valido && invalida.errores.includes('texto_no_reproducible'), 'detecta incluso un espacio añadido al final');

  const atomoMutado = r.atomos.map((a) => ({ ...a, str: 'Texto cambiado.' }));
  const mutacionFuente = validarFidelidadUnicode({
    fragmentosFuente: informe.fragmentosFuente,
    atomos: atomoMutado,
    limites: r.limites,
    texto: 'Texto cambiado.',
  });
  comprobar(!mutacionFuente.valido && mutacionFuente.errores.includes('fragmentos_alterados'),
    'detecta un fragmento modificado aunque el texto derivado coincida');

  const fragmentoDuplicado = validarFidelidadUnicode({
    fragmentosFuente: informe.fragmentosFuente,
    atomos: [...r.atomos, r.atomos[0]],
    limites: [{
      id: 'b-duplicado', leftAtomId: r.atomos[0].id, rightAtomId: r.atomos[0].id,
      decision: 'space', source: 'test', originalSeparator: ' ',
    }],
    texto: 'Tal cual. Tal cual.',
  });
  comprobar(!fragmentoDuplicado.valido && fragmentoDuplicado.errores.includes('fragmentos_repetidos_en_destino'),
    'detecta un fragmento usado más de una vez');
}

if (fallos) {
  console.error(`\n${fallos} prueba(s) fallaron.`);
  process.exit(1);
}
console.log('\nTodas las pruebas de fidelidad pasaron.');
