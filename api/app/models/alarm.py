"""
Alarm Model - Enterprise-grade alarm lifecycle management
Following Cumulocity patterns: ACTIVE → ACKNOWLEDGED → CLEARED
"""
from datetime import datetime
from typing import Optional
from uuid import UUID
from sqlalchemy import Column, DateTime, ForeignKey, String, Text, Index, CheckConstraint
from sqlalchemy.dialects.postgresql import UUID as PG_UUID, JSONB
from .base import BaseModel


class Alarm(BaseModel):
    """
    Unified alarm instances with Cumulocity-style lifecycle management.
    
    State Transitions:
    - ACTIVE: New alarm, requires attention
    - ACKNOWLEDGED: Seen by operator, being investigated
    - CLEARED: Issue resolved, alarm inactive
    
    Severity Levels:
    - CRITICAL: System down, immediate action required
    - MAJOR: Significant impact, urgent attention needed
    - MINOR: Degraded performance, should be addressed
    - WARNING: Potential issue, informational
    """
    __tablename__ = "alarms"

    # Primary Key
    id = Column(PG_UUID(as_uuid=True), primary_key=True, server_default="gen_random_uuid()")

    # Foreign Keys
    tenant_id = Column(
        PG_UUID(as_uuid=True),
        ForeignKey("tenants.id", ondelete="CASCADE"),
        nullable=False,
        index=True
    )
    alert_rule_id = Column(
        PG_UUID(as_uuid=True),
        ForeignKey("alert_rules.id", ondelete="SET NULL"),
        nullable=True,  # NULL allows manual alarms or external alarms
        index=True
    )
    device_id = Column(
        PG_UUID(as_uuid=True),
        ForeignKey("devices.id", ondelete="CASCADE"),
        nullable=True,  # NULL for fleet-wide alarms
        index=True
    )
    acknowledged_by = Column(
        PG_UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
        index=True
    )

    # Alarm Properties
    alarm_type = Column(String(100), nullable=False, index=True)
    source = Column(String(255), nullable=True)
    severity = Column(
        String(20),
        nullable=False,
        default="MAJOR",
        index=True
    )
    status = Column(
        String(20),
        nullable=False,
        default="ACTIVE",
        index=True
    )
    
    # Message and Context
    message = Column(Text, nullable=False)
    context = Column(JSONB, nullable=True)
    
    # Lifecycle Timestamps
    fired_at = Column(DateTime(timezone=True), nullable=False, default=datetime.utcnow, index=True)
    acknowledged_at = Column(DateTime(timezone=True), nullable=True)
    cleared_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False, default=datetime.utcnow)
    updated_at = Column(DateTime(timezone=True), nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow)

    # Constraints
    __table_args__ = (
        CheckConstraint(
            "severity IN ('CRITICAL', 'MAJOR', 'MINOR', 'WARNING')",
            name="valid_severity"
        ),
        CheckConstraint(
            "status IN ('ACTIVE', 'ACKNOWLEDGED', 'CLEARED')",
            name="valid_alarm_status"
        ),
        # Filtered indexes for performance
        Index(
            "idx_alarms_active",
            "tenant_id", "status",
            postgresql_where=(Column("status") == "ACTIVE")
        ),
        Index(
            "idx_alarms_acknowledged",
            "acknowledged_by",
            postgresql_where=(Column("acknowledged_by").isnot(None))
        ),
    )

    def __repr__(self):
        return f"<Alarm {self.alarm_type} [{self.severity}] {self.status}>"
