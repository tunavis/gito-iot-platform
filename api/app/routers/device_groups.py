"""Device Groups API - Logical device grouping for bulk operations."""

from fastapi import APIRouter, Depends, HTTPException, status, Query, Header
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession
from typing import Annotated, Optional
from uuid import UUID
from datetime import datetime

from app.database import get_session, RLSSession
from app.models.device_group import DeviceGroup
from app.models.base import Device
from app.schemas.common import SuccessResponse, PaginationMeta
from app.schemas.device_group import DeviceGroupResponse as DedicatedDeviceGroupResponse
from app.security import decode_token

router = APIRouter(prefix="/tenants/{tenant_id}/device-groups", tags=["device-groups"])


async def get_current_tenant(
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
    tenant_id = payload.get("tenant_id")
    
    if not tenant_id:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid token: missing tenant_id",
        )
    
    return UUID(tenant_id)


# Inline schemas for strict hierarchy (org + site required)
from pydantic import BaseModel, Field

class DeviceGroupCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=255)
    description: Optional[str] = None
    organization_id: UUID  # REQUIRED in strict hierarchy
    site_id: UUID  # REQUIRED in strict hierarchy
    group_type: Optional[str] = Field(None, max_length=50)
    membership_rule: dict = Field(default_factory=dict)
    attributes: dict = Field(default_factory=dict)


class DeviceGroupUpdate(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=255)
    description: Optional[str] = None
    group_type: Optional[str] = Field(None, max_length=50)
    membership_rule: Optional[dict] = None
    attributes: Optional[dict] = None


class DeviceGroupResponse(BaseModel):
    id: UUID
    tenant_id: UUID
    organization_id: UUID
    site_id: UUID
    name: str
    description: Optional[str] = None
    group_type: Optional[str] = None
    membership_rule: dict
    attributes: dict
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


@router.get("", response_model=SuccessResponse)
async def list_device_groups(
    tenant_id: UUID,
    session: Annotated[RLSSession, Depends(get_session)],
    current_tenant: Annotated[UUID, Depends(get_current_tenant)],
    page: int = Query(1, ge=1),
    per_page: int = Query(50, ge=1, le=100),
    organization_id: Optional[UUID] = Query(None),
    site_id: Optional[UUID] = Query(None),
    group_type: Optional[str] = Query(None),
):
    """List all device groups for a tenant with optional filtering."""
    if str(tenant_id) != str(current_tenant):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Tenant mismatch")
    
    await session.set_tenant_context(tenant_id)
    
    # Build query
    query = select(DeviceGroup).where(DeviceGroup.tenant_id == tenant_id)
    
    if organization_id:
        query = query.where(DeviceGroup.organization_id == organization_id)
    if site_id:
        query = query.where(DeviceGroup.site_id == site_id)
    if group_type:
        query = query.where(DeviceGroup.group_type == group_type)
    
    query = query.order_by(DeviceGroup.created_at.desc())
    
    # Count total
    count_query = select(func.count()).select_from(DeviceGroup).where(DeviceGroup.tenant_id == tenant_id)
    if organization_id:
        count_query = count_query.where(DeviceGroup.organization_id == organization_id)
    if site_id:
        count_query = count_query.where(DeviceGroup.site_id == site_id)
    if group_type:
        count_query = count_query.where(DeviceGroup.group_type == group_type)
    
    total_result = await session.execute(count_query)
    total = total_result.scalar() or 0
    
    # Paginate
    query = query.offset((page - 1) * per_page).limit(per_page)
    result = await session.execute(query)
    groups = result.scalars().all()
    
    return SuccessResponse(
        data=[DeviceGroupResponse.model_validate(group) for group in groups],
        meta=PaginationMeta(page=page, per_page=per_page, total=total)
    )


@router.post("", response_model=SuccessResponse, status_code=status.HTTP_201_CREATED)
async def create_device_group(
    tenant_id: UUID,
    group_data: DeviceGroupCreate,
    session: Annotated[RLSSession, Depends(get_session)],
    current_tenant: Annotated[UUID, Depends(get_current_tenant)],
):
    """Create a new device group."""
    if str(tenant_id) != str(current_tenant):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Tenant mismatch")
    
    await session.set_tenant_context(tenant_id)
    
    # Create group
    group = DeviceGroup(
        tenant_id=tenant_id,
        organization_id=group_data.organization_id,
        site_id=group_data.site_id,
        name=group_data.name,
        description=group_data.description,
        group_type=group_data.group_type,
        membership_rule=group_data.membership_rule,
        attributes=group_data.attributes,
    )
    
    session.add(group)
    await session.commit()
    await session.refresh(group)
    
    return SuccessResponse(data=DeviceGroupResponse.model_validate(group))


