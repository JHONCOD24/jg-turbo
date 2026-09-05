---
meta:
  title: Cómo desplegar JG Turbo en Vercel
  navLabel: Despliegue en Vercel
  contentType: How-to
  category: Operación
  audience: Mantenimiento y desarrollo
  goal: Sincronizar, validar y desplegar la aplicación sin perder configuración
lastUpdated: 2026-08-02
---

# Cómo desplegar JG Turbo en Vercel

## Publicación PDF v2.40.0, 2026-09-05

Producción autorizada por el usuario y publicada como
`dpl_3EpViMULsw7FFzi6mZoPiqsNsRid` (READY), alias `jg-turbo.vercel.app`.
Se usó una copia temporal de los archivos productivos del repo actual para
evitar el directorio `.pytest_cache` con acceso denegado. Se verificaron el
proyecto vinculado, los hashes de los 27 módulos PDF, HTML y SW en el dominio,
HTTP 200 en salud y dos recorridos de navegador contra producción.
Detalle: [verificación PDF v2.40](docs/pdf-v2.40-verificacion.md).

**Cierre en Git (2026-09-05).** El despliegue salió por CLI y dejó el repositorio atrás:
`origin/main` estaba en v2.38.0 (`30e83c9`) con producción sirviendo v2.40.0, y a GitHub le
faltaba `js/pdf/huella.js`, que tres módulos importan. Se avanzó `main` al commit `c31a967`
(fast-forward desde `fix/pdf-paginacion-y-correccion`) y se empujó: `30e83c9..c31a967`.
GitHub no está conectado a Vercel (el proyecto no tiene integración Git), así que el push
no generó ningún despliegue nuevo: `dpl_3EpViMULsw7FFzi6mZoPiqsNsRid` sigue siendo
el de producción. Queda anotado en `TRAMPAS.md` para que el push forme parte del cierre.

Esta guía explica la arquitectura productiva, los archivos obligatorios y el procedimiento de despliegue. Los cambios de audio se publicaron y validaron en producción el 23 de julio de 2026.


## Política de despliegue (vigente desde la reestructuración del 2026-09-03)

La app vive en la **raíz del repo** (`jg-turbo/`: `index.html`, `js/`, `api/`,
`sw.js`). Ya **no** existe `vercel_deploy/` ni `Spech to text App/` como carpetas
de trabajo: `sincronizar_deploy.mjs` es un resto del flujo antiguo y apunta a
carpetas que ya no existen (**no usarlo**).

**Siempre desplegar en Vercel** al cerrar una mejora de la aplicación. No entregar solo el cambio local. Desplegar **desde la raíz del repo** al proyecto **`jg-turbo`**.

```bash
# Comando vigente (Vercel CLI 59.x):
cd "C:\Users\juanl\Documents\Proyectos\jg-turbo"
npx vercel --prod --yes --scope jhoncod24s-projects
```

⚠️ **No usar `--cwd`.** Con Vercel CLI 59.x, `npx vercel --prod --yes --cwd <carpeta>`
responde `{"status":"error","reason":"deploy_failed","message":"Not authorized"}` aunque
la sesión sea válida (comprobado 2026-08-15). Hay que **entrar en la carpeta** y pasar `--scope`.
Si el vínculo se rompiera: `npx vercel link --project jg-turbo --yes && rm -f .env.local`.

⚠️ Sin el `link` a `jg-turbo`, el deploy puede ir al proyecto `vercel_deploy` y
**producción no cambia**. Sin el enlace correcto el alias https://jg-turbo.vercel.app
sigue sirviendo la versión anterior.

**Nunca** desde la raíz del workspace (`Proyectos/`) ni desde `JG Turbo_OLD/`
(respaldo de agosto, con enlaces desactivados): sube ~1000 archivos y deja
**404** en https://jg-turbo.vercel.app, o sobrescribe producción con la versión vieja.

### Estado real del repositorio

Antes de desplegar conviene saber esto, porque no es evidente:

- **Git puede ir por detrás de producción.** Varias mejoras (UX, audio, YouTube,
  TTS UI) se publicaron vía CLI desde `vercel_deploy/` sin commit intermedio.
  Comparar marcadores del HTML servido vs local antes de lanzar.
