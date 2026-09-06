/* Regression: actual taps, not DOM .click() which bypasses an overlay. */
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { resolve, join, extname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { crearLibro } from './generarPdfPrueba.mjs';

const app = resolve(import.meta.dirname, '..');
const { chromium } = await import(pathToFileURL(resolve(app, '../JG Turbo_OLD/node_modules/playwright/index.mjs')));
const out = join(app, '.playwright-cli/pdf-menus');
await mkdir(out, { recursive: true });
crearLibro(join(out, 'libro.pdf'), 24);
const server = createServer(async (req, res) => {
  try {
    const path = new URL(req.url, 'http://localhost').pathname;
    const file = join(app, path === '/' ? 'index.html' : path);
    res.setHeader('Content-Type', ({ '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.css': 'text/css' })[extname(file)] || 'application/octet-stream');
    res.end(await readFile(file));
  } catch { res.writeHead(404).end(); }
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const base = process.env.JG_BASE || `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ headless: !process.argv.includes('--headed') });
let ok = 0; const failures = [];
function check(name, value, detail) {
  if (value) { ok++; console.log('OK: ' + name); }
  else { failures.push(name); console.log('FALLO: ' + name, detail || ''); }
}
try {
  for (const width of (process.env.JG_WIDTHS || '320,360,390,768,1024,1280,1440').split(',').map(Number)) {
    const mobile = width <= 640;
    const page = await browser.newPage({ viewport: { width, height: 844 }, hasTouch: true, isMobile: mobile });
    page.setDefaultTimeout(5000);
    page.on('pageerror', e => failures.push(String(e)));
    await page.goto(base);
    await page.locator('#tabPdf').tap();
    await page.locator('#pdfInput').setInputFiles(join(out, 'libro.pdf'));
    await page.locator('#btnPdfRead').tap();
    await page.locator('#pdfLectura p').first().waitFor();
    await page.waitForTimeout(1600);
    const wake = async () => {
      if (await page.evaluate(() => document.body.classList.contains('jg-inmersivo'))) {
        await page.locator('#pdfLectura').tap({ position: { x: 80, y: 150 } });
        await page.waitForTimeout(250);
      }
    };
    await wake();
    const geometry = () => page.evaluate(() => {
      const rect = id => { const r = document.querySelector(id).getBoundingClientRect(); return { top: r.top, bottom: r.bottom, height: r.height }; };
      return { scrollY, wrap: document.querySelector('.wrap').scrollTop, area: document.querySelector('#pdfResultArea').scrollTop,
        col: document.querySelector('.pdf-texto-col').scrollTop, header: rect('.pdf-doc-cab'), text: rect('#pdfLectura'),
        page: document.querySelector('#pdfPagPos').textContent };
    });
    await page.locator('#btnPdfPagNext').tap();
    await page.waitForTimeout(650); await wake();
    const before = await geometry();
    const original = await page.locator('#pdfOutput').inputValue();
    await page.evaluate(() => {
      window.pdfTestMedidas = 0;
      new MutationObserver(ms => { window.pdfTestMedidas += ms.length; })
        .observe(document.querySelector('#pdfLectura'), { attributes: true, attributeFilter: ['style'] });
    });
    for (const [name, button, sheet] of [
      ['Contenido', mobile ? '#btnPdfBmIndice' : '#btnPdfIndice', '#pdfIndice'],
      ['Opciones', mobile ? '#btnPdfBmOpciones' : '#btnPdfMas', '#pdfMasPanel'],
      ['Apariencia', mobile ? '#btnPdfBmApariencia' : '#btnPdfApariencia', '#pdfAparienciaHoja'],
      ['Texto', '#btnPdfHerramientas', '#pdfHerramientasPanel'],
    ]) {
      await page.locator(button).tap();
      await page.waitForTimeout(250);
      const after = await geometry();
      check(`${width} ${name}: no desplaza ancestros`, after.scrollY === before.scrollY && after.wrap === before.wrap && after.area === before.area && after.col === before.col, { before, after });
      check(`${width} ${name}: cabecera dentro de pantalla`, after.header.top >= -1, after);
      if (name !== 'Contenido' || width < 1024) {
        await page.keyboard.press('Shift+Tab');
        check(`${width} ${name}: foco contenido en hoja`, await page.locator(sheet).evaluate(e => e.contains(document.activeElement)));
      }
      await page.screenshot({ path: join(out, `${width}-${name}.png`) });
      if (name === 'Apariencia') {
        try {
          await page.locator('#pdfAparienciaHoja [data-tema="sepia"]').tap({ timeout: 1500 });
          check(`${width} Apariencia recibe toques`, await page.locator('#pdfResultArea').getAttribute('data-tema') === 'sepia');
        } catch (e) { check(`${width} Apariencia recibe toques`, false, e.message.slice(0, 300)); }
      }
      const close = page.locator(`${sheet} [data-cerrar-hoja]`).first();
      if (await close.isVisible()) {
        try { await close.tap({ timeout: 1500 }); }
        catch { await page.keyboard.press('Escape'); }
      } else await page.locator(button).tap();
      await page.waitForTimeout(250);
      const closed = await geometry();
      check(`${width} ${name}: cerrar conserva página`, closed.page === before.page, { before, closed });
      check(`${width} ${name}: cerrar conserva área de lectura`, Math.abs(closed.text.top - before.text.top) < 2 && Math.abs(closed.text.height - before.text.height) < 2, { before, closed });
      check(`${width} ${name}: foco vuelve al origen`, await page.locator(button).evaluate(e => e === document.activeElement));
    }
    /* Abrir un menú no debe volver a medir cada columna del capítulo. El
       índice lateral sí cambia el ancho en escritorio, por diseño. */
    if (mobile) check(`${width}: menús sin repaginar`, await page.evaluate(() => pdfTestMedidas === 0));
    check(`${width}: menús no cambian el texto`, await page.locator('#pdfOutput').inputValue() === original);
    if (mobile) {
      check(`${width}: líneas fuera de la cabecera`, before.text.top >= before.header.bottom);
      const limite = await page.locator('#pdfPaginacion').evaluate(e => e.getBoundingClientRect().top);
      check(`${width}: líneas fuera del reproductor`, before.text.bottom <= limite + 1);
      await page.locator('#btnPdfBmVoz').tap();
      await page.locator('#pdfDockNav select').first().tap({ trial: true });
      await page.locator('#btnPdfBmVoz').tap();
      await page.waitForTimeout(250);
      check(`${width}: Voz no mueve lectura`, JSON.stringify(await geometry()) === JSON.stringify(before));
    }
    const appearanceButton = mobile ? '#btnPdfBmApariencia' : '#btnPdfApariencia';
    await page.screenshot({ path: join(out, `${width}-lectura.png`) });
    await page.locator(appearanceButton).tap();
    await page.locator('#pdfAparTam').focus();
    await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(250);
    check(`${width}: tamaño responde`, await page.locator('#pdfAparTam').inputValue() === '20');
    await page.keyboard.press('ArrowLeft');
    await page.waitForTimeout(250);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(250);
    await page.locator(appearanceButton).tap();
    await page.goBack();
    await page.waitForTimeout(250);
    check(`${width}: Atrás cierra Apariencia sin salir del libro`, await page.locator('#pdfAparienciaHoja').isHidden() && await page.locator('#pdfLectura').isVisible());
    if (width === 390) {
      await page.locator(appearanceButton).tap();
      await page.locator('#pdfAparModo').selectOption('scroll');
      await page.keyboard.press('Escape');
      await page.locator('#pdfLectura').hover();
      await page.mouse.wheel(0, 500);
      await page.waitForTimeout(350);
      const freeBefore = await geometry();
      check('390: desplazamiento libre mueve el texto', freeBefore.col > 0);
      await page.locator(appearanceButton).tap();
      await page.keyboard.press('Escape');
      check('390: menú conserva desplazamiento libre', (await geometry()).col === freeBefore.col);
      await page.locator(appearanceButton).tap();
      await page.setViewportSize({ width: 844, height: 390 });
      await page.waitForTimeout(400);
      await page.locator('#pdfAparienciaHoja [data-tema="papel"]').tap();
      check('horizontal: Apariencia responde tras girar', await page.locator('#pdfResultArea').getAttribute('data-tema') === 'papel');
      await page.keyboard.press('Escape');
      await page.setViewportSize({ width: 390, height: 844 });
      await page.waitForTimeout(400);
      check('girar conserva cabecera visible', (await geometry()).header.top >= 0);
    }
    await page.screenshot({ path: join(out, `${width}-ajustes.png`) });
    await page.close();
  }
} finally { await browser.close(); server.close(); }
console.log(`\n${ok} OK; ${failures.length} fallos`);
if (failures.length) process.exitCode = 1;
