# 📋 Ficha Técnica y Manual de Uso · JG Turbo

Bienvenido a la documentación oficial de **JG Turbo**, una suite de captura, transcripción y traducción para navegador, Vercel y servidor local.

## Actualización de audio y lenguaje del 23 de julio de 2026

La aplicación ahora verifica la calidad real del micrófono, mide ruido, procesa la grabación final con Whisper y marca fragmentos ambiguos. La traducción inglés ↔ español conserva invariantes y alerta ante posibles omisiones o invenciones.

Consulta [Cómo funciona la captura, transcripción y traducción mejoradas](PRECISION_AUDIO.md) para conocer el inventario completo, las pruebas y los límites. El benchmark de 100 audios reales está preparado, pero sigue pendiente por falta de un corpus autorizado.

---

## 🔍 1. Descripción General del Producto
**JG Turbo** es una aplicación web de transcripción universal diseñada con una interfaz oscura, responsive y editable. En celular permite desplazamiento para evitar que el editor se superponga con las acciones. Permite transcribir:
1.  **Voz en vivo (Micrófono)**: Ideal para dictados rápidos y transcripciones inmediatas con formateo inteligente.
2.  **Archivos locales**: Procesa grabaciones largas, reuniones o notas de voz subidas en formatos de audio común (MP3, WAV, M4A, etc.).
3.  **Videos de YouTube**: Extrae el contenido de cualquier enlace público de YouTube usando subtítulos o procesando su audio mediante IA.

---

## 🛠️ 2. Ficha Técnica y Arquitectura
*   **Interfaz (Frontend)**: HTML5, CSS3 vanilla y JavaScript nativo en un solo archivo, con diseño responsive y enfoque local-first.
*   **Servidor (Backend)**: FastAPI (Python) con una versión local y otra para Vercel. La versión local procesa audio con `faster-whisper`; Vercel usa Groq.
*   **Motores de transcripción**: `faster-whisper` en el backend local y `whisper-large-v3` mediante Groq en Vercel. Ambos reciben el glosario como contexto.
*   **Gestor de Descargas**: **yt-dlp**, con preferencia por subtítulos cuando existen y descarga de audio solo como respaldo.

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

## 📁 5. Guía de Uso por Apartados

### 🎤 Panel de Micrófono
1.  Presiona **Grabar** o la barra **Espaciadora** para hablar.
2.  Observa el visualizador de ondas y el cronómetro de grabación.
3.  Al finalizar, puedes reproducir el audio capturado de forma local para validar que se grabó bien.
4.  Al detener, la app envía la grabación completa a Whisper cuando el backend está disponible. Si ese proceso falla, conserva el texto en vivo. Usa **"Re-transcribir con Whisper"** cuando quieras repetir el análisis del audio guardado.
5.  Usa el botón **"Expandir"** para abrir el editor modal a pantalla completa si necesitas leer con comodidad o realizar correcciones que se sincronizan al instante en la pantalla principal.

### 🎧 Panel de Archivo de Audio
1.  Arrastra y suelta tu archivo de audio (MP3, M4A, OGG, etc.) en la caja punteada o haz clic para seleccionarlo.
2.  Elige el idioma del audio o déjalo en "Auto" para que la IA lo detecte.
3.  Haz clic en **"Transcribir archivo"**. Una barra de progreso te indicará que la IA está transcribiendo en segundo plano.

### ▶️ Panel de YouTube
1.  Pega el enlace completo del video (ej. `https://www.youtube.com/watch?v=...`).
2.  El backend buscará primero si el video ya cuenta con subtítulos generados por el autor o automáticos. De existir, los extraerá rápido para ahorrar tiempo y recursos.
3.  De no contar con subtítulos, el servidor descargará el audio y lo transcribirá con Whisper local, respetando límites de duración y tamaño para evitar bloqueos.

## Lectura en voz alta con acentos e inglés

**Versión actual del módulo: TTS 2.6.3** (23 jul 2026).

La app lee el texto desde una consola dedicada. El motor neural cambia de voz por fragmento: usa el acento latino elegido para español y una voz inglesa para oraciones o términos técnicos en inglés. **No reescribe el texto en pantalla**: solo elige qué voz lo pronuncia (y prepara la pronunciación del audio EN).

- **Acentos**: Colombia, México, Argentina y español latino de Estados Unidos
- **Voces**: femenina y masculina para cada acento
- **Recomendado (auto)**: mujer **Dalia (México)** · hombre **Gonzalo (Colombia)**
- **Inglés automático (igual de claro en ambos géneros)**: mujer **Aria** · hombre **Andrew** (EE. UU.)
- **Pronunciación bilingüe**: automática (predeterminada) o desactivada
- **Tonos**: neutral, cálido y enérgico (español hombre más calmado; inglés siempre neutro para no distorsionar)
- **Controles**: Escuchar, Pausar, Reanudar, Detener y velocidad de `1×` a `2×`
- **Respaldo**: voces del navegador cuando la red o el motor neural fallan
- **Persistencia**: preferencias `jg_tts_*` en el navegador (un deploy no las borra)
- **2.6.2–2.6.3**: no partir `Node.js`; listas técnicas en un tramo EN; force-EN si un tramo tech se etiquetó mal; guías de pronunciación (OpenAI, API, ChatGPT…) para **mujer y hombre**

Consulta el documento maestro [Lectura en voz alta (TTS)](CAMBIOS_TTS.md) para: arquitectura, flujo paso a paso, historial 2.6→2.6.3, decisiones, API, guías de pronunciación, proceso de deploy, IDs de producción, pruebas y límites. Consulta [Cómo conservar la configuración](CONFIG_PERSISTENTE.md) antes de modificar una clave `jg_*`. Deploy: [DOCUMENTACION_DESPLIEGUE.md](DOCUMENTACION_DESPLIEGUE.md).