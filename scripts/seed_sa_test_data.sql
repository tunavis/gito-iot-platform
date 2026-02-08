-- ============================================================================
-- SOUTH AFRICAN TEST DATA FOR GITO IOT PLATFORM
-- ============================================================================
-- Run with: docker exec -i gito-postgres psql -U gito -d gito < scripts/seed_sa_test_data.sql

\set tenant_id '00000000-0000-0000-0000-000000000001'

-- ============================================================================
-- 1. ORGANIZATIONS (South African utilities and enterprises)
-- ============================================================================

INSERT INTO organizations (id, tenant_id, name, slug, description, status, created_at, updated_at) VALUES
('10000000-0000-0000-0000-000000000001', :'tenant_id', 'Eskom Holdings SOC Ltd', 'eskom', 'South African electricity public utility', 'active', NOW(), NOW()),
('10000000-0000-0000-0000-000000000002', :'tenant_id', 'Rand Water', 'rand-water', 'Largest water utility in Africa', 'active', NOW(), NOW()),
('10000000-0000-0000-0000-000000000003', :'tenant_id', 'City of Cape Town', 'cpt-municipality', 'Cape Town Metropolitan Municipality', 'active', NOW(), NOW()),
('10000000-0000-0000-0000-000000000004', :'tenant_id', 'Johannesburg Water', 'jhb-water', 'Johannesburg water and sanitation utility', 'active', NOW(), NOW()),
('10000000-0000-0000-0000-000000000005', :'tenant_id', 'Transnet SOC Ltd', 'transnet', 'South African freight transport and logistics', 'active', NOW(), NOW())
ON CONFLICT (id) DO NOTHING;

-- ============================================================================
-- 2. SITES (Major South African cities and facilities)
-- ============================================================================

-- Johannesburg Sites
INSERT INTO sites (id, tenant_id, organization_id, name, site_type, address, coordinates, timezone, created_at, updated_at) VALUES
('20000000-0000-0000-0000-000000000001', :'tenant_id', '10000000-0000-0000-0000-000000000001', 'Lethabo Power Station', 'factory', 'Vereeniging, Gauteng', '{"lat": -26.7833, "lng": 27.9167}'::jsonb, 'Africa/Johannesburg', NOW(), NOW()),
('20000000-0000-0000-0000-000000000002', :'tenant_id', '10000000-0000-0000-0000-000000000004', 'Johannesburg CBD Water Plant', 'warehouse', 'Braamfontein, Johannesburg', '{"lat": -26.1929, "lng": 28.0336}'::jsonb, 'Africa/Johannesburg', NOW(), NOW()),
('20000000-0000-0000-0000-000000000003', :'tenant_id', '10000000-0000-0000-0000-000000000005', 'Johannesburg Container Terminal', 'warehouse', 'City Deep, Johannesburg', '{"lat": -26.2708, "lng": 28.0714}'::jsonb, 'Africa/Johannesburg', NOW(), NOW()),

-- Cape Town Sites
('20000000-0000-0000-0000-000000000004', :'tenant_id', '10000000-0000-0000-0000-000000000003', 'Cape Town CBD Monitoring Station', 'office', 'City Centre, Cape Town', '{"lat": -33.9249, "lng": 18.4241}'::jsonb, 'Africa/Johannesburg', NOW(), NOW()),
('20000000-0000-0000-0000-000000000005', :'tenant_id', '10000000-0000-0000-0000-000000000003', 'Table Bay Harbour Sensors', 'warehouse', 'V&A Waterfront, Cape Town', '{"lat": -33.9067, "lng": 18.4233}'::jsonb, 'Africa/Johannesburg', NOW(), NOW()),

-- Durban Sites
('20000000-0000-0000-0000-000000000006', :'tenant_id', '10000000-0000-0000-0000-000000000005', 'Durban Container Terminal', 'warehouse', 'Durban Harbour, KwaZulu-Natal', '{"lat": -29.8674, "lng": 31.0429}'::jsonb, 'Africa/Johannesburg', NOW(), NOW()),

-- Pretoria Sites
('20000000-0000-0000-0000-000000000007', :'tenant_id', '10000000-0000-0000-0000-000000000002', 'Rietvlei Water Treatment Works', 'factory', 'Centurion, Gauteng', '{"lat": -25.8853, "lng": 28.2683}'::jsonb, 'Africa/Johannesburg', NOW(), NOW())
ON CONFLICT (id) DO NOTHING;

