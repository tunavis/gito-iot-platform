"""LoRaWAN device integration routes - webhook receivers and telemetry mapping.

This router handles:
1. ChirpStack uplink webhooks (device → platform telemetry)
2. ChirpStack status webhooks (device online/offline)
3. ChirpStack error webhooks (device errors, failed uplinks)
"""

import logging
import base64
import json
from typing import Optional
from datetime import datetime
from uuid import UUID

from fastapi import APIRouter, HTTPException, status, Header
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_session, RLSSession
from app.models.base import Device, Tenant
from app.schemas.common import SuccessResponse

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/lorawan", tags=["lorawan"])


@router.post("/webhooks/{tenant_id}/uplink")
async def handle_uplink_webhook(
    tenant_id: UUID,
    payload: dict,
    session: AsyncSession = None,
) -> SuccessResponse:
    """Receive LoRaWAN uplink from ChirpStack.
    
    ChirpStack sends device telemetry here. We map it to Gito's telemetry format
    and store in TimescaleDB.
    
    Expected ChirpStack payload structure:
    {
        "applicationID": "1",
        "applicationName": "my-app",
        "deviceName": "my-device",
        "devEUI": "0102030405060708",
        "rxInfo": [...],
        "txInfo": {...},
        "adr": true,
        "dr": 5,
        "fCnt": 10,
        "fPort": 10,
        "confirmed": false,
        "data": "AQID",  # base64 encoded payload
        "objectJSON": "{...}"  # Optional: decoded JSON payload
    }
    """
    if session is None:
        session = await get_session().__aenter__()
    
    try:
        # Validate tenant exists
        tenant_query = select(Tenant).where(Tenant.id == tenant_id)
        tenant = await session.execute(tenant_query)
        if not tenant.scalar_one_or_none():
            logger.warning(
                "uplink_webhook_invalid_tenant",
                extra={"tenant_id": str(tenant_id)},
            )
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Tenant not found",
            )
        
        # Extract device EUI from payload
        dev_eui = payload.get("devEUI")
        if not dev_eui:
            logger.warning("uplink_webhook_missing_dev_eui", extra={"payload": payload})
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Missing devEUI in payload",
            )
        
        # Find device by EUI
        device_query = select(Device).where(
            Device.tenant_id == tenant_id,
            Device.dev_eui == dev_eui,
        )
        device = await session.execute(device_query)
        device = device.scalar_one_or_none()
        
        if not device:
            logger.warning(
                "uplink_webhook_device_not_found",
                extra={
                    "tenant_id": str(tenant_id),
                    "dev_eui": dev_eui,
                },
            )
            # Log but don't fail - device might be in ChirpStack but not Gito yet
            return SuccessResponse(
                data={
                    "message": "Device not found in Gito, uplink ignored",
                    "dev_eui": dev_eui,
                }
            )
        
        # Parse telemetry data
        telemetry_data = _parse_lorawan_payload(payload)
        
        # Update device status
        device.last_seen = datetime.utcnow()
        device.status = "online"
        
        # Extract signal strength from rxInfo (if available)
        if payload.get("rxInfo") and len(payload["rxInfo"]) > 0:
            rssi = payload["rxInfo"][0].get("rssi")
            if rssi is not None:
                device.signal_strength = rssi
        
        # Update battery if in telemetry
        if "battery" in telemetry_data:
            device.battery_level = telemetry_data["battery"]
        
        session.add(device)
        await session.commit()
        
        # Log successful uplink
        logger.info(
            "lorawan_uplink_received",
            extra={
                "tenant_id": str(tenant_id),
                "device_id": str(device.id),
                "dev_eui": dev_eui,
                "data_points": len(telemetry_data),
                "fport": payload.get("fPort"),
            },
        )
        
        return SuccessResponse(
            data={
                "message": "Uplink processed successfully",
                "device_id": str(device.id),
                "dev_eui": dev_eui,
                "telemetry": telemetry_data,
            }
        )
        
    except Exception as e:
        logger.error(
            "uplink_webhook_processing_failed",
            extra={
                "tenant_id": str(tenant_id),
                "error": str(e),
            },
        )
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to process uplink",
        )


