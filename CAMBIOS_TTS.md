# Lectura en voz alta (TTS) — JG Turbo

**Documento maestro** del módulo texto a voz. Aquí queda registrado: qué hace el sistema, cómo funciona, qué se cambió en cada versión, por qué, cómo se prueba, cómo se despliega y dónde está el código.

| Campo | Valor |
|---|---|
| **Versión motor** | **2.8.0** (lectura continua + controles de reproducción · 2026-08-14) |
| **UI consola** | **compacta horizontal · 2026-08-01** (ver §0 y `CAMBIOS_UX.md` v3.2) |
| **Fecha UI** | 2026-08-01 |
| **Producción** | https://jg-turbo.vercel.app |
| **Deploy UI franja TTS** | `CD7GVazANst7gZCovnGZRrYAq1A3` · Ready (alias jg-turbo) |
| **Deploy código 2.7.0 (motor)** | `dpl_BXHP9gGYRWjcSfkW37sxoBk9rpME` · Ready |
| **Motor** | `edge-tts` (voces neurales Microsoft Edge, sin API key de pago) |
| **Respaldo** | `speechSynthesis` del navegador |
| **Consola del navegador** | `JG Turbo v2.8.0 · TTS: lectura continua sin cortes, avanzar/retroceder, velocidad instantánea y voz en el idioma del texto (es · en · pt · fr · de · it)` |

### Mapa de documentación relacionada

| Documento | Contenido |
|---|---|
| **Este archivo** (`CAMBIOS_TTS.md`) | Maestro TTS: arquitectura, historial, bugs, API, deploys, pruebas |
| `CAMBIOS_UX.md` | Layout UI (v3.2 franja TTS, v3.1 más acciones) |
| `CONFIG_PERSISTENTE.md` | Claves `localStorage` `jg_tts_*` (no borrar en deploys) |
| `DOCUMENTACION_DESPLIEGUE.md` | Cómo sincronizar y desplegar en Vercel sin 404 |
| `FICHA_TECNICA.md` | Manual de producto (sección lectura en voz alta) |
| `Agents.md` (app) | Reglas cortas para agentes + voces actuales |
| `Agents.md` / `AGENTS.md` (raíz monorepo) | Deploy siempre desde `vercel_deploy/` |

---

## Nuevo en v2.8.0 — Lectura continua con controles de reproducción (2026-08-14)

**Pedido del usuario:** reproducción fluida y sin pausas, con velocidad estable
y parametrizable; poder avanzar y retroceder como en YouTube sin volver a
empezar; menos espera hasta oír la voz; y que las voces no suenen robóticas y
hablen **en el idioma del texto**.

### Qué estaba mal y qué se hizo

| Problema | Causa real | Solución |
|---|---|---|
| Huecos audibles entre frases | Cada bloque creaba un `<audio>` nuevo; el navegador tenía que decodificarlo desde cero antes de sonar | **Dos elementos `<audio>` que se turnan**: mientras uno suena, el otro ya tiene el bloque siguiente cargado y decodificado. El relevo es inmediato |
| La lectura se paraba a media frase | Solo se generaba **un** bloque por delante, y el servicio de voz tarda un tiempo muy variable (medido: 2 s… 40 s para el mismo texto) | **Colchón de 120 s de audio** generado por delante, con hasta 3 bloques a la vez y reposición automática al liberarse un hueco |
| Cambiar la velocidad reiniciaba la lectura | La velocidad se pedía al servidor, así que había que **regenerar todo el audio restante** | El audio se genera siempre a ritmo natural y **el navegador lo acelera** (`playbackRate` con `preservesPitch`). El cambio se oye al instante y no salta |
| No se podía avanzar ni retroceder | No existía línea de tiempo: solo play/pausa/detener | **Barra de reproducción** con ⏪ 10 s, ⏩ 10 s, posición arrastrable y tiempo `0:35 / 1:42`, más controles del sistema (pantalla de bloqueo y auriculares) |
| Tardaba mucho en empezar a sonar | Todos los bloques tenían el mismo tamaño (900 caracteres), y el primero es el que marca la espera | **Bloques escalonados** `190 → 340 → 560 → 900`: el primero es corto y suena enseguida; los siguientes crecen porque da tiempo a generarlos mientras se escucha |
| Repetir un texto volvía a costar lo mismo | Nada se guardaba | **Caché en memoria** (48 bloques) + `GET /tts` cacheable en navegador y CDN. Repetir el mismo texto: **~35 ms** medidos |
| La primera lectura del día tardaba segundos de más | El servicio de voz paga arranque (DNS, TLS y token) en la primera síntesis | `GET /tts-warmup`: al acercarse el usuario a la consola se abre la conexión en segundo plano |
| Texto en portugués/francés/alemán/italiano leído con voz española | El servidor solo tenía voces `es` y `en`, y el idioma venía del desplegable, no del texto | **Voces propias para 6 idiomas** y **detección del idioma real del texto**: si el texto contradice al desplegable con claridad, manda el texto |
| El `force-EN` estropeaba otros idiomas | Un texto sin acentos ni palabras españolas se marcaba como inglés — y eso incluye el portugués | El `force-EN` ahora **solo se aplica cuando el idioma base es español** |

### Voces por idioma (nuevas)

| Idioma | Mujer | Hombre |
|---|---|---|
| Español (LATAM) | Dalia (MX) · Salomé (CO) · Elena (AR) · Paloma (US) | Gonzalo (CO) · Jorge (MX) · Tomás (AR) · Alonso (US) |
| Inglés | Aria | Andrew |
| Portugués (BR) | Francisca | Antônio |
| Francés | Denise | Henri |
| Alemán | Katja | Conrad |
| Italiano | Elsa | Diego |

