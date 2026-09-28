# Plan de implementación · Doblar videos de X (antes Twitter) al español

> **Para el agente que ejecuta (cualquier LLM, sin haber visto la conversación en la que se preparó):**
> ejecuta este plan **tarea por tarea, en orden**. Cada tarea trae: por qué existe, archivos, contratos
> (nombres y firmas exactas), prueba primero, implementación, comando de verificación con el resultado
> esperado y commit. Marca una casilla (`- [ ]` → `- [x]`) **solo** después de ejecutar el comando y
> **contar** las comprobaciones. Si tu herramienta tiene `superpowers:executing-plans` o
> `superpowers:subagent-driven-development`, úsalas. Lo marcado **[POR CONFIRMAR]** no se pudo medir al
> escribir el plan: la tarea dice cómo medirlo y qué hacer según el resultado.

**Objetivo:** que en la pestaña YouTube se pueda pegar también un enlace de un post de X (`x.com/…/status/…`)
y el video se vea doblado al español con el mismo motor, las mismas voces, subtítulos, ritmo automático y
«Texto completo» que ya tienen los videos de YouTube.

**Arquitectura:** el motor de doblaje ya está desacoplado de YouTube: `dubbingEngine.js`, `syncEngine.js` y
`motorPreparacion.js` solo hablan con un «reproductor» (contrato de `YouTubePlayer.js`) y con una lista de
segmentos `{startTime, endTime, text}`. Para X se añaden tres piezas y nada del motor cambia:

1. **Servidor** `GET /api/x-video?url=` (`api/x_video.py`): lee el post con la API pública de sindicación
   de X (la que usan sus propios «embeds») y, si falla, con FxTwitter; devuelve las URLs del video (MP4 y
   HLS) filtradas a `video.twimg.com`.
2. **Navegador · texto con tiempos** (`js/youtube/audioX.js` + `servicioX.js`): X casi nunca trae
   subtítulos, así que se escucha el audio: se descarga la pista HLS de **solo audio** (64 kbps, trozos de
   3 s), se arma en partes de ≤ 3,2 MB y cada parte va al `/api/transcribe` que ya existe (Whisper de Groq,
   gratis). Los tiempos de cada parte se desplazan y se unen.
3. **Navegador · reproductor** (`js/youtube/XVideoPlayer.js` + `/x-reproductor.html`): un `<video>` HTML5
   con el mismo contrato que `YouTubePlayer`, alojado en un iframe del mismo origen que **no envía
   Referer** (X lo exige; ver «Hechos medidos», H3).

**Tecnología:** HTML/CSS/JS sin frameworks (módulos ES en `js/youtube/`, carga diferida), FastAPI en
Vercel (`api/index.py`), `requests` (ya instalado), Whisper vía Groq (`/api/transcribe`), Playwright para
las pruebas de navegador. **Sin dependencias nuevas.**

**Especificación:** la sección «Hechos medidos» de este documento + las capturas reales en
`docs/x-doblaje/capturas/`. No hay otro documento: todo lo que necesitas está aquí.

**Validación previa de este plan (2026-09-27, en una copia aislada hecha con `git archive HEAD`, sin tocar
el repositorio):** los bloques de código de este documento se extrajeron **tal cual** con un script, se
aplicaron sobre la copia y se ejecutaron:
- Servidor (T1 + T2): `pytest backend/tests/test_x_video.py` → **35 passed**; junto a 4 archivos
  existentes del servidor, **109 passed** (74 de `main` + 35, sin regresiones).
- Unitarias JS (T4–T7): `node tests/test_x_doblaje.mjs` → **70 OK · 0 fallos**; con la T6b, **72**.
- Navegador (T8 + T9 + T10): `node tests/verificar_x_doblaje.mjs` → **24 OK · 0 fallos**. Contraprueba:
  quitando el `no-referrer` de `servicioX.js` y de `x-reproductor.html`, la prueba **falla** en la
  comprobación del Referer y lista las 3 URLs culpables (la prueba sí prueba algo).
- Regresión de YouTube con T8 + T9 aplicadas: `test_youtube_doblaje` **139**, `test_youtube_sincronia`
  **65**, `verificar_youtube_doblaje` **110**: idénticos a `main`.
- `verificar_arranque_ligero`: **9 OK + 1 fallo que ya existe en `main`** («la app abre pidiendo menos de
  1 MB»: 1 032 KB en `main`, 1 033 KB con este plan). No lo arregla este plan; no puede crecer más.
- **No** ejecutado: la Tarea 3 y la Tarea 12 (necesitan Vercel y un iPhone real) y lo marcado
  **[POR CONFIRMAR]**.

---

## Hechos medidos (2026-09-27) — la base de todas las decisiones

Medido desde una conexión residencial en Colombia y desde el navegador sobre `https://jg-turbo.vercel.app`.
Las respuestas crudas están en `docs/x-doblaje/capturas/`.

| # | Hecho | Cómo se midió | Consecuencia en el plan |
|---|---|---|---|
| H1 | `https://cdn.syndication.twimg.com/tweet-result?id=<id>&token=<cualquiera>` devuelve el JSON del post con las variantes del video. **Sin `token` devuelve `{}`**; con un token aleatorio de 10 caracteres, el post completo. Id inexistente → página HTML 404. | `curl` con y sin token | El servidor manda un token aleatorio (igual que yt-dlp). |
| H2 | La sindicación solo permite CORS a `https://platform.twitter.com`. | cabecera `Access-Control-Allow-Origin` | El navegador **no** puede llamarla: va por el servidor (`/api/x-video`). |
| H3 | **`video.twimg.com` responde 403 si la petición lleva `Referer` de otro dominio** (`https://jg-turbo.vercel.app/`). Sin Referer, o con `https://x.com/`, responde 200/206. `curl` no manda Referer y por eso «funciona» en consola. En el navegador, un `<video src=mp4>` normal falló con error 4 y la lista HLS con 403. | `curl -H Referer` y `<video>` inyectado en la app | Toda petición a `video.twimg.com` va **sin Referer**: `fetch(url, {referrerPolicy:'no-referrer'})` y el `<video>` dentro de `/x-reproductor.html` (meta `no-referrer`). Medido en el navegador: así carga (`duration 324,5 s`, `videoWidth 640`), acepta `playbackRate 0,9` y salta a 200 s. |
| H4 | `video.twimg.com` refleja el origen en CORS (`Access-Control-Allow-Origin: https://jg-turbo.vercel.app`) y acepta `Range`. | `curl -I -H Origin` | El navegador puede leer las listas HLS y los trozos de audio con `fetch`. |
| H5 | La lista HLS maestra trae **pistas de solo audio** (`/mp4a/32000/`, `/64000/`, `/128000/`) en fMP4 con trozos de ~3 s y un inicial `EXT-X-MAP`. **Inicial + trozos seguidos, concatenados, forman un `.m4a` válido** (ffprobe: `mov,mp4,m4a`, duración correcta). | descarga y `ffprobe` | El audio se arma en el navegador sin decodificar nada. |
| H6 | 60 s de ese audio (64 kbps = 506 KB; 32 kbps = 267 KB) enviados al `/api/transcribe` **de producción** → `200` en ~2,5 s, idioma `en`, 18 segmentos con `start`/`end`. 64 kbps transcribió «pull the trigger» completo; 32 kbps lo cortó. | `curl -F file=@x64.m4a …/api/transcribe` | Se usa **64 kbps** (32 kbps de respaldo). Respuesta real en `capturas/transcribe_prod_audio64k_60s_1349774757969989634.json`. |
| H7 | En 4 videos reales con voz **ninguno** traía subtítulos útiles (3 sin pista de subtítulos; 1 con pista pero vacía). | lista maestra de cada uno | No se depende de subtítulos de X: siempre se escucha el audio. |
| H8 | FxTwitter (`https://api.fxtwitter.com/status/<id>`, servicio comunitario) devuelve lo mismo con `Access-Control-Allow-Origin: *`. | `curl -i` | Respaldo del servidor, y posible respaldo directo del navegador (Tarea 6b). |
| H9 | A veces el video no está en `mediaDetails` sino dentro de `card.binding_values.unified_card.string_value` (JSON en texto) → `media_entities`. | post `1349794411333394432` | El normalizador lee los dos sitios. |
| H10 | Groq gratis (documentación oficial, 2026-09-27): archivos de hasta **25 MB**, **20 peticiones/min**, **7 200 s de audio/hora**, **28 800 s/día**; mp4 y m4a admitidos. Producción tiene `groq_configured: true`. | console.groq.com/docs | 60 min de video = ~10 peticiones: cabe de sobra. Ante «Límite de uso» se espera y se reintenta. |
| H11 | Supadata también lee X, pero sin subtítulos genera con IA a **2 créditos/min** (plan gratis: 100/mes ≈ 50 min al mes). | docs.supadata.ai | **No** se usa Supadata para X: Whisper de Groq es gratis y mucho más holgado. |
| H12 | La clave `GROQ_API_KEY` del `.env` local está **inválida (401)**, igual que la de Supadata. La de Vercel funciona. | `curl` directo a Groq | Las pruebas locales usan dobles; lo real se mide en vista previa/producción. |

**[POR CONFIRMAR] (se mide en la Tarea 3):** si la sindicación y FxTwitter responden a las IP de Vercel
(YouTube, por ejemplo, bloquea a los centros de datos). **[POR CONFIRMAR] (se mide en la Tarea 12):** en
iPhone, que el toque en la página active el `play()` del video dentro del iframe, y que el video siga con la
pestaña en segundo plano.

### Por qué NO las otras vías

- **API oficial de X (v2):** de pago y exige cuenta de desarrollador. Descartada por la regla del proyecto
  (100 % gratis, `AGENTS.md` §TTS).
- **Reproductor embebido de X (`platform.twitter.com`):** no expone el tiempo del video ni permite
  cambiar la velocidad por código → el doblaje no se puede sincronizar ni aplicar el ritmo automático.
- **yt-dlp en el servidor:** descarga el video entero en una función de 60 s y depende de que X no bloquee
  a Vercel. La vía del navegador ya está medida.
- **Descargar el audio en el servidor:** un video de 30 min son ~600 trozos de 3 s: no cabe en 60 s y
  choca con la regla «el troceo vive en el navegador» (`AGENTS.md` §Traducir).

### Riesgo que el dueño acepta al ejecutar este plan

La sindicación y FxTwitter no son una API oficial con contrato: X puede cambiarlas sin aviso y la función
dejaría de leer posts (el resto de la app no se afecta). La app solo lee posts **públicos**, no guarda ni
redistribuye videos. Si X cambia algo, el síntoma será `503 x_red` o `404` en `/api/x-video` y el arreglo
vive en un solo archivo (`api/x_video.py`).

---

## Restricciones globales (valen para todas las tareas)

1. **Idioma:** nombres, comentarios, mensajes y commits en español (Colombia). Comentarios solo donde el
   *porqué* no es obvio.
2. **Sin dependencias nuevas:** ni npm ni pip. Python: solo lo que ya está en `api/requirements.txt`
   (incluye `requests`). JS: nativo del navegador. Si vas a consultar documentación de una librería, usa
   Context7 (`AGENTS.md`).
3. **YouTube no se toca por dentro.** El camino de YouTube debe quedar idéntico: mismas claves de caché
   (el id de 11 caracteres, sin prefijo), mismas pruebas en verde con el mismo número de comprobaciones.
   La única modificación permitida en su flujo es la extracción mecánica de la Tarea 8.
4. **Toda petición a `video.twimg.com` va sin Referer** (H3). En JS: `referrerPolicy: 'no-referrer'`. El
   `<video>` vive en `/x-reproductor.html`. Prohibido «simplificar» poniéndolo directo en la página.
5. **Solo se aceptan URLs de `video.twimg.com` (video/audio) y `pbs.twimg.com` (portada)** que vengan del
   servidor o de FxTwitter. Cualquier otra se descarta: un tercero no puede mandar al navegador a otro sitio.
6. **Límites de la plataforma:** Vercel corta la función a 60 s (`vercel.json`) y rechaza cuerpos de más de
   ~4,5 MB. Por eso: `/api/x-video` con tiempos de espera cortos (8 s por fuente) y el audio en partes de
   **≤ 3,2 MB** desde el navegador. No subir el tamaño de parte sin volver a medir.
7. **Una sola puerta a `/api/translate`** (`jgPedirTraduccion`); este plan no la toca. La traducción y la
   voz de X usan exactamente lo mismo que YouTube.
8. **Carga diferida:** ningún módulo nuevo se descarga al abrir la app. Todos se importan solo desde
   `js/youtube/youtubeSyncController.js`. `tests/verificar_arranque_ligero.mjs` debe seguir en 7 OK.
9. **CSS:** `.btn` está definido dos veces en `index.html`; estiliza con el contenedor delante
   (`.yt-area .yt-url-nota`). Toques ≥ 44 px, texto ≥ 13 px, sin desborde horizontal a 360 px. **El diseño
   de los subtítulos (`.yt-caption`) es intocable** (regla del dueño).
10. **Persistencia:** no se crean claves nuevas de `localStorage`. La caché de X usa la base IndexedDB
    existente `jg_youtube` con clave `x:<id>` (o `x:<id>:<n>` si el post tiene varios videos). No subir la
    versión de esa base.
11. **Costos:** nada de esto gasta créditos pagos. Groq es gratis; si responde «Límite de uso», se espera y
    se reintenta (máx. 2 veces) y luego se explica el motivo. **No** se enciende Supadata para X.
12. **Despliegue (`AGENTS.md`):** un solo despliegue a producción al **final** (Tarea 12). Excepción ya
    prevista: la Tarea 3 hace una **vista previa** (`npx vercel --yes`, sin `--prod`) porque la duda solo se
    resuelve desde las IP de Vercel. Subir `JG_JS_V` (`index.html`) y `CACHE_SHELL` (`sw.js`) una sola vez,
    juntos, en la Tarea 12.
13. **Trabajo concurrente:** antes de editar `index.html` o `api/index.py`, mira `git status` y la fecha de
    modificación (`ls -l --time-style=+%F\ %T index.html api/index.py`). Si cambió hace minutos y no fuiste
    tú, pregunta al dueño. Nunca `git checkout -- <archivo>` sobre trabajo ajeno. Si hay un agente de
    diseño/UX trabajando en paralelo, no edites `index.html` (ver `AGENTS.md` §Coordinación).
14. **Saltos de línea:** en disco `index.html`, `api/index.py` y `js/youtube/*.js` están en **CRLF**; Git
    los guarda como LF. Si tu herramienta reemplaza texto exacto, compara normalizando. No conviertas
    archivos enteros de CRLF a LF.
15. **Honestidad (`TRAMPAS.md` §1):** una prueba que se corta no pasa; cuenta las comprobaciones. Nada se
    marca como verificado sin ejecutar el comando. Un botón o acción que falla debe decir por qué (TRAMPAS
    «Un botón que falla en silencio es un botón roto»): prohibidos los `catch` vacíos en acciones de la
    persona.
16. **Commits:** autor `JHONCOD24 <juanloras35@gmail.com>` (nunca el correo `noreply`). Un commit por
    tarea con el mensaje indicado.
17. **Fuera de alcance, no tocar:** `js/vendor/`, `api/calidad_linguistica.py` y su copia en `backend/`,
    el lector de PDF, la cola general de lectura en voz alta, `backend/app.py`, `api/supadata.py`, el
    endpoint `/api/youtube` y el pegado manual de YouTube (`ytPasteInput`, `btnYtPasteClip`,
    `jgLimpiarTranscripcionPegada`, `jgAplicarTextoPegadoYt`).

## Foco de revisión (lo que más puede morder a una persona real)

1. **Referer:** una sola petición a `video.twimg.com` con Referer = video negro o transcripción fallida con
   un 403 que en local no se ve → pruebas en T6 (el `fetch` por defecto usa `no-referrer`) y en T10 (el
   navegador simulado **falla** si alguna petición a `video.twimg.com` lleva Referer).
2. **Videos largos (30–60 min):** ninguna parte supera 3,2 MB, el solape no duplica ni pierde frases y el
   progreso se ve → T5 (lista sintética de 60 min) y T6.
3. **Posts raros:** sin video, solo fotos, GIF (sin sonido), privado/borrado, varios videos (`/video/2`),
   cita de otro post con video, transmisión en vivo, enlace `t.co` → T1, T2 y T4.
4. **Acciones a mitad de camino:** cancelar, cerrar o pegar otro enlace mientras se descarga o transcribe:
   nada sigue subiendo audio → T6 (unitaria con `AbortController`) y T10 (navegador).
5. **iPhone y segundo plano:** el toque debe arrancar el video del iframe; Safari no deja fijar el volumen
   (se usa el modo «silenciar original» que ya existe) → lista manual en T12 [POR CONFIRMAR en equipo real].

---

## Mapa de archivos

| Archivo | Acción | Responsabilidad única |
|---|---|---|
| `api/x_video.py` | Crear | Reconocer el enlace, consultar sindicación → FxTwitter, normalizar y filtrar URLs. Sin FastAPI. |
| `api/index.py` | Modificar | Ruta `GET /api/x-video` y bandera `x_video` en `/api/health`. |
| `backend/tests/test_x_video.py` | Crear | Pruebas del módulo y de la ruta (sin red). |
| `tests/fixtures/x/*` | Crear | Capturas reales copiadas de `docs/x-doblaje/capturas/`, casos de enlaces compartidos JS↔Python y un video WebM de prueba. |
| `js/youtube/fuenteVideo.js` | Crear | `detectarFuente(url)`: ¿YouTube, X o nada? |
| `js/youtube/audioX.js` | Crear | Funciones puras: pista de audio, lista HLS, plan de partes, unión de tiempos, elegir MP4. |
| `js/youtube/servicioX.js` | Crear | E/S de X: info del post, descarga del audio sin Referer, subida por partes, reintentos, cancelación. |
| `x-reproductor.html` | Crear | Documento mínimo con `<video>` y política `no-referrer`. |
| `js/youtube/XVideoPlayer.js` | Crear | Reproductor con el contrato de `YouTubePlayer` sobre ese `<video>`. |
| `vercel.json` | Modificar | Cabecera `Referrer-Policy: no-referrer` para `/x-reproductor.html`. |
| `js/youtube/youtubeSyncController.js` | Modificar | T8: extraer `abrirSesion`/`completarSesion` sin cambiar conducta. T9: camino de X. |
| `index.html` | Modificar | Textos del panel, nota de enlace de X, CSS de la nota. En T12: `JG_JS_V`. |
| `tests/test_x_doblaje.mjs` | Crear | Unitarias JS (sin red). |
| `tests/verificar_x_doblaje.mjs` | Crear | De punta a punta con Playwright, todo simulado. |
| `CAMBIOS_X.md` | Crear | Documento maestro del feature. |
| `AGENTS.md`, `TRAMPAS.md`, `CONFIG_PERSISTENTE.md`, `sw.js` | Modificar | Cierre (T11–T12). |

