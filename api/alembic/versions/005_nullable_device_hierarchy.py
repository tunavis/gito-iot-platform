"""Make device hierarchy columns nullable

Revision ID: 005_nullable_device_hierarchy
Revises: 004_drop_solution_templates
Create Date: 2026-02-20
"""
from typing import Sequence, Union
from alembic import op

revision: str = "005_nullable_device_hierarchy"
down_revision: Union[str, None] = "004_drop_solution_templates"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.alter_column("devices", "organization_id", nullable=True)
    op.alter_column("devices", "site_id", nullable=True)
    op.alter_column("devices", "device_group_id", nullable=True)
    op.alter_column("devices", "device_type_id", nullable=True)


def downgrade() -> None:
    op.alter_column("devices", "organization_id", nullable=False)
    op.alter_column("devices", "site_id", nullable=False)
    op.alter_column("devices", "device_group_id", nullable=False)
    op.alter_column("devices", "device_type_id", nullable=False)