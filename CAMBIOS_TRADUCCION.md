# Traducir · historial de cambios y operación

**Fecha de esta entrega:** 2026-08-01
**Estado:** en producción · https://jg-turbo.vercel.app
**Documento maestro del feature Traducir** (léelo antes de tocar `/api/translate`
o el troceo del frontend).

---

## Entrega 2026-08-24 · Español natural en YouTube

**Pedido:** ejecutar `PLAN_MEJORA_TRADUCCION_ES.md` para corregir traducciones literales, entrecortadas, sin tildes o sin concordancia en el flujo inglés → español de YouTube.

**Solución:**

- Nuevo prompt de traducción profesional a español neutro latinoamericano: reconstruye puntuación de subtítulos automáticos, traduce por unidades de sentido, evita calcos y conserva cifras, nombres y términos técnicos.
- Con una IA disponible, `/api/translate` siempre intenta IA primero; MyMemory queda únicamente como traducción básica de respaldo.
- El flujo YouTube → español envía el título, activa una segunda revisión lingüística tolerante a fallos y conserva la primera traducción si esa revisión falla.
- Los bloques internos mantienen continuidad con los últimos 300 caracteres y una lista breve de términos ya consolidados.
- El doblaje conserva todos los marcadores `[[JG_SEG_000000]]` en orden, reparte frases naturales dentro de los tiempos existentes y agrupa lotes por punto o pausa mayor a 0,6 s sin cambiar `startTime` ni `endTime`.
- La interfaz identifica el respaldo sin tecnicismos: «Traducción básica · agrega una clave de IA en Configuración para que el español suene natural».
- PWA renovada a `jg-turbo-shell-v32`. No se cambió ninguna clave `jg_*` ni la persistencia del navegador.
- La Fase 6 no cambia el modelo por defecto: el plan la marca como `[DATO PENDIENTE]` hasta confirmar modelos habilitados y costo.

**Pruebas locales:**

- `python -m pytest backend/tests -q` → **113 passed, 2 skipped**.
- `python -m pytest backend/tests/test_traducir_largo.py tests/test_calidad_traduccion.py -q` → **15 passed**.
- `node tests/test_youtube_sync.mjs` → **ok**; protege marcadores, tiempos y lotes por pausas naturales.
- `python ../test_js_syntax.py` + `python -m py_compile api/index.py` → **ok**.
- Una sola llamada directa a `/api/translate`, dentro de `jgPedirTraduccion`; el troceo del navegador sigue activo.

**Producción:**

- Deployment de código: `dpl_Gn4T52apiEYLJjjvHbyQe8m8Ch5J` · **Ready** · alias `https://jg-turbo.vercel.app`.
- HTML real contiene `Traduciendo con español natural`, `titulo_video`, `revisar: true` y el aviso de traducción básica; SW real `jg-turbo-shell-v32`.
- `/api/health`: `status: ok`, `ia_configured: true`, proveedor servidor `mistral`, `youtube_auto: true`.
- Caso corto real: `ia_used: true`, `revisado: true`, integridad `ok`, 1,54 s; eliminó los calcos y conservó `Acme`, `16`, `API` y `PowerPoint` (la cifra se escribió correctamente como «dieciséis»).
- Corpus real largo: 22.236 caracteres en 6 peticiones de 2.420–3.996 caracteres; 6/6 con IA y revisión, ninguna vacía, tiempos entre 7,89 y 16,64 s, muy por debajo del límite de 45 s.
- Doblaje real: marcadores `[[JG_SEG_000000]]` y `[[JG_SEG_000001]]` salieron 1:1 y en orden; `startTime`/`endTime` permanecen inmutables por contrato y prueba automática.
- Una entrada sintética que repetía la misma oración cientos de veces fue resumida por el modelo y la API la rechazó como incompleta; se conserva esa protección en vez de aceptar silenciosamente pérdida de contenido.

---

## 1. Resumen ejecutivo

### Problema reportado

> «Le agregué un texto largo que viene de YouTube en inglés. Y da mucha vuelta
> para traducir. Al final dice que no se logró la traducción.»

Dos agentes anteriores lo intentaron sin resolverlo.

### Las dos causas (son distintas, y por eso costó)

