-- CLEAN TELEMETRY SEED - Industry Standard
-- Each device gets ONLY its type-specific metrics

-- Step 1: Clear ALL existing telemetry
TRUNCATE telemetry_hot CASCADE;

-- Step 2: GPS Trackers ONLY (location metrics)
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
CROSS JOIN generate_series(0, 23) as hour
WHERE d.name ILIKE '%GPS%' OR d.name ILIKE '%TRACKER%';

-- Step 3: Temperature Sensors ONLY (environmental metrics)
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
CROSS JOIN generate_series(0, 23) as hour
WHERE (d.name ILIKE '%TEMP%' OR d.name ILIKE '%THERMO%' OR d.name ILIKE '%SENSOR%')
  AND d.name NOT ILIKE '%GPS%'
  AND d.name NOT ILIKE '%TRACKER%'
  AND d.name NOT ILIKE '%WATER%'
  AND d.name NOT ILIKE '%FLOW%';

-- Step 4: Water Meters ONLY (flow metrics)
INSERT INTO telemetry_hot (device_id, tenant_id, timestamp, battery, payload)
SELECT
    d.id,
    d.tenant_id,
    NOW() - (hour || ' hours')::INTERVAL,
    85 + (random() * 10)::numeric(5,2),
    jsonb_build_object(
        'flow_rate', (10 + random() * 40)::numeric(6,2),
        'velocity', (0.5 + random() * 2.5)::numeric(4,2),
        'positive_cumulative', (100 + hour * 10 + random() * 20)::numeric(8,2),
        'negative_cumulative', (5 + hour * 0.5 + random() * 2)::numeric(8,2),
        'pressure', (2 + random() * 3)::numeric(4,2)
    )
FROM devices d
CROSS JOIN generate_series(0, 23) as hour
WHERE d.name ILIKE '%WATER%' OR d.name ILIKE '%FLOW%';

-- Step 5: Energy Meters ONLY (power metrics)
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
CROSS JOIN generate_series(0, 23) as hour
WHERE (d.name ILIKE '%ENERGY%' OR d.name ILIKE '%METER%')
  AND d.name NOT ILIKE '%WATER%'
  AND d.name NOT ILIKE '%FLOW%';

-- Verify: Show device names and their metric counts
SELECT
    d.name,
    COUNT(t.*) as data_points
FROM devices d
LEFT JOIN telemetry_hot t ON d.id = t.device_id
GROUP BY d.name
ORDER BY d.name
LIMIT 20;
