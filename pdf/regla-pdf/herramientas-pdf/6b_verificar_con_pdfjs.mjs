/* JG Turbo · Paso 6b · La prueba definitiva
 *
 * Las comprobaciones del paso 6 usan PyMuPDF. Esta usa EL MISMO pdf.js que
 * lleva la app, así que responde a la única pregunta que de verdad importa:
 * ¿qué va a leer JG Turbo cuando el usuario abra este libro?
 *
 *   node 6b_verificar_con_pdfjs.mjs <ruta-al-pdf> <ruta-a-js/vendor/pdfjs>
 *
 * Sale bien cuando: 0 palabras partidas, 0 guiones suaves, 0 dobles espacios,
 * y el número de palabras coincide con bloques.json salvo el índice.
 */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const pdf = process.argv[2];
const vendor = process.argv[3] || './js/vendor/pdfjs';
const pdfjs = await import('file://' + path.resolve(vendor, 'pdf.legacy.min.mjs'));
// Windows: workerSrc como file:// URL (la ruta absoluta «C:\…» rompe el
// cargador ESM en Windows; en Linux es equivalente).
pdfjs.GlobalWorkerOptions.workerSrc = pathToFileURL(path.resolve(vendor, 'pdf.worker.legacy.min.mjs')).href;

const doc = await pdfjs.getDocument({
  data: new Uint8Array(fs.readFileSync(pdf)),
  useSystemFonts: true, isEvalSupported: false,
}).promise;

const lineas = [];
for (let p = 1; p <= doc.numPages; p += 1) {
  const tc = await (await doc.getPage(p)).getTextContent();
  let l = '';
  for (const it of tc.items) {
    if (it.str !== undefined) l += it.str;
    if (it.hasEOL) { lineas.push(l); l = ''; }
  }
  if (l) lineas.push(l);
}
const texto = lineas.join('\n');
fs.writeFileSync('extraccion_pdfjs.txt', texto, 'utf8');

// Normalización documentada de maquetación (igual que 6_verificar B):
// ReportLab puede cerrar un renglón tras el guion de una palabra compuesta.
// Esas no son particiones sin resolver: se recomponen antes de contar.
const textoRecompuesto = texto.replace(
  /([\p{L}\p{N}])-\s*\n\s*([\p{L}\p{N}])/gu, '$1-$2');
const lineasRecompuestas = textoRecompuesto.split('\n');
const partidas = lineasRecompuestas.filter((l) => /[\p{L}]-$/u.test(l)).length;
const suaves = (texto.match(/­/g) || []).length;
const dobles = (texto.match(/ {2}/g) || []).length;
const control = [...texto].filter((c) => c.charCodeAt(0) < 32 && c !== '\n').length;
const palabrasTexto = texto.split(/\s+/).filter(Boolean);

console.log(`páginas            ${doc.numPages}`);
console.log(`líneas             ${lineas.length}`);
console.log(`palabras           ${palabrasTexto.length}`);
console.log(`partidas por guion ${partidas}   ${partidas === 0 ? '✔' : '← MAL'}`);
console.log(`guiones suaves     ${suaves}   ${suaves === 0 ? '✔' : '← MAL'}`);
console.log(`dobles espacios    ${dobles}   ${dobles === 0 ? '✔' : '← MAL'}`);
console.log(`car. de control    ${control}   ${control === 0 ? '✔' : '← MAL'}`);

let defectos = 0;
if (partidas > 0) defectos += 1;
if (suaves > 0) defectos += 1;
if (dobles > 0) defectos += 1;
if (control > 0) defectos += 1;

