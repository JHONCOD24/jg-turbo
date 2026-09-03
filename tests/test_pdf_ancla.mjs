/* Pruebas del ancla de texto: recuperar la posición de lectura aunque el
 * texto haya cambiado de tamaño (pulido, auditoría, traducción).
 * Ejecutar: node tests/test_pdf_ancla.mjs
 */
import { construirAncla, resolverAncla } from '../js/pdf/anclaTexto.js';

let fallos = 0;
function comprobar(condicion, mensaje) {
  if (condicion) console.log(`OK: ${mensaje}`);
  else { fallos += 1; console.error(`FALLO: ${mensaje}`); }
}

const TEXTO = 'Primero vino la duda. Después vino la certeza. Y entonces comprendio que nada volveria a ser igual. Final del capitulo.';

/* ── Construir ────────────────────────────────────────────────────── */
{
  const a = construirAncla(TEXTO, 46);
  comprobar(a.caracter === 46, 'guarda el índice de carácter');
  comprobar(a.cita.length > 0 && TEXTO.includes(a.cita), 'la cita existe en el texto');
  comprobar(typeof a.antes === 'string', 'guarda el fragmento anterior');
}
{
  const a = construirAncla('', 0);
  comprobar(a.caracter === 0 && a.cita === '', 'texto vacío no rompe');
  const b = construirAncla(TEXTO, 99999);
  comprobar(b.caracter <= TEXTO.length, 'un índice fuera de rango se acota');
  const c = construirAncla(TEXTO, -5);
  comprobar(c.caracter === 0, 'un índice negativo se acota a cero');
}

/* ── Resolver sobre el mismo texto ────────────────────────────────── */
{
  const a = construirAncla(TEXTO, 46);
  comprobar(resolverAncla(TEXTO, a) === 46, 'sobre el texto idéntico devuelve el mismo punto');
}

/* ── Resolver cuando el texto cambió ──────────────────────────────── */
{
  /* La auditoría añadió signos: el texto crece y el índice viejo ya no sirve. */
  const a = construirAncla(TEXTO, 46);
  const CAMBIADO = '¡Primero vino la duda! Después, vino la certeza. Y entonces comprendio que nada volveria a ser igual. Final del capitulo.';
  const pos = resolverAncla(CAMBIADO, a);
  const alrededor = CAMBIADO.slice(Math.max(0, pos - 4), pos + 20);
  comprobar(alrededor.includes('Y entonces'), `re-localiza tras cambiar signos (encontró "${alrededor.trim()}")`);
}
{
  /* Un texto completamente distinto: no puede inventar, pero tampoco romper. */
  const a = construirAncla(TEXTO, 46);
  const OTRO = 'Un texto que no tiene absolutamente nada que ver con el anterior.';
  const pos = resolverAncla(OTRO, a);
  comprobar(pos >= 0 && pos <= OTRO.length, 'ante texto distinto devuelve una posición válida');
}
{
  const a = construirAncla(TEXTO, 46);
  comprobar(resolverAncla('', a) === 0, 'texto vacío devuelve 0');
  comprobar(resolverAncla(TEXTO, null) === 0, 'ancla nula devuelve 0');
  comprobar(resolverAncla(TEXTO, { caracter: 20 }) === 20, 'ancla sin cita usa el índice');
}

/* ── El acento y la mayúscula no deben impedir el reencuentro ─────── */
{
  const a = construirAncla(TEXTO, 46);
  const CONTILDES = TEXTO.replace('comprendio', 'comprendió').replace('volveria', 'volvería');
  const pos = resolverAncla(CONTILDES, a);
  comprobar(CONTILDES.slice(pos, pos + 12).includes('Y entonces'), 're-localiza aunque cambien las tildes');
}

console.log(fallos ? `\n${fallos} FALLO(S)` : '\nTodo en verde');
process.exit(fallos ? 1 : 0);
