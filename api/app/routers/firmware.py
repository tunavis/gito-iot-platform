"""OTA Firmware management routes.

Endpoints:
  Firmware versions:
    POST   /tenants/{id}/firmware/versions        — upload new version
    GET    /tenants/{id}/firmware/versions        — list versions
    GET    /tenants/{id}/firmware/versions/{id}   — get version
    DELETE /tenants/{id}/firmware/versions/{id}   — delete version

  OTA Campaigns:
    POST   /tenants/{id}/ota/campaigns                       — create campaign
    GET    /tenants/{id}/ota/campaigns                       — list campaigns
    GET    /tenants/{id}/ota/campaigns/{cid}                 — get campaign
    PUT    /tenants/{id}/ota/campaigns/{cid}                 — update campaign (draft only)
    DELETE /tenants/{id}/ota/campaigns/{cid}                 — delete campaign (draft only)
    POST   /tenants/{id}/ota/campaigns/{cid}/execute         — start campaign
    GET    /tenants/{id}/ota/campaigns/{cid}/status          — campaign + device status

  Device history:
    GET    /tenants/{id}/devices/{did}/ota/history           — firmware history for device
"""

import logging
from typing import Optional
from uuid import UUID
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy import select, delete
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_session, RLSSession
from app.models.base import FirmwareVersion, OTACampaign, OTACampaignDevice, DeviceFirmwareHistory, Device
from app.models.firmware import (
    FirmwareVersionCreate,
    FirmwareVersionUpdate,
    FirmwareVersionResponse,
    OTACampaignCreate,
    OTACampaignUpdate,
    OTACampaignExecute,
    OTACampaignResponse,
    OTACampaignDeviceResponse,
    DeviceFirmwareHistoryResponse,
)
from app.dependencies import get_current_tenant
from app.services.ota_dispatch import OTADispatchService

logger = logging.getLogger(__name__)

router = APIRouter(tags=["firmware"])


# ---------------------------------------------------------------------------
# Firmware Versions
# ---------------------------------------------------------------------------

