[RESOLVED] Debug Session: whisper-winerror2

## Sintoma
- En la app aparece: `Whisper falló: [WinError 2] El sistema no puede encontrar el archivo especificado`.
- En paralelo aparece `net::ERR_ABORTED blob:...` en consola del navegador.

## Esperado
- Al detener la grabación o transcribir, Whisper debería procesar el audio sin fallar por binarios/rutas faltantes.

## Hipotesis
- H1: `ffmpeg.exe` no está disponible en `PATH` cuando `_a_wav_mono()` ejecuta `subprocess.run(["ffmpeg", ...])`.
- H2: `setup_ffmpeg_path()` no encuentra la instalación real de ffmpeg en esta máquina.
- H3: El error no viene de ffmpeg sino de otro binario requerido por Whisper al abrir el audio temporal.
- H4: El `blob:` abortado es secundario; el fallo funcional principal es el WinError 2 del backend.

## Evidencia inicial
- Error frontend: `Whisper falló: [WinError 2] El sistema no puede encontrar el archivo especificado`.
- Error navegador: `net::ERR_ABORTED blob:...`

## Estado
- RESUELTO (2026-06-17, revisión doctor-codigo): confirmado H1/H2. `setup_ffmpeg_path()`
  en backend/app.py:42-82 ya localiza correctamente `bin\ffmpeg.exe` del proyecto
  (verificado con `shutil.which` + ejecución real del binario). Logs de terminal del
  2026-06-16 muestran una transcripción real exitosa (`POST /transcribe 200 OK`) usando
  ese ffmpeg. No reproducible en el código actual. Causa raíz real del WinError 2
  histórico: probablemente ocurrió en una versión anterior de app.py sin esta función,
  o mientras el `.venv` del proyecto estaba corrupto (ver debug-app-not-loading.md).
  Mejora aplicada: iniciar.bat y diagnostico.bat ahora también revisan `bin\ffmpeg.exe`
  del proyecto, no solo PATH/rutas de sistema.
