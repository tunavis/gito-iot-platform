BEGIN;
SET LOCAL app.current_tenant_id = '00000000-0000-0000-0000-000000000001';
SET LOCAL app.current_user_id   = '00000000-0000-0000-0000-000000000010';

-- ============================================================
-- DEVICE TYPES (fixed UUIDs for repeatable seeding)
-- ============================================================
INSERT INTO device_types (id, tenant_id, name, description, category, icon, color, data_model, capabilities, connectivity, metadata)
VALUES
  ('d1000000-0000-0000-0000-000000000001',
   '00000000-0000-0000-0000-000000000001',
   'Refrigeration Sensor',
   'Supermarket refrigeration monitoring — temperature, door status, defrost cycle.',
   'sensor', 'thermometer', '#3b82f6',
   '[
     {"name":"temperature",        "type":"float",   "unit":"C",   "min":-30, "max":10,  "description":"Cabinet temperature"},
     {"name":"setpoint",           "type":"float",   "unit":"C",   "min":-25, "max":5,   "description":"Temperature setpoint"},
     {"name":"door_open",          "type":"boolean",                                       "description":"Door open status"},
     {"name":"defrost_active",     "type":"boolean",                                       "description":"Defrost cycle active"},
     {"name":"compressor_running", "type":"boolean",                                       "description":"Compressor running"},
     {"name":"alarm_active",       "type":"boolean",                                       "description":"Alarm active"}
   ]',
   '["telemetry","alerts"]',
   '{"protocol":"mqtt"}',
   '{}'),

  ('d1000000-0000-0000-0000-000000000002',
   '00000000-0000-0000-0000-000000000001',
   'Energy Meter',
   '3-phase energy meter — kW demand, kWh consumption, voltage, current, power factor.',
   'meter', 'zap', '#f59e0b',
   '[
     {"name":"active_power_kw", "type":"float", "unit":"kW",  "min":0,   "max":10000, "description":"Active power demand"},
     {"name":"energy_kwh",      "type":"float", "unit":"kWh", "min":0,                "description":"Cumulative energy"},
     {"name":"voltage_l1",      "type":"float", "unit":"V",   "min":180, "max":260,   "description":"Voltage phase L1"},
     {"name":"voltage_l2",      "type":"float", "unit":"V",   "min":180, "max":260,   "description":"Voltage phase L2"},
     {"name":"voltage_l3",      "type":"float", "unit":"V",   "min":180, "max":260,   "description":"Voltage phase L3"},
     {"name":"current_l1",      "type":"float", "unit":"A",   "min":0,   "max":1000,  "description":"Current phase L1"},
     {"name":"current_l2",      "type":"float", "unit":"A",   "min":0,   "max":1000,  "description":"Current phase L2"},
     {"name":"current_l3",      "type":"float", "unit":"A",   "min":0,   "max":1000,  "description":"Current phase L3"},
     {"name":"power_factor",    "type":"float", "unit":"",    "min":0,   "max":1,     "description":"Power factor"},
     {"name":"frequency_hz",    "type":"float", "unit":"Hz",  "min":49,  "max":51,    "description":"Grid frequency"}
   ]',
   '["telemetry","alerts"]',
   '{"protocol":"modbus"}',
   '{}'),

  ('d1000000-0000-0000-0000-000000000003',
   '00000000-0000-0000-0000-000000000001',
   'Temperature Sensor',
   'Industrial temperature sensor — process temperature, high-temp process environments.',
   'sensor', 'thermometer', '#ef4444',
   '[
     {"name":"temperature",      "type":"float",   "unit":"C",     "min":-50, "max":1200, "description":"Process temperature"},
     {"name":"temperature_rate", "type":"float",   "unit":"C/min",                         "description":"Rate of change"},
     {"name":"sensor_ok",        "type":"boolean",                                          "description":"Sensor health status"}
   ]',
   '["telemetry","alerts"]',
   '{"protocol":"mqtt"}',
   '{}'),

  ('d1000000-0000-0000-0000-000000000004',
   '00000000-0000-0000-0000-000000000001',
   'Flow Meter',
   'Industrial flow meter — volumetric flow rate, cumulative volume, process fluid.',
   'meter', 'droplets', '#06b6d4',
   '[
     {"name":"flow_rate",         "type":"float", "unit":"m3/hr", "min":0, "max":5000, "description":"Volumetric flow rate"},
     {"name":"cumulative_volume", "type":"float", "unit":"m3",    "min":0,              "description":"Cumulative volume"},
     {"name":"temperature",       "type":"float", "unit":"C",     "min":0, "max":300,  "description":"Process temperature"},
     {"name":"pressure",          "type":"float", "unit":"bar",   "min":0, "max":150,  "description":"Process pressure"},
     {"name":"flow_ok",           "type":"boolean",                                     "description":"Flow sensor health"}
   ]',
   '["telemetry","alerts"]',
   '{"protocol":"modbus"}',
   '{}'),

  ('d1000000-0000-0000-0000-000000000005',
   '00000000-0000-0000-0000-000000000001',
   'Pressure Sensor',
   'Industrial pressure sensor — process pressure, high-pressure environments.',
   'sensor', 'gauge', '#8b5cf6',
   '[
     {"name":"pressure",            "type":"float",   "unit":"bar",     "min":0, "max":200, "description":"Process pressure"},
     {"name":"pressure_rate",       "type":"float",   "unit":"bar/min",                      "description":"Rate of change"},
     {"name":"sensor_ok",           "type":"boolean",                                         "description":"Sensor health"},
     {"name":"high_pressure_alarm", "type":"boolean",                                         "description":"High pressure alarm"}
   ]',
   '["telemetry","alerts"]',
   '{"protocol":"mqtt"}',
   '{}'),

  ('d1000000-0000-0000-0000-000000000006',
   '00000000-0000-0000-0000-000000000001',
   'HVAC Sensor',
   'Commercial HVAC monitoring — chiller, AHU, temperature, humidity, energy performance.',
   'sensor', 'wind', '#10b981',
   '[
     {"name":"supply_temp",     "type":"float",   "unit":"C",  "min":5,  "max":30,  "description":"Supply air temperature"},
     {"name":"return_temp",     "type":"float",   "unit":"C",  "min":10, "max":35,  "description":"Return air temperature"},
     {"name":"setpoint",        "type":"float",   "unit":"C",  "min":16, "max":26,  "description":"Temperature setpoint"},
     {"name":"humidity_pct",    "type":"float",   "unit":"%",  "min":20, "max":80,  "description":"Relative humidity"},
     {"name":"active_power_kw", "type":"float",   "unit":"kW", "min":0,  "max":500, "description":"Power consumption"},
     {"name":"cop",             "type":"float",   "unit":"",   "min":0,  "max":8,   "description":"Coefficient of performance"},
     {"name":"running",         "type":"boolean",                                    "description":"Unit running"},
     {"name":"fault",           "type":"boolean",                                    "description":"Fault active"}
   ]',
   '["telemetry","alerts"]',
   '{"protocol":"mqtt"}',
   '{}')
