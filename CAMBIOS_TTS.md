# Lectura en voz alta (TTS) — JG Turbo

**Documento maestro** del módulo texto a voz. Aquí queda registrado: qué hace el sistema, cómo funciona, qué se cambió en cada versión, por qué, cómo se prueba, cómo se despliega y dónde está el código.

| Campo | Valor |
|---|---|
| **Versión app** | **2.24.0** (18 voces Fish agrupadas por idioma y género · 2026-08-19) · SW `jg-turbo-shell-v31` |
| **Versión motor** | **2.16.3** (18 voces Fish · español/inglés × femeninas/masculinas) |
| **UI consola** | **compacta horizontal · 2026-08-01** (ver §0 y `CAMBIOS_UX.md` v3.2) |
| **Fecha UI** | 2026-08-01 |
| **Producción** | https://jg-turbo.vercel.app |
| **Deploy UI franja TTS** | `CD7GVazANst7gZCovnGZRrYAq1A3` · Ready (alias jg-turbo) |
| **Deploy código 2.7.0 (motor)** | `dpl_BXHP9gGYRWjcSfkW37sxoBk9rpME` · Ready |
| **Deploy código 2.9.0 (motor)** | `dpl_6y86RK1e9XNkacbkGEdrmXAYQwic` · Ready · production |
| **Deploy código 2.10.0 (motor)** | `dpl_8S22tkseGhuyC9LcMJoqN9pCikzW` · Ready · production |
| **Motor** | Azure → Fish (solo textos propios) → `edge-tts`. Sin claves, todo por `edge-tts` |
| **Respaldo** | `edge-tts` → `speechSynthesis` del navegador |
| **Consola del navegador** | `JG Turbo v2.24.0 · Fish Audio por idioma y género · 18 voces` |

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

## Retiro v2.29.0 · Salen las voces regionales y 10 de Fish (vienen reemplazos) (2026-09-03)

**Pedido:** eliminar de la biblioteca: neural-recomendado, Colombia (Salomé/Gonzalo), México (Dalia/Jorge), Argentina (Elena/Tomás), Chile (Catalina/Lorenzo), Perú (Camila/Alex), Latino EEUU (Paloma/Alonso), Fish Robin/Chica/Nagi/Locutor K/Narrador/Loquendo y las 4 inglesas de Fish (Sarah, Paula, Adrian, Ethan). Quedan: Fish en español (Narradora, Colombiana, Latina, Voz A, Valentino, Sabio, Terror, Leonardo), neural multilingüe (Ava/Andrew) y navegador. **Sin desplegar** (pedido expreso: hay trabajo ajeno sin commitear en el árbol).

**Cambios (`index.html`, rama `feat-quitar-voces`):**
1. `TTS_NEURAL_ACCENTS = []`: ningún acento regional en ningún listado. Las tablas (`TTS_ACCENT_LABELS`, `TTS_NOMBRES_NEURAL`) se conservan para que las preferencias ya guardadas (`neural:es-CO:female`, etc.) sigan sonando hasta que lleguen las voces nuevas.
2. `TTS_FISH_CATALOGO_LOCAL` sin las 10 retiradas + `TTS_FISH_RETIRADAS`/`TTS_FISH_EQUIVALENTES`: `ttsFishLista()` las filtra aunque el servidor las mande; `ttsFishPorId()` redirige (`nico-robin`→narradora, `locutor-k`/`narrador`/`loquendo`→valentino, `female`→narradora, `male`→valentino, inglesas→null). Fallbacks (`ttsNombreFish`, `ttsParseVoz`, `ttsClaveVoz`, guardados) apuntan a Narradora/Valentino.
3. Selector de acento de Configuración sin opciones y escondido (`settingsTtsAccentBox` + condición en `ttsSincronizarConfigVoz`); «Quién lee» muestra Femenina/Masculina genérico sin acentos.
4. Detección de género del navegador (`TTS_FEMALE_RE/MALE_RE`) y resolución del servidor intactas: lo guardado sigue funcionando.

**Pruebas:** nuevo `tests/test_tts_voces_biblioteca.mjs` ✔ 29/29 (extrae las funciones reales del HTML: ausencias, conservadas, filtro con lista de servidor simulada, redirecciones). Regresión ✔: `test_tts_narracion`, `test_pdf_voz`, `test_pdf_{ancla,progreso,limpieza,sincronizacion,auditoria_p0,pulido_troceo,traduccion}`.

**Pendiente:** agregar las voces de reemplazo y (entonces) migrar `jg_tts_voice`/`jg_tts_locale` guardados.

---

## Nuevo en v2.25.0 · Optimización TTS para Lector PDF y Móviles/Tablets (2026-09-01)

**Pedido:** Resolver pausas excesivas, prosodia robótica e incoherencias de puntuación al escuchar audiolibros o documentos PDF en móviles y tablets.

**Causas técnicas detectadas y corregidas:**
1. **Eliminación de doble pausa por párrafo:** `prepararParaVoz()` inyectaba un punto al final de cada párrafo (`\n\n`) y luego `ttsNormalizarTextoNarracion()` convertía los saltos dobles en otro punto, produciendo secuencias `. . ` que generaban caídas tonales dobles con pausas antinaturales en el sintetizador Edge TTS.
2. **Desactivación de conversión numérica redundante en voces neurales:** Edge TTS ya maneja números, fechas y porcentajes con entonación nativa en español. La conversión manual a palabras inflaba los textos (hasta $\times 6.5$), causando troceo innecesario en múltiples fragmentos de audio y pausas de recarga. Ahora la conversión numérica se reserva exclusivamente para el motor fallback del navegador (`speechSynthesis`).
3. **Modo multilingüe unificado (`unified`) forzado en PDF:** En documentos extensos se evita la segmentación bilingüe agresiva (que dividía una oración en fragmentos español/inglés con peticiones HTTP separadas y voces distintas), garantizando narración continua sin pausas a mitad de frase.
4. **Mayor tolerancia de espera para texto pulido:** Se amplió a 3.000 ms la espera al pulido con IA para leer siempre la versión con puntuación y entonación optimizada.

**Pruebas:** `test_pdf_pulido_mecanico.mjs` (100% pasando), `verificar_pdf_navegador.mjs` (100% pasando), `verificar_pdf_geometria.mjs` (100% pasando).

**Deploy:** `dpl_FFW1CxUoWCjYT8jPD1SSE4dU3MX9` · `READY` · alias `https://jg-turbo.vercel.app` · Service Worker `jg-turbo-shell-v49`.

---

## Nuevo en v2.24.0 · 4 voces más y listado Fish por idioma y género (2026-08-19)

**Pedido:** agregar estas 4 voces de Fish Audio y separar el listado por
voces en inglés, voces en español, femeninas y masculinas.

- `867d389fc01f4310bc381ff9429e6052`
- `f765b445ca784776b1d444bd5f418050`
- `13d17017d63340a0b9751ffb04561c8d`
- `b8a36bb02e7f41c1b75a2909bbb04393`

**Qué se hizo:** las fichas se comprobaron contra `GET /model/{id}` (públicas,
`trained`, en español, sin aviso DMCA). Entran al catálogo con un nombre corto
y su idioma. El desplegable junto a *Escuchar* y «Quién lee» en Configuración
ya no mezclan todo en un saco: hay **cuatro grupos Fish**.

| Grupo | Voces |
|---|---|
| Fish Audio · español · femeninas | Nico Robin, Narradora, Chica, Nagi, Colombiana, **Latina**, **Voz A** |
| Fish Audio · español · masculinas | Locutor K, Narrador, Loquendo, Valentino, Sabio, **Terror**, **Leonardo** |
| Fish Audio · inglés · femeninas | Sarah, Paula |
| Fish Audio · inglés · masculinas | Adrian, Ethan |