1. **La traducción moría por tiempo, no por tamaño.** Vercel corta la función a
   los **60 segundos**. Traducir de una sola vez tarda en proporción al texto, así
   que **siempre** existe un largo que no llega. Medido: 39 732 caracteres →
   `HTTP 504 FUNCTION_INVOCATION_TIMEOUT` a los **60,4 s**, con cero texto devuelto.
   Peor aún: el navegador esperaba hasta 3 minutos, así que el usuario veía la app
   «dando vueltas» un minuto entero antes del error.

2. **El validador daba falsas alarmas.** Aunque la traducción saliera perfecta,
   marcaba `alert` con «Integridad 6/100» y lanzaba un `window.confirm`
   preguntando si usar la traducción «de todos modos». Parecía un fallo. No lo era.

### Qué se hizo

| Área | Cambio |
|---|---|
| Frontend | El navegador **trocea** el texto y hace varias peticiones cortas. Deja de existir un tamaño máximo |
| Frontend | Progreso real en el botón: «Traduciendo… 3 de 7» |
| Frontend | Reintento automático de un bloque ante fallo pasajero (504/502/red) |
| API | `prefer_fast: false` por fin se respeta: antes se ignoraba pasando de 1200 caracteres |
| Validador | Deja de acusar de inventar cifras cuando la traducción es correcta |
| Pruebas | `test_traducir_largo.py` (8) y `test_validacion_cifras.py` (6), con texto real de producción |

---

## 2. Diagnóstico (medido contra producción, 2026-08-01)

Todas las medidas contra `https://jg-turbo.vercel.app`, no en local.

| Texto | HTTP | Tiempo | Resultado |
|---|---|---|---|
| 1 000 caracteres | 200 | 2,8 s | Traducción correcta |
| 4 000 caracteres | 200 | 4,1 s | Correcta, pero vía MyMemory (`ia_used: false`) |
| 17 574 caracteres | 200 | **49,5 s** | Correcta, al borde del límite |
| 22 156 caracteres | 200 | **56,0 s** | Correcta, al borde del límite |
| **39 732 caracteres** | **504** | **60,4 s** | **`FUNCTION_INVOCATION_TIMEOUT` · nada de texto** |

La progresión es lineal (~350 caracteres por segundo): no hay un tamaño «malo»,
hay un **tiempo** máximo. Subir `maxDuration` solo movería el techo más arriba;
no resuelve «cualquier cantidad de texto».

### Por qué el navegador esperaba tanto

`traducirTranscripcionDetallada` usaba `timeoutMs = 180000` (3 minutos) para
textos de 4 000+ caracteres. El servidor ya estaba muerto a los 60 s, pero el
navegador seguía esperando. De ahí la sensación de «da mucha vuelta».

---

## 3. Arquitectura nueva

### 3.1 El troceo vive en el navegador

```
texto de 39 732 caracteres
        │
        ▼
jgTrocearParaTraducir()          párrafos → frases → palabras
        │                        (nunca corta a mitad de palabra)
        ▼
7 bloques de ≤ 6 000 caracteres
        │
        ▼
jgMapaConLimite(2 en paralelo)   cada bloque: POST /api/translate
        │                        12-25 s · muy lejos del límite de 60 s
        ▼
se unen en orden  →  texto completo
```

**Por qué en el navegador y no en el servidor:** el navegador no tiene límite de
tiempo. Cada petición individual es corta, así que el tamaño total deja de
importar: 100 páginas son 30 peticiones de 3 segundos.

### 3.2 Funciones nuevas (`index.html`)

| Función | Qué hace |
|---|---|
| `TRAD_MAX_CHARS_POR_PETICION = 6000` | Tamaño de bloque. Medido: ~17 s por bloque, margen amplio |
| `TRAD_PETICIONES_EN_PARALELO = 2` | Concurrencia. Más rápido sin castigar al proveedor de IA |
| `jgUnidadesDeTexto(texto, max)` | Parte por párrafos → frases → palabras → corte bruto |
| `jgTrocearParaTraducir(texto)` | Agrupa unidades en bloques lo más grandes posible |
| `jgMapaConLimite(items, n, tarea)` | Pool de concurrencia que conserva el orden |
| `jgPeorValidacion(a, b)` | De todos los bloques se queda con el veredicto más severo |
| `jgPedirTraduccion(cuerpo, ms)` | Una petición con **un reintento** ante 504/502/red |

