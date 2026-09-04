# 📋 Ficha Técnica y Manual de Uso · JG Turbo

Bienvenido a la documentación oficial de **JG Turbo**, una suite de captura, transcripción y traducción para navegador, Vercel y servidor local.

## YouTube con voz y traducción sincronizadas

En el panel YouTube, **Traducir y doblar al español** obtiene la pista inglesa
con tiempos y traduce cada segmento de forma fiel. No pasa por Pulir, no resume,
no elimina repeticiones y no reescribe el contenido. Los segmentos vecinos solo
aportan contexto para entender la frase; ninguna palabra se mueve de timestamp.

El subtítulo visible y la voz utilizan exactamente la misma traducción.
**Reproducir con voz en español** silencia el audio inglés y reproduce la voz en
el punto correspondiente.

La voz nunca se ralentiza para llenar una ventana. Habla al ritmo seleccionado,
deja silencio si termina antes y solo se acelera cuando el español necesita más
tiempo para caber en el bloque.

El selector ofrece las velocidades que YouTube admite para ese video. La voz y
el texto usan el tiempo real del reproductor, por lo que se corrigen al pausar,
buscar o cambiar la velocidad. **Usar audio original** detiene el doblaje y
restaura el sonido de YouTube.

Si un segmento concreto no puede traducirse, conserva temporalmente el inglés y
continúa con el resto. El botón **Transcribir video** mantiene el flujo anterior
de texto completo editable.

## Pegado compacto · UX v3.8

Al pegar texto en Micrófono, Archivo, YouTube o «Editar en grande», los saltos
simples y las líneas vacías se convierten automáticamente en espacios. El texto
queda en un bloque continuo sin cambiar sus palabras ni su puntuación. Usa
**Párrafos** cuando quieras que JG Turbo lo distribuya en bloques legibles.

## Descarga de audio MP3 · TTS v2.10

En Micrófono, Archivo, YouTube, Traducción y «Editar en grande», abre
**Escuchar** y pulsa **MP3** para descargar todo el texto con la voz, acento,
tono y velocidad seleccionados. La preparación ocurre por bloques para soportar
textos largos y entrega un solo archivo. Requiere el motor Neural; las voces
locales del navegador se pueden reproducir, pero el navegador no permite
exportarlas como archivo.

## Actualización de audio y lenguaje del 23 de julio de 2026

La aplicación ahora verifica la calidad real del micrófono, mide ruido, procesa la grabación final con Whisper y marca fragmentos ambiguos. La traducción inglés ↔ español conserva invariantes y alerta ante posibles omisiones o invenciones.

Consulta [Cómo funciona la captura, transcripción y traducción mejoradas](PRECISION_AUDIO.md) para conocer el inventario completo, las pruebas y los límites. El benchmark de 100 audios reales está preparado, pero sigue pendiente por falta de un corpus autorizado.

### Actualización UX v3.5 · 2 de agosto de 2026

- En móvil, el botón **Grabar** queda flotante mientras se captura audio, aunque el texto en vivo sea extenso.
- La vista previa del dictado se desplaza dentro de su propia caja y no empuja el resto de la aplicación.
- Las opciones se muestran en dos columnas para reducir el alto del panel. Sus nombres cortos tienen explicación completa al mantener o enfocar el control.
- **Sensibilidad de la onda** solo cambia el movimiento visual del medidor. No cambia la grabación ni la precisión.
- **Puntuación**, **Preguntas** y **Código** actúan principalmente sobre el dictado en vivo del navegador. El resultado final de Whisper usa el audio completo y su puntuación propia.
- **Términos** usa el glosario y reglas técnicas. **Contexto** habilita la corrección contextual local o con IA configurada.
- Archivo conserva la detección automática de idioma. YouTube conserva su extracción automática y el pegado manual de respaldo.
- Esta entrega no cambia el motor de transcripción, las claves persistentes, el backend ni la apariencia de escritorio.

---

