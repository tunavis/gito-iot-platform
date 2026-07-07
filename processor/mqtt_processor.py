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
from datetime import datetime, timedelta, timezone
from uuid import UUID
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from smtplib import SMTP_SSL, SMTP

import aiomqtt
import redis.asyncio as aioredis
from psycopg_pool import AsyncConnectionPool
from psycopg.rows import dict_row

from alarm_core import Rule as AlarmRule, evaluate as evaluate_alarm_rules

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
RULES_CACHE_TTL_S = int(os.getenv('RULES_CACHE_TTL_S', '30'))

# ChirpStack MQTT Bridge config
BRIDGE_SYNC_INTERVAL_S  = 60    # seconds between periodic DB syncs
BRIDGE_LOCK_TTL_S       = 90    # Redis lock TTL — lost if process crashes
BRIDGE_LOCK_RENEW_S     = 30    # renew lock every N seconds
BRIDGE_BACKOFF_BASE_S   = 1.0   # initial reconnect backoff
BRIDGE_BACKOFF_MAX_S    = 60.0  # max reconnect backoff
BRIDGE_AUTH_FAIL_MAX    = 5     # stop retrying after N consecutive auth failures
BRIDGE_COUNT_FLUSH_S    = 30    # flush message_count to DB every N seconds
BRIDGE_UNKNOWN_DEV_TTL_S = 7 * 24 * 3600  # 7 days

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
        # key_mapping cache: {device_id: (monotonic_time, {raw_key: canonical_key})}
        self._key_mapping_cache: dict[str, tuple[float, dict[str, str]]] = {}
        # alert rules cache: {(tenant_id, device_id): (expires_monotonic, rules)}
        self._rules_cache: dict[tuple[str, str], tuple[float, list]] = {}

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

    async def get_key_mapping(self, device_id: str) -> dict[str, str]:
        """Return {raw_key: canonical_key} from device type's key_mapping. Cached 5 min."""
        now = time.monotonic()
        cached = self._key_mapping_cache.get(device_id)
        if cached and (now - cached[0]) < UNIT_CACHE_TTL:
            return cached[1]

        mapping: dict[str, str] = {}
        try:
            async with self.conn_pool.connection() as conn:
                result = await conn.execute(
                    "SELECT dt.key_mapping FROM devices d "
                    "JOIN device_types dt ON d.device_type_id = dt.id WHERE d.id = %s",
                    (device_id,),
                )
                row = await result.fetchone()
                if row:
                    raw = row.get("key_mapping") if isinstance(row, dict) else row[0]
                    if isinstance(raw, dict):
                        mapping = raw
        except Exception as e:
            logger.debug(f"Key mapping lookup failed for {device_id}: {e}")

        self._key_mapping_cache[device_id] = (now, mapping)
        return mapping

    def apply_key_mapping(self, payload: dict, mapping: dict[str, str]) -> dict:
        """Rename payload keys using the mapping. Unmapped keys pass through as-is."""
        if not mapping:
            return payload
        return {mapping.get(k, k): v for k, v in payload.items()}

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
        Only returns devices that have a dev_eui registered.
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
                    "WHERE dev_eui = %s LIMIT 1",
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
        """Fetch THRESHOLD + COMPOSITE rules for a device, including tenant-global
        rules (device_id IS NULL). Cached ~30s per (tenant, device) — invalidated
        on firing so cooldown state stays fresh."""
        cache_key = (tenant_id, device_id)
        cached = self._rules_cache.get(cache_key)
        if cached and cached[0] > time.monotonic():
            return cached[1]
        try:
            async with self.conn_pool.connection() as conn:
                await conn.execute(
                    "SELECT set_config('app.current_tenant_id', %s, false)", (tenant_id,)
                )
                cursor = await conn.execute(
                    """
                    SELECT id, rule_type, metric, operator, threshold,
                           conditions, logic, severity,
                           cooldown_minutes, last_fired_at
                    FROM alert_rules
                    WHERE active = true AND tenant_id = %s
                      AND (device_id = %s OR device_id IS NULL)
                    ORDER BY created_at
                    """,
                    (tenant_id, device_id),
                )
                rules = [dict(row) for row in await cursor.fetchall()]
                self._rules_cache[cache_key] = (time.monotonic() + RULES_CACHE_TTL_S, rules)
                return rules
        except Exception as e:
            logger.error(f"Failed to fetch alert rules: {e}", exc_info=True)
            return []

    def invalidate_rules_cache(self, tenant_id: str, device_id: str) -> None:
        self._rules_cache.pop((tenant_id, device_id), None)

    async def fire_alert(
        self,
        tenant_id: str,
        alert_rule_id: str,
        device_id: str,
        metric_name: str | None,
        metric_value: float | None,
        message: str,
        severity: str = "MAJOR",
        rule_type: str = "THRESHOLD",
    ) -> str | None:
        """Record a firing: append an alert_event, bump the rule's cooldown, and
        UPSERT the lifecycle alarm — all atomically. The alarm dedups on the
        partial unique index (one ACTIVE alarm per rule+device); a re-fire bumps
        occurrence_count in context instead of creating a duplicate."""
        alarm_type = metric_name if metric_name else "composite"
        try:
            async with self.conn_pool.connection() as conn:
                await conn.execute(
                    "SELECT set_config('app.current_tenant_id', %s, false)", (tenant_id,)
                )
                cursor = await conn.execute(
                    """
                    INSERT INTO alert_events
                        (tenant_id, alert_rule_id, device_id, metric_name,
                         metric_value, message, severity, fired_at, notification_sent)
                    VALUES (%s, %s, %s, %s, %s, %s, %s, now(), false)
                    RETURNING id
                    """,
                    (tenant_id, alert_rule_id, device_id, metric_name, metric_value, message, severity),
                )
                row = await cursor.fetchone()
                alert_event_id = row["id"] if row else None

                # Lifecycle alarm — new ACTIVE row, or occurrence bump if one is open.
                await conn.execute(
                    """
                    INSERT INTO alarms
                        (tenant_id, alert_rule_id, device_id, alarm_type, source,
                         severity, status, message, context, fired_at)
                    VALUES (%s, %s, %s, %s, %s, %s, 'ACTIVE', %s,
                            jsonb_build_object(
                                'occurrence_count', 1,
                                'rule_type', %s::text,
                                'metric', %s::text,
                                'value', %s::double precision,
                                'last_event_id', %s::text
                            ),
                            now())
                    ON CONFLICT (alert_rule_id, device_id) WHERE status = 'ACTIVE'
                        AND alert_rule_id IS NOT NULL AND device_id IS NOT NULL
                    DO UPDATE SET
                        severity   = EXCLUDED.severity,
                        message    = EXCLUDED.message,
                        updated_at = now(),
                        context    = COALESCE(alarms.context, '{}'::jsonb) || jsonb_build_object(
                            'occurrence_count',
                                COALESCE((alarms.context->>'occurrence_count')::int, 1) + 1,
                            'last_value', EXCLUDED.context->'value',
                            'last_seen_event_id', EXCLUDED.context->'last_event_id'
                        )
                    """,
                    (
                        tenant_id, alert_rule_id, device_id, alarm_type, f"device:{device_id}",
                        severity, message, rule_type, metric_name, metric_value, alert_event_id,
                    ),
                )

                await conn.execute(
                    "UPDATE alert_rules SET last_fired_at = now() WHERE id = %s AND tenant_id = %s",
                    (alert_rule_id, tenant_id),
                )
                await conn.commit()
                # cooldown state changed — next evaluation must see fresh last_fired_at
                self.invalidate_rules_cache(tenant_id, device_id)
                return alert_event_id
        except Exception as e:
            logger.error(f"Failed to fire alert: {e}")
            return None


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

    def __init__(self, db_service: DatabaseService, redis_service: RedisService, evaluate_fn=None):
        self.db    = db_service
        self.redis = redis_service
        # Alarm evaluation happens HERE, at the single consumption point, so every
        # ingest path that reaches the stream gets identical alarm behavior.
        self._evaluate_fn = evaluate_fn
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
        evaluations: list[tuple] = []          # (tenant_id, device_id, payload, timestamp)

        for msg_id, data in entries:
            decoded = self._decode_stream_entry(data)
            if not decoded:
                # Malformed — ACK immediately, retrying would never succeed
                unconditional_ack.append(msg_id)
                continue

            tenant_id, device_id, payload, timestamp = decoded
            unit_map = await self.db.get_unit_map(device_id)
            msg_tenant[msg_id] = tenant_id
            evaluations.append(decoded)

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

        # Evaluate alarms for successfully-inserted messages. Evaluation failures
        # must never block ACKs — alarms are best-effort per message, telemetry
        # durability is not.
        if self._evaluate_fn:
            for tenant_id, device_id, payload, timestamp in evaluations:
                if tenant_id in failed_tenants:
                    continue
                try:
                    await self._evaluate_fn(tenant_id, device_id, payload, timestamp)
                except Exception as e:
                    logger.error(f"Alarm evaluation failed for {device_id}: {e}")

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