| Nombre en la app | Ficha en Fish | Género | Idioma | Uso público (aprox.) |
|---|---|---|---|---|
| **Terror** | voz nicho de terror | hombre | español | 7 700 |
| **Leonardo** | Leonardo Dicaprio | hombre | español | 15 000 |
| **Latina** | Mujer latina | mujer | español | 8 700 |
| **Voz A** | MUJER VOZ A | mujer | español | 400 |

No se toca `jg_tts_voice`. Quedan 18 voces (14 en español, 4 en inglés).
Service Worker **`jg-turbo-shell-v31`**. El motor `s2.1-pro-free` sigue
pudiendo leer cualquier idioma con cualquiera de las fichas; el grupo solo
ordena el listado según el idioma de la ficha en Fish.

**Pruebas:** `node tests/test_tts_voces_fish.js` ·
`pytest backend/tests/test_tts_voces_fish.py` · `node tests/test_tts_descarga.js`
· `node tests/test_espaciado_texto_pegado.js` ·
`node tests/test_tts_configuracion.js` · `node tests/test_tts_tiempo_velocidad.js`.
Síntesis corta en Fish con texto en español: Latina, Voz A, Terror y Leonardo
devolvieron MP3.

**Deploy:** `dpl_rPgioSQHCQBddcfR8BwA9dNAw9En` · `READY` · alias
`https://jg-turbo.vercel.app`. Verificado contra el dominio real: HTML `200`
con marcador v2.24.0, `ttsGrupoFish`, `id:'latina'` / `id:'voz-a'` /
`id:'terror'` / `id:'leonardo'`, SW `v31`; `/api/health` `200`;
`/api/tts-voices` lista 18 voces (14 es / 4 en); `POST /api/tts` con
`fish_voice=latina` → `fish:Latina`, `voz-a` → `fish:Voz A`, `terror` →
`fish:Terror`, `leonardo` → `fish:Leonardo`. UI: 4 grupos Fish (español/
inglés × femeninas/masculinas) en el listado y en Configuración.

---

## Nuevo en v2.23.0 · 4 voces Fish más (Sarah, Paula, Adrian, Ethan) (2026-08-19)

**Pedido:** agregar al listado existente las voces de Fish Audio con estos IDs:

- `933563129e564b19a115bedd57b7406a`
- `bf322df2096a46f18c579d0baa36f41d`
- `536d3a5e000945adb7038665781a4aca`
- `c2623f0c075b4492ac367989aee1576f`

**Qué se hizo:** las fichas se comprobaron contra `GET /model/{id}` (públicas,
`trained`, sin aviso DMCA). Entran al catálogo curado con el nombre de Fish y
el género de sus etiquetas. No se toca `jg_tts_voice` ni se cambian las voces
ya guardadas.

| Género | Nombre en la app | Ficha en Fish | Uso público (aprox.) |
|---|---|---|---|
| Mujer | **Sarah** | Sarah | 1 770 000 |
| Mujer | **Paula** | Paula | 126 000 |
| Hombre | **Adrian** | Adrian | 630 000 |
| Hombre | **Ethan** | Ethan | 421 000 |

Las cuatro fichas están etiquetadas en inglés en Fish; el motor `s2.1-pro-free`
igual las usa para leer español. Quedan 14 voces: 7 femeninas y 7 masculinas.
El listado junto a *Escuchar* y «Quién lee» en Configuración las muestran
cuando Fish está activo. Service Worker **`jg-turbo-shell-v30`**.

**Pruebas:** `node tests/test_tts_voces_fish.js` ·
`pytest backend/tests/test_tts_voces_fish.py` · `node tests/test_tts_descarga.js`
· `node tests/test_espaciado_texto_pegado.js` ·
`node tests/test_tts_configuracion.js` · `node tests/test_tts_tiempo_velocidad.js`.
Síntesis corta en Fish con texto en español: Sarah, Paula, Adrian y Ethan
devolvieron MP3.

**Deploy:** `dpl_EcgmGh2aVuQ367JptNZNmRFAQtPy` · `READY` · alias
`https://jg-turbo.vercel.app`. Verificado contra el dominio real: HTML `200`
con marcador v2.23.0, `id:'sarah'` / `id:'paula'` / `id:'adrian'` / `id:'ethan'`,
SW `v30`; `/api/health` `200`; `/api/tts-voices` lista 14 voces Fish;
`POST /api/tts` con `fish_voice=sarah` → `X-TTS-Voice: fish:Sarah`. UI: las 14
aparecen en el listado y en Configuración.

---

## Nuevo en v2.22.0 · el reloj sigue la velocidad de escucha (2026-08-19)

**Pedido:** al mover la perilla de velocidad (por ejemplo de `0.96×` a `0.84×`),
el tiempo de la transcripción seguía mostrando el mismo `4:44`. El usuario
quería que la duración se recalculara y coincidiera con lo que realmente se
tarda en oír el texto a esa velocidad.

**Causa:** el audio se genera a ritmo natural (`1×`) y el navegador lo acelera
con `playbackRate`. El reloj leía esa duración cruda y nunca la dividía por la
velocidad elegida. Por eso `0.96×` y `0.84×` pintaban el mismo número.

**Solución:** el reloj de las cinco consolas muestra **tiempo de escucha**
(`segundos de audio ÷ velocidad`). Un texto de `4:44` a `1.00×` pasa a `4:56`
en `0.96×` y a `5:38` en `0.84×`. El cambio se ve al instante, también antes de
pulsar Escuchar (estimación por caracteres). La barra y los saltos de 10 s usan
esa misma escala: retroceder 10 s resta 10 segundos de lo que se oye, no del
audio crudo. La pantalla de bloqueo sigue recibiendo la duración a `1×` más el
`playbackRate`, que es el contrato de `MediaSession`.

No se tocó `jg_tts_rate` ni se regenera audio. El shell PWA sube a
`jg-turbo-shell-v29`.

**Pruebas:**

- `node tests/test_tts_tiempo_velocidad.js`: conversión 1.00× / 0.96× / 0.84× /
  2.00×, salto de 10 s, estimación con texto y vacío, barra y arrastre.
- `node tests/test_tts_descarga.js`, `test_tts_voces_fish.js`,
  `test_espaciado_texto_pegado.js` y `test_tts_configuracion.js`.
- Sintaxis del JavaScript incrustado: correcta.
- Chromium local: con texto en Micrófono, `0.96×` y `0.84×` muestran duraciones
  distintas; al volver a `1.00×` recupera el tiempo base.

**Deploy funcional:** `dpl_Hf4T4ZjM6kU8RsZmGvsbQMwZvTtq` · `READY` · alias
`https://jg-turbo.vercel.app`. Verificado contra el dominio real: HTML `200`
con marcador v2.22.0, `ttsTiempoEscucha`, SW `v29` y `/api/health` `200` con
modelo listo.

---

## Nuevo en v2.21.0 · velocidad continua y exacta (2026-08-19)

**Pedido:** reemplazar las seis velocidades fijas de «Escuchar transcripción» por
una perilla que permita escoger cualquier valor, incluidos `0.85×`, `0.92×`,
`1.30×` y `1.35×`.

**Solución:** las cinco consolas TTS ahora usan un deslizador `0.75×–2.00×` con
paso de `0.01`. El valor exacto queda visible junto a la perilla, se aplica al
audio en el mismo instante sin reiniciar la lectura y se sincroniza entre
Micrófono, Archivo, YouTube, Traducción, «Editar en grande» y Configuración. El
selector de velocidad propio del video de YouTube no cambió porque depende de
las tasas que ese reproductor admite.

La preferencia mantiene la misma clave `jg_tts_rate`; no hay migración ni pérdida
de ajustes. La entrada se acota al rango permitido y se normaliza a dos
decimales. El control ofrece foco visible, texto accesible con el valor exacto y
44 px de alto táctil en celular. El shell PWA sube a `jg-turbo-shell-v28`.

