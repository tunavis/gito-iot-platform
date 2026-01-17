"""Alarms API - Cumulocity-style alarm management with severity levels and acknowledgment workflow."""

from fastapi import APIRouter, Depends, HTTPException, status, Query, Header
from sqlalchemy import select, func, and_, or_
from sqlalchemy.ext.asyncio import AsyncSession
from typing import Annotated, Optional, List
from uuid import UUID
from datetime import datetime
from pydantic import BaseModel, Field
from enum import Enum

from app.database import get_session, RLSSession
from app.models.base import AlertEvent, Device
from app.schemas.common import SuccessResponse, PaginationMeta
from app.security import decode_token

router = APIRouter(prefix="/tenants/{tenant_id}/alarms", tags=["alarms"])


async def get_current_tenant(
    authorization: str = Header(None),
) -> UUID:
    """Extract and validate tenant_id from JWT token."""
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing or invalid Authorization header",
        )
    
    token = authorization.split(" ")[1]
    payload = decode_token(token)
    tenant_id = payload.get("tenant_id")
    
    if not tenant_id:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid token: missing tenant_id",
        )
    
    return UUID(tenant_id)


# Enums
class AlarmSeverity(str, Enum):
    CRITICAL = "CRITICAL"
    MAJOR = "MAJOR"
    MINOR = "MINOR"
    WARNING = "WARNING"


class AlarmStatus(str, Enum):
    ACTIVE = "ACTIVE"
    ACKNOWLEDGED = "ACKNOWLEDGED"
    CLEARED = "CLEARED"


# Schemas
class AlarmCreate(BaseModel):
    device_id: UUID
    alert_rule_id: Optional[UUID] = None
    alarm_type: str = Field(..., min_length=1, max_length=100)
    severity: AlarmSeverity = AlarmSeverity.MAJOR
    message: str
    source: Optional[str] = Field(None, max_length=100)
    metric_name: Optional[str] = Field(None, max_length=50)
    metric_value: Optional[float] = None


class AlarmUpdate(BaseModel):
    severity: Optional[AlarmSeverity] = None
    message: Optional[str] = None


class AlarmAcknowledge(BaseModel):
    """Request to acknowledge an alarm."""
    pass


class AlarmClear(BaseModel):
    """Request to clear an alarm."""
    pass


class AlarmResponse(BaseModel):
    id: UUID
    tenant_id: UUID
    device_id: UUID
    alert_rule_id: Optional[UUID]
    alarm_type: str
    severity: AlarmSeverity
    status: AlarmStatus
    message: Optional[str]
    source: Optional[str]
    metric_name: Optional[str]
    metric_value: Optional[float]
    acknowledged_by: Optional[UUID]
    acknowledged_at: Optional[datetime]
    cleared_at: Optional[datetime]
    fired_at: datetime

    class Config:
        from_attributes = True


class AlarmSummary(BaseModel):
    """Alarm counts by severity and status."""
    critical_active: int = 0
    critical_acknowledged: int = 0
    major_active: int = 0
    major_acknowledged: int = 0
    minor_active: int = 0
    minor_acknowledged: int = 0
    warning_active: int = 0
    warning_acknowledged: int = 0


@router.get("", response_model=SuccessResponse)
async def list_alarms(
    tenant_id: UUID,
    session: Annotated[RLSSession, Depends(get_session)],
    current_tenant: Annotated[UUID, Depends(get_current_tenant)],
    page: int = Query(1, ge=1),
    per_page: int = Query(50, ge=1, le=100),
    device_id: Optional[UUID] = Query(None),
    severity: Optional[List[AlarmSeverity]] = Query(None),
    status: Optional[List[AlarmStatus]] = Query(None),
    alarm_type: Optional[str] = Query(None),
):
    """List alarms with filtering by device, severity, status, and type."""
    if str(tenant_id) != str(current_tenant):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Tenant mismatch")
    
    await session.set_tenant_context(tenant_id)
    
    # Build query
    query = select(AlertEvent).where(AlertEvent.tenant_id == tenant_id)
    
    if device_id:
        query = query.where(AlertEvent.device_id == device_id)
    if severity:
        query = query.where(AlertEvent.severity.in_([s.value for s in severity]))
    if status:
        query = query.where(AlertEvent.status.in_([s.value for s in status]))
    if alarm_type:
        query = query.where(AlertEvent.alarm_type == alarm_type)
    
    query = query.order_by(AlertEvent.fired_at.desc())
    
    # Count total
    count_query = select(func.count()).select_from(AlertEvent).where(AlertEvent.tenant_id == tenant_id)
    if device_id:
        count_query = count_query.where(AlertEvent.device_id == device_id)
    if severity:
        count_query = count_query.where(AlertEvent.severity.in_([s.value for s in severity]))
    if status:
        count_query = count_query.where(AlertEvent.status.in_([s.value for s in status]))
    if alarm_type:
        count_query = count_query.where(AlertEvent.alarm_type == alarm_type)
    
    total_result = await session.execute(count_query)
    total = total_result.scalar() or 0
    
    # Paginate
    query = query.offset((page - 1) * per_page).limit(per_page)
    result = await session.execute(query)
    alarms = result.scalars().all()
    
    return SuccessResponse(
        data=[AlarmResponse.from_orm(alarm) for alarm in alarms],
        meta=PaginationMeta(page=page, per_page=per_page, total=total)
    )


