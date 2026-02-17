-- ============================================================================
-- Gito IoT Platform - Staging Seed Data
-- ============================================================================
-- Idempotent: safe to run multiple times (uses ON CONFLICT DO NOTHING)
-- Fixed UUIDs: predictable IDs for scripting and debugging
--
-- Credentials: admin@gito.co.za / Admin123!
-- URL: https://dev-iot.gito.co.za
-- ============================================================================

-- ============================================================================
-- TENANT
-- ============================================================================
INSERT INTO tenants (id, name, slug, status)
VALUES ('10000000-0000-0000-0000-000000000001', 'Gito Demo', 'gito-demo', 'active')
ON CONFLICT (id) DO NOTHING;

-- ============================================================================
-- ADMIN USER  (password: Admin123!)
-- ============================================================================
INSERT INTO users (id, tenant_id, email, password_hash, full_name, role, status)
VALUES (
    '20000000-0000-0000-0000-000000000001',
    '10000000-0000-0000-0000-000000000001',
    'admin@gito.co.za',
    crypt('Admin123!', gen_salt('bf', 12)),
    'Demo Admin',
    'TENANT_ADMIN',
    'active'
)
ON CONFLICT (id) DO NOTHING;

-- ============================================================================
-- ORGANIZATION
-- ============================================================================
INSERT INTO organizations (id, tenant_id, name, slug, description, status)
VALUES (
    '30000000-0000-0000-0000-000000000001',
    '10000000-0000-0000-0000-000000000001',
    'Lethabo Energy',
    'lethabo-energy',
    'Industrial energy monitoring and control',
    'active'
)
ON CONFLICT (id) DO NOTHING;

-- ============================================================================
-- SITE
-- ============================================================================
INSERT INTO sites (id, tenant_id, organization_id, name, site_type, address, timezone)
VALUES (
    '40000000-0000-0000-0000-000000000001',
    '10000000-0000-0000-0000-000000000001',
    '30000000-0000-0000-0000-000000000001',
    'Cape Town Plant',
    'industrial',
    '1 Energy Drive, Cape Town, 8001',
    'Africa/Johannesburg'
)
ON CONFLICT (id) DO NOTHING;

-- ============================================================================
-- DEVICE TYPES
-- data_model format: array of {name, type, unit, min, max, required}
-- ============================================================================

-- Smart Water Meter (meter)
INSERT INTO device_types (id, tenant_id, name, description, manufacturer, model, category, connectivity, data_model)
VALUES (
    '50000000-0000-0000-0000-000000000001',
    '10000000-0000-0000-0000-000000000001',
    'Smart Water Meter',
    'Industrial water flow and volume monitoring',
    'Gito Instruments', 'GWM-100', 'meter',
    '{"protocol": "MQTT"}',
    '[
        {"name": "flow_rate",    "type": "float", "unit": "m³/hr", "min": 0,   "max": 100},
        {"name": "volume",       "type": "float", "unit": "m³",    "min": 0,   "max": 999999},
        {"name": "pressure",     "type": "float", "unit": "bar",   "min": 0,   "max": 10},
        {"name": "temperature",  "type": "float", "unit": "°C",    "min": -10, "max": 80}
    ]'
)
ON CONFLICT (id) DO NOTHING;

-- Environmental Sensor (sensor)
INSERT INTO device_types (id, tenant_id, name, description, manufacturer, model, category, connectivity, data_model)
VALUES (
    '50000000-0000-0000-0000-000000000002',
    '10000000-0000-0000-0000-000000000001',
    'Environmental Sensor',
    'Industrial temperature, humidity and pressure monitoring',
    'Gito Instruments', 'GES-200', 'sensor',
    '{"protocol": "LoRaWAN"}',
    '[
        {"name": "temperature", "type": "float", "unit": "°C",  "min": -40, "max": 85},
        {"name": "humidity",    "type": "float", "unit": "%",   "min": 0,   "max": 100},
        {"name": "pressure",    "type": "float", "unit": "hPa", "min": 900, "max": 1100},
        {"name": "battery",     "type": "float", "unit": "%",   "min": 0,   "max": 100}
    ]'
)
ON CONFLICT (id) DO NOTHING;