-- ============================================================================
-- 3. DEVICE GROUPS (Regional and functional groupings)
-- ============================================================================

INSERT INTO device_groups (id, tenant_id, organization_id, name, description, membership_rule, attributes, created_at, updated_at) VALUES
('30000000-0000-0000-0000-000000000001', :'tenant_id', '10000000-0000-0000-0000-000000000001', 'Gauteng Power Monitoring', 'Energy meters across Gauteng province', '{}'::jsonb, '{}'::jsonb, NOW(), NOW()),
('30000000-0000-0000-0000-000000000002', :'tenant_id', '10000000-0000-0000-0000-000000000002', 'Water Quality Sensors', 'Water quality monitoring devices', '{}'::jsonb, '{}'::jsonb, NOW(), NOW()),
('30000000-0000-0000-0000-000000000003', :'tenant_id', '10000000-0000-0000-0000-000000000003', 'Cape Town Environmental', 'Environmental sensors in Western Cape', '{}'::jsonb, '{}'::jsonb, NOW(), NOW()),
('30000000-0000-0000-0000-000000000004', :'tenant_id', '10000000-0000-0000-0000-000000000005', 'Freight GPS Trackers', 'Vehicle tracking for freight logistics', '{}'::jsonb, '{}'::jsonb, NOW(), NOW()),
('30000000-0000-0000-0000-000000000005', :'tenant_id', '10000000-0000-0000-0000-000000000004', 'JHB Water Flow Meters', 'Water consumption meters in Johannesburg', '{}'::jsonb, '{}'::jsonb, NOW(), NOW())
ON CONFLICT (id) DO NOTHING;

-- ============================================================================
-- 4. ADDITIONAL DEVICES (South African locations)
-- ============================================================================

-- Get device type IDs first
DO $$
DECLARE
    water_meter_id UUID;
    energy_meter_id UUID;
    gps_tracker_id UUID;
    env_sensor_id UUID;
    temp_sensor_id UUID;
