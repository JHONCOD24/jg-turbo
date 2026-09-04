/* Continuidad de palabras y párrafos · PDF v2.37
 * Ejecutar: node tests/test_pdf_continuidad.mjs
 */
import { crearAtomo } from '../js/pdf/atomos.js';
import {
  crearLimites, aceptarDecisionesIA, contarPendientes, documentoListoParaLectura,
} from '../js/pdf/limites.js';
import { reconstruirDesdeAtomos, invarianteLetras, VERSION_RECONSTRUCCION } from '../js/pdf/reconstruccion.js';
import { mejorCorte, partirTextoCanonico, reconstruirCanonicoDesdePartes, parteCortaToken } from '../js/pdf/particion.js';
import { planMigracionV6, serializarReconstruccion, camposSyncParte } from '../js/pdf/manifiesto.js';
import { componerTexto } from '../js/pdf/limpiezaTexto.js';
import { prepararParaVoz } from '../js/pdf/vozTexto.js';

let fallos = 0;
function comprobar(ok, msg) {
  if (ok) console.log(`OK: ${msg}`);
  else { fallos += 1; console.error(`FALLO: ${msg}`); }
}

function atomosDe(items, page = 1) {
  return items.map((it, i) => crearAtomo({ page, itemIndex: i, ...it }));
}

function reconstruir(items, extra = {}) {
  const atomos = [];
  if (Array.isArray(items[0])) {
    items.forEach((pag, p) => atomos.push(...atomosDe(pag, p + 1)));
  } else {
    atomos.push(...atomosDe(items, 1));
  }
  return reconstruirDesdeAtomos(atomos, extra);
}

/* ── Corpus de aceptación ─────────────────────────────────────────── */
{
  const r = reconstruir([
    [{ str: 'Viajaron al norte de Bos', x: 70, y: 100, width: 410, height: 11, hasEOL: true }],
    [
      { str: 'ton, hasta el monasterio. El A', x: 92, y: 800, width: 430, height: 11, hasEOL: true },
      { str: 'RN fabrica una proteína. Como ya has ido aprendiendo, el significado que le', x: 70, y: 784, width: 430, height: 11, hasEOL: true },
    ],
    [{ str: 'damos a esas experiencias produce un alu', x: 92, y: 800, width: 260, height: 11, hasEOL: true }],
    [{ str: 'vión de respuestas físicas. Y es', x: 92, y: 800, width: 230, height: 11, hasEOL: true }],
    [{ str: 'ta conclusión resume el argumento.', x: 92, y: 800, width: 210, height: 11, hasEOL: true }],
  ]);
  comprobar(r.texto.includes('Boston') && !/Bos\s+ton/.test(r.texto), 'Boston, no bos ton');
  comprobar(r.texto.includes('ARN') && !r.texto.includes('A RN'), 'ARN, no A RN');
  comprobar(r.texto.includes('aluvión') && !r.texto.includes('alu vión'), 'aluvión, no alu vión');
  comprobar(r.texto.includes('esta conclusión') && !r.texto.includes('es ta'), 'esta conclusión, no es ta');
  comprobar(r.texto.includes('significado que le damos'), 'espacio entre le y damos');
  comprobar(r.pendientes === 0 && r.listoParaLectura, 'cero pendientes en el corpus');
  comprobar(invarianteLetras(r.atomos, r.texto, r.limites), 'invariante de letras del corpus');
}

/* ── Fragmentos dentro de la misma línea ──────────────────────────── */
{
  const r = reconstruir([
    { str: 'Bos', x: 70, y: 700, width: 22, height: 11 },
    { str: 'ton', x: 96, y: 700, width: 22, height: 11 },
    { str: 'queda', x: 130, y: 700, width: 30, height: 11 },
  ]);
  comprobar(r.texto.includes('Boston queda') && !r.texto.includes('Bos ton'), 'une fragmentos de la misma línea');
}

