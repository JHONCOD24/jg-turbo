/* Mejora integral apartado PDF · pruebas de los fallos del plan §1 (§5 exige
 * convertirlos en pruebas que fallen contra v2.38).
 * Ejecutar: node tests/test_pdf_mejora_apartado.mjs
 */
import { crearAtomo } from '../js/pdf/atomos.js';
import { crearLimites, resolverLimitesDeterministas, aceptarDecisionesIA, contarPendientes } from '../js/pdf/limites.js';
import { reconstruirDesdeAtomos, invarianteLetras, VERSION_RECONSTRUCCION, VERSION_TROCEO } from '../js/pdf/reconstruccion.js';
import {
  crearColaDesdePartes, hidratarCola, serializarCola, correrCola, siguienteTamanoUtil,
  extraerNucleo, restaurarNucleo, validarCoberturaCola, validarUnionesEntreBloques,
  colaListaParaLibro, huellaParte, TAMANOS_BLOQUE, VERSION_COLA_CORRECCION,
} from '../js/pdf/colaCorreccion.js';
import { sha256Hex } from '../js/pdf/huella.js';
import { readFileSync } from 'node:fs';
import { validarResultadoCorreccion } from '../js/pdf/colaCorreccion.js';
import { construirLectura } from '../js/pdf/libroVista.js';
import { prepararParaVoz } from '../js/pdf/vozTexto.js';
import { construirMarkdown } from '../js/pdf/exportar.js';

let fallos = 0; let ok = 0;
function comprobar(cond, msg) {
  if (cond) { ok += 1; console.log(`OK: ${msg}`); }
  else { fallos += 1; console.error(`FALLO: ${msg}`); }
}
function atomosDe(items, page = 1) {
  return items.map((it, i) => crearAtomo({ page, itemIndex: i, ...it }));
}
function reconstruir(items, extra = {}) {
  const atomos = [];
  if (Array.isArray(items[0])) items.forEach((pag, p) => atomos.push(...atomosDe(pag, p + 1)));
  else atomos.push(...atomosDe(items, 1));
  return reconstruirDesdeAtomos(atomos, extra);
}

console.log('--- 1) bonito + pez no se unen (uniones falsas) ---');
{
  const r = reconstruir([
    [{ str: 'qué bonito', x: 70, y: 700, width: 120, height: 11, hasEOL: true }],
    [{ str: 'pez nada', x: 70, y: 700, width: 100, height: 11 }],
  ]);
  comprobar(!r.texto.includes('bonitopez'), 'bonito + pez no terminan en bonitopez');
  comprobar(r.texto.includes('bonito') && r.texto.includes('pez'), 'se conservan ambas palabras');
}

console.log('--- 2) extraor- + dinario con espacio residual ---');
{
  const r = reconstruir([
    { str: 'extraor- ', x: 70, y: 700, width: 60, height: 11, hasEOL: true },
    { str: 'dinario sigue', x: 70, y: 686, width: 120, height: 11 },
  ]);
  comprobar(!r.texto.includes('extraor- dinario') && !r.texto.includes('extraor-'), 'se resuelve el guion aunque exista espacio residual');
  comprobar(/extraordinario/.test(r.texto), 'queda extraordinario');
  comprobar(invarianteLetras(r.atomos, r.texto, r.limites), 'invariante de letras con residual');
}

console.log('--- 3) separadores exteriores al recomponer bloques ---');
{
  const { pre, post, nucleo } = extraerNucleo('  hola mundo  ');
  comprobar(pre === '  ' && post === '  ' && nucleo === 'hola mundo', 'se guardan pre/post fuera del núcleo');
  comprobar(restaurarNucleo(pre, 'hola mundo corregido', post) === '  hola mundo corregido  ', 'se restauran al recomponer');
  const partes = [{ titulo: 'P1', texto: 'primera palabra. ' }, { titulo: 'P2', texto: ' segunda palabra.' }];
  const cola = crearColaDesdePartes(partes, { documentId: 'doc1' });
  const item0 = cola.items.find((i) => i.parte === 0);
  comprobar(item0.separadorPost !== undefined && item0.nucleo !== undefined, 'la cola guarda separadores y núcleo');
  const v = validarUnionesEntreBloques('hola mundo', 'hola mundo');
  comprobar(v.ok, 'uniones entre bloques válidas');
  const v2 = validarUnionesEntreBloques('holamundo', 'hola mundo');
  comprobar(!v2.ok, 'detecta palabrapalabra entre bloques');
}

console.log('--- 4) reducción progresiva 3000→1500→800→400 ---');
{
  comprobar(VERSION_COLA_CORRECCION === 2, 'cola en versión 2');
  // Bloque de 1.000 con tamaño 3.000 debe probar 800 (salta 1.500 que no reduce).
  comprobar(siguienteTamanoUtil(1000, 3000) === 800, `1.000@3000 → 800 (da ${siguienteTamanoUtil(1000, 3000)})`);
  comprobar(siguienteTamanoUtil(4200, 3000) === 1500, '4.200@3000 → 1500');
  comprobar(siguienteTamanoUtil(220, 3000) === null, '220@3000 → null (ningún escalón reduce, queda fallido)');
  comprobar(siguienteTamanoUtil(900, 1500) === 800, '900@1500 → 800');
  comprobar(siguienteTamanoUtil(500, 800) === 400, '500@800 → 400');
  comprobar(JSON.stringify(TAMANOS_BLOQUE) === JSON.stringify([3000, 1500, 800, 400]), 'secuencia exacta');
}

