"""Regression test: notification template CRUD.

The router previously only implemented GET /templates - there was no way to
create, edit, or delete one outside a raw SQL insert. Covers the two things
most likely to silently regress: create wires tenant_id onto the row, and
update only touches fields the client actually sent (an omitted field must
survive; an explicit null on a nullable field like alert_type must clear it).
"""

import os

os.environ.setdefault("DATABASE_URL", "postgresql+asyncpg://test:test@localhost:5432/test")
os.environ.setdefault("JWT_SECRET_KEY", "test-secret-key-for-unit-tests-only-32ch")
os.environ.setdefault("MQTT_PASSWORD", "test-mqtt-password")

from datetime import datetime, timezone
from uuid import uuid4

import pytest
from unittest.mock import AsyncMock, MagicMock

from app.database import RLSSession
from app.routers.notifications import create_template, update_template, delete_template
from app.schemas.notifications import NotificationTemplateSchema, NotificationTemplateUpdateSchema


def _make_template(tenant_id, template_id, alert_type="high_temp"):
    t = MagicMock()
    t.id = template_id
    t.tenant_id = tenant_id
    t.channel_type = "email"
    t.alert_type = alert_type
    t.name = "Original Name"
    t.subject = "Original Subject"
    t.body = "Original body {{device_name}}"
    t.variables = ["device_name"]
    t.enabled = True
    t.created_at = datetime.now(timezone.utc)
    t.updated_at = datetime.now(timezone.utc)
    return t


def _make_session(existing=None):
    session = MagicMock(spec=RLSSession)
    session.set_tenant_context = AsyncMock()
    session.commit = AsyncMock()
    session.refresh = AsyncMock()
    session.add = MagicMock()
    session.delete = AsyncMock()
    result = MagicMock()
    result.scalar_one_or_none.return_value = existing
    session.execute = AsyncMock(return_value=result)
    return session


class TestCreateTemplate:
    @pytest.mark.asyncio
    async def test_create_wires_tenant_id(self):
        tenant_id = uuid4()
        session = _make_session()

        await create_template(
            tenant_id=tenant_id,
            body=NotificationTemplateSchema(
                channel_type="email", name="Critical Alert", body="{{device_name}} fired",
            ),
            session=session,
            current_tenant=tenant_id,
        )

        added = session.add.call_args[0][0]
        assert added.tenant_id == tenant_id
        assert added.name == "Critical Alert"


class TestUpdateTemplate:
    @pytest.mark.asyncio
    async def test_omitted_field_left_untouched(self):
        tenant_id = uuid4()
        template_id = uuid4()
        template = _make_template(tenant_id, template_id)
        session = _make_session(template)

        await update_template(
            tenant_id=tenant_id,
            template_id=template_id,
            body=NotificationTemplateUpdateSchema(name="Renamed"),
            session=session,
            current_tenant=tenant_id,
        )

        assert template.name == "Renamed"
        assert template.alert_type == "high_temp"  # untouched

    @pytest.mark.asyncio
    async def test_explicit_null_clears_alert_type(self):
        tenant_id = uuid4()
        template_id = uuid4()
        template = _make_template(tenant_id, template_id)
        session = _make_session(template)

        await update_template(
            tenant_id=tenant_id,
            template_id=template_id,
            body=NotificationTemplateUpdateSchema(alert_type=None),
            session=session,
            current_tenant=tenant_id,
        )

        assert "alert_type" in NotificationTemplateUpdateSchema(alert_type=None).model_fields_set
        assert template.alert_type is None

    @pytest.mark.asyncio
    async def test_not_found_raises_404(self):
        from fastapi import HTTPException

        tenant_id = uuid4()
        session = _make_session(existing=None)

        with pytest.raises(HTTPException) as exc:
            await update_template(
                tenant_id=tenant_id,
                template_id=uuid4(),
                body=NotificationTemplateUpdateSchema(name="X"),
                session=session,
                current_tenant=tenant_id,
            )
        assert exc.value.status_code == 404


class TestDeleteTemplate:
    @pytest.mark.asyncio
    async def test_delete_removes_row(self):
        tenant_id = uuid4()
        template_id = uuid4()
        template = _make_template(tenant_id, template_id)
        session = _make_session(template)

        await delete_template(
            tenant_id=tenant_id,
            template_id=template_id,
            session=session,
            current_tenant=tenant_id,
        )

        session.delete.assert_awaited_once_with(template)
        session.commit.assert_awaited()