- **Últimas entregas UX (2026-08-01)** en prod `jg-turbo`:
  - v3.1 «Más acciones» móvil → deploy `H3wGeFciRqyyYRMnPwgE974X55yy`
  - v3.2 franja TTS horizontal → deploy `CD7GVazANst7gZCovnGZRrYAq1A3`
  - Detalle: `CAMBIOS_UX.md` · TTS UI: `CAMBIOS_TTS.md` §0
- **Documentar siempre** el cambio en el MD del feature **antes o al cerrar** el
  deploy (pedido, solución, pruebas, ID de deployment).
- La integración MCP de Vercel puede no alcanzar este proyecto; usar la CLI.

### Proyectos y alias (histórico + vigente)

Histórico (julio-agosto 2026, flujo con `vercel_deploy/`): `cd vercel_deploy` →
`npx vercel --prod --yes` **publicaba en un proyecto distinto al de producción**.
Comprobado el 31 de julio de 2026: ese comando creó
`dpl_B1e8dWsiaDUgU8sXRzkMEk1FT6v2` en el proyecto **`vercel_deploy`**, y
https://jg-turbo.vercel.app siguió sirviendo la versión anterior.

| Proyecto Vercel | Dominio |
|---|---|
| `jg-turbo` (`prj_EfuyBt2YDNqQNVaKif9DKUjpVaz8`) | **https://jg-turbo.vercel.app** ← producción real |
| `vercel_deploy` (`prj_1lNARR6bNqHH67YDPYQbtVeS6E90`) | `verceldeploy-*.vercel.app` (además responde 302 por Deployment Protection) |

**Procedimiento vigente:** desplegar **la raíz del repo** desde una carpeta
vinculada al proyecto `jg-turbo` (nunca con `--cwd`).

```bash
cd "C:\Users\juanl\Documents\Proyectos\jg-turbo"
npx vercel link --project jg-turbo --yes   # solo si el vínculo se rompió
rm -f .env.local                           # el link genera un token OIDC: no subirlo
npx vercel --prod --yes --scope jhoncod24s-projects
```

Comprueba que el CLI diga **«Downloading N deployment files»** con N bajo
(decenas, no miles). Si ves ~1000 archivos, **estás en la carpeta equivocada**.

Después, **verificar siempre contra el dominio real**, no contra la URL que
imprime el CLI:

```bash
# PowerShell
(Invoke-WebRequest https://jg-turbo.vercel.app -UseBasicParsing).Content.Contains('btnYtPasteClip')
(Invoke-WebRequest https://jg-turbo.vercel.app/api/health -UseBasicParsing).Content
```

Pendiente recomendado: commitear el árbol de trabajo para que git deje de estar
desfasado respecto a lo que ya está publicado, y decidir si `vercel_deploy/` se
revincula de forma permanente a `jg-turbo` o se conserva como entorno aparte.

Feature TTS **v2.6.3** (Gonzalo CO + Andrew EN, force-EN, prep pronunciación paritaria mujer/hombre, 2026-07-23/24): documentada de forma completa en `CAMBIOS_TTS.md`. Requiere sincronizar al menos `index.html`, `api/index.py` y `api/requirements.txt` (y docs: `CAMBIOS_TTS.md`, `FICHA_TECNICA.md`, `Agents.md`, `CONFIG_PERSISTENTE.md`).

## Arquitectura productiva

Vercel no ejecuta `faster-whisper` dentro de la función. Ese motor y sus modelos superan los recursos adecuados para este despliegue.

La versión productiva usa:

- `index.html` como interfaz
- `api/index.py` como API de FastAPI
- Groq con `whisper-large-v3` para transcripción
- `api/calidad_linguistica.py` para revisar segmentos y traducciones
- MyMemory como respaldo de traducción
- `vercel.json` para enrutar `/api/*`

El backend local permanece en `backend/`. Puedes usarlo con `faster-whisper` y FFmpeg sin afectar Vercel.

## Archivos obligatorios (repo aplanado, vigente)

