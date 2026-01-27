# Unified Alarms Architecture - Enterprise-Grade Implementation

## Overview

Following Cumulocity and ThingsBoard best practices, we've implemented a unified, enterprise-grade alarm system with proper lifecycle management.

## Architecture

```
┌─────────────────────────────────────────────────┐
│         RULE DEFINITIONS (Configuration)        │
├─────────────────────────────────────────────────┤
│ alert_rules:                                    │
│  - id, tenant_id, device_id (optional)         │
│  - rule_type: SIMPLE | COMPLEX                 │
│  - severity: CRITICAL | MAJOR | MINOR | WARNING│
│  - conditions: JSONB (single or multiple)      │
│  - logic: AND | OR (for complex rules)         │
│  - active: boolean                             │
└──────────────┬──────────────────────────────────┘
               │
               │ Triggers
               ▼
┌─────────────────────────────────────────────────┐
│     ALARM INSTANCES (State Management)          │
├─────────────────────────────────────────────────┤
│ alarms:                                         │
│  - id, tenant_id, alert_rule_id, device_id     │
│  - alarm_type, source, severity                │
│  - status: ACTIVE → ACKNOWLEDGED → CLEARED     │
│  - message, context (JSONB)                    │
│  - fired_at, acknowledged_at, cleared_at       │
│  - acknowledged_by (user who ack'd)            │
└─────────────────────────────────────────────────┘
```

## Key Concepts

### Rule Definitions (`alert_rules`)
- **Simple Rules**: Single condition (temperature > 30°C)
  - `rule_type` = 'SIMPLE'
  - `conditions` = `[{"field": "temperature", "operator": "gt", "value": 30}]`
  
- **Complex Rules**: Multiple conditions with AND/OR logic
  - `rule_type` = 'COMPLEX'
  - `conditions` = `[{...}, {...}]`
  - `logic` = 'AND' | 'OR'
  
- **Device-Specific vs Fleet-Wide**:
  - Device-specific: `device_id` is set
  - Fleet-wide: `device_id` is NULL

### Alarm Instances (`alarms`)
- **Lifecycle States**:
  - `ACTIVE`: New alarm, requires attention
  - `ACKNOWLEDGED`: Operator aware, investigating
  - `CLEARED`: Issue resolved, alarm inactive

- **Severity Levels**:
  - `CRITICAL`: System down, immediate action required
  - `MAJOR`: Significant impact, urgent attention needed
  - `MINOR`: Degraded performance, should be addressed
  - `WARNING`: Potential issue, informational

## API Endpoints

### Alarms Router (`/alarms`)

#### List & Filter
```http
GET /alarms?status=ACTIVE&severity=CRITICAL&device_id={uuid}
```

#### Get Summary
```http
GET /alarms/summary
Response: {
  "total": 45,
  "active": 12,
  "acknowledged": 8,
  "cleared": 25,
  "by_severity": {
    "CRITICAL": 3,
    "MAJOR": 15,
    "MINOR": 20,
    "WARNING": 7
  }
}
```

#### Acknowledge Alarm
```http
POST /alarms/{id}/acknowledge
{
  "comment": "Investigating high temperature issue"
}
```

#### Clear Alarm
```http
POST /alarms/{id}/clear
{
  "comment": "Replaced faulty sensor, temperature normalized"
}
```

#### Delete Alarm
```http
DELETE /alarms/{id}
Note: Only CLEARED alarms can be deleted
```

## Database Schema

### `alert_rules` Table
```sql
CREATE TABLE alert_rules (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  device_id UUID NULL,  -- NULL = fleet-wide
  rule_type VARCHAR(20) DEFAULT 'SIMPLE',  -- SIMPLE | COMPLEX
  severity VARCHAR(20) DEFAULT 'MAJOR',
  logic VARCHAR(10) DEFAULT 'AND',  -- AND | OR
  conditions JSONB NOT NULL,  -- Array of conditions
  active BOOLEAN DEFAULT TRUE,
  cooldown_minutes INTEGER DEFAULT 5,
  
  -- Legacy fields (for simple rules)
  metric VARCHAR(50),
  operator VARCHAR(10),
  threshold NUMERIC(10, 2)
);
```

