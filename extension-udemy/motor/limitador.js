/**
 * Ventana deslizante de peticiones.
 *
 * Azure Speech F0 admite 20 síntesis por minuto y NO es ajustable (Microsoft
 * Learn, actualizado 2026-09-24). Se deja margen (18) porque el lector de PDF y
 * «Escuchar» comparten la misma cuota. Antes el doblaje precargaba la voz del
 * video entero con 2 hilos: más de 100 por minuto (auditoría H9).
 */
export const MAXIMO_VOZ_POR_MINUTO = 18;

export function crearLimitador({ maximo = MAXIMO_VOZ_POR_MINUTO, ventanaMs = 60000, ahora = () => Date.now() } = {}) {
  const marcas = [];
  const purgar = () => {
    const t = ahora();
    while (marcas.length && t - marcas[0] >= ventanaMs) marcas.shift();
  };
  return {
    disponible() { purgar(); return marcas.length < maximo; },
    esperaMs() {
      purgar();
      return marcas.length < maximo ? 0 : Math.max(0, ventanaMs - (ahora() - marcas[0]));
    },
    registrar() { purgar(); marcas.push(ahora()); },
    get usados() { purgar(); return marcas.length; },
  };
}
