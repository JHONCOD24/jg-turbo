# Biblioteca de videos

Documento maestro de la biblioteca de videos doblados y las descargas (pestaña
«Videos», antes «YouTube»). Especificación aprobada por el dueño:
`docs/superpowers/specs/2026-09-28-biblioteca-videos-design.md`. Plan:
`PLAN_BIBLIOTECA_VIDEOS_IMPLEMENTACION_LLM.md`. Producto: `PRODUCT.md`.

## Qué hace

- Cada video doblado (YouTube o X) queda en una **biblioteca** bajo «Doblar al
  español»: buscador (título, canal, tema o **lo que se dijo**), filtros (plataforma,
  favoritos, en curso, vistos), etiquetas libres del dueño (tope 10), favoritos,
  «Seguir viendo» con «Vas en 12:40 de 58:10», tarjetas con miniatura y menú ⋯.
- Volver a un video guardado es **inmediato**: texto, traducción y voz ya están;
  la voz guardada **no pasa por el limitador** de Azure (`buscarGuardada`) y suena
  al primer toque («Listo al instante» en la tarjeta).
- **Descargas** armadas en el navegador con Mediabunny (carga diferida): audio
  doblado MP3 (YouTube y X), video original de X (MP4) y video de X doblado (MP4).
  La frase que no cabe en su espacio se pide más rápida al servidor (`rate` con
  prosodia: no cambia el tono), hasta 1,25×; si ni así cabe, se empuja y se cuenta.
- La pestaña pasa a llamarse **«Videos»** (ids internos sin cambios).

## Decisiones del dueño (2026-09-28)

| Tema | Decisión |
|---|---|
| Descarga de YouTube | **Sin video**: solo el audio doblado MP3 (YouTube bloquea Vercel —medido— y sus términos lo prohíben). |
| Qué se descarga | Original de X (MP4) · Audio doblado (MP3) · Video de X doblado (MP4). Sin SRT. |
| Sincronización | Solo este dispositivo (la nube del PDF, para después). |
| Temas | Etiquetas libres, varias por video. |
| Nada se borra solo | Quitar es manual y con «Deshacer» (6 s). La poda de 20 videos de v1 se elimina. |

## Hechos medidos (M1–M12)

La tabla completa vive en la especificación §3. Los que gobiernan el código:

- **M6:** la extensión MP3 de Mediabunny importa `"mediabunny"` por nombre: en
  vendor se reescribe a `./mediabunny.min.mjs` o el MP3 muere con «codec not
  supported» (`TRAMPAS.md`).
- **M7/M8:** Azure F0 permite 20 síntesis/min → las descargas largas van por
  **edge-tts** (`evitar_azure: true`, medido abajo) y solo al 3.er fallo de una
  frase cae a Azure.
- **M10:** `video.twimg.com` rechaza Referer ajeno (403): toda descarga de X va
  con `referrerPolicy: 'no-referrer'`.
- **M12:** `showSaveFilePicker` exige el gesto: `crearDestino` es lo primero del
  clic en «Descargar», antes de cualquier `await` (`TRAMPAS.md`).

## Arquitectura

```
#panelYt (ids sin cambiar) → #vidBiblioteca (nuevo, bibliotecaVista.js)
youtubeSyncController.js
 ├─ al doblar / cada 5 s: registrarVideo(ficha)   (lo automático nunca toca etiquetas/favorito)
 ├─ voz en vivo: leerVoz() → si no, generar y guardarVoz (solo si NO fue respaldo)
 ├─ abrirDesdeBiblioteca(video, {segundo}) → el camino de siempre (caché = inmediato)
 └─ descargar(video, tipo) → exportadorDoblaje (Mediabunny) + destinoArchivo
cacheDoblaje.js → IndexedDB jg_youtube v2: doblajes (v1) + videos + voces
puros (probados en Node): bibliotecaVideos.js · pistaDoblada.js · descargaDestino.js
medios.js (carga diferida de Mediabunny) · exportadorDoblaje.js · destinoArchivo.js
api/index.py → /api/tts acepta evitar_azure (aditivo, POST y GET)
```

### Datos (IndexedDB `jg_youtube`, **versión 2**, migración aditiva)

- `doblajes` (sin cambios): texto con tiempos y traducciones.
- `videos` (clave `clave`, índice `abierto`): ficha liviana de la biblioteca.
- `voces` (clave `claveDeVoz(video, voz, texto, tasa)`, índices `video`, `usado`):
  voz generada por frase. Tope **300 MB**; salen las menos usadas. Es lo único
  que se descarta solo (se regenera).
- Migración v1 → v2: cada doblaje existente crea su ficha con su fecha. Sin
  claves nuevas de `localStorage`.

### Contrato `deps` de la vista (`montarBibliotecaVideos(raiz, deps)`)

`listarVideos`, `videosConVoz`, `listarDoblajes`, `actualizarVideo`,
`quitarVideo`, `restaurarVideo`, `abrir(video, {segundo}) → {abierto, motivo}`,
`opcionesDescarga(video) → {calidades, mp3, esMovil}`,
`descargar(video, tipo, {calidad, signal, onProgreso})`. La vista pinta todo lo
de fuera con `escapar()` (nunca HTML crudo) y despacha por delegación en la raíz.

## Límites

- Celular: archivos mayores de **250 MB** no se arman en memoria (se ofrece la
  calidad que cabe; `descargaDestino.js`). Escritorio Chrome/Edge: directo a disco.
