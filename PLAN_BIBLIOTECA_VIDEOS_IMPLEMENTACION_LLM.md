# Plan de implementación · Biblioteca de videos doblados y descargas (pestaña «Videos»)

> **Para el agente que ejecuta (cualquier LLM, sin haber visto la conversación en la que se preparó):**
> ejecuta este plan **tarea por tarea, en orden**. Cada tarea trae: por qué existe, archivos, contratos,
> prueba primero, implementación, comando de verificación con el resultado esperado y commit. Marca una
> casilla (`- [ ]` → `- [x]`) **solo** después de ejecutar el comando y **contar** las comprobaciones. Si tu
> herramienta tiene `superpowers:executing-plans` o `superpowers:subagent-driven-development`, úsalas. Para
> la interfaz (Fase C) es **obligatorio** usar la habilidad **impeccable** (ver «Cómo se usa impeccable»).
> Lo marcado **[POR CONFIRMAR]** no se pudo medir al escribir el plan: la tarea dice cómo medirlo y qué
> hacer según el resultado.

**Objetivo:** que cada video doblado (YouTube o X) quede en una **biblioteca** bajo «Doblar al español»,
con buscador, filtros, etiquetas y «Seguir viendo»; que volver a un video sea **inmediato** (texto,
traducción y voz ya guardados); y que se puedan **descargar** el audio doblado (MP3, YouTube y X), el video
original de X (MP4) y el video de X ya doblado (MP4). La pestaña pasa a llamarse **«Videos»**.

**Arquitectura:** la base IndexedDB `jg_youtube` sube a la versión 2 con dos almacenes nuevos: `videos` (la
ficha liviana de la biblioteca) y `voces` (la voz ya generada, con tope de 300 MB). La migración desde v1
es aditiva. El controlador del doblaje registra cada video al doblarlo y guarda cada frase de voz. El
servicio de voz consulta lo guardado **antes** de gastar turno del limitador de Azure. La vista de la
biblioteca (`bibliotecaVista.js`) es un módulo nuevo que se carga con el panel. Las descargas se arman
**en el navegador** con Mediabunny (carga diferida, `js/vendor/mediabunny/`): la voz de cada frase se
coloca en su segundo exacto y la que no cabe se pide más rápida al servidor (sin cambiar el tono). El
servidor solo gana un parámetro aditivo, `evitar_azure`, para que las descargas largas usen edge-tts.

**Tecnología:** HTML/CSS/JS sin frameworks (módulos ES en `js/youtube/`), IndexedDB, Mediabunny 1.60.0
(MPL-2.0) con sus extensiones MP3 y AAC, FastAPI en Vercel (`api/index.py`), Playwright para las pruebas
de navegador, FFmpeg para fabricar archivos de prueba.

**Especificación:** `docs/superpowers/specs/2026-09-28-biblioteca-videos-design.md` (decisiones del dueño,
hechos medidos M1–M12, experiencia). Producto: `PRODUCT.md`. Brief de la superficie para impeccable:
`.impeccable/surfaces/js-youtube-bibliotecavista-js.md`. Léelos antes de empezar.

**Validación previa de este plan (2026-09-28, en copias aisladas hechas con `git archive HEAD`, sin tocar
el repositorio):** los archivos y fragmentos de este documento se insertaron aquí **desde los archivos que
se ejecutaron**, con un script, para que no haya diferencias de copia:
- Lógica pura (T1) + servicio de voz (T5): `node tests/test_biblioteca_videos.mjs` → **83 OK · 0 fallos**.
- Guardado v2 y archivos (T2): `node tests/verificar_biblioteca_datos.mjs` → **38 OK · 0 fallos**, en
  Chromium de Playwright **y** en Chrome instalado. Contraprueba: sin la migración, falla donde debe.
- Servidor (T3): `test_tts_evitar_azure.py` 4 passed (2 fallan antes del cambio, como deben) y, junto a
  los archivos de TTS, X, YouTube e IA, **117–135 passed** según la selección, sin regresiones.
- Integración (T5) sobre una copia con T1–T5: `test_youtube_doblaje` **139**, `test_youtube_sincronia`
  **65**, `test_x_doblaje` **70**, `verificar_youtube_doblaje` **110**, `verificar_x_doblaje` **24**,
  `verificar_movil_pantalla` sin fallos: todo igual que `main`. `verificar_arranque_ligero`: el mismo
  fallo que ya tiene `main` («menos de 1 MB»: 1 032 KB en `main`, 1 037 KB con este plan y una vista).
- Interfaz (T6): `tests/verificar_biblioteca_videos.mjs` → **48 OK · 0 fallos** contra una **vista de
  referencia desechable** (funcional y sin diseño) que se escribió solo para comprobar que el contrato y
  la prueba son correctos. Esa vista **no** se entrega: la vista real la diseñas tú con impeccable y debe
  pasar la misma prueba.
- **No** ejecutado: la Tarea 4 y la Tarea 9 (necesitan Vercel y un iPhone real) y la vista real.

---

## Restricciones globales (valen para todas las tareas)

1. **Idioma:** nombres, comentarios, mensajes y commits en español (Colombia), con tildes. Comentarios solo
   donde el *porqué* no es obvio.
2. **Una sola dependencia nueva, y vendorizada:** Mediabunny 1.60.0 y sus extensiones
   `@mediabunny/mp3-encoder` y `@mediabunny/aac-encoder` 1.60.0, guardadas en `js/vendor/mediabunny/` con
   su `LICENSE` (MPL-2.0). Nada de npm en tiempo de ejecución ni CDN (la app es PWA). Ninguna otra librería.
3. **Carga diferida:** Mediabunny se importa solo al pedir una descarga (`medios.js`); la vista de la
   biblioteca, solo desde el controlador. `tests/verificar_arranque_ligero.mjs` no puede sumar fallos
   nuevos: el único permitido es el que ya tiene `main` («menos de 1 MB»), y el peso al abrir no puede
   subir más de ~15 KB sobre la línea base (marcado + CSS de la biblioteca). Si pasa de ahí, el CSS de la
   biblioteca se mueve a un archivo que carga la vista.
4. **Nada se borra sin que el dueño lo pida.** Se elimina la poda de 20 videos. Quitar un video ofrece
   «Deshacer». Lo único que se descarta solo es la voz guardada (se puede regenerar), con tope de 300 MB.
5. **La base IndexedDB solo sube de versión** (`TRAMPAS.md` §7.2) y la migración es aditiva: crea lo que
   falta y copia, nunca borra. Sin claves nuevas de `localStorage`. Todo acceso a IndexedDB va en
   `try/catch`: en modo privado la app funciona igual.
6. **YouTube y X no cambian por dentro.** Sus pruebas deben dar los mismos números de la línea base. El
   motor de doblaje solo gana el gancho `buscarGuardada` de la Tarea 5; nada más.
7. **Toda petición a `video.twimg.com` va sin Referer** (X responde 403: `TRAMPAS.md`). Las descargas de X
   usan `referrerPolicy: 'no-referrer'` (ya viene en el código de este plan).
8. **Nunca se descarga video de YouTube** (decisión del dueño; además YouTube bloquea a Vercel y sus
   términos lo prohíben). De YouTube solo se ofrece el audio doblado.
9. **El selector de archivos exige el gesto:** `crearDestino` se llama **primero** en el clic de
   «Descargar», antes de traducir o pedir voces. Cerrar el selector no es un error.
10. **Lo que llega de fuera se pinta con `textContent`**, nunca con `innerHTML` (títulos y textos de X y
    YouTube, etiquetas del dueño).
11. **Diseño:** el sistema visual de la app manda (tokens de `:root` en `index.html`). El diseño de los
    subtítulos (`.yt-caption`) es intocable. `.btn` está definido dos veces en `index.html`: estiliza con
    el contenedor delante (`.vid-biblioteca .algo`). Toques ≥ 44 px, texto ≥ 13 px, sin desborde a 360 px,
    foco visible, teclado completo, `prefers-reduced-motion`.
12. **Los ids existentes del panel no cambian** (`#panelYt`, `#tabYt`, `#ytUrl`, `#ytSyncArea`…): los usan
    el controlador y las pruebas. La pestaña cambia solo su texto visible a «Videos».
13. **`.impeccable/` nunca se publica**: contiene la dirección de diseño (regla de impeccable: nada del
    contrato viaja al navegador). Se agrega a `.vercelignore` en la Tarea 6. El despliegue sale de
    `git archive`, así que tampoco se commitea nada de `.impeccable/review/`.
14. **Despliegue (`AGENTS.md`):** un solo despliegue a producción al final (Tarea 9). Excepción prevista:
    la Tarea 4 hace una **vista previa** (`npx vercel --yes`, sin `--prod`) porque el ritmo de edge-tts
    solo se mide desde Vercel. `JG_JS_V` (`index.html`) y `CACHE_SHELL` (`sw.js`) suben una sola vez, juntos.
15. **Trabajo concurrente:** antes de editar `index.html`, `api/index.py` o `js/youtube/*`, mira
    `git status` y la fecha de modificación. Si alguien más los cambió hace minutos, pregunta al dueño.
    Nunca `git checkout --` sobre trabajo ajeno.
16. **Saltos de línea:** en disco `index.html`, `api/index.py` y `js/youtube/*.js` están en **CRLF**; Git
    guarda LF. Si reemplazas texto exacto, compara normalizando. No conviertas archivos enteros.
17. **Honestidad (`TRAMPAS.md` §1):** cuenta las comprobaciones; una prueba que se corta no pasa. Ningún
    botón falla en silencio: todo error de una acción del dueño se dice en la interfaz con su motivo.
18. **Commits:** autor `JHONCOD24 <juanloras35@gmail.com>` (nunca el correo `noreply`). Un commit por tarea.
19. **Fuera de alcance, no tocar:** sincronización entre dispositivos, subtítulos SRT, descarga de video de
    YouTube, carpetas, el lector de PDF, `api/supadata.py`, `/api/youtube`, `/api/x-video`, `js/vendor/`
    salvo la carpeta nueva `mediabunny/`, `backend/app.py`.

## Foco de revisión (lo que más puede morder al dueño)

1. **Perder lo que organizó:** etiquetas editadas mientras suena el video, deshacer tras quitar, recargar
   la página, la migración de sus videos actuales → T2 (`verificar_biblioteca_datos`: carrera, deshacer,
   migración) y T6 (`verificar_biblioteca_videos`: recargar, deshacer).
2. **«Instantáneo» que no lo es:** abrir un video guardado sin volver a pedir el texto y con la voz
   guardada sin pasar por el limitador de 18/min → T5 (unitaria del gancho) y T6 («Listo al instante», 0
   peticiones a `/youtube`).
3. **Descargas largas en el celular:** memoria (tope 250 MB con la calidad que cabe), edge-tts lento o
   caído (2 intentos + Azure), cancelar a mitad sin dejar un archivo roto → T1 (`elegirDestino`,
   `calidadQueCabe`), T2 (cancelar), T4 (medición real) y T9 (iPhone real) **[POR CONFIRMAR]**.
4. **Contenido feo de verdad:** títulos de X de 280 caracteres, miniaturas rotas o verticales, 0 y 10
   etiquetas, 200 videos → T6 (miniatura rota) y la revisión final de impeccable (T7) con datos extremos.
5. **Teclado y lector de pantalla:** menú de la tarjeta, editor de temas y diálogo de descargas usables
   sin ratón, con foco que vuelve a su sitio y anuncios `aria-live` → T6 (Enter/Escape) y T7 (auditoría).

## Cómo se usa impeccable en este plan (obligatorio en la Fase C)

impeccable es una habilidad de diseño (`/impeccable`, carpeta `~/.claude/skills/impeccable`). En este
proyecto ya dejó:
- `PRODUCT.md` (la ficha del producto: usuario, propósito, principios). **No** la vuelvas a entrevistar.
- `.impeccable/surfaces/js-youtube-bibliotecavista-js.md`: el **brief confirmado** de esta superficie,
  con su *Direction contract* (THESIS, OWN-WORLD, STORY, FIRST VIEWPORT, FORM, FINISH). Es una
  **extensión de una superficie existente**: se hereda el sistema visual de la app, sin torneo de
  conceptos, camino **code-led** (no hay generación de imágenes en esta máquina).

Flujo exacto en la Tarea 6 (y 7):
1. `impeccable context --target js/youtube/bibliotecaVista.js` una vez (en Windows sin `sh`:
   `…/impeccable.cmd`). Carga PRODUCT.md y el brief. Si dice que el brief existe, **no** corras `shape`
   ni `init`: ya están confirmados por el dueño.
2. Lee `reference/new-work.md` (§3 «Extend an existing surface», §6–§7) y, **justo antes de tocar la
   interfaz**, `reference/craft-floor.md`.
3. Construye con compromiso total dentro del contrato de la vista de este plan (ids, roles, conducta).
4. Inspección en **una** ronda por lotes: capturas de escritorio (1440) y celular (390) en
   `.impeccable/review/desktop.png` y `mobile.png`, con la biblioteca poblada (usa la semilla de la
   prueba T6) y en estado vacío. Corrige todo lo que muestre en un solo lote; como mucho una ronda más.
5. `impeccable detect --json index.html js/youtube/bibliotecaVista.js` **una vez**; arregla lo mecánico.
6. Revisión final con el subagente `impeccable-finish-reviewer` (paquete de entrada: el pedido del
   dueño, las respuestas confirmadas de la especificación §2, la ruta del artefacto, las capturas, el
   direction contract, los hallazgos del detector, la ruta de `craft-floor.md`). Actúa según su veredicto
   (`ship`, `fix`, `rebuild`, `recapture`), máximo dos rondas.
7. Documentador: `impeccable-documenter` compara lo construido con el sistema existente (es una
   extensión: **no** reescribe un DESIGN.md que no existe como si fuera un mundo nuevo; si el documentador
   propone crear DESIGN.md desde el sistema existente, está bien y va en un commit aparte).
8. Si tu herramienta no tiene subagentes, usa las versiones `reference/degraded/*.md` y dilo en una línea.

**Criterio de terminado de la interfaz:** la prueba `verificar_biblioteca_videos.mjs` en 48 OK **y** el
veredicto `ship` (o `fix` resuelto) del revisor de impeccable. Una cosa sin la otra no cierra la tarea.

---

## Mapa de archivos

| Archivo | Acción | Responsabilidad única |
|---|---|---|
| `js/youtube/bibliotecaVideos.js` | Crear | Reglas puras de la biblioteca: fichas, etiquetas, filtros, búsqueda, avance, fechas. |
| `js/youtube/pistaDoblada.js` | Crear | Reglas puras de la pista de voz de un archivo: dónde y a qué velocidad va cada frase. |
| `js/youtube/descargaDestino.js` | Crear | Reglas puras de descargas: calidades, tamaños, adónde va, nombres de archivo. |
| `js/youtube/cacheDoblaje.js` | Reemplazar | IndexedDB `jg_youtube` v2: `doblajes` + `videos` + `voces`, migración, deshacer, tope de voces. |
| `js/youtube/medios.js` | Crear | Carga diferida de Mediabunny y registro de las extensiones MP3/AAC. |
| `js/youtube/exportadorDoblaje.js` | Crear | Arma MP3 doblado, MP4 de X doblado y baja el MP4 original. |
| `js/youtube/destinoArchivo.js` | Crear | Disco (`showSaveFilePicker`) o memoria; cancelar el selector = null. |
| `js/vendor/mediabunny/*` | Crear | Mediabunny 1.60.0 + extensiones (import reescrito) + LICENSE. |
| `js/youtube/dubbingService.js` | Modificar | Gancho `buscarGuardada` antes del limitador. |
| `js/youtube/youtubeSyncController.js` | Modificar | Registrar videos, guardar voces, abrir desde la biblioteca, descargas, montar la vista. |
| `api/index.py` | Modificar | `evitar_azure` en `/api/tts` (POST y GET). |
| `index.html` | Modificar | Generador de voz para archivos, pestaña «Videos», marcado y CSS de la biblioteca; `JG_JS_V`. |
| `js/youtube/bibliotecaVista.js` | Crear (con impeccable) | La interfaz de la biblioteca, el editor de temas y el diálogo de descargas. |
| `tests/test_biblioteca_videos.mjs` | Crear | Unitarias (sin navegador). |
| `tests/verificar_biblioteca_datos.mjs` | Crear | Guardado v2 y archivos en navegador real (sin la interfaz). |
| `tests/verificar_biblioteca_videos.mjs` | Crear | Interfaz de punta a punta contra su contrato. |
| `backend/tests/test_tts_evitar_azure.py` | Crear | El parámetro nuevo del servidor. |
| `tests/fixtures/biblioteca/*` | Crear | Voces MP3 y video tipo X hechos con FFmpeg. |
| `.gitignore`, `.vercelignore` | Modificar | Excepción de los MP3 de prueba; no publicar `.impeccable/`. |
| `CAMBIOS_BIBLIOTECA_VIDEOS.md`, `AGENTS.md`, `TRAMPAS.md`, `CONFIG_PERSISTENTE.md`, `sw.js` | Crear/Modificar | Cierre (T8–T9). |

---

## 0. Antes de empezar (obligatorio)

- [x] Leer `AGENTS.md` completo, `TRAMPAS.md` (§1, §2, §7, §8, «Un botón que falla en silencio es un
  botón roto», «video.twimg.com rechaza el Referer de otro dominio», «Publicar en Vercel no es cerrar»,
  «Redesplegar sin subir `JG_JS_V`», «`.pytest_cache` bloqueada tumba el despliegue entero»), la
  especificación, `PRODUCT.md`, el brief de `.impeccable/surfaces/` y este plan entero.
- [x] Confirmar el punto de partida:
  ```bash
  git status --short
  git log --oneline -3
  grep -o "JG_JS_V = '[^']*'" index.html && grep -o "CACHE_SHELL = '[^']*'" sw.js
  ```
  Esperado: sin cambios ajenos en `index.html`, `api/`, `js/youtube/`; `v153` y `jg-turbo-shell-v153`. Si
  es mayor, alguien desplegó después de este plan: lee sus commits y usa el número siguiente en la T9.
- [x] Crear la rama: `git switch -c feat/biblioteca-videos`
- [x] Registrar la línea base (cópiala en tu informe final; son los números que no pueden bajar):
  ```bash
  node tests/test_youtube_doblaje.mjs | tail -1
  node tests/test_youtube_sincronia.mjs | tail -1
  node tests/test_x_doblaje.mjs | tail -1
  node tests/verificar_youtube_doblaje.mjs | tail -3
  node tests/verificar_x_doblaje.mjs | tail -3
  node tests/verificar_arranque_ligero.mjs | tail -3
  node tests/verificar_movil_pantalla.mjs | tail -3
  python -m pytest backend/tests/test_tts_idioma_fijo.py backend/tests/test_x_video.py backend/tests/test_supadata_youtube.py backend/tests/test_youtube_idioma_origen.py backend/tests/test_ia_respaldo.py backend/tests/test_api_youtube_bloqueo.py -q
  ```
  Referencias medidas el 2026-09-28 en una copia de `main`: 139 · 65 · 70 · 110 · 24 · arranque **9 OK +
  1 fallo que ya existe** (1 032 KB) · móvil «62 comprobaciones» (60–62 según el contenido) · servidor
  **113 passed**. `test_youtube_doblaje` tuvo un fallo intermitente en ~1 de 22 corridas en la sesión del
  2026-09-27: si aparece, repítela antes de culpar a tu cambio.
- [x] Comprobar FFmpeg (la T2 fabrica archivos de prueba): `ffmpeg -version | head -1`. Debe listar
  `libx264` y `libmp3lame` en `ffmpeg -encoders`. Si no está, `winget install Gyan.FFmpeg`.
- [x] Comprobar que la habilidad impeccable responde: `~/.claude/skills/impeccable/scripts/impeccable context --target js/youtube/bibliotecaVista.js`
  (en Windows sin `sh`, `impeccable.cmd`). Debe mencionar el brief de la biblioteca. Si no encuentra el
  brief, **para y avisa**: sin él la interfaz se diseñaría a ciegas.

---

## Fase A · Datos y lógica

### Tarea 1: lógica pura — biblioteca, pista doblada y descargas

**Por qué:** todo lo que se puede decidir sin navegador vive en funciones puras con pruebas: qué se
guarda, qué se muestra, cómo se busca, dónde va cada frase en un archivo y cuánto pesa una descarga.

**Archivos:**
- Crear: `js/youtube/bibliotecaVideos.js`, `js/youtube/pistaDoblada.js`, `js/youtube/descargaDestino.js`
- Crear: `tests/test_biblioteca_videos.mjs`

**Interfaces que producen (las usan las tareas siguientes):**
- `bibliotecaVideos.js`: `normalizarTexto`, `limpiarEtiqueta`, `agregarEtiqueta(etiquetas, nueva) → {etiquetas, motivo}`
  (`motivo`: `''`|`'vacia'`|`'repetida'`|`'tope'`), `quitarEtiqueta`, `estadoDeAvance(pos, dur)` →
  `'nuevo'|'viendo'|'visto'`, `fraccionVista`, `datosDeClave(clave) → {plataforma, id, indice}`,
  `urlCanonica`, `portadaPorDefecto`, `fusionarEntrada(previa, nueva, ahora)` (nunca toca `etiquetas` ni
  `favorito`), `entradaDesdeDoblaje(registro)`, `filtrarVideos(videos, {texto, plataforma, vista, etiqueta,
  orden, coincidenEnTexto})`, `etiquetasConConteo`, `sugerenciasDeEtiquetas(videos, actuales, escrito)`,
  `seguirViendo`, `buscarEnTranscripcion(registro, texto) → {indice, segundo, fragmento}|null`,
  `huellaTexto`, `claveDeVoz(claveVideo, voz, texto, tasa)`, `formatearDuracion`, `fechaRelativa`;
  constantes `MAX_ETIQUETAS = 10`, `ETIQUETAS_SUGERIDAS`, `ORDENES`, `VISTAS`.
- `pistaDoblada.js`: `tasaNecesaria`, `planearPista(unidades, {duracionVideoS, acelerar, tasaMax}) →
  {plan: [{indice, inicioS, tasa, duracionS, finS}], corridas, maxRetrasoS, duracionS}`,
  `ventanasDeMezcla`, `frasesEnVentana`, `resumenCosto`; `TASA_MAX = 1.25`.
- `descargaDestino.js`: `estimarBytesVideo`, `estimarBytesMp3`, `opcionesCalidadX(variantes, duracionS) →
  [{etiqueta, alto, url, bitrate, bytes}]`, `elegirDestino({puedeGuardarEnDisco, esMovil, bytesEstimados})
  → {tipo: 'disco'|'memoria'|'grande', limite}`, `calidadQueCabe`, `formatearBytes`, `nombreArchivo`;
  `MB`, `LIMITE_MEMORIA_BYTES`, `BITRATE_AUDIO_DOBLADO`, `BITRATE_MP3`.

- [x] **Paso 1: escribir la prueba** — crear `tests/test_biblioteca_videos.mjs` con este contenido **sin la
  última sección** («Voz guardada: no gasta el limitador…»), que se agrega en la Tarea 5:

