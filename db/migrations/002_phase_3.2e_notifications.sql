-- ============================================================================
-- Migration: Phase 3.2e - Multi-Channel Notifications
-- Adds notification infrastructure tables with RLS policies
-- ============================================================================

BEGIN;

-- Create notification_channels table
CREATE TABLE notification_channels (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    channel_type VARCHAR(50) NOT NULL,
    config JSONB NOT NULL,
    enabled BOOLEAN DEFAULT true,
    verified BOOLEAN DEFAULT false,
    verified_at TIMESTAMPTZ,
    last_used_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    
    CONSTRAINT valid_channel_type CHECK (channel_type IN ('email', 'slack', 'webhook', 'apns', 'fcm', 'sms')),
    CONSTRAINT unique_user_channel UNIQUE(user_id, channel_type, config)
);

CREATE INDEX idx_notification_channels_tenant ON notification_channels(tenant_id);
CREATE INDEX idx_notification_channels_user ON notification_channels(user_id);
CREATE INDEX idx_notification_channels_enabled ON notification_channels(enabled);
CREATE INDEX idx_notification_channels_type ON notification_channels(channel_type);

ALTER TABLE notification_channels ENABLE ROW LEVEL SECURITY;
CREATE POLICY notification_channels_tenant_isolation ON notification_channels
    USING (tenant_id = current_setting('app.tenant_id')::UUID);

-- Create notification_rules table
CREATE TABLE notification_rules (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    alert_rule_id UUID NOT NULL REFERENCES alert_rules(id) ON DELETE CASCADE,
    channel_id UUID NOT NULL REFERENCES notification_channels(id) ON DELETE CASCADE,
    enabled BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    
    CONSTRAINT unique_rule_channel UNIQUE(alert_rule_id, channel_id)
);

CREATE INDEX idx_notification_rules_alert ON notification_rules(alert_rule_id);
CREATE INDEX idx_notification_rules_channel ON notification_rules(channel_id);
CREATE INDEX idx_notification_rules_enabled ON notification_rules(enabled);

ALTER TABLE notification_rules ENABLE ROW LEVEL SECURITY;
CREATE POLICY notification_rules_tenant_isolation ON notification_rules
    USING (tenant_id = current_setting('app.tenant_id')::UUID);

-- Create notifications table
CREATE TABLE notifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    alert_event_id UUID NOT NULL REFERENCES alert_events(id) ON DELETE CASCADE,
    channel_id UUID NOT NULL REFERENCES notification_channels(id) ON DELETE CASCADE,
    channel_type VARCHAR(50) NOT NULL,
    recipient VARCHAR(255) NOT NULL,
    status VARCHAR(50) NOT NULL DEFAULT 'pending',
    delivery_status VARCHAR(50),
    error_message TEXT,
    retry_count INTEGER DEFAULT 0,
    next_retry_at TIMESTAMPTZ,
    sent_at TIMESTAMPTZ,
    delivered_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    
    CONSTRAINT valid_status CHECK (status IN ('pending', 'sending', 'sent', 'failed', 'bounced', 'skipped')),
    CONSTRAINT valid_delivery_status CHECK (delivery_status IS NULL OR delivery_status IN ('success', 'permanent_failure', 'temporary_failure', 'invalid_address', 'rate_limited'))
);

CREATE INDEX idx_notifications_tenant ON notifications(tenant_id);
CREATE INDEX idx_notifications_alert_event ON notifications(alert_event_id);
CREATE INDEX idx_notifications_channel ON notifications(channel_id);
CREATE INDEX idx_notifications_status ON notifications(status);
CREATE INDEX idx_notifications_recipient ON notifications(recipient);
CREATE INDEX idx_notifications_created ON notifications(created_at DESC);
CREATE INDEX idx_notifications_retry ON notifications(status, next_retry_at) WHERE status = 'pending';

ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
CREATE POLICY notifications_tenant_isolation ON notifications
    USING (tenant_id = current_setting('app.tenant_id')::UUID);

-- Create notification_templates table
CREATE TABLE notification_templates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    channel_type VARCHAR(50) NOT NULL,
    alert_type VARCHAR(100),
    name VARCHAR(255) NOT NULL,
    subject VARCHAR(500),
    body TEXT NOT NULL,
    variables JSONB DEFAULT '[]',
    enabled BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    
    CONSTRAINT valid_template_channel CHECK (channel_type IN ('email', 'slack', 'webhook')),
    CONSTRAINT unique_template UNIQUE(tenant_id, channel_type, alert_type)
);

CREATE INDEX idx_notification_templates_tenant ON notification_templates(tenant_id);
CREATE INDEX idx_notification_templates_channel ON notification_templates(channel_type);
CREATE INDEX idx_notification_templates_enabled ON notification_templates(enabled);

ALTER TABLE notification_templates ENABLE ROW LEVEL SECURITY;
CREATE POLICY notification_templates_tenant_isolation ON notification_templates
    USING (tenant_id = current_setting('app.tenant_id')::UUID);

-- Add notification_preferences to users table
ALTER TABLE users ADD COLUMN IF NOT EXISTS notification_preferences JSONB DEFAULT '{
    "quiet_hours_enabled": false,
    "quiet_hours_start": "22:00",
    "quiet_hours_end": "08:00",
    "timezone": "UTC",
    "muted_rules": [],
    "email_digest_enabled": false,
    "email_digest_frequency": "daily"
}';

CREATE INDEX IF NOT EXISTS idx_users_notification_prefs ON users USING GIN (notification_preferences);

-- Create notification_queue table for background processing
CREATE TABLE IF NOT EXISTS notification_queue (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    alert_event_id UUID NOT NULL REFERENCES alert_events(id) ON DELETE CASCADE,
    status VARCHAR(50) NOT NULL DEFAULT 'pending',
    error_message TEXT,
    attempted_at TIMESTAMPTZ,
    processed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    
    CONSTRAINT valid_queue_status CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
    CONSTRAINT unique_queue_alert UNIQUE(alert_event_id)
);

CREATE INDEX idx_notification_queue_status ON notification_queue(status);
CREATE INDEX idx_notification_queue_tenant ON notification_queue(tenant_id);
CREATE INDEX idx_notification_queue_created ON notification_queue(created_at DESC);
CREATE INDEX idx_notification_queue_retry ON notification_queue(status, created_at) WHERE status = 'pending';

ALTER TABLE notification_queue ENABLE ROW LEVEL SECURITY;
CREATE POLICY notification_queue_tenant_isolation ON notification_queue
    USING (tenant_id = current_setting('app.tenant_id')::UUID);

-- Create notification delivery status view
CREATE OR REPLACE VIEW notification_delivery_status AS
SELECT 
    n.id,
    n.tenant_id,
    n.alert_event_id,
    n.channel_type,
    n.status,
    n.delivery_status,
    n.retry_count,
    ar.id as alert_rule_id,
    ar.device_id,
    ae.fired_at as alert_fired_at,
    n.created_at,
    n.sent_at,
    CASE 
        WHEN n.status = 'sent' THEN 'Successfully sent'
        WHEN n.status = 'failed' AND n.retry_count < 5 THEN 'Will retry'
        WHEN n.status = 'failed' THEN 'Max retries exceeded'
        WHEN n.status = 'pending' THEN 'Waiting to send'
        WHEN n.status = 'skipped' THEN 'Skipped (user preferences)'
        ELSE n.status
    END as status_description
FROM notifications n
JOIN alert_events ae ON n.alert_event_id = ae.id
JOIN alert_rules ar ON ae.alert_rule_id = ar.id;

COMMIT;
