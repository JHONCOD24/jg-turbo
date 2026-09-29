# Plan: doblar clases de Udemy al español en tiempo real (extensión de Chrome)

> **Para el agente que ejecuta:** este plan se implementa tarea por tarea, en orden. Cada tarea: prueba
> primero, verla fallar, implementar, verla pasar, **contar** las comprobaciones, commit. Marca la casilla
> (`- [ ]` → `- [x]`) solo después de correr el comando. Si tienes `superpowers:executing-plans` o
> `superpowers:subagent-driven-development`, úsalas.
>
> Preparado el 2026-09-29 contra `main` (`78cddab`) más el trabajo sin commitear de ese día (`index.html` tenía cambios del lector de PDF: sus líneas llevan `~`). Las rutas y líneas citadas son de ese
> commit; si no cuadran, el repo cambió: busca el símbolo por nombre antes de «arreglar» el plan.

**Meta.** Que el dueño abra una clase suya en `udemy.com` (Chrome de escritorio, con su sesión normal),
pulse **«Doblar al español»** en un panel lateral de JG Turbo y oiga la clase en español, sincronizada con
el video de Udemy, con el mismo motor que ya dobla YouTube y X: la frase suena entera, el video se frena
solo si hace falta y el subtítulo en español muestra lo que dice la voz.

**Lo que el dueño pidió y lo que NO pidió (no ampliar el alcance):**

| Sí | No |
|---|---|
| Solo Chrome de escritorio | Nada de móvil |
| Solo clases en inglés → español | Otros idiomas |
| Tiempo real, mientras mira | Guardar doblajes, biblioteca, descargas |
| Que Udemy no lo detecte ni lo bloquee | Pegar el enlace de Udemy dentro de la app |

---

## 1. Por qué es una extensión y no «pegar el enlace» (no rediseñar esto)

Se estudió el 2026-09-29. Si te tienta cambiar de enfoque, primero lee esto:

1. **Los cursos solo se abren con la sesión del dueño.** Para que el servidor los viera habría que darle la
   contraseña o las cookies de Udemy. **Prohibido**: expone la cuenta y el servidor no debe ver credenciales.
2. **Udemy bloquea servidores.** Una petición a `https://www.udemy.com/terms/` desde fuera respondió
   `403 Forbidden` (medido 2026-09-29). Y una sesión que aparece desde la IP de un centro de datos es justo
   lo que activa sus alarmas.
3. **Muchos videos llevan DRM** (Widevine). El video solo se puede reproducir en el reproductor de Udemy;
   sacarlo a otra página o capturarlo no funciona y además es lo que prohíben sus términos.
4. **Un agente anterior propuso «meter la pantalla del video» en la app** y al dueño no le gustó. No
   repetirlo: aquí el video se queda en Udemy y es **la voz la que va a Udemy**.

Por tanto: **el video sigue en udemy.com, intacto, y la extensión solo pone la voz en español encima.**

---

## 2. Reglas anti-bloqueo (el requisito número uno del dueño)

El dueño pidió expresamente que Udemy no lo bloquee ni lo banee. **Nadie puede garantizarlo al 100 %**:
eso lo decide Udemy y sus términos pueden cambiar. Díselo así. Lo que sí se puede garantizar es que, para
Udemy, la extensión **no se distingue de una persona viendo su clase**. Cada regla tiene su prueba.