```js
/* Biblioteca de videos y descargas · funciones puras, sin navegador ni red.
 * Ejecutar: node tests/test_biblioteca_videos.mjs
 * Cada tarea del PLAN_BIBLIOTECA_VIDEOS_IMPLEMENTACION_LLM.md añade su sección
 * antes del bloque «Resumen». Cuenta las comprobaciones: si bajan, algo se cortó.
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
const DIA = 86400000;
const AHORA = Date.UTC(2026, 8, 28, 15, 0, 0);

// ── Datos de la biblioteca ───────────────────────────────────────────────
const bv = await modulo('bibliotecaVideos.js');
{
  comprobar(bv.normalizarTexto('  Inteligencía  ARTIFICIAL ') === 'inteligencia artificial', 'normalizar quita tildes, mayúsculas y espacios de más');
  comprobar(bv.limpiarEtiqueta('  #marketing, digital ') === 'Marketing digital', 'una etiqueta pierde # y comas y empieza en mayúscula');
  comprobar(bv.limpiarEtiqueta('x'.repeat(50)).length === bv.MAX_LARGO_ETIQUETA, 'una etiqueta larguísima se corta a 30 caracteres');
  comprobar(bv.agregarEtiqueta(['IA'], '   ').motivo === 'vacia', 'etiqueta vacía: se dice por qué no entra');
  comprobar(bv.agregarEtiqueta(['Negocio'], 'négocio').motivo === 'repetida', 'etiqueta repetida aunque cambie una tilde');
  const diez = Array.from({ length: 10 }, (_, i) => `Tema ${i}`);
  comprobar(bv.agregarEtiqueta(diez, 'Once').motivo === 'tope', 'el tope de 10 etiquetas se respeta y se explica');
  comprobar(bv.agregarEtiqueta(['IA'], 'ventas').etiquetas.join('|') === 'IA|Ventas', 'agregar conserva el orden');
  comprobar(bv.quitarEtiqueta(['IA', 'Ventas'], 'ventas').join('|') === 'IA', 'quitar no distingue mayúsculas');

  comprobar(bv.estadoDeAvance(5, 600) === 'nuevo', 'menos de 15 s vistos = nuevo');
  comprobar(bv.estadoDeAvance(200, 600) === 'viendo', 'a mitad = en curso');
  comprobar(bv.estadoDeAvance(580, 600) === 'visto', 'a menos de 30 s del final = visto');
  comprobar(bv.estadoDeAvance(200, 0) === 'viendo', 'sin duración conocida no se da por visto');
  comprobar(bv.fraccionVista(300, 600) === 0.5 && bv.fraccionVista(590, 600) === 1 && bv.fraccionVista(10, 0) === 0, 'fracción vista para la barra');

  comprobar(JSON.stringify(bv.datosDeClave('x:123:1')) === JSON.stringify({ plataforma: 'x', id: '123', indice: 1 }), 'la clave x:<id>:<n> se lee');
  comprobar(bv.datosDeClave('dNWkwrqAkcM').plataforma === 'youtube', 'una clave sin prefijo es de YouTube');
  comprobar(bv.urlCanonica({ plataforma: 'x', id: '123', indice: 1 }) === 'https://x.com/i/status/123/video/2', 'URL canónica de X con 2.º video');
  comprobar(bv.urlCanonica({ plataforma: 'youtube', id: 'abc' }) === 'https://www.youtube.com/watch?v=abc', 'URL canónica de YouTube');
  comprobar(bv.portadaPorDefecto({ plataforma: 'youtube', id: 'abc' }) === 'https://i.ytimg.com/vi/abc/mqdefault.jpg', 'miniatura de YouTube derivada del id');
  comprobar(bv.portadaPorDefecto({ plataforma: 'x', id: '1' }) === '', 'X no tiene miniatura derivable: viene de /api/x-video');

  const primera = bv.fusionarEntrada(null, { clave: 'abc', titulo: 'Charla de IA', duracionS: 600, posicionS: 0 }, AHORA);
  comprobar(primera.estado === 'nuevo' && primera.creado === AHORA && primera.etiquetas.length === 0 && primera.favorito === false, 'entrada nueva: sin etiquetas ni favorito');
  const organizada = { ...primera, etiquetas: ['IA'], favorito: true };
  const luego = bv.fusionarEntrada(organizada, { clave: 'abc', titulo: '', posicionS: 300 }, AHORA + DIA);
  comprobar(luego.etiquetas.join() === 'IA' && luego.favorito === true, 'lo automático nunca borra etiquetas ni favorito');
  comprobar(luego.titulo === 'Charla de IA' && luego.estado === 'viendo' && luego.creado === AHORA, 'un título vacío no pisa el bueno; el avance sí se actualiza');
  comprobar(bv.fusionarEntrada(null, { clave: 'x:9' }, AHORA).titulo === 'Video de X', 'sin título: nombre genérico por plataforma');

  const migrada = bv.entradaDesdeDoblaje({ videoId: 'x:5', titulo: 'Clip', duracionS: 120, idiomaOrigen: 'en', posicionS: 40, actualizado: AHORA - DIA, segmentos: [], traducciones: [] }, AHORA);
  comprobar(migrada.plataforma === 'x' && migrada.creado === AHORA - DIA && migrada.abierto === AHORA - DIA && migrada.estado === 'viendo', 'migración v1: la fecha de la caché se conserva');

  const videos = [
    { ...bv.fusionarEntrada(null, { clave: 'a1', titulo: 'Agentes de IA en ventas', autor: 'Canal Uno', duracionS: 900, posicionS: 300, abierto: AHORA - 1000, creado: AHORA - 5 * DIA }, AHORA), etiquetas: ['Inteligencia artificial', 'Negocio'], favorito: true },
    { ...bv.fusionarEntrada(null, { clave: 'x:22', titulo: 'Clip de marketing', autor: 'marca', duracionS: 60, posicionS: 58, abierto: AHORA - 5000, creado: AHORA - DIA }, AHORA), etiquetas: ['Negocio'] },
    { ...bv.fusionarEntrada(null, { clave: 'b2', titulo: 'Curso de Python', autor: 'Profe', duracionS: 3600, posicionS: 0, abierto: AHORA - 9000, creado: AHORA - 2 * DIA }, AHORA), etiquetas: ['Aprender'] },
  ];
  comprobar(bv.filtrarVideos(videos).map((v) => v.clave).join() === 'a1,x:22,b2', 'orden por defecto: abiertos más recientes primero');
  comprobar(bv.filtrarVideos(videos, { orden: 'antiguos' }).map((v) => v.clave).join() === 'a1,b2,x:22', 'orden: más antiguos primero (por fecha de llegada)');
  comprobar(bv.filtrarVideos(videos, { orden: 'duracion' })[0].clave === 'b2', 'orden por duración');
  comprobar(bv.filtrarVideos(videos, { orden: 'titulo' }).map((v) => v.clave).join() === 'a1,x:22,b2', 'orden alfabético en español');
  comprobar(bv.filtrarVideos(videos, { plataforma: 'x' }).map((v) => v.clave).join() === 'x:22', 'filtro por plataforma');
  comprobar(bv.filtrarVideos(videos, { vista: 'favoritos' }).map((v) => v.clave).join() === 'a1', 'filtro de favoritos');
  comprobar(bv.filtrarVideos(videos, { vista: 'vistos' }).map((v) => v.clave).join() === 'x:22', 'filtro de vistos');
  comprobar(bv.filtrarVideos(videos, { vista: 'viendo' }).map((v) => v.clave).join() === 'a1', 'filtro de en curso');
  comprobar(bv.filtrarVideos(videos, { etiqueta: 'negocio' }).length === 2, 'filtro por etiqueta sin distinguir mayúsculas');
  comprobar(bv.filtrarVideos(videos, { texto: 'ventas ia' }).map((v) => v.clave).join() === 'a1', 'buscar con varias palabras en cualquier orden');
  comprobar(bv.filtrarVideos(videos, { texto: 'profe' }).map((v) => v.clave).join() === 'b2', 'buscar también por canal o autor');
  comprobar(bv.filtrarVideos(videos, { texto: 'inteligencia' }).map((v) => v.clave).join() === 'a1', 'buscar también por etiqueta');
  comprobar(bv.filtrarVideos(videos, { texto: 'zzz' }).length === 0, 'sin coincidencias → lista vacía (la vista muestra el estado «sin resultados»)');
  comprobar(bv.filtrarVideos(videos, { texto: 'recursion', coincidenEnTexto: new Map([['b2', {}]]) }).map((v) => v.clave).join() === 'b2', 'una coincidencia en lo que se dice también cuenta');
  comprobar(bv.filtrarVideos(videos, { texto: 'IA', plataforma: 'x' }).length === 0, 'los filtros se combinan');
  comprobar(bv.filtrarVideos([], { texto: 'x' }).length === 0 && bv.filtrarVideos(undefined).length === 0, 'biblioteca vacía o sin datos no rompe');

  const conteo = bv.etiquetasConConteo(videos);
  comprobar(conteo[0].etiqueta === 'Negocio' && conteo[0].cantidad === 2, 'las etiquetas más usadas van primero');
  const sug = bv.sugerenciasDeEtiquetas(videos, ['Negocio'], '');
  comprobar(!sug.includes('Negocio') && sug.includes('Inteligencia artificial') && sug.includes('Aprender'), 'sugerencias: las usadas, sin las que ya tiene el video');
  comprobar(bv.sugerenciasDeEtiquetas([], [], 'apre').join() === 'Aprender', 'sin videos, sugiere los temas de arranque que coinciden');
  comprobar(bv.seguirViendo(videos)?.clave === 'a1' && bv.seguirViendo([]) === null, '«Seguir viendo» = el último en curso');

  const registro = {
    segmentos: [{ startTime: 0, text: 'Hello everyone' }, { startTime: 754.2, text: 'Recursion is simple' }],
    traducciones: [[0, 'Hola a todos'], [1, 'La recursión es sencilla']],
  };
  const hallado = bv.buscarEnTranscripcion(registro, 'recursion sencilla');
  comprobar(hallado?.segundo === 754.2 && hallado.fragmento.startsWith('La recursión'), 'buscar en lo que se dice devuelve el segundo exacto');
  comprobar(bv.buscarEnTranscripcion(registro, 'recursion simple')?.indice === 1, 'también busca en el texto original');
  comprobar(bv.buscarEnTranscripcion(registro, '') === null && bv.buscarEnTranscripcion(null, 'x') === null, 'consulta vacía o sin registro → null');

  comprobar(bv.huellaTexto('Hola') === bv.huellaTexto('Hola') && bv.huellaTexto('Hola') !== bv.huellaTexto('Hola.'), 'la huella cambia si el texto cambia');
  comprobar(bv.claveDeVoz('abc', 'neural:auto:female', 'Hola') !== bv.claveDeVoz('abc', 'neural:auto:female', 'Hola', 1.2), 'la voz a 1,2× se guarda aparte de la de 1×');
  comprobar(bv.formatearDuracion(65) === '1:05' && bv.formatearDuracion(3725) === '1:02:05' && bv.formatearDuracion(0) === '0:00', 'duración 1:05 · 1:02:05');
  comprobar(bv.fechaRelativa(AHORA, AHORA) === 'Hoy' && bv.fechaRelativa(AHORA - DIA, AHORA) === 'Ayer' && bv.fechaRelativa(AHORA - 3 * DIA, AHORA) === 'Hace 3 días', 'fecha relativa: hoy, ayer, hace N días');
  comprobar(/sept?/.test(bv.fechaRelativa(Date.UTC(2026, 8, 12, 15), AHORA)), 'más de una semana: fecha corta en español');
}

// ── Pista doblada ────────────────────────────────────────────────────────
const pd = await modulo('pistaDoblada.js');
{
  comprobar(pd.tasaNecesaria(4, 5) === 1, 'si cabe, va a 1×');
  comprobar(pd.tasaNecesaria(5.4, 5) === 1.1, 'si no cabe, se acelera en pasos de 0,05 (5,4 s en 5 s → 1,1×)');
  comprobar(pd.tasaNecesaria(9, 5) === 1.25, 'nunca más de 1,25×');
  comprobar(pd.tasaNecesaria(0, 5) === 1 && pd.tasaNecesaria(3, 0) === 1.25, 'sin voz = 1×; sin espacio = tope');

  const unidades = [
    { indice: 0, startTime: 0, duracionVoz: 3 },
    { indice: 1, startTime: 4, duracionVoz: 4.5 },   // espacio 4 s → 1,15×
    { indice: 2, startTime: 8, duracionVoz: 2 },
  ];
  const { plan, corridas, maxRetrasoS } = pd.planearPista(unidades, { duracionVideoS: 20 });
  comprobar(plan[0].inicioS === 0 && plan[0].tasa === 1, 'la 1.ª frase empieza en su segundo, a 1×');
  comprobar(plan[1].tasa === 1.15 && plan[1].finS <= 8, 'la frase que no cabe se acelera lo justo y termina antes de la siguiente');
  comprobar(plan[2].inicioS === 8 && corridas === 0 && maxRetrasoS === 0, 'nadie se corre si todo cabe');
  const apretado = pd.planearPista([{ indice: 0, startTime: 0, duracionVoz: 10 }, { indice: 1, startTime: 4, duracionVoz: 2 }], { duracionVideoS: 30 });
  comprobar(apretado.corridas === 1 && apretado.plan[1].inicioS > 4 && apretado.plan[1].inicioS >= apretado.plan[0].finS, 'si ni a 1,25× cabe, empuja a la siguiente y lo cuenta (sin solaparse)');
  comprobar(apretado.duracionS === 30, 'la pista dura al menos lo que el video');
  const segunda = pd.planearPista([{ indice: 0, startTime: 0, duracionVoz: 3.9, tasa: 1.15 }], { acelerar: false, duracionVideoS: 10 });
  comprobar(segunda.plan[0].tasa === 1.15 && segunda.plan[0].duracionS === 3.9, 'segunda pasada: respeta la tasa ya aplicada y la duración real');
  comprobar(pd.planearPista([]).plan.length === 0, 'sin frases no rompe');

  const ventanas = pd.ventanasDeMezcla(75);
  comprobar(ventanas.length === 3 && ventanas[2].desdeS === 60 && ventanas[2].hastaS === 75, 'ventanas de 30 s hasta el final exacto');
  comprobar(pd.frasesEnVentana(plan, 2, 6).map((f) => f.indice).join() === '0,1', 'una frase que cruza el borde de la ventana entra');
  comprobar(pd.frasesEnVentana(plan, 3, 3.5).length === 0, 'una frase que termina justo donde empieza la ventana no entra');
  const costo = pd.resumenCosto(['Hola a todos.', '', 'x'.repeat(4987)]);
  comprobar(costo.frases === 2 && costo.caracteres === 5000 && costo.porcentajeAzureMes === 1, 'costo: 5 000 caracteres = 1 % de la cuota mensual de Azure');
}

// ── Descargas ────────────────────────────────────────────────────────────
const dd = await modulo('descargaDestino.js');
{
  const variantes = [
    { url: 'a', bitrate: 288000, ancho: 480, alto: 270 },
    { url: 'b', bitrate: 832000, ancho: 640, alto: 360 },
    { url: 'c', bitrate: 2176000, ancho: 1280, alto: 720 },
    { url: 'd', bitrate: 10368000, ancho: 1920, alto: 1080 },
  ];
  const opciones = dd.opcionesCalidadX(variantes, 1595);
  comprobar(opciones.map((o) => o.etiqueta).join() === '360p,720p,1080p', 'calidades ofrecidas sin repetir (270p y 360p cuentan como 360p; gana la mejor)');
  comprobar(opciones[0].url === 'b' && opciones[0].bytes === Math.round(832000 / 8 * 1595), 'el tamaño se estima con el bitrate × duración');
  comprobar(dd.opcionesCalidadX([{ url: 'v', bitrate: 950000, ancho: 720, alto: 1280 }], 60)[0].etiqueta === '720p', 'un video vertical se nombra por su lado corto');
  comprobar(dd.opcionesCalidadX([], 60).length === 0, 'sin variantes, sin opciones');
  comprobar(dd.elegirDestino({ puedeGuardarEnDisco: true, esMovil: false, bytesEstimados: 5e9 }).tipo === 'disco', 'Chrome de escritorio: directo al disco, sin tope');
  comprobar(dd.elegirDestino({ puedeGuardarEnDisco: false, esMovil: true, bytesEstimados: 100 * dd.MB }).tipo === 'memoria', 'celular: en memoria si cabe');
  comprobar(dd.elegirDestino({ puedeGuardarEnDisco: true, esMovil: true, bytesEstimados: 400 * dd.MB }).tipo === 'grande', 'celular: más de 250 MB no cabe (aunque diga que puede guardar en disco)');
  comprobar(dd.calidadQueCabe(opciones, 250 * dd.MB).etiqueta === '360p', 'la mejor calidad que cabe (26 min: 360p ≈ 158 MB)');
  comprobar(dd.calidadQueCabe(opciones, 1).etiqueta === '360p' && dd.calidadQueCabe([], 1) === null, 'si nada cabe, la más baja; sin opciones, null');
  comprobar(dd.estimarBytesMp3(3600) === 28800000, 'MP3 de 1 h a 64 kbps ≈ 27 MB');
  comprobar(dd.formatearBytes(158 * dd.MB) === '158 MB' && dd.formatearBytes(1.5 * 1024 * dd.MB) === '1,5 GB' && dd.formatearBytes(10) === '1 KB', 'tamaños legibles');
  comprobar(dd.nombreArchivo({ titulo: '¿Qué es la IA? — Parte 1', plataforma: 'x', tipo: 'doblado', extension: 'mp4' }) === 'jg-turbo-x-que-es-la-ia-parte-1-doblado-es.mp4', 'nombre de archivo limpio y en minúsculas');
  comprobar(dd.nombreArchivo({ titulo: '', tipo: 'audio', extension: 'mp3' }) === 'jg-turbo-youtube-video-audio-es.mp3', 'sin título: «video»');
}

// ── Voz guardada: no gasta el limitador de Azure (dubbingService.js) ──────
const ds = await modulo('dubbingService.js');
{
  let turnos = 0;
  let generadas = 0;
  const limitador = { disponible: () => true, esperaMs: () => 0, registrar: () => { turnos += 1; } };
  const blob = new Blob([new Uint8Array(6000)], { type: 'audio/mpeg' });
  const servicio = new ds.DubbingService({
    generarAudio: async () => { generadas += 1; return { blob }; },
    buscarGuardada: async (texto) => (texto === 'guardada' ? { blob, engineHdr: 'azure' } : null),
    limitador,
    medirDuracion: async () => 1,
  });
  servicio.definirUnidades([
    { indice: 0, startTime: 0, endTime: 2, estado: 'sin_traducir' },
    { indice: 1, startTime: 2, endTime: 4, estado: 'sin_traducir' },
  ]);
  servicio.fijarTexto(0, 'guardada');
  servicio.fijarTexto(1, 'nueva');
  await servicio.asegurar(0);
  await servicio.asegurar(1);
  comprobar(turnos === 1 && generadas === 1, 'la voz guardada no gasta turno del limitador ni se vuelve a pedir');
  comprobar(servicio.unidades[0].estado === 'listo' && servicio.unidades[0].duracionVoz === 1, 'la frase guardada queda lista y medida');
  const sinGuardado = new ds.DubbingService({ generarAudio: async () => ({ blob }), limitador, medirDuracion: async () => 1 });
  sinGuardado.definirUnidades([{ indice: 0, startTime: 0, endTime: 2, estado: 'sin_traducir' }]);
  sinGuardado.fijarTexto(0, 'x');
  await sinGuardado.asegurar(0);
  comprobar(turnos === 2, 'sin buscarGuardada todo sigue igual que antes (una frase = un turno)');
  servicio.liberar();
  sinGuardado.liberar();
}

// ── Resumen ─────────────────────────────────────────────────────────────
console.log(`\n${ok} comprobaciones OK · ${fallos} fallos`);
if (fallos) process.exit(1);
```

- [x] **Paso 2: ejecutar y ver que falla** — `node tests/test_biblioteca_videos.mjs` →
  `ERR_MODULE_NOT_FOUND … bibliotecaVideos.js`.

- [x] **Paso 3: implementar** `js/youtube/bibliotecaVideos.js`:

```js
/**
 * Biblioteca de videos doblados: reglas puras, sin IndexedDB ni DOM, para
 * probarlas en Node. El almacenamiento vive en cacheDoblaje.js y la vista en
 * bibliotecaVista.js.
 *
 * Regla que no se rompe: lo automático (título, duración, posición) se
 * actualiza solo; lo que organizó la persona (etiquetas, favorito) solo lo
 * cambia ella. `fusionarEntrada` nunca toca esos dos campos.
 */
export const MAX_ETIQUETAS = 10;
export const MAX_LARGO_ETIQUETA = 30;
/** Los temas que más dobla el dueño (PRODUCT.md): se ofrecen de arranque, no se imponen. */
export const ETIQUETAS_SUGERIDAS = Object.freeze(['Inteligencia artificial', 'Aprender', 'Negocio']);
export const UMBRAL_EMPEZADO_S = 15;
export const MARGEN_FINAL_S = 30;
export const ORDENES = Object.freeze(['recientes', 'antiguos', 'titulo', 'duracion']);
export const VISTAS = Object.freeze(['todos', 'favoritos', 'viendo', 'vistos']);

export function normalizarTexto(texto) {
  return String(texto ?? '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/\s+/g, ' ').trim();
}

export function limpiarEtiqueta(texto) {
  const limpia = String(texto ?? '').replace(/[#,;]/g, ' ').replace(/\s+/g, ' ').trim()
    .slice(0, MAX_LARGO_ETIQUETA).trim();
  return limpia ? limpia.charAt(0).toLocaleUpperCase('es') + limpia.slice(1) : '';
}

/** `motivo`: '' si se agregó · 'vacia' · 'repetida' · 'tope' (para decirlo en la interfaz). */
export function agregarEtiqueta(etiquetas, nueva) {
  const lista = Array.isArray(etiquetas) ? [...etiquetas] : [];
  const limpia = limpiarEtiqueta(nueva);
  if (!limpia) return { etiquetas: lista, motivo: 'vacia' };
  if (lista.some((e) => normalizarTexto(e) === normalizarTexto(limpia))) return { etiquetas: lista, motivo: 'repetida' };
  if (lista.length >= MAX_ETIQUETAS) return { etiquetas: lista, motivo: 'tope' };
  return { etiquetas: [...lista, limpia], motivo: '' };
}

export function quitarEtiqueta(etiquetas, etiqueta) {
  const clave = normalizarTexto(etiqueta);
  return (Array.isArray(etiquetas) ? etiquetas : []).filter((e) => normalizarTexto(e) !== clave);
}

export function estadoDeAvance(posicionS, duracionS) {
  const posicion = Number(posicionS) || 0;
  const duracion = Number(duracionS) || 0;
  if (posicion < UMBRAL_EMPEZADO_S) return 'nuevo';
  if (duracion > 0 && (posicion >= duracion - MARGEN_FINAL_S || posicion / duracion >= 0.95)) return 'visto';
  return 'viendo';
}

export function fraccionVista(posicionS, duracionS) {
  const duracion = Number(duracionS) || 0;
  if (!duracion) return 0;
  if (estadoDeAvance(posicionS, duracion) === 'visto') return 1;
  return Math.max(0, Math.min(1, (Number(posicionS) || 0) / duracion));
}

/** La clave de caché dice la plataforma: YouTube = id tal cual; X = «x:<id>» o «x:<id>:<n>». */
export function datosDeClave(clave) {
  const texto = String(clave || '');
  if (texto.startsWith('x:')) {
    const [, id = '', n = '0'] = texto.split(':');
    return { plataforma: 'x', id, indice: Number(n) || 0 };
  }
  return { plataforma: 'youtube', id: texto, indice: 0 };
}

export function urlCanonica({ plataforma, id, indice = 0 }) {
  if (plataforma === 'x') return `https://x.com/i/status/${id}${indice ? `/video/${indice + 1}` : ''}`;
  return `https://www.youtube.com/watch?v=${id}`;
}

export function portadaPorDefecto({ plataforma, id }) {
  return plataforma === 'youtube' && id ? `https://i.ytimg.com/vi/${encodeURIComponent(id)}/mqdefault.jpg` : '';
}

