# Plan de implementación · Doblar videos del equipo (archivos locales) al español

> **Para agentes:** SUB-SKILL REQUERIDA: usa `superpowers:subagent-driven-development` (recomendada) o
> `superpowers:executing-plans` para ejecutar este plan tarea por tarea. Los pasos usan casillas
> (`- [ ]`) para seguir el avance: márcalas solo después de correr el comando.

**Objetivo:** que en la pestaña **Videos** se pueda elegir (o soltar, o traer de la pestaña Archivo) un
video guardado en el teléfono o el computador y verlo doblado al español con el MISMO motor de YouTube y
X: voz, ritmo automático, subtítulo, «Texto completo», biblioteca y descargas MP3/MP4.

**Arquitectura:** el video nunca sale del equipo ni se copia a la app. El navegador saca su audio con
Mediabunny (ya vendorizado), lo recodifica a MP3 16 kHz mono 32 kbps en partes de 6 min (o lo copia sin
decodificar si el navegador no puede, p. ej. AC-3) y cada parte va al `/api/transcribe` de siempre
(Whisper de Groq, gratis). La transcripción por partes se extrae de `servicioX.js` a un módulo
compartido. El video se ve con `XVideoPlayer` (un `blob:` carga en su iframe). La caché y la biblioteca
usan la clave `archivo:<huella>`; reabrir pide el mismo archivo y la huella lo reconoce.

**Tecnología:** JavaScript ES (módulos en `js/youtube/`), Mediabunny 1.60.0 + `@mediabunny/mp3-encoder`
(en `js/vendor/mediabunny/`), IndexedDB `jg_youtube` v2 (sin versión nueva), Playwright para las pruebas
de navegador. **Sin dependencias nuevas** y **sin cambios en el servidor**.

**Documentos hermanos:** especificación `docs/superpowers/specs/2026-10-01-doblaje-video-local-design.md`
· mediciones `docs/video-local/MEDICIONES.md` (M1–M15) · brief de interfaz (impeccable)
`.impeccable/surfaces/js-youtube-youtubesynccontroller-js.md` · prompt del constructor
`PROMPT_AGENTE_VIDEO_LOCAL_DOBLAJE.md` · **parche verificado** `docs/video-local/doblaje-video-local.patch`.

---

## Cómo se validó este plan (léelo: te ahorra horas)

Todo el código de este plan se escribió y se ejecutó **antes** de entregártelo, sobre una copia
aislada del commit `c1374e2` (`git archive`), con estos resultados:

| Prueba | Línea base `main` | Con el plan |
|---|---:|---:|
| `node tests/test_archivo_doblaje.mjs` (nueva) | — | **65 OK** |
| `node tests/verificar_archivo_audio.mjs` (nueva, Chromium + Chrome) | — | **26 OK** |
| `node tests/verificar_archivo_doblaje.mjs` (nueva, punta a punta) | — | **38 OK** |
| `node tests/test_x_doblaje.mjs` | 70 | 70 |
| `node tests/verificar_x_doblaje.mjs` | 24 | 24 |
| `node tests/test_biblioteca_videos.mjs` | 100 | 100 |
| `node tests/verificar_biblioteca_datos.mjs` | 48 | 48 |
| `node tests/verificar_biblioteca_videos.mjs` | 52 | 52 |
| `node tests/test_youtube_doblaje.mjs` | 139 | 139 |
| `node tests/test_youtube_sincronia.mjs` | 74 | 74 |
| `node tests/verificar_youtube_doblaje.mjs` | 110 | 110 |
| `node tests/verificar_movil_pantalla.mjs` | 62 | 62 |
| `node tests/verificar_arranque_ligero.mjs` | 9 OK + 1 fallo previo (1 062 KB > 1 MB) | 9 OK + el mismo fallo (1 067 KB: +5 KB de marcado y CSS) |

El diff completo está en **`docs/video-local/doblaje-video-local.patch`** (15 archivos, aplica limpio
sobre `c1374e2`: `git apply --check` en verde). Cada tarea de abajo trae el mismo código. Si algo no te da
el número de la tabla, lo más probable es que el código se copió mal o que el repo cambió: compara con
el parche antes de «arreglar» el plan.

**Fin de línea:** desde `.gitattributes` (`* text=auto eol=lf`) los archivos están en **LF** en disco
(una memoria vieja del proyecto dice CRLF: ya no es así). No conviertas archivos enteros.

---

## Decisiones (no las reabras)

Del dueño (2026-10-01):

1. **El video NO se copia a la app.** Se guarda texto, traducción y voz; para volver a verlo se elige
   otra vez el archivo y la huella confirma que es el mismo.
2. **Descargas de un video del equipo: MP3 doblado y MP4 doblado.** Nunca «video original».

Del director (razonadas en la especificación §1): vive en la pestaña Videos; hasta **3 horas**;
**retomar** lo ya transcrito si Groq corta; formatos MP4/M4V/MOV/MKV/WebM; arrastrar y soltar en el
escritorio; puente desde la pestaña Archivo (y Compartir del celular).

## Hechos medidos (base de todas las decisiones)

Detalle, respuestas crudas y cómo repetir la medición: `docs/video-local/MEDICIONES.md`.

| # | Hecho | Consecuencia |
|---|---|---|
| M1 | WebCodecs solo existe en **contexto seguro** (https, `localhost`, `127.0.0.1`). | Pruebas servidas en `localhost`/`127.0.0.1`; nunca un host inventado. |
| M2 | Chrome decodifica AAC/Opus/H.264/VP9 con Mediabunny; **AC-3 no**. | Dos caminos: recodificar o copiar. |
| M3–M4 | 60 min de audio: copiar 0,6 s pero 51 MB; **MP3 16 kHz mono 32 kbps 16,7 s y 13,7 MB** (partes de 1,44 MB). | MP3 es el camino principal (cuida los datos del celular). |
| M6 | CPU 4× más lenta (teléfono): ~9 s por parte de 6 min. | Se avisa en la tarjeta de progreso; el video se puede ver mientras tanto. |
| M7 | `/api/transcribe` de producción aceptó MP3, Ogg/Opus, AAC (.m4a) y **AC-3 copiado en MP4** con tiempos por frase. | Copiar sirve de respaldo incluso para películas. |
| M8 | El servidor ya devuelve `language: "en"`. | Nada de traducir nombres de idioma en el cliente. |
| M9 | `computePacketStats()`: 0,21 s en 60 min. | Para copiar se dimensionan las partes con la tasa real + 15 %. |
| M10 | Huella SHA-256 de tamaño + 1 MiB inicial + 1 MiB final: 16 ms en 140 MB. | Clave estable sin leer el archivo entero (TRAMPAS §6.7). |
| M11–M12 | `<video>` reproduce MP4/MKV/MOV/WebM locales; un `blob:` carga dentro de `/x-reproductor.html`. | Se reutiliza `XVideoPlayer`. |
| M13 | Miniatura JPEG 320 px de un cuadro: ~6,6 KB. | Va como `data:` en la ficha de la biblioteca. |
| M14 | MP4 de salida acepta avc, hevc, vp9, av1, vp8, prores. | El MP4 doblado copia el video sin recodificar. |
| M15 | **El exportador fallaba con audio de 32 kHz** (AAC del navegador no lo acepta). | Se mezcla siempre a 44,1/48 kHz (Tarea 6). |

## Restricciones globales (valen para todas las tareas)

1. **El video nunca viaja al servidor ni se copia a IndexedDB/OPFS/Cache.** Solo viajan partes de
   audio de ≤ 3,2 MB (tope duro 4,2 MB). Vercel corta a los 60 s y rechaza ~4,5 MB por petición.
2. **Una sola puerta a `/api/transcribe` para el doblaje:** `subirParte` de `transcripcionPartes.js`
   (X y archivos). No escribas otra.
3. **X y YouTube no cambian de conducta.** Sus pruebas deben dar los números de la tabla. Las únicas
   ediciones permitidas en su camino son las de este plan (extracción mecánica de `servicioX`,
   opciones de `XVideoPlayer`, alias del exportador).
4. **Mediabunny se carga diferido** (`medios.js`, `import('./medioLocal.js')`): nunca al abrir la app
   (`verificar_arranque_ligero`, TRAMPAS «Un `import()` al arrancar no es carga diferida»).
5. **La base `jg_youtube` sigue en v2.** Nada de almacenes nuevos ni de subir la versión (TRAMPAS §7.2).
   El registro parcial vive dentro de `doblajes` y lo reemplaza `completarSesion`.
6. **Nada se pierde sin que el dueño lo pida:** `fusionarEntrada` sigue sin tocar `etiquetas` ni
   `favorito`.
7. **Texto ajeno = `textContent`/`escapar()`**: el nombre del archivo puede traer `<`, comillas o
   emojis.
8. **Ningún botón falla en silencio** (TRAMPAS): todo camino termina en acción o aviso visible.
9. **Diseño de subtítulos (`.yt-caption`) intocable.** Toques ≥ 44 px (usa 48 si el botón mide 44
   exactos: en densidad 2,625 da 43,99 px, medido), texto ≥ 13 px, sin desborde a 360 px.
10. **`.btn` está definido dos veces en `index.html`:** estiliza con el contenedor delante.
11. **Sin dependencias nuevas, sin cambios en `api/`, sin nada que cueste dinero.**
12. **Un despliegue, al final**, desde copia `git archive` del commit (AGENTS.md).

## Foco de revisión (lo que más puede morder a una persona real)

- **Gesto del usuario:** `input.click()` y `showSaveFilePicker` solo funcionan dentro del toque. Por eso
  reabrir desde la biblioteca abre el selector en el MISMO clic y devuelve `pendiente`; y el MP4 pide el
  original con su propio botón (dos gestos: elegir original, luego Descargar).
- **Memoria:** el archivo se lee por rangos (`BlobSource`); nunca `file.arrayBuffer()` del video.
- **Soltar el `input` de Mediabunny** (`actual.cerrarArchivo`) y **revocar el `blob:`** al cerrar la
  sesión: si no, el navegador retiene el archivo.
- **Retomar:** las partes guardadas solo valen con el mismo `trozoS` y el mismo idioma.
- **Teléfono:** el selector de archivos del celular, la memoria con videos de 1–4 GB y el sonido del
  `<video>` en iPhone: **solo se puede medir en el teléfono real** (Tarea 13).

## Mapa de archivos

| Archivo | Acción | Tarea |
|---|---|---|
| `js/youtube/transcripcionPartes.js` | crear | 1 |
| `js/youtube/servicioX.js` | modificar (extracción mecánica) | 1 |
| `js/youtube/archivoLocal.js` | crear | 2 |
| `js/youtube/servicioArchivo.js` | crear | 3 |
| `js/youtube/bibliotecaVideos.js`, `js/youtube/descargaDestino.js` | modificar | 4 |
| `js/youtube/medioLocal.js` | crear | 5 |
| `tests/fixtures/archivo/*` (4 videos) | copiar desde `docs/video-local/fixtures/` | 5 |
| `js/youtube/exportadorDoblaje.js` | modificar | 6 |
| `js/youtube/XVideoPlayer.js` | modificar | 7 |
| `index.html` | modificar (marcado, CSS, puente de Archivo) | 8 |
| `js/youtube/youtubeSyncController.js` | modificar | 9 |
| `js/youtube/bibliotecaVista.js` | modificar | 10 |
| `tests/test_archivo_doblaje.mjs` | crear (crece por secciones T1–T4) | 1–4 |
| `tests/verificar_archivo_audio.mjs` | crear | 5–6 |
| `tests/verificar_archivo_doblaje.mjs` | crear | 11 |
| `.gitignore` | excepción `!tests/fixtures/archivo/*.webm` | 5 |
| `CAMBIOS_VIDEO_LOCAL.md` (nuevo), `AGENTS.md`/`Agents.md`, `TRAMPAS.md`, `CONFIG_PERSISTENTE.md`, `PRODUCT.md`, `DOCUMENTACION_DESPLIEGUE.md`, `sw.js` | documentar y versionar | 12–13 |

---

## 0. Antes de empezar (obligatorio)

- [ ] **Paso 1: leer** `AGENTS.md` entero; `TRAMPAS.md` §1, §7 y las entradas «Un botón que falla en
  silencio es un botón roto», «Un `import()` al arrancar no es carga diferida», «Publicar en Vercel no
  es cerrar», «Un despliegue verificado puede estar sirviendo el código viejo», «Redesplegar sin subir
  `JG_JS_V`» y «`.pytest_cache` bloqueada tumba el despliegue entero»; la especificación y
  `docs/video-local/MEDICIONES.md`.
- [ ] **Paso 2: estado del repo.**

```bash
git status --short
git log --oneline -3
git rev-parse --short HEAD
```

Si `HEAD` no es `c1374e2`, mira `git log c1374e2..HEAD --stat -- js/youtube index.html`: si alguien
tocó esos archivos, aplica el parche con `git apply --3way` (o adapta a mano) y anótalo como desvío.
Si `index.html` o `js/youtube/*` tienen cambios **sin commitear** que no son tuyos, **para y pregunta**.
Nunca `git checkout --` sobre trabajo ajeno.

- [ ] **Paso 3: rama.**

```bash
git switch -c feat/video-local
```

- [ ] **Paso 4: línea base** (anota cada número; debe coincidir con la tabla de arriba):

```bash
node tests/test_x_doblaje.mjs
node tests/test_biblioteca_videos.mjs
node tests/test_youtube_doblaje.mjs
node tests/test_youtube_sincronia.mjs
node tests/verificar_x_doblaje.mjs
node tests/verificar_biblioteca_datos.mjs
node tests/verificar_biblioteca_videos.mjs
node tests/verificar_youtube_doblaje.mjs
node tests/verificar_movil_pantalla.mjs
node tests/verificar_arranque_ligero.mjs
```

- [ ] **Paso 5: comprobar que el parche aplica** (no lo apliques aún: cada tarea trae su parte).

```bash
git apply --check docs/video-local/doblaje-video-local.patch
```

> **Atajo permitido:** si prefieres, aplica el parche entero (`git apply docs/video-local/doblaje-video-local.patch`)
> y recorre las tareas como **verificación**: en cada una corre sus comandos, cuenta y commitea solo
> sus archivos. Lo que NO es opcional: correr cada prueba, contar las comprobaciones y hacer la
> contraprueba de la Tarea 11.

---

## Fase 1 · Piezas puras (Node, sin navegador)

### Tarea 1: `transcripcionPartes.js` — transcribir por partes, compartido con X

Saca de `servicioX.js` lo que no es de X (subir una parte, esperar ante «Límite de uso», 2 en vuelo,
la 1.ª parte fija el idioma, en español se para) a un módulo que también usarán los archivos. Añade
dos cosas que X no necesitaba: `previas` (partes ya transcritas que no se vuelven a pagar) y
`alTerminarParte` (para guardarlas a medida que llegan).

**Archivos:** crear `js/youtube/transcripcionPartes.js` · modificar `js/youtube/servicioX.js` · crear
`tests/test_archivo_doblaje.mjs` (cabecera + sección T1 + resumen).

- [ ] **Paso 1: escribir la prueba** `tests/test_archivo_doblaje.mjs` con la cabecera, la sección
  **T1** y el bloque «Resumen» (las secciones T2–T4 se añaden en sus tareas, antes del «Resumen»).
  El archivo completo, tal como queda al final de la Tarea 4, es este; en esta tarea copia solo
  cabecera + T1 + Resumen:

