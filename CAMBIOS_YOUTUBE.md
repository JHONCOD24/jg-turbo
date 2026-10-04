# Transcripción de YouTube · historial de cambios y operación

## v168 (2026-10-04) · Subtítulo dinámico y pantalla completa

- **Estilo «Dinámico (1-2 líneas)»** (por defecto) o «Completo», en los ajustes del doblaje
  (`#ytEstiloSubtitulo`, clave `jg_yt_subtitulo_estilo`). El segmento se parte en trozos de
  ≤ 2 renglones medidos con `canvas.measureText` y la fuente real (`TranscriptionDisplay.js`,
  lógica pura en `subtituloDinamico.js`). Corte: fin de oración, luego `, ; :`; nunca palabras.
- **Al ritmo de la voz:** `DubbingEngine.progresoSegmentoVoz()` da `{indice, progreso}` (tramo
  hablado medido, `hablaVoz.js`); `SyncEngine` llama `onTic` en cada tic de su reloj (no rAF).
  El avance se reparte por costo de habla (letras + pausas), no por número de trozos. Sin voz,
  sigue al reloj del video dentro del segmento.
- **Alto fijo de 2 renglones** (el video no salta). `.yt-caption[hidden]` lleva `!important`.
- **Pantalla completa:** `--yt-ancho` sale de la proporción 16:9 con CSS; el subtítulo va pegado
  debajo y con el ancho de la imagen; con `max-height:500px` se superpone en su tercio inferior.
  Corregido de paso el respaldo `.yt-pantalla-completa` (TRAMPAS: `fixed` dentro de `transform`).
- **Teléfono horizontal:** con un doblaje abierto se ocultan encabezado y pestañas y la imagen
  llena el alto visible; en Android, `screen.orientation.lock('landscape')` al entrar en pantalla
  completa (con try/catch; iPhone no lo soporta).
- Pruebas: `test_subtitulo_dinamico` 43 · `verificar_subtitulos_video` 192.

## v166 (2026-10-02) · Un tramo que no se pudo traducir se vuelve a pedir al reabrir

**Síntoma.** En un video ya doblado, uno o varios tramos sonaban en el idioma
original **siempre**, por más que se volviera a abrir. Medido el 2026-10-02:
3 de 36 subtítulos, causados por la protección de tecnicismos de v165 (arreglada
en el mismo v166: `terminosWeb.js`, `CAMBIOS_TTS.md` §v166).

**Causa.** Un segmento que no se pudo traducir queda `null` en
`motor.traducciones` (correcto dentro de la sesión: evita reintentar en bucle),
pero `guardarSesion` lo guardaba así en `doblajes` y, al reabrir,
`MotorPreparacion.sembrar` lo metía en el mapa: `paso()` usa `traducciones.has(i)`,
así que un `null` contaba como traducido. Lo mismo en las descargas
(`frasesParaArchivo` → `traducirTodo({ ya })`). Arreglar el traductor no reparaba
lo ya guardado (TRAMPAS.md §1.4).

**Arreglo (compatible hacia atrás, sin almacén nuevo, base `jg_youtube` sigue en v2).**
- `translationService.js`: `traduccionesReutilizables(entradas, intentosFallidos)`
  deja fuera los `null` (se vuelven a pedir) y `anotarIntentos` lleva la cuenta.
- Tope `MAX_INTENTOS_TRADUCCION = 3` **aperturas**: un segmento que la IA rechaza
  siempre deja de pedirse a la tercera y no quema cuota. Dentro de una apertura se
  intenta una sola vez, como antes.
- El registro de `doblajes` gana un campo aditivo `intentosFallidos`
  (`[[indice, n]]`). `traducciones` conserva su formato (`[[indice, texto|null]]`):
  la extensión de Udemy y la búsqueda de la biblioteca lo siguen leyendo igual.
- `MotorPreparacion.sembrar(entradas, intentosFallidos = [])`: el segundo
  argumento es opcional; un registro viejo sin él trata cada `null` como 0 intentos.

**Pruebas.** `test_youtube_doblaje` 139 → **150 OK** (11 nuevas: el `null` sembrado
se vuelve a pedir y queda traducido, lo traducido no se repaga, el tope, un intento
por apertura, registros viejos sin datos y la descarga). La prueba falló antes del
arreglo («pedidos: ninguno»). Batería y despliegue (`dpl_FotRxMbBhFA559XXYBuTSByo9rT4`): `CAMBIOS_TTS.md` §v166.

## v159 (2026-09-29): continuaciones completas antes de la voz

El ejemplo «siempre / y cuando» viaja en una sola sintesis cuando sus unidades
contiguas no terminan en puntuacion, sin saltos reales ni cambios de hablante.
Limites: 18 s / 600 caracteres. No se reindexa el arreglo vivo: las unidades
absorbidas quedan sin voz y con tiempo final ordenado. La prueba ejecuta el
motor real, comprueba una sola sintesis, subtitulos por segmento, salto dentro
de la frase y regeneracion al retroceder: 14 OK. Descargas usan la misma union.
YouTube conserva 139 unitarias, sincronia 74 y navegador 110; X 70 y 24.

Ava y Andrew se eligen por video sin pisar la voz del PDF. El adaptador pide
modo multilingue tambien al descargar. El glosario opcional para ingles-español
vive en el punto comun de traduccion. No borra traducciones guardadas ni cambia
IndexedDB. Una frase unida tiene un texto distinto y regenera solo su audio.
Version frontend/SW v159. Publicacion y limites de escucha en `CAMBIOS_TTS.md`.


## Mejora 2026-09-28 (v157) · La voz entra centrada y lo guardado no se vuelve a medir

Pedido del dueño: las mejoras 2 y 3 propuestas tras la auditoría v156.

**1. Adelanto de arranque (`ANTICIPO_ARRANQUE_S = 0.08`, `dubbingEngine.js`).** El
motor mira cada 100 ms y la frase entraba con 0,03 s de adelanto. Con inicios que
caen entre dos tics (lo normal en un video) llegaba tarde, y a eso se suman los
~30-50 ms que tarda el navegador en sonar tras `play()`. Medido en el simulador:

