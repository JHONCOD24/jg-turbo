# JG Turbo — reglas para agentes

## Coordinación multi-agente

Si hay agentes de **diseño/UX** en paralelo: **no editar** `index.html` ni copiar un frontend viejo a `vercel_deploy/`. Ver `../COORDINACION_AGENTES.md` e inventario en `../auditoria-ux-2026-07-29/INVENTARIO_TECNICO.md`.

## Persistencia (crítico)

Lee **`CONFIG_PERSISTENTE.md`** antes de tocar configuración o `localStorage`.

- Claves, glosario y preferencias viven en el **navegador** (`jg_*`).
- Un **deploy no las borra**. No renombrar claves sin migración. No sobrescribir con vacío.
- Bundle: `jg_config_bundle`. UI: Exportar / Importar config.
- Deploy: sincronizar a `G:\Mi unidad\PROYECTS\JG Turbo\vercel_deploy\` → `npx vercel --prod --yes`
- Git: repo en `Spech to text App/` → `JHONCOD24/jg-turbo` (author `JHONCOD24 <juanloras35@gmail.com>`)
- Prod: https://jg-turbo.vercel.app


## Despliegue (obligatorio al cerrar mejoras)

**Siempre desplegar en Vercel** cuando se termine una mejora o feature de esta app. No dejar solo cambios locales.

**Regla persistente para futuros agentes:** una mejora no se considera cerrada hasta que esté documentada en el MD del feature, sincronizada en `../vercel_deploy/`, desplegada al proyecto `jg-turbo` y verificada contra `https://jg-turbo.vercel.app`. Recordar esta regla en cada sesión.

1. Editar en `Spech to text App/`
2. **Documentar todo** en el MD del feature (TTS → `CAMBIOS_TTS.md`: versión, dpl_, cambios, pruebas, proceso)
3. Alinear satélites si aplica (`DOCUMENTACION_DESPLIEGUE.md`, `FICHA_TECNICA.md`, `CONFIG_PERSISTENTE.md`, este `Agents.md`)
4. Sync a `../vercel_deploy/` (`index.html`, `api/*`, docs tocados, `vercel.json`)
5. Desplegar **solo** `vercel_deploy` al proyecto **`jg-turbo`** (**nunca** la raíz del monorepo):
   ```bash
   npx vercel --prod --yes --cwd ../vercel_deploy
   # o: cd ../vercel_deploy && npx vercel link --project jg-turbo --yes && rm -f .env.local && npx vercel --prod --yes
   ```
   ⚠️ Sin el `link` a `jg-turbo`, el deploy puede ir al proyecto `vercel_deploy` y **producción no cambia**.  
   ⚠️ Desde la raíz del monorepo → ~1000 archivos y **404** en jg-turbo.vercel.app.
6. Verificar prod **contra el dominio real**, no contra la URL que imprime el CLI:
   marcador en el HTML + `/api/health` (ver checklist en `CAMBIOS_YOUTUBE.md` §6).
7. Anotar `dpl_…` en la documentación

Detalle TTS completo: **`CAMBIOS_TTS.md`**. Persistencia: `CONFIG_PERSISTENTE.md`. Deploy: `DOCUMENTACION_DESPLIEGUE.md`.


## Stack

- Frontend: `index.html` (SPA)
- API Vercel: `api/index.py` (Groq + Gemini/OpenRouter + MyMemory)
- Backend local: `backend/app.py` (faster-whisper)

## YouTube (leer antes de "arreglar" la extracción)

**Estado desde 2026-08-01: la extracción es automática otra vez.** Documento
maestro: **`CAMBIOS_YOUTUBE.md`** (diagnóstico medido, alternativas con fuente,
arquitectura, validación y guía de activación).

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
- SW de esta entrega: **`jg-turbo-shell-v12`**. PWA instalable en escritorio (Chrome/Edge) y móvil: ver `INSTALAR_ESCRITORIO.md`.

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

**Siempre** ejecutar el deploy desde `vercel_deploy/`:

```bash
cd vercel_deploy
npx vercel --prod --yes
```

Nunca desde la raíz del workspace. Tras el fix: ~17 archivos, alias https://jg-turbo.vercel.app OK con TTS.

## TTS (lectura en voz alta)

**Motor v2.8.0 — lectura continua con controles de reproducción** (2026-08-14):
dos `<audio>` que se turnan (sin huecos entre bloques), colchón de 120 s generado
por delante, bloques escalonados `190→340→560→900`, velocidad aplicada en el
navegador (`playbackRate`, cambio instantáneo sin reiniciar), barra con ⏪/⏩ 10 s
y posición arrastrable, caché de audio, `GET /tts` cacheable, `GET /tts-warmup` y
voces propias para **es · en · pt · fr · de · it** con detección del idioma real
del texto. Detalle y medidas: `CAMBIOS_TTS.md` §v2.8.0.

**Motor v2.7.0 — «Misma voz» multilingüe** (2026-08-09). Por defecto una sola voz
lee todo el texto: español fluido y términos en inglés en inglés **sin cambiar de
voz ni de ritmo**. UI de consola: **franja horizontal** (2026-08-01).

| Rol | Voz (modo «Misma voz», por defecto) | Respaldo |
|---|---|---|
| Mujer | `en-US-AvaMultilingualNeural` | `en-US-EmmaMultilingualNeural` |
| Hombre | `en-US-AndrewMultilingualNeural` | `en-US-BrianMultilingualNeural` |

Modo legado «Dos voces» (opción `auto`), con acentos manuales CO/MX/AR/es-US:

| Rol | Voz |
|---|---|
| Mujer ES (auto) | `es-MX-DaliaNeural` |
| Hombre ES (auto / zona CO) | `es-CO-GonzaloNeural` (+ prosodia calmada) |
| Mujer EN | `en-US-AriaNeural` |
| Hombre EN | `en-US-AndrewNeural` |

Config `jg_tts_bilingual`: `unified` (defecto) | `auto` | `off`. El valor antiguo
`auto` migra a `unified` al leerlo. API `POST /tts` acepta `unified: true`
(sin force-EN; headers `X-TTS-Language: multi`, `X-TTS-Engine: edge-neural-unified`).

- Historial + arquitectura + deploys + pruebas: **`CAMBIOS_TTS.md`** (maestro)
- Prod actual: UX **v3.6** (`CAMBIOS_UX.md`) · TTS motor **v2.8.0** · https://jg-turbo.vercel.app
- UX reciente: v3.6 FAB Grabar/Detener móvil · v3.5 opciones/sensibilidad · v3.4 mic largos por partes
- **Micrófono largo:** WAV de 4+ min se parte en ~90 s (límite body Vercel ~4,5 MB). Ver `PRECISION_AUDIO.md`.
- **Documentar siempre** cada entrega en el MD del feature (versión, deploy, pruebas) y sincronizar a `vercel_deploy/`.
- **Nunca** `npx vercel --prod` desde la raíz del monorepo (causa 404).
