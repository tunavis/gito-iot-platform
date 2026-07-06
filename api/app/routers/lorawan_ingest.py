"""Universal LoRaWAN webhook ingestion endpoint.

Accepts uplinks from any LNS (ChirpStack, TTN, Helium, Actility, custom)
and feeds them into the same telemetry pipeline as /ingest.

Authentication: Authorization: Bearer {integration_key}
Key lookup uses resolve_integration_key() SECURITY DEFINER function.
"""

import hashlib
import json as _json
import logging
import time
from datetime import datetime, timezone
from typing import Annotated, Any

from fastapi import APIRouter, Depends, Header, HTTPException, Request, status
from sqlalchemy import select, text

from app.database import get_session, RLSSession
from app.models.base import Device
from app.schemas.common import SuccessResponse
from app.services.telemetry_stream import stream_ingest
from app.services.lorawan_parsers import get_parser

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/ingest/lorawan", tags=["lorawan-ingest"])

SYSTEM_KEYS = {"timestamp", "ts", "device_id", "tenant_id", "id"}
RATE_LIMIT_MAX = 600   # messages per minute per integration
DEDUP_TTL = 30         # seconds


def _hash_key(raw_key: str) -> str:
    return hashlib.sha256(raw_key.encode()).hexdigest()


def _radio_to_lora_metrics(radio: dict) -> dict:
    mapping = {
        "rssi": "__lora_rssi",
        "snr": "__lora_snr",
        "gateway_id": "__lora_gateway_id",
        "frequency": "__lora_frequency",
        "spreading_factor": "__lora_spreading_factor",
        "frame_count": "__lora_frame_count",
        "data_rate": "__lora_data_rate",
    }
    return {mapping[k]: v for k, v in radio.items() if k in mapping}



