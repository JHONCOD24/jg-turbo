const CLAVE_VTT = (tabId) => `vtt_${tabId}`;

function rutaPublica(url) {
  try {
    const parsed = new URL(url);
    const ruta = parsed.pathname.split('/').map((parte) => {
      if (/\d|^[a-f0-9]{8,}$/i.test(parte) || parte.length > 64) return '[oculto]';
      return parte;
    }).join('/');
    return { host: parsed.hostname, ruta };
  } catch {
    return null;
  }
}

chrome.webRequest.onCompleted.addListener(async ({ tabId, url }) => {
  if (tabId < 0) return;
  try {
    const parsed = new URL(url);
    if (!/\.vtt$/i.test(parsed.pathname)) return;
    await chrome.storage.session.set({ [CLAVE_VTT(tabId)]: rutaPublica(url) });
  } catch {
    // Un recurso ajeno mal formado no debe interrumpir el diagnóstico.
  }
}, { urls: ['https://*.udemycdn.com/*'] });

chrome.runtime.onMessage.addListener((mensaje, remitente, responder) => {
  if (mensaje?.tipo !== 'vttObservado' || !Number.isInteger(mensaje.tabId)) return;
  chrome.storage.session.get(CLAVE_VTT(mensaje.tabId))
    .then((dato) => responder(dato[CLAVE_VTT(mensaje.tabId)] || null))
    .catch(() => responder(null));
  return true;
});

chrome.tabs.onRemoved.addListener((tabId) => {
  chrome.storage.session.remove(CLAVE_VTT(tabId));
});

function esClase(url) {
  try {
    const parsed = new URL(url);
    return parsed.hostname === 'www.udemy.com' && /^\/course\/[^/]+\/learn\//.test(parsed.pathname);
  } catch {
    return false;
  }
}

async function habilitarPanel(tabId, url) {
  await chrome.sidePanel.setOptions({ tabId, path: 'panel.html', enabled: esClase(url) });
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
});
chrome.runtime.onStartup.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
});
chrome.tabs.onUpdated.addListener((tabId, cambio, tab) => {
  if (cambio.url || cambio.status === 'complete') habilitarPanel(tabId, tab.url || cambio.url);
});
chrome.tabs.query({}).then((tabs) => {
  for (const tab of tabs) habilitarPanel(tab.id, tab.url);
});