| Adelanto | Arranque medio | p95 | Lo más temprano |
|---|---:|---:|---:|
| 0,03 s (v156) | +40 ms | +84 ms | −9 ms |
| **0,08 s (v157)** | **−10 ms** | **+35 ms** | −57 ms |
| 0,10 s | −30 ms | +17 ms | −79 ms |

Con la demora real de `play()` encima, 0,08 s deja la voz sobre los labios. Nota
para quien pruebe esto: el simulador tenía todos los inicios en múltiplos de
100 ms, justo en el tic, así que no podía ver el atraso; la prueba nueva usa
inicios cada 4,137 s.

**2. Medida guardada con la voz (`cacheDoblaje.guardarVoz(…, habla)`).** Al volver a
un video de la biblioteca, cada frase se decodificaba otra vez para medir su
silencio. Ahora la voz se guarda con su `habla` y `DubbingService` la usa tal cual
(0 decodificaciones). Las voces guardadas antes, o desde una descarga, se miden
la primera vez que suenan y se completan solas. Una medida imposible se descarta.

Pruebas: `test_youtube_sincronia` **74** (+3) · `test_biblioteca_videos` **100** (+3)
· `verificar_biblioteca_datos` **48** (+2) · `verificar_biblioteca_videos` **52** (+1)
· YouTube 139/110 · X 70/24 · PDF/TTS sin cambios · móvil 62.

Despliegue: `v157` / `jg-turbo-shell-v157` · **`dpl_EafotrCk2sVosZAvGLqRJPaFNFXa`**. En el
dominio: módulos iguales al commit, `ANTICIPO_ARRANQUE_S = 0.08` servido, y una voz real
recién generada se guardó con su medida (0,19–2,84 s de 3,6 s) y volvió idéntica.

## Corrección 2026-09-28 (v156) · La voz ya no espera su propio silencio

### Pedido del dueño

Auditar la biblioteca de videos recién entregada y dejar la sincronización de la
voz «lo más pulida posible». Las reglas de v4 no cambian: ninguna frase se corta
ni se salta, la voz manda y el video se frena solo si hace falta.

### Causa medida (contra producción, 2026-09-28)

Cada frase de voz trae **~0,21 s de silencio delante y ~0,85 s detrás**, igual en
edge-tts y en Azure: 5,54 s de archivo para 4,48 s de voz (≈19 %). Es silencio
digital: `silencedetect` corta en el mismo punto a −45, −60 y −70 dB. El motor:

- arrancaba cada frase 0,2 s después de su segundo (el silencio de delante);
- esperaba el silencio de detrás antes de dejar entrar la siguiente;
- y el plan de ritmo lo contaba como voz por decir → frenaba el video de más.

### Solución

- `js/youtube/hablaVoz.js` (puro + `medirHabla` en el navegador): dónde se habla
  dentro del audio (−60 dB, margen 0,02 s antes y 0,08 s después).
- `DubbingService` guarda `vozDesdeS`/`vozHastaS`; `duracionVoz` pasa a ser lo que
  se habla. Sin Web Audio (o si no decodifica), todo sigue como antes.
- `dubbingEngine.js` (`#tramo`): la frase arranca donde empieza la voz, se da por
  dicha al llegar al final **medido** de la voz (no «casi al final»: ver
  `TRAMPAS.md`), y el avance del subtítulo y el retraso se miden sobre la voz.
- Descargas (`exportadorDoblaje.js`): la mezcla coloca solo el tramo hablado.

### Medido

| Simulador, 40 frases con los silencios reales | Antes | v156 |
|---|---:|---:|
| Video visto en 170 s reales | 145,2 s | **170,0 s** |
| Velocidad mínima del video | 0,85× | **1×** (0 cambios) |
| Frases cortadas / saltadas | 0 / 0 | 0 / 0 |
| Retraso de la voz p95 | — | 108 ms |

Con la voz real en Chromium y Chrome (`verificar_biblioteca_datos`): 4,5 s de voz
caben en 5 s sin acelerar (antes pedía 1,15×) y la voz suena en su segundo
(1,072 s; sin recorte 1,216 s). El `<audio>` y la decodificación miden igual
(5,544 s), así que el recorte vale para el motor en vivo.

### Pruebas

`test_youtube_sincronia` **71 OK** (+6) · `test_youtube_doblaje` 139 ·
`test_x_doblaje` 70 · `verificar_youtube_doblaje` 110 · `verificar_x_doblaje` 24 ·
`test_biblioteca_videos` 97 · `verificar_biblioteca_datos` 46 ·
`verificar_biblioteca_videos` 51. Detalle de la auditoría:
`CAMBIOS_BIBLIOTECA_VIDEOS.md` §Auditoría.

### Despliegue

`v156` / `jg-turbo-shell-v156` · **`dpl_8EbXfNEPLECrn2RA2gWemshoJETS`**. En el dominio,
con voz recién generada: 0,92 s de silencio quitados por frase (edge-tts) y 0,89 s
(Azure). Pendiente del dueño: oírlo con un video real (`jgDoblajeDiagnostico()` en la
consola da el retraso y las frases saltadas).

## Corrección 2026-09-26 (v152) · Voz constante y tamaño del subtítulo

### Pedido del dueño

Con la sincronía ya aprobada («no quiero que eso cambie»): (1) al probar voces,
«suena una voz y de repente vuelve a sonar otra»; (2) poder agrandar el
subtítulo (el actual es el pequeño; uno mediano y uno grande), sin cambiar su
diseño ni su tipografía.

### Causas verificadas de la voz que cambia

- **Frases cortas con nombres** («Claude, ChatGPT.»): la red de seguridad «tramo
  solo en inglés» (cliente `ttsForzarIdiomaSiInglesPuro` y servidor
  `_tts_resolve_language`) las mandaba a una voz en-US a media escena.
