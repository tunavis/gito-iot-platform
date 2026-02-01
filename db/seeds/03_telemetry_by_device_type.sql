-- Seed type-specific telemetry data (Industry Standard)
-- Each device type gets appropriate metrics only

-- Temperature/Environmental Sensors
INSERT INTO telemetry_hot (device_id, tenant_id, timestamp, temperature, humidity, pressure, battery)
SELECT
    d.id,
    d.tenant_id,
    NOW() - (hour || ' hours')::INTERVAL,
    20 + (random() * 10)::numeric(5,2),
    40 + (random() * 40)::numeric(5,2),
    1000 + (random() * 50)::numeric(6,2),
    85 + (random() * 10)::numeric(5,2)
FROM devices d
JOIN device_types dt ON d.device_type_id = dt.id
WHERE dt.category IN ('sensor', 'environmental')
CROSS JOIN generate_series(0, 23) as hour;

-- Water Flow Meters (no temperature!)
INSERT INTO telemetry_hot (device_id, tenant_id, timestamp, battery, payload)
SELECT
    d.id,
    d.tenant_id,
    NOW() - (hour || ' hours')::INTERVAL,
    85 + (random() * 10)::numeric(5,2),
    jsonb_build_object(
        'flow_rate', (10 + random() * 40)::numeric(6,2),
        'velocity', (0.5 + random() * 2.5)::numeric(4,2),
        'total_volume', (100 + random() * 400)::numeric(8,2),
        'pressure', (2 + random() * 3)::numeric(4,2)
    )
FROM devices d
JOIN device_types dt ON d.device_type_id = dt.id
WHERE dt.name ILIKE '%water%' OR dt.category = 'utilities'
CROSS JOIN generate_series(0, 23) as hour;

-- GPS Trackers (location data only!)
INSERT INTO telemetry_hot (device_id, tenant_id, timestamp, battery, payload)
SELECT
    d.id,
    d.tenant_id,
    NOW() - (hour || ' hours')::INTERVAL,
    75 + (random() * 20)::numeric(5,2),
    jsonb_build_object(
        'latitude', (25.0 + random() * 0.1)::numeric(10,6),
        'longitude', (55.0 + random() * 0.1)::numeric(10,6),
        'speed', (random() * 120)::numeric(5,2),
        'altitude', (50 + random() * 100)::numeric(6,2),
        'satellites', (8 + random() * 4)::int
    )
FROM devices d
JOIN device_types dt ON d.device_type_id = dt.id
WHERE dt.name ILIKE '%gps%' OR dt.name ILIKE '%tracker%' OR dt.category = 'fleet'
CROSS JOIN generate_series(0, 23) as hour;

-- Energy Meters
INSERT INTO telemetry_hot (device_id, tenant_id, timestamp, battery, payload)
SELECT
    d.id,
    d.tenant_id,
    NOW() - (hour || ' hours')::INTERVAL,
    90 + (random() * 8)::numeric(5,2),
    jsonb_build_object(
        'power', (1 + random() * 9)::numeric(6,2),
        'voltage', (220 + random() * 10 - 5)::numeric(6,2),
        'current', (1 + random() * 19)::numeric(6,2),
        'energy', (10 + random() * 90)::numeric(8,2),
        'power_factor', (0.85 + random() * 0.1)::numeric(4,2)
    )
FROM devices d
JOIN device_types dt ON d.device_type_id = dt.id
WHERE dt.name ILIKE '%energy%' OR dt.name ILIKE '%meter%'
CROSS JOIN generate_series(0, 23) as hour;

-- Generic IoT Devices (fallback - basic metrics only)
INSERT INTO telemetry_hot (device_id, tenant_id, timestamp, temperature, battery, rssi)
SELECT
    d.id,
    d.tenant_id,
    NOW() - (hour || ' hours')::INTERVAL,
    20 + (random() * 10)::numeric(5,2),
    80 + (random() * 15)::numeric(5,2),
    (-120 + random() * 40)::int
FROM devices d
LEFT JOIN device_types dt ON d.device_type_id = dt.id
WHERE d.device_type_id IS NULL
   OR dt.category NOT IN ('sensor', 'environmental', 'utilities', 'fleet')
CROSS JOIN generate_series(0, 23) as hour;