## 🔍 1. Descripción General del Producto
**JG Turbo** es una aplicación web de transcripción universal diseñada con una interfaz oscura, responsive y editable. En celular permite desplazamiento para evitar que el editor se superponga con las acciones. Permite transcribir:
1.  **Voz en vivo (Micrófono)**: Ideal para dictados rápidos y transcripciones inmediatas con formateo inteligente.
2.  **Archivos locales**: Procesa grabaciones largas, reuniones o notas de voz subidas en formatos de audio común (MP3, WAV, M4A, etc.).
3.  **Videos de YouTube**: Pega el enlace y la app trae el texto sola. Si el video no tiene subtítulos, lo transcribe con IA sin que hagas nada. Ver [Transcripción de YouTube](CAMBIOS_YOUTUBE.md).
4.  **Documentos PDF**: Una biblioteca de lectura. Saca el texto limpio de un PDF o de un libro completo (sin límite de tamaño, sin subir el archivo a ningún servidor) y **lo guarda en tu dispositivo con tu progreso**: al volver, sigues donde ibas sin buscar el archivo otra vez. La lectura se reanuda en la frase exacta donde quedó (ancla de texto portable entre pantallas) y el avance se sincroniza entre dispositivos sin resubir el libro. Índice de capítulos navegable, lectura continua, audiolibro, traducción al español dentro del panel, exportación a Word/PDF/Markdown, resumen con IA y OCR para escaneados. Ver [Lector de PDF](CAMBIOS_PDF.md).

---

## 🛠️ 2. Ficha Técnica y Arquitectura
*   **Interfaz (Frontend)**: HTML5, CSS3 vanilla y JavaScript nativo en un solo archivo, con diseño responsive y enfoque local-first.
*   **Servidor (Backend)**: FastAPI (Python) con una versión local y otra para Vercel. La versión local procesa audio con `faster-whisper`; Vercel usa Groq.
*   **Motores de transcripción**: `faster-whisper` en el backend local y `whisper-large-v3` mediante Groq en Vercel. Ambos reciben el glosario como contexto.
*   **OCR**: Tesseract 7 en el navegador, bajo demanda y solo para PDF escaneados (`js/vendor/tesseract/`). Nunca automático: cuesta segundos por página.
*   **PDF**: `pdf.js` (Mozilla) ejecutándose **en el navegador**, servido desde el propio proyecto (`js/vendor/pdfjs/`). No hay subida al servidor: Vercel limita las peticiones a ~4,5 MB y un libro no cabría. Limpieza propia del texto (párrafos, guiones de corte, encabezados repetidos) en `js/pdf/limpiezaTexto.js`. Detalle: `CAMBIOS_PDF.md`.
*   **YouTube**: **Supadata** como vía principal (sale por su propia infraestructura, que YouTube no bloquea, y genera el texto con IA si el video no tiene subtítulos). Antes de gastar un crédito se intenta gratis con `youtube-transcript-api`; **yt-dlp + Whisper de Groq** queda como respaldo. Detalle y medición: `CAMBIOS_YOUTUBE.md`.

---

## ⚙️ 3. Opciones Inteligentes y Configuración

El panel de micrófono incluye interruptores inteligentes (chips) que permiten moldear la salida de texto según el contexto. A continuación se detalla su uso:

### 🎤 Puntuación por Voz (`Punt`)
*   **Descripción**: Convierte palabras dictadas en signos de puntuación físicos en tiempo real.
*   **Cuándo aplicarlo**: Siempre que realices un dictado natural de texto corrido (correos, actas, apuntes).
*   **Comandos clave**:
    *   *«punto»* $\rightarrow$ `.`
    *   *«coma»* $\rightarrow$ `,`
    *   *«dos puntos»* $\rightarrow$ `:`
    *   *«punto y coma»* $\rightarrow$ `;`
    *   *«puntos suspensivos»* $\rightarrow$ `…`
    *   *«nueva línea»* $\rightarrow$ Salto de línea único.
    *   *«nuevo párrafo»* $\rightarrow$ Salto de línea doble.
    *   *«abrir comillas» / «cerrar comillas»* $\rightarrow$ `"`
    *   *«abrir interrogación» / «cerrar interrogación»* $\rightarrow$ `¿` / `?`
    *   *«abrir exclamación» / «cerrar exclamación»* $\rightarrow$ `¡` / `!`

