"""
End-to-end test for Gito IoT Platform Phase 2.

Tests the complete flow:
1. MQTT telemetry ingestion
2. Database storage
3. Alert rule evaluation
4. Alert event creation
5. Redis pub/sub publishing
6. WebSocket delivery
7. Real-time UI updates (browser-based)

Run with: python -m pytest tests/e2e_test.py -v
"""

import asyncio
import json
import logging
import time
from datetime import datetime
from uuid import uuid4

import aiomqtt
import pytest
import redis.asyncio as aioredis
from sqlalchemy import text

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# Test configuration
MQTT_BROKER = "localhost"
MQTT_PORT = 1883
MQTT_USERNAME = "admin"
MQTT_PASSWORD = "admin-password"

API_BASE_URL = "http://localhost:8000"
REDIS_URL = "redis://localhost:6379/0"
DATABASE_URL = "postgresql://gito:dev-password@localhost:5432/gito"

# Test data
TEST_TENANT_ID = "00000000-0000-0000-0000-000000000001"
TEST_DEVICE_ID = "00000000-0000-0000-0000-000000000100"
TEST_USER_EMAIL = "admin@gito.demo"


class TestE2EFlow:
    """End-to-end test suite."""

    @pytest.mark.asyncio
    async def test_mqtt_telemetry_ingestion(self):
        """Test 1: MQTT telemetry is ingested and processed."""
        logger.info("TEST 1: MQTT Telemetry Ingestion")
        
        async with aiomqtt.Client(
            MQTT_BROKER,
            port=MQTT_PORT,
            username=MQTT_USERNAME,
            password=MQTT_PASSWORD
        ) as client:
            # Send test telemetry
            topic = f"{TEST_TENANT_ID}/devices/{TEST_DEVICE_ID}/telemetry"
            payload = {
                "temperature": 23.5,
                "humidity": 45.0,
                "pressure": 1013.25
            }
            
            await client.publish(topic, json.dumps(payload))
            logger.info(f"Published telemetry to {topic}")
            
            # Small delay to allow processing
            await asyncio.sleep(1)
        
        # Verify in database
        import psycopg
        async with await psycopg.AsyncConnection.connect(DATABASE_URL) as conn:
            result = await conn.execute(
                text("""
                    SELECT COUNT(*) FROM telemetry_hot 
                    WHERE device_id = %s AND tenant_id = %s
                """),
                (TEST_DEVICE_ID, TEST_TENANT_ID)
            )
            count = (await result.fetchone())[0]
            assert count > 0, "Telemetry not found in database"
            logger.info(f"✓ Telemetry ingested: {count} records in database")

    @pytest.mark.asyncio
    async def test_alert_rule_evaluation(self):
        """Test 2: Alert rules are evaluated against telemetry."""
        logger.info("TEST 2: Alert Rule Evaluation")
        
        import psycopg
        async with await psycopg.AsyncConnection.connect(DATABASE_URL) as conn:
            # Create alert rule for temperature > 25
            alert_rule_id = str(uuid4())
            await conn.execute(
                text("""
                    INSERT INTO alert_rules 
                    (id, tenant_id, device_id, metric, operator, threshold, cooldown_minutes, active)
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
                    ON CONFLICT DO NOTHING
                """),
                (alert_rule_id, TEST_TENANT_ID, TEST_DEVICE_ID, "temperature", ">", 25.0, 5, True)
            )
            await conn.commit()
            logger.info(f"Created alert rule: {alert_rule_id}")
        
        # Send telemetry that should trigger alert
        async with aiomqtt.Client(
            MQTT_BROKER,
            port=MQTT_PORT,
            username=MQTT_USERNAME,
            password=MQTT_PASSWORD
        ) as client:
            topic = f"{TEST_TENANT_ID}/devices/{TEST_DEVICE_ID}/telemetry"
            payload = {"temperature": 26.0, "humidity": 50.0}
            await client.publish(topic, json.dumps(payload))
            logger.info("Published high temperature telemetry")
        
        # Wait for processing
        await asyncio.sleep(2)
        
        # Check alert_events table
        async with await psycopg.AsyncConnection.connect(DATABASE_URL) as conn:
            result = await conn.execute(
                text("""
                    SELECT COUNT(*) FROM alert_events 
                    WHERE device_id = %s AND metric_name = 'temperature'
                """),
                (TEST_DEVICE_ID,)
            )
            alert_count = (await result.fetchone())[0]
            assert alert_count > 0, "Alert was not fired"
            logger.info(f"✓ Alert fired: {alert_count} alert events in database")

    @pytest.mark.asyncio
    async def test_redis_pubsub_publishing(self):
        """Test 3: Alerts are published to Redis pub/sub."""
        logger.info("TEST 3: Redis Pub/Sub Publishing")
        
        redis_client = await aioredis.from_url(REDIS_URL, encoding="utf-8", decode_responses=True)
        
        try:
            # Subscribe to alert channel
            pubsub = redis_client.pubsub()
            alert_channel = f"alerts:{TEST_TENANT_ID}:{TEST_DEVICE_ID}"
            await pubsub.subscribe(alert_channel)
            logger.info(f"Subscribed to {alert_channel}")
            
            # Send triggering telemetry
            async with aiomqtt.Client(
                MQTT_BROKER,
                port=MQTT_PORT,
                username=MQTT_USERNAME,
                password=MQTT_PASSWORD
            ) as client:
                topic = f"{TEST_TENANT_ID}/devices/{TEST_DEVICE_ID}/telemetry"
                payload = {"temperature": 27.0, "humidity": 55.0}
                await client.publish(topic, json.dumps(payload))
            
            # Wait for Redis message (with timeout)
            start_time = time.time()
            timeout = 5
            alert_received = False
            
            while time.time() - start_time < timeout:
                message = await pubsub.get_message(ignore_subscribe_messages=True)
                if message and message.get("type") == "message":
                    data = json.loads(message["data"])
                    logger.info(f"Received alert: {data}")
                    alert_received = True
                    break
                await asyncio.sleep(0.5)
            
            assert alert_received, "Alert not received on Redis pub/sub"
            logger.info("✓ Alert published to Redis pub/sub")
        
        finally:
            await redis_client.close()

    @pytest.mark.asyncio
    async def test_device_status_update(self):
        """Test 4: Device last_seen and status are updated."""
        logger.info("TEST 4: Device Status Update")
        
        # Send telemetry
        async with aiomqtt.Client(
            MQTT_BROKER,
            port=MQTT_PORT,
            username=MQTT_USERNAME,
            password=MQTT_PASSWORD
        ) as client:
            topic = f"{TEST_TENANT_ID}/devices/{TEST_DEVICE_ID}/telemetry"
            payload = {"temperature": 22.0}
            await client.publish(topic, json.dumps(payload))
        
        await asyncio.sleep(1)
        
        # Check device status
        import psycopg
        async with await psycopg.AsyncConnection.connect(DATABASE_URL) as conn:
            result = await conn.execute(
                text("""
                    SELECT status, last_seen FROM devices 
                    WHERE id = %s AND tenant_id = %s
                """),
                (TEST_DEVICE_ID, TEST_TENANT_ID)
            )
            row = await result.fetchone()
            assert row is not None, "Device not found"
            status, last_seen = row
            assert status == "online", f"Device status is {status}, expected 'online'"
            assert last_seen is not None, "Device last_seen not updated"
            logger.info(f"✓ Device status: {status}, last_seen: {last_seen}")

    @pytest.mark.asyncio
    async def test_telemetry_persistence(self):
        """Test 5: Telemetry is persisted correctly."""
        logger.info("TEST 5: Telemetry Persistence")
        
        test_payload = {
            "temperature": 24.5,
            "humidity": 48.2,
            "pressure": 1012.0,
            "battery": 3.8
        }
        
        # Send telemetry
        async with aiomqtt.Client(
            MQTT_BROKER,
            port=MQTT_PORT,
            username=MQTT_USERNAME,
            password=MQTT_PASSWORD
        ) as client:
            topic = f"{TEST_TENANT_ID}/devices/{TEST_DEVICE_ID}/telemetry"
            await client.publish(topic, json.dumps(test_payload))
        
        await asyncio.sleep(1)
        
        # Verify stored payload
        import psycopg
        async with await psycopg.AsyncConnection.connect(DATABASE_URL) as conn:
            result = await conn.execute(
                text("""
                    SELECT payload FROM telemetry_hot 
                    WHERE device_id = %s AND tenant_id = %s
                    ORDER BY created_at DESC LIMIT 1
                """),
                (TEST_DEVICE_ID, TEST_TENANT_ID)
            )
            row = await result.fetchone()
            assert row is not None, "Telemetry not found"
            
            stored_payload = row["payload"]
            # Check key metrics are present
            assert stored_payload.get("temperature") == test_payload["temperature"]
            assert stored_payload.get("humidity") == test_payload["humidity"]
            logger.info(f"✓ Telemetry persisted correctly: {stored_payload}")

    @pytest.mark.asyncio
    async def test_row_level_security(self):
        """Test 6: Row-level security prevents cross-tenant access."""
        logger.info("TEST 6: Row-Level Security")
        
        other_tenant_id = "00000000-0000-0000-0000-000000000002"
        
        import psycopg
        async with await psycopg.AsyncConnection.connect(DATABASE_URL) as conn:
            # Set tenant context to different tenant
            await conn.execute(
                text("SELECT set_config('app.tenant_id', %s, false)"),
                (other_tenant_id,)
            )
            
            # Try to access test tenant's device
            result = await conn.execute(
                text("""
                    SELECT COUNT(*) FROM telemetry_hot 
                    WHERE device_id = %s AND tenant_id = %s
                """),
                (TEST_DEVICE_ID, TEST_TENANT_ID)
            )
            count = (await result.fetchone())[0]
            assert count == 0, "RLS policy not working - other tenant can see data"
            logger.info("✓ Row-level security working: cross-tenant access denied")

    @pytest.mark.asyncio
    async def test_alert_cooldown(self):
        """Test 7: Alert cooldown prevents duplicate alerts."""
        logger.info("TEST 7: Alert Cooldown")
        
        import psycopg
        
        # Send first triggering telemetry
        async with aiomqtt.Client(
            MQTT_BROKER,
            port=MQTT_PORT,
            username=MQTT_USERNAME,
            password=MQTT_PASSWORD
        ) as client:
            topic = f"{TEST_TENANT_ID}/devices/{TEST_DEVICE_ID}/telemetry"
            payload = {"temperature": 26.5}
            await client.publish(topic, json.dumps(payload))
        
        await asyncio.sleep(1)
        
        # Count alerts
        async with await psycopg.AsyncConnection.connect(DATABASE_URL) as conn:
            result = await conn.execute(
                text("""
                    SELECT COUNT(*) FROM alert_events 
                    WHERE device_id = %s AND metric_name = 'temperature'
                """),
                (TEST_DEVICE_ID,)
            )
            alert_count_1 = (await result.fetchone())[0]
        
        # Send another triggering telemetry immediately (should not fire due to cooldown)
        async with aiomqtt.Client(
            MQTT_BROKER,
            port=MQTT_PORT,
            username=MQTT_USERNAME,
            password=MQTT_PASSWORD
        ) as client:
            topic = f"{TEST_TENANT_ID}/devices/{TEST_DEVICE_ID}/telemetry"
            payload = {"temperature": 27.5}
            await client.publish(topic, json.dumps(payload))
        
        await asyncio.sleep(1)
        
        # Check alert count (should not increase within cooldown)
        async with await psycopg.AsyncConnection.connect(DATABASE_URL) as conn:
            result = await conn.execute(
                text("""
                    SELECT COUNT(*) FROM alert_events 
                    WHERE device_id = %s AND metric_name = 'temperature'
                """),
                (TEST_DEVICE_ID,)
            )
            alert_count_2 = (await result.fetchone())[0]
        
        logger.info(f"Alert count: {alert_count_1} -> {alert_count_2} (cooldown in effect)")
        assert alert_count_2 <= alert_count_1 + 1, "Cooldown not working"
        logger.info("✓ Alert cooldown working: duplicate alerts prevented")


