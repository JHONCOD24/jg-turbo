# Transcripción de YouTube · historial de cambios y operación

## Corrección 2026-08-16 (2) · ventanas de tiempo infladas y techo de confianza

Diagnóstico hecho sobre un video real de 52 min (`AQ_Iqo3UYMk`, 1331 segmentos)
consultando el endpoint de producción.

### Hallazgo 1 · los `endTime` venían inflados al doble

YouTube deja cada línea de subtítulo en pantalla mientras entra la siguiente, así
que los finales se solapan con el inicio del segmento siguiente. Medido:

| | Antes | Después |
|---|---|---|
| Duración media declarada | 4,69 s | 2,34 s |
| Tiempo total declarado | 103,9 min (**200 %** del video) | 52,0 min (100 %) |
| Unidades de voz que invaden la siguiente | 608 de 609 | **0** |
| Ritmo real a doblar (mediana) | 10,7 car/s | 16,2 car/s |

El texto **no** se duplicaba (solo el 0,2 % de los pares repetía alguna palabra):
lo que se duplicaba era el tiempo. El motor leía «tengo 4,69 s para esta frase»
cuando en realidad tenía 2,34 s, así que hablaba demasiado despacio y cada frase
invadía la siguiente, acumulando desfase a lo largo del video.

Corregido en `normalizarSegmentos()` con `recortarSolapes()`: el final de cada
segmento se recorta al inicio del siguiente, con un mínimo de 0,25 s. Es el punto
único por el que pasan los tres formatos (Supadata, transcript-api y Whisper).

### Hallazgo 2 · la confianza tenía un techo de 0,798

La evidencia real del video fue solo `lexico (0,72)` + `proveedor (0,62)` = 0,798.
Cuando la transcripción llega por Supadata no hay metadato de si la pista es
automática, y `defaultAudioLanguage` está bloqueado para las IP de Vercel. Con eso,
**ningún video podía alcanzar el umbral de 0,85**: la app habría preguntado siempre.

Solución: leer las pistas desde el reproductor del navegador, que consulta YouTube
con la IP doméstica del usuario y no está bloqueado. Una pista `kind: 'asr'` la
genera YouTube escuchando el audio, así que su idioma es el idioma hablado (0,92).
Con esa señal el mismo video pasa de 0,798 a más de 0,90 y se acepta sin preguntar;
si la pista automática delata otro idioma, el conflicto tumba la confianza y no se
dobla. El reproductor ahora se crea **antes** de decidir, lo que además muestra el
video más pronto.

Ambos cambios son aditivos: si el reproductor no expone sus pistas (API no
documentada, tarda hasta 2,4 s), se sigue sin esa señal y todo funciona igual.

## Mejora 2026-08-16 · doblaje solo de audio en inglés, con el video de protagonista

### Encargo

Procesar **solo** videos cuyo audio original esté en inglés, doblarlos al español
con sincronía cercana a la voz original, y que el foco sea escuchar: nada de una
transcripción lateral que reduzca el tamaño del video.

### Causas verificadas en el código anterior

- **No existía detección del idioma del audio.** `transcriptionService.js` pedía
  `language: 'en'` y validaba `datos.language`, que es el idioma de la **pista de
  subtítulos**, no del audio. Y `api/index.py` hacía `next(iter(listado))` cuando
  no encontraba la pista preferida: cualquier pista servía. Un video hablado en
  español con subtítulos traducidos al inglés pasaba el filtro y se «doblaba».
- **El video ocupaba la mitad.** `index.html`, sobre 760 px:
  `grid-template-columns:minmax(0,1.06fr) minmax(0,.94fr)` → video al ~53 %.
- **La sincronía no podía sostenerse.** Los bloques de voz duraban 26–34 s con
  avance interpolado, así que la deriva se medía en segundos. `calcularVelocidadAudio`
  solo aceleraba, con tope 4x: como el español ocupa más que el inglés, casi
  siempre aceleraba y la voz podía volverse ininteligible.
- El video se **pausaba** al esperar un bloque de voz, y `mute()` eliminaba música
  y efectos del audio original.

### Solución entregada

**Idioma (nuevo módulo `api/deteccion_idioma.py`, compartido por Vercel y local)**

- Detección por señales con peso según lo que cada una demuestra del *audio*:
  idioma declarado por YouTube (0,97) · pista automática, que YouTube genera
  escuchando el audio (0,92) · léxico sobre texto de ASR (0,90) · léxico general
  (0,72) · pista manual, que puede ser traducción (0,55).
- Señales que se contradicen bajan la confianza; señales que coinciden la suben.
- La respuesta del servidor incluye `audio_language`, `audio_language_confidence`,
  `audio_language_evidence` y los umbrales, para que el navegador no los invente.
- Reglas de negocio: **≥85 %** en inglés dobla · **60–85 %** pregunta al usuario
  antes de gastar procesamiento · **<60 % o distinto de inglés** no dobla y explica
  qué idioma detectó.
- `_elegir_pista_cronometrada` prefiere la pista del idioma hablado en vez de
  «la primera que haya».

**Interfaz**

- Video a ancho completo (97 % del panel en escritorio, 91 % en móvil).
- La transcripción vive en un desplegable cerrado por defecto.
- Subtítulo opcional sobre el video (apagado por defecto).
- Volumen independiente para la voz en español y para el audio original, que se
  recuerdan entre sesiones.
- Insignia del idioma detectado con su porcentaje de certeza.

**Sincronía**

- Unidades de voz de 3 a 8 s cortadas en punto o coma, en vez de bloques de 26–34 s.
- Velocidad bidireccional acotada a 0,85–1,35x: la voz ya no se acelera hasta
  volverse ininteligible.
- Objetivo de ±150 ms: por debajo no se toca nada; entre 150 y 400 ms se corrige
  con un ajuste de velocidad del ±6 % que no se oye; por encima de 400 ms se salta.
- Gracia de 450 ms para que una frase termine su última sílaba.
- El colchón se mide en **segundos de video resueltos** (objetivo 120 s), no en
  número de bloques, porque el generador de voz tarda entre 1 y 41 s por fragmento.
- Si la reproducción alcanza al generador, **suena el audio original**; el video ya
  no se congela.
- El audio original baja a 12 % en vez de silenciarse: la música se conserva.
- El motor mide su propio desfase y publica promedio, p95 y % dentro de objetivo.

### Lo que no es posible (y no se promete)

Clonar la voz original (haría falta el PCM del audio: la IFrame API no lo entrega,
y descargarlo choca con los ToS de YouTube y con el bloqueo de IP a Vercel ya
medido), separar voz de música, y sincronía labial. La alternativa real para lo
primero es asignar una voz distinta por hablante.

### Pruebas

- `tests/test_youtube_sync.mjs`: velocidades acotadas, ajuste fino, percentiles,
  unidades cortas, colchón por segundos y reglas de idioma. OK.
- `backend/tests/test_deteccion_idioma.py`: 10 casos, incluido el bug original
  (audio en español con subtítulos manuales en inglés). OK.
- `backend/tests/test_supadata_youtube.py` y `test_youtube_subs_parse.py`: OK.
- Layout verificado con Playwright en 1366 px y 390 px, sin scroll horizontal.

## Corrección 2026-08-15 · traducción fiel y voz sin estiramiento

### Problema reportado

La voz española sonaba robótica, pausada y poco coherente. El pulido automático
alteraba palabras y contexto; se solicitó traducir el inglés tal cual al español
y limitar cualquier corrección al mínimo indispensable.

### Causa verificada

- El doblaje enviaba cada traducción a `/improve`. Los fragmentos cortos podían
  convertirse en oraciones cerradas y acumular puntos o pausas artificiales.