/** Une lo que ya había con lo nuevo. Nunca toca `etiquetas` ni `favorito`. */
export function fusionarEntrada(previa, nueva, ahora = Date.now()) {
  const base = previa || {};
  const clave = nueva?.clave ?? base.clave;
  const datos = datosDeClave(clave);
  const duracionS = Number(nueva?.duracionS) || Number(base.duracionS) || 0;
  const posicionS = Number(nueva?.posicionS ?? base.posicionS) || 0;
  const tituloPorDefecto = datos.plataforma === 'x' ? 'Video de X' : 'Video de YouTube';
  return {
    clave,
    plataforma: datos.plataforma,
    id: datos.id,
    indice: datos.indice,
    url: urlCanonica(datos),
    titulo: String(nueva?.titulo || base.titulo || '').trim() || tituloPorDefecto,
    autor: String(nueva?.autor || base.autor || '').trim(),
    portada: nueva?.portada || base.portada || portadaPorDefecto(datos),
    duracionS,
    idiomaOrigen: nueva?.idiomaOrigen || base.idiomaOrigen || '',
    voz: nueva?.voz || base.voz || '',
    etiquetas: Array.isArray(base.etiquetas) ? base.etiquetas : [],
    favorito: Boolean(base.favorito),
    posicionS,
    estado: estadoDeAvance(posicionS, duracionS),
    creado: base.creado || nueva?.creado || ahora,
    abierto: nueva?.abierto ?? base.abierto ?? ahora,
    actualizado: ahora,
  };
}

/** Migración v1 → v2: cada doblaje ya guardado entra a la biblioteca. */
export function entradaDesdeDoblaje(registro, ahora = Date.now()) {
  const cuando = Number(registro?.actualizado) || ahora;
  return fusionarEntrada(null, {
    clave: registro?.videoId,
    titulo: registro?.titulo,
    duracionS: registro?.duracionS,
    idiomaOrigen: registro?.idiomaOrigen,
    posicionS: registro?.posicionS,
    creado: cuando,
    abierto: cuando,
  }, cuando);
}

function compararPor(orden) {
  const titulo = (a, b) => String(a.titulo || '').localeCompare(String(b.titulo || ''), 'es', { sensitivity: 'base' });
  if (orden === 'antiguos') return (a, b) => (a.creado || 0) - (b.creado || 0) || titulo(a, b);
  if (orden === 'titulo') return (a, b) => titulo(a, b) || (b.abierto || 0) - (a.abierto || 0);
  if (orden === 'duracion') return (a, b) => (b.duracionS || 0) - (a.duracionS || 0) || titulo(a, b);
  return (a, b) => (b.abierto || 0) - (a.abierto || 0) || titulo(a, b);
}

/**
 * `coincidenEnTexto`: Map clave → coincidencia de `buscarEnTranscripcion`
 * (solo cuando la persona activó «Buscar también en lo que se dice»).
 */
export function filtrarVideos(videos, {
  texto = '', plataforma = 'todas', vista = 'todos', etiqueta = '', orden = 'recientes', coincidenEnTexto = null,
} = {}) {
  const palabras = normalizarTexto(texto).split(' ').filter(Boolean);
  const etiquetaBuscada = normalizarTexto(etiqueta);
  const lista = (Array.isArray(videos) ? videos : []).filter((video) => {
    if (plataforma !== 'todas' && video.plataforma !== plataforma) return false;
    if (vista === 'favoritos' && !video.favorito) return false;
    if (vista === 'viendo' && video.estado !== 'viendo') return false;
    if (vista === 'vistos' && video.estado !== 'visto') return false;
    if (etiquetaBuscada && !(video.etiquetas || []).some((e) => normalizarTexto(e) === etiquetaBuscada)) return false;
    if (!palabras.length) return true;
    const pajar = normalizarTexto([video.titulo, video.autor, ...(video.etiquetas || []), video.id].join(' '));
    return palabras.every((p) => pajar.includes(p)) || Boolean(coincidenEnTexto?.has(video.clave));
  });
  return lista.sort(compararPor(ORDENES.includes(orden) ? orden : 'recientes'));
}

export function etiquetasConConteo(videos) {
  const conteo = new Map();
  for (const video of Array.isArray(videos) ? videos : []) {
    for (const etiqueta of video.etiquetas || []) {
      const clave = normalizarTexto(etiqueta);
      const previo = conteo.get(clave);
      conteo.set(clave, { etiqueta: previo?.etiqueta || etiqueta, cantidad: (previo?.cantidad || 0) + 1 });
    }
  }
  return [...conteo.values()].sort((a, b) => b.cantidad - a.cantidad || a.etiqueta.localeCompare(b.etiqueta, 'es'));
}

/** Sugerencias para el editor: primero las que ya usa, luego las de arranque, sin repetir las del video. */
export function sugerenciasDeEtiquetas(videos, actuales = [], escrito = '') {
  const usadas = new Set((actuales || []).map(normalizarTexto));
  const consulta = normalizarTexto(escrito);
  const candidatas = [...etiquetasConConteo(videos).map((e) => e.etiqueta), ...ETIQUETAS_SUGERIDAS];
  const vistas = new Set();
  return candidatas.filter((e) => {
    const clave = normalizarTexto(e);
    if (usadas.has(clave) || vistas.has(clave)) return false;
    vistas.add(clave);
    return !consulta || clave.includes(consulta);
  }).slice(0, 8);
}

export function seguirViendo(videos) {
  return (Array.isArray(videos) ? videos : [])
    .filter((v) => v.estado === 'viendo')
    .sort((a, b) => (b.abierto || 0) - (a.abierto || 0))[0] || null;
}

/**
 * Busca en lo que se dice (texto original y traducción guardada). Devuelve
 * dónde: la tarjeta ofrece abrir el video en ese segundo.
 */
export function buscarEnTranscripcion(registro, texto) {
  const palabras = normalizarTexto(texto).split(' ').filter(Boolean);
  if (!palabras.length || !registro) return null;
  const traducciones = new Map(Array.isArray(registro.traducciones) ? registro.traducciones : []);
  const segmentos = Array.isArray(registro.segmentos) ? registro.segmentos : [];
  for (let i = 0; i < segmentos.length; i += 1) {
    const traducido = traducciones.get(i);
    for (const frase of [traducido, segmentos[i]?.text]) {
      if (!frase) continue;
      const normal = normalizarTexto(frase);
      if (palabras.every((p) => normal.includes(p))) {
        return { indice: i, segundo: Number(segmentos[i].startTime) || 0, fragmento: String(frase).slice(0, 140) };
      }
    }
  }
  return null;
}

/** Huella corta (FNV-1a de 32 bits) del texto de una frase: si la traducción cambia, la voz guardada ya no sirve. */
export function huellaTexto(texto) {
  let h = 0x811c9dc5;
  for (const c of String(texto ?? '')) {
    h ^= c.codePointAt(0);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(36);
}

/** Clave de una frase de voz guardada: video + voz + texto exacto (y velocidad, si no es 1×). */
export function claveDeVoz(claveVideo, voz, texto, tasa = 1) {
  const velocidad = Math.abs((Number(tasa) || 1) - 1) < 0.001 ? '' : `|${Number(tasa).toFixed(2)}`;
  return `${claveVideo}|${voz}|${huellaTexto(texto)}${velocidad}`;
}

export function formatearDuracion(segundos) {
  const total = Math.max(0, Math.round(Number(segundos) || 0));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
}

export function fechaRelativa(ms, ahora = Date.now()) {
  const dia = (t) => { const d = new Date(t); return Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()); };
  const dias = Math.round((dia(ahora) - dia(ms)) / 86400000);
  if (dias <= 0) return 'Hoy';
  if (dias === 1) return 'Ayer';
  if (dias < 7) return `Hace ${dias} días`;
  const fecha = new Date(ms);
  const mismoAno = fecha.getFullYear() === new Date(ahora).getFullYear();
  return fecha.toLocaleDateString('es-CO', { day: 'numeric', month: 'short', ...(mismoAno ? {} : { year: 'numeric' }) }).replace('.', '');
}
```

  `js/youtube/pistaDoblada.js`:

```js
/**
 * Pista de voz en español para un ARCHIVO (MP3 o MP4 doblado): dónde empieza
 * cada frase y a qué velocidad, con los tiempos del video original.
 *
 * En vivo, si el español no cabe, el video se frena (dubbingEngine). Un
 * archivo no puede frenar el video: la frase que no cabe en su espacio se
 * vuelve a pedir más rápida (la API aplica `rate` con prosodia: no cambia el
 * tono; medido 2026-09-28: a 1,2× la frase dura 16 % menos) hasta 1,25×, la
 * velocidad más alta que el doblaje en vivo considera cómoda. Si ni así cabe,
 * empuja a la siguiente y queda contada en `corridas`.
 */
export const TASA_MAX = 1.25;
export const PASO_TASA = 0.05;
export const RESPIRO_S = 0.08;
export const VENTANA_MEZCLA_S = 30;
export const CUOTA_AZURE_MES = 500000;
const redondear = (s) => Math.round(s * 1000) / 1000;

export function tasaNecesaria(duracionVoz, espacioS, tasaMax = TASA_MAX) {
  const voz = Number(duracionVoz) || 0;
  if (voz <= 0) return 1;
  if (!(espacioS > 0)) return tasaMax;
  const bruta = voz / espacioS;
  if (bruta <= 1) return 1;
  return Math.min(tasaMax, Math.round(Math.ceil(bruta / PASO_TASA - 1e-9) * PASO_TASA * 100) / 100);
}

/**
 * `unidades`: [{ indice, startTime, duracionVoz, tasa? }] en orden. Con
 * `acelerar: false` se respeta la `tasa` que ya trae cada frase (segunda
 * pasada, con la duración real del audio ya acelerado).
 */
export function planearPista(unidades, { duracionVideoS = Infinity, acelerar = true, tasaMax = TASA_MAX } = {}) {
  const lista = Array.isArray(unidades) ? unidades : [];
  const plan = [];
  let finAnterior = 0;
  let corridas = 0;
  let maxRetrasoS = 0;
  lista.forEach((unidad, k) => {
    const siguiente = lista[k + 1];
    const limite = siguiente ? Number(siguiente.startTime) : duracionVideoS;
    const inicio = Math.max(Number(unidad.startTime) || 0, k ? finAnterior + RESPIRO_S : 0);
    const tasa = acelerar ? tasaNecesaria(unidad.duracionVoz, limite - inicio, tasaMax) : (Number(unidad.tasa) || 1);
    const duracion = acelerar ? (Number(unidad.duracionVoz) || 0) / tasa : (Number(unidad.duracionVoz) || 0);
    const fin = inicio + duracion;
    if (fin > limite + 1e-6) corridas += 1;
    maxRetrasoS = Math.max(maxRetrasoS, inicio - (Number(unidad.startTime) || 0));
    plan.push({ indice: unidad.indice, inicioS: redondear(inicio), tasa, duracionS: redondear(duracion), finS: redondear(fin) });
    finAnterior = fin;
  });
  const cierre = Number.isFinite(duracionVideoS) ? Math.max(finAnterior, duracionVideoS) : finAnterior;
  return { plan, corridas, maxRetrasoS: redondear(maxRetrasoS), duracionS: redondear(cierre) };
}

/** Ventanas de mezcla: se renderiza de a 30 s para no tener la hora entera en memoria. */
export function ventanasDeMezcla(duracionS, tamanoS = VENTANA_MEZCLA_S) {
  const total = Math.max(0, Number(duracionS) || 0);
  const ventanas = [];
  for (let desde = 0; desde < total; desde += tamanoS) {
    ventanas.push({ desdeS: redondear(desde), hastaS: redondear(Math.min(total, desde + tamanoS)) });
  }
  return ventanas;
}

/** Frases que suenan (aunque sea en parte) dentro de una ventana. */
export function frasesEnVentana(plan, desdeS, hastaS) {
  return (plan || []).filter((f) => f.inicioS < hastaS && f.finS > desdeS);
}

/** Lo que se muestra ANTES de pedir el «sí» (PRODUCT.md: decir la verdad sobre lo que cuesta). */
export function resumenCosto(textos) {
  const caracteres = (textos || []).reduce((suma, t) => suma + String(t || '').length, 0);
  return {
    frases: (textos || []).filter((t) => String(t || '').trim()).length,
    caracteres,
    porcentajeAzureMes: Math.round((caracteres / CUOTA_AZURE_MES) * 1000) / 10,
  };
}
```

  `js/youtube/descargaDestino.js`:

```js
/**
 * Descargas de la biblioteca: qué se puede bajar, cuánto pesa y adónde va.
 *
 * Chrome/Edge de escritorio escriben directo al disco (`showSaveFilePicker`):
 * sin tope práctico. En los demás el archivo se arma en memoria antes de
 * guardarse; por encima del límite el teléfono se queda sin memoria, así que
 * se ofrece una calidad menor en vez de fallar a mitad.
 */
export const MB = 1024 * 1024;
export const LIMITE_MEMORIA_BYTES = Object.freeze({ movil: 250 * MB, escritorio: 1500 * MB });
export const BITRATE_AUDIO_DOBLADO = 128000;
export const BITRATE_MP3 = 64000;
export const ALTOS_OFRECIDOS = Object.freeze([360, 480, 720, 1080]);

/** Tamaño de un MP4 de X: el `bitrate` de la variante ya incluye el audio (medido: techo, no exacto). */
export function estimarBytesVideo(bitrate, duracionS) {
  return Math.round(((Number(bitrate) || 0) / 8) * (Number(duracionS) || 0));
}

export function estimarBytesMp3(duracionS, bitrate = BITRATE_MP3) {
  return Math.round((bitrate / 8) * (Number(duracionS) || 0));
}

/** Calidades del video original de X, de menor a mayor, sin repetir alturas. */
export function opcionesCalidadX(variantes, duracionS) {
  const porAlto = new Map();
  for (const v of Array.isArray(variantes) ? variantes : []) {
    const lado = Math.min(Number(v.ancho) || 0, Number(v.alto) || 0);
    const alto = ALTOS_OFRECIDOS.find((a) => lado > 0 && lado <= a + 10);
    if (!alto || !v.url) continue;
    const previa = porAlto.get(alto);
    if (!previa || (Number(v.bitrate) || 0) > previa.bitrate) {
      porAlto.set(alto, { etiqueta: `${alto}p`, alto, url: v.url, bitrate: Number(v.bitrate) || 0 });
    }
  }
  return [...porAlto.values()]
    .sort((a, b) => a.alto - b.alto)
    .map((o) => ({ ...o, bytes: estimarBytesVideo(o.bitrate, duracionS) }));
}

/**
 * `tipo`: 'disco' (se escribe a medida que se genera) · 'memoria' (cabe) ·
 * 'grande' (no cabe en memoria en este equipo: ofrecer menos calidad).
 */
export function elegirDestino({ puedeGuardarEnDisco = false, esMovil = false, bytesEstimados = 0 } = {}) {
  if (puedeGuardarEnDisco && !esMovil) return { tipo: 'disco', limite: Infinity };
  const limite = esMovil ? LIMITE_MEMORIA_BYTES.movil : LIMITE_MEMORIA_BYTES.escritorio;
  return { tipo: bytesEstimados <= limite ? 'memoria' : 'grande', limite };
}

/** La mejor calidad que cabe en memoria (o la más baja si ninguna cabe). */
export function calidadQueCabe(opciones, limiteBytes) {
  const lista = Array.isArray(opciones) ? opciones : [];
  const caben = lista.filter((o) => o.bytes <= limiteBytes);
  return caben.length ? caben[caben.length - 1] : lista[0] || null;
}

export function formatearBytes(bytes) {
  const b = Number(bytes) || 0;
  if (b >= 1024 * MB) return `${(b / (1024 * MB)).toFixed(1).replace('.', ',')} GB`;
  if (b >= MB) return `${Math.round(b / MB)} MB`;
  return `${Math.max(1, Math.round(b / 1024))} KB`;
}

