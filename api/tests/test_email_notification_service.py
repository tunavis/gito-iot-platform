"""Regression test: EmailNotificationService.send() must not crash on a bad
Settings attribute name.

send() referenced `self.settings.SMTP_TLS`, but Settings only defines
SMTP_USE_TLS. Every real send hit an AttributeError inside the try/except,
which the generic `except Exception` swallowed and reported as a normal SMTP
failure — so every "email" notification channel silently failed, forever,
even with fully correct SMTP credentials configured.
"""

import os

os.environ.setdefault("DATABASE_URL", "postgresql+asyncpg://test:test@localhost:5432/test")
os.environ.setdefault("JWT_SECRET_KEY", "test-secret-key-for-unit-tests-only-32ch")
os.environ.setdefault("MQTT_PASSWORD", "test-mqtt-password")

from unittest.mock import MagicMock, patch

from app.services.channels.email_service import EmailNotificationService


class TestEmailNotificationServiceSend:
    def test_send_uses_smtp_use_tls_without_crashing(self):
        service = EmailNotificationService()
        service.smtp_host = "smtp.example.com"
        service.smtp_port = 587
        service.smtp_user = "user"
        service.smtp_password = "pass"

        fake_server = MagicMock()
        with patch("smtplib.SMTP") as smtp_cls:
            smtp_cls.return_value.__enter__.return_value = fake_server
            success, error = service.send("to@example.com", "Subject", "Body")

        assert success is True
        assert error is None
        fake_server.starttls.assert_called_once()
