# api/alembic/versions/033_notification_sources.py
"""A notification may be about something that is not an alert event.

Group 1 of openspec/changes/add-notification-sources.

`notification_queue.alert_event_id` was NOT NULL with an FK to `alert_events`,
so every notification the product could send had to first be an alarm. Two
callers are blocked on that: the ingestion-stall detector (which detects
correctly and then only logs) and the command-approval gate (whose whole point
is that a human is told).

Two tables, not one. The proposal names only `notification_queue`; the send
audit trail `notifications` carries the same NOT NULL and is written on every
`_send`, so leaving it would mean a non-alarm notification could be queued and
then fail to record that it was sent.

`source_kind` is an explicit discriminator rather than an inference from
`alert_event_id IS NULL` — the same reason `transport.mode` and
`downlink_mode` are explicit elsewhere. With inference, the second non-alert
source is indistinguishable from the first and a reader cannot tell which
payload shape it holds.

The partial unique index replaces, for non-alert rows, the guarantee that
`uq_notification_queue_alert_event` gives alert rows. Postgres treats NULLs as
distinct in a unique btree index, so without this every new source would
inherit no duplicate protection at all and a flapping stall would queue one
notification per tick. It is an index and not a check in the raiser for the
same reason as `uq_device_commands_inflight_opcode`: two concurrent raisers
would both read "nothing queued" and both insert.

Existing rows need no backfill beyond the column default — every row currently
in either table *is* an alert event, which is what the default says.

Revision ID: 033_notification_sources
Revises: 032_rename_ttn_app_id
Create Date: 2026-08-05
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "033_notification_sources"
down_revision: Union[str, None] = "032_rename_ttn_app_id"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # ── notification_queue: the work list ────────────────────────────────────
    op.execute(
        "ALTER TABLE notification_queue "
        "ADD COLUMN IF NOT EXISTS source_kind TEXT NOT NULL DEFAULT 'alert_event';"
    )
    op.execute("ALTER TABLE notification_queue ADD COLUMN IF NOT EXISTS payload JSONB;")
    op.execute("ALTER TABLE notification_queue ADD COLUMN IF NOT EXISTS dedupe_key TEXT;")
    op.execute("ALTER TABLE notification_queue ALTER COLUMN alert_event_id DROP NOT NULL;")

    op.execute(
        """
        COMMENT ON COLUMN notification_queue.source_kind IS
            'What this notification is about: ''alert_event'' (the pre-existing '
            'and default case), or a platform source such as ''ingestion_stall'' '
            'or ''command_approval''. Readers branch on this, never on whether '
            'alert_event_id happens to be NULL.';
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN notification_queue.dedupe_key IS
            'Identifies the event a non-alert source is reporting, so the same '
            'event cannot be queued twice. NULL for alert rows, which are already '
            'made exactly-once by uq_notification_queue_alert_event.';
        """
    )

    # Non-alert rows only: alert rows keep their own unique index untouched.
    op.execute(
        """
        CREATE UNIQUE INDEX IF NOT EXISTS uq_notification_queue_source_dedupe
            ON notification_queue (source_kind, dedupe_key)
            WHERE alert_event_id IS NULL AND dedupe_key IS NOT NULL;
        """
    )

    # ── notifications: the send audit trail ──────────────────────────────────
    # No unique index here by design — an audit trail may hold many rows per
    # source, one per delivery attempt per channel.
    op.execute(
        "ALTER TABLE notifications "
        "ADD COLUMN IF NOT EXISTS source_kind TEXT NOT NULL DEFAULT 'alert_event';"
    )
    op.execute("ALTER TABLE notifications ALTER COLUMN alert_event_id DROP NOT NULL;")
    op.execute(
        """
        COMMENT ON COLUMN notifications.source_kind IS
            'Mirrors notification_queue.source_kind so a sent notification records '
            'what it was about without re-deriving it from a nullable FK.';
        """
    )


def downgrade() -> None:
    """Refuses rather than deleting.

    Restoring NOT NULL requires no NULL rows to exist. The only way to force
    that is to delete queued or sent notifications about real platform events,
    which turns a rollback into an incident — and silently, since the rows are
    the only record those events were ever raised. An operator who genuinely
    wants them gone can delete them deliberately and re-run.
    """
    bind = op.get_bind()
    for table in ("notification_queue", "notifications"):
        orphans = bind.execute(
            sa.text(f"SELECT count(*) FROM {table} WHERE alert_event_id IS NULL")
        ).scalar()
        if orphans:
            raise RuntimeError(
                f"{table} holds {orphans} non-alert notification(s). Restoring "
                f"NOT NULL on alert_event_id would require deleting them. Remove "
                f"them explicitly if that is intended, then re-run this downgrade."
            )

    op.execute("DROP INDEX IF EXISTS uq_notification_queue_source_dedupe;")
    op.execute("ALTER TABLE notification_queue DROP COLUMN IF EXISTS dedupe_key;")
    op.execute("ALTER TABLE notification_queue DROP COLUMN IF EXISTS payload;")
    op.execute("ALTER TABLE notification_queue DROP COLUMN IF EXISTS source_kind;")
    op.execute("ALTER TABLE notification_queue ALTER COLUMN alert_event_id SET NOT NULL;")

    op.execute("ALTER TABLE notifications DROP COLUMN IF EXISTS source_kind;")
    op.execute("ALTER TABLE notifications ALTER COLUMN alert_event_id SET NOT NULL;")
