"""The approval queue and the role gate, against a real database.

Tasks 7.2, 7.3, 7.6 and the list half of 3.3. The gate's *decision* logic is
covered by `test_command_approval_gate.py` with mocks; what needs real SQL is
the queue — the joins, the tenant scope, and the expiry filter — because those
are the parts a mock would happily agree with while being wrong.

Skips without a database, like the other integration suites.
"""

import os

os.environ.setdefault("DATABASE_URL", "postgresql+asyncpg://test:test@localhost:5432/test")
os.environ.setdefault("JWT_SECRET_KEY", "test-secret-key-for-unit-tests-only-32ch")
os.environ.setdefault("MQTT_PASSWORD", "test-mqtt-password")

import uuid
from datetime import UTC, datetime, timedelta
from unittest.mock import AsyncMock, patch
from uuid import uuid4

import pytest
import pytest_asyncio
from fastapi import HTTPException
from sqlalchemy import text

from app.database import RLSSession
from app.dependencies import COMMAND_ROLES, may_actuate_device, require_command_role
from app.routers import commands

from tests.test_asset_tree import (  # noqa: F401 - `session` is a fixture
    _add_device,
    _seed_tenant_site,
    session,
)


async def _add_user(session, tenant_id, email: str):
    user_id = uuid4()
    await session.execute(
        text(
            "INSERT INTO users (id, tenant_id, email, password_hash, role, status)"
            " VALUES (:id, :tid, :email, 'x', 'TENANT_ADMIN', 'active')"
        ),
        {"id": str(user_id), "tid": str(tenant_id), "email": email},
    )
    return user_id


async def _request(session, tenant_id, device_id, user_id, *, reason="because", hours=24):
    """A pending approval row, written directly so the test controls its expiry."""
    command_id = uuid4()
    now = datetime.now(UTC)
    await session.execute(
        text(
            "INSERT INTO device_commands (id, tenant_id, device_id, command_name, parameters,"
            " status, requested_by, request_reason, created_at, expires_at)"
            " VALUES (:id, :tid, :did, 'close_valve', '{\"position\": 0}', 'awaiting_approval',"
            " :uid, :reason, :created, :expires)"
        ),
        {
            "id": str(command_id),
            "tid": str(tenant_id),
            "did": str(device_id),
            "uid": str(user_id),
            "reason": reason,
            "created": now,
            "expires": now + timedelta(hours=hours),
        },
    )
    return command_id


@pytest_asyncio.fixture
async def two_tenants(session):
    session.set_tenant_context = RLSSession.set_tenant_context.__get__(session)

    a_tenant, a_site = await _seed_tenant_site(session)
    b_tenant, b_site = await _seed_tenant_site(session)

    a_device = await _add_device(session, a_tenant, "A-Pump")
    b_device = await _add_device(session, b_tenant, "B-SECRET-PUMP")
    await session.execute(
        text("UPDATE devices SET site_id = :s WHERE id = :d"),
        {"s": str(a_site), "d": str(a_device)},
    )
    await session.execute(
        text("UPDATE devices SET site_id = :s WHERE id = :d"),
        {"s": str(b_site), "d": str(b_device)},
    )

    a_user = await _add_user(session, a_tenant, f"a{uuid.uuid4().hex[:8]}@t.test")
    b_user = await _add_user(session, b_tenant, f"b{uuid.uuid4().hex[:8]}@t.test")
    await session.flush()

    return {
        "session": session,
        "a_tenant": a_tenant,
        "b_tenant": b_tenant,
        "a_device": a_device,
        "b_device": b_device,
        "a_user": a_user,
        "b_user": b_user,
    }


class TestTheQueueIsTenantScoped:
    @pytest.mark.asyncio
    async def test_one_tenant_never_sees_anothers_requests(self, two_tenants):
        """Task 7.3. The queue is a new query, so it needs its own proof — the
        isolation the read tools have does not transfer to it for free."""
        f = two_tenants
        await _request(f["session"], f["b_tenant"], f["b_device"], f["b_user"])
        await f["session"].flush()

        result = await commands.list_pending_approvals(
            tenant_id=f["a_tenant"], session=f["session"], current_tenant=f["a_tenant"]
        )

        assert result.total == 0
        assert "B-SECRET-PUMP" not in str(result)

    @pytest.mark.asyncio
    async def test_a_tenant_sees_its_own(self, two_tenants):
        """The control: without it, a queue broken for everyone would pass above."""
        f = two_tenants
        await _request(f["session"], f["a_tenant"], f["a_device"], f["a_user"])
        await f["session"].flush()

        result = await commands.list_pending_approvals(
            tenant_id=f["a_tenant"], session=f["session"], current_tenant=f["a_tenant"]
        )

        assert result.total == 1
        assert result.data[0].device_name == "A-Pump"