```js
// tests/test_archivo_doblaje.mjs
/* Doblaje de videos del equipo · funciones puras y servicio con dobles, sin red.
 * Ejecutar: node tests/test_archivo_doblaje.mjs
 * Cada tarea del PLAN_VIDEO_LOCAL_DOBLAJE_IMPLEMENTACION_LLM.md añade su sección
 * antes del «Resumen». Cuenta las comprobaciones: si bajan, algo se cortó.
 */
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const modulo = (nombre) => import(pathToFileURL(path.join(raiz, 'js/youtube', nombre)).href);

let ok = 0;
let fallos = 0;
function comprobar(condicion, mensaje) {
  if (condicion) { ok += 1; console.log(`OK: ${mensaje}`); }
  else { fallos += 1; console.error(`FALLO: ${mensaje}`); }
}
/** Un «File» de Node: Blob con nombre (File existe en Node 20+). */
const archivo = (bytes, nombre, tipo = 'video/mp4') => new File([bytes], nombre, { type: tipo });
const bytesDe = (n, semilla = 1) => Uint8Array.from({ length: n }, (_, i) => (i * 31 + semilla) % 251);

// ── T1: transcribir por partes (compartido con X) ───────────────────────
const tp = await modulo('transcripcionPartes.js');
{
  function api({ idiomas = [], respuestas = [] } = {}) {
    const subidas = [];
    let enVuelo = 0;
    let maxEnVuelo = 0;
    const fetchApi = async (_ruta, opciones = {}) => {
      if (opciones.signal?.aborted) throw new DOMException('Cancelado', 'AbortError');
      const n = subidas.length;
      subidas.push({ idioma: opciones.body.get('language'), nombre: opciones.body.get('file').name, fast: opciones.body.get('fast') });
      enVuelo += 1; maxEnVuelo = Math.max(maxEnVuelo, enVuelo);
      await new Promise((r) => setTimeout(r, 5));
      enVuelo -= 1;
      const forzada = respuestas[n];
      if (forzada) return forzada();
      return Response.json({ language: idiomas[n] ?? 'en', segments: [{ start: 1, end: 2, text: `Parte ${n + 1}.` }] });
    };
    return { subidas, fetchApi, maxEnVuelo: () => maxEnVuelo };
  }
  const fabricarParte = async (k) => ({ audio: new Blob([new Uint8Array(2000)]), nombre: `p${k + 1}.mp3` });

  {
    const a = api();
    const r = await tp.transcribirPorPartes({ total: 5, fabricarParte, fetchApi: a.fetchApi, esperar: async () => {} });
    comprobar(a.subidas.length === 5 && a.subidas.every((s) => s.fast === 'false'), '5 partes, todas con tiempos (fast=false)');
    comprobar(a.subidas[0].idioma === 'auto' && a.subidas.slice(1).every((s) => s.idioma === 'en'), 'la 1.ª detecta el idioma y las demás lo reciben fijo (el servidor ya entrega «en», medido)');
    comprobar(a.maxEnVuelo() <= 2, `nunca más de 2 partes en vuelo (${a.maxEnVuelo()})`);
    comprobar(r.usadas === 5 && r.idioma === 'en' && !r.soloPrimera, 'resultado: 5 usadas, idioma en');
  }
  {
    const a = api({ idiomas: ['es'] });
    const r = await tp.transcribirPorPartes({ total: 4, fabricarParte, fetchApi: a.fetchApi });
    comprobar(a.subidas.length === 1 && r.soloPrimera && r.usadas === 1, 'en español: solo se paga la 1.ª parte');
  }
  {
    const a = api();
    const guardadas = [];
    const previas = new Map([[0, [{ start: 1, end: 2, text: 'ya' }]], [1, []], [2, [{ start: 3, end: 4, text: 'ya 3' }]]]);
    const r = await tp.transcribirPorPartes({
      total: 5, fabricarParte, fetchApi: a.fetchApi, previas, idiomaPrevio: 'en',
      alTerminarParte: (k, segs, idioma) => { guardadas.push([k, idioma]); },
    });
    comprobar(a.subidas.length === 2, `retomar: solo se suben las 2 partes que faltaban (${a.subidas.length})`);
    comprobar(a.subidas.every((s) => s.idioma === 'en'), 'retomar: las que faltan usan el idioma guardado');
    comprobar(r.resultados[0][0].text === 'ya' && r.resultados[4][0].text.startsWith('Parte'), 'retomar: mezcla lo guardado con lo nuevo en su lugar');
    comprobar(guardadas.map((g) => g[0]).sort().join(',') === '3,4' && guardadas.every((g) => g[1] === 'en'), 'alTerminarParte avisa cada parte nueva con su idioma');
  }
  {
    let fabricadas = 0;
    const a = api();
    const control = new AbortController();
    const fetchQueCancela = async (ruta, opciones) => { const r = await a.fetchApi(ruta, opciones); control.abort(); return r; };
    let error = null;
    try {
      await tp.transcribirPorPartes({ total: 6, fabricarParte: async (k) => { fabricadas += 1; return fabricarParte(k); }, fetchApi: fetchQueCancela, signal: control.signal });
    } catch (e) { error = e; }
    comprobar(error?.name === 'AbortError' && a.subidas.length === 1 && fabricadas === 1, 'cancelar tras la 1.ª: ni se fabrica ni se sube nada más');
  }
}

// ── T2: reglas puras del archivo ────────────────────────────────────────
const al = await modulo('archivoLocal.js');
{
  comprobar(al.validarArchivo(archivo(bytesDe(10), 'clase.mp4')).ok, 'un MP4 se acepta');
  comprobar(al.validarArchivo(archivo(bytesDe(10), 'peli.mkv', '')).ok, 'un MKV sin tipo MIME se acepta por la extensión');
  comprobar(al.validarArchivo(archivo(bytesDe(10), 'grabacion.MOV', 'video/quicktime')).ok, 'MOV en mayúsculas se acepta');
  comprobar(al.validarArchivo(archivo(new Uint8Array(0), 'vacio.mp4')).codigo === 'vacio', 'archivo vacío → vacio');
  comprobar(al.validarArchivo(archivo(bytesDe(10), 'nota.m4a', 'audio/mp4')).codigo === 'no_es_video', 'un audio → no_es_video (va a la pestaña Archivo)');
  comprobar(al.validarArchivo(archivo(bytesDe(10), 'doc.pdf', 'application/pdf')).codigo === 'no_es_video', 'un PDF → no_es_video');
  comprobar(al.validarArchivo(null).codigo === 'vacio', 'sin archivo → vacio');

  const contenido = bytesDe(3 * 1024 * 1024);
  const h1 = await al.huellaArchivo(archivo(contenido, 'a.mp4'));
  const h2 = await al.huellaArchivo(archivo(contenido, 'otro-nombre.mp4'));
  const cambiado = contenido.slice(); cambiado[cambiado.length - 10] ^= 1;
  const h3 = await al.huellaArchivo(archivo(cambiado, 'a.mp4'));
  comprobar(/^archivo:[0-9a-f]{16}$/.test(h1), `huella con prefijo y 16 hex (${h1})`);
  comprobar(h1 === h2, 'renombrar el archivo NO cambia la huella');
  comprobar(h1 !== h3, 'un byte distinto al final SÍ cambia la huella');
  comprobar(/^archivo:/.test(await al.huellaArchivo(archivo(bytesDe(100), 'corto.mp4'))), 'un archivo de menos de 1 MiB también tiene huella');
  comprobar(al.esClaveArchivo(h1) && !al.esClaveArchivo('x:123') && !al.esClaveArchivo('dNWkwrqAkcM'), 'esClaveArchivo distingue de YouTube y X');

  comprobar(al.planearTrozosTiempo(0).length === 0, '0 s → sin partes');
  const corto = al.planearTrozosTiempo(100);
  comprobar(corto.length === 1 && corto[0].inicioS === 0 && corto[0].finS === 100 && corto[0].limiteS === 0, '100 s → una parte [0, 100]');
  const hora = al.planearTrozosTiempo(3600);
  comprobar(hora.length === 11, `60 min → 11 partes de 6 min con solape (${hora.length})`);
  comprobar(hora.every((t) => t.finS - t.inicioS <= 360), 'ninguna parte pasa de 360 s');
  comprobar(hora.every((t, i) => i === 0 || t.inicioS < hora[i - 1].finS), 'cada parte se solapa con la anterior');
  comprobar(hora.every((t, i) => i === 0 || (t.limiteS > t.inicioS && t.limiteS < hora[i - 1].finS)), 'el límite de cada parte cae dentro del solape');
  comprobar(hora.at(-1).finS === 3600, 'la última parte llega al final');
  comprobar(al.planearTrozosTiempo(365).length === 1 || al.planearTrozosTiempo(365).at(-1).finS === 365, '365 s no deja un pedacito suelto sin cubrir');

  const cortas = al.planearTrozosTiempo(100, { maxS: 20 });
  comprobar(cortas.length <= 7 && cortas.at(-1).finS === 100, `partes cortas: el solape se achica y el avance no se come (${cortas.length} partes)`);

  const mp3 = al.elegirModoExtraccion({ codec: 'aac', decodifica: true });
  comprobar(mp3.modo === 'mp3' && mp3.trozoS === 360, 'audio que el navegador decodifica → MP3 en partes de 6 min');
  const ac3 = al.elegirModoExtraccion({ codec: 'ac3', decodifica: false, bitrate: 192000 });
  comprobar(ac3.modo === 'copia' && ac3.contenedor === 'mp4' && ac3.trozoS >= 100 && ac3.trozoS <= 125, `AC-3 a 192 kbps sin decodificar → copia en partes de ~2 min (${ac3.trozoS} s)`);
  comprobar(al.elegirModoExtraccion({ codec: 'aac', decodifica: false, bitrate: 64000 }).trozoS === 360, 'AAC liviano copiado: tope de 6 min');
  comprobar(al.elegirModoExtraccion({ codec: 'vorbis', decodifica: false, bitrate: 128000 }).contenedor === 'webm', 'Vorbis se copia en WebM (MP4 no lo lleva)');
  comprobar(al.elegirModoExtraccion({ codec: 'dts', decodifica: false }).modo === 'imposible', 'códec desconocido sin decodificar → imposible, con motivo');
  comprobar(al.elegirModoExtraccion({ codec: 'aac', decodifica: false, bitrate: 1500000 }).modo === 'imposible', 'audio de 1,5 Mbps sin decodificar → imposible (partes de < 30 s)');
  comprobar(al.elegirModoExtraccion({ codec: 'ac3', decodifica: false, bitrate: 0 }).trozoS > 0, 'sin tasa de bits medida se usa una prudente');

  comprobar(al.tituloDeArchivo('clase_03-intro.al.prompting.mp4') === 'Clase 03 intro al prompting', 'título legible desde el nombre del archivo');
  comprobar(al.tituloDeArchivo('.mp4') === 'Video de tu equipo', 'nombre vacío → «Video de tu equipo»');
  comprobar(al.tituloDeArchivo('a'.repeat(300) + '.mkv').length <= 120, 'nombre larguísimo se recorta a 120');
  comprobar(/60 min.*11 partes.*no sale de tu equipo/.test(al.resumenAntesDeEmpezar({ duracionS: 3600 })), 'el resumen dice duración, partes y que el video no sale del equipo');
}

// ── T3: servicio de archivos con dobles (sin Mediabunny) ─────────────────
const sa = await modulo('servicioArchivo.js');
{
  const abrirDoble = (opciones = {}) => async () => ({
    duracionS: 750, audio: { codec: 'aac', decodifica: true, bitrate: 128000 }, video: { codec: 'avc' },
    extraccion: { modo: 'mp3', trozoS: 360, contenedor: 'mp3' }, cerrar: () => { opciones.cerrado = true; }, ...opciones.datos,
  });
  function apiDoble(respuestas = []) {
    const subidas = [];
    const fetchApi = async (_r, opciones = {}) => {
      const n = subidas.length;
      subidas.push(opciones.body.get('file').name);
      if (respuestas[n]) return respuestas[n]();
      // Cada parte «oye» una frase a los 10 s de su inicio y otra al final del solape
      return Response.json({ language: 'en', segments: [{ start: 10, end: 13, text: `Frase ${n + 1}.` }, { start: 352, end: 356, text: `Cierre ${n + 1}.` }] });
    };
    return { subidas, fetchApi };
  }
  const fabricar = async (_a, _t, k) => ({ audio: new Blob([new Uint8Array(4000)]), nombre: `equipo_parte_${k + 1}.mp3` });
  const video = archivo(bytesDe(5000), 'Curso IA - clase 1.mp4');

  {
    const a = apiDoble();
    const servicio = new sa.ServicioArchivo({ fetchApi: a.fetchApi, abrir: abrirDoble(), fabricar, esperar: async () => {} });
    const ficha = await servicio.inspeccionar(video);
    comprobar(/^archivo:[0-9a-f]{16}$/.test(ficha.clave) && ficha.titulo === 'Curso IA clase 1', 'inspeccionar: huella y título legible');
    comprobar(ficha.trozos.length === 3 && ficha.bytes === 5000 && ficha.nombreArchivo === 'Curso IA - clase 1.mp4', 'inspeccionar: 750 s → 3 partes; guarda nombre y tamaño');
    comprobar(ficha.originalMudo === false, 'audio decodificable: el original suena');
    const progreso = [];
    const r = await servicio.obtenerParaDoblaje(ficha, { onProgress: (m, f) => progreso.push(f) });
    comprobar(a.subidas.length === 3 && a.subidas.every((n) => /^equipo_parte_\d\.mp3$/.test(n)), 'se suben 3 partes MP3');
    comprobar(r.segmentos.some((s) => s.startTime > 348 + 9 && s.text === 'Frase 2.'), 'los tiempos de la parte 2 se desplazan a su lugar del video');
    comprobar(r.segmentos.filter((s) => /^Cierre/.test(s.text)).length <= 3, 'el solape no duplica frases');
    comprobar(r.idioma === 'en' && r.fuente === 'audio' && r.titulo === 'Curso IA clase 1', 'misma forma de respuesta que X');
    comprobar(progreso.at(-1) === 1, 'el progreso termina en 1');
  }
  {
    const servicio = new sa.ServicioArchivo({ fetchApi: async () => {}, abrir: abrirDoble(), fabricar });
    let error = null;
    try { await servicio.inspeccionar(archivo(bytesDe(10), 'nota.ogg', 'audio/ogg')); } catch (e) { error = e; }
    comprobar(error?.codigo === 'archivo_no_es_video' && /pestaña Archivo/.test(error.message), 'un audio se rechaza y dice adónde ir');
  }
  {
    const estado = {};
    const servicio = new sa.ServicioArchivo({ fetchApi: async () => {}, abrir: abrirDoble({ datos: { duracionS: 4 * 3600 }, ...estado }), fabricar });
    let error = null;
    try { await servicio.inspeccionar(video); } catch (e) { error = e; }
    comprobar(error?.codigo === 'archivo_largo' && /3 horas/.test(error.message), 'un video de 4 h se rechaza antes de gastar nada');
  }
  {
    const servicio = new sa.ServicioArchivo({
      fetchApi: async () => {}, fabricar,
      abrir: abrirDoble({ datos: { extraccion: { modo: 'imposible', motivo: 'Este navegador no puede leer el audio (dts).' } } }),
    });
    let error = null;
    try { await servicio.inspeccionar(video); } catch (e) { error = e; }
    comprobar(error?.codigo === 'archivo_audio' && /dts/.test(error.message), 'audio ilegible: el motivo llega tal cual');
  }
  {
    const servicio = new sa.ServicioArchivo({ fetchApi: async () => {}, abrir: abrirDoble({ datos: { audio: { codec: 'ac3', decodifica: false, bitrate: 192000 }, extraccion: { modo: 'copia', trozoS: 117, contenedor: 'mp4' } } }), fabricar });
    const ficha = await servicio.inspeccionar(video);
    comprobar(ficha.originalMudo === true && ficha.trozos.every((t) => t.finS - t.inicioS <= 117) && ficha.trozos.at(-1).finS === 750, `AC-3: avisa que el original no sonará y planea partes de ≤ 117 s (${ficha.trozos.length})`);
  }
  {
    const limite = () => Response.json({ detail: 'Límite de uso de Groq alcanzado. Espera un minuto e inténtalo de nuevo.' }, { status: 500 });
    const a = apiDoble([null, limite, limite, limite, limite, limite, limite]);
    const guardadas = new Map();
    const servicio = new sa.ServicioArchivo({ fetchApi: a.fetchApi, abrir: abrirDoble(), fabricar, esperar: async () => {} });
    const ficha = await servicio.inspeccionar(video);
    let error = null;
    try {
      await servicio.obtenerParaDoblaje(ficha, { alTerminarParte: (k, segs) => guardadas.set(k, segs) });
    } catch (e) { error = e; }
    comprobar(error?.codigo === 'archivo_limite' && /seguirá donde iba/.test(error.message), 'límite de Groq: mensaje honesto y que se retoma');
    comprobar(guardadas.has(0), 'la parte que sí se transcribió quedó guardada');
    const b = apiDoble();
    const servicio2 = new sa.ServicioArchivo({ fetchApi: b.fetchApi, abrir: abrirDoble(), fabricar });
    const r = await servicio2.obtenerParaDoblaje(await servicio2.inspeccionar(video), { previas: guardadas, idiomaPrevio: 'en' });
    comprobar(b.subidas.length === 2 && r.segmentos.length >= 3, `al volver: solo se suben las 2 que faltaban (${b.subidas.length})`);
  }
}

// ── T4: la biblioteca reconoce los videos del equipo ─────────────────────
const bv = await modulo('bibliotecaVideos.js');
const dd = await modulo('descargaDestino.js');
{
  const d = bv.datosDeClave('archivo:0123456789abcdef');
  comprobar(d.plataforma === 'archivo' && d.id === '0123456789abcdef', 'clave archivo: → plataforma archivo');
  comprobar(bv.datosDeClave('x:123').plataforma === 'x' && bv.datosDeClave('dNWkwrqAkcM').plataforma === 'youtube', 'YouTube y X no cambian');
  const e = bv.fusionarEntrada(null, { clave: 'archivo:0123456789abcdef', nombreArchivo: 'clase 1.mp4', bytes: 412e6, duracionS: 1800 });
  comprobar(e.url === '' && e.portada === '' && e.titulo === 'Video de tu equipo', 'sin enlace, sin portada inventada y con título por defecto');
  comprobar(e.nombreArchivo === 'clase 1.mp4' && e.bytes === 412e6, 'guarda nombre y tamaño del archivo');
  const despues = bv.fusionarEntrada({ ...e, etiquetas: ['Aprender'], favorito: true }, { clave: e.clave, posicionS: 300 });
  comprobar(despues.nombreArchivo === 'clase 1.mp4' && despues.etiquetas[0] === 'Aprender' && despues.favorito, 'el guardado automático no borra nombre, temas ni favorito');
  comprobar(bv.filtrarVideos([e, bv.fusionarEntrada(null, { clave: 'x:1' })], { plataforma: 'archivo' }).length === 1, 'filtro «Tu equipo» deja solo los del equipo');
  comprobar(dd.nombreArchivo({ titulo: 'Clase 1', plataforma: 'archivo', tipo: 'doblado' }) === 'jg-turbo-equipo-clase-1-doblado-es.mp4', 'archivo descargado: jg-turbo-equipo-…');
  comprobar(dd.nombreArchivo({ titulo: 'a', plataforma: 'x', tipo: 'audio', extension: 'mp3' }) === 'jg-turbo-x-a-audio-es.mp3', 'X conserva su nombre de archivo');
}

// ── Resumen ──────────────────────────────────────────────────────────────
console.log(`\n${ok} comprobaciones OK · ${fallos} fallos`);
if (fallos) process.exit(1);
```

- [ ] **Paso 2: verla fallar.** `node tests/test_archivo_doblaje.mjs` → error de importación de
  `transcripcionPartes.js`.
- [ ] **Paso 3: crear** `js/youtube/transcripcionPartes.js`:

```js
// js/youtube/transcripcionPartes.js
/**
 * Transcribir un audio largo por partes con /api/transcribe (Whisper de Groq, gratis).
 *
 * Lo comparten X (audio HLS) y los videos del equipo (audio sacado con Mediabunny):
 * quien llama sabe FABRICAR cada parte; aquí vive lo común. Reglas medidas:
 *  - la 1.ª parte va sola y fija el idioma de las demás (Whisper podría cambiarlo
 *    parte a parte);
 *  - si el video ya está en español, se para tras la 1.ª parte (no se gasta cuota);
 *  - 2 partes en vuelo (Groq gratis: 20 peticiones/min);
 *  - ante «Límite de uso» se espera 20 s y 40 s y luego se explica el motivo real.
 * Cada parte viaja con ≤ 3,2 MB: Vercel rechaza cuerpos de ~4,5 MB y corta a los 60 s.
 */
import { ErrorYoutube } from './transcriptionService.js';
import { codigoCorto } from './idiomaOrigen.js';

export const BYTES_MAX_PARTE = 3.2 * 1024 * 1024;
export const PARTES_EN_PARALELO = 2;
const ESPERA_PARTE_MS = 90000;           // subir ~3 MB + Whisper sobre 6 min de audio
const RE_LIMITE = /l[ií]mite de uso|rate limit|429/i;

export const cancelado = () => new DOMException('Cancelado', 'AbortError');
export const esperarMs = (ms, signal) => new Promise((resolver, rechazar) => {
  const t = setTimeout(resolver, ms);
  signal?.addEventListener('abort', () => { clearTimeout(t); rechazar(cancelado()); }, { once: true });
});

/** Corre `trabajo` sobre cada elemento con a lo sumo `limite` a la vez; el primer fallo detiene el resto. */
export async function enParalelo(elementos, limite, trabajo) {
  let siguiente = 0;
  let fallo = null;
  const trabajadores = Array.from({ length: Math.min(limite, elementos.length) }, async () => {
    while (!fallo && siguiente < elementos.length) {
      const i = siguiente;
      siguiente += 1;
      try { await trabajo(elementos[i], i); } catch (error) { fallo = fallo || error; }
    }
  });
  await Promise.all(trabajadores);
  if (fallo) throw fallo;
}

/** Sube UNA parte y devuelve { segmentos, idioma } con tiempos locales a la parte. */
export async function subirParte(fetchApi, audio, nombre, {
  idioma = 'auto', apiKey = '', context = '', signal = null,
  esperar = esperarMs, esperasLimiteMs = [20000, 40000], codigoError = 'transcripcion',
} = {}) {
  const formulario = new FormData();
  formulario.append('file', audio, nombre);
  formulario.append('language', idioma);
  formulario.append('fast', 'false');   // verbose_json: Whisper entrega start/end por frase
  if (apiKey) formulario.append('api_key', apiKey);
  if (context) formulario.append('context', String(context).slice(0, 4000));
  for (let intento = 0; ; intento += 1) {
    if (signal?.aborted) throw cancelado();
    const respuesta = await fetchApi('/transcribe', { method: 'POST', body: formulario, signal }, ESPERA_PARTE_MS);
    const datos = await respuesta.json().catch(() => ({}));
    if (signal?.aborted) throw cancelado();
    if (respuesta.ok) {
      return { segmentos: Array.isArray(datos.segments) ? datos.segments : [], idioma: datos.language || '' };
    }
    const detalle = typeof datos?.detail === 'string' ? datos.detail : '';
    if ((respuesta.status === 429 || RE_LIMITE.test(detalle)) && intento < esperasLimiteMs.length) {
      await esperar(esperasLimiteMs[intento], signal);
      continue;
    }
    throw new ErrorYoutube(detalle || `No se pudo transcribir el audio del video (HTTP ${respuesta.status}).`, codigoError, datos);
  }
}

/**
 * `fabricarParte(k)` → { audio: Blob, nombre } (la parte k, lista para subir).
 * `previas`: Map k → segmentos ya transcritos (no se vuelven a pagar).
 * `alTerminarParte(k, segmentos, idioma)`: para guardarlas a medida que llegan.
 * Devuelve { resultados: [segmentos de cada parte], usadas, soloPrimera, idioma, elegido }.
 */
export async function transcribirPorPartes({
  total, fabricarParte, fetchApi, idiomaOrigen = 'auto', apiKey = '', context = '', signal = null,
  onProgress = () => {}, esperar = esperarMs, esperasLimiteMs = [20000, 40000], codigoError = 'transcripcion',
  previas = new Map(), idiomaPrevio = '', alTerminarParte = () => {}, enParaleloMax = PARTES_EN_PARALELO,
}) {
  const elegido = idiomaOrigen && idiomaOrigen !== 'auto' ? codigoCorto(idiomaOrigen) : '';
  let idioma = elegido || codigoCorto(idiomaPrevio);
  const resultados = new Array(total);
  let hechas = 0;
  const contar = () => onProgress(`Transcribiendo el audio: ${hechas} de ${total} ${total === 1 ? 'parte' : 'partes'}…`, hechas / total);
  const transcribir = async (k) => {
    if (previas.has(k)) {
      resultados[k] = previas.get(k);
    } else {
      if (signal?.aborted) throw cancelado();
      const { audio, nombre } = await fabricarParte(k);
      if (signal?.aborted) throw cancelado();
      const r = await subirParte(fetchApi, audio, nombre, {
        idioma: idioma || 'auto', apiKey, context, signal, esperar, esperasLimiteMs, codigoError,
      });
      resultados[k] = r.segmentos;
      if (!idioma) idioma = codigoCorto(r.idioma);
      await alTerminarParte(k, r.segmentos, idioma || codigoCorto(r.idioma));
    }
    hechas += 1;
    contar();
  };
  contar();
  await transcribir(0);   // sola: fija el idioma para las demás
  const soloPrimera = !elegido && idioma === 'es';   // ya está en español: no se gasta cuota en el resto
  if (!soloPrimera && total > 1) {
    await enParalelo(Array.from({ length: total - 1 }, (_, i) => i + 1), enParaleloMax, (k) => transcribir(k));
  }
  return { resultados, usadas: soloPrimera ? 1 : total, soloPrimera, idioma, elegido };
}
```

- [ ] **Paso 4: usarlo desde `servicioX.js`** (extracción mecánica, misma conducta):