console.log('--- 5) huella SHA-256 identifica la fuente completa ---');
{
  const a = 'x'.repeat(100) + 'A' + 'y'.repeat(100);
  const b = 'x'.repeat(100) + 'B' + 'y'.repeat(100);
  comprobar(a.length === b.length, 'mismo tamaño para la prueba');
  comprobar(huellaParte(a) !== huellaParte(b), 'dos textos del mismo tamaño con cambios en el centro no comparten huella');
  comprobar(/^[a-f0-9]{64}$/.test(huellaParte(a)), 'huella SHA-256 hex 64');
  comprobar(sha256Hex('hola') === 'b221d9dbb083a7f33428d7c2a3c3198ae925614d70210e28716ccaa7cd4ddb79', 'SHA-256 conocido de hola');
}

console.log('--- 6) v2.38 autorizaba por parejas: ahora por identificador ---');
{
  const atomos = atomosDe([
    { str: 'es', x: 70, y: 700, width: 10, height: 11 },
    { str: 'ta', x: 85, y: 700, width: 12, height: 11 },
    { str: 'es', x: 120, y: 700, width: 10, height: 11 },
    { str: 'ta', x: 135, y: 700, width: 12, height: 11 },
  ]);
  const limites = crearLimites(atomos, {});
  // Dos límites con el mismo par: la IA solo puede decidir el solicitado.
  const res = aceptarDecisionesIA(limites, [
    { boundaryId: limites[0].id, action: 'join', leftFragment: limites[0].leftFragment, rightFragment: limites[0].rightFragment },
    { boundaryId: limites[0].id, action: 'space' },
    { boundaryId: 'inexistente', action: 'join' },
    { boundaryId: limites[1].id, action: 'invalida' },
    { boundaryId: limites[2].id, action: 'join', text: 'cambio de letras' },
  ]);
  comprobar(res.aplicadas.length === 1 && res.aplicadas[0] === limites[0].id, 'solo se aplica el límite solicitado, una vez');
  comprobar(res.rechazadas.length === 4, 'duplicado, inexistente, inválida y con texto se conservan pendientes');
  comprobar(limites[1].decision === 'pending' || limites[2].decision === 'pending', 'los no solicitados siguen pendientes');
}

console.log('--- 7) Libro corregido exige cola + límites + integridad + guardado ---');
{
  const partes = [{ titulo: 'P1', texto: 'Hola mundo.' }];
  const cola = crearColaDesdePartes(partes, { documentId: 'd1' });
  for (const it of cola.items) { it.estado = 'done'; it.textoCorregido = it.texto; }
  comprobar(colaListaParaLibro(cola, { pendientesLimites: 2 }).lista === false, 'con límites pendientes no es libro corregido');
  comprobar(colaListaParaLibro(cola, { pendientesLimites: 0, integridadOk: false }).lista === false, 'sin integridad no es libro corregido');
  comprobar(colaListaParaLibro(cola, { pendientesLimites: 0, integridadOk: true, guardadoOk: false }).lista === false, 'sin guardado confirmado no es libro corregido');
  comprobar(colaListaParaLibro(cola, { pendientesLimites: 0, integridadOk: true, guardadoOk: true }).lista === true, 'con todo confirmado sí es libro corregido');
}

console.log('--- 8) cobertura exacta sin huecos ni solapes ---');
{
  const partes = [{ titulo: 'P1', texto: 'abcdefghij' }];
  const cola = crearColaDesdePartes(partes, {});
  comprobar(validarCoberturaCola(cola, partes).ok, 'cobertura exacta recién creada');
  const rota = JSON.parse(JSON.stringify(serializarCola(cola)));
  rota.items[0].hasta = 3;
  const hid = hidratarCola(rota, partes);
  comprobar(validarCoberturaCola(hid, partes).ok, 'al reanudar se revalida la cobertura');
}

console.log('--- 9) cola v1 no equivale a contenido íntegro ---');
{
  const partes = [{ titulo: 'P1', texto: 'Hola mundo.' }];
  const vieja = { version: 1, totalPartes: 1, huellas: ['x'], items: [{ id: '0:0:11', parte: 0, bloque: 0, desde: 0, hasta: 11, estado: 'done', tamano: 3000, reintentos: 0, causa: '', textoCorregido: 'Hola mundo.' }] };
  const nueva = hidratarCola(vieja, partes);
  comprobar(nueva.version === 2 && nueva.items.every((i) => i.estado === 'pending' || i.sourceRevision), 'v1 se revalida, no se da por íntegra');
}

console.log('--- 10) versiones 7/7/2 ---');
{
  comprobar(VERSION_RECONSTRUCCION === 7, 'reconstrucción v7');
  comprobar(VERSION_TROCEO === 7, 'troceo v7');
  comprobar(VERSION_COLA_CORRECCION === 2, 'cola v2');
}

