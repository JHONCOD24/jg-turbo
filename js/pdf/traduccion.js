/* JG Turbo · Traducir un documento al español, capítulo por capítulo
 *
 * Traducir un libro entero de golpe son ~40 consultas y varios minutos de
 * espera antes de leer la primera línea. Aquí se hace al revés: se traduce
 * **el capítulo que abres** (segundos) y, mientras lees, se va preparando el
 * siguiente por detrás. Cuando llegas, ya está.
 *
 * Y lo que se traduce **se guarda**: un capítulo se traduce una sola vez en
 * la vida del documento, aunque cierres la app y vuelvas mañana. Eso importa
 * porque cada traducción cuesta una consulta a la clave de IA del usuario.
 *
 * El motor de traducción no vive aquí: se recibe como dependencia (es el
 * mismo de la app, con continuidad entre bloques y glosario).
 */

/** El español no se traduce al español. */
export function necesitaTraduccion(idioma) {
  const codigo = String(idioma || '').trim().toLowerCase().split(/[-_]/)[0];
  if (!codigo) return false;
  return codigo !== 'es';
}

/**
 * @param {object} opciones
 * @param {(texto:string, opciones:object)=>Promise<string>} opciones.traducir motor real
 * @param {(indice:number, texto:string)=>Promise<any>} opciones.guardar caché persistente
 * @param {(indice:number)=>Promise<string|null>} opciones.cargar caché persistente
 * @param {string} opciones.idiomaOrigen idioma detectado del documento
 */
export function crearTraductor({ traducir, guardar, cargar, idiomaOrigen = 'en' }) {
  /* Memoria de esta sesión, para no ir a la base de datos en cada cambio. */
  const listas = new Map();
  /* Traducciones en curso: si dos partes de la interfaz piden el mismo
   * capítulo a la vez, se hace UNA sola llamada y ambas esperan la misma. */
  const enCurso = new Map();
  /* Capítulos que sabemos traducidos de sesiones anteriores, aunque su texto
   * todavía no se haya cargado en memoria. Sirven para pintar el índice. */
  const conocidos = new Set();

  async function traducirParte(indice, parte, alProgresar) {
    const texto = String(parte?.texto || '').trim();
    if (!texto) return '';

    const traducido = await traducir(texto, {
      origen: idiomaOrigen,
      destino: 'es',
      titulo: parte?.titulo || '',
      alProgresar,
    });

    const limpio = String(traducido || '').trim();
    if (!limpio) throw new Error('La traducción volvió vacía. Inténtalo de nuevo.');
    listas.set(indice, limpio);
    /* Si guardar falla (sin espacio, por ejemplo), la traducción sigue
     * sirviendo en esta sesión: no se pierde el trabajo ya hecho. */
    try { await guardar(indice, limpio); } catch (_) { /* se reintentará solo */ }
    return limpio;
  }

  return {
    /** Texto del capítulo en español. Usa lo guardado si ya existe. */
    async obtener(indice, parte, { alProgresar } = {}) {
      if (!parte || !String(parte.texto || '').trim()) return '';
      const enMemoria = listas.get(indice);
      if (enMemoria) return enMemoria;

      const guardado = await cargar(indice).catch(() => null);
      if (guardado) {
        listas.set(indice, guardado);
        return guardado;
      }

      if (enCurso.has(indice)) return enCurso.get(indice);

      const tarea = traducirParte(indice, parte, alProgresar)
        .finally(() => { enCurso.delete(indice); });
      enCurso.set(indice, tarea);
      return tarea;
    },

    /** Deja listo un capítulo por detrás, sin que nadie espere por él. */
    precargar(indice, parte) {
      if (!parte || listas.get(indice) || enCurso.has(indice)) return;
      this.obtener(indice, parte).catch(() => {
        /* Adelantarse es un lujo: si falla, se traducirá al llegar. */
      });
    },

    estaTraducido(indice) {
      return Boolean(listas.get(indice)) || conocidos.has(indice);
    },

    /** Marca como ya traducidos los capítulos guardados en sesiones previas. */
    sembrar(indices) {
      for (const indice of indices || []) conocidos.add(indice);
    },

    idioma: idiomaOrigen,
  };
}
