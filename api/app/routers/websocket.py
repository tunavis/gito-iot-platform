"""WebSocket router for real-time telemetry updates."""

import asyncio
import json
import logging
from typing import Set
from uuid import UUID

import redis.asyncio as aioredis
from fastapi import APIRouter, Query, status
from fastapi.websockets import WebSocket
from starlette.websockets import WebSocketDisconnect

from app.config import get_settings

_IDLE_POLL_INTERVAL = 0.01  # seconds to sleep when no Redis messages are queued

# Type aliases
PubSub = object  # Redis PubSub type

logger = logging.getLogger(__name__)

router = APIRouter(tags=["websocket"])

# Store active WebSocket connections per device
# Structure: {f"{tenant_id}:{device_id}": {connection1, connection2, ...}}
active_connections: dict[str, Set[WebSocket]] = {}


class ConnectionManager:
    """Manages WebSocket subscriptions to Redis Pub/Sub."""

    def __init__(self, redis_url: str):
        self.redis_url = redis_url
        self.redis = None

    async def connect(self):
        """Connect to Redis."""
        try:
            self.redis = await aioredis.from_url(
                self.redis_url, encoding="utf-8", decode_responses=True
            )
            logger.info("Connected to Redis for WebSocket subscriptions")
        except Exception as e:
            logger.error(f"Failed to connect to Redis: {e}")
            raise

    async def disconnect(self):
        """Disconnect from Redis."""
        if self.redis:
            await self.redis.close()

    async def subscribe_to_telemetry(
        self, tenant_id: UUID, device_id: UUID
    ) -> PubSub:
        """Subscribe to device telemetry channel."""
        channel = f"telemetry:{tenant_id}:{device_id}"
        pubsub = self.redis.pubsub()
        await pubsub.subscribe(channel)
        logger.info(f"Subscribed to {channel}")
        return pubsub

    async def subscribe_to_alerts(
        self, tenant_id: UUID, device_id: UUID
    ) -> PubSub:
        """Subscribe to device alert channel."""
        channel = f"alerts:{tenant_id}:{device_id}"
        pubsub = self.redis.pubsub()
        await pubsub.subscribe(channel)
        logger.info(f"Subscribed to {channel}")
        return pubsub


# Global connection manager
_connection_manager: ConnectionManager | None = None


async def get_connection_manager() -> ConnectionManager:
    """Get or create the connection manager."""
    global _connection_manager
    if _connection_manager is None:
        settings = get_settings()
        _connection_manager = ConnectionManager(settings.REDIS_URL)
        await _connection_manager.connect()
    return _connection_manager


@router.websocket("/ws/devices/{device_id}")
async def websocket_device_telemetry(
    websocket: WebSocket, device_id: str, token: str | None = None
):
    """
    WebSocket endpoint for real-time device telemetry and alerts.

    Clients should connect with: ws://localhost:8000/api/v1/ws/devices/{device_id}?token={jwt_token}
    
    The WebSocket will stream:
    - Telemetry updates in real-time
    - Alert events when thresholds are breached
    """
    try:
        # Extract user context from token if provided
        # For now, we'll accept any connection (in production, validate JWT)
        if not token:
            await websocket.close(
                code=status.WS_1008_POLICY_VIOLATION,
                reason="Authentication required",
            )
            return

        try:
            tenant_id, user_id = await _validate_websocket_token(token)
        except Exception as e:
            logger.warning(f"WebSocket auth failed: {e}")
            await websocket.close(
                code=status.WS_1008_POLICY_VIOLATION,
                reason="Invalid token",
            )
            return

        # Validate device_id is a UUID
        try:
            device_uuid = UUID(device_id)
        except ValueError:
            await websocket.close(
                code=status.WS_1003_UNSUPPORTED_DATA,
                reason="Invalid device ID format",
            )
            return

        await websocket.accept()

        # Add to active connections
        channel_key = f"{tenant_id}:{device_uuid}"
        if channel_key not in active_connections:
            active_connections[channel_key] = set()
        active_connections[channel_key].add(websocket)

        logger.info(
            f"WebSocket client connected",
            extra={"tenant_id": str(tenant_id), "device_id": str(device_uuid)},
        )

        # Get connection manager and subscribe to channels
        manager = await get_connection_manager()
        telemetry_pubsub = await manager.subscribe_to_telemetry(tenant_id, device_uuid)
        alerts_pubsub = await manager.subscribe_to_alerts(tenant_id, device_uuid)

        try:
            disconnect_event = asyncio.Event()
            results = await asyncio.gather(
                _redis_to_ws(websocket, telemetry_pubsub, alerts_pubsub, disconnect_event),
                _ws_to_handler(websocket, disconnect_event),
                return_exceptions=True,
            )
            for result in results:
                if isinstance(result, Exception):
                    logger.error("WebSocket task failed unexpectedly", exc_info=result)

        except Exception as e:
            logger.error(
                "WebSocket error",
                extra={
                    "tenant_id": str(tenant_id),
                    "device_id": str(device_uuid),
                    "error": str(e),
                },
            )
        finally:
            # Unsubscribe and clean up
            await telemetry_pubsub.unsubscribe()
            await alerts_pubsub.unsubscribe()
            active_connections[channel_key].discard(websocket)
            if not active_connections[channel_key]:
                del active_connections[channel_key]

            logger.info(
                f"WebSocket client disconnected",
                extra={"tenant_id": str(tenant_id), "device_id": str(device_uuid)},
            )

    except Exception as e:
        logger.error(f"WebSocket connection error: {e}", exc_info=True)
        try:
            await websocket.close(code=status.WS_1011_SERVER_ERROR)
        except Exception:
            pass


