"""Events API — IoT event stream (device lifecycle, alarm changes, custom events).

GET  /tenants/{id}/events          → paginated event list with filters
POST /tenants/{id}/events          → emit a custom event (internal / automation use)
"""

from datetime import datetime, timezone
from typing import Annotated, List, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, Header, HTTPException, Query, status
from pydantic import BaseModel
from sqlalchemy import select, func, and_
from sqlalchemy.orm import selectinload

from app.database import RLSSession, get_session
from app.services.tenant_access import validate_tenant_access
from app.models.event import Event
from app.models.base import Device
from app.security import decode_token

router = APIRouter(prefix="/tenants/{tenant_id}/events", tags=["events"])


# ── Auth dependency ────────────────────────────────────────────────────────────

async def _get_current_tenant(authorization: str = Header(None)) -> UUID:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing or invalid Authorization header",
        )
    payload = decode_token(authorization.split(" ")[1])
    tenant_id = payload.get("tenant_id")
    if not tenant_id:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid token: missing tenant_id",
        )
    return UUID(tenant_id)


# ── Schemas ────────────────────────────────────────────────────────────────────

class EventResponse(BaseModel):
    id: str
    tenant_id: str
    device_id: Optional[str] = None
    device_name: Optional[str] = None
    event_type: str
    severity: str
    message: Optional[str] = None
    payload: dict
    ts: datetime


class EventCreate(BaseModel):
    device_id: Optional[UUID] = None
    event_type: str
    severity: str = "INFO"
    message: Optional[str] = None
    payload: dict = {}
    ts: Optional[datetime] = None


class EventListResponse(BaseModel):
    data: List[EventResponse]
    meta: dict


# ── Endpoints ──────────────────────────────────────────────────────────────────

@router.get("", response_model=EventListResponse)
async def list_events(
    tenant_id: UUID,
    session: Annotated[RLSSession, Depends(get_session)],
    current_tenant: Annotated[UUID, Depends(_get_current_tenant)],
    device_id: Optional[UUID] = Query(None),
    event_type: Optional[str] = Query(None),
    severity: Optional[str] = Query(None, pattern="^(INFO|WARNING|ERROR|CRITICAL)$"),
    from_ts: Optional[datetime] = Query(None, alias="from"),
    to_ts: Optional[datetime] = Query(None, alias="to"),
    page: int = Query(1, ge=1),
    per_page: int = Query(50, ge=1, le=200),
):
    """List events for a tenant with optional filters."""
    if not await validate_tenant_access(session, current_tenant, tenant_id):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Tenant access denied")

    await session.set_tenant_context(tenant_id)

    # Build filter conditions
    conditions = [Event.tenant_id == tenant_id]
    if device_id:
        conditions.append(Event.device_id == device_id)
    if event_type:
        conditions.append(Event.event_type == event_type)
    if severity:
        conditions.append(Event.severity == severity)
    if from_ts:
        conditions.append(Event.ts >= from_ts)
    if to_ts:
        conditions.append(Event.ts <= to_ts)

    where_clause = and_(*conditions)

    # Count
    total = (await session.execute(
        select(func.count(Event.id)).where(where_clause)
    )).scalar_one()

    # Fetch events + device names in one join
    rows = (await session.execute(
        select(Event, Device.name.label("device_name"))
        .outerjoin(Device, Event.device_id == Device.id)
        .where(where_clause)
        .order_by(Event.ts.desc())
        .offset((page - 1) * per_page)
        .limit(per_page)
    )).all()

    events = [
        EventResponse(
            id=str(row.Event.id),
            tenant_id=str(row.Event.tenant_id),
            device_id=str(row.Event.device_id) if row.Event.device_id else None,
            device_name=row.device_name,
            event_type=row.Event.event_type,
            severity=row.Event.severity,
            message=row.Event.message,
            payload=row.Event.payload or {},
            ts=row.Event.ts,
        )
        for row in rows
    ]

    return EventListResponse(
        data=events,
        meta={
            "total": total,
            "page": page,
            "per_page": per_page,
            "pages": (total + per_page - 1) // per_page,
        },
    )


@router.post("", response_model=EventResponse, status_code=status.HTTP_201_CREATED)
async def create_event(
    tenant_id: UUID,
    body: EventCreate,
    session: Annotated[RLSSession, Depends(get_session)],
    current_tenant: Annotated[UUID, Depends(_get_current_tenant)],
):
    """Emit a custom event (for automation rules, webhooks, or manual testing)."""
    if not await validate_tenant_access(session, current_tenant, tenant_id):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Tenant access denied")

    await session.set_tenant_context(tenant_id)

    event = Event(
        tenant_id=tenant_id,
        device_id=body.device_id,
        event_type=body.event_type,
        severity=body.severity,
        message=body.message,
        payload=body.payload,
        ts=body.ts or datetime.now(timezone.utc),
    )
    session.add(event)
    await session.flush()
    await session.refresh(event)

    # Fetch device name if device_id provided
    device_name = None
    if event.device_id:
        device = (await session.execute(
            select(Device).where(Device.id == event.device_id)
        )).scalar_one_or_none()
        device_name = device.name if device else None

    return EventResponse(
        id=str(event.id),
        tenant_id=str(event.tenant_id),
        device_id=str(event.device_id) if event.device_id else None,
        device_name=device_name,
        event_type=event.event_type,
        severity=event.severity,
        message=event.message,
        payload=event.payload or {},
        ts=event.ts,
    )
