"""Common schemas for standardized API responses."""

from pydantic import BaseModel, Field
from typing import Generic, TypeVar, Optional
from datetime import datetime

T = TypeVar("T")


class PaginationMeta(BaseModel):
    """Pagination metadata for list responses."""
    page: int = Field(ge=1, description="Page number (1-indexed)")
    per_page: int = Field(ge=1, le=100, description="Items per page")
    total: int = Field(ge=0, description="Total number of items")


class SuccessResponse(BaseModel, Generic[T]):
    """Standard successful API response wrapper."""
    success: bool = True
    data: Optional[T] = None
    meta: Optional[PaginationMeta] = None


class ErrorDetail(BaseModel):
    """Error response detail structure."""
    code: str = Field(description="Machine-readable error code")
    message: str = Field(description="Human-readable error message")
    details: Optional[dict] = Field(None, description="Additional error context")


class ErrorResponse(BaseModel):
    """Standard error API response."""
    success: bool = False
    error: ErrorDetail
