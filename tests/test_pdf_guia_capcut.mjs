/* Pruebas unitarias de la guía viva estilo CapCut y navegación en tiempo real
 * Ejecutar: node tests/test_pdf_guia_capcut.mjs
 */
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const AQUI = dirname(fileURLToPath(import.meta.url));
const RAIZ = resolve(AQUI, '..');

let fallos = 0;
function comprobar(condicion, mensaje) {
  if (condicion) console.log(`OK: ${mensaje}`);
  else { fallos += 1; console.error(`FALLO: ${mensaje}`); }
}

const html = readFileSync(resolve(RAIZ, 'index.html'), 'utf-8');
const ctrl = readFileSync(resolve(RAIZ, 'js/pdf/pdfController.js'), 'utf-8');
const vista = readFileSync(resolve(RAIZ, 'js/pdf/libroVista.js'), 'utf-8');

console.log('── 1. Reglas CSS y diseño CapCut en index.html ──');
comprobar(html.includes('.pdf-palabra-capcut'), 'index.html define estilos para .pdf-palabra-capcut');
comprobar(html.includes('.pdf-frase-activa'), 'index.html define estilos para .pdf-frase-activa');
comprobar(/--lec-acento/.test(html) && /--lec-bg/.test(html), 'los estilos usan las variables del tema del lector (--lec-acento, --lec-bg)');
comprobar(/transform:\s*scale\(1\.0[56]\)/.test(html), 'el estilo CapCut aplica realce cinético scale a la palabra activa');
comprobar(/prefers-reduced-motion:\s*reduce[\s\S]*?\.pdf-palabra-capcut[\s\S]*?transform:\s*none/i.test(html),
  'se respeta prefers-reduced-motion desactivando transformaciones');

console.log('\n── 2. Funciones de palabras en pdfController.js ──');
comprobar(ctrl.includes('function partirEnPalabras'), 'pdfController expone partirEnPalabras');
comprobar(ctrl.includes('function palabraEn'), 'pdfController expone palabraEn');

// Simulación y validación de partirEnPalabras
function partirEnPalabras(texto) {
  try {
    if (typeof Intl !== 'undefined' && Intl.Segmenter) {
      const seg = new Intl.Segmenter('es', { granularity: 'word' });
      const trozos = [];
      for (const s of seg.segment(texto)) {
        if (s.isWordLike) trozos.push([s.index, s.index + s.segment.length]);
      }
      if (trozos.length) return trozos;
    }
  } catch (_) {}
  const trozos = [];
  const re = /[\p{L}\p{N}]+/gu;
  let m;
  while ((m = re.exec(texto))) trozos.push([m.index, m.index + m[0].length]);
  return trozos;
}

function palabraEn(palabras, posicion) {
  if (!palabras || !palabras.length) return null;
  let bajo = 0;
  let alto = palabras.length - 1;
  while (bajo <= alto) {
    const medio = (bajo + alto) >> 1;
    const [ini, fin] = palabras[medio];
    if (posicion < ini) alto = medio - 1;
    else if (posicion >= fin) bajo = medio + 1;
    else return palabras[medio];
  }
  if (alto >= 0 && posicion >= palabras[alto][0] && (bajo >= palabras.length || posicion < palabras[bajo][0])) {
    return palabras[alto];
  }
  const idx = Math.max(0, Math.min(palabras.length - 1, bajo));
  return palabras[idx] || null;
}

const textoPrueba = '¡Hola! Este es un texto con acentos: revolución y 2026.';
const palabras = partirEnPalabras(textoPrueba);
comprobar(palabras.length >= 8, `extrae palabras correctamente (${palabras.length} encontradas)`);

const palabrasTexto = palabras.map(([i, f]) => textoPrueba.slice(i, f));
comprobar(palabrasTexto.includes('Hola'), 'incluye "Hola" ignorando signos');
comprobar(palabrasTexto.includes('revolución'), 'preserva tildes como "revolución"');
comprobar(palabrasTexto.includes('2026'), 'preserva números como "2026"');

// Probar palabraEn
const p1 = palabraEn(palabras, textoPrueba.indexOf('revolución') + 2);
comprobar(p1 && textoPrueba.slice(p1[0], p1[1]) === 'revolución', 'palabraEn ubica la palabra exacta dentro de sus límites');

const pEspacio = palabraEn(palabras, textoPrueba.indexOf('Este') - 1);
comprobar(pEspacio != null, 'palabraEn no se descoloca en espacios entre palabras');

console.log('\n── 3. Contrato de marcarRango en libroVista.js ──');
comprobar(vista.includes('function marcarRango(ini, fin, palabraIni, palabraFin)'),
  'marcarRango acepta rango de frase y rango de palabra');
comprobar(vista.includes('pdf-palabra-capcut'), 'marcarRango genera la etiqueta pdf-palabra-capcut');
comprobar(vista.includes('pdf-frase-activa'), 'marcarRango asigna la clase pdf-frase-activa a la frase');
comprobar(/replaceWith\(document\.createTextNode\(previa\.textContent\)\)/.test(vista),
  'marcarRango limpia marcas previas restaurando el texto limpio');

console.log('\n── 4. Navegación de páginas y capítulos en tiempo real ──');
comprobar(vista.includes('deUsuario = false'), 'irAPagina reconoce navegación iniciada por el usuario (deUsuario)');
comprobar(vista.includes('api.onCambioPaginaUsuario'), 'irAPagina invoca api.onCambioPaginaUsuario');
comprobar(ctrl.includes('onCambioPaginaUsuario'), 'pdfController conecta onCambioPaginaUsuario');
comprobar(/forzarNuevo:\s*true/.test(ctrl), 'el cambio de página y capítulo solicita forzarNuevo al reproductor');
comprobar(ctrl.includes('window.ttsHablar'), 'pdfController utiliza window.ttsHablar para inicio inmediato');

console.log('\n── 5. Cambio de voz en vivo y eventos ──');
comprobar(html.includes('jg-tts-cambio-voz'), 'index.html dispara jg-tts-cambio-voz al cambiar de voz');
comprobar(ctrl.includes('jg-tts-cambio-voz'), 'pdfController escucha jg-tts-cambio-voz para habilitar salto');
comprobar(html.includes('window.ttsHablar = ttsHablar'), 'index.html expone window.ttsHablar');
comprobar(html.includes('window.ttsDetener = ttsDetener'), 'index.html expone window.ttsDetener');

console.log('\n── 6. Marcadores de versión consistentes ──');
comprobar(html.includes('v2.60.0'), 'index.html lleva versión v2.60.0');
const sw = readFileSync(resolve(RAIZ, 'sw.js'), 'utf-8');
comprobar(html.includes("JG_JS_V = 'v103'") && sw.includes("jg-turbo-shell-v103"),
  'JG_JS_V (v103) y sw.js (shell-v103) están perfectamente sincronizados');

console.log(fallos ? `\n❌ ${fallos} FALLO(S)` : '\n✅ Todas las pruebas de la guía CapCut pasaron con éxito.');
process.exit(fallos ? 1 : 0);
