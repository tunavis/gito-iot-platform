"""Regression test: invite_user must actually send email and report real outcome.

Previously invite_user() created the user with status="inactive" (but no
activation-link flow exists anywhere, and login rejects any non-"active"
user, so invited users could never log in), never called any email service
despite a `# TODO: Send invitation email`, and unconditionally returned
invitation_sent=True regardless of whether anything was sent.
"""

import os

os.environ.setdefault("DATABASE_URL", "postgresql+asyncpg://test:test@localhost:5432/test")
os.environ.setdefault("JWT_SECRET_KEY", "test-secret-key-for-unit-tests-only-32ch")
os.environ.setdefault("MQTT_PASSWORD", "test-mqtt-password")

import pytest
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import uuid4

from app.database import RLSSession
from app.routers.users import invite_user
from app.schemas.user import UserInviteRequest


def _result(first=None):
    scalars = MagicMock()
    scalars.first.return_value = first
    result = MagicMock()
    result.scalar_one_or_none.return_value = first
    return result


def _assign_id_on_add(obj):
    # SQLAlchemy applies Column(default=uuid.uuid4) at flush, not construction —
    # a mocked session.add() never flushes, so simulate that here.
    if getattr(obj, "id", None) is None:
        obj.id = uuid4()


def _make_session():
    session = MagicMock(spec=RLSSession)
    session.set_tenant_context = AsyncMock()
    session.add = MagicMock(side_effect=_assign_id_on_add)
    session.commit = AsyncMock()
    session.refresh = AsyncMock()
    session.execute = AsyncMock(return_value=_result(first=None))  # no existing user
    return session


class TestInviteUserSendsEmailAndReportsRealOutcome:
    @pytest.mark.asyncio
    async def test_successful_send_reports_active_status_and_sent_true(self):
        tenant_id = uuid4()
        session = _make_session()

        with patch("app.routers.users.validate_tenant_access", new=AsyncMock(return_value=True)), \
             patch(
                 "app.routers.users.EmailNotificationService.send",
                 return_value=(True, None),
             ):
            response = await invite_user(
                tenant_id=tenant_id,
                request=UserInviteRequest(email="new@example.com", full_name="New User", role="VIEWER"),
                session=session,
                current_tenant=tenant_id,
                current_user_info={"role": "TENANT_ADMIN"},
            )

        assert response.data.status == "active"
        assert response.data.invitation_sent is True

    @pytest.mark.asyncio
    async def test_failed_send_still_creates_user_but_reports_sent_false(self):
        tenant_id = uuid4()
        session = _make_session()

        with patch("app.routers.users.validate_tenant_access", new=AsyncMock(return_value=True)), \
             patch(
                 "app.routers.users.EmailNotificationService.send",
                 return_value=(False, "SMTP authentication failed"),
             ):
            response = await invite_user(
                tenant_id=tenant_id,
                request=UserInviteRequest(email="new2@example.com", full_name="New User", role="VIEWER"),
                session=session,
                current_tenant=tenant_id,
                current_user_info={"role": "TENANT_ADMIN"},
            )

        assert response.data.status == "active"
        assert response.data.invitation_sent is False
        session.add.assert_called_once()
