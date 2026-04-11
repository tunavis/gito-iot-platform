"""Integration management API — CRUD for LoRaWAN network server integrations.

Integrations let customers forward LoRaWAN uplinks from any LNS (TTN,
ChirpStack, Helium, Actility) into Gito via HTTP webhook.

Each integration has a hashed bearer key. The raw key is returned only
on create and rotate-key — it is never retrievable afterward.
"""

import hashlib
import logging
import secrets
from datetime import datetime, timezone
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select

from app.database import get_session, RLSSession
from app.dependencies import get_current_user
from app.models.base import Integration
from app.schemas.common import SuccessResponse
from app.schemas.integration import (
    IntegrationCreate,
    IntegrationCreatedResponse,
    IntegrationResponse,
    IntegrationUpdate,
    build_setup_instructions,
)
from app.config import get_settings

logger = logging.getLogger(__name__)

router = APIRouter(
    prefix="/tenants/{tenant_id}/integrations",
    tags=["integrations"],
)

KEY_PREFIX = "gito_ik_"
KEY_BYTES = 32  # 256-bit random key → 43-char base64url string


def _generate_key() -> tuple[str, str, str]:
    """Generate a new integration key.

    Returns:
        (raw_key, key_hash, key_prefix)
    """
    raw = KEY_PREFIX + secrets.token_urlsafe(KEY_BYTES)
    key_hash = hashlib.sha256(raw.encode()).hexdigest()
    key_prefix = raw[:12]
    return raw, key_hash, key_prefix


def _connection_endpoint(provider: str) -> str:
    settings = get_settings()
    base = getattr(settings, "API_BASE_URL", "https://iot.gito.co.za")
    if provider == "mqtt":
        url_without_scheme = base.replace("https://", "").replace("http://", "")
        domain = url_without_scheme.split("/")[0].split(":")[0]
        return f"mqtt://{domain}:1883"
    elif provider == "http":
        return f"{base}/api/v1/ingest/http"
    else:
        return f"{base}/api/v1/ingest/lorawan/{provider}"


async def _validate_tenant(
    tenant_id: UUID,
    current_user: tuple[UUID, UUID],
) -> None:
    current_tenant_id, _ = current_user
    if str(tenant_id) != str(current_tenant_id):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Tenant mismatch")


# ---------------------------------------------------------------------------
# Create
# ---------------------------------------------------------------------------

@router.post("", response_model=IntegrationCreatedResponse, status_code=status.HTTP_201_CREATED)
async def create_integration(
    tenant_id: UUID,
    body: IntegrationCreate,
    session: Annotated[RLSSession, Depends(get_session)],
    current_user: Annotated[tuple[UUID, UUID], Depends(get_current_user)],
):
    """Create a new integration and return the raw key (shown only once)."""
    await _validate_tenant(tenant_id, current_user)
    current_tenant_id, current_user_id = current_user
    await session.set_tenant_context(current_tenant_id, current_user_id)

    raw_key, key_hash, key_prefix = _generate_key()

    integration = Integration(
        tenant_id=tenant_id,
        name=body.name,
        provider=body.provider.value,
        key_hash=key_hash,
        key_prefix=key_prefix,
        config=body.config,
        created_by=current_user_id,
    )
    session.add(integration)
    await session.commit()
    await session.refresh(integration)

    webhook_url = _connection_endpoint(body.provider.value)
    instructions = build_setup_instructions(body.provider.value, webhook_url, key_prefix)

    return IntegrationCreatedResponse(
        id=integration.id,
        name=integration.name,
        provider=integration.provider,
        key=raw_key,
        key_prefix=key_prefix,
        webhook_url=webhook_url,
        setup_instructions=instructions,
        created_at=integration.created_at,
    )


# ---------------------------------------------------------------------------
# List
# ---------------------------------------------------------------------------

@router.get("", response_model=SuccessResponse)
async def list_integrations(
    tenant_id: UUID,
    session: Annotated[RLSSession, Depends(get_session)],
    current_user: Annotated[tuple[UUID, UUID], Depends(get_current_user)],
):
    """List all integrations for the tenant."""
    await _validate_tenant(tenant_id, current_user)
    current_tenant_id, current_user_id = current_user
    await session.set_tenant_context(current_tenant_id, current_user_id)

    result = await session.execute(
        select(Integration)
        .where(Integration.tenant_id == tenant_id)
        .order_by(Integration.created_at.desc())
    )
    integrations = result.scalars().all()

    return SuccessResponse(
        data=[IntegrationResponse.model_validate(i, from_attributes=True) for i in integrations]
    )


# ---------------------------------------------------------------------------
# Get (with setup instructions)
# ---------------------------------------------------------------------------

