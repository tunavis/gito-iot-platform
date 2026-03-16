-- Migration 012: Device Commands (RPC Option B) + Gateway support
-- Adds device_commands table for request-response command lifecycle tracking
-- Adds gateway_id FK on devices for gateway sub-device fan-out

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Device commands table
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS device_commands (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    device_id UUID NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
    command_name VARCHAR(100) NOT NULL,
    parameters JSONB DEFAULT '{}',
    status VARCHAR(20) NOT NULL DEFAULT 'pending',
    response JSONB,
    error_message TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '60 seconds'),
    sent_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    CONSTRAINT valid_command_status CHECK (
        status IN ('pending', 'sent', 'delivered', 'executed', 'failed', 'timed_out')
    )
);

CREATE INDEX IF NOT EXISTS idx_device_commands_tenant ON device_commands(tenant_id);
CREATE INDEX IF NOT EXISTS idx_device_commands_device ON device_commands(device_id);
CREATE INDEX IF NOT EXISTS idx_device_commands_status ON device_commands(status);
CREATE INDEX IF NOT EXISTS idx_device_commands_expires ON device_commands(expires_at)
    WHERE status IN ('pending', 'sent', 'delivered');

-- RLS policy
ALTER TABLE device_commands ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies WHERE tablename = 'device_commands' AND policyname = 'tenant_isolation_device_commands'
    ) THEN
        CREATE POLICY tenant_isolation_device_commands ON device_commands
            USING (tenant_id = current_setting('app.current_tenant_id')::UUID);
    END IF;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Gateway support: add gateway_id to devices
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE devices ADD COLUMN IF NOT EXISTS gateway_id UUID REFERENCES devices(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_devices_gateway ON devices(gateway_id);

COMMIT;
