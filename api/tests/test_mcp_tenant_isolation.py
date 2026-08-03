"""Tenant isolation, per exposed MCP tool, against a real database.

Task 6.1 — the suite that matters. RLS is inert under the app's database role, so
nothing below the application stops a cross-tenant read. Isolation rests entirely
on two things: no tool can name a tenant, and every tool scopes its query by the
tenant resolved from the credential. The first is proven by the registration
guards (`test_mcp_guards.py`); this file proves the second.

The shape of every test is the same. Two tenants are seeded, B is given real data
— a device, a site, an asset, an alarm, an alert rule — and then every tool is
called with **tenant A's context while being handed B's UUIDs as arguments**.
That is the strongest request an agent could possibly express, because the tool
surface gives it no way to say "tenant B" directly. Every tool must come back
empty or refuse, and none of B's data may appear anywhere in the result.

The tools open their own sessions through `tool_session`, which would commit
outside the fixture's transaction, so it is patched to hand over the rolled-back
session instead. The tenant guard and RLS context are still applied — the patch
replaces where the session comes from, not what is done to it.

Skips itself when no database is reachable, like the other integration suites, so
a bare `pytest` run still passes. Run it for real with:
    docker exec gito-api python -m pytest tests/test_mcp_tenant_isolation.py -q
"""

import os

os.environ.setdefault("DATABASE_URL", "postgresql+asyncpg://test:test@localhost:5432/test")
os.environ.setdefault("JWT_SECRET_KEY", "test-secret-key-for-unit-tests-only-32ch")
os.environ.setdefault("MQTT_PASSWORD", "test-mqtt-password")

from contextlib import asynccontextmanager
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from unittest.mock import patch
from uuid import UUID, uuid4

import pytest
import pytest_asyncio
from sqlalchemy import text

from app.database import RLSSession
from app.mcp.auth import ToolContext
from app.mcp.tools import read, write

# One definition of "a transaction that always rolls back" — see
# test_asset_registry_endpoints.py, which reuses it for the same reason.
from tests.test_asset_tree import (  # noqa: F401 - `session` is a fixture
    _add_asset,
    _add_device,
    _seed_tenant_site,
    session,
)

B_MARKERS = ("B-Pump-42", "B-Station", "B-Rule", "B tank overflow")


@dataclass
class Fixture:
    a: ToolContext
    b_tenant: UUID
    b_site: UUID
    b_device: UUID
    b_asset: UUID
    b_rule: UUID
    b_alarm: UUID


async def _seed(session) -> Fixture:
    """Tenant A with nothing, tenant B with one of everything, all named 'B-…'.

    A is deliberately empty. If a tool leaks, the leaked rows are the only rows
    there are, so a passing assertion cannot be an accident of A's own data
    happening to look similar.
    """
    a_tenant, _ = await _seed_tenant_site(session)
    b_tenant, b_site = await _seed_tenant_site(session)

    b_device = await _add_device(session, b_tenant, "B-Pump-42")
    b_asset = await _add_asset(session, b_tenant, b_site, "B-Station")
    await session.execute(
        text("UPDATE devices SET site_id = :sid, asset_id = :aid WHERE id = :did"),
        {"sid": str(b_site), "aid": str(b_asset), "did": str(b_device)},
    )

    b_rule = uuid4()
    await session.execute(
        text(
            "INSERT INTO alert_rules (id, tenant_id, name, rule_type, severity, device_id,"
            " metric, operator, threshold)"
            " VALUES (:id, :tid, 'B-Rule', 'SIMPLE', 'critical', :did, 'level', 'gt', 90)"
        ),
        {"id": str(b_rule), "tid": str(b_tenant), "did": str(b_device)},
    )

    b_alarm = uuid4()
    await session.execute(
        text(
            "INSERT INTO alarms (id, tenant_id, device_id, alert_rule_id, alarm_type, severity,"
            " status, message, fired_at)"
            " VALUES (:id, :tid, :did, :rid, 'threshold', 'CRITICAL', 'ACTIVE',"
            " 'B tank overflow', :fired)"
        ),
        {
            "id": str(b_alarm),
            "tid": str(b_tenant),
            "did": str(b_device),
            "rid": str(b_rule),
            "fired": datetime.now(UTC) - timedelta(hours=1),
        },
    )

    await session.flush()
    return Fixture(
        a=ToolContext(tenant_id=a_tenant, user_id=uuid4(), role="TENANT_ADMIN"),
        b_tenant=b_tenant,
        b_site=b_site,
        b_device=b_device,
        b_asset=b_asset,
        b_rule=b_rule,
        b_alarm=b_alarm,
    )


@pytest_asyncio.fixture
async def seeded(session):
    """Seeded data plus `tool_session` redirected at the rolled-back session."""
    # RLSSession's context setter is a plain method over `self.execute`; binding
    # it to the fixture's session runs the real SET LOCAL rather than stubbing
    # it, so the tools see a session shaped exactly as they do in production.
    session.set_tenant_context = RLSSession.set_tenant_context.__get__(session)

    fixture = await _seed(session)

    @asynccontextmanager
    async def _tool_session(ctx):
        await session.set_tenant_context(ctx.tenant_id, ctx.user_id)
        yield session

    # Patched where it is bound, not where it is defined: both tool modules did
    # `from app.mcp.shape import tool_session` at import time.
    with patch.object(read, "tool_session", _tool_session), patch.object(
        write, "tool_session", _tool_session
    ):
        yield fixture


