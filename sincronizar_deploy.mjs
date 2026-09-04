/**
 * Compara la carpeta de trabajo con el destino oficial de despliegue y, si se
 * le pide, iguala la segunda a la primera.
 *
 * Destino oficial: G:\Mi unidad\PROYECTS\JG Turbo\vercel_deploy\
 * Si esa carpeta no existe, el script FALLA: no se inventa otro destino.
 *
 *   node sincronizar_deploy.mjs             → solo informa (sale 1 si difieren)
 *   node sincronizar_deploy.mjs --aplicar   → copia los cambios al deploy
 *
 * Correrlo SIEMPRE antes de desplegar. Lo que no aparezca aquí no viaja.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ORIGEN = path.dirname(fileURLToPath(import.meta.url));
const DESTINO_OFICIAL = 'G:\\Mi unidad\\PROYECTS\\JG Turbo\\vercel_deploy\\';
const DESTINO = path.resolve(DESTINO_OFICIAL);
const APLICAR = process.argv.includes('--aplicar');

if (!fs.existsSync(DESTINO) || !fs.statSync(DESTINO).isDirectory()) {
  console.error(`No está el destino oficial de despliegue:\n  ${DESTINO}`);
  console.error('Sin esa carpeta no se sincroniza ni se despliega.');
  process.exit(2);
}

const enlaceVercel = path.join(DESTINO, '.vercel', 'project.json');
if (!fs.existsSync(enlaceVercel)) {
  console.error(`El destino no tiene enlace de Vercel:\n  ${enlaceVercel}`);
  process.exit(2);
}
let proyecto;
try {
  proyecto = JSON.parse(fs.readFileSync(enlaceVercel, 'utf8'));
} catch (error) {
  console.error('No se pudo leer el enlace de Vercel:', error.message);
  process.exit(2);
}
if (String(proyecto.projectName || '') !== 'jg-turbo') {
  console.error(`El enlace de Vercel no es jg-turbo (es «${proyecto.projectName || '?'}»).`);
  console.error('Abortado: un deploy desde aquí no actualizaría producción.');
  process.exit(2);
}

const SUELTOS = ['index.html', 'sw.js', 'manifest.webmanifest'];
const CARPETAS = ['js', 'api', 'tests'];
const EXTENSIONES = new Set([
  '.html', '.js', '.mjs', '.css', '.py', '.json', '.txt', '.webmanifest',
  '.wasm', '.traineddata',
]);
const SIN_EXTENSION_INCLUIDOS = /^LICENSE/i;
const IGNORAR = new Set(['__pycache__', 'node_modules', '.pytest_cache', '.impeccable', '.playwright-cli', 'private']);

const huella = (ruta) => crypto.createHash('md5').update(fs.readFileSync(ruta)).digest('hex');

function listar(base, relativa = '') {
  const actual = path.join(base, relativa);
  if (!fs.existsSync(actual)) return [];
  return fs.readdirSync(actual).flatMap((nombre) => {
    if (IGNORAR.has(nombre)) return [];
    const rel = relativa ? path.join(relativa, nombre) : nombre;
    const completa = path.join(base, rel);
    if (fs.statSync(completa).isDirectory()) return listar(base, rel);
    if (EXTENSIONES.has(path.extname(nombre))) return [rel];
    return SIN_EXTENSION_INCLUIDOS.test(nombre) ? [rel] : [];
  });
}

const archivos = new Set();
for (const suelto of SUELTOS) if (fs.existsSync(path.join(ORIGEN, suelto))) archivos.add(suelto);
for (const carpeta of CARPETAS) for (const rel of listar(ORIGEN, carpeta)) archivos.add(rel);

const nuevos = [];
const distintos = [];
const soloEnDeploy = [];

for (const rel of [...archivos].sort()) {
  const a = path.join(ORIGEN, rel);
  const b = path.join(DESTINO, rel);
  if (!fs.existsSync(b)) nuevos.push(rel);
  else if (huella(a) !== huella(b)) distintos.push(rel);
}
for (const carpeta of CARPETAS) {
  for (const rel of listar(DESTINO, carpeta)) {
    if (!archivos.has(rel)) soloEnDeploy.push(rel);
  }
}

const contar = (lista, titulo) => {
  if (!lista.length) return;
  console.log(`\n${titulo} (${lista.length}):`);
  lista.forEach((r) => console.log(`  ${r}`));
};

console.log(`origen:  ${ORIGEN}`);
console.log(`destino: ${DESTINO}`);
console.log(`proyecto Vercel: ${proyecto.projectName}`);

contar(nuevos, 'Solo en la carpeta de trabajo (faltan en el deploy)');
contar(distintos, 'Con contenido distinto');
contar(soloEnDeploy, 'Solo en el deploy (sobran o se borraron del trabajo)');

const pendientes = nuevos.length + distintos.length;
if (!pendientes && !soloEnDeploy.length) {
  console.log('Las dos carpetas están iguales. Nada que sincronizar.');
  process.exit(0);
}

if (!APLICAR) {
  console.log(`\n${pendientes} archivo(s) sin sincronizar.`);
  console.log('Para igualar el deploy:  node sincronizar_deploy.mjs --aplicar');
  if (soloEnDeploy.length) {
    console.log('Los «solo en el deploy» NO se borran solos: revísalos a mano.');
  }
  process.exit(1);
}

for (const rel of [...nuevos, ...distintos]) {
  const destino = path.join(DESTINO, rel);
  fs.mkdirSync(path.dirname(destino), { recursive: true });
  fs.copyFileSync(path.join(ORIGEN, rel), destino);
  console.log(`copiado: ${rel}`);
}
console.log(`\n${pendientes} archivo(s) copiados al deploy.`);
console.log('Ahora: sube CACHE_SHELL en sw.js, corre los tests y despliega.');
if (soloEnDeploy.length) console.log('Ojo: hay archivos solo en el deploy; se han dejado intactos.');