---

## 0. Antes de empezar (obligatorio)

- [x] Leer `AGENTS.md` completo, `TRAMPAS.md` (§1, «Un botón que falla en silencio», «Publicar en Vercel
  no es cerrar», «Un despliegue verificado puede estar sirviendo el código viejo», «Redesplegar sin subir
  `JG_JS_V`», «`.pytest_cache` bloqueada tumba el despliegue entero») y este plan entero.
- [x] Confirmar el punto de partida:
  ```bash
  git status --short
  git log --oneline -3
  grep -o "JG_JS_V = '[^']*'" index.html && grep -o "CACHE_SHELL = '[^']*'" sw.js
  ```
  Esperado: sin cambios ajenos en `index.html`, `api/`, `js/youtube/`, `vercel.json`; versión `v152` y
  `jg-turbo-shell-v152` (si es mayor, alguien desplegó después de este plan: lee sus commits antes de
  seguir y usa el número siguiente al vigente en la Tarea 12).
- [x] Crear la rama: `git switch -c feat/x-doblaje`
- [x] Registrar la línea base (cópiala en tu informe final; son los números que no pueden bajar):
  ```bash
  node tests/test_youtube_doblaje.mjs | tail -1
  node tests/test_youtube_sincronia.mjs | tail -1
  node tests/verificar_youtube_doblaje.mjs | tail -3
  node tests/verificar_arranque_ligero.mjs | tail -3
  python -m pytest backend/tests/test_supadata_youtube.py backend/tests/test_youtube_idioma_origen.py backend/tests/test_ia_respaldo.py backend/tests/test_api_youtube_bloqueo.py -q
  ```
  Referencias medidas el 2026-09-27 sobre `main`: `test_youtube_doblaje` 139 OK,
  `test_youtube_sincronia` 65 OK, `verificar_youtube_doblaje` 110 OK, `verificar_arranque_ligero`
  **9 OK + 1 fallo preexistente** («la app abre pidiendo menos de 1 MB — 1032 KB»; `AGENTS.md` todavía
  dice 7: está desactualizado). Ese fallo no es tuyo: anótalo y vigila que el peso no suba más de ~2 KB.
  Servidor: **74 passed**. (No uses `test_transcribe.py` como línea base: no carga ni en `main` porque
  importa `api.subtitulos_limpieza`, que no existe; está documentado en `AGENTS.md` §Verificación.)
  Durante la validación de este plan `test_youtube_doblaje` dio **1 fallo intermitente en 1 de ~22
  corridas** (no se reprodujo en 16 corridas más, ni en `main` ni con el plan; los módulos que prueba no
  los toca este plan). Si te pasa, repítela; si el fallo se repite, anota el nombre de la comprobación y
  compáralo contra `main` antes de culpar a tu cambio.
  Si hoy salen otros números, anótalos: **tu** línea base es la de hoy.
- [x] Comprobar que hay `ffmpeg` (lo usa la Tarea 10 para fabricar un video de prueba):
  `ffmpeg -version | head -1`. Si no está, instálalo (`winget install Gyan.FFmpeg`) o pide al dueño.

---

## Fase 1 · Servidor

### Tarea 1: `api/x_video.py` — leer el post de X y normalizarlo

**Por qué:** el navegador no puede llamar a la sindicación (H2) y las dos fuentes (H1, H8, H9) traen el
video en formas distintas. Este módulo las reduce a una sola forma y filtra las URLs (restricción 5).

**Archivos:**
- Crear: `api/x_video.py`
- Crear: `tests/fixtures/x/` (copias de las capturas + `enlaces.json`)
- Crear: `backend/tests/test_x_video.py`

**Interfaces:**
- Produce (Python):
  - `class XVideoError(RuntimeError)` con atributos `codigo: str` y `http_status: int`.
  - `extraer_id(url: str) -> Optional[tuple[str, int]]` → `(id_post, indice_video)` con índice desde 0, o
    `None`.
  - `normalizar_sindicacion(datos: dict, indice: int = 0) -> dict` y
    `normalizar_fxtwitter(datos: dict, indice: int = 0) -> dict` → la forma de abajo, o `XVideoError`.
  - `consultar(url: str, http=requests) -> dict` → la forma de abajo + `"fuente": "sindicacion"|"fxtwitter"`.
  - Forma devuelta (claves exactas):
    ```python
    {"id": "1349794411333394432", "indice": 0, "autor": "BrooklynNets", "texto": "WATCH: …",
     "idioma_texto": "en", "duracion_s": 324.484, "portada": "https://pbs.twimg.com/…jpg",
     "mp4": [{"url": "https://video.twimg.com/…/480x270/….mp4?tag=14", "bitrate": 288000, "ancho": 480, "alto": 270}, …],
     "hls": "https://video.twimg.com/…/pl/….m3u8?tag=14", "fuente": "sindicacion"}
    ```
  - Códigos de error → HTTP: `enlace` 400 · `no_disponible` 404 · `sin_video` 404 · `gif` 422 ·
    `red` 503.

- [x] **Paso 1: copiar las capturas como fixtures y escribir los casos de enlaces**

```bash
mkdir -p tests/fixtures/x
cp docs/x-doblaje/capturas/*.json docs/x-doblaje/capturas/*.m3u8 tests/fixtures/x/
```

Crear `tests/fixtures/x/enlaces.json` (lo leen **las dos** suites, JS y Python, para que el reconocimiento
de enlaces no se desalinee):

```json
[
  {"url": "https://x.com/elonmusk/status/1585341984679469056", "id": "1585341984679469056", "indice": 0},
  {"url": "https://twitter.com/BrooklynNets/status/1349794411333394432?s=20", "id": "1349794411333394432", "indice": 0},
  {"url": "x.com/i/status/1905393918977393099", "id": "1905393918977393099", "indice": 0},
  {"url": "https://mobile.twitter.com/i/web/status/910031516746514432", "id": "910031516746514432", "indice": 0},
  {"url": "https://x.com/jamestalarico/status/2023659473466687994/video/2", "id": "2023659473466687994", "indice": 1},
  {"url": "https://fxtwitter.com/elonmusk/status/1585341984679469056", "id": "1585341984679469056", "indice": 0},
  {"url": "https://www.x.com/elonmusk/status/1585341984679469056/photo/1", "id": "1585341984679469056", "indice": 0},
  {"url": "https://x.com/home", "id": null},
  {"url": "https://x.com/elonmusk", "id": null},
  {"url": "https://x.com.evil.com/a/status/1585341984679469056", "id": null},
  {"url": "https://evilx.com/a/status/1585341984679469056", "id": null},
  {"url": "https://x.com/i/broadcasts/1YqKDgvLLbXxV", "id": null},
  {"url": "https://t.co/D68z4K2wq7", "id": null},
  {"url": "https://www.youtube.com/watch?v=dNWkwrqAkcM", "id": null},
  {"url": "", "id": null}
]
```

- [x] **Paso 2: escribir las pruebas (fallan porque el módulo no existe)**

Crear `backend/tests/test_x_video.py`:

```python
"""Videos de X: reconocer el enlace y leer el post sin salir a la red.

Las respuestas son capturas reales del 2026-09-27 (tests/fixtures/x/). Ninguna
prueba llama a X ni a FxTwitter.
"""
import json
import sys
from pathlib import Path

import pytest
import requests

APP_ROOT = Path(__file__).resolve().parents[2]
if str(APP_ROOT) not in sys.path:
    sys.path.insert(0, str(APP_ROOT))

from api import x_video as xv  # noqa: E402

FIX = APP_ROOT / "tests" / "fixtures" / "x"


def cargar(nombre):
    return json.loads((FIX / nombre).read_text(encoding="utf-8"))


@pytest.mark.parametrize("caso", cargar("enlaces.json"), ids=lambda c: c["url"] or "vacío")
def test_extraer_id_casos_compartidos_con_js(caso):
    esperado = (caso["id"], caso["indice"]) if caso["id"] else None
    assert xv.extraer_id(caso["url"]) == esperado


def test_sindicacion_con_media_details():
    info = xv.normalizar_sindicacion(cargar("sindicacion_mediaDetails_1585341984679469056.json"))
    assert info["id"] == "1585341984679469056"
    assert info["autor"] == "elonmusk"
    assert info["idioma_texto"] == "en"
    assert info["texto"] == "Entering Twitter HQ – let that sink in!"   # sin el t.co del final
    assert info["duracion_s"] == pytest.approx(9.301)
    assert [v["bitrate"] for v in info["mp4"]] == [256000, 832000, 2176000, 10368000]
    assert info["mp4"][0]["ancho"] == 480 and info["mp4"][0]["alto"] == 270
    assert info["hls"].startswith("https://video.twimg.com/") and ".m3u8" in info["hls"]
    assert info["portada"].startswith("https://pbs.twimg.com/")


def test_sindicacion_con_unified_card():
    info = xv.normalizar_sindicacion(cargar("sindicacion_unified_card_1349794411333394432.json"))
    assert info["duracion_s"] == pytest.approx(324.484)
    assert len(info["mp4"]) == 3
    assert info["hls"].endswith(".m3u8?tag=14")


def test_fxtwitter():
    info = xv.normalizar_fxtwitter(cargar("fxtwitter_1349794411333394432.json"))
    assert info["autor"] == "BrooklynNets"
    assert info["idioma_texto"] == "en"
    assert info["duracion_s"] == pytest.approx(324.484, abs=0.01)
    assert info["mp4"] and info["hls"]


def test_urls_de_otros_dominios_se_descartan():
    datos = cargar("sindicacion_mediaDetails_1585341984679469056.json")
    variantes = datos["mediaDetails"][0]["video_info"]["variants"]
    variantes.append({"content_type": "video/mp4", "bitrate": 999, "url": "https://evil.example/v.mp4"})
    variantes.append({"content_type": "video/mp4", "bitrate": 998, "url": "http://video.twimg.com/sin-https.mp4"})
    datos["mediaDetails"][0]["media_url_https"] = "https://evil.example/portada.jpg"
    info = xv.normalizar_sindicacion(datos)
    assert all(v["url"].startswith("https://video.twimg.com/") for v in info["mp4"])
    assert info["portada"] == ""


def test_gif_no_tiene_sonido():
    datos = {"__typename": "Tweet", "id_str": "1", "text": "", "user": {"screen_name": "a"},
             "mediaDetails": [{"type": "animated_gif", "video_info": {"variants": []}}]}
    with pytest.raises(xv.XVideoError) as exc:
        xv.normalizar_sindicacion(datos)
    assert exc.value.codigo == "gif" and exc.value.http_status == 422


@pytest.mark.parametrize("datos", [{}, {"__typename": "TweetTombstone"}])
def test_post_borrado_o_privado(datos):
    with pytest.raises(xv.XVideoError) as exc:
        xv.normalizar_sindicacion(datos)
    assert exc.value.codigo == "no_disponible" and exc.value.http_status == 404


def test_post_solo_con_fotos():
    datos = {"__typename": "Tweet", "id_str": "1", "text": "hola", "user": {"screen_name": "a"},
             "mediaDetails": [{"type": "photo"}]}
    with pytest.raises(xv.XVideoError) as exc:
        xv.normalizar_sindicacion(datos)
    assert exc.value.codigo == "sin_video"


def test_video_de_un_post_citado():
    citado = cargar("sindicacion_mediaDetails_1585341984679469056.json")
    datos = {"__typename": "Tweet", "id_str": "2", "text": "miren esto", "user": {"screen_name": "b"},
             "quoted_tweet": citado}
    info = xv.normalizar_sindicacion(datos)
    assert info["duracion_s"] == pytest.approx(9.301)


def test_indice_mayor_que_los_videos_usa_el_ultimo():
    info = xv.normalizar_sindicacion(cargar("sindicacion_mediaDetails_1585341984679469056.json"), indice=5)
    assert info["duracion_s"] == pytest.approx(9.301)


class RespuestaFalsa:
    def __init__(self, status=200, datos=None, tipo="application/json"):
        self.status_code = status
        self._datos = datos
        self.headers = {"content-type": tipo}

    def json(self):
        if self._datos is None:
            raise ValueError("no es JSON")
        return self._datos


class HttpFalso:
    """Responde según el dominio pedido; guarda cada llamada."""

    def __init__(self, sindicacion, fxtwitter):
        self.respuestas = {"cdn.syndication.twimg.com": sindicacion, "api.fxtwitter.com": fxtwitter}
        self.llamadas = []

    def get(self, url, params=None, headers=None, timeout=None):
        self.llamadas.append({"url": url, "params": params or {}, "timeout": timeout})
        for dominio, respuesta in self.respuestas.items():
            if dominio in url:
                if isinstance(respuesta, Exception):
                    raise respuesta
                return respuesta
        raise AssertionError(f"dominio inesperado: {url}")


URL = "https://x.com/BrooklynNets/status/1349794411333394432"


def test_consultar_usa_sindicacion_con_token():
    http = HttpFalso(RespuestaFalsa(datos=cargar("sindicacion_unified_card_1349794411333394432.json")), None)
    info = xv.consultar(URL, http=http)
    assert info["fuente"] == "sindicacion"
    params = http.llamadas[0]["params"]
    assert params["id"] == "1349794411333394432"
    assert len(params["token"]) == 10   # sin token la sindicación devuelve {} (H1)
    assert http.llamadas[0]["timeout"] <= 8


def test_consultar_cae_a_fxtwitter_si_la_sindicacion_falla():
    http = HttpFalso(requests.ConnectionError("bloqueado"),
                     RespuestaFalsa(datos=cargar("fxtwitter_1349794411333394432.json")))
    assert xv.consultar(URL, http=http)["fuente"] == "fxtwitter"


def test_consultar_sin_ninguna_fuente_es_error_de_red():
    http = HttpFalso(requests.Timeout("lento"), requests.ConnectionError("caído"))
    with pytest.raises(xv.XVideoError) as exc:
        xv.consultar(URL, http=http)
    assert exc.value.codigo == "red" and exc.value.http_status == 503


def test_consultar_prefiere_la_respuesta_definitiva_al_error_de_red():
    http = HttpFalso(RespuestaFalsa(datos={}), requests.ConnectionError("caído"))
    with pytest.raises(xv.XVideoError) as exc:
        xv.consultar(URL, http=http)
    assert exc.value.codigo == "no_disponible"


def test_consultar_enlace_invalido_no_sale_a_la_red():
    http = HttpFalso(None, None)
    with pytest.raises(xv.XVideoError) as exc:
        xv.consultar("https://x.com/home", http=http)
    assert exc.value.codigo == "enlace" and http.llamadas == []


def test_un_gif_no_se_busca_en_la_otra_fuente():
    gif = {"__typename": "Tweet", "id_str": "1", "text": "", "user": {"screen_name": "a"},
           "mediaDetails": [{"type": "animated_gif", "video_info": {"variants": []}}]}
    http = HttpFalso(RespuestaFalsa(datos=gif), None)
    with pytest.raises(xv.XVideoError) as exc:
        xv.consultar(URL, http=http)
    assert exc.value.codigo == "gif" and len(http.llamadas) == 1
```

- [x] **Paso 3: ejecutar y ver que falla**

Run: `python -m pytest backend/tests/test_x_video.py -q`
Esperado: error de colección `ModuleNotFoundError: No module named 'api.x_video'`.

- [x] **Paso 4: implementar `api/x_video.py`**