### ❓ Modo Pregunta (`Preg`)
*   **Descripción**: Analiza si la frase empieza con palabras interrogativas comunes y, de ser así, envuelve la frase automáticamente con los signos de apertura y cierre (`¿` y `?`).
*   **Cuándo aplicarlo**: Muy útil en entrevistas, sesiones de preguntas y respuestas, o cuando haces dictados estructurados en forma de diálogo.
*   **Palabras de activación automática**: *Qué, cómo, cuándo, dónde, quién, por qué, sabes, puedes, tienes, existe, etc.*

### 💻 Modo Código (`Code`)
*   **Descripción**: Transforma comandos de voz de desarrollo en símbolos sintácticos y etiquetas de programación.
*   **Cuándo aplicarlo**: Exclusivamente para desarrolladores de software que dictan estructuras de código, maquetación o fórmulas.
*   **Comandos de código**:
    *   *«abrir llave» / «cerrar llave»* $\rightarrow$ `{` / `}`
    *   *«abrir corchete» / «cerrar corchete»* $\rightarrow$ `[` / `]`
    *   *«abrir paréntesis» / «cerrar paréntesis»* $\rightarrow$ `(` / `)`
    *   *«guion bajo»* $\rightarrow$ `_`
    *   *«etiqueta div»* $\rightarrow$ `<div></div>`
    *   *«menor que» / «mayor que»* $\rightarrow$ `<` / `>`

### 🔠 Mayúsculas Automáticas (`Caps`)
*   **Descripción**: Fuerza la mayúscula al inicio del bloque de texto y después de cada signo de fin de oración (`.`, `?`, `!`, `¿`, `¡`).
*   **Cuándo aplicarlo**: Recomendable tenerlo **siempre encendido** para mantener la ortografía y coherencia del texto final sin edición manual posterior.

### 📝 Autocorrección (`Auto`)
*   **Descripción**: Reemplaza instantáneamente términos tecnológicos y abreviaturas comunes por su formato correcto y estilizado.
*   **Cuándo aplicarlo**: Ideal cuando hablas sobre temas de tecnología, programación o negocios.
*   **Ejemplos de corrección**:
    *   *«javascript»* $\rightarrow$ `JavaScript`
    *   *«github»* $\rightarrow$ `GitHub`
    *   *«python»* $\rightarrow$ `Python`
    *   *«chat gpt»* o *«chatgpt»* $\rightarrow$ `ChatGPT`
    *   *«fastapi»* $\rightarrow$ `FastAPI`
    *   *«deep seek»* o *«dip sic»* $\rightarrow$ `DeepSeek`
    *   *«mistral»* $\rightarrow$ `Mistral`
    *   *«gemini»* o *«yéminis»* $\rightarrow$ `Gemini`
    *   *«ollama»* $\rightarrow$ `Ollama`
    *   *«pytorch»* o *«paitorch»* $\rightarrow$ `PyTorch`
    *   *«docker»* o *«doquer»* $\rightarrow$ `Docker`
    *   *«llm»* o *«llms»* $\rightarrow$ `LLM` o `LLMs`
    *   *«prompt»* o *«pront»* $\rightarrow$ `prompt`
    *   *«vs code»* o *«vi es code»* $\rightarrow$ `VS Code`

---

## 🌐 4. Selección e Importancia del Idioma
La aplicación ofrece un selector de dialectos regionales (ej. *Español - Colombia, México, España, Argentina*, etc.). 
*   **¿Por qué elegir el correcto?**: Cada región posee entonaciones, modismos, y un ritmo específico. Ajustar el selector al dialecto exacto del hablante reduce drásticamente las palabras mal interpretadas y mejora la puntuación predictiva del navegador.
*   **Soporte Multilingüe**: Permite transcribir en vivo o mediante archivos en inglés, francés, portugués, alemán, entre otros.

---

## 💻 Instalar como app (escritorio y móvil)

JG Turbo es una **PWA**: se instala como aplicación real (ventana propia, icono en Inicio), no solo un favorito del navegador.

| Dónde | Cómo |
|---|---|
| **Windows (Chrome o Edge)** | Barra de direcciones → icono **Instalar**, o menú → Aplicaciones → Instalar este sitio como aplicación |
| **Android** | Menú ⋮ → Instalar app |
| **iPhone** | Safari → Compartir → Añadir a pantalla de inicio |

