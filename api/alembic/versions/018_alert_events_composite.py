# api/alembic/versions/018_alert_events_composite.py
"""Composite alarm firings — metric_name becomes nullable on alert_events.

COMPOSITE rules fire on multiple conditions, so a firing has no single metric.
Part of alarm engine unification (docs/superpowers/plans/2026-07-06-alarm-engine-unification.md).

Revision ID: 018_alert_events_composite
Revises: 017_chirpstack_mqtt
Create Date: 2026-07-06
"""
from typing import Sequence, Union
from alembic import op

revision: str = "018_alert_events_composite"
down_revision: Union[str, None] = "017_chirpstack_mqtt"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute(
        """
        ALTER TABLE alert_events ALTER COLUMN metric_name DROP NOT NULL;
    """
    )


def downgrade() -> None:
    # Backfill NULLs before restoring the constraint
    op.execute(
        """
        UPDATE alert_events SET metric_name = 'composite' WHERE metric_name IS NULL;
    """
    )
    op.execute(
        """
        ALTER TABLE alert_events ALTER COLUMN metric_name SET NOT NULL;
    """
    )
