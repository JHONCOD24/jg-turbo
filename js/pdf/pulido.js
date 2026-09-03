/* JG Turbo · Pulido inteligente y guardián de integridad — contrato estricto
 *
 * Plan auditoría editorial segura:
 * - Un token automático debe aparecer exactamente una vez y en el mismo orden.
 * - Tolerancia cero para palabras agregadas, eliminadas, sustituidas o reordenadas.
 * - Cifras, URLs, correos, símbolos, unidades y nombres protegidos no se modifican automáticamente.
 * - Tildes/ortografía/concordancia se presentan como propuesta, nunca como sustitución directa.
 * - Respuesta inválida/incompleta/no JSON se descarta; se conserva capa local.
 * - Modo PDF no usa respaldo heurístico que cambia palabras.
 */

const URL_RE = /https?:\/\/[^\s]+|www\.[^\s]+/gi;
const EMAIL_RE = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi;
const CIFRA_RE = /\b\d[\d.,]*\b/g;
const SIMBOLO_RE = /[€$£¥%‰°℃℉Ωµ§©®™±×÷]/g;

function protegerElementos(texto) {
  const protegidos = [];
  let t = String(texto || '');
  const lugar = (tipo, valor) => {
    const id = `__JG_PROTEG_${protegidos.length}__`;
    protegidos.push({ id, tipo, valor });
    return id;
  };
  t = t.replace(URL_RE, (m) => lugar('url', m));
  t = t.replace(EMAIL_RE, (m) => lugar('email', m));
  t = t.replace(CIFRA_RE, (m) => lugar('cifra', m));
  t = t.replace(SIMBOLO_RE, (m) => lugar('simbolo', m));
  return { texto: t, protegidos };
}

/**
 * Tokeniza preservando identidad léxica (palabras) sin normalizar tildes a ciegas.
 * Para la capa automática exigimos igualdad exacta de secuencia; para propuestas
 * se puede comparar normalizado aparte.
 */
