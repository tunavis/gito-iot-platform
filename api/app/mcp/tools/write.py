"""The one write an agent gets, and it does not write to a device.

`send_device_command` records a command for a person to approve. It dispatches
nothing. The gate is not in this file — it is in the database, as a `status` a
dispatcher does not act on, and in `routers/commands.py`, which is the only place
a command reaches a device. A tool that could be trusted to "remember not to
dispatch" would be a tool one edit away from dispatching.

The description matters as much as the code. A model that believes it turned a
pump off will tell someone it did. So the tool says, in the description the model
reads before choosing it and again in every result it returns, that the command
was *requested*.
"""

from __future__ import annotations

from typing import Any
from uuid import UUID

from app.mcp.auth import ToolContext
from app.mcp.shape import tool_session
from app.routers import commands


async def send_device_command(
    ctx: ToolContext,
    device_id: UUID,
    command_name: str,
    reason: str,
    parameters: dict | None = None,
) -> dict:
    # `reason` is positional and before `parameters` so it cannot be quietly
    # omitted. It is the only thing the approver has to judge by: without it the
    # screen says "close_valve on Pump 3" and the human step degrades into a
    # rubber stamp, which is indistinguishable from having no gate while looking
    # like one.
    if not (reason or "").strip():
        return {
            "error": "reason_required",
            "detail": (
                "State why this command is needed. A person has to approve it, and "
                "they are shown your reason — an instruction with no argument behind "
                "it will be refused."
            ),
        }

    async with tool_session(ctx) as session:
        command = await commands.request_command_approval(
            session=session,
            tenant_id=ctx.tenant_id,
            device_id=device_id,
            current_tenant=ctx.tenant_id,
            command_name=command_name,
            parameters=parameters or {},
            requested_by=ctx.user_id,
            reason=reason,
        )
        return {
            "dispatched": False,
            "status": command.status,
            "approval_reference": str(command.id),
            "device_id": str(device_id),
            "command_name": command_name,
            "expires_at": command.expires_at.isoformat(),
            # Repeated in the payload, not only in the tool description: the
            # description is read once when choosing the tool, the result is what
            # the model summarises to a person afterwards.
            "detail": (
                "Approval requested. Nothing was sent to the device and nothing will "
                "happen until a person approves this reference in the platform. Report "
                "this as a request awaiting approval — do not say the command ran."
            ),
        }


WRITE_TOOLS: list[tuple[str, Any, str]] = [
    (
        "send_device_command",
        send_device_command,
        "REQUEST a command on a device — this does NOT run it. The command is "
        "recorded for a person to approve in the platform, and nothing reaches "
        "the device unless they do. Returns an approval reference. Always report "
        "the outcome as 'requested approval to ...', never as if the device "
        "acted. `reason` is required and is shown verbatim to the person "
        "deciding: say what you observed and why this command follows from it, "
        "because they may have no other context. Valid command names and their "
        "parameters come from the device type's command schema; get_device tells "
        "you the device's type.",
    ),
]
