"""Publish telemetry into the ingest stream — the single alarm/insert funnel.

Every ingest path (MQTT, LoRaWAN bridges, REST routes) publishes here; the
processor's stream consumer performs the Timescale insert AND alarm evaluation,
so alarm behavior can never depend on how data arrived.
See docs/superpowers/plans/2026-07-06-alarm-engine-unification.md (Step 3).
"""

import json
import logging
from datetime import datetime

logger = logging.getLogger(__name__)

# Must match the processor's STREAM_KEY / entry shape (mqtt_processor.py)
STREAM_KEY = "telemetry:ingest"
STREAM_MAXLEN = 100_000


async def stream_ingest(redis, tenant_id, device_id, metrics: dict, ts: datetime) -> None:
    """XADD one device's metrics to the ingest stream. Raises on failure —
    callers should surface a 503 so devices retry instead of losing data."""
    await redis.xadd(
        STREAM_KEY,
        {
            "tenant_id": str(tenant_id),
            "device_id": str(device_id),
            "payload": json.dumps(metrics),
            "timestamp": ts.isoformat(),
        },
        maxlen=STREAM_MAXLEN,
        approximate=True,
    )
