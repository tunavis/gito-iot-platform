"""Protocol-aware device command dispatch service.

Sends RPC commands to devices via their native protocol (MQTT, HTTP, LoRaWAN).
Reuses the protocol detection logic from ota_dispatch.py.

Devices built for this platform's own convention respond through their normal
telemetry channel using reserved keys:
  command_id     : UUID of the command being responded to
  command_status : "executed" | "failed" | "delivered"
  command_result : arbitrary result payload (optional)
  command_error  : error message string (optional)

Third-party devices do not, which is why a device type may declare a **driver**
(`payload_codec.driver`). With one, the command is encoded to the
vendor's own bytes; without one, this file behaves exactly as it did before
drivers existed — that fallback is the compatibility guarantee for the live
fleet, not a leftover.
"""

import base64
import json
import logging
from typing import Optional

import aiohttp
import redis.asyncio as aioredis

from app.config import get_settings
from app.models.base import Device, DeviceCommand
from payload_codec.driver import (
    DriverError,
    encode_command,
    lorawan_params,
    mqtt_topic,
)
from app.services.network_server import (
    MODE_MQTT,
    NetworkServerCannotReceive,
    NetworkServerUnresolved,
)
from app.services.network_server import resolve as resolve_network_server
from app.services.ota_dispatch import UnsupportedProtocolError, _detect_protocol

logger = logging.getLogger(__name__)

settings = get_settings()

# Redis channel prefix the processor's ChirpStack bridges subscribe to,
# one per integration. Mirrors the existing `{tenant}/devices/{id}/commands`
# convention that already feeds the local MQTT CommandBridge.
CHIRPSTACK_DOWNLINK_CHANNEL = "chirpstack-downlink"


