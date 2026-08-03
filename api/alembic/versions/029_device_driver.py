# api/alembic/versions/029_device_driver.py
"""Device driver declaration on device_types, plus the honest terminal state.

Phase 1 of the driver model (openspec/changes/add-device-driver-model).

Two additive changes:

(a) `device_types.driver` (JSONB, **nullable**). Nullable is the compatibility
    guarantee, not an oversight: absent means precisely today's behaviour, so
    the live fleet decodes and dispatches exactly as it did until someone
    writes a driver for its type.

(b) `delivered_unconfirmed` joins the command status vocabulary. Some commands
    can never be acknowledged — a B METERS IWM `RESET` resets the
    microcontroller and answers nothing; an RFM `0x03 0x05` re-joins with
    factory defaults — so a correctly delivered command was being swept to
    `timed_out`. The sweep only touches pending/sent/delivered, so the new
    status is terminal by construction rather than by a second exclusion list.

Revision ID: 029_device_driver
Revises: 028_command_rejection_and_reason
Create Date: 2026-08-01
"""
from typing import Sequence, Union

from alembic import op

revision: str = "029_device_driver"
down_revision: Union[str, None] = "028_command_rejection_and_reason"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_STATUSES_BEFORE = (
    "'pending', 'sent', 'delivered', 'executed', 'failed', "
    "'timed_out', 'awaiting_approval', 'rejected'"
)
_STATUSES_AFTER = f"{_STATUSES_BEFORE}, 'delivered_unconfirmed'"


def upgrade() -> None:
    op.execute("ALTER TABLE device_types ADD COLUMN IF NOT EXISTS driver JSONB DEFAULT NULL;")
    op.execute(
        """
        COMMENT ON COLUMN device_types.driver IS
            'How the platform speaks to this device type: transport binding, '
            'downlink encoding, acknowledgement semantics and timing. NULL means '
            'the pre-driver behaviour, which is the compatibility guarantee. See '
            'payload_codec.driver for the schema.';
        """
    )

    # 'delivered_unconfirmed' is 21 characters and the column was VARCHAR(20),
    # so the CHECK constraint would have permitted a value the column could not
    # hold — an insert failing on data length while every unit test passed,
    # because a status set on an unattached model never meets the column type.
    # Widening a varchar is metadata-only in Postgres; there is no table rewrite.
    op.execute("ALTER TABLE device_commands ALTER COLUMN status TYPE VARCHAR(32);")

    op.drop_constraint("valid_command_status", "device_commands", type_="check")
    op.create_check_constraint(
        "valid_command_status", "device_commands", f"status IN ({_STATUSES_AFTER})"
    )


def downgrade() -> None:
    # `delivered_unconfirmed` means the command reached the device and the device
    # cannot answer. Rolling back must not rewrite that into `timed_out`, which
    # asserts the opposite; `executed` would over-claim. `delivered` is the
    # closest pre-existing state that stays true, and the reason is kept.
    op.execute(
        """
        UPDATE device_commands
        SET status = 'delivered',
            error_message = COALESCE(
                error_message,
                'delivered; this device type cannot acknowledge this command'
            )
        WHERE status = 'delivered_unconfirmed'
        """
    )
    op.drop_constraint("valid_command_status", "device_commands", type_="check")
    op.create_check_constraint(
        "valid_command_status", "device_commands", f"status IN ({_STATUSES_BEFORE})"
    )
    # Safe only because the UPDATE above has already shortened every value that
    # needed the extra width.
    op.execute("ALTER TABLE device_commands ALTER COLUMN status TYPE VARCHAR(20);")

    op.execute("ALTER TABLE device_types DROP COLUMN IF EXISTS driver;")
