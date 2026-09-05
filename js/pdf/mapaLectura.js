/* JG Turbo · Mapa de lectura (apartado PDF)
 *
 * El texto del libro vive en un único string. La vista de lectura lo enseña
 * como HTML, y hasta ahora ese HTML no sabía de dónde salía cada párrafo: por
 * eso «leer desde aquí», el resaltado de la voz y la reanudación no podían
 * funcionar. Aquí cada bloque viaja con su posición exacta (`ini`/`fin`) en el
 * texto original, y esas posiciones llegan al HTML como `data-ini`/`data-fin`.
 *
 * Módulo puro: no toca el DOM ni el almacenamiento, así se prueba en Node.
 */

export function escapar(texto) {
  return String(texto ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** Recorta los espacios de los bordes SIN perder la posición real. */
function recortar(texto, ini, fin) {
  let a = ini;
  let b = fin;
  while (a < b && /\s/.test(texto[a])) a += 1;
  while (b > a && /\s/.test(texto[b - 1])) b -= 1;
  return { ini: a, fin: b, texto: texto.slice(a, b) };
}

/** Qué es este bloque. Mismas reglas que la vista anterior, en un solo sitio. */
export function tipoDeBloque(cuerpo) {
  const lineas = cuerpo.split(/\n/).map((l) => l.trim()).filter(Boolean);
  if (/^#{1,3}\s+\S/.test(cuerpo)) return 'h3';
  if (lineas.length > 1 && lineas.every((l) => /^[-•●]\s+\S/.test(l))) return 'ul';
  if (lineas.length > 1 && lineas.every((l) => /^\d+\.\s+\S/.test(l))) return 'ol';
  if (/^>/.test(cuerpo) || (lineas.length > 1 && lineas.every((l) => /^["“«]/.test(l)))) return 'blockquote';
  if (/\|.*\|/.test(cuerpo) && lineas.length > 1) {
    const filas = lineas.map((l) => l.split('|').map((c) => c.trim()).filter(Boolean));
    if (filas.length > 1 && filas.every((f) => f.length === filas[0].length)) return 'table';
  }
  const esTitulo = cuerpo.length <= 90 && !/[.!?…:]$/.test(cuerpo)
    && ((cuerpo === cuerpo.toUpperCase() && /[A-ZÁÉÍÓÚÑ]{2,}/.test(cuerpo))
      || /^(capítulo|capitulo|parte|prólogo|prologo|epílogo|anexo|introducción)/i.test(cuerpo));
  return esTitulo ? 'h3' : 'p';
}

/** El texto partido en bloques, cada uno con su posición en el original. */
export function bloquesDeTexto(texto) {
  const t = String(texto || '');
  if (!t.trim()) return [];
  const bloques = [];
  const separador = /\n{2,}/g;
  let desde = 0;
  let hallazgo;
  const anotar = (ini, fin) => {
    const r = recortar(t, ini, fin);
    if (r.fin > r.ini) bloques.push({ ...r, tipo: tipoDeBloque(r.texto) });
  };
  while ((hallazgo = separador.exec(t))) {
    anotar(desde, hallazgo.index);
    desde = hallazgo.index + hallazgo[0].length;
  }
  anotar(desde, t.length);
  return bloques;
}

/** Las líneas de un bloque, con posición propia (para los puntos de una lista). */
function lineasConPosicion(bloque) {
  const salida = [];
  let cursor = 0;
  for (const linea of bloque.texto.split('\n')) {
    const r = recortar(bloque.texto, cursor, cursor + linea.length);
    if (r.fin > r.ini) {
      salida.push({ ini: bloque.ini + r.ini, fin: bloque.ini + r.fin, texto: r.texto });
    }
    cursor += linea.length + 1;
  }
  return salida;
}

function atributos(b) {
  return ` data-ini="${b.ini}" data-fin="${b.fin}"`;
}

/** El HTML de la vista de lectura, con las posiciones puestas. */
export function construirLectura(texto) {
  const bloques = bloquesDeTexto(texto);
  if (!bloques.length) return '<p></p>';
  const html = [];
  for (const b of bloques) {
    if (b.tipo === 'h3') {
      html.push(`<h3${atributos(b)}>${escapar(b.texto.replace(/^#{1,3}\s+/, ''))}</h3>`);
      continue;
    }
    if (b.tipo === 'ul' || b.tipo === 'ol') {
      const marca = b.tipo === 'ul' ? /^[-•●]\s+/ : /^\d+\.\s+/;
      const items = lineasConPosicion(b)
        .map((l) => `<li${atributos(l)}>${escapar(l.texto.replace(marca, ''))}</li>`).join('');
      html.push(`<${b.tipo}${atributos(b)}>${items}</${b.tipo}>`);
      continue;
    }
    if (b.tipo === 'blockquote') {
      html.push(`<blockquote${atributos(b)}>${escapar(b.texto.replace(/^>\s?/gm, ''))}</blockquote>`);
      continue;
    }
    if (b.tipo === 'table') {
      const filas = lineasConPosicion(b).map((l, i) => {
        const celdas = l.texto.split('|').map((c) => c.trim()).filter(Boolean)
          .map((c) => (i === 0 ? `<th>${escapar(c)}</th>` : `<td>${escapar(c)}</td>`)).join('');
        return `<tr${atributos(l)}>${celdas}</tr>`;
      }).join('');
      html.push(`<table${atributos(b)}>${filas}</table>`);
      continue;
    }
    html.push(`<p${atributos(b)}>${escapar(b.texto).replace(/\n/g, '<br>')}</p>`);
  }
  return html.join('');
}
