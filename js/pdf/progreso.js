/* JG Turbo · Progreso de lectura de un documento
 *
 * Responde a tres preguntas que el usuario hace todo el tiempo: ¿por dónde
 * iba?, ¿cuánto llevo? y ¿este libro ya lo terminé?
 *
 * El porcentaje se calcula **por tamaño de cada capítulo**, no por número:
 * terminar un capítulo de dos páginas no puede valer lo mismo que uno de
 * cuarenta, o la barra mentiría.
 *
 * Funciones puras: entran datos, salen datos. Por eso se pueden probar sin
 * navegador ni base de datos.
 */

/* Con esto o más se considera terminado: nadie lee las últimas líneas de
 * agradecimientos, y quedarse en 99 % para siempre es frustrante. */
const UMBRAL_TERMINADO = 98;

const acotar = (valor, minimo, maximo) => Math.max(minimo, Math.min(maximo, valor));

/** Progreso de un documento recién abierto. */
export function progresoInicial() {
  return { parte: 0, desplazamiento: 0, maxParte: 0, actualizado: 0 };
}

/** Tamaño de cada capítulo, para que el porcentaje sea honesto. */
function pesos(partes) {
  const lista = Array.isArray(partes) ? partes : [];
  const tamanos = lista.map((p) => Math.max(1, String(p?.texto || '').length));
  const total = tamanos.reduce((suma, n) => suma + n, 0);
  return { tamanos, total };
}

/**
 * Porcentaje leído del documento completo (0-100, entero).
 * @param {{parte:number, desplazamiento:number}|null} progreso
 * @param {{texto:string}[]} partes
 */
export function calcularPorcentaje(progreso, partes) {
  const { tamanos, total } = pesos(partes);
  if (!tamanos.length || !total) return 0;
  if (!progreso) return 0;

  const parte = acotar(Math.floor(progreso.parte ?? 0), 0, tamanos.length - 1);
  const dentro = acotar(Number(progreso.desplazamiento) || 0, 0, 1);

  let leido = 0;
  for (let i = 0; i < parte; i += 1) leido += tamanos[i];
  leido += tamanos[parte] * dentro;

  /* Si el progreso guardado apunta más allá del final (por ejemplo, el
   * documento se reprocesó con menos páginas), se recorta en vez de mentir. */
  if ((progreso.parte ?? 0) >= tamanos.length) return 100;

  const bruto = acotar((leido / total) * 100, 0, 100);
  /* Haber empezado nunca es cero. En un libro de mil páginas, cinco capítulos
   * leídos daban 0,2 % → redondeaba a 0 → el libro seguía marcado «Sin
   * empezar» y no aparecía en «Seguir leyendo». Quien ya abrió y avanzó no
   * está en la casilla de salida. */
  if (bruto > 0 && bruto < 1) return 1;
  return Math.round(bruto);
}

/** Estado del documento a partir de su porcentaje. */
export function estadoDeLectura(porcentaje) {
  const pct = Number(porcentaje) || 0;
  if (pct <= 0) return 'sin-empezar';
  if (pct >= UMBRAL_TERMINADO) return 'terminado';
  return 'leyendo';
}

export function etiquetaEstado(estado) {
  return {
    'sin-empezar': 'Sin empezar',
    leyendo: 'Leyendo',
    terminado: 'Terminado',
  }[estado] || 'Sin empezar';
}

/** Frase corta para mostrar debajo del título: «CAPÍTULO II · 45 %». */
export function etiquetaProgreso(progreso, partes) {
  const porcentaje = calcularPorcentaje(progreso, partes);
  if (porcentaje <= 0) return 'Sin empezar';
  const lista = Array.isArray(partes) ? partes : [];
  const indice = acotar(Math.floor(progreso?.parte ?? 0), 0, Math.max(0, lista.length - 1));
  const titulo = lista[indice]?.titulo;
  if (lista.length <= 1 || !titulo) return `${porcentaje} %`;
  return `${titulo} · ${porcentaje} %`;
}

/**
 * Nueva posición de lectura. Conserva el capítulo más lejano alcanzado, para
 * que volver atrás a releer no borre lo que ya llevabas.
 */
export function avanzarProgreso(progreso, { parte, desplazamiento }) {
  const anterior = progreso || progresoInicial();
  const parteLimpia = Math.max(0, Math.floor(Number(parte) || 0));
  return {
    parte: parteLimpia,
    desplazamiento: acotar(Number(desplazamiento) || 0, 0, 1),
    maxParte: Math.max(anterior.maxParte ?? 0, parteLimpia),
    actualizado: Date.now(),
  };
}

/** Estado de un capítulo concreto, para pintarlo en el índice. */
export function progresoDeCapitulo(indice, progreso) {
  const actual = progreso?.parte ?? 0;
  const maximo = Math.max(progreso?.maxParte ?? 0, actual);
  if (indice === actual) return 'leyendo';
  if (indice < actual || indice <= maximo) return 'leido';
  return 'pendiente';
}

/** Tamaños en palabras del día a día, con coma decimal (Colombia). */
export function formatearTamano(bytes) {
  const n = Number(bytes) || 0;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  const conUnidad = (valor, unidad) => {
    const redondeado = Math.round(valor * 10) / 10;
    const texto = Number.isInteger(redondeado) ? String(redondeado) : String(redondeado).replace('.', ',');
    return `${texto} ${unidad}`;
  };
  if (n < 1024 * 1024 * 1024) return conUnidad(n / (1024 * 1024), 'MB');
  return conUnidad(n / (1024 * 1024 * 1024), 'GB');
}
