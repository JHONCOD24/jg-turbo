/* JG Turbo · Auditoría lingüística segura — contrato PDF
 *
 * Capas: original (inmutable), local (orden/espacios/guiones), revisadoSeguro (signos validados), aprobado (propuestas aceptadas)
 * Cada bloque ≤3000 chars, con contexto vecino solo lectura, nunca corta palabras/títulos/filas/propuestas.
 * Requiere consentimiento por PDF; texto extraído, no archivo, al proveedor configurado.
 * Auditoría completa solo si todos los bloques procesados/revisados.
 */

export function dividirEnBloquesSemanticos(texto, bloquesEstructurales = [], maxLen = 3000) {
  const t = String(texto || '').trim();
  if (!t) return [];
  const limite = Math.max(200, Number(maxLen) || 3000);

  /* La estructura que entrega pdf.js puede contener un registro por renglón.
   * Usarla como cola produjo libros con 4.950 peticiones pequeñas. El texto
   * compuesto ya contiene los límites de párrafo fiables, así que esa es la
   * fuente canónica. `bloquesEstructurales` queda en la firma por
   * compatibilidad, pero no decide el tamaño de la cola. */
  void bloquesEstructurales;
  const parrafos = t.split(/\n\n+/).map((p) => p.trim()).filter(Boolean);
  const unidades = [];

  function agregarLargo(valor) {
    let resto = String(valor || '').trim();
    while (resto.length > limite) {
      let corte = resto.lastIndexOf(' ', limite);
      if (corte < Math.floor(limite * 0.55)) corte = resto.indexOf(' ', limite);
      if (corte < 1) corte = limite;
      unidades.push(resto.slice(0, corte).trim());
      resto = resto.slice(corte).trim();
    }
    if (resto) unidades.push(resto);
  }

  for (const parrafo of parrafos) {
    if (parrafo.length <= limite) {
      unidades.push(parrafo);
      continue;
    }
    const oraciones = parrafo.split(/(?<=[.!?…])\s+/).filter(Boolean);
    let buf = '';
    for (const oracion of oraciones) {
      if (oracion.length > limite) {
        if (buf) { unidades.push(buf); buf = ''; }
        agregarLargo(oracion);
      } else if (buf && `${buf} ${oracion}`.length > limite) {
        unidades.push(buf);
        buf = oracion;
      } else {
        buf = buf ? `${buf} ${oracion}` : oracion;
      }
    }
    if (buf) unidades.push(buf);
  }

  /* Varios párrafos cortos viajan juntos, conservando su separación. */
  const textos = [];
  let acumulado = '';
  for (const unidad of unidades) {
    const junto = acumulado ? `${acumulado}\n\n${unidad}` : unidad;
    if (acumulado && junto.length > limite) {
      textos.push(acumulado);
      acumulado = unidad;
    } else {
      acumulado = junto;
    }
  }
  if (acumulado) textos.push(acumulado);

  const bloques = textos.map((contenido, id) => ({
    id: `bloq_${id}`,
    texto: contenido,
    tipo: 'parrafo',
  }));
  // asignar contexto vecino
  for (let i = 0; i < bloques.length; i += 1) {
    bloques[i].contextoAnterior = bloques[i - 1]?.texto?.slice(-400) || '';
    bloques[i].contextoPosterior = bloques[i + 1]?.texto?.slice(0, 400) || '';
  }
  return bloques;
}

export function construirHuella(texto) {
  const s = String(texto || '').toLowerCase();
  let h = 0;
  for (let i = 0; i < s.length; i += 1) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  return String(h >>> 0);
}

/**
 * Qué decir en el indicador de la cabecera.
 *
 * `propuestas` es el número de sugerencias pendientes de revisar. Antes no se
 * recibía y la función devolvía «Cambios por revisar» como caso por defecto,
 * aunque no hubiera ninguna: el usuario buscaba cambios que no existían.
 */
export function estadoAuditoriaTexto(numBloques, completados, fallos, pendientes, consentido, propuestas = null) {
  if (!consentido) return 'Esperando permiso';
  if (numBloques === 0) return 'Solo local';
  if (fallos > 0 && completados + fallos < numBloques) return `Parcial ${completados} de ${numBloques}`;
  if (completados < numBloques) return `Revisando ${completados} de ${numBloques}`;
  if (propuestas === 0) return 'Revisada, sin cambios';
  if (propuestas === 1) return '1 sugerencia por revisar';
  if (propuestas > 1) return `${propuestas} sugerencias por revisar`;
  return 'Revisión terminada';
}

/** Estado visible de la corrección automática por unidades de lectura. */
export function estadoCorreccionLecturaTexto(total, completados, fallos, consentido) {
  if (!consentido) return 'Corrección opcional';
  if (!total) return 'Solo local';
  const revisadas = Math.min(total, Math.max(0, completados) + Math.max(0, fallos));
  if (revisadas < total) return `Corrigiendo lectura ${revisadas} de ${total}`;
  if (fallos > 0) return fallos === 1 ? '1 parte sin corregir' : `${fallos} partes sin corregir`;
  return 'Lectura corregida';
}

export function esCompleta(numBloques, completados, fallos) {
  return numBloques > 0 && completados === numBloques && fallos === 0;
}