-- LoRaWAN Gateway (gateway)
INSERT INTO device_types (id, tenant_id, name, description, manufacturer, model, category, connectivity, data_model)
VALUES (
    '50000000-0000-0000-0000-000000000003',
    '10000000-0000-0000-0000-000000000001',
    'LoRaWAN Gateway',
    'Industrial LoRaWAN network gateway',
    'Gito Networks', 'GGW-400', 'gateway',
    '{"protocol": "TCP/IP"}',
    '[
        {"name": "connected_devices", "type": "int",   "unit": "",  "min": 0, "max": 1000},
        {"name": "cpu_usage",         "type": "float", "unit": "%", "min": 0, "max": 100},
        {"name": "memory_usage",      "type": "float", "unit": "%", "min": 0, "max": 100},
        {"name": "uptime",            "type": "float", "unit": "h", "min": 0, "max": 87600}
    ]'
)
ON CONFLICT (id) DO NOTHING;

-- PID Controller (controller)
INSERT INTO device_types (id, tenant_id, name, description, manufacturer, model, category, connectivity, data_model)
VALUES (
    '50000000-0000-0000-0000-000000000004',
    '10000000-0000-0000-0000-000000000001',
    'PID Controller',
    'Industrial process PID temperature controller',
    'Gito Controls', 'GPC-300', 'controller',
    '{"protocol": "Modbus"}',
    '[
        {"name": "process_value", "type": "float", "unit": "°C", "min": 0,    "max": 300},
        {"name": "setpoint",      "type": "float", "unit": "°C", "min": 0,    "max": 300},
        {"name": "output",        "type": "float", "unit": "%",  "min": 0,    "max": 100},
        {"name": "error",         "type": "float", "unit": "°C", "min": -300, "max": 300}
    ]'
)
ON CONFLICT (id) DO NOTHING;

-- Smart Actuator (actuator)
INSERT INTO device_types (id, tenant_id, name, description, manufacturer, model, category, connectivity, data_model)
VALUES (
    '50000000-0000-0000-0000-000000000005',
    '10000000-0000-0000-0000-000000000001',
    'Smart Actuator',
    'Motorized valve and actuator control',
    'Gito Controls', 'GSA-150', 'actuator',
    '{"protocol": "MQTT"}',
    '[
        {"name": "position",    "type": "float", "unit": "%", "min": 0,   "max": 100},
        {"name": "current",     "type": "float", "unit": "A", "min": 0,   "max": 10},
        {"name": "power",       "type": "float", "unit": "W", "min": 0,   "max": 500},
        {"name": "temperature", "type": "float", "unit": "°C","min": -10, "max": 80}
    ]'
)
ON CONFLICT (id) DO NOTHING;

-- Asset Tracker (tracker)
INSERT INTO device_types (id, tenant_id, name, description, manufacturer, model, category, connectivity, data_model)
VALUES (
    '50000000-0000-0000-0000-000000000006',
    '10000000-0000-0000-0000-000000000001',
    'Asset Tracker',
    'GPS asset tracking with battery reporting',
    'Gito Track', 'GTR-500', 'tracker',
    '{"protocol": "GPS/GPRS"}',
    '[
        {"name": "latitude",  "type": "float", "unit": "°",    "min": -90,  "max": 90},
        {"name": "longitude", "type": "float", "unit": "°",    "min": -180, "max": 180},
        {"name": "speed",     "type": "float", "unit": "km/h", "min": 0,    "max": 200},
        {"name": "battery",   "type": "float", "unit": "%",    "min": 0,    "max": 100}
    ]'
)
ON CONFLICT (id) DO NOTHING;

-- Smart Power Meter (meter)
INSERT INTO device_types (id, tenant_id, name, description, manufacturer, model, category, connectivity, data_model)
VALUES (
    '50000000-0000-0000-0000-000000000007',
    '10000000-0000-0000-0000-000000000001',
    'Smart Power Meter',
    'Three-phase industrial power metering',
    'Gito Instruments', 'GPM-600', 'meter',
    '{"protocol": "Modbus"}',
    '[
        {"name": "active_power",  "type": "float", "unit": "kW",  "min": 0,  "max": 5000},
        {"name": "voltage",       "type": "float", "unit": "V",   "min": 0,  "max": 500},
        {"name": "current",       "type": "float", "unit": "A",   "min": 0,  "max": 1000},
        {"name": "energy",        "type": "float", "unit": "kWh", "min": 0,  "max": 9999999},
        {"name": "frequency",     "type": "float", "unit": "Hz",  "min": 45, "max": 55},
        {"name": "power_factor",  "type": "float", "unit": "",    "min": 0,  "max": 1}
    ]'
)
ON CONFLICT (id) DO NOTHING;

