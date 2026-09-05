/* JG Turbo · Huella SHA-256 del contenido completo
 *
 * La corrección, la caché y la sincronización identifican fuente, revisión
 * y bloques por el contenido entero, no por sus bordes. La huella anterior
 * (largo + 32 iniciales + 32 finales) confundía dos textos del mismo tamaño
 * con cambios en el centro: compartían huella y se reutilizaba un resultado
 * ajeno. SHA-256 no tiene ese problema.
 *
 * Funciona igual en navegador y en Node: núcleo síncrono sobre bytes
 * (TextEncoder + Uint32Array). Un libro de 300 páginas (~2 MB) se resume en
 * ~50 ms; la versión anterior de cadenas puras tardaba 90 s y congelaba la
 * pestaña (ver TRAMPAS.md §6.7).
 */

const _K = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1,
  0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
  0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786,
  0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147,
  0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
  0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b,
  0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a,
  0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
  0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
];

function _rr(v, a) {
  return (v >>> a) | (v << (32 - a));
}

function _sha256Bytes(bytes) {
  let h0 = 0x6a09e667; let h1 = 0xbb67ae85; let h2 = 0x3c6ef372; let h3 = 0xa54ff53a;
  let h4 = 0x510e527f; let h5 = 0x9b05688c; let h6 = 0x1f83d9ab; let h7 = 0x5be0cd19;
  const acolchada = new Uint8Array((((bytes.length + 9 + 63) >> 6) << 6));
  acolchada.set(bytes);
  acolchada[bytes.length] = 0x80;
  const vista = new DataView(acolchada.buffer);
  const bits = bytes.length * 8;
  vista.setUint32(acolchada.length - 4, bits >>> 0, false);
  vista.setUint32(acolchada.length - 8, Math.floor(bits / 4294967296), false);
  const w = new Uint32Array(64);
  for (let off = 0; off < acolchada.length; off += 64) {
    for (let i = 0; i < 16; i += 1) w[i] = vista.getUint32(off + i * 4, false);
    for (let i = 16; i < 64; i += 1) {
      const s0 = _rr(w[i - 15], 7) ^ _rr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = _rr(w[i - 2], 17) ^ _rr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0;
    }
    let a = h0; let b = h1; let c = h2; let d = h3;
    let e = h4; let f = h5; let g = h6; let h = h7;
    for (let i = 0; i < 64; i += 1) {
      const s1 = _rr(e, 6) ^ _rr(e, 11) ^ _rr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const t1 = (h + s1 + ch + _K[i] + w[i]) | 0;
      const s0 = _rr(a, 2) ^ _rr(a, 13) ^ _rr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (s0 + maj) | 0;
      h = g; g = f; f = e; e = (d + t1) | 0;
      d = c; c = b; b = a; a = (t1 + t2) | 0;
    }
    h0 = (h0 + a) | 0; h1 = (h1 + b) | 0; h2 = (h2 + c) | 0; h3 = (h3 + d) | 0;
    h4 = (h4 + e) | 0; h5 = (h5 + f) | 0; h6 = (h6 + g) | 0; h7 = (h7 + h) | 0;
  }
  return [h0, h1, h2, h3, h4, h5, h6, h7]
    .map((x) => (x >>> 0).toString(16).padStart(8, '0'))
    .join('');
}

function _aBytes(texto) {
  if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(texto);
  const t = String(texto ?? '');
  const salida = [];
  for (let i = 0; i < t.length; i += 1) {
    let c = t.charCodeAt(i);
    if (c < 0x80) salida.push(c);
    else if (c < 0x800) salida.push(0xc0 | (c >> 6), 0x80 | (c & 0x3f));
    else if (c >= 0xd800 && c <= 0xdbff && i + 1 < t.length) {
      const baja = t.charCodeAt(i + 1);
      if (baja >= 0xdc00 && baja <= 0xdfff) {
        const punto = 0x10000 + ((c - 0xd800) << 10) + (baja - 0xdc00);
        salida.push(0xf0 | (punto >> 18), 0x80 | ((punto >> 12) & 0x3f), 0x80 | ((punto >> 6) & 0x3f), 0x80 | (punto & 0x3f));
        i += 1;
      } else salida.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f));
    } else salida.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f));
  }
  return Uint8Array.from(salida);
}

/** SHA-256 hex (64 minúsculas) del contenido completo, en UTF-8. */
export function sha256Hex(contenido) {
  return _sha256Bytes(_aBytes(contenido == null ? '' : String(contenido)));
}

/** Huella de una fuente completa: SHA-256 del texto entero. */
export function huellaFuente(texto) {
  return sha256Hex(texto);
}

/** Huella corta para etiquetas (12 hex). La identidad real sigue siendo SHA-256. */
export function huellaCorta(texto) {
  return sha256Hex(texto).slice(0, 12);
}

/** ¿Parece un SHA-256 válido? */
export function esHuellaSha(valor) {
  return /^[a-f0-9]{64}$/i.test(String(valor || ''));
}
