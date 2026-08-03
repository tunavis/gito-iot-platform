"""Where a downlink goes, and the one rule that makes it safe.

Uplinks have been multi-instance since the integrations table existed — the
processor runs a bridge per `chirpstack_mqtt` row. Dispatch was not: it read a
device attribute, then one global `CHIRPSTACK_API_URL`. A fleet on two network
servers had no way to say which device was on which, so half of them would have
had their commands posted to the wrong queue and reported `sent`.

**The rule: an explicit binding never falls back.**

    binding    integration state                    outcome
    ---------  -----------------------------------  --------------------------
    set        active, has url + credential         dispatch to it
    set        missing / inactive / not configured   REFUSE, with the reason
    null       —                                    the pre-binding order

The middle row is the whole point. Falling back to a platform-wide default when
a binding exists but cannot be used would send the command to *a* network
server — the wrong one — which is precisely the defect this exists to remove. It
refuses the same way an unrecognised protocol now refuses.

Null keeps today's behaviour, exactly as a null `device_types.driver` does.
Nothing already working changes, and nothing is forced to migrate.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Optional
from uuid import UUID

from sqlalchemy import select

from app.config import get_settings
from app.models.base import Device, Integration

logger = logging.getLogger(__name__)
settings = get_settings()


class NetworkServerCannotReceive(RuntimeError):
    """This device's network server accepts no downlinks, by declaration.

    Separate from `NetworkServerUnresolved` because it is not a fault to fix —
    it is the answer. The caller refuses the command at issue instead of
    queueing one that would expire and be recorded as the device's silence.
    """


class NetworkServerUnresolved(RuntimeError):
    """This device's network server could not be determined, so nothing was sent.

    Carries the reason an operator needs: "which server" is not a detail they
    can infer from a timeout.
    """


# How a downlink reaches a network server. Declared on the integration, never
# inferred from how that server's uplinks arrive — the two directions are
# independent, and guessing is right for the client in front of us and wrong for
# the next one.
MODE_MQTT = "mqtt"    # publish to the broker in config, .../command/down
MODE_REST = "rest"    # POST to downlink_api_url
MODE_NONE = "none"    # this server accepts no downlinks at all
DOWNLINK_MODES = frozenset({MODE_MQTT, MODE_REST, MODE_NONE})


@dataclass(frozen=True)
class NetworkServer:
    """How to reach a device's network server, and with what."""

    mode: str
    # Where this came from, so a log line or a failure message can say whether a
    # command went out on a binding or on the legacy fallback. Without it,
    # "it worked" does not distinguish the two, and the fallback quietly becomes
    # permanent.
    source: str
    integration_id: Optional[UUID] = None
    api_url: Optional[str] = None   # rest only
    api_key: Optional[str] = None   # rest token, or an mqtt password


async def resolve(session, device: Device) -> NetworkServer:
    """The network server for this device, or raise saying why not.

    `session` is any live session; the caller has already established tenancy.
    The integration is re-read rather than trusted from a relationship load so
    that a disabled or deleted server is caught at dispatch time, not at
    whenever the device happened to be fetched.
    """
    if device.integration_id is not None:
        return await _from_binding(session, device)
    return _from_legacy(device)


async def _from_binding(session, device: Device) -> NetworkServer:
    integration = (
        await session.execute(
            select(Integration).where(
                Integration.id == device.integration_id,
                # Tenant-scoped explicitly. RLS is inert under the app's database
                # role, so this is the check, not a second line of defence.
                Integration.tenant_id == device.tenant_id,
            )
        )
    ).scalar_one_or_none()

    mode = integration.downlink_mode if integration is not None else None

    if integration is None:
        raise NetworkServerUnresolved(
            f"Device names network server {device.integration_id}, which does not exist "
            f"in this tenant. Nothing was sent — dispatching to a platform default "
            f"would reach the wrong server."
        )
    if not integration.is_active:
        raise NetworkServerUnresolved(
            f"Network server {integration.name!r} is disabled. Nothing was sent."
        )
    if mode is None:
        raise NetworkServerUnresolved(
            f"Network server {integration.name!r} has no downlink mode configured. "
            f"Its uplink bridge can be working while this is unset — receiving from "
            f"a server and sending to it are independent."
        )
    if mode == MODE_NONE:
        # A real configuration, not a misconfiguration: a client who forwards
        # uplinks to us and grants nothing back. Said plainly here so the caller
        # can refuse at issue rather than letting the command expire and blame
        # the meter.
        raise NetworkServerCannotReceive(
            f"Network server {integration.name!r} accepts no downlinks. This device "
            f"can be read but not commanded."
        )
    if mode == MODE_REST and not integration.downlink_api_url:
        raise NetworkServerUnresolved(
            f"Network server {integration.name!r} is set to {MODE_REST!r} but has no "
            f"downlink API URL configured."
        )
    if mode == MODE_MQTT and not (integration.config or {}).get("broker_url"):
        raise NetworkServerUnresolved(
            f"Network server {integration.name!r} is set to {MODE_MQTT!r} but its "
            f"config names no broker."
        )
    if mode not in DOWNLINK_MODES:
        raise NetworkServerUnresolved(
            f"Network server {integration.name!r} declares downlink mode {mode!r}, "
            f"which this platform cannot perform."
        )

    return NetworkServer(
        mode=mode,
        source=f"integration:{integration.name}",
        integration_id=integration.id,
        api_url=integration.downlink_api_url,
        api_key=integration.downlink_api_key,
    )


def _from_legacy(device: Device) -> NetworkServer:
    """The pre-binding order, unchanged: device attributes, then the setting.

    Kept so a single-server deployment that never binds anything keeps working.
    It is a fallback for the *unbound*, never a rescue for a binding that failed.
    """
    attrs = device.attributes or {}
    api_url = attrs.get("chirpstack_server") or settings.CHIRPSTACK_API_URL
    api_key = attrs.get("chirpstack_api_key") or settings.CHIRPSTACK_API_KEY

    if not api_url or not api_key:
        raise NetworkServerUnresolved(
            "ChirpStack not configured for this device. It names no network server, "
            "and there is no platform-wide endpoint to fall back to. Bind it to an "
            "integration."
        )

    # The pre-binding path always spoke REST, so that is what it keeps doing.
    source = "device_attributes" if attrs.get("chirpstack_server") else "platform_setting"
    if source == "device_attributes":
        logger.warning(
            "device_credential_in_attributes",
            extra={
                "device_id": str(device.id),
                "detail": (
                    "This device carries its own ChirpStack credential in `attributes`, "
                    "which is unencrypted JSONB. Bind it to an integration instead."
                ),
            },
        )
    return NetworkServer(mode=MODE_REST, source=source, api_url=api_url, api_key=api_key)