class TestTheQueueShowsWhatIsNeededToDecide:
    @pytest.mark.asyncio
    async def test_row_carries_names_reason_and_requester(self, two_tenants):
        f = two_tenants
        await _request(
            f["session"],
            f["a_tenant"],
            f["a_device"],
            f["a_user"],
            reason="Pressure climbing past the safe band.",
        )
        await f["session"].flush()

        row = (
            await commands.list_pending_approvals(
                tenant_id=f["a_tenant"], session=f["session"], current_tenant=f["a_tenant"]
            )
        ).data[0]

        assert row.device_name == "A-Pump"
        assert row.site_name  # joined through the device
        assert row.request_reason == "Pressure climbing past the safe band."
        assert row.requested_by_email  # joined through the requesting user
        assert row.parameters == {"position": 0}

    @pytest.mark.asyncio
    async def test_the_count_equals_the_rows_returned(self, two_tenants):
        """Task 7.6. A badge that disagrees with the list it links to sends
        someone looking for a request that is not there."""
        f = two_tenants
        for _ in range(3):
            await _request(f["session"], f["a_tenant"], f["a_device"], f["a_user"])
        await f["session"].flush()

        result = await commands.list_pending_approvals(
            tenant_id=f["a_tenant"], session=f["session"], current_tenant=f["a_tenant"]
        )
        assert result.total == len(result.data) == 3

    @pytest.mark.asyncio
    async def test_expired_requests_are_not_listed(self, two_tenants):
        """Task 3.3. Approve refuses an expired request, so listing it would
        offer a decision that does not exist."""
        f = two_tenants
        await _request(f["session"], f["a_tenant"], f["a_device"], f["a_user"], hours=-1)
        await f["session"].flush()

        result = await commands.list_pending_approvals(
            tenant_id=f["a_tenant"], session=f["session"], current_tenant=f["a_tenant"]
        )
        assert result.total == 0

    @pytest.mark.asyncio
    async def test_a_decided_request_leaves_the_queue(self, two_tenants):
        f = two_tenants
        command_id = await _request(f["session"], f["a_tenant"], f["a_device"], f["a_user"])
        await f["session"].flush()

        with patch.object(commands, "validate_tenant_access", new=AsyncMock(return_value=True)):
            await commands.reject_command(
                tenant_id=f["a_tenant"],
                device_id=f["a_device"],
                command_id=command_id,
                session=f["session"],
                current_tenant=f["a_tenant"],
                current_user_id=f["a_user"],
            )

        result = await commands.list_pending_approvals(
            tenant_id=f["a_tenant"], session=f["session"], current_tenant=f["a_tenant"]
        )
        assert result.total == 0

        status = (
            await f["session"].execute(
                text("SELECT status, rejected_by FROM device_commands WHERE id = :i"),
                {"i": str(command_id)},
            )
        ).first()
        assert status[0] == "rejected"
        assert status[1] == f["a_user"]


class TestRoleGate:
    """Task 7.2 — the rule itself, and that MCP reads the same one."""

    def test_only_actuating_roles_pass(self):
        for role in COMMAND_ROLES:
            assert may_actuate_device(role), role
        for role in ("VIEWER", "CLIENT", "", None, "tenant_admin_ish"):
            assert not may_actuate_device(role), role

    def test_the_check_is_case_insensitive(self):
        assert may_actuate_device("tenant_admin")

    def test_mcp_reads_the_same_rule_rather_than_its_own_copy(self):
        """The two disagreed before this change — MCP restricted commands while
        the REST endpoint had no check at all. One definition, or they drift."""
        from app.mcp.auth import ToolContext

        for role in ("VIEWER", "CLIENT"):
            assert not ToolContext(uuid4(), uuid4(), role).may_issue_commands
        for role in COMMAND_ROLES:
            assert ToolContext(uuid4(), uuid4(), role).may_issue_commands

    @pytest.mark.asyncio
    async def test_a_viewer_is_refused_with_the_permitted_roles_named(self):
        """A refusal a user cannot act on becomes a support ticket."""
        with patch(
            "app.dependencies.get_current_user_info",
            new=AsyncMock(
                return_value={"user_id": uuid4(), "tenant_id": uuid4(), "role": "VIEWER"}
            ),
        ):
            with pytest.raises(HTTPException) as exc:
                await require_command_role(authorization="Bearer x")

        assert exc.value.status_code == 403
        for role in COMMAND_ROLES:
            assert role in exc.value.detail

    @pytest.mark.asyncio
    async def test_an_admin_passes_and_gets_their_user_id(self):
        """The dependency returns the actor so approve/reject record who decided
        without resolving the token a second time."""
        user_id = uuid4()
        with patch(
            "app.dependencies.get_current_user_info",
            new=AsyncMock(
                return_value={"user_id": user_id, "tenant_id": uuid4(), "role": "SITE_ADMIN"}
            ),
        ):
            assert await require_command_role(authorization="Bearer x") == user_id