export function nombreArchivo({ titulo = '', plataforma = 'youtube', tipo = 'doblado', extension = 'mp4' } = {}) {
  const base = String(titulo).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60).replace(/-+$/, '') || 'video';
  const sufijo = { original: 'original', doblado: 'doblado-es', audio: 'audio-es' }[tipo] || tipo;
  return `jg-turbo-${plataforma === 'x' ? 'x' : 'youtube'}-${base}-${sufijo}.${extension}`;
}
```

- [x] **Paso 4: ejecutar** — `node tests/test_biblioteca_videos.mjs` → **`80 comprobaciones OK · 0 fallos`**
  (sin la sección de la T5).
- [x] **Paso 5: commit** — `git add js/youtube/bibliotecaVideos.js js/youtube/pistaDoblada.js js/youtube/descargaDestino.js tests/test_biblioteca_videos.mjs && git commit -m "feat(videos): reglas puras de la biblioteca, la pista doblada y las descargas"`

---

### Tarea 2: guardado v2 y generador de archivos (Mediabunny)

**Por qué:** la biblioteca necesita su ficha liviana (`videos`), la voz guardada (`voces`) y la migración
de los videos que el dueño ya tiene. Las descargas necesitan Mediabunny (M1–M6 de la especificación).

**Archivos:**
- Reemplazar: `js/youtube/cacheDoblaje.js`
- Crear: `js/youtube/medios.js`, `js/youtube/exportadorDoblaje.js`, `js/youtube/destinoArchivo.js`
- Crear: `js/vendor/mediabunny/` (4 archivos), `tests/fixtures/biblioteca/` (4 archivos)
- Crear: `tests/verificar_biblioteca_datos.mjs`
- Modificar: `.gitignore`

**Interfaces que producen:**
- `cacheDoblaje.js` (lo que ya existía sigue igual: `leerDoblaje`, `guardarDoblaje`): `listarDoblajes`,
  `listarVideos`, `leerVideo`, `registrarVideo(datos) → entrada|null`, `actualizarVideo(clave, cambios)`,
  `quitarVideo(clave) → copia|null`, `restaurarVideo(copia) → boolean`, `leerVoz(clave) → {blob, motor}|null`,
  `guardarVoz(clave, video, blob, motor)`, `videosConVoz() → Set`, `podarVoces(presupuesto)`,
  `espacioYPersistencia()`, `pedirPersistencia()`, `PRESUPUESTO_VOCES_BYTES`. Ya **no** existen `podar`
  ni `MAX_VIDEOS` (nadie más los usa: comprobado con `grep`).
- `medios.js`: `cargarMedios(ruta)`, `asegurarMp3(mb, ruta)`, `asegurarAac(mb, ruta)`, `RUTA_MEDIOS`.
- `exportadorDoblaje.js`: `decodificarAudio(blob)`, `prepararVoces(frases, opciones)`, `mezclarVentana`,
  `exportarMp3({frases, duracionVideoS, sintetizar, destino, signal, onProgreso}) → {frases, aceleradas, corridas}`,
  `exportarMp4DobladoX({mp4Url, frases, sintetizar, destino, signal, onProgreso, volumenOriginal}) →
  {frases, aceleradas, corridas, conOriginal}`, `descargarOriginalX({mp4Url, destino, signal, onProgreso}) → {bytes}`.
  `sintetizar(texto, {tasa, signal, frase}) → Blob`. `onProgreso({fase: 'traduccion'|'voz'|'ajuste'|'archivo'|'descarga', hechas, total})`.
- `destinoArchivo.js`: `crearDestino({nombre, tipoMime, bytesEstimados, esMovil}) → destino|null` (null =
  cerró el selector), `ErrorDestino` (código `'grande'`).

- [x] **Paso 1: Mediabunny en vendor** (una sola vez; comprueba que los tamaños coinciden: ~685 KB, ~312 KB,
  ~993 KB, LICENSE ~16 KB):

```bash
mkdir -p js/vendor/mediabunny && cd js/vendor/mediabunny
curl -sfo mediabunny.min.mjs https://cdn.jsdelivr.net/npm/mediabunny@1.60.0/dist/bundles/mediabunny.min.mjs
curl -sfo mediabunny-mp3-encoder.mjs https://cdn.jsdelivr.net/npm/@mediabunny/mp3-encoder@1.60.0/dist/bundles/mediabunny-mp3-encoder.min.mjs
curl -sfo mediabunny-aac-encoder.mjs https://cdn.jsdelivr.net/npm/@mediabunny/aac-encoder@1.60.0/dist/bundles/mediabunny-aac-encoder.min.mjs
curl -sfo LICENSE https://cdn.jsdelivr.net/npm/mediabunny@1.60.0/LICENSE
# Las extensiones importan «mediabunny» por nombre: que usen ESTA copia (M6)
sed -i -E "s#from ?[\"']mediabunny[\"']#from \"./mediabunny.min.mjs\"#g" mediabunny-mp3-encoder.mjs mediabunny-aac-encoder.mjs
grep -o 'from *"[^"]*mediabunny[^"]*"' mediabunny-mp3-encoder.mjs mediabunny-aac-encoder.mjs | sort -u
cd ../../..
ls -l js/vendor/mediabunny
```
  Esperado del `grep`: solo `from "./mediabunny.min.mjs"` en los dos archivos. Si sale `from "mediabunny"`,
  el MP3 fallará con «codec not supported».

- [x] **Paso 2: archivos de prueba con FFmpeg** (voces de 1, 2 y 3 s a 24 kHz; video tipo X de 20 s en
  H.264 + AAC):

```bash
mkdir -p tests/fixtures/biblioteca && cd tests/fixtures/biblioteca
for s in 1 2 3; do ffmpeg -hide_banner -loglevel error -y -f lavfi -i "sine=frequency=$((300+s*100)):sample_rate=24000:duration=$s" -ac 1 -c:a libmp3lame -b:a 48k voz_${s}s.mp3; done
ffmpeg -hide_banner -loglevel error -y -f lavfi -i color=c=0x335577:size=160x90:rate=10 -f lavfi -i "sine=frequency=220:sample_rate=48000" -t 20 -c:v libx264 -pix_fmt yuv420p -profile:v baseline -c:a aac -b:a 64k -ac 2 -movflags +faststart video_x_20s.mp4
cd ../../..
ls -l tests/fixtures/biblioteca
```
  Esperado: `voz_1s.mp3` ~6,5 KB, `voz_2s.mp3` ~12,6 KB, `voz_3s.mp3` ~18,5 KB, `video_x_20s.mp4`
  ~170 KB (**la prueba comprueba el tamaño exacto del MP4**: si tu FFmpeg lo genera distinto, cambia el
  número `172447` de la prueba por el `ls -l` que obtengas, y dilo en tu informe).

  Y en `.gitignore`, justo después de `!audio/musica/*.mp3`, añade (sin esto los MP3 de prueba no se
  suben; ya pasó con el video de X):
  ```
  !tests/fixtures/biblioteca/*.mp3
  ```

- [x] **Paso 3: escribir la prueba** — crear `tests/verificar_biblioteca_datos.mjs`:

```js
/* JG Turbo · Biblioteca de videos: guardado v2 y descargas, en un navegador real.
 *
 * Sin la interfaz: importa los módulos en una página en blanco del mismo
 * servidor y los ejercita. Migración v1 → v2 con datos de verdad, «lo
 * automático nunca pisa lo que organizó la persona», quitar + deshacer, el
 * tope de las voces guardadas, y los tres archivos (MP3 doblado, MP4 de X
 * doblado, MP4 original) con voces y video de prueba hechos con FFmpeg.
 *
 * Corre dos veces: Chromium de Playwright (sin AAC ni H.264: el peor caso, usa
 * la extensión AAC y no puede mezclar el audio original) y Chrome instalado
 * (el caso del dueño). Si Chrome no está, esa pasada se informa OMITIDA.
 *
 *   node tests/verificar_biblioteca_datos.mjs
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

const tipos = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.mp3': 'audio/mpeg', '.mp4': 'video/mp4' };
const servidor = createServer(async (q, r) => {
  try {
    const p = decodeURIComponent(new URL(q.url, 'http://localhost').pathname);
    if (p === '/prueba.html') { r.setHeader('Content-Type', 'text/html'); r.end('<!doctype html><meta charset="utf-8"><title>prueba</title><body></body>'); return; }
    const f = join(app, p);
    const cuerpo = await readFile(f);
    r.setHeader('Content-Type', tipos[extname(f)] || 'application/octet-stream');
    r.setHeader('Accept-Ranges', 'bytes');
    const rango = /bytes=(\d+)-(\d*)/.exec(q.headers.range || '');
    if (rango) {
      const desde = Number(rango[1]);
      const hasta = rango[2] ? Math.min(Number(rango[2]), cuerpo.length - 1) : cuerpo.length - 1;
      r.writeHead(206, { 'Content-Range': `bytes ${desde}-${hasta}/${cuerpo.length}`, 'Content-Length': hasta - desde + 1 });
      r.end(cuerpo.subarray(desde, hasta + 1));
      return;
    }
    r.end(cuerpo);
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

async function pasada(etiqueta, opciones) {
  let navegador;
  try { navegador = await chromium.launch(opciones); } catch (error) {
    console.log(`\n── ${etiqueta}: OMITIDA (${String(error.message).split('\n')[0]})`);
    return;
  }
  console.log(`\n── ${etiqueta} ─────────────────────────────────────────`);
  try {
    const contexto = await navegador.newContext({ acceptDownloads: true });
    const pagina = await contexto.newPage();
    const errores = [];
    pagina.on('pageerror', (e) => errores.push(String(e)));
    await pagina.goto(`${base}/prueba.html`);

    // 1) Base v1 con dos doblajes, como la tiene hoy el dueño
    await pagina.evaluate(() => new Promise((ok, mal) => {
      const pedido = indexedDB.open('jg_youtube', 1);
      pedido.onupgradeneeded = () => pedido.result.createObjectStore('doblajes', { keyPath: 'videoId' });
      pedido.onsuccess = () => {
        const tx = pedido.result.transaction('doblajes', 'readwrite');
        const a = tx.objectStore('doblajes');
        a.put({ videoId: 'dNWkwrqAkcM', titulo: 'The Marketing GENIUS', duracionS: 5314, idiomaOrigen: 'en', posicionS: 900, segmentos: [{ startTime: 0, endTime: 2, text: 'Hello' }], traducciones: [[0, 'Hola']], actualizado: Date.UTC(2026, 8, 20) });
        a.put({ videoId: 'x:1349794411333394432', titulo: '@BrooklynNets · WATCH', duracionS: 324, idiomaOrigen: 'en', posicionS: 0, segmentos: [], traducciones: [], actualizado: Date.UTC(2026, 8, 27) });
        tx.oncomplete = () => { pedido.result.close(); ok(); };
        tx.onerror = () => mal(tx.error);
      };
    }));

    const r = await pagina.evaluate(async () => {
      const cd = await import('/js/youtube/cacheDoblaje.js');
      const salida = {};
      const videos = await cd.listarVideos();
      salida.migrados = videos.map((v) => `${v.clave}|${v.plataforma}|${v.estado}|${v.portada ? 'con' : 'sin'}`).sort();
      salida.doblajeIntacto = (await cd.leerDoblaje('dNWkwrqAkcM'))?.traducciones?.[0]?.[1];
      await cd.actualizarVideo('dNWkwrqAkcM', { etiquetas: ['Negocio'], favorito: true });
      const auto = await cd.registrarVideo({ clave: 'dNWkwrqAkcM', titulo: 'Título nuevo', posicionS: 5300, duracionS: 5314 });
      salida.organizadoIntacto = auto.etiquetas.join() === 'Negocio' && auto.favorito === true && auto.estado === 'visto' && auto.titulo === 'Título nuevo';
      // El guardado automático (cada 5 s) y una edición de la persona al mismo tiempo
      await Promise.all([
        cd.registrarVideo({ clave: 'x:1349794411333394432', posicionS: 100, duracionS: 324 }),
        cd.actualizarVideo('x:1349794411333394432', { etiquetas: ['Deportes'] }),
        cd.registrarVideo({ clave: 'x:1349794411333394432', posicionS: 105, duracionS: 324 }),
      ]);
      const carrera = await cd.leerVideo('x:1349794411333394432');
      salida.carrera = `${carrera.etiquetas.join()}|${carrera.posicionS}`;
      await cd.guardarVoz('dNWkwrqAkcM|v|a', 'dNWkwrqAkcM', new Blob([new Uint8Array(1000)], { type: 'audio/mpeg' }), 'azure-neural-regional');
      const leida = await cd.leerVoz('dNWkwrqAkcM|v|a'); salida.vozGuardada = `${leida?.blob?.size}|${leida?.motor}`;
      const copia = await cd.quitarVideo('dNWkwrqAkcM');
      salida.quitado = !(await cd.leerVideo('dNWkwrqAkcM')) && !(await cd.leerDoblaje('dNWkwrqAkcM')) && !(await cd.leerVoz('dNWkwrqAkcM|v|a'));
      salida.restaurado = await cd.restaurarVideo(copia) && (await cd.leerVideo('dNWkwrqAkcM'))?.etiquetas?.join() === 'Negocio' && Boolean((await cd.leerDoblaje('dNWkwrqAkcM'))?.segmentos?.length);
      for (let i = 0; i < 5; i += 1) await cd.guardarVoz(`k${i}`, 'x:1349794411333394432', new Blob([new Uint8Array(400)]));
      salida.conVoz = [...(await cd.videosConVoz())].join();
      salida.podadas = await cd.podarVoces(1000);
      salida.vocesQueQuedan = (await Promise.all([0, 1, 2, 3, 4].map((i) => cd.leerVoz(`k${i}`)))).filter(Boolean).length;
      salida.masDeVeinte = await (async () => {
        for (let i = 0; i < 25; i += 1) await cd.guardarDoblaje({ videoId: `v${i}`, segmentos: [], traducciones: [] });
        return (await cd.listarDoblajes()).length;
      })();
      return salida;
    });
    comprobar(`[${etiqueta}] migración v1→v2: los 2 doblajes entran a la biblioteca con su plataforma`, r.migrados.join() === 'dNWkwrqAkcM|youtube|viendo|con,x:1349794411333394432|x|nuevo|sin', r.migrados.join());
    comprobar(`[${etiqueta}] la migración no toca el doblaje guardado`, r.doblajeIntacto === 'Hola');
    comprobar(`[${etiqueta}] lo automático no pisa etiquetas ni favorito`, r.organizadoIntacto);
    comprobar(`[${etiqueta}] guardado automático y edición a la vez: no se pierde la etiqueta`, r.carrera === 'Deportes|105', r.carrera);
    comprobar(`[${etiqueta}] la voz guardada se lee igual, con su motor`, r.vozGuardada === '1000|azure-neural-regional', r.vozGuardada);
    comprobar(`[${etiqueta}] quitar borra ficha, doblaje y voces`, r.quitado);
    comprobar(`[${etiqueta}] deshacer devuelve ficha (con etiquetas) y doblaje`, r.restaurado);
    comprobar(`[${etiqueta}] se sabe qué videos tienen voz guardada (sin leer los audios)`, r.conVoz === 'x:1349794411333394432', r.conVoz);
    comprobar(`[${etiqueta}] las voces pasan de presupuesto → salen las menos usadas`, r.podadas === 3 && r.vocesQueQuedan === 2, `${r.podadas} / ${r.vocesQueQuedan}`);
    comprobar(`[${etiqueta}] ya no se poda en silencio el video 21`, r.masDeVeinte >= 26, String(r.masDeVeinte));

    // 2) Archivos
    const a = await pagina.evaluate(async () => {
      const ex = await import('/js/youtube/exportadorDoblaje.js');
      const voz = {};
      for (const s of [1, 2, 3]) voz[s] = await (await fetch(`/tests/fixtures/biblioteca/voz_${s}s.mp3`)).blob();
      const pedidas = [];
      // La frase 1 dura 3 s y solo tiene 2,2 s: se vuelve a pedir acelerada (aquí, el MP3 de 2 s).
      const sintetizar = async (texto, { tasa }) => { pedidas.push(`${texto}@${tasa}`); return tasa > 1 ? voz[2] : voz[texto === 'larga' ? 3 : 1]; };
      const frases = [
        { indice: 0, startTime: 0.5, texto: 'corta' },
        { indice: 1, startTime: 3, texto: 'larga' },
        { indice: 2, startTime: 5.2, texto: 'corta' },
        { indice: 3, startTime: 8, texto: '' },
      ];
      const memoria = () => {
        let ultimo = null;
        return { tipo: 'memoria', crearTarget: (mb) => new mb.BufferTarget(), terminar: async (o) => { ultimo = o.target.buffer; }, recibirFlujo: async (f) => { ultimo = await new Response(f).arrayBuffer(); }, get buffer() { return ultimo; } };
      };
      const salida = {};
      const t0 = performance.now();
      const d1 = memoria();
      const mp3 = await ex.exportarMp3({ frases, duracionVideoS: 12, sintetizar, destino: d1 });
      const decod = await ex.decodificarAudio(new Blob([d1.buffer]));
      salida.mp3 = { ...mp3, ms: Math.round(performance.now() - t0), duracion: Math.round(decod.duration * 10) / 10, kb: Math.round(d1.buffer.byteLength / 1024), pedidas };
      // ¿La voz suena en su segundo? Energía en 0,5–1,5 s y silencio en 1,6–2,9 s
      const datos = decod.getChannelData(0);
      const energia = (a, b) => { let s = 0; for (let i = Math.floor(a * decod.sampleRate); i < Math.floor(b * decod.sampleRate); i += 1) s += datos[i] * datos[i]; return s / ((b - a) * decod.sampleRate); };
      salida.mp3.enSuSegundo = energia(0.6, 1.4) > 0.002 && energia(1.7, 2.8) < 0.0005;

      const t1 = performance.now();
      const d2 = memoria();
      const progreso = [];
      const mp4 = await ex.exportarMp4DobladoX({ mp4Url: '/tests/fixtures/biblioteca/video_x_20s.mp4', frases, sintetizar, destino: d2, onProgreso: (p) => progreso.push(p.fase) });
      const mb = await import('/js/vendor/mediabunny/mediabunny.min.mjs');
      const leido = new mb.Input({ source: new mb.BufferSource(d2.buffer), formats: mb.ALL_FORMATS });
      salida.mp4 = { ...mp4, ms: Math.round(performance.now() - t1), kb: Math.round(d2.buffer.byteLength / 1024),
        duracion: Math.round((await leido.computeDuration()) * 10) / 10,
        video: (await leido.getPrimaryVideoTrack())?.codec, audio: (await leido.getPrimaryAudioTrack())?.codec,
        fases: [...new Set(progreso)].join(',') };

      const d3 = memoria();
      const original = await ex.descargarOriginalX({ mp4Url: '/tests/fixtures/biblioteca/video_x_20s.mp4', destino: d3 });
      salida.original = { bytes: original.bytes, iguales: d3.buffer.byteLength === original.bytes };

      // Cancelar a mitad corta con AbortError y no deja el archivo a medias
      const control = new AbortController();
      const lenta = async (texto, o) => { await new Promise((r) => setTimeout(r, 200)); return sintetizar(texto, o); };
      setTimeout(() => control.abort(), 50);
      try { await ex.exportarMp3({ frases, duracionVideoS: 12, sintetizar: lenta, destino: memoria(), signal: control.signal }); salida.cancelar = 'no cortó'; }
      catch (e) { salida.cancelar = e.name; }
      return salida;
    });
    comprobar(`[${etiqueta}] MP3: dura lo que el video (12 s)`, Math.abs(a.mp3.duracion - 12) <= 0.2, `${a.mp3.duracion} s`);
    comprobar(`[${etiqueta}] MP3: la frase que no cabía se pidió acelerada (1,25×)`, a.mp3.aceleradas === 1 && a.mp3.pedidas.includes('larga@1.25'), a.mp3.pedidas.join(' '));
    comprobar(`[${etiqueta}] MP3: la voz suena en su segundo y hay silencio entre frases`, a.mp3.enSuSegundo);
    comprobar(`[${etiqueta}] MP3: una frase sin texto no se pide`, !a.mp3.pedidas.some((p) => p.startsWith('@')));
    comprobar(`[${etiqueta}] MP4 de X doblado: video copiado (avc) + audio aac, 20 s`, a.mp4.video === 'avc' && a.mp4.audio === 'aac' && Math.abs(a.mp4.duracion - 20) <= 0.3, JSON.stringify(a.mp4));
    comprobar(`[${etiqueta}] MP4: el progreso pasa por voz y archivo`, a.mp4.fases.includes('voz') && a.mp4.fases.includes('archivo'), a.mp4.fases);
    comprobar(`[${etiqueta}] MP4 original de X: llega entero`, a.original.iguales && a.original.bytes === 172447, JSON.stringify(a.original));
    comprobar(`[${etiqueta}] cancelar a mitad corta con AbortError`, a.cancelar === 'AbortError', a.cancelar);
    comprobar(`[${etiqueta}] sin errores de JavaScript`, errores.length === 0, errores.join(' | '));
    console.log(`   medidas: MP3 ${a.mp3.ms} ms · MP4 ${a.mp4.ms} ms (${a.mp4.kb} KB) · audio original mezclado: ${a.mp4.conOriginal ? 'sí' : 'no (este navegador no decodifica AAC)'}`);
    await contexto.close();
  } finally {
    await navegador.close();
  }
}

try {
  await pasada('Chromium de Playwright (sin códecs propietarios)', {});
  await pasada('Chrome instalado', { channel: 'chrome' });
} finally {
  servidor.close();
}
console.log(`\n${ok} comprobaciones OK · ${fallos.length} fallos`);
if (fallos.length) { console.log(fallos.map((f) => `   · ${f}`).join('\n')); process.exit(1); }
```

- [x] **Paso 4: ejecutar y ver que falla** — `node tests/verificar_biblioteca_datos.mjs` → falla la
  migración (la v1 no tiene `listarVideos`).

- [x] **Paso 5: implementar.** `js/youtube/cacheDoblaje.js` (reemplaza el archivo entero):

```js
/**
 * Base IndexedDB `jg_youtube`: el doblaje de cada video y la biblioteca.
 *
 * Tres almacenes, separados a propósito (igual que la biblioteca de PDF):
 *  - `doblajes` (v1): lo pesado que costó conseguir (texto con tiempos, traducciones, posición).
 *  - `videos`   (v2): la ficha liviana de la biblioteca. Pintar la biblioteca solo lee esto.
 *  - `voces`    (v2): la voz en español ya generada, frase por frase. Es lo ÚNICO que se
 *    descarta solo (se puede regenerar): tope `PRESUPUESTO_VOCES_BYTES`, sale lo menos usado.
 *
 * Desde v2 no se poda nada que la persona organizó: antes `podar()` borraba en
 * silencio el video 21 y siguientes. La versión de la base solo sube (TRAMPAS
 * §7.2) y la migración es aditiva: crea lo que falta y copia, nunca borra. Todo
 * falla hacia «no hay caché»: en modo privado la app funciona igual.
 */
import { entradaDesdeDoblaje, fusionarEntrada } from './bibliotecaVideos.js';

const BASE = 'jg_youtube';
const VERSION = 2;
const DOBLAJES = 'doblajes';
const VIDEOS = 'videos';
const VOCES = 'voces';
export const PRESUPUESTO_VOCES_BYTES = 300 * 1024 * 1024;

function abrir() {
  return new Promise((resolver, rechazar) => {
    if (!globalThis.indexedDB) { rechazar(new Error('Sin IndexedDB')); return; }
    const pedido = indexedDB.open(BASE, VERSION);
    pedido.onupgradeneeded = (evento) => {
      const db = pedido.result;
      const tx = pedido.transaction;
      if (!db.objectStoreNames.contains(DOBLAJES)) db.createObjectStore(DOBLAJES, { keyPath: 'videoId' });
      if (!db.objectStoreNames.contains(VIDEOS)) {
        const videos = db.createObjectStore(VIDEOS, { keyPath: 'clave' });
        videos.createIndex('abierto', 'abierto');
        // v1 → v2: cada doblaje ya guardado entra a la biblioteca con su fecha.
        if (evento.oldVersion >= 1) {
          tx.objectStore(DOBLAJES).openCursor().onsuccess = (e) => {
            const cursor = e.target.result;
            if (!cursor) return;
            if (cursor.value?.videoId) videos.put(entradaDesdeDoblaje(cursor.value));
            cursor.continue();
          };
        }
      }
      if (!db.objectStoreNames.contains(VOCES)) {
        const voces = db.createObjectStore(VOCES, { keyPath: 'clave' });
        voces.createIndex('video', 'video');
        voces.createIndex('usado', 'usado');
      }
    };
    pedido.onsuccess = () => resolver(pedido.result);
    pedido.onerror = () => rechazar(pedido.error);
    pedido.onblocked = () => rechazar(new Error('La base de videos está abierta en otra pestaña con una versión anterior. Cierra las otras pestañas de JG Turbo.'));
  });
}

async function operar(almacenes, modo, trabajo) {
  const db = await abrir();
  try {
    return await new Promise((resolver, rechazar) => {
      const tx = db.transaction(almacenes, modo);
      const nombres = Array.isArray(almacenes) ? almacenes : [almacenes];
      const tiendas = Object.fromEntries(nombres.map((n) => [n, tx.objectStore(n)]));
      const pedido = trabajo(nombres.length === 1 ? tiendas[nombres[0]] : tiendas);
      tx.oncomplete = () => resolver(pedido && 'result' in pedido ? pedido.result : pedido);
      tx.onerror = () => rechazar(tx.error);
      tx.onabort = () => rechazar(tx.error);
    });
  } finally {
    db.close();
  }
}

// ── Doblajes (lo pesado) ─────────────────────────────────────────────────

export async function leerDoblaje(videoId) {
  try { return (await operar(DOBLAJES, 'readonly', (a) => a.get(videoId))) || null; } catch (_) { return null; }
}

export async function guardarDoblaje(registro) {
  try {
    await operar(DOBLAJES, 'readwrite', (a) => a.put({ ...registro, actualizado: Date.now() }));
    return true;
  } catch (_) {
    return false;
  }
}

/** Todos los doblajes, solo para «Buscar también en lo que se dice» (bajo demanda). */
export async function listarDoblajes() {
  try { return (await operar(DOBLAJES, 'readonly', (a) => a.getAll())) || []; } catch (_) { return []; }
}

// ── Biblioteca (la ficha liviana) ────────────────────────────────────────

export async function listarVideos() {
  try { return (await operar(VIDEOS, 'readonly', (a) => a.getAll())) || []; } catch (_) { return []; }
}

export async function leerVideo(clave) {
  try { return (await operar(VIDEOS, 'readonly', (a) => a.get(clave))) || null; } catch (_) { return null; }
}

/**
 * Leer y escribir en la MISMA transacción: el guardado automático corre cada 5 s
 * mientras se ve el video; si leyera antes y escribiera después, pisaría las
 * etiquetas que la persona acaba de editar en ese intervalo.
 */
function leerYEscribir(clave, cambiar) {
  return operar(VIDEOS, 'readwrite', (a) => {
    const salida = { entrada: null };
    a.get(clave).onsuccess = (e) => {
      salida.entrada = cambiar(e.target.result || null);
      if (salida.entrada) a.put(salida.entrada);
    };
    return salida;
  }).then((s) => s.entrada);
}

/** Lo automático (título, duración, posición…): nunca pisa etiquetas ni favorito. */
export async function registrarVideo(datos) {
  if (!datos?.clave) return null;
  try { return await leerYEscribir(datos.clave, (previa) => fusionarEntrada(previa, datos)); } catch (_) { return null; }
}

/** Lo que decide la persona: `{ etiquetas }`, `{ favorito }`. */
export async function actualizarVideo(clave, cambios) {
  try {
    return await leerYEscribir(clave, (previa) => (previa ? { ...previa, ...cambios, clave, actualizado: Date.now() } : null));
  } catch (_) {
    return null;
  }
}

/**
 * Quita un video de la biblioteca con TODO lo suyo. Devuelve lo borrado para
 * que «Deshacer» lo restaure tal cual (`restaurarVideo`).
 */
export async function quitarVideo(clave) {
  try {
    return await operar([VIDEOS, DOBLAJES, VOCES], 'readwrite', (t) => {
      const copia = { video: null, doblaje: null };
      t[VIDEOS].get(clave).onsuccess = (e) => { copia.video = e.target.result || null; t[VIDEOS].delete(clave); };
      t[DOBLAJES].get(clave).onsuccess = (e) => { copia.doblaje = e.target.result || null; t[DOBLAJES].delete(clave); };
      t[VOCES].index('video').openKeyCursor(IDBKeyRange.only(clave)).onsuccess = (e) => {
        const cursor = e.target.result;
        if (!cursor) return;
        t[VOCES].delete(cursor.primaryKey);
        cursor.continue();
      };
      return copia;
    });
  } catch (_) {
    return null;
  }
}

/** Deshacer: la voz no vuelve (se regenera sola); ficha y doblaje sí, intactos. */
export async function restaurarVideo(copia) {
  if (!copia?.video) return false;
  try {
    await operar([VIDEOS, DOBLAJES], 'readwrite', (t) => {
      t[VIDEOS].put(copia.video);
      if (copia.doblaje) t[DOBLAJES].put(copia.doblaje);
      return null;
    });
    return true;
  } catch (_) {
    return false;
  }
}

// ── Voces (se regeneran: lo único que se descarta solo) ──────────────────

/** `{ blob, motor }` o null. El motor importa: la duración de Fish se mide a otro ritmo de bytes. */
export async function leerVoz(clave) {
  try {
    const registro = await operar(VOCES, 'readonly', (a) => a.get(clave));
    if (!registro?.blob) return null;
    operar(VOCES, 'readwrite', (a) => a.put({ ...registro, usado: Date.now() })).catch(() => {});
    return { blob: registro.blob, motor: registro.motor || '' };
  } catch (_) {
    return null;
  }
}

export async function guardarVoz(clave, video, blob, motor = '') {
  if (!(blob?.size > 0)) return false;
  try {
    await operar(VOCES, 'readwrite', (a) => a.put({ clave, video, blob, motor, bytes: blob.size, usado: Date.now() }));
    return true;
  } catch (_) {
    return false;
  }
}

/** Claves de los videos que tienen voz guardada (distintivo «Listo al instante»). Solo lee el índice. */
export async function videosConVoz() {
  try {
    return await operar(VOCES, 'readonly', (a) => {
      const claves = new Set();
      a.index('video').openKeyCursor(null, 'nextunique').onsuccess = (e) => {
        const cursor = e.target.result;
        if (!cursor) return;
        claves.add(cursor.key);
        cursor.continue();
      };
      return claves;
    });
  } catch (_) {
    return new Set();
  }
}

/** Si la voz guardada pasa del presupuesto, salen las frases menos usadas. */
export async function podarVoces(presupuesto = PRESUPUESTO_VOCES_BYTES) {
  try {
    const todas = (await operar(VOCES, 'readonly', (a) => a.getAll())) || [];
    let total = todas.reduce((s, v) => s + (v.bytes || 0), 0);
    if (total <= presupuesto) return 0;
    const sobran = [];
    for (const voz of todas.sort((a, b) => (a.usado || 0) - (b.usado || 0))) {
      if (total <= presupuesto * 0.9) break;
      sobran.push(voz.clave);
      total -= voz.bytes || 0;
    }
    await operar(VOCES, 'readwrite', (a) => { sobran.forEach((c) => a.delete(c)); return null; });
    return sobran.length;
  } catch (_) {
    return 0;
  }
}

/** Espacio usado por la app en este navegador y si el navegador prometió no borrarlo. */
export async function espacioYPersistencia() {
  try {
    const [estimado, persistente] = await Promise.all([
      navigator.storage?.estimate?.(),
      navigator.storage?.persisted?.(),
    ]);
    return { usado: estimado?.usage || 0, cuota: estimado?.quota || 0, persistente: Boolean(persistente) };
  } catch (_) {
    return { usado: 0, cuota: 0, persistente: false };
  }
}