| # | Regla | Por qué | Cómo se vigila |
|---|---|---|---|
| A1 | **Cero peticiones propias a `udemy.com`.** Ni `api-2.0`, ni listas de cursos, ni nada. | Una llamada que el reproductor no hace es tráfico anómalo. | Prueba estática (grep) + prueba de navegador que cuenta peticiones. |
| A2 | Los subtítulos se leen de lo que **el reproductor ya cargó**: primero `video.textTracks` (0 peticiones); si no, la URL del `.vtt` que el reproductor pidió, **pedida otra vez desde la propia página** (misma cara: `Origin` y `Referer` de udemy.com). Máximo **1** petición extra por clase, a la CDN. | Es la misma petición que hace el reproductor al encender los subtítulos. | Prueba de navegador: ≤ 1 petición `.vtt` extra por clase. |
| A3 | **Sin credenciales.** Sin permiso `cookies`, sin leer `document.cookie` ni `localStorage` de Udemy, sin cabeceras de autorización. | Nada de la cuenta sale del navegador. | Prueba estática del manifiesto y del código. |
| A4 | **Nada en el «mundo» de la página.** Solo el content script en `ISOLATED`; nada de `world: 'MAIN'`, de `<script>` inyectados ni de tocar funciones de Udemy. | El JavaScript de Udemy no puede ver ni perfilar la extensión. | Prueba estática. |
| A5 | **Sin `web_accessible_resources`.** | Es la forma habitual de que una web detecte extensiones instaladas (pidiendo `chrome-extension://<id>/archivo`). | Prueba estática del manifiesto. |
| A6 | **Cero automatización.** No hace clic, no cambia de clase, no marca clases como vistas, no reproduce nada que el dueño no haya empezado. Solo toca del `<video>`: volumen, silencio y velocidad, como haría la persona con los controles. | Un bot que recorre un curso es lo que se banea. | Prueba estática: sin `.click()`, `dispatchEvent`, `location` ni `history` en el content script. |
| A7 | **Al detener, el video queda como estaba** (volumen, silencio y velocidad originales). | Que no queden valores raros guardados en la cuenta. | Prueba de navegador. |
| A8 | **No se descarga, graba ni copia el video.** Sin `captureStream`, `MediaRecorder` ni lectura del flujo. | Es lo que prohíben los términos de Udemy. | Prueba estática. |
| A9 | **Nada de Udemy se guarda.** Subtítulos y voces viven en memoria y se van al cerrar el panel. Solo se guardan preferencias (voz, volúmenes). | El dueño no quiere guardar nada; y no hay copia del contenido. | Prueba estática: `chrome.storage` solo con claves de preferencias. |
| A10 | **A nuestro servidor solo viaja texto a traducir y a leer.** Nunca la URL del curso, su id, ni datos de la cuenta. El título de la clase sí puede viajar (da contexto a la traducción). | Privacidad. | Prueba de navegador sobre los cuerpos de las peticiones. |
| A11 | **Uso personal, instalada «sin empaquetar».** No publicar en la Chrome Web Store. | Publicarla sería distribuir una herramienta para Udemy. | Documentación. |
| A12 | **Permisos mínimos**, exactamente los de la §4. | Cada permiso de más es algo que puede fallar o levantar sospechas. | Prueba estática: el conjunto exacto. |

Sobre la velocidad: el ritmo automático frena el video en pasos de 0,05 (mínimo 0,75×). Udemy ofrece
velocidades de 0,5× a 2× en su propio menú, así que un video más lento es algo normal. Si en la prueba real
el reproductor de Udemy **revierte** la velocidad por su cuenta, no se pelea con él: ver Tarea 7.

---

## 3. Arquitectura

```
┌───────────────────────── Pestaña de Udemy ─────────────────────────┐
│  <video> de Udemy (con DRM, intacto)                                │
│  content script (ISOLATED)  ← puente mínimo:                        │
│    · informa: tiempo, velocidad, pausa, fin, espera, clase nueva    │
│    · obedece: volumen, silencio, velocidad (y play/pausa)           │
│    · lee subtítulos (textTracks o el .vtt ya pedido)                │
│    · pinta el subtítulo en español (Shadow DOM cerrado)             │
└───────────────▲──────────────────────────────┬──────────────────────┘
                │ chrome.runtime Port          │
┌───────────────┴──────────────────────────────▼──────────────────────┐
│  Panel lateral (página de la extensión, chrome.sidePanel)           │
│   · el MOTOR de JG Turbo (copiado de js/youtube, sin cambios)       │
│   · ReproductorRemoto: el mismo contrato que YouTubePlayer          │
│   · 2 <audio> alternados: aquí suena la voz en español              │
│   · fetch a https://jg-turbo.vercel.app/api (translate, tts)        │
└─────────────────────────────────────────────────────────────────────┘
   service worker: solo abre el panel en pestañas de Udemy y apunta
   (sin bloquear ni modificar) la URL de los .vtt que pide el reproductor.
```

