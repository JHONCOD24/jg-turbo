/* Pruebas de troceo en navegador y guardián de integridad para pulido.
 * Ejecutar: node tests/test_pdf_pulido_troceo.mjs
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { mismasPalabras, crearPulidor } from '../js/pdf/pulido.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let fallos = 0;
function comprobar(condicion, mensaje) {
  if (condicion) {
    console.log(`OK: ${mensaje}`);
  } else {
    fallos += 1;
    console.error(`FALLO: ${mensaje}`);
  }
}

console.log('--- 1) Puerta única a /improve en index.html ---');
{
  const indexHtml = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
  const llamadas = (indexHtml.match(/'\/improve'/g) || []).length;
  comprobar(llamadas === 1, `Hay exactamente UNA llamada a '/improve' en index.html (encontradas: ${llamadas})`);
}

console.log('\n--- 2) Guardián de integridad (mismasPalabras) ---');

// Acepta mejoras legítimas de puntuación, mayúsculas y tildes
{
  const orig = 'habia una vez en un pueblo lejano donde la gente no salia de sus casas';
  const pul = 'Había una vez en un pueblo lejano, donde la gente no salía de sus casas.';
  const res = mismasPalabras(orig, pul);
  comprobar(res.igual === true, `Acepta tildes, mayúsculas, comas y punto final (igual=${res.igual})`);
}

// Rechaza sustitución de palabras por sinónimos
{
  const orig = 'El anciano caminaba lentamente por la calle desierta.';
  const pul = 'El viejo caminaba despacio por la calle solitaria.';
  const res = mismasPalabras(orig, pul);
  comprobar(res.igual === false, `Rechaza sustitución de palabras por sinónimos (igual=${res.igual}, motivo=${res.motivo})`);
}

// Rechaza frases inventadas / agregadas
{
  const orig = 'Llegaron a la cima de la montaña al atardecer.';
  const pul = 'Llegaron a la cima de la montaña al atardecer. El paisaje era realmente hermoso y deslumbrante.';
  const res = mismasPalabras(orig, pul);
  comprobar(res.igual === false, `Rechaza texto inventado/añadido (igual=${res.igual}, motivo=${res.motivo})`);
}

// Rechaza texto truncado / cortado
{
  const orig = 'Este es un párrafo largo con muchas ideas importantes que deben ser conservadas en su totalidad hasta el final de la lectura.';
  const pul = 'Este es un párrafo largo con muchas ideas importantes que deben ser conservadas.';
  const res = mismasPalabras(orig, pul);
  comprobar(res.igual === false, `Rechaza texto truncado por la IA (igual=${res.igual}, motivo=${res.motivo})`);
}

console.log('\n--- 3) Gestor de pulido (crearPulidor) con caché y degradación ---');

{
  let llamadasApi = 0;
  const dbPulidos = new Map();

  const pulidor = crearPulidor({
    pulir: async (texto) => {
      llamadasApi += 1;
      return texto.toUpperCase() + '.';
    },
    guardar: async (indice, texto) => {
      dbPulidos.set(indice, texto);
    },
    cargar: async (indice) => {
      return dbPulidos.get(indice) || null;
    },
  });

  const parte0 = { titulo: 'Cap 1', texto: 'primer capitulo para probar' };

  // Primera obtención: llama a pulir y guarda
  const res1 = await pulidor.obtener(0, parte0);
  comprobar(res1 === 'PRIMER CAPITULO PARA PROBAR.', 'Obtiene texto pulido verificado por guardián');
  comprobar(llamadasApi === 1, 'Llama a la función de pulir una vez');
  comprobar(dbPulidos.has(0), 'Guarda en el almacenamiento de pulidos');

  // Segunda obtención en la misma sesión: usa memoria sin volver a llamar
  const res2 = await pulidor.obtener(0, parte0);
  comprobar(res2 === 'PRIMER CAPITULO PARA PROBAR.', 'Segunda lectura devuelve desde memoria');
  comprobar(llamadasApi === 1, 'No repite la llamada API si ya está en memoria');

  // Precarga del siguiente capítulo
  const parte1 = { titulo: 'Cap 2', texto: 'segundo capitulo en cola' };
  pulidor.precargar(1, parte1);
  // Esperar a que la microtarea termine
  await new Promise((r) => setTimeout(r, 50));
  comprobar(pulidor.estaPulido(1), 'Precarga el siguiente capítulo en segundo plano');
  comprobar(llamadasApi === 2, 'Llama a la API para el capítulo precargado');
}

if (fallos > 0) {
  console.error(`\n❌ ${fallos} prueba(s) fallaron.`);
  process.exit(1);
} else {
  console.log('\n✅ Todas las pruebas de troceo y guardián pasaron correctamente.');
}