```python
"""Videos de X (antes Twitter): de un enlace a las URLs del video.

Por qué existe: X no tiene una API gratuita que entregue el video. Sus propios
«embeds» leen `cdn.syndication.twimg.com/tweet-result`, un JSON público que exige
un `token` cualquiera (sin token devuelve `{}`; medido 2026-09-27). Si esa vía
falla, FxTwitter (servicio comunitario) da lo mismo. El navegador no puede llamar
a la sindicación: su CORS solo admite platform.twitter.com.

Solo se entregan URLs https de video.twimg.com (video) y pbs.twimg.com (portada):
un tercero no puede mandar al navegador a otro sitio.

Módulo puro (sin FastAPI) para probarlo sin red.
"""

from __future__ import annotations

import json
import random
import re
import urllib.parse
from typing import Any, Optional

import requests

TIMEOUT_S = 8.0
URL_SINDICACION = "https://cdn.syndication.twimg.com/tweet-result"
URL_FXTWITTER = "https://api.fxtwitter.com/status/{id}"
CABECERAS = {"User-Agent": "Mozilla/5.0", "Accept": "application/json"}
ALFABETO_TOKEN = "123456789abcdefghijklmnopqrstuvwxyz"

HOSTS_X = {
    "x.com", "twitter.com", "mobile.x.com", "mobile.twitter.com",
    "fxtwitter.com", "vxtwitter.com", "fixupx.com", "fixvx.com",
}
RUTA_POST = re.compile(
    r"^/(?:i/web|i|[A-Za-z0-9_]{1,15})/status(?:es)?/(\d{5,25})(?:/video/(\d))?", re.IGNORECASE
)
RE_DIMENSIONES = re.compile(r"/(\d{2,5})x(\d{2,5})/")
RE_TCO_FINAL = re.compile(r"\s*https://t\.co/\w+\s*$")


class XVideoError(RuntimeError):
    """El post no trae un video que se pueda doblar, con un motivo legible."""

    def __init__(self, mensaje: str, codigo: str, http_status: int):
        super().__init__(mensaje)
        self.codigo = codigo
        self.http_status = http_status


def _error(codigo: str) -> XVideoError:
    mensajes = {
        "enlace": ("Ese enlace no es de un post de X con video. Copia el enlace del post (x.com/usuario/status/…).", 400),
        "no_disponible": ("Ese post de X no existe, es privado o tiene restricción de edad.", 404),
        "sin_video": ("Ese post de X no tiene un video.", 404),
        "gif": ("Ese post de X es un GIF: no tiene sonido que doblar.", 422),
        "red": ("No pudimos consultar X en este momento. Intenta de nuevo en unos minutos.", 503),
    }
    mensaje, estado = mensajes[codigo]
    return XVideoError(mensaje, codigo, estado)


def extraer_id(url: str) -> Optional[tuple[str, int]]:
    """(id del post, índice del video desde 0) o None si no es un post de X."""
    texto = (url or "").strip()
    if not texto:
        return None
    if not re.match(r"^https?://", texto, re.IGNORECASE):
        texto = "https://" + texto
    try:
        partes = urllib.parse.urlsplit(texto)
    except ValueError:
        return None
    host = (partes.hostname or "").lower()
    if host.startswith("www."):
        host = host[4:]
    if host not in HOSTS_X:
        return None
    coincidencia = RUTA_POST.match(partes.path or "")
    if not coincidencia:
        return None
    return coincidencia.group(1), max(0, int(coincidencia.group(2) or 1) - 1)


def _segura(url: Any, host: str) -> str:
    try:
        partes = urllib.parse.urlsplit(str(url or ""))
    except ValueError:
        return ""
    return str(url) if partes.scheme == "https" and partes.hostname == host else ""


def _variantes(variantes) -> tuple[list[dict], str]:
    mp4: list[dict] = []
    hls = ""
    for variante in variantes or []:
        url = _segura(variante.get("url"), "video.twimg.com")
        if not url:
            continue
        tipo = str(variante.get("content_type") or variante.get("container") or "").lower()
        if tipo in ("video/mp4", "mp4"):
            dimensiones = RE_DIMENSIONES.search(url)
            mp4.append({
                "url": url,
                "bitrate": int(variante.get("bitrate") or 0),
                "ancho": int(dimensiones.group(1)) if dimensiones else 0,
                "alto": int(dimensiones.group(2)) if dimensiones else 0,
            })
        elif "mpegurl" in tipo or tipo == "m3u8":
            hls = url
    mp4.sort(key=lambda v: v["bitrate"])
    return mp4, hls


def _idioma(valor: Any) -> str:
    codigo = str(valor or "").lower()
    return "" if codigo in ("", "und", "zxx", "qme", "qht") else codigo


def _texto(valor: Any) -> str:
    return RE_TCO_FINAL.sub("", str(valor or "")).strip()[:280]


def _medios_sindicacion(datos: dict) -> list[dict]:
    medios = [m for m in datos.get("mediaDetails") or [] if m.get("type") in ("video", "animated_gif")]
    if medios:
        return medios
    tarjeta = (((datos.get("card") or {}).get("binding_values") or {}).get("unified_card") or {})
    try:
        unificada = json.loads(tarjeta.get("string_value") or "{}")
    except (TypeError, ValueError):
        unificada = {}
    return [m for m in (unificada.get("media_entities") or {}).values() if m.get("type") in ("video", "animated_gif")]


def normalizar_sindicacion(datos: dict, indice: int = 0, _profundidad: int = 0) -> dict:
    if not isinstance(datos, dict) or datos.get("__typename") == "TweetTombstone" or not datos.get("id_str"):
        raise _error("no_disponible")
    medios = _medios_sindicacion(datos)
    if not medios and datos.get("quoted_tweet") and _profundidad == 0:
        return normalizar_sindicacion(datos["quoted_tweet"], indice, 1)
    if not medios:
        raise _error("sin_video")
    medio = medios[min(indice, len(medios) - 1)]
    if medio.get("type") == "animated_gif":
        raise _error("gif")
    info_video = medio.get("video_info") or {}
    mp4, hls = _variantes(info_video.get("variants"))
    if not mp4 and not hls:
        raise _error("sin_video")
    return {
        "id": str(datos.get("id_str")),
        "indice": indice,
        "autor": str((datos.get("user") or {}).get("screen_name") or ""),
        "texto": _texto(datos.get("text")),
        "idioma_texto": _idioma(datos.get("lang")),
        "duracion_s": round(float(info_video.get("duration_millis") or 0) / 1000, 3),
        "portada": _segura(medio.get("media_url_https"), "pbs.twimg.com"),
        "mp4": mp4,
        "hls": hls,
    }


def normalizar_fxtwitter(datos: dict, indice: int = 0, _profundidad: int = 0) -> dict:
    post = datos.get("tweet") if isinstance(datos, dict) else None
    if not isinstance(post, dict) or (datos.get("code") not in (None, 200) and _profundidad == 0):
        raise _error("no_disponible")
    medios = post.get("media") or {}
    videos = medios.get("videos") or []
    if not videos and post.get("quote") and _profundidad == 0:
        return normalizar_fxtwitter({"code": 200, "tweet": post["quote"]}, indice, 1)
    if not videos:
        if any(m.get("type") == "gif" for m in medios.get("all") or []):
            raise _error("gif")
        raise _error("sin_video")
    video = videos[min(indice, len(videos) - 1)]
    mp4, hls = _variantes(video.get("variants") or video.get("formats"))
    if not mp4 and not hls:
        raise _error("sin_video")
    return {
        "id": str(post.get("id") or ""),
        "indice": indice,
        "autor": str((post.get("author") or {}).get("screen_name") or ""),
        "texto": _texto(post.get("text")),
        "idioma_texto": _idioma(post.get("lang")),
        "duracion_s": round(float(video.get("duration") or 0), 3),
        "portada": _segura(video.get("thumbnail_url"), "pbs.twimg.com"),
        "mp4": mp4,
        "hls": hls,
    }


def _pedir_sindicacion(id_post: str, http) -> dict:
    token = "".join(random.choices(ALFABETO_TOKEN, k=10))
    respuesta = http.get(URL_SINDICACION, params={"id": id_post, "token": token, "lang": "es"},
                         headers=CABECERAS, timeout=TIMEOUT_S)
    if respuesta.status_code == 404 or "json" not in str(respuesta.headers.get("content-type", "")):
        return {}
    if respuesta.status_code >= 400:
        raise requests.HTTPError(f"sindicación {respuesta.status_code}")
    return respuesta.json()


def _pedir_fxtwitter(id_post: str, http) -> dict:
    respuesta = http.get(URL_FXTWITTER.format(id=id_post), headers=CABECERAS, timeout=TIMEOUT_S)
    if respuesta.status_code == 404:
        return {"code": 404}
    if respuesta.status_code >= 400:
        raise requests.HTTPError(f"fxtwitter {respuesta.status_code}")
    return respuesta.json()


def consultar(url: str, http=requests) -> dict:
    """Info del video de un post de X. Sindicación primero; FxTwitter de respaldo."""
    identificado = extraer_id(url)
    if not identificado:
        raise _error("enlace")
    id_post, indice = identificado
    errores: list[XVideoError] = []
    fuentes = (
        ("sindicacion", _pedir_sindicacion, normalizar_sindicacion),
        ("fxtwitter", _pedir_fxtwitter, normalizar_fxtwitter),
    )
    for nombre, pedir, normalizar in fuentes:
        try:
            info = normalizar(pedir(id_post, http), indice)
            info["fuente"] = nombre
            return info
        except XVideoError as exc:
            if exc.codigo == "gif":
                raise   # respuesta definitiva: la otra fuente dirá lo mismo
            errores.append(exc)
        except (requests.RequestException, ValueError):
            errores.append(_error("red"))
    for exc in errores:
        if exc.codigo != "red":
            raise exc
    raise errores[-1]
```

- [x] **Paso 5: ejecutar y ver que pasa**

Run: `python -m pytest backend/tests/test_x_video.py -q`
Esperado: `31 passed` (15 casos de enlaces + 16 pruebas; la de «borrado o privado» cuenta 2). Si el
número es otro, cuenta y explica por qué antes de seguir.

- [x] **Paso 6: commit**

```bash
git add api/x_video.py backend/tests/test_x_video.py tests/fixtures/x/
git commit -m "feat(x): leer el video de un post de X (sindicación y FxTwitter de respaldo)"
```

---

### Tarea 2: ruta `GET /api/x-video` y bandera en `/api/health`

**Archivos:**
- Modificar: `api/index.py` (import junto a `from api import youtube_datos`, ≈ línea 45; bandera en
  `health()`, ≈ línea 2074; ruta nueva justo **antes** de `@app.get("/api/youtube-job")`, ≈ línea 2268)
- Modificar: `backend/tests/test_x_video.py` (añadir pruebas de la ruta al final)

**Interfaces:**
- Consume: `x_video.consultar(url) -> dict`, `x_video.XVideoError`.
- Produce: `GET /api/x-video?url=<enlace>` → `200` con la forma de la Tarea 1 · error →
  `{"detail": str, "code": str}` con el `http_status` del error · transmisión en vivo/Spaces → `422`
  `{"code": "en_vivo"}`. `GET /api/health` añade `"x_video": true`.

- [x] **Paso 1: escribir las pruebas de la ruta** (añadir al final de `backend/tests/test_x_video.py`)

```python
from fastapi.testclient import TestClient  # noqa: E402

from api import index as api_module  # noqa: E402

cliente = TestClient(api_module.app)


def test_ruta_devuelve_la_info(monkeypatch):
    monkeypatch.setattr(xv, "consultar", lambda url, http=None: {"id": "1", "fuente": "sindicacion", "mp4": [], "hls": "h"})
    respuesta = cliente.get("/api/x-video", params={"url": URL})
    assert respuesta.status_code == 200
    assert respuesta.json()["fuente"] == "sindicacion"


def test_ruta_traduce_el_error(monkeypatch):
    def falla(url, http=None):
        raise xv.XVideoError("Ese post de X es un GIF: no tiene sonido que doblar.", "gif", 422)
    monkeypatch.setattr(xv, "consultar", falla)
    respuesta = cliente.get("/api/x-video", params={"url": URL})
    assert respuesta.status_code == 422
    assert respuesta.json() == {"detail": "Ese post de X es un GIF: no tiene sonido que doblar.", "code": "gif"}


def test_ruta_rechaza_transmisiones_en_vivo_sin_consultar(monkeypatch):
    monkeypatch.setattr(xv, "consultar", lambda *a, **k: pytest.fail("no debía consultar"))
    respuesta = cliente.get("/api/x-video", params={"url": "https://x.com/i/broadcasts/1YqKDgvLLbXxV"})
    assert respuesta.status_code == 422 and respuesta.json()["code"] == "en_vivo"


def test_health_anuncia_x_video():
    assert cliente.get("/api/health").json()["x_video"] is True
```

- [x] **Paso 2: ejecutar y ver que fallan** — `python -m pytest backend/tests/test_x_video.py -q`
  Esperado: 4 fallos (404 en la ruta y `KeyError: 'x_video'`).

- [x] **Paso 3: implementar en `api/index.py`**

Import (junto a los otros módulos propios, ≈ línea 45):

```python
from api import x_video
```

En `health()`, después de `"youtube_data_api": youtube_datos.configurado(),`:

```python
        # Marca de despliegue del doblaje de videos de X (no depende de claves).
        "x_video": True,
```

Ruta nueva, justo antes de `@app.get("/api/youtube-job")`:

```python
@app.get("/api/x-video")
def x_video_info(url: str = ""):
    """Video de un post de X: URLs de video.twimg.com para reproducir y transcribir.

    Solo metadatos (≤ 2 consultas de 8 s): el audio lo baja y lo trocea el
    navegador, porque la función muere a los 60 s y el cuerpo no pasa de ~4,5 MB.
    """
    if re.search(r"/i/(?:broadcasts|spaces)/", url or "", re.IGNORECASE):
        return JSONResponse(status_code=422, content={
            "detail": "Las transmisiones en vivo y los Spaces de X no se pueden doblar.",
            "code": "en_vivo",
        })
    try:
        return x_video.consultar(url)
    except x_video.XVideoError as exc:
        return JSONResponse(status_code=exc.http_status, content={"detail": str(exc), "code": exc.codigo})
```

- [x] **Paso 4: ejecutar** — `python -m pytest backend/tests/test_x_video.py -q`
  Esperado: `35 passed`. Luego la línea base del servidor (los mismos archivos del paso 0): mismos números.

- [x] **Paso 5: commit**

```bash
git add api/index.py backend/tests/test_x_video.py
git commit -m "feat(x): ruta /api/x-video y marca x_video en /api/health"
```

---

### Tarea 3: medir desde las IP de Vercel (vista previa) — **puerta de decisión**

**Por qué:** YouTube bloquea a los centros de datos de forma determinista (`AGENTS.md` §YouTube). Hay que
saber si X hace lo mismo **antes** de construir el navegador encima. Es la excepción 2 de `AGENTS.md`
(«algo que solo se puede comprobar en el dominio real»), pero sin tocar producción.

- [x] **Paso 1: desplegar una vista previa desde una copia exacta del commit** (la raíz sube archivos sin
  seguimiento y `.pytest_cache` tumba el CLI; ver `TRAMPAS.md`):

```bash
TMP="$(mktemp -d)"
git archive HEAD | tar -x -C "$TMP"
mkdir -p "$TMP/.vercel" && cp .vercel/project.json "$TMP/.vercel/"
cd "$TMP" && npx vercel --yes --scope jhoncod24s-projects
```

Anota la URL de vista previa que imprime (`https://jg-turbo-<algo>.vercel.app`). **Sin `--prod`.**

- [x] **Paso 2: consultar los tres posts de las capturas**

```bash
for u in https://x.com/BrooklynNets/status/1349794411333394432 https://x.com/elonmusk/status/1585341984679469056 https://x.com/jamestalarico/status/2023659473466687994; do
  curl -s -m 30 -w "  HTTP %{http_code} %{time_total}s\n" "<URL_VISTA_PREVIA>/api/x-video?url=$u" | head -c 400; echo
done
curl -s "<URL_VISTA_PREVIA>/api/health"
```

Si la vista previa pide iniciar sesión (401 o redirección a vercel.com), abre esas mismas URLs en el
navegador del dueño (ya tiene la sesión de Vercel) y copia el JSON.

- [x] **Paso 3: decidir y anotar** (en `CAMBIOS_X.md`, que se crea aquí con la sección «Medición desde
  Vercel»: fecha, URL de vista previa, código HTTP, `fuente` y tiempo de cada post):

| Resultado | Decisión |
|---|---|
| 200 con `"fuente": "sindicacion"` | Seguir. La Tarea 6b **no** se hace. |
| 200 con `"fuente": "fxtwitter"` en los tres | Seguir. Anotar que la sindicación bloquea a Vercel. La Tarea 6b **sí** se hace (si FxTwitter cae, el navegador lo intenta directo). |
| 503 `x_red` en los tres | La Tarea 6b pasa a ser el camino **principal**: el navegador consulta FxTwitter directo (H8). Avisa al dueño antes de seguir. |

- [x] **Paso 4: commit** — `git add CAMBIOS_X.md && git commit -m "docs(x): medición de /api/x-video desde Vercel"`

---

## Fase 2 · Navegador: piezas puras y servicio

### Tarea 4: `js/youtube/fuenteVideo.js` — ¿YouTube, X o nada?

**Archivos:**
- Crear: `js/youtube/fuenteVideo.js`
- Crear: `tests/test_x_doblaje.mjs` (arranca con esta sección y el bloque «Resumen»)

**Interfaces:**
- Consume: `extraerVideoId(url)` de `./transcriptionService.js` (sin cambios).
- Produce: `extraerPostX(url) -> {id: string, indice: number} | null` y
  `detectarFuente(url) -> {plataforma: 'youtube'|'x', id: string, indice: number, clave: string} | null`.
  `clave` de YouTube = el id tal cual (compatibilidad con la caché existente); de X = `x:<id>` o
  `x:<id>:<indice>` si `indice > 0`.

- [x] **Paso 1: escribir la prueba**

Crear `tests/test_x_doblaje.mjs`:

```js
/* Doblaje de videos de X · funciones puras y servicio con dobles, sin red.
 * Ejecutar: node tests/test_x_doblaje.mjs
 * Cada tarea del PLAN_X_DOBLAJE_IMPLEMENTACION_LLM.md añade su sección antes del
 * bloque «Resumen». Cuenta las comprobaciones: si bajan, algo se cortó.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const modulo = (nombre) => import(pathToFileURL(path.join(raiz, 'js/youtube', nombre)).href);
const fixture = (nombre) => fs.readFileSync(path.join(raiz, 'tests/fixtures/x', nombre), 'utf8');

let ok = 0;
let fallos = 0;
function comprobar(condicion, mensaje) {
  if (condicion) { ok += 1; console.log(`OK: ${mensaje}`); }
  else { fallos += 1; console.error(`FALLO: ${mensaje}`); }
}

// ── T4: reconocer el enlace ─────────────────────────────────────────────
const fv = await modulo('fuenteVideo.js');
{
  for (const caso of JSON.parse(fixture('enlaces.json'))) {
    const post = fv.extraerPostX(caso.url);
    const esperado = caso.id ? `${caso.id}#${caso.indice}` : 'nada';
    comprobar((post ? `${post.id}#${post.indice}` : 'nada') === esperado, `extraerPostX(${caso.url || 'vacío'}) → ${esperado}`);
  }
  const yt = fv.detectarFuente('https://www.youtube.com/watch?v=dNWkwrqAkcM');
  comprobar(yt?.plataforma === 'youtube' && yt.clave === 'dNWkwrqAkcM', 'YouTube conserva su clave de caché sin prefijo');
  const x = fv.detectarFuente('https://x.com/BrooklynNets/status/1349794411333394432');
  comprobar(x?.plataforma === 'x' && x.clave === 'x:1349794411333394432', 'X usa la clave x:<id>');
  comprobar(fv.detectarFuente('https://x.com/a/status/2023659473466687994/video/2')?.clave === 'x:2023659473466687994:1', 'el 2.º video de un post tiene su propia clave');
  comprobar(fv.detectarFuente('https://example.com/nada') === null, 'otro sitio → null');
}

// ── Resumen ─────────────────────────────────────────────────────────────
console.log(`\n${ok} comprobaciones OK · ${fallos} fallos`);
if (fallos) process.exit(1);
```

- [x] **Paso 2: ejecutar y ver que falla** — `node tests/test_x_doblaje.mjs`
  Esperado: `ERR_MODULE_NOT_FOUND … fuenteVideo.js`.

- [x] **Paso 3: implementar** `js/youtube/fuenteVideo.js`:

```js
/**
 * ¿De qué plataforma es el enlace pegado? Una sola respuesta para todo el panel.
 *
 * YouTube conserva su id como clave de caché (los doblajes ya guardados siguen
 * sirviendo); X lleva el prefijo «x:» para no chocar nunca con un id de YouTube.
 * Los hosts y la ruta son los mismos de api/x_video.py: las dos suites prueban
 * tests/fixtures/x/enlaces.json para que no se desalineen.
 */
import { extraerVideoId } from './transcriptionService.js';

const HOSTS_X = new Set([
  'x.com', 'twitter.com', 'mobile.x.com', 'mobile.twitter.com',
  'fxtwitter.com', 'vxtwitter.com', 'fixupx.com', 'fixvx.com',
]);
const RUTA_POST = /^\/(?:i\/web|i|[A-Za-z0-9_]{1,15})\/status(?:es)?\/(\d{5,25})(?:\/video\/(\d))?/i;

