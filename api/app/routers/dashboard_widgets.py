"""Dashboard widget management routes."""

from fastapi import APIRouter, Depends, HTTPException, status, Header
from sqlalchemy import select, delete
from typing import Annotated
from uuid import UUID
import logging

from app.database import get_session, RLSSession
from app.models.dashboard import Dashboard, DashboardWidget
from app.schemas.dashboard import (
    WidgetCreate,
    WidgetUpdate,
    WidgetResponse,
    DeviceBindingRequest
)
from app.schemas.common import SuccessResponse
from app.security import decode_token

logger = logging.getLogger(__name__)

router = APIRouter(
    prefix="/tenants/{tenant_id}/dashboards/{dashboard_id}/widgets",
    tags=["dashboard-widgets"]
)


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


async def verify_dashboard_ownership(
    tenant_id: UUID,
    dashboard_id: UUID,
    current_user_id: UUID,
    session: RLSSession
) -> Dashboard:
    """Verify that the dashboard belongs to the current user."""
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

    return dashboard


@router.post("", response_model=WidgetResponse, status_code=status.HTTP_201_CREATED)
async def create_widget(
    tenant_id: UUID,
    dashboard_id: UUID,
    widget_data: WidgetCreate,
    session: Annotated[RLSSession, Depends(get_session)],
    current_user: Annotated[tuple[UUID, UUID], Depends(get_current_user)] = None,
):
    """Add a new widget to the dashboard."""
    current_tenant_id, current_user_id = current_user

    if str(tenant_id) != str(current_tenant_id):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Tenant mismatch",
        )

    await session.set_tenant_context(tenant_id, current_user_id)

    # Verify dashboard ownership
    await verify_dashboard_ownership(tenant_id, dashboard_id, current_user_id, session)

    # Create widget
    widget = DashboardWidget(
        dashboard_id=dashboard_id,
        widget_type=widget_data.widget_type,
        title=widget_data.title,
        position_x=widget_data.position_x,
        position_y=widget_data.position_y,
        width=widget_data.width,
        height=widget_data.height,
        configuration=widget_data.configuration,
        data_sources=widget_data.data_sources,
        refresh_interval=widget_data.refresh_interval,
    )

    session.add(widget)
    await session.commit()
    await session.refresh(widget)

    logger.info(f"Widget created: {widget.id} on dashboard {dashboard_id}")

    return WidgetResponse.model_validate(widget)


@router.put("/{widget_id}", response_model=WidgetResponse)
async def update_widget(
    tenant_id: UUID,
    dashboard_id: UUID,
    widget_id: UUID,
    widget_data: WidgetUpdate,
    session: Annotated[RLSSession, Depends(get_session)],
    current_user: Annotated[tuple[UUID, UUID], Depends(get_current_user)] = None,
):
    """Update widget configuration."""
    current_tenant_id, current_user_id = current_user

    if str(tenant_id) != str(current_tenant_id):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Tenant mismatch",
        )

    await session.set_tenant_context(tenant_id, current_user_id)

    # Verify dashboard ownership
    await verify_dashboard_ownership(tenant_id, dashboard_id, current_user_id, session)

    # Get widget
    result = await session.execute(
        select(DashboardWidget).where(
            DashboardWidget.id == widget_id,
            DashboardWidget.dashboard_id == dashboard_id
        )
    )
    widget = result.scalar_one_or_none()

    if not widget:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Widget not found",
        )

    # Update fields
    update_data = widget_data.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(widget, field, value)

    await session.commit()
    await session.refresh(widget)

    logger.info(f"Widget updated: {widget_id}")

    return WidgetResponse.model_validate(widget)


@router.delete("/{widget_id}", response_model=SuccessResponse)
async def delete_widget(
    tenant_id: UUID,
    dashboard_id: UUID,
    widget_id: UUID,
    session: Annotated[RLSSession, Depends(get_session)],
    current_user: Annotated[tuple[UUID, UUID], Depends(get_current_user)] = None,
):
    """Remove widget from dashboard."""
    current_tenant_id, current_user_id = current_user

    if str(tenant_id) != str(current_tenant_id):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Tenant mismatch",
        )

    await session.set_tenant_context(tenant_id, current_user_id)

    # Verify dashboard ownership
    await verify_dashboard_ownership(tenant_id, dashboard_id, current_user_id, session)

    # Check widget exists
    result = await session.execute(
        select(DashboardWidget).where(
            DashboardWidget.id == widget_id,
            DashboardWidget.dashboard_id == dashboard_id
        )
    )
    widget = result.scalar_one_or_none()

    if not widget:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Widget not found",
        )

    # Delete widget
    await session.execute(
        delete(DashboardWidget).where(DashboardWidget.id == widget_id)
    )
    await session.commit()

    logger.info(f"Widget deleted: {widget_id}")

    return SuccessResponse(data={"message": "Widget deleted successfully"})


@router.post("/{widget_id}/bind-device", response_model=WidgetResponse)
async def bind_device_to_widget(
    tenant_id: UUID,
    dashboard_id: UUID,
    widget_id: UUID,
    binding_data: DeviceBindingRequest,
    session: Annotated[RLSSession, Depends(get_session)],
    current_user: Annotated[tuple[UUID, UUID], Depends(get_current_user)] = None,
):
    """Bind a device to a widget for data display.

    Adds the device to the widget's data_sources array.
    """
    current_tenant_id, current_user_id = current_user

    if str(tenant_id) != str(current_tenant_id):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Tenant mismatch",
        )

    await session.set_tenant_context(tenant_id, current_user_id)

    # Verify dashboard ownership
    await verify_dashboard_ownership(tenant_id, dashboard_id, current_user_id, session)

    # Get widget
    result = await session.execute(
        select(DashboardWidget).where(
            DashboardWidget.id == widget_id,
            DashboardWidget.dashboard_id == dashboard_id
        )
    )
    widget = result.scalar_one_or_none()

    if not widget:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Widget not found",
        )

    # Add device binding to data_sources
    data_sources = widget.data_sources or []

    # Check if device already bound
    existing_binding = next(
        (ds for ds in data_sources if ds.get("device_id") == str(binding_data.device_id)),
        None
    )

    if existing_binding:
        # Update existing binding
        existing_binding["metric"] = binding_data.metric
        existing_binding["alias"] = binding_data.alias
    else:
        # Add new binding
        new_binding = {
            "device_id": str(binding_data.device_id),
            "metric": binding_data.metric,
            "alias": binding_data.alias or f"Device {binding_data.device_id}",
        }
        data_sources.append(new_binding)

    widget.data_sources = data_sources
    await session.commit()
    await session.refresh(widget)

    logger.info(f"Device {binding_data.device_id} bound to widget {widget_id}")

    return WidgetResponse.model_validate(widget)
