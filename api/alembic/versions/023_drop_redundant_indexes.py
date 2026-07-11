# api/alembic/versions/023_drop_redundant_indexes.py
"""Drop two indexes made redundant by another index already covering the same columns.

Verified against the real pg_index catalog (not inferred from SQL text) on a
disposable fresh-install database — these are the only two genuine duplicates
in the schema, out of everything init.sql + migrations 002-022 create:

- idx_tenants_slug (tenants.slug) duplicates tenants_slug_key, the implicit
  unique index Postgres creates for `slug ... UNIQUE NOT NULL` in init.sql.
- idx_telemetry_latest (device_id, metric_key, ts DESC) duplicates
  idx_telemetry_device_metric_ts (device_id, metric_key, ts) - a plain btree
  index scans backward for DESC ordering at the same cost, so the separate
  DESC-declared index buys nothing and only adds write overhead (doubled per
  TimescaleDB chunk, since telemetry is a hypertable).

Revision ID: 023_drop_redundant_indexes
Revises: 022_payload_decoding
Create Date: 2026-07-11
"""
from typing import Sequence, Union
from alembic import op

revision: str = "023_drop_redundant_indexes"
down_revision: Union[str, None] = "022_payload_decoding"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("DROP INDEX IF EXISTS idx_tenants_slug;")
    op.execute("DROP INDEX IF EXISTS idx_telemetry_latest;")


def downgrade() -> None:
    op.execute("CREATE INDEX IF NOT EXISTS idx_tenants_slug ON tenants(slug);")
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_telemetry_latest ON telemetry(device_id, metric_key, ts DESC);"
    )