BEGIN
    -- Find existing device types
    SELECT id INTO water_meter_id FROM device_types WHERE name ILIKE '%water%' LIMIT 1;
    SELECT id INTO energy_meter_id FROM device_types WHERE name ILIKE '%energy%' OR name ILIKE '%power%' LIMIT 1;
    SELECT id INTO gps_tracker_id FROM device_types WHERE name ILIKE '%gps%' OR name ILIKE '%tracker%' LIMIT 1;
    SELECT id INTO env_sensor_id FROM device_types WHERE name ILIKE '%environment%' OR name ILIKE '%air%' LIMIT 1;
    SELECT id INTO temp_sensor_id FROM device_types WHERE name ILIKE '%temp%' LIMIT 1;

    -- Water meters in Johannesburg
    IF water_meter_id IS NOT NULL THEN
        INSERT INTO devices (id, tenant_id, organization_id, site_id, device_group_id, name, device_type_id, status, attributes, created_at, updated_at, last_seen) VALUES
        ('40000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000004', '20000000-0000-0000-0000-000000000002', '30000000-0000-0000-0000-000000000005', 'JHB-WM-001 Braamfontein', water_meter_id, 'online', '{"latitude": -26.1929, "longitude": 28.0336, "installation_date": "2024-01-15"}'::jsonb, NOW(), NOW(), NOW() - INTERVAL '5 minutes'),
        ('40000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000004', '20000000-0000-0000-0000-000000000002', '30000000-0000-0000-0000-000000000005', 'JHB-WM-002 Sandton', water_meter_id, 'online', '{"latitude": -26.1076, "longitude": 28.0567, "installation_date": "2024-02-20"}'::jsonb, NOW(), NOW(), NOW() - INTERVAL '3 minutes')
        ON CONFLICT (id) DO NOTHING;
    END IF;

    -- Energy meters in Gauteng
    IF energy_meter_id IS NOT NULL THEN
        INSERT INTO devices (id, tenant_id, organization_id, site_id, device_group_id, name, device_type_id, status, attributes, created_at, updated_at, last_seen) VALUES
        ('40000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', 'Lethabo-EM-001', energy_meter_id, 'online', '{"latitude": -26.7833, "longitude": 27.9167, "voltage": "132kV"}'::jsonb, NOW(), NOW(), NOW() - INTERVAL '2 minutes'),
        ('40000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', 'Lethabo-EM-002', energy_meter_id, 'online', '{"latitude": -26.7840, "longitude": 27.9180, "voltage": "132kV"}'::jsonb, NOW(), NOW(), NOW() - INTERVAL '4 minutes')
        ON CONFLICT (id) DO NOTHING;
    END IF;

    -- GPS trackers for logistics
    IF gps_tracker_id IS NOT NULL THEN
        INSERT INTO devices (id, tenant_id, organization_id, site_id, device_group_id, name, device_type_id, status, attributes, created_at, updated_at, last_seen) VALUES
        ('40000000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000005', '20000000-0000-0000-0000-000000000003', '30000000-0000-0000-0000-000000000004', 'Truck-GPS-001 JHB-DBN Route', gps_tracker_id, 'online', '{"latitude": -26.2708, "longitude": 28.0714, "vehicle_type": "freight_truck"}'::jsonb, NOW(), NOW(), NOW() - INTERVAL '1 minute'),
        ('40000000-0000-0000-0000-000000000006', '00000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000005', '20000000-0000-0000-0000-000000000006', '30000000-0000-0000-0000-000000000004', 'Truck-GPS-002 Durban Port', gps_tracker_id, 'online', '{"latitude": -29.8674, "longitude": 31.0429, "vehicle_type": "freight_truck"}'::jsonb, NOW(), NOW(), NOW() - INTERVAL '6 minutes')
        ON CONFLICT (id) DO NOTHING;
    END IF;

    -- Environmental sensors in Cape Town
    IF env_sensor_id IS NOT NULL THEN
        INSERT INTO devices (id, tenant_id, organization_id, site_id, device_group_id, name, device_type_id, status, attributes, created_at, updated_at, last_seen) VALUES
        ('40000000-0000-0000-0000-000000000007', '00000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000003', '20000000-0000-0000-0000-000000000004', '30000000-0000-0000-0000-000000000003', 'CPT-ENV-001 City Centre', env_sensor_id, 'online', '{"latitude": -33.9249, "longitude": 18.4241}'::jsonb, NOW(), NOW(), NOW() - INTERVAL '7 minutes'),
        ('40000000-0000-0000-0000-000000000008', '00000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000003', '20000000-0000-0000-0000-000000000005', '30000000-0000-0000-0000-000000000003', 'CPT-ENV-002 V&A Waterfront', env_sensor_id, 'online', '{"latitude": -33.9067, "longitude": 18.4233}'::jsonb, NOW(), NOW(), NOW() - INTERVAL '8 minutes')
        ON CONFLICT (id) DO NOTHING;
    END IF;

    -- Temperature sensors at water treatment
    IF temp_sensor_id IS NOT NULL THEN
        INSERT INTO devices (id, tenant_id, organization_id, site_id, device_group_id, name, device_type_id, status, attributes, created_at, updated_at, last_seen) VALUES
        ('40000000-0000-0000-0000-000000000009', '00000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000007', '30000000-0000-0000-0000-000000000002', 'Rietvlei-TEMP-001', temp_sensor_id, 'online', '{"latitude": -25.8853, "longitude": 28.2683, "zone": "inlet"}'::jsonb, NOW(), NOW(), NOW() - INTERVAL '3 minutes'),
        ('40000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000007', '30000000-0000-0000-0000-000000000002', 'Rietvlei-TEMP-002', temp_sensor_id, 'online', '{"latitude": -25.8860, "longitude": 28.2690, "zone": "outlet"}'::jsonb, NOW(), NOW(), NOW() - INTERVAL '2 minutes')
        ON CONFLICT (id) DO NOTHING;
    END IF;
END $$;

-- ============================================================================
-- 5. FRESH TELEMETRY DATA (Last 24 hours)
-- ============================================================================

-- Generate telemetry for water meters
INSERT INTO telemetry_hot (tenant_id, device_id, timestamp, temperature, pressure, payload)
SELECT
    '00000000-0000-0000-0000-000000000001'::uuid,
    device_id,
    NOW() - (random() * INTERVAL '24 hours'),
    20 + (random() * 15), -- 20-35°C
    300 + (random() * 100), -- 300-400 kPa
    json_build_object(
        'flow_rate', round((50 + random() * 150)::numeric, 2),
        'quality', 'good',
        'turbidity', round((random() * 5)::numeric, 2)
    )::jsonb
