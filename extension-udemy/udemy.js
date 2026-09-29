function espera(ms) { return new Promise((resolver) => setTimeout(resolver, ms)); }

function tituloClase() {
  const selectores = [
    '[data-purpose="lecture-title"]',
    '[data-purpose="curriculum-item-title"]',
    'h1',
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