El corte bruto es el último recurso: una «palabra» más larga que el bloque (una
URL enorme, texto pegado sin espacios). Se descubrió porque una prueba falló con
una palabra de 30 000 caracteres.

### 3.3 Cambio en la API

`TranslateRequest.prefer_fast` pasa de `bool = False` a `Optional[bool] = None`:

| Valor | Comportamiento |
|---|---|
| `True` | MyMemory primero (rápido) |
| `False` | **IA primero (calidad)** — antes se ignoraba pasando de 1200 caracteres |
| Ausente | Lo decide el tamaño (como siempre) |

El bug: `usar_rapido_primero = bool(req.prefer_fast) or len(txt) >= 1200`. Ese
`or` hacía que **toda transcripción larga saliera por MyMemory** aunque se pidiera
calidad. Por eso un texto de 4 000 caracteres devolvía `ia_used: false`.

Como ahora el navegador trocea, los bloques se piden con `prefer_fast: false`:
cada uno es corto, así que puede permitirse la IA.

---

## 4. El validador de cifras (falsas alarmas)

### 4.1 Qué se veía

Traduciendo una charla real, dos de siete bloques daban:

```
alert · Integridad 6/100
  [critical] missing_numbers:  Faltan una o más cifras del texto original.
  [critical] invented_numbers: Aparecieron cifras que no existen en el original.
```

Las dos a la vez, sobre el **mismo** bloque, cuyo original y traducción tenían
exactamente los mismos números (`16`, `6`, `60`). Contradictorio: era un bug.

### 4.2 Los dos casos reales

| Caso | Original | Traducción | Por qué fallaba |
|---|---|---|---|
| Número partido por el subtítulo | `every 16.\n\n6\nmilliseconds` | `cada 16.6 milisegundos` | El subtítulo parte `16.6` en dos líneas. El validador leía **dos** cifras (`16` y `6`); la traducción, correctamente, las une en una (`16.6`), que parecía inventada |
| Década reformulada | `in the 1930s` | `en los años 30` | `_RE_NUMERO` termina en `(?!\w)`, así que **no ve** `1930s` (lleva una letra pegada). En cambio sí ve el `30` español → «cifra inventada» |

Ambas traducciones eran **correctas**. El validador era el equivocado.

### 4.3 El arreglo

Una cifra solo se denuncia si **sus dígitos no aparecen en el otro texto**
(`_huella_digitos` + `_cifras_sin_respaldo` en `api/calidad_linguistica.py`):

- `16.6` → dígitos `166`; el original contiene `16` y `6` → respaldada ✓
- `30` → el original contiene `1930` → respaldada ✓
- Un `45 %` que no existía en ningún lado → **sigue saltando** ✗

La red de seguridad se conserva: lo que se relaja es solo el caso en que los
dígitos ya estaban, que es exactamente la reformulación legítima al traducir.

> El validador vive duplicado en `api/calidad_linguistica.py` (producción) y
> `backend/calidad_linguistica.py` (local). **Mantener las dos copias iguales.**

---

## 5. Pruebas

### 5.1 Automáticas

| Archivo | Qué cubre |
|---|---|
| `backend/tests/test_traducir_largo.py` | Que `prefer_fast` se respete; que el troceo **no pierda ni un carácter** (se ejecuta el JS real en Node); que 39 732 caracteres se repartan en ≥7 bloques de ≤6 000 |
| `backend/tests/test_validacion_cifras.py` | Los dos casos reales ya no dan falsa alarma; una cifra inventada de verdad sigue saltando |
| `backend/tests/datos/traduccion_falsas_alarmas.json` | Texto real capturado de producción |

**Una prueba encontró un bug real durante el desarrollo:** una «palabra» de
30 000 caracteres sin espacios no se troceaba y habría vuelto a dar 504. De ahí
salió el corte bruto como último recurso.

### 5.2 En producción (el caso que fallaba)

Mismo texto de 39 732 caracteres (7 277 palabras), troceado con las funciones
reales del `index.html`:

| Bloque | HTTP | Tiempo |
|---|---|---|
| 0 | 200 | 24,4 s |
| 1 | 200 | 13,1 s |
| 2 | 200 | 12,6 s |
| 3 | 200 | 12,6 s |
| 4 | 200 | 13,0 s |
| 5 | 200 | 12,0 s |
| 6 | 200 | 11,6 s |

