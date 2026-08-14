---
meta:
  title: Cómo funciona la captura, transcripción y traducción mejoradas
  navLabel: Precisión de audio
  contentType: Reference
  category: Audio y lenguaje
  audience: Personas usuarias, mantenimiento y desarrollo
  goal: Explicar los cambios, verificarlos y mantener su precisión
  status: Implementado con benchmark real pendiente
lastUpdated: 2026-08-01
---

# Cómo funciona la captura, transcripción y traducción mejoradas

Este documento registra la optimización integral de audio y lenguaje de JG Turbo. Explica qué cambió, cómo responde el sistema, qué pruebas pasaron y qué falta validar con grabaciones reales.

## Grabaciones largas (4–10+ min) — fix 2026-08-01

### Causa raíz del fallo con ~4 minutos en producción

1. Al detener el micrófono, `acondicionarAudioParaWhisper()` convierte el audio a **WAV PCM 16 kHz mono 16-bit** (~**1,92 MB por minuto**).
2. **4 min ≈ 7,7 MB**.
3. En **Vercel Functions** el body de la request tiene un techo de ~**4,5 MB**. El POST a `/api/transcribe` se rechaza (**413 / payload too large**) **antes** de llegar a Groq.
4. El límite de Groq (25 MB) y el de la API (`MAX_AUDIO_MB`) **no** eran el cuello de botella: fallaba la plataforma.

### Solución (frontend)

| Pieza | Comportamiento |
|---|---|
| `_decodificarYAcondicionar` | Remuestrea, recorta silencio, normaliza; devuelve muestras + WAV |
| `_audioPuntoCorte` | Valle RMS en **±6 s** alrededor del corte (no partir palabras) |
| `_segmentarMuestrasEnWav` | Tramos de **~100 s** (~3,2 MB), solape **0,4 s** |
| `prepararSegmentosTranscripcion` | 1 parte si WAV ≤ techo; si no, N partes |
| Techo nube | `AUDIO_LIMITE_SUBIDA_NUBE` = **3,6 MB** (bajo 4,5 MB de Vercel) |
| Techo local | `(maxMb-1)` ≈ 49 MB → 10–15 min suelen ir **enteros** (más rápido) |
| `transcribirAudio` | Cada parte: timeout propio + **1 reintento** (1,5 s). Si falla parte 2+: conserva texto ya hecho |
| UI | «Hasta 15 min en la nube»; progreso «parte X de Y» (y «reintento» si aplica) |

Límites prácticos:

- **Partes automáticas** de ~100 s en la nube (no cortar a mano).
- **15 min** acondicionables en el navegador (`AUDIO_MAX_SEG = 900`).
- **~25 MB** por trozo hacia Groq.

### Evidencia medida (prod, 2026-08-01)

| Audio sintético | Tamaño | Respuesta |
|---|---:|---|
| 1 min WAV 16 kHz | 1,83 MB | **HTTP 200** |
| 5 min WAV 16 kHz | 9,16 MB | **HTTP 413** (plataforma, sin llegar a la app) |

### Pruebas

- `backend/tests/test_segmentacion_upload.py` — techos y conteo (4/5/10 min, 100 s).
- Manual: grabar ≥4 min en https://jg-turbo.vercel.app → «parte 1 de N…».

## Estado de la implementación

La aplicación ya incluye captura reforzada, transcripción final con Whisper, contexto técnico, traducción bidireccional, **transcripción por segmentos en la nube** y validación independiente. El benchmark con 100 audios reales sigue pendiente porque el repositorio no contiene grabaciones autorizadas ni referencias humanas.

| Área | Estado | Evidencia |
|---|---|---|
| Captura mono con mínimo solicitado de 16 kHz y 16 bits | Implementada | `index.html` solicita restricciones compatibles y consulta los ajustes reales |
| Cancelación de eco, supresión de ruido y ganancia automática | Implementada | El navegador recibe las tres restricciones cuando las soporta |
| Medición de ruido durante la grabación | Implementada | La interfaz calcula nivel RMS y una relación voz/ruido aproximada |
| Transcripción final en inglés y español | Implementada | Whisper procesa la grabación completa al detener |
| Contexto para nombres y términos técnicos | Implementado | `jg_glossary` se envía como contexto de reconocimiento |
| Detección de fragmentos ambiguos | Implementada | La respuesta marca segmentos de baja confianza |
| Traducción inglés ↔ español | Implementada | El flujo acepta `en-es` y `es-en` |
| Validación contra omisiones e invenciones | Implementada | Un validador determinista revisa invariantes |
| Edición manual de transcripción y traducción | Implementada | Ambos resultados permanecen editables |
| Pruebas deterministas de lenguaje | 4 de 4 aprobadas | Incluyen 50 casos textuales en inglés y 50 en español |
| Benchmark de audio real | Pendiente | Requiere 50 audios reales por idioma |
| Despliegue de estos cambios en producción | Desplegado | Producción validada el 23 de julio de 2026 |

