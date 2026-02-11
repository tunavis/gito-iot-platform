-- Generate telemetry data that matches device type schemas
-- Disable RLS for bulk insert
ALTER TABLE telemetry DISABLE ROW LEVEL SECURITY;

-- Get tenant_id (assuming single tenant for now)
DO $$
DECLARE
    v_tenant_id UUID;
    v_device_id UUID;
    v_device_name TEXT;
    v_device_type_name TEXT;
    v_data_model JSONB;
    v_ts TIMESTAMPTZ;
    metric JSONB;
BEGIN
    -- Get tenant_id
    SELECT id INTO v_tenant_id FROM tenants LIMIT 1;

    -- Loop through each device
    FOR v_device_id, v_device_name, v_device_type_name, v_data_model IN
        SELECT d.id, d.name, dt.name, dt.data_model
        FROM devices d
        JOIN device_types dt ON d.device_type_id = dt.id
        ORDER BY d.name
    LOOP
        RAISE NOTICE 'Generating data for: % (%)', v_device_name, v_device_type_name;

        -- Generate 24 hours of data (every 5 minutes = 288 points)
        FOR i IN 0..287 LOOP
            v_ts := NOW() - INTERVAL '24 hours' + (i * INTERVAL '5 minutes');

            -- GPS Tracker
            IF v_device_type_name = 'GPS Tracker' THEN
                -- latitude (-33.9 to -34.0 for Cape Town area)
                INSERT INTO telemetry (tenant_id, device_id, metric_key, metric_value, ts)
                VALUES (v_tenant_id, v_device_id, 'latitude', -33.9 - (random() * 0.1), v_ts);

                -- longitude (18.4 to 18.5 for Cape Town area)
                INSERT INTO telemetry (tenant_id, device_id, metric_key, metric_value, ts)
                VALUES (v_tenant_id, v_device_id, 'longitude', 18.4 + (random() * 0.1), v_ts);

                -- altitude (0-100m)
                INSERT INTO telemetry (tenant_id, device_id, metric_key, metric_value, ts)
                VALUES (v_tenant_id, v_device_id, 'altitude', random() * 100, v_ts);

                -- speed (0-80 km/h)
                INSERT INTO telemetry (tenant_id, device_id, metric_key, metric_value, ts)
                VALUES (v_tenant_id, v_device_id, 'speed', random() * 80, v_ts);

                -- battery (70-100%)
                INSERT INTO telemetry (tenant_id, device_id, metric_key, metric_value, ts)
                VALUES (v_tenant_id, v_device_id, 'battery', 70 + (random() * 30), v_ts);

            -- Environmental Sensor
            ELSIF v_device_type_name = 'Environmental Sensor' THEN
                -- temperature (20-30°C for normal environment)
                INSERT INTO telemetry (tenant_id, device_id, metric_key, metric_value, ts)
                VALUES (v_tenant_id, v_device_id, 'temperature', 20 + (random() * 10), v_ts);

                -- humidity (40-70%)
                INSERT INTO telemetry (tenant_id, device_id, metric_key, metric_value, ts)
                VALUES (v_tenant_id, v_device_id, 'humidity', 40 + (random() * 30), v_ts);

                -- pressure (1000-1020 hPa)
                INSERT INTO telemetry (tenant_id, device_id, metric_key, metric_value, ts)
                VALUES (v_tenant_id, v_device_id, 'pressure', 1000 + (random() * 20), v_ts);

                -- battery (80-100%)
                INSERT INTO telemetry (tenant_id, device_id, metric_key, metric_value, ts)
                VALUES (v_tenant_id, v_device_id, 'battery', 80 + (random() * 20), v_ts);

            -- LoRaWAN Gateway
            ELSIF v_device_type_name = 'LoRaWAN Gateway' THEN
                -- connected_devices (5-15)
                INSERT INTO telemetry (tenant_id, device_id, metric_key, metric_value, ts)
                VALUES (v_tenant_id, v_device_id, 'connected_devices', 5 + (random() * 10)::integer, v_ts);

                -- packets_received (100-500 per 5 min)
                INSERT INTO telemetry (tenant_id, device_id, metric_key, metric_value, ts)
                VALUES (v_tenant_id, v_device_id, 'packets_received', 100 + (random() * 400)::integer, v_ts);

                -- packets_transmitted (80-400 per 5 min)
                INSERT INTO telemetry (tenant_id, device_id, metric_key, metric_value, ts)
                VALUES (v_tenant_id, v_device_id, 'packets_transmitted', 80 + (random() * 320)::integer, v_ts);

                -- cpu_usage (20-60%)
                INSERT INTO telemetry (tenant_id, device_id, metric_key, metric_value, ts)
                VALUES (v_tenant_id, v_device_id, 'cpu_usage', 20 + (random() * 40), v_ts);

                -- memory_usage (30-70%)
                INSERT INTO telemetry (tenant_id, device_id, metric_key, metric_value, ts)
                VALUES (v_tenant_id, v_device_id, 'memory_usage', 30 + (random() * 40), v_ts);

            -- Smart Meter (power monitoring)
            ELSIF v_device_type_name = 'Smart Meter' THEN
                -- power (1000-5000 W)
                INSERT INTO telemetry (tenant_id, device_id, metric_key, metric_value, ts)
                VALUES (v_tenant_id, v_device_id, 'power', 1000 + (random() * 4000), v_ts);

                -- energy (cumulative kWh - grows over time)
                INSERT INTO telemetry (tenant_id, device_id, metric_key, metric_value, ts)
                VALUES (v_tenant_id, v_device_id, 'energy', 1000 + (i * 0.5), v_ts);

                -- voltage (220-240V)
                INSERT INTO telemetry (tenant_id, device_id, metric_key, metric_value, ts)
                VALUES (v_tenant_id, v_device_id, 'voltage', 220 + (random() * 20), v_ts);

                -- current (4-20A based on power)
                INSERT INTO telemetry (tenant_id, device_id, metric_key, metric_value, ts)
                VALUES (v_tenant_id, v_device_id, 'current', 4 + (random() * 16), v_ts);

            -- Modbus Industrial Meter
            ELSIF v_device_type_name = 'Modbus Industrial Meter' THEN
                -- pressure (50-150 bar)
                INSERT INTO telemetry (tenant_id, device_id, metric_key, metric_value, ts)
                VALUES (v_tenant_id, v_device_id, 'pressure', 50 + (random() * 100), v_ts);

                -- flow_rate (10-50 L/min)
                INSERT INTO telemetry (tenant_id, device_id, metric_key, metric_value, ts)
                VALUES (v_tenant_id, v_device_id, 'flow_rate', 10 + (random() * 40), v_ts);

            -- Smart Actuator (HVAC)
            ELSIF v_device_type_name = 'Smart Actuator' THEN
                -- state (0 or 1 as boolean)
                INSERT INTO telemetry (tenant_id, device_id, metric_key, metric_value_str, ts)
                VALUES (v_tenant_id, v_device_id, 'state', CASE WHEN random() > 0.3 THEN 'on' ELSE 'off' END, v_ts);

                -- power (0-2000 W when on)
                INSERT INTO telemetry (tenant_id, device_id, metric_key, metric_value, ts)
                VALUES (v_tenant_id, v_device_id, 'power', CASE WHEN random() > 0.3 THEN 1000 + (random() * 1000) ELSE 0 END, v_ts);

            -- OPC-UA PLC
            ELSIF v_device_type_name = 'OPC-UA PLC' THEN
                -- machine_status (string)
                INSERT INTO telemetry (tenant_id, device_id, metric_key, metric_value_str, ts)
                VALUES (v_tenant_id, v_device_id, 'machine_status',
                    CASE
                        WHEN random() < 0.7 THEN 'running'
                        WHEN random() < 0.9 THEN 'idle'
                        ELSE 'maintenance'
                    END, v_ts);

                -- production_count (cumulative - grows over time)
                INSERT INTO telemetry (tenant_id, device_id, metric_key, metric_value, ts)
                VALUES (v_tenant_id, v_device_id, 'production_count', 1000 + (i * 2)::integer, v_ts);

            -- Humidity Sensor (no schema - add default)
            ELSIF v_device_type_name = 'Humidity Sensor' THEN
                -- humidity (40-80%)
                INSERT INTO telemetry (tenant_id, device_id, metric_key, metric_value, ts)
                VALUES (v_tenant_id, v_device_id, 'humidity', 40 + (random() * 40), v_ts);

                -- temperature (18-26°C)
                INSERT INTO telemetry (tenant_id, device_id, metric_key, metric_value, ts)
                VALUES (v_tenant_id, v_device_id, 'temperature', 18 + (random() * 8), v_ts);

            -- Water Flow Sensor (no schema - add default)
            ELSIF v_device_type_name = 'Water Flow Sensor' THEN
                -- flow_rate (5-50 m³/hr)
                INSERT INTO telemetry (tenant_id, device_id, metric_key, metric_value, ts)
                VALUES (v_tenant_id, v_device_id, 'flow_rate', 5 + (random() * 45), v_ts);

                -- pressure (2-6 bar)
                INSERT INTO telemetry (tenant_id, device_id, metric_key, metric_value, ts)
                VALUES (v_tenant_id, v_device_id, 'pressure', 2 + (random() * 4), v_ts);

            -- Energy Meter (no schema - add default)
            ELSIF v_device_type_name = 'Energy Meter' THEN
                -- voltage (220-240V)
                INSERT INTO telemetry (tenant_id, device_id, metric_key, metric_value, ts)
                VALUES (v_tenant_id, v_device_id, 'voltage', 220 + (random() * 20), v_ts);

                -- current (10-50A)
                INSERT INTO telemetry (tenant_id, device_id, metric_key, metric_value, ts)
                VALUES (v_tenant_id, v_device_id, 'current', 10 + (random() * 40), v_ts);

                -- power (2000-10000 W)
                INSERT INTO telemetry (tenant_id, device_id, metric_key, metric_value, ts)
                VALUES (v_tenant_id, v_device_id, 'power', 2000 + (random() * 8000), v_ts);

                -- energy (cumulative kWh)
                INSERT INTO telemetry (tenant_id, device_id, metric_key, metric_value, ts)
                VALUES (v_tenant_id, v_device_id, 'energy', 5000 + (i * 1.0), v_ts);

            END IF;
        END LOOP;
    END LOOP;

    RAISE NOTICE 'Telemetry data generation complete!';
END $$;

-- Re-enable RLS
ALTER TABLE telemetry ENABLE ROW LEVEL SECURITY;

-- Show summary
SELECT
    d.name as device_name,
    dt.name as device_type,
    COUNT(*) as data_points,
    COUNT(DISTINCT t.metric_key) as unique_metrics,
    STRING_AGG(DISTINCT t.metric_key, ', ' ORDER BY t.metric_key) as metrics
FROM telemetry t
JOIN devices d ON t.device_id = d.id
JOIN device_types dt ON d.device_type_id = dt.id
GROUP BY d.name, dt.name
ORDER BY d.name;
