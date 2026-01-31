"""Solution template routes - Pre-built industry dashboard templates."""

from fastapi import APIRouter, Depends, HTTPException, status, Header
from sqlalchemy import select, func
from typing import Annotated, List
from uuid import UUID
import logging

from app.database import get_session, RLSSession
from app.models.dashboard import SolutionTemplate, Dashboard, DashboardWidget
from app.models.base import Device
from app.schemas.solution_template import (
    SolutionTemplateResponse,
    ApplyTemplateRequest,
    ApplyTemplateResponse
)
from app.security import decode_token

logger = logging.getLogger(__name__)

router = APIRouter(
    prefix="/tenants/{tenant_id}/solution-templates",
    tags=["solution-templates"]
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


@router.get("", response_model=List[SolutionTemplateResponse])
async def list_solution_templates(
    tenant_id: UUID,
    session: Annotated[RLSSession, Depends(get_session)],
    current_user: Annotated[tuple[UUID, UUID], Depends(get_current_user)] = None,
):
    """List all available solution templates.

    Includes compatible device counts for each template.
    """
    current_tenant_id, current_user_id = current_user

    if str(tenant_id) != str(current_tenant_id):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Tenant mismatch",
        )

    await session.set_tenant_context(tenant_id)

    # Get all active templates
    result = await session.execute(
        select(SolutionTemplate)
        .where(SolutionTemplate.is_active == True)
        .order_by(SolutionTemplate.category, SolutionTemplate.name)
    )
    templates = result.scalars().all()

    # Get user's devices for compatibility checking
    devices_result = await session.execute(
        select(Device).where(Device.tenant_id == tenant_id)
    )
    devices = devices_result.scalars().all()

    # Build response with compatibility counts
    template_responses = []
    for template in templates:
        # Count compatible devices
        compatible_count = 0
        target_types = template.target_device_types or []

        for device in devices:
            # Check if device type matches any target type
            if device.device_type in target_types:
                compatible_count += 1

        template_dict = {
            "id": template.id,
            "name": template.name,
            "identifier": template.identifier,
            "category": template.category,
            "description": template.description,
            "icon": template.icon,
            "color": template.color,
            "target_device_types": target_types,
            "required_capabilities": template.required_capabilities or [],
            "template_config": template.template_config,
            "preview_image_url": template.preview_image_url,
            "is_active": template.is_active,
            "created_at": template.created_at,
            "updated_at": template.updated_at,
            "compatible_device_count": compatible_count,
        }

        template_responses.append(SolutionTemplateResponse(**template_dict))

    return template_responses


@router.get("/{template_id}", response_model=SolutionTemplateResponse)
async def get_solution_template(
    tenant_id: UUID,
    template_id: UUID,
    session: Annotated[RLSSession, Depends(get_session)],
    current_user: Annotated[tuple[UUID, UUID], Depends(get_current_user)] = None,
):
    """Get detailed information about a solution template."""
    current_tenant_id, current_user_id = current_user

    if str(tenant_id) != str(current_tenant_id):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Tenant mismatch",
        )

    await session.set_tenant_context(tenant_id)

    # Get template
    result = await session.execute(
        select(SolutionTemplate).where(SolutionTemplate.id == template_id)
    )
    template = result.scalar_one_or_none()

    if not template:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Template not found",
        )

    # Count compatible devices
    target_types = template.target_device_types or []
    compatible_count = 0

    if target_types:
        count_result = await session.execute(
            select(func.count(Device.id))
            .where(
                Device.tenant_id == tenant_id,
                Device.device_type.in_(target_types)
            )
        )
        compatible_count = count_result.scalar()

    template_dict = {
        "id": template.id,
        "name": template.name,
        "identifier": template.identifier,
        "category": template.category,
        "description": template.description,
        "icon": template.icon,
        "color": template.color,
        "target_device_types": target_types,
        "required_capabilities": template.required_capabilities or [],
        "template_config": template.template_config,
        "preview_image_url": template.preview_image_url,
        "is_active": template.is_active,
        "created_at": template.created_at,
        "updated_at": template.updated_at,
        "compatible_device_count": compatible_count,
    }

    return SolutionTemplateResponse(**template_dict)