@router.get("/{integration_id}", response_model=SuccessResponse)
async def get_integration(
    tenant_id: UUID,
    integration_id: UUID,
    session: Annotated[RLSSession, Depends(get_session)],
    current_user: Annotated[tuple[UUID, UUID], Depends(get_current_user)],
):
    """Get a single integration including setup instructions."""
    await _validate_tenant(tenant_id, current_user)
    current_tenant_id, current_user_id = current_user
    await session.set_tenant_context(current_tenant_id, current_user_id)

    result = await session.execute(
        select(Integration).where(
            Integration.id == integration_id,
            Integration.tenant_id == tenant_id,
        )
    )
    integration = result.scalar_one_or_none()
    if not integration:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Integration not found")

    webhook_url = _connection_endpoint(integration.provider)
    instructions = build_setup_instructions(integration.provider, webhook_url, integration.key_prefix)

    response_data = IntegrationResponse.model_validate(integration, from_attributes=True).model_dump()
    response_data["webhook_url"] = webhook_url
    response_data["setup_instructions"] = instructions.model_dump()

    return SuccessResponse(data=response_data)


# ---------------------------------------------------------------------------
# Update
# ---------------------------------------------------------------------------

@router.put("/{integration_id}", response_model=SuccessResponse)
async def update_integration(
    tenant_id: UUID,
    integration_id: UUID,
    body: IntegrationUpdate,
    session: Annotated[RLSSession, Depends(get_session)],
    current_user: Annotated[tuple[UUID, UUID], Depends(get_current_user)],
):
    """Update name, config, or is_active on an integration."""
    await _validate_tenant(tenant_id, current_user)
    current_tenant_id, current_user_id = current_user
    await session.set_tenant_context(current_tenant_id, current_user_id)

    result = await session.execute(
        select(Integration).where(
            Integration.id == integration_id,
            Integration.tenant_id == tenant_id,
        )
    )
    integration = result.scalar_one_or_none()
    if not integration:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Integration not found")

    if body.name is not None:
        integration.name = body.name
    if body.config is not None:
        integration.config = body.config
    if body.is_active is not None:
        integration.is_active = body.is_active

    integration.updated_at = datetime.now(timezone.utc)
    await session.commit()
    await session.refresh(integration)

    return SuccessResponse(data=IntegrationResponse.model_validate(integration, from_attributes=True))


# ---------------------------------------------------------------------------
# Delete
# ---------------------------------------------------------------------------

@router.delete("/{integration_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_integration(
    tenant_id: UUID,
    integration_id: UUID,
    session: Annotated[RLSSession, Depends(get_session)],
    current_user: Annotated[tuple[UUID, UUID], Depends(get_current_user)],
):
    """Delete an integration and revoke its key."""
    await _validate_tenant(tenant_id, current_user)
    current_tenant_id, current_user_id = current_user
    await session.set_tenant_context(current_tenant_id, current_user_id)

    result = await session.execute(
        select(Integration).where(
            Integration.id == integration_id,
            Integration.tenant_id == tenant_id,
        )
    )
    integration = result.scalar_one_or_none()
    if not integration:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Integration not found")

    await session.delete(integration)
    await session.commit()


# ---------------------------------------------------------------------------
# Rotate key
# ---------------------------------------------------------------------------

@router.post("/{integration_id}/rotate-key", response_model=IntegrationCreatedResponse)
async def rotate_key(
    tenant_id: UUID,
    integration_id: UUID,
    session: Annotated[RLSSession, Depends(get_session)],
    current_user: Annotated[tuple[UUID, UUID], Depends(get_current_user)],
):
    """Generate a new key for an integration, invalidating the old one."""
    await _validate_tenant(tenant_id, current_user)
    current_tenant_id, current_user_id = current_user
    await session.set_tenant_context(current_tenant_id, current_user_id)

    result = await session.execute(
        select(Integration).where(
            Integration.id == integration_id,
            Integration.tenant_id == tenant_id,
        )
    )
    integration = result.scalar_one_or_none()
    if not integration:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Integration not found")

    raw_key, key_hash, key_prefix = _generate_key()
    integration.key_hash = key_hash
    integration.key_prefix = key_prefix
    integration.updated_at = datetime.now(timezone.utc)
    await session.commit()
    await session.refresh(integration)

    webhook_url = _connection_endpoint(integration.provider)
    instructions = build_setup_instructions(integration.provider, webhook_url, key_prefix)

    return IntegrationCreatedResponse(
        id=integration.id,
        name=integration.name,
        provider=integration.provider,
        key=raw_key,
        key_prefix=key_prefix,
        webhook_url=webhook_url,
        setup_instructions=instructions,
        created_at=integration.created_at,
    )
