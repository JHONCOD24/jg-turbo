/* JG Turbo · Contrato de fidelidad de la transcripción PDF
 *
 * La fuente siempre queda disponible. El texto de lectura es una vista
 * derivada y cada cambio entre fragmentos se anota para poder explicarlo y
 * reproducirlo sin depender de heurísticas ocultas.
 */
import { normalizarAtomStr } from './unicodeTexto.js';
import { separadorDe } from './limites.js';

export const VERSION_FIDELIDAD = 1;

const CAMPOS_FRAGMENTO = [
  'id', 'page', 'itemIndex', 'str', 'x', 'y', 'width', 'height', 'dir',
  'fontName', 'hasEOL', 'markedContentId', 'rolEstructura', 'transform',
  'fontFamily', 'fontAscent', 'fontDescent', 'vertical', 'source', 'confidence',
];

function clonarValor(valor) {
  return Array.isArray(valor) ? valor.slice() : valor;
}

export function fragmentosFuenteDesdeAtomos(atomos = []) {
  return atomos.map((atomo) => {
    const salida = {};
    for (const campo of CAMPOS_FRAGMENTO) {
      if (atomo?.[campo] !== undefined) salida[campo] = clonarValor(atomo[campo]);
    }
    salida.id = String(salida.id || '');
    salida.str = String(salida.str ?? '');
    return salida;
  });
}

function quitarGuionFinal(texto) {
  return String(texto || '')
    .replace(/\s+$/, '')
    .replace(/[\u00AD\u002D\u2010\u2011\u2012]$/, '');
}

/**
 * Compone exclusivamente desde fragmentos y decisiones de límites.
 * No corrige signos, mayúsculas ni gramática. Los espacios de borde quedan
 * representados por el límite y se registran en la transformación.
 */
export function componerAtomosFiel(atomos = [], limites = []) {
  const partes = [];
  const offsets = new Map();
  const transformaciones = [];
  let largo = 0;

  for (let i = 0; i < atomos.length; i += 1) {
    const atomo = atomos[i];
    const bruto = String(atomo?.str ?? '');
    let normalizado = normalizarAtomStr(bruto);
    if (normalizado !== bruto) {
      transformaciones.push({
        tipo: 'normalizacion_unicode', atomoId: atomo.id,
        antes: bruto, despues: normalizado, reversible: true,
      });
    }

    if (i === 0) {
      offsets.set(atomo.id, largo);
      partes.push(normalizado);
      largo += normalizado.length;
      continue;
    }

    const limite = limites[i - 1] || null;
    const indiceUltimaParte = partes.length - 1;
    const ultimaParte = partes[indiceUltimaParte] || '';
    const bordeIzq = (ultimaParte.match(/\s+$/) || [''])[0];
    if (bordeIzq) {
      partes[indiceUltimaParte] = ultimaParte.slice(0, -bordeIzq.length);
      largo -= bordeIzq.length;
    }

    let guionQuitado = '';
    if (limite?.decision === 'join' && limite.quitarGuion) {
      const indiceActual = partes.length - 1;
      const actual = partes[indiceActual] || '';
      const ajustado = quitarGuionFinal(actual);
      guionQuitado = actual.slice(ajustado.length);
      if (ajustado !== actual) {
        partes[indiceActual] = ajustado;
        largo -= guionQuitado.length;
      }
    }

    const bordeDer = (normalizado.match(/^\s+/) || [''])[0];
    if (bordeDer) normalizado = normalizado.slice(bordeDer.length);
    const separador = separadorDe(limite, atomos[i - 1]);
    partes.push(separador);
    largo += separador.length;
    offsets.set(atomo.id, largo);
    partes.push(normalizado);
    largo += normalizado.length;

    transformaciones.push({
      tipo: 'limite', boundaryId: limite?.id || null,
      leftAtomId: atomos[i - 1]?.id || null, rightAtomId: atomo.id,
      decision: limite?.decision || 'pending', source: limite?.source || 'unknown',
      separadorOriginal: limite?.originalSeparator ?? '', separadorAplicado: separador,
      espacioIzquierdoRetirado: bordeIzq, espacioDerechoRetirado: bordeDer,
      guionRetirado: guionQuitado, reversible: true,
    });
  }

  return { texto: partes.join(''), offsets, transformaciones };
}

function estructuraDesdeBloques(bloques = [], fragmentos = []) {
  const porId = new Map(fragmentos.map((f) => [f.id, f]));
  return bloques.map((bloque, indice) => ({
    id: bloque.id || `estructura:${indice}`,
    tipo: bloque.type || bloque.tipo || 'parrafo',
    paginaInicio: bloque.pageStart ?? bloque.pagina ?? null,
    paginaFin: bloque.pageEnd ?? bloque.pagina ?? null,
    atomoInicio: bloque.atomStart || null,
    atomoFin: bloque.atomEnd || null,
    continuacion: Boolean(bloque.continuation),
    rolFuente: porId.get(bloque.atomStart)?.rolEstructura || null,
  }));
}

