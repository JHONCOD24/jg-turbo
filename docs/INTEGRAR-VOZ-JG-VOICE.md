# Integrar una voz clonada de JG Voice en JG Turbo (lector de PDF)

Documento **canónico** para agentes. Si el usuario pide «pasa esta voz de JG Voice al PDF», «agrega el clon X al selector» o «saca esa voz de la biblioteca», sigue **este archivo**, no improvises un API entre las dos apps.

| Campo | Valor |
|---|---|
| **Vigente desde** | v2.77.0 (2026-09-10), retiro de voces en v2.79.0 |
| **JG Turbo** | `C:\Users\juanl\Documents\Proyectos\jg-turbo\` · https://jg-turbo.vercel.app |
| **JG Voice** | `C:\Users\juanl\Documents\Proyectos\Jg Voice\` · https://jg-voice.vercel.app |
| **Puente real** | La misma cuenta de **Fish Audio**. No hay HTTP de Voice → Turbo. |

Historial de esta tanda: `CAMBIOS_TTS.md` §v2.77.0 (Roberto + el PDF deja de apagar Fish), §v2.78.0 (Amy, Dora, Michael, Sandra), §v2.79.0 (sale Sandra).

---

## 1. Qué está pasando (una frase)

JG Voice **entrena** un modelo privado en Fish y guarda su id (`provider_voice_id`). JG Turbo **sintetiza** con `POST /v1/tts` y ese mismo id como `reference_id`. El lector de PDF usa el selector Fish de siempre: si eliges el clon, tiene que sonar el clon.

No se pega el MP3/OGG de muestra en `audio/`. Ese archivo es la fuente del clon, no la voz del lector.

---

## 2. Condiciones que tienen que cumplirse

1. El clon en JG Voice está en estado **`trained`** (no `processing`, no `failed`).
2. El `provider_voice_id` es un id de modelo Fish de 32 hex, **no** un id `zeroshot:…`. El zero-shot de JG Voice manda el audio fuente en cada TTS; JG Turbo **no** soporta eso.
3. Las dos apps usan **la misma cuenta Fish**:
   - JG Turbo servidor: `FISH_API_KEY` (`.env` local y Vercel).
   - JG Voice servidor: `FISH_AUDIO_API_KEY`.
   - Misma clave, mismos modelos privados. **Nunca** pongas la clave en `index.html` ni en Git.
4. El modelo se clonó con `visibility=private`. No lo hagas público. Turbo lo usa porque comparte la clave, no porque el modelo esté en el catálogo abierto de fish.audio.

Si falta (1) o (2), dilo y para. No inventes un id. No subas el wav a Turbo «para que suene».

---

## 3. Cómo sacar el id del clon (sin adivinar)

Orden de confianza:

### A. API de Fish (la que manda)

Desde PowerShell, **sin imprimir la clave**:

```powershell
$envFile = Get-Content "C:\Users\juanl\Documents\Proyectos\Jg Voice\web\.env.local"
$key = ($envFile | Where-Object { $_ -match '^FISH_AUDIO_API_KEY=' }) -replace '^FISH_AUDIO_API_KEY=',''
$key = $key.Trim().Trim('"')
$r = Invoke-RestMethod -Uri "https://api.fish.audio/model?self=true&page_size=50" -Headers @{ Authorization = "Bearer $key" }
foreach ($m in @($r.items)) {
  $id = $m._id; if (-not $id) { $id = $m.id }
  Write-Output ("ID=$id | TITLE=$($m.title) | STATE=$($m.state) | TAGS=$(($m.tags) -join ',')")
}
```

Qué anotar: `TITLE` (nombre), `_id`/`id` (`reference_id`), `state=trained`, tags (`jg-voice`, a menudo `es-CO`).

El título de Fish suele ser `Nombre · mtw7uia9`. En Turbo el **nombre visible** es la parte de antes del punto medio: `Roberto`, `Amy`. Si Fish escribió `MIchael`, en Turbo se muestra **Michael**.

### B. Tabla `voices` de JG Voice

Columna `provider_voice_id` de la fila `ready` / `clone_mode=model`. Si empieza por `zeroshot:`, no sirve para Turbo.

### C. Comprobar que el modelo habla

Frase corta, mismo `reference_id`, modelo `s2.1-pro-free`. Tiene que devolver `200` y un MP3 con cabecera `FF FB` o `FF F3`:

```powershell
# $key y $id ya resueltos arriba; no imprimas $key
$body = '{"text":"Hola, prueba corta de narracion.","reference_id":"PEGA_EL_ID","format":"mp3","prosody":{"speed":1}}'
$out = Join-Path $env:TEMP "prueba-clon.mp3"
Invoke-WebRequest -Uri "https://api.fish.audio/v1/tts" -Method POST -Headers @{
  Authorization = "Bearer $key"
  "Content-Type" = "application/json"
  model = "s2.1-pro-free"
} -Body $body -OutFile $out -TimeoutSec 40
(Get-Item $out).Length
```

---

## 4. Cómo entra al selector (el patrón que ya existe)

Dos listas **hermanas**. El cliente **nunca** lleva el `reference_id`.

### 4.1 Servidor — `api/index.py` → `FISH_CATALOGO_BASE`

Tupla al **final** (no reordenes las viejas; hay fallbacks históricos):

```python
# slug, género, nombre en la app, reference_id de Fish, alias histórico, idioma
("amy", "female", "Amy", "22f8c2742acd48f6a9c12962ae179251", "", "es"),
```

| Campo | Regla |
|---|---|
| `slug` | minúsculas, guiones. **Prohibido** chocar con `narrador`, `latina`, `female`, `male` y con `FISH_VOCES_RETIRADAS` / `TTS_FISH_EQUIVALENTES`. Si el nombre es «Narrador X», usa `narrador-x` (el slug `narrador` redirige a Valentino). |
| `género` | `"female"` o `"male"` (agrupa el selector). |
| `nombre` | lo que se lee en la lista. Corto. |
| `reference_id` | el `_id` de Fish. Solo en servidor. |
| `alias` | `""` en clones nuevos. `female`/`male` están reservados. |
| `idioma` | `"es"` para estos clones. |

`GET /api/tts-voices` publica `id`, `gender`, `name`, `lang`. **No** el `reference_id`.

`backend/app.py` **no** tiene este catálogo. En producción el TTS es `api/index.py` (Vercel). No dupliques el catálogo ahí.

### 4.2 Cliente — `index.html` → `TTS_FISH_CATALOGO_LOCAL`

```javascript
{ id:'amy', gender:'female', name:'Amy', lang:'es' },
```

Mismo `id` (slug), mismo género, mismo nombre, `lang:'es'`. El agrupador `ttsGrupoFish()` la pone en «Fish Audio · español · femeninas/masculinas».

### 4.3 El PDF ya usa esa lista

No hay un catálogo aparte para PDF. `pdfController.js` llama `ttsHablar` / `ttsFetchNeuralChunk` con `sourceId: 'pdf'`.

**Regla que no se revierte (v2.77.0):**

- `ttsHablar` usa `const prefs = ttsPrefs();` **sin** apagar Fish cuando el origen es PDF.
- El prefetch de capítulos en `js/pdf/pdfController.js` pasa las mismas `prefs`, **no** `{ ...prefs, preferFish: false, fishId: '' }`.

Si vuelves a poner `preferFish: false` en PDF, el selector **miente**: dice Amy y suena Edge. Hay una prueba que lo vigila (sección 6).

`FISH_TTS_TIMEOUT` está en **25 s** (antes 15 s). Un bloque de ~900 caracteres con Fish a veces se pasaba de 15 s y caía a Edge en silencio. No lo bajes sin medir.

---

## 5. Receta: agregar una o varias voces

Trabaja sobre **`origin/main` limpio**. En este repo suele haber WIP de PDF en `index.html` y `js/pdf/`. Si lo mezclas, el deploy se lleva código a medias. Patrón seguro:

```bash
cd "C:\Users\juanl\Documents\Proyectos\jg-turbo"
git stash push -u -m "wip-antes-de-voces"
# ahora el árbol es main; aplica SOLO el catálogo
```

### 5.1 Pruebas primero (tienen que fallar)

`tests/test_tts_voces_biblioteca.mjs`

- El slug nuevo en la lista de las que «aparecen en el catálogo».
- Género y nombre.
- `ttsFishPorId('slug')` y `ttsFishPorId('fish:slug')`.

`backend/tests/test_tts_voces_fish.py`

- El par slug → `reference_id` en `NUEVAS`.
- Género y nombre en `test_clones_nuevos_genero_y_nombre` (o un test igual de explícito).

Corre y **confirma el rojo**:

```bash
node tests/test_tts_voces_biblioteca.mjs
python -m pytest backend/tests/test_tts_voces_fish.py -q --tb=line
```

### 5.2 Código mínimo

1. Tupla en `FISH_CATALOGO_BASE`.
2. Objeto en `TTS_FISH_CATALOGO_LOCAL`.
3. Comentario HTML de versión (`<!-- v2.X.0 · … -->`).
4. `const JG_JS_V = 'vNNN';` en `index.html` **y** `CACHE_SHELL = 'jg-turbo-shell-vNNN'` en `sw.js` (el mismo NNN). `tests/test_pdf_guia_capcut.mjs` lo exige.
5. Notas cortas en `CAMBIOS_TTS.md` (maestro), `CAMBIOS_PDF.md` (el selector vive en el lector), `DOCUMENTACION_DESPLIEGUE.md`, `Agents.md` §TTS.

No toques `jg_tts_voice` ni otras claves `jg_*`.

### 5.3 Verde local

```bash
node tests/test_tts_voces_biblioteca.mjs
python -m pytest backend/tests/test_tts_voces_fish.py -q --tb=line
node tests/test_pdf_guia_capcut.mjs
node tests/test_tts_narracion.mjs
python -m py_compile api/index.py
```

La de biblioteca tiene que seguir diciendo: *«ttsHablar no apaga Fish cuando el origen es el PDF»* y *«el prefetch del PDF no sustituye Fish por neural»*.

### 5.4 Commit solo de voces

Author: `JHONCOD24` / `juanloras35@gmail.com`. **No** el noreply de GitHub.

Archivos típicos (y nada más):

- `api/index.py`
- `index.html`
- `sw.js`
- `backend/tests/test_tts_voces_fish.py`
- `tests/test_tts_voces_biblioteca.mjs`
- `CAMBIOS_TTS.md`, `CAMBIOS_PDF.md`, `DOCUMENTACION_DESPLIEGUE.md`, `Agents.md`

### 5.5 Un deploy al final

Desde **esta** carpeta (donde está `index.html`), no desde `Proyectos\`:

```bash
npx vercel --prod --yes --scope jhoncod24s-projects
```

Luego `git push origin main`.

### 5.6 Verificar el dominio, no el preview

Contra `https://jg-turbo.vercel.app` (cache-bust `?t=`):

