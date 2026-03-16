"""Protocol-aware device command dispatch service.

Sends RPC commands to devices via their native protocol (MQTT, HTTP, LoRaWAN).
Reuses the protocol detection logic from ota_dispatch.py.

Devices respond through their normal telemetry channel using reserved keys:
  command_id     : UUID of the command being responded to
  command_status : "executed" | "failed" | "delivered"
  command_result : arbitrary result payload (optional)
  command_error  : error message string (optional)
"""

import base64
import json
import logging
from typing import Optional

import aiohttp
import redis.asyncio as aioredis

from app.config import get_settings
from app.models.base import Device, DeviceCommand
from app.services.ota_dispatch import _detect_protocol

logger = logging.getLogger(__name__)

settings = get_settings()


class CommandDispatchService:
    """Send RPC commands to devices via their native protocol."""

    def __init__(self, redis_url: Optional[str] = None):
        self._redis_url = redis_url or settings.REDIS_URL

    async def dispatch(
        self, device: Device, command: DeviceCommand
    ) -> tuple[bool, str]:
        """Dispatch a command to a device.

        Returns:
            (success, error_message)
        """
        protocol = _detect_protocol(device)
        payload = {
            "type": "command",
            "command_id": str(command.id),
            "command": command.command_name,
            "parameters": command.parameters or {},
        }

        logger.info(
            "command_dispatch",
            extra={
                "device_id": str(device.id),
                "command_id": str(command.id),
                "command_name": command.command_name,
                "protocol": protocol,
            },
        )

        try:
            if protocol == "mqtt":
                return await self._dispatch_mqtt(device, payload)
            elif protocol == "http":
                return await self._dispatch_http(device, payload)
            elif protocol == "lorawan":
                return await self._dispatch_lorawan(device, payload)
            else:
                return False, f"Unsupported protocol: {protocol}"
        except Exception as e:
            logger.error(f"Command dispatch failed for device {device.id}: {e}")
            return False, str(e)

    async def _dispatch_mqtt(
        self, device: Device, payload: dict
    ) -> tuple[bool, str]:
        """Publish command to Redis/KeyDB pub-sub → MQTT broker bridges to device."""
        redis = await aioredis.from_url(self._redis_url, decode_responses=True)
        try:
            channel = f"{device.tenant_id}/devices/{device.id}/commands"
            await redis.publish(channel, json.dumps(payload))
            return True, ""
        finally:
            await redis.aclose()

    async def _dispatch_http(
        self, device: Device, payload: dict
    ) -> tuple[bool, str]:
        """POST command to the device's registered webhook/callback URL."""
        attrs = device.attributes or {}
        target_url = attrs.get("webhook_url") or attrs.get("callback_url")
        if not target_url:
            return False, "No webhook_url in device attributes"

        async with aiohttp.ClientSession() as session:
            async with session.post(
                target_url,
                json=payload,
                timeout=aiohttp.ClientTimeout(total=10),
            ) as resp:
                if resp.status in (200, 201, 202, 204):
                    return True, ""
                text = await resp.text()
                return False, f"HTTP device returned {resp.status}: {text}"

    async def _dispatch_lorawan(
        self, device: Device, payload: dict
    ) -> tuple[bool, str]:
        """Send command as ChirpStack downlink (base64 JSON on fPort 201)."""
        attrs = device.attributes or {}
        chirpstack_url = attrs.get("chirpstack_server") or settings.CHIRPSTACK_API_URL
        api_key = attrs.get("chirpstack_api_key") or settings.CHIRPSTACK_API_KEY

        if not chirpstack_url or not api_key:
            return False, "ChirpStack not configured for this device"

        payload_bytes = json.dumps(payload).encode()
        b64_payload = base64.b64encode(payload_bytes).decode()

        url = f"{chirpstack_url.rstrip('/')}/api/devices/{device.dev_eui}/queue"
        body = {
            "queueItem": {
                "confirmed": False,
                "fPort": 201,  # fPort 201 for commands (200 = OTA)
                "data": b64_payload,
            }
        }

        async with aiohttp.ClientSession() as session:
            async with session.post(
                url,
                json=body,
                headers={
                    "Authorization": f"Bearer {api_key}",
                    "Content-Type": "application/json",
                },
                timeout=aiohttp.ClientTimeout(total=10),
            ) as resp:
                if resp.status in (200, 201):
                    return True, ""
                text = await resp.text()
                return False, f"ChirpStack returned {resp.status}: {text}"
