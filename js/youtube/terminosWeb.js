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
// Ni letras, ni números, ni una comilla invertida pegadas: así no se marca dos veces.
const patron = new RegExp(`(?<![\\p{L}\\p{N}_\`])(?:${TERMINOS.slice().sort((a, b) => b.length - a.length).map(escapar).join('|')})(?![\\p{L}\\p{N}_\`])`, 'giu');

/**
 * Marca los tecnicismos como código (`array`) antes de traducir: el traductor VE la
 * palabra (sabe qué significa) y el formato le pide no traducirla. Medido en producción
 * el 2026-10-02 con 36 subtítulos de una clase de desarrollo web: 31 de 36 tecnicismos
 * quedaron en inglés y ningún lote se rechazó. Las fichas opacas anteriores (JGWEB0X)
 * rechazaron 12 de 25 llamadas, dejaron 3 subtítulos sin traducir (sin voz) y el
 * traductor inventaba el sentido. NUNCA lanza: lo peor es que un término salga traducido.
 */
export function protegerTerminos(texto) {
  return { texto: String(texto ?? '').replace(patron, (termino) => `\`${termino}\``), restaurar: quitarMarcasDeTermino };
}

/**
 * Quita las comillas de código antes del subtítulo y de la voz (la voz las leería).
 * Cada comilla se va con los espacios que la rodean y deja uno si había alguno: así
 * «` npm `» queda «npm» y una comilla perdida («`React y `hooks`») no pega palabras.
 */
export function quitarMarcasDeTermino(texto) {
  return String(texto ?? '').replace(/[ \t]*`[ \t]*/g, (marca) => (marca.length > 1 ? ' ' : ''));
}
