"""Device command (RPC) endpoints — Option B request-response correlation.

Send commands to devices and track their lifecycle:
  pending → sent → delivered → executed (or failed / timed_out)

Devices respond through normal telemetry with reserved keys:
  command_id, command_status, command_result, command_error
The MQTT processor correlates responses and updates command status.
"""

import logging
from datetime import datetime, timedelta, timezone
from typing import Annotated, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, select

from app.database import get_session, RLSSession
from app.models.base import Device, DeviceCommand
from app.models.device_type import DeviceType
from app.schemas.commands import CommandCreate, CommandListResponse, CommandResponse
from app.services.command_dispatch import CommandDispatchService
from app.services.tenant_access import validate_tenant_access
from app.dependencies import get_current_tenant, get_current_user_id

logger = logging.getLogger(__name__)

router = APIRouter(
    prefix="/tenants/{tenant_id}/devices/{device_id}/commands",
    tags=["device-commands"],
)

_dispatch = CommandDispatchService()

# How long a requested-but-unapproved command stays approvable. Long enough that
# an agent's request survives someone's lunch, short enough that approving one
# found the next morning is a deliberate act rather than a stale click.
APPROVAL_WINDOW = timedelta(hours=24)

# The device's window to answer, measured from approval. Matches CommandCreate's
# ttl_seconds default — the approval path takes no TTL of its own, because the
# requester is a model and the number would be a guess.
DEVICE_RESPONSE_TTL_SECONDS = 60


# ─────────────────────────────────────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────────────────────────────────────


async def _assert_supports_commands(session: RLSSession, device: Device) -> None:
    """Reject a command the device type says it cannot accept.

    Checked before recording an approval request too, not only before
    dispatching: putting a command a device can never run in front of a person
    to approve wastes the one reviewer the gate exists to involve.
    """
    if not device.device_type_id:
        return
    result = await session.execute(select(DeviceType).where(DeviceType.id == device.device_type_id))
    device_type = result.scalar_one_or_none()
    caps = device_type.capabilities if device_type else None
    if isinstance(caps, list) and "commands" not in caps:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Device type does not support commands",
        )


async def _dispatch_now(
    session: RLSSession, device: Device, command: DeviceCommand
) -> DeviceCommand:
    """Send a command to its device and record the outcome.

    The only place a command is dispatched. Both the ungated POST and the
    approval endpoint come through here, so "sent" means the same thing whichever
    path created the command, and there is one place to look when it does not.
    """
    success, error = await _dispatch.dispatch(device, command)

    if success:
        command.status = "sent"
        command.sent_at = datetime.now(timezone.utc)
    else:
        command.status = "failed"
        command.error_message = error
        command.completed_at = datetime.now(timezone.utc)

    await session.commit()
    await session.refresh(command)
    return command


async def _resolve_device(
    session: RLSSession,
    tenant_id: UUID,
    device_id: UUID,
    current_tenant: UUID,
) -> Device:
    """Validate tenant access, set RLS context, and return the device."""
    if not await validate_tenant_access(session, current_tenant, tenant_id):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Tenant access denied")

    await session.set_tenant_context(tenant_id)

    result = await session.execute(
        select(Device).where(Device.tenant_id == tenant_id, Device.id == device_id)
    )
    device = result.scalar_one_or_none()
    if not device:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Device not found")
    return device


# ─────────────────────────────────────────────────────────────────────────────
# Endpoints
# ─────────────────────────────────────────────────────────────────────────────


@router.post("", response_model=CommandResponse, status_code=status.HTTP_201_CREATED)
async def send_command(
    tenant_id: UUID,
    device_id: UUID,
    body: CommandCreate,
    session: Annotated[RLSSession, Depends(get_session)],
    current_tenant: Annotated[UUID, Depends(get_current_tenant)] = None,
):
    """Send an RPC command to a device.

    The command is dispatched via the device's native protocol (MQTT, HTTP, or LoRaWAN).
    The device should respond through its telemetry channel with the command_id to
    confirm execution.
    """
    device = await _resolve_device(session, tenant_id, device_id, current_tenant)
    await _assert_supports_commands(session, device)

    now = datetime.now(timezone.utc)
    command = DeviceCommand(
        tenant_id=tenant_id,
        device_id=device_id,
        command_name=body.command_name,
        parameters=body.parameters,
        status="pending",
        created_at=now,
        expires_at=now + timedelta(seconds=body.ttl_seconds),
    )
    session.add(command)
    await session.flush()  # get command.id for dispatch

    return await _dispatch_now(session, device, command)


