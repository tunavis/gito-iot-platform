"""Device management routes - CRUD operations with RLS enforcement."""

from fastapi import APIRouter, Depends, HTTPException, status, Query, Header
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession
from typing import Annotated, Optional
from uuid import UUID
from datetime import datetime
import logging

from app.database import get_session, RLSSession
from app.models.base import Device
from app.schemas.device import DeviceCreate, DeviceUpdate, DeviceResponse
from app.schemas.common import SuccessResponse, PaginationMeta
from app.security import decode_token
from app.services.device_management import DeviceManagementService

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/tenants/{tenant_id}/devices", tags=["devices"])


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
async def list_devices(
    tenant_id: UUID,
    session: Annotated[RLSSession, Depends(get_session)],
    current_tenant: Annotated[UUID, Depends(get_current_tenant)] = None,
    page: int = Query(1, ge=1),
    per_page: int = Query(50, ge=1, le=100),
    organization_id: Optional[UUID] = Query(None),
    site_id: Optional[UUID] = Query(None),
    device_group_id: Optional[UUID] = Query(None),
):
    """List all devices for tenant with pagination and optional hierarchy filtering.

    RLS ensures user can only see their tenant's devices.
    """
    if str(tenant_id) != str(current_tenant):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Tenant mismatch",
        )

    await session.set_tenant_context(tenant_id)

    # Build query with optional filters
    base_filter = Device.tenant_id == tenant_id
    query = select(Device).where(base_filter)
    count_query = select(func.count(Device.id)).where(base_filter)

    if organization_id:
        query = query.where(Device.organization_id == organization_id)
        count_query = count_query.where(Device.organization_id == organization_id)
    if site_id:
        query = query.where(Device.site_id == site_id)
        count_query = count_query.where(Device.site_id == site_id)
    if device_group_id:
        query = query.where(Device.device_group_id == device_group_id)
        count_query = count_query.where(Device.device_group_id == device_group_id)

    count_result = await session.execute(count_query)
    total = count_result.scalar() or 0

    offset = (page - 1) * per_page
    query = query.offset(offset).limit(per_page).order_by(Device.created_at.desc())

    result = await session.execute(query)
    devices = result.scalars().all()

    return SuccessResponse(
        data=[DeviceResponse.model_validate(d) for d in devices],
        meta=PaginationMeta(page=page, per_page=per_page, total=total),
    )


@router.post("", response_model=SuccessResponse, status_code=status.HTTP_201_CREATED)
async def create_device(
    tenant_id: UUID,
    device_data: DeviceCreate,
    session: Annotated[RLSSession, Depends(get_session)],
    current_tenant: Annotated[UUID, Depends(get_current_tenant)] = None,
):
    """Create new device for tenant.

    GPS coordinates (latitude/longitude) are merged into the attributes JSONB field.
    Automatically syncs with TTN Server if LoRaWAN fields provided.
    """
    if str(tenant_id) != str(current_tenant):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Tenant mismatch",
        )

    await session.set_tenant_context(tenant_id)

    # Merge GPS coordinates into attributes
    attrs = dict(device_data.attributes) if device_data.attributes else {}
    if device_data.latitude is not None:
        attrs["latitude"] = device_data.latitude
    if device_data.longitude is not None:
        attrs["longitude"] = device_data.longitude
    if device_data.serial_number:
        attrs["serial_number"] = device_data.serial_number
    if device_data.mqtt_client_id:
        attrs["mqtt_client_id"] = device_data.mqtt_client_id
    if device_data.app_key:
        attrs["app_key"] = device_data.app_key

    device = Device(
        tenant_id=tenant_id,
        name=device_data.name,
        device_type=device_data.device_type,
        device_type_id=device_data.device_type_id,
        description=device_data.description,
        serial_number=device_data.serial_number,
        tags=device_data.tags or [],
        organization_id=device_data.organization_id,
        site_id=device_data.site_id,
        device_group_id=device_data.device_group_id,
        dev_eui=device_data.dev_eui,
        ttn_app_id=device_data.ttn_app_id,
        device_profile_id=device_data.device_profile_id,
        attributes=attrs,
        status="offline",
    )

    session.add(device)
    await session.commit()
    await session.refresh(device)

    # Trigger async ChirpStack/TTN sync if LoRaWAN fields present
    if device_data.dev_eui or device_data.ttn_app_id:
        device_mgmt = DeviceManagementService(session)
        try:
            await device_mgmt.sync_to_chirpstack(device, is_update=False)
        except Exception as e:
            logger.error(
                "chirpstack_sync_failed_on_create",
                extra={
                    "tenant_id": str(tenant_id),
                    "device_id": str(device.id),
                    "error": str(e),
                },
            )

    return SuccessResponse(data=DeviceResponse.model_validate(device))


