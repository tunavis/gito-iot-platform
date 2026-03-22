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
from app.dependencies import get_current_tenant

logger = logging.getLogger(__name__)

router = APIRouter(
    prefix="/tenants/{tenant_id}/devices/{device_id}/commands",
    tags=["device-commands"],
)

_dispatch = CommandDispatchService()


# ─────────────────────────────────────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────────────────────────────────────

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

    # Check device type capabilities if available
    if device.device_type_id:
        dt_result = await session.execute(
            select(DeviceType).where(DeviceType.id == device.device_type_id)
        )
        device_type = dt_result.scalar_one_or_none()
        if device_type and device_type.capabilities:
            caps = device_type.capabilities
            if isinstance(caps, list) and "commands" not in caps:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Device type does not support commands",
                )

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
    count_query = select(func.count()).select_from(DeviceCommand).where(
        DeviceCommand.tenant_id == tenant_id,
        DeviceCommand.device_id == device_id,
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
