"""Notification channel services factory."""

from typing import Union
from app.services.channels.email_service import EmailNotificationService
from app.services.channels.slack_and_webhook import SlackNotificationService, WebhookNotificationService


class ChannelFactory:
    """Factory for creating notification channel services."""

    @staticmethod
    def create_service(channel_type: str):
        """Create a notification service for the given channel type."""
        if channel_type == "email":
            return EmailNotificationService()
        elif channel_type == "slack":
            return SlackNotificationService()
        elif channel_type == "webhook":
            return WebhookNotificationService()
        elif channel_type in ("apns", "fcm"):
            return None
        elif channel_type == "sms":
            return None
        else:
            return None


__all__ = [
    "ChannelFactory",
    "EmailNotificationService",
    "SlackNotificationService",
    "WebhookNotificationService",
]
