"""Email notification service for alert notifications."""

import logging
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from smtplib import SMTP_SSL, SMTP
from typing import Optional

from app.config import get_settings

logger = logging.getLogger(__name__)


class EmailService:
    """Service for sending email notifications."""

    def __init__(self):
        self.settings = get_settings()
        self.smtp_host = self.settings.SMTP_HOST
        self.smtp_port = self.settings.SMTP_PORT
        self.smtp_user = self.settings.SMTP_USER
        self.smtp_password = self.settings.SMTP_PASSWORD
        self.smtp_from = self.settings.SMTP_FROM_EMAIL
        self.use_tls = self.settings.SMTP_USE_TLS

    async def send_alert_email(
        self,
        recipient: str,
        device_name: str,
        metric: str,
        value: float,
        threshold: float,
        operator: str,
        tenant_name: str,
    ) -> bool:
        """
        Send alert notification email.

        Args:
            recipient: Email address to send to
            device_name: Name of the device that triggered the alert
            metric: Metric name (e.g., 'temperature')
            value: Current value
            threshold: Alert threshold
            operator: Comparison operator (>, <, ==, !=, >=, <=)
            tenant_name: Tenant name for context

        Returns:
            True if email sent successfully, False otherwise
        """
        try:
            if not self.smtp_host or not self.smtp_user or not self.smtp_password:
                logger.warning("SMTP configuration incomplete - skipping email")
                return False

            subject = f"Alert: {device_name} - {metric} threshold breached"
            body = self._generate_alert_email_body(
                device_name, metric, value, threshold, operator, tenant_name
            )

            return await self._send_email(recipient, subject, body)

        except Exception as e:
            logger.error(f"Failed to send alert email: {e}")
            return False

    async def _send_email(self, recipient: str, subject: str, body: str) -> bool:
        """Send email via SMTP."""
        try:
            # Create message
            msg = MIMEMultipart("alternative")
            msg["Subject"] = subject
            msg["From"] = self.smtp_from
            msg["To"] = recipient

            # Attach plain text and HTML versions
            part1 = MIMEText(body, "plain")
            part2 = MIMEText(self._convert_to_html(body), "html")
            msg.attach(part1)
            msg.attach(part2)

            # Send email
            if self.use_tls:
                with SMTP(self.smtp_host, self.smtp_port) as server:
                    server.starttls()
                    server.login(self.smtp_user, self.smtp_password)
                    server.send_message(msg)
            else:
                with SMTP_SSL(self.smtp_host, self.smtp_port) as server:
                    server.login(self.smtp_user, self.smtp_password)
                    server.send_message(msg)

            logger.info(f"Email sent to {recipient}")
            return True

        except Exception as e:
            logger.error(f"SMTP error: {e}")
            return False

    @staticmethod
    def _generate_alert_email_body(
        device_name: str,
        metric: str,
        value: float,
        threshold: float,
        operator: str,
        tenant_name: str,
    ) -> str:
        """Generate alert email body text."""
        operator_text = {
            ">": "greater than",
            "<": "less than",
            ">=": "greater than or equal to",
            "<=": "less than or equal to",
            "==": "equal to",
            "!=": "not equal to",
        }.get(operator, operator)

        return f"""Alert Notification

Device: {device_name}
Tenant: {tenant_name}
Metric: {metric}
Current Value: {value}
Threshold: {threshold} ({operator_text})
Status: THRESHOLD BREACHED

This alert was triggered because the {metric} value ({value}) is {operator_text} the configured threshold ({threshold}).

Please investigate the device status and take appropriate action.

---
Gito IoT Platform
"""

    @staticmethod
    def _convert_to_html(text: str) -> str:
        """Convert plain text to HTML format."""
        html = "<html><body><pre style='font-family: monospace'>"
        html += text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
        html += "</pre></body></html>"
        return html


# Singleton instance
_email_service: Optional[EmailService] = None


async def get_email_service() -> EmailService:
    """Get or create the email service."""
    global _email_service
    if _email_service is None:
        _email_service = EmailService()
    return _email_service
