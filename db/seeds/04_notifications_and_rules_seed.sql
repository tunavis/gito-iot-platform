-- ============================================================================
-- GITO IOT PLATFORM - Notifications & Composite Rules Seed Data
-- ============================================================================
-- Creates sample notification channels, rules, and composite alert rules
-- for testing and demonstration purposes
-- ============================================================================

BEGIN;

-- ============================================================================
-- SECTION 1: CREATE SAMPLE NOTIFICATION CHANNELS
-- ============================================================================

-- Get first available tenant and user (fallback logic for various scenarios)
WITH tenant_user AS (
  SELECT 
    COALESCE(
      (SELECT t.id FROM tenants t LIMIT 1),
      NULL
    ) as tenant_id,
    COALESCE(
      (SELECT u.id FROM users u LIMIT 1),
      NULL
    ) as user_id
)
INSERT INTO notification_channels (id, tenant_id, user_id, channel_type, config, enabled, verified)
SELECT
  gen_random_uuid(),
  tu.tenant_id,
  tu.user_id,
  'email',
  '{"email": "admin@gito-iot.com"}'::jsonb,
  true,
  true
FROM tenant_user tu
WHERE tu.tenant_id IS NOT NULL 
  AND tu.user_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM notification_channels nc 
    WHERE nc.channel_type = 'email' 
    AND nc.config->>'email' = 'admin@gito-iot.com'
  );

-- Webhook channel
WITH tenant_user AS (
  SELECT 
    COALESCE((SELECT t.id FROM tenants t LIMIT 1), NULL) as tenant_id,
    COALESCE((SELECT u.id FROM users u LIMIT 1), NULL) as user_id
)
INSERT INTO notification_channels (id, tenant_id, user_id, channel_type, config, enabled, verified)
SELECT
  gen_random_uuid(),
  tu.tenant_id,
  tu.user_id,
  'webhook',
  '{"url": "https://example.com/webhook", "auth_type": "bearer", "secret": "webhook-secret-key"}'::jsonb,
  true,
  true
FROM tenant_user tu
WHERE tu.tenant_id IS NOT NULL 
  AND tu.user_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM notification_channels nc 
    WHERE nc.channel_type = 'webhook' 
    AND nc.config->>'url' = 'https://example.com/webhook'
  );

-- Operations email channel
WITH tenant_user AS (
  SELECT 
    COALESCE((SELECT t.id FROM tenants t LIMIT 1), NULL) as tenant_id,
    COALESCE((SELECT u.id FROM users u LIMIT 1), NULL) as user_id
)
INSERT INTO notification_channels (id, tenant_id, user_id, channel_type, config, enabled, verified)
SELECT
  gen_random_uuid(),
  tu.tenant_id,
  tu.user_id,
  'email',
  '{"email": "operations@gito-iot.com"}'::jsonb,
  true,
  true
FROM tenant_user tu
WHERE tu.tenant_id IS NOT NULL 
  AND tu.user_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM notification_channels nc 
    WHERE nc.channel_type = 'email' 
    AND nc.config->>'email' = 'operations@gito-iot.com'
  );

-- SMS channel
WITH tenant_user AS (
  SELECT 
    COALESCE((SELECT t.id FROM tenants t LIMIT 1), NULL) as tenant_id,
    COALESCE((SELECT u.id FROM users u LIMIT 1), NULL) as user_id
)
INSERT INTO notification_channels (id, tenant_id, user_id, channel_type, config, enabled, verified)
SELECT
  gen_random_uuid(),
  tu.tenant_id,
  tu.user_id,
  'sms',
  '{"phone": "+1234567890"}'::jsonb,
  true,
  true
FROM tenant_user tu
WHERE tu.tenant_id IS NOT NULL 
  AND tu.user_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM notification_channels nc 
    WHERE nc.channel_type = 'sms' 
    AND nc.config->>'phone' = '+1234567890'
  );

-- ============================================================================
-- SECTION 2: CREATE COMPOSITE ALERT RULES
-- ============================================================================

-- High Temperature & High Humidity Alert (AND logic)
INSERT INTO alert_rules (
  id, tenant_id, name, device_id, metric, operator, threshold, 
  severity, enabled, rule_type, created_at, updated_at
)
SELECT
  gen_random_uuid(),
  t.id,
  'Temperature and Humidity High Alarm',
  NULL,
  'composite',
  'AND',
  NULL,
  'critical',
  true,
  'composite',
  now(),
  now()
FROM tenants t
WHERE NOT EXISTS (
  SELECT 1 FROM alert_rules ar 
  WHERE ar.tenant_id = t.id
  AND ar.name = 'Temperature and Humidity High Alarm' 
  AND ar.rule_type = 'composite'
)
LIMIT 1;

-- High Battery Drain Alert
INSERT INTO alert_rules (
  id, tenant_id, name, device_id, metric, operator, threshold, 
  severity, enabled, rule_type, created_at, updated_at
)
SELECT
  gen_random_uuid(),
  t.id,
  'Rapid Battery Drain Alert',
  NULL,
  'battery_level',
  '<',
  20,
  'warning',
  true,
  'composite',
  now(),
  now()
