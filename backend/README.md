---
meta:
  title: Cómo ejecutar el backend local de JG Turbo
  navLabel: Backend local
  contentType: How-to
  category: Desarrollo local
  audience: Mantenimiento y desarrollo
  goal: Instalar, iniciar y comprobar el servidor local
lastUpdated: 2026-07-29
---

# Cómo ejecutar el backend local de JG Turbo

Este servidor activa transcripción de archivos, YouTube, traducción y mejora manual sin depender de la función de Vercel. Usa `faster-whisper` para procesar audio local.

## Requisitos

Instala:

- Python 3.10 o superior
- FFmpeg disponible en `PATH`
- Entre 1 GB y 10 GB de memoria, según el modelo

Comprueba FFmpeg:

```powershell
ffmpeg -version
```

## Instalar

Abre PowerShell en `Spech to text App/` y ejecuta:

```powershell
python -m venv backend\.venv
backend\.venv\Scripts\Activate.ps1
python -m pip install -r backend\requirements.txt
```

El primer uso descarga el modelo seleccionado. Usa `small` o `medium` cuando evalúes precisión.

### Dependencias (actualizado 2026-07-29)

Pisos verificados con Context7 + PyPI:

| Paquete | Piso en requirements | Notas |
|---|---|---|
| `fastapi` | `>=0.141.0` | Requiere Pydantic v2 |
| `uvicorn` | `>=0.52.0` | Con extras `[standard]` |
| `faster-whisper` | `>=1.2.1` | API `WhisperModel` sin cambios |
| `anthropic` | `>=0.120.0` | Modelo local: `claude-haiku-4-5-20251001` |
| `edge-tts` | `>=7.2.0` | `Communicate` + `stream()` |
| `yt-dlp` | `>=2026.7.4` | Extracción YouTube |
| `av` | `>=17,<18` | 18.x puede fallar por WDAC en Windows |

Tras actualizar: `python -m pip install -U -r backend\requirements.txt`.

## Iniciar

```powershell
Set-Location backend
uvicorn app:app --reload --host 127.0.0.1 --port 8000
```

Abre `index.html` en Chrome o Edge. El indicador del servidor debe cambiar a verde.

## Seleccionar un modelo

Configura `WHISPER_MODEL` antes de iniciar:

```powershell
$env:WHISPER_MODEL='small'
uvicorn app:app --reload --host 127.0.0.1 --port 8000
```

| Modelo | RAM aproximada | Prioridad |
|---|---:|---|
| `tiny` | 1 GB | Velocidad |
| `base` | 1 GB | Pruebas funcionales |
| `small` | 2 GB | Precisión recomendada |
| `medium` | 5 GB | Mayor precisión |
| `large` | 10 GB | Máxima calidad local |

El consumo real depende del equipo y la duración del audio.

## Endpoints principales

| Método | Ruta | Uso |
|---|---|---|
| `GET` | `/ping` | Verifica el servidor |
| `GET` | `/health` | Informa modelo, límites y estado |
| `GET` | `/session-config` | Entrega el token de la sesión local |
| `POST` | `/transcribe` | Transcribe un archivo completo |
| `POST` | `/transcribe-chunk` | Transcribe un fragmento durante la captura |
| `POST` | `/translate` | Traduce y valida el resultado |
| `POST` | `/youtube` | Extrae o transcribe contenido de YouTube |
| `POST` | `/improve` | Genera una mejora manual del texto |
| `POST` | `/correct-transcription` | Corrige una transcripción |
| `GET/POST` | `/glossary` | Consulta o guarda términos locales |

La documentación interactiva está en [API local de JG Turbo](http://127.0.0.1:8000/docs) mientras el servidor está activo.

## Probar

Instala las dependencias de desarrollo y ejecuta:

```powershell
python -m pip install -r requirements-dev.txt
python -m pytest tests -q
```

Para el benchmark con audios reales, sigue [Cómo funciona la captura, transcripción y traducción mejoradas](../PRECISION_AUDIO.md).

## Resolver fallos comunes

| Fallo | Acción |
|---|---|
| `ffmpeg` no existe | Instálalo y abre una terminal nueva |
| El modelo no carga | Reduce `WHISPER_MODEL` y revisa la memoria disponible |
| El entorno virtual no responde en la unidad sincronizada | Crea el entorno en una ruta local y reinstala dependencias |
| La interfaz muestra servidor desconectado | Confirma el puerto 8000 y revisa `/ping` |
| Una petición devuelve 401 | Actualiza la sesión desde `/session-config` |

No guardes claves ni grabaciones personales dentro del repositorio.