## Flujo actual de principio a fin

El flujo conserva el audio y el texto útil en cada etapa para reducir repeticiones.

```text
Micrófono
  → restricciones de captura compatibles
  → medición de nivel y ruido
  → vista previa de Web Speech cuando está disponible
  → grabación completa
  → Whisper con idioma y glosario
  → análisis de segmentos
  → transcripción editable
  → traducción literal
  → validación independiente
  → traducción editable o alerta de revisión
```

Si Whisper falla, la aplicación conserva la vista previa en vivo. La persona puede editarla sin repetir toda la intervención.

## Mejoras en la captura del micrófono

La captura solicita una señal adecuada para reconocimiento de voz sin asumir que todos los navegadores aceptan los mismos parámetros.

### Restricciones solicitadas

La aplicación pide estas condiciones mediante `getUserMedia`:

- **Canal**: mono
- **Frecuencia de muestreo**: mínimo 16 kHz e ideal 48 kHz, cuando el navegador admite la restricción
- **Profundidad de muestra**: mínimo e ideal 16 bits, cuando está disponible
- **Cancelación de eco**: desactivada
- **Supresión de ruido**: desactivada
- **Control automático de ganancia**: activo

> **Por qué el eco y el ruido van desactivados** (cambiado el 2026-07-30). Esos dos filtros del
> navegador están afinados para llamadas telefónicas, no para dictado: recortan las frecuencias
> altas y se comen las consonantes sordas del español (/s/, /f/, /x/), que es justo lo que
> Whisper necesita para distinguir palabras. Con un micrófono cerca de la boca, el audio crudo
> da mejor resultado. La limpieza que sí ayuda se hace después, en la propia app (ver más abajo).

Si el navegador rechaza una restricción avanzada, la aplicación repite la solicitud con una configuración compatible. Este segundo intento mantiene audio mono y los controles acústicos básicos.

### Acondicionamiento antes de enviar (añadido el 2026-07-30)

Whisper trabaja internamente a 16 kHz mono, así que la app prepara el audio antes de subirlo
en lugar de mandar la grabación tal cual. La función `acondicionarAudioParaWhisper()` en
`index.html`:

1. **Remuestrea a 16 kHz mono** con `OfflineAudioContext`. Es el formato que el modelo va a
   usar de todas formas, y de paso el archivo pesa bastante menos.
2. **Recorta el silencio** del principio y del final. El umbral no es fijo: estima el piso de
   ruido con el percentil 20 de ventanas RMS de 20 ms, de modo que se adapta a un cuarto
   silencioso o a una calle ruidosa. Deja 150 ms de aire a cada lado para no cortar la primera
   consonante ni la última sílaba.
3. **Empareja el volumen**: lleva el pico a −1 dBFS, con un tope de ganancia de ×8 para no
   amplificar el ruido de fondo de una grabación casi muda.
4. **Serializa a WAV PCM de 16 bits**, sin pérdida.

Los silencios largos son el disparador principal de las frases inventadas de Whisper
(«gracias por ver el video», «subtítulos por Amara.org»). El filtro anti-alucinación del
servidor sigue existiendo, pero es mejor no generarlas.

**Salvaguardas.** Si el formato no se puede decodificar, se envía el audio original sin tocar.
El techo de acondicionamiento es **15 min** / **20 MB** de origen; más allá se intenta el
original. Nunca se pierde una grabación por culpa de este paso. Tras acondicionar, si el WAV
no cabe en un solo POST a Vercel (techo 3,6 MB), se **parte en tramos de ~100 s** (ver
«Grabaciones largas»).

