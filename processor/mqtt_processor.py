"""
MQTT Processor Service
Subscribes to device telemetry, validates, inserts to TimescaleDB, and updates Redis.
"""

import asyncio
import json
import logging
import os
from datetime import datetime
from uuid import UUID

import aiomqtt
import redis.asyncio as aioredis
from psycopg_pool import AsyncConnectionPool
import psycopg

# Configure structured logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# Configuration from environment variables
MQTT_BROKER = os.getenv('MQTT_BROKER', 'mosquitto')
MQTT_PORT = int(os.getenv('MQTT_PORT', 1883))
MQTT_USERNAME = os.getenv('MQTT_USERNAME', 'processor')
MQTT_PASSWORD = os.getenv('MQTT_PASSWORD', 'processor')

DATABASE_URL = os.getenv('DATABASE_URL', 'postgresql://postgres:postgres@postgres:5432/gito')

REDIS_URL = os.getenv('REDIS_URL', 'redis://keydb:6379')

# Message validation constants
MAX_PAYLOAD_SIZE = 256 * 1024  # 256KB
MAX_TELEMETRY_VALUE = 1e10  # Prevent overflow
MIN_TELEMETRY_VALUE = -1e10


class TelemetryValidator:
    """Validates incoming telemetry payloads."""

    @staticmethod
    def validate_payload(payload: dict) -> bool:
        """
        Validate telemetry payload structure.
        Expected format: { "metric_name": value, ... }
        """
        if not isinstance(payload, dict):
            return False
        
        if not payload:  # Empty dict
            return False
        
        for key, value in payload.items():
            # Metric names must be valid identifiers
            if not isinstance(key, str) or not key.replace('_', '').isalnum():
                return False
            
            # Values must be numeric or null
            if value is not None and not isinstance(value, (int, float)):
                return False
            
            # Numeric values must be within range
            if isinstance(value, (int, float)):
                if value > MAX_TELEMETRY_VALUE or value < MIN_TELEMETRY_VALUE:
                    return False
        
        return True

    @staticmethod
    def is_valid_uuid(value: str) -> bool:
        """Validate UUID format."""
        try:
            UUID(value)
            return True
        except (ValueError, AttributeError):
            return False


class DatabaseService:
    """Handles database operations for telemetry and alerts."""

    def __init__(self, db_url: str):
        self.db_url = db_url
        self.conn_pool = None

    async def connect(self):
        """Initialize database connection pool."""
        try:
            self.conn_pool = AsyncConnectionPool(
                self.db_url,
                min_size=5,
                max_size=20
            )
            await self.conn_pool.open()
            logger.info("Database connection pool created")
        except Exception as e:
            logger.error(f"Failed to create database pool: {e}")
            raise

    async def disconnect(self):
        """Close database connection pool."""
        if self.conn_pool:
            await self.conn_pool.close()
            logger.info("Database connection pool closed")

    async def insert_telemetry(
        self,
        tenant_id: str,
        device_id: str,
        payload: dict,
        timestamp: datetime
    ) -> bool:
        """
        Insert telemetry into TimescaleDB.
        Returns True on success, False on failure.
        """
        try:
            async with self.conn_pool.connection() as conn:
                # Set tenant context for RLS
                await conn.execute(
                    "SELECT set_config('app.tenant_id', %s, false)",
                    (tenant_id,)
                )
                
                # Insert telemetry record
                await conn.execute(
                    """
                    INSERT INTO telemetry_hot (tenant_id, device_id, payload, timestamp)
                    VALUES (%s, %s, %s, %s)
                    """,
                    (tenant_id, device_id, json.dumps(payload), timestamp)
                )
                
                # Update device last_seen
                await conn.execute(
                    """
                    UPDATE devices
                    SET last_seen = %s, status = 'online', updated_at = now()
                    WHERE id = %s AND tenant_id = %s
                    """,
                    (timestamp, device_id, tenant_id)
                )
                
                await conn.commit()
                return True
        except Exception as e:
            logger.error(
                "Failed to insert telemetry",
                extra={
                    "tenant_id": tenant_id,
                    "device_id": device_id,
                    "error": str(e)
                },
                exc_info=True
            )
            return False

    async def get_active_alert_rules(
        self,
        tenant_id: str,
        device_id: str
    ) -> list:
        """Fetch active alert rules for a device."""
        try:
            async with self.conn_pool.connection() as conn:
                await conn.execute(
                    "SELECT set_config('app.tenant_id', %s, false)",
                    (tenant_id,)
                )
                
                cursor = await conn.execute(
                    """
                    SELECT id, metric, operator, threshold, cooldown_minutes, last_fired_at
                    FROM alert_rules
                    WHERE device_id = %s AND active = true AND tenant_id = %s
                    ORDER BY created_at
                    """,
                    (device_id, tenant_id)
                )
                rows = await cursor.fetchall()
                
                return [dict(row) for row in rows]
        except Exception as e:
            logger.error(
                "Failed to fetch alert rules",
                extra={
                    "tenant_id": tenant_id,
                    "device_id": device_id,
                    "error": str(e)
                },
                exc_info=True
            )
            return []

    async def fire_alert(
        self,
        tenant_id: str,
        alert_rule_id: str,
        device_id: str,
        metric_name: str,
        metric_value: float,
        message: str
    ) -> bool:
        """Record a fired alert."""
        try:
            async with self.conn_pool.connection() as conn:
                await conn.execute(
                    "SELECT set_config('app.tenant_id', %s, false)",
                    (tenant_id,)
                )
                
                await conn.execute(
                    """
                    INSERT INTO alert_events (
                        tenant_id, alert_rule_id, device_id, metric_name,
                        metric_value, message, fired_at, notification_sent
                    ) VALUES (%s, %s, %s, %s, %s, %s, now(), false)
                    """,
                    (tenant_id, alert_rule_id, device_id, metric_name, metric_value, message)
                )
                
                # Update alert_rule's last_fired_at
                await conn.execute(
                    """
                    UPDATE alert_rules
                    SET last_fired_at = now()
                    WHERE id = %s AND tenant_id = %s
                    """,
                    (alert_rule_id, tenant_id)
                )
                
                await conn.commit()
                return True
        except Exception as e:
            logger.error(
                "Failed to fire alert",
                extra={
                    "tenant_id": tenant_id,
                    "alert_rule_id": alert_rule_id,
                    "error": str(e)
                }
            )
            return False


