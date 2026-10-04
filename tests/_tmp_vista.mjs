import { cargarChromium, iniciarServidor, carpetaTemporal, crearLibroNarrativo, abrirLector } from './_paso.mjs';
import { join } from 'node:path';
const SP = 'C:/Users/juanl/AppData/Local/Temp/claude/C--Users-juanl-Documents-Proyectos-jg-turbo--claude-worktrees-jg-turbo-director-setup-5037ac/70825cd5-893c-4f29-8842-bc4cfaea3877/scratchpad';
const chromium = await cargarChromium();
const { servidor, base } = await iniciarServidor();
const t = await carpetaTemporal();
const ruta = join(t, 'l.pdf'); crearLibroNarrativo(ruta, 6);
const nav = await chromium.launch();
for (const [tema, dir] of [['papel', 1], ['noche', -1]]) {
  const { p } = await abrirLector(nav, base, ruta, { tactil: true, init: `try{localStorage.setItem('jg_pdf_tema','${tema}')}catch(_){}` });
  await p.evaluate(() => document.body.classList.add('jg-inmersivo'));
  await p.waitForTimeout(600);
  if (dir < 0) { await p.evaluate(() => document.getElementById('btnPdfPagNext').click()); await p.waitForTimeout(900); await p.evaluate(() => document.getElementById('btnPdfPagNext').click()); await p.waitForTimeout(900); }
  for (const prog of [0, 0.35, 0.7]) {
    await p.evaluate((d) => { document.getElementById(d > 0 ? 'btnPdfPagNext' : 'btnPdfPagPrev').click(); }, dir);
    await p.evaluate((pr) => { document.getAnimations().forEach((a) => { a.pause(); a.currentTime = pr * 340; }); }, prog);
    await p.waitForTimeout(80);
    await p.screenshot({ path: `${SP}/hoja-${tema}-${String(prog).replace('.', '')}.png` });
    await p.evaluate(() => { document.getAnimations().forEach((a) => a.finish()); });
    await p.waitForTimeout(500);
    await p.evaluate((d) => { document.getElementById(d > 0 ? 'btnPdfPagPrev' : 'btnPdfPagNext').click(); }, dir);
    await p.waitForTimeout(700);
  }
}
await nav.close(); servidor.close();
