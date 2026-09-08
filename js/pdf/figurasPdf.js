/* JG Turbo · Figuras de un PDF (apartado PDF)
 *
 * El texto de un libro se extrae con `getTextContent()`, pero los gráficos no
 * están ahí: viven en la lista de operaciones de dibujo de cada página. Este
 * módulo los busca, los recorta y los devuelve como imágenes listas para
 * enseñarlas dentro de la lectura, en el mismo sitio donde estaban.
 *
 * Cómo funciona, en corto:
 *   1. Se recorre la página anotando dónde queda cada imagen.  (barrido)
 *   2. Se descartan adornos, logos y filetes: lo que se repite no es figura.
 *   3. De las que quedan, se recorta ese trozo de la página a un JPEG.
 *   4. Cada figura se lleva un «ancla»: las últimas palabras que había justo
 *      encima. Con eso el lector sabe entre qué párrafos colocarla, aunque el
 *      texto se haya repartido en capítulos o se haya pulido después.
 *
 * Se ejecuta SIEMPRE en segundo plano, después de que el texto ya esté
 * disponible: leer no puede esperar a que se dibujen los gráficos.
 */

/* Red de seguridad para navegadores algo antiguos.
 *
 * pdf.js 6 usa `Map.prototype.getOrInsertComputed`, que es de las últimas
 * incorporaciones al lenguaje. Leer el texto de un PDF no pasa por ahí, pero
 * `getOperatorList()` —lo que hace falta para encontrar los gráficos— sí. Sin
 * esto, en un navegador que no la traiga, el libro se leería perfectamente
 * pero las figuras fallarían en silencio. El añadido es mínimo y no se activa
 * si el navegador ya la tiene. */
if (typeof Map !== 'undefined' && typeof Map.prototype.getOrInsertComputed !== 'function') {
  Object.defineProperty(Map.prototype, 'getOrInsertComputed', {
    value: function getOrInsertComputed(clave, calcular) {
      if (!this.has(clave)) this.set(clave, calcular(clave));
      return this.get(clave);
    },
    writable: true, configurable: true, enumerable: false,
  });
}
if (typeof Map !== 'undefined' && typeof Map.prototype.getOrInsert !== 'function') {
  Object.defineProperty(Map.prototype, 'getOrInsert', {
    value: function getOrInsert(clave, valor) {
      if (!this.has(clave)) this.set(clave, valor);
      return this.get(clave);
    },
    writable: true, configurable: true, enumerable: false,
  });
}

/* Una figura más pequeña que esto es un adorno, un filete o un bullet. */
const MIN_LADO = 18;          /* puntos */
const MIN_AREA = 500;         /* puntos cuadrados */
/* Si la misma imagen sale en tantas páginas, es decoración de capítulo. */
const MAX_REPETICIONES = 3;
/* Un tope de cordura: ningún libro necesita más y evita reventar la memoria. */
const MAX_FIGURAS = 200;
/* Cuánto texto se guarda como ancla. Suficiente para ser único, corto para viajar. */
const LARGO_ANCLA = 90;

/* ── Matrices 2x3, como las del PDF ──────────────────────────────────── */

/** Aplica `interior` y después `exterior`. Es el `cm` del PDF. */
function componer(exterior, interior) {
  const [a, b, c, d, e, f] = exterior;
  const [A, B, C, D, E, F] = interior;
  return [
    a * A + c * B,      b * A + d * B,
    a * C + c * D,      b * C + d * D,
    a * E + c * F + e,  b * E + d * F + f,
  ];
}

function punto(m, x, y) {
  return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
}

/** La caja que ocupa el cuadrado unidad (donde se dibuja toda imagen) tras `m`. */
function cajaDeMatriz(m) {
  const p = [punto(m, 0, 0), punto(m, 1, 0), punto(m, 0, 1), punto(m, 1, 1)];
  const xs = p.map((q) => q[0]);
  const ys = p.map((q) => q[1]);
  return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
}

