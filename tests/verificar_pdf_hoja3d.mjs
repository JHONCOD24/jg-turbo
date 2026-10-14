/* Comprueba curvatura y reverso, no solo que exista una animación. */
import { cargarChromium, iniciarServidor, carpetaTemporal, abrirLector, comprobar, cerrarPrueba, APP } from './_paso.mjs';
import { join } from 'node:path';
import { mkdir } from 'node:fs/promises';
import { crearLibro } from './generarPdfPrueba.mjs';
const wk = process.argv.includes('--webkit');
const motor = wk ? (await import('playwright')).webkit : await cargarChromium();
const { servidor, base } = await iniciarServidor();
const browser = await motor.launch();
const tmp = await carpetaTemporal();
const pdf = join(tmp,'hoja.pdf'); crearLibro(pdf,34);
const destino = join(APP,'.playwright-cli','hoja3d'); await mkdir(destino,{recursive:true});
const perfiles = wk ? [[390,844,1],[844,390,1]] : [[390,844,1],[844,390,1],[390,844,4]];
async function abrirTextoWebKit(ancho,alto){
  // WebKit/Windows no guarda Blob en IndexedDB en este entorno. Esta prueba
  // aísla el renderizador, sin modificar ni simular el almacén de la app.
  const contexto=await browser.newContext({viewport:{width:ancho,height:alto},hasTouch:true,isMobile:true,serviceWorkers:'block'});
  const p=await contexto.newPage();const errores=[];p.on('pageerror',e=>errores.push(String(e)));
  await p.goto(base);
  await p.evaluate(async()=>{
    localStorage.setItem('jg_pdf_tema','papel');
    const b=await import('/js/pdf/biblioteca.js');
    const frase='Aquella mañana, el camino estaba cubierto por una niebla espesa. Nadie del pueblo se atrevía a salir de su casa. El viajero guardó sus cartas y continuó hacia la plaza.';
    const partes=[1,2,3].map(n=>({titulo:`CAPITULO ${n}`,texto:`CAPITULO ${n}\n\n`+Array.from({length:25},()=>frase).join('\n\n')}));
    await b.guardarDocumento({meta:{id:'hoja-webkit',titulo:'Prueba de renderizado 3D',estado:'sin-empezar'},partes});
  });
  await p.locator('#tabPdf').click();await p.locator('#pdfRejilla .pdf-libro').first().click();
  await p.locator('#pdfLectura p').first().waitFor();await p.waitForTimeout(1800);
  return{p,contexto,errores,cdp:null};
}
try {
  for(const [ancho,alto,cpu] of perfiles){
    const nombre=`${wk?'WebKit':'Chromium'} ${ancho}×${alto} CPU×${cpu}`;
    const {p,contexto,cdp,errores}=wk?await abrirTextoWebKit(ancho,alto):await abrirLector(browser,base,pdf,{ancho,alto,tactil:true,init:()=>localStorage.setItem('jg_pdf_tema','papel')});
    if(cpu>1)await cdp.send('Emulation.setCPUThrottlingRate',{rate:cpu});
    const copia=await p.evaluate(async()=>{
      const art=document.querySelector('#pdfLectura');const {copiarPaginaVisible}=await import('/js/pdf/hoja3d.js');
      const t=copiarPaginaVisible(art);const s=t.querySelector('span');
      const n=art.querySelector('h2,h3,p');const r=document.createRange();const w=document.createTreeWalker(n,NodeFilter.SHOW_TEXT);const txt=w.nextNode();
      const token=txt.textContent.match(/\S+/);r.setStart(txt,token.index);r.setEnd(txt,token.index+token[0].length);
      const rect=r.getBoundingClientRect(),box=art.getBoundingClientRect();
      const toca=q=>q.width>0&&q.right>box.left+.5&&q.left<box.right-.5&&q.bottom>box.top+.5&&q.top<box.bottom-.5;
      const textos=document.createTreeWalker(art,NodeFilter.SHOW_TEXT);let nodo,visible='';
      while((nodo=textos.nextNode())){
        r.selectNodeContents(nodo);if(![...r.getClientRects()].some(toca))continue;
        for(let i=0;i<nodo.length;){const c=String.fromCodePoint(nodo.textContent.codePointAt(i));r.setStart(nodo,i);r.setEnd(nodo,i+c.length);if(!/\s/u.test(c)&&[...r.getClientRects()].some(toca))visible+=c;i+=c.length;}
      }
      const copiado=[...t.querySelectorAll('span')].map(n=>n.textContent).join('').replace(/\s/gu,'');
      return {igual:s.textContent===token[0],dx:Math.abs(parseFloat(s.style.left)-(rect.left-box.left)),dy:Math.abs(parseFloat(s.style.top)-(rect.top-box.top)),nodos:t.children.length,capitulo:art.querySelectorAll('*').length,completo:visible===copiado,caracteres:visible.length};
    });
    comprobar(copia.igual&&copia.dx<.5&&copia.dy<.5,`${nombre}: copia el texto visible en su posición exacta`);
    comprobar(copia.completo,`${nombre}: conserva todos los caracteres visibles, sin añadir ni perder (${copia.caracteres})`);
    const acotada=await p.evaluate(async()=>{
      const {copiarPaginaVisible}=await import('/js/pdf/hoja3d.js');
      const a=document.createElement('article');a.style.cssText='position:fixed;left:-4000px;top:0;width:350px;height:560px;column-width:350px;column-gap:28px;overflow:hidden;font:19px/28px serif';
      const para=document.createElement('p');para.textContent='El papel se curva y conserva cada palabra del libro. '.repeat(2500);a.append(para);document.body.append(a);a.scrollLeft=378*5;
      const original=Range.prototype.getClientRects;let consultas=0;
      Range.prototype.getClientRects=function(){consultas++;return original.call(this)};
      try{const t=copiarPaginaVisible(a);return{consultas,nodos:t.children.length,caracteres:para.textContent.length};}
      finally{Range.prototype.getClientRects=original;a.remove();}
    });
    comprobar(acotada.consultas<700&&acotada.nodos>20&&acotada.nodos<300,`${nombre}: un párrafo de ${acotada.caracteres} caracteres solo mide la página visible (${acotada.consultas} consultas)`);
    const imagen=await p.evaluate(async()=>{
      const {copiarPaginaVisible}=await import('/js/pdf/hoja3d.js');
      const a=document.createElement('article');a.style.cssText='position:fixed;left:-4000px;top:0;width:350px;height:560px;overflow:hidden';
      const f=document.createElement('figure');f.style.margin='0';const img=document.createElement('img');
      img.src='data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="100" height="50"><rect width="100" height="50" fill="blue"/></svg>');
      img.style.cssText='width:140px;height:70px;object-fit:contain';f.append(img);a.append(f);document.body.append(a);await img.decode();
      const c=copiarPaginaVisible(a).querySelector('img');const r=img.getBoundingClientRect();const resultado=!!c&&c.src===img.src&&parseFloat(c.style.width)===r.width&&parseFloat(c.style.height)===r.height&&c.style.objectFit==='contain';a.remove();return resultado;
    });
    comprobar(imagen,`${nombre}: la hoja conserva la imagen visible y su proporción`);
    const antes=await p.evaluate(()=>({...window.__jgPaginas()}));
    const caja=await p.locator('#pdfLectura').boundingBox();const x=caja.x+caja.width*.95,y=caja.y+caja.height*.5;
    await p.evaluate(({x,y})=>{const art=document.querySelector('#pdfLectura');window.inicioGesto={x,y};art.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,pointerId:31,pointerType:'touch',clientX:x,clientY:y}));},{x,y});
    for(const progreso of [.01,.15,.3,.5,.7]){
      await p.evaluate(({x,y})=>document.querySelector('#pdfLectura').dispatchEvent(new PointerEvent('pointermove',{bubbles:true,pointerId:31,pointerType:'touch',clientX:x,clientY:y})),{x:x-caja.width*progreso,y});
      if(progreso>=.15)await p.screenshot({path:join(destino,`${wk?'webkit':'chromium'}-${ancho}-${cpu}-${progreso}.png`)});
      if(progreso===.5){
        const m=await p.evaluate(()=>{
          const h=document.querySelector('.lec-hoja');const tiras=[...h.querySelectorAll('.lec-hoja-tira')];
          const matrices=tiras.map(t=>new DOMMatrix(getComputedStyle(t).transform));
          return{n:tiras.length,curva:Math.max(...matrices.map(m=>m.m11))-Math.min(...matrices.map(m=>m.m11)),z:Math.max(...matrices.map(m=>m.m43)),frentes:matrices.some(m=>m.m11>0),reversos:matrices.some(m=>m.m11<0),fondo:getComputedStyle(h.querySelector('.lec-hoja-frente')).backgroundColor,caras:h.querySelectorAll('.lec-hoja-reverso').length,anims:document.querySelectorAll('.lec-hoja').length,altura:document.querySelector('#pdfLectura').getBoundingClientRect().height,actual:window.__jgPaginas().actual,fuente:h.querySelector('.lec-hoja-textura').children.length};
        });
        comprobar(m.n===10&&m.curva>.5,`${nombre}: hay diez tangentes diferentes, no un bloque rígido`);
        comprobar(m.z>80,`${nombre}: el papel se levanta en el eje Z (${m.z.toFixed(1)} px)`);
        comprobar(m.frentes&&m.reversos&&m.caras===10,`${nombre}: el pliegue presenta anverso y reverso`);
        comprobar(m.fondo.startsWith('rgb('),`${nombre}: el papel es opaco`);
        comprobar(m.anims===1&&m.actual===antes.actual&&Math.abs(m.altura-caja.height)<1,`${nombre}: el gesto no cambia la página lógica ni su altura`);
        comprobar(m.fuente<300,`${nombre}: la copia contiene solo la página visible (${m.fuente} elementos)`);
      }
    }
    // Cancelar sin cambiar de página ni dejar capas.
    await p.evaluate(({x,y})=>document.querySelector('#pdfLectura').dispatchEvent(new PointerEvent('pointercancel',{bubbles:true,pointerId:31,pointerType:'touch',clientX:x,clientY:y})),{x,y});
    await p.waitForTimeout(500);
    comprobar(await p.evaluate(()=>!document.querySelector('.lec-hoja')&&window.__jgPaginas().actual===0),`${nombre}: cancelar devuelve el papel y conserva la página`);
    // Avanzar y volver con interacción de teclado, con tiempo para terminar.
    await p.locator('#pdfLectura').focus();await p.keyboard.press('ArrowRight');await p.waitForTimeout(600);
    comprobar(await p.evaluate(()=>window.__jgPaginas().actual)===1,`${nombre}: avanzar termina en la página siguiente`);
    await p.keyboard.press('ArrowLeft');await p.waitForTimeout(600);
    comprobar(await p.evaluate(()=>window.__jgPaginas().actual)===0,`${nombre}: retroceder conserva navegación exacta`);
    // Cruce de capítulo: se observa la hoja con animaciones de giro en vivo.
    await p.evaluate(()=>{window.girosCapitulo=0;window.vigiaGiro=new MutationObserver(()=>{const h=document.querySelector('.lec-hoja');if(h&&h.getAnimations({subtree:true}).length)window.girosCapitulo++;});window.vigiaGiro.observe(document.querySelector('#pdfResultArea'),{subtree:true,attributes:true,childList:true});});
    const total=await p.evaluate(()=>window.__jgPaginas().total);
    for(let i=0;i<total-1;i++)await p.keyboard.press('ArrowRight');
    await p.waitForTimeout(550);await p.evaluate(()=>window.girosCapitulo=0);
    await p.keyboard.press('ArrowRight');await p.waitForTimeout(900);
    const siguiente=await p.evaluate(()=>({giros:window.girosCapitulo,actual:window.__jgPaginas().actual,cap:document.querySelector('#pdfNavPos').textContent}));
    comprobar(siguiente.giros>0&&siguiente.actual===0,`${nombre}: el cambio al capítulo siguiente también gira una hoja`);
    await p.evaluate(()=>window.girosCapitulo=0);await p.keyboard.press('ArrowLeft');await p.waitForTimeout(900);
    const vuelta=await p.evaluate(()=>({giros:window.girosCapitulo,pag:window.__jgPaginas()}));
    comprobar(vuelta.giros>0&&vuelta.pag.actual===vuelta.pag.total-1,`${nombre}: volver de capítulo gira y cae en su última página`);
    comprobar(errores.length===0,`${nombre}: sin errores JavaScript`,errores.join(';'));
    await contexto.close();
  }
}finally{await browser.close();servidor.close();}
cerrarPrueba('hoja 3D con curvatura y reverso');
