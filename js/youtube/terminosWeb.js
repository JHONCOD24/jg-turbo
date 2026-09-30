const TERMINOS = [
  'JavaScript', 'TypeScript', 'Node.js', 'Next.js', 'React', 'Angular', 'Vue',
  'Express', 'Bootstrap', 'Tailwind', 'jQuery', 'MongoDB', 'PostgreSQL', 'MySQL',
  'GitHub', 'Git', 'npm', 'HTML', 'CSS', 'SQL', 'JSON', 'DOM', 'HTTP', 'HTTPS',
  'REST API', 'API', 'AJAX', 'CRUD', 'JWT', 'OAuth', 'WebSocket', 'Docker',
  'full stack', 'full-stack', 'front end', 'front-end', 'frontend',
  'back end', 'back-end', 'backend', 'framework', 'frameworks',
  'middleware', 'endpoint', 'endpoints', 'callback', 'callbacks',
  'promise', 'promises', 'async', 'await', 'hooks', 'hook', 'props',
  'array', 'arrays', 'string', 'strings', 'boolean', 'booleans',
  'pull request', 'commit', 'commits', 'branch', 'branches',
];
const escapar = (texto) => texto.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const patron = new RegExp(`(?<![\\p{L}\\p{N}_])(?:${TERMINOS.slice().sort((a, b) => b.length - a.length).map(escapar).join('|')})(?![\\p{L}\\p{N}_])`, 'giu');
const segmento = (texto, posicion) => [...texto.slice(0, posicion).matchAll(/\[\[JG_SEG_\d+\]\]/g)].at(-1)?.[0] || '';

// Los tokens viajan solo al traductor; se retiran antes del subtitulo y la voz.
export function protegerTerminos(texto) {
  let prefijo = 'JGWEB';
  while (texto.includes(prefijo)) prefijo += 'Z';
  const terminos = [];
  const protegido = texto.replace(patron, (original, posicion) => {
    const token = `${prefijo}${terminos.length}X`;
    terminos.push({ token, original, segmento: segmento(texto, posicion) });
    return token;
  });
  return { texto: protegido, restaurar(traduccion) {
    let salida = String(traduccion);
    for (const termino of terminos) {
      const posicion = salida.indexOf(termino.token);
      if (posicion < 0 || salida.indexOf(termino.token, posicion + termino.token.length) >= 0
        || segmento(salida, posicion) !== termino.segmento) {
        throw new Error('La traducción cambió un marcador de término técnico. Vuelve a traducir este fragmento.');
      }
      salida = salida.replace(termino.token, () => termino.original);
    }
    return salida;
  } };
}
