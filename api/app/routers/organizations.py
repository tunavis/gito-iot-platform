"""Organizations API - Sub-customer management within tenants."""

from fastapi import APIRouter, Depends, HTTPException, status, Query, Header
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession
from typing import Annotated, Optional
from uuid import UUID
from datetime import datetime

from app.database import get_session, RLSSession
from app.models.organization import Organization
from app.models.base import Device
from app.schemas.common import SuccessResponse, PaginationMeta
from app.schemas.organization import OrganizationCreate, OrganizationUpdate, OrganizationResponse
from app.security import decode_token

router = APIRouter(prefix="/tenants/{tenant_id}/organizations", tags=["organizations"])


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


@router.get("", response_model=SuccessResponse)
async def list_organizations(
    tenant_id: UUID,
    session: Annotated[RLSSession, Depends(get_session)],
    current_tenant: Annotated[UUID, Depends(get_current_tenant)],
    page: int = Query(1, ge=1),
    per_page: int = Query(50, ge=1, le=100),
    status: Optional[str] = Query(None, pattern="^(active|inactive|suspended)$"),
):
    """List all organizations for a tenant."""
    if str(tenant_id) != str(current_tenant):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Tenant mismatch")
    
    await session.set_tenant_context(tenant_id)
    
    # Build query
    query = select(Organization).where(Organization.tenant_id == tenant_id)
    
    if status:
        query = query.where(Organization.status == status)
    
    query = query.order_by(Organization.created_at.desc())
    
    # Count total
    count_query = select(func.count()).select_from(Organization).where(Organization.tenant_id == tenant_id)
    if status:
        count_query = count_query.where(Organization.status == status)
    
    total_result = await session.execute(count_query)
    total = total_result.scalar() or 0
    
    # Paginate
    query = query.offset((page - 1) * per_page).limit(per_page)
    result = await session.execute(query)
    organizations = result.scalars().all()
    
    return SuccessResponse(
        data=[OrganizationResponse.model_validate(org) for org in organizations],
        meta=PaginationMeta(page=page, per_page=per_page, total=total)
    )


@router.post("", response_model=SuccessResponse, status_code=status.HTTP_201_CREATED)
async def create_organization(
    tenant_id: UUID,
    org_data: OrganizationCreate,
    session: Annotated[RLSSession, Depends(get_session)],
    current_tenant: Annotated[UUID, Depends(get_current_tenant)],
):
    """Create a new organization."""
    if str(tenant_id) != str(current_tenant):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Tenant mismatch")
    
    await session.set_tenant_context(tenant_id)
    
    # Check if slug already exists
    existing = await session.execute(
        select(Organization).where(
            Organization.tenant_id == tenant_id,
            Organization.slug == org_data.slug
        )
    )
    if existing.scalar_one_or_none():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Organization with slug '{org_data.slug}' already exists"
        )
    
    # Create organization
    org = Organization(
        tenant_id=tenant_id,
        name=org_data.name,
        slug=org_data.slug,
        description=org_data.description,
        billing_contact=org_data.billing_contact,
        chirpstack_app_id=org_data.chirpstack_app_id,
        attributes=org_data.attributes,
        status="active"
    )
    
    session.add(org)
    await session.commit()
    await session.refresh(org)
    
    return SuccessResponse(data=OrganizationResponse.model_validate(org))


@router.get("/{org_id}", response_model=SuccessResponse)
async def get_organization(
    tenant_id: UUID,
    org_id: UUID,
    session: Annotated[RLSSession, Depends(get_session)],
    current_tenant: Annotated[UUID, Depends(get_current_tenant)],
):
    """Get a specific organization."""
    if str(tenant_id) != str(current_tenant):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Tenant mismatch")
    
    await session.set_tenant_context(tenant_id)
    
    result = await session.execute(
        select(Organization).where(
            Organization.tenant_id == tenant_id,
            Organization.id == org_id
        )
    )
    org = result.scalar_one_or_none()
    
    if not org:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Organization not found")
    
    return SuccessResponse(data=OrganizationResponse.model_validate(org))


@router.put("/{org_id}", response_model=SuccessResponse)
async def update_organization(
    tenant_id: UUID,
    org_id: UUID,
    org_data: OrganizationUpdate,
    session: Annotated[RLSSession, Depends(get_session)],
    current_tenant: Annotated[UUID, Depends(get_current_tenant)],
):
    """Update an organization."""
    if str(tenant_id) != str(current_tenant):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Tenant mismatch")
    
    await session.set_tenant_context(tenant_id)
    
    result = await session.execute(
        select(Organization).where(
            Organization.tenant_id == tenant_id,
            Organization.id == org_id
        )
    )
    org = result.scalar_one_or_none()
    
    if not org:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Organization not found")
    
    # Update fields
    update_data = org_data.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(org, field, value)
    
    org.updated_at = datetime.utcnow()
    
    await session.commit()
    await session.refresh(org)
    
    return SuccessResponse(data=OrganizationResponse.model_validate(org))


@router.delete("/{org_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_organization(
    tenant_id: UUID,
    org_id: UUID,
    session: Annotated[RLSSession, Depends(get_session)],
    current_tenant: Annotated[UUID, Depends(get_current_tenant)],
):
    """Delete an organization."""
    if str(tenant_id) != str(current_tenant):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Tenant mismatch")
    
    await session.set_tenant_context(tenant_id)
    
    result = await session.execute(
        select(Organization).where(
            Organization.tenant_id == tenant_id,
            Organization.id == org_id
        )
    )
    org = result.scalar_one_or_none()
    
    if not org:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Organization not found")
    
    await session.delete(org)
    await session.commit()


@router.get("/{org_id}/devices", response_model=SuccessResponse)
async def list_organization_devices(
    tenant_id: UUID,
    org_id: UUID,
    session: Annotated[RLSSession, Depends(get_session)],
    current_tenant: Annotated[UUID, Depends(get_current_tenant)],
    page: int = Query(1, ge=1),
    per_page: int = Query(50, ge=1, le=100),
):
    """List all devices in an organization."""
    if str(tenant_id) != str(current_tenant):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Tenant mismatch")
    
    await session.set_tenant_context(tenant_id)
    
    # Verify org exists
    org_result = await session.execute(
        select(Organization).where(
            Organization.tenant_id == tenant_id,
            Organization.id == org_id
        )
    )
    if not org_result.scalar_one_or_none():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Organization not found")
    
    # Query devices
    query = select(Device).where(
        Device.tenant_id == tenant_id,
        Device.organization_id == org_id
    ).order_by(Device.created_at.desc())
    
    # Count
    count_query = select(func.count()).select_from(Device).where(
        Device.tenant_id == tenant_id,
        Device.organization_id == org_id
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
