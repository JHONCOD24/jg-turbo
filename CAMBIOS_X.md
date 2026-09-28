# Doblaje de videos de X

Estado: **en producción** desde el 2026-09-27 (`v153`,
`dpl_Er2mhf2iaRKaFabPwL9SVRQnxqyc`). Documento maestro del feature.
Plan ejecutado: `PLAN_X_DOBLAJE_IMPLEMENTACION_LLM.md`; bitácora de la
ejecución en `docs/x-doblaje/EJECUCION_2026-09-27.md`.

## Qué cambió (inventario completo, 2026-09-27)

### Archivos nuevos

| Archivo | Qué hace |
|---|---|
| `api/x_video.py` | Lee el post de X (sindicación → FxTwitter), normaliza el video y solo entrega URLs de `video.twimg.com` / `pbs.twimg.com`. |
| `js/youtube/fuenteVideo.js` | `detectarFuente(url)`: reconoce enlaces de YouTube y de X en el mismo campo y devuelve `{plataforma, id, indice, clave}`. |
| `js/youtube/servicioX.js` | Consulta `/api/x-video`, filtra el HLS de solo audio y pide las partes a Whisper. Todo a `video.twimg.com` con `referrerPolicy: 'no-referrer'`. |
| `js/youtube/audioX.js` | Descarga los trozos HLS de audio (64 kbps), arma partes de ≤ 3,2 MB y las une desplazando tiempos sin duplicados. |
| `js/youtube/XVideoPlayer.js` | `<video>` HTML5 con el contrato de `YouTubePlayer` (mismo motor de doblaje). |
| `x-reproductor.html` | iframe del mismo origen con meta `no-referrer`: único lugar donde vive el `<video>` de X. |
| `backend/tests/test_x_video.py` | 35 pruebas del módulo y de la ruta `/api/x-video` (sin red). |
| `tests/test_x_doblaje.mjs` | 70 pruebas unitarias del flujo de X (audio, transcripción, cancelación, errores). |
| `tests/verificar_x_doblaje.mjs` | 24 pruebas de navegador de punta a punta (API y reproductor simulados). |
| `tests/fixtures/x/…` | Enlaces, respuestas de sindicación/FxTwitter, listas HLS y video de prueba. |
| `docs/x-doblaje/` | Bitácora de ejecución y capturas crudas de los hechos medidos (H1–H12). |
| `PLAN_X_DOBLAJE_IMPLEMENTACION_LLM.md` | Plan completo (contratos, código, pruebas, criterios de aceptación). |
| `CAMBIOS_X.md` | Este documento. |

### Archivos modificados

| Archivo | Qué cambió |
|---|---|
| `api/index.py` | Ruta `GET /api/x-video` + marca `x_video: true` en `/api/health`. |
| `js/youtube/youtubeSyncController.js` | `abrirSesion`/`completarSesion` reutilizables; desvío a X al pulsar «Doblar»; nota del enlace de X; `crearReproductorX` / `iniciarSesionX`. |
| `index.html` | `JG_JS_V = 'v153'`; textos del panel (el mismo campo acepta X). |
| `sw.js` | `CACHE_SHELL = 'jg-turbo-shell-v153'`. |
| `vercel.json` | Cabeceras de `/x-reproductor.html` (`Referrer-Policy: no-referrer`). |
| `.gitignore` | Excepción para `tests/fixtures/x/video_prueba.webm`. |
| `AGENTS.md` / `Agents.md` | Sección «X / Twitter», pruebas (`test_x_doblaje`, `verificar_x_doblaje`) y reglas. |
| `TRAMPAS.md` | Entrada: `video.twimg.com` rechaza el Referer de otro dominio. |
| `CONFIG_PERSISTENTE.md` | Caché de doblajes de X en IndexedDB `jg_youtube` con clave `x:<id>`. |
| `DOCUMENTACION_DESPLIEGUE.md` | Publicación v153. |

### Qué NO se tocó

