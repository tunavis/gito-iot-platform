"""OTA Firmware management API endpoints."""

import logging
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_session
from app.models.firmware import (
    FirmwareVersionCreate,
    FirmwareVersionResponse,
    FirmwareVersionUpdate,
    OTACampaignCreate,
    OTACampaignExecute,
    OTACampaignResponse,
    OTACampaignUpdate,
)
from app.middleware.auth import get_current_user
from app.services.ota_execution import OTAExecutionService
from app.services.ota_workflow import get_ota_workflow_client

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1", tags=["firmware"])


@router.post(
    "/tenants/{tenant_id}/firmware/versions",
    response_model=FirmwareVersionResponse,
    status_code=status.HTTP_201_CREATED,
)
async def upload_firmware_version(
    tenant_id: UUID,
    firmware: FirmwareVersionCreate,
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Upload a new firmware version.

    Args:
        tenant_id: Tenant UUID
        firmware: Firmware version details
        current_user: Authenticated user
        db: Database session

    Returns:
        Created firmware version

    Raises:
        HTTPException: If validation fails
    """
    # Verify user is in the tenant
    if current_user.get("tenant_id") != str(tenant_id):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Not authorized for this tenant",
        )

    try:
        from sqlalchemy.orm import declarative_base

        # Create firmware version record
        # Note: In production, use proper SQLAlchemy model
        from app.models.device import Tenant  # Use existing model as pattern

        logger.info(
            "Firmware version uploaded",
            extra={
                "tenant_id": str(tenant_id),
                "version": firmware.version,
                "size": firmware.size_bytes,
            },
        )

        # Return created firmware
        return {
            "id": None,  # Would be UUID from DB
            "tenant_id": tenant_id,
            **firmware.dict(),
            "created_at": None,
            "updated_at": None,
        }

    except Exception as e:
        logger.error(f"Failed to upload firmware: {e}")
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Failed to upload firmware version",
        )


@router.get(
    "/tenants/{tenant_id}/firmware/versions",
    response_model=list[FirmwareVersionResponse],
)
async def list_firmware_versions(
    tenant_id: UUID,
    release_type: str | None = None,
    skip: int = 0,
    limit: int = 50,
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """List firmware versions for a tenant.

    Args:
        tenant_id: Tenant UUID
        release_type: Optional filter by release type (beta, production, hotfix)
        skip: Number of records to skip
        limit: Maximum number of records to return
        current_user: Authenticated user
        db: Database session

    Returns:
        List of firmware versions

    Raises:
        HTTPException: If not authorized
    """
    # Verify user is in the tenant
    if current_user.get("tenant_id") != str(tenant_id):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Not authorized for this tenant",
        )

    logger.info(
        "Listed firmware versions",
        extra={"tenant_id": str(tenant_id), "release_type": release_type},
    )

    # Return empty list (placeholder)
    return []


@router.get("/tenants/{tenant_id}/firmware/versions/{version_id}")
async def get_firmware_version(
    tenant_id: UUID,
    version_id: UUID,
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Get firmware version details.

    Args:
        tenant_id: Tenant UUID
        version_id: Firmware version UUID
        current_user: Authenticated user
        db: Database session

    Returns:
        Firmware version details

    Raises:
        HTTPException: If not found or not authorized
    """
    # Verify user is in the tenant
    if current_user.get("tenant_id") != str(tenant_id):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Not authorized for this tenant",
        )

    raise HTTPException(
        status_code=status.HTTP_404_NOT_FOUND,
        detail="Firmware version not found",
    )


