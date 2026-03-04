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
from typing import Annotated, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status, Query, Header
from sqlalchemy import select, func, and_, text

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


async def _fetch_device_counts(session: RLSSession, device_type_ids: list[UUID]) -> dict[str, int]:
    """Return a {device_type_id_str: count} map using a single parameterised query."""
    if not device_type_ids:
        return {}
    # Build :id0, :id1, ... placeholders — safe, no f-string SQL injection
    placeholders = ", ".join(f":id{i}" for i in range(len(device_type_ids)))
    params = {f"id{i}": str(uid) for i, uid in enumerate(device_type_ids)}
    result = await session.execute(
        text(
            f"SELECT device_type_id::text, COUNT(*) "
            f"FROM devices WHERE device_type_id::text IN ({placeholders}) "
            f"GROUP BY device_type_id"
        ),
        params,
    )
    return {row[0]: int(row[1]) for row in result}


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
    device_types = list(result.scalars().all())

    # Enrich with live device counts (one batch query)
    counts = await _fetch_device_counts(session, [dt.id for dt in device_types])
    for dt in device_types:
        dt.device_count = counts.get(str(dt.id), 0)

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

    # Serialise data_model preserving min/max aliases
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

    capabilities_json = device_type_data.capabilities or []

    default_settings_json = None
    if device_type_data.default_settings:
        default_settings_json = device_type_data.default_settings.model_dump()

    connectivity_json = None
    if device_type_data.connectivity:
        connectivity_json = device_type_data.connectivity.model_dump()

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

    device_type.device_count = 0  # brand-new type has no devices yet

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

    # Live device count
    cnt_result = await session.execute(
        text("SELECT COUNT(*) FROM devices WHERE device_type_id = :id"),
        {"id": str(device_type_id)},
    )
    device_type.device_count = cnt_result.scalar() or 0

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

    update_dict = update_data.model_dump(exclude_unset=True)

    # Handle nested objects
    if "data_model" in update_dict and update_data.data_model is not None:
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

    # metadata in the schema maps to extra_metadata on the model
    if "metadata" in update_dict:
        device_type.extra_metadata = update_dict.pop("metadata")

    for key, value in update_dict.items():
        if hasattr(device_type, key):
            setattr(device_type, key, value)

    await session.commit()
    await session.refresh(device_type)

    # Live device count
    cnt_result = await session.execute(
        text("SELECT COUNT(*) FROM devices WHERE device_type_id = :id"),
        {"id": str(device_type_id)},
    )
    device_type.device_count = cnt_result.scalar() or 0

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

    # Live device count — the cached column is unreliable
    cnt_result = await session.execute(
        text("SELECT COUNT(*) FROM devices WHERE device_type_id = :id"),
        {"id": str(device_type_id)},
    )
    live_count = cnt_result.scalar() or 0

    if not force and live_count > 0:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Cannot delete device type with {live_count} assigned devices. Use force=true to delete anyway.",
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

    clone.device_count = 0  # brand-new clone has no devices

    return SuccessResponse(
        success=True,
        data=DeviceTypeResponse.model_validate(clone),
        message="Device type cloned successfully",
    )


# ============================================================================
# DISCOVERED METRICS
# ============================================================================

@router.get("/{device_type_id}/discovered-metrics")
async def get_discovered_metrics(
    tenant_id: UUID,
    device_type_id: UUID,
    session: Annotated[RLSSession, Depends(get_session)],
    current_tenant: Annotated[UUID, Depends(get_current_tenant)],
    days: int = Query(7, ge=1, le=30, description="Look back N days"),
) -> SuccessResponse:
    """List metrics actually received from devices of this type.

    Compares discovered metric keys against the device type's data_model
    so users can see which MQTT payload keys match their schema and which
    are missing.
    """
    await session.set_tenant_context(current_tenant)

    # Verify device type exists and load its data_model
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

    # Schema field names from data_model
    schema_fields: set[str] = set()
    if device_type.data_model:
        for field in device_type.data_model:
            if isinstance(field, dict) and "name" in field:
                schema_fields.add(field["name"])

    # Total devices of this type
    cnt_result = await session.execute(
        text("SELECT COUNT(*) FROM devices WHERE device_type_id = :id AND tenant_id = :tid"),
        {"id": str(device_type_id), "tid": str(current_tenant)},
    )
    total_devices = cnt_result.scalar() or 0

    # Discover metrics from telemetry across all devices of this type
    query_sql = """
    SELECT
        metric_key,
        COUNT(DISTINCT device_id)::integer AS device_count,
        MAX(ts) AS last_seen
    FROM telemetry
    WHERE tenant_id = :tenant_id
      AND device_id = ANY(
        SELECT id FROM devices
        WHERE device_type_id = :device_type_id AND tenant_id = :tenant_id
      )
      AND ts >= NOW() - make_interval(days => :days)
    GROUP BY metric_key
    ORDER BY metric_key
    """

    try:
        rows = (await session.execute(text(query_sql), {
            "tenant_id": str(current_tenant),
            "device_type_id": str(device_type_id),
            "days": days,
        })).fetchall()

        metrics = [
            {
                "key": row[0],
                "device_count": row[1],
                "last_seen": row[2].isoformat() if row[2] else None,
                "in_schema": row[0] in schema_fields,
            }
            for row in rows
        ]

        return SuccessResponse(data={
            "metrics": metrics,
            "total_devices": total_devices,
            "schema_fields": sorted(schema_fields),
        })

    except Exception as e:
        logger.error(f"Discovered metrics query failed: {e}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Query error: {type(e).__name__}",
        )