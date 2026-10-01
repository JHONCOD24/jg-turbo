/**
 * Texto sincronizado (panel) y subtítulo sobre el video.
 * `textoDe(i)` da el texto a mostrar del segmento i, o `null` si aún se está
 * traduciendo (la Fase 2 traduce por ventanas). En las pausas entre frases se
 * queda la última línea: antes volvía a decir «Inicia la reproducción…» y
 * parpadeaba en cada silencio (auditoría H20).
 */
export class TranscriptionDisplay {
  /** `caption` es la línea opcional sobre el video; vive fuera de la raíz. */
  constructor(raiz, caption = null) {
    this.raiz = raiz;
    this.segmentos = [];
    this.textoDe = () => null;
    this.indice = -1;
    this.yaMostro = false;
    this.anterior = raiz.querySelector('[data-sync-prev]');
    this.activo = raiz.querySelector('[data-sync-active]');
    this.siguiente = raiz.querySelector('[data-sync-next]');
    this.indicador = raiz.querySelector('[data-sync-indicator]');
    this.velocidad = raiz.querySelector('[data-sync-rate-label]');
    this.voz = raiz.querySelector('[data-sync-voice]');
    this.caption = caption;
  }

  definirSegmentos(segmentos, textoDe = (i) => segmentos[i]?.text ?? null) {
    this.segmentos = segmentos || [];
    this.textoDe = textoDe;
    this.indice = -1;
    this.yaMostro = false;
    this.#pintar(-1);
  }

  /** Vuelve a pintar la línea actual (p. ej. cuando llega su traducción). */
  refrescar() {
    this.#pintar(this.indice);
  }

  mostrar(indice) {
    if (indice < 0 && this.yaMostro) {
      this.indice = indice; // una traducción que llega tarde no repinta el subtítulo anterior
      if (this.caption) this.caption.textContent = '';   // en silencio no hay subtítulo
      return;
    }
    this.indice = indice;
    this.#pintar(indice);
  }

  #texto(i) {
    if (i < 0 || i >= this.segmentos.length) return '';
    return this.textoDe(i) ?? '';
  }

  #pintar(indice) {
    const actual = indice >= 0 ? this.segmentos[indice] : null;
    const texto = actual ? this.#texto(indice) : '';
    this.anterior.textContent = this.#texto(indice - 1);
    this.activo.textContent = actual ? (texto || '…') : 'Dale play para ver la traducción sincronizada.';
    if (this.caption) this.caption.textContent = texto;
    this.siguiente.textContent = this.#texto(indice + 1);
    if (actual) this.yaMostro = true;
    this.activo.classList.remove('is-changing');
    // Solo estética: si rAF no dispara (ventana sin pintar), no pasa nada.
    requestAnimationFrame(() => this.activo.classList.add('is-changing'));
    const pendiente = Boolean(actual) && this.textoDe(indice) === null;
    this.indicador.textContent = pendiente ? 'Traduciendo…' : 'Sincronización activa';
  }

  /** `automatica` = la bajó el ritmo automático para que la voz quepa. */
  mostrarVelocidad(velocidad, automatica = false) {
    const tasa = `${Number(velocidad || 1).toFixed(2).replace(/\.00$/, '')}x`;
    this.velocidad.textContent = automatica ? `${tasa} · ritmo automático` : tasa;
  }

  mostrarVoz(estado) {
    if (!this.voz) return;
    const etiquetas = {
      activo: 'Voz ES activa',
      cargando: 'Preparando voz',
      error: 'Voz parcial',
      inactivo: 'Audio original',
      fin: 'Video terminado',
    };
    this.voz.textContent = etiquetas[estado] || 'Voz ES lista';
    this.voz.dataset.estado = estado || 'lista';
  }
}