/* ── Cajas ───────────────────────────────────────────────────────────── */

const ancho = (c) => c.x1 - c.x0;
const alto = (c) => c.y1 - c.y0;
const area = (c) => Math.max(0, ancho(c)) * Math.max(0, alto(c));

function unir(a, b) {
  return { x0: Math.min(a.x0, b.x0), y0: Math.min(a.y0, b.y0),
           x1: Math.max(a.x1, b.x1), y1: Math.max(a.y1, b.y1) };
}

function seTocan(a, b, margen) {
  return !(a.x1 + margen < b.x0 || b.x1 + margen < a.x0
        || a.y1 + margen < b.y0 || b.y1 + margen < a.y0);
}

/** Dos gráficos pegados son un solo gráfico: la gente los lee como uno. */
function fusionar(cajas, margen = 8) {
  const lista = cajas.slice();
  let hubo = true;
  while (hubo) {
    hubo = false;
    for (let i = 0; i < lista.length && !hubo; i += 1) {
      for (let j = i + 1; j < lista.length; j += 1) {
        if (seTocan(lista[i], lista[j], margen)) {
          lista[i] = { ...unir(lista[i], lista[j]), repetida: lista[i].repetida && lista[j].repetida };
          lista.splice(j, 1);
          hubo = true;
          break;
        }
      }
    }
  }
  return lista;
}

/* ── Barrido: dónde hay imágenes en una página ───────────────────────── */

/**
 * Recorre la lista de dibujo llevando la cuenta de la matriz activa.
 * Devuelve una caja por imagen, ya en coordenadas de la vista (píxeles
 * de pantalla a escala 1, con el origen arriba a la izquierda).
 */
function cajasDeImagenes(lista, OPS, transformeVista) {
  const pila = [];
  let ctm = [1, 0, 0, 1, 0, 0];
  const salida = [];
  const { fnArray, argsArray } = lista;

  for (let i = 0; i < fnArray.length; i += 1) {
    const op = fnArray[i];
    if (op === OPS.save) { pila.push(ctm.slice()); continue; }
    if (op === OPS.restore) { ctm = pila.pop() || [1, 0, 0, 1, 0, 0]; continue; }
    if (op === OPS.transform) { ctm = componer(ctm, argsArray[i]); continue; }
    if (op === OPS.paintImageXObject || op === OPS.paintInlineImageXObject
        || op === OPS.paintImageMaskXObject || op === OPS.paintImageXObjectRepeat) {
      const enPagina = cajaDeMatriz(ctm);
      /* De espacio PDF (y hacia arriba) a espacio de la vista (y hacia abajo). */
      const a = punto(transformeVista, enPagina.x0, enPagina.y0);
      const b = punto(transformeVista, enPagina.x1, enPagina.y1);
      const caja = {
        x0: Math.min(a[0], b[0]), y0: Math.min(a[1], b[1]),
        x1: Math.max(a[0], b[0]), y1: Math.max(a[1], b[1]),
      };
      const args = argsArray[i] || [];
      /* El identificador del objeto distingue «la misma imagen otra vez» de
       * «otra imagen del mismo tamaño». Las incrustadas no lo traen. */
      caja.id = typeof args[0] === 'string' ? args[0] : null;
      salida.push(caja);
    }
  }
  return salida;
}

/**
 * Firma para reconocer «esta imagen ya salió antes».
 *
 * El identificador de objeto de pdf.js no sirve solo: un mismo adorno puede
 * estar incrustado como ocho objetos distintos. El tamaño en la página, en
 * cambio, sí lo delata. Se redondea a 2 puntos para absorber el redondeo.
 */
function firma(caja) {
  return (Math.round(ancho(caja) / 2) * 2) + 'x' + (Math.round(alto(caja) / 2) * 2);
}

/**
 * ¿Es decoración y no una figura?
 *
 * Solo cuenta como adorno lo que se repite Y es pequeño. Un gráfico grande
 * que sale igual en varias páginas (una lámina, una tabla que continúa) sigue
 * siendo contenido y tiene que verse.
 */
