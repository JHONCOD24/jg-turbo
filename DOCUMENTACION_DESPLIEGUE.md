---
meta:
  title: Cómo desplegar JG Turbo en Vercel
  navLabel: Despliegue en Vercel
  contentType: How-to
  category: Operación
  audience: Mantenimiento y desarrollo
  goal: Sincronizar, validar y desplegar la aplicación sin perder configuración
lastUpdated: 2026-07-29
---

# Cómo desplegar JG Turbo en Vercel

Esta guía explica la arquitectura productiva, los archivos obligatorios y el procedimiento de despliegue. Los cambios de audio se publicaron y validaron en producción el 23 de julio de 2026.


## Política de despliegue

**Siempre desplegar en Vercel** al cerrar una mejora de la aplicación. No entregar solo el cambio local. Tras sincronizar `vercel_deploy/`, ejecutar `npx vercel --prod --yes`.

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

## Archivos obligatorios

La carpeta `vercel_deploy/` debe contener estas copias actualizadas:

| Origen | Destino |
|---|---|
| `Spech to text App/index.html` | `vercel_deploy/index.html` |
| `Spech to text App/api/index.py` | `vercel_deploy/api/index.py` |
| `Spech to text App/api/calidad_linguistica.py` | `vercel_deploy/api/calidad_linguistica.py` |
| `Spech to text App/api/requirements.txt` | `vercel_deploy/api/requirements.txt` |
| `Spech to text App/vercel.json` | `vercel_deploy/vercel.json` |

Copia también iconos o imágenes cuando cambien. No copies el corpus privado, el entorno virtual ni archivos `.env`.

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
Copy-Item 'Spech to text App\api\requirements.txt' 'vercel_deploy\api\requirements.txt' -Force
Copy-Item 'Spech to text App\vercel.json' 'vercel_deploy\vercel.json' -Force
```

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
