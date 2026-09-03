/* Pruebas de la traducción por capítulos.
 * Ejecutar: node tests/test_pdf_traduccion.mjs
 *
 * No se llama a ninguna IA: se sustituye por un doble que cuenta cuántas
 * veces la llamaron. Lo que se prueba aquí es lo que cuesta dinero y tiempo:
 * que un capítulo NUNCA se traduzca dos veces, que el siguiente se vaya
 * preparando por detrás, y que un fallo de red no borre lo ya traducido.
 */
import { crearTraductor, necesitaTraduccion } from '../js/pdf/traduccion.js';

let fallos = 0;
function comprobar(condicion, mensaje) {
  if (condicion) console.log(`OK: ${mensaje}`);
  else { fallos += 1; console.error(`FALLO: ${mensaje}`); }
}
const esperar = (ms = 0) => new Promise((listo) => setTimeout(listo, ms));

const PARTES = [
  { titulo: 'ONE', texto: 'The first chapter talks about the fog over the village.' },
  { titulo: 'TWO', texto: 'The second chapter is about the sun coming back.' },
  { titulo: 'THREE', texto: 'The third chapter closes the story.' },
];

/** Traductor de mentira: devuelve el texto marcado y cuenta las llamadas. */
function dobleTraductor({ falla = false, demora = 0 } = {}) {
  const registro = { llamadas: 0, textos: [] };
  const traducir = async (texto) => {
    registro.llamadas += 1;
    registro.textos.push(texto);
    if (demora) await esperar(demora);
    if (falla) throw new Error('la red falló');
    return `[es] ${texto}`;
  };
  return { traducir, registro };
}

/** Memoria de mentira, en vez de la base de datos del navegador. */
function dobleAlmacen() {
  const datos = new Map();
  return {
    datos,
    guardar: async (indice, texto) => { datos.set(indice, texto); return true; },
    cargar: async (indice) => datos.get(indice) || null,
  };
}

/* ── ¿Hace falta traducir? ─────────────────────────────────────────── */
{
  comprobar(necesitaTraduccion('en') === true, 'un documento en inglés se ofrece traducir');
  comprobar(necesitaTraduccion('fr') === true, 'uno en francés también');
  comprobar(necesitaTraduccion('es') === false, 'uno en español no');
  comprobar(necesitaTraduccion('es-CO') === false, 'una variante regional del español tampoco');
  comprobar(necesitaTraduccion('') === false, 'sin idioma detectado no se molesta al usuario');
  comprobar(necesitaTraduccion(null) === false, 'un valor vacío no rompe nada');
}

/* ── Traducir un capítulo ──────────────────────────────────────────── */
{
  const { traducir, registro } = dobleTraductor();
  const almacen = dobleAlmacen();
  const traductor = crearTraductor({ traducir, ...almacen, idiomaOrigen: 'en' });

  const texto = await traductor.obtener(0, PARTES[0]);
  comprobar(texto === `[es] ${PARTES[0].texto}`, 'devuelve el capítulo traducido');
  comprobar(registro.llamadas === 1, 'llamó a la traducción una vez');
  comprobar(almacen.datos.get(0) === texto, 'guardó la traducción para la próxima');
}

{
  /* Lo importante del dinero: pedir dos veces el mismo capítulo no se paga dos veces. */
  const { traducir, registro } = dobleTraductor();
  const almacen = dobleAlmacen();
  const traductor = crearTraductor({ traducir, ...almacen, idiomaOrigen: 'en' });

  await traductor.obtener(1, PARTES[1]);
  await traductor.obtener(1, PARTES[1]);
  await traductor.obtener(1, PARTES[1]);
  comprobar(registro.llamadas === 1, 'un capítulo ya traducido no se vuelve a traducir');
}

{
  /* Y tampoco si la traducción venía de una sesión anterior. */
  const { traducir, registro } = dobleTraductor();
  const almacen = dobleAlmacen();
  almacen.datos.set(2, 'traducción de ayer');
  const traductor = crearTraductor({ traducir, ...almacen, idiomaOrigen: 'en' });

  const texto = await traductor.obtener(2, PARTES[2]);
  comprobar(texto === 'traducción de ayer', 'recupera lo traducido en otra sesión');
  comprobar(registro.llamadas === 0, 'no gasta una consulta por algo que ya estaba');
}