@router.put(
    "/tenants/{tenant_id}/firmware/versions/{version_id}",
    response_model=FirmwareVersionResponse,
)
async def update_firmware_version(
    tenant_id: UUID,
    version_id: UUID,
    firmware: FirmwareVersionUpdate,
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Update firmware version metadata.

    Args:
        tenant_id: Tenant UUID
        version_id: Firmware version UUID
        firmware: Updated firmware details
        current_user: Authenticated user
        db: Database session

    Returns:
        Updated firmware version

    Raises:
        HTTPException: If not found or not authorized
    """
    # Verify user is in the tenant
    if current_user.get("tenant_id") != str(tenant_id):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Not authorized for this tenant",
        )

    raise HTTPException(
        status_code=status.HTTP_404_NOT_FOUND,
        detail="Firmware version not found",
    )


@router.delete("/tenants/{tenant_id}/firmware/versions/{version_id}")
async def delete_firmware_version(
    tenant_id: UUID,
    version_id: UUID,
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Delete firmware version.

    Args:
        tenant_id: Tenant UUID
        version_id: Firmware version UUID
        current_user: Authenticated user
        db: Database session

    Raises:
        HTTPException: If not found or not authorized
    """
    # Verify user is in the tenant
    if current_user.get("tenant_id") != str(tenant_id):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Not authorized for this tenant",
        )

    raise HTTPException(
        status_code=status.HTTP_404_NOT_FOUND,
        detail="Firmware version not found",
    )


# OTA Campaign endpoints


@router.post(
    "/tenants/{tenant_id}/ota/campaigns",
    response_model=OTACampaignResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_ota_campaign(
    tenant_id: UUID,
    campaign: OTACampaignCreate,
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Create a new OTA campaign.

    Args:
        tenant_id: Tenant UUID
        campaign: Campaign details
        current_user: Authenticated user
        db: Database session

    Returns:
        Created campaign

    Raises:
        HTTPException: If validation fails
    """
    # Verify user is in the tenant
    if current_user.get("tenant_id") != str(tenant_id):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Not authorized for this tenant",
        )

    logger.info(
        "OTA campaign created",
        extra={
            "tenant_id": str(tenant_id),
            "campaign_name": campaign.name,
            "firmware_version_id": str(campaign.firmware_version_id),
        },
    )

    return {
        "id": None,
        "tenant_id": tenant_id,
        **campaign.dict(),
        "status": "draft",
        "started_at": None,
        "completed_at": None,
        "created_by": UUID(current_user.get("user_id")),
        "created_at": None,
        "updated_at": None,
    }


@router.get(
    "/tenants/{tenant_id}/ota/campaigns",
    response_model=list[OTACampaignResponse],
)
async def list_ota_campaigns(
    tenant_id: UUID,
    status: str | None = None,
    skip: int = 0,
    limit: int = 50,
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """List OTA campaigns for a tenant.

    Args:
        tenant_id: Tenant UUID
        status: Optional filter by campaign status
        skip: Number of records to skip
        limit: Maximum number of records to return
        current_user: Authenticated user
        db: Database session

    Returns:
        List of campaigns

    Raises:
        HTTPException: If not authorized
    """
    # Verify user is in the tenant
    if current_user.get("tenant_id") != str(tenant_id):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Not authorized for this tenant",
        )

    logger.info(
        "Listed OTA campaigns",
        extra={"tenant_id": str(tenant_id), "status": status},
    )

    return []


@router.get("/tenants/{tenant_id}/ota/campaigns/{campaign_id}")
async def get_ota_campaign(
    tenant_id: UUID,
    campaign_id: UUID,
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Get OTA campaign details.

    Args:
        tenant_id: Tenant UUID
        campaign_id: Campaign UUID
        current_user: Authenticated user
        db: Database session

    Returns:
        Campaign details

    Raises:
        HTTPException: If not found
    """
    # Verify user is in the tenant
    if current_user.get("tenant_id") != str(tenant_id):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Not authorized for this tenant",
        )

    raise HTTPException(
        status_code=status.HTTP_404_NOT_FOUND,
        detail="Campaign not found",
    )


@router.put(
    "/tenants/{tenant_id}/ota/campaigns/{campaign_id}",
    response_model=OTACampaignResponse,
)
async def update_ota_campaign(
    tenant_id: UUID,
    campaign_id: UUID,
    campaign: OTACampaignUpdate,
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Update OTA campaign.

    Args:
        tenant_id: Tenant UUID
        campaign_id: Campaign UUID
        campaign: Updated campaign details
        current_user: Authenticated user
        db: Database session

    Returns:
        Updated campaign

    Raises:
        HTTPException: If not found
    """
    # Verify user is in the tenant
    if current_user.get("tenant_id") != str(tenant_id):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Not authorized for this tenant",
        )

    raise HTTPException(
        status_code=status.HTTP_404_NOT_FOUND,
        detail="Campaign not found",
    )


@router.post(
    "/tenants/{tenant_id}/ota/campaigns/{campaign_id}/execute",
    response_model=dict,
)
async def execute_ota_campaign(
    tenant_id: UUID,
    campaign_id: UUID,
    execute: OTACampaignExecute,
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Execute OTA campaign (start firmware rollout).

    Submits Cadence workflows for all devices in campaign.

    Args:
        tenant_id: Tenant UUID
        campaign_id: Campaign UUID
        execute: Execution parameters
        current_user: Authenticated user
        db: Database session

    Returns:
        Campaign execution status with workflow count

    Raises:
        HTTPException: If campaign not found or invalid
    """
    # Verify user is in the tenant
    if current_user.get("tenant_id") != str(tenant_id):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Not authorized for this tenant",
        )

    try:
        # Get OTA workflow client
        workflow_client = get_ota_workflow_client()
        execution_service = OTAExecutionService(workflow_client)

        # Start campaign execution
        result = await execution_service.start_campaign(
            session=db,
            tenant_id=tenant_id,
            campaign_id=campaign_id,
        )

        logger.info(
            "OTA campaign execution started",
            extra={
                "tenant_id": str(tenant_id),
                "campaign_id": str(campaign_id),
                "workflows_submitted": result.get("workflows_submitted"),
            },
        )

        return result

    except Exception as e:
        logger.error(
            f"Failed to execute campaign: {e}",
            extra={"campaign_id": str(campaign_id), "error": str(e)},
        )
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Failed to execute campaign: {str(e)}",
        )


