"""
MQTT Processor Service
Subscribes to device telemetry, validates, buffers via KeyDB Streams,
and batch-inserts to TimescaleDB.

Architecture (Phase 2):
  MQTT message
    → validate / deduplicate / rate-limit
    → XADD  telemetry:ingest  (KeyDB Stream, ~0.1 ms)
    → publish Redis pub/sub   (WebSocket delivery)
    → evaluate alert rules    (inline, reads from payload)

  StreamConsumer (separate asyncio task)
    → XREADGROUP  COUNT 500  BLOCK 100 ms
    → group rows by tenant
    → executemany  INSERT INTO telemetry  (one round-trip per tenant)
    → batch UPDATE devices.last_seen      (UNNEST, one query per tenant)
    → XACK all processed message IDs
"""

import asyncio
import hashlib
import json
import logging
import os
import time
from collections import defaultdict
from datetime import datetime, timedelta
from uuid import UUID
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from smtplib import SMTP_SSL, SMTP

import aiomqtt
import redis.asyncio as aioredis
from psycopg_pool import AsyncConnectionPool
from psycopg.rows import dict_row

# ---------------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------------
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------
MQTT_BROKER   = os.getenv('MQTT_BROKER', 'mosquitto')
MQTT_PORT     = int(os.getenv('MQTT_PORT', 1883))
MQTT_USERNAME = os.getenv('MQTT_USERNAME', 'processor')
MQTT_PASSWORD = os.getenv('MQTT_PASSWORD', 'processor')

DATABASE_URL = os.getenv('DATABASE_URL', 'postgresql://postgres:postgres@postgres:5432/gito')
REDIS_URL    = os.getenv('REDIS_URL', 'redis://keydb:6379')

SMTP_HOST       = os.getenv('SMTP_HOST', '')
SMTP_PORT_NUM   = int(os.getenv('SMTP_PORT', '587'))
SMTP_USER       = os.getenv('SMTP_USER', '')
SMTP_PASSWORD   = os.getenv('SMTP_PASSWORD', '')
SMTP_FROM_EMAIL = os.getenv('SMTP_FROM_EMAIL', 'noreply@gito-iot.local')
SMTP_USE_TLS    = os.getenv('SMTP_USE_TLS', 'true').lower() == 'true'

MAX_PAYLOAD_SIZE    = 256 * 1024   # 256 KB
MAX_TELEMETRY_VALUE = 1e10
MIN_TELEMETRY_VALUE = -1e10

SYSTEM_KEYS = {"timestamp", "ts", "device_id", "tenant_id", "id", "time", "datetime"}

# Command response keys — when present in telemetry, correlate with device_commands table
COMMAND_RESPONSE_KEYS = {"command_id", "command_status", "command_result", "command_error"}

RATE_LIMIT_PER_MINUTE = int(os.getenv('RATE_LIMIT_PER_MINUTE', '60'))

# KeyDB Streams config
STREAM_KEY       = 'telemetry:ingest'
STREAM_GROUP     = 'telemetry-processors'
STREAM_CONSUMER  = 'worker-1'
STREAM_BATCH     = 500   # rows per read
STREAM_BLOCK_MS  = 100   # ms to block waiting for messages
# Reclaim pending messages older than this (ms) — handles crash recovery
PENDING_CLAIM_MS = 30_000

UNIT_CACHE_TTL = 300  # seconds


# ---------------------------------------------------------------------------
# Email
# ---------------------------------------------------------------------------
class EmailService:
    @staticmethod
    async def send_alert_email(
        recipient: str,
        device_name: str,
        metric: str,
        value: float,
        threshold: float,
        operator: str,
        tenant_name: str,
    ) -> bool:
        try:
            if not SMTP_HOST or not SMTP_USER or not SMTP_PASSWORD:
                logger.warning("SMTP configuration incomplete - skipping email")
                return False

            subject = f"Alert: {device_name} - {metric} threshold breached"
            body = EmailService._generate_alert_email_body(
                device_name, metric, value, threshold, operator, tenant_name
            )

            msg = MIMEMultipart("alternative")
            msg["Subject"] = subject
            msg["From"]    = SMTP_FROM_EMAIL
            msg["To"]      = recipient
            msg.attach(MIMEText(body, "plain"))
            msg.attach(MIMEText(EmailService._convert_to_html(body), "html"))

            if SMTP_USE_TLS:
                with SMTP(SMTP_HOST, SMTP_PORT_NUM) as server:
                    server.starttls()
                    server.login(SMTP_USER, SMTP_PASSWORD)
                    server.send_message(msg)
            else:
                with SMTP_SSL(SMTP_HOST, SMTP_PORT_NUM) as server:
                    server.login(SMTP_USER, SMTP_PASSWORD)
                    server.send_message(msg)

            logger.info(f"Alert email sent to {recipient} for {device_name}")
            return True
        except Exception as e:
            logger.error(f"Failed to send alert email: {e}")
            return False

    @staticmethod
    def _generate_alert_email_body(device_name, metric, value, threshold, operator, tenant_name) -> str:
        op_text = {
            ">": "greater than", "<": "less than",
            ">=": "greater than or equal to", "<=": "less than or equal to",
            "==": "equal to", "!=": "not equal to",
        }.get(operator, operator)
        return f"""Alert Notification

Device: {device_name}
Tenant: {tenant_name}
Metric: {metric}
Current Value: {value}
Threshold: {threshold} ({op_text})
Status: THRESHOLD BREACHED

This alert was triggered because the {metric} value ({value}) is {op_text} the configured threshold ({threshold}).

Please investigate the device status and take appropriate action.

---
Gito IoT Platform
"""

    @staticmethod
    def _convert_to_html(text: str) -> str:
        html = "<html><body><pre style='font-family: monospace'>"
        html += text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
        html += "</pre></body></html>"
        return html


