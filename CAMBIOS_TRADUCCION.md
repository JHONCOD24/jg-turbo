# Traducir · historial de cambios y operación

**Fecha de esta entrega:** 2026-08-01
**Estado:** en producción · https://jg-turbo.vercel.app
**Documento maestro del feature Traducir** (léelo antes de tocar `/api/translate`
o el troceo del frontend).

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

## 9. Enlaces

| Recurso | Ruta |
|---|---|
| YouTube (de dónde salen los textos largos) | `CAMBIOS_YOUTUBE.md` |
| Despliegue | `DOCUMENTACION_DESPLIEGUE.md` |
| Manual de uso | `FICHA_TECNICA.md` |
| Lectura en voz alta | `CAMBIOS_TTS.md` |
| Coordinación multi-agente | `../COORDINACION_AGENTES.md` |
