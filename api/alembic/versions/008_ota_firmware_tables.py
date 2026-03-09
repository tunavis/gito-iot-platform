"""Add OTA firmware management tables.

Creates:
- firmware_versions — firmware binary metadata
- ota_campaigns — firmware update campaigns
- ota_campaign_devices — per-device campaign status
- device_firmware_history — full update history per device

All tables include RLS policies for tenant isolation.

Revision ID: 008_ota_firmware_tables
Revises: 007_tenant_metadata_and_events
Create Date: 2026-03-08
"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = "008_ota_firmware_tables"
down_revision: Union[str, None] = "007_tenant_metadata_and_events"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # firmware_versions
    op.execute("""
        CREATE TABLE IF NOT EXISTS firmware_versions (
            id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
            name        VARCHAR(255) NOT NULL,
            version     VARCHAR(50) NOT NULL,
            url         VARCHAR(2048) NOT NULL,
            size_bytes  INTEGER NOT NULL,
            hash        CHAR(64) NOT NULL,
            release_type VARCHAR(20) NOT NULL DEFAULT 'beta'
                CHECK (release_type IN ('beta', 'production', 'hotfix')),
            changelog   TEXT,
            created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
            updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
        )
    """)
    op.execute("CREATE INDEX IF NOT EXISTS idx_firmware_tenant ON firmware_versions(tenant_id)")

    op.execute("""
        DO $$ BEGIN
            IF NOT EXISTS (
                SELECT 1 FROM pg_policies
                WHERE tablename = 'firmware_versions' AND policyname = 'tenant_isolation'
            ) THEN
                ALTER TABLE firmware_versions ENABLE ROW LEVEL SECURITY;
                CREATE POLICY tenant_isolation ON firmware_versions
                    USING (tenant_id = current_setting('app.current_tenant_id')::UUID);
            END IF;
        END $$
    """)

    # ota_campaigns
    op.execute("""
        CREATE TABLE IF NOT EXISTS ota_campaigns (
            id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            tenant_id               UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
            name                    VARCHAR(255) NOT NULL,
            firmware_version_id     UUID NOT NULL REFERENCES firmware_versions(id) ON DELETE RESTRICT,
            rollout_strategy        VARCHAR(20) NOT NULL DEFAULT 'immediate'
                CHECK (rollout_strategy IN ('immediate', 'staggered', 'scheduled')),
            devices_per_hour        INTEGER NOT NULL DEFAULT 100,
            auto_rollback_threshold FLOAT NOT NULL DEFAULT 0.1,
            status                  VARCHAR(20) NOT NULL DEFAULT 'draft'
                CHECK (status IN ('draft', 'scheduled', 'in_progress', 'completed', 'failed', 'rolled_back')),
            scheduled_at            TIMESTAMPTZ,
            started_at              TIMESTAMPTZ,
            completed_at            TIMESTAMPTZ,
            created_by              UUID REFERENCES users(id) ON DELETE SET NULL,
            created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
            updated_at              TIMESTAMPTZ NOT NULL DEFAULT now()
        )
    """)
    op.execute("CREATE INDEX IF NOT EXISTS idx_ota_campaigns_tenant ON ota_campaigns(tenant_id)")

    op.execute("""
        DO $$ BEGIN
            IF NOT EXISTS (
                SELECT 1 FROM pg_policies
                WHERE tablename = 'ota_campaigns' AND policyname = 'tenant_isolation'
            ) THEN
                ALTER TABLE ota_campaigns ENABLE ROW LEVEL SECURITY;
                CREATE POLICY tenant_isolation ON ota_campaigns
                    USING (tenant_id = current_setting('app.current_tenant_id')::UUID);
            END IF;
        END $$
    """)

    # ota_campaign_devices
    op.execute("""
        CREATE TABLE IF NOT EXISTS ota_campaign_devices (
            id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            campaign_id      UUID NOT NULL REFERENCES ota_campaigns(id) ON DELETE CASCADE,
            device_id        UUID NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
            status           VARCHAR(20) NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending', 'in_progress', 'completed', 'failed', 'skipped')),
            progress_percent INTEGER NOT NULL DEFAULT 0,
            error_message    TEXT,
            started_at       TIMESTAMPTZ,
            completed_at     TIMESTAMPTZ
        )
    """)
    op.execute("CREATE INDEX IF NOT EXISTS idx_ota_campaign_devices_campaign ON ota_campaign_devices(campaign_id)")
    op.execute("CREATE INDEX IF NOT EXISTS idx_ota_campaign_devices_device ON ota_campaign_devices(device_id)")

    # device_firmware_history
    op.execute("""
        CREATE TABLE IF NOT EXISTS device_firmware_history (
            id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            device_id           UUID NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
            firmware_version_id UUID REFERENCES firmware_versions(id) ON DELETE SET NULL,
            previous_version_id UUID REFERENCES firmware_versions(id) ON DELETE SET NULL,
            status              VARCHAR(20) NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending', 'in_progress', 'completed', 'failed', 'rolled_back')),
            progress_percent    INTEGER NOT NULL DEFAULT 0,
            error_message       TEXT,
            started_at          TIMESTAMPTZ,
            completed_at        TIMESTAMPTZ,
            created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
        )
    """)
    op.execute("CREATE INDEX IF NOT EXISTS idx_device_fw_history_device ON device_firmware_history(device_id)")


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS device_firmware_history")
    op.execute("DROP TABLE IF EXISTS ota_campaign_devices")
    op.execute("DROP TABLE IF EXISTS ota_campaigns")
    op.execute("DROP TABLE IF EXISTS firmware_versions")