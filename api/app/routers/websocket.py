"""WebSocket router for real-time telemetry updates."""

import json
import logging
from typing import Set
from uuid import UUID

import redis.asyncio as aioredis
from fastapi import APIRouter, status
from fastapi.websockets import WebSocket

from app.config import get_settings

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
            # Listen for Redis messages and WebSocket messages
            while True:
                # Check for telemetry updates
                message = await telemetry_pubsub.get_message(ignore_subscribe_messages=True)
                if message:
                    try:
                        data = json.loads(message["data"])
                        await websocket.send_json(
                            {
                                "type": "telemetry",
                                "data": data,
                            }
                        )
                    except (json.JSONDecodeError, KeyError) as e:
                        logger.error(f"Failed to parse telemetry message: {e}")

                # Check for alert updates
                message = await alerts_pubsub.get_message(ignore_subscribe_messages=True)
                if message:
                    try:
                        data = json.loads(message["data"])
                        await websocket.send_json(
                            {
                                "type": "alert",
                                "data": data,
                            }
                        )
                    except (json.JSONDecodeError, KeyError) as e:
                        logger.error(f"Failed to parse alert message: {e}")

                # Check for client messages (ping/pong, custom commands)
                try:
                    client_msg = await websocket.receive_json(mode="text")
                    await _handle_websocket_message(websocket, client_msg)
                except Exception:
                    # Timeout or connection issue - continue listening
                    pass

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
    from app.security import verify_token

    payload = verify_token(token)
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