**Medición** con una grabación sintética de 1,5 s de silencio + 2 s de voz floja + 1,5 s de
silencio: 5 s → 2,3 s de duración, ganancia ×8 y 468 KB → 72 KB (−85 % de peso).

**Sobre el selector «Calidad del micrófono»** (64 / 96 / 128 kbps): afecta al peso de la
grabación, no a la precisión. Opus mono de voz ya es transparente alrededor de 48 kbps, y
además el audio se reconvierte a 16 kHz antes de enviarse. El texto de ayuda en la interfaz
se corrigió para no prometer una mejora de precisión que no ocurre.

### Verificación de la captura real

La interfaz consulta `MediaTrackSettings` después de abrir el micrófono. Así muestra la frecuencia, profundidad y controles que el navegador aceptó.

Algunos navegadores no informan `sampleRate` o `sampleSize`. En ese caso, la interfaz indica que el valor fue solicitado, pero no confirmado.

### Perfiles de calidad

| Perfil | Bitrate |
|---|---:|
| Rápido | 64 kbps |
| Dictado | 96 kbps |
| Precisión | 128 kbps |

El perfil seleccionado sigue guardado en `jg_mic_quality`. Ningún cambio renombró o borró claves `jg_*`.

### Medición de ruido

El visualizador calcula la raíz cuadrática media (RMS) de la señal. RMS expresa el nivel promedio del audio durante un intervalo corto.

La aplicación estima una relación entre voz y ruido. Una advertencia informa ruido moderado o alto sin detener la grabación. La medición orienta la captura, pero no sustituye una prueba acústica ni un procesador digital de señal dedicado.

## Mejoras en la transcripción

La transcripción combina respuesta inmediata y análisis final de mayor calidad.

### Vista previa y resultado final

Chrome y Edge pueden mostrar una vista previa mediante Web Speech. Al detener la grabación, Whisper procesa el audio completo y reemplaza esa vista previa.

Web Speech funciona como respaldo si el servidor no responde. Esta decisión evita perder una intervención ya capturada.

### Modelo de producción

La función de Vercel usa `whisper-large-v3` por defecto. La variable `GROQ_ASR_MODEL` permite cambiarlo sin editar código.

La solicitud a Groq usa:

- `response_format=verbose_json`
- `temperature=0`
- Marcas de tiempo por segmento
- Idioma explícito cuando la persona lo selecciona
- Un prompt corto con el glosario

El formato detallado permite revisar cada segmento antes de mostrar el texto final.

### Modelo local

El backend local usa `faster-whisper`. Los modelos `small` y `medium` son los recomendados para validar precisión.

Los modelos `tiny` y `base` consumen menos recursos, pero no deben certificar la meta de precisión. La variable `WHISPER_MODEL` selecciona el modelo local.

### Glosario y contexto lingüístico

La aplicación lee `jg_glossary` y envía su contenido como el campo `context`. La API limita ese campo a 4.000 caracteres.

El constructor conserva nombres, cifras, siglas y expresiones coloquiales. Usa hasta 45 términos y limita el prompt a 850 caracteres. El glosario no reemplaza el texto hablado ni aplica correcciones globales ambiguas.

### Revisión de segmentos

`calidad_linguistica.py` analiza probabilidad de ausencia de voz, probabilidad logarítmica, relación de compresión y texto. El sistema elimina un segmento solo cuando las señales indican ruido o una frase alucinada conocida.

Los casos dudosos permanecen en el texto y se marcan para revisión. La respuesta incluye:

```json
{
  "text": "Final transcription",
  "language": "en",
  "model": "whisper-large-v3",
  "segments": [],
  "low_confidence_segments": 0,
  "removed_hallucinations": 0,
  "needs_review": false,
  "requires_confirmation": false,
  "review_segments": []
}
```

`requires_confirmation` se activa cuando aparecen dos segmentos descartados o más del 35 % de los segmentos resultan dudosos.

### Corrección automática y manual

La corrección automática usa reglas deterministas. No envía el texto a un modelo de lenguaje ni reescribe ideas en silencio.

La mejora con inteligencia artificial (IA) permanece como acción manual. La interfaz muestra una vista previa antes de aceptar la sustitución.

## Mejoras en la traducción

La traducción admite ambos sentidos entre inglés y español. El resultado conserva el orden y la información del texto original.

### Instrucción de traducción

El prompt exige traducir cada oración en el mismo orden. También conserva párrafos, nombres, términos técnicos, enlaces, correos, cifras, unidades e incertidumbre.