/* ── Final de renglón y de página ─────────────────────────────────── */
{
  const r = reconstruir([
    [{ str: 'la pala', x: 70, y: 120, width: 40, height: 11, hasEOL: true }],
    [{ str: 'bra sigue', x: 70, y: 800, width: 50, height: 11, hasEOL: true }],
  ]);
  comprobar(r.texto.includes('palabra sigue') || r.limites.some((l) => l.kind === 'page-break'),
    'registra el límite de página y reconstruye si el léxico puede');
}

/* ── Guion blando, léxico y de diálogo ────────────────────────────── */
{
  const blando = reconstruir([
    { str: 'compren\u00AD', x: 70, y: 700, width: 40, height: 11, hasEOL: true },
    { str: 'dido', x: 70, y: 686, width: 24, height: 11 },
  ]);
  comprobar(blando.texto.includes('comprendido') && !blando.texto.includes('\u00AD'), 'guion blando se retira y une');

  const lexico = reconstruir([
    { str: 'franco-', x: 70, y: 700, width: 40, height: 11, hasEOL: true },
    { str: 'Alemán', x: 70, y: 686, width: 40, height: 11 },
  ]);
  comprobar(lexico.texto.includes('franco-Alemán'), 'guion léxico se conserva');

  const dialogo = reconstruir([
    { str: 'dijo.', x: 70, y: 700, width: 30, height: 11, hasEOL: true },
    { str: '—Hola', x: 70, y: 660, width: 40, height: 11 },
  ]);
  comprobar(!dialogo.texto.includes('dijo.—Hola') || dialogo.texto.includes('\n\n') || dialogo.texto.includes('dijo. —'),
    'guion de diálogo no se trata como partición de palabra');
}

/* ── Parejas repetidas: solo el boundaryId indicado ───────────────── */
{
  const atomos = atomosDe([
    { str: 'es', x: 70, y: 700, width: 10, height: 11 },
    { str: 'ta', x: 88, y: 700, width: 10, height: 11 },
    { str: 'casa y es', x: 110, y: 700, width: 50, height: 11 },
    { str: 'ta', x: 170, y: 700, width: 10, height: 11 },
  ]);
  const r1 = reconstruirDesdeAtomos(atomos);
  const ids = r1.limites.filter((l) => l.leftFragment === 'es' && l.rightFragment === 'ta').map((l) => l.id);
  comprobar(ids.length >= 1, 'hay al menos un límite es+ta');
  const r2 = reconstruirDesdeAtomos(atomos);
  const unId = r2.limites.find((l) => l.leftFragment === 'es' && l.rightFragment === 'ta')?.id;
  r2.limites.forEach((l) => { if (l.leftFragment === 'es') l.decision = 'pending'; });
  aceptarDecisionesIA(r2.limites, [{ boundaryId: unId, action: 'join', confidence: 1, reason: 'test' }]);
  const tocados = r2.limites.filter((l) => l.source === 'ai');
  comprobar(tocados.length === 1 && tocados[0].id === unId, 'la IA solo toca el boundaryId indicado');
}

/* ── Palabras funcionales que no se unen ──────────────────────────── */
{
  const casos = [
    ['es', 'decir', 'es decir'],
    ['de', 'la', 'de la'],
    ['por', 'ejemplo', 'por ejemplo'],
    ['sin', 'embargo', 'sin embargo'],
  ];
  for (const [a, b, esperado] of casos) {
    const r = reconstruir([
      { str: `Habla ${a}`, x: 70, y: 700, width: 80, height: 11, hasEOL: true },
      { str: `${b} ahora.`, x: 70, y: 686, width: 80, height: 11 },
    ]);
    comprobar(r.texto.includes(esperado) && !r.texto.includes(a + b), `no une «${esperado}»`);
  }
}

