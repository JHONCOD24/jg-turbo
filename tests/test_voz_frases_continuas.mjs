import assert from 'node:assert/strict';
import { agruparPorTiempo, prepararTextoDeUnidad, DubbingService } from '../js/youtube/dubbingService.js';
import { MotorPreparacion } from '../js/youtube/motorPreparacion.js';
import { indiceDesde } from '../js/youtube/planificador.js';
let ok = 0;
const comprobar = (c, m) => { assert.ok(c, m); ok++; console.log(`OK: ${m}`); };
const segmentos = [
  { startTime: 0, endTime: 9, text: 'If I want to go back to the beginning, I call this function again, as long as' },
  { startTime: 9, endTime: 14, text: 'I write it exactly as I defined it at the beginning.' },
];
const traducciones = new Map([[0, 'Si quiero que vuelva por completo al inicio, solo tengo que llamar otra vez a esta función, siempre'], [1, 'y cuando la escriba exactamente igual a como la definí al principio.']]);
const unidades = agruparPorTiempo(segmentos);
comprobar(unidades.length === 2, 'reproduce dos unidades cortadas por tiempo');
const unido = prepararTextoDeUnidad(unidades, 0, traducciones);
comprobar(unido.includes('siempre y cuando'), 'siempre y cuando viaja en una sola sintesis');
comprobar(unidades[0].hasta === 1 && unidades[1].estado === 'sin_voz', 'cada segmento se dice una vez sin cambiar indices');
comprobar(unidades[0].endTime === unidades[1].endTime, 'tiempos ordenados para avanzar y retroceder');
const pendientes = agruparPorTiempo(segmentos);
comprobar(prepararTextoDeUnidad(pendientes, 0, new Map([[0, traducciones.get(0)]])) === null, 'espera la continuacion antes de sintetizar');
comprobar(pendientes[0].hasta === 0, 'esperar no modifica unidades');
const coma = agruparPorTiempo(segmentos);
comprobar(prepararTextoDeUnidad(coma, 0, new Map([[0, 'La función vuelve al inicio,'], [1, 'y luego seguimos.']])) === 'La función vuelve al inicio,', 'coma permite respirar');
const silencio = agruparPorTiempo([segmentos[0], { ...segmentos[1], startTime: 11, endTime: 16 }]);
comprobar(prepararTextoDeUnidad(silencio, 0, traducciones) === traducciones.get(0), 'no borra silencio real del original');
const hablantes = agruparPorTiempo(segmentos); hablantes[1].hablante = 1;
comprobar(prepararTextoDeUnidad(hablantes, 0, traducciones) === traducciones.get(0), 'no une hablantes distintos');
const larga = agruparPorTiempo(segmentos); larga[1].finHabla = 40;
comprobar(prepararTextoDeUnidad(larga, 0, traducciones) === traducciones.get(0), 'no crea bloques largos sin limite');
const pedidos = [];
const servicio = new DubbingService({ generarAudio: async (texto) => {
  pedidos.push(texto); return { blob: new Blob(['voz'], { type: 'audio/mpeg' }) };
}, medirDuracion: async () => 14, medirHabla: async () => null });
servicio.definirUnidades(agruparPorTiempo(segmentos));
const motor = new MotorPreparacion({ segmentos, servicioVoz: servicio, posicion: () => 0,
  traductor: { traducirLote: async () => { throw new Error('No debe traducir texto ya sembrado'); } } });
motor.sembrar(traducciones); motor.paso();
await servicio.unidades[0].promesa;
comprobar(pedidos.length === 1 && pedidos[0] === unido, 'motor real solicita una sola voz con la frase completa');
comprobar(servicio.unidades[0].fracciones.length === 2, 'subtitulos mantienen ambos segmentos dentro de la voz');
comprobar(indiceDesde(servicio.unidades, 10) === 0, 'saltar dentro de la frase encuentra la unidad unida');
servicio.liberarAntesDe(80); motor.paso(); await servicio.unidades[0].promesa;
comprobar(pedidos.length === 2 && pedidos[1] === unido, 'retroceder regenera la frase completa sin repetir continuaciones');
servicio.liberar(); motor.detener();
console.log(`${ok} comprobaciones OK · 0 fallos`);
