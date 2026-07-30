"""Asset tree invariants and rollups, against a real database.

These cannot be faked with a mock session: cycle detection, the depth cap, the
subtree rollup and the FK delete behaviour are all SQL semantics. The suite skips
itself when no database is reachable, so it does not break a bare `pytest` run,
but it does run in CI where Postgres is a service.

What is being pinned down:
- a cycle is rejected on *write*, so corrupt data never reaches the table
- adding an asset still reflows nothing — rollups are computed, not stored
- rollups include the whole subtree (a station counts its pumps' devices)
- deleting an asset detaches devices instead of deleting them
- devices with asset_id IS NULL are in no rollup, and no "Unassigned" node exists
"""

import os

os.environ.setdefault("JWT_SECRET_KEY", "test-secret-key-for-unit-tests-only-32ch")
os.environ.setdefault("MQTT_PASSWORD", "test-mqtt-password")

import uuid
from uuid import uuid4

import pytest
import pytest_asyncio
from sqlalchemy import text
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.models.asset import MAX_ASSET_DEPTH
from app.services.asset_tree import AssetTreeError, tree_with_rollups, validate_parent

DB_URL = os.environ.get(
    "TEST_DATABASE_URL",
    os.environ.get("DATABASE_URL", "postgresql+asyncpg://gito:dev-password@localhost:5433/gito"),
)


@pytest_asyncio.fixture
async def session():
    """A session on a transaction that is always rolled back.

    Every test therefore runs against real schema and real FK behaviour while
    leaving the database exactly as it found it.
    """
    engine = create_async_engine(DB_URL, poolclass=None)
    try:
        conn = await engine.connect()
    except Exception as e:  # noqa: BLE001 - any connect failure means "no DB here"
        await engine.dispose()
        pytest.skip(f"no database reachable at {DB_URL}: {e}")

    trans = await conn.begin()
    maker = async_sessionmaker(bind=conn, expire_on_commit=False)
    s = maker()
    # The service calls session.commit(); inside an outer transaction that only
    # flushes, so the rollback below still discards everything.
    try:
        exists = await conn.execute(
            text("SELECT 1 FROM information_schema.tables WHERE table_name = 'assets'")
        )
        if exists.scalar() is None:
            pytest.skip("assets table not present — run `alembic upgrade head`")
        yield s
    finally:
        await s.close()
        await trans.rollback()
        await conn.close()
        await engine.dispose()


async def _seed_tenant_site(session):
    """A tenant + org + site to hang assets off. Returns (tenant_id, site_id)."""
    tenant_id, org_id, site_id = uuid4(), uuid4(), uuid4()
    slug = f"t{uuid.uuid4().hex[:12]}"
    await session.execute(
        text("INSERT INTO tenants (id, name, slug) VALUES (:id, :name, :slug)"),
        {"id": str(tenant_id), "name": "Asset Test Tenant", "slug": slug},
    )
    await session.execute(
        text(
            "INSERT INTO organizations (id, tenant_id, name, slug)"
            " VALUES (:id, :tid, :name, :slug)"
        ),
        {
            "id": str(org_id),
            "tid": str(tenant_id),
            "name": "Org",
            "slug": f"o{uuid.uuid4().hex[:12]}",
        },
    )
    await session.execute(
        text(
            "INSERT INTO sites (id, tenant_id, organization_id, name)"
            " VALUES (:id, :tid, :oid, :name)"
        ),
        {"id": str(site_id), "tid": str(tenant_id), "oid": str(org_id), "name": "Site"},
    )
    return tenant_id, site_id


async def _add_asset(session, tenant_id, site_id, name, parent_id=None):
    asset_id = uuid4()
    await session.execute(
        text(
            "INSERT INTO assets (id, tenant_id, site_id, parent_id, name)"
            " VALUES (:id, :tid, :sid, :pid, :name)"
        ),
        {
            "id": str(asset_id),
            "tid": str(tenant_id),
            "sid": str(site_id),
            "pid": str(parent_id) if parent_id else None,
            "name": name,
        },
    )
    return asset_id