- Cuando un MP3 español era más corto que su ventana, `dubbingEngine` lo
  ralentizaba y reposicionaba proporcionalmente para llenar todo el intervalo.
  Esa combinación estiraba la voz y generaba correcciones audibles.

### Solución entregada

- El doblaje ya no llama a **Pulir**. El texto visible y la voz salen directamente
  de la traducción fiel.
- Nuevo campo aditivo `TranslateRequest.literal`. YouTube lo envía en `true`.
- El prompt literal prohíbe parafrasear, pulir, resumir, completar fragmentos,
  eliminar repeticiones o añadir puntuación inexistente.
- Los marcadores `[[JG_SEG_000000]]` se conservan una vez, en orden. Los segmentos
  vecinos sirven como contexto, pero el texto nunca se mueve entre timestamps.
- **Pulir** continúa disponible como acción manual general, ahora con reglas
  mínimas: ortografía y puntuación inequívoca, sonidos alargados y repetición
  exacta accidental. No elimina «o sea», «digamos» o «bueno».
- Los bloques de voz crecen hasta 34 segundos y buscan terminar en un cierre de
  idea. Esto reduce cortes entre frases.
- La reproducción nunca ralentiza un MP3 por debajo de la velocidad seleccionada
  del video. Si acaba antes, deja silencio; solo acelera cuando el español no cabe.
- La corrección de deriva usa el avance real de ambos reproductores y tolera
  380 ms antes de reposicionar, evitando saltos pequeños y constantes.

### Pruebas

- Cinco suites JavaScript: OK.
- 54 pruebas dirigidas del backend: OK.
- Casos nuevos: prompt literal conectado en Vercel y backend local, marcadores
  intactos, repeticiones conservadas, Pulir mínimo y voz corta sin estiramiento.
- Sintaxis de ocho módulos, JavaScript embebido y ambos backends: OK.
- Navegador visible 390 × 844: sin casilla de pulido automático, texto de
  traducción fiel, ocho módulos y sin desborde horizontal.
- Service worker: `jg-turbo-shell-v27`.

### Despliegue

- Deploy funcional: `dpl_7gF3pF5KUAXvLNGQjg1VUgAvVNv9` · `READY` · producción.
- Dominio real verificado: versión 2.20.0, solicitud literal activa, sin casilla
  ni importación del pulido automático, módulo anterior con respuesta 404,
  service worker v27 y `/api/health` saludable.
- Navegador visible en producción: ocho módulos YouTube y cero errores de consola.
- No se ejecutó un doblaje completo con servicios externos para no consumir
  créditos. La validación auditiva queda pendiente con un video real del usuario.

---

## Entrega 2026-08-15 · pulido conservador antes del doblaje

### Pedido

La traducción podía conservar muletillas, repeticiones o palabras mal reconocidas.
El texto debía pasar por **Pulir** antes de generar la voz, mejorando claridad y
redacción sin cambiar el sentido, la disposición de segmentos ni sus tiempos.

### Solución entregada

- Nueva opción marcada por defecto: **Pulir antes de generar la voz**.
- El flujo queda: transcripción inglesa con tiempos, traducción al español,
  pulido conservador, subtítulos sincronizados y voz española.
- `polishingService.js` procesa hasta ocho segmentos por lote con marcadores
  `[[JG_SEG_000000]]`. Cada marcador debe volver exactamente una vez, en el mismo
  orden, y ninguna palabra puede moverse a otro segmento.
- El pulido solo cambia `text`. `startTime`, `endTime` y `duration` se copian sin
  modificación.
- Se eliminan muletillas sin contenido, tartamudeos, falsos inicios y
  repeticiones accidentales. Las repeticiones intencionales se conservan.
- Se corrigen ortografía, concordancia, puntuación, frases rotas y palabras mal
  reconocidas únicamente cuando la solución es clara por el contexto.
- No se permite resumir, mover ideas, cambiar ejemplos ni agregar información.
- Antes de aceptar cada resultado se comprueban longitud, cifras, porcentajes,
  correos y URLs. Un lote inválido se reintenta por segmento; si sigue siendo
  inseguro, se conserva la traducción anterior y el resto continúa.
- La voz y el texto visible reciben el mismo texto pulido.

### Optimización de la opción general Pulir

Los prompts de `/api/improve` y `/improve` ahora comparten el mismo contrato
conservador. También respetan glosario, párrafos, saltos, listas, hechos, cifras,
nombres, URLs, formalidad y orden de ideas. El modo segmentado es aditivo mediante
`preserve_segments`; los clientes anteriores siguen funcionando sin enviarlo.

### Pruebas

- Cinco suites JavaScript: OK.
- `tests/test_youtube_sync.mjs`: marcadores, tiempos intactos, cifras protegidas,
  recuperación individual y conservación ante salida insegura: OK.
- 53 pruebas dirigidas del backend: OK.
- Sintaxis del JavaScript embebido, nueve módulos y ambos backends: OK.
- Navegador visible en 390 × 844: opción accesible, marcada por defecto, módulo
  cargado y sin desborde horizontal. Los dos 404 locales fueron `/ping` y
  `/api/tts-voices`, rutas ausentes en el servidor estático de prueba.
- Service worker: `jg-turbo-shell-v26`.

### Despliegue

- Deployment funcional: `dpl_8Dr52vhh1vXqVJsEFr9uYwy6H9bV` · `READY` ·
  target `production` · alias `https://jg-turbo.vercel.app`.
- Dominio real: marcador `JG Turbo v2.19.0`, casilla
  `ytPolishBeforeDubbing`, contrato `preserve_segments`, módulo
  `polishingService.js` HTTP 200, SW v26 y `/api/health` con `status: ok`.
- Navegador visible contra producción: nueve módulos YouTube cargados, opción
  marcada, botón habilitado con URL válida y cero errores de consola.
- No se ejecutó una transcripción, traducción, pulido o síntesis real durante la
  comprobación para no consumir créditos externos.

---

## Entrega 2026-08-15 · doblaje sincronizado inglés → español

### Pedido

La reproducción sincronizada no debía limitarse a mostrar texto en español. El
video debía escucharse con voz española alineada con el audio inglés, incluyendo
pausa, búsqueda y cambios de velocidad.

### Solución entregada

- El botón principal ahora dice **Traducir y doblar al español**.
- La traducción conserva sus timestamps y además se agrupa en bloques de voz de
  hasta 18 segundos o 360 caracteres. Esto reduce llamadas sin convertir todo el
  video en un único audio propenso a deriva.
- `dubbingService.js` genera tres bloques iniciales y deja dos trabajadores
  preparando el resto. Cada error queda aislado por bloque.
- `dubbingEngine.js` usa un elemento `Audio`, silencia YouTube mientras el
  doblaje está activo y restaura el audio original al desactivarlo.
- La posición de cada MP3 se calcula desde `player.getCurrentTime()`. El ritmo se
  ajusta con `duracionAudio × velocidadVideo / duracionBloqueVideo`, con corrección
  de deriva superior a 220 ms.
- Al pausar o almacenar en búfer se pausa la voz. Después de buscar, el motor
  selecciona el bloque correspondiente y coloca el MP3 en el punto proporcional.
- **Reproducir con voz en español** es un clic explícito para cumplir las
  restricciones de reproducción automática de los navegadores móviles.
- Se reutilizan la voz, el acento y el tono ya guardados en `jg_tts_*`. No se
  agregó ninguna clave ni dependencia.

### Módulos nuevos

| Archivo | Responsabilidad |
|---|---|
| `js/youtube/dubbingService.js` | Agrupación, síntesis progresiva, caché y liberación de MP3 |
| `js/youtube/dubbingEngine.js` | Silencio del original, reproducción, velocidad, búsqueda y corrección de deriva |

