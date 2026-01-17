-- Seed telemetry data for demo/development

INSERT INTO telemetry_hot (device_id, tenant_id, timestamp, temperature, humidity, pressure, battery, rssi, payload)
SELECT 
    d.id,
    d.tenant_id,
    NOW() - (hour || ' hours')::INTERVAL,
    20 + (random() * 10),
    40 + (random() * 40),
    1000 + (random() * 50),
    85 + (random() * 10),
    (-120 + random() * 40)::int,
    jsonb_build_object(
        'message_count', (random() * 100)::int,
        'signal_quality', CASE WHEN random() > 0.8 THEN 'excellent' WHEN random() > 0.5 THEN 'good' ELSE 'fair' END
    )
FROM devices d
CROSS JOIN generate_series(0, 23) as hour;
