/* Verificación integral con Playwright: Guía CapCut y navegación en tiempo real
 *   node tests/verificar_pdf_tiempo_real.mjs
 */
import { createServer } from 'node:http';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, extname, resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { crearLibro } from './generarPdfPrueba.mjs';

const AQUI = dirname(fileURLToPath(import.meta.url));
const APP = resolve(AQUI, '..');

const { chromium } = await (async () => {
  const candidatos = [
    resolve(APP, 'node_modules', 'playwright', 'index.mjs'),
    resolve(APP, '..', 'node_modules', 'playwright', 'index.mjs'),
    resolve(APP, '..', 'JG Turbo_OLD', 'node_modules', 'playwright', 'index.mjs'),
  ];
  for (const ruta of candidatos) {
    try { return await import(pathToFileURL(ruta).href); } catch (_) {}
  }
  console.error('FALLO: no se encontró Playwright.');
  process.exit(1);
})();

let fallos = 0;
const comprobar = (condicion, mensaje) => {
  if (condicion) console.log(`OK: ${mensaje}`);
  else { fallos += 1; console.error(`FALLO: ${mensaje}`); }
};

const TIPOS = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.json': 'application/json',
  '.webmanifest': 'application/manifest+json', '.png': 'image/png',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.pdf': 'application/pdf',
  '.mp3': 'audio/mpeg',
};

const servidor = createServer(async (peticion, respuesta) => {
  try {
    const url = new URL(peticion.url, `http://127.0.0.1:${servidor.address()?.port || 8000}`);
    const rutaRelativa = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname).replace(/^\/+/, '');
    const datos = await readFile(join(APP, rutaRelativa));
    respuesta.writeHead(200, { 'Content-Type': TIPOS[extname(rutaRelativa)] || 'application/octet-stream' });
    respuesta.end(datos);
  } catch { respuesta.writeHead(404).end('no encontrado'); }
});

await new Promise((res) => servidor.listen(0, '127.0.0.1', res));
const puerto = servidor.address().port;
const URL_APP = `http://127.0.0.1:${puerto}/`;

const carpetaTmp = await mkdtemp(join(tmpdir(), 'jg-pdf-capcut-'));
const rutaPdf = join(carpetaTmp, 'libro-prueba.pdf');
await crearLibro(rutaPdf, 30);

const navegador = await chromium.launch({ headless: true });
const contexto = await navegador.newContext({ viewport: { width: 1200, height: 800 } });
const pagina = await contexto.newPage();

const erroresJs = [];
pagina.on('pageerror', (err) => erroresJs.push(err.message));