También se amplió `YouTubePlayer.js` con `playVideo`, `pauseVideo`, `mute`,
`unMute` e `isMuted`, nombres verificados en la documentación vigente de
YouTube IFrame Player API.

### Pruebas

- Cinco suites JavaScript de regresión: OK.
- `tests/test_youtube_sync.mjs`: agrupación de voz, cálculo temporal, velocidad
  y reutilización de bloques: OK.
- Sintaxis del JavaScript embebido y de ocho módulos YouTube: OK.
- 37 pruebas dirigidas de YouTube, Supadata y voces Fish: OK.
- Navegador real local: módulos HTTP 200, control visible y móvil 390 × 844 sin
  desborde horizontal.
- La suite total del backend no terminó dentro del límite de 180 segundos; no
  produjo una salida útil. Se sustituyó por las 37 pruebas dirigidas anteriores.
- Service worker: `jg-turbo-shell-v25`.

### Despliegue

- Deployment funcional y verificado: `dpl_6PgZ9E7UfjFsjh2NnWQ4KXUpicKx` · `READY` ·
  target `production` · alias `https://jg-turbo.vercel.app`.
- Dominio real: HTML con marcador `JG Turbo v2.18.0`, botón `ytDubbingBtn`,
  TTS GET con `source`, SW v25 y `/api/health` con `status: ok`,
  `youtube_auto: true`, `groq_configured: true`.
- Navegador real contra producción: ocho módulos YouTube cargados, cero errores
  de consola y botón **Traducir y doblar al español** habilitado con URL válida.
- No se lanzó una transcripción, traducción o síntesis real durante esta
  verificación para no consumir créditos externos.

---

## Entrega 2026-08-15 · traducción sincronizada inglés → español

### Pedido

Extender el panel existente para obtener una transcripción inglesa con tiempos,
traducirla al español por segmentos y mostrar cada fragmento en sincronía con un
reproductor embebido. La sincronización debía continuar correcta al cambiar la
velocidad y el flujo histórico de texto plano debía permanecer intacto.

### Solución entregada

- Nuevo botón **Traducir al español y sincronizar**, independiente de
  **Transcribir video**.
- `YouTubeRequest.include_timestamps` es aditivo y vale `false` por defecto. El
  contrato anterior no cambia.
- `youtube-transcript-api` conserva `start` y `duration`; Supadata se pide con
  `text=false` y convierte `offset`/`duration` de milisegundos a segundos.
- Los trabajos largos conservan segmentos en `GET /api/youtube-job` cuando se
  solicita `include_timestamps=true`.
- La traducción usa la puerta existente `/api/translate`. Envía lotes pequeños
  con marcadores estables; si un lote pierde correspondencia, reintenta cada
  segmento y aísla el fallo sin cancelar los demás.
- El reproductor usa YouTube IFrame Player API. El motor consulta
  `getCurrentTime()`, escucha `onStateChange` y `onPlaybackRateChange`, y muestra
  el segmento cuyo intervalo cumple `startTime <= currentTime < endTime`.
- El polling usa `requestAnimationFrame`, se detiene en pausa/final y vuelve a
  iniciar con reproducción. No recalcula tiempos por velocidad: el reloj leído
  sigue siendo el tiempo propio del video.
- Interfaz responsive con texto anterior y siguiente, indicador de estado,
  velocidad real y selector limitado a las tasas que YouTube reporta como
  disponibles.

### Módulos

| Archivo | Responsabilidad |
|---|---|
| `js/youtube/transcriptionService.js` | URL, API, trabajos largos y normalización de timestamps |
| `js/youtube/translationService.js` | Lotes, traducción y recuperación por segmento |
| `js/youtube/YouTubePlayer.js` | Wrapper de YouTube IFrame Player API |
| `js/youtube/syncEngine.js` | Búsqueda binaria, polling y estados |
| `js/youtube/TranscriptionDisplay.js` | Render seguro del contexto y segmento activo |
| `js/youtube/youtubeSyncController.js` | Integración del flujo con el panel existente |

### Documentación externa verificada

- YouTube IFrame Player API: `YT.Player`, `onReady`, `onStateChange`,
  `onPlaybackRateChange`, `getCurrentTime`, `getPlaybackRate`,
  `getAvailablePlaybackRates` y `setPlaybackRate`.
- Supadata `/transcript`: `text=false`, `content[].offset` y
  `content[].duration` en milisegundos, además del trabajo asíncrono.

### Pruebas

- `py_compile` sobre API Vercel, Supadata, parser de YouTube y backend local: OK.
- 42 pruebas dirigidas del flujo YouTube: OK.
- Suite completa del backend: 95 aprobadas, 2 omitidas.
- `tests/test_youtube_sync.mjs`: búsqueda temporal, URL, normalización,
  traducción por lotes y fallo aislado: OK.
- Cinco suites JavaScript de regresión ejecutadas por separado: OK.
- Sintaxis de los seis módulos y del JavaScript embebido: OK.
- Navegador real: módulos cargados, layout de escritorio y móvil sin desborde.
- Service worker: `jg-turbo-shell-v24`.

### Variables de entorno

No se añadió ninguna clave nueva. Se reutilizan:

- `SUPADATA_API_KEY` para videos bloqueados o sin subtítulos.
- `GROQ_API_KEY` como respaldo Whisper con timestamps.
- Una clave de traducción existente: `MISTRAL_API_KEY`, `GEMINI_API_KEY` o
  `GOOGLE_API_KEY`, `OPENROUTER_API_KEY`, `XAI_API_KEY`/`GROK_API_KEY`, o
  `ANTHROPIC_API_KEY`. También se respetan las credenciales guardadas por el
  usuario en el navegador.

### Despliegue

- Primer deploy `dpl_FHJS7aNaLASRUdH9AAe8o97jZprS`: HTML, API y health
  correctos, pero Vercel no publicó los archivos `.mjs`; detectado por la
  verificación del dominio real antes del cierre.
- Corrección: módulos ES con extensión `.js` y `js/youtube/package.json` con
  `type: module`.
- Deployment funcional verificado: `dpl_8YVarJF2CLpFcb1hndqnLhjoCtc8`.
- Dominio real `https://jg-turbo.vercel.app`: HTML 200, marcador `ytSyncBtn`,
  controlador `.js`, seis módulos HTTP 200, `sw.js` v24 y `/api/health` con
  `status: ok`, `youtube_auto: true`, `groq_configured: true`.
- Navegador real contra producción: seis módulos cargados, cero errores de
  consola y botón sincronizado habilitado al pegar una URL válida. No se lanzó
  una transcripción real para no consumir créditos externos durante esta prueba.

---

**Fecha de esta entrega:** 2026-08-01  
**Estado:** en producción · https://jg-turbo.vercel.app  
**Cambio de fondo:** la transcripción de YouTube vuelve a ser **automática**. Pegar el enlace basta; el pegado manual pasa a ser red de seguridad.  
**Documento maestro del feature YouTube** (léelo antes de “arreglar” la extracción automática).

---

## 1. Resumen ejecutivo (qué cambió y por qué)

### Problema

La app pedía al usuario **abrir YouTube, copiar la transcripción a mano y pegarla**. Lento y confuso para usuarios no técnicos, y peor todavía en celular (que es como navega la mayoría en LATAM).

La causa: YouTube **bloquea a las IP de centros de datos**. Vercel es un centro de datos, así que sus peticiones se rechazan. Toda la cadena automática (subtítulos → scraping → yt-dlp → audio) moría en ese muro.

