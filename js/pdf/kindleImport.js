/* JG Turbo · Importación segura desde Kindle
 *
 * Este módulo no habla con Amazon, no toca sesiones y no convierte formatos
 * protegidos. Solo valida archivos que la persona ya descargó legalmente y
 * calcula una huella local para no guardar el mismo PDF dos veces.
 */

const FORMATOS_KINDLE_PROTEGIDOS = new Set(['azw', 'azw3', 'kfx', 'mobi']);

export function extensionArchivo(nombre) {
  const coincidencia = String(nombre || '').trim().toLowerCase().match(/\.([a-z0-9]+)$/);
  return coincidencia ? coincidencia[1] : '';
}

/**
 * Decide si un archivo puede entrar por el asistente Kindle.
 * Se acepta PDF por extensión o MIME. Los formatos Kindle se rechazan con un
 * mensaje específico para no empujar a la persona a quitar el DRM.
 */
export function clasificarArchivoKindle(archivo) {
  const nombre = String(archivo?.name || 'archivo');
  const extension = extensionArchivo(nombre);

  if (FORMATOS_KINDLE_PROTEGIDOS.has(extension)) {
    return {
      aceptado: false,
      codigo: 'formato-kindle',
      mensaje: `${nombre}: JG Turbo no abre ${extension.toUpperCase()} ni elimina DRM. ` +
        'Descarga el PDF oficial desde Amazon si ese título lo permite.',
    };
  }
  if (extension === 'pdf') return { aceptado: true, codigo: 'pdf', mensaje: '' };
  return {
    aceptado: false,
    codigo: 'no-pdf',
    mensaje: `${nombre}: no es un PDF compatible.`,
  };
}

/** SHA-256 del archivo completo. Todo ocurre en el dispositivo. */
export async function calcularHuellaArchivo(archivo) {
  if (!archivo || typeof archivo.arrayBuffer !== 'function') {
    throw new Error('No se pudo leer el archivo para comprobar si ya estaba guardado.');
  }
  if (!globalThis.crypto?.subtle) {
    throw new Error('Este navegador no permite comprobar duplicados de forma segura.');
  }
  const datos = await archivo.arrayBuffer();
  const resumen = new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', datos));
  return Array.from(resumen, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function idKindleDesdeHuella(huella) {
  const limpia = String(huella || '').toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(limpia)) throw new Error('La huella del archivo no es válida.');
  return `kindle-${limpia.slice(0, 40)}`;
}

export function mensajeErrorKindle(error, nombre = 'El archivo') {
  if (error?.motivo === 'clave') {
    return `${nombre}: el PDF está protegido. JG Turbo no quita contraseñas ni DRM.`;
  }
  if (error?.motivo === 'invalido') return `${nombre}: el PDF está dañado o no es válido.`;
  return `${nombre}: ${error?.message || 'no se pudo importar.'}`;
}
