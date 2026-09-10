/* Sincronía voz-texto en libros reales (guía de lectura).
 * Ejecutar: node tests/test_pdf_guia_sincronia.mjs
 *
 * Lo que caza: la voz NO lee el texto visible, sino una copia transformada
 * (sin "[12]", con "EE. UU." expandido, con comas de más). Cada bloque de
 * voz es unos caracteres más corto o largo que su tramo visible, y esa
 * diferencia se acumulaba: a mitad de capítulo la ventana de búsqueda ya no
 * contenía el sitio real, el ancla fallaba en cascada y el texto se
 * atrasaba varias líneas detrás de la voz (creciente).
 *
 * También caza la interpolación lineal: suponer ritmo parejo por letra
 * ignora que la voz se detiene en comas y puntos (1-2 líneas de error por
 * bloque de 900 letras).
 */

import {
  compactarTexto, situarBloquesTexto, situarBloquesDetallado, rellenarAnclas,
  construirCostos, acumularCostos, posicionPorTiempo, tiempoPorPosicion,
} from '../js/pdf/guiaAnclas.js';
import { prepararParaVoz, textoVozParaAncla, elegirCompactoVoz } from '../js/pdf/vozTexto.js';

let fallos = 0;
function comprobar(condicion, mensaje) {
  if (condicion) console.log(`OK: ${mensaje}`);
  else { fallos += 1; console.error(`FALLO: ${mensaje}`); }
}

/* Imita lo que `prepararParaVoz` + el normalizador le hacen al texto antes
 * de hablarlo: quita llamadas de nota, expande dos abreviaturas típicas y
 * mete una coma prosódica. Es lo mínimo que cambia la longitud sin cambiar
 * las palabras (las expansiones conservan el compacto a trozos). */
function vozDe(tramoVisible) {
  return tramoVisible
    .replace(/\s*\[\d+\]/g, '')
    .replace(/\bEE\.\s*UU\./g, 'Estados Unidos')
    .replace(/\bDr\./g, 'doctor')
    .replace(/\s+pero\s+/g, ', pero ');
}

/* ── 1) Un capítulo realista: 20 bloques con referencias y abreviaturas ── */
{
  const tramos = [];
  for (let k = 0; k < 20; k += 1) {
    tramos.push(
      `Sección ${k} del tratado sobre la niebla espesa que cubría el sendero aquella mañana fría `
      + `mientras los vecinos comentaban el estudio [${k + 1}] del Dr. Méndez sobre EE. UU. `
      + `y sus costumbres, pero nadie se atrevía a salir de casa tan temprano.`,
    );
  }
  const visible = tramos.join(' ');
  const bloquesVoz = tramos.map(vozDe);
  const capC = compactarTexto(visible);
  const listaVoz = bloquesVoz.map((b) => compactarTexto(b).texto);

  // Posición verdadera de cada bloque: compactar lo visible hasta su inicio.
  const verdaderas = [];
  let previo = '';
  tramos.forEach((t) => {
    verdaderas.push(compactarTexto(previo).texto.length);
    previo += (previo ? ' ' : '') + t;
  });

  const { anclas, firmes } = situarBloquesDetallado(capC.texto, listaVoz);
  let maxError = 0;
  let nFirmes = 0;
  anclas.forEach((a, k) => {
    if (a == null) { maxError = Math.max(maxError, 9999); return; }
    maxError = Math.max(maxError, Math.abs(a - verdaderas[k]));
    if (firmes[k]) nFirmes += 1;
  });
  comprobar(maxError <= 60, `20 bloques con transformaciones anclan cerca (error máx ${maxError} ≤ 60)`);
  comprobar(nFirmes >= 18, `casi todo se situó buscando (${nFirmes}/20 firmes, sin cascada de null)`);

  // El envoltorio clásico sigue devolviendo lo mismo.
  const simples = situarBloquesTexto(capC.texto, listaVoz);
  comprobar(JSON.stringify(simples) === JSON.stringify(anclas), 'situarBloquesTexto delega en el detallado');
}

