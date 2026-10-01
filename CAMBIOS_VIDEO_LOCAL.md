# Videos del equipo (doblaje de archivos locales)

Documento maestro del doblaje de videos guardados en el teléfono o el computador
(pestaña **Videos**). Especificación aprobada por el dueño:
`docs/superpowers/specs/2026-10-01-doblaje-video-local-design.md`. Plan:
`PLAN_VIDEO_LOCAL_DOBLAJE_IMPLEMENTACION_LLM.md`. Medidas:
`docs/video-local/MEDICIONES.md` (M1–M15). Producto: `PRODUCT.md`.

## Qué hace

- En **Videos**, debajo del campo del enlace: «o» + botón **«Elegir un video de tu equipo»**
  (MP4, MOV, MKV o WebM, hasta 3 horas). También se puede soltar el video encima
  (escritorio) o mandarlo desde la pestaña **Archivo** («Doblar este video al español»,
  incluso desde Compartir del celular).
- Al elegir se ve una ficha con el nombre y el peso («412 MB · listo para doblar») y
  «Quitar». El enlace se borra (una sola fuente a la vez) y «Doblar al español» se habilita.
- La tarjeta de progreso dice antes de esperar cuántas partes, que es gratis y que el
  video no sale del equipo. El video se puede ver en inglés mientras tanto.
- Mismo motor de YouTube y X: voz, ritmo automático, subtítulo, «Texto completo».
- La biblioteca guarda la tarjeta como **«Tu equipo»**, con miniatura sacada del propio
  video. Reabrir pide elegir otra vez el mismo archivo y suena al instante (caché
  `archivo:<huella>`). Si se elige otro archivo, lo dice.
- Descargas de un video del equipo: **audio doblado MP3** y **video doblado MP4**
  (el MP4 pide el original si no está a mano). Nunca «video original».
- Si tiene los subtítulos del curso (.srt o .vtt), los agrega al lado del video:
  se usa ese texto exacto sin transcribir (gratis).

## Decisiones del dueño (2026-10-01, no se reabren)

1. **El video NO se copia a la app.** Se guardan texto, traducción y voz; para volver a
   verlo se elige otra vez el archivo y la huella confirma que es el mismo.
2. **Descargas: MP3 doblado y MP4 doblado.** Nunca «video original» (ya está en su equipo).

Del director (el dueño puede cambiarlas): vive en Videos; hasta 3 horas; retomar lo ya
transcrito si Groq corta; formatos MP4/M4V/MOV/MKV/WebM; arrastrar y soltar; puente
desde Archivo (y Compartir del celular).

## Hechos medidos (M1–M15)

Detalle y respuestas crudas: `docs/video-local/MEDICIONES.md`.

- M1: WebCodecs solo existe en contexto seguro (https, localhost, 127.0.0.1).
- M2: Chrome decodifica AAC/Opus/H.264/VP9 con Mediabunny; AC-3 no (dos caminos).
- M3–M4: 60 min: copiar 0,6 s pero 51 MB; MP3 16 kHz mono 32 kbps 16,7 s y 13,7 MB.
- M6: CPU 4× más lenta ≈ 9 s por parte de 6 min (se avisa; el video se ve mientras).
- M7: `/api/transcribe` aceptó MP3, Ogg/Opus, AAC y AC-3 copiado en MP4, con tiempos.
- M8: el servidor devuelve `language: "en"` (nada de traducir nombres en el cliente).
- M9: `computePacketStats()` 0,21 s en 60 min (copia dimensionada con tasa real + 15 %).
- M10: huella SHA-256 de tamaño + 1 MiB inicial + final: 16 ms en 140 MB.
- M11–M12: `<video>` reproduce los locales; un `blob:` carga en `/x-reproductor.html`.
- M13: miniatura JPEG 320 px ≈ 6,6 KB (va como `data:` en la ficha).
- M14: MP4 de salida acepta avc, hevc, vp9, av1, vp8, prores (copia sin recodificar).
- M15: el exportador fallaba con audio de 32 kHz; se mezcla a 44,1/48 kHz.

## Arquitectura

```
#ytArchivo / soltar / pestaña Archivo → ponerArchivo(file)       (controlador: ficha + botón)
  «Doblar al español» → iniciarSesionArchivo(file)
    huellaArchivo(file) → clave «archivo:<16 hex>»                 (archivoLocal.js, puro)
    ServicioArchivo.inspeccionar(file)                              (servicioArchivo.js)
      validarArchivo · abrirArchivoLocal (Mediabunny, BlobSource)   (medioLocal.js)
      elegirModoExtraccion → 'mp3' | 'copia' | 'imposible'          (archivoLocal.js)
      planearTrozosTiempo → partes de ≤ 360 s con 12 s de solape     (archivoLocal.js)
    XVideoPlayer('ytPlayer', { mp4: blob:… })  ← iframe /x-reproductor.html
    capturarPortada(blob:…) → JPEG 320 px (data:)                   (medioLocal.js)
    ServicioArchivo.obtenerParaDoblaje
      transcribirPorPartes (compartido con X)                       (transcripcionPartes.js)
        fabricarParteLocal (Mediabunny Conversion + trim) → POST /api/transcribe (≤ 2 en vuelo)
        alTerminarParte → guardarDoblaje({ videoId, parcial }) (retomar)
      unirTranscripciones (de audioX.js, ya probado con X)
    decidirDoblaje → completarSesion → prepararDoblaje               (EL MISMO motor de siempre)
  Biblioteca: clave «archivo:» → plataforma 'archivo' («Tu equipo»), sin enlace, nombre y peso
  Descargas: exportarMp3 (igual) · exportarMp4Doblado({ archivo })   (exportadorDoblaje.js)
```