### Qué se hizo

Se añadió **Supadata** como vía principal: un servicio que sale por su propia infraestructura (YouTube no la bloquea) y que, si el video no tiene subtítulos, **lo transcribe con IA por su cuenta**. Con eso los dos problemas (bloqueo y falta de subtítulos) se resuelven en una sola llamada.

| Área | Qué se hizo |
|---|---|
| Cadena backend | Gratis primero → **Supadata** → yt-dlp + Whisper → pegado manual |
| Videos largos | Trabajo en segundo plano (`202` + `job_id`) + nuevo `GET /api/youtube-job` |
| Módulo nuevo | `api/supadata.py`: un solo cliente para Vercel y para el backend local |
| UX | El pegado manual deja de anunciarse como «siempre funciona»; ahora es «¿Este video no funcionó?» y está plegado |
| Configuración | Todo por variable de entorno `SUPADATA_API_KEY`. **Sin ella, la app se comporta exactamente como antes** (no rompe nada) |
| Salud | `GET /api/health` expone `youtube_auto` (booleano, nunca la clave) |
| Pruebas | `backend/tests/test_supadata_youtube.py` (28 pruebas, sin red) |

### Honestidad técnica

Lo que decía la versión anterior de este documento —«no es posible sin proxy residencial de pago»— era **medio cierto**: el problema es real, pero la conclusión («la única salida es el navegador del usuario») no lo era. Un proveedor externo resuelve el bloqueo sin proxy propio y sin mantenimiento. Lo que sigue siendo cierto: **desde una IP de Vercel, sin ayuda externa, YouTube no entrega el texto**.

---

## 2. Diagnóstico (medido 2026-08-01 contra producción real)

Todas las mediciones son contra `https://jg-turbo.vercel.app`, no en local, y con los logs de la función de Vercel a la vista.

### 2.1 Tasa de éxito antes del cambio

| Video | Resultado |
|---|---|
| `dQw4w9WgXcQ` | **200 OK** (0,8–1,6 s) vía `youtube-transcript-api` |
| `jNQXAC9IVRw` | 503 |
| `kJQP7kiw5Fk` | 503 |
| `9bZkp7q19f0` | 503 |
| `fJ9rUzIMcZQ` | 503 |
| `iG9CE55wbtY` | 503 |

**1 de 6 (17 %).** Y el único que pasaba es probablemente el video más consultado del mundo, es decir, contenido que YouTube ya tiene cacheado en el borde. Para videos de nicho la tasa real tiende a cero.

### 2.2 El bloqueo es determinista, no mala suerte

Esto descarta la solución fácil («reintentar más veces»):

| Prueba | Intentos | Resultado |
|---|---|---|
| `jNQXAC9IVRw` repetido | 5 | **5 de 5 fallaron** (503) |
| `dQw4w9WgXcQ` repetido | 3 | **3 de 3 pasaron** (200) |

### 2.3 Error exacto de cada método (logs de la función)

| # | Método | Excepción / código real |
|---|---|---|
| 1 | `youtube-transcript-api` (innertube) | `RequestBlocked` — evento `youtube.subtitulos_api_bloqueada`, ~1,4 s |
| 2 | Scraping de `watch` + `timedtext` | Sin excepción: devuelve `(None, None)`. La página no trae `captionTracks` utilizables |
| 3 | `yt-dlp` metadatos/subtítulos | `DownloadError: ERROR: [youtube] <id>: Sign in to confirm you're not a bot. Use --cookies-from-browser or --cookies for the authentication.` |
| 4 | `yt-dlp` audio + Whisper Groq | **Nunca se alcanza**: la cadena aborta en el paso 3 con 503 a los ~3 s |

Registro literal de un fallo completo:

```json
{"evento": "youtube.inicio", "video_id": "iG9CE55wbtY", "prefer_subtitles": true, "fast_mode": true}
{"evento": "youtube.subtitulos_api_bloqueada", "video_id": "iG9CE55wbtY", "error_type": "RequestBlocked"}
{"evento": "youtube.subtitulos_ip_bloqueada", "video_id": "iG9CE55wbtY", "error_type": "RequestBlocked", "elapsed_ms": 1457}
{"evento": "youtube.metadata_error", "video_id": "iG9CE55wbtY", "error_type": "DownloadError",
 "error": "ERROR: [youtube] iG9CE55wbtY: Sign in to confirm you're not a bot…", "elapsed_ms": 2314}
```

---

## 3. Las tres alternativas investigadas (2026-08-01, con fuente)

### 3.1 Proxy residencial (Webshare) — descartada como vía principal