# ---------------------------------------------------------------------------
# Validation
# ---------------------------------------------------------------------------
class TelemetryValidator:
    @staticmethod
    def validate_payload(payload: dict) -> bool:
        if not isinstance(payload, dict) or not payload:
            return False
        for key, value in payload.items():
            if not isinstance(key, str) or not key:
                return False
            if isinstance(value, (int, float)) and not isinstance(value, bool):
                if value > MAX_TELEMETRY_VALUE or value < MIN_TELEMETRY_VALUE:
                    return False
        return True

    @staticmethod
    def flatten_payload(payload: dict, prefix: str = "", max_depth: int = 5) -> dict:
        """
        Recursively flatten nested dicts into __ separated keys.
        {"SI7021": {"Temperature": 24.5}} → {"SI7021__Temperature": 24.5}
        """
        result = {}
        for key, value in payload.items():
            full_key = f"{prefix}__{key}" if prefix else key
            if isinstance(value, dict) and value and max_depth > 0:
                result.update(TelemetryValidator.flatten_payload(value, full_key, max_depth - 1))
            else:
                result[full_key] = value
        return result

    @staticmethod
    def is_valid_uuid(value: str) -> bool:
        try:
            UUID(value)
            return True
        except (ValueError, AttributeError, TypeError):
            return False


