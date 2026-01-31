"""Solution template schemas."""

from pydantic import BaseModel, Field, ConfigDict
from typing import Optional, List, Dict, Any
from datetime import datetime
from uuid import UUID


class SolutionTemplateResponse(BaseModel):
    """Solution template response model."""
    id: UUID
    name: str
    identifier: str
    category: str
    description: Optional[str]
    icon: str
    color: str
    target_device_types: List[str]
    required_capabilities: List[str]
    template_config: Dict[str, Any]
    preview_image_url: Optional[str]
    is_active: bool
    created_at: datetime
    updated_at: datetime

    # Computed field (not in database)
    compatible_device_count: Optional[int] = Field(None, description="Number of user's compatible devices")

    model_config = ConfigDict(from_attributes=True)


class ApplyTemplateRequest(BaseModel):
    """Request to apply a solution template."""
    dashboard_name: Optional[str] = Field(None, description="Custom dashboard name (defaults to template name)")
    device_bindings: Optional[Dict[str, UUID]] = Field(
        None,
        description="Map of widget index to device ID for auto-binding"
    )
    set_as_default: bool = Field(False, description="Set as default dashboard")


class ApplyTemplateResponse(BaseModel):
    """Response after applying template."""
    dashboard_id: UUID
    dashboard_name: str
    widgets_created: int
    auto_bound_devices: int
    message: str
