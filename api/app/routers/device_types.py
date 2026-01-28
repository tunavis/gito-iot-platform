"""Device Types router - CRUD for device type templates (AWS IoT / Cumulocity pattern).

Endpoints:
- GET    /tenants/{tenant_id}/device-types              - List all device types
- POST   /tenants/{tenant_id}/device-types              - Create device type
- GET    /tenants/{tenant_id}/device-types/{id}         - Get device type details
- PUT    /tenants/{tenant_id}/device-types/{id}         - Update device type
- DELETE /tenants/{tenant_id}/device-types/{id}         - Delete device type
- POST   /tenants/{tenant_id}/device-types/{id}/clone   - Clone device type
"""

import logging
from typing import Annotated, Optional, List
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status, Query, Header
from sqlalchemy import select, func, and_

from app.database import get_session, RLSSession
from app.models.device_type import DeviceType
from app.schemas.device_type import (
    DeviceTypeCreate,
    DeviceTypeUpdate,
    DeviceTypeResponse,
    DeviceTypeListResponse,
)
from app.schemas.common import SuccessResponse
from app.security import decode_token

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/tenants/{tenant_id}/device-types", tags=["device-types"])


async def get_current_tenant(
    tenant_id: UUID,
    authorization: str = Header(None),
) -> UUID:
    """Extract and validate tenant_id from JWT token."""
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing or invalid Authorization header",
        )
    
    token = authorization.split(" ")[1]
    payload = decode_token(token)
    token_tenant_id = payload.get("tenant_id")
    
    if not token_tenant_id:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid token: missing tenant_id",
        )
    
    if str(tenant_id) != str(token_tenant_id):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Tenant mismatch",
        )
    
    return UUID(token_tenant_id)


# ============================================================================
# LIST DEVICE TYPES
# ============================================================================

@router.get("")
async def list_device_types(
    tenant_id: UUID,
    session: Annotated[RLSSession, Depends(get_session)],
    current_tenant: Annotated[UUID, Depends(get_current_tenant)],
    category: Optional[str] = Query(None, description="Filter by category"),
    is_active: Optional[bool] = Query(None, description="Filter by active status"),
    search: Optional[str] = Query(None, description="Search by name or manufacturer"),
    page: int = Query(1, ge=1),
    per_page: int = Query(20, ge=1, le=100),
) -> DeviceTypeListResponse:
    """List all device types for the tenant."""
    await session.set_tenant_context(current_tenant)
    
    # Build query
    query = select(DeviceType).where(DeviceType.tenant_id == current_tenant)
    count_query = select(func.count(DeviceType.id)).where(DeviceType.tenant_id == current_tenant)
    
    # Apply filters
    if category:
        query = query.where(DeviceType.category == category)
        count_query = count_query.where(DeviceType.category == category)
    
    if is_active is not None:
        query = query.where(DeviceType.is_active == is_active)
        count_query = count_query.where(DeviceType.is_active == is_active)
    
    if search:
        search_filter = f"%{search}%"
        query = query.where(
            (DeviceType.name.ilike(search_filter)) |
            (DeviceType.manufacturer.ilike(search_filter)) |
            (DeviceType.model.ilike(search_filter))
        )
        count_query = count_query.where(
            (DeviceType.name.ilike(search_filter)) |
            (DeviceType.manufacturer.ilike(search_filter)) |
            (DeviceType.model.ilike(search_filter))
        )
    
    # Get total count
    total_result = await session.execute(count_query)
    total = total_result.scalar() or 0
    
    # Apply pagination
    offset = (page - 1) * per_page
    query = query.order_by(DeviceType.name).offset(offset).limit(per_page)
    
    # Execute
    result = await session.execute(query)
    device_types = result.scalars().all()
    
    return DeviceTypeListResponse(
        success=True,
        data=[DeviceTypeResponse.model_validate(dt) for dt in device_types],
        meta={
            "page": page,
            "per_page": per_page,
            "total": total,
            "total_pages": (total + per_page - 1) // per_page,
        }
    )


# ============================================================================
# CREATE DEVICE TYPE
# ============================================================================

@router.post("", status_code=status.HTTP_201_CREATED)
async def create_device_type(
    tenant_id: UUID,
    device_type_data: DeviceTypeCreate,
    session: Annotated[RLSSession, Depends(get_session)],
    current_tenant: Annotated[UUID, Depends(get_current_tenant)],
) -> SuccessResponse:
    """Create a new device type template."""
    await session.set_tenant_context(current_tenant)
    
    # Convert data model to JSON-serializable format
    data_model_json = []
    if device_type_data.data_model:
        for field in device_type_data.data_model:
            data_model_json.append({
                "name": field.name,
                "type": field.type,
                "unit": field.unit,
                "description": field.description,
                "min": field.min_value,
                "max": field.max_value,
                "required": field.required,
            })
    
    # Convert capabilities to list of strings
    capabilities_json = device_type_data.capabilities or []
    
    # Convert settings and connectivity
    default_settings_json = None
    if device_type_data.default_settings:
        default_settings_json = device_type_data.default_settings.model_dump()
    
    connectivity_json = None
    if device_type_data.connectivity:
        connectivity_json = device_type_data.connectivity.model_dump()
    
    # Create device type
    device_type = DeviceType(
        tenant_id=current_tenant,
        name=device_type_data.name,
        description=device_type_data.description,
        manufacturer=device_type_data.manufacturer,
        model=device_type_data.model,
        category=device_type_data.category,
        icon=device_type_data.icon,
        color=device_type_data.color,
        data_model=data_model_json,
        capabilities=capabilities_json,
        default_settings=default_settings_json,
        connectivity=connectivity_json,
        extra_metadata=device_type_data.metadata or {},
    )
    
    session.add(device_type)
    await session.commit()
    await session.refresh(device_type)
    
    logger.info(f"Created device type: {device_type.name} for tenant {current_tenant}")
    
    return SuccessResponse(
        success=True,
        data=DeviceTypeResponse.model_validate(device_type),
        message="Device type created successfully",
    )


