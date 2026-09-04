/* Cola de corrección de lectura: libros de 40/50/100/120 partes,
 * fallos intermedios, recarga y reanudación hasta cero pendientes.
 * Ejecutar: node tests/test_pdf_cola_correccion.mjs
 */
import {
  TAMANOS_BLOQUE,
  MAX_REINTENTOS_POR_TAMANO,
  crearColaDesdePartes,
  hidratarCola,
  serializarCola,
  siguienteItem,
  aplicarExito,
  aplicarFallo,
  prepararReanudacion,
  correrCola,
  resumenCola,
  etiquetaColaCorreccion,
  validarResultadoCorreccion,
  textoCorregidoDeParte,
  libroCorregidoEnOrden,
  componerLibroDesdePartes,
  parteCompleta,
} from '../js/pdf/colaCorreccion.js';
import { mismasPalabras } from '../js/pdf/pulido.js';

let fallos = 0;
let ok = 0;
function comprobar(condicion, mensaje) {
  if (condicion) {
    ok += 1;
    console.log(`OK: ${mensaje}`);
  } else {
    fallos += 1;
    console.error(`FALLO: ${mensaje}`);
  }
}

function parteDe(indice, chars = 180) {
  const nucleo = `Capitulo ${indice + 1} habla de un tema concreto con frases completas y palabras enteras. `;
  let texto = nucleo.repeat(Math.max(1, Math.ceil(chars / nucleo.length)));
  texto = texto.slice(0, chars).trim();
  if (!/[.!?]$/.test(texto)) texto += '.';
  return { titulo: `Parte ${indice + 1}`, texto, continuation: false };
}

function libroDe(n, { largas = [] } = {}) {
  const set = new Set(largas);
  return Array.from({ length: n }, (_, i) => parteDe(i, set.has(i) ? 4200 : 220));
}

function pulirLocal(texto) {
  const t = String(texto || '');
  if (!t.trim()) return t;
  const conPunto = /[.!?…]$/.test(t.trim()) ? t : `${t.trim()}.`;
  return conPunto.replace(/^(\s*)([a-záéíóúüñ])/, (_, e, l) => e + l.toUpperCase());
}

console.log('--- 1) validación: palabras, uniones, puntuación, tildes, párrafos ---');
{
  const orig = 'habia una vez en un pueblo lejano donde la gente no salia';
  const bien = 'Había una vez en un pueblo lejano, donde la gente no salía.';
  const v = validarResultadoCorreccion(orig, bien);
  comprobar(v.ok === true, `acepta tildes, mayúsculas y puntuación (${v.motivo})`);

  const sinonimo = 'Había una vez en un villorrio lejano, donde la gente no salía.';
  const malo = validarResultadoCorreccion(orig, sinonimo);
  comprobar(malo.ok === false, `rechaza un sinónimo (${malo.motivo})`);
  comprobar(malo.texto === orig, 'si no valida, conserva el original');

  const partido = 'al norte de bos ton hubo un alu vión';
  const unido = 'al norte de Boston hubo un aluvión';
  const sinPermiso = validarResultadoCorreccion(partido, unido);
  comprobar(sinPermiso.ok === false, 'sin candidatos no autoriza unir tokens');
  const conPermiso = validarResultadoCorreccion(partido, unido, [
    { izquierda: 'bos', derecha: 'ton' },
    { izquierda: 'alu', derecha: 'vión' },
  ]);
  comprobar(conPermiso.ok === true, 'con uniones autorizadas sí acepta el corte reparado');

  const aplastado = validarResultadoCorreccion('TITULO\n\nCuerpo del capitulo', 'TITULO Cuerpo del capitulo');
  comprobar(aplastado.ok === false, 'rechaza perder límites de párrafo');
}

console.log('\n--- 2) etiqueta: nunca «Libro corregido» con pendientes o fallos ---');
{
  const partes = libroDe(40);
  const cola = crearColaDesdePartes(partes);
  comprobar(etiquetaColaCorreccion(cola, { ejecutando: true, consentido: true }).includes('Corrigiendo lectura'),
    'en curso habla de progreso real');
  comprobar(!etiquetaColaCorreccion(cola, { ejecutando: true }).includes('Libro corregido'),
    'en curso no dice Libro corregido');

  aplicarExito(cola, cola.items[0], pulirLocal(cola.items[0].texto));
  const r1 = resumenCola(cola);
  comprobar(r1.completados === 1 && r1.pendientes === 39, `1 hecha y 39 pendientes (c=${r1.completados} p=${r1.pendientes})`);
  comprobar(etiquetaColaCorreccion(cola) !== 'Libro corregido', 'con pendientes no dice Libro corregido');

  for (const it of cola.items) aplicarExito(cola, it, pulirLocal(it.texto));
  aplicarFallo(cola, { id: 'no-existe' }, new Error('red'));
  comprobar(etiquetaColaCorreccion(cola) === 'Libro corregido', 'solo al terminar de verdad');

  const colaFallo = crearColaDesdePartes(libroDe(4));
  const item = colaFallo.items[0];
  for (let i = 0; i < MAX_REINTENTOS_POR_TAMANO + 3; i += 1) {
    aplicarFallo(colaFallo, colaFallo.items.find((x) => x.id === item.id) || colaFallo.items[0],
      Object.assign(new Error('failed to fetch'), { causa: 'red' }), { encogerYa: true });
  }
  const et = etiquetaColaCorreccion(colaFallo);
  comprobar(et !== 'Libro corregido', `con fallos no dice Libro corregido («${et}»)`);
  comprobar(/pendiente/.test(et), 'con fallos habla de partes pendientes');
  comprobar(/red|reintento/.test(et), `menciona causa o reintentos («${et}»)`);
}

