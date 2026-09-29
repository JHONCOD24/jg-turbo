import { readFileSync, existsSync } from 'node:fs';

const raiz = new URL('../extension-udemy/', import.meta.url);
let ok = 0;
let fallos = 0;

function comprobar(condicion, mensaje) {
  if (condicion) {
    ok++;
    console.log(`OK: ${mensaje}`);
  } else {
    fallos++;
    console.error(`FALLO: ${mensaje}`);
  }
}

function leer(ruta) {
  const archivo = new URL(ruta, raiz);
  return existsSync(archivo) ? readFileSync(archivo, 'utf8') : '';
}

const manifiestoTexto = leer('manifest.json');
let manifiesto = {};
try { manifiesto = JSON.parse(manifiestoTexto); } catch { /* La comprobacion informa el fallo. */ }
comprobar(manifiesto.manifest_version === 3, 'manifiesto MV3 valido');
comprobar(JSON.stringify(manifiesto.permissions) === JSON.stringify(['sidePanel', 'storage', 'webRequest']), 'permisos exactos');
comprobar(JSON.stringify(manifiesto.host_permissions) === JSON.stringify([
  'https://www.udemy.com/*', 'https://*.udemycdn.com/*', 'https://jg-turbo.vercel.app/*',
]), 'origenes permitidos exactos');
comprobar(!('web_accessible_resources' in manifiesto), 'sin recursos detectables por la pagina');
comprobar(manifiesto.content_scripts?.[0]?.world !== 'MAIN', 'script aislado');
comprobar(manifiesto.content_scripts?.[0]?.all_frames !== true, 'diagnostico inicial en documento principal');
comprobar(manifiesto.side_panel?.default_path === 'panel.html', 'panel lateral declarado');

const fondo = leer('fondo.js');
const puente = leer('udemy.js');
const panel = leer('panel.html');
const control = leer('panel.js');
const guia = leer('LEEME.md');
comprobar(fondo.includes('webRequest.onCompleted') && fondo.includes('storage.session'), 'observador pasivo de VTT');
comprobar(!/document\.cookie|localStorage|chrome\.cookies|Authorization/i.test(fondo + puente + control), 'diagnostico sin credenciales');
comprobar(!/fetch\s*\(|XMLHttpRequest|captureStream|MediaRecorder/.test(fondo + puente + control), 'diagnostico sin peticiones propias ni captura');
comprobar(!/\.click\s*\(|dispatchEvent|history\.|location\s*=/.test(puente), 'puente sin clics ni navegacion');
comprobar(puente.includes('textTracks') && puente.includes("'hidden'") && puente.includes('2000'), 'pistas observadas durante dos segundos');
comprobar(puente.includes('finally') && puente.includes('pista.mode = anterior'), 'modo de pista restaurado');
comprobar(puente.includes('querySelectorAll') && puente.includes('iframe'), 'videos e iframes contados');
comprobar(panel.includes('Diagnóstico de esta clase') && panel.includes('Copiar diagnóstico'), 'acciones visibles en panel');
comprobar(control.includes('navigator.clipboard.writeText') && control.includes('JSON.stringify'), 'diagnostico copiable como JSON');
comprobar(guia.includes('chrome://extensions') && guia.includes('Cargar descomprimida'), 'instalacion documentada');
comprobar(!/console\.(?:log|info|debug)\s*\(/.test(fondo), 'URL firmada nunca se registra en consola');

console.log(`\n${ok} comprobaciones OK · ${fallos} fallos`);
if (fallos) process.exitCode = 1;
