"""Solution template request and response schemas."""

from pydantic import BaseModel, Field
from typing import Optional, List, Dict, Any
from datetime import datetime
from uuid import UUID


class SolutionTemplateListResponse(BaseModel):
    """Lightweight solution template response for list views."""
    id: UUID
    name: str
    slug: str
    description: Optional[str]
    industry: str
    icon: Optional[str]
    is_active: bool
    created_at: datetime
    updated_at: datetime


class SolutionTemplateResponse(BaseModel):
    """Full solution template response including device types, dashboard config, and alert rules."""
    id: UUID
    name: str
    slug: str
    description: Optional[str]
    industry: str
    icon: Optional[str]
    device_types: List[Dict[str, Any]]
    dashboard_config: Dict[str, Any]
    alert_rules: List[Dict[str, Any]]
    is_active: bool
    created_at: datetime
    updated_at: datetime


class ApplyTemplateRequest(BaseModel):
    """Request body for applying a solution template."""
    dashboard_name: Optional[str] = Field(
        None,
        max_length=200,
        description="Override the default dashboard name from the template",
    )