# ---------------------------------------------------------------------------
# Database service
# ---------------------------------------------------------------------------
class DatabaseService:
    def __init__(self, db_url: str):
        self.db_url   = db_url
        self.conn_pool: AsyncConnectionPool | None = None
        self._unit_cache: dict[str, tuple[float, dict[str, str]]] = {}
        # Device existence cache: {device_id: (monotonic_time, exists)}
        self._device_cache: dict[str, tuple[float, bool]] = {}
        self._device_cache_ttl: int = 60  # seconds
        # dev_eui → (tenant_id, device_id) cache for LoRaWAN uplinks
        self._deveui_cache: dict[str, tuple[float, tuple[str, str] | None]] = {}

    async def connect(self):
        self.conn_pool = AsyncConnectionPool(
            self.db_url,
            min_size=5,
            max_size=20,
            kwargs={"row_factory": dict_row},
        )
        await self.conn_pool.open()
        logger.info("Database connection pool created")

    async def disconnect(self):
        if self.conn_pool:
            await self.conn_pool.close()
            logger.info("Database connection pool closed")

    async def get_unit_map(self, device_id: str) -> dict[str, str]:
        """Return {metric_key: unit} from device type's data_model. Cached 5 min."""
        now = time.monotonic()
        cached = self._unit_cache.get(device_id)
        if cached and (now - cached[0]) < UNIT_CACHE_TTL:
            return cached[1]

        unit_map: dict[str, str] = {}
        try:
            async with self.conn_pool.connection() as conn:
                result = await conn.execute(
                    "SELECT dt.data_model FROM devices d "
                    "JOIN device_types dt ON d.device_type_id = dt.id WHERE d.id = %s",
                    (device_id,),
                )
                row = await result.fetchone()
                if row:
                    data_model = row.get("data_model") if isinstance(row, dict) else row[0]
                    if isinstance(data_model, list):
                        for field in data_model:
                            if isinstance(field, dict) and field.get("name") and field.get("unit"):
                                unit_map[field["name"]] = field["unit"]
        except Exception as e:
            logger.debug(f"Unit map lookup failed for {device_id}: {e}")

        self._unit_cache[device_id] = (now, unit_map)
        return unit_map

    async def device_exists(self, tenant_id: str, device_id: str) -> bool:
        """
        Check whether device_id belongs to tenant_id.
        Result cached for _device_cache_ttl seconds (default 60 s) to avoid
        a DB round-trip on every message from a known device.
        Returns False and logs a warning for unknown devices.
        """
        now = time.monotonic()
        cached = self._device_cache.get(device_id)
        if cached and (now - cached[0]) < self._device_cache_ttl:
            return cached[1]

        exists = False
        try:
            async with self.conn_pool.connection() as conn:
                result = await conn.execute(
                    "SELECT 1 FROM devices WHERE id = %s AND tenant_id = %s",
                    (device_id, tenant_id),
                )
                exists = (await result.fetchone()) is not None
        except Exception as e:
            logger.debug("Device existence check failed for %s: %s", device_id, e)
            return False  # conservative: don't cache on error, let next message retry

        self._device_cache[device_id] = (now, exists)
        if not exists:
            logger.warning(
                "Unknown device %s for tenant %s — message rejected before stream buffer",
                device_id, tenant_id,
            )
        return exists

    async def resolve_dev_eui(self, dev_eui: str) -> tuple[str, str] | None:
        """
        Resolve a LoRaWAN dev_eui to (tenant_id, device_id).
        Only returns devices that are confirmed provisioned (ttn_synced = true).
        Result cached for 60s; negative results also cached to block DB spam from
        rogue/unregistered devices.
        """
        now = time.monotonic()
        cached = self._deveui_cache.get(dev_eui)
        if cached and (now - cached[0]) < self._device_cache_ttl:
            return cached[1]

        result_val: tuple[str, str] | None = None
        try:
            async with self.conn_pool.connection() as conn:
                result = await conn.execute(
                    "SELECT tenant_id::text, id::text FROM devices "
                    "WHERE dev_eui = %s AND ttn_synced = true LIMIT 1",
                    (dev_eui,),
                )
                row = await result.fetchone()
                if row:
                    result_val = (row["tenant_id"], row["id"])
        except Exception as e:
            logger.debug("dev_eui lookup failed for %s: %s", dev_eui, e)
            return None  # don't cache on error

        self._deveui_cache[dev_eui] = (now, result_val)
        if result_val is None:
            logger.warning(
                "Unknown or unsynced dev_eui %s — uplink rejected", dev_eui
            )
        return result_val

    async def batch_insert_telemetry(self, rows: list[tuple]) -> set[str]:
        """
        Bulk-insert telemetry rows grouped by tenant (one executemany per tenant).
        Each row tuple: (tenant_id, device_id, metric_key, value_float,
                         value_str, value_json, unit, ts)

        Also batch-updates devices.last_seen per tenant using UNNEST.
        Returns: set of tenant_ids whose insert FAILED (empty set = full success).
        Callers MUST NOT ACK stream entries for failed tenants — the crash-recovery
        loop (XAUTOCLAIM) will redeliver them after PENDING_CLAIM_MS.
        """
        # Group rows by tenant for RLS context setting
        tenant_groups: dict[str, list[tuple]] = defaultdict(list)
        for row in rows:
            tenant_groups[row[0]].append(row)

        failed_tenants: set[str] = set()
        for tenant_id, tenant_rows in tenant_groups.items():
            try:
                async with self.conn_pool.connection() as conn:
                    # Set RLS context for this tenant
                    await conn.execute(
                        "SELECT set_config('app.current_tenant_id', %s, false)",
                        (tenant_id,)
                    )

                    # Batch insert all metrics for this tenant
                    async with conn.cursor() as cur:
                        await cur.executemany(
                            """
                            INSERT INTO telemetry
                                (tenant_id, device_id, metric_key,
                                 metric_value, metric_value_str, metric_value_json,
                                 unit, ts)
                            VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
                            """,
                            tenant_rows,
                        )

                    # Batch update device last_seen: collect max ts per device
                    device_ts: dict[str, datetime] = {}
                    for row in tenant_rows:
                        device_id, ts = row[1], row[7]
                        if device_id not in device_ts or ts > device_ts[device_id]:
                            device_ts[device_id] = ts

                    if device_ts:
                        device_ids  = list(device_ts.keys())
                        tenant_ids  = [tenant_id] * len(device_ids)
                        timestamps  = [device_ts[d] for d in device_ids]
                        await conn.execute(
                            """
                            UPDATE devices
                            SET last_seen = v.ts, status = 'online', updated_at = now()
                            FROM (
                                SELECT
                                    UNNEST(%s::uuid[])          AS id,
                                    UNNEST(%s::uuid[])          AS tid,
                                    UNNEST(%s::timestamptz[])   AS ts
                            ) v
                            WHERE devices.id = v.id
                              AND devices.tenant_id = v.tid
                            """,
                            (device_ids, tenant_ids, timestamps),
                        )

                    await conn.commit()

            except Exception as e:
                logger.error(
                    f"Batch insert failed for tenant {tenant_id}: {e}",
                    exc_info=True,
                )
                failed_tenants.add(tenant_id)

        return failed_tenants

    async def get_active_alert_rules(self, tenant_id: str, device_id: str) -> list:
        try:
            async with self.conn_pool.connection() as conn:
                await conn.execute(
                    "SELECT set_config('app.current_tenant_id', %s, false)", (tenant_id,)
                )
                cursor = await conn.execute(
                    """
                    SELECT id, metric, operator, threshold, cooldown_minutes, last_fired_at
                    FROM alert_rules
                    WHERE device_id = %s AND active = true AND tenant_id = %s
                    ORDER BY created_at
                    """,
                    (device_id, tenant_id),
                )
                return [dict(row) for row in await cursor.fetchall()]
        except Exception as e:
            logger.error(f"Failed to fetch alert rules: {e}", exc_info=True)
            return []

    async def fire_alert(
        self,
        tenant_id: str,
        alert_rule_id: str,
        device_id: str,
        metric_name: str,
        metric_value: float,
        message: str,
    ) -> str | None:
        try:
            async with self.conn_pool.connection() as conn:
                await conn.execute(
                    "SELECT set_config('app.current_tenant_id', %s, false)", (tenant_id,)
                )
                cursor = await conn.execute(
                    """
                    INSERT INTO alert_events
                        (tenant_id, alert_rule_id, device_id, metric_name,
                         metric_value, message, fired_at, notification_sent)
                    VALUES (%s, %s, %s, %s, %s, %s, now(), false)
                    RETURNING id
                    """,
                    (tenant_id, alert_rule_id, device_id, metric_name, metric_value, message),
                )
                row = await cursor.fetchone()
                await conn.execute(
                    "UPDATE alert_rules SET last_fired_at = now() WHERE id = %s AND tenant_id = %s",
                    (alert_rule_id, tenant_id),
                )
                await conn.commit()
                return row["id"] if row else None
        except Exception as e:
            logger.error(f"Failed to fire alert: {e}")
            return None

    async def get_device_and_tenant_info(self, tenant_id: str, device_id: str) -> dict:
        try:
            async with self.conn_pool.connection() as conn:
                await conn.execute(
                    "SELECT set_config('app.current_tenant_id', %s, false)", (tenant_id,)
                )
                cursor = await conn.execute(
                    """
                    SELECT d.name as device_name, t.name as tenant_name
                    FROM devices d JOIN tenants t ON d.tenant_id = t.id
                    WHERE d.id = %s AND d.tenant_id = %s
                    """,
                    (device_id, tenant_id),
                )
                row = await cursor.fetchone()
                return dict(row) if row else {"device_name": device_id, "tenant_name": tenant_id}
        except Exception:
            return {"device_name": device_id, "tenant_name": tenant_id}


