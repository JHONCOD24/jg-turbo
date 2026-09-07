/* Prueba unitaria y de contrato: música de fondo en módulo PDF
 *   node tests/test_pdf_musica.mjs
 */
import assert from 'node:assert/strict';
import { statSync, existsSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  ANIMOS,
  CATALOGO_PISTAS,
  resolverAnimoSegunHora,
  musicaFondo,
} from '../js/pdf/musicaFondo.js';

const AQUI = dirname(fileURLToPath(import.meta.url));
const APP = resolve(AQUI, '..');

let totalComprobaciones = 0;
function comprobar(mensaje, condicion) {
  assert.ok(condicion, mensaje);
  totalComprobaciones++;
  console.log(`OK: ${mensaje}`);
}

console.log('── 1. Catálogo y archivos de audio de estudio ──');
comprobar('Los 4 ánimos requeridos están definidos',
  ANIMOS.concentracion && ANIMOS.relax && ANIMOS.noche && ANIMOS.lluvia);

comprobar('Hay exactamente 11 pistas en el catálogo (3 concentración, 4 relax, 2 noche, 2 lluvia)',
  CATALOGO_PISTAS.length === 11);

for (const animoId of Object.keys(ANIMOS)) {
  const pistasDelAnimo = CATALOGO_PISTAS.filter(p => p.animo === animoId);
  comprobar(`El ánimo "${animoId}" tiene al menos 2 pistas`, pistasDelAnimo.length >= 2);
}

for (const pista of CATALOGO_PISTAS) {
  const rutaFisica = resolve(APP, pista.src.replace(/^\//, ''));
  comprobar(`Existe el archivo físico de audio: ${pista.src}`, existsSync(rutaFisica));
  const st = statSync(rutaFisica);
  comprobar(`El archivo ${pista.id}.mp3 tiene peso válido (> 1 MB): ${Math.round(st.size / (1024 * 1024) * 100) / 100} MB`, st.size > 1000000);
}

console.log('── 2. Resolución de ánimo según hora del día ──');
const horaManana = new Date(2026, 8, 7, 10, 0, 0);
comprobar('A las 10:00 corresponde concentración', resolverAnimoSegunHora(horaManana) === 'concentracion');

const horaTarde = new Date(2026, 8, 7, 16, 30, 0);
comprobar('A las 16:30 corresponde relax', resolverAnimoSegunHora(horaTarde) === 'relax');

const horaNoche = new Date(2026, 8, 7, 23, 15, 0);
comprobar('A las 23:15 corresponde noche', resolverAnimoSegunHora(horaNoche) === 'noche');

const horaMadrugada = new Date(2026, 8, 7, 3, 0, 0);
comprobar('A las 03:00 corresponde noche', resolverAnimoSegunHora(horaMadrugada) === 'noche');

console.log('── 3. Estado, valores por defecto, aleatoriedad y límites ──');
// Reset preferences
musicaFondo.setActiva(false);
comprobar('Estado inicial apagado', musicaFondo.activa === false);

musicaFondo.setVolumenMusica(0.20);
comprobar('Volumen de música por defecto es 20%', Math.abs(musicaFondo.volumenMusica - 0.20) < 0.001);

musicaFondo.setVolumenVoz(1.0);
comprobar('Volumen de voz por defecto es 100%', Math.abs(musicaFondo.volumenVoz - 1.0) < 0.001);

musicaFondo.setVolumenMusica(1.5);
comprobar('Volumen de música no puede superar 1.0', musicaFondo.volumenMusica === 1.0);

musicaFondo.setVolumenMusica(-0.5);
comprobar('Volumen de música no puede bajar de 0.0', musicaFondo.volumenMusica === 0.0);

musicaFondo.setVolumenMusica(0.25);
comprobar('Ajuste fino de volumen de música a 25%', Math.abs(musicaFondo.volumenMusica - 0.25) < 0.001);

musicaFondo.setDucking(true);
comprobar('Ducking suave está activo por defecto', musicaFondo.duckingActivo === true);

musicaFondo.setAleatoria(true);
comprobar('Modo aleatorio activable', musicaFondo.aleatoria === true);

const siguienteAleatoria = musicaFondo.obtenerSiguienteAleatoria();
comprobar('obtenerSiguienteAleatoria devuelve una pista válida del catálogo', siguienteAleatoria && siguienteAleatoria.id && siguienteAleatoria.src);

musicaFondo.setAnimo('relax');
comprobar('Elegir ánimo activa la música y selecciona pista de relax', musicaFondo.activa === true && musicaFondo.animo === 'relax' && musicaFondo.pistaActual().animo === 'relax');

musicaFondo.setPista('concentracion_deep_work_flow');
comprobar('Elegir pista activa la música y asigna pista específica', musicaFondo.activa === true && musicaFondo.pistaId === 'concentracion_deep_work_flow');

musicaFondo.setActiva(false);
comprobar('setActiva(false) apaga la música', musicaFondo.activa === false);

console.log('── 4. Contrato HTML y accesibilidad ──');
const html = readFileSync(resolve(APP, 'index.html'), 'utf-8');

comprobar('index.html contiene el botón #btnPdfMusica', html.includes('id="btnPdfMusica"'));
comprobar('index.html contiene la hoja inferior #pdfMusicaHoja', html.includes('id="pdfMusicaHoja"'));
comprobar('index.html contiene el toggle #pdfMusicaAuto', html.includes('id="pdfMusicaAuto"'));
comprobar('index.html contiene el toggle #pdfMusicaAleatoria', html.includes('id="pdfMusicaAleatoria"'));
comprobar('index.html contiene el slider #pdfMusicaVolVoz', html.includes('id="pdfMusicaVolVoz"'));
comprobar('index.html contiene el slider #pdfMusicaVolMusica', html.includes('id="pdfMusicaVolMusica"'));
comprobar('index.html contiene el switch de ducking #pdfMusicaDucking', html.includes('id="pdfMusicaDucking"'));
comprobar('index.html contiene el contenedor #pdfMusicaPistasLista', html.includes('id="pdfMusicaPistasLista"'));

console.log('── 5. Contrato Service Worker ──');
const sw = readFileSync(resolve(APP, 'sw.js'), 'utf-8');
comprobar('sw.js cachea /audio/musica/ para funcionamiento offline', sw.includes('/audio/musica/'));

console.log(`\nTodo en verde: ${totalComprobaciones} comprobaciones OK, 0 fallos.`);
