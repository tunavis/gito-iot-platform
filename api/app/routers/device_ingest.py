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
from typing import Annotated, Any, Dict, List
from uuid import UUID

from fastapi import APIRouter, Depends, Header, HTTPException, Request, status
from sqlalchemy import select, text

from app.database import get_session, RLSSession
from app.models.base import Device, Telemetry
from app.schemas.common import SuccessResponse

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/ingest", tags=["device-ingest"])

SYSTEM_KEYS = {"timestamp", "ts", "device_id", "tenant_id", "id"}


@router.post("", response_model=SuccessResponse, status_code=status.HTTP_201_CREATED)
async def ingest_with_token(
    request: Request,
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
            "UPDATE devices SET last_seen = :ts, status = 'online', updated_at = now() "
            "WHERE id = :device_id AND tenant_id = :tenant_id"
        ),
        {"ts": ts, "device_id": str(device_id), "tenant_id": str(tenant_id)},
    )
    await session.commit()

    # Publish to Redis for WebSocket real-time delivery + update digital twin cache (non-critical)
    clean_payload = {k: v for k, v in payload.items() if k not in SYSTEM_KEYS}
    redis_client_app = getattr(request.app.state, "redis", None)
    if redis_client_app:
        try:
            channel = f"telemetry:{tenant_id}:{device_id}"
            message = _json.dumps({
                "device_id": str(device_id),
                "payload": clean_payload,
                "timestamp": ts.isoformat(),
            })
            await redis_client_app.publish(channel, message)
        except Exception as e:
            logger.warning("Failed to publish telemetry to Redis: %s", e)
        try:
            from app.services.digital_twin import DigitalTwinService
            twin = DigitalTwinService(redis_client_app)
            await twin.update_device_state(device_id, clean_payload, timestamp=ts.isoformat())
        except Exception as e:
            logger.warning("Failed to update digital twin cache: %s", e)
    else:
        logger.debug("app.state.redis not available — skipping pub/sub and digital twin update")

    logger.info("Token ingest: %d metrics for device %s (tenant %s)", len(rows), device_id, tenant_id)
    return SuccessResponse(data={"ingested": len(rows), "timestamp": ts.isoformat()})


# ─────────────────────────────────────────────────────────────────────────────
# Gateway fan-out ingestion
# ─────────────────────────────────────────────────────────────────────────────

def _build_telemetry_rows(tenant_id, device_id, metrics: dict, ts: datetime) -> list:
    """Build Telemetry ORM objects from a flat dict of metrics."""
    rows = []
    for key, value in metrics.items():
        if key in SYSTEM_KEYS or key == "device_id":
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
    return rows


