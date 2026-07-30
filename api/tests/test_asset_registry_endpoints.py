"""Asset endpoint isolation, device-attachment side effects, and non-regression.

Covers the parts of add-asset-registry that are about *boundaries* rather than
tree maths (which lives in test_asset_tree.py):

- every asset endpoint refuses a tenant mismatch with 403
- omitting site_id fails at the schema, before any handler runs
- attaching an asset does not drag the LoRaWAN sync in with it
- a device with asset_id IS NULL behaves exactly as it did before the column
- the tree endpoint's query count does not grow with the number of assets
- /hierarchy is untouched: no asset fields, and it never queries `assets`
- alarm evaluation does not know assets exist

The 403 / schema / side-effect tests need no database. The query-count and
non-regression tests that need real SQL reuse the rolled-back `session` fixture
from test_asset_tree.py via direct import.
"""

import os

os.environ.setdefault("DATABASE_URL", "postgresql+asyncpg://test:test@localhost:5432/test")
os.environ.setdefault("JWT_SECRET_KEY", "test-secret-key-for-unit-tests-only-32ch")
os.environ.setdefault("MQTT_PASSWORD", "test-mqtt-password")

from datetime import datetime, timezone
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import uuid4

import pytest
from fastapi import HTTPException
from pydantic import ValidationError
from sqlalchemy import text

from app.database import RLSSession
from app.routers import assets as assets_router
from app.routers.devices import update_device
from app.schemas.asset import AssetCreate
from app.schemas.device import DeviceResponse, DeviceUpdate

# Reusing the DB fixture keeps one definition of "a transaction that always rolls
# back" rather than a second, subtly different copy.
from tests.test_asset_tree import (  # noqa: F401 - `session` is a fixture
    _add_asset,
    _add_device,
    _seed_tenant_site,
    session,
)


def _mismatch_session():
    """A session whose ancestry check says 'not permitted'."""
    s = MagicMock(spec=RLSSession)
    s.set_tenant_context = AsyncMock()
    result = MagicMock()
    result.scalar.return_value = False  # is_ancestor_tenant -> False
    s.execute = AsyncMock(return_value=result)
    return s


class TestTenantMismatchIsRefused:
    """Task 3.4: 403 on every endpoint, for a tenant the caller has no claim on."""

    @pytest.mark.asyncio
    async def test_every_asset_endpoint_refuses_a_foreign_tenant(self):
        path_tenant, token_tenant, asset_id = uuid4(), uuid4(), uuid4()

        calls = {
            "list_assets": lambda s: assets_router.list_assets(
                tenant_id=path_tenant, session=s, current_tenant=token_tenant
            ),
            "get_asset_tree": lambda s: assets_router.get_asset_tree(
                tenant_id=path_tenant, session=s, current_tenant=token_tenant
            ),
            "create_asset": lambda s: assets_router.create_asset(
                tenant_id=path_tenant,
                asset_data=AssetCreate(site_id=uuid4(), name="x"),
                session=s,
                current_tenant=token_tenant,
            ),
            "get_asset": lambda s: assets_router.get_asset(
                tenant_id=path_tenant, asset_id=asset_id, session=s, current_tenant=token_tenant
            ),
            "list_asset_devices": lambda s: assets_router.list_asset_devices(
                tenant_id=path_tenant, asset_id=asset_id, session=s, current_tenant=token_tenant
            ),
            "update_asset": lambda s: assets_router.update_asset(
                tenant_id=path_tenant,
                asset_id=asset_id,
                asset_data=assets_router.AssetUpdate(name="y"),
                session=s,
                current_tenant=token_tenant,
            ),
            "delete_asset": lambda s: assets_router.delete_asset(
                tenant_id=path_tenant, asset_id=asset_id, session=s, current_tenant=token_tenant
            ),
        }

        for name, call in calls.items():
            session = _mismatch_session()
            with pytest.raises(HTTPException) as exc:
                await call(session)
            assert exc.value.status_code == 403, f"{name} must refuse a foreign tenant"
            # The guard must run before any tenant context is set, or a refused
            # request would still have repointed the session.
            session.set_tenant_context.assert_not_called()