@router.post("/{provider}", response_model=SuccessResponse, status_code=status.HTTP_201_CREATED)
async def ingest_lorawan(
    provider: str,
    request: Request,
    body: dict[str, Any],
    session: Annotated[RLSSession, Depends(get_session)],
    authorization: str = Header(None),
):
    """Ingest a LoRaWAN uplink from any network server.

    The {provider} path param selects the payload parser.
    Authentication is via Bearer {integration_key} header.
    """
    # --- Validate provider ---
    try:
        parser = get_parser(provider)
    except KeyError:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Unknown provider '{provider}'. Supported: chirpstack, ttn, helium, actility, custom",
        )

    # --- Validate bearer key ---
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing or invalid Authorization header",
        )
    raw_key = authorization.split(" ", 1)[1]
    key_hash = _hash_key(raw_key)

    # --- Resolve integration (bypasses RLS via SECURITY DEFINER) ---
    result = await session.execute(
        text("SELECT integration_id, tenant_id, provider, config, is_active FROM resolve_integration_key(:hash)"),
        {"hash": key_hash},
    )
    row = result.fetchone()
    if not row:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid integration key")
    integration = dict(row._mapping)

    if not integration["is_active"]:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Integration is disabled")
    if integration["provider"] != provider:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"Key is registered for provider '{integration['provider']}', not '{provider}'",
        )

    tenant_id = integration["tenant_id"]
    integration_id = integration["integration_id"]

    # --- Rate limit per integration (Redis, RATE_LIMIT_MAX/min) ---
    redis_client = getattr(request.app.state, "redis", None)
    rate_key = f"rate:integration:{integration_id}:{int(time.time()) // 60}"
    if redis_client:
        try:
            count = await redis_client.incr(rate_key)
            if count == 1:
                await redis_client.expire(rate_key, 120)
            config = integration.get("config") or {}
            limit = int(config.get("rate_limit", RATE_LIMIT_MAX))
            if count > limit:
                raise HTTPException(status_code=status.HTTP_429_TOO_MANY_REQUESTS, detail="Rate limit exceeded")
        except HTTPException:
            raise
        except Exception as e:
            logger.warning("Rate limit check failed: %s", e)

    # --- Parse provider payload ---
    uplink = parser(body)
    if not uplink:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Could not parse payload for provider '{provider}'. Check setup instructions for required fields.",
        )

    # --- Deduplication (DEDUP_TTL seconds) ---
    if redis_client:
        try:
            dedup_key = f"dedup:lora:{uplink.dedup_id}"
            already_seen = await redis_client.set(dedup_key, 1, nx=True, ex=DEDUP_TTL) is None
            if already_seen:
                logger.debug("Duplicate LoRaWAN uplink ignored: %s", uplink.dedup_id)
                return SuccessResponse(data={"ingested": 0, "duplicate": True})
        except Exception as e:
            logger.warning("Deduplication check failed: %s", e)

    # --- Set RLS tenant context ---
    await session.set_tenant_context(tenant_id)

    # --- Resolve dev_eui → device ---
    dev_result = await session.execute(
        select(Device).where(
            Device.tenant_id == tenant_id,
            Device.dev_eui == uplink.dev_eui,
        )
    )
    device = dev_result.scalar_one_or_none()
    if not device:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Device with dev_eui '{uplink.dev_eui}' not found. Register it in Gito first.",
        )

    device_id = device.id
    ts = datetime.now(timezone.utc)

    # --- Fetch key mapping from device type ---
    key_mapping: dict = {}
    km_result = await session.execute(
        text(
            "SELECT dt.key_mapping FROM devices d "
            "JOIN device_types dt ON d.device_type_id = dt.id "
            "WHERE d.id = :device_id"
        ),
        {"device_id": str(device_id)},
    )
    km_row = km_result.fetchone()
    if km_row and km_row[0]:
        key_mapping = km_row[0]

    # --- Build metric dict: user metrics + __lora_* radio metadata ---
    all_metrics = dict(uplink.metrics)
    if uplink.radio:
        all_metrics.update(_radio_to_lora_metrics(uplink.radio))

    mapped_metrics = {
        key_mapping.get(k, k): v for k, v in all_metrics.items() if k not in SYSTEM_KEYS
    }
    if not mapped_metrics:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="No valid metrics in payload")

    # Publish into the ingest stream — the processor inserts AND evaluates alarms
    # there (single funnel; webhook-connected LoRaWAN devices get identical alarms).
    if not redis_client:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Ingest pipeline unavailable — retry",
        )
    try:
        await stream_ingest(redis_client, tenant_id, device_id, mapped_metrics, ts)
    except Exception as e:
        logger.error("Failed to publish LoRaWAN ingest to stream for device %s: %s", device_id, e)
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Ingest pipeline unavailable — retry",
        )

    # --- Update device last_seen + status ---
    await session.execute(
        text(
            "UPDATE devices SET last_seen = :ts, status = 'online', updated_at = now() "
            "WHERE id = :device_id AND tenant_id = :tenant_id"
        ),
        {"ts": ts, "device_id": str(device_id), "tenant_id": str(tenant_id)},
    )
    await session.commit()

    # --- Increment integration message_count + last_used_at ---
    await session.execute(
        text(
            "UPDATE integrations SET message_count = message_count + 1, last_used_at = now() "
            "WHERE id = :integration_id"
        ),
        {"integration_id": str(integration_id)},
    )
    await session.commit()

    # --- Publish to Redis for WebSocket + digital twin (non-critical) ---
    if redis_client:
        try:
            clean_payload = {k: v for k, v in uplink.metrics.items() if k not in SYSTEM_KEYS}
            channel = f"telemetry:{tenant_id}:{device_id}"
            message = _json.dumps({
                "device_id": str(device_id),
                "payload": clean_payload,
                "timestamp": ts.isoformat(),
            })
            await redis_client.publish(channel, message)
        except Exception as e:
            logger.warning("Failed to publish to Redis: %s", e)

    user_metric_count = len([k for k in all_metrics if not k.startswith("__lora_")])
    logger.info(
        "lorawan_ingest: %d metrics for device %s via %s (tenant %s)",
        user_metric_count, device_id, provider, tenant_id,
    )

    return SuccessResponse(data={"ingested": user_metric_count, "timestamp": ts.isoformat()})