@router.get("/tenants/{tenant_id}/ota/campaigns/{campaign_id}/status", response_model=dict)
async def get_ota_campaign_status(
    tenant_id: UUID,
    campaign_id: UUID,
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Get OTA campaign execution status and progress.

    Args:
        tenant_id: Tenant UUID
        campaign_id: Campaign UUID
        current_user: Authenticated user
        db: Database session

    Returns:
        Campaign status with progress %, device counts

    Raises:
        HTTPException: If campaign not found
    """
    # Verify user is in the tenant
    if current_user.get("tenant_id") != str(tenant_id):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Not authorized for this tenant",
        )

    try:
        workflow_client = get_ota_workflow_client()
        execution_service = OTAExecutionService(workflow_client)

        status_result = await execution_service.get_campaign_status(
            session=db,
            tenant_id=tenant_id,
            campaign_id=campaign_id,
        )

        return status_result

    except Exception as e:
        logger.error(
            f"Failed to get campaign status: {e}",
            extra={"campaign_id": str(campaign_id), "error": str(e)},
        )
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Failed to get campaign status: {str(e)}",
        )


@router.delete("/tenants/{tenant_id}/ota/campaigns/{campaign_id}")
async def cancel_ota_campaign(
    tenant_id: UUID,
    campaign_id: UUID,
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Cancel OTA campaign (if not yet started).

    Args:
        tenant_id: Tenant UUID
        campaign_id: Campaign UUID
        current_user: Authenticated user
        db: Database session

    Raises:
        HTTPException: If campaign not found or already started
    """
    # Verify user is in the tenant
    if current_user.get("tenant_id") != str(tenant_id):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Not authorized for this tenant",
        )

    raise HTTPException(
        status_code=status.HTTP_404_NOT_FOUND,
        detail="Campaign not found",
    )
