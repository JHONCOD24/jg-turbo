export class TranscriptionDisplay {
  /** `caption` es la línea opcional sobre el video; vive fuera de la raíz. */
  constructor(raiz, caption = null) {
    this.raiz = raiz;
    this.segmentos = [];
    this.anterior = raiz.querySelector('[data-sync-prev]');
    this.activo = raiz.querySelector('[data-sync-active]');
    this.siguiente = raiz.querySelector('[data-sync-next]');
    this.indicador = raiz.querySelector('[data-sync-indicator]');
    this.velocidad = raiz.querySelector('[data-sync-rate-label]');
    this.voz = raiz.querySelector('[data-sync-voice]');
    this.caption = caption;
  }

  definirSegmentos(segmentos) {
    this.segmentos = segmentos;
    this.mostrar(-1);
  }

  mostrar(indice) {
    const actual = this.segmentos[indice];
    this.anterior.textContent = this.segmentos[indice - 1]?.text || '';
    this.activo.textContent = actual?.text || 'Inicia la reproducción para ver la traducción sincronizada.';
    if (this.caption) this.caption.textContent = actual?.text || '';
    this.siguiente.textContent = this.segmentos[indice + 1]?.text || '';
    this.activo.classList.remove('is-changing');
    requestAnimationFrame(() => this.activo.classList.add('is-changing'));
    const conError = Boolean(actual?.translationError);
    this.raiz.classList.toggle('has-translation-error', conError);
    this.indicador.textContent = actual?.translationError ? 'Traducción parcial' : 'Sincronización activa';
  }

  mostrarVelocidad(velocidad) {
    this.velocidad.textContent = `${Number(velocidad || 1).toFixed(2).replace(/\.00$/, '')}x`;
  }

  mostrarVoz(estado) {
    if (!this.voz) return;
    const etiquetas = {
      activo: 'Voz ES activa',
      cargando: 'Preparando voz',
      error: 'Voz parcial',
      inactivo: 'Audio original',
    };
    this.voz.textContent = etiquetas[estado] || 'Voz ES lista';
    this.voz.dataset.estado = estado || 'lista';
  }
}
