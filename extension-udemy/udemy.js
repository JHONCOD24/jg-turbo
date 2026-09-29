function espera(ms) { return new Promise((resolver) => setTimeout(resolver, ms)); }

function tituloClase() {
  const selectores = [
    '[data-purpose="lecture-title"]',
    '[data-purpose="video-title"]',
    '[aria-current="true"] [data-purpose="item-title"]',
  ];
  for (const selector of selectores) {
    const texto = document.querySelector(selector)?.textContent?.trim();
    if (texto) return texto.slice(0, 180);
  }
  return '';
}

async function diagnosticarPista(pista) {
  const anterior = pista.mode;
  try {
    pista.mode = 'hidden';
    await espera(2000);
    return {
      kind: pista.kind,
      label: pista.label,
      language: pista.language,
      mode: anterior,
      cues: pista.cues?.length ?? 0,
    };
  } finally {
    pista.mode = anterior;
  }
}

async function diagnosticarClase() {
  const videos = [...document.querySelectorAll('video')];
  const marcos = [...document.querySelectorAll('iframe')];
  let videosIframe = 0;
  let marcosSinAcceso = 0;
  const videosEnMarcos = [];
  for (const marco of marcos) {
    try {
      const encontrados = [...marco.contentDocument.querySelectorAll('video')];
      videosIframe += encontrados.length;
      videosEnMarcos.push(...encontrados);
    } catch {
      marcosSinAcceso++;
    }
  }
  const candidatos = [...videos, ...videosEnMarcos];
  const video = candidatos.find((v) => v.getBoundingClientRect().width > 0) || candidatos[0];
  const pistas = video ? await Promise.all([...video.textTracks].map(diagnosticarPista)) : [];
  const paneles = [...document.querySelectorAll('[data-purpose*="transcript"]')];
  const lineas = paneles.flatMap((panel) => [...panel.querySelectorAll('[data-purpose*="cue"], [data-purpose*="line"]')]);
  return {
    videos: { documentoPrincipal: videos.length, enIframeAccesible: videosIframe,
      iframes: marcos.length, iframesSinAcceso: marcosSinAcceso },
    video: video ? {
      duration: Number.isFinite(video.duration) ? video.duration : null,
      readyState: video.readyState,
      playbackRate: video.playbackRate,
      muted: video.muted,
      volume: video.volume,
    } : null,
    textTracks: pistas,
    transcripcion: { panel: paneles.length > 0, lineas: lineas.length },
    titulo: tituloClase(),
  };
}

chrome.runtime.onMessage.addListener((mensaje, remitente, responder) => {
  if (mensaje?.tipo !== 'diagnosticarClase') return;
  diagnosticarClase().then(responder).catch((error) => responder({ error: error.message }));
  return true;
});

let puertoActual = null;
const clasesLeidas = new Set();

