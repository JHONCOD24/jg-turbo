# JG Turbo — reglas para agentes

## ⚠️ Antes de tocar el código: `TRAMPAS.md`

**`TRAMPAS.md`** recoge los errores que ya se cometieron en este proyecto, con la causa medida y la
regla para no repetirlos. Varios se cometieron **dos veces** por no estar escritos. Léelo entero la
primera vez; después, al menos la sección que toque tu tarea:

| Vas a tocar… | Lee al menos |
|---|---|
| Alturas, scroll, responsive | §3 (la cadena de scroll) y §4 (el estilo computado manda) |
| `nube.js`, `sincronizacion.js`, `biblioteca.js` | §5 (cinco formas de perder datos) |
| Texto, pulido, voz | §6 (el guardián que solo mira una dimensión) |
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


## Despliegue (obligatorio al cerrar mejoras)

**Siempre desplegar en Vercel** cuando se termine una mejora o feature de esta app. No dejar solo cambios locales.

**Regla persistente para futuros agentes:** una mejora no se considera cerrada hasta que esté documentada en el MD del feature, desplegada al proyecto `jg-turbo` y verificada contra `https://jg-turbo.vercel.app`. Recordar esta regla en cada sesión.

> Reestructuración 2026-09-03: la app vive en la raíz del repo (`jg-turbo/`).
> Ya NO existe `Spech to text App/` ni `vercel_deploy/` como carpetas de
> trabajo/despliegue. `sincronizar_deploy.mjs` (raíz) es un resto del flujo
> antiguo y apunta a carpetas que ya no existen: **no usarlo**. El despliegue
> sale de la raíz.

1. Editar en la raíz del repo (`jg-turbo/`: `index.html`, `js/`, `api/`, `sw.js`)
2. **Documentar todo** en el MD del feature (TTS → `CAMBIOS_TTS.md`: versión, dpl_, cambios, pruebas, proceso)
3. Alinear satélites si aplica (`DOCUMENTACION_DESPLIEGUE.md`, `FICHA_TECNICA.md`, `CONFIG_PERSISTENTE.md`, este `Agents.md`)
4. Desplegar desde la raíz al proyecto **`jg-turbo`**:
   ```bash
   cd "C:\Users\juanl\Documents\Proyectos\jg-turbo"
   npx vercel --prod --yes --scope jhoncod24s-projects
   ```
   ⚠️ **No usar `--cwd`**: con Vercel CLI 59.x devuelve `Not authorized` aunque la sesión sea válida
   (comprobado 2026-08-15). Entrar en la carpeta y pasar `--scope`.
   ⚠️ Sin el `link` a `jg-turbo`, el deploy puede ir al proyecto `vercel_deploy` y **producción no cambia**.  
   ⚠️ Desde la raíz del monorepo → ~1000 archivos y **404** en jg-turbo.vercel.app.
6. Verificar prod **contra el dominio real**, no contra la URL que imprime el CLI:
   marcador en el HTML + `/api/health` (ver checklist en `CAMBIOS_YOUTUBE.md` §6).
7. Anotar `dpl_…` en la documentación

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
```

Referencia al 2026-09-03: **451 comprobaciones, 0 fallos**.

**Con navegador** (Playwright; se busca en el repo, en `../node_modules` y en `JG Turbo_OLD/`):

| Comando | Qué cubre | Referencia |
|---|---|---|
| `node tests/verificar_pdf_geometria.mjs` | Desbordes, toques ≥44px y solapes en móvil/tablet/escritorio | 42, sin avisos |
| `node tests/verificar_pdf_scroll.mjs` | Que la biblioteca **se pueda desplazar** con nueve libros, y que las otras pestañas y el lector conserven su modelo de scroll | 39 |
| `node tests/verificar_pdf_navegador.mjs` | Recorrido funcional completo del lector | 103 |

**Backend:** `python -m pytest backend/tests -q`.
⚠️ Falla al recolectar 5 módulos por importar `api.subtitulos_limpieza` y `api.pulido`, que no
existen. Es anterior a septiembre de 2026 (comprobado con `git stash`). Si tocas backend, corre los
archivos concretos que te afecten.

**Cuando toques CSS de alturas o scroll**, `verificar_pdf_scroll.mjs` es obligatoria: es la única
que trabaja con volumen suficiente para que el scroll exista. Las otras dos dieron 42/42 y 103/103
con el scroll completamente roto.

## Stack

- Frontend: `index.html` (SPA)
- API Vercel: `api/index.py` (Groq + Gemini/OpenRouter + MyMemory)
- Backend local: `backend/app.py` (faster-whisper)

## YouTube (leer antes de "arreglar" la extracción)

**Estado desde 2026-08-01: la extracción es automática otra vez.** Documento
maestro: **`CAMBIOS_YOUTUBE.md`** (diagnóstico medido, alternativas con fuente,
arquitectura, validación y guía de activación).

## PDF (leer antes de tocar `js/pdf/`)

Documento maestro: **`CAMBIOS_PDF.md`** (v1.0, 2026-08-31).

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

SW vigente: **`jg-turbo-shell-v76`** (continuidad de palabras y TTS entre partes, PDF v2.37.1). PWA instalable en escritorio (Chrome/Edge) y móvil: ver `INSTALAR_ESCRITORIO.md`.

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
