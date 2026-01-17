"""Slack and webhook notification services."""

import logging
import httpx
import json
import hmac
import hashlib
import time
from typing import Dict, Any, Optional
from jinja2 import Template

logger = logging.getLogger(__name__)


class SlackNotificationService:
    """Send notifications to Slack via webhooks."""

    def send(
        self,
        webhook_url: str,
        message: str,
        template_vars: Optional[Dict[str, Any]] = None,
    ) -> tuple[bool, Optional[str]]:
        """Send message to Slack."""
        try:
            payload = {
                "text": message,
                "mrkdwn": True,
            }

            with httpx.Client(timeout=10) as client:
                response = client.post(webhook_url, json=payload)

                if response.status_code not in (200, 201):
                    error_msg = f"Slack webhook failed: {response.text}"
                    logger.error(error_msg, extra={"webhook_url": webhook_url})
                    return False, error_msg

            logger.info("slack_message_sent", extra={"webhook_url": webhook_url})
            return True, None

        except httpx.TimeoutException:
            error_msg = "Slack webhook timeout"
            logger.error(error_msg, extra={"webhook_url": webhook_url})
            return False, error_msg

        except Exception as e:
            error_msg = f"Slack send failed: {str(e)}"
            logger.error(error_msg, extra={"webhook_url": webhook_url})
            return False, error_msg

    def render_template(self, template_body: str, variables: Dict[str, Any]) -> str:
        """Render Slack message template."""
        try:
            template = Template(template_body)
            return template.render(**variables)
        except Exception as e:
            logger.error(f"Slack template rendering failed: {e}")
            return template_body

    def verify_config(self, config: Dict[str, Any]) -> bool:
        """Verify Slack webhook configuration."""
        if not isinstance(config, dict):
            return False

        webhook_url = config.get("slack_webhook_url", "").strip()
        if not webhook_url or not webhook_url.startswith("https://hooks.slack.com/"):
            return False

        return True


class WebhookNotificationService:
    """Send notifications to generic webhooks with HMAC signing."""

    def send(
        self,
        webhook_url: str,
        payload: Dict[str, Any],
        secret: Optional[str] = None,
    ) -> tuple[bool, Optional[str]]:
        """Send notification to webhook."""
        try:
            headers = {
                "Content-Type": "application/json",
                "User-Agent": "GITO-NotificationService/1.0",
            }

            if secret:
                timestamp = str(int(time.time()))
                payload["timestamp"] = timestamp

                message = json.dumps(payload, sort_keys=True)
                signature = hmac.new(
                    secret.encode(),
                    message.encode(),
                    hashlib.sha256,
                ).hexdigest()

                headers["X-Signature"] = signature
                headers["X-Timestamp"] = timestamp

            with httpx.Client(timeout=10) as client:
                response = client.post(
                    webhook_url,
                    json=payload,
                    headers=headers,
                )

                if response.status_code not in (200, 201, 202):
                    error_msg = f"Webhook failed: {response.status_code} - {response.text}"
                    logger.error(error_msg, extra={"webhook_url": webhook_url})
                    return False, error_msg

            logger.info("webhook_sent", extra={"webhook_url": webhook_url})
            return True, None

        except httpx.TimeoutException:
            error_msg = "Webhook timeout"
            logger.error(error_msg, extra={"webhook_url": webhook_url})
            return False, error_msg

        except Exception as e:
            error_msg = f"Webhook send failed: {str(e)}"
            logger.error(error_msg, extra={"webhook_url": webhook_url})
            return False, error_msg

    def verify_config(self, config: Dict[str, Any]) -> bool:
        """Verify webhook configuration."""
        if not isinstance(config, dict):
            return False

        webhook_url = config.get("webhook_url", "").strip()
        if not webhook_url or not webhook_url.startswith(("http://", "https://")):
            return False

        return True
