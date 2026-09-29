const boton = document.getElementById('diagnosticar');
const copiar = document.getElementById('copiar');
const estado = document.getElementById('estado');
const resultado = document.getElementById('resultado');
let diagnostico = null;

async function pestanaClase() {
  const tabId = Number(new URLSearchParams(globalThis.location.search).get('tab'));
  const tab = Number.isInteger(tabId) && tabId > 0
    ? await chrome.tabs.get(tabId)
    : (await chrome.tabs.query({ active: true, currentWindow: true }))[0];
  if (!tab?.id || !/^https:\/\/www\.udemy\.com\/course\/[^/]+\/learn\//.test(tab.url || '')) {
    throw new Error('Abre una clase de Udemy en esta ventana.');
  }
  return tab;
}

boton.addEventListener('click', async () => {
  boton.disabled = true;
  copiar.disabled = true;
  estado.textContent = 'Revisando las pistas durante dos segundos…';
  resultado.textContent = '';
  try {
    const tab = await pestanaClase();
    const [clase, vtt] = await Promise.all([
      chrome.tabs.sendMessage(tab.id, { tipo: 'diagnosticarClase' }),
      chrome.runtime.sendMessage({ tipo: 'vttObservado', tabId: tab.id }),
    ]);
    if (clase?.error) throw new Error(clase.error);
    diagnostico = { ...clase, vttObservado: vtt };
    resultado.textContent = JSON.stringify(diagnostico, null, 2);
    copiar.disabled = false;
    estado.textContent = 'Diagnóstico listo. Puedes copiarlo para compartir el resultado.';
  } catch (error) {
    diagnostico = null;
    estado.textContent = `No se pudo revisar la clase: ${error.message}`;
  } finally {
    boton.disabled = false;
  }
});

copiar.addEventListener('click', async () => {
  if (!diagnostico) return;
  try {
    await navigator.clipboard.writeText(JSON.stringify(diagnostico, null, 2));
    estado.textContent = 'Diagnóstico copiado.';
  } catch {
    estado.textContent = 'No se pudo copiar. Selecciona el resultado y cópialo manualmente.';
  }
});
