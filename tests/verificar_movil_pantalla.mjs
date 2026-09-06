/* JG Turbo · La pantalla del teléfono: arriba, abajo y quién desplaza
 *
 * Reportado por el usuario auditando en su móvil: «sigue quedando un hueco en
 * la parte inferior» y «la parte superior está cortada».
 *
 * Medido antes de esta prueba: `html` y `body` quedaban fijados al alto de la
 * ventana y quien desplazaba era `.wrap` por dentro. Eso tiene tres
 * consecuencias que solo se ven en un teléfono de verdad:
 *
 *   1. La barra de direcciones del navegador NO se retrae —solo lo hace
 *      cuando desplaza el documento—, así que se pierden ~60-100 px de
 *      pantalla de forma permanente.
 *   2. Cuando esa barra aparece o desaparece, `100dvh` cambia y el alto
 *      fijado deja de cuadrar: ahí está el hueco de abajo.
 *   3. Con `viewport-fit=cover` y sin zona segura arriba, el encabezado se
 *      mete debajo de la barra de estado y se ve cortado.
 *
 *   node tests/verificar_movil_pantalla.mjs
 *   JG_BASE=https://jg-turbo.vercel.app node tests/verificar_movil_pantalla.mjs
 */
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { resolve, join, extname } from 'node:path';
import { pathToFileURL } from 'node:url';

const app = resolve(import.meta.dirname, '..');
const { chromium } = await import(pathToFileURL(resolve(app, '../JG Turbo_OLD/node_modules/playwright/index.mjs')));
const destino = resolve(app, '.playwright-cli/movil-pantalla');
await mkdir(destino, { recursive: true });