- Voz guardada: tope 300 MB (podas solo ahí).
- Aceleración máxima de frase: **1,25×** (la misma que el doblaje en vivo llama
  cómoda); lo que no cabe se corre y se cuenta en `corridas`.
- Etiquetas: máx. 10 por video, 30 caracteres.

## Medición desde Vercel

Fecha: 2026-09-28.

Vista previa: `dpl_J3LJAZ3TzGPd8E9BBJSbLvCDJvfT` (`https://jg-turbo-kx89hjg3m-jhoncod24s-projects.vercel.app`). Se desplegó desde un `git archive` exacto del commit `be41e1c`.

Se midieron 20 frases con `evitar_azure: true` y 20 con `evitar_azure: false`, con tres solicitudes en paralelo. La vista previa tiene Deployment Protection, por lo que las solicitudes se hicieron con `vercel curl`; `time_total` de curl mide cada petición HTTP sin incluir el arranque del CLI.

| Ruta de voz | Tiempo total | Fallos | p50 | p95 |
|---|---:|---:|---:|---:|
| edge-tts (`evitar_azure: true`) | 32,5 s | 0 | 1.053 ms | 1.783 ms |
| Azure (`evitar_azure: false`) | 31,2 s | 0 | 674 ms | 2.606 ms |

Decisión: continuar con edge-tts como primera ruta para las descargas largas. Cumple la puerta del plan de 0 fallos y p95 menor o igual a 5 s. La referencia estimada es 1,6 s por frase con tres solicitudes en paralelo (`32,5 / 20`), aunque la interfaz seguirá mostrando el avance real.

## Pruebas (2026-09-28, rama `feat/biblioteca-videos`)

| Prueba | Resultado |
|---|---|
| `node tests/test_biblioteca_videos.mjs` | **83 OK · 0 fallos** (lógica pura + gancho `buscarGuardada`) |
| `node tests/verificar_biblioteca_datos.mjs` | **38 OK · 0 fallos** (Chromium sin códecs **y** Chrome instalado) |
| `node tests/verificar_biblioteca_videos.mjs` | **48 OK · 0 fallos** (contrato de la interfaz, móvil incluido) |
| `test_youtube_doblaje` / `sincronia` / `test_x_doblaje` | 139 · 65 · 70 (línea base intacta) |
| `verificar_youtube_doblaje` / `verificar_x_doblaje` | 110 · 24 (línea base intacta) |
| `verificar_movil_pantalla` / `verificar_pdf_geometria` | 62 · sin fallos |
| `verificar_arranque_ligero` | 9 OK + el fallo preexistente «<1 MB»; el CSS de la biblioteca viaja con la vista (`js/youtube/biblioteca-videos.css`, ~11 KB fuera del arranque) |
| Servidor (`evitar_azure` + TTS/X/YouTube/IA) | 117–135 passed según selección |

Revisión final de impeccable: `detect` sin hallazgos en la superficie; el revisor
devolvió `fix` (8 materiales: foco inválido con `--focus`, botón de «Seguir» sin
el degradado principal, encabezados sin Bricolage, línea «Vas en…» del brief,
franja lateral en coincidencias, eyebrow, kebab en texto, radios 999px) y tras
aplicarlos **ship** (los 8 resueltos). Ni el revisor ni el agente pudieron ver
imágenes en esa sesión: la inspección visual previa (escritorio+móvil) fue del
agente constructor y la verificación funcional la dan las 48 comprobaciones.

## Si algo cambia

- **edge-tts caído o lento:** cada frase reintenta 2 veces y a la tercera va por
  Azure (aunque `evitar_azure`). Si se vuelve inestable, medir de nuevo como en
  §Medición y valorar invertir la ruta.
- **X cambia la sindicación/FxTwitter:** el texto sale de `/api/x-video`
  (`CAMBIOS_X.md`); las descargas dependen de las variantes `mp4[]` que esa API
  entregue y de que `video.twimg.com` siga sirviendo por rangos sin Referer.
- **Mediabunny:** actualizar `js/vendor/mediabunny/` exige reescribir el import
  de las extensiones (M6) y repetir `verificar_biblioteca_datos` en un navegador
  sin códecs.

## Despliegues

| Fecha | Deploy | Notas |
|---|---|---|
| 2026-09-28 | `dpl_J3LJAZ3TzGPd8E9BBJSbLvCDJvfT` (vista previa) | Medición de `evitar_azure` desde Vercel, desde `git archive` de `be41e1c`. |
| 2026-09-28 | `dpl_2aBp79FCqtjHvzdj866t77J2deTc` (producción, **v154**) | Biblioteca de videos y descargas en https://jg-turbo.vercel.app. Verificado: `JG_JS_V='v154'`, `id="vidBiblioteca"`, Mediabunny 200, `.impeccable/` 404, `x-tts-engine: edge-neural-regional`, hashes de `bibliotecaVista.js`, `cacheDoblaje.js`, `exportadorDoblaje.js`, `youtubeSyncController.js` y `dubbingService.js` iguales al commit. |

## Medición en vista previa / producción

**[DATO PENDIENTE — dueño]** El plan T9 pide la prueba manual en Chrome de escritorio e iPhone:
videos migrados al abrir, doblar uno nuevo de YouTube y uno de X, «Listo al instante», etiquetas,
búsqueda en lo que se dijo, y descargas de MP3/MP4 abiertas en el reproductor. Las 48 + 38
comprobaciones automáticas cubren el contrato; la experiencia real queda por confirmar.