| Comprobación | Esperado |
|---|---|
| HTML | marcador `v2.X.0`, `id:'slug'`, `JG_JS_V=vNNN` |
| `sw.js` | `jg-turbo-shell-vNNN` |
| `GET /api/tts-voices` | el slug en `engines.fish.voices.list` (sin `reference_id`) |
| `POST /api/tts` | cuerpo abajo → `200`, `X-TTS-Engine: fish-neural-regional`, `X-TTS-Voice: fish:Nombre` |

```json
{
  "text": "Hola, prueba corta.",
  "voice": "male",
  "prefer_fish": true,
  "fish_voice": "slug",
  "source": "pdf",
  "language": "es"
}
```

El `source: "pdf"` es obligatorio en esta prueba: es el camino del lector. Anota el id de deploy en `CAMBIOS_TTS.md`.

Pídele al usuario Ctrl+F5 (el service worker cachea el shell).

### 5.7 Devuelve el WIP

```bash
git checkout "stash@{0}" -- <solo archivos de PDF que no sean el catálogo>
# en index.html del stash, vuelve a aplicar el catálogo nuevo si el stash era anterior
git stash drop
```

No hagas `stash pop` a ciegas: `index.html` y `pdfController.js` casi siempre chocan.

---

## 6. Receta: quitar una voz