ON CONFLICT (id) DO NOTHING;

-- ============================================================
-- ORGANISATIONS
-- ============================================================
INSERT INTO organizations (id, tenant_id, name, slug, description, billing_contact, status, attributes) VALUES
  ('a1000000-0000-0000-0000-000000000001',
   '00000000-0000-0000-0000-000000000001',
   'Shoprite Holdings', 'shoprite',
   'South Africa largest food retailer - energy and refrigeration monitoring across 600+ stores.',
   'facilities@shoprite.co.za', 'active',
   '{"industry":"retail","hq":"Brackenfell, Cape Town","employees":150000}'),

  ('a2000000-0000-0000-0000-000000000001',
   '00000000-0000-0000-0000-000000000001',
   'Sasol Limited', 'sasol',
   'Integrated energy and chemicals company - gas, temperature and flow monitoring at production sites.',
   'control@sasol.com', 'active',
   '{"industry":"energy","hq":"Sandton, Johannesburg","employees":30000}'),

  ('a3000000-0000-0000-0000-000000000001',
   '00000000-0000-0000-0000-000000000001',
   'Growthpoint Properties', 'growthpoint',
   'South Africa largest REIT - HVAC, access control and energy monitoring across commercial portfolio.',
   'bms@growthpoint.co.za', 'active',
   '{"industry":"property","hq":"Johannesburg","employees":2200}')
ON CONFLICT DO NOTHING;