@router.get("/{device_id}", response_model=SuccessResponse)
async def get_device(
    tenant_id: UUID,
    device_id: UUID,
    session: Annotated[RLSSession, Depends(get_session)],
    current_tenant: Annotated[UUID, Depends(get_current_tenant)] = None,
):
    """Get device details by ID."""
    if str(tenant_id) != str(current_tenant):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Tenant mismatch",
        )

    await session.set_tenant_context(tenant_id)

    query = select(Device).where(
        Device.tenant_id == tenant_id,
        Device.id == device_id,
    )
    result = await session.execute(query)
    device = result.scalar_one_or_none()

    if not device:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Device not found",
        )

    return SuccessResponse(data=DeviceResponse.model_validate(device))


@router.put("/{device_id}", response_model=SuccessResponse)
async def update_device(
    tenant_id: UUID,
    device_id: UUID,
    device_data: DeviceUpdate,
    session: Annotated[RLSSession, Depends(get_session)],
    current_tenant: Annotated[UUID, Depends(get_current_tenant)] = None,
):
    """Update device details."""
    if str(tenant_id) != str(current_tenant):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Tenant mismatch",
        )

    await session.set_tenant_context(tenant_id)

    query = select(Device).where(
        Device.tenant_id == tenant_id,
        Device.id == device_id,
    )
    result = await session.execute(query)
    device = result.scalar_one_or_none()

    if not device:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Device not found",
        )

    if device_data.name is not None:
        device.name = device_data.name
    if device_data.description is not None:
        device.description = device_data.description
    if device_data.serial_number is not None:
        device.serial_number = device_data.serial_number
    if device_data.tags is not None:
        device.tags = device_data.tags
    if device_data.attributes is not None:
        device.attributes = device_data.attributes
    if device_data.organization_id is not None:
        device.organization_id = device_data.organization_id
    if device_data.site_id is not None:
        device.site_id = device_data.site_id
    if device_data.device_group_id is not None:
        device.device_group_id = device_data.device_group_id
    if device_data.dev_eui is not None:
        device.dev_eui = device_data.dev_eui
    if device_data.ttn_app_id is not None:
        device.ttn_app_id = device_data.ttn_app_id
    if device_data.device_profile_id is not None:
        device.device_profile_id = device_data.device_profile_id

    device.updated_at = datetime.utcnow()
    await session.commit()
    await session.refresh(device)

    # Trigger async TTN sync if LoRaWAN fields were updated
    has_lorawan_update = (
        device_data.dev_eui is not None
        or device_data.ttn_app_id is not None
        or device_data.device_profile_id is not None
    )
    if has_lorawan_update:
        device_mgmt = DeviceManagementService(session)
        try:
            await device_mgmt.sync_to_chirpstack(device, is_update=True)
        except Exception as e:
            logger.error(
                "chirpstack_sync_failed_on_update",
                extra={
                    "tenant_id": str(tenant_id),
                    "device_id": str(device.id),
                    "error": str(e),
                },
            )

    return SuccessResponse(data=DeviceResponse.model_validate(device))