El modo «Misma voz» (Ava/Andrew multilingües) se mantiene como predeterminado
**para español e inglés**. En los demás idiomas se usa la voz nativa del idioma,
que suena mucho mejor que una voz inglesa leyendo alemán.

### Cambios por capa

| Capa | Cambio |
|---|---|
| Cliente (`index.html`) | Reproductor de doble búfer (`ttsPool`, `ttsReproducirDesde`, `ttsBloqueTerminado`); línea de tiempo (`ttsDuracionTotal`, `ttsTiempoActual`, `ttsBuscar`, `ttsSaltar`); barra de reproducción creada por JS en las 5 consolas (`ttsMontarTransporte`); caché (`ttsCache`); detección de idioma (`ttsDetectarIdiomaTexto`, `ttsIdiomaParaNarrar`); escalonado (`TTS_ESCALON`, `ttsEscalonarCola`); `MediaSession` |
| API (`api/index.py` / `backend/app.py`) | Catálogo con `pt-BR`, `fr-FR`, `de-DE`, `it-IT`; `_tts_locale(locale, language)` corrige acentos incoherentes; `_tts_resolve_language` limita el force-EN al español; nuevo `GET /tts` cacheable (24 h); nuevo `GET /tts-warmup`; `/tts-voices` expone `languages` |
| Velocidad | El cliente envía siempre `rate: 1`. Presets `0.75× … 2×` (antes empezaban en 1×) |

### Medido en navegador real (Chromium, backend local)

| Medida | Antes | Ahora |
|---|---|---|
| Muestras de reproducción esperando audio nuevo | 21 de 72 (~5 s de silencio) | **0 de 72** |
| Bloques generados por delante del que suena | 1 | **3** |
| Tiempo hasta oír la voz | — | **1,3 – 2,1 s** (varía con la red) |
| Repetir el mismo texto | síntesis completa | **~35 ms** (caché) |
| Cambiar de velocidad | reiniciaba la lectura | **1 ms**, sin saltos |

### Pruebas

| Archivo | Cubre |
|---|---|
| `test_tts_reproductor.js` | 34 comprobaciones: escalonado, corte de frases, línea de tiempo, seek, detección de 6 idiomas, acentos, velocidad |
| `test_tts_navegador.js` | 24 comprobaciones en Chromium real: continuidad sin huecos, saltos, velocidad, barra, pausa (incluida la pausa durante la generación), caché, accesibilidad |
| `test_tts_idiomas.py` | 26 comprobaciones de servidor: voz correcta en 6 idiomas, acento corregido, GET cacheable, force-EN intacto |
| `test_cola_tts.js` · `test_tts_unificado.py` | Baterías previas (9/9 y 10/10): siguen pasando |
| `backend/tests` | 87 pasadas, 2 saltadas |

### Detalles que importan

- **Sin atajos de teclado nuevos.** La barra espaciadora ya inicia la grabación y
  las flechas cambian de pestaña: añadir atajos globales habría roto ambos. La
  barra de posición se maneja con el tabulador y las flechas, que es lo estándar.
- **En el celular**, al aparecer la barra la consola pasa a dos líneas (antes era
  una sola franja con desplazamiento lateral, y la barra habría escondido el
  botón de pausa). El texto «Leyendo…» se oculta porque el tiempo ya lo dice.
- **Respaldo del navegador**: si el motor neural falla se sigue usando
  `speechSynthesis`, que **no permite avanzar ni retroceder**; al intentarlo se
  avisa en vez de fallar en silencio.

---

## Nuevo en v2.7.0 — «Misma voz» multilingüe (2026-08-09)

**Pedido del usuario:** las voces seguían sonando robóticas y, al pegar texto con
español e inglés, la app **cambiaba de voz** (voz inglesa distinta, más lenta, sin
fluidez). Quería: voces naturales y fluidas en español y que **la misma voz** diga
los términos en inglés en inglés.

**Causa del problema:** el modo «Automática» partía el texto en fragmentos ES/EN y
cada fragmento iba a una voz distinta (Dalia/Gonzalo → Aria/Andrew), con prosodia
reducida en inglés (rate ×0.88/×0.94) y audios separados concatenados. El cambio de
identidad de voz + micro-pausas + frenado es lo que sonaba robótico y lento.

**Solución:** nuevo modo **«Misma voz · fluida» (`unified`)**, ahora el **modo por
defecto**, basado en las voces **Multilingual** de Microsoft Edge:

| Rol | Voz | Respaldo |
|---|---|---|
| Mujer | `en-US-AvaMultilingualNeural` | `en-US-EmmaMultilingualNeural` |
| Hombre | `en-US-AndrewMultilingualNeural` | `en-US-BrianMultilingualNeural` |

Una sola voz multilingüe lee todo el texto: habla **español fluido** y, al llegar a
un término en inglés, lo pronuncia **en inglés con la misma voz y el mismo ritmo**
(detección interna del modelo, sin segmentación ni cambio de audio). Verificado el
2026-08-09 con `edge-tts 7.2.8`: las 4 voces sintetizan ES, EN y texto mixto.

**Qué cambia en cada capa:**

| Capa | Cambio |
|---|---|
| Cliente (`index.html`) | `jg_tts_bilingual` acepta `unified` \| `auto` \| `off`; por defecto `unified`. El valor guardado antiguo `auto` migra a `unified`. En `unified`, `ttsCrearCola` no segmenta ES/EN (cola `lang:'multi'`), no aplica guías de pronunciación ni frenado EN |
| API (`api/index.py` / `backend/app.py`) | `POST /tts` acepta `unified: true` → usa `TTS_UNIFIED_VOICES`, **sin force-EN**; headers `X-TTS-Language: multi`, `X-TTS-Engine: edge-neural-unified`. `/tts-voices` expone el catálogo `unified` |
| Fallback | Si fallan las voces multilingües → respaldo `speechSynthesis` del navegador (narra en el idioma base) |
| Modo «Dos voces» | El comportamiento antiguo (ES latino + EN inglés por fragmentos) queda disponible en Configuración como opción `auto` |

