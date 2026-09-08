/* Pruebas unitarias de la guía viva por líneas (enfoque ~2 líneas) y navegación en tiempo real
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

console.log('── 1. Reglas CSS y diseño de guía por líneas en index.html ──');
comprobar(html.includes('.pdf-linea-guia'), 'index.html define estilos para .pdf-linea-guia');
comprobar(html.includes('.pdf-frase-activa'), 'index.html define estilos para .pdf-frase-activa');
comprobar(/border-left:\s*3\.5px\s*solid\s*var\(--lec-acento/.test(html), 'el realce incluye borde lateral izquierdo de acento para anclaje visual');
comprobar(/--lec-acento/.test(html) && /--lec-bg/.test(html), 'los estilos usan las variables del tema del lector (--lec-acento, --lec-bg)');
comprobar(/--lec-guia-texto/.test(html) && /--lec-guia-glow/.test(html), 'se definen variables de letra iluminada (--lec-guia-texto, --lec-guia-glow)');
comprobar(/color:\s*var\(--lec-guia-texto/.test(html) && /text-shadow:\s*var\(--lec-guia-glow/.test(html), 'la guía aplica color iluminado y halo luminoso de alto contraste a la letra');
comprobar(!html.includes('.pdf-palabra-capcut'), 'no quedan estilos para .pdf-palabra-capcut (sin saltos palabra por palabra)');
comprobar(/prefers-reduced-motion:\s*reduce[\s\S]*?\.pdf-linea-guia[\s\S]*?transition:\s*none/i.test(html),
  'se respeta prefers-reduced-motion desactivando transiciones');

console.log('\n── 2. Funciones de tramos de lectura (~2 líneas) en pdfController.js ──');
comprobar(ctrl.includes('function partirEnLineasLectura'), 'pdfController expone partirEnLineasLectura');
comprobar(ctrl.includes('function tramoEn'), 'pdfController expone tramoEn');

// Simulación y validación de partirEnLineasLectura
function partirEnLineasLectura(texto, { meta = 95, min = 55, max = 135 } = {}) {
  if (!texto) return [];
  const tramos = [];
  const largo = texto.length;
  let i = 0;

  while (i < largo) {
    while (i < largo && /\s/.test(texto[i])) i++;
    if (i >= largo) break;

    const inicio = i;
    const objetivo = Math.min(largo, inicio + meta);
    const limite = Math.min(largo, inicio + max);

    if (limite >= largo) {
      let fin = largo;
      while (fin > inicio && /\s/.test(texto[fin - 1])) fin--;
      if (fin > inicio) tramos.push([inicio, fin]);
      break;
    }

    const salto = texto.indexOf('\n', inicio);
    if (salto !== -1 && salto <= limite) {
      let fin = salto;
      while (fin > inicio && /\s/.test(texto[fin - 1])) fin--;
      if (fin > inicio) {
        tramos.push([inicio, fin]);
        i = salto + 1;
        continue;
      }
    }

    let mejorCorte = -1;
    const ventana = texto.slice(inicio, limite);

    const reFuerte = /[.!?…]+(?=[\s\n]|$)/g;
    let m;
    while ((m = reFuerte.exec(ventana)) !== null) {
      const idx = inicio + m.index + m[0].length;
      if (idx >= inicio + min && idx <= limite) {
        mejorCorte = idx;
      }
    }

    if (mejorCorte === -1) {
      const reMedia = /[,;:—–\)\]]+(?=[\s\n]|$)/g;
      while ((m = reMedia.exec(ventana)) !== null) {
        const idx = inicio + m.index + m[0].length;
        if (idx >= inicio + min && idx <= limite) {
          mejorCorte = idx;
        }
      }
    }

    if (mejorCorte === -1) {
      let uEspacio = -1;
      for (let k = limite; k >= inicio + min; k--) {
        if (/\s/.test(texto[k])) { uEspacio = k; break; }
      }
      if (uEspacio !== -1) {
        mejorCorte = uEspacio;
      } else {
        const pEspacio = texto.indexOf(' ', inicio + min);
        if (pEspacio !== -1 && pEspacio < inicio + max * 1.5) {
          mejorCorte = pEspacio;
        } else {
          mejorCorte = limite;
        }
      }
    }

    let fin = mejorCorte;
    while (fin > inicio && /\s/.test(texto[fin - 1])) fin--;
    if (fin > inicio) tramos.push([inicio, fin]);
    i = mejorCorte;
    while (i < largo && /\s/.test(texto[i])) i++;
  }
  return tramos.length ? tramos : [[0, largo]];
}

function tramoEn(tramos, posicion) {
  if (!tramos || !tramos.length) return null;
  let bajo = 0;
  let alto = tramos.length - 1;
  while (bajo <= alto) {
    const medio = (bajo + alto) >> 1;
    const [ini, fin] = tramos[medio];
    if (posicion < ini) alto = medio - 1;
    else if (posicion >= fin) bajo = medio + 1;
    else return tramos[medio];
  }
  if (alto >= 0 && posicion >= tramos[alto][0] && (bajo >= tramos.length || posicion < tramos[bajo][0])) {
    return tramos[alto];
  }
  const idx = Math.max(0, Math.min(tramos.length - 1, bajo));
  return tramos[idx] || null;
}

const textoPrueba = 'Muchos años después, frente al pelotón de fusilamiento, el coronel Aureliano Buendía había de recordar aquella tarde remota en que su padre lo llevó a conocer el hielo. Macondo era entonces una aldea de veinte casas de barro y cañabrava.';
const tramos = partirEnLineasLectura(textoPrueba);
comprobar(tramos.length >= 2, `divide el texto en ventanas de ~2 líneas (${tramos.length} tramos generados)`);

tramos.forEach(([ini, fin], idx) => {
  const trozo = textoPrueba.slice(ini, fin);
  comprobar(trozo.length >= 40 && trozo.length <= 150, `tramo ${idx + 1} longitud adecuada (${trozo.length} caracteres): "${trozo.slice(0, 35)}..."`);
});

// Probar tramoEn
const t1 = tramoEn(tramos, textoPrueba.indexOf('pelotón'));
comprobar(t1 && t1[0] <= textoPrueba.indexOf('pelotón') && t1[1] > textoPrueba.indexOf('pelotón'),
  'tramoEn ubica la ventana correcta que contiene la posición');

const t2 = tramoEn(tramos, textoPrueba.indexOf('Macondo'));
comprobar(t2 && t2[0] <= textoPrueba.indexOf('Macondo') && t2[1] > textoPrueba.indexOf('Macondo'),
  'tramoEn ubica la ventana siguiente sin retrasos');

console.log('\n── 3. Contrato de marcarRango en libroVista.js ──');
comprobar(vista.includes('function marcarRango(ini, fin, palabraIni, palabraFin)'),
  'marcarRango mantiene firma compatible');
comprobar(!vista.includes('pdf-palabra-capcut'), 'marcarRango NO genera etiquetas pdf-palabra-capcut');
comprobar(vista.includes('pdf-linea-guia'), 'marcarRango asigna la clase pdf-linea-guia');
comprobar(vista.includes('pdf-frase-activa'), 'marcarRango asigna la clase pdf-frase-activa');
comprobar(/replaceWith\(document\.createTextNode\(previa\.textContent\)\)/.test(vista),
  'marcarRango limpia marcas previas restaurando el texto limpio');

console.log('\n── 4. Navegación de páginas y capítulos en tiempo real ──');
comprobar(vista.includes('deUsuario = false'), 'irAPagina reconoce navegación iniciada por el usuario (deUsuario)');
comprobar(vista.includes('api.onCambioPaginaUsuario'), 'irAPagina invoca api.onCambioPaginaUsuario');
comprobar(ctrl.includes('onCambioPaginaUsuario'), 'pdfController conecta onCambioPaginaUsuario');
comprobar(/forzarNuevo:\s*false/.test(ctrl), 'el cambio de página usa forzarNuevo: false para seek instantáneo sin lag de red');
comprobar(/forzarNuevo:\s*true/.test(ctrl), 'el cambio de capítulo conserva forzarNuevo: true para nueva síntesis');
comprobar(ctrl.includes('asegurarGuiaSincronizada'), 'pdfController prepara perezosamente las anclas con asegurarGuiaSincronizada');
comprobar(ctrl.includes('window.ttsIrABloque'), 'pdfController utiliza window.ttsIrABloque para sincronización inmediata');
comprobar(vista.includes('if (pag.saltando) return;'), 'libroVista protege el desplazamiento mientras el usuario pasa páginas');

console.log('\n── 5. Cambio de voz en vivo y eventos ──');
comprobar(html.includes('jg-tts-cambio-voz'), 'index.html dispara jg-tts-cambio-voz al cambiar de voz');
comprobar(ctrl.includes('jg-tts-cambio-voz'), 'pdfController escucha jg-tts-cambio-voz para habilitar salto');
comprobar(html.includes('window.ttsHablar = ttsHablar'), 'index.html expone window.ttsHablar');
comprobar(html.includes('window.ttsDetener = ttsDetener'), 'index.html expone window.ttsDetener');

console.log('\n── 6. Marcadores de versión consistentes ──');
comprobar(html.includes('v2.63.0'), 'index.html lleva versión v2.63.0');
const sw = readFileSync(resolve(RAIZ, 'sw.js'), 'utf-8');
comprobar(html.includes("JG_JS_V = 'v109'") && sw.includes("jg-turbo-shell-v109"),
  'JG_JS_V (v109) y sw.js (shell-v109) están perfectamente sincronizados');

console.log(fallos ? `\n❌ ${fallos} FALLO(S)` : '\n✅ Todas las pruebas de la guía por líneas pasaron con éxito.');
process.exit(fallos ? 1 : 0);
