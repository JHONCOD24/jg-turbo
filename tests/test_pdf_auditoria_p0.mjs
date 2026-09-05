/* Pruebas P0 del plan "pulir gramática PDF": aplicarSignos (capa revisadoSeguro),
 * repriorizar del auditor (prioridad capítulo actual) y UI de revisión presente.
 * Ejecutar: node tests/test_pdf_auditoria_p0.mjs
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { aplicarSignos, mismasPalabras, crearAuditorPdf, tokenizarExacto } from '../js/pdf/pulido.js';
import { construirHuella, dividirEnBloquesSemanticos, estadoAuditoriaTexto, estadoCorreccionLecturaTexto } from '../js/pdf/auditoria.js';

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

console.log('--- 1) aplicarSignos: puntuación validada sin tocar palabras ---');
{
  const texto = 'habia una vez un pueblo lejano donde la gente no salia';
  const toks = tokenizarExacto(texto);
  const res = aplicarSignos(texto, toks, [
    { pos: 2, tipo: 'coma', texto: ',' },
    { pos: toks.length - 1, tipo: 'punto', texto: '.' },
  ]);
  comprobar(typeof res === 'string' && res.includes('vez,'), 'Inserta coma tras el token indicado');
  comprobar(res && res.trim().endsWith('.'), 'Inserta punto al final');
  const chequeo = mismasPalabras(texto, res || '');
  comprobar(chequeo.igual, 'El texto con signos preserva 100 % de las palabras');
}
{
  const texto = 'Hola mundo tranquilo';
  const toks = tokenizarExacto(texto);
  comprobar(aplicarSignos(texto, toks, [{ pos: 99, tipo: 'punto', texto: '.' }]) === null,
    'Rechaza pos fuera de rango');
  comprobar(aplicarSignos(texto, toks, [{ pos: 1, tipo: 'palabra', texto: 'hola' }]) === null,
    'Rechaza signos no permitidos (letras)');
  comprobar(aplicarSignos(texto, toks, [{ pos: 1, tipo: 'coma', texto: 'y' }]) === null,
    'Rechaza texto disfrazado de signo');
  const apertura = aplicarSignos(texto, toks, [{ pos: 0, tipo: 'apertura', texto: '¿' }]);
  comprobar(typeof apertura === 'string' && apertura.startsWith('¿Hola'), 'Antepone signos de apertura');
}
{
  const texto = 'perdido en la niebla';
  const toks = tokenizarExacto(texto);
  const res = aplicarSignos(texto, toks, [{ pos: 0, tipo: 'apertura', texto: '¿' }, { pos: 3, tipo: 'cierre', texto: '?' }]);
  comprobar(typeof res === 'string' && res.startsWith('¿') && res.includes('niebla?'), 'Apertura + cierre juntos');
}

console.log('\n--- 2) Auditor: repriorizar mueve el capítulo abierto al frente ---');
{
  const orden = [];
  const auditor = crearAuditorPdf({
    pedirAuditoria: async (bloque) => {
      orden.push(bloque.id);
      await new Promise((r) => setTimeout(r, 15));
      return { signos: [], propuestas: [] };
    },
  });
  const bloques = ['a', 'b', 'c', 'd'].map((id) => ({ id, texto: `texto ${id}` }));
  auditor.encolar(bloques);
  auditor.iniciar(() => {});
  // Los dos primeros ya arrancaron (concurrencia 2); el capítulo abierto es «d».
  auditor.repriorizar(['d']);
  const limite = Date.now() + 3000;
  while (orden.length < 4 && Date.now() < limite) {
    await new Promise((r) => setTimeout(r, 20));
  }
  comprobar(orden.slice(0, 2).join(',') === 'a,b', 'La concurrencia 2 no se rompe (a y b en curso)');
  comprobar(orden.indexOf('d') < orden.indexOf('c'), `«d» (capítulo abierto) se audita antes que «c» (orden: ${orden.join(' → ')})`);
  comprobar(orden.length === 4, 'Ningún bloque se perdió ni se duplicó');
}

console.log('\n--- 3) Reanudación: bloques persistentes reconstruyen capítulos ---');
{
  const texto = 'Parrafo uno de la historia inicial.\n\nParrafo dos sigue aqui.\n\nTercero y ultimo parrafo final.';
  const bloques = dividirEnBloquesSemanticos(texto, [], 3000);
  bloques.forEach((b, i) => { b.id = `bloq_${i}`; b.capitulo = i === bloques.length - 1 ? 1 : 0; });
  // simular guardar/cargar (solo los campos ligeros que se persisten)
  const guardados = JSON.parse(JSON.stringify(bloques.map((b) => ({ id: b.id, texto: b.texto, tipo: b.tipo, capitulo: b.capitulo }))));
  comprobar(guardados.length === bloques.length && guardados.at(-1).capitulo === 1,
    'Los bloques persisten id/texto/tipo/capítulo para reanudar tras recargar');
  comprobar(construirHuella(guardados[0].texto) === construirHuella(bloques[0].texto),
    'La huella del bloque persistido coincide: no se re-audita lo ya hecho');
}

console.log('\n--- 4) UI de revisión y backend presentes ---');
{
  const indexHtml = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
  const controller = fs.readFileSync(path.join(__dirname, '../js/pdf/pdfController.js'), 'utf8');
  const backend = fs.readFileSync(path.join(__dirname, '../backend/app.py'), 'utf8');
  comprobar(indexHtml.includes('id="btnPdfRevision"') && indexHtml.includes('id="pdfRevisionHoja"'),
    'index.html tiene botón y hoja de revisión');
  comprobar(indexHtml.includes('pdf-rev-item'), 'index.html tiene estilos de la hoja de revisión');
  comprobar(controller.includes('aplicarSignos'), 'El controlador aplica signos (capa revisadoSeguro real)');
  comprobar(controller.includes('repriorizar'), 'El controlador reprioriza la cola al cambiar de capítulo');
  comprobar(controller.includes('cargarBloquesDocumento'), 'El controlador restaura bloques al reabrir el libro');
  comprobar(controller.includes("fila.huella === construirHuella(actual.texto)"),
    'Una auditoría vieja solo se aplica si la huella todavía coincide con el texto');
  comprobar(backend.includes('@app.post("/api/improve"'), 'Backend local expone el alias /api/improve');
  comprobar(!indexHtml.includes('id="pdfKindle"') && !controller.includes('kindleImport.js'),
    'la interfaz y el controlador ya no incluyen la función Kindle retirada');
  comprobar(indexHtml.includes('Corregir cortes y puntuación del libro')
      && indexHtml.includes('fragmentos de palabras'),
    'el consentimiento explica la corrección de palabras partidas');
  comprobar((controller.match(/pulidor\.obtener\(/g) || []).length === 0,
    'abrir o precargar un capítulo no lanza una segunda corrección fuera de la cola');
  comprobar(controller.includes("estado: 'lectura_segura'")
      && controller.includes('reg.huellaOrigen !== huellaFuente'),
    'el texto corregido se guarda y solo se reutiliza si la fuente coincide');
  comprobar(controller.includes("auditoriaCerrar.addEventListener('click', () => cerrarHojaAuditoria(null))"),
    'cerrar la explicación tiene un evento permanente, incluso después de autorizar');
  comprobar(controller.includes('iniciarCorreccionLibro') && controller.includes('estado.partes.length'),
    'la corrección completa cuenta unidades reales del lector y no renglones del PDF');
  const filtrarCandidatos = indexHtml.indexOf('return candidatos.filter((candidato) =>');
  const limitarCandidatos = indexHtml.indexOf('}).slice(0, 300).map((candidato) =>', filtrarCandidatos);
  comprobar(filtrarCandidatos >= 0 && limitarCandidatos > filtrarCandidatos,
    'cada trozo filtra sus candidatos antes del límite de 300; los cortes tardíos no se pierden');
}

console.log('--- 6) aplicarSignos conserva la forma del texto ---');
{
  /* Un título seguido de su párrafo. Si los saltos se pierden, la voz lee
   * «CAPITULO PRIMERO En un lugar...» de corrido, que es exactamente lo que
   * el usuario reporta como «se lee raro». */
  const texto = 'CAPITULO PRIMERO\n\nEn un lugar de la Mancha vivia un hidalgo\n\nY tenia una espada';
  const toks = tokenizarExacto(texto);
  const res = aplicarSignos(texto, toks, [{ pos: toks.length - 1, tipo: 'punto', texto: '.' }]);

  comprobar(typeof res === 'string', 'devuelve texto');
  comprobar(res.includes('\n\n'), 'conserva los saltos de parrafo');
  comprobar((res.match(/\n\n/g) || []).length === 2, 'conserva LOS DOS saltos, no uno');
  comprobar(res.startsWith('CAPITULO PRIMERO\n\n'), 'el titulo sigue separado del parrafo');
  comprobar(res.trim().endsWith('.'), 'y aun asi aplica el signo pedido');
  comprobar(mismasPalabras(texto, res).igual, 'las palabras se conservan al 100 %');
}
{
  /* El salto simple (dentro de un verso, por ejemplo) también cuenta. */
  const texto = 'Verso primero\nVerso segundo';
  const toks = tokenizarExacto(texto);
  const res = aplicarSignos(texto, toks, [{ pos: 1, tipo: 'coma', texto: ',' }]);
  comprobar(res && res.includes('\n'), 'conserva el salto simple');
  comprobar(res && res.includes('primero,'), 'y coloca la coma donde se pidio');
}
{
  /* El guardián debe DETECTAR que se perdieron los saltos, no aprobarlo. */
  const original = 'TITULO\n\nParrafo del cuerpo';
  const aplastado = 'TITULO Parrafo del cuerpo';
  comprobar(mismasPalabras(original, aplastado).igual === false,
    'mismasPalabras rechaza un texto al que le quitaron los saltos');
}

