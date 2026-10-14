/* Regresión: biblioteca estable, carátulas entre aparatos y Aa sin salir. */
import { cargarChromium, iniciarServidor, carpetaTemporal, crearLibroNarrativo, abrirLector, comprobar, cerrarPrueba } from './_paso.mjs';
import { join } from 'node:path';
const chromium = await cargarChromium();
const { servidor, base: local } = await iniciarServidor();
const base = process.env.JG_BASE || local;
const browser = await chromium.launch();
const tmp = await carpetaTemporal();
const pdf = join(tmp, 'libro.pdf');
crearLibroNarrativo(pdf, 24);
try {
  for (const [ancho, alto] of [[390,844],[844,390]]) {
    const { p, contexto, errores } = await abrirLector(browser, base, pdf, { ancho, alto, tactil:true });
    const antes = await p.locator('#pdfPagPos').textContent();
    await p.locator('#btnPdfAaRapido').tap();
    const caja = await p.locator('#pdfAparienciaHoja').boundingBox();
    comprobar(caja && caja.y >= 0 && caja.y+caja.height <= alto+1, `${ancho}: Aa cabe íntegramente en pantalla`);
    comprobar(caja && caja.x >= 0 && caja.x+caja.width <= ancho+1, `${ancho}: Aa no desborda a lo ancho`);
    await p.locator('#pdfAparienciaHoja').evaluate(n => { n.scrollTop = n.scrollHeight; });
    comprobar(await p.locator('#pdfAparienciaHoja .pdf-hoja-cerrar').isVisible(), `${ancho}: el cierre queda visible al recorrer los ajustes`);
    await p.locator('#pdfAparienciaHoja .pdf-hoja-cerrar').tap();
    comprobar(await p.locator('#pdfAparienciaHoja').isHidden(), `${ancho}: cerrar Aa conserva el libro abierto`);
    comprobar(await p.locator('#pdfPagPos').textContent() === antes, `${ancho}: cerrar ajustes conserva la página`);
    const aviso = await p.locator('#pdfNoticeLector').evaluate(n => ({fondo:getComputedStyle(n).backgroundColor,display:getComputedStyle(n).display,altura:n.clientHeight,scroll:n.scrollHeight}));
    comprobar(aviso.display === 'block' && aviso.fondo.startsWith('rgb(') && aviso.altura >= aviso.scroll, `${ancho}: aviso opaco, legible y sin recortar texto`);
    // Un libro remoto sin PDF original ni tapa real reproduce el bucle antiguo.
    await p.evaluate(async () => {
      const b = await import('/js/pdf/biblioteca.js');
      await b.guardarDocumento({meta:{id:'sin-original',titulo:'Cuaderno de prueba sin catálogo',estado:'leyendo'},partes:[{titulo:'Uno',texto:'Texto de prueba. '.repeat(100)}]});
    });
    await p.locator('#btnPdfBack').tap();
    await p.waitForTimeout(1500);
    await p.evaluate(() => {
      window.repintados = 0;
      window.vigiaRejilla = new MutationObserver(() => window.repintados++);
      window.vigiaRejilla.observe(document.querySelector('#pdfRejilla'), {childList:true});
    });
    const marca = await p.evaluate(async () => (await (await import('/js/pdf/biblioteca.js')).cargarDocumento('sin-original')).actualizado);
    await p.waitForTimeout(8000);
    const estabilidad = await p.evaluate(async () => ({repintados:window.repintados,marca:(await (await import('/js/pdf/biblioteca.js')).cargarDocumento('sin-original')).actualizado}));
    comprobar(estabilidad.repintados === 0, `${ancho}: la biblioteca no repinta sola en bucle`);
    comprobar(estabilidad.marca === marca, `${ancho}: la tapa provisional no altera la fecha del libro`);
    const tapaContinuar = await p.locator('#pdfContinuarTapa').evaluate(n => n.style.backgroundImage).catch(() => '');
    await p.locator('#pdfOrden').selectOption('titulo');
    await p.waitForTimeout(300);
    const conservada = await p.evaluate(async imagen => {
      const url = imagen.match(/url\(["']?(.*?)["']?\)/)?.[1];
      if (!url?.startsWith('blob:')) return false;
      return fetch(url).then(r => r.ok).catch(() => false);
    }, tapaContinuar);
    comprobar(conservada, `${ancho}: ordenar la rejilla conserva la carátula de Seguir leyendo`);
    const paquete = await p.evaluate(async () => {
      const b = await import('/js/pdf/biblioteca.js');
      return b.paqueteParaSubir('sin-original', {conPortada:true});
    });
    const segundo = await browser.newContext();
    const q = await segundo.newPage();
    await q.goto(base);
    const resultado = await q.evaluate(async paquete => {
      const b = await import('/js/pdf/biblioteca.js');
      await b.importarDeSincronizacion(paquete);
      const doc = await b.cargarDocumento(paquete.id);
      const tapa = await b.cargarPortada(paquete.id);
      const sinTapa = {...paquete,id:'sin-tapa',datos:{...paquete.datos,portadaMini:null,meta:{...paquete.datos.meta,tienePortada:true,origenPortada:'real'}}};
      await b.importarDeSincronizacion(sinTapa);
      const sin = await b.cargarDocumento('sin-tapa');
      return {tapa:!!tapa?.size,tiene:doc.tienePortada,origen:doc.origenPortada,falsa:sin.tienePortada};
    }, paquete);
    comprobar(resultado.tapa && resultado.tiene && resultado.origen === 'dibujada', `${ancho}: la carátula y su procedencia llegan al segundo aparato`);
    comprobar(!resultado.falsa, `${ancho}: un paquete sin imagen no afirma tener una carátula`);
    comprobar(errores.length === 0, `${ancho}: sin errores JavaScript`, errores.join(';'));
    await segundo.close();
    await contexto.close();
  }
} finally { await browser.close(); servidor.close(); }
cerrarPrueba('estabilidad móvil PDF');