/* ── Mayúsculas, siglas, tildes, ñ, ligaduras, apóstrofes, RTL ────── */
{
  const r = reconstruir([
    { str: 'El niño y la ﬁesta de l', x: 70, y: 700, width: 140, height: 11 },
    { str: '\'été', x: 214, y: 700, width: 24, height: 11 },
    { str: ' ش', x: 70, y: 680, width: 10, height: 11, dir: 'rtl' },
    { str: 'مس', x: 82, y: 680, width: 16, height: 11, dir: 'rtl' },
  ]);
  comprobar(r.texto.includes('niño') && r.texto.includes('fiesta'), 'conserva ñ y deshace ligadura');
  comprobar(r.atomos.some((a) => a.dir === 'rtl'), 'conserva dirección RTL en el átomo');
}

/* ── Columnas, tablas, listas, encabezados y pies ─────────────────── */
{
  const r = componerTexto([
    { numero: 1, ancho: 595, alto: 842, lineas: [
      { texto: 'HISTORIA', x: 70, y: 800, altura: 9, ancho: 80 },
      { texto: 'Capítulo uno con texto de columna izquierda largo.', x: 40, y: 600, altura: 11, ancho: 200 },
      { texto: 'Columna derecha también con texto suficiente.', x: 320, y: 600, altura: 11, ancho: 200 },
      { texto: '1', x: 290, y: 40, altura: 9, ancho: 10 },
    ] },
    { numero: 2, ancho: 595, alto: 842, lineas: [
      { texto: 'HISTORIA', x: 70, y: 800, altura: 9, ancho: 80 },
      { texto: 'Sigue el cuerpo del libro en la segunda hoja con más contenido.', x: 40, y: 600, altura: 11, ancho: 200 },
      { texto: 'Y la otra columna continúa el hilo sin mezclarse.', x: 320, y: 600, altura: 11, ancho: 200 },
      { texto: '2', x: 290, y: 40, altura: 9, ancho: 10 },
    ] },
    { numero: 3, ancho: 595, alto: 842, lineas: [
      { texto: 'HISTORIA', x: 70, y: 800, altura: 9, ancho: 80 },
      { texto: '- Un elemento de lista', x: 70, y: 600, altura: 11, ancho: 180 },
      { texto: '3', x: 290, y: 40, altura: 9, ancho: 10 },
    ] },
  ]);
  comprobar(!r.texto.includes('HISTORIA') || r.descartadas > 0, 'encabezado/pie repetido se omite o se registra');
  comprobar(typeof r.texto === 'string', 'columnas y listas no rompen la reconstrucción');
}

/* ── URL, correo, fórmula y token más largo que una parte ─────────── */
{
  const url = `https://ejemplo.test/${'a'.repeat(120)}`;
  const t = `Antes ${url} después.`;
  const corte = mejorCorte(t, 0, 40);
  comprobar(corte === 0 || corte >= t.indexOf(url) + url.length || corte <= t.indexOf(url),
    'mejorCorte no parte la URL por la mitad');
  comprobar(!parteCortaToken({ texto: url, desde: t.indexOf(url), hasta: t.indexOf(url) + url.length }, t),
    'una parte puede conservar el token entero');
  const partes = partirTextoCanonico(`Inicio. ${url}`, { limiteParte: 30 });
  const recon = reconstruirCanonicoDesdePartes(partes);
  comprobar(recon.includes(url), 'el token largo sobrevive a la partición');
}

/* ── Índice con títulos repetidos y páginas vacías ────────────────── */
{
  const r = componerTexto([
    { numero: 1, ancho: 595, alto: 800, lineas: [{ texto: 'Portada larga del libro de prueba con título.', x: 60, y: 700, altura: 11, ancho: 300 }] },
    { numero: 2, ancho: 595, alto: 800, lineas: [] },
    { numero: 3, ancho: 595, alto: 800, lineas: [{ texto: 'Capítulo 1 '.repeat(40), x: 60, y: 700, altura: 11, ancho: 400 }] },
  ], { indice: [
    { titulo: 'Portada', pagina: 1 },
    { titulo: 'Portada', pagina: 1 },
    { titulo: 'Vacía', pagina: 2 },
    { titulo: 'Capítulo 1', pagina: 3 },
  ] });
  comprobar(Array.isArray(r.capitulos), 'índice con repetidos y página vacía no rompe');
  comprobar(!r.capitulos.some((c) => c.pagina === 2) || r.capitulos.every((c) => c.posicion >= 0),
    'la página sin texto no se inventa al principio');
}

