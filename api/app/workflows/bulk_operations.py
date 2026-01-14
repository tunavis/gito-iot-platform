"""Bulk operations workflows for Cadence.

This module defines workflows for parallel execution of operations across device groups:
- BULK_OTA_UPDATE: Apply firmware update to all devices in group
- BULK_COMMAND_SEND: Send command to all devices in group in parallel

Design:
- Workflows iterate devices from group
- For each device, spawn individual child workflow (OTA_UPDATE_DEVICE or command send)
- Aggregate results and track overall progress
- Report back to API via operation status updates
"""

import logging
from typing import List, Optional, Dict, Any
from datetime import timedelta

from cadenceclient.decorators import workflow, activity

logger = logging.getLogger(__name__)


@workflow
class BULK_OTA_UPDATE:
    """Bulk firmware update workflow for device group.
    
    Input:
    {
        "tenant_id": "uuid",
        "group_id": "uuid",
        "firmware_version_id": "uuid",
        "device_ids": ["device1-uuid", "device2-uuid", ...]
    }
    
    Output:
    {
        "status": "completed",
        "operation_id": "uuid",
        "devices_total": 100,
        "devices_completed": 98,
        "devices_failed": 2,
        "errors": [...]
    }
    """

    def __init__(self):
        """Initialize bulk OTA workflow."""
        self.status = "PREPARING"
        self.completed = 0
        self.failed = 0
        self.errors = []

    async def execute(self, workflow_input: dict) -> dict:
        """Execute bulk OTA update workflow.
        
        Args:
            workflow_input: Workflow input with group and device details
            
        Returns:
            Workflow output with completion status
        """
        try:
            tenant_id = workflow_input.get("tenant_id")
            group_id = workflow_input.get("group_id")
            firmware_version_id = workflow_input.get("firmware_version_id")
            device_ids = workflow_input.get("device_ids", [])

            operation_id = workflow_input.get("operation_id")
            
            logger.info(
                "bulk_ota_workflow_started",
                extra={
                    "tenant_id": tenant_id,
                    "group_id": group_id,
                    "firmware_version_id": firmware_version_id,
                    "device_count": len(device_ids),
                    "operation_id": operation_id,
                },
            )

            if not device_ids:
                return {
                    "status": "failed",
                    "operation_id": operation_id,
                    "error": "No devices in group",
                }

            # Update operation status: RUNNING
            await update_operation_progress.execute_async(
                tenant_id=tenant_id,
                operation_id=operation_id,
                status="running",
                progress_percent=0,
                devices_completed=0,
                devices_failed=0,
                timeout=timedelta(seconds=30),
            )

            # Execute OTA update for each device
            # In production, Cadence would spawn child workflows in parallel
            results = []
            for i, device_id in enumerate(device_ids):
                try:
                    # In real implementation, this would spawn OTA_UPDATE_DEVICE workflows
                    result = await execute_device_ota.execute_async(
                        tenant_id=tenant_id,
                        device_id=device_id,
                        firmware_version_id=firmware_version_id,
                        timeout=timedelta(seconds=600),  # 10 min per device
                    )
                    results.append(result)
                    
                    if result.get("status") == "completed":
                        self.completed += 1
                    else:
                        self.failed += 1
                        self.errors.append({
                            "device_id": device_id,
                            "error": result.get("error", "Unknown error")
                        })
                        
                except Exception as e:
                    self.failed += 1
                    self.errors.append({
                        "device_id": device_id,
                        "error": str(e)
                    })
                    logger.error(
                        "bulk_ota_device_failed",
                        extra={
                            "tenant_id": tenant_id,
                            "device_id": device_id,
                            "error": str(e),
                        },
                    )
                
                # Update progress every 10 devices or at the end
                if (i + 1) % 10 == 0 or (i + 1) == len(device_ids):
                    progress = int((i + 1) / len(device_ids) * 100)
                    try:
                        await update_operation_progress.execute_async(
                            tenant_id=tenant_id,
                            operation_id=operation_id,
                            status="running",
                            progress_percent=progress,
                            devices_completed=self.completed,
                            devices_failed=self.failed,
                            timeout=timedelta(seconds=30),
                        )
                    except Exception as e:
                        logger.error(
                            "bulk_ota_progress_update_failed",
                            extra={"operation_id": operation_id, "error": str(e)},
                        )

            # Final status update
            self.status = "COMPLETED"
            final_result = {
                "status": "completed",
                "operation_id": operation_id,
                "devices_total": len(device_ids),
                "devices_completed": self.completed,
                "devices_failed": self.failed,
            }
            
            if self.errors:
                final_result["errors"] = self.errors[:10]  # Limit to 10 errors
            
            # Update operation status: COMPLETED
            try:
                await update_operation_progress.execute_async(
                    tenant_id=tenant_id,
                    operation_id=operation_id,
                    status="completed",
                    progress_percent=100,
                    devices_completed=self.completed,
                    devices_failed=self.failed,
                    timeout=timedelta(seconds=30),
                )
            except Exception as e:
                logger.error(
                    "bulk_ota_final_status_update_failed",
                    extra={"operation_id": operation_id, "error": str(e)},
                )

            logger.info(
                "bulk_ota_workflow_completed",
                extra={
                    "tenant_id": tenant_id,
                    "group_id": group_id,
                    "completed": self.completed,
                    "failed": self.failed,
                    "operation_id": operation_id,
                },
            )

            return final_result

        except Exception as e:
            logger.error(
                "bulk_ota_workflow_exception",
                extra={
                    "tenant_id": workflow_input.get("tenant_id"),
                    "group_id": workflow_input.get("group_id"),
                    "error": str(e),
                },
            )
            return {
                "status": "failed",
                "operation_id": workflow_input.get("operation_id"),
                "error": str(e),
            }