export function extraerPostX(urlCruda) {
  const texto = String(urlCruda || '').trim();
  if (!texto) return null;
  try {
    const url = new URL(/^https?:\/\//i.test(texto) ? texto : `https://${texto}`);
    const host = url.hostname.toLowerCase().replace(/^www\./, '');
    if (!HOSTS_X.has(host)) return null;
    const coincidencia = url.pathname.match(RUTA_POST);
    if (!coincidencia) return null;
    return { id: coincidencia[1], indice: Math.max(0, Number(coincidencia[2] || 1) - 1) };
  } catch {
    return null;
  }
}

export function detectarFuente(url) {
  const youtube = extraerVideoId(url);
  if (youtube) return { plataforma: 'youtube', id: youtube, indice: 0, clave: youtube };
  const post = extraerPostX(url);
  if (!post) return null;
  return {
    plataforma: 'x',
    id: post.id,
    indice: post.indice,
    clave: post.indice ? `x:${post.id}:${post.indice}` : `x:${post.id}`,
  };
}
```

- [x] **Paso 4: ejecutar** — `node tests/test_x_doblaje.mjs` → `19 comprobaciones OK · 0 fallos`.
- [x] **Paso 5: commit** — `git add js/youtube/fuenteVideo.js tests/test_x_doblaje.mjs && git commit -m "feat(x): reconocer enlaces de X junto a los de YouTube"`

---

### Tarea 5: `js/youtube/audioX.js` — audio HLS en partes y unión de tiempos

**Por qué:** es el corazón del texto con tiempos (H5, H6). Todo puro para probarlo con las capturas reales
y con una lista sintética de 60 min.

**Archivos:**
- Crear: `js/youtube/audioX.js`
- Modificar: `tests/test_x_doblaje.mjs` (sección T5 antes de «Resumen»)

**Interfaces:**
- Produce:
  - Constantes: `KBPS_PREFERIDOS = [64000, 32000, 128000]`, `TROZO_MAX_S = 360`,
    `BYTES_MAX_TROZO = 3.2 * 1024 * 1024`, `SOLAPE_SEGMENTOS = 4`.
  - `urlTwimg(ruta: string, base?: string) -> string` (lanza si no es `https://video.twimg.com`).
  - `elegirPistaAudio(maestra: string, preferidos?) -> {uri: string, kbps: number} | null`
  - `leerListaAudio(texto: string) -> {init: string, segmentos: [{uri, inicioS, duracionS}], duracionS}`
  - `duracionMaximaTrozo(kbps: number) -> number` (segundos que caben en `BYTES_MAX_TROZO`, tope 360)
  - `planearTrozos(segmentos, {maxS, solape}) -> [{desde, hasta, inicioS, limiteS}]` (`hasta` excluido)
  - `unirTranscripciones(trozos, resultados: Array<Array<{start,end,text}>>) -> [{startTime, endTime, text}]`
  - `elegirMp4(variantes, {ahorroDatos}) -> {url, bitrate, ancho, alto} | null`

**Regla del solape (léela antes de implementar):** cada parte empieza `SOLAPE_SEGMENTOS` (4 ≈ 12 s)
antes de donde terminó la anterior. La **frontera** (`limiteS`) queda en la mitad del solape. De cada
parte se conservan las frases que **empiezan** en `[limiteS, limiteS de la siguiente)`; y una frase que
empieza antes de que termine la última conservada (−0,25 s) se descarta (es la misma frase oída dos
veces). Así cada frase conserva ~6 s de audio antes y después de la frontera y no se corta a mitad de
palabra.

- [ ] **Paso 1: escribir la prueba** (sección T5 en `tests/test_x_doblaje.mjs`)

```js
// ── T5: audio HLS en partes ─────────────────────────────────────────────
const ax = await modulo('audioX.js');
{
  const pista = ax.elegirPistaAudio(fixture('hls_maestra_1349774757969989634.m3u8'));
  comprobar(pista?.kbps === 64000 && pista.uri.includes('/mp4a/64000/'), 'la maestra real ofrece audio de 64 kbps y se elige');
  comprobar(ax.elegirPistaAudio('#EXTM3U\n#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="audio-32000",URI="/a/mp4a/32000/x.m3u8"')?.kbps === 32000, 'sin 64 kbps, se usa 32 kbps');
  comprobar(ax.elegirPistaAudio('#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1\n/v.m3u8') === null, 'sin pistas de audio → null');

  const lista = ax.leerListaAudio(fixture('hls_audio64k_1349774757969989634.m3u8'));
  comprobar(lista.init.endsWith('.mp4'), 'la lista real trae el inicial EXT-X-MAP');
  comprobar(lista.segmentos.length === 109, 'la lista real trae 109 trozos');
  comprobar(Math.abs(lista.duracionS - 324.49) < 0.05, 'la suma de EXTINF da la duración del video (324,49 s)');
  comprobar(lista.segmentos.every((s, i) => i === 0 || s.inicioS > lista.segmentos[i - 1].inicioS), 'los inicios crecen');

  comprobar(ax.urlTwimg('/amplify_video/1/aud/x.m4s') === 'https://video.twimg.com/amplify_video/1/aud/x.m4s', 'una ruta relativa va a video.twimg.com');
  let rechazo = false;
  try { ax.urlTwimg('https://evil.example/x.m4s'); } catch { rechazo = true; }
  comprobar(rechazo, 'una URL de otro dominio se rechaza');

  comprobar(ax.duracionMaximaTrozo(64000) === 360, '64 kbps: partes de 360 s (≈ 2,9 MB)');
  comprobar(ax.duracionMaximaTrozo(128000) === 209, '128 kbps: partes de 209 s para no pasar 3,2 MB');

  // Un video de 5 min cabe en una sola parte
  const unica = ax.planearTrozos(lista.segmentos, { maxS: 360 });
  comprobar(unica.length === 1 && unica[0].desde === 0 && unica[0].hasta === 109 && unica[0].limiteS === 0, '5 min → una sola parte');

  // Un video sintético de 60 min en trozos de 3 s
  const largo = Array.from({ length: 1200 }, (_, i) => ({ uri: `/s${i}.m4s`, inicioS: i * 3, duracionS: 3 }));
  const partes = ax.planearTrozos(largo, { maxS: 360 });
  comprobar(partes.length >= 10 && partes.length <= 12, `60 min → ${partes.length} partes (10 a 12)`);
  comprobar(partes.every((p) => (p.hasta - p.desde) * 3 <= 360), 'ninguna parte pasa de 360 s');
  comprobar(partes.every((p) => ((p.hasta - p.desde) * 3 * 64000) / 8 <= ax.BYTES_MAX_TROZO), 'ninguna parte pasa de 3,2 MB a 64 kbps');
  comprobar(partes.at(-1).hasta === 1200, 'la última parte llega al final');
  comprobar(partes.slice(1).every((p, k) => partes[k].hasta - p.desde === ax.SOLAPE_SEGMENTOS), 'cada parte se solapa 4 trozos con la anterior');
  comprobar(partes.slice(1).every((p, k) => p.limiteS === largo[p.desde + 2].inicioS && p.limiteS > partes[k].limiteS), 'la frontera cae en la mitad del solape');

  // Unir: una frase oída en las dos partes aparece una sola vez
  const trozos = [{ desde: 0, hasta: 124, inicioS: 0, limiteS: 0 }, { desde: 120, hasta: 200, inicioS: 360, limiteS: 366 }];
  const unidos = ax.unirTranscripciones(trozos, [
    [{ start: 0, end: 4, text: 'Hola.' }, { start: 363, end: 369, text: 'Cruza la frontera.' }, { start: 369.5, end: 371, text: 'Fin de la parte uno.' }],
    [{ start: 2, end: 9, text: 'la frontera.' }, { start: 9.2, end: 12, text: 'Sigue la parte dos.' }, { start: 12.5, end: 14, text: 'Y termina.' }],
  ]);
  comprobar(unidos.map((s) => s.text).join(' | ') === 'Hola. | Cruza la frontera. | Sigue la parte dos. | Y termina.',
    `sin duplicados ni pérdidas en la frontera (${unidos.map((s) => s.text).join(' | ')})`);
  comprobar(unidos[2].startTime === 369.2, 'los tiempos de la parte dos se desplazan 360 s');
  comprobar(unidos.every((s, i) => i === 0 || s.startTime >= unidos[i - 1].startTime), 'el resultado queda en orden');

  // La respuesta real de /api/transcribe (60 s) conserva sus 18 frases en una parte que empieza en 0
  const real = JSON.parse(fixture('transcribe_prod_audio64k_60s_1349774757969989634.json'));
  const soloUna = ax.unirTranscripciones([{ desde: 0, hasta: 20, inicioS: 0, limiteS: 0 }], [real.segments]);
  comprobar(soloUna.length === 18 && soloUna[0].text.startsWith('On the move'), 'la transcripción real de producción entra entera');

  const mp4s = [
    { url: 'a', bitrate: 288000, ancho: 480, alto: 270 },
    { url: 'b', bitrate: 832000, ancho: 640, alto: 360 },
    { url: 'c', bitrate: 2176000, ancho: 1280, alto: 720 },
    { url: 'd', bitrate: 10368000, ancho: 1920, alto: 1080 },
  ];
  comprobar(ax.elegirMp4(mp4s).url === 'c', 'normal: la mejor hasta 720p');
  comprobar(ax.elegirMp4(mp4s, { ahorroDatos: true }).url === 'b', 'ahorro de datos: hasta 360p');
  comprobar(ax.elegirMp4([{ url: 'v', bitrate: 950000, ancho: 720, alto: 1280 }]).url === 'v', 'un video vertical 720×1280 cuenta como 720p');
  comprobar(ax.elegirMp4([]) === null, 'sin variantes → null');
}
```

- [ ] **Paso 2: ejecutar y ver que falla** — `node tests/test_x_doblaje.mjs` → `ERR_MODULE_NOT_FOUND … audioX.js`.

- [ ] **Paso 3: implementar** `js/youtube/audioX.js`:

```js
/**
 * Audio de un video de X para transcribirlo, en partes que caben en una petición.
 *
 * X publica cada video también como HLS con pistas de SOLO audio (32/64/128 kbps,
 * trozos fMP4 de ~3 s). El inicial (EXT-X-MAP) + trozos seguidos, concatenados,
 * forman un .m4a válido que Whisper transcribe (medido 2026-09-27: 60 s de audio
 * → 2,5 s en /api/transcribe). El troceo vive en el navegador: Vercel rechaza
 * cuerpos de más de ~4,5 MB y corta la función a los 60 s.
 */
export const KBPS_PREFERIDOS = Object.freeze([64000, 32000, 128000]);   // 64k: 32k cortó palabras (medido)
export const TROZO_MAX_S = 360;
export const BYTES_MAX_TROZO = 3.2 * 1024 * 1024;
export const SOLAPE_SEGMENTOS = 4;
const ORIGEN_TWIMG = 'https://video.twimg.com';
const redondear = (s) => Math.round(s * 1000) / 1000;

/** URL absoluta de video.twimg.com; cualquier otro destino se rechaza. */
export function urlTwimg(ruta, base = ORIGEN_TWIMG) {
  const url = new URL(String(ruta || ''), base);
  if (url.protocol !== 'https:' || url.hostname !== 'video.twimg.com') {
    throw new Error('El audio del video no viene de video.twimg.com.');
  }
  return url.href;
}

export function elegirPistaAudio(maestra, preferidos = KBPS_PREFERIDOS) {
  const pistas = [];
  for (const linea of String(maestra || '').split(/\r?\n/)) {
    if (!linea.startsWith('#EXT-X-MEDIA:') || !linea.includes('TYPE=AUDIO')) continue;
    const uri = (linea.match(/URI="([^"]+)"/) || [])[1];
    if (!uri) continue;
    const kbps = Number((uri.match(/\/mp4a\/(\d+)\//) || [])[1])
      || Number((linea.match(/GROUP-ID="audio-(\d+)"/) || [])[1]) || 0;
    pistas.push({ uri, kbps });
  }
  for (const kbps of preferidos) {
    const pista = pistas.find((p) => p.kbps === kbps);
    if (pista) return pista;
  }
  return pistas[0] || null;
}

export function leerListaAudio(texto) {
  const lineas = String(texto || '').split(/\r?\n/).map((l) => l.trim());
  const init = (lineas.find((l) => l.startsWith('#EXT-X-MAP:'))?.match(/URI="([^"]+)"/) || [])[1] || '';
  const segmentos = [];
  let t = 0;
  for (let i = 0; i < lineas.length; i += 1) {
    if (!lineas[i].startsWith('#EXTINF:')) continue;
    const duracionS = parseFloat(lineas[i].slice(8));
    const uri = lineas[i + 1];
    if (!uri || uri.startsWith('#') || !Number.isFinite(duracionS)) continue;
    segmentos.push({ uri, inicioS: redondear(t), duracionS });
    t += duracionS;
  }
  return { init, segmentos, duracionS: redondear(t) };
}

export function duracionMaximaTrozo(kbps) {
  const bitsPorSegundo = Number(kbps) > 0 ? Number(kbps) : 64000;
  return Math.min(TROZO_MAX_S, Math.floor((BYTES_MAX_TROZO * 8) / bitsPorSegundo));
}

export function planearTrozos(segmentos, { maxS = TROZO_MAX_S, solape = SOLAPE_SEGMENTOS } = {}) {
  const trozos = [];
  let desde = 0;
  while (desde < segmentos.length) {
    let hasta = desde;
    let duracion = 0;
    while (hasta < segmentos.length && (hasta === desde || duracion + segmentos[hasta].duracionS <= maxS)) {
      duracion += segmentos[hasta].duracionS;
      hasta += 1;
    }
    trozos.push({ desde, hasta, inicioS: segmentos[desde].inicioS, limiteS: 0 });
    if (hasta >= segmentos.length) break;
    desde = Math.max(desde + 1, hasta - solape);   // siempre avanza
  }
  for (let k = 1; k < trozos.length; k += 1) {
    const compartidos = Math.max(0, trozos[k - 1].hasta - trozos[k].desde);
    trozos[k].limiteS = segmentos[trozos[k].desde + Math.floor(compartidos / 2)].inicioS;
  }
  return trozos;
}

export function unirTranscripciones(trozos, resultados) {
  const salida = [];
  let ultimoFin = -Infinity;
  trozos.forEach((trozo, k) => {
    const finS = trozos[k + 1]?.limiteS ?? Infinity;
    for (const frase of resultados[k] || []) {
      const inicio = trozo.inicioS + Number(frase.start ?? frase.startTime ?? NaN);
      const fin = trozo.inicioS + Number(frase.end ?? frase.endTime ?? NaN);
      const texto = String(frase.text || '').trim();
      if (!texto || !Number.isFinite(inicio) || inicio < trozo.limiteS || inicio >= finS) continue;
      if (k > 0 && inicio < ultimoFin - 0.25) continue;   // la misma frase oída en las dos partes
      const cierre = Number.isFinite(fin) ? Math.max(fin, inicio + 0.01) : inicio + 0.01;
      salida.push({ startTime: redondear(inicio), endTime: redondear(cierre), text: texto });
      ultimoFin = Math.max(ultimoFin, cierre);
    }
  });
  return salida;
}

export function elegirMp4(variantes, { ahorroDatos = false } = {}) {
  const lista = (variantes || []).filter((v) => v?.url).slice().sort((a, b) => a.bitrate - b.bitrate);
  if (!lista.length) return null;
  const lado = (v) => Math.min(Number(v.ancho) || 0, Number(v.alto) || 0);
  const tope = ahorroDatos ? 360 : 720;
  const aptas = lista.filter((v) => lado(v) > 0 && lado(v) <= tope);
  return aptas.length ? aptas[aptas.length - 1] : lista[0];
}
```

> Nota para la prueba de unión: con `limiteS` 366 de la parte dos, «Fin de la parte uno.» (369,5 s en la
> parte uno) queda fuera porque empieza después de la frontera, y «la frontera.» (362 s en la parte dos)
> queda fuera porque empieza antes de la frontera. La primera frase que se conserva de la parte dos es
> «Sigue la parte dos.» (369,2 s). Si tu prueba da otra cosa, revisa la regla del solape, no la prueba.

- [ ] **Paso 4: ejecutar** — `node tests/test_x_doblaje.mjs` → `45 comprobaciones OK · 0 fallos`
  (19 de T4 + 26 de T5).
- [ ] **Paso 5: commit** — `git add js/youtube/audioX.js tests/test_x_doblaje.mjs && git commit -m "feat(x): audio HLS en partes de 3,2 MB y unión de tiempos sin duplicados"`

---

### Tarea 6: `js/youtube/servicioX.js` — info, descarga sin Referer y transcripción por partes

**Archivos:**
- Crear: `js/youtube/servicioX.js`
- Modificar: `tests/test_x_doblaje.mjs` (sección T6)

**Interfaces:**
- Consume: todo lo de `audioX.js`; `ErrorYoutube` y `normalizarSegmentos` de `./transcriptionService.js`;
  `codigoCorto` de `./idiomaOrigen.js`.
- Produce:
  - `MAX_DURACION_X_S = 3600`
  - `fetchTwimg(url, {signal}) -> Promise<Response>` (siempre `referrerPolicy: 'no-referrer'`)
  - `tituloX(info) -> string`
  - `class ServicioX { constructor({ fetchApi, pedirTwimg = fetchTwimg, esperar = esperarMs, esperasLimiteMs = [20000, 40000] }) }`
    - `info(url, {signal}) -> Promise<InfoX>` (la forma de la Tarea 1) · error → `ErrorYoutube` con código
      `x_<code del servidor>`.
    - `obtenerParaDoblaje(info, {idiomaOrigen='auto', apiKey='', context='', signal=null, onProgress=(mensaje, fraccion)=>{}})`
      → `Promise<{segmentos, idioma, solicitado, confianza, fuente, conflicto, disponibles, titulo, duracionS}>`
      — **la misma forma** que `TranscriptionService.obtenerParaDoblaje`, para que el controlador y
      `decidirDoblaje` no distingan la plataforma.
- Códigos de `ErrorYoutube` nuevos: `x_largo`, `x_sin_audio`, `x_red`, `x_transcripcion`.

- [ ] **Paso 1: escribir la prueba** (sección T6)

```js
// ── T6: servicio de X con dobles (sin red) ──────────────────────────────
const sx = await modulo('servicioX.js');
{
  // fetchTwimg SIEMPRE manda sin Referer (H3)
  const fetchReal = globalThis.fetch;
  let opcionesVistas = null;
  globalThis.fetch = async (_url, opciones) => { opcionesVistas = opciones; return new Response('ok'); };
  await sx.fetchTwimg('https://video.twimg.com/a.m4s');
  globalThis.fetch = fetchReal;
  comprobar(opcionesVistas?.referrerPolicy === 'no-referrer', 'fetchTwimg pide sin Referer (X responde 403 con Referer ajeno)');

  comprobar(sx.tituloX({ autor: 'BrooklynNets', texto: 'WATCH: Sean Marks' }) === '@BrooklynNets · WATCH: Sean Marks', 'título: @autor · texto');
  comprobar(sx.tituloX({ autor: 'a', texto: '' }) === 'Video de @a', 'título sin texto');

  /** Un video sintético: N trozos de 3 s, audio de 64 kbps (24 000 bytes por trozo). */
  function escenario({ trozos = 250, idiomas = [], respuestas = [] } = {}) {
    const maestra = '#EXTM3U\n#EXT-X-MEDIA:NAME="Audio",TYPE=AUDIO,GROUP-ID="audio-64000",URI="/v/pl/mp4a/64000/a.m3u8"\n';
    const lista = ['#EXTM3U', '#EXT-X-MAP:URI="/v/aud/init.mp4"',
      ...Array.from({ length: trozos }, (_, i) => `#EXTINF:3.000,\n/v/aud/${i}.m4s`), '#EXT-X-ENDLIST'].join('\n');
    const registro = { twimg: [], subidas: [] };
    const pedirTwimg = async (url, { signal } = {}) => {
      if (signal?.aborted) throw new DOMException('Cancelado', 'AbortError');
      registro.twimg.push(url);
      if (url.endsWith('master.m3u8')) return new Response(maestra);
      if (url.endsWith('a.m3u8')) return new Response(lista);
      return new Response(new Uint8Array(url.endsWith('init.mp4') ? 800 : 24000));
    };
    const fetchApi = async (ruta, opciones = {}) => {
      if (opciones.signal?.aborted) throw new DOMException('Cancelado', 'AbortError');
      if (ruta.startsWith('/x-video')) return Response.json({ id: '1', autor: 'a', texto: 't', duracion_s: trozos * 3, hls: 'https://video.twimg.com/v/pl/master.m3u8', mp4: [] });
      const n = registro.subidas.length;
      const archivo = opciones.body.get('file');
      registro.subidas.push({ bytes: archivo.size, idioma: opciones.body.get('language'), nombre: archivo.name });
      const forzada = respuestas[n];
      if (forzada) return forzada();
      return Response.json({ language: idiomas[n] ?? 'en', segments: [{ start: 10, end: 13, text: `Frase de la parte ${n + 1}.` }] });
    };
    return { registro, fetchApi, pedirTwimg };
  }
  const info = { id: '1', autor: 'a', texto: 't', duracion_s: 750, hls: 'https://video.twimg.com/v/pl/master.m3u8', mp4: [] };

  {
    const { registro, fetchApi, pedirTwimg } = escenario();
    const progreso = [];
    const servicio = new sx.ServicioX({ fetchApi, pedirTwimg, esperar: async () => {} });
    const r = await servicio.obtenerParaDoblaje(info, { onProgress: (m, f) => progreso.push(f) });
    comprobar(registro.subidas.length === 3, `750 s → 3 partes subidas (${registro.subidas.length})`);
    comprobar(registro.subidas.every((s) => s.bytes <= 3.2 * 1024 * 1024), 'ninguna parte pasa de 3,2 MB');
    comprobar(registro.subidas[0].idioma === 'auto' && registro.subidas.slice(1).every((s) => s.idioma === 'en'), 'la 1.ª parte detecta el idioma y las demás lo reciben fijo');
    comprobar(registro.subidas.every((s) => s.nombre.endsWith('.m4a')), 'cada parte viaja como .m4a');
    comprobar(r.segmentos.length === 3 && r.segmentos[1].startTime > 300, 'los tiempos de cada parte se desplazan');
    comprobar(r.idioma === 'en' && r.fuente === 'audio' && r.confianza >= 0.9 && !r.conflicto, 'idioma oído por Whisper = fuente firme');
    comprobar(progreso.at(-1) === 1, 'el progreso termina en 1');
  }
  {
    const { registro, fetchApi, pedirTwimg } = escenario();
    const servicio = new sx.ServicioX({ fetchApi, pedirTwimg, esperar: async () => {} });
    const r = await servicio.obtenerParaDoblaje(info, { idiomaOrigen: 'fr' });
    comprobar(registro.subidas.every((s) => s.idioma === 'fr') && r.fuente === 'usuario', 'si la persona elige el idioma, todas las partes lo usan');
  }
  {
    const { registro, fetchApi, pedirTwimg } = escenario({ idiomas: ['es'] });
    const servicio = new sx.ServicioX({ fetchApi, pedirTwimg, esperar: async () => {} });
    const r = await servicio.obtenerParaDoblaje(info);
    comprobar(r.idioma === 'es' && registro.subidas.length === 1, 'video en español: se detiene tras la 1.ª parte (no gasta cuota)');
  }
  {
    const limite = () => Response.json({ detail: 'Límite de uso de Groq alcanzado. Espera un minuto e inténtalo de nuevo.' }, { status: 500 });
    const { registro, fetchApi, pedirTwimg } = escenario({ trozos: 20, respuestas: [limite] });
    const esperas = [];
    const servicio = new sx.ServicioX({ fetchApi, pedirTwimg, esperar: async (ms) => { esperas.push(ms); } });
    const r = await servicio.obtenerParaDoblaje({ ...info, duracion_s: 60 });
    comprobar(esperas[0] === 20000 && registro.subidas.length === 2 && r.segmentos.length === 1, 'ante «Límite de uso» espera 20 s y reintenta');
  }
  {
    const limite = () => Response.json({ detail: 'Límite de uso de Groq alcanzado.' }, { status: 500 });
    const { fetchApi, pedirTwimg } = escenario({ trozos: 20, respuestas: [limite, limite, limite] });
    const servicio = new sx.ServicioX({ fetchApi, pedirTwimg, esperar: async () => {} });
    let error = null;
    try { await servicio.obtenerParaDoblaje({ ...info, duracion_s: 60 }); } catch (e) { error = e; }
    comprobar(error?.codigo === 'x_transcripcion' && /Límite de uso/.test(error.message), 'tras 2 reintentos, el motivo real llega a la persona');
  }
  {
    const { registro, fetchApi, pedirTwimg } = escenario();
    const control = new AbortController();
    const fetchQueCancela = async (ruta, opciones) => {
      const r = await fetchApi(ruta, opciones);
      if (registro.subidas.length === 1) control.abort();
      return r;
    };
    const servicio = new sx.ServicioX({ fetchApi: fetchQueCancela, pedirTwimg, esperar: async () => {} });
    let error = null;
    try { await servicio.obtenerParaDoblaje(info, { signal: control.signal }); } catch (e) { error = e; }
    comprobar(error?.name === 'AbortError', 'cancelar corta con AbortError');
    comprobar(registro.subidas.length === 1, `tras cancelar no se sube nada más (${registro.subidas.length})`);
  }
  {
    const { registro, fetchApi, pedirTwimg } = escenario();
    const servicio = new sx.ServicioX({ fetchApi, pedirTwimg });
    let error = null;
    try { await servicio.obtenerParaDoblaje({ ...info, duracion_s: 2 * 3600 }); } catch (e) { error = e; }
    comprobar(error?.codigo === 'x_largo' && registro.twimg.length === 0, 'un video de 2 h se rechaza sin descargar nada');
  }
  {
    const servicio = new sx.ServicioX({
      fetchApi: async () => { throw new Error('no debía llamar'); },
      pedirTwimg: async () => new Response('#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1\n/v.m3u8'),
    });
    let error = null;
    try { await servicio.obtenerParaDoblaje(info); } catch (e) { error = e; }
    comprobar(error?.codigo === 'x_sin_audio', 'sin pista de audio → mensaje claro');
  }
  {
    const servicio = new sx.ServicioX({
      fetchApi: async () => Response.json({ detail: 'Ese post de X es un GIF: no tiene sonido que doblar.', code: 'gif' }, { status: 422 }),
    });
    let error = null;
    try { await servicio.info('https://x.com/a/status/123456'); } catch (e) { error = e; }
    comprobar(error?.codigo === 'x_gif' && /GIF/.test(error.message), 'info(): el motivo del servidor llega tal cual');
  }
}
```

- [ ] **Paso 2: ejecutar y ver que falla** — `node tests/test_x_doblaje.mjs` → `ERR_MODULE_NOT_FOUND … servicioX.js`.

- [ ] **Paso 3: implementar** `js/youtube/servicioX.js`:

```js
/**
 * Videos de X: del post al texto con tiempos, listo para el mismo doblaje de YouTube.
 *
 * X casi nunca trae subtítulos (medido: 0 de 4 videos con voz), así que se escucha
 * el audio con Whisper (Groq, gratis) por /api/transcribe, en partes de ≤ 3,2 MB.
 * Toda petición a video.twimg.com va SIN Referer: con Referer de otro dominio X
 * responde 403 (medido 2026-09-27; curl no lo muestra porque no manda Referer).
 */
