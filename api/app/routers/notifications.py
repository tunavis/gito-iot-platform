"""API routes for notification system."""

import logging
from typing import List, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select, and_
from sqlalchemy.orm import Session

from app.core.auth import get_current_user
from app.core.database import get_session
from app.models import User, NotificationChannel, NotificationRule, Notification, NotificationTemplate
from app.schemas.notifications import (
    CreateNotificationChannelSchema,
    UpdateNotificationChannelSchema,
    NotificationChannelResponseSchema,
    NotificationPreferencesSchema,
    CreateNotificationRuleSchema,
    NotificationRuleResponseSchema,
    NotificationResponseSchema,
    NotificationListResponseSchema,
    NotificationTemplateSchema,
    NotificationTemplateResponseSchema,
    NotificationStatsSchema,
)
from app.services.channels import ChannelFactory

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/notifications", tags=["notifications"])


# ============================================================================
# NOTIFICATION CHANNEL ENDPOINTS
# ============================================================================


@router.post("/channels", response_model=NotificationChannelResponseSchema)
async def create_notification_channel(
    channel_data: CreateNotificationChannelSchema,
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
):
    """Create a new notification channel for current user."""
    try:
        # Verify channel configuration
        service = ChannelFactory.create_service(channel_data.channel_type)
        if not service or not service.verify_config(channel_data.config):
            raise HTTPException(status_code=400, detail="Invalid channel configuration")

        # Create channel
        channel = NotificationChannel(
            tenant_id=current_user.tenant_id,
            user_id=current_user.id,
            channel_type=channel_data.channel_type,
            config=channel_data.config,
            enabled=channel_data.enabled,
        )
        session.add(channel)
        session.commit()
        session.refresh(channel)

        logger.info(
            "notification_channel_created",
            extra={
                "user_id": str(current_user.id),
                "channel_type": channel_data.channel_type,
            },
        )

        return channel

    except Exception as e:
        logger.error(f"Failed to create notification channel: {e}")
        raise HTTPException(status_code=500, detail="Failed to create channel")


@router.get("/channels", response_model=List[NotificationChannelResponseSchema])
async def list_notification_channels(
    enabled_only: bool = Query(False),
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
):
    """List all notification channels for current user."""
    query = select(NotificationChannel).where(
        NotificationChannel.user_id == current_user.id
    )

    if enabled_only:
        query = query.where(NotificationChannel.enabled == True)

    channels = session.exec(query).all()
    return channels


@router.get("/channels/{channel_id}", response_model=NotificationChannelResponseSchema)
async def get_notification_channel(
    channel_id: UUID,
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
):
    """Get a specific notification channel."""
    channel = session.exec(
        select(NotificationChannel).where(
            and_(
                NotificationChannel.id == channel_id,
                NotificationChannel.user_id == current_user.id,
            )
        )
    ).first()

    if not channel:
        raise HTTPException(status_code=404, detail="Channel not found")

    return channel


@router.put("/channels/{channel_id}", response_model=NotificationChannelResponseSchema)
async def update_notification_channel(
    channel_id: UUID,
    update_data: UpdateNotificationChannelSchema,
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
):
    """Update a notification channel."""
    channel = session.exec(
        select(NotificationChannel).where(
            and_(
                NotificationChannel.id == channel_id,
                NotificationChannel.user_id == current_user.id,
            )
        )
    ).first()

    if not channel:
        raise HTTPException(status_code=404, detail="Channel not found")

    # Verify new config if provided
    if update_data.config:
        service = ChannelFactory.create_service(channel.channel_type)
        if not service or not service.verify_config(update_data.config):
            raise HTTPException(status_code=400, detail="Invalid channel configuration")
        channel.config = update_data.config

    if update_data.enabled is not None:
        channel.enabled = update_data.enabled

    session.commit()
    session.refresh(channel)

    return channel


@router.delete("/channels/{channel_id}")
async def delete_notification_channel(
    channel_id: UUID,
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
):
    """Delete a notification channel."""
    channel = session.exec(
        select(NotificationChannel).where(
            and_(
                NotificationChannel.id == channel_id,
                NotificationChannel.user_id == current_user.id,
            )
        )
    ).first()

    if not channel:
        raise HTTPException(status_code=404, detail="Channel not found")

    session.delete(channel)
    session.commit()

    logger.info(
        "notification_channel_deleted",
        extra={"user_id": str(current_user.id), "channel_id": str(channel_id)},
    )

    return {"success": True, "message": "Channel deleted"}


# ============================================================================
# USER NOTIFICATION PREFERENCES
# ============================================================================