**Pruebas:**

- Sintaxis del JavaScript incrustado: correcta.
- Reproductor TTS: conserva exactamente `0.85`, `0.92`, `1.30` y `1.35`; límites
  `0.75–2.00`; cinco perillas; ningún selector viejo.
- Descarga MP3, voces Fish y espaciado: correctos con SW v28.
- Chromium real local: las cinco perillas se sincronizan; `0.85×` sobrevive una
  recarga; `1.35×` funciona en vista móvil y el control mide 44 px de alto.
- El banco integral local→API productiva no se contabilizó porque el navegador
  bloquea por CORS ese cruce de orígenes. Antes del bloqueo confirmó arranque de
  audio y cambio instantáneo de velocidad en 2 ms.

**Deploy funcional:** `dpl_7v9sajuj8VXT3qMvxq1c1rzoXLsU` · `READY` · alias
`https://jg-turbo.vercel.app`. Verificado contra el dominio real: HTML `200` con
marcador v2.21.0, cinco perillas `step="0.01"`, cero selectores viejos, SW v28 y
`/api/health` `200` con modelo listo. En Chromium productivo, `0.92×` se reflejó
en las cinco consolas y sobrevivió la recarga mediante `jg_tts_rate`.

---

## Corrección v2.20.0 · se retira el pulido automático del doblaje (2026-08-15)

La versión 2.19.0 hacía pausas artificiales y podía cambiar palabras porque
pulía fragmentos breves antes de sintetizarlos. El doblaje vuelve a usar la
traducción directa y literal. La acción manual **Pulir** permanece, pero ahora
aplica cambios mínimos y conservadores.

El audio ya no se ralentiza para rellenar el tiempo sobrante. Los bloques son
más largos, la voz habla como mínimo al ritmo del video y deja silencio cuando
termina antes. Solo se acelera si la traducción española necesita más tiempo.

Código, causa y pruebas completas: `CAMBIOS_YOUTUBE.md`.

**Deploy funcional:** `dpl_7gF3pF5KUAXvLNGQjg1VUgAvVNv9` · `READY` ·
verificado en el dominio real con ocho módulos YouTube, SW v27, sin errores de
consola y API saludable. La escucha completa queda pendiente para no consumir
créditos externos sin autorización.

---

## Nuevo en v2.19.0 · la voz usa la traducción pulida (2026-08-15)

Antes de generar los MP3 del video, la traducción puede pasar por **Pulir**. La
opción viene activa y se puede desmarcar. El pulido conserva los timestamps y
los límites de cada segmento mediante marcadores protegidos. La voz y el texto
sincronizado usan exactamente el mismo resultado.

También se unificaron las instrucciones de Pulir en Vercel y backend local para
eliminar muletillas, repeticiones accidentales y errores claros del habla o ASR,
sin resumir, inventar, mover ideas ni cambiar estructura. Detalles y pruebas en
`CAMBIOS_YOUTUBE.md`.

**Deploy funcional:** `dpl_8Dr52vhh1vXqVJsEFr9uYwy6H9bV` · `READY` ·
verificado en producción con nueve módulos YouTube, SW v26 y API saludable.

---

## Nuevo en v2.18.0 · voz española sincronizada con YouTube (2026-08-15)

El panel YouTube genera voz española por bloques temporales, prepara tres antes
de reproducir y continúa la síntesis en segundo plano. Mientras el doblaje está
activo, silencia el reproductor original; pausa, búsqueda y velocidad se reflejan
en el MP3 mediante el reloj del propio video. Reutiliza la voz, acento y tono
persistentes sin cambiar ninguna clave `jg_tts_*`.

La petición TTS por GET ahora incluye `source`, igual que POST. De este modo el
servidor conserva el ruteo de privacidad y puede respetar una voz Fish elegida
cuando el origen permitido es YouTube.

Código y pruebas completas: `CAMBIOS_YOUTUBE.md`, entrega de doblaje 2026-08-15.

**Deploy funcional y verificado:** `dpl_6PgZ9E7UfjFsjh2NnWQ4KXUpicKx` · `READY` ·
verificado en el alias de producción con SW v25, módulos de doblaje cargados y
`/api/health` correcto.

---

## Corrección v2.16.1 — Se retiran Clara y Néstor (2026-08-15)

**Pedido:** quitar Clara y Néstor del listado Fish. Las demás se quedan.
Las voces de recambio las comparte el usuario después (por ID).

**Qué se hizo**

- Fuera del catálogo: `clara` y `nestor` (servidor y listado).
- Quedan 10 voces: Nico Robin, Narradora, Chica, Nagi, Colombiana,
  Locutor K, Narrador, Loquendo, Valentino, Sabio.
- Si alguien tenía `fish:clara` o `fish:nestor` guardado, pasa a Nico Robin
  o Locutor K. No se borra `jg_tts_voice`.
- Service Worker **`jg-turbo-shell-v23`**.

**Pruebas:** `node tests/test_tts_voces_fish.js` ·
`pytest backend/tests/test_tts_voces_fish.py`.

**Deploy:** `dpl_Bk1oFg4jv8Bf2oe4LqXhspL6FxkD` · Ready · production ·
verificado en https://jg-turbo.vercel.app (marcador `v2.16.1`, `id:'clara'` y
`id:'nestor'` ausentes, SW `v23`; `/api/health` ok; `/api/tts-voices` lista 10
voces: nico-robin, narradora, chica, nagi, colombiana, locutor-k, narrador,
loquendo, valentino, sabio).

---

## Nuevo en v2.16.0 — 5 femeninas y 5 masculinas más de Fish Audio (2026-08-15)

**Pedido:** integrar unas 5 voces femeninas y 5 masculinas más de Fish Audio,
si era viable.

**Viabilidad:** sí. Fish no limita a dos voces: cualquier ficha pública
`trained` se usa con el mismo `POST /v1/tts` y el `reference_id` de su URL.
El cuello de botella era nuestro: la app solo guardaba *una* mujer y *un*
hombre (`FISH_VOICE_FEMALE` / `FISH_VOICE_MALE`). El plan `s2.1-pro-free`
sigue igual (gratis, textos solo de orígenes permitidos, más lento que Edge).

**Criterio de las voces nuevas:** fichas públicas en español, estado
`trained`, sin aviso DMCA, pensadas para narrar o locutar (no clones de
famosos ni de personajes). Las 12 se comprobaron contra
`GET /model/{id}`. Tres nuevas (Narradora, Colombiana, Narrador) devolvieron
MP3 real con `s2.1-pro-free`.

| Género | Nombre en la app | Ficha en Fish | Uso público (aprox.) |
|---|---|---|---|
| Mujer | **Nico Robin** | Nico Robin | ya estaba |
| Mujer | **Narradora** | Voz Femenina Español | 210 000 |
| Mujer | **Chica** | Chica | 160 000 |
| Mujer | **Nagi** | Nagi | 102 000 |
| Mujer | **Colombiana** | Colombiana IA | 80 000 |
| Mujer | **Clara** | Cute girl | 55 000 |
| Hombre | **Locutor K** | voz de locutor k | ya estaba |
| Hombre | **Narrador** | Narrador v2 | 503 000 |
| Hombre | **Loquendo** | Loquendo | 319 000 |
| Hombre | **Valentino** | Valentino | 169 000 |
| Hombre | **Néstor** | Nestor G (Locutor) | 139 000 |
| Hombre | **Sabio** | Sabio expandido | 102 000 |

**Qué se hizo**

- Catálogo curado en servidor (`FISH_CATALOGO_BASE`). Los IDs son públicos;
  no hace falta una variable de entorno por voz. `FISH_VOICE_FEMALE` /
  `FISH_VOICE_MALE` solo pisan Nico Robin y Locutor K.