El modelo no debe resumir, explicar, completar ni mejorar las ideas. Si no existe una clave válida, el flujo intenta MyMemory como respaldo.

### Validación independiente

El traductor no califica su propia respuesta. `validar_traduccion()` compara origen y resultado mediante reglas deterministas:

- Traducción vacía o sin cambios entre idiomas distintos
- Reducción compatible con una omisión
- Crecimiento compatible con información inventada
- Cifras, enlaces o correos eliminados o añadidos
- Cambios en nombres o términos técnicos
- Pérdida de la estructura de párrafos

La API devuelve:

```json
{
  "text": "Traducción",
  "ia_used": true,
  "provider": "gemini",
  "model": null,
  "error_detail": null,
  "direction": "en-es",
  "validation": {
    "status": "ok",
    "integrity_score": 100,
    "requires_confirmation": false,
    "issues": [],
    "checks": {
      "length_ratio": 1.0,
      "numbers_preserved": true,
      "structure_preserved": true
    },
    "method": "deterministic-invariants-v1"
  }
}
```

Una anomalía crítica cambia `status` a `alert` y activa `requires_confirmation`. La interfaz solicita confirmación antes de reemplazar texto.

Una puntuación de 100 significa que pasaron las reglas implementadas. No certifica equivalencia semántica perfecta ni reemplaza una revisión humana especializada.

### Corrección adicional del flujo de traducción · 2026-08-01

La revisión completa encontró dos fallos que no cubrían las pruebas anteriores:

- El backend local reutilizaba como resultado el trozo original cuando MyMemory fallaba; una traducción larga podía quedar mezclada en inglés y español.
- La interfaz conservaba una alerta de integridad después de cambiar o borrar el texto, aunque ya no describiera el contenido actual.

La corrección aplica la misma regla en local y en Vercel: cada trozo debe traducirse o la operación falla de forma visible. También limpia marcas SRT/VTT y horas de YouTube antes de traducir, divide textos largos para la IA, elimina preámbulos como «Here is the translation:» y rechaza respuestas vacías. En el panel, la alerta se invalida al editar, intercambiar idiomas o limpiar.

La prueba de regresión confirma que un fallo de MyMemory ya no devuelve el original como si fuera traducción. El texto original se conserva para que la persona pueda reintentar, pero nunca se presenta como resultado traducido.

El cambio quedó publicado en producción con deployment `dpl_7x7c2yKjhyzFV98wF3s83huPoZ8B` (Ready) y alias `https://jg-turbo.vercel.app`.

## Mejoras en la interfaz

La interfaz permite completar el flujo sin perder control sobre el texto:

- La transcripción y la traducción permanecen editables
- El estado de validación usa `aria-live`
- Los campos de micrófono y traducción tienen etiquetas
- El lienzo decorativo no interfiere con lectores de pantalla
- Los estados de grabación, revisión y error resultan visibles
- Los botones conservan áreas táctiles adecuadas
- La vista móvil evita superposición entre editor y acciones
- La página puede desplazarse en pantallas pequeñas
- La prueba en 390 × 844 píxeles no detectó desplazamiento horizontal

También se retiraron transiciones CSS globales con `transition: all`. Cada componente anima solo las propiedades necesarias.

## Robustez, privacidad y persistencia

Los cambios conservan la configuración existente y evitan que un error destruya trabajo útil:

- Ninguna clave `jg_*` se borró o renombró
- `jg_glossary` sigue siendo la fuente del contexto técnico
- `jg_mic_quality` conserva el perfil de grabación
- Las claves de API no se escriben en el repositorio
- Los archivos temporales se eliminan después del procesamiento
- Los errores de red muestran un mensaje comprensible
- El texto en vivo se conserva si falla la transcripción final
- Los resultados críticos requieren confirmación
- El corpus real y sus reportes están excluidos mediante `.gitignore`

Consulta [Cómo conservar la configuración](CONFIG_PERSISTENTE.md) antes de modificar almacenamiento local.

## Dependencias actualizadas

La optimización no añadió una biblioteca externa para audio o validación. Usa Web APIs y la biblioteca estándar de Python.

