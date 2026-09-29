/* Medición base de bloques de voz (P1.1 del plan 2026-09-29).
 *
 * Extrae los 5 libros de pdf/PDFs Listos/ con el motor real (misma receta
 * que tests/test_pdf_reales.mjs: pdf.js legacy en Node + atomos.js +
 * reconstruccion.js), aplica prepararParaVoz de js/pdf/vozTexto.js y las
 * funciones reales de cola de index.html (ttsNormalizarTextoNarracion,
 * ttsPartirOraciones, ttsPartirTexto, ttsCrearCola…), y mide por libro con
 * bloques Fish (máximo 290, modo unified, como lee el PDF):
 *   - bloques totales (sin contar silencios estructurales)
 *   - % que termina sin signo de cierre (. ! ? … : ;)
 *   - bloques que empiezan en minúscula (continuación de frase)
 *   - bloques de menos de 25 caracteres (títulos sueltos)
 *
 * Ejecutar: node tests/medir_bloques_voz.mjs
 * Línea base esperada (Fish, 290): sin cierre 22,3 / 12,3 / 13,8 / 14,9 / 11,1 %.
 */
import { readFileSync, existsSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { reconstruirDocumento } from '../js/pdf/reconstruccion.js';
import { extraerAtomosDeTextContent } from '../js/pdf/atomos.js';
import { prepararParaVoz } from '../js/pdf/vozTexto.js';

const AQUI = dirname(fileURLToPath(import.meta.url));
const RAIZ = resolve(AQUI, '..');

const LIBROS = [
  { clave: 'Aprendiz', archivo: 'El aprendiz de brujo - Alexa Mohl - JG Turbo.pdf' },
  { clave: 'Placebo', archivo: 'El placebo eres tú - Joe Dispenza - JG Turbo.pdf' },
  { clave: 'Marketing', archivo: 'Esto es marketing - Seth Godin - JG Turbo.pdf' },
  { clave: 'Presuasión', archivo: 'Pre-suasión - Un método revolucionario para influir y persuadir - Robert Cialdini - JG Turbo.pdf' },
  { clave: 'Sobrenatural', archivo: 'Sobrenatural - adaptado para lectura.pdf' },
];

/* Funciones reales de index.html, evaluadas sin tocar. Misma técnica que
 * tests/test_tts_narracion.mjs: se corta en la siguiente declaración de nivel
 * superior y se recorta hasta su último cierre. */
const html = readFileSync(join(RAIZ, 'index.html'), 'utf8');

function extraer(nombre, tipo) {
  const cabecera = tipo === 'function' ? `\nfunction ${nombre}(` : `\nconst ${nombre} `;
  const inicio = html.indexOf(cabecera);
  if (inicio < 0) return null;
  const desde = inicio + 1;
  const siguiente = html.slice(desde + 10).search(/\n(?:function |const |let |var |\/\*\*|window\.)/);
  const hasta = siguiente < 0 ? html.length : desde + 10 + siguiente;
  const bruto = html.slice(desde, hasta);
  const cierre = tipo === 'function' ? bruto.lastIndexOf('}') : bruto.lastIndexOf(';');
  return cierre < 0 ? bruto : bruto.slice(0, cierre + 1);
}

const piezas = [
  ['TTS_ESCALON', 'const'],
  ['TTS_IDIOMAS_VOZ', 'const'],
  ['TTS_EN_WORDS', 'const'],
  ['TTS_ES_WORDS', 'const'],
  ['TTS_ES_SAFE', 'const'],
  ['TTS_ES_ACRONYMS', 'const'],
  ['TTS_ENGLISH_TERMS', 'const'],
  ['TTS_STOPWORDS_IDIOMA', 'const'],
  ['TTS_PISTAS_IDIOMA', 'const'],
  ['TTS_PALABRAS_AMBIGUAS', 'const'],
  ['TTS_STOPWORDS_SET', 'const'],
  ['ttsEscapeRegex', 'function'],
  ['ttsTerminosIngles', 'function'],
  ['ttsLimpiarToken', 'function'],
  ['ttsPareceTokenIngles', 'function'],
  ['ttsDetectarIdiomaFrase', 'function'],
  ['ttsSegmentarTerminosIngles', 'function'],
  ['ttsUnirConectoresIngles', 'function'],
  ['TTS_CONECTORES_CORTE', 'const'],
  ['ttsCorteClausula', 'function'],
  ['ttsPartirOraciones', 'function'],
  ['ttsPartirTexto', 'function'],
  ['ttsNormalizarTextoNarracion', 'function'],
  ['ttsBuscarCorte', 'function'],
  ['ttsEscalonarCola', 'function'],
  ['ttsCrearColaTexto', 'function'],
  ['ttsCrearCola', 'function'],
];

const fuente = [];
for (const [nombre, tipo] of piezas) {
  const trozo = extraer(nombre, tipo);
  if (!trozo) {
    console.error(`FALLO: no se pudo extraer ${nombre} de index.html`);
    process.exit(1);
  }
  fuente.push(trozo);
}

/* jgCfgGet solo aporta el glosario del usuario a ttsTerminosIngles: en la
 * medición no hay glosario, así que devuelve vacío. */
globalThis.jgCfgGet = () => '';

let ttsCrearCola;
try {
  const construir = new Function(`${fuente.join('\n')}\nreturn { ttsCrearCola };`);
  ({ ttsCrearCola } = construir());
} catch (error) {
  console.error(`FALLO: no se pudieron evaluar las funciones de cola — ${error.message}`);
  process.exit(1);
}

const legacy = resolve(RAIZ, 'js/vendor/pdfjs/pdf.legacy.min.mjs');
if (!existsSync(legacy)) {
  console.error('FALLO: falta js/vendor/pdfjs/pdf.legacy.min.mjs (build de PDF.js para Node).');
  process.exit(1);
}
const pdfjs = await import(pathToFileURL(legacy).href);
pdfjs.GlobalWorkerOptions.workerSrc = pathToFileURL(
  resolve(RAIZ, 'js/vendor/pdfjs/pdf.worker.legacy.min.mjs'),
).href;
process.on('unhandledRejection', (e) => { console.error('FALLO: ' + (e?.message || e)); process.exit(1); });

/* Un bloque que termina en `)` o `»` cierra un título o un inciso
 * («Capítulo 2: La sintonía (rapport)», «el patrón «cruzar el umbral»»):
 * no es una frase partida a mitad, así que cuenta como cierre. */
const CIERRE = /[.!?…:;)»"'\]’”]$/u;
/* Cierre prosódico (meta P1.2): la coma también cierra — un corte forzado EN
 * coma es el objetivo, no el defecto. M2 cuenta los bloques sin cierre
 * prosódico a los que sigue voz (la entonación se reinicia a mitad de
 * frase): el defecto V-01 de verdad. */
const CIERRE_VOZ = /[.!?…:,;)»"'\]’”]$/u;
const MINUSCULA = /^[a-záéíóúüñ]/u;

async function medirLibro(archivo) {
  const ruta = join(RAIZ, 'pdf/PDFs Listos', archivo);
  if (!existsSync(ruta)) throw new Error(`no existe ${ruta}`);
  const datos = new Uint8Array(readFileSync(ruta));
  const tarea = pdfjs.getDocument({ data: datos, useSystemFonts: true, isEvalSupported: false });
  const doc = await tarea.promise;
  const atomos = [];
  for (let n = 1; n <= doc.numPages; n += 1) {
    const pagina = await doc.getPage(n);
    const vista = pagina.getViewport({ scale: 1 });
    const tc = await pagina.getTextContent({ includeMarkedContent: true });
    atomos.push(...extraerAtomosDeTextContent(tc, { page: n, viewport: vista }));
    pagina.cleanup();
  }
  await tarea.destroy();
  const r = reconstruirDocumento([], { atomos });
  const textoVoz = prepararParaVoz(r.texto || '', 'es', { neural: true });
  /* Camino real de Escuchar: la capa PDF prepara el texto una sola vez
   * (P1.3) y ttsCrearCola lo normaliza para el motor. */
  const cola = ttsCrearCola(textoVoz, 'es', 290, 'unified') || [];
  const hablados = cola.filter((b) => b && !b.silencio && String(b.text || '').trim());
  const textos = hablados.map((b) => String(b.text || '').trim());
  const sinCierre = textos.filter((t) => !CIERRE.test(t)).length;
  const minuscula = textos.filter((t) => MINUSCULA.test(t)).length;
  const cortos = textos.filter((t) => t.length < 25).length;
  let vozTras = 0;
  for (let i = 0; i < cola.length; i += 1) {
    const b = cola[i];
    if (!b || b.silencio || !String(b.text || '').trim()) continue;
    if (CIERRE_VOZ.test(String(b.text).trim())) continue;
    let j = i + 1;
    while (j < cola.length && !cola[j]) j += 1;
    const sig = cola[j];
    if (sig && !sig.silencio && String(sig.text || '').trim()) vozTras += 1;
  }
  return {
    paginas: doc.numPages,
    atomos: atomos.length,
    bloques: textos.length,
    sinCierre,
    pctSinCierre: textos.length ? (sinCierre / textos.length) * 100 : 0,
    minuscula,
    cortos,
    vozTras,
    pctVozTras: textos.length ? (vozTras / textos.length) * 100 : 0,
  };
}

console.log('Libro | Páginas | Bloques Fish 290 | Sin cierre % (n) | Minúscula inicial (n) | <25 caracteres (n) | Voz tras corte % (n)');
const filas = [];
for (const libro of LIBROS) {
  const m = await medirLibro(libro.archivo);
  filas.push({ libro: libro.clave, ...m });
  console.log(
    `${libro.clave} | ${m.paginas} | ${m.bloques} | ${m.pctSinCierre.toFixed(1)} % (${m.sinCierre}) | ${m.minuscula} | ${m.cortos} | ${m.pctVozTras.toFixed(1)} % (${m.vozTras})`,
  );
}