- **Cambio de voz en curso:** `invalidarDesde` solo descartaba lo ya listo; lo que
  se estaba generando con la voz vieja llegaba después y sonaba intercalado.
  Igual con el relevo de Fish a neural.
- **Diálogos:** la 2.ª voz es intencional, pero no había forma de quitarla, y en
  modo automático el selector de 2.ª voz ni se respetaba.

### Solución

- `idioma_fijo` (TtsRequest y `GET /api/tts`, solo lo manda el doblaje): siempre la
  voz del idioma pedido. El resto de la app no cambia (ni su caché de audio).
- `DubbingService.versionVoz`: un audio generado con una voz anterior se descarta y
  se rehace con la nueva.
- 2.ª voz: opción «Ninguna: una sola voz para todo»; en automático se respeta la
  2.ª voz elegida a mano.
- `/api/tts-warmup` desempaquetaba 3 valores de 4 y siempre respondía «falló».
- **Tamaño del subtítulo:** Pequeño (el de siempre, 19 px en escritorio) · Mediano
  (inicial) · Grande, recordado en `jg_yt_subtitulo_tamano`. Reglas nuevas por
  `[data-tamano]`: solo cambia `font-size`; fondo, letra, peso y posición medidos
  iguales. Los selectores del panel miden ≥44 px en pantallas táctiles.
- La sincronía (motor v4) no se tocó: `test_youtube_sincronia` 65 OK sin cambios.

### Pruebas

`test_youtube_doblaje` **139 OK** · `test_youtube_sincronia` **65 OK** ·
`verificar_youtube_doblaje` **110 OK** (+8: idioma fijo, «Ninguna», tamaños y
diseño intacto) · `backend/tests/test_tts_idioma_fijo.py` **4 passed** ·
`test_tts_fish_estable.py` + `test_ia_respaldo.py` 22 passed · `test_tts_*` y
`test_pdf_voz` sin cambios (la prueba de versión ahora compara JS y caché entre sí).

### Despliegue

`v152` / `jg-turbo-shell-v152` · `dpl_3uWgYVLcwFuMCfhaK4CFu2TVFKr8` y, con el precalentamiento arreglado (sintetizaba «.» y Edge no devolvía audio), **`dpl_2a1EF9vPriohSGHWDJ9oYee6AHpM`** (vigente). Verificado en el dominio: 18/18 archivos idénticos al commit; `GET /api/tts` con «Claude, ChatGPT.» da `en-US-AvaNeural` sin `idioma_fijo` y `es-CO-SalomeNeural` con él; `/api/tts-warmup` → `ok: true` (Azure).

## Entrega 2026-09-26 · Doblaje v4: la voz no se salta nada y el ritmo es automático

### Pedido del dueño

1. La voz no iba a la par de la lectura: «empieza a leer una línea y, como ya
   pasaba la otra, deja de leerla», se saltaba trozos y no se escuchaba fluido.
   Que la voz se acomode sola al video (cambiando velocidad o de voz si hace falta;
   Fish Audio permitido).
2. El selector de velocidad no le gustó; la velocidad a mano ya funciona desde el
   engranaje de YouTube.
3. Pegar el enlace y esperar ~30 s (video largo) es mucho: más rápido.
4. **Regla:** los subtítulos (diseño, fondo, texto) NO se tocan.

### Causas medidas

- **Saltos de la voz** (`dubbingEngine.js`, motor anterior): mandaba el reloj del
  video. Al entrar en la frase siguiente se **cortaba** la voz de la anterior
  (0,45 s de gracia) y la nueva arrancaba **a mitad**. El español ocupa 20-30 % más
  que el inglés y la voz solo podía acelerar hasta 1,20×. Con el mismo simulador
  (40 frases de 4 s de video en habla continua):

  | El español necesita… | Motor anterior | Motor v4 |
  |---|---|---|
  | 0,8× (cabe) | 37/38 completas | 37/38 completas · video 1× |
  | 1,25× | 37/38 completas | 33/34 · video 0,90× |
  | **1,4×** | **0 completas · 37 cortadas a mitad** | **30/31 completas · 0 cortes** · video 0,80× |
  | 1,6× | — | 28/29 · 0 cortes · video 0,75× |

  (La frase que falta en cada caso es la que sonaba al cortar la simulación.) Un
  orador rápido real (el fixture: 18 car/s en inglés) con traducción 25 % más larga
  y una voz de 17,5 car/s necesita **1,28×**: justo donde el motor anterior cortaba.
- **Carga de 46 s** (medida en producción con `dNWkwrqAkcM`, 88 min, sesión nueva):
  `/api/youtube` 29,2 s (YouTube bloquea el paso gratuito en 1,2 s y **Supadata tarda
  ~28 s**: externo) + **15 s nuestros**: 13 llamadas a `/api/translate` con dos 500.
  Causa de los 500: la clave de Gemini bloqueada se probaba primero y un 429 de
  Mistral salía como «401», así que el navegador partía los lotes en mitades (detalle
  en `CAMBIOS_TRADUCCION.md` §2026-09-26).
- **Velocidad del reproductor** (medido con la IFrame API real): acepta pasos de 0,05
  (0,95 · 0,90 · 0,85 · 0,80 · 0,75 exactas; 0,97 → 0,95). `getAvailablePlaybackRates`
  sigue listando solo los pasos clásicos, pero los finos funcionan.

### Solución

- **Motor v4** (`js/youtube/ritmoDoblaje.js` puro + `dubbingEngine.js`): cada frase
  suena **entera** y la siguiente espera su turno (doble audio precargado). La voz
  va a su ritmo natural (1×), acelera lo justo (cómoda hasta 1,12×, techo 1,25×) y,
  si no alcanza, **el video se frena solo** mirando 20 s por delante (paso más
  cercano de 0,05, mínimo 0,75×, histéresis ±0,04 para no hacer serrucho) y vuelve a
  la velocidad elegida cuando sobra tiempo. Si el video no admite otra velocidad
  (directos), deja de pedirla y lo dice. Solo con más de 5 s de atraso se salta al
  punto del video. Mientras espera una voz que no llegó, el video no se frena.