- **Antes:** `504` a los 60,4 s · **0 palabras**
- **Ahora:** `200` en los 7 bloques · **7 227 de 7 277 palabras (99,3 %)** · 63 s totales
- Ningún bloque vacío · el texto empieza y termina donde debe · sin mezcla de
  idiomas (2 palabras «inglesas» residuales, todas nombres propios)
- Ningún bloque individual pasa de 25 s: el margen contra el límite de 60 s es amplio

### 5.3 Falsas alarmas: antes y después (mismos bloques, producción)

| Bloque | Antes | Después |
|---|---|---|
| 3 | `alert` · **6/100** · popup de confirmación · `missing_numbers` + `invented_numbers` | `warning` · **88/100** · sin popup · solo `technical_terms` |
| 6 | `alert` · **41/100** · popup de confirmación · `invented_numbers` | `warning` · **76/100** · sin popup · `technical_terms`, `paragraphs` |

Las cifras dejaron de denunciarse; los avisos que quedan son informativos y no
interrumpen al usuario.

### 5.4 Checklist post-deploy ejecutado (2026-08-01)

| Comprobación | Resultado |
|---|---|
| `https://jg-turbo.vercel.app` | HTTP 200 · 500 964 bytes |
| `jgTrocearParaTraducir`, `TRAD_MAX_CHARS_POR_PETICION`, `jgMapaConLimite`, `jgPedirTraduccion`, «Traduciendo… » | presentes en el HTML servido |
| `sw.js` | `jg-turbo-shell-v10` |
| `GET /api/health` | `status: ok` · `youtube_auto: true` |
| `POST /api/translate` (corto) | «Buenos días, esta es una prueba breve.» |
| `POST /api/youtube` | 200 · 4,3 s (sin regresión) |
| `GET /api/tts-voices` | `es-CO-GonzaloNeural` (sin regresión) |
| Suite de pruebas | **69 passed, 2 skipped, 0 failed** |

---

## 5.5 El arreglo se quedó a medias: había DOS caminos de traducción

**Reportado por el usuario después del primer despliegue:** «sigue apareciendo
error en un servidor, error en la traducción».

### Qué se comprobó primero (todo estaba bien)

| Comprobación | Resultado |
|---|---|
| `/api/ping`, `/api/health`, `/api/session-config` | 200 |
| Traducción es↔en, acentos, emojis | 200, correcta |
| Sintaxis del JS **servido por producción** (`node --check`) | válida |
| Troceo presente en producción | sí |
| Flujo troceado contra producción, 80 368 caracteres | **14 bloques, 0 fallos, 105 s** |
| Local ↔ `vercel_deploy` ↔ producción | mismo tamaño, sin conflicto entre agentes |

### La causa real: código duplicado

El primer arreglo tocó `traducirTranscripcionDetallada`, que usa el botón
**Traducir** del panel de resultados. Pero **el panel Traducir dedicado**
(`btnTransTranslate`: pegar texto → «Traducir ahora») —el que usa el usuario—
tenía **su propia llamada** a la API:

```js
// ANTES (index.html, handler de btnTransTranslate)
const timeoutTrad = txt.length >= 4000 ? 180000 : 120000;
const resp = await fetchApi('/translate', { … body: JSON.stringify({ text: txt, … }) }, timeoutTrad);
if (!resp.ok) {
  const err = await resp.json().catch(() => ({ detail: 'Error en la traducción del servidor' }));
  throw new Error(extraerDetalleError(err, resp.statusText));
}
```

Tres cosas encajan con lo reportado:

1. Mandaba **el texto entero** → moría contra el límite de 60 s.
2. Esperaba **hasta 3 minutos** → «da mucha vuelta».
3. Un `504` devuelve **HTML**, así que `resp.json()` fallaba y se usaba el
   fallback: **«Error en la traducción del servidor»** — literalmente el mensaje
   que veía el usuario.

### El arreglo

El panel ahora llama a `traducirTranscripcionDetallada`, igual que el resto:
**una sola puerta a `/api/translate`**, la que trocea. Se eliminó la llamada
duplicada y se añadió progreso por bloque en la barra y en el botón.

### La prueba que impide que se repita

