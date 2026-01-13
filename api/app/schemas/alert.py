"""Pydantic schemas for alert rules and events."""

from pydantic import BaseModel, Field
from datetime import datetime
from uuid import UUID
from typing import Optional, Literal


class AlertRuleCreate(BaseModel):
    """Schema for creating an alert rule."""
    device_id: UUID
    metric: Literal["temperature", "humidity", "battery", "rssi", "pressure"]
    operator: Literal["gt", "gte", "lt", "lte", "eq", "neq"]
    threshold: float
    cooldown_minutes: int = Field(default=5, ge=1, le=1440)  # 1 minute to 1 day


class AlertRuleUpdate(BaseModel):
    """Schema for updating an alert rule."""
    operator: Optional[Literal["gt", "gte", "lt", "lte", "eq", "neq"]] = None
    threshold: Optional[float] = None
    cooldown_minutes: Optional[int] = Field(None, ge=1, le=1440)
    active: Optional[bool] = None


class AlertRuleResponse(BaseModel):
    """Response schema for alert rule."""
    id: UUID
    device_id: UUID
    metric: str
    operator: str
    threshold: float
    cooldown_minutes: int
    active: bool
    last_fired_at: Optional[datetime] = None
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True

    @staticmethod
    def from_orm(alert_rule) -> "AlertRuleResponse":
        """Convert database model to schema."""
        return AlertRuleResponse(
            id=alert_rule.id,
            device_id=alert_rule.device_id,
            metric=alert_rule.metric,
            operator=alert_rule.operator,
            threshold=alert_rule.threshold,
            cooldown_minutes=alert_rule.cooldown_minutes,
            active=alert_rule.active == "1",
            last_fired_at=alert_rule.last_fired_at,
            created_at=alert_rule.created_at,
            updated_at=alert_rule.updated_at,
        )


class AlertEventResponse(BaseModel):
    """Response schema for alert event."""
    id: UUID
    alert_rule_id: UUID
    device_id: UUID
    metric_name: str
    metric_value: Optional[float] = None
    message: Optional[str] = None
    notification_sent: bool
    notification_sent_at: Optional[datetime] = None
    fired_at: datetime

    class Config:
        from_attributes = True

    @staticmethod
    def from_orm(alert_event) -> "AlertEventResponse":
        """Convert database model to schema."""
        return AlertEventResponse(
            id=alert_event.id,
            alert_rule_id=alert_event.alert_rule_id,
            device_id=alert_event.device_id,
            metric_name=alert_event.metric_name,
            metric_value=alert_event.metric_value,
            message=alert_event.message,
            notification_sent=alert_event.notification_sent == "1",
            notification_sent_at=alert_event.notification_sent_at,
            fired_at=alert_event.fired_at,
        )