# ---------------------------------------------------------------------------
# Redis / KeyDB service
# ---------------------------------------------------------------------------
class RedisService:
    def __init__(self, redis_url: str):
        self.redis_url = redis_url
        self.redis: aioredis.Redis | None = None

    async def connect(self):
        self.redis = await aioredis.from_url(
            self.redis_url, encoding="utf-8", decode_responses=True
        )
        logger.info("Connected to Redis/KeyDB")

    async def disconnect(self):
        if self.redis:
            await self.redis.close()
            logger.info("Disconnected from Redis/KeyDB")

    async def publish_telemetry(self, tenant_id: str, device_id: str, payload: dict):
        try:
            channel = f"telemetry:{tenant_id}:{device_id}"
            message = json.dumps({
                "device_id": device_id,
                "payload": payload,
                "timestamp": datetime.utcnow().isoformat(),
            })
            await self.redis.publish(channel, message)
        except Exception as e:
            logger.error(f"Failed to publish telemetry to Redis: {e}")

    async def publish_alert(self, tenant_id: str, device_id: str, alert_data: dict):
        try:
            channel = f"alerts:{tenant_id}:{device_id}"
            message = json.dumps({**alert_data, "timestamp": datetime.utcnow().isoformat()})
            await self.redis.publish(channel, message)
        except Exception as e:
            logger.error(f"Failed to publish alert: {e}")

    async def stream_add(
        self,
        tenant_id: str,
        device_id: str,
        payload: dict,
        timestamp: datetime,
    ) -> str | None:
        """Write one telemetry message to the KeyDB Stream. Returns stream entry ID."""
        try:
            entry_id = await self.redis.xadd(
                STREAM_KEY,
                {
                    "tenant_id": tenant_id,
                    "device_id": device_id,
                    "payload":   json.dumps(payload),
                    "timestamp": timestamp.isoformat(),
                },
                maxlen=100_000,  # cap stream at ~100k pending entries
                approximate=True,
            )
            return entry_id
        except Exception as e:
            logger.error(f"Failed to XADD to stream: {e}")
            return None

    async def ensure_consumer_group(self):
        """Create the consumer group idempotently (start from stream beginning)."""
        try:
            await self.redis.xgroup_create(STREAM_KEY, STREAM_GROUP, id="0", mkstream=True)
            logger.info(f"Created consumer group '{STREAM_GROUP}' on stream '{STREAM_KEY}'")
        except Exception as e:
            if "BUSYGROUP" in str(e):
                logger.debug(f"Consumer group '{STREAM_GROUP}' already exists")
            else:
                logger.error(f"Failed to create consumer group: {e}")
                raise


# ---------------------------------------------------------------------------
# Alert evaluator
# ---------------------------------------------------------------------------
class AlertEvaluator:
    OPERATORS = {
        'gt':  lambda v, t: v > t,
        'gte': lambda v, t: v >= t,
        'lt':  lambda v, t: v < t,
        'lte': lambda v, t: v <= t,
        'eq':  lambda v, t: v == t,
        'neq': lambda v, t: v != t,
    }

    @staticmethod
    def should_fire_alert(rule: dict, metric_value: float, current_time: datetime) -> bool:
        operator      = rule.get('operator')
        threshold     = rule.get('threshold')
        last_fired_at = rule.get('last_fired_at')
        cooldown_min  = rule.get('cooldown_minutes', 0)

        if operator not in AlertEvaluator.OPERATORS:
            return False
        if not AlertEvaluator.OPERATORS[operator](metric_value, threshold):
            return False
        if last_fired_at and current_time < last_fired_at + timedelta(minutes=cooldown_min):
            return False
        return True