`test_ningun_camino_llama_a_translate_saltandose_el_troceo` cuenta las llamadas
directas a `/translate` en `index.html` y **exige que haya exactamente una**, la
de `jgPedirTraduccion`. Si alguien vuelve a añadir un camino propio, la prueba
falla antes de llegar a producción.

### Verificado con el código real de producción

Extrayendo `traducirTranscripcionDetallada` del HTML que sirve
`https://jg-turbo.vercel.app` y ejecutándolo contra la API real:

```
PANEL TRADUCIR - texto pegado: 80 368 caracteres
   Traduciendo bloque 1 de 14 … 14 de 14
RESULTADO: 85 409 caracteres | bloques=14 | ia_used=true | 104s
validacion: warning 76 popup=false
```

Texto completo de principio a fin, sin popup y con progreso visible.

---

## 5.6 Segunda pasada al validador: silenciar el ruido (2026-08-01)

**Reportado:** «⚠ Anomalía · Integridad 53/100. Faltan una o más cifras del texto
original. Cambió o desapareció al menos un nombre o término técnico.»

### Qué estaba disparando los avisos

Se corrió el validador sobre los siete bloques de una charla real ya traducida
correctamente, listando **qué elemento concreto** denunciaba cada aviso:

| Bloque | Reportaba | Realidad |
|---|---|---|
| 0 | falta `us`; sobran `andyet`, `ee.uu`, `console.log`×2, `printsquare`×4 | `US` → `EE. UU.` es correcto; `console.log` está en ambos, solo cambió **cuántas veces** |
| 1 | falta `uis`; sobran `console.log`, `foo.com` | `UIs` → «interfaces» es correcto |
| 3 | falta `ui`; sobran `settimeout`, `console.log`×2 | ídem |
| 4 | faltan `is`, `ok`; sobra `es` | `IS` y `OK` son **palabras corrientes** en mayúsculas, no siglas |
| 5 | faltan `ma`, `ba`, `phd`; sobra `xix` | títulos académicos y números romanos: se traducen |
| 6 | falta `adhd`×2; sobra `tdah`×2 | `ADHD` → **`TDAH`** es la traducción correcta |

**Ninguno era un error de traducción.** Cuatro causas de raíz:

1. Se comparaba por **cantidad** en vez de por **presencia**.
2. Las **siglas de dos letras** (`IS`, `OK`, `US`, `UI`, `MA`, `BA`) son palabras
   corrientes en mayúsculas.
3. No se reconocían las **siglas equivalentes** entre idiomas.
4. Las cifras escritas **con palabras** (`16` → «dieciséis») contaban como perdidas.

Y `paragraphs` saltaba casi siempre: traducir reagrupa los párrafos, y una
transcripción llega con saltos de línea del subtítulo, no del texto.

### Cambios en `api/calidad_linguistica.py`

| Función | Regla |
|---|---|
| `_terminos_realmente_perdidos` | Presencia, no cantidad · ignora siglas de <3 letras · reconoce equivalentes |
| `_SIGLAS_EQUIVALENTES` | `ADHD↔TDAH`, `US↔EE.UU.`, `UN↔ONU`, `WHO↔OMS`, `HIV↔VIH`, `AI↔IA`, `EU↔UE`, `NATO↔OTAN`, `PhD`, `UI`, `CEO`, `ID` |
| `_NUMEROS_EN_PALABRAS` + `_cifra_escrita_en_palabras` | `16` ↔ «dieciséis» / «sixteen» en ambos sentidos |
| `_cifras_realmente_perdidas` | Une la huella de dígitos (§4.3) con los números escritos |
| `paragraphs` | Solo avisa si se pierde **la mitad o más** de los párrafos, y con más de 3 |
| `_listar` | Los avisos ahora **nombran** el elemento: «Falta la cifra 782» en vez de «faltan una o más cifras» |

### Resultado medido

Mismos siete bloques, contra producción:

| Bloque | Antes | Después |
|---|---|---|
| 0 | `warning` 88 | **`ok` 100** · sin avisos |
| 1 | `warning` 76 | **`ok` 100** · sin avisos |
| 2 | `warning` 88 | **`ok` 100** · sin avisos |
| 3 | `warning` 76 | **`ok` 100** · sin avisos |
| 4 | `warning` 76 | **`ok` 100** · sin avisos |
| 5 | `warning` 88 | **`ok` 100** · sin avisos |
| 6 | `warning` 76 | **`ok` 100** · sin avisos |