- Clave `archivo:` + 16 hex del SHA-256 de (tamaño + 1 MiB inicial + 1 MiB final).
- `doblajes` (IndexedDB `jg_youtube`, sigue en v2): mientras se transcribe
  `{ videoId, titulo, duracionS, parcial: { trozoS, idioma, partes: [[k, segmentos]] } }`;
  `completarSesion` lo reemplaza por el registro completo (sin `parcial`).
- `videos`: ficha con `plataforma: 'archivo'`, `url: ''`, `portada: data:…`,
  `nombreArchivo`, `bytes`. `fusionarEntrada` sigue sin tocar `etiquetas` ni `favorito`.
- Nada del video se guarda. El `File` vive en memoria (`ultimoArchivo`) hasta recargar.
- Una sola puerta a `/api/transcribe`: `subirParte` de `transcripcionPartes.js`.
- Mediabunny carga diferido (`medios.js`, `import('./medioLocal.js')`): nunca al abrir.

## Errores (cada uno se lee; ninguno falla en silencio)

| Código | Cuándo | Mensaje |
|---|---|---|
| `archivo_vacio` | 0 bytes | «Ese archivo está vacío. Elige otro video.» |
| `archivo_no_es_video` | audio, PDF… | «Eso no parece un video (MP4, MOV, MKV o WebM). Para un audio usa la pestaña Archivo.» |
| `archivo_formato` | Mediabunny no lo lee (AVI…) | «No reconocemos este formato de video. Prueba con un MP4, MOV, MKV o WebM.» |
| `archivo_sin_audio` | sin pista de audio | «Este video no tiene sonido: no hay nada que doblar.» |
| `archivo_largo` | > 3 h | «Este video dura N min. Por ahora se doblan videos de hasta 3 horas.» |
| `archivo_audio` | ni decodifica ni se puede copiar | «Este navegador no puede leer el audio de este video (…). Prueba en Chrome de computador o conviértelo a MP4.» |
| `archivo_parte_grande` | parte copiada > 4,2 MB | «…Conviértelo a MP4 (AAC) e inténtalo otra vez.» |
| `archivo_transcripcion` | Whisper rechaza | el `detail` del servidor tal cual |
| `archivo_limite` | Groq sin cuota | «Groq llegó a su límite gratuito (unas 2 horas de audio por hora). Lo ya transcrito quedó guardado: vuelve a pulsar «Doblar al español» en un rato y seguirá donde iba.» |
| reproductor | el `<video>` no lo reproduce | «Este navegador no puede reproducir este video (formato o códec). Ábrelo en Chrome de computador o conviértelo a MP4 (H.264 + AAC).» |
| biblioteca | eligió otro archivo | «Ese archivo no es «x.mp4». Elige el mismo video que doblaste.» |
| MP4 | códec que MP4 no lleva | «El video de este archivo no se puede guardar como MP4 sin recodificarlo. Descarga el audio en español (MP3).» |
| `srt_vacio` / `srt_no_es` / `srt_formato` / `srt_grande` / `srt_largo` | subtítulos vacíos, con otra extensión, sin tiempos, de más de 2 MB o de más de 3 h | el motivo tal cual; el video sigue y va por Whisper |

## Límites

- Video de hasta 3 horas; partes de 6 min con 12 s de solape (copia: según tasa real).
- Cada parte ≤ 3,2 MB (tope duro 4,2 MB; Vercel rechaza ~4,5 MB y corta a 60 s).
- Groq gratis ≈ 2 h de audio por hora: con «retomar», 3 h caben en dos tandas.
- Sin dependencias nuevas, sin cambios en `api/`, sin nada que cueste dinero.

## Pruebas