Igual que Sandra Design Travel (v2.79.0).

1. Sácala de `FISH_CATALOGO_BASE` y de `TTS_FISH_CATALOGO_LOCAL`.
2. Cliente: `TTS_FISH_RETIRADAS` + `TTS_FISH_EQUIVALENTES` → un slug **del mismo género que siga en la lista** (Sandra → `amy`).
3. Servidor: `FISH_VOCES_RETIRADAS` con el mismo mapeo, para que un `fish_voice` viejo sintetice la equivalente y no caiga a Locutor K.
4. Pruebas: el slug **no** está en el catálogo; `ttsFishPorId('slug-viejo')` y `_tts_fish_resolver` devuelven la equivalente.
5. Versión `JG_JS_V` + `CACHE_SHELL`, docs, un deploy, verificar que `GET /api/tts-voices` ya no la lista y que `POST /api/tts` con el slug viejo responde `fish:Equivalente`.

No borres el modelo en Fish ni la fila en JG Voice salvo que el usuario lo pida. Turbo solo deja de ofrecerla.

---

## 7. Inventario actual (clones JG Voice en Turbo)

Fuente de verdad: `FISH_CATALOGO_BASE` en `origin/main`, no un `index.html` sucio local.

| Nombre | Slug | Género | `reference_id` | Estado |
|---|---|---|---|---|
| Roberto | `roberto` | male | `ab991f011ecf46a29c1aee96e109d8f7` | en el selector |
| Amy | `amy` | female | `22f8c2742acd48f6a9c12962ae179251` | en el selector |
| Dora | `dora` | female | `d0d60d228b744e2b9fc7fd00bc6f6b3a` | en el selector |
| Michael | `michael` | male | `6b33f00f4d7a49d89a1c7a6f7abec6c4` | en el selector |
| Sandra Design Travel | `sandra-design-travel` | female | `ffd08eb8a7424826a31aaa1f526a3762` | retirada → Amy |