-- ============================================================
-- SITES — Shoprite
-- ============================================================
INSERT INTO sites (id, tenant_id, organization_id, parent_site_id, name, site_type, address, coordinates, timezone, attributes) VALUES
  ('b1000000-0000-0000-0000-000000000001',
   '00000000-0000-0000-0000-000000000001',
   'a1000000-0000-0000-0000-000000000001',
   NULL,
   'Shoprite Head Office', 'headquarters',
   'Cnr William Dabs & Old Paarl Roads, Brackenfell, 7560',
   '{"lat":-33.8611,"lng":18.7156}', 'Africa/Johannesburg',
   '{"floor_area_m2":25000,"floors":5}'),

  ('b1000000-0000-0000-0000-000000000002',
   '00000000-0000-0000-0000-000000000001',
   'a1000000-0000-0000-0000-000000000001',
   'b1000000-0000-0000-0000-000000000001',
   'Shoprite Sandton City', 'retail_store',
   'Sandton City Mall, 83 Rivonia Rd, Sandton, 2196',
   '{"lat":-26.1074,"lng":28.0562}', 'Africa/Johannesburg',
   '{"floor_area_m2":3200,"fridges":48,"checkouts":22}'),

  ('b1000000-0000-0000-0000-000000000003',
   '00000000-0000-0000-0000-000000000001',
   'a1000000-0000-0000-0000-000000000001',
   'b1000000-0000-0000-0000-000000000001',
   'Shoprite V&A Waterfront', 'retail_store',
   'V&A Waterfront, Breakwater Blvd, Cape Town, 8001',
   '{"lat":-33.9029,"lng":18.4183}', 'Africa/Johannesburg',
   '{"floor_area_m2":2800,"fridges":36,"checkouts":18}'),

  ('b1000000-0000-0000-0000-000000000004',
   '00000000-0000-0000-0000-000000000001',
   'a1000000-0000-0000-0000-000000000001',
   'b1000000-0000-0000-0000-000000000001',
   'Shoprite Menlyn Park', 'retail_store',
   'Menlyn Park Shopping Centre, Atterbury Rd, Pretoria, 0181',
   '{"lat":-25.7832,"lng":28.2772}', 'Africa/Johannesburg',
   '{"floor_area_m2":2600,"fridges":40,"checkouts":20}')
ON CONFLICT DO NOTHING;

-- ============================================================
-- SITES — Sasol
-- ============================================================
INSERT INTO sites (id, tenant_id, organization_id, parent_site_id, name, site_type, address, coordinates, timezone, attributes) VALUES
  ('b2000000-0000-0000-0000-000000000001',
   '00000000-0000-0000-0000-000000000001',
   'a2000000-0000-0000-0000-000000000001',
   NULL,
   'Sasol Secunda Synfuels', 'production_plant',
   'Secunda, Mpumalanga, 2302',
   '{"lat":-26.5202,"lng":29.1783}', 'Africa/Johannesburg',
   '{"production_capacity_bpd":150000,"area_ha":1700}'),

  ('b2000000-0000-0000-0000-000000000002',
   '00000000-0000-0000-0000-000000000001',
   'a2000000-0000-0000-0000-000000000001',
   'b2000000-0000-0000-0000-000000000001',
   'Sasol Natref Sasolburg', 'refinery',
   'Sasolburg, Free State, 1947',
   '{"lat":-26.8178,"lng":27.8270}', 'Africa/Johannesburg',
   '{"production_capacity_bpd":108000}'),

  ('b2000000-0000-0000-0000-000000000003',
   '00000000-0000-0000-0000-000000000001',
   'a2000000-0000-0000-0000-000000000001',
   'b2000000-0000-0000-0000-000000000001',
   'Sasol Secunda Chemicals', 'chemical_plant',
   'Secunda, Mpumalanga, 2302',
   '{"lat":-26.5150,"lng":29.1900}', 'Africa/Johannesburg',
   '{"products":["polymers","solvents","surfactants"]}')
ON CONFLICT DO NOTHING;

