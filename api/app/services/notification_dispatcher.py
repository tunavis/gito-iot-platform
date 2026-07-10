"""Notification dispatcher - orchestrates alert notifications across channels."""

import logging
from typing import List, Dict, Optional, Any
from uuid import UUID
from datetime import datetime, timedelta
from sqlalchemy import and_, select

from app.database import RLSSession
from app.models import (
    AlertEvent,
    AlertRule,
    NotificationChannel,
    NotificationRule,
    Notification,
    NotificationTemplate,
    User,
    Device,
)
from app.services.channels import ChannelFactory
from app.config import get_settings

logger = logging.getLogger(__name__)


class NotificationDispatcher:
    """Dispatches notifications when alert events fire."""

    def __init__(self, session: RLSSession, tenant_id: UUID):
        """Initialize dispatcher."""
        self.session = session
        self.tenant_id = tenant_id
        self.settings = get_settings()
        self.throttle_minutes = int(self.settings.NOTIFICATION_THROTTLE_MINUTES or 1)

    async def process_alert_event(self, alert_event_id: UUID) -> List[UUID]:
        """Process alert event and send notifications."""
        alert_event = (await self.session.execute(
            select(AlertEvent).where(AlertEvent.id == alert_event_id)
        )).scalars().first()

        if not alert_event:
            logger.error(f"Alert event {alert_event_id} not found")
            return []

        alert_rule = (await self.session.execute(
            select(AlertRule).where(AlertRule.id == alert_event.alert_rule_id)
        )).scalars().first()

        device = (await self.session.execute(
            select(Device).where(Device.id == alert_event.device_id)
        )).scalars().first()

        if not alert_rule or not device:
            return []

        notification_rules = (await self.session.execute(
            select(NotificationRule).where(
                and_(
                    NotificationRule.alert_rule_id == alert_rule.id,
                    NotificationRule.enabled == True,
                )
            )
        )).scalars().all()

        notification_ids = []
        for notif_rule in notification_rules:
            channel = (await self.session.execute(
                select(NotificationChannel).where(
                    NotificationChannel.id == notif_rule.channel_id
                )
            )).scalars().first()

            if not channel or not channel.enabled:
                continue

            user = (await self.session.execute(
                select(User).where(User.id == channel.user_id)
            )).scalars().first()

            if await self._is_throttled(channel, alert_rule):
                continue

            notif_id = await self._send(alert_event, channel, alert_rule, device, user)
            if notif_id:
                notification_ids.append(notif_id)

        alert_event.notification_sent = True
        alert_event.notification_sent_at = datetime.utcnow()
        await self.session.commit()

        return notification_ids

    async def _is_throttled(self, channel: NotificationChannel, alert_rule: AlertRule) -> bool:
        """Check if channel is throttled."""
        cutoff = datetime.utcnow() - timedelta(minutes=self.throttle_minutes)
        recent = (await self.session.execute(
            select(Notification).where(
                and_(
                    Notification.channel_id == channel.id,
                    Notification.created_at > cutoff,
                    Notification.status != "skipped",
                )
            )
        )).scalars().first()
        return recent is not None

    async def _send(
        self,
        alert_event: AlertEvent,
        channel: NotificationChannel,
        alert_rule: AlertRule,
        device: Device,
        user: Optional[User],
    ) -> Optional[UUID]:
        """Send notification."""
        service = ChannelFactory.create_service(channel.channel_type)
        if not service:
            return None

        template = (await self.session.execute(
            select(NotificationTemplate).where(
                and_(
                    NotificationTemplate.tenant_id == self.tenant_id,
                    NotificationTemplate.channel_type == channel.channel_type,
                    NotificationTemplate.enabled == True,
                )
            )
        )).scalars().first()

        variables = {
            "device_name": device.name,
            "rule_name": alert_rule.metric,
            "metric_value": alert_event.metric_value,
            "threshold": alert_rule.threshold,
            "fired_at": alert_event.fired_at.isoformat() if alert_event.fired_at else "",
            "alert_message": alert_event.message or "Alert triggered",
        }

        if template:
            message = service.render_template(template.body, variables)
            subject = service.render_template(template.subject, variables) if template.subject else None
        else:
            message = f"{device.name}: Alert triggered"
            subject = None

        recipient = (
            channel.config.get("email")
            or channel.config.get("slack_webhook_url")
            or channel.config.get("webhook_url")
            or ""
        )

        notification = Notification(
            tenant_id=self.tenant_id,
            alert_event_id=alert_event.id,
            channel_id=channel.id,
            channel_type=channel.channel_type,
            recipient=recipient,
            status="pending",
        )
        self.session.add(notification)
        await self.session.flush()

        success, error = self._attempt_send(service, channel, message, subject, variables)

        if success:
            notification.status = "sent"
            notification.sent_at = datetime.utcnow()
            notification.delivery_status = "success"
        else:
            notification.status = "pending"
            notification.error_message = error
            notification.next_retry_at = datetime.utcnow() + timedelta(seconds=1)

        channel.last_used_at = datetime.utcnow()
        await self.session.commit()

        return notification.id

    def _attempt_send(
        self,
        service: Any,
        channel: NotificationChannel,
        message: str,
        subject: Optional[str],
        variables: Dict[str, Any],
    ) -> tuple[bool, Optional[str]]:
        """Attempt to send via service."""
        config = channel.config

        if channel.channel_type == "email":
            email = config.get("email")
            return service.send(email, subject or "Alert", message)
        elif channel.channel_type == "slack":
            webhook_url = config.get("slack_webhook_url")
            return service.send(webhook_url, message)
        elif channel.channel_type == "webhook":
            webhook_url = config.get("webhook_url")
            secret = config.get("webhook_secret")
            payload = {
                "alert": message,
                "device_name": variables.get("device_name"),
                "rule_name": variables.get("rule_name"),
                "metric_value": variables.get("metric_value"),
            }
            return service.send(webhook_url, payload, secret)

        return False, "Unknown channel type"