@router.post("/{template_id}/apply", response_model=ApplyTemplateResponse)
async def apply_solution_template(
    tenant_id: UUID,
    template_id: UUID,
    apply_data: ApplyTemplateRequest,
    session: Annotated[RLSSession, Depends(get_session)],
    current_user: Annotated[tuple[UUID, UUID], Depends(get_current_user)] = None,
):
    """Apply a solution template to create a new dashboard.

    Creates a dashboard with pre-configured widgets based on the template.
    Optionally binds devices to widgets for auto-configuration.
    """
    current_tenant_id, current_user_id = current_user

    if str(tenant_id) != str(current_tenant_id):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Tenant mismatch",
        )

    await session.set_tenant_context(tenant_id)

    # Get template
    result = await session.execute(
        select(SolutionTemplate).where(SolutionTemplate.id == template_id)
    )
    template = result.scalar_one_or_none()

    if not template:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Template not found",
        )

    # If set as default, unset other defaults
    if apply_data.set_as_default:
        from sqlalchemy import update
        await session.execute(
            update(Dashboard)
            .where(Dashboard.tenant_id == tenant_id, Dashboard.user_id == current_user_id)
            .values(is_default=False)
        )

    # Create dashboard from template
    template_config = template.template_config
    dashboard_name = apply_data.dashboard_name or template.name

    dashboard = Dashboard(
        tenant_id=tenant_id,
        user_id=current_user_id,
        name=dashboard_name,
        description=template.description,
        is_default=apply_data.set_as_default,
        layout_config=template_config.get("layout", {}),
        theme=template_config.get("theme", {}),
        solution_type=template.identifier,
        extra_data={"template_id": str(template.id)},
    )

    session.add(dashboard)
    await session.flush()  # Get dashboard ID

    # Create widgets from template
    widgets_config = template_config.get("widgets", [])
    widgets_created = 0
    auto_bound_devices = 0

    # Get compatible devices for auto-binding
    target_types = template.target_device_types or []
    compatible_devices = []

    if target_types:
        devices_result = await session.execute(
            select(Device)
            .where(
                Device.tenant_id == tenant_id,
                Device.device_type.in_(target_types)
            )
            .limit(10)  # Limit to first 10 compatible devices
        )
        compatible_devices = devices_result.scalars().all()

    for idx, widget_config in enumerate(widgets_config):
        position = widget_config.get("position", {})
        config = widget_config.get("config", {})
        data_binding = widget_config.get("data_binding", {})

        # Build data sources
        data_sources = []

        # Check for device bindings (manual or auto)
        if apply_data.device_bindings and str(idx) in apply_data.device_bindings:
            # Manual binding provided
            device_id = apply_data.device_bindings[str(idx)]
            data_sources.append({
                "device_id": str(device_id),
                "metric": data_binding.get("metric"),
                "alias": f"Device {device_id}",
            })
            auto_bound_devices += 1

        elif data_binding.get("auto_bind") and compatible_devices:
            # Auto-bind to first compatible device
            device = compatible_devices[0]
            data_sources.append({
                "device_id": str(device.id),
                "metric": data_binding.get("metric"),
                "alias": device.name,
            })
            auto_bound_devices += 1

        # Create widget
        widget = DashboardWidget(
            dashboard_id=dashboard.id,
            widget_type=widget_config.get("type", "kpi_card"),
            title=widget_config.get("title", ""),
            position_x=position.get("x", 0),
            position_y=position.get("y", 0),
            width=position.get("w", 2),
            height=position.get("h", 2),
            configuration=config,
            data_sources=data_sources,
            refresh_interval=30,
        )

        session.add(widget)
        widgets_created += 1

    await session.commit()
    await session.refresh(dashboard)

    logger.info(
        f"Template applied: {template.identifier} -> Dashboard {dashboard.id}, "
        f"{widgets_created} widgets, {auto_bound_devices} auto-bound"
    )

    return ApplyTemplateResponse(
        dashboard_id=dashboard.id,
        dashboard_name=dashboard.name,
        widgets_created=widgets_created,
        auto_bound_devices=auto_bound_devices,
        message=f"Dashboard created successfully with {widgets_created} widgets"
    )
