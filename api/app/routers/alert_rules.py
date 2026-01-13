"""Alert rules management routes - threshold-based alert configuration."""

from fastapi import APIRouter, Depends, HTTPException, status, Query, Header
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession
from typing import Annotated
from uuid import UUID

from app.database import get_session, RLSSession
from app.models.base import AlertRule, Device
from app.schemas.alert import AlertRuleCreate, AlertRuleUpdate, AlertRuleResponse
from app.schemas.common import SuccessResponse, PaginationMeta
from app.security import decode_token

router = APIRouter(prefix="/tenants/{tenant_id}/alert-rules", tags=["alert_rules"])


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


@router.get("", response_model=SuccessResponse)
async def list_alert_rules(
    tenant_id: UUID,
    session: Annotated[RLSSession, Depends(get_session)],
    current_tenant: Annotated[UUID, Depends(get_current_tenant)] = None,
    device_id: UUID | None = Query(None),
    active_only: bool = Query(False),
    page: int = Query(1, ge=1),
    per_page: int = Query(50, ge=1, le=100),
):
    """
    List alert rules for tenant.
    
    Optional filters:
    - device_id: Filter by specific device
    - active_only: Show only active rules
    """
    if str(tenant_id) != str(current_tenant):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Tenant mismatch",
        )
    
    await session.set_tenant_context(tenant_id)
    
    # Build query
    query = select(AlertRule).where(AlertRule.tenant_id == tenant_id)
    
    if device_id:
        query = query.where(AlertRule.device_id == device_id)
    
    if active_only:
        query = query.where(AlertRule.active == "1")
    
    # Count total
    count_query = select(func.count(AlertRule.id)).where(AlertRule.tenant_id == tenant_id)
    if device_id:
        count_query = count_query.where(AlertRule.device_id == device_id)
    if active_only:
        count_query = count_query.where(AlertRule.active == "1")
    
    count_result = await session.execute(count_query)
    total = count_result.scalar() or 0
    
    # Pagination
    offset = (page - 1) * per_page
    query = query.offset(offset).limit(per_page).order_by(AlertRule.created_at.desc())
    
    result = await session.execute(query)
    rules = result.scalars().all()
    
    return SuccessResponse(
        data=[AlertRuleResponse.from_orm(r) for r in rules],
        meta=PaginationMeta(page=page, per_page=per_page, total=total),
    )


@router.post("", response_model=SuccessResponse, status_code=status.HTTP_201_CREATED)
async def create_alert_rule(
    tenant_id: UUID,
    rule_data: AlertRuleCreate,
    session: Annotated[RLSSession, Depends(get_session)],
    current_tenant: Annotated[UUID, Depends(get_current_tenant)] = None,
):
    """Create a new alert rule for a device."""
    if str(tenant_id) != str(current_tenant):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Tenant mismatch",
        )
    
    await session.set_tenant_context(tenant_id)
    
    # Verify device exists and belongs to tenant
    device_query = select(Device).where(
        Device.tenant_id == tenant_id,
        Device.id == rule_data.device_id,
    )
    device_result = await session.execute(device_query)
    device = device_result.scalar_one_or_none()
    
    if not device:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Device not found",
        )
    
    # Create rule
    rule = AlertRule(
        tenant_id=tenant_id,
        device_id=rule_data.device_id,
        metric=rule_data.metric,
        operator=rule_data.operator,
        threshold=rule_data.threshold,
        cooldown_minutes=rule_data.cooldown_minutes,
        active="1",
    )
    
    session.add(rule)
    await session.commit()
    await session.refresh(rule)
    
    return SuccessResponse(data=AlertRuleResponse.from_orm(rule))


@router.get("/{rule_id}", response_model=SuccessResponse)
async def get_alert_rule(
    tenant_id: UUID,
    rule_id: UUID,
    session: Annotated[RLSSession, Depends(get_session)],
    current_tenant: Annotated[UUID, Depends(get_current_tenant)] = None,
):
    """Get alert rule details."""
    if str(tenant_id) != str(current_tenant):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Tenant mismatch",
        )
    
    await session.set_tenant_context(tenant_id)
    
    query = select(AlertRule).where(
        AlertRule.tenant_id == tenant_id,
        AlertRule.id == rule_id,
    )
    result = await session.execute(query)
    rule = result.scalar_one_or_none()
    
    if not rule:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Alert rule not found",
        )
    
    return SuccessResponse(data=AlertRuleResponse.from_orm(rule))


@router.put("/{rule_id}", response_model=SuccessResponse)
async def update_alert_rule(
    tenant_id: UUID,
    rule_id: UUID,
    rule_data: AlertRuleUpdate,
    session: Annotated[RLSSession, Depends(get_session)],
    current_tenant: Annotated[UUID, Depends(get_current_tenant)] = None,
):
    """Update alert rule."""
    if str(tenant_id) != str(current_tenant):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Tenant mismatch",
        )
    
    await session.set_tenant_context(tenant_id)
    
    query = select(AlertRule).where(
        AlertRule.tenant_id == tenant_id,
        AlertRule.id == rule_id,
    )
    result = await session.execute(query)
    rule = result.scalar_one_or_none()
    
    if not rule:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Alert rule not found",
        )
    
    # Update fields
    if rule_data.operator is not None:
        rule.operator = rule_data.operator
    if rule_data.threshold is not None:
        rule.threshold = rule_data.threshold
    if rule_data.cooldown_minutes is not None:
        rule.cooldown_minutes = rule_data.cooldown_minutes
    if rule_data.active is not None:
        rule.active = "1" if rule_data.active else "0"
    
    await session.commit()
    await session.refresh(rule)
    
    return SuccessResponse(data=AlertRuleResponse.from_orm(rule))


@router.delete("/{rule_id}", response_model=SuccessResponse)
async def delete_alert_rule(
    tenant_id: UUID,
    rule_id: UUID,
    session: Annotated[RLSSession, Depends(get_session)],
    current_tenant: Annotated[UUID, Depends(get_current_tenant)] = None,
):
    """Delete alert rule."""
    if str(tenant_id) != str(current_tenant):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Tenant mismatch",
        )
    
    await session.set_tenant_context(tenant_id)
    
    query = select(AlertRule).where(
        AlertRule.tenant_id == tenant_id,
        AlertRule.id == rule_id,
    )
    result = await session.execute(query)
    rule = result.scalar_one_or_none()
    
    if not rule:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Alert rule not found",
        )
    
    await session.delete(rule)
    await session.commit()
    
    return SuccessResponse(data={"message": "Alert rule deleted"})