function esAdorno(caja, veces, areaPagina) {
  return veces >= MAX_REPETICIONES && area(caja) < 0.08 * areaPagina;
}

/* ── Texto de la página: rótulos y ancla ─────────────────────────────── */

/** Convierte los trocitos de texto de pdf.js en cajas con su cadena. */
function lineasDeTexto(textContent, transformeVista) {
  const fuera = [];
  for (const it of textContent.items || []) {
    if (!it || typeof it.str !== 'string' || !it.str.trim()) continue;
    const tr = it.transform;
    if (!Array.isArray(tr)) continue;
    const p = punto(transformeVista, tr[4], tr[5]);
    const h = Math.abs(it.height || Math.hypot(tr[2], tr[3])) || 10;
    const w = Math.abs(it.width || 0);
    fuera.push({ txt: it.str, x0: p[0], y0: p[1] - h, x1: p[0] + w, y1: p[1] + h * 0.25 });
  }
  return fuera;
}

/**
 * Los rótulos que están DENTRO del gráfico («ESTÍMULO», «FIGURA 3.1») no son
 * prosa: forman parte del dibujo y tienen que salir en el recorte.
 */
function ampliarConRotulos(caja, lineas, pagAlto) {
  let r = { ...caja };
  const anchoImg = Math.max(1, ancho(caja));
  for (const l of lineas) {
    const anchoL = Math.max(1, l.x1 - l.x0);
    const dentro = Math.max(0, Math.min(caja.x1, l.x1) - Math.max(caja.x0, l.x0))
                 * Math.max(0, Math.min(caja.y1, l.y1) - Math.max(caja.y0, l.y0));
    /* a) Rótulo dibujado ENCIMA del gráfico: va dentro sí o sí. */
    if (dentro > 0.5 * anchoL * Math.max(1, l.y1 - l.y0)) { r = unir(r, l); continue; }
    /* b) Rótulo suelto justo al borde («FIGURA 3.1 A», «Eje Y»): tiene que ser
     *    corto. Un renglón que cruza toda la caja es prosa, no rótulo, y esa
     *    ya se lee en el texto: meterla en la imagen la duplicaría. */
    const pegadoArriba = l.y1 <= caja.y0 && caja.y0 - l.y1 <= 16;
    const pegadoAbajo = l.y0 >= caja.y1 && l.y0 - caja.y1 <= 20;
    const cruza = Math.min(caja.x1, l.x1) > Math.max(caja.x0, l.x0);
    if ((pegadoArriba || pegadoAbajo) && cruza && anchoL <= 0.6 * anchoImg) r = unir(r, l);
  }
  r.y0 = Math.max(0, r.y0 - 4);
  r.y1 = Math.min(pagAlto, r.y1 + 6);
  return r;
}

