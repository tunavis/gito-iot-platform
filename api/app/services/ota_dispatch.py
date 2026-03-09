"""Protocol-aware OTA firmware dispatch service.

Determines the correct delivery channel for each device and sends the OTA command.
Devices report progress back through their normal telemetry channel using reserved
metric keys:
  ota_status   : "pending" | "downloading" | "installing" | "completed" | "failed"
  ota_progress : 0-100 (integer percentage)
  ota_error    : error message string (optional)

Supported protocols (detected from device attributes):
  mqtt      - Publish command to {tenant_id}/devices/{device_id}/commands
  lorawan   - ChirpStack downlink (device has dev_eui + ttn_app_id)
  http      - POST to device attributes["webhook_url"]
"""

import json
import logging
from typing import Optional
from uuid import UUID

import aiohttp
import redis.asyncio as aioredis

from app.config import get_settings
from app.models.base import Device

logger = logging.getLogger(__name__)

settings = get_settings()


def _detect_protocol(device: Device) -> str:
    """Determine delivery protocol from device fields."""
    attrs = device.attributes or {}
    # Explicit override wins
    if attrs.get("protocol"):
        return attrs["protocol"].lower()
    # LoRaWAN: has dev_eui synced to ChirpStack
    if device.dev_eui and device.ttn_synced:
        return "lorawan"
    # HTTP push: device registered a callback URL
    if attrs.get("webhook_url") or attrs.get("callback_url"):
        return "http"
    # Default: MQTT
    return "mqtt"


class OTADispatchService:
    """Send OTA commands to devices via their native protocol."""

    def __init__(self, redis_url: Optional[str] = None):
        self._redis_url = redis_url or settings.REDIS_URL

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    async def dispatch(
        self,
        device: Device,
        firmware_url: str,
        firmware_hash: str,
        firmware_version: str,
    ) -> tuple[bool, str]:
        """Send OTA command to a single device.

        Returns:
            (success, error_message)
        """
        protocol = _detect_protocol(device)
        logger.info(
            "ota_dispatch",
            extra={
                "device_id": str(device.id),
                "protocol": protocol,
                "firmware_version": firmware_version,
            },
        )

        try:
            if protocol == "mqtt":
                return await self._dispatch_mqtt(device, firmware_url, firmware_hash, firmware_version)
            elif protocol == "lorawan":
                return await self._dispatch_lorawan(device, firmware_url, firmware_hash, firmware_version)
            elif protocol == "http":
                return await self._dispatch_http(device, firmware_url, firmware_hash, firmware_version)
            else:
                return False, f"Unsupported protocol: {protocol}"
        except Exception as e:
            logger.error(f"OTA dispatch failed for device {device.id}: {e}")
            return False, str(e)

    # ------------------------------------------------------------------
    # MQTT delivery
    # Publishes to: {tenant_id}/devices/{device_id}/commands
    # Device listens on this topic and handles "ota" type commands.
    # ------------------------------------------------------------------

    async def _dispatch_mqtt(
        self,
        device: Device,
        firmware_url: str,
        firmware_hash: str,
        firmware_version: str,
    ) -> tuple[bool, str]:
        redis = await aioredis.from_url(self._redis_url, decode_responses=True)
        try:
            command = json.dumps({
                "type": "ota",
                "firmware_url": firmware_url,
                "firmware_hash": firmware_hash,
                "firmware_version": firmware_version,
            })
            # Publish via Redis/KeyDB pub-sub — the MQTT processor bridges this
            # to the MQTT broker on channel: {tenant_id}/devices/{device_id}/commands
            channel = f"{device.tenant_id}/devices/{device.id}/commands"
            await redis.publish(channel, command)
            return True, ""
        finally:
            await redis.aclose()

    # ------------------------------------------------------------------
    # LoRaWAN delivery via ChirpStack downlink API
    # Payload is base64-encoded JSON sent as a Class-C downlink on port 200.
    # ------------------------------------------------------------------

    async def _dispatch_lorawan(
        self,
        device: Device,
        firmware_url: str,
        firmware_hash: str,
        firmware_version: str,
    ) -> tuple[bool, str]:
        attrs = device.attributes or {}
        chirpstack_url = (
            attrs.get("chirpstack_server")
            or settings.CHIRPSTACK_API_URL
        )
        api_key = attrs.get("chirpstack_api_key") or settings.CHIRPSTACK_API_KEY

        if not chirpstack_url or not api_key:
            return False, "ChirpStack not configured for this device"

        import base64
        payload_bytes = json.dumps({
            "type": "ota",
            "url": firmware_url,
            "hash": firmware_hash,
            "version": firmware_version,
        }).encode()
        b64_payload = base64.b64encode(payload_bytes).decode()

        url = f"{chirpstack_url.rstrip('/')}/api/devices/{device.dev_eui}/queue"
        body = {
            "queueItem": {
                "confirmed": False,
                "fPort": 200,
                "data": b64_payload,
            }
        }

        async with aiohttp.ClientSession() as session:
            async with session.post(
                url,
                json=body,
                headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
                timeout=aiohttp.ClientTimeout(total=10),
            ) as resp:
                if resp.status in (200, 201):
                    return True, ""
                text = await resp.text()
                return False, f"ChirpStack returned {resp.status}: {text}"

    # ------------------------------------------------------------------
    # HTTP push delivery
    # POSTs JSON command to the device's registered webhook URL.
    # ------------------------------------------------------------------

    async def _dispatch_http(
        self,
        device: Device,
        firmware_url: str,
        firmware_hash: str,
        firmware_version: str,
    ) -> tuple[bool, str]:
        attrs = device.attributes or {}
        target_url = attrs.get("webhook_url") or attrs.get("callback_url")
        if not target_url:
            return False, "No webhook_url in device attributes"

        body = {
            "type": "ota",
            "device_id": str(device.id),
            "firmware_url": firmware_url,
            "firmware_hash": firmware_hash,
            "firmware_version": firmware_version,
        }

        async with aiohttp.ClientSession() as session:
            async with session.post(
                target_url,
                json=body,
                timeout=aiohttp.ClientTimeout(total=10),
            ) as resp:
                if resp.status in (200, 201, 202, 204):
                    return True, ""
                text = await resp.text()
                return False, f"HTTP device returned {resp.status}: {text}"