# ---------------------------------------------------------------------------
# ChirpStack MQTT Bridge — outbound connection per tenant integration
# ---------------------------------------------------------------------------

class BridgeWorker:
    """
    Manages one outbound MQTT connection to a tenant's ChirpStack broker.

    Lifecycle: started by ChirpStackBridgeManager, cancelled when the
    integration is deleted/disabled or config changes.
    """

    def __init__(
        self,
        integration_id: str,
        config: dict,
        db_service,
        redis_service,
        process_uplink_fn,
    ):
        self.integration_id = integration_id
        self.config = config
        self.db_service = db_service
        self.redis_service = redis_service
        self._process_uplink = process_uplink_fn
        self._pending_count = 0

    async def run(self) -> None:
        """Run with exponential backoff reconnection. Stops after too many auth failures."""
        redis = self.redis_service.redis
        lock_key = f"bridge:lock:{self.integration_id}"
        status_key = f"bridge:status:{self.integration_id}"
        auth_failures = 0
        backoff = BRIDGE_BACKOFF_BASE_S

        while True:
            # Acquire distributed lock — skip if another instance holds it
            acquired = await redis.set(lock_key, "1", nx=True, ex=BRIDGE_LOCK_TTL_S)
            if not acquired:
                logger.info("Bridge lock held by another instance for %s — skipping", self.integration_id)
                await asyncio.sleep(BRIDGE_SYNC_INTERVAL_S)
                continue

            try:
                await self._run_connection(redis, lock_key, status_key)
                auth_failures = 0
                backoff = BRIDGE_BACKOFF_BASE_S
            except aiomqtt.MqttError as e:
                err_str = str(e).lower()
                if "not authorised" in err_str or "unauthorized" in err_str or "authentication" in err_str:
                    auth_failures += 1
                    logger.error(
                        "ChirpStack bridge auth failure %d/%d for integration %s: %s",
                        auth_failures, BRIDGE_AUTH_FAIL_MAX, self.integration_id, e,
                    )
                    if auth_failures >= BRIDGE_AUTH_FAIL_MAX:
                        await redis.set(status_key, "error: authentication failed (retries exhausted)", ex=3600)
                        logger.error(
                            "ChirpStack bridge %s stopped — too many auth failures. Fix credentials and re-enable.",
                            self.integration_id,
                        )
                        return
                else:
                    logger.warning("ChirpStack bridge %s disconnected: %s — retrying in %.0fs", self.integration_id, e, backoff)
            except asyncio.CancelledError:
                logger.info("ChirpStack bridge %s cancelled — disconnecting", self.integration_id)
                # Release both keys — we hold the lock here, and leaving it to TTL-expire
                # stalls the replacement worker for up to BRIDGE_LOCK_TTL_S after a config change.
                await redis.delete(status_key)
                await redis.delete(lock_key)
                raise
            except Exception as e:
                logger.error("ChirpStack bridge %s unexpected error: %s", self.integration_id, e, exc_info=True)

            await redis.set(status_key, "reconnecting", ex=BRIDGE_LOCK_TTL_S)
            await redis.delete(lock_key)
            await asyncio.sleep(backoff)
            backoff = min(backoff * 2, BRIDGE_BACKOFF_MAX_S)

    async def _run_connection(self, redis, lock_key: str, status_key: str) -> None:
        """Establish and maintain one MQTT connection."""
        cfg = self.config
        broker = cfg.get("broker_url", "")
        port = int(cfg.get("port", 1883))
        username = cfg.get("username") or None
        password = cfg.get("password") or None
        tls_params = aiomqtt.TLSParameters() if cfg.get("tls") else None

        connect_kwargs: dict = dict(hostname=broker, port=port)
        if username:
            connect_kwargs["username"] = username
        if password:
            connect_kwargs["password"] = password
        if tls_params:
            connect_kwargs["tls_params"] = tls_params

        async with aiomqtt.Client(**connect_kwargs) as client:
            await client.subscribe("application/+/device/+/event/up", qos=1)
            await redis.set(status_key, "connected", ex=BRIDGE_LOCK_TTL_S)
            logger.info(
                "ChirpStack bridge %s connected to %s:%s — subscribed to application/+/device/+/event/up",
                self.integration_id, broker, port,
            )

            lock_renewer = asyncio.create_task(self._renew_lock_loop(redis, lock_key, status_key))
            count_flusher = asyncio.create_task(self._flush_count_loop())

            try:
                async for message in client.messages:
                    topic_parts = str(message.topic).split("/")
                    # topic: application/{appId}/device/{devEui}/event/up
                    if (
                        len(topic_parts) == 6
                        and topic_parts[0] == "application"
                        and topic_parts[2] == "device"
                        and topic_parts[4] == "event"
                        and topic_parts[5] == "up"
                    ):
                        dev_eui = topic_parts[3]
                        resolved = await self.db_service.resolve_dev_eui(dev_eui)
                        if resolved is None:
                            await self._track_unknown_device(dev_eui)
                            continue
                        await self._process_uplink(dev_eui, message.payload)
                        self._pending_count += 1
            finally:
                lock_renewer.cancel()
                count_flusher.cancel()
                for t in (lock_renewer, count_flusher):
                    try:
                        await t
                    except asyncio.CancelledError:
                        pass
                await self._flush_count_to_db()

    async def _renew_lock_loop(self, redis, lock_key: str, status_key: str) -> None:
        """Renew the Redis lock and status TTL periodically."""
        while True:
            await asyncio.sleep(BRIDGE_LOCK_RENEW_S)
            await redis.expire(lock_key, BRIDGE_LOCK_TTL_S)
            await redis.expire(status_key, BRIDGE_LOCK_TTL_S)

    async def _flush_count_loop(self) -> None:
        """Periodically flush accumulated message_count to DB."""
        while True:
            await asyncio.sleep(BRIDGE_COUNT_FLUSH_S)
            await self._flush_count_to_db()

    async def _flush_count_to_db(self) -> None:
        """Write accumulated message_count + last_used_at to integrations row."""
        if self._pending_count == 0:
            return
        count = self._pending_count
        self._pending_count = 0
        try:
            async with self.db_service.conn_pool.connection() as conn:
                await conn.execute(
                    "UPDATE integrations SET message_count = message_count + %s, last_used_at = now() WHERE id = %s",
                    (count, self.integration_id),
                )
        except Exception as e:
            logger.warning("Failed to flush bridge message_count for %s: %s", self.integration_id, e)
            self._pending_count += count  # put it back

    async def _track_unknown_device(self, dev_eui: str) -> None:
        """Record a dev_eui seen on the bridge but not registered in Gito."""
        key = f"bridge:unknown:{self.integration_id}"
        try:
            existing = await self.redis_service.redis.hget(key, dev_eui)
            if not existing:
                timestamp = datetime.now(timezone.utc).isoformat()
                await self.redis_service.redis.hset(key, dev_eui, timestamp)
            await self.redis_service.redis.expire(key, BRIDGE_UNKNOWN_DEV_TTL_S)
        except Exception as e:
            logger.warning("Failed to track unknown dev_eui %s: %s", dev_eui, e)