**Decisiones y su porqué:**

- **El motor corre en el panel, no en la página.** El panel es una página de la extensión: admite módulos
  ES, no le afecta la CSP de Udemy (que podría bloquear el audio `blob:`) y con `host_permissions` llama a
  nuestra API sin problemas de CORS. En la página solo vive un puente pequeño, que es lo único que Udemy
  podría ver.
- **El motor no se reescribe: se copia.** `DubbingEngine`, `MotorPreparacion`, `DubbingService`,
  `TranslationService`, `SyncEngine` y compañía no dependen del DOM ni de `window` (comprobado: sus únicos
  imports son entre ellos). Un script los copia a la extensión y una prueba falla si la copia difiere del
  original. **Una sola fuente de verdad: `js/youtube/`.**
- **`ReproductorRemoto`** implementa el contrato que usa el motor (el mismo que `XVideoPlayer.js`):
  `getCurrentTime`, `getPlaybackRate`, `setPlaybackRate`, `getPlayerState`, `getVolume`, `setVolume`,
  `mute`, `unMute`, `isMuted`, `playVideo`, `pauseVideo`, `suscribirEstado`, `suscribirVelocidad`,
  `getDuration`, `getVideoData`, `getAvailablePlaybackRates`, `ocultarSubtitulosDeYouTube` (vacía),
  `destruir`. El tiempo se **extrapola**: último tiempo informado + lo transcurrido × velocidad si está
  reproduciendo, así el motor (tic de 100 ms) no depende de la frecuencia de los mensajes.
- **La voz suena en el panel.** Si el dueño cierra el panel, el doblaje se apaga y el video vuelve a como
  estaba (A7). Es lo esperado y se dice en la interfaz.
- **Sin cambios en el servidor.** `api/index.py` ya tiene CORS `*` (línea ~51) y no exige autenticación.
  **No hay que desplegar nada a Vercel** para este trabajo.

---

## 4. Archivos

**Nuevos** (todo en `extension-udemy/`):

| Archivo | Responsabilidad |
|---|---|
| `manifest.json` | MV3. `permissions`: `["sidePanel", "storage", "webRequest"]`. `host_permissions`: `["https://www.udemy.com/*", "https://*.udemycdn.com/*", "https://jg-turbo.vercel.app/*"]`. `content_scripts`: `udemy.js` en `https://www.udemy.com/course/*/learn/*`, `run_at: document_idle`, sin `all_frames` salvo que la Tarea 1 diga lo contrario. `side_panel.default_path`: `panel.html`. **Sin** `web_accessible_resources`. |
| `fondo.js` | Service worker. Activa el panel solo en pestañas de Udemy (`chrome.sidePanel.setOptions` por pestaña; `setPanelBehavior({ openPanelOnActionClick: true })`). Escucha `chrome.webRequest.onCompleted` (sin bloquear, sin `extraHeaders`) con filtro `*://*.udemycdn.com/*` y guarda en `chrome.storage.session`, por pestaña, las URL que terminen en `.vtt`. **Nunca las registra en consola** (llevan firma). |
| `udemy.js` | Content script (puente). Sin `import` (los content scripts no son módulos). Encuentra el `<video>`, abre el `Port`, informa estado, obedece órdenes, lee subtítulos, pinta el subtítulo en español, detecta cambio de clase. |
| `panel.html`, `panel.css`, `panel.js` | Interfaz y cableado (equivalente reducido de `prepararDoblaje` en `js/youtube/youtubeSyncController.js:621-744`). |
| `lib/reproductorRemoto.js` | Contrato del reproductor sobre el `Port`. Puro y probado. |
| `lib/vtt.js` | Lector de WebVTT → segmentos `{ startTime, endTime, text }`. Puro y probado. |
| `lib/api.js` | `traducirTexto` y `generarAudio` contra la API de JG Turbo. |
| `lib/preferencias.js` | Lee/guarda en `chrome.storage.local` solo: `voz` (`female`/`male`), `acento`, `volVoz`, `volOriginal`, `ritmoAuto`, `subtitulo`, `autoSiguiente`. |
| `motor/` | **Copia generada**, no se edita a mano: `reloj.js`, `ritmoDoblaje.js`, `planificador.js`, `translationService.js`, `motorPreparacion.js`, `dubbingService.js`, `hablaVoz.js`, `syncEngine.js`, `limitador.js`, `vocesDoblaje.js`, `idiomaOrigen.js`, `transcriptionService.js`, `dubbingEngine.js`. Lleva un `LEEME.md` que lo dice. |
| `copiar_motor.mjs` | Copia esos 13 archivos de `js/youtube/` a `motor/` y escribe `motor/HUELLAS.json` (SHA-256 de cada uno). |
| `iconos/` | 16, 48 y 128 px. |
| `LEEME.md` | Cómo instalarla (modo desarrollador → «Cargar descomprimida»), cómo usarla y qué NO hace (§2). En lenguaje simple. |

