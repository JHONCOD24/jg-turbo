# JG Turbo — reglas para agentes

## Voz v159 (2026-09-29)

PDF/videos ofrecen `neural:multi:female` (Ava) y `neural:multi:male` (Andrew).
Solo la eleccion multilingue pide unified con idioma fijo; no volver a forzar
voz regional sobre esa eleccion ni aplicar modo multilingue a un video regional.
`jg_tts_terminos_web` es opcional y aditivo: solo nuevas traducciones en-es.
**v166:** cada término viaja marcado como código (`` `array` ``) y `restaurar`
(= `quitarMarcasDeTermino`) **nunca lanza**: no volver a fichas opacas ni a
rechazar una traducción por una marca (rompía lotes del doblaje; `TRAMPAS.md`).
`prepararTextoDeUnidad` une continuaciones antes de sintetizar sin reindexar
el motor. Pruebas nuevas: `test_voz_frases_continuas` 14,
`test_voz_multilingue` 17, `verificar_voz_multilingue` 17. Detalle/publicacion:
`CAMBIOS_TTS.md`. No cambia permisos ni acceso de la extension Udemy.

## Context7 (docs de librerías)

Este repo tiene el MCP Context7 (`.grok/config.toml`, `.mcp.json`, `.cursor/mcp.json`).
Antes de cambiar APIs, versiones o config de FastAPI, Pydantic, yt-dlp, Whisper u
otra librería, consulta Context7. No te fíes de memoria. La clave va en
`CONTEXT7_API_KEY`, nunca en Git.

Al actualizar dependencias: sube parches y menores **dentro de los rangos** de
`backend/requirements.txt` y `api/requirements.txt`. No cruces majors (p. ej.
FastAPI 1.x, Pydantic 3) ni toques `av` 18.x (WDAC en Windows). No actualices
vendor (`js/vendor/`) sin una tarea aparte.

## Si vienes nuevo: `INFORME_2026-09-05.md`

Cuenta la sesión completa del 5 de septiembre de 2026: qué se pidió, qué se
encontró, qué se arregló **y qué salió mal por el camino** (incluidos los
errores del propio agente, con su causa). Si vas a tocar el móvil, el lector o
el despliegue, ahorra medio día de repetir lo mismo.

## ⚠️ Antes de tocar el código: `TRAMPAS.md`

**`TRAMPAS.md`** recoge los errores que ya se cometieron en este proyecto, con la causa medida y la
regla para no repetirlos. Varios se cometieron **dos veces** por no estar escritos. Léelo entero la
primera vez; después, al menos la sección que toque tu tarea:

| Vas a tocar… | Lee al menos |
|---|---|
| Alturas, scroll, responsive | §3 (la cadena de scroll) y §4 (el estilo computado manda) |
| `nube.js`, `sincronizacion.js`, `biblioteca.js` | §5 (cinco formas de perder datos) |
| Texto, pulido, voz | §6 (el guardián que solo mira una dimensión) |
| Voces clonadas de JG Voice en el PDF | `docs/INTEGRAR-VOZ-JG-VOICE.md` (receta completa) |
| Interfaz, botones, avisos | §8 (si no da señal, está roto) |
| Cualquier cosa | §1 (pruebas que pasan sin probar nada) y §9 (trabajar en este repo) |

Lo más caro del proyecto ha sido **dar por verificado lo que no lo estaba**: verificaciones en verde
con la funcionalidad rota, y verificaciones que se cortaban a la mitad sin que nadie contara las
comprobaciones. Empieza por §1.

**Si cometes un error nuevo, añádelo a `TRAMPAS.md`** con el mismo formato (síntoma · causa · regla).
Es parte de cerrar la tarea, no un extra.

## Coordinación multi-agente

Si hay agentes de **diseño/UX** en paralelo: **no editar** `index.html` ni copiar un frontend viejo a `vercel_deploy/`. Ver `../COORDINACION_AGENTES.md` e inventario en `../auditoria-ux-2026-07-29/INVENTARIO_TECNICO.md`.

## Persistencia (crítico)

Lee **`CONFIG_PERSISTENTE.md`** antes de tocar configuración o `localStorage`.

