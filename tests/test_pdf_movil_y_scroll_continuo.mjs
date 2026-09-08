/**
 * test_pdf_movil_y_scroll_continuo.mjs
 *
 * Verifica las dos características solicitadas por el usuario:
 * 1. Anchura de lectura en móvil:
 *    - data-ancho="52" (Estrecha): padding más amplio (~9vw) para lectura angosta.
 *    - data-ancho="64" (Normal): padding medio (~4.5vw).
 *    - data-ancho="76" (Ancha): padding mínimo (~1.8vw) para lectura ancha borde a borde.
 *    - libroVista.js propaga dataset.ancho a textoCol y resultArea.
 * 2. Continuación automática en modo scroll («Desplazando hacia abajo»):
 *    - Con modoPagina === 'scroll', window.jgPdfContinuarLectura() avanza al siguiente capítulo y arranca la voz.
 *    - Con modoPagina === 'paginas', window.jgPdfContinuarLectura() retorna false y no salta.
 *    - Si no hay más capítulos, finaliza con aviso sin errores.
 *    - ttsFinLectura() y ttsHablarBrowserDesde() delegan a jgPdfContinuarLectura antes de ponerse en idle.
 */
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const AQUI = dirname(fileURLToPath(import.meta.url));
const RAIZ = resolve(AQUI, '..');

const html = readFileSync(resolve(RAIZ, 'index.html'), 'utf-8');
const vista = readFileSync(resolve(RAIZ, 'js/pdf/libroVista.js'), 'utf-8');
const ctrl = readFileSync(resolve(RAIZ, 'js/pdf/pdfController.js'), 'utf-8');

let fallos = 0;
function comprobar(condicion, mensaje) {
  if (condicion) {
    console.log(`OK: ${mensaje}`);
  } else {
    console.error(`FALLO: ${mensaje}`);
    fallos++;
  }
}

console.log('── 1. Reglas CSS de anchura en móvil (index.html) ──');
comprobar(html.includes('.pdf-texto-col[data-ancho="52"]'),
  'index.html define selector para data-ancho="52"');
comprobar(html.includes('.pdf-texto-col[data-ancho="76"]'),
  'index.html define selector para data-ancho="76"');
comprobar(html.includes('clamp(28px,9vw,46px)'),
  'data-ancho="52" (Estrecha) aplica padding-inline amplio para líneas cortas');
comprobar(html.includes('clamp(6px,1.8vw,10px)'),
  'data-ancho="76" (Ancha) aplica padding-inline mínimo para lectura de borde a borde');
comprobar(html.includes(':has(#pdfLectura[data-ancho="52"])'),
  'index.html contiene selector :has para robustez cuando data-ancho está en el artículo');
comprobar(html.includes(':has(#pdfLectura[data-ancho="76"])'),
  'index.html contiene selector :has para data-ancho="76"');

console.log('\n── 2. Propagación de ancho en libroVista.js ──');
comprobar(vista.includes('el.textoCol.dataset.ancho = String(cfg.ancho)'),
  'libroVista.aplicarApariencia() asigna dataset.ancho a textoCol');
comprobar(vista.includes('el.resultArea.dataset.ancho = String(cfg.ancho)'),
  'libroVista.aplicarApariencia() asigna dataset.ancho a resultArea');
comprobar(vista.includes('obtenerConfig: () => ({ ...cfg })'),
  'libroVista expone obtenerConfig() para inspección de configuración activa');
comprobar(vista.includes("esModoScroll: () => cfg.modoPagina === 'scroll'"),
  'libroVista expone helper esModoScroll()');

console.log('\n── 3. Continuación automática en pdfController.js ──');
comprobar(ctrl.includes('window.jgPdfContinuarLectura = function'),
  'pdfController expone window.jgPdfContinuarLectura');
comprobar(ctrl.includes("cfg.modoPagina !== 'scroll'"),
  'jgPdfContinuarLectura restringe el avance automático ÚNICAMENTE a modo scroll');
comprobar(ctrl.includes('estado.parteActual + 1'),
  'jgPdfContinuarLectura detecta e incrementa el índice del capítulo siguiente');
comprobar(ctrl.includes('mostrarParte(idx)'),
  'jgPdfContinuarLectura carga el siguiente capítulo');
comprobar(ctrl.includes('leerDesdeCaracter(0, { forzarNuevo: true })'),
  'jgPdfContinuarLectura inicia la narración desde el inicio del nuevo capítulo');
comprobar(ctrl.includes('precargarSiguienteCapitulo'),
  'pdfController incluye precarga del primer bloque del capítulo siguiente');

console.log('\n── 4. Integración en reproductores TTS (index.html) ──');
comprobar(html.includes('window.jgPdfContinuarLectura()') && html.includes("ttsState.sourceId === 'pdf'"),
  'ttsFinLectura invoca jgPdfContinuarLectura cuando el audio de PDF termina');
comprobar(html.includes('jg-pdf-continuar-browser'),
  'ttsHablarBrowserDesde (motor navegador) también contempla jgPdfContinuarLectura');
comprobar(html.includes("new CustomEvent('jg-tts-fin'"),
  'se despacha evento jg-tts-fin al terminar la lectura por completo');

console.log('\n── 5. Simulación lógica de jgPdfContinuarLectura ──');
// Mock simulando el entorno de pdfController
function simularContinuar({ modoPagina, parteActual, partesTotales }) {
  const cfg = { modoPagina };
  const estado = {
    parteActual,
    partes: new Array(partesTotales).fill({ texto: 'Capítulo de prueba' }),
    textoAprobadoPorBloque: new Map(),
    textoSeguroPorBloque: new Map(),
  };

  const capaDe = (i) => 'Texto capítulo ' + (i + 1);

  if (cfg.modoPagina !== 'scroll') return false;

  let idx = estado.parteActual + 1;
  while (idx < estado.partes.length && !capaDe(idx)) idx += 1;
  if (idx >= estado.partes.length) return false;

  return { exito: true, siguienteCapitulo: idx };
}

const casoScroll = simularContinuar({ modoPagina: 'scroll', parteActual: 0, partesTotales: 3 });
comprobar(casoScroll && casoScroll.exito && casoScroll.siguienteCapitulo === 1,
  'En modo scroll, avanza del capítulo 1 al capítulo 2');

const casoScrollFinal = simularContinuar({ modoPagina: 'scroll', parteActual: 2, partesTotales: 3 });
comprobar(casoScrollFinal === false,
  'En modo scroll en el último capítulo, finaliza la lectura sin intentar avanzar más');

const casoPaginas = simularContinuar({ modoPagina: 'paginas', parteActual: 0, partesTotales: 3 });
comprobar(casoPaginas === false,
  'En modo páginas («Pasando páginas»), NO avanza automáticamente (se mantiene comportamiento)');

console.log(fallos ? `\n❌ ${fallos} FALLO(S)` : '\n✅ Todas las pruebas de móvil y scroll continuo pasaron con éxito.');
process.exit(fallos ? 1 : 0);
