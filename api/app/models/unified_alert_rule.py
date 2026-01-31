"""Unified Alert Rule model - supports both threshold and composite rules."""

from datetime import datetime
from uuid import uuid4

from sqlalchemy import Column, String, Float, Integer, Boolean, Text, DateTime, ForeignKey, Index, CheckConstraint
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.sql import text
from sqlalchemy.orm import validates

from app.models.base import BaseModel


# Operator mapping between API format and DB format
OPERATOR_API_TO_DB = {
    "gt": ">",
    "gte": ">=",
    "lt": "<",
    "lte": "<=",
    "eq": "==",
    "neq": "!="
}

OPERATOR_DB_TO_API = {v: k for k, v in OPERATOR_API_TO_DB.items()}

# Severity mapping between API format and DB format
SEVERITY_API_TO_DB = {
    "info": "MINOR",
    "warning": "WARNING",
    "critical": "CRITICAL"
}

SEVERITY_DB_TO_API = {
    "MINOR": "info",
    "WARNING": "warning",
    "MAJOR": "warning",  # Map MAJOR to warning
    "CRITICAL": "critical"
}

# Rule type mapping between API format and DB format
RULE_TYPE_API_TO_DB = {
    "THRESHOLD": "SIMPLE",
    "COMPOSITE": "COMPLEX"
}

RULE_TYPE_DB_TO_API = {
    "SIMPLE": "THRESHOLD",
    "COMPLEX": "COMPOSITE"
}


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
    __tablename__ = "alert_rules"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid4)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False, index=True)

    # Common fields (mapped to existing DB columns)
    name = Column(String(255), nullable=True)  # Made nullable to match existing data
    description = Column(Text, nullable=True)
    rule_type = Column(String(20), nullable=False, default="THRESHOLD", index=True)  # THRESHOLD, COMPOSITE
    severity = Column(String(20), nullable=False, default="MAJOR", index=True)  # CRITICAL, MAJOR, MINOR, WARNING
    active = Column("active", Boolean, default=True, nullable=False, index=True)  # DB uses 'active' not 'enabled'
    cooldown_minutes = Column(Integer, default=5, nullable=False)
    last_fired_at = Column("last_fired_at", DateTime(timezone=True), nullable=True)  # DB uses 'last_fired_at' not 'last_triggered_at'
    
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
        {"extend_existing": True}  # Use existing table schema
    )

    @validates('operator')
    def validate_operator(self, key, value):
        """Convert API operator format (gt, gte) to DB format (>, >=)."""
        if value and value in OPERATOR_API_TO_DB:
            return OPERATOR_API_TO_DB[value]
        # If already in DB format or None, return as-is
        return value

    @validates('severity')
    def validate_severity(self, key, value):
        """Convert API severity format (info, warning, critical) to DB format (MINOR, WARNING, CRITICAL)."""
        if value and value in SEVERITY_API_TO_DB:
            return SEVERITY_API_TO_DB[value]
        # If already in DB format or None, return as-is
        return value

    @validates('rule_type')
    def validate_rule_type(self, key, value):
        """Convert API rule_type format (THRESHOLD, COMPOSITE) to DB format (SIMPLE, COMPLEX)."""
        if value and value in RULE_TYPE_API_TO_DB:
            return RULE_TYPE_API_TO_DB[value]
        # If already in DB format or None, return as-is
        return value

    # Property aliases for API compatibility
    @property
    def enabled(self) -> bool:
        """Alias for 'active' field (API uses 'enabled', DB uses 'active')."""
        return self.active

    @enabled.setter
    def enabled(self, value: bool):
        """Setter for enabled property."""
        self.active = value

    @property
    def last_triggered_at(self):
        """Alias for 'last_fired_at' field (API uses 'last_triggered_at', DB uses 'last_fired_at')."""
        return self.last_fired_at

    @last_triggered_at.setter
    def last_triggered_at(self, value):
        """Setter for last_triggered_at property."""
        self.last_fired_at = value

    def __repr__(self):
        if self.rule_type == "THRESHOLD":
            return f"<UnifiedAlertRule THRESHOLD {self.name}: {self.metric} {self.operator} {self.threshold}>"
        return f"<UnifiedAlertRule COMPOSITE {self.name}: {len(self.conditions or [])} conditions, {self.logic} logic>"

    def to_response_dict(self) -> dict:
        """Convert to response dictionary."""
        # Convert operator from DB format (>) back to API format (gt)
        operator_api = OPERATOR_DB_TO_API.get(self.operator, self.operator) if self.operator else None

        # Convert severity from DB format (WARNING, CRITICAL) back to API format (warning, critical)
        severity_api = SEVERITY_DB_TO_API.get(self.severity, self.severity.lower() if self.severity else None)

        # Convert rule_type from DB format (SIMPLE, COMPLEX) back to API format (THRESHOLD, COMPOSITE)
        rule_type_api = RULE_TYPE_DB_TO_API.get(self.rule_type, self.rule_type)

        return {
            "id": str(self.id),
            "tenant_id": str(self.tenant_id),
            "name": self.name or f"{self.metric} Alert" if self.metric else "Alert Rule",
            "description": self.description,
            "rule_type": rule_type_api,  # Convert DB format to API format
            "severity": severity_api,  # Convert DB format to API format
            "enabled": self.active,  # Map 'active' DB field to 'enabled' API field
            "cooldown_minutes": self.cooldown_minutes,
            "last_triggered_at": self.last_fired_at.isoformat() if self.last_fired_at else None,  # Map 'last_fired_at' to 'last_triggered_at'
            "device_id": str(self.device_id) if self.device_id else None,
            "metric": self.metric,
            "operator": operator_api,  # Convert DB format to API format
            "threshold": self.threshold,
            "conditions": self.conditions,
            "logic": self.logic,
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "updated_at": self.updated_at.isoformat() if self.updated_at else None,
        }
