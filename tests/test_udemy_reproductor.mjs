import assert from 'node:assert/strict';
const { ReproductorRemoto } = await import('../extension-udemy/lib/reproductorRemoto.js');
const eventos = () => { const fns = new Set(); return { addListener: (f) => fns.add(f), removeListener: (f) => fns.delete(f), emitir: (v) => fns.forEach((f) => f(v)) }; };
const puerto = { onMessage: eventos(), onDisconnect: eventos(), enviados: [], postMessage(m) { this.enviados.push(m); }, disconnect() { this.onDisconnect.emitir(); } };
let reloj = 0, ok = 0;
const igual = (a, b, m) => { assert.deepEqual(a, b, m); ok++; console.log(`OK: ${m}`); };
const player = new ReproductorRemoto(puerto, { ahora: () => reloj });
const estado = { tipo: 'estado', t: 10, tasa: 1, pausado: false, terminado: false, esperando: false, volumen: .73, silenciado: false, duracion: 635 };
puerto.onMessage.emitir(estado); reloj = 300;
igual(player.getCurrentTime(), 10.3, 'extrapola 300 ms');
puerto.onMessage.emitir({ ...estado, pausado: true }); reloj += 300;
igual(player.getCurrentTime(), 10, 'pausado conserva tiempo');
puerto.onMessage.emitir({ ...estado, tasa: .9 }); reloj += 300;
igual(player.getCurrentTime(), 10.27, 'extrapola a 0,9');
igual(player.getPlayerState(), 1, 'codigo reproduciendo');
for (const [datos, codigo] of [[{ terminado: true }, 0], [{ esperando: true }, 3], [{ pausado: true }, 2]]) {
  puerto.onMessage.emitir({ ...estado, ...datos }); igual(player.getPlayerState(), codigo, `codigo ${codigo}`);
}
player.setPlaybackRate(.8); igual(player.getPlaybackRate(), .8, 'velocidad local inmediata');
player.setVolume(12); igual(player.getVolume(), 12, 'volumen local inmediato');
player.mute(); igual(player.isMuted(), true, 'silencio inmediato');
player.unMute(); igual(player.isMuted(), false, 'quitar silencio inmediato');
player.playVideo(); igual(player.getPlayerState(), 1, 'play local inmediato');
player.pauseVideo(); igual(player.getPlayerState(), 2, 'pausa local inmediata');
igual(puerto.enviados.map((m) => m.accion), ['velocidad', 'volumen', 'silencio', 'silencio', 'play', 'pausa'], 'ordenes del contrato');
let notificacion = ''; player.suscribirEstado((v) => { notificacion = v; });
puerto.onDisconnect.emitir(); igual(notificacion, 'paused', 'desconexion avisa pausa');
igual(player.getPlayerState(), 2, 'desconexion detiene reloj');
console.log(`${ok} comprobaciones OK · 0 fallos`);
