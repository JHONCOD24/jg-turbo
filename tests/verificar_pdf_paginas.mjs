import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { resolve, join, extname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { crearLibro } from './generarPdfPrueba.mjs';
import assert from 'node:assert/strict';
import { despertarCromo as despertar, abrirHerramientas } from './_cromo.mjs';
const app = resolve(import.meta.dirname, '..');
const { chromium } = await import(pathToFileURL(resolve(app, '../JG Turbo_OLD/node_modules/playwright/index.mjs')));
const destino = resolve(app, '.playwright-cli/pdf-paginas');
await mkdir(destino, { recursive: true });
const pdf = join(destino, 'libro.pdf'); crearLibro(pdf, 24);
const tipos = {'.html':'text/html', '.js':'text/javascript', '.mjs':'text/javascript', '.json':'application/json', '.svg':'image/svg+xml'};
const servidor = createServer(async (q,r) => {
  try { const p = new URL(q.url, 'http://localhost').pathname; const f = join(app, p === '/' ? 'index.html' : p); r.setHeader('Content-Type', tipos[extname(f)] || 'application/octet-stream'); r.end(await readFile(f)); }
  catch { r.writeHead(404).end(); }
});
await new Promise(r => servidor.listen(0, '127.0.0.1', r));
/** Devuelve los controles si la lectura inmersiva los apartó (teléfono).
 *  El cromo se aparta ~700 ms DESPUÉS de pasar de página (espera a que
 *  termine el desplazamiento suave), así que primero hay que dejar que ese
 *  temporizador entre; si no, se comprueba antes de tiempo y luego el botón
 *  ya no se puede pulsar. */
async function despertarCromo(p) {
  await p.waitForTimeout(1000);
  for (let i = 0; i < 4; i += 1) {
    const dormido = await p.evaluate(() => document.body.classList.contains('jg-inmersivo'));
    if (!dormido) return;
    await p.locator('#pdfLectura').click({ position: { x: 40, y: 40 } });
    await p.waitForTimeout(400);
  }
}

/** Espera a que «Unir palabras» termine su pasada del capítulo.
 *  Se espera a la SEÑAL, no a que el texto parezca quieto: contra el dominio
 *  real el diccionario llega por la red, y «quieto» solo significaba que el
 *  trabajo aún no había empezado. */
async function esperarUnion(p) {
  await p.waitForFunction(() => document.body.dataset.pdfUnir === 'listo',
    null, { timeout: 30000 }).catch(() => {});
  await p.waitForTimeout(300);
}

const navegador = await chromium.launch({ headless: !process.argv.includes('--headed') });
try {
 for (const [nombre,width,height] of [['escritorio',1440,900],['movil',390,844],['estrecho',320,740],['tablet',768,1024]]) {
  const p = await navegador.newPage({viewport:{width,height}});
  p.on('pageerror', e => console.log('ERROR',String(e)));
  await p.goto(process.env.JG_BASE || `http://127.0.0.1:${servidor.address().port}`);
  await p.locator('#tabPdf').click();
  await p.locator('#pdfInput').setInputFiles(pdf);
  await p.locator('#btnPdfRead').click();
  await p.locator('#pdfLectura p').first().waitFor();
  await p.waitForTimeout(1800);
  /* «Unir palabras» hace una pasada al abrir el capítulo y eso CAMBIA el
     texto. Hay que esperar a que termine o las comparaciones de más abajo
     salen unas veces bien y otras mal. */
  await esperarUnion(p);
  const medir = () => p.evaluate(() => {
    const a=document.querySelector('#pdfLectura'), c=document.querySelector('.pdf-texto-col'), dock=document.querySelector('#pdfDockNav');
    return {alto:a.clientHeight, ancho:a.clientWidth, paginas:document.querySelector('#pdfPagPos').textContent,
      desplazamiento:a.scrollLeft, desborde:c.scrollHeight-c.clientHeight, fondo:dock.getBoundingClientRect().bottom,
      ventana:innerHeight, ocultos:[...c.querySelectorAll('[hidden]')].filter(e=>getComputedStyle(e).display!=='none').length,
      dialogo:!document.querySelector('#pdfAuditoriaHoja').hidden};
  });
  let medida=await medir(); console.log(nombre,medida);
  assert(medida.alto>120,'altura útil del libro'); assert(medida.ancho>240,'ancho legible');
  assert(medida.desborde<=3,'sin scroll vertical de lectura');
  /* El reproductor tiene que poder alcanzarse ENTERO. En tablet y escritorio
     es una barra siempre a la vista. En el teléfono (≤640 px) es una hoja que
     sube desde el botón «Voz»: cerrada está fuera de pantalla a propósito, así
     que lo que se comprueba es que al abrirla quepa completa. */
  if (width > 640) { assert(medida.fondo<=height+2,'reproductor dentro de pantalla'); }
  else {
    await despertar(p);
    await p.locator('#btnPdfBmVoz').click(); await p.waitForTimeout(400);
    const abierto = await p.evaluate(() => { const d=document.querySelector('#pdfDockNav').getBoundingClientRect();
      return {top:d.top, bottom:d.bottom}; });
    assert(abierto.bottom<=height+2 && abierto.top>=-2,'reproductor completo al abrirlo en el teléfono');
    await p.locator('#btnPdfBmVoz').click(); await p.waitForTimeout(300);
  }
  assert.equal(medida.ocultos,0); assert.equal(medida.dialogo,false);
  assert(Number(medida.paginas.split(' de ')[1])>1,'paginación real');
  const texto=await p.locator('#pdfOutput').inputValue();
  await p.locator('#btnPdfPagNext').click(); await p.waitForTimeout(400);
  medida=await medir(); assert(medida.desplazamiento>100,'siguiente mueve el texto');
  assert(medida.paginas.startsWith('2 de ')); assert.equal(await p.locator('#pdfOutput').inputValue(),texto);
  /* En el teléfono, Apariencia / Contenido / Opciones se accionan desde la
     barra del pulgar; en tablet y escritorio siguen en la cabecera. */
  const puerta = (escritorio, movil) => p.locator(width > 640 ? escritorio : movil);
  await despertarCromo(p);
  await puerta('#btnPdfApariencia', '#btnPdfBmApariencia').click();
  await p.locator('#pdfAparTam').fill('24'); await p.locator('#pdfAparTam').dispatchEvent('input');
  await p.keyboard.press('Escape'); await p.waitForTimeout(300);
  assert((await medir()).desplazamiento>0,'cambiar letra conserva el lugar');
  /* La métrica viaja en variables CSS: el tamaño elegido tiene que verse de
   * verdad en el estilo computado (antes el inline se lo llevaba todo). */
  const tamComputado = await p.evaluate(() => parseFloat(getComputedStyle(document.querySelector('#pdfLectura')).fontSize));
  assert(tamComputado >= 23.5, `la letra elegida se aplica (mide ${tamComputado}px)`);
  if (nombre==='movil') {
    /* Piso de legibilidad: en el teléfono nunca por debajo de 17px, aunque
     * la persona elija 16. El clamp anterior estaba muerto (el estilo inline
     * lo pisaba) y 16px se quedaba en 16. */
    await puerta('#btnPdfApariencia', '#btnPdfBmApariencia').click();
    await p.locator('#pdfAparTam').fill('16'); await p.locator('#pdfAparTam').dispatchEvent('input');
    await p.keyboard.press('Escape'); await p.waitForTimeout(300);
    const piso = await p.evaluate(() => parseFloat(getComputedStyle(document.querySelector('#pdfLectura')).fontSize));
    /* El piso pasa de 17 a 16 px con el diseño editorial: 16 es el mínimo del
       propio control, así que se respeta exactamente lo que elige la persona
       y nada queda por debajo. La protección de legibilidad sigue: por
       debajo de 16 no se puede bajar. */
    assert(piso >= 16, `piso móvil de 16px aunque se elija menos (mide ${piso}px)`);
  }
  if (nombre==='movil') {
    /* Gestos con eventos táctiles sintéticos (el ratón no cuenta: el lector
     * solo atiende dedo/lápiz). Reproduce lo que el usuario reportó: gestos
     * que no responden, diagonales muertas y bloqueo tras seleccionar. */
    const deslizar = (x1,y1,x2,y2) => p.evaluate(([a,b,c,d]) => {
      const el = document.querySelector('#pdfLectura');
      const base = { bubbles: true, cancelable: true, pointerType: 'touch', pointerId: 7, isPrimary: true };
      el.dispatchEvent(new PointerEvent('pointerdown', { ...base, clientX: a, clientY: b }));
      el.dispatchEvent(new PointerEvent('pointerup', { ...base, clientX: c, clientY: d }));
    }, [x1,y1,x2,y2]);
    const pagina = () => p.locator('#pdfPagPos').textContent();
    let antes = await pagina();
    await deslizar(300, 400, 180, 405); await p.waitForTimeout(700);
    assert.notEqual(await pagina(), antes, 'deslizar a la izquierda pasa página');
    antes = await pagina();
    await deslizar(200, 400, 185, 402); await p.waitForTimeout(700);
    assert.equal(await pagina(), antes, 'un roce corto no pasa página');
    await deslizar(200, 520, 195, 380); await p.waitForTimeout(700);
    assert.notEqual(await pagina(), antes, 'deslizar hacia arriba también avanza');
    /* Una selección vieja no puede bloquear los gestos para siempre. */
    await p.evaluate(() => {
      const par = document.querySelector('#pdfLectura p');
      if (par) document.getSelection().selectAllChildren(par);
    });
    await p.waitForTimeout(950);
    antes = await pagina();
    await deslizar(300, 400, 180, 405); await p.waitForTimeout(700);
    assert.notEqual(await pagina(), antes, 'con selección vieja el gesto sigue pasando página');
    await p.evaluate(() => document.getSelection().removeAllRanges());
  }
  await abrirHerramientas(p);
  await p.locator('#pdfVistaEditar').click(); assert(await p.locator('#pdfOutput').isVisible());
    assert(!(await p.locator('#pdfPaginacion').isVisible()));
  await p.locator('#pdfEditarCancelar').click(); await p.waitForTimeout(300);
  assert((await medir()).alto>120,'volver a lectura recupera altura');
  if(nombre==='escritorio') {
    await abrirHerramientas(p);
    await p.locator('#btnPdfCortes').click();
    const ctx=await p.locator('.pdf-corte-ctx').first().textContent();
    console.log('corte de prueba',ctx);
    const previo=await p.locator('#pdfOutput').inputValue();
    await p.locator('.pdf-corte-acciones').first().getByRole('button',{name:'Unir',exact:true}).click();
    await p.waitForTimeout(500);
    assert.notEqual(await p.locator('#pdfOutput').inputValue(),previo,'Unir cambia el texto visible');
    await p.getByRole('button',{name:'Deshacer última',exact:true}).click(); await p.waitForTimeout(500);
    assert.equal(await p.locator('#pdfOutput').inputValue(),previo,'Deshacer restaura texto exacto');
    /* Editar no puede tumbar Unir: la edición aprobada se conserva y Unir
     * sigue trabajando en el resto. Antes lanzaba y el botón moría en
     * silencio (y la etapa 1 no salía nunca del error). */
    await p.locator('#pdfCortesCerrar').click(); await p.waitForTimeout(300);
    await abrirHerramientas(p);
    await p.locator('#pdfVistaEditar').click();
    await p.locator('#pdfOutput').fill(previo + ' FIN');
    await p.locator('#pdfEditarGuardar').click(); await p.waitForTimeout(500);
    await abrirHerramientas(p);
    await p.locator('#btnPdfUnirPalabras').click(); await p.waitForTimeout(1500);
    assert((await p.locator('#pdfOutput').inputValue()).includes('FIN'), 'la edición aprobada sobrevive a Unir');
    const notaTrasUnir = await p.evaluate(() => document.querySelector('#pdfNoticeLector')?.textContent || '');
    assert(!/no se pud/i.test(notaTrasUnir), `Unir no arroja error tras editar: ${notaTrasUnir}`);
    /* Segunda pulsación sin nada que unir: dice algo, no se queda muda. */
    await abrirHerramientas(p);
    await p.locator('#btnPdfUnirPalabras').click(); await p.waitForTimeout(1200);
    const nota2 = await p.evaluate(() => document.querySelector('#pdfNoticeLector')?.textContent || '');
    assert(/no hay (palabras partidas|uniones seguras)/.test(nota2), `Unir avisa cuando no hay nada: ${nota2}`);
    await p.evaluate(()=>{
      window.pruebaPeticiones={cortes:0,puntuacion:0};
      window.pruebaOmitirUno=true;
      window.jgDecidirLimitesPdf=async limites=>{await new Promise(r=>setTimeout(r,400));window.pruebaPeticiones.cortes++;return {ia_used:true,decisions:limites.filter((l,i)=>!(window.pruebaOmitirUno && i===0)).map(l=>({boundaryId:l.boundaryId,action:'space',confidence:1}))};};
      window.jgCorregirBloqueLectura=async texto=>{window.pruebaPeticiones.puntuacion++;return {text:texto,ia_used:true};};
    });
    await despertarCromo(p); await puerta('#btnPdfMas', '#btnPdfBmOpciones').click(); await p.locator('#btnPdfCorregirLibro').click();
    assert(await p.locator('#pdfAuditoriaHoja').isVisible());
    assert.equal(await p.evaluate(()=>window.pruebaPeticiones.cortes),0,'sin IA antes del consentimiento');
    await p.locator('#btnPdfAuditoriaAceptar').click();
    /* La etapa 1 cuenta sus lotes: antes se quedaba clavada en «Etapa 1 de 3»
     * y parecía colgada durante N peticiones en serie. */
    await p.waitForFunction(() => /lote \d+ de \d+/.test(document.querySelector('#pdfPulidoEstado')?.textContent || ''), null, { timeout: 15000 });
    console.log('etapa con progreso', await p.locator('#pdfPulidoEstado').textContent());
    await p.waitForFunction(()=>window.pruebaPeticiones.puntuacion>0,null,{timeout:15000});
    await p.waitForTimeout(1000);
    console.log('corrección simulada',await p.evaluate(()=>window.pruebaPeticiones));
    assert(!(await p.locator('#btnPdfCortes').evaluate(e => e.hidden)),'las decisiones omitidas quedan pendientes');
    assert((await p.locator('#pdfPulidoEstado').textContent()).includes('cortes por revisar'),'puntuación parcial no se presenta como libro corregido');
    await p.evaluate(()=>{window.pruebaOmitirUno=false;});
    await despertarCromo(p); await puerta('#btnPdfMas', '#btnPdfBmOpciones').click(); await p.locator('#btnPdfCorregirLibro').click();
    await p.waitForFunction(()=>document.querySelector('#btnPdfCortes').hidden,null,{timeout:15000});
    await p.waitForTimeout(1000);
    assert(!(await p.locator('#btnPdfCortes').isVisible()),'decisiones aceptadas dejan cero pendientes');
    const corregido=await p.locator('#pdfOutput').inputValue();
    const meta=await p.evaluate(async()=>{
      const b=await import('/js/pdf/biblioteca.js'); const d=(await b.listarDocumentos())[0];
      const r=await b.cargarReconstruccion(d.id);
      return {atomos:r.atomos.length, pendientes:r.manifiesto.filter(l=>l.d==='pending').length};
    });
    assert(meta.atomos>0); assert.equal(meta.pendientes,0,'decisiones guardadas');
    await p.locator('#btnPdfPagNext').click(); await p.waitForTimeout(1200);
    const progresoGuardado=await p.evaluate(async()=>{const b=await import('/js/pdf/biblioteca.js');return (await b.listarDocumentos())[0].progreso;});
    const peticionesAntes=await p.evaluate(()=>({...window.pruebaPeticiones}));
    assert(progresoGuardado.caracter>0,'se guarda el avance al pasar página');
    await p.locator('#btnPdfBack').click();
    await p.locator('#pdfRejilla .pdf-libro-abrir').first().click(); await p.waitForTimeout(800);
    assert.equal(await p.locator('#pdfOutput').inputValue(),corregido,'reapertura conserva la corrección');
    assert((await medir()).desplazamiento>0,'reapertura retoma el texto guardado');
    assert(!(await p.locator('#btnPdfCortes').isVisible()),'reapertura mantiene cortes resueltos');
    assert.deepEqual(await p.evaluate(()=>window.pruebaPeticiones),peticionesAntes,'reabrir no vuelve a pagar la corrección');
    assert(!(await p.locator('#pdfReanudarCorreccion').isVisible()),'no reaparecen partes ya completadas');
    await p.locator('#btnPdfIndice').click(); assert(await p.locator('#pdfIndice').isVisible(),'índice accesible en escritorio');
    await p.locator('#btnPdfIndice').click();
    await despertarCromo(p); await puerta('#btnPdfMas', '#btnPdfBmOpciones').click();
    await p.locator('#pdfVincularInput').setInputFiles(pdf);
    await p.waitForTimeout(500);
    assert((await p.locator('#pdfNoticeLector').textContent()).includes('PDF original vinculado'),'vincular compara la huella del archivo');
    await p.keyboard.press('Escape');
  }
  console.log('OK:',nombre,'páginas, altura, navegación, apariencia y edición');
  await p.screenshot({path:join(destino,nombre+'.png')});
  await p.close();
 }
 const p=await navegador.newPage({viewport:{width:900,height:800}});
 await p.goto(process.env.JG_BASE || `http://127.0.0.1:${servidor.address().port}`);
 const largo=await p.evaluate(async()=>{
   const {initLibroVista}=await import('/js/pdf/libroVista.js');
   localStorage.setItem('jg_pdf_lectura',JSON.stringify({tam:19,inter:1.7,ancho:64,modoPagina:'paginas'}));
   const col=document.createElement('div'); col.className='pdf-texto-col'; col.style.cssText='position:fixed;inset:0 auto auto 0;width:500px;height:400px;display:flex;flex-direction:column;gap:8px';
   const art=document.createElement('article'); art.className='pdf-lectura';col.append(art);
   const nav=document.createElement('div');nav.style.height='44px';col.append(nav);document.body.append(col);
   const texto='Una palabra completa conserva su lugar en este párrafo extenso. '.repeat(100);
   const vista=initLibroVista({el:{lectura:art,textoCol:col,paginacion:nav},estado:{parteActual:0,partes:[{texto}]},api:{textoDeParte:()=>texto}});
   vista.renderLectura();await new Promise(r=>setTimeout(r,100));
   vista.irAPagina(2,{suave:false}); const ancla=vista.caracterVisible();
   const antes=vista.estadoPaginas(); vista.irAPagina(0,{suave:false});vista.irACaracter(ancla);
   const despues=vista.estadoPaginas();
   col.style.width='380px'; await new Promise(r=>setTimeout(r,150));
   const redimensionada=vista.estadoPaginas();
   return {ancla,antes,despues,redimensionada,integro:art.textContent===texto.trimEnd()};
 });
 assert(largo.ancla>0,'párrafo largo tiene ancla dentro del párrafo');
 assert.equal(largo.antes.actual,largo.despues.actual,'restaurar carácter dentro de un párrafo largo');
 assert(largo.redimensionada.actual>0,'redimensionar conserva el lugar en párrafo largo');
 assert(largo.integro,'paginación conserva todo el párrafo');
 console.log('OK: párrafo largo, restauración por carácter y cambio de ancho');await p.close();
} finally { await navegador.close(); servidor.close(); }