- **Subtítulos que siguen a la voz:** muestran la línea que se OYE (fracciones de
  texto por segmento). Su diseño no se tocó (`.yt-caption` intacto).
- **«Ritmo automático»** (interruptor, encendido por defecto, `jg_yt_ritmo_auto`)
  reemplaza al selector de velocidad propio. La velocidad a mano va en el engranaje
  de YouTube: la app la respeta, la voz la acompaña y se recuerda (`jg_yt_rate`);
  lo que baja el automático no se guarda.
- **Arranque:** el texto del video ya no espera al reproductor (van en paralelo);
  la voz se precalienta (`/api/tts-warmup`) mientras Supadata trabaja; primer lote
  de traducción de 4 segmentos; hasta 2 lotes en vuelo con ≥1,1 s entre salidas;
  arranca con 10 s de voz lista (antes 20); un fallo de red repite el mismo lote a
  los 3 s (antes lo partía en mitades y esperaba 15 s).
- **Servidor:** cadena de IA por claves con cuarentena y 429 bien nombrado; el
  doblaje ya no recibe traducciones de MyMemory; marcador suelto eliminado.
- Diagnóstico de solo lectura en consola: `jgDoblajeDiagnostico()` (frases
  habladas/saltadas, retraso p95, cambios de velocidad).

### Voces (medido 2026-09-26, mismo texto de 239 caracteres a 1×)

| Voz | car/s | síntesis | | Voz | car/s | síntesis |
|---|---|---|---|---|---|---|
| Camila (PE) ♀ | 18,7 | 0,8 s | | **Gonzalo (CO) ♂** | **19,3** | 1,0 s |
| Paloma (US) ♀ | 17,8 | 0,9 s | | Lorenzo (CL) ♂ | 18,4 | 1,0 s |
| **Salomé (CO) ♀** | **17,5** | 0,9 s | | Tomás (AR) ♂ | 17,7 | 1,0 s |
| Dalia (MX) ♀ | 17,0 | 0,6 s | | Jorge (MX) ♂ | 16,7 | 0,6 s |
| Fish · JG Narradora ♀ | 16,5 | **8,3 s** | | Fish · Roberto ♂ | **23,3** | **6,1 s** |

La voz automática (Salomé/Gonzalo, Colombia) ya está entre las más ágiles: cambiar
de voz no resolvía la sincronía. Fish Roberto habla muy rápido, pero tarda 6-8 s en
preparar cada tramo y el plan gratuito tiene caídas: queda **a mano**, con la
etiqueta «(tarda más en cargar)» (antes «(más lenta)», que confundía).

### Pruebas y sus cuentas

| Batería | Resultado |
|---|---|
| `node tests/test_youtube_sincronia.mjs` (nueva) | **65 OK · 0 fallos** |
| `node tests/test_youtube_doblaje.mjs` | **136 OK · 0 fallos** (118 antes; −6 obsoletas del selector y del rango viejo, +24) |
| `node tests/verificar_youtube_doblaje.mjs` | **102 OK · 0 fallos** (94 antes; −6 del selector, +14: 0 cortes y 0 saltos en navegador, video frenado solo, subtítulo = voz) |
| Unitarias de referencia (19 archivos) | **1.192 OK · 0 fallos** (sin retroceder) |
| `backend/tests/test_ia_respaldo.py` (nueva) | **10 passed** |
| pytest YouTube/traducción (9 archivos) | 108 passed · 8 fallos **preexistentes** (6 de `test_traduccion_doblaje.py`, 2 de `prefer_fast`; comprobado con `git stash`) |
| `verificar_arranque_ligero.mjs` | 9 OK + 1 fallo preexistente (1031 KB, ajeno) |
| `verificar_movil_pantalla.mjs` / `verificar_pestanas.mjs` | 60 / 31, como antes |

### Verificado en producción con el video real (mismo instrumento, 90 s reproduciendo)

`medir_doblaje_real`: Playwright contra `https://jg-turbo.vercel.app`, reproductor
de YouTube real, traducción y voz reales, video `dNWkwrqAkcM` (88 min, inglés
rápido). Cuenta cortes de audio de verdad (pausa o cambio de `src` con la voz a
mitad y el video andando) y lee `jgDoblajeDiagnostico()`.

| | v149 (antes) | v150 | **v151 (final)** |
|---|---|---|---|
| Listo para escuchar (clic → listo) | 40,8 s | 38,4 s | **22,0 s** |
| · de eso, Supadata (registro de Vercel) | ~28 s | 25,7 s | 15,0 s |
| · de eso, lo nuestro | ~12 s | ~11 s | **~6 s** |
| Traducciones antes de sonar | 12 (con 500) | 19 | **4** |
| Frases de voz cortadas a mitad | **8** | 0 | **0** |
| Frases saltadas | — | 0 | **0** |
| Retraso de la voz (p95 / promedio) | — | 0,99 s / 0,25 s | **0,66 s / 0,17 s** |
| Velocidad del video | 1× fija | 0,75–0,95× | 0,75–0,90× (automática) |
| Llamadas de traducción en la sesión | 85 (con 500) | 47 (con 429) | **29 (sin 429)** |

La v150 ya no cortaba frases, pero la medición real destapó dos cosas que solo se
veían en el dominio (por eso hubo un segundo despliegue en la tanda): el umbral de
longitud de la traducción rechazaba traducciones correctas y partía lotes (7
llamadas por lote, ~5 s del arranque) y las mitades salían sin respetar el ritmo
de Mistral (429). v151: zona gris 0,6–0,85 con un solo reintento del lote entero,
ritmo de 1,1 s para toda llamada del traductor y arranque con la primera frase
(`VOZ_INICIAL_S = 6`). Detalle en `CAMBIOS_TRADUCCION.md` §2026-09-26 (2).

### Lo que no se puede prometer (y por qué)

