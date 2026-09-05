/* JG Turbo · Reconstrucción canónica del texto de un PDF
 *
 * Los átomos y el texto original extraído son inmutables. El texto de lectura
 * es una representación derivada: se obtiene aplicando decisiones de límites.
 */
import {
  atomosDesdePaginas, ordenarAtomos, detectarColumnas, detectarColumnasPorPagina, crearAtomo,
} from './atomos.js';
import {
  crearLimites, resolverLimitesDeterministas, aceptarDecisionesIA,
  separadorDe, textoIzquierdoAjustado, contarPendientes, compactarManifiesto,
  VERSION_LIMITES,
} from './limites.js';
import { vocabularioDelDocumento } from './lexico.js';
import { normalizarAtomStr, caracteresNoSeparadores } from './unicodeTexto.js';
import {
  esNumeroDePagina, normalizarClave, pareceTitulo, clasificarBloque,
  prepararCapitulosLectura,
} from './limpiezaTexto.js';

export const VERSION_RECONSTRUCCION = 7;
export const VERSION_TROCEO = 7;

const MIN_PAGINAS_RELLENO = 3;
const PROPORCION_RELLENO = 0.4;
const MAX_LARGO_RELLENO = 90;

function mediana(numeros) {
  const v = (numeros || []).filter((n) => Number.isFinite(n) && n > 0).sort((a, b) => a - b);
  if (!v.length) return 0;
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}

function tipografiaFinal(texto) {
  return String(texto || '')
    .replace(/([.!?])([A-ZÁÉÍÓÚÜÑ])/g, '$1 $2')
    .replace(/([,;:])(\p{L})/gu, '$1 $2')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ');
}

function lineasVisuales(atomosDePagina) {
  const altura = mediana(atomosDePagina.map((a) => a.height)) || 10;
  const tol = Math.max(1.5, altura * 0.45);
  const grupos = [];
  for (const item of atomosDePagina) {
    const g = grupos.find((x) => Math.abs(x.y - item.y) <= tol);
    if (g) {
      g.items.push(item);
      g.y = (g.y * (g.items.length - 1) + item.y) / g.items.length;
    } else grupos.push({ y: item.y, items: [item] });
  }
  grupos.sort((a, b) => b.y - a.y);
  return grupos.map((g) => {
    const items = g.items.slice().sort((a, b) => a.x - b.x);
    return {
      texto: items.map((i) => i.str).join(' ').replace(/\s+/g, ' ').trim(),
      x: items[0].x,
      y: g.y,
      altura: mediana(items.map((i) => i.height)) || altura,
      ancho: Math.max(0, items[items.length - 1].x + (items[items.length - 1].width || 0) - items[0].x),
      atomos: items,
    };
  }).filter((l) => l.texto.length > 0);
}

function detectarRelleno(paginasLineas) {
  const marcadas = new Set();
  if (paginasLineas.length < MIN_PAGINAS_RELLENO) return marcadas;
  const conteo = new Map();
  for (const pag of paginasLineas) {
    const lineas = pag.lineas || [];
    if (!lineas.length) continue;
    const alto = pag.alto || 0;
    const candidatas = new Set();
    if (alto > 0) {
      for (const l of lineas) {
        if (l.y >= alto * 0.88 || l.y <= alto * 0.12) candidatas.add(l);
      }
    }
    candidatas.add(lineas[0]);
    candidatas.add(lineas[lineas.length - 1]);
    const claves = new Set();
    for (const l of candidatas) {
      if (!l || l.texto.length > MAX_LARGO_RELLENO) continue;
      claves.add(normalizarClave(l.texto));
    }
    for (const clave of claves) {
      if (clave) conteo.set(clave, (conteo.get(clave) || 0) + 1);
    }
  }
  const minimo = Math.max(MIN_PAGINAS_RELLENO, Math.ceil(paginasLineas.length * PROPORCION_RELLENO));
  for (const [clave, veces] of conteo) {
    if (veces >= minimo) marcadas.add(clave);
  }
  return marcadas;
}

function espaciarPuntoPegado(texto) {
  return tipografiaFinal(texto);
}

/**
 * Reconstruye el documento a partir de átomos ya extraídos.
 */
