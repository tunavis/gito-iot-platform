-- Add Telemetry Schemas to Existing Device Types
-- Run this to enable smart metric selection in dashboard widgets

-- Example: Generic IoT Sensor
UPDATE device_types
SET telemetry_schema = '{
  "temperature": {
    "type": "number",
    "unit": "°C",
    "min": -40,
    "max": 85,
    "description": "Ambient temperature"
  },
  "humidity": {
    "type": "number",
    "unit": "%",
    "min": 0,
    "max": 100,
    "description": "Relative humidity"
  },
  "battery": {
    "type": "number",
    "unit": "%",
    "min": 0,
    "max": 100,
    "description": "Battery level"
  }
}'::jsonb
WHERE category = 'sensor' AND telemetry_schema IS NULL;

-- Example: Water Flow Sensor
UPDATE device_types
SET telemetry_schema = '{
  "flow_rate": {
    "type": "number",
    "unit": "m³/hr",
    "min": 0,
    "max": 100,
    "description": "Water flow rate"
  },
  "velocity": {
    "type": "number",
    "unit": "m/s",
    "min": 0,
    "max": 10,
    "description": "Flow velocity"
  },
  "total_volume": {
    "type": "number",
    "unit": "m³",
    "min": 0,
    "description": "Cumulative volume"
  },
  "pressure": {
    "type": "number",
    "unit": "bar",
    "min": 0,
    "max": 10,
    "description": "Water pressure"
  }
}'::jsonb
WHERE name ILIKE '%water%' AND telemetry_schema IS NULL;

-- Example: Energy Meter
UPDATE device_types
SET telemetry_schema = '{
  "power": {
    "type": "number",
    "unit": "kW",
    "min": 0,
    "description": "Current power consumption"
  },
  "voltage": {
    "type": "number",
    "unit": "V",
    "min": 0,
    "max": 500,
    "description": "Voltage"
  },
  "current": {
    "type": "number",
    "unit": "A",
    "min": 0,
    "description": "Current"
  },
  "energy": {
    "type": "number",
    "unit": "kWh",
    "min": 0,
    "description": "Cumulative energy consumption"
  },
  "power_factor": {
    "type": "number",
    "unit": "",
    "min": 0,
    "max": 1,
    "description": "Power factor"
  }
}'::jsonb
WHERE (name ILIKE '%energy%' OR name ILIKE '%meter%') AND telemetry_schema IS NULL;

-- Example: GPS Tracker
UPDATE device_types
SET telemetry_schema = '{
  "latitude": {
    "type": "number",
    "unit": "°",
    "min": -90,
    "max": 90,
    "description": "GPS latitude"
  },
  "longitude": {
    "type": "number",
    "unit": "°",
    "min": -180,
    "max": 180,
    "description": "GPS longitude"
  },
  "speed": {
    "type": "number",
    "unit": "km/h",
    "min": 0,
    "description": "Vehicle speed"
  },
  "altitude": {
    "type": "number",
    "unit": "m",
    "description": "Altitude above sea level"
  },
  "satellites": {
    "type": "integer",
    "unit": "",
    "min": 0,
    "max": 20,
    "description": "Number of GPS satellites"
  }
}'::jsonb
WHERE (name ILIKE '%gps%' OR name ILIKE '%tracker%') AND telemetry_schema IS NULL;

-- Verify schemas were added
SELECT
  name,
  category,
  CASE
    WHEN telemetry_schema IS NOT NULL THEN jsonb_object_keys(telemetry_schema)
    ELSE 'NO SCHEMA'
  END as metrics
FROM device_types
ORDER BY name;
