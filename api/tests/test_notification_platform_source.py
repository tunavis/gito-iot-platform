"""The dispatcher's second entry point: notifications that are not alarms.

Group 3 of add-notification-sources. `process_alert_event` is unchanged and its
own tests must pass unedited — these cover what is new.

The fallback rendering is tested first and hardest because it is not an edge
case: `notification_templates` is empty in this deployment, so the no-template
branch is the *only* branch that runs. The previous hardcoded default named a
device, which a platform fault does not have, so a stall would have rendered
"None: Alert triggered" to the person being alerted.
"""

import os

os.environ.setdefault("DATABASE_URL", "postgresql+asyncpg://test:test@localhost:5432/test")
os.environ.setdefault("JWT_SECRET_KEY", "test-secret-key-for-unit-tests-only-32ch")
os.environ.setdefault("MQTT_PASSWORD", "test-mqtt-password")

from unittest.mock import AsyncMock, MagicMock, patch
from uuid import uuid4

import pytest

from app.database import RLSSession
from app.services.notification_dispatcher import (
    SOURCE_ALERT_EVENT,
    SOURCE_INGESTION_STALL,
    NotificationDispatcher,
)

TENANT = uuid4()


def _result(first=None, all_=None):
    r = MagicMock()
    r.scalars.return_value.first.return_value = first
    r.scalars.return_value.all.return_value = all_ if all_ is not None else []
    return r


def _channel(channel_type="email"):
    c = MagicMock()
    c.id, c.user_id = uuid4(), uuid4()
    c.channel_type, c.enabled = channel_type, True
    c.config = {"email": "ops@example.com"}
    return c


def _dispatcher(channels, throttled=False, template=None):
    """A dispatcher whose queries answer in the order process_platform_event asks."""
    session = MagicMock(spec=RLSSession)
    session.commit = AsyncMock()
    session.flush = AsyncMock()

    def _assign_pk(obj):
        # A real flush applies Notification.id's column default; a mocked one
        # does not, and _send returns that id.
        if getattr(obj, "id", None) is None:
            obj.id = uuid4()

    session.add = MagicMock(side_effect=_assign_pk)

    results = [_result(all_=channels)]
    for _ in channels:
        results.append(_result(first=MagicMock() if throttled else None))  # throttle probe
        results.append(_result(first=MagicMock()))  # user lookup
        results.append(_result(first=template))  # template lookup
    session.execute = AsyncMock(side_effect=results)
    return NotificationDispatcher(session, TENANT)


class TestFallbackRendering:
    @pytest.mark.asyncio
    async def test_platform_message_names_no_device(self):
        """The actual regression: no template configured is the live path."""
        sent = {}

        def _fake_service(_type):
            svc = MagicMock()
            svc.send.side_effect = lambda *a: (sent.update(args=a), (True, None))[1]
            return svc

        with patch(
            "app.services.notification_dispatcher.ChannelFactory.create_service",
            side_effect=_fake_service,
        ):
            await _dispatcher([_channel()]).process_platform_event(
                source_kind=SOURCE_INGESTION_STALL,
                variables={"age_seconds": 4000},
                default_message="No device has reported in 4000s (threshold 900s).",
                default_subject="Ingestion stalled",
            )

        body = " ".join(str(a) for a in sent["args"])
        assert "4000s" in body
        assert "None" not in body, "rendered the alarm default, which names a device"
        assert "Alert triggered" not in body


class TestChannelSelection:
    @pytest.mark.asyncio
    async def test_reaches_every_enabled_channel(self):
        """A platform source has no alert rule, so it has no notification_rules."""
        with patch(
            "app.services.notification_dispatcher.ChannelFactory.create_service",
            return_value=MagicMock(send=MagicMock(return_value=(True, None))),
        ):
            ids = await _dispatcher([_channel(), _channel()]).process_platform_event(
                source_kind=SOURCE_INGESTION_STALL,
                variables={},
                default_message="stalled",
            )
        assert len(ids) == 2

    @pytest.mark.asyncio
    async def test_no_enabled_channel_sends_nothing_without_raising(self):
        ids = await _dispatcher([]).process_platform_event(
            source_kind=SOURCE_INGESTION_STALL, variables={}, default_message="stalled"
        )
        assert ids == []

    @pytest.mark.asyncio
    async def test_throttled_channel_is_skipped(self):
        with patch(
            "app.services.notification_dispatcher.ChannelFactory.create_service",
            return_value=MagicMock(send=MagicMock(return_value=(True, None))),
        ):
            ids = await _dispatcher([_channel()], throttled=True).process_platform_event(
                source_kind=SOURCE_INGESTION_STALL, variables={}, default_message="stalled"
            )
        assert ids == []


class TestThrottlingIsPerSourceKind:
    @pytest.mark.asyncio
    async def test_throttle_probe_filters_on_source_kind(self):
        """An alarm sent a moment ago must not suppress a stall, or the reverse."""
        session = MagicMock(spec=RLSSession)
        session.execute = AsyncMock(return_value=_result(first=None))
        dispatcher = NotificationDispatcher(session, TENANT)

        await dispatcher._is_throttled(_channel(), SOURCE_INGESTION_STALL)

        rendered = str(session.execute.call_args[0][0])
        assert "source_kind" in rendered

    @pytest.mark.asyncio
    async def test_default_source_kind_is_alert_event(self):
        """Keeps the alarm path's behaviour identical when called without a kind."""
        session = MagicMock(spec=RLSSession)
        session.execute = AsyncMock(return_value=_result(first=None))
        dispatcher = NotificationDispatcher(session, TENANT)

        assert await dispatcher._is_throttled(_channel()) is False
        assert SOURCE_ALERT_EVENT == "alert_event"


class TestTemplateSelection:
    @pytest.mark.asyncio
    async def test_selection_orders_by_alert_type_in_one_query(self):
        """One round trip, and the WHERE clause still matches what it used to.

        Preference is expressed in ORDER BY precisely so this can never select
        *fewer* templates than before — a tenant whose only enabled template
        carries an unrelated alert_type must keep getting it rather than
        silently dropping to the hardcoded fallback.
        """
        session = MagicMock(spec=RLSSession)
        session.execute = AsyncMock(return_value=_result(first=None))
        dispatcher = NotificationDispatcher(session, TENANT)

        await dispatcher._resolve_template(_channel(), SOURCE_INGESTION_STALL)

        assert session.execute.await_count == 1, "template lookup must be a single query"
        rendered = str(session.execute.call_args[0][0])
        assert "ORDER BY" in rendered.upper()
        assert "alert_type" in rendered
