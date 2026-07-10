"""Regression test: a query param named `status` shadows the `status` module
imported from fastapi for the rest of that function's body. list_organizations,
get_alarm_summary, list_alarms, and list_users all had this — the denied-tenant
branch (`raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, ...)`) tried
to read `.HTTP_403_FORBIDDEN` off the query parameter's value (a string or None)
instead of the fastapi module, raising AttributeError instead of returning a
clean 403. Fixed by renaming the parameter (with alias="status" to keep the
wire-level query key unchanged) in each function.
"""

import os

os.environ.setdefault("DATABASE_URL", "postgresql+asyncpg://test:test@localhost:5432/test")
os.environ.setdefault("JWT_SECRET_KEY", "test-secret-key-for-unit-tests-only-32ch")
os.environ.setdefault("MQTT_PASSWORD", "test-mqtt-password")

import pytest
from unittest.mock import AsyncMock, patch
from uuid import uuid4

from fastapi import HTTPException

from app.routers.organizations import list_organizations
from app.routers.alarms import get_alarm_summary, list_alarms
from app.routers.users import list_users


class TestDeniedTenantAccessReturnsClean403:
    """Each call passes status="active" so the shadowing bug (if reintroduced)
    would trip on this exact line — a plain call with no filter wouldn't."""

    @pytest.mark.asyncio
    async def test_list_organizations(self):
        with patch("app.routers.organizations.validate_tenant_access", new=AsyncMock(return_value=False)):
            with pytest.raises(HTTPException) as exc_info:
                await list_organizations(
                    tenant_id=uuid4(), session=AsyncMock(), current_tenant=uuid4(),
                    page=1, per_page=50, org_status="active",
                )
        assert exc_info.value.status_code == 403

    @pytest.mark.asyncio
    async def test_get_alarm_summary(self):
        with patch("app.routers.alarms.validate_tenant_access", new=AsyncMock(return_value=False)):
            with pytest.raises(HTTPException) as exc_info:
                await get_alarm_summary(
                    tenant_id=uuid4(), session=AsyncMock(), current_tenant=uuid4(),
                    alarm_status="active", severity=None, device_id=None,
                )
        assert exc_info.value.status_code == 403

    @pytest.mark.asyncio
    async def test_list_alarms(self):
        with patch("app.routers.alarms.validate_tenant_access", new=AsyncMock(return_value=False)):
            with pytest.raises(HTTPException) as exc_info:
                await list_alarms(
                    tenant_id=uuid4(), session=AsyncMock(), current_tenant=uuid4(),
                    page=1, page_size=50, alarm_status="active",
                    severity=None, device_id=None, alarm_type=None,
                )
        assert exc_info.value.status_code == 403

    @pytest.mark.asyncio
    async def test_list_users(self):
        with patch("app.routers.users.validate_tenant_access", new=AsyncMock(return_value=False)):
            with pytest.raises(HTTPException) as exc_info:
                await list_users(
                    tenant_id=uuid4(), session=AsyncMock(), current_tenant=uuid4(),
                    page=1, per_page=50, role=None, user_status="active", search=None,
                )
        assert exc_info.value.status_code == 403
