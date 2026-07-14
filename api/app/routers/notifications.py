"""Notification system routes - channels, templates, and history."""

import logging
from datetime import datetime
from typing import List, Optional, Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select, and_, func

from app.database import get_session, RLSSession
from app.models import NotificationChannel, NotificationTemplate, Notification
from app.schemas.notifications import (
    NotificationTemplateSchema,
    NotificationTemplateUpdateSchema,
    NotificationTemplateResponseSchema,
)
from app.dependencies import get_current_tenant, get_current_user_id

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/tenants/{tenant_id}/notifications", tags=["notifications"])


# ============================================================================
# NOTIFICATION CHANNELS
# ============================================================================

@router.get("/channels")
async def list_channels(
    tenant_id: UUID,
    session: Annotated[RLSSession, Depends(get_session)],
    current_tenant: Annotated[UUID, Depends(get_current_tenant)],
):
    """List all notification channels for tenant."""
    if str(tenant_id) != str(current_tenant):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Tenant mismatch")
    await session.set_tenant_context(current_tenant)
    
    result = await session.execute(
        select(NotificationChannel).where(
            NotificationChannel.tenant_id == current_tenant
        )
    )
    channels = result.scalars().all()
    
    return {"data": [
        {
            "id": str(c.id),
            "user_id": str(c.user_id),
            "channel_type": c.channel_type,
            "config": c.config,
            "enabled": c.enabled,
            "verified": c.verified,
            "created_at": c.created_at.isoformat() if c.created_at else None,
            "updated_at": c.updated_at.isoformat() if c.updated_at else None,
        }
        for c in channels
    ]}


@router.post("/channels")
async def create_channel(
    tenant_id: UUID,
    channel_data: dict,
    session: Annotated[RLSSession, Depends(get_session)],
    current_tenant: Annotated[UUID, Depends(get_current_tenant)],
    current_user_id: Annotated[UUID, Depends(get_current_user_id)],
):
    """Create a new notification channel."""
    if str(tenant_id) != str(current_tenant):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Tenant mismatch")
    await session.set_tenant_context(current_tenant)
    
    # No verification flow exists (no confirmation email/webhook ping is ever
    # sent, verified_at is never set anywhere) — default to the model's honest
    # False rather than claiming every new channel is pre-verified.
    channel = NotificationChannel(
        tenant_id=current_tenant,
        user_id=current_user_id,
        channel_type=channel_data.get("channel_type"),
        config=channel_data.get("config", {}),
        enabled=channel_data.get("enabled", True),
    )
    
    session.add(channel)
    await session.commit()
    await session.refresh(channel)
    
    return {
        "id": str(channel.id),
        "user_id": str(channel.user_id),
        "channel_type": channel.channel_type,
        "config": channel.config,
        "enabled": channel.enabled,
        "verified": channel.verified,
    }


@router.put("/channels/{channel_id}")
async def update_channel(
    tenant_id: UUID,
    channel_id: UUID,
    channel_data: dict,
    session: Annotated[RLSSession, Depends(get_session)],
    current_tenant: Annotated[UUID, Depends(get_current_tenant)],
):
    """Update a notification channel."""
    if str(tenant_id) != str(current_tenant):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Tenant mismatch")
    await session.set_tenant_context(current_tenant)
    
    result = await session.execute(
        select(NotificationChannel).where(
            and_(
                NotificationChannel.id == channel_id,
                NotificationChannel.tenant_id == current_tenant
            )
        )
    )
    channel = result.scalar_one_or_none()
    
    if not channel:
        raise HTTPException(status_code=404, detail="Channel not found")
    
    # Update fields
    if "channel_type" in channel_data:
        channel.channel_type = channel_data["channel_type"]
    if "config" in channel_data:
        channel.config = channel_data["config"]
    if "enabled" in channel_data:
        channel.enabled = channel_data["enabled"]
    if "verified" in channel_data:
        channel.verified = channel_data["verified"]
    
    await session.commit()
    await session.refresh(channel)
    
    return {
        "id": str(channel.id),
        "user_id": str(channel.user_id),
        "channel_type": channel.channel_type,
        "config": channel.config,
        "enabled": channel.enabled,
        "verified": channel.verified,
    }


@router.delete("/channels/{channel_id}")
async def delete_channel(
    tenant_id: UUID,
    channel_id: UUID,
    session: Annotated[RLSSession, Depends(get_session)],
    current_tenant: Annotated[UUID, Depends(get_current_tenant)],
):
    """Delete a notification channel."""
    if str(tenant_id) != str(current_tenant):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Tenant mismatch")
    await session.set_tenant_context(current_tenant)
    
    result = await session.execute(
        select(NotificationChannel).where(
            and_(
                NotificationChannel.id == channel_id,
                NotificationChannel.tenant_id == current_tenant
            )
        )
    )
    channel = result.scalar_one_or_none()
    
    if not channel:
        raise HTTPException(status_code=404, detail="Channel not found")
    
    await session.delete(channel)
    await session.commit()
    
    return {"success": True}


