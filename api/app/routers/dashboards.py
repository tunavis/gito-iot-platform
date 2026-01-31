"""Dashboard management routes - CRUD operations with RLS enforcement."""

from fastapi import APIRouter, Depends, HTTPException, status, Header
from sqlalchemy import select, func, update, delete
from sqlalchemy.ext.asyncio import AsyncSession
from typing import Annotated, List
from uuid import UUID
import logging

from app.database import get_session, RLSSession
from app.models.dashboard import Dashboard, DashboardWidget
from app.schemas.dashboard import (
    DashboardCreate,
    DashboardUpdate,
    DashboardResponse,
    DashboardListResponse,
    DashboardWithWidgets,
    WidgetResponse,
    LayoutUpdateRequest
)
from app.schemas.common import SuccessResponse
from app.security import decode_token

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/tenants/{tenant_id}/dashboards", tags=["dashboards"])


async def get_current_user(
    authorization: str = Header(None),
) -> tuple[UUID, UUID]:
    """Extract and validate tenant_id and user_id from JWT token."""
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing or invalid Authorization header",
        )

    token = authorization.split(" ")[1]
    payload = decode_token(token)
    tenant_id = payload.get("tenant_id")
    user_id = payload.get("sub")  # user_id is stored in "sub" field

    if not tenant_id or not user_id:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid token: missing tenant_id or user_id",
        )

    return UUID(tenant_id), UUID(user_id)


@router.get("", response_model=List[DashboardListResponse])
async def list_dashboards(
    tenant_id: UUID,
    session: Annotated[RLSSession, Depends(get_session)],
    current_user: Annotated[tuple[UUID, UUID], Depends(get_current_user)] = None,
):
    """List all dashboards for the current user.

    RLS ensures users can only see their own dashboards within their tenant.
    """
    current_tenant_id, current_user_id = current_user

    if str(tenant_id) != str(current_tenant_id):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Tenant mismatch",
        )

    await session.set_tenant_context(tenant_id)

    # Get dashboards with widget counts
    query = select(
        Dashboard,
        func.count(DashboardWidget.id).label("widget_count")
    ).outerjoin(
        DashboardWidget, Dashboard.id == DashboardWidget.dashboard_id
    ).where(
        Dashboard.tenant_id == tenant_id,
        Dashboard.user_id == current_user_id
    ).group_by(Dashboard.id).order_by(Dashboard.created_at.desc())

    result = await session.execute(query)
    rows = result.all()

    dashboards = []
    for dashboard, widget_count in rows:
        dashboard_dict = {
            "id": dashboard.id,
            "name": dashboard.name,
            "description": dashboard.description,
            "is_default": dashboard.is_default,
            "solution_type": dashboard.solution_type,
            "widget_count": widget_count,
            "created_at": dashboard.created_at,
            "updated_at": dashboard.updated_at,
        }
        dashboards.append(DashboardListResponse(**dashboard_dict))

    return dashboards


@router.post("", response_model=DashboardResponse, status_code=status.HTTP_201_CREATED)
async def create_dashboard(
    tenant_id: UUID,
    dashboard_data: DashboardCreate,
    session: Annotated[RLSSession, Depends(get_session)],
    current_user: Annotated[tuple[UUID, UUID], Depends(get_current_user)] = None,
):
    """Create a new dashboard.

    If is_default=true, will unset other default dashboards for this user.
    """
    current_tenant_id, current_user_id = current_user

    if str(tenant_id) != str(current_tenant_id):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Tenant mismatch",
        )

    await session.set_tenant_context(tenant_id)

    # If setting as default, unset other defaults
    if dashboard_data.is_default:
        await session.execute(
            update(Dashboard)
            .where(Dashboard.tenant_id == tenant_id, Dashboard.user_id == current_user_id)
            .values(is_default=False)
        )

    # Create dashboard
    dashboard = Dashboard(
        tenant_id=tenant_id,
        user_id=current_user_id,
        name=dashboard_data.name,
        description=dashboard_data.description,
        is_default=dashboard_data.is_default,
        layout_config=dashboard_data.layout_config,
        theme=dashboard_data.theme,
        solution_type=dashboard_data.solution_type,
        extra_data=dashboard_data.extra_data,
    )

    session.add(dashboard)
    await session.commit()
    await session.refresh(dashboard)

    logger.info(f"Dashboard created: {dashboard.id} for user {current_user_id}")

    return DashboardResponse.model_validate(dashboard)


@router.get("/{dashboard_id}", response_model=DashboardWithWidgets)
async def get_dashboard(
    tenant_id: UUID,
    dashboard_id: UUID,
    session: Annotated[RLSSession, Depends(get_session)],
    current_user: Annotated[tuple[UUID, UUID], Depends(get_current_user)] = None,
):
    """Get dashboard with all its widgets."""
    current_tenant_id, current_user_id = current_user

    if str(tenant_id) != str(current_tenant_id):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Tenant mismatch",
        )

    await session.set_tenant_context(tenant_id)

    # Get dashboard
    result = await session.execute(
        select(Dashboard).where(
            Dashboard.id == dashboard_id,
            Dashboard.tenant_id == tenant_id,
            Dashboard.user_id == current_user_id
        )
    )
    dashboard = result.scalar_one_or_none()

    if not dashboard:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Dashboard not found",
        )

    # Get widgets
    result = await session.execute(
        select(DashboardWidget)
        .where(DashboardWidget.dashboard_id == dashboard_id)
        .order_by(DashboardWidget.position_y, DashboardWidget.position_x)
    )
    widgets = result.scalars().all()

    # Build response
    dashboard_dict = {
        "id": dashboard.id,
        "tenant_id": dashboard.tenant_id,
        "user_id": dashboard.user_id,
        "name": dashboard.name,
        "description": dashboard.description,
        "is_default": dashboard.is_default,
        "layout_config": dashboard.layout_config,
        "theme": dashboard.theme,
        "solution_type": dashboard.solution_type,
        "extra_data": dashboard.extra_data,
        "widgets": [WidgetResponse.model_validate(w) for w in widgets],
        "created_at": dashboard.created_at,
        "updated_at": dashboard.updated_at,
    }

    return DashboardWithWidgets(**dashboard_dict)


