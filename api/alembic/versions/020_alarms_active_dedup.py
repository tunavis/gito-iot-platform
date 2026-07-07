# api/alembic/versions/020_alarms_active_dedup.py
"""Partial unique index for auto-alarm dedup: one ACTIVE alarm per (rule, device).

Lets the processor UPSERT alarms on every firing — a new ACTIVE alarm the first
time a rule fires for a device, occurrence bump thereafter — without duplicating.
Part of alarm engine unification Step 4
(docs/superpowers/plans/2026-07-06-alarm-engine-unification.md).

Revision ID: 020_alarms_active_dedup
Revises: 019_notification_queue_unique
Create Date: 2026-07-06
"""
from typing import Sequence, Union
from alembic import op

revision: str = "020_alarms_active_dedup"
down_revision: Union[str, None] = "019_notification_queue_unique"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Defensive: collapse any pre-existing duplicate ACTIVE alarms (keep newest)
    # so the unique index can be created. Auto-alarms don't exist yet, so this is
    # normally a no-op — but makes the migration safe to run against dirty data.
    op.execute("""
        UPDATE alarms a SET status = 'CLEARED', cleared_at = now(), updated_at = now()
        FROM (
            SELECT id,
                   row_number() OVER (
                       PARTITION BY alert_rule_id, device_id
                       ORDER BY fired_at DESC
                   ) AS rn
            FROM alarms
            WHERE status = 'ACTIVE' AND alert_rule_id IS NOT NULL AND device_id IS NOT NULL
        ) dup
        WHERE a.id = dup.id AND dup.rn > 1;
    """)
    op.execute("""
        CREATE UNIQUE INDEX IF NOT EXISTS uq_alarms_active_rule_device
            ON alarms (alert_rule_id, device_id)
            WHERE status = 'ACTIVE' AND alert_rule_id IS NOT NULL AND device_id IS NOT NULL;
    """)


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS uq_alarms_active_rule_device;")
