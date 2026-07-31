# api/alembic/versions/027_command_approvals.py
"""An `awaiting_approval` state for device commands, plus who asked and who agreed.

The MCP server may not actuate plant. It records a command that a person then
approves through the normal API, and the approval is what dispatches. This
migration is what makes "recorded but not sent" a state the database can hold,
rather than a convention the application remembers.

`awaiting_approval` is a new value on the existing `status` column rather than a
second `approval_status` column, deliberately:

- Every existing reader filters on `status`, so a row in the new state is
  invisible to all of them by construction. `expire_timed_out_commands` sweeps
  `('pending','sent','delivered')` — an approval request must not be swept into
  `timed_out` on the device TTL, because the clock it is waiting on is a human,
  not a radio.
- A parallel column would have made every one of those filters wrong-but-quiet:
  a row could be `status='pending'` and unapproved at the same time, and the
  dispatcher has no reason to look at a column it has never heard of.

Strictly additive. Existing rows keep their status and get NULL for all three new
columns — commands issued through the UI/REST path are ungated and stay ungated,
so a NULL `approved_by` means "never needed approval", not "unapproved".

`requested_by` is nullable for the same reason: the REST path does not record an
issuing user today, and inventing one during a migration would be a lie in an
audit column.

Revision ID: 027_command_approvals
Revises: 026_asset_registry
Create Date: 2026-07-31
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "027_command_approvals"
down_revision: Union[str, None] = "026_asset_registry"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_STATUSES_BEFORE = "'pending', 'sent', 'delivered', 'executed', 'failed', 'timed_out'"
_STATUSES_AFTER = f"{_STATUSES_BEFORE}, 'awaiting_approval'"


def upgrade() -> None:
    op.add_column(
        "device_commands",
        sa.Column(
            "requested_by",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )
    op.add_column(
        "device_commands",
        sa.Column(
            "approved_by",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )
    op.add_column(
        "device_commands",
        sa.Column("approved_at", sa.DateTime(timezone=True), nullable=True),
    )

    # SET NULL on both, not CASCADE: deleting a user must not delete the record
    # that they asked for a valve to move. The audit value is in the row.
    op.drop_constraint("valid_command_status", "device_commands", type_="check")
    op.create_check_constraint(
        "valid_command_status", "device_commands", f"status IN ({_STATUSES_AFTER})"
    )


def downgrade() -> None:
    # Any row still waiting on a human has no meaning once the state is gone, and
    # it must not be left violating the narrowed constraint. 'failed' rather than
    # a silent delete: the request happened, and the reason it never dispatched
    # is that the feature was rolled back.
    op.execute(
        """
        UPDATE device_commands
        SET status = 'failed',
            error_message = COALESCE(error_message, 'approval gate removed before approval'),
            completed_at = COALESCE(completed_at, NOW())
        WHERE status = 'awaiting_approval'
        """
    )
    op.drop_constraint("valid_command_status", "device_commands", type_="check")
    op.create_check_constraint(
        "valid_command_status", "device_commands", f"status IN ({_STATUSES_BEFORE})"
    )

    op.drop_column("device_commands", "approved_at")
    op.drop_column("device_commands", "approved_by")
    op.drop_column("device_commands", "requested_by")
