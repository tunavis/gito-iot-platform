"""Digital twin service — last-known-value cache in KeyDB.

Key format: device:{device_id}:latest
Hash fields: metric_key → value (string), _updated_at → ISO timestamp
"""

from uuid import UUID
from datetime import datetime, timezone
from typing import Optional
import json
import logging

logger = logging.getLogger(__name__)

CACHE_KEY_PREFIX = "device"
CACHE_KEY_SUFFIX = "latest"


def _cache_key(device_id: UUID | str) -> str:
    return f"{CACHE_KEY_PREFIX}:{device_id}:{CACHE_KEY_SUFFIX}"


class DigitalTwinService:
    def __init__(self, redis_client):
        self.redis = redis_client

    async def update_device_state(self, device_id: UUID | str, metrics: dict, timestamp: str | None = None) -> None:
        """Update cached state for a device."""
        key = _cache_key(device_id)
        if timestamp is None:
            timestamp = datetime.now(timezone.utc).isoformat()
        flat = {"_updated_at": timestamp}
        for k, v in metrics.items():
            if isinstance(v, (dict, list)):
                flat[k] = json.dumps(v)
            else:
                flat[k] = str(v)
        await self.redis.hset(key, mapping=flat)

    async def get_device_state(self, device_id: UUID | str) -> Optional[dict]:
        """Get cached state. Returns None if no cached data."""
        key = _cache_key(device_id)
        raw = await self.redis.hgetall(key)
        if not raw:
            return None
        result = {}
        for k, v in raw.items():
            field = k.decode() if isinstance(k, bytes) else k
            value = v.decode() if isinstance(v, bytes) else v
            if field == "_updated_at":
                result[field] = value
                continue
            try:
                result[field] = float(value)
            except (ValueError, TypeError):
                try:
                    result[field] = json.loads(value)
                except (json.JSONDecodeError, TypeError):
                    result[field] = value
        return result

    async def get_multiple_device_states(self, device_ids: list) -> dict:
        """Get states for multiple devices using pipeline."""
        if not device_ids:
            return {}
        pipe = self.redis.pipeline()
        for did in device_ids:
            pipe.hgetall(_cache_key(did))
        results = await pipe.execute()
        states = {}
        for did, raw in zip(device_ids, results):
            if not raw:
                continue
            state = {}
            for k, v in raw.items():
                field = k.decode() if isinstance(k, bytes) else k
                value = v.decode() if isinstance(v, bytes) else v
                if field == "_updated_at":
                    state[field] = value
                    continue
                try:
                    state[field] = float(value)
                except (ValueError, TypeError):
                    try:
                        state[field] = json.loads(value)
                    except (json.JSONDecodeError, TypeError):
                        state[field] = value
            states[did if isinstance(did, UUID) else UUID(str(did))] = state
        return states
