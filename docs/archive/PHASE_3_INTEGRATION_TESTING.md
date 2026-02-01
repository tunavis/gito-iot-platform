# Phase 3 Integration Testing Guide

## Overview

This guide validates the unified ChirpStack integration implemented in Phase 3:
- Device creation in Gito → Auto-sync to ChirpStack
- ChirpStack uplinks → Auto-ingestion to Gito telemetry
- Device deletion in Gito → Auto-cleanup in ChirpStack

## Test Scenarios

### Test 1: Create LoRaWAN Device (Device → ChirpStack)

**Objective**: Verify device creation automatically syncs to ChirpStack

**Setup**:
1. Have ChirpStack running with test application
2. Get ChirpStack API URL, tenant ID, API key
3. Set environment variables:
   ```bash
   CHIRPSTACK_API_URL=http://localhost:8080
   CHIRPSTACK_TENANT_ID=your-tenant-id
   CHIRPSTACK_API_KEY=your-api-key
   ```
4. Start Gito API and processor containers

**Steps**:
1. Create device via API with LoRaWAN fields:
   ```bash
   curl -X POST http://localhost:8000/api/v1/tenants/{tenant_id}/devices \
     -H "Authorization: Bearer {token}" \
     -H "Content-Type: application/json" \
     -d '{
       "name": "Test LoRa Device",
       "device_type": "lora_sensor",
       "lorawan_dev_eui": "0102030405060708",
       "chirpstack_app_id": "1",
       "device_profile_id": "profile-uuid"
     }'
   ```

2. Check response:
   - HTTP 201 returned immediately
   - Device ID in response
   - `chirpstack_synced: false` initially (sync happens async)

3. Wait 1-2 seconds for async sync

4. Verify in ChirpStack:
   - Device appears in ChirpStack UI
   - Device name matches
   - Device profile assigned correctly
   - Custom variable `gito_device_id` set to Gito device UUID

5. Get device from Gito API:
   ```bash
   curl http://localhost:8000/api/v1/tenants/{tenant_id}/devices/{device_id} \
     -H "Authorization: Bearer {token}"
   ```
   - Verify `chirpstack_synced: true`
   - Verify `dev_eui` populated

**Expected Result**: ✅ Device appears in both Gito and ChirpStack within 2 seconds

---

### Test 2: Update LoRaWAN Device

**Objective**: Verify device updates sync to ChirpStack

**Steps**:
1. Update device name:
   ```bash
   curl -X PUT http://localhost:8000/api/v1/tenants/{tenant_id}/devices/{device_id} \
     -H "Authorization: Bearer {token}" \
     -H "Content-Type: application/json" \
     -d '{
       "name": "Updated LoRa Device Name"
     }'
   ```

2. Verify Gito response: HTTP 200, updated name

3. Wait 1-2 seconds

4. Verify ChirpStack UI updated device name

**Expected Result**: ✅ Device name synced within 2 seconds

---

### Test 3: ChirpStack Uplink → Gito Ingestion

**Objective**: Verify uplink from ChirpStack is ingested into Gito telemetry

**Setup**:
1. Have device created and synced (Test 1)
2. Configure ChirpStack webhook to point to:
   ```
   http://gito-api:8000/api/v1/lorawan/webhooks/{tenant_id}/uplink
   ```
   (Replace {tenant_id} with actual UUID)

3. Have a real LoRa device or simulator send uplink to ChirpStack

**Steps**:
1. Device sends uplink in ChirpStack

2. Check Gito API logs:
   ```bash
   docker logs gito-api | grep "lorawan_uplink_received"
   ```
   Should see:
   ```
   {"event": "lorawan_uplink_received", "dev_eui": "0102030405060708", "data_points": N}
   ```

3. Get device to verify status updated:
   ```bash
   curl http://localhost:8000/api/v1/tenants/{tenant_id}/devices/{device_id} \
     -H "Authorization: Bearer {token}"
   ```
   - Verify `status: "online"`
   - Verify `last_seen` is recent
   - Verify `signal_strength` updated (if payload included RSSI)

**Expected Result**: ✅ Device status and metrics updated within 1 second of uplink

---

### Test 4: Device Not Found in Gito (Graceful Degradation)

**Objective**: Verify uplink from unregistered device doesn't break system

**Steps**:
1. Send uplink from ChirpStack for a device NOT registered in Gito
2. Check logs for:
   ```
   "uplink_webhook_device_not_found"
   ```

3. Verify API returns 200 with message:
   ```json
   {
     "success": true,
     "data": {
       "message": "Device not found in Gito, uplink ignored",
       "dev_eui": "..."
     }
   }
   ```

**Expected Result**: ✅ Uplink gracefully ignored, no errors

---

### Test 5: Delete Device (Cleanup from ChirpStack)

**Objective**: Verify device deletion removes from ChirpStack

**Setup**:
1. Have device created and synced (Test 1)
2. Get device ID

**Steps**:
1. Delete device:
   ```bash
   curl -X DELETE http://localhost:8000/api/v1/tenants/{tenant_id}/devices/{device_id} \
     -H "Authorization: Bearer {token}"
   ```