- **Precio**: 3,50 USD/GB para 1 GB (con 50 % de descuento vigente; 7,00 USD sin descuento); baja hasta 1,40 USD/GB en volumen. Fuente: <https://www.webshare.io/residential-proxy>
- **Cómo encaja**: el código ya tiene `YOUTUBE_PROXY_URL` conectada a `youtube-transcript-api` y a yt-dlp. Activarla es pegar una URL.
- **Por qué no gana**:
  1. **Fiabilidad irregular**: hay reportes de `RequestBlocked` *usando* residencial rotativo de Webshare (issue [#504](https://github.com/jdepoix/youtube-transcript-api/issues/504), cerrado sin respuesta pública). La documentación insiste en «Residential», no «Static Residential», lo que ya indica lo frágil del asunto.
  2. **No resuelve los videos sin subtítulos**: para esos habría que bajar el audio *a través del proxy* (caro en GB) y pasarlo por Whisper dentro del límite de 60 s de Vercel.
  3. **Mantenimiento**: recargar ancho de banda, vigilar consumo y reaccionar cuando YouTube endurezca. Trabajo recurrente para alguien no técnico.

### 3.2 PO Token con `bgutil-ytdlp-pot-provider` — descartada

- **Estado hoy**: el proyecto sigue mantenido, pero la propia documentación advierte que **pasar PO tokens ya no salta el control anti-bot en la mayoría de los casos**, y que tener un token no garantiza evitar los 403 — especialmente desde IP de centro de datos. Fuente: <https://github.com/Brainicism/bgutil-ytdlp-pot-provider>
- **Además, no cabe aquí**: exige un servicio Node/Rust **corriendo permanentemente** junto a yt-dlp. Una función serverless de Vercel de 60 s no puede alojarlo; habría que pagar un servidor aparte solo para eso.

### 3.3 Servicio especializado (Supadata) — **elegida**

- **Precio** (fuente: <https://supadata.ai/pricing>):

  | Plan | Precio | Créditos/mes |
  |---|---|---|
  | Free | 0 USD, sin tarjeta | 100 peticiones |
  | Basic | 5 USD | 300 |
  | Pro | 17 USD | 3 000 |
  | Mega | 47 USD | 30 000 |

- **Consumo**: `1 transcripción = 1 crédito`; `1 minuto generado por IA = 2 créditos`.
- **API** (fuente: <https://docs.supadata.ai/api-reference/endpoint/transcript/transcript.md>): `GET https://api.supadata.ai/v1/transcript`, cabecera `x-api-key`, parámetros `url`, `lang`, `text`, `mode`.
- **`mode=auto`** = usa los subtítulos si existen y **los genera con IA si no**. Esto es exactamente el requisito «si no hay subtítulos, que caiga sola a transcripción por audio».
- **Videos de más de 20 minutos** → responde `202` con `jobId`; se consulta `GET /v1/transcript/{jobId}` hasta `status: completed`.

**Por qué ganó**: es la única de las tres que resuelve el bloqueo **y** la ausencia de subtítulos, arranca en 0 USD, y no deja infraestructura que mantener.

---

## 4. Arquitectura nueva

### 4.1 Cadena del endpoint `POST /api/youtube`

| Orden | Vía | Para qué | Costo | Si falla |
|---|---|---|---|---|
| 1 | `youtube-transcript-api` + scraping | Videos que YouTube sí deja pasar | Gratis | Sigue al 2 |
| 2 | **Supadata `mode=auto`** | Caso normal; genera con IA si no hay subtítulos | 1 crédito (2/min con IA) | Sigue al 3 |
| 3 | yt-dlp subtítulos → audio + Whisper Groq | Respaldo si Supadata no responde | Gratis | Sigue al 4 |
| 4 | Pegado manual en la UI | Red de seguridad | Gratis | — |

El paso 1 va **antes** de Supadata a propósito: cuando YouTube responde (videos muy populares) no se gasta un crédito. Con el plan gratuito de 100/mes eso importa.

Errores de **cuenta** (clave inválida, créditos agotados, plan insuficiente) cortan la cadena con **HTTP 402** y mensaje explícito: reintentar con otro método no los arregla y sería engañoso echarle la culpa al video.

### 4.2 Videos largos sin chocar con el límite de 60 s

```
navegador ──POST /api/youtube──▶ función Vercel ──▶ Supadata
                                       │
                              ¿202 + jobId?
                                       │
                    espera hasta 22 s dentro de la función
                                       │
                 ┌─────────────────────┴─────────────────────┐
            ¿terminó?                                   ¿sigue?
                 │                                           │
          200 + texto                          202 + job_id ──▶ el navegador
                                                              consulta cada 3 s
                                                              GET /api/youtube-job?id=…
                                                              (hasta 4 minutos)
```

### 4.3 Contrato de API (para quien toque el frontend)

| Ruta | Respuesta | Significado |
|---|---|---|
| `POST /api/youtube` | `200` `{text, language, title, source, …}` | Texto listo (igual que antes) |
| `POST /api/youtube` | `202` `{pending:true, job_id, title, message}` | Video largo en proceso |
| `POST /api/youtube` | `402` `{detail}` | Problema de cuenta de Supadata |
| `POST /api/youtube` | `503` `{detail}` | Todo falló; el frontend abre el pegado |
| `GET /api/youtube-job?id=…` | `200` texto · `202` `{pending:true}` · `502` error | Consulta de video largo |
| `GET /api/health` | `youtube_auto: true|false` | Si la vía automática está configurada |

---

## 5. Flujo de usuario (producción actual)

### 5.1 Vía normal (automática)

1. Pestaña **YouTube** → pega el enlace.
2. Pulsa **«Transcribir video»**.
3. El texto aparece listo para **Copiar · Corregir · Traducir · Escuchar · .txt · Pulir**.

Si el video dura más de 20 minutos verás **«Video largo: transcribiendo…»** mientras se procesa en segundo plano.

### 5.2 Red de seguridad (pegado manual)

Sigue existiendo, plegada, bajo **«¿Este video no funcionó? Pega el texto tú mismo»**. Solo se abre y resalta sola cuando un video concreto falla. Ya no se anuncia como «siempre funciona» ni como el camino esperado.

### 5.3 Bookmarklet: eliminado (2026-07-31, tarde)

El «Atajo opcional para computador (marcador)» **se quitó por completo**. Razones:

- Mostraba un enlace `javascript:…` que parecía un botón roto y **confundía** al usuario (fue la queja explícita).
- Solo funcionaba en computador (no en celular, donde navega la mayoría en LATAM).
- Quedó **redundante**: «Pegar del portapapeles» hace lo mismo de un clic y sin trucos.

Se borraron sus tres piezas: el `<a id="ytBookmarklet">`, su CSS (`.yt-manual-advanced`, `.yt-bookmarklet`) y su JS (`prepararBookmarkletYt`). Si en el futuro se quiere un atajo, hágase como extensión o botón real, no como bookmarklet a la vista.

### 5.4 Traducir

- Selector **«Idioma del texto final»** del panel YouTube se aplica al pegar (si no es “Mismo idioma”).
- En el resultado: botón **Traducir** / «Más acciones» (móvil).

---

## 6. Inventario técnico de esta entrega (2026-08-01)

### 6.1 Archivos modificados

| Archivo | Cambio |
|---|---|
| `Spech to text App/api/supadata.py` | **Nuevo.** Cliente de Supadata (módulo puro, sin FastAPI) |
| `Spech to text App/api/index.py` | Paso Supadata en la cadena, endpoint `GET /api/youtube-job`, `_respuesta_subtitulos()`, `youtube_auto` en `/api/health`, mensajes de error |
| `Spech to text App/api/requirements.txt` | Sin cambios: Supadata usa `requests`, que ya estaba |
| `Spech to text App/backend/app.py` | Respaldo por Supadata cuando yt-dlp falla en local (import tolerante a fallos) |
| `Spech to text App/index.html` | `jgEsperarTrabajoYoutube()`, manejo de `202`, textos del pegado como respaldo |
| `Spech to text App/backend/tests/test_supadata_youtube.py` | **Nuevo.** 28 pruebas sin red |
| `Spech to text App/backend/tests/test_api_youtube_bloqueo.py` | Sin cambios (sigue verde con los mensajes nuevos) |
| `Spech to text App/CAMBIOS_YOUTUBE.md` · `FICHA_TECNICA.md` · `DOCUMENTACION_DESPLIEGUE.md` | Arquitectura, manual y variables |
| `COORDINACION_AGENTES.md` (raíz) | Registro del dueño de `index.html` |
| `vercel_deploy/*` | Copia espejo para el deploy |

### 6.2 Funciones nuevas

| Función / ruta | Qué hace |
|---|---|
| `supadata.transcribir(url, idioma)` | `GET /v1/transcript` con `mode=auto`; devuelve texto o `job_id` |
| `supadata.estado_job(job_id)` | `GET /v1/transcript/{jobId}`; traduce `queued/active/completed/failed` |
| `supadata.esperar(job_id, segundos)` | Espera acotada; `None` si sigue en proceso |
| `supadata.configurado()` | `True` si hay `SUPADATA_API_KEY` |
| `supadata.elegir_idioma(recibido, disponibles)` | En modo «auto», evita que llegue un idioma arbitrario (ver § 8.4.1) |
| `SupadataError.es_de_cuenta` | Distingue «problema de cuenta» de «problema del video» |
| `_respuesta_subtitulos(...)` (api/index.py) | Una sola forma de la respuesta de texto (antes se repetía 3 veces) |
| `GET /api/youtube-job?id=…` | Consulta de video largo desde el navegador |
| `jgEsperarTrabajoYoutube(jobId)` (index.html) | Consulta cada 3 s hasta 4 min con progreso visible |

### 6.3 Variables de entorno

| Variable | Obligatoria | Valor | Para qué |
|---|---|---|---|
| `SUPADATA_API_KEY` | **Sí** (para que sea automático) | La clave de <https://supadata.ai> | Vía principal |
| `SUPADATA_BASE_URL` | No | `https://api.supadata.ai/v1` | Solo si Supadata cambia de dominio |
| `SUPADATA_TIMEOUT_S` | No | `30` | Tiempo máximo por petición |
| `SUPADATA_ESPERA_SERVIDOR_S` | No | `22` | Cuánto espera la función antes de delegar en el navegador |
| `YOUTUBE_PROXY_URL` | No | `http://usuario:clave@servidor:puerto` | Sigue disponible; ya no hace falta |

Sin `SUPADATA_API_KEY` la app **no se rompe**: se comporta como antes (cadena gratuita + pegado manual), y `/api/health` responde `youtube_auto: false`.

---

## 7. Inventario histórico (entrega UX del 2026-07-31)

### 7.1 Archivos modificados

| Archivo | Cambio |
|---|---|
| `Spech to text App/index.html` | UI YouTube, CSS scroll, JS portapapeles/guía/bookmarklet |
| `Spech to text App/sw.js` | `CACHE_SHELL` → **`jg-turbo-shell-v8`** (cache-bust PWA; antes v7) |
| `Spech to text App/CAMBIOS_YOUTUBE.md` | Este documento (maestro del feature) |
| `Spech to text App/FICHA_TECNICA.md` | Manual de uso del panel YouTube actualizado |
| `Spech to text App/DOCUMENTACION_DESPLIEGUE.md` | Procedimiento deploy + registro de release |
| `Spech to text App/Agents.md` | Puntero YouTube / deploy (si aplica) |
| `COORDINACION_AGENTES.md` (raíz monorepo) | Dueño de `index.html` liberado tras el cierre |
| `vercel_deploy/*` | Copia espejo de lo anterior para deploy |

### 7.2 UI / HTML (IDs y bloques nuevos o renombrados)

| ID / clase | Rol |
|---|---|
| `#ytManual` | `<details>` “Pegar transcripción…” |
| `#ytManualTitulo` | Título del bloque (cambia si el servidor falla) |
| `#ytGuide` | Guía rápida al abrir el video |
| `#ytStepsDefault` | Pasos por defecto (se ocultan cuando hay guía) |
| `#ytPasteInput` | Textarea para pegar manualmente |
| `#btnYtPasteClip` | **Pegar del portapapeles** (acción principal) |
| `#btnYtUsePaste` | Usar el texto ya escrito en el recuadro |
| `#btnYtOpenVideo` | Abrir enlace en YouTube + mostrar guía |
| `#ytPasteHint` | Mensajes de ayuda / error de pegado |
| ~~`#ytBookmarklet`~~ | **Eliminado** (era el marcador `javascript:…`) |
| ~~`.yt-manual-advanced`~~ | **Eliminado** (contenedor del atajo) |
| `.yt-source-badge.pegado` | Badge “pegada” en el título del resultado |

### 7.3 JavaScript (funciones clave)

| Función | Qué hace |
|---|---|
| `jgLimpiarTranscripcionPegada(crudo)` | Quita marcas de tiempo, SRT/VTT, repeticiones, tags karaoke |
| `jgActualizarAccionesPegado()` | Habilita/deshabilita botones según URL y texto |
| `jgMostrarGuiaYt(activa)` | Muestra/oculta la guía rápida |
| `jgAplicarTextoPegadoYt(texto)` | Limpia, pinta resultado, traduce si aplica, scroll al resultado |
| Listener `#btnYtPasteClip` | `navigator.clipboard.readText()` + aplica |
| Listener `#btnYtOpenVideo` | `window.open` + guía + foco en paste |
| ~~`prepararBookmarkletYt()`~~ | **Eliminada** junto con el bookmarklet |
| Listeners `details.result-listen` | `scrollIntoView` al abrir «Escuchar» |
| Catch de `/youtube` | Si hay bloqueo → abre y resalta pegado |

### 7.4 CSS (scroll y layout)

| Regla | Efecto |
|---|---|
| `.yt-area.has-results` / `.file-area.has-results` | `overflow-y: auto` (antes `hidden` cortaba el pie) |
| `#ytResultArea` / `#fileResultArea` con `has-results` | `overflow-y: auto` + touch scrolling |
| `.yt-area.has-results .yt-manual` | `display: none` (no roba altura del resultado) |
| `.yt-area.has-results #ytServerWarn` | Oculto con resultados |
| `.result-listen[open]` | `scroll-margin-bottom` + JS scroll |
| Estilos `.yt-guide` | Claridad visual del flujo de pegado (`.yt-manual-advanced` y `.yt-bookmarklet` eliminados) |

### 7.5 Backend / API

**Sin cambio de enfoque en esta entrega UX.** Se mantiene lo ya documentado:

- Bloqueos `RequestBlocked` / `IpBlocked` no deben dejar al usuario sin salida (el frontend redirige a pegar).
- Variable opcional `YOUTUBE_PROXY_URL` para salida por proxy residencial.
- Rutas: `POST /api/youtube`, health con `youtube_transcript_api`, etc.

---

## 8. Validación realizada (2026-08-01)

### 8.1 Código local

| Comprobación | Comando | Resultado |
|---|---|---|
| Pruebas del backend | `python -m pytest backend\tests -q` | **46 passed, 2 skipped**, 0 failed (362 s) |
| Pruebas nuevas del feature | `backend/tests/test_supadata_youtube.py` | **22 passed** (sin red, sin gastar créditos) |
| Compilación Python | `py_compile api\index.py api\supadata.py api\calidad_linguistica.py backend\app.py` | OK |
| Sintaxis del JS embebido | `node --check` sobre el bloque `<script>` | OK (281 513 caracteres) |
| Sincronización origen ↔ deploy | `Get-FileHash` de 11 archivos | Todos idénticos |
| Búsqueda de secretos | patrones `sd_`, `sk-`, `gsk_`, `AIza` en lo desplegado | **Sin coincidencias** |

**Regresión detectada por una prueba antigua** (y corregida): el mensaje de error nuevo
había perdido las palabras «bloqueó» / «anti-bot», que son las que el frontend usa
(`/bloque[oó]|bot|Sign in|datacenter/i`) para abrir el pegado de respaldo.
`test_doble_bloqueo_responde_503` lo cazó. **Se arregló el mensaje, no la prueba.**

### 8.2 Producción (dominio real, no la URL temporal del CLI)

| Comprobación | Resultado |
|---|---|
| `https://jg-turbo.vercel.app` | HTTP **200**, 482 105 bytes |
| `jgEsperarTrabajoYoutube` en el HTML servido | presente |
| `'/youtube-job?id=' + encodeURIComponent(jobId)` | presente |
| `data.pending && data.job_id` | presente |
| `ytPasteInput` / `btnYtPasteClip` (red de seguridad) | presentes |
| «Pegar transcripción de YouTube (siempre funciona)» | **ausente** (retirado ✓) |
| `sw.js` → `CACHE_SHELL` | **`jg-turbo-shell-v9`** (antes v8) |
| `GET /api/health` | `status: ok` · `model_ready: true` · `groq_configured: true` · `youtube_auto: false` |
| `GET /api/youtube-job` sin `id` | HTTP 400 «Falta el identificador del trabajo.» (la ruta existe) |
| `GET /api/ping` · `/api/session-config` | ok |

### 8.3 Lo que ya funcionaba y sigue funcionando

Verificado tras el despliegue para descartar regresiones:

| Función | Comprobación | Resultado |
|---|---|---|
| Cadena gratuita de YouTube | `POST /api/youtube` con `dQw4w9WgXcQ` | **200** en 1,2 s |
| Traducir | `POST /api/translate` en→es | `ia_used: true`, integridad **100** |
| Escuchar (TTS) | `GET /api/tts-voices` | Gonzalo CO · Dalia MX · Aria · Andrew — v2.6.3 intacta |
| Configuración de sesión | `GET /api/session-config` | límites y proveedor correctos |

### 8.4 Pruebas de video en producción (2026-08-01, con `youtube_auto: true`)

Ejecutadas contra `https://jg-turbo.vercel.app` una vez configurada `SUPADATA_API_KEY`.
Antes de este cambio, **cinco de estos seis videos devolvían HTTP 503**.

| # | Caso | Video | Pedido | HTTP | Tiempo | Resultado |
|---|---|---|---|---|---|---|
| 1 | Español con subtítulos | Luis Fonsi – Despacito (`kJQP7kiw5Fk`) | `es` | **200** | 4 s | 2 964 car · ~649 palabras · `lang=es` |
| 2 | Inglés con subtítulos | TED · Ken Robinson (`iG9CE55wbtY`) | `en` | **200** | 3 s | 17 574 car · ~3 170 palabras · `lang=en` |
| 3 | Largo, 26 min | JSConf · event loop (`8aGhZQkoFbQ`) | `auto` | **200** | 4 s | 22 156 car · ~4 107 palabras · `lang=en` |
| 4 | Auto con pistas raras | Me at the zoo (`jNQXAC9IVRw`) | `auto` | **200** | 6 s | 217 car · `lang=en` (antes devolvía **alemán**) |
| 5 | Comprobación extra | Gangnam Style (`9bZkp7q19f0`) | `auto` | **200** | 4 s | 251 car |
| 6 | Comprobación extra | Mark Rober (`hFZFjoX2cGg`) | `auto` | **200** | 8 s | 18 501 car · ~3 241 palabras |

**6 de 6 (100 %)**, frente al **1 de 6 (17 %)** medido antes del cambio (§ 2.1).

**Nota sobre el video largo:** el de 26 minutos respondió `200` directo, sin pasar por
el trabajo en segundo plano. El `202` no depende de la duración sino de que Supadata
tarde: con subtítulos nativos los entrega al instante. El camino del `202` está cubierto
por pruebas automáticas (`test_video_largo_devuelve_202_con_identificador`,
`test_endpoint_de_trabajo_entrega_el_texto`) pero **aún no se ha ejercitado en producción**.

**Pendiente:** un video **sin subtítulos**, para ver la generación por IA de punta a
punta. Los seis videos probados los tienen (todo contenido popular los tiene), así que
hace falta un enlace concreto de un video sin subtítulos para cerrar ese caso.

### 8.4.1 Fallo encontrado y corregido durante estas pruebas

**Síntoma:** con «Auto», el video `jNQXAC9IVRw` (hablado en inglés) devolvía el texto
**en alemán**.

**Causa:** documentada en la propia API — «*Preferred language code of the transcript
(ISO 639-1). If not provided, the first available language will be returned*». Sin `lang`,
la primera pista disponible es arbitraria, y **no existe ningún parámetro ni campo que
identifique el idioma original del video**.

**Arreglo** (`supadata.elegir_idioma()` + reintento en `api/index.py`): con «Auto», si el
idioma recibido no es español ni inglés pero alguno de los dos está en `availableLangs`,
se vuelve a pedir explícitamente ese. Consecuencias, para que nadie se sorprenda:

- Se prefiere **español**, luego **inglés**, y si no hay ninguno se respeta lo que venga
  (un video solo en francés sigue llegando en francés).
- Un video en inglés con pista española disponible llegará **en español** con «Auto».
  Quien quiera el original elige el idioma en el selector, que se respeta sin reintento.
- El reintento solo ocurre en ese caso concreto; con idioma explícito no se gasta un
  crédito de más.
- Si el reintento se convierte en trabajo en segundo plano, se conserva el texto que ya
  se tenía: peor idioma es mejor que hacer esperar de nuevo al usuario.

Cubierto por 6 pruebas nuevas en `backend/tests/test_supadata_youtube.py`.

### 8.5 Deployment de referencia (actual)

| Campo | Valor |
|---|---|
| Deployment id | `dpl_3aJ8j4FVq5AcCgNPDgF2MyK3Dvjo` |
| Build URL | `jg-turbo-iytq9t8lh-jhoncod24s-projects.vercel.app` |
| Alias producción | **https://jg-turbo.vercel.app** |
| Estado | READY · production · 2026-08-01 |
| Proyecto Vercel | `jg-turbo` (`prj_EfuyBt2YDNqQNVaKif9DKUjpVaz8`) |
| Deployment previo del mismo día | `dpl_34yXmSrubcBY7zeSBadFzSnNLxrh` · `jg-turbo-pf0ek3413-…` |

Anteriores: `dpl_7rJqUX9CTxVgbLgb8bZiGS5wTVCg` (2026-07-31) · inspect `HpXBnyKNvCKHbS2NYtWvNSD8aRpP`

---

## 9. Procedimiento de despliegue (obligatorio)

**Nunca** desplegar desde la raíz del monorepo (`JG Turbo/`). Eso sube ~1000 archivos y deja **404 NOT_FOUND** en el dominio de producción.

```bash
# Desde cualquier sitio:
npx vercel --prod --yes --cwd "ruta/a/vercel_deploy"

# O bien:
cd vercel_deploy
npx vercel link --project jg-turbo --yes   # si no está vinculado a jg-turbo
rm -f .env.local                           # no subir el OIDC del link
npx vercel --prod --yes
```

### Checklist post-deploy

1. `https://jg-turbo.vercel.app` responde HTML (no 404).
2. El HTML contiene al menos un marcador del cambio (`jgEsperarTrabajoYoutube`, `btnYtPasteClip`…).
3. `https://jg-turbo.vercel.app/sw.js` tiene el `CACHE_SHELL` esperado.
4. `https://jg-turbo.vercel.app/api/health` → `status: ok` **y `youtube_auto: true`**
   (si sale `false`, falta `SUPADATA_API_KEY` o falta redesplegar tras añadirla).
5. `POST /api/youtube` con un video normal devuelve **200 con texto** sin tocar nada más.
6. Que no se rompió lo de siempre: `POST /api/translate`, `GET /api/tts-voices`, `/api/session-config`.
7. Probar en ventana privada (evita SW viejo): pegar enlace → **Transcribir video**.

### Sincronización previa

```
Spech to text App/index.html        →  vercel_deploy/index.html
Spech to text App/sw.js             →  vercel_deploy/sw.js
Spech to text App/api/index.py      →  vercel_deploy/api/index.py
Spech to text App/api/supadata.py   →  vercel_deploy/api/supadata.py
Spech to text App/api/youtube_subs.py       →  vercel_deploy/api/youtube_subs.py
Spech to text App/api/calidad_linguistica.py →  vercel_deploy/api/calidad_linguistica.py
Spech to text App/api/requirements.txt      →  vercel_deploy/api/requirements.txt
Spech to text App/vercel.json       →  vercel_deploy/vercel.json
docs del feature                    →  vercel_deploy/
```

Verificar con `Get-FileHash` que cada par coincide antes de desplegar.

### Incidente de esta sesión (documentado)

1. Un `vercel link` accidental desde la **raíz** del monorepo + deploy → **404** en producción (~1–2 min).
2. Corrección: borrar `.vercel` de la raíz, desplegar con `--cwd vercel_deploy` vinculado a **`jg-turbo`** (44 archivos, no 1069).
3. Alias restaurado y verificado.

---

## 10. Registro de releases YouTube

| Fecha | Qué | Producción |
|---|---|---|
| 2026-07-31 (mañana) | Vía pegar + bookmarklet inicial (agente Claude) | `dpl_EK7U5jpzgzXBsVms4VA1VYfPaWae` (histórico) |
| 2026-07-31 (tarde) | UX clara: portapapeles, guía, scroll, SW v7 | inspect `SDxcNRfUS6tTEZDspBv3Ap8Lciwq` · `jg-turbo-o2inaftkp-…` |
| 2026-07-31 (docs) | Documentación completa + redeploy con paquete docs | inspect `HpXBnyKNvCKHbS2NYtWvNSD8aRpP` · `jg-turbo-f00desh03-…` |
| 2026-07-31 (cierre) | **Bookmarklet eliminado** del todo · SW v8 · docs | inspect `7rJqUX9CTxVgbLgb8bZiGS5wTVCg` · `jg-turbo-b0f347cc2-…` |
| 2026-08-01 (código) | **Vía automática con Supadata** · `api/supadata.py` · `GET /api/youtube-job` · SW v9 | `dpl_34yXmSrubcBY7zeSBadFzSnNLxrh` · `jg-turbo-pf0ek3413-…` |
| 2026-08-01 (cierre) | Título conservado en videos largos + documentación completa | `dpl_3aJ8j4FVq5AcCgNPDgF2MyK3Dvjo` · `jg-turbo-iytq9t8lh-…` · **actual** |

---

## 11. Traducción de las transcripciones

> **El feature Traducir tiene su propio documento maestro: `CAMBIOS_TRADUCCION.md`.**
> Ahí está el arreglo del 2026-08-01 (troceo en el navegador para textos de
> cualquier tamaño, tras medir un `504 FUNCTION_INVOCATION_TIMEOUT` con 39 732
> caracteres) y el del validador de cifras. Lo que sigue es el historial del
> 2026-07-31, que se conserva por contexto.

### 11.1 Corrección traducción completa (2026-07-31 · tarde)

### Síntoma reportado

Al pegar una transcripción de YouTube y pulsar **Traducir**, el resultado mezclaba
**inglés + español**, dejaba marcas `0:00` / `0:01` y no era “solo el texto traducido”.

### Causas

1. **MyMemory por trozos** devolvía el inglés original cuando un trozo fallaba → mezcla.
2. Textos muy largos sin puntos (típico de YouTube) se partían mal y quedaban a medias.
3. A veces se traducía el pegado **crudo** (con horas) sin pasar por el limpiador.

### Fix

| Capa | Cambio |
|---|---|
| Frontend | `jgLimpiarTranscripcionPegada` más agresivo; `jgPrepararTextoParaTraducir` antes de cada traducción; al pulsar Traducir se limpian horas en pantalla |
| API `/api/translate` | `_limpiar_transcripcion_youtube_cruda`; MyMemory **no mezcla** (si falla un trozo → `None`); detector `_traduccion_parece_incompleta`; IA por **bloques** en textos largos; prompt “solo la traducción completa” |
| Tests | `backend/tests/test_translate_completo.py` (5 passed) |
| SW | `jg-turbo-shell-v8` |

Resultado esperado: **solo el texto traducido de toda la transcripción**, sin horas y sin bilingüe.

---

## 12. Cómo activar la vía automática (guía para el dueño de la app)

Sin esto la app **funciona igual que antes** (pegado manual). Con esto, pegar el
enlace basta. Son 2 minutos y no pide tarjeta.

1. Entra a <https://supadata.ai> y crea la cuenta (*Sign up*, con Google o correo).
2. En el panel, copia tu **API key**.
3. Abre <https://vercel.com/jhoncod24s-projects/jg-turbo/settings/environment-variables>
   → **Add New**:
   - **Key**: `SUPADATA_API_KEY`
   - **Value**: la clave copiada
   - **Environments**: **Production**
   - **Save**
4. **Vuelve a desplegar** (Vercel solo entrega las variables nuevas en el siguiente
   despliegue):
   ```bash
   npx vercel --prod --yes --cwd vercel_deploy
   ```
5. Comprobar: <https://jg-turbo.vercel.app/api/health> debe decir **`"youtube_auto": true`**.

**Qué cuesta.** El plan gratuito da 100 videos al mes sin tarjeta. Si se queda corto:
5 USD/mes = 300 videos · 17 USD/mes = 3 000. Un video **sin** subtítulos consume más
(2 créditos por minuto de video) porque hay que transcribirlo con IA.

**Cuándo sabrás que se acabaron los créditos.** La app lo dice con todas sus letras
(HTTP 402: «Se agotaron los créditos de Supadata este mes») en vez de culpar al video.

**La clave nunca va en el código.** Solo vive en las variables de entorno de Vercel.
Si alguna vez aparece en `index.html`, `api/*.py` o en Git, hay que rotarla de inmediato.

---

## 13. Pendiente

1. **Ejecutar las 4 pruebas de video** en producción (ver § 8.4): bloqueadas hasta que
   exista `SUPADATA_API_KEY`.
2. **Caché de transcripciones**: hoy pedir dos veces el mismo video gasta dos créditos.
   Con 100 créditos gratis al mes, esto es ahorro directo.
3. **Mostrar créditos restantes** en la app, para no enterarse por un error.
4. **Commitear el árbol de trabajo a Git**: producción va **delante** de git en varias
   features (ver `DOCUMENTACION_DESPLIEGUE.md`). Riesgo real si hay que revertir.
5. Backend local (`backend/app.py`): `cookiesfrombrowser` para pruebas en casa (no aplica en Vercel).
6. `YOUTUBE_PROXY_URL` sigue disponible como plan C si algún día Supadata falla; ya no
   hace falta para el funcionamiento normal.

---

## 14. Coordinación multi-agente

- `index.html` es **monolítico**: un solo agente lo edita a la vez (`COORDINACION_AGENTES.md`).
- Esta entrega **reclamó y liberó** el dueño de `index.html`. Los cambios fueron
  quirúrgicos: una función nueva (`jgEsperarTrabajoYoutube`), el manejo del `202` y los
  textos del bloque de pegado. **No se tocó layout, colores ni tipografía.**
- Otros agentes pueden trabajar en `api/*`, `backend/*` y tests, pero **no** reescribir
  el bloque YouTube sin leer este documento.
- Al tocar el frontend de YouTube, respetar el contrato de § 4.3: el `202` y el `402` son
  nuevos y sin ellos los videos largos y el aviso de créditos se rompen en silencio.

---

## 15. Enlaces útiles

### Del proyecto

| Recurso | URL / ruta |
|---|---|
| App en producción | https://jg-turbo.vercel.app |
| Health (incluye `youtube_auto`) | https://jg-turbo.vercel.app/api/health |
| Deploy how-to | `DOCUMENTACION_DESPLIEGUE.md` |
| Manual de uso | `FICHA_TECNICA.md` § Panel YouTube |
| Cliente Supadata | `api/supadata.py` |
| Pruebas del feature | `backend/tests/test_supadata_youtube.py` |
| Persistencia `jg_*` | `CONFIG_PERSISTENTE.md` |
| TTS | `CAMBIOS_TTS.md` (v2.6.3, no tocado en esta entrega) |
| Protocolo multi-agente | `COORDINACION_AGENTES.md` (raíz del monorepo) |

### Fuentes externas consultadas el 2026-08-01

Todas las cifras de precio y de fiabilidad de este documento salen de aquí. Si alguien
va a rehacer la decisión, **volver a consultarlas**: cambian rápido.

| Tema | Fuente |
|---|---|
| Precios y créditos de Supadata | <https://supadata.ai/pricing> |
| API de transcripción (parámetros, `mode`, errores) | <https://docs.supadata.ai/api-reference/endpoint/transcript/transcript.md> |
| Consulta de trabajos (`jobId`, estados) | <https://docs.supadata.ai/api-reference/endpoint/transcript/transcript-get.md> |
| Comportamiento de `mode=auto` y videos +20 min | <https://docs.supadata.ai/get-transcript.md> |
| Precio de proxies residenciales | <https://www.webshare.io/residential-proxy> |
| Fallo de proxy residencial con esta librería | <https://github.com/jdepoix/youtube-transcript-api/issues/504> |
| Estado real del PO Token | <https://github.com/Brainicism/bgutil-ytdlp-pot-provider> |
| Librería de subtítulos usada en el paso gratuito | <https://github.com/jdepoix/youtube-transcript-api> |