@router.post("/webhooks/{tenant_id}/status")
async def handle_status_webhook(
    tenant_id: UUID,
    payload: dict,
    session: AsyncSession = None,
) -> SuccessResponse:
    """Receive device status update from ChirpStack.
    
    ChirpStack sends device online/offline status here.
    
    Expected payload:
    {
        "deviceName": "my-device",
        "devEUI": "0102030405060708",
        "online": true,  # or false
        "timestamp": "2025-01-13T10:30:00Z"
    }
    """
    if session is None:
        session = await get_session().__aenter__()
    
    try:
        dev_eui = payload.get("devEUI")
        is_online = payload.get("online", False)
        
        if not dev_eui:
            logger.warning("status_webhook_missing_dev_eui")
            return SuccessResponse(data={"message": "Missing devEUI"})
        
        # Find and update device
        device_query = select(Device).where(
            Device.tenant_id == tenant_id,
            Device.dev_eui == dev_eui,
        )
        device = await session.execute(device_query)
        device = device.scalar_one_or_none()
        
        if device:
            device.status = "online" if is_online else "offline"
            device.last_seen = datetime.utcnow()
            session.add(device)
            await session.commit()
            
            logger.info(
                "device_status_updated",
                extra={
                    "tenant_id": str(tenant_id),
                    "device_id": str(device.id),
                    "dev_eui": dev_eui,
                    "online": is_online,
                },
            )
        
        return SuccessResponse(
            data={
                "message": "Status updated",
                "dev_eui": dev_eui,
                "online": is_online,
            }
        )
        
    except Exception as e:
        logger.error(
            "status_webhook_processing_failed",
            extra={
                "tenant_id": str(tenant_id),
                "error": str(e),
            },
        )
        return SuccessResponse(
            data={"message": "Status update processed with errors"}
        )


@router.post("/webhooks/{tenant_id}/error")
async def handle_error_webhook(
    tenant_id: UUID,
    payload: dict,
) -> SuccessResponse:
    """Receive device error notifications from ChirpStack.
    
    Expected payload:
    {
        "deviceName": "my-device",
        "devEUI": "0102030405060708",
        "type": "UPLINK_FCNT_RESET",
        "error": "Device frame counter was reset",
        "timestamp": "2025-01-13T10:30:00Z"
    }
    """
    try:
        dev_eui = payload.get("devEUI", "unknown")
        error_type = payload.get("type", "UNKNOWN")
        error_msg = payload.get("error", "No message")
        
        logger.warning(
            "device_error_received",
            extra={
                "tenant_id": str(tenant_id),
                "dev_eui": dev_eui,
                "error_type": error_type,
                "error_message": error_msg,
            },
        )
        
        return SuccessResponse(
            data={
                "message": "Error notification logged",
                "dev_eui": dev_eui,
                "error_type": error_type,
            }
        )
        
    except Exception as e:
        logger.error(
            "error_webhook_processing_failed",
            extra={"error": str(e)},
        )
        return SuccessResponse(data={"message": "Error processed"})


def _parse_lorawan_payload(chirpstack_payload: dict) -> dict:
    """Parse ChirpStack payload into telemetry format.
    
    Extracts decoded JSON from objectJSON field if available,
    otherwise attempts to decode base64 data field.
    
    Returns dict with parsed telemetry data.
    """
    telemetry = {}
    
    # Try objectJSON first (best case: ChirpStack decoded the payload)
    if chirpstack_payload.get("objectJSON"):
        try:
            obj_json = chirpstack_payload["objectJSON"]
            if isinstance(obj_json, str):
                telemetry = json.loads(obj_json)
            else:
                telemetry = obj_json
        except json.JSONDecodeError:
            logger.warning(
                "failed_to_parse_objectJSON",
                extra={"data": chirpstack_payload.get("objectJSON")},
            )
    
    # Try to decode base64 data field if no objectJSON
    if not telemetry and chirpstack_payload.get("data"):
        try:
            decoded = base64.b64decode(chirpstack_payload["data"]).decode("utf-8")
            # Try to parse as JSON
            try:
                telemetry = json.loads(decoded)
            except json.JSONDecodeError:
                # If not JSON, store raw string
                telemetry = {"raw_data": decoded}
        except Exception as e:
            logger.warning(
                "failed_to_decode_data",
                extra={"error": str(e)},
            )
    
    return telemetry