-- ============================================================================
-- DEVICES (2 per type, one online one offline per pair)
-- device_type field is auto-synced from device_types.name by trigger
-- ============================================================================
INSERT INTO devices (id, tenant_id, organization_id, site_id, device_type_id, device_type, name, description, status, serial_number, last_seen)
VALUES
-- Water Meters
('60000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000001', '50000000-0000-0000-0000-000000000001', 'Smart Water Meter',    'Lethabo Water Meter 1',          'Main supply line metering',               'online',  'GWM-001', NOW() - interval '3 minutes'),
('60000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000001', '50000000-0000-0000-0000-000000000001', 'Smart Water Meter',    'Lethabo Water Meter 2',          'Secondary cooling loop',                  'offline', 'GWM-002', NOW() - interval '2 hours'),
-- Environmental Sensors
('60000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000001', '50000000-0000-0000-0000-000000000002', 'Environmental Sensor', 'Boiler Room Sensor',             'High-temperature boiler room',            'online',  'GES-001', NOW() - interval '5 minutes'),
('60000000-0000-0000-0000-000000000004', '10000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000001', '50000000-0000-0000-0000-000000000002', 'Environmental Sensor', 'Cold Storage Monitor',           'Freezer room environmental monitoring',   'online',  'GES-002', NOW() - interval '8 minutes'),
-- Gateways
('60000000-0000-0000-0000-000000000005', '10000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000001', '50000000-0000-0000-0000-000000000003', 'LoRaWAN Gateway',      'Gateway Alpha',                  'Primary LoRaWAN network gateway',         'online',  'GGW-001', NOW() - interval '1 minute'),
('60000000-0000-0000-0000-000000000006', '10000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000001', '50000000-0000-0000-0000-000000000003', 'LoRaWAN Gateway',      'Gateway Beta',                   'Backup LoRaWAN gateway',                  'offline', 'GGW-002', NOW() - interval '6 hours'),
-- Controllers
('60000000-0000-0000-0000-000000000007', '10000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000001', '50000000-0000-0000-0000-000000000004', 'PID Controller',       'Boiler Temperature Controller',  'Boiler steam temperature PID control',    'online',  'GPC-001', NOW() - interval '2 minutes'),
('60000000-0000-0000-0000-000000000008', '10000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000001', '50000000-0000-0000-0000-000000000004', 'PID Controller',       'HVAC Controller',                'Building HVAC temperature control',       'online',  'GPC-002', NOW() - interval '4 minutes'),
-- Actuators
('60000000-0000-0000-0000-000000000009', '10000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000001', '50000000-0000-0000-0000-000000000005', 'Smart Actuator',       'Main Supply Valve',              'Primary water supply control valve',      'online',  'GSA-001', NOW() - interval '6 minutes'),
('60000000-0000-0000-0000-000000000010', '10000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000001', '50000000-0000-0000-0000-000000000005', 'Smart Actuator',       'Cooling Pump',                   'Secondary cooling loop pump',             'online',  'GSA-002', NOW() - interval '9 minutes'),
-- Trackers
('60000000-0000-0000-0000-000000000011', '10000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000001', '50000000-0000-0000-0000-000000000006', 'Asset Tracker',        'Fleet Vehicle 1',                'Delivery truck GPS tracker',              'online',  'GTR-001', NOW() - interval '7 minutes'),
('60000000-0000-0000-0000-000000000012', '10000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000001', '50000000-0000-0000-0000-000000000006', 'Asset Tracker',        'Asset Tag 001',                  'High-value equipment tracker',            'online',  'GTR-002', NOW() - interval '15 minutes'),
-- Power Meters
('60000000-0000-0000-0000-000000000013', '10000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000001', '50000000-0000-0000-0000-000000000007', 'Smart Power Meter',    'Main Distribution Board',        'Plant main electrical metering',          'online',  'GPM-001', NOW() - interval '2 minutes'),
('60000000-0000-0000-0000-000000000014', '10000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000001', '50000000-0000-0000-0000-000000000007', 'Smart Power Meter',    'Production Line Meter',          'Production line power consumption',       'online',  'GPM-002', NOW() - interval '11 minutes')
ON CONFLICT (id) DO NOTHING;

