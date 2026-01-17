# Grafana Integration Guide - GITO IoT Platform

## Overview

Grafana is pre-configured for the GITO IoT Platform with auto-provisioned datasources and dashboards. This guide explains how to deploy and use Grafana.

**NOTE:** Grafana deployment is **optional**. The platform runs perfectly without it. Grafana is for visualization and alerting only.

## Architecture

The platform integrates with three datasources:

1. **Prometheus** - Metrics (API latency, error rates, MQTT messages, alerts)
2. **Loki** - Logs (API logs, alert events, device connections)
3. **TimescaleDB** - Time-series telemetry and device data

All three are optional. You can run with just Prometheus, or all three together.

## Quick Start

### Option 1: Enable Grafana in Docker Compose (Recommended)

Uncomment the `grafana` service in `docker-compose.yml`:

```yaml
grafana:
  image: grafana/grafana:latest-alpine
  container_name: gito-grafana
  environment:
    GF_SECURITY_ADMIN_PASSWORD: ${GRAFANA_ADMIN_PASSWORD:-admin}
    GF_SECURITY_ADMIN_USER: admin
    GF_INSTALL_PLUGINS: grafana-piechart-panel
    GF_USERS_ALLOW_SIGN_UP: false
  ports:
    - "3000:3000"
  volumes:
    - ./grafana/provisioning:/etc/grafana/provisioning
    - grafana-storage:/var/lib/grafana
  depends_on:
    - prometheus
    - loki
    - timescaledb
  networks:
    - iot-network
```

Add to `.env`:

```
GRAFANA_ADMIN_PASSWORD=your_secure_password
```

Start Grafana:

```bash
docker-compose up -d grafana
```

Grafana will be available at: http://localhost:3000

### Option 2: Manual Deployment

If running Grafana separately, ensure these environment variables are set:

```bash
export GF_SECURITY_ADMIN_PASSWORD=your_password
export GF_PROVISIONING_PATH=/path/to/grafana/provisioning
```

Mount the `grafana/provisioning` directory to `/etc/grafana/provisioning` in your Grafana container.

## Default Credentials

- **Username:** admin
- **Password:** (Set via `GRAFANA_ADMIN_PASSWORD` env var)
- **URL:** http://localhost:3000

## Auto-Provisioned Datasources

Grafana automatically discovers and configures these datasources on startup:

### 1. Prometheus

- **Name:** Prometheus
- **URL:** http://prometheus:9090
- **Default:** Yes (primary datasource)
- **Purpose:** Metrics and alerting

### 2. Loki

- **Name:** Loki
- **URL:** http://loki:3100
- **Purpose:** Log aggregation and searching
- **Note:** Requires Promtail to be configured to ship logs

### 3. TimescaleDB

- **Name:** TimescaleDB
- **URL:** timescaledb:5432
- **Database:** gito
- **Purpose:** Direct SQL queries on device telemetry and metadata

## Pre-Built Dashboards

Four production-ready dashboards are auto-loaded:

### 1. Platform Overview

Shows:
- Device status (pie chart - online/offline)
- API latency (p95 gauge)
- API request rate (time series)
- API error rate (gauge)
- MQTT messages received (gauge)
- Alert count (last hour)
- Device status from database

**UID:** `platform-overview`
**Refresh:** 30 seconds
**Time Range:** Last 6 hours

### 2. Device Monitoring (Placeholder)

For custom dashboard creation. Template:
- Per-device telemetry graphs
- Battery level trends
- Signal strength over time
- Last seen timestamp

**To create:** 
1. Go to Dashboards → New
2. Add panels with device variables
3. Query TimescaleDB for `telemetry_hot` table filtered by device_id
4. Save as "Device Monitoring"

### 3. Alert Rules (Placeholder)

For monitoring alert rule status:
- Active alert rules by device
- Alert firing history
- Rules by tenant
- Most triggered rules

**To create:**
1. Query TimescaleDB `alert_events` table
2. Group by `alert_rule_id`
3. Show firing frequency and last fired time
4. Add variables for tenant and device filtering

### 4. System Health (Placeholder)

For infrastructure monitoring:
- Database connection pool status
- MQTT broker health
- Prometheus scrape success rate
- API service uptime

## API Endpoints for Dashboard Variables

Grafana dashboards can use these API endpoints for dynamic variable dropdowns:

### List Tenants
```
GET /api/v1/grafana/tenants
```

Response:
```json
{
  "status": "ok",
  "data": [
    {"id": "uuid", "text": "Tenant Name", "value": "uuid"}
  ]
}
```

### List Devices (Filtered by Tenant)
```
GET /api/v1/grafana/devices?tenant_id=<uuid>
```

Response:
```json
{
  "status": "ok",
  "data": [
    {"id": "uuid", "text": "Device Name", "value": "uuid"}
  ]
}
```