/** Solo letras y números: así el ancla sobrevive a la limpieza del texto. */
function compactar(texto) {
  return String(texto || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * El ancla: las últimas palabras que hay justo ENCIMA de la figura.
 * Si la figura abre la página, se usa lo que viene justo debajo.
 */
function anclaDeFigura(caja, lineas, vecinas = {}) {
  const texto = (arr) => arr.map((l) => l.txt).join(' ').replace(/\s+/g, ' ').trim();
  const arriba = lineas.filter((l) => l.y1 <= caja.y0 + 2).sort((a, b) => a.y0 - b.y0);
  const abajo = lineas.filter((l) => l.y0 >= caja.y1 - 2).sort((a, b) => a.y0 - b.y0);

  const c1 = compactar(texto(arriba.slice(-6)));
  if (c1.length >= 12) return { ancla: c1.slice(-LARGO_ANCLA), despues: false };
  const c2 = compactar(texto(abajo.slice(0, 6)));
  if (c2.length >= 12) return { ancla: c2.slice(0, LARGO_ANCLA), despues: true };

  /* Una lámina a página completa no tiene texto ni encima ni debajo: entonces
   * el ancla se busca en la página anterior (o en la siguiente si tampoco). */
  const c3 = compactar(texto((vecinas.antes || []).slice(-6)));
  if (c3.length >= 12) return { ancla: c3.slice(-LARGO_ANCLA), despues: false };
  const c4 = compactar(texto((vecinas.despues || []).slice(0, 6)));
  if (c4.length >= 12) return { ancla: c4.slice(0, LARGO_ANCLA), despues: true };
  return { ancla: '', despues: false };
}

/** Las líneas de una página cualquiera, para usarlas como ancla de repuesto. */
async function lineasDePagina(doc, n, cache) {
  if (n < 1 || n > doc.numPages) return [];
  if (cache.has(n)) return cache.get(n);
  let pg = null;
  try {
    pg = await doc.getPage(n);
    const vp = pg.getViewport({ scale: 1 });
    const lns = lineasDeTexto(await pg.getTextContent(), vp.transform)
      .sort((a, b) => a.y0 - b.y0);
    cache.set(n, lns);
    return lns;
  } catch (_) {
    cache.set(n, []);
    return [];
  } finally {
    try { pg?.cleanup(); } catch (_) { /* nada */ }
  }
}

/* ── Recorte ─────────────────────────────────────────────────────────── */

async function recortar(pagina, caja, anchoObjetivo) {
  const w = ancho(caja);
  const h = alto(caja);
  if (w < 1 || h < 1) return null;
  /* Nunca por debajo de 1:1 ni por encima de 4x: pasado eso solo pesa más. */
  const escala = Math.max(1, Math.min(4, anchoObjetivo / w));
  const vista = pagina.getViewport({ scale: escala });
  const lienzo = document.createElement('canvas');
  lienzo.width = Math.max(1, Math.round(w * escala));
  lienzo.height = Math.max(1, Math.round(h * escala));
  const ctx = lienzo.getContext('2d', { alpha: false });
  /* Fondo blanco: sin esto, un PDF con transparencia sale negro. */
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, lienzo.width, lienzo.height);
  /* Se dibuja la página entera desplazada: lo que cae fuera del lienzo se
   * descarta solo, y queda exactamente el trozo que interesa. */
  await pagina.render({
    canvasContext: ctx,
    viewport: vista,
    transform: [1, 0, 0, 1, -caja.x0 * escala, -caja.y0 * escala],
  }).promise;
  const blob = await new Promise((listo) => lienzo.toBlob(listo, 'image/jpeg', 0.86));
  const dims = { ancho: lienzo.width, alto: lienzo.height };
  lienzo.width = 0;
  lienzo.height = 0;
  return blob ? { blob, ...dims } : null;
}

/* ── Lo que usa el resto de la app ───────────────────────────────────── */

/**
 * Busca y recorta las figuras de un PDF ya abierto.
 *
 * @param {object} doc documento de pdf.js (el que devuelve `abrirPdf`)
 * @param {object} pdfjs el módulo pdf.js, para leer `OPS`
 * @param {object} [op]
 * @param {(hechas:number,total:number,fase:string)=>void} [op.alProgresar]
 * @param {{cancelado:boolean}} [op.cancelacion]
 * @param {number} [op.anchoObjetivo=1000] ancho en píxeles al que se recorta
 * @returns {Promise<{figuras:Array, cancelado:boolean, paginasConFigura:number}>}
 */
export async function extraerFiguras(doc, pdfjs, op = {}) {
  const OPS = pdfjs.OPS;
  const total = doc.numPages;
  const avisar = typeof op.alProgresar === 'function' ? op.alProgresar : null;
  const cancelacion = op.cancelacion || { cancelado: false };
  const anchoObjetivo = Math.max(400, Math.min(2000, op.anchoObjetivo || 1000));

  /* ── Fase 1: barrido. Solo se anota dónde hay imágenes. ── */
  const candidatas = new Map();      /* número de página -> cajas */
  const cuenta = new Map();          /* firma -> en cuántas páginas sale */
  const areaPagina = new Map();      /* número de página -> su superficie */

  for (let n = 1; n <= total; n += 1) {
    if (cancelacion.cancelado) return { figuras: [], cancelado: true, paginasConFigura: 0 };
    let pagina = null;
    try {
      pagina = await doc.getPage(n);
      const vista = pagina.getViewport({ scale: 1 });
      const lista = await pagina.getOperatorList();
      let cajas = cajasDeImagenes(lista, OPS, vista.transform)
        .filter((c) => ancho(c) >= MIN_LADO && alto(c) >= MIN_LADO && area(c) >= MIN_AREA);
      if (cajas.length) {
        /* La portada del libro ya se ve en la biblioteca: no es una figura. */
        cajas = cajas.filter((c) => !(n === 1 && area(c) > 0.8 * vista.width * vista.height));
      }
      if (cajas.length) {
        const vistas = new Set();
        for (const c of cajas) {
          const f = firma(c);
          if (!vistas.has(f)) { vistas.add(f); cuenta.set(f, (cuenta.get(f) || 0) + 1); }
        }
        candidatas.set(n, cajas);
        areaPagina.set(n, vista.width * vista.height);
      }
    } catch (error) {
      console.warn('[jg-figuras] barrido página', n, error);
    } finally {
      try { pagina?.cleanup(); } catch (_) { /* nada */ }
    }
    if (avisar && (n % 10 === 0 || n === total)) avisar(n, total, 'barrido');
    if (n % 8 === 0) await ceder();
  }

  /* ── Fase 2: recorte. Solo las páginas que tienen algo que enseñar. ── */
  const paginas = [...candidatas.keys()].sort((a, b) => a - b);
  const cacheLineas = new Map();   /* página -> sus líneas, para las anclas de repuesto */
  if (op.soloBarrido) {
    /* Modo diagnóstico: dónde cae cada figura y con qué ancla, sin recortarla. */
    const encontradas = [];
    for (const n of paginas) {
      const utiles = candidatas.get(n)
        .filter((c) => !esAdorno(c, cuenta.get(firma(c)) || 0, areaPagina.get(n) || 1));
      if (!utiles.length) continue;
      const pg = await doc.getPage(n);
      const vp = pg.getViewport({ scale: 1 });
      const lns = lineasDeTexto(await pg.getTextContent(), vp.transform);
      for (const bruta of fusionar(utiles)) {
        const caja = ampliarConRotulos(bruta, lns, vp.height);
        let a = anclaDeFigura(caja, lns);
        if (!a.ancla) {
          a = anclaDeFigura(caja, lns, {
            antes: await lineasDePagina(doc, n - 1, cacheLineas),
            despues: await lineasDePagina(doc, n + 1, cacheLineas),
          });
        }
        encontradas.push({ pagina: n, caja, ancla: a.ancla, anclaDespues: a.despues });
      }
      try { pg.cleanup(); } catch (_) { /* nada */ }
    }
    return { figuras: [], barrido: encontradas, cancelado: false, paginasConFigura: paginas.length };
  }
  const figuras = [];
  let hechas = 0;

  for (const n of paginas) {
    if (cancelacion.cancelado) break;
    if (figuras.length >= MAX_FIGURAS) break;
    let pagina = null;
    try {
      const utiles = candidatas.get(n)
        .filter((c) => !esAdorno(c, cuenta.get(firma(c)) || 0, areaPagina.get(n) || 1));
      if (!utiles.length) { hechas += 1; continue; }

      pagina = await doc.getPage(n);
      const vista = pagina.getViewport({ scale: 1 });
      const textContent = await pagina.getTextContent();
      const lineas = lineasDeTexto(textContent, vista.transform);

      for (const bruta of fusionar(utiles)) {
        if (figuras.length >= MAX_FIGURAS) break;
        let caja = ampliarConRotulos(bruta, lineas, vista.height);
        caja = {
          x0: Math.max(0, caja.x0), y0: Math.max(0, caja.y0),
          x1: Math.min(vista.width, caja.x1), y1: Math.min(vista.height, caja.y1),
        };
        const recorte = await recortar(pagina, caja, anchoObjetivo);
        if (!recorte) continue;
        let a = anclaDeFigura(caja, lineas);
        if (!a.ancla) {
          a = anclaDeFigura(caja, lineas, {
            antes: await lineasDePagina(doc, n - 1, cacheLineas),
            despues: await lineasDePagina(doc, n + 1, cacheLineas),
          });
        }
        const { ancla, despues } = a;
        figuras.push({
          pagina: n,
          ancla,
          anclaDespues: despues,
          ancho: recorte.ancho,
          alto: recorte.alto,
          blob: recorte.blob,
        });
      }
    } catch (error) {
      console.warn('[jg-figuras] recorte página', n, error);
    } finally {
      try { pagina?.cleanup(); } catch (_) { /* nada */ }
    }
    hechas += 1;
    if (avisar) avisar(hechas, paginas.length, 'recorte');
    await ceder();
  }

  return { figuras, cancelado: cancelacion.cancelado, paginasConFigura: paginas.length };
}

/** Devuelve el hilo al navegador para que la app siga respondiendo. */
function ceder() {
  if (typeof globalThis.scheduler?.yield === 'function') return globalThis.scheduler.yield();
  return new Promise((listo) => setTimeout(listo, 0));
}

/* ── Colocación en el texto ──────────────────────────────────────────── */

/** Igual que `compactar`, pero guardando de dónde salió cada letra. */
function compactarConMapa(texto) {
  const t = String(texto || '');
  let salida = '';
  const mapa = [];
  for (let i = 0; i < t.length; i += 1) {
    const c = t[i].normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
    if ((c >= 'a' && c <= 'z') || (c >= '0' && c <= '9')) { salida += c; mapa.push(i); }
  }
  return { texto: salida, mapa };
}

/**
 * Dónde va cada figura DENTRO de un texto concreto (el de un capítulo).
 *
 * Se busca por contenido, no por contar letras: así funciona igual aunque el
 * texto se haya pulido, repartido en partes o corregido a mano. Es la misma
 * técnica con la que la app sitúa las páginas y la guía de voz.
 *
 * @param {string} texto
 * @param {Array} figuras
 * @returns {Array} las que caen en este texto, con `posicion` puesta
 */
export function situarFiguras(texto, figuras) {
  if (!texto || !Array.isArray(figuras) || !figuras.length) return [];
  const compacto = compactarConMapa(texto);
  const salida = [];
  /* Las figuras van en orden de página, así que sus posiciones solo pueden ir
   * hacia delante. Sin esto, un ancla que también aparece en el índice del
   * libro mandaría la figura a la primera página. */
  let desde = 0;
  const orden = figuras
    .map((f, i) => ({ f, i }))
    .sort((a, b) => (a.f?.pagina || 0) - (b.f?.pagina || 0));
  for (const { f, i } of orden) {
    const aguja = String(f?.ancla || '');
    if (aguja.length < 10) continue;
    const buscar = (s) => (s.length < 10 ? -1 : compacto.texto.indexOf(s, desde));
    let donde = buscar(aguja);
    if (donde === -1 && aguja.length > 24) donde = buscar(aguja.slice(-24));
    if (donde === -1 && aguja.length > 16) donde = buscar(aguja.slice(0, 16));
    if (donde === -1) continue;
    desde = donde + 1;
    /* Si el ancla venía de ABAJO, la figura va antes de ese texto. */
    const letra = f.anclaDespues ? donde : donde + Math.min(aguja.length, 24);
    salida.push({ ...f, indice: i, posicion: compacto.mapa[Math.min(letra, compacto.mapa.length - 1)] ?? 0 });
  }
  return salida.sort((a, b) => a.posicion - b.posicion);
}
