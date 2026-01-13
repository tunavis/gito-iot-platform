"""Pydantic request/response schemas for API validation."""

from app.schemas.common import SuccessResponse, ErrorResponse, PaginationMeta
from app.schemas.auth import LoginRequest, TokenResponse, RefreshRequest
from app.schemas.device import DeviceCreate, DeviceUpdate, DeviceResponse

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
]