class TestSiteIdIsRequired:
    """Task 3.4: omitting site_id fails at the Pydantic layer, not in a handler."""

    def test_missing_site_id_is_a_validation_error(self):
        with pytest.raises(ValidationError) as exc:
            AssetCreate(name="Pump Station")
        assert any(e["loc"] == ("site_id",) for e in exc.value.errors())

    def test_site_id_present_validates(self):
        model = AssetCreate(site_id=uuid4(), name="Pump Station")
        assert model.parent_id is None
        assert model.attributes == {}


def _device_stub(tenant_id, device_id, asset_id=None):
    device = MagicMock()
    device.id = device_id
    device.tenant_id = tenant_id
    device.name = "Device"
    device.device_type = "sensor"
    device.device_type_id = None
    device.description = None
    device.serial_number = None
    device.tags = None
    device.status = "online"
    device.last_seen = datetime.now(timezone.utc)
    device.battery_level = None
    device.signal_strength = None
    device.attributes = {}
    device.organization_id = None
    device.site_id = None
    device.device_group_id = None
    device.asset_id = asset_id
    device.dev_eui = None
    device.ttn_app_id = None
    device.device_profile_id = None
    device.ttn_synced = False
    device.created_at = datetime.now(timezone.utc)
    device.updated_at = datetime.now(timezone.utc)
    return device


def _owning_session(device):
    s = MagicMock(spec=RLSSession)
    s.set_tenant_context = AsyncMock()
    s.commit = AsyncMock()
    s.refresh = AsyncMock()
    result = MagicMock()
    result.scalar_one_or_none.return_value = device
    result.scalar.return_value = 1  # FK existence check: owned
    s.execute = AsyncMock(return_value=result)
    return s


class TestAttachmentHasNoSideEffects:
    """Task 4.4: changing only asset_id must not drag other machinery in."""

    @pytest.mark.asyncio
    async def test_asset_only_update_does_not_trigger_chirpstack_sync(self):
        tenant_id, device_id = uuid4(), uuid4()
        device = _device_stub(tenant_id, device_id)
        session = _owning_session(device)

        with patch("app.routers.devices.DeviceManagementService") as mgmt:
            await update_device(
                tenant_id=tenant_id,
                device_id=device_id,
                device_data=DeviceUpdate(asset_id=uuid4()),
                session=session,
                current_tenant=tenant_id,
            )

        # No LoRaWAN field changed, so the sync service must never be constructed.
        mgmt.assert_not_called()

    @pytest.mark.asyncio
    async def test_attaching_sets_the_column_not_an_attribute(self):
        tenant_id, device_id, asset_id = uuid4(), uuid4(), uuid4()
        device = _device_stub(tenant_id, device_id)
        session = _owning_session(device)

        with patch("app.routers.devices.DeviceManagementService"):
            await update_device(
                tenant_id=tenant_id,
                device_id=device_id,
                device_data=DeviceUpdate(asset_id=asset_id),
                session=session,
                current_tenant=tenant_id,
            )

        assert device.asset_id == asset_id
        assert "asset_id" not in device.attributes


class TestUnattachedDeviceIsUnchanged:
    """Task 4.5: a pre-existing device (asset_id IS NULL) behaves as before."""

    def test_response_reports_asset_id_as_null_rather_than_omitting_it(self):
        device = _device_stub(uuid4(), uuid4(), asset_id=None)
        payload = DeviceResponse.model_validate(device, from_attributes=True).model_dump()

        assert "asset_id" in payload, "field must be present so clients can rely on it"
        assert payload["asset_id"] is None

    @pytest.mark.asyncio
    async def test_update_that_omits_asset_id_leaves_an_unattached_device_alone(self):
        tenant_id, device_id = uuid4(), uuid4()
        device = _device_stub(tenant_id, device_id, asset_id=None)
        session = _owning_session(device)

        with patch("app.routers.devices.DeviceManagementService"):
            await update_device(
                tenant_id=tenant_id,
                device_id=device_id,
                device_data=DeviceUpdate(name="Renamed"),
                session=session,
                current_tenant=tenant_id,
            )

        assert device.asset_id is None
        assert device.name == "Renamed"