El camino de YouTube por dentro (mismas claves de caché, mismos números de
prueba: 139 · 65 · 110). El motor de doblaje (`dubbingEngine`, `syncEngine`,
`motorPreparacion`) es compartido y no cambió. Sin dependencias nuevas ni
claves de `localStorage` nuevas.

## Qué hace

En la pestaña YouTube se puede pegar también el enlace de un post de X
(`x.com/usuario/status/…`) y pulsar «Doblar al español»: el video se ve con
voz en español, subtítulo, ritmo automático y «Texto completo», igual que un
video de YouTube. El mismo campo acepta ambos enlaces y una nota explica que
los de X se doblan pero no tienen «Solo el texto».

X casi nunca publica subtítulos (medido: 0 de 4 videos con voz), así que la
app **escucha el audio**: baja del HLS la pista de solo audio de 64 kbps en
trozos de ~3 s, los arma en partes de ≤ 3,2 MB y cada parte viaja al
`/api/transcribe` de siempre (Whisper de Groq, gratis). Los tiempos de cada
parte se desplazan y se unen sin duplicados; de ahí en adelante el motor de
doblaje es exactamente el de YouTube (mismas voces, traducción, ritmo).

## Hechos medidos (2026-09-27)

Respuestas crudas en `docs/x-doblaje/capturas/`.

| # | Hecho | Consecuencia |
|---|---|---|
| H1 | `cdn.syndication.twimg.com/tweet-result?id=<id>&token=<cualquiera>` devuelve el JSON del post con las variantes del video. **Sin `token` devuelve `{}`**; id inexistente → HTML 404. | El servidor manda un token aleatorio (igual que yt-dlp). |
| H2 | La sindicación solo permite CORS a `platform.twitter.com`. | El navegador no puede llamarla: va por el servidor (`/api/x-video`). |
| H3 | **`video.twimg.com` responde 403 si la petición lleva `Referer` de otro dominio.** Sin Referer, o con `https://x.com/`, 200/206. `curl` no manda Referer y por eso «funciona» en consola. | Toda petición a `video.twimg.com` va **sin Referer**: `fetch(url, {referrerPolicy:'no-referrer'})` y el `<video>` dentro de `/x-reproductor.html` (meta `no-referrer`). |
| H4 | `video.twimg.com` refleja el origen en CORS y acepta `Range`. | El navegador puede leer las listas HLS y los trozos con `fetch`. |
| H5 | La lista HLS maestra trae pistas de **solo audio** (`/mp4a/32000/`, `/64000/`, `/128000/`) en fMP4 con trozos de ~3 s. Inicial + trozos concatenados = `.m4a` válido. | El audio se arma en el navegador sin decodificar nada. |
| H6 | 60 s de audio de 64 kbps al `/api/transcribe` de producción → `200` en ~2,5 s con `start`/`end` por frase. 32 kbps cortó palabras («pull the trigger»). | Se usa **64 kbps** (32 kbps de respaldo). |
| H7 | En 4 videos reales con voz, ninguno traía subtítulos útiles. | No se depende de subtítulos de X: siempre se escucha el audio. |
| H8 | FxTwitter (`api.fxtwitter.com/status/<id>`) devuelve lo mismo. | Respaldo del servidor. |
| H9 | A veces el video vive en `card.binding_values.unified_card.string_value`, no en `mediaDetails`. | El normalizador lee los dos sitios. |
| H10 | Groq gratis: archivos de hasta 25 MB, 20 peticiones/min, 7 200 s de audio/hora, 28 800 s/día; mp4/m4a admitidos. | 60 min de video ≈ 10 peticiones: cabe de sobra. |
| H11 | Supadata también lee X, pero sin subtítulos genera con IA a 2 créditos/min. | **No** se usa Supadata para X. |
| H12 | La `GROQ_API_KEY` del `.env` local está inválida (401). La de Vercel funciona. | Lo real se mide en vista previa/producción; las pruebas locales usan dobles. |

## Arquitectura

