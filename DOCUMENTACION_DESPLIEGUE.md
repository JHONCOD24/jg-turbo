# Documentación de Despliegue y Mejoras (Vercel)

Este documento detalla todas las modificaciones y mejoras arquitectónicas realizadas al proyecto **JG Turbo (Speech to Text Pro)** para habilitar su funcionamiento en línea a través de Vercel.

## 1. Migración de Arquitectura (De Local a Serverless)
Originalmente, el backend estaba diseñado para ejecutarse localmente usando `faster-whisper`, el cual depende de PyTorch y descarga modelos pesados. Esto excede los límites de Vercel (250MB para funciones serverless en el plan gratuito) y provoca "Timeouts" porque las transcripciones locales tardan más de los 10 segundos permitidos.

**Solución:**
- Se creó una nueva carpeta `api/` que contiene el punto de entrada para Vercel (`api/index.py`).
- El modelo `faster-whisper` fue reemplazado por la API ultrarrápida de **Groq** (`whisper-large-v3-turbo`). Esto permite transcribir audios largos en menos de 3 segundos, esquivando completamente los límites de Vercel.
- Se configuró el archivo `vercel.json` en la raíz del proyecto para enrutar todas las peticiones bajo la ruta `/api/(.*)` hacia el nuevo archivo de Python `api/index.py`.

## 2. Dependencias Exclusivas para Vercel
Se creó un `api/requirements.txt` extremadamente ligero, ignorando intencionalmente `torch`, `faster-whisper` y `ffmpeg`.
Las dependencias actuales para producción son:
- `fastapi`
- `python-multipart`
- `pydantic`
- `httpx` (para hacer peticiones asíncronas a Groq)
- `yt-dlp` (para extraer URLs de audio directas de YouTube sin depender de FFmpeg)

## 3. Persistencia de Claves API (Navegador <-> Serverless)
Las funciones Serverless de Vercel "olvidan" los datos guardados en memoria apenas terminan de ejecutarse. Esto causaba que, al guardar la API Key desde la interfaz, se borrara en la siguiente petición.

**Solución Implementada:**
- **Frontend (`index.html`):** Ahora captura la API Key de Groq/Gemini desde el panel de Configuración y la almacena de forma persistente en el disco del navegador usando `localStorage.setItem('jg_api_key', ...)`.
- **Inyección Transparente:** La función `transcribirAudio()` (y las demás como `/youtube` y `/improve`) leen esta clave de `localStorage` y la inyectan silenciosamente en cada petición HTTP (como parte del `FormData` o del cuerpo JSON).
- **Backend (`api/index.py`):** Modificado para priorizar la `client_key` (API key enviada desde el frontend) sobre la variable de entorno `GROQ_API_KEY` global.

## 4. Estética y Diseño (Recorte del Logo)
El logotipo original (`logo.png` y `logo-real.png`) poseía recuadros y márgenes blancos que rompían con el diseño oscuro y compacto de la aplicación web.

**Solución Implementada:**
- Se creó y ejecutó un script temporal de Python (`recortar_logo.py`) utilizando la librería `Pillow` y `ImageChops`.
- El script recortó matemáticamente la "caja delimitadora" (bounding box) excluyendo todo el margen blanco.
- Además, detectó el color blanco en las esquinas y lo convirtió en un canal Alpha transparente (`RGBA`), logrando que el logo se fusione perfectamente con el fondo de la app.
- Luego, todos los íconos `.ico` se regeneraron automáticamente a partir del logo limpio y se enviaron a producción.

## 5. Manejo de Proyectos en Vercel CLI
Durante el proceso de despliegue, se limpiaron proyectos antiguos y se estableció **`jg-turbo`** como el nombre definitivo del proyecto oficial.
Los comandos utilizados para mantener o actualizar el código futuro son:

```bash
# Para actualizar el código en producción (después de cualquier cambio)
npx vercel --prod --yes
```

> **Nota Final:** El backend local original en la carpeta `/backend/` no fue tocado ni alterado de manera destructiva. Si alguna vez deseas ejecutar la app en tu máquina con la GPU de forma 100% privada, puedes seguir usando `backend/app.py` sin problemas.
