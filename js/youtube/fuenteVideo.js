/**
 * ¿De qué plataforma es el enlace pegado? Una sola respuesta para todo el panel.
 *
 * YouTube conserva su id como clave de caché (los doblajes ya guardados siguen
 * sirviendo); X lleva el prefijo «x:» para no chocar nunca con un id de YouTube.
 * Los hosts y la ruta son los mismos de api/x_video.py: las dos suites prueban
 * tests/fixtures/x/enlaces.json para que no se desalineen.
 */
import { extraerVideoId } from './transcriptionService.js';

const HOSTS_X = new Set([
  'x.com', 'twitter.com', 'mobile.x.com', 'mobile.twitter.com',
  'fxtwitter.com', 'vxtwitter.com', 'fixupx.com', 'fixvx.com',
]);
const RUTA_POST = /^\/(?:i\/web|i|[A-Za-z0-9_]{1,15})\/status(?:es)?\/(\d{5,25})(?:\/video\/(\d))?/i;

export function extraerPostX(urlCruda) {
  const texto = String(urlCruda || '').trim();
  if (!texto) return null;
  try {
    const url = new URL(/^https?:\/\//i.test(texto) ? texto : `https://${texto}`);
    const host = url.hostname.toLowerCase().replace(/^www\./, '');
    if (!HOSTS_X.has(host)) return null;
    const coincidencia = url.pathname.match(RUTA_POST);
    if (!coincidencia) return null;
    return { id: coincidencia[1], indice: Math.max(0, Number(coincidencia[2] || 1) - 1) };
  } catch {
    return null;
  }
}

export function detectarFuente(url) {
  const youtube = extraerVideoId(url);
  if (youtube) return { plataforma: 'youtube', id: youtube, indice: 0, clave: youtube };
  const post = extraerPostX(url);
  if (!post) return null;
  return {
    plataforma: 'x',
    id: post.id,
    indice: post.indice,
    clave: post.indice ? `x:${post.id}:${post.indice}` : `x:${post.id}`,
  };
}