@router.delete("/{device_id}", response_model=SuccessResponse)
async def delete_device(
    tenant_id: UUID,
    device_id: UUID,
    session: Annotated[RLSSession, Depends(get_session)],
    current_tenant: Annotated[UUID, Depends(get_current_tenant)] = None,
):
    """Delete device by ID."""
    if str(tenant_id) != str(current_tenant):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Tenant mismatch",
        )

    await session.set_tenant_context(tenant_id)

    query = select(Device).where(
        Device.tenant_id == tenant_id,
        Device.id == device_id,
    )
    result = await session.execute(query)
    device = result.scalar_one_or_none()

    if not device:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Device not found",
        )

    # Trigger ChirpStack/TTN delete if synced
    if device.ttn_synced:
        device_mgmt = DeviceManagementService(session)
        try:
            await device_mgmt.delete_from_chirpstack(device)
        except Exception as e:
            logger.error(
                "chirpstack_delete_failed",
                extra={
                    "tenant_id": str(tenant_id),
                    "device_id": str(device.id),
                    "error": str(e),
                },
            )

    await session.delete(device)
    await session.commit()

    return SuccessResponse(data={"message": "Device deleted"})


# ============================================================================
# BULK OPERATIONS
# ============================================================================

from pydantic import BaseModel
from typing import List

class BulkDeleteRequest(BaseModel):
    device_ids: List[UUID]

class BulkAssignGroupRequest(BaseModel):
    device_ids: List[UUID]
    device_group_id: Optional[UUID] = None


@router.post("/bulk/delete", response_model=SuccessResponse)
async def bulk_delete_devices(
    tenant_id: UUID,
    request: BulkDeleteRequest,
    session: Annotated[RLSSession, Depends(get_session)],
    current_tenant: Annotated[UUID, Depends(get_current_tenant)],
):
    """Bulk delete multiple devices."""
    if str(tenant_id) != str(current_tenant):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Tenant mismatch")

    await session.set_tenant_context(tenant_id)

    query = select(Device).where(
        Device.tenant_id == tenant_id,
        Device.id.in_(request.device_ids)
    )
    result = await session.execute(query)
    devices = result.scalars().all()

    if not devices:
        return SuccessResponse(data={"deleted_count": 0, "message": "No devices found"})

    for device in devices:
        await session.delete(device)

    await session.commit()

    return SuccessResponse(data={
        "deleted_count": len(devices),
        "message": f"Successfully deleted {len(devices)} device(s)"
    })


@router.post("/bulk/assign-group", response_model=SuccessResponse)
async def bulk_assign_device_group(
    tenant_id: UUID,
    request: BulkAssignGroupRequest,
    session: Annotated[RLSSession, Depends(get_session)],
    current_tenant: Annotated[UUID, Depends(get_current_tenant)],
):
    """Bulk assign devices to a device group."""
    if str(tenant_id) != str(current_tenant):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Tenant mismatch")

    await session.set_tenant_context(tenant_id)

    if request.device_group_id:
        from app.models.device_group import DeviceGroup
        group_query = select(DeviceGroup).where(
            DeviceGroup.tenant_id == tenant_id,
            DeviceGroup.id == request.device_group_id
        )
        group_result = await session.execute(group_query)
        if not group_result.scalar_one_or_none():
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Device group not found")

    query = select(Device).where(
        Device.tenant_id == tenant_id,
        Device.id.in_(request.device_ids)
    )
    result = await session.execute(query)
    devices = result.scalars().all()

    if not devices:
        return SuccessResponse(data={"updated_count": 0, "message": "No devices found"})

    for device in devices:
        device.device_group_id = request.device_group_id
        device.updated_at = datetime.utcnow()

    await session.commit()

    action = "assigned to group" if request.device_group_id else "unassigned from groups"
    return SuccessResponse(data={
        "updated_count": len(devices),
        "message": f"Successfully {action} for {len(devices)} device(s)"
    })