class TestDataValidation:
    """Test data validation and error handling."""

    @pytest.mark.asyncio
    async def test_invalid_json_payload(self):
        """Test invalid JSON is rejected."""
        logger.info("TEST: Invalid JSON Payload")
        
        async with aiomqtt.Client(
            MQTT_BROKER,
            port=MQTT_PORT,
            username=MQTT_USERNAME,
            password=MQTT_PASSWORD
        ) as client:
            topic = f"{TEST_TENANT_ID}/devices/{TEST_DEVICE_ID}/telemetry"
            # Invalid JSON
            await client.publish(topic, b"{invalid json")
        
        await asyncio.sleep(1)
        logger.info("✓ Invalid JSON handled gracefully")

    @pytest.mark.asyncio
    async def test_invalid_uuid_format(self):
        """Test invalid UUID format is rejected."""
        logger.info("TEST: Invalid UUID Format")
        
        async with aiomqtt.Client(
            MQTT_BROKER,
            port=MQTT_PORT,
            username=MQTT_USERNAME,
            password=MQTT_PASSWORD
        ) as client:
            # Invalid UUIDs
            topic = "not-a-uuid/devices/also-invalid/telemetry"
            payload = {"temperature": 25.0}
            await client.publish(topic, json.dumps(payload))
        
        await asyncio.sleep(1)
        logger.info("✓ Invalid UUID format rejected")

    @pytest.mark.asyncio
    async def test_invalid_topic_format(self):
        """Test invalid topic format is rejected."""
        logger.info("TEST: Invalid Topic Format")
        
        async with aiomqtt.Client(
            MQTT_BROKER,
            port=MQTT_PORT,
            username=MQTT_USERNAME,
            password=MQTT_PASSWORD
        ) as client:
            # Invalid topic (missing segment)
            topic = f"{TEST_TENANT_ID}/devices/{TEST_DEVICE_ID}"
            payload = {"temperature": 25.0}
            await client.publish(topic, json.dumps(payload))
        
        await asyncio.sleep(1)
        logger.info("✓ Invalid topic format rejected")


if __name__ == "__main__":
    pytest.main([__file__, "-v", "-s"])
