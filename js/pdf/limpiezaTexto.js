/* JG Turbo · Limpieza del texto de un PDF
 *
 * Un PDF no guarda párrafos: guarda trocitos de texto con coordenadas.
 * Si los pegamos tal cual, un libro queda con un salto de línea por cada
 * renglón, palabras partidas por guiones, y el título y el número de página
 * repetidos cada dos frases. Así no se puede leer, ni traducir, ni escuchar.
 *
 * Este archivo hace ese trabajo sucio con funciones puras (entra texto y
 * posiciones, sale texto limpio), por eso se puede probar sin abrir un PDF.
 */

/* Cuántas páginas hacen falta para fiarnos de que algo repetido es relleno. */
const MIN_PAGINAS_PARA_DETECTAR_RELLENO = 3;
/* Proporción de páginas en las que debe salir una línea para considerarla relleno. */
const PROPORCION_RELLENO = 0.4;
/* Una cabecera o un pie de página nunca es un párrafo largo. */
const MAX_LARGO_RELLENO = 90;
/* Un título de capítulo tampoco es largo. */
const MAX_LARGO_TITULO = 80;

const PATRON_TITULO =
  /^(cap[íi]tulo|chapter|parte\b|part\b|secci[óo]n|libro\s+(primero|segundo|tercero|[ivxlcdm]+|\d+)|tomo|ep[íi]logo|pr[óo]logo|pr[eó]logo|introducci[óo]n|conclusi[óo]n|anexo|ap[ée]ndice|bibliograf[íi]a|[íi]ndice|prefacio|agradecimientos)\b/i;

const PATRON_ROMANO = /^m{0,3}(cm|cd|d?c{0,3})(xc|xl|l?x{0,3})(ix|iv|v?i{0,3})$/i;
/* Palabras españolas que por casualidad se escriben como números romanos. */
const ROMANOS_QUE_SON_PALABRAS = new Set(['mi', 'di', 'vi', 'ci', 'li', 'id', 'mil', 'civil']);

/* Ligaduras tipográficas: los libros las usan y rompen la lectura en voz alta. */
const LIGADURAS = [
  [/ﬀ/g, 'ff'], [/ﬁ/g, 'fi'], [/ﬂ/g, 'fl'],
  [/ﬃ/g, 'ffi'], [/ﬄ/g, 'ffl'], [/ﬅ/g, 'st'], [/ﬆ/g, 'st'],
];

/* Guiones que un PDF puede usar para partir una palabra al final del renglón. */
const GUIONES_DE_CORTE = /[-‐­‑]$/;

/* ── Utilidades pequeñas ───────────────────────────────────────────── */

function mediana(numeros) {
  const validos = numeros.filter((n) => Number.isFinite(n) && n > 0).sort((a, b) => a - b);
  if (!validos.length) return 0;
  const medio = Math.floor(validos.length / 2);
  return validos.length % 2 ? validos[medio] : (validos[medio - 1] + validos[medio]) / 2;
}

function sinTildes(texto) {
  return texto.normalize('NFD').replace(/[̀-ͯ]/g, '');
}

/** Clave para comparar líneas de páginas distintas: ignora números y mayúsculas,
 *  porque «Página 12 · Historia» y «Página 13 · Historia» son la misma cabecera. */