chrome.runtime.onConnect.addListener((puerto) => {
  if (puerto.name !== 'jgUdemy') return;
  puertoActual?.disconnect();
  puertoActual = puerto;
  let video = null, original = null, cache = null, controlador = null;
  let rutaClase = globalThis.location.pathname;
  let esperando = false;
  let eventos = [];
  const enviar = (dato) => { try { puerto.postMessage(dato); } catch { /* panel ya cerrado */ } };
  const restaurar = () => {
    if (video && original) {
      video.volume = original.volume;
      video.muted = original.muted;
      video.playbackRate = original.playbackRate;
    }
  };
  const informar = () => {
    if (!video) return;
    enviar({ tipo: 'estado', t: video.currentTime, tasa: video.playbackRate,
      pausado: video.paused, terminado: video.ended, esperando,
      volumen: video.volume, silenciado: video.muted,
      duracion: Number.isFinite(video.duration) ? video.duration : 0, enviadoEn: Date.now() });
  };
  const vincular = (nuevo) => {
    restaurar();
    eventos.forEach((quitar) => quitar()); eventos = [];
    controlador?.abort(); controlador = null; cache = null;
    video = nuevo;
    original = video ? { volume: video.volume, muted: video.muted, playbackRate: video.playbackRate } : null;
    if (video) {
      for (const evento of ['play', 'pause', 'seeked', 'ratechange', 'waiting', 'playing', 'ended', 'volumechange', 'emptied']) {
        const atender = () => {
          if (evento === 'waiting') esperando = true;
          if (['playing', 'seeked', 'emptied'].includes(evento)) esperando = false;
          if (evento === 'emptied') { cache = null; controlador?.abort(); enviar({ tipo: 'clase', titulo: tituloClase() }); }
          informar();
        };
        video.addEventListener(evento, atender);
        eventos.push(() => video.removeEventListener(evento, atender));
      }
    }
    enviar({ tipo: 'clase', titulo: tituloClase() }); informar();
  };
  const leerSubtitulos = async () => {
    if (!video) return { error: 'sin_video' };
    if (cache) return cache;
    const pista = [...video.textTracks].find((p) => /^en\b|^en[-_]/i.test(p.language) || /English/i.test(p.label));
    if (pista?.cues?.length) {
      cache = { idioma: 'en', etiqueta: pista.label, segmentos: [...pista.cues].map((c) => ({ startTime: c.startTime, endTime: c.endTime, text: c.text })) };
      return cache;
    }
    const url = await chrome.runtime.sendMessage({ tipo: 'vttParaLeer' });
    if (!url) return { error: 'sin_ingles' };
    const destino = new URL(url);
    if (destino.protocol !== 'https:' || !destino.hostname.endsWith('.udemycdn.com') || destino.username || destino.password) return { error: 'sin_ingles' };
    if (clasesLeidas.has(rutaClase)) return { error: 'recargar_clase' };
    clasesLeidas.add(rutaClase);
    controlador = new AbortController();
    const respuesta = await fetch(url, { credentials: 'omit', signal: controlador.signal });
    if (!respuesta.ok) throw new Error('No se pudo leer el subtítulo. Recarga la clase y activa CC en inglés.');
    cache = { idioma: 'en', etiqueta: 'English', textoVtt: await respuesta.text() };
    return cache;
  };
  puerto.onMessage.addListener(async (mensaje) => {
    if (mensaje.tipo === 'restaurar') { controlador?.abort(); restaurar(); return; }
    if (mensaje.tipo === 'leerSubtitulos') {
      try { enviar({ tipo: 'subtitulos', solicitud: mensaje.solicitud, ...await leerSubtitulos() }); }
      catch (error) { enviar({ tipo: 'subtitulos', solicitud: mensaje.solicitud, error: error.name === 'AbortError' ? 'cancelado' : error.message }); }
      return;
    }
    if (mensaje.tipo !== 'orden' || !video) return;
    const numero = Number(mensaje.valor);
    if (mensaje.accion === 'velocidad' && Number.isFinite(numero)) video.playbackRate = Math.max(.5, Math.min(2, numero));
    if (mensaje.accion === 'volumen' && Number.isFinite(numero)) video.volume = Math.max(0, Math.min(1, numero));
    if (mensaje.accion === 'silencio') video.muted = Boolean(mensaje.valor);
    if (mensaje.accion === 'play') video.play().catch(() => enviar({ tipo: 'error', mensaje: 'Dale play al video en Udemy para continuar.' }));
    if (mensaje.accion === 'pausa') video.pause();
    informar();
  });
  vincular(document.querySelector('video'));
  const intervalo = setInterval(() => {
    const actual = document.querySelector('video');
    const nuevaRuta = globalThis.location.pathname;
    if (actual !== video || nuevaRuta !== rutaClase) { rutaClase = nuevaRuta; vincular(actual); }
    else if (!video?.paused) informar();
  }, 250);
  puerto.onDisconnect.addListener(() => {
    clearInterval(intervalo); controlador?.abort(); restaurar();
    eventos.forEach((quitar) => quitar()); cache = null;
    chrome.runtime.sendMessage({ tipo: 'olvidarVtt' }).catch(() => {});
    if (puertoActual === puerto) puertoActual = null;
  });
});
