@echo off
setlocal
title JG Turbo · Servidor Whisper
echo.
echo  ==========================================
echo   JG Turbo - Backend Whisper
echo  ==========================================
echo.

cd /d "%~dp0"

set "PROJECT_ROOT=%~dp0.."
set "PROJECT_VENV=%PROJECT_ROOT%\.venv"
set "PROJECT_PY=%PROJECT_VENV%\Scripts\python.exe"
set "USER_VENV=%USERPROFILE%\.jg_turbo_venv"
set "USER_PY=%USER_VENV%\Scripts\python.exe"
set "LOCAL_VENV=%~dp0venv\Scripts\python.exe"
set "LOCAL_DOT_VENV=%~dp0.venv\Scripts\python.exe"
set "PYEXE="
set "BOOTSTRAP_PY="

REM Priorizar siempre el .venv del proyecto para evitar rutas rigidas o entornos viejos.
if exist "%PROJECT_PY%" (
    set "PYEXE=%PROJECT_PY%"
    echo  [OK] Usando entorno virtual del proyecto: %PROJECT_VENV%
) else if exist "%LOCAL_DOT_VENV%" (
    set "PYEXE=%LOCAL_DOT_VENV%"
    echo  [OK] Usando entorno virtual local del backend: %~dp0.venv
) else if exist "%LOCAL_VENV%" (
    set "PYEXE=%LOCAL_VENV%"
    echo  [OK] Usando entorno virtual local del backend: %~dp0venv
) else if exist "%USER_PY%" (
    set "PYEXE=%USER_PY%"
    echo  [OK] Usando entorno virtual alterno del usuario: %USER_VENV%
)

if not defined PYEXE (
    where python >nul 2>&1 && set "BOOTSTRAP_PY=python"
)
if not defined PYEXE if not defined BOOTSTRAP_PY (
    where py >nul 2>&1 && set "BOOTSTRAP_PY=py -3"
)

if not defined PYEXE (
    if not defined BOOTSTRAP_PY (
        echo  [ERROR] No se encontro Python.
        echo         Instala Python desde https://www.python.org/downloads/
        echo         Luego vuelve a ejecutar este archivo.
        echo.
        pause
        exit /b 1
    )

    echo  [AVISO] No se encontro entorno virtual. Creando uno nuevo en:
    echo          %PROJECT_VENV%
    call %BOOTSTRAP_PY% -m venv "%PROJECT_VENV%"
    if errorlevel 1 (
        echo  [ERROR] No se pudo crear el entorno virtual del proyecto.
        echo         Cierra procesos Python abiertos y vuelve a intentar.
        echo.
        pause
        exit /b 1
    )
    set "PYEXE=%PROJECT_PY%"
    echo  [OK] Entorno virtual creado correctamente.
)

"%PYEXE%" --version >nul 2>&1
if errorlevel 1 (
    echo  [ERROR] Python no puede ejecutarse desde este entorno.
    echo         Esto suele pasar cuando el entorno virtual fue creado con un Python que ya no existe.
    echo.
    echo         Solucion recomendada:
    echo           - Borra el entorno virtual .venv o venv
    echo           - Instala Python desde python.org si falta
    echo           - Recrea el entorno:
    echo                python -m venv .venv
    echo                .venv\Scripts\activate
    echo                python -m pip install -r requirements.txt
    echo.
    pause
    exit /b 1
)

"%PYEXE%" -m pip --version >nul 2>&1
if errorlevel 1 (
    echo  [ERROR] pip no esta disponible en el entorno.
    echo         Recomendado: recrea el entorno virtual:
    echo           rmdir /s /q .venv
    echo           python -m venv .venv
    echo           .venv\Scripts\activate
    echo           python -m pip install -r requirements.txt
    echo.
    pause
    exit /b 1
)

REM Verificar que uvicorn este disponible; si falta, instalar dependencias.
"%PYEXE%" -c "import uvicorn" >nul 2>&1
if errorlevel 1 (
    echo  [AVISO] uvicorn no esta instalado. Instalando dependencias...
    "%PYEXE%" -m pip install -r "%~dp0requirements.txt"
    if errorlevel 1 (
        echo  [ERROR] Fallo la instalacion de dependencias. Revisa el error arriba.
        echo.
        pause
        exit /b 1
    )
)

set "FFMPEG_BIN="
where ffmpeg >nul 2>&1 && set "FFMPEG_BIN=PATH"
if not defined FFMPEG_BIN if exist "..\bin\ffmpeg.exe" (
    set "PATH=%~dp0..\bin;%PATH%"
    set "FFMPEG_BIN=%~dp0..\bin\ffmpeg.exe"
)
if not defined FFMPEG_BIN if exist "C:\ffmpeg\bin\ffmpeg.exe" (
    set "PATH=C:\ffmpeg\bin;%PATH%"
    set "FFMPEG_BIN=C:\ffmpeg\bin\ffmpeg.exe"
)
if not defined FFMPEG_BIN if exist "C:\Program Files\ffmpeg\bin\ffmpeg.exe" (
    set "PATH=C:\Program Files\ffmpeg\bin;%PATH%"
    set "FFMPEG_BIN=C:\Program Files\ffmpeg\bin\ffmpeg.exe"
)
if not defined FFMPEG_BIN if exist "C:\ProgramData\chocolatey\bin\ffmpeg.exe" (
    set "PATH=C:\ProgramData\chocolatey\bin;%PATH%"
    set "FFMPEG_BIN=C:\ProgramData\chocolatey\bin\ffmpeg.exe"
)

if defined FFMPEG_BIN (
    echo  [OK] ffmpeg detectado: %FFMPEG_BIN%
) else (
    echo  [AVISO] ffmpeg no fue detectado.
    echo          La transcripcion con Whisper de archivos y grabaciones fallara hasta instalarlo.
    echo          Ruta recomendada: C:\ffmpeg\bin\ffmpeg.exe
    echo.
)

set "PORT=8000"
netstat -ano | findstr ":8000" | findstr "LISTENING" >nul 2>&1
if not errorlevel 1 (
    set "PORT=8001"
    echo  [AVISO] El puerto 8000 parece estar ocupado. Usando http://localhost:%PORT%
)

echo.
echo  ==========================================
echo   Iniciando servidor en http://localhost:%PORT%
echo   La interfaz se abrira automaticamente en el navegador...
echo   IMPORTANTE: NO abras el index.html directamente como archivo.
echo   Debe usarse http://localhost:%PORT%
echo   Presiona Ctrl+C para detener el servidor.
echo  ==========================================
echo.

REM Abrir el navegador en segundo plano despues de 4 segundos
start /b cmd /c "timeout /t 4 >nul && start http://localhost:%PORT%"

"%PYEXE%" -m uvicorn app:app --host 127.0.0.1 --port %PORT%