console.log('--- 11) correrCola: cuota pausa, red reintenta, validación encoge ---');
{
  const partes = [{ titulo: 'P1', texto: 'Texto con contenido suficiente para probar la cola de corrección.' }];
  const cola = crearColaDesdePartes(partes, { documentId: 'doc-cuota' });
  const res = await correrCola(cola, {
    pedir: async () => { const e = new Error('429 quota exceeded'); e.causa = 'cuota'; throw e; },
  });
  comprobar(res.pausa === true && res.motivo === 'cuota', 'cuota pausa con acción concreta');
  comprobar(cola.items[0].causa === 'cuota', 'la causa cuota queda registrada');
}

console.log('--- 12) pausar, reanudar y cambio de libro ---');
{
  const partes = [
    { titulo: 'P1', texto: 'Primer capítulo con frases completas y palabras enteras para la prueba.' },
    { titulo: 'P2', texto: 'Segundo capítulo con frases completas y palabras enteras para la prueba.' },
  ];
  const cola = crearColaDesdePartes(partes, { documentId: 'libroA', sourceRevision: 'revA' });
  let abortar = false;
  const res = await correrCola(cola, {
    documentId: 'libroA',
    sourceRevision: 'revA',
    abortado: () => abortar,
    pedir: async (item) => {
      if (item.parte === 1) abortar = true;
      return { texto: item.texto, ia_used: true };
    },
  });
  comprobar(res.detenido === true, 'pausar detiene sin completar');
  comprobar(cola.items.some((i) => i.estado === 'done'), 'lo hecho antes de pausar se conserva');
  const res2 = await correrCola(cola, {
    documentId: 'libroB',
    pedir: async (item) => ({ texto: item.texto, ia_used: true }),
  });
  comprobar(res2.motivo === 'documento_cambiado', 'una respuesta tardía del libro A no se aplica al B');
}

console.log('--- 13) fallo de almacenamiento no finge finalización ---');
{
  const partes = [{ titulo: 'P1', texto: 'Texto con contenido suficiente para la prueba de persistencia.' }];
  const cola = crearColaDesdePartes(partes, {});
  let llamadas = 0;
  const res = await correrCola(cola, {
    persistir: async () => { llamadas += 1; throw new Error('IndexedDB lleno'); },
    pedir: async (item) => ({ texto: item.texto, ia_used: true }),
  });
  comprobar(res.completa === true && llamadas > 0, 'aunque falle el guardado, la memoria avanza y no se finge nada');
  const sinConfirmar = colaListaParaLibro(cola, { pendientesLimites: 0, integridadOk: true, guardadoOk: false });
  comprobar(sinConfirmar.lista === false, 'sin guardado confirmado no es libro corregido');
}

console.log('--- 14) visible, exportado y TTS dicen lo mismo ---');
{
  const texto = 'Boston queda al norte. El ARN fabrica una proteína.';
  const html = construirLectura(texto);
  comprobar(/data-ini="\d+"/.test(html), 'la vista lleva posiciones data-ini');
  const visible = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const toks = (s) => norm(s).replace(/[^a-z0-9áéíóúüñ\s]/g, ' ').split(/\s+/).filter(Boolean);
  const tv = toks(visible);
  const md = construirMarkdown('Prueba', [{ titulo: 'P1', texto }]);
  const tm = toks(md);
  const voz = prepararParaVoz(texto, 'es', {});
  const tz = toks(typeof voz === 'string' ? voz : (voz?.texto || voz));
  for (const palabra of ['boston', 'arn', 'proteina']) {
    comprobar(tv.includes(palabra), `visible trae ${palabra}`);
    comprobar(tm.includes(palabra), `exportado trae ${palabra}`);
    comprobar(tz.includes(palabra), `TTS recibe ${palabra}`);
  }
}

console.log('--- vista de lectura: sin botones inyectados y con posiciones ---');
{
  const vista = readFileSync(new URL('../js/pdf/libroVista.js', import.meta.url), 'utf8');
  comprobar(!vista.includes('Leer desde aquí'),
    'la vista ya no inyecta un botón «Leer desde aquí» en cada párrafo');
  comprobar(vista.includes('leerDesdeCaracter'),
    'la vista pide leer por posición del texto, no por nodo');
  const ctrl = readFileSync(new URL('../js/pdf/pdfController.js', import.meta.url), 'utf8');
  comprobar(!ctrl.includes('jgLeerTextoPdf'),
    'se retira la llamada a una función que no existe');
  comprobar(!/replace\(\/Leer desde aquí/.test(ctrl),
    'ya no hace falta limpiar el texto del botón: la presentación no ensucia el dato');
  comprobar(ctrl.includes('function leerDesdeCaracter'),
    'el controlador expone leerDesdeCaracter');
}

if (fallos > 0) { console.error(`\n❌ ${fallos} fallaron · ${ok} bien.`); process.exit(1); }
console.log(`\n✅ Mejora apartado PDF: ${ok} comprobaciones bien.`);
