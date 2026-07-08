# api/alembic/versions/022_payload_decoding.py
"""Platform-side LoRaWAN payload decoding — raw_uplinks + device_types.decoder.

Phase 1 of platform-side decoding (plan: you-are-a-professional-sequential-frost).
Today an uplink with no network-server-decoded 'object' is dropped with zero
persistence. This adds: (a) a raw_uplinks table so every uplink's bytes are kept
regardless of decode outcome, enabling re-decode over history; (b) a `decoder`
JSONB column on device_types (declarative byte-layout spec, alongside the
existing key_mapping column) so Gito can decode payloads itself when the NS
hasn't.

Revision ID: 022_payload_decoding
Revises: 021_drop_legacy_composite
Create Date: 2026-07-07
"""
from typing import Sequence, Union
from alembic import op

revision: str = "022_payload_decoding"
down_revision: Union[str, None] = "021_drop_legacy_composite"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("""
        CREATE TABLE IF NOT EXISTS raw_uplinks (
            id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
            device_id   UUID NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
            ts          TIMESTAMPTZ NOT NULL DEFAULT now(),
            f_port      INTEGER,
            raw_b64     TEXT NOT NULL,
            decoded     BOOLEAN NOT NULL DEFAULT false,
            codec_used  VARCHAR(20),  -- 'ns' | 'declarative' | NULL (undecoded)
            created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
        );
    """)
    op.execute("""
        CREATE INDEX IF NOT EXISTS idx_raw_uplinks_tenant_device_ts
            ON raw_uplinks (tenant_id, device_id, ts DESC);
    """)
    op.execute("""
        CREATE INDEX IF NOT EXISTS idx_raw_uplinks_undecoded
            ON raw_uplinks (tenant_id, device_id) WHERE decoded = false;
    """)
    op.execute("ALTER TABLE raw_uplinks ENABLE ROW LEVEL SECURITY;")
    op.execute("""
        CREATE POLICY tenant_isolation ON raw_uplinks
            USING (tenant_id = current_setting('app.current_tenant_id')::UUID);
    """)

    op.execute("""
        ALTER TABLE device_types
        ADD COLUMN IF NOT EXISTS decoder JSONB DEFAULT NULL;
    """)
    op.execute("""
        COMMENT ON COLUMN device_types.decoder IS
            'Declarative byte-layout payload decoder spec, used only when the '
            'network server has not decoded the uplink itself. '
            'E.g. {"type": "declarative", "fields": [{"name": "flow_rate", '
            '"offset": 0, "length": 2, "type": "uint16", "scale": 0.1}]}';
    """)


def downgrade() -> None:
    op.execute("ALTER TABLE device_types DROP COLUMN IF EXISTS decoder;")
    op.execute("DROP TABLE IF EXISTS raw_uplinks CASCADE;")
