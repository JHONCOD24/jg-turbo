/**
 * Texto sincronizado (panel) y subtítulo sobre el video.
 * `textoDe(i)` da el texto a mostrar del segmento i, o `null` si aún se está
 * traduciendo (la Fase 2 traduce por ventanas). En las pausas entre frases se
 * queda la última línea: antes volvía a decir «Inicia la reproducción…» y
 * parpadeaba en cada silencio (auditoría H20).
 */
import { trocearSubtitulo, trozoPorProgreso } from './subtituloDinamico.js';

/** Margen para que el texto medido en canvas nunca desborde el renglón real del DOM (kerning). */
const MARGEN_ANCHO = 0.96;
let contextoMedida = null;

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
    this.estilo = 'dinamico';   // 'dinamico' (trozos de ≤ 2 renglones al ritmo de la voz) | 'completo'
    this.progreso = 0;
    this.cache = { clave: '', texto: '', trozos: [] };
    this.datos = caption?.dataset ?? {};
    if (caption) {
      this.datos.estilo = this.estilo;
      // Un solo observador: pantalla completa, giro del teléfono y cambio de tamaño re-miden el renglón.
      if (typeof ResizeObserver !== 'undefined') new ResizeObserver(() => this.#pintarSubtitulo()).observe(caption);
    }
  }

  /** `dinamico` o `completo` (el texto entero del segmento, como siempre). */
  definirEstilo(estilo) {
    this.estilo = estilo === 'completo' ? 'completo' : 'dinamico';
    this.datos.estilo = this.estilo;
    this.#pintarSubtitulo();
  }

  /**
   * Avanza el trozo del subtítulo. `voz` = { indice, progreso } de la frase que
   * dice la voz (progreso 0–1 dentro del segmento); sin voz sigue al reloj del video.
   */
  actualizarProgreso(voz, tiempoVideo) {
    if (this.estilo !== 'dinamico' || !this.caption || this.indice < 0) return;
    let p;
    if (voz && voz.indice === this.indice) p = voz.progreso;
    else {
      const s = this.segmentos[this.indice];
      const duracion = s ? s.endTime - s.startTime : 0;
      p = duracion > 0 ? (Number(tiempoVideo) - s.startTime) / duracion : 1;
    }
    this.progreso = Number.isFinite(p) ? Math.min(1, Math.max(0, p)) : 0;
    this.#pintarSubtitulo();
  }

  /** Trozos del texto al ancho y fuente reales del subtítulo (se recalculan solo si cambian). */
  #trozosDe(texto) {
    if (typeof getComputedStyle !== 'function') return [texto];   // sin navegador (pruebas en Node)
    const cs = getComputedStyle(this.caption);
    const ancho = this.caption.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    const fuente = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
    const clave = `${fuente}|${Math.round(ancho)}`;
    if (this.cache.clave === clave && this.cache.texto === texto) return this.cache.trozos;
    contextoMedida ||= document.createElement('canvas').getContext('2d');
    contextoMedida.font = fuente;
    const trozos = trocearSubtitulo(texto, { medir: (t) => contextoMedida.measureText(t).width, anchoMax: ancho * MARGEN_ANCHO });
    this.cache = { clave, texto, trozos };
    return trozos;
  }

  #pintarSubtitulo() {
    const c = this.caption;
    if (!c) return;
    const texto = this.indice >= 0 ? this.#texto(this.indice) : '';
    if (this.estilo !== 'dinamico' || !texto) {
      if (c.textContent !== texto) c.textContent = texto;
      delete this.datos.trozo; delete this.datos.total;
      return;
    }
    if (c.hidden) return;
    const trozos = this.#trozosDe(texto);
    const k = trozoPorProgreso(trozos, this.progreso);
    const visible = trozos[k] ?? texto;
    if (c.textContent !== visible) c.textContent = visible;
    this.datos.trozo = String(k);
    this.datos.total = String(trozos.length);
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
      if (this.caption) { this.caption.textContent = ''; delete this.datos.trozo; }   // en silencio no hay subtítulo
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
    this.progreso = 0;
    this.#pintarSubtitulo();
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
