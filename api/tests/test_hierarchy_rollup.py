"""Regression test: hierarchy device counts must roll up to every ancestor.

The router's docstring promised counts "rolled up at every level", but each
grouped device row was credited only to the FKs on the row itself. Since a
device attached to a nested site carries `site_id` and not `organization_id`,
the parent site and the owning org both reported 0 while the child site
reported the real number — a tree visibly showing a parent with fewer devices
than its own child, and a summary bar (which sums the org counts) reading 0 for
a 68-device fleet.

Also pins the no-double-count rule: a device carrying both `organization_id`
and a `site_id` under that same org must be counted once, not twice.
"""

import os

os.environ.setdefault("DATABASE_URL", "postgresql+asyncpg://test:test@localhost:5432/test")
os.environ.setdefault("JWT_SECRET_KEY", "test-secret-key-for-unit-tests-only-32ch")
os.environ.setdefault("MQTT_PASSWORD", "test-mqtt-password")

from unittest.mock import AsyncMock, MagicMock
from uuid import uuid4

import pytest

from app.database import RLSSession
from app.routers import hierarchy as hierarchy_module
from app.routers.hierarchy import get_hierarchy

TENANT = uuid4()
ORG = uuid4()
PARENT_SITE = uuid4()
CHILD_SITE = uuid4()
GROUP = uuid4()


def _org():
    o = MagicMock()
    o.id, o.tenant_id, o.name = ORG, TENANT, "Growthpoint Properties"
    o.status, o.billing_contact = "active", None
    return o


def _site(site_id, name, parent_site_id):
    s = MagicMock()
    s.id, s.tenant_id, s.name = site_id, TENANT, name
    s.organization_id, s.parent_site_id = ORG, parent_site_id
    s.site_type, s.address, s.coordinates = None, None, None
    return s


def _group():
    g = MagicMock()
    g.id, g.name, g.site_id, g.group_type = GROUP, "Production Sensors", CHILD_SITE, None
    return g


def _row(*, organization_id=None, site_id=None, device_group_id=None, total=0, online=0):
    r = MagicMock()
    r.organization_id, r.site_id, r.device_group_id = organization_id, site_id, device_group_id
    r.total, r.online = total, online
    return r


def _alarm_row(*, organization_id=None, site_id=None, device_group_id=None, alarms=0):
    r = MagicMock()
    r.organization_id, r.site_id, r.device_group_id = organization_id, site_id, device_group_id
    r.alarms = alarms
    return r


def _session(dev_rows, alarm_rows, groups=()):
    """Feeds get_hierarchy's five queries in the order it issues them."""

    def scalars(items):
        res = MagicMock()
        res.scalars.return_value.all.return_value = list(items)
        return res

    def rows(items):
        res = MagicMock()
        res.all.return_value = list(items)
        return res

    session = MagicMock(spec=RLSSession)
    session.set_tenant_context = AsyncMock()
    session.execute = AsyncMock(
        side_effect=[
            scalars([_org()]),
            scalars([_site(PARENT_SITE, "Head Office", None),
                     _site(CHILD_SITE, "Wonderpark Shopping Centre", PARENT_SITE)]),
            scalars(groups),
            rows(dev_rows),
            rows(alarm_rows),
        ]
    )
    return session


async def _call(session, monkeypatch):
    monkeypatch.setattr(
        hierarchy_module, "validate_tenant_access", AsyncMock(return_value=True)
    )
    return await get_hierarchy(tenant_id=TENANT, session=session, current_tenant=TENANT)


def _tree(result):
    org = result["organizations"][0]
    parent = org["sites"][0]
    child = parent["children"][0]
    return org, parent, child


class TestHierarchyRollup:
    @pytest.mark.asyncio
    async def test_nested_site_devices_roll_up_to_parent_and_org(self, monkeypatch):
        """The exact live shape: 2 devices on a child site, no organization_id."""
        session = _session([_row(site_id=CHILD_SITE, total=2, online=2)], [])
        org, parent, child = _tree(await _call(session, monkeypatch))

        assert (child["device_count"], child["online_count"]) == (2, 2)
        assert (parent["device_count"], parent["online_count"]) == (2, 2)
        assert (org["device_count"], org["online_count"]) == (2, 2)

    @pytest.mark.asyncio
    async def test_device_on_both_org_and_its_site_is_counted_once(self, monkeypatch):
        """Credit the org from the FK *or* from the site chain — never both."""
        session = _session(
            [_row(organization_id=ORG, site_id=CHILD_SITE, total=3, online=1)], []
        )
        org, parent, child = _tree(await _call(session, monkeypatch))

        assert org["device_count"] == 3, "double-counted the org"
        assert org["online_count"] == 1
        assert child["device_count"] == 3
        assert parent["device_count"] == 3

    @pytest.mark.asyncio
    async def test_group_only_device_reaches_the_group_site_and_org(self, monkeypatch):
        """A device attached to a group alone still lives somewhere in the tree."""
        session = _session(
            [_row(device_group_id=GROUP, total=5, online=4)], [], groups=[_group()]
        )
        org, parent, child = _tree(await _call(session, monkeypatch))

        assert child["device_groups"][0]["device_count"] == 5
        assert child["device_count"] == 5
        assert parent["device_count"] == 5
        assert org["device_count"] == 5

    @pytest.mark.asyncio
    async def test_active_alarms_roll_up_the_same_way(self, monkeypatch):
        session = _session([], [_alarm_row(site_id=CHILD_SITE, alarms=4)])
        org, parent, child = _tree(await _call(session, monkeypatch))

        assert child["active_alarms"] == 4
        assert parent["active_alarms"] == 4
        assert org["active_alarms"] == 4

    @pytest.mark.asyncio
    async def test_parent_site_cycle_does_not_hang_or_double_count(self, monkeypatch):
        """A malformed parent loop must terminate, not spin or inflate counts."""
        session = _session([_row(site_id=CHILD_SITE, total=1, online=1)], [])
        # Point the parent back at its own child.
        session.execute.side_effect = list(session.execute.side_effect)
        cyclic_parent = _site(PARENT_SITE, "Head Office", CHILD_SITE)
        child = _site(CHILD_SITE, "Wonderpark Shopping Centre", PARENT_SITE)

        def scalars(items):
            res = MagicMock()
            res.scalars.return_value.all.return_value = list(items)
            return res

        def rows(items):
            res = MagicMock()
            res.all.return_value = list(items)
            return res

        session.execute = AsyncMock(
            side_effect=[
                scalars([_org()]),
                scalars([cyclic_parent, child]),
                scalars([]),
                rows([_row(site_id=CHILD_SITE, total=1, online=1)]),
                rows([]),
            ]
        )

        result = await _call(session, monkeypatch)
        # Each site in the cycle is credited exactly once.
        counts = {
            s["name"]: s["device_count"]
            for s in result["organizations"][0]["sites"]
        }
        assert all(c == 1 for c in counts.values()), counts
