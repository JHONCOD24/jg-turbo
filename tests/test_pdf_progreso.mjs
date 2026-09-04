/* Pruebas del progreso de lectura: por dónde va el usuario, cuánto lleva
 * y en qué estado está cada documento de la biblioteca.
 * Ejecutar: node tests/test_pdf_progreso.mjs
 */
import {
  calcularPorcentaje, estadoDeLectura, etiquetaProgreso, etiquetaEstado,
  progresoInicial, avanzarProgreso, progresoDeCapitulo, formatearTamano, etiquetaReanudar,
} from '../js/pdf/progreso.js';

let fallos = 0;
function comprobar(condicion, mensaje) {
  if (condicion) console.log(`OK: ${mensaje}`);
  else { fallos += 1; console.error(`FALLO: ${mensaje}`); }
}

const PARTES = [
  { titulo: 'CAPÍTULO I', texto: 'a'.repeat(1000) },
  { titulo: 'CAPÍTULO II', texto: 'b'.repeat(3000) },
  { titulo: 'CAPÍTULO III', texto: 'c'.repeat(1000) },
  { titulo: 'CAPÍTULO IV', texto: 'd'.repeat(5000) },
];

/* ── Porcentaje ────────────────────────────────────────────────────── */
{
  comprobar(calcularPorcentaje(progresoInicial(), PARTES) === 0, 'un documento sin abrir va en 0 %');
  comprobar(
    calcularPorcentaje({ parte: 3, desplazamiento: 1 }, PARTES) === 100,
    'al final del último capítulo va en 100 %'
  );
  /* El peso de cada capítulo es su tamaño, no «uno de cuatro»: terminar un
   * capítulo corto no puede valer lo mismo que terminar uno largo. */
  const trasPrimero = calcularPorcentaje({ parte: 1, desplazamiento: 0 }, PARTES);
  comprobar(trasPrimero === 10, `terminar el capítulo corto avanza según su tamaño (${trasPrimero} %)`);
  const mitadDelLargo = calcularPorcentaje({ parte: 3, desplazamiento: 0.5 }, PARTES);
  comprobar(mitadDelLargo === 75, `media mitad del capítulo largo pesa más (${mitadDelLargo} %)`);
  comprobar(
    calcularPorcentaje({ parte: 0, desplazamiento: 0.5 }, PARTES) === 5,
    'a mitad del primer capítulo va en 5 %'
  );
}

{
  comprobar(calcularPorcentaje({ parte: 0, desplazamiento: 0 }, []) === 0, 'sin capítulos no revienta');
  comprobar(calcularPorcentaje(null, PARTES) === 0, 'sin progreso guardado empieza en 0');
  comprobar(
    calcularPorcentaje({ parte: 99, desplazamiento: 5 }, PARTES) === 100,
    'un progreso fuera de rango se recorta a 100, no da 400 %'
  );
  comprobar(
    calcularPorcentaje({ parte: -3, desplazamiento: -1 }, PARTES) === 0,
    'un progreso negativo se recorta a 0'
  );
}

/* ── Estado ────────────────────────────────────────────────────────── */
{
  comprobar(estadoDeLectura(0) === 'sin-empezar', 'sin abrir: sin empezar');
  comprobar(estadoDeLectura(1) === 'leyendo', 'con solo empezarlo ya está en leyendo');
  comprobar(estadoDeLectura(55) === 'leyendo', 'a mitad: leyendo');
  comprobar(estadoDeLectura(98) === 'terminado', 'casi al final ya cuenta como terminado');
  comprobar(estadoDeLectura(100) === 'terminado', 'al final: terminado');
  comprobar(etiquetaEstado('sin-empezar') === 'Sin empezar', 'la etiqueta de sin empezar se entiende');
  comprobar(etiquetaEstado('leyendo') === 'Leyendo', 'la etiqueta de leyendo se entiende');
  comprobar(etiquetaEstado('terminado') === 'Terminado', 'la etiqueta de terminado se entiende');
}

/* ── Etiqueta para el usuario ──────────────────────────────────────── */
{
  const texto = etiquetaProgreso({ parte: 1, desplazamiento: 0.5 }, PARTES);
  comprobar(texto.includes('CAPÍTULO II'), 'la etiqueta dice en qué capítulo va');
  comprobar(/%/.test(texto), 'la etiqueta incluye el porcentaje');
  comprobar(
    etiquetaProgreso(progresoInicial(), PARTES).toLowerCase().includes('sin empezar'),
    'un documento sin abrir lo dice en palabras'
  );
  comprobar(
    etiquetaProgreso({ parte: 0, desplazamiento: 0 }, [{ titulo: 'Documento completo', texto: 'x'.repeat(50) }])
      .toLowerCase().includes('sin empezar'),
    'con un solo capítulo tampoco inventa números raros'
  );
}