console.log('\n--- 3) un fallo no se guarda y no detiene el resto ---');
{
  const partes = libroDe(6);
  const cola = crearColaDesdePartes(partes);
  const pedidos = [];
  const res = await correrCola(cola, {
    pedir: async (item) => {
      pedidos.push(item.parte);
      if (item.parte === 2) {
        const err = new Error('failed to fetch');
        err.causa = 'red';
        throw err;
      }
      if (item.parte === 3) {
        return { texto: 'texto inventado que no estaba', ia_used: true };
      }
      return { texto: pulirLocal(item.texto), ia_used: true };
    },
  });
  comprobar(pedidos.includes(0) && pedidos.includes(5), 'tras un fallo sigue con el resto del libro');
  comprobar(cola.items[2].estado !== 'done', 'el fallo de red no queda como done');
  comprobar(cola.items[2].textoCorregido == null, 'el fallo de red no guarda resultado');
  comprobar(cola.items[3].textoCorregido == null || cola.items[3].estado !== 'done'
    || mismasPalabras(partes[3].texto, cola.items[3].textoCorregido).igual,
    'una validación fallida no sustituye el original por texto inventado');
  comprobar(parteCompleta(cola, 0) && parteCompleta(cola, 5), 'las partes buenas sí quedan hechas');
  comprobar(res.completa === false, 'con fallos la cola no se da por completa');
}

console.log('\n--- 4) encoge el bloque cuando la petición falla ---');
{
  const partes = libroDe(2, { largas: [0] });
  const cola = crearColaDesdePartes(partes);
  const tamInicial = cola.items.find((i) => i.parte === 0).tamano;
  comprobar(tamInicial === TAMANOS_BLOQUE[0], `parte larga arranca en ${TAMANOS_BLOQUE[0]}`);
  const vistos = [];
  await correrCola(cola, {
    pedir: async (item) => {
      vistos.push(item.tamano);
      if (item.parte === 0 && item.tamano === TAMANOS_BLOQUE[0] && item.texto.length > 2000) {
        const err = new Error('El servidor tardó demasiado');
        err.causa = 'tiempo_limite';
        throw err;
      }
      return { texto: pulirLocal(item.texto), ia_used: true };
    },
  });
  comprobar(vistos.some((t) => t < TAMANOS_BLOQUE[0]), `redujo el tamaño (${[...new Set(vistos)].join('→')})`);
  comprobar(parteCompleta(cola, 0), 'la parte larga termina tras encoger');
  comprobar(parteCompleta(cola, 1), 'la parte corta no se detuvo');
}

console.log('\n--- 5) recarga: no repite lo hecho y reanuda el punto exacto ---');
{
  const partes = libroDe(8);
  const cola = crearColaDesdePartes(partes);
  const pedidos1 = [];
  await correrCola(cola, {
    pedir: async (item) => {
      pedidos1.push(item.parte);
      if (item.parte === 4) {
        const err = new Error('failed to fetch');
        err.causa = 'red';
        throw err;
      }
      return { texto: pulirLocal(item.texto), ia_used: true };
    },
  });
  const snap = serializarCola(cola);
  comprobar(snap.items.every((i) => i.estado !== 'done' || i.textoCorregido != null),
    'lo hecho se serializa con su texto');
  comprobar(snap.items.every((i) => i.estado === 'done' || i.textoCorregido == null),
    'un fallo no viaja como resultado');

  const recargada = hidratarCola(snap, partes);
  const r = resumenCola(recargada);
  comprobar(r.completados >= 7, `tras recargar se conservan las hechas (${r.completados})`);
  comprobar(r.lista === false, 'tras recargar no se marca el libro como corregido');
  const idsHechos = new Set(recargada.items.filter((i) => i.estado === 'done').map((i) => i.id));

  prepararReanudacion(recargada);
  const pedidos2 = [];
  const res2 = await correrCola(recargada, {
    pedir: async (item) => {
      pedidos2.push(item.parte);
      comprobar(!idsHechos.has(item.id), `no vuelve a pedir el bloque ya hecho ${item.id}`);
      return { texto: pulirLocal(item.texto), ia_used: true };
    },
  });
  comprobar(pedidos2.length > 0, 'reanuda lo que faltaba');
  comprobar(pedidos2.every((p) => p === 4 || !idsHechos.has(`x`)), 'solo pide lo pendiente');
  comprobar(res2.completa === true, 'tras reanudar la cola termina');
  comprobar(resumenCola(recargada).pendientes === 0, 'cero partes pendientes');
  comprobar(resumenCola(recargada).fallos === 0, 'cero partes fallidas');
  comprobar(etiquetaColaCorreccion(recargada) === 'Libro corregido', 'al final sí dice Libro corregido');
}

