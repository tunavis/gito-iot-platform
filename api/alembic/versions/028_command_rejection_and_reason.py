# api/alembic/versions/028_command_rejection_and_reason.py
"""Rejection as a decision, and the reason an agent gave for asking.

Completes the approval gate `027` opened. That migration could record that a
command was waiting and that someone approved it; it had no way to record that
someone *refused*, so a refused request and a forgotten one were the same row.

`rejected` joins `awaiting_approval` as a value on the existing `status` column
for the same reason: every existing reader filters on `status`, so a new value is
invisible to all of them by construction. `expire_timed_out_commands` sweeps only
`('pending','sent','delivered')`, so a rejected command is never rewritten to
`timed_out` — which would erase the fact that a person said no.

`request_reason` is a real column rather than a key inside `parameters`, because
`parameters` is the payload dispatched to the device. Folding the justification
in there would put it on the wire to a water meter.

`rejected_by`/`rejected_at` are their own columns rather than reusing
`approved_by`/`approved_at` as generic "decided" columns: `approved_by` holding
the person who refused reads correctly in code and wrongly in an audit export.

Strictly additive. Existing rows keep their status and get NULL — which on the
decision columns means "no decision was ever required", not "undecided".

Revision ID: 028_command_rejection_and_reason
Revises: 027_command_approvals
Create Date: 2026-07-31
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "028_command_rejection_and_reason"
down_revision: Union[str, None] = "027_command_approvals"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_STATUSES_BEFORE = (
    "'pending', 'sent', 'delivered', 'executed', 'failed', "
    "'timed_out', 'awaiting_approval'"
)
_STATUSES_AFTER = f"{_STATUSES_BEFORE}, 'rejected'"


def upgrade() -> None:
    op.add_column("device_commands", sa.Column("request_reason", sa.Text(), nullable=True))
    op.add_column(
        "device_commands",
        sa.Column(
            "rejected_by",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )
    op.add_column(
        "device_commands",
        sa.Column("rejected_at", sa.DateTime(timezone=True), nullable=True),
    )

    op.drop_constraint("valid_command_status", "device_commands", type_="check")
    op.create_check_constraint(
        "valid_command_status", "device_commands", f"status IN ({_STATUSES_AFTER})"
    )


def downgrade() -> None:
    # A refusal happened. Rolling back the feature must not rewrite that into
    # "timed out" or delete it — the row moves to `failed` with the reason
    # preserved in error_message, the same treatment 027 gives awaiting_approval.
    op.execute(
        """
        UPDATE device_commands
        SET status = 'failed',
            error_message = COALESCE(error_message, 'rejected by an operator before rollback'),
            completed_at = COALESCE(completed_at, NOW())
        WHERE status = 'rejected'
        """
    )
    op.drop_constraint("valid_command_status", "device_commands", type_="check")
    op.create_check_constraint(
        "valid_command_status", "device_commands", f"status IN ({_STATUSES_BEFORE})"
    )

    op.drop_column("device_commands", "rejected_at")
    op.drop_column("device_commands", "rejected_by")
    op.drop_column("device_commands", "request_reason")
