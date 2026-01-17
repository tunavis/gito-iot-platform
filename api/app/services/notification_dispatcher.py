"""Notification dispatcher - orchestrates alert notifications across channels."""

import logging
from typing import List, Dict, Optional, Any
from uuid import UUID
from datetime import datetime, timedelta
from sqlalchemy import and_, select
from sqlalchemy.orm import Session

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

    def __init__(self, session: Session, tenant_id: UUID):
        """Initialize dispatcher."""
        self.session = session
        self.tenant_id = tenant_id
        self.settings = get_settings()
        self.throttle_minutes = int(self.settings.NOTIFICATION_THROTTLE_MINUTES or 1)

    def process_alert_event(self, alert_event_id: UUID) -> List[UUID]:
        """Process alert event and send notifications."""
        alert_event = self.session.exec(
            select(AlertEvent).where(AlertEvent.id == alert_event_id)
        ).first()

        if not alert_event:
            logger.error(f"Alert event {alert_event_id} not found")
            return []

        alert_rule = self.session.exec(
            select(AlertRule).where(AlertRule.id == alert_event.alert_rule_id)
        ).first()

        device = self.session.exec(
            select(Device).where(Device.id == alert_event.device_id)
        ).first()

        if not alert_rule or not device:
            return []

        notification_rules = self.session.exec(
            select(NotificationRule).where(
                and_(
                    NotificationRule.alert_rule_id == alert_rule.id,
                    NotificationRule.enabled == True,
                )
            )
        ).all()

        notification_ids = []
        for notif_rule in notification_rules:
            channel = self.session.exec(
                select(NotificationChannel).where(
                    NotificationChannel.id == notif_rule.channel_id
                )
            ).first()

            if not channel or not channel.enabled:
                continue

            user = self.session.exec(
                select(User).where(User.id == channel.user_id)
            ).first()

            if self._should_skip(user, alert_rule):
                self._create_record(alert_event, channel, "skipped", "User preferences")
                continue

            if self._is_throttled(channel, alert_rule):
                continue

            notif_id = self._send(alert_event, channel, alert_rule, device, user)
            if notif_id:
                notification_ids.append(notif_id)

        alert_event.notification_sent = True
        alert_event.notification_sent_at = datetime.utcnow()
        self.session.commit()

        return notification_ids

    def _should_skip(self, user: Optional[User], alert_rule: AlertRule) -> bool:
        """Check if notification should be skipped."""
        if not user or not user.notification_preferences:
            return False

        prefs = user.notification_preferences
        muted_rules = prefs.get("muted_rules", [])
        if str(alert_rule.id) in muted_rules:
            return True

        if prefs.get("quiet_hours_enabled"):
            now = datetime.utcnow().time()
            start_str = prefs.get("quiet_hours_start", "22:00")
            end_str = prefs.get("quiet_hours_end", "08:00")
            
            try:
                start = datetime.strptime(start_str, "%H:%M").time()
                end = datetime.strptime(end_str, "%H:%M").time()
                if start <= now or now < end:
                    return True
            except ValueError:
                pass

        return False

    def _is_throttled(self, channel: NotificationChannel, alert_rule: AlertRule) -> bool:
        """Check if channel is throttled."""
        cutoff = datetime.utcnow() - timedelta(minutes=self.throttle_minutes)
        recent = self.session.exec(
            select(Notification).where(
                and_(
                    Notification.channel_id == channel.id,
                    Notification.created_at > cutoff,
                    Notification.status != "skipped",
                )
            )
        ).first()
        return recent is not None

    def _send(
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

        template = self.session.exec(
            select(NotificationTemplate).where(
                and_(
                    NotificationTemplate.tenant_id == self.tenant_id,
                    NotificationTemplate.channel_type == channel.channel_type,
                    NotificationTemplate.enabled == True,
                )
            )
        ).first()

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
        self.session.flush()

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
        self.session.commit()

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

    def _create_record(
        self,
        alert_event: AlertEvent,
        channel: NotificationChannel,
        status: str,
        reason: str,
    ) -> UUID:
        """Create notification record."""
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
            status=status,
            error_message=reason,
        )
        self.session.add(notification)
        self.session.commit()

        return notification.id

    def retry_failed_notifications(self, max_retries: int = 5) -> int:
        """Retry failed notifications with exponential backoff."""
        now = datetime.utcnow()

        pending = self.session.exec(
            select(Notification).where(
                and_(
                    Notification.tenant_id == self.tenant_id,
                    Notification.status.in_(["pending", "failed"]),
                    Notification.retry_count < max_retries,
                    Notification.next_retry_at <= now,
                )
            )
        ).all()

        retried = 0
        for notif in pending:
            channel = self.session.exec(
                select(NotificationChannel).where(NotificationChannel.id == notif.channel_id)
            ).first()

            if not channel:
                continue

            service = ChannelFactory.create_service(channel.channel_type)
            if not service:
                continue

            success, error = self._attempt_send(
                service,
                channel,
                f"Retry: {notif.error_message or 'Unknown error'}",
                None,
                {},
            )

            notif.retry_count += 1
            if success:
                notif.status = "sent"
                notif.sent_at = now
                notif.delivery_status = "success"
                retried += 1
            else:
                notif.status = "pending"
                backoff_seconds = 2 ** notif.retry_count
                notif.next_retry_at = now + timedelta(seconds=backoff_seconds)
                notif.error_message = error

        self.session.commit()
        return retried