const tipos = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.svg': 'image/svg+xml', '.txt': 'text/plain', '.css': 'text/css', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
const servidor = createServer(async (q, r) => {
  try {
    const p = new URL(q.url, 'http://localhost').pathname;
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

const PESTANAS = [['Micrófono', '#tabMic'], ['Archivo', '#tabFile'], ['YouTube', '#tabYt'], ['PDF', '#tabPdf'], ['Traducir', '#tabTrans']];
const TELEFONOS = [['iPhone SE', 375, 667], ['iPhone 14', 390, 844], ['Pixel', 412, 839], ['bajito', 360, 600]];

const navegador = await chromium.launch({ headless: !process.argv.includes('--headed') });

/** Estado de la pantalla: quién desplaza, qué sobra abajo, dónde empieza arriba. */
const mirar = (p) => p.evaluate(() => {
  const d = document.documentElement;
  const cs = getComputedStyle(d);
  const wrap = document.querySelector('.wrap');
  const csw = wrap ? getComputedStyle(wrap) : null;
  const head = document.querySelector('.wrap > header');
  /* Lo último que se ve de verdad: el elemento con contenido más abajo. */
  const ultimo = [...document.querySelectorAll('.wrap > *')]
    .filter((e) => e.offsetParent !== null && getComputedStyle(e).display !== 'none')
    .map((e) => e.getBoundingClientRect().bottom)
    .reduce((a, b) => Math.max(a, b), 0);
  return {
    ventana: innerHeight,
    docDesplaza: d.scrollHeight > d.clientHeight + 2,
    wrapDesplaza: wrap ? wrap.scrollHeight > wrap.clientHeight + 2 : false,
    wrapOverflowY: csw ? csw.overflowY : null,
    padTopWrap: csw ? csw.paddingTop : null,
    topHeader: head ? Math.round(head.getBoundingClientRect().top) : null,
    finContenido: Math.round(ultimo),
    scrollMax: d.scrollHeight - d.clientHeight,
  };
});

try {
  for (const [nombre, w, h] of TELEFONOS) {
    console.log(`\n── ${nombre} · ${w}×${h} ────────────────────────────────────────`);
    const ctx = await navegador.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    const p = await ctx.newPage();
    p.on('pageerror', (e) => fallos.push(`error de JavaScript (${nombre}): ${String(e).slice(0, 120)}`));
    await p.goto(base, { waitUntil: 'domcontentloaded' });
    await p.waitForTimeout(1000);

    for (const [tn, sel] of PESTANAS) {
      await p.locator(sel).click();
      await p.waitForTimeout(650);
      const antes = await mirar(p);

      /* 1. Quien desplaza tiene que ser el DOCUMENTO. Si desplaza un cajón de
            dentro, la barra del navegador no se retrae nunca y se pierden
            ~60-100 px de pantalla en todo momento. */
      if (antes.wrapDesplaza || antes.docDesplaza) {
        comprobar(`${nombre}/${tn}: desplaza el documento, no un cajón interno`,
          antes.docDesplaza && !antes.wrapDesplaza,
          `doc=${antes.docDesplaza} wrap=${antes.wrapDesplaza}`);
      } else {
        /* Sin nada que desplazar no hay qué verificar; se registra para que
         * el conteo sea explicable (un cambio de conteo silencioso es alarma). */
        console.log(`  (sin desplazamiento: ${nombre}/${tn}, no aplica)`);
      }

      /* 2. Todo el contenido tiene que poder alcanzarse. */
      await p.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
      await p.waitForTimeout(400);
      const abajo = await mirar(p);
      comprobar(`${nombre}/${tn}: se llega al final del contenido`,
        abajo.finContenido <= abajo.ventana + 4,
        `queda contenido ${Math.round(abajo.finContenido - abajo.ventana)} px por debajo`);

      /* 3. Al final del todo no puede sobrar un hueco muerto. */
      const hueco = Math.round(abajo.ventana - abajo.finContenido);
      comprobar(`${nombre}/${tn}: sin hueco muerto al final`, hueco <= 48, `sobran ${hueco} px`);

      await p.evaluate(() => window.scrollTo(0, 0));
      await p.waitForTimeout(250);
    }

    /* 4. Arriba: con `viewport-fit=cover` el contenido va bajo la barra de
          estado, así que el hueco superior debe salir de la zona segura y no
          de un número fijo. En el emulador la zona segura vale 0, así que se
          comprueba el contrato en el CSS, no el píxel. */
    const reglasArriba = await p.evaluate(() => [...document.styleSheets]
      .flatMap((s) => { try { return [...s.cssRules].map((r) => r.cssText); } catch { return []; } })
      .filter((t) => t.includes('safe-area-inset-top')).length);
    comprobar(`${nombre}: la app reserva la zona segura de arriba`, reglasArriba >= 2,
      `solo ${reglasArriba} reglas usan safe-area-inset-top`);

    await p.locator('#tabMic').click();
    await p.waitForTimeout(400);
    await p.screenshot({ path: join(destino, `${nombre.replace(/\s+/g, '-')}.png`) });
    await ctx.close();
  }

  /* 5. Escritorio no cambia: sigue con su ventana fija y sin desplazamiento
        de documento, que es lo que el usuario ya aprobó. */
  console.log('\n── Escritorio 1440×900 (no debe cambiar) ───────────────────────');
  const esc = await navegador.newPage({ viewport: { width: 1440, height: 900 } });
  await esc.goto(base, { waitUntil: 'domcontentloaded' });
  await esc.waitForTimeout(900);
  const e = await mirar(esc);
  comprobar('escritorio conserva su ventana fija', !e.docDesplaza, JSON.stringify(e));
  await esc.close();
} finally {
  await navegador.close();
  servidor.close();
}

console.log(`\n${'─'.repeat(64)}`);
if (fallos.length) {
  console.log(`✖ ${ok} OK · ${fallos.length} fallos:`);
  fallos.slice(0, 14).forEach((f) => console.log(`   · ${f}`));
  if (fallos.length > 14) console.log(`   … y ${fallos.length - 14} más`);
  process.exit(1);
}
console.log(`✔ La pantalla del teléfono se comporta. ${ok} comprobaciones.`);