**Nuevas pruebas:** `tests/test_udemy_doblaje.mjs` (unitarias + estáticas) y `tests/verificar_udemy_doblaje.mjs`
(navegador con la extensión cargada y una página falsa de Udemy).

**Se modifican:** `.vercelignore` (añadir `extension-udemy/`), `AGENTS.md` (sección nueva), y se crea
`CAMBIOS_UDEMY.md`. **No se toca** `index.html`, `api/`, `sw.js` ni nada de `js/youtube/`.

---

## 5. Restricciones globales

1. **`js/youtube/` no se modifica.** Si algo del motor no encaja, se adapta en el panel o en
   `ReproductorRemoto`. Las pruebas de YouTube y X deben dar los mismos números que en tu línea base.
2. **Nada de dependencias nuevas** (ni npm ni pip). Playwright ya existe para las pruebas.
3. **Nada que cueste dinero.** Voz neural (Azure F0 → edge-tts, la cadena que ya hay), nunca Fish: es lenta
   (6-8 s por frase) y la cuenta no tiene créditos.
4. **El subtítulo en español copia el aspecto de `.yt-caption`** (diseño establecido por el dueño): mismas
   fuentes, tamaño, fondo y sombra. No inventar otro estilo.
5. **Español de Colombia** en nombres, comentarios, interfaz y commits. Autor `JHONCOD24 <juanloras35@gmail.com>`.
6. Trabaja en la rama `feat/udemy-doblaje`.
7. **Honestidad** (`TRAMPAS.md` §1): una prueba que se corta no pasa; cuenta las comprobaciones. No digas
   «funciona en Udemy» hasta que el dueño lo haya probado (Tarea 10).

---

## 6. Tareas

### Tarea 0 — Línea base
- [x] Anota los conteos actuales de `node tests/test_youtube_sincronia.mjs`, `node tests/test_youtube_doblaje.mjs`
  y `node tests/test_x_doblaje.mjs`. Medidos el 2026-09-29: 74, 139 y 70, con 0 fallos.
- [x] Crea la rama `feat/udemy-doblaje`.

### Tarea 1 — Esqueleto y diagnóstico (⛔ PARADA con el dueño)

Nadie en este proyecto ha visto por dentro el reproductor actual de Udemy con la sesión del dueño. Antes de
escribir el lector de subtítulos hay que **medirlo**, no suponerlo.

- [x] Crea `manifest.json`, `fondo.js`, un `udemy.js` mínimo y un `panel.html` con un solo botón:
  **«Diagnóstico de esta clase»**.
- [x] El diagnóstico devuelve un JSON **sin datos sensibles** (sin cookies, sin query strings, sin ids de
  curso) con:
  - cuántos `<video>` hay y si están en el documento principal o en un `iframe`;
  - `duration`, `readyState`, `playbackRate`, `muted`, `volume` del video;
  - `video.textTracks`: por pista, `kind`, `label`, `language`, `mode` y cuántos `cues` tiene tras ponerla
    en `hidden` y esperar 2 s (y devolverla a su `mode` original);
  - si `fondo.js` vio URL `.vtt` en esta pestaña: solo **host y ruta**, sin la firma;
  - si existe el panel de transcripción de Udemy en el DOM (buscar por `data-purpose` que contenga
    `transcript`) y cuántas líneas tiene;
  - el texto de la cabecera de la clase (para el título).