# ---------------------------------------------------------------------------
# Stream consumer — reads batches from KeyDB Stream, batch-inserts to DB
# ---------------------------------------------------------------------------
class StreamConsumer:
    """
    Runs as an asyncio task alongside the MQTT listener.

    Read loop:
      XREADGROUP GROUP telemetry-processors worker-1 COUNT 500 BLOCK 100 ms
      → decode rows
      → resolve units (cached)
      → DatabaseService.batch_insert_telemetry()
      → XACK all processed IDs

    Crash-recovery loop (every 30 s):
      XAUTOCLAIM old pending entries (stale > 30 s) and reprocess them.
    """

    def __init__(self, db_service: DatabaseService, redis_service: RedisService):
        self.db    = db_service
        self.redis = redis_service
        self._running = False

    async def start(self):
        await self.redis.ensure_consumer_group()
        self._running = True
        logger.info("Stream consumer started")

    async def stop(self):
        self._running = False

    def _decode_stream_entry(self, data: dict) -> tuple | None:
        """Decode a raw stream entry dict into (tenant_id, device_id, payload, timestamp)."""
        try:
            return (
                data["tenant_id"],
                data["device_id"],
                json.loads(data["payload"]),
                datetime.fromisoformat(data["timestamp"]),
            )
        except (KeyError, ValueError, json.JSONDecodeError) as e:
            logger.warning(f"Malformed stream entry: {e}")
            return None

    async def _process_entries(self, entries: list[tuple[str, dict]]) -> list[str]:
        """
        Convert raw stream entries to DB rows, batch-insert, return ACK IDs.

        At-least-once semantics: a msg_id is returned (and thus ACKed) ONLY when
        its tenant's batch insert succeeded. Failed tenants' messages remain in the
        pending list so _reclaim_pending retries them after PENDING_CLAIM_MS.

        Malformed entries (bad JSON / missing fields) are always ACKed — they
        cannot be fixed by retrying, so keeping them pending would block the stream.
        """
        rows: list[tuple] = []
        msg_tenant: dict[str, str] = {}        # msg_id → tenant_id
        unconditional_ack: list[str] = []      # malformed entries — always ACK

        for msg_id, data in entries:
            decoded = self._decode_stream_entry(data)
            if not decoded:
                # Malformed — ACK immediately, retrying would never succeed
                unconditional_ack.append(msg_id)
                continue

            tenant_id, device_id, payload, timestamp = decoded
            unit_map = await self.db.get_unit_map(device_id)
            msg_tenant[msg_id] = tenant_id

            for metric_key, metric_value in payload.items():
                if metric_value is None:
                    continue

                value_float = value_str = value_json = None
                if isinstance(metric_value, (int, float)) and not isinstance(metric_value, bool):
                    value_float = float(metric_value)
                elif isinstance(metric_value, str):
                    value_str = metric_value
                elif isinstance(metric_value, (dict, list)):
                    value_json = json.dumps(metric_value)
                else:
                    value_str = str(metric_value)

                rows.append((
                    tenant_id, device_id, metric_key,
                    value_float, value_str, value_json,
                    unit_map.get(metric_key),
                    timestamp,
                ))

        failed_tenants: set[str] = set()
        if rows:
            failed_tenants = await self.db.batch_insert_telemetry(rows)

        if failed_tenants:
            logger.warning(
                "Batch insert failed for %d tenant(s) — NOT ACKing; will retry in %d ms: %s",
                len(failed_tenants), PENDING_CLAIM_MS, failed_tenants,
            )

        # ACK: unconditional (malformed) + all msgs whose tenant insert succeeded
        ack_ids = unconditional_ack + [
            msg_id for msg_id, tenant_id in msg_tenant.items()
            if tenant_id not in failed_tenants
        ]
        return ack_ids

    async def run(self):
        """Main read loop — runs until self._running is False."""
        last_reclaim = time.monotonic()

        while self._running:
            try:
                # ── Read new messages ────────────────────────────────────
                results = await self.redis.redis.xreadgroup(
                    STREAM_GROUP,
                    STREAM_CONSUMER,
                    {STREAM_KEY: ">"},
                    count=STREAM_BATCH,
                    block=STREAM_BLOCK_MS,
                )

                if results:
                    _stream, entries = results[0]
                    if entries:
                        ack_ids = await self._process_entries(entries)
                        if ack_ids:
                            await self.redis.redis.xack(STREAM_KEY, STREAM_GROUP, *ack_ids)
                        logger.debug(
                            f"Stream consumer: processed {len(entries)} messages, "
                            f"inserted {sum(1 for _ in entries)} entries"
                        )

                # ── Periodic pending reclaim (crash recovery) ────────────
                now = time.monotonic()
                if now - last_reclaim > 30:
                    last_reclaim = now
                    await self._reclaim_pending()

            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.error(f"Stream consumer error: {e}", exc_info=True)
                await asyncio.sleep(1)

    async def _reclaim_pending(self):
        """Re-process messages that have been pending too long (e.g. after a crash)."""
        try:
            result = await self.redis.redis.xautoclaim(
                STREAM_KEY,
                STREAM_GROUP,
                STREAM_CONSUMER,
                PENDING_CLAIM_MS,
                "0-0",
                count=STREAM_BATCH,
            )
            # xautoclaim returns (next_start_id, entries, deleted_ids)
            entries = result[1] if result and len(result) > 1 else []
            if entries:
                logger.info(f"Reclaimed {len(entries)} pending stream entries")
                ack_ids = await self._process_entries(entries)
                if ack_ids:
                    await self.redis.redis.xack(STREAM_KEY, STREAM_GROUP, *ack_ids)
        except Exception as e:
            logger.debug(f"Pending reclaim skipped: {e}")


# ---------------------------------------------------------------------------
# Main processor
# ---------------------------------------------------------------------------
# ---------------------------------------------------------------------------
# Redis → MQTT Command Bridge
# ---------------------------------------------------------------------------
class CommandBridge:
    """
    Subscribes to Redis pub/sub command channels and republishes messages to
    the MQTT broker so that devices actually receive commands.

    The API publishes commands to Redis channel:
        {tenant_id}/devices/{device_id}/commands

    This bridge pattern-subscribes to `*/devices/*/commands` and forwards
    each message verbatim to the same topic on Mosquitto.  The channel name
    IS the MQTT topic, so no transformation is needed.

    A dedicated Redis connection is used because pub/sub mode blocks the
    connection — it cannot share the main RedisService connection.
    """

    RETRY_DELAY_S = 1.0

    def __init__(self, redis_url: str, mqtt_client: aiomqtt.Client):
        self.redis_url   = redis_url
        self.mqtt_client = mqtt_client
        self._running    = True

    async def run(self) -> None:
        while self._running:
            try:
                async with aioredis.from_url(self.redis_url, decode_responses=True) as redis:
                    async with redis.pubsub() as ps:
                        await ps.psubscribe("*/devices/*/commands")
                        logger.info("CommandBridge subscribed to */devices/*/commands")
                        async for msg in ps.listen():
                            if not self._running:
                                break
                            if msg["type"] != "pmessage":
                                continue
                            mqtt_topic = msg["channel"]
                            payload    = msg["data"]
                            try:
                                await self.mqtt_client.publish(mqtt_topic, payload)
                                logger.debug(
                                    "CommandBridge forwarded command to MQTT topic %s", mqtt_topic
                                )
                            except Exception as pub_err:
                                logger.error(
                                    "CommandBridge failed to publish to %s: %s",
                                    mqtt_topic, pub_err,
                                )
            except asyncio.CancelledError:
                break
            except Exception as e:
                if self._running:
                    logger.error(
                        "CommandBridge Redis connection error: %s — retrying in %.1fs",
                        e, self.RETRY_DELAY_S,
                    )
                    await asyncio.sleep(self.RETRY_DELAY_S)