FROM (
    SELECT id as device_id FROM devices WHERE name LIKE 'JHB-WM-%'
    UNION ALL SELECT id FROM devices WHERE name LIKE 'Rietvlei-%'
) devices
CROSS JOIN generate_series(1, 20) -- 20 readings per device
ON CONFLICT DO NOTHING;

-- Generate telemetry for energy meters
INSERT INTO telemetry_hot (tenant_id, device_id, timestamp, temperature, payload)
SELECT
    '00000000-0000-0000-0000-000000000001'::uuid,
    device_id,
    NOW() - (random() * INTERVAL '24 hours'),
    35 + (random() * 15), -- 35-50°C (equipment temperature)
    json_build_object(
        'voltage', round((220 + random() * 10)::numeric, 1),
        'current', round((45 + random() * 15)::numeric, 1),
        'power', round((9500 + random() * 2000)::numeric, 0),
        'power_factor', round((0.85 + random() * 0.1)::numeric, 2),
        'frequency', 50
    )::jsonb
FROM (
    SELECT id as device_id FROM devices WHERE name LIKE 'Lethabo-EM-%'
) devices
CROSS JOIN generate_series(1, 20) -- 20 readings per device
ON CONFLICT DO NOTHING;

-- Generate telemetry for GPS trackers (moving vehicles)
INSERT INTO telemetry_hot (tenant_id, device_id, timestamp, payload)
SELECT
    '00000000-0000-0000-0000-000000000001'::uuid,
    device_id,
    NOW() - (s * INTERVAL '5 minutes'),
    json_build_object(
        'latitude', start_lat + (s * 0.01),
        'longitude', start_lng + (s * 0.01),
        'speed', round((60 + random() * 40)::numeric, 1),
        'heading', round((random() * 360)::numeric, 0),
        'ignition', true
    )::jsonb
FROM (
    SELECT id as device_id,
           (attributes->>'latitude')::float as start_lat,
           (attributes->>'longitude')::float as start_lng
    FROM devices
    WHERE name LIKE 'Truck-GPS-%'
) devices
CROSS JOIN generate_series(0, 15) s -- 15 GPS readings (tracking over 75 minutes)
ON CONFLICT DO NOTHING;

-- Generate telemetry for environmental sensors
INSERT INTO telemetry_hot (tenant_id, device_id, timestamp, temperature, humidity, pressure, payload)
SELECT
    '00000000-0000-0000-0000-000000000001'::uuid,
    device_id,
    NOW() - (random() * INTERVAL '24 hours'),
    15 + (random() * 15), -- 15-30°C (Cape Town climate)
    40 + (random() * 40), -- 40-80% humidity
    1010 + (random() * 20), -- 1010-1030 hPa
    json_build_object(
        'pm25', round((random() * 50)::numeric, 1),
        'pm10', round((random() * 100)::numeric, 1),
        'air_quality_index', round((random() * 150)::numeric, 0)
    )::jsonb
FROM (
    SELECT id as device_id FROM devices WHERE name LIKE 'CPT-ENV-%'
) devices
CROSS JOIN generate_series(1, 20) -- 20 readings per device
ON CONFLICT DO NOTHING;

-- ============================================================================
-- SUMMARY
-- ============================================================================
\echo '✅ South African test data seeded successfully!'
\echo ''
\echo 'Summary:'
SELECT 'Organizations' as entity, COUNT(*) as count FROM organizations WHERE tenant_id = '00000000-0000-0000-0000-000000000001'::uuid
UNION ALL SELECT 'Sites', COUNT(*) FROM sites WHERE tenant_id = '00000000-0000-0000-0000-000000000001'::uuid
UNION ALL SELECT 'Device Groups', COUNT(*) FROM device_groups WHERE tenant_id = '00000000-0000-0000-0000-000000000001'::uuid
UNION ALL SELECT 'Devices', COUNT(*) FROM devices WHERE tenant_id = '00000000-0000-0000-0000-000000000001'::uuid
UNION ALL SELECT 'Telemetry Records', COUNT(*) FROM telemetry_hot WHERE tenant_id = '00000000-0000-0000-0000-000000000001'::uuid;