async def _validate_websocket_token(token: str) -> tuple[UUID, UUID]:
    """
    Validate WebSocket token and extract tenant_id and user_id.

    Returns: (tenant_id, user_id)
    """
    from app.security import decode_token

    payload = decode_token(token)
    tenant_id = UUID(payload.get("tenant_id"))
    user_id = UUID(payload.get("sub"))
    return tenant_id, user_id


async def _handle_websocket_message(websocket: WebSocket, message: dict):
    """Handle client messages from WebSocket."""
    msg_type = message.get("type")

    if msg_type == "ping":
        await websocket.send_json({"type": "pong"})
    elif msg_type == "subscribe":
        # Client can request additional subscriptions if needed
        # For now, all connected clients are subscribed to the device
        await websocket.send_json(
            {
                "type": "subscription_confirmed",
                "data": {"device_id": message.get("device_id")},
            }
        )
    else:
        logger.debug(f"Unknown message type: {msg_type}")


async def _redis_to_ws(
    websocket: WebSocket,
    telemetry_pubsub: PubSub,
    alerts_pubsub: PubSub,
    disconnect_event: asyncio.Event,
) -> None:
    """
    Forwards Redis pub/sub messages to the WebSocket client.
    Runs as a concurrent task alongside _ws_to_handler.
    Sets disconnect_event and exits if the WebSocket send fails.
    Yields to the event loop via asyncio.sleep(0.01) when no messages arrive.
    """
    while not disconnect_event.is_set():
        had_message = False

        message = await telemetry_pubsub.get_message(ignore_subscribe_messages=True)
        if message:
            had_message = True
            try:
                data = json.loads(message["data"])
                await websocket.send_json({"type": "telemetry", "data": data})
            except (json.JSONDecodeError, KeyError) as e:
                logger.error(f"Failed to parse telemetry message: {e}")
            except Exception:
                disconnect_event.set()
                return

        message = await alerts_pubsub.get_message(ignore_subscribe_messages=True)
        if message:
            had_message = True
            try:
                data = json.loads(message["data"])
                await websocket.send_json({"type": "alert", "data": data})
            except (json.JSONDecodeError, KeyError) as e:
                logger.error(f"Failed to parse alert message: {e}")
            except Exception:
                disconnect_event.set()
                return

        if not had_message:
            await asyncio.sleep(_IDLE_POLL_INTERVAL)


async def _ws_to_handler(
    websocket: WebSocket,
    disconnect_event: asyncio.Event,
) -> None:
    """
    Receives messages from the WebSocket client and dispatches them to handlers.
    Runs as a concurrent task alongside _redis_to_ws.
    Sets disconnect_event when the client disconnects or an error occurs.
    """
    try:
        while not disconnect_event.is_set():
            client_msg = await websocket.receive_json(mode="text")
            await _handle_websocket_message(websocket, client_msg)
    except WebSocketDisconnect:
        disconnect_event.set()
    except Exception:
        logger.warning("WebSocket client handler error", exc_info=True)
        disconnect_event.set()


