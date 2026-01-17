"""Sites API - Physical location management with nested hierarchy."""

from fastapi import APIRouter, Depends, HTTPException, status, Query, Header
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession
from typing import Annotated, Optional
from uuid import UUID
from datetime import datetime
from pydantic import BaseModel, Field

from app.database import get_session, RLSSession
from app.models.site import Site
from app.models.base import Device
from app.schemas.common import SuccessResponse, PaginationMeta
from app.security import decode_token

router = APIRouter(prefix="/tenants/{tenant_id}/sites", tags=["sites"])


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


# Schemas
class SiteCreate(BaseModel):
    organization_id: UUID
    parent_site_id: Optional[UUID] = None
    name: str = Field(..., min_length=1, max_length=255)
    site_type: Optional[str] = Field(None, max_length=50)
    address: Optional[str] = None
    coordinates: Optional[dict] = None  # {"lat": 51.5074, "lng": -0.1278}
    timezone: str = Field(default="UTC", max_length=50)
    attributes: dict = Field(default_factory=dict)


class SiteUpdate(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=255)
    site_type: Optional[str] = Field(None, max_length=50)
    address: Optional[str] = None
    coordinates: Optional[dict] = None
    timezone: Optional[str] = Field(None, max_length=50)
    attributes: Optional[dict] = None


class SiteResponse(BaseModel):
    id: UUID
    tenant_id: UUID
    organization_id: UUID
    parent_site_id: Optional[UUID]
    name: str
    site_type: Optional[str]
    address: Optional[str]
    coordinates: Optional[dict]
    timezone: str
    attributes: dict
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


@router.get("", response_model=SuccessResponse)
async def list_sites(
    tenant_id: UUID,
    session: Annotated[RLSSession, Depends(get_session)],
    current_tenant: Annotated[UUID, Depends(get_current_tenant)],
    page: int = Query(1, ge=1),
    per_page: int = Query(50, ge=1, le=100),
    organization_id: Optional[UUID] = Query(None),
    site_type: Optional[str] = Query(None),
    parent_site_id: Optional[UUID] = Query(None),
):
    """List all sites for a tenant with optional filtering."""
    if str(tenant_id) != str(current_tenant):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Tenant mismatch")
    
    await session.set_tenant_context(tenant_id)
    
    # Build query
    query = select(Site).where(Site.tenant_id == tenant_id)
    
    if organization_id:
        query = query.where(Site.organization_id == organization_id)
    if site_type:
        query = query.where(Site.site_type == site_type)
    if parent_site_id:
        query = query.where(Site.parent_site_id == parent_site_id)
    
    query = query.order_by(Site.created_at.desc())
    
    # Count total
    count_query = select(func.count()).select_from(Site).where(Site.tenant_id == tenant_id)
    if organization_id:
        count_query = count_query.where(Site.organization_id == organization_id)
    if site_type:
        count_query = count_query.where(Site.site_type == site_type)
    if parent_site_id:
        count_query = count_query.where(Site.parent_site_id == parent_site_id)
    
    total_result = await session.execute(count_query)
    total = total_result.scalar() or 0
    
    # Paginate
    query = query.offset((page - 1) * per_page).limit(per_page)
    result = await session.execute(query)
    sites = result.scalars().all()
    
    return SuccessResponse(
        data=[SiteResponse.from_orm(site) for site in sites],
        meta=PaginationMeta(page=page, per_page=per_page, total=total)
    )


@router.post("", response_model=SuccessResponse, status_code=status.HTTP_201_CREATED)
async def create_site(
    tenant_id: UUID,
    site_data: SiteCreate,
    session: Annotated[RLSSession, Depends(get_session)],
    current_tenant: Annotated[UUID, Depends(get_current_tenant)],
):
    """Create a new site."""
    if str(tenant_id) != str(current_tenant):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Tenant mismatch")
    
    await session.set_tenant_context(tenant_id)
    
    # Validate parent site exists if provided
    if site_data.parent_site_id:
        parent_result = await session.execute(
            select(Site).where(
                Site.tenant_id == tenant_id,
                Site.id == site_data.parent_site_id
            )
        )
        if not parent_result.scalar_one_or_none():
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Parent site not found"
            )
    
    # Create site
    site = Site(
        tenant_id=tenant_id,
        organization_id=site_data.organization_id,
        parent_site_id=site_data.parent_site_id,
        name=site_data.name,
        site_type=site_data.site_type,
        address=site_data.address,
        coordinates=site_data.coordinates,
        timezone=site_data.timezone,
        attributes=site_data.attributes,
    )
    
    session.add(site)
    await session.commit()
    await session.refresh(site)
    
    return SuccessResponse(data=SiteResponse.from_orm(site))


