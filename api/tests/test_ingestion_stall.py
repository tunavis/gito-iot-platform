"""Fleet-wide ingestion-stall detection.

Regression context: the processor's MQTT subscription died and ingestion stopped
for 43 hours. detect_offline_devices did its job — it flipped all 68 devices to
offline and logged one INFO line — but nothing anywhere said "the pipeline is
dead", so the outage was only found by hand-tracing the broker log.
"""

from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock, MagicMock

import pytest

from app.services.device_status import (
    INGESTION_STALL_THRESHOLD_SECONDS,
    check_ingestion_stall,
)


def _session(newest):
    """Session whose `SELECT max(last_seen) FROM devices` returns `newest`."""
    result = MagicMock()
    result.scalar = MagicMock(return_value=newest)
    session = MagicMock()
    session.execute = AsyncMock(return_value=result)
    return session


@pytest.mark.asyncio
async def test_recent_uplink_is_ok():
    newest = datetime.now(timezone.utc) - timedelta(seconds=30)
    assert (await check_ingestion_stall(_session(newest)))["status"] == "ok"


@pytest.mark.asyncio
async def test_fleet_silent_past_threshold_is_stalled():
    newest = datetime.now(timezone.utc) - timedelta(seconds=INGESTION_STALL_THRESHOLD_SECONDS + 60)
    out = await check_ingestion_stall(_session(newest))
    assert out["status"] == "stalled"
    assert out["last_uplink_age_seconds"] >= INGESTION_STALL_THRESHOLD_SECONDS


@pytest.mark.asyncio
async def test_the_actual_43h_outage_is_detected():
    newest = datetime.now(timezone.utc) - timedelta(hours=43)
    out = await check_ingestion_stall(_session(newest))
    assert out["status"] == "stalled", "the outage this check exists for reads as healthy"


@pytest.mark.asyncio
async def test_long_outage_never_decays_back_to_idle():
    """A dead pipeline does not stop being a problem because it's been dead a while."""
    newest = datetime.now(timezone.utc) - timedelta(days=30)
    assert (await check_ingestion_stall(_session(newest)))["status"] == "stalled"


@pytest.mark.asyncio
async def test_never_reported_is_idle_not_stalled():
    """Fresh deployment: no device has ever sent anything. Not a fault."""
    out = await check_ingestion_stall(_session(None))
    assert out["status"] == "idle"
    assert out["last_uplink_age_seconds"] is None


@pytest.mark.asyncio
async def test_naive_timestamp_from_db_does_not_crash():
    """last_seen loaded from Postgres may come back tz-naive."""
    newest = (datetime.now(timezone.utc) - timedelta(seconds=30)).replace(tzinfo=None)
    assert (await check_ingestion_stall(_session(newest)))["status"] == "ok"