/** Se pide al guardar el primer video: sin esto iOS borra la biblioteca tras días sin uso. */
export async function pedirPersistencia() {
  try {
    if (await navigator.storage?.persisted?.()) return true;
    return Boolean(await navigator.storage?.persist?.());
  } catch (_) {
    return false;
  }
}
```

  `js/youtube/medios.js`:

```js
/**
 * Carga diferida de Mediabunny (js/vendor/mediabunny/, MPL-2.0): solo cuando la
 * persona pide una descarga. Quien solo abre la app no descarga nada de esto
 * (tests/verificar_arranque_ligero.mjs).
 *
 * Las extensiones MP3 y AAC importan «mediabunny» por nombre; al guardarlas en
 * vendor se cambió ese import por './mediabunny.min.mjs'. Tienen que registrar
 * su codificador en la MISMA copia de la librería que usa este módulo: con dos
 * copias, el registro no se ve y el MP3 falla con «codec not supported».
 */
export const RUTA_MEDIOS = '/js/vendor/mediabunny/';
let promesa = null;

export function cargarMedios(ruta = RUTA_MEDIOS) {
  if (!promesa) {
    promesa = import(`${ruta}mediabunny.min.mjs`).catch((error) => {
      promesa = null;
      throw new Error(`No se pudo cargar el generador de archivos: ${error?.message || error}`);
    });
  }
  return promesa;
}

/** Ningún navegador codifica MP3 por sí mismo (medido en Chrome 2026-09-28): siempre hace falta la extensión. */
export async function asegurarMp3(mb, ruta = RUTA_MEDIOS) {
  if (await mb.canEncodeAudio('mp3')) return;
  const { registerMp3Encoder } = await import(`${ruta}mediabunny-mp3-encoder.mjs`);
  registerMp3Encoder();
}

/** Chrome codifica AAC; Firefox y Chromium sin códecs no: ahí entra la extensión (≈ 1 MB). */
export async function asegurarAac(mb, ruta = RUTA_MEDIOS) {
  if (await mb.canEncodeAudio('aac')) return;
  const { registerAacEncoder } = await import(`${ruta}mediabunny-aac-encoder.mjs`);
  registerAacEncoder();
}
```

  `js/youtube/exportadorDoblaje.js`:

```js
/**
 * Archivos del doblaje, armados en el navegador con Mediabunny:
 *  - `exportarMp3`: la voz en español del video entero, cada frase en su segundo.
 *  - `exportarMp4DobladoX`: el video de X con la voz en español y el audio original bajito.
 *  - `descargarOriginalX`: el MP4 original de X, sin tocarlo.
 *
 * Nada de esto cabe en el servidor (60 s y ~4,5 MB por petición). Medido en
 * Chrome el 2026-09-28: 30 s de un video de X a 360p con la pista mezclada se
 * generan en 1,07 s; 60 s de MP3 se codifican en 0,44 s. Lo lento es pedir la
 * voz de cada frase, no armar el archivo.
 *
 * La mezcla se hace por ventanas de 30 s (`ventanasDeMezcla`): nunca hay más de
 * 30 s de audio sin comprimir en memoria, aunque el video dure una hora.
 */
import { planearPista, ventanasDeMezcla, frasesEnVentana } from './pistaDoblada.js';
import { cargarMedios, asegurarMp3, asegurarAac, RUTA_MEDIOS } from './medios.js';

export const HZ_MP3 = 24000;          // la voz neural llega a 24 kHz: más no suma calidad
export const HZ_MP4 = 48000;
export const VOLUMEN_ORIGINAL = 0.12; // el mismo 12 % con que arranca el doblaje en vivo
export const PARALELO_VOZ = 3;        // medido: 6 frases en 2,9 s con 3 en paralelo

const cancelado = () => new DOMException('Cancelado', 'AbortError');

async function enParalelo(elementos, limite, trabajo, signal) {
  let siguiente = 0;
  let fallo = null;
  const trabajadores = Array.from({ length: Math.min(limite, elementos.length) }, async () => {
    while (!fallo && siguiente < elementos.length) {
      if (signal?.aborted) { fallo = fallo || cancelado(); return; }
      const i = siguiente;
      siguiente += 1;
      try { await trabajo(elementos[i], i); } catch (error) { fallo = fallo || error; }
    }
  });
  await Promise.all(trabajadores);
  if (fallo) throw fallo;
}

/** Decodifica un audio (MP3 de la voz) sin abrir un AudioContext de reproducción. */
export async function decodificarAudio(blob) {
  const ctx = new OfflineAudioContext(1, 1, 44100);
  return ctx.decodeAudioData(await blob.arrayBuffer());
}

/**
 * Pide la voz de cada frase, la mide y la vuelve a pedir más rápida donde no cabe.
 * `frases`: [{ indice, startTime, texto, hablante }] (texto '' = sin voz, suena el original).
 * `sintetizar(texto, { tasa, signal, frase })` → Blob MP3 (la caché de voces va por
 * fuera; `frase.hablante` elige la 2.ª voz en los diálogos, como en vivo).
 */
export async function prepararVoces(frases, {
  sintetizar, decodificar = decodificarAudio, duracionVideoS = Infinity, signal = null, onProgreso = () => {},
}) {
  const conTexto = (frases || []).filter((f) => String(f.texto || '').trim());
  const audios = new Map();
  const pedir = async (frase, tasa) => decodificar(await sintetizar(frase.texto, { tasa, signal, frase }));
  let hechas = 0;
  await enParalelo(conTexto, PARALELO_VOZ, async (frase) => {
    audios.set(frase.indice, { buffer: await pedir(frase, 1), tasa: 1 });
    hechas += 1;
    onProgreso({ fase: 'voz', hechas, total: conTexto.length });
  }, signal);

  const medir = (acelerar) => planearPista(conTexto.map((f) => ({
    indice: f.indice, startTime: f.startTime,
    duracionVoz: audios.get(f.indice).buffer.duration, tasa: audios.get(f.indice).tasa,
  })), { duracionVideoS, acelerar });

  const aAcelerar = medir(true).plan.filter((p) => p.tasa > 1);
  let ajustadas = 0;
  await enParalelo(aAcelerar, PARALELO_VOZ, async (p) => {
    const frase = conTexto.find((f) => f.indice === p.indice);
    audios.set(p.indice, { buffer: await pedir(frase, p.tasa), tasa: p.tasa });
    ajustadas += 1;
    onProgreso({ fase: 'ajuste', hechas: ajustadas, total: aAcelerar.length });
  }, signal);

  return { audios, aceleradas: aAcelerar.length, ...medir(false) };
}

/** Una ventana de la pista: voz en su segundo + (opcional) el original bajito. */
export async function mezclarVentana({ desdeS, hastaS }, {
  plan, audios, hz, canales, original = null, volumenOriginal = VOLUMEN_ORIGINAL,
}) {
  const ctx = new OfflineAudioContext(canales, Math.max(1, Math.round((hastaS - desdeS) * hz)), hz);
  const colocar = (buffer, instanteS, destino) => {
    const fuente = ctx.createBufferSource();
    fuente.buffer = buffer;
    fuente.connect(destino);
    const t = instanteS - desdeS;
    if (t >= 0) fuente.start(t); else fuente.start(0, -t);
  };
  if (original) {
    const ganancia = ctx.createGain();
    ganancia.gain.value = volumenOriginal;
    ganancia.connect(ctx.destination);
    for await (const { buffer, timestamp } of original.buffers(desdeS, hastaS)) colocar(buffer, timestamp, ganancia);
  }
  for (const frase of frasesEnVentana(plan, desdeS, hastaS)) colocar(audios.get(frase.indice).buffer, frase.inicioS, ctx.destination);
  return ctx.startRendering();
}

/**
 * `destino` (de `crearDestino`): { tipo: 'disco'|'memoria', crearTarget(mb), terminar(output) }.
 * Devuelve el resumen para el aviso final: frases, aceleradas, corridas.
 */
export async function exportarMp3({
  frases, duracionVideoS, sintetizar, destino, signal = null, onProgreso = () => {}, rutaMedios = RUTA_MEDIOS,
}) {
  const mb = await cargarMedios(rutaMedios);
  await asegurarMp3(mb, rutaMedios);
  const voces = await prepararVoces(frases, { sintetizar, duracionVideoS, signal, onProgreso });
  const output = new mb.Output({ format: new mb.Mp3OutputFormat(), target: destino.crearTarget(mb) });
  const fuente = new mb.AudioBufferSource({ codec: 'mp3', bitrate: 64e3 });
  output.addAudioTrack(fuente);
  await output.start();
  try {
    const ventanas = ventanasDeMezcla(voces.duracionS);
    for (let i = 0; i < ventanas.length; i += 1) {
      if (signal?.aborted) throw cancelado();
      await fuente.add(await mezclarVentana(ventanas[i], { plan: voces.plan, audios: voces.audios, hz: HZ_MP3, canales: 1 }));
      onProgreso({ fase: 'archivo', hechas: i + 1, total: ventanas.length });
    }
    fuente.close();
    await output.finalize();
  } catch (error) {
    await output.cancel().catch(() => {});
    throw error;
  }
  await destino.terminar(output);
  return { frases: voces.plan.length, aceleradas: voces.aceleradas, corridas: voces.corridas };
}

/** El video de X con la voz en español. El video se copia tal cual (no se recodifica). */
export async function exportarMp4DobladoX({
  mp4Url, frases, sintetizar, destino, signal = null, onProgreso = () => {},
  volumenOriginal = VOLUMEN_ORIGINAL, rutaMedios = RUTA_MEDIOS,
}) {
  const mb = await cargarMedios(rutaMedios);
  await asegurarAac(mb, rutaMedios);
  // X responde 403 a peticiones con Referer de otro dominio (TRAMPAS.md): Mediabunny pide por rangos con esto.
  const input = new mb.Input({
    source: new mb.UrlSource(mp4Url, { requestInit: { referrerPolicy: 'no-referrer', credentials: 'omit' } }),
    formats: mb.ALL_FORMATS,
  });
  let output = null;
  try {
    const duracionVideoS = await input.computeDuration();
    const voces = await prepararVoces(frases, { sintetizar, duracionVideoS, signal, onProgreso });
    const pistaOriginal = await input.getPrimaryAudioTrack();
    const original = pistaOriginal && await pistaOriginal.canDecode() ? new mb.AudioBufferSink(pistaOriginal) : null;
    const hz = pistaOriginal?.sampleRate || HZ_MP4;
    output = new mb.Output({
      // Al disco, el índice va al final (se escribe por posiciones); en memoria, al principio.
      format: new mb.Mp4OutputFormat({ fastStart: destino.tipo === 'disco' ? false : 'in-memory' }),
      target: destino.crearTarget(mb),
    });
    const conversion = await mb.Conversion.init({ input, output, audio: { discard: true }, composable: true });
    const fuente = new mb.AudioBufferSource({ codec: 'aac', bitrate: 128e3 });
    output.addAudioTrack(fuente);
    await output.start();
    const alimentar = async () => {
      const ventanas = ventanasDeMezcla(Math.max(duracionVideoS, voces.duracionS));
      for (let i = 0; i < ventanas.length; i += 1) {
        if (signal?.aborted) throw cancelado();
        await fuente.add(await mezclarVentana(ventanas[i], {
          plan: voces.plan, audios: voces.audios, hz, canales: 2, original, volumenOriginal,
        }));
        onProgreso({ fase: 'archivo', hechas: i + 1, total: ventanas.length });
      }
      fuente.close();
    };
    await Promise.all([conversion.execute(), alimentar()]);
    await output.finalize();
    await destino.terminar(output);
    return {
      frases: voces.plan.length, aceleradas: voces.aceleradas, corridas: voces.corridas,
      conOriginal: Boolean(original),
    };
  } catch (error) {
    await output?.cancel().catch(() => {});
    throw error;
  } finally {
    input.dispose?.();
  }
}

/** El MP4 original de X, de un tirón: al disco en escritorio, en memoria en el celular. */
export async function descargarOriginalX({ mp4Url, destino, signal = null, onProgreso = () => {} }) {
  const respuesta = await fetch(mp4Url, { referrerPolicy: 'no-referrer', credentials: 'omit', signal });
  if (!respuesta.ok || !respuesta.body) throw new Error(`X no entregó el video (HTTP ${respuesta.status}).`);
  const total = Number(respuesta.headers.get('content-length')) || 0;   // cabecera permitida por CORS
  let recibidos = 0;
  const contador = new TransformStream({
    transform(trozo, control) {
      recibidos += trozo.byteLength;
      onProgreso({ fase: 'descarga', hechas: recibidos, total });
      control.enqueue(trozo);
    },
  });
  const flujo = respuesta.body.pipeThrough(contador);
  await destino.recibirFlujo(flujo, { signal });
  return { bytes: recibidos };
}
```

  `js/youtube/destinoArchivo.js`:

```js
/**
 * Adónde va un archivo generado. Regla medida: `showSaveFilePicker` exige el
 * gesto de la persona (activación transitoria de ~5 s en Chrome). Por eso
 * `crearDestino` se llama PRIMERO en el clic de «Descargar», antes de pedir
 * voces o leer el video; si se llama después, el navegador lo rechaza.
 *
 * Cancelar el selector de archivos no es un error: `crearDestino` devuelve null.
 */
import { elegirDestino } from './descargaDestino.js';

const TIPOS = {
  'video/mp4': { description: 'Video MP4', accept: { 'video/mp4': ['.mp4'] } },
  'audio/mpeg': { description: 'Audio MP3', accept: { 'audio/mpeg': ['.mp3'] } },
};

export class ErrorDestino extends Error {
  constructor(mensaje, codigo, limite = 0) {
    super(mensaje);
    this.name = 'ErrorDestino';
    this.codigo = codigo;   // 'grande'
    this.limite = limite;
  }
}