- [x] Botón **«Copiar diagnóstico»**.
- [x] Escribe en `extension-udemy/LEEME.md` los pasos de instalación (Chrome → `chrome://extensions` →
  «Modo de desarrollador» → «Cargar descomprimida» → carpeta `extension-udemy`).
- [x] **PARA.** Pide al dueño que abra una clase en inglés, active una vez los subtítulos en inglés (botón
  CC de Udemy), le dé play unos segundos y te pegue el diagnóstico. Si es posible, dos clases de cursos
  distintos.

Verificación local de la Tarea 1 (2026-09-29): `node tests/test_udemy_doblaje.mjs` 18 OK;
`node tests/verificar_udemy_diagnostico.mjs` 10 OK, ambas con 0 fallos y sin visitar Udemy real.

**Con el diagnóstico, decide la fuente de subtítulos:**

| Lo que muestra | Fuente |
|---|---|
| Hay una pista de texto en inglés con `cues` > 0 | **`textTracks`** (0 peticiones). Preferida. |
| No hay cues, pero `fondo.js` vio un `.vtt` | **URL observada**, pedida con `fetch` **desde `udemy.js`** (así sale con el mismo `Origin`/`Referer` que la del reproductor). |
| Ninguna, pero hay panel de transcripción con tiempos | Transcripción del DOM. Solo con el visto bueno del dueño. |
| Nada | Parar y avisar. **No** llamar a `api-2.0` (A1). |

Si el video está en un `iframe`, ajusta `all_frames`/`matches` y anótalo en `CAMBIOS_UDEMY.md`.

### Tarea 2 — Copia del motor
- [x] Escribe `copiar_motor.mjs` y ejecútalo.
- [x] En `tests/test_udemy_motor.mjs`: la huella SHA-256 de cada archivo de `motor/` es igual a la de su
  original en `js/youtube/` (normalizando fin de línea: el repo está en CRLF). **Si alguien cambia el motor
  de YouTube y olvida copiar, esta prueba falla.**
- [x] Comprueba que ningún archivo de `motor/` importa algo fuera de `motor/`. Prueba: 26 OK, 0 fallos.

### Tarea 3 — Lector de WebVTT (`lib/vtt.js`)
- [ ] Pruebas primero, con casos reales: cabecera `WEBVTT`, bloques `NOTE`, identificadores de cue,
  tiempos con y sin horas (`00:01.000` y `00:00:01.000`), ajustes de cue (`align:start position:10%`),
  etiquetas (`<c>`, `<i>`, `<00:00:01.500>`), entidades (`&amp;`, `&gt;`), cues vacíos, fin de línea `\r\n`,
  BOM y un cue partido en dos líneas.
- [ ] Devuelve segmentos que luego pasan por `normalizarSegmentos` de `motor/transcriptionService.js` (no
  duplicar esa limpieza).
- [ ] `segmentosDesdeTextTrack(pista)`: convierte `TextTrackCue` → `{ startTime, endTime, text }`.

### Tarea 4 — `ReproductorRemoto` (`lib/reproductorRemoto.js`)
- [ ] Pruebas con un `Port` falso y un reloj inyectable (`ahora`):
  - `getCurrentTime` extrapola: informado 10 s a 1× reproduciendo → 300 ms después devuelve 10,3; en pausa,
    10; a 0,9× → 10,27.
  - `getPlayerState` devuelve los códigos de `CODIGO_ESTADO` de `XVideoPlayer.js` (−1, 0, 1, 2, 3).
  - `setPlaybackRate`, `setVolume`, `mute`, `unMute`, `playVideo`, `pauseVideo` envían la orden y
    **actualizan el estado local al instante** (el motor lee justo después).
  - `suscribirEstado` y `suscribirVelocidad` avisan con los mismos valores que `XVideoPlayer`.
  - Si el puerto se desconecta, el estado pasa a pausado y avisa (el motor se detiene, no se cuelga).
