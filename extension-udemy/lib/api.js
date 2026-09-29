import { protegerTerminos } from './terminosWeb.js';
const BASE = 'https://jg-turbo.vercel.app/api';

export function crearApi({ fetchImpl = globalThis.fetch.bind(globalThis), storage = chrome.storage.local } = {}) {
  let proveedor;
  async function base() {
    const valor = (await storage.get('jg_api_base')).jg_api_base;
    if (!valor) return BASE;
    const url = new URL(valor);
    if (!['127.0.0.1', 'localhost', 'jg-turbo.vercel.app'].includes(url.hostname)) throw new Error('La dirección de JG Turbo no es válida.');
    return valor.replace(/\/$/, '');
  }
  async function pedir(ruta, opciones = {}, timeout = 45000) {
    const controlador = new AbortController();
    const cancelar = () => controlador.abort(opciones.signal?.reason);
    if (opciones.signal?.aborted) cancelar();
    opciones.signal?.addEventListener('abort', cancelar, { once: true });
    const tope = setTimeout(() => controlador.abort(new Error('El servidor tardó demasiado. Vuelve a intentar.')), timeout);
    try {
      const resp = await fetchImpl((await base()) + ruta, { ...opciones, credentials: 'omit', signal: controlador.signal });
      const bytes = await resp.arrayBuffer();
      return new Response([204, 205, 304].includes(resp.status) ? null : bytes, { status: resp.status, statusText: resp.statusText, headers: resp.headers });
    }
    finally { clearTimeout(tope); opciones.signal?.removeEventListener('abort', cancelar); }
  }
  async function fallo(resp, servicio) {
    const datos = await resp.json().catch(() => ({}));
    throw new Error(typeof datos.detail === 'string' ? datos.detail : `${servicio} no respondió (HTTP ${resp.status}).`);
  }
  return {
    async traducirTexto(texto, { tituloVideo = '', contexto = {}, signal, terminosWeb = false } = {}) {
      const protegido = terminosWeb ? protegerTerminos(texto) : null;
      if (!proveedor) {
        try { const resp = await pedir('/health', { signal }); proveedor = resp.ok ? (await resp.json()).ai_provider_server || 'gemini' : 'gemini'; }
        catch (error) { if (signal?.aborted) throw error; proveedor = 'gemini'; }
      }
      const body = JSON.stringify({ text: protegido?.texto || texto, direction: 'en-es', provider: proveedor, api_key: '', literal: true, revisar: false,
        titulo_video: tituloVideo.slice(0, 300), contexto_previo: String(contexto.anterior || '').slice(-600), contexto_siguiente: String(contexto.siguiente || '').slice(0, 300) });
      for (let intento = 0; intento < 2; intento++) {
        let resp;
        try { resp = await pedir('/translate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, signal }, 90000); }
        catch (error) { if (signal?.aborted || intento) throw error; continue; }
        if (!resp.ok) { if ([502, 504].includes(resp.status) && !intento) continue; await fallo(resp, 'El traductor'); }
        const datos = await resp.json();
        return protegido ? { ...datos, text: protegido.restaurar(datos.text) } : datos;
      }
    },
    async generarAudio(texto, { voz = 'female', acento = 'es-CO', signal } = {}) {
      const multilingue = ['female-multi', 'male-multi'].includes(voz);
      const resp = await pedir('/tts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, signal,
        body: JSON.stringify({ text: texto, voice: ['male', 'male-multi'].includes(voz) ? 'male' : 'female', language: 'es', locale: acento,
          ...(multilingue ? { unified: true } : {}),
          rate: 1, tone: 'neutral', idioma_fijo: true, source: 'yt' }) });
      if (!resp.ok) await fallo(resp, 'La voz');
      return { blob: await resp.blob(), engineHdr: resp.headers.get('X-TTS-Engine') || '', respaldoHdr: resp.headers.get('X-TTS-Fallback') || '' };
    },
    calentar() { pedir('/tts-warmup').catch(() => {}); },
  };
}
