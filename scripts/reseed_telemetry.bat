@echo off
echo ============================================
echo CLEAN TELEMETRY RESEED - Industry Standard
echo ============================================
echo.

echo Running clean telemetry seed...
docker exec -i gito-postgres psql -U postgres -d gito_iot < db\seeds\04_clean_telemetry_seed.sql

echo.
echo ============================================
echo DONE!
echo ============================================
echo.
echo GPS Trackers: latitude, longitude, speed, altitude, satellites, battery
echo Temp Sensors: temperature, humidity, pressure, battery
echo Water Meters: flow_rate, velocity, positive_cumulative, negative_cumulative, pressure, battery
echo Energy Meters: power, voltage, current, energy, power_factor, battery
echo.
echo REFRESH YOUR BROWSER (Ctrl+F5) to see changes!
echo ============================================
pause
