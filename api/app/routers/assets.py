"""Assets API - the monitored physical thing, nestable, with devices attached.

Tenant isolation is carried in application code, not by RLS: this deployment
connects as the database owner so RLS policies do not enforce. Every handler
therefore does `validate_tenant_access` -> 403, `set_tenant_context`, and an
explicit `WHERE tenant_id` predicate. Do not rely on RLS here.

The asset tree is served at `/tree` by this router and is deliberately **not**
folded into `GET /tenants/{id}/hierarchy` — that endpoint has a documented
"Org->Site->DeviceGroup in 5 flat queries" contract and a live consumer
(HierarchyCanvas), and widening its shape would make this change non-additive.
"""

from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy import select, func
from typing import Annotated, Optional
from uuid import UUID
from datetime import datetime

from app.database import get_session, RLSSession
from app.services.tenant_access import validate_tenant_access
from app.services.asset_tree import AssetTreeError, validate_parent, tree_with_rollups
from app.models.asset import Asset
from app.models.site import Site
from app.models.base import Device
from app.schemas.common import SuccessResponse, PaginationMeta
from app.schemas.asset import AssetCreate, AssetUpdate, AssetResponse, AssetTreeNode
from app.schemas.device import DeviceResponse
from app.dependencies import get_current_tenant

router = APIRouter(prefix="/tenants/{tenant_id}/assets", tags=["assets"])


async def _guard(session: RLSSession, current_tenant: UUID, tenant_id: UUID) -> None:
    """The isolation preamble every handler in this router runs."""
    if not await validate_tenant_access(session, current_tenant, tenant_id):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Tenant access denied")
    await session.set_tenant_context(tenant_id)


async def _get_owned(session: RLSSession, tenant_id: UUID, asset_id: UUID) -> Asset:
    result = await session.execute(
        select(Asset).where(Asset.tenant_id == tenant_id, Asset.id == asset_id)
    )
    asset = result.scalar_one_or_none()
    if not asset:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Asset not found")
    return asset


@router.get("", response_model=SuccessResponse)
async def list_assets(
    tenant_id: UUID,
    session: Annotated[RLSSession, Depends(get_session)],
    current_tenant: Annotated[UUID, Depends(get_current_tenant)],
    page: int = Query(1, ge=1),
    per_page: int = Query(50, ge=1, le=100),
    site_id: Optional[UUID] = Query(None),
    parent_id: Optional[UUID] = Query(None),
    asset_type: Optional[str] = Query(None),
):
    """List assets for a tenant, with optional filtering."""
    await _guard(session, current_tenant, tenant_id)

    query = select(Asset).where(Asset.tenant_id == tenant_id)
    count_query = select(func.count()).select_from(Asset).where(Asset.tenant_id == tenant_id)

    for column, value in (
        (Asset.site_id, site_id),
        (Asset.parent_id, parent_id),
        (Asset.asset_type, asset_type),
    ):
        if value is not None:
            query = query.where(column == value)
            count_query = count_query.where(column == value)

    total = (await session.execute(count_query)).scalar() or 0

    query = query.order_by(Asset.name).offset((page - 1) * per_page).limit(per_page)
    assets = (await session.execute(query)).scalars().all()

    return SuccessResponse(
        data=[AssetResponse.model_validate(a) for a in assets],
        meta=PaginationMeta(page=page, per_page=per_page, total=total),
    )


@router.get("/tree", response_model=SuccessResponse)
async def get_asset_tree(
    tenant_id: UUID,
    session: Annotated[RLSSession, Depends(get_session)],
    current_tenant: Annotated[UUID, Depends(get_current_tenant)],
):
    """The tenant's assets with subtree-inclusive device and alarm rollups.

    Declared before `/{asset_id}` so "tree" is not captured as a UUID path param.
    """
    await _guard(session, current_tenant, tenant_id)
    rows = await tree_with_rollups(session, tenant_id)
    return SuccessResponse(data=[AssetTreeNode.model_validate(r) for r in rows])