En la web verás el botón **«Instalar app»** (arriba a la derecha). Guía completa: [INSTALAR_ESCRITORIO.md](INSTALAR_ESCRITORIO.md).

## 📁 5. Guía de Uso por Apartados

### 🎤 Panel de Micrófono

**Límites:** hasta **~15 min** por grabación en la nube (Vercel); en PC local hasta **~30 min**. Los audios largos se envían **por partes** de ~100 s (cada envío debe caber bajo ~4,5 MB de la plataforma). No hace falta cortar a mano. Detalle: [PRECISION_AUDIO.md](PRECISION_AUDIO.md).

1.  Presiona **Grabar** o la barra **Espaciadora** para hablar.
2.  Observa el visualizador de ondas y el cronómetro de grabación.
3.  Al finalizar, puedes reproducir el audio capturado de forma local para validar que se grabó bien.
4.  Al detener, la app envía la grabación a Whisper (en la nube, por partes si es larga: verás «parte 2 de 6…»). Si falla, conserva el texto en vivo. Usa **"Re-transcribir con Whisper"** para repetir el análisis del audio guardado.
5.  Usa el botón **"Expandir"** para abrir el editor modal a pantalla completa si necesitas leer con comodidad o realizar correcciones que se sincronizan al instante en la pantalla principal.

### 🎧 Panel de Archivo de Audio
1.  Arrastra y suelta tu archivo de audio (MP3, M4A, OGG, etc.) en la caja punteada o haz clic para seleccionarlo.
2.  Elige el idioma del audio o déjalo en "Auto" para que la IA lo detecte.
3.  Haz clic en **"Transcribir archivo"**. Una barra de progreso te indicará que la IA está transcribiendo en segundo plano.

### ▶️ Panel de YouTube

**Pega el enlace y pulsa «Transcribir video». Eso es todo.** No tienes que abrir YouTube ni copiar nada. Detalle técnico e historial: [CAMBIOS_YOUTUBE.md](CAMBIOS_YOUTUBE.md).

1. Pega el enlace del video (ej. `https://www.youtube.com/watch?v=...`).
2. Elige el idioma del texto final si quieres traducirlo (opcional).
3. Pulsa **«Transcribir video»**.
4. El texto aparece listo para **Copiar, Corregir, Traducir, Escuchar y descargar .txt**.

**Qué pasa por dentro** (no necesitas saberlo, pero por si falla algo):

| Orden | Vía | Cuándo actúa | Costo |
|---|---|---|---|
| 1 | `youtube-transcript-api` | Si YouTube deja pasar la consulta (videos muy populares) | Gratis |
| 2 | **Supadata** | Caso normal: trae los subtítulos o los genera con IA | 1 crédito (2 por minuto si usa IA) |
| 3 | yt-dlp + Whisper de Groq | Respaldo si Supadata no está disponible | Gratis |
| 4 | Pegado manual | Red de seguridad, solo si todo lo anterior falla | Gratis |

**Videos largos (+20 min):** si el proveedor tarda, se procesan en segundo plano. Verás «Video largo: transcribiendo…» y el texto llega solo; no cierres la pestaña.

**Sobre el selector «Idioma del video»:**

- Si eliges un idioma concreto (Español, Inglés…), **se respeta**: el texto llega en ese idioma si el video lo tiene.
- Si dejas **«Auto»**, la app prefiere **español**, luego **inglés**, y si no hay ninguno de los dos usa el que haya. Es a propósito: sin esa regla, un video hablado en inglés podía llegar en alemán, porque el proveedor entrega «la primera pista disponible» y esa puede ser cualquier traducción.
- Consecuencia práctica: con «Auto», un video en inglés que tenga subtítulos en español llegará **en español**. Si quieres el original, elige el idioma en el selector.

**Si un video concreto falla** (privado, restringido o con audio muy sucio) la app abre sola el bloque **«¿Este video no funcionó? Pega el texto tú mismo»**. Es una red de seguridad, no el camino normal.