class RedisService:
    """Handles Redis pub/sub for real-time updates."""

    def __init__(self, redis_url: str):
        self.redis_url = redis_url
        self.redis = None

    async def connect(self):
        """Connect to Redis."""
        try:
            self.redis = await aioredis.from_url(self.redis_url, encoding="utf-8", decode_responses=True)
            logger.info("Connected to Redis")
        except Exception as e:
            logger.error(f"Failed to connect to Redis: {e}")
            raise

    async def disconnect(self):
        """Close Redis connection."""
        if self.redis:
            await self.redis.close()
            logger.info("Disconnected from Redis")

    async def publish_telemetry(
        self,
        tenant_id: str,
        device_id: str,
        payload: dict
    ):
        """Publish telemetry to Redis for WebSocket subscribers."""
        try:
            channel = f"telemetry:{tenant_id}:{device_id}"
            message = json.dumps({
                "device_id": device_id,
                "payload": payload,
                "timestamp": datetime.utcnow().isoformat()
            })
            await self.redis.publish(channel, message)
        except Exception as e:
            logger.error(
                "Failed to publish to Redis",
                extra={
                    "channel": f"telemetry:{tenant_id}:{device_id}",
                    "error": str(e)
                }
            )

    async def publish_alert(
        self,
        tenant_id: str,
        device_id: str,
        alert_data: dict
    ):
        """Publish alert to Redis for real-time notification."""
        try:
            channel = f"alerts:{tenant_id}:{device_id}"
            message = json.dumps({
                **alert_data,
                "timestamp": datetime.utcnow().isoformat()
            })
            await self.redis.publish(channel, message)
        except Exception as e:
            logger.error(
                "Failed to publish alert",
                extra={
                    "channel": f"alerts:{tenant_id}:{device_id}",
                    "error": str(e)
                }
            )


class AlertEvaluator:
    """Evaluates telemetry against alert rules."""

    OPERATORS = {
        'gt': lambda v, t: v > t,
        'gte': lambda v, t: v >= t,
        'lt': lambda v, t: v < t,
        'lte': lambda v, t: v <= t,
        'eq': lambda v, t: v == t,
        'neq': lambda v, t: v != t,
    }

    @staticmethod
    def should_fire_alert(
        rule: dict,
        metric_value: float,
        current_time: datetime
    ) -> bool:
        """
        Determine if alert should fire based on rule and metric value.
        Respects cooldown period.
        """
        operator = rule.get('operator')
        threshold = rule.get('threshold')
        last_fired_at = rule.get('last_fired_at')
        cooldown_minutes = rule.get('cooldown_minutes', 0)

        # Check if operator exists
        if operator not in AlertEvaluator.OPERATORS:
            return False

        # Check threshold condition
        comparison_fn = AlertEvaluator.OPERATORS[operator]
        if not comparison_fn(metric_value, threshold):
            return False

        # Check cooldown period
        if last_fired_at:
            from datetime import timedelta
            cooldown_delta = timedelta(minutes=cooldown_minutes)
            if current_time < last_fired_at + cooldown_delta:
                return False

        return True


