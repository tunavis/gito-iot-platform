"""Pydantic request/response schemas for API validation."""

from app.schemas.common import SuccessResponse, ErrorResponse, PaginationMeta
from app.schemas.auth import LoginRequest, TokenResponse, RefreshRequest
from app.schemas.device import DeviceCreate, DeviceUpdate, DeviceResponse
from app.schemas.organization import OrganizationCreate, OrganizationUpdate, OrganizationResponse
from app.schemas.site import SiteCreate, SiteUpdate, SiteResponse
from app.schemas.device_group import DeviceGroupCreate, DeviceGroupUpdate, DeviceGroupResponse

__all__ = [
    "SuccessResponse",
    "ErrorResponse",
    "PaginationMeta",
    "LoginRequest",
    "TokenResponse",
    "RefreshRequest",
    "DeviceCreate",
    "DeviceUpdate",
    "DeviceResponse",
    "OrganizationCreate",
    "OrganizationUpdate",
    "OrganizationResponse",
    "SiteCreate",
    "SiteUpdate",
    "SiteResponse",
    "DeviceGroupCreate",
    "DeviceGroupUpdate",
    "DeviceGroupResponse",
]
