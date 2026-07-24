"""Unit tests for the entitlement resolution logic.

The DB query in resolve() is exercised by integration coverage later; here we test
the pure decision logic (allows/limit/within_limit), the free-tier fallback, and
the cache round-trip — all without a database, using a fake session and a fake
redis, so these run anywhere.
"""

import os

os.environ.setdefault("DATABASE_URL", "postgresql+asyncpg://test:test@localhost:5432/test")
os.environ.setdefault("JWT_SECRET_KEY", "test-secret-key-for-unit-tests-only-32ch")
os.environ.setdefault("MQTT_PASSWORD", "test-mqtt-password")

import json

import pytest

from app.services.entitlements import Entitlements, resolve, invalidate, CACHE_PREFIX


# ── Pure decision logic ──────────────────────────────────────────────────────

class TestEntitlementDecisions:
    def _ent(self, **features):
        return Entitlements(tenant_id="t1", plan_code="starter", status="active", features=features)

    def test_boolean_allows(self):
        ent = self._ent(**{"analytics.advanced": True, "ai.enabled": False})
        assert ent.allows("analytics.advanced") is True
        assert ent.allows("ai.enabled") is False

    def test_missing_boolean_denies(self):
        assert self._ent().allows("reporting.enabled") is False

    def test_finite_limit(self):
        assert self._ent(**{"devices.max": 50}).limit("devices.max") == 50

    def test_null_limit_is_unlimited(self):
        assert self._ent(**{"devices.max": None}).limit("devices.max") is None

    def test_missing_limit_denies_with_zero(self):
        # A limit key absent from the matrix must be conservative, not unlimited.
        assert self._ent().limit("devices.max") == 0

    def test_within_limit_boundary(self):
        ent = self._ent(**{"devices.max": 5})
        assert ent.within_limit("devices.max", 4) is True    # room for one more
        assert ent.within_limit("devices.max", 5) is False   # at cap → blocked
        assert ent.within_limit("devices.max", 6) is False

    def test_within_limit_unlimited_always_true(self):
        ent = self._ent(**{"devices.max": None})
        assert ent.within_limit("devices.max", 10_000_000) is True

    def test_within_missing_limit_blocks_immediately(self):
        # missing → cap 0 → even zero usage is not "within"
        assert self._ent().within_limit("devices.max", 0) is False

    def test_enum_option(self):
        assert self._ent(**{"support.level": "priority"}).option("support.level") == "priority"
        assert self._ent().option("support.level") is None

    def test_roundtrip_dict(self):
        ent = self._ent(**{"devices.max": 50, "ai.enabled": False})
        assert Entitlements.from_dict(ent.to_dict()) == ent


# ── Fakes for resolve() ───────────────────────────────────────────────────────

class _FakeResult:
    def __init__(self, rows):
        self._rows = rows

    def mappings(self):
        return self

    def all(self):
        return self._rows


class _FakeSession:
    """Returns queued result sets in call order."""
    def __init__(self, *result_sets):
        self._queue = list(result_sets)
        self.calls = 0

    async def execute(self, _sql, _params=None):
        self.calls += 1
        return _FakeResult(self._queue.pop(0) if self._queue else [])


class _FakeRedis:
    def __init__(self):
        self.store = {}
    async def get(self, k):
        return self.store.get(k)
    async def set(self, k, v, ex=None):
        self.store[k] = v
    async def delete(self, k):
        self.store.pop(k, None)


# ── resolve() behaviour ───────────────────────────────────────────────────────

class TestResolve:
    @pytest.mark.asyncio
    async def test_live_subscription_resolves_plan_features(self):
        rows = [
            {"plan_code": "professional", "status": "active", "trial_ends_at": None,
             "current_period_end": None, "grace_until": None,
             "feature_key": "devices.max", "value": 500},
            {"plan_code": "professional", "status": "active", "trial_ends_at": None,
             "current_period_end": None, "grace_until": None,
             "feature_key": "analytics.advanced", "value": True},
        ]
        session = _FakeSession(rows)
        ent = await resolve(session, "tenant-1", redis=None)
        assert ent.plan_code == "professional"
        assert ent.status == "active"
        assert ent.limit("devices.max") == 500
        assert ent.allows("analytics.advanced") is True

    @pytest.mark.asyncio
    async def test_no_subscription_falls_back_to_free(self):
        # First query (live sub) returns nothing, second (free plan) returns features.
        free_rows = [{"feature_key": "devices.max", "value": 5}]
        session = _FakeSession([], free_rows)
        ent = await resolve(session, "tenant-1", redis=None)
        assert ent.plan_code == "free"
        assert ent.status == "none"
        assert ent.limit("devices.max") == 5
        assert session.calls == 2  # fell through to the free-plan query

    @pytest.mark.asyncio
    async def test_double_encoded_json_value_is_coerced(self):
        # If a value ever comes back as a JSON string, it must be decoded.
        rows = [{"plan_code": "free", "status": "active", "trial_ends_at": None,
                 "current_period_end": None, "grace_until": None,
                 "feature_key": "support.level", "value": '"community"'}]
        ent = await resolve(_FakeSession(rows), "t", redis=None)
        assert ent.option("support.level") == "community"

    @pytest.mark.asyncio
    async def test_cache_hit_skips_db(self):
        redis = _FakeRedis()
        ent = Entitlements(tenant_id="t9", plan_code="starter", status="active",
                           features={"devices.max": 50})
        redis.store[CACHE_PREFIX + "t9"] = json.dumps(ent.to_dict())
        session = _FakeSession()  # empty — must not be queried
        got = await resolve(session, "t9", redis=redis)
        assert got.plan_code == "starter"
        assert session.calls == 0  # served entirely from cache

    @pytest.mark.asyncio
    async def test_cache_miss_populates_cache(self):
        redis = _FakeRedis()
        rows = [{"plan_code": "starter", "status": "active", "trial_ends_at": None,
                 "current_period_end": None, "grace_until": None,
                 "feature_key": "devices.max", "value": 50}]
        await resolve(_FakeSession(rows), "t5", redis=redis)
        assert CACHE_PREFIX + "t5" in redis.store  # written back

    @pytest.mark.asyncio
    async def test_invalidate_removes_cache(self):
        redis = _FakeRedis()
        redis.store[CACHE_PREFIX + "t1"] = "{}"
        await invalidate(redis, "t1")
        assert CACHE_PREFIX + "t1" not in redis.store

    @pytest.mark.asyncio
    async def test_redis_none_degrades_to_db(self):
        rows = [{"plan_code": "free", "status": "active", "trial_ends_at": None,
                 "current_period_end": None, "grace_until": None,
                 "feature_key": "devices.max", "value": 5}]
        ent = await resolve(_FakeSession(rows), "t", redis=None)
        assert ent.limit("devices.max") == 5