-- ============================================================================
-- ALERT RULES
-- ============================================================================
INSERT INTO alert_rules (id, tenant_id, name, description, rule_type, severity, active, device_id, metric, operator, threshold, cooldown_minutes)
VALUES
(
    '70000000-0000-0000-0000-000000000001',
    '10000000-0000-0000-0000-000000000001',
    'Boiler High Temperature',
    'Alert when boiler room temperature exceeds 80°C',
    'THRESHOLD', 'CRITICAL', true,
    '60000000-0000-0000-0000-000000000003',
    'temperature', '>', 80, 5
),
(
    '70000000-0000-0000-0000-000000000002',
    '10000000-0000-0000-0000-000000000001',
    'Low Battery Warning',
    'Alert when tracker battery falls below 20%',
    'THRESHOLD', 'MAJOR', true,
    '60000000-0000-0000-0000-000000000011',
    'battery', '<', 20, 30
),
(
    '70000000-0000-0000-0000-000000000003',
    '10000000-0000-0000-0000-000000000001',
    'High Power Consumption',
    'Alert when main board active power exceeds 4500 kW',
    'THRESHOLD', 'MAJOR', true,
    '60000000-0000-0000-0000-000000000013',
    'active_power', '>', 4500, 10
)
ON CONFLICT (id) DO NOTHING;

