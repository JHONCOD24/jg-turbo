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

/**
 * ¿Hace falta volver a subir el TEXTO de este documento, o basta con el
 * registro ligero?
 *
 * Avanzar en la lectura cambia `actualizado` (para que el progreso viaje),
 * pero no cambia `contenidoActualizado`. Distinguirlos es lo que permite
 * sincronizar el avance cada minuto sin resubir un libro de 40 capítulos
 * cada minuto.
 *
 * Un documento sin `contenidoActualizado` es anterior a esta versión: se
 * comporta como antes y sube todo. Preferimos gastar de más una vez a
 * dejar un libro sin texto en el otro dispositivo.
 */
export function necesitaSubirContenido(documento) {
  if (!documento) return false;
  /* Una lápida no lleva capítulos. Un libro que se volvió a extraer encima
   * de una lápida sí: la nube todavía cree que está borrado y no tiene texto. */
  if (estaBorrado(documento)) return false;
  if (documento.borrado) return true;
  const sincronizado = Number(documento.sincronizado) || 0;
  if (!sincronizado) return true;                       /* nunca se subió */
  const contenido = Number(documento.contenidoActualizado) || 0;
  if (!contenido) return true;                          /* registro antiguo */
  return contenido > sincronizado;
}

/**
 * ¿Este registro es una lápida de verdad?
 *
 * El id de un PDF sale del nombre y el tamaño. Borrar y volver a extraer el
 * mismo archivo reutiliza el id. Si `guardarDocumento` mezcla el registro
 * nuevo con la lápida, el campo `borrado` sobrevive: el texto queda en el
 * aparato y la biblioteca lo oculta («se extrae pero no entra»).
 *
 * Un contenido guardado DESPUÉS de la marca de borrado es un libro vivo.
 */
export function estaBorrado(documento) {
  if (!documento || !documento.borrado) return false;
  const marca = Number(documento.borrado) || 0;
  const contenido = Number(documento.contenidoActualizado) || 0;
  if (contenido > marca) return false;
  return true;
}

/**
 * ¿Vale la pena mirar si a este libro le falta enviar la carátula?
 *
 * Es un filtro barato, hecho solo con lo que ya está en memoria, para no
 * consultar la base por cada libro en cada sincronización. Quien diga que sí
 * todavía tiene que confirmarlo mirando si de verdad hay una imagen guardada.
 */
export function puedeFaltarPortada(documento) {
  if (!esSincronizable(documento) || estaBorrado(documento)) return false;
  return !documento.portadaSincronizada;
}

/** `false` explícito significa que el libro no puede salir del dispositivo. */
export function esSincronizable(documento) {
  return Boolean(documento) && documento.sincronizar !== false;
}

/* ── Duplicados: un PDF, un solo registro ────────────────────────────
 *
 * La identidad de un libro era nombre+tamaño. El mismo archivo con otro
 * nombre («libro (1).pdf» que crea Windows al descargar dos veces, o un
 * renombrado en otro aparato) generaba otro id y otra tarjeta: el duplicado
 * se sincronizaba a todos los aparatos y borrar uno dejaba el otro, como si
 * «no se borrara». La huella SHA-256 del archivo sí es estable: a igual
 * contenido, igual huella, aunque cambie el nombre.
 *
 * Estas funciones son puras (sin IndexedDB) para poder probarlas.
 */

/** Normaliza una huella para comparar: minúsculas, solo hex de 64. */
export function normalizarHuella(huella) {
  const texto = String(huella || '').toLowerCase().trim();
  return /^[a-f0-9]{64}$/.test(texto) ? texto : '';
}

/**
 * Título base para cazar duplicados sin huella: quita los sufijos que ponen
 * Windows y Drive al descargar dos veces (« (1)», « - copia», «_1»).
 */
