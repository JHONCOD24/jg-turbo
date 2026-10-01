# Doblar videos del equipo (archivos locales) · Especificación de diseño

Fecha: 2026-10-01 · Estado: **diseño cerrado, validado en copia aislada** · Dueño: JHONCOD24
Plan de implementación: `PLAN_VIDEO_LOCAL_DOBLAJE_IMPLEMENTACION_LLM.md` · Prompt del constructor:
`PROMPT_AGENTE_VIDEO_LOCAL_DOBLAJE.md` · Mediciones: `docs/video-local/MEDICIONES.md` · Brief de
interfaz (impeccable): `.impeccable/surfaces/js-youtube-youtubesynccontroller-js.md`.

## 1. Qué quiere el dueño

> «Que el usuario también pueda doblar videos en local. Los videos que descargó en inglés, que
> también pueda doblarlos en la aplicación.»

Hoy la pestaña **Videos** dobla YouTube (texto de subtítulos/Supadata) y X (audio → Whisper). Falta
la tercera puerta: **un archivo de video que ya está en el teléfono o el computador** (cursos,
charlas, tutoriales descargados). Debe sentirse igual que un enlace: misma voz, ritmo automático,
subtítulo, «Texto completo», biblioteca y descargas.

**Éxito:** elegir el archivo, oír la voz en español en segundos (la primera parte), volver otro día
sin volver a esperar ni gastar cuota, y poder llevarse el MP3 o el MP4 doblado.

### Decisiones del dueño (2026-10-01)

1. **El video no se copia a la app.** Se guardan texto, traducción y voz (como hoy). Para volver a
   verlo, se elige otra vez el archivo; una huella confirma que es el mismo y suena al instante.
2. **Descargas: MP3 doblado y MP4 doblado** (el MP4 pide el original si no está a mano). Nunca se
   ofrece «video original» (ya está en su equipo).

### Decisiones del director (razonables, el dueño puede cambiarlas)

| Decisión | Por qué |
|---|---|
| Vive en la pestaña **Videos**, junto al enlace | Mismo motor, misma biblioteca, mismo lugar mental. |
| Duración máxima **3 h** | Groq gratis da 2 h de audio por hora: con «retomar», 3 h caben en dos tandas. |
| **Retomar** lo ya transcrito si Groq corta | Principio «no hacer esperar dos veces»: no se paga dos veces la misma parte. |
| Formatos: MP4, M4V, MOV, MKV, WebM | Lo que Mediabunny lee y el `<video>` del navegador suele reproducir. AVI no (Mediabunny no lo lee). |
| Sin subir el video a ningún servidor | Vercel corta a 60 s y ~4,5 MB por petición; además, privacidad. Solo viaja el audio en partes. |
| Puente desde la pestaña **Archivo** (y Compartir del celular) | En el teléfono el camino natural es Galería → Compartir → JG Turbo. No cambia lo que ya hace Archivo. |
| Arrastrar y soltar en el escritorio | Barato (15 líneas) y es como se usa un PC. |

### Fuera de alcance (mejoras para después)

- Leer subtítulos `.srt`/`.vtt` que vengan con el video (ahorraría Whisper y sería exacto).
- Recordar el archivo con un clic en Chrome de PC (`showOpenFilePicker` + manejador en IndexedDB).
- Empezar a doblar con la primera parte transcrita mientras llegan las demás (hoy se espera todo el
  texto; el video se puede ver en inglés mientras tanto).
- Convertir en el navegador formatos que no reproduce (MKV en iPhone, AVI).

## 2. Hechos medidos que mandan

Detalle y respuestas crudas: `docs/video-local/MEDICIONES.md` (M1–M15). Lo esencial:

- Sacar y **recodificar a MP3 16 kHz mono 32 kbps** el audio de 60 min: 16,7 s en el PC, ~9 s por
  parte de 6 min con CPU de teléfono; partes de 1,44 MB. Whisper de producción: 200 en 5,8 s.
- Si el navegador no decodifica el audio (AC-3 en Chrome), **copiarlo** sin decodificar funciona y
  Groq lo transcribe igual (200 en 9,1 s); las partes se dimensionan por la tasa de bits real.
- Un `blob:` del archivo carga dentro de `/x-reproductor.html`: se reutiliza `XVideoPlayer`.
- WebCodecs exige contexto seguro (https/localhost).
- El exportador MP4 tenía un fallo latente con audio de 32 kHz; se corrige mezclando a 44,1/48 kHz.

## 3. Arquitectura