- `GET /api/tts-voices` publica `engines.fish.voices.list` (12 entradas, sin
  IDs internos). Siguen existiendo `voices.female` y `voices.male` para no
  romper clientes viejos.
- La petición manda `fish_voice` (el slug). Vacío = alias histórico
  `female` / `male`.
- Persistencia: `jg_tts_voice` pasa a `fish:colombiana`. `fish:female` y
  `fish:male` se siguen leyendo como Nico Robin y Locutor K.
- El listado junto a *Escuchar* y «Quién lee» en Configuración muestran las
  12 cuando Fish está activo.
- Service Worker **`jg-turbo-shell-v22`**.

**Pruebas:** `node tests/test_tts_voces_fish.js` · `pytest backend/tests/test_tts_voces_fish.py`
· `node tests/test_tts_descarga.js` · `node tests/test_espaciado_texto_pegado.js`
· `node tests/test_tts_configuracion.js`.

**Deploy:** `dpl_H1j4LMLUFGZwuviRwae4iAkWYJEB` · Ready · production ·
verificado en https://jg-turbo.vercel.app (marcadores `v2.16.0`, `id:'colombiana'`,
`jg-turbo-shell-v22`; `/api/health` ok; `/api/tts-voices` publica 12 voces Fish;
`POST /api/tts` con `fish_voice=colombiana` → `X-TTS-Voice: fish:Colombiana`,
`fish_voice=narrador` → `fish:Narrador`, alias vacío → `fish:Nico Robin`).

---

## Corrección v2.15.0 — El panel de voz de Configuración, ordenado y funcional (2026-08-15)

**Pedido:** «en la tuerca las voces están bastante desordenadas, no es intuitivo;
y si escojo cualquier voz no cambia. En el input sí cambian, eso no lo muevas.»

**Causa real del «no cambia»:** Configuración usaba **el mismo desplegable** que
la barra (`data-tts-voice-select`): una lista plana de 16 opciones con «Colombia»
repetida (`auto` y `es-CO`). Peor: `ttsActualizarHintVoz()` leía ese valor como si
fuera un locale — recibía `neural:es-MX:male` donde esperaba `es-MX`, caía siempre
en `names.auto` y **el resumen decía «Colombia · Salomé» pasara lo que pasara**.
La voz sí se guardaba; la pantalla mentía.

**Qué se hizo** (solo Configuración; el selector junto a *Escuchar* quedó intacto)

- La preferencia se edita en piezas: **Acento del español** (6 países, sin la
  Colombia duplicada) · **Quién lee** (muestra el nombre real y sigue al acento:
  México → «Jorge · masculina») · **Tono** · **Velocidad**, en rejilla de 2
  columnas que pasa a 1 en móvil.
- **Resumen en vivo** (`#settingsTtsVoiceHint`, `aria-live`) armado desde
  `ttsPrefs()` — la preferencia ya guardada — no desde el texto de los selects.
- **Opciones avanzadas** plegadas (`<details>`): de dónde sale la voz
  (Neural / Fish Audio / navegador) y qué hacer con inglés y portugués.
  Fish solo aparece si `/api/tts-voices` la da activa. Con Fish o con «una sola
  voz multilingüe» el acento se oculta, porque no aplica.
- Funciones nuevas: `ttsMotorConfig()`, `ttsSincronizarConfigVoz()`,
  `ttsGuardarConfigVoz()`. Se eliminaron `#settingsTtsGender` (oculto) y
  `#settingsTtsLocale`. `ttsRellenarLocales()` ya pinta siempre la voz guardada.
- Una sola fuente de verdad (`jg_tts_voice`): cambiar en un lado se ve en el otro.

**Pruebas:** 19 comprobaciones automatizadas en Chrome real (Playwright) —
guardado, sincronización en ambos sentidos, persistencia tras recargar, modo
navegador, modo multilingüe, sin errores de JS y sin desborde horizontal a 390 px.
Payload verificado: Perú + masculina → el motor recibe `locale: es-PE, voice: male`.

**Deploy:** `dpl_3SdXXRXTBzakzWdzxzc7wRVqQWFV` · Ready · production ·
verificado en https://jg-turbo.vercel.app (marcadores `settingsTtsAccent` y
`cfg-voz__resumen` presentes, `settingsTtsLocale` ausente, `/api/health` ok).

---

## Corrección v2.14.0 — Fish se elige en el listado y la barra no se esconde (2026-08-14)

**Pedido:** las voces Fish no debían quedar automáticas ni en un recuadro
aparte. Tienen que vivir en el **mismo listado** que Salomé, Dalia, etc.,
marcadas como Fish Audio, y poder intercalarse. Además, la barra de
progreso (atrasar / adelantar / arrastrar) había desaparecido y no se
pidió quitarla.

**Qué se corrigió**

- Un solo selector de voz en cada consola y en Ajustes, con grupos
  **Neural** y **Fish Audio**.
- Fish solo suena si la persona la elige (`prefer_fish`). Ya no se aplica
  sola en Micrófono o YouTube.
- La barra de transporte se monta siempre (`0:00 / 0:00` en reposo) y no
  se oculta al terminar.

Clave nueva `jg_tts_voice` (no se borra `jg_tts_gender` ni `jg_tts_locale`).
Service Worker **`jg-turbo-shell-v20`**.

---

## Nuevo en v2.13.0 — Las voces Fish se ven sin pulsar Escuchar (2026-08-14)

**Pedido:** se agregaron 2 voces de Fish Audio y no aparecían. El motor sí
las usaba en Micrófono y YouTube, pero la interfaz no las listaba: el único
selector seguía diciendo «Mujer / Hombre» y el encabezado solo cambiaba al
reproducir. En el celular ese encabezado ni siquiera se muestra.

**Causa real (no era solo el Service Worker):**

1. `FISH_VOICE_FEMALE_NAME` y `FISH_VOICE_MALE_NAME` estaban vacíos, así que
   el servidor etiquetaba las voces como «Mujer» y «Hombre»: iguales al
   selector de género.
2. `GET /api/tts-voices` decía `fish.active: true` pero **no devolvía los
   nombres**. La interfaz no tenía de dónde pintar un listado.
3. El HTML en reposo seguía fijo en «Neural bilingüe · Dalia».

**Voces reales configuradas** (fichas públicas de fish.audio):

| Género | Nombre en la app | Título en Fish |
|---|---|---|
| Mujer | **Nico Robin** | Nico Robin |
| Hombre | **Locutor K** | voz de locutor k |

**Qué cambió**

- El servidor resuelve el nombre (variable de entorno → ficha de Fish →
  género) y lo publica en `engines.fish.voices`.
- Ajustes muestra un recuadro «Voces Fish» con las dos voces.
- En Micrófono y YouTube los botones pasan a decir **Nico Robin** /
  **Locutor K**. En Archivo, Traducir y el editor grande siguen Mujer /
  Hombre (esas consolas no mandan texto a Fish).
- El encabezado en reposo ya dice «Fish · nombre», sin esperar a Escuchar.
- Service Worker **`jg-turbo-shell-v19`**. En celular los nombres van en
  una sola línea (el panel se desplaza de lado si no caben).

**Pruebas:** `node tests/test_tts_voces_fish.js` · `pytest backend/tests/test_tts_voces_fish.py`.

**Deploy v2.14.0:** `jg-turbo-gf5gfw6j0-jhoncod24s-projects.vercel.app` · alias
https://jg-turbo.vercel.app · SW `jg-turbo-shell-v20`.

---

## Corrección v2.12.1 — La interfaz decía una voz y sonaba otra (2026-08-14)