@router.put("/preferences", response_model=NotificationPreferencesSchema)
async def update_notification_preferences(
    preferences: NotificationPreferencesSchema,
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
):
    """Update user notification preferences (quiet hours, muted rules, etc)."""
    user = session.exec(
        select(User).where(User.id == current_user.id)
    ).first()

    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    # Update preferences
    user.notification_preferences = preferences.model_dump()
    session.commit()

    logger.info(
        "notification_preferences_updated",
        extra={"user_id": str(current_user.id)},
    )

    return preferences


@router.get("/preferences", response_model=NotificationPreferencesSchema)
async def get_notification_preferences(
    current_user: User = Depends(get_current_user),
):
    """Get user notification preferences."""
    if not current_user.notification_preferences:
        return NotificationPreferencesSchema()

    return NotificationPreferencesSchema(**current_user.notification_preferences)


# ============================================================================
# NOTIFICATION RULES (Link alerts to channels)
# ============================================================================


@router.post("/rules", response_model=NotificationRuleResponseSchema)
async def create_notification_rule(
    rule_data: CreateNotificationRuleSchema,
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
):
    """Link an alert rule to a notification channel."""
    # Verify channel exists and belongs to user
    channel = session.exec(
        select(NotificationChannel).where(
            and_(
                NotificationChannel.id == rule_data.channel_id,
                NotificationChannel.user_id == current_user.id,
            )
        )
    ).first()

    if not channel:
        raise HTTPException(status_code=404, detail="Channel not found")

    # Create rule link
    rule = NotificationRule(
        tenant_id=current_user.tenant_id,
        alert_rule_id=rule_data.alert_rule_id,
        channel_id=rule_data.channel_id,
        enabled=rule_data.enabled,
    )
    session.add(rule)
    session.commit()
    session.refresh(rule)

    return rule


@router.get("/rules", response_model=List[NotificationRuleResponseSchema])
async def list_notification_rules(
    alert_rule_id: Optional[UUID] = Query(None),
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
):
    """List notification rules for current user's channels."""
    query = select(NotificationRule).where(
        NotificationRule.tenant_id == current_user.tenant_id
    )

    if alert_rule_id:
        query = query.where(NotificationRule.alert_rule_id == alert_rule_id)

    rules = session.exec(query).all()
    return rules


@router.delete("/rules/{rule_id}")
async def delete_notification_rule(
    rule_id: UUID,
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
):
    """Delete a notification rule."""
    rule = session.exec(
        select(NotificationRule).where(
            and_(
                NotificationRule.id == rule_id,
                NotificationRule.tenant_id == current_user.tenant_id,
            )
        )
    ).first()

    if not rule:
        raise HTTPException(status_code=404, detail="Rule not found")

    session.delete(rule)
    session.commit()

    return {"success": True, "message": "Rule deleted"}


# ============================================================================
# NOTIFICATION HISTORY & MANAGEMENT
# ============================================================================


@router.get("/history", response_model=List[NotificationListResponseSchema])
async def list_notifications(
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    status: Optional[str] = Query(None),
    channel_type: Optional[str] = Query(None),
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
):
    """Get notification history for current user."""
    query = select(Notification).where(
        Notification.tenant_id == current_user.tenant_id
    )

    if status:
        query = query.where(Notification.status == status)

    if channel_type:
        query = query.where(Notification.channel_type == channel_type)

    # Order by creation date descending
    query = query.order_by(Notification.created_at.desc())

    notifications = session.exec(query.offset(offset).limit(limit)).all()
    return notifications


@router.get("/history/{notification_id}", response_model=NotificationResponseSchema)
async def get_notification(
    notification_id: UUID,
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
):
    """Get details of a specific notification."""
    notification = session.exec(
        select(Notification).where(
            and_(
                Notification.id == notification_id,
                Notification.tenant_id == current_user.tenant_id,
            )
        )
    ).first()

    if not notification:
        raise HTTPException(status_code=404, detail="Notification not found")

    return notification


@router.post("/history/{notification_id}/resend")
async def resend_notification(
    notification_id: UUID,
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
):
    """Manually resend a notification."""
    notification = session.exec(
        select(Notification).where(
            and_(
                Notification.id == notification_id,
                Notification.tenant_id == current_user.tenant_id,
            )
        )
    ).first()

    if not notification:
        raise HTTPException(status_code=404, detail="Notification not found")

    # Mark for retry
    notification.status = "pending"
    notification.retry_count = 0
    notification.next_retry_at = None
    session.commit()

    logger.info(
        "notification_resend_requested",
        extra={
            "notification_id": str(notification_id),
            "user_id": str(current_user.id),
        },
    )

    return {"success": True, "message": "Notification marked for resend"}