| Entorno | Dependencias principales |
|---|---|
| Vercel | `fastapi>=0.115.0,<1.0`, `python-multipart>=0.0.20,<1.0`, `pydantic>=2.10.0,<3.0`, `httpx>=0.28.1,<1.0`, `yt-dlp>=2024.3.10`, `youtube-transcript-api>=1.0.0` |
| Local | Las anteriores aplicables, `uvicorn>=0.34.0,<1.0`, `faster-whisper>=1.2.1,<2.0`, `anthropic>=0.40.0,<1.0` |
| Pruebas | `pytest>=8.0.0,<9.0`, `httpx>=0.28.1,<1.0` |

Instala las dependencias de desarrollo desde la carpeta de la aplicación:

```powershell
python -m pip install -r backend\requirements-dev.txt
```

## Inventario de archivos modificados

| Archivo | Cambio |
|---|---|
| `index.html` | Captura, ruido, flujo final, glosario, alertas, edición y accesibilidad |
| `api/index.py` | Whisper detallado, contexto, segmentos y validación en Vercel |
| `api/calidad_linguistica.py` | Reglas compartidas de reconocimiento y traducción |
| `api/requirements.txt` | Versiones mínimas y límites mayores |
| `backend/app.py` | Contexto, análisis local y validación de traducción |
| `backend/calidad_linguistica.py` | Copia local de las reglas compartidas |
| `backend/benchmark_audio.py` | Benchmark reproducible con audios reales |
| `backend/tests/test_calidad_linguistica.py` | Pruebas de invariantes lingüísticas |
| `backend/corpus/README.md` | Reglas del corpus privado |
| `backend/corpus/manifest.example.jsonl` | Ejemplo de muestra etiquetada |
| `backend/requirements*.txt` | Dependencias locales y de pruebas |
| `.gitignore` | Exclusión de audios, manifiesto y reportes reales |
| `backend/README.md` | Requisitos y vínculo a esta referencia |
| `PRECISION_AUDIO.md` | Registro maestro de la optimización |

`api/calidad_linguistica.py` y `backend/calidad_linguistica.py` deben permanecer idénticos.

## Verificación ejecutada

Las pruebas validan código, reglas y presentación. No sustituyen el benchmark acústico pendiente.

| Verificación | Resultado |
|---|---|
| Compilación de módulos Python | Aprobada |
| Análisis sintáctico del JavaScript con Node.js | Aprobado |
| Pruebas deterministas | 4 de 4 aprobadas |
| Casos textuales de invariantes | 50 en inglés y 50 en español aprobados |
| Revisión en navegador de escritorio | Aprobada |
| Revisión móvil en 390 × 844 | Aprobada |
| Desbordamiento horizontal móvil | No detectado |
| Solapamiento entre editor y acciones | No detectado |
| Búsqueda estática de secretos comunes | Sin claves detectadas |
| Revisión con `git diff --check` | Aprobada |
| Suite completa con el entorno virtual sincronizado | No completada, el entorno virtual dejó de responder |
| Benchmark con 100 audios reales | No ejecutado |

La revisión usó un servidor estático sin API. Por eso la consola mostró respuestas 404 para `/ping`; ese resultado era esperado.

## Cómo ejecutar las pruebas

Ejecuta primero las pruebas deterministas:

```powershell
python -m pytest backend\tests -q
```

Después valida la sintaxis de Python:

```powershell
python -m py_compile api\index.py api\calidad_linguistica.py backend\app.py backend\calidad_linguistica.py backend\benchmark_audio.py
```

## Cómo preparar el benchmark de 100 audios

El benchmark exige grabaciones reales autorizadas. No genera voces sintéticas ni inventa resultados.

### Requisitos del corpus

Incluye como mínimo:

- 50 audios en inglés
- 50 audios en español
- Una transcripción humana literal por audio
- Una traducción humana por audio si validas traducción
- Acentos, micrófonos y ruido moderado representativos
- Consentimiento para usar cada grabación

No incluyas datos personales innecesarios. No subas grabaciones ni claves a Git.

### Formato y ejecución

Crea `backend/corpus/manifest.jsonl`. Cada línea debe contener un objeto JSON:

```json
{"id":"en-001","audio":"audio/en-001.wav","language":"en","transcript":"Expected English text.","translation":"Texto esperado en español.","context":"OpenAI, JG Turbo"}
```

Usa [el manifiesto de ejemplo](backend/corpus/manifest.example.jsonl) como punto de partida. Inicia el backend local y ejecuta:

