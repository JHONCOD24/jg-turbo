/* Prueba ciega A/B de velocidad (P1.4 del plan 2026-09-29, P0 del dueño).
 *
 * El dueño escucha a 1,1× y a más de 1,5× todos los días y la voz «parece
 * dividir la palabra en sílabas». Hipótesis: la voz se genera siempre a 1× y
 * el navegador la estira con playbackRate, y ese estiramiento mete artefactos.
 * El servidor, en cambio, ya sabe generar a velocidad (Fish: prosody.speed;
 * Azure: SSML rate; Edge: rate): el cliente siempre le pide 1.
 *
 * Este script genera 5 pasajes en dos versiones cada uno, con la API real de
 * producción y la misma voz nativa (Salomé, es-CO, sin Fish para que las dos
 * versiones salgan del mismo motor):
 *   - «servidor»: generada a 1,5× por el servidor (suena a 1,5× tal cual).
 *   - «navegador»: generada a 1× y estirada a 1,5× por quien la reproduce.
 *
 * Salida en tests/fixtures/ab_velocidad/: p{N}_{a,b}.mp3 (orden ciego por
 * par), pares.js (tasas de reproducción, sin revelar el origen) y
 * origen_pares_NO_ABRIR.json (el secreto: NO abrirlo hasta votar).
 *
 * La escucha va en tests/ab_velocidad.html: cada par suena dos veces a 1,5×
 * y el dueño vota sin saber cuál es cuál. Si gana la del servidor, se hace
 * P1.5 (pedir la velocidad al servidor desde 1,1×); si no, se deja el
 * estiramiento y se cierra P1.4 con el veredicto.
 *
 * Ejecutar: node tests/ab_velocidad.mjs
 * Costo: 10 síntesis neurales cortas (cuota gratuita de Azure F0).
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const AQUI = dirname(fileURLToPath(import.meta.url));
const DESTINO = join(AQUI, 'fixtures', 'ab_velocidad');
const API = 'https://jg-turbo.vercel.app/api/tts';

/* 5 pasajes fijos (~350-500 letras): oración larga, título, lista, diálogo,
 * número y sigla. Español de Colombia, con tildes. */
const PASAJES = [
  `La persuasión no empieza cuando abres la boca, porque la mente de quien te escucha ya decidió hace rato si confía en ti, aunque todavía no sepa por qué. Lo que dices después solo confirma una corazonada que nació en los primeros segundos, mientras sonreías, saludabas y buscabas dónde sentarte.`,
  `Capítulo tres: la atención es un faro. En medio del ruido, la mente solo ilumina una cosa a la vez. Quien aprende a mover ese faro con calma, sin pelear contra la oscuridad, descubre que concentrarse no es forzar los ojos, sino elegir con suavidad dónde mirar.`,
  `Para ordenar la mañana necesitas tres cosas. Primera: una lista corta, de tres tareas como máximo, escrita antes de abrir el teléfono. Segunda: una hora sin interrupciones, con la puerta cerrada y el ruido apagado. Tercera: un descanso real de diez minutos, caminando, sin pantalla.`,
  `—¿De verdad crees que va a funcionar? —preguntó ella, mirando el tablero lleno de notas. —No lo creo —dijo él, sonriendo—. Lo sé. Lo probamos tres veces esta semana y las tres veces el cliente dijo que sí antes del minuto dos.`,
  `En 2024, la ONU publicó que el 45 por ciento de la región ya compra por internet. El informe, de 120 páginas, costó 2 años y lo firmaron 14 autores de 6 países. La conclusión cabe en una línea: la confianza, no el precio, decide quién vende.`,
];

async function sintetizar(texto, rate) {
  const cuerpo = {
    text: texto,
    voice: 'female',
    rate,
    language: 'es',
    locale: 'es-CO',
    tone: 'neutral',
    unified: false,
    idioma_fijo: true,
    source: 'pdf',
    prefer_fish: false,
    fish_voice: '',
  };
  for (let intento = 1; intento <= 3; intento += 1) {
    const resp = await fetch(API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(cuerpo),
    });
    if (resp.ok) {
      const buf = Buffer.from(await resp.arrayBuffer());
      return {
        audio: buf,
        voz: resp.headers.get('X-TTS-Voice') || '',
        motor: resp.headers.get('X-TTS-Engine') || '',
      };
    }
    console.log(`  intento ${intento}: ${resp.status} ${await resp.text().catch(() => '')}`.slice(0, 120));
    await new Promise((r) => setTimeout(r, 3000 * intento));
  }
  throw new Error(`la API no devolvió audio para rate=${rate}`);
}

mkdirSync(DESTINO, { recursive: true });
const pares = [];
const secreto = [];
for (let i = 0; i < PASAJES.length; i += 1) {
  const n = i + 1;
  console.log(`Pasaje ${n}/5: generando versión servidor (1,5× nativo)…`);
  const serv = await sintetizar(PASAJES[i], 1.5);
  console.log(`  ${serv.audio.length} bytes · ${serv.voz} · ${serv.motor}`);
  console.log(`Pasaje ${n}/5: generando versión navegador (1× para estirar)…`);
  const nav = await sintetizar(PASAJES[i], 1.0);
  console.log(`  ${nav.audio.length} bytes · ${nav.voz} · ${nav.motor}`);
  if (serv.voz !== nav.voz) {
    console.log(`  AVISO: las voces difieren (${serv.voz} frente a ${nav.voz}); la comparación pierde fuerza.`);
  }
  /* Orden ciego por par: a/b se sortean, las tasas viajan aparte. */
  const servidorEsA = Math.random() < 0.5;
  writeFileSync(join(DESTINO, `p${n}_a.mp3`), servidorEsA ? serv.audio : nav.audio);
  writeFileSync(join(DESTINO, `p${n}_b.mp3`), servidorEsA ? nav.audio : serv.audio);
  pares.push({ par: n, a: `p${n}_a.mp3`, tasaA: servidorEsA ? 1.0 : 1.5, b: `p${n}_b.mp3`, tasaB: servidorEsA ? 1.5 : 1.0 });
  secreto.push({ par: n, a: servidorEsA ? 'servidor' : 'navegador', b: servidorEsA ? 'navegador' : 'servidor' });
  console.log(`  par ${n}: A y B guardados (origen oculto).`);
}
writeFileSync(
  join(DESTINO, 'pares.js'),
  `/* Tasas de reproducción (SIN el origen: no revela cuál es cuál). */\nwindow.AB_PARES = ${JSON.stringify(pares, null, 2)};\n`,
);
writeFileSync(join(DESTINO, 'origen_pares_NO_ABRIR.json'), `${JSON.stringify(secreto, null, 2)}\n`);
console.log('\nListo. Abre tests/ab_velocidad.html en el navegador, escucha cada par a 1,5× y vota.');
console.log('NO abras origen_pares_NO_ABRIR.json hasta votar los 5 pares.');