@router.get("/stats", response_model=NotificationStatsSchema)
async def get_notification_stats(
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
):
    """Get notification delivery statistics for tenant."""
    from sqlalchemy import func

    # Count notifications by status
    total_sent = session.exec(
        select(func.count(Notification.id)).where(
            and_(
                Notification.tenant_id == current_user.tenant_id,
                Notification.status == "sent",
            )
        )
    ).first() or 0

    total_pending = session.exec(
        select(func.count(Notification.id)).where(
            and_(
                Notification.tenant_id == current_user.tenant_id,
                Notification.status == "pending",
            )
        )
    ).first() or 0

    total_failed = session.exec(
        select(func.count(Notification.id)).where(
            and_(
                Notification.tenant_id == current_user.tenant_id,
                Notification.status.in_(["failed", "bounced"]),
            )
        )
    ).first() or 0

    # Calculate success rate
    total = total_sent + total_pending + total_failed
    success_rate = (total_sent / total * 100) if total > 0 else 0

    # Count by channel type
    channels_data = session.exec(
        select(Notification.channel_type, func.count(Notification.id)).where(
            Notification.tenant_id == current_user.tenant_id
        ).group_by(Notification.channel_type)
    ).all()

    channels = {channel_type: count for channel_type, count in channels_data}

    return NotificationStatsSchema(
        total_sent=total_sent,
        total_pending=total_pending,
        total_failed=total_failed,
        success_rate=round(success_rate, 1),
        channels=channels,
    )


# ============================================================================
# NOTIFICATION TEMPLATES
# ============================================================================


@router.post("/templates", response_model=NotificationTemplateResponseSchema)
async def create_notification_template(
    template_data: NotificationTemplateSchema,
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
):
    """Create a notification template."""
    # Check if template already exists
    existing = session.exec(
        select(NotificationTemplate).where(
            and_(
                NotificationTemplate.tenant_id == current_user.tenant_id,
                NotificationTemplate.channel_type == template_data.channel_type,
                NotificationTemplate.alert_type == template_data.alert_type,
            )
        )
    ).first()

    if existing:
        raise HTTPException(status_code=409, detail="Template already exists")

    template = NotificationTemplate(
        tenant_id=current_user.tenant_id,
        channel_type=template_data.channel_type,
        alert_type=template_data.alert_type,
        name=template_data.name,
        subject=template_data.subject,
        body=template_data.body,
        variables=template_data.variables,
        enabled=template_data.enabled,
    )
    session.add(template)
    session.commit()
    session.refresh(template)

    return template


@router.get("/templates", response_model=List[NotificationTemplateResponseSchema])
async def list_notification_templates(
    channel_type: Optional[str] = Query(None),
    enabled_only: bool = Query(False),
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
):
    """List notification templates for tenant."""
    query = select(NotificationTemplate).where(
        NotificationTemplate.tenant_id == current_user.tenant_id
    )

    if channel_type:
        query = query.where(NotificationTemplate.channel_type == channel_type)

    if enabled_only:
        query = query.where(NotificationTemplate.enabled == True)

    templates = session.exec(query).all()
    return templates


@router.put("/templates/{template_id}", response_model=NotificationTemplateResponseSchema)
async def update_notification_template(
    template_id: UUID,
    template_data: NotificationTemplateSchema,
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
):
    """Update a notification template."""
    template = session.exec(
        select(NotificationTemplate).where(
            and_(
                NotificationTemplate.id == template_id,
                NotificationTemplate.tenant_id == current_user.tenant_id,
            )
        )
    ).first()

    if not template:
        raise HTTPException(status_code=404, detail="Template not found")

    template.name = template_data.name
    template.subject = template_data.subject
    template.body = template_data.body
    template.variables = template_data.variables
    template.enabled = template_data.enabled

    session.commit()
    session.refresh(template)

    return template


@router.delete("/templates/{template_id}")
async def delete_notification_template(
    template_id: UUID,
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
):
    """Delete a notification template."""
    template = session.exec(
        select(NotificationTemplate).where(
            and_(
                NotificationTemplate.id == template_id,
                NotificationTemplate.tenant_id == current_user.tenant_id,
            )
        )
    ).first()

    if not template:
        raise HTTPException(status_code=404, detail="Template not found")

    session.delete(template)
    session.commit()

    return {"success": True, "message": "Template deleted"}
