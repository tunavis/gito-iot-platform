#!/bin/bash

echo "========================================="
echo "Dashboard Builder API Test"
echo "========================================="
echo ""

# Test 1: API Health
echo "1. Testing API Health..."
curl -s http://localhost:8000/api/health
echo -e "\n"

# Test 2: Login and get token
echo "2. Logging in to get auth token..."
LOGIN_RESPONSE=$(curl -s -X POST http://localhost:8000/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@gito.demo","password":"admin123"}')
echo $LOGIN_RESPONSE | head -c 200
echo -e "\n"

TOKEN=$(echo $LOGIN_RESPONSE | grep -o '"access_token":"[^"]*' | sed 's/"access_token":"//')

if [ -z "$TOKEN" ]; then
  echo "❌ Failed to get auth token"
  exit 1
fi

echo "✅ Got auth token"
echo ""

# Extract tenant_id from token (decode JWT)
TENANT_ID=$(echo $TOKEN | cut -d'.' -f2 | base64 -d 2>/dev/null | grep -o '"tenant_id":"[^"]*' | sed 's/"tenant_id":"//')

if [ -z "$TENANT_ID" ]; then
  TENANT_ID="00000000-0000-0000-0000-000000000001"  # Default fallback
fi

echo "Using Tenant ID: $TENANT_ID"
echo ""

# Test 3: List Solution Templates
echo "3. Testing Solution Templates API..."
curl -s -X GET "http://localhost:8000/api/v1/tenants/${TENANT_ID}/solution-templates" \
  -H "Authorization: Bearer $TOKEN" | head -c 500
echo -e "\n"

# Test 4: List Dashboards
echo "4. Testing Dashboards API..."
curl -s -X GET "http://localhost:8000/api/v1/tenants/${TENANT_ID}/dashboards" \
  -H "Authorization: Bearer $TOKEN"
echo -e "\n"

# Test 5: Create a test dashboard
echo "5. Creating test dashboard..."
CREATE_RESPONSE=$(curl -s -X POST "http://localhost:8000/api/v1/tenants/${TENANT_ID}/dashboards" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Test Dashboard",
    "description": "Testing dashboard builder",
    "is_default": false,
    "layout_config": {},
    "theme": {},
    "extra_data": {}
  }')
echo $CREATE_RESPONSE | head -c 500
echo -e "\n"

DASHBOARD_ID=$(echo $CREATE_RESPONSE | grep -o '"id":"[^"]*' | head -1 | sed 's/"id":"//')

if [ -n "$DASHBOARD_ID" ]; then
  echo "✅ Dashboard created with ID: $DASHBOARD_ID"

  # Test 6: Add a widget to dashboard
  echo ""
  echo "6. Adding KPI widget to dashboard..."
  curl -s -X POST "http://localhost:8000/api/v1/tenants/${TENANT_ID}/dashboards/${DASHBOARD_ID}/widgets" \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"widget_type":"kpi_card","title":"Test KPI","position_x":0,"position_y":0,"width":3,"height":2,"configuration":{"metric":"temperature","unit":"C","decimal_places":1,"color":"#3b82f6"},"data_sources":[],"refresh_interval":30}' | head -c 500
  echo -e "\n"

  # Test 7: Get dashboard with widgets
  echo "7. Retrieving dashboard with widgets..."
  curl -s -X GET "http://localhost:8000/api/v1/tenants/${TENANT_ID}/dashboards/${DASHBOARD_ID}" \
    -H "Authorization: Bearer $TOKEN" | head -c 500
  echo -e "\n"
else
  echo "❌ Failed to create dashboard"
fi

echo ""
echo "========================================="
echo "Test Complete!"
echo "========================================="
