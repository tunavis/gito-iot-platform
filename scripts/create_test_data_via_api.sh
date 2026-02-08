#!/bin/bash
# ============================================================================
# Create Realistic Test Data via API
# Tests all API endpoints while populating database
# ============================================================================

set -e

API_URL="http://localhost/api/v1"
TOKEN="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIwMDAwMDAwMC0wMDAwLTAwMDAtMDAwMC0wMDAwMDAwMDAwMTAiLCJ0ZW5hbnRfaWQiOiIwMDAwMDAwMC0wMDAwLTAwMDAtMDAwMC0wMDAwMDAwMDAwMDEiLCJyb2xlIjoiVEVOQU5UX0FETUlOIiwiZXhwIjoxNzcwNDg5NTM3LCJpYXQiOjE3NzA0MDMxMzd9.zl6Zh-vF8PI9tWs9MyFklNjQUmwOwWnXd5b7cz1CfPY"
TENANT_ID="00000000-0000-0000-0000-000000000001"

echo "🚀 Creating realistic test data via API..."
echo ""

# ============================================================================
# 1. CREATE NEW DEVICE TYPES (HTTP, Modbus, OPC-UA, CoAP)
# ============================================================================

echo "📦 Creating HTTP/REST API Device Type..."
HTTP_DEVICE_TYPE=$(curl -s -X POST "$API_URL/tenants/$TENANT_ID/device-types" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "HTTP REST API Device",
    "description": "Cloud-connected device using HTTP REST API for telemetry",
    "manufacturer": "Generic",
    "category": "cloud",
    "icon": "cloud",
    "color": "#06b6d4",
    "data_model": [
      {"name": "temperature", "type": "float", "unit": "°C", "required": true, "min": -40, "max": 85},
      {"name": "humidity", "type": "float", "unit": "%", "required": true, "min": 0, "max": 100},
      {"name": "signal_strength", "type": "integer", "unit": "dBm", "required": false, "min": -120, "max": 0}
    ],
    "capabilities": ["telemetry", "alerts", "remote_config"],
    "default_settings": {
      "offline_threshold": 300,
      "telemetry_interval": 60,
      "heartbeat_interval": 30
    },
    "connectivity": {
      "protocol": "http",
      "http_endpoint": "https://api.device.com/telemetry",
      "auth_type": "bearer"
    }
  }' | python -c "import sys, json; print(json.load(sys.stdin)['data']['id'])")

echo "✅ HTTP Device Type ID: $HTTP_DEVICE_TYPE"

echo ""
echo "⚙️ Creating Modbus RTU Device Type..."
MODBUS_DEVICE_TYPE=$(curl -s -X POST "$API_URL/tenants/$TENANT_ID/device-types" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Modbus RTU Sensor",
    "description": "Industrial sensor using Modbus RTU protocol over RS485",
    "manufacturer": "Schneider Electric",
    "category": "industrial",
    "icon": "cpu",
    "color": "#8b5cf6",
    "data_model": [
      {"name": "temperature", "type": "float", "unit": "°C", "required": true, "min": -200, "max": 1200},
      {"name": "pressure", "type": "float", "unit": "bar", "required": true, "min": 0, "max": 500},
      {"name": "flow_rate", "type": "float", "unit": "L/min", "required": false, "min": 0, "max": 1000},
      {"name": "valve_position", "type": "integer", "unit": "%", "required": false, "min": 0, "max": 100}
    ],
    "capabilities": ["telemetry", "commands", "alerts"],
    "default_settings": {
      "offline_threshold": 600,
      "telemetry_interval": 120,
      "modbus_unit_id": 1
    },
    "connectivity": {
      "protocol": "modbus",
      "connection_type": "rtu",
      "baud_rate": 9600,
      "parity": "none"
    }
  }' | python -c "import sys, json; print(json.load(sys.stdin)['data']['id'])")

echo "✅ Modbus Device Type ID: $MODBUS_DEVICE_TYPE"

