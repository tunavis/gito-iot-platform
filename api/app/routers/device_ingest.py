"""Token-based telemetry ingestion endpoint.

Devices use a pre-generated device token (gito_dt_xxx) to push telemetry
without needing a user JWT or knowing their tenant_id/device_id UUIDs.

Usage:
    POST /api/v1/ingest
    X-Device-Token: gito_dt_<token>
    Content-Type: application/json

    {"temperature": 25.5, "humidity": 65.2}

The endpoint resolves tenant_id and device_id from the token using a
SECURITY DEFINER function (resolve_device_token) that bypasses RLS.
After resolution, standard RLS applies for all subsequent DB writes.
"""

import hashlib
import json as _json
import logging
from datetime import datetime, timezone
from typing import Annotated, Any, Dict

from fastapi import APIRouter, Depends, Header, HTTPException, status
from sqlalchemy import select, text

from app.database import get_session, RLSSession
from app.models.base import Device, Telemetry
from app.schemas.common import SuccessResponse

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/ingest", tags=["device-ingest"])

SYSTEM_KEYS = {"timestamp", "ts", "device_id", "tenant_id", "id"}


@router.post("", response_model=SuccessResponse, status_code=status.HTTP_201_CREATED)
async def ingest_with_token(
    session: Annotated[RLSSession, Depends(get_session)],
    payload: Dict[str, Any],
    x_device_token: str = Header(None, alias="X-Device-Token"),
):
    """Ingest telemetry using a device token (no user JWT required).

    The token is resolved to a tenant_id + device_id via a SECURITY DEFINER
    database function. After resolution, data is stored identically to the
    JWT-based ingest endpoint.

    Example body: {"temperature": 25.5, "humidity": 65.2, "status": "running"}
    """
    if not x_device_token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing X-Device-Token header",
        )

    if not payload:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Empty payload")

    # Hash the incoming token for DB lookup
    token_hash = hashlib.sha256(x_device_token.encode()).hexdigest()

    # Resolve tenant_id + device_id via SECURITY DEFINER function (bypasses RLS)
    result = await session.execute(
        text("SELECT tenant_id, device_id FROM resolve_device_token(:hash)"),
        {"hash": token_hash},
    )
    row = result.fetchone()
    if not row:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired device token",
        )

    tenant_id = row.tenant_id
    device_id = row.device_id

    # Now activate RLS for this tenant
    await session.set_tenant_context(tenant_id)

    # Verify device still exists (guards against deleted devices with live tokens)
    device_result = await session.execute(
        select(Device).where(Device.tenant_id == tenant_id, Device.id == device_id)
    )
    if not device_result.scalar_one_or_none():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Device not found")

    ts = datetime.now(timezone.utc)

    rows = []
    for key, value in payload.items():
        if key in SYSTEM_KEYS:
            continue
        row = Telemetry(
            tenant_id=tenant_id,
            device_id=device_id,
            metric_key=key,
            ts=ts,
        )
        if isinstance(value, (int, float)):
            row.metric_value = float(value)
        elif isinstance(value, str):
            row.metric_value_str = value
        elif isinstance(value, (dict, list)):
            row.metric_value_json = value
        else:
            row.metric_value_str = str(value)
        rows.append(row)

    if not rows:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="No valid metrics in payload")

    session.add_all(rows)
    await session.commit()

    # Update device status + last_seen
    await session.execute(
        text(
            "UPDATE devices SET last_seen_at = :ts, status = 'online', updated_at = now() "
            "WHERE id = :device_id AND tenant_id = :tenant_id"
        ),
        {"ts": ts, "device_id": str(device_id), "tenant_id": str(tenant_id)},
    )
    await session.commit()

    # Publish to Redis for WebSocket real-time delivery (non-critical)
    try:
        from app.config import get_settings
        import redis.asyncio as aioredis
        settings = get_settings()
        redis_client = await aioredis.from_url(settings.REDIS_URL, encoding="utf-8", decode_responses=True)
        channel = f"telemetry:{tenant_id}:{device_id}"
        message = _json.dumps({
            "device_id": str(device_id),
            "payload": {k: v for k, v in payload.items() if k not in SYSTEM_KEYS},
            "timestamp": ts.isoformat(),
        })
        await redis_client.publish(channel, message)
        await redis_client.aclose()
    except Exception as e:
        logger.warning("Failed to publish telemetry to Redis: %s", e)

    logger.info("Token ingest: %d metrics for device %s (tenant %s)", len(rows), device_id, tenant_id)
    return SuccessResponse(data={"ingested": len(rows), "timestamp": ts.isoformat()})
