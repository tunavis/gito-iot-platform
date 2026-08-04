# api/alembic/versions/032_rename_ttn_app_id.py
"""Rename `devices.ttn_app_id` to `lorawan_app_id`.

The follow-up `bind-downlinks-to-their-network-server` deferred rather than
smuggled in — its proposal lists it as an open question and its design lists it
under Non-Goals, precisely so a cross-cutting rename would not ride along inside
a change about downlink routing.

The column has never held a TTN application id in this deployment. It holds
whatever application namespace the device reports from, captured at ingest from
ChirpStack's `deviceInfo.applicationId`, and its own model comment has said
"provider-agnostic" the whole time. A name that documents its origin story
rather than its contents is a name every future reader has to be corrected
about — once by a comment, and once more when they believe the name anyway.

`lorawan_app_id` because the protocol, not the vendor, is the stable fact:
`_detect_protocol` already returns the literal `lorawan`, and a fleet can move
between ChirpStack, TTN, Helium or Actility without the column meaning anything
different.

**This is a rename, not an add-and-backfill.** Old code reading `ttn_app_id`
breaks the moment this lands, so it is not zero-downtime and must ship in one
deploy with its application change (migrate, rebuild, restart — in that order).
That is affordable deliberately: the platform is in pilot, the window for
painful schema changes is open now and closes at go-live, and the three-deploy
dual-write dance would leave a duplicate column and a "remove this later" note
that outlives everyone's memory of why.

Revision ID: 032_rename_ttn_app_id
Revises: 031_network_server_binding
Create Date: 2026-08-04
"""
from typing import Sequence, Union

from alembic import op

revision: str = "032_rename_ttn_app_id"
down_revision: Union[str, None] = "031_network_server_binding"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Guarded so the migration is re-runnable against a database where it has
    # already been applied by hand, and so it does not fail on a fresh database
    # created from db/init.sql (which now declares the new name directly).
    op.execute(
        """
        DO $$
        BEGIN
            IF EXISTS (
                SELECT 1 FROM information_schema.columns
                WHERE table_name = 'devices' AND column_name = 'ttn_app_id'
            ) AND NOT EXISTS (
                SELECT 1 FROM information_schema.columns
                WHERE table_name = 'devices' AND column_name = 'lorawan_app_id'
            ) THEN
                ALTER TABLE devices RENAME COLUMN ttn_app_id TO lorawan_app_id;
            END IF;
        END $$;
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN devices.lorawan_app_id IS
            'The application namespace this device reports from on its network '
            'server. Captured at ingest from the uplink (ChirpStack '
            'deviceInfo.applicationId) — observation wins over a hand-entered '
            'value, since the device is the authority on where it reports from. '
            'Provider-agnostic: ChirpStack, TTN, Helium and Actility all populate '
            'it. Renamed from ttn_app_id in migration 032; it never held a TTN id.';
        """
    )


def downgrade() -> None:
    # Symmetric and lossless — a rename back, never a drop. The values are
    # observed from live uplinks and are not re-derivable without waiting for
    # every device to report again, which for a B METERS IWM is twelve hours.
    op.execute(
        """
        DO $$
        BEGIN
            IF EXISTS (
                SELECT 1 FROM information_schema.columns
                WHERE table_name = 'devices' AND column_name = 'lorawan_app_id'
            ) AND NOT EXISTS (
                SELECT 1 FROM information_schema.columns
                WHERE table_name = 'devices' AND column_name = 'ttn_app_id'
            ) THEN
                ALTER TABLE devices RENAME COLUMN lorawan_app_id TO ttn_app_id;
            END IF;
        END $$;
        """
    )