El despliegue sale de la **raíz del repo** (`jg-turbo/`). Estos archivos viajan
siempre (ya no hay copias en `vercel_deploy/` ni en `Spech to text App/`:
ambas rutas son del flujo antiguo y no existen):

| Archivo en el repo | Papel |
|---|---|
| `index.html` | Interfaz (SPA) |
| `api/index.py` | API FastAPI (Vercel) |
| `api/calidad_linguistica.py` | Revisión de segmentos y traducciones |
| `api/youtube_subs.py` | Subtítulos de YouTube |
| `api/supadata.py` | Transcripción automática de YouTube |
| `api/requirements.txt` | Dependencias de la función |
| `sw.js` | Service worker (shell PWA) |
| `vercel.json` | Enrutado `/api/*` |
| `js/pdf/` | Lector PDF (incluye `huella.js`, `libroVista.js`) |

No se suben el corpus privado, el entorno virtual ni archivos `.env`.

## Dependencias de producción

`api/requirements.txt` contiene (actualizado 2026-07-29 vía Context7 + PyPI):

```text
fastapi>=0.141.0,<1.0
python-multipart>=0.0.32,<1.0
pydantic>=2.13.0,<3.0
httpx>=0.28.1,<1.0
yt-dlp>=2026.7.4
youtube-transcript-api>=1.2.0,<2.0
edge-tts>=7.2.0,<8.0
```

Pisos verificados: FastAPI 0.141.1, pydantic 2.13.4, yt-dlp 2026.7.4, youtube-transcript-api 1.2.4 (API de instancia `fetch`/`list`), edge-tts 7.2.8. La función no instala PyTorch, `faster-whisper` ni FFmpeg.

## Configuración de claves

La transcripción busca una clave de Groq en este orden:

1. Clave enviada desde el navegador
2. Variable `GROQ_API_KEY` de Vercel

El navegador guarda las preferencias en `localStorage`. Un despliegue en el mismo dominio no borra esas preferencias.

No incrustes claves en `index.html`, `api/index.py`, Git o esta documentación. Consulta [Cómo conservar la configuración](CONFIG_PERSISTENTE.md) antes de modificar claves `jg_*`.

Variables admitidas en Vercel:

| Variable | Uso | Valor predeterminado |
|---|---|---|
| `SUPADATA_API_KEY` | **Transcripción automática de YouTube.** Sin ella la app funciona, pero YouTube vuelve a exigir pegado manual | Sin valor |
| `SUPADATA_BASE_URL` | Solo si Supadata cambia de dominio | `https://api.supadata.ai/v1` |
| `SUPADATA_TIMEOUT_S` | Tiempo máximo por petición a Supadata | `30` |
| `SUPADATA_ESPERA_SERVIDOR_S` | Cuánto espera la función un video largo antes de delegar en el navegador | `22` |
| `GROQ_API_KEY` | Clave de transcripción compartida (**obligatoria** para mic/archivo en todos los dispositivos) | Sin valor |
| `GROQ_ASR_MODEL` | Modelo de transcripción | `whisper-large-v3` |
| `GROQ_TIMEOUT_S` | Tiempo máximo de Groq | Definido en la API |
| `GEMINI_API_KEY` | Traducción o mejora manual | Sin valor |
| `OPENROUTER_API_KEY` | Proveedor alternativo | Sin valor |
| `MISTRAL_API_KEY` | IA de pulido en servidor (configurada en prod) | Con valor en Production |
| `XAI_API_KEY` / `GROK_API_KEY` | Grok xAI para pulir texto (no es transcripción) | Sin valor |

## Sincronizar la copia de despliegue

Ejecuta desde la raíz `JG Turbo`:

```powershell
Copy-Item 'Spech to text App\index.html' 'vercel_deploy\index.html' -Force
Copy-Item 'Spech to text App\api\index.py' 'vercel_deploy\api\index.py' -Force
Copy-Item 'Spech to text App\api\calidad_linguistica.py' 'vercel_deploy\api\calidad_linguistica.py' -Force
Copy-Item 'Spech to text App\api\youtube_subs.py' 'vercel_deploy\api\youtube_subs.py' -Force
Copy-Item 'Spech to text App\api\supadata.py' 'vercel_deploy\api\supadata.py' -Force
Copy-Item 'Spech to text App\api\requirements.txt' 'vercel_deploy\api\requirements.txt' -Force
Copy-Item 'Spech to text App\vercel.json' 'vercel_deploy\vercel.json' -Force
```