```
#ytArchivo / soltar / pestaña Archivo → ponerArchivo(file)       (controlador: ficha + botón)
  «Doblar al español» → iniciarSesionArchivo(file)
    huellaArchivo(file) → clave «archivo:<16 hex>»                 (archivoLocal.js, puro)
    ServicioArchivo.inspeccionar(file)                              (servicioArchivo.js)
      validarArchivo · abrirArchivoLocal (Mediabunny, BlobSource)   (medioLocal.js)
      elegirModoExtraccion → 'mp3' | 'copia' | 'imposible'          (archivoLocal.js)
      planearTrozosTiempo → partes de ≤ 360 s con 12 s de solape     (archivoLocal.js)
    XVideoPlayer('ytPlayer', { mp4: blob:… })  ← iframe /x-reproductor.html (sin cambios de fondo)
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

### Unidades y contratos

| Unidad | Qué hace | Depende de |
|---|---|---|
| `archivoLocal.js` (nuevo, puro) | `validarArchivo`, `huellaArchivo`, `esClaveArchivo`, `planearTrozosTiempo`, `elegirModoExtraccion`, `tituloDeArchivo`, `resumenAntesDeEmpezar` | `transcripcionPartes.js` (constante) |
| `transcripcionPartes.js` (nuevo, sale de `servicioX.js`) | `transcribirPorPartes`, `subirParte`, `enParalelo`, `esperarMs`, `cancelado` | `transcriptionService.js`, `idiomaOrigen.js` |
| `medioLocal.js` (nuevo, navegador) | `abrirArchivoLocal`, `fabricarParteLocal`, `capturarPortada` | Mediabunny (carga diferida), `medios.js` |
| `servicioArchivo.js` (nuevo) | `ServicioArchivo.inspeccionar` / `obtenerParaDoblaje` (misma respuesta que `ServicioX`) | los tres de arriba + `audioX.unirTranscripciones` |
| `servicioX.js` (cambia por dentro) | Usa `transcribirPorPartes`; conducta idéntica (70/70 y 24/24) | — |
| `XVideoPlayer.js` | Opciones `etiqueta` y `mensajeError` (por defecto, las de X) | — |
| `exportadorDoblaje.js` | `exportarMp4Doblado({ mp4Url \| archivo })` (+ alias `exportarMp4DobladoX`); guarda contra recodificar video; mezcla a 44,1/48 kHz | — |
| `bibliotecaVideos.js` | `datosDeClave('archivo:…')`, sin `url`, `nombreArchivo`, `bytes` | — |
| `bibliotecaVista.js` | «Tu equipo», menú sin enlace, reabrir con `pendiente`, MP4 que pide el original | `deps.elegirArchivoPara` |
| `descargaDestino.js` | `nombreArchivo` → `jg-turbo-equipo-…` | — |
| `youtubeSyncController.js` | Puerta del archivo, `iniciarSesionArchivo`, reabrir, descargas, `window.jgVideoLocal` | todo lo anterior |
| `index.html` | Marcado y CSS de la puerta, filtro «Tu equipo», botón «Elegir el video original», puente en Archivo | — |

### Datos

- **Clave:** `archivo:` + 16 hex del SHA-256 de (tamaño + 1 MiB inicial + 1 MiB final). Renombrar o
  mover el archivo no la cambia; un byte distinto sí.
- **`doblajes`** (IndexedDB `jg_youtube`, sin versión nueva): el registro de siempre. Mientras se
  transcribe, `{ videoId, titulo, duracionS, parcial: { trozoS, idioma, partes: [[k, segmentos]] } }`;
  `completarSesion` lo reemplaza por el registro completo (sin `parcial`).
- **`videos`**: la ficha de siempre con `plataforma: 'archivo'`, `url: ''`, `portada: 'data:image/jpeg…'`,
  `nombreArchivo`, `bytes`. `fusionarEntrada` sigue sin tocar `etiquetas` ni `favorito`.
- **`voces`**: igual (clave del video + voz + texto).
- **Nada** del video se guarda. El `File` vive en memoria (`ultimoArchivo`) hasta recargar.

## 4. Interfaz (resumen; detalle en el brief de impeccable)

- Debajo del campo del enlace: «o» + botón **«Elegir un video de tu equipo»** + ayuda «MP4, MOV, MKV
  o WebM, de hasta 3 horas. El video no sale de tu equipo: solo viaja su audio para transcribirlo.»
- Al elegir: **ficha** con nombre (máx. 2 líneas), «412 MB · listo para doblar» y «Quitar». El enlace
  se borra (una sola fuente a la vez). «Doblar al español» se habilita.
- Tarjeta de progreso: «Abriendo tu video…» → «Sacando el audio del video…» (o «Copiando…») →
  «Transcribiendo el audio: n de N partes…». La ayuda dice antes de esperar: «Video de 58 min: lo
  escuchamos sacando su audio aquí mismo y lo transcribimos en 11 partes (gratis). El video no sale de
  tu equipo; solo viaja el audio. Mientras tanto puedes darle play.»
- Biblioteca: tarjeta con «Tu equipo», miniatura del propio video; menú sin «Copiar enlace» ni «Abrir
  en…»; filtro «Tu equipo». Abrirla pide el mismo archivo.
- Pestaña Archivo: si el archivo es un video, aparece «Doblar este video al español».

## 5. Errores (cada uno se lee; ninguno falla en silencio)

| Código | Cuándo | Mensaje (resumen) |
|---|---|---|
| `archivo_vacio` | 0 bytes | «Ese archivo está vacío. Elige otro video.» |
| `archivo_no_es_video` | audio, PDF… | «Eso no parece un video (MP4, MOV, MKV o WebM). Para un audio usa la pestaña Archivo.» |
| `archivo_formato` | Mediabunny no lo lee (AVI…) | «No reconocemos este formato de video. Prueba con un MP4, MOV, MKV o WebM.» |
| `archivo_sin_audio` | sin pista de audio | «Este video no tiene sonido: no hay nada que doblar.» |
| `archivo_largo` | > 3 h | «Este video dura N min. Por ahora se doblan videos de hasta 3 horas.» |
| `archivo_audio` | ni decodifica ni se puede copiar | «Este navegador no puede leer el audio de este video (dts). Prueba en Chrome de computador o conviértelo a MP4.» |
| `archivo_parte_grande` | una parte copiada > 4,2 MB | «…Conviértelo a MP4 (AAC) e inténtalo otra vez.» |
| `archivo_transcripcion` | Whisper rechaza | el `detail` del servidor tal cual |
| `archivo_limite` | Groq agotó su cuota | «Groq llegó a su límite gratuito (unas 2 horas de audio por hora). Lo ya transcrito quedó guardado: vuelve a pulsar «Doblar al español» en un rato y seguirá donde iba.» |
| (reproductor) | el `<video>` no lo reproduce | «Este navegador no puede reproducir este video (formato o códec). Ábrelo en Chrome de computador o conviértelo a MP4 (H.264 + AAC).» |
| (biblioteca) | eligió otro archivo | «Ese archivo no es «x.mp4». Elige el mismo video que doblaste.» |
| (MP4) | códec de video que MP4 no lleva | «El video de este archivo no se puede guardar como MP4 sin recodificarlo. Descarga el audio en español (MP3).» |

## 6. Pruebas (todas corridas en la copia aislada antes de entregar)

| Prueba | Qué cubre | Resultado |
|---|---|---|
| `tests/test_archivo_doblaje.mjs` (nueva) | reglas puras, huella, partes, modo, transcribir por partes (idioma, español, retomar, cancelar), servicio con dobles, biblioteca | **65 OK** |
| `tests/verificar_archivo_audio.mjs` (nueva) | Mediabunny REAL en Chromium y Chrome: MP3, copia AC-3, una sola pista, sin sonido, miniatura, MP4 doblado (VP9 y H.264/AC-3) | **26 OK** |
| `tests/verificar_archivo_doblaje.mjs` (nueva) | punta a punta con API simulada: elegir/quitar/rechazar, doblar, ver, biblioteca, reabrir con el mismo y con otro archivo, MP4 que pide el original, errores, cancelar, puente desde Archivo, teléfono | **38 OK** |
| Regresión | `test_x_doblaje` 70 · `verificar_x_doblaje` 24 · `test_biblioteca_videos` 100 · `verificar_biblioteca_datos` 48 · `test_youtube_doblaje` 139 · `test_youtube_sincronia` 74 · y las de navegador listadas en el plan | iguales a `main` |

## 7. Riesgos

- **iPhone/Safari**: no medido. Si no decodifica, se copia (sin decodificar). Si el `<video>` no
  reproduce el formato (MKV), el mensaje lo dice. Lo verifica el dueño en la vista previa.
- **Memoria en el teléfono** con el MP4 doblado: `elegirDestino` ya limita a 250 MB en memoria.
- **Groq por hora**: un video de 3 h necesita dos tandas; el retomar lo cubre.
