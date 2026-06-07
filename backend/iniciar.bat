@echo off
title JG Turbo · Servidor Whisper
echo.
echo  ==========================================
echo   JG Turbo - Backend Whisper
echo  ==========================================
echo.

REM Activar entorno virtual si existe
if exist "%USERPROFILE%\.jg_turbo_venv\Scripts\activate.bat" (
    call "%USERPROFILE%\.jg_turbo_venv\Scripts\activate.bat"
    echo  [OK] Entorno virtual local %USERPROFILE%\.jg_turbo_venv activado.
) else if exist "..\.venv\Scripts\activate.bat" (
    call "..\.venv\Scripts\activate.bat"
    echo  [OK] Entorno virtual .venv parent activado.
) else if exist "venv\Scripts\activate.bat" (
    call "venv\Scripts\activate.bat"
    echo  [OK] Entorno virtual venv activado.
) else if exist ".venv\Scripts\activate.bat" (
    call ".venv\Scripts\activate.bat"
    echo  [OK] Entorno virtual .venv activado.
) else (
    echo  [AVISO] No se encontro entorno virtual. Instala dependencias primero:
    echo         python -m venv venv
    echo         venv\Scripts\activate
    echo         pip install -r requirements.txt
    echo.
)

cd /d "%~dp0"

set "PYEXE="
if defined VIRTUAL_ENV if exist "%VIRTUAL_ENV%\Scripts\python.exe" set "PYEXE=%VIRTUAL_ENV%\Scripts\python.exe"
if not defined PYEXE if exist ".venv\Scripts\python.exe" set "PYEXE=.venv\Scripts\python.exe"
if not defined PYEXE if exist "venv\Scripts\python.exe" set "PYEXE=venv\Scripts\python.exe"
if not defined PYEXE (
    where python >nul 2>&1 && set "PYEXE=python"
)
if not defined PYEXE (
    where py >nul 2>&1 && set "PYEXE=py -3"
)

if not defined PYEXE (
    echo  [ERROR] No se encontro Python.
    echo         Instala Python desde https://www.python.org/downloads/
    echo         Luego crea el entorno virtual e instala dependencias:
    echo           python -m venv venv
    echo           venv\Scripts\activate
    echo           pip install -r requirements.txt
    echo.
    pause
    exit /b 1
)

%PYEXE% --version >nul 2>&1
if errorlevel 1 (
    echo  [ERROR] Python no puede ejecutarse desde este entorno.
    echo         Esto suele pasar cuando el entorno virtual fue creado con un Python que ya no existe.
    echo.
    echo         Solucion recomendada:
    echo           - Borra el entorno virtual .venv o venv
    echo           - Instala Python desde python.org si falta
    echo           - Recrea el entorno:
    echo                python -m venv venv
    echo                venv\Scripts\activate
    echo                python -m pip install -r requirements.txt
    echo.
    pause
    exit /b 1
)

%PYEXE% -m pip --version >nul 2>&1
if errorlevel 1 (
    echo  [ERROR] pip no esta disponible en el entorno.
    echo         Recomendado: recrea el entorno virtual:
    echo           rmdir /s /q venv
    echo           python -m venv venv
    echo           venv\Scripts\activate
    echo           python -m pip install -r requirements.txt
    echo.
    pause
    exit /b 1
)

%PYEXE% -c "import pytest" >nul 2>&1
if errorlevel 1 (
    echo  [ERROR] pytest no se pudo instalar correctamente.
    echo         Intenta instalarlo manualmente:
    echo           pip install pytest
    echo.
    pause
    exit /b 1
)
%PYEXE% -c "import uvicorn" >nul 2>&1
%PYEXE% -c "import uvicorn" >nul 2>&1
if errorlevel 1 (
    echo  [AVISO] uvicorn no esta instalado. Instalando dependencias...
    %PYEXE% -m pip install -r requirements.txt
    if errorlevel 1 (
        echo  [ERROR] Fallo la instalacion de dependencias. Revisa el error arriba.
        echo.
        pause
        exit /b 1
    )
)

set "PORT=8000"
netstat -ano | findstr ":8000" | findstr "LISTENING" >nul 2>&1
if not errorlevel 1 (
    set "PORT=8001"
    echo  [AVISO] El puerto 8000 parece estar ocupado. Usando http://localhost:%PORT%
)

echo  Iniciando servidor en http://localhost:8000
echo  La interfaz se abrira automaticamente en el navegador...
echo  IMPORTANTE: Usa http://localhost:8000 (no el archivo HTML directamente)
echo  Presiona Ctrl+C para detener el servidor.
echo.

REM Abrir el navegador en segundo plano despues de 3 segundos (tiempo para que arranque uvicorn)
start /b cmd /c "timeout /t 3 >nul && start http://localhost:%PORT%"

%PYEXE% -m uvicorn app:app --host 127.0.0.1 --port %PORT%