@router.get("/{group_id}", response_model=SuccessResponse)
async def get_device_group(
    tenant_id: UUID,
    group_id: UUID,
    session: Annotated[RLSSession, Depends(get_session)],
    current_tenant: Annotated[UUID, Depends(get_current_tenant)],
):
    """Get a specific device group."""
    if str(tenant_id) != str(current_tenant):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Tenant mismatch")
    
    await session.set_tenant_context(tenant_id)
    
    result = await session.execute(
        select(DeviceGroup).where(
            DeviceGroup.tenant_id == tenant_id,
            DeviceGroup.id == group_id
        )
    )
    group = result.scalar_one_or_none()
    
    if not group:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Device group not found")
    
    return SuccessResponse(data=DeviceGroupResponse.model_validate(group))


@router.put("/{group_id}", response_model=SuccessResponse)
async def update_device_group(
    tenant_id: UUID,
    group_id: UUID,
    group_data: DeviceGroupUpdate,
    session: Annotated[RLSSession, Depends(get_session)],
    current_tenant: Annotated[UUID, Depends(get_current_tenant)],
):
    """Update a device group."""
    if str(tenant_id) != str(current_tenant):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Tenant mismatch")
    
    await session.set_tenant_context(tenant_id)
    
    result = await session.execute(
        select(DeviceGroup).where(
            DeviceGroup.tenant_id == tenant_id,
            DeviceGroup.id == group_id
        )
    )
    group = result.scalar_one_or_none()
    
    if not group:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Device group not found")
    
    # Update fields
    update_data = group_data.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(group, field, value)
    
    group.updated_at = datetime.utcnow()
    
    await session.commit()
    await session.refresh(group)
    
    return SuccessResponse(data=DeviceGroupResponse.model_validate(group))


@router.delete("/{group_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_device_group(
    tenant_id: UUID,
    group_id: UUID,
    session: Annotated[RLSSession, Depends(get_session)],
    current_tenant: Annotated[UUID, Depends(get_current_tenant)],
):
    """Delete a device group."""
    if str(tenant_id) != str(current_tenant):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Tenant mismatch")
    
    await session.set_tenant_context(tenant_id)
    
    result = await session.execute(
        select(DeviceGroup).where(
            DeviceGroup.tenant_id == tenant_id,
            DeviceGroup.id == group_id
        )
    )
    group = result.scalar_one_or_none()
    
    if not group:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Device group not found")
    
    await session.delete(group)
    await session.commit()


@router.get("/{group_id}/devices", response_model=SuccessResponse)
async def list_group_devices(
    tenant_id: UUID,
    group_id: UUID,
    session: Annotated[RLSSession, Depends(get_session)],
    current_tenant: Annotated[UUID, Depends(get_current_tenant)],
    page: int = Query(1, ge=1),
    per_page: int = Query(50, ge=1, le=100),
):
    """List all devices in a device group."""
    if str(tenant_id) != str(current_tenant):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Tenant mismatch")
    
    await session.set_tenant_context(tenant_id)
    
    # Verify group exists
    group_result = await session.execute(
        select(DeviceGroup).where(
            DeviceGroup.tenant_id == tenant_id,
            DeviceGroup.id == group_id
        )
    )
    if not group_result.scalar_one_or_none():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Device group not found")
    
    # Query devices
    query = select(Device).where(
        Device.tenant_id == tenant_id,
        Device.device_group_id == group_id
    ).order_by(Device.created_at.desc())
    
    # Count
    count_query = select(func.count()).select_from(Device).where(
        Device.tenant_id == tenant_id,
        Device.device_group_id == group_id
    )
    total_result = await session.execute(count_query)
    total = total_result.scalar() or 0
    
    # Paginate
    query = query.offset((page - 1) * per_page).limit(per_page)
    result = await session.execute(query)
    devices = result.scalars().all()
    
    return SuccessResponse(
        data=[{
            "id": str(d.id),
            "name": d.name,
            "device_type": d.device_type,
            "status": d.status,
            "last_seen": d.last_seen.isoformat() if d.last_seen else None,
            "battery_level": d.battery_level,
            "signal_strength": d.signal_strength,
        } for d in devices],
        meta=PaginationMeta(page=page, per_page=per_page, total=total)
    )