@router.get("/summary", response_model=SuccessResponse)
async def get_alarm_summary(
    tenant_id: UUID,
    session: Annotated[RLSSession, Depends(get_session)],
    current_tenant: Annotated[UUID, Depends(get_current_tenant)],
    device_id: Optional[UUID] = Query(None),
):
    """Get alarm counts by severity and status for dashboard display."""
    if str(tenant_id) != str(current_tenant):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Tenant mismatch")
    
    await session.set_tenant_context(tenant_id)
    
    # Build base query
    base_query = select(
        AlertEvent.severity,
        AlertEvent.status,
        func.count().label('count')
    ).where(
        AlertEvent.tenant_id == tenant_id,
        AlertEvent.status.in_(['ACTIVE', 'ACKNOWLEDGED'])
    )
    
    if device_id:
        base_query = base_query.where(AlertEvent.device_id == device_id)
    
    base_query = base_query.group_by(AlertEvent.severity, AlertEvent.status)
    
    result = await session.execute(base_query)
    rows = result.all()
    
    # Build summary dict
    summary = AlarmSummary()
    for row in rows:
        severity = row.severity.lower()
        status = row.status.lower()
        field_name = f"{severity}_{status}"
        if hasattr(summary, field_name):
            setattr(summary, field_name, row.count)
    
    return SuccessResponse(data=summary)


@router.post("", response_model=SuccessResponse, status_code=status.HTTP_201_CREATED)
async def create_alarm(
    tenant_id: UUID,
    alarm_data: AlarmCreate,
    session: Annotated[RLSSession, Depends(get_session)],
    current_tenant: Annotated[UUID, Depends(get_current_tenant)],
):
    """Create a new alarm manually (for system-generated alarms)."""
    if str(tenant_id) != str(current_tenant):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Tenant mismatch")
    
    await session.set_tenant_context(tenant_id)
    
    # Verify device exists
    device_result = await session.execute(
        select(Device).where(
            Device.tenant_id == tenant_id,
            Device.id == alarm_data.device_id
        )
    )
    if not device_result.scalar_one_or_none():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Device not found")
    
    # Create alarm
    alarm = AlertEvent(
        tenant_id=tenant_id,
        device_id=alarm_data.device_id,
        alert_rule_id=alarm_data.alert_rule_id,
        alarm_type=alarm_data.alarm_type,
        severity=alarm_data.severity.value,
        status="ACTIVE",
        message=alarm_data.message,
        source=alarm_data.source,
        metric_name=alarm_data.metric_name,
        metric_value=alarm_data.metric_value,
    )
    
    session.add(alarm)
    await session.commit()
    await session.refresh(alarm)
    
    return SuccessResponse(data=AlarmResponse.from_orm(alarm))


@router.get("/{alarm_id}", response_model=SuccessResponse)
async def get_alarm(
    tenant_id: UUID,
    alarm_id: UUID,
    session: Annotated[RLSSession, Depends(get_session)],
    current_tenant: Annotated[UUID, Depends(get_current_tenant)],
):
    """Get a specific alarm by ID."""
    if str(tenant_id) != str(current_tenant):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Tenant mismatch")
    
    await session.set_tenant_context(tenant_id)
    
    result = await session.execute(
        select(AlertEvent).where(
            AlertEvent.tenant_id == tenant_id,
            AlertEvent.id == alarm_id
        )
    )
    alarm = result.scalar_one_or_none()
    
    if not alarm:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Alarm not found")
    
    return SuccessResponse(data=AlarmResponse.from_orm(alarm))


