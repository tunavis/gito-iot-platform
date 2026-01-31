"""Dashboard-related request and response schemas."""

from pydantic import BaseModel, Field, ConfigDict
from typing import Optional, List, Dict, Any
from datetime import datetime
from uuid import UUID


class DashboardCreate(BaseModel):
    """Create dashboard request."""
    name: str = Field(min_length=1, max_length=200, description="Dashboard name")
    description: Optional[str] = Field(None, description="Dashboard description")
    is_default: bool = Field(False, description="Set as default dashboard")
    layout_config: Dict[str, Any] = Field(default_factory=dict, description="Grid layout configuration")
    theme: Dict[str, Any] = Field(default_factory=dict, description="Dashboard theme (colors, branding)")
    solution_type: Optional[str] = Field(None, max_length=100, description="Solution template identifier if created from template")
    extra_data: Dict[str, Any] = Field(default_factory=dict, description="Additional extra_data")


class DashboardUpdate(BaseModel):
    """Update dashboard request."""
    name: Optional[str] = Field(None, min_length=1, max_length=200)
    description: Optional[str] = None
    is_default: Optional[bool] = None
    layout_config: Optional[Dict[str, Any]] = None
    theme: Optional[Dict[str, Any]] = None
    extra_data: Optional[Dict[str, Any]] = None


class DashboardResponse(BaseModel):
    """Dashboard response model."""
    id: UUID
    tenant_id: UUID
    user_id: UUID
    name: str
    description: Optional[str]
    is_default: bool
    layout_config: Dict[str, Any]
    theme: Dict[str, Any]
    solution_type: Optional[str]
    extra_data: Dict[str, Any]
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


class DashboardListResponse(BaseModel):
    """Dashboard list item response."""
    id: UUID
    name: str
    description: Optional[str]
    is_default: bool
    solution_type: Optional[str]
    widget_count: Optional[int] = Field(None, description="Number of widgets on dashboard")
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


class DashboardWithWidgets(BaseModel):
    """Dashboard with its widgets."""
    id: UUID
    tenant_id: UUID
    user_id: UUID
    name: str
    description: Optional[str]
    is_default: bool
    layout_config: Dict[str, Any]
    theme: Dict[str, Any]
    solution_type: Optional[str]
    extra_data: Dict[str, Any]
    widgets: List["WidgetResponse"]
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


class WidgetCreate(BaseModel):
    """Create widget request."""
    widget_type: str = Field(min_length=1, max_length=50, description="Widget type (kpi_card, chart, gauge, etc.)")
    title: Optional[str] = Field(None, max_length=200, description="Widget title")
    position_x: int = Field(ge=0, description="Grid X position")
    position_y: int = Field(ge=0, description="Grid Y position")
    width: int = Field(2, gt=0, le=12, description="Widget width (grid columns)")
    height: int = Field(2, gt=0, description="Widget height (grid rows)")
    configuration: Dict[str, Any] = Field(default_factory=dict, description="Widget-specific configuration")
    data_sources: List[Dict[str, Any]] = Field(default_factory=list, description="Bound devices and metrics")
    refresh_interval: int = Field(30, gt=0, description="Refresh interval in seconds")


class WidgetUpdate(BaseModel):
    """Update widget request."""
    title: Optional[str] = Field(None, max_length=200)
    position_x: Optional[int] = Field(None, ge=0)
    position_y: Optional[int] = Field(None, ge=0)
    width: Optional[int] = Field(None, gt=0, le=12)
    height: Optional[int] = Field(None, gt=0)
    configuration: Optional[Dict[str, Any]] = None
    data_sources: Optional[List[Dict[str, Any]]] = None
    refresh_interval: Optional[int] = Field(None, gt=0)


class WidgetResponse(BaseModel):
    """Widget response model."""
    id: UUID
    dashboard_id: UUID
    widget_type: str
    title: Optional[str]
    position_x: int
    position_y: int
    width: int
    height: int
    configuration: Dict[str, Any]
    data_sources: List[Dict[str, Any]]
    refresh_interval: int
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


class DeviceBindingRequest(BaseModel):
    """Request to bind device to widget."""
    device_id: UUID = Field(description="Device ID to bind")
    metric: Optional[str] = Field(None, description="Specific metric to bind (optional)")
    alias: Optional[str] = Field(None, description="Display alias for the device/metric")


class LayoutUpdateRequest(BaseModel):
    """Update dashboard layout (batch widget position update)."""
    widgets: List[Dict[str, Any]] = Field(description="Array of widget updates with id, x, y, w, h")


# Forward reference resolution
DashboardWithWidgets.model_rebuild()
