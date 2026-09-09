/* JG Turbo · Pruebas de orden manual y carátulas movibles de PDF
 * Ejecutar: node tests/test_pdf_orden_manual.mjs
 */
import { ordenarDocumentos } from '../js/pdf/libroVista.js';

let fallos = 0;
function comprobar(condicion, mensaje) {
  if (condicion) console.log(`OK: ${mensaje}`);
  else { fallos += 1; console.error(`FALLO: ${mensaje}`); }
}

const docsPrueba = [
  { id: 'libro-1', titulo: 'Conversaciones con Dios 1', actualizado: 1000, creado: 500 },
  { id: 'libro-2', titulo: 'El Aprendiz de Brujo', actualizado: 2000, creado: 600 },
  { id: 'libro-3', titulo: 'Pre-suasión', actualizado: 3000, creado: 700 },
  { id: 'libro-4', titulo: 'Sapiens', actualizado: 4000, creado: 800 },
];

/* 1. Orden reciente (por defecto) */
{
  const res = ordenarDocumentos(docsPrueba, 'reciente');
  comprobar(res[0].id === 'libro-4' && res[3].id === 'libro-1',
    'modo reciente ordena por fecha de actualización descendente');
}

/* 2. Orden por título */
{
  const res = ordenarDocumentos(docsPrueba, 'titulo');
  comprobar(res[0].id === 'libro-1' && res[1].id === 'libro-2' && res[2].id === 'libro-3' && res[3].id === 'libro-4',
    'modo titulo ordena alfabéticamente en español');
}

/* 3. Orden personalizado con array explícito */
{
  const ordenDeseado = ['libro-3', 'libro-1', 'libro-4', 'libro-2'];
  const res = ordenarDocumentos(docsPrueba, 'personalizado', ordenDeseado);
  const idsRes = res.map((d) => d.id);
  comprobar(
    idsRes[0] === 'libro-3' && idsRes[1] === 'libro-1' && idsRes[2] === 'libro-4' && idsRes[3] === 'libro-2',
    `modo personalizado respeta el orden manual de los libros (${idsRes.join(', ')})`
  );
}

/* 4. Orden personalizado cuando hay libros nuevos sin registrar en el orden manual */
{
  const ordenDeseado = ['libro-2', 'libro-1'];
  // libro-3 y libro-4 son nuevos: deben situarse al inicio sin desaparecer
  const res = ordenarDocumentos(docsPrueba, 'personalizado', ordenDeseado);
  const idsRes = res.map((d) => d.id);
  comprobar(idsRes.length === 4, 'no descarta ningún documento aunque no esté en el orden manual');
  comprobar(idsRes.includes('libro-3') && idsRes.includes('libro-4'), 'los libros nuevos están presentes');
  comprobar(idsRes.indexOf('libro-2') < idsRes.indexOf('libro-1'), 'conserva el orden relativo entre los libros ordenados previamente');
}

/* 5. Orden personalizado leyendo desde localStorage */
{
  const memoria = {};
  globalThis.localStorage = {
    getItem(k) { return memoria[k] || null; },
    setItem(k, v) { memoria[k] = String(v); },
    removeItem(k) { delete memoria[k]; }
  };

  localStorage.setItem('jg_pdf_orden_manual', JSON.stringify(['libro-4', 'libro-3', 'libro-2', 'libro-1']));
  const res = ordenarDocumentos(docsPrueba, 'personalizado');
  const idsRes = res.map((d) => d.id);
  comprobar(
    idsRes[0] === 'libro-4' && idsRes[1] === 'libro-3' && idsRes[2] === 'libro-2' && idsRes[3] === 'libro-1',
    'lee y aplica el orden manual guardado en localStorage'
  );
}

/* 6. Casos borde */
{
  comprobar(Array.isArray(ordenarDocumentos(null, 'personalizado')), 'docs null no revienta');
  comprobar(Array.isArray(ordenarDocumentos([], 'personalizado')), 'docs vacío devuelve lista vacía');
  comprobar(ordenarDocumentos([{ id: 'x' }], 'personalizado').length === 1, 'un solo doc funciona');
}

if (fallos > 0) {
  console.error(`\n❌ ${fallos} pruebas fallaron.`);
  process.exit(1);
} else {
  console.log('\n✅ Todas las pruebas de orden manual pasaron correctamente.');
}