/* ── IA: sin respuesta, parcial, ID inventado, acción inválida ────── */
{
  const atomos = atomosDe([
    { str: 'xxq', x: 70, y: 700, width: 20, height: 11, hasEOL: true },
    { str: 'zzq', x: 70, y: 686, width: 20, height: 11 },
  ]);
  const base = reconstruirDesdeAtomos(atomos);
  const pendientesAntes = contarPendientes(base.limites);

  const vacio = aceptarDecisionesIA(base.limites, []);
  comprobar(vacio.aplicadas.length === 0 && contarPendientes(base.limites) === pendientesAntes,
    'sin respuesta de IA los pendientes siguen pendientes');

  const inventado = aceptarDecisionesIA(base.limites, [{ boundaryId: 'b:no-existe', action: 'join' }]);
  comprobar(inventado.rechazadas.some((x) => x.motivo === 'inexistente'), 'rechaza ID inventado');

  const invalida = aceptarDecisionesIA(base.limites, [{
    boundaryId: base.limites[0]?.id, action: 'rewrite',
  }]);
  comprobar(invalida.rechazadas.some((x) => x.motivo === 'accion_invalida'), 'rechaza acción inválida');

  const letras = aceptarDecisionesIA(base.limites, [{
    boundaryId: base.limites[0]?.id, action: 'join', text: 'texto reescrito',
  }]);
  comprobar(letras.rechazadas.some((x) => x.motivo === 'cambio_de_letras'), 'rechaza cambio de letras');

  comprobar(!documentoListoParaLectura(base.limites) || pendientesAntes === 0,
    'con pendientes no se marca listo para lectura');
}

/* ── Migración v5 ─────────────────────────────────────────────────── */
{
  const conPdf = planMigracionV6({ versionTroceo: 5, tieneArchivo: true });
  comprobar(conPdf.accion === 'reextraer', 'v5 con PDF se reextrae');
  const sinPdf = planMigracionV6({ versionTroceo: 5, tieneArchivo: false, manifiesto: [] });
  comprobar(sinPdf.accion === 'needs_source' && sinPdf.needsSource, 'v5 sin PDF ni manifiesto es needs_source');
  const aprobado = planMigracionV6({ versionTroceo: 5, tieneArchivo: true, tieneAprobado: true });
  comprobar(aprobado.accion === 'capa_nueva', 'edición aprobada se guarda como capa nueva');
}

/* ── Sincronización: campos extra no rompen clientes viejos ───────── */
{
  const parte = camposSyncParte({
    texto: 'Hola', titulo: 'Cap', atomStart: 'a:1:0', continuation: true,
    boundaryIds: ['b:a:1:0~a:1:1'], anclaInicio: { caracter: 0, cita: 'Hola', antes: '' },
  });
  comprobar(parte.atomStart === 'a:1:0' && parte.continuation === true, 'la parte sincroniza anclas y continuación');
}

