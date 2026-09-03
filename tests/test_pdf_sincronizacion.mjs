/* Pruebas de la fusión entre lo que hay en el dispositivo y lo que hay en la
 * nube. Ejecutar: node tests/test_pdf_sincronizacion.mjs
 *
 * Esta es la parte que más daño hace si se equivoca: aquí se decide qué
 * documento gana cuando el mismo libro cambió en el celular y en el PC. Un
 * error no da un mensaje de error: borra el progreso de alguien.
 */
import {
  fusionar, decidir, aplicarRemotos, marcarBorrado, esMasNuevo, necesitaSubirContenido,
} from '../js/pdf/sincronizacion.js';

let fallos = 0;
function comprobar(condicion, mensaje) {
  if (condicion) console.log(`OK: ${mensaje}`);
  else { fallos += 1; console.error(`FALLO: ${mensaje}`); }
}

const doc = (id, actualizado, extra = {}) => ({
  id, titulo: `Libro ${id}`, actualizado, progreso: { parte: 0, desplazamiento: 0 }, ...extra,
});

/* ── Decidir quién gana ────────────────────────────────────────────── */
{
  comprobar(decidir(doc('a', 100), null) === 'subir', 'lo que solo está en el dispositivo se sube');
  comprobar(decidir(null, doc('a', 100)) === 'bajar', 'lo que solo está en la nube se baja');
  comprobar(decidir(doc('a', 200), doc('a', 100)) === 'subir', 'gana el cambio más reciente (local)');
  comprobar(decidir(doc('a', 100), doc('a', 200)) === 'bajar', 'gana el cambio más reciente (remoto)');
  comprobar(decidir(doc('a', 100), doc('a', 100)) === 'nada', 'si no cambió nada, no se mueve nada');
  comprobar(decidir(null, null) === 'nada', 'dos vacíos no producen trabajo');
}

{
  /* Un borrado es una acción del usuario, no una ausencia: también compite. */
  const borradoLocal = doc('a', 300, { borrado: 300 });
  comprobar(decidir(borradoLocal, doc('a', 200)) === 'subir', 'un borrado reciente se propaga a la nube');
  comprobar(
    decidir(doc('a', 400), borradoLocal) === 'subir',
    'si después de borrarlo se vuelve a usar, el uso más reciente manda'
  );
  const borradoRemoto = doc('a', 500, { borrado: 500 });
  comprobar(decidir(doc('a', 400), borradoRemoto) === 'bajar', 'un borrado en el otro dispositivo también llega');
}

{
  comprobar(esMasNuevo(doc('a', 200), doc('a', 100)) === true, 'compara marcas de tiempo');
  comprobar(esMasNuevo(doc('a', 100), doc('a', 200)) === false, 'y en el otro sentido');
  comprobar(esMasNuevo(doc('a', undefined), doc('a', 100)) === false, 'sin marca de tiempo no gana');
  comprobar(esMasNuevo(doc('a', 100), doc('a', undefined)) === true, 'contra algo sin marca, gana el que la tiene');
}

/* ── Fusionar dos listas ───────────────────────────────────────────── */
{
  const locales = [doc('a', 100), doc('b', 300), doc('c', 500)];
  const remotos = [doc('a', 100), doc('b', 200), doc('d', 700)];
  const plan = fusionar(locales, remotos);

  comprobar(plan.subir.map((d) => d.id).join(',') === 'b,c', 'sube lo más nuevo del dispositivo y lo que falta allá');
  comprobar(plan.bajar.map((d) => d.id).join(',') === 'd', 'baja lo que solo existe en la nube');
  comprobar(plan.sinCambios.length === 1 && plan.sinCambios[0] === 'a', 'lo idéntico no viaja');
}

{
  const plan = fusionar([], []);
  comprobar(plan.subir.length === 0 && plan.bajar.length === 0, 'dos bibliotecas vacías no generan tráfico');
}

{
  /* Primera sincronización de un dispositivo nuevo: todo viene de la nube. */
  const plan = fusionar([], [doc('a', 100), doc('b', 200)]);
  comprobar(plan.bajar.length === 2 && plan.subir.length === 0, 'un dispositivo nuevo se llena desde la nube');
}

{
  /* Primera sincronización con la nube vacía: todo sube. */
  const plan = fusionar([doc('a', 100), doc('b', 200)], []);
  comprobar(plan.subir.length === 2 && plan.bajar.length === 0, 'la primera vez se sube toda la biblioteca');
}

/* ── El caso real: leer en el celular y abrir el PC ────────────────── */
{
  const enElPc = doc('libro', 1000, { progreso: { parte: 2, desplazamiento: 0.5, maxParte: 2 } });
  const enElCelular = doc('libro', 2000, { progreso: { parte: 8, desplazamiento: 0.1, maxParte: 8 } });

  const plan = fusionar([enElPc], [enElCelular]);
  comprobar(plan.bajar.length === 1, 'el PC recibe lo leído en el celular');
  comprobar(plan.bajar[0].progreso.parte === 8, 'y queda en el capítulo donde iba el celular');
}

{
  /* Y al revés: si lo último fue en el PC, el celular no debe retroceder. */
  const enElPc = doc('libro', 3000, { progreso: { parte: 12, desplazamiento: 0 } });
  const enElCelular = doc('libro', 2000, { progreso: { parte: 8, desplazamiento: 0.1 } });
  const plan = fusionar([enElPc], [enElCelular]);
  comprobar(plan.subir.length === 1 && plan.subir[0].progreso.parte === 12, 'el celular recibirá el avance del PC');
}

