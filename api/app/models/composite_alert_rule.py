"""Composite alert rule model - multi-condition alerts with AND/OR logic."""

from datetime import datetime
from typing import Optional, List, Dict, Any
from uuid import UUID

from sqlalchemy import Column, String, Boolean, Integer, TIMESTAMP, text, CheckConstraint
from sqlalchemy.dialects.postgresql import UUID as PGUUID, JSONB
from sqlalchemy.orm import relationship

from app.models.base import BaseModel


class CompositeAlertRule(BaseModel):
    """Multi-condition alert rules with AND/OR logic.
    
    Allows complex alert scenarios like:
    - Temperature > 30 AND Humidity > 80
    - Battery < 20 OR Signal < -100
    - Weighted scoring across multiple conditions
    """
    
    __tablename__ = "composite_alert_rules"
    
    id = Column(PGUUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()"))
    tenant_id = Column(PGUUID(as_uuid=True), nullable=False, index=True)
    name = Column(String(255), nullable=False)
    description = Column(String, nullable=True)
    enabled = Column(Boolean, default=True, nullable=False, index=True)
    conditions = Column(JSONB, nullable=False, server_default=text("'[]'::jsonb"))
    logic = Column(String(10), nullable=False, server_default=text("'AND'"))
    severity = Column(String(20), nullable=False, server_default=text("'warning'"), index=True)
    weight_score = Column(Integer, nullable=True)
    cooldown_minutes = Column(Integer, default=5)
    last_triggered_at = Column(TIMESTAMP(timezone=True), nullable=True)
    created_at = Column(TIMESTAMP(timezone=True), nullable=False, server_default=text("now()"))
    updated_at = Column(TIMESTAMP(timezone=True), nullable=False, server_default=text("now()"))
    
    __table_args__ = (
        CheckConstraint(logic.in_(['AND', 'OR']), name='valid_logic'),
        CheckConstraint(severity.in_(['info', 'warning', 'critical']), name='valid_severity'),
    )
    
    def __repr__(self):
        return f"<CompositeAlertRule {self.name} ({self.logic} logic, {len(self.conditions or [])} conditions)>"