function calidadDePaginas(fragmentos, paginas = [], origen = 'texto') {
  const porPagina = new Map();
  for (const frag of fragmentos) {
    const numero = Number(frag.page) || 0;
    if (!porPagina.has(numero)) porPagina.set(numero, []);
    porPagina.get(numero).push(frag);
  }
  const metadatos = new Map((paginas || []).map((p) => [Number(p.numero) || 0, p]));
  const numeros = new Set([...porPagina.keys(), ...metadatos.keys()]);
  return [...numeros].filter((n) => n > 0).sort((a, b) => a - b).map((pagina) => {
    const lista = porPagina.get(pagina) || [];
    const confianzas = lista.map((f) => Number(f.confidence)).filter(Number.isFinite);
    const meta = metadatos.get(pagina) || {};
    const confianza = confianzas.length
      ? confianzas.reduce((s, n) => s + n, 0) / confianzas.length
      : (Number.isFinite(Number(meta.confianza)) ? Number(meta.confianza) : null);
    return {
      pagina,
      fragmentos: lista.length,
      caracteres: lista.reduce((s, f) => s + String(f.str || '').length, 0),
      fuente: origen === 'ocr' ? 'ocr' : 'pdf',
      confianza,
      dudosos: confianzas.filter((n) => n < 85).length,
      fallo: Boolean(meta.fallo),
    };
  });
}

export function validarFidelidadUnicode({ fragmentosFuente = [], atomos = [], limites = [], omisiones = [], texto = '' } = {}) {
  const idsFuente = fragmentosFuente.map((f) => f.id);
  const unicos = new Set(idsFuente);
  const idsIncluidos = atomos.map((a) => a.id);
  const idsOmitidos = (omisiones || []).flatMap((o) => o.atomIds || []);
  const incluidos = new Set(idsIncluidos);
  const omitidos = new Set(idsOmitidos);
  const duplicados = idsFuente.filter((id, i) => idsFuente.indexOf(id) !== i);
  const destinos = [...idsIncluidos, ...idsOmitidos];
  const repetidosEnDestino = destinos.filter((id, i) => destinos.indexOf(id) !== i);
  const sinDestino = idsFuente.filter((id) => !incluidos.has(id) && !omitidos.has(id));
  const dobleDestino = idsFuente.filter((id) => incluidos.has(id) && omitidos.has(id));
  const desconocidos = [...incluidos, ...omitidos].filter((id) => !unicos.has(id));
  const fuentePorId = new Map(fragmentosFuente.map((f) => [f.id, f]));
  const alterados = atomos.filter((a) => {
    const fuente = fuentePorId.get(a.id);
    return fuente && String(a.str ?? '') !== String(fuente.str ?? '');
  });
  const recompuesto = componerAtomosFiel(atomos, limites).texto;
  const errores = [];
  if (duplicados.length) errores.push('fragmentos_duplicados');
  if (repetidosEnDestino.length) errores.push('fragmentos_repetidos_en_destino');
  if (sinDestino.length) errores.push('fragmentos_sin_destino');
  if (dobleDestino.length) errores.push('fragmentos_incluidos_y_omitidos');
  if (desconocidos.length) errores.push('fragmentos_desconocidos');
  if (alterados.length) errores.push('fragmentos_alterados');
  if (recompuesto !== String(texto ?? '')) errores.push('texto_no_reproducible');
  return {
    valido: errores.length === 0,
    errores,
    fragmentosFuente: idsFuente.length,
    fragmentosIncluidos: incluidos.size,
    fragmentosOmitidos: omitidos.size,
    fragmentosAlterados: alterados.length,
    coincidenciaExacta: recompuesto === String(texto ?? ''),
  };
}

export function crearInformeFidelidad(resultado = {}, { origen = 'texto', paginas = [] } = {}) {
  const fragmentosFuente = fragmentosFuenteDesdeAtomos(resultado.atomosTodos || resultado.atomos || []);
  const composicion = componerAtomosFiel(resultado.atomos || [], resultado.limites || []);
  const omisiones = (resultado.omisiones || []).map((o) => ({ ...o, atomIds: [...(o.atomIds || [])] }));
  const transformaciones = [
    ...composicion.transformaciones,
    ...omisiones.map((o) => ({
      tipo: 'omision', pagina: o.pagina, atomIds: o.atomIds,
      antes: o.texto || '', despues: '', motivo: o.motivo,
      confianza: o.confianza ?? null, reversible: true,
    })),
  ];
  const integridad = validarFidelidadUnicode({
    fragmentosFuente, atomos: resultado.atomos || [], limites: resultado.limites || [],
    omisiones, texto: resultado.texto,
  });
  const pendientes = Number(resultado.pendientes) || 0;
  let estado = 'extraido_sin_alteraciones';
  if (!integridad.valido) estado = 'inconsistente';
  else if (origen === 'ocr' || pendientes > 0 || omisiones.length > 0) estado = 'pendiente_revision';
  return {
    versionFidelidad: VERSION_FIDELIDAD,
    fragmentosFuente,
    transformaciones,
    estructura: estructuraDesdeBloques(resultado.bloquesLectura || resultado.bloques || [], fragmentosFuente),
    calidadPorPagina: calidadDePaginas(fragmentosFuente, paginas, origen),
    estadoFidelidad: {
      estado, origen, integridad,
      paginasVerificadas: [], verificado: false,
      actualizado: Date.now(),
    },
  };
}
