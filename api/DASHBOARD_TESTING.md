# Dashboard System Testing Guide

## Overview

This document provides comprehensive testing procedures for the dashboard system API endpoints.

## Prerequisites

1. **Database Setup:**
   - PostgreSQL database with migrations applied (including 010_dashboard_system.sql)
   - Test tenant created
   - Test user created

2. **Authentication:**
   - Valid JWT token with tenant_id and user_id
   - Export token as environment variable:
   ```bash
   export TOKEN="your_jwt_token_here"
   export TENANT_ID="your_tenant_uuid_here"
   ```

## Test Scenarios

### 1. Dashboard CRUD Operations

#### Test 1.1: Create Dashboard
```bash
curl -X POST "http://localhost:8000/api/v1/tenants/${TENANT_ID}/dashboards" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Test Dashboard",
    "description": "Test dashboard for API testing",
    "is_default": false,
    "layout_config": {
      "cols": 12,
      "rowHeight": 30
    },
    "theme": {
      "primary_color": "#0ea5e9"
    }
  }'
```

**Expected Result:**
- Status: 201 Created
- Response contains dashboard with auto-generated ID
- `created_at` and `updated_at` timestamps set

#### Test 1.2: List Dashboards
```bash
curl -X GET "http://localhost:8000/api/v1/tenants/${TENANT_ID}/dashboards" \
  -H "Authorization: Bearer ${TOKEN}"
```

**Expected Result:**
- Status: 200 OK
- Returns array of dashboards
- Each dashboard includes `widget_count`
- Only shows current user's dashboards

#### Test 1.3: Get Dashboard Details
```bash
# Replace {DASHBOARD_ID} with ID from create response
curl -X GET "http://localhost:8000/api/v1/tenants/${TENANT_ID}/dashboards/{DASHBOARD_ID}" \
  -H "Authorization: Bearer ${TOKEN}"
```

**Expected Result:**
- Status: 200 OK
- Returns dashboard with `widgets` array
- Includes all dashboard fields

#### Test 1.4: Update Dashboard
```bash
curl -X PUT "http://localhost:8000/api/v1/tenants/${TENANT_ID}/dashboards/{DASHBOARD_ID}" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Updated Dashboard Name",
    "is_default": true
  }'
```

**Expected Result:**
- Status: 200 OK
- Returns updated dashboard
- `updated_at` timestamp changed
- Other dashboards' `is_default` set to false

#### Test 1.5: Delete Dashboard
```bash
curl -X DELETE "http://localhost:8000/api/v1/tenants/${TENANT_ID}/dashboards/{DASHBOARD_ID}" \
  -H "Authorization: Bearer ${TOKEN}"
```

**Expected Result:**
- Status: 200 OK
- Dashboard deleted
- Associated widgets cascade deleted

### 2. Widget Operations

#### Test 2.1: Add Widget to Dashboard
```bash
curl -X POST "http://localhost:8000/api/v1/tenants/${TENANT_ID}/dashboards/{DASHBOARD_ID}/widgets" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "widget_type": "kpi_card",
    "title": "Temperature",
    "position_x": 0,
    "position_y": 0,
    "width": 3,
    "height": 2,
    "configuration": {
      "metric": "temperature",
      "unit": "°C",
      "decimal_places": 1,
      "icon": "thermometer",
      "color": "#ef4444"
    },
    "data_sources": [],
    "refresh_interval": 30
  }'
```

**Expected Result:**
- Status: 201 Created
- Widget created with auto-generated ID
- Widget linked to dashboard

#### Test 2.2: Update Widget Configuration
```bash
curl -X PUT "http://localhost:8000/api/v1/tenants/${TENANT_ID}/dashboards/{DASHBOARD_ID}/widgets/{WIDGET_ID}" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Updated Temperature",
    "configuration": {
      "color": "#3b82f6"
    }
  }'
```

**Expected Result:**
- Status: 200 OK
- Widget configuration updated
- Unchanged fields remain the same

#### Test 2.3: Bind Device to Widget
```bash
# Replace {DEVICE_ID} with a valid device UUID
curl -X POST "http://localhost:8000/api/v1/tenants/${TENANT_ID}/dashboards/{DASHBOARD_ID}/widgets/{WIDGET_ID}/bind-device" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "device_id": "{DEVICE_ID}",
    "metric": "temperature",
    "alias": "Main Sensor"
  }'
```