> **Variables de entorno nuevas:** Vercel solo se las entrega a la función en el
> **siguiente** despliegue. Si añades `SUPADATA_API_KEY` en el panel, hay que
> volver a desplegar para que surta efecto. Verifícalo con
> `GET /api/health` → `youtube_auto: true`.

Compara los archivos antes de continuar:

```powershell
Get-FileHash 'Spech to text App\index.html','vercel_deploy\index.html'
Get-FileHash 'Spech to text App\api\index.py','vercel_deploy\api\index.py'
Get-FileHash 'Spech to text App\api\calidad_linguistica.py','vercel_deploy\api\calidad_linguistica.py'
```

Cada par debe mostrar el mismo hash.

## Validar antes del despliegue

Ejecuta las pruebas desde `Spech to text App/`:

```powershell
python -m pytest backend\tests -q
python -m py_compile api\index.py api\calidad_linguistica.py backend\app.py backend\calidad_linguistica.py backend\benchmark_audio.py
git diff --check
```

Revisa también:

- La configuración abre, permite hacer clic en **Guardar** y no borra claves
- El micrófono muestra los ajustes aceptados
- La transcripción conserva una vista previa si falla la API
- La traducción muestra `ok`, `warning` o `alert`
- La vista móvil no superpone editor, controles TTS y botones
- GET /api/tts-voices publica los cuatro acentos latinos y las voces inglesas
- POST /api/tts responde udio/mpeg para español e inglés
- El diff no contiene claves, audios o datos personales

## Desplegar

El despliegue modifica producción. Ejecútalo solo con autorización:

```powershell
Set-Location '..\vercel_deploy'
npx vercel --prod --yes
```