### La red de seguridad sigue en pie

Relajar un validador es fácil; el riesgo es dejarlo inútil. Hay pruebas que
**exigen** que siga detectando:

- una cifra inventada («creció un 45 %» sin `45` en el original) → `alert`
- una cifra perdida de verdad (`782 cases` → «muchos casos») → `alert`, y el
  aviso **dice 782**
- un término técnico realmente ausente (`Node.js`, `PostgreSQL`) → `warning`
- una traducción a medias → `possible_omission`
- un texto que no se tradujo → `unchanged`

`backend/tests/test_validacion_cifras.py`: **17 pruebas**.

---

## 6. Límites honestos

- **El tamaño ya no es un límite**, pero el tiempo total sí crece: ~10 s por cada
  6 000 caracteres, con 2 bloques en paralelo. Una charla de una hora tarda un par
  de minutos, con progreso visible. No se cuelga, pero no es instantáneo.
- `TranslateRequest` mantiene `max_length=50000` **por petición**. Con el troceo
  no se alcanza desde la interfaz; quien llame a la API directamente con más de
  50 000 caracteres de golpe seguirá recibiendo un 422.
- La calidad depende del proveedor de IA configurado (hoy Mistral en el servidor).
  Sin clave de IA, la traducción cae a MyMemory, que es peor en textos largos.

---

## 7. Registro de releases

| Fecha | Qué | Producción |
|---|---|---|
| 2026-07-31 | Traducción completa sin mezcla EN+ES (ver `CAMBIOS_YOUTUBE.md` §11) | histórico |
| 2026-08-01 | **Troceo en el navegador** · `prefer_fast` respetado · validador de cifras sin falsas alarmas · SW v10 | `dpl_5mJwhnH66KFv2D2gWh4sNsczBB9g` · READY · 46 archivos |
| 2026-08-01 (fix) | **El panel Traducir también usa el troceo** (tenía su propia llamada duplicada) · progreso por bloque · SW v11 | `dpl_7J7FW21Cg8HwdsNs5311Wk7mFpby` · READY · 46 archivos |
| 2026-08-01 (ruido) | **Validador sin falsas anomalías**: siglas equivalentes, números en palabras, presencia en vez de cantidad, avisos que nombran el elemento | `dpl_749HdeS4Qh2mgt3hRM8nJVDCrTqs` · READY · 47 archivos |

---

## 8. Despliegue

Procedimiento obligatorio en `DOCUMENTACION_DESPLIEGUE.md`: sincronizar a
`vercel_deploy/` y desplegar **solo** esa carpeta al proyecto `jg-turbo`, nunca
desde la raíz del monorepo.

Archivos de esta entrega:

```
index.html                   (troceo + progreso + reintento)
sw.js                        (CACHE_SHELL → jg-turbo-shell-v10)
api/index.py                 (prefer_fast opcional)
api/calidad_linguistica.py   (cifras con respaldo)
backend/calidad_linguistica.py  (misma copia, alineada)
```

### Checklist post-deploy

1. `https://jg-turbo.vercel.app` responde 200.
2. El HTML servido contiene `jgTrocearParaTraducir` y `TRAD_MAX_CHARS_POR_PETICION`.
3. `sw.js` → `jg-turbo-shell-v10`.
4. `POST /api/translate` con un texto corto responde 200.
5. En ventana privada: pegar una transcripción larga → **Traducir** → el botón
   muestra «Traduciendo… N de M» y el texto llega completo.
6. Sin regresiones: `/api/health`, `/api/youtube`, `/api/tts-voices`.


---

## 10. Correcciones de la revisión del 2026-08-24

Revisión posterior a la entrega de las 7 fases. Todo lo de abajo se midió contra
`https://jg-turbo.vercel.app`, no en local.

### 10.1 El doblaje perdía segmentos en silencio (lo grave)

Se mandaron 8 segmentos con marcadores y se repitió la prueba 6 veces: **3 de 6
perdieron los dos últimos segmentos**. Los 8 marcadores volvían siempre, así que
`_validar_marcadores_segmento()` los daba por buenos — contaba marcadores, no
contenido. El audio doblado se quedaba corto y desfasado.

Causa: la regla del modo literal decía «reparte el resultado entre los
marcadores». Al repartir, la IA gastaba los marcadores antes de llegar al final.