# ============================================================================
# GET DEVICE TYPE
# ============================================================================

@router.get("/{device_type_id}")
async def get_device_type(
    tenant_id: UUID,
    device_type_id: UUID,
    session: Annotated[RLSSession, Depends(get_session)],
    current_tenant: Annotated[UUID, Depends(get_current_tenant)],
) -> SuccessResponse:
    """Get a device type by ID."""
    await session.set_tenant_context(current_tenant)
    
    result = await session.execute(
        select(DeviceType).where(
            DeviceType.id == device_type_id,
            DeviceType.tenant_id == current_tenant,
        )
    )
    device_type = result.scalar_one_or_none()
    
    if not device_type:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Device type not found",
        )
    
    return SuccessResponse(
        success=True,
        data=DeviceTypeResponse.model_validate(device_type),
    )


# ============================================================================
# UPDATE DEVICE TYPE
# ============================================================================

@router.put("/{device_type_id}")
async def update_device_type(
    tenant_id: UUID,
    device_type_id: UUID,
    update_data: DeviceTypeUpdate,
    session: Annotated[RLSSession, Depends(get_session)],
    current_tenant: Annotated[UUID, Depends(get_current_tenant)],
) -> SuccessResponse:
    """Update a device type."""
    await session.set_tenant_context(current_tenant)
    
    result = await session.execute(
        select(DeviceType).where(
            DeviceType.id == device_type_id,
            DeviceType.tenant_id == current_tenant,
        )
    )
    device_type = result.scalar_one_or_none()
    
    if not device_type:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Device type not found",
        )
    
    # Update fields
    update_dict = update_data.model_dump(exclude_unset=True)
    
    # Handle nested objects
    if "data_model" in update_dict and update_dict["data_model"]:
        data_model_json = []
        for field in update_data.data_model:
            data_model_json.append({
                "name": field.name,
                "type": field.type,
                "unit": field.unit,
                "description": field.description,
                "min": field.min_value,
                "max": field.max_value,
                "required": field.required,
            })
        update_dict["data_model"] = data_model_json
    
    if "default_settings" in update_dict and update_data.default_settings:
        update_dict["default_settings"] = update_data.default_settings.model_dump()
    
    if "connectivity" in update_dict and update_data.connectivity:
        update_dict["connectivity"] = update_data.connectivity.model_dump()
    
    for key, value in update_dict.items():
        if hasattr(device_type, key):
            setattr(device_type, key, value)
    
    await session.commit()
    await session.refresh(device_type)
    
    return SuccessResponse(
        success=True,
        data=DeviceTypeResponse.model_validate(device_type),
        message="Device type updated successfully",
    )


# ============================================================================
# DELETE DEVICE TYPE
# ============================================================================

@router.delete("/{device_type_id}")
async def delete_device_type(
    tenant_id: UUID,
    device_type_id: UUID,
    session: Annotated[RLSSession, Depends(get_session)],
    current_tenant: Annotated[UUID, Depends(get_current_tenant)],
    force: bool = Query(False, description="Force delete even if devices exist"),
) -> SuccessResponse:
    """Delete a device type."""
    await session.set_tenant_context(current_tenant)
    
    result = await session.execute(
        select(DeviceType).where(
            DeviceType.id == device_type_id,
            DeviceType.tenant_id == current_tenant,
        )
    )
    device_type = result.scalar_one_or_none()
    
    if not device_type:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Device type not found",
        )
    
    # Check if devices use this type (if not forcing)
    if not force and device_type.device_count > 0:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Cannot delete device type with {device_type.device_count} devices. Use force=true to delete anyway.",
        )
    
    await session.delete(device_type)
    await session.commit()
    
    return SuccessResponse(
        success=True,
        message="Device type deleted successfully",
    )


# ============================================================================
# CLONE DEVICE TYPE
# ============================================================================

@router.post("/{device_type_id}/clone", status_code=status.HTTP_201_CREATED)
async def clone_device_type(
    tenant_id: UUID,
    device_type_id: UUID,
    session: Annotated[RLSSession, Depends(get_session)],
    current_tenant: Annotated[UUID, Depends(get_current_tenant)],
    name: Optional[str] = Query(None, description="Name for the cloned type"),
) -> SuccessResponse:
    """Clone an existing device type."""
    await session.set_tenant_context(current_tenant)
    
    result = await session.execute(
        select(DeviceType).where(
            DeviceType.id == device_type_id,
            DeviceType.tenant_id == current_tenant,
        )
    )
    source = result.scalar_one_or_none()
    
    if not source:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Device type not found",
        )
    
    # Create clone
    clone = DeviceType(
        tenant_id=current_tenant,
        name=name or f"{source.name} (Copy)",
        description=source.description,
        manufacturer=source.manufacturer,
        model=source.model,
        category=source.category,
        icon=source.icon,
        color=source.color,
        data_model=source.data_model,
        capabilities=source.capabilities,
        default_settings=source.default_settings,
        connectivity=source.connectivity,
        extra_metadata=source.extra_metadata,
    )
    
    session.add(clone)
    await session.commit()
    await session.refresh(clone)
    
    return SuccessResponse(
        success=True,
        data=DeviceTypeResponse.model_validate(clone),
        message="Device type cloned successfully",
    )
