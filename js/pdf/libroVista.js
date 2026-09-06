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
  /* `tamElegido`: si la persona movió el control de tamaño. Mientras no lo
   * haga, en el teléfono manda un tamaño fluido que mantiene la línea en
   * 32-46 caracteres. En cuanto lo mueve, manda ella: alguien con poca
   * vista tiene que poder agrandar aunque la línea quede corta. */
  let cfg = { tam: 19, inter: 1.7, ancho: 64, fuente: 'sans', tema: null, modo: 'lectura', modoPagina: 'paginas', tamElegido: false };
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
    /* La métrica viaja en variables CSS sobre #pdfResultArea: así hay una
     * sola fuente de verdad para el artículo de lectura y las dos capas del
     * editor, y el mínimo móvil (máx. con 17px en la media query) ya no se
     * puede pisar desde aquí. */
    const area = el.resultArea || el.lectura;
    if (area) {
      area.style.setProperty('--lec-tam', cfg.tam + 'px');
      area.style.setProperty('--lec-inter', String(cfg.inter));
    }
    const art = el.lectura;
    if (art) {
      art.dataset.ancho = String(cfg.ancho);
      art.dataset.fuente = cfg.fuente;
      art.dataset.tamAuto = cfg.tamElegido ? 'no' : 'si';
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
    programarMedicion(100);
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
    if (!conservar) pag.ancla = 0;
    traerTipografiaLectura();
    ajustarComposicion();
    requestAnimationFrame(() => {
      medirCabecera();
      medirPaginas({ conservar: false });
      if (ancla) irACaracter(ancla);
      pintarPieLectura();
      limpiarAlAbrir();
      /* Se intenta también al abrir el capítulo. `unirPalabras` vuelve a
       * pintar, así que hay que evitar el bucle: solo se dispara cuando el
       * render NO viene de una unión (ver `uniendo`). */
      if (!uniendo && typeof api.unirPalabrasAuto === 'function') api.unirPalabrasAuto();
      else if (uniendo) marcarUnir('trabajando');
    });
  }

  /* Un doble toque en un párrafo lo lee en voz alta desde ahí.
   *
   * En modo lectura el texto no es editable, así que el doble toque está
   * libre y ya es el gesto que usa el textarea para lo mismo. NO se usa el
   * toque simple: desde que el cromo del teléfono es siempre visible
   * (v2.44), cualquier roce accidental del dedo empezaba a narrar solo —
   * el mismo dolor que v2.41 tapó cuando el cromo se escondía. Para leer
   * a propósito también está el botón del reproductor (btnPdfDesdeAqui).
   * Se ignora si la persona estaba seleccionando texto, para no
   * secuestrar el copiar y pegar. */
  if (el.lectura) {
    el.lectura.addEventListener('dblclick', (ev) => {
      /* Si este toque fue el que pasó de página con un deslizamiento, se
       * queda en eso: no se lee en voz alta desde un párrafo que la
       * persona ni siquiera estaba mirando. */
      if (consumirToqueDeCromo()) return;
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
    pintarPieLectura();
    /* `caracterVisible()` se apoya en `pag.actual`, que aquí ya es la página
     * destino, y su cálculo no depende de dónde vaya la animación: por eso
     * puede anotarse el sitio sin esperar a que el desplazamiento termine. */
    pag.saltando = true;
    clearTimeout(tempoSalto);
    tempoSalto = setTimeout(() => { pag.saltando = false; }, 420);
    if (guardar) {
      pag.ancla = caracterVisible();
      if (api.anotarPagina) api.anotarPagina(pag.ancla);
    }
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
    let alto = Math.floor(col.clientHeight - bordes - visibles.reduce((n,e) => n + e.getBoundingClientRect().height, 0) - huecos);
    const ancho = art.clientWidth;
    if (alto < 80 || ancho < 80) { pag.activo = false; return; }

    /* La página tiene que caber un número ENTERO de renglones. Si sobra medio,
     * la última línea aparece cortada por la mitad y eso delata al instante
     * que no es un libro. Se recorta al múltiplo del interlineado. */
    const renglon = parseFloat(getComputedStyle(art).lineHeight);
    if (Number.isFinite(renglon) && renglon > 4) {
      const enteros = Math.floor(alto / renglon);
      if (enteros >= 3) alto = Math.round(enteros * renglon);
    }

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
    let ultimo = null;
    while (walker.nextNode()) {
      const nodo = walker.currentNode;
      ultimo = nodo;
      if (resto < nodo.length) {
        const rango = document.createRange(); rango.setStart(nodo, resto); rango.setEnd(nodo, resto + 1); return rango;
      }
      resto -= nodo.length;
    }
    /* El punto cae en el hueco entre bloques (separadores que no viven en
     * ningún [data-ini]): se asigna al bloque siguiente y, si no hay, al
     * final de este. Devolver el bloque entero mandaba a su PRIMERA página
     * aunque el punto estuviera páginas después, y la lectura «volvía al
     * principio» al reabrir. */
    const bloques = el.lectura ? [...el.lectura.querySelectorAll('[data-ini]')] : [];
    const sig = bloques[bloques.indexOf(bloque) + 1];
    const rango = document.createRange();
    if (sig) {
      const w2 = document.createTreeWalker(sig, NodeFilter.SHOW_TEXT);
      let primero = null;
      while (w2.nextNode()) { if (w2.currentNode.length > 0) { primero = w2.currentNode; break; } }
      if (primero) { rango.setStart(primero, 0); rango.setEnd(primero, 1); }
      else rango.selectNode(sig);
      return rango;
    }
    if (ultimo && ultimo.length > 0) {
      rango.setStart(ultimo, ultimo.length - 1); rango.setEnd(ultimo, ultimo.length);
      return rango;
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

  }

  /* Girar el teléfono o abrir el teclado cambia el hueco: se vuelve a repartir
   * sin perder el sitio. */
  let tempoMedir = null;
  function programarMedicion(espera = 80) {
    clearTimeout(tempoMedir);
    tempoMedir = setTimeout(() => medirPaginas(), espera);
  }
  window.addEventListener('resize', () => {
    programarMedicion(180);
  });
  if (typeof ResizeObserver !== 'undefined' && el.textoCol) {
    const observar = new ResizeObserver(() => {
      programarMedicion();
    });
    observar.observe(el.textoCol);
    for (const nodo of el.textoCol.children) {
      if (nodo !== el.lectura && !['fixed', 'absolute'].includes(getComputedStyle(nodo).position)) observar.observe(nodo);
    }
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
    if (pag.activo) {
      pag.ancla = Math.max(0, Number(caracter) || 0);
      irAPagina(paginaDe(destino), { suave: false, guardar: false });
      return;
    }
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
  if (el.aparTam) el.aparTam.addEventListener('input', () => {
    cfg.tam = Number(el.aparTam.value) || 19;
    cfg.tamElegido = true;   // a partir de aquí manda la persona
    aplicarApariencia();
  });
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
    const cerrarApariencia = () => {
      if (!el.aparienciaHoja.hidden) api.cerrarHoja?.();
    };
    const abrirApariencia = (origen) => {
      if (!el.aparienciaHoja.hidden) { cerrarApariencia(); return; }
      api.abrirHoja?.('apariencia', origen || el.btnApariencia);
    };
    el.abrirApariencia = abrirApariencia;
    el.cerrarApariencia = cerrarApariencia;
    el.btnApariencia.addEventListener('click', () => abrirApariencia(el.btnApariencia));
  }

  /* ═══════════════════════════════════════════════════════════════════════
     Lectura editorial en el teléfono
     ──────────────────────────────────────────────────────────────────────
     Tres cosas que el CSS no puede decidir solo:
       · traer la tipografía SOLO cuando se abre un libro (son 220 KB que no
         le sirven a quien viene a dictar);
       · declarar el idioma del libro, porque de él depende cómo se parten
         las palabras;
       · decidir si se justifica, que solo tiene sentido si se puede partir.
     ═══════════════════════════════════════════════════════════════════════ */

  /* Idiomas en los que los navegadores traen patrones de partición. Con otro
   * idioma se lee alineado a la izquierda: un justificado sin partir abre
   * ríos de blanco y se lee peor que sin justificar. */
  const IDIOMAS_CON_GUIONES = new Set(['es', 'en', 'pt', 'fr', 'de', 'it', 'nl', 'ca', 'gl']);
  const esTelefono = () => window.matchMedia('(max-width:640px)').matches;

  let fuentePedida = false;
  function traerTipografiaLectura() {
    if (fuentePedida || typeof document === 'undefined') return;
    fuentePedida = true;
    try {
      const enlace = document.createElement('link');
      enlace.rel = 'stylesheet';
      enlace.href = new URL('../vendor/literata/literata.css', import.meta.url).href;
      /* Si no llega, el CSS ya declara Georgia detrás: se lee igual, con otra
       * letra. No se bloquea la lectura por una fuente. */
      enlace.onerror = () => console.warn('[lectura] la tipografía no llegó; se usa la serif del sistema');
      document.head.appendChild(enlace);
    } catch (_) { /* sin DOM (pruebas en Node) */ }
  }

  /** Idioma y justificado del artículo, según el libro abierto. */
  function ajustarComposicion() {
    const art = el.lectura;
    if (!art) return;
    const idioma = String(estado.idioma || 'es').slice(0, 2).toLowerCase();
    art.setAttribute('lang', idioma);
    const puedePartir = IDIOMAS_CON_GUIONES.has(idioma);
    art.dataset.justificado = (esTelefono() && puedePartir) ? 'si' : 'no';
  }

  /* Alto real de la cabecera: la barra de modo se coloca justo debajo, y
   * ambas flotan. Se mide del DOM para que no haya dos números que cuadrar. */
  function medirCabecera() {
    const cab = el.resultArea?.querySelector('.pdf-doc-top');
    if (!cab) return;
    const alto = Math.round(cab.getBoundingClientRect().height);
    if (alto > 0) document.body.style.setProperty('--pdf-cab-alto', alto + 'px');
  }

  /** El pie: cuánto queda y por dónde vas. Se refresca al cambiar de página. */
  function pintarPieLectura() {
    const pie = document.getElementById('pdfPieLectura');
    if (!pie) return;
    const restante = document.getElementById('pdfPieRestante');
    const porc = document.getElementById('pdfPiePorcentaje');
    if (restante) {
      const min = typeof api.minutosRestantes === 'function' ? api.minutosRestantes() : '';
      restante.textContent = min ? `restantes ${min} en el capítulo` : '';
    }
    if (porc) {
      const total = Math.max(1, pag.total || 1);
      const hecho = Math.round(((pag.actual + 1) / total) * 100);
      porc.textContent = `${Math.min(100, Math.max(0, hecho))} %`;
    }
  }
  api.pintarPieLectura = pintarPieLectura;

  /* ═══════════════════════════════════════════════════════════════════════
     «Unir palabras»: recomponer lo que el PDF partió al saltar de renglón
     ──────────────────────────────────────────────────────────────────────
     Un PDF no guarda palabras: guarda trozos con su posición. Cuando una
     palabra cae en el salto de renglón, el motor ve «sorprend» y «entes» y no
     puede saber si van juntas. Hasta ahora se rendía y dejaba el corte
     «pendiente» (1.068 en un libro de 431 páginas), porque el léxico que
     tenía eran 576 palabras.

     Con las listas de `js/vendor/lexico/` la mayoría se decide sola. La regla
     no cambia y es la que evita corromper el libro: se une SOLO si la forma
     pegada es palabra Y al menos una de las mitades no lo es. Por eso
     «de»+«la» no se toca nunca.

     Se trabaja sobre los cortes de la PÁGINA que se está leyendo (dos o tres),
     no sobre los mil del libro: es instantáneo y no interrumpe.
     ═══════════════════════════════════════════════════════════════════════ */
  /* Cuánto unir: «normal» (diccionario + libro) o «documento» (solo lo que el
   * propio libro demuestra). Se recuerda entre sesiones como el resto de
   * preferencias de lectura. */
  function modoUnir() {
    try { return localStorage.getItem('jg_pdf_unir') === 'documento' ? 'documento' : 'normal'; }
    catch (_) { return 'normal'; }
  }
  if (el.unirModo) {
    el.unirModo.value = modoUnir();
    el.unirModo.addEventListener('change', () => {
      try { localStorage.setItem('jg_pdf_unir', el.unirModo.value === 'documento' ? 'documento' : 'normal'); }
      catch (_) { /* sin almacenamiento: vale para esta sesión */ }
      pintarUnir(contarUnibles());
    });
  }

  let unidosUltimaVez = [];      // para Deshacer
  let tempoAviso = null;
  let uniendo = false;
  /* Lo que la persona deshizo NO se vuelve a unir sola. Sin esto, el pase
   * automático de la página volvía a pegarlo en el mismo instante y
   * «Deshacer» no servía para nada. */
  const rechazados = new Set();
  /* Los que se deshicieron y el botón vuelve a considerar en esa pulsación. */
  let rechazadosPrevios = new Set();

  /* Un corte NO lleva posición de carácter (mira `crearLimites`): solo conoce
   * los dos átomos que separa. Así que no se puede acotar «los de esta
   * página», y fingirlo era peor que no hacerlo: el filtro devolvía siempre
   * todos y cada salto de página reprocesaba el capítulo entero y lo volvía a
   * pintar, moviendo la lectura.
   *
   * Se hace UNA pasada por capítulo, al abrirlo. El efecto para quien lee es
   * el mismo —el texto ya está recompuesto cuando llega— y pasar de página
   * deja de costar nada. */
  const capitulosRepasados = new Set();
  function pendientesDelCapitulo() {
    return (estado.limites || []).filter((l) => l && l.decision === 'pending');
  }

  /* Blancos que solo son el fin de renglón («que to» / «ma»): el extractor
   * viejo los guardó como 'space' y el botón no los veía. Se reconsideran con
   * la misma regla; lo deshecho por la persona no resucita solo. */
  function espaciosDeRenglon() {
    return (estado.limites || []).filter((l) => l && l.decision === 'space'
      && (l.kind === 'line-wrap' || l.kind === 'page-break' || l.kind === 'column-break')
      && l.originalSeparator === 'space'
      && !rechazados.has(l.id));
  }

  /** Pinta el botón: encendido y con cuenta cuando hay algo que unir. */
  function pintarUnir(cuantos) {
    if (!el.btnUnirPalabras) return;
    const n = Number(cuantos) || 0;
    el.btnUnirPalabras.dataset.hay = n > 0 ? 'si' : 'no';
    if (el.unirCuenta) el.unirCuenta.textContent = n > 0 ? `(${n})` : '';
    el.btnUnirPalabras.disabled = uniendo;
  }

  function mostrarAviso(cuantas) {
    if (!el.unirAviso) return;
    clearTimeout(tempoAviso);
    if (el.unirAvisoTexto) {
      el.unirAvisoTexto.textContent = cuantas === 1
        ? '1 palabra unida' : `${cuantas} palabras unidas`;
    }
    el.unirAviso.hidden = false;
    /* Se va solo: es un aviso, no una tarea pendiente. */
    tempoAviso = setTimeout(() => { el.unirAviso.hidden = true; }, 7000);
  }

  /**
   * Une lo que se pueda decidir con evidencia. `alcance`:
   *   'pagina'   — los cortes de la página abierta (automático)
   *   'capitulo' — todos los del capítulo (al pulsar el botón)
   * Devuelve cuántas unió.
   */
  async function unirPalabras({ alcance = 'pagina', avisar = true } = {}) {
    if (uniendo) return 0;
    /* Pulsar el botón es una petición explícita, así que reconsidera también
     * los cortes que se deshicieron antes (quedaron como «space» del usuario).
     * El pase automático, en cambio, respeta esa decisión y no los toca. */
    const base = alcance === 'capitulo'
      ? (estado.limites || []).filter((l) => l && (l.decision === 'pending' || rechazadosPrevios.has(l.id)))
      : pendientesDelCapitulo();
    /* En manual los rechazados ya se vaciaron a rechazadosPrevios (petición
     * explícita); en automático espaciosDeRenglon respeta los rechazados. */
    const extras = espaciosDeRenglon();
    const candidatos = [...base, ...extras.filter((l) => !base.includes(l))];
    /* Petición explícita sin nada que hacer: decirlo. El silencio total se
     * lee como «el botón no sirve». El pase automático sigue callado. */
    const explicito = avisar && alcance === 'capitulo';
    if (!candidatos.length) {
      pintarUnir(0);
      if (explicito) api.avisar?.('No hay palabras partidas en este capítulo.', 'info');
      return 0;
    }

    uniendo = true;
    pintarUnir(0);
    try {
      const { cargarLexico, decidirPorLexico } = await import('./lexico.js');
      /* En modo prudente ni se descargan: solo vale lo que el libro demuestra. */
      if (modoUnir() !== 'documento') {
        try {
          await cargarLexico(estado.idioma === 'en' ? 'en' : 'es');
          /* Un libro en español puede citar en inglés y al revés: con las dos
           * listas cargadas se decide mejor y no cuesta una segunda espera. */
          cargarLexico(estado.idioma === 'en' ? 'es' : 'en');
        } catch (_) {
          if (explicito) api.avisar?.('No se pudo cargar el diccionario. Revisa tu conexión e inténtalo de nuevo.', 'warn');
          return 0;
        }
      }

      const aUnir = [];
      for (const lim of candidatos) {
        if (rechazados.has(lim.id)) continue;
        const veredicto = decidirPorLexico(lim.leftFragment, lim.rightFragment, {
          continuidadGeometrica: true,
          vocabularioDocumento: estado.vocabulario,
          soloDocumento: modoUnir() === 'documento',
        }, estado.idioma || 'es');
        if (veredicto === 'join') aUnir.push(lim);
      }
      if (!aUnir.length) {
        pintarUnir(0);
        if (explicito) api.avisar?.('Se revisó el capítulo: no hay uniones seguras.', 'info');
        return 0;
      }

      /* Se guarda el IDENTIFICADOR, no el objeto: `reconstruirTrasDecision`
       * reemplaza el arreglo de cortes por otro nuevo, y guardar la referencia
       * dejaba a «Deshacer» mutando un objeto que ya nadie miraba. */
      const antes = aUnir.map((l) => ({ id: l.id, copia: { ...l } }));
      for (const l of aUnir) aplicarDecisionUsuario(l, 'join');
      try {
        await api.reconstruirTrasDecision?.();
      } catch (error) {
        /* Se revierte sobre los cortes VIVOS (por id): la reconstrucción
         * reemplaza el arreglo y la referencia vieja ya no sirve. Destructurar
         * un campo que no existe aquí lanzaba otro error y tapaba el mensaje:
         * el botón moría en silencio total. */
        const vivos = new Map((estado.limites || []).map((l) => [l?.id, l]));
        for (const { id, copia } of antes) {
          const vivo = vivos.get(id);
          if (vivo) Object.assign(vivo, copia);
        }
        api.avisar?.(error?.message || 'No se pudieron unir las palabras.', 'warn');
        return 0;
      }
      unidosUltimaVez = antes;
      renderLectura({ conservar: true });
      if (avisar) mostrarAviso(aUnir.length);
      return aUnir.length;
    } finally {
      uniendo = false;
      pintarUnir(contarUnibles());
    }
  }

  /* Cuántos de los pendientes de esta página tienen ya evidencia suficiente.
   * Solo sirve para encender el botón; no cambia nada. */
  function contarUnibles() {
    try {
      /* `decidirPorLexico` viaja en el módulo cargado; si aún no lo está,
       * no se enciende nada todavía y se pintará tras el primer intento. */
      const mod = moduloLexico;
      if (!mod) return 0;
      return [...pendientesDelCapitulo(), ...espaciosDeRenglon()].filter((l) => mod.decidirPorLexico(
        l.leftFragment, l.rightFragment,
        { continuidadGeometrica: true, vocabularioDocumento: estado.vocabulario,
          soloDocumento: modoUnir() === 'documento' },
        estado.idioma || 'es',
      ) === 'join').length;
    } catch (_) { return 0; }
  }
  let moduloLexico = null;
  import('./lexico.js').then((m) => { moduloLexico = m; }).catch(() => {});

  async function deshacerUnion() {
    if (!unidosUltimaVez.length) return;
    const copia = unidosUltimaVez;
    unidosUltimaVez = [];
    const porId = new Map((estado.limites || []).map((l) => [l.id, l]));
    for (const { id, copia: previa } of copia) {
      const lim = porId.get(id);
      if (!lim) continue;
      /* Se marca como decisión de la PERSONA, no como «pendiente»: la
       * reconstrucción vuelve a resolver los pendientes con el diccionario y
       * los habría unido otra vez en el mismo instante. */
      Object.assign(lim, previa, { decision: 'space', source: 'user' });
      rechazados.add(id);
    }
    try {
      await api.reconstruirTrasDecision?.();
    } catch (error) {
      api.avisar?.(error.message || 'No se pudo deshacer.', 'warn');
      return;
    }
    renderLectura({ conservar: true });
    if (el.unirAviso) el.unirAviso.hidden = true;
    clearTimeout(tempoAviso);
    pintarUnir(contarUnibles());
  }

  if (el.btnUnirPalabras) {
    /* Pulsarlo es una petición explícita: vuelve a considerar incluso lo que
     * se deshizo antes. El automático, en cambio, respeta esa decisión. */
    el.btnUnirPalabras.addEventListener('click', () => {
      rechazadosPrevios = new Set(rechazados);
      rechazados.clear();
      unirPalabras({ alcance: 'capitulo' }).finally(() => { rechazadosPrevios = new Set(); });
    });
  }
  if (el.btnUnirDeshacer) el.btnUnirDeshacer.addEventListener('click', deshacerUnion);

  /* Automático: al abrir el libro y al pasar de página. Si no hay nada que
   * unir no ocurre nada y la lectura sigue igual, que es lo pedido. */
  /* «trabajando» mientras la pasada del capítulo esté en curso, «listo» cuando
   * termine (aunque no haya unido nada). No cambia nada visible: existe para
   * poder ESPERAR a que acabe. Sin esto, una prueba contra el dominio real
   * salía antes de que el diccionario llegara por la red y daba por buena una
   * pantalla que aún iba a cambiar. */
  function marcarUnir(estadoUnir) {
    try { document.body.dataset.pdfUnir = estadoUnir; } catch (_) { /* sin DOM */ }
  }

  let tempoUnir = null;
  function unirAlLlegar() {
    /* Una vez por capítulo. Repetirlo en cada salto de página no arreglaba
     * nada nuevo (los cortes son del capítulo, no de la página) y sí volvía a
     * pintar el texto mientras alguien lo estaba leyendo. */
    const cual = `${estado.id || ''}#${estado.parteActual}`;
    if (capitulosRepasados.has(cual)) { marcarUnir('listo'); return; }
    capitulosRepasados.add(cual);
    marcarUnir('trabajando');
    clearTimeout(tempoUnir);
    tempoUnir = setTimeout(() => {
      unirPalabras({ alcance: 'pagina' }).finally(() => marcarUnir('listo'));
    }, 250);
  }
  api.unirPalabrasAuto = unirAlLlegar;

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
    ['btnPdfBmIndice', () => { abrirDock(false); api.abrirHoja?.('indice', $$('btnPdfBmIndice')); }],
    ['btnPdfBmOpciones', () => { abrirDock(false); api.abrirHoja?.('opciones', $$('btnPdfBmOpciones')); }],
    /* La entrada de búsqueda del teléfono vive DENTRO de «Opciones», así que
       al usarla hay que cerrar esa hoja y desplegar el mismo buscador de la
       cabecera: no hay dos buscadores, hay dos puertas al mismo. */
    ['btnPdfBuscarMovil', () => {
      if (el.masMenu && el.masMenu.open) el.btnMas?.click();
      if (el.buscarFila && el.buscarFila.hidden) el.buscarToggle?.click();
      abrirDock('buscar');
      const campo = document.getElementById('pdfSearch');
      if (campo) campo.focus({ preventScroll: true });
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
  /* Apartar el cromo estuvo desactivado un tiempo, y con razón: cuando los
   * controles vivían EN EL FLUJO había que elegir entre dejar una franja vacía
   * (si se conservaba su hueco) o volver a paginar el capítulo (si no). Las dos
   * opciones eran malas.
   *
   * Ese dilema ya no existe: desde el diseño editorial del teléfono el cromo
   * FLOTA por encima del texto (`position:fixed`), así que apartarlo no deja
   * hueco ninguno y tampoco cambia el alto del texto ni una décima. Por eso
   * vuelve, que es lo que hace que la página se lea como una página. */
  function inmersivo(activo) {
    if (!enTelefono()) { document.body.classList.remove('jg-inmersivo'); return; }
    document.body.classList.toggle('jg-inmersivo', !!activo);
  }
  /* Pasar de página es volver a leer: el cromo se aparta.
   *
   * Se espera a que termine el desplazamiento suave. Apartarlo a mitad no
   * remaqueta nada (flota por encima), pero el gesto se ve más limpio si
   * ocurre con la página ya asentada. */
  function apartarCromo() {
    clearTimeout(tempoInmersivo);
    if (!enTelefono()) return;
    const reintentar = () => {
      if (pag.saltando) { tempoInmersivo = setTimeout(reintentar, 120); return; }
      inmersivo(true);
    };
    tempoInmersivo = setTimeout(reintentar, 380);
  }

  /* Mientras el cromo está a la vista tapa las primeras y últimas líneas
   * (49 px arriba y 79 abajo, medidos). Es el trato del modelo editorial: a
   * cambio, leyendo se ve la página entera. Por eso lo trae un toque y lo
   * quita el siguiente paso de página, sin temporizadores de por medio. */
  function devolverCromo() {
    clearTimeout(tempoInmersivo);
    if (document.body.classList.contains('jg-inmersivo')) inmersivo(false);
  }

  /* Cuándo se aparta el cromo, y por qué NO hay temporizador.
   *
   * La primera versión lo escondía tras 3,2 s sin tocar nada. Mala idea: se
   * iba en mitad de un ajuste y volvía impredecible cualquier prueba. El
   * modelo que funciona es el de un lector de libros:
   *
   *   · al abrir el capítulo, la pantalla queda limpia;
   *   · un toque en el texto trae los controles (y ese toque NO lee);
   *   · pasar de página los vuelve a apartar, porque estás leyendo otra vez.
   *
   * Sin relojes: lo decide siempre un gesto de la persona. */
  let limpiadaInicial = '';
  function limpiarAlAbrir() {
    if (!enTelefono()) return;
    const cual = `${estado.id || ''}#${estado.parteActual}`;
    if (limpiadaInicial === cual) return;
    limpiadaInicial = cual;
    inmersivo(true);
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
  let toqueDespertoCromo = false;
  let tempoConsumirToque = null;
  function marcarToqueConsumido() {
    toqueDespertoCromo = true;
    clearTimeout(tempoConsumirToque);
    /* Safari/Chrome no siempre generan `click` después de un swipe. La marca
       no puede quedarse viva y robar el siguiente toque real. */
    tempoConsumirToque = setTimeout(() => { toqueDespertoCromo = false; }, 500);
  }

  /* ── Pasar página con el dedo ──────────────────────────────────────
     El área de lectura es `overflow-x:hidden`: las páginas se mueven con
     `scrollTo`, no con desplazamiento nativo. En un teléfono real eso
     significa que **el dedo no hace nada** — ni desliza ni desplaza, porque
     tampoco hay scroll vertical (es un lector paginado). Se siente bloqueado,
     y es lo primero que intenta cualquiera.

     Así que el deslizamiento se atiende a mano. Con Pointer Events, que
     cubren dedo, lápiz y ratón por igual. */
  const DESLIZ_MINIMO = () => Math.max(28, Math.min(56, (el.lectura?.clientWidth || 390) * .10));
  const DESLIZ_VERTICAL = 1.4;  // la diagonal moderada también pasa página
  /* Cuándo se hizo la última selección dentro de la lectura. Una selección
   * VIEJA no puede bloquear los gestos para siempre: solo se respeta la que
   * se está haciendo ahora mismo (menos de un segundo). */
  let ultimaSeleccion = 0;
  document.addEventListener('selectionchange', () => {
    const sel = document.getSelection();
    if (sel && String(sel).trim().length > 1 && el.lectura?.contains(sel.anchorNode)) {
      ultimaSeleccion = Date.now();
    }
  });
  let gesto = null;
  if (el.lectura) {
    el.lectura.addEventListener('pointerdown', (ev) => {
      if (!pag.activo || ev.pointerType === 'mouse') { gesto = null; return; }
      gesto = { x: ev.clientX, y: ev.clientY, id: ev.pointerId };
      try { el.lectura.setPointerCapture(ev.pointerId); } catch (_) {}
    }, { passive: true });
    el.lectura.addEventListener('pointerup', (ev) => {
      if (!gesto || ev.pointerId !== gesto.id) return;
      const dx = ev.clientX - gesto.x;
      const dy = ev.clientY - gesto.y;
      gesto = null;
      try { el.lectura.releasePointerCapture(ev.pointerId); } catch (_) {}
      /* En paginado no hay scroll vertical que pelear: si el dedo sube o
       * baja con decisión, también pasa página (subir avanza). */
      const horizontal = Math.abs(dx) >= Math.abs(dy);
      const avance = horizontal ? dx : dy;
      if (Math.abs(horizontal ? dx : dy) < DESLIZ_MINIMO()) return;
      if (horizontal && Math.abs(dy) > Math.abs(dx) * DESLIZ_VERTICAL) return;
      /* Si está seleccionando texto AHORA, el deslizamiento es suyo. */
      const sel = document.getSelection();
      if (sel && String(sel).trim().length > 1 && Date.now() - ultimaSeleccion < 800) return;
      /* Este gesto no es «lee desde aquí»: se consume el click que viene. */
      marcarToqueConsumido();
      irAPagina(pag.actual + (avance < 0 ? 1 : -1));
    }, { passive: true });
    el.lectura.addEventListener('pointercancel', () => { gesto = null; }, { passive: true });
  }

  /* `100dvh` todavía queda desfasado en algunos WebView/iOS al cambiar la
     barra del navegador. La altura de VisualViewport representa el área que
     de verdad puede verse y mantiene el dock pegado al borde útil. */
  let rafViewport = 0;
  function sincronizarViewportMovil() {
    if (!enTelefono()) {
      document.documentElement.style.removeProperty('--jg-viewport-alto');
      return;
    }
    cancelAnimationFrame(rafViewport);
    rafViewport = requestAnimationFrame(() => {
      const alto = Math.round(window.visualViewport?.height || window.innerHeight || 0);
      if (alto > 0) document.documentElement.style.setProperty('--jg-viewport-alto', `${alto}px`);
    });
  }
  sincronizarViewportMovil();
  window.visualViewport?.addEventListener('resize', sincronizarViewportMovil, { passive: true });
  /* La barra del navegador también se ANIMA: durante la animación el alto
   * llega por partes y el desplazamiento visual se mueve. El 'scroll' del
   * viewport avisa de ese movimiento; sin esto, en teléfonos reales quedaba
   * un hueco muerto abajo y la cabecera cortada arriba. */
  window.visualViewport?.addEventListener('scroll', sincronizarViewportMovil, { passive: true });
  window.addEventListener('orientationchange', sincronizarViewportMovil, { passive: true });
  /* En lectura no hay scroll de documento: la jaula es fija. Si el navegador
   * desfasa la ventana (típico al mostrar/esconder su barra), se devuelve a
   * cero en vez de dejar la cabecera cortada. */
  window.addEventListener('scroll', () => {
    if (document.body.classList.contains('jg-leyendo') && window.scrollY > 0) {
      window.scrollTo(0, 0);
    }
  }, { passive: true });

  /* Marca puesta por el gesto que despertó el cromo o pasó de página, para que
   * el `click` que viene detrás no se interprete además como «lee desde aquí». */
  function consumirToqueDeCromo() {
    if (!toqueDespertoCromo) return false;
    clearTimeout(tempoConsumirToque);
    toqueDespertoCromo = false;
    return true;
  }
  if (el.lectura) {
    el.lectura.addEventListener('pointerdown', () => {
      if (document.body.classList.contains('jg-inmersivo')) marcarToqueConsumido();
      devolverCromo();
    }, { capture: true, passive: true });
  }
  document.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape' && document.body.classList.contains('jg-inmersivo')) devolverCromo();
  });

  /* `jg-voz-activa` la mira el CSS para dejar el control de pausa a la vista
   * aunque el resto del cromo se aparte. Se deduce del botón «Escuchar» de la
   * consola, que es quien sabe de verdad si suena algo: así no hay que meter
   * mano en el motor de voz ni mantener dos estados que se desincronizan. */
  (function seguirEstadoDeVoz() {
    const consola = document.querySelector('[data-tts-console="pdf"]');
    const boton = consola && consola.querySelector('[data-tts-action="toggle"]');
    if (!boton) return;
    const pintar = () => {
      const sonando = boton.getAttribute('aria-pressed') === 'true';
      document.body.classList.toggle('jg-voz-activa', sonando);
      const texto = document.getElementById('pdfVozMiniTexto');
      if (texto && sonando) texto.textContent = 'Leyendo…';
    };
    new MutationObserver(pintar).observe(boton, { attributes: true, attributeFilter: ['aria-pressed'] });
    pintar();
  }());

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
      /* Con la posición del corte se puede llevar a la persona al sitio en vez
       * de pedirle que lo busque. Solo si el corte la trae: un libro guardado
       * antes de v2.42 no la tiene, y entonces esto se queda como texto. */
      if (Number.isFinite(lim.charStart)) {
        ctx.classList.add('es-enlace');
        ctx.tabIndex = 0;
        ctx.setAttribute('role', 'button');
        ctx.title = 'Ver este corte en el texto';
        const irAlCorte = () => {
          api.cerrarHoja?.();
          irACaracter(lim.charStart);
        };
        ctx.addEventListener('click', irAlCorte);
        ctx.addEventListener('keydown', (ev) => {
          if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); irAlCorte(); }
        });
      }
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
    pintarCortes();
    api.abrirHoja?.('cortes', document.getElementById('btnPdfHerramientas'));
  });
  if (el.cortesCerrar) el.cortesCerrar.addEventListener('click', () => cerrarCortes());
  function cerrarCortes() {
    if (!el.cortesHoja || el.cortesHoja.hidden) return;
    api.cerrarHoja?.();
  }
  el.cerrarCortes = cerrarCortes;
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
