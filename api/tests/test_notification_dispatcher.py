"""Regression test for NotificationDispatcher's async session usage.

The dispatcher used to be written against SQLModel's sync `session.exec()`
API but is always constructed with a real async RLSSession (see
app/services/background_tasks.py::process_notification_queue, which runs
every 10s via APScheduler) — every call raised AttributeError. This test
uses a session mock spec'd on RLSSession so calling a nonexistent method
like `.exec()` fails the same way the real RLSSession would.
"""

import os

os.environ.setdefault("DATABASE_URL", "postgresql+asyncpg://test:test@localhost:5432/test")
os.environ.setdefault("JWT_SECRET_KEY", "test-secret-key-for-unit-tests-only-32ch")
os.environ.setdefault("MQTT_PASSWORD", "test-mqtt-password")

import pytest
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import uuid4

from app.database import RLSSession
from app.services.notification_dispatcher import NotificationDispatcher


def _result(first=None, all_=None):
    """Fake sqlalchemy Result: .scalars().first() / .scalars().all()."""
    scalars = MagicMock()
    scalars.first.return_value = first
    scalars.all.return_value = all_ or []
    result = MagicMock()
    result.scalars.return_value = scalars
    return result


class TestProcessAlertEvent:
    @pytest.mark.asyncio
    async def test_dispatches_via_async_session_without_attribute_error(self):
        alert_event = MagicMock(
            id=uuid4(), alert_rule_id=uuid4(), device_id=uuid4(),
            metric_value=42, message="High temp", fired_at=None,
        )
        alert_rule = MagicMock(id=uuid4(), metric="temperature", threshold=30)
        device = MagicMock(id=uuid4(), name="Pump 1")
        notif_rule = MagicMock(channel_id=uuid4())
        channel = MagicMock(
            id=uuid4(), enabled=True, channel_type="webhook",
            config={"webhook_url": "https://example.com/hook"}, user_id=uuid4(),
        )
        user = MagicMock()

        # spec=RLSSession: accessing a method RLSSession doesn't have (e.g.
        # the old code's `.exec()`) raises AttributeError, same as the real thing.
        session = MagicMock(spec=RLSSession)
        session.execute = AsyncMock(side_effect=[
            _result(first=alert_event),      # AlertEvent lookup
            _result(first=alert_rule),       # AlertRule lookup
            _result(first=device),           # Device lookup
            _result(all_=[notif_rule]),      # NotificationRules for this alert_rule
            _result(first=channel),          # NotificationChannel lookup
            _result(first=user),             # User lookup
            _result(first=None),             # throttle check: nothing recent
            _result(first=None),             # NotificationTemplate: none configured
        ])
        session.commit = AsyncMock()
        session.flush = AsyncMock()
        # Notification.id is a Column(default=uuid.uuid4) populated by the ORM at
        # flush time, not at construction — simulate that so notification.id is
        # non-None after the code's add()+flush(), same as against a real session.
        session.add = MagicMock(side_effect=lambda obj: setattr(obj, "id", obj.id or uuid4()))

        dispatcher = NotificationDispatcher(session, tenant_id=uuid4())

        with patch(
            "app.services.notification_dispatcher.ChannelFactory.create_service"
        ) as mock_create_service:
            mock_service = MagicMock()
            mock_service.send.return_value = (True, None)
            mock_create_service.return_value = mock_service

            notification_ids = await dispatcher.process_alert_event(alert_event.id)

        assert len(notification_ids) == 1
        assert alert_event.notification_sent is True
        mock_service.send.assert_called_once()
        session.commit.assert_awaited()

    @pytest.mark.asyncio
    async def test_missing_alert_event_returns_empty_without_error(self):
        session = MagicMock(spec=RLSSession)
        session.execute = AsyncMock(return_value=_result(first=None))

        dispatcher = NotificationDispatcher(session, tenant_id=uuid4())

        assert await dispatcher.process_alert_event(uuid4()) == []
