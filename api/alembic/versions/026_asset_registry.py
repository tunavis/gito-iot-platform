# api/alembic/versions/026_asset_registry.py
"""Additive asset registry: the `assets` table and a nullable `devices.asset_id`.

Strictly additive, per strategy §4b. Nothing that currently keys on `device_id`
changes: no backfill, no column drops, no type changes, no data movement. Every
device that existed before this migration stays valid with `asset_id IS NULL`,
which is why the column is nullable — a NOT NULL column would need a backfill and
could not be applied to a live install.

FK behaviour is deliberate:
- assets.tenant_id / assets.site_id CASCADE — an asset cannot outlive its tenant
  or the site it stands at.
- assets.parent_id CASCADE — deleting a parent asset deletes its descendants.
- devices.asset_id SET NULL — deleting an asset detaches its instrumentation.
  Devices are never deleted by an asset delete, and an attached device never
  blocks one.

`db/init.sql` is intentionally untouched (frozen by convention); the CI
"DB Bootstrap" job asserts init.sql followed by `alembic upgrade head` succeeds on
a fresh database.

Revision ID: 026_asset_registry
Revises: 025_backfill_subscriptions
Create Date: 2026-07-30
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "026_asset_registry"
down_revision: Union[str, None] = "025_backfill_subscriptions"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "assets",
        sa.Column(
            "id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")
        ),
        sa.Column(
            "tenant_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("tenants.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "site_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("sites.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "parent_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("assets.id", ondelete="CASCADE"),
            nullable=True,
        ),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("asset_type", sa.String(100), nullable=True),
        sa.Column(
            "attributes",
            postgresql.JSONB(),
            nullable=False,
            server_default=sa.text("'{}'::jsonb"),
        ),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("NOW()")
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("NOW()")
        ),
    )
    op.create_index("idx_assets_tenant", "assets", ["tenant_id"])
    op.create_index("idx_assets_site", "assets", ["site_id"])
    op.create_index("idx_assets_parent", "assets", ["parent_id"])

    op.add_column("devices", sa.Column("asset_id", postgresql.UUID(as_uuid=True), nullable=True))
    op.create_foreign_key(
        "fk_devices_asset_id",
        "devices",
        "assets",
        ["asset_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_index("idx_devices_asset", "devices", ["asset_id"])


def downgrade() -> None:
    # Column before table: the FK on devices.asset_id references assets.
    op.drop_index("idx_devices_asset", table_name="devices")
    op.drop_constraint("fk_devices_asset_id", "devices", type_="foreignkey")
    op.drop_column("devices", "asset_id")

    op.drop_index("idx_assets_parent", table_name="assets")
    op.drop_index("idx_assets_site", table_name="assets")
    op.drop_index("idx_assets_tenant", table_name="assets")
    op.drop_table("assets")