@router.put("/{alarm_id}", response_model=SuccessResponse)
async def update_alarm(
    tenant_id: UUID,
    alarm_id: UUID,
    alarm_data: AlarmUpdate,
    session: Annotated[RLSSession, Depends(get_session)],
    current_tenant: Annotated[UUID, Depends(get_current_tenant)],
):
    """Update alarm severity or message (does not change status)."""
    if str(tenant_id) != str(current_tenant):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Tenant mismatch")
    
    await session.set_tenant_context(tenant_id)
    
    result = await session.execute(
        select(AlertEvent).where(
            AlertEvent.tenant_id == tenant_id,
            AlertEvent.id == alarm_id
        )
    )
    alarm = result.scalar_one_or_none()
    
    if not alarm:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Alarm not found")
    
    # Update fields
    if alarm_data.severity:
        alarm.severity = alarm_data.severity.value
    if alarm_data.message:
        alarm.message = alarm_data.message
    
    await session.commit()
    await session.refresh(alarm)
    
    return SuccessResponse(data=AlarmResponse.from_orm(alarm))


@router.post("/{alarm_id}/acknowledge", response_model=SuccessResponse)
async def acknowledge_alarm(
    tenant_id: UUID,
    alarm_id: UUID,
    session: Annotated[RLSSession, Depends(get_session)],
    current_tenant: Annotated[UUID, Depends(get_current_tenant)],
    authorization: str = Header(None),
):
    """Acknowledge an alarm (status: ACTIVE → ACKNOWLEDGED)."""
    if str(tenant_id) != str(current_tenant):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Tenant mismatch")
    
    await session.set_tenant_context(tenant_id)
    
    # Get user ID from token
    token = authorization.split(" ")[1]
    payload = decode_token(token)
    user_id = UUID(payload.get("sub"))
    
    result = await session.execute(
        select(AlertEvent).where(
            AlertEvent.tenant_id == tenant_id,
            AlertEvent.id == alarm_id
        )
    )
    alarm = result.scalar_one_or_none()
    
    if not alarm:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Alarm not found")
    
    if alarm.status != "ACTIVE":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Alarm must be ACTIVE to acknowledge (current status: {alarm.status})"
        )
    
    # Update to acknowledged
    alarm.status = "ACKNOWLEDGED"
    alarm.acknowledged_by = user_id
    alarm.acknowledged_at = datetime.utcnow()
    
    await session.commit()
    await session.refresh(alarm)
    
    return SuccessResponse(data=AlarmResponse.from_orm(alarm))


@router.post("/{alarm_id}/clear", response_model=SuccessResponse)
async def clear_alarm(
    tenant_id: UUID,
    alarm_id: UUID,
    session: Annotated[RLSSession, Depends(get_session)],
    current_tenant: Annotated[UUID, Depends(get_current_tenant)],
):
    """Clear an alarm (status: ACTIVE/ACKNOWLEDGED → CLEARED)."""
    if str(tenant_id) != str(current_tenant):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Tenant mismatch")
    
    await session.set_tenant_context(tenant_id)
    
    result = await session.execute(
        select(AlertEvent).where(
            AlertEvent.tenant_id == tenant_id,
            AlertEvent.id == alarm_id
        )
    )
    alarm = result.scalar_one_or_none()
    
    if not alarm:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Alarm not found")
    
    if alarm.status == "CLEARED":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Alarm is already cleared"
        )
    
    # Update to cleared
    alarm.status = "CLEARED"
    alarm.cleared_at = datetime.utcnow()
    
    await session.commit()
    await session.refresh(alarm)
    
    return SuccessResponse(data=AlarmResponse.from_orm(alarm))


@router.delete("/{alarm_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_alarm(
    tenant_id: UUID,
    alarm_id: UUID,
    session: Annotated[RLSSession, Depends(get_session)],
    current_tenant: Annotated[UUID, Depends(get_current_tenant)],
):
    """Delete an alarm (use sparingly - clearing is preferred)."""
    if str(tenant_id) != str(current_tenant):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Tenant mismatch")
    
    await session.set_tenant_context(tenant_id)
    
    result = await session.execute(
        select(AlertEvent).where(
            AlertEvent.tenant_id == tenant_id,
            AlertEvent.id == alarm_id
        )
    )
    alarm = result.scalar_one_or_none()
    
    if not alarm:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Alarm not found")
    
    await session.delete(alarm)
    await session.commit()