/* ── Dos peticiones a la vez ───────────────────────────────────────── */
{
  const { traducir, registro } = dobleTraductor({ demora: 30 });
  const almacen = dobleAlmacen();
  const traductor = crearTraductor({ traducir, ...almacen, idiomaOrigen: 'en' });

  const [a, b] = await Promise.all([traductor.obtener(0, PARTES[0]), traductor.obtener(0, PARTES[0])]);
  comprobar(a === b, 'dos peticiones simultáneas devuelven lo mismo');
  comprobar(registro.llamadas === 1, 'y solo se traduce una vez, no dos en paralelo');
}

/* ── Preparar el siguiente por detrás ──────────────────────────────── */
{
  const { traducir, registro } = dobleTraductor({ demora: 10 });
  const almacen = dobleAlmacen();
  const traductor = crearTraductor({ traducir, ...almacen, idiomaOrigen: 'en' });

  await traductor.obtener(0, PARTES[0]);
  traductor.precargar(1, PARTES[1]);
  await esperar(60);
  comprobar(almacen.datos.has(1), 'el siguiente capítulo queda listo antes de llegar a él');

  const antes = registro.llamadas;
  await traductor.obtener(1, PARTES[1]);
  comprobar(registro.llamadas === antes, 'al llegar al capítulo ya no hay que esperar ni pagar');
}

/* ── Cuando la red falla ───────────────────────────────────────────── */
{
  const { traducir, registro } = dobleTraductor({ falla: true });
  const almacen = dobleAlmacen();
  almacen.datos.set(0, 'capítulo uno en español');
  const traductor = crearTraductor({ traducir, ...almacen, idiomaOrigen: 'en' });

  let error = null;
  try { await traductor.obtener(1, PARTES[1]); } catch (e) { error = e; }
  comprobar(error !== null, 'un fallo de red se avisa, no se traga en silencio');
  comprobar(almacen.datos.get(0) === 'capítulo uno en español', 'lo ya traducido sigue intacto');

  /* Y se puede reintentar: el fallo no deja el capítulo marcado como «en curso». */
  const { traducir: buena } = dobleTraductor();
  const traductor2 = crearTraductor({ traducir: buena, ...almacen, idiomaOrigen: 'en' });
  const texto = await traductor2.obtener(1, PARTES[1]);
  comprobar(texto.startsWith('[es]'), 'tras el fallo se puede reintentar sin recargar la página');
}

/* ── Casos límite ──────────────────────────────────────────────────── */
{
  const { traducir, registro } = dobleTraductor();
  const traductor = crearTraductor({ traducir, ...dobleAlmacen(), idiomaOrigen: 'en' });

  comprobar(await traductor.obtener(0, { titulo: 'x', texto: '   ' }) === '', 'un capítulo vacío no se manda a traducir');
  comprobar(registro.llamadas === 0, 'y no gasta una consulta');
  comprobar(await traductor.obtener(0, null) === '', 'un capítulo que no existe devuelve vacío');
}

{
  const almacen = dobleAlmacen();
  almacen.datos.set(0, 'ya está');
  almacen.datos.set(2, 'y este también');
  const traductor = crearTraductor({ traducir: async () => 'x', ...almacen, idiomaOrigen: 'en' });
  await traductor.obtener(0, PARTES[0]);
  comprobar(traductor.estaTraducido(0) === true, 'sabe qué capítulos ya están traducidos');
  comprobar(traductor.estaTraducido(1) === false, 'y cuáles no');
}

{
  /* «sembrar» marca capítulos traducidos en sesiones anteriores para pintarlos
   * en el índice; eso no puede hacer que al abrirlos devuelvan texto vacío. */
  const { traducir, registro } = dobleTraductor();
  const almacen = dobleAlmacen();
  almacen.datos.set(1, 'traducción guardada ayer');
  const traductor = crearTraductor({ traducir, ...almacen, idiomaOrigen: 'en' });
  traductor.sembrar([1]);
  comprobar(traductor.estaTraducido(1) === true, 'el índice marca lo traducido en sesiones previas');
  const texto = await traductor.obtener(1, PARTES[1]);
  comprobar(texto === 'traducción guardada ayer', 'y al abrirlo devuelve el texto, no un vacío');
  comprobar(registro.llamadas === 0, 'sin gastar una consulta');
}

console.log(fallos === 0 ? '\nTodas las pruebas de traducción pasaron.' : `\n${fallos} prueba(s) fallaron.`);
process.exit(fallos === 0 ? 0 : 1);