| Arreglo | Dónde |
|---|---|
| El texto de un marcador es la traducción DE ESE segmento; solo se puede pasar una palabra al vecino | `api/index.py` · `_prompt_traducir_bloque`, modo literal |
| Regla explícita «PROHIBIDO terminar antes de tiempo» + repaso final antes de responder | idem |
| Detector por longitud: si el lote vuelve con menos del 85 % del texto, se rechaza | `js/youtube/translationService.js` · `conservaElContenido()` |
| Dos intentos por lote antes de bajar a traducir segmento a segmento | idem · `pedirLote()` |

Umbral medido sobre las 6 traducciones: las correctas dieron 1,016 · 1,064 ·
1,016; las que perdieron segmentos, 0,769 · 0,804 · 0,785. **0,85 queda en medio.**

Resultado tras el arreglo, misma prueba: **5 de 6 completas** (proporciones 0,885
a 0,952) y 1 rechazada con error claro, que el frontend reintenta y, si insiste,
resuelve por el respaldo segmento a segmento. El fallo silencioso pasó a ser
fallo detectado.

### 10.2 Salía voseo argentino

«tenés», «podés» en 3 de 6 muestras. La regla decía «conserva el tratamiento del
original (tú, usted o vos)», pero el inglés `you` no marca tratamiento, así que
el modelo elegía libre. Ahora `_REGLAS_ES` prohíbe el voseo **nombrando cada
forma** (vos, tenés, podés, querés, sabés, sos…), que es la técnica que ya
funcionaba con los calcos. Tras el arreglo: **0 de 6**.

### 10.3 Alerta falsa de integridad

`«return two hundred»` → `«devuelve 200»` es correcto, pero la interfaz mostraba
«⚠ Anomalía · Integridad 65/100». `_NUMEROS_EN_PALABRAS` tenía `100` y `1000`
pero ninguna centena. Añadidas 200 a 900 en `api/calidad_linguistica.py`.
Verificado en producción: `ok · 100`, sin avisos.

### 10.4 Lotes que degeneraban

Cortar el lote en cada pausa parecía buena idea, pero en un video con un silencio
entre cada subtítulo daba **un lote por segmento**: la IA traducía media frase
suelta (justo lo que la fase 3 quería evitar) y salían tantas llamadas como
segmentos. Medido con 150 segmentos: 150 lotes. Ahora una pausa solo cierra el
lote si ya hay 3 segmentos o 350 caracteres dentro → **50 lotes**, mínimo 3
segmentos cada uno.

### 10.5 Detalles

- **El `model` mentía**: toda traducción se reportaba como `gemini-2.0-flash`
  aunque respondiera Mistral. Nuevo `_modelo_de_proveedor()`. En producción ya
  devuelve `mistral-small-latest`.
- **Markdown en la salida**: la IA colaba `*cursivas*` pese a pedirle texto
  plano. `_sin_enfasis_markdown()` las quita sin tocar un `2 * 3` ni los
  marcadores del doblaje.
- **Código muerto**: `TRADUCIR_RAPIDO_CHARS` eliminado; los 7 `preferFast` del
  frontend, eliminados. `prefer_fast` se conserva en el modelo, marcado como
  obsoleto, para que un navegador con el HTML viejo en caché no reciba un error.

### 10.6 Estado

- **117 pruebas** (antes 113) + `tests/test_youtube_sync.mjs`.
- Nuevas: voseo, modelo por proveedor, markdown, centenas, mínimo de lote,
  rechazo de lote incompleto con reintento.
- Desplegado: `dpl_uXx4NTTuxKiKpoHsfEco5RAsDNn9` · SW `v33`.
- **Pendiente a propósito:** fase 6 (`GEMINI_MODEL`), marcada `[DATO PENDIENTE]`
  en el plan porque decidirla cuesta dinero.

---

## 9. Enlaces

| Recurso | Ruta |
|---|---|
| YouTube (de dónde salen los textos largos) | `CAMBIOS_YOUTUBE.md` |
| Despliegue | `DOCUMENTACION_DESPLIEGUE.md` |
| Manual de uso | `FICHA_TECNICA.md` |
| Lectura en voz alta | `CAMBIOS_TTS.md` |
| Coordinación multi-agente | `../COORDINACION_AGENTES.md` |
