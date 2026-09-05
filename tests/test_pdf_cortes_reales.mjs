/* Cortes encontrados en libros reales, convertidos en casos reproducibles.
 * Cada bloque nace de un indicio medido por tests/test_pdf_reales.mjs
 * contra tests/private/becoming.pdf (431 páginas).
 * Ejecutar: node tests/test_pdf_cortes_reales.mjs */
import { crearAtomo } from '../js/pdf/atomos.js';
import { reconstruirDesdeAtomos, invarianteLetras } from '../js/pdf/reconstruccion.js';

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

console.log('--- palabra partida entre el final de una página y el principio de la siguiente ---');
{
  const r = reconstruir([
    [{ str: 'una palabra extraor-', x: 70, y: 90, width: 180, height: 11, hasEOL: true }],
    [{ str: 'dinaria abre el capítulo', x: 70, y: 700, width: 200, height: 11 }],
  ]);
  comprobar(/extraordinaria/.test(r.texto), 'la palabra partida entre páginas se vuelve a unir');
  comprobar(!/extraor-\s/.test(r.texto), 'no queda el guion de partición');
  comprobar(invarianteLetras(r.atomos, r.texto, r.limites), 'no se pierde ni se inventa ninguna letra');
}

console.log('--- compuesto con guion al final del renglón (self-limiting, becoming.pdf) ---');
{
  /* El libro trae «self» y «limiting» enteras en otros sitios: esa es la
   * evidencia, no una lista escrita. Sin eso, el motor las pegaba en
   * «selflimiting». */
  const r = reconstruir([
    { str: 'The self limiting pattern was self-', x: 70, y: 700, width: 380, height: 11, hasEOL: true },
    { str: 'limiting in daily life', x: 70, y: 686, width: 200, height: 11 },
  ]);
  comprobar(/self-limiting/.test(r.texto), 'conserva el guion del compuesto self-limiting');
  comprobar(!/selflimiting/.test(r.texto), 'no pega selflimiting sin guion');
  comprobar(invarianteLetras(r.atomos, r.texto, r.limites), 'invariante en el compuesto self-limiting');
}

console.log('--- compuesto step-by-step al cortar el renglón (becoming.pdf) ---');
{
  const r = reconstruir([
    { str: 'Follow each step by the step-', x: 70, y: 700, width: 360, height: 11, hasEOL: true },
    { str: 'by-step method shown here', x: 70, y: 686, width: 220, height: 11 },
  ]);
  comprobar(/step-by-step/.test(r.texto), 'conserva los guiones de step-by-step');
  comprobar(!/stepby-step/.test(r.texto), 'no convierte step-by-step en stepby-step');
  comprobar(invarianteLetras(r.atomos, r.texto, r.limites), 'invariante en step-by-step');
}

console.log('--- ordinal 19th-century al cortar el renglón (becoming.pdf) ---');
{
  const r = reconstruir([
    { str: 'a 19th-', x: 70, y: 700, width: 50, height: 11, hasEOL: true },
    { str: 'century idea of the century', x: 70, y: 686, width: 240, height: 11 },
  ]);
  comprobar(/19th-century/.test(r.texto), 'conserva el guion de 19th-century');
  comprobar(!/19thcentury/.test(r.texto) && !/thcentury/.test(r.texto), 'no pega thcentury');
  comprobar(invarianteLetras(r.atomos, r.texto, r.limites), 'invariante en el ordinal');
}

console.log('--- in-depth: ambos lados son palabras, no una sílaba (becoming.pdf) ---');
{
  const r = reconstruir([
    { str: 'an in depth look was in-', x: 70, y: 700, width: 280, height: 11, hasEOL: true },
    { str: 'depth analysis of depth', x: 70, y: 686, width: 220, height: 11 },
  ]);
  comprobar(/in-depth/.test(r.texto), 'conserva el guion de in-depth');
  comprobar(!/\bindepth\b/.test(r.texto), 'no pega indepth');
  comprobar(invarianteLetras(r.atomos, r.texto, r.limites), 'invariante en in-depth');
}