@router.get("/{site_id}", response_model=SuccessResponse)
async def get_site(
    tenant_id: UUID,
    site_id: UUID,
    session: Annotated[RLSSession, Depends(get_session)],
    current_tenant: Annotated[UUID, Depends(get_current_tenant)],
):
    """Get a specific site."""
    if str(tenant_id) != str(current_tenant):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Tenant mismatch")
    
    await session.set_tenant_context(tenant_id)
    
    result = await session.execute(
        select(Site).where(
            Site.tenant_id == tenant_id,
            Site.id == site_id
        )
    )
    site = result.scalar_one_or_none()
    
    if not site:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Site not found")
    
    return SuccessResponse(data=SiteResponse.from_orm(site))


@router.put("/{site_id}", response_model=SuccessResponse)
async def update_site(
    tenant_id: UUID,
    site_id: UUID,
    site_data: SiteUpdate,
    session: Annotated[RLSSession, Depends(get_session)],
    current_tenant: Annotated[UUID, Depends(get_current_tenant)],
):
    """Update a site."""
    if str(tenant_id) != str(current_tenant):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Tenant mismatch")
    
    await session.set_tenant_context(tenant_id)
    
    result = await session.execute(
        select(Site).where(
            Site.tenant_id == tenant_id,
            Site.id == site_id
        )
    )
    site = result.scalar_one_or_none()
    
    if not site:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Site not found")
    
    # Update fields
    update_data = site_data.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(site, field, value)
    
    site.updated_at = datetime.utcnow()
    
    await session.commit()
    await session.refresh(site)
    
    return SuccessResponse(data=SiteResponse.from_orm(site))


@router.delete("/{site_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_site(
    tenant_id: UUID,
    site_id: UUID,
    session: Annotated[RLSSession, Depends(get_session)],
    current_tenant: Annotated[UUID, Depends(get_current_tenant)],
):
    """Delete a site."""
    if str(tenant_id) != str(current_tenant):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Tenant mismatch")
    
    await session.set_tenant_context(tenant_id)
    
    result = await session.execute(
        select(Site).where(
            Site.tenant_id == tenant_id,
            Site.id == site_id
        )
    )
    site = result.scalar_one_or_none()
    
    if not site:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Site not found")
    
    await session.delete(site)
    await session.commit()


@router.get("/{site_id}/devices", response_model=SuccessResponse)
async def list_site_devices(
    tenant_id: UUID,
    site_id: UUID,
    session: Annotated[RLSSession, Depends(get_session)],
    current_tenant: Annotated[UUID, Depends(get_current_tenant)],
    page: int = Query(1, ge=1),
    per_page: int = Query(50, ge=1, le=100),
):
    """List all devices at a site."""
    if str(tenant_id) != str(current_tenant):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Tenant mismatch")
    
    await session.set_tenant_context(tenant_id)
    
    # Verify site exists
    site_result = await session.execute(
        select(Site).where(
            Site.tenant_id == tenant_id,
            Site.id == site_id
        )
    )
    if not site_result.scalar_one_or_none():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Site not found")
    
    # Query devices
    query = select(Device).where(
        Device.tenant_id == tenant_id,
        Device.site_id == site_id
    ).order_by(Device.created_at.desc())
    
    # Count
    count_query = select(func.count()).select_from(Device).where(
        Device.tenant_id == tenant_id,
        Device.site_id == site_id
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


@router.get("/{site_id}/children", response_model=SuccessResponse)
async def list_child_sites(
    tenant_id: UUID,
    site_id: UUID,
    session: Annotated[RLSSession, Depends(get_session)],
    current_tenant: Annotated[UUID, Depends(get_current_tenant)],
):
    """List all child sites (nested hierarchy)."""
    if str(tenant_id) != str(current_tenant):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Tenant mismatch")
    
    await session.set_tenant_context(tenant_id)
    
    # Verify parent site exists
    parent_result = await session.execute(
        select(Site).where(
            Site.tenant_id == tenant_id,
            Site.id == site_id
        )
    )
    if not parent_result.scalar_one_or_none():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Site not found")
    
    # Get child sites
    result = await session.execute(
        select(Site).where(
            Site.tenant_id == tenant_id,
            Site.parent_site_id == site_id
        ).order_by(Site.name)
    )
    children = result.scalars().all()
    
    return SuccessResponse(data=[SiteResponse.from_orm(site) for site in children])
