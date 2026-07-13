@echo off
title JG Turbo · Diagnostico de dependencias
echo.
echo  ==========================================
echo   JG Turbo - Diagnostico
echo  ==========================================
echo.

REM Activar entorno virtual (misma prioridad que iniciar.bat: proyecto primero)
if exist "..\.venv\Scripts\activate.bat" (
    call "..\.venv\Scripts\activate.bat"
    echo  [OK] Entorno virtual del proyecto (.venv) activado.
) else if exist ".venv\Scripts\activate.bat" (
    call ".venv\Scripts\activate.bat"
    echo  [OK] Entorno virtual local .venv activado.
) else if exist "venv\Scripts\activate.bat" (
    call "venv\Scripts\activate.bat"
    echo  [OK] Entorno virtual venv activado.
) else if exist "%USERPROFILE%\.jg_turbo_venv\Scripts\activate.bat" (
    call "%USERPROFILE%\.jg_turbo_venv\Scripts\activate.bat"
    echo  [OK] Entorno virtual alterno %USERPROFILE%\.jg_turbo_venv activado.
) else (
    echo  [ERROR] No se encontro el entorno virtual.
    echo  Ejecuta iniciar.bat para crear y configurar el entorno automaticamente.
    echo.
    pause
    exit /b 1
)

echo.
echo  Verificando Python...
python --version
echo.

echo  Verificando PyTorch (requerido por Whisper)...
python -c "import torch; print('  torch ' + torch.__version__ + ' OK')" 2>nul || (
    echo  [FALTA] PyTorch no instalado. Instalando version CPU...
    pip install torch --index-url https://download.pytorch.org/whl/cpu
)
echo.

echo  Verificando openai-whisper...
python -c "import whisper; print('  whisper OK')" 2>nul || (
    echo  [FALTA] openai-whisper no instalado. Instalando...
    pip install openai-whisper
)
echo.

echo  Verificando fastapi y uvicorn...
python -c "import fastapi, uvicorn; print('  fastapi + uvicorn OK')" 2>nul || (
    echo  [FALTA] Instalando dependencias faltantes...
    pip install -r requirements.txt
)
echo.

echo  Verificando yt-dlp...
python -c "import yt_dlp; print('  yt-dlp OK')" 2>nul || (
    echo  [FALTA] yt-dlp no instalado. Instalando...
    pip install yt-dlp
)
echo.

echo  Verificando ffmpeg...
ffmpeg -version >nul 2>&1 && echo  [OK] ffmpeg encontrado en PATH || (
    if exist "..\bin\ffmpeg.exe" (
        echo  [OK] ffmpeg encontrado en la carpeta bin\ del proyecto.
    ) else (
        echo  [AVISO] ffmpeg NO encontrado en PATH ni en la carpeta bin\ del proyecto.
        echo  Descarga ffmpeg desde: https://www.gyan.dev/ffmpeg/builds/
        echo  Extrae en C:\ffmpeg y agrega C:\ffmpeg\bin al PATH del sistema.
    )
)
echo.

echo  Probando carga del modelo Whisper 'base'...
python -c "import whisper; m = whisper.load_model('base'); print('  Modelo base cargado correctamente!')" || (
    echo  [ERROR] Fallo al cargar el modelo. Revisa los mensajes de error arriba.
)
echo.

echo  ==========================================
echo   Diagnostico completado.
echo   Si todo muestra [OK], ejecuta iniciar.bat
echo  ==========================================
echo.
pause
