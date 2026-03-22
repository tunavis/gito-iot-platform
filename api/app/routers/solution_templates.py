"""Solution template routes — list, get, and apply industry vertical templates."""

import logging
from typing import Annotated, List, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status

from app.database import get_session, RLSSession
from app.dependencies import get_current_user
from app.schemas.solution_template import (
    ApplyTemplateRequest,
    SolutionTemplateListResponse,
    SolutionTemplateResponse,
)
from app.schemas.dashboard import DashboardResponse
from app.services.solution_templates import TemplateService
from app.services.tenant_access import validate_tenant_access

logger = logging.getLogger(__name__)

router = APIRouter(
    prefix="/tenants/{tenant_id}/solution-templates",
    tags=["solution-templates"],
)


@router.get("", response_model=List[SolutionTemplateListResponse])
async def list_solution_templates(
    tenant_id: UUID,
    session: Annotated[RLSSession, Depends(get_session)],
    current_user: Annotated[tuple[UUID, UUID], Depends(get_current_user)],
    industry: Optional[str] = Query(None, description="Filter by industry vertical"),
):
    """List all active solution templates, optionally filtered by industry."""
    current_tenant_id, current_user_id = current_user

    if not await validate_tenant_access(session, current_tenant_id, tenant_id):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Tenant access denied")

    # Templates are global — no RLS context needed for the query
    service = TemplateService(session)
    templates = await service.list_templates(industry=industry)
    return templates


@router.get("/{template_id}", response_model=SolutionTemplateResponse)
async def get_solution_template(
    tenant_id: UUID,
    template_id: UUID,
    session: Annotated[RLSSession, Depends(get_session)],
    current_user: Annotated[tuple[UUID, UUID], Depends(get_current_user)],
):
    """Get full details of a solution template including device types, dashboard config, and alert rules."""
    current_tenant_id, current_user_id = current_user

    if not await validate_tenant_access(session, current_tenant_id, tenant_id):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Tenant access denied")

    service = TemplateService(session)
    template = await service.get_template(template_id)

    if not template:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Solution template not found",
        )

    return template


@router.post("/{template_id}/apply", response_model=DashboardResponse, status_code=status.HTTP_201_CREATED)
async def apply_solution_template(
    tenant_id: UUID,
    template_id: UUID,
    request: ApplyTemplateRequest,
    session: Annotated[RLSSession, Depends(get_session)],
    current_user: Annotated[tuple[UUID, UUID], Depends(get_current_user)],
):
    """Apply a solution template: creates device types, a dashboard with widgets, and alert rules.

    Returns the newly created dashboard.
    """
    current_tenant_id, current_user_id = current_user

    if not await validate_tenant_access(session, current_tenant_id, tenant_id):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Tenant access denied")

    # Fetch template BEFORE setting tenant context (templates have no RLS)
    service = TemplateService(session)
    template = await service.get_template(template_id)

    if not template:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Solution template not found",
        )

    if not template.get("is_active"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Solution template is not active",
        )

    # Set RLS context for tenant-scoped writes (device types, dashboard, alert rules)
    await session.set_tenant_context(tenant_id, current_user_id)

    dashboard = await service.apply_template(
        template=template,
        tenant_id=tenant_id,
        user_id=current_user_id,
        dashboard_name=request.dashboard_name,
    )

    logger.info(
        "Template '%s' applied for tenant %s by user %s — dashboard %s",
        template.get("slug"),
        tenant_id,
        current_user_id,
        dashboard.id,
    )

    return DashboardResponse.model_validate(dashboard)
