/* Ayudante compartido de las pruebas de teléfono.
 *
 * Desde el diseño editorial (2026-09-05) el lector arranca con la pantalla
 * limpia: los controles se apartan al abrir el capítulo y al pasar de página,
 * y vuelven con un toque en el texto. Cualquier prueba que quiera pulsar un
 * control tiene que despertarlo antes, igual que haría una persona.
 *
 * No es un atajo para saltarse el comportamiento: es reproducirlo.
 */

/** Despierta los controles si están apartados. Devuelve true si hizo falta.
 *
 * Primero con el gesto real —un toque en el texto—, que es lo que hace una
 * persona. Si el texto no es alcanzable en ese momento concreto (hay una hoja
 * delante, o la prueba está en otro estado), se quita la clase directamente:
 * el objetivo de esas pruebas es llegar al control, y que el TOQUE despierta
 * el cromo ya lo comprueba `verificar_pdf_movil.mjs`. */
export async function despertarCromo(pagina, intentos = 3) {
  const dormido = () => pagina.evaluate(() => document.body.classList.contains('jg-inmersivo'));
  if (!(await dormido())) return false;
  for (let i = 0; i < intentos; i += 1) {
    await pagina.locator('#pdfLectura').click({ position: { x: 40, y: 40 }, timeout: 3000 }).catch(() => {});
    await pagina.waitForTimeout(420);
    if (!(await dormido())) return true;
  }
  await pagina.evaluate(() => document.body.classList.remove('jg-inmersivo'));
  await pagina.waitForTimeout(320);
  return true;
}

/** Aparta los controles a propósito, para medir la pantalla de lectura. */
export async function apartarCromo(pagina) {
  await pagina.evaluate(() => document.body.classList.add('jg-inmersivo'));
  await pagina.waitForTimeout(320);
}
