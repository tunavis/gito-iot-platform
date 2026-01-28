"""Unified Alert Rule model - supports both threshold and composite rules."""

from datetime import datetime
from uuid import uuid4

from sqlalchemy import Column, String, Float, Integer, Boolean, Text, DateTime, ForeignKey, Index, CheckConstraint
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.sql import text

from app.models.base import BaseModel


class UnifiedAlertRule(BaseModel):
    """Unified alert rules - supports THRESHOLD and COMPOSITE types.
    
    THRESHOLD rules: Simple single-metric alerts (temp > 30)
    COMPOSITE rules: Multi-condition alerts with AND/OR logic
    
    Example THRESHOLD:
        rule_type='THRESHOLD', device_id=x, metric='temperature', 
        operator='gt', threshold=30.0
    
    Example COMPOSITE:
        rule_type='COMPOSITE', conditions=[
            {"field": "temperature", "operator": "gt", "threshold": 30, "weight": 1},
            {"field": "humidity", "operator": "gt", "threshold": 80, "weight": 1}
        ], logic='AND'
    """
    __tablename__ = "unified_alert_rules"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid4)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False, index=True)
    
    # Common fields
    name = Column(String(255), nullable=False)
    description = Column(Text, nullable=True)
    rule_type = Column(String(20), nullable=False, default="THRESHOLD", index=True)  # THRESHOLD, COMPOSITE
    severity = Column(String(20), nullable=False, default="warning", index=True)  # info, warning, critical
    enabled = Column(Boolean, default=True, nullable=False, index=True)
    cooldown_minutes = Column(Integer, default=5, nullable=False)
    last_triggered_at = Column(DateTime(timezone=True), nullable=True)
    
    # THRESHOLD-specific fields (nullable for COMPOSITE rules)
    device_id = Column(UUID(as_uuid=True), ForeignKey("devices.id", ondelete="CASCADE"), nullable=True, index=True)
    metric = Column(String(50), nullable=True)  # temperature, humidity, battery, rssi, pressure
    operator = Column(String(10), nullable=True)  # gt, gte, lt, lte, eq, neq
    threshold = Column(Float, nullable=True)
    
    # COMPOSITE-specific fields (nullable for THRESHOLD rules)
    conditions = Column(JSONB, nullable=True)  # [{field, operator, threshold, weight}, ...]
    logic = Column(String(10), nullable=True)  # AND, OR
    
    # Timestamps
    created_at = Column(DateTime(timezone=True), default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime(timezone=True), default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    __table_args__ = (
        Index("idx_unified_alert_rules_tenant", "tenant_id"),
        Index("idx_unified_alert_rules_device", "device_id"),
        Index("idx_unified_alert_rules_type", "rule_type"),
        Index("idx_unified_alert_rules_enabled", "enabled"),
        CheckConstraint("rule_type IN ('THRESHOLD', 'COMPOSITE')", name="valid_rule_type"),
        CheckConstraint("severity IN ('info', 'warning', 'critical')", name="valid_unified_severity"),
        # Note: device_id is OPTIONAL for THRESHOLD rules (null = global rule)
        CheckConstraint(
            "(rule_type = 'THRESHOLD' AND metric IS NOT NULL AND operator IS NOT NULL AND threshold IS NOT NULL) OR "
            "(rule_type = 'COMPOSITE' AND conditions IS NOT NULL)",
            name="valid_rule_fields"
        ),
    )

    def __repr__(self):
        if self.rule_type == "THRESHOLD":
            return f"<UnifiedAlertRule THRESHOLD {self.name}: {self.metric} {self.operator} {self.threshold}>"
        return f"<UnifiedAlertRule COMPOSITE {self.name}: {len(self.conditions or [])} conditions, {self.logic} logic>"

    def to_response_dict(self) -> dict:
        """Convert to response dictionary."""
        return {
            "id": str(self.id),
            "tenant_id": str(self.tenant_id),
            "name": self.name,
            "description": self.description,
            "rule_type": self.rule_type,
            "severity": self.severity,
            "enabled": self.enabled,
            "cooldown_minutes": self.cooldown_minutes,
            "last_triggered_at": self.last_triggered_at.isoformat() if self.last_triggered_at else None,
            "device_id": str(self.device_id) if self.device_id else None,
            "metric": self.metric,
            "operator": self.operator,
            "threshold": self.threshold,
            "conditions": self.conditions,
            "logic": self.logic,
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "updated_at": self.updated_at.isoformat() if self.updated_at else None,
        }