FROM tenants t
WHERE NOT EXISTS (
  SELECT 1 FROM alert_rules ar 
  WHERE ar.tenant_id = t.id
  AND ar.name = 'Rapid Battery Drain Alert'
)
LIMIT 1;

-- Device Offline Persistence Alert
INSERT INTO alert_rules (
  id, tenant_id, name, device_id, metric, operator, threshold, 
  severity, enabled, rule_type, created_at, updated_at
)
SELECT
  gen_random_uuid(),
  t.id,
  'Device Offline for Extended Period',
  NULL,
  'last_seen',
  '<',
  3600,
  'critical',
  true,
  'composite',
  now(),
  now()
FROM tenants t
WHERE NOT EXISTS (
  SELECT 1 FROM alert_rules ar 
  WHERE ar.tenant_id = t.id
  AND ar.name = 'Device Offline for Extended Period'
)
LIMIT 1;

-- Extreme Temperature Alert
INSERT INTO alert_rules (
  id, tenant_id, name, device_id, metric, operator, threshold, 
  severity, enabled, rule_type, created_at, updated_at
)
SELECT
  gen_random_uuid(),
  t.id,
  'Extreme Temperature Detected',
  NULL,
  'temperature',
  'OR',
  50,
  'critical',
  true,
  'composite',
  now(),
  now()
FROM tenants t
WHERE NOT EXISTS (
  SELECT 1 FROM alert_rules ar 
  WHERE ar.tenant_id = t.id
  AND ar.name = 'Extreme Temperature Detected'
)
LIMIT 1;

-- Environmental Comfort Zone Alert (AND logic - temp and humidity ranges)
INSERT INTO alert_rules (
  id, tenant_id, name, device_id, metric, operator, threshold, 
  severity, enabled, rule_type, created_at, updated_at
)
SELECT
  gen_random_uuid(),
  t.id,
  'Uncomfortable Environmental Conditions',
  NULL,
  'composite',
  'AND',
  NULL,
  'warning',
  true,
  'composite',
  now(),
  now()
FROM tenants t
WHERE NOT EXISTS (
  SELECT 1 FROM alert_rules ar 
  WHERE ar.tenant_id = t.id
  AND ar.name = 'Uncomfortable Environmental Conditions'
)
LIMIT 1;

-- Low Signal Strength Alert
INSERT INTO alert_rules (
  id, tenant_id, name, device_id, metric, operator, threshold, 
  severity, enabled, rule_type, created_at, updated_at
)
SELECT
  gen_random_uuid(),
  t.id,
  'Weak Signal Strength Warning',
  NULL,
  'signal_strength',
  '<',
  -100,
  'warning',
  true,
  'composite',
  now(),
  now()
FROM tenants t
WHERE NOT EXISTS (
  SELECT 1 FROM alert_rules ar 
  WHERE ar.tenant_id = t.id
  AND ar.name = 'Weak Signal Strength Warning'
)
LIMIT 1;

-- ============================================================================
-- SECTION 3: LINK NOTIFICATION CHANNELS TO ALERT RULES
-- ============================================================================

-- Link email notifications to critical rules
INSERT INTO notification_rules (id, tenant_id, alert_rule_id, channel_id, enabled)
SELECT
  gen_random_uuid(),
  ar.tenant_id,
  ar.id,
  nc.id,
  true
FROM alert_rules ar
JOIN notification_channels nc ON ar.tenant_id = nc.tenant_id
WHERE ar.severity = 'critical'
  AND nc.channel_type = 'email'
  AND nc.config->>'email' = 'admin@gito-iot.com'
  AND NOT EXISTS (
    SELECT 1 FROM notification_rules nr 
    WHERE nr.alert_rule_id = ar.id 
    AND nr.channel_id = nc.id
  );

-- Link operations email to warning rules
INSERT INTO notification_rules (id, tenant_id, alert_rule_id, channel_id, enabled)
SELECT
  gen_random_uuid(),
  ar.tenant_id,
  ar.id,
  nc.id,
  true
FROM alert_rules ar
JOIN notification_channels nc ON ar.tenant_id = nc.tenant_id
WHERE ar.severity = 'warning'
  AND nc.channel_type = 'email'
  AND nc.config->>'email' = 'operations@gito-iot.com'
  AND NOT EXISTS (
    SELECT 1 FROM notification_rules nr 
    WHERE nr.alert_rule_id = ar.id 
    AND nr.channel_id = nc.id
  );

-- Link webhook to all critical alerts
INSERT INTO notification_rules (id, tenant_id, alert_rule_id, channel_id, enabled)
SELECT
  gen_random_uuid(),
  ar.tenant_id,
  ar.id,
  nc.id,
  true
FROM alert_rules ar
JOIN notification_channels nc ON ar.tenant_id = nc.tenant_id
WHERE ar.severity = 'critical'
  AND nc.channel_type = 'webhook'
  AND NOT EXISTS (
    SELECT 1 FROM notification_rules nr 
    WHERE nr.alert_rule_id = ar.id 
    AND nr.channel_id = nc.id
  );

