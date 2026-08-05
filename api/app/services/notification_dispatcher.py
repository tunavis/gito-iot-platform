"""Notification dispatcher - orchestrates alert notifications across channels."""

import logging
from dataclasses import dataclass
from typing import List, Dict, Optional, Any
from uuid import UUID
from datetime import datetime, timedelta
from sqlalchemy import and_, case, select, text

from app.database import RLSSession
from app.models import (
    AlertEvent,
    UnifiedAlertRule,
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

# The pre-existing and default kind. Every row that existed before migration 033
# is one of these, which is what that migration's column default says.
SOURCE_ALERT_EVENT = "alert_event"
SOURCE_INGESTION_STALL = "ingestion_stall"
SOURCE_COMMAND_APPROVAL = "command_approval"


@dataclass(frozen=True)
class NotificationSource:
    """What a notification is about, in the shape the send path needs.

    This exists so alarms and platform sources share one send path instead of
    two. `_send` reads only this, so adding a third source is a builder, not
    another copy of channel resolution, template lookup, retry and bookkeeping.

    `default_subject`/`default_message` are what renders when no template
    matches — which, with no templates authored, is always.
    """

    source_kind: str
    alert_event_id: Optional[UUID]
    variables: Dict[str, Any]
    default_message: str
    default_subject: Optional[str] = None
    # Selects a template. None means "no preference" and takes the untyped one.
    alert_type: Optional[str] = None


async def resolve_platform_notification_tenant(session: RLSSession) -> Optional[UUID]:
    """Which tenant hears about a platform-wide fault, or None if that is unanswerable.

    Not `dependencies.get_management_tenant` — that is a FastAPI dependency which
    reads a JWT and asserts the *caller's* tenant_type. It performs no lookup and
    returns the caller's own tenant, so it is unusable from a background task,
    which is exactly where platform faults are detected.

    A stall crosses tenants by construction (`check_ingestion_stall` reads
    max(devices.last_seen) fleet-wide), but a queued notification needs a tenant
    and channels are per-user-per-tenant. Fanning a platform fault out to every
    tenant's admins tells many people something none of them can act on, and the
    one who can is told repeatedly.

    Both failure modes return None and log rather than guessing, because nothing
    in the schema constrains how many management tenants exist:
      - none: there is nobody to tell. Inventing a recipient means notifying an
        arbitrary customer about our infrastructure.
      - several: an arbitrary pick delivers to a tenant whose identity can change
        between deploys, so the same fault reaches different people each time.
    """
    rows = (
        await session.execute(text("SELECT id FROM tenants WHERE tenant_type = 'management'"))
    ).all()

    if not rows:
        logger.error(
            "Platform notification has no recipient: no tenant has tenant_type='management'. "
            "Nothing queued."
        )
        return None
    if len(rows) > 1:
        logger.error(
            "Platform notification has an ambiguous recipient: %d tenants have "
            "tenant_type='management' (%s). Nothing queued — pick one deliberately "
            "rather than letting this choose.",
            len(rows),
            ", ".join(str(r[0]) for r in rows),
        )
        return None
    return rows[0][0]


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
        alert_event = (
            (await self.session.execute(select(AlertEvent).where(AlertEvent.id == alert_event_id)))
            .scalars()
            .first()
        )

        if not alert_event:
            logger.error(f"Alert event {alert_event_id} not found")
            return []

        alert_rule = (
            (
                await self.session.execute(
                    select(UnifiedAlertRule).where(UnifiedAlertRule.id == alert_event.alert_rule_id)
                )
            )
            .scalars()
            .first()
        )

        device = (
            (await self.session.execute(select(Device).where(Device.id == alert_event.device_id)))
            .scalars()
            .first()
        )

        if not alert_rule or not device:
            return []

        notification_rules = (
            (
                await self.session.execute(
                    select(NotificationRule).where(
                        and_(
                            NotificationRule.alert_rule_id == alert_rule.id,
                            NotificationRule.enabled == True,
                        )
                    )
                )
            )
            .scalars()
            .all()
        )

        source = NotificationSource(
            source_kind=SOURCE_ALERT_EVENT,
            alert_event_id=alert_event.id,
            variables={
                "device_name": device.name,
                "rule_name": alert_rule.metric,
                "metric_value": alert_event.metric_value,
                "threshold": alert_rule.threshold,
                "fired_at": alert_event.fired_at.isoformat() if alert_event.fired_at else "",
                "alert_message": alert_event.message or "Alert triggered",
            },
            # Unchanged from before this seam existed — an alarm with no template
            # must render exactly as it always has.
            default_message=f"{device.name}: Alert triggered",
            default_subject=None,
            alert_type=getattr(alert_rule, "severity", None),
        )

        notification_ids = []
        for notif_rule in notification_rules:
            channel = (
                (
                    await self.session.execute(
                        select(NotificationChannel).where(
                            NotificationChannel.id == notif_rule.channel_id
                        )
                    )
                )
                .scalars()
                .first()
            )

            if not channel or not channel.enabled:
                continue

            user = (
                (await self.session.execute(select(User).where(User.id == channel.user_id)))
                .scalars()
                .first()
            )

            if await self._is_throttled(channel, SOURCE_ALERT_EVENT):
                continue

            notif_id = await self._send(source, channel, user)
            if notif_id:
                notification_ids.append(notif_id)

        alert_event.notification_sent = True
        alert_event.notification_sent_at = datetime.utcnow()
        await self.session.commit()

        return notification_ids

    async def process_platform_event(
        self,
        source_kind: str,
        variables: Dict[str, Any],
        default_message: str,
        default_subject: Optional[str] = None,
    ) -> List[UUID]:
        """Send a notification that is not about an alert event.

        Shares channel resolution, template selection, throttling and the send
        bookkeeping with `process_alert_event` — only what the notification is
        *about* differs.

        Channel selection differs in one way and it is deliberate: an alarm
        reaches the channels wired to its rule via `notification_rules`, and a
        platform source has no rule, so it reaches every enabled channel in the
        tenant. That tenant is the management tenant, so "every enabled channel"
        is the operators' channels, not a customer's.
        """
        channels = (
            (
                await self.session.execute(
                    select(NotificationChannel).where(
                        and_(
                            NotificationChannel.tenant_id == self.tenant_id,
                            NotificationChannel.enabled == True,  # noqa: E712
                        )
                    )
                )
            )
            .scalars()
            .all()
        )

        if not channels:
            logger.warning(
                "Platform notification %s has no enabled channel on tenant %s — nothing sent",
                source_kind,
                self.tenant_id,
            )
            return []

        source = NotificationSource(
            source_kind=source_kind,
            alert_event_id=None,
            variables=variables,
            default_message=default_message,
            default_subject=default_subject,
            alert_type=source_kind,
        )

        notification_ids = []
        for channel in channels:
            if await self._is_throttled(channel, source_kind):
                continue
            user = (
                (await self.session.execute(select(User).where(User.id == channel.user_id)))
                .scalars()
                .first()
            )
            notif_id = await self._send(source, channel, user)
            if notif_id:
                notification_ids.append(notif_id)

        await self.session.commit()
        return notification_ids

    async def _is_throttled(
        self, channel: NotificationChannel, source_kind: str = SOURCE_ALERT_EVENT
    ) -> bool:
        """Whether this channel has sent anything too recently.

        Keyed on the channel and the source kind rather than on an alert rule: a
        platform source has no rule, and throttling a stall behind an alarm (or
        the reverse) would drop the one that matters. This is only a rate
        ceiling — duplicate suppression is the dedupe index, not this.
        """
        cutoff = datetime.utcnow() - timedelta(minutes=self.throttle_minutes)
        recent = (
            (
                await self.session.execute(
                    select(Notification).where(
                        and_(
                            Notification.channel_id == channel.id,
                            Notification.source_kind == source_kind,
                            Notification.created_at > cutoff,
                            Notification.status != "skipped",
                        )
                    )
                )
            )
            .scalars()
            .first()
        )
        return recent is not None

    async def _resolve_template(
        self, channel: NotificationChannel, alert_type: Optional[str]
    ) -> Optional[NotificationTemplate]:
        """Prefer a template declaring this alert_type, then an untyped one, then any.

        `alert_type` has been stored on templates and never read — selection took
        the first enabled template for the channel, so exactly one template per
        channel could ever be used and a platform fault would borrow an alarm's
        wording.

        Preference lives in ORDER BY rather than in a sequence of queries, for
        two reasons. It is one round trip instead of up to three. And the WHERE
        clause is left exactly as it was, so this can never match *fewer*
        templates than the previous code did — it only reorders them. A tenant
        whose single enabled template carries some unrelated alert_type keeps
        getting that template rather than silently dropping to the hardcoded
        fallback.
        """
        preference = case(
            (NotificationTemplate.alert_type == alert_type, 0),  # asked for
            (NotificationTemplate.alert_type.is_(None), 1),  # applies to anything
            else_=2,  # some other type — last resort, i.e. the old behaviour
        )

        return (
            (
                await self.session.execute(
                    select(NotificationTemplate)
                    .where(
                        and_(
                            NotificationTemplate.tenant_id == self.tenant_id,
                            NotificationTemplate.channel_type == channel.channel_type,
                            NotificationTemplate.enabled == True,  # noqa: E712
                        )
                    )
                    .order_by(preference)
                )
            )
            .scalars()
            .first()
        )

    async def _send(
        self,
        source: "NotificationSource",
        channel: NotificationChannel,
        user: Optional[User],
    ) -> Optional[UUID]:
        """Send one notification through one channel."""
        service = ChannelFactory.create_service(channel.channel_type)
        if not service:
            return None

        template = await self._resolve_template(channel, source.alert_type)
        variables = source.variables

        if template:
            message = service.render_template(template.body, variables)
            subject = (
                service.render_template(template.subject, variables) if template.subject else None
            )
        else:
            # Not an edge case — with no templates authored this IS the live
            # path, so the default has to come from the source. The previous
            # hardcoded alarm sentence named a device, which a platform fault
            # does not have: a stall would have rendered "None: Alert triggered".
            message = source.default_message
            subject = source.default_subject

        recipient = (
            channel.config.get("email")
            or channel.config.get("slack_webhook_url")
            or channel.config.get("webhook_url")
            or ""
        )

        notification = Notification(
            tenant_id=self.tenant_id,
            source_kind=source.source_kind,
            alert_event_id=source.alert_event_id,
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
