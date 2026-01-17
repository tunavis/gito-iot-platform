"""Email notification service using SMTP."""

import logging
import smtplib
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from typing import Dict, Any, Optional
from jinja2 import Template

from app.config import get_settings

logger = logging.getLogger(__name__)


class EmailNotificationService:
    """Send notifications via email using SMTP."""

    def __init__(self):
        """Initialize email service with SMTP settings."""
        self.settings = get_settings()
        self.smtp_host = self.settings.SMTP_HOST
        self.smtp_port = self.settings.SMTP_PORT
        self.smtp_user = self.settings.SMTP_USER
        self.smtp_password = self.settings.SMTP_PASSWORD
        self.from_email = self.settings.SMTP_FROM_EMAIL or self.smtp_user

    def send(
        self,
        to_email: str,
        subject: str,
        body: str,
        html_body: Optional[str] = None,
        template_vars: Optional[Dict[str, Any]] = None,
    ) -> tuple[bool, Optional[str]]:
        """Send email notification.

        Args:
            to_email: Recipient email address
            subject: Email subject
            body: Plain text body
            html_body: Optional HTML body
            template_vars: Variables to render in templates (unused if already rendered)

        Returns:
            (success, error_message)
        """
        try:
            # Create message
            msg = MIMEMultipart("alternative")
            msg["Subject"] = subject
            msg["From"] = self.from_email
            msg["To"] = to_email

            # Attach plain text
            msg.attach(MIMEText(body, "plain"))

            # Attach HTML if provided
            if html_body:
                msg.attach(MIMEText(html_body, "html"))

            # Send via SMTP
            with smtplib.SMTP(self.smtp_host, self.smtp_port, timeout=10) as server:
                if self.settings.SMTP_TLS:
                    server.starttls()
                
                if self.smtp_user and self.smtp_password:
                    server.login(self.smtp_user, self.smtp_password)
                
                server.send_message(msg)

            logger.info(
                "email_sent",
                extra={
                    "recipient": to_email,
                    "subject": subject,
                },
            )

            return True, None

        except smtplib.SMTPAuthenticationError as e:
            error_msg = "SMTP authentication failed"
            logger.error(f"{error_msg}: {e}", extra={"recipient": to_email})
            return False, error_msg

        except smtplib.SMTPException as e:
            error_msg = f"SMTP error: {str(e)}"
            logger.error(error_msg, extra={"recipient": to_email})
            return False, error_msg

        except Exception as e:
            error_msg = f"Email send failed: {str(e)}"
            logger.error(error_msg, extra={"recipient": to_email})
            return False, error_msg

    def render_template(self, template_body: str, variables: Dict[str, Any]) -> str:
        """Render email template with variables.

        Args:
            template_body: Jinja2 template string
            variables: Template variables

        Returns:
            Rendered template
        """
        try:
            template = Template(template_body)
            return template.render(**variables)
        except Exception as e:
            logger.error(f"Template rendering failed: {e}")
            return template_body

    def verify_config(self, config: Dict[str, Any]) -> bool:
        """Verify email configuration is valid.

        Args:
            config: Channel config with 'email' field

        Returns:
            True if config is valid
        """
        if not isinstance(config, dict):
            return False

        email = config.get("email", "").strip()
        if not email or "@" not in email:
            return False

        return True

    def is_valid_email(self, email: str) -> bool:
        """Basic email validation."""
        return "@" in email and len(email) > 3