Clones viejos de JG Voice (Jhon, Jesús Narrador, Angelica, …) **no** están en Turbo a propósito: solo se meten los que el usuario pide.

Uso: personal, no comercial. No hace falta el gate legal de JG Voice en Turbo mientras no se publique a terceros.

---

## 8. Qué no hacer

| Tentación | Por qué rompe |
|---|---|
| API JG Voice → JG Turbo | Inútil. El id de Fish basta. Auth y RLS de más. |
| Meter el MP3/OGG en `audio/` como «voz» | El lector no reproduce esa muestra; pide TTS. |
| Hacer el modelo `public` en Fish | No hace falta y expone el clon. |
| Poner `reference_id` en `index.html` | El cliente no lo necesita; es detalle de servidor. |
| `preferFish: false` otra vez en PDF | El selector miente. v2.77.0 lo quitó. |
| Desplegar con WIP de PDF mezclado | `npx vercel --prod` sube el disco, no el índice de Git. |
| Id `zeroshot:…` | Turbo no envía el audio fuente. |
| Slug `narrador` / `latina` / `male` / `female` | Redirigen a voces viejas. |
| Bajar `FISH_TTS_TIMEOUT` a 15 s | Fish en bloques de PDF cae a Edge. |
| Deploy desde `Proyectos\` | Histórico 404. Siempre `jg-turbo\`. |
| Author de Git `…@users.noreply.github.com` | Vercel *Deployment Blocked*. |

---

## 9. Cómo lo usa la persona

1. https://jg-turbo.vercel.app · Ctrl+F5.
2. Pestaña PDF, abre un libro.
3. Selector de voz → **Fish Audio · español · femeninas/masculinas** → el clon.
4. **Escuchar**. Arranque ~2–3 s (Fish); Edge ~1 s. La cola de bloques no se toca.

La preferencia queda en `jg_tts_voice` (ej. `fish:amy`). No la borres en un deploy.

---

## 10. Mapa de archivos

| Archivo | Rol |
|---|---|
| **Este documento** | Receta para agentes |
| `api/index.py` | Catálogo servidor, timeout, retiradas, `POST /api/tts` |
| `index.html` | Catálogo cliente, `ttsHablar`, `ttsPrefs`, `JG_JS_V` |
| `js/pdf/pdfController.js` | Prefetch del PDF: mismas prefs |
| `sw.js` | `CACHE_SHELL` |
| `backend/tests/test_tts_voces_fish.py` | Resolvedor + `reference_id` |
| `tests/test_tts_voces_biblioteca.mjs` | Lista, redirecciones, PDF no apaga Fish |
| `CAMBIOS_TTS.md` | Historial TTS |
| JG Voice `web/lib/providers/fish-audio.ts` | `POST /model` (private) y TTS |
| JG Voice `web/lib/services/voice-service.ts` | Persiste `provider_voice_id` |
