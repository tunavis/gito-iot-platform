@echo off
echo ========================================
echo Gito IoT Database Seeding
echo ========================================
echo.

REM Check if Python is installed
python --version >nul 2>&1
if errorlevel 1 (
    echo ERROR: Python is not installed or not in PATH
    pause
    exit /b 1
)

echo Installing dependencies...
pip install -r requirements.txt

echo.
echo Running database seeding script...
python seed_realistic_data.py

echo.
echo ========================================
echo Seeding complete!
echo ========================================
pause
