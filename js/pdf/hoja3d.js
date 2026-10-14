/* Geometría de papel curvo y copia visual del área visible. Sin rasterizar
 * HTML ni cargar una biblioteca: el texto real conserva su paginación. */
export function geometriaHoja(ancho, progreso, direccion = 1, cantidad = 10) {
  const p = Math.max(0, Math.min(1, Number(progreso) || 0));
  const n = Math.max(1, Math.round(cantidad));
  const w = ancho / n;
  const curva = n === 1 ? 0 : Math.sin(Math.PI * p) * 0.62;
  let x = 0;
  let z = 0;
  const piezas = [];
  for (let i = 0; i < n; i++) {
    const u = (i + 0.5) / n;
    const a = Math.PI * p + curva * (2 * u - 1);
    const dx = w * Math.cos(a);
    const dz = w * Math.sin(a);
    const indice = direccion > 0 ? i : n - 1 - i;
    piezas.push({ indice, ancho: w, angulo: a * 180 / Math.PI,
      x: direccion > 0 ? x : ancho - x - dx,
      z: direccion > 0 ? z : z + dz,
      transform: `translate3d(${direccion > 0 ? x : ancho - x - dx}px,0,${direccion > 0 ? z : z + dz}px) rotateY(${-direccion * a * 180 / Math.PI}deg)`,
      luz: Math.min(0.8, Math.abs(Math.sin(a)) * 0.55),
    });
    x += dx;
    z += dz;
  }
  piezas.sort((a, b) => a.indice - b.indice);
  return { piezas, borde: direccion > 0 ? x : ancho - x,
    sombra: Math.sin(Math.PI * p) * 0.38 };
}

const dentro = (r, c) => r.width > 0 && r.height > 0 && r.right > c.left + .5
  && r.left < c.right - .5 && r.bottom > c.top + .5 && r.top < c.bottom - .5;

/** Copia palabras en SUS coordenadas, conservando incluso la justificación.
 * Solo visita bloques que tocan esta página. Una palabra que cruza columnas
 * se parte por sus rectángulos, sin recomponer ni modificar el texto fuente. */
export function copiarPaginaVisible(art) {
  const caja = art.getBoundingClientRect();
  const copia = document.createElement('div');
  copia.className = 'lec-hoja-textura';
  copia.style.width = `${caja.width}px`;
  copia.style.height = `${caja.height}px`;
  const estilos = new WeakMap();
  const estilo = n => {
    if (!estilos.has(n)) estilos.set(n, getComputedStyle(n));
    return estilos.get(n);
  };
  const poner = (texto, r, cs) => {
    if (!dentro(r, caja)) return;
    const s = document.createElement('span');
    s.textContent = texto;
    s.style.cssText = `left:${r.left - caja.left}px;top:${r.top - caja.top}px;line-height:${r.height}px;`;
    for (const propiedad of ['fontFamily','fontSize','fontWeight','fontStyle','fontStretch',
      'letterSpacing','color','textDecoration','textShadow','fontVariant','fontKerning',
      'fontFeatureSettings','fontVariationSettings','textTransform','direction']) s.style[propiedad] = cs[propiedad];
    copia.append(s);
  };
  const rango = document.createRange();
  for (const bloque of art.children) {
    if (![...bloque.getClientRects()].some(r => dentro(r, caja))) continue;
    // Fondos de marcas, celdas y citas, sin introducir métricas nuevas.
    for (const d of [bloque, ...bloque.querySelectorAll('mark, td, th, blockquote')]) {
      const cs = estilo(d);
      if (cs.backgroundColor === 'rgba(0, 0, 0, 0)' && parseFloat(cs.borderTopWidth) === 0) continue;
      for (const r of d.getClientRects()) if (dentro(r, caja)) {
        const fondo = document.createElement('i');
        fondo.style.cssText = `left:${r.left-caja.left}px;top:${r.top-caja.top}px;width:${r.width}px;height:${r.height}px;`;
        fondo.style.background = cs.backgroundColor;
        fondo.style.border = cs.border;
        copia.append(fondo);
      }
    }
    const caminante = document.createTreeWalker(bloque, NodeFilter.SHOW_TEXT);
    let t;
    while ((t = caminante.nextNode())) {
      if (!t.textContent.trim()) continue;
      rango.selectNodeContents(t);
      if (![...rango.getClientRects()].some(r => dentro(r, caja))) continue;
      const cs = estilo(t.parentElement);
      // Un solo párrafo puede ocupar todo el capítulo. Localizar la ventana
      // por columnas antes de visitar palabras evita medir miles invisibles.
      const limite = borde => {
        let a = 0, b = t.length;
        while (a < b) {
          const m = Math.floor((a + b) / 2);
          rango.setStart(t, m); rango.setEnd(t, m + 1);
          const r = rango.getClientRects()[0];
          if (!r || r.left < borde) a = m + 1; else b = m;
        }
        return a;
      };
      let inicio = limite(caja.left - .5), fin = limite(caja.right - .5);
      const ventanaInicio = inicio, ventanaFin = fin;
      while (inicio > 0 && ventanaInicio - inicio < 64 && !/\s/u.test(t.textContent[inicio - 1])) inicio--;
      while (fin < t.length && fin - ventanaFin < 64 && !/\s/u.test(t.textContent[fin])) fin++;
      for (const m of t.textContent.slice(inicio, fin).matchAll(/\S+/gu)) {
        const desde = inicio + m.index;
        rango.setStart(t, desde);
        rango.setEnd(t, desde + m[0].length);
        const rects = [...rango.getClientRects()];
        if (!rects.some(r => dentro(r, caja))) continue;
        if (rects.length === 1) { poner(m[0], rects[0], cs); continue; }
        let segmento = '', rect = null;
        for (let k = desde; k < desde + m[0].length;) {
          const letra = String.fromCodePoint(t.textContent.codePointAt(k));
          rango.setStart(t, k); rango.setEnd(t, k + letra.length);
          const r = rango.getClientRects()[0];
          if (rect && r && (Math.abs(r.top - rect.top) > 1 || r.left < rect.left - 1)) {
            poner(segmento, rect, cs); segmento = ''; rect = null;
          }
          if (!rect && r) rect = r;
          segmento += letra;
          k += letra.length;
        }
        if (rect) poner(segmento, rect, cs);
      }
    }
    for (const img of bloque.querySelectorAll('img')) {
      const r = img.getBoundingClientRect();
      if (!dentro(r, caja)) continue;
      const c = img.cloneNode(false);
      c.removeAttribute('id'); c.removeAttribute('tabindex'); c.alt = '';
      c.style.cssText = `left:${r.left-caja.left}px;top:${r.top-caja.top}px;width:${r.width}px;height:${r.height}px;`;
      c.style.objectFit = getComputedStyle(img).objectFit;
      c.style.objectPosition = getComputedStyle(img).objectPosition;
      copia.append(c);
    }
  }
  return copia;
}
