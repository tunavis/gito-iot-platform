# api/alembic/versions/030_command_opcode_correlation.py
"""The correlation key a third-party device actually echoes: (device, opcode).

Phase 2 of the driver model (openspec/changes/add-device-driver-model).

No third-party device echoes this platform's `command_id`. A B METERS IWM
answers with the same `Fct` byte it was sent; an RFM-LR1 answers with the same
`Index`. So an answer can only be matched to a command by **(device, opcode)** —
and that is unambiguous only if at most one command per pair is in flight.

`opcode` is nullable, and NULL for every command whose device type declares no
driver or no correlation. The partial unique index therefore constrains exactly
the commands that need it and nothing else, which is what keeps today's fleet
behaving as it does.

The constraint is an index rather than a check in the router on purpose. Two
dispatches arriving together would both read "nothing outstanding" and both
insert, which is precisely the race the approval gate already needed a row lock
for — and here the consequence is an answer credited to the wrong command.

Revision ID: 030_command_opcode_correlation
Revises: 029_device_driver
Create Date: 2026-08-02
"""
from typing import Sequence, Union

from alembic import op

revision: str = "030_command_opcode_correlation"
down_revision: Union[str, None] = "029_device_driver"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# The statuses in which a command is still waiting for its device to answer.
# Deliberately the same set the timeout sweep acts on: a command the sweep would
# still expire is a command whose opcode is still reserved.
_IN_FLIGHT = "'pending', 'sent', 'delivered'"


def upgrade() -> None:
    op.execute("ALTER TABLE device_commands ADD COLUMN IF NOT EXISTS opcode SMALLINT;")
    op.execute(
        """
        COMMENT ON COLUMN device_commands.opcode IS
            'The byte this command''s device will echo when it answers, taken from '
            'the device type driver''s acknowledgement.opcode_field. NULL when the '
            'device type declares no driver or no correlation, which is the '
            'pre-driver behaviour.';
        """
    )
    op.execute(
        f"""
        CREATE UNIQUE INDEX IF NOT EXISTS uq_device_commands_inflight_opcode
            ON device_commands (device_id, opcode)
            WHERE opcode IS NOT NULL AND status IN ({_IN_FLIGHT});
        """
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS uq_device_commands_inflight_opcode;")
    op.execute("ALTER TABLE device_commands DROP COLUMN IF EXISTS opcode;")