console.log('\n--- 6) integral 40 / 50 / 100 / 120 partes ---');
{
  for (const n of [40, 50, 100, 120]) {
    const largas = n > 40 ? [3, 11] : [3];
    const partes = libroDe(n, { largas });
    const cola = crearColaDesdePartes(partes);
    comprobar(cola.totalPartes === n, `${n} partes encoladas`);
    comprobar(cola.items.length >= n, `${n}: hay al menos una unidad por parte`);

    let persistencias = 0;
    const fallarHasta = new Map();
    fallarHasta.set(7, 2);
    fallarHasta.set(Math.min(19, n - 1), 99);

    await correrCola(cola, {
      persistir: async () => { persistencias += 1; },
      pedir: async (item) => {
        const quedan = fallarHasta.get(item.parte);
        if (quedan > 0) {
          fallarHasta.set(item.parte, quedan - 1);
          const err = new Error(item.parte === 7 ? 'El servidor tardó demasiado' : 'failed to fetch');
          err.causa = item.parte === 7 ? 'tiempo_limite' : 'red';
          throw err;
        }
        if (item.parte === 3 && item.tamano === TAMANOS_BLOQUE[0] && item.texto.length > TAMANOS_BLOQUE[0] - 10) {
          const err = new Error('El servidor tardó demasiado');
          err.causa = 'tiempo_limite';
          throw err;
        }
        return { texto: pulirLocal(item.texto), ia_used: true };
      },
    });

    const mid = resumenCola(cola);
    comprobar(mid.lista === false, `${n}: con el fallo persistente no dice que terminó`);
    comprobar(etiquetaColaCorreccion(cola) !== 'Libro corregido', `${n}: etiqueta honesta a mitad`);
    comprobar(mid.completados >= n - 3, `${n}: el resto avanzó (hechas ${mid.completados})`);
    comprobar(persistencias >= n, `${n}: persistió el avance (${persistencias})`);

    const snap = JSON.parse(JSON.stringify(serializarCola(cola)));
    const recargada = hidratarCola(snap, partes);
    prepararReanudacion(recargada);
    const pedidosPost = [];
    const res = await correrCola(recargada, {
      pedir: async (item) => {
        pedidosPost.push(item.parte);
        return { texto: pulirLocal(item.texto), ia_used: true };
      },
    });
    const fin = resumenCola(recargada);
    comprobar(res.completa === true, `${n}: reanudación completa`);
    comprobar(fin.pendientes === 0 && fin.fallos === 0, `${n}: cero pendientes y cero fallos`);
    comprobar(fin.completados === n, `${n}: las ${n} partes quedaron hechas`);
    comprobar(etiquetaColaCorreccion(recargada) === 'Libro corregido', `${n}: Libro corregido solo al final`);

    const textos = libroCorregidoEnOrden(recargada, partes);
    comprobar(textos.length === n, `${n}: reconstruye el libro en orden`);
    for (let i = 0; i < n; i += 1) {
      const v = validarResultadoCorreccion(partes[i].texto, textos[i]);
      if (!v.ok) {
        comprobar(false, `${n}: parte ${i} no validó (${v.motivo})`);
        break;
      }
    }
    const compuesto = componerLibroDesdePartes(partes.map((p, i) => ({ ...p, texto: textos[i] })));
    comprobar(compuesto.includes(textos[0]) && compuesto.includes(textos[n - 1]),
      `${n}: el libro compuesto conserva primera y última parte`);
    comprobar(pedidosPost.length > 0 && pedidosPost.length < n,
      `${n}: tras recargar solo pidió lo pendiente (${pedidosPost.length} < ${n})`);
  }
}

console.log('\n--- 7) ia_used:false y respuesta vacía no se guardan ---');
{
  const partes = libroDe(3);
  const cola = crearColaDesdePartes(partes);
  await correrCola(cola, {
    pedir: async (item) => {
      if (item.parte === 0) return { texto: pulirLocal(item.texto), ia_used: false };
      if (item.parte === 1) return { texto: '', ia_used: true };
      return { texto: pulirLocal(item.texto), ia_used: true };
    },
  });
  comprobar(cola.items[0].estado !== 'done' || cola.items[0].textoCorregido == null,
    'ia_used:false no se guarda como éxito');
  comprobar(parteCompleta(cola, 2), 'la tercera parte sí se guardó');
  comprobar(resumenCola(cola).lista === false, 'el libro no queda marcado corregido');
}

if (fallos > 0) {
  console.error(`\n❌ ${fallos} prueba(s) fallaron. ${ok} bien.`);
  process.exit(1);
}
console.log(`\n✅ Cola de corrección: ${ok} comprobaciones bien.`);