-- ============================================================
-- SITES — Growthpoint
-- ============================================================
INSERT INTO sites (id, tenant_id, organization_id, parent_site_id, name, site_type, address, coordinates, timezone, attributes) VALUES
  ('b3000000-0000-0000-0000-000000000001',
   '00000000-0000-0000-0000-000000000001',
   'a3000000-0000-0000-0000-000000000001',
   NULL,
   'Growthpoint Head Office', 'headquarters',
   'The Place, 1 Sandton Dr, Sandton, 2196',
   '{"lat":-26.1069,"lng":28.0582}', 'Africa/Johannesburg',
   '{"floor_area_m2":8000,"floors":8,"green_star_rating":5}'),

  ('b3000000-0000-0000-0000-000000000002',
   '00000000-0000-0000-0000-000000000001',
   'a3000000-0000-0000-0000-000000000001',
   'b3000000-0000-0000-0000-000000000001',
   'Longkloof Studios Cape Town', 'commercial_office',
   '4 Buitenkant St, Gardens, Cape Town, 8001',
   '{"lat":-33.9327,"lng":18.4155}', 'Africa/Johannesburg',
   '{"floor_area_m2":12000,"tenants":24,"green_star_rating":4}'),

  ('b3000000-0000-0000-0000-000000000003',
   '00000000-0000-0000-0000-000000000001',
   'a3000000-0000-0000-0000-000000000001',
   'b3000000-0000-0000-0000-000000000001',
   'Wonderpark Shopping Centre', 'shopping_centre',
   'Lavender Rd, Karenpark, Pretoria, 0118',
   '{"lat":-25.6327,"lng":28.0980}', 'Africa/Johannesburg',
   '{"floor_area_m2":65000,"tenants":180,"parking_bays":4000}')
ON CONFLICT DO NOTHING;

-- ============================================================
-- DEVICES — Shoprite stores
-- ============================================================
INSERT INTO devices (id, tenant_id, organization_id, site_id, name, device_type, device_type_id, status, attributes) VALUES
  ('c1000000-0000-0000-0000-000000000001',
   '00000000-0000-0000-0000-000000000001',
   'a1000000-0000-0000-0000-000000000001',
   'b1000000-0000-0000-0000-000000000002',
   'Fridge Bank A - Sandton', 'refrigeration_sensor',
   'd1000000-0000-0000-0000-000000000001', 'offline',
   '{"location":"Aisle 3","fridge_count":12,"model":"Carrier Supermarket"}'),

  ('c1000000-0000-0000-0000-000000000002',
   '00000000-0000-0000-0000-000000000001',
   'a1000000-0000-0000-0000-000000000001',
   'b1000000-0000-0000-0000-000000000002',
   'Energy Meter - Sandton Main', 'energy_meter',
   'd1000000-0000-0000-0000-000000000002', 'offline',
   '{"panel":"MDB-01","phase":"3-phase","ct_ratio":"200/5"}'),

  ('c1000000-0000-0000-0000-000000000003',
   '00000000-0000-0000-0000-000000000001',
   'a1000000-0000-0000-0000-000000000001',
   'b1000000-0000-0000-0000-000000000003',
   'Fridge Bank A - Waterfront', 'refrigeration_sensor',
   'd1000000-0000-0000-0000-000000000001', 'offline',
   '{"location":"Aisle 2","fridge_count":10}'),

  ('c1000000-0000-0000-0000-000000000004',
   '00000000-0000-0000-0000-000000000001',
   'a1000000-0000-0000-0000-000000000001',
   'b1000000-0000-0000-0000-000000000003',
   'Energy Meter - Waterfront Main', 'energy_meter',
   'd1000000-0000-0000-0000-000000000002', 'offline',
   '{"panel":"MDB-01","phase":"3-phase"}'),

  ('c1000000-0000-0000-0000-000000000005',
   '00000000-0000-0000-0000-000000000001',
   'a1000000-0000-0000-0000-000000000001',
   'b1000000-0000-0000-0000-000000000004',
   'Fridge Bank A - Menlyn', 'refrigeration_sensor',
   'd1000000-0000-0000-0000-000000000001', 'offline',
   '{"location":"Aisle 1","fridge_count":14}'),

  ('c1000000-0000-0000-0000-000000000006',
   '00000000-0000-0000-0000-000000000001',
   'a1000000-0000-0000-0000-000000000001',
   'b1000000-0000-0000-0000-000000000004',
   'Energy Meter - Menlyn Main', 'energy_meter',
   'd1000000-0000-0000-0000-000000000002', 'offline',
   '{"panel":"MDB-01","phase":"3-phase"}')
ON CONFLICT DO NOTHING;

