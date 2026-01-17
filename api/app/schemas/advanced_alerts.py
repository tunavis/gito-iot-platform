"""Pydantic schemas for advanced multi-condition alert rules."""

from enum import Enum
from typing import List, Optional
from uuid import UUID
from datetime import datetime
from pydantic import BaseModel, Field, validator


class ConditionOperatorEnum(str, Enum):
    """Operators for rule conditions."""
    GREATER_THAN = ">"
    LESS_THAN = "<"
    GREATER_EQUAL = ">="
    LESS_EQUAL = "<="
    EQUAL = "=="
    NOT_EQUAL = "!="


class RuleLogicEnum(str, Enum):
    """Logical operators for combining conditions."""
    AND = "AND"
    OR = "OR"


class RuleTypeEnum(str, Enum):
    """Types of alert rules."""
    SIMPLE = "SIMPLE"
    COMPOSITE = "COMPOSITE"


class AlertRuleConditionSchema(BaseModel):
    """Single condition in a composite rule."""
    field: str = Field(..., description="Metric field name (e.g., 'temperature', 'humidity')")
    operator: ConditionOperatorEnum = Field(..., description="Comparison operator")
    threshold: float = Field(..., description="Threshold value to compare against")
    weight: int = Field(default=1, ge=1, le=100, description="Weight for weighted scoring (1-100)")
    sequence: int = Field(default=0, description="Execution sequence for complex rules")

    class Config:
        schema_extra = {
            "example": {
                "field": "temperature",
                "operator": ">",
                "threshold": 30.0,
                "weight": 2,
                "sequence": 0
            }
        }


class CreateCompositeAlertRuleSchema(BaseModel):
    """Create a new composite alert rule."""
    name: str = Field(..., min_length=1, max_length=255)
    description: Optional[str] = Field(default=None, max_length=500)
    device_id: Optional[UUID] = Field(
        default=None,
        description="Optional - if set, rule applies to specific device only"
    )
    conditions: List[AlertRuleConditionSchema] = Field(
        ...,
        min_items=2,
        description="List of conditions (minimum 2 for composite rule)"
    )
    condition_logic: RuleLogicEnum = Field(
        default=RuleLogicEnum.AND,
        description="How to combine conditions: AND (all must match) or OR (any can match)"
    )
    cooldown_minutes: int = Field(
        default=5,
        ge=1,
        le=1440,
        description="Prevent alert spam - don't fire again within N minutes"
    )
    active: bool = Field(default=True, description="Whether rule is active")

    class Config:
        schema_extra = {
            "example": {
                "name": "Temperature and Humidity Alert",
                "description": "Alert when temp > 30°C AND humidity > 80%",
                "device_id": None,
                "conditions": [
                    {
                        "field": "temperature",
                        "operator": ">",
                        "threshold": 30.0,
                        "weight": 1,
                        "sequence": 0
                    },
                    {
                        "field": "humidity",
                        "operator": ">",
                        "threshold": 80.0,
                        "weight": 1,
                        "sequence": 1
                    }
                ],
                "condition_logic": "AND",
                "cooldown_minutes": 5,
                "active": True
            }
        }


class UpdateCompositeAlertRuleSchema(BaseModel):
    """Update an existing composite alert rule."""
    name: Optional[str] = Field(default=None, min_length=1, max_length=255)
    description: Optional[str] = Field(default=None, max_length=500)
    conditions: Optional[List[AlertRuleConditionSchema]] = Field(
        default=None,
        min_items=2,
        description="List of conditions"
    )
    condition_logic: Optional[RuleLogicEnum] = Field(default=None)
    cooldown_minutes: Optional[int] = Field(default=None, ge=1, le=1440)
    active: Optional[bool] = Field(default=None)

    class Config:
        schema_extra = {
            "example": {
                "cooldown_minutes": 10,
                "active": True
            }
        }


class AlertRuleConditionResponseSchema(BaseModel):
    """Response schema for alert rule condition."""
    id: UUID
    rule_id: UUID
    field: str
    operator: str
    threshold: float
    weight: int
    sequence: int
    created_at: datetime

    class Config:
        from_attributes = True


class CompositeAlertRuleResponseSchema(BaseModel):
    """Response schema for composite alert rule."""
    id: UUID
    tenant_id: UUID
    device_id: Optional[UUID]
    name: str
    description: Optional[str]
    rule_type: str = "COMPOSITE"
    condition_logic: RuleLogicEnum
    cooldown_minutes: int
    active: bool
    last_fired_at: Optional[datetime]
    conditions: List[AlertRuleConditionResponseSchema]
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


class RulePreviewRequestSchema(BaseModel):
    """Request to preview rule against historical telemetry."""
    hours: int = Field(default=24, ge=1, le=720, description="Hours of history to analyze")

    class Config:
        schema_extra = {"example": {"hours": 24}}


class RulePreviewResponseSchema(BaseModel):
    """Response from rule preview."""
    rule_id: UUID
    preview_hours: int
    predicted_triggers: int
    preview_status: str
    notes: str

    class Config:
        schema_extra = {
            "example": {
                "rule_id": "550e8400-e29b-41d4-a716-446655440000",
                "preview_hours": 24,
                "predicted_triggers": 3,
                "preview_status": "success",
                "notes": "This rule would trigger ~3 times in the last 24 hours"
            }
        }


class RuleEvaluationResultSchema(BaseModel):
    """Result from evaluating a rule against telemetry."""
    rule_id: UUID
    triggered: bool
    timestamp: datetime
    value: Optional[float] = None
    reason: Optional[str] = None
    score: Optional[int] = None
    details: Optional[dict] = None


class BulkRuleEvaluationSchema(BaseModel):
    """Evaluate multiple rules at once."""
    device_id: UUID
    telemetry_data: dict = Field(..., description="Metric values: {'temperature': 28.5, 'humidity': 65}")
    rule_ids: Optional[List[UUID]] = Field(
        default=None,
        description="Optional - evaluate specific rules. If not provided, evaluate all active rules"
    )

    class Config:
        schema_extra = {
            "example": {
                "device_id": "550e8400-e29b-41d4-a716-446655440000",
                "telemetry_data": {
                    "temperature": 32.5,
                    "humidity": 85.0,
                    "battery": 45.0
                },
                "rule_ids": None
            }
        }


class ConditionWeightedScoringSchema(BaseModel):
    """Configuration for weighted scoring evaluation."""
    conditions: List[AlertRuleConditionSchema]
    score_threshold: int = Field(
        default=50,
        ge=0,
        le=100,
        description="Percentage threshold to trigger alert"
    )

    class Config:
        schema_extra = {
            "example": {
                "conditions": [
                    {
                        "field": "temperature",
                        "operator": ">",
                        "threshold": 30.0,
                        "weight": 3,
                        "sequence": 0
                    },
                    {
                        "field": "humidity",
                        "operator": ">",
                        "threshold": 80.0,
                        "weight": 2,
                        "sequence": 1
                    }
                ],
                "score_threshold": 60
            }
        }
