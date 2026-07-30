"""Unit test for _validate_device_fks — the tenant-ownership guard on device FKs.

Regression cover for the MEDIUM finding: device create/update accepted
device_type_id/organization_id/site_id/device_group_id without checking they
belong to the caller's tenant. The helper must raise 422 for a foreign/missing
FK and pass silently for an owned one (or a None = unset).
"""

import os

os.environ.setdefault("DATABASE_URL", "postgresql+asyncpg://test:test@localhost:5432/test")
os.environ.setdefault("JWT_SECRET_KEY", "test-secret-key-for-unit-tests-only-32ch")
os.environ.setdefault("MQTT_PASSWORD", "test-mqtt-password")

from uuid import uuid4

import pytest
from fastapi import HTTPException

from app.routers.devices import _validate_device_fks


class _Result:
    def __init__(self, value):
        self._value = value

    def scalar_one_or_none(self):
        return self._value


class _FakeSession:
    """Returns `owned` (truthy) or None for the existence check."""

    def __init__(self, owned: bool):
        self._owned = owned
        self.queries = 0

    async def execute(self, sql, params=None):
        self.queries += 1
        return _Result(1 if self._owned else None)


class TestValidateDeviceFks:
    @pytest.mark.asyncio
    async def test_none_values_skip_all_checks(self):
        session = _FakeSession(owned=False)  # would fail if queried
        await _validate_device_fks(session, uuid4())  # all FKs None
        assert session.queries == 0  # nothing to validate

    @pytest.mark.asyncio
    async def test_owned_fk_passes(self):
        session = _FakeSession(owned=True)
        await _validate_device_fks(session, uuid4(), device_type_id=uuid4())
        assert session.queries == 1

    @pytest.mark.asyncio
    async def test_foreign_fk_raises_422(self):
        session = _FakeSession(owned=False)
        with pytest.raises(HTTPException) as exc:
            await _validate_device_fks(session, uuid4(), device_type_id=uuid4())
        assert exc.value.status_code == 422
        assert "device_type_id" in exc.value.detail

    @pytest.mark.asyncio
    async def test_each_fk_field_is_checked(self):
        for field in (
            "device_type_id",
            "organization_id",
            "site_id",
            "device_group_id",
            "asset_id",
        ):
            session = _FakeSession(owned=False)
            with pytest.raises(HTTPException) as exc:
                await _validate_device_fks(session, uuid4(), **{field: uuid4()})
            assert field in exc.value.detail