- [ ] Mensajes del puente (texto plano, sin nada de Udemy más allá del tiempo):
  - página → panel: `{ tipo: 'estado', t, tasa, pausado, terminado, esperando, volumen, silenciado, duracion, enviadoEn }`
    en cada evento del video (`play`, `pause`, `seeked`, `ratechange`, `waiting`, `playing`, `ended`,
    `volumechange`) y cada 250 ms mientras reproduce; `{ tipo: 'clase', titulo }` al cambiar de clase.
  - panel → página: `{ tipo: 'orden', accion: 'velocidad'|'volumen'|'silencio'|'play'|'pausa', valor }`,
    `{ tipo: 'subtitulo', texto }`, `{ tipo: 'leerSubtitulos' }`, `{ tipo: 'restaurar' }`.

### Tarea 5 — Puente en la página (`udemy.js`)
- [ ] Al conectar, guarda el estado original del video (`volume`, `muted`, `playbackRate`) para `restaurar`.
- [ ] Obedece las órdenes solo sobre el `<video>`; `play` y `pausa` llaman a `video.play()`/`pause()`, nunca a
  botones de Udemy (A6).
- [ ] `leerSubtitulos`: aplica la fuente decidida en la Tarea 1 y devuelve `{ idioma, etiqueta, segmentos }`.
  Solo pistas en inglés (`language` que empiece por `en` o etiqueta «English», con o sin «[Auto]»). Si la
  clase no las tiene, responde `{ error: 'sin_ingles' }`.
- [ ] **Cambio de clase:** Udemy es una SPA; detecta el cambio por URL (`/learn/lecture/<n>`) o porque el
  `<video>` se reemplaza o emite `emptied`. Avisa al panel. **No navega nunca.**
- [ ] Al desconectarse el `Port` (se cerró el panel): `restaurar` automáticamente y quitar el subtítulo (A7).

### Tarea 6 — Adaptadores de la API (`lib/api.js`)
- [ ] Base fija `https://jg-turbo.vercel.app/api`, sobreescribible solo desde `chrome.storage.local`
  `jg_api_base` (para las pruebas con un servidor falso).
- [ ] `traducirTexto(texto, { origen, tituloVideo, contexto, signal })` → `POST /translate` con el mismo
  cuerpo que manda la app para el doblaje (`cuerpoBase` en `traducirTranscripcionDetallada`, `index.html:~10538`, y la llamada de `inicializarYoutubeSincronizado`, `index.html:~19026`):
  `{ text, direction: 'en-es', provider, api_key: '', literal: true, revisar: false, titulo_video, contexto_previo, contexto_siguiente }`.
  `provider` = `ai_provider_server` de `GET /api/health` (así lo decide la app en `jgCredencialesIA`,
  `index.html:8886-8890`); si no responde, `'gemini'`. Un reintento ante 502/504 o corte de red, como
  `jgPedirTraduccion` (`index.html:10479`). Devuelve el JSON tal cual (el motor mira `ia_used`).
- [ ] `generarAudio(texto, { voz, acento, signal })` → `POST /tts` con
  `{ text, voice, language: 'es', locale: acento, rate: 1, tone: 'neutral', idioma_fijo: true, source: 'yt' }`,
  tiempo máximo 45 s. Devuelve `{ blob, engineHdr: X-TTS-Engine, respaldoHdr: X-TTS-Fallback }`. Error
  legible si no es `ok` (usa `detail` del JSON como en `index.html:~19069`).
- [ ] `calentar()` → `GET /tts-warmup` al pulsar «Doblar», sin esperar la respuesta (como
  `youtubeSyncController.js:763`).

### Tarea 7 — Panel y cableado (`panel.js`)
Sigue `prepararDoblaje` (`youtubeSyncController.js:621-744`) **quitando** lo que el dueño no quiere: caché,
biblioteca, `buscarGuardada`, `guardarVoz`, descargas, segunda voz y Fish.

- [ ] Al pulsar **«Doblar al español»** (este clic es el gesto que desbloquea el audio): crea los dos `<audio>`
  y los desbloquea como `desbloquearAudio` en la app; `calentar()`; pide `leerSubtitulos`;
  `normalizarSegmentos`; si el idioma no es inglés → «Esta clase no está en inglés.» y no hace nada más.
