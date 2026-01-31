"""Notification Rules API - Route alerts to notification channels."""

from fastapi import APIRouter, Depends, HTTPException, status, Query, Header
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession
from typing import Annotated, Optional
from uuid import UUID
from datetime import datetime

from app.database import get_session, RLSSession
from app.models.notification import NotificationRule
from app.schemas.notification_rule import (
    NotificationRuleCreate,
    NotificationRuleUpdate,
    NotificationRuleResponse,
)
from app.schemas.common import SuccessResponse, PaginationMeta
from app.security import decode_token

router = APIRouter(prefix="/tenants/{tenant_id}/notification-rules", tags=["notification-rules"])


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
async def list_notification_rules(
    tenant_id: UUID,
    session: Annotated[RLSSession, Depends(get_session)],
    current_tenant: Annotated[UUID, Depends(get_current_tenant)],
    page: int = Query(1, ge=1),
    per_page: int = Query(50, ge=1, le=100),
    alert_rule_id: Optional[UUID] = Query(None, description="Filter by alert rule"),
    channel_id: Optional[UUID] = Query(None, description="Filter by channel"),
    enabled: Optional[bool] = Query(None, description="Filter by enabled status"),
):
    """List all notification rules for a tenant.

    Args:
        tenant_id: Tenant UUID from path
        alert_rule_id: Filter by specific alert rule
        channel_id: Filter by specific channel
        enabled: Filter by enabled status
        page: Page number (1-indexed)
        per_page: Items per page (max 100)

    Returns:
        Paginated list of notification rules
    """
    if str(tenant_id) != str(current_tenant):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Tenant mismatch")

    await session.set_tenant_context(tenant_id)

    # Build query
    query = select(NotificationRule).where(NotificationRule.tenant_id == tenant_id)

    if alert_rule_id:
        query = query.where(NotificationRule.alert_rule_id == alert_rule_id)

    if channel_id:
        query = query.where(NotificationRule.channel_id == channel_id)

    if enabled is not None:
        query = query.where(NotificationRule.enabled == enabled)

    query = query.order_by(NotificationRule.created_at.desc())

    # Count total
    count_query = select(func.count()).select_from(query.subquery())
    total = (await session.execute(count_query)).scalar()

    # Paginate
    offset = (page - 1) * per_page
    query = query.offset(offset).limit(per_page)

    result = await session.execute(query)
    rules = result.scalars().all()

    return SuccessResponse(
        data=[NotificationRuleResponse.model_validate(rule) for rule in rules],
        meta=PaginationMeta(page=page, per_page=per_page, total=total),
    )


@router.get("/{rule_id}", response_model=SuccessResponse[NotificationRuleResponse])
async def get_notification_rule(
    tenant_id: UUID,
    rule_id: UUID,
    session: Annotated[RLSSession, Depends(get_session)],
    current_tenant: Annotated[UUID, Depends(get_current_tenant)],
):
    """Get a specific notification rule by ID.

    Args:
        tenant_id: Tenant UUID from path
        rule_id: Notification rule UUID from path

    Returns:
        Notification rule details
    """
    if str(tenant_id) != str(current_tenant):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Tenant mismatch")

    await session.set_tenant_context(tenant_id)

    query = select(NotificationRule).where(
        NotificationRule.id == rule_id,
        NotificationRule.tenant_id == tenant_id
    )
    result = await session.execute(query)
    rule = result.scalar_one_or_none()

    if not rule:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Notification rule not found")

    return SuccessResponse(data=NotificationRuleResponse.model_validate(rule))


@router.post("", response_model=SuccessResponse[NotificationRuleResponse], status_code=status.HTTP_201_CREATED)
async def create_notification_rule(
    tenant_id: UUID,
    request: NotificationRuleCreate,
    session: Annotated[RLSSession, Depends(get_session)],
    current_tenant: Annotated[UUID, Depends(get_current_tenant)],
):
    """Create a new notification rule.

    Args:
        tenant_id: Tenant UUID from path
        request: Notification rule creation data

    Returns:
        Created notification rule details

    Raises:
        409: If rule already exists for this alert_rule + channel combination
    """
    if str(tenant_id) != str(current_tenant):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Tenant mismatch")

    await session.set_tenant_context(tenant_id)

    # Check if rule already exists
    existing_query = select(NotificationRule).where(
        NotificationRule.tenant_id == tenant_id,
        NotificationRule.alert_rule_id == request.alert_rule_id,
        NotificationRule.channel_id == request.channel_id
    )
    result = await session.execute(existing_query)
    if result.scalar_one_or_none():
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Notification rule already exists for this alert rule and channel combination"
        )

    # Create rule
    rule = NotificationRule(
        tenant_id=tenant_id,
        alert_rule_id=request.alert_rule_id,
        channel_id=request.channel_id,
        enabled=request.enabled,
        created_at=datetime.utcnow(),
        updated_at=datetime.utcnow(),
    )

    session.add(rule)
    await session.commit()
    await session.refresh(rule)

    return SuccessResponse(data=NotificationRuleResponse.model_validate(rule))


@router.put("/{rule_id}", response_model=SuccessResponse[NotificationRuleResponse])
async def update_notification_rule(
    tenant_id: UUID,
    rule_id: UUID,
    request: NotificationRuleUpdate,
    session: Annotated[RLSSession, Depends(get_session)],
    current_tenant: Annotated[UUID, Depends(get_current_tenant)],
):
    """Update a notification rule.

    Args:
        tenant_id: Tenant UUID from path
        rule_id: Notification rule UUID from path
        request: Notification rule update data

    Returns:
        Updated notification rule details
    """
    if str(tenant_id) != str(current_tenant):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Tenant mismatch")

    await session.set_tenant_context(tenant_id)

    # Get existing rule
    query = select(NotificationRule).where(
        NotificationRule.id == rule_id,
        NotificationRule.tenant_id == tenant_id
    )
    result = await session.execute(query)
    rule = result.scalar_one_or_none()

    if not rule:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Notification rule not found")

    # Update fields
    update_data = request.model_dump(exclude_unset=True)
    for key, value in update_data.items():
        setattr(rule, key, value)

    rule.updated_at = datetime.utcnow()

    await session.commit()
    await session.refresh(rule)

    return SuccessResponse(data=NotificationRuleResponse.model_validate(rule))


@router.delete("/{rule_id}", response_model=SuccessResponse)
async def delete_notification_rule(
    tenant_id: UUID,
    rule_id: UUID,
    session: Annotated[RLSSession, Depends(get_session)],
    current_tenant: Annotated[UUID, Depends(get_current_tenant)],
):
    """Delete a notification rule.

    Args:
        tenant_id: Tenant UUID from path
        rule_id: Notification rule UUID from path

    Returns:
        Success message
    """
    if str(tenant_id) != str(current_tenant):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Tenant mismatch")

    await session.set_tenant_context(tenant_id)

    # Get rule
    query = select(NotificationRule).where(
        NotificationRule.id == rule_id,
        NotificationRule.tenant_id == tenant_id
    )
    result = await session.execute(query)
    rule = result.scalar_one_or_none()

    if not rule:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Notification rule not found")

    await session.delete(rule)
    await session.commit()

    return SuccessResponse(data={"message": "Notification rule deleted successfully"})
