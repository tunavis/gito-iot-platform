"""Unit tests for the subscription write-service guard logic (no DB).

The guard branches (already-subscribed, trial-used, no-live-sub, same-plan,
already-canceling) are deterministic decision logic and tested here with a fake
session. Happy-path inserts/updates are covered by the live end-to-end check.
"""

import os

os.environ.setdefault("DATABASE_URL", "postgresql+asyncpg://test:test@localhost:5432/test")
os.environ.setdefault("JWT_SECRET_KEY", "test-secret-key-for-unit-tests-only-32ch")
os.environ.setdefault("MQTT_PASSWORD", "test-mqtt-password")

from uuid import uuid4

import pytest

from app.services import subscriptions as subs
from app.services.subscriptions import SubscriptionError


class _R:
    """A fake result: configure what mappings().first() / first() / scalar_one() return."""
    def __init__(self, mapping=None, first=None, scalar=None):
        self._mapping, self._first, self._scalar = mapping, first, scalar
    def mappings(self):
        return self
    def first(self):
        return self._mapping if self._mapping is not None else self._first
    def scalar_one(self):
        return self._scalar


class _FakeSession:
    def __init__(self, *results):
        self._q = list(results)
        self.commits = 0
    async def execute(self, sql, params=None):
        return self._q.pop(0) if self._q else _R()
    async def commit(self):
        self.commits += 1


LIVE = {"id": uuid4(), "plan_id": uuid4(), "status": "active", "cancel_at_period_end": False}


class TestStartTrialGuards:
    @pytest.mark.asyncio
    async def test_blocks_when_already_subscribed(self):
        session = _FakeSession(_R(mapping=LIVE))  # _live_subscription → a row
        with pytest.raises(SubscriptionError) as e:
            await subs.start_trial(session, None, uuid4(), plan_code="starter", actor="t")
        assert e.value.status_code == 409
        assert "already has an active subscription" in e.value.detail

    @pytest.mark.asyncio
    async def test_blocks_when_trial_already_used(self):
        # no live sub, but a prior 'trialing' event exists
        session = _FakeSession(_R(mapping=None), _R(first=(1,)))
        with pytest.raises(SubscriptionError) as e:
            await subs.start_trial(session, None, uuid4(), plan_code="starter", actor="t")
        assert e.value.status_code == 409
        assert "trial has already been used" in e.value.detail


class TestChangePlanGuards:
    @pytest.mark.asyncio
    async def test_no_live_subscription_404(self):
        session = _FakeSession(_R(mapping=None))
        with pytest.raises(SubscriptionError) as e:
            await subs.change_plan(session, None, uuid4(), plan_code="professional", actor="t")
        assert e.value.status_code == 404

    @pytest.mark.asyncio
    async def test_same_plan_rejected(self):
        same = uuid4()
        live = {"id": uuid4(), "plan_id": same, "status": "active", "cancel_at_period_end": False}
        # _live_subscription → live; _plan → same id
        session = _FakeSession(_R(mapping=live), _R(mapping={"id": same, "code": "professional", "trial_days": 0}))
        with pytest.raises(SubscriptionError) as e:
            await subs.change_plan(session, None, uuid4(), plan_code="professional", actor="t")
        assert "Already on that plan" in e.value.detail


class TestCancelResumeGuards:
    @pytest.mark.asyncio
    async def test_cancel_no_live_404(self):
        with pytest.raises(SubscriptionError) as e:
            await subs.cancel(_FakeSession(_R(mapping=None)), None, uuid4(), actor="t")
        assert e.value.status_code == 404

    @pytest.mark.asyncio
    async def test_cancel_already_scheduled(self):
        live = {**LIVE, "cancel_at_period_end": True}
        with pytest.raises(SubscriptionError) as e:
            await subs.cancel(_FakeSession(_R(mapping=live)), None, uuid4(), actor="t")
        assert "already set to cancel" in e.value.detail

    @pytest.mark.asyncio
    async def test_resume_when_not_canceling(self):
        live = {**LIVE, "cancel_at_period_end": False}
        with pytest.raises(SubscriptionError) as e:
            await subs.resume(_FakeSession(_R(mapping=live)), None, uuid4(), actor="t")
        assert "not scheduled to cancel" in e.value.detail

    @pytest.mark.asyncio
    async def test_resume_no_live_404(self):
        with pytest.raises(SubscriptionError) as e:
            await subs.resume(_FakeSession(_R(mapping=None)), None, uuid4(), actor="t")
        assert e.value.status_code == 404
