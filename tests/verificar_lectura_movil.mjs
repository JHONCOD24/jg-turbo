/* JG Turbo · La página de lectura en el teléfono (modelo editorial)
 *
 * Diseño guiado por `ejemplos/PLAN Diseño movil Kindle.md` y sus dos capturas.
 *
 * NO se comparan píxeles con la captura: es de otro teléfono, a otra densidad
 * y de otra aplicación. Perseguir eso es perseguir un fantasma, y el propio
 * plan dice que no se trata de copiar otra app. Se mide lo que de verdad
 * decide si un texto se lee bien:
 *
 *   · la MEDIDA DE LÍNEA en caracteres (la referencia tiene ~40),
 *   · cuánta pantalla se lleva el texto,
 *   · el contraste,
 *   · y que mostrar u ocultar los controles no mueva ni una línea.
 *
 *   node tests/verificar_lectura_movil.mjs
 *   JG_BASE=https://jg-turbo.vercel.app node tests/verificar_lectura_movil.mjs
 */
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { resolve, join, extname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { crearLibro } from './generarPdfPrueba.mjs';

const app = resolve(import.meta.dirname, '..');
const { chromium } = await import(pathToFileURL(resolve(app, '../JG Turbo_OLD/node_modules/playwright/index.mjs')));
const destino = resolve(app, '.playwright-cli/lectura-movil');
await mkdir(destino, { recursive: true });
const pdf = join(destino, 'libro.pdf');
crearLibro(pdf, 24);

const tipos = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.svg': 'image/svg+xml', '.txt': 'text/plain', '.css': 'text/css', '.png': 'image/png', '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json' };
const servidor = createServer(async (q, r) => {
  try {
    const p = decodeURIComponent(new URL(q.url, 'http://localhost').pathname);
    const f = join(app, p === '/' ? 'index.html' : p);
    r.setHeader('Content-Type', tipos[extname(f)] || 'application/octet-stream');
    r.end(await readFile(f));
  } catch { r.writeHead(404).end(); }
});
await new Promise((r) => servidor.listen(0, '127.0.0.1', r));
const base = process.env.JG_BASE || `http://127.0.0.1:${servidor.address().port}`;

let ok = 0;
const fallos = [];
const comprobar = (n, c, d = '') => {
  if (c) { ok++; console.log(`OK: ${n}`); }
  else { fallos.push(`${n}${d ? ` — ${d}` : ''}`); console.log(`FALLO: ${n}${d ? ` — ${d}` : ''}`); }
};

/* Medida de línea: el número que decide la comodidad de lectura. Por debajo
   de ~34 el ojo salta de renglón demasiado y por encima de ~46 se pierde al
   volver. La referencia está en ~40. */
const MEDIDA_MIN = 32;
const MEDIDA_MAX = 48;
/* Con el cromo apartado el texto se lo lleva casi todo: es el modelo de la
   referencia, donde los controles flotan por encima y no ocupan sitio.
   El plan pedía 78 %; se exige 80 % porque se alcanza de sobra. No se pone
   más alto a propósito: la página se recorta al múltiplo del interlineado
   para que la última línea no salga partida por la mitad, y eso cuesta hasta
   un renglón. Línea limpia vale más que ese 1 % de pantalla. */
const MIN_TEXTO = 0.80;

const TELEFONOS = [['iPhone SE', 375, 667], ['iPhone 14', 390, 844], ['grande', 430, 932], ['estrecho', 320, 740]];

const navegador = await chromium.launch();

/** Media de caracteres por línea de las líneas llenas de un párrafo. */
const medirLectura = (p) => p.evaluate(() => {
  const art = document.querySelector('#pdfLectura');
  const cs = getComputedStyle(art);
  /* Se mide sobre líneas REALES usando rangos: un párrafo se parte en tantos
     rectángulos como renglones ocupa. */
  const medidas = [];
  for (const bloque of [...art.querySelectorAll('p')].slice(0, 6)) {
    const nodo = [...bloque.childNodes].find((n) => n.nodeType === 3 && n.textContent.trim().length > 60);
    if (!nodo) continue;
    const r = document.createRange();
    r.selectNodeContents(nodo);
    const lineas = [...r.getClientRects()].filter((x) => x.width > 20);
    if (lineas.length < 2) continue;
    const anchoMax = Math.max(...lineas.map((x) => x.width));
    /* Solo líneas llenas: la última de un párrafo siempre es corta. */
    const llenas = lineas.filter((x) => x.width > anchoMax * 0.9).length;
    if (!llenas) continue;
    medidas.push(nodo.textContent.trim().length / lineas.length);
  }
  const media = medidas.length ? medidas.reduce((a, b) => a + b, 0) / medidas.length : 0;

  const lec = art.getBoundingClientRect();
  const pie = document.querySelector('.pdf-pie-lectura');
  const contraste = (() => {
    const lum = (c) => {
      const [r0, g0, b0] = c.match(/\d+/g).slice(0, 3).map((v) => {
        const s = Number(v) / 255;
        return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * r0 + 0.7152 * g0 + 0.0722 * b0;
    };
    const parr = art.querySelector('p');
    if (!parr) return 0;
    const f = lum(getComputedStyle(parr).color);
    const fondo = lum(getComputedStyle(art).backgroundColor.includes('rgba(0, 0, 0, 0)')
      ? getComputedStyle(document.querySelector('#pdfResultArea')).backgroundColor
      : getComputedStyle(art).backgroundColor);
    const [a, b] = f > fondo ? [f, fondo] : [fondo, f];
    return (a + 0.05) / (b + 0.05);
  })();

  return {
    ventana: innerHeight,
    medida: Math.round(media * 10) / 10,
    textoAlto: Math.round(lec.height),
    parte: lec.height / innerHeight,
    familia: cs.fontFamily,
    tam: Math.round(parseFloat(cs.fontSize) * 10) / 10,
    interlineado: Math.round((parseFloat(cs.lineHeight) / parseFloat(cs.fontSize)) * 100) / 100,
    alineado: cs.textAlign,
    idioma: art.getAttribute('lang') || document.documentElement.lang,
    contraste: Math.round(contraste * 100) / 100,
    pieVisible: !!pie && pie.offsetParent !== null,
    pieTexto: pie ? pie.innerText.replace(/\s+/g, ' ').trim() : '',
    desbordeH: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    pagina: document.querySelector('#pdfPagPos')?.textContent || '',
  };
});

async function abrir(width, height) {
  const p = await navegador.newPage({ viewport: { width, height }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  p.on('pageerror', (e) => fallos.push(`error de JavaScript: ${String(e).slice(0, 130)}`));
  await p.goto(base);
  await p.locator('#tabPdf').click();
  await p.locator('#pdfInput').setInputFiles(pdf);
  await p.locator('#btnPdfRead').click();
  await p.locator('#pdfLectura p').first().waitFor({ timeout: 60000 });
  await p.waitForFunction(() => document.body.dataset.pdfUnir === 'listo', null, { timeout: 30000 }).catch(() => {});
  await p.waitForTimeout(1200);
  return p;
}

try {
  for (const [nombre, w, h] of TELEFONOS) {
    console.log(`\n── ${nombre} · ${w}×${h} ───────────────────────────────────────`);
    const p = await abrir(w, h);
    const m = await medirLectura(p);
    console.log(`   medida ${m.medida} car/línea · texto ${Math.round(m.parte * 100)} % · ${m.tam}px/${m.interlineado} · ${m.alineado} · contraste ${m.contraste}:1`);

    comprobar(`${nombre}: la medida de línea es cómoda (${MEDIDA_MIN}-${MEDIDA_MAX} caracteres)`,
      m.medida >= MEDIDA_MIN && m.medida <= MEDIDA_MAX, `${m.medida} caracteres por línea`);
    comprobar(`${nombre}: el texto se lleva al menos el ${Math.round(MIN_TEXTO * 100)} %`,
      m.parte >= MIN_TEXTO, `${Math.round(m.parte * 100)} %`);
    comprobar(`${nombre}: usa la tipografía editorial`, /Literata/i.test(m.familia), m.familia);
    comprobar(`${nombre}: el contraste del texto es holgado (≥7:1)`, m.contraste >= 7, `${m.contraste}:1`);
    comprobar(`${nombre}: sin desbordamiento horizontal`, m.desbordeH <= 1, `${m.desbordeH} px`);
    comprobar(`${nombre}: el pie dice cuánto queda y el porcentaje`,
      m.pieVisible && /\d+\s*%/.test(m.pieTexto) && /min/i.test(m.pieTexto), m.pieTexto);

    if (nombre === 'iPhone 14') {
      /* La fuente tiene que estar de verdad cargada, no solo declarada. */
      comprobar('la fuente Literata llega y se aplica',
        await p.evaluate(() => document.fonts.check('400 20px Literata')));
      /* El idioma manda en la partición de palabras: un libro en inglés no se
         puede partir con reglas del español. */
      comprobar('el texto declara el idioma del libro', /^(es|en|pt|fr|de)/i.test(m.idioma || ''), m.idioma);

      /* Lo innegociable: mostrar u ocultar el cromo no mueve el texto. */
      const antes = await medirLectura(p);
      await p.evaluate(() => document.body.classList.remove('jg-inmersivo'));
      await p.waitForTimeout(600);
      const conCromo = await medirLectura(p);
      comprobar('mostrar los controles NO remaqueta el texto',
        conCromo.textoAlto === antes.textoAlto, `${antes.textoAlto} → ${conCromo.textoAlto}`);
      comprobar('mostrar los controles NO cambia de página',
        conCromo.pagina === antes.pagina, `${antes.pagina} → ${conCromo.pagina}`);
    }
    await p.screenshot({ path: join(destino, `${nombre.replace(/\s+/g, '-')}.png`) });
    await p.close();
  }

  /* Tablet y escritorio: solo se toca el teléfono. */
  console.log('\n── Tablet y escritorio no cambian ──────────────────────────────');
  for (const [nombre, w, h] of [['tablet', 768, 1024], ['escritorio', 1440, 900]]) {
    const p = await abrir(w, h);
    const m = await medirLectura(p);
    console.log(`   ${nombre}: ${m.tam}px · ${m.alineado} · ${m.familia.split(',')[0]}`);
    comprobar(`${nombre} conserva su tipografía (no editorial)`, !/Literata/i.test(m.familia), m.familia);
    comprobar(`${nombre} no queda justificado`, m.alineado !== 'justify', m.alineado);
    await p.close();
  }
} finally {
  await navegador.close();
  servidor.close();
}

console.log(`\n${'─'.repeat(64)}`);
if (fallos.length) {
  console.log(`✖ ${ok} OK · ${fallos.length} fallos:`);
  fallos.slice(0, 14).forEach((f) => console.log(`   · ${f}`));
  process.exit(1);
}
console.log(`✔ La página de lectura se lee como un libro. ${ok} comprobaciones.`);
