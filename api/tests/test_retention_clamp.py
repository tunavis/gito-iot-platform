"""Unit tests for retention clamping — a tenant can't self-grant retention beyond plan."""

import os

os.environ.setdefault("DATABASE_URL", "postgresql+asyncpg://test:test@localhost:5432/test")
os.environ.setdefault("JWT_SECRET_KEY", "test-secret-key-for-unit-tests-only-32ch")
os.environ.setdefault("MQTT_PASSWORD", "test-mqtt-password")

from app.services.background_tasks import _effective_retention_days


class TestEffectiveRetention:
    def test_no_pref_no_plan_defaults_to_90(self):
        assert _effective_retention_days(None, None) == 90

    def test_pref_within_plan_is_honored(self):
        assert _effective_retention_days(30, 90) == 30

    def test_pref_above_plan_is_clamped(self):
        # a Starter tenant (cap 90) can't keep 365 days
        assert _effective_retention_days(365, 90) == 90

    def test_unlimited_plan_honors_pref(self):
        assert _effective_retention_days(500, None) == 500

    def test_free_tenant_without_pref_gets_plan_cap(self):
        # no preference set, free plan caps at 7 → 7, not the 90 default
        assert _effective_retention_days(None, 7) == 7

    def test_floor_prevents_total_wipe(self):
        assert _effective_retention_days(0, 0) == 1
        assert _effective_retention_days(-5, None) == 1
