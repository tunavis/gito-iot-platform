@echo off
REM One-command startup: installs/updates dependencies, then launches the
REM Bridge UI (which hosts the device simulator's controls). Re-run this any
REM time — pip install is a no-op once dependencies are already satisfied.
cd /d "%~dp0"
echo Installing/updating dependencies...
pip install -e ../../shared/payload_codec --quiet
pip install -r requirements.txt --quiet
if errorlevel 1 (
  echo.
  echo Dependency install failed - see the error above.
  pause
  exit /b 1
)
echo.
echo Starting Gito Device Simulator...
echo Open http://localhost:5555 in your browser.
echo.
python bridge_ui.py
pause
