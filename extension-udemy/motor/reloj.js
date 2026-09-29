/**
 * Reloj del doblaje: `setInterval`, no `requestAnimationFrame`.
 *
 * rAF se CONGELA cuando la página no se pinta (pestaña en segundo plano, ventana
 * tapada, pantalla apagada). Medido el 2026-09-25: 0 disparos de rAF en 1,5 s con
 * la ventana tapada frente a 16 de un intervalo de 100 ms; el doblaje quedaba mudo
 * justo cuando la persona «solo escucha». Las pestañas que reproducen audio no se
 * estrangulan, así que este reloj sigue a su ritmo mientras suena la voz.
 */
export function crearReloj(tick, {
  intervaloMs = 100,
  programar = (fn, ms) => setInterval(fn, ms),
  cancelar = (id) => clearInterval(id),
} = {}) {
  if (typeof tick !== 'function') throw new Error('El reloj necesita una función.');
  let id = null;
  return {
    iniciar() {
      if (id !== null) return;
      id = programar(() => {
        try { tick(); } catch (error) { console.error('[jg-youtube-reloj]', error); }
      }, intervaloMs);
    },
    detener() {
      if (id === null) return;
      cancelar(id);
      id = null;
    },
    get activo() { return id !== null; },
  };
}
