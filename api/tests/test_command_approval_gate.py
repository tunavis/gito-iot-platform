"""The approval gate: nothing reaches a device without a person, and then once.

Task 5.5. These assert against `_dispatch.dispatch` itself — the single function
that puts bytes on a device's transport — rather than against statuses, because
a status is what the code believes and the dispatch call is what actually
happened.
"""

import os

os.environ.setdefault("DATABASE_URL", "postgresql+asyncpg://test:test@localhost:5432/test")
os.environ.setdefault("JWT_SECRET_KEY", "test-secret-key-for-unit-tests-only-32ch")
os.environ.setdefault("MQTT_PASSWORD", "test-mqtt-password")

from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import uuid4

import pytest
from fastapi import HTTPException

from app.models.base import Device, DeviceCommand
from app.routers import commands


def _session(*scalars):
    """A session whose successive `execute()` calls yield the given objects."""
    session = AsyncMock()
    session.execute = AsyncMock(
        side_effect=[MagicMock(scalar_one_or_none=MagicMock(return_value=s)) for s in scalars]
    )
    session.set_tenant_context = AsyncMock()
    session.commit = AsyncMock()
    session.refresh = AsyncMock()
    session.add = MagicMock()
    return session


def _device(tenant_id):
    return Device(id=uuid4(), tenant_id=tenant_id, name="Pump 3", device_type="pump")


def _awaiting(tenant_id, device_id, *, expires_in_hours=24):
    return DeviceCommand(
        id=uuid4(),
        tenant_id=tenant_id,
        device_id=device_id,
        command_name="close_valve",
        parameters={},
        status="awaiting_approval",
        requested_by=uuid4(),
        created_at=datetime.now(timezone.utc),
        expires_at=datetime.now(timezone.utc) + timedelta(hours=expires_in_hours),
    )


class TestUnapprovedNeverReachesTheDevice:
    @pytest.mark.asyncio
    async def test_requesting_approval_dispatches_nothing(self):
        tenant_id = uuid4()
        device = _device(tenant_id)
        session = _session(device, None)  # device lookup, then device-type lookup

        with patch.object(
            commands, "validate_tenant_access", new=AsyncMock(return_value=True)
        ), patch.object(commands._dispatch, "dispatch", new=AsyncMock()) as dispatch:
            command = await commands.request_command_approval(
                session=session,
                tenant_id=tenant_id,
                device_id=device.id,
                current_tenant=tenant_id,
                command_name="close_valve",
                parameters={"position": 0},
                requested_by=uuid4(),
                reason="Downstream pressure is climbing past the safe band.",
            )

        dispatch.assert_not_called()
        assert command.status == "awaiting_approval"
        assert command.sent_at is None

    def test_awaiting_approval_is_invisible_to_the_timeout_sweep(self):
        """The sweep moves pending/sent/delivered to timed_out on the device TTL.

        An approval request waits on a person, so it must not be in that set —
        otherwise every request would expire on the radio's clock.
        """
        import inspect

        from app.services.background_tasks import NotificationBackgroundTasks

        source = inspect.getsource(NotificationBackgroundTasks.expire_timed_out_commands)
        assert "'pending', 'sent', 'delivered'" in source
        assert "awaiting_approval" not in source


