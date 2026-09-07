/* Pruebas de la corrección portable entre dispositivos.
 * Ejecutar: node tests/test_pdf_correccion_sync.mjs
 *
 * Lo que se juega aquí: que lo corregido en el celular llegue a la tablet sin
 * pedir el PDF, y que un archivo de copia extraño no rompa la biblioteca.
 * Todo puro y sin IndexedDB.
 */
import {
  paqueteCorreccionSync, correccionSyncValida, confiarEnCorreccionSync,
  VERSION_CORRECCION_SYNC, VERSION_RECONSTRUCCION, VERSION_TROCEO,
} from '../js/pdf/manifiesto.js';
import {
  validarCopiaCompartir, componerRegistroDocumento,
} from '../js/pdf/biblioteca.js';
import { esSincronizable } from '../js/pdf/sincronizacion.js';

let fallos = 0;
function comprobar(condicion, mensaje) {
  if (condicion) console.log(`OK: ${mensaje}`);
  else { fallos += 1; console.error(`FALLO: ${mensaje}`); }
}

const limite = (id, decision = 'pending', source = 'pdf') => ({
  id, k: 'renglon', d: decision, s: source, q: 0,
  lf: 'toma', rf: 'dos', la: `a${id}`, ra: `b${id}`, os: ' ',
});

/* ── Paquete portable ─────────────────────────────────────────────── */
{
  const paquete = paqueteCorreccionSync(
    [limite('l1', 'join', 'user'), limite('l2'), limite('l3', 'space', 'ai')],
    { pendientesLimites: 1, versionReconstruccion: VERSION_RECONSTRUCCION, versionTroceo: VERSION_TROCEO },
  );
  comprobar(paquete.v === VERSION_CORRECCION_SYNC, 'el paquete lleva su versión');
  comprobar(paquete.manifiesto.length === 3, 'viajan decididos y pendientes');
  comprobar(paquete.pendientes === 1, 'los pendientes viajan contados');
  comprobar(Number(paquete.ver.rec) >= VERSION_RECONSTRUCCION, 'la versión viaja anotada');
  comprobar(correccionSyncValida(paquete) === true, 'el paquete propio es válido');
}

{
  /* Libro enorme: se trunca con aviso en vez de tumbar la subida. */
  const muchos = Array.from({ length: 20000 }, (_, i) => limite(`l${i}`, i % 2 ? 'join' : 'pending', 'user'));
  const paquete = paqueteCorreccionSync(muchos, {});
  comprobar(paquete.truncado === true, 'un manifiesto gigante se trunca con aviso');
  comprobar(JSON.stringify(paquete).length <= 500000, 'el truncado respeta el techo');
  const decidido = paquete.manifiesto.find((l) => l.id === 'l1');
  comprobar(Boolean(decidido), 'al truncar se conserva lo decidido por la persona');
}

{
  comprobar(correccionSyncValida(null) === false, 'nulo no es válido');
  comprobar(correccionSyncValida({}) === false, 'vacío no es válido');
  comprobar(correccionSyncValida({ v: 99, manifiesto: [] }) === false, 'otra versión no es válida');
  comprobar(correccionSyncValida({ v: 1, manifiesto: [{ id: 'x' }] }) === false, 'sin átomos no es suficiente');
}

/* ── Confianza sin PDF ────────────────────────────────────────────── */
{
  const buena = paqueteCorreccionSync([limite('l1', 'join', 'user')], {
    versionReconstruccion: VERSION_RECONSTRUCCION, versionTroceo: VERSION_TROCEO,
  });
  const r = confiarEnCorreccionSync({ tieneArchivo: false }, buena);
  comprobar(r.confiar === true, 'con manifiesto vigente se confía sin pedir el PDF');

  const vieja = paqueteCorreccionSync([limite('l1', 'join', 'user')], {
    versionReconstruccion: VERSION_RECONSTRUCCION - 1, versionTroceo: VERSION_TROCEO,
  });
  /* El paquete guarda la versión que se le pasa. */
  comprobar(vieja.ver.rec === VERSION_RECONSTRUCCION - 1, 'la versión vieja queda anotada');
  const r2 = confiarEnCorreccionSync({}, vieja);
  comprobar(r2.confiar === false && r2.motivo === 'version_anterior', 'con versión vieja no se confía');

  const r3 = confiarEnCorreccionSync({}, null);
  comprobar(r3.confiar === false, 'sin paquete no se confía');
}

/* ── Copias para compartir ────────────────────────────────────────── */
{
  const copia = {
    app: 'jg-turbo-copia', v: 1, exportadoEn: 1000, titulo: 'Libro',
    meta: { id: 'lib1', titulo: 'Libro' },
    partes: [{ titulo: 'Cap 1', texto: 'hola mundo' }],
  };
  comprobar(validarCopiaCompartir(copia).ok === true, 'una copia bien armada es válida');
  comprobar(validarCopiaCompartir(null).ok === false, 'nulo no es copia');
  comprobar(validarCopiaCompartir({}).ok === false, 'vacío no es copia');
  comprobar(validarCopiaCompartir({ ...copia, app: 'otra' }).ok === false, 'otra app no es copia');
  comprobar(validarCopiaCompartir({ ...copia, v: 2 }).ok === false, 'otra versión no es copia');
  comprobar(validarCopiaCompartir({ ...copia, partes: [] }).ok === false, 'sin capítulos no es copia');
  comprobar(validarCopiaCompartir({ ...copia, partes: [{ titulo: 'x' }] }).ok === false, 'capítulo sin texto no es copia');
}

/* ── Lo privado y los pedidos sobreviven al guardado ──────────────── */
{
  const previo = { id: 'a', titulo: 'A', actualizado: 100 };
  const reg = componerRegistroDocumento(previo, {
    id: 'a', titulo: 'A', actualizado: 200, sincronizar: false, pideFuente: { de: 'tablet', cuando: 200 },
  }, {});
  comprobar(reg.sincronizar === false, 'la marca privada sobrevive al guardado');
  comprobar(esSincronizable(reg) === false, 'lo privado no es sincronizable');
  comprobar(reg.pideFuente?.de === 'tablet', 'el pedido de fuente sobrevive al guardado');
}

console.log(fallos === 0 ? 'TODAS LAS COMPROBACIONES PASARON' : `FALLOS: ${fallos}`);
process.exit(fallos === 0 ? 0 : 1);
