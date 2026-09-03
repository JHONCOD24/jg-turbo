/* JG Turbo · Fusión entre la biblioteca del dispositivo y la de la nube
 *
 * Aquí se decide qué gana cuando el mismo libro cambió en dos sitios. Es la
 * parte más delicada de la sincronización: un error aquí no da un mensaje de
 * error, borra el progreso de alguien. Por eso son funciones puras y con
 * pruebas: entra lo que hay en cada lado, sale el plan de qué mover.
 *
 * La regla es una sola y se puede explicar en una frase: **gana el cambio más
 * reciente**. Leer, reiniciar y borrar son todas acciones del usuario y
 * compiten con la misma vara. Es la que menos sorprende: si acabas de leer en
 * el celular, eso es lo que aparece al abrir el computador.
 *
 * (Sus límites, dichos claro: si el reloj de un dispositivo está muy
 * desajustado, sus cambios pueden ganar o perder mal. Es el compromiso
 * conocido de esta regla; la alternativa —resolver conflictos a mano— es peor
 * para una biblioteca personal.)
 */

const marca = (documento) => Number(documento?.actualizado) || 0;

/** ¿El primero es más reciente que el segundo? */
export function esMasNuevo(a, b) {
  return marca(a) > marca(b);
}

/**
 * Qué hacer con un documento que puede estar en uno de los dos lados.
 * @returns {'subir'|'bajar'|'nada'}
 */
export function decidir(local, remoto) {
  if (!local && !remoto) return 'nada';
  if (local && !remoto) return 'subir';
  if (!local && remoto) return 'bajar';
  if (marca(local) === marca(remoto)) return 'nada';
  return esMasNuevo(local, remoto) ? 'subir' : 'bajar';
}

/**
 * Plan de sincronización entre las dos listas.
 * @returns {{subir:object[], bajar:object[], sinCambios:string[]}}
 */
export function fusionar(locales, remotos) {
  const aqui = new Map();
  for (const documento of locales || []) {
    if (documento && documento.id) aqui.set(documento.id, documento);
  }
  const alla = new Map();
  for (const documento of remotos || []) {
    if (documento && documento.id) alla.set(documento.id, documento);
  }

  const subir = [];
  const bajar = [];
  const sinCambios = [];

  for (const id of new Set([...aqui.keys(), ...alla.keys()])) {
    const local = aqui.get(id) || null;
    const remoto = alla.get(id) || null;
    const que = decidir(local, remoto);
    if (que === 'subir') subir.push(local);
    else if (que === 'bajar') bajar.push(remoto);
    else sinCambios.push(id);
  }

  return { subir, bajar, sinCambios };
}

/**
 * Aplica sobre la biblioteca local los documentos que llegaron de la nube.
 * Devuelve una lista nueva; no modifica la que recibe.
 */
export function aplicarRemotos(locales, llegados) {
  const resultado = new Map();
  for (const documento of locales || []) {
    if (documento && documento.id) resultado.set(documento.id, documento);
  }

  for (const llegado of llegados || []) {
    if (!llegado || !llegado.id) continue;
    const actual = resultado.get(llegado.id);
    /* Un cambio viejo nunca pisa uno más nuevo, ni siquiera un borrado. */
    if (actual && !esMasNuevo(llegado, actual)) continue;
    if (llegado.borrado) resultado.delete(llegado.id);
    else resultado.set(llegado.id, llegado);
  }

  return [...resultado.values()];
}

/**
 * Convierte un documento en una «lápida»: la marca que viaja para que el
 * borrado llegue al otro dispositivo en vez de resucitar en la próxima
 * sincronización. Va sin contenido: no tiene sentido mover el texto de algo
 * que se está borrando.
 */
export function marcarBorrado(documento, ahora = Date.now()) {
  return {
    id: documento?.id,
    borrado: ahora,
    actualizado: ahora,
  };
}
