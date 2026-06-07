[OPEN] Debug Session: app-not-loading

## Síntoma
- La app “no carga” y aparece error.

## Resultado esperado
- Abrir http://localhost:8000 y ver la interfaz; el indicador de servidor debería pasar a “OK” (o al menos “Servidor conectado”).

## Hipótesis (falsables)
- H1: El backend no está corriendo (fallo al arrancar uvicorn / Python no instalado / venv roto).
- H2: El backend corre, pero en otro puerto u otra URL (la UI apunta a SERVER_URL incorrecto).
- H3: El backend corre, pero /ping o /health no responden (crash en import/arranque, o excepción al cargar middleware).
- H4: El backend responde, pero el modelo Whisper queda en “error” (dependencias faltantes: torch/whisper/ffmpeg).
- H5: El navegador bloquea permisos/origen (se abrió como file:// o mixed content) y por eso la UI muestra error.

## Evidencia a recolectar
- Salida de iniciar.bat (consola) y si uvicorn queda escuchando.
- Respuesta de http://localhost:8000/ping y /health (si el servidor está arriba).
- Mensaje exacto del error visible en la UI (indicador superior).

## Runs
- pre: confirmado H1 (el backend no arranca porque el entorno no tiene pip/uvicorn)