class TestApprovalDispatchesExactlyOnce:
    @pytest.mark.asyncio
    async def test_approving_dispatches_once(self):
        tenant_id = uuid4()
        device = _device(tenant_id)
        command = _awaiting(tenant_id, device.id)
        session = _session(device, command)

        with patch.object(
            commands, "validate_tenant_access", new=AsyncMock(return_value=True)
        ), patch.object(
            commands._dispatch, "dispatch", new=AsyncMock(return_value=(True, ""))
        ) as dispatch:
            result = await commands.approve_command(
                tenant_id=tenant_id,
                device_id=device.id,
                command_id=command.id,
                session=session,
                current_tenant=tenant_id,
                current_user_id=uuid4(),
            )

        assert dispatch.await_count == 1
        assert result.status == "sent"
        assert result.approved_by is not None

    @pytest.mark.asyncio
    async def test_approving_twice_dispatches_once(self):
        """The second approval sees a command that is no longer awaiting one.

        This is the property the whole gate turns on: an agent, a retry, or two
        operators clicking together must not move plant twice.
        """
        tenant_id = uuid4()
        device = _device(tenant_id)
        command = _awaiting(tenant_id, device.id)

        with patch.object(
            commands, "validate_tenant_access", new=AsyncMock(return_value=True)
        ), patch.object(
            commands._dispatch, "dispatch", new=AsyncMock(return_value=(True, ""))
        ) as dispatch:
            await commands.approve_command(
                tenant_id=tenant_id,
                device_id=device.id,
                command_id=command.id,
                session=_session(device, command),
                current_tenant=tenant_id,
                current_user_id=uuid4(),
            )
            with pytest.raises(HTTPException) as exc:
                await commands.approve_command(
                    tenant_id=tenant_id,
                    device_id=device.id,
                    command_id=command.id,
                    session=_session(device, command),
                    current_tenant=tenant_id,
                    current_user_id=uuid4(),
                )

        assert exc.value.status_code == 409
        assert dispatch.await_count == 1

    @pytest.mark.asyncio
    async def test_an_expired_request_is_refused_not_sent(self):
        tenant_id = uuid4()
        device = _device(tenant_id)
        command = _awaiting(tenant_id, device.id, expires_in_hours=-1)

        with patch.object(
            commands, "validate_tenant_access", new=AsyncMock(return_value=True)
        ), patch.object(commands._dispatch, "dispatch", new=AsyncMock()) as dispatch:
            with pytest.raises(HTTPException) as exc:
                await commands.approve_command(
                    tenant_id=tenant_id,
                    device_id=device.id,
                    command_id=command.id,
                    session=_session(device, command),
                    current_tenant=tenant_id,
                    current_user_id=uuid4(),
                )

        assert exc.value.status_code == 409
        dispatch.assert_not_called()
        assert command.status == "timed_out"

    @pytest.mark.asyncio
    async def test_an_ungated_command_cannot_be_approved(self):
        """Nothing from the ordinary POST path is approvable — it already ran."""
        tenant_id = uuid4()
        device = _device(tenant_id)
        command = _awaiting(tenant_id, device.id)
        command.status = "sent"

        with patch.object(
            commands, "validate_tenant_access", new=AsyncMock(return_value=True)
        ), patch.object(commands._dispatch, "dispatch", new=AsyncMock()) as dispatch:
            with pytest.raises(HTTPException) as exc:
                await commands.approve_command(
                    tenant_id=tenant_id,
                    device_id=device.id,
                    command_id=command.id,
                    session=_session(device, command),
                    current_tenant=tenant_id,
                    current_user_id=uuid4(),
                )

        assert exc.value.status_code == 409
        dispatch.assert_not_called()


class TestToolSurface:
    def test_the_write_tool_is_role_gated_and_says_it_does_not_execute(self):
        from app.mcp.server import build_mcp_server
        from app.mcp.tools import COMMAND_ROLE_TOOLS
        from app.mcp.tools.write import WRITE_TOOLS

        build_mcp_server()
        assert "send_device_command" in COMMAND_ROLE_TOOLS

        description = {n: d for n, _, d in WRITE_TOOLS}["send_device_command"]
        assert "does NOT run it" in description
        assert "approve" in description

    def test_list_tools_override_still_hooks_the_sdk(self):
        """The role filter overrides a private handler; if the SDK renames it the
        filter would silently stop applying, which is the failure mode a security
        filter must not have."""
        from mcp.server.mcpserver import MCPServer

        assert hasattr(MCPServer, "_handle_list_tools")

    @pytest.mark.asyncio
    async def test_a_viewer_is_not_shown_the_command_tool(self):
        from mcp.server.mcpserver import MCPServer
        from mcp.types import ListToolsResult, Tool

        from app.mcp.auth import ToolContext
        from app.mcp.server import TenantScopedMCPServer

        server = TenantScopedMCPServer(name="t")
        listed = ListToolsResult(
            tools=[
                Tool(name="list_devices", inputSchema={}),
                Tool(name="send_device_command", inputSchema={}),
            ]
        )
        ctx = MagicMock(request=MagicMock(headers={"authorization": "Bearer x"}))

        # Patch the base handler so this exercises the filter, not the registry.
        with patch.object(
            MCPServer, "_handle_list_tools", new=AsyncMock(return_value=listed)
        ), patch(
            "app.mcp.server.resolve_context",
            new=AsyncMock(return_value=ToolContext(uuid4(), uuid4(), "VIEWER")),
        ):
            result = await server._handle_list_tools(ctx, None)

        assert [t.name for t in result.tools] == ["list_devices"]