async def _add_device(session, tenant_id, name, asset_id=None):
    device_id = uuid4()
    await session.execute(
        text(
            "INSERT INTO devices (id, tenant_id, name, device_type, asset_id, status)"
            " VALUES (:id, :tid, :name, 'sensor', :aid, 'offline')"
        ),
        {
            "id": str(device_id),
            "tid": str(tenant_id),
            "name": name,
            "aid": str(asset_id) if asset_id else None,
        },
    )
    return device_id


class TestCycleRejection:
    @pytest.mark.asyncio
    async def test_self_parent_rejected(self, session):
        tenant_id, site_id = await _seed_tenant_site(session)
        a = await _add_asset(session, tenant_id, site_id, "A")

        with pytest.raises(AssetTreeError):
            await validate_parent(session, tenant_id, parent_id=a, asset_id=a)

    @pytest.mark.asyncio
    async def test_parent_is_own_descendant_rejected(self, session):
        """station -> pump -> motor; making motor the parent of station is a cycle."""
        tenant_id, site_id = await _seed_tenant_site(session)
        station = await _add_asset(session, tenant_id, site_id, "station")
        pump = await _add_asset(session, tenant_id, site_id, "pump", parent_id=station)
        motor = await _add_asset(session, tenant_id, site_id, "motor", parent_id=pump)

        with pytest.raises(AssetTreeError):
            await validate_parent(session, tenant_id, parent_id=motor, asset_id=station)

    @pytest.mark.asyncio
    async def test_cross_tenant_parent_rejected(self, session):
        tenant_a, site_a = await _seed_tenant_site(session)
        tenant_b, site_b = await _seed_tenant_site(session)
        foreign = await _add_asset(session, tenant_b, site_b, "theirs")
        mine = await _add_asset(session, tenant_a, site_a, "mine")

        with pytest.raises(AssetTreeError):
            await validate_parent(session, tenant_a, parent_id=foreign, asset_id=mine)

    @pytest.mark.asyncio
    async def test_legal_parent_accepted(self, session):
        tenant_id, site_id = await _seed_tenant_site(session)
        station = await _add_asset(session, tenant_id, site_id, "station")
        pump = await _add_asset(session, tenant_id, site_id, "pump")

        await validate_parent(session, tenant_id, parent_id=station, asset_id=pump)

    @pytest.mark.asyncio
    async def test_null_parent_always_accepted(self, session):
        tenant_id, site_id = await _seed_tenant_site(session)
        a = await _add_asset(session, tenant_id, site_id, "A")
        await validate_parent(session, tenant_id, parent_id=None, asset_id=a)


class TestDepthCap:
    @pytest.mark.asyncio
    async def test_chain_at_cap_rejects_one_more_level(self, session):
        tenant_id, site_id = await _seed_tenant_site(session)

        parent = None
        for i in range(MAX_ASSET_DEPTH):
            parent = await _add_asset(session, tenant_id, site_id, f"level{i}", parent_id=parent)

        # `parent` is now at depth MAX_ASSET_DEPTH; a child of it would be one deeper.
        with pytest.raises(AssetTreeError):
            await validate_parent(session, tenant_id, parent_id=parent, asset_id=None)

    @pytest.mark.asyncio
    async def test_within_cap_accepted(self, session):
        tenant_id, site_id = await _seed_tenant_site(session)
        parent = None
        for i in range(MAX_ASSET_DEPTH - 2):
            parent = await _add_asset(session, tenant_id, site_id, f"level{i}", parent_id=parent)

        await validate_parent(session, tenant_id, parent_id=parent, asset_id=None)


