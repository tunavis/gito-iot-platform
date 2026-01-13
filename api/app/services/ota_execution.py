"""OTA execution service - Campaign orchestration.

This service handles:
- Starting firmware campaigns
- Orchestrating device updates via Cadence
- Tracking campaign and device progress
- Aggregating campaign status
"""

import logging
from typing import Optional
from uuid import UUID
from datetime import datetime

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.base import Device, OTACampaign, OTACampaignDevice, FirmwareVersion
from app.services.ota_workflow import OTAWorkflowClient

logger = logging.getLogger(__name__)


class OTAExecutionService:
    """Service for executing OTA campaigns."""

    def __init__(self, workflow_client: OTAWorkflowClient):
        """Initialize OTA execution service.

        Args:
            workflow_client: Cadence workflow client for submitting workflows
        """
        self.workflow_client = workflow_client

    async def start_campaign(
        self,
        session: AsyncSession,
        tenant_id: UUID,
        campaign_id: UUID,
    ) -> dict:
        """Start an OTA campaign - submit workflows for all devices.

        Args:
            session: Database session
            tenant_id: Tenant UUID
            campaign_id: Campaign UUID

        Returns:
            Dict with campaign status and workflow details

        Raises:
            Exception: If campaign not found or execution fails
        """
        try:
            # Get campaign from DB
            campaign_query = select(OTACampaign).where(
                OTACampaign.id == campaign_id,
                OTACampaign.tenant_id == tenant_id,
            )
            result = await session.execute(campaign_query)
            campaign = result.scalar_one_or_none()

            if not campaign:
                logger.error(
                    "campaign_not_found",
                    extra={
                        "campaign_id": str(campaign_id),
                        "tenant_id": str(tenant_id),
                    },
                )
                raise Exception("Campaign not found")

            if campaign.status != "draft":
                logger.warning(
                    "campaign_not_in_draft_status",
                    extra={
                        "campaign_id": str(campaign_id),
                        "status": campaign.status,
                    },
                )
                raise Exception(f"Campaign status is {campaign.status}, not draft")

            # Get firmware version
            firmware_query = select(FirmwareVersion).where(
                FirmwareVersion.id == campaign.firmware_version_id
            )
            firmware = (await session.execute(firmware_query)).scalar_one_or_none()

            if not firmware:
                logger.error(
                    "firmware_version_not_found",
                    extra={
                        "firmware_version_id": str(campaign.firmware_version_id)
                    },
                )
                raise Exception("Firmware version not found")

            # Update campaign status
            await session.execute(
                update(OTACampaign)
                .where(OTACampaign.id == campaign_id)
                .values(
                    status="in_progress",
                    started_at=datetime.utcnow(),
                )
            )
            await session.commit()

            # Get all devices for campaign
            devices_query = select(OTACampaignDevice).where(
                OTACampaignDevice.campaign_id == campaign_id
            )
            result = await session.execute(devices_query)
            campaign_devices = result.scalars().all()

            workflow_count = 0
            failed_count = 0

            # Submit workflow for each device
            for campaign_device in campaign_devices:
                # Get device details
                device_query = select(Device).where(
                    Device.id == campaign_device.device_id
                )
                device = (await session.execute(device_query)).scalar_one_or_none()

                if not device:
                    logger.warning(
                        "device_not_found_in_campaign",
                        extra={"device_id": str(campaign_device.device_id)},
                    )
                    # Mark campaign device as skipped
                    await session.execute(
                        update(OTACampaignDevice)
                        .where(OTACampaignDevice.id == campaign_device.id)
                        .values(status="skipped", error_message="Device not found")
                    )
                    continue

                # Submit workflow to Cadence
                execution_id = await self.workflow_client.start_ota_update_workflow(
                    tenant_id=tenant_id,
                    device_id=device.id,
                    firmware_version_id=campaign.firmware_version_id,
                    firmware_url=firmware.url,
                    firmware_hash=firmware.hash,
                    device_name=device.name,
                )

                if execution_id:
                    # Update campaign device with execution ID
                    await session.execute(
                        update(OTACampaignDevice)
                        .where(OTACampaignDevice.id == campaign_device.id)
                        .values(
                            status="in_progress",
                            started_at=datetime.utcnow(),
                        )
                    )
                    workflow_count += 1
                    logger.info(
                        "workflow_submitted",
                        extra={
                            "device_id": str(device.id),
                            "execution_id": execution_id,
                            "campaign_id": str(campaign_id),
                        },
                    )
                else:
                    # Workflow submission failed
                    failed_count += 1
                    await session.execute(
                        update(OTACampaignDevice)
                        .where(OTACampaignDevice.id == campaign_device.id)
                        .values(
                            status="failed",
                            error_message="Failed to submit Cadence workflow",
                        )
                    )
                    logger.error(
                        "workflow_submission_failed",
                        extra={"device_id": str(device.id), "campaign_id": str(campaign_id)},
                    )

            await session.commit()

            logger.info(
                "campaign_execution_started",
                extra={
                    "campaign_id": str(campaign_id),
                    "tenant_id": str(tenant_id),
                    "workflows_submitted": workflow_count,
                    "failed_submissions": failed_count,
                },
            )

            return {
                "campaign_id": str(campaign_id),
                "status": "in_progress",
                "workflows_submitted": workflow_count,
                "failures": failed_count,
            }

        except Exception as e:
            logger.error(
                "campaign_execution_failed",
                extra={
                    "campaign_id": str(campaign_id),
                    "error": str(e),
                },
            )
            raise

    async def get_campaign_status(
        self,
        session: AsyncSession,
        tenant_id: UUID,
        campaign_id: UUID,
    ) -> dict:
        """Get campaign execution status and device progress.

        Args:
            session: Database session
            tenant_id: Tenant UUID
            campaign_id: Campaign UUID

        Returns:
            Dict with campaign status, device progress, and counts

        Raises:
            Exception: If campaign not found
        """
        try:
            # Get campaign
            campaign_query = select(OTACampaign).where(
                OTACampaign.id == campaign_id,
                OTACampaign.tenant_id == tenant_id,
            )
            campaign = (await session.execute(campaign_query)).scalar_one_or_none()

            if not campaign:
                raise Exception("Campaign not found")

            # Get device status
            devices_query = select(OTACampaignDevice).where(
                OTACampaignDevice.campaign_id == campaign_id
            )
            result = await session.execute(devices_query)
            campaign_devices = result.scalars().all()

            # Aggregate status
            status_counts = {
                "pending": 0,
                "in_progress": 0,
                "completed": 0,
                "failed": 0,
                "skipped": 0,
            }

            for device in campaign_devices:
                status = device.status
                if status in status_counts:
                    status_counts[status] += 1

            total_devices = len(campaign_devices)
            completed = status_counts["completed"]
            failed = status_counts["failed"]
            in_progress = status_counts["in_progress"]

            # Calculate progress
            if total_devices > 0:
                progress_percent = int((completed / total_devices) * 100)
            else:
                progress_percent = 0

            return {
                "campaign_id": str(campaign_id),
                "status": campaign.status,
                "progress_percent": progress_percent,
                "total_devices": total_devices,
                "status_counts": status_counts,
                "started_at": campaign.started_at.isoformat() if campaign.started_at else None,
                "completed_at": campaign.completed_at.isoformat() if campaign.completed_at else None,
            }

        except Exception as e:
            logger.error(
                "get_campaign_status_failed",
                extra={
                    "campaign_id": str(campaign_id),
                    "error": str(e),
                },
            )
            raise

    async def update_device_ota(
        self,
        session: AsyncSession,
        tenant_id: UUID,
        device_id: UUID,
        firmware_version_id: UUID,
        firmware_url: str,
        firmware_hash: str,
    ) -> dict:
        """Update single device firmware (direct OTA, not campaign).

        Args:
            session: Database session
            tenant_id: Tenant UUID
            device_id: Device UUID
            firmware_version_id: Firmware version UUID
            firmware_url: Pre-signed URL to firmware
            firmware_hash: SHA256 hash of firmware

        Returns:
            Dict with update status and execution ID

        Raises:
            Exception: If device not found or workflow submission fails
        """
        try:
            # Get device
            device_query = select(Device).where(
                Device.id == device_id,
                Device.tenant_id == tenant_id,
            )
            device = (await session.execute(device_query)).scalar_one_or_none()

            if not device:
                raise Exception("Device not found")

            # Submit workflow to Cadence
            execution_id = await self.workflow_client.start_ota_update_workflow(
                tenant_id=tenant_id,
                device_id=device.id,
                firmware_version_id=firmware_version_id,
                firmware_url=firmware_url,
                firmware_hash=firmware_hash,
                device_name=device.name,
            )

            if not execution_id:
                raise Exception("Failed to submit OTA workflow to Cadence")

            logger.info(
                "device_ota_update_started",
                extra={
                    "device_id": str(device_id),
                    "firmware_version_id": str(firmware_version_id),
                    "execution_id": execution_id,
                },
            )

            return {
                "device_id": str(device_id),
                "firmware_version_id": str(firmware_version_id),
                "execution_id": execution_id,
                "status": "in_progress",
            }

        except Exception as e:
            logger.error(
                "device_ota_update_failed",
                extra={
                    "device_id": str(device_id),
                    "error": str(e),
                },
            )
            raise