- **La espera de Supadata** la primera vez: entre 15 y 28 s medidos en el mismo
  video de hora y media (servicio externo, varía). Lo nuestro bajó a ~6 s; la
  segunda vez el video sale de la caché del navegador y no espera.
- **Sincronía labial:** imposible sin el audio original (la IFrame API no lo da).
- Si el español necesitara más de ~1,67× el tiempo del inglés (video a 0,75× y voz
  a 1,25×), la voz se atrasa y, pasados 5 s, salta al punto del video.
- Que la voz «suene bien» lo mide el oído: las pruebas miden que no se corte, no
  se salte y vaya al día.

### Despliegues

| `dpl_…` | Qué entró |
|---|---|
| `dpl_HsUo1UAkTdd7Du1pbJ88HhxBXp52` | v150: motor v4, ritmo automático, cadena de IA, arranque en paralelo |
| `dpl_FFQcBqaGscwLh4s7nw1izWF4yT5G` | **v151** (`jg-turbo-shell-v151`): zona gris de la traducción, ritmo común de 1,1 s, arranque con la primera frase |

Ambos desde una copia exacta del commit (`git archive`): producción dejó de servir
archivos sin seguimiento (`debug.log`, `tmp/`, `.mcp.json`, muestras de voz de
`audio/`, docs internos: ahora 404). Verificado: 18/18 archivos idénticos al commit
(sha256), `JG_JS_V = 'v151'`, `/api/health` ok.

### Pruebas finales

`test_youtube_doblaje` **136 OK** · `test_youtube_sincronia` **65 OK** ·
`verificar_youtube_doblaje` **102 OK** · 19 unitarias de referencia **1.192 OK** ·
`test_ia_respaldo.py` **10 passed** · `verificar_pdf_navegador` 115 OK + 1 fallo
**preexistente** (aviso de OCR; idéntico en `main`, comprobado con un árbol aparte)
· `verificar_pdf_scroll` 39 · `verificar_pdf_movil` 57 · `verificar_pdf_voz_acordeon`
21 · `verificar_pdf_mini_flotante` 7 · `verificar_pdf_unir_palabras` 18 ·
`verificar_pdf_geometria` ✔.

## Corrección 2026-09-26 · El traductor ya no se auto-limita (ritmo + espera creciente)

### Falla reportada

En un video de ~30 min aparecía «El traductor pidió una pausa por límite de
uso; seguimos en unos segundos» y el video tardaba demasiado en estar listo.

### Causas verificadas

- El plan gratuito de Mistral (único proveedor activo: la clave de Gemini
  sigue bloqueada, ver entrega v3) da ~1 petición/s. Los lotes cortos de un
  video de habla rápida vuelven en menos de 1 s y el motor pedía el siguiente
  al instante: **la propia app se provocaba el 429**.
- Ante el 429, el motor reintentaba cada 15 s fijos: con el cupo lleno, cada
  reintento fallaba y el video se atascaba «en unos segundos» para siempre.
- Los lotes de traducción son los mismos de antes (salen de los mismos
  segmentos): v3.1 no agregó llamadas; solo hizo visible el límite que ya
  existía.

### Solución (`js/youtube/motorPreparacion.js`)

- **Ritmo mínimo de 1,1 s** entre llamadas de traducción (inyectable para
  pruebas): nunca se pasa de ~0,9/s. El primer lote sale al instante.
- **Espera creciente ante 429** (15 → 30 → 60 s, con tope) y mensaje honesto:
  «…(van N): seguimos en unos X s…». Un éxito olvida la racha.
- La voz sigue preparándose mientras la traducción espera (ya lo hacía).

### Pruebas

`test_youtube_doblaje.mjs` **118 OK** (ritmo ≥1,1 s, 15→30→60 s, olvido de
racha) · `verificar_youtube_doblaje.mjs` **94 OK** · referencia 1.192 OK.
T3.1 acepta +1 traducción al reabrir: el lote que volaba al Cerrar se aborta
y se repite legítimamente (misma tolerancia que T1.5).

### Nota para el dueño (capacidad real)

Si el 429 persiste varios minutos es que el cupo de Mistral está lleno de
verdad: la cura es habilitar la API de Gemini en Google Cloud (ver entrega
v3) para tener dos proveedores. Sin eso, los videos largos en hora pico
pueden ir con pausas.

### Despliegue

`v149` / `jg-turbo-shell-v149` · `dpl_4ed7JLNkQKxfB4jbabpZnpTMGcaF` (2026-09-26, READY, alias verificado: `JG_JS_V='v149'`).

## Mejora 2026-09-26 · Velocidad del video a gusto de la persona

### Pedido

La velocidad solo ofrecía los pasos de YouTube (0.25/0.5/0.75/1/…/2): no se
podía dejar en 0.97×, 0.85× u 0.80×. En videos muy rápidos, el español no cabe
y la voz se acelera hasta sonar mal; al frenar el video, cada frase tiene más
tiempo y el doblaje va más a tono. Los subtítulos no se tocaron.

### Solución

- Selector con presets finos (0.50–2: 0.80, 0.85, 0.90, 0.95, **0.97**, 1.05…)
  más lo que ofrezca YouTube, y opción **«Otra…»** con campo libre (0.25–2,
  acepta coma decimal; vacío = sin cambio).
- Se recuerda entre videos (`jg_yt_rate`) y también lo que se cambie en los
  controles del propio YouTube.
- Si YouTube redondea un valor libre, se lee la tasa REAL y se muestra esa
  (nunca miente). La voz en español la sigue sola: el motor ya multiplica por
  la velocidad del video, sin cambios.
- Lógica pura y probada en `js/youtube/syncEngine.js` (`tasasParaSelector`,
  `normalizarTasa`, `presetDeTasa`).

### Pruebas

`test_youtube_doblaje.mjs` **111 OK** · `verificar_youtube_doblaje.mjs`
**94 OK** (0.85 frena el video, 0.97 libre se aplica, tasa recordada) ·
referencia 1.192 OK sin retroceder.

### Despliegue