class MQTTProcessor:
    """
    Orchestrates MQTT ingestion, KeyDB Stream buffering, and alert evaluation.

    On each MQTT message:
      1. Validate / deduplicate / rate-limit
      2. XADD to KeyDB Stream  (fast, non-blocking DB write)
      3. Publish to Redis pub/sub (WebSocket real-time)
      4. Evaluate alert rules inline (reads payload from memory)

    StreamConsumer task runs concurrently and drains the stream in batches.
    """

    def __init__(self):
        self.db_service     = DatabaseService(DATABASE_URL)
        self.redis_service  = RedisService(REDIS_URL)
        self.validator      = TelemetryValidator()
        self.stream_consumer: StreamConsumer | None = None
        self.running        = False

    async def start(self):
        logger.info("Starting MQTT Processor...")
        await self.db_service.connect()
        await self.redis_service.connect()
        self.stream_consumer = StreamConsumer(self.db_service, self.redis_service)
        await self.stream_consumer.start()
        self.running = True
        logger.info("MQTT Processor started")

    async def stop(self):
        logger.info("Stopping MQTT Processor...")
        self.running = False
        if self.stream_consumer:
            await self.stream_consumer.stop()
        await self.redis_service.disconnect()
        await self.db_service.disconnect()
        logger.info("MQTT Processor stopped")

    async def process_telemetry(self, topic: str, payload_bytes: bytes):
        """
        Process one MQTT message.
        Topic format: {tenant_id}/devices/{device_id}/telemetry
        """
        try:
            topic_str = str(topic)
            parts = topic_str.split('/')
            if len(parts) != 4 or parts[1] != 'devices' or parts[3] != 'telemetry':
                logger.warning(f"Invalid topic format: {topic}")
                return

            tenant_id = parts[0]
            device_id = parts[2]

            if not self.validator.is_valid_uuid(tenant_id):
                logger.warning(f"Invalid tenant_id: {tenant_id}")
                return
            if not self.validator.is_valid_uuid(device_id):
                logger.warning(f"Invalid device_id: {device_id}")
                return

            # Device existence check — rejects unknown devices before hitting Redis/DB
            if not await self.db_service.device_exists(tenant_id, device_id):
                return

            # Deduplication: skip exact-same payload within 5 seconds
            payload_hash = hashlib.sha256(payload_bytes).hexdigest()[:16]
            dedup_key = f"dedup:{device_id}:{payload_hash}"
            if await self.redis_service.redis.set(dedup_key, 1, nx=True, ex=5) is None:
                logger.debug("Duplicate message skipped for device %s", device_id)
                return

            # Per-device rate limiting (sliding 60-second window)
            rate_key  = f"rate:{device_id}:{int(time.time()) // 60}"
            msg_count = await self.redis_service.redis.incr(rate_key)
            if msg_count == 1:
                await self.redis_service.redis.expire(rate_key, 120)
            if msg_count > RATE_LIMIT_PER_MINUTE:
                logger.warning(
                    "Rate limit exceeded for device %s (%d msgs/min, limit %d)",
                    device_id, msg_count, RATE_LIMIT_PER_MINUTE,
                )
                return

            # Parse payload
            try:
                payload = json.loads(payload_bytes.decode('utf-8'))
            except (json.JSONDecodeError, UnicodeDecodeError) as e:
                logger.warning(f"Failed to parse payload for {device_id}: {e}")
                return

            if isinstance(payload, dict):
                payload = {k: v for k, v in payload.items() if k not in SYSTEM_KEYS}
                payload = TelemetryValidator.flatten_payload(payload)

            if not self.validator.validate_payload(payload):
                logger.warning(f"Invalid payload structure for {device_id}")
                return

            timestamp = datetime.utcnow()

            # ── Write to KeyDB Stream (async buffer) ─────────────────────
            entry_id = await self.redis_service.stream_add(
                tenant_id, device_id, payload, timestamp
            )
            if not entry_id:
                logger.error(f"Failed to buffer telemetry for {device_id}")
                return

            # ── Update digital twin cache (last-known-value per device) ──
            try:
                cache_key = f"device:{device_id}:latest"
                flat_metrics = {"_updated_at": timestamp.isoformat()}
                for k, v in payload.items():
                    flat_metrics[k] = str(v)
                await self.redis_service.redis.hset(cache_key, mapping=flat_metrics)
            except Exception as _dt_err:
                logger.warning("Digital twin update failed for %s: %s", device_id, _dt_err)

            # ── Publish to pub/sub for WebSocket delivery ─────────────────
            await self.redis_service.publish_telemetry(tenant_id, device_id, payload)

            # ── Evaluate alert rules (inline, payload in memory) ──────────
            await self.evaluate_alerts(tenant_id, device_id, payload, timestamp)

            # ── Correlate command responses (RPC Option B) ────────────────
            if "command_id" in payload:
                await self._handle_command_response(tenant_id, device_id, payload)

            logger.info(
                "Telemetry buffered",
                extra={
                    "tenant_id": tenant_id,
                    "device_id": device_id,
                    "metrics":   len(payload),
                    "stream_id": entry_id,
                },
            )

        except Exception as e:
            logger.error(f"Error processing telemetry: {e}", exc_info=True)

    async def evaluate_alerts(
        self,
        tenant_id: str,
        device_id: str,
        payload: dict,
        timestamp: datetime,
    ):
        try:
            rules = await self.db_service.get_active_alert_rules(tenant_id, device_id)
            context = await self.db_service.get_device_and_tenant_info(tenant_id, device_id)

            for rule in rules:
                metric_name  = rule.get('metric')
                if metric_name not in payload:
                    continue
                metric_value = payload[metric_name]
                if metric_value is None:
                    continue

                if AlertEvaluator.should_fire_alert(rule, metric_value, timestamp):
                    message = (
                        f"{metric_name} {rule.get('operator')} {rule.get('threshold')} "
                        f"(current: {metric_value})"
                    )
                    alert_event_id = await self.db_service.fire_alert(
                        tenant_id, rule.get('id'), device_id,
                        metric_name, metric_value, message,
                    )
                    await self.redis_service.publish_alert(
                        tenant_id, device_id,
                        {
                            "alert_rule_id": rule.get('id'),
                            "device_id":     device_id,
                            "metric":        metric_name,
                            "value":         metric_value,
                            "message":       message,
                        },
                    )
                    if alert_event_id:
                        await self._queue_notification(tenant_id, alert_event_id)

                    logger.info(
                        "Alert fired",
                        extra={
                            "tenant_id":    tenant_id,
                            "device_id":    device_id,
                            "alert_rule":   rule.get('id'),
                            "metric":       metric_name,
                            "value":        metric_value,
                        },
                    )
        except Exception as e:
            logger.error(f"Error evaluating alerts for {device_id}: {e}")

    async def _queue_notification(self, tenant_id: str, alert_event_id: str) -> None:
        try:
            async with self.db_service.conn_pool.connection() as conn:
                await conn.execute(
                    "SELECT set_config('app.current_tenant_id', %s, false)", (tenant_id,)
                )
                await conn.execute(
                    """
                    INSERT INTO notification_queue (tenant_id, alert_event_id, status, created_at)
                    VALUES (%s, %s, 'pending', now())
                    ON CONFLICT (alert_event_id) DO NOTHING
                    """,
                    (tenant_id, alert_event_id),
                )
                await conn.commit()
        except Exception as e:
            logger.error(f"Failed to queue notification for alert {alert_event_id}: {e}")

    async def _handle_command_response(
        self, tenant_id: str, device_id: str, payload: dict
    ) -> None:
        """Correlate a device's telemetry response with a pending command (RPC Option B).

        When telemetry contains a 'command_id' key, look up the matching
        device_commands row and update its status/response.
        """
        command_id = payload.get("command_id")
        if not command_id:
            return

        status_val = payload.get("command_status", "executed")
        error = payload.get("command_error")
        # Build response from non-command keys
        result = {
            k: v for k, v in payload.items()
            if k not in COMMAND_RESPONSE_KEYS
        }

        try:
            async with self.db_service.conn_pool.connection() as conn:
                await conn.execute(
                    "SELECT set_config('app.current_tenant_id', %s, false)",
                    (tenant_id,),
                )
                cur = await conn.execute(
                    """UPDATE device_commands
                       SET status = %s,
                           response = %s::jsonb,
                           error_message = %s,
                           completed_at = now()
                       WHERE id = %s::uuid
                         AND tenant_id = %s::uuid
                         AND device_id = %s::uuid
                         AND status IN ('pending', 'sent', 'delivered')""",
                    (status_val, json.dumps(result), error,
                     command_id, tenant_id, device_id),
                )
                await conn.commit()
                if cur.rowcount:
                    logger.info(
                        "Command response correlated",
                        extra={
                            "command_id": command_id,
                            "device_id": device_id,
                            "status": status_val,
                        },
                    )
        except Exception as e:
            logger.error(
                "Failed to correlate command response %s: %s", command_id, e
            )

    async def _process_chirpstack_uplink(self, dev_eui: str, payload_bytes: bytes) -> None:
        """
        Handle a ChirpStack v4 MQTT uplink.
        Topic: application/{applicationId}/device/{devEui}/event/up

        ChirpStack publishes decoded sensor data in the 'object' field.
        We also capture LoRaWAN radio metadata as __lora_* internal metrics
        so operators can create alert rules on signal quality (RSSI, SNR).
        """
        try:
            # 1. Parse JSON
            try:
                cs_msg = json.loads(payload_bytes.decode("utf-8"))
            except (json.JSONDecodeError, UnicodeDecodeError) as e:
                logger.warning("ChirpStack uplink parse error from dev_eui %s: %s", dev_eui, e)
                return

            # 2. Resolve dev_eui → (tenant_id, device_id)
            resolved = await self.db_service.resolve_dev_eui(dev_eui)
            if resolved is None:
                return  # warning already logged by resolve_dev_eui
            tenant_id, device_id = resolved

            # 3. Deduplicate via ChirpStack's own deduplication ID (5s TTL)
            dedup_id = cs_msg.get("deduplicationId", "")
            if dedup_id:
                dedup_key = f"cs_dedup:{dedup_id}"
                if await self.redis_service.redis.set(dedup_key, 1, nx=True, ex=5) is None:
                    logger.debug("Duplicate ChirpStack uplink skipped for dev_eui %s", dev_eui)
                    return

            # 4. Rate-limit (same sliding window as MQTT path)
            rate_key  = f"rate:{device_id}:{int(time.time()) // 60}"
            msg_count = await self.redis_service.redis.incr(rate_key)
            if msg_count == 1:
                await self.redis_service.redis.expire(rate_key, 120)
            if msg_count > RATE_LIMIT_PER_MINUTE:
                logger.warning(
                    "Rate limit exceeded for LoRaWAN device %s (%d msgs/min, limit %d)",
                    device_id, msg_count, RATE_LIMIT_PER_MINUTE,
                )
                return

            # 5. Extract decoded sensor data from the 'object' field
            sensor_data = cs_msg.get("object")
            if not sensor_data or not isinstance(sensor_data, dict):
                logger.warning(
                    "ChirpStack uplink for dev_eui %s has no decoded 'object' — "
                    "configure a payload codec in ChirpStack for application %s",
                    dev_eui,
                    cs_msg.get("deviceInfo", {}).get("applicationId", "unknown"),
                )
                return

            # 6. Strip system keys and flatten nested dicts
            payload = {k: v for k, v in sensor_data.items() if k not in SYSTEM_KEYS}
            payload = TelemetryValidator.flatten_payload(payload)

            if not self.validator.validate_payload(payload):
                logger.warning("Invalid ChirpStack payload structure for dev_eui %s", dev_eui)
                return

            # 7. Extract LoRaWAN radio metadata as internal __lora_* metrics
            rx_info = cs_msg.get("rxInfo", [])
            tx_info = cs_msg.get("txInfo", {})
            if rx_info and isinstance(rx_info, list):
                best_gw = rx_info[0]  # first entry is best gateway (ChirpStack ordering)
                if "rssi" in best_gw:
                    payload["__lora_rssi"] = float(best_gw["rssi"])
                if "snr" in best_gw:
                    payload["__lora_snr"] = float(best_gw["snr"])
                if "gatewayId" in best_gw:
                    payload["__lora_gateway_id"] = str(best_gw["gatewayId"])
            if "frequency" in tx_info:
                payload["__lora_frequency"] = float(tx_info["frequency"])
            lora_mod = tx_info.get("modulation", {}).get("lora", {})
            if "spreadingFactor" in lora_mod:
                payload["__lora_spreading_factor"] = float(lora_mod["spreadingFactor"])
            if "fCnt" in cs_msg:
                payload["__lora_frame_count"] = float(cs_msg["fCnt"])
            if "dr" in cs_msg:
                payload["__lora_data_rate"] = float(cs_msg["dr"])

            timestamp = datetime.utcnow()

            # 8. Buffer to KeyDB Stream
            entry_id = await self.redis_service.stream_add(
                tenant_id, device_id, payload, timestamp
            )
            if not entry_id:
                logger.error("Failed to buffer ChirpStack uplink for dev_eui %s", dev_eui)
                return

            # 9. Publish to pub/sub for WebSocket real-time delivery
            await self.redis_service.publish_telemetry(tenant_id, device_id, payload)

            # 10. Evaluate alert rules (inline — works on __lora_* metrics too)
            await self.evaluate_alerts(tenant_id, device_id, payload, timestamp)

            # 11. Correlate command responses (device may echo back command_id in object)
            if "command_id" in payload:
                await self._handle_command_response(tenant_id, device_id, payload)

            logger.info(
                "ChirpStack uplink buffered",
                extra={
                    "tenant_id":  tenant_id,
                    "device_id":  device_id,
                    "dev_eui":    dev_eui,
                    "metrics":    len(payload),
                    "stream_id":  entry_id,
                },
            )

        except Exception as e:
            logger.error("Error processing ChirpStack uplink from %s: %s", dev_eui, e, exc_info=True)

    async def run(self):
        """Main entry point — starts MQTT listener and stream consumer concurrently."""
        await self.start()

        try:
            async with aiomqtt.Client(
                MQTT_BROKER,
                port=MQTT_PORT,
                username=MQTT_USERNAME,
                password=MQTT_PASSWORD,
            ) as client:
                logger.info(f"Connected to MQTT broker at {MQTT_BROKER}:{MQTT_PORT}")

                # Subscribe to native-MQTT device telemetry
                await client.subscribe("+/devices/+/telemetry")
                logger.info("Subscribed to +/devices/+/telemetry")

                # Subscribe to ChirpStack uplinks (forwarded via ChirpStack MQTT integration)
                await client.subscribe("application/+/device/+/event/up")
                logger.info("Subscribed to application/+/device/+/event/up (ChirpStack uplinks)")

                # Run stream consumer concurrently with MQTT listener
                consumer_task = asyncio.create_task(self.stream_consumer.run())

                # Run Redis→MQTT command bridge concurrently
                bridge = CommandBridge(REDIS_URL, client)
                bridge_task = asyncio.create_task(bridge.run())

                try:
                    async for message in client.messages:
                        if not self.running:
                            break
                        topic_str = str(message.topic)
                        parts = topic_str.split("/")

                        if (len(parts) == 4
                                and parts[1] == "devices"
                                and parts[3] == "telemetry"):
                            # Native MQTT device telemetry
                            await self.process_telemetry(message.topic, message.payload)

                        elif (len(parts) == 6
                              and parts[0] == "application"
                              and parts[2] == "device"
                              and parts[4] == "event"):
                            # ChirpStack event — only process uplinks for now
                            if parts[5] == "up":
                                await self._process_chirpstack_uplink(parts[3], message.payload)
                            # Future: handle 'join', 'status', 'ack', 'location' events

                        else:
                            logger.debug("Ignoring unknown topic: %s", topic_str)

                finally:
                    consumer_task.cancel()
                    bridge_task.cancel()
                    for task in (consumer_task, bridge_task):
                        try:
                            await task
                        except asyncio.CancelledError:
                            pass

        except Exception as e:
            logger.error(f"MQTT connection error: {e}", exc_info=True)
        finally:
            await self.stop()


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------
async def main():
    processor = MQTTProcessor()
    try:
        await processor.run()
    except KeyboardInterrupt:
        logger.info("Received interrupt signal")
        await processor.stop()


if __name__ == "__main__":
    asyncio.run(main())