**Bug introducido en v2.12.0:** con Fish respondiendo, el servidor seguía
enviando `X-TTS-Voice: es-CO-SalomeNeural` (la voz candidata de Edge), así que
la etiqueta de la consola mostraba «Neural · Colombia · Salome» mientras sonaba
la voz de Fish. La interfaz mentía sobre lo que el usuario estaba oyendo.

**Arreglo:** cuando el motor es Fish, la cabecera devuelve `fish:<Nombre>` y
`ttsVoiceDisplay()` lo muestra como «Fish · Nombre», sin acento del selector
(esa voz trae el suyo propio y ese control no la afecta).

Nombres configurables con `FISH_VOICE_FEMALE_NAME` y `FISH_VOICE_MALE_NAME`.
Sin ellos se muestra «Fish · Mujer» y «Fish · Hombre».

Verificado en producción (deploy `jg-turbo-oqr7qguqu-jhoncod24s-projects.vercel.app`):

| `source` | voz | Motor | `X-TTS-Voice` |
|---|---|---|---|
| `mic` | female | fish | `fish:Mujer` |
| `mic` | male | fish | `fish:Hombre` |
| `file` | female | edge | `es-CO-SalomeNeural` |

**Service Worker actualizado a `jg-turbo-shell-v17`.** Sin ese cambio el
navegador seguía sirviendo el `index.html` cacheado y la corrección no se veía
por más que se recargara: el SW intercepta la petición antes de que salga a la
red. Paso obligatorio siempre que se toque `index.html` (ver §8.1).

**Dónde se ve la voz:** la etiqueta del encabezado de la consola solo se
actualiza **al reproducir un bloque**. Antes de pulsar «Escuchar» muestra el
texto por defecto del HTML («Neural bilingüe · Dalia»), no la voz en uso.

**Pendiente conocido:** el selector de acento (Colombia, México, …) no tiene
efecto cuando responde Fish. Sigue visible y activo, así que puede confundir.

---

## Nuevo en v2.12.0 — Fish Audio con ruteo por origen (2026-08-14)

**Por qué:** la cuenta de Azure del usuario no tiene suscripción, y crear una
exige tarjeta. Fish Audio da el mayor salto de naturalidad sin tarjeta y a $0,
pero su plan gratuito advierte que **las peticiones pueden usarse para mejorar
su modelo**. Mandarle todo el texto de la app no era aceptable: las
transcripciones de archivos traen **voz de otras personas** que no dieron su
consentimiento.

**Solución:** el motor se elige según de dónde salió el texto, no según una
preferencia global.

| Origen (`sourceId`) | Qué contiene | Motor |
|---|---|---|
| `mic` | Lo que dicta el propio usuario | **Fish** |
| `yt` | Transcripción de video público | **Fish** |
| `settings-test` | Frase fija de prueba | **Fish** |
| `file` | Transcripción de audio subido: **voz de terceros** | edge / Azure |
| `trans` | Traducción: el origen puede ser cualquiera | edge / Azure |
| `modal` | Editor grande: puede traer cualquier texto | edge / Azure |

La lista se amplía con `FISH_ALLOWED_SOURCES`, pero el valor por defecto es el
prudente. Sin `source` declarado, tampoco va a Fish.

### Cambios por capa

- **Cliente:** `ttsFetchNeuralChunk` acepta `sourceId` y lo manda en el cuerpo
  como `source`. La descarga MP3 lo pasa explícitamente para que escuchar y
  descargar usen el mismo motor.
- **Servidor:** `TtsRequest.source`, `_tts_fish_activo(source, gender)` y
  `_tts_fish_synthesize`. Orden final: **Azure → Fish → edge-tts**.
- **Emoción:** Fish S2 usa etiquetas dentro del texto, no SSML. `warm` →
  `[friendly]`, `energetic` → `[excited]`, `neutral` → sin etiqueta.
- `GET /api/tts-voices` informa en `engines` qué motor está activo y qué
  orígenes puede ver cada uno.

### Configuración

| Variable | Efecto |
|---|---|
| `FISH_API_KEY` | Clave de fish.audio. Sin ella, Fish ni se intenta |
| `FISH_VOICE_FEMALE` / `FISH_VOICE_MALE` | `reference_id` de las voces elegidas en fish.audio |
| `FISH_MODEL` | `s2.1-pro-free` por defecto |
| `FISH_ALLOWED_SOURCES` | Orígenes permitidos (por defecto `mic,yt,settings-test`) |

**Voces configuradas (2026-08-14):** mujer `e7e72305…` → Nico Robin · hombre
`3f45a7fd…` → Locutor K. Los IDs viven en `FISH_VOICE_FEMALE` /
`FISH_VOICE_MALE`. Los nombres, en `FISH_VOICE_*_NAME` o se leen de
`GET https://api.fish.audio/model/{id}`.

**Riesgo conocido:** el plan `s2.1-pro-free` está anunciado **hasta el
31-ago-2026**. Si termina, la síntesis cae sola a `edge-tts` sin romperse.

### Verificado en producción (2026-08-14)

Deploy `jg-turbo-r78a34yci-jhoncod24s-projects.vercel.app` · alias `jg-turbo`.
Claves cargadas en Vercel como **Sensitive** en Production y Preview. Vercel
rechaza variables sensibles en Development (`sensitive_not_allowed_on_development`),
así que ahí no se subieron: el desarrollo local ya las toma del `.env`.

`GET /api/tts-voices` → `engines.fish.active: true`, modelo `s2.1-pro-free`.

Petición real a `POST /api/tts` contra el dominio de producción:

| `source` | Motor que respondió | Tamaño |
|---|---|---|
| `mic` | **fish**-neural-regional | 39 705 B |
| `yt` | **fish**-neural-regional | 47 646 B |
| `file` | edge-neural-regional | 18 720 B |
| `trans` | edge-neural-regional | 18 720 B |

**Latencia medida (3 intentos, bloque de ~120 caracteres):**

| Motor | Tiempo total |
|---|---|
| Fish | 3,41 s · 2,49 s · 2,97 s |
| edge | 0,99 s · 0,77 s · 0,64 s |

Fish es unas 3 veces más lento. **No corta la reproducción continua**, porque un
bloque de hasta 2 800 caracteres son varios minutos de audio y la precarga del
siguiente arranca al empezar el actual. Lo que sí se nota es el **arranque**: al
pulsar «Escuchar» hay ~2,5 s de espera en vez de ~1 s. `GET /api/tts-warmup` no
lo cubre porque precalienta sin `source` y por tanto usa edge-tts.

### Validación

- 16 comprobaciones de ruteo: `file`, `trans`, `modal` y origen vacío **nunca**
  activan Fish; `mic`, `yt` y `settings-test` sí. Sin clave o sin voz del género
  pedido, tampoco.
- Con clave inválida, ambos orígenes siguen devolviendo MP3 real vía `edge-tts`.
- End-to-end: `source=mic` y `source=file` responden `200` con audio.
- Regresiones aprobadas, incluidas dos aserciones nuevas en
  `tests/test_tts_descarga.js` sobre el envío del origen.

---

## Nuevo en v2.11.0 — Motor Azure opcional: la voz deja de sonar plana (2026-08-14)

**Pedido del usuario:** que la voz suene natural, con acento y expresión, sin
perder la reproducción continua y sin pagar ni ceder los textos a un proveedor
que los use para entrenar sus modelos.

### Por qué Azure y no Fish Audio ni ElevenLabs

| Opción | ¿$0? | ¿Textos fuera del entrenamiento? |
|---|---|---|
| Fish Audio `s2.1-pro-free` | Sí | **No** — «requests may be used to improve model quality» |
| Fish Audio de pago ($15/1M bytes) | No | **No** — el «zero data retention» solo está en el plan Enterprise |
| ElevenLabs Free | Sí | Sí, pero **sin licencia comercial** y ~10 min/mes |
| **Azure AI Speech F0** | **Sí, 500k caracteres/mes** | **Sí, documentado por Microsoft** |

