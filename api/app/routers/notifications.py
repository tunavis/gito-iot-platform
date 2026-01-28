"""Notification system routes - channels, templates, and history."""

import logging
from typing import List, Optional, Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Header, status
from sqlalchemy import select, and_, func

from app.database import get_session, RLSSession
from app.models import NotificationChannel, NotificationTemplate, Notification
from app.security import decode_token

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/tenants/{tenant_id}/notifications", tags=["notifications"])


async def get_current_tenant(
    tenant_id: UUID,
    authorization: str = Header(None),
) -> UUID:
    """Extract and validate tenant_id from JWT token and verify it matches path."""
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing or invalid Authorization header",
        )
    
    token = authorization.split(" ")[1]
    payload = decode_token(token)
    token_tenant_id = payload.get("tenant_id")
    
    if not token_tenant_id:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid token: missing tenant_id",
        )
    
    # Verify path tenant matches token tenant
    if str(tenant_id) != str(token_tenant_id):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Tenant mismatch",
        )
    
    return UUID(token_tenant_id)


async def get_current_user_id(
    authorization: str = Header(None),
) -> UUID:
    """Extract user_id from JWT token."""
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing or invalid Authorization header",
        )
    
    token = authorization.split(" ")[1]
    payload = decode_token(token)
    return UUID(payload["sub"])


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
    await session.set_tenant_context(current_tenant)
    
    channel = NotificationChannel(
        tenant_id=current_tenant,
        user_id=current_user_id,
        channel_type=channel_data.get("channel_type"),
        config=channel_data.get("config", {}),
        enabled=channel_data.get("enabled", True),
        verified=True
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
    await session.set_tenant_context(current_tenant)
    
    result = await session.execute(
        select(NotificationTemplate).where(
            NotificationTemplate.tenant_id == current_tenant
        )
    )
    templates = result.scalars().all()
    
    return {"data": [
        {
            "id": str(t.id),
            "channel_type": t.channel_type,
            "alert_type": t.alert_type,
            "name": t.name,
            "subject": t.subject,
            "body": t.body,
            "enabled": t.enabled,
        }
        for t in templates
    ]}


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