echo ""
echo "🏭 Creating OPC-UA Device Type..."
OPCUA_DEVICE_TYPE=$(curl -s -X POST "$API_URL/tenants/$TENANT_ID/device-types" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "OPC-UA Industrial Controller",
    "description": "Industrial automation device with OPC-UA interface",
    "manufacturer": "Siemens",
    "category": "industrial",
    "icon": "factory",
    "color": "#f97316",
    "data_model": [
      {"name": "machine_status", "type": "string", "required": true, "description": "running|stopped|error"},
      {"name": "production_count", "type": "integer", "required": true, "min": 0},
      {"name": "cycle_time", "type": "float", "unit": "s", "required": false, "min": 0},
      {"name": "error_code", "type": "integer", "required": false}
    ],
    "capabilities": ["telemetry", "commands", "alarms", "history"],
    "default_settings": {
      "offline_threshold": 180,
      "telemetry_interval": 10,
      "sampling_interval": 1000
    },
    "connectivity": {
      "protocol": "opcua",
      "endpoint_url": "opc.tcp://plc.local:4840",
      "security_mode": "SignAndEncrypt"
    }
  }' | python -c "import sys, json; print(json.load(sys.stdin)['data']['id'])")

echo "✅ OPC-UA Device Type ID: $OPCUA_DEVICE_TYPE"

echo ""
echo "📡 Creating CoAP Device Type..."
COAP_DEVICE_TYPE=$(curl -s -X POST "$API_URL/tenants/$TENANT_ID/device-types" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "CoAP Constrained Device",
    "description": "Low-power device using CoAP protocol for IoT",
    "manufacturer": "Generic",
    "category": "sensor",
    "icon": "radio",
    "color": "#14b8a6",
    "data_model": [
      {"name": "temperature", "type": "float", "unit": "°C", "required": true, "min": -40, "max": 85},
      {"name": "battery", "type": "integer", "unit": "%", "required": true, "min": 0, "max": 100},
      {"name": "rssi", "type": "integer", "unit": "dBm", "required": false, "min": -120, "max": 0}
    ],
    "capabilities": ["telemetry", "sleep_mode", "firmware_ota"],
    "default_settings": {
      "offline_threshold": 3600,
      "telemetry_interval": 900,
      "sleep_duration": 3600
    },
    "connectivity": {
      "protocol": "coap",
      "observe": true,
      "confirmable": false
    }
  }' | python -c "import sys, json; print(json.load(sys.stdin)['data']['id'])")

echo "✅ CoAP Device Type ID: $COAP_DEVICE_TYPE"

# ============================================================================
# 2. CREATE DEVICES USING NEW TYPES
# ============================================================================

echo ""
echo "🔌 Creating devices with new types..."

# HTTP Device - Cloud Weather Station
echo "Creating HTTP Weather Station..."
HTTP_DEVICE=$(curl -s -X POST "$API_URL/tenants/$TENANT_ID/devices" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{
    \"name\": \"Pretoria Weather Station\",
    \"device_type_id\": \"$HTTP_DEVICE_TYPE\",
    \"organization_id\": \"10000000-0000-0000-0000-000000000003\",
    \"site_id\": \"20000000-0000-0000-0000-000000000004\",
    \"attributes\": {
      \"latitude\": -25.7479,
      \"longitude\": 28.2293,
      \"installation_date\": \"2024-11-15\",
      \"api_endpoint\": \"https://weather.api.co.za/pretoria\"
    }
  }" | python -c "import sys, json; print(json.load(sys.stdin)['data']['id'])")
echo "✅ HTTP Device ID: $HTTP_DEVICE"

# Modbus Device - Industrial Pressure Sensor
echo "Creating Modbus Pressure Sensor..."
MODBUS_DEVICE=$(curl -s -X POST "$API_URL/tenants/$TENANT_ID/devices" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{
    \"name\": \"Lethabo Pressure Sensor 01\",
    \"device_type_id\": \"$MODBUS_DEVICE_TYPE\",
    \"organization_id\": \"10000000-0000-0000-0000-000000000001\",
    \"site_id\": \"20000000-0000-0000-0000-000000000001\",
    \"attributes\": {
      \"latitude\": -26.7833,
      \"longitude\": 27.9167,
      \"modbus_address\": \"1\",
      \"rs485_port\": \"/dev/ttyUSB0\"
    }
  }" | python -c "import sys, json; print(json.load(sys.stdin)['data']['id'])")
