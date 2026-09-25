@echo off
rem One-click launcher: installs what is missing, fetches data once, then opens a menu.
rem Each experiment runs the first time it is chosen; after that it opens straight away.
setlocal
cd /d "%~dp0"

set "PY=python"
where python >nul 2>nul || set "PY=py"
%PY% --version >nul 2>nul || (
    echo Python was not found. Install Python 3.11 and tick "Add to PATH".
    pause & exit /b 1
)

%PY% -c "import pyswmm, pyvista, scipy, imageio" >nul 2>nul || (
    echo Installing pyswmm, pyvista, scipy, imageio...
    %PY% -m pip install pyswmm pyvista scipy imageio || (pause & exit /b 1)
)

if not exist "data\raw\contours.json" (
    echo Downloading public Walkerville layers, once...
    %PY% fetch_data.py || (pause & exit /b 1)
)

%PY% launcher.py || pause
endlocal
