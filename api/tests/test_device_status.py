"""Regression test for the shared 'is this device effectively offline' logic.

This used to be reimplemented separately in DeviceResponse.compute_effective_status,
analytics.py's fleet-overview raw SQL, and analytics.py's device-uptime Python loop —
and had silently diverged: the uptime endpoint treated a device that has never
reported (last_seen IS NULL) as online, while the device list treated the same
device as offline. See app/services/device_status.py.
"""

import os

# device_status imports app.database, which builds an engine (and therefore
# Settings()) at import time; supply the required env vars so importing it
# here doesn't need a real .env.
os.environ.setdefault("DATABASE_URL", "postgresql+asyncpg://test:test@localhost:5432/test")
os.environ.setdefault("JWT_SECRET_KEY", "test-secret-key-for-unit-tests-only-32ch")
os.environ.setdefault("MQTT_PASSWORD", "test-mqtt-password")

from datetime import datetime, timedelta, timezone

from app.services.device_status import DEFAULT_OFFLINE_THRESHOLD_SECONDS, is_effectively_offline


class TestIsEffectivelyOffline:
    def test_never_reported_is_offline(self):
        # The bug: analytics.py's device-uptime used to return True (online) here.
        assert is_effectively_offline("online", None, DEFAULT_OFFLINE_THRESHOLD_SECONDS) is True

    def test_recent_last_seen_is_online(self):
        recent = datetime.now(timezone.utc) - timedelta(seconds=10)
        assert is_effectively_offline("online", recent, DEFAULT_OFFLINE_THRESHOLD_SECONDS) is False

    def test_stale_last_seen_is_offline(self):
        stale = datetime.now(timezone.utc) - timedelta(seconds=DEFAULT_OFFLINE_THRESHOLD_SECONDS + 1)
        assert is_effectively_offline("online", stale, DEFAULT_OFFLINE_THRESHOLD_SECONDS) is True

    def test_naive_datetime_treated_as_utc(self):
        # last_seen loaded from the DB may be naive; must not crash comparing to aware `now`.
        recent_naive = datetime.utcnow() - timedelta(seconds=10)
        assert is_effectively_offline("online", recent_naive, DEFAULT_OFFLINE_THRESHOLD_SECONDS) is False

    def test_non_online_status_never_overridden(self):
        # idle/error/provisioning are intentional operator states, not computed.
        for status in ("idle", "error", "provisioning", "offline"):
            assert is_effectively_offline(status, None, DEFAULT_OFFLINE_THRESHOLD_SECONDS) is False

    def test_custom_threshold_respected(self):
        last_seen = datetime.now(timezone.utc) - timedelta(seconds=30)
        assert is_effectively_offline("online", last_seen, threshold_seconds=60) is False
        assert is_effectively_offline("online", last_seen, threshold_seconds=10) is True
