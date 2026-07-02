-- Migration 014: Create integrations table for external LoRaWAN/webhook integrations

CREATE TABLE IF NOT EXISTS integrations (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    name        VARCHAR(100) NOT NULL,
    provider    VARCHAR(50) NOT NULL,
    key_hash    VARCHAR(64) NOT NULL UNIQUE,
    key_prefix  VARCHAR(12) NOT NULL,
    config      JSONB NOT NULL DEFAULT '{}',
    is_active   BOOLEAN NOT NULL DEFAULT TRUE,
    last_used_at TIMESTAMPTZ,
    message_count INTEGER NOT NULL DEFAULT 0,
    created_by  UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT valid_provider CHECK (
        provider IN ('chirpstack', 'ttn', 'helium', 'actility', 'custom', 'mqtt', 'http')
    )
);

CREATE INDEX IF NOT EXISTS idx_integrations_tenant ON integrations(tenant_id);

-- RLS policy: tenant-scoped
ALTER TABLE integrations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON integrations;
CREATE POLICY tenant_isolation ON integrations
    USING (tenant_id = current_setting('app.current_tenant_id')::UUID);
