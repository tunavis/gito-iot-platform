"""Pydantic schemas for device commands (RPC Option B)."""

from datetime import datetime
from typing import Any, Optional
from uuid import UUID

from pydantic import BaseModel, Field, computed_field


class CommandCreate(BaseModel):
    """Request body for sending a command to a device."""

    command_name: str = Field(
        ..., min_length=1, max_length=100, examples=["reboot", "set_interval"]
    )
    parameters: dict[str, Any] = Field(default_factory=dict, examples=[{"interval": 30}])
    ttl_seconds: int = Field(
        default=60, ge=5, le=3600, description="Time-to-live in seconds before command times out"
    )


class CommandResponse(BaseModel):
    """Single device command with lifecycle status."""

    id: UUID
    tenant_id: UUID
    device_id: UUID
    command_name: str
    parameters: dict[str, Any]
    status: str
    response: Optional[dict[str, Any]] = None
    error_message: Optional[str] = None
    created_at: datetime
    expires_at: datetime
    sent_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None
    # Approval gate. NULL on everything issued through the ordinary POST, which
    # is never gated — absent approval here means it was never required, not
    # that it is still waiting on someone.
    requested_by: Optional[UUID] = None
    request_reason: Optional[str] = None
    approved_by: Optional[UUID] = None
    approved_at: Optional[datetime] = None
    rejected_by: Optional[UUID] = None
    rejected_at: Optional[datetime] = None

    @computed_field
    @property
    def self_approved(self) -> bool:
        """Whether the approver is the same person who requested it.

        Computed here so the UI can label it rather than every client
        re-deriving it by comparing two uuids — and so an auditor reading the API
        sees it stated rather than having to notice it.
        """
        return bool(
            self.approved_by is not None
            and self.requested_by is not None
            and self.approved_by == self.requested_by
        )

    model_config = {"from_attributes": True}


class CommandListResponse(BaseModel):
    """Paginated list of device commands."""

    data: list[CommandResponse]
    total: int


class PendingApproval(BaseModel):
    """One command waiting on a human, with the context needed to decide.

    Deliberately not `CommandResponse`: an approver needs the device and site by
    name and the reason the agent gave, and does not need the dispatch-lifecycle
    fields. Handing the queue a shape built for a different question is how
    screens end up showing uuids.
    """

    id: UUID
    device_id: UUID
    device_name: str
    site_id: Optional[UUID] = None
    site_name: Optional[str] = None
    command_name: str
    parameters: dict[str, Any]
    request_reason: Optional[str] = None
    requested_by: Optional[UUID] = None
    requested_by_email: Optional[str] = None
    created_at: datetime
    expires_at: datetime


class PendingApprovalListResponse(BaseModel):
    """The approval queue, plus the count the sidebar badge shows."""

    data: list[PendingApproval]
    total: int