Microsoft documenta que *«doesn't retain or store the text that you provide with
the real-time synthesis text to speech API»* y que tampoco guarda el audio.
Además usa **las mismas voces** que ya consumíamos por `edge-tts`
(`es-CO-SalomeNeural`, `es-CO-GonzaloNeural`): cambia la vía de acceso, no el
catálogo, así que ningún acento se pierde.

### Qué gana la voz

`edge-tts` llega al motor neural por una vía no oficial que **ignora el SSML**:
solo deja mover velocidad, tono y volumen. Con clave de Azure enviamos SSML real
y pedimos un **estilo de interpretación**, que es lo que quita la lectura plana:

| Tono de la UI | Estilo Azure (primero que la voz admita) |
|---|---|
| `neutral` | ninguno (sin `express-as`) |
| `warm` | `friendly` → `gentle` → `calm` → `chat` → `empathetic` |
| `energetic` | `cheerful` → `excited` → `lively` → `chat` (`styledegree="1.2"`) |

Pedir un estilo que la voz no soporta hace fallar la petición, así que se
consulta `/cognitiveservices/voices/list` **una vez por instancia** y solo se
aplican estilos que existen de verdad. Si esa consulta falla, se sintetiza sin
estilo: menos expresión, nunca un error.

### La reproducción sigue sin cortarse

La continuidad la da la cola de bloques del navegador, que **no se tocó**. En el
servidor la cascada es ahora de tres niveles y toda la caída ocurre antes de
devolver el MP3, así que el navegador nunca ve un hueco:

```text
Azure (SSML + estilo)  ──falla / 401 / 429 / timeout 15 s──▶
edge-tts (como hasta hoy)  ──falla──▶
speechSynthesis del navegador (cliente)
```

El tier F0 permite **20 transacciones por cada 60 segundos**. Al superarlo Azure
responde `429` y el bloque se sintetiza con `edge-tts`: se nota un cambio de
expresividad, no un silencio.

### Configuración (sin variables, todo sigue igual que en v2.10.0)

| Variable | Efecto |
|---|---|
| `AZURE_SPEECH_KEY` | Clave del recurso Speech. Sin ella, Azure ni se intenta |
| `AZURE_SPEECH_REGION` | Región del recurso, en minúsculas (ej. `eastus`) |

Nunca van en `index.html`: se leen solo en el servidor.

### API

- `POST /api/tts` — mismo contrato de entrada y misma respuesta `audio/mpeg`.
  Cabeceras nuevas: `X-TTS-Engine` pasa a `azure-neural-regional` /
  `edge-neural-regional` (antes siempre `edge-*`) y se añade `X-TTS-Style`.
- `GET /api/tts-azure?locale=es` — **nuevo**. Diagnóstico: si la clave está
  activa, qué estilos admite cada voz española de la cuenta, qué voces HD hay
  disponibles en la región y qué estilos tienen las dos voces en uso.
- `GET /api/tts-warmup` — ahora informa `engine` en la respuesta.

### Validación

- `python -m py_compile` aprobado en `api/index.py` (ambas copias) y
  `backend/app.py`.
- 13 comprobaciones nuevas: SSML válido como XML incluso con `&`, `<`, comillas
  y caracteres de control; estilo aplicado solo cuando corresponde; y **clave
  inválida → cae a `edge-tts` devolviendo MP3 real de 12 KB**, sin excepción.
- End-to-end con `TestClient` sin clave: `200`, `X-TTS-Engine:
  edge-neural-regional`, `es-CO-SalomeNeural`, 18 720 bytes `audio/mpeg`, y
  texto vacío sigue devolviendo `400 No hay texto para leer`.
- Regresiones aprobadas: `test_tts_configuracion.js`, `test_tts_descarga.js`,
  `test_tts_reproductor.js` y `test_cola_tts.js`.
- **Pendiente de la clave real:** confirmar qué estilos admiten de verdad
  `es-CO-SalomeNeural` y `es-CO-GonzaloNeural`, y si la región tiene voces HD
  (`DragonHDLatestNeural`) en español. Lo responde `GET /api/tts-azure`.

---

## Nuevo en v2.10.0 — Descargar el texto como audio MP3 (2026-08-14)

**Pedido del usuario:** mostrar junto a «Escuchar» una acción minimalista para
descargar como audio el texto pegado o generado mediante transcripción, usando
la voz elegida.

### Implementación

- Las cinco consolas TTS, Micrófono, Archivo, YouTube, Traducción y «Editar en
  grande», montan un botón compacto `MP3` junto a «Escuchar».
- La descarga usa el texto completo del editor, aunque exista una selección
  parcial activa. «Escuchar» conserva su comportamiento de leer la selección.
- Se respetan género, acento, tono, modo regional/multilingüe y velocidad
  actuales. La velocidad queda incorporada en el MP3, no depende del reproductor.
- Los textos largos se parten con la misma cola segura del reproductor, se
  generan hasta tres bloques en paralelo y se unen en su orden original como un
  solo `audio/mpeg` dentro del navegador.
- A velocidad `1×`, la descarga reutiliza los bloques que ya estén en la caché
  de escucha. Con otra velocidad los genera de nuevo para incorporarla al archivo.
- El archivo se nombra con origen, locale, género y fecha. Ejemplo:
  `jg-turbo-dictado-es-co-mujer-2026-08-14.mp3`.
- No se guarda el texto ni el MP3 en el servidor. El Blob temporal se libera un
  minuto después de iniciar la descarga.
- Si está activo el motor del navegador, se muestra una instrucción para cambiar
  a Neural: Web Speech permite reproducir voces locales, pero no exportar su audio.
- El rango del servidor se alineó con la UI en `0.75×–2×` para que el MP3 respete
  también el preset más lento.
- Service Worker actualizado a `jg-turbo-shell-v15`.

### Diseño y accesibilidad

- Acción secundaria sin tarjeta nueva: icono de descarga reutilizado del propio
  proyecto y etiqueta corta `MP3`.
- Altura de 36 px en escritorio y 44 px en pantallas táctiles.
- `title`, `aria-label`, `aria-busy`, foco visible, estado deshabilitado y progreso
  compacto `n/total` durante la preparación.
- Los encabezados colapsados anuncian «Voz neural · descarga MP3».

### Validación y despliegue

- `node tests/test_tts_descarga.js`: 12 comprobaciones aprobadas, incluyendo
  concatenación binaria y orden de bloques.
- Sintaxis JavaScript inline válida y `py_compile` aprobado para API Vercel y
  backend local.
- Regresiones `tests/test_tts_configuracion.js` y `test_tts_reproductor.js`
  aprobadas.
- Síntesis real `test_tts_idiomas.py` y `test_tts_unificado.py` aprobada para
  voces regionales, inglés, portugués, francés, alemán, italiano y modo
  multilingüe. La primera ejecución necesitó `PYTHONUTF8=1` porque PowerShell
  CP1252 no podía imprimir el símbolo `→`; el audio no había fallado.
- Regresión general sin carga de Whisper local: 85 pruebas aprobadas, con una
  advertencia de deprecación de `httpx`/Starlette ajena a esta entrega.
- Descarga real en Chromium con 18 oraciones: archivo
  `jg-turbo-dictado-es-co-mujer-2026-08-14.mp3`, 722.448 bytes, sin fallo del
  navegador y encabezado MPEG válido `FF F3 64 C4`.
- `ffprobe`: formato `mp3`, duración 120,408 s y tamaño 722.448 bytes.
- Escritorio: botón 61,98 × 36 px. Móvil 390 × 844: botón 59,98 × 44 px,
  visible junto a «Escuchar» y sin solapamiento. La franja conserva su scroll
  horizontal deliberado para los controles secundarios.