> **Nota (2026-08-01):** antes el pegado manual era la vía principal porque YouTube bloquea a los servidores en la nube. Ya no: la app trae el texto sola. Requiere la variable `SUPADATA_API_KEY` en Vercel (ver `DOCUMENTACION_DESPLIEGUE.md`).

### 🌍 Traducir

Pulsa **Traducir** y el texto pasa al idioma elegido en **«Texto:»**.

**No hay límite de tamaño.** Si pegas una transcripción larga (una charla de una
hora, por ejemplo), la app la parte sola en bloques y los traduce uno tras otro.
Verás el avance en el botón: **«Traduciendo… 3 de 7»**. No cierres la pestaña.

- Un texto normal tarda unos segundos.
- Una transcripción de 40 000 caracteres (unas 7 000 palabras) tarda algo más de
  un minuto y llega **completa**.
- Si un bloque falla por un tropiezo de red, se reintenta solo.

Detalle técnico e historial: [CAMBIOS_TRADUCCION.md](CAMBIOS_TRADUCCION.md).

## Lectura en voz alta — voces regionales y reproducción continua

**Motor TTS: 2.9.0** (14 ago 2026) · **UI consola: franja horizontal** (1 ago 2026; ver [CAMBIOS_UX.md](CAMBIOS_UX.md) v3.2).

La app lee el texto desde una consola dedicada. Por defecto usa **voces nativas
regionales**: el español respeta el acento seleccionado y el inglés o portugués
usan una voz propia cuando el texto corresponde. **No reescribe el texto en
pantalla.**

- **Modo regional (recomendado y por defecto)**: acento latino para español + voz nativa para inglés o portugués
  - Acentos: Colombia, México, Argentina, Chile, Perú y español latino de Estados Unidos
  - Inicial: **Salomé/Gonzalo (Colombia)** · inglés **Ava/Andrew** · portugués **Francisca/Antonio**
- **Modo «Una voz» (opcional)**: Ava/Andrew multilingües conservan el timbre, pero su base es inglesa y el acento regional no aplica
- **Cambio de idioma**: Regional (`regional`, por defecto) · Una voz (`unified`) · Solo idioma principal (`off`)
- **Tonos**: neutral, cálido y enérgico
- **Controles (UI)**: una franja inferior compacta — **Escuchar**, **Mujer/Hombre**, velocidad `0.75×`–`2×` (Detener cuando está leyendo). En «Editar en grande» no apila bloques altos para dejar más espacio al texto.
- **Barra de reproducción** (v2.8.0, reloj v2.22.0): mientras lee aparece **⏪ 10 s**, **⏩ 10 s**, la posición arrastrable y el tiempo (`0:35 / 1:42`). Ese tiempo es el de **escucha** a la velocidad elegida: si bajas a `0.84×` se alarga y si subes se acorta, también antes de pulsar Escuchar. Avanzar o retroceder **no reinicia** la lectura, y cambiar la velocidad tampoco: se oye al instante. También se maneja desde la pantalla de bloqueo y los auriculares.
- **Idioma de la voz** (v2.8.0): la voz habla en el idioma del texto — español, inglés, **portugués, francés, alemán e italiano**. Si el texto contradice al desplegable, manda el texto.
- **Fish Audio** (v2.24.0): 18 voces, agrupadas por **español/inglés** y **femeninas/masculinas**. Solo suenan si la persona las elige.
- **Respaldo**: voces del navegador cuando la red o el motor neural fallan
- **Persistencia**: preferencias `jg_tts_*` en el navegador (un deploy no las borra). El valor antiguo `auto` migra a `regional`.

Consulta el documento maestro [Lectura en voz alta (TTS)](CAMBIOS_TTS.md) para: arquitectura, flujo paso a paso, historial 2.6→2.9.0, UI de consola, decisiones, API, guías de pronunciación, proceso de deploy, IDs de producción, pruebas y límites. UX reciente: [CAMBIOS_UX.md](CAMBIOS_UX.md). Config: [CONFIG_PERSISTENTE.md](CONFIG_PERSISTENTE.md). Deploy: [DOCUMENTACION_DESPLIEGUE.md](DOCUMENTACION_DESPLIEGUE.md).
