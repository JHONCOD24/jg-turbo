[RESOLVED] Debug Session: app-not-loading

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

## Estado
- RESUELTO (2026-06-17, revisión doctor-codigo): causa raíz real encontrada. Un intento
  previo de borrar `.venv` con `Remove-Item -Recurse -Force` falló a mitad de camino
  (archivos bloqueados, posiblemente por sync de Google Drive ya que el proyecto vive
  bajo "Mi unidad"), dejando el entorno corrupto (paquetes a medio borrar, ej. "sympy"
  truncado a "~ympy"). Como workaround se creó un venv alterno en
  `%USERPROFILE%\.jg_turbo_venv`, y quedaron además 10 procesos uvicorn duplicados
  corriendo desde 3 entornos distintos en los puertos 8000/8001.
  Acciones aplicadas: se cerraron todos los procesos duplicados, se borró el `.venv`
  corrupto y se recreó limpio con Python 3.12 + todas las dependencias (incluye
  pytest/httpx de requirements-dev.txt). `iniciar.bat` ahora prioriza el `.venv` del
  proyecto. Verificado con un servidor único levantado desde el `.venv` reparado.
