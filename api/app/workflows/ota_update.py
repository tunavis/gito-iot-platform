"""OTA_UPDATE_DEVICE workflow for Cadence.

State machine for managing firmware over-the-air updates:
QUEUED → PREPARING → DOWNLOADING → APPLYING → COMPLETE
         ↓
       ROLLBACK (on failure)

This workflow:
1. Validates device is ready for update
2. Sends MQTT command to device
3. Polls device status during download/apply
4. Verifies firmware integrity
5. Updates device record on success
6. Initiates rollback on failure
"""

import logging
from typing import Optional
from datetime import timedelta

from cadenceclient.decorators import workflow, activity

logger = logging.getLogger(__name__)


@workflow
class OTA_UPDATE_DEVICE:
    """Firmware update workflow.

    Input:
    {
        "tenant_id": "uuid",
        "device_id": "uuid",
        "firmware_version_id": "uuid",
        "firmware_url": "https://...",
        "firmware_hash": "sha256...",
        "device_name": "device1"
    }

    Output:
    {
        "status": "completed",
        "device_id": "uuid",
        "previous_version": "1.0.0",
        "new_version": "2.0.0",
        "duration_seconds": 120
    }
    """

    def __init__(self):
        """Initialize workflow."""
        self.status = "QUEUED"
        self.attempts = 0
        self.max_retries = 3

    async def execute(self, workflow_input: dict) -> dict:
        """Execute OTA update workflow.

        Args:
            workflow_input: Workflow input with firmware details

        Returns:
            Workflow output with completion status
        """
        try:
            tenant_id = workflow_input.get("tenant_id")
            device_id = workflow_input.get("device_id")
            firmware_url = workflow_input.get("firmware_url")
            firmware_hash = workflow_input.get("firmware_hash")
            device_name = workflow_input.get("device_name")

            logger.info(
                "ota_workflow_executing",
                extra={
                    "tenant_id": tenant_id,
                    "device_id": device_id,
                    "device_name": device_name,
                    "firmware_url": firmware_url,
                },
            )

            # State 1: PREPARING - Check device readiness
            self.status = "PREPARING"
            device_ready = await self._prepare_device(
                tenant_id=tenant_id,
                device_id=device_id,
                device_name=device_name,
            )

            if not device_ready:
                logger.error(
                    "ota_device_not_ready",
                    extra={"device_id": device_id, "tenant_id": tenant_id},
                )
                self.status = "FAILED"
                return {
                    "status": "failed",
                    "device_id": device_id,
                    "error": "Device not ready for update",
                    "error_code": "DEVICE_NOT_READY",
                }

            # State 2: DOWNLOADING - Send OTA command to device
            self.status = "DOWNLOADING"
            download_success = await self._send_ota_command(
                tenant_id=tenant_id,
                device_id=device_id,
                firmware_url=firmware_url,
                device_name=device_name,
            )

            if not download_success:
                logger.warning(
                    "ota_download_failed",
                    extra={"device_id": device_id, "tenant_id": tenant_id},
                )
                self.status = "ROLLBACK"
                await self._rollback_firmware(
                    tenant_id=tenant_id,
                    device_id=device_id,
                    device_name=device_name,
                )
                return {
                    "status": "failed",
                    "device_id": device_id,
                    "error": "Firmware download failed",
                    "error_code": "DOWNLOAD_FAILED",
                }

            # State 3: APPLYING - Poll device status
            self.status = "APPLYING"
            apply_success = await self._verify_firmware_applied(
                tenant_id=tenant_id,
                device_id=device_id,
                firmware_hash=firmware_hash,
                device_name=device_name,
            )

            if not apply_success:
                logger.warning(
                    "ota_apply_failed",
                    extra={"device_id": device_id, "tenant_id": tenant_id},
                )
                self.status = "ROLLBACK"
                await self._rollback_firmware(
                    tenant_id=tenant_id,
                    device_id=device_id,
                    device_name=device_name,
                )
                return {
                    "status": "failed",
                    "device_id": device_id,
                    "error": "Firmware verification failed",
                    "error_code": "VERIFICATION_FAILED",
                }

            # State 4: COMPLETE - Update device record
            self.status = "COMPLETE"
            await self._update_device_firmware(
                tenant_id=tenant_id,
                device_id=device_id,
                firmware_version_id=workflow_input.get("firmware_version_id"),
            )

            logger.info(
                "ota_workflow_completed",
                extra={
                    "tenant_id": tenant_id,
                    "device_id": device_id,
                    "device_name": device_name,
                },
            )

            return {
                "status": "completed",
                "device_id": device_id,
                "device_name": device_name,
                "firmware_version": workflow_input.get("firmware_version_id"),
            }

        except Exception as e:
            logger.error(
                "ota_workflow_exception",
                extra={
                    "device_id": workflow_input.get("device_id"),
                    "tenant_id": workflow_input.get("tenant_id"),
                    "error": str(e),
                },
            )
            return {
                "status": "failed",
                "device_id": workflow_input.get("device_id"),
                "error": str(e),
                "error_code": "WORKFLOW_ERROR",
            }

    async def _prepare_device(
        self,
        tenant_id: str,
        device_id: str,
        device_name: str,
    ) -> bool:
        """Check if device is ready for OTA update.

        Returns:
            True if device is online and ready, False otherwise
        """
        # Call activity to check device readiness
        # Will retry with exponential backoff
        try:
            result = await check_device_ready.execute_async(
                tenant_id=tenant_id,
                device_id=device_id,
                device_name=device_name,
                timeout=timedelta(seconds=30),
                retry_policy={
                    "initial_interval": timedelta(seconds=1),
                    "backoff_coefficient": 2.0,
                    "max_interval": timedelta(seconds=8),
                    "max_attempts": 3,
                },
            )
            return result.get("ready", False)
        except Exception as e:
            logger.error(
                "prepare_device_activity_failed",
                extra={"device_id": device_id, "error": str(e)},
            )
            return False

    async def _send_ota_command(
        self,
        tenant_id: str,
        device_id: str,
        firmware_url: str,
        device_name: str,
    ) -> bool:
        """Send OTA update command to device via MQTT.

        Returns:
            True if command sent successfully, False otherwise
        """
        try:
            result = await send_mqtt_command.execute_async(
                tenant_id=tenant_id,
                device_id=device_id,
                firmware_url=firmware_url,
                device_name=device_name,
                command_type="OTA_UPDATE",
                timeout=timedelta(seconds=60),
                retry_policy={
                    "initial_interval": timedelta(seconds=2),
                    "backoff_coefficient": 2.0,
                    "max_interval": timedelta(seconds=8),
                    "max_attempts": 3,
                },
            )
            return result.get("sent", False)
        except Exception as e:
            logger.error(
                "send_ota_command_activity_failed",
                extra={"device_id": device_id, "error": str(e)},
            )
            return False

    async def _verify_firmware_applied(
        self,
        tenant_id: str,
        device_id: str,
        firmware_hash: str,
        device_name: str,
    ) -> bool:
        """Verify firmware was successfully applied to device.

        Returns:
            True if firmware verified, False if verification failed
        """
        try:
            result = await verify_firmware_applied.execute_async(
                tenant_id=tenant_id,
                device_id=device_id,
                firmware_hash=firmware_hash,
                device_name=device_name,
                timeout=timedelta(seconds=600),  # 10 minutes for download+apply
                retry_policy={
                    "initial_interval": timedelta(seconds=5),
                    "backoff_coefficient": 1.5,
                    "max_interval": timedelta(seconds=30),
                    "max_attempts": 60,  # Poll up to 60 times = 10min total
                },
            )
            return result.get("verified", False)
        except Exception as e:
            logger.error(
                "verify_firmware_activity_failed",
                extra={"device_id": device_id, "error": str(e)},
            )
            return False

    async def _update_device_firmware(
        self,
        tenant_id: str,
        device_id: str,
        firmware_version_id: str,
    ) -> bool:
        """Update device firmware version in database.

        Returns:
            True if database updated, False otherwise
        """
        try:
            result = await update_device_firmware_version.execute_async(
                tenant_id=tenant_id,
                device_id=device_id,
                firmware_version_id=firmware_version_id,
                timeout=timedelta(seconds=30),
            )
            return result.get("updated", False)
        except Exception as e:
            logger.error(
                "update_device_firmware_activity_failed",
                extra={"device_id": device_id, "error": str(e)},
            )
            return False

    async def _rollback_firmware(
        self,
        tenant_id: str,
        device_id: str,
        device_name: str,
    ) -> bool:
        """Initiate rollback to previous firmware version.

        Returns:
            True if rollback initiated, False otherwise
        """
        try:
            result = await initiate_rollback.execute_async(
                tenant_id=tenant_id,
                device_id=device_id,
                device_name=device_name,
                timeout=timedelta(seconds=60),
            )
            return result.get("initiated", False)
        except Exception as e:
            logger.error(
                "rollback_activity_failed",
                extra={"device_id": device_id, "error": str(e)},
            )
            return False


# Placeholder activity definitions - to be implemented in activities module
# These will be real activities executed by Cadence workers

async def check_device_ready(tenant_id: str, device_id: str, device_name: str) -> dict:
    """Activity: Check if device is online and ready for update."""
    return {"ready": True}  # Placeholder


async def send_mqtt_command(
    tenant_id: str,
    device_id: str,
    firmware_url: str,
    device_name: str,
    command_type: str,
) -> dict:
    """Activity: Send MQTT OTA command to device."""
    return {"sent": True}  # Placeholder


async def verify_firmware_applied(
    tenant_id: str,
    device_id: str,
    firmware_hash: str,
    device_name: str,
) -> dict:
    """Activity: Verify firmware was applied by checking device status."""
    return {"verified": True}  # Placeholder


async def update_device_firmware_version(
    tenant_id: str,
    device_id: str,
    firmware_version_id: str,
) -> dict:
    """Activity: Update device firmware version in database."""
    return {"updated": True}  # Placeholder


async def initiate_rollback(
    tenant_id: str,
    device_id: str,
    device_name: str,
) -> dict:
    """Activity: Send rollback command to device."""
    return {"initiated": True}  # Placeholder
