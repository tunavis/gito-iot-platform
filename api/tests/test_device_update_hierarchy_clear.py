"""Regression test: update_device must let a client clear org/site/group.

Previously the router checked `if device_data.X is not None`, so explicitly
sending organization_id/site_id/device_group_id = null (the only way to
unassign a device) was silently ignored — the device kept its old value
while the rest of the update still succeeded, with no error to the caller.
Fixed via Pydantic's model_fields_set: apply the field whenever the client
included the key at all, null or not; only a truly omitted key leaves the
existing value untouched.
"""

import os

os.environ.setdefault("DATABASE_URL", "postgresql+asyncpg://test:test@localhost:5432/test")
os.environ.setdefault("JWT_SECRET_KEY", "test-secret-key-for-unit-tests-only-32ch")
os.environ.setdefault("MQTT_PASSWORD", "test-mqtt-password")

from datetime import datetime, timezone
from uuid import uuid4

import pytest
from unittest.mock import AsyncMock, MagicMock

from app.database import RLSSession
from app.routers.devices import update_device
from app.schemas.device import DeviceUpdate


def _make_device(tenant_id, device_id, org_id):
    device = MagicMock()
    device.id = device_id
    device.tenant_id = tenant_id
    device.name = "Test Device"
    device.device_type = None
    device.device_type_id = None
    device.description = None
    device.serial_number = None
    device.tags = None
    device.status = "online"
    device.last_seen = datetime.now(timezone.utc)
    device.battery_level = None
    device.signal_strength = None
    device.attributes = {}
    device.organization_id = org_id
    device.site_id = None
    device.device_group_id = None
    device.dev_eui = None
    device.ttn_app_id = None
    device.device_profile_id = None
    device.ttn_synced = False
    device.created_at = datetime.now(timezone.utc)
    device.updated_at = datetime.now(timezone.utc)
    return device


def _make_session(device):
    session = MagicMock(spec=RLSSession)
    session.set_tenant_context = AsyncMock()
    session.commit = AsyncMock()
    session.refresh = AsyncMock()
    result = MagicMock()
    result.scalar_one_or_none.return_value = device
    session.execute = AsyncMock(return_value=result)
    return session


class TestUpdateDeviceHierarchyClear:
    @pytest.mark.asyncio
    async def test_explicit_null_clears_organization(self):
        tenant_id = uuid4()
        device_id = uuid4()
        device = _make_device(tenant_id, device_id, org_id=uuid4())
        session = _make_session(device)

        await update_device(
            tenant_id=tenant_id,
            device_id=device_id,
            device_data=DeviceUpdate(organization_id=None),
            session=session,
            current_tenant=tenant_id,
        )

        assert device.organization_id is None

    @pytest.mark.asyncio
    async def test_omitted_field_leaves_organization_untouched(self):
        tenant_id = uuid4()
        device_id = uuid4()
        original_org = uuid4()
        device = _make_device(tenant_id, device_id, org_id=original_org)
        session = _make_session(device)

        await update_device(
            tenant_id=tenant_id,
            device_id=device_id,
            device_data=DeviceUpdate(name="Renamed Device"),
            session=session,
            current_tenant=tenant_id,
        )

        assert device.organization_id == original_org
        assert device.name == "Renamed Device"