-- ============================================================================
-- SECTION 4: CREATE NOTIFICATION TEMPLATES
-- ============================================================================

-- High Temperature Alert Email
INSERT INTO notification_templates (
  id, tenant_id, channel_type, alert_type, name, subject, body, enabled
)
SELECT
  gen_random_uuid(),
  t.id,
  'email',
  'temperature_alarm',
  'High Temperature Alert Email',
  'Temperature Alert: {{device_name}} - {{metric_value}}°C',
  E'Device: {{device_name}}\nLocation: {{site_name}}\nTemperature: {{metric_value}}°C\nThreshold: {{threshold}}°C\nTime: {{alert_time}}\n\nPlease investigate immediately.',
  true
FROM tenants t
WHERE NOT EXISTS (
  SELECT 1 FROM notification_templates nt 
  WHERE nt.tenant_id = t.id
  AND nt.channel_type = 'email' 
  AND nt.alert_type = 'temperature_alarm'
)
LIMIT 1;

-- Device Offline Alert Email
INSERT INTO notification_templates (
  id, tenant_id, channel_type, alert_type, name, subject, body, enabled
)
SELECT
  gen_random_uuid(),
  t.id,
  'email',
  'device_offline',
  'Device Offline Alert Email',
  'Device Offline: {{device_name}}',
  E'Device: {{device_name}}\nLocation: {{site_name}}\nLast Seen: {{last_seen}}\n\nDevice has not reported any data. Check connectivity.',
  true
FROM tenants t
WHERE NOT EXISTS (
  SELECT 1 FROM notification_templates nt 
  WHERE nt.tenant_id = t.id
  AND nt.channel_type = 'email' 
  AND nt.alert_type = 'device_offline'
)
LIMIT 1;

-- Low Battery Alert Email
INSERT INTO notification_templates (
  id, tenant_id, channel_type, alert_type, name, subject, body, enabled
)
SELECT
  gen_random_uuid(),
  t.id,
  'email',
  'battery_alert',
  'Low Battery Alert Email',
  'Low Battery Warning: {{device_name}} - {{metric_value}}%',
  E'Device: {{device_name}}\nLocation: {{site_name}}\nBattery Level: {{metric_value}}%\nLast Updated: {{alert_time}}\n\nPrepare for device replacement or battery swap soon.',
  true
FROM tenants t
WHERE NOT EXISTS (
  SELECT 1 FROM notification_templates nt 
  WHERE nt.tenant_id = t.id
  AND nt.channel_type = 'email' 
  AND nt.alert_type = 'battery_alert'
)
LIMIT 1;

-- Composite Alert Generic Template
INSERT INTO notification_templates (
  id, tenant_id, channel_type, alert_type, name, subject, body, enabled
)
SELECT
  gen_random_uuid(),
  t.id,
  'email',
  'composite_alert',
  'Composite Alert Email',
  'Multi-Condition Alert: {{alert_name}}',
  E'Alert Rule: {{alert_name}}\nDevice: {{device_name}}\nSeverity: {{severity}}\nConditions Matched: {{conditions_met}}\n\nTime: {{alert_time}}\n\nReview the situation and take necessary action.',
  true
FROM tenants t
WHERE NOT EXISTS (
  SELECT 1 FROM notification_templates nt 
  WHERE nt.tenant_id = t.id
  AND nt.channel_type = 'email' 
  AND nt.alert_type = 'composite_alert'
)
LIMIT 1;

-- ============================================================================
-- SECTION 5: UPDATE USER NOTIFICATION PREFERENCES
-- ============================================================================

UPDATE users u
SET notification_preferences = jsonb_set(
  COALESCE(u.notification_preferences, '{}'::jsonb),
  '{quiet_hours_enabled,quiet_hours_start,quiet_hours_end,timezone,critical_severity_immediate,warning_severity_digest}'::text[],
  jsonb_build_object(
    'quiet_hours_enabled', true,
    'quiet_hours_start', '22:00',
    'quiet_hours_end', '08:00',
    'timezone', 'UTC',
    'critical_severity_immediate', true,
    'warning_severity_digest', true
  )
)
WHERE u.id = (SELECT id FROM users LIMIT 1);

-- ============================================================================
-- FINAL LOGGING
-- ============================================================================

DO $$
DECLARE
  channel_count INTEGER;
  rule_count INTEGER;
  template_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO channel_count FROM notification_channels;
  SELECT COUNT(*) INTO rule_count FROM alert_rules WHERE rule_type = 'composite';
  SELECT COUNT(*) INTO template_count FROM notification_templates;
  
  RAISE NOTICE 'Notification seed data loaded:';
  RAISE NOTICE '✓ Notification channels: %', channel_count;
  RAISE NOTICE '✓ Composite alert rules: %', rule_count;
  RAISE NOTICE '✓ Notification templates: %', template_count;
  RAISE NOTICE '✓ User notification preferences updated';
END $$;

COMMIT;

