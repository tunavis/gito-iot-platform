"""Dashboard system models for drag-and-drop dashboard builder."""

from sqlalchemy import (
    Column, String, DateTime, ForeignKey, CheckConstraint,
    Text, Integer, Boolean, Index
)
from sqlalchemy.dialects.postgresql import UUID, JSONB
from datetime import datetime
import uuid
from .base import BaseModel


class Dashboard(BaseModel):
    """User-created dashboards with customizable layouts and widgets."""
    __tablename__ = "dashboards"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False, index=True)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    name = Column(String(200), nullable=False)
    description = Column(Text)
    is_default = Column(Boolean, default=False, nullable=False)
    layout_config = Column(JSONB, default={}, nullable=False)
    theme = Column(JSONB, default={}, nullable=False)
    solution_type = Column(String(100))
    extra_data = Column(JSONB, default={}, nullable=False)
    created_at = Column(DateTime(timezone=True), default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime(timezone=True), default=datetime.utcnow, nullable=False)

    __table_args__ = (
        Index("idx_dashboards_tenant_user", "tenant_id", "user_id"),
        Index("idx_dashboards_solution_type", "solution_type"),
        Index("idx_dashboards_created_at", "created_at"),
    )


class DashboardWidget(BaseModel):
    """Individual widgets placed on dashboards with configuration and data bindings."""
    __tablename__ = "dashboard_widgets"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    dashboard_id = Column(UUID(as_uuid=True), ForeignKey("dashboards.id", ondelete="CASCADE"), nullable=False, index=True)
    widget_type = Column(String(50), nullable=False)
    title = Column(String(200))
    position_x = Column(Integer, nullable=False)
    position_y = Column(Integer, nullable=False)
    width = Column(Integer, default=2, nullable=False)
    height = Column(Integer, default=2, nullable=False)
    configuration = Column(JSONB, default={}, nullable=False)
    data_sources = Column(JSONB, default=[], nullable=False)
    refresh_interval = Column(Integer, default=30, nullable=False)
    created_at = Column(DateTime(timezone=True), default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime(timezone=True), default=datetime.utcnow, nullable=False)

    __table_args__ = (
        Index("idx_dashboard_widgets_dashboard", "dashboard_id"),
        Index("idx_dashboard_widgets_type", "widget_type"),
        CheckConstraint("width > 0 AND height > 0", name="check_positive_dimensions"),
        CheckConstraint("position_x >= 0 AND position_y >= 0", name="check_valid_position"),
    )