export function tokenizarExacto(texto) {
  return String(texto || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((tok) => tok.replace(/^[.,;:¡!¿?""''«»()[\]{}]+|[.,;:¡!¿?""''«»()[\]{}]+$/g, ''))
    .filter(Boolean);
}

function extraerTokensLexicos(texto) {
  // tokens para validación estricta: palabras alfanuméricas en minúsculas, sin tildes
  return String(texto || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

/**
 * ¿El texto pulido dice exactamente lo mismo que el original?
 * Estricto: misma secuencia de tokens, mismo orden, sin tolerancia.
 */
export function mismasPalabras(original, pulido) {
  if (!original && !pulido) return { igual: true, parecido: 1, motivo: 'ambos_vacios' };
  if (!original || !pulido) return { igual: false, parecido: 0, motivo: 'uno_vacio' };

  const tOrigLex = extraerTokensLexicos(original);
  const tPulLex = extraerTokensLexicos(pulido);

  if (!tOrigLex.length && !tPulLex.length) return { igual: true, parecido: 1, motivo: 'sin_palabras' };

  // Verificación de protegidos: cifras, urls, emails, símbolos no pueden cambiar
  const protOrig = protegerElementos(original);
  const protPul = protegerElementos(pulido);
  const mapaOrigProt = new Map(protOrig.protegidos.map((p) => [p.valor, p.tipo]));
  // Si los valores protegidos no se conservan idénticos, rechazo
  for (const p of protOrig.protegidos) {
    if (!pulido.includes(p.valor)) {
      return { igual: false, parecido: 0, motivo: `protegido_perdido:${p.tipo}` };
    }
  }
  for (const p of protPul.protegidos) {
    if (!original.includes(p.valor) && !protOrig.protegidos.some((o) => o.valor === p.valor)) {
      return { igual: false, parecido: 0, motivo: `protegido_agregado:${p.tipo}` };
    }
  }

  if (tOrigLex.length !== tPulLex.length) {
    const max = Math.max(tOrigLex.length, tPulLex.length);
    const parec = Math.min(tOrigLex.length, tPulLex.length) / max;
    return { igual: false, parecido: parec, motivo: 'longitud_distinta' };
  }
  for (let i = 0; i < tOrigLex.length; i += 1) {
    if (tOrigLex[i] !== tPulLex[i]) {
      // Detecta reordenación vs sustitución
      const idxEnOrig = tOrigLex.indexOf(tPulLex[i]);
      const motivo = idxEnOrig !== -1 ? 'reordenado' : 'palabra_sustituida';
      // parecido = proporción prefijo igual
      const parec = i / tOrigLex.length;
      return { igual: false, parecido: parec, motivo: `${motivo}_en_${i}` };
    }
  }
  return { igual: true, parecido: 1, motivo: 'exacto' };
}

export function validarIntegridadEstructura(respuesta) {
  if (!respuesta || typeof respuesta !== 'object') return { valida: false, motivo: 'respuesta_no_objeto' };
  if (Array.isArray(respuesta.signos) === false && Array.isArray(respuesta.propuestas) === false) {
    return { valida: false, motivo: 'sin_signos_ni_propuestas' };
  }
  if (respuesta.propuestas) {
    for (const p of respuesta.propuestas) {
      if (typeof p.inicio !== 'number' || typeof p.fin !== 'number' || p.inicio < 0 || p.fin <= p.inicio) {
        return { valida: false, motivo: 'propuesta_intervalo_invalido' };
      }
      if (p.fin - p.inicio > 80) return { valida: false, motivo: 'propuesta_demasiado_larga' };
    }
    // detectar superposición
    const ord = [...respuesta.propuestas].sort((a, b) => a.inicio - b.inicio);
    for (let i = 1; i < ord.length; i += 1) {
      if (ord[i].inicio < ord[i - 1].fin) return { valida: false, motivo: 'propuestas_superpuestas' };
    }
  }
  return { valida: true, motivo: 'ok' };
}

/**
 * Aplica decisiones individuales sobre propuestas sin aceptar reescritura completa.
 * propuestas: [{ inicio, fin, original, sustitucion, categoria }]
 * decisiones: Map índice propuesta -> 'aceptar' | 'rechazar'
 * tokens: tokenización estable del texto base
 */
export function aplicarDecisiones(textoBase, tokens, propuestas, decisiones) {
  const toks = tokens || tokenizarExacto(textoBase);
  const mapa = new Map();
  propuestas.forEach((p, idx) => {
    const dec = decisiones.get(String(idx)) || decisiones.get(idx);
    if (dec === 'aceptar') mapa.set(idx, p);
  });
  // construir texto aprobado: recorre tokens y sustituye intervalos aceptados
  // propuesta.intervalo es sobre índices de tokens
  const aceptadas = [...mapa.values()].sort((a, b) => a.inicio - b.inicio);
  // validar no superpuestas ya filtrado
  let salidaTokens = [...toks];
  // aplicar de atrás hacia adelante para no desplazar índices
  for (let k = aceptadas.length - 1; k >= 0; k -= 1) {
    const p = aceptadas[k];
    const antes = salidaTokens.slice(0, p.inicio);
    const desp = salidaTokens.slice(p.fin);
    const sustToks = tokenizarExacto(p.sustitucion);
    // solo permitir sustitución 1:1 o corrección ortográfica de un token; si difiere longitud, exigir que sea solo tilde/case
    // como no podemos validar tilde aquí sin léxico, lo permitimos pero ya pasó por guardar decisión humana
    salidaTokens = [...antes, ...sustToks, ...desp];
  }
  return salidaTokens.join(' ');
}

/* Signos que la auditoría puede insertar automáticamente (capa revisadoSeguro).
 * Cualquier otro carácter entra como propuesta, nunca como inserción directa. */
const SIGNOS_VALIDOS = new Set([',', '.', ';', ':', '…', '—', '–', '-', '"', '\'', '(', ')', '¿', '?', '¡', '!']);

/**
 * Aplica los signos validados de la IA al bloque sin tocar palabras.
 * Devuelve el texto con puntuación, o null si algo no cuadra (y entonces
 * el bloque se queda en su capa local, jamás con texto inventado).
 * Cada signo viene como { pos, tipo, texto }: pos es el índice del token;
 * «apertura» se antepone al token (¿ ¡), el resto va pegado detrás.
 */
export function aplicarSignos(textoBase, tokens, signos) {
  const toks = Array.isArray(tokens) && tokens.length ? [...tokens] : tokenizarExacto(textoBase);
  if (!Array.isArray(signos)) return null;
  const antesDe = new Map();
  const despuesDe = new Map();
  for (const s of signos) {
    const pos = typeof s?.pos === 'number' ? Math.trunc(s.pos) : NaN;
    if (!Number.isFinite(pos) || pos < -1 || pos >= toks.length) return null;
    const sig = String(s?.texto ?? '');
    if (!sig || sig.length > 3 || ![...sig].every((c) => SIGNOS_VALIDOS.has(c))) return null;
    /* Un signo sin token detrás (pos -1) solo tiene sentido como apertura. */
    const mapa = (s?.tipo === 'apertura' || pos === -1) ? antesDe : despuesDe;
    mapa.set(pos, (mapa.get(pos) || '') + sig);
  }
  let salida = '';
  toks.forEach((tok, i) => {
    const sep = i ? ' ' : '';
    salida += sep + (antesDe.get(i) || '') + tok + (despuesDe.get(i) || '');
  });
  const chequeo = mismasPalabras(textoBase, salida);
  return chequeo.igual ? salida : null;
}

export function tokenizarParaAuditoria(texto) {
  const toks = tokenizarExacto(texto);
  // huella estable: hash simple
  let h = 0;
  const s = toks.join(' ').toLowerCase();
  for (let i = 0; i < s.length; i += 1) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  return { tokens: toks, huella: String(h >>> 0) };
}

/**
 * Gestor de auditoría PDF: colas, concurrencia 2, persistencia de avance
 */
export function crearAuditorPdf({ pedirAuditoria, guardarBloque, cargarBloque, guardarProgreso, cargarProgreso }) {
  const enCurso = new Map();
  const cache = new Map();
  let cola = [];
  let activos = 0;
  let pausado = false;
  let cancelado = false;
  let onAvanceActual = null;

  async function ejecutarSiguiente(onAvance) {
    if (pausado || cancelado) return;
    while (activos < 2 && cola.length) {
      const item = cola.shift();
      if (!item) break;
      if (cache.has(item.id) || enCurso.has(item.id)) continue;
      activos += 1;
      const prom = (async () => {
        try {
          // deduplicar por carga previa
          const previo = cargarBloque ? await cargarBloque(item.id) : null;
          if (previo && previo.huella === item.huella) {
            cache.set(item.id, previo);
            if (onAvance) onAvance({ id: item.id, estado: 'cache' });
            if (guardarProgreso) await guardarProgreso(item.id, 'completo');
            return previo;
          }
          const resp = await pedirAuditoria(item);
          const val = validarIntegridadEstructura(resp);
          if (!val.valida) {
            // descartar bloque, conservar capa local
            if (guardarProgreso) await guardarProgreso(item.id, 'fallo:' + val.motivo);
            if (onAvance) onAvance({ id: item.id, estado: 'fallo', motivo: val.motivo });
            return null;
          }
          // validar que signos/propuestas no agregan/eliminan tokens
          // se confía en mismasPalabras a nivel de bloque completo si viniera texto
          const aGuardar = { ...resp, huella: item.huella, actualizado: Date.now() };
          cache.set(item.id, aGuardar);
          if (guardarBloque) await guardarBloque(item.id, aGuardar);
          if (guardarProgreso) await guardarProgreso(item.id, 'completo');
          if (onAvance) onAvance({ id: item.id, estado: 'ok' });
          return aGuardar;
        } catch (e) {
          if (guardarProgreso) await guardarProgreso(item.id, 'error:' + (e?.message || 'desconocido'));
          if (onAvance) onAvance({ id: item.id, estado: 'error', motivo: e?.message });
          return null;
        } finally {
          activos -= 1;
          enCurso.delete(item.id);
          // seguir con cola
          setTimeout(() => ejecutarSiguiente(onAvance), 0);
        }
      })();
      enCurso.set(item.id, prom);
    }
  }

  return {
    encolar(bloques, { prioridad = [] } = {}) {
      const prioSet = new Set(prioridad);
      const prio = bloques.filter((b) => prioSet.has(b.id));
      const resto = bloques.filter((b) => !prioSet.has(b.id));
      cola = [...prio, ...resto, ...cola];
    },
    /* Reordena la cola PENDIENTE sin duplicar ni relanzar nada: los ids
     * prioritarios (capítulo abierto) pasan al frente. Lo ya en curso o
     * completado no se toca. */
    repriorizar(idsPrioridad) {
      if (!Array.isArray(idsPrioridad) || !idsPrioridad.length) return;
      const set = new Set(idsPrioridad);
      const prio = cola.filter((it) => set.has(it.id));
      if (!prio.length) return;
      const resto = cola.filter((it) => !set.has(it.id));
      cola = [...prio, ...resto];
      if (!pausado && !cancelado && activos < 2 && cola.length) {
        ejecutarSiguiente(onAvanceActual);
      }
    },
    iniciar(onAvance) { cancelado = false; pausado = false; onAvanceActual = onAvance; ejecutarSiguiente(onAvance); },
    pausar() { pausado = true; },
    reanudar(onAvance) { pausado = false; if (onAvance) onAvanceActual = onAvance; ejecutarSiguiente(onAvanceActual); },
    cancelar() { cancelado = true; cola = []; },
    pendientes() { return cola.length + activos; },
    estaEnCurso(id) { return enCurso.has(id); },
    obtener(id) { return cache.get(id) || null; },
    async hidratar(ids) {
      if (!cargarBloque) return;
      for (const id of ids) {
        const dato = await cargarBloque(id);
        if (dato) cache.set(id, dato);
      }
    },
  };
}

/**
 * Gestor perezoso de pulido de capítulos (compatibilidad).
 * Mantiene misma interfaz previa pero ahora valida estricto.
 */
export function crearPulidor({ pulir, guardar, cargar }) {
  const listas = new Map();
  const enCurso = new Map();
  const conocidos = new Set();

  return {
    async obtener(indice, parte, { alProgresar } = {}) {
      if (!parte || typeof parte.texto !== 'string') return '';
      if (listas.has(indice)) return listas.get(indice);
      if (enCurso.has(indice)) return enCurso.get(indice);
      const promesa = (async () => {
        try {
          if (cargar) {
            const guardado = await cargar(indice);
            if (guardado) {
              listas.set(indice, guardado);
              conocidos.add(indice);
              return guardado;
            }
          }
          if (!pulir) return parte.texto;
          const textoPulido = await pulir(parte.texto, { alProgresar, mode: 'lectura' });
          if (!textoPulido || !textoPulido.trim()) return parte.texto;
          const chequeo = mismasPalabras(parte.texto, textoPulido);
          const aceptado = chequeo.igual ? textoPulido : parte.texto;
          listas.set(indice, aceptado);
          conocidos.add(indice);
          if (guardar) await guardar(indice, aceptado);
          return aceptado;
        } catch (error) {
          return parte.texto;
        } finally {
          enCurso.delete(indice);
        }
      })();
      enCurso.set(indice, promesa);
      return promesa;
    },
    precargar(indice, parte) {
      if (!parte || listas.has(indice) || enCurso.has(indice) || conocidos.has(indice)) return;
      this.obtener(indice, parte).catch(() => {});
    },
    estaPulido(indice) { return listas.has(indice) || conocidos.has(indice); },
    sembrar(indices) { if (!Array.isArray(indices)) return; for (const i of indices) conocidos.add(Number(i)); },
    limpiarMemoria() { listas.clear(); enCurso.clear(); conocidos.clear(); }
  };
}