**Expected Result:**
- Status: 200 OK
- Device added to widget's `data_sources` array
- If device already bound, updates existing binding

#### Test 2.4: Delete Widget
```bash
curl -X DELETE "http://localhost:8000/api/v1/tenants/${TENANT_ID}/dashboards/{DASHBOARD_ID}/widgets/{WIDGET_ID}" \
  -H "Authorization: Bearer ${TOKEN}"
```

**Expected Result:**
- Status: 200 OK
- Widget removed from dashboard

### 3. Layout Management

#### Test 3.1: Batch Update Widget Positions
```bash
curl -X PUT "http://localhost:8000/api/v1/tenants/${TENANT_ID}/dashboards/{DASHBOARD_ID}/layout" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "widgets": [
      {
        "id": "{WIDGET_ID_1}",
        "x": 0,
        "y": 0,
        "w": 3,
        "h": 2
      },
      {
        "id": "{WIDGET_ID_2}",
        "x": 3,
        "y": 0,
        "w": 3,
        "h": 2
      }
    ]
  }'
```

**Expected Result:**
- Status: 200 OK
- All specified widgets repositioned
- Response includes `updated_count`

### 4. Solution Templates

#### Test 4.1: List Solution Templates
```bash
curl -X GET "http://localhost:8000/api/v1/tenants/${TENANT_ID}/solution-templates" \
  -H "Authorization: Bearer ${TOKEN}"
```

**Expected Result:**
- Status: 200 OK
- Returns array of active templates
- Each template includes `compatible_device_count`
- Shows Water Flow Monitoring template (from seed data)

#### Test 4.2: Get Template Details
```bash
curl -X GET "http://localhost:8000/api/v1/tenants/${TENANT_ID}/solution-templates/{TEMPLATE_ID}" \
  -H "Authorization: Bearer ${TOKEN}"
```

**Expected Result:**
- Status: 200 OK
- Returns complete template configuration
- Includes widget definitions in `template_config`

#### Test 4.3: Apply Solution Template
```bash
curl -X POST "http://localhost:8000/api/v1/tenants/${TENANT_ID}/solution-templates/{TEMPLATE_ID}/apply" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "dashboard_name": "My Water Monitoring",
    "set_as_default": false
  }'
```

**Expected Result:**
- Status: 200 OK
- New dashboard created from template
- Multiple widgets created
- Returns `widgets_created` count
- Auto-binds compatible devices if available

### 5. Security & Authorization Tests

#### Test 5.1: Missing Authorization Header
```bash
curl -X GET "http://localhost:8000/api/v1/tenants/${TENANT_ID}/dashboards"
```

**Expected Result:**
- Status: 401 Unauthorized
- Error message about missing authorization

#### Test 5.2: Invalid Token
```bash
curl -X GET "http://localhost:8000/api/v1/tenants/${TENANT_ID}/dashboards" \
  -H "Authorization: Bearer invalid_token"
```

**Expected Result:**
- Status: 401 Unauthorized
- Error message about invalid token

#### Test 5.3: Tenant Mismatch
```bash
# Use wrong tenant_id in URL
curl -X GET "http://localhost:8000/api/v1/tenants/00000000-0000-0000-0000-000000000000/dashboards" \
  -H "Authorization: Bearer ${TOKEN}"
```

**Expected Result:**
- Status: 403 Forbidden
- Error message about tenant mismatch

#### Test 5.4: Access Another User's Dashboard
```bash
# Try to access dashboard created by different user (requires second test user)
curl -X GET "http://localhost:8000/api/v1/tenants/${TENANT_ID}/dashboards/{OTHER_USER_DASHBOARD_ID}" \
  -H "Authorization: Bearer ${TOKEN}"
```

**Expected Result:**
- Status: 404 Not Found
- RLS prevents access to other users' dashboards

### 6. Data Validation Tests

#### Test 6.1: Invalid Widget Dimensions
```bash
curl -X POST "http://localhost:8000/api/v1/tenants/${TENANT_ID}/dashboards/{DASHBOARD_ID}/widgets" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "widget_type": "kpi_card",
    "title": "Test",
    "position_x": -1,
    "position_y": -1,
    "width": 0,
    "height": 0
  }'
```