import { ErrorYoutube, normalizarSegmentos } from './transcriptionService.js';
import { codigoCorto } from './idiomaOrigen.js';
import {
  elegirPistaAudio, leerListaAudio, planearTrozos, unirTranscripciones, urlTwimg, duracionMaximaTrozo,
} from './audioX.js';

export const MAX_DURACION_X_S = 60 * 60;
const ESPERA_INFO_MS = 20000;            // /api/x-video: ≤ 2 consultas de 8 s
const ESPERA_PARTE_MS = 90000;           // subir ~3 MB + Whisper sobre 6 min de audio
const DESCARGAS_EN_PARALELO = 8;
const PARTES_EN_PARALELO = 2;            // Groq gratis: 20 peticiones/min
const RE_LIMITE = /l[ií]mite de uso|rate limit|429/i;

const cancelado = () => new DOMException('Cancelado', 'AbortError');
const esperarMs = (ms, signal) => new Promise((resolver, rechazar) => {
  const t = setTimeout(resolver, ms);
  signal?.addEventListener('abort', () => { clearTimeout(t); rechazar(cancelado()); }, { once: true });
});

export function fetchTwimg(url, { signal } = {}) {
  return fetch(url, { referrerPolicy: 'no-referrer', credentials: 'omit', signal });
}

export function tituloX(info) {
  const autor = info?.autor ? `@${info.autor}` : 'X';
  const texto = String(info?.texto || '').replace(/\s+/g, ' ').trim();
  if (!texto) return `Video de ${autor}`;
  const titulo = `${autor} · ${texto}`;
  return titulo.length > 120 ? `${titulo.slice(0, 119)}…` : titulo;
}

