/* JG Turbo · Vista de libro v2.39 (apartado PDF, encapsulado)
 *
 * Lectura cómoda en móvil, tableta y escritorio: contenido HTML semántico
 * (párrafos, títulos, listas, citas, tablas); el textarea queda reservado
 * para Editar (Guardar/Cancelar). Cambiar tamaño, anchura o tema no modifica
 * palabras, párrafos ni posición guardada: solo presentación.
 */
import { aplicarDecisionUsuario } from './limites.js';
import { sha256Hex } from './huella.js';
import { construirLectura } from './mapaLectura.js';

/* Se reexporta para que las pruebas y quien ya usaba la vista
 * sigan encontrando el constructor del HTML en este módulo. */
export { construirLectura };

function esc(texto) {
  return String(texto ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function leerApariencia() {
  let cfg = { tam: 19, inter: 1.7, ancho: 64, fuente: 'sans', tema: null, modo: 'lectura' };
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
    guardarApariencia(cfg);
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
  }

  function renderLectura() {
    if (!el.lectura) return;
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

  function prefiereMenosMovimiento() {
    try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (_) { return false; }
  }

  /* Lleva la marca a la zona cómoda de lectura (algo por encima del centro,
   * que es donde el ojo la espera) y solo cuando hace falta: si la frase ya se
   * ve, mover la página sería un tirón gratuito. */
  function desplazarA(elemento) {
    if (!elemento || !seguimiento) return;
    const caja = elemento.getBoundingClientRect();
    const alto = window.innerHeight || 800;
    if (caja.top > alto * 0.20 && caja.bottom < alto * 0.80) return;
    elemento.scrollIntoView({ block: 'center', behavior: prefiereMenosMovimiento() ? 'auto' : 'smooth' });
  }

  // Suspender el seguimiento al desplazarse a mano + Volver a la lectura.
  function onScrollManual() {
    if (!seguimiento) return;
    seguimiento = false;
    if (el.volverLectura) el.volverLectura.hidden = false;
  }
  if (el.area) el.area.addEventListener('wheel', onScrollManual, { passive: true });
  if (el.volverLectura) el.volverLectura.addEventListener('click', () => {
    seguimiento = true;
    el.volverLectura.hidden = true;
  });

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
  if (el.temaSepia) el.temaSepia.addEventListener('click', () => fijarTema('sepia'));

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
      prop.textContent = 'Propuesta: unir sin espacio. Si son dos palabras, mantenlas separadas.';
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
        b.addEventListener('click', () => {
          pilaDeshacer.push({ id: lim.id, antes: lim.decision });
          aplicarDecisionUsuario(lim, accion);
          try { api.reconstruirTrasDecision && api.reconstruirTrasDecision(); } catch (_) {}
          pintarCortes();
          renderLectura();
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
    deshacer.addEventListener('click', () => {
      const ultimo = pilaDeshacer.pop();
      const lim = (estado.limites || []).find((l) => l.id === (ultimo && ultimo.id));
      if (lim && ultimo) aplicarDecisionUsuario(lim, ultimo.antes === 'pending' ? 'pending' : ultimo.antes);
      pintarCortes();
      renderLectura();
    });
    el.cortesLista.appendChild(deshacer);
  }
  if (el.btnCortes) el.btnCortes.addEventListener('click', () => {
    if (el.cortesHoja) el.cortesHoja.hidden = false;
    pintarCortes();
  });
  if (el.cortesCerrar) el.cortesCerrar.addEventListener('click', () => { if (el.cortesHoja) el.cortesHoja.hidden = true; });
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
        const buf = await archivo.arrayBuffer();
        const resumen = await crypto.subtle.digest('SHA-256', buf);
        const hex = [...new Uint8Array(resumen)].map((b) => b.toString(16).padStart(2, '0')).join('');
        if (estado.fuenteRevision && hex !== estado.fuenteRevision) {
          try { api.avisar && api.avisar('Ese PDF no corresponde a este documento.', 'warn'); } catch (_) {}
          return;
        }
        try { api.vincularArchivo && (await api.vincularArchivo(archivo)); } catch (_) {}
      } catch (_) {}
      el.vincularInput.value = '';
    });
  }

  // Pausar / reanudar (la recarga recupera el último bloque confirmado).
  if (el.btnPausar) {
    const refrescarPausa = () => { el.btnPausar.hidden = !estado.correccionProgreso?.ejecutando; };
    setInterval(refrescarPausa, 1000);
    el.btnPausar.addEventListener('click', () => api.pausar && api.pausar());
  }

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
    pintarCortes,
    aplicarApariencia,
    fijarModo,
    construirLectura,
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