```
enlace de X pegado en #ytUrl
  └─ fuenteVideo.detectarFuente → { plataforma: 'x', id, indice, clave: 'x:<id>' }
  └─ GET /api/x-video (api/index.py → api/x_video.py: sindicación → FxTwitter)
        → { id, autor, texto, duracion_s, portada, mp4[], hls }   (solo video.twimg.com / pbs.twimg.com)
  └─ reproductor: XVideoPlayer (contrato de YouTubePlayer) sobre un <video>
       dentro de /x-reproductor.html (iframe del mismo origen, SIN Referer)
  └─ texto con tiempos: servicioX + audioX
        HLS maestro → pista de solo audio 64 kbps → trozos (~3 s)
        → partes de ≤ 3,2 MB (solape de 4 trozos ≈ 12 s)
        → POST /api/transcribe (Whisper de Groq) parte por parte (2 en vuelo)
        → unirTranscripciones desplaza tiempos y quita duplicados de la frontera
  └─ decidirDoblaje + completarSesion + prepararDoblaje: EL MISMO motor de YouTube
       (traducción, voces, ritmo automático, subtítulo, caché IndexedDB jg_youtube)
```

## Contrato de `/api/x-video`

`GET /api/x-video?url=<enlace>` → `200` con:

```json
{
  "id": "1349794411333394432", "indice": 0, "autor": "BrooklynNets",
  "texto": "WATCH: …", "idioma_texto": "en", "duracion_s": 324.493,
  "portada": "https://pbs.twimg.com/…jpg",
  "mp4": [{ "url": "https://video.twimg.com/…mp4", "bitrate": 832000, "ancho": 640, "alto": 360 }],
  "hls": "https://video.twimg.com/…master.m3u8", "fuente": "sindicacion"
}
```

Errores (`detail` + `code`): `400 enlace` · `404 no_disponible` (privado,
borrado o restricción de edad) · `404 sin_video` · `422 gif` (GIF: sin
sonido) · `422 en_vivo` (transmisiones y Spaces) · `503 red` (X no
respondió por ninguna vía). Solo se entregan URLs `https` de
`video.twimg.com` (video) y `pbs.twimg.com` (portada).

`GET /api/health` → `"x_video": true` cuando la ruta está publicada.

## Límites

- Videos de X de hasta **60 min** (`MAX_DURACION_X_S`): más largo se rechaza
  sin descargar nada, con el motivo a la vista.
- Partes de **≤ 3,2 MB** a 64 kbps = 360 s por parte (límite de cuerpo de
  Vercel ~4,5 MB; no subir sin volver a medir).
- Groq gratis: 20 peticiones/min → 2 partes en vuelo; ante «Límite de uso»
  espera 20 s y 40 s (máx. 2 reintentos) y luego explica el motivo.
- Videos en español: solo se transcribe la 1.ª parte (no se gasta cuota).

## Medición desde Vercel

Fecha: 2026-09-27, hora de Colombia. Commit de código: `c6749db`.
Vista previa: https://jg-turbo-i381u7eh5-jhoncod24s-projects.vercel.app
Despliegue de vista previa: `dpl_3YaeFFYTaaGzpqzu22fNHFXerdwG`, READY.
Copia creada con `git archive HEAD`; proyecto comprobado: `jg-turbo`.
Consultas mediante `vercel curl`, conservando la protección del despliegue.
Los tiempos corresponden a `curl time_total`, sin incluir el arranque del CLI.

| Post | HTTP | Fuente | Tiempo |
|---|---:|---|---:|
| `BrooklynNets/status/1349794411333394432` | 200 | sindicacion | 0,835495 s |
| `elonmusk/status/1585341984679469056` | 200 | sindicacion | 0,620542 s |
| `jamestalarico/status/2023659473466687994` | 200 | sindicacion | 0,761383 s |

Decisión T3: continuar sin T6b, porque los tres posts respondieron por
sindicación. Salud: HTTP 200 en 0,358405 s, `x_video: true`.
La vista previa reporta `groq_configured: false`, `ia_configured: false`,
`tts_azure: false` (variables de entorno solo viven en producción).

## Medición en vista previa (T12)

Pendiente: se llena en la Tarea 12 con la prueba real (Chrome de escritorio
e iPhone del dueño).

## Pruebas

