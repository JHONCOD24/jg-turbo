export const VALORES_INICIALES = Object.freeze({ voz: 'female', acento: 'es-CO', volVoz: 100, volOriginal: 12, ritmoAuto: true, subtitulo: true, autoSiguiente: true, terminosWeb: true });
const ACENTOS = ['es-CO', 'es-MX', 'es-AR', 'es-CL', 'es-PE', 'es-US'];
export function limpiarPreferencias(datos = {}) {
  const volumen = (clave) => Number.isFinite(Number(datos[clave])) && datos[clave] !== undefined ? Math.max(0, Math.min(100, Number(datos[clave]))) : VALORES_INICIALES[clave];
  return {
    voz: ['female', 'male', 'female-multi', 'male-multi'].includes(datos.voz) ? datos.voz : 'female',
    acento: ACENTOS.includes(datos.acento) ? datos.acento : 'es-CO',
    volVoz: volumen('volVoz'), volOriginal: volumen('volOriginal'),
    ritmoAuto: typeof datos.ritmoAuto === 'boolean' ? datos.ritmoAuto : true,
    subtitulo: typeof datos.subtitulo === 'boolean' ? datos.subtitulo : true,
    autoSiguiente: typeof datos.autoSiguiente === 'boolean' ? datos.autoSiguiente : true,
    terminosWeb: typeof datos.terminosWeb === 'boolean' ? datos.terminosWeb : true,
  };
}
export async function leerPreferencias() { return limpiarPreferencias(await chrome.storage.local.get(Object.keys(VALORES_INICIALES))); }
export async function guardarPreferencias(datos) { await chrome.storage.local.set(limpiarPreferencias(datos)); }