-- ============================================================================
-- TELEMETRY (48 points per device = 24 hours at 30-min intervals)
-- Only runs if no telemetry exists for this tenant yet (idempotent)
-- ============================================================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM telemetry
    WHERE tenant_id = '10000000-0000-0000-0000-000000000001'
    LIMIT 1
  ) THEN

    -- Water Meter 1: flow_rate, volume, pressure, temperature
    INSERT INTO telemetry (tenant_id, device_id, metric_key, metric_value, ts)
    SELECT '10000000-0000-0000-0000-000000000001', '60000000-0000-0000-0000-000000000001',
           m.key, m.val, NOW() - (interval '30 minutes' * pt)
    FROM generate_series(0, 47) AS pt
    CROSS JOIN LATERAL (VALUES
        ('flow_rate',   45.0  + (random() * 20 - 10) + 15 * sin(pt * 0.15)),
        ('volume',      12500.0 + pt * 22.5),
        ('pressure',    4.2   + (random() * 0.4 - 0.2)),
        ('temperature', 18.5  + (random() * 2 - 1))
    ) AS m(key, val);

    -- Boiler Room Sensor: temperature, humidity, pressure, battery
    INSERT INTO telemetry (tenant_id, device_id, metric_key, metric_value, ts)
    SELECT '10000000-0000-0000-0000-000000000001', '60000000-0000-0000-0000-000000000003',
           m.key, m.val, NOW() - (interval '30 minutes' * pt)
    FROM generate_series(0, 47) AS pt
    CROSS JOIN LATERAL (VALUES
        ('temperature', 65.0 + (random() * 20 - 10) + 12 * sin(pt * 0.12)),
        ('humidity',    45.0 + (random() * 10 - 5)  + 8  * cos(pt * 0.10)),
        ('pressure',    1013.0 + (random() * 4 - 2)),
        ('battery',     92.0 - pt * 0.08 + (random() * 1 - 0.5))
    ) AS m(key, val);

    -- Cold Storage Monitor: temperature (sub-zero), humidity, pressure, battery
    INSERT INTO telemetry (tenant_id, device_id, metric_key, metric_value, ts)
    SELECT '10000000-0000-0000-0000-000000000001', '60000000-0000-0000-0000-000000000004',
           m.key, m.val, NOW() - (interval '30 minutes' * pt)
    FROM generate_series(0, 47) AS pt
    CROSS JOIN LATERAL (VALUES
        ('temperature', -18.0 + (random() * 4 - 2)  + 2  * sin(pt * 0.08)),
        ('humidity',    85.0  + (random() * 6 - 3)),
        ('pressure',    1011.0 + (random() * 3 - 1.5)),
        ('battery',     78.0  - pt * 0.05 + (random() * 1 - 0.5))
    ) AS m(key, val);

    -- Gateway Alpha: connected_devices, cpu_usage, memory_usage, uptime
    INSERT INTO telemetry (tenant_id, device_id, metric_key, metric_value, ts)
    SELECT '10000000-0000-0000-0000-000000000001', '60000000-0000-0000-0000-000000000005',
           m.key, m.val, NOW() - (interval '30 minutes' * pt)
    FROM generate_series(0, 47) AS pt
    CROSS JOIN LATERAL (VALUES
        ('connected_devices', 12.0 + floor(random() * 4)),
        ('cpu_usage',         35.0 + (random() * 20 - 10) + 10 * sin(pt * 0.20)),
        ('memory_usage',      58.0 + (random() * 10 - 5)),
        ('uptime',            720.0 + pt * 0.5)
    ) AS m(key, val);

    -- Boiler Temperature Controller: process_value, setpoint, output, error
    INSERT INTO telemetry (tenant_id, device_id, metric_key, metric_value, ts)
    SELECT '10000000-0000-0000-0000-000000000001', '60000000-0000-0000-0000-000000000007',
           m.key, m.val, NOW() - (interval '30 minutes' * pt)
    FROM generate_series(0, 47) AS pt
    CROSS JOIN LATERAL (VALUES
        ('process_value', 148.0 + (random() * 10 - 5) + 8 * sin(pt * 0.18)),
        ('setpoint',      150.0),
        ('output',        67.0  + (random() * 15 - 7.5)),
        ('error',         -2.0  + (random() * 4 - 2))
    ) AS m(key, val);

    -- HVAC Controller: process_value, setpoint, output, error
    INSERT INTO telemetry (tenant_id, device_id, metric_key, metric_value, ts)
    SELECT '10000000-0000-0000-0000-000000000001', '60000000-0000-0000-0000-000000000008',
           m.key, m.val, NOW() - (interval '30 minutes' * pt)
    FROM generate_series(0, 47) AS pt
    CROSS JOIN LATERAL (VALUES
        ('process_value', 22.5  + (random() * 3 - 1.5) + 2 * cos(pt * 0.10)),
        ('setpoint',      21.0),
        ('output',        45.0  + (random() * 20 - 10)),
        ('error',         1.5   + (random() * 2 - 1))
    ) AS m(key, val);

    -- Main Supply Valve: position, current, power, temperature
    INSERT INTO telemetry (tenant_id, device_id, metric_key, metric_value, ts)
    SELECT '10000000-0000-0000-0000-000000000001', '60000000-0000-0000-0000-000000000009',
           m.key, m.val, NOW() - (interval '30 minutes' * pt)
    FROM generate_series(0, 47) AS pt
    CROSS JOIN LATERAL (VALUES
        ('position',    75.0 + (random() * 10 - 5)),
        ('current',     2.5  + (random() * 0.8 - 0.4)),
        ('power',       145.0 + (random() * 30 - 15)),
        ('temperature', 42.0 + (random() * 6 - 3))
    ) AS m(key, val);

    -- Cooling Pump: position, current, power, temperature
    INSERT INTO telemetry (tenant_id, device_id, metric_key, metric_value, ts)
    SELECT '10000000-0000-0000-0000-000000000001', '60000000-0000-0000-0000-000000000010',
           m.key, m.val, NOW() - (interval '30 minutes' * pt)
    FROM generate_series(0, 47) AS pt
    CROSS JOIN LATERAL (VALUES
        ('position',    100.0),
        ('current',     4.8  + (random() * 1 - 0.5)),
        ('power',       290.0 + (random() * 40 - 20)),
        ('temperature', 55.0 + (random() * 8 - 4))
    ) AS m(key, val);

    -- Fleet Vehicle 1: latitude, longitude, speed, battery (Cape Town routes)
    INSERT INTO telemetry (tenant_id, device_id, metric_key, metric_value, ts)
    SELECT '10000000-0000-0000-0000-000000000001', '60000000-0000-0000-0000-000000000011',
           m.key, m.val, NOW() - (interval '30 minutes' * pt)
    FROM generate_series(0, 47) AS pt
    CROSS JOIN LATERAL (VALUES
        ('latitude',  -33.9249 + (random() * 0.05 - 0.025)),
        ('longitude',  18.4241 + (random() * 0.05 - 0.025)),
        ('speed',      45.0   + (random() * 60 - 20)),
        ('battery',    82.0   - pt * 0.04 + (random() * 2 - 1))
    ) AS m(key, val);

    -- Asset Tag 001: latitude, longitude, speed (stationary), battery
    INSERT INTO telemetry (tenant_id, device_id, metric_key, metric_value, ts)
    SELECT '10000000-0000-0000-0000-000000000001', '60000000-0000-0000-0000-000000000012',
           m.key, m.val, NOW() - (interval '30 minutes' * pt)
    FROM generate_series(0, 47) AS pt
    CROSS JOIN LATERAL (VALUES
        ('latitude',  -33.8688 + (random() * 0.002 - 0.001)),
        ('longitude',  18.5742 + (random() * 0.002 - 0.001)),
        ('speed',      0.0),
        ('battery',    65.0 - pt * 0.03 + (random() * 1 - 0.5))
    ) AS m(key, val);

    -- Main Distribution Board: active_power, voltage, current, energy, frequency, power_factor
    INSERT INTO telemetry (tenant_id, device_id, metric_key, metric_value, ts)
    SELECT '10000000-0000-0000-0000-000000000001', '60000000-0000-0000-0000-000000000013',
           m.key, m.val, NOW() - (interval '30 minutes' * pt)
    FROM generate_series(0, 47) AS pt
    CROSS JOIN LATERAL (VALUES
        ('active_power',  3200.0 + (random() * 800 - 400)  + 1000 * sin(pt * 0.12)),
        ('voltage',        231.0 + (random() * 4 - 2)),
        ('current',         14.0 + (random() * 4 - 2)      + 4    * sin(pt * 0.12)),
        ('energy',        52000.0 + pt * 80),
        ('frequency',        50.0 + (random() * 0.2 - 0.1)),
        ('power_factor',      0.94 + (random() * 0.04 - 0.02))
    ) AS m(key, val);

    -- Production Line Meter: active_power, voltage, current, energy, frequency, power_factor
    INSERT INTO telemetry (tenant_id, device_id, metric_key, metric_value, ts)
    SELECT '10000000-0000-0000-0000-000000000001', '60000000-0000-0000-0000-000000000014',
           m.key, m.val, NOW() - (interval '30 minutes' * pt)
    FROM generate_series(0, 47) AS pt
    CROSS JOIN LATERAL (VALUES
        ('active_power',  1800.0 + (random() * 600 - 300) + 600 * sin(pt * 0.15)),
        ('voltage',        229.0 + (random() * 4 - 2)),
        ('current',          8.0 + (random() * 3 - 1.5)  + 3   * sin(pt * 0.15)),
        ('energy',        28000.0 + pt * 45),
        ('frequency',        50.0 + (random() * 0.2 - 0.1)),
        ('power_factor',      0.91 + (random() * 0.06 - 0.03))
    ) AS m(key, val);

  END IF;
END $$;

-- ============================================================================
-- SUMMARY
-- ============================================================================
SELECT
    'Tenants'      AS entity, COUNT(*) AS count FROM tenants   WHERE id = '10000000-0000-0000-0000-000000000001'
UNION ALL SELECT 'Users',         COUNT(*) FROM users        WHERE tenant_id = '10000000-0000-0000-0000-000000000001'
UNION ALL SELECT 'Organizations', COUNT(*) FROM organizations WHERE tenant_id = '10000000-0000-0000-0000-000000000001'
UNION ALL SELECT 'Device Types',  COUNT(*) FROM device_types  WHERE tenant_id = '10000000-0000-0000-0000-000000000001'
UNION ALL SELECT 'Devices',       COUNT(*) FROM devices       WHERE tenant_id = '10000000-0000-0000-0000-000000000001'
UNION ALL SELECT 'Alert Rules',   COUNT(*) FROM alert_rules   WHERE tenant_id = '10000000-0000-0000-0000-000000000001'
UNION ALL SELECT 'Telemetry',     COUNT(*) FROM telemetry     WHERE tenant_id = '10000000-0000-0000-0000-000000000001';