| Prueba | Línea base | Con el plan |
|---|---:|---:|
| `node tests/test_archivo_doblaje.mjs` (nueva) | — | 83 OK |
| `node tests/verificar_archivo_audio.mjs` (nueva, Chromium + Chrome) | — | 26 OK |
| `node tests/verificar_archivo_doblaje.mjs` (nueva, punta a punta) | — | 54 OK |
| `node tests/test_x_doblaje.mjs` | 70 | 70 |
| `node tests/verificar_x_doblaje.mjs` | 24 | 24 |
| `node tests/test_biblioteca_videos.mjs` | 100 | 100 |
| `node tests/verificar_biblioteca_datos.mjs` | 48 | 48 |
| `node tests/verificar_biblioteca_videos.mjs` | 52 | 52 |
| `node tests/test_youtube_doblaje.mjs` | 139 | 139 |
| `node tests/test_youtube_sincronia.mjs` | 74 | 80 |
| `node tests/verificar_youtube_doblaje.mjs` | 110 | 110 |
| `node tests/verificar_movil_pantalla.mjs` | 62 | 62 |
| `node tests/verificar_arranque_ligero.mjs` | 9 OK + 1 fallo previo (1 062 KB > 1 MB) | 9 OK + el mismo fallo (1 069 KB: marcado y CSS de la puerta del equipo y el SRT) |

Contraprueba: `huellaArchivo` incluyendo el nombre hace fallar solo
«renombrar el archivo NO cambia la huella» (64 OK · 1 fallo); restaurada, 65 OK.

## Corrección v161 (2026-10-01, con el video real del dueño)

Whisper devolvió el nombre «welsh» (en vez del código «cy») en la 1.ª parte de un
curso en inglés que abría con silencio; las demás partes se subieron con
`language=welsh` y Groq las rechazó con 400 al final de toda la espera.
Ahora `transcripcionPartes.js` normaliza lo detectado a código ISO
(`normalizarCodigoIdioma` en `idiomaOrigen.js`: «welsh» → «cy»; lo raro → auto)
antes de fijarlo: Groq recibe un código válido y el flujo pregunta el idioma
(«parece estar en galés…») en vez de tumbarse. Sin cambios en `api/`. Pruebas
T5 en `test_archivo_doblaje.mjs` (6 nuevas, total 71); X/YouTube/biblioteca con
los mismos números.

## Corrección v162 (2026-10-02, con el video real del dueño)

El dueño oyó el video en inglés durante los primeros 5–6 párrafos y el español
entró después. Causa: las primeras voces fallaron al generarse (proveedor lento
o caído justo al abrir) y quedaban en estado `error` para siempre: nada las
volvía a pedir y el motor en vivo las daba por originales. Ahora el motor de
preparación las repite en segundo plano (tope 2 por frase, para no quemar cuota)
y el «Listo» avisa si alguna del comienzo aún se prepara. Además, botón
**«Aquí habla otra persona»** en videos del equipo sin diálogo: lo transcrito no
dice quién habla (los subtítulos de YouTube sí traen `>>`), así que la 2.ª voz
nunca entraba sola; la persona toca cuando cambia quien habla y desde ahí suena
la otra voz, hasta volverlo a tocar (estilo pódcast). Los subtítulos y el ritmo
no se tocaron. Pruebas: `test_youtube_sincronia` 80 (+6), `verificar_archivo_doblaje`
43 (+5); YouTube/X/biblioteca con los mismos números.

## Mejora 1 (v163): subtítulos .srt/.vtt junto al video

Si la persona tiene los subtítulos del curso, los agrega con
**«Agregar subtítulos (.srt o .vtt, opcional)»** al lado del video elegido: el
doblaje usa ese texto exacto sin transcribir (0 partes a Whisper, gratis) y
pregunta el idioma si el formulario dice «auto». Se validan al elegirlos (vacío,
extensión, formato, 3 h); un error se dice en el aviso y el video sigue por
Whisper. Latin-1 (tildes de Windows) se lee bien. Si marcan quién habla (`>>`,
«Nombre:»), la 2.ª voz entra sola. Pruebas T6 (12) y e2e (11 nuevas).

## Despliegues

- v160: `JG_JS_V='v160'`, shell-v160. `dpl_7Q4xcP8U7gZhuB4zyhieun4QoewG` (el video
  real del dueño la tumbó al final con el 400 del galés; ver Corrección v161).
- v161: `JG_JS_V='v161'`, shell-v161. `dpl_85XCooxfDqWz8sKpraWLG6Kg4KK2`.
- v162: `JG_JS_V='v162'`, shell-v162. `dpl_FKsHWNzoUQ9qmr6XagFUuStpatH1`.
- v163: `JG_JS_V='v163'`, shell-v163. `dpl_…` (se anota al publicar).
- Sale desde copia `git archive` del commit, una sola vez, verificado contra
  https://jg-turbo.vercel.app (versión, módulos con 200 y sha256 igual, video real
  doblado) y empujado a `origin/main`.

## Qué hacer si falla

- Formato que no reproduce: convertir a MP4 (H.264 + AAC) o abrir en Chrome de PC.
- AC-3 mudo: el original no suena en Chrome, la voz en español sí (aviso en pantalla).
- Límite de Groq: esperar y volver a pulsar «Doblar al español»; sigue donde iba.
- Selector que no abre: debe abrirse dentro del toque (reabrir y MP4 lo hacen así);
  si el navegador lo bloquea, elegir el archivo desde «Elegir un video de tu equipo».