export function reconstruirDesdeAtomos(atomos, opciones = {}) {
  const listaPaginas = Array.isArray(opciones.paginas) ? opciones.paginas : [];
  const ancho = opciones.ancho || listaPaginas[0]?.ancho || 595;
  const lang = opciones.lang || 'es';
  const vacio = {
    texto: '',
    textoCanonico: '',
    capitulos: [],
    paginas: [],
    descartadas: 0,
    paginasConTexto: 0,
    paginasTotales: listaPaginas.length || new Set((atomos || []).map((a) => a.page)).size,
    bloques: [],
    bloquesLectura: [],
    omisiones: [],
    atomos: [],
    limites: [],
    pendientes: 0,
    versionReconstruccion: VERSION_RECONSTRUCCION,
    versionLimites: VERSION_LIMITES,
    manifiesto: [],
    offsetDeAtomo: new Map(),
    esDobleColumna: false,
    candidatosUnion: [],
    listoParaLectura: true,
  };
  if (!atomos || !atomos.length) return vacio;

  const ordenados = ordenarAtomos(atomos, { ancho });
  const porPagina = new Map();
  for (const a of ordenados) {
    if (!porPagina.has(a.page)) porPagina.set(a.page, []);
    porPagina.get(a.page).push(a);
  }

  const paginasLineas = [];
  for (const [numero, ats] of [...porPagina.entries()].sort((a, b) => a[0] - b[0])) {
    const meta = listaPaginas.find((p) => p.numero === numero) || {};
    paginasLineas.push({
      numero,
      alto: meta.alto || opciones.alto || 842,
      ancho: meta.ancho || ancho,
      lineas: lineasVisuales(ats),
    });
  }
  const relleno = detectarRelleno(paginasLineas);
  const omitidos = new Set();
  const omisiones = [];
  let descartadas = 0;
  for (const pag of paginasLineas) {
    for (const linea of pag.lineas) {
      let motivo = null;
      if (!linea.texto.trim()) motivo = 'vacio';
      else if (esNumeroDePagina(linea.texto)) motivo = 'numero_pagina';
      else if (relleno.has(normalizarClave(linea.texto))) motivo = 'cabecera_pie_repetido';
      if (!motivo || opciones.atomosYaFiltrados) continue;
      descartadas += linea.atomos.length;
      omisiones.push({ pagina: pag.numero, texto: linea.texto, motivo, confianza: motivo === 'vacio' ? 1 : 0.9 });
      for (const a of linea.atomos) omitidos.add(a.id);
    }
  }

  const incluidos = ordenados.filter((a) => !omitidos.has(a.id) && String(a.str || '').length);
  if (!incluidos.length) {
    return { ...vacio, descartadas, omisiones, atomos: ordenados };
  }

  // Columnas por página y región, no un único corte global.
  const infoCol = detectarColumnas(incluidos, ancho);
  const infoColPorPagina = detectarColumnasPorPagina(incluidos, ancho);
  const limites = crearLimites(incluidos, { ancho, infoCol, infoColPorPagina });
  const atomosPorId = new Map(incluidos.map((a) => [a.id, a]));
  const alturaModal = mediana(incluidos.map((a) => a.height)) || 11;
  const xModal = mediana(incluidos.map((a) => a.x));
  const anchoMaximo = Math.max(0, ...incluidos.map((a) => a.width || 0));

  // Líneas completas y su ancho: los párrafos se deciden por la línea
  // entera y su estructura, no por el ancho del fragmento suelto.
  const lineasPorAtomo = new Map();
  const anchoLineaPorAtomo = new Map();
  {
    const porPag = new Map();
    for (const a of incluidos) {
      if (!porPag.has(a.page)) porPag.set(a.page, []);
      porPag.get(a.page).push(a);
    }
    const tol = Math.max(1.5, (alturaModal || 11) * 0.45);
    for (const lista of porPag.values()) {
      const ordenada = lista.slice().sort((a, b) => b.y - a.y || a.x - b.x);
      const lineas = [];
      for (const a of ordenada) {
        const g = lineas.find((x) => Math.abs(x.y - a.y) <= tol);
        if (g) {
          g.items.push(a);
          g.y = (g.y * (g.items.length - 1) + a.y) / g.items.length;
        } else lineas.push({ y: a.y, items: [a] });
      }
      for (const g of lineas) {
        g.items.sort((a, b) => a.x - b.x);
        const textoLinea = g.items.map((i) => normalizarAtomStr(i.str)).join(' ').replace(/\s+/g, ' ').trim();
        const x0 = Math.min(...g.items.map((i) => i.x || 0));
        const x1 = Math.max(...g.items.map((i) => (i.x || 0) + (i.width || 0)));
        for (const a of g.items) {
          lineasPorAtomo.set(a.id, textoLinea);
          anchoLineaPorAtomo.set(a.id, Math.max(0, x1 - x0));
        }
      }
    }
  }

  // Vocabulario del documento: formas completas ya visibles en los propios
  // átomos (con espacios). Evidencia real, no lista escrita de ejemplos.
  const vocabInicial = vocabularioDelDocumento(incluidos, []);
  resolverLimitesDeterministas(limites, atomosPorId, {
    lang,
    alturaModal,
    xModal,
    anchoMaximo,
    lineasPorAtomo,
    anchoLineaPorAtomo,
    vocabularioDocumento: vocabInicial,
  });
  // Segunda pasada: con los espacios inequívocos ya decididos, el vocabulario
  // crece y solo re-decide los pendientes (no pisa geometría segura).
  {
    const vocabAmpliado = vocabularioDelDocumento(
      incluidos, limites.filter((l) => l.decision === 'space' || l.decision === 'paragraph'),
    );
    for (const v of vocabInicial) vocabAmpliado.add(v);
    const pendientes = limites.filter((l) => l.decision === 'pending');
    if (pendientes.length) {
      const mapaPend = new Map(pendientes.map((l) => [l.id, l]));
      const clon = pendientes.map((l) => ({ ...l }));
      // Re-resolver solo pendientes con vocabulario completo.
      resolverLimitesDeterministas(clon, atomosPorId, {
        lang,
        alturaModal,
        xModal,
        anchoMaximo,
        lineasPorAtomo,
        anchoLineaPorAtomo,
        vocabularioDocumento: vocabAmpliado,
      });
      for (const c of clon) {
        const orig = mapaPend.get(c.id);
        // Solo se adopta un join/space con evidencia léxica; el resto sigue pendiente.
        if (orig && c.source === 'lexicon' && (c.decision === 'join' || c.decision === 'space')) {
          orig.decision = c.decision;
          orig.source = c.source;
        }
      }
    }
  }

  if (Array.isArray(opciones.decisionesIA) && opciones.decisionesIA.length) {
    aceptarDecisionesIA(limites, opciones.decisionesIA);
  }
  // Decisiones ya validadas contra estos mismos átomos, incluidas las del usuario.
  const previos = new Map((opciones.limitesPrevios || []).map(l => [l.id, l]));
  for (const limite of limites) {
    const previo = previos.get(limite.id);
    if (previo && previo.leftAtomId === limite.leftAtomId && previo.rightAtomId === limite.rightAtomId
        && ['join','space','paragraph','pending'].includes(previo.decision)) {
      Object.assign(limite, { decision: previo.decision, source: previo.source, quitarGuion: previo.quitarGuion });
    }
  }

  // Composición única: texto, bloques, páginas y posiciones salen de la
  // misma pasada. La normalización fina (`.Como` → `. Como`) cambia la
  // longitud, así que las correspondencias se recalculan DESPUÉS sobre el
  // texto final, no sobre el borrador.
  const partesTxt = [];
  const bloquesLectura = [];
  let largoCrudo = 0;
  let bloqueActual = null;
  let idBloque = 0;

  const abrirBloque = (tipo, atomo) => {
    if (bloqueActual) {
      bloqueActual.atomEnd = atomo?.id || bloqueActual.atomEnd;
      bloqueActual.pageEnd = atomo?.page || bloqueActual.pageEnd;
      bloqueActual.text = partesTxt.join('').slice(bloqueActual._desde);
      bloquesLectura.push(bloqueActual);
    }
    bloqueActual = {
      id: `rb${idBloque++}`,
      type: tipo,
      pageStart: atomo.page,
      pageEnd: atomo.page,
      atomStart: atomo.id,
      atomEnd: atomo.id,
      boundaryIds: [],
      text: '',
      continuation: false,
      _desde: largoCrudo,
    };
  };

  for (let i = 0; i < incluidos.length; i += 1) {
    const atomo = incluidos[i];
    const lim = i > 0 ? limites[i - 1] : null;
    if (i === 0) {
      abrirBloque(clasificarBloque(atomo.str, { altura: atomo.height, alturaModal }), atomo);
    } else if (lim) {
      bloqueActual.boundaryIds.push(lim.id);
      if (lim.decision === 'paragraph') {
        const tipo = clasificarBloque(atomo.str, { altura: atomo.height, alturaModal });
        abrirBloque(tipo, atomo);
      } else {
        bloqueActual.atomEnd = atomo.id;
        bloqueActual.pageEnd = atomo.page;
      }
    }
    if (i === 0) {
      const primero = normalizarAtomStr(atomo.str);
      partesTxt.push(primero);
      largoCrudo += primero.length;
    } else {
      // Si hay que quitar un guion (incluido «extraor- » con espacio
      // residual), se recorta lo ya escrito: también los espacios sobrantes.
      if (lim.decision === 'join' && lim.quitarGuion) {
        const actual = partesTxt.join('');
        const recortado = actual.replace(/\s+$/, '').replace(/[\u00AD\u002D\u2010\u2011\u2012]$/, '');
        if (recortado.length !== actual.length) {
          partesTxt.length = 0;
          partesTxt.push(recortado);
          largoCrudo = recortado.length;
        } else {
          // «extraor- »: el guion quedó antes de espacios ya normalizados.
          const rec2 = actual.replace(/[\u00AD\u002D\u2010\u2011\u2012]\s*$/, '');
          if (rec2.length !== actual.length) {
            partesTxt.length = 0;
            partesTxt.push(rec2);
            largoCrudo = rec2.length;
          }
        }
      }
      const sep = separadorDe(lim, incluidos[i - 1]);
      // El átomo derecho entra sin sus espacios de borde: el separador ya
      // los representa. Así no se duplican ni se pierden al recomponer.
      const derCrudo = normalizarAtomStr(atomo.str);
      const der = (lim.decision === 'join')
        ? derCrudo.replace(/^\s+/, '')
        : derCrudo;
      partesTxt.push(sep + der);
      largoCrudo += sep.length + der.length;
    }
  }
  if (bloqueActual) {
    bloqueActual.text = partesTxt.join('').slice(bloqueActual._desde);
    bloquesLectura.push(bloqueActual);
  }

  const crudo = partesTxt.join('');
  let texto = espaciarPuntoPegado(crudo).replace(/^\s+/, '');
  const textoCanonico = texto;

  // Correspondencias sobre el texto FINAL: se localiza cada átomo en orden.
  // Así un `.Como` → `. Como` desplaza lo que sigue sin romper anclas, TTS
  // ni búsqueda.
  const offset2 = new Map();
  {
    let cursor = 0;
    for (let i = 0; i < incluidos.length; i += 1) {
      const atomo = incluidos[i];
      let nucleo = normalizarAtomStr(atomo.str).trim();
      // Si el siguiente límite quita el guion, el núcleo final no lo trae.
      const sig = limites[i];
      if (sig?.decision === 'join' && sig.quitarGuion) {
        nucleo = nucleo.replace(/\s+$/, '').replace(/[\u00AD\u002D\u2010\u2011\u2012]$/, '');
      }
      if (!nucleo) {
        offset2.set(atomo.id, cursor);
        continue;
      }
      const nucleoFinal = espaciarPuntoPegado(nucleo);
      // Prefijo corto: el orden lo da el cursor, no la unicidad global.
      const aguja = nucleoFinal.slice(0, 16);
      let donde = aguja ? texto.indexOf(aguja, cursor) : cursor;
      if (donde < 0) {
        // Reserva: primer trozo localizable (átomos con rarezas tipográficas).
        const trozo = nucleoFinal.slice(0, Math.min(12, nucleoFinal.length));
        donde = trozo ? texto.indexOf(trozo, cursor) : cursor;
      }
      if (donde < 0) donde = cursor;
      // No retroceder: el orden de átomos manda.
      if (donde < cursor) donde = cursor;
      if (donde > texto.length) donde = texto.length;
      offset2.set(atomo.id, donde);
      cursor = donde + nucleoFinal.length;
      if (cursor > texto.length) cursor = texto.length;
    }
  }

  const posicionesPagina = [];
  const vistoPag = new Set();
  for (const a of incluidos) {
    if (vistoPag.has(a.page)) continue;
    vistoPag.add(a.page);
    posicionesPagina.push({
      numero: a.page,
      posicion: offset2.get(a.id) || 0,
      atomId: a.id,
    });
  }
  const posicionDePagina = new Map(posicionesPagina.map((p) => [p.numero, p.posicion]));

  const alturaTitulo = alturaModal;
  const titulos = [];
  for (const a of incluidos) {
    const linea = { texto: a.str, altura: a.height, x: a.x, y: a.y };
    if (pareceTitulo(linea, alturaTitulo)) {
      titulos.push({
        titulo: String(a.str || '').trim().slice(0, 80),
        posicion: offset2.get(a.id) || 0,
        pagina: a.page,
        atomId: a.id,
      });
    }
  }

  let capitulos;
  const indice = opciones.indice;
  if (Array.isArray(indice) && indice.length) {
    capitulos = indice
      .map((entrada) => ({
        titulo: String(entrada.titulo || '').trim() || `Página ${entrada.pagina}`,
        pagina: entrada.pagina,
        posicion: posicionDePagina.has(entrada.pagina) ? posicionDePagina.get(entrada.pagina) : null,
        atomId: (posicionesPagina.find((p) => p.numero === entrada.pagina) || {}).atomId || null,
      }))
      .filter((c) => Number.isFinite(c.pagina) && c.posicion != null)
      .sort((a, b) => a.posicion - b.posicion);
    capitulos = prepararCapitulosLectura(texto, capitulos);
  } else {
    capitulos = titulos.length ? titulos : [];
    if (capitulos.length) capitulos = prepararCapitulosLectura(texto, capitulos);
  }

  // Bloques recortados del texto FINAL por sus átomos extremos: si la
  // normalización movió una coma o un espacio, el bloque se mueve con ella.
  const limitePorIzquierdo = new Map((limites || []).map((l) => [l.leftAtomId, l]));
  const bloquesFinales = bloquesLectura.map((b, i) => {
    const ini = offset2.get(b.atomStart);
    const finAtomo = offset2.get(b.atomEnd);
    let fin = Number.isFinite(finAtomo) ? finAtomo : texto.length;
    if (Number.isFinite(finAtomo)) {
      const atomoFin = atomosPorId.get(b.atomEnd);
      let nucleoFin = atomoFin ? espaciarPuntoPegado(normalizarAtomStr(atomoFin.str).trim()) : '';
      const sigDeFin = limitePorIzquierdo.get(b.atomEnd);
      if (sigDeFin?.decision === 'join' && sigDeFin.quitarGuion) {
        nucleoFin = nucleoFin.replace(/\s+$/, '').replace(/[\u00AD\u002D\u2010\u2011\u2012]$/, '');
      }
      fin = finAtomo + nucleoFin.length;
    }
    const inicio = Number.isFinite(ini) ? Math.max(0, Math.min(ini, texto.length)) : (b._desde || 0);
    const hasta = Math.max(inicio, Math.min(texto.length, fin));
    return {
      id: b.id || `b${i}`,
      pagina: b.pageStart,
      texto: texto.slice(inicio, hasta),
      tipo: b.type || clasificarBloque(b.text, { altura: alturaModal }),
      posicion: inicio,
      pageStart: b.pageStart,
      pageEnd: b.pageEnd,
      atomStart: b.atomStart,
      atomEnd: b.atomEnd,
      boundaryIds: b.boundaryIds,
      continuation: b.continuation,
    };
  });

  const pendientes = contarPendientes(limites);
  const esDobleColumna = (infoColPorPagina && [...infoColPorPagina.values()].some((v) => v.columnas >= 2))
    || infoCol.columnas >= 2;

  return {
    texto,
    textoCanonico: texto,
    capitulos,
    paginas: posicionesPagina,
    descartadas,
    paginasConTexto: porPagina.size,
    paginasTotales: listaPaginas.length || porPagina.size,
    bloques: bloquesFinales.length ? bloquesFinales : bloquesLectura,
    bloquesLectura,
    omisiones,
    atomos: incluidos.map((a) => crearAtomo(a)),
    atomosTodos: ordenados,
    limites,
    pendientes,
    versionReconstruccion: VERSION_RECONSTRUCCION,
    versionLimites: VERSION_LIMITES,
    manifiesto: compactarManifiesto(limites),
    offsetDeAtomo: offset2,
    esDobleColumna,
    candidatosUnion: [],
    listoParaLectura: pendientes === 0,
  };
}