@workflow
class BULK_COMMAND_SEND:
    """Bulk command send workflow for device group.
    
    Input:
    {
        "tenant_id": "uuid",
        "group_id": "uuid",
        "command": "reboot",
        "payload": {"delay_seconds": 30},
        "device_ids": ["device1-uuid", "device2-uuid", ...]
    }
    
    Output:
    {
        "status": "completed",
        "operation_id": "uuid",
        "devices_total": 100,
        "devices_completed": 98,
        "devices_failed": 2
    }
    """

    def __init__(self):
        """Initialize bulk command workflow."""
        self.status = "PREPARING"
        self.completed = 0
        self.failed = 0

    async def execute(self, workflow_input: dict) -> dict:
        """Execute bulk command send workflow.
        
        Args:
            workflow_input: Workflow input with group and device details
            
        Returns:
            Workflow output with completion status
        """
        try:
            tenant_id = workflow_input.get("tenant_id")
            group_id = workflow_input.get("group_id")
            command = workflow_input.get("command")
            payload = workflow_input.get("payload", {})
            device_ids = workflow_input.get("device_ids", [])
            operation_id = workflow_input.get("operation_id")
            
            logger.info(
                "bulk_command_workflow_started",
                extra={
                    "tenant_id": tenant_id,
                    "group_id": group_id,
                    "command": command,
                    "device_count": len(device_ids),
                    "operation_id": operation_id,
                },
            )

            if not device_ids:
                return {
                    "status": "failed",
                    "operation_id": operation_id,
                    "error": "No devices in group",
                }

            # Update operation status: RUNNING
            await update_operation_progress.execute_async(
                tenant_id=tenant_id,
                operation_id=operation_id,
                status="running",
                progress_percent=0,
                devices_completed=0,
                devices_failed=0,
                timeout=timedelta(seconds=30),
            )

            # Send command to each device
            for i, device_id in enumerate(device_ids):
                try:
                    result = await send_device_command.execute_async(
                        tenant_id=tenant_id,
                        device_id=device_id,
                        command=command,
                        payload=payload,
                        timeout=timedelta(seconds=60),
                    )
                    
                    if result.get("sent", False):
                        self.completed += 1
                    else:
                        self.failed += 1
                        
                except Exception as e:
                    self.failed += 1
                    logger.error(
                        "bulk_command_device_failed",
                        extra={
                            "tenant_id": tenant_id,
                            "device_id": device_id,
                            "command": command,
                            "error": str(e),
                        },
                    )
                
                # Update progress every 10 devices or at the end
                if (i + 1) % 10 == 0 or (i + 1) == len(device_ids):
                    progress = int((i + 1) / len(device_ids) * 100)
                    try:
                        await update_operation_progress.execute_async(
                            tenant_id=tenant_id,
                            operation_id=operation_id,
                            status="running",
                            progress_percent=progress,
                            devices_completed=self.completed,
                            devices_failed=self.failed,
                            timeout=timedelta(seconds=30),
                        )
                    except Exception as e:
                        logger.error(
                            "bulk_command_progress_update_failed",
                            extra={"operation_id": operation_id, "error": str(e)},
                        )

            # Final status update
            self.status = "COMPLETED"
            
            # Update operation status: COMPLETED
            try:
                await update_operation_progress.execute_async(
                    tenant_id=tenant_id,
                    operation_id=operation_id,
                    status="completed",
                    progress_percent=100,
                    devices_completed=self.completed,
                    devices_failed=self.failed,
                    timeout=timedelta(seconds=30),
                )
            except Exception as e:
                logger.error(
                    "bulk_command_final_status_update_failed",
                    extra={"operation_id": operation_id, "error": str(e)},
                )

            logger.info(
                "bulk_command_workflow_completed",
                extra={
                    "tenant_id": tenant_id,
                    "group_id": group_id,
                    "command": command,
                    "completed": self.completed,
                    "failed": self.failed,
                    "operation_id": operation_id,
                },
            )

            return {
                "status": "completed",
                "operation_id": operation_id,
                "devices_total": len(device_ids),
                "devices_completed": self.completed,
                "devices_failed": self.failed,
            }

        except Exception as e:
            logger.error(
                "bulk_command_workflow_exception",
                extra={
                    "tenant_id": workflow_input.get("tenant_id"),
                    "group_id": workflow_input.get("group_id"),
                    "error": str(e),
                },
            )
            return {
                "status": "failed",
                "operation_id": workflow_input.get("operation_id"),
                "error": str(e),
            }


# Activity definitions - placeholders for real activities
# In production, these would call the actual OTA/command implementation

async def execute_device_ota(
    tenant_id: str,
    device_id: str,
    firmware_version_id: str,
) -> dict:
    """Activity: Execute OTA update on a single device."""
    # In production: Call OTA_UPDATE_DEVICE workflow or equivalent
    return {"status": "completed", "device_id": device_id}


async def send_device_command(
    tenant_id: str,
    device_id: str,
    command: str,
    payload: dict,
) -> dict:
    """Activity: Send command to a single device via MQTT."""
    # In production: Publish MQTT command to device
    return {"sent": True, "device_id": device_id}


async def update_operation_progress(
    tenant_id: str,
    operation_id: str,
    status: str,
    progress_percent: int,
    devices_completed: int,
    devices_failed: int,
) -> dict:
    """Activity: Update bulk operation progress in database."""
    # In production: Call BulkOperationsService.update_operation_status()
    return {
        "updated": True,
        "operation_id": operation_id,
        "status": status,
    }
