/* Pruebas de la búsqueda por relevancia dentro de un documento.
 * Ejecutar: node tests/test_pdf_busqueda.mjs
 *
 * Sirve para elegir QUÉ trozos del libro se le mandan a la IA cuando le
 * preguntas algo: no cabe el libro entero en una consulta, así que hay que
 * escoger bien. Antes se contaban palabras sueltas; ahora se pesa cuánto
 * distingue cada palabra (BM25), que es lo que usan los buscadores.
 */
import { tokenizar, construirIndice, buscarRelevantes } from '../js/pdf/busqueda.js';

let fallos = 0;
function comprobar(condicion, mensaje) {
  if (condicion) console.log(`OK: ${mensaje}`);
  else { fallos += 1; console.error(`FALLO: ${mensaje}`); }
}

/* ── Tokenizar ─────────────────────────────────────────────────────── */
{
  comprobar(
    JSON.stringify(tokenizar('La CASA del árbol')) === JSON.stringify(['casa', 'arbol']),
    'pasa a minúsculas, quita tildes y descarta palabras vacías'
  );
  comprobar(
    tokenizar('¿Cuánto cuesta, el envío?').includes('envio'),
    'los signos de puntuación no se pegan a las palabras'
  );
  comprobar(tokenizar('').length === 0, 'un texto vacío no produce palabras');
  comprobar(
    JSON.stringify(tokenizar('casas')) === JSON.stringify(tokenizar('casa')),
    'singular y plural se buscan igual'
  );
  comprobar(
    !tokenizar('de la que por con para').length,
    'una frase de puras palabras vacías no aporta nada que buscar'
  );
}

/* ── Relevancia ────────────────────────────────────────────────────── */
const BLOQUES = [
  { id: 0, texto: 'La niebla cubrio el pueblo entero durante tres dias seguidos.' },
  { id: 1, texto: 'El precio del trigo subio y la cosecha se perdio por la sequia.' },
  { id: 2, texto: 'Hablaban de la niebla, pero la niebla ya se habia ido del valle.' },
  { id: 3, texto: 'Un capitulo dedicado a la organizacion de los vecinos del pueblo.' },
];

{
  const indice = construirIndice(BLOQUES);
  const resultados = buscarRelevantes(indice, '¿Qué pasó con la niebla?', { maximo: 3 });
  comprobar(resultados.length > 0, 'encuentra bloques para una pregunta normal');
  comprobar(
    resultados[0].id === 2 || resultados[0].id === 0,
    'el bloque más relacionado con «niebla» queda de primero'
  );
  comprobar(
    !resultados.some((r) => r.id === 1),
    'no cuela el bloque que no habla del tema'
  );
}

{
  const indice = construirIndice(BLOQUES);
  const resultados = buscarRelevantes(indice, 'niebla', { maximo: 10 });
  comprobar(
    resultados[0].id === 2,
    'entre dos bloques del mismo tema, gana el que repite más la palabra clave'
  );
}

{
  // Una palabra que sale en todos los bloques no debe decidir el resultado.
  const indice = construirIndice(BLOQUES);
  const resultados = buscarRelevantes(indice, 'pueblo trigo', { maximo: 2 });
  comprobar(
    resultados[0].id === 1,
    'pesa más la palabra rara («trigo») que la repetida en varios bloques («pueblo»)'
  );
}

{
  const indice = construirIndice(BLOQUES);
  comprobar(
    buscarRelevantes(indice, 'dinosaurios espaciales', { maximo: 5 }).length === 0,
    'una pregunta sin relación no devuelve nada'
  );
  comprobar(
    buscarRelevantes(indice, 'de la que', { maximo: 5 }).length === 0,
    'una pregunta de puras palabras vacías no devuelve nada'
  );
}

{
  const indice = construirIndice(BLOQUES);
  const resultados = buscarRelevantes(indice, 'niebla pueblo vecinos capitulo', { maximo: 2 });
  comprobar(resultados.length <= 2, 'respeta el máximo de bloques pedido');
  comprobar(
    resultados[0].puntaje >= resultados[resultados.length - 1].puntaje,
    'los resultados vienen ordenados de más a menos relevante'
  );
}

/* ── Casos límite ──────────────────────────────────────────────────── */
{
  comprobar(buscarRelevantes(construirIndice([]), 'algo', {}).length === 0, 'un documento vacío no revienta');
  comprobar(
    buscarRelevantes(construirIndice(BLOQUES), '', {}).length === 0,
    'una consulta vacía no devuelve nada'
  );
  const conBasura = construirIndice([{ id: 0, texto: '' }, { id: 1, texto: '   ' }, { id: 2, texto: 'niebla' }]);
  const r = buscarRelevantes(conBasura, 'niebla', {});
  comprobar(r.length === 1 && r[0].id === 2, 'los bloques vacíos se ignoran sin romper el cálculo');
}

{
  // Documento grande: la búsqueda debe seguir siendo instantánea.
  const muchos = Array.from({ length: 2000 }, (_, i) => ({
    id: i,
    texto: `Bloque numero ${i} con texto de relleno sobre el pueblo y la cosecha. ` +
      (i === 1500 ? 'Aqui se menciona el astrolabio del capitan.' : ''),
  }));
  const arranque = Date.now();
  const indice = construirIndice(muchos);
  const resultados = buscarRelevantes(indice, '¿Dónde está el astrolabio?', { maximo: 3 });
  const ms = Date.now() - arranque;
  comprobar(resultados[0]?.id === 1500, 'encuentra la aguja en un pajar de 2.000 bloques');
  comprobar(ms < 1500, `indexar y buscar en 2.000 bloques es rápido (${ms} ms)`);
}

console.log(fallos === 0 ? '\nTodas las pruebas de búsqueda pasaron.' : `\n${fallos} prueba(s) fallaron.`);
process.exit(fallos === 0 ? 0 : 1);