export function reconstruirDocumento(paginas, opciones = {}) {
  const lista = Array.isArray(paginas) ? paginas : [];
  const atomos = opciones.atomos || atomosDesdePaginas(lista);
  const ancho = opciones.ancho || lista[0]?.ancho || 595;
  return reconstruirDesdeAtomos(atomos, { ...opciones, paginas: lista, ancho });
}

/** Invariante: letras de átomos (con normalización documentada) vs canónico. */
export function letrasDeAtomos(atomos) {
  return caracteresNoSeparadores(
    (atomos || []).map((a) => normalizarAtomStr(a.str).replace(/\u00AD/g, '').replace(/\s+$/, '').replace(/[\u002D\u2010\u2011\u2012]$/, '')).join('')
  );
}

export function invarianteLetras(atomos, textoCanonico, limites) {
  const quitados = new Set();
  for (const l of limites || []) {
    if (l.decision === 'join' && l.quitarGuion) quitados.add(l.leftAtomId);
  }
  const origen = caracteresNoSeparadores(
    (atomos || []).map((a) => {
      let s = normalizarAtomStr(a.str).replace(/\u00AD/g, '');
      if (quitados.has(a.id)) s = s.replace(/\s+$/, '').replace(/[\u002D\u2010\u2011\u2012]$/, '');
      return s;
    }).join('')
  );
  const destino = caracteresNoSeparadores(textoCanonico);
  return origen === destino;
}

export { aceptarDecisionesIA };