| Comando | Resultado |
|---|---|
| `python -m pytest backend/tests/test_x_video.py -q` | 35 passed |
| Regresión servidor (4 archivos de YouTube de `main`) | 74 passed |
| `node tests/test_x_doblaje.mjs` | 70 comprobaciones OK · 0 fallos (T4 19 + T5 26 + T6 19 + T7 6) |
| `node tests/verificar_x_doblaje.mjs` | 24 comprobaciones OK · 0 fallos |
| Contraprueba del Referer (sin `no-referrer`) | falla exactamente en «NINGUNA petición a video.twimg.com lleva Referer» con las 3 URLs |
| `node tests/test_youtube_doblaje.mjs` | 139 OK · 0 fallos (línea base: 139) |
| `node tests/test_youtube_sincronia.mjs` | 65 OK · 0 fallos (línea base: 65) |
| `node tests/verificar_youtube_doblaje.mjs` | 110 OK · 0 fallos (línea base: 110) |
| `node tests/verificar_arranque_ligero.mjs` | 9 OK + el fallo preexistente de 1 MB (1 033 KB) |

T1: error de importación antes del módulo; después 31 passed.
T2: 4 fallos previstos antes de la ruta; después 35 passed.

## Qué hacer si X cambia

La sindicación y FxTwitter no son una API oficial: X puede cambiarlas sin
aviso y el doblaje de X dejaría de LEER posts (YouTube y el resto de la app
no se afectan). Síntomas: `503 x_red` o `404` en `/api/x-video`, o el botón
que dice «No pudimos consultar X en este momento».

1. Probar la ruta: `curl "https://jg-turbo.vercel.app/api/x-video?url=<post>"`.
2. Mirar `api/x_video.py` (el único archivo del servidor) y los registros de
   Vercel (Functions → Logs).
3. Comparar la respuesta cruda de `cdn.syndication.twimg.com/tweet-result`
   con las capturas de `docs/x-doblaje/capturas/` para ver qué campo movió X.

## Desvíos del plan

- Comandos de archivos adaptados a PowerShell, conservando el código del plan.
- Acceso autenticado a la vista previa mediante `vercel curl`.
- FFmpeg existente comprobado por ruta absoluta, sin instalar dependencias.
- El fallo de arranque descrito en el plan no se reprodujo en la línea base
  actual (sí en la batería final: 1 033 KB, el mismo fallo preexistente de `main`).
- `tests/fixtures/x/video_prueba.webm` necesitó una excepción en `.gitignore`
  (`*.webm`): sin ella, el commit de la Tarea 10 subía sin el video.

## Despliegues

| `dpl_…` | Qué entró |
|---|---|
| `dpl_Er2mhf2iaRKaFabPwL9SVRQnxqyc` | **v153** (`jg-turbo-shell-v153`): doblaje de videos de X completo (API, audio, reproductor e integración en el panel de YouTube) |

Desplegado desde copia exacta del commit (`git archive` de `e4362fa` en `main`),
proyecto `jg-turbo`, alias https://jg-turbo.vercel.app. Fecha: 2026-09-27
(21:45 Colombia). Código: 186 archivos, 45 KB subidos.

### Verificación en producción (2026-09-27)

| Comprobación | Resultado |
|---|---|
| `GET /api/health` | `x_video: true` |
| HTML | `JG_JS_V = 'v153'` |
| `/js/youtube/*X*` (5 módulos) | HTTP 200, código de X presente |
| `/x-reproductor.html` | HTTP 200, meta `no-referrer` |
| `GET /api/x-video?url=https://x.com/DAIEvolutionHub/status/2104109462999216173/video/1` | **200** sindicacion · id `2104109462999216173` · `@DAIEvolutionHub` · 1 595 s · 4 MP4 (480p–1080p) + HLS |

Enlace de prueba del dueño (post de X con video de ~26 min) leído sin
problemas por la API de producción. Queda pendiente la prueba de doblaje
completa en el navegador del dueño (Chrome e iPhone físico): la API entrega
el video y las suites de navegador pasan (24 OK), pero la experiencia real
de transcribir 26 min y escuchar la voz se mide ahí.
