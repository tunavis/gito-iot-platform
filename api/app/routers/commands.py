"""Device command (RPC) endpoints — Option B request-response correlation.

Send commands to devices and track their lifecycle:
  pending → sent → delivered → executed (or failed / timed_out)

A device type whose driver lists a command as unacknowledgeable goes
  pending → delivered_unconfirmed
instead, terminal on delivery, because that device will never answer.

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
from sqlalchemy.exc import IntegrityError

from app.database import get_session, RLSSession
from app.models.base import Device, DeviceCommand, User
from app.models.device_type import DeviceType
from app.models.site import Site
from app.schemas.commands import (
    CommandCreate,
    CommandListResponse,
    CommandResponse,
    PendingApproval,
    PendingApprovalListResponse,
)
from app.services.command_dispatch import CommandDispatchService
from payload_codec.driver import (
    command_opcode,
    driver_for,
    is_unacknowledgeable,
    response_window_seconds,
)
from app.services.tenant_access import validate_tenant_access
from app.dependencies import get_current_tenant, require_command_role

logger = logging.getLogger(__name__)

router = APIRouter(
    prefix="/tenants/{tenant_id}/devices/{device_id}/commands",
    tags=["device-commands"],
)

# A second router, tenant-scoped rather than device-scoped. The approval queue
# has to answer "what is waiting anywhere in my fleet", and the device-scoped
# list above can only answer it for someone who already knows which device to
# suspect — which is the whole reason a requested command was invisible.
#
# Kept in this file rather than a new module: everything that decides whether a
# command reaches a device lives together, for the same reason
# `request_command_approval` does.
approvals_router = APIRouter(
    prefix="/tenants/{tenant_id}/command-approvals",
    tags=["device-commands"],
)

_dispatch = CommandDispatchService()

# How long a requested-but-unapproved command stays approvable. Long enough that
# an agent's request survives someone's lunch, short enough that approving one
# found the next morning is a deliberate act rather than a stale click.
APPROVAL_WINDOW = timedelta(hours=24)

# The device's window to answer, for a device type that declares no driver.
#
# It is no longer a tuning value: a driver's `response_window_seconds` replaces
# it for any type that declares one, because sixty seconds against a B METERS
# IWM reporting every twelve hours — over NFC only, so not adjustable remotely —
# is not mistuned, it is wrong by three orders of magnitude. This constant
# survives as the default for everything that has not declared otherwise, which
# is what keeps today's behaviour today's behaviour.
DEVICE_RESPONSE_TTL_SECONDS = 60


# ─────────────────────────────────────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────────────────────────────────────


async def _resolve_device_type(session: RLSSession, device: Device) -> Optional[DeviceType]:
    """Load the device's type, rejecting a command the type says it cannot accept.

    Returns the type so its driver can be read once and carried through encoding,
    protocol selection and timing — three questions with one answer, which is the
    point of the driver being a single declaration.

    The capability check happens before recording an approval request too, not
    only before dispatching: putting a command a device can never run in front of
    a person to approve wastes the one reviewer the gate exists to involve.
    """
    if not device.device_type_id:
        return None
    result = await session.execute(select(DeviceType).where(DeviceType.id == device.device_type_id))
    device_type = result.scalar_one_or_none()
    caps = device_type.capabilities if device_type else None
    if isinstance(caps, list) and "commands" not in caps:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Device type does not support commands",
        )
    return device_type


async def _reserve_opcode(session: RLSSession, command: DeviceCommand) -> None:
    """Flush a command holding its opcode, refusing a second one in flight.

    The uniqueness is a partial index (migration 030), not a check here, because
    two dispatches arriving together would both read "nothing outstanding" and
    both proceed. This function only turns the database's refusal into an
    answer a caller can act on — it is not the guard, and must never become it.

    Flushing is done **before** anything is dispatched, so a refused command has
    not already reached the device.
    """
    try:
        await session.flush()
    except IntegrityError as e:
        if "uq_device_commands_inflight_opcode" not in str(e.orig):
            raise
        await session.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(
                f"Another command using opcode 0x{command.opcode:02x} is already "
                f"awaiting an answer from this device. This device identifies its "
                f"answers only by opcode, so a second one in flight would make both "
                f"replies ambiguous. Wait for the first, or let it expire."
            ),
        ) from e


async def _dispatch_now(
    session: RLSSession,
    device: Device,
    command: DeviceCommand,
    device_type: Optional[DeviceType] = None,
) -> DeviceCommand:
    """Send a command to its device and record the outcome.

    The only place a command is dispatched. Both the ungated POST and the
    approval endpoint come through here, so "sent" means the same thing whichever
    path created the command, and there is one place to look when it does not.
    """
    driver = driver_for(device_type)
    success, error = await _dispatch.dispatch(device, command, driver, device_type)

    if success and is_unacknowledgeable(driver, command.command_name):
        # Terminal on delivery. This device can never answer this command — an
        # IWM RESET restarts the microcontroller, an RFM 0x03 0x05 re-joins with
        # factory defaults — so leaving it pending guarantees it is swept to
        # `timed_out`, which records a correctly delivered command as a failure.
        command.status = "delivered_unconfirmed"
        command.sent_at = datetime.now(timezone.utc)
        command.completed_at = command.sent_at
    elif success:
        command.status = "sent"
        command.sent_at = datetime.now(timezone.utc)
    else:
        command.status = "failed"
        command.error_message = error
        command.completed_at = datetime.now(timezone.utc)

    await session.commit()
    await session.refresh(command)
    return command


async def _lock_pending_for_decision(
    session: RLSSession,
    tenant_id: UUID,
    device_id: UUID,
    command_id: UUID,
    current_tenant: UUID,
) -> tuple[Device, DeviceCommand, datetime]:
    """Load a command that is genuinely awaiting a decision, and hold the row.

    Shared by approve and reject so the preconditions cannot drift apart — a
    reject that accepted an already-approved command, or skipped the lock, would
    be a quiet hole in the same gate approve is careful about.

    Returns `(device, command, now)`; `now` is returned rather than re-read so
    both the expiry check and the timestamps written afterwards agree on one
    instant.
    """
    device = await _resolve_device(session, tenant_id, device_id, current_tenant)

    result = await session.execute(
        select(DeviceCommand).where(
            DeviceCommand.id == command_id,
            DeviceCommand.tenant_id == tenant_id,
            DeviceCommand.device_id == device_id,
        )
        # Locked for the duration: two decisions arriving together would both
        # read 'awaiting_approval' and both proceed, which for a command that
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

    return device, command, now


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
    _actor: Annotated[UUID, Depends(require_command_role)] = None,
):
    """Send an RPC command to a device.

    The command is dispatched via the device's native protocol (MQTT, HTTP, or LoRaWAN).
    The device should respond through its telemetry channel with the command_id to
    confirm execution.

    Restricted to roles that may actuate a device. This endpoint previously
    accepted any authenticated tenant user, which made the approval gate on the
    agent path walkable: anyone refused at approve could issue the identical
    command here.
    """
    device = await _resolve_device(session, tenant_id, device_id, current_tenant)
    device_type = await _resolve_device_type(session, device)

    # An explicit ttl_seconds still wins — a caller asking for a shorter window
    # has made a deliberate choice and is capped at an hour anyway. Omitting it
    # is what defers to the device type, which is the only party that knows
    # whether this radio can answer inside a minute.
    driver = driver_for(device_type)
    ttl = body.ttl_seconds
    if ttl is None:
        ttl = response_window_seconds(driver, DEVICE_RESPONSE_TTL_SECONDS)

    now = datetime.now(timezone.utc)
    command = DeviceCommand(
        tenant_id=tenant_id,
        device_id=device_id,
        command_name=body.command_name,
        parameters=body.parameters,
        status="pending",
        created_at=now,
        expires_at=now + timedelta(seconds=ttl),
        opcode=command_opcode(driver, body.command_name),
    )
    session.add(command)
    await _reserve_opcode(session, command)  # also gets command.id for dispatch

    return await _dispatch_now(session, device, command, device_type)


@approvals_router.get("", response_model=PendingApprovalListResponse)
async def list_pending_approvals(
    tenant_id: UUID,
    session: Annotated[RLSSession, Depends(get_session)],
    current_tenant: Annotated[UUID, Depends(get_current_tenant)] = None,
):
    """Every command in this tenant waiting on a human decision.

    Expired requests are excluded rather than shown greyed out: an approver
    cannot act on one — approve refuses it — so listing it offers a decision
    that does not exist. They fall out of the queue and can be re-requested.

    Readable by any tenant user; only deciding is role-restricted. Someone who
    may not approve can still usefully see that something is waiting.
    """
    if not await validate_tenant_access(session, current_tenant, tenant_id):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Tenant access denied")

    await session.set_tenant_context(tenant_id)

    rows = (
        (
            await session.execute(
                select(
                    DeviceCommand.id,
                    DeviceCommand.device_id,
                    Device.name.label("device_name"),
                    Device.site_id,
                    Site.name.label("site_name"),
                    DeviceCommand.command_name,
                    DeviceCommand.parameters,
                    DeviceCommand.request_reason,
                    DeviceCommand.requested_by,
                    User.email.label("requested_by_email"),
                    DeviceCommand.created_at,
                    DeviceCommand.expires_at,
                )
                .join(Device, Device.id == DeviceCommand.device_id)
                # Outer joins: a device need not sit at a site, and `requested_by` is
                # nullable and SET NULL on user delete. An inner join would silently
                # drop exactly the requests nobody is left to explain.
                .outerjoin(Site, Site.id == Device.site_id)
                .outerjoin(User, User.id == DeviceCommand.requested_by)
                .where(
                    DeviceCommand.tenant_id == tenant_id,
                    DeviceCommand.status == "awaiting_approval",
                    DeviceCommand.expires_at > datetime.now(timezone.utc),
                )
                # Oldest first: the one closest to lapsing is the one that needs a
                # decision soonest.
                .order_by(DeviceCommand.created_at.asc())
            )
        )
        .mappings()
        .all()
    )

    items = [PendingApproval(**row) for row in rows]
    # The count is the length of what was returned, not a second COUNT query —
    # a badge that disagrees with the list it links to is worse than no badge.
    return PendingApprovalListResponse(data=items, total=len(items))


async def request_command_approval(
    session: RLSSession,
    tenant_id: UUID,
    device_id: UUID,
    current_tenant: UUID,
    command_name: str,
    parameters: dict,
    requested_by: UUID,
    reason: str,
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
    device_type = await _resolve_device_type(session, device)

    now = datetime.now(timezone.utc)
    command = DeviceCommand(
        tenant_id=tenant_id,
        device_id=device_id,
        command_name=command_name,
        # Recorded now, constrained later: the in-flight index covers
        # pending/sent/delivered only, so a request may wait behind a command
        # already in flight. The conflict, if there is one, surfaces at approve
        # — which is where it becomes real and where a person is looking.
        opcode=command_opcode(driver_for(device_type), command_name),
        parameters=parameters,
        status="awaiting_approval",
        requested_by=requested_by,
        # Capped rather than validated: this is free text from a model, and the
        # approver reads it. It is never dispatched to a device and never
        # interpolated into SQL; React escapes it on the way to the screen.
        request_reason=(reason or "").strip()[:1000],
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
    current_user_id: Annotated[UUID, Depends(require_command_role)] = None,
):
    """Approve a command that was requested but not sent, and dispatch it.

    Only commands in `awaiting_approval` are approvable — everything issued
    through the ordinary POST above is dispatched immediately and is not gated,
    so there is nothing here to approve.

    Restricted to roles that may actuate a device — the same rule the POST above
    now carries, so an approver is someone who could have issued the command
    themselves. Self-approval is permitted and reported: blocking it would break
    single-admin tenants and buy nothing, since that admin can use the POST path
    directly. The control this gate provides is that a human looked.
    """
    device, command, now = await _lock_pending_for_decision(
        session, tenant_id, device_id, command_id, current_tenant
    )

    device_type = await _resolve_device_type(session, device)

    command.approved_by = current_user_id
    command.approved_at = now
    command.status = "pending"
    # Restart the clock: the TTL from here is the device's to answer within, and
    # it must not inherit whatever is left of the human's approval window. The
    # length is the device type's if it declares one — this path takes no TTL
    # from its caller, because the requester is a model and the number would be
    # a guess.
    command.expires_at = now + timedelta(
        seconds=response_window_seconds(driver_for(device_type), DEVICE_RESPONSE_TTL_SECONDS)
    )

    # `pending` is the first status the in-flight opcode index covers, so this is
    # where a second identical command is refused — before dispatch, and while
    # the row lock from `_lock_pending_for_decision` is still held.
    await _reserve_opcode(session, command)

    return await _dispatch_now(session, device, command, device_type)


@router.post("/{command_id}/reject", response_model=CommandResponse)
async def reject_command(
    tenant_id: UUID,
    device_id: UUID,
    command_id: UUID,
    session: Annotated[RLSSession, Depends(get_session)],
    current_tenant: Annotated[UUID, Depends(get_current_tenant)] = None,
    current_user_id: Annotated[UUID, Depends(require_command_role)] = None,
):
    """Refuse a requested command. Nothing is dispatched, and the refusal is kept.

    The point of recording this rather than letting the request lapse: without
    it, "nobody approved this" and "someone looked at it and said no" are the
    same row, which is exactly the distinction an audit of agent behaviour needs.

    Terminal. A rejected command is never swept to `timed_out` — the sweep only
    touches pending/sent/delivered — because rewriting it would erase the refusal.
    """
    _, command, now = await _lock_pending_for_decision(
        session, tenant_id, device_id, command_id, current_tenant
    )

    command.rejected_by = current_user_id
    command.rejected_at = now
    command.status = "rejected"
    command.completed_at = now

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
