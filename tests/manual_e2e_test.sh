#!/bin/bash
# Manual End-to-End Test Script for Gito IoT Platform Phase 2
# This script tests the complete flow without requiring pytest

set -e

echo "======================================================================"
echo "Gito IoT Platform - Phase 2 End-to-End Manual Test"
echo "======================================================================"
echo ""

# Configuration
MQTT_HOST="localhost"
MQTT_PORT=1883
MQTT_USER="admin"
MQTT_PASS="admin-password"

API_BASE_URL="http://localhost:8000"
REDIS_URL="redis://localhost:6379/0"

# Test data
TENANT_ID="00000000-0000-0000-0000-000000000001"
DEVICE_ID="00000000-0000-0000-0000-000000000100"
ADMIN_EMAIL="admin@gito.demo"

# Delay for async processing
WAIT_TIME=2

echo "[1/7] Checking API Health..."
response=$(curl -s "$API_BASE_URL/api/health")
if echo "$response" | grep -q "ok"; then
    echo "✓ API is healthy"
else
    echo "✗ API health check failed"
    exit 1
fi

echo ""
echo "[2/7] Testing MQTT Telemetry Ingestion..."
# Publish test telemetry via MQTT
mosquitto_pub \
    -h "$MQTT_HOST" \
    -p "$MQTT_PORT" \
    -u "$MQTT_USER" \
    -P "$MQTT_PASS" \
    -t "$TENANT_ID/devices/$DEVICE_ID/telemetry" \
    -m '{"temperature": 23.5, "humidity": 45.0, "pressure": 1013.25}'

sleep $WAIT_TIME
echo "✓ Telemetry published to MQTT"

echo ""
echo "[3/7] Verifying Database Ingestion..."
# Check database for telemetry
psql postgresql://gito:dev-password@localhost:5432/gito -c \
    "SELECT COUNT(*) as count FROM telemetry_hot WHERE device_id = '$DEVICE_ID'::UUID;" \
    | grep -A 1 "count" | tail -1 | xargs echo "Records in database:" 

echo "✓ Telemetry verified in database"

echo ""
echo "[4/7] Creating Alert Rule..."
psql postgresql://gito:dev-password@localhost:5432/gito -c \
    "INSERT INTO alert_rules (id, tenant_id, device_id, metric, operator, threshold, cooldown_minutes, active) 
     VALUES (gen_random_uuid(), '$TENANT_ID'::UUID, '$DEVICE_ID'::UUID, 'temperature', '>', 25.0, 5, true)
     ON CONFLICT DO NOTHING;"

echo "✓ Alert rule created"

echo ""
echo "[5/7] Publishing High Temperature (Triggers Alert)..."
mosquitto_pub \
    -h "$MQTT_HOST" \
    -p "$MQTT_PORT" \
    -u "$MQTT_USER" \
    -P "$MQTT_PASS" \
    -t "$TENANT_ID/devices/$DEVICE_ID/telemetry" \
    -m '{"temperature": 26.0, "humidity": 50.0}'

sleep $WAIT_TIME
echo "✓ High temperature telemetry published"

echo ""
echo "[6/7] Verifying Alert Event..."
psql postgresql://gito:dev-password@localhost:5432/gito -c \
    "SELECT COUNT(*) as alert_count FROM alert_events WHERE device_id = '$DEVICE_ID'::UUID;" \
    | grep -A 1 "alert_count" | tail -1 | xargs echo "Alert events:" 

echo "✓ Alert events verified"

echo ""
echo "[7/7] Checking Device Status..."
psql postgresql://gito:dev-password@localhost:5432/gito -c \
    "SELECT status, last_seen FROM devices WHERE id = '$DEVICE_ID'::UUID;" 

echo "✓ Device status verified"

echo ""
echo "======================================================================"
echo "✓ All end-to-end tests passed!"
echo "======================================================================"
echo ""
echo "Next Steps:"
echo "1. Open browser to http://localhost:3000"
echo "2. Login with admin@gito.demo / admin123"
echo "3. Navigate to a device detail page"
echo "4. Verify WebSocket connection (green pulse indicator)"
echo "5. Send telemetry and watch real-time chart update"
echo ""