### `alarms` Table
```sql
CREATE TABLE alarms (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  alert_rule_id UUID,  -- NULL = manual alarm
  device_id UUID,      -- NULL = fleet-wide alarm
  
  alarm_type VARCHAR(100) NOT NULL,
  source VARCHAR(255),
  severity VARCHAR(20) DEFAULT 'MAJOR',
  status VARCHAR(20) DEFAULT 'ACTIVE',
  
  message TEXT NOT NULL,
  context JSONB,
  
  fired_at TIMESTAMP NOT NULL,
  acknowledged_at TIMESTAMP,
  acknowledged_by UUID,
  cleared_at TIMESTAMP,
  
  CONSTRAINT valid_severity CHECK (severity IN ('CRITICAL', 'MAJOR', 'MINOR', 'WARNING')),
  CONSTRAINT valid_alarm_status CHECK (status IN ('ACTIVE', 'ACKNOWLEDGED', 'CLEARED'))
);
```

## Comparison with Competitors

### Cumulocity IoT
✅ **We Match**: State-based alarm lifecycle (ACTIVE → ACKNOWLEDGED → CLEARED)
✅ **We Match**: Severity levels (CRITICAL, MAJOR, MINOR, WARNING)
✅ **We Match**: Alarm types and context
✅ **We Match**: User acknowledgment tracking

### ThingsBoard
✅ **We Match**: Rule engine with conditions
✅ **We Match**: Alarm lifecycle management
✅ **We Match**: Flexible alarm context (JSONB)
➕ **We Exceed**: Simpler unified architecture (no separate rule chains)

### AWS IoT Core
✅ **We Match**: SQL-like rule evaluation (via JSONB conditions)
✅ **We Match**: Multiple conditions with AND/OR logic
➕ **We Exceed**: Full alarm lifecycle management (AWS only has rules)

### Azure IoT Central
✅ **We Match**: Simple threshold-based rules
➕ **We Exceed**: Complex multi-condition rules
➕ **We Exceed**: Enterprise-grade state management

## Migration Path

### Before (3 Systems)
1. `alert_rules` - Simple device rules
2. `composite_alert_rules` - Complex cross-device rules
3. `alert_events` - Alarm instances (inconsistent naming)

### After (Unified)
1. **`alert_rules`** - Handles BOTH simple AND complex rules
   - `rule_type = 'SIMPLE'` for single conditions
   - `rule_type = 'COMPLEX'` for multi-condition with AND/OR
   
2. **`alarms`** - Unified alarm instances
   - Proper semantic naming
   - Full Cumulocity-style lifecycle
   - Supports alarms from any rule type

## Best Practices

1. **Rule Creation**:
   - Simple rules for single metrics
   - Complex rules for multi-condition scenarios
   - Fleet-wide rules for organization-level alerts

2. **Alarm Workflow**:
   - Create: System auto-creates from rules (status = ACTIVE)
   - Acknowledge: Operator marks as investigating (status = ACKNOWLEDGED)
   - Clear: Issue resolved (status = CLEARED)
   - Delete: Only after clearing (cleanup old alarms)

3. **Severity Assignment**:
   - CRITICAL: Production down, immediate escalation
   - MAJOR: Service degraded, urgent fix needed
   - MINOR: Non-critical issue, schedule fix
   - WARNING: Informational, monitor

4. **Context Usage**:
   - Store additional metadata in `context` JSONB field
   - Include acknowledgment/clear comments
   - Add debugging information

## Example Usage

### Create Simple Rule
```python
{
  "rule_type": "SIMPLE",
  "device_id": "device-uuid",
  "severity": "MAJOR",
  "conditions": [
    {
      "field": "temperature",
      "operator": "gt",
      "value": 30
    }
  ],
  "active": true
}
```

### Create Complex Rule
```python
{
  "rule_type": "COMPLEX",
  "device_id": null,  # Fleet-wide
  "severity": "CRITICAL",
  "logic": "AND",
  "conditions": [
    {
      "field": "temperature",
      "operator": "gt",
      "value": 40
    },
    {
      "field": "humidity",
      "operator": "gt",
      "value": 80
    }
  ],
  "active": true
}
```

### Acknowledge Alarm
```python
POST /alarms/abc-123/acknowledge
{
  "comment": "Team investigating temperature spike"
}
```

### Clear Alarm
```python
POST /alarms/abc-123/clear
{
  "comment": "HVAC system repaired, temperature stable"
}
```

## Summary

This unified architecture provides:
- ✅ Enterprise-grade alarm lifecycle (Cumulocity pattern)
- ✅ Flexible rule definitions (simple + complex)
- ✅ Proper separation of concerns (rules vs instances)
- ✅ Full audit trail (acknowledgment, clearing)
- ✅ Scalable for fleet management
- ✅ Industry best practices compliance
