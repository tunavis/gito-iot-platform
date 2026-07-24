"""Unit tests for the billing enforcement dependencies (enforce_limit / require_feature).

resolve() and usage.current() are monkeypatched, so this tests the 402/403
decision logic in isolation — no DB, no Redis.
"""

import os

os.environ.setdefault("DATABASE_URL", "postgresql+asyncpg://test:test@localhost:5432/test")
os.environ.setdefault("JWT_SECRET_KEY", "test-secret-key-for-unit-tests-only-32ch")
os.environ.setdefault("MQTT_PASSWORD", "test-mqtt-password")

from types import SimpleNamespace
from unittest.mock import AsyncMock
from uuid import uuid4

import pytest
from fastapi import HTTPException

from app.dependencies_billing import enforce_limit, require_feature
from app.services.entitlements import Entitlements
import app.dependencies_billing as dep_mod


def _request():
    # request.app.state.redis is read via getattr(..., None)
    return SimpleNamespace(app=SimpleNamespace(state=SimpleNamespace(redis=None)))


def _session():
    s = AsyncMock()
    s.set_tenant_context = AsyncMock()
    return s


def _ent(**features):
    return Entitlements(tenant_id="t", plan_code="free", status="active", features=features)


@pytest.fixture
def tid():
    return uuid4()


class TestEnforceLimit:
    @pytest.mark.asyncio
    async def test_blocks_at_limit_with_402(self, monkeypatch, tid):
        monkeypatch.setattr(dep_mod.ent_service, "resolve", AsyncMock(return_value=_ent(**{"devices.max": 5})))
        monkeypatch.setattr(dep_mod.usage_service, "current", AsyncMock(return_value=5))  # at cap
        dep = enforce_limit("devices.max")
        with pytest.raises(HTTPException) as exc:
            await dep(tenant_id=tid, request=_request(), session=_session(), current_tenant=tid)
        assert exc.value.status_code == 402
        assert exc.value.detail["error"] == "plan_limit_reached"
        assert exc.value.detail["used"] == 5 and exc.value.detail["limit"] == 5

    @pytest.mark.asyncio
    async def test_allows_below_limit(self, monkeypatch, tid):
        monkeypatch.setattr(dep_mod.ent_service, "resolve", AsyncMock(return_value=_ent(**{"devices.max": 5})))
        monkeypatch.setattr(dep_mod.usage_service, "current", AsyncMock(return_value=4))  # room for one
        dep = enforce_limit("devices.max")
        assert await dep(tenant_id=tid, request=_request(), session=_session(), current_tenant=tid) is None

    @pytest.mark.asyncio
    async def test_unlimited_passes_without_counting(self, monkeypatch, tid):
        monkeypatch.setattr(dep_mod.ent_service, "resolve", AsyncMock(return_value=_ent(**{"devices.max": None})))
        counted = AsyncMock(return_value=10_000)
        monkeypatch.setattr(dep_mod.usage_service, "current", counted)
        dep = enforce_limit("devices.max")
        assert await dep(tenant_id=tid, request=_request(), session=_session(), current_tenant=tid) is None
        counted.assert_not_awaited()  # unlimited short-circuits before counting

    @pytest.mark.asyncio
    async def test_tenant_mismatch_403(self, tid):
        dep = enforce_limit("devices.max")
        with pytest.raises(HTTPException) as exc:
            await dep(tenant_id=tid, request=_request(), session=_session(), current_tenant=uuid4())
        assert exc.value.status_code == 403


class TestRequireFeature:
    @pytest.mark.asyncio
    async def test_blocks_when_feature_off_403(self, monkeypatch, tid):
        monkeypatch.setattr(dep_mod.ent_service, "resolve", AsyncMock(return_value=_ent(**{"ai.enabled": False})))
        dep = require_feature("ai.enabled")
        with pytest.raises(HTTPException) as exc:
            await dep(tenant_id=tid, request=_request(), session=_session(), current_tenant=tid)
        assert exc.value.status_code == 403
        assert exc.value.detail["error"] == "feature_not_in_plan"

    @pytest.mark.asyncio
    async def test_allows_when_feature_on(self, monkeypatch, tid):
        monkeypatch.setattr(dep_mod.ent_service, "resolve", AsyncMock(return_value=_ent(**{"ai.enabled": True})))
        dep = require_feature("ai.enabled")
        assert await dep(tenant_id=tid, request=_request(), session=_session(), current_tenant=tid) is None
