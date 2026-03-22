"""Device credential (token) management routes.

Allows admins to generate, list, and revoke device tokens.
Tokens are used by devices to push telemetry via POST /api/v1/ingest
without needing a user JWT.
"""

import hashlib
import logging
import secrets
from datetime import datetime, timedelta, timezone
from typing import Annotated, List, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select, text

from app.database import get_session, RLSSession
from app.services.tenant_access import validate_tenant_access
from app.models.base import DeviceCredential, Device
from app.schemas.common import SuccessResponse
from app.schemas.device_credential import DeviceTokenCreate, DeviceTokenOut, DeviceTokenCreated
from app.dependencies import get_current_tenant

logger = logging.getLogger(__name__)

router = APIRouter(
    prefix="/tenants/{tenant_id}/devices/{device_id}/credentials",
    tags=["device-credentials"],
)


@router.get("", response_model=SuccessResponse)
async def list_tokens(
    tenant_id: UUID,
    device_id: UUID,
    session: Annotated[RLSSession, Depends(get_session)],
    current_tenant: Annotated[UUID, Depends(get_current_tenant)] = None,
):
    """List all active device tokens for a device."""
    if not await validate_tenant_access(session, current_tenant, tenant_id):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Tenant access denied")

    await session.set_tenant_context(tenant_id)

    # Verify device belongs to tenant
    device_result = await session.execute(
        select(Device).where(Device.tenant_id == tenant_id, Device.id == device_id)
    )
    if not device_result.scalar_one_or_none():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Device not found")

    result = await session.execute(
        select(DeviceCredential).where(
            DeviceCredential.tenant_id == tenant_id,
            DeviceCredential.device_id == device_id,
            DeviceCredential.credential_type == "device_token",
            DeviceCredential.status != "revoked",
        ).order_by(DeviceCredential.created_at.desc())
    )
    creds = result.scalars().all()

    tokens = [
        DeviceTokenOut(
            id=c.id,
            name=c.username or "Default",
            status=c.status,
            created_at=c.created_at,
            expires_at=c.expires_at,
        )
        for c in creds
    ]
    return SuccessResponse(data=tokens)


@router.post("", response_model=SuccessResponse, status_code=status.HTTP_201_CREATED)
async def generate_token(
    tenant_id: UUID,
    device_id: UUID,
    body: DeviceTokenCreate,
    session: Annotated[RLSSession, Depends(get_session)],
    current_tenant: Annotated[UUID, Depends(get_current_tenant)] = None,
):
    """Generate a new device token.

    The plain token is returned ONCE in this response and never stored.
    Store it immediately — it cannot be retrieved again.
    """
    if not await validate_tenant_access(session, current_tenant, tenant_id):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Tenant access denied")

    await session.set_tenant_context(tenant_id)

    # Verify device belongs to tenant
    device_result = await session.execute(
        select(Device).where(Device.tenant_id == tenant_id, Device.id == device_id)
    )
    if not device_result.scalar_one_or_none():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Device not found")

    # Generate token and store SHA-256 hash (no bcrypt — token is already high-entropy)
    plain_token = f"gito_dt_{secrets.token_hex(24)}"
    token_hash = hashlib.sha256(plain_token.encode()).hexdigest()

    expires_at = None
    if body.expires_days is not None:
        expires_at = datetime.now(timezone.utc) + timedelta(days=body.expires_days)

    cred = DeviceCredential(
        tenant_id=tenant_id,
        device_id=device_id,
        credential_type="device_token",
        credential_hash=token_hash,
        username=body.name,   # repurpose username column as display name
        status="active",
        expires_at=expires_at,
    )
    session.add(cred)
    await session.commit()
    await session.refresh(cred)

    logger.info("Generated device token for device %s (tenant %s)", device_id, tenant_id)

    return SuccessResponse(data=DeviceTokenCreated(
        id=cred.id,
        name=cred.username or "Default",
        status=cred.status,
        created_at=cred.created_at,
        expires_at=cred.expires_at,
        token=plain_token,
    ))


@router.delete("/{cred_id}", response_model=SuccessResponse)
async def revoke_token(
    tenant_id: UUID,
    device_id: UUID,
    cred_id: UUID,
    session: Annotated[RLSSession, Depends(get_session)],
    current_tenant: Annotated[UUID, Depends(get_current_tenant)] = None,
):
    """Revoke a device token. The token immediately stops working."""
    if not await validate_tenant_access(session, current_tenant, tenant_id):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Tenant access denied")

    await session.set_tenant_context(tenant_id)

    result = await session.execute(
        select(DeviceCredential).where(
            DeviceCredential.id == cred_id,
            DeviceCredential.device_id == device_id,
            DeviceCredential.tenant_id == tenant_id,
            DeviceCredential.credential_type == "device_token",
        )
    )
    cred = result.scalar_one_or_none()
    if not cred:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Token not found")

    cred.status = "revoked"
    cred.rotated_at = datetime.now(timezone.utc)
    await session.commit()

    logger.info("Revoked device token %s for device %s", cred_id, device_id)
    return SuccessResponse(data={"revoked": True})
