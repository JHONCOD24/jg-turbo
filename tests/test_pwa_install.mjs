import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const AQUI = dirname(fileURLToPath(import.meta.url));
const RAIZ = resolve(AQUI, '..');

let fallos = 0;
function comprobar(cond, desc){
  if(cond){
    console.log(`  ✓ ${desc}`);
  }else{
    console.error(`  ✗ FALLO: ${desc}`);
    fallos++;
  }
}

console.log('── Verificando Archivos de Iconos PWA ──');
comprobar(existsSync(resolve(RAIZ, 'icon-192.png')), 'icon-192.png existe');
comprobar(existsSync(resolve(RAIZ, 'icon-512.png')), 'icon-512.png existe');
comprobar(existsSync(resolve(RAIZ, 'icon-maskable-192.png')), 'icon-maskable-192.png existe');
comprobar(existsSync(resolve(RAIZ, 'icon-maskable-512.png')), 'icon-maskable-512.png existe');

console.log('\n── Verificando manifest.webmanifest ──');
const manifestStr = readFileSync(resolve(RAIZ, 'manifest.webmanifest'), 'utf-8');
const manifest = JSON.parse(manifestStr);
comprobar(manifest.name.startsWith('JG Turbo'), 'name empieza por JG Turbo');
comprobar(manifest.short_name === 'JG Turbo', 'short_name es JG Turbo');
comprobar(manifest.display === 'standalone', 'display es standalone');
comprobar(manifest.start_url.startsWith('/'), 'start_url es / o relativo a /');

const icons = manifest.icons || [];
const has192 = icons.some(i => i.sizes === '192x192' && i.src === '/icon-192.png');
const has512 = icons.some(i => i.sizes === '512x512' && i.src === '/icon-512.png');
const hasMask192 = icons.some(i => i.sizes === '192x192' && i.purpose === 'maskable');
const hasMask512 = icons.some(i => i.sizes === '512x512' && i.purpose === 'maskable');

comprobar(has192, 'Manifest incluye /icon-192.png (192x192)');
comprobar(has512, 'Manifest incluye /icon-512.png (512x512)');
comprobar(hasMask192, 'Manifest incluye icono maskable 192x192');
comprobar(hasMask512, 'Manifest incluye icono maskable 512x512');

console.log('\n── Verificando UI e Integración en index.html y sw.js ──');
const html = readFileSync(resolve(RAIZ, 'index.html'), 'utf-8');
comprobar(html.includes('id="btnInstallApp"'), 'index.html contiene #btnInstallApp');
comprobar(html.includes('id="btnInstallAppLabel">Descargar app</span>'), 'index.html tiene label "Descargar app"');
comprobar(html.includes('id="installAppModal"'), 'index.html contiene #installAppModal');
comprobar(html.includes('id="btnSettingsInstallApp"'), 'index.html contiene botón de instalación en Configuración');
comprobar(html.includes('id="btnModalTriggerInstall"'), 'index.html contiene botón de disparo en el modal');

const sw = readFileSync(resolve(RAIZ, 'sw.js'), 'utf-8');
comprobar(sw.includes("'/icon-192.png'") && sw.includes("'/icon-512.png'"), 'sw.js precachea los iconos 192 y 512');

console.log(fallos ? `\n❌ ${fallos} FALLO(S)` : '\n✅ Verificación de PWA e instalación completada con éxito.');
process.exit(fallos ? 1 : 0);
