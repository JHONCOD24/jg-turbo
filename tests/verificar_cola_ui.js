async page => {
  const out = {};
  await page.addInitScript(() => {
    try { localStorage.setItem('jg_pdf_consent_skip', '0'); } catch (_) {}
  });
  await page.goto('http://127.0.0.1:8765/', { waitUntil: 'domcontentloaded', timeout: 25000 });
  await page.waitForSelector('#tabPdf', { timeout: 12000 });
  await page.click('#tabPdf');
  await page.waitForSelector('#panelPdf', { timeout: 8000 });

  const htmlFuente = await page.evaluate(async () => (await fetch('/')).text());
  out.ui = await page.evaluate(() => {
    const hoja = document.getElementById('pdfAuditoriaHoja');
    return {
      reanudarBtn: !!document.getElementById('btnPdfReanudarCorreccion'),
      reanudarCaja: !!document.getElementById('pdfReanudarCorreccion'),
      reanudarHidden: document.getElementById('pdfReanudarCorreccion')?.hidden === true,
      textoReanudar: (document.getElementById('btnPdfReanudarCorreccion')?.textContent || '').trim(),
      consentimiento: (document.getElementById('pdfAuditoriaTitulo')?.textContent || '').trim(),
      explicaLibro: (hoja?.innerText || '').includes('Libro corregido'),
      explicaReanudar: (hoja?.innerText || '').includes('Reanudar corrección'),
    };
  });
  out.ui.v238 = htmlFuente.includes('v2.38.0') && htmlFuente.includes("JG_JS_V = 'v77'");

  out.cola = await page.evaluate(async () => {
    const mod = await import('/js/pdf/colaCorreccion.js?v=v77');
    const partes = Array.from({ length: 6 }, (_, i) => ({
      titulo: `P${i + 1}`,
      texto: `Habia una vez un pueblo ${i + 1} donde la gente leia en voz alta.`,
    }));
    const cola = mod.crearColaDesdePartes(partes);
    const pulir = (t) => t.replace(/^h/, 'H').replace(/\.$/, '') + '.';
    await mod.correrCola(cola, {
      pedir: async (item) => {
        if (item.parte === 2) {
          const e = new Error('failed to fetch');
          e.causa = 'red';
          throw e;
        }
        return { texto: pulir(item.texto), ia_used: true };
      },
    });
    const et1 = mod.etiquetaColaCorreccion(cola);
    const snap = JSON.parse(JSON.stringify(mod.serializarCola(cola)));
    const rec = mod.hidratarCola(snap, partes);
    mod.prepararReanudacion(rec);
    const pedidos2 = [];
    await mod.correrCola(rec, {
      pedir: async (item) => {
        pedidos2.push(item.parte);
        return { texto: pulir(item.texto), ia_used: true };
      },
    });
    return {
      et1,
      noLibroAMitad: !String(et1).includes('Libro corregido'),
      et2: mod.etiquetaColaCorreccion(rec),
      completa: mod.resumenCola(rec).lista,
      pendientes: mod.resumenCola(rec).pendientes,
      noRepite: pedidos2.length > 0 && !pedidos2.includes(0) && pedidos2.includes(2),
    };
  });

  await page.setViewportSize({ width: 390, height: 844 });
  out.movil = await page.evaluate(() => ({
    btn: !!document.getElementById('btnPdfReanudarCorreccion'),
    texto: (document.getElementById('btnPdfReanudarCorreccion')?.textContent || '').trim(),
    tabPdf: !!document.getElementById('tabPdf'),
  }));

  const fallos = [];
  if (!out.ui.reanudarBtn) fallos.push('falta botón Reanudar');
  if (out.ui.textoReanudar !== 'Reanudar corrección') fallos.push('texto del botón');
  if (!out.ui.reanudarHidden) fallos.push('el banner no nace oculto');
  if (out.ui.consentimiento !== 'Corregir cortes y puntuación del libro') fallos.push('título consentimiento');
  if (!out.ui.explicaLibro) fallos.push('consentimiento sin Libro corregido');
  if (!out.ui.explicaReanudar) fallos.push('consentimiento sin Reanudar');
  if (!out.ui.v238) fallos.push('falta marcador v2.38.0');
  if (!out.cola.noLibroAMitad) fallos.push('dijo Libro corregido a mitad: ' + out.cola.et1);
  if (out.cola.et2 !== 'Libro corregido') fallos.push('etiqueta final: ' + out.cola.et2);
  if (!out.cola.completa || out.cola.pendientes !== 0) fallos.push('cola en navegador no terminó');
  if (!out.cola.noRepite) fallos.push('tras recarga no reanudó solo lo pendiente');
  if (!out.movil.btn || out.movil.texto !== 'Reanudar corrección') fallos.push('móvil sin botón');
  out.ok = fallos.length === 0;
  out.fallos = fallos;
  if (!out.ok) throw new Error('UI cola: ' + fallos.join('; '));
  return out;
}