### List Alert Rules (Filtered by Tenant)
```
GET /api/v1/grafana/alert-rules?tenant_id=<uuid>
```

Response:
```json
{
  "status": "ok",
  "data": [
    {"id": "uuid", "text": "temperature > 30.0", "value": "uuid"}
  ]
}
```

### Get Device Metrics
```
GET /api/v1/grafana/metrics?device_id=<uuid>
```

Response:
```json
{
  "status": "ok",
  "data": {
    "device_id": "uuid",
    "device_name": "Sensor 1",
    "status": "online",
    "battery_level": 85.5,
    "signal_strength": -75,
    "last_seen": "2026-01-14T13:00:00Z"
  }
}
```

## Multi-Tenant Isolation

All dashboards and queries support multi-tenant filtering via Grafana variables.

To add tenant filtering to a dashboard:

1. Create a variable:
   - Name: `tenant`
   - Type: Query
   - Datasource: Prometheus or API
   - Query: Custom script calling `/api/v1/grafana/tenants`

2. Modify panel queries to include:
   ```
   {tenant_id="$tenant"}
   ```

3. Prometheus queries automatically filter by tenant_id label
4. PostgreSQL queries can use `WHERE tenant_id = '$tenant'`

## Troubleshooting

### Datasources Not Connecting

Check Grafana logs:
```bash
docker logs gito-grafana
```

Common issues:
- Prometheus not running: Start with `docker-compose up prometheus`
- Loki not running: Start with `docker-compose up loki`
- Network issues: Ensure containers are on same network

### Dashboards Not Loading

1. Check provisioning volume is mounted: `docker inspect gito-grafana | grep provisioning`
2. Verify JSON files exist in `grafana/provisioning/dashboards/`
3. Restart Grafana: `docker-compose restart grafana`

### No Data in Panels

1. Verify datasource is working: Grafana → Settings → Data Sources
2. Check time range (top right) - move to "Last hour" if data is recent
3. Verify Prometheus is scraping: http://localhost:9090/targets
4. Check queries in panel: Edit panel → Query tab

## Creating Custom Dashboards

### From Prometheus Metrics

Example: Query API request rate
```promql
rate(api_requests_total[5m])
```

Available metrics:
- `api_request_duration_seconds` (histogram)
- `api_requests_total` (counter)
- `api_errors_total` (counter)
- `mqtt_messages_received_total` (counter)
- `alert_events_total` (counter)
- `devices_online` (gauge)
- `database_connections` (gauge)

### From TimescaleDB

Example: Last 24 hours of temperature readings
```sql
SELECT
  device_id,
  timestamp,
  temperature
FROM telemetry_hot
WHERE device_id = '$device'
  AND timestamp > now() - interval '24 hours'
ORDER BY timestamp DESC
LIMIT 1000
```

### From Loki

Example: API errors in last hour
```
{job="gito-api"} | grep "ERROR"
```

## Alert Rules in Grafana

You can create alerts in Grafana that fire based on Prometheus queries:

1. Edit a panel with Prometheus data
2. Click "Alert" tab
3. Set condition (e.g., "when last value > 100")
4. Set alert name and description
5. Configure notification channel (Email, Slack, etc.)

Example alert: "API Error Rate Too High"
```
Condition: rate(api_errors_total[5m]) > 0.01
For: 5 minutes
```

## Performance Tuning

### Reduce Scrape Interval
Edit `prometheus.yml`:
```yaml
scrape_interval: 15s  # default is 30s
```

### Limit Dashboard Time Range
Longer ranges = slower queries. Use smart defaults:
- System Health: 24 hours
- API Metrics: 6 hours
- Device Telemetry: 7 days

### Archive Old Logs
Configure Loki retention:
```yaml
retention_period: 30d  # Keep 30 days of logs
```

## Production Deployment

When deploying to production:

1. Use strong `GRAFANA_ADMIN_PASSWORD`
2. Enable authentication for all users: `GF_USERS_ALLOW_SIGN_UP=false`
3. Configure OAuth2/LDAP for enterprise auth
4. Mount persistent volume for dashboards: `-v grafana-storage:/var/lib/grafana`
5. Set up backup/restore procedure
6. Configure HTTPS with reverse proxy (nginx)
7. Add Grafana to monitoring (Prometheus scrapes Grafana metrics)

## Additional Resources

- [Grafana Documentation](https://grafana.com/docs/)
- [Prometheus Query Language](https://prometheus.io/docs/prometheus/latest/querying/basics/)
- [Loki Query Syntax](https://grafana.com/docs/loki/latest/logql/)
- [PostgreSQL Plugin for Grafana](https://grafana.com/grafana/plugins/postgres-datasource/)