@router.post("/gateway", response_model=SuccessResponse, status_code=status.HTTP_201_CREATED)
async def ingest_gateway(
    request: Request,
    session: Annotated[RLSSession, Depends(get_session)],
    payload: Dict[str, Any],
    x_device_token: str = Header(None, alias="X-Device-Token"),
):
    """Gateway fan-out: ingest telemetry for multiple sub-devices in one request.

    The gateway authenticates with its own device token. Each entry in the
    ``devices`` array must include a ``device_id`` for a sub-device that
    belongs to this gateway (gateway_id FK).

    Example body::

        {
          "devices": [
            {"device_id": "uuid-1", "temperature": 24.5, "humidity": 61},
            {"device_id": "uuid-2", "pressure": 101.3}
          ]
        }
    """
    if not x_device_token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing X-Device-Token header",
        )

    devices_list = payload.get("devices")
    if not devices_list or not isinstance(devices_list, list):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Payload must contain a 'devices' array",
        )

    # Resolve gateway token
    token_hash = hashlib.sha256(x_device_token.encode()).hexdigest()
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
    gateway_id = row.device_id

    await session.set_tenant_context(tenant_id)

    # Verify gateway device exists
    gw_result = await session.execute(
        select(Device).where(Device.tenant_id == tenant_id, Device.id == gateway_id)
    )
    gateway = gw_result.scalar_one_or_none()
    if not gateway:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Gateway device not found")

    ts = datetime.now(timezone.utc)
    total_metrics = 0
    device_count = 0
    sub_device_ids: list[str] = []
    errors: list[str] = []

    for entry in devices_list:
        if not isinstance(entry, dict):
            errors.append("Non-object entry in devices array — skipped")
            continue

        sub_device_id_str = entry.get("device_id")
        if not sub_device_id_str:
            errors.append("Entry missing device_id — skipped")
            continue

        try:
            sub_device_id = UUID(sub_device_id_str)
        except (ValueError, AttributeError):
            errors.append(f"Invalid device_id '{sub_device_id_str}' — skipped")
            continue

        # Verify sub-device exists, belongs to tenant, and is linked to this gateway
        sub_result = await session.execute(
            select(Device).where(
                Device.tenant_id == tenant_id,
                Device.id == sub_device_id,
                Device.gateway_id == gateway_id,
            )
        )
        sub_device = sub_result.scalar_one_or_none()
        if not sub_device:
            errors.append(
                f"Device {sub_device_id_str} not found or not linked to this gateway — skipped"
            )
            continue

        metrics = {k: v for k, v in entry.items() if k != "device_id"}
        rows = _build_telemetry_rows(tenant_id, sub_device_id, metrics, ts)
        if rows:
            session.add_all(rows)
            total_metrics += len(rows)
            sub_device_ids.append(str(sub_device_id))
            device_count += 1

    if total_metrics == 0:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No valid metrics ingested" + (f": {'; '.join(errors)}" if errors else ""),
        )

    await session.commit()

    # Batch update last_seen + status for all sub-devices + gateway
    all_device_ids = sub_device_ids + [str(gateway_id)]
    await session.execute(
        text(
            "UPDATE devices SET last_seen = :ts, status = 'online', updated_at = now() "
            "WHERE tenant_id = :tenant_id AND id = ANY(:device_ids::uuid[])"
        ),
        {"ts": ts, "tenant_id": str(tenant_id), "device_ids": all_device_ids},
    )
    await session.commit()

    # Publish to Redis for WebSocket real-time delivery + update digital twin cache (non-critical)
    redis_client_app = getattr(request.app.state, "redis", None)
    if redis_client_app:
        try:
            from app.services.digital_twin import DigitalTwinService
            twin = DigitalTwinService(redis_client_app)
        except Exception as e:
            logger.warning("Failed to import DigitalTwinService: %s", e)
            twin = None
        for entry in devices_list:
            did = entry.get("device_id")
            if not did or did not in sub_device_ids:
                continue
            clean_metrics = {k: v for k, v in entry.items() if k not in SYSTEM_KEYS and k != "device_id"}
            try:
                channel = f"telemetry:{tenant_id}:{did}"
                message = _json.dumps({
                    "device_id": did,
                    "payload": clean_metrics,
                    "timestamp": ts.isoformat(),
                })
                await redis_client_app.publish(channel, message)
            except Exception as e:
                logger.warning("Failed to publish gateway telemetry to Redis for device %s: %s", did, e)
            if twin:
                try:
                    await twin.update_device_state(did, clean_metrics, timestamp=ts.isoformat())
                except Exception as e:
                    logger.warning("Failed to update digital twin cache for device %s: %s", did, e)
    else:
        logger.debug("app.state.redis not available — skipping pub/sub and digital twin update")

    logger.info(
        "Gateway ingest: %d metrics for %d sub-devices via gateway %s (tenant %s)",
        total_metrics, device_count, gateway_id, tenant_id,
    )

    response_data = {
        "ingested": total_metrics,
        "devices": device_count,
        "timestamp": ts.isoformat(),
    }
    if errors:
        response_data["warnings"] = errors

    return SuccessResponse(data=response_data)