console.log('--- 7) estados de auditoria honestos ---');
{
  comprobar(estadoAuditoriaTexto(10, 0, 0, 10, false) === 'Esperando permiso',
    'sin consentimiento lo dice claro');
  comprobar(estadoAuditoriaTexto(0, 0, 0, 0, true) === 'Solo local',
    'sin bloques es solo local');
  comprobar(estadoAuditoriaTexto(10, 3, 0, 7, true).includes('3 de 10'),
    'muestra el avance real');

  /* Esto es lo que estaba mal: decia "Cambios por revisar" aunque no hubiera
   * ninguno. Ahora hay que decirle cuantas propuestas hay. */
  comprobar(estadoAuditoriaTexto(10, 10, 0, 0, true, 0) === 'Revisada, sin cambios',
    'terminar sin propuestas NO dice "cambios por revisar"');
  comprobar(estadoAuditoriaTexto(10, 10, 0, 0, true, 4) === '4 sugerencias por revisar',
    'con propuestas dice cuantas');
  comprobar(estadoAuditoriaTexto(10, 10, 0, 0, true, 1) === '1 sugerencia por revisar',
    'una sola sugerencia va en singular');
}

console.log('--- 8) corrección del libro: contador útil y bloques acotados ---');
{
  const parrafos = Array.from({ length: 240 }, (_, i) =>
    `Parrafo ${i} con una idea completa que debe viajar junto y conservar todas sus palabras.`);
  const texto = parrafos.join('\n\n');
  const renglonesEstructurales = Array.from({ length: 4950 }, (_, i) => ({ texto: `renglon ${i}` }));
  const bloques = dividirEnBloquesSemanticos(texto, renglonesEstructurales, 3000);
  comprobar(bloques.length < 20,
    `4.950 renglones estructurales se agrupan en bloques semánticos (${bloques.length})`);
  comprobar(bloques.every((b) => b.texto.length <= 3000),
    'ningún bloque semántico supera el límite de 3.000 caracteres');
  comprobar(estadoCorreccionLecturaTexto(40, 2, 0, true) === 'Corrigiendo lectura 2 de 40',
    'el contador explica que mide partes de lectura');
  comprobar(estadoCorreccionLecturaTexto(40, 39, 1, true) === '1 parte pendiente',
    'los fallos se muestran como partes pendientes, no como una revisión terminada');
  comprobar(estadoCorreccionLecturaTexto(40, 40, 0, true) === 'Libro corregido',
    'el final exitoso queda explícito');
  const indexHtml = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
  const controller = fs.readFileSync(path.join(__dirname, '../js/pdf/pdfController.js'), 'utf8');
  comprobar(controller.includes('crearColaDesdePartes') && controller.includes('prepararReanudacion'),
    'la corrección usa cola persistente y se puede reanudar');
  comprobar(controller.includes('finalizarCorreccionLibro') && controller.includes('borrarTraduccionesDe'),
    'al terminar reconstruye el libro y actualiza traducción');
  comprobar(indexHtml.includes('Reanudar corrección') && indexHtml.includes('btnPdfReanudarCorreccion'),
    'la interfaz ofrece Reanudar corrección');
  comprobar(indexHtml.includes('jgCorregirBloqueLectura') && !/mode === 'lectura'\) return \{ text: txtLimpio/.test(indexHtml),
    'un fallo de red en lectura ya no se devuelve como texto original');
}

if (fallos > 0) {
  console.error(`\n❌ ${fallos} prueba(s) fallaron.`);
  process.exit(1);
} else {
  console.log('\n✅ Todas las pruebas P0 de auditoría editorial pasaron.');
}
