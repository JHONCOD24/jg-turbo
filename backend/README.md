# JG Turbo · Backend Whisper

Servidor local que activa las pestañas **Archivo de audio** y **YouTube** de la app.

---

## Requisitos previos

### 1. Python 3.9 o superior
Descarga desde https://www.python.org/downloads/

### 2. ffmpeg (obligatorio para Whisper y YouTube)
**Windows:**
1. Descarga el build estático desde https://www.gyan.dev/ffmpeg/builds/
   (elige `ffmpeg-release-essentials.zip`)
2. Extrae y copia la carpeta a `C:\ffmpeg`
3. Agrega `C:\ffmpeg\bin` al PATH del sistema:
   - Busca "Variables de entorno" en el menú inicio
   - En "Variables del sistema" → PATH → Editar → Nuevo → `C:\ffmpeg\bin`
4. Verifica en una terminal nueva: `ffmpeg -version`

---

## Instalación del servidor

```bash
# 1. Abre una terminal en esta carpeta (backend/)
cd "G:\Mi unidad\App\Spech to text App\backend"

# 2. Crea un entorno virtual (recomendado)
python -m venv venv
venv\Scripts\activate        # Windows
# source venv/bin/activate   # Mac/Linux

# 3. Instala las dependencias
pip install -r requirements.txt

# La primera vez que instales openai-whisper descargará el modelo (~150 MB para "base")
```

---

## Arrancar el servidor

```bash
# Con el entorno virtual activo:
uvicorn app:app --reload --host 0.0.0.0 --port 8000
```

Verás algo como:
```
⏳ Cargando modelo Whisper 'base'…
✅ Modelo 'base' listo.
INFO:     Uvicorn running on http://0.0.0.0:8000
```

Abre `jg_turbo.html` en Chrome/Edge. El indicador arriba derecha cambiará a **verde** automáticamente.

---

## Modelos disponibles

Cambia la variable `WHISPER_MODEL` en `app.py` o con variable de entorno:

```bash
WHISPER_MODEL=small uvicorn app:app --reload
```

| Modelo  | Tamaño  | RAM aprox. | Velocidad | Calidad  |
|---------|---------|------------|-----------|----------|
| tiny    | 39 MB   | ~1 GB      | Muy rápido | Básica  |
| base    | 74 MB   | ~1 GB      | Rápido    | Buena    |
| small   | 244 MB  | ~2 GB      | Moderado  | Muy buena|
| medium  | 769 MB  | ~5 GB      | Lento     | Alta     |
| large   | 1.5 GB  | ~10 GB     | Muy lento | Máxima   |

**Recomendación:** empieza con `base`. Si necesitas más precisión en español, usa `small` o `medium`.

---

## Script de arranque rápido (Windows)

Crea un archivo `iniciar.bat` en esta carpeta con:

```bat
@echo off
call venv\Scripts\activate
uvicorn app:app --host 0.0.0.0 --port 8000
pause
```

Doble clic en `iniciar.bat` para arrancar el servidor sin abrir la terminal manualmente.

---

## Endpoints de la API

| Método | Ruta         | Descripción                              |
|--------|-------------|------------------------------------------|
| GET    | `/health`    | Verifica estado del servidor y modelo    |
| POST   | `/transcribe`| Sube un archivo de audio → texto         |
| POST   | `/youtube`   | URL de YouTube → texto                   |

Documentación interactiva disponible en: http://localhost:8000/docs