/* ── 2) La deriva acumulada no saca el sitio de la ventana ─────────────── */
{
  // Cada bloque de voz pierde ~15 letras frente a lo visible (notas y
  // adornos que solo existen para el ojo). Tras 20 bloques son ~300 letras
  // de deriva: la ventana vieja (+220) ya no llegaba.
  const tramos = [];
  const voces = [];
  for (let k = 0; k < 20; k += 1) {
    const relleno = `filler nota al margen número ${1000 + k} para truncar `; // ~15 letras que la voz no dice
    tramos.push(`Marcador único ${k} del capítulo largo sobre el río y la montaña. ${relleno}Sigue la prosa normal del párrafo.`);
    voces.push(`Marcador único ${k} del capítulo largo sobre el río y la montaña. Sigue la prosa normal del párrafo.`);
  }
  const visible = tramos.join(' ');
  const capC = compactarTexto(visible);
  const listaVoz = voces.map((b) => compactarTexto(b).texto);
  const { anclas } = situarBloquesDetallado(capC.texto, listaVoz);
  const nulos = anclas.filter((a) => a == null).length;
  comprobar(nulos === 0, `deriva de ~300 letras sin un solo null (${nulos})`);
  const ultimo = anclas[anclas.length - 1];
  const esperado = capC.texto.length - listaVoz[listaVoz.length - 1].length;
  comprobar(ultimo != null && Math.abs(ultimo - esperado) <= 90,
    `el último bloque sigue en su sitio (${ultimo} vs ${esperado})`);
}

/* ── 3) El hueco se reparte según lo que mide cada bloque ──────────────── */
{
  const sinLargos = rellenarAnclas([0, null, 100], 100);
  comprobar(sinLargos.join(',') === '0,50,100', 'sin largos se reparte a partes iguales, como siempre');

  // Bloques de 190/340/560/900: el hueco [0,1000] no es simétrico.
  const pond = rellenarAnclas([0, null, null, 1000], 1000, [190, 340, 560, 900]);
  comprobar(Math.abs(pond[1] - 174) <= 8 && Math.abs(pond[2] - 486) <= 8,
    `reparto ponderado por largo (${pond.join(',')}, esperado ~174,~486)`);
}

/* ── 4) El tiempo no es lineal: las pausas pesan ───────────────────────── */
{
  const real = `${'a'.repeat(390)}. ${'b'.repeat(110)}`;
  const { texto, mapa } = compactarTexto(real);
  const acum = acumularCostos(construirCostos(real, mapa));
  const N = texto.length; // 500
  const lineal = Math.round(N * 0.5);
  const porTiempo = posicionPorTiempo(acum, 0, N, 0.5);
  comprobar(porTiempo > lineal, `la mitad del tiempo cae pasada la mitad de las letras (${porTiempo} > ${lineal}, hay un punto antes)`);
  const deVuelta = tiempoPorPosicion(acum, 0, N, lineal);
  comprobar(deVuelta < 0.5, `la mitad de las letras cuesta menos de media voz (${deVuelta.toFixed(2)} < 0.50)`);
  // Bordes e ida y vuelta.
  comprobar(posicionPorTiempo(acum, 0, N, 0) === 0 && posicionPorTiempo(acum, 0, N, 1) === N,
    'fracción 0/1 cae en los bordes');
  comprobar(tiempoPorPosicion(acum, 0, N, 0) === 0 && tiempoPorPosicion(acum, 0, N, N) === 1,
    'posición borde da fracción borde');
  let vaBien = true;
  for (const f of [0.1, 0.25, 0.5, 0.75, 0.9]) {
    const p = posicionPorTiempo(acum, 0, N, f);
    const f2 = tiempoPorPosicion(acum, 0, N, p);
    if (Math.abs(f2 - f) > 0.06) vaBien = false;
  }
  comprobar(vaBien, 'ida y vuelta tiempo→posición→tiempo cierra (±0.06)');
  // Sin pausas, vuelve a ser lineal (a una letra de redondeo).
  const plano = compactarTexto('abcdefghij'.repeat(10));
  const acumPlano = acumularCostos(construirCostos(plano.texto.split('').join(' '), plano.mapa));
  comprobar(Math.abs(posicionPorTiempo(acumPlano, 0, 100, 0.5) - 50) <= 1, 'sin puntuación el modelo es lineal');
}

