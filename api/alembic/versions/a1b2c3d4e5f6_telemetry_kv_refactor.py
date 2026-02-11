"""Telemetry key-value refactor

Revision ID: a1b2c3d4e5f6
Revises: 559fa082f874
Create Date: 2026-02-10 14:40:25.000000

Migrates from fixed-column telemetry_hot to industry-standard key-value
telemetry table. This enables unlimited dynamic metrics per device.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = 'a1b2c3d4e5f6'
down_revision: Union[str, None] = '559fa082f874'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """
    IDEMPOTENT: Create new telemetry table with key-value schema.
    Migrate existing data from telemetry_hot if it exists.
    Drop old telemetry_hot table.
    """
    # 1. Create new telemetry table (idempotent)
    op.execute("""
        CREATE TABLE IF NOT EXISTS telemetry (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
            device_id UUID NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
            metric_key VARCHAR(100) NOT NULL,
            metric_value FLOAT,
            metric_value_str VARCHAR(500),
            metric_value_json JSONB,
            unit VARCHAR(20),
            ts TIMESTAMPTZ NOT NULL,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
    """)

    # 2. Create indexes (idempotent)
    op.execute("""
        CREATE INDEX IF NOT EXISTS idx_telemetry_device_metric_ts
            ON telemetry (device_id, metric_key, ts);
    """)
    op.execute("""
        CREATE INDEX IF NOT EXISTS idx_telemetry_tenant_device
            ON telemetry (tenant_id, device_id);
    """)
    op.execute("""
        CREATE INDEX IF NOT EXISTS idx_telemetry_ts
            ON telemetry (ts);
    """)
    op.execute("""
        CREATE INDEX IF NOT EXISTS idx_telemetry_latest
            ON telemetry (device_id, metric_key, ts DESC);
    """)

    # 3. Migrate data from telemetry_hot to telemetry (idempotent)
    # Only run if telemetry_hot exists AND telemetry is empty
    op.execute("""
        DO $$
        BEGIN
            IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'telemetry_hot')
               AND NOT EXISTS (SELECT 1 FROM telemetry LIMIT 1)
            THEN
                INSERT INTO telemetry (id, tenant_id, device_id, metric_key, metric_value, metric_value_str, metric_value_json, ts, created_at)
                SELECT
                    gen_random_uuid(),
                    t.tenant_id,
                    t.device_id,
                    kv.key,
                    -- Try to cast to numeric, otherwise NULL
                    CASE
                        WHEN kv.value_type = 'number' THEN kv.value::float
                        ELSE NULL
                    END,
                    -- Store string values in metric_value_str
                    CASE
                        WHEN kv.value_type = 'string' THEN kv.value
                        ELSE NULL
                    END,
                    -- Store complex values in metric_value_json
                    CASE
                        WHEN kv.value_type IN ('object', 'array') THEN kv.value::jsonb
                        ELSE NULL
                    END,
                    t.timestamp,
                    t.created_at
                FROM telemetry_hot t
                CROSS JOIN LATERAL (
                    -- Extract fixed numeric columns
                    SELECT 'temperature' as key, t.temperature::text as value, 'number' as value_type
                    WHERE t.temperature IS NOT NULL
                    UNION ALL
                    SELECT 'humidity', t.humidity::text, 'number'
                    WHERE t.humidity IS NOT NULL
                    UNION ALL
                    SELECT 'pressure', t.pressure::text, 'number'
                    WHERE t.pressure IS NOT NULL
                    UNION ALL
                    SELECT 'battery', t.battery::text, 'number'
                    WHERE t.battery IS NOT NULL
                    UNION ALL
                    SELECT 'rssi', t.rssi::text, 'number'
                    WHERE t.rssi IS NOT NULL
                    UNION ALL
                    -- Extract all payload keys with type information
                    SELECT
                        j.key,
                        CASE
                            WHEN jsonb_typeof(j.value) = 'string' THEN j.value#>>'{}'  -- Extract string without quotes
                            ELSE j.value::text
                        END as value,
                        jsonb_typeof(j.value) as value_type
                    FROM jsonb_each(COALESCE(t.payload, '{}'::jsonb)) j
                    WHERE j.key NOT IN ('temperature', 'humidity', 'pressure', 'battery', 'rssi')
                      AND j.value IS NOT NULL
                ) kv
                WHERE kv.value IS NOT NULL
                  AND kv.value != 'null';

                RAISE NOTICE 'Migrated telemetry data from telemetry_hot to telemetry';
            END IF;
        END $$;
    """)

    # 4. Create RLS policy for tenant isolation (idempotent)
    op.execute("""
        ALTER TABLE telemetry ENABLE ROW LEVEL SECURITY;
    """)
    op.execute("""
        DO $$
        BEGIN
            IF NOT EXISTS (
                SELECT 1 FROM pg_policies
                WHERE tablename = 'telemetry' AND policyname = 'tenant_isolation_telemetry'
            ) THEN
                CREATE POLICY tenant_isolation_telemetry ON telemetry
                    USING (tenant_id = COALESCE(
                        NULLIF(current_setting('app.current_tenant_id', true), ''),
                        current_setting('app.tenant_id', true)
                    )::uuid);
            END IF;
        END $$;
    """)

    # 5. Drop old telemetry_hot table (idempotent)
    op.execute("""
        DROP TABLE IF EXISTS telemetry_hot CASCADE;
    """)


def downgrade() -> None:
    """
    IDEMPOTENT: Recreate telemetry_hot table with fixed columns.
    Migrate data back from telemetry.
    Drop telemetry table.
    """
    # 1. Recreate telemetry_hot with original schema (idempotent)
    op.execute("""
        CREATE TABLE IF NOT EXISTS telemetry_hot (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
            device_id UUID NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
            temperature FLOAT,
            humidity FLOAT,
            pressure FLOAT,
            battery FLOAT,
            rssi INTEGER,
            payload JSONB NOT NULL DEFAULT '{}'::jsonb,
            timestamp TIMESTAMPTZ NOT NULL,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
    """)

    # 2. Create indexes (idempotent)
    op.execute("""
        CREATE INDEX IF NOT EXISTS idx_telemetry_device_time
            ON telemetry_hot (device_id, timestamp);
    """)
    op.execute("""
        CREATE INDEX IF NOT EXISTS idx_telemetry_tenant_device
            ON telemetry_hot (tenant_id, device_id);
    """)
    op.execute("""
        CREATE INDEX IF NOT EXISTS idx_telemetry_timestamp
            ON telemetry_hot (timestamp);
    """)

    # 3. Migrate data back (idempotent)
    # Only run if telemetry exists AND telemetry_hot is empty
    op.execute("""
        DO $$
        BEGIN
            IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'telemetry')
               AND NOT EXISTS (SELECT 1 FROM telemetry_hot LIMIT 1)
            THEN
                INSERT INTO telemetry_hot (id, tenant_id, device_id, temperature, humidity, pressure, battery, rssi, payload, timestamp, created_at)
                SELECT
                    gen_random_uuid(),
                    tenant_id,
                    device_id,
                    MAX(CASE WHEN metric_key = 'temperature' THEN metric_value END) as temperature,
                    MAX(CASE WHEN metric_key = 'humidity' THEN metric_value END) as humidity,
                    MAX(CASE WHEN metric_key = 'pressure' THEN metric_value END) as pressure,
                    MAX(CASE WHEN metric_key = 'battery' THEN metric_value END) as battery,
                    MAX(CASE WHEN metric_key = 'rssi' THEN metric_value END)::int as rssi,
                    jsonb_object_agg(
                        metric_key,
                        COALESCE(metric_value::text, metric_value_str, metric_value_json::text)
                    ) FILTER (WHERE metric_key NOT IN ('temperature', 'humidity', 'pressure', 'battery', 'rssi')) as payload,
                    ts as timestamp,
                    MIN(created_at) as created_at
                FROM telemetry
                GROUP BY tenant_id, device_id, ts;

                RAISE NOTICE 'Migrated telemetry data from telemetry to telemetry_hot';
            END IF;
        END $$;
    """)

    # 4. Enable RLS (idempotent)
    op.execute("""
        ALTER TABLE telemetry_hot ENABLE ROW LEVEL SECURITY;
    """)
    op.execute("""
        DO $$
        BEGIN
            IF NOT EXISTS (
                SELECT 1 FROM pg_policies
                WHERE tablename = 'telemetry_hot' AND policyname = 'tenant_isolation_telemetry_hot'
            ) THEN
                CREATE POLICY tenant_isolation_telemetry_hot ON telemetry_hot
                    USING (tenant_id = COALESCE(
                        NULLIF(current_setting('app.current_tenant_id', true), ''),
                        current_setting('app.tenant_id', true)
                    )::uuid);
            END IF;
        END $$;
    """)

    # 5. Drop new telemetry table (idempotent)
    op.execute("""
        DROP TABLE IF EXISTS telemetry CASCADE;
    """)