function guardarBlob(blob, nombre) {
  const url = URL.createObjectURL(blob);
  const enlace = document.createElement('a');
  enlace.href = url;
  enlace.download = nombre;
  enlace.style.display = 'none';
  document.body.appendChild(enlace);
  enlace.click();
  enlace.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

export async function crearDestino({ nombre, tipoMime, bytesEstimados = 0, esMovil = false }) {
  const puede = typeof globalThis.showSaveFilePicker === 'function';
  const eleccion = elegirDestino({ puedeGuardarEnDisco: puede, esMovil, bytesEstimados });
  if (eleccion.tipo === 'grande') {
    throw new ErrorDestino('Este archivo es demasiado grande para armarlo en este equipo.', 'grande', eleccion.limite);
  }
  if (eleccion.tipo === 'disco') {
    let manejador;
    try {
      manejador = await globalThis.showSaveFilePicker({ suggestedName: nombre, types: [TIPOS[tipoMime]].filter(Boolean) });
    } catch (error) {
      if (error?.name === 'AbortError') return null;   // la persona cerró el selector
      throw error;
    }
    const escritura = await manejador.createWritable();
    return {
      tipo: 'disco',
      crearTarget: (mb) => new mb.StreamTarget(escritura, { chunked: true }),
      terminar: async () => {},   // Mediabunny cierra el archivo al finalizar
      recibirFlujo: (flujo, { signal } = {}) => flujo.pipeTo(escritura, { signal }),
      cancelar: () => escritura.abort?.().catch(() => {}),
    };
  }
  return {
    tipo: 'memoria',
    crearTarget: (mb) => new mb.BufferTarget(),
    terminar: async (output) => guardarBlob(new Blob([output.target.buffer], { type: tipoMime }), nombre),
    recibirFlujo: async (flujo) => guardarBlob(await new Response(flujo).blob(), nombre),
    cancelar: () => {},
  };
}
```

- [x] **Paso 6: ejecutar** — `node tests/verificar_biblioteca_datos.mjs` → **`38 comprobaciones OK · 0 fallos`**
  (19 en Chromium de Playwright + 19 en Chrome; si Chrome no está instalado, la segunda pasada sale
  OMITIDA y quedan 19: dilo en tu informe). Imprime también las medidas (validación: MP3 ~110–190 ms, MP4
  ~1 s, «audio original mezclado: sí»).
- [x] **Paso 7: regresión** — `node tests/verificar_youtube_doblaje.mjs` y `node tests/verificar_x_doblaje.mjs`:
  mismos números de la línea base (la base sube a v2 y el doblaje no debe notarlo).
- [x] **Paso 8: commit** — `git add js/youtube/cacheDoblaje.js js/youtube/medios.js js/youtube/exportadorDoblaje.js js/youtube/destinoArchivo.js js/vendor/mediabunny tests/fixtures/biblioteca tests/verificar_biblioteca_datos.mjs .gitignore && git commit -m "feat(videos): biblioteca v2 en IndexedDB y archivos doblados con Mediabunny"`

---

### Tarea 3: servidor — `evitar_azure` en `/api/tts`

**Por qué:** Azure F0 permite 20 síntesis por minuto (M8). Un video de 60 min son ~600 frases: a 18 por
minuto, 33 min de espera. Con `evitar_azure` la misma voz neural sale de edge-tts, sin cuota. El doblaje
en vivo no lo manda y sigue igual.

**Archivos:** Modificar `api/index.py` (4 puntos). Crear `backend/tests/test_tts_evitar_azure.py`.

- [x] **Paso 1: escribir la prueba** — crear `backend/tests/test_tts_evitar_azure.py`:

```python
"""Descargas largas de la biblioteca: la voz va por edge-tts, no por Azure F0.

Azure F0 permite 20 síntesis por minuto: un video de 60 min (~600 frases) a 18
por minuto tardaría ~33 min en generarse. Con `evitar_azure` la misma voz
neural (es-CO-SalomeNeural) sale de edge-tts, sin cuota. El doblaje en vivo no
lo manda y sigue igual. Todo con dobles: ninguna prueba sale a la red.
"""

import sys
from pathlib import Path

from fastapi.testclient import TestClient

_APP_ROOT = Path(__file__).resolve().parents[2]
if str(_APP_ROOT) not in sys.path:
    sys.path.insert(0, str(_APP_ROOT))

from api import index as api_module  # noqa: E402


def _cliente(monkeypatch):
    llamadas = []

    async def azure(text, voice_id, rate, pitch, tone):
        llamadas.append(("azure", voice_id))
        return b"ID3azure", ""

    async def edge(text, voice_id, rate, pitch, volume):
        llamadas.append(("edge", voice_id))
        return b"ID3edge"

    monkeypatch.setattr(api_module, "_tts_azure_activo", lambda: True)
    monkeypatch.setattr(api_module, "_tts_azure_synthesize", azure)
    monkeypatch.setattr(api_module, "_tts_edge_synthesize", edge)
    return TestClient(api_module.app), llamadas


CUERPO = {"text": "Hola a todos.", "voice": "female", "language": "es", "locale": "es-CO", "idioma_fijo": True}


def test_sin_evitar_azure_la_cadena_sigue_igual(monkeypatch):
    cliente, llamadas = _cliente(monkeypatch)
    r = cliente.post("/api/tts", json=CUERPO)
    assert r.status_code == 200
    assert llamadas == [("azure", "es-CO-SalomeNeural")]
    assert r.headers["X-TTS-Engine"].startswith("azure")


def test_con_evitar_azure_va_directo_a_edge_con_la_misma_voz(monkeypatch):
    cliente, llamadas = _cliente(monkeypatch)
    r = cliente.post("/api/tts", json={**CUERPO, "evitar_azure": True})
    assert r.status_code == 200
    assert llamadas == [("edge", "es-CO-SalomeNeural")]
    assert r.headers["X-TTS-Engine"].startswith("edge")
    assert r.headers["X-TTS-Fallback"] == "0"   # no es un respaldo: se pidió así


def test_get_tambien_acepta_evitar_azure(monkeypatch):
    cliente, llamadas = _cliente(monkeypatch)
    r = cliente.get("/api/tts", params={**CUERPO, "idioma_fijo": "true", "evitar_azure": "true"})
    assert r.status_code == 200
    assert llamadas[0][0] == "edge"


def test_evitar_azure_respeta_la_velocidad_pedida(monkeypatch):
    cliente, _ = _cliente(monkeypatch)
    r = cliente.post("/api/tts", json={**CUERPO, "evitar_azure": True, "rate": 1.2})
    assert r.headers["X-TTS-Rate"] == "+20%"
```

- [x] **Paso 2: ejecutar y ver que falla** — `python -m pytest backend/tests/test_tts_evitar_azure.py -q`
  → **2 failed, 2 passed** (sin el cambio, `evitar_azure` se ignora y suena Azure).

- [x] **Paso 3: implementar en `api/index.py`** (cuatro cambios, todos aditivos):

  (a) En `class TtsRequest`, después del campo `idioma_fijo` (≈ línea 4142):
  ```python
      evitar_azure: bool = Field(
          False,
          description=(
              "True = saltar Azure F0 (20 síntesis/min) e ir directo a edge-tts, la misma "
              "voz neural sin cuota. Lo usan las descargas largas de la biblioteca de "
              "videos: ~600 frases a 18 por minuto tardarían ~33 min."
          ),
      )
  ```
  (b) En `async def _tts_synthesize(`, después del parámetro `fin: float | None = None,`:
  ```python
      evitar_azure: bool = False,
  ```
  y la condición de Azure (≈ línea 4824) pasa de `if _tts_azure_activo():` a:
  ```python
      if _tts_azure_activo() and not evitar_azure:
  ```
  (c) En `_tts_render`, dentro de la llamada a `_tts_synthesize(...)`, después de `fin=fin,`:
  ```python
                  evitar_azure=bool(req.evitar_azure),
  ```
  (d) En `@app.get("/api/tts")` (`tts_neural_get`), un parámetro más después de `idioma_fijo: bool = False,`:
  ```python
      evitar_azure: bool = False,
  ```
  y en el `TtsRequest(...)` que arma, después de `idioma_fijo=idioma_fijo,`:
  ```python
              evitar_azure=evitar_azure,
  ```

- [x] **Paso 4: ejecutar** — `python -m pytest backend/tests/test_tts_evitar_azure.py backend/tests/test_tts_idioma_fijo.py backend/tests/test_x_video.py backend/tests/test_supadata_youtube.py backend/tests/test_youtube_idioma_origen.py backend/tests/test_ia_respaldo.py backend/tests/test_api_youtube_bloqueo.py -q`
  → **117 passed** (4 nuevas + las 113 de la línea base).
- [x] **Paso 5: commit** — `git add api/index.py backend/tests/test_tts_evitar_azure.py && git commit -m "feat(tts): evitar_azure para que las descargas largas usen edge-tts sin cuota"`

---

### Tarea 4: medir desde Vercel el ritmo de edge-tts — **puerta de decisión**

**Por qué:** edge-tts es gratis pero no oficial; su latencia en este proyecto fue de 1 a 41 s por bloque
(`AGENTS.md`). Hay que saber cuánto tarda una descarga real antes de prometerle tiempos al dueño.

- [x] **Paso 1: vista previa desde una copia exacta del commit** (nunca desde la raíz: sube basura y
  `.pytest_cache` tumba el CLI):
  ```bash
  TMP="$(mktemp -d)"
  git archive HEAD | tar -x -C "$TMP"
  mkdir -p "$TMP/.vercel" && cp .vercel/project.json "$TMP/.vercel/"
  cd "$TMP" && npx vercel --yes --scope jhoncod24s-projects
  ```
  Anota la URL de vista previa. **Sin `--prod`.** Si la vista previa pide sesión, usa `npx vercel curl`
  (así se hizo en el plan de X) o el navegador del dueño.
- [x] **Paso 2: medir 20 frases con `evitar_azure` y 20 sin él**, 3 en paralelo, desde el navegador de
  la vista previa (consola de DevTools, en la pestaña de la app):
  ```js
  const frases = Array.from({ length: 20 }, (_, i) => `Frase de prueba número ${i + 1}: la inteligencia artificial cambia la forma en que aprendemos.`);
  async function medir(evitar) {
    const t0 = performance.now(); let i = 0; const ms = []; let fallos = 0;
    await Promise.all([0, 1, 2].map(async () => { while (i < frases.length) { const k = i++; const t = performance.now();
      const r = await fetch('/api/tts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: frases[k], voice: 'female', language: 'es', locale: 'es-CO', idioma_fijo: true, evitar_azure: evitar, source: 'yt' }) });
      if (!r.ok) fallos += 1; else { await r.blob(); ms.push(Math.round(performance.now() - t)); } } }));
    ms.sort((a, b) => a - b);
    return { evitar, totalS: Math.round((performance.now() - t0) / 100) / 10, fallos, p50: ms[Math.floor(ms.length / 2)], p95: ms[Math.floor(ms.length * 0.95)] };
  }
  console.table([await medir(true), await medir(false)]);
  ```
- [x] **Paso 3: decidir y anotar** en `CAMBIOS_BIBLIOTECA_VIDEOS.md` (se crea aquí, sección «Medición
  desde Vercel»: fecha, URL, la tabla):

  | Resultado de `evitar: true` | Decisión |
  |---|---|
  | 0 fallos y p95 ≤ 5 s | Seguir. Estimación que la interfaz puede mostrar: `totalS / 20` s por frase con 3 en paralelo. |
  | Fallos ≤ 2 o p95 5–15 s | Seguir. La interfaz **no** muestra tiempo estimado, solo el avance real (frases hechas / total). |
  | Fallos > 2 o p95 > 15 s | **Avisa al dueño antes de seguir.** Propuesta: la descarga larga usa Azure a 18/min (cambia el orden en `sintetizarArchivo`: `[false, true, true]`) y la interfaz avisa «un video de 60 min tarda ~35 min». |

- [x] **Paso 4: commit** — `git add CAMBIOS_BIBLIOTECA_VIDEOS.md && git commit -m "docs(videos): ritmo de edge-tts medido desde Vercel"`

---

## Fase B · Integración

### Tarea 5: servicio de voz, controlador e `index.html`

**Por qué:** es donde la biblioteca se llena sola, donde la voz se guarda y donde nacen las descargas.
Todo con cambios localizados; YouTube y X deben seguir dando sus mismos números.

**Archivos:**
- Modificar: `js/youtube/dubbingService.js` (constructor + `asegurar`)
- Modificar: `js/youtube/youtubeSyncController.js` (imports, parámetro, estado, `guardarSesion`,
  `terminarSesion`, servicio de voz, `abrirSesion`/`completarSesion`, llamadas a `completarSesion`, bloque
  de biblioteca antes del clic del botón)
- Modificar: `index.html` (generador de voz para archivos; texto de la pestaña)
- Modificar: `tests/test_biblioteca_videos.mjs` (la sección que faltaba)

**Interfaces que produce (las consume la vista de la T6):** el controlador monta la vista con
`montarBibliotecaVideos(raiz, deps)`, donde `deps` es exactamente:
`{ listarVideos, listarDoblajes, videosConVoz, actualizarVideo, quitarVideo, restaurarVideo,
espacioYPersistencia, abrir, opcionesDescarga, descargar, servidorEnLinea }` con
- `abrir(video, { segundo }) → { abierto: boolean, motivo: string }` (síncrono),
- `opcionesDescarga(video) → Promise<{ esMovil, puedeGuardarEnDisco, mp3: { bytes }, calidades: [...] }>`
  (`calidades` vacío en YouTube),
- `descargar(video, tipo, { calidad, signal, onProgreso }) → Promise<{ cancelado: true } | resumen>`
  (`tipo`: `'original'|'mp3'|'mp4'`; lanza `ErrorDestino` con `codigo 'grande'` si no cabe),
- `servidorEnLinea() → boolean`,
y espera de vuelta `{ refrescar(): Promise, plegar(plegada: boolean): void }`.

- [x] **Paso 1: la prueba del gancho** — añade a `tests/test_biblioteca_videos.mjs`, antes de «Resumen»,
  la sección «Voz guardada: no gasta el limitador de Azure» (está al final del archivo de la T1, Paso 1).
  `node tests/test_biblioteca_videos.mjs` → falla: `turnos === 2` en vez de 1 (el gancho no existe).

- [x] **Paso 2: `js/youtube/dubbingService.js`.** En el constructor, el parámetro nuevo:
  ```js
    constructor({ generarAudio, onProgress = () => {}, limitador = null, onRespaldo = null, medirDuracion = medirDuracionAudio, buscarGuardada = null }) {
  ```
  y después de `this.medirDuracion = medirDuracion;`:
  ```js
      this.buscarGuardada = buscarGuardada;
  ```
  En `asegurar(indice)`, el comienzo de la promesa (desde `unidad.promesa = (async () => {` hasta la
  línea `const resultado = await this.generarAudio(unidad.text, unidad);` inclusive) queda así:

```js
    unidad.promesa = (async () => {
      try {
        // Voz ya guardada (biblioteca): no gasta turno del limitador de Azure,
        // que existe para no pasar de 20 síntesis/min; sin esto, volver a un
        // video con toda su voz guardada seguiría sonando a 18 frases por minuto.
        const guardada = await Promise.resolve(this.buscarGuardada?.(unidad.text, unidad)).catch(() => null);
        if (!guardada) await this.#cupo();
        // Se pasa la unidad completa: el controlador elige la voz según el
        // hablante (diálogos con 2 voces). Las funciones viejas que solo
        // reciben el texto siguen funcionando: el 2.º argumento se ignora.
        const resultado = guardada || await this.generarAudio(unidad.text, unidad);
```

  `node tests/test_biblioteca_videos.mjs` → **`83 comprobaciones OK · 0 fallos`**.

- [x] **Paso 3: controlador — imports.** Borra la línea `import { DubbingService, agruparPorTiempo } from './dubbingService.js';`
  y reemplaza `import { leerDoblaje, guardarDoblaje } from './cacheDoblaje.js';` por:

```js
import { DubbingService, agruparPorTiempo, textoDeUnidad } from './dubbingService.js';
import {
  leerDoblaje, guardarDoblaje, registrarVideo, leerVoz, guardarVoz, podarVoces, pedirPersistencia,
  listarVideos, listarDoblajes, videosConVoz, actualizarVideo, quitarVideo, restaurarVideo, espacioYPersistencia,
} from './cacheDoblaje.js';
import { claveDeVoz } from './bibliotecaVideos.js';
import { estimarBytesMp3, estimarBytesVideo, opcionesCalidadX, nombreArchivo, BITRATE_AUDIO_DOBLADO } from './descargaDestino.js';
import { crearDestino } from './destinoArchivo.js';
```

- [x] **Paso 4: controlador — parámetro.** En la firma de `inicializarYoutubeSincronizado({ … })`, después
  de `generarAudioEspanol,` añade `generarAudioArchivo = null,`.

- [x] **Paso 5: controlador — estado.** Reemplaza `  let sesion = null;` por:

```js
  let sesion = null;
  // Biblioteca (bibliotecaVista.js): se monta sola si existe #vidBiblioteca.
  let biblioteca = null;
  let abrirEnPendiente = 0;
  let vocesDesdePoda = 0;
  const avisarBiblioteca = () => { Promise.resolve(biblioteca?.refrescar?.()).catch(() => {}); };
  /** La voz guardada tiene tope (300 MB): se revisa cada 50 frases nuevas, no en cada una. */
  const contarVozGuardada = (guardada) => {
    if (!guardada) return;
    vocesDesdePoda += 1;
    if (vocesDesdePoda >= 50) { vocesDesdePoda = 0; podarVoces(); }
  };
```

- [x] **Paso 6: controlador — `guardarSesion`** (reemplaza la función entera):

```js
  /** Guarda traducciones y posición en la caché del video (H23) y el avance en la biblioteca. */
  function guardarSesion(actual) {
    if (!actual?.registro) return;
    actual.registro.traducciones = [...(actual.motor?.traducciones || [])];
    const posicion = actual.player?.getCurrentTime?.() || 0;
    if (posicion > 0) actual.registro.posicionS = posicion;
    guardarDoblaje(actual.registro);
    if (posicion > 0) registrarVideo({ clave: actual.videoId, posicionS: posicion, duracionS: actual.registro.duracionS });
  }
```

- [x] **Paso 7: controlador — `terminarSesion`.** Dentro de `if (restaurarFormulario) {`, antes de
  `ui.area.hidden = true;`, añade:
  ```js
      biblioteca?.plegar?.(false);
      if (actual) avisarBiblioteca();   // el avance y «Listo al instante» cambian al cerrar
  ```

- [x] **Paso 8: controlador — servicio de voz.** En `prepararDoblaje`, reemplaza el bloque
  `const servicioVoz = new DubbingService({ … });` entero por:

```js
    const servicioVoz = new DubbingService({
      // Cada frase suena con su hablante: monólogo = 1 voz, diálogo = 2.
      // La voz ya generada se reutiliza (biblioteca: «Listo al instante») y no
      // gasta turno del limitador de Azure: DubbingService la consulta ANTES.
      buscarGuardada: async (texto, unidad) => {
        const voz = vozParaUnidad(unidad, { vozPrincipal: actual.voz, vozSecundaria: actual.vozSecundaria });
        const guardada = await leerVoz(claveDeVoz(actual.videoId, voz, texto));
        return guardada ? { blob: guardada.blob, engineHdr: guardada.motor } : null;
      },
      generarAudio: async (texto, unidad) => {
        const voz = vozParaUnidad(unidad, { vozPrincipal: actual.voz, vozSecundaria: actual.vozSecundaria });
        const resultado = await generarAudioEspanol(texto, { voz, signal });
        const blob = resultado instanceof Blob ? resultado : resultado?.blob;
        // Un respaldo (sonó otra voz) no se guarda: al volver al video sonaría con otro timbre.
        if (blob?.size && !resultado?.respaldoHdr) {
          guardarVoz(claveDeVoz(actual.videoId, voz, texto), actual.videoId, blob, resultado?.engineHdr || '').then(contarVozGuardada);
        }
        return resultado;
      },
      limitador,
      onRespaldo: () => pasarANeural(actual),
    });
```

- [x] **Paso 9: controlador — `abrirSesion` y `completarSesion`** (reemplaza las dos funciones enteras,
  desde el comentario `/** Lo común al abrir cualquier video (YouTube o X)` hasta el final de
  `completarSesion`):

```js
  /** Lo común al abrir cualquier video (YouTube o X): corta la sesión anterior y prepara la vista. */
  function abrirSesion(videoId) {
    terminarSesion({ restaurarFormulario: false });
    const controlador = new AbortController();
    const actual = { controlador, videoId, abrirEn: abrirEnPendiente };
    abrirEnPendiente = 0;
    sesion = actual;
    marcarOcupado(true);
    ui.area.hidden = false;
    document.querySelector('.yt-area')?.classList.add('has-results', 'modo-doblaje');
    biblioteca?.plegar?.(true);   // mientras se ve un video, la biblioteca no estorba
    progreso.iniciar();
    ui.area.scrollIntoView({ block: 'start', behavior: 'smooth' });
    audiosEntregados = 0;
    desbloquearAudio();
    // La primera síntesis paga el arranque del servicio de voz (2-4 s medidos):
    // se paga ahora, mientras se lee el video, y no cuando la persona espera oírla.
    Promise.resolve().then(() => fetchApi('/tts-warmup', { signal: controlador.signal }, 15000)).catch(() => {});
    return actual;
  }

  /**
   * Lo común con el idioma ya decidido: caché del video, ficha de la biblioteca,
   * «retomar donde ibas» (o el segundo que se buscó) y preparación.
   * `meta`: { autor, portada } de la plataforma, para la tarjeta.
   */
  async function completarSesion(actual, { decision, datos, tituloVideo, duracionS, guardado, sirve, meta = {} }) {
    const { signal } = actual.controlador;
    actual.registro = {
      videoId: actual.videoId,
      idiomaOrigen: decision.idioma,
      titulo: tituloVideo,
      duracionS,
      segmentos: datos.segmentos,
      traducciones: sirve ? guardado.traducciones : [],
      posicionS: sirve ? guardado.posicionS : 0,
    };
    guardarDoblaje(actual.registro);
    registrarVideo({
      clave: actual.videoId, titulo: tituloVideo, duracionS, idiomaOrigen: decision.idioma,
      autor: meta.autor || '', portada: meta.portada || '', posicionS: actual.registro.posicionS, abierto: Date.now(),
    }).then((entrada) => {
      if (!entrada) return;
      pedirPersistencia();   // sin esto iOS borra la biblioteca tras días sin uso
      avisarBiblioteca();
    });
    const abrirEn = Number(actual.abrirEn) || 0;
    if (abrirEn > 0 && abrirEn < duracionS - 1) {
      actual.retomarEn = abrirEn;
      ui.estado.textContent = `Abrimos en ${formatoTiempo(abrirEn)}, donde se dice lo que buscaste.`;
      $('ytDesdeInicio').hidden = false;
    } else if (sirve && 15 < guardado.posicionS && guardado.posicionS < duracionS - 30) {
      actual.retomarEn = guardado.posicionS;
      ui.estado.textContent = `Retomamos donde ibas (${formatoTiempo(actual.retomarEn)}).`;
      $('ytDesdeInicio').hidden = false;
    }
    await prepararDoblaje(actual, {
      datos, origen: decision.idioma, tituloVideo, signal,
      traduccionesGuardadas: actual.registro.traducciones,
    });
    // La voz ya resuelta («auto» → la neural del video): la usan las descargas.
    registrarVideo({ clave: actual.videoId, voz: actual.voz || '' });
  }
```

  Y las **dos** llamadas a `completarSesion` pasan la ficha de la plataforma. En `iniciarSesion`
  (YouTube):
  ```js
        await completarSesion(actual, {
          decision, datos, tituloVideo, duracionS, guardado, sirve,
          meta: { autor: actual.player.getVideoData?.()?.author || '' },
        });
  ```
  En `iniciarSesionX`:
  ```js
        await completarSesion(actual, {
          decision, datos, tituloVideo, duracionS, guardado, sirve,
          meta: { autor: info.autor || '', portada: info.portada || '' },
        });
  ```

- [x] **Paso 10: controlador — biblioteca y descargas.** Justo antes de
  `  ui.boton.addEventListener('click', () => {`, inserta:

```js
  // ── Biblioteca: abrir un video guardado y bajar sus archivos ───────────

  /**
   * Abre un video de la biblioteca por el camino de siempre: la caché hace que
   * no se vuelva a pedir texto ni traducción, y la voz guardada suena al
   * instante. `segundo`: abrir donde se dijo lo que se buscó.
   */
  function abrirDesdeBiblioteca(video, { segundo = 0 } = {}) {
    if (!video?.url) return { abierto: false, motivo: 'Este video no tiene enlace guardado.' };
    if (estaOcupado()) return { abierto: false, motivo: 'Espera a que termine de prepararse el video actual.' };
    if (!estaServidorOnline()) return { abierto: false, motivo: 'Conecta el servidor (indicador de arriba) para abrir el video.' };
    ui.url.value = video.url;
    if (ui.idioma) ui.idioma.value = 'auto';   // con «auto» la caché del video sirve siempre
    ui.url.dispatchEvent(new Event('input'));
    abrirEnPendiente = Number(segundo) || 0;
    iniciarSesion().catch((error) => {
      console.error('[jg-youtube]', error);
      progreso.error('Algo falló al abrir el video. Vuelve a intentarlo.');
    });
    return { abierto: true, motivo: '' };
  }

  const esMovil = () => Boolean(navigator.userAgentData?.mobile ?? /Android|iPhone|iPad|iPod/i.test(navigator.userAgent));

  /** Voz neural de los archivos: la del video si era neural; si era Fish o «auto», la neural de su género. */
  function vozDeArchivo(video, hablante = 0) {
    const guardada = String(video?.voz || '');
    const principal = guardada.startsWith('neural:') ? guardada : `neural:auto:${generoDeVoz(guardada || vozPorDefecto())}`;
    if (hablante !== 1) return principal;
    return `neural:auto:${generoDeVoz(principal) === 'male' ? 'female' : 'male'}`;
  }

  /**
   * Una frase del archivo: primero la voz guardada; si no, edge-tts (sin cuota,
   * `evitarAzure`) dos veces y, al tercer intento, Azure. Se guarda para la próxima.
   */
  async function sintetizarArchivo(video, texto, { tasa = 1, signal = null, frase = null } = {}) {
    if (typeof generarAudioArchivo !== 'function') throw new Error('Falta el generador de voz para archivos.');
    const voz = vozDeArchivo(video, frase?.hablante);
    const clave = claveDeVoz(video.clave, voz, texto, tasa);
    const guardada = await leerVoz(clave);
    if (guardada) return guardada.blob;
    let ultimoError = null;
    for (const evitarAzure of [true, true, false]) {
      if (signal?.aborted) throw cancelado();
      try {
        const blob = await generarAudioArchivo(texto, { voz, tasa, signal, evitarAzure });
        if (blob?.size) {
          guardarVoz(clave, video.clave, blob, evitarAzure ? 'edge' : 'azure').then(contarVozGuardada);
          return blob;
        }
      } catch (error) {
        if (error?.name === 'AbortError' || signal?.aborted) throw cancelado();
        ultimoError = error;
      }
    }
    throw new Error(`No se pudo generar la voz de una frase: ${ultimoError?.message || 'el servicio no respondió'}`);
  }

  /** Frases del video entero, traduciendo solo lo que falte (y guardándolo). */
  async function frasesParaArchivo(video, { signal = null, onProgreso = () => {} } = {}) {
    const registro = await leerDoblaje(video.clave);
    if (!registro?.segmentos?.length) throw new Error('Este video todavía no tiene texto guardado. Ábrelo una vez para doblarlo.');
    const mapa = await traductor.traducirTodo(registro.segmentos, {
      origen: registro.idiomaOrigen, tituloVideo: registro.titulo, signal,
      ya: new Map(registro.traducciones || []),
      onProgress: (hechas, total) => onProgreso({ fase: 'traduccion', hechas, total }),
    });
    registro.traducciones = [...mapa];
    guardarDoblaje(registro);
    return agruparPorTiempo(registro.segmentos).map((unidad) => ({
      indice: unidad.indice, startTime: unidad.startTime, hablante: unidad.hablante,
      texto: textoDeUnidad(unidad, mapa) || '',
    }));
  }

  /** Lo que el diálogo de descargas necesita ANTES del clic (tamaños, calidades). */
  async function opcionesDescarga(video) {
    const movil = esMovil();
    const salida = {
      esMovil: movil,
      puedeGuardarEnDisco: typeof window.showSaveFilePicker === 'function' && !movil,
      mp3: { bytes: estimarBytesMp3(video.duracionS) },
      calidades: [],
    };
    if (video.plataforma === 'x') {
      const info = await servicioX.info(video.url);
      salida.calidades = opcionesCalidadX(info.mp4, Number(info.duracion_s) || video.duracionS);
    }
    return salida;
  }

  /**
   * `tipo`: 'original' (MP4 de X) · 'mp3' (audio doblado) · 'mp4' (video de X doblado).
   * Se llama DIRECTO en el clic: `crearDestino` abre el selector de archivo y el
   * navegador solo lo permite durante el gesto. Cerrar el selector = `{ cancelado: true }`.
   */
  async function descargarDeBiblioteca(video, tipo, { calidad = null, signal = null, onProgreso = () => {} } = {}) {
    const esX = video?.plataforma === 'x';
    if (tipo !== 'mp3' && !esX) throw new Error('De YouTube solo se descarga el audio doblado.');
    if (tipo !== 'mp3' && !calidad?.url) throw new Error('Elige una calidad del video.');
    const bytesEstimados = tipo === 'mp3'
      ? estimarBytesMp3(video.duracionS)
      : calidad.bytes + (tipo === 'mp4' ? estimarBytesVideo(BITRATE_AUDIO_DOBLADO, video.duracionS) : 0);
    const destino = await crearDestino({
      nombre: nombreArchivo({
        titulo: video.titulo, plataforma: video.plataforma,
        tipo: { original: 'original', mp3: 'audio', mp4: 'doblado' }[tipo], extension: tipo === 'mp3' ? 'mp3' : 'mp4',
      }),
      tipoMime: tipo === 'mp3' ? 'audio/mpeg' : 'video/mp4',
      bytesEstimados,
      esMovil: esMovil(),
    });
    if (!destino) return { cancelado: true };
    try {
      const archivos = await import('./exportadorDoblaje.js');
      if (tipo === 'original') return await archivos.descargarOriginalX({ mp4Url: calidad.url, destino, signal, onProgreso });
      const frases = await frasesParaArchivo(video, { signal, onProgreso });
      const sintetizar = (texto, opciones) => sintetizarArchivo(video, texto, opciones);
      if (tipo === 'mp3') {
        return await archivos.exportarMp3({ frases, duracionVideoS: video.duracionS, sintetizar, destino, signal, onProgreso });
      }
      return await archivos.exportarMp4DobladoX({
        mp4Url: calidad.url, frases, sintetizar, destino, signal, onProgreso,
        volumenOriginal: Number(ui.volOriginal.value) / 100,
      });
    } catch (error) {
      await destino.cancelar?.();
      throw error;
    }
  }

  // La vista vive en su propio módulo: se carga solo si el panel trae la sección.
  const raizBiblioteca = $('vidBiblioteca');
  if (raizBiblioteca) {
    import('./bibliotecaVista.js').then(({ montarBibliotecaVideos }) => {
      biblioteca = montarBibliotecaVideos(raizBiblioteca, {
        listarVideos, listarDoblajes, videosConVoz, actualizarVideo, quitarVideo, restaurarVideo, espacioYPersistencia,
        abrir: abrirDesdeBiblioteca, opcionesDescarga, descargar: descargarDeBiblioteca,
        servidorEnLinea: () => Boolean(estaServidorOnline()),
      });
    }).catch((error) => {
      console.error('[jg-biblioteca]', error);
      raizBiblioteca.hidden = true;   // sin biblioteca, el doblaje sigue igual
    });
  }
```

- [x] **Paso 11: `index.html`.** En la llamada a `inicializarYoutubeSincronizado({ … })` (≈ línea 18566),
  justo antes de `      listarVoces: () => ttsVocesParaDoblaje(),`, inserta:

```js
      // Archivos de la biblioteca (MP3 / MP4 doblados): cada frase a la velocidad
      // que pida el plan de la pista (`rate` con prosodia: no cambia el tono) y,
      // por defecto, por edge-tts (`evitar_azure`): la misma voz neural sin la
      // cuota de 20 síntesis/min de Azure F0. Nunca Fish (6-8 s por frase).
      generarAudioArchivo: async (texto, opciones = {}) => {
        const prefs = opciones.voz ? ttsPrefsParaVoz(opciones.voz) : ttsPrefs();
        const resp = await fetchApi('/tts', {
          method: 'POST',
          signal: opciones.signal,
          body: JSON.stringify({
            text: texto,
            voice: prefs.gender === 'male' ? 'male' : 'female',
            language: 'es',
            locale: ttsResolveNeuralLocale(prefs, 'es'),
            rate: Math.min(1.25, Math.max(1, Number(opciones.tasa) || 1)),
            idioma_fijo: true,
            evitar_azure: opciones.evitarAzure !== false,
            source: 'yt',
          }),
        }, 45000);
        if (!resp.ok) {
          const datos = await resp.json().catch(() => ({}));
          throw new Error(typeof datos.detail === 'string' ? datos.detail : `La voz no respondió (HTTP ${resp.status}).`);
        }
        return resp.blob();
      },
```

  Y el texto de la pestaña (≈ línea 6017), solo lo visible:
  `<span class="lbl">YouTube</span>` → `<span class="lbl">Videos</span>` (el `id="tabYt"` no cambia).

- [x] **Paso 12: verificar** (todos contra la línea base; ninguno puede bajar):
  ```bash
  node --check js/youtube/youtubeSyncController.js && node --check js/youtube/dubbingService.js
  node tests/test_biblioteca_videos.mjs | tail -1          # 83
  node tests/test_youtube_doblaje.mjs | tail -1            # 139
  node tests/test_youtube_sincronia.mjs | tail -1          # 65
  node tests/test_x_doblaje.mjs | tail -1                  # 70
  node tests/verificar_youtube_doblaje.mjs | tail -3       # 110
  node tests/verificar_x_doblaje.mjs | tail -3             # 24
  node tests/verificar_biblioteca_datos.mjs | tail -3      # 38
  node tests/verificar_arranque_ligero.mjs | tail -3       # solo el fallo preexistente de 1 MB
  ```
- [x] **Paso 13: commit** — `git add js/youtube/dubbingService.js js/youtube/youtubeSyncController.js index.html tests/test_biblioteca_videos.mjs && git commit -m "feat(videos): el doblaje llena la biblioteca, guarda la voz y ofrece descargas"`

---

## Fase C · Interfaz (con impeccable)

### Tarea 6: la biblioteca — marcado, vista y CSS

**Por qué:** es lo que el dueño va a ver y tocar todos los días. Aquí se decide si la funcionalidad se
siente «muy limpia, muy atractiva, intuitiva y agradable» (sus palabras).

**Archivos:**
- Crear: `js/youtube/bibliotecaVista.js`
- Modificar: `index.html` (marcado de la sección y del par de diálogos; CSS junto al del panel de
  YouTube; mover dos bloques `<details>`; quitar el aviso «La transcripción aparecerá aquí» **solo** del
  panel de YouTube)
- Modificar: `.vercelignore` (añadir `.impeccable/`)
- Crear: `tests/verificar_biblioteca_videos.mjs`

- [x] **Paso 1: impeccable.** Sigue «Cómo se usa impeccable en este plan», puntos 1 y 2. Lee el brief
  (`.impeccable/surfaces/js-youtube-bibliotecavista-js.md`) y la especificación §5 (primera vista, tarjeta,
  estados, editor de temas, descargas, accesibilidad).

- [x] **Paso 2: escribir la prueba de aceptación** — crear `tests/verificar_biblioteca_videos.mjs`:

```js
/* JG Turbo · Biblioteca de videos de punta a punta, SIN red ni créditos.
 *
 * La interfaz real (bibliotecaVista.js) contra su contrato: ids, roles y
 * conducta del PLAN_BIBLIOTECA_VIDEOS_IMPLEMENTACION_LLM.md §Contrato de la
 * vista. Si un selector no existe, la vista no cumple el contrato: se arregla
 * la vista, no la prueba. La base se siembra en su versión 1 (como la tiene hoy
 * el dueño) para medir también la migración.
 *
 *   node tests/verificar_biblioteca_videos.mjs
 *   node tests/verificar_biblioteca_videos.mjs --headed
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

const fixture = JSON.parse(await readFile(join(app, 'tests/fixtures/youtube_dNWkwrqAkcM_90s.json'), 'utf8'));
const WEBM = await readFile(join(app, 'tests/fixtures/x/video_prueba.webm'));
const MP4_X = await readFile(join(app, 'tests/fixtures/biblioteca/video_x_20s.mp4'));
const VOZ_MP3 = await readFile(join(app, 'tests/fixtures/biblioteca/voz_1s.mp3'));

const tipos = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.svg': 'image/svg+xml', '.css': 'text/css', '.png': 'image/png', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json', '.txt': 'text/plain' };
const servidor = createServer(async (q, r) => {
  try {
    const p = decodeURIComponent(new URL(q.url, 'http://localhost').pathname);
    // Página en blanco del mismo origen para sembrar la base v1 antes de abrir la app
    if (p === '/__semilla') { r.setHeader('Content-Type', 'text/html'); r.end('<!doctype html><meta charset="utf-8"><title>semilla</title>'); return; }
    const f = join(app, p === '/' ? 'index.html' : p);
    r.setHeader('Content-Type', tipos[extname(f)] || 'application/octet-stream');
    r.end(await readFile(f));
  } catch { r.writeHead(404, { 'Content-Type': 'text/plain' }).end(); }
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

const YT_FALSO = `(() => {
  class JugadorFalso {
    constructor(elemento, opciones) {
      this.opciones = opciones || {}; this.base = 0; this.inicio = 0; this.tasa = 1; this.estado = -1; this.vol = 100; this.mudo = false;
      const viejo = typeof elemento === 'string' ? document.getElementById(elemento) : elemento;
      const marco = document.createElement('div');
      marco.id = typeof elemento === 'string' ? elemento : ((viejo && viejo.id) || 'ytPlayer');
      marco.style.cssText = 'position:absolute;inset:0;background:#111';
      if (viejo) viejo.replaceWith(marco);
      window.__yt = this;
      setTimeout(() => this._evento('onReady'), 30);
    }
    _t() { return this.estado === 1 ? this.base + ((performance.now() - this.inicio) / 1000) * this.tasa : this.base; }
    _evento(nombre, data) { const f = this.opciones.events && this.opciones.events[nombre]; if (f) f({ data, target: this }); }
    getCurrentTime() { return Math.min(this._t(), this.getDuration()); }
    getDuration() { return this.opciones.videoId === 'b2c3d4e5f6g' ? 120 : 5314; }
    getVideoData() { return { title: this.opciones.videoId === 'b2c3d4e5f6g' ? 'Curso de Python desde cero' : 'The Marketing GENIUS', author: 'Canal de prueba', video_id: this.opciones.videoId }; }
    getPlaybackRate() { return this.tasa; }
    getAvailablePlaybackRates() { return [0.5, 0.75, 1, 1.25, 1.5, 2]; }
    setPlaybackRate(r) { this.base = this._t(); this.inicio = performance.now(); this.tasa = Number(r) || 1; this._evento('onPlaybackRateChange', this.tasa); }
    playVideo() { if (this.estado === 1) return; this.base = this._t(); this.inicio = performance.now(); this.estado = 1; this._evento('onStateChange', 1); }
    pauseVideo() { this.base = this._t(); this.estado = 2; this._evento('onStateChange', 2); }
    seekTo(s) { this.base = Math.max(0, Number(s) || 0); this.inicio = performance.now(); window.__ytSalto = this.base; }
    getPlayerState() { return this.estado; }
    getVolume() { return this.vol; } setVolume(v) { this.vol = Number(v); }
    mute() { this.mudo = true; } unMute() { this.mudo = false; } isMuted() { return this.mudo; }
    getOptions() { return []; } getOption() { return []; } setOption() {}
    unloadModule() {}
    destroy() { this.estado = -5; }
  }
  window.YT = { Player: JugadorFalso, PlayerState: { UNSTARTED: -1, ENDED: 0, PLAYING: 1, PAUSED: 2, BUFFERING: 3, CUED: 5 } };
  setTimeout(() => typeof window.onYouTubeIframeAPIReady === 'function' && window.onYouTubeIframeAPIReady(), 0);
})();`;

/** La base v1 del dueño: 3 doblajes (uno a medias, uno de X sin empezar, uno visto y corto). */
function semilla() {
  const segmentosCortos = [
    { startTime: 1, endTime: 4, duration: 3, text: 'Welcome to this Python course.' },
    { startTime: 5, endTime: 9, duration: 4, text: 'Recursion is simple once you see it.' },
    { startTime: 10, endTime: 14, duration: 4, text: 'Let us write our first function.' },
  ];
  return [
    {
      videoId: 'dNWkwrqAkcM', titulo: 'The Marketing GENIUS', duracionS: 5314, idiomaOrigen: 'en', posicionS: 40,
      segmentos: fixture.segments, traducciones: fixture.segments.map((s, i) => [i, `ES ${s.text}`]), actualizado: Date.UTC(2026, 8, 25),
    },
    {
      videoId: 'x:1349794411333394432', titulo: '@BrooklynNets · WATCH: Sean Marks', duracionS: 20, idiomaOrigen: 'en', posicionS: 0,
      segmentos: segmentosCortos, traducciones: [[0, 'Bienvenidos.'], [1, 'La recursión es sencilla.'], [2, 'Escribamos una función.']], actualizado: Date.UTC(2026, 8, 27),
    },
    {
      videoId: 'b2c3d4e5f6g', titulo: 'Curso de Python desde cero', duracionS: 120, idiomaOrigen: 'en', posicionS: 118,
      segmentos: segmentosCortos, traducciones: [[0, 'Bienvenidos al curso.'], [1, 'La recursión es sencilla cuando la ves.'], [2, 'Escribamos la primera función.']], actualizado: Date.UTC(2026, 8, 20),
    },
  ];
}

async function abrir(navegador, { movil = false, sembrar = true } = {}) {
  const contexto = movil
    ? await navegador.newContext({ ...devices['Pixel 7'], acceptDownloads: true })
    : await navegador.newContext({ viewport: { width: 1280, height: 860 }, acceptDownloads: true });
  const pagina = await contexto.newPage();
  const reg = { youtube: 0, transcribe: 0, tts: [], errores: [] };
  pagina.on('pageerror', (e) => reg.errores.push(String(e).slice(0, 200)));
  // Descargas a memoria (el selector de archivos de Chrome no se puede automatizar sin ventana)
  await pagina.addInitScript(() => { try { delete window.showSaveFilePicker; } catch (_) { window.showSaveFilePicker = undefined; } });
  const responder = (r, datos) => r.fulfill(datos).catch(() => {});
  await pagina.route('https://www.youtube.com/iframe_api', (r) => responder(r, { contentType: 'text/javascript', body: YT_FALSO }));
  await pagina.route(/\/(health|session-config|ping|glossary|tts-voices|tts-warmup)(\?|$)/, (r) => {
    const u = r.request().url();
    if (u.includes('/health')) return responder(r, { json: { status: 'ok', server: 'vercel', model: 'whisper-large-v3', model_state: 'listo', model_ready: true, ai_configured: true, groq_configured: true, ia_configured: true, youtube_auto: true, x_video: true, tts_azure: true, tts_fish: false } });
    if (u.includes('/session-config')) return responder(r, { json: { token: 'vercel-bypass', ai_provider: 'mistral', ai_configured: true, groq_configured: true, ia_configured: true, limits: {} } });
    return responder(r, { json: {} });
  });
  await pagina.route(/\/youtube(\?|$)/, (r) => { reg.youtube += 1; return responder(r, { status: 503, json: { detail: 'No debía pedirse: el video está en caché.' } }); });
  await pagina.route(/\/transcribe(\?|$)/, (r) => { reg.transcribe += 1; return responder(r, { status: 503, json: { detail: 'No debía pedirse.' } }); });
  await pagina.route(/\/translate(\?|$)/, async (r) => {
    const cuerpo = JSON.parse(r.request().postData() || '{}');
    const piezas = [...String(cuerpo.text || '').matchAll(/\[\[JG_SEG_(\d{6})\]\]\n([^\[]*)/g)];
    const text = piezas.length ? piezas.map((m) => `[[JG_SEG_${m[1]}]]\nES ${m[2].trim()}`).join('\n\n') : `ES ${cuerpo.text}`;
    await responder(r, { json: { text, ia_used: true, provider: 'mistral', validation: { status: 'ok', integrity_score: 100 } } });
  });
  await pagina.route(/\/tts(\?|$)/, async (r) => {
    const req = r.request();
    const datos = req.method() === 'GET' ? Object.fromEntries(new URL(req.url()).searchParams) : JSON.parse(req.postData() || '{}');
    reg.tts.push({ evitarAzure: String(datos.evitar_azure) === 'true', rate: Number(datos.rate) || 1 });
    await responder(r, { status: 200, contentType: 'audio/mpeg', headers: { 'X-TTS-Engine': 'edge-neural-regional', 'X-TTS-Voice': 'es-CO-SalomeNeural', 'X-TTS-Fallback': '0' }, body: VOZ_MP3 });
  });
  await pagina.route(/\/x-video(\?|$)/, (r) => responder(r, { json: {
    id: '1349794411333394432', indice: 0, autor: 'BrooklynNets', texto: 'WATCH: Sean Marks', idioma_texto: 'en', duracion_s: 20, portada: '', fuente: 'sindicacion',
    hls: 'https://video.twimg.com/v/pl/master.m3u8',
    mp4: [{ url: 'https://video.twimg.com/v/vid/640x360/descarga.mp4', bitrate: 832000, ancho: 640, alto: 360 }],
  } }));
  await pagina.route('https://video.twimg.com/**', async (r) => {
    const u = r.request().url();
    const cuerpo = u.includes('descarga.mp4') ? MP4_X : WEBM;
    const rango = /bytes=(\d+)-(\d*)/.exec(r.request().headers().range || '');
    const cors = { 'access-control-allow-origin': '*', 'accept-ranges': 'bytes' };
    if (rango) {
      const desde = Number(rango[1]);
      const hasta = rango[2] ? Math.min(Number(rango[2]), cuerpo.length - 1) : cuerpo.length - 1;
      return responder(r, { status: 206, contentType: 'video/mp4', headers: { ...cors, 'content-range': `bytes ${desde}-${hasta}/${cuerpo.length}` }, body: cuerpo.subarray(desde, hasta + 1) });
    }
    return responder(r, { status: 200, contentType: u.includes('descarga.mp4') ? 'video/mp4' : 'video/webm', headers: cors, body: cuerpo });
  });
  await pagina.route(/i\.ytimg\.com|pbs\.twimg\.com/, (r) => responder(r, { status: 404, body: '' }));   // miniaturas rotas: la tarjeta no puede romperse
  if (sembrar) {
    await pagina.goto(`${base}/__semilla`);
    await pagina.evaluate((registros) => new Promise((ok, mal) => {
      const pedido = indexedDB.open('jg_youtube', 1);
      pedido.onupgradeneeded = () => pedido.result.createObjectStore('doblajes', { keyPath: 'videoId' });
      pedido.onsuccess = () => {
        const tx = pedido.result.transaction('doblajes', 'readwrite');
        registros.forEach((x) => tx.objectStore('doblajes').put(x));
        tx.oncomplete = () => { pedido.result.close(); ok(); };
        tx.onerror = () => mal(tx.error);
      };
    }), semilla());
  }
  await pagina.goto(`${base}/?tab=yt`, { waitUntil: 'domcontentloaded' });
  await pagina.waitForSelector('#vidBiblioteca[data-estado="listo"]', { timeout: 20000 }).catch(() => {});
  return { contexto, pagina, reg };
}

const tarjetas = (pagina) => pagina.$$eval('#vidLista .vid-tarjeta', (xs) => xs.map((x) => x.dataset.clave));
async function hastaQue(condicion, ms = 10000) {
  const fin = Date.now() + ms;
  while (Date.now() < fin) { if (await condicion()) return true; await esperar(100); }
  return false;
}
async function menuDe(pagina, clave, accion) {
  await pagina.click(`#vidLista .vid-tarjeta[data-clave="${clave}"] .vid-menu-btn`);
  await pagina.click(`#vidLista .vid-tarjeta[data-clave="${clave}"] [role="menuitem"][data-accion="${accion}"]`);
}

const navegador = await chromium.launch({ headless: !process.argv.includes('--headed') });
try {
  console.log('\n── Primer uso ─────────────────────────────────────────────────');
  {
    const { contexto, pagina, reg } = await abrir(navegador, { sembrar: false });
    comprobar('la pestaña se llama «Videos»', (await pagina.textContent('#tabYt .lbl')).trim() === 'Videos');
    comprobar('la biblioteca aparece y queda lista', await pagina.isVisible('#vidBiblioteca') && (await pagina.getAttribute('#vidBiblioteca', 'data-estado')) === 'listo');
    comprobar('biblioteca vacía: se ve el estado vacío, sin tarjetas', await pagina.isVisible('#vidVacio') && (await tarjetas(pagina)).length === 0);
    comprobar('sin errores de JavaScript', reg.errores.length === 0, reg.errores.join(' | '));
    await contexto.close();
  }

  console.log('\n── Migración, «Seguir viendo», búsqueda y filtros ─────────────');
  {
    const { contexto, pagina, reg } = await abrir(navegador);
    comprobar('los 3 videos que ya estaban en caché entran a la biblioteca', (await tarjetas(pagina)).length === 3, (await tarjetas(pagina)).join());
    comprobar('el conteo lo dice', /3 videos/.test(await pagina.textContent('#vidConteo')));
    comprobar('«Seguir viendo» muestra el que quedó a medias', await pagina.isVisible('#vidSeguir') && (await pagina.getAttribute('#vidSeguir', 'data-clave')) === 'dNWkwrqAkcM');
    comprobar('una miniatura rota no rompe la tarjeta', (await pagina.$$('#vidLista .vid-tarjeta .vid-abrir')).length === 3);
    comprobar('cada tarjeta dice su plataforma', (await pagina.textContent('#vidLista .vid-tarjeta[data-clave^="x:"] .vid-plataforma')).trim() === 'X');
    await pagina.fill('#vidBuscar', 'marketing');
    comprobar('buscar filtra al instante', await hastaQue(async () => (await tarjetas(pagina)).join() === 'dNWkwrqAkcM'));
    await pagina.fill('#vidBuscar', 'zzzz');
    comprobar('sin coincidencias se ofrece limpiar', await hastaQue(() => pagina.isVisible('#vidSinResultados')));
    await pagina.click('#vidLimpiar');
    comprobar('«Limpiar búsqueda» devuelve todo', await hastaQue(async () => (await tarjetas(pagina)).length === 3));
    await pagina.click('#vidFiltros [data-plataforma="x"]');
    comprobar('filtro X: solo el de X', await hastaQue(async () => (await tarjetas(pagina)).join() === 'x:1349794411333394432'));
    comprobar('la ficha activa lo anuncia (aria-pressed)', (await pagina.getAttribute('#vidFiltros [data-plataforma="x"]', 'aria-pressed')) === 'true');
    await pagina.click('#vidFiltros [data-vista="vistos"]');
    comprobar('filtro Vistos', await hastaQue(async () => (await tarjetas(pagina)).join() === 'b2c3d4e5f6g'));
    await pagina.click('#vidFiltros [data-vista="todos"]');
    await pagina.selectOption('#vidOrden', 'duracion');
    comprobar('ordenar por duración', await hastaQue(async () => (await tarjetas(pagina))[0] === 'dNWkwrqAkcM'));

    console.log('\n── Temas, favorito, quitar y deshacer ─────────────────────────');
    await menuDe(pagina, 'b2c3d4e5f6g', 'temas');
    comprobar('el editor de temas se abre', await pagina.isVisible('#vidTemasDialogo'));
    await pagina.fill('#vidTemaNuevo', 'aprender');
    await pagina.press('#vidTemaNuevo', 'Enter');
    comprobar('el tema nuevo aparece en el editor (con mayúscula inicial)', await hastaQue(async () => /Aprender/.test(await pagina.textContent('#vidTemasActuales'))));
    await pagina.fill('#vidTemaNuevo', 'Aprender');
    await pagina.press('#vidTemaNuevo', 'Enter');
    comprobar('un tema repetido se explica y no se duplica', /ya está/i.test(await pagina.textContent('#vidTemasMensaje')));
    await pagina.click('#vidTemasListo');
    comprobar('el tema aparece como filtro', await hastaQue(() => pagina.isVisible('#vidTemas [data-etiqueta="Aprender"]')));
    await pagina.click('#vidTemas [data-etiqueta="Aprender"]');
    comprobar('filtrar por el tema', await hastaQue(async () => (await tarjetas(pagina)).join() === 'b2c3d4e5f6g'));
    await pagina.click('#vidTemas [data-etiqueta="Aprender"]');
    await menuDe(pagina, 'x:1349794411333394432', 'favorito');
    await pagina.click('#vidFiltros [data-vista="favoritos"]');
    comprobar('favorito', await hastaQue(async () => (await tarjetas(pagina)).join() === 'x:1349794411333394432'));
    await pagina.click('#vidFiltros [data-vista="todos"]');
    await pagina.reload({ waitUntil: 'domcontentloaded' });
    await pagina.waitForSelector('#vidBiblioteca[data-estado="listo"]', { timeout: 20000 }).catch(() => {});
    comprobar('tema y favorito siguen tras recargar', await hastaQue(() => pagina.isVisible('#vidTemas [data-etiqueta="Aprender"]')) && Boolean(await pagina.$('#vidLista .vid-tarjeta[data-clave^="x:"] .vid-favorito')));
    await menuDe(pagina, 'b2c3d4e5f6g', 'quitar');
    comprobar('quitar lo saca de la lista y ofrece deshacer', await hastaQue(async () => !(await tarjetas(pagina)).includes('b2c3d4e5f6g')) && await pagina.isVisible('#vidDeshacer'));
    await pagina.click('#vidDeshacer');
    comprobar('deshacer lo devuelve con su tema', await hastaQue(async () => (await tarjetas(pagina)).includes('b2c3d4e5f6g')) && /Aprender/.test(await pagina.textContent('#vidLista .vid-tarjeta[data-clave="b2c3d4e5f6g"]')));

    console.log('\n── Teclado ────────────────────────────────────────────────────');
    await pagina.focus('#vidLista .vid-tarjeta[data-clave="b2c3d4e5f6g"] .vid-menu-btn');
    await pagina.keyboard.press('Enter');
    comprobar('Enter abre el menú y el foco entra en él', await hastaQue(() => pagina.evaluate(() => document.activeElement?.getAttribute('role') === 'menuitem')));
    await pagina.keyboard.press('Escape');
    comprobar('Escape cierra el menú y devuelve el foco al botón', await hastaQue(() => pagina.evaluate(() => document.activeElement?.classList.contains('vid-menu-btn') && document.activeElement.getAttribute('aria-expanded') === 'false')));

    console.log('\n── Buscar en lo que se dice y abrir ahí ───────────────────────');
    await pagina.check('#vidEnTexto');
    await pagina.fill('#vidBuscar', 'recursión sencilla');
    comprobar('encuentra el video por lo que se dijo', await hastaQue(async () => (await tarjetas(pagina)).length === 2 && Boolean(await pagina.$('#vidLista .vid-coincidencia'))));
    await pagina.click('#vidLista .vid-tarjeta[data-clave="b2c3d4e5f6g"] [data-accion="abrir-aqui"]');
    await hastaQue(() => pagina.isVisible('#ytDubReproducir'), 20000);
    await pagina.click('#ytDubReproducir');
    comprobar('«Abrir aquí» abre el video en el segundo donde se dijo (5 s)', await hastaQue(() => pagina.evaluate(() => window.__ytSalto === 5)), String(await pagina.evaluate(() => window.__ytSalto)));
    comprobar('sin volver a pedir el texto (caché)', reg.youtube === 0, `${reg.youtube} peticiones a /youtube`);
    comprobar('la biblioteca se pliega mientras se ve el video', (await pagina.getAttribute('#vidPlegar', 'aria-expanded')) === 'false');
    await pagina.click('#btnYtSyncClose');
    comprobar('al cerrar vuelve a desplegarse', await hastaQue(async () => (await pagina.getAttribute('#vidPlegar', 'aria-expanded')) === 'true'));
    comprobar('sin errores de JavaScript', reg.errores.length === 0, reg.errores.join(' | '));
    await contexto.close();
  }

  console.log('\n── Abrir desde la tarjeta y volver al instante ────────────────');
  {
    const { contexto, pagina, reg } = await abrir(navegador);
    await pagina.click('#vidLista .vid-tarjeta[data-clave="dNWkwrqAkcM"] .vid-abrir');
    comprobar('tocar la tarjeta abre el video por el camino de siempre', await hastaQue(() => pagina.isVisible('#ytDubReproducir'), 20000));
    comprobar('sin pedir texto a /youtube', reg.youtube === 0);
    await pagina.click('#ytDubReproducir');
    comprobar('retoma donde iba (40 s)', await hastaQue(() => pagina.evaluate(() => window.__ytSalto === 40)), String(await pagina.evaluate(() => window.__ytSalto)));
    await esperar(2500);
    await pagina.click('#btnYtSyncClose');
    const tts1 = reg.tts.length;
    comprobar('la voz del video quedó guardada («Listo al instante»)', await hastaQue(() => pagina.$('#vidLista .vid-tarjeta[data-clave="dNWkwrqAkcM"] [data-listo]').then(Boolean)), `tts pedidas: ${tts1}`);
    await contexto.close();
  }

  console.log('\n── Descargas ──────────────────────────────────────────────────');
  {
    const { contexto, pagina, reg } = await abrir(navegador);
    await menuDe(pagina, 'b2c3d4e5f6g', 'descargar');
    comprobar('YouTube: solo se ofrece el audio doblado', await pagina.isVisible('#vidDescargasDialogo') && !(await pagina.isVisible('#vidDescargasDialogo input[value="original"]')) && !(await pagina.isVisible('#vidDescargasDialogo input[value="mp4"]')));
    const [mp3] = await Promise.all([pagina.waitForEvent('download', { timeout: 60000 }).catch(() => null), pagina.click('#vidDescargar')]);
    comprobar('el MP3 doblado se descarga con buen nombre', /^jg-turbo-youtube-curso-de-python-desde-cero-audio-es\.mp3$/.test(mp3?.suggestedFilename() || ''), mp3?.suggestedFilename());
    comprobar('las frases del archivo se piden sin Azure (evitar_azure)', reg.tts.length > 0 && reg.tts.every((t) => t.evitarAzure), JSON.stringify(reg.tts.slice(0, 3)));
    await pagina.click('#vidDescargasCerrar');

    await menuDe(pagina, 'x:1349794411333394432', 'descargar');
    comprobar('X: se ofrecen original, audio y video doblado', await hastaQue(() => pagina.isVisible('#vidDescargasDialogo input[value="mp4"]')) && await pagina.isVisible('#vidDescargasDialogo input[value="original"]'));
    comprobar('la calidad muestra su tamaño estimado', /360p · \d+ (KB|MB)/.test(await pagina.textContent('#vidCalidad')));
    await pagina.check('#vidDescargasDialogo input[value="original"]');
    const [original] = await Promise.all([pagina.waitForEvent('download', { timeout: 60000 }).catch(() => null), pagina.click('#vidDescargar')]);
    comprobar('el video original de X se descarga entero', /-original\.mp4$/.test(original?.suggestedFilename() || '') && (await original?.path().then((p) => readFile(p)).then((b) => b.length).catch(() => 0)) === MP4_X.length);
    await pagina.check('#vidDescargasDialogo input[value="mp4"]');
    const [doblado] = await Promise.all([pagina.waitForEvent('download', { timeout: 90000 }).catch(() => null), pagina.click('#vidDescargar')]);
    comprobar('el video de X doblado se genera y se descarga', /-doblado-es\.mp4$/.test(doblado?.suggestedFilename() || ''), doblado?.suggestedFilename());
    comprobar('sin errores de JavaScript', reg.errores.length === 0, reg.errores.join(' | '));
    await contexto.close();
  }

  console.log('\n── Teléfono ───────────────────────────────────────────────────');
  {
    const { contexto, pagina } = await abrir(navegador, { movil: true });
    const desborde = await pagina.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    comprobar('sin desborde horizontal con la biblioteca', desborde <= 0, `${desborde} px`);
    const chicos = await pagina.$$eval('#vidBiblioteca button, #vidBiblioteca input, #vidBiblioteca select', (xs) => xs
      .filter((x) => x.offsetParent !== null && x.type !== 'checkbox' && x.type !== 'radio')
      .map((x) => ({ id: x.id || x.className || x.textContent.trim().slice(0, 20), alto: Math.round(x.getBoundingClientRect().height) }))
      .filter((x) => x.alto < 44));
    comprobar('todo lo tocable de la biblioteca mide ≥ 44 px', chicos.length === 0, JSON.stringify(chicos.slice(0, 5)));
    const letra = await pagina.$$eval('#vidBiblioteca *', (xs) => Math.min(...xs.filter((x) => x.offsetParent !== null && x.childNodes.length && [...x.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())).map((x) => parseFloat(getComputedStyle(x).fontSize))));
    comprobar('ningún texto de la biblioteca mide menos de 13 px', letra >= 13, `${letra} px`);
    await contexto.close();
  }
} finally {
  await navegador.close();
  servidor.close();
}

console.log(`\n${ok} comprobaciones OK · ${fallos.length} fallos`);
if (fallos.length) { console.log(fallos.map((f) => `   · ${f}`).join('\n')); process.exit(1); }
```

  `node tests/verificar_biblioteca_videos.mjs` → falla en «la biblioteca aparece y queda lista» (todavía
  no existe `#vidBiblioteca`).

- [x] **Paso 3: ubicación en `index.html`.** Dentro de `.yt-area`, el orden queda:
  formulario (sin cambios) → `.task-action` («Doblar al español») → `#ytProgArea` → `#ytSyncArea`
  (reproductor) → **`<section id="vidBiblioteca">` (nuevo)** → `<details class="yt-opciones-texto">` («Solo el
  texto») → `<details class="yt-manual" id="ytManual">` → `#ytResultArea`. Es decir: mueve los dos
  `<details>` desde encima de `.result-promise` hasta justo después de la biblioteca (el contenido de
  cada `<details>` no cambia), y borra el bloque `<div class="result-promise">…</div>` **del panel de
  YouTube** (los de otros paneles se quedan). Sin video abierto, la biblioteca queda inmediatamente
  debajo del botón; con un video abierto, debajo del reproductor y plegada.

- [x] **Paso 4: el contrato de la vista** (lo que la prueba y el controlador exigen; la forma, los
  estilos y la composición son tuyos, dentro del brief):

  **Módulo** `js/youtube/bibliotecaVista.js` exporta
  `montarBibliotecaVideos(raiz, deps) → { refrescar(): Promise<void>, plegar(plegada: boolean): void }`
  (`deps` en la Tarea 5). `raiz` es `#vidBiblioteca`. Al montar pinta y llama a `refrescar()`.

  **Estado de la raíz:** `data-estado="cargando"` en el HTML → `"listo"` tras el primer `refrescar()` →
  `"error"` si falla la lectura (con mensaje en `#vidAviso`).

  **Ids y atributos obligatorios dentro de `#vidBiblioteca`:**

  | Selector | Qué es | Conducta exigida |
  |---|---|---|
  | `#vidConteo` (`aria-live="polite"`) | «N videos» / «1 video» | Se actualiza al refrescar. |
  | `#vidPlegar` (`aria-expanded`, `aria-controls="vidCuerpo"`) | Plegar/desplegar | `plegar(true)` → `aria-expanded="false"` y `#vidCuerpo` oculto. |
  | `#vidCuerpo` | Todo lo plegable | — |
  | `#vidSeguir` (`data-clave`) | Tarjeta «Seguir viendo» | Oculta si no hay video en curso; tocar cualquier botón dentro abre ese video (`deps.abrir`). |
  | `#vidBuscar` (`type="search"`, con `label`) | Búsqueda | Filtra al escribir (título, autor, etiquetas). |
  | `#vidEnTexto` (checkbox, con `label`) | «Buscar también en lo que se dice» | Con texto en `#vidBuscar`, busca en `deps.listarDoblajes()` con `buscarEnTranscripcion`. |
  | `#vidFiltros` (`role="group"`) | Fichas | Botones `[data-vista="todos\|favoritos\|viendo\|vistos"]` y `[data-plataforma="youtube\|x"]` con `aria-pressed`; solo uno activo a la vez. |
  | `#vidTemas` (`role="group"`) | Etiquetas del dueño | Un botón por etiqueta `[data-etiqueta="<texto exacto>"]` (orden por uso) con `aria-pressed`; tocarlo filtra y volver a tocarlo quita el filtro. |
  | `#vidOrden` (`select`, con `label`) | Orden | Valores `recientes`, `antiguos`, `titulo`, `duracion`. |
  | `#vidLista` (`role="list"`) | Colección | Un `li.vid-tarjeta[data-clave]` por video, en el orden de `filtrarVideos`. |
  | `#vidVacio` | Estado vacío | Visible solo si la biblioteca no tiene videos. |
  | `#vidSinResultados` + `#vidLimpiar` | Sin coincidencias | Visible si hay videos pero ninguno coincide; `#vidLimpiar` vacía la búsqueda. |
  | `#vidAviso` (`role="status"`) | Mensajes | «Video quitado.», motivos de `deps.abrir`, errores. |
  | `#vidDeshacer` | Deshacer | Aparece al quitar; restaura con `deps.restaurarVideo`; se esconde a los ~6 s. |

  **Tarjeta** `li.vid-tarjeta[data-clave]`:
  - `button.vid-abrir` con nombre accesible = título (abre con `deps.abrir(video)`; si devuelve
    `abierto:false`, mostrar `motivo` en `#vidAviso`).
  - Miniatura `img.vid-miniatura` (`alt=""`, `loading="lazy"`, `referrerpolicy="no-referrer"`) o, si no hay
    o falla (`error`), un fondo con la marca de la plataforma: **nunca** el icono de imagen rota.
  - `.vid-plataforma` con el texto exacto `YouTube` o `X`; duración; barra de avance (`fraccionVista`);
    `.vid-titulo` (2 líneas con elipsis); autor · idioma → es · `fechaRelativa`; etiquetas; `.vid-favorito`
    si es favorito; `[data-listo]` con el texto «Listo al instante» si `deps.videosConVoz()` lo incluye.
  - Si hay coincidencia en lo que se dice: `.vid-coincidencia` («Dice: “…”») y un botón
    `[data-accion="abrir-aqui"][data-segundo]` que llama `deps.abrir(video, { segundo })`.
  - `button.vid-menu-btn` (`aria-haspopup="menu"`, `aria-expanded`, nombre «Opciones de <título>», 44 px)
    que abre `[role="menu"]` con `[role="menuitem"][data-accion]`: `temas`, `favorito`, `descargar`,
    `copiar`, `origen` («Abrir en YouTube» / «Abrir en X», enlace en pestaña nueva con `rel="noopener"`),
    `quitar`. **Enter** abre el menú y pone el foco en el primer ítem; **Escape** lo cierra y devuelve el
    foco al botón (`aria-expanded="false"`); flechas arriba/abajo recorren los ítems. El menú vive
    **dentro de su tarjeta** (no en un portal al final del `body`): la prueba lo busca ahí.

  **Editor de temas** `dialog#vidTemasDialogo` (hoja inferior en celular): `#vidTemasActuales` con un botón
  por tema `[data-quitar="<tema>"]`; `input#vidTemaNuevo` (con `label`; **Enter** agrega con
  `agregarEtiqueta`, sin perder un tema si se escribe rápido: serializa las escrituras);
  `#vidTemasSugerencias` con botones `[data-sugerencia]` (`sugerenciasDeEtiquetas`); `#vidTemasMensaje`
  (`role="status"`) con el motivo: vacía «Escribe un tema.», repetida «Ese tema ya está.», tope «Máximo 10
  temas.»; `#vidTemasListo` cierra y refresca. Cada cambio se guarda al momento (`deps.actualizarVideo`).

  **Descargas** `dialog#vidDescargasDialogo`: radios `input[name="vidTipo"]` con `value="original"`,
  `"mp3"`, `"mp4"` (en YouTube **solo** `mp3` está visible; en X, los tres; al abrir, `mp3` viene elegido;
  el diálogo **sigue abierto** al terminar una descarga, mostrando el resultado); `select#vidCalidad` con una
  opción por `opciones.calidades` y el texto `«360p · 158 MB»` (`formatearBytes`); en celular, preseleccionar
  `calidadQueCabe(calidades, 250 MB)` y explicar por qué; `#vidDescargaEstado` (`role="status"`,
  `aria-live`) con el tamaño antes y el avance durante (fase en palabras: «Traduciendo lo que falta»,
  «Preparando la voz 120 de 342», «Ajustando frases largas», «Armando el archivo», «Bajando el video» con
  MB); `#vidDescargar` llama **directo** en el clic a `deps.descargar(video, tipo, { calidad, signal,
  onProgreso })` (así el selector de archivos se abre); `#vidDescargaCancelar` aborta; `#vidDescargasCerrar`
  cierra. Resultado: `{cancelado:true}` → «No se guardó nada.»; resumen → «Listo: 342 frases, 6 aceleradas»
  (+ «3 frases quedaron un poco corridas» si `corridas > 0`); `ErrorDestino 'grande'` → «Es demasiado
  grande para armarlo en este equipo: elige 360p»; otro error → su mensaje.

  **Estados que deben verse bien** (la prueba mide algunos; el revisor de impeccable el resto): vacío,
  cargando (esqueletos del tamaño real, sin saltos), sin resultados, error de almacenamiento, miniatura
  rota o vertical, título de 280 caracteres, 0 y 10 etiquetas, 200 videos (sin tirones al filtrar),
  coincidencia en lo que se dice, deshacer, descarga en curso, terminada y fallida, servidor apagado
  (`deps.servidorEnLinea()` falso: las tarjetas explican que hace falta el servidor para abrir).

  **Reglas:** `textContent` para todo lo que viene de fuera; clics por delegación en la raíz (una sola
  escucha); nada de `console.log` en producción; ningún `catch` vacío en acciones del dueño.

- [x] **Paso 5: construir** con impeccable (puntos 3 a 5 de «Cómo se usa impeccable»): la vista, el
  marcado y el CSS (tokens de `:root`; sin colores sueltos que no salgan del sistema; `@media` para
  celular 1 columna en lista, tablet 2, escritorio 3–4 columnas). Añade `.impeccable/` en `.vercelignore`.

- [x] **Paso 6: ejecutar** — `node tests/verificar_biblioteca_videos.mjs` → **`48 comprobaciones OK · 0 fallos`**.
  Si un selector no existe, la vista no cumple el contrato: arregla la vista, **no** la prueba.
- [x] **Paso 7: regresión completa** — los comandos del Paso 12 de la T5 + `node tests/verificar_movil_pantalla.mjs`
  + `node tests/verificar_pdf_geometria.mjs` (toques y desbordes de toda la app) → sin fallos nuevos.
- [x] **Paso 8: commit** — `git add js/youtube/bibliotecaVista.js index.html .vercelignore tests/verificar_biblioteca_videos.mjs && git commit -m "feat(videos): biblioteca de videos con buscador, temas y descargas"`

### Tarea 7: revisión final de impeccable y documentación del sistema

- [x] **Paso 1:** puntos 6 y 7 de «Cómo se usa impeccable» (revisor final y documentador). Pasa al revisor
  las capturas en estado poblado **y** vacío, escritorio y celular, y los datos extremos del Foco de
  revisión (título de 280 caracteres, 10 etiquetas, miniatura rota).
- [x] **Paso 2:** aplica el veredicto (máximo dos rondas) y vuelve a correr `verificar_biblioteca_videos`
  (48) después de cada ronda de arreglos.
- [x] **Paso 3: commit** — `git commit -am "style(videos): ajustes de la revisión final de impeccable"` (y,
  si el documentador creó `DESIGN.md`, un commit aparte `docs(diseño): DESIGN.md del sistema visual`).

---

## Fase D · Cierre (documentar, desplegar una vez, verificar, empujar)

### Tarea 8: documentación

- [x] **`CAMBIOS_BIBLIOTECA_VIDEOS.md`** (creado en T4): qué hace, decisiones del dueño (especificación §2),
  hechos medidos M1–M12, arquitectura, datos (v2), contrato `deps` de la vista, límites (250 MB en celular,
  voces 300 MB, 1,25× máximo), pruebas con sus números, qué hacer si edge-tts o X cambian, despliegues.
- [x] **`AGENTS.md`:** sección «## Biblioteca de videos (leer antes de tocar `cacheDoblaje.js` o
  `bibliotecaVista.js`)» con 7 viñetas: documento maestro; **la base es v2 y solo sube** (migración
  aditiva); **nada se poda salvo `voces`**; la voz guardada no pasa por el limitador (`buscarGuardada`);
  descargas con Mediabunny en vendor (import reescrito, M6); `crearDestino` primero en el clic; De YouTube
  solo MP3. Y en «Verificación»: `test_biblioteca_videos.mjs` (83) en unitarias, y las filas de
  `verificar_biblioteca_datos.mjs` (38) y `verificar_biblioteca_videos.mjs` (48).
- [x] **`TRAMPAS.md`:** dos entradas nuevas con el formato del archivo:
  - «Una extensión de Mediabunny con su propia copia no registra nada» (síntoma: MP3 «codec not
    supported»; causa: la extensión importa `"mediabunny"` y el navegador carga otra copia; regla: el
    import de las extensiones en vendor apunta a `./mediabunny.min.mjs`).
  - «El selector de archivos solo abre durante el gesto» (síntoma: `SecurityError`/nada pasa al
    descargar; causa: `showSaveFilePicker` exige activación transitoria; regla: `crearDestino` es lo
    primero del clic).
- [x] **`CONFIG_PERSISTENTE.md`:** `jg_youtube` **v2**: almacenes `doblajes`, `videos` (clave `clave`,
  índice `abierto`) y `voces` (claves `claveDeVoz`, índices `video` y `usado`, tope 300 MB); sin poda de
  videos; sin claves nuevas de `localStorage`.
- [x] **`js/vendor/mediabunny/`:** además de `LICENSE`, un `LEEME.md` de 5 líneas: versión, origen (URLs),
  la reescritura del import y por qué.
- [x] **Commit:** `git add CAMBIOS_BIBLIOTECA_VIDEOS.md AGENTS.md TRAMPAS.md CONFIG_PERSISTENTE.md js/vendor/mediabunny/LEEME.md && git commit -m "docs(videos): biblioteca de videos documentada"`

### Tarea 9: versión, batería completa, vista previa real, producción y push

- [x] **Paso 1: subir versión una sola vez** — `JG_JS_V` en `index.html` y `CACHE_SHELL` en `sw.js` al número
  siguiente al vigente (si era `v153` → `v154` y `jg-turbo-shell-v154`). Commit: `chore: v154 — biblioteca de videos`.
- [x] **Paso 2: batería completa en local** (anota cada número; ninguno puede bajar respecto a la línea
  base): las unitarias de `AGENTS.md` §Verificación + `test_biblioteca_videos`, y todas las de navegador
  de la tabla de `AGENTS.md` + `verificar_biblioteca_datos` + `verificar_biblioteca_videos`, y el servidor
  del Paso 4 de la T3.
- [x] **Paso 3: vista previa real** (mismo procedimiento de la T4) y prueba **con el navegador del dueño**,
  pestaña visible, en Chrome de escritorio:
  1. Abrir «Videos»: sus videos anteriores aparecen (migración real). Anotar cuántos.
  2. Doblar un video nuevo de YouTube y uno de X; cerrarlos; ver que aparecen con miniatura y «Listo al
     instante»; volver a abrirlos: la voz suena al primer toque (medir segundos hasta la voz).
  3. Etiquetar, buscar, «buscar en lo que se dice» con una frase que se oyó, «Abrir aquí».
  4. Descargar el MP3 de un video de YouTube de ~10 min: medir tiempo total; abrir el MP3 en el
     reproductor de Windows y comprobar que la voz coincide con el video (a mano, en 3 puntos).
  5. Descargar el video original de X y el video de X doblado (~5 min): medir tiempos; abrir el MP4 doblado
     en el reproductor de Windows.
  6. **En un iPhone real** (lo hace el dueño con la URL de vista previa): biblioteca, abrir un video,
     descargar un MP3 corto. **[POR CONFIRMAR]** si Safari guarda el archivo o lo muestra en vista previa;
     anotarlo tal cual, sin prometer otra cosa.
  Anota todo en `CAMBIOS_BIBLIOTECA_VIDEOS.md` §«Medición en vista previa».
- [x] **Paso 4: producción** — desde una copia exacta del commit:
  ```bash
  TMP="$(mktemp -d)"
  git archive HEAD | tar -x -C "$TMP"
  mkdir -p "$TMP/.vercel" && cp .vercel/project.json "$TMP/.vercel/"
  cd "$TMP" && npx vercel --prod --yes --scope jhoncod24s-projects
  ```
- [x] **Paso 5: verificar contra el dominio real:**
  ```bash
  curl -s "https://jg-turbo.vercel.app/?nocache=$(date +%s)" | grep -o "JG_JS_V = '[^']*'"
  curl -s "https://jg-turbo.vercel.app/?nocache=$(date +%s)" | grep -o 'id="vidBiblioteca"'
  curl -s -o /dev/null -w "%{http_code}\n" https://jg-turbo.vercel.app/js/vendor/mediabunny/mediabunny.min.mjs
  curl -s -o /dev/null -w "%{http_code}\n" https://jg-turbo.vercel.app/.impeccable/surfaces/js-youtube-bibliotecavista-js.md
  curl -s -X POST https://jg-turbo.vercel.app/api/tts -H "Content-Type: application/json" -d '{"text":"Hola.","voice":"female","language":"es","locale":"es-CO","idioma_fijo":true,"evitar_azure":true}' -D - -o /dev/null | grep -i "x-tts-engine"
  for f in js/youtube/bibliotecaVista.js js/youtube/cacheDoblaje.js js/youtube/exportadorDoblaje.js js/youtube/youtubeSyncController.js js/youtube/dubbingService.js; do
    a=$(curl -s "https://jg-turbo.vercel.app/$f?nocache=$(date +%s)" | sha256sum | cut -c1-12); b=$(git show "HEAD:$f" | sha256sum | cut -c1-12); echo "$f $a $b"; done
  ```
  Esperado: `v154`; `id="vidBiblioteca"`; `200` para Mediabunny; **`404` para `.impeccable/`** (si da 200,
  falta en `.vercelignore`: corrígelo y redespliega); `x-tts-engine: edge-neural-regional`; hashes iguales.
  Repite en producción los puntos 1–2 del Paso 3.
- [x] **Paso 6:** anota el `dpl_…` en `CAMBIOS_BIBLIOTECA_VIDEOS.md` §Despliegues y en `AGENTS.md`; commit
  `docs(videos): anota dpl de v154`.
- [x] **Paso 7: empujar** (GitHub no despliega; sin esto producción vive solo en este equipo):
  ```bash
  git switch main && git merge --ff-only feat/biblioteca-videos && git push origin main
  git fetch origin && git log --oneline origin/main..HEAD   # debe salir vacío
  ```

---

## Criterios de aceptación (para que el dueño verifique el trabajo)

| Fase | Se acepta si… |
|---|---|
| A | `test_biblioteca_videos` 80 (83 tras T5) · `verificar_biblioteca_datos` 38 · servidor 117 passed · T4 anotó el ritmo de edge-tts y la decisión. |
| B | Todas las pruebas de YouTube y X con los números de la línea base; arranque ligero sin fallos nuevos. |
| C | `verificar_biblioteca_videos` 48 OK **y** veredicto `ship` del revisor de impeccable (o `fix` resuelto). |
| D | En producción: la biblioteca con los videos del dueño; volver a un video suena al primer toque; MP3 y MP4 descargados y abiertos; `.impeccable/` da 404; hashes iguales al commit; `git log origin/main..HEAD` vacío; documentos al día. |

## Mejoras que quedan fuera de este plan (para después, en orden de valor)

1. **Sincronizar la biblioteca** entre celular y computador con la nube que ya usa el PDF (sin cuentas).
2. **Exportar/importar la biblioteca** (copia `.json`) mientras no haya sincronización: protege contra un
   navegador que borre sus datos.
3. **Subtítulos en español (SRT/VTT)** para descargar junto al MP3 o el MP4.
4. **Colecciones o listas de reproducción** («Curso de IA, parte 1–8») y reproducción en cadena.