```diff
diff --git a/js/youtube/servicioX.js b/js/youtube/servicioX.js
index 177fec9..9d6bf77 100644
--- a/js/youtube/servicioX.js
+++ b/js/youtube/servicioX.js
@@ -7,23 +7,14 @@
  * responde 403 (medido 2026-09-27; curl no lo muestra porque no manda Referer).
  */
 import { ErrorYoutube, normalizarSegmentos } from './transcriptionService.js';
-import { codigoCorto } from './idiomaOrigen.js';
+import { transcribirPorPartes, enParalelo, esperarMs, cancelado } from './transcripcionPartes.js';
 import {
   elegirPistaAudio, leerListaAudio, planearTrozos, unirTranscripciones, urlTwimg, duracionMaximaTrozo,
 } from './audioX.js';
 
 export const MAX_DURACION_X_S = 60 * 60;
 const ESPERA_INFO_MS = 20000;            // /api/x-video: ≤ 2 consultas de 8 s
-const ESPERA_PARTE_MS = 90000;           // subir ~3 MB + Whisper sobre 6 min de audio
 const DESCARGAS_EN_PARALELO = 8;
-const PARTES_EN_PARALELO = 2;            // Groq gratis: 20 peticiones/min
-const RE_LIMITE = /l[ií]mite de uso|rate limit|429/i;
-
-const cancelado = () => new DOMException('Cancelado', 'AbortError');
-const esperarMs = (ms, signal) => new Promise((resolver, rechazar) => {
-  const t = setTimeout(resolver, ms);
-  signal?.addEventListener('abort', () => { clearTimeout(t); rechazar(cancelado()); }, { once: true });
-});
 
 export function fetchTwimg(url, { signal } = {}) {
   return fetch(url, { referrerPolicy: 'no-referrer', credentials: 'omit', signal });
@@ -37,21 +28,6 @@ export function tituloX(info) {
   return titulo.length > 120 ? `${titulo.slice(0, 119)}…` : titulo;
 }
 
-/** Corre `trabajo` sobre cada elemento con a lo sumo `limite` a la vez; el primer fallo detiene el resto. */
-async function enParalelo(elementos, limite, trabajo) {
-  let siguiente = 0;
-  let fallo = null;
-  const trabajadores = Array.from({ length: Math.min(limite, elementos.length) }, async () => {
-    while (!fallo && siguiente < elementos.length) {
-      const i = siguiente;
-      siguiente += 1;
-      try { await trabajo(elementos[i], i); } catch (error) { fallo = fallo || error; }
-    }
-  });
-  await Promise.all(trabajadores);
-  if (fallo) throw fallo;
-}
-
 export class ServicioX {
   constructor({ fetchApi, pedirTwimg = fetchTwimg, esperar = esperarMs, esperasLimiteMs = [20000, 40000] }) {
     if (typeof fetchApi !== 'function') throw new Error('Falta el cliente de la API.');
@@ -89,31 +65,19 @@ export class ServicioX {
     const inicial = await this.#bytes(urlTwimg(lista.init, info.hls), signal);
     const trozos = planearTrozos(lista.segmentos, { maxS: duracionMaximaTrozo(pista.kbps) });
 
-    const elegido = idiomaOrigen && idiomaOrigen !== 'auto' ? codigoCorto(idiomaOrigen) : '';
-    let idioma = elegido;
-    const resultados = new Array(trozos.length);
-    let hechas = 0;
-    const transcribirParte = async (trozo, k) => {
-      const partes = [inicial];
+    const fabricarParte = async (k) => {
+      const trozo = trozos[k];
       const urls = lista.segmentos.slice(trozo.desde, trozo.hasta).map((s) => urlTwimg(s.uri, info.hls));
       const bytes = new Array(urls.length);
       await enParalelo(urls, DESCARGAS_EN_PARALELO, async (url, i) => { bytes[i] = await this.#bytes(url, signal); });
-      partes.push(...bytes);
-      const audio = new Blob(partes, { type: 'audio/mp4' });
-      resultados[k] = await this.#subir(audio, k, { idioma: idioma || 'auto', apiKey, context, signal });
-      hechas += 1;
-      onProgress(`Transcribiendo el audio: ${hechas} de ${trozos.length} ${trozos.length === 1 ? 'parte' : 'partes'}…`, hechas / trozos.length);
+      return { audio: new Blob([inicial, ...bytes], { type: 'audio/mp4' }), nombre: `x_parte_${k + 1}.m4a` };
     };
-
-    onProgress(`Transcribiendo el audio: 0 de ${trozos.length} ${trozos.length === 1 ? 'parte' : 'partes'}…`, 0);
-    // La 1.ª parte va sola: fija el idioma para las demás (Whisper podría cambiarlo parte a parte).
-    await transcribirParte(trozos[0], 0);
-    idioma = idioma || codigoCorto(resultados[0].idioma);
-    const soloPrimera = !elegido && idioma === 'es';   // ya está en español: no se gasta cuota en el resto
-    if (!soloPrimera) await enParalelo(trozos.slice(1), PARTES_EN_PARALELO, (trozo, i) => transcribirParte(trozo, i + 1));
-
-    const usados = soloPrimera ? trozos.slice(0, 1) : trozos;
-    const segmentos = normalizarSegmentos(unirTranscripciones(usados, resultados.slice(0, usados.length).map((r) => r.segmentos)));
+    const { resultados, usadas, soloPrimera, idioma, elegido } = await transcribirPorPartes({
+      total: trozos.length, fabricarParte, fetchApi: this.fetchApi, idiomaOrigen, apiKey, context, signal, onProgress,
+      esperar: this.esperar, esperasLimiteMs: this.esperasLimiteMs, codigoError: 'x_transcripcion',
+    });
+    const usados = trozos.slice(0, usadas);
+    const segmentos = normalizarSegmentos(unirTranscripciones(usados, resultados.slice(0, usadas)));
     if (!segmentos.length && !soloPrimera) {
       throw new ErrorYoutube('No se oye voz que se pueda doblar en este video (¿solo música?).', 'sin_segmentos');
     }
@@ -147,28 +111,4 @@ export class ServicioX {
       }
     }
   }
-
-  async #subir(audio, k, { idioma, apiKey, context, signal }) {
-    const formulario = new FormData();
-    formulario.append('file', audio, `x_parte_${k + 1}.m4a`);
-    formulario.append('language', idioma);
-    formulario.append('fast', 'false');   // verbose_json: Whisper entrega start/end por frase
-    if (apiKey) formulario.append('api_key', apiKey);
-    if (context) formulario.append('context', String(context).slice(0, 4000));
-    for (let intento = 0; ; intento += 1) {
-      if (signal?.aborted) throw cancelado();
-      const respuesta = await this.fetchApi('/transcribe', { method: 'POST', body: formulario, signal }, ESPERA_PARTE_MS);
-      const datos = await respuesta.json().catch(() => ({}));
-      if (signal?.aborted) throw cancelado();
-      if (respuesta.ok) {
-        return { segmentos: Array.isArray(datos.segments) ? datos.segments : [], idioma: datos.language || '' };
-      }
-      const detalle = typeof datos?.detail === 'string' ? datos.detail : '';
-      if ((respuesta.status === 429 || RE_LIMITE.test(detalle)) && intento < this.esperasLimiteMs.length) {
-        await this.esperar(this.esperasLimiteMs[intento], signal);
-        continue;
-      }
-      throw new ErrorYoutube(detalle || `No se pudo transcribir el audio del video (HTTP ${respuesta.status}).`, 'x_transcripcion', datos);
-    }
-  }
 }
```

- [ ] **Paso 5: verla pasar y contar.**

```bash
node tests/test_archivo_doblaje.mjs   # T1: 10 OK
node tests/test_x_doblaje.mjs         # 70 OK (igual que la línea base)
```

- [ ] **Paso 6: commit.**

```bash
git add js/youtube/transcripcionPartes.js js/youtube/servicioX.js tests/test_archivo_doblaje.mjs
git commit -m "refactor: transcripcion por partes compartida entre X y archivos"
```

### Tarea 2: `archivoLocal.js` — reglas puras del archivo

Validar, huella, plan de partes con solape, modo de extracción, título legible y el texto honesto de
«qué va a pasar».

**Archivos:** crear `js/youtube/archivoLocal.js` · añadir la sección **T2** a la prueba.

- [ ] **Paso 1:** añade la sección `// ── T2: reglas puras del archivo` (ver archivo completo en la
  Tarea 1) antes del «Resumen». Corre y míralo fallar (no existe el módulo).
- [ ] **Paso 2: crear** `js/youtube/archivoLocal.js`:

```js
// js/youtube/archivoLocal.js
/**
 * Videos del equipo: reglas puras (sin Mediabunny ni DOM) para probarlas en Node.
 *
 * El video NUNCA se copia a la app (decisión del dueño, 2026-10-01): se guarda su
 * texto, traducción y voz con una huella del archivo como clave; para volver a
 * verlo se elige otra vez el mismo archivo y la huella lo reconoce.
 *
 * Medido el 2026-10-01 (Chrome, este PC; docs/video-local/MEDICIONES.md):
 *  - recodificar 60 min de audio a MP3 16 kHz mono 32 kbps: 16,7 s (≈ 9 s por
 *    parte de 6 min con la CPU 4× más lenta, como un teléfono);
 *  - copiar el audio sin recodificar: 0,6 s para 60 min, pero 51 MB a subir;
 *  - Whisper de producción aceptó MP3, Ogg/Opus, AAC (.m4a) y AC-3 copiado en MP4.
 */
import { BYTES_MAX_PARTE } from './transcripcionPartes.js';

export const PREFIJO_CLAVE = 'archivo:';
export const MAX_DURACION_S = 3 * 60 * 60;
export const TROZO_MAX_S = 360;          // MP3 32 kbps: 1,44 MB por parte (medido)
export const SOLAPE_S = 12;              // como X: ~4 trozos HLS de 3 s
export const TROZO_MIN_COPIA_S = 30;
export const MARGEN_BITRATE = 1.15;      // el audio VBR puede pasar su promedio
export const BYTES_HUELLA = 1024 * 1024; // 1 MiB del principio + 1 MiB del final (16 ms medido)
export const EXTENSIONES_VIDEO = Object.freeze(['mp4', 'm4v', 'mov', 'mkv', 'webm']);
/** Códecs de audio que Whisper acepta copiados tal cual (AC-3 medido en producción). */
export const COPIABLES = Object.freeze({
  aac: 'mp4', mp3: 'mp4', opus: 'mp4', flac: 'mp4', ac3: 'mp4', eac3: 'mp4', vorbis: 'webm',
});

const extension = (nombre) => (String(nombre || '').toLowerCase().match(/\.([a-z0-9]{2,5})$/) || [])[1] || '';

/** `codigo`: '' · 'vacio' · 'no_es_video'. */
export function validarArchivo(archivo) {
  if (!archivo || !Number(archivo.size)) {
    return { ok: false, codigo: 'vacio', motivo: 'Ese archivo está vacío. Elige otro video.' };
  }
  const tipo = String(archivo.type || '').toLowerCase();
  const ext = extension(archivo.name);
  if (tipo.startsWith('audio/') || (!tipo.startsWith('video/') && !EXTENSIONES_VIDEO.includes(ext))) {
    return {
      ok: false,
      codigo: 'no_es_video',
      motivo: 'Eso no parece un video (MP4, MOV, MKV o WebM). Para un audio usa la pestaña Archivo.',
    };
  }
  return { ok: true, codigo: '', motivo: '' };
}

/**
 * Huella estable del archivo: tamaño + 1 MiB del principio + 1 MiB del final.
 * No usa nombre ni fecha: renombrar o mover el archivo no pierde su doblaje.
 */
export async function huellaArchivo(archivo, { subtle = globalThis.crypto?.subtle } = {}) {
  const tam = Number(archivo.size) || 0;
  const partes = [String(tam), archivo.slice(0, Math.min(tam, BYTES_HUELLA))];
  if (tam > BYTES_HUELLA) partes.push(archivo.slice(Math.max(BYTES_HUELLA, tam - BYTES_HUELLA)));
  const bytes = await new Blob(partes).arrayBuffer();
  const resumen = new Uint8Array(await subtle.digest('SHA-256', bytes));
  return PREFIJO_CLAVE + [...resumen.slice(0, 8)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export const esClaveArchivo = (clave) => String(clave || '').startsWith(PREFIJO_CLAVE);

/**
 * Partes por tiempo con solape, en la forma que `unirTranscripciones` (audioX.js)
 * ya sabe unir: cada parte k > 0 descarta lo que empieza antes de su `limiteS`.
 */
export function planearTrozosTiempo(duracionS, { maxS = TROZO_MAX_S, solapeS = SOLAPE_S } = {}) {
  const total = Math.max(0, Number(duracionS) || 0);
  if (!total) return [];
  const solape = Math.min(solapeS, maxS / 4);   // partes cortas: el solape no se come el avance
  const paso = Math.max(1, maxS - solape);
  const trozos = [];
  for (let inicio = 0; ; inicio += paso) {
    const fin = Math.min(total, inicio + maxS);
    trozos.push({
      inicioS: inicio,
      finS: Math.round(fin * 1000) / 1000,
      limiteS: inicio === 0 ? 0 : inicio + solape / 2,
    });
    if (fin >= total || total - (inicio + paso) <= solape) {
      trozos[trozos.length - 1].finS = Math.round(total * 1000) / 1000;
      break;
    }
  }
  return trozos;
}

/**
 * Cómo sacar el audio para Whisper.
 *  - 'mp3': el navegador decodifica el audio → MP3 16 kHz mono 32 kbps (partes de 6 min, ~1,4 MB).
 *  - 'copia': no lo decodifica (p. ej. AC-3 en Chrome) → se copia tal cual en partes
 *    que quepan en 3,2 MB según su tasa de bits.
 *  - 'imposible': ni lo uno ni lo otro: se explica.
 */
export function elegirModoExtraccion({ codec = '', decodifica = false, bitrate = 0 } = {}) {
  if (decodifica) return { modo: 'mp3', trozoS: TROZO_MAX_S, contenedor: 'mp3' };
  const contenedor = COPIABLES[codec];
  if (!contenedor) {
    return { modo: 'imposible', trozoS: 0, contenedor: '', motivo: `Este navegador no puede leer el audio de este video (${codec || 'formato desconocido'}). Prueba en Chrome de computador o conviértelo a MP4.` };
  }
  const bps = Number(bitrate) > 0 ? Number(bitrate) * MARGEN_BITRATE : 192000 * MARGEN_BITRATE;
  const trozoS = Math.floor((BYTES_MAX_PARTE * 8) / bps);
  if (trozoS < TROZO_MIN_COPIA_S) {
    return { modo: 'imposible', trozoS: 0, contenedor: '', motivo: 'El audio de este video es demasiado pesado para enviarlo por partes. Conviértelo a MP4 (AAC) e inténtalo otra vez.' };
  }
  return { modo: 'copia', trozoS: Math.min(TROZO_MAX_S, trozoS), contenedor };
}

/** «clase_03-intro.al.prompting.mp4» → «Clase 03 intro al prompting». */
export function tituloDeArchivo(nombre) {
  const base = String(nombre || '').replace(/\.[a-z0-9]{2,5}$/i, '')
    .replace(/[_.]+/g, ' ').replace(/\s*-\s*/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120).trim();
  if (!base) return 'Video de tu equipo';
  return base.charAt(0).toLocaleUpperCase('es') + base.slice(1);
}

/** Lo que se dice ANTES de empezar (principio «decir la verdad sobre lo que cuesta»). */
export function resumenAntesDeEmpezar({ duracionS = 0, modo = 'mp3', trozoS = TROZO_MAX_S } = {}) {
  const partes = Math.max(1, Math.ceil((Number(duracionS) || 0) / Math.max(1, trozoS - SOLAPE_S)));
  const minutos = Math.max(1, Math.round((Number(duracionS) || 0) / 60));
  const como = modo === 'copia' ? 'copiando su audio' : 'sacando su audio aquí mismo';
  return `Video de ${minutos} min: lo escuchamos ${como} y lo transcribimos en ${partes} ${partes === 1 ? 'parte' : 'partes'} (gratis). El video no sale de tu equipo; solo viaja el audio.`;
}
```

- [ ] **Paso 3:** `node tests/test_archivo_doblaje.mjs` → T1 + T2 = **42 OK**.
- [ ] **Paso 4: commit** (`feat: reglas puras de videos del equipo (huella, partes, modo)`).

### Tarea 3: `servicioArchivo.js` — del archivo al texto con tiempos

Misma forma de respuesta que `ServicioX.obtenerParaDoblaje`, para que el controlador trate igual a X y
a los archivos. Mediabunny entra por inyección (`abrir`, `fabricar`) para probarlo en Node.

**Archivos:** crear `js/youtube/servicioArchivo.js` · añadir la sección **T3**.

- [ ] **Paso 1:** añade la sección T3; míralo fallar.
- [ ] **Paso 2: crear** `js/youtube/servicioArchivo.js`:

```js
// js/youtube/servicioArchivo.js
/**
 * Videos del equipo: del archivo al texto con tiempos, listo para el MISMO doblaje
 * de YouTube y X (traducción, voces, ritmo, subtítulo, caché, biblioteca).
 *
 * El audio se saca en el navegador (medioLocal.js) y viaja por partes a Whisper
 * (transcripcionPartes.js). Lo ya transcrito se puede guardar parte por parte
 * (`alTerminarParte`) y se reutiliza (`previas`): si Groq llega a su límite a
 * mitad de un video de 3 h, la siguiente vez sigue donde iba sin volver a pagar.
 */
import { ErrorYoutube, normalizarSegmentos } from './transcriptionService.js';
import { transcribirPorPartes, esperarMs } from './transcripcionPartes.js';
import { unirTranscripciones } from './audioX.js';
import {
  MAX_DURACION_S, planearTrozosTiempo, tituloDeArchivo, validarArchivo, huellaArchivo,
} from './archivoLocal.js';

const RE_LIMITE = /l[ií]mite de uso|rate limit|429/i;

export class ServicioArchivo {
  /**
   * `abrir(archivo)` y `fabricar(abierto, trozo, k)`: por defecto los de medioLocal.js
   * (Mediabunny, solo navegador); las pruebas pasan dobles.
   */
  constructor({ fetchApi, abrir = null, fabricar = null, huella = huellaArchivo, esperar = esperarMs, esperasLimiteMs = [20000, 40000] }) {
    if (typeof fetchApi !== 'function') throw new Error('Falta el cliente de la API.');
    this.fetchApi = fetchApi;
    this.abrir = abrir;
    this.fabricar = fabricar;
    this.huella = huella;
    this.esperar = esperar;
    this.esperasLimiteMs = esperasLimiteMs;
  }

  async #medios() {
    if (!this.abrir || !this.fabricar) {
      const m = await import('./medioLocal.js');
      this.abrir = this.abrir || m.abrirArchivoLocal;
      this.fabricar = this.fabricar || m.fabricarParteLocal;
    }
  }

  /** Valida, saca la huella y abre el archivo. Devuelve la «ficha» que usa todo lo demás. */
  async inspeccionar(archivo) {
    const valido = validarArchivo(archivo);
    if (!valido.ok) throw new ErrorYoutube(valido.motivo, `archivo_${valido.codigo}`);
    await this.#medios();
    const [clave, abierto] = await Promise.all([this.huella(archivo), this.abrir(archivo)]);
    if (abierto.duracionS > MAX_DURACION_S) {
      abierto.cerrar();
      throw new ErrorYoutube(`Este video dura ${Math.round(abierto.duracionS / 60)} min. Por ahora se doblan videos de hasta ${MAX_DURACION_S / 3600} horas.`, 'archivo_largo');
    }
    if (abierto.extraccion.modo === 'imposible') {
      abierto.cerrar();
      throw new ErrorYoutube(abierto.extraccion.motivo, 'archivo_audio');
    }
    return {
      clave,
      titulo: tituloDeArchivo(archivo.name),
      nombreArchivo: String(archivo.name || ''),
      bytes: Number(archivo.size) || 0,
      duracionS: abierto.duracionS,
      audio: abierto.audio,
      video: abierto.video,
      extraccion: abierto.extraccion,
      // El navegador no decodifica ese audio: el <video> tampoco lo hará sonar (AC-3 en Chrome).
      originalMudo: !abierto.audio.decodifica,
      trozos: planearTrozosTiempo(abierto.duracionS, { maxS: abierto.extraccion.trozoS }),
      abierto,
    };
  }

  /**
   * Misma forma de respuesta que ServicioX.obtenerParaDoblaje.
   * `previas`: Map k → segmentos ya transcritos (de un intento anterior con el mismo plan).
   */
  async obtenerParaDoblaje(ficha, {
    idiomaOrigen = 'auto', apiKey = '', context = '', signal = null, onProgress = () => {},
    previas = new Map(), idiomaPrevio = '', alTerminarParte = () => {},
  } = {}) {
    const { trozos, abierto } = ficha;
    onProgress(ficha.extraccion.modo === 'copia' ? 'Copiando el audio del video…' : 'Sacando el audio del video…', null);
    let resultado;
    try {
      resultado = await transcribirPorPartes({
        total: trozos.length,
        fabricarParte: (k) => this.fabricar(abierto, trozos[k], k),
        fetchApi: this.fetchApi, idiomaOrigen, apiKey, context, signal, onProgress,
        esperar: this.esperar, esperasLimiteMs: this.esperasLimiteMs, codigoError: 'archivo_transcripcion',
        previas, idiomaPrevio, alTerminarParte,
      });
    } catch (error) {
      if (error?.codigo === 'archivo_transcripcion' && RE_LIMITE.test(error.message)) {
        throw new ErrorYoutube(
          'Groq llegó a su límite gratuito (unas 2 horas de audio por hora). Lo ya transcrito quedó guardado: vuelve a pulsar «Doblar al español» en un rato y seguirá donde iba.',
          'archivo_limite',
        );
      }
      throw error;
    }
    const { resultados, usadas, soloPrimera, idioma, elegido } = resultado;
    const segmentos = normalizarSegmentos(unirTranscripciones(trozos.slice(0, usadas), resultados.slice(0, usadas)));
    if (!segmentos.length && !soloPrimera) {
      throw new ErrorYoutube('No se oye voz que se pueda doblar en este video (¿solo música?).', 'sin_segmentos');
    }
    return {
      segmentos,
      idioma,
      solicitado: elegido,
      confianza: elegido ? 1 : 0.95,
      fuente: elegido ? 'usuario' : 'audio',
      conflicto: false,
      disponibles: [],
      titulo: ficha.titulo,
      duracionS: ficha.duracionS,
    };
  }
}
```

- [ ] **Paso 3:** `node tests/test_archivo_doblaje.mjs` → T1–T3 = **57 OK**.
- [ ] **Paso 4: commit** (`feat: servicio de transcripcion para videos del equipo`).

### Tarea 4: la biblioteca reconoce `archivo:`

**Archivos:** `js/youtube/bibliotecaVideos.js`, `js/youtube/descargaDestino.js` · sección **T4**.

- [ ] **Paso 1:** añade la sección T4; míralo fallar (3–5 FALLO esperados).
- [ ] **Paso 2: aplicar:**