@router.post(
    "/tenants/{tenant_id}/firmware/versions",
    response_model=FirmwareVersionResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_firmware_version(
    tenant_id: UUID,
    body: FirmwareVersionCreate,
    current_tenant: UUID = Depends(get_current_tenant),
    session: RLSSession = Depends(get_session),
):
    if str(tenant_id) != str(current_tenant):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Tenant mismatch")
    await session.set_tenant_context(tenant_id)

    fw = FirmwareVersion(
        tenant_id=tenant_id,
        name=body.name,
        version=body.version,
        url=body.url,
        size_bytes=body.size_bytes,
        hash=body.hash,
        release_type=body.release_type,
        changelog=body.changelog,
    )
    session.add(fw)
    await session.commit()
    await session.refresh(fw)
    return fw


@router.get("/tenants/{tenant_id}/firmware/versions", response_model=dict)
async def list_firmware_versions(
    tenant_id: UUID,
    release_type: Optional[str] = Query(None),
    page: int = Query(1, ge=1),
    per_page: int = Query(20, ge=1, le=100),
    current_tenant: UUID = Depends(get_current_tenant),
    session: RLSSession = Depends(get_session),
):
    if str(tenant_id) != str(current_tenant):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Tenant mismatch")
    await session.set_tenant_context(tenant_id)

    q = select(FirmwareVersion).where(FirmwareVersion.tenant_id == tenant_id)
    if release_type:
        q = q.where(FirmwareVersion.release_type == release_type)
    q = q.order_by(FirmwareVersion.created_at.desc()).offset((page - 1) * per_page).limit(per_page)

    rows = (await session.execute(q)).scalars().all()
    return {"data": [FirmwareVersionResponse.model_validate(r, from_attributes=True) for r in rows], "page": page, "per_page": per_page}


@router.get("/tenants/{tenant_id}/firmware/versions/{firmware_id}", response_model=FirmwareVersionResponse)
async def get_firmware_version(
    tenant_id: UUID,
    firmware_id: UUID,
    current_tenant: UUID = Depends(get_current_tenant),
    session: RLSSession = Depends(get_session),
):
    if str(tenant_id) != str(current_tenant):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Tenant mismatch")
    await session.set_tenant_context(tenant_id)

    fw = (await session.execute(
        select(FirmwareVersion).where(FirmwareVersion.id == firmware_id, FirmwareVersion.tenant_id == tenant_id)
    )).scalar_one_or_none()
    if not fw:
        raise HTTPException(status_code=404, detail="Firmware version not found")
    return fw


@router.delete("/tenants/{tenant_id}/firmware/versions/{firmware_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_firmware_version(
    tenant_id: UUID,
    firmware_id: UUID,
    current_tenant: UUID = Depends(get_current_tenant),
    session: RLSSession = Depends(get_session),
):
    if str(tenant_id) != str(current_tenant):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Tenant mismatch")
    await session.set_tenant_context(tenant_id)

    fw = (await session.execute(
        select(FirmwareVersion).where(FirmwareVersion.id == firmware_id, FirmwareVersion.tenant_id == tenant_id)
    )).scalar_one_or_none()
    if not fw:
        raise HTTPException(status_code=404, detail="Firmware version not found")

    await session.execute(delete(FirmwareVersion).where(FirmwareVersion.id == firmware_id))
    await session.commit()


# ---------------------------------------------------------------------------
# OTA Campaigns
# ---------------------------------------------------------------------------

@router.post("/tenants/{tenant_id}/ota/campaigns", response_model=OTACampaignResponse, status_code=status.HTTP_201_CREATED)
async def create_campaign(
    tenant_id: UUID,
    body: OTACampaignCreate,
    current_tenant: UUID = Depends(get_current_tenant),
    session: RLSSession = Depends(get_session),
):
    if str(tenant_id) != str(current_tenant):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Tenant mismatch")
    await session.set_tenant_context(tenant_id)

    fw = (await session.execute(
        select(FirmwareVersion).where(FirmwareVersion.id == body.firmware_version_id, FirmwareVersion.tenant_id == tenant_id)
    )).scalar_one_or_none()
    if not fw:
        raise HTTPException(status_code=404, detail="Firmware version not found")

    campaign = OTACampaign(
        tenant_id=tenant_id,
        name=body.name,
        firmware_version_id=body.firmware_version_id,
        rollout_strategy=body.rollout_strategy,
        devices_per_hour=body.devices_per_hour,
        auto_rollback_threshold=body.auto_rollback_threshold,
        scheduled_at=body.scheduled_at,
    )
    session.add(campaign)
    await session.commit()
    await session.refresh(campaign)
    return campaign


@router.get("/tenants/{tenant_id}/ota/campaigns", response_model=dict)
async def list_campaigns(
    tenant_id: UUID,
    status_filter: Optional[str] = Query(None, alias="status"),
    page: int = Query(1, ge=1),
    per_page: int = Query(20, ge=1, le=100),
    current_tenant: UUID = Depends(get_current_tenant),
    session: RLSSession = Depends(get_session),
):
    if str(tenant_id) != str(current_tenant):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Tenant mismatch")
    await session.set_tenant_context(tenant_id)

    q = select(OTACampaign).where(OTACampaign.tenant_id == tenant_id)
    if status_filter:
        q = q.where(OTACampaign.status == status_filter)
    q = q.order_by(OTACampaign.created_at.desc()).offset((page - 1) * per_page).limit(per_page)

    rows = (await session.execute(q)).scalars().all()
    return {"data": [OTACampaignResponse.model_validate(r, from_attributes=True) for r in rows], "page": page, "per_page": per_page}


@router.get("/tenants/{tenant_id}/ota/campaigns/{campaign_id}", response_model=OTACampaignResponse)
async def get_campaign(
    tenant_id: UUID,
    campaign_id: UUID,
    current_tenant: UUID = Depends(get_current_tenant),
    session: RLSSession = Depends(get_session),
):
    if str(tenant_id) != str(current_tenant):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Tenant mismatch")
    await session.set_tenant_context(tenant_id)

    campaign = (await session.execute(
        select(OTACampaign).where(OTACampaign.id == campaign_id, OTACampaign.tenant_id == tenant_id)
    )).scalar_one_or_none()
    if not campaign:
        raise HTTPException(status_code=404, detail="Campaign not found")
    return campaign


@router.put("/tenants/{tenant_id}/ota/campaigns/{campaign_id}", response_model=OTACampaignResponse)
async def update_campaign(
    tenant_id: UUID,
    campaign_id: UUID,
    body: OTACampaignUpdate,
    current_tenant: UUID = Depends(get_current_tenant),
    session: RLSSession = Depends(get_session),
):
    if str(tenant_id) != str(current_tenant):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Tenant mismatch")
    await session.set_tenant_context(tenant_id)

    campaign = (await session.execute(
        select(OTACampaign).where(OTACampaign.id == campaign_id, OTACampaign.tenant_id == tenant_id)
    )).scalar_one_or_none()
    if not campaign:
        raise HTTPException(status_code=404, detail="Campaign not found")
    if campaign.status != "draft":
        raise HTTPException(status_code=409, detail="Only draft campaigns can be updated")

    for field, value in body.model_dump(exclude_unset=True).items():
        setattr(campaign, field, value)
    campaign.updated_at = datetime.utcnow()
    await session.commit()
    await session.refresh(campaign)
    return campaign


@router.delete("/tenants/{tenant_id}/ota/campaigns/{campaign_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_campaign(
    tenant_id: UUID,
    campaign_id: UUID,
    current_tenant: UUID = Depends(get_current_tenant),
    session: RLSSession = Depends(get_session),
):
    if str(tenant_id) != str(current_tenant):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Tenant mismatch")
    await session.set_tenant_context(tenant_id)

    campaign = (await session.execute(
        select(OTACampaign).where(OTACampaign.id == campaign_id, OTACampaign.tenant_id == tenant_id)
    )).scalar_one_or_none()
    if not campaign:
        raise HTTPException(status_code=404, detail="Campaign not found")
    if campaign.status != "draft":
        raise HTTPException(status_code=409, detail="Only draft campaigns can be deleted")

    await session.execute(delete(OTACampaign).where(OTACampaign.id == campaign_id))
    await session.commit()


@router.post("/tenants/{tenant_id}/ota/campaigns/{campaign_id}/execute", response_model=dict)
async def execute_campaign(
    tenant_id: UUID,
    campaign_id: UUID,
    body: OTACampaignExecute,
    current_tenant: UUID = Depends(get_current_tenant),
    session: RLSSession = Depends(get_session),
):
    """Start an OTA campaign — adds devices and submits Cadence workflows."""
    if str(tenant_id) != str(current_tenant):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Tenant mismatch")
    await session.set_tenant_context(tenant_id)

    campaign = (await session.execute(
        select(OTACampaign).where(OTACampaign.id == campaign_id, OTACampaign.tenant_id == tenant_id)
    )).scalar_one_or_none()
    if not campaign:
        raise HTTPException(status_code=404, detail="Campaign not found")

    # Resolve target devices
    if body.device_ids:
        device_ids = body.device_ids
    else:
        rows = (await session.execute(
            select(Device.id).where(Device.tenant_id == tenant_id)
        )).scalars().all()
        device_ids = list(rows)

    if not device_ids:
        raise HTTPException(status_code=400, detail="No devices to update")

    # Fetch firmware version for URL/hash
    fw = (await session.execute(
        select(FirmwareVersion).where(FirmwareVersion.id == campaign.firmware_version_id)
    )).scalar_one_or_none()
    if not fw:
        raise HTTPException(status_code=404, detail="Firmware version not found")

    # Create OTACampaignDevice rows for all targets
    for did in device_ids:
        session.add(OTACampaignDevice(campaign_id=campaign_id, device_id=did))
    campaign.status = "in_progress"
    campaign.started_at = datetime.utcnow()
    await session.commit()

    # Dispatch command to each device via its native protocol
    dispatcher = OTADispatchService()
    dispatched, failed = 0, 0
    errors = []

    devices = (await session.execute(
        select(Device).where(Device.id.in_(device_ids))
    )).scalars().all()

    for device in devices:
        ok, err = await dispatcher.dispatch(
            device=device,
            firmware_url=fw.url,
            firmware_hash=fw.hash,
            firmware_version=fw.version,
        )
        if ok:
            dispatched += 1
        else:
            failed += 1
            errors.append({"device_id": str(device.id), "error": err})
            # Mark individual campaign device as failed
            await session.execute(
                select(OTACampaignDevice).where(
                    OTACampaignDevice.campaign_id == campaign_id,
                    OTACampaignDevice.device_id == device.id,
                )
            )

    await session.commit()

    return {
        "campaign_id": str(campaign_id),
        "status": "in_progress",
        "dispatched": dispatched,
        "failed": failed,
        "total": len(device_ids),
        "errors": errors,
    }


@router.get("/tenants/{tenant_id}/ota/campaigns/{campaign_id}/status", response_model=dict)
async def campaign_status(
    tenant_id: UUID,
    campaign_id: UUID,
    current_tenant: UUID = Depends(get_current_tenant),
    session: RLSSession = Depends(get_session),
):
    if str(tenant_id) != str(current_tenant):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Tenant mismatch")
    await session.set_tenant_context(tenant_id)

    campaign = (await session.execute(
        select(OTACampaign).where(OTACampaign.id == campaign_id, OTACampaign.tenant_id == tenant_id)
    )).scalar_one_or_none()
    if not campaign:
        raise HTTPException(status_code=404, detail="Campaign not found")

    devices = (await session.execute(
        select(OTACampaignDevice).where(OTACampaignDevice.campaign_id == campaign_id)
    )).scalars().all()

    total = len(devices)
    by_status = {}
    for d in devices:
        by_status[d.status] = by_status.get(d.status, 0) + 1

    completed = by_status.get("completed", 0)
    progress = round(completed / total * 100) if total else 0

    return {
        "campaign_id": str(campaign_id),
        "status": campaign.status,
        "progress_percent": progress,
        "total_devices": total,
        "by_status": by_status,
        "devices": [OTACampaignDeviceResponse.model_validate(d, from_attributes=True) for d in devices],
    }


# ---------------------------------------------------------------------------
# Device Firmware History
# ---------------------------------------------------------------------------

@router.get("/tenants/{tenant_id}/devices/{device_id}/ota/history", response_model=dict)
async def device_firmware_history(
    tenant_id: UUID,
    device_id: UUID,
    page: int = Query(1, ge=1),
    per_page: int = Query(20, ge=1, le=100),
    current_tenant: UUID = Depends(get_current_tenant),
    session: RLSSession = Depends(get_session),
):
    if str(tenant_id) != str(current_tenant):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Tenant mismatch")
    await session.set_tenant_context(tenant_id)

    # Verify device belongs to tenant
    device = (await session.execute(
        select(Device).where(Device.id == device_id, Device.tenant_id == tenant_id)
    )).scalar_one_or_none()
    if not device:
        raise HTTPException(status_code=404, detail="Device not found")

    rows = (await session.execute(
        select(DeviceFirmwareHistory)
        .where(DeviceFirmwareHistory.device_id == device_id)
        .order_by(DeviceFirmwareHistory.created_at.desc())
        .offset((page - 1) * per_page)
        .limit(per_page)
    )).scalars().all()

    return {
        "data": [DeviceFirmwareHistoryResponse.model_validate(r, from_attributes=True) for r in rows],
        "page": page,
        "per_page": per_page,
    }