/* ── Avanzar ───────────────────────────────────────────────────────── */
{
  const inicial = progresoInicial();
  const tras = avanzarProgreso(inicial, { parte: 2, desplazamiento: 0.4 });
  comprobar(tras.parte === 2 && Math.abs(tras.desplazamiento - 0.4) < 1e-9, 'guarda dónde quedó la lectura');
  comprobar(tras.maxParte === 2, 'recuerda el capítulo más lejano alcanzado');

  /* Volver atrás a releer no debe borrar lo ya leído. */
  const atras = avanzarProgreso(tras, { parte: 0, desplazamiento: 0.1 });
  comprobar(atras.parte === 0, 'si vuelves atrás, la posición actual es la de atrás');
  comprobar(atras.maxParte === 2, 'pero el capítulo más lejano se conserva');

  const fuera = avanzarProgreso(inicial, { parte: 1, desplazamiento: 7 });
  comprobar(fuera.desplazamiento === 1, 'un desplazamiento imposible se recorta a 1');
  const negativo = avanzarProgreso(inicial, { parte: -5, desplazamiento: -2 });
  comprobar(negativo.parte === 0 && negativo.desplazamiento === 0, 'valores negativos se recortan a 0');
}

/* ── Progreso por capítulo (para el índice) ────────────────────────── */
{
  const progreso = { parte: 2, desplazamiento: 0.5, maxParte: 2 };
  comprobar(progresoDeCapitulo(0, progreso) === 'leido', 'un capítulo anterior aparece como leído');
  comprobar(progresoDeCapitulo(2, progreso) === 'leyendo', 'el capítulo actual aparece como en curso');
  comprobar(progresoDeCapitulo(3, progreso) === 'pendiente', 'un capítulo posterior aparece como pendiente');
  comprobar(
    progresoDeCapitulo(1, { parte: 0, desplazamiento: 0, maxParte: 3 }) === 'leido',
    'un capítulo ya visitado sigue contando como leído aunque hayas vuelto atrás'
  );
}

/* ── Tamaños legibles ──────────────────────────────────────────────── */
{
  comprobar(formatearTamano(0) === '0 KB', 'cero se muestra sin decimales raros');
  comprobar(formatearTamano(1024) === '1 KB', 'mil bytes son 1 KB');
  comprobar(formatearTamano(1536 * 1024) === '1,5 MB', 'usa coma decimal, como en Colombia');
  comprobar(formatearTamano(2.5 * 1024 * 1024 * 1024) === '2,5 GB', 'los gigas también');
  comprobar(formatearTamano(null) === '0 KB', 'un valor vacío no rompe la interfaz');
}

/* ── Ancla de posición exacta (v5) ─────────────────────────────────── */
{
  const base = progresoInicial();
  comprobar(base.caracter === 0 && base.cita === '', 'el progreso inicial trae ancla vacía');

  const conAncla = avanzarProgreso(base, { parte: 1, desplazamiento: 0.5, caracter: 820, cita: 'Y entonces', antes: 'igual. ' });
  comprobar(conAncla.caracter === 820 && conAncla.cita === 'Y entonces', 'guarda el ancla que recibe');

  /* Un guardado por scroll (sin ancla) no puede borrar la posición exacta
   * que acababa de dejar la voz: sería perder el punto justo al desplazarse. */
  const trasScroll = avanzarProgreso(conAncla, { parte: 1, desplazamiento: 0.55 });
  comprobar(trasScroll.caracter === 820 && trasScroll.cita === 'Y entonces', 'un guardado sin ancla conserva la anterior');

  /* Pero al cambiar de capítulo el ancla del anterior ya no significa nada. */
  const otroCapitulo = avanzarProgreso(conAncla, { parte: 2, desplazamiento: 0 });
  comprobar(otroCapitulo.caracter === 0 && otroCapitulo.cita === '', 'cambiar de capítulo limpia el ancla');
}

/* ── Frase de reanudación ──────────────────────────────────────────── */
{
  const AHORA = 1_700_000_000_000;
  const hace = (ms) => ({ parte: 1, desplazamiento: 0.5, caracter: 100, actualizado: AHORA - ms });

  comprobar(etiquetaReanudar(hace(30 * 1000), PARTES, AHORA).includes('hace un momento'),
    'medio minuto es "hace un momento"');
  comprobar(etiquetaReanudar(hace(20 * 60 * 1000), PARTES, AHORA).includes('hace 20 minutos'),
    'veinte minutos se dicen en minutos');
  comprobar(etiquetaReanudar(hace(3 * 3600 * 1000), PARTES, AHORA).includes('hace 3 horas'),
    'tres horas se dicen en horas');
  comprobar(etiquetaReanudar(hace(2 * 86400 * 1000), PARTES, AHORA).includes('hace 2 días'),
    'dos dias se dicen en dias');
  comprobar(etiquetaReanudar(hace(60 * 1000), PARTES, AHORA).includes('CAPÍTULO II'),
    'nombra el capitulo donde quedo');
  comprobar(etiquetaReanudar(null, PARTES, AHORA) === '',
    'sin progreso no dice nada');
  comprobar(etiquetaReanudar(progresoInicial(), PARTES, AHORA) === '',
    'un libro sin empezar no dice nada');
}

console.log(fallos === 0 ? '\nTodas las pruebas de progreso pasaron.' : `\n${fallos} prueba(s) fallaron.`);
process.exit(fallos === 0 ? 0 : 1);