```diff
diff --git a/js/youtube/bibliotecaVideos.js b/js/youtube/bibliotecaVideos.js
index 7e28253..d68088a 100644
--- a/js/youtube/bibliotecaVideos.js
+++ b/js/youtube/bibliotecaVideos.js
@@ -58,9 +58,13 @@ export function fraccionVista(posicionS, duracionS) {
   return Math.max(0, Math.min(1, (Number(posicionS) || 0) / duracion));
 }
 
-/** La clave de caché dice la plataforma: YouTube = id tal cual; X = «x:<id>» o «x:<id>:<n>». */
+/**
+ * La clave de caché dice la plataforma: YouTube = id tal cual; X = «x:<id>» o
+ * «x:<id>:<n>»; video del equipo = «archivo:<huella>» (archivoLocal.js).
+ */
 export function datosDeClave(clave) {
   const texto = String(clave || '');
+  if (texto.startsWith('archivo:')) return { plataforma: 'archivo', id: texto.slice(8), indice: 0 };
   if (texto.startsWith('x:')) {
     const [, id = '', n = '0'] = texto.split(':');
     return { plataforma: 'x', id, indice: Number(n) || 0 };
@@ -68,7 +72,9 @@ export function datosDeClave(clave) {
   return { plataforma: 'youtube', id: texto, indice: 0 };
 }
 
+/** Un video del equipo no tiene enlace: vive en el disco de la persona. */
 export function urlCanonica({ plataforma, id, indice = 0 }) {
+  if (plataforma === 'archivo') return '';
   if (plataforma === 'x') return `https://x.com/i/status/${id}${indice ? `/video/${indice + 1}` : ''}`;
   return `https://www.youtube.com/watch?v=${id}`;
 }