La URL productiva es [JG Turbo](https://jg-turbo.vercel.app).

## Verificar después del despliegue

Completa esta secuencia:

1. Abre la URL productiva en una ventana privada
2. Confirma que `/api/ping` responde `{"status":"ok"}`
3. Abre Configuración y comprueba que las preferencias existentes siguen disponibles
4. Graba una frase corta en inglés
5. Confirma que aparece la transcripción editable
6. Escucha un texto mixto y confirma que los fragmentos ingleses usan una voz inglesa
7. Cambia entre Colombia, México, Argentina y español latino de Estados Unidos
8. Traduce de inglés a español y revisa el estado de integridad
9. Repite con una frase en español
10. Revisa los registros de la función si aparece un error

## Recuperar la versión anterior

Vercel conserva despliegues anteriores. Si la validación productiva falla, restaura el último despliegue estable desde el panel de Vercel.

No borres `localStorage` para recuperar una versión. El código debe adaptarse a la configuración existente.

## Registro de esta actualización

Esta documentación reemplaza referencias antiguas a `whisper-large-v3-turbo`. También incorpora el módulo lingüístico requerido por la API y el TTS neural bilingüe **v2.6.3**.

### UX móvil y opciones de dictado v3.5 (2026-08-02) — actual

- **Dominio**: [JG Turbo](https://jg-turbo.vercel.app)
- **Proyecto**: `jg-turbo` (`prj_EfuyBt2YDNqQNVaKif9DKUjpVaz8`)
- **Deployment**: `dpl_3ox2F8Pgk5m1JS21MGGQBHxBM4ij` · **READY** · production
- **Pedido**: conservar el botón de grabar a mano en móviles con textos largos, aclarar las opciones de dictado, corregir el desborde de sensibilidad y revisar Archivo, idiomas y YouTube sin alterar el diseño de escritorio.
- **Archivos modificados**: `index.html`, `CAMBIOS_UX.md`, `DOCUMENTACION_DESPLIEGUE.md`, `FICHA_TECNICA.md`.
- **Archivos de backend sin cambios**: `api/index.py`, `api/supadata.py`, `api/calidad_linguistica.py`, `backend/app.py` y `backend/calidad_linguistica.py`.
- **Cambios funcionales**:
  - La vista previa en vivo del micrófono tiene altura máxima y scroll interno en móvil.
  - El botón `#recBtn` pasa a ser flotante solo durante la grabación móvil.
  - La animación del panel se desactiva durante la grabación para que `position: fixed` use el viewport real.
  - La fila `#sensSlider` se reorganiza en móvil y ya no sale de la tarjeta.
  - Las seis opciones de `data-opt` se presentan en dos columnas con etiquetas cortas y tooltips completos.
  - El modo código automático sincroniza también `aria-checked` y el resumen de opciones.
  - `#btnCheatInline` abre el modal de comandos de voz en móvil.
- **Calidad preservada**: audio acondicionado, segmentos de aproximadamente 100 segundos, reintentos por parte, `whisper-large-v3`, glosario y corrección contextual opcional.
- **Pruebas**:
  - JavaScript embebido de `index.html`: sintaxis válida con `new Function`.
  - Playwright móvil 360×732: sin overflow horizontal, slider dentro de la tarjeta, rejilla de opciones, interruptor y modal de comandos correctos.
  - Playwright escritorio 1280×900: botón en posición normal y sin estilos móviles.
  - `test_segmentacion_upload.py`: 5 passed.
  - `test_calidad_linguistica.py`: 4 passed.
  - `test_supadata_youtube.py`: 25 passed.
  - `test_transcribe.py`: timeout del entorno local al cargar el stack; pendiente de una ejecución en un entorno de transcripción estable.
- **Sincronización**: `Spech to text App/index.html` y documentación copiadas a `vercel_deploy/`. Los hashes de `index.html` y `CAMBIOS_UX.md` coinciden entre ambas carpetas.
- **Verificación productiva**: alias `https://jg-turbo.vercel.app` responde con la nueva interfaz; `/api/health` devuelve `status: ok`, `model_ready: true`, `groq_configured: true` y `youtube_auto: true`.

### Traducción de textos largos (2026-08-01) — actual

- **Dominio**: [JG Turbo](https://jg-turbo.vercel.app)
- **Qué se publicó** (detalle completo en `CAMBIOS_TRADUCCION.md`):
  - **Traducir textos de cualquier tamaño.** El navegador trocea en bloques de
    6 000 caracteres y hace varias peticiones cortas (2 en paralelo), con progreso
    «Traduciendo… N de M» y reintento automático.
  - `TranslateRequest.prefer_fast` pasa a `Optional[bool]`: un `false` explícito
    ahora significa **calidad (IA primero)**; antes se ignoraba pasando de 1200
    caracteres y toda transcripción larga salía por MyMemory.
  - **Validador de cifras sin falsas alarmas**: dejaba traducciones correctas
    marcadas como «Integridad 6/100» con un popup de confirmación.
  - Service Worker **`jg-turbo-shell-v10`** (antes v9).
- **Archivos**: `index.html`, `sw.js`, `api/index.py`, `api/calidad_linguistica.py`
  (y su copia `backend/calidad_linguistica.py`).
- **El fallo que se corrigió**: 39 732 caracteres → `HTTP 504
  FUNCTION_INVOCATION_TIMEOUT` a los 60,4 s, con cero texto. Vercel corta la
  función a los 60 s y el tiempo crecía con el texto.
- **Verificado en producción**: los 7 bloques del mismo texto → **200 OK**,
  ninguno por encima de 25 s, **7 227 de 7 277 palabras (99,3 %)**, sin bloques
  vacíos ni mezcla de idiomas.

### YouTube automático con Supadata (2026-08-01) — anterior

- **Dominio**: [JG Turbo](https://jg-turbo.vercel.app)
- **Deployment**: `dpl_3aJ8j4FVq5AcCgNPDgF2MyK3Dvjo` · `jg-turbo-iytq9t8lh-…` · **READY** · production
- **Deployment previo del mismo día**: `dpl_34yXmSrubcBY7zeSBadFzSnNLxrh` · `jg-turbo-pf0ek3413-…`
- **Proyecto**: `jg-turbo` (`prj_EfuyBt2YDNqQNVaKif9DKUjpVaz8`)
- **Qué se publicó** (detalle en `CAMBIOS_YOUTUBE.md`):
  - **La transcripción de YouTube vuelve a ser automática.** Vía principal: **Supadata**
    (`api/supadata.py`, nuevo). Cadena: gratis → Supadata → yt-dlp + Whisper → pegado manual.
  - **Endpoint nuevo `GET /api/youtube-job`** para videos de más de 20 minutos
    (`POST /api/youtube` puede responder **`202`** con `job_id`).
  - `GET /api/health` añade **`youtube_auto`** (booleano; nunca la clave).
  - `POST /api/youtube` responde **`402`** cuando la cuenta de Supadata se queda sin créditos.
  - El pegado manual pasa a **red de seguridad** (plegado, sin el rótulo «siempre funciona»).
  - Service Worker **`jg-turbo-shell-v9`** (antes v8).
- **Archivo nuevo a sincronizar**: `api/supadata.py` (y `api/youtube_subs.py`, que faltaba en la tabla).
- **Variable nueva**: `SUPADATA_API_KEY`. **Sin ella la app no se rompe**: se comporta
  como antes y `/api/health` responde `youtube_auto: false`.
- **Validado antes de desplegar**: pytest **46 passed, 2 skipped, 0 failed** ·
  `py_compile` OK · `node --check` del JS embebido OK · 11 pares de archivos con hash idéntico ·
  búsqueda de secretos (`sd_`, `sk-`, `gsk_`, `AIza`) sin coincidencias.
- **Verificado en prod** (dominio real, no la URL del CLI): HTTP 200 · 482 105 bytes ·
  marcadores `jgEsperarTrabajoYoutube`, `youtube-job?id=`, `ytPasteInput` presentes ·
  «Pegar transcripción de YouTube (siempre funciona)» **ausente** · `sw.js` → `jg-turbo-shell-v9` ·
  `/api/health` ok · **sin regresiones** en `/api/translate` (integridad 100),
  `/api/tts-voices` (v2.6.3) y `/api/session-config`.
- **Pendiente**: ejecutar las 4 pruebas de video (§ 8.4 de `CAMBIOS_YOUTUBE.md`); requiere
  `SUPADATA_API_KEY` en Vercel **y un nuevo despliegue** para que la función la reciba.

### Corrección del flujo de traducción (2026-08-01)

- **Pedido**: la traducción mostraba error o mezclaba el original con el resultado, especialmente al usar el backend local o textos largos.
- **Solución**: MyMemory ahora trabaja con política todo-o-nada; se limpian marcas de tiempo, se trocean textos largos, se eliminan preámbulos de IA y se rechazan respuestas vacías. La interfaz borra alertas obsoletas al editar, cambiar idiomas o limpiar.
- **Pruebas previas**: `python -m pytest backend\tests -q` → **57 passed, 2 skipped**; `py_compile` OK; `node --check` OK; prueba de navegador de limpieza de alerta OK.
- **Archivos**: `index.html`, `api/index.py`, `backend/app.py`, `backend/tests/test_translate_completo.py`, `backend/tests/test_translate_local.py`.
- **Deploy**: `dpl_7x7c2yKjhyzFV98wF3s83huPoZ8B` · **READY** · alias `https://jg-turbo.vercel.app`.

### Bookmarklet eliminado + docs (2026-07-31) — anterior

- **Dominio**: [JG Turbo](https://jg-turbo.vercel.app)
- **Deployment**: `dpl_7rJqUX9CTxVgbLgb8bZiGS5wTVCg` · inspect `7rJqUX9CTxVgbLgb8bZiGS5wTVCg` · `jg-turbo-b0f347cc2-…` · **READY** · production
- **Proyecto**: `jg-turbo` (`prj_EfuyBt2YDNqQNVaKif9DKUjpVaz8`) · **44** archivos (no ~1000)
- **Qué se publicó** (detalle en `CAMBIOS_YOUTUBE.md`):
  - **Eliminado por completo el bookmarklet** «Arrastrar a favoritos» (HTML + CSS + JS): confundía al usuario y era redundante con «Pegar del portapapeles».
  - Vía única y clara: copiar en YouTube → **Pegar del portapapeles** → traducir / escuchar / descargar.
  - Service Worker **`jg-turbo-shell-v8`** (antes v7): refresca el shell PWA.
- **Verificado en prod** (dominio real, no la URL temporal del CLI):
  - `btnYtPasteClip` presente · `ytBookmarklet` / `yt-manual-advanced` / «Arrastrar a favoritos» **ausentes**
  - `index.html` = 476 890 bytes · `sw.js` → `jg-turbo-shell-v8` · `GET /api/health` → `status: ok`, Groq listo
- **Continuidad**: parte del trabajo previo (portapapeles + fix scroll, ya en prod); esta entrega solo retira el bookmarklet.

### YouTube UX pegar + scroll (2026-07-31) — anterior

- **Dominio**: [JG Turbo](https://jg-turbo.vercel.app)
- **Inspect / build (actual)**: `HpXBnyKNvCKHbS2NYtWvNSD8aRpP` · `jg-turbo-f00desh03-…` · Ready  
- **Inspect / build (código UX)**: `SDxcNRfUS6tTEZDspBv3Ap8Lciwq` · `jg-turbo-o2inaftkp-…` · Ready  

- **Qué se publicó** (detalle en `CAMBIOS_YOUTUBE.md`):
  - Flujo **Pegar del portapapeles** (sin JavaScript confuso a la vista)
  - Guía al **Abrir en YouTube**; bookmarklet solo como atajo opcional
  - Fix scroll: `overflow-y: auto` + ocultar bloque pegar con resultados
  - SW **`jg-turbo-shell-v7`**
- **Marcadores en prod**: `btnYtPasteClip`, `ytGuide`, `jgAplicarTextoPegadoYt`, `yt-manual-advanced`
- **Tamaño HTML alineado**: local = deploy = prod = **480 421** bytes
- **API**: `/api/health` → ok · Groq listo
- **TTS producto**: sigue **v2.6.3** (no tocado)
- **Lección deploy**: un deploy desde la raíz del monorepo dejó 404; se recuperó con `--cwd vercel_deploy` al proyecto `jg-turbo`

### Precisión de audio (referencia anterior)

- **Despliegue productivo**: `dpl_4Tn6LGpk5aweHLocSFiVaGGcPqbf`
- **Estado**: `Ready`
- **Dominio**: [JG Turbo](https://jg-turbo.vercel.app)
- **API validada**: `/api/ping`, `/api/health` y `/api/session-config` respondieron 200
- **Modelo publicado**: `whisper-large-v3`

### UX multi-panel + cierre de plataforma (2026-07-29) — actual

- **Despliegue productivo (actual)**: `dpl_Wv8aTd1YwcaMcEwJHimqushPmqBv` · Ready  
- **Dominio**: [JG Turbo](https://jg-turbo.vercel.app)
- **UX** (detalle en `CAMBIOS_UX.md`): pestañas con nombre en móvil, micrófono con resultado en panel, archivo/YouTube/traducir reordenados, accesibilidad de tabs, sin tocar claves `jg_*`
- **Plataforma en el mismo tramo**: deps Context7, `api/youtube_subs.py`, SW `jg-turbo-shell-v2` (HTML network-first)
- **API validada**: `/api/ping` y `/api/health` → ok · Groq listo · `youtube_transcript_api: true`
- **HTML en prod**: marcadores UX (`Resultado editable`, `Editar en grande`, `Traducir ahora`, `role="tab"`)
- **Tests locales (post-cierre)**: `node --check` OK · pytest **15 passed**
- **TTS producto**: sigue **v2.6.3**

### Dependencias actualizadas vía Context7 (2026-07-29)

- **Despliegue**: `dpl_6L8KQzEiWvXd41A1M75ZqJ8FEkem` · Ready (histórico del mismo día, previo al deploy UX)
- **Qué se actualizó** (Context7 + PyPI):
  - `fastapi` ≥0.141 · `pydantic` ≥2.13 · `python-multipart` ≥0.0.32
  - `yt-dlp` ≥2026.7.4 · `youtube-transcript-api` ≥1.2 (API instancia `fetch`/`list`)
  - `edge-tts` ≥7.2 · backend: `uvicorn` ≥0.52 · `anthropic` ≥0.120 · `av` 17.x (no 18 por WDAC)

### TTS neural bilingüe v2.6.3 (2026-07-23/24)

- **Despliegue productivo (histórico v2.6.3)**: `dpl_9bM9BvPz6dZVpDM17my4QYk19eZA` · Ready  
- **Dominio**: [JG Turbo](https://jg-turbo.vercel.app)
- **API validada**:
  - `GET /api/tts-voices` → `english_male: en-US-AndrewNeural`, `male_voice: es-CO-GonzaloNeural`, `english_female: en-US-AriaNeural`
  - Hombre + `language=es` + texto `OpenAI` → **force-EN** → `en-US-AndrewNeural` / lang=`en`
  - Hombre ES normal → `es-CO-GonzaloNeural`
  - Mujer EN → `en-US-AriaNeural`
  - HTML: `v2.6.3`, `ttsPrepararTextoIngles`, `ttsForzarIdiomaSiInglesPuro`
- **Cambios clave v2.6.3**:
  - Hombre EN: **AndrewNeural** (paridad con Aria; ya no Guy)
  - Prep de pronunciación idéntica mujer/hombre (OpenAI, API, Node.js…)
  - Force-EN en cliente y servidor
  - Catálogo EN antes de cognados “safe”; tech ya no se queda en voz ES
- **Detalle completo (pasos, arquitectura, historial, pruebas)**: `CAMBIOS_TTS.md`

### TTS v2.6.2 (histórico)

- **Código**: `dpl_BmLE7rqcKCLyayt3zxJUD45reE8X` · Ready  
- **Docs**: `dpl_5kZPhJSMokc7L3zX1AZQbruTSWC3` · Ready  
- Hombre EN de esa etapa: Guy; fix Node.js/listas; prosodia Gonzalo  
- **Detalle**: `CAMBIOS_TTS.md` § historial v2.6.2

### TTS v2.6 / 2.6.1 (histórico)

- **Vista previa**: `dpl_9Rd1G8LBeBhBgKoYxRfSwFgE8TbL` · Ready
- **Prod 2.6/2.6.1**: `dpl_5vrrDCyMidWCGAT6174BpS9jVevv` · Ready
- **Primera v2.6**: `dpl_76zEf4gKK2k7GKBXs86jHgHgexqp` · Ready
- **Voces de esa etapa**: Dalia MX, Gonzalo CO, Aria / Andrew Multilingual
- **Detalle**: `CAMBIOS_TTS.md`

Consulta [Cómo funciona la captura, transcripción y traducción mejoradas](PRECISION_AUDIO.md) para revisar todos los cambios, pruebas y límites.

## Causa del 404 (2026-07-23) y prevención

El 404 `NOT_FOUND` ocurre si el deploy se lanza desde la **raíz del monorepo** (`JG Turbo/`), donde **no** está el `index.html` productivo como raíz del proyecto Vercel. Vercel sube **miles** de archivos (p. ej. ~1856) y la producción queda sin frontend/API útiles.

Se reprodujo al desplegar la v2.6.2 por error desde la raíz; se corrigió re-desplegando desde `vercel_deploy/` (~19 archivos, build con Python/`edge-tts`). La v2.6.3 se desplegó correctamente desde `vercel_deploy/`.

**Siempre** ejecutar el deploy desde `vercel_deploy/`:

```bash
cd "G:\Mi unidad\PROYECTS\JG Turbo\vercel_deploy"
npx vercel --prod --yes
```

Nunca desde la raíz del workspace. Señal de deploy correcto: log con pocos archivos (decenas, no miles) e instalación de `api/requirements.txt`.

### Checklist post-deploy TTS (resumen)

1. `GET /api/tts-voices` → `english_male` = `en-US-AndrewNeural`  
2. `POST /api/tts` hombre + texto `OpenAI` + `language=es` → voice Andrew + language en  
3. HTML contiene `v2.6.3`  
4. En el navegador: Ctrl+F5 y probar mujer/hombre con texto mixto ES+EN  

Procedimiento detallado y tabla de deploys: **`CAMBIOS_TTS.md`** secciones 8–11.