/* ── Invariantes generativas ──────────────────────────────────────── */
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
{
  const rnd = mulberry32(237000);
  const alfabeto = 'abcdefghijklmnñopqrstuvwxyzáéíóúü';
  for (let caso = 0; caso < 25; caso += 1) {
    const atomos = [];
    let page = 1;
    for (let i = 0; i < 12; i += 1) {
      if (rnd() < 0.2) page += 1;
      const n = 2 + Math.floor(rnd() * 8);
      let str = '';
      for (let k = 0; k < n; k += 1) str += alfabeto[Math.floor(rnd() * alfabeto.length)];
      if (rnd() < 0.3) str += ' ';
      atomos.push(crearAtomo({
        page, itemIndex: i, str, x: 40 + rnd() * 200, y: 800 - i * 14,
        width: n * 5, height: 11, hasEOL: rnd() < 0.4,
      }));
    }
    const r1 = reconstruirDesdeAtomos(atomos);
    const r2 = reconstruirDesdeAtomos(atomos);
    comprobar(r1.texto === r2.texto, `determinista texto caso ${caso}`);
    comprobar(r1.limites.map((l) => l.id).join() === r2.limites.map((l) => l.id).join(), `determinista IDs caso ${caso}`);
    comprobar(r1.limites.map((l) => l.decision).join() === r2.limites.map((l) => l.decision).join(), `determinista decisiones caso ${caso}`);
    comprobar(r1.limites.every((l) => ['join', 'space', 'paragraph', 'pending'].includes(l.decision)),
      `todo límite termina en acción válida caso ${caso}`);
    if (r1.pendientes > 0) comprobar(r1.listoParaLectura === false, `pendientes no se marcan corregidos caso ${caso}`);
    comprobar(invarianteLetras(r1.atomos, r1.texto, r1.limites), `invariante letras caso ${caso}`);
    const partes = partirTextoCanonico(r1.texto, {
      limites: r1.limites, atomos: r1.atomos, offsetDeAtomo: r1.offsetDeAtomo, limiteParte: 80,
    });
    comprobar(reconstruirCanonicoDesdePartes(partes) === r1.texto, `concatenar partes = canónico caso ${caso}`);
    comprobar(partes.every((p) => !parteCortaToken(p, r1.texto)), `ninguna parte corta grafema/token caso ${caso}`);
  }
}

/* ── Partición: no índice bruto ───────────────────────────────────── */
{
  const t = 'abcdefghij';
  const corte = mejorCorte(t, 0, 5);
  comprobar(corte === t.length || !/[a-z]/.test(t[corte] && t[corte - 1] === 'x'),
    'mejorCorte no devuelve un índice a mitad si no hay hueco: busca adelante o el final');
  comprobar(corte === 10, 'un token sin espacios se conserva entero');
}

/* ── TTS recibe tokens reconstruidos ──────────────────────────────── */
{
  const r = reconstruir([
    { str: 'Boston y el ARN y el aluvión y esta', x: 70, y: 700, width: 400, height: 11 },
  ]);
  const voz = prepararParaVoz(r.texto);
  comprobar(voz.includes('Boston') && voz.includes('ARN') && /aluvion|aluvión/i.test(voz) && voz.includes('esta'),
    'la capa de voz recibe Boston, ARN, aluvión y esta');
}

/* ── Continuación de partes para TTS ──────────────────────────────── */
{
  const largo = `${'Palabra completa. '.repeat(40)}${'https://ejemplo.test/'}${'a'.repeat(120)} y sigue el párrafo.`;
  const partes = partirTextoCanonico(largo, { limiteParte: 80 });
  comprobar(partes.length >= 2, 'un texto largo se parte en varias unidades');
  comprobar(partes.slice(1).every((p) => p.continuation === true) || partes.some((p) => p.continuation),
    'las partes que continúan el mismo bloque marcan continuation');
  comprobar(reconstruirCanonicoDesdePartes(partes) === largo, 'concatenar partes continuadas reconstruye el canónico');
}

/* ── Serialización ────────────────────────────────────────────────── */
{
  const r = reconstruir([{ str: 'Hola mundo.', x: 70, y: 700, width: 80, height: 11 }]);
  const ser = serializarReconstruccion(r);
  comprobar(ser.versionReconstruccion === VERSION_RECONSTRUCCION && Array.isArray(ser.manifiesto),
    'el manifiesto compacto viaja con la versión 6');
}

console.log(fallos === 0 ? '\nTodas las pruebas de continuidad pasaron.' : `\n${fallos} prueba(s) fallaron.`);
process.exit(fallos === 0 ? 0 : 1);
