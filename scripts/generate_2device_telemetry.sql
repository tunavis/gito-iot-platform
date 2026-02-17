-- Generate fresh 24-hour telemetry data for 2 devices
-- Run: docker exec gito-postgres psql -U gito -d gito -f /scripts/generate_2device_telemetry.sql

-- Device 1: Lethabo Boiler Temp Sensor (Environmental Sensor)
-- 288 points (5-minute intervals over 24 hours)
INSERT INTO telemetry (tenant_id, device_id, metric_key, metric_value, metric_value_str, ts)
SELECT
    '00000000-0000-0000-0000-000000000001'::uuid AS tenant_id,
    '64e34d0e-569d-4912-9447-b2e9166d37c9'::uuid AS device_id,
    metric_key,
    metric_value,
    NULL AS metric_value_str,
    NOW() - (interval '5 minutes' * point) AS ts
FROM (
    SELECT generate_series(0, 287) AS point
) points
CROSS JOIN LATERAL (
    VALUES
        ('temperature', 45.0 + (random() * 20 - 10) + 15 * sin(point * 0.02)),
        ('humidity', 55.0 + (random() * 10 - 5) + 10 * cos(point * 0.015)),
        ('pressure', 1010.0 + (random() * 8 - 4) + 5 * sin(point * 0.01)),
        ('battery', 90.0 - point * 0.01 + (random() * 2 - 1))
) AS metrics(metric_key, metric_value);

-- Device 2: Lethabo Turbine Power Monitor (Smart Meter)
-- 288 points (5-minute intervals over 24 hours)
INSERT INTO telemetry (tenant_id, device_id, metric_key, metric_value, metric_value_str, ts)
SELECT
    '00000000-0000-0000-0000-000000000001'::uuid AS tenant_id,
    'da4d7a1a-60d7-4eb4-a66f-57c8aaf9e5f1'::uuid AS device_id,
    metric_key,
    metric_value,
    NULL AS metric_value_str,
    NOW() - (interval '5 minutes' * point) AS ts
FROM (
    SELECT generate_series(0, 287) AS point
) points
CROSS JOIN LATERAL (
    VALUES
        ('active_power', 3000.0 + (random() * 1000 - 500) + 1500 * sin(point * 0.025)),
        ('voltage', 230.0 + (random() * 4 - 2) + 5 * cos(point * 0.01)),
        ('current', 15.0 + (random() * 5 - 2.5) + 8 * sin(point * 0.025)),
        ('energy', 1000.0 + point * 0.25 + (random() * 0.1)),
        ('frequency', 50.0 + (random() * 0.2 - 0.1)),
        ('power_factor', 0.92 + (random() * 0.06 - 0.03))
) AS metrics(metric_key, metric_value);

-- Verify data was inserted
SELECT
    d.name,
    COUNT(*) AS total_points,
    COUNT(DISTINCT metric_key) AS unique_metrics,
    MIN(ts) AS oldest,
    MAX(ts) AS newest
FROM telemetry t
JOIN devices d ON t.device_id = d.id
WHERE t.device_id IN (
    '64e34d0e-569d-4912-9447-b2e9166d37c9',
    'da4d7a1a-60d7-4eb4-a66f-57c8aaf9e5f1'
)
GROUP BY d.name, t.device_id
ORDER BY d.name;
