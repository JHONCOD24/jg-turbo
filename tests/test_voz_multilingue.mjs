import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { protegerTerminos, quitarMarcasDeTermino } from '../js/youtube/terminosWeb.js';
const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
function funcion(nombre) {
  const inicio = html.indexOf(`\nfunction ${nombre}(`) + 1;
  assert.ok(inicio > 0);
  const siguiente = html.slice(inicio + 10).search(/\n(?:function |const |let |var |\/\*\*|window\.)/);
  const texto = html.slice(inicio, siguiente < 0 ? html.length : inicio + 10 + siguiente);
  return texto.slice(0, texto.lastIndexOf('}') + 1);
}
let ok = 0;
const comprobar = (c, m) => { assert.ok(c, m); ok++; console.log(`OK: ${m}`); };
const catalogo = new Function('TTS_NEURAL_ACCENTS', 'ttsFishInfo', `${funcion('ttsCatalogoVoces')} return ttsCatalogoVoces();`)([], { active: false });
comprobar(catalogo.some((v) => v.value === 'neural:multi:female'), 'Ava disponible en selector global y PDF');
comprobar(catalogo.some((v) => v.value === 'neural:multi:male'), 'Andrew disponible en selector global y PDF');
const prefs = new Function('jgCfgGet', 'ttsVozActual', 'ttsClaveVoz', `${funcion('ttsNormalizarModo')} ${funcion('ttsPrefs')} return ttsPrefs();`)((k, d) => d, () => ({ provider: 'neural', locale: 'multi', gender: 'female' }), () => 'neural:multi:female');
comprobar(prefs.bilingualMode === 'unified', 'eleccion explicita multilingue prevalece sobre modo anterior');
const corte = new Function(`${funcion('ttsBuscarCorte')} return ttsBuscarCorte;`)();
const ejemplo = 'Si quiero que vuelva por completo al inicio, solo tengo que llamar otra vez a esta función, siempre y cuando la escriba exactamente igual a como la definí al principio.';
const posicion = ejemplo.indexOf(' y cuando');
const sinComas = ejemplo.replaceAll(',', '');
const corteConector = corte(sinComas, sinComas.indexOf(' y cuando'));
comprobar(!/siempre$/.test(sinComas.slice(0, corteConector)), 'corte del primer bloque no divide siempre y cuando');
comprobar(posicion > 0, 'caso exacto del dueño incluido');
const normalizar = new Function(`${funcion('ttsNormalizarTextoNarracion')} return ttsNormalizarTextoNarracion;`)();
const partido = ejemplo.replace('siempre y cuando', 'siempre\n\ny cuando');
comprobar(normalizar(partido, 'es').includes('siempre y cuando'), 'salto de parrafo dentro de una frase no agrega punto');
// Tecnicismos (v166): viajan marcados como código y restaurar NUNCA lanza. Casos
// reales: subtítulos 12-15 de la clase medida en producción el 2026-10-02
// (rama claude/udemy-extension-sync-voices-767b87, docs/udemy/mediciones/2026-10-02/).
const intentar = (fn) => { try { return fn(); } catch (error) { return `LANZO: ${error.message}`; } };
const lote = [
  '[[JG_SEG_000012]]\nWhen the data needs to change over time, we use state,',
  '[[JG_SEG_000013]]\nand in modern React we handle state with hooks.',
  '[[JG_SEG_000014]]\nThe most common hook is useState, and it gives you an array',
  '[[JG_SEG_000015]]\nwith two things: the current value and a function to update it.',
].join('\n\n');
const protegido = protegerTerminos(lote);
comprobar(protegido.texto === [
  '[[JG_SEG_000012]]\nWhen the data needs to change over time, we use state,',
  '[[JG_SEG_000013]]\nand in modern `React` we handle state with `hooks`.',
  '[[JG_SEG_000014]]\nThe most common `hook` is useState, and it gives you an `array`',
  '[[JG_SEG_000015]]\nwith two things: the current value and a function to update it.',
].join('\n\n'), 'tecnicismos viajan como codigo, con la palabra real y los marcadores intactos');
comprobar(protegerTerminos('Reactivate the classroom and the JSONP file.').texto === 'Reactivate the classroom and the JSONP file.', 'no marca pedazos de otras palabras');
comprobar(protegerTerminos('Run `npm` here').texto === 'Run `npm` here', 'no marca dos veces lo que ya venia como codigo');
comprobar(protegerTerminos('Use Node.js and the REST API in the back-end.').texto === 'Use `Node.js` and the `REST API` in the `back-end`.', 'terminos con punto, guion o dos palabras se marcan enteros');
// Respuesta real de producción al lote 14-15 (la mitad del lote anterior): el
// traductor quitó las marcas, dejó «hook» en inglés y se comió «array». La
// protección vieja la rechazaba y ese subtítulo se quedaba sin voz.
const mitad = protegerTerminos(lote.slice(lote.indexOf('[[JG_SEG_000014]]')));
const sinMarcas = '[[JG_SEG_000014]]\nEl hook más usado es useState, y te da dos cosas\n\n[[JG_SEG_000015]]\nel valor actual y una función para actualizarlo';
comprobar(intentar(() => mitad.restaurar(sinMarcas)) === sinMarcas, 'traduccion real sin marcas se acepta tal como vino');
// Texto final medido en producción con las marcas de código (COMILLAS 12-15):
// «array» salió traducido como «arreglo»; las demás marcas se quitan.
comprobar(intentar(() => protegido.restaurar([
  '[[JG_SEG_000012]]\nCuando los datos necesitan cambiar con el tiempo, usamos el estado,',
  '[[JG_SEG_000013]]\ny en `React` moderno lo manejamos con `hooks`.',
  '[[JG_SEG_000014]]\nEl `hook` más usado es useState, que te da un arreglo',
  '[[JG_SEG_000015]]\ncon dos cosas: el valor actual y una función para actualizarlo.',
].join('\n\n'))) === [
  '[[JG_SEG_000012]]\nCuando los datos necesitan cambiar con el tiempo, usamos el estado,',
  '[[JG_SEG_000013]]\ny en React moderno lo manejamos con hooks.',
  '[[JG_SEG_000014]]\nEl hook más usado es useState, que te da un arreglo',
  '[[JG_SEG_000015]]\ncon dos cosas: el valor actual y una función para actualizarlo.',
].join('\n\n'), 'termino traducido por el traductor no es error y se quitan las marcas');
comprobar(intentar(() => protegido.restaurar('[[JG_SEG_000013]]\ny en `React` moderno, `React` lo maneja con `hooks`.'))
  === '[[JG_SEG_000013]]\ny en React moderno, React lo maneja con hooks.', 'termino repetido no es error');
comprobar(intentar(() => protegido.restaurar('[[JG_SEG_000013]]\ny en `React` moderno lo manejamos\n\n[[JG_SEG_000014]]\ncon `hooks`. El `hook` más usado es useState'))
  === '[[JG_SEG_000013]]\ny en React moderno lo manejamos\n\n[[JG_SEG_000014]]\ncon hooks. El hook más usado es useState', 'termino que cambio de segmento no es error');
comprobar(intentar(() => quitarMarcasDeTermino('Usa ` npm ` y `React`; el `estado')) === 'Usa npm y React; el estado', 'quita comillas con espacios por dentro y sueltas');
comprobar(intentar(() => quitarMarcasDeTermino('Usa `React y `hooks`.')) === 'Usa React y hooks.', 'una comilla perdida no pega palabras');
comprobar(intentar(() => quitarMarcasDeTermino(null)) === '' && intentar(() => protegerTerminos(undefined).texto) === '', 'sin texto devuelve vacio sin lanzar');
console.log(`${ok} comprobaciones OK · 0 fallos`);