@router.post("", response_model=SuccessResponse, status_code=status.HTTP_201_CREATED)
async def create_asset(
    tenant_id: UUID,
    asset_data: AssetCreate,
    session: Annotated[RLSSession, Depends(get_session)],
    current_tenant: Annotated[UUID, Depends(get_current_tenant)],
):
    """Create an asset."""
    await _guard(session, current_tenant, tenant_id)

    site = await session.execute(
        select(Site.id).where(Site.tenant_id == tenant_id, Site.id == asset_data.site_id)
    )
    if site.scalar_one_or_none() is None:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Site not found"
        )

    try:
        await validate_parent(session, tenant_id, asset_data.parent_id, asset_id=None)
    except AssetTreeError as e:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(e))

    asset = Asset(
        tenant_id=tenant_id,
        site_id=asset_data.site_id,
        parent_id=asset_data.parent_id,
        name=asset_data.name,
        description=asset_data.description,
        asset_type=asset_data.asset_type,
        attributes=asset_data.attributes,
    )
    session.add(asset)
    await session.commit()
    await session.refresh(asset)

    return SuccessResponse(data=AssetResponse.model_validate(asset))


@router.get("/{asset_id}", response_model=SuccessResponse)
async def get_asset(
    tenant_id: UUID,
    asset_id: UUID,
    session: Annotated[RLSSession, Depends(get_session)],
    current_tenant: Annotated[UUID, Depends(get_current_tenant)],
):
    """Get one asset."""
    await _guard(session, current_tenant, tenant_id)
    asset = await _get_owned(session, tenant_id, asset_id)
    return SuccessResponse(data=AssetResponse.model_validate(asset))


@router.get("/{asset_id}/devices", response_model=SuccessResponse)
async def list_asset_devices(
    tenant_id: UUID,
    asset_id: UUID,
    session: Annotated[RLSSession, Depends(get_session)],
    current_tenant: Annotated[UUID, Depends(get_current_tenant)],
    page: int = Query(1, ge=1),
    per_page: int = Query(50, ge=1, le=100),
):
    """Devices attached directly to this asset (not its descendants')."""
    await _guard(session, current_tenant, tenant_id)
    await _get_owned(session, tenant_id, asset_id)

    total = (
        await session.execute(
            select(func.count())
            .select_from(Device)
            .where(Device.tenant_id == tenant_id, Device.asset_id == asset_id)
        )
    ).scalar() or 0

    devices = (
        (
            await session.execute(
                select(Device)
                .where(Device.tenant_id == tenant_id, Device.asset_id == asset_id)
                .order_by(Device.name)
                .offset((page - 1) * per_page)
                .limit(per_page)
            )
        )
        .scalars()
        .all()
    )

    return SuccessResponse(
        data=[DeviceResponse.model_validate(d) for d in devices],
        meta=PaginationMeta(page=page, per_page=per_page, total=total),
    )


@router.put("/{asset_id}", response_model=SuccessResponse)
async def update_asset(
    tenant_id: UUID,
    asset_id: UUID,
    asset_data: AssetUpdate,
    session: Annotated[RLSSession, Depends(get_session)],
    current_tenant: Annotated[UUID, Depends(get_current_tenant)],
):
    """Update an asset. Re-parenting is validated against cycles and the depth cap."""
    await _guard(session, current_tenant, tenant_id)
    asset = await _get_owned(session, tenant_id, asset_id)

    update_data = asset_data.model_dump(exclude_unset=True)

    if "site_id" in update_data and update_data["site_id"] is not None:
        site = await session.execute(
            select(Site.id).where(Site.tenant_id == tenant_id, Site.id == update_data["site_id"])
        )
        if site.scalar_one_or_none() is None:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Site not found"
            )

    # Only validate when the caller actually sent parent_id — `exclude_unset` is what
    # separates "make this a root" (explicit null) from "leave the parent alone".
    if "parent_id" in update_data:
        try:
            await validate_parent(session, tenant_id, update_data["parent_id"], asset_id=asset_id)
        except AssetTreeError as e:
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(e))

    for field, value in update_data.items():
        setattr(asset, field, value)
    asset.updated_at = datetime.utcnow()

    await session.commit()
    await session.refresh(asset)

    return SuccessResponse(data=AssetResponse.model_validate(asset))


@router.delete("/{asset_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_asset(
    tenant_id: UUID,
    asset_id: UUID,
    session: Annotated[RLSSession, Depends(get_session)],
    current_tenant: Annotated[UUID, Depends(get_current_tenant)],
):
    """Delete an asset.

    Descendant assets go with it (`parent_id` CASCADE); the devices attached to any
    of them are **detached, never deleted** (`devices.asset_id` SET NULL).
    """
    await _guard(session, current_tenant, tenant_id)
    asset = await _get_owned(session, tenant_id, asset_id)

    await session.delete(asset)
    await session.commit()
    return None