try {
  console.log(`Probando lector en ${URL_APP}`);
  await pagina.goto(URL_APP, { waitUntil: 'domcontentloaded' });
  await pagina.waitForTimeout(600);

  // Abrir pestaña PDF
  await pagina.locator('#tabPdf').click();
  await pagina.waitForTimeout(400);

  // Cargar libro de prueba
  await pagina.locator('#pdfInput').setInputFiles(rutaPdf);
  await pagina.waitForTimeout(300);
  await pagina.locator('#btnPdfRead').click();
  await pagina.waitForFunction(() => {
    const res = document.getElementById('pdfResultArea');
    return res && res.style.display !== 'none';
  }, null, { timeout: 60000 });
  await pagina.waitForTimeout(1200);

  console.log('\n── 1. Guía de lectura viva por líneas (~2 líneas de enfoque) ──');
  const resultadoGuia = await pagina.evaluate(async () => {
    const lectura = document.getElementById('pdfLectura');
    const salida = document.getElementById('pdfOutput');
    const texto = salida ? salida.value || '' : '';
    const parrafos = lectura ? [...lectura.querySelectorAll('p[data-ini]')] : [];
    if (parrafos.length < 2) return { error: 'sin parrafos suficientes' };

    const parrafo1 = parrafos[0];
    const parrafo2 = parrafos[1];
    const textoP1 = texto.slice(Number(parrafo1.dataset.ini), Number(parrafo1.dataset.fin));
    const textoP2 = texto.slice(Number(parrafo2.dataset.ini), Number(parrafo2.dataset.fin));

    // Simular que el TTS está sonando en pdf con 2 bloques acotados
    window.ttsState = window.ttsState || {};
    window.ttsState.sourceId = 'pdf';
    window.ttsState.status = 'playing';
    window.ttsState.queue = [{ text: textoP1 }, { text: textoP2 }];
    window.ttsTextosDeCola = () => [textoP1, textoP2];

    // Simular evento jg-tts-avance para el inicio del bloque 0
    document.dispatchEvent(new CustomEvent('jg-tts-avance', {
      detail: {
        sourceId: 'pdf',
        estado: 'playing',
        sonando: true,
        fraccion: 0.01,
        bloque: 0,
        dentroBloque: 0.05,
        cola: 'tok-linea-test-2',
        caracteres: texto.length,
      }
    }));

    await new Promise(r => setTimeout(r, 80));

    const mark1 = lectura.querySelector('mark.pdf-linea-guia') || lectura.querySelector('mark.pdf-frase-activa') || lectura.querySelector('mark');
    const spanCapcut1 = mark1 ? mark1.querySelector('.pdf-palabra-capcut') : null;
    const textoMark1 = mark1 ? mark1.textContent.trim() : '';

    // Avanzar levemente dentro del mismo tramo de ~2 líneas (unas cuantas palabras dentro de bloque 0)
    document.dispatchEvent(new CustomEvent('jg-tts-avance', {
      detail: {
        sourceId: 'pdf',
        estado: 'playing',
        sonando: true,
        fraccion: 0.02,
        bloque: 0,
        dentroBloque: 0.12,
        cola: 'tok-linea-test-2',
        caracteres: texto.length,
      }
    }));

    await new Promise(r => setTimeout(r, 80));

    const mark2 = lectura.querySelector('mark.pdf-linea-guia') || lectura.querySelector('mark.pdf-frase-activa') || lectura.querySelector('mark');
    const spanCapcut2 = mark2 ? mark2.querySelector('.pdf-palabra-capcut') : null;
    const textoMark2 = mark2 ? mark2.textContent.trim() : '';

    // Avanzar al bloque 1 (siguiente tramo de lectura)
    document.dispatchEvent(new CustomEvent('jg-tts-avance', {
      detail: {
        sourceId: 'pdf',
        estado: 'playing',
        sonando: true,
        fraccion: 0.15,
        bloque: 1,
        dentroBloque: 0.10,
        cola: 'tok-linea-test-2',
        caracteres: texto.length,
      }
    }));

    await new Promise(r => setTimeout(r, 80));

    const mark3 = lectura.querySelector('mark.pdf-linea-guia') || lectura.querySelector('mark.pdf-frase-activa') || lectura.querySelector('mark');
    const textoMark3 = mark3 ? mark3.textContent.trim() : '';

    return {
      hayMarca: !!mark1,
      tieneClaseLinea: mark1 ? mark1.classList.contains('pdf-linea-guia') : false,
      hayPalabraCapcut: !!spanCapcut1 || !!spanCapcut2,
      textoMark1,
      textoMark2,
      textoMark3,
      longitudMarca: textoMark1.length,
      marcasTotales: lectura.querySelectorAll('mark').length,
      spansTotales: lectura.querySelectorAll('.pdf-palabra-capcut').length,
    };
  });

  comprobar(resultadoGuia.hayMarca, 'se genera el elemento mark para la guía de lectura');
  comprobar(resultadoGuia.tieneClaseLinea, 'el elemento mark tiene la clase .pdf-linea-guia');
  comprobar(!resultadoGuia.hayPalabraCapcut, 'NO hay badges .pdf-palabra-capcut (lectura tranquila sin saltos)');
  comprobar(resultadoGuia.marcasTotales === 1, `no hay marcas duplicadas en la vista (${resultadoGuia.marcasTotales})`);
  comprobar(resultadoGuia.spansTotales === 0, `cero spans de palabras que distraigan al lector (${resultadoGuia.spansTotales})`);
  comprobar(resultadoGuia.longitudMarca >= 30, `la marca cubre una ventana cómoda de ~2 líneas (${resultadoGuia.longitudMarca} caracteres)`);
  comprobar(resultadoGuia.textoMark1 === resultadoGuia.textoMark2, `la marca permanece estable y tranquila: "${resultadoGuia.textoMark1}" vs "${resultadoGuia.textoMark2}"`);
  comprobar(Boolean(resultadoGuia.textoMark3) && resultadoGuia.textoMark3 !== resultadoGuia.textoMark1, 'la marca avanza fluidamente al siguiente tramo de ~2 líneas al continuar la narración');

  console.log('\n── 2. Navegación de páginas en tiempo real mientras suena la voz ──');
  const navPagina = await pagina.evaluate(async () => {
    let ttsLlamadoCon = null;
    const originalHablar = window.ttsHablar;
    window.ttsHablar = (txt, opts) => {
      ttsLlamadoCon = { txt: txt.slice(0, 50), opts };
      return true;
    };

    window.ttsState = { sourceId: 'pdf', status: 'playing', queue: [{ text: 'audio' }] };

    // Cambiar de página con el botón Siguiente
    const btnNext = document.getElementById('btnPdfPagNext');
    if (btnNext && !btnNext.disabled) {
      btnNext.click();
      await new Promise(r => setTimeout(r, 120));
    }

    window.ttsHablar = originalHablar;
    return {
      hablarLlamado: !!ttsLlamadoCon,
      sourceId: ttsLlamadoCon ? ttsLlamadoCon.opts.sourceId : null,
    };
  });

  comprobar(navPagina.hablarLlamado, 'cambiar de página manualmente inicia la lectura de la nueva página en tiempo real');
  comprobar(navPagina.sourceId === 'pdf', 'el sourceId se mantiene en pdf');

  console.log('\n── 3. Navegación de capítulos en tiempo real mientras suena la voz ──');
  const navCapitulo = await pagina.evaluate(async () => {
    let capituloLlamado = false;
    const originalHablar = window.ttsHablar;
    window.ttsHablar = (txt, opts) => {
      capituloLlamado = true;
      return true;
    };

    window.ttsState = { sourceId: 'pdf', status: 'playing', queue: [{ text: 'audio' }] };

    // Cambiar de capítulo usando el botón Siguiente capítulo o la lista de capítulos
    const btnCapNext = document.getElementById('btnPdfNext');
    if (btnCapNext && !btnCapNext.disabled) {
      btnCapNext.click();
      await new Promise(r => setTimeout(r, 200));
    } else {
      const botonesIndice = document.querySelectorAll('#pdfIndiceLista button');
      if (botonesIndice.length > 1) {
        botonesIndice[1].click();
        await new Promise(r => setTimeout(r, 200));
      }
    }

    window.ttsHablar = originalHablar;
    return { capituloLlamado };
  });

  comprobar(navCapitulo.capituloLlamado, 'cambiar de capítulo arranca de inmediato la narración de la nueva parte');

  console.log('\n── 4. Cambio de voz en vivo y evento jg-tts-cambio-voz ──');
  const cambioVoz = await pagina.evaluate(async () => {
    let eventoDisparado = false;
    let valorRecibido = null;
    document.addEventListener('jg-tts-cambio-voz', (e) => {
      eventoDisparado = true;
      valorRecibido = e.detail?.valor;
    }, { once: true });

    // Cambiar voz mediante ttsCambiarVozEnVivo
    if (typeof window.ttsCambiarVozEnVivo === 'function') {
      window.ttsCambiarVozEnVivo('neural:es-CO:male');
    } else {
      const sel = document.querySelector('[data-tts-voice-select]') || document.getElementById('settingsTtsVoiceName');
      if (sel) {
        sel.dispatchEvent(new Event('change', { bubbles: true }));
      }
    }
    await new Promise(r => setTimeout(r, 120));

    return { eventoDisparado, valorRecibido };
  });

  comprobar(cambioVoz.eventoDisparado, `cambiar de voz en vivo dispara jg-tts-cambio-voz al instante (${cambioVoz.valorRecibido})`);

  console.log('\n── 5. Errores de consola JavaScript ──');
  comprobar(erroresJs.length === 0, `sin errores de JavaScript en el navegador (${erroresJs.length})`);
  if (erroresJs.length > 0) console.error('Errores capturados:', erroresJs);

} finally {
  await contexto.close();
  await navegador.close();
  servidor.close();
  await rm(carpetaTmp, { recursive: true, force: true }).catch(() => {});
}

console.log(fallos ? `\n❌ ${fallos} FALLO(S) EN LA VERIFICACIÓN EN TIEMPO REAL` : '\n✔ Verificación en tiempo real y guía CapCut completada con éxito.');
process.exit(fallos ? 1 : 0);