class CommandDispatchService:
    """Send RPC commands to devices via their native protocol."""

    def __init__(self, redis_url: Optional[str] = None):
        self._redis_url = redis_url or settings.REDIS_URL

    async def dispatch(
        self,
        device: Device,
        command: DeviceCommand,
        driver: Optional[dict] = None,
        device_type=None,
        session=None,
    ) -> tuple[bool, str]:
        """Dispatch a command to a device.

        Returns:
            (success, error_message)
        """
        # Encode BEFORE a transport is chosen. Not an ordering preference: doing
        # it inside each `_dispatch_*` is how encoding becomes per-transport by
        # accident, and then a vendor that speaks both MQTT and LoRaWAN needs its
        # bytes written twice.
        try:
            encoded = encode_command(driver, command.command_name, command.parameters)
            protocol = _detect_protocol(device, driver, device_type)
        except (DriverError, UnsupportedProtocolError) as e:
            logger.warning(
                "command_dispatch_refused",
                extra={
                    "device_id": str(device.id),
                    "command_id": str(command.id),
                    "reason": str(e),
                },
            )
            return False, str(e)

        # The pre-driver payload. Used only when nothing encoded it — a device
        # type with no driver, or one that declares `passthrough_json` — and it
        # must stay byte-identical to what this platform sent before.
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
                "encoded_bytes": len(encoded) if encoded is not None else None,
            },
        )

        try:
            if protocol == "mqtt":
                return await self._dispatch_mqtt(device, payload, encoded, driver)
            elif protocol == "http":
                return await self._dispatch_http(device, payload, encoded)
            elif protocol == "lorawan":
                return await self._dispatch_lorawan(device, payload, encoded, driver, session)
            else:
                return False, f"Unsupported protocol: {protocol}"
        except (NetworkServerUnresolved, NetworkServerCannotReceive) as e:
            # Not a transport failure — the platform could not say *where* this
            # device is. Recorded verbatim, because "which server" is not
            # something an operator can infer from a timeout.
            logger.warning(
                "network_server_unresolved",
                extra={
                    "device_id": str(device.id),
                    "command_id": str(command.id),
                    "reason": str(e),
                },
            )
            return False, str(e)
        except Exception as e:
            logger.error(f"Command dispatch failed for device {device.id}: {e}")
            return False, str(e)

    async def _dispatch_mqtt(
        self,
        device: Device,
        payload: dict,
        encoded: Optional[bytes],
        driver: Optional[dict],
    ) -> tuple[bool, str]:
        """Publish command to Redis/KeyDB pub-sub → MQTT broker bridges to device."""
        if encoded is None:
            message = json.dumps(payload)
        else:
            # The Redis→MQTT bridge in the processor reads its channel with
            # `decode_responses=True`, so the message has to survive a UTF-8
            # decode. Vendor frames do not, hence base64 in a stated envelope
            # rather than raw bytes — which would break the bridge's listen loop
            # rather than just the one message.
            message = json.dumps(
                {
                    "type": "command",
                    "command_id": payload["command_id"],
                    "command": payload["command"],
                    "encoding": "base64",
                    "payload": base64.b64encode(encoded).decode(),
                }
            )

        redis = await aioredis.from_url(self._redis_url, decode_responses=True)
        try:
            await redis.publish(mqtt_topic(driver, device), message)
            return True, ""
        finally:
            await redis.aclose()

    async def _dispatch_http(
        self, device: Device, payload: dict, encoded: Optional[bytes]
    ) -> tuple[bool, str]:
        """POST command to the device's registered webhook/callback URL."""
        attrs = device.attributes or {}
        target_url = attrs.get("webhook_url") or attrs.get("callback_url")
        if not target_url:
            return False, "No webhook_url in device attributes"

        # A driver-encoded command goes out as its own bytes. Wrapping a vendor
        # frame in this platform's JSON envelope would hand a third-party device
        # a shape it has no reason to understand — and it cannot use our
        # command_id anyway, which is why acknowledgement correlates on opcode.
        if encoded is None:
            kwargs = {"json": payload}
        else:
            kwargs = {"data": encoded, "headers": {"Content-Type": "application/octet-stream"}}

        async with aiohttp.ClientSession() as session:
            async with session.post(
                target_url,
                timeout=aiohttp.ClientTimeout(total=10),
                **kwargs,
            ) as resp:
                if resp.status in (200, 201, 202, 204):
                    return True, ""
                text = await resp.text()
                return False, f"HTTP device returned {resp.status}: {text}"

    async def _dispatch_lorawan(
        self,
        device: Device,
        payload: dict,
        encoded: Optional[bytes],
        driver: Optional[dict],
        session=None,
    ) -> tuple[bool, str]:
        """Send command as a ChirpStack downlink on the driver's port."""
        # Which network server, resolved from the device's binding. A device that
        # names one and cannot be resolved raises rather than falling back — see
        # network_server.resolve.
        if device.integration_id is not None and session is None:
            raise NetworkServerUnresolved(
                "This device is bound to a network server, but dispatch was called "
                "without a session to resolve it. Refusing to fall back to the "
                "platform default, which would reach a different server."
            )
        server = await resolve_network_server(session, device)

        payload_bytes = json.dumps(payload).encode() if encoded is None else encoded
        b64_payload = base64.b64encode(payload_bytes).decode()

        # fPort 201 (commands; 200 = OTA) and unconfirmed remain the defaults, so
        # a device type with no driver is dispatched exactly as before. Both
        # B METERS families use port 1, which is why this is declared per driver
        # rather than fixed here.
        f_port, confirmed = lorawan_params(driver)

        if server.mode == MODE_MQTT:
            return await self._queue_mqtt_downlink(device, server, b64_payload, f_port, confirmed)

        url = f"{server.api_url.rstrip('/')}/api/devices/{device.dev_eui}/queue"
        body = {
            "queueItem": {
                "confirmed": confirmed,
                "fPort": f_port,
                "data": b64_payload,
            }
        }

        async with aiohttp.ClientSession() as session:
            async with session.post(
                url,
                json=body,
                headers={
                    "Authorization": f"Bearer {server.api_key}",
                    "Content-Type": "application/json",
                },
                timeout=aiohttp.ClientTimeout(total=10),
            ) as resp:
                if resp.status in (200, 201):
                    return True, ""
                text = await resp.text()
                return False, f"ChirpStack returned {resp.status}: {text}"

    async def _queue_mqtt_downlink(
        self,
        device: Device,
        server,
        b64_payload: str,
        f_port: int,
        confirmed: bool,
    ) -> tuple[bool, str]:
        """Hand the downlink to the bridge that is already connected to the broker.

        The API deliberately opens no broker connection. It publishes to Redis and
        returns; `ChirpStackBridge` in the processor — one per integration, already
        holding a live client — does the sending.

        That is not just tidiness. A bridge can only publish to *its own* broker,
        so a downlink physically cannot reach the wrong network server. Resolving
        an endpoint in the API and connecting from here would make that a
        correctness argument instead of a constraint. It also means a client whose
        broker is unreachable leaves a queued message rather than a blocked request.
        """
        application_id = device.lorawan_app_id
        if not application_id:
            # The topic cannot be formed without it, and guessing would publish
            # into some other application on the same broker.
            return False, (
                "This device has no network-server application recorded, so a "
                "downlink cannot be addressed. It is learned from the device's own "
                "uplinks — wait for one, or set it explicitly."
            )

        message = json.dumps(
            {
                "integration_id": str(server.integration_id),
                "application_id": application_id,
                "dev_eui": device.dev_eui,
                "f_port": f_port,
                "confirmed": confirmed,
                "data": b64_payload,
            }
        )

        redis = await aioredis.from_url(self._redis_url, decode_responses=True)
        try:
            channel = f"{CHIRPSTACK_DOWNLINK_CHANNEL}:{server.integration_id}"
            listeners = await redis.publish(channel, message)
            if not listeners:
                # Nobody is bridging this integration right now. Reported rather
                # than dropped into Redis, because pub/sub has no queue: a message
                # with no subscriber is simply gone, and "sent" would be a lie.
                return False, (
                    f"No connected bridge for network server {server.integration_id}. "
                    f"The downlink was not published — pub/sub does not retain it."
                )
            return True, ""
        finally:
            await redis.aclose()