class ChirpStackBridgeManager:
    """
    Manages all outbound ChirpStack MQTT bridge connections.

    Uses a Kubernetes-style reconciliation loop:
      - Desired state: active chirpstack_mqtt integrations in DB
      - Current state: dict of running BridgeWorker tasks
      - Sync: start new, stop removed, restart config-changed workers

    Triggered by:
      1. Redis pub/sub 'integration:changes' channel (immediate)
      2. Periodic sync every BRIDGE_SYNC_INTERVAL_S (safety net)
    """

    def __init__(self, db_service, redis_service, process_uplink_fn):
        self.db_service = db_service
        self.redis_service = redis_service
        self._process_uplink = process_uplink_fn
        self._workers: dict[str, asyncio.Task] = {}
        self._configs: dict[str, dict] = {}

    async def run(self) -> None:
        """Main loop — listens for Redis changes and syncs periodically."""
        await asyncio.gather(
            self._listen_for_changes(),
            self._periodic_sync(),
        )

    async def _listen_for_changes(self) -> None:
        """Subscribe to Redis integration:changes and trigger sync on each message."""
        while True:
            redis = self.redis_service.redis
            try:
                async with redis.pubsub() as ps:
                    await ps.subscribe("integration:changes")
                    logger.info("ChirpStackBridgeManager listening on integration:changes")
                    async for message in ps.listen():
                        if message["type"] != "message":
                            continue
                        try:
                            payload = json.loads(message["data"])
                            logger.info("Bridge manager received change: %s", payload)
                        except Exception:
                            pass
                        await self._sync()
            except asyncio.CancelledError:
                raise
            except Exception as e:
                logger.error("Bridge manager pub/sub error: %s — reconnecting in 5s", e, exc_info=True)
                await asyncio.sleep(5)

    async def _periodic_sync(self) -> None:
        """Safety-net sync every BRIDGE_SYNC_INTERVAL_S seconds."""
        while True:
            await asyncio.sleep(BRIDGE_SYNC_INTERVAL_S)
            await self._sync()

    async def _sync(self) -> None:
        """Reconcile running workers against DB desired state."""
        try:
            active = await self._load_active_integrations()
        except Exception as e:
            logger.error("Bridge manager sync failed to load integrations: %s", e)
            return

        active_map = {row["id"]: row for row in active}

        # Stop workers for integrations that are gone or disabled
        for iid in list(self._workers):
            if iid not in active_map:
                await self._stop_worker(iid)

        # Start or restart workers
        for iid, row in active_map.items():
            new_config = dict(row["config"] or {})
            if iid not in self._workers:
                await self._start_worker(iid, new_config)
            elif new_config != self._configs.get(iid):
                logger.info("Bridge config changed for %s — restarting worker", iid)
                await self._stop_worker(iid)
                await self._start_worker(iid, new_config)

    async def _load_active_integrations(self) -> list[dict]:
        """Query DB for all active chirpstack_mqtt integrations."""
        async with self.db_service.conn_pool.connection() as conn:
            rows = await conn.execute(
                "SELECT id::text, tenant_id::text, config FROM integrations "
                "WHERE provider = 'chirpstack_mqtt' AND is_active = true"
            )
            return [dict(r) for r in await rows.fetchall()]

    async def _start_worker(self, integration_id: str, config: dict) -> None:
        worker = BridgeWorker(
            integration_id=integration_id,
            config=config,
            db_service=self.db_service,
            redis_service=self.redis_service,
            process_uplink_fn=self._process_uplink,
        )
        self._workers[integration_id] = asyncio.create_task(
            worker.run(), name=f"bridge:{integration_id}"
        )
        self._configs[integration_id] = config
        logger.info("Started ChirpStack bridge worker for integration %s", integration_id)

    async def _stop_worker(self, integration_id: str) -> None:
        task = self._workers.pop(integration_id, None)
        self._configs.pop(integration_id, None)
        if task and not task.done():
            task.cancel()
            try:
                await task
            except asyncio.CancelledError:
                pass
        logger.info("Stopped ChirpStack bridge worker for integration %s", integration_id)


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
        self.stream_consumer = StreamConsumer(
            self.db_service, self.redis_service, evaluate_fn=self.evaluate_alerts
        )
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

            # ── Apply key mapping (raw device keys → canonical keys) ──────
            key_mapping = await self.db_service.get_key_mapping(device_id)
            if key_mapping:
                payload = self.db_service.apply_key_mapping(payload, key_mapping)

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

            # (alarm evaluation happens in the stream consumer — single funnel)

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
            rows = await self.db_service.get_active_alert_rules(tenant_id, device_id)
            if not rows:
                return

            # DB stores legacy names (SIMPLE/COMPLEX); alarm_core speaks THRESHOLD/COMPOSITE
            def _rule_type(raw: str | None) -> str:
                return "COMPOSITE" if (raw or "").upper() in ("COMPOSITE", "COMPLEX") else "THRESHOLD"

            rules = [
                AlarmRule(
                    id=str(r["id"]),
                    rule_type=_rule_type(r.get("rule_type")),
                    metric=r.get("metric"),
                    operator=r.get("operator"),
                    threshold=r.get("threshold"),
                    conditions=r.get("conditions"),
                    logic=r.get("logic"),
                    severity=r.get("severity") or "MAJOR",
                    cooldown_minutes=r.get("cooldown_minutes") or 0,
                    last_fired_at=r.get("last_fired_at"),
                )
                for r in rows
            ]

            for firing in evaluate_alarm_rules(rules, payload, timestamp):
                alert_event_id = await self.db_service.fire_alert(
                    tenant_id, firing.rule_id, device_id,
                    firing.metric, firing.value, firing.message, firing.severity,
                    firing.rule_type,
                )
                if not alert_event_id:
                    # fire_alert already logged the failure; don't publish/notify a
                    # firing that was rolled back
                    continue

                await self.redis_service.publish_alert(
                    tenant_id, device_id,
                    {
                        "alert_rule_id": firing.rule_id,
                        "device_id":     device_id,
                        "rule_type":     firing.rule_type,
                        "severity":      firing.severity,
                        "metric":        firing.metric,
                        "value":         firing.value,
                        "message":       firing.message,
                    },
                )
                await self._queue_notification(tenant_id, alert_event_id)

                logger.info(
                    "Alert fired",
                    extra={
                        "tenant_id":  tenant_id,
                        "device_id":  device_id,
                        "alert_rule": firing.rule_id,
                        "rule_type":  firing.rule_type,
                        "severity":   firing.severity,
                        "metric":     firing.metric,
                        "value":      firing.value,
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

            # 6b. Apply key mapping (raw device keys → canonical keys)
            key_mapping = await self.db_service.get_key_mapping(device_id)
            if key_mapping:
                payload = self.db_service.apply_key_mapping(payload, key_mapping)

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

            # 10. Alarm evaluation happens in the stream consumer (single funnel,
            #     __lora_* metrics included since they're in the stream payload)

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
        """Convenience entry point for standalone use — starts and runs loop."""
        await self.start()
        try:
            await self.run_loop()
        finally:
            await self.stop()

    async def run_loop(self):
        """MQTT listener loop — call after start()."""
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


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------
async def main():
    processor = MQTTProcessor()
    bridge_manager = ChirpStackBridgeManager(
        db_service=processor.db_service,
        redis_service=processor.redis_service,
        process_uplink_fn=processor._process_chirpstack_uplink,
    )

    try:
        await processor.start()
        await bridge_manager._sync()
        await asyncio.gather(
            processor.run_loop(),
            bridge_manager.run(),
        )
    except KeyboardInterrupt:
        logger.info("Received interrupt signal")
    finally:
        await processor.stop()


if __name__ == "__main__":
    asyncio.run(main())