"""Add TimescaleDB: hypertable, compression, continuous aggregates.

Telemetry isolation strategy:
  RLS is DISABLED on the telemetry table so that TimescaleDB compression and
  continuous aggregates can be used (both are incompatible with RLS).
  Multi-tenant isolation is enforced at the application layer instead:
    - MQTT processor: validates tenant_id from topic UUID, sets it on every INSERT
    - API routers: validate JWT tenant_id matches URL tenant_id before any query
    - All queries include explicit WHERE tenant_id = :tenant_id filters
  This is the standard approach used by ThingsBoard, Cumulocity, and all
  major IoT platforms. All other tables (devices, users, alerts, etc.) keep RLS.

What this migration does:
  1. Enable timescaledb extension
  2. Fix PK to include ts (required by TimescaleDB for unique constraints)
  3. Disable RLS on telemetry (required for compression + continuous aggregates)
  4. Convert to hypertable with 7-day chunks
  5. Enable compression on chunks older than 30 days (~90% disk savings)
  6. Create telemetry_hourly continuous aggregate (auto-refreshes every 30 min)
  7. Create telemetry_daily continuous aggregate (auto-refreshes every hour)

Revision ID: 010_timescaledb
Revises: 009_tenant_hierarchy
Create Date: 2026-03-09
"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa
import psycopg2

revision: str = "010_timescaledb"
down_revision: Union[str, None] = "009_tenant_hierarchy"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # -------------------------------------------------------------------------
    # 1. Enable TimescaleDB extension
    #    CREATE EXTENSION timescaledb must run in AUTOCOMMIT mode — the
    #    extension resets the backend connection when loaded, killing any
    #    open transaction. psycopg2 refuses to set autocommit on a connection
    #    that already has an open transaction (which Alembic always has).
    #    Solution: open a brand-new psycopg2 connection in autocommit mode,
    #    run the CREATE EXTENSION, then close it — never touching Alembic's
    #    own connection.
    # -------------------------------------------------------------------------
    bind = op.get_bind()
    url = bind.engine.url
    ext_conn = psycopg2.connect(
        host=url.host,
        port=url.port or 5432,
        dbname=url.database,
        user=url.username,
        password=url.password,
    )
    ext_conn.autocommit = True
    try:
        with ext_conn.cursor() as cur:
            cur.execute("CREATE EXTENSION IF NOT EXISTS timescaledb CASCADE")
    finally:
        ext_conn.close()

    # -------------------------------------------------------------------------
    # 2. Fix primary key: drop old (id-only) PK, add composite (id, ts)
    #    TimescaleDB requires the partition column (ts) in every unique index.
    # -------------------------------------------------------------------------
    op.execute("""
    DO $$
    BEGIN
        IF EXISTS (
            SELECT 1
            FROM pg_constraint c
            JOIN pg_class t ON t.oid = c.conrelid
            WHERE t.relname = 'telemetry'
              AND c.contype = 'p'
              AND NOT EXISTS (
                  SELECT 1
                  FROM pg_attribute a
                  JOIN pg_index i ON i.indrelid = t.oid
                  WHERE a.attrelid = t.oid
                    AND a.attname = 'ts'
                    AND i.indisprimary
                    AND a.attnum = ANY(i.indkey)
              )
        ) THEN
            ALTER TABLE telemetry DROP CONSTRAINT telemetry_pkey;
            ALTER TABLE telemetry ADD PRIMARY KEY (id, ts);
        END IF;
    END $$;
    """)

    # -------------------------------------------------------------------------
    # 3. Disable RLS on telemetry
    #    Allows TimescaleDB compression + continuous aggregates.
    #    Tenant isolation is enforced at application layer (see module docstring).
    # -------------------------------------------------------------------------
    op.execute("ALTER TABLE telemetry DISABLE ROW LEVEL SECURITY")

    # -------------------------------------------------------------------------
    # 4. Convert to hypertable (7-day chunks by ts)
    # -------------------------------------------------------------------------
    op.execute("""
    SELECT create_hypertable(
        'telemetry',
        'ts',
        chunk_time_interval => INTERVAL '7 days',
        if_not_exists        => TRUE,
        migrate_data         => TRUE
    )
    """)

    # -------------------------------------------------------------------------
    # 5. Compression: segment by device+metric, order by ts DESC
    #    Chunks older than 30 days are compressed automatically (~90% savings).
    # -------------------------------------------------------------------------
    op.execute("""
    ALTER TABLE telemetry SET (
        timescaledb.compress,
        timescaledb.compress_segmentby = 'device_id, metric_key',
        timescaledb.compress_orderby   = 'ts DESC'
    )
    """)

    op.execute("""
    SELECT add_compression_policy(
        'telemetry',
        compress_after => INTERVAL '30 days',
        if_not_exists  => TRUE
    )
    """)

    # -------------------------------------------------------------------------
    # 6. Continuous aggregate: telemetry_hourly
    #    Pre-computed hourly rollup per device+metric. Auto-refreshes every
    #    30 minutes covering the last 7 days of data.
    # -------------------------------------------------------------------------
    op.execute("""
    CREATE MATERIALIZED VIEW IF NOT EXISTS telemetry_hourly
    WITH (timescaledb.continuous) AS
    SELECT
        tenant_id,
        device_id,
        metric_key,
        time_bucket('1 hour', ts)  AS bucket,
        AVG(metric_value)          AS avg_value,
        MIN(metric_value)          AS min_value,
        MAX(metric_value)          AS max_value,
        COUNT(*)                   AS sample_count
    FROM telemetry
    WHERE metric_value IS NOT NULL
    GROUP BY tenant_id, device_id, metric_key, time_bucket('1 hour', ts)
    WITH NO DATA
    """)

    op.execute("""
    SELECT add_continuous_aggregate_policy(
        'telemetry_hourly',
        start_offset      => INTERVAL '7 days',
        end_offset        => INTERVAL '1 hour',
        schedule_interval => INTERVAL '30 minutes',
        if_not_exists     => TRUE
    )
    """)

    # -------------------------------------------------------------------------
    # 7. Continuous aggregate: telemetry_daily
    #    Pre-computed daily rollup. Auto-refreshes every hour covering 90 days.
    # -------------------------------------------------------------------------
    op.execute("""
    CREATE MATERIALIZED VIEW IF NOT EXISTS telemetry_daily
    WITH (timescaledb.continuous) AS
    SELECT
        tenant_id,
        device_id,
        metric_key,
        time_bucket('1 day', ts)   AS bucket,
        AVG(metric_value)          AS avg_value,
        MIN(metric_value)          AS min_value,
        MAX(metric_value)          AS max_value,
        COUNT(*)                   AS sample_count
    FROM telemetry
    WHERE metric_value IS NOT NULL
    GROUP BY tenant_id, device_id, metric_key, time_bucket('1 day', ts)
    WITH NO DATA
    """)

    op.execute("""
    SELECT add_continuous_aggregate_policy(
        'telemetry_daily',
        start_offset      => INTERVAL '90 days',
        end_offset        => INTERVAL '1 day',
        schedule_interval => INTERVAL '1 hour',
        if_not_exists     => TRUE
    )
    """)


def downgrade() -> None:
    op.execute("DROP MATERIALIZED VIEW IF EXISTS telemetry_daily CASCADE")
    op.execute("DROP MATERIALIZED VIEW IF EXISTS telemetry_hourly CASCADE")
    op.execute("ALTER TABLE telemetry ENABLE ROW LEVEL SECURITY")
    # Note: cannot easily reverse a hypertable without data loss.