**Expected Result:**
- Status: 422 Unprocessable Entity
- Validation errors for negative positions and zero dimensions

#### Test 6.2: Missing Required Fields
```bash
curl -X POST "http://localhost:8000/api/v1/tenants/${TENANT_ID}/dashboards" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "description": "Missing name field"
  }'
```

**Expected Result:**
- Status: 422 Unprocessable Entity
- Validation error for missing `name` field

### 7. Edge Cases

#### Test 7.1: Create Multiple Default Dashboards
```bash
# Create first default dashboard
curl -X POST "http://localhost:8000/api/v1/tenants/${TENANT_ID}/dashboards" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"name": "Default 1", "is_default": true}'

# Create second default dashboard
curl -X POST "http://localhost:8000/api/v1/tenants/${TENANT_ID}/dashboards" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"name": "Default 2", "is_default": true}'

# List dashboards
curl -X GET "http://localhost:8000/api/v1/tenants/${TENANT_ID}/dashboards" \
  -H "Authorization: Bearer ${TOKEN}"
```

**Expected Result:**
- Only one dashboard has `is_default: true`
- Previous default automatically set to `false`

#### Test 7.2: Delete Dashboard with Widgets
```bash
# Create dashboard
# Add multiple widgets
# Delete dashboard
# Verify widgets are also deleted (cascade)
```

**Expected Result:**
- Dashboard and all widgets deleted
- No orphaned widgets in database

#### Test 7.3: Apply Template with No Compatible Devices
```bash
# Apply template when tenant has no compatible devices
curl -X POST "http://localhost:8000/api/v1/tenants/${TENANT_ID}/solution-templates/{TEMPLATE_ID}/apply" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"dashboard_name": "Test"}'
```

**Expected Result:**
- Dashboard still created
- Widgets created without device bindings
- `auto_bound_devices: 0` in response

## Automated Testing Script

Create a file `test_dashboard_api.sh`:

```bash
#!/bin/bash

# Configuration
export BASE_URL="http://localhost:8000/api/v1"
export TOKEN="your_token_here"
export TENANT_ID="your_tenant_id_here"

# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Test counter
TESTS_PASSED=0
TESTS_FAILED=0

# Helper function to run test
run_test() {
    local test_name=$1
    local expected_status=$2
    local response_file=$3

    actual_status=$(jq -r '.status' "$response_file" 2>/dev/null || echo "error")

    if [ "$actual_status" = "$expected_status" ]; then
        echo -e "${GREEN}✓ $test_name${NC}"
        ((TESTS_PASSED++))
    else
        echo -e "${RED}✗ $test_name (expected $expected_status, got $actual_status)${NC}"
        ((TESTS_FAILED++))
    fi
}

# Test 1: Create Dashboard
echo "Running Dashboard API Tests..."
echo ""

DASHBOARD_RESPONSE=$(curl -s -w '\n%{http_code}' -X POST \
  "${BASE_URL}/tenants/${TENANT_ID}/dashboards" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"name": "Test Dashboard", "is_default": false}')

STATUS=$(echo "$DASHBOARD_RESPONSE" | tail -n1)
BODY=$(echo "$DASHBOARD_RESPONSE" | sed '$d')

if [ "$STATUS" = "201" ]; then
    echo -e "${GREEN}✓ Create Dashboard${NC}"
    DASHBOARD_ID=$(echo "$BODY" | jq -r '.data.id')
    ((TESTS_PASSED++))
else
    echo -e "${RED}✗ Create Dashboard (status: $STATUS)${NC}"
    ((TESTS_FAILED++))
fi

# Test 2: List Dashboards
STATUS=$(curl -s -w '%{http_code}' -o /dev/null \
  "${BASE_URL}/tenants/${TENANT_ID}/dashboards" \
  -H "Authorization: Bearer ${TOKEN}")

if [ "$STATUS" = "200" ]; then
    echo -e "${GREEN}✓ List Dashboards${NC}"
    ((TESTS_PASSED++))
else
    echo -e "${RED}✗ List Dashboards (status: $STATUS)${NC}"
    ((TESTS_FAILED++))
fi

# Test 3: Get Dashboard
if [ -n "$DASHBOARD_ID" ]; then
    STATUS=$(curl -s -w '%{http_code}' -o /dev/null \
      "${BASE_URL}/tenants/${TENANT_ID}/dashboards/${DASHBOARD_ID}" \
      -H "Authorization: Bearer ${TOKEN}")

    if [ "$STATUS" = "200" ]; then
        echo -e "${GREEN}✓ Get Dashboard${NC}"
        ((TESTS_PASSED++))
    else
        echo -e "${RED}✗ Get Dashboard (status: $STATUS)${NC}"
        ((TESTS_FAILED++))
    fi
fi

# Summary
echo ""
echo "================================"
echo "Test Summary:"
echo "Passed: $TESTS_PASSED"
echo "Failed: $TESTS_FAILED"
echo "================================"

if [ $TESTS_FAILED -eq 0 ]; then
    exit 0
else
    exit 1
fi
```

Make executable and run:
```bash
chmod +x test_dashboard_api.sh
./test_dashboard_api.sh
```

## Database Verification

### Check RLS Policies
```sql
-- Verify dashboard RLS policies
SELECT schemaname, tablename, policyname, permissive, roles, cmd, qual
FROM pg_policies
WHERE tablename IN ('dashboards', 'dashboard_widgets')
ORDER BY tablename, policyname;
```

### Check User Context Setting
```sql
-- Test RLS context (run as database user)
SELECT set_config('app.current_tenant_id', 'your-tenant-uuid', false);
SELECT set_config('app.current_user_id', 'your-user-uuid', false);

-- Verify dashboards are filtered
SELECT id, name, user_id FROM dashboards;
```

### Check Cascade Deletes
```sql
-- Create test data
INSERT INTO dashboards (id, tenant_id, user_id, name)
VALUES ('test-dashboard-id', 'tenant-id', 'user-id', 'Test Dashboard');

INSERT INTO dashboard_widgets (dashboard_id, widget_type, position_x, position_y)
VALUES ('test-dashboard-id', 'kpi_card', 0, 0);

-- Delete dashboard
DELETE FROM dashboards WHERE id = 'test-dashboard-id';

-- Verify widgets deleted
SELECT * FROM dashboard_widgets WHERE dashboard_id = 'test-dashboard-id';
-- Should return 0 rows
```

## Performance Testing

### Load Test: Create 100 Dashboards
```bash
for i in {1..100}; do
  curl -s -X POST "${BASE_URL}/tenants/${TENANT_ID}/dashboards" \
    -H "Authorization: Bearer ${TOKEN}" \
    -H "Content-Type: application/json" \
    -d "{\"name\": \"Dashboard $i\"}" &
done
wait
```

### Load Test: List Dashboards with Many Widgets
```bash
# Measure response time
time curl -X GET "${BASE_URL}/tenants/${TENANT_ID}/dashboards" \
  -H "Authorization: Bearer ${TOKEN}"
```

## Test Checklist

- [ ] Dashboard CRUD operations
- [ ] Widget CRUD operations
- [ ] Layout batch update
- [ ] Device binding
- [ ] Solution templates list
- [ ] Template application
- [ ] Authorization checks
- [ ] Tenant isolation
- [ ] User isolation
- [ ] Data validation
- [ ] Error handling
- [ ] Cascade deletes
- [ ] Default dashboard handling
- [ ] RLS policies
- [ ] Performance under load

## Known Limitations

1. **Widget Limit**: No hard limit on widgets per dashboard (consider adding)
2. **Dashboard Limit**: No limit on dashboards per user (consider quota)
3. **Template Permissions**: All users can view all templates (tenant-level)
4. **Widget Overlapping**: No validation to prevent widget overlap
5. **Theme Validation**: Theme configuration not strictly validated

## Recommendations

1. Add widget count limits (e.g., max 50 widgets per dashboard)
2. Add dashboard quota per user (e.g., max 20 dashboards)
3. Add widget position conflict detection
4. Add theme schema validation
5. Add dashboard export/import functionality
6. Add dashboard sharing between users (future)
7. Add dashboard versioning (future)
