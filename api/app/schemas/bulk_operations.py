"""Pydantic schemas for bulk operation requests and responses."""

from pydantic import BaseModel, Field
from typing import Optional, Dict, Any
from datetime import datetime
from uuid import UUID


class BulkOTARequest(BaseModel):
    """Request to start bulk OTA update on device group."""
    firmware_version_id: UUID = Field(..., description="Firmware version ID to deploy")
    
    class Config:
        json_schema_extra = {
            "example": {
                "firmware_version_id": "550e8400-e29b-41d4-a716-446655440000"
            }
        }


class BulkCommandRequest(BaseModel):
    """Request to send bulk command to device group."""
    command: str = Field(..., min_length=1, max_length=512, description="Command to send to devices")
    payload: Optional[Dict[str, Any]] = Field(None, description="Command payload/parameters")
    
    class Config:
        json_schema_extra = {
            "example": {
                "command": "reboot",
                "payload": {"delay_seconds": 30}
            }
        }


class BulkOperationResponse(BaseModel):
    """Response for bulk operation details."""
    id: UUID = Field(..., description="Operation ID")
    operation_type: str = Field(..., description="Operation type (bulk_ota, bulk_command, bulk_sync)")
    status: str = Field(..., description="Operation status (queued, running, completed, failed)")
    cadence_workflow_id: Optional[str] = Field(None, description="Cadence workflow ID")
    devices_total: int = Field(..., description="Total devices in group")
    devices_completed: int = Field(..., description="Devices completed")
    devices_failed: int = Field(..., description="Devices failed")
    progress_percent: int = Field(..., description="Progress percentage")
    error_message: Optional[str] = Field(None, description="Error message if operation failed")
    metadata: Dict[str, Any] = Field(default_factory=dict, description="Operation metadata")
    started_at: Optional[datetime] = Field(None, description="When operation started")
    completed_at: Optional[datetime] = Field(None, description="When operation completed")
    created_at: datetime = Field(..., description="Creation timestamp")
    updated_at: datetime = Field(..., description="Last update timestamp")

    class Config:
        from_attributes = True
        json_schema_extra = {
            "example": {
                "id": "550e8400-e29b-41d4-a716-446655440000",
                "operation_type": "bulk_ota",
                "status": "running",
                "cadence_workflow_id": "iot-platform-bulk-ota-xxxxx",
                "devices_total": 100,
                "devices_completed": 45,
                "devices_failed": 2,
                "progress_percent": 45,
                "error_message": None,
                "metadata": {
                    "firmware_version_id": "550e8400-e29b-41d4-a716-446655440001",
                    "firmware_version": "2.1.0"
                },
                "started_at": "2026-01-14T09:00:00Z",
                "completed_at": None,
                "created_at": "2026-01-14T08:55:00Z",
                "updated_at": "2026-01-14T09:02:00Z"
            }
        }


class BulkOperationListResponse(BaseModel):
    """Response for listing bulk operations."""
    data: list[BulkOperationResponse] = Field(..., description="List of operations")
    meta: Dict[str, Any] = Field(..., description="Pagination metadata")

    class Config:
        json_schema_extra = {
            "example": {
                "data": [
                    {
                        "id": "550e8400-e29b-41d4-a716-446655440000",
                        "operation_type": "bulk_ota",
                        "status": "completed",
                        "devices_total": 100,
                        "devices_completed": 100,
                        "devices_failed": 0,
                        "progress_percent": 100
                    }
                ],
                "meta": {
                    "skip": 0,
                    "limit": 50,
                    "total": 1
                }
            }
        }


class BulkOperationStartResponse(BaseModel):
    """Response when bulk operation is started."""
    operation_id: UUID = Field(..., description="Operation ID")
    workflow_id: Optional[str] = Field(None, description="Cadence workflow ID")
    status: str = Field(..., description="Initial status")
    devices_total: int = Field(..., description="Total devices")
    message: str = Field(..., description="Status message")

    class Config:
        json_schema_extra = {
            "example": {
                "operation_id": "550e8400-e29b-41d4-a716-446655440000",
                "workflow_id": "iot-platform-bulk-ota-xxxxx",
                "status": "queued",
                "devices_total": 100,
                "message": "Bulk OTA operation started for 100 devices"
            }
        }