class TestRollups:
    @pytest.mark.asyncio
    async def test_parent_counts_descendant_devices(self, session):
        """A station with no devices of its own reports its child pump's devices."""
        tenant_id, site_id = await _seed_tenant_site(session)
        station = await _add_asset(session, tenant_id, site_id, "station")
        pump = await _add_asset(session, tenant_id, site_id, "pump", parent_id=station)
        for i in range(4):
            await _add_device(session, tenant_id, f"dev{i}", asset_id=pump)

        rows = {r["name"]: r for r in await tree_with_rollups(session, tenant_id)}

        assert rows["station"]["device_count"] == 4
        assert rows["pump"]["device_count"] == 4

    @pytest.mark.asyncio
    async def test_unattached_devices_are_in_no_rollup(self, session):
        tenant_id, site_id = await _seed_tenant_site(session)
        pump = await _add_asset(session, tenant_id, site_id, "pump")
        await _add_device(session, tenant_id, "attached", asset_id=pump)
        await _add_device(session, tenant_id, "loose-1", asset_id=None)
        await _add_device(session, tenant_id, "loose-2", asset_id=None)

        rows = await tree_with_rollups(session, tenant_id)

        assert sum(r["device_count"] for r in rows) == 1
        assert not any(r["name"].lower() == "unassigned" for r in rows)

    @pytest.mark.asyncio
    async def test_leaf_counts_only_its_own(self, session):
        tenant_id, site_id = await _seed_tenant_site(session)
        station = await _add_asset(session, tenant_id, site_id, "station")
        pump = await _add_asset(session, tenant_id, site_id, "pump", parent_id=station)
        await _add_device(session, tenant_id, "on-station", asset_id=station)
        await _add_device(session, tenant_id, "on-pump", asset_id=pump)

        rows = {r["name"]: r for r in await tree_with_rollups(session, tenant_id)}

        assert rows["station"]["device_count"] == 2  # own + descendant
        assert rows["pump"]["device_count"] == 1  # leaf: only its own

    @pytest.mark.asyncio
    async def test_rollup_is_tenant_scoped(self, session):
        tenant_a, site_a = await _seed_tenant_site(session)
        tenant_b, site_b = await _seed_tenant_site(session)
        mine = await _add_asset(session, tenant_a, site_a, "mine")
        await _add_asset(session, tenant_b, site_b, "theirs")
        await _add_device(session, tenant_a, "d", asset_id=mine)

        names = {r["name"] for r in await tree_with_rollups(session, tenant_a)}

        assert names == {"mine"}


class TestDeleteSemantics:
    @pytest.mark.asyncio
    async def test_deleting_asset_detaches_devices_without_deleting_them(self, session):
        tenant_id, site_id = await _seed_tenant_site(session)
        pump = await _add_asset(session, tenant_id, site_id, "pump")
        d1 = await _add_device(session, tenant_id, "d1", asset_id=pump)
        d2 = await _add_device(session, tenant_id, "d2", asset_id=pump)

        await session.execute(text("DELETE FROM assets WHERE id = :id"), {"id": str(pump)})

        rows = (
            await session.execute(
                text("SELECT id, asset_id FROM devices WHERE id IN (:a, :b)"),
                {"a": str(d1), "b": str(d2)},
            )
        ).fetchall()
        assert len(rows) == 2, "devices must survive an asset delete"
        assert all(r[1] is None for r in rows), "devices must be detached"

    @pytest.mark.asyncio
    async def test_deleting_parent_removes_descendants_and_detaches_their_devices(self, session):
        tenant_id, site_id = await _seed_tenant_site(session)
        station = await _add_asset(session, tenant_id, site_id, "station")
        pump = await _add_asset(session, tenant_id, site_id, "pump", parent_id=station)
        dev = await _add_device(session, tenant_id, "on-pump", asset_id=pump)

        await session.execute(text("DELETE FROM assets WHERE id = :id"), {"id": str(station)})

        remaining = (
            await session.execute(
                text("SELECT count(*) FROM assets WHERE id IN (:a, :b)"),
                {"a": str(station), "b": str(pump)},
            )
        ).scalar()
        assert remaining == 0, "descendants must cascade"

        row = (
            await session.execute(
                text("SELECT asset_id FROM devices WHERE id = :id"), {"id": str(dev)}
            )
        ).fetchone()
        assert row is not None, "descendant's device must survive"
        assert row[0] is None, "descendant's device must be detached"

    @pytest.mark.asyncio
    async def test_deleting_site_removes_assets_and_detaches_devices(self, session):
        tenant_id, site_id = await _seed_tenant_site(session)
        pump = await _add_asset(session, tenant_id, site_id, "pump")
        dev = await _add_device(session, tenant_id, "d", asset_id=pump)

        await session.execute(text("DELETE FROM sites WHERE id = :id"), {"id": str(site_id)})

        assert (
            await session.execute(
                text("SELECT count(*) FROM assets WHERE id = :id"), {"id": str(pump)}
            )
        ).scalar() == 0

        row = (
            await session.execute(
                text("SELECT asset_id FROM devices WHERE id = :id"), {"id": str(dev)}
            )
        ).fetchone()
        assert row is not None and row[0] is None