@@ -84,7 +90,7 @@ export function fusionarEntrada(previa, nueva, ahora = Date.now()) {
   const datos = datosDeClave(clave);
   const duracionS = Number(nueva?.duracionS) || Number(base.duracionS) || 0;
   const posicionS = Number(nueva?.posicionS ?? base.posicionS) || 0;
-  const tituloPorDefecto = datos.plataforma === 'x' ? 'Video de X' : 'Video de YouTube';
+  const tituloPorDefecto = { x: 'Video de X', archivo: 'Video de tu equipo' }[datos.plataforma] || 'Video de YouTube';
   return {
     clave,
     plataforma: datos.plataforma,
@@ -100,6 +106,9 @@ export function fusionarEntrada(previa, nueva, ahora = Date.now()) {
     // 2.ª voz de los diálogos tal como sonó: 'ninguna' = todo con la principal.
     // undefined en fichas anteriores a la auditoría (entonces, la del otro género).
     vozSecundaria: nueva?.vozSecundaria ?? base.vozSecundaria,
+    // Solo videos del equipo: para pedir «elige otra vez <nombre>» y estimar descargas.
+    nombreArchivo: String(nueva?.nombreArchivo || base.nombreArchivo || ''),
+    bytes: Number(nueva?.bytes) || Number(base.bytes) || 0,
     etiquetas: Array.isArray(base.etiquetas) ? base.etiquetas : [],
     favorito: Boolean(base.favorito),
     posicionS,
```

```diff
diff --git a/js/youtube/descargaDestino.js b/js/youtube/descargaDestino.js
index 91cd28f..bafc1fd 100644
--- a/js/youtube/descargaDestino.js
+++ b/js/youtube/descargaDestino.js
@@ -66,5 +66,6 @@ export function nombreArchivo({ titulo = '', plataforma = 'youtube', tipo = 'dob
   const base = String(titulo).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
     .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60).replace(/-+$/, '') || 'video';
   const sufijo = { original: 'original', doblado: 'doblado-es', audio: 'audio-es' }[tipo] || tipo;
-  return `jg-turbo-${plataforma === 'x' ? 'x' : 'youtube'}-${base}-${sufijo}.${extension}`;
+  const origen = { x: 'x', archivo: 'equipo' }[plataforma] || 'youtube';
+  return `jg-turbo-${origen}-${base}-${sufijo}.${extension}`;
 }
```

- [ ] **Paso 3: contar.**

```bash
node tests/test_archivo_doblaje.mjs     # 65 OK
node tests/test_biblioteca_videos.mjs   # 100 OK (sin cambios)
```

- [ ] **Paso 4: commit** (`feat: la biblioteca guarda videos del equipo sin enlace`).

---

## Fase 2 · Navegador: Mediabunny real

### Tarea 5: `medioLocal.js` — abrir el archivo, sacar el audio en partes, miniatura

**Archivos:** crear `js/youtube/medioLocal.js` · crear `tests/verificar_archivo_audio.mjs` · copiar los
videos de prueba · `.gitignore`.

- [ ] **Paso 1: videos de prueba.** Copia `docs/video-local/fixtures/*` a `tests/fixtures/archivo/`
  (`clase_en_40s.webm` VP9+Opus, `clase_en_40s_ac3.mkv` H.264+AC-3 a 32 kHz, `dos_pistas_40s.mkv` dos
  audios, `sin_audio_10s.webm`). `.gitignore` ignora `*.webm`: añade debajo de
  `!tests/fixtures/x/video_prueba.webm` la línea `!tests/fixtures/archivo/*.webm` (sin ella el commit
  sale sin videos — pasó con X). Para regenerarlos, `docs/video-local/MEDICIONES.md` trae la receta de
  FFmpeg; el comando exacto de cada uno:

```bash
ffmpeg -y -f lavfi -i "testsrc2=size=160x90:rate=4" -i voz_en.mp3 -t 40 -c:v libvpx-vp9 -deadline realtime -cpu-used 8 -b:v 40k -c:a libopus -b:a 48k clase_en_40s.webm
ffmpeg -y -f lavfi -i "testsrc2=size=160x90:rate=4" -i voz_en.mp3 -t 40 -c:v libx264 -preset ultrafast -pix_fmt yuv420p -c:a ac3 -b:a 192k clase_en_40s_ac3.mkv
ffmpeg -y -f lavfi -i "testsrc2=size=160x90:rate=4" -i voz_en.mp3 -f lavfi -i "sine=frequency=440:sample_rate=48000" -t 40 -map 0:v -map 2:a -map 1:a -c:v libvpx-vp9 -deadline realtime -cpu-used 8 -b:v 40k -c:a libopus -b:a 48k -metadata:s:a:0 language=spa -metadata:s:a:1 language=eng -disposition:a:0 default -disposition:a:1 0 dos_pistas_40s.mkv
ffmpeg -y -f lavfi -i "testsrc2=size=160x90:rate=4" -t 10 -c:v libvpx-vp9 -deadline realtime -cpu-used 8 -b:v 40k sin_audio_10s.webm
```

- [ ] **Paso 2: escribir la prueba** `tests/verificar_archivo_audio.mjs` (completa; sus dos
  comprobaciones de «MP4 doblado» son de la Tarea 6 y fallarán hasta entonces):

```js
// tests/verificar_archivo_audio.mjs
/* JG Turbo · Audio de un video del equipo con Mediabunny REAL, sin red.
 *
 * Abre los videos de tests/fixtures/archivo/ como si la persona los eligiera
 * (input type=file), saca su audio en partes y comprueba lo que Whisper va a
 * recibir: formato, tamaño, duración de cada parte y que solo viaje UNA pista.
 * Corre en Chromium de Playwright y, si está instalado, en Chrome.
 *
 *   node tests/verificar_archivo_audio.mjs
 */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, join, extname } from 'node:path';
import { pathToFileURL } from 'node:url';

const app = resolve(import.meta.dirname, '..');
const { chromium } = await (async () => {
  const candidatos = [
    resolve(app, 'node_modules/playwright/index.mjs'),
    resolve(app, '../node_modules/playwright/index.mjs'),
    resolve(app, '../JG Turbo_OLD/node_modules/playwright/index.mjs'),
  ];
  for (const ruta of candidatos) {
    try { return await import(pathToFileURL(ruta).href); } catch (_) { /* siguiente */ }
  }
  throw new Error('Playwright no encontrado en: ' + candidatos.join(' · '));
})();

const TIPOS = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css' };
const PAGINA = `<!doctype html><meta charset="utf-8"><input type="file" id="f">
<script type="module">
import { abrirArchivoLocal, fabricarParteLocal, capturarPortada } from '/js/youtube/medioLocal.js';
import { planearTrozosTiempo } from '/js/youtube/archivoLocal.js';
window.probar = async ({ maxS = 360 } = {}) => {
  const archivo = document.getElementById('f').files[0];
  let abierto;
  try { abierto = await abrirArchivoLocal(archivo); } catch (e) { return { error: e.codigo || e.message }; }
  const trozos = planearTrozosTiempo(abierto.duracionS, { maxS: Math.min(maxS, abierto.extraccion.trozoS) });
  const partes = [];
  for (let k = 0; k < trozos.length; k += 1) {
    const { audio, nombre } = await fabricarParteLocal(abierto, trozos[k], k);
    // Lo que se sube se vuelve a abrir: ¿cuántas pistas y cuánto dura?
    const otra = await abrirArchivoLocal(new File([audio], nombre)).catch((e) => ({ error: e.message }));
    const pistas = otra.input ? (await otra.input.getAudioTracks()).length : 0;
    partes.push({ nombre, bytes: audio.size, tipo: audio.type, duracion: otra.duracionS || 0, pistas, codec: otra.audio?.codec || '' });
    otra.cerrar?.();
  }
  const salida = { modo: abierto.extraccion.modo, codec: abierto.audio.codec, duracion: abierto.duracionS, trozos, partes };
  abierto.cerrar();
  return salida;
};
window.portada = () => capturarPortada(URL.createObjectURL(document.getElementById('f').files[0]));
window.exportar = async () => {
  const ex = await import('/js/youtube/exportadorDoblaje.js');
  const mb = await import('/js/vendor/mediabunny/mediabunny.min.mjs');
  const voz = await (await fetch('/tests/fixtures/biblioteca/voz_1s.mp3')).blob();
  let buffer = null;
  const destino = { tipo: 'memoria', crearTarget: (m) => new m.BufferTarget(), terminar: async (o) => { buffer = o.target.buffer; } };
  const frases = [{ indice: 0, startTime: 1, texto: 'hola' }, { indice: 1, startTime: 12, texto: 'adiós' }];
  const t0 = performance.now();
  const r = await ex.exportarMp4Doblado({ archivo: document.getElementById('f').files[0], frases, sintetizar: async () => voz, destino });
  const leido = new mb.Input({ source: new mb.BufferSource(buffer), formats: mb.ALL_FORMATS });
  return { ...r, ms: Math.round(performance.now() - t0), duracion: Math.round(await leido.computeDuration()),
    video: (await leido.getPrimaryVideoTrack())?.codec, audio: (await leido.getPrimaryAudioTrack())?.codec,
    pistasAudio: (await leido.getAudioTracks()).length };
};
window.listo = true;
</script>`;

const servidor = createServer(async (pedido, respuesta) => {
  const ruta = decodeURIComponent(new URL(pedido.url, 'http://x').pathname);
  if (ruta === '/prueba.html') { respuesta.writeHead(200, { 'Content-Type': 'text/html' }); respuesta.end(PAGINA); return; }
  try {
    const cuerpo = await readFile(join(app, ruta));
    respuesta.writeHead(200, { 'Content-Type': TIPOS[extname(ruta)] || 'application/octet-stream' });
    respuesta.end(cuerpo);
  } catch (_) { respuesta.writeHead(404); respuesta.end(); }
});
await new Promise((r) => servidor.listen(0, '127.0.0.1', r));
// localhost (no 127.0.0.1 a secas tampoco sirve igual en todos): WebCodecs exige contexto seguro.
const BASE = `http://localhost:${servidor.address().port}`;

let ok = 0;
const fallos = [];
function comprobar(nombre, condicion, detalle = '') {
  if (condicion) { ok += 1; console.log(`OK: ${nombre}`); }
  else { fallos.push(nombre); console.error(`FALLO: ${nombre} ${detalle}`); }
}
const fixture = (n) => join(app, 'tests/fixtures/archivo', n);
const MB32 = 3.2 * 1024 * 1024;

for (const canal of ['chromium', 'chrome']) {
  let navegador;
  try { navegador = await chromium.launch(canal === 'chrome' ? { channel: 'chrome' } : {}); }
  catch (_) { console.log(`(sin ${canal} instalado: se omite)`); continue; }
  const pagina = await navegador.newPage();
  await pagina.goto(`${BASE}/prueba.html`);
  await pagina.waitForFunction(() => window.listo);
  const probar = async (archivo, opciones) => {
    await pagina.setInputFiles('#f', fixture(archivo));
    return pagina.evaluate((o) => window.probar(o), opciones || {});
  };

  const webm = await probar('clase_en_40s.webm', { maxS: 20 });
  comprobar(`[${canal}] WebM/Opus: se decodifica y sale MP3`, webm.modo === 'mp3' && webm.codec === 'opus', JSON.stringify(webm).slice(0, 200));
  comprobar(`[${canal}] 40 s en partes de 20 s → ${webm.partes?.length} partes MP3`, webm.partes?.length === 3 && webm.partes.every((p) => p.nombre.endsWith('.mp3') && p.tipo === 'audio/mpeg'));
  comprobar(`[${canal}] cada parte dura lo planeado (±0,5 s)`, webm.partes?.every((p, k) => Math.abs(p.duracion - (webm.trozos[k].finS - webm.trozos[k].inicioS)) < 0.5), JSON.stringify(webm.partes?.map((p) => p.duracion)));
  comprobar(`[${canal}] MP3 mono 32 kbps: 20 s ≈ 80 KB`, webm.partes?.[0].bytes > 40000 && webm.partes[0].bytes < 120000, String(webm.partes?.[0].bytes));

  const ac3 = await probar('clase_en_40s_ac3.mkv');
  comprobar(`[${canal}] MKV con AC-3: el navegador no lo decodifica → se COPIA`, ac3.modo === 'copia' && ac3.codec === 'ac3', JSON.stringify(ac3).slice(0, 200));
  comprobar(`[${canal}] AC-3 copiado viaja como .m4a y sigue siendo AC-3`, ac3.partes?.every((p) => p.nombre.endsWith('.m4a') && p.codec === 'ac3'));
  comprobar(`[${canal}] ninguna parte copiada pasa de 3,2 MB`, ac3.partes?.every((p) => p.bytes <= MB32));

  const dos = await probar('dos_pistas_40s.mkv');
  comprobar(`[${canal}] video con 2 pistas de audio: cada parte lleva UNA`, dos.partes?.length > 0 && dos.partes.every((p) => p.pistas === 1), JSON.stringify(dos.partes));

  const mudo = await probar('sin_audio_10s.webm');
  comprobar(`[${canal}] video sin sonido → archivo_sin_audio`, mudo.error === 'archivo_sin_audio', JSON.stringify(mudo));

  await pagina.setInputFiles('#f', fixture('clase_en_40s.webm'));
  const portada = await pagina.evaluate(() => window.portada());
  comprobar(`[${canal}] miniatura JPEG pequeña desde el propio video`, /^data:image\/jpeg;base64,/.test(portada) && portada.length < 60000, String(portada).slice(0, 40));

  for (const [archivo, video] of [['clase_en_40s.webm', 'vp9'], ['clase_en_40s_ac3.mkv', 'avc']]) {
    if (canal === 'chromium' && video === 'avc') continue;   // el Chromium de Playwright no trae el codificador H.264… pero aquí solo se COPIA: se mide en Chrome
    await pagina.setInputFiles('#f', fixture(archivo));
    const mp4 = await pagina.evaluate(() => window.exportar()).catch((e) => ({ error: e.message }));
    comprobar(`[${canal}] MP4 doblado desde ${archivo}: video ${video} copiado + AAC, 40 s`, mp4.video === video && mp4.audio === 'aac' && mp4.pistasAudio === 1 && Math.abs(mp4.duracion - 40) <= 1, JSON.stringify(mp4));
    comprobar(`[${canal}] ${archivo}: el original de fondo solo si se puede decodificar`, mp4.conOriginal === (video === 'vp9'), String(mp4.conOriginal));
  }
  await navegador.close();
}
servidor.close();
console.log(`\n${ok} comprobaciones OK · ${fallos.length} fallos`);
if (fallos.length) process.exit(1);
```

- [ ] **Paso 3: crear** `js/youtube/medioLocal.js`:

```js
// js/youtube/medioLocal.js
/**
 * Leer un video del equipo con Mediabunny (js/vendor/mediabunny/, carga diferida):
 * qué trae, y su audio en partes listas para Whisper. El archivo se lee por
 * rangos (`BlobSource`): un video de 1 GB no se carga entero en memoria.
 *
 * WebCodecs (lo que decodifica el audio) solo existe en contexto seguro: https o
 * localhost. En http://otro-host todo sale «no se puede decodificar» (medido).
 */
import { cargarMedios, asegurarMp3, RUTA_MEDIOS } from './medios.js';
import { ErrorYoutube } from './transcriptionService.js';
import { BYTES_MAX_PARTE } from './transcripcionPartes.js';
import { elegirModoExtraccion } from './archivoLocal.js';

const BYTES_TOPE_SUBIDA = 4.2 * 1024 * 1024;   // Vercel rechaza ~4,5 MB por petición

/**
 * Abre el archivo y describe lo que trae. Devuelve un objeto con `input` vivo:
 * quien llama debe soltarlo con `cerrar()` al terminar.
 */
export async function abrirArchivoLocal(archivo, { rutaMedios = RUTA_MEDIOS } = {}) {
  const mb = await cargarMedios(rutaMedios);
  const input = new mb.Input({ source: new mb.BlobSource(archivo), formats: mb.ALL_FORMATS });
  const cerrar = () => { try { input.dispose?.(); } catch (_) { /* ya cerrado */ } };
  try {
    let formato = '';
    try { formato = (await input.getFormat()).name; } catch (_) {
      throw new ErrorYoutube('No reconocemos este formato de video. Prueba con un MP4, MOV, MKV o WebM.', 'archivo_formato');
    }
    const duracionS = Number(await input.computeDuration()) || 0;
    const pista = await input.getPrimaryAudioTrack();
    if (!pista) throw new ErrorYoutube('Este video no tiene sonido: no hay nada que doblar.', 'archivo_sin_audio');
    const decodifica = await pista.canDecode().catch(() => false);
    let bitrate = 0;
    if (!decodifica) {
      // Solo hace falta para copiar: 0,2 s en 60 min de MP4 (medido).
      try { bitrate = Math.round((await pista.computePacketStats()).averageBitrate) || 0; } catch (_) { bitrate = 0; }
    }
    const video = await input.getPrimaryVideoTrack();
    const audio = { codec: pista.codec || '', decodifica, bitrate, canales: pista.numberOfChannels, hz: pista.sampleRate };
    return {
      mb, rutaMedios, input, pista, formato, duracionS, cerrar,
      audio,
      video: video ? { codec: video.codec || '', ancho: video.displayWidth, alto: video.displayHeight } : null,
      extraccion: elegirModoExtraccion(audio),
    };
  } catch (error) {
    cerrar();
    throw error;
  }
}

async function opcionesDeSalida(mb, extraccion, rutaMedios) {
  if (extraccion.modo === 'mp3') {
    await asegurarMp3(mb, rutaMedios);
    return {
      format: new mb.Mp3OutputFormat(), ext: 'mp3', tipo: 'audio/mpeg',
      audio: { codec: 'mp3', numberOfChannels: 1, sampleRate: 16000, bitrate: 32000 },
    };
  }
  if (extraccion.contenedor === 'webm') return { format: new mb.WebMOutputFormat(), ext: 'webm', tipo: 'audio/webm', audio: {} };
  return { format: new mb.Mp4OutputFormat({ fastStart: 'in-memory' }), ext: 'm4a', tipo: 'audio/mp4', audio: {} };
}

/** La parte `trozo` ({ inicioS, finS }) del audio, como Blob listo para /api/transcribe. */
export async function fabricarParteLocal(abierto, trozo, k) {
  const { mb, input, pista, extraccion, rutaMedios = RUTA_MEDIOS } = abierto;
  const salida = await opcionesDeSalida(mb, extraccion, rutaMedios);
  const output = new mb.Output({ format: salida.format, target: new mb.BufferTarget() });
  const conversion = await mb.Conversion.init({
    input,
    output,
    video: { discard: true },
    // Con varias pistas de audio (MKV con doblajes) solo viaja la principal.
    audio: (t) => (t.id === pista.id ? salida.audio : { discard: true }),
    trim: { start: trozo.inicioS, end: trozo.finS },
  });
  if (!conversion.isValid) {
    throw new ErrorYoutube('Este navegador no pudo preparar el audio de este video. Prueba en Chrome de computador.', 'archivo_audio');
  }
  await conversion.execute();
  const bytes = output.target.buffer?.byteLength || 0;
  if (bytes > BYTES_TOPE_SUBIDA) {
    throw new ErrorYoutube('Una parte del audio salió más pesada de lo que acepta el servidor. Conviértelo a MP4 (AAC) e inténtalo otra vez.', 'archivo_parte_grande');
  }
  if (bytes > BYTES_MAX_PARTE) console.warn('[jg-archivo] parte por encima de 3,2 MB:', bytes);
  return { audio: new Blob([output.target.buffer], { type: salida.tipo }), nombre: `equipo_parte_${k + 1}.${salida.ext}` };
}

/**
 * Miniatura para la biblioteca: un cuadro del 10 % del video (máx. 30 s), en un
 * <video> aparte para no mover el del reproductor. JPEG de ≤ 320 px (~7 KB medido).
 * Si el navegador no puede, devuelve '' (la tarjeta muestra la inicial).
 */
export function capturarPortada(url, { anchoMax = 320, esperaMs = 8000 } = {}) {
  return new Promise((resolver) => {
    const video = document.createElement('video');
    video.muted = true;
    video.playsInline = true;
    video.preload = 'auto';
    let listo = false;
    const terminar = (valor) => {
      if (listo) return;
      listo = true;
      clearTimeout(tope);
      video.removeAttribute('src');
      video.load();
      resolver(valor);
    };
    const tope = setTimeout(() => terminar(''), esperaMs);
    video.addEventListener('error', () => terminar(''), { once: true });
    video.addEventListener('loadedmetadata', () => {
      const d = Number(video.duration) || 0;
      video.currentTime = Math.min(30, Math.max(0, d * 0.1));
    }, { once: true });
    video.addEventListener('seeked', () => {
      try {
        const escala = Math.min(1, anchoMax / (video.videoWidth || anchoMax));
        const lienzo = document.createElement('canvas');
        lienzo.width = Math.max(1, Math.round((video.videoWidth || anchoMax) * escala));
        lienzo.height = Math.max(1, Math.round((video.videoHeight || anchoMax * 0.5625) * escala));
        lienzo.getContext('2d').drawImage(video, 0, 0, lienzo.width, lienzo.height);
        terminar(lienzo.toDataURL('image/jpeg', 0.7));
      } catch (_) {
        terminar('');
      }
    }, { once: true });
    video.src = url;
  });
}
```

- [ ] **Paso 4: contar.** `node tests/verificar_archivo_audio.mjs` → **10 OK por navegador** en lo de
  esta tarea (Chromium y Chrome: MP3 desde Opus, partes con su duración, tamaño MP3, AC-3 **copiado**
  como `.m4a` sin dejar de ser AC-3, partes ≤ 3,2 MB, UNA pista con dos audios, sin sonido →
  `archivo_sin_audio`, miniatura `data:image/jpeg`). Las del MP4 doblado (2 en Chromium, 4 en Chrome) fallan hasta la Tarea 6.
- [ ] **Paso 5: commit** (`feat: audio de videos del equipo con Mediabunny (MP3 o copia)` + fixtures +
  `.gitignore`).

### Tarea 6: MP4 doblado desde un archivo del equipo (+ fallo de 32 kHz)

**Archivos:** `js/youtube/exportadorDoblaje.js`.

- [ ] **Paso 1: aplicar** (nuevo nombre `exportarMp4Doblado` con `archivo` o `mp4Url`, alias
  `exportarMp4DobladoX`, guarda contra recodificar video y la corrección de frecuencia M15):

```diff
diff --git a/js/youtube/exportadorDoblaje.js b/js/youtube/exportadorDoblaje.js
index 327f4b4..010d24b 100644
--- a/js/youtube/exportadorDoblaje.js
+++ b/js/youtube/exportadorDoblaje.js
@@ -1,7 +1,7 @@
 /**
  * Archivos del doblaje, armados en el navegador con Mediabunny:
  *  - `exportarMp3`: la voz en español del video entero, cada frase en su segundo.
- *  - `exportarMp4DobladoX`: el video de X con la voz en español y el audio original bajito.
+ *  - `exportarMp4Doblado`: el video (de X o del equipo) con la voz en español y el original bajito.
  *  - `descargarOriginalX`: el MP4 original de X, sin tocarlo.
  *
  * Nada de esto cabe en el servidor (60 s y ~4,5 MB por petición). Medido en
@@ -146,25 +146,37 @@ export async function exportarMp3({
   return { frases: voces.plan.length, aceleradas: voces.aceleradas, corridas: voces.corridas };
 }
 
-/** El video de X con la voz en español. El video se copia tal cual (no se recodifica). */
-export async function exportarMp4DobladoX({
-  mp4Url, frases, sintetizar, destino, signal = null, onProgreso = () => {},
+/**
+ * El video con la voz en español. El video se copia tal cual (no se recodifica).
+ * Fuente: `mp4Url` (X) o `archivo` (un video del equipo, File/Blob leído por rangos).
+ */
+export async function exportarMp4Doblado({
+  mp4Url = '', archivo = null, frases, sintetizar, destino, signal = null, onProgreso = () => {},
   volumenOriginal = VOLUMEN_ORIGINAL, rutaMedios = RUTA_MEDIOS,
 }) {
   const mb = await cargarMedios(rutaMedios);
   await asegurarAac(mb, rutaMedios);
   // X responde 403 a peticiones con Referer de otro dominio (TRAMPAS.md): Mediabunny pide por rangos con esto.
   const input = new mb.Input({
-    source: new mb.UrlSource(mp4Url, { requestInit: { referrerPolicy: 'no-referrer', credentials: 'omit' } }),
+    source: archivo
+      ? new mb.BlobSource(archivo)
+      : new mb.UrlSource(mp4Url, { requestInit: { referrerPolicy: 'no-referrer', credentials: 'omit' } }),
     formats: mb.ALL_FORMATS,
   });
   let output = null;
   try {
+    const pistaVideo = await input.getPrimaryVideoTrack();
+    // Un códec que MP4 no lleva obligaría a recodificar el video entero: minutos u horas en el navegador.
+    if (pistaVideo && !new mb.Mp4OutputFormat().getSupportedVideoCodecs().includes(pistaVideo.codec)) {
+      throw new Error('El video de este archivo no se puede guardar como MP4 sin recodificarlo. Descarga el audio en español (MP3).');
+    }
     const duracionVideoS = await input.computeDuration();
     const voces = await prepararVoces(frases, { sintetizar, duracionVideoS, signal, onProgreso });
     const pistaOriginal = await input.getPrimaryAudioTrack();
     const original = pistaOriginal && await pistaOriginal.canDecode() ? new mb.AudioBufferSink(pistaOriginal) : null;
-    const hz = pistaOriginal?.sampleRate || HZ_MP4;
+    // El AAC del navegador no acepta cualquier frecuencia (32 kHz de un AC-3 falló en Chrome, medido):
+    // fuera de 44,1/48 kHz se mezcla a 48 kHz (OfflineAudioContext remuestrea el original solo).
+    const hz = [44100, 48000].includes(pistaOriginal?.sampleRate) ? pistaOriginal.sampleRate : HZ_MP4;
     output = new mb.Output({
       // Al disco, el índice va al final (se escribe por posiciones); en memoria, al principio.
       format: new mb.Mp4OutputFormat({ fastStart: destino.tipo === 'disco' ? false : 'in-memory' }),
@@ -200,6 +212,9 @@ export async function exportarMp4DobladoX({
   }
 }
 
+/** Nombre de antes: X lo sigue usando igual. */
+export const exportarMp4DobladoX = exportarMp4Doblado;
+
 /** El MP4 original de X, de un tirón: al disco en escritorio, en memoria en el celular. */
 export async function descargarOriginalX({ mp4Url, destino, signal = null, onProgreso = () => {} }) {
   const respuesta = await fetch(mp4Url, { referrerPolicy: 'no-referrer', credentials: 'omit', signal });
```

- [ ] **Paso 2: contar.**

```bash
node tests/verificar_archivo_audio.mjs     # 26 OK (Chromium 12 · Chrome 14)
node tests/verificar_biblioteca_datos.mjs  # 48 OK (X y MP3 sin cambios)
```

Contraprueba (opcional pero recomendada): vuelve a poner `const hz = pistaOriginal?.sampleRate || HZ_MP4;`
y comprueba que falla «MP4 doblado desde clase_en_40s_ac3.mkv» en Chrome con `32000 Hz is not supported`.
Restaura la corrección.

- [ ] **Paso 3: commit** (`fix: mp4 doblado mezcla a 44,1/48 kHz y acepta videos del equipo`).

---

## Fase 3 · Integración en la pestaña Videos

> Antes de tocar la interfaz, si tienes la habilidad **impeccable**, cárgala y lee el brief:
> `.impeccable/surfaces/js-youtube-youtubesynccontroller-js.md` (modo Operate, extensión de superficie;
> sin torneo de conceptos ni DESIGN.md nuevo). Si no la tienes, el brief es igual de válido como texto.

### Tarea 7: `XVideoPlayer` sirve también para el video del equipo

**Archivos:** `js/youtube/XVideoPlayer.js` (dos opciones con los valores de X por defecto).

- [ ] **Paso 1: aplicar:**

```diff
diff --git a/js/youtube/XVideoPlayer.js b/js/youtube/XVideoPlayer.js
index 9f6d55c..d7d2c80 100644
--- a/js/youtube/XVideoPlayer.js
+++ b/js/youtube/XVideoPlayer.js
@@ -18,8 +18,17 @@ export function estadoDeVideo(video, { arranco = false } = {}) {
 }
 
 export class XVideoPlayer {
-  constructor(elemento, { mp4 = '', portada = '', titulo = '' } = {}) {
+  /**
+   * `etiqueta` y `mensajeError`: los videos del equipo usan este mismo reproductor
+   * (un blob: del mismo origen carga igual dentro del iframe, medido 2026-10-01).
+   */
+  constructor(elemento, {
+    mp4 = '', portada = '', titulo = '', etiqueta = 'Video de X',
+    mensajeError = 'X no dejó reproducir este video aquí. Prueba de nuevo o ábrelo en x.com.',
+  } = {}) {
     this.destino = typeof elemento === 'string' ? document.getElementById(elemento) : elemento;
+    this.etiqueta = etiqueta;
+    this.mensajeError = mensajeError;
     this.mp4 = mp4;
     this.portada = portada;
     this.titulo = titulo;
@@ -35,7 +44,7 @@ export class XVideoPlayer {
     if (!this.destino) throw new Error('No hay dónde poner el reproductor de X.');
     const marco = document.createElement('iframe');
     marco.id = this.destino.id || 'ytPlayer';
-    marco.title = this.titulo ? `Video de X: ${this.titulo}` : 'Video de X';
+    marco.title = this.titulo ? `${this.etiqueta}: ${this.titulo}` : this.etiqueta;
     marco.setAttribute('allow', 'autoplay; fullscreen; picture-in-picture');
     marco.setAttribute('referrerpolicy', 'no-referrer');
     const cargado = new Promise((resolver) => marco.addEventListener('load', resolver, { once: true }));
@@ -61,7 +70,7 @@ export class XVideoPlayer {
     await new Promise((resolver, rechazar) => {
       const limpiar = () => { clearTimeout(tope); video.removeEventListener('loadedmetadata', listo); video.removeEventListener('error', fallo); };
       const listo = () => { limpiar(); resolver(); };
-      const fallo = () => { limpiar(); rechazar(new Error('X no dejó reproducir este video aquí. Prueba de nuevo o ábrelo en x.com.')); };
+      const fallo = () => { limpiar(); rechazar(new Error(this.mensajeError)); };
       const tope = setTimeout(() => { limpiar(); resolver(); }, ESPERA_METADATOS_MS);   // lento ≠ roto: se sigue
       video.addEventListener('loadedmetadata', listo);
       video.addEventListener('error', fallo);
```

- [ ] **Paso 2:** `node tests/test_x_doblaje.mjs` (70) y `node tests/verificar_x_doblaje.mjs` (24).
- [ ] **Paso 3: commit** (`refactor: reproductor HTML5 con etiqueta y mensaje configurables`).

### Tarea 8: `index.html` — la puerta del archivo, estilos y el puente desde Archivo

Qué entra: texto del encabezado del panel; aviso del servidor genérico; bloque `.yt-equipo` (la «o»,
el botón **«Elegir un video de tu equipo»**, el `input` oculto y la ayuda); la ficha
`#ytFichaArchivo`; el aviso `#ytEquipoAviso`; filtro **«Tu equipo»** en la biblioteca; texto del
estado vacío; botón **«Elegir el video original»** en el diálogo de descargas; las reglas que esconden
todo eso mientras se dobla (`.yt-area.has-results …`); el estilo de soltar (`.yt-soltando`); y en la
pestaña **Archivo**: la caja `#fileDoblarVideo` + `ofrecerDoblarVideo` (no cambia lo que Archivo ya hace;
solo ofrece llevar un video a Videos, también si pesa más de lo que Archivo transcribe).

**Archivos:** `index.html`.

- [ ] **Paso 1: aplicar:**

```diff
diff --git a/index.html b/index.html
index f19c17d..94f7690 100644
--- a/index.html
+++ b/index.html
@@ -1024,6 +1024,9 @@
   .yt-area.has-results > p,
   .yt-area.has-results .panel-lead,
   .yt-area.has-results .ytrow,
+  .yt-area.has-results .yt-equipo,
+  .yt-area.has-results .yt-ficha-archivo,
+  .yt-area.has-results .yt-equipo-aviso,
   .yt-area.has-results .yt-opts,
   .yt-area.has-results .yt-manual,
   .yt-area.has-results #ytServerWarn {
@@ -4021,6 +4024,27 @@
   .ytrow input{flex:1;min-width:180px;background:var(--bg-2);border:1px solid var(--line);color:var(--text);
     font-family:inherit;font-size:13px;padding:9px 12px;border-radius:10px;outline:none;transition:.15s}
   .ytrow input:focus{border-color:var(--cyan-glow)}
+  .file-doblar{display:flex;align-items:center;flex-wrap:wrap;gap:8px 12px;margin:0 0 12px}
+  .file-doblar[hidden]{display:none}
+  .file-doblar p{margin:0;font-size:13px;color:var(--muted)}
+  .file-area .file-doblar .btn{min-height:var(--h-touch)}
+  /* Video del equipo: segunda puerta de entrada, al mismo nivel que el enlace. */
+  .yt-equipo{display:flex;align-items:center;flex-wrap:wrap;gap:8px 12px;margin:0 0 12px;flex:none}
+  .yt-equipo-o{font-size:var(--fs-xs);color:var(--muted-2);text-transform:uppercase;letter-spacing:.08em}
+  .yt-area .yt-equipo .yt-equipo-btn{min-height:var(--h-touch);gap:8px}
+  .yt-area .yt-equipo .yt-equipo-btn svg{width:18px;height:18px;flex:none}
+  .yt-equipo-ayuda{flex-basis:100%;margin:0;font-size:13px;line-height:1.45;color:var(--muted-2)}
+  .yt-ficha-archivo{display:flex;align-items:center;gap:12px;margin:0 0 12px;padding:10px 12px;flex:none;
+    background:var(--surface);border:1px solid var(--cyan-glow);border-radius:12px}
+  .yt-ficha-archivo[hidden]{display:none}
+  .yt-ficha-archivo > svg{width:22px;height:22px;flex:none;color:var(--cyan)}
+  .yt-ficha-texto{display:flex;flex-direction:column;min-width:0;flex:1}
+  .yt-ficha-texto strong{font-size:var(--fs-sm);color:var(--text);overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow-wrap:anywhere}
+  .yt-ficha-texto span{font-size:13px;color:var(--muted)}
+  .yt-ficha-archivo .mini-btn{min-height:48px;min-width:48px;flex:none}   /* 44 exactos dan 43,99 px en pantallas de densidad 2,625 */
+  .yt-equipo-aviso{margin:0 0 12px;font-size:13px;line-height:1.45;color:var(--hot-1)}
+  .yt-equipo-aviso:empty{display:none}
+  .yt-area.yt-soltando{outline:2px dashed var(--cyan);outline-offset:-6px;border-radius:16px}
   .yt-source-badge{display:inline-block;font-size:10px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;
     padding:2px 7px;border-radius:999px;margin-left:6px}
   .yt-source-badge.subs{background:rgba(39,225,193,.12);color:var(--cyan);border:1px solid var(--cyan-glow)}
@@ -4255,6 +4279,9 @@
     .ytrow{flex-direction:column;align-items:stretch}
     .ytrow input{min-width:0;width:100%;font-size:15px !important}
     .ytrow .btn{width:100%;min-width:0 !important;max-width:none}
+    .yt-equipo{flex-direction:column;align-items:stretch}
+    .yt-equipo-o{text-align:center}
+    .yt-area .yt-equipo .yt-equipo-btn{width:100%;justify-content:center}
     .yt-opts select, .file-opts select{
       width:100%;
       max-width:100%;
@@ -6355,6 +6382,11 @@ body.jg-leyendo .pdf-texto-col[data-paginado="si"]{overflow:clip}
           <span class="drop-action" aria-hidden="true">Elegir archivo</span>
           <input type="file" class="sr-only" id="fileInput" name="archivo_audio" aria-label="Archivo de audio" accept="audio/*,audio/ogg,audio/opus,audio/mp4,audio/aac,audio/amr,.ogg,.opus,.m4a,.mp3,.wav,.aac,.webm,.flac,.caf,.amr,.3gp,video/mp4,video/webm">
         </div>
+        <!-- Un VIDEO elegido o compartido aquí se puede ver doblado en la pestaña Videos (sin copiarlo). -->
+        <div class="file-doblar" id="fileDoblarVideo" hidden>
+          <p>Es un video: también puedes verlo con voz en español.</p>
+          <button class="btn" id="btnFileDoblarVideo" type="button">Doblar este video al español</button>
+        </div>
 
         <div class="file-opts" aria-label="Opciones de la transcripción">
           <label class="select-labeled" for="fileLang">
@@ -6543,13 +6575,13 @@ body.jg-leyendo .pdf-texto-col[data-paginado="si"]{overflow:clip}
     <div class="card">
       <div class="yt-area">
         <div class="panel-lead">
-          <h2>Mira videos de YouTube y X en español</h2>
-          <p>Pega el enlace de YouTube o de X (Twitter) y pulsa <b>Doblar al español</b>: la voz empieza en segundos y el resto se prepara mientras ves. Funciona con videos en inglés, portugués, francés, alemán o italiano.</p>
+          <h2>Mira videos en español: de YouTube, de X o de tu equipo</h2>
+          <p>Pega el enlace de YouTube o de X (Twitter), o elige un video que tengas guardado, y pulsa <b>Doblar al español</b>: la voz empieza en segundos y el resto se prepara mientras ves. Funciona con videos en inglés, portugués, francés, alemán o italiano.</p>
         </div>
 
         <div id="ytServerWarn" class="notice warn" style="margin:0 0 12px">
           <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
-          <div>Conecta el servidor (indicador de arriba) para usar YouTube y X.</div>
+          <div>Conecta el servidor (indicador de arriba) para doblar videos.</div>
         </div>
 
         <div class="ytrow">
@@ -6560,6 +6592,23 @@ body.jg-leyendo .pdf-texto-col[data-paginado="si"]{overflow:clip}
           <p class="yt-url-nota" id="ytUrlNota" hidden>Enlace de X: pulsa <b>Doblar al español</b>. El texto completo traducido sale después con el botón <b>Texto completo</b>.</p>
         </div>
 
+        <!-- Video del equipo: el archivo NO se copia a la app; solo su audio viaja (por partes) para transcribirlo. -->
+        <div class="yt-equipo" id="ytEquipo">
+          <span class="yt-equipo-o" aria-hidden="true">o</span>
+          <button class="btn yt-equipo-btn" id="ytElegirArchivo" type="button" aria-describedby="ytEquipoAyuda">
+            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="3"/><path d="m10 9 5 3-5 3z"/></svg>
+            Elegir un video de tu equipo
+          </button>
+          <input type="file" id="ytArchivo" class="sr-only" tabindex="-1" aria-hidden="true" accept="video/*,.mp4,.m4v,.mov,.mkv,.webm">
+          <p class="yt-equipo-ayuda" id="ytEquipoAyuda">MP4, MOV, MKV o WebM, de hasta 3 horas. El video no sale de tu equipo: solo viaja su audio para transcribirlo.</p>
+        </div>
+        <div class="yt-ficha-archivo" id="ytFichaArchivo" hidden>
+          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="3"/><path d="m10 9 5 3-5 3z"/></svg>
+          <div class="yt-ficha-texto"><strong id="ytFichaNombre"></strong><span id="ytFichaDatos"></span></div>
+          <button class="mini-btn" id="ytFichaQuitar" type="button" aria-label="Quitar el video elegido">Quitar</button>
+        </div>
+        <p class="yt-equipo-aviso" id="ytEquipoAviso" role="status" aria-live="polite"></p>
+
         <div class="yt-opts" aria-label="Idioma del video">
           <label class="task-field" for="ytLang">
             <span class="task-field-label">Idioma del video</span>
@@ -6728,7 +6777,7 @@ body.jg-leyendo .pdf-texto-col[data-paginado="si"]{overflow:clip}
             <div class="vid-vacio" id="vidVacio" hidden>
               <svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><rect x="5" y="10" width="38" height="28" rx="7"/><path d="m21 18 10 6-10 6z"/><path d="M14 6h20"/></svg>
               <strong>Tu biblioteca empieza con el próximo video</strong>
-              <p>Dobla un enlace con el botón de arriba. Aquí quedará listo para retomarlo, organizarlo y descargar su voz.</p>
+              <p>Dobla un enlace o un video de tu equipo con el botón de arriba. Aquí quedará listo para retomarlo, organizarlo y descargar su voz.</p>
             </div>
             <article class="vid-seguir" id="vidSeguir" hidden></article>
             <div class="vid-herramientas">
@@ -6743,6 +6792,7 @@ body.jg-leyendo .pdf-texto-col[data-paginado="si"]{overflow:clip}
               <button type="button" data-vista="todos" aria-pressed="true">Todos</button>
               <button type="button" data-plataforma="youtube" aria-pressed="false">YouTube</button>
               <button type="button" data-plataforma="x" aria-pressed="false">X</button>
+              <button type="button" data-plataforma="archivo" aria-pressed="false">Tu equipo</button>
               <button type="button" data-vista="favoritos" aria-pressed="false">Favoritos</button>
               <button type="button" data-vista="viendo" aria-pressed="false">En curso</button>
               <button type="button" data-vista="vistos" aria-pressed="false">Vistos</button>
@@ -6777,6 +6827,7 @@ body.jg-leyendo .pdf-texto-col[data-paginado="si"]{overflow:clip}
               </fieldset>
               <label class="vid-calidad" for="vidCalidad">Calidad<select id="vidCalidad"></select></label>
               <p id="vidDescargaEstado" role="status" aria-live="polite">Calculando tamaño…</p>
+              <button class="btn" id="vidElegirOriginal" type="button" hidden>Elegir el video original</button>
               <div class="vid-descarga-acciones"><button class="btn primary" id="vidDescargar" type="button">Descargar</button><button class="btn" id="vidDescargaCancelar" type="button" hidden>Cancelar</button><button class="btn" id="vidGuardarOtraVez" type="button" hidden>Guardar archivo</button></div>
             </div>
           </dialog>
@@ -12975,9 +13026,34 @@ function asignarArchivoAlInput(file){
   }
 }
 
+/* Un video (también los compartidos desde el teléfono) se ofrece para doblarlo en
+ * Videos. Se guarda la referencia: si pesa más que el límite de transcripción,
+ * el input se vacía abajo y el doblaje igual puede usarlo (allí no hay ese límite). */
+let jgVideoParaDoblar = null;
+function ofrecerDoblarVideo(f){
+  const caja = document.getElementById('fileDoblarVideo');
+  if(!caja) return;
+  const esVideo = /^video\//i.test((f && f.type) || '') || /\.(mp4|m4v|mov|mkv|webm)$/i.test((f && f.name) || '');
+  jgVideoParaDoblar = esVideo ? f : null;
+  caja.hidden = !esVideo;
+}
+document.getElementById('btnFileDoblarVideo')?.addEventListener('click', async () => {
+  const f = jgVideoParaDoblar;
+  if(!f) return;
+  activarTab('yt');
+  try{ await window.jgAsegurarYoutube?.(); }catch(_){}
+  if(window.jgVideoLocal && window.jgVideoLocal.elegir(f)){
+    document.getElementById('ytSyncBtn')?.focus();
+  } else {
+    const caja = document.getElementById('fileDoblarVideo');
+    if(caja) caja.querySelector('p').textContent = 'No pudimos pasar el video a la pestaña Videos. Elígelo allí con «Elegir un video de tu equipo».';
+  }
+});
+
 function onFileSelected(opts = {}){
   const f = fileInput.files[0];
   if(!f) return;
+  ofrecerDoblarVideo(f);
   if((f.size / 1024 / 1024) > limitesServidor.maxAudioMb){
     fname.textContent = `✗ Archivo demasiado grande. Máximo: ${limitesServidor.maxAudioMb} MB`;
     if(fileActionHint) fileActionHint.textContent = `Elige un archivo de máximo ${limitesServidor.maxAudioMb} MB.`;
```

- [ ] **Paso 2:** abre la app en local (`?tab=yt`) en 390 px y 1280 px: el botón mide ≥ 44 px, no hay
  desborde, el foco se ve con teclado. (La conducta llega en la Tarea 9; aquí solo el aspecto.)
- [ ] **Paso 3: commit** (`feat(ui): puerta para elegir un video del equipo en Videos`).

### Tarea 9: el controlador — elegir, doblar, reabrir, descargar

Qué entra en `youtubeSyncController.js` (en este orden en el diff):

1. Imports de `ServicioArchivo`, `validarArchivo`, `huellaArchivo`, `resumenAntesDeEmpezar`, `formatearBytes`.
2. `ui.*` nuevos y el estado `archivoElegido` / `ultimoArchivo` (el `File` en memoria: la app no lo copia).
3. Botón principal habilitado con archivo **o** enlace.
4. Elegir / quitar / soltar / `pedirArchivo()` (selector de un solo uso **dentro del gesto**) y
   `window.jgVideoLocal.elegir` (lo usa el puente de Archivo).
5. `terminarSesion` suelta el `input` de Mediabunny y revoca el `blob:`.
6. `crearReproductorArchivo` (XVideoPlayer con etiqueta y mensaje propios).
7. `completarSesion` guarda `nombreArchivo` y `bytes` en la ficha.
8. `iniciarSesion` desvía a `iniciarSesionArchivo` cuando hay archivo.
9. `iniciarSesionArchivo`: huella → `abrirSesion(clave)` → inspeccionar → reproductor y miniatura en
   paralelo → caché o transcripción (con **retomar**: `parcial` con el mismo `trozoS` y el mismo idioma)
   → `decidirDoblaje` → `completarSesion` → aviso si el original no suena (AC-3).
10. `abrirArchivoDeBiblioteca` (pide el mismo archivo en el mismo clic; devuelve `pendiente`) y
    `elegirArchivoPara` (MP4 doblado).
11. `opcionesDescarga` y `descargarDeBiblioteca` para `plataforma: 'archivo'` (MP3 y MP4; nunca original).
12. `elegirArchivoPara` llega a la vista por `deps`.

**Archivos:** `js/youtube/youtubeSyncController.js`.

- [ ] **Paso 1: aplicar:**

```diff
diff --git a/js/youtube/youtubeSyncController.js b/js/youtube/youtubeSyncController.js
index 008d939..5f5bf2f 100644
--- a/js/youtube/youtubeSyncController.js
+++ b/js/youtube/youtubeSyncController.js
@@ -9,6 +9,8 @@
 import { TranscriptionService, ErrorYoutube } from './transcriptionService.js';
 import { detectarFuente } from './fuenteVideo.js';
 import { ServicioX, tituloX } from './servicioX.js';
+import { ServicioArchivo } from './servicioArchivo.js';
+import { validarArchivo, huellaArchivo, resumenAntesDeEmpezar } from './archivoLocal.js';
 import { elegirMp4 } from './audioX.js';
 import { XVideoPlayer } from './XVideoPlayer.js';
 import { TranslationService } from './translationService.js';
@@ -27,7 +29,7 @@ import {
 } from './cacheDoblaje.js';
 import { claveDeVoz } from './bibliotecaVideos.js';
 import { medirHabla } from './hablaVoz.js';
-import { estimarBytesMp3, estimarBytesVideo, opcionesCalidadX, nombreArchivo, BITRATE_AUDIO_DOBLADO } from './descargaDestino.js';
+import { estimarBytesMp3, estimarBytesVideo, opcionesCalidadX, nombreArchivo, BITRATE_AUDIO_DOBLADO, formatearBytes } from './descargaDestino.js';
 import { crearDestino } from './destinoArchivo.js';
 import {
   hayDialogo, elegirVocesAutomaticas, vozParaUnidad, generoDeVoz,
@@ -83,10 +85,18 @@ export function inicializarYoutubeSincronizado({
       voz: $('ytVozSelect'), voz2: $('ytVoz2Select'), voz2Wrap: $('ytVoz2Wrap'),
     tarjeta: $('ytDubProgreso'), barra: $('ytDubBarra'), mensaje: $('ytDubMensaje'), tiempo: $('ytDubTiempo'),
     ayuda: $('ytDubAyuda'), cancelar: $('ytDubCancelar'),
+    archivo: $('ytArchivo'), elegirArchivo: $('ytElegirArchivo'), ficha: $('ytFichaArchivo'),
+    fichaNombre: $('ytFichaNombre'), fichaDatos: $('ytFichaDatos'), fichaQuitar: $('ytFichaQuitar'),
+    avisoEquipo: $('ytEquipoAviso'),
   };
   const display = new TranscriptionDisplay($('ytSyncDisplay'), ui.caption);
   const transcripciones = new TranscriptionService({ fetchApi });
   const servicioX = new ServicioX({ fetchApi });
+  const servicioArchivo = new ServicioArchivo({ fetchApi });
+  // Video del equipo elegido en el formulario (uno a la vez) y el último que se abrió:
+  // el MP4 doblado necesita el archivo original y la app no lo copia.
+  let archivoElegido = null;
+  let ultimoArchivo = null;   // { clave, archivo }
   // Ritmo de Mistral gratis (≈1 petición/s) para TODA llamada del traductor:
   // lotes, mitades de un lote partido y el texto completo.
   const traductor = new TranslationService({ traducirTexto, intervaloMinMs: 1100 });
@@ -342,7 +352,7 @@ export function inicializarYoutubeSincronizado({
   // ── Botón principal: ocupado mientras trabaja (auditoría H7) ────────────
   const estaOcupado = () => ui.boton.dataset.ocupado === '1';
   function actualizarBoton() {
-    ui.boton.disabled = estaOcupado() || !detectarFuente(ui.url.value) || !estaServidorOnline();
+    ui.boton.disabled = estaOcupado() || !(archivoElegido || detectarFuente(ui.url.value)) || !estaServidorOnline();
   }
   function marcarOcupado(activo) {
     if (activo) ui.boton.dataset.ocupado = '1';
@@ -363,6 +373,65 @@ export function inicializarYoutubeSincronizado({
   ui.url.addEventListener('input', pintarNotaUrl);
   pintarNotaUrl();
 
+  // ── Video del equipo: elegir, arrastrar, quitar ─────────────────────────
+  const ACEPTA_VIDEO = 'video/*,.mp4,.m4v,.mov,.mkv,.webm';
+  const avisarEquipo = (texto) => { if (ui.avisoEquipo) ui.avisoEquipo.textContent = texto || ''; };
+  function quitarArchivo() {
+    archivoElegido = null;
+    if (ui.ficha) ui.ficha.hidden = true;
+    if (ui.archivo) ui.archivo.value = '';
+    actualizarBoton();
+  }
+  /** Pone el archivo en el formulario (no empieza: el idioma y «Doblar» siguen siendo de la persona). */
+  function ponerArchivo(archivo) {
+    const valido = validarArchivo(archivo);
+    if (!valido.ok) { avisarEquipo(valido.motivo); quitarArchivo(); return false; }
+    avisarEquipo('');
+    archivoElegido = archivo;
+    if (ui.url.value) { ui.url.value = ''; pintarNotaUrl(); }
+    if (ui.ficha) {
+      ui.fichaNombre.textContent = archivo.name || 'Video de tu equipo';   // nombre ajeno: textContent, nunca innerHTML
+      ui.fichaDatos.textContent = `${formatearBytes(archivo.size)} · listo para doblar`;
+      ui.ficha.hidden = false;
+    }
+    actualizarBoton();
+    return true;
+  }
+  /** Un selector de archivo para un solo uso, abierto DENTRO del gesto que lo pide. */
+  function pedirArchivo() {
+    return new Promise((resolver) => {
+      const input = document.createElement('input');
+      input.type = 'file';
+      input.accept = ACEPTA_VIDEO;
+      input.hidden = true;
+      document.body.append(input);
+      const terminar = (archivo) => { input.remove(); resolver(archivo || null); };
+      input.addEventListener('change', () => terminar(input.files?.[0]), { once: true });
+      input.addEventListener('cancel', () => terminar(null), { once: true });
+      input.click();
+    });
+  }
+  ui.elegirArchivo?.addEventListener('click', () => ui.archivo.click());
+  ui.archivo?.addEventListener('change', () => { if (ui.archivo.files?.[0]) ponerArchivo(ui.archivo.files[0]); });
+  ui.fichaQuitar?.addEventListener('click', () => { quitarArchivo(); ui.elegirArchivo?.focus(); });
+  ui.url.addEventListener('input', () => { if (ui.url.value.trim() && archivoElegido) quitarArchivo(); });
+  // Escritorio: soltar el video sobre el panel.
+  const zona = document.querySelector('.yt-area');
+  if (zona) {
+    const conArchivos = (e) => [...(e.dataTransfer?.types || [])].includes('Files');
+    zona.addEventListener('dragover', (e) => { if (!conArchivos(e)) return; e.preventDefault(); zona.classList.add('yt-soltando'); });
+    zona.addEventListener('dragleave', (e) => { if (!zona.contains(e.relatedTarget)) zona.classList.remove('yt-soltando'); });
+    zona.addEventListener('drop', (e) => {
+      if (!conArchivos(e)) return;
+      e.preventDefault();
+      zona.classList.remove('yt-soltando');
+      const archivo = e.dataTransfer.files?.[0];
+      if (archivo && !estaOcupado()) ponerArchivo(archivo);
+    });
+  }
+  // La pestaña Archivo (y lo compartido desde el celular) entrega aquí un video.
+  window.jgVideoLocal = { elegir: (archivo) => ponerArchivo(archivo) };
+
   // ── Vista ───────────────────────────────────────────────────────────────
   const mostrarIdioma = (texto, tipo) => { ui.insignia.textContent = texto; ui.insignia.dataset.estado = tipo; };
   function ponerEstadoBotonVoz(activo) {
@@ -424,6 +493,8 @@ export function inicializarYoutubeSincronizado({
       actual.servicioVoz?.liberar();
       actual.sync?.destruir();
       actual.player?.destruir();
+      actual.cerrarArchivo?.();
+      if (actual.urlArchivo) URL.revokeObjectURL(actual.urlArchivo);
     }
     marcarOcupado(false);
     reiniciarVista();
@@ -553,6 +624,17 @@ export function inicializarYoutubeSincronizado({
     return player;
   }
 
+  async function crearReproductorArchivo(url, titulo, signal) {
+    recrearDestino();
+    const player = new XVideoPlayer('ytPlayer', {
+      mp4: url, titulo, etiqueta: 'Video de tu equipo',
+      mensajeError: 'Este navegador no puede reproducir este video (formato o códec). Ábrelo en Chrome de computador o conviértelo a MP4 (H.264 + AAC).',
+    });
+    await Promise.race([player.inicializar(), new Promise((r) => setTimeout(r, ESPERA_REPRODUCTOR_MS))]);
+    if (signal.aborted) { player.destruir(); throw cancelado(); }
+    return player;
+  }
+
   /**
    * Velocidad de partida del video: la que la persona eligió en el engranaje de
    * YouTube en videos anteriores. Con el ritmo automático no se reaplica una
@@ -784,6 +866,7 @@ export function inicializarYoutubeSincronizado({
     registrarVideo({
       clave: actual.videoId, titulo: tituloVideo, duracionS, idiomaOrigen: decision.idioma,
       autor: meta.autor || '', portada: meta.portada || '', posicionS: actual.registro.posicionS, abierto: Date.now(),
+      nombreArchivo: meta.nombreArchivo, bytes: meta.bytes,
     }).then((entrada) => {
       if (!entrada) return;
       pedirPersistencia();   // sin esto iOS borra la biblioteca tras días sin uso
@@ -809,6 +892,10 @@ export function inicializarYoutubeSincronizado({
   }
 
   async function iniciarSesion() {
+    if (archivoElegido) {
+      if (!estaServidorOnline()) return;
+      return iniciarSesionArchivo(archivoElegido);
+    }
     const url = ui.url.value.trim();
     const fuente = detectarFuente(url);
     if (!fuente || !estaServidorOnline()) return;
@@ -964,6 +1051,95 @@ export function inicializarYoutubeSincronizado({
     }
   }
 
+  async function iniciarSesionArchivo(archivo) {
+    let clave;
+    try { clave = await huellaArchivo(archivo); } catch (_) {
+      avisarEquipo('No pudimos leer ese archivo. Elígelo otra vez.');
+      return;
+    }
+    const actual = abrirSesion(clave);
+    const { signal } = actual.controlador;
+    try {
+      progreso.paso('leer', 'Abriendo tu video…');
+      const ficha = await servicioArchivo.inspeccionar(archivo);
+      actual.cerrarArchivo = () => ficha.abierto.cerrar();
+      if (signal.aborted) throw cancelado();
+      ultimoArchivo = { clave: ficha.clave, archivo };
+      ui.titulo.textContent = ficha.titulo;
+      actual.urlArchivo = URL.createObjectURL(archivo);
+      const promesaPlayer = crearReproductorArchivo(actual.urlArchivo, ficha.titulo, signal).then((player) => {
+        if (sesion === actual) actual.player = player; else player.destruir();
+        return player;
+      });
+      promesaPlayer.catch(() => {});   // un fallo se atiende abajo, al esperarlo
+      const promesaPortada = import('./medioLocal.js').then((m) => m.capturarPortada(actual.urlArchivo)).catch(() => '');
+
+      const guardado = await leerDoblaje(ficha.clave);
+      const elegidoEnFormulario = ui.idioma?.value || 'auto';
+      const sirve = Boolean(guardado?.segmentos?.length)
+        && (elegidoEnFormulario === 'auto' || elegidoEnFormulario === guardado.idiomaOrigen);
+      // Lo que ya se transcribió en un intento anterior (Groq llegó a su límite, se cerró…) no se vuelve a pagar.
+      const parcial = !sirve && guardado?.parcial?.trozoS === ficha.extraccion.trozoS ? guardado.parcial : null;
+      const transcribir = (idiomaOrigen, conPrevias) => {
+        const previas = new Map(conPrevias ? parcial?.partes || [] : []);
+        return servicioArchivo.obtenerParaDoblaje(ficha, {
+          idiomaOrigen, signal, previas, idiomaPrevio: conPrevias ? parcial?.idioma || '' : '',
+          apiKey: leer('jg_groq_api_key') || '',
+          context: leer('jg_glossary') || '',
+          onProgress: (mensaje, fraccion) => { progreso.mensaje(mensaje); progreso.barra(fraccion ?? null); },
+          alTerminarParte: (k, segmentos, idioma) => {
+            previas.set(k, segmentos);
+            return guardarDoblaje({
+              videoId: ficha.clave, titulo: ficha.titulo, duracionS: ficha.duracionS,
+              parcial: { trozoS: ficha.extraccion.trozoS, idioma, partes: [...previas] },
+            });
+          },
+        });
+      };
+      let datos;
+      let decision;
+      if (sirve) {
+        datos = { segmentos: guardado.segmentos, idioma: guardado.idiomaOrigen, confianza: 1, fuente: 'usuario', conflicto: false };
+        decision = { accion: 'doblar', idioma: guardado.idiomaOrigen, mensaje: '' };
+      } else {
+        progreso.ayuda(`${resumenAntesDeEmpezar({ duracionS: ficha.duracionS, modo: ficha.extraccion.modo, trozoS: ficha.extraccion.trozoS })} Mientras tanto puedes darle play.`);
+        const conPrevias = Boolean(parcial) && (elegidoEnFormulario === 'auto' || elegidoEnFormulario === parcial.idioma);
+        datos = await transcribir(elegidoEnFormulario, conPrevias);
+        decision = decidirDoblaje(datos);
+        if (decision.accion === 'preguntar' || decision.accion === 'no_soportado') {
+          progreso.mensaje('Confirma el idioma del video para seguir.');
+          const elegido = await elegirIdioma(decision, signal);
+          if (!elegido) { terminarSesion(); return; }
+          if (elegido !== datos.idioma) datos = await transcribir(elegido, false);
+          decision = { accion: 'doblar', idioma: elegido, mensaje: '' };
+        }
+      }
+      if (decision.accion === 'sin_doblaje') {
+        mostrarIdioma('El video ya está en español', 'ok');
+        progreso.error(decision.mensaje);
+        return;
+      }
+      mostrarIdioma(`Idioma del video: ${nombreIdioma(decision.idioma)}`, 'ok');
+      actual.player = await promesaPlayer;
+      if (signal.aborted) throw cancelado();
+      const duracionS = actual.player.getDuration() || ficha.duracionS;
+      await completarSesion(actual, {
+        decision, datos, tituloVideo: ficha.titulo, duracionS, guardado, sirve,
+        meta: { portada: await promesaPortada, nombreArchivo: ficha.nombreArchivo, bytes: ficha.bytes },
+      });
+      if (ficha.originalMudo && sesion === actual) {
+        ui.estado.textContent = 'Este navegador no reproduce el sonido original de este archivo (por ejemplo AC-3). La voz en español sí suena.';
+      }
+      quitarArchivo();   // ya está en la biblioteca; el formulario queda libre
+    } catch (error) {
+      if (signal.aborted || error?.name === 'AbortError') return;
+      mostrarIdioma('No se pudo preparar el doblaje', 'no');
+      progreso.error(textoDeError(error));
+    } finally {
+      if (sesion === actual) marcarOcupado(false);
+    }
+  }
+
   // ── Biblioteca: abrir un video guardado y bajar sus archivos ───────────
 
   /**
@@ -972,6 +1148,7 @@ export function inicializarYoutubeSincronizado({
    * instante. `segundo`: abrir donde se dijo lo que se buscó.
    */
   function abrirDesdeBiblioteca(video, { segundo = 0 } = {}) {
+    if (video?.plataforma === 'archivo') return abrirArchivoDeBiblioteca(video, segundo);
     if (!video?.url) return { abierto: false, motivo: 'Este video no tiene enlace guardado.' };
     if (estaOcupado()) return { abierto: false, motivo: 'Espera a que termine de prepararse el video actual.' };
     if (!estaServidorOnline()) return { abierto: false, motivo: 'Conecta el servidor (indicador de arriba) para abrir el video.' };
@@ -986,6 +1163,47 @@ export function inicializarYoutubeSincronizado({
     return { abierto: true, motivo: '' };
   }
 
+  /**
+   * El video del equipo no se copió: se pide el mismo archivo (en el MISMO toque,
+   * o el navegador no abre el selector) y la huella confirma que es ese.
+   * Devuelve `pendiente`: la vista avisa cuando se sepa si abrió.
+   */
+  function abrirArchivoDeBiblioteca(video, segundo) {
+    if (estaOcupado()) return { abierto: false, motivo: 'Espera a que termine de prepararse el video actual.' };
+    if (!estaServidorOnline()) return { abierto: false, motivo: 'Conecta el servidor (indicador de arriba) para abrir el video.' };
+    const empezar = (archivo) => {
+      ponerArchivo(archivo);
+      if (ui.idioma) ui.idioma.value = 'auto';   // con «auto» la caché del video sirve siempre
+      abrirEnPendiente = Number(segundo) || 0;
+      iniciarSesion().catch((error) => {
+        console.error('[jg-youtube]', error);
+        progreso.error('Algo falló al abrir el video. Vuelve a intentarlo.');
+      });
+      return { abierto: true, motivo: '' };
+    };
+    if (ultimoArchivo?.clave === video.clave) return empezar(ultimoArchivo.archivo);
+    const nombre = video.nombreArchivo || video.titulo;
+    const pendiente = pedirArchivo().then(async (archivo) => {
+      if (!archivo) return { abierto: false, motivo: '' };
+      if (await huellaArchivo(archivo).catch(() => '') !== video.clave) {
+        return { abierto: false, motivo: `Ese archivo no es «${nombre}». Elige el mismo video que doblaste.` };
+      }
+      return empezar(archivo);
+    });
+    return { abierto: false, pendiente, motivo: `Elige otra vez «${nombre}» en tu equipo: los videos no se copian a la app.` };
+  }
+
+  /** Para el MP4 doblado hace falta el original: se pide y se confirma por la huella. */
+  async function elegirArchivoPara(video) {
+    const archivo = await pedirArchivo();
+    if (!archivo) return { ok: false, motivo: '' };
+    if (await huellaArchivo(archivo).catch(() => '') !== video.clave) {
+      return { ok: false, motivo: `Ese archivo no es «${video.nombreArchivo || video.titulo}». Elige el mismo video que doblaste.` };
+    }
+    ultimoArchivo = { clave: video.clave, archivo };
+    return { ok: true, motivo: '' };
+  }
+
   const esMovil = () => Boolean(navigator.userAgentData?.mobile ?? /Android|iPhone|iPad|iPod/i.test(navigator.userAgent));
 
   /**
@@ -1057,6 +1275,10 @@ export function inicializarYoutubeSincronizado({
       mp3: { bytes: estimarBytesMp3(video.duracionS) },
       calidades: [],
     };
+    if (video.plataforma === 'archivo') {
+      salida.mp4 = { bytes: (Number(video.bytes) || 0) + estimarBytesVideo(BITRATE_AUDIO_DOBLADO, video.duracionS) };
+      salida.archivoListo = ultimoArchivo?.clave === video.clave;
+    }
     if (video.plataforma === 'x') {
       const info = await servicioX.info(video.url);
       salida.calidades = opcionesCalidadX(info.mp4, Number(info.duracion_s) || video.duracionS);
@@ -1071,11 +1293,16 @@ export function inicializarYoutubeSincronizado({
    */
   async function descargarDeBiblioteca(video, tipo, { calidad = null, signal = null, onProgreso = () => {} } = {}) {
     const esX = video?.plataforma === 'x';
-    if (tipo !== 'mp3' && !esX) throw new Error('De YouTube solo se descarga el audio doblado.');
-    if (tipo !== 'mp3' && !calidad?.url) throw new Error('Elige una calidad del video.');
+    const esArchivo = video?.plataforma === 'archivo';
+    if (tipo !== 'mp3' && !esX && !esArchivo) throw new Error('De YouTube solo se descarga el audio doblado.');
+    if (esArchivo && tipo === 'original') throw new Error('El original ya está en tu equipo.');
+    if (esArchivo && tipo === 'mp4' && ultimoArchivo?.clave !== video.clave) {
+      throw new Error(`Para el video doblado elige primero el original («${video.nombreArchivo || video.titulo}»).`);
+    }
+    if (esX && tipo !== 'mp3' && !calidad?.url) throw new Error('Elige una calidad del video.');
     const bytesEstimados = tipo === 'mp3'
       ? estimarBytesMp3(video.duracionS)
-      : calidad.bytes + (tipo === 'mp4' ? estimarBytesVideo(BITRATE_AUDIO_DOBLADO, video.duracionS) : 0);
+      : (esArchivo ? Number(video.bytes) || 0 : calidad.bytes) + (tipo === 'mp4' ? estimarBytesVideo(BITRATE_AUDIO_DOBLADO, video.duracionS) : 0);
     const destino = await crearDestino({
       nombre: nombreArchivo({
         titulo: video.titulo, plataforma: video.plataforma,
@@ -1095,8 +1322,9 @@ export function inicializarYoutubeSincronizado({
       if (tipo === 'mp3') {
         return conRespaldo(await archivos.exportarMp3({ frases, duracionVideoS: video.duracionS, sintetizar, destino, signal, onProgreso }));
       }
-      return conRespaldo(await archivos.exportarMp4DobladoX({
-        mp4Url: calidad.url, frases, sintetizar, destino, signal, onProgreso,
+      return conRespaldo(await archivos.exportarMp4Doblado({
+        ...(esArchivo ? { archivo: ultimoArchivo.archivo } : { mp4Url: calidad.url }),
+        frases, sintetizar, destino, signal, onProgreso,
         volumenOriginal: Number(ui.volOriginal.value) / 100,
       }));
     } catch (error) {
@@ -1111,7 +1339,7 @@ export function inicializarYoutubeSincronizado({
     import('./bibliotecaVista.js').then(({ montarBibliotecaVideos }) => {
       biblioteca = montarBibliotecaVideos(raizBiblioteca, {
         listarVideos, listarDoblajes, videosConVoz, actualizarVideo, quitarVideo, restaurarVideo, espacioYPersistencia,
-        abrir: abrirDesdeBiblioteca, opcionesDescarga, descargar: descargarDeBiblioteca,
+        abrir: abrirDesdeBiblioteca, opcionesDescarga, descargar: descargarDeBiblioteca, elegirArchivoPara,
         servidorEnLinea: () => Boolean(estaServidorOnline()),
       });
     }).catch((error) => {
```

- [ ] **Paso 2:** `node --check js/youtube/youtubeSyncController.js` y las de X/YouTube de la tabla.
- [ ] **Paso 3: commit** (`feat: doblar videos del equipo en la pestaña Videos`).

### Tarea 10: la vista de la biblioteca

«Tu equipo» como plataforma; menú sin «Copiar enlace» ni «Abrir en…» cuando no hay enlace; abrir un
video del equipo muestra el aviso y espera `pendiente`; el diálogo ofrece MP3 y MP4 (nunca original) y,
sin el archivo a mano, el MP4 muestra «Elegir el video original» y deshabilita «Descargar».

**Archivos:** `js/youtube/bibliotecaVista.js`.

- [ ] **Paso 1: aplicar:**

```diff
diff --git a/js/youtube/bibliotecaVista.js b/js/youtube/bibliotecaVista.js
index de2b418..8a32084 100644
--- a/js/youtube/bibliotecaVista.js
+++ b/js/youtube/bibliotecaVista.js
@@ -18,6 +18,8 @@ if (!document.querySelector('link[data-vid-css]')) {
 }
 
 const $ = (selector, raiz = document) => raiz.querySelector(selector);
+const NOMBRE_PLATAFORMA = { youtube: 'YouTube', x: 'X', archivo: 'Tu equipo' };
+const nombrePlataforma = (video) => NOMBRE_PLATAFORMA[video?.plataforma] || 'YouTube';
 const escapar = (valor) => String(valor ?? '').replace(/[&<>"']/g, (c) => ({
   '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
 }[c]));
@@ -66,6 +68,7 @@ export function montarBibliotecaVideos(raiz, deps) {
     'vidDeshacer', 'vidTemasDialogo', 'vidTemasTitulo', 'vidTemasActuales', 'vidTemaNuevo', 'vidTemasSugerencias',
     'vidTemasMensaje', 'vidTemasListo', 'vidDescargasDialogo', 'vidDescargasAyuda', 'vidCalidad',
     'vidDescargaEstado', 'vidDescargar', 'vidDescargaCancelar', 'vidDescargasCerrar', 'vidGuardarOtraVez',
+    'vidElegirOriginal',
   ].map((id) => [id, document.getElementById(id)]));
   let videos = [];
   let conVoz = new Set();
@@ -121,7 +124,7 @@ export function montarBibliotecaVideos(raiz, deps) {
       <button class="vid-abrir" type="button" aria-label="Abrir ${escapar(video.titulo)}">
         ${portadaHtml(video)}
         <span class="vid-tarjeta-cuerpo">
-          <span class="vid-plataforma">${video.plataforma === 'x' ? 'X' : 'YouTube'}</span>
+          <span class="vid-plataforma">${nombrePlataforma(video)}</span>
           <strong>${escapar(video.titulo)}</strong>
           <span class="vid-meta">${escapar(video.autor || fechaRelativa(video.abierto || video.creado))}</span>
           ${progresoHtml(video)}
@@ -135,8 +138,8 @@ export function montarBibliotecaVideos(raiz, deps) {
         <button type="button" role="menuitem" data-accion="temas">Editar temas</button>
         <button type="button" role="menuitem" data-accion="favorito">${video.favorito ? 'Quitar de favoritos' : 'Marcar como favorito'}</button>
         <button type="button" role="menuitem" data-accion="descargar">Descargar</button>
-        <button type="button" role="menuitem" data-accion="copiar">Copiar enlace</button>
-        <button type="button" role="menuitem" data-accion="origen">Abrir en ${video.plataforma === 'x' ? 'X' : 'YouTube'}</button>
+        ${video.url ? `<button type="button" role="menuitem" data-accion="copiar">Copiar enlace</button>
+        <button type="button" role="menuitem" data-accion="origen">Abrir en ${nombrePlataforma(video)}</button>` : ''}
         <button type="button" role="menuitem" data-accion="quitar">Quitar de la biblioteca</button>
       </div>
       ${coincidencia ? `<div class="vid-coincidencia"><p>${escapar(coincidencia.fragmento)}</p><button type="button" data-accion="abrir-aqui" data-segundo="${coincidencia.segundo}">Abrir aquí · ${formatearDuracion(coincidencia.segundo)}</button></div>` : ''}
@@ -219,8 +222,12 @@ export function montarBibliotecaVideos(raiz, deps) {
   // terminaste). Un segundo explícito es solo para «Abrir aquí».
   function abrirVideo(video, segundo = 0) {
     const resultado = deps.abrir(video, { segundo });
-    if (resultado?.abierto) plegar(true);
-    else avisar(resultado?.motivo || 'No pudimos abrir este video.');
+    if (resultado?.abierto) { plegar(true); return; }
+    avisar(resultado?.motivo || 'No pudimos abrir este video.');
+    // Video del equipo: se está eligiendo el archivo; el resultado llega después.
+    resultado?.pendiente?.then((final) => {
+      if (final?.abierto) { avisar(''); plegar(true); } else avisar(final?.motivo || '');
+    }).catch(() => avisar('No pudimos abrir este video.'));
   }
 
   function pintarEditorTemas() {
@@ -269,7 +276,8 @@ export function montarBibliotecaVideos(raiz, deps) {
   function pintarTiposDescarga(video, listo = false) {
     ui.vidDescargasDialogo.querySelectorAll('[data-tipo]').forEach((label) => {
       const tipo = $('input', label).value;
-      label.hidden = tipo !== 'mp3' && (video.plataforma !== 'x' || !listo);
+      const ofrece = video.plataforma === 'x' || (video.plataforma === 'archivo' && tipo === 'mp4');
+      label.hidden = tipo !== 'mp3' && (!ofrece || !listo);
     });
     ui.vidDescargasDialogo.querySelector('input[value="mp3"]').checked = true;
   }
@@ -295,12 +303,32 @@ export function montarBibliotecaVideos(raiz, deps) {
       }
       ui.vidDescargaEstado.textContent = video.plataforma === 'x' ? 'Elige el archivo y la calidad.' : `Audio estimado: ${formatearBytes(opcionesDescarga.mp3?.bytes)}`;
       ui.vidDescargar.disabled = false;
+      pintarOriginal();
     } catch (error) {
       console.error('[jg-biblioteca-opciones]', error);
       ui.vidDescargaEstado.textContent = 'No pudimos calcular las opciones de descarga.';
     }
   }
 
+  /** Video del equipo + MP4: hace falta el original (no se copió a la app). */
+  function pintarOriginal() {
+    if (!ui.vidElegirOriginal) return;
+    const falta = videoDescarga?.plataforma === 'archivo' && tipoDescarga() === 'mp4' && !opcionesDescarga?.archivoListo;
+    ui.vidElegirOriginal.hidden = !falta;
+    ui.vidDescargar.disabled = Boolean(falta) || !opcionesDescarga;
+    if (falta) {
+      ui.vidDescargaEstado.textContent = `Para el video doblado hace falta el original: «${videoDescarga.nombreArchivo || videoDescarga.titulo}». Pesará unos ${formatearBytes(opcionesDescarga.mp4?.bytes)}.`;
+    } else if (videoDescarga?.plataforma === 'archivo' && tipoDescarga() === 'mp4') {
+      ui.vidDescargaEstado.textContent = `Video doblado estimado: ${formatearBytes(opcionesDescarga.mp4?.bytes)}.`;
+    }
+  }
+
+  async function elegirOriginal() {
+    const r = await deps.elegirArchivoPara(videoDescarga);
+    if (r?.ok) { opcionesDescarga.archivoListo = true; pintarOriginal(); ui.vidDescargar.focus(); }
+    else if (r?.motivo) ui.vidDescargaEstado.textContent = r.motivo;
+  }
+
   function tipoDescarga() {
     return ui.vidDescargasDialogo.querySelector('input[name="vidTipo"]:checked')?.value || 'mp3';
   }
@@ -447,6 +475,8 @@ export function montarBibliotecaVideos(raiz, deps) {
     await deps.restaurarVideo(deshecho); clearTimeout(temporizadorDeshacer); deshecho = null; ui.vidDeshacer.hidden = true; avisar('Video restaurado.'); await refrescar();
   });
   ui.vidDescargar.addEventListener('click', descargar);
+  ui.vidElegirOriginal?.addEventListener('click', () => { elegirOriginal().catch(() => { ui.vidDescargaEstado.textContent = 'No pudimos leer ese archivo.'; }); });
+  ui.vidDescargasDialogo.addEventListener('change', (evento) => { if (evento.target.name === 'vidTipo') pintarOriginal(); });
   ui.vidDescargaCancelar.addEventListener('click', () => controladorDescarga?.abort());
   ui.vidGuardarOtraVez?.addEventListener('click', () => { guardarOtraVez?.(); });
   ui.vidDescargasCerrar.addEventListener('click', () => { controladorDescarga?.abort(); soltarArchivo(); cerrarDialogo(ui.vidDescargasDialogo); });
```

- [ ] **Paso 2:** `node tests/verificar_biblioteca_videos.mjs` → 52 (sin cambios).
- [ ] **Paso 3: commit** (`feat: la biblioteca reabre y descarga videos del equipo`).

### Tarea 11: prueba de punta a punta + batería completa

**Archivos:** crear `tests/verificar_archivo_doblaje.mjs`.

- [ ] **Paso 1: crear** la prueba (API simulada; Mediabunny, reproductor y biblioteca reales):

```js
// tests/verificar_archivo_doblaje.mjs
/* JG Turbo · Doblar un video del equipo de punta a punta, SIN red ni créditos.
 *
 * /transcribe, /translate y /tts se responden desde aquí; Mediabunny, el
 * reproductor y la biblioteca son los reales. El video es un WebM (el Chromium
 * de Playwright no reproduce H.264). Mide lo que vive la persona: elegir el
 * archivo (o soltarlo, o traerlo de la pestaña Archivo), que solo viaje el audio
 * en partes pequeñas, que el video se vea y avance con la voz, que la biblioteca
 * lo guarde sin enlace, que reabrirlo pida el MISMO archivo y que los errores se lean.
 *
 *   node tests/verificar_archivo_doblaje.mjs
 *   node tests/verificar_archivo_doblaje.mjs --headed
 */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, join, extname } from 'node:path';
import { pathToFileURL } from 'node:url';

const app = resolve(import.meta.dirname, '..');
const { chromium, devices } = await (async () => {
  const candidatos = [
    resolve(app, 'node_modules/playwright/index.mjs'),
    resolve(app, '../node_modules/playwright/index.mjs'),
    resolve(app, '../JG Turbo_OLD/node_modules/playwright/index.mjs'),
  ];
  for (const ruta of candidatos) {
    try { return await import(pathToFileURL(ruta).href); } catch (_) { /* siguiente */ }
  }
  throw new Error('Playwright no encontrado en: ' + candidatos.join(' · '));
})();

const VIDEO = join(app, 'tests/fixtures/archivo/clase_en_40s.webm');
const OTRO = join(app, 'tests/fixtures/archivo/dos_pistas_40s.mkv');
const SIN_AUDIO = join(app, 'tests/fixtures/archivo/sin_audio_10s.webm');
const NOTA = join(app, 'tests/fixtures/biblioteca/voz_1s.mp3');

function wavSilencio(segundos) {
  const muestras = Math.max(1, Math.round(8000 * segundos));
  const b = Buffer.alloc(44 + muestras);
  b.write('RIFF', 0); b.writeUInt32LE(36 + muestras, 4); b.write('WAVE', 8); b.write('fmt ', 12);
  b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(8000, 24);
  b.writeUInt32LE(8000, 28); b.writeUInt16LE(1, 32); b.writeUInt16LE(8, 34); b.write('data', 36); b.writeUInt32LE(muestras, 40);
  b.fill(128, 44);
  return b;
}

const tipos = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.svg': 'image/svg+xml', '.css': 'text/css', '.png': 'image/png', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json', '.txt': 'text/plain' };
const servidor = createServer(async (q, r) => {
  try {
    const p = decodeURIComponent(new URL(q.url, 'http://localhost').pathname);
    const f = join(app, p === '/' ? 'index.html' : p);
    r.setHeader('Content-Type', tipos[extname(f)] || 'application/octet-stream');
    r.end(await readFile(f));
  } catch { r.writeHead(404).end(); }
});
await new Promise((ok) => servidor.listen(0, '127.0.0.1', ok));
const base = `http://127.0.0.1:${servidor.address().port}`;

let ok = 0;
const fallos = [];
function comprobar(nombre, condicion, detalle = '') {
  if (condicion) { ok += 1; console.log(`OK: ${nombre}`); }
  else { fallos.push(nombre); console.log(`FALLO: ${nombre}${detalle ? ` — ${detalle}` : ''}`); }
}
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

async function abrir(navegador, escenario = {}) {
  const contexto = escenario.contexto || (escenario.movil
    ? await navegador.newContext({ ...devices['Pixel 7'] })
    : await navegador.newContext({ viewport: { width: 1280, height: 800 } }));
  const pagina = await contexto.newPage();
  const reg = { subidas: [], tts: 0, errores: [] };
  pagina.on('pageerror', (e) => reg.errores.push(String(e).slice(0, 200)));
  const responder = (r, datos) => r.fulfill(datos).catch(() => {});
  await pagina.route(/\/(health|session-config|ping|glossary|tts-voices|tts-warmup)(\?|$)/, (r) => {
    const u = r.request().url();
    if (u.includes('/health')) return responder(r, { json: { status: 'ok', server: 'vercel', model: 'whisper-large-v3', model_state: 'listo', model_ready: true, ai_configured: true, groq_configured: true, ia_configured: true, youtube_auto: true, x_video: true, tts_azure: true, tts_fish: false } });
    if (u.includes('/session-config')) return responder(r, { json: { token: 'vercel-bypass', ai_provider: 'mistral', ai_configured: true, groq_configured: true, ia_configured: true, limits: {} } });
    return responder(r, { json: {} });
  });
  await pagina.route(/\/translate(\?|$)/, async (r) => {
    const cuerpo = JSON.parse(r.request().postData() || '{}');
    const piezas = [...String(cuerpo.text || '').matchAll(/\[\[JG_SEG_(\d{6})\]\]\n([^\[]*)/g)];
    await esperar(100);
    const text = piezas.length ? piezas.map((m) => `[[JG_SEG_${m[1]}]]\nES ${m[2].trim()}`).join('\n\n') : `ES ${cuerpo.text}`;
    await responder(r, { json: { text, ia_used: true, provider: 'mistral', validation: { status: 'ok', integrity_score: 100 } } });
  });
  await pagina.route(/\/tts(\?|$)/, async (r) => {
    const req = r.request();
    const datos = req.method() === 'GET' ? Object.fromEntries(new URL(req.url()).searchParams) : JSON.parse(req.postData() || '{}');
    reg.tts += 1;
    await esperar(80);
    await responder(r, { status: 200, contentType: 'audio/wav', headers: { 'X-TTS-Engine': 'azure-neural-regional', 'X-TTS-Voice': 'es-CO-SalomeNeural', 'X-TTS-Fallback': '0' }, body: wavSilencio(Math.max(0.6, String(datos.text || '').length / 16)) });
  });
  await pagina.route(/\/transcribe(\?|$)/, async (r) => {
    const cuerpo = r.request().postDataBuffer() || Buffer.alloc(0);
    const nombre = (cuerpo.toString('latin1').match(/filename="([^"]+)"/) || [])[1] || '';
    reg.subidas.push({ bytes: cuerpo.length, nombre });
    await esperar(escenario.retrasoTranscribeMs ?? 200);
    const segments = Array.from({ length: 6 }, (_, i) => ({ start: 1 + i * 6, end: 5 + i * 6, text: `Sentence number ${i + 1}.` }));
    await responder(r, { json: { text: 'x', language: 'en', segments } });
  });
  await pagina.goto(`${base}/?tab=${escenario.tab || 'yt'}`, { waitUntil: 'domcontentloaded' });
  await pagina.waitForSelector(escenario.tab === 'file' ? '#fileInput' : '#ytArchivo', { state: 'attached' });
  if (escenario.tab !== 'file') await pagina.waitForFunction(() => Boolean(window.jgVideoLocal), null, { timeout: 15000 });
  return { contexto, pagina, reg };
}

const listo = (pagina) => pagina.evaluate(() => {
  const r = document.getElementById('ytDubReproducir');
  if (r && !r.hidden && !r.disabled) return true;
  const b = document.getElementById('ytDubbingBtn');
  return Boolean(b && !b.disabled);
});
async function esperarListo(pagina, ms = 40000, mensajes = []) {
  const fin = Date.now() + ms;
  while (Date.now() < fin) {
    mensajes.push(await pagina.textContent('#ytDubMensaje').catch(() => ''));
    if (await listo(pagina)) return true;
    await esperar(100);
  }
  return false;
}
async function elegir(pagina, ruta) {
  await pagina.setInputFiles('#ytArchivo', ruta);
  await pagina.waitForFunction(() => !document.getElementById('ytSyncBtn').disabled, null, { timeout: 10000 }).catch(() => {});
}
const tiempoVideo = (pagina) => pagina.evaluate(() => document.getElementById('ytPlayer')?.contentDocument?.querySelector('video')?.currentTime ?? -1);
async function esperarTexto(pagina, selector, patron, ms = 15000) {
  const fin = Date.now() + ms;
  while (Date.now() < fin) {
    const texto = await pagina.textContent(selector).catch(() => '');
    if (patron.test(texto)) return texto;
    await esperar(100);
  }
  return await pagina.textContent(selector).catch(() => '');
}
const tarjeta = (pagina) => pagina.locator('.vid-tarjeta').filter({ hasText: 'Tu equipo' }).first();

const navegador = await chromium.launch({ headless: !process.argv.includes('--headed') });
try {
  console.log('\n── Elegir el archivo ──────────────────────────────────────────');
  {
    const { contexto, pagina } = await abrir(navegador);
    comprobar('se ve «Elegir un video de tu equipo»', await pagina.isVisible('#ytElegirArchivo'));
    await pagina.fill('#ytUrl', 'https://youtube.com/watch?v=dNWkwrqAkcM');
    await elegir(pagina, VIDEO);
    comprobar('al elegir un video se ve su ficha con el nombre', await pagina.isVisible('#ytFichaArchivo') && /clase_en_40s\.webm/.test(await pagina.textContent('#ytFichaNombre')));
    comprobar('el enlace pegado se borra (una sola fuente a la vez)', (await pagina.inputValue('#ytUrl')) === '');
    comprobar('y «Doblar al español» se habilita', !(await pagina.isDisabled('#ytSyncBtn')));
    await pagina.click('#ytFichaQuitar');
    comprobar('«Quitar» deshace la elección y apaga el botón', !(await pagina.isVisible('#ytFichaArchivo')) && await pagina.isDisabled('#ytSyncBtn'));
    await pagina.setInputFiles('#ytArchivo', NOTA);
    comprobar('un audio se rechaza diciendo adónde ir', /pestaña Archivo/.test(await pagina.textContent('#ytEquipoAviso')));
    await elegir(pagina, VIDEO);
    await pagina.fill('#ytUrl', 'https://youtube.com/watch?v=dNWkwrqAkcM');
    comprobar('pegar un enlace quita el archivo elegido', !(await pagina.isVisible('#ytFichaArchivo')));
    await contexto.close();
  }

  console.log('\n── Doblar, ver y guardar en la biblioteca ─────────────────────');
  {
    const contexto = await navegador.newContext({ viewport: { width: 1280, height: 800 } });
    const { pagina, reg } = await abrir(navegador, { contexto });
    await elegir(pagina, VIDEO);
    await pagina.click('#ytSyncBtn');
    const mensajes = [];
    const llego = await esperarListo(pagina, 40000, mensajes);
    comprobar('el doblaje queda listo', llego, mensajes.filter(Boolean).slice(-3).join(' | '));
    comprobar('se cuenta lo que pasará antes de esperar (partes, gratis, no sale del equipo)', /no sale de tu equipo/.test(await pagina.textContent('#ytDubAyuda')));
    comprobar('solo viaja el audio: 1 parte MP3 pequeña', reg.subidas.length === 1 && reg.subidas[0].nombre.endsWith('.mp3') && reg.subidas[0].bytes < 400000, JSON.stringify(reg.subidas));
    const rep = await pagina.evaluate(() => {
      const f = document.getElementById('ytPlayer');
      const v = f?.contentDocument?.querySelector('video');
      return { tag: f?.tagName, src: v?.src || '', dur: v ? v.duration : 0, titulo: f?.title };
    });
    comprobar('el video se ve en el reproductor de siempre, desde un blob: local', rep.tag === 'IFRAME' && rep.src.startsWith('blob:') && rep.dur > 30, JSON.stringify(rep));
    comprobar('el título sale del nombre del archivo', /Clase en 40s/.test(await pagina.textContent('#ytSyncTitle')));
    await pagina.click('#ytDubReproducir');
    const t0 = await tiempoVideo(pagina);
    await esperar(2500);
    const t1 = await tiempoVideo(pagina);
    comprobar('«Ver con voz en español» arranca el video y avanza', t1 > t0 + 1, `${t0.toFixed(1)} → ${t1.toFixed(1)} s`);
    comprobar('y se pide la voz en español', reg.tts > 0, String(reg.tts));
    comprobar('el motor de voz vive (jgDoblajeDiagnostico)', await pagina.evaluate(() => Boolean(window.jgDoblajeDiagnostico?.())));

    await pagina.click('#btnYtSyncClose');
    await pagina.waitForSelector('.vid-tarjeta', { timeout: 10000 }).catch(() => {});
    const t = tarjeta(pagina);
    comprobar('la biblioteca guarda el video como «Tu equipo»', await t.count() === 1);
    comprobar('con una miniatura sacada del propio video', /^data:image\/jpeg/.test(await t.locator('img').getAttribute('src').catch(() => '') || ''));
    await t.locator('.vid-menu-btn').click();
    const items = await t.locator('[role="menuitem"]').allTextContents();
    comprobar('su menú no ofrece «Copiar enlace» ni «Abrir en…» (no tiene enlace)', !items.some((i) => /Copiar enlace|Abrir en/.test(i)), items.join(' · '));
    await t.locator('[data-accion="descargar"]').click();
    await esperarTexto(pagina, '#vidDescargaEstado', /Audio estimado/);
    const tiposVisibles = await pagina.$$eval('#vidDescargasDialogo [data-tipo]', (ls) => ls.filter((l) => !l.hidden).map((l) => l.dataset.tipo));
    comprobar('descargas: audio MP3 y video doblado MP4, nunca «original»', tiposVisibles.join() === 'mp3,mp4', tiposVisibles.join());
    await pagina.check('#vidDescargasDialogo input[value="mp4"]');
    comprobar('con el archivo a mano, el MP4 se ofrece con su tamaño', /Video doblado estimado/.test(await pagina.textContent('#vidDescargaEstado')) && await pagina.isHidden('#vidElegirOriginal'));
    await pagina.click('#vidDescargasCerrar');

    await t.locator('.vid-abrir').click();
    const otraVez = await esperarListo(pagina, 20000);
    comprobar('reabrir desde la biblioteca (mismo archivo en memoria) queda listo', otraVez);
    comprobar('y no vuelve a transcribir (caché archivo:<huella>)', reg.subidas.length === 1, String(reg.subidas.length));
    comprobar('sin errores de JavaScript', reg.errores.length === 0, reg.errores.join(' | '));
    await pagina.close();

    // Página nueva (como al volver otro día): el archivo ya no está en memoria.
    const nueva = await abrir(navegador, { contexto });
    const p2 = nueva.pagina;
    await p2.waitForSelector('.vid-tarjeta', { timeout: 10000 }).catch(() => {});
    await tarjeta(p2).locator('.vid-menu-btn').click();
    await tarjeta(p2).locator('[data-accion="descargar"]').click();
    await esperarTexto(p2, '#vidDescargaEstado', /Audio estimado/);
    await p2.check('#vidDescargasDialogo input[value="mp4"]');
    comprobar('sin el archivo, el MP4 pide «Elegir el video original» y no deja descargar', await p2.isVisible('#vidElegirOriginal') && await p2.isDisabled('#vidDescargar'));
    const [selectorMp4] = await Promise.all([p2.waitForEvent('filechooser'), p2.click('#vidElegirOriginal')]);
    await selectorMp4.setFiles(VIDEO);
    await esperarTexto(p2, '#vidDescargaEstado', /Video doblado estimado/, 5000);
    comprobar('al elegir el MISMO archivo, el MP4 queda disponible', await p2.isHidden('#vidElegirOriginal') && !(await p2.isDisabled('#vidDescargar')));
    await p2.click('#vidDescargasCerrar');
    await p2.close();

    const tercera = await abrir(navegador, { contexto });
    const p3 = tercera.pagina;
    await p3.waitForSelector('.vid-tarjeta', { timeout: 10000 }).catch(() => {});
    const [selector] = await Promise.all([p3.waitForEvent('filechooser'), tarjeta(p3).locator('.vid-abrir').click()]);
    comprobar('abrir la tarjeta pide el archivo y explica por qué', /Elige otra vez «clase_en_40s\.webm»/.test(await p3.textContent('#vidAviso')));
    await selector.setFiles(OTRO);
    comprobar('si eligen OTRO archivo, se dice claro y no se dobla', /no es «clase_en_40s\.webm»/.test(await esperarTexto(p3, '#vidAviso', /no es/)) && tercera.reg.subidas.length === 0);
    const [otraVezSelector] = await Promise.all([p3.waitForEvent('filechooser'), tarjeta(p3).locator('.vid-abrir').click()]);
    await otraVezSelector.setFiles(VIDEO);
    comprobar('con el MISMO archivo abre listo y sin transcribir de nuevo', await esperarListo(p3, 20000) && tercera.reg.subidas.length === 0, String(tercera.reg.subidas.length));
    await contexto.close();
  }

  console.log('\n── Errores y cancelar ─────────────────────────────────────────');
  {
    const { contexto, pagina, reg } = await abrir(navegador);
    await elegir(pagina, SIN_AUDIO);
    await pagina.click('#ytSyncBtn');
    const texto = await esperarTexto(pagina, '#ytDubMensaje', /no tiene sonido/);
    comprobar('un video sin sonido: el motivo se lee y se ofrece «Volver»', /no tiene sonido/.test(texto) && (await pagina.textContent('#ytDubCancelar')).includes('Volver'), texto);
    comprobar('y no se sube nada', reg.subidas.length === 0);
    await contexto.close();
  }
  {
    const { contexto, pagina, reg } = await abrir(navegador, { retrasoTranscribeMs: 4000 });
    await elegir(pagina, VIDEO);
    await pagina.click('#ytSyncBtn');
    const fin = Date.now() + 15000;
    while (reg.subidas.length < 1 && Date.now() < fin) await esperar(50);
    await pagina.click('#ytDubCancelar');
    await esperar(1500);
    comprobar('cancelar a mitad devuelve el formulario', await pagina.evaluate(() => document.getElementById('ytSyncArea').hidden));
    comprobar('y no hay errores de JavaScript', reg.errores.length === 0, reg.errores.join(' | '));
    await contexto.close();
  }

  console.log('\n── Desde la pestaña Archivo (y lo compartido del celular) ─────');
  {
    const { contexto, pagina } = await abrir(navegador, { tab: 'file' });
    await pagina.setInputFiles('#fileInput', VIDEO);
    comprobar('un video en Archivo ofrece «Doblar este video al español»', await pagina.isVisible('#btnFileDoblarVideo'));
    await pagina.click('#btnFileDoblarVideo');
    await pagina.waitForSelector('#ytFichaArchivo:not([hidden])', { timeout: 15000 }).catch(() => {});
    comprobar('lleva a Videos con el archivo ya elegido', await pagina.isVisible('#panelYt') && /clase_en_40s/.test(await pagina.textContent('#ytFichaNombre')));
    await contexto.close();
  }

  console.log('\n── Teléfono ───────────────────────────────────────────────────');
  {
    const { contexto, pagina } = await abrir(navegador, { movil: true });
    const alto = await pagina.evaluate(() => document.getElementById('ytElegirArchivo').getBoundingClientRect().height);
    comprobar('«Elegir un video de tu equipo» mide al menos 44 px', alto >= 44, `${alto} px`);
    await elegir(pagina, VIDEO);
    const quitar = await pagina.evaluate(() => document.getElementById('ytFichaQuitar').getBoundingClientRect().height);
    comprobar('«Quitar» mide al menos 44 px', quitar >= 44, `${quitar} px`);
    let desborde = await pagina.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    comprobar('sin desborde horizontal con la ficha del archivo', desborde <= 0, `${desborde} px`);
    await pagina.click('#ytSyncBtn');
    await esperarListo(pagina);
    desborde = await pagina.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    comprobar('sin desborde horizontal con el video doblando', desborde <= 0, `${desborde} px`);
    await contexto.close();
  }
} finally {
  await navegador.close();
  servidor.close();
}

console.log(`\n${ok} comprobaciones OK · ${fallos.length} fallos`);
if (fallos.length) process.exit(1);
```

- [ ] **Paso 2:** `node tests/verificar_archivo_doblaje.mjs` → **38 OK**.
- [ ] **Paso 3: contraprueba obligatoria** (prueba que la prueba mira): en `archivoLocal.js` cambia
  `huellaArchivo` para que incluya `archivo.name` en los bytes. Deben fallar «renombrar el archivo NO
  cambia la huella» (`test_archivo_doblaje`) — y nada más de esa suite. Restaura y vuelve a contar.
- [ ] **Paso 4: batería completa** (todas las de la tabla del principio + las unitarias de PDF/TTS de
  AGENTS.md). Anota cada número. Si alguno baja respecto a tu línea base, **para**: no sigas a la Fase 4.
- [ ] **Paso 5: commit** (`test: doblaje de videos del equipo de punta a punta`).

---

## Fase 4 · Cierre (documentar, desplegar una vez, verificar, empujar)

### Tarea 12: documentación

- [ ] `CAMBIOS_VIDEO_LOCAL.md` (nuevo, documento maestro): qué hace, decisiones del dueño, hechos M1–M15
  (enlaza `docs/video-local/MEDICIONES.md`), arquitectura (copia el diagrama de la especificación §3),
  errores (§5), límites (3 h, partes de 6 min, 3,2/4,2 MB, Groq 2 h de audio por hora), pruebas con sus
  números, despliegues (`dpl_…`) y «qué hacer si falla» (formato que no reproduce, AC-3 mudo, límite de
  Groq, selector que no abre).
- [ ] `Agents.md` (en Git se llama así; en Windows `AGENTS.md` es el mismo archivo): sección
  «Videos del equipo (leer antes de tocar `archivoLocal.js`, `medioLocal.js`, `servicioArchivo.js`)» con
  las reglas 1, 2, 4 y 5 de este plan, y filas nuevas en la tabla de verificación:
  `test_archivo_doblaje` 65 · `verificar_archivo_audio` 26 · `verificar_archivo_doblaje` 38
  («**Obligatoria al tocar videos del equipo**»).
- [ ] `TRAMPAS.md` (formato síntoma · causa · regla): **«WebCodecs no existe fuera de contexto seguro»**
  (M1: una prueba en `http://host-inventado` dice «no se puede decodificar» y engaña); **«El AAC del
  navegador no acepta cualquier frecuencia»** (M15); **«44 px exactos miden 43,99 en densidad 2,625»**.
- [ ] `CONFIG_PERSISTENTE.md`: claves `archivo:<huella>` en `jg_youtube` (`doblajes`, `videos`, `voces`),
  el campo temporal `parcial` y que el video nunca se guarda.
- [ ] `PRODUCT.md` → «Capabilities and Constraints»: doblaje también de videos del equipo (sin copiarlos).
- [ ] `DOCUMENTACION_DESPLIEGUE.md`: la publicación.
- [ ] Commit (`docs: videos del equipo`).

### Tarea 13: versión, vista previa, prueba real, producción y push

- [ ] **Paso 1: versión, una vez.** `JG_JS_V = 'v160'` en `index.html` y
  `CACHE_SHELL = 'jg-turbo-shell-v160'` en `sw.js` (si la última entrega ya usó v160, usa el siguiente).
  Commit (`chore: v160 videos del equipo`).
- [ ] **Paso 2: vista previa** desde una copia exacta del commit (la raíz sube basura y
  `.pytest_cache` tumba el CLI):

```bash
tmp="$(mktemp -d)"
git archive HEAD | tar -x -C "$tmp"
mkdir -p "$tmp/.vercel" && cp .vercel/project.json "$tmp/.vercel/"
cd "$tmp" && npx vercel --yes --scope jhoncod24s-projects
```

- [ ] **Paso 3: prueba real del dueño — PUERTA.** Antes, mira `/api/health` de la vista previa: las
  vistas previas **no traen las claves** (medido con X: `groq_configured: false`), así que ahí Whisper no
  transcribe. Si sale `false`, **pregúntale al dueño** una de dos: (a) pegar su propia clave de Groq en
  Configuración → Servidor e IA solo para la prueba, o (b) hacer la prueba en producción justo después
  del Paso 4, con el `dpl_…` actual anotado para revertir si algo falla. El servidor no cambia en este
  plan: el riesgo es solo de la interfaz. Luego dale la URL y pídele, en este
  orden: (a) en **Chrome del PC**, elegir un curso real en MP4 de 10–30 min y verlo doblado; cerrar,
  recargar y reabrirlo desde «Tus videos» eligiendo el mismo archivo (debe sonar al instante); bajar el
  **MP4 doblado**; (b) en su **teléfono**, elegir un video de la galería (y, si puede, compartirlo
  desde la galería a JG Turbo y usar «Doblar este video al español»). Anota tiempos hasta «Listo»,
  partes subidas y cualquier mensaje. **Si en el teléfono no reproduce o no suena la voz, no despliegues
  a producción: avísale** con lo que viste.
- [ ] **Paso 4: producción** (misma copia, con `--prod`):

```bash
cd "$tmp" && npx vercel --prod --yes --scope jhoncod24s-projects
```

- [ ] **Paso 5: verificar contra `https://jg-turbo.vercel.app`** (con `?nocache=$RANDOM`):
  `JG_JS_V = 'v160'` en el HTML; `/js/youtube/archivoLocal.js`, `medioLocal.js`, `servicioArchivo.js`,
  `transcripcionPartes.js` con 200 y sha256 igual a `git show HEAD:<ruta>`; `/api/health` 200; y
  `node tests/verificar_archivo_doblaje.mjs` no aplica a producción (API simulada): en su lugar, un
  video real de 1–3 min doblado en el dominio.
- [ ] **Paso 6:** anota el `dpl_…` en `CAMBIOS_VIDEO_LOCAL.md` y `DOCUMENTACION_DESPLIEGUE.md`; commit.
- [ ] **Paso 7: empujar.**

```bash
git switch main && git merge --ff-only feat/video-local && git push origin main
git fetch origin && git log --oneline origin/main..HEAD   # debe salir vacío
```

---

## Criterios de aceptación (para que el dueño verifique)

1. En **Videos** hay «Elegir un video de tu equipo»; al elegir un MP4 se ve su ficha y «Doblar al
   español» se habilita. En el PC también se puede soltar el video encima.
2. La tarjeta de progreso dice, antes de esperar, cuántas partes, que es gratis y que el video no sale
   del equipo; el video se puede ver en inglés mientras tanto.
3. Un curso de 30 min queda listo en ~1 min en el PC (medido: 360 s de audio = 5,8 s en Whisper; MP3 a
   216× tiempo real) y suena con la voz, el ritmo y el subtítulo de siempre.
4. El video aparece en «Tus videos» como **Tu equipo**, con su miniatura; abrirlo otro día pide el mismo
   archivo y suena **al instante, sin volver a transcribir**; si se elige otro archivo, lo dice.
5. Descargas: «Audio doblado MP3» y «Video doblado MP4» (este pide el original si no está a mano).
6. Un video sin sonido, un audio, un formato raro o uno de más de 3 h muestran un motivo claro y nada se
   sube. Si Groq se queda sin cuota a mitad, lo dice y la próxima vez sigue donde iba.
7. Desde la pestaña Archivo (o Compartir en el celular) un video ofrece «Doblar este video al español».
8. YouTube y X funcionan exactamente igual que antes (mismos números de prueba).

## Mejoras que quedan fuera de este plan (en orden de valor)

1. **Subtítulos `.srt`/`.vtt` junto al video** (los traen muchas descargas de cursos y yt-dlp): texto
   exacto y sin gastar Whisper. ~60 líneas + pruebas.
2. **Reabrir con un clic en Chrome del PC** guardando el `FileSystemFileHandle` en IndexedDB
   (`showOpenFilePicker`): sin volver a buscar el archivo; el permiso se pide con un toque.
3. **Empezar con la primera parte**: doblar los primeros 6 min mientras se transcribe el resto (hoy
   espera todo el texto). Requiere que el motor acepte segmentos que llegan; tocar con
   `test_youtube_sincronia`.
4. **Convertir en el navegador** lo que el `<video>` no reproduce (MKV en iPhone): remux a MP4 con
   Mediabunny cuando el códec sí es compatible.