`v148` / `jg-turbo-shell-v148` · `dpl_EjXEsMCGuKtQNpS15yMBuKy6ZTy3` (2026-09-26, READY, alias verificado: `JG_JS_V='v148'`, campo libre en el HTML).

## Entrega 2026-09-26 · Doblaje v3.1: voz automática, 2 voces y sin frenos

### Pedido

El doblaje en español no iba a la par (frenos entre frases), las voces no
siempre eran las propicias y se pidió: mismas voces en PDF y YouTube, mejor
sincronía, más voces de referencia y voz automática según el video (hombre /
mujer, 2 voces si hay 2 interlocutores). Los subtítulos NO se tocaron: su
diseño quedó **ESTABLECIDO** por decisión del dueño (no cambiar su aspecto;
ver `FICHA_TECNICA.md` § Controles del doblaje).

### Causas verificadas

- **Frenos entre frases:** el motor usaba UN solo `<audio>`: cada frase era
  pausa + `src` + `load` + `play` (micro-corte). El lector PDF no tiene ese
  problema desde v2.8.0 porque alterna DOS audios.
- **Voz frenada:** el rango 0,90×–1,25× bajaba a «cámara lenta» audible (0,90×)
  y saltaba a «ardilla» (1,25×) entre frases.
- **Voces:** PDF y YouTube ya comparten la misma biblioteca
  (`ttsVocesParaDoblaje` = `ttsCatalogoVoces` + neurales), pero el doblaje
  arrancaba con la voz que hubiera, incluida Fish (2,6–4,8 s por frase): con
  Fish elegida, la preparación se arrastra y se oye el original a tramos.
- **Sin auto ni 2 voces:** la limpieza borraba el `>>` (marca de cambio de
  hablante) antes de que el doblaje pudiera usarlo: una entrevista sonaba a
  monólogo con una sola voz.

### Solución

- **Doble audio alternado** (`dubbingEngine.js`, igual que el lector PDF):
  mientras suena una frase, la siguiente ya está cargada en el otro elemento.
  Los dos se crean y desbloquean dentro del primer toque (iOS lo exige).
- **Velocidad 0,95×–1,20×** y silencio prestado de 1,5 → 2 s: casi siempre
  cabe sin frenar ni acelerar de más.
- **Voz inicial «Automática (según el video)»** (nuevo `js/youtube/vocesDoblaje.js`,
  puro y probado): neural rápida del género detectado en el texto original
  (pronombres, exige 3 de cada 4) o del género global si no hay pistas. Nunca
  Fish en auto (lenta). Fish sigue elegible a mano, marcada «más lenta».
- **Segunda voz en diálogos:** `normalizarSegmentos` guarda `cambioHablante`
  ANTES de limpiar; con 2+ cambios, las frases alternan hablante 0/1 y cada
  una suena con su voz; el panel muestra «Segunda voz (diálogos)». Un `>>`
  suelto es artefacto: ni corta ni voltea la voz (probado).
- Claves: `jg_yt_voz` ahora admite `auto` (valor inicial); nueva `jg_yt_voz2`.

### Pruebas y sus cuentas

| Batería | Resultado |
|---|---|
| `node tests/test_youtube_doblaje.mjs` | **101 OK · 0 fallos** (78 + 23 nuevas: auto, diálogo, >> suelto, rango 0,95–1,20) |
| `node tests/verificar_youtube_doblaje.mjs` | **88 OK · 0 fallos** (81 + 7: auto inicial, diálogo alterna 2 voces, monólogo 1 voz) |
| Unitarias de referencia (19 archivos) | **1.192 OK · 0 fallos** (sin retroceder) |
| `verificar_arranque_ligero.mjs` | 9 OK + 1 fallo preexistente (1031 KB, ajeno) |
| `verificar_movil_pantalla.mjs` | 60 comprobaciones, como antes |
| `pytest` YouTube (`test_youtube_idioma_origen`, `test_supadata_youtube`, `test_youtube_subs_parse`, `test_api_youtube_bloqueo`) | **68 passed** |

Regresión cazada por T2.5 durante el trabajo: la fábrica de audio devolvía la
MISMA instancia dos veces y la precarga pisaba la frase actual (el video no
volvía a sonar tras saltar). Se entrega fábrica con 2 elementos distintos +
freno en `#precargarSiguiente` si vinieran duplicados. Detalle en `TRAMPAS.md`.

### Despliegue de esta entrega (2026-09-26)

