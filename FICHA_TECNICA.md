# 📋 Ficha Técnica y Manual de Uso · JG Turbo

Bienvenido a la documentación oficial de **JG Turbo**, una suite de transcripción de audio a texto que combina reconocimiento de voz nativo en tiempo real con transcripción local mediante **faster-whisper**.

---

## 🔍 1. Descripción General del Producto
**JG Turbo** es una aplicación web de transcripción universal diseñada bajo una arquitectura ágil, optimizada para ejecutarse en una sola pantalla (sin scroll) y con un diseño oscuro *premium*. Permite transcribir:
1.  **Voz en vivo (Micrófono)**: Ideal para dictados rápidos y transcripciones inmediatas con formateo inteligente.
2.  **Archivos locales**: Procesa grabaciones largas, reuniones o notas de voz subidas en formatos de audio común (MP3, WAV, M4A, etc.).
3.  **Videos de YouTube**: Extrae el contenido de cualquier enlace público de YouTube usando subtítulos o procesando su audio mediante IA.

---

## 🛠️ 2. Ficha Técnica y Arquitectura
*   **Interfaz (Frontend)**: HTML5, CSS3 vanilla y JavaScript nativo en un solo archivo, con diseño responsive y enfoque local-first.
*   **Servidor (Backend)**: FastAPI (Python) que procesa audio local, administra la sesión temporal de IA y atiende YouTube desde `localhost`.
*   **Motor de IA (Local)**: **faster-whisper** sobre CPU con cuantización `int8`, carga temprana del modelo y soporte de glosario para mejorar nombres y términos técnicos.
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
4.  Si deseas una calidad de transcripción profesional, presiona **"Re-transcribir con Whisper"**. La app también puede ir confirmando texto por bloques mientras grabas, para dar una sensación casi en vivo con Whisper local.
5.  Usa el botón **"Expandir"** para abrir el editor modal a pantalla completa si necesitas leer con comodidad o realizar correcciones que se sincronizan al instante en la pantalla principal.

### 🎧 Panel de Archivo de Audio
1.  Arrastra y suelta tu archivo de audio (MP3, M4A, OGG, etc.) en la caja punteada o haz clic para seleccionarlo.
2.  Elige el idioma del audio o déjalo en "Auto" para que la IA lo detecte.
3.  Haz clic en **"Transcribir archivo"**. Una barra de progreso te indicará que la IA está transcribiendo en segundo plano.

### ▶️ Panel de YouTube
1.  Pega el enlace completo del video (ej. `https://www.youtube.com/watch?v=...`).
2.  El backend buscará primero si el video ya cuenta con subtítulos generados por el autor o automáticos. De existir, los extraerá rápido para ahorrar tiempo y recursos.
3.  De no contar con subtítulos, el servidor descargará el audio y lo transcribirá con Whisper local, respetando límites de duración y tamaño para evitar bloqueos.
