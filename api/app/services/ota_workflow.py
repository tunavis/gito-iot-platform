"""Cadence workflow client for OTA orchestration.

This service handles communication with Cadence workflow engine for managing
firmware over-the-air (OTA) update workflows.

Key responsibilities:
- Submit OTA workflows to Cadence
- Track workflow execution status
- Handle workflow completion and errors
- Provide retry logic and timeouts
"""

import logging
import json
from typing import Optional
from uuid import UUID
from datetime import datetime, timedelta

from cadenceclient.cadence_client import CadenceClient
from cadenceclient.workflow_service import WorkflowService

from app.config import get_settings

logger = logging.getLogger(__name__)


class OTAWorkflowClient:
    """Client for OTA workflow operations via Cadence."""

    def __init__(self):
        """Initialize Cadence workflow client."""
        self.settings = get_settings()
        self.client: Optional[CadenceClient] = None
        self.workflow_service: Optional[WorkflowService] = None

    async def connect(self) -> bool:
        """Connect to Cadence server.

        Returns:
            True if connection successful, False otherwise
        """
        try:
            self.client = CadenceClient(
                host=self.settings.CADENCE_FRONTEND_HOST,
                port=int(self.settings.CADENCE_FRONTEND_PORT),
            )
            logger.info(
                "cadence_client_initialized",
                extra={
                    "host": self.settings.CADENCE_FRONTEND_HOST,
                    "port": self.settings.CADENCE_FRONTEND_PORT,
                },
            )
            return True
        except Exception as e:
            logger.error(
                "cadence_connection_failed",
                extra={"error": str(e)},
            )
            return False

    async def close(self):
        """Close Cadence connection."""
        if self.client:
            await self.client.close()

    async def start_ota_update_workflow(
        self,
        tenant_id: UUID,
        device_id: UUID,
        firmware_version_id: UUID,
        firmware_url: str,
        firmware_hash: str,
        device_name: str,
    ) -> Optional[str]:
        """Start OTA_UPDATE_DEVICE workflow.

        Args:
            tenant_id: Tenant UUID
            device_id: Device UUID
            firmware_version_id: Firmware version UUID
            firmware_url: Pre-signed URL to firmware binary
            firmware_hash: SHA256 hash for verification
            device_name: Device name (for logging)

        Returns:
            Workflow execution ID, or None if failed
        """
        if not self.client:
            logger.error("cadence_not_connected")
            return None

        try:
            workflow_input = {
                "tenant_id": str(tenant_id),
                "device_id": str(device_id),
                "firmware_version_id": str(firmware_version_id),
                "firmware_url": firmware_url,
                "firmware_hash": firmware_hash,
                "device_name": device_name,
            }

            execution = await self.client.start_workflow(
                domain=f"gito-tenant-{tenant_id}",  # Tenant-scoped domain
                workflow_id=f"ota-{device_id}-{firmware_version_id}",
                workflow_type="OTA_UPDATE_DEVICE",
                input=json.dumps(workflow_input),
                execution_start_to_close_timeout_seconds=3600,  # 1 hour max
                task_start_to_close_timeout_seconds=60,
            )

            logger.info(
                "ota_workflow_started",
                extra={
                    "tenant_id": str(tenant_id),
                    "device_id": str(device_id),
                    "firmware_version_id": str(firmware_version_id),
                    "execution_id": execution.workflow_execution_id,
                },
            )

            return execution.workflow_execution_id

        except Exception as e:
            logger.error(
                "ota_workflow_submission_failed",
                extra={
                    "tenant_id": str(tenant_id),
                    "device_id": str(device_id),
                    "error": str(e),
                },
            )
            return None

    async def get_workflow_status(
        self,
        tenant_id: UUID,
        workflow_execution_id: str,
    ) -> Optional[dict]:
        """Get current OTA workflow status.

        Args:
            tenant_id: Tenant UUID
            workflow_execution_id: Workflow execution ID returned by start_ota_update_workflow

        Returns:
            Dict with status, progress, error; or None if failed
        """
        if not self.client:
            logger.error("cadence_not_connected")
            return None

        try:
            execution = await self.client.describe_workflow_execution(
                domain=f"gito-tenant-{tenant_id}",
                workflow_execution_id=workflow_execution_id,
            )

            status = "running"
            if execution.is_closed():
                status = "completed" if execution.is_succeeded() else "failed"

            result = {
                "status": status,
                "execution_id": workflow_execution_id,
                "started_at": execution.get_started_at().isoformat() if execution.get_started_at() else None,
                "closed_at": execution.get_closed_at().isoformat() if execution.get_closed_at() else None,
            }

            if execution.is_closed() and execution.get_result():
                try:
                    result["result"] = json.loads(execution.get_result())
                except json.JSONDecodeError:
                    result["result"] = execution.get_result()

            if execution.get_failure_reason():
                result["error"] = execution.get_failure_reason()

            return result

        except Exception as e:
            logger.error(
                "ota_workflow_status_failed",
                extra={
                    "tenant_id": str(tenant_id),
                    "execution_id": workflow_execution_id,
                    "error": str(e),
                },
            )
            return None

    async def cancel_workflow(
        self,
        tenant_id: UUID,
        workflow_execution_id: str,
    ) -> bool:
        """Cancel running OTA workflow.

        Args:
            tenant_id: Tenant UUID
            workflow_execution_id: Workflow execution ID

        Returns:
            True if cancelled successfully, False otherwise
        """
        if not self.client:
            logger.error("cadence_not_connected")
            return False

        try:
            await self.client.terminate_workflow_execution(
                domain=f"gito-tenant-{tenant_id}",
                workflow_execution_id=workflow_execution_id,
                reason="Cancelled by user",
            )

            logger.info(
                "ota_workflow_cancelled",
                extra={
                    "tenant_id": str(tenant_id),
                    "execution_id": workflow_execution_id,
                },
            )

            return True

        except Exception as e:
            logger.error(
                "ota_workflow_cancel_failed",
                extra={
                    "tenant_id": str(tenant_id),
                    "execution_id": workflow_execution_id,
                    "error": str(e),
                },
            )
            return False

    async def start_ota_bulk_workflow(
        self,
        tenant_id: UUID,
        group_id: UUID,
        operation_id: UUID,
        firmware_version_id: UUID,
        device_ids: list,
    ) -> Optional[str]:
        """Start BULK_OTA_UPDATE workflow.

        Args:
            tenant_id: Tenant UUID
            group_id: Device group UUID
            operation_id: Bulk operation UUID
            firmware_version_id: Firmware version UUID
            device_ids: List of device UUIDs

        Returns:
            Workflow execution ID, or None if failed
        """
        if not self.client:
            logger.error("cadence_not_connected")
            return None

        try:
            workflow_input = {
                "tenant_id": str(tenant_id),
                "group_id": str(group_id),
                "operation_id": str(operation_id),
                "firmware_version_id": str(firmware_version_id),
                "device_ids": [str(d) for d in device_ids],
            }

            execution = await self.client.start_workflow(
                domain=f"gito-tenant-{tenant_id}",
                workflow_id=f"bulk-ota-{operation_id}",
                workflow_type="BULK_OTA_UPDATE",
                input=json.dumps(workflow_input),
                execution_start_to_close_timeout_seconds=3600,  # 1 hour
                task_start_to_close_timeout_seconds=60,
            )

            logger.info(
                "bulk_ota_workflow_started",
                extra={
                    "tenant_id": str(tenant_id),
                    "group_id": str(group_id),
                    "operation_id": str(operation_id),
                    "device_count": len(device_ids),
                    "execution_id": execution.workflow_execution_id,
                },
            )

            return execution.workflow_execution_id

        except Exception as e:
            logger.error(
                "bulk_ota_workflow_submission_failed",
                extra={
                    "tenant_id": str(tenant_id),
                    "operation_id": str(operation_id),
                    "error": str(e),
                },
            )
            return None

    async def start_bulk_command_workflow(
        self,
        tenant_id: UUID,
        group_id: UUID,
        operation_id: UUID,
        command: str,
        payload: dict,
        device_ids: list,
    ) -> Optional[str]:
        """Start BULK_COMMAND_SEND workflow.

        Args:
            tenant_id: Tenant UUID
            group_id: Device group UUID
            operation_id: Bulk operation UUID
            command: Command to send
            payload: Command payload
            device_ids: List of device UUIDs

        Returns:
            Workflow execution ID, or None if failed
        """
        if not self.client:
            logger.error("cadence_not_connected")
            return None

        try:
            workflow_input = {
                "tenant_id": str(tenant_id),
                "group_id": str(group_id),
                "operation_id": str(operation_id),
                "command": command,
                "payload": payload,
                "device_ids": [str(d) for d in device_ids],
            }

            execution = await self.client.start_workflow(
                domain=f"gito-tenant-{tenant_id}",
                workflow_id=f"bulk-cmd-{operation_id}",
                workflow_type="BULK_COMMAND_SEND",
                input=json.dumps(workflow_input),
                execution_start_to_close_timeout_seconds=1800,  # 30 min
                task_start_to_close_timeout_seconds=60,
            )

            logger.info(
                "bulk_command_workflow_started",
                extra={
                    "tenant_id": str(tenant_id),
                    "group_id": str(group_id),
                    "operation_id": str(operation_id),
                    "command": command,
                    "device_count": len(device_ids),
                    "execution_id": execution.workflow_execution_id,
                },
            )

            return execution.workflow_execution_id

        except Exception as e:
            logger.error(
                "bulk_command_workflow_submission_failed",
                extra={
                    "tenant_id": str(tenant_id),
                    "operation_id": str(operation_id),
                    "error": str(e),
                },
            )
            return None


# Global instance
_ota_workflow_client: Optional[OTAWorkflowClient] = None


def get_ota_workflow_client() -> OTAWorkflowClient:
    """Get or create OTA workflow client.

    Returns:
        Singleton instance of OTAWorkflowClient
    """
    global _ota_workflow_client

    if _ota_workflow_client is None:
        _ota_workflow_client = OTAWorkflowClient()

    return _ota_workflow_client