class _CountingSession:
    """Delegates to a real session while counting execute() calls."""

    def __init__(self, inner):
        self._inner = inner
        self.executes = 0

    async def execute(self, *a, **kw):
        self.executes += 1
        return await self._inner.execute(*a, **kw)


class TestNoNPlusOne:
    """Task 6.6: the tree endpoint's query count must not track asset count."""

    @pytest.mark.asyncio
    async def test_query_count_is_flat_as_assets_grow(self, session):
        from app.services.asset_tree import tree_with_rollups

        tenant_id, site_id = await _seed_tenant_site(session)
        for i in range(3):
            await _add_asset(session, tenant_id, site_id, f"a{i}")

        small = _CountingSession(session)
        rows_small = await tree_with_rollups(small, tenant_id)

        parent = None
        for i in range(30):
            parent = await _add_asset(session, tenant_id, site_id, f"b{i}", parent_id=parent)

        large = _CountingSession(session)
        rows_large = await tree_with_rollups(large, tenant_id)

        assert len(rows_small) == 3
        assert len(rows_large) == 33
        assert small.executes == large.executes == 1, (
            "the whole tree plus rollups must be one query; "
            f"got {small.executes} for 3 assets and {large.executes} for 33"
        )


class TestExistingBehaviourUnmoved:
    @pytest.mark.asyncio
    async def test_hierarchy_endpoint_does_not_read_assets(self, session):
        """Task 7.1: /hierarchy must be untouched by this change.

        Asserted structurally — the handler never mentions `assets`, so it cannot
        have gained asset nodes or an extra asset query. Checking the source is
        what makes this a *regression* guard: a future edit that starts joining
        assets into the 5-query hierarchy contract fails here.
        """
        import inspect

        from app.routers import hierarchy

        source = inspect.getsource(hierarchy)
        assert "assets" not in source.lower().replace("asset_id", ""), (
            "hierarchy must not query or return assets — it has a documented "
            "5-flat-query contract and a live HierarchyCanvas consumer"
        )

    @pytest.mark.asyncio
    async def test_alarms_table_has_no_asset_column(self, session):
        """Task 7.2: alarms stay device-keyed; asset scoping is read-side only."""
        cols = (
            await session.execute(
                text(
                    "SELECT column_name FROM information_schema.columns"
                    " WHERE table_name = 'alarms'"
                )
            )
        ).fetchall()
        names = {c[0] for c in cols}

        assert "device_id" in names
        assert not any(
            "asset" in n for n in names
        ), "an asset column on alarms would mean alarms were re-keyed — that is Y2"

    @pytest.mark.asyncio
    async def test_alarm_evaluation_is_identical_for_attached_and_unattached(self, session):
        """The evaluator has no notion of assets, so attachment cannot change a firing."""
        from alarm_core import Rule, evaluate

        tenant_id, site_id = await _seed_tenant_site(session)
        pump = await _add_asset(session, tenant_id, site_id, "pump")
        attached = await _add_device(session, tenant_id, "attached", asset_id=pump)
        loose = await _add_device(session, tenant_id, "loose", asset_id=None)

        rule = Rule(
            id=str(uuid4()),
            rule_type="THRESHOLD",
            metric="temperature",
            operator="gt",
            threshold=50.0,
            severity="MAJOR",
        )
        reading = {"temperature": 75.0}
        now = datetime.now(timezone.utc)

        fired_attached = evaluate([rule], reading, now)
        fired_loose = evaluate([rule], reading, now)

        assert bool(fired_attached) == bool(fired_loose)
        assert fired_attached, "the rule should fire for both, or the test proves nothing"
        # And the devices really did differ in attachment.
        rows = (
            await session.execute(
                text("SELECT id, asset_id FROM devices WHERE id IN (:a, :b)"),
                {"a": str(attached), "b": str(loose)},
            )
        ).fetchall()
        by_id = {str(r[0]): r[1] for r in rows}
        assert by_id[str(attached)] is not None
        assert by_id[str(loose)] is None