class MQTTProcessor:
    """Main processor that orchestrates MQTT, database, and Redis."""

    def __init__(self):
        self.db_service = DatabaseService(DATABASE_URL)
        self.redis_service = RedisService(REDIS_URL)
        self.validator = TelemetryValidator()
        self.running = False

    async def start(self):
        """Start the processor."""
        try:
            logger.info("Starting MQTT Processor...")
            await self.db_service.connect()
            await self.redis_service.connect()
            self.running = True
            logger.info("MQTT Processor started successfully")
        except Exception as e:
            logger.error(f"Failed to start processor: {e}")
            raise

    async def stop(self):
        """Stop the processor gracefully."""
        logger.info("Stopping MQTT Processor...")
        self.running = False
        await self.redis_service.disconnect()
        await self.db_service.disconnect()
        logger.info("MQTT Processor stopped")

    async def process_telemetry(
        self,
        topic: str,
        payload_bytes: bytes
    ):
        """
        Process incoming MQTT message.
        Expected topic format: {tenant_id}/devices/{device_id}/telemetry
        """
        try:
            # Parse topic (convert to string if Topic object)
            topic_str = str(topic)
            parts = topic_str.split('/')
            if len(parts) != 4 or parts[1] != 'devices' or parts[3] != 'telemetry':
                logger.warning(f"Invalid topic format: {topic}")
                return

            tenant_id = parts[0]
            device_id = parts[2]

            # Validate UUIDs
            if not self.validator.is_valid_uuid(tenant_id):
                logger.warning(f"Invalid tenant_id: {tenant_id}")
                return

            if not self.validator.is_valid_uuid(device_id):
                logger.warning(f"Invalid device_id: {device_id}")
                return

            # Parse and validate payload
            try:
                payload = json.loads(payload_bytes.decode('utf-8'))
            except (json.JSONDecodeError, UnicodeDecodeError) as e:
                logger.warning(
                    "Failed to parse payload",
                    extra={
                        "tenant_id": tenant_id,
                        "device_id": device_id,
                        "error": str(e)
                    }
                )
                return

            if not self.validator.validate_payload(payload):
                logger.warning(
                    "Invalid payload structure",
                    extra={
                        "tenant_id": tenant_id,
                        "device_id": device_id
                    }
                )
                return

            timestamp = datetime.utcnow()

            # Insert telemetry to database
            success = await self.db_service.insert_telemetry(
                tenant_id,
                device_id,
                payload,
                timestamp
            )

            if not success:
                return

            # Publish to Redis for WebSocket subscribers
            await self.redis_service.publish_telemetry(
                tenant_id,
                device_id,
                payload
            )

            # Evaluate alert rules
            await self.evaluate_alerts(
                tenant_id,
                device_id,
                payload,
                timestamp
            )

            logger.info(
                "Telemetry processed",
                extra={
                    "tenant_id": tenant_id,
                    "device_id": device_id,
                    "metrics": len(payload)
                }
            )

        except Exception as e:
            logger.error(f"Error processing telemetry: {e}", exc_info=True)

    async def evaluate_alerts(
        self,
        tenant_id: str,
        device_id: str,
        payload: dict,
        timestamp: datetime
    ):
        """Evaluate alert rules for the telemetry."""
        try:
            rules = await self.db_service.get_active_alert_rules(tenant_id, device_id)

            for rule in rules:
                metric_name = rule.get('metric')
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

                    await self.db_service.fire_alert(
                        tenant_id,
                        rule.get('id'),
                        device_id,
                        metric_name,
                        metric_value,
                        message
                    )

                    await self.redis_service.publish_alert(
                        tenant_id,
                        device_id,
                        {
                            "alert_rule_id": rule.get('id'),
                            "device_id": device_id,
                            "metric": metric_name,
                            "value": metric_value,
                            "message": message
                        }
                    )

                    logger.info(
                        "Alert fired",
                        extra={
                            "tenant_id": tenant_id,
                            "device_id": device_id,
                            "alert_rule_id": rule.get('id'),
                            "metric": metric_name,
                            "value": metric_value
                        }
                    )

        except Exception as e:
            logger.error(
                "Error evaluating alerts",
                extra={
                    "tenant_id": tenant_id,
                    "device_id": device_id,
                    "error": str(e)
                }
            )

    async def run(self):
        """Main run loop - subscribe to MQTT and process messages."""
        await self.start()

        try:
            async with aiomqtt.Client(
                MQTT_BROKER,
                port=MQTT_PORT,
                username=MQTT_USERNAME,
                password=MQTT_PASSWORD
            ) as client:
                logger.info(f"Connected to MQTT broker at {MQTT_BROKER}:{MQTT_PORT}")

                # Subscribe to all device telemetry topics
                await client.subscribe("+/devices/+/telemetry")
                logger.info("Subscribed to device telemetry topics")

                async for message in client.messages:
                    if not self.running:
                        break

                    await self.process_telemetry(message.topic, message.payload)

        except Exception as e:
            logger.error(f"MQTT connection error: {e}", exc_info=True)
        finally:
            await self.stop()


async def main():
    """Entry point."""
    processor = MQTTProcessor()
    
    try:
        await processor.run()
    except KeyboardInterrupt:
        logger.info("Received interrupt signal")
        await processor.stop()


if __name__ == "__main__":
    asyncio.run(main())
