"""Shared 'is this device effectively offline' logic.

Stored `devices.status` can lag reality by up to 5 minutes (only
NotificationBackgroundTasks.detect_offline_devices, ticking every 5 min,
flips it to 'offline'). Anything reading device status for display —
DeviceResponse, analytics/fleet-overview, analytics/uptime — needs to
independently compute the *effective* status from last_seen instead of
trusting the stored column. This used to be reimplemented separately in
each place, and had silently diverged: one copy treated a device that has
never reported (`last_seen IS NULL`) as offline, another treated it as
online. This module is the one place that decides it.
"""

import os
# timezone.utc, not datetime.UTC: the latter is 3.11+, which silently made this
# module (and every test that imports it) unimportable on Python 3.10 hosts.
from datetime import datetime, timezone
from uuid import UUID

UTC = timezone.utc

from sqlalchemy import text

from app.database import RLSSession

DEFAULT_OFFLINE_THRESHOLD_SECONDS = 900  # 15 minutes

# How long the ENTIRE fleet may be silent before that means the ingest path
# itself is broken rather than the devices being quiet.
INGESTION_STALL_THRESHOLD_SECONDS = int(
    os.getenv("INGESTION_STALL_THRESHOLD_SECONDS", "900")
)


def is_effectively_offline(status: str, last_seen: datetime | None, threshold_seconds: int) -> bool:
    """True if this device should show as offline right now.

    online/offline are derived purely from last_seen vs threshold — this can both
    downgrade a stale 'online' row AND upgrade a stale 'offline' row, since the
    stored column only self-corrects to 'online' on the next ingested uplink and
    otherwise lags reality (e.g. right after an operator raises a device type's
    threshold for a slow-reporting device, the stored row is still 'offline' from
    before). idle/error/provisioning are intentional operator states and are
    never overridden here.
    """
    if status not in ("online", "offline"):
        return False
    if last_seen is None:
        return True  # never reported — not actually online
    last = last_seen if last_seen.tzinfo else last_seen.replace(tzinfo=UTC)
    return (datetime.now(UTC) - last).total_seconds() > threshold_seconds


async def check_ingestion_stall(session: RLSSession) -> dict:
    """Platform-wide 'is telemetry still arriving at all?' check.

    Per-device offline detection structurally cannot see this. When the ingest
    path itself dies, every device goes offline *correctly* and the only trace
    is one INFO line from detect_offline_devices — which is exactly how a
    dropped MQTT subscription ate 43h of telemetry, all 68 devices, unnoticed.

    Reads max(devices.last_seen) (bumped by every ingest path, and covered by
    idx_devices_last_seen) rather than max(telemetry.ts): same signal, tens of
    rows instead of a scan over the whole telemetry history. Deliberately
    crosses tenants — a stall is a platform fault, not a tenant's — so never
    return the raw age to an unauthenticated caller.

    Returns {"status": "ok" | "idle" | "stalled", "last_uplink_age_seconds", "detail"}.
      idle    — no device has ever reported: a fresh deployment, not a fault.
      stalled — devices have reported before and the fleet is now silent past
                the threshold. Stays 'stalled' however long it lasts; there is
                no window after which a dead pipeline stops being a problem.
    """
    newest = (await session.execute(text("SELECT max(last_seen) FROM devices"))).scalar()
    if newest is None:
        return {
            "status": "idle",
            "last_uplink_age_seconds": None,
            "detail": "no device has ever reported",
        }

    last = newest if newest.tzinfo else newest.replace(tzinfo=UTC)
    age = int((datetime.now(UTC) - last).total_seconds())
    if age <= INGESTION_STALL_THRESHOLD_SECONDS:
        return {"status": "ok", "last_uplink_age_seconds": age, "detail": None}
    return {
        "status": "stalled",
        "last_uplink_age_seconds": age,
        "detail": (
            f"no device has reported in {age}s "
            f"(threshold {INGESTION_STALL_THRESHOLD_SECONDS}s)"
        ),
    }


async def fetch_offline_thresholds(
    session: RLSSession,
    device_type_ids: list[UUID | str],
) -> dict[str, int]:
    """Batch-fetch offline_threshold from device_types.default_settings for a set of type IDs.

    Returns {device_type_id_str: threshold_seconds}, omitting types with no
    configured threshold — callers should fall back to
    DEFAULT_OFFLINE_THRESHOLD_SECONDS for those.
    """
    if not device_type_ids:
        return {}
    placeholders = ", ".join(f":id{i}" for i in range(len(device_type_ids)))
    params = {f"id{i}": str(uid) for i, uid in enumerate(device_type_ids)}
    result = await session.execute(
        text(
            f"SELECT id::text, (default_settings->>'offline_threshold')::int "
            f"FROM device_types WHERE id::text IN ({placeholders}) "
            f"AND default_settings->>'offline_threshold' IS NOT NULL"
        ),
        params,
    )
    return {row[0]: row[1] for row in result}