// Comparar contra bloques.json si está en el directorio de trabajo.
// Estricto (auditoría H6): anclaje por bloques. Cada bloque aprobado debe
// aparecer en el texto que pdf.js extrae, en orden. El PDF lleva portadilla
// e índice REGENERADOS (unas miles de palabras que no están en los bloques):
// ese texto extra conocido se acota al 8 % en vez de exigir identidad global
// (un flujo palabra a palabra no re-sincroniza tras el índice duplicado y
// reporta 100.000 falsos ausentes: medido en El aprendiz de brujo).
const esEstricto = process.env.JG_LOTE === '1' || process.argv.includes('--strict');
const rutaBloques = path.resolve('bloques.json');
if (fs.existsSync(rutaBloques)) {
  try {
    const bloques = JSON.parse(fs.readFileSync(rutaBloques, 'utf8'));
    const textosBloques = bloques.map((b) => (b.txt || b.pie || '')).filter((t) => t.trim());
    console.log(`bloques con texto          : ${textosBloques.length}`);
    const leidas = texto.split(/\s+/).filter(Boolean);
    console.log(`palabras leídas (pdf.js)   : ${leidas.length}`);
    const palabrasEsperadasTotal = textosBloques.join(' ').split(/\s+/).filter(Boolean).length;
    console.log(`palabras esperadas (bloques): ${palabrasEsperadasTotal}`);
    // Volumen direccional: el PDF trae portadilla e índice regenerados
    // (SIEMPRE suma), así que menos palabras que los bloques = PÉRDIDA
    // segura, y más del 10 % = texto inventado. Complementa al anclaje,
    // que no ve páginas borradas entre bloques duplicados.
    if (leidas.length < palabrasEsperadasTotal) {
      console.log(`FALLO: el PDF trae ${palabrasEsperadasTotal - leidas.length} palabras MENOS que los bloques (pérdida) ✘`);
      defectos += 1;
    }
    if (leidas.length > Math.round(palabrasEsperadasTotal * 1.10)) {
      console.log(`FALLO: el PDF trae ${leidas.length - palabrasEsperadasTotal} palabras de más (>10 %, texto inventado) ✘`);
      defectos += 1;
    }

    // Anclar bloque por bloque, de forma INDEPENDIENTE (sin cursor global que
    // arrastre errores ante repeticiones: la bibliografía repite autores y
    // títulos). Cada bloque debe tener su inicio y su final en el leído, en
    // orden y a distancia coherente con su largo (±40 %). Las notas
    // reubicadas también anclan: lo que importa es que el texto esté.
    const LARGO_AGUJA = 12;
    let posPrimerAnclaje = -1;
    const ausentes = [];
    const truncados = [];
    const buscar = (aguja, desde) => {
      // Búsqueda secuencial de la secuencia exacta desde una posición.
      outer: for (let k = desde; k + aguja.length <= leidas.length; k += 1) {
        for (let d = 0; d < aguja.length; d += 1) {
          if (leidas[k + d] !== aguja[d]) continue outer;
        }
        return k;
      }
      return -1;
    };
    // El PRIMER bloque mide el texto previo (portadilla + índice
    // regenerados): acotado al 8 %.
    {
      const primero = (textosBloques[0] || '').split(/\s+/).filter(Boolean).slice(0, LARGO_AGUJA);
      if (primero.length) posPrimerAnclaje = buscar(primero, 0);
    }
    for (const tb of textosBloques) {
      const palabras = tb.split(/\s+/).filter(Boolean);
      if (!palabras.length) continue;
      const aguja = palabras.slice(0, LARGO_AGUJA);
      const pos = buscar(aguja, 0);
      if (pos < 0) {
        ausentes.push(aguja.slice(0, 5).join(' '));
        continue;
      }
      if (palabras.length >= 24) {
        // El final también debe estar DESPUÉS del inicio (sin ventana ni
        // distancia: la verificación secuencial estricta daba falsos
        // positivos con la maquetación; la pérdida real la delatan el
        // volumen direccional y los ausentes).
        const cola = palabras.slice(-LARGO_AGUJA);
        const fin = buscar(cola, pos + aguja.length);
        if (fin < 0) {
          truncados.push(aguja.slice(0, 5).join(' '));
        }
      }
    }
    // Texto previo al contenido (portadilla generada + índice regenerado):
    // acotado al 8 %. Más allá, o el índice se desmadró o falta contenido.
    const totalLeidas = leidas.length || 1;
    const pctPrevio = (posPrimerAnclaje < 0 ? 1 : posPrimerAnclaje / totalLeidas);
    console.log(`bloques no anclados         : ${ausentes.length}`);
    console.log(`bloques truncados           : ${truncados.length}`);
    console.log(`palabras antes del contenido: ${posPrimerAnclaje} (${(pctPrevio * 100).toFixed(1)} %)`);
    if (ausentes.length) {
      console.log(`FALLO: ${ausentes.length} bloques no aparecen en el PDF ✘`);
      console.log(`  ejemplos: ${ausentes.slice(0, 6).join(' || ').slice(0, 300)}`);
      defectos += 1;
    }
    if (truncados.length) {
      console.log(`FALLO: ${truncados.length} bloques con el final ausente (pérdida intermedia) ✘`);
      console.log(`  ejemplos: ${truncados.slice(0, 6).join(' || ').slice(0, 300)}`);
      defectos += 1;
    }
    if (pctPrevio > 0.08) {
      console.log(`FALLO: demasiado texto antes del contenido (${(pctPrevio * 100).toFixed(1)} % > 8 %) ✘`);
      defectos += 1;
    }
    if (!ausentes.length && !truncados.length && pctPrevio <= 0.08) {
      console.log('anclaje por bloques: COMPLETO ✔');
    }
  } catch (err) {
    console.log(`Aviso: error al cotejar bloques.json: ${err.message}`);
    if (esEstricto) defectos += 1;
  }
} else if (esEstricto) {
  console.log('FALLO: modo estricto sin bloques.json para comparar ✘');
  defectos += 1;
}

console.log('\nEscrito extraccion_pdfjs.txt (lo que la app va a leer, tal cual).');

if (defectos > 0) {
  console.error(`\n[FALLO] 6b_verificar_con_pdfjs detectó ${defectos} defecto(s). Proceso rechazado.`);
  process.exit(1);
} else {
  console.log('\n[ÉXITO] 6b_verificar_con_pdfjs completado sin defectos. ✔');
  process.exit(0);
}
