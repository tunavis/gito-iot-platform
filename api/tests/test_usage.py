"""Unit tests for the usage service's routing and guards (no DB needed)."""

import os

os.environ.setdefault("DATABASE_URL", "postgresql+asyncpg://test:test@localhost:5432/test")
os.environ.setdefault("JWT_SECRET_KEY", "test-secret-key-for-unit-tests-only-32ch")
os.environ.setdefault("MQTT_PASSWORD", "test-mqtt-password")

import pytest

from app.services import usage


class _ScalarResult:
    def __init__(self, value):
        self._value = value

    def scalar(self):
        return self._value


class _FakeSession:
    def __init__(self, scalar_value=0):
        self._value = scalar_value
        self.executed = []

    async def execute(self, sql, params=None):
        self.executed.append((str(sql), params))
        return _ScalarResult(self._value)


class TestCurrent:
    @pytest.mark.asyncio
    async def test_live_count_metric_returns_int(self):
        session = _FakeSession(scalar_value=42)
        assert await usage.current(session, "t1", "devices.max") == 42

    @pytest.mark.asyncio
    async def test_null_scalar_becomes_zero(self):
        session = _FakeSession(scalar_value=None)
        assert await usage.current(session, "t1", "devices.max") == 0

    @pytest.mark.asyncio
    async def test_period_metric_reads_counter(self):
        session = _FakeSession(scalar_value=1234)
        assert await usage.current(session, "t1", "api.requests_per_day") == 1234
        # the query it ran was against usage_counters
        assert "usage_counters" in session.executed[0][0]

    @pytest.mark.asyncio
    async def test_unknown_metric_raises(self):
        with pytest.raises(ValueError):
            await usage.current(_FakeSession(), "t1", "bogus.metric")


class TestIncrement:
    @pytest.mark.asyncio
    async def test_increment_rejects_non_period_metric(self):
        # devices.max is a live count, not something you increment.
        with pytest.raises(ValueError):
            await usage.increment(_FakeSession(), "t1", "devices.max")

    @pytest.mark.asyncio
    async def test_increment_period_metric_upserts(self):
        session = _FakeSession()
        await usage.increment(session, "t1", "notifications.per_month", amount=3)
        sql = session.executed[0][0]
        assert "ON CONFLICT" in sql and "usage_counters" in sql


class TestIsMetered:
    def test_known_live_and_period_metrics(self):
        assert usage.is_metered("devices.max")
        assert usage.is_metered("api.requests_per_day")

    def test_unknown_metric_not_metered(self):
        assert not usage.is_metered("nonsense")
