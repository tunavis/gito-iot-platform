# api/alembic/versions/019_notification_queue_unique.py
"""notification_queue: unique index on alert_event_id.

The processor enqueues with ON CONFLICT (alert_event_id) DO NOTHING, which
requires a unique constraint — without it EVERY enqueue failed silently and
alert notifications never dispatched. Part of alarm engine unification.

Revision ID: 019_notification_queue_unique
Revises: 018_alert_events_composite
Create Date: 2026-07-06
"""
from typing import Sequence, Union
from alembic import op

revision: str = "019_notification_queue_unique"
down_revision: Union[str, None] = "018_alert_events_composite"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Dedup defensively before the unique index (idempotent re-runs included)
    op.execute(
        """
        DELETE FROM notification_queue a USING notification_queue b
        WHERE a.alert_event_id = b.alert_event_id AND a.ctid > b.ctid;
    """
    )
    op.execute(
        """
        CREATE UNIQUE INDEX IF NOT EXISTS uq_notification_queue_alert_event
            ON notification_queue (alert_event_id);
    """
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS uq_notification_queue_alert_event;")