# ---------------------------------------------------------------------------
# Tenant-level WebSocket: multiplexes all device telemetry for a tenant
# ---------------------------------------------------------------------------


@router.websocket("/ws/tenants/{tenant_id}/telemetry")
async def websocket_tenant_telemetry(
    websocket: WebSocket,
    tenant_id: str,
    token: str = Query(None),
):
    """
    WebSocket endpoint that streams ALL device telemetry for a tenant on a
    single connection.

    Clients connect with:
        ws://host/api/v1/ws/tenants/{tenant_id}/telemetry?token={jwt}

    Messages emitted to the client:
        {"type": "telemetry", "device_id": "...", "data": {...}}
        {"type": "alerts",    "device_id": "...", "data": {...}}
    """
    if not token:
        await websocket.close(
            code=status.WS_1008_POLICY_VIOLATION,
            reason="Authentication required",
        )
        return

    try:
        token_tenant_id, user_id = await _validate_websocket_token(token)
    except Exception as e:
        logger.warning(f"Tenant WebSocket auth failed: {e}")
        await websocket.close(
            code=status.WS_1008_POLICY_VIOLATION,
            reason="Invalid token",
        )
        return

    try:
        path_tenant_uuid = UUID(tenant_id)
    except ValueError:
        await websocket.close(
            code=status.WS_1003_UNSUPPORTED_DATA,
            reason="Invalid tenant ID format",
        )
        return

    if token_tenant_id != path_tenant_uuid:
        await websocket.close(
            code=status.WS_1008_POLICY_VIOLATION,
            reason="Tenant mismatch",
        )
        return

    await websocket.accept()

    logger.info(
        "Tenant WebSocket client connected",
        extra={"tenant_id": str(path_tenant_uuid), "user_id": str(user_id)},
    )

    try:
        settings = get_settings()
        redis_client = await aioredis.from_url(
            settings.REDIS_URL, encoding="utf-8", decode_responses=True
        )
        pubsub = redis_client.pubsub()
        # Subscribe to ALL device channels for this tenant using patterns
        await pubsub.psubscribe(
            f"telemetry:{path_tenant_uuid}:*",
            f"alerts:{path_tenant_uuid}:*",
        )

        disconnect_event = asyncio.Event()
        results = await asyncio.gather(
            _tenant_redis_to_ws(websocket, pubsub, path_tenant_uuid, disconnect_event),
            _ws_to_handler(websocket, disconnect_event),
            return_exceptions=True,
        )
        for result in results:
            if isinstance(result, Exception):
                logger.error("Tenant WebSocket task failed", exc_info=result)

    except Exception as e:
        logger.error(
            "Tenant WebSocket error",
            extra={"tenant_id": str(path_tenant_uuid), "error": str(e)},
        )
    finally:
        try:
            await pubsub.punsubscribe()
            await redis_client.close()
        except Exception:
            pass

        logger.info(
            "Tenant WebSocket client disconnected",
            extra={"tenant_id": str(path_tenant_uuid), "user_id": str(user_id)},
        )


async def _tenant_redis_to_ws(
    websocket: WebSocket,
    pubsub: object,
    tenant_id: UUID,
    disconnect_event: asyncio.Event,
) -> None:
    """
    Forward pattern-subscribed Redis pub/sub messages to the WebSocket client.

    Channel format:
        telemetry:{tenant_id}:{device_id}
        alerts:{tenant_id}:{device_id}

    Emits:
        {"type": "telemetry", "device_id": "...", "data": {...}}
        {"type": "alerts",    "device_id": "...", "data": {...}}
    """
    while not disconnect_event.is_set():
        message = await pubsub.get_message(ignore_subscribe_messages=True)
        if message is None:
            await asyncio.sleep(_IDLE_POLL_INTERVAL)
            continue

        try:
            channel: str = message.get("channel", "")
            # channel  →  "telemetry:{tenant_id}:{device_id}"
            #          or "alerts:{tenant_id}:{device_id}"
            parts = channel.split(":")
            if len(parts) < 3:
                continue

            msg_type = parts[0]          # "telemetry" or "alerts"
            device_id = parts[2]         # UUID string

            data = json.loads(message["data"])
            await websocket.send_json(
                {"type": msg_type, "device_id": device_id, "data": data}
            )
        except (json.JSONDecodeError, KeyError) as e:
            logger.error(f"Failed to parse tenant telemetry message: {e}")
        except Exception:
            disconnect_event.set()
            return
