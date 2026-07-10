"""Regression test: execute_campaign must persist per-device OTA outcome.

The failure branch used to `select(OTACampaignDevice).where(...)` and discard
the result without ever setting status/error_message or committing — every
OTACampaignDevice row stayed 'pending' forever regardless of what actually
happened. The success branch never touched the row at all either.
"""

import os

os.environ.setdefault("DATABASE_URL", "postgresql+asyncpg://test:test@localhost:5432/test")
os.environ.setdefault("JWT_SECRET_KEY", "test-secret-key-for-unit-tests-only-32ch")
os.environ.setdefault("MQTT_PASSWORD", "test-mqtt-password")

import pytest
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import uuid4

from app.database import RLSSession
from app.models.firmware import OTACampaignExecute
from app.routers.firmware import execute_campaign


def _result(first=None, all_=None):
    scalars = MagicMock()
    scalars.first.return_value = first
    scalars.one_or_none.return_value = first
    scalars.all.return_value = all_ or []
    result = MagicMock()
    result.scalars.return_value = scalars
    result.scalar_one_or_none.return_value = first
    return result


class TestExecuteCampaignPersistsPerDeviceOutcome:
    @pytest.mark.asyncio
    async def test_success_and_failure_are_both_recorded(self):
        tenant_id = uuid4()
        campaign_id = uuid4()
        ok_device_id = uuid4()
        failing_device_id = uuid4()

        campaign = MagicMock(id=campaign_id, firmware_version_id=uuid4())
        fw = MagicMock(url="https://fw/v1.bin", hash="abc", version="1.0.0")
        ok_device = MagicMock(id=ok_device_id)
        failing_device = MagicMock(id=failing_device_id)

        session = MagicMock(spec=RLSSession)
        session.set_tenant_context = AsyncMock()
        session.add = MagicMock()
        session.commit = AsyncMock()
        session.execute = AsyncMock(side_effect=[
            _result(first=campaign),                          # campaign lookup
            _result(first=fw),                                 # firmware lookup
            _result(all_=[ok_device, failing_device]),          # devices list
        ])

        with patch(
            "app.routers.firmware.OTADispatchService.dispatch",
            new=AsyncMock(side_effect=[(True, None), (False, "device unreachable")]),
        ):
            result = await execute_campaign(
                tenant_id=tenant_id,
                campaign_id=campaign_id,
                body=OTACampaignExecute(device_ids=[ok_device_id, failing_device_id]),
                current_tenant=tenant_id,
                session=session,
            )

        assert result["dispatched"] == 1
        assert result["failed"] == 1

        added_campaign_devices = [
            call.args[0] for call in session.add.call_args_list
            if call.args[0].__class__.__name__ == "OTACampaignDevice"
        ]
        by_device_id = {cd.device_id: cd for cd in added_campaign_devices}

        assert by_device_id[ok_device_id].status == "in_progress"
        assert by_device_id[failing_device_id].status == "failed"
        assert by_device_id[failing_device_id].error_message == "device unreachable"
        assert by_device_id[failing_device_id].completed_at is not None