export function tituloBaseParaDedup(titulo) {
  return String(titulo || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\.(pdf|epub|txt)$/i, '')
    .replace(/\s*(\(\d+\)|[-\s_]*copia(\s*\(\d+\))?|[-\s_]*\d+)\s*$/i, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
}

/**
 * Clave de identidad estable de un documento. Manda la huella del archivo;
 * sin ella, tamaño + caracteres + título base (caza el « (1)» de Windows).
 * Sin nada útil, null: mejor no agrupar que unir libros distintos.
 */
export function claveIdentidad(documento) {
  if (!documento || typeof documento !== 'object') return null;
  const huella = normalizarHuella(documento.huella);
  if (huella) return `h:${huella}`;
  const bytes = Number(documento.bytes) || 0;
  const caracteres = Number(documento.caracteres) || 0;
  if (!bytes && !caracteres) return null;
  const base = tituloBaseParaDedup(
    documento.nombreArchivo || documento.titulo || ''
  );
  if (!base) return null;
  return `b:${bytes}|${caracteres}|${base}`;
}

/**
 * Agrupa documentos que son el mismo PDF con distinto id.
 * @returns {object[][]} grupos de 2+ documentos (los solitarios no salen).
 */
export function agruparDuplicados(documentos) {
  const grupos = new Map();
  for (const documento of documentos || []) {
    if (!documento || !documento.id || estaBorrado(documento)) continue;
    const clave = claveIdentidad(documento);
    if (!clave) continue;
    if (!grupos.has(clave)) grupos.set(clave, []);
    grupos.get(clave).push(documento);
  }
  return [...grupos.values()].filter((grupo) => grupo.length > 1);
}

/**
 * De un grupo duplicado elige el registro que sobrevive: el de cambio más
 * reciente (conserva el progreso más nuevo). Los demás se borran con lápida
 * para que el borrado viaje a los otros aparatos.
 * @returns {{conservar:object, eliminar:object[]}}
 */
export function elegirCanonico(grupo) {
  const ordenados = [...grupo].sort(
    (a, b) => (Number(b.actualizado) || 0) - (Number(a.actualizado) || 0)
  );
  return { conservar: ordenados[0], eliminar: ordenados.slice(1) };
}

/**
 * ¿Hay que enviar este libro a la nube?
 *
 * Antes esta decisión vivía suelta dentro de `nube.js` y solo miraba si el
 * libro había cambiado. Por eso las carátulas no llegaban nunca: un libro
 * sincronizado hace meses está «al día», así que quedaba fuera de la lista de
 * envío y la comprobación de su carátula —que estaba DENTRO del bucle sobre
 * esa lista— no llegaba a ejecutarse jamás. La carátula existía en el aparato,
 * el código para enviarla existía, y aun así no salía de ahí.
 *
 * Ahora la regla está aquí, junto a las demás y con pruebas.
 *
 * @param {object|null} local – resumen del documento en este aparato
 * @param {object} opciones
 * @param {string} [opciones.cursor] – marca de la última sincronización
 * @param {object|null} [opciones.remoto] – lo que la nube tiene de este libro
 * @param {boolean} [opciones.faltaPortada] – confirmado: hay carátula sin enviar
 * @returns {boolean}
 */
/**
 * Carátulas que llegaron de la nube y aquí hacen falta.
 *
 * Enviar una carátula no cambia `actualizado`: mandar la tapa de un libro no
 * es haberlo leído. Por eso el receptor comparaba las marcas de tiempo, veía
 * «nada que hacer» y descartaba el documento entero —con la imagen dentro—.
 * La carátula llegaba hasta el navegador y se tiraba.
 *
 * Una carátula no compite con nada: no pisa progreso ni texto, solo añade una
 * imagen que faltaba. Así que se aplica al margen de quién gane el documento.
 * Lo único que no se hace es inventar un libro que aquí no existe: ese lo trae
 * la bajada normal, con su carátula incluida.
 *
 * @param {{id:string, borrado?:number, datos?:object}[]} llegados
 * @param {{id:string, tienePortada?:boolean}[]} locales
 * @returns {{id:string, portadaMini:string}[]}
 */
export function portadasARescatar(llegados, locales) {
  const aqui = new Map();
  for (const documento of locales || []) {
    if (documento && documento.id) aqui.set(documento.id, documento);
  }

  const rescate = [];
  for (const remoto of llegados || []) {
    if (!remoto || !remoto.id || remoto.borrado) continue;
    const mini = remoto.datos?.portadaMini;
    /* Tiene que parecer una imagen: lo que viene de fuera no se guarda a ciegas. */
    if (typeof mini !== 'string' || !mini.startsWith('data:image/')) continue;
    const local = aqui.get(remoto.id);
    if (!local || local.tienePortada) continue;
    rescate.push({ id: remoto.id, portadaMini: mini });
  }
  return rescate;
}

export function debeSubir(local, { cursor = '', remoto = null, faltaPortada = false } = {}) {
  if (!esSincronizable(local)) return false;

  /* Libro que se volvió a extraer encima de una lápida: hay que enviarlo
   * vivo aunque las marcas coincidan con la última sync (esa sync reenvió
   * la lápida por error y dejó actualizado == sincronizado). */
  if (local.borrado && !estaBorrado(local)) return true;

  /* Una carátula pendiente es motivo suficiente por sí sola, pero nunca para
   * un libro borrado: de eso solo viaja la lápida. */
  if (faltaPortada && !estaBorrado(local)) return true;

  /* Con cursor basta comparar contra lo último que se envió desde aquí. */
  if (cursor) return (Number(local.actualizado) || 0) > (Number(local.sincronizado) || 0);

  /* Sin cursor (primera vez, o tras desvincular) manda la comparación con la
   * nube, que es la regla de siempre. */
  return decidir(local, remoto) === 'subir';
}
