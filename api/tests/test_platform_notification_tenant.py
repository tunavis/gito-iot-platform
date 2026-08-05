"""Who hears about a platform-wide fault — and when the answer is "nobody".

`add-notification-sources` routes platform faults (an ingestion stall) to the
management tenant. The proposal named `dependencies.get_management_tenant` as
the mechanism; that function reads a JWT and asserts the *caller's* tenant_type,
performs no lookup, and is unusable from the background task where stalls are
actually detected. Hence a real resolver, and hence these tests.

Nothing in the schema constrains how many tenants may be marked management, so
zero and several are both reachable. Neither has a safe guess: with none there
is nobody to tell, and with several an arbitrary pick sends our infrastructure's
problems to whichever customer sorts first. Both must refuse.

This deployment has exactly one tenant and it *is* the management tenant, so the
failure paths are reachable only here.
"""

import os

os.environ.setdefault("DATABASE_URL", "postgresql+asyncpg://test:test@localhost:5432/test")
os.environ.setdefault("JWT_SECRET_KEY", "test-secret-key-for-unit-tests-only-32ch")
os.environ.setdefault("MQTT_PASSWORD", "test-mqtt-password")

from unittest.mock import AsyncMock, MagicMock
from uuid import uuid4

import pytest

from app.database import RLSSession
from app.services.notification_dispatcher import resolve_platform_notification_tenant


def _session(tenant_ids):
    """A session whose one query returns these tenant ids as rows."""
    result = MagicMock()
    result.all.return_value = [(tid,) for tid in tenant_ids]
    session = MagicMock(spec=RLSSession)
    session.execute = AsyncMock(return_value=result)
    return session


class TestResolvePlatformNotificationTenant:
    @pytest.mark.asyncio
    async def test_exactly_one_management_tenant_is_the_recipient(self):
        expected = uuid4()
        assert await resolve_platform_notification_tenant(_session([expected])) == expected

    @pytest.mark.asyncio
    async def test_no_management_tenant_refuses(self, caplog):
        """Nobody to tell. Inventing a recipient notifies an arbitrary customer."""
        with caplog.at_level("ERROR"):
            assert await resolve_platform_notification_tenant(_session([])) is None
        assert "no tenant has tenant_type='management'" in caplog.text

    @pytest.mark.asyncio
    async def test_several_management_tenants_refuse_and_name_them(self, caplog):
        """An arbitrary pick would send the same fault to different people per deploy."""
        a, b = uuid4(), uuid4()
        with caplog.at_level("ERROR"):
            assert await resolve_platform_notification_tenant(_session([a, b])) is None
        # Both candidates named, so an operator can resolve it without a query.
        assert str(a) in caplog.text and str(b) in caplog.text

    @pytest.mark.asyncio
    async def test_it_does_not_read_a_jwt(self):
        """Guards the actual bug: the proposal's function needs a request context.

        A regression that swapped this back to `get_management_tenant` would fail
        on a session-only call, which is all a background task can offer.
        """
        assert await resolve_platform_notification_tenant(_session([uuid4()])) is not None
