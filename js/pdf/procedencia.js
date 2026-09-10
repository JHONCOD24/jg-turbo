/* JG Turbo · Procedencia de un libro de la biblioteca.
 *
 * Puro y con pruebas: decide solo con metadatos (título, nombre de archivo
 * y banderas), sin tocar texto, voz ni sincronización.
 *
 * - 'adaptado': texto refluido para JG Turbo (lectura y voz optimizadas).
 * - 'original': PDF tal como vino (al escuchar pueden colarse cabeceras o
 *   partirse palabras; se adapta con pdf/regla-pdf/REGLA ADAPTAR PDF.md).
 * - 'desconocida': no hay señales; la tarjeta no muestra píldora.
 */
export function procedenciaLibro(doc) {
  const texto = `${doc?.titulo || ''} ${doc?.nombreArchivo || ''}`.toLowerCase();
  if (!texto.trim()) return 'desconocida';
  if (/adaptad|jg turbo/.test(texto)
    && !/pdfdrive|drive\)|epub|scann?eado/.test(texto)) return 'adaptado';
  if (/pdfdrive|drive\)|\bepub\b|scann?eado/.test(texto)
    || doc?.needsSource || doc?.pideFuente) return 'original';
  return 'desconocida';
}

/**
 * ¿El TEXTO trae marcas de adaptación? Los adaptados llevan el marcador NUL
 * invisible de fin de línea y la mención «Edición adaptada para lectura en
 * JG Turbo» / «Texto refluido». Puro y con pruebas.
 *
 * @param {string} muestra – primeros miles de caracteres del contenido.
 * @returns {'adaptado'|undefined} (el original no deja marca fiable: no se adivina)
 */
export function detectarOrigenContenido(muestra) {
  const t = String(muestra || '');
  if (!t) return undefined;
  if (t.includes('\0')) return 'adaptado';
  if (/edici[óo]n adaptada para|texto refluido/i.test(t)) return 'adaptado';
  return undefined;
}

/**
 * Procedencia para guardar en el registro al importar: manda la evidencia
 * del contenido; si no la hay, valen los metadatos; si tampoco, undefined
 * (la tarjeta usa entonces la clasificación en vivo).
 */
export function origenTextoRegistro({ titulo, nombreArchivo, muestra } = {}) {
  const porContenido = detectarOrigenContenido(muestra);
  if (porContenido) return porContenido;
  const porMeta = procedenciaLibro({ titulo, nombreArchivo });
  return porMeta === 'desconocida' ? undefined : porMeta;
}