**Trade-off conocido:** en «Misma voz» el acento español es neutro-latino (voces
es-US multilingües no existen en el catálogo Edge actual); a cambio se gana fluidez
total. Quien prefiera acento MX/CO exacto puede usar «Dos voces».

**Pruebas locales (2026-08-09):** `test_tts_unificado.py` (10/10: catálogo,
unified mujer/hombre, inglés puro sin cambio de voz, legado force-EN y Gonzalo) y
`test_cola_tts.js` (9/9: cola unified/auto/off + helpers). Sintaxis JS validada con
`node --check`.

---

## 0. UI de la consola TTS — franja horizontal (2026-08-01)

**No es un cambio de motor.** Voces, segmentación bilingüe, API `/tts` y claves `jg_tts_*` siguen en **v2.6.3**.

**Pedido:** en «Editar en grande» y paneles, Escuchar + Mujer/Hombre + velocidad ocupaban **demasiado alto** y tapaban el texto.

**Qué se hizo (solo CSS en `index.html`):**

| Antes | Después |
|---|---|
| Varias filas (título, play, voz, velocidad) | **Una franja:** Escuchar · Detener · estado · Mujer · Hombre · velocidad |
| Modal ~100–180 px de consola | Modal **~53 px**, **1 fila** (móvil medido) |
| Textarea modal ~367 px | Textarea modal **~417 px** |

**Técnica:** `display: contents` en filas internas; etiquetas visuales ocultas (accesibles a lectores de pantalla); en móvil, badge de motor oculto y estado «Lista» oculto hasta que suena.

**Paneles:** `mic`, `file`, `yt`, `trans`, `modal` (`data-tts-console`).

**Deploy:** `CD7GVazANst7gZCovnGZRrYAq1A3` · https://jg-turbo.vercel.app  
**Doc UX completa:** `CAMBIOS_UX.md` → sección **v3.2**.

---

## 1. Qué hace el módulo (comportamiento actual)

1. El usuario pulsa **Escuchar** (o **Probar voz**).
2. Se limpia el texto (Markdown, enlaces, viñetas) **solo para narrar**; el texto en pantalla no se modifica.
3. **Modo «Misma voz» (`unified`, por defecto desde v2.7.0):** el texto se parte
   solo por longitud (sin segmentar idiomas) y se envía completo a **una voz
   multilingüe** (Ava/Andrew), que pronuncia el español y el inglés con la misma
   voz y el mismo ritmo. No usa guías de pronunciación ni force-EN.
4. **Modo «Dos voces» (`auto`, legado 2.6.x):** el flujo de abajo.

Flujo legado (`auto`):

1. Se parte en oraciones **sin romper** nombres técnicos con punto (`Node.js`, `2.6.3`, `U.S.A.`).
2. Si la pronunciación bilingüe está en **Dos voces**:
   - Marca tramos en **español** y tramos en **inglés/tech**.
   - Une listas técnicas (`OpenAI, Python y React`) en un solo tramo EN.
3. Por cada tramo:
   - **ES** → voz latina según acento/género (auto: mujer Dalia MX, hombre Gonzalo CO).
   - **EN** → voz inglesa del mismo género (mujer Aria, hombre Andrew), con **guías de pronunciación** en el audio.
4. Si un tramo quedó mal etiquetado como ES pero es solo tech/EN → **force-EN** (cliente y servidor).
5. Precarga el siguiente audio mientras suena el actual.
6. Si falla la red/neural → voces del navegador.

El detector **no traduce**. Solo decide voz y, en inglés, cómo **decir** el audio.

---

## 2. Voces recomendadas

### Modo «Misma voz» (`unified`, por defecto desde v2.7.0)

| Rol | Voz neural | Respaldo |
|---|---|---|
| Mujer | `en-US-AvaMultilingualNeural` | `en-US-EmmaMultilingualNeural` |
| Hombre | `en-US-AndrewMultilingualNeural` | `en-US-BrianMultilingualNeural` |

Hablan español fluido y pronuncian el inglés en inglés **sin cambiar de voz**.
Acento español neutro-latino (no hay voces es-* Multilingual en Edge).

### Modo «Dos voces» (`auto`, acento **Automático**)

| Rol | Voz neural | Notas |
|---|---|---|
| Mujer · español | `es-MX-DaliaNeural` | Más natural que Salomé para muchos oídos |
| Hombre · español (zona CO) | `es-CO-GonzaloNeural` | Se mantiene; prosodia un poco más calmada |
| Mujer · inglés | `en-US-AriaNeural` | Clara en tech corto |
| Hombre · inglés | `en-US-AndrewNeural` | Paridad con Aria (monoidioma; no Multilingual) |

### Todos los acentos

| Acento | Femenina | Masculina |
|---|---|---|
| Colombia | `es-CO-SalomeNeural` | `es-CO-GonzaloNeural` |
| México | `es-MX-DaliaNeural` | `es-MX-JorgeNeural` |
| Argentina | `es-AR-ElenaNeural` | `es-AR-TomasNeural` |
| Latino EE. UU. | `es-US-PalomaNeural` | `es-US-AlonsoNeural` |
| Inglés EE. UU. | `en-US-AriaNeural` | `en-US-AndrewNeural` |

### Fallbacks si falla la síntesis

| Idioma | Género | Orden |
|---|---|---|
| es | female | Dalia → Salomé → Paloma |
| es | male | Gonzalo → Jorge → Alonso |
| en | female | Aria → Jenny → Ava Multilingual |
| en | male | Andrew → Brian → Christopher → Guy |