async def request_command_approval(
    session: RLSSession,
    tenant_id: UUID,
    device_id: UUID,
    current_tenant: UUID,
    command_name: str,
    parameters: dict,
    requested_by: UUID,
) -> DeviceCommand:
    """Record a command for a person to approve. Dispatches nothing.

    Not an endpoint: the only caller is the MCP tool, and the reason it lives
    here rather than there is that everything which decides whether a command
    reaches a device belongs in one file. A tool that built this row itself
    could drift from the lifecycle the dispatcher expects.

    The command comes back with `status='awaiting_approval'`, which no dispatch
    path and no timeout sweep looks at, so nothing can pick it up by accident.
    """
    device = await _resolve_device(session, tenant_id, device_id, current_tenant)
    await _assert_supports_commands(session, device)

    now = datetime.now(timezone.utc)
    command = DeviceCommand(
        tenant_id=tenant_id,
        device_id=device_id,
        command_name=command_name,
        parameters=parameters,
        status="awaiting_approval",
        requested_by=requested_by,
        created_at=now,
        # The clock this row is waiting on is a person, not a radio, so it gets
        # the approval window. The device-response TTL starts at approval.
        expires_at=now + APPROVAL_WINDOW,
    )
    session.add(command)
    await session.commit()
    await session.refresh(command)
    return command


@router.post("/{command_id}/approve", response_model=CommandResponse)
async def approve_command(
    tenant_id: UUID,
    device_id: UUID,
    command_id: UUID,
    session: Annotated[RLSSession, Depends(get_session)],
    current_tenant: Annotated[UUID, Depends(get_current_tenant)] = None,
    current_user_id: Annotated[UUID, Depends(get_current_user_id)] = None,
):
    """Approve a command that was requested but not sent, and dispatch it.

    Only commands in `awaiting_approval` are approvable — everything issued
    through the ordinary POST above is dispatched immediately and is not gated,
    so there is nothing here to approve.

    Authorization matches the POST endpoint: tenant access. Requiring more of an
    approver than of someone who can already send the same command unapproved
    would be theatre, and the narrower rule belongs on both or neither.
    """
    device = await _resolve_device(session, tenant_id, device_id, current_tenant)

    result = await session.execute(
        select(DeviceCommand).where(
            DeviceCommand.id == command_id,
            DeviceCommand.tenant_id == tenant_id,
            DeviceCommand.device_id == device_id,
        )
        # Locked for the duration: two approvals arriving together would both
        # read 'awaiting_approval' and both dispatch, which for a command that
        # moves plant is the one outcome this whole gate exists to prevent.
        .with_for_update()
    )
    command = result.scalar_one_or_none()
    if not command:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Command not found")

    if command.status != "awaiting_approval":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Command is {command.status!r}, not awaiting approval.",
        )

    now = datetime.now(timezone.utc)
    if command.expires_at <= now:
        command.status = "timed_out"
        command.completed_at = now
        await session.commit()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Approval window has passed; request the command again.",
        )

    command.approved_by = current_user_id
    command.approved_at = now
    command.status = "pending"
    # Restart the clock: the TTL from here is the device's to answer within, and
    # it must not inherit whatever is left of the human's approval window.
    command.expires_at = now + timedelta(seconds=DEVICE_RESPONSE_TTL_SECONDS)

    return await _dispatch_now(session, device, command)


@router.get("", response_model=CommandListResponse)
async def list_commands(
    tenant_id: UUID,
    device_id: UUID,
    session: Annotated[RLSSession, Depends(get_session)],
    current_tenant: Annotated[UUID, Depends(get_current_tenant)] = None,
    status_filter: Optional[str] = Query(None, alias="status"),
    page: int = Query(1, ge=1),
    per_page: int = Query(20, ge=1, le=100),
):
    """List commands sent to a device, optionally filtered by status."""
    await _resolve_device(session, tenant_id, device_id, current_tenant)

    query = select(DeviceCommand).where(
        DeviceCommand.tenant_id == tenant_id,
        DeviceCommand.device_id == device_id,
    )
    count_query = (
        select(func.count())
        .select_from(DeviceCommand)
        .where(
            DeviceCommand.tenant_id == tenant_id,
            DeviceCommand.device_id == device_id,
        )
    )

    if status_filter:
        query = query.where(DeviceCommand.status == status_filter)
        count_query = count_query.where(DeviceCommand.status == status_filter)

    total_result = await session.execute(count_query)
    total = total_result.scalar() or 0

    query = query.order_by(DeviceCommand.created_at.desc())
    query = query.offset((page - 1) * per_page).limit(per_page)

    result = await session.execute(query)
    commands = result.scalars().all()

    return CommandListResponse(data=commands, total=total)


@router.get("/{command_id}", response_model=CommandResponse)
async def get_command(
    tenant_id: UUID,
    device_id: UUID,
    command_id: UUID,
    session: Annotated[RLSSession, Depends(get_session)],
    current_tenant: Annotated[UUID, Depends(get_current_tenant)] = None,
):
    """Get a single command with its current status and response."""
    await _resolve_device(session, tenant_id, device_id, current_tenant)

    result = await session.execute(
        select(DeviceCommand).where(
            DeviceCommand.id == command_id,
            DeviceCommand.tenant_id == tenant_id,
            DeviceCommand.device_id == device_id,
        )
    )
    command = result.scalar_one_or_none()
    if not command:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Command not found")

    return command