```powershell
python backend\benchmark_audio.py backend\corpus\manifest.jsonl --traducir --report benchmark-report.json
```

El script exige WER máximo de 5 % por muestra aprobada, tasa total de 98 % y cero alertas críticas. WER significa tasa de error por palabras.

El proveedor predeterminado es `none`. No uses `--api-key` ni un proveedor de pago sin autorización.

### Resultado pendiente

| Métrica | Resultado |
|---|---|
| Muestras en inglés | `[DATO PENDIENTE]` |
| Muestras en español | `[DATO PENDIENTE]` |
| Tasa total de éxito | `[DATO PENDIENTE]` |
| WER promedio | `[DATO PENDIENTE]` |
| Alertas de traducción | `[DATO PENDIENTE]` |
| Fecha y versión del modelo | `[DATO PENDIENTE]` |

No publiques una cifra de precisión hasta completar esta tabla con evidencia reproducible.

## Cómo desplegar sin perder cambios

La aplicación productiva usa `vercel_deploy/`. Sincroniza estos archivos desde `Spech to text App/`:

1. Copia `index.html`
2. Copia toda la carpeta `api/`, incluido `api/calidad_linguistica.py`
3. Copia `vercel.json` si cambió
4. Compara los archivos antes de desplegar
5. Ejecuta las pruebas
6. Despliega solo con autorización

Los cambios documentados se desplegaron el 23 de julio de 2026. El despliegue productivo `dpl_4Tn6LGpk5aweHLocSFiVaGGcPqbf` quedó en estado `Ready`.

Consulta [Cómo desplegar JG Turbo en Vercel](DOCUMENTACION_DESPLIEGUE.md) para el procedimiento completo.

## Cómo mantener la precisión

1. Conserva idénticos los dos archivos `calidad_linguistica.py`
2. Añade nombres reales al glosario sin crear sustituciones fonéticas globales
3. Ejecuta pruebas unitarias antes de editar umbrales
4. Ejecuta el benchmark real antes de cambiar el modelo
5. Separa resultados por idioma, acento, micrófono y ruido
6. Documenta falsos positivos y falsos negativos
7. Ajusta umbrales con evidencia del corpus
8. Conserva las claves `jg_*` o crea una migración
9. Prueba escritorio y celular
10. Revisa que ningún secreto aparezca en el diff

## Límites conocidos

- El navegador puede ignorar `sampleRate` o `sampleSize`
- El dispositivo controla parte de la cancelación de eco y ruido
- La relación voz/ruido es una estimación visual
- Ningún modelo garantiza 95 % o 98 % para todos los acentos y entornos
- El validador detecta anomalías observables, no significado humano completo
- MyMemory depende de un servicio externo
- Groq requiere una clave válida y respeta límites de tamaño y uso
- El backend local necesita FFmpeg y recursos suficientes

La métrica aplicable a JG Turbo debe salir del corpus propio.

## Solución de problemas

| Síntoma | Causa probable | Acción |
|---|---|---|
| El navegador no confirma 16 kHz o 16 bits | No expone esos ajustes | Revisa el estado y prueba otro navegador |
| El ruido aparece alto | Micrófono distante, ventilador o eco | Acerca el micrófono y reduce el ruido |
| La transcripción marca revisión | Whisper detectó baja confianza | Escucha y edita solo ese fragmento |
| Whisper falla al detener | Falta una clave, límite o red | Conserva la vista previa y revisa Configuración |
| Un nombre técnico cambia | Falta en el contexto | Añádelo a `jg_glossary` |
| La traducción muestra alerta | Faltan cifras, enlaces o contenido | Compara origen y resultado |
| La traducción no usa IA | Falta una clave o el proveedor es `none` | Configura el proveedor o acepta el respaldo |
| El backend local no inicia | Dependencias o FFmpeg incompletos | Sigue `backend/README.md` |

## Referencias

- [Restricciones compatibles de Media Capture en MDN](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getSupportedConstraints)
- [Ajustes reales de una pista de audio en MDN](https://developer.mozilla.org/en-US/docs/Web/API/MediaStreamTrack/getSettings)
- [Documentación de Speech to Text de Groq](https://console.groq.com/docs/speech-to-text)
- [Referencia de faster-whisper](https://github.com/SYSTRAN/faster-whisper)
