/* Estado de Groq en móvil: «comprobando» nunca se presenta como «falta clave».
 * Simula el dominio de Vercel sobre un servidor local para ejecutar el mismo
 * camino de producción sin depender de una clave ni exponerla.
 */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, join, extname } from 'node:path';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';

const app = resolve(import.meta.dirname, '..');
const { chromium } = await import(pathToFileURL(resolve(app, '../JG Turbo_OLD/node_modules/playwright/index.mjs')));
const tipos = { '.html':'text/html', '.js':'text/javascript', '.mjs':'text/javascript', '.json':'application/json', '.svg':'image/svg+xml' };
let demorarSalud = true;

const servidor = createServer(async (req, res) => {
  const ruta = new URL(req.url, 'http://local').pathname;
  if (ruta === '/api/health') {
    if (demorarSalud) await new Promise((r) => setTimeout(r, 900));
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ status:'ok', model:'whisper-large-v3', model_state:'listo', model_ready:true,
      groq_configured:true, ia_configured:true, ai_configured:true, ai_provider_server:'mistral' }));
    return;
  }
  if (ruta === '/api/ping') {
    res.setHeader('Content-Type', 'application/json'); res.end('{"status":"ok"}'); return;
  }
  if (ruta === '/api/session-config') {
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ token:'test', groq_configured:true, ia_configured:true, ai_configured:true }));
    return;
  }
  if (ruta === '/api/glossary') {
    res.setHeader('Content-Type', 'application/json'); res.end('{"glossary":""}'); return;
  }
  try {
    const archivo = join(app, ruta === '/' ? 'index.html' : ruta);
    res.setHeader('Content-Type', tipos[extname(archivo)] || 'application/octet-stream');
    res.end(await readFile(archivo));
  } catch { res.writeHead(404).end(); }
});

await new Promise((r) => servidor.listen(0, '127.0.0.1', r));
const puerto = servidor.address().port;
const navegador = await chromium.launch();
try {
  const pagina = await navegador.newPage({ viewport:{ width:390, height:844 } });
  /* `.localhost` resuelve a loopback; el nombre conserva `vercel.app` para
     activar exactamente el estado de nube del frontend, sin HSTS de Vercel. */
  await pagina.goto(`http://jg-vercel.app.localhost:${puerto}/`);
  await pagina.waitForTimeout(150);
  assert.equal(await pagina.locator('#jgCloudKeyBanner').isVisible(), false,
    'durante la comprobación no aparece una falsa falta de clave');
  assert(!/Falta clave Groq/i.test(await pagina.locator('#serverTxt').textContent()),
    'el indicador no confunde comprobando con falta de clave');

  await pagina.waitForFunction(() => /Whisper whisper-large-v3/i.test(document.querySelector('#serverTxt')?.textContent || ''));
  assert.equal(await pagina.locator('#jgCloudKeyBanner').isVisible(), false,
    'con Groq configurado en servidor no pide una clave del teléfono');
  assert(!/Falta clave Groq/i.test(await pagina.locator('#serverTxt').textContent()));
  console.log('OK: Groq configurado en Vercel no genera avisos falsos durante ni después de comprobar.');

  demorarSalud = false;
  await pagina.evaluate(() => checkServer());
  await pagina.waitForTimeout(150);
  assert(!/Verificando/i.test(await pagina.locator('#serverTxt').textContent()),
    'la actualización en segundo plano no hace parpadear el estado');
  console.log('OK: la comprobación periódica conserva el estado visible estable.');
} finally {
  await navegador.close();
  servidor.close();
}