- Claves, glosario y preferencias viven en el **navegador** (`jg_*`).
- Un **deploy no las borra**. No renombrar claves sin migración. No sobrescribir con vacío.
- Bundle: `jg_config_bundle`. UI: Exportar / Importar config.
- Deploy: desde la raíz del repo (`C:\Users\juanl\Documents\Proyectos\jg-turbo\`) → `npx vercel --prod --yes --scope jhoncod24s-projects`
- Git: repo en la raíz (`jg-turbo/`, la app vive en la raíz desde la reestructuración del 2026-09-03) → `JHONCOD24/jg-turbo` (author `JHONCOD24 <juanloras35@gmail.com>`)
- Prod: https://jg-turbo.vercel.app


## Despliegue: UNO al final, no uno por cambio

**Regla vigente (2026-09-05).** Se despliega **una sola vez, al final de todo el
trabajo pedido**, no cada vez que se termina una mejora suelta.

Durante la sesión: editar, probar en local y **commitear**. Cuando la tanda
entera esté lista y verificada, entonces sí: un despliegue, una verificación
contra el dominio y un push.

**Por qué cambió.** Antes la regla decía «desplegar al cerrar cada mejora». En
la sesión del 2026-09-05 eso salieron **siete despliegues** para un solo
encargo: cada uno cuesta minutos de espera, la copia limpia, la verificación de
hashes y las suites de navegador contra producción. Hacerlo una vez al final da
exactamente la misma garantía y ahorra ese tiempo repetido.

**Qué NO cambió, y es lo importante:** el trabajo sigue sin estar cerrado hasta
que esté **documentado** en el MD del feature, **desplegado**, **verificado
contra `https://jg-turbo.vercel.app`** y **empujado a `origin/main`**. Se
agrupa el despliegue; no se salta.

**Las dos excepciones en las que sí se despliega antes de terminar:**

1. **Un fallo que está roto en producción ahora mismo.** No espera a la tanda.
2. **Algo que solo se puede comprobar en el dominio real.** En esta app ha
   pasado tres veces: el gesto táctil, la zona segura y la barra del navegador
   se comportan distinto a como los simula un emulador. Si la duda solo se
   resuelve ahí, se despliega y se mide.

Si la tanda es larga y quieres ver algo a mitad, usa una **vista previa**
(`npx vercel --yes`, sin `--prod`): no toca producción y no obliga a repetir la
verificación completa.

⚠️ **Publicar en Vercel no toca Git.** El deploy sale por CLI desde la carpeta local, así que
producción puede ir por delante del repositorio. El 2026-09-05 quedaron 14 commits sin empujar
con la app ya en producción (`TRAMPAS.md` §«Publicar en Vercel no es cerrar»). Cerrar así:

```bash
git fetch origin && git log --oneline origin/main..HEAD   # debe salir vacío
```

> Reestructuración 2026-09-03: la app vive en la raíz del repo (`jg-turbo/`).
> Ya NO existe `Spech to text App/` ni `vercel_deploy/` como carpetas de
> trabajo/despliegue. `sincronizar_deploy.mjs` (raíz) es un resto del flujo
> antiguo y apunta a carpetas que ya no existen: **no usarlo**. El despliegue
> sale de la raíz.

### Durante el trabajo (se repite por cada cambio)

1. Editar en la raíz del repo (`jg-turbo/`: `index.html`, `js/`, `api/`, `sw.js`)
2. Correr las pruebas que toque **en local** (ver «Verificación»)
3. **Commitear.** Aquí NO se despliega

### Al final de toda la tanda (se hace una sola vez)

4. **Documentar** en el MD del feature (TTS → `CAMBIOS_TTS.md`: versión, dpl_, cambios, pruebas, proceso)
5. Alinear satélites si aplica (`DOCUMENTACION_DESPLIEGUE.md`, `FICHA_TECNICA.md`, `CONFIG_PERSISTENTE.md`, este `Agents.md`)
6. Subir la versión y la caché **una vez** (`JG_JS_V` en `index.html` y `CACHE_SHELL` en `sw.js`): un número por tanda, no uno por cambio
7. Correr la batería completa en local, incluidas las de navegador
8. Desplegar desde la raíz al proyecto **`jg-turbo`**:
   ```bash
   cd "C:\Users\juanl\Documents\Proyectos\jg-turbo"
   npx vercel --prod --yes --scope jhoncod24s-projects
   ```
   ⚠️ **No usar `--cwd`**: con Vercel CLI 59.x devuelve `Not authorized` aunque la sesión sea válida
   (comprobado 2026-08-15). Entrar en la carpeta y pasar `--scope`.
   ⚠️ Sin el `link` a `jg-turbo`, el deploy puede ir al proyecto `vercel_deploy` y **producción no cambia**.  
   ⚠️ Desde la raíz del monorepo → ~1000 archivos y **404** en jg-turbo.vercel.app.
9. Verificar prod **contra el dominio real**, no contra la URL que imprime el CLI:
   marcador en el HTML + `/api/health` (ver checklist en `CAMBIOS_YOUTUBE.md` §6),
   y las suites de navegador con `JG_BASE=https://jg-turbo.vercel.app`
10. Anotar `dpl_…` en la documentación
11. **Empujar a GitHub**: si trabajaste en una rama, `git merge --ff-only <rama>` sobre `main`
   y `git push origin main`. GitHub **no** está conectado a Vercel: el push no despliega nada,
   solo respalda. Sin este paso, producción vive únicamente en este equipo.

Detalle TTS completo: **`CAMBIOS_TTS.md`**. Persistencia: `CONFIG_PERSISTENTE.md`. Deploy: `DOCUMENTACION_DESPLIEGUE.md`.


## Verificación (qué correr antes de dar algo por terminado)

Todas viven en `tests/` y se ejecutan desde la raíz del repo. **No basta con que no haya `FALLO:`:
cuenta las comprobaciones.** Si salen menos que la última vez, la prueba se cortó (ver `TRAMPAS.md`
§1.2).

**Unitarias** (rápidas, sin navegador — córrelas siempre):

```bash
node tests/test_pdf_ancla.mjs            node tests/test_pdf_progreso.mjs
node tests/test_pdf_limpieza.mjs         node tests/test_pdf_sincronizacion.mjs
node tests/test_pdf_pulido_mecanico.mjs  node tests/test_pdf_pulido_troceo.mjs
node tests/test_pdf_exportar.mjs         node tests/test_pdf_busqueda.mjs
node tests/test_pdf_traduccion.mjs       node tests/test_pdf_auditoria_p0.mjs
node tests/test_pdf_voz.mjs              node tests/test_tts_narracion.mjs
node tests/test_pdf_mejora_apartado.mjs  node tests/test_pdf_cola_correccion.mjs
node tests/test_pdf_continuidad.mjs      node tests/test_pdf_caratula.mjs
node tests/test_tts_voz_estable.mjs      node tests/test_tts_voces_biblioteca.mjs
node tests/test_tts_pausas.mjs           node tests/test_youtube_doblaje.mjs
node tests/test_youtube_sincronia.mjs   node tests/test_x_doblaje.mjs
node tests/test_biblioteca_videos.mjs
```

Referencia al 2026-09-26 (v150): los 19 archivos de PDF/TTS suman **1.192 OK**;
`test_youtube_doblaje` **139** y `test_youtube_sincronia` **65** (0 fallos).
Referencia al 2026-09-27 (doblaje de X): `test_x_doblaje` **70 OK · 0 fallos**.
Referencia al 2026-09-28 (biblioteca de videos): `test_biblioteca_videos` **83 OK · 0 fallos**.
Referencia al 2026-09-28 (v157): `test_biblioteca_videos` **100** y
`test_youtube_sincronia` **74** (0 fallos).
Referencia al 2026-09-05 (v2.41.0): **1.120 comprobaciones OK, 0 fallos** (24 archivos).
Referencia anterior (v2.39.0): ~1.000 comprobaciones
(20 archivos; `test_pdf_mejora_apartado` aporta 50). Si salen menos, la prueba
se cortó.

**Con navegador** (Playwright; se busca en el repo, en `../node_modules` y en `JG Turbo_OLD/`):

| Comando | Qué cubre | Referencia |
|---|---|---|
| `node tests/verificar_pdf_geometria.mjs` | Desbordes, toques ≥44px (los <44px fallan) y solapes en móvil/tablet/escritorio | 54 |
| `node tests/verificar_pdf_scroll.mjs` | Que la biblioteca **se pueda desplazar** con nueve libros, y que las otras pestañas y el lector conserven su modelo de scroll | 39 |
| `node tests/verificar_pdf_navegador.mjs` | Recorrido funcional completo del lector | 116 |
| `node tests/verificar_pdf_movil.mjs` | **Obligatoria al tocar el lector en móvil**: reparto real de la pantalla, alcance del pulgar hoja por hoja, y que tablet y escritorio NO cambien | 46 |
| `node tests/verificar_pdf_voz_acordeon.mjs` | **Obligatoria al tocar el dock/acordeón de voz**: paleta plegable en tablet/escritorio, lectura sin saltos al plegar, estado tras F5 y hoja del teléfono intacta | 18 |
| `node tests/verificar_pdf_mini_flotante.mjs` | **Obligatoria al tocar el mini reproductor**: círculo comprimido, expandir, Ajustes sin apagar la voz, arrastre táctil sin robar toques y punto recordado tras recargar | 7 |
| `node tests/verificar_pdf_unir_palabras.mjs` | «Unir palabras» sobre una palabra partida de verdad, con su Deshacer | 18 |
| `node tests/verificar_arranque_ligero.mjs` | **Obligatoria al tocar lo que se carga al arrancar**: que el lector de PDF no viaje con quien solo abre la app | 7 |
| `node tests/verificar_movil_pantalla.mjs` | **Obligatoria al tocar alturas, scroll o zona segura**: quién desplaza, que se llegue al final del contenido y que no sobre hueco, en 5 pestañas × 4 teléfonos | 62 |
| `node tests/verificar_youtube_doblaje.mjs` | **Obligatoria al tocar el doblaje de YouTube**: idioma antes del texto, ventana de preparación (voz sin traducirlo todo), cancelar que corta verdad, caché por video, voz/subtítulos/pantalla completa, permiso de IA, texto completo bajo demanda y (v4) **0 frases de voz cortadas o saltadas con el español más largo que el inglés**, ritmo automático y subtítulo = voz — todo con API y reproductor simulados | 110 |
| `node tests/verificar_x_doblaje.mjs` | **Obligatoria al tocar el doblaje de X**: enlace de X en el mismo campo, audio en partes de ≤3,2 MB, **ninguna petición a video.twimg.com con Referer** (falla si lo lleva), iframe `/x-reproductor.html`, caché `x:<id>`, cancelar que corta verdad, errores que se leen y teléfono sin desborde | 24 |
| `node tests/verificar_biblioteca_datos.mjs` | **Obligatoria al tocar `cacheDoblaje.js` o los archivos doblados**: migración v1→v2, «lo automático nunca pisa lo que organizó la persona», deshacer, tope de voces, MP3/MP4 con voces reales, **recorte del silencio de una voz real de producción**, medida guardada con la voz y cancelar — en Chromium sin códecs **y** Chrome instalado | 48 |
| `node tests/verificar_biblioteca_videos.mjs` | **Obligatoria al tocar la biblioteca de videos** (`bibliotecaVista.js` o su marcado/CSS): migración al abrir, «Seguir viendo», búsqueda (también en lo que se dijo), filtros, temas, deshacer, teclado, «Listo al instante» sin gastar limitador, las tres descargas, el botón «Guardar archivo» y la voz guardada con su medida — con API, reproductor y red simulados | 52 |
| `node tests/test_archivo_doblaje.mjs` | **Obligatoria al tocar videos del equipo** (reglas puras, huella, partes, servicio con dobles, biblioteca, idioma como código, subtítulos .srt/.vtt) | 83 |
| `node tests/verificar_archivo_audio.mjs` | **Obligatoria al tocar videos del equipo** (Mediabunny real en Chromium y Chrome: MP3, copia AC-3, miniatura, MP4 doblado) | 26 |
| `node tests/verificar_archivo_doblaje.mjs` | **Obligatoria al tocar videos del equipo** (punta a punta con API simulada: elegir, doblar, biblioteca, reabrir, MP4, errores, Archivo, teléfono, cambio manual de voz, subtítulos propios) | 54 |

**Backend:** `python -m pytest backend/tests -q`.
⚠️ Falla al recolectar 5 módulos por importar `api.subtitulos_limpieza` y `api.pulido`, que no
existen. Es anterior a septiembre de 2026 (comprobado con `git stash`). Si tocas backend, corre los
archivos concretos que te afecten.

**Cuando toques CSS de alturas o scroll**, `verificar_pdf_scroll.mjs` es obligatoria: es la única
que trabaja con volumen suficiente para que el scroll exista. Las otras dos dieron 42/42 y 103/103
con el scroll completamente roto.

**Cuando toques el lector en el teléfono**, `verificar_pdf_movil.mjs` es obligatoria: es la única
que mide *cuánta pantalla se lleva el texto* y que tablet y escritorio siguen intactos. Las demás
daban verde con la cabecera partida en dos filas y el 44 % de la pantalla para el texto.

**Nunca saques el cromo del flujo en un lector paginado**: cambia el tamaño del área de texto,
obliga a repartir las páginas otra vez y deshace el salto de página. Ver `TRAMPAS.md`.

## Stack

- Frontend: `index.html` (SPA)
- API Vercel: `api/index.py` (Groq + Gemini/OpenRouter + MyMemory)
- Backend local: `backend/app.py` (faster-whisper)

## YouTube (leer antes de "arreglar" la extracción)

**Doblaje v3 (2026-09-26):** el idioma se decide ANTES de pedir el texto
(persona → YouTube Data API `defaultAudioLanguage` si hay `YOUTUBE_DATA_API_KEY` →
título del video → pistas) y se le pide a Supadata explícito: con doblaje automático
de YouTube «la primera pista» puede ser árabe en un video en inglés. La traducción y la
voz se preparan por ventanas alrededor de la posición (`js/youtube/motorPreparacion.js`:
traducción 180 s, voz 90 s, ≤ 18 síntesis/min por la cuota de Azure F0). Nunca volver a
traducir el video entero antes de reproducir, ni a mover el reloj a `requestAnimationFrame`.
Sin subtítulos: `409 sin_subtitulos` y permiso con créditos estimados. Pruebas:
`tests/test_youtube_doblaje.mjs`, `tests/verificar_youtube_doblaje.mjs`,
`backend/tests/test_youtube_idioma_origen.py`. Detalle: `CAMBIOS_YOUTUBE.md`.

**Doblaje v3.1–v149 (2026-09-26):** voz inicial `auto` (neural rápida según el
video, `jg_yt_voz`; 2.ª voz `jg_yt_voz2` solo con diálogo `>>` confirmado);
doble `<audio>` alternado (la fábrica entrega 2 elementos distintos,
desbloqueados en el gesto); traducción con ritmo ≥1,1 s y espera 15→30→60 s
ante 429. **Subtítulos: diseño ESTABLECIDO por el dueño, no cambiar su aspecto.**

**Doblaje v4 (v150, 2026-09-26) — la voz no se salta nada:** la frase que suena
termina ENTERA y la siguiente espera (`js/youtube/ritmoDoblaje.js` puro +
`dubbingEngine.js`). **No volver a elegir la frase por el reloj del video ni a
cortar/reposicionar la voz para alcanzarlo**: eso era lo que saltaba líneas
(simulado: 0 de 38 frases completas cuando el español necesita 1,4×). La voz va
de 1× a 1,25× (cómoda 1,12×) y, si no alcanza, el **video se frena solo** en
pasos de 0,05 (medido: la IFrame API los acepta), mínimo 0,75×, con histéresis;
interruptor «Ritmo automático» (`jg_yt_ritmo_auto`, encendido). El selector de
velocidad propio se retiró a pedido del dueño: la velocidad a mano va en el
engranaje de YouTube (`jg_yt_rate` guarda solo esa). El subtítulo muestra la línea
que dice la voz (`indiceSegmentoVoz`). Arranque: texto en paralelo con el
reproductor, voz precalentada, primer lote de 4, 2 lotes en vuelo, arranca con la
primera frase (`VOZ_INICIAL_S = 6`). Traducción: zona gris 0,6–0,85 = un solo
reintento del lote (el español correcto puede medir 0,74–0,83 del inglés; **no
volver a subir el umbral a ojo**) y ≥1,1 s entre TODA llamada del traductor.
Servidor: la cadena de IA prueba cada CLAVE una vez, aparta las rechazadas y
nombra el 429 (`backend/tests/test_ia_respaldo.py`). Pruebas:
`tests/test_youtube_sincronia.mjs` (simulador con reloj virtual). Consola:
`jgDoblajeDiagnostico()`. Medido en producción con un video real: 0 frases
cortadas (antes 8 en 90 s) y listo en 22 s (antes 40,8; ~15 s son de Supadata).
**v152:** el doblaje pide la voz con `idioma_fijo` (nunca voz inglesa a mitad),
descarta audio de una voz anterior (`versionVoz`), 2.ª voz «Ninguna» y tamaño del
subtítulo (`data-tamano`, solo `font-size`). `JG_JS_V='v152'`, prod `dpl_2a1EF9vPriohSGHWDJ9oYee6AHpM`. Desplegar desde
`git archive` del commit (ver `CAMBIOS_YOUTUBE.md` §Despliegues).

**Estado desde 2026-08-01: la extracción es automática otra vez.** Documento
maestro: **`CAMBIOS_YOUTUBE.md`** (diagnóstico medido, alternativas con fuente,
arquitectura, validación y guía de activación).

## X / Twitter (leer antes de tocar `api/x_video.py` o `js/youtube/*X*`)

- Documento maestro: **`CAMBIOS_X.md`** (arquitectura, contrato de la API,
  medición desde Vercel, límites, despliegues).
- **`video.twimg.com` rechaza el Referer de otro dominio** (403 medido): NO
  quitar `/x-reproductor.html` ni el `referrerPolicy: 'no-referrer'`, y no
  sacar el `<video>` de ese iframe «para simplificar». Ver `TRAMPAS.md`.
- El audio se trocea **en el navegador** en partes de ≤ 3,2 MB (Vercel corta
  a los 60 s y rechaza ~4,5 MB): no mover la descarga ni el troceo al servidor.
- X **no** usa Supadata (gasta créditos): el texto sale de Whisper de Groq
  (`/api/transcribe`), gratis. Ante «Límite de uso» se espera y reintenta.
- La sindicación (`cdn.syndication.twimg.com/tweet-result`) exige un `token`
  cualquiera de ~10 caracteres: sin token devuelve `{}`. FxTwitter es el respaldo.
- La caché vive en IndexedDB `jg_youtube` (sin versión nueva) con clave
  `x:<id>` (o `x:<id>:<n>` si el post trae varios videos).
- **v153 (2026-09-27):** doblaje de X en producción. `JG_JS_V='v153'`,
  prod `dpl_Er2mhf2iaRKaFabPwL9SVRQnxqyc`. Desplegado desde `git archive`
  del commit. Pruebas: `test_x_doblaje` 70 · `verificar_x_doblaje` 24 ·
  `test_x_video.py` 35 passed.
- **v154 (2026-09-28):** biblioteca de videos y descargas en producción.
  `JG_JS_V='v154'`, prod `dpl_2aBp79FCqtjHvzdj866t77J2deTc`.
- **v155 (2026-09-28):** el menú de opciones de la tarjeta se superpone a las
  tarjetas de abajo en vez de quedar detrás (`vid-con-menu`, `z-index:30`).
  `JG_JS_V='v155'`, prod `dpl_5HyrMbD3MD64do9tmF22XWUCPGij`.
- **v156 (2026-09-28, auditoría):** la voz ya no espera su propio silencio
  (~0,21 s delante + ~0,85 s detrás en cada frase, medido): `hablaVoz.js` mide el
  tramo hablado y lo usan el motor en vivo, el plan de ritmo y la mezcla de las
  descargas. **No volver a usar la duración del archivo como duración de la voz.**
  Más: descargas con la 2.ª voz y el tono del video, «Guardar archivo» en el
  teléfono, tarjeta que retoma bien. `CAMBIOS_YOUTUBE.md` §v156 y
  `CAMBIOS_BIBLIOTECA_VIDEOS.md` §Auditoría. `JG_JS_V='v156'`, prod `dpl_8EbXfNEPLECrn2RA2gWemshoJETS`.
- **v157 (2026-09-28):** cada frase entra 0,08 s antes de su segundo
  (`ANTICIPO_ARRANQUE_S`: el tic de 100 ms + la demora de `play()` la dejaban
  ~40 ms tarde) y la voz guardada trae su tramo hablado ya medido (al volver a un
  video no se decodifica nada). `CAMBIOS_YOUTUBE.md` §v157. `JG_JS_V='v157'`,
  prod `dpl_EafotrCk2sVosZAvGLqRJPaFNFXa`.

## Biblioteca de videos (leer antes de tocar `cacheDoblaje.js` o `bibliotecaVista.js`)

- Documento maestro: **`CAMBIOS_BIBLIOTECA_VIDEOS.md`** (especificación:
  `docs/superpowers/specs/2026-09-28-biblioteca-videos-design.md`, plan:
  `PLAN_BIBLIOTECA_VIDEOS_IMPLEMENTACION_LLM.md`).
- **La base IndexedDB `jg_youtube` es v2 y solo sube** (TRAMPAS.md §7.2). Migración
  aditiva: crea lo que falta y copia, nunca borra. Almacenes: `doblajes`, `videos`
  y `voces`.
- **Nada se poda salvo `voces`** (tope 300 MB, se regeneran). La poda de 20 videos
  se eliminó: quitar es manual y con «Deshacer». Lo automático nunca toca
  `etiquetas` ni `favorito`.
- La voz guardada **no pasa por el limitador** de Azure: `buscarGuardada` en
  `dubbingService.js` se consulta antes de gastar turno. «Listo al instante».
- Descargas con **Mediabunny** en `js/vendor/mediabunny/` (import de las extensiones
  reescrito a `./mediabunny.min.mjs`, M6/TRAMPAS.md). Carga diferida en
  `medios.js`: no importarlo al arrancar. Ver `js/vendor/mediabunny/LEEME.md`.
- `crearDestino` (`destinoArchivo.js`) es lo **primero** del clic en «Descargar»:
  `showSaveFilePicker` exige el gesto (TRAMPAS.md).
- **De YouTube solo se ofrece el audio doblado (MP3)**: nunca video de YouTube.

## Videos del equipo (leer antes de tocar `archivoLocal.js`, `medioLocal.js`, `servicioArchivo.js`)

- Documento maestro: **`CAMBIOS_VIDEO_LOCAL.md`** (especificación:
  `docs/superpowers/specs/2026-10-01-doblaje-video-local-design.md`, plan:
  `PLAN_VIDEO_LOCAL_DOBLAJE_IMPLEMENTACION_LLM.md`, medidas: `docs/video-local/MEDICIONES.md`).
- **El video nunca viaja al servidor ni se copia** (ni IndexedDB, ni OPFS, ni Cache).
  Solo viajan partes de audio de ≤ 3,2 MB a `/api/transcribe`. Nunca
  `file.arrayBuffer()` del video entero: se lee por rangos (`BlobSource`).
- **Una sola puerta a `/api/transcribe`:** `subirParte` de `transcripcionPartes.js`
  (X y archivos). No escribir otra.
- **Mediabunny carga diferido** (`medios.js`, `import('./medioLocal.js')`): nunca al
  abrir la app (`verificar_arranque_ligero`).
- **La base `jg_youtube` sigue en v2.** Nada de almacenes nuevos. El registro parcial
  vive dentro de `doblajes` y lo reemplaza `completarSesion`.
- Pruebas: `test_archivo_doblaje` 83 · `verificar_archivo_audio` 26 ·
  `verificar_archivo_doblaje` 54 (**obligatorias al tocar videos del equipo**).
- Lo transcrito no dice quién habla: la 2.ª voz automática no entra sola en estos
  videos; hay cambio manual («Aquí habla otra persona», `#ytOtraVoz`). No quitarlo.

## PDF (leer antes de tocar `js/pdf/`)

Documento maestro: **`CAMBIOS_PDF.md`** (v1.0, 2026-08-31).
Procedimiento para adaptar libros: **`pdf/regla-pdf/PLAN_OPERATIVO_DEFINITIVO_PDF_JG_TURBO.md`**.
Para fuentes en inglés, aplica además **`pdf/regla-pdf/PLAN_TRADUCCION_LIBROS_INGLES_JG_TURBO.md`** antes de construir la candidata en español.

**Regla de entrada PDF:** ningún archivo se considera adaptado por su nombre,
carpeta, inventario o informe anterior. Cada asignación exige una auditoría nueva
del hash actual según la sección 0 del plan. Si un validador imprime
`fidelidad=pendiente_revision`, el libro falla aunque el proceso termine con
código 0 o también imprima un mensaje de éxito.

**La decisión que no se revierte:** el texto se extrae **en el navegador** con
pdf.js, nunca en el servidor. Vercel rechaza peticiones de más de ~4,5 MB, así que
un libro de 30 MB no se puede subir: no es una preferencia, es el límite de la
plataforma. Además así el archivo no sale del dispositivo y no hay nada que borrar.

El motor vive en `js/vendor/pdfjs/` (v6.3.289, Apache-2.0), **no en un CDN**: la app
es PWA y debe abrir un PDF sin conexión. Se carga con `import()` dinámico al usar la
pestaña, para no cobrarle 1,7 MB a quien no lee PDFs.

**No volcar un libro entero en el `<textarea>`**: por encima de 90.000 caracteres el
texto se divide en capítulos y se muestra uno solo. La fuente de verdad son las
partes (`estado.partes`); el texto completo se compone a partir de ellas. El
buscador, la descarga `.txt` y el contexto de la IA sí usan el documento entero.

**Biblioteca (v2.0):** `js/pdf/biblioteca.js` guarda cada documento en CUATRO
almacenes de IndexedDB (`documentos`, `contenido`, `archivos`, `traducciones`).
Están separados a propósito: pintar la biblioteca solo lee `documentos`, sin
cargar textos ni PDFs. No juntarlos «para simplificar»: con 200 libros la
pestaña tardaría segundos en abrir. La versión de la base es la 2 y trae
migración desde la 1: si se sube a 3, migrar también.

**Persistencia:** se pide `navigator.storage.persist()` al guardar el primer
documento. Sin eso iOS borra la biblioteca tras días sin uso. Si el navegador la
niega, la app lo dice; no prometer permanencia que no se controla.

**`flex:none` en los bloques del lector** (`.pdf-doc-cab`, `.pdf-indice`,
`.pdf-trad`, …) no es decorativo: `#pdfResultArea` es una columna flexible y sin
eso el índice se aplasta a 2 px y su contenido se desborda sobre el texto.
Medido, no supuesto.

**Traducción:** el lector decide QUÉ y CUÁNDO traducir; CÓMO se traduce sigue en
`traducirTranscripcionDetallada`. Cada capítulo traducido se guarda: no volver a
pagarlo. `js/pdf/traduccion.js` ya evita traducciones duplicadas en paralelo.

**OCR (v1.1):** los PDF escaneados se pueden leer con Tesseract en el navegador,
pero **solo cuando la persona lo pide**: es lento (segundos por página) y por eso
el valor por defecto son 10 páginas. `js/vendor/tesseract/` pesa 18 MB en el repo
porque lleva **las tres variantes LSTM del núcleo** (normal, SIMD y relaxed-SIMD):
si falta la que soporta el navegador, el OCR no arranca. tesseract.js 7 exige
núcleo 7. Quien no use OCR no descarga nada de eso.

**Audiolibro (v1.1):** `jgAudiolibro` en `index.html` es el único punto donde el
motor de voz y el lector de PDF se tocan: al terminar una parte, `ttsFinLectura()`
pregunta si hay otra. No meter lógica de PDF dentro del motor de voz.

**Exportar a .docx (v1.1):** se arma a mano en `js/pdf/exportar.js` (ZIP + XML,
con su CRC32). Si se toca, correr `pytest backend/tests/test_docx_valido.py`: usa
`zipfile`, que **verifica el CRC** y detecta un archivo que Word rechazaría.

**Carátulas de libros (estándar obligatorio y permanente):**
Todo PDF en la app **debe mostrar siempre su carátula original auténtica**, tanto en la cuadrícula de la biblioteca como en «Seguir leyendo» y en el lector. Para garantizarlo:
1. **Jerarquía estricta de carátulas (`js/pdf/caratula.js`):**
   - **Prioridad 1 — Catálogo canónico local (`PORTADAS_CANONICAS`):** Libros base y obras esenciales se registran en `PORTADAS_CANONICAS` asociadas a `/img/portadas/{nombre}.jpg`. Estas imágenes se precachean en el Service Worker (`sw.js`) bajo `CACHE_SHELL` para disponibilidad offline inmediata en PWA.
   - **Prioridad 2 — Extracción directa de página 1 (`extractorPdf.js`):** Si no es canónico, se extrae la página 1 del PDF con `pdf.js` a canvas (380 px de ancho, JPEG 0.85). **Muestreo de blancura:** si más del 99.2% de los píxeles son blancos (portadilla de texto interior o página en blanco), el extractor pasa a la página 2 antes de rendirse.
   - **Prioridad 3 — Consulta a catálogo (OpenLibrary / Google Books):** Si falla la extracción local, se consulta `buscarPortadaReal(titulo, autor)`.
   - **Prioridad 4 — Canvas dibujado:** Solo como respaldo si todo lo demás falla.
2. **Sanitización obligatoria de títulos:**
   - **Prohibido buscar `(anonymous)` o títulos vacíos.** `limpiarNombreLibro()` descarta metadatos espurios como `(anonymous)` y recurre al nombre de archivo (`nombreArchivo`) para evitar que OpenLibrary devuelva novelas no relacionadas (p. ej. *Sinners Anonymous*).
3. **Al adaptar un nuevo PDF con `regla-pdf`:**
   - La primera página del PDF generado **debe ser la carátula gráfica original a sangre** (`portada_original: true` en `perfil.json`, con `portada.jpg`).
   - Al compilar con `5_construir.py`, pasar siempre título y autor limpios (`python 5_construir.py "Título" "Autor"`), impidiendo metadatos anónimos en ReportLab.
   - Si el libro formará parte de la biblioteca estándar, guardar además una versión optimizada en `img/portadas/{slug}.jpg` (ancho 380 px, JPEG liviano) y registrarla en `PORTADAS_CANONICAS`.
4. **Auto-reconciliación en segundo plano:**
   - `completarCaratulasQueFaltan()` en `pdfController.js` detecta libros con portada dibujada, faltante o título anónimo, actualizándolos en IndexedDB y refrescando **en simultáneo** `pintarBiblioteca()` y `pintarContinuar()`.


## Sincronización entre dispositivos (leer antes de tocar `api/sync.py`)

Documento maestro: **`CAMBIOS_SYNC.md`**.

**No hay usuarios ni correos, y es deliberado:** hay «bibliotecas» y llaves. Eso
mantiene el proyecto fuera del alcance de la Ley 1581 (habeas data) porque no se
guarda ni un dato personal. **No añadir registro por correo** sin decidir antes
quién asume esa responsabilidad legal.

**El servidor nunca guarda una llave en claro**, solo su huella SHA-256. Por eso
al vincular un dispositivo se le fabrica una llave NUEVA en vez de entregarle la
existente. Hay una prueba que falla si alguien rompe esto.

**Dónde vive la seguridad: en la base, no en la API.** Las tablas `jgt_*` tienen
RLS activo y **sin políticas**; lo único accesible desde fuera son diez
funciones `SECURITY DEFINER` (`jgt_crear`, `jgt_codigo`, `jgt_vincular`,
`jgt_estado`, `jgt_bajar`, `jgt_subir`, `jgt_subir_parte`, `jgt_bajar_partes`,
`jgt_resumen_partes`, `jgt_olvidar`) que validan la llave.
Por eso basta la **clave pública** de Supabase y NO se usa la `service_role`.
No cambiar esto por PostgREST directo: volvería a hacer falta la clave secreta.

**Sincronización por capítulos (chunking):** Los libros viajan ligeros (metadatos
en `/api/sync/subir` y texto capítulo por capítulo en `/api/sync/parte`). No hay
límite de tamaño de libro y no se satura el payload de Vercel. `completarCapitulos`
en `js/pdf/nube.js` reconcilia automáticamente cualquier capítulo faltante.

**Vinculación por QR:** `mostrarPase()` espera `await sincronizarAhora` antes de
mostrar el código QR/enlace `?unir=...` para garantizar que todo el contenido
esté listo en la nube cuando el nuevo dispositivo se conecte.

**Prefijo `jgt_`:** esa base la comparte otra app del mismo dueño (25 tablas).
Cualquier tabla o función nueva de JG Turbo lleva ese prefijo.

**Proyecto Supabase:** `jg-PRUEBA` (`xuyxgzxseoetidzfqntu`). Tras un «restore»,
esperar a que responda de verdad antes de migrar: una migración aplicada durante
la restauración se pierde sin avisar.

**Regla de conflictos:** gana el cambio más reciente, y vive en UN solo sitio
(`js/pdf/sincronizacion.js`, con pruebas). No reimplementarla en el cliente.

**El cursor es una fecha ISO**: el `+` de la zona horaria se convierte en espacio
al viajar por una URL. El servidor lo repara; no quitar esa línea.

## Captura de pestaña · ELIMINADA (2026-08-31)

La pestaña Captura (doblaje de una pestaña del navegador con `getDisplayMedia`) se
eliminó por pedido del usuario: no funcionaba bien y estorbaba. Se borraron el panel,
`js/captura/`, sus pruebas y sus documentos. **No reintroducirla** sin pedido expreso.
La API no se tocó: usaba `/api/transcribe` y `/api/translate` compartidos. Los videos
compartidos desde el teléfono ahora van a la pestaña **Archivo**.

**El hecho medido:** YouTube bloquea a las IP de centros de datos **de forma
determinista**, no aleatoria. El mismo video falló 5/5 veces desde Vercel; otro
pasó 3/3. Tasa antes del cambio: **1 de 6 (17 %)**, y el único que pasaba era un
video hiperviral ya cacheado. **Reintentar no sirve.**

Cadena vigente en `POST /api/youtube`:

1. `youtube-transcript-api` + scraping — gratis, primero para no gastar créditos.
2. **Supadata** (`api/supadata.py`, `mode=auto`) — vía principal: sale por su propia
   red y genera con IA si el video no tiene subtítulos.
3. yt-dlp + Whisper de Groq — respaldo.
4. Pegado manual en la UI — red de seguridad, **no borrar** (`ytPasteInput`,
   `btnYtPasteClip`, `jgLimpiarTranscripcionPegada`, `jgAplicarTextoPegadoYt`).

Contrato de API que el frontend debe respetar:

- `POST /api/youtube` → `200` texto · **`202` `{pending, job_id}`** (videos +20 min)
  · `402` sin créditos · `503` todo falló.
- `GET /api/youtube-job?id=…` → `200` texto · `202` sigue en proceso.
- `GET /api/health` → `youtube_auto: true|false`.

Reglas para el siguiente agente:

- **No quitar el paso 1**: el plan gratuito es de 100 créditos/mes y ese paso los ahorra.
- **No quitar el camino del `202`**: sin él, los videos largos mueren contra el
  límite de 60 s de la función.
- **`SUPADATA_API_KEY` solo en variables de entorno de Vercel.** Nunca en código ni en Git.
  Vercel entrega las variables nuevas **en el siguiente despliegue**: añadirla no basta.
- No perder tiempo con espejos Invidious ni con `timedtext` sin firma: probados, vacíos.
- **PO Token (`bgutil-ytdlp-pot-provider`) ya no sirve** para esto: su documentación
  dice que no salta el bot-check en la mayoría de casos, y exige un servicio corriendo
  permanentemente que no cabe en una función serverless.
- **Bookmarklet eliminado (2026-07-31):** no reintroducirlo (`ytBookmarklet`,
  `.yt-manual-advanced`, `prepararBookmarkletYt`). Si hace falta un atajo, extensión o
  botón real, nunca un enlace `javascript:` a la vista.
- `YOUTUBE_PROXY_URL` sigue conectada como plan C; ya no hace falta.
- **Panel rediseñado (v2.1, 2026-09-01):** el orden del inicio es lead →
seguir leyendo → biblioteca → subir → avisos → **nube plegada al final**
(`<details>`; se despliega sola al llegar por `?unir=` o al pedir el pase).
`has-results` también esconde la nube. El lector lleva toolbar sticky
(`.pdf-doc-top`). El ritmo visual sale de tokens en `.pdf-area`
(`--pdf-r`, `--pdf-gap`, `--pdf-pad`): no poner radios ni márgenes sueltos
en este panel. Detalle: `tests/verificar_pdf_geometria.mjs` vigila
overflow y táctil; los clics automatizados dentro de `.pdf-area` (scroll
anidado) van por DOM, no por coordenadas.

SW vigente: **`jg-turbo-shell-v166`** (tecnicismos como código, 2026-10-02). PWA instalable en escritorio (Chrome/Edge) y móvil: ver `INSTALAR_ESCRITORIO.md`.

## Traducir (leer antes de tocar `/api/translate`)

Documento maestro: **`CAMBIOS_TRADUCCION.md`**.

**El hecho medido (2026-08-01):** Vercel corta la función a los **60 s**. Traducir
de una sola vez tarda en proporción al texto (~350 caracteres/segundo), así que
**siempre** hay un largo que muere: 39 732 caracteres → `504
FUNCTION_INVOCATION_TIMEOUT` a los 60,4 s. Subir `maxDuration` solo mueve el techo.

**Por eso el troceo vive en el navegador** (`index.html`): parte el texto en
bloques de 6 000 caracteres y lanza varias peticiones cortas, 2 en paralelo, con
progreso visible. Así deja de existir un tamaño máximo.

Reglas para el siguiente agente:

- **No mover el troceo al servidor**: volvería el 504. El navegador es el único
  lado sin límite de tiempo.
- **Una sola puerta a `/api/translate`.** Solo `jgPedirTraduccion` puede llamarla;
  todo lo demás pasa por `traducirTranscripcionDetallada`, que es la que trocea.
  Esto costó un segundo arreglo: el panel Traducir (`btnTransTranslate`) tenía su
  propia llamada, mandaba el texto entero y el usuario veía «Error en la
  traducción del servidor» (el fallback de `resp.json()` al recibir un 504 HTML).
  La prueba `test_ningun_camino_llama_a_translate_saltandose_el_troceo` lo vigila.
- **No subir `TRAD_MAX_CHARS_POR_PETICION`** por encima de ~6 000 sin volver a
  medir: el margen contra los 60 s es lo que evita el fallo.
- `prefer_fast` es `Optional[bool]`: `False` explícito significa **calidad (IA
  primero)** y ahora se respeta. Antes un `or len(txt) >= 1200` lo ignoraba y toda
  transcripción larga salía por MyMemory.
- El validador (`api/calidad_linguistica.py`) está calibrado contra falsos
  positivos medidos, no a ojo. **No endurecerlo sin volver a medir** sobre
  traducciones correctas reales. Reglas que no se deben revertir:
  - cifras: valen si sus dígitos están en el otro texto **o** si aparecen
    escritas con palabras (`16` ↔ «dieciséis»);
  - términos técnicos: cuenta la **presencia**, no cuántas veces aparecen;
  - nada de siglas de menos de 3 letras (`IS`, `OK`, `US`, `UI`, `MA`, `BA`);
  - siglas equivalentes entre idiomas (`ADHD↔TDAH`, `US↔EE.UU.`, `UN↔ONU`…);
  - `paragraphs` solo si se pierde la mitad o más de los párrafos.
  Con esto, 7 de 7 bloques de una charla real pasaron de `warning 76-88` a
  `ok 100`. Hay 17 pruebas que **exigen** que siga detectando lo real (cifra
  inventada, cifra perdida, término ausente, texto a medias, texto sin traducir).
  Está duplicado en `backend/calidad_linguistica.py`: **mantener ambas iguales**.
- El troceo se publicó con SW `v10`; el fix del panel Traducir con `v11`. El SW
  vigente lo marca la última entrega (ver sección YouTube/TTS).

## Causa del 404 (2026-07-23) y prevención

El 404 `NOT_FOUND` ocurrió porque un deploy se lanzó desde la **raíz del monorepo** (`JG Turbo/`), donde **no hay** `index.html`. Vercel subió miles de archivos y la producción quedó sin frontend.

**Siempre** ejecutar el deploy desde la raíz del repo aplanado (`jg-turbo/`,
donde SÍ hay `index.html`):

```bash
cd "C:\Users\juanl\Documents\Proyectos\jg-turbo"
npx vercel --prod --yes --scope jhoncod24s-projects
```

Nunca desde la raíz del workspace (`Proyectos/`). Nota histórica: antes se
desplegaba desde `vercel_deploy/`; esa carpeta ya no existe tras la
reestructuración del 2026-09-03. Tras el fix original: ~17 archivos, alias https://jg-turbo.vercel.app OK con TTS.

## TTS (lectura en voz alta)

### ⚠️ Estrategia vigente (2026-09-17): 100 % GRATUITA — decisión del usuario

El usuario **no paga** créditos de Fish ni suscripciones (ElevenLabs
investigado y descartado: 5-12× más caro por hora). La meta es máxima
estabilidad gratis. Cadena por bloque: **Fish gratuito** (Roberto y clones,
con fusible: rachas de caída de minutos a ~1 h, vuelve solo) → **Azure F0
oficial** (500k chars/mes gratis, ~1 s/bloque, no puede facturar) →
**edge-tts** (gratis, no oficial) → navegador. Verificar con
`/api/health` (`tts_fish`, `tts_azure`). Diagnóstico medido, costos,
rotación de llave Azure y comandos: **`CAMBIOS_TTS.md` §Estrategia de voz
vigente**. Síntesis local descartada por hardware (PC sin GPU dedicada).

**Clones JG Voice → PDF:** receta para agentes en
`docs/INTEGRAR-VOZ-JG-VOICE.md`. No armes un API entre las dos apps: el puente
es el `reference_id` de Fish (misma cuenta). No reviertas el «PDF apaga Fish».
Fish caído = sin clones en AMBAS apps (JG Voice sintetiza contra el mismo
`api.fish.audio/v1/tts`).

**v2.88.1 — Azure F0 oficial activado** (2026-09-17): respaldo de voz oficial
gratuito (500k chars/mes) entre Fish y edge-tts. Recurso `jg-turbo-voz`
(eastus, plan Free F0), claves solo en Vercel/`.env`. `/api/health` reporta
`tts_fish`/`tts_azure`. Cadena: Fish → Azure → edge-tts → navegador. Detalle:
`CAMBIOS_TTS.md` §v2.88.1.

**v2.88.0 — fusible de Fish** (2026-09-17): con Fish caído (pagado 402 sin
créditos + gratuito colgado), cada bloque quemaba 22 s antes de caer a Edge y
el aviso «revisa tu conexión» sonaba cada 30 s. Ahora: 3 fallos seguidos dejan
Fish en cuarentena 120 s (bloques por Edge en 1-2 s), el 402 se recuerda 10
min y el aviso dice la verdad una vez cada 15 min. La cura definitiva es
recargar créditos de API en fish.audio → Billing. Detalle: `CAMBIOS_TTS.md` §v2.88.0.

**v2.84.0 — voz Fish estable en PDF** (2026-09-14): el bloque que tropieza
se reintenta con Fish (servidor 2 + cliente 2) en vez de salir por Edge con
otro timbre; modelo pagado `s2.1-pro` por defecto, temperatura 0,35, prefetch
en `unified`. Detalle: `CAMBIOS_TTS.md` §v2.84.0.

**v2.83.0 — voces Voice Design** (2026-09-12): JG Narradora (`jg-narradora`) y
JG Narrador (`jg-narrador`). Slug con `jg-` porque `narrador` redirige a
Valentino. Salen 14 voces del selector; la femenina por defecto es ahora
`jg-narradora` (antes `narradora`, retirada). Detalle: `CAMBIOS_TTS.md` §v2.83.0.

**Motor v2.79.0 — clones JG Voice** (2026-09-11): Roberto, Amy, Dora y Michael.
Sandra Design Travel salió del selector. Detalle: `CAMBIOS_TTS.md` §v2.79.0.

**Motor v2.77.0 — voz clonada Roberto** (2026-09-10): el lector de PDF usa la
voz Fish que elijas (incluido el clon privado **Roberto** de JG Voice). Ya no
se fuerza Edge. Catálogo + `reference_id` en `api/index.py`. Detalle: `CAMBIOS_TTS.md` §v2.77.0.

**Motor v2.16.3 — 18 voces Fish, agrupadas** (2026-08-19): el listado de Fish
Audio se parte por idioma y género (español/inglés × femeninas/masculinas).
Hay 14 en español y 4 en inglés. Se eligen igual que Salomé: no se aplican
solas. Detalle: `CAMBIOS_TTS.md` §v2.24.0.

**Motor v2.10.0 — descarga MP3** (2026-08-14): cada consola de Micrófono,
Archivo, YouTube, Traducción y «Editar en grande» monta una acción secundaria
`MP3` junto a «Escuchar». Genera el texto completo con la voz, acento, tono y
velocidad elegidos; procesa textos largos por bloques en paralelo y los une en
orden dentro del navegador. No sube ni conserva archivos adicionales. La
descarga requiere el motor Neural porque `speechSynthesis` no permite exportar
las voces instaladas del navegador. Detalle y pruebas: `CAMBIOS_TTS.md` §v2.10.0.

**Motor v2.9.0 — voces regionales reales** (2026-08-14): por defecto usa
`regional`, aplica el acento español elegido (CO/MX/AR/CL/PE/es-US) y cambia a
voces nativas para inglés o portugués. `auto` histórico migra a `regional`.
`unified` queda opcional y no aplica el selector de acento porque usa voces
multilingües con base `en-US`. El selector visible no añade todos los idiomas de
`speechSynthesis`; el respaldo del navegador no introduce pausas artificiales.
Detalle y pruebas: `CAMBIOS_TTS.md` §v2.9.0.

**Motor v2.8.0 — lectura continua con controles de reproducción** (2026-08-14):
dos `<audio>` que se turnan (sin huecos entre bloques), colchón de 120 s generado
por delante, bloques escalonados `190→340→560→900`, velocidad aplicada en el
navegador (`playbackRate`, cambio instantáneo sin reiniciar), barra con ⏪/⏩ 10 s
y posición arrastrable, caché de audio, `GET /tts` cacheable, `GET /tts-warmup` y
voces propias para **es · en · pt · fr · de · it** con detección del idioma real
del texto. Detalle y medidas: `CAMBIOS_TTS.md` §v2.8.0.

**Histórico v2.7.0 — «Misma voz» multilingüe** (2026-08-09). En esa versión era
el valor inicial; desde v2.9.0 queda como alternativa opcional. UI de consola:
**franja horizontal** (2026-08-01).

| Rol | Voz (modo «Una voz», opcional) | Respaldo |
|---|---|---|
| Mujer | `en-US-AvaMultilingualNeural` | `en-US-EmmaMultilingualNeural` |
| Hombre | `en-US-AndrewMultilingualNeural` | `en-US-BrianMultilingualNeural` |

Modo regional actual, con acentos manuales CO/MX/AR/CL/PE/es-US:

| Rol | Voz |
|---|---|
| Mujer ES inicial | `es-CO-SalomeNeural` |
| Hombre ES inicial | `es-CO-GonzaloNeural` |
| Mujer EN | `en-US-AvaNeural` |
| Hombre EN | `en-US-AndrewNeural` |

Config `jg_tts_bilingual`: `regional` (defecto) | `unified` | `off`. El valor antiguo
`auto` migra a `regional` al leerlo. API `POST /tts` acepta `unified: true`
(sin force-EN; headers `X-TTS-Language: multi`, `X-TTS-Engine: edge-neural-unified`).

- Historial + arquitectura + deploys + pruebas: **`CAMBIOS_TTS.md`** (maestro)
- Prod actual: UX **v3.8** (`CAMBIOS_UX.md`) · TTS motor **v2.15.0** · https://jg-turbo.vercel.app
- UX reciente: v3.8 pegado sin saltos + Párrafos explícito · v3.7 interlineado compacto · v3.6 FAB Grabar/Detener móvil
- **Contrato de pegado:** no retirar `jgCompactarTextoPegado` ni
  `jgPegarTranscripcionCompacta`. Micrófono, Archivo, YouTube y «Editar en
  grande» deben convertir saltos del portapapeles en espacios; solo «Párrafos»
  introduce separaciones dobles. Prueba obligatoria:
  `tests/test_espaciado_texto_pegado.js`.
- **Micrófono largo:** WAV de 4+ min se parte en ~90 s (límite body Vercel ~4,5 MB). Ver `PRECISION_AUDIO.md`.
- **Documentar siempre** cada entrega en el MD del feature (versión, deploy, pruebas). Ya no hay que sincronizar a `vercel_deploy/` (no existe desde la reestructuración del 2026-09-03).
- **Nunca** `npx vercel --prod` desde la raíz del workspace (`Proyectos/`, causa 404): siempre desde la raíz del repo (`jg-turbo/`).
- **Nunca desde `JG Turbo_OLD/` ni desde `JG Turbo_OLD/vercel_deploy/`.** Es el respaldo de agosto y
  tenía dos enlaces al MISMO proyecto de producción: desplegar desde ahí sobrescribía
  jg-turbo.vercel.app con la versión vieja. El 2026-09-04 se renombraron a
  `.vercel.NO-DESPLEGAR-CARPETA-ANTIGUA`; no los restaures. Detalle en `TRAMPAS.md` §9.3.

## Auditoría de video local v164 (2026-10-01)

Subtítulos debajo de la imagen, también en pantalla completa, por pedido del
dueño. Video local espera a la voz pendiente y, con ritmo automático, a la frase
que no cabe. `SyncEngine` sigue a la voz durante esa espera. SRT/VTT valida tiempos
y duración, conserva UTF-16 y descarta selecciones asíncronas de otro video.
Informe: `docs/auditoria-video-local/INFORME.md`. Pruebas actuales: archivo 88,
sincronía 90 y E2E local 78. Las pruebas físicas y de escucha se reportan aparte.

## Reforma móvil PDF + Videos v168 (2026-10-04)

Dirigida por un agente director con 6 ejecutores en ramas aisladas. `JG_JS_V='v168'`,
SW `jg-turbo-shell-v168`, prod `dpl_ATGXEenmGPpQrT2it2kFE6tJZgU6` (incluye la v167 de
otra sesión: un despliegue v166 intermedio la había pisado; ver TRAMPAS.md). Detalle en
`CAMBIOS_PDF.md` (PDF-1, PDF-2a, PDF-2b) y `CAMBIOS_YOUTUBE.md` /
`CAMBIOS_BIBLIOTECA_VIDEOS.md` (subtítulo dinámico, video activo, voz robusta).

- **PDF:** la página sigue al carácter que suena (`seguirVoz`), nunca por el
  inicio de la marca; ancho de columna con decimales (en 360 px el redondeo
  adelantaba la página). Resaltado por oraciones (`js/pdf/unidadesLectura.js`,
  cláusulas si > 240, tope 300); la marca no cambia métricas del texto.
  Teléfono = `(max-width:640px), (orientation:landscape) and (max-height:500px)`:
  en horizontal, dos columnas y cromo compacto. La reserva de cromo es constante
  (alternar `jg-inmersivo` no reparte páginas). Gestos: solo un deslizamiento
  claramente horizontal pasa página; `overscroll-behavior:none` solo leyendo
  paginado. Paso de página «Libro» con hoja opaca `.lec-hoja`
  (`jg_pdf_paso_pagina`: libro | deslizar | ninguna).
- **Videos:** subtítulo dinámico de 1-2 renglones al ritmo de la voz
  (`js/youtube/subtituloDinamico.js`, `jg_yt_subtitulo_estilo`), pegado bajo la
  imagen en pantalla completa y superpuesto en el tercio inferior en el teléfono
  horizontal. Video activo en `jg_yt_video_activo` (puntero; lo pesado sigue en
  `jg_youtube` v2): sobrevive a F5, cerrar la app y cambiar de pestaña (pausa al
  salir). Botón × y «Cambiar video». La voz espera en YouTube/X/archivo si la
  síntesis no llegó («Preparando la voz…»), se resincroniza tras dormir la
  página (`TIC_PERDIDO_MS`) y `destruir()` suelta sus oyentes.
- **Pruebas nuevas:** `verificar_pdf_voz_pagina` 93 · `verificar_pdf_orientacion`
  236 · `verificar_pdf_gestos` 67 · `verificar_pdf_animacion` 107 ·
  `test_pdf_unidades_lectura` 61 · `test_subtitulo_dinamico` 51 ·
  `verificar_subtitulos_video` 192 · `test_video_activo` 26 ·
  `verificar_video_persistencia` 248 · `test_voz_robusta` 66 ·
  `verificar_voz_doblaje_robusta` 92. `verificar_youtube_doblaje` pasa a 111.
- **Fallos previos (idénticos en `09c35be`, no son de esta tanda):**
  `verificar_pdf_navegador` 1 (aviso de OCR), `verificar_pdf_guia_tiempo` (5-13 de
  75 muestras), `verificar_fase_a_recargar` (corta en 20: la tarjeta se repinta),
  `verificar_arranque_ligero` (1087 KB > 1 MB; era 1070).


## Videos v167 (2026-10-04): maximo de 120 minutos

YouTube, X y archivos del equipo adoptan 120 minutos como maximo de nuevas
sesiones. SRT/VTT tienen el mismo techo. Detalle, pruebas y publicacion:
`CAMBIOS_VIDEOS_120.md`. El troceo, las cuotas y las bibliotecas se conservan.