`v147` / `jg-turbo-shell-v147` · `dpl_Bar7QpgwVTnvtj4u7Cm3g3XUCQRY` (2026-09-26, READY, alias https://jg-turbo.vercel.app verificado: `JG_JS_V='v147'`, selector auto + 2.ª voz en el HTML, 5/5 módulos `js/youtube/` HTTP 200, `/api/health` ok con `youtube_auto: true`; arranque contra prod 9 OK + 1 fallo preexistente).

Producción: https://jg-turbo.vercel.app · GitHub: `JHONCOD24/jg-turbo`, `main` al día.

## Entrega 2026-09-26 · Doblaje v3: fiable, progresivo y multilingüe

### Pedido

Implementar el plan `PLAN_YOUTUBE_DOBLAJE_IMPLEMENTACION_LLM.md` (auditoría
`AUDITORIA_YOUTUBE_2026-09-25.md`) tal cual: el doblaje de YouTube tenía que
funcionar en videos reales, con el idioma correcto, sonando en segundos y sin
gastar créditos ni cuota de más.

### Causas verificadas (con sus cifras)

- **H1 · el idioma se decidía mal.** Un video en inglés de 88 min se rechazó con
  «El audio de este video está en árabe (62 %)»: YouTube dobla videos solo y cada
  idioma doblado trae su pista automática (`asr`) — medido **7 pistas en
  `dNWkwrqAkcM`, la primera árabe** — y a Supadata se le pedía el texto **sin
  `lang`**, así que devolvía «la primera disponible».
- **H3 · se traducía el video entero antes del primer sonido.** Un video de
  88 min exigía **351 lotes y 702 llamadas a la IA** (17–47 min esperando) y otra
  pasada de revisión duplicaba el tiempo de cada lote (2,5–2,8 s → 1,4 s medidos
  sin ella).
- **H4 · no había progreso real.** Un texto fijo «Procesando…» durante 27 s, sin
  barra, pasos ni tiempo; el mensaje final quedaba fuera de pantalla y el botón
  de voz decía «Preparando…» incluso tras un rechazo.
- **H5 · el motor se congelaba con la pestaña tapada.** Con la ventana oculta,
  `requestAnimationFrame` no disparó **ni una vez en 29 s** (0 disparos en 1,5 s
  frente a 16 de un `setInterval` de 100 ms), así que la voz no llamaba a
  `play()`.

### Solución por fase

- **Fase 0 · cimientos.** Pruebas del backend al contrato vigente de 2 valores
  (las 4 antiguas esperaban un contrato perdido en la reestructuración del
  2026-09-03) y pruebas huérfanas saltadas con motivo visible. Arnés propio del
  doblaje con fixture real (`youtube_dNWkwrqAkcM_90s.json`, 44 segmentos) y API
  + reproductor simulados: **sin red y sin créditos**.
- **Fase 1 · fiabilidad.** El idioma se decide ANTES de pedir el texto (persona →
  YouTube Data API `defaultAudioLanguage` → título → pistas; alfabeto como señal
  en `deteccion_idioma.py`) y se pide explícito. Sin subtítulos: `409` con
  créditos estimados, nunca IA sin permiso. Los sonidos (`[music]`, `(baaaah!!)`,
  `>>`) no se traducen ni se leen. Reloj con `setInterval`
  (`js/youtube/reloj.js`) y texto sin parpadeo. Sesión cancelable con `AbortSignal`
  de verdad (botones ocupados: un clic = una petición). Progreso visible y vivo
  (pasos, barra, tiempo). El reproductor nace sin subtítulos de YouTube encima.
- **Fase 2 · progresivo.** Las frases de voz se definen por el tiempo del
  original (con silencio prestado); traducción por lotes con el contexto vecino y
  modo literal que no borra horas del diálogo («a las 10:30»); limitador, planificador
  y motor por ventanas (`motorPreparacion.js`: traducción 180 s, voz 90 s,
  ≤ 18 síntesis/min por la cuota de Azure F0); controlador nuevo: la voz suena sin
  traducir el video entero; velocidad estable 0,9×–1,25×.
- **Fase 3 · la experiencia.** Caché por video en IndexedDB (`jg_youtube`):
  reabrir no gasta créditos y retoma donde ibas. Voz propia del doblaje en el
  panel (clave `jg_yt_voz`; si Fish cae, relevo a neural con aviso honesto y sin
  mezclar timbres). Subtítulos a elección recordados, pantalla completa con
  subtítulos propios y modo iPhone (el original se silencia mientras suena la
  voz). El panel pone el doblaje primero y deja el texto como opción. Permiso con
  el costo estimado a la vista antes de transcribir con IA. El texto traducido
  completo se pide con un botón y reaprovecha lo que el doblaje ya tradujo.

### Contrato de API (todo aditivo)

- `POST /api/youtube` acepta además `title_hint`, `duration_hint_s` y
  `allow_ai_generation` (`false` = solo subtítulos existentes; nunca gasta IA sin
  permiso). Devuelve además `requested_lang`, `language_source`
  (`usuario|youtube|titulo|proveedor|audio`), `language_resolution_confidence`,
  `available_langs`, `duration_s` y `audio_language*`.
- **`409 {code: "sin_subtitulos", duration_s, estimated_credits}`** cuando no hay
  subtítulos y no se autorizó IA (2 créditos/min).
- `POST /api/translate` acepta además `contexto_previo`/`contexto_siguiente`
  (solo desambiguan; nunca se traducen) y `literal: true` ya no borra horas del
  diálogo.
- `GET /api/health` informa además `youtube_data_api` (si hay
  `YOUTUBE_DATA_API_KEY`).

### Pruebas y sus cuentas

| Batería | Resultado |
|---|---|
| `node tests/test_youtube_doblaje.mjs` | **78 OK · 0 fallos** |
| `node tests/verificar_youtube_doblaje.mjs` | **81 OK · 0 fallos** |
| `pytest backend/tests/test_youtube_idioma_origen.py` | **30 passed** |
| `pytest` de YouTube (T0.1) | en verde; **2 skipped** (huérfanas, con motivo) |
| `pytest backend/tests/test_traducir_largo.py` | 6 passed; los 2 fallos `prefer_fast` son preexistentes y ajenos |
| Unitarias de referencia (19 archivos) | **1.192 OK · 0 fallos** (sin retroceder) |
| `verificar_arranque_ligero.mjs` | 9 OK + 1 fallo preexistente (1038 KB, ajeno) |
| `verificar_movil_pantalla.mjs` | 60 comprobaciones, como antes |

### Despliegues de esta entrega (2026-09-26)

| `dpl_…` | Qué entró |
|---|---|
| `dpl_AU8hXERG7PE9j7rDrUtfZ1MjkXBB` | Doblaje v3 completo (`v146` / `jg-turbo-shell-v146`) |
| `dpl_3ZbyrBtErWh3CrKh2j32jiMqGsN1` | `YOUTUBE_DATA_API_KEY` en producción |
| `dpl_62dWUkZRnFUzrL6bkbLWxhqmHhNx` | `GEMINI_API_KEY` + respaldo automático a Mistral + `tests/verificar_youtube_produccion.mjs` |

Producción: https://jg-turbo.vercel.app · GitHub: `JHONCOD24/jg-turbo`, `main` al día.

### Verificación contra el dominio real

- `JG_JS_V = 'v146'` y `CACHE_SHELL = 'jg-turbo-shell-v146'` confirmados con `?nocache=`.
- Módulos de `js/youtube/` con `Content-Length` idéntico al local (**11/11**).
- `verificar_arranque_ligero.mjs` contra producción: **9 OK · 1 fallo preexistente**
  (~1053 KB; el mismo de local, ajeno a YouTube).

| # | Video | Resultado |
|---|---|---|
| A1 | `dNWkwrqAkcM` (inglés, 88 min, doblajes automáticos) | ✅ **Con Data API:** `language=en`, `language_source=youtube`, confianza **0.97**, `duration_s=5314`. El fallo original («árabe») está corregido. |
| A2 | `jNQXAC9IVRw` (inglés, 19 s) | ✅ Con `title_hint` del reproductor: `language=en`, `source=titulo`. Con `language: "en"` explícito: `source=usuario`. |
| A3 | Video en portugués/francés | **[POR CONFIRMAR]** (hace falta un video real de esos idiomas + créditos). |
| A4 | Video en español | **[POR CONFIRMAR]** (los IDs de prueba disponibles no se pudieron procesar; la lógica cliente de «ya está en español» está cubierta por T1.6). |
| A5–A8 | Progreso, Cerrar, caché, sin errores | ✅ `tests/verificar_youtube_produccion.mjs` contra el dominio real: **9 OK · 0 fallos** (progreso visible, sin «árabe», Cerrar no deja trabajo colgado, reabrir no repite `/youtube`). |
| A9 | Video sin subtítulos + permiso | **[POR CONFIRMAR]** (código exacto de Supadata `mode=native`). Cubierto por T3.5 en navegador simulado. |
| A10 | iPhone real (H21) | **[POR CONFIRMAR]** — implementado y probado en emulador (T3.3). |

### Claves y proveedor de IA (2026-09-26)

| Variable | Dónde | Estado medido |
|---|---|---|
| `YOUTUBE_DATA_API_KEY` | Vercel Production + `.env` (ignorado por Git) | ✅ Activa. `/api/health` → `youtube_data_api: true`. El idioma sale de `snippet.defaultAudioLanguage` (fuente `youtube`, confianza 0.97). |
| `GEMINI_API_KEY` | Vercel Production + `.env` | ⚠️ Configurada, pero la API `generativelanguage.googleapis.com` está **bloqueada** en el proyecto de Google Cloud de esa clave (`API_KEY_SERVICE_BLOCKED`). |

**Nunca** pegar estas claves en código, pruebas, logs ni commits.

#### Respaldo automático si Gemini falla (cambio en `api/index.py`)

Antes, si el proveedor preferido daba 401/403 (clave inválida o API bloqueada),
la traducción se caía. Ahora `_llamar_ia_con_respaldo` prueba el resto de
proveedores configurados (`GEMINI_API_KEY` → `OPENROUTER_API_KEY` →
`MISTRAL_API_KEY` → `XAI_API_KEY`) tanto en errores de **auth** como de **rate
limit**. Así añadir `GEMINI_API_KEY` no tumba la traducción.

Medido en producción tras el cambio:

```json
{"text":"¡Hola, mundo! Esto es una prueba del sistema de traducción alternativo.",
 "provider":"mistral","model":"mistral-small-latest",
 "validation":{"status":"ok","integrity_score":100}}
```

Es decir: Gemini rechazó, **Mistral cogió el relevo** y la persona no notó nada.

**Para que Gemini mande de verdad** (un paso del dueño): habilitar
«Generative Language API» en Google Cloud Console del proyecto de esa clave, o
crear una clave en [Google AI Studio](https://aistudio.google.com/apikey) y
cambiar `GEMINI_API_KEY` en Vercel. No hace falta otro deploy si solo se habilita
la API.

#### Prueba nueva · `tests/verificar_youtube_produccion.mjs`

Corre contra `https://jg-turbo.vercel.app` con un video **real** (gasta ~1 crédito
de Supadata). Cubre A5–A8: progreso visible, sin «árabe», Cerrar que corta
traducción y voz, formulario de vuelta, caché al reabrir y cero errores de
JavaScript. Uso: `node tests/verificar_youtube_produccion.mjs` (o `--headed`).

### [POR CONFIRMAR] abiertos

- **A3 ·** video real en portugués o francés (doblaje desde otro idioma).
- **A4 ·** video real en español (mensaje «ya está en español»).
- **A9 ·** código exacto de Supadata `mode=native` en un video sin subtítulos.
- **A10 · iPhone real (H21):** que Safari silencie el original mientras suena la voz.
- **`unloadModule` de la IFrame API** para quitar los subtítulos de YouTube: no
  está en la documentación oficial; si no existe, se ignora sin romper.
- **Gemini primario:** pendiente de habilitar la API en Google Cloud (ver arriba).
- **Sustitutos de las voces regionales retiradas** (2026-09-03): el selector del
  doblaje ofrece hoy las voces neurales que el motor sigue usando además de la
  biblioteca; cuando lleguen los reemplazos, `ttsCatalogoVoces()` los ofrecerá y
  los duplicados se descartan solos.

### Correcciones al plan (medidas durante la implementación)

- La comprobación de «sin segunda pasada» del plan miraba el código con un
  `slice` invertido (inalcanzable); se corrigió el límite sin cambiar su
  intención.
- La prueba de objetivos táctiles comparaba `< 44` exacto y el render devuelve
  `43,999999999999996` con coordenadas fraccionarias: se redondea al píxel CSS.
- El aviso de «Fish no responde» se pisaba con la línea de estado («Listo…»,
  «Voz en español activa…»): ahora persiste en la línea de voz del panel.
- La Fase 3 del plan no se había ejecutado en su validación original; sus
  comprobaciones se corrigieron contra el comportamiento real medido.

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


## Videos v167 (2026-10-04): maximo de 120 minutos

YouTube, X y archivos del equipo adoptan 120 minutos como maximo de nuevas
sesiones. SRT/VTT tienen el mismo techo. Detalle, pruebas y publicacion:
`CAMBIOS_VIDEOS_120.md`. El troceo, las cuotas y las bibliotecas se conservan.
