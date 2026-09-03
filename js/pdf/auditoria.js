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
  // Si ya hay bloques estructurales, respetarlos y solo dividir los muy largos
  const fuente = bloquesEstructurales.length
    ? bloquesEstructurales.map((b) => b.texto || '').filter(Boolean)
    : t.split(/\n\n+/).filter(Boolean);

  const bloques = [];
  let id = 0;
  for (const parrafo of fuente) {
    let p = String(parrafo || '').trim();
    if (!p) continue;
    if (p.length <= maxLen) {
      bloques.push({ id: `bloq_${id++}`, texto: p, tipo: 'parrafo' });
      continue;
    }
    // cortar por oraciones sin partir palabras/títulos/filas
    const oraciones = p.split(/(?<=[.!?…])\s+/);
    let buf = '';
    for (const o of oraciones) {
      if ((buf + ' ' + o).trim().length > maxLen && buf) {
        bloques.push({ id: `bloq_${id++}`, texto: buf.trim(), tipo: 'parrafo' });
        buf = o;
      } else {
        buf = buf ? buf + ' ' + o : o;
      }
    }
    if (buf.trim()) bloques.push({ id: `bloq_${id++}`, texto: buf.trim(), tipo: 'parrafo' });
  }
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

export function estadoAuditoriaTexto(numBloques, completados, fallos, pendientes, consentido) {
  if (!consentido) return 'Esperando permiso';
  if (numBloques === 0) return 'Solo local';
  if (fallos > 0 && completados + fallos < numBloques) return `Parcial ${completados} de ${numBloques}`;
  if (completados < numBloques) return `Auditando ${completados} de ${numBloques}`;
  // hay propuestas por revisar? lo decide el controlador según decisiones
  return 'Cambios por revisar';
}

export function esCompleta(numBloques, completados, fallos) {
  return numBloques > 0 && completados === numBloques && fallos === 0;
}
