/* JG Turbo · Vista de libro v2.39 (apartado PDF, encapsulado)
 *
 * Lectura cómoda en móvil, tableta y escritorio: contenido HTML semántico
 * (párrafos, títulos, listas, citas, tablas); el textarea queda reservado
 * para Editar (Guardar/Cancelar). Cambiar tamaño, anchura o tema no modifica
 * palabras, párrafos ni posición guardada: solo presentación.
 */
import { aplicarDecisionUsuario } from './limites.js';
import { construirLectura } from './mapaLectura.js';

/* Se reexporta para que las pruebas y quien ya usaba la vista
 * sigan encontrando el constructor del HTML en este módulo. */
export { construirLectura };

function esc(texto) {
  return String(texto ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function leerApariencia() {
  let cfg = { tam: 19, inter: 1.7, ancho: 64, fuente: 'sans', tema: null, modo: 'lectura', modoPagina: 'paginas' };
  try {
    const crudo = localStorage.getItem('jg_pdf_lectura');
    if (crudo) cfg = { ...cfg, ...JSON.parse(crudo) };
  } catch (_) {}
  return cfg;
}
function guardarApariencia(cfg) {
  try { localStorage.setItem('jg_pdf_lectura', JSON.stringify(cfg)); } catch (_) {}
}

/** Convierte el texto de la parte en HTML semántico (sin inventar nada). */

export function initLibroVista({ el, estado, api }) {
  if (!el || !estado) return;
  const cfg = leerApariencia();
  let lugarAnterior = null;

  function aplicarApariencia() {
    const art = el.lectura;
    if (art) {
      art.style.fontSize = cfg.tam + 'px';
      art.style.lineHeight = String(cfg.inter);
      art.dataset.ancho = String(cfg.ancho);
      art.dataset.fuente = cfg.fuente;
    }
    if (el.salida) {
      el.salida.style.fontSize = cfg.tam + 'px';
      el.salida.style.lineHeight = String(cfg.inter);
    }
    if (el.aparTam) el.aparTam.value = String(cfg.tam);
    if (el.aparInter) el.aparInter.value = String(cfg.inter);
    if (el.aparAncho) el.aparAncho.value = String(cfg.ancho);
    if (el.aparFuente) el.aparFuente.value = cfg.fuente;
    if (el.aparModo) el.aparModo.value = cfg.modoPagina === 'scroll' ? 'scroll' : 'paginas';
    guardarApariencia(cfg);
    if (el.textoCol) el.textoCol.style.setProperty('--pdf-col-ancho', cfg.ancho + 'ch');
    /* Cambiar el tamaño o el ancho cambia cuántas palabras caben: hay que
     * repartir las páginas otra vez, conservando el sitio. */
    if (typeof medirPaginas === 'function') medirPaginas();
  }

  function fijarTema(tema) {
    // Papel y Noche ya existían; se añade Sepia y se respeta el guardado.
    const area = el.resultArea;
    const valido = tema === 'papel' || tema === 'noche' || tema === 'sepia' ? tema : 'noche';
    if (area) area.dataset.tema = valido;
    try {
      document.body.dataset.lecturaTema = valido;
      localStorage.setItem('jg_pdf_tema', valido);
    } catch (_) {}
  }
  try {
    const guardado = localStorage.getItem('jg_pdf_tema');
    if (guardado === 'papel' || guardado === 'noche' || guardado === 'sepia') fijarTema(guardado);
  } catch (_) {}

  function fijarModo(modo) {
    cfg.modo = modo === 'editar' ? 'editar' : 'lectura';
    guardarApariencia(cfg);
    const editar = cfg.modo === 'editar';
    if (el.lectura) el.lectura.hidden = editar;
    if (el.textoCaja) el.textoCaja.hidden = !editar;
    else if (el.salida) el.salida.hidden = !editar;
    if (el.editarBarra) el.editarBarra.hidden = !editar;
    if (el.vistaLectura) {
      el.vistaLectura.classList.toggle('is-on', !editar);
      el.vistaLectura.setAttribute('aria-pressed', String(!editar));
    }
    if (el.vistaEditar) {
      el.vistaEditar.classList.toggle('is-on', editar);
      el.vistaEditar.setAttribute('aria-pressed', String(editar));
    }
    if (el.paginacion) el.paginacion.hidden = editar || !hayPaginado();
    requestAnimationFrame(() => medirPaginas());
  }

  function renderLectura({ conservar = false } = {}) {
    if (!el.lectura) return;
    const ancla = conservar ? caracterVisible() : 0;
    const texto = api.textoDeParte ? api.textoDeParte(estado.parteActual) : (el.salida ? el.salida.value : '');
    /* El HTML trae las posiciones puestas: no hace falta añadir nada al texto. */
    el.lectura.innerHTML = construirLectura(texto);
    // Capítulo y página física son referencias distintas: las partes internas
    // de procesamiento no se presentan como páginas del libro.
    if (el.docRef) {
      const parte = (estado.partes || [])[estado.parteActual];
      const cap = Number(estado.parteActual) + 1;
      const total = (estado.partes || []).length || 1;
      const pag = parte?.pagina || parte?.pageStart || '';
      el.docRef.textContent = pag
        ? 'Capítulo ' + cap + ' de ' + total + ' · Página ' + pag
        : 'Capítulo ' + cap + ' de ' + total;
    }
    // «Revisar cortes» solo aparece cuando hay algo que revisar.
    const pend = (estado.limites || []).filter((l) => l && l.decision === 'pending').length;
    if (el.cortesCuenta) el.cortesCuenta.textContent = pend ? '(' + pend + ')' : '';
    if (el.btnCortes) el.btnCortes.hidden = pend === 0;
    /* Capítulo nuevo: se reparte desde su primera página. */
    pag.actual = 0;
    requestAnimationFrame(() => { medirPaginas({ conservar: false }); if (ancla) irACaracter(ancla); });
  }

  /* Tocar un párrafo lo lee en voz alta desde ahí.
   *
   * En modo lectura el texto no es editable, así que el toque simple está
   * libre: es el gesto más corto posible y el que ya usan los lectores con
   * voz. Se ignora si la persona estaba seleccionando texto, para no
   * secuestrar el copiar y pegar. */
  if (el.lectura) {
    el.lectura.addEventListener('click', (ev) => {
      const bloque = ev.target.closest('[data-ini]');
      if (!bloque || !el.lectura.contains(bloque)) return;
      const seleccion = document.getSelection();
      if (seleccion && String(seleccion).trim().length > 1) return;
      const ini = Number(bloque.dataset.ini);
      if (!Number.isFinite(ini)) return;
      if (api.leerDesdeCaracter) api.leerDesdeCaracter(ini);
    });
  }

  let seguimiento = true;
  /* Marca el tramo [ini, fin) del texto dentro de la vista.
   *
   * Antes se buscaba el fragmento con `indexOf`, que marcaba la primera
   * aparición de la frase aunque la voz fuera por la quinta. Con las
   * posiciones del mapa se marca exactamente lo que suena. */
  function marcarRango(ini, fin) {
    if (!el.lectura || !(fin > ini)) return null;
    const previa = el.lectura.querySelector('mark');
    if (previa) previa.replaceWith(document.createTextNode(previa.textContent));

    const bloque = [...el.lectura.querySelectorAll('[data-ini]')].reverse()
      .find((b) => Number(b.dataset.ini) <= ini && Number(b.dataset.fin) > ini);
    if (!bloque) return null;

    const base = Number(bloque.dataset.ini);
    const desde = ini - base;
    const hasta = Math.min(fin - base, bloque.textContent.length);
    if (!(hasta > desde)) return null;

    const recorrido = document.createTreeWalker(bloque, NodeFilter.SHOW_TEXT);
    let visto = 0;
    let marca = null;
    while (recorrido.nextNode()) {
      const nodo = recorrido.currentNode;
      const largo = nodo.textContent.length;
      if (visto + largo > desde) {
        const a = Math.max(0, desde - visto);
        const b = Math.min(largo, hasta - visto);
        const trozos = document.createDocumentFragment();
        if (a > 0) trozos.appendChild(document.createTextNode(nodo.textContent.slice(0, a)));
        marca = document.createElement('mark');
        marca.textContent = nodo.textContent.slice(a, b);
        trozos.appendChild(marca);
        if (b < largo) trozos.appendChild(document.createTextNode(nodo.textContent.slice(b)));
        nodo.replaceWith(trozos);
        break;
      }
      visto += largo;
    }
    return marca;
  }

  /* ── Paso de páginas ─────────────────────────────────────────────────
   *
   * Un capítulo de 1 300 palabras ocupaba 5 679 px de alto en una ventana
   * donde solo se ven 561: diez pantallazos de rueda para leerlo. Aquí el
   * texto fluye en columnas del ancho exacto del lector, así que cada columna
   * es una página y se avanza moviendo el contenedor de lado.
   *
   * Lo importante es que el DOM no cambia: son los mismos bloques con sus
   * mismos `data-ini`, así que las posiciones guardadas, el resaltado de la
   * voz y «leer desde aquí» siguen funcionando sin enterarse. */
  const pag = { total: 1, actual: 0, paso: 0, activo: false, ancla: 0, saltando: false };
  /* Un salto de página lleva ~300 ms de desplazamiento suave. Remaquetar
   * durante ese rato deja la lectura en un sitio que no eligió nadie. */
  let tempoSalto = null;

  function hayPaginado() { return cfg.modoPagina !== 'scroll'; }

  function pintarPaginacion() {
    if (el.pagPos) el.pagPos.textContent = (pag.actual + 1) + ' de ' + pag.total;
    if (el.pagPrev) el.pagPrev.disabled = pag.actual <= 0;
    if (el.pagNext) el.pagNext.disabled = pag.actual >= pag.total - 1;
  }

  function irAPagina(n, { suave = true, guardar = true } = {}) {
    const art = el.lectura;
    if (!art || !pag.activo || !pag.paso) return;
    pag.actual = Math.max(0, Math.min(pag.total - 1, Math.round(Number(n) || 0)));
    art.scrollTo({
      left: pag.actual * pag.paso,
      behavior: suave && !prefiereMenosMovimiento() ? 'smooth' : 'auto',
    });
    pintarPaginacion();
    /* `caracterVisible()` se apoya en `pag.actual`, que aquí ya es la página
     * destino, y su cálculo no depende de dónde vaya la animación: por eso
     * puede anotarse el sitio sin esperar a que el desplazamiento termine. */
    pag.ancla = caracterVisible();
    pag.saltando = true;
    clearTimeout(tempoSalto);
    tempoSalto = setTimeout(() => { pag.saltando = false; }, 420);
    if (guardar && api.anotarPagina) api.anotarPagina(pag.ancla);
  }

  /** En qué página cae un elemento del texto. */
  function paginaDe(elemento) {
    if (!pag.activo || !pag.paso || !elemento) return 0;
    const rect = elemento.getClientRects()[0];
    return rect ? paginaDeRect(rect) : 0;
  }

  function paginaDeRect(rect) {
    /* `scrollLeft` no es un detalle: convierte la posición en pantalla del
     * rectángulo a posición dentro del texto. Sustituirlo por el destino de
     * un salto en curso rompe esa conversión y la lectura vuelve al inicio. */
    return Math.max(0, Math.floor((rect.left - el.lectura.getBoundingClientRect().left + el.lectura.scrollLeft + 2) / pag.paso));
  }

  /* Mide el hueco disponible y reparte el texto en páginas. Hay que soltar la
   * altura antes de medir: si se mide con la altura ya fijada, cada recálculo
   * heredaría el valor anterior y la página iría encogiendo. */
  function medirPaginas({ conservar = true } = {}) {
    const art = el.lectura;
    if (!art || art.hidden || !art.getClientRects().length) return;
    const col = el.textoCol;

    if (!hayPaginado()) {
      art.removeAttribute('data-paginado');
      art.style.height = '';
      art.style.flex = '';
      art.style.columnWidth = '';
      if (col) col.removeAttribute('data-paginado');
      if (el.paginacion) el.paginacion.hidden = true;
      pag.activo = false;
      art.scrollLeft = 0;
      return;
    }

    const anclaIni = conservar ? (pag.ancla || 0) : 0;

    art.dataset.paginado = 'si';
    if (col) col.dataset.paginado = 'si';
    if (el.paginacion) el.paginacion.hidden = false;

    /* Se suelta la altura para que el flex reparta el hueco de verdad. */
    art.style.height = '0px';
    art.style.flex = 'none';
    art.style.columnWidth = '';
    const visibles = [...col.children].filter(e => e !== art && getComputedStyle(e).display !== 'none' && !['fixed','absolute'].includes(getComputedStyle(e).position));
    const estiloCol = getComputedStyle(col);
    const huecos = (parseFloat(estiloCol.rowGap) || 0) * visibles.length;
    const bordes = (parseFloat(estiloCol.paddingTop) || 0) + (parseFloat(estiloCol.paddingBottom) || 0);
    const alto = Math.floor(col.clientHeight - bordes - visibles.reduce((n,e) => n + e.getBoundingClientRect().height, 0) - huecos);
    const ancho = art.clientWidth;
    if (alto < 80 || ancho < 80) { pag.activo = false; return; }

    art.style.height = alto + 'px';
    art.style.flex = 'none';
    art.style.columnWidth = ancho + 'px';
    const hueco = parseFloat(getComputedStyle(art).columnGap) || 44;
    pag.paso = ancho + hueco;
    pag.activo = true;
    pag.total = Math.max(1, Math.round((art.scrollWidth + hueco) / pag.paso));

    /* Se vuelve a la página donde estaba el texto que se estaba leyendo, no a
     * un número de página: cambiar el tamaño de letra mueve los números. */
    const destino = anclaIni > 0 ? rangoDeCaracter(anclaIni) : null;
    pag.actual = destino ? paginaDe(destino) : 0;
    irAPagina(pag.actual, { suave: false, guardar: false });
  }

  function rangoDeCaracter(caracter) {
    const bloque = bloqueDeCaracter(caracter);
    if (!bloque) return null;
    let resto = Math.max(0, caracter - Number(bloque.dataset.ini));
    const walker = document.createTreeWalker(bloque, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const nodo = walker.currentNode;
      if (resto < nodo.length) {
        const rango = document.createRange(); rango.setStart(nodo, resto); rango.setEnd(nodo, resto + 1); return rango;
      }
      resto -= nodo.length;
    }
    return bloque;
  }

  function bloqueDeCaracter(caracter) {
    if (!el.lectura) return null;
    const bloques = [...el.lectura.querySelectorAll('[data-ini]')];
    if (!bloques.length) return null;
    return bloques.reverse().find((b) => Number(b.dataset.ini) <= caracter) || bloques[bloques.length - 1];
  }

  if (el.pagPrev) el.pagPrev.addEventListener('click', () => irAPagina(pag.actual - 1));
  if (el.pagNext) el.pagNext.addEventListener('click', () => irAPagina(pag.actual + 1));

  /* Con el teclado, las flechas pasan página cuando el foco está en el texto. */
  if (el.lectura) {
    el.lectura.addEventListener('keydown', (ev) => {
      if (!pag.activo) return;
      if (ev.key === 'ArrowRight' || ev.key === 'PageDown') { ev.preventDefault(); irAPagina(pag.actual + 1); }
      if (ev.key === 'ArrowLeft' || ev.key === 'PageUp') { ev.preventDefault(); irAPagina(pag.actual - 1); }
    });

    /* Deslizar pasa página; el toque simple sigue siendo «leer desde aquí»,
     * así que los dos gestos conviven sin pisarse. */
    let inicio = null;
    el.lectura.addEventListener('touchstart', (ev) => {
      const t = ev.changedTouches && ev.changedTouches[0];
      inicio = t ? { x: t.clientX, y: t.clientY } : null;
    }, { passive: true });
    el.lectura.addEventListener('touchend', (ev) => {
      if (!inicio || !pag.activo) return;
      const t = ev.changedTouches && ev.changedTouches[0];
      if (!t) return;
      const dx = t.clientX - inicio.x;
      const dy = t.clientY - inicio.y;
      inicio = null;
      if (Math.abs(dx) < 45 || Math.abs(dx) < Math.abs(dy) * 1.4) return;
      irAPagina(pag.actual + (dx < 0 ? 1 : -1));
    }, { passive: true });
  }

  /* Girar el teléfono o abrir el teclado cambia el hueco: se vuelve a repartir
   * sin perder el sitio. */
  let tempoMedir = null;
  window.addEventListener('resize', () => {
    clearTimeout(tempoMedir);
    tempoMedir = setTimeout(() => medirPaginas(), 180);
  });
  if (typeof ResizeObserver !== 'undefined' && el.textoCol) {
    const observar = new ResizeObserver(() => {
      clearTimeout(tempoMedir);
      tempoMedir = setTimeout(() => medirPaginas(), 40);
    });
    observar.observe(el.textoCol);
    for (const nodo of el.textoCol.children) if (nodo !== el.lectura) observar.observe(nodo);
  }
  document.fonts?.ready.then(() => medirPaginas());

  function prefiereMenosMovimiento() {
    try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (_) { return false; }
  }

  /* Lleva la marca a la zona cómoda de lectura (algo por encima del centro,
   * que es donde el ojo la espera) y solo cuando hace falta: si la frase ya se
   * ve, mover la página sería un tirón gratuito. */
  function desplazarA(elemento) {
    if (!elemento || !seguimiento) return;
    /* Con páginas no se desplaza: se pasa a la página donde suena la frase, y
     * solo si no es la que ya se está viendo. */
    if (pag.activo) {
      const destino = paginaDe(elemento);
      if (destino !== pag.actual) irAPagina(destino);
      return;
    }
    const caja = elemento.getBoundingClientRect();
    const alto = window.innerHeight || 800;
    if (caja.top > alto * 0.20 && caja.bottom < alto * 0.80) return;
    elemento.scrollIntoView({ block: 'center', behavior: prefiereMenosMovimiento() ? 'auto' : 'smooth' });
  }

  /* Seguimiento del audio: se suspende en cuanto la persona se desplaza a
   * mano (rueda, dedo o barra) y se recupera con «Volver a la lectura».
   * Antes solo escuchaba la rueda del ratón, así que en el teléfono —donde
   * más se lee— nunca se suspendía. */
  function onDesplazarManual() {
    /* Pasar página es navegar, no apartarse de la voz: solo el desplazamiento
     * libre suspende el seguimiento. */
    if (pag.activo) return;
    if (!seguimiento) return;
    seguimiento = false;
    if (el.volverLectura) el.volverLectura.hidden = false;
  }
  const zona = el.area || el.lectura;
  if (zona) {
    zona.addEventListener('wheel', onDesplazarManual, { passive: true });
    zona.addEventListener('touchmove', onDesplazarManual, { passive: true });
    zona.addEventListener('scroll', onDesplazarManual, { passive: true });
  }
  if (el.volverLectura) el.volverLectura.addEventListener('click', () => {
    seguimiento = true;
    el.volverLectura.hidden = true;
    const marca = el.lectura && el.lectura.querySelector('mark');
    if (marca) marca.scrollIntoView({ block: 'center' });
  });

  /* Lleva la vista al carácter guardado: así un libro se reabre donde se dejó. */
  function irACaracter(caracter) {
    if (!el.lectura) return;
    const destino = rangoDeCaracter(caracter);
    if (!destino) return;
    if (pag.activo) { irAPagina(paginaDe(destino), { suave: false, guardar: false }); return; }
    bloqueDeCaracter(caracter)?.scrollIntoView({ block: 'start' });
  }

  /* Por dónde va quien lee con los ojos: el primer bloque todavía visible. */
  function caracterVisible() {
    if (!el.lectura) return 0;
    const bloques = el.lectura.querySelectorAll('[data-ini]');
    /* Con páginas, «lo que se ve» es el primer bloque de la página abierta. */
    if (pag.activo && pag.paso) {
      for (const b of bloques) {
        if (b.querySelector('[data-ini]')) continue;
        const walker = document.createTreeWalker(b, NodeFilter.SHOW_TEXT);
        let offset = Number(b.dataset.ini) || 0;
        while (walker.nextNode()) {
          const nodo = walker.currentNode;
          if (!nodo.length) continue;
          const rango = document.createRange();
          const paginaEn = (i) => { rango.setStart(nodo,i); rango.setEnd(nodo,i+1); return paginaDe(rango); };
          if (paginaEn(nodo.length - 1) >= pag.actual) {
            let a = 0, z = nodo.length - 1;
            while (a < z) { const m = Math.floor((a+z)/2); if (paginaEn(m) < pag.actual) a=m+1; else z=m; }
            return offset + a;
          }
          offset += nodo.length;
        }
      }
      return 0;
    }
    for (const b of bloques) {
      if (b.getBoundingClientRect().bottom > 0) return Number(b.dataset.ini) || 0;
    }
    return 0;
  }

  // Editar con Guardar y Cancelar (una corrección posterior no pisa lo aprobado).
  let borrador = null;
  if (el.vistaLectura) el.vistaLectura.addEventListener('click', () => fijarModo('lectura'));
  if (el.vistaEditar) el.vistaEditar.addEventListener('click', () => {
    borrador = el.salida ? el.salida.value : '';
    fijarModo('editar');
    if (el.salida) el.salida.focus();
  });
  if (el.editarGuardar) el.editarGuardar.addEventListener('click', () => {
    if (api.guardarEdicion) api.guardarEdicion(true);
    if (el.modoEstados) el.modoEstados.textContent = 'Edición guardada.';
    fijarModo('lectura');
    renderLectura();
  });
  if (el.editarCancelar) el.editarCancelar.addEventListener('click', () => {
    if (borrador != null && el.salida) {
      el.salida.value = borrador;
      el.salida.dispatchEvent(new Event('input', { bubbles: true }));
    }
    if (el.modoEstados) el.modoEstados.textContent = 'Edición descartada.';
    fijarModo('lectura');
  });

  // Apariencia
  if (el.aparTam) el.aparTam.addEventListener('input', () => { cfg.tam = Number(el.aparTam.value) || 19; aplicarApariencia(); });
  if (el.aparInter) el.aparInter.addEventListener('input', () => { cfg.inter = Number(el.aparInter.value) || 1.7; aplicarApariencia(); });
  if (el.aparAncho) el.aparAncho.addEventListener('change', () => { cfg.ancho = Number(el.aparAncho.value) || 64; aplicarApariencia(); });
  if (el.aparFuente) el.aparFuente.addEventListener('change', () => { cfg.fuente = el.aparFuente.value === 'serif' ? 'serif' : 'sans'; aplicarApariencia(); });
  /* Pasar páginas o desplazar: cada quien lee distinto, y la elección se
   * recuerda. */
  if (el.aparModo) el.aparModo.addEventListener('change', () => {
    cfg.modoPagina = el.aparModo.value === 'scroll' ? 'scroll' : 'paginas';
    guardarApariencia(cfg);
    medirPaginas({ conservar: true });
  });
  // Los tres temas, en un solo sitio y con su estado a la vista.
  function pintarTemas(activo) {
    for (const b of [el.temaPapel, el.temaSepia, el.temaNoche]) {
      if (!b) continue;
      const suyo = b.dataset.tema;
      b.classList.toggle('is-on', suyo === activo);
      b.setAttribute('aria-pressed', String(suyo === activo));
    }
  }
  for (const b of [el.temaPapel, el.temaSepia, el.temaNoche]) {
    if (!b) continue;
    b.addEventListener('click', () => { fijarTema(b.dataset.tema); pintarTemas(b.dataset.tema); });
  }
  try { pintarTemas(localStorage.getItem('jg_pdf_tema') || 'noche'); } catch (_) { pintarTemas('noche'); }

  // Hoja de apariencia: se abre desde la cabecera, se cierra con Escape o con
  // su botón, y devuelve el foco al botón que la abrió.
  if (el.btnApariencia && el.aparienciaHoja) {
    /* Quién abrió la hoja: en el teléfono es el botón de la barra del pulgar y
     * en escritorio el de la cabecera. Devolver el foco «al de la cabecera»
     * sin mirar lo perdía en el teléfono, porque allí está oculto y `focus()`
     * sobre un elemento sin caja no hace nada: el foco se iba al <body> y
     * quien navega con teclado quedaba en la nada. */
    let abrioApariencia = el.btnApariencia;
    const cerrarApariencia = () => {
      el.aparienciaHoja.hidden = true;
      el.btnApariencia.setAttribute('aria-expanded', 'false');
      /* Se vuelve al control que abrió; si ese no está a la vista (la hoja
       * se abrió desde la cabecera pero estamos en el teléfono, donde vive
       * en la barra del pulgar), al equivalente que sí lo esté. Nunca al
       * <body>: quien navega con teclado se quedaría sin sitio. */
      const candidatos = [abrioApariencia, el.btnApariencia, document.getElementById('btnPdfBmApariencia')];
      const volver = candidatos.find((c) => c && c.offsetParent !== null);
      if (volver) volver.focus();
    };
    const abrirApariencia = (origen) => {
      if (!el.aparienciaHoja.hidden) { cerrarApariencia(); return; }
      abrioApariencia = origen || el.btnApariencia;
      el.aparienciaHoja.hidden = false;
      el.btnApariencia.setAttribute('aria-expanded', 'true');
      const primero = el.aparienciaHoja.querySelector('button, select, input');
      if (primero) primero.focus();
    };
    el.abrirApariencia = abrirApariencia;
    el.btnApariencia.addEventListener('click', () => abrirApariencia(el.btnApariencia));
    el.aparienciaHoja.addEventListener('keydown', (ev) => { if (ev.key === 'Escape') cerrarApariencia(); });
    const cerrarBoton = el.aparienciaHoja.querySelector('[data-cerrar-hoja="pdfAparienciaHoja"]');
    if (cerrarBoton) cerrarBoton.addEventListener('click', cerrarApariencia);
  }

  /* ═══════════════════════════════════════════════════════════════════════
     Teléfono: barra del pulgar y lectura inmersiva
     ──────────────────────────────────────────────────────────────────────
     Medido antes de esto en 390×844: la cabecera se partía en dos filas
     (108 px), abajo se apilaban cuatro barras (198 px) y al texto le
     quedaba el 44 % de la pantalla. En 320 px, el 23 %.

     Aquí no se duplica ningún control: los cuatro botones de abajo
     accionan los MISMOS elementos de la cabecera, que en el teléfono se
     ocultan por CSS. Una sola fuente de verdad; si mañana cambia el
     comportamiento de «Contenido», cambia en un solo sitio.
     ═══════════════════════════════════════════════════════════════════════ */
  const TELEFONO = '(max-width:640px)';
  const enTelefono = () => window.matchMedia(TELEFONO).matches;
  const $$ = (id) => document.getElementById(id);

  const barraMovil = $$('pdfBarraMovil');
  const dock = $$('pdfDockNav');

  /* El reproductor completo vive tras el botón «Voz»: solo ocupa pantalla
     mientras se usa, en vez de robar 198 px permanentes. */
  /* `modo`: false = cerrada · true/'si' = reproductor · 'buscar' = buscador. */
  function abrirDock(modo) {
    if (!dock || !enTelefono()) return;
    const valor = modo === 'buscar' ? 'buscar' : (modo ? 'si' : 'no');
    dock.dataset.abierto = valor;
    const btn = $$('btnPdfBmVoz');
    if (btn) btn.classList.toggle('is-on', valor === 'si');
  }
  if (dock) dock.dataset.abierto = 'no';

  const puentes = [
    ['btnPdfBmVoz', () => abrirDock((dock?.dataset.abierto || 'no') !== 'si')],
    ['btnPdfBmApariencia', () => {
      abrirDock(false);
      const b = $$('btnPdfBmApariencia');
      if (el.abrirApariencia) el.abrirApariencia(b); else el.btnApariencia?.click();
    }],
    ['btnPdfBmIndice', () => { abrirDock(false); el.btnIndice?.click(); }],
    ['btnPdfBmOpciones', () => { abrirDock(false); el.btnMas?.click(); }],
    /* La entrada de búsqueda del teléfono vive DENTRO de «Opciones», así que
       al usarla hay que cerrar esa hoja y desplegar el mismo buscador de la
       cabecera: no hay dos buscadores, hay dos puertas al mismo. */
    ['btnPdfBuscarMovil', () => {
      if (el.masMenu && el.masMenu.open) el.btnMas?.click();
      if (el.buscarFila && el.buscarFila.hidden) el.buscarToggle?.click();
      abrirDock('buscar');
      const campo = document.getElementById('pdfSearch');
      if (campo) campo.focus();
    }],
  ];
  for (const [id, accion] of puentes) {
    const b = $$(id);
    if (b) b.addEventListener('click', accion);
  }

  /* Lectura inmersiva: el cromo se aparta al pasar de página y vuelve con
     cualquier toque. NO se usa «un toque en el texto» para apartarlo: en
     este lector tocar un párrafo ya significa «lee desde aquí», y las dos
     cosas se robarían el gesto. */
  let tempoInmersivo = null;
  /* Apartar el cromo NO cambia el tamaño del texto (el hueco queda
     reservado), así que aquí no se vuelve a repartir nada: es justo lo que
     evita que un salto de página se deshaga solo. */
  function inmersivo(activo) {
    if (!enTelefono()) { document.body.classList.remove('jg-inmersivo'); return; }
    document.body.classList.toggle('jg-inmersivo', !!activo);
  }
  function apartarCromo() {
    clearTimeout(tempoInmersivo);
    if (!enTelefono()) return;
    if (hayHojaOAbierto()) return;
    /* Se espera a que el salto de página termine. Apartar el cromo remaqueta
     * (el texto crece), y hacerlo a mitad del desplazamiento suave dejaba la
     * lectura en otra página: pulsabas «siguiente» y volvías al principio.
     * Lo cazó `verificar_pdf_paginas.mjs`. */
    const reintentar = () => {
      if (pag.saltando) { tempoInmersivo = setTimeout(reintentar, 120); return; }
      inmersivo(true);
    };
    tempoInmersivo = setTimeout(reintentar, 460);
  }
  function devolverCromo() {
    clearTimeout(tempoInmersivo);
    if (!document.body.classList.contains('jg-inmersivo')) return;
    inmersivo(false);
  }
  /* Con una hoja abierta o el reproductor desplegado, apartar el cromo
     dejaría al usuario mirando una hoja flotando sobre nada. */
  function hayHojaOAbierto() {
    if (dock && dock.dataset.abierto === 'si') return true;
    if (el.indice && !el.indice.hidden) return true;
    if (el.aparienciaHoja && !el.aparienciaHoja.hidden) return true;
    if (el.masMenu && el.masMenu.open) return true;
    return false;
  }

  /* Cerrar el buscador cierra la hoja: si no, quedaría una hoja vacía. */
  if (el.buscarToggle) el.buscarToggle.addEventListener('click', () => {
    if (el.buscarFila && el.buscarFila.hidden && dock?.dataset.abierto === 'buscar') abrirDock(false);
  });

  if (el.pagPrev) el.pagPrev.addEventListener('click', apartarCromo);
  if (el.pagNext) el.pagNext.addEventListener('click', apartarCromo);
  /* Cualquier toque devuelve los controles. `pointerdown` en fase de captura
     para que llegue antes que el gesto del párrafo, y sin cancelarlo: el
     doble toque de «leer desde aquí» sigue funcionando igual. */
  if (el.lectura) {
    el.lectura.addEventListener('pointerdown', devolverCromo, { capture: true, passive: true });
  }
  document.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape' && document.body.classList.contains('jg-inmersivo')) devolverCromo();
  });

  /* El único control que sobrevive al modo inmersivo: parar la voz. */
  const vozMiniPausa = $$('btnPdfVozMiniPausa');
  if (vozMiniPausa) {
    vozMiniPausa.addEventListener('click', () => {
      devolverCromo();
      abrirDock(true);
      const parar = $$('btnPdfAudiolibroStop') || document.querySelector('#pdfDockNav .btn-tts-stop');
      if (parar) parar.click();
    });
  }

  /* Al salir del teléfono (girar a horizontal, tablet) no queda un estado
     inmersivo colgado que en escritorio no tiene forma de deshacerse. */
  try {
    window.matchMedia(TELEFONO).addEventListener('change', (ev) => {
      if (!ev.matches) { document.body.classList.remove('jg-inmersivo'); if (dock) dock.dataset.abierto = 'no'; }
    });
  } catch (_) { /* navegador antiguo: se queda con el estado que tenga */ }

  // Revisar cortes: contexto, propuesta, página y Unir / Separar / Párrafo / Deshacer.
  const pilaDeshacer = [];
  function pintarCortes() {
    if (!el.cortesLista) return;
    el.cortesLista.innerHTML = '';
    const pend = (estado.limites || []).filter((l) => l && l.decision === 'pending');
    for (const lim of pend.slice(0, 40)) {
      const li = document.createElement('li');
      li.className = 'pdf-corte';
      const atomoIzq = (estado.atomos || []).find((a) => a.id === lim.leftAtomId);
      const pagina = atomoIzq?.page || '';
      const ctx = document.createElement('p');
      ctx.className = 'pdf-corte-ctx';
      ctx.textContent = '«' + (lim.leftFragment || '') + '» + «' + (lim.rightFragment || '') + '»' + (pagina ? ' · página ' + pagina : '');
      const prop = document.createElement('p');
      prop.className = 'pdf-corte-prop';
      prop.textContent = 'Comprueba el contexto o la página original y elige cómo deben quedar estos fragmentos.';
      const fila = document.createElement('div');
      fila.className = 'pdf-corte-acciones';
      const acciones = [
        ['Unir', 'join'],
        ['Mantener separado', 'space'],
        ['Separar párrafo', 'paragraph'],
      ];
      for (const [etiqueta, accion] of acciones) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'mini-btn';
        b.textContent = etiqueta;
        b.addEventListener('click', async () => {
          const antes = { ...lim };
          b.disabled = true;
          api.pausar?.();
          aplicarDecisionUsuario(lim, accion);
          try {
            await api.reconstruirTrasDecision?.();
            pilaDeshacer.push({ id: lim.id, antes });
          } catch (error) {
            Object.assign(lim, antes);
            api.avisar?.(error.message || 'No se pudo guardar el corte. Inténtalo de nuevo.', 'warn');
          }
          pintarCortes();
          renderLectura({ conservar: true });
        });
        fila.appendChild(b);
      }
      const ver = document.createElement('button');
      ver.type = 'button';
      ver.className = 'mini-btn';
      ver.textContent = 'Ver recorte';
      ver.addEventListener('click', () => api.verRecorte && api.verRecorte(lim));
      fila.appendChild(ver);
      li.appendChild(ctx);
      li.appendChild(prop);
      li.appendChild(fila);
      el.cortesLista.appendChild(li);
    }
    if (!pend.length) {
      const p = document.createElement('p');
      p.textContent = 'No hay cortes pendientes.';
      el.cortesLista.appendChild(p);
    }
    const deshacer = document.createElement('button');
    deshacer.type = 'button';
    deshacer.className = 'mini-btn';
    deshacer.textContent = 'Deshacer última';
    deshacer.disabled = !pilaDeshacer.length;
    deshacer.addEventListener('click', async () => {
      const ultimo = pilaDeshacer.pop();
      const lim = (estado.limites || []).find((l) => l.id === (ultimo && ultimo.id));
      if (lim && ultimo) {
        const actual = { ...lim };
        Object.assign(lim, ultimo.antes);
        try { await api.reconstruirTrasDecision?.(); }
        catch (error) { Object.assign(lim, actual); pilaDeshacer.push(ultimo); api.avisar?.(error.message, 'warn'); }
      }
      pintarCortes();
      renderLectura({ conservar: true });
    });
    el.cortesLista.appendChild(deshacer);
  }
  if (el.btnCortes) el.btnCortes.addEventListener('click', () => {
    if (el.cortesHoja) el.cortesHoja.hidden = false;
    pintarCortes();
  });
  if (el.cortesCerrar) el.cortesCerrar.addEventListener('click', () => { if (el.cortesHoja) el.cortesHoja.hidden = true; });
  el.cortesHoja?.addEventListener('keydown', ev => { if (ev.key === 'Escape') { el.cortesHoja.hidden = true; el.btnCortes?.focus(); } });
  if (el.recorteCerrar) el.recorteCerrar.addEventListener('click', () => {
    if (el.recorte) el.recorte.hidden = true;
    el.recorteCerrar.hidden = true;
  });

  // Vincular PDF original (valida que corresponde al documento por SHA-256).
  if (el.btnVincular && el.vincularInput) {
    el.btnVincular.addEventListener('click', () => el.vincularInput.click());
    el.vincularInput.addEventListener('change', async () => {
      const archivo = el.vincularInput.files && el.vincularInput.files[0];
      if (!archivo) return;
      try {
        // La huella del archivo se valida en el controlador. fuenteRevision
        // identifica texto y no puede compararse con los bytes de un PDF.
        await api.vincularArchivo?.(archivo);
      } catch (_) {}
      el.vincularInput.value = '';
    });
  }

  /* «Pausar» aparece cuando hay corrección en marcha. El controlador avisa al
   * cambiar el estado: no hace falta preguntar cada segundo. */
  function refrescarPausa() {
    if (el.btnPausar) el.btnPausar.hidden = !estado.correccionProgreso?.ejecutando;
  }
  if (el.btnPausar) el.btnPausar.addEventListener('click', () => api.pausar && api.pausar());
  refrescarPausa();

  // Búsqueda con coincidencias, contexto y ubicación (conserva el lugar).
  if (el.buscar) {
    el.buscar.addEventListener('input', () => {
      if (lugarAnterior == null && el.salida) lugarAnterior = el.salida.selectionStart || 0;
    });
  }
  function cerrarBusquedaRestaurando() {
    if (lugarAnterior != null && el.salida) {
      try { el.salida.setSelectionRange(lugarAnterior, lugarAnterior); } catch (_) {}
      lugarAnterior = null;
    }
  }
  if (el.buscarToggle) el.buscarToggle.addEventListener('click', () => {
    const fila = document.getElementById('pdfSearchRow');
    if (fila && fila.hidden) lugarAnterior = el.salida ? (el.salida.selectionStart || 0) : 0;
    if (fila && !fila.hidden) cerrarBusquedaRestaurando();
  });

  // Biblioteca: orden + vista + paginación de 40 (búsqueda sobre metadatos).
  if (el.orden) {
    try { el.orden.value = localStorage.getItem('jg_pdf_orden') || 'reciente'; } catch (_) {}
    el.orden.addEventListener('change', () => {
      try { localStorage.setItem('jg_pdf_orden', el.orden.value); } catch (_) {}
      api.repintarBiblioteca && api.repintarBiblioteca();
    });
  }
  function fijarVista(vista) {
    try { localStorage.setItem('jg_pdf_vista', vista); } catch (_) {}
    const bib = document.getElementById('pdfBiblioteca');
    if (bib) bib.dataset.vista = vista;
    if (el.vistaPortadas) {
      el.vistaPortadas.classList.toggle('is-on', vista !== 'compacta');
      el.vistaPortadas.setAttribute('aria-pressed', String(vista !== 'compacta'));
    }
    if (el.vistaCompacta) {
      el.vistaCompacta.classList.toggle('is-on', vista === 'compacta');
      el.vistaCompacta.setAttribute('aria-pressed', String(vista === 'compacta'));
    }
  }
  try { fijarVista(localStorage.getItem('jg_pdf_vista') || 'portadas'); } catch (_) {}
  if (el.vistaPortadas) el.vistaPortadas.addEventListener('click', () => fijarVista('portadas'));
  if (el.vistaCompacta) el.vistaCompacta.addEventListener('click', () => fijarVista('compacta'));
  if (el.mostrarMas) el.mostrarMas.addEventListener('click', () => api.mostrarMasBiblioteca && api.mostrarMasBiblioteca());

  aplicarApariencia();
  fijarModo(cfg.modo);

  return {
    renderLectura,
    marcarRango,
    desplazarA,
    irACaracter,
    caracterVisible,
    pintarCortes,
    aplicarApariencia,
    fijarModo,
    construirLectura,
    refrescarPausa,
    medirPaginas,
    irAPagina,
    estadoPaginas: () => ({ ...pag }),
    leerOrden() { try { return localStorage.getItem('jg_pdf_orden') || 'reciente'; } catch (_) { return 'reciente'; } },
  };
}

export function ordenarDocumentos(docs, modo) {
  const lista = (docs || []).slice();
  if (modo === 'titulo') lista.sort((a, b) => String(a.titulo || '').localeCompare(String(b.titulo || ''), 'es'));
  else if (modo === 'creado') lista.sort((a, b) => (Number(b.creado) || 0) - (Number(a.creado) || 0));
  else lista.sort((a, b) => (Number(b.actualizado) || Number(b.creado) || 0) - (Number(a.actualizado) || Number(a.creado) || 0));
  return lista;
}

export function paginarDocumentos(docs, limite = 40) {
  const lista = docs || [];
  return { visibles: lista.slice(0, limite), resto: Math.max(0, lista.length - limite) };
}
