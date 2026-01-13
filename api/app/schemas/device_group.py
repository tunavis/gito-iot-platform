"""Pydantic schemas for device group operations."""

from pydantic import BaseModel, Field
from typing import Optional, List
from datetime import datetime
from uuid import UUID


class DeviceGroupCreate(BaseModel):
    """Request schema for creating a device group."""
    name: str = Field(..., min_length=1, max_length=255, description="Group name")
    description: Optional[str] = Field(None, max_length=1000, description="Group description")
    membership_rule: Optional[dict] = Field(default_factory=dict, description="Dynamic membership rules (tags, status filters, etc.)")

    class Config:
        json_schema_extra = {
            "example": {
                "name": "Lab Sensors",
                "description": "All temperature/humidity sensors in the lab",
                "membership_rule": {
                    "tags": ["location:lab", "type:sensor"],
                    "status": "online"
                }
            }
        }


class DeviceGroupUpdate(BaseModel):
    """Request schema for updating a device group."""
    name: Optional[str] = Field(None, min_length=1, max_length=255, description="Group name")
    description: Optional[str] = Field(None, max_length=1000, description="Group description")
    membership_rule: Optional[dict] = Field(None, description="Dynamic membership rules")

    class Config:
        json_schema_extra = {
            "example": {
                "name": "Updated Lab Sensors",
                "membership_rule": {"tags": ["location:lab", "type:sensor", "status:online"]}
            }
        }


class DeviceGroupMemberResponse(BaseModel):
    """Response schema for a member in a device group."""
    id: UUID = Field(..., description="Device ID")
    name: str = Field(..., description="Device name")
    status: str = Field(..., description="Device status")
    device_type: str = Field(..., description="Device type")
    last_seen: Optional[datetime] = Field(None, description="Last seen timestamp")

    class Config:
        from_attributes = True


class DeviceGroupResponse(BaseModel):
    """Response schema for a device group."""
    id: UUID = Field(..., description="Group ID")
    name: str = Field(..., description="Group name")
    description: Optional[str] = Field(None, description="Group description")
    membership_rule: dict = Field(..., description="Membership rules")
    member_count: int = Field(default=0, description="Number of devices in group")
    created_at: datetime = Field(..., description="Creation timestamp")
    updated_at: datetime = Field(..., description="Last update timestamp")

    class Config:
        from_attributes = True
        json_schema_extra = {
            "example": {
                "id": "550e8400-e29b-41d4-a716-446655440000",
                "name": "Lab Sensors",
                "description": "All temperature sensors in the lab",
                "membership_rule": {"tags": ["location:lab"]},
                "member_count": 12,
                "created_at": "2026-01-13T12:00:00Z",
                "updated_at": "2026-01-13T12:00:00Z"
            }
        }


class DeviceGroupDetailResponse(DeviceGroupResponse):
    """Response schema for device group with member details."""
    members: List[DeviceGroupMemberResponse] = Field(default_factory=list, description="List of devices in group")


class BulkDevicesRequest(BaseModel):
    """Request schema for bulk device operations (add/remove members)."""
    device_ids: List[UUID] = Field(..., min_items=1, description="List of device IDs")

    class Config:
        json_schema_extra = {
            "example": {
                "device_ids": [
                    "550e8400-e29b-41d4-a716-446655440000",
                    "550e8400-e29b-41d4-a716-446655440001"
                ]
            }
        }


class BulkDevicesResponse(BaseModel):
    """Response schema for bulk device operations."""
    added: int = Field(..., description="Number of devices added")
    failed: int = Field(..., description="Number of devices that failed")
    skipped: int = Field(..., description="Number of devices skipped (already in group)")
    errors: Optional[List[dict]] = Field(None, description="List of errors if any")

    class Config:
        json_schema_extra = {
            "example": {
                "added": 8,
                "failed": 2,
                "skipped": 0,
                "errors": [
                    {"device_id": "550e8400-e29b-41d4-a716-446655440002", "reason": "Device not found"}
                ]
            }
        }
