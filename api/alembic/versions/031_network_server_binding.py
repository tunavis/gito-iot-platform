# api/alembic/versions/031_network_server_binding.py
"""Bind a device to the network server it is actually reached through.

Phase 2 of bind-downlinks-to-their-network-server.

Uplinks are already multi-instance: `integrations` holds one `chirpstack_mqtt`
row per network server and the processor runs a bridge per row. Dispatch is not
— it reads a device attribute or one global `CHIRPSTACK_API_URL`, so a fleet
spread across two servers has no way to say which is which, and a command
reports `sent` having gone somewhere the device is not.

Three additive columns, nothing backfilled:

(a) `devices.integration_id` — nullable FK, `ON DELETE SET NULL`. Nullable **is**
    the compatibility guarantee: absent means precisely today's resolution
    order, so no existing device changes behaviour. SET NULL and not CASCADE
    because deleting an integration must not delete meters.

(b) `integrations.downlink_mode` — **an explicit discriminator**, `mqtt` |
    `rest` | `none`, never inferred from how that server's uplinks arrive. The
    two directions are independent: this client forwards uplinks over MQTT and
    accepts downlinks on the same broker, needing no API token at all; another
    will push uplinks over HTTP and accept downlinks only through the network
    server's REST API; a third can send to us and receive nothing.

    `none` is a first-class answer, not an absence. Without it, a command to a
    receive-only server queues, waits out its full response window — up to
    twelve hours for a B METERS IWM — and is recorded `timed_out`, asserting the
    device stayed silent when it was never addressable.

(c) `integrations.downlink_api_url` — the REST base URL, for `rest` mode only.
    MQTT mode reuses the broker already in `config`; ChirpStack's API is a
    different host and port from its broker, which is why this cannot live there.

(d) `integrations.downlink_api_key` — the outbound credential, encrypted. Needed
    by both modes: a REST Bearer token, or an MQTT password or client
    certificate the moment a client's broker is not anonymous.

    A real column rather than a key inside `config` **so that the column type can
    enforce it**: `EncryptedString` encrypts on write, and there is no write path
    that can forget. A JSONB key cannot carry that guarantee.
    `integrations.key_hash` is unrelated — it is a SHA of an *inbound* key issued
    to an external caller, and cannot authenticate an outbound call.

Revision ID: 031_network_server_binding
Revises: 030_command_opcode_correlation
Create Date: 2026-08-03
"""
from typing import Sequence, Union

from alembic import op

revision: str = "031_network_server_binding"
down_revision: Union[str, None] = "030_command_opcode_correlation"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute(
        """
        ALTER TABLE devices
            ADD COLUMN IF NOT EXISTS integration_id UUID
            REFERENCES integrations(id) ON DELETE SET NULL;
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_devices_integration
            ON devices (integration_id) WHERE integration_id IS NOT NULL;
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN devices.integration_id IS
            'The network server this device is reached through, for downlinks. '
            'NULL means the pre-binding resolution order (device attributes, then '
            'the platform-wide setting), which is the compatibility guarantee. '
            'A device that names an integration NEVER falls back — see '
            'app/services/network_server.py.';
        """
    )

    op.execute("ALTER TABLE integrations ADD COLUMN IF NOT EXISTS downlink_mode VARCHAR(20);")
    op.execute("ALTER TABLE integrations ADD COLUMN IF NOT EXISTS downlink_api_url TEXT;")
    op.execute("ALTER TABLE integrations ADD COLUMN IF NOT EXISTS downlink_api_key TEXT;")

    # NULL is permitted and means "not configured for downlinks yet" — distinct
    # from 'none', which is a deliberate statement that this server accepts none.
    # The difference matters: the first is an omission, the second is an answer.
    op.execute(
        """
        ALTER TABLE integrations DROP CONSTRAINT IF EXISTS valid_downlink_mode;
        ALTER TABLE integrations ADD CONSTRAINT valid_downlink_mode
            CHECK (downlink_mode IS NULL OR downlink_mode IN ('mqtt', 'rest', 'none'));
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN integrations.downlink_mode IS
            'How downlinks reach this network server: mqtt (publish to the broker '
            'in config, topic application/{app}/device/{eui}/command/down), rest '
            '(POST to downlink_api_url), or none (this server accepts no '
            'downlinks — commands to its devices are refused at issue). Declared, '
            'never inferred from how uplinks arrive; the two directions are '
            'independent. NULL means not yet configured.';
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN integrations.downlink_api_key IS
            'Outbound credential, encrypted at rest as enc:v1:<token> by the '
            'EncryptedString column type. Never plaintext, never returned by the '
            'API. A REST token, or an MQTT password where the broker is not '
            'anonymous. Distinct from key_hash, which is a hash of an INBOUND key.';
        """
    )


def downgrade() -> None:
    # The credential is dropped with the column. It is re-enterable by an
    # operator — this is a credential, not data — so there is nothing to
    # preserve, and keeping an orphaned encrypted blob around would be worse.
    op.execute("ALTER TABLE integrations DROP CONSTRAINT IF EXISTS valid_downlink_mode;")
    op.execute("ALTER TABLE integrations DROP COLUMN IF EXISTS downlink_api_key;")
    op.execute("ALTER TABLE integrations DROP COLUMN IF EXISTS downlink_api_url;")
    op.execute("ALTER TABLE integrations DROP COLUMN IF EXISTS downlink_mode;")
    op.execute("DROP INDEX IF EXISTS idx_devices_integration;")
    op.execute("ALTER TABLE devices DROP COLUMN IF EXISTS integration_id;")