# ============================================================================
# NOTIFICATION TEMPLATES
# ============================================================================

@router.get("/templates")
async def list_templates(
    tenant_id: UUID,
    session: Annotated[RLSSession, Depends(get_session)],
    current_tenant: Annotated[UUID, Depends(get_current_tenant)],
):
    """List all notification templates for tenant."""
    if str(tenant_id) != str(current_tenant):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Tenant mismatch")
    await session.set_tenant_context(current_tenant)

    result = await session.execute(
        select(NotificationTemplate).where(
            NotificationTemplate.tenant_id == current_tenant
        ).order_by(NotificationTemplate.created_at.desc())
    )
    templates = result.scalars().all()

    return {"data": [NotificationTemplateResponseSchema.model_validate(t, from_attributes=True) for t in templates]}


@router.post("/templates", response_model=NotificationTemplateResponseSchema, status_code=status.HTTP_201_CREATED)
async def create_template(
    tenant_id: UUID,
    body: NotificationTemplateSchema,
    session: Annotated[RLSSession, Depends(get_session)],
    current_tenant: Annotated[UUID, Depends(get_current_tenant)],
):
    """Create a notification template. Only one *enabled* template per channel_type is ever
    used (see notification_dispatcher._send) - alert_type is stored but not currently used to
    select between templates, so enabling a second template for the same channel just means
    whichever one the query happens to return first is the one that gets used."""
    if str(tenant_id) != str(current_tenant):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Tenant mismatch")
    await session.set_tenant_context(current_tenant)

    template = NotificationTemplate(tenant_id=current_tenant, **body.model_dump())
    session.add(template)
    await session.commit()
    await session.refresh(template)
    return template


@router.put("/templates/{template_id}", response_model=NotificationTemplateResponseSchema)
async def update_template(
    tenant_id: UUID,
    template_id: UUID,
    body: NotificationTemplateUpdateSchema,
    session: Annotated[RLSSession, Depends(get_session)],
    current_tenant: Annotated[UUID, Depends(get_current_tenant)],
):
    """Update a notification template."""
    if str(tenant_id) != str(current_tenant):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Tenant mismatch")
    await session.set_tenant_context(current_tenant)

    template = (await session.execute(
        select(NotificationTemplate).where(
            and_(NotificationTemplate.id == template_id, NotificationTemplate.tenant_id == current_tenant)
        )
    )).scalar_one_or_none()
    if not template:
        raise HTTPException(status_code=404, detail="Template not found")

    for field, value in body.model_dump(exclude_unset=True).items():
        setattr(template, field, value)
    template.updated_at = datetime.utcnow()

    await session.commit()
    await session.refresh(template)
    return template


@router.delete("/templates/{template_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_template(
    tenant_id: UUID,
    template_id: UUID,
    session: Annotated[RLSSession, Depends(get_session)],
    current_tenant: Annotated[UUID, Depends(get_current_tenant)],
):
    """Delete a notification template."""
    if str(tenant_id) != str(current_tenant):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Tenant mismatch")
    await session.set_tenant_context(current_tenant)

    template = (await session.execute(
        select(NotificationTemplate).where(
            and_(NotificationTemplate.id == template_id, NotificationTemplate.tenant_id == current_tenant)
        )
    )).scalar_one_or_none()
    if not template:
        raise HTTPException(status_code=404, detail="Template not found")

    await session.delete(template)
    await session.commit()


# ============================================================================
# NOTIFICATION HISTORY
# ============================================================================

@router.get("")
async def list_notifications(
    tenant_id: UUID,
    session: Annotated[RLSSession, Depends(get_session)],
    current_tenant: Annotated[UUID, Depends(get_current_tenant)],
    page: int = Query(1, ge=1),
    per_page: int = Query(50, ge=1, le=100),
):
    """List notification delivery history."""
    if str(tenant_id) != str(current_tenant):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Tenant mismatch")
    await session.set_tenant_context(current_tenant)
    
    offset = (page - 1) * per_page
    
    result = await session.execute(
        select(Notification)
        .where(Notification.tenant_id == current_tenant)
        .order_by(Notification.created_at.desc())
        .offset(offset)
        .limit(per_page)
    )
    notifications = result.scalars().all()
    
    # Get total count
    count_result = await session.execute(
        select(func.count(Notification.id)).where(
            Notification.tenant_id == current_tenant
        )
    )
    total = count_result.scalar()
    
    return {
        "data": [
            {
                "id": str(n.id),
                "channel_id": str(n.channel_id),
                "alert_event_id": str(n.alert_event_id),
                "channel_type": n.channel_type,
                "recipient": n.recipient,
                "status": n.status,
                "created_at": n.created_at.isoformat() if n.created_at else None,
                "sent_at": n.sent_at.isoformat() if n.sent_at else None,
            }
            for n in notifications
        ],
        "total": total,
        "page": page,
        "per_page": per_page,
    }