echo "✅ Modbus Device ID: $MODBUS_DEVICE"

# OPC-UA Device - Manufacturing PLC
echo "Creating OPC-UA PLC..."
OPCUA_DEVICE=$(curl -s -X POST "$API_URL/tenants/$TENANT_ID/devices" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{
    \"name\": \"Assembly Line PLC-A1\",
    \"device_type_id\": \"$OPCUA_DEVICE_TYPE\",
    \"organization_id\": \"10000000-0000-0000-0000-000000000005\",
    \"site_id\": \"20000000-0000-0000-0000-000000000003\",
    \"attributes\": {
      \"latitude\": -26.2708,
      \"longitude\": 28.0714,
      \"opcua_endpoint\": \"opc.tcp://192.168.1.100:4840\",
      \"line\": \"Assembly A\"
    }
  }" | python -c "import sys, json; print(json.load(sys.stdin)['data']['id'])")
echo "✅ OPC-UA Device ID: $OPCUA_DEVICE"

# CoAP Device - Battery-powered sensor
echo "Creating CoAP Battery Sensor..."
COAP_DEVICE=$(curl -s -X POST "$API_URL/tenants/$TENANT_ID/devices" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{
    \"name\": \"Remote Fridge Monitor 01\",
    \"device_type_id\": \"$COAP_DEVICE_TYPE\",
    \"organization_id\": \"10000000-0000-0000-0000-000000000002\",
    \"site_id\": \"20000000-0000-0000-0000-000000000007\",
    \"attributes\": {
      \"latitude\": -25.8853,
      \"longitude\": 28.2683,
      \"coap_url\": \"coap://sensor-01.local:5683\"
    }
  }" | python -c "import sys, json; print(json.load(sys.stdin)['data']['id'])")
echo "✅ CoAP Device ID: $COAP_DEVICE"

# ============================================================================
# 3. CREATE ALERT RULES
# ============================================================================

echo ""
echo "⚠️ Creating alert rules..."

# Alert for HTTP device - High temperature
curl -s -X POST "$API_URL/tenants/$TENANT_ID/devices/$HTTP_DEVICE/alert-rules" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "High Temperature Alert",
    "description": "Triggered when temperature exceeds 35°C",
    "metric": "temperature",
    "operator": "gt",
    "threshold": 35.0,
    "severity": "warning",
    "cooldown_minutes": 15
  }' > /dev/null
echo "✅ Created alert: High Temperature (HTTP Device)"

# Alert for Modbus device - High pressure
curl -s -X POST "$API_URL/tenants/$TENANT_ID/devices/$MODBUS_DEVICE/alert-rules" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Critical Pressure Alert",
    "description": "Triggered when pressure exceeds 400 bar",
    "metric": "pressure",
    "operator": "gt",
    "threshold": 400.0,
    "severity": "critical",
    "cooldown_minutes": 5
  }' > /dev/null
echo "✅ Created alert: Critical Pressure (Modbus Device)"

# Alert for CoAP device - Low battery
curl -s -X POST "$API_URL/tenants/$TENANT_ID/devices/$COAP_DEVICE/alert-rules" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Low Battery Alert",
    "description": "Triggered when battery drops below 20%",
    "metric": "battery",
    "operator": "lt",
    "threshold": 20.0,
    "severity": "warning",
    "cooldown_minutes": 60
  }' > /dev/null
echo "✅ Created alert: Low Battery (CoAP Device)"

# ============================================================================
# SUMMARY
# ============================================================================

echo ""
echo "✅ Test data creation complete!"
echo ""
echo "📊 Summary:"
curl -s -X GET "$API_URL/tenants/$TENANT_ID/device-types" \
  -H "Authorization: Bearer $TOKEN" | python -c "import sys, json; print('Device Types:', json.load(sys.stdin)['meta']['total'])"

curl -s -X GET "$API_URL/tenants/$TENANT_ID/devices" \
  -H "Authorization: Bearer $TOKEN" | python -c "import sys, json; print('Devices:', json.load(sys.stdin)['meta']['total'])"

echo ""
echo "🎉 Ready to export and sync to staging!"
