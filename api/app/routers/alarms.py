"""
Alarms Router - Enterprise-grade alarm lifecycle management
Following Cumulocity patterns: ACTIVE → ACKNOWLEDGED → CLEARED
"""
from datetime import datetime
from typing import Optional, Annotated
from uuid import UUID
from fastapi import APIRouter, Depends, HTTPException, Query, Header, status
from sqlalchemy import select, func, and_
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_session, RLSSession
from app.models import Alarm
from app.schemas.alarm import (
    Alarm as AlarmSchema,
    AlarmCreate,
    AlarmAcknowledge,
    AlarmClear,
    AlarmSummary,
    AlarmListResponse,
)
from app.security import decode_token

router = APIRouter(prefix="/tenants/{tenant_id}/alarms", tags=["Alarms"])


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


@router.get("/summary", response_model=AlarmSummary)
async def get_alarm_summary(
    tenant_id: UUID,
    session: Annotated[RLSSession, Depends(get_session)],
    current_tenant: Annotated[UUID, Depends(get_current_tenant)],
    status: Optional[str] = Query(None, description="Filter by status"),
    severity: Optional[str] = Query(None, description="Filter by severity"),
    device_id: Optional[UUID] = Query(None, description="Filter by device"),
):
    """Get alarm summary statistics"""
    if str(tenant_id) != str(current_tenant):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Tenant mismatch")
    
    await session.set_tenant_context(tenant_id)

    # Build filter
    filters = [Alarm.tenant_id == tenant_id]
    if status:
        filters.append(Alarm.status == status.upper())
    if severity:
        filters.append(Alarm.severity == severity.upper())
    if device_id:
        filters.append(Alarm.device_id == device_id)

    # Total count
    total_query = select(func.count(Alarm.id)).where(and_(*filters))
    total_result = await session.execute(total_query)
    total = total_result.scalar() or 0

    # Status counts
    active_query = select(func.count(Alarm.id)).where(
        and_(*filters, Alarm.status == "ACTIVE")
    )
    active_result = await session.execute(active_query)
    active = active_result.scalar() or 0

    acknowledged_query = select(func.count(Alarm.id)).where(
        and_(*filters, Alarm.status == "ACKNOWLEDGED")
    )
    ack_result = await session.execute(acknowledged_query)
    acknowledged = ack_result.scalar() or 0

    cleared_query = select(func.count(Alarm.id)).where(
        and_(*filters, Alarm.status == "CLEARED")
    )
    cleared_result = await session.execute(cleared_query)
    cleared = cleared_result.scalar() or 0

    # Severity counts
    severity_query = select(
        Alarm.severity, func.count(Alarm.id)
    ).where(and_(*filters)).group_by(Alarm.severity)
    severity_result = await session.execute(severity_query)
    by_severity = {row[0]: row[1] for row in severity_result}

    return AlarmSummary(
        total=total,
        active=active,
        acknowledged=acknowledged,
        cleared=cleared,
        by_severity=by_severity,
    )


@router.get("", response_model=AlarmListResponse)
async def list_alarms(
    tenant_id: UUID,
    session: Annotated[RLSSession, Depends(get_session)],
    current_tenant: Annotated[UUID, Depends(get_current_tenant)],
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=100),
    status: Optional[str] = Query(None, description="Filter by status"),
    severity: Optional[str] = Query(None, description="Filter by severity"),
    device_id: Optional[UUID] = Query(None, description="Filter by device"),
    alarm_type: Optional[str] = Query(None, description="Filter by alarm type"),
):
    """List alarms with filtering and pagination"""
    if str(tenant_id) != str(current_tenant):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Tenant mismatch")
    
    await session.set_tenant_context(tenant_id)

    # Build filters
    filters = [Alarm.tenant_id == tenant_id]
    if status:
        filters.append(Alarm.status == status.upper())
    if severity:
        filters.append(Alarm.severity == severity.upper())
    if device_id:
        filters.append(Alarm.device_id == device_id)
    if alarm_type:
        filters.append(Alarm.alarm_type == alarm_type)

    # Count total
    count_query = select(func.count(Alarm.id)).where(and_(*filters))
    count_result = await session.execute(count_query)
    total = count_result.scalar() or 0

    # Get page of alarms
    offset = (page - 1) * page_size
    query = (
        select(Alarm)
        .where(and_(*filters))
        .order_by(Alarm.fired_at.desc())
        .offset(offset)
        .limit(page_size)
    )
    result = await session.execute(query)
    alarms = result.scalars().all()

    return AlarmListResponse(
        alarms=[AlarmSchema.model_validate(a) for a in alarms],
        total=total,
        page=page,
        page_size=page_size,
    )


@router.get("/{alarm_id}", response_model=AlarmSchema)
async def get_alarm(
    tenant_id: UUID,
    alarm_id: UUID,
    session: Annotated[RLSSession, Depends(get_session)],
    current_tenant: Annotated[UUID, Depends(get_current_tenant)],
):
    """Get a specific alarm"""
    if str(tenant_id) != str(current_tenant):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Tenant mismatch")
    
    await session.set_tenant_context(tenant_id)

    query = select(Alarm).where(Alarm.id == alarm_id, Alarm.tenant_id == tenant_id)
    result = await session.execute(query)
    alarm = result.scalar_one_or_none()

    if not alarm:
        raise HTTPException(status_code=404, detail="Alarm not found")

    return AlarmSchema.model_validate(alarm)


