"""Integration management API — CRUD for LoRaWAN network server integrations.

Integrations let customers forward LoRaWAN uplinks from any LNS (TTN,
ChirpStack, Helium, Actility) into Gito via HTTP webhook.

Each integration has a hashed bearer key. The raw key is returned only
on create and rotate-key — it is never retrievable afterward.

ChirpStack MQTT bridge integrations use a direct broker connection instead
of a bearer key — they receive no key and cannot rotate one.
"""

import hashlib
import json
import logging
import secrets
from datetime import datetime, timezone
from typing import Annotated, Any
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request, status
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
    MqttConfigValidator,
    MqttIntegrationCreatedResponse,
    ProviderEnum,
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
    base = settings.API_BASE_URL
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


def _mask_config(config: dict, provider: str) -> dict:
    """Strip sensitive fields from MQTT bridge config before returning."""
    if provider == "chirpstack_mqtt":
        masked = dict(config)
        if "password" in masked:
            masked["password"] = "••••••••"
        if "ca_cert" in masked and masked["ca_cert"]:
            masked["ca_cert"] = "(set)"
        return masked
    return config


async def _notify_bridge_manager(request: Request, action: str, integration_id: str) -> None:
    """Publish integration change to Redis so the processor reconciles immediately."""
    redis = getattr(request.app.state, "redis", None)
    if redis:
        try:
            await redis.publish(
                "integration:changes",
                json.dumps({"action": action, "integration_id": integration_id}),
            )
        except Exception as e:
            logger.warning("Failed to publish integration change to Redis: %s", e)


async def _get_bridge_status(request: Request, integration_id: str) -> str:
    """Read live bridge connection status from Redis."""
    redis = getattr(request.app.state, "redis", None)
    if not redis:
        return "pending"
    try:
        val = await redis.get(f"bridge:status:{integration_id}")
        return (val.decode() if isinstance(val, bytes) else val) if val else "pending"
    except Exception:
        return "pending"


# ---------------------------------------------------------------------------
# Create
# ---------------------------------------------------------------------------

@router.post("", status_code=status.HTTP_201_CREATED)
async def create_integration(
    tenant_id: UUID,
    body: IntegrationCreate,
    request: Request,
    session: Annotated[RLSSession, Depends(get_session)],
    current_user: Annotated[tuple[UUID, UUID], Depends(get_current_user)],
):
    """Create a new integration. MQTT bridge integrations return broker info; webhook integrations return a bearer key."""
    await _validate_tenant(tenant_id, current_user)
    current_tenant_id, current_user_id = current_user
    await session.set_tenant_context(current_tenant_id, current_user_id)

    if body.provider == ProviderEnum.chirpstack_mqtt:
        # Validate MQTT config — broker_url required
        mqtt_conf = MqttConfigValidator(**body.config)

        integration = Integration(
            tenant_id=tenant_id,
            name=body.name,
            provider=body.provider.value,
            key_hash=None,
            key_prefix=None,
            config=mqtt_conf.model_dump(exclude_none=True),
            created_by=current_user_id,
        )
        session.add(integration)
        await session.commit()
        await session.refresh(integration)

        await _notify_bridge_manager(request, "created", str(integration.id))

        return MqttIntegrationCreatedResponse(
            id=integration.id,
            name=integration.name,
            provider=integration.provider,
            broker_url=mqtt_conf.broker_url,
            port=mqtt_conf.port,
            bridge_status="pending",
            created_at=integration.created_at,
        )

    # Webhook path — existing behaviour unchanged
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
    request: Request,
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

    # Batch-fetch bridge statuses for all chirpstack_mqtt integrations
    mqtt_ids = [str(i.id) for i in integrations if i.provider == "chirpstack_mqtt"]
    bridge_statuses: dict[str, str] = {}
    if mqtt_ids:
        redis = getattr(request.app.state, "redis", None)
        if redis:
            try:
                keys = [f"bridge:status:{iid}" for iid in mqtt_ids]
                vals = await redis.mget(*keys)
                for iid, val in zip(mqtt_ids, vals):
                    bridge_statuses[iid] = (val.decode() if isinstance(val, bytes) else val) if val else "pending"
            except Exception as e:
                logger.warning("Failed to fetch bridge statuses: %s", e)

    items = []
    for i in integrations:
        row = IntegrationResponse.model_validate(i, from_attributes=True)
        row.config = _mask_config(dict(row.config), i.provider)
        if i.provider == "chirpstack_mqtt":
            row.bridge_status = bridge_statuses.get(str(i.id), "pending")
        items.append(row)

    return SuccessResponse(data=items)


# ---------------------------------------------------------------------------
# Get (with setup instructions)
# ---------------------------------------------------------------------------

@router.get("/{integration_id}", response_model=SuccessResponse)
async def get_integration(
    tenant_id: UUID,
    integration_id: UUID,
    request: Request,
    session: Annotated[RLSSession, Depends(get_session)],
    current_user: Annotated[tuple[UUID, UUID], Depends(get_current_user)],
):
    """Get a single integration. Webhook integrations include setup instructions."""
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

    response_data = IntegrationResponse.model_validate(integration, from_attributes=True).model_dump()
    response_data["config"] = _mask_config(dict(response_data["config"]), integration.provider)

    if integration.provider == "chirpstack_mqtt":
        response_data["bridge_status"] = await _get_bridge_status(request, str(integration_id))
    else:
        webhook_url = _connection_endpoint(integration.provider)
        instructions = build_setup_instructions(
            integration.provider, webhook_url, integration.key_prefix or ""
        )
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
    request: Request,
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
        if integration.provider == "chirpstack_mqtt":
            mqtt_conf = MqttConfigValidator(**body.config)
            integration.config = mqtt_conf.model_dump(exclude_none=True)
        else:
            integration.config = body.config
    if body.is_active is not None:
        integration.is_active = body.is_active

    integration.updated_at = datetime.now(timezone.utc)
    await session.commit()
    await session.refresh(integration)

    if integration.provider == "chirpstack_mqtt":
        await _notify_bridge_manager(request, "updated", str(integration_id))

    row = IntegrationResponse.model_validate(integration, from_attributes=True)
    row.config = _mask_config(dict(row.config), integration.provider)
    return SuccessResponse(data=row)


# ---------------------------------------------------------------------------
# Delete
# ---------------------------------------------------------------------------

@router.delete("/{integration_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_integration(
    tenant_id: UUID,
    integration_id: UUID,
    request: Request,
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

    provider = integration.provider
    await session.delete(integration)
    await session.commit()

    if provider == "chirpstack_mqtt":
        await _notify_bridge_manager(request, "deleted", str(integration_id))


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

    if integration.provider == "chirpstack_mqtt":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="MQTT bridge integrations do not use bearer keys",
        )

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