def _leaks(result) -> list[str]:
    """Any of tenant B's identifiers or names appearing in a result."""
    blob = str(result)
    return [m for m in B_MARKERS if m in blob]


class TestNoToolReturnsAnotherTenantsData:
    @pytest.mark.asyncio
    async def test_every_read_tool_refuses_or_returns_empty(self, seeded):
        from fastapi import HTTPException

        leaks = {}
        for name, call in [
            ("list_devices", lambda: read.list_devices(seeded.a, site_id=seeded.b_site)),
            ("get_device", lambda: read.get_device(seeded.a, device_id=seeded.b_device)),
            (
                "get_device_telemetry",
                lambda: read.get_device_telemetry(seeded.a, device_id=seeded.b_device),
            ),
            ("get_telemetry_aggregate", lambda: read.get_telemetry_aggregate(seeded.a)),
            (
                "list_active_alarms",
                lambda: read.list_active_alarms(seeded.a, site_id=seeded.b_site),
            ),
            (
                "get_alarm_history",
                lambda: read.get_alarm_history(seeded.a, device_id=seeded.b_device),
            ),
            (
                "get_alarm_history_by_rule",
                lambda: read.get_alarm_history(seeded.a, alert_rule_id=seeded.b_rule),
            ),
            (
                "list_alert_rules",
                lambda: read.list_alert_rules(seeded.a, device_id=seeded.b_device),
            ),
            ("get_hierarchy", lambda: read.get_hierarchy(seeded.a)),
            ("get_fleet_health", lambda: read.get_fleet_health(seeded.a)),
            ("get_asset_tree", lambda: read.get_asset_tree(seeded.a)),
            (
                "get_command_status",
                lambda: read.get_command_status(
                    seeded.a, device_id=seeded.b_device, command_id=uuid4()
                ),
            ),
        ]:
            try:
                result = await call()
            except HTTPException as e:
                # A refusal is an acceptable answer; a 404 for a device that
                # exists in B is exactly right — to A, it does not exist.
                assert e.status_code in (403, 404), f"{name} raised {e.status_code}"
                continue
            found = _leaks(result)
            if found:
                leaks[name] = found

        assert not leaks, f"tools leaked tenant B's data: {leaks}"

    @pytest.mark.asyncio
    async def test_counts_do_not_include_the_other_tenant(self, seeded):
        """A leak that shows no names is still a leak — 'you have 1 device' about
        somebody else's device is a wrong answer an agent would repeat."""
        fleet = await read.get_fleet_health(seeded.a)
        assert fleet["devices"]["total_devices"] == 0
        assert fleet["alarms"]["total"] == 0
        assert fleet["alarms"]["active"] == 0

        devices = await read.list_devices(seeded.a)
        assert devices["total"] == 0

        alarms = await read.list_active_alarms(seeded.a)
        assert alarms["total"] == 0

        assets = await read.get_asset_tree(seeded.a)
        assert assets["total"] == 0

    @pytest.mark.asyncio
    async def test_tenant_b_can_see_its_own_data(self, seeded, session):
        """The control. Without this, every assertion above would pass on a tool
        that is simply broken and returns nothing to anyone."""
        b = ToolContext(tenant_id=seeded.b_tenant, user_id=uuid4(), role="TENANT_ADMIN")

        devices = await read.list_devices(b)
        assert devices["total"] == 1
        assert "B-Pump-42" in str(devices)

        alarms = await read.list_active_alarms(b)
        assert alarms["total"] == 1

        assets = await read.get_asset_tree(b)
        assert assets["total"] == 1

        fleet = await read.get_fleet_health(b)
        assert fleet["devices"]["total_devices"] == 1


class TestTheWriteToolIsScopedToo:
    @pytest.mark.asyncio
    async def test_requesting_a_command_on_another_tenants_device_is_refused(self, seeded):
        """And refused *before* any row is written — a pending approval naming
        another tenant's device would be a cross-tenant write dressed as a
        request, waiting for a person to rubber-stamp it."""
        from fastapi import HTTPException

        with pytest.raises(HTTPException) as exc:
            await write.send_device_command(
                seeded.a,
                device_id=seeded.b_device,
                command_name="close_valve",
                reason="probing another tenant's device",
            )
        assert exc.value.status_code == 404

    @pytest.mark.asyncio
    async def test_no_approval_row_was_created(self, seeded, session):
        from fastapi import HTTPException

        with pytest.raises(HTTPException):
            await write.send_device_command(
                seeded.a,
                device_id=seeded.b_device,
                command_name="close_valve",
                reason="probing another tenant's device",
            )

        count = await session.execute(
            text("SELECT count(*) FROM device_commands WHERE device_id = :did"),
            {"did": str(seeded.b_device)},
        )
        assert count.scalar() == 0
