/* Pruebas de pulido mecánico y preparación para voz.
 * Ejecutar: node tests/test_pdf_pulido_mecanico.mjs
 */
import { pulirParaLectura } from '../js/pdf/limpiezaTexto.js';
import { prepararParaVoz, numeroAPalabras } from '../js/pdf/vozTexto.js';

let fallos = 0;
function comprobar(condicion, mensaje) {
  if (condicion) {
    console.log(`OK: ${mensaje}`);
  } else {
    fallos += 1;
    console.error(`FALLO: ${mensaje}`);
  }
}

function palabras(texto) {
  return texto
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

console.log('--- 1) Pruebas de pulirParaLectura ---');

// 1. Comillas
{
  const res = pulirParaLectura('"hola mundo"');
  comprobar(res === '«hola mundo»', `Comillas tipográficas por pares (obtenido: "${res}")`);
}

// 2. Puntos suspensivos
{
  const res = pulirParaLectura('espera....');
  comprobar(res === 'Espera…', `Elipsis única para 4 puntos (obtenido: "${res}")`);
}

// 3. Guion de diálogo
{
  const res = pulirParaLectura('-Hola -dijo Juan.');
  comprobar(res.includes('—Hola') && res.includes('—dijo Juan.'), `Guion de diálogo y acotación (obtenido: "${res}")`);
}

// 4. Espaciado en signos
{
  const res = pulirParaLectura('hola , que tal ; bien .');
  comprobar(res === 'Hola, que tal; bien.', `Quitar espacio antes de signos (obtenido: "${res}")`);
}
{
  const res = pulirParaLectura('hola,que tal;como te va');
  comprobar(res === 'Hola, que tal; como te va.', `Espacio después de signos seguido de letra (obtenido: "${res}")`);
}

// 5. Signos de apertura sin espacio
{
  const res = pulirParaLectura('¿ Hola ? ¡ Si !');
  comprobar(res === '¿Hola? ¡Si!', `Signos de apertura sin espacio posterior (obtenido: "${res}")`);
}

// 6. Cerrar párrafos sin punto
{
  const entrada = 'Primer párrafo sin punto\n\nSegundo párrafo sin punto';
  const res = pulirParaLectura(entrada);
  comprobar(res === 'Primer párrafo sin punto.\n\nSegundo párrafo sin punto.', `Párrafos cerrados con punto (obtenido: "${res}")`);
}

// 7. Mayúscula tras signo
{
  const res = pulirParaLectura('hola. aquella tarde');
  comprobar(res === 'Hola. Aquella tarde.', `Mayúscula tras punto (obtenido: "${res}")`);
}

// 8. Invariante: NO cambia ninguna palabra
{
  const original = 'Este es un texto con "comillas", guiones -de dialogo- y varios parrafos sin punto\n\nQue continua aqui con 1997 palabras y detalles.';
  const pulido = pulirParaLectura(original);
  const p1 = palabras(original);
  const p2 = palabras(pulido);
  const iguales = p1.length === p2.length && p1.every((w, i) => w === p2[i]);
  comprobar(iguales, 'Invariante: pulirParaLectura no añade, elimina ni cambia ninguna palabra');
}

console.log('\n--- 2) Pruebas de prepararParaVoz ---');

// Números (la conversión a palabras sigue funcionando internamente)
{
  comprobar(numeroAPalabras(0) === 'cero', '0 -> cero');
  comprobar(numeroAPalabras(100) === 'cien', '100 -> cien');
  comprobar(numeroAPalabras(1997) === 'mil novecientos noventa y siete', '1997 -> mil novecientos noventa y siete');
  comprobar(numeroAPalabras(2024) === 'dos mil veinticuatro', '2024 -> dos mil veinticuatro');
  comprobar(numeroAPalabras(45) === 'cuarenta y cinco', '45 -> cuarenta y cinco');
}

// Siglos romanos (se expanden SIEMPRE, neural o no)
{
  const res = prepararParaVoz('En el S. XIX y el siglo XXI');
  comprobar(res.includes('siglo diecinueve') && res.includes('siglo veintiuno'), `Siglos romanos expandidos (obtenido: "${res}")`);
}

// Abreviaturas y siglas (se expanden SIEMPRE, neural o no)
{
  const res = prepararParaVoz('El Dr. y la Dra. viajaron a EE. UU. p. ej.');
  comprobar(res.includes('doctor') && res.includes('doctora') && res.includes('Estados Unidos') && res.includes('por ejemplo'), `Abreviaturas y siglas expandidas (obtenido: "${res}")`);
}

console.log('\n--- 2a) Modo neural (default): números y párrafos intactos ---');

// Con neural=true (default), los números NO se convierten
{
  const res = prepararParaVoz('El 45 % de los casos entre 1914-1918');
  comprobar(res.includes('45'), `Neural: los números se dejan intactos para Edge TTS (obtenido: "${res}")`);
  comprobar(!res.includes('cuarenta y cinco por ciento'), `Neural: NO convierte porcentajes a palabras (obtenido: "${res}")`);
}

// Con neural=true (default), los párrafos NO reciben punto artificial
{
  const res = prepararParaVoz('Primer párrafo\n\nSegundo párrafo');
  comprobar(!res.includes('Primer párrafo.'), `Neural: NO inyecta punto al final del párrafo (obtenido: "${res}")`);
  comprobar(res.includes('Primer párrafo'), `Neural: conserva el texto tal cual (obtenido: "${res}")`);
}

console.log('\n--- 2b) Modo navegador (neural=false): conversión completa ---');

// Con neural=false, los números SÍ se convierten
{
  const res = prepararParaVoz('El 45 % de los casos entre 1914-1918', 'es', { neural: false });
  comprobar(res.includes('cuarenta y cinco por ciento'), `Browser: porcentajes expandidos (obtenido: "${res}")`);
  comprobar(res.includes('de mil novecientos catorce a mil novecientos dieciocho'), `Browser: rangos de años expandidos (obtenido: "${res}")`);
}

// Con neural=false, los párrafos SÍ reciben punto
{
  const res = prepararParaVoz('Primer párrafo\n\nSegundo párrafo', 'es', { neural: false });
  comprobar(res.includes('Primer párrafo.') && res.includes('Segundo párrafo.'), `Browser: pausa de párrafo asegurada con punto (obtenido: "${res}")`);
}

// Abreviaturas con número se expanden en ambos modos (punto dispara corte falso)
{
  const resNeural = prepararParaVoz('pág. 12 y cap. 4');
  comprobar(resNeural.includes('página doce') && resNeural.includes('capítulo cuatro'), `Neural: abreviatura+número se expande (obtenido: "${resNeural}")`);
}

if (fallos > 0) {
  console.error(`\n❌ ${fallos} prueba(s) fallaron.`);
  process.exit(1);
} else {
  console.log('\n✅ Todas las pruebas de pulido mecánico y texto para voz pasaron correctamente.');
}

