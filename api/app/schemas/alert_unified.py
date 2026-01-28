"""Unified alert rule schemas - supports both threshold and composite rules."""

from pydantic import BaseModel, Field, field_validator
from datetime import datetime
from uuid import UUID
from typing import Optional, Literal, List, Any
from enum import Enum


class RuleType(str, Enum):
    """Types of alert rules supported."""
    THRESHOLD = "THRESHOLD"  # Simple threshold (temp > 30)
    COMPOSITE = "COMPOSITE"  # Multi-condition with AND/OR logic


class Severity(str, Enum):
    """Alert severity levels."""
    INFO = "info"
    WARNING = "warning"
    CRITICAL = "critical"


class ConditionLogic(str, Enum):
    """Logic for combining conditions in composite rules."""
    AND = "AND"
    OR = "OR"


class AlertCondition(BaseModel):
    """A single condition in an alert rule."""
    field: str = Field(..., description="Metric field: temperature, humidity, battery, rssi, pressure")
    operator: Literal["gt", "gte", "lt", "lte", "eq", "neq"] = Field(..., description="Comparison operator")
    threshold: float = Field(..., description="Threshold value")
    weight: int = Field(default=1, ge=1, le=100, description="Weight for scoring (1-100)")


class AlertRuleCreate(BaseModel):
    """Schema for creating an alert rule (unified)."""
    name: str = Field(..., min_length=1, max_length=255, description="Rule name")
    description: Optional[str] = Field(None, description="Rule description")
    rule_type: RuleType = Field(default=RuleType.THRESHOLD, description="Type of rule")
    severity: Severity = Field(default=Severity.WARNING, description="Alert severity")
    enabled: bool = Field(default=True, description="Whether rule is active")
    
    # For THRESHOLD rules - device-specific
    device_id: Optional[UUID] = Field(None, description="Device ID (required for THRESHOLD rules)")
    metric: Optional[Literal["temperature", "humidity", "battery", "rssi", "pressure"]] = Field(
        None, description="Metric to monitor (for THRESHOLD rules)"
    )
    operator: Optional[Literal["gt", "gte", "lt", "lte", "eq", "neq"]] = Field(
        None, description="Comparison operator (for THRESHOLD rules)"
    )
    threshold: Optional[float] = Field(None, description="Threshold value (for THRESHOLD rules)")
    
    # For COMPOSITE rules - multi-condition
    conditions: Optional[List[AlertCondition]] = Field(
        None, description="List of conditions (for COMPOSITE rules)"
    )
    logic: Optional[ConditionLogic] = Field(
        ConditionLogic.AND, description="Logic for combining conditions (AND/OR)"
    )
    
    # Common fields
    cooldown_minutes: int = Field(default=5, ge=1, le=1440, description="Cooldown between alerts (1-1440 minutes)")

    @field_validator('device_id', mode='before')
    @classmethod
    def validate_threshold_fields(cls, v, info):
        """Validate that THRESHOLD rules have required fields."""
        # Validation will be done in the router based on rule_type
        return v


class AlertRuleUpdate(BaseModel):
    """Schema for updating an alert rule."""
    name: Optional[str] = Field(None, min_length=1, max_length=255)
    description: Optional[str] = None
    severity: Optional[Severity] = None
    enabled: Optional[bool] = None
    
    # THRESHOLD fields
    metric: Optional[Literal["temperature", "humidity", "battery", "rssi", "pressure"]] = None
    operator: Optional[Literal["gt", "gte", "lt", "lte", "eq", "neq"]] = None
    threshold: Optional[float] = None
    
    # COMPOSITE fields
    conditions: Optional[List[AlertCondition]] = None
    logic: Optional[ConditionLogic] = None
    
    # Common
    cooldown_minutes: Optional[int] = Field(None, ge=1, le=1440)


class AlertRuleResponse(BaseModel):
    """Response schema for alert rule (unified)."""
    id: UUID
    tenant_id: UUID
    name: str
    description: Optional[str] = None
    rule_type: str
    severity: str
    enabled: bool
    
    # THRESHOLD fields
    device_id: Optional[UUID] = None
    metric: Optional[str] = None
    operator: Optional[str] = None
    threshold: Optional[float] = None
    
    # COMPOSITE fields
    conditions: Optional[List[dict]] = None
    logic: Optional[str] = None
    
    # Common
    cooldown_minutes: int
    last_triggered_at: Optional[datetime] = None
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True