@router.put("/{dashboard_id}", response_model=DashboardResponse)
async def update_dashboard(
    tenant_id: UUID,
    dashboard_id: UUID,
    dashboard_data: DashboardUpdate,
    session: Annotated[RLSSession, Depends(get_session)],
    current_user: Annotated[tuple[UUID, UUID], Depends(get_current_user)] = None,
):
    """Update dashboard details."""
    current_tenant_id, current_user_id = current_user

    if str(tenant_id) != str(current_tenant_id):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Tenant mismatch",
        )

    await session.set_tenant_context(tenant_id)

    # Get dashboard
    result = await session.execute(
        select(Dashboard).where(
            Dashboard.id == dashboard_id,
            Dashboard.tenant_id == tenant_id,
            Dashboard.user_id == current_user_id
        )
    )
    dashboard = result.scalar_one_or_none()

    if not dashboard:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Dashboard not found",
        )

    # If setting as default, unset other defaults
    if dashboard_data.is_default and not dashboard.is_default:
        await session.execute(
            update(Dashboard)
            .where(
                Dashboard.tenant_id == tenant_id,
                Dashboard.user_id == current_user_id,
                Dashboard.id != dashboard_id
            )
            .values(is_default=False)
        )

    # Update fields
    update_data = dashboard_data.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(dashboard, field, value)

    await session.commit()
    await session.refresh(dashboard)

    logger.info(f"Dashboard updated: {dashboard_id}")

    return DashboardResponse.model_validate(dashboard)


@router.delete("/{dashboard_id}", response_model=SuccessResponse)
async def delete_dashboard(
    tenant_id: UUID,
    dashboard_id: UUID,
    session: Annotated[RLSSession, Depends(get_session)],
    current_user: Annotated[tuple[UUID, UUID], Depends(get_current_user)] = None,
):
    """Delete dashboard and all its widgets."""
    current_tenant_id, current_user_id = current_user

    if str(tenant_id) != str(current_tenant_id):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Tenant mismatch",
        )

    await session.set_tenant_context(tenant_id)

    # Check dashboard exists
    result = await session.execute(
        select(Dashboard).where(
            Dashboard.id == dashboard_id,
            Dashboard.tenant_id == tenant_id,
            Dashboard.user_id == current_user_id
        )
    )
    dashboard = result.scalar_one_or_none()

    if not dashboard:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Dashboard not found",
        )

    # Delete dashboard (widgets will cascade delete)
    await session.execute(
        delete(Dashboard).where(Dashboard.id == dashboard_id)
    )
    await session.commit()

    logger.info(f"Dashboard deleted: {dashboard_id}")

    return SuccessResponse(
        success=True,
        message="Dashboard deleted successfully"
    )


@router.put("/{dashboard_id}/layout", response_model=SuccessResponse)
async def update_dashboard_layout(
    tenant_id: UUID,
    dashboard_id: UUID,
    layout_data: LayoutUpdateRequest,
    session: Annotated[RLSSession, Depends(get_session)],
    current_user: Annotated[tuple[UUID, UUID], Depends(get_current_user)] = None,
):
    """Batch update widget positions and sizes."""
    current_tenant_id, current_user_id = current_user

    if str(tenant_id) != str(current_tenant_id):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Tenant mismatch",
        )

    await session.set_tenant_context(tenant_id)

    # Verify dashboard ownership
    result = await session.execute(
        select(Dashboard).where(
            Dashboard.id == dashboard_id,
            Dashboard.tenant_id == tenant_id,
            Dashboard.user_id == current_user_id
        )
    )
    dashboard = result.scalar_one_or_none()

    if not dashboard:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Dashboard not found",
        )

    # Update each widget
    updated_count = 0
    for widget_update in layout_data.widgets:
        widget_id = widget_update.get("id")
        if not widget_id:
            continue

        update_values = {}
        if "x" in widget_update:
            update_values["position_x"] = widget_update["x"]
        if "y" in widget_update:
            update_values["position_y"] = widget_update["y"]
        if "w" in widget_update:
            update_values["width"] = widget_update["w"]
        if "h" in widget_update:
            update_values["height"] = widget_update["h"]

        if update_values:
            await session.execute(
                update(DashboardWidget)
                .where(
                    DashboardWidget.id == UUID(widget_id),
                    DashboardWidget.dashboard_id == dashboard_id
                )
                .values(**update_values)
            )
            updated_count += 1

    await session.commit()

    logger.info(f"Dashboard layout updated: {dashboard_id}, {updated_count} widgets")

    return SuccessResponse(
        success=True,
        message=f"Layout updated: {updated_count} widgets repositioned"
    )
