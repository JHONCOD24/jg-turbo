/* Mapa de lectura: el HTML de la vista tiene que saber de qué parte del texto
 * viene cada bloque. Ejecutar: node tests/test_pdf_mapa_lectura.mjs */
import { bloquesDeTexto, construirLectura, escapar } from '../js/pdf/mapaLectura.js';

let fallos = 0; let ok = 0;
function comprobar(cond, msg) {
  if (cond) { ok += 1; console.log(`OK: ${msg}`); }
  else { fallos += 1; console.error(`FALLO: ${msg}`); }
}

const TEXTO = 'Capítulo 1\n\nEra una tarde larga. Nadie dijo nada.\n\n- primero\n- segundo\n\n'
  + 'Un párrafo final con "comillas" y <etiquetas> peligrosas.';

console.log('--- posiciones exactas ---');
{
  const bloques = bloquesDeTexto(TEXTO);
  comprobar(bloques.length === 4, 'se detectan los cuatro bloques');
  comprobar(bloques.every((b) => TEXTO.slice(b.ini, b.fin) === b.texto),
    'cada bloque se corresponde con su recorte del texto original');
  comprobar(bloques.every((b, i) => i === 0 || b.ini >= bloques[i - 1].fin),
    'los bloques van en orden y no se solapan');
  comprobar(bloques.every((b) => b.fin > b.ini), 'ningún bloque queda vacío');
}

console.log('--- cobertura: fuera de los bloques solo hay separadores ---');
{
  const bloques = bloquesDeTexto(TEXTO);
  let sobrante = TEXTO.slice(0, bloques[0].ini);
  for (let i = 1; i < bloques.length; i += 1) sobrante += TEXTO.slice(bloques[i - 1].fin, bloques[i].ini);
  sobrante += TEXTO.slice(bloques[bloques.length - 1].fin);
  comprobar(/^\s*$/.test(sobrante), 'lo que queda fuera de los bloques son solo espacios y saltos');
}

console.log('--- el HTML lleva las posiciones y escapa el contenido ---');
{
  const html = construirLectura(TEXTO);
  comprobar(/data-ini="\d+"/.test(html) && /data-fin="\d+"/.test(html), 'el HTML trae data-ini y data-fin');
  comprobar(!html.includes('<etiquetas>'), 'el contenido del PDF no se convierte en marcado');
  comprobar(html.includes('&lt;etiquetas&gt;'), 'las etiquetas del texto se muestran escapadas');
  comprobar(!html.includes('Leer desde aquí'), 'la vista no inventa botones dentro del texto');
  const items = html.match(/<li data-ini="\d+" data-fin="\d+">/g) || [];
  comprobar(items.length === 2, 'cada punto de una lista trae su propia posición');
}

console.log('--- casos límite ---');
{
  comprobar(bloquesDeTexto('').length === 0, 'texto vacío: sin bloques');
  comprobar(bloquesDeTexto('   \n\n  \n').length === 0, 'solo espacios: sin bloques');
  comprobar(construirLectura('') === '<p></p>', 'texto vacío: HTML mínimo válido');
  comprobar(escapar('a & b') === 'a &amp; b', 'el ampersand se escapa');
  const largo = 'palabra '.repeat(5000);
  comprobar(bloquesDeTexto(largo)[0].fin === largo.trimEnd().length, 'un bloque enorme conserva su fin');
}

console.log(fallos ? `\n❌ ${fallos} fallos, ${ok} bien.` : `\n✅ Mapa de lectura: ${ok} comprobaciones bien.`);
process.exit(fallos ? 1 : 0);