- El único error de consola fue `/ping` 404 del servidor estático de la prueba;
  no pertenece a la aplicación desplegada.
- Deploy de producción: `dpl_8S22tkseGhuyC9LcMJoqN9pCikzW` · `Ready` ·
  `target production`.
- Alias real <https://jg-turbo.vercel.app>: HTML `v2.10.0`, acción de descarga,
  botón `MP3` y Service Worker `v15` presentes; `/api/tts-voices` informó rango
  `0.75–2.0` y motor `edge-neural-regional`.
- Petición real a `0.75×`: `200`, `es-CO-SalomeNeural`, header `X-TTS-Rate: -25%`.
- Descarga final desde producción en Chromium: 38.304 bytes, encabezado MPEG
  `FF F3 64 C4`, nombre esperado y cero errores de consola.

---

## Nuevo en v2.9.0 — La voz elegida sí cambia (2026-08-14)

**Pedido del usuario:** que cambiar la voz o el acento en Configuración produzca
un cambio audible real; evitar el arranque con coloración inglesa al leer
español; mostrar únicamente voces útiles para español latino, inglés y
portugués; conservar inicio rápido y reproducción continua.

### Causas verificadas

| Síntoma | Causa real | Corrección |
|---|---|---|
| México, Colombia y Argentina sonaban iguales | El modo predeterminado `unified` ignoraba `locale` y siempre enviaba Ava/Andrew con base `en-US` | El modo inicial ahora es `regional`: español usa la voz del acento elegido; `unified` queda como alternativa explícita con aviso |
| «Dos voces» no se podía activar de verdad | La UI guardaba `auto`, pero `ttsPrefs()` convertía siempre `auto` a `unified` al leerlo | Nuevo valor inequívoco `regional`; el valor histórico `auto` migra a `regional` |
| El español podía arrancar con coloración inglesa | Ava/Andrew multilingües tienen locale base `en-US` y se usaban también para español | Colombia/México/Argentina/Chile/Perú/español latino de EE. UU. usan voces `es-*` nativas desde la primera palabra |
| El selector mostraba idiomas y voces del sistema que no se iban a usar | `ttsRellenarLocales()` añadía todos los locales expuestos por `speechSynthesis` | El selector visible queda limitado a seis acentos latinos; inglés y portugués se eligen automáticamente por el idioma del texto |
| El respaldo del navegador añadía silencios | Después de cada bloque esperaba entre 50 y 280 ms según el tono | Se eliminó esa espera artificial; los tonos ya no alteran el `pitch`, para no deformar el timbre |

### Catálogo visible y comportamiento

| Idioma/acento | Mujer | Hombre |
|---|---|---|
| Colombia (inicial) | Salomé | Gonzalo |
| México | Dalia | Jorge |
| Argentina | Elena | Tomás |
| Chile | Catalina | Lorenzo |
| Perú | Camila | Alex |
| Latino de EE. UU. | Paloma | Alonso |
| Inglés, automático | Ava | Andrew |
| Portugués de Brasil, automático | Francisca | Antonio |

El servidor conserva voces automáticas para francés, alemán e italiano porque
la app también puede producir textos en esos idiomas. No aparecen en el selector
de acento y evitan que una traducción se lea con una voz española.

Configuración incluye tres muestras independientes: **Probar español**, **Probar
inglés** y **Probar portugués**. La muestra española ya no mezcla una frase
inglesa, por lo que permite comparar el acento desde la primera palabra.

### Fish Audio y ElevenLabs

Ambos servicios se pueden conectar a través del backend, con la clave guardada
como variable de entorno y nunca en `index.html`:

- [Fish Audio](https://docs.fish.audio/api-reference/introduction) ofrece
  `POST /v1/tts`, voces por `reference_id` y streaming WebSocket. Su
  [tarifa API publicada](https://docs.fish.audio/developer-guide/models-pricing/pricing-and-rate-limits)
  es de USD 15 por millón de bytes UTF-8 para `s1`/`s2-pro`.
- [ElevenLabs](https://elevenlabs.io/docs/overview/capabilities/text-to-speech)
  ofrece catálogo de voces y streaming; Flash prioriza latencia y Multilingual
  v2 calidad. La [tarifa API publicada](https://elevenlabs.io/pricing/api?price.platform=api)
  es de USD 0,05/1.000 caracteres para Flash/Turbo y USD 0,10/1.000 para
  Multilingual v2/v3.

**Decisión de esta entrega:** no se activó un proveedor de pago sin una cuenta,
clave y autorización de gasto del usuario. Se corrigió primero el motor neural
actual, gratuito y ya desplegable. Una integración posterior puede añadir el
proveedor como opción sin exponer la clave y conservar Edge como respaldo.

### Validación local

- Sintaxis: `python test_js_syntax.py` y `python -m py_compile` en API/local.
- Cola y preferencias: `test_cola_tts.js` y `test_tts_reproductor.js`.
- Configuración a request: `tests/test_tts_configuracion.js` comprueba que `regional`
  es el valor inicial, que `auto` migra a `regional` y que Chile/Perú llegan al
  servidor como `locale` distintos con `unified: false`.
- Motor real `edge-tts 7.2.8`: `test_tts_unificado.py` y
  `test_tts_idiomas.py`; se generó audio distinto para CO, CL, PE, EN y PT, y
  las cabeceras `X-TTS-Voice` coincidieron con la voz pedida.
- La lista vigente consultada con `edge_tts.list_voices()` contenía 322 voces;
  el catálogo mostrado por JG Turbo se redujo a los seis acentos latinos de la
  tabla.
- Chromium real + API local (`test_tts_navegador.js`): 24 comprobaciones
  pasadas; primer audio en 2.851 ms en esa ejecución, 0 muestras congeladas,
  8 bloques listos por delante, cambio de velocidad en 1 ms y repetición desde
  caché en 39 ms. Son medidas de esa red y equipo, no una garantía universal.
- Regresión general: 85 pruebas de backend pasadas. `backend/tests/test_transcribe.py`
  no terminó dentro de cuatro minutos esperando que cargara el modelo Whisper
  local; se reporta separado porque no prueba el módulo TTS.
- Revisión visual con Playwright en 1280×900 y 390×844: los siete valores del
  selector caben, los tres botones de muestra se ajustan a dos filas en móvil y
  conservan 44 px de alto; el modal permite desplazarse hasta ellos. Los 404 de
  `/ping` observados pertenecen al servidor estático de la revisión.

### Verificación en producción

Validado el 2026-08-14 contra el dominio real
`https://jg-turbo.vercel.app`, no solo contra la URL temporal de Vercel:

| Comprobación | Resultado |
|---|---|
| Deployment | `dpl_6y86RK1e9XNkacbkGEdrmXAYQwic` · target `production` · `Ready` |
| HTML | Marcadores `v2.9.0`, `regional`, Chile, Perú y tres botones de muestra presentes |
| Service Worker | `jg-turbo-shell-v13` |
| `GET /api/health` | `status: ok`, modelo listo, YouTube automático activo |
| `GET /api/tts-voices` | `edge-neural-regional`, default `es-CO`, seis acentos latinos |
| Colombia | `es-CO-SalomeNeural` · 23.040 bytes |
| México | `es-MX-DaliaNeural` · 26.208 bytes |
| Argentina | `es-AR-ElenaNeural` · 24.336 bytes |
| Chile | `es-CL-CatalinaNeural` · 24.480 bytes |
| Perú | `es-PE-CamilaNeural` · 21.024 bytes |

Los tamaños son de una frase corta de verificación y solo prueban que se generó
audio distinto con la voz solicitada; no son una medida de calidad perceptual.

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
3. **Modo regional (`regional`, predeterminado desde v2.9.0):** el español usa
   el acento latino elegido y los tramos ingleses usan Ava/Andrew. Portugués y
   los demás idiomas admitidos usan su propia voz nativa.
4. **Modo «Una voz» (`unified`, opcional):** el texto se parte solo por longitud
   y se envía a Ava/Andrew multilingüe. Conserva el timbre, pero no aplica el
   selector de acento español.
5. **Solo idioma principal (`off`):** no alterna la voz dentro del texto.

Flujo regional (`regional`; también recibe el valor histórico `auto`):

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

### Modo «Una voz» (`unified`, opcional desde v2.9.0)

| Rol | Voz neural | Respaldo |
|---|---|---|
| Mujer | `en-US-AvaMultilingualNeural` | `en-US-EmmaMultilingualNeural` |
| Hombre | `en-US-AndrewMultilingualNeural` | `en-US-BrianMultilingualNeural` |

Hablan español fluido y pronuncian el inglés en inglés **sin cambiar de voz**.
Acento español neutro-latino (no hay voces es-* Multilingual en Edge).

### Modo regional (`regional`, predeterminado)

| Rol | Voz neural | Notas |
|---|---|---|
| Mujer · español inicial | `es-CO-SalomeNeural` | Colombia; se cambia con el selector de acento |
| Hombre · español inicial | `es-CO-GonzaloNeural` | Colombia; se cambia con el selector de acento |
| Mujer · inglés | `en-US-AvaNeural` | Voz conversacional nativa de inglés |
| Hombre · inglés | `en-US-AndrewNeural` | Voz conversacional nativa de inglés |
| Mujer · portugués | `pt-BR-FranciscaNeural` | Automática al detectar portugués |
| Hombre · portugués | `pt-BR-AntonioNeural` | Automática al detectar portugués |

### Todos los acentos

| Acento | Femenina | Masculina |
|---|---|---|
| Colombia | `es-CO-SalomeNeural` | `es-CO-GonzaloNeural` |
| México | `es-MX-DaliaNeural` | `es-MX-JorgeNeural` |
| Argentina | `es-AR-ElenaNeural` | `es-AR-TomasNeural` |
| Chile | `es-CL-CatalinaNeural` | `es-CL-LorenzoNeural` |
| Perú | `es-PE-CamilaNeural` | `es-PE-AlexNeural` |
| Latino EE. UU. | `es-US-PalomaNeural` | `es-US-AlonsoNeural` |
| Inglés EE. UU. | `en-US-AvaNeural` | `en-US-AndrewNeural` |

### Fallbacks si falla la síntesis

| Idioma | Género | Orden |
|---|---|---|
| es | female | Salomé → Dalia → Elena → Catalina → Camila |
| es | male | Gonzalo → Jorge → Tomás → Lorenzo → Alex |
| en | female | Ava → Emma → Aria → Jenny |
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
| `ttsResolveNeuralLocale` | auto → Colombia; otros idiomas → locale nativo |
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

### 3.6 Prosodia (cliente → servidor) — v2.9.0

| Condición | Ajuste |
|---|---|
| EN (cualquier género) | `tone = neutral` (no distorsionar pronunciación) |
| Todos los idiomas | El servidor genera a 1×; el navegador aplica `playbackRate` sin regenerar |
| Servidor warm | −3 % rate, `pitch` intacto |
| Servidor energetic | +3 % rate, `pitch` intacto, +1 % volumen |
| Respaldo del navegador | `pauseMs = 0` entre bloques; `pitch = 1` |

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
- Acento español: Colombia (inicial) | México | Argentina | Chile | Perú | Latino EE. UU.
- Cambio de idioma: **Voces nativas (`regional`, recomendado)** | Una voz multilingüe (`unified`) | Solo idioma principal (`off`)
- Tono: neutral | cálido | enérgico
- Velocidad fina + **Probar español / inglés / portugués**

> En modo «Una voz», el selector de acento no cambia la voz porque Ava/Andrew
> tienen base `en-US`; el acento sí aplica en «Voces nativas» y «Solo idioma principal».

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
  "unified": false
}
```

| Campo | Valores | Notas |
|---|---|---|
| `text` | string | Máx. 2800 en servidor; cliente ~900 por fragmento |
| `voice` | `female` \| `male` | Género |
| `rate` | 0.75–2.0 | Velocidad |
| `language` | `es` \| `en` | El servidor puede forzar `en` si el texto es tech puro (solo modo legado; en `unified` se ignora) |
| `locale` | `es-CO` `es-MX` `es-AR` `es-CL` `es-PE` `es-US` | Solo aplica si el idioma final es ES |
| `tone` | `neutral` `warm` `energetic` | Prosodia |
| `unified` | `true` \| `false` | **v2.7.0.** `true`: voz multilingüe única (Ava/Andrew), sin force-EN; headers `X-TTS-Language: multi` y `X-TTS-Engine: edge-neural-unified` |

### Response

- Cuerpo: `audio/mpeg`  
- Headers: `X-TTS-Voice`, `X-TTS-Rate`, `X-TTS-Pitch`, `X-TTS-Tone`, `X-TTS-Language`, `X-TTS-Locale`, `X-TTS-Engine`

### Catálogo recomendado (v2.9.0)

```json
{
  "engine": "edge-neural-regional",
  "default_locale": "es-CO",
  "recommended": {
    "female_locale": "es-CO",
    "female_voice": "es-CO-SalomeNeural",
    "male_locale": "es-CO",
    "male_voice": "es-CO-GonzaloNeural",
    "english_female": "en-US-AvaNeural",
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
**v2.9.0:** `jg_tts_bilingual` usa `regional` como valor inicial. El valor
histórico `auto` se interpreta como `regional`; `unified` sigue disponible sin
renombrar ni borrar la clave.

| Clave | Valores | Default |
|---|---|---|
| `jg_tts_engine` | `neural` \| `browser` | `neural` |
| `jg_tts_gender` | `female` \| `male` | `female` |
| `jg_tts_locale` | `auto` \| `es-CO` \| `es-MX` \| `es-AR` \| `es-CL` \| `es-PE` \| `es-US` | `auto` |
| `jg_tts_bilingual` | `regional` \| `unified` \| `off` | `regional` |
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
cd "C:\Users\juanl\Documents\Proyectos\JG Turbo\vercel_deploy"
npx vercel --prod --yes --scope jhoncod24s-projects
```

⚠️ `--cwd vercel_deploy` **ya no sirve**: con Vercel CLI 59.x devuelve
`Not authorized` aunque `npx vercel whoami` responda `jhoncod24`
(comprobado 2026-08-15). Entrar en la carpeta y pasar `--scope`.

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
3. Consola del navegador debe mostrar `v2.9.0`.
4. Configuración: motor **neural**, cambio de idioma **Voces nativas**.
5. Pulsar **Probar español** con Colombia, México, Argentina, Chile y Perú.
6. Pulsar **Probar inglés** y **Probar portugués** con Mujer y Hombre.
7. Probar un texto largo con:

```text
Hola. JG Turbo usa OpenAI, Python y Node.js.
The API works in real time.
ChatGPT, GitHub y machine learning.
Configura el endpoint del backend en Vercel.
```

**Esperado (Voces nativas):**

- Cada acento español devuelve un `X-TTS-Voice` distinto y coherente con el país.
- Inglés usa Ava/Andrew; portugués usa Francisca/Antonio.
- No hay demora artificial entre bloques del respaldo del navegador.

**Esperado (Una voz, opcional):**

- Una sola voz (Ava multilingüe / Andrew multilingüe) para todo el texto.
- El aviso aclara que el selector de acento regional no aplica.

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
| **2.9.0 (regional real)** | **`dpl_6y86RK1e9XNkacbkGEdrmXAYQwic`** | **Ready** | Acentos CO/MX/AR/CL/PE/es-US reales, default regional, catálogo curado (2026-08-14) |
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