-- ============================================================
-- DEVICES — Sasol
-- ============================================================
INSERT INTO devices (id, tenant_id, organization_id, site_id, name, device_type, device_type_id, status, attributes) VALUES
  ('c2000000-0000-0000-0000-000000000001',
   '00000000-0000-0000-0000-000000000001',
   'a2000000-0000-0000-0000-000000000001',
   'b2000000-0000-0000-0000-000000000001',
   'Syngas Reactor Temp - Unit 1', 'temperature_sensor',
   'd1000000-0000-0000-0000-000000000003', 'offline',
   '{"process_unit":"SRU-01","medium":"syngas","material":"Inconel 625"}'),

  ('c2000000-0000-0000-0000-000000000002',
   '00000000-0000-0000-0000-000000000001',
   'a2000000-0000-0000-0000-000000000001',
   'b2000000-0000-0000-0000-000000000001',
   'Steam Flow Meter - HP Header', 'flow_meter',
   'd1000000-0000-0000-0000-000000000004', 'offline',
   '{"line":"HP-STEAM-01","pressure_bar":80,"pipe_dn":300}'),

  ('c2000000-0000-0000-0000-000000000003',
   '00000000-0000-0000-0000-000000000001',
   'a2000000-0000-0000-0000-000000000001',
   'b2000000-0000-0000-0000-000000000002',
   'Crude Feed Pressure - Natref', 'pressure_sensor',
   'd1000000-0000-0000-0000-000000000005', 'offline',
   '{"unit":"bar","range":"0-60","process":"crude_distillation"}'),

  ('c2000000-0000-0000-0000-000000000004',
   '00000000-0000-0000-0000-000000000001',
   'a2000000-0000-0000-0000-000000000001',
   'b2000000-0000-0000-0000-000000000003',
   'Polymer Reactor Temp - Chemicals', 'temperature_sensor',
   'd1000000-0000-0000-0000-000000000003', 'offline',
   '{"process_unit":"PR-02","product":"polyethylene"}')
ON CONFLICT DO NOTHING;

-- ============================================================
-- DEVICES — Growthpoint
-- ============================================================
INSERT INTO devices (id, tenant_id, organization_id, site_id, name, device_type, device_type_id, status, attributes) VALUES
  ('c3000000-0000-0000-0000-000000000001',
   '00000000-0000-0000-0000-000000000001',
   'a3000000-0000-0000-0000-000000000001',
   'b3000000-0000-0000-0000-000000000002',
   'HVAC Chiller - Longkloof L1', 'hvac_sensor',
   'd1000000-0000-0000-0000-000000000006', 'offline',
   '{"unit":"chiller-01","capacity_kw":350,"refrigerant":"R134a"}'),

  ('c3000000-0000-0000-0000-000000000002',
   '00000000-0000-0000-0000-000000000001',
   'a3000000-0000-0000-0000-000000000001',
   'b3000000-0000-0000-0000-000000000002',
   'Energy Meter - Longkloof MDB', 'energy_meter',
   'd1000000-0000-0000-0000-000000000002', 'offline',
   '{"panel":"MDB-B2","phase":"3-phase","tariff":"TOU"}'),

  ('c3000000-0000-0000-0000-000000000003',
   '00000000-0000-0000-0000-000000000001',
   'a3000000-0000-0000-0000-000000000001',
   'b3000000-0000-0000-0000-000000000003',
   'Wonderpark Energy Main Incomer', 'energy_meter',
   'd1000000-0000-0000-0000-000000000002', 'offline',
   '{"panel":"MAIN-INCOMER","phase":"3-phase","capacity_kva":5000}'),

  ('c3000000-0000-0000-0000-000000000004',
   '00000000-0000-0000-0000-000000000001',
   'a3000000-0000-0000-0000-000000000001',
   'b3000000-0000-0000-0000-000000000003',
   'HVAC AHU - Wonderpark Food Court', 'hvac_sensor',
   'd1000000-0000-0000-0000-000000000006', 'offline',
   '{"unit":"AHU-FC-01","area":"food_court","capacity_kw":120}')
ON CONFLICT DO NOTHING;

-- Update device_count on all seeded device types
UPDATE device_types dt
SET device_count = (
  SELECT count(*) FROM devices d
  WHERE d.device_type_id = dt.id
)
WHERE dt.tenant_id = '00000000-0000-0000-0000-000000000001'
  AND dt.id IN (
    'd1000000-0000-0000-0000-000000000001',
    'd1000000-0000-0000-0000-000000000002',
    'd1000000-0000-0000-0000-000000000003',
    'd1000000-0000-0000-0000-000000000004',
    'd1000000-0000-0000-0000-000000000005',
    'd1000000-0000-0000-0000-000000000006'
  );

COMMIT;