- [ ] Crea `TranslationService({ traducirTexto, intervaloMinMs: 1100 })`, `crearLimitador()`,
  `DubbingService` (sin `buscarGuardada`, con `medirHabla` en `generarAudio`), `definirUnidades(agruparPorTiempo(...))`,
  `MotorPreparacion`, `esperarArranque({ vozInicialS: VOZ_INICIAL_S })`, `DubbingEngine` con el
  `ReproductorRemoto`, `SyncEngine` con `indiceExterno` = `motorVoz.indiceSegmentoVoz()`. Mismos valores que
  YouTube: volumen de la voz 100 % y del original 12 %, ritmo automático encendido.
- [ ] El subtítulo: en cada cambio de línea, `{ tipo: 'subtitulo', texto }` al puente. En el panel, las tres
  líneas (anterior, actual, siguiente) con `TranscriptionDisplay` (cópialo a `motor/` si lo usas, sumándolo a
  la lista y a las huellas).
- [ ] **Controles del panel:** Doblar / Detener; voz Mujer / Hombre; acento (es-CO por defecto; es-MX,
  es-AR, es-CL, es-PE, es-US); volumen de la voz; volumen del original; «Ritmo automático»; «Subtítulo sobre
  el video»; «Seguir doblando la siguiente clase» (encendido). Todo con `label`, foco visible, navegable con
  teclado y botones de ≥ 44 px.
- [ ] **Estados que siempre se ven** (`TRAMPAS.md` §8): «Abre una clase de Udemy», «Activa una vez los
  subtítulos en inglés (botón CC de Udemy) y vuelve a pulsar Doblar» (si no hubo `.vtt` ni cues),
  progreso con barra, «Listo», «La voz se está preparando…», errores de red o de voz en palabras simples, y
  «Si cierras este panel, el doblaje se apaga».
- [ ] **Velocidad que Udemy revierte:** si tras una orden de velocidad la página informa otra tasa 3 veces
  seguidas en 10 s, se apaga el ritmo automático en esta clase y se avisa: «Udemy no deja cambiar la
  velocidad; la voz irá un poco más rápida». Nunca un bucle de órdenes.
- [ ] **Siguiente clase:** con «Seguir doblando» encendido, al llegar el aviso `clase` se cierra la sesión
  actual y se abre otra con los subtítulos de la nueva clase **cuando la persona le dé play** (no antes).
- [ ] **Detener** (o cerrar el panel): aborta todo, `restaurar` y quita el subtítulo.

### Tarea 8 — Subtítulo sobre el video
- [ ] En `udemy.js`, un host con `attachShadow({ mode: 'closed' })` dentro del contenedor del reproductor,
  para que también se vea en pantalla completa (si `document.fullscreenElement` cambia, se mueve dentro).
- [ ] Estilo copiado de `.yt-caption` de `index.html` (`~1435` y la regla de pantalla completa `~3971`) (no inventar otro, restricción 4), con
  `pointer-events: none` para no robar clics a los controles de Udemy.
- [ ] Si el dueño apaga «Subtítulo sobre el video», el host se quita del DOM.

### Tarea 9 — Pruebas de navegador (`tests/verificar_udemy_doblaje.mjs`)
- [ ] Playwright con `chromium.launchPersistentContext` y `--disable-extensions-except` /
  `--load-extension=extension-udemy`. **Nunca contra udemy.com real**: `context.route('https://www.udemy.com/**')`
  sirve una página falsa (`tests/fixtures/udemy/clase.html`) con un `<video>` local y una pista `.vtt`, y
  `https://*.udemycdn.com/**` sirve el `.vtt`. La API apunta a un servidor falso local vía `jg_api_base`.
- [ ] El panel se abre como pestaña (`chrome-extension://<id>/panel.html?tab=<id>`): la lógica es la misma.
- [ ] Comprobaciones mínimas:
  1. La voz arranca y el subtítulo muestra la línea que se oye.
  2. **A1:** 0 peticiones de la extensión a `www.udemy.com` (cuenta en `context.on('request')` las que no
     sean de la página falsa).
  3. **A2:** ≤ 1 petición extra al `.vtt` por clase.
  4. **A7:** tras Detener y tras cerrar el panel, `volume`, `muted` y `playbackRate` vuelven a los originales.
  5. **A10:** ningún cuerpo enviado a la API contiene `udemy`, el id del curso ni el de la clase.
  6. Clase sin subtítulos en inglés → mensaje visible, sin peticiones a la API.
  7. Cambio de clase (la página falsa cambia la URL con `history.pushState` y reemplaza el `<video>`) →
     nueva sesión solo tras play.
  8. Velocidad revertida por la página → el ritmo automático se apaga con aviso, sin bucle.