/* ── 5) Firmes distingue lo situado de lo interpolado ──────────────────── */
{
  const capC = compactarTexto('abcdefghij klmnopqrst uvwxyz 0123456789').texto;
  const { anclas, firmes } = situarBloquesDetallado(capC,
    ['abcdefghij', 'klmnopqrst', 'uvwxyz0123'].map((b) => compactarTexto(b).texto));
  comprobar(firmes.every(Boolean), 'texto limpio: todo firme');
  const raro = situarBloquesDetallado(capC, ['zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz']);
  comprobar(raro.anclas[0] === null && raro.firmes[0] === false, 'lo inexistente queda pendiente, no inventado');
}

/* ── 6) `#1` → `número 1` no descoloca la guía ───────────────────────────
 * Caso real (Secretos de Copywriting): cada título es `Secreto #N`. La voz
 * inserta la palabra «número». Compactar esa cola tal cual no encuentra la
 * aguja (`secretonumero1` vs `secreto1`) y el cursor avanza de más: la marca
 * queda 1-2 párrafos más abajo de lo que suena. */
{
  const tramos = [];
  for (let k = 1; k <= 20; k += 1) {
    tramos.push(
      `Secreto #${k}: La pieza de texto de ventas más importante que existe `
      + `mientras los vecinos comentaban el estudio del doctor Méndez sobre el oficio `
      + `y nadie se atrevía a salir de casa tan temprano aquella mañana fría.`,
    );
  }
  const visible = tramos.join('\n\n');
  const bloquesVoz = tramos.map((t) => prepararParaVoz(t, 'es'));
  comprobar(bloquesVoz[0].includes('número 1') && !bloquesVoz[0].includes('#'),
    'la voz del fixture dice «número 1», no hashtag');

  const capC = compactarTexto(visible);
  const listaCruda = bloquesVoz.map((b) => compactarTexto(b).texto);
  const { anclas: anclasCrudas, firmes: firmesCrudas } = situarBloquesDetallado(capC.texto, listaCruda);
  const nFirmesCrudas = firmesCrudas.filter(Boolean).length;

  const listaAlin = bloquesVoz.map((b) => {
    const crudo = compactarTexto(b).texto;
    const alin = compactarTexto(textoVozParaAncla(b)).texto;
    return elegirCompactoVoz(crudo, alin, capC.texto);
  });
  const verdaderas = [];
  let acc = '';
  tramos.forEach((t, i) => {
    if (i) acc += '\n\n';
    verdaderas.push(compactarTexto(acc).texto.length);
    acc += t;
  });

  const { anclas, firmes } = situarBloquesDetallado(capC.texto, listaAlin);
  let maxError = 0;
  anclas.forEach((a, k) => {
    if (a == null) { maxError = Math.max(maxError, 9999); return; }
    maxError = Math.max(maxError, Math.abs(a - verdaderas[k]));
  });
  const nFirmes = firmes.filter(Boolean).length;
  comprobar(nFirmes >= 18, `con la alineación, ${nFirmes}/20 bloques se sitúan buscando`);
  comprobar(maxError <= 80, `el error de ancla con «número» insertado es ${maxError} ≤ 80`);
  comprobar(nFirmes > nFirmesCrudas,
    `alinear mejora el anclaje (${nFirmes} firmes vs ${nFirmesCrudas} en crudo)`);
}

console.log(fallos === 0 ? 'TODAS LAS COMPROBACIONES PASARON' : `FALLOS: ${fallos}`);
process.exit(fallos === 0 ? 0 : 1);