2. Verify HTTP 200 response

3. Wait 1-2 seconds

4. Verify device removed from ChirpStack UI

5. Try to query device in Gito:
   ```bash
   curl http://localhost:8000/api/v1/tenants/{tenant_id}/devices/{device_id} \
     -H "Authorization: Bearer {token}"
   ```
   - Should return 404

**Expected Result**: ✅ Device deleted from both Gito and ChirpStack

---

### Test 6: Device Status Webhook

**Objective**: Verify ChirpStack status webhook updates device online/offline

**Setup**:
1. Configure ChirpStack webhook:
   ```
   http://gito-api:8000/api/v1/lorawan/webhooks/{tenant_id}/status
   ```

2. Have device registered in Gito and ChirpStack

**Steps**:
1. Disconnect device from network in ChirpStack

2. ChirpStack sends status webhook with `online: false`

3. Check Gito device:
   ```bash
   curl http://localhost:8000/api/v1/tenants/{tenant_id}/devices/{device_id} \
     -H "Authorization: Bearer {token}"
   ```
   - Verify `status: "offline"`

4. Reconnect device, ChirpStack sends `online: true`

5. Verify device status updates to "online"

**Expected Result**: ✅ Device status syncs within 1 second

---

### Test 7: Error Webhook Logging

**Objective**: Verify ChirpStack error notifications are logged

**Setup**:
1. Configure ChirpStack webhook:
   ```
   http://gito-api:8000/api/v1/lorawan/webhooks/{tenant_id}/error
   ```

**Steps**:
1. Trigger device error in ChirpStack (e.g., frame counter reset)

2. ChirpStack sends error webhook

3. Check logs:
   ```bash
   docker logs gito-api | grep "device_error_received"
   ```

4. Verify log contains:
   - `dev_eui`
   - `error_type`
   - `error_message`

**Expected Result**: ✅ Errors logged for debugging

---

## Performance Benchmarks

Target metrics for Phase 3 completion:

| Metric | Target | Notes |
|--------|--------|-------|
| Device creation → ChirpStack sync | < 2 seconds | Async, non-blocking |
| ChirpStack uplink → Gito ingestion | < 1 second | Webhook driven |
| Device deletion → ChirpStack cleanup | < 2 seconds | Async |
| Device status update | < 1 second | Webhook driven |
| Device not found uplink (graceful fail) | < 100ms | No DB write |
| API latency (device CRUD) | < 200ms p95 | Async ChirpStack calls don't block |

---

## Error Scenarios

### Scenario A: ChirpStack Down During Device Create

**Expected**: Device created in Gito, ChirpStack sync fails gracefully
- Device returned to client with `chirpstack_synced: false`
- Error logged
- Can retry sync later via `/ota/campaigns` or admin endpoint

### Scenario B: Invalid ChirpStack Credentials

**Expected**: Sync fails, device still created in Gito
- Error logged with context
- Can be fixed by updating config and retrying

### Scenario C: Device Exists in ChirpStack Already

**Expected**: Update operation syncs metadata (name, profile)
- Device not duplicated
- Metadata kept in sync

---

## Debug Commands

```bash
# Check ChirpStack integration status
curl http://localhost:8000/api/health

# View all devices for tenant
curl http://localhost:8000/api/v1/tenants/{tenant_id}/devices \
  -H "Authorization: Bearer {token}"

# View single device with ChirpStack fields
curl http://localhost:8000/api/v1/tenants/{tenant_id}/devices/{device_id} \
  -H "Authorization: Bearer {token}" | jq '.data | {id, name, dev_eui, chirpstack_synced, status}'

# Check API logs
docker logs gito-api -f

# Check ChirpStack client health
# (When available: GET /api/v1/health/chirpstack)

# Query device telemetry
curl http://localhost:8000/api/v1/tenants/{tenant_id}/devices/{device_id}/telemetry \
  -H "Authorization: Bearer {token}"
```

---

## Sign-Off Checklist

- [ ] Test 1: Device creation with LoRaWAN fields
- [ ] Test 2: Device name update syncs
- [ ] Test 3: Uplink telemetry ingested
- [ ] Test 4: Missing device uplink gracefully ignored
- [ ] Test 5: Device deletion removes from ChirpStack
- [ ] Test 6: Status webhooks update device
- [ ] Test 7: Error webhooks logged
- [ ] Performance: All metrics meet targets
- [ ] Error scenarios: All handle gracefully
- [ ] Documentation: API docs updated with webhook URLs

---

## Next Steps After Testing

1. **OTA Firmware Workflow** (Phase 3 continuation)
   - Implement Cadence workflow for OTA_UPDATE_DEVICE
   - Wire firmware API endpoints to workflow execution

2. **Device Groups & Bulk Operations** (Phase 3.1)
   - Device group management CRUD
   - Bulk firmware campaigns
   - Bulk alert rules

3. **Production Hardening** (Phase 3+)
   - Certificate-based device authentication
   - Webhook signature verification
   - Rate limiting per webhook source
   - Retry queue for failed webhooks
