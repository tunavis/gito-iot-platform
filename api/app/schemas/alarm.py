"""
Alarm Schemas - Enterprise-grade alarm lifecycle management
Following Cumulocity patterns
"""
from datetime import datetime
from typing import Optional, Dict, Any
from uuid import UUID
from pydantic import BaseModel, Field, ConfigDict


class AlarmBase(BaseModel):
    """Base alarm schema"""
    alarm_type: str = Field(..., description="Type of alarm (e.g., 'HighTemperature', 'DeviceOffline')")
    source: Optional[str] = Field(None, description="Source of the alarm")
    severity: str = Field(..., description="CRITICAL, MAJOR, MINOR, or WARNING")
    message: str = Field(..., description="Human-readable alarm message")
    context: Optional[Dict[str, Any]] = Field(None, description="Additional alarm context as JSON")


class AlarmCreate(AlarmBase):
    """Create a new alarm"""
    alert_rule_id: Optional[UUID] = None
    device_id: Optional[UUID] = None
    

class AlarmUpdate(BaseModel):
    """Update alarm fields (limited - use lifecycle endpoints for state changes)"""
    message: Optional[str] = None
    context: Optional[Dict[str, Any]] = None


class AlarmAcknowledge(BaseModel):
    """Acknowledge an alarm"""
    comment: Optional[str] = Field(None, description="Optional comment about acknowledgment")


class AlarmClear(BaseModel):
    """Clear an alarm"""
    comment: Optional[str] = Field(None, description="Optional comment about resolution")
    

class Alarm(AlarmBase):
    """Full alarm with lifecycle data"""
    model_config = ConfigDict(from_attributes=True)
    
    id: UUID
    tenant_id: UUID
    alert_rule_id: Optional[UUID] = None
    device_id: Optional[UUID] = None
    status: str  # ACTIVE, ACKNOWLEDGED, CLEARED
    
    fired_at: datetime
    acknowledged_at: Optional[datetime] = None
    acknowledged_by: Optional[UUID] = None
    cleared_at: Optional[datetime] = None
    
    created_at: datetime
    updated_at: datetime


class AlarmSummary(BaseModel):
    """Alarm summary statistics"""
    total: int
    active: int
    acknowledged: int
    cleared: int
    by_severity: Dict[str, int]


class AlarmListResponse(BaseModel):
    """Paginated alarm list"""
    alarms: list[Alarm]
    total: int
    page: int
    page_size: int