console.log('--- hueco diminuto entre palabras completas (from New, becoming.pdf) ---');
{
  const r = reconstruir([
    { str: 'from', x: 70, y: 700, width: 30, height: 11 },
    { str: 'New', x: 101, y: 700, width: 28, height: 11 },
    { str: 'York', x: 136, y: 700, width: 30, height: 11 },
  ]);
  comprobar(/from New/.test(r.texto), 'no pega fromNew: el hueco pequeño no une palabras completas');
  comprobar(!/fromNew/.test(r.texto), 'fromNew no aparece');
  comprobar(invarianteLetras(r.atomos, r.texto, r.limites), 'invariante en from New');
}

console.log('--- you + Whoa: funcional no se pega por hueco diminuto (becoming.pdf) ---');
{
  const r = reconstruir([
    { str: 'you', x: 70, y: 700, width: 22, height: 11 },
    { str: 'Whoa', x: 93, y: 700, width: 32, height: 11 },
  ]);
  comprobar(/you Whoa/.test(r.texto), 'no pega youWhoa');
  comprobar(!/youWhoa/.test(r.texto), 'youWhoa no aparece');
  comprobar(invarianteLetras(r.atomos, r.texto, r.limites), 'invariante en you Whoa');
}

console.log('--- prefijo de una letra: e-commerce, L-tryptophan (becoming.pdf) ---');
{
  const r = reconstruir([
    { str: 'the e-', x: 70, y: 700, width: 40, height: 11, hasEOL: true },
    { str: 'commerce of commerce today', x: 70, y: 686, width: 240, height: 11 },
  ]);
  comprobar(/e-commerce/.test(r.texto), 'conserva el guion de e-commerce');
  comprobar(!/ecommerce/.test(r.texto), 'no pega ecommerce');
  comprobar(invarianteLetras(r.atomos, r.texto, r.limites), 'invariante en e-commerce');
}

console.log('--- guion blando sigue siendo partición, no compuesto ---');
{
  const r = reconstruir([
    { str: 'compren\u00AD', x: 70, y: 700, width: 40, height: 11, hasEOL: true },
    { str: 'dido el sentido', x: 70, y: 686, width: 90, height: 11 },
  ]);
  comprobar(/comprendido/.test(r.texto), 'el guion blando se retira y une');
  comprobar(!/\u00AD/.test(r.texto), 'no queda el guion blando');
  comprobar(invarianteLetras(r.atomos, r.texto, r.limites), 'invariante del guion blando');
}

console.log('--- extraor- con espacio residual sigue uniendo (no se relaja) ---');
{
  const r = reconstruir([
    { str: 'una palabra extraor- ', x: 70, y: 700, width: 180, height: 11, hasEOL: true },
    { str: 'dinaria abre el capítulo', x: 70, y: 686, width: 200, height: 11 },
  ]);
  comprobar(/extraordinaria/.test(r.texto), 'extraor- con espacio residual se une');
  comprobar(!/extraor-\s/.test(r.texto), 'no deja el guion residual');
  comprobar(invarianteLetras(r.atomos, r.texto, r.limites), 'invariante del guion residual');
}

console.log('--- guion suspendido alpha- and se conserva (no es un corte) ---');
{
  const r = reconstruir([
    { str: 'the alpha- and beta- waves', x: 70, y: 700, width: 260, height: 11 },
  ]);
  comprobar(/alpha- and/.test(r.texto), 'el guion suspendido alpha- and se queda');
  comprobar(!/alphaand/.test(r.texto), 'no pega alphaand');
  comprobar(invarianteLetras(r.atomos, r.texto, r.limites), 'invariante del suspendido');
}

/* RESUELTO (auditoría del cierre): «eartMath», «hatsApp» y «ouTube» NO eran
 * letras caídas. El texto reconstruido dice «HeartMath» 28 veces, «WhatsApp» 1
 * y «YouTube» 4 — comprobado sobre becoming.pdf, contexto real: «Courtesy of
 * the HeartMath® Institute». Los 39 «indicios» salían del patrón de medida,
 * que buscaba minúscula+MAYÚSCULA+minúscula sin anclar a principio de palabra:
 * cualquier marca con mayúscula intercalada se contaba como error.
 *
 * El patrón ya lleva `\b` delante en tests/test_pdf_reales.mjs y esos 39
 * desaparecieron sin tocar el motor, porque nunca hubo nada que arreglar. */

console.log(fallos ? `\n❌ ${fallos} fallos, ${ok} bien.` : `\n✅ Cortes reales: ${ok} comprobaciones bien.`);
process.exit(fallos ? 1 : 0);