export function normalizarClave(texto) {
  return sinTildes(String(texto || '').toLowerCase())
    .replace(/\d+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** ¿Esta línea es solo el número de página? («12», «— 128 —», «xiv») */
export function esNumeroDePagina(texto) {
  const bruto = String(texto || '').trim();
  if (!bruto || bruto.length > 24) return false;
  const nucleo = bruto.replace(/^[\s\-–—·•|*[\](){}<>."']+|[\s\-–—·•|*[\](){}<>."']+$/g, '').trim();
  if (!nucleo) return false;
  /* Hasta tres cifras es un número de página; cuatro ya parece un año o un dato. */
  if (/^\d{1,3}$/.test(nucleo)) return true;
  const posibleRomano = nucleo.toLowerCase();
  if (
    PATRON_ROMANO.test(posibleRomano) &&
    posibleRomano.length > 0 &&
    !ROMANOS_QUE_SON_PALABRAS.has(posibleRomano)
  ) return true;
  return false;
}

/* ── Fragmentos sueltos → líneas ───────────────────────────────────── */

/**
 * pdf.js entrega trocitos con su posición. Los junta en líneas legibles:
 * misma altura = misma línea, y pone un espacio solo si de verdad hay hueco.
 * @param {{str:string,x:number,y:number,altura:number,ancho:number}[]} items
 */
export function agruparLineas(items) {
  const utiles = (items || []).filter((it) => it && typeof it.str === 'string' && it.str.length);
  if (!utiles.length) return [];

  const alturaTipica = mediana(utiles.map((it) => it.altura)) || 10;
  const tolerancia = Math.max(1.5, alturaTipica * 0.45);

  const grupos = [];
  for (const item of utiles) {
    const grupo = grupos.find((g) => Math.abs(g.y - item.y) <= tolerancia);
    if (grupo) {
      grupo.items.push(item);
      /* La referencia se afina con el promedio para que no derive. */
      grupo.y = (grupo.y * (grupo.items.length - 1) + item.y) / grupo.items.length;
    } else {
      grupos.push({ y: item.y, items: [item] });
    }
  }

  return grupos
    .sort((a, b) => b.y - a.y) /* En un PDF, la Y grande está arriba. */
    .map((grupo) => {
      const ordenados = grupo.items.slice().sort((a, b) => a.x - b.x);
      let texto = '';
      let finAnterior = null;
      for (const item of ordenados) {
        const altura = item.altura || alturaTipica;
        const hueco = finAnterior == null ? 0 : item.x - finAnterior;
        const necesitaEspacio =
          finAnterior != null &&
          hueco > Math.max(1, altura * 0.15) &&
          !/\s$/.test(texto) &&
          !/^\s/.test(item.str);
        texto += (necesitaEspacio ? ' ' : '') + item.str;
        finAnterior = item.x + (item.ancho || 0);
      }
      const primero = ordenados[0];
      const ultimo = ordenados[ordenados.length - 1];
      return {
        texto: texto.replace(/\s+/g, ' ').trim(),
        x: primero.x,
        y: grupo.y,
        altura: mediana(ordenados.map((i) => i.altura)) || alturaTipica,
        ancho: Math.max(0, ultimo.x + (ultimo.ancho || 0) - primero.x),
      };
    })
    .filter((l) => l.texto.length > 0);
}

/* ── Relleno repetido (cabeceras y pies) ───────────────────────────── */

/** Marca las líneas que se repiten en el borde de muchas páginas: son relleno. */
function detectarRelleno(paginas) {
  const marcadas = new Set();
  if (paginas.length < MIN_PAGINAS_PARA_DETECTAR_RELLENO) return marcadas;

  const conteo = new Map();
  for (const pag of paginas) {
    const lineas = pag.lineas || [];
    if (!lineas.length) continue;
    const alto = pag.alto || 0;
    const candidatas = new Set();
    /* Por posición: franja superior e inferior de la hoja. */
    if (alto > 0) {
      for (const l of lineas) {
        if (l.y >= alto * 0.88 || l.y <= alto * 0.12) candidatas.add(l);
      }
    }
    /* Y siempre la primera y la última línea, por si no sabemos el alto. */
    candidatas.add(lineas[0]);
    candidatas.add(lineas[lineas.length - 1]);

    const clavesDeEstaPagina = new Set();
    for (const l of candidatas) {
      if (!l || l.texto.length > MAX_LARGO_RELLENO) continue;
      clavesDeEstaPagina.add(normalizarClave(l.texto));
    }
    for (const clave of clavesDeEstaPagina) {
      if (clave) conteo.set(clave, (conteo.get(clave) || 0) + 1);
    }
  }

  const minimo = Math.max(MIN_PAGINAS_PARA_DETECTAR_RELLENO, Math.ceil(paginas.length * PROPORCION_RELLENO));
  for (const [clave, veces] of conteo) {
    if (veces >= minimo) marcadas.add(clave);
  }
  return marcadas;
}

/* ── Títulos de capítulo ───────────────────────────────────────────── */

function pareceTitulo(linea, alturaModal) {
  const texto = linea.texto.trim();
  if (!texto || texto.length > MAX_LARGO_TITULO) return false;
  if (/[,;:]$/.test(texto)) return false;
  if (esNumeroDePagina(texto)) return false;
  if (PATRON_TITULO.test(texto)) return true;
  /* Un título también se reconoce porque está impreso más grande. */
  if (alturaModal > 0 && linea.altura >= alturaModal * 1.25) return true;
  return false;
}

/* ── Composición final ─────────────────────────────────────────────── */

/**
 * Deja el texto listo para leer y para que el motor de voz sepa dónde parar.
 * Función pura: NO cambia ninguna palabra, solo signos y espacios.
 *
 * @param {string} texto
 * @returns {string}
 */
export function pulirParaLectura(texto) {
  if (!texto || typeof texto !== 'string') return '';
  let salida = texto;

  /* 1) Ligaduras tipográficas */
  for (const [patron, reemplazo] of LIGADURAS) salida = salida.replace(patron, reemplazo);

  /* 2) Limpieza de caracteres de control y espacios raros */
  salida = salida
    .replace(/[\u00A0\u2007\u202F]/g, ' ')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
    .replace(/[ \t]+/g, ' ');

  /* 3) Puntos suspensivos (3 o más seguidos → …) */
  salida = salida.replace(/\.{3,}/g, '…');

  /* 4) Guiones de diálogo al inicio de línea o acotaciones */
  salida = salida.replace(/(^|\n)[ \t]*[-–—][ \t]*/g, '$1—');
  salida = salida.replace(/[ \t]+[-–—][ \t]*/g, ' —');

  /* 5) Comillas rectas → tipográficas por pares */
  let enComillas = false;
  salida = salida.replace(/"/g, () => {
    enComillas = !enComillas;
    return enComillas ? '«' : '»';
  });

  /* 6) Espaciado en signos de puntuación */
  salida = salida.replace(/[ \t]+([,.;:!?\)\]\}»])/g, '$1');
  salida = salida.replace(/([,;:])([a-zA-ZáéíóúüñÁÉÍÓÚÜÑ])/g, '$1 $2');
  salida = salida.replace(/([!?…])([a-zA-ZáéíóúüñÁÉÍÓÚÜÑ])/g, '$1 $2');
  salida = salida.replace(/(\.)([A-ZÁÉÍÓÚÜÑ])/g, '$1 $2');

  /* 7) Signos de apertura sin espacio posterior */
  salida = salida.replace(/([¡¿])[ \t]+/g, '$1');

  /* 8) Cerrar párrafos que terminan en letra o número sin signo */
  const parrafos = salida.split(/\n\n+/);
  const parrafosLimpios = parrafos.map((p) => {
    let tr = p.trim();
    if (!tr) return '';
    if (/[a-zA-Z0-9áéíóúüñÁÉÍÓÚÜÑ]$/.test(tr)) {
      tr += '.';
    }
    return tr;
  });
  salida = parrafosLimpios.filter(Boolean).join('\n\n');

  /* 9) Mayúscula tras punto / exclamación / interrogación / elipsis */
  salida = salida.replace(/([.!?…]\s+)([a-záéíóúüñ])/g, (_, prefix, letter) => prefix + letter.toUpperCase());
  salida = salida.replace(/^[a-záéíóúüñ]/, (c) => c.toUpperCase());

  // 10) Sin comas heurísticas: la puntuación automática solo cierra
  // párrafos sin signo (regla 8) y normaliza espacios; las comas internas
  // pasan a propuestas revisables en auditoría, no a inserción automática.
  // Se mantiene solo limpieza de doble coma si la generó otra regla.
  salida = salida.replace(/,\s*,\s*/g, ', ');

  return salida
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function pulirTipografia(texto) {
  return pulirParaLectura(texto);
}

/**
 * Convierte las páginas de un PDF en texto seguido y legible.
 *
 * @param {{numero:number, lineas:object[], alto?:number, ancho?:number}[]} paginas
 * @param {{indice?:{titulo:string,pagina:number}[]}} opciones
 * @returns {{texto:string, capitulos:object[], descartadas:number,
 *            paginasConTexto:number, paginasTotales:number}}
 */
export function detectarEstructuraColumnas(pagina) {
  const lineas = pagina.lineas || [];
  if (lineas.length < 6) return { columnas: 1, divisionX: null };
  const xs = lineas.map((l) => l.x).sort((a, b) => a - b);
  // buscar hueco grande en distribución X
  let maxHueco = 0, idxHueco = -1;
  for (let i = 1; i < xs.length; i += 1) {
    const hueco = xs[i] - xs[i - 1];
    if (hueco > maxHueco) { maxHueco = hueco; idxHueco = i; }
  }
  const ancho = pagina.ancho || 500;
  if (maxHueco > ancho * 0.22 && xs.length >= 8) {
    const divisionX = (xs[idxHueco] + xs[idxHueco - 1]) / 2;
    // validar que haya varias líneas a ambos lados
    const izq = lineas.filter((l) => l.x < divisionX).length;
    const der = lineas.filter((l) => l.x >= divisionX).length;
    if (izq >= 2 && der >= 2) return { columnas: 2, divisionX };
  }
  return { columnas: 1, divisionX: null };
}

export function clasificarBloque(texto, linea) {
  const t = String(texto || '').trim();
  if (!t) return 'nota';
  if (/^(tabla|cuadro|figura)\s*\d*/i.test(t)) return 'tabla';
  if (/^[-•●]\s+/.test(t) || /^\d+\.\s+/.test(t)) return 'lista';
  if (t.length < 90 && /^[A-ZÁÉÍÓÚÑ][^.!?]*$/.test(t) && (linea.altura || 0) > 0) return 'titulo';
  return 'parrafo';
}

export function componerTexto(paginas, opciones = {}) {
  const listaPaginas = Array.isArray(paginas) ? paginas : [];
  const vacio = { texto: '', capitulos: [], descartadas: 0, paginasConTexto: 0, paginasTotales: listaPaginas.length, bloques: [], omisiones: [] };
  if (!listaPaginas.length) return vacio;

  const relleno = detectarRelleno(listaPaginas);
  let descartadas = 0;
  const omisiones = [];

  /* 1) Filtrar lo que no es contenido — con registro de omisiones */
  const paginasUtiles = listaPaginas.map((pag) => {
    const lineas = (pag.lineas || [])
      .map((l) => ({ ...l, texto: String(l.texto || '').trim() }))
      .filter((l) => {
        if (!l.texto) { descartadas += 1; omisiones.push({ pagina: pag.numero, texto: l.texto, motivo: 'vacio', confianza: 1 }); return false; }
        if (esNumeroDePagina(l.texto)) { descartadas += 1; omisiones.push({ pagina: pag.numero, texto: l.texto, motivo: 'numero_pagina', confianza: 0.95 }); return false; }
        if (relleno.has(normalizarClave(l.texto))) { descartadas += 1; omisiones.push({ pagina: pag.numero, texto: l.texto, motivo: 'cabecera_pie_repetido', confianza: 0.85 }); return false; }
        return true;
      });
    return { ...pag, lineas };
  });

  const todasLasLineas = paginasUtiles.flatMap((p) => p.lineas);
  if (!todasLasLineas.length) return { ...vacio, descartadas, omisiones };

  /* 2) Medidas del documento para decidir dónde corta un párrafo. */
  const alturaModal = mediana(todasLasLineas.map((l) => l.altura));
  const xModal = mediana(todasLasLineas.map((l) => l.x));
  const anchoMaximo = Math.max(...todasLasLineas.map((l) => l.ancho || 0), 0);

  const usarIndice = Array.isArray(opciones.indice) && opciones.indice.length > 0;
  const titulosDetectados = new Set();
  if (!usarIndice) {
    for (const linea of todasLasLineas) {
      if (pareceTitulo(linea, alturaModal)) titulosDetectados.add(linea);
    }
  }
  // Detectar si alguna página es de dos columnas: si ≥40% páginas son dobles, tratamos documento como 2 columnas con títulos a ancho completo primero.
  const columnasPorPagina = paginasUtiles.map(detectarEstructuraColumnas);
  const paginasDobles = columnasPorPagina.filter((c) => c.columnas === 2).length;
  const esDobleColumna = paginasDobles >= paginasUtiles.length * 0.4 && paginasUtiles.length >= 2;

  /* 3) Recorrer las líneas decidiendo: ¿pego, uno palabra, o abro párrafo? 
   * Si hay dos columnas, primero se emite el título ancho completo y luego cada columna arriba-abajo.
   */
  const partes = [];
  const inicioDePagina = new Map();
  const capitulosDetectados = [];
  const bloques = [];
  let largo = 0;
  let anterior = null;
  let paginaAnterior = null;
  let paginasConTexto = 0;
  let idBloque = 0;

  const escribir = (fragmento) => { partes.push(fragmento); largo += fragmento.length; };

  function procesarSecuencia(lineas, numeroPagina) {
    for (const linea of lineas) {
      const esTitulo = titulosDetectados.has(linea);
      const mismaPagina = paginaAnterior === numeroPagina;
      if (anterior == null) {
        escribir(linea.texto);
      } else if (GUIONES_DE_CORTE.test(anterior.texto) && !esTitulo) {
        const siguienteEnMayuscula = /^[A-ZÁÉÍÓÚÜÑ]/.test(linea.texto);
        if (siguienteEnMayuscula) escribir(linea.texto);
        else { partes[partes.length - 1] = partes[partes.length - 1].replace(GUIONES_DE_CORTE, ''); largo -= 1; escribir(linea.texto); }
      } else {
        const sangria = linea.x - xModal > Math.max(4, alturaModal * 0.4);
        const huecoVertical = mismaPagina && alturaModal > 0 ? (anterior.y - linea.y) > Math.max(alturaModal * 1.8, 6) : false;
        const anteriorEsCorta = anchoMaximo > 0 && (anterior.ancho || 0) < anchoMaximo * 0.72 && /[.!?»”"')\]]$/.test(anterior.texto);
        const nuevoParrafo = esTitulo || titulosDetectados.has(anterior) || sangria || huecoVertical || anteriorEsCorta;
        escribir((nuevoParrafo ? '\n\n' : ' ') + linea.texto);
      }
      const tipo = clasificarBloque(linea.texto, linea);
      if (tipo === 'titulo' || (partes.length && partes[partes.length - 1].startsWith('\n\n'))) {
        const textoBloque = linea.texto;
        bloques.push({ id: `b${idBloque++}`, pagina: numeroPagina, texto: textoBloque, tipo, x: linea.x, y: linea.y, ancho: linea.ancho, altura: linea.altura });
      } else if (bloques.length) {
        // anexar al último bloque si no es título
        const ultimo = bloques[bloques.length - 1];
        if (ultimo.tipo !== 'titulo' && ultimo.pagina === numeroPagina) {
          // se acumula en partes, bloques se reconstruye después desde texto final
        }
      }
      if (esTitulo) capitulosDetectados.push({ titulo: linea.texto, posicion: Math.max(0, largo - linea.texto.length), pagina: numeroPagina });
      anterior = linea;
      paginaAnterior = numeroPagina;
    }
  }

  for (let idxPag = 0; idxPag < paginasUtiles.length; idxPag += 1) {
    const pag = paginasUtiles[idxPag];
    if (!pag.lineas.length) continue;
    paginasConTexto += 1;
    inicioDePagina.set(pag.numero, largo);

    if (esDobleColumna) {
      const infoCol = columnasPorPagina[idxPag];
      if (infoCol.columnas === 2) {
        const titulosAnchoCompleto = pag.lineas.filter((l) => titulosDetectados.has(l) || (l.ancho || 0) > (pag.ancho || 0) * 0.85);
        const resto = pag.lineas.filter((l) => !titulosAnchoCompleto.includes(l));
        const colIzq = resto.filter((l) => l.x < infoCol.divisionX).sort((a, b) => b.y - a.y);
        const colDer = resto.filter((l) => l.x >= infoCol.divisionX).sort((a, b) => b.y - a.y);
        if (titulosAnchoCompleto.length) procesarSecuencia(titulosAnchoCompleto, pag.numero);
        // orden correcto: izquierda-1, izquierda-2, ... luego derecha-1, derecha-2
        procesarSecuencia(colIzq, pag.numero);
        procesarSecuencia(colDer, pag.numero);
        continue;
      }
    }
    // una columna o sin división clara
    procesarSecuencia(pag.lineas, pag.numero);
  }

  const texto = pulirParaLectura(partes.join(''));

  // Reconstruir bloques semánticos finales a partir del texto (capas original)
  const bloquesFinales = [];
  const parrafosTexto = texto.split(/\n\n+/).filter(Boolean);
  let posAcum = 0;
  for (const par of parrafosTexto) {
    const tipo = clasificarBloque(par, { altura: alturaModal });
    bloquesFinales.push({ id: `b${bloquesFinales.length}`, pagina: 1, texto: par, tipo, posicion: posAcum });
    posAcum += par.length + 2;
  }
  const bloquesSalida = bloques.length ? bloques : bloquesFinales;

  /* 4) Capítulos: construir desde bloques, no mediante posiciones calculadas antes de modificar texto.
     Si hay índice externo, se respeta; si no, se derivan de bloques tipo titulo. */
  let capitulos;
  if (usarIndice) {
    capitulos = opciones.indice
      .map((entrada) => ({
        titulo: String(entrada.titulo || '').trim() || `Página ${entrada.pagina}`,
        pagina: entrada.pagina,
        posicion: Math.min(inicioDePagina.get(entrada.pagina) ?? 0, Math.max(0, texto.length - 1)),
      }))
      .filter((c) => Number.isFinite(c.pagina))
      .sort((a, b) => a.posicion - b.posicion);
  } else {
    // buscar títulos en texto final para capítulos (posiciones reales post-pulido)
    const titulosEnTexto = [];
    for (const b of bloquesSalida) {
      if (b.tipo === 'titulo') {
        const idx = texto.indexOf(b.texto);
        const pos = idx >= 0 ? idx : texto.indexOf(b.texto.slice(0, 20));
        if (pos >= 0) titulosEnTexto.push({ titulo: b.texto.slice(0, 80), posicion: pos, pagina: b.pagina });
      }
    }
    if (titulosEnTexto.length) capitulos = titulosEnTexto;
    else capitulos = capitulosDetectados.map((c) => ({
      ...c,
      posicion: Math.min(c.posicion, Math.max(0, texto.length - 1)),
    }));
    // si aún no hay capítulos, usar detectados
    if (!capitulos.length && capitulosDetectados.length) capitulos = capitulosDetectados.map(c=> ({...c, posicion: Math.min(c.posicion, Math.max(0,texto.length-1))}));
  }

  return {
    texto,
    capitulos,
    descartadas,
    paginasConTexto,
    paginasTotales: listaPaginas.length,
    bloques: bloquesSalida,
    omisiones,
    esDobleColumna,
  };
}