- [ ] En `test_udemy_doblaje.mjs`, las pruebas estáticas de A3, A4, A5, A6, A8, A9 y A12 (grep sobre
  `extension-udemy/` sin contar `motor/`, y el conjunto exacto de permisos del manifiesto).

### Tarea 10 — Prueba real del dueño (⛔ PARADA)
- [ ] Entrégale un paso a paso de 5 líneas y esta lista para marcar:
  - [ ] Una clase de 5+ min suena en español de principio a fin, sin frases cortadas.
  - [ ] Pausar, adelantar y retroceder en Udemy: la voz lo sigue.
  - [ ] Pantalla completa: el subtítulo se ve.
  - [ ] Pasar a la siguiente clase: al darle play, se dobla sola.
  - [ ] Detener: el video vuelve a su volumen y velocidad.
  - [ ] Nada raro en la cuenta durante unos días (sin avisos ni cierres de sesión).
- [ ] Si algo falla, pide el diagnóstico (Tarea 1) de esa clase y la salida de `jgDoblajeDiagnostico()` en la
  consola del panel (clic derecho en el panel → Inspeccionar). Expón esa función en `panel.js`, igual que en
  la app.

### Tarea 11 — Cierre
- [ ] `CAMBIOS_UDEMY.md`: qué es, por qué es una extensión (§1), reglas anti-bloqueo (§2), fuente de
  subtítulos elegida con el diagnóstico real, pruebas y conteos, y límites conocidos.
- [ ] `AGENTS.md`: sección «Udemy (extensión)» con las reglas A1-A12 en 6-8 líneas, cómo recopiar el motor
  (`node extension-udemy/copiar_motor.mjs`) y las dos pruebas nuevas en la tabla de verificación.
- [ ] `.vercelignore`: `extension-udemy/`.
- [ ] Si cometiste un error nuevo, añádelo a `TRAMPAS.md`.
- [ ] Corre todo: unitarias de YouTube/X con sus números de línea base, `test_udemy_doblaje`,
  `verificar_udemy_doblaje`. **No hay despliegue a Vercel** (no cambió nada servido). Commit, `merge --ff-only`
  a `main`, `git push origin main` y `git log --oneline origin/main..HEAD` vacío.

---

## 7. Límites conocidos (decirlos, no esconderlos)

- **Cuota de voz.** Azure F0 da 500.000 caracteres al mes gratis y lo comparte toda la app. Una hora de clase
  hablada son unos 45.000-55.000 caracteres en español, así que **unas 10 horas de clases al mes agotan
  Azure**. Después el servidor pasa solo a edge-tts (gratis, pero con demoras variables). Medir y anotar en
  `CAMBIOS_UDEMY.md` cuánto gasta una clase real.
- **Clases sin subtítulos en inglés:** no se doblan en esta versión. Transcribir el audio de la pestaña
  sería otra fase y otro análisis.
- **Si Udemy cambia su reproductor**, el diagnóstico de la Tarea 1 es la herramienta para ver qué cambió.
  Por eso se queda en el panel.
- **Garantía anti-bloqueo:** no existe al 100 %. La extensión no hace nada que una persona viendo su clase
  no haga, y eso es todo lo que se puede prometer.

## 8. Foco de revisión (para quien revise el trabajo)

1. `udemy.js`: ¿alguna petición, clic, navegación o lectura de cookies? (A1, A3, A6)
2. `manifest.json`: ¿permisos exactos y sin `web_accessible_resources`? (A5, A12)
3. ¿`motor/` idéntico a `js/youtube/` y `js/youtube/` sin cambios en el diff?
4. ¿El video queda como estaba tras Detener y tras cerrar el panel? (A7)
5. ¿Cada error se ve en el panel con palabras simples?