{
  /* Reiniciar un libro a propósito no puede deshacerse al sincronizar. */
  const reiniciado = doc('libro', 5000, { progreso: { parte: 0, desplazamiento: 0, maxParte: 0 } });
  const viejoAvance = doc('libro', 4000, { progreso: { parte: 9, desplazamiento: 0.4, maxParte: 9 } });
  const plan = fusionar([reiniciado], [viejoAvance]);
  comprobar(
    plan.subir.length === 1 && plan.subir[0].progreso.parte === 0,
    'reiniciar es una acción del usuario y también se propaga'
  );
}

/* ── Aplicar lo que llegó de la nube ───────────────────────────────── */
{
  const locales = [doc('a', 100), doc('b', 100)];
  const llegados = [doc('b', 500, { titulo: 'Libro b cambiado' }), doc('c', 600)];
  const resultado = aplicarRemotos(locales, llegados);

  comprobar(resultado.length === 3, 'la biblioteca queda con los tres documentos');
  comprobar(resultado.find((d) => d.id === 'b').titulo === 'Libro b cambiado', 'el documento cambiado se actualiza');
  comprobar(resultado.find((d) => d.id === 'a').actualizado === 100, 'el que no cambió se deja igual');
  comprobar(Boolean(resultado.find((d) => d.id === 'c')), 'el documento nuevo se añade');
}

{
  /* Un borrado que llega de la nube saca el documento de la lista. */
  const locales = [doc('a', 100), doc('b', 100)];
  const llegados = [doc('b', 900, { borrado: 900 })];
  const resultado = aplicarRemotos(locales, llegados);
  comprobar(resultado.length === 1 && resultado[0].id === 'a', 'un borrado remoto quita el documento de aquí');
}

{
  /* Pero un borrado viejo no puede tumbar un documento que se usó después. */
  const locales = [doc('a', 100), doc('b', 900)];
  const llegados = [doc('b', 500, { borrado: 500 })];
  const resultado = aplicarRemotos(locales, llegados);
  comprobar(resultado.length === 2, 'un borrado viejo no borra algo usado después');
}

/* ── Marcar un borrado ─────────────────────────────────────────────── */
{
  const marcado = marcarBorrado(doc('a', 100));
  comprobar(marcado.borrado > 0, 'el borrado deja una marca con la hora');
  comprobar(marcado.actualizado === marcado.borrado, 'y esa marca cuenta como el último cambio');
  comprobar(!marcado.partes && !marcado.texto, 'un documento borrado viaja sin su contenido');
  comprobar(marcado.id === 'a', 'pero conserva el identificador para poder propagarse');
}

/* ── Casos límite ──────────────────────────────────────────────────── */
{
  comprobar(fusionar(null, null).subir.length === 0, 'con listas nulas no revienta');
  comprobar(aplicarRemotos(null, null).length === 0, 'aplicar nada sobre nada devuelve nada');
  const conBasura = fusionar([{ sinId: true }, doc('a', 100)], []);
  comprobar(conBasura.subir.length === 1, 'los registros sin identificador se ignoran');
}

{
  /* Una biblioteca grande no puede tardar en fusionarse. */
  const muchos = Array.from({ length: 5000 }, (_, i) => doc(`d${i}`, i));
  const otros = Array.from({ length: 5000 }, (_, i) => doc(`d${i}`, i % 2 ? i + 10 : i));
  const arranque = Date.now();
  const plan = fusionar(muchos, otros);
  const ms = Date.now() - arranque;
  comprobar(plan.bajar.length === 2500, 'detecta exactamente los que cambiaron en la nube');
  comprobar(ms < 500, `fusionar 5.000 documentos es rápido (${ms} ms)`);
}

/* ── Avanzar leyendo no es «cambió el libro» ───────────────────────── */
{
  /* Un documento cuyo texto no se ha tocado desde la última subida, pero
   * cuyo progreso sí avanzó, no debe arrastrar sus capítulos otra vez. */
  const soloProgreso = { id: 'lib1', actualizado: 5000, contenidoActualizado: 1000, sincronizado: 3000 };
  comprobar(necesitaSubirContenido(soloProgreso) === false,
    'avanzar en la lectura NO obliga a resubir los capitulos');

  const textoEditado = { id: 'lib2', actualizado: 5000, contenidoActualizado: 4000, sincronizado: 3000 };
  comprobar(necesitaSubirContenido(textoEditado) === true,
    'editar el texto SI obliga a resubir los capitulos');

  /* Un libro que nunca se subió sube todo, aunque no tenga la marca nueva. */
  const nuevo = { id: 'lib3', actualizado: 5000, sincronizado: 0 };
  comprobar(necesitaSubirContenido(nuevo) === true,
    'un libro nunca sincronizado sube su contenido');

  /* Documentos guardados antes de esta version no tienen la marca: por
   * seguridad se comportan como antes (suben todo). */
  const viejo = { id: 'lib4', actualizado: 5000, sincronizado: 3000 };
  comprobar(necesitaSubirContenido(viejo) === true,
    'un documento sin la marca nueva sube todo (compatibilidad)');
}

console.log(fallos === 0 ? '\nTodas las pruebas de sincronización pasaron.' : `\n${fallos} prueba(s) fallaron.`);
process.exit(fallos === 0 ? 0 : 1);
