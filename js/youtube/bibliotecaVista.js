import {
  agregarEtiqueta, buscarEnTranscripcion, etiquetasConConteo, fechaRelativa,
  filtrarVideos, formatearDuracion, fraccionVista, quitarEtiqueta,
  seguirViendo, sugerenciasDeEtiquetas,
} from './bibliotecaVideos.js';
import { calidadQueCabe, formatearBytes, LIMITE_MEMORIA_BYTES } from './descargaDestino.js';
import { ErrorDestino } from './destinoArchivo.js';

// Su CSS viaja aparte (restricción de arranque ligero): quien no abre la
// pestaña «Videos» no lo paga. Se pide una sola vez, al importar la vista.
if (!document.querySelector('link[data-vid-css]')) {
  const enlace = document.createElement('link');
  enlace.rel = 'stylesheet';
  enlace.dataset.vidCss = '';
  enlace.href = new URL('./biblioteca-videos.css', import.meta.url).href
    + (globalThis.JG_JS_V ? `?v=${globalThis.JG_JS_V}` : '');
  document.head.appendChild(enlace);
}

const $ = (selector, raiz = document) => raiz.querySelector(selector);
const escapar = (valor) => String(valor ?? '').replace(/[&<>"']/g, (c) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[c]));

function mostrarDialogo(dialogo) {
  if (typeof dialogo.showModal === 'function') dialogo.showModal();
  else dialogo.setAttribute('open', '');
}

function cerrarDialogo(dialogo) {
  if (typeof dialogo.close === 'function') dialogo.close();
  else dialogo.removeAttribute('open');
}

function textoFase(progreso) {
  if (!progreso) return 'Preparando el archivo…';
  const hechas = Number(progreso.hechas) || 0;
  const total = Number(progreso.total) || 0;
  const cuenta = total ? ` ${hechas} de ${total}` : '';
  return ({
    traduccion: `Completando traducción…${cuenta}`,
    voz: `Preparando voz…${cuenta}`,
    descarga: 'Descargando el video…',
    mezcla: 'Uniendo video y voz…',
    escritura: 'Guardando el archivo…',
  }[progreso.fase] || 'Preparando el archivo…');
}

export function montarBibliotecaVideos(raiz, deps) {
  const ui = Object.fromEntries([
    'vidConteo', 'vidPlegar', 'vidCuerpo', 'vidVacio', 'vidSeguir', 'vidBuscar', 'vidEnTexto',
    'vidFiltros', 'vidTemas', 'vidOrden', 'vidLista', 'vidSinResultados', 'vidLimpiar', 'vidAviso',
    'vidDeshacer', 'vidTemasDialogo', 'vidTemasTitulo', 'vidTemasActuales', 'vidTemaNuevo', 'vidTemasSugerencias',
    'vidTemasMensaje', 'vidTemasListo', 'vidDescargasDialogo', 'vidDescargasAyuda', 'vidCalidad',
    'vidDescargaEstado', 'vidDescargar', 'vidDescargaCancelar', 'vidDescargasCerrar',
  ].map((id) => [id, document.getElementById(id)]));
  let videos = [];
  let conVoz = new Set();
  let coincidencias = new Map();
  let filtro = { texto: '', plataforma: 'todas', vista: 'todos', etiqueta: '', orden: 'recientes' };
  let menuAbierto = null;
  let videoTemas = null;
  let videoDescarga = null;
  let opcionesDescarga = null;
  let controladorDescarga = null;
  let deshecho = null;
  let temporizadorDeshacer = null;
  let colaTemas = Promise.resolve();

  const avisar = (texto) => { ui.vidAviso.textContent = texto || ''; };
  const encontrar = (clave) => videos.find((video) => video.clave === clave);

  function plegar(cerrado = true) {
    ui.vidCuerpo.hidden = Boolean(cerrado);
    ui.vidPlegar.setAttribute('aria-expanded', String(!cerrado));
    $('span', ui.vidPlegar).textContent = cerrado ? 'Mostrar' : 'Plegar';
  }

  function cerrarMenu({ devolverFoco = false } = {}) {
    if (!menuAbierto) return;
    const boton = $('.vid-menu-btn', menuAbierto);
    $('.vid-menu', menuAbierto)?.setAttribute('hidden', '');
    boton?.setAttribute('aria-expanded', 'false');
    menuAbierto = null;
    if (devolverFoco) boton?.focus();
  }

  function progresoHtml(video) {
    const porcentaje = Math.round(fraccionVista(video.posicionS, video.duracionS) * 100);
    return `<div class="vid-progreso" aria-label="Visto ${porcentaje} %"><span style="width:${porcentaje}%"></span></div>`;
  }

  function portadaHtml(video) {
    const inicial = escapar((video.titulo || 'V').trim().charAt(0).toUpperCase());
    return `<span class="vid-portada"><span class="vid-portada-respaldo" aria-hidden="true">${inicial}</span>${video.portada ? `<img src="${escapar(video.portada)}" alt="" loading="lazy">` : ''}<span class="vid-duracion">${formatearDuracion(video.duracionS)}</span></span>`;
  }

  function tarjetaHtml(video) {
    const coincidencia = coincidencias.get(video.clave);
    const etiquetas = (video.etiquetas || []).map((etiqueta) => `<span>${escapar(etiqueta)}</span>`).join('');
    return `<li class="vid-tarjeta" data-clave="${escapar(video.clave)}">
      <button class="vid-abrir" type="button" aria-label="Abrir ${escapar(video.titulo)}">
        ${portadaHtml(video)}
        <span class="vid-tarjeta-cuerpo">
          <span class="vid-plataforma">${video.plataforma === 'x' ? 'X' : 'YouTube'}</span>
          <strong>${escapar(video.titulo)}</strong>
          <span class="vid-meta">${escapar(video.autor || fechaRelativa(video.abierto || video.creado))}</span>
          ${progresoHtml(video)}
          ${etiquetas ? `<span class="vid-etiquetas">${etiquetas}</span>` : ''}
          ${conVoz.has(video.clave) ? '<span class="vid-listo" data-listo>Listo al instante</span>' : ''}
        </span>
      </button>
      ${video.favorito ? '<span class="vid-favorito" aria-label="Favorito">Favorito</span>' : ''}
      <button class="vid-menu-btn" type="button" aria-label="Opciones de ${escapar(video.titulo)}" aria-haspopup="menu" aria-expanded="false"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="5" r="2" fill="currentColor"/><circle cx="12" cy="12" r="2" fill="currentColor"/><circle cx="12" cy="19" r="2" fill="currentColor"/></svg></button>
      <div class="vid-menu" role="menu" hidden>
        <button type="button" role="menuitem" data-accion="temas">Editar temas</button>
        <button type="button" role="menuitem" data-accion="favorito">${video.favorito ? 'Quitar de favoritos' : 'Marcar como favorito'}</button>
        <button type="button" role="menuitem" data-accion="descargar">Descargar</button>
        <button type="button" role="menuitem" data-accion="copiar">Copiar enlace</button>
        <button type="button" role="menuitem" data-accion="origen">Abrir en ${video.plataforma === 'x' ? 'X' : 'YouTube'}</button>
        <button type="button" role="menuitem" data-accion="quitar">Quitar de la biblioteca</button>
      </div>
      ${coincidencia ? `<div class="vid-coincidencia"><p>${escapar(coincidencia.fragmento)}</p><button type="button" data-accion="abrir-aqui" data-segundo="${coincidencia.segundo}">Abrir aquí · ${formatearDuracion(coincidencia.segundo)}</button></div>` : ''}
    </li>`;
  }

  function pintarFiltros() {
    ui.vidFiltros.querySelectorAll('[data-plataforma]').forEach((boton) => boton.setAttribute('aria-pressed', String(filtro.plataforma === boton.dataset.plataforma)));
    ui.vidFiltros.querySelectorAll('[data-vista]').forEach((boton) => boton.setAttribute('aria-pressed', String(filtro.vista === boton.dataset.vista)));
    ui.vidTemas.innerHTML = etiquetasConConteo(videos).map(({ etiqueta, cantidad }) => `<button type="button" data-etiqueta="${escapar(etiqueta)}" aria-pressed="${filtro.etiqueta === etiqueta}">${escapar(etiqueta)} <span>${cantidad}</span></button>`).join('');
  }

  function pintarSeguir() {
    const video = seguirViendo(videos);
    ui.vidSeguir.hidden = !video;
    if (!video) return;
    ui.vidSeguir.dataset.clave = video.clave;
    const avance = video.duracionS
      ? `Vas en ${formatearDuracion(video.posicionS)} de ${formatearDuracion(video.duracionS)}`
      : `Vas en ${formatearDuracion(video.posicionS)}`;
    ui.vidSeguir.innerHTML = `${portadaHtml(video)}<div><strong>${escapar(video.titulo)}</strong><span class="vid-avance">${avance}</span>${progresoHtml(video)}<button type="button" data-accion="seguir">Continuar</button></div>`;
  }

  function pintar() {
    const lista = filtrarVideos(videos, { ...filtro, coincidenEnTexto: coincidencias });
    ui.vidConteo.textContent = `${videos.length} ${videos.length === 1 ? 'video' : 'videos'}`;
    ui.vidVacio.hidden = videos.length !== 0;
    pintarSeguir();
    pintarFiltros();
    ui.vidLista.innerHTML = lista.map(tarjetaHtml).join('');
    ui.vidSinResultados.hidden = videos.length === 0 || lista.length !== 0;
    raiz.querySelectorAll('img').forEach((img) => {
      const ocultarRota = () => { img.hidden = true; };
      img.addEventListener('error', ocultarRota, { once: true });
      if (img.complete && !img.naturalWidth) ocultarRota();
    });
  }

  async function buscarTexto() {
    coincidencias = new Map();
    if (ui.vidEnTexto.checked && filtro.texto.trim()) {
      for (const registro of await deps.listarDoblajes()) {
        const coincidencia = buscarEnTranscripcion(registro, filtro.texto);
        if (coincidencia) coincidencias.set(registro.videoId, coincidencia);
      }
    }
    pintar();
  }

  async function refrescar() {
    raiz.dataset.estado = 'cargando';
    try {
      const [lista, voces] = await Promise.all([deps.listarVideos(), deps.videosConVoz()]);
      videos = lista || [];
      conVoz = voces instanceof Set ? voces : new Set(voces || []);
      await buscarTexto();
      raiz.dataset.estado = 'listo';
    } catch (error) {
      console.error('[jg-biblioteca-vista]', error);
      raiz.dataset.estado = 'error';
      avisar('No pudimos cargar la biblioteca. Recarga la página para intentarlo de nuevo.');
    }
  }

  function abrirVideo(video, segundo = video?.posicionS || 0) {
    const resultado = deps.abrir(video, { segundo });
    if (resultado?.abierto) plegar(true);
    else avisar(resultado?.motivo || 'No pudimos abrir este video.');
  }

  function pintarEditorTemas() {
    const actuales = videoTemas?.etiquetas || [];
    ui.vidTemasActuales.innerHTML = actuales.length
      ? actuales.map((etiqueta) => `<button type="button" data-quitar="${escapar(etiqueta)}" aria-label="Quitar ${escapar(etiqueta)}">${escapar(etiqueta)} ×</button>`).join('')
      : '<span>Aún no tiene temas.</span>';
    ui.vidTemasSugerencias.innerHTML = sugerenciasDeEtiquetas(videos, actuales, ui.vidTemaNuevo.value)
      .map((etiqueta) => `<button type="button" data-sugerencia="${escapar(etiqueta)}">${escapar(etiqueta)}</button>`).join('');
  }

  function abrirTemas(video) {
    videoTemas = video;
    ui.vidTemasTitulo.textContent = `Temas de ${video.titulo}`;
    ui.vidTemaNuevo.value = '';
    ui.vidTemasMensaje.textContent = '';
    pintarEditorTemas();
    mostrarDialogo(ui.vidTemasDialogo);
    ui.vidTemaNuevo.focus();
  }

  function guardarTemas(etiquetas) {
    colaTemas = colaTemas.then(async () => {
      await deps.actualizarVideo(videoTemas.clave, { etiquetas });
      videoTemas.etiquetas = etiquetas;
      const indice = videos.findIndex((v) => v.clave === videoTemas.clave);
      if (indice >= 0) videos[indice] = { ...videos[indice], etiquetas };
      pintarEditorTemas();
      pintar();
    }).catch((error) => {
      console.error('[jg-biblioteca-temas]', error);
      ui.vidTemasMensaje.textContent = 'No pudimos guardar el tema.';
    });
    return colaTemas;
  }

  function agregarTema(texto) {
    const resultado = agregarEtiqueta(videoTemas?.etiquetas, texto);
    ui.vidTemasMensaje.textContent = ({ vacia: 'Escribe un tema.', repetida: 'Ese tema ya está.', tope: 'Máximo 10 temas.' }[resultado.motivo] || '');
    if (!resultado.motivo) {
      ui.vidTemaNuevo.value = '';
      guardarTemas(resultado.etiquetas);
    }
  }

  function pintarTiposDescarga(video, listo = false) {
    ui.vidDescargasDialogo.querySelectorAll('[data-tipo]').forEach((label) => {
      const tipo = $('input', label).value;
      label.hidden = tipo !== 'mp3' && (video.plataforma !== 'x' || !listo);
    });
    ui.vidDescargasDialogo.querySelector('input[value="mp3"]').checked = true;
  }

  async function abrirDescargas(video) {
    videoDescarga = video;
    opcionesDescarga = null;
    pintarTiposDescarga(video);
    ui.vidCalidad.innerHTML = '';
    ui.vidCalidad.closest('label').hidden = video.plataforma !== 'x';
    ui.vidDescargaEstado.textContent = 'Calculando tamaño…';
    ui.vidDescargar.disabled = true;
    ui.vidDescargaCancelar.hidden = true;
    mostrarDialogo(ui.vidDescargasDialogo);
    try {
      opcionesDescarga = await deps.opcionesDescarga(video);
      ui.vidCalidad.innerHTML = (opcionesDescarga.calidades || []).map((opcion, indice) => `<option value="${indice}">${opcion.etiqueta} · ${formatearBytes(opcion.bytes)}</option>`).join('');
      pintarTiposDescarga(video, true);
      if (opcionesDescarga.esMovil && opcionesDescarga.calidades?.length) {
        const elegida = calidadQueCabe(opcionesDescarga.calidades, LIMITE_MEMORIA_BYTES.movil);
        ui.vidCalidad.value = String(opcionesDescarga.calidades.indexOf(elegida));
      }
      ui.vidDescargaEstado.textContent = video.plataforma === 'x' ? 'Elige el archivo y la calidad.' : `Audio estimado: ${formatearBytes(opcionesDescarga.mp3?.bytes)}`;
      ui.vidDescargar.disabled = false;
    } catch (error) {
      console.error('[jg-biblioteca-opciones]', error);
      ui.vidDescargaEstado.textContent = 'No pudimos calcular las opciones de descarga.';
    }
  }

  function tipoDescarga() {
    return ui.vidDescargasDialogo.querySelector('input[name="vidTipo"]:checked')?.value || 'mp3';
  }

  async function descargar() {
    if (!videoDescarga || !opcionesDescarga) return;
    const tipo = tipoDescarga();
    const calidad = opcionesDescarga.calidades?.[Number(ui.vidCalidad.value)] || null;
    controladorDescarga = new AbortController();
    ui.vidDescargar.disabled = true;
    ui.vidDescargaCancelar.hidden = false;
    ui.vidDescargaEstado.textContent = 'Preparando el archivo…';
    try {
      const promesa = deps.descargar(videoDescarga, tipo, {
        calidad, signal: controladorDescarga.signal,
        onProgreso: (progreso) => { ui.vidDescargaEstado.textContent = textoFase(progreso); },
      });
      const resultado = await promesa;
      ui.vidDescargaEstado.textContent = resultado?.cancelado ? 'Descarga cancelada.' : 'Archivo guardado.';
    } catch (error) {
      if (error?.name === 'AbortError') ui.vidDescargaEstado.textContent = 'Descarga cancelada.';
      else if (error instanceof ErrorDestino && error.codigo === 'grande') ui.vidDescargaEstado.textContent = `El archivo supera ${formatearBytes(error.limite)}. Elige una calidad menor.`;
      else {
        console.error('[jg-biblioteca-descarga]', error);
        ui.vidDescargaEstado.textContent = error?.message || 'No pudimos crear el archivo.';
      }
    } finally {
      controladorDescarga = null;
      ui.vidDescargar.disabled = false;
      ui.vidDescargaCancelar.hidden = true;
    }
  }

  // FORM del brief: al quitar, la tarjeta se contrae antes de desaparecer
  // (sin animación si la persona pidió movimiento reducido).
  function contraerTarjeta(clave) {
    return new Promise((resolver) => {
      const tarjeta = ui.vidLista.querySelector(`.vid-tarjeta[data-clave="${CSS.escape(clave)}"]`);
      if (!tarjeta || matchMedia('(prefers-reduced-motion: reduce)').matches) return resolver();
      tarjeta.style.height = `${tarjeta.offsetHeight}px`;
      tarjeta.style.overflow = 'hidden';
      tarjeta.getBoundingClientRect();
      tarjeta.style.transition = 'height .22s ease,opacity .22s ease,border-width .22s ease';
      tarjeta.style.height = '0';
      tarjeta.style.opacity = '0';
      tarjeta.style.borderWidth = '0';
      setTimeout(resolver, 240);
    });
  }

  async function accionMenu(video, accion) {
    cerrarMenu();
    if (accion === 'temas') abrirTemas(video);
    else if (accion === 'favorito') {
      await deps.actualizarVideo(video.clave, { favorito: !video.favorito });
      await refrescar();
    } else if (accion === 'descargar') await abrirDescargas(video);
    else if (accion === 'copiar') {
      await navigator.clipboard.writeText(video.url);
      avisar('Enlace copiado.');
    } else if (accion === 'origen') window.open(video.url, '_blank', 'noopener,noreferrer');
    else if (accion === 'quitar') {
      const quitado = await deps.quitarVideo(video.clave);
      deshecho = quitado || video;
      clearTimeout(temporizadorDeshacer);
      ui.vidDeshacer.hidden = false;
      avisar('Video quitado de la biblioteca.');
      temporizadorDeshacer = setTimeout(() => { ui.vidDeshacer.hidden = true; deshecho = null; }, 6000);
      await contraerTarjeta(video.clave);
      await refrescar();
    }
  }

  ui.vidPlegar.addEventListener('click', () => plegar(ui.vidPlegar.getAttribute('aria-expanded') === 'true'));
  ui.vidBuscar.addEventListener('input', () => { filtro.texto = ui.vidBuscar.value; buscarTexto().catch(console.error); });
  ui.vidEnTexto.addEventListener('change', () => buscarTexto().catch(console.error));
  ui.vidOrden.addEventListener('change', () => { filtro.orden = ui.vidOrden.value; pintar(); });
  ui.vidLimpiar.addEventListener('click', () => {
    filtro = { texto: '', plataforma: 'todas', vista: 'todos', etiqueta: '', orden: 'recientes' };
    ui.vidBuscar.value = ''; ui.vidEnTexto.checked = false; ui.vidOrden.value = 'recientes'; coincidencias = new Map(); pintar();
  });
  ui.vidFiltros.addEventListener('click', (evento) => {
    const boton = evento.target.closest('button');
    if (!boton) return;
    if (boton.dataset.plataforma) { filtro.plataforma = boton.dataset.plataforma; filtro.vista = 'todos'; }
    if (boton.dataset.vista) { filtro.vista = boton.dataset.vista; filtro.plataforma = 'todas'; }
    pintar();
  });
  ui.vidTemas.addEventListener('click', (evento) => {
    const boton = evento.target.closest('[data-etiqueta]');
    if (!boton) return;
    filtro.etiqueta = filtro.etiqueta === boton.dataset.etiqueta ? '' : boton.dataset.etiqueta;
    pintar();
  });
  ui.vidSeguir.addEventListener('click', (evento) => {
    if (evento.target.closest('[data-accion="seguir"]')) abrirVideo(encontrar(ui.vidSeguir.dataset.clave));
  });
  ui.vidLista.addEventListener('click', (evento) => {
    const tarjeta = evento.target.closest('.vid-tarjeta');
    const video = encontrar(tarjeta?.dataset.clave);
    if (!video) return;
    if (evento.target.closest('.vid-abrir')) return abrirVideo(video);
    const abrirAqui = evento.target.closest('[data-accion="abrir-aqui"]');
    if (abrirAqui) return abrirVideo(video, Number(abrirAqui.dataset.segundo));
    const botonMenu = evento.target.closest('.vid-menu-btn');
    if (botonMenu) {
      const mismo = menuAbierto === tarjeta;
      cerrarMenu();
      if (!mismo) {
        menuAbierto = tarjeta;
        $('.vid-menu', tarjeta).hidden = false;
        botonMenu.setAttribute('aria-expanded', 'true');
        $('.vid-menu [role="menuitem"]', tarjeta)?.focus();
      }
      return;
    }
    const accion = evento.target.closest('[role="menuitem"]')?.dataset.accion;
    if (accion) accionMenu(video, accion).catch((error) => { console.error(error); avisar('No pudimos completar esa acción.'); });
  });
  ui.vidLista.addEventListener('keydown', (evento) => {
    if (!menuAbierto) return;
    if (evento.key === 'Escape') { evento.preventDefault(); cerrarMenu({ devolverFoco: true }); return; }
    if (!['ArrowDown', 'ArrowUp'].includes(evento.key)) return;
    evento.preventDefault();
    const items = [...menuAbierto.querySelectorAll('[role="menuitem"]')];
    const actual = items.indexOf(document.activeElement);
    items[(actual + (evento.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus();
  });
  document.addEventListener('click', (evento) => { if (menuAbierto && !menuAbierto.contains(evento.target)) cerrarMenu(); });
  ui.vidTemaNuevo.addEventListener('input', pintarEditorTemas);
  ui.vidTemaNuevo.addEventListener('keydown', (evento) => { if (evento.key === 'Enter') { evento.preventDefault(); agregarTema(ui.vidTemaNuevo.value); } });
  ui.vidTemasSugerencias.addEventListener('click', (evento) => { const b = evento.target.closest('[data-sugerencia]'); if (b) agregarTema(b.dataset.sugerencia); });
  ui.vidTemasActuales.addEventListener('click', (evento) => { const b = evento.target.closest('[data-quitar]'); if (b) guardarTemas(quitarEtiqueta(videoTemas.etiquetas, b.dataset.quitar)); });
  ui.vidTemasListo.addEventListener('click', async () => { await colaTemas; cerrarDialogo(ui.vidTemasDialogo); await refrescar(); });
  ui.vidDeshacer.addEventListener('click', async () => {
    if (!deshecho) return;
    await deps.restaurarVideo(deshecho); clearTimeout(temporizadorDeshacer); deshecho = null; ui.vidDeshacer.hidden = true; avisar('Video restaurado.'); await refrescar();
  });
  ui.vidDescargar.addEventListener('click', descargar);
  ui.vidDescargaCancelar.addEventListener('click', () => controladorDescarga?.abort());
  ui.vidDescargasCerrar.addEventListener('click', () => { controladorDescarga?.abort(); cerrarDialogo(ui.vidDescargasDialogo); });
  ui.vidDescargasDialogo.addEventListener('cancel', () => controladorDescarga?.abort());

  refrescar();
  return { refrescar, plegar };
}
