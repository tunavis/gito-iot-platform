"""Notification rule schemas for request/response validation."""

from pydantic import BaseModel, Field
from typing import Optional
from uuid import UUID
from datetime import datetime


class NotificationRuleCreate(BaseModel):
    """Schema for creating a notification rule."""
    alert_rule_id: UUID = Field(..., description="Alert rule to link")
    channel_id: UUID = Field(..., description="Notification channel to send to")
    enabled: bool = Field(default=True, description="Whether rule is active")


class NotificationRuleUpdate(BaseModel):
    """Schema for updating a notification rule."""
    enabled: Optional[bool] = Field(None, description="Whether rule is active")


class NotificationRuleResponse(BaseModel):
    """Schema for notification rule response."""
    id: UUID
    tenant_id: UUID
    alert_rule_id: UUID
    channel_id: UUID
    enabled: bool
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True
