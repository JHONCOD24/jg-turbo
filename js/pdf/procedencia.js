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