/** Corre `trabajo` sobre cada elemento con a lo sumo `limite` a la vez; el primer fallo detiene el resto. */
async function enParalelo(elementos, limite, trabajo) {
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

export class ServicioX {
  constructor({ fetchApi, pedirTwimg = fetchTwimg, esperar = esperarMs, esperasLimiteMs = [20000, 40000] }) {
    if (typeof fetchApi !== 'function') throw new Error('Falta el cliente de la API.');
    this.fetchApi = fetchApi;
    this.pedirTwimg = pedirTwimg;
    this.esperar = esperar;
    this.esperasLimiteMs = esperasLimiteMs;
  }

  async info(url, { signal = null } = {}) {
    const respuesta = await this.fetchApi(`/x-video?url=${encodeURIComponent(url)}`, { signal }, ESPERA_INFO_MS);
    const datos = await respuesta.json().catch(() => ({}));
    if (!respuesta.ok) {
      throw new ErrorYoutube(
        typeof datos?.detail === 'string' ? datos.detail : 'No se pudo leer el post de X.',
        `x_${datos?.code || 'servidor'}`, datos,
      );
    }
    return datos;
  }

  async obtenerParaDoblaje(info, {
    idiomaOrigen = 'auto', apiKey = '', context = '', signal = null, onProgress = () => {},
  } = {}) {
    const duracion = Number(info?.duracion_s) || 0;
    if (duracion > MAX_DURACION_X_S) {
      throw new ErrorYoutube(`Este video dura ${Math.round(duracion / 60)} min. Por ahora se doblan videos de X de hasta ${MAX_DURACION_X_S / 60} min.`, 'x_largo');
    }
    if (!info?.hls) throw new ErrorYoutube('Este video de X no trae una pista de audio que podamos leer.', 'x_sin_audio');
    onProgress('Leyendo el audio del video…', null);
    const pista = elegirPistaAudio(await this.#texto(info.hls, signal));
    if (!pista) throw new ErrorYoutube('Este video de X no trae una pista de audio separada.', 'x_sin_audio');
    const lista = leerListaAudio(await this.#texto(urlTwimg(pista.uri, info.hls), signal));
    if (!lista.init || !lista.segmentos.length) throw new ErrorYoutube('La pista de audio del video llegó vacía.', 'x_sin_audio');
    const inicial = await this.#bytes(urlTwimg(lista.init, info.hls), signal);
    const trozos = planearTrozos(lista.segmentos, { maxS: duracionMaximaTrozo(pista.kbps) });

    const elegido = idiomaOrigen && idiomaOrigen !== 'auto' ? codigoCorto(idiomaOrigen) : '';
    let idioma = elegido;
    const resultados = new Array(trozos.length);
    let hechas = 0;
    const transcribirParte = async (trozo, k) => {
      const partes = [inicial];
      const urls = lista.segmentos.slice(trozo.desde, trozo.hasta).map((s) => urlTwimg(s.uri, info.hls));
      const bytes = new Array(urls.length);
      await enParalelo(urls, DESCARGAS_EN_PARALELO, async (url, i) => { bytes[i] = await this.#bytes(url, signal); });
      partes.push(...bytes);
      const audio = new Blob(partes, { type: 'audio/mp4' });
      resultados[k] = await this.#subir(audio, k, { idioma: idioma || 'auto', apiKey, context, signal });
      hechas += 1;
      onProgress(`Transcribiendo el audio: ${hechas} de ${trozos.length} ${trozos.length === 1 ? 'parte' : 'partes'}…`, hechas / trozos.length);
    };

    onProgress(`Transcribiendo el audio: 0 de ${trozos.length} ${trozos.length === 1 ? 'parte' : 'partes'}…`, 0);
    // La 1.ª parte va sola: fija el idioma para las demás (Whisper podría cambiarlo parte a parte).
    await transcribirParte(trozos[0], 0);
    idioma = idioma || codigoCorto(resultados[0].idioma);
    const soloPrimera = !elegido && idioma === 'es';   // ya está en español: no se gasta cuota en el resto
    if (!soloPrimera) await enParalelo(trozos.slice(1), PARTES_EN_PARALELO, (trozo, i) => transcribirParte(trozo, i + 1));

    const usados = soloPrimera ? trozos.slice(0, 1) : trozos;
    const segmentos = normalizarSegmentos(unirTranscripciones(usados, resultados.slice(0, usados.length).map((r) => r.segmentos)));
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
      titulo: tituloX(info),
      duracionS: duracion || lista.duracionS,
    };
  }

  async #texto(url, signal) {
    return new TextDecoder().decode(await this.#bytes(url, signal));
  }

  async #bytes(url, signal) {
    for (let intento = 0; ; intento += 1) {
      if (signal?.aborted) throw cancelado();
      try {
        const respuesta = await this.pedirTwimg(url, { signal });
        if (!respuesta.ok) throw new ErrorYoutube(`X no entregó el audio del video (HTTP ${respuesta.status}).`, 'x_red');
        return new Uint8Array(await respuesta.arrayBuffer());
      } catch (error) {
        if (error?.name === 'AbortError' || signal?.aborted) throw cancelado();
        if (intento >= 1) throw error instanceof ErrorYoutube ? error : new ErrorYoutube('Se cortó la descarga del audio de X. Revisa la conexión e intenta de nuevo.', 'x_red');
      }
    }
  }

  async #subir(audio, k, { idioma, apiKey, context, signal }) {
    const formulario = new FormData();
    formulario.append('file', audio, `x_parte_${k + 1}.m4a`);
    formulario.append('language', idioma);
    formulario.append('fast', 'false');   // verbose_json: Whisper entrega start/end por frase
    if (apiKey) formulario.append('api_key', apiKey);
    if (context) formulario.append('context', String(context).slice(0, 4000));
    for (let intento = 0; ; intento += 1) {
      if (signal?.aborted) throw cancelado();
      const respuesta = await this.fetchApi('/transcribe', { method: 'POST', body: formulario, signal }, ESPERA_PARTE_MS);
      const datos = await respuesta.json().catch(() => ({}));
      if (signal?.aborted) throw cancelado();
      if (respuesta.ok) {
        return { segmentos: Array.isArray(datos.segments) ? datos.segments : [], idioma: datos.language || '' };
      }
      const detalle = typeof datos?.detail === 'string' ? datos.detail : '';
      if ((respuesta.status === 429 || RE_LIMITE.test(detalle)) && intento < this.esperasLimiteMs.length) {
        await this.esperar(this.esperasLimiteMs[intento], signal);
        continue;
      }
      throw new ErrorYoutube(detalle || `No se pudo transcribir el audio del video (HTTP ${respuesta.status}).`, 'x_transcripcion', datos);
    }
  }
}
```

- [ ] **Paso 4: ejecutar** — `node tests/test_x_doblaje.mjs` → `64 comprobaciones OK · 0 fallos`
  (45 + 19 de T6).
- [ ] **Paso 5: commit** — `git add js/youtube/servicioX.js tests/test_x_doblaje.mjs && git commit -m "feat(x): transcribir el audio de X por partes con Whisper, sin Referer y cancelable"`

### Tarea 6b (solo si la Tarea 3 lo exige): respaldo directo a FxTwitter desde el navegador

**Cuándo:** si en la Tarea 3 la sindicación no respondió desde Vercel (respaldo) o ninguna fuente
respondió (camino principal). Si la Tarea 3 dio `"fuente": "sindicacion"`, **sáltala** y anótalo.

**Archivos:** `js/youtube/servicioX.js` (función nueva + uso en `info`), `tests/test_x_doblaje.mjs`.

- [ ] **Paso 1: prueba** (añadir a la sección T6):

```js
{
  const fx = JSON.parse(fixture('fxtwitter_1349794411333394432.json'));
  const info = sx.normalizarFxTwitter(fx, 0);
  comprobar(info.autor === 'BrooklynNets' && info.hls.includes('.m3u8') && info.mp4.length === 3, 'FxTwitter en el navegador: misma forma que el servidor');
  const servicio = new sx.ServicioX({
    fetchApi: async () => Response.json({ detail: 'No pudimos consultar X…', code: 'red' }, { status: 503 }),
    pedirFx: async () => Response.json(fx),
  });
  const r = await servicio.info('https://x.com/BrooklynNets/status/1349794411333394432');
  comprobar(r.fuente === 'fxtwitter-navegador', 'si el servidor no alcanza a X, el navegador consulta FxTwitter directo');
}
```

- [ ] **Paso 2: implementar** en `servicioX.js`, en cuatro cambios.

  (a) Import, debajo del import de `./audioX.js`:

```js
import { extraerPostX } from './fuenteVideo.js';
```

  (b) El constructor recibe también `pedirFx` (reemplaza la línea del `constructor` y añade la asignación):

```js
  constructor({
    fetchApi, pedirTwimg = fetchTwimg, esperar = esperarMs, esperasLimiteMs = [20000, 40000],
    pedirFx = (url, opciones = {}) => fetch(url, { credentials: 'omit', signal: opciones.signal }),
  }) {
```

  y después de `this.esperasLimiteMs = esperasLimiteMs;`:

```js
    this.pedirFx = pedirFx;
```

  (c) Justo antes de `export class ServicioX {`:

```js
const esTwimg = (url, host) => { try { const u = new URL(url); return u.protocol === 'https:' && u.hostname === host; } catch { return false; } };

/** Espejo de api/x_video.normalizar_fxtwitter (solo para cuando el servidor no alcanza a X). */
export function normalizarFxTwitter(datos, indice = 0) {
  const post = datos?.tweet;
  const video = post?.media?.videos?.[Math.min(indice, (post?.media?.videos?.length || 1) - 1)];
  if (!video) return null;
  const mp4 = [];
  let hls = '';
  for (const v of video.variants || video.formats || []) {
    if (!esTwimg(v.url, 'video.twimg.com')) continue;
    const tipo = String(v.content_type || v.container || '').toLowerCase();
    if (tipo === 'video/mp4' || tipo === 'mp4') {
      const [, ancho = 0, alto = 0] = v.url.match(/\/(\d{2,5})x(\d{2,5})\//) || [];
      mp4.push({ url: v.url, bitrate: Number(v.bitrate) || 0, ancho: Number(ancho), alto: Number(alto) });
    } else if (tipo.includes('mpegurl') || tipo === 'm3u8') hls = v.url;
  }
  mp4.sort((a, b) => a.bitrate - b.bitrate);
  return {
    id: String(post.id || ''), indice, autor: String(post.author?.screen_name || ''),
    texto: String(post.text || '').replace(/\s*https:\/\/t\.co\/\w+\s*$/, '').trim().slice(0, 280),
    idioma_texto: ['und', 'zxx'].includes(post.lang) ? '' : String(post.lang || ''),
    duracion_s: Math.round((Number(video.duration) || 0) * 1000) / 1000,
    portada: esTwimg(video.thumbnail_url, 'pbs.twimg.com') ? video.thumbnail_url : '',
    mp4, hls,
  };
}
```

  (d) Reemplazar el método `info()` entero por:

```js
  async info(url, { signal = null } = {}) {
    let respuesta = null;
    let datos = {};
    try {
      respuesta = await this.fetchApi(`/x-video?url=${encodeURIComponent(url)}`, { signal }, ESPERA_INFO_MS);
      datos = await respuesta.json().catch(() => ({}));
    } catch (error) {
      if (error?.name === 'AbortError' || signal?.aborted) throw cancelado();
    }
    if (respuesta?.ok) return datos;
    // El servidor no alcanzó a X: el navegador lo intenta directo con FxTwitter (CORS abierto, H8).
    if (!respuesta || datos?.code === 'red' || respuesta.status >= 500) {
      const post = extraerPostX(url);
      if (post) {
        try {
          const r = await this.pedirFx(`https://api.fxtwitter.com/status/${post.id}`, { signal });
          const info = r.ok ? normalizarFxTwitter(await r.json(), post.indice) : null;
          if (info && (info.hls || info.mp4.length)) return { ...info, fuente: 'fxtwitter-navegador' };
        } catch (error) {
          if (error?.name === 'AbortError' || signal?.aborted) throw cancelado();
        }
      }
    }
    throw new ErrorYoutube(
      typeof datos?.detail === 'string' ? datos.detail : 'No se pudo leer el post de X.',
      `x_${datos?.code || 'servidor'}`, datos,
    );
  }
```

- [ ] **Paso 3:** `node tests/test_x_doblaje.mjs` → `66 comprobaciones OK · 0 fallos` (64 + 2). La
  prueba de «info(): el motivo del servidor llega tal cual» (GIF, 422) debe seguir pasando: un error
  definitivo del servidor **no** dispara el respaldo. **Commit:** `feat(x): respaldo directo a FxTwitter desde el navegador`.

---

### Tarea 7: reproductor de X — `/x-reproductor.html` + `XVideoPlayer.js`

**Por qué:** el motor de doblaje necesita un reproductor con el contrato de `YouTubePlayer` (tiempo,
velocidad por código, volumen, eventos). El `<video>` no tiene atributo `referrerpolicy`, así que vive en un
documento del mismo origen que declara `no-referrer` (H3, medido: así carga, cambia de velocidad y salta).

**Archivos:**
- Crear: `x-reproductor.html` (raíz del repo, junto a `index.html`)
- Crear: `js/youtube/XVideoPlayer.js`
- Modificar: `vercel.json` (bloque `headers`)
- Modificar: `tests/test_x_doblaje.mjs` (sección T7: solo lo puro; el resto lo prueba T10 en navegador)

**Interfaces:**
- Consume: nada de las tareas anteriores.
- Produce: `estadoDeVideo(video, {arranco}) -> 'unstarted'|'ended'|'paused'|'buffering'|'playing'` y
  `class XVideoPlayer` con **exactamente** estos métodos (los que usan `dubbingEngine.js`, `syncEngine.js`
  y el controlador; verificado con `grep -o "player\.[a-zA-Z]*"`):
  `constructor(elemento: string|HTMLElement, {mp4, portada, titulo})`, `inicializar(): Promise<this>`,
  `getCurrentTime()`, `getDuration()`, `getVideoData() -> {title}`, `getPlaybackRate()`,
  `getAvailablePlaybackRates()`, `setPlaybackRate(v)`, `playVideo()`, `pauseVideo()`, `seekTo(s)`,
  `getPlayerState() -> -1|0|1|2|3` (números de YouTube: el motor compara con `=== 1`), `getVolume()`,
  `setVolume(0..100)`, `mute()`, `unMute()`, `isMuted()`, `ocultarSubtitulosDeYouTube()` (no hace nada),
  `suscribirEstado(fn) -> desuscribir`, `suscribirVelocidad(fn) -> desuscribir`, `destruir()`.

- [ ] **Paso 1: prueba de lo puro** (sección T7):

```js
// ── T7: estado del <video> con los nombres del contrato de YouTube ────────
const xp = await modulo('XVideoPlayer.js');
{
  comprobar(xp.estadoDeVideo({ ended: true, paused: true, readyState: 4 }) === 'ended', 'terminado → ended');
  comprobar(xp.estadoDeVideo({ ended: false, paused: true, readyState: 4 }) === 'unstarted', 'pausado sin haber arrancado → unstarted');
  comprobar(xp.estadoDeVideo({ ended: false, paused: true, readyState: 4 }, { arranco: true }) === 'paused', 'pausado tras arrancar → paused');
  comprobar(xp.estadoDeVideo({ ended: false, paused: false, readyState: 2 }) === 'buffering', 'sin datos suficientes → buffering');
  comprobar(xp.estadoDeVideo({ ended: false, paused: false, readyState: 4 }) === 'playing', 'reproduciendo → playing');
  comprobar(xp.CODIGO_ESTADO.playing === 1 && xp.CODIGO_ESTADO.paused === 2, 'códigos numéricos iguales a los de YouTube');
}
```

- [ ] **Paso 2:** `node tests/test_x_doblaje.mjs` → falla con `ERR_MODULE_NOT_FOUND … XVideoPlayer.js`.

- [ ] **Paso 3: crear `x-reproductor.html`**

```html
<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<!-- video.twimg.com responde 403 si la petición trae Referer de otro dominio
     (medido 2026-09-27). <video> no tiene atributo referrerpolicy: por eso el
     video de X vive en este documento, que no manda Referer. Lo maneja
     js/youtube/XVideoPlayer.js desde la página (mismo origen). No lo borres. -->
<meta name="referrer" content="no-referrer">
<meta name="robots" content="noindex">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Reproductor de X · JG Turbo</title>
<style>
  html, body { margin: 0; height: 100%; background: #000; }
  video { display: block; width: 100%; height: 100%; object-fit: contain; background: #000; }
</style>
</head>
<body>
<video playsinline controls preload="metadata" controlslist="nofullscreen noremoteplayback nodownload" disablepictureinpicture></video>
</body>
</html>
```

(`nofullscreen`: la pantalla completa la pone la app sobre `.yt-player-shell` para que el subtítulo se
vea encima; igual que `fs: 0` en YouTube.)

- [ ] **Paso 4: cabecera en `vercel.json`** (añadir como un elemento más del arreglo `headers`):

```json
    {
      "source": "/x-reproductor.html",
      "headers": [
        { "key": "Referrer-Policy", "value": "no-referrer" }
      ]
    }
```

- [ ] **Paso 5: crear `js/youtube/XVideoPlayer.js`**

```js
/**
 * Reproductor de videos de X con el mismo contrato que YouTubePlayer, para que el
 * doblaje (dubbingEngine, syncEngine) no sepa de qué plataforma es el video.
 *
 * El <video> vive en /x-reproductor.html (mismo origen, sin Referer): X responde
 * 403 a peticiones con Referer de otro dominio. Al ser del mismo origen, esta
 * clase maneja ese <video> directamente y recibe sus eventos.
 */
const VELOCIDADES = Object.freeze([0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2]);
export const CODIGO_ESTADO = Object.freeze({ unstarted: -1, ended: 0, playing: 1, paused: 2, buffering: 3 });
const ESPERA_METADATOS_MS = 15000;

export function estadoDeVideo(video, { arranco = false } = {}) {
  if (!video) return 'unstarted';
  if (video.ended) return 'ended';
  if (video.paused) return arranco ? 'paused' : 'unstarted';
  return video.readyState < 3 ? 'buffering' : 'playing';
}

export class XVideoPlayer {
  constructor(elemento, { mp4 = '', portada = '', titulo = '' } = {}) {
    this.destino = typeof elemento === 'string' ? document.getElementById(elemento) : elemento;
    this.mp4 = mp4;
    this.portada = portada;
    this.titulo = titulo;
    this.marco = null;
    this.video = null;
    this.arranco = false;
    this.estadoListeners = new Set();
    this.velocidadListeners = new Set();
    this.quitarEventos = [];
  }

  async inicializar() {
    if (!this.destino) throw new Error('No hay dónde poner el reproductor de X.');
    const marco = document.createElement('iframe');
    marco.id = this.destino.id || 'ytPlayer';
    marco.title = this.titulo ? `Video de X: ${this.titulo}` : 'Video de X';
    marco.setAttribute('allow', 'autoplay; fullscreen; picture-in-picture');
    marco.setAttribute('referrerpolicy', 'no-referrer');
    const cargado = new Promise((resolver) => marco.addEventListener('load', resolver, { once: true }));
    marco.src = '/x-reproductor.html';
    this.destino.replaceWith(marco);
    this.marco = marco;
    await cargado;
    const video = marco.contentDocument?.querySelector('video');
    if (!video) throw new Error('No se pudo preparar el reproductor de X.');
    this.video = video;

    const avisar = (estado) => this.estadoListeners.forEach((fn) => fn(estado));
    const escuchar = (evento, fn) => {
      video.addEventListener(evento, fn);
      this.quitarEventos.push(() => video.removeEventListener(evento, fn));
    };
    escuchar('playing', () => { this.arranco = true; avisar('playing'); });
    escuchar('pause', () => avisar(video.ended ? 'ended' : 'paused'));
    escuchar('waiting', () => avisar('buffering'));
    escuchar('ended', () => avisar('ended'));
    escuchar('ratechange', () => this.velocidadListeners.forEach((fn) => fn(this.getPlaybackRate())));

    await new Promise((resolver, rechazar) => {
      const limpiar = () => { clearTimeout(tope); video.removeEventListener('loadedmetadata', listo); video.removeEventListener('error', fallo); };
      const listo = () => { limpiar(); resolver(); };
      const fallo = () => { limpiar(); rechazar(new Error('X no dejó reproducir este video aquí. Prueba de nuevo o ábrelo en x.com.')); };
      const tope = setTimeout(() => { limpiar(); resolver(); }, ESPERA_METADATOS_MS);   // lento ≠ roto: se sigue
      video.addEventListener('loadedmetadata', listo);
      video.addEventListener('error', fallo);
      if (this.portada) video.poster = this.portada;
      video.src = this.mp4;
    });
    return this;
  }

  getCurrentTime() { return Number(this.video?.currentTime || 0); }
  getDuration() { const d = Number(this.video?.duration); return Number.isFinite(d) ? d : 0; }
  getVideoData() { return { title: this.titulo }; }
  getPlaybackRate() { return Number(this.video?.playbackRate || 1); }
  getAvailablePlaybackRates() { return [...VELOCIDADES]; }
  setPlaybackRate(velocidad) {
    const v = Math.max(0.25, Math.min(2, Number(velocidad) || 1));
    if (this.video) this.video.playbackRate = v;
  }
  playVideo() {
    const intento = this.video?.play?.();
    // Si el navegador exige un toque, el estado queda en pausa y la app muestra «Ver con voz en español».
    intento?.catch?.(() => this.estadoListeners.forEach((fn) => fn('paused')));
  }
  pauseVideo() { this.video?.pause?.(); }
  seekTo(segundos) { if (this.video) this.video.currentTime = Math.max(0, Number(segundos) || 0); }
  getPlayerState() { return CODIGO_ESTADO[estadoDeVideo(this.video, { arranco: this.arranco })]; }
  getVolume() { return Math.round(Number(this.video?.volume ?? 1) * 100); }
  setVolume(valor) {
    const numero = Math.max(0, Math.min(100, Number(valor)));
    if (this.video && Number.isFinite(numero)) this.video.volume = numero / 100;   // iPhone lo ignora: ahí se silencia
  }
  mute() { if (this.video) this.video.muted = true; }
  unMute() { if (this.video) this.video.muted = false; }
  isMuted() { return Boolean(this.video?.muted); }
  ocultarSubtitulosDeYouTube() { /* X no pinta subtítulos propios encima */ }
  suscribirEstado(fn) { this.estadoListeners.add(fn); return () => this.estadoListeners.delete(fn); }
  suscribirVelocidad(fn) { this.velocidadListeners.add(fn); return () => this.velocidadListeners.delete(fn); }

  destruir() {
    this.estadoListeners.clear();
    this.velocidadListeners.clear();
    this.quitarEventos.forEach((quitar) => quitar());
    this.quitarEventos = [];
    if (this.video) {
      this.video.pause();
      this.video.removeAttribute('src');
      this.video.load();   // suelta la conexión: si no, el navegador sigue bajando el MP4
    }
    this.marco?.remove();
    this.video = null;
    this.marco = null;
  }
}
```

- [ ] **Paso 6:** `node tests/test_x_doblaje.mjs` → `70 comprobaciones OK · 0 fallos` (64 + 6; 72 si
  hiciste la 6b).
- [ ] **Paso 7: commit** — `git add x-reproductor.html js/youtube/XVideoPlayer.js vercel.json tests/test_x_doblaje.mjs && git commit -m "feat(x): reproductor de X con el contrato de YouTubePlayer y sin Referer"`

---

## Fase 3 · Integración

### Tarea 8: extraer `abrirSesion` y `completarSesion` del controlador (sin cambiar conducta)

**Por qué:** el camino de X necesita lo mismo que YouTube al abrir una sesión y al terminar de decidir el
idioma. Extraerlo evita copiar 40 líneas y deja YouTube **idéntico**. Esta tarea no añade nada de X: si una
prueba de YouTube cambia su número, la extracción está mal.

**Archivos:** Modificar `js/youtube/youtubeSyncController.js` (dentro de `iniciarSesion`, ≈ líneas 673–789).

**Interfaces (internas del controlador):**
- `abrirSesion(clave: string) -> actual` (objeto de sesión con `controlador`, `videoId: clave`).
- `async completarSesion(actual, { decision, datos, tituloVideo, duracionS, guardado, sirve })` — hace lo
  que hoy hacen las líneas desde `actual.registro = {` hasta el `await prepararDoblaje(...)` inclusive.

- [ ] **Paso 1: implementar la extracción.** Mover a `abrirSesion(videoId)` exactamente estas líneas de
  `iniciarSesion` (≈ 677–691) y devolver `actual`:

```js
  /** Lo común al abrir cualquier video (YouTube o X): corta la sesión anterior y prepara la vista. */
  function abrirSesion(videoId) {
    terminarSesion({ restaurarFormulario: false });
    const controlador = new AbortController();
    const actual = { controlador, videoId };
    sesion = actual;
    marcarOcupado(true);
    ui.area.hidden = false;
    document.querySelector('.yt-area')?.classList.add('has-results', 'modo-doblaje');
    progreso.iniciar();
    ui.area.scrollIntoView({ block: 'start', behavior: 'smooth' });
    audiosEntregados = 0;
    desbloquearAudio();
    // La primera síntesis paga el arranque del servicio de voz (2-4 s medidos):
    // se paga ahora, mientras se lee el video, y no cuando la persona espera oírla.
    Promise.resolve().then(() => fetchApi('/tts-warmup', { signal: controlador.signal }, 15000)).catch(() => {});
    return actual;
  }

  /** Lo común con el idioma ya decidido: caché del video, «retomar donde ibas» y preparación. */
  async function completarSesion(actual, { decision, datos, tituloVideo, duracionS, guardado, sirve }) {
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
    if (sirve && 15 < guardado.posicionS && guardado.posicionS < duracionS - 30) {
      actual.retomarEn = guardado.posicionS;
      ui.estado.textContent = `Retomamos donde ibas (${formatoTiempo(actual.retomarEn)}).`;
      $('ytDesdeInicio').hidden = false;
    }
    await prepararDoblaje(actual, {
      datos, origen: decision.idioma, tituloVideo, signal,
      traduccionesGuardadas: actual.registro.traducciones,
    });
  }
```

  En `iniciarSesion`, las líneas movidas se reemplazan por:

```js
    const actual = abrirSesion(videoId);
    const { signal } = actual.controlador;
```

  y el bloque desde `actual.registro = {` hasta el `await prepararDoblaje(…);` por:

```js
      await completarSesion(actual, { decision, datos, tituloVideo, duracionS, guardado, sirve });
```

  (Las líneas de `mostrarIdioma`, `await promesaPlayer`, título y duración que van **antes** se quedan
  donde están.)

- [ ] **Paso 2: verificar que YouTube no cambió**

```bash
node tests/test_youtube_doblaje.mjs | tail -1
node tests/test_youtube_sincronia.mjs | tail -1
node tests/verificar_youtube_doblaje.mjs | tail -3
```
  Esperado: **los mismos números de la línea base del paso 0**, 0 fallos.

- [ ] **Paso 3: commit** — `git commit -am "refactor(youtube): abrirSesion y completarSesion reutilizables (sin cambio de conducta)"`

---

### Tarea 9: camino de X en el controlador + textos del panel

**Archivos:**
- Modificar: `js/youtube/youtubeSyncController.js`
- Modificar: `index.html` (panel YouTube ≈ líneas 6484–6526 y CSS junto a `.yt-player-shell`, ≈ línea 1432)

**Interfaces:**
- Consume: `detectarFuente` (T4), `ServicioX`, `tituloX` (T6), `elegirMp4` (T5), `XVideoPlayer` (T7),
  `abrirSesion`/`completarSesion` (T8), `ErrorYoutube` (existente).
- Produce: con un enlace de X el botón «Doblar al español» se habilita y el flujo completo funciona; el
  elemento `#ytUrlNota` explica qué hacer con un enlace de X.

- [ ] **Paso 1: imports** (junto a los existentes, al inicio del controlador):

```js
import { TranscriptionService, ErrorYoutube } from './transcriptionService.js';
import { detectarFuente } from './fuenteVideo.js';
import { ServicioX, tituloX } from './servicioX.js';
import { elegirMp4 } from './audioX.js';
import { XVideoPlayer } from './XVideoPlayer.js';
```

  (La primera línea reemplaza a la actual `import { TranscriptionService, extraerVideoId } from …`:
  tras los pasos 2 y 5, `extraerVideoId` ya no se usa en el controlador. Compruébalo con
  `grep -n extraerVideoId js/youtube/youtubeSyncController.js`, que debe salir vacío.)

- [ ] **Paso 2: servicio y botón.** Junto a `const transcripciones = new TranscriptionService({ fetchApi });`:

```js
  const servicioX = new ServicioX({ fetchApi });
```

  En `actualizarBoton()`, cambiar `!extraerVideoId(ui.url.value)` por `!detectarFuente(ui.url.value)`.
  Añadir debajo de `ui.url.addEventListener('input', actualizarBoton);`:

```js
  // Un enlace de X no sirve para «Solo el texto» (ese camino es de YouTube): se explica, no se esconde.
  const notaUrl = $('ytUrlNota');
  const pintarNotaUrl = () => {
    if (!notaUrl) return;
    notaUrl.hidden = detectarFuente(ui.url.value)?.plataforma !== 'x';
  };
  ui.url.addEventListener('input', pintarNotaUrl);
  pintarNotaUrl();
```

- [ ] **Paso 3: reproductor de X** (junto a `crearReproductor`):

```js
  async function crearReproductorX(info, signal) {
    recrearDestino();
    const mp4 = elegirMp4(info.mp4, { ahorroDatos: Boolean(navigator.connection?.saveData) });
    if (!mp4) throw new ErrorYoutube('Este post de X no trae un video que el navegador pueda reproducir.', 'x_sin_video');
    const player = new XVideoPlayer('ytPlayer', { mp4: mp4.url, portada: info.portada || '', titulo: tituloX(info) });
    // A diferencia de YouTube, un fallo de carga sí se informa: sin video no hay qué doblar.
    await Promise.race([player.inicializar(), new Promise((r) => setTimeout(r, ESPERA_REPRODUCTOR_MS))]);
    if (signal.aborted) { player.destruir(); throw cancelado(); }
    return player;
  }
```

- [ ] **Paso 4: la sesión de X** (función nueva, después de `iniciarSesion`):

```js
  async function iniciarSesionX(url, fuente) {
    const actual = abrirSesion(fuente.clave);
    const { signal } = actual.controlador;
    try {
      progreso.paso('leer', 'Buscando el video en X…');
      const info = await servicioX.info(url, { signal });
      if (signal.aborted) throw cancelado();
      const tituloVideo = tituloX(info);
      ui.titulo.textContent = tituloVideo;
      const promesaPlayer = crearReproductorX(info, signal).then((player) => {
        if (sesion === actual) actual.player = player; else player.destruir();
        return player;
      });
      promesaPlayer.catch(() => {});   // un fallo se atiende abajo, al esperarlo

      const guardado = await leerDoblaje(fuente.clave);
      const elegidoEnFormulario = ui.idioma?.value || 'auto';
      const sirve = Boolean(guardado?.segmentos?.length)
        && (elegidoEnFormulario === 'auto' || elegidoEnFormulario === guardado.idiomaOrigen);
      const transcribir = (idiomaOrigen) => servicioX.obtenerParaDoblaje(info, {
        idiomaOrigen, signal,
        apiKey: leer('jg_groq_api_key') || '',
        context: leer('jg_glossary') || '',
        onProgress: (mensaje, fraccion) => { progreso.mensaje(mensaje); progreso.barra(fraccion ?? null); },
      });
      let datos;
      let decision;
      if (sirve) {
        datos = { segmentos: guardado.segmentos, idioma: guardado.idiomaOrigen, confianza: 1, fuente: 'usuario', conflicto: false };
        decision = { accion: 'doblar', idioma: guardado.idiomaOrigen, mensaje: '' };
      } else {
        progreso.ayuda('X no trae subtítulos: escuchamos el audio del video para sacar el texto (gratis). Mientras tanto puedes darle play.');
        datos = await transcribir(elegidoEnFormulario);
        decision = decidirDoblaje(datos);
        if (decision.accion === 'preguntar' || decision.accion === 'no_soportado') {
          progreso.mensaje('Confirma el idioma del video para seguir.');
          const elegido = await elegirIdioma(decision, signal);
          if (!elegido) { terminarSesion(); return; }
          if (elegido !== datos.idioma) datos = await transcribir(elegido);
          decision = { accion: 'doblar', idioma: elegido, mensaje: '' };
        }
      }
      if (decision.accion === 'sin_doblaje') {
        mostrarIdioma('El video ya está en español', 'ok');
        progreso.error(decision.mensaje);
        return;
      }
      mostrarIdioma(`Idioma del video: ${nombreIdioma(decision.idioma)}`, 'ok');
      actual.player = await promesaPlayer;
      if (signal.aborted) throw cancelado();
      const duracionS = actual.player.getDuration() || Number(info.duracion_s) || datos.duracionS || 0;
      await completarSesion(actual, { decision, datos, tituloVideo, duracionS, guardado, sirve });
    } catch (error) {
      if (signal.aborted || error?.name === 'AbortError') return;
      mostrarIdioma('No se pudo preparar el doblaje', 'no');
      progreso.error(textoDeError(error));
    } finally {
      if (sesion === actual) marcarOcupado(false);
    }
  }
```

- [ ] **Paso 5: desviar a X al pulsar.** Al inicio de `iniciarSesion()`, reemplazar:

```js
    const url = ui.url.value.trim();
    const videoId = extraerVideoId(url);
    if (!videoId || !estaServidorOnline()) return;
```

  por:

```js
    const url = ui.url.value.trim();
    const fuente = detectarFuente(url);
    if (!fuente || !estaServidorOnline()) return;
    if (fuente.plataforma === 'x') return iniciarSesionX(url, fuente);
    const videoId = fuente.id;
```

- [ ] **Paso 6: textos del panel en `index.html`** (antes, la comprobación de trabajo concurrente de la
  restricción 13):

  - `<h2>Mira videos de YouTube en español</h2>` → `<h2>Mira videos de YouTube y X en español</h2>`
  - En el `<p>` siguiente: «Pega el enlace y pulsa…» → «Pega el enlace de YouTube o de X (Twitter) y pulsa…»
    (el resto de la frase igual).
  - Aviso `#ytServerWarn`: «para usar YouTube.» → «para usar YouTube y X.»
  - El `<input id="ytUrl">`: `placeholder="https://youtube.com/watch?v=… o https://x.com/…/status/…"` y
    `name="enlace_video"` (el `id` NO cambia: lo usan el controlador y las pruebas).
  - Justo después del `</label>` que envuelve `#ytUrl`, dentro de `.ytrow`:

```html
          <p class="yt-url-nota" id="ytUrlNota" hidden>Enlace de X: pulsa <b>Doblar al español</b>. El texto completo traducido sale después con el botón <b>Texto completo</b>.</p>
```

  - CSS (junto a `.yt-player-shell`, ≈ línea 1432):

```css
  .yt-area .yt-url-nota{margin:6px 0 0;font-size:13px;line-height:1.45;color:var(--muted-2)}
```

- [ ] **Paso 7: verificar a mano en local** (sin simular nada): `python -m http.server 8765` en la raíz,
  abrir `http://localhost:8765/?tab=yt`, pegar `https://x.com/BrooklynNets/status/1349794411333394432` y
  comprobar que el botón se habilita y la nota aparece; pegar `https://x.com/home` → botón deshabilitado y
  sin nota. (Local no tiene API: el flujo completo se prueba en T10 con la API simulada.)

- [ ] **Paso 8: verificar que YouTube no cambió** — los tres comandos del paso 2 de la Tarea 8 y
  `node tests/verificar_arranque_ligero.mjs` → mismos números de la línea base.

- [ ] **Paso 9: commit** — `git add js/youtube/youtubeSyncController.js index.html && git commit -m "feat(x): doblar videos de X desde el mismo panel de YouTube"`

---

### Tarea 10: prueba de punta a punta en navegador — `tests/verificar_x_doblaje.mjs`

**Por qué:** las unitarias no ven el Referer real, el iframe, el `<video>` ni la cancelación de la
interfaz. Todo simulado (sin red ni créditos), igual que `verificar_youtube_doblaje.mjs`.

**Archivos:**
- Crear: `tests/fixtures/x/video_prueba.webm` (con ffmpeg; Playwright usa Chromium, que **no** reproduce
  H.264, por eso WebM)
- Crear: `tests/verificar_x_doblaje.mjs`

- [ ] **Paso 1: fabricar el video de prueba** (120 s de color plano con un tono; ~230 KB):

```bash
ffmpeg -hide_banner -loglevel error -y -f lavfi -i color=c=0x223344:size=160x90:rate=5 -f lavfi -i sine=frequency=440:sample_rate=48000 -t 120 -c:v libvpx -b:v 12k -c:a libopus -b:a 12k tests/fixtures/x/video_prueba.webm
ls -l tests/fixtures/x/video_prueba.webm
```
  Esperado: unos 230 KB. (Con `testsrc` en vez de `color` salió de 1,2 MB: no vale la pena en el repo.)

- [ ] **Paso 2: escribir la prueba** — crear `tests/verificar_x_doblaje.mjs` con este contenido (validado:
  24 OK sobre una copia con las Tareas 1–9 aplicadas; y **falla** si se quita el `no-referrer`):

```js
/* JG Turbo · Doblaje de videos de X de punta a punta, SIN red ni créditos.
 *
 * /x-video, video.twimg.com (listas HLS, trozos de audio y el MP4), /transcribe,
 * /translate y /tts se responden desde aquí. El «MP4» es un WebM de 120 s: el
 * Chromium de Playwright no reproduce H.264. Mide lo que vive la persona: que
 * ninguna petición a X lleve Referer (X responde 403), que el audio viaje en
 * partes pequeñas, que el video se vea y avance con la voz, que cancelar pare
 * de verdad y que los errores se lean.
 *
 *   node tests/verificar_x_doblaje.mjs
 *   node tests/verificar_x_doblaje.mjs --headed
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

const WEBM = await readFile(join(app, 'tests/fixtures/x/video_prueba.webm'));
const URL_X = 'https://x.com/BrooklynNets/status/1349794411333394432';
const TROZOS = 250;   // 750 s de audio → 3 partes
const MAESTRA = '#EXTM3U\n#EXT-X-MEDIA:NAME="Audio",TYPE=AUDIO,GROUP-ID="audio-64000",URI="/v/pl/mp4a/64000/a.m3u8"\n';
const LISTA = ['#EXTM3U', '#EXT-X-MAP:URI="/v/aud/init.mp4"',
  ...Array.from({ length: TROZOS }, (_, i) => `#EXTINF:3.000,\n/v/aud/${i}.m4s`), '#EXT-X-ENDLIST'].join('\n');
const infoX = (extra = {}) => ({
  id: '1349794411333394432', indice: 0, autor: 'BrooklynNets', texto: 'WATCH: prueba', idioma_texto: 'en',
  duracion_s: TROZOS * 3, portada: '', fuente: 'sindicacion',
  hls: 'https://video.twimg.com/v/pl/master.m3u8',
  mp4: [{ url: 'https://video.twimg.com/v/vid/640x360/prueba.mp4', bitrate: 832000, ancho: 640, alto: 360 }],
  ...extra,
});

/** WAV de silencio con la duración pedida (el motor usa audio.duration). */
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

/**
 * Página con todo simulado. `escenario`:
 *  info: { status, json } de /x-video · retrasoTranscribeMs · movil: viewport de teléfono
 */
async function abrir(navegador, escenario = {}) {
  const contexto = escenario.movil
    ? await navegador.newContext({ ...devices['Pixel 7'] })
    : await navegador.newContext({ viewport: { width: 1280, height: 800 } });
  const pagina = await contexto.newPage();
  const reg = { twimg: 0, listas: 0, conReferer: [], subidas: [], tts: 0, errores: [] };
  pagina.on('pageerror', (e) => reg.errores.push(String(e).slice(0, 200)));
  const responder = (r, datos) => r.fulfill(datos).catch(() => { /* la página ya abortó: correcto al cancelar */ });
  await pagina.route(/\/(health|session-config|ping|glossary|tts-voices|tts-warmup)(\?|$)/, (r) => {
    const u = r.request().url();
    if (u.includes('/health')) return responder(r, { json: { status: 'ok', server: 'vercel', model: 'whisper-large-v3', model_state: 'listo', model_ready: true, ai_configured: true, groq_configured: true, ia_configured: true, youtube_auto: true, x_video: true, tts_azure: true, tts_fish: false } });
    if (u.includes('/session-config')) return responder(r, { json: { token: 'vercel-bypass', ai_provider: 'mistral', ai_configured: true, groq_configured: true, ia_configured: true, limits: {} } });
    return responder(r, { json: {} });
  });
  await pagina.route(/\/translate(\?|$)/, async (r) => {
    const cuerpo = JSON.parse(r.request().postData() || '{}');
    const piezas = [...String(cuerpo.text || '').matchAll(/\[\[JG_SEG_(\d{6})\]\]\n([^\[]*)/g)];
    await esperar(150);
    const text = piezas.length
      ? piezas.map((m) => `[[JG_SEG_${m[1]}]]\nES ${m[2].trim()}`).join('\n\n')
      : `ES ${cuerpo.text}`;
    await responder(r, { json: { text, ia_used: true, provider: 'mistral', validation: { status: 'ok', integrity_score: 100 } } });
  });
  await pagina.route(/\/tts(\?|$)/, async (r) => {
    const req = r.request();
    const datos = req.method() === 'GET' ? Object.fromEntries(new URL(req.url()).searchParams) : JSON.parse(req.postData() || '{}');
    reg.tts += 1;
    await esperar(120);
    await responder(r, {
      status: 200, contentType: 'audio/wav',
      headers: { 'X-TTS-Engine': 'azure-neural-regional', 'X-TTS-Voice': 'es-CO-SalomeNeural', 'X-TTS-Fallback': '0' },
      body: wavSilencio(Math.max(0.6, String(datos.text || '').length / 16)),
    });
  });
  await pagina.route('https://video.twimg.com/**', async (r) => {
    const pedido = r.request();
    const u = pedido.url();
    reg.twimg += 1;
    if (pedido.headers().referer) reg.conReferer.push(u);
    const cors = { 'access-control-allow-origin': '*' };
    if (u.endsWith('.m3u8')) {
      reg.listas += 1;
      return responder(r, { status: 200, contentType: 'application/vnd.apple.mpegurl', body: u.endsWith('master.m3u8') ? MAESTRA : LISTA, headers: cors });
    }
    if (u.includes('/vid/')) return responder(r, { status: 200, contentType: 'video/webm', body: WEBM });
    return responder(r, { status: 200, contentType: 'video/mp4', body: Buffer.alloc(u.endsWith('init.mp4') ? 800 : 24000), headers: cors });
  });
  await pagina.route(/\/x-video(\?|$)/, (r) => {
    const { status = 200, json = infoX() } = escenario.info || {};
    return responder(r, { status, json });
  });
  await pagina.route(/\/transcribe(\?|$)/, async (r) => {
    const n = reg.subidas.length;
    reg.subidas.push(r.request().postDataBuffer()?.length || 0);
    await esperar(escenario.retrasoTranscribeMs ?? 300);
    const segments = Array.from({ length: 30 }, (_, i) => ({ start: 8 + i * 11, end: 12 + i * 11, text: `Sentence number ${i + 1} of part ${n + 1}.` }));
    await responder(r, { json: { text: 'x', language: 'en', segments } });
  });
  await pagina.goto(`${base}/?tab=yt`, { waitUntil: 'domcontentloaded' });
  await pagina.waitForSelector('#ytUrl', { state: 'attached' });
  return { contexto, pagina, reg };
}

async function pegarEnlace(pagina, url = URL_X) {
  await pagina.fill('#ytUrl', url);
  await pagina.waitForFunction(() => !document.getElementById('ytSyncBtn').disabled, null, { timeout: 10000 }).catch(() => {});
}
const listo = (pagina) => pagina.evaluate(() => {
  const r = document.getElementById('ytDubReproducir');
  if (r && !r.hidden && !r.disabled) return true;
  const b = document.getElementById('ytDubbingBtn');
  return Boolean(b && !b.disabled);
});
/** Espera a que el doblaje esté listo; de paso anota los mensajes de progreso vistos. */
async function esperarListo(pagina, ms = 30000, mensajes = []) {
  const fin = Date.now() + ms;
  while (Date.now() < fin) {
    mensajes.push(await pagina.textContent('#ytDubMensaje').catch(() => ''));
    if (await listo(pagina)) return true;
    await esperar(100);
  }
  return false;
}
const tiempoVideo = (pagina) => pagina.evaluate(() => {
  const v = document.getElementById('ytPlayer')?.contentDocument?.querySelector('video');
  return v ? v.currentTime : -1;
});
async function esperarMensaje(pagina, patron, ms = 15000) {
  const fin = Date.now() + ms;
  while (Date.now() < fin) {
    const texto = await pagina.textContent('#ytDubMensaje').catch(() => '');
    if (patron.test(texto)) return texto;
    await esperar(100);
  }
  return await pagina.textContent('#ytDubMensaje').catch(() => '');
}

const navegador = await chromium.launch({ headless: !process.argv.includes('--headed') });
try {
  console.log('\n── Enlaces: YouTube y X en el mismo campo ─────────────────────');
  {
    const { contexto, pagina } = await abrir(navegador);
    await pegarEnlace(pagina);
    comprobar('con un enlace de X el botón «Doblar al español» se habilita', !(await pagina.isDisabled('#ytSyncBtn')));
    comprobar('y se ve la nota que explica el enlace de X', await pagina.isVisible('#ytUrlNota'));
    await pagina.fill('#ytUrl', 'https://x.com/home');
    await esperar(200);
    comprobar('con x.com/home el botón queda deshabilitado y la nota oculta', (await pagina.isDisabled('#ytSyncBtn')) && !(await pagina.isVisible('#ytUrlNota')));
    await contexto.close();
  }

  console.log('\n── Flujo completo, caché y Referer ────────────────────────────');
  {
    const { contexto, pagina, reg } = await abrir(navegador);
    await pegarEnlace(pagina);
    await pagina.click('#ytSyncBtn');
    const mensajes = [];
    const llego = await esperarListo(pagina, 30000, mensajes);
    comprobar('se ve el avance «Transcribiendo el audio: n de 3 partes»', mensajes.some((m) => /Transcribiendo el audio: \d de 3 partes/.test(m)));
    comprobar('el audio viaja en 3 partes', reg.subidas.length === 3, `${reg.subidas.length}`);
    comprobar('ninguna parte pasa de 3,4 MB (límite de Vercel ~4,5 MB)', reg.subidas.every((b) => b <= 3.4 * 1024 * 1024), reg.subidas.join(', '));
    comprobar('NINGUNA petición a video.twimg.com lleva Referer (X responde 403)', reg.conReferer.length === 0, reg.conReferer.slice(0, 3).join(' · '));
    comprobar('el doblaje queda listo', llego && /Listo/.test(await pagina.textContent('#ytSyncStatus')));
    const rep = await pagina.evaluate(() => {
      const f = document.getElementById('ytPlayer');
      const v = f?.contentDocument?.querySelector('video');
      return { tag: f?.tagName, src: f?.getAttribute('src') || '', dur: v ? v.duration : 0 };
    });
    comprobar('el video vive en el iframe /x-reproductor.html', rep.tag === 'IFRAME' && rep.src.endsWith('/x-reproductor.html'), JSON.stringify(rep));
    comprobar('y cargó (duración conocida)', rep.dur > 100, String(rep.dur));
    comprobar('el título dice de quién es el post', /@BrooklynNets/.test(await pagina.textContent('#ytSyncTitle')));
    const ttsAntes = reg.tts;
    await pagina.click('#ytDubReproducir');
    const t0 = await tiempoVideo(pagina);
    await esperar(3000);
    const t1 = await tiempoVideo(pagina);
    comprobar('«Ver con voz en español» arranca el video y avanza', t1 > t0 + 1, `${t0.toFixed(1)} → ${t1.toFixed(1)} s`);
    comprobar('y se pide la voz en español', reg.tts > ttsAntes || reg.tts > 0, `${reg.tts}`);
    comprobar('el motor de voz vive (jgDoblajeDiagnostico)', await pagina.evaluate(() => Boolean(window.jgDoblajeDiagnostico && window.jgDoblajeDiagnostico())));
    comprobar('sin errores de JavaScript', reg.errores.length === 0, reg.errores.join(' | '));

    // Reabrir el mismo post: sale de la caché, sin volver a transcribir
    await pagina.click('#btnYtSyncClose');
    await pegarEnlace(pagina);
    await pagina.click('#ytSyncBtn');
    const otraVez = await esperarListo(pagina, 20000);
    comprobar('reabrir el mismo post queda listo', otraVez);
    comprobar('y no vuelve a transcribir (caché x:<id>)', reg.subidas.length === 3, `${reg.subidas.length}`);
    await contexto.close();
  }

  console.log('\n── Cancelar a mitad de la transcripción ───────────────────────');
  {
    const { contexto, pagina, reg } = await abrir(navegador, { retrasoTranscribeMs: 3000 });
    await pegarEnlace(pagina);
    await pagina.click('#ytSyncBtn');
    const fin = Date.now() + 15000;
    while (reg.subidas.length < 1 && Date.now() < fin) await esperar(50);
    await pagina.click('#ytDubCancelar');
    await esperar(5000);
    comprobar('tras cancelar no se sube ni una parte más', reg.subidas.length === 1, `${reg.subidas.length}`);
    comprobar('y el formulario vuelve', await pagina.evaluate(() => document.getElementById('ytSyncArea').hidden));
    await contexto.close();
  }

  console.log('\n── Errores que se leen ────────────────────────────────────────');
  {
    const casos = [
      ['post privado o borrado', { status: 404, json: { detail: 'Ese post de X no existe, es privado o tiene restricción de edad.', code: 'no_disponible' } }, /no existe, es privado/],
      ['un GIF', { status: 422, json: { detail: 'Ese post de X es un GIF: no tiene sonido que doblar.', code: 'gif' } }, /GIF/],
    ];
    for (const [nombre, info, patron] of casos) {
      const { contexto, pagina } = await abrir(navegador, { info });
      await pegarEnlace(pagina);
      await pagina.click('#ytSyncBtn');
      const texto = await esperarMensaje(pagina, patron);
      comprobar(`${nombre}: el motivo se lee y se ofrece «Volver»`, patron.test(texto) && (await pagina.textContent('#ytDubCancelar')).includes('Volver'), texto);
      await contexto.close();
    }
    const { contexto, pagina, reg } = await abrir(navegador, { info: { status: 200, json: infoX({ duracion_s: 7200 }) } });
    await pegarEnlace(pagina);
    await pagina.click('#ytSyncBtn');
    const texto = await esperarMensaje(pagina, /hasta 60 min/);
    comprobar('un video de 2 h se rechaza con el límite a la vista y sin bajar audio', /hasta 60 min/.test(texto) && reg.listas === 0, `${texto} · listas ${reg.listas}`);
    await contexto.close();
  }

  console.log('\n── Teléfono ───────────────────────────────────────────────────');
  {
    const { contexto, pagina } = await abrir(navegador, { movil: true });
    await pegarEnlace(pagina);
    const alto = await pagina.evaluate(() => document.getElementById('ytSyncBtn').getBoundingClientRect().height);
    comprobar('el botón de doblar mide al menos 44 px de alto', alto >= 44, `${alto} px`);
    await pagina.click('#ytSyncBtn');
    await esperarListo(pagina);
    const desborde = await pagina.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    comprobar('sin desborde horizontal con el reproductor de X', desborde <= 0, `${desborde} px`);
    await contexto.close();
  }
} finally {
  await navegador.close();
  servidor.close();
}

console.log(`\n${ok} comprobaciones OK · ${fallos.length} fallos`);
if (fallos.length) { console.log(fallos.map((f) => `   · ${f}`).join('\n')); process.exit(1); }
```

- [ ] **Paso 3: ejecutar** — `node tests/verificar_x_doblaje.mjs`
  Esperado: `24 comprobaciones OK · 0 fallos` (tarda ~1 min). Si alguna falla, arregla **el código**, no
  la prueba (ver `TRAMPAS.md` §2).

- [ ] **Paso 3b: contraprueba obligatoria** (TRAMPAS §1: una prueba en verde puede no probar nada).
  Quita temporalmente `referrerPolicy: 'no-referrer', ` de `fetchTwimg` en `servicioX.js` y la línea
  `<meta name="referrer" …>` de `x-reproductor.html`; corre la prueba: **debe** fallar en «NINGUNA
  petición a video.twimg.com lleva Referer» listando las URLs. Restaura los dos archivos
  (`git checkout -- js/youtube/servicioX.js x-reproductor.html`: son tuyos y ya están commiteados) y
  vuelve a correrla: 24 OK.

- [ ] **Paso 4: regresión completa de YouTube** — los tres comandos de la Tarea 8 paso 2 +
  `node tests/verificar_arranque_ligero.mjs` → mismos números de la línea base.

- [ ] **Paso 5: commit** — `git add tests/verificar_x_doblaje.mjs tests/fixtures/x/video_prueba.webm && git commit -m "test(x): doblaje de X de punta a punta con API y reproductor simulados"`

---

## Fase 4 · Cierre (documentar, desplegar una vez, verificar, empujar)

### Tarea 11: documentación

- [ ] **`CAMBIOS_X.md`** (creado en T3): completar con estas secciones — «Qué hace» (2 párrafos), «Hechos
  medidos» (copiar la tabla H1–H12 de este plan), «Arquitectura» (el diagrama en texto: enlace →
  `/api/x-video` → HLS de audio sin Referer → partes ≤ 3,2 MB → `/api/transcribe` → unión → mismo motor de
  doblaje; video en `/x-reproductor.html`), «Contrato de `/api/x-video`» (forma y códigos de la T1–T2),
  «Límites» (60 min, Groq 20 pet/min, 7 200 s/h), «Pruebas» (comandos y números obtenidos), «Qué hacer si X
  cambia» (síntomas `503 x_red` / `404` en `/api/x-video`; mirar `api/x_video.py` y los registros de Vercel)
  y «Despliegues» (se llena en T12).
- [ ] **`AGENTS.md`:** sección nueva «## X / Twitter (leer antes de tocar `api/x_video.py` o
  `js/youtube/*X*`)» con 6 viñetas: documento maestro `CAMBIOS_X.md`; **video.twimg.com rechaza el Referer
  ajeno** (no quitar `/x-reproductor.html` ni el `referrerPolicy`); el audio se trocea en el navegador en
  partes de ≤ 3,2 MB (no moverlo al servidor); X no usa Supadata (créditos) sino Whisper de Groq; la
  sindicación exige un token cualquiera; la caché usa `x:<id>` en `jg_youtube`. Y en la tabla de
  «Verificación» añadir `node tests/test_x_doblaje.mjs` (unitarias) y la fila de
  `tests/verificar_x_doblaje.mjs` («Obligatoria al tocar el doblaje de X», con su número).
- [ ] **`TRAMPAS.md`:** entrada nueva con el formato del archivo:

```markdown
## video.twimg.com rechaza el Referer de otro dominio

**Síntoma:** el video de X sale negro (error 4, «no supported sources») y la lista HLS da 403 en el
navegador, pero con `curl` todo responde 200/206.

**Causa:** protección anti-hotlink de X. Con `Referer: https://jg-turbo.vercel.app/` responde 403; sin
Referer, o con `https://x.com/`, 206 (medido 2026-09-27). `curl` no manda Referer: por eso engaña.

**Regla:** toda petición a `video.twimg.com` va sin Referer: `fetch(url, { referrerPolicy: 'no-referrer' })`
y el `<video>` dentro de `/x-reproductor.html` (meta `no-referrer`). No sacar el video de ese iframe «para
simplificar». Probar desde el navegador, no con `curl`; `tests/verificar_x_doblaje.mjs` falla si alguna
petición a X lleva Referer.
```

- [ ] **`CONFIG_PERSISTENTE.md`:** en la parte de IndexedDB `jg_youtube`, anotar que los videos de X se
  guardan con clave `x:<id>` (o `x:<id>:<n>`) en el mismo almacén `doblajes`, y que comparten el tope de
  `MAX_VIDEOS = 20`. Sin claves nuevas de `localStorage`.
- [ ] **Commit:** `git add CAMBIOS_X.md AGENTS.md TRAMPAS.md CONFIG_PERSISTENTE.md && git commit -m "docs(x): doblaje de videos de X documentado"`

### Tarea 12: versión, batería completa, vista previa real, producción y push

- [ ] **Paso 1: subir versión una sola vez** — `JG_JS_V` en `index.html` y `CACHE_SHELL` en `sw.js` al
  número siguiente al vigente (si era `v152` → `v153` y `jg-turbo-shell-v153`). Commit:
  `chore: v153 — doblaje de videos de X`.
- [ ] **Paso 2: batería completa en local** (anota cada número; ninguno puede bajar respecto a la línea
  base): las 21 unitarias de `AGENTS.md` §Verificación, `node tests/test_x_doblaje.mjs`,
  `node tests/verificar_x_doblaje.mjs`, `node tests/verificar_youtube_doblaje.mjs`,
  `node tests/verificar_arranque_ligero.mjs`, `node tests/verificar_movil_pantalla.mjs` y
  `python -m pytest backend/tests/test_x_video.py backend/tests/test_supadata_youtube.py backend/tests/test_youtube_idioma_origen.py backend/tests/test_ia_respaldo.py backend/tests/test_api_youtube_bloqueo.py -q`
  (esperado: 74 de la línea base + 35 = **109 passed**; así salió en la validación).
- [ ] **Paso 3: vista previa desde una copia del commit** (mismo procedimiento de la Tarea 3, paso 1) y
  prueba **real** en Chrome de escritorio, con la pestaña visible:
  1. Pegar `https://x.com/BrooklynNets/status/1349794411333394432` → «Doblar al español».
  2. Medir y anotar: segundos hasta «Listo»; que el video se ve; que la voz en español suena; que el
     subtítulo coincide con la voz; que en DevTools → Red ninguna petición a `video.twimg.com` da 403.
  3. En consola: `jgDoblajeDiagnostico()` durante 90 s de reproducción → 0 frases cortadas (mismo criterio
     de `CAMBIOS_YOUTUBE.md` v4).
  4. Un video largo (el de `https://x.com/BretBaier/status/1905393918977393099`, ~31 min) → anotar
     partes, tiempo total hasta «Listo» y que ninguna subida dio 413.
  5. Un video de YouTube cualquiera → sigue funcionando igual.
  6. **En un iPhone real** (lo pide el dueño con la URL de vista previa): el botón «Ver con voz en español»
     arranca el video del iframe con un toque; el original se silencia mientras habla la voz; pasar la app
     a segundo plano 30 s y volver: anotar si el video siguió o se pausó. **[POR CONFIRMAR]** — si el toque
     no arranca el video, detente y avisa al dueño antes de producción: no hay arreglo seguro sin medirlo.
  Anota todo en `CAMBIOS_X.md` §«Medición en vista previa».
- [ ] **Paso 4: producción** — desde una copia exacta del commit (`AGENTS.md` y memoria del proyecto):

```bash
TMP="$(mktemp -d)"
git archive HEAD | tar -x -C "$TMP"
mkdir -p "$TMP/.vercel" && cp .vercel/project.json "$TMP/.vercel/"
cd "$TMP" && npx vercel --prod --yes --scope jhoncod24s-projects
```

- [ ] **Paso 5: verificar contra el dominio real** (no contra la URL que imprime el CLI):

```bash
curl -s "https://jg-turbo.vercel.app/?nocache=$(date +%s)" | grep -o "JG_JS_V = '[^']*'"
curl -s https://jg-turbo.vercel.app/api/health | grep -o '"x_video":true'
curl -s -o /dev/null -w "%{http_code}\n" https://jg-turbo.vercel.app/x-reproductor.html
curl -sI https://jg-turbo.vercel.app/x-reproductor.html | grep -i referrer-policy
curl -s "https://jg-turbo.vercel.app/api/x-video?url=https://x.com/BrooklynNets/status/1349794411333394432" | head -c 300
for f in js/youtube/servicioX.js js/youtube/audioX.js js/youtube/XVideoPlayer.js js/youtube/fuenteVideo.js js/youtube/youtubeSyncController.js x-reproductor.html; do
  a=$(curl -s "https://jg-turbo.vercel.app/$f?nocache=$(date +%s)" | sha256sum | cut -c1-12); b=$(git show "HEAD:$f" | sha256sum | cut -c1-12); echo "$f $a $b"; done
```
  Esperado: `v153`, `"x_video":true`, `200`, `referrer-policy: no-referrer`, JSON con `"hls"`, y los dos
  hashes iguales en cada archivo. Repetir en producción los puntos 1–2 del paso 3.
- [ ] **Paso 6:** anotar el `dpl_…` en `CAMBIOS_X.md` §Despliegues y en la sección X de `AGENTS.md`;
  commit `docs(x): anota dpl de v153`.
- [ ] **Paso 7: empujar** (GitHub no despliega; sin esto producción vive solo en este equipo):

```bash
git switch main && git merge --ff-only feat/x-doblaje && git push origin main
git fetch origin && git log --oneline origin/main..HEAD   # debe salir vacío
```

---

## Criterios de aceptación (para que el dueño verifique el trabajo)

| Fase | Se acepta si… |
|---|---|
| 1 | `pytest backend/tests/test_x_video.py` = 35 passed; T3 anotó desde Vercel `fuente` y código de los 3 posts. |
| 2 | `node tests/test_x_doblaje.mjs` = 70 OK (72 con la 6b), 0 fallos. |
| 3 | `verificar_x_doblaje` = 24 OK y la contraprueba del Referer falla como debe; las pruebas de YouTube con los mismos números de la línea base (139 · 65 · 110); `verificar_arranque_ligero` sin fallos nuevos. |
| 4 | En producción: un post real de X se dobla con voz y subtítulo; ninguna petición 403; `x_video: true`; hashes iguales al commit; `git log origin/main..HEAD` vacío; `CAMBIOS_X.md`, `AGENTS.md` y `TRAMPAS.md` al día. |

## Mejoras que quedan fuera de este plan (para después, en orden de valor)

1. **Arranque progresivo en videos largos:** empezar a doblar cuando esté la 1.ª parte (hoy se espera a
   todas). Exige que `MotorPreparacion` acepte segmentos que llegan después.
2. **Compartir desde la app de X al teléfono:** el `share_target` del manifiesto hoy solo recibe archivos;
   añadir `text`/`url` para que «Compartir → JG Turbo» abra el doblaje con el enlace puesto.
3. **Subtítulos propios de X cuando existan** (H7: son raros): usarlos antes de Whisper para ahorrar cuota.
4. **Renombrar la pestaña** «YouTube» a «Videos» si el dueño lo prefiere (decisión de producto; este plan
   no la toca).