@router.post("", response_model=AlarmSchema, status_code=status.HTTP_201_CREATED)
async def create_alarm(
    alarm_data: AlarmCreate,
    tenant_id: UUID,
    session: Annotated[RLSSession, Depends(get_session)],
    current_tenant: Annotated[UUID, Depends(get_current_tenant)],
):
    """Create a new alarm (manual alarm creation)"""
    if str(tenant_id) != str(current_tenant):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Tenant mismatch")
    
    await session.set_tenant_context(tenant_id)

    alarm = Alarm(
        tenant_id=tenant_id,
        alert_rule_id=alarm_data.alert_rule_id,
        device_id=alarm_data.device_id,
        alarm_type=alarm_data.alarm_type,
        source=alarm_data.source,
        severity=alarm_data.severity.upper(),
        status="ACTIVE",
        message=alarm_data.message,
        context=alarm_data.context,
        fired_at=datetime.utcnow(),
    )

    session.add(alarm)
    await session.commit()
    await session.refresh(alarm)

    return AlarmSchema.model_validate(alarm)


@router.post("/{alarm_id}/acknowledge", response_model=AlarmSchema)
async def acknowledge_alarm(
    ack_data: AlarmAcknowledge,
    tenant_id: UUID,
    alarm_id: UUID,
    session: Annotated[RLSSession, Depends(get_session)],
    current_tenant: Annotated[UUID, Depends(get_current_tenant)],
    authorization: str = Header(None),
):
    """
    Acknowledge an alarm (transition ACTIVE → ACKNOWLEDGED)
    Indicates operator is aware and investigating
    """
    if str(tenant_id) != str(current_tenant):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Tenant mismatch")
    
    # Get user ID from token
    token = authorization.split(" ")[1]
    payload = decode_token(token)
    user_id = UUID(payload.get("sub"))
    
    await session.set_tenant_context(tenant_id)

    # Get alarm
    query = select(Alarm).where(Alarm.id == alarm_id, Alarm.tenant_id == tenant_id)
    result = await session.execute(query)
    alarm = result.scalar_one_or_none()

    if not alarm:
        raise HTTPException(status_code=404, detail="Alarm not found")

    if alarm.status != "ACTIVE":
        raise HTTPException(
            status_code=400,
            detail=f"Cannot acknowledge alarm in {alarm.status} state. Only ACTIVE alarms can be acknowledged.",
        )

    # Acknowledge
    alarm.status = "ACKNOWLEDGED"
    alarm.acknowledged_by = user_id
    alarm.acknowledged_at = datetime.utcnow()
    if ack_data.comment:
        if not alarm.context:
            alarm.context = {}
        alarm.context["ack_comment"] = ack_data.comment

    await session.commit()
    await session.refresh(alarm)

    return AlarmSchema.model_validate(alarm)


@router.post("/{alarm_id}/clear", response_model=AlarmSchema)
async def clear_alarm(
    clear_data: AlarmClear,
    tenant_id: UUID,
    alarm_id: UUID,
    session: Annotated[RLSSession, Depends(get_session)],
    current_tenant: Annotated[UUID, Depends(get_current_tenant)],
):
    """
    Clear an alarm (transition ACKNOWLEDGED → CLEARED)
    Indicates issue is resolved
    """
    if str(tenant_id) != str(current_tenant):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Tenant mismatch")
    
    await session.set_tenant_context(tenant_id)

    # Get alarm
    query = select(Alarm).where(Alarm.id == alarm_id, Alarm.tenant_id == tenant_id)
    result = await session.execute(query)
    alarm = result.scalar_one_or_none()

    if not alarm:
        raise HTTPException(status_code=404, detail="Alarm not found")

    # Can clear from ACTIVE or ACKNOWLEDGED
    if alarm.status == "CLEARED":
        raise HTTPException(
            status_code=400,
            detail="Alarm is already cleared",
        )

    # Clear
    alarm.status = "CLEARED"
    alarm.cleared_at = datetime.utcnow()
    if clear_data.comment:
        if not alarm.context:
            alarm.context = {}
        alarm.context["clear_comment"] = clear_data.comment

    await session.commit()
    await session.refresh(alarm)

    return AlarmSchema.model_validate(alarm)


@router.delete("/{alarm_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_alarm(
    tenant_id: UUID,
    alarm_id: UUID,
    session: Annotated[RLSSession, Depends(get_session)],
    current_tenant: Annotated[UUID, Depends(get_current_tenant)],
):
    """Delete an alarm (only CLEARED alarms can be deleted)"""
    if str(tenant_id) != str(current_tenant):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Tenant mismatch")
    
    await session.set_tenant_context(tenant_id)

    # Get alarm
    query = select(Alarm).where(Alarm.id == alarm_id, Alarm.tenant_id == tenant_id)
    result = await session.execute(query)
    alarm = result.scalar_one_or_none()

    if not alarm:
        raise HTTPException(status_code=404, detail="Alarm not found")

    if alarm.status != "CLEARED":
        raise HTTPException(
            status_code=400,
            detail="Only CLEARED alarms can be deleted. Clear the alarm first.",
        )

    await session.delete(alarm)
    await session.commit()