Referencias externas: [voces Azure/Edge](https://learn.microsoft.com/en-us/azure/ai-services/speech-service/language-support?tabs=text-to-speech) · [edge-tts](https://github.com/rany2/edge-tts).

---

## 3. Arquitectura técnica (flujo completo)

### 3.1 Cliente (`index.html`)

```text
Texto del usuario
  → ttsNormalizarTextoNarracion          # limpia Markdown, no toca el editor
  → ttsCrearCola(texto, langHint, max, bilingual)
       → ttsPartirOraciones              # no rompe Node.js / 2.6.3 / U.S.A.
       → por cada oración:
            ttsDetectarIdiomaFrase       # es vs en a nivel frase
            ttsSegmentarTerminosIngles   # marca EN dentro de ES
                 · catálogo TTS_ENGLISH_TERMS + jg_glossary
                 · ttsPareceTokenIngles  # heurísticas (catálogo ANTES de ES_SAFE)
                 · puntuación se pega al tramo
                 · ttsUnirConectoresIngles  # EN + y/, + EN (varias pasadas)
       → segunda ttsUnirConectoresIngles + merge de cola
  → cola: [{ text, lang: 'es'|'en' }, ...]
  → por ítem: ttsFetchNeuralChunk
       → ttsForzarIdiomaSiInglesPuro     # red de seguridad cliente
       → si EN: ttsPrepararTextoIngles   # guías de pronunciación (audio)
       → prosodia (rate/tone)
       → POST /api/tts  { text, voice, rate, language, locale, tone }
  → reproduce audio/mpeg + precarga siguiente
  → si falla → ttsHablarBrowserDesde (speechSynthesis)
```

### 3.2 Servidor (`api/index.py` en Vercel · `backend/app.py` en local)

```text
POST body
  → limpia espacios
  → language = _tts_resolve_language(req.language, text)
       · si client dice en → en
       · si texto es solo EN/tech (sin palabras funcionales ES) → en  # force-EN servidor
  → voice_id = catálogo[locale o en-US][gender]
  → prosodia _tts_prosody(rate, tone)
  → edge_tts.Communicate → audio/mpeg
  → headers X-TTS-Voice, X-TTS-Language, X-TTS-Locale, ...
```

### 3.3 Funciones clave (cliente)

| Función | Rol |
|---|---|
| `ttsPartirOraciones` | Partir oraciones sin romper puntos técnicos |
| `ttsUnirConectoresIngles` | Unir listas `EN + y\|,\|/\|& + EN` en varias pasadas |
| `ttsSegmentarTerminosIngles` | Marcar spans EN + puntuación + puente |
| `ttsPareceTokenIngles` | ¿Este token debe ir en voz inglesa? |
| `ttsCrearCola` | Cola final de fragmentos |
| `ttsPrepararTextoIngles` | Guías de pronunciación **solo en el audio EN** |
| `ttsForzarIdiomaSiInglesPuro` | Si el tramo es solo EN/tech → `language=en` |
| `ttsFetchNeuralChunk` | Llama a la API con prosodia correcta |
| `ttsResolveNeuralLocale` | auto → mujer MX / hombre CO |
| `ttsHablar` / `ttsHablarNeural` | Orquesta cola, precarga, UI |

### 3.4 Funciones clave (servidor)

| Función | Rol |
|---|---|
| `_tts_gender` | `male` / `female` |
| `_tts_language` | Normaliza es/en del request |
| `_tts_fragment_is_english` | ¿Texto sin español funcional = EN puro? |
| `_tts_resolve_language` | language final (incluye force-EN) |
| `_tts_pick_voice` | Elige ID de voz neural |
| `_tts_prosody` | rate % / pitch / volume por tono |
| `_tts_synthesize` | Llama a `edge_tts` |
| endpoint `POST /api/tts` o `/tts` | Responde MP3 + headers |
| endpoint `GET /api/tts-voices` o `/tts-voices` | Catálogo |

### 3.5 Orden de detección EN en un token (`ttsPareceTokenIngles`)

1. URLs / emails → EN  
2. Palabras funcionales españolas (`TTS_ES_WORDS`) → no EN  
3. Tildes / ¿¡ → no EN  
4. **Catálogo `TTS_ENGLISH_TERMS` y `TTS_EN_WORDS` → EN** (antes del “safe”)  
5. Cognados inocuos `TTS_ES_SAFE` (sin tech) → no EN  
6. CamelCase, letras+números, extensiones, acrónimos, sufijos -ing/-tion, etc. → EN  

**Importante v2.6.3:** `TTS_ES_SAFE` ya **no** incluye tech (`app`, `code`, `web`, `model`…). Esas palabras van a voz inglesa.

### 3.6 Prosodia (cliente → servidor) — v2.6.3

| Condición | Ajuste |
|---|---|
| EN, ≤4 palabras (tras prep) | rate × 0.88 |
| EN, ≤10 palabras | rate × 0.94 |
| EN (cualquier género) | `tone = neutral` (no distorsionar pronunciación) |
| ES + hombre | rate × 0.97; si tono era neutral → se envía `warm` |
| Servidor warm | −4 % rate, −2 Hz, +1 % vol |
| Servidor energetic | +4 % rate, +2 Hz, +2 % vol |

Velocidad del usuario (1×–2×) se aplica primero. Servidor acota rate a 0.8–2.0.

### 3.7 Guías de pronunciación EN (`ttsPrepararTextoIngles`)

Solo afectan el **audio**. El texto del editor no cambia.

Ejemplos (lista completa en `index.html` dentro de la función):

| Escrito | Se envía a TTS EN (audio) |
|---|---|
| OpenAI | Open A I |
| ChatGPT | Chat G P T |
| GitHub | Git Hub |
| Node.js | Node J S |
| Next.js | Next J S |
| TypeScript | Type Script |
| API / LLM / SDK / CLI | A P I / L L M / S D K / C L I |
| GPT-4 / GPT-4o | G P T 4 / G P T 4 o |
| JSON | Jason |
| AWS / GCP / iOS | A W S / G C P / I O S |
| … | (+ CamelCase, letra+número, acrónimos 2–4 mayúsculas) |

Mujer y hombre usan **el mismo** preparador.

---

## 4. Controles de la interfaz

Consolas en: Micrófono, Archivo, YouTube, Traducción, editor ampliado.

- Escuchar / Pausar / Reanudar / Detener  
- Mujer / Hombre  
- Velocidad: 1× · 1.25× · 1.5× · 1.75× · 2×  

**Configuración:**

- Motor: neural | navegador
- Acento: Recomendado (Mujer MX / Hombre CO) | México | Colombia | Argentina | Latino EE. UU.
- Pronunciación bilingüe: **Misma voz · fluida (`unified`, recomendada)** | Dos voces (`auto`) | Solo idioma principal (`off`)
- Tono: neutral | cálido | enérgico
- Velocidad fina + **Probar voz**

> En modo «Misma voz», el selector de acento no cambia la voz (la voz multilingüe
> es única por género); el acento aplica en «Dos voces» y «Solo idioma principal».

---

## 5. Contrato de la API

| Entorno | Sintetizar | Catálogo |
|---|---|---|
| Vercel | `POST /api/tts` | `GET /api/tts-voices` |
| Local | `POST /tts` | `GET /tts-voices` |

### Request

```json
{
  "text": "OpenAI y Python",
  "voice": "male",
  "rate": 1,
  "language": "es",
  "locale": "es-CO",
  "tone": "neutral",
  "unified": true
}
```

| Campo | Valores | Notas |
|---|---|---|
| `text` | string | Máx. 2800 en servidor; cliente ~900 por fragmento |
| `voice` | `female` \| `male` | Género |
| `rate` | 0.8–2.0 | Velocidad |
| `language` | `es` \| `en` | El servidor puede forzar `en` si el texto es tech puro (solo modo legado; en `unified` se ignora) |
| `locale` | `es-CO` `es-MX` `es-AR` `es-US` | Solo aplica si el idioma final es ES |
| `tone` | `neutral` `warm` `energetic` | Prosodia |
| `unified` | `true` \| `false` | **v2.7.0.** `true`: voz multilingüe única (Ava/Andrew), sin force-EN; headers `X-TTS-Language: multi` y `X-TTS-Engine: edge-neural-unified` |

### Response

- Cuerpo: `audio/mpeg`  
- Headers: `X-TTS-Voice`, `X-TTS-Rate`, `X-TTS-Pitch`, `X-TTS-Tone`, `X-TTS-Language`, `X-TTS-Locale`, `X-TTS-Engine`

### Catálogo recomendado (v2.7.0)

```json
{
  "engine": "edge-neural-bilingual",
  "default_locale": "es-MX",
  "recommended": {
    "female_locale": "es-MX",
    "female_voice": "es-MX-DaliaNeural",
    "male_locale": "es-CO",
    "male_voice": "es-CO-GonzaloNeural",
    "english_female": "en-US-AriaNeural",
    "english_male": "en-US-AndrewNeural"
  },
  "unified": {
    "female": "en-US-AvaMultilingualNeural",
    "male": "en-US-AndrewMultilingualNeural"
  },
  "bilingual": true
}
```

---

## 6. Persistencia

**No se renombran ni eliminan claves `jg_*`.**
Clave añadida en la línea 2.6: `jg_tts_bilingual`.
**v2.7.0:** `jg_tts_bilingual` añade el valor `unified` (nuevo default). El valor
guardado antiguo `auto` migra a `unified` en memoria al leerlo (el usuario puede
volver a elegir «Dos voces», que guarda `auto` otra vez).

| Clave | Valores | Default |
|---|---|---|
| `jg_tts_engine` | `neural` \| `browser` | `neural` |
| `jg_tts_gender` | `female` \| `male` | `female` |
| `jg_tts_locale` | `auto` \| `es-CO` \| `es-MX` \| `es-AR` \| `es-US` | `auto` |
| `jg_tts_bilingual` | `unified` \| `auto` \| `off` | `unified` |
| `jg_tts_tone` | `neutral` \| `warm` \| `energetic` | `neutral` |
| `jg_tts_rate` | 0.8–2.0 | `1` |

Un deploy en el **mismo dominio** no borra preferencias. Ver `CONFIG_PERSISTENTE.md`.

---

## 7. Archivos del feature

| Archivo | Rol |
|---|---|
| `Spech to text App/index.html` | UI + toda la lógica de segmentación, prep EN, cola, playback |
| `Spech to text App/api/index.py` | TTS en Vercel (catálogo, force-EN, edge-tts) |
| `Spech to text App/backend/app.py` | Misma lógica TTS en servidor local |
| `Spech to text App/api/requirements.txt` | `edge-tts>=6.1.0,<8.0` |
| `Spech to text App/backend/requirements.txt` | Igual |
| `Spech to text App/CAMBIOS_TTS.md` | Este documento maestro |
| `Spech to text App/CONFIG_PERSISTENTE.md` | Claves `jg_tts_*` |
| `Spech to text App/FICHA_TECNICA.md` | Manual de producto |
| `Spech to text App/DOCUMENTACION_DESPLIEGUE.md` | Deploy y registros |
| `Spech to text App/Agents.md` | Reglas para agentes |
| `vercel_deploy/*` | Copia que se despliega a Vercel |

---

## 8. Proceso de trabajo y despliegue (obligatorio)

### 8.1 Pasos al cerrar una mejora TTS

1. Editar en `Spech to text App/` (nunca solo en `vercel_deploy/` a mano sin origen).  
2. Actualizar **este** `CAMBIOS_TTS.md` (versión, IDs, cambios, pruebas).  
3. Alinear satélites si aplica: `DOCUMENTACION_DESPLIEGUE.md`, `FICHA_TECNICA.md`, `Agents.md`, `CONFIG_PERSISTENTE.md`.  
4. Sincronizar a `vercel_deploy/`:

```powershell
$src = "Spech to text App"
$dst = "vercel_deploy"
Copy-Item "$src\index.html" "$dst\index.html" -Force
Copy-Item "$src\api\index.py" "$dst\api\index.py" -Force
Copy-Item "$src\api\requirements.txt" "$dst\api\requirements.txt" -Force
# docs que se quieran en el deploy:
Copy-Item "$src\CAMBIOS_TTS.md" "$dst\CAMBIOS_TTS.md" -Force
Copy-Item "$src\DOCUMENTACION_DESPLIEGUE.md" "$dst\DOCUMENTACION_DESPLIEGUE.md" -Force
Copy-Item "$src\FICHA_TECNICA.md" "$dst\FICHA_TECNICA.md" -Force
Copy-Item "$src\CONFIG_PERSISTENTE.md" "$dst\CONFIG_PERSISTENTE.md" -Force
Copy-Item "$src\Agents.md" "$dst\Agents.md" -Force
```

5. Desplegar **solo** desde `vercel_deploy/`:

```powershell
cd "G:\Mi unidad\PROYECTS\JG Turbo\vercel_deploy"
npx vercel --prod --yes
```

6. Verificar producción (sección 9).  
7. Anotar el `dpl_…` en este documento.

### 8.2 Error 404 por deploy desde la raíz

Si se ejecuta `npx vercel --prod` desde `JG Turbo/` (raíz del monorepo):

- Vercel sube **miles** de archivos (~1856).  
- Producción responde `NOT_FOUND` (sin frontend/API útiles).  

**Señal de deploy correcto:** ~19 archivos, instala `api/requirements.txt`, alias `https://jg-turbo.vercel.app`.

Ocurrió al desplegar v2.6.2; se corrigió re-desplegando desde `vercel_deploy/`.

---

## 9. Cómo probar (manual y API)

### 9.1 Manual en la app

1. Abrir https://jg-turbo.vercel.app
2. **Ctrl+F5** (evitar caché del `index.html` viejo).
3. Consola del navegador debe mostrar `v2.7.0`.
4. Configuración: motor **neural**, pronunciación **Misma voz · fluida**.
5. Probar **Mujer** y **Hombre** con:

```text
Hola. JG Turbo usa OpenAI, Python y Node.js.
The API works in real time.
ChatGPT, GitHub y machine learning.
Configura el endpoint del backend en Vercel.
```

**Esperado (Misma voz):**

- Una sola voz (Ava mujer / Andrew hombre) para todo el texto.
- Español fluido; los términos en inglés se dicen en inglés **sin cambiar de voz
  ni ponerse lenta**.
- Etiqueta de la consola: `Misma voz · Ava/Andrew · multilingüe`.

**Esperado (Dos voces, legado):**

- Español natural (Dalia / Gonzalo).
- Inglés/tech con Aria (mujer) o Andrew (hombre), sin españolizar.
- Listas técnicas en un tramo EN continuo.

### 9.2 API (PowerShell)

```powershell
$base = "https://jg-turbo.vercel.app"
(Invoke-RestMethod "$base/api/tts-voices").recommended
(Invoke-RestMethod "$base/api/tts-voices").unified

# Modo unificado: unified=true → voz multilingüe, language=multi
$body = '{"text":"Hola, usamos OpenAI y Python en Vercel.","voice":"male","rate":1,"language":"es","locale":"es-CO","tone":"neutral","unified":true}'
$r = Invoke-WebRequest "$base/api/tts" -Method POST -ContentType "application/json; charset=utf-8" -Body $body
$r.Headers['X-TTS-Voice']      # en-US-AndrewMultilingualNeural
$r.Headers['X-TTS-Language']   # multi
$r.Headers['X-TTS-Engine']     # edge-neural-unified

# Legado: Force-EN: language=es pero texto solo tech → debe salir Andrew + lang=en
$body = '{"text":"OpenAI","voice":"male","rate":1,"language":"es","locale":"es-CO","tone":"neutral"}'
$r = Invoke-WebRequest "$base/api/tts" -Method POST -ContentType "application/json; charset=utf-8" -Body $body
$r.Headers['X-TTS-Voice']      # en-US-AndrewNeural
$r.Headers['X-TTS-Language']   # en
```

### 9.3 Verificación registrada en producción (v2.7.0)

| Prueba | Resultado |
|---|---|
| `GET /api/tts-voices` | `unified.male: en-US-AndrewMultilingualNeural` |
| Mujer + `unified=true` + texto mixto | `en-US-AvaMultilingualNeural` / lang=`multi` |
| Hombre + `unified=true` + texto mixto | `en-US-AndrewMultilingualNeural` / lang=`multi` |
| `unified=true` + inglés puro | **No** cambia de voz (sigue la multilingüe) |
| Legado: hombre + tech puro | `en-US-AndrewNeural` / lang=`en` (force-EN) |
| Legado: hombre + español normal | `es-CO-GonzaloNeural` / lang=`es` |
| HTML prod | contiene `v2.7.0`, `unified`, `Misma voz` |

Verificado el 2026-08-09 contra `https://jg-turbo.vercel.app` (deploy
`dpl_BXHP9gGYRWjcSfkW37sxoBk9rpME`) con `verificar_tts_prod.ps1`: los 5 casos de
síntesis y las comprobaciones de HTML devolvieron exactamente esos valores.

### 9.3.1 Verificación registrada en producción (v2.6.3)

| Prueba | Resultado |
|---|---|
| `GET /api/tts-voices` | `english_male: en-US-AndrewNeural` |
| Hombre + `language=es` + texto `OpenAI` | `en-US-AndrewNeural` / lang=`en` (force-EN) |
| Hombre + `API SDK` forzado ES | `en-US-AndrewNeural` / lang=`en` |
| Hombre + español normal | `es-CO-GonzaloNeural` / lang=`es` |
| Mujer + EN preparado | `en-US-AriaNeural` / lang=`en` |
| HTML prod | contiene `v2.6.3`, `ttsPrepararTextoIngles`, `ttsForzarIdiomaSiInglesPuro` |

### 9.4 Casos de segmentación (cliente)

| Texto | Cola esperada (resumen) |
|---|---|
| `Node.js, React y TypeScript son populares.` | EN: Node.js, React y TypeScript · ES: son populares. |
| `GitHub, pull request y commit.` | Un solo tramo EN |
| `Hola. JG Turbo usa OpenAI y Python.` | ES/EN intercalado; OpenAI y Python en EN |
| `app web code` | Un tramo EN (ya no bloqueado por ES_SAFE) |
| `API SDK LLM` | EN |
| `Versión 2.6.3 lista.` | Un tramo ES (versión no se “inglesa”) |
| `Hello world` | EN |

---

## 10. Historial de versiones (cronológico)

### v2.7.0 — Misma voz multilingüe (2026-08-09)

**Pedido:** voces robóticas; al pegar texto ES+EN cambia la voz (inglés más lento,
sin fluidez). Se quiere una voz natural en español que diga el inglés **con la
misma voz**.

**Solución:** modo `unified` (por defecto) con voces Multilingual (Ava/Emma mujer,
Andrew/Brian hombre). Una sola voz para todo el texto; sin segmentación ES/EN, sin
guías, sin frenado. El modo dos voces queda como opción `auto`. API acepta
`unified: true`.

**Deploy:** `dpl_BXHP9gGYRWjcSfkW37sxoBk9rpME` · Ready · https://jg-turbo.vercel.app (ver §11). Detalle completo en la sección «Nuevo en v2.7.0» al inicio de este documento.

---

### UI 2026-08-01 — Consola en franja horizontal (sin bump de motor)

- Layout compacto de `.tts-console` (ver §0).
- Motor permanece **2.6.3**.
- Deploy UI: `CD7GVazANst7gZCovnGZRrYAq1A3`.
- Relacionado UX: `CAMBIOS_UX.md` v3.2.

### v2.6.3 — Inglés correcto también con voz de hombre (2026-07-23/24)

**Pedido:** la mujer pronunciaba bien el inglés; el hombre no. Ambos deben sonar naturales en ES y correctos en EN.

**Causas halladas:**

1. Tech a veces se sintetizaba con **Gonzalo** (Dalia disimulaba mejor).  
2. `TTS_ES_SAFE` bloqueaba `app`, `code`, `web`, etc.  
3. Voz EN hombre **Guy** menos clara que Aria.  
4. Sin red de seguridad servidor si `language=es` por error.

**Cambios:**

| Pieza | Cambio |
|---|---|
| Detección | Catálogo EN antes de ES_SAFE; safe sin tech |
| `ttsPrepararTextoIngles` | Guías paritarias mujer/hombre |
| `ttsForzarIdiomaSiInglesPuro` | Force-EN en cliente |
| Servidor | `_tts_resolve_language` + `_tts_fragment_is_english` |
| Hombre EN | `en-US-AndrewNeural` (fallbacks Brian → Christopher → Guy) |
| Prosodia EN | Igual en ambos géneros; tono neutral en EN |

**Deploy:** `dpl_9bM9BvPz6dZVpDM17my4QYk19eZA` · Ready.

---

### v2.6.2 — Segmentación Node.js / listas + Guy (2026-07-23)

**Pedido:** voz hombre más natural en zona CO + inglés sin españolizar.

| Área | Cambio |
|---|---|
| Hombre ES | Gonzalo + rate ×0.97 + warm si neutral |
| Hombre EN | `en-US-GuyNeural` (luego superado por 2.6.3 → Andrew) |
| Oraciones | `ttsPartirOraciones` (protege puntos internos) |
| Listas | `ttsUnirConectoresIngles` multi-pasada |
| Puntuación | Comas se pegan al tramo, no crean ES falso |

**Deploy código:** `dpl_BmLE7rqcKCLyayt3zxJUD45reE8X` · **Docs:** `dpl_5kZPhJSMokc7L3zX1AZQbruTSWC3`.  
**Incidente:** deploy desde raíz monorepo → 404; corregido desde `vercel_deploy/`.

---

### v2.6.1 — Dalia + detección EN agresiva (2026-07-23)

- Mujer auto: `es-MX-DaliaNeural`.  
- Hombre: Gonzalo.  
- EN mujer: Aria. EN hombre: Andrew **Multilingual** (reemplazado después).  
- Catálogo tech amplio + glosario usuario.  
- Fragmentos EN cortos más despacio.

---

### v2.6 — TTS neural bilingüe base (2026-07-23)

Antes: un solo bloque = una sola voz española → “OpenAI” con fonética ES.

Introdujo: acentos CO/MX/AR/es-US, cambio de voz por fragmento, precarga, tono neural, `jg_tts_bilingual`, fix modal Configuración (Guardar clicable).

Deploys: primera `dpl_76zEf4gKK2k7GKBXs86jHgHgexqp` · preview `dpl_9Rd1G8LBeBhBgKoYxRfSwFgE8TbL` · era 2.6/2.6.1 `dpl_5vrrDCyMidWCGAT6174BpS9jVevv`.

---

### Anteriores

| Versión | Qué aportó |
|---|---|
| 2.5.1 | Consola más compacta en móvil |
| 2.5 | Neural Colombia + edge-tts + respaldo navegador |
| 2.4 | Prioridad voces LATAM del sistema; velocidad hasta 2× |
| 2.3 | `speechSynthesis` + preferencias básicas |

---

## 11. Registro de deploys TTS 2.6.x / 2.7.x

| Versión | Deployment | Estado | Notas |
|---|---|---|---|
| **2.7.0 (misma voz)** | **`dpl_BXHP9gGYRWjcSfkW37sxoBk9rpME`** | **Ready** | Modo unificado multilingüe por defecto (2026-08-09) |
| 2.6 | `dpl_76zEf4gKK2k7GKBXs86jHgHgexqp` | Ready | Primera bilingüe en prod |
| 2.6 preview | `dpl_9Rd1G8LBeBhBgKoYxRfSwFgE8TbL` | Ready | Vista previa |
| 2.6 / 2.6.1 | `dpl_5vrrDCyMidWCGAT6174BpS9jVevv` | Ready | Dalia + segmentación agresiva |
| 2.6.2 código | `dpl_BmLE7rqcKCLyayt3zxJUD45reE8X` | Ready | Gonzalo + Guy + fix Node.js/listas |
| 2.6.2 docs | `dpl_5kZPhJSMokc7L3zX1AZQbruTSWC3` | Ready | Docs sincronizadas |
| 2.6.2 fallido | `dpl_4dmNocNCdsWb4hMFf9zYkEyejthm` etc. | Ready pero 404 | Deploy desde raíz monorepo |
| **2.6.3 código** | **`dpl_9bM9BvPz6dZVpDM17my4QYk19eZA`** | **Ready** | Andrew + force-EN + prep paritaria |
| **2.6.3 docs** | **`dpl_8yQxRjdrSUi6RxNLcLDi21kh6kHP`** | **Ready** | Documentación maestra completa alineada |
| **UI franja TTS (motor 2.6.3)** | **`CD7GVazANst7gZCovnGZRrYAq1A3`** | **Ready** | Consola horizontal; más texto en editores (2026-08-01) |

> **Deploy 2.7.0:** `dpl_BXHP9gGYRWjcSfkW37sxoBk9rpME` · Ready · desplegado el
> 2026-08-09 desde `vercel_deploy/` (alias https://jg-turbo.vercel.app).
> Verificado en producción: catálogo `unified`, 3 casos unificados y 2 legados (ver §9.3).

Dominio estable: https://jg-turbo.vercel.app

---

## 12. Límites conocidos

- **Misma voz (`unified`):** acento español neutro-latino (las voces multilingües
  disponibles son en-US); el acento exacto MX/CO/AR solo aplica en «Dos voces».
- **Misma voz:** la pronunciación del inglés depende del modelo multilingüe (ya no
  hay guías `ttsPrepararTextoIngles` en este modo).
- Cambio de idioma **por fragmento**, no por sílaba (solo modo «Dos voces»).
- Palabra desconocida puede ir en ES hasta meterla al glosario o catálogo (solo «Dos voces»).
- Pausa corta al cambiar de voz o con red lenta (solo «Dos voces»).
- Neural necesita internet.
- Respaldo = voces instaladas en el dispositivo.
- `edge-tts` no es API oficial Azure; Microsoft puede cambiar voces.
- Conectores ES entre EN (`API de Whisper`) → tres tramos EN–ES–EN (intencional, solo «Dos voces»).
- Guías de pronunciación cubren marcas frecuentes; marcas raras pueden necesitar entrada nueva en `ttsPrepararTextoIngles` (solo «Dos voces»).

---

## 13. Mantenimiento y backlog

Antes de otra mejora TTS:

1. No renombrar `jg_tts_*` sin migración.  
2. Mantener fallbacks por idioma/género.  
3. Probar ES, EN, mixto (`Node.js`, listas con `y`, force-EN con `language=es` + tech).  
4. Probar mujer **y** hombre.  
5. Sync → deploy **solo** desde `vercel_deploy/`.  
6. Actualizar este documento (versión, dpl_, pruebas).  
7. Ctrl+F5 al validar en el navegador.

### Backlog sugerido

1. UI de glosario de pronunciación editable por el usuario.  
2. Descargar MP3 del audio generado.  
3. Resaltar el fragmento que se está leyendo.  
4. Comparar en un clic Gonzalo vs Jorge.  
5. Suavizar micro-pausas `EN + de/del + EN` si molestan.  
6. Proveedor premium opcional.

---

## 14. Decisiones de producto (resumen ejecutivo)

| Decisión | Motivo |
|---|---|
| **v2.7.0: «Misma voz» multilingüe por defecto** | **El usuario pidió fluidez y un solo timbre; la segmentación ES/EN sonaba robótica y lenta** |
| **Mujer unificada = Ava, hombre = Andrew (Multilingual)** | **Voces Edge que hablan ES fluido y dicen el EN en inglés sin cambiar de voz** |
| **Migrar `jg_tts_bilingual: auto` → `unified`** | **El modo antiguo era justo el que sonaba mal; se deja «Dos voces» para volver** |
| Hombre ES = Gonzalo (CO) | Zona del usuario; no se cambia por Jorge MX |
| Mujer ES auto = Dalia (MX) | Más natural que Salomé |
| Hombre EN = Andrew (no Multilingual, no Guy) | Paridad de claridad con Aria |
| Prep de pronunciación idéntica mujer/hombre | Que ambos digan igual de bien el inglés |
| Force-EN cliente + servidor | Nunca sintetizar tech puro con voz española |
| Deploy solo desde `vercel_deploy/` | Evitar 404 del monorepo raíz |
| No tocar claves `jg_*` | Preferencias del usuario sobreviven a deploys |
