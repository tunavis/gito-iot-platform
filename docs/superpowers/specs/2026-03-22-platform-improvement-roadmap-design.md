# Gito IoT Platform — Strategic Improvement Roadmap

**Date:** 2026-03-22
**Status:** Approved
**Approach:** Dual-Track — Stabilise + Differentiate (Approach C)

---

## Context & Positioning

Gito is a multi-tenant SaaS IoT monitoring platform targeting the South African market. The competitive advantage is twofold:

1. **ZAR pricing** — significantly cheaper than international competitors (Cumulocity, AWS IoT)
2. **Dual-persona platform** — serves both technical users (custom device types, telemetry schemas, flexible alert rules) and non-technical users (industry templates that work out of the box)

### Target Verticals (Launch)
- **Water & Utilities** — tank levels, flow meters, pump monitoring (municipalities, agriculture)
- **Solar & Energy** — inverter monitoring, battery storage, load shedding context (residential, commercial)
- **Agriculture** — soil moisture, weather stations, irrigation control (commercial farms)

### Business Model
- SaaS-first (multi-tier tenancy: management → client → sub_client)
- Self-hosted as future premium enterprise offering

---

## Current State Assessment

### Strengths
- TimescaleDB with continuous aggregates (hourly + daily)
- KeyDB Streams for MQTT ingestion with crash recovery
- RLS-based multi-tenancy with tenant hierarchy
- 13 widget types in dashboard builder
- OTA firmware campaign system with protocol dispatch
- Audit logging for compliance

### Critical Issues Found
| Priority | Issue | Impact |
|----------|-------|--------|
| Critical | Auth dependency (`get_current_tenant`) copy-pasted across 16 routers | Security/maintenance risk |
| Critical | No React Error Boundaries — widget crash kills entire dashboard | UX — white screen of death |
| Critical | `session.commit()` without `await` in async background tasks | Data integrity |
| High | Dashboard widgets poll every 30s instead of using WebSocket | UX — stale data |
| High | No API rate limiting on REST endpoints | DoS exposure |
| High | No token refresh/revocation mechanism | Security |
| High | Health check always returns 200 without checking dependencies | False operational confidence |
| High | Notification cleanup and retry are no-ops | DB bloat over time |
| Medium | No test coverage (3 test files for 26 routers) | Reliability |
| Medium | Accessibility (a11y) nearly absent | Compliance/UX |
| Medium | console.log in production widget code | Information leakage |
| Medium | LoRaWAN protocol integration is stubbed | Feature gap |

### Competitive Gaps vs ThingsBoard / Cumulocity
- No digital twin / last-known-value cache
- No public/embeddable dashboards
- No scheduled reports or data export
- No anomaly detection
- No 2FA or SSO
- No guided onboarding
- No cross-tenant operations dashboard
- No mobile push notifications

---

## Phase 1: Critical Fixes + Water Vertical

### 1.1 Auth Dependency Consolidation

**Problem:** `get_current_tenant` is duplicated across 16 router files. Any auth logic change (token revocation, rate limiting, audit logging) requires 16 edits.

**Solution:** Create `app/dependencies/auth.py` with a single shared dependency:
```python
# app/dependencies/auth.py
async def get_verified_tenant(tenant_id: UUID, authorization: str = Header(...)) -> TenantContext:
    # Single source of truth for auth validation
    # Token decode, tenant_id match, user extraction
    ...
```

All routers import from this one module.

### 1.2 React Error Boundaries

**Problem:** Any widget rendering error (bad data, unexpected null) crashes the entire dashboard page.

**Solution:** Wrap each widget in `DashboardGrid` with an `ErrorBoundary` component:
- Catches render errors per-widget
- Shows fallback UI: "Widget failed to load — click to retry"
- Logs error details for debugging
- Other widgets continue working normally

### 1.3 WebSocket on Dashboard Widgets

**Problem:** All dashboard widgets use `setInterval(fetchData, 30000)` — 30-second stale data. The WebSocket infrastructure exists but is only used on the device detail page.

**Solution:**
- Add tenant-level WebSocket channel: `ws/tenants/{tenant_id}/telemetry`
- Server-side: subscribe to `telemetry:{tenant_id}:*` Redis pub/sub pattern, forward all device data on one connection
- Client-side: `useDashboardWebSocket` hook subscribes once, distributes updates to widgets by device_id
- Widgets receive real-time pushes — no polling
- Fallback: if WebSocket disconnects, revert to 30s polling gracefully

### 1.4 API Rate Limiting

**Problem:** No rate limiting on REST API. Login endpoint has no brute-force protection.

**Solution:** Add `slowapi` middleware:
- `/auth/login`: 5 requests/minute per IP
- General API endpoints: 60 requests/minute per IP
- Configurable per-tenant overrides for higher tiers

**Proxy-aware configuration:** The platform runs behind nginx (which runs behind an external SSL-terminating proxy). `slowapi` must be configured to read client IP from `X-Forwarded-For` header, not `request.client.host` (which would be the nginx container IP). Use the existing `TRUST_PROXY=true` config from `config.py` to gate this behaviour.

### 1.5 Health Check Upgrade

**Problem:** `/api/health` always returns `{"status": "ok"}` regardless of actual system state.

**Solution:** Probe all dependencies:
```json
{
  "status": "healthy|degraded|unhealthy",
  "checks": {
    "database": {"status": "ok", "latency_ms": 12},
    "keydb": {"status": "ok", "latency_ms": 3},
    "mqtt": {"status": "ok", "latency_ms": 8}
  }
}
```
Return HTTP 200 for healthy, 503 for unhealthy. Docker health checks and CI can rely on this.

### 1.6 Digital Twin (Last-Known-Value Cache)

**Problem:** Every widget queries TimescaleDB for "latest value" — slow under load, unnecessary DB pressure.

**Solution:**
- On every telemetry ingest, update KeyDB hash: `device:{device_id}:latest` → `{metric_key: value, metric_key: value, ...}`
- Include `last_updated` timestamp
- Dashboard widgets read from cache for current values
- TimescaleDB only queried for historical charts/aggregates
- Instant dashboard loads regardless of telemetry volume

### 1.7 Water Monitoring Template

**Target users:** Municipalities, farms, water utilities

**Device types included:**
- Water level sensor (ultrasonic) — metrics: `level_percent`, `level_cm`, `volume_liters`
- Flow meter — metrics: `flow_rate_m3h`, `total_flow_m3`
- Pressure sensor — metrics: `pressure_kpa`
- Water quality sensor (optional) — metrics: `ph`, `turbidity_ntu`

**Dashboard layout (auto-created on template apply):**
| Row | Widgets |
|-----|---------|
| 1 | KPI: Tank Level (%) | KPI: Daily Consumption (m³) | KPI: Flow Rate (m³/hr) | KPI: Pressure (kPa) |
| 2 | Chart: Tank level over time (area, 24h) | Chart: Flow rate inlet vs outlet (line, 24h) |
| 3 | Gauge: Tank level (0-100%) | Status Matrix: Pump/valve states |
| 4 | Alarm Summary: Active water system alarms |

**Pre-configured alert rules:**
| Condition | Severity | Message |
|-----------|----------|---------|
| Tank level < 20% | Warning | "Tank level low" |
| Tank level < 10% | Critical | "Tank level critical" |
| Outlet flow > inlet flow by 15% for 30min | Critical | "Possible leak detected" |
| Pressure drop > 30% in 5min | Critical | "Possible pipe burst" |
| No data received for 15min | Warning | "Sensor offline" |

---

## Phase 2: Solar + Agriculture Templates, Public Dashboards, Onboarding

### 2.1 Solar Energy Template

**Target users:** Homeowners, commercial buildings, solar installers

**Device types included:**
- Solar inverter — metrics: `generation_kw`, `daily_yield_kwh`, `grid_feed_in_kw`
- Battery storage — metrics: `soc_percent`, `charge_rate_kw`, `discharge_rate_kw`
- Energy meter — metrics: `consumption_kw`, `grid_import_kw`

**Dashboard layout:**
| Row | Widgets |
|-----|---------|
| 1 | KPI: Generation (kW) | KPI: Daily Yield (kWh) | KPI: Battery SOC (%) | KPI: Today's Savings (ZAR) |
| 2 | Chart: Generation vs Consumption (area, 24h overlap) | Chart: Battery SOC over time (line, 24h) |
| 3 | Gauge: Self-sufficiency ratio (%) | Pie: Energy source breakdown (solar/battery/grid) |
| 4 | Stat Group: Monthly totals — generation, consumption, export, savings (ZAR) |

**ZAR savings calculator:**
- Template includes electricity tariff config field (R/kWh — default Eskom rate)
- KPI widget calculates: `savings = solar_generation_kwh * tariff_rate`
- Monthly stat shows cumulative savings
- Configurable per municipal tariff

**Pre-configured alert rules:**
| Condition | Severity | Message |
|-----------|----------|---------|
| Inverter output = 0 during 08:00-16:00 | Critical | "Inverter fault — no generation during daylight" |
| Battery SOC < 15% | Warning | "Battery critically low" |
| Generation dropped > 50% vs same time yesterday | Warning | "Panel performance degradation" |
| Grid import during peak solar hours (10:00-14:00) | Info | "System not covering load from solar" |

### 2.2 Agriculture Template

**Target users:** Commercial farmers, agricultural consultants

**Device types included:**
- Soil moisture sensor — metrics: `moisture_percent`, `soil_temp_c` (per zone)
- Weather station — metrics: `temperature_c`, `humidity_percent`, `rainfall_mm`, `wind_speed_kmh`
- Irrigation controller — metrics: `valve_status`, `flow_rate_lph`
- Leaf wetness sensor (optional) — metrics: `wetness_percent`

**Dashboard layout:**
| Row | Widgets |
|-----|---------|
| 1 | KPI: Avg Soil Moisture (%) | KPI: Today's Rainfall (mm) | KPI: Temperature (°C) | KPI: Irrigation Status |
| 2 | Heatmap: Soil moisture by zone over time | Chart: Weather overlay (temp + humidity + rainfall) |
| 3 | Map: Farm zones with moisture colour coding | Status Matrix: Irrigation valve states |
| 4 | Chart: Water usage per zone (flow data) |

**Pre-configured alert rules:**
| Condition | Severity | Message |
|-----------|----------|---------|
| Soil moisture < 30% | Warning | "Zone needs irrigation" |
| Soil moisture < 15% | Critical | "Crop stress risk — irrigate immediately" |
| Rainfall > 50mm in 24h | Warning | "Flood risk — pause irrigation" |
| Irrigation running AND rainfall > 5mm/hr | Warning | "Wasting water — rainfall detected during irrigation" |
| Temperature < 2°C | Critical | "Frost warning" |

### 2.3 Public/Shareable Dashboards

**Feature:** Generate a read-only URL to share any dashboard without requiring login.

**Data model:**
```sql
ALTER TABLE dashboards ADD COLUMN share_token VARCHAR(64) UNIQUE;
ALTER TABLE dashboards ADD COLUMN share_enabled BOOLEAN DEFAULT false;
ALTER TABLE dashboards ADD COLUMN share_expires_at TIMESTAMPTZ;
ALTER TABLE dashboards ADD COLUMN share_password_hash VARCHAR(255);
```

**API endpoints:**
- `POST /tenants/{id}/dashboards/{id}/share` — generate share token, set expiry
- `DELETE /tenants/{id}/dashboards/{id}/share` — revoke share link
- `GET /public/dashboards/{share_token}` — unauthenticated, returns dashboard + widget data

**Frontend:**
- Public route: `/public/d/{share_token}` — renders dashboard in read-only mode
- No sidebar, no navigation, no edit controls
- Optional password gate if `share_password_hash` is set
- Live data via dedicated public WebSocket endpoint (see below)
- Branded: "Powered by Gito" footer on free tier

**Public WebSocket endpoint:**
- `ws/public/dashboards/{share_token}/telemetry` — unauthenticated, read-only
- Server validates `share_token` against `dashboards.share_token` (not RLS — direct query scoped to dashboard)
- Server resolves the dashboard's widget bindings → subscribes to relevant `telemetry:{tenant_id}:{device_id}` channels
- Forwards only the metrics bound to that dashboard's widgets (no raw tenant-wide telemetry exposed)
- **Brute-force protection:** rate limit unauthenticated WebSocket connections to 10/minute per IP via `slowapi`; invalid share tokens return 404 with no additional information
- **Token format:** share tokens are 64-character cryptographically random strings (`secrets.token_urlsafe(48)`) — infeasible to enumerate

**Data query path (bypassing RLS):**
- Public dashboard queries use a dedicated service method that queries by `share_token` directly (no `set_tenant_context` call)
- Only returns widget data for the specific dashboard — no access to other tenant resources
- Share token validated on every request (checks `share_enabled=true`, `share_expires_at` not passed)

**Use cases:**
- Water utility shares tank levels with community
- Solar installer shares generation dashboard with homeowner
- Farm manager shares field status with crop consultants

### 2.4 Guided Onboarding Wizard

**Trigger:** First login after registration (user has no dashboards)

**Flow:**
```
Step 1: Welcome
  "What industry are you in?"
  → Water / Solar / Agriculture / Custom

Step 2a (Vertical selected): Device Readiness
  "Do you have devices ready to connect?"
  → Yes: Show protocol selection + connection guide
  → No: "Try with demo data for 7 days"
       Load realistic sample telemetry
       Banner: "Viewing demo data — connect a real device to replace it"

Step 2b (Custom selected): Device Type Builder
  Guided creation of first device type with telemetry schema editor

Step 3: Connect First Device
  → Select protocol: MQTT / HTTP / LoRaWAN
  → Display credentials (device token, MQTT broker URL, topic format)
  → Live "waiting for first data point..." indicator
  → Celebration screen on first successful ingest

Step 4: Dashboard
  → Vertical: Auto-apply industry template
  → Custom: Open blank dashboard builder with tooltip tour
```

**Demo mode data:**
- 7-day realistic telemetry generated per vertical (diurnal patterns, weekday variation, occasional anomalies)
- Demo data uses dedicated demo devices (created with `is_demo=true` flag on the device record, not on telemetry rows)
- Telemetry for demo devices is standard telemetry — no schema changes to the telemetry table
- Demo devices are visually tagged in the UI with a "Demo" badge

**Demo device data model (migration required):**
```sql
ALTER TABLE devices ADD COLUMN is_demo BOOLEAN DEFAULT false;
CREATE INDEX idx_devices_is_demo ON devices (tenant_id) WHERE is_demo = true;
```

**Demo data lifecycle:**
- On template apply with demo mode: create demo device records (`is_demo=true`) + insert 7 days of synthetic telemetry
- Background task checks daily: delete demo devices (cascade deletes their telemetry) older than 7 days
- When user creates their first real device (non-demo): show prompt "You have demo devices — remove them?" with one-click cleanup
- Demo banner on dashboard: "Viewing demo data — connect a real device to get started" (persists while any `is_demo` device exists for this tenant)

### 2.5 ZAR Pricing & Subscription Tiers

**Tier structure:**

| Tier | Price (ZAR) | Devices | Retention | Users | Key Features |
|------|-------------|---------|-----------|-------|-------------|
| Free | R0/mo | 5 | 7 days | 2 | 1 dashboard, basic threshold alerts |
| Starter | R499/mo | 25 | 30 days | 5 | Unlimited dashboards, templates, public sharing |
| Professional | R1,499/mo | 100 | 90 days | 20 | Sub-tenants, scheduled reports, anomaly detection, priority support |
| Enterprise | Custom | Unlimited | 1 year | Unlimited | SSO, SLA, dedicated support, custom integrations |

**Data model:**
```sql
ALTER TABLE tenants ADD COLUMN subscription_tier VARCHAR(20) DEFAULT 'free';
ALTER TABLE tenants ADD COLUMN max_devices INT DEFAULT 5;
ALTER TABLE tenants ADD COLUMN max_users INT DEFAULT 2;
ALTER TABLE tenants ADD COLUMN max_dashboards INT DEFAULT 1;
ALTER TABLE tenants ADD COLUMN retention_days INT DEFAULT 7;
ALTER TABLE tenants ADD COLUMN subscription_features TEXT[] DEFAULT '{basic_alerts}';
ALTER TABLE tenants ADD COLUMN subscription_expires_at TIMESTAMPTZ;
```

Using typed columns instead of JSONB ensures PostgreSQL validates data types at the database level. A Pydantic schema (`SubscriptionLimits`) validates on the API layer as well.

**Expiry behaviour:**
- When `subscription_expires_at` is in the past: tenant enters a 14-day grace period
- During grace period: warning banner on every page, email to tenant admin on day 1, 7, and 13
- After grace period: tenant drops to Free tier limits automatically (no data deletion — just feature/count restrictions)
- Background task checks `subscription_expires_at` daily and applies downgrades

**Enforcement:**
- Device creation: check count against `max_devices` → 403 with upgrade prompt
- User creation: check count against `max_users` → 403 with upgrade prompt
- Dashboard creation: check count against `max_dashboards` → 403 with upgrade prompt
- Feature gates: check `subscription_features` array before allowing template apply, public share, reports, etc.
- Soft limit at 90%: warning banner "You're using 23 of 25 devices"
- Retention enforcement: existing background task already respects tenant retention config

---

## Phase 3: Competitive Moat Features

### 3.1 Anomaly Detection (Statistical)

**Approach:** Z-score deviation using existing TimescaleDB continuous aggregates. No ML pipeline required.

**How it works:**
1. For any metric, calculate rolling mean (μ) and standard deviation (σ) from `telemetry_daily` aggregate over last 7 days
2. On each new reading, compute z-score: `z = (value - μ) / σ`
3. If `|z| > 3`: flag as anomaly

**Cold start handling:**
- **Minimum sample count:** Anomaly detection only activates when `sample_count >= 48` (roughly 2 days of hourly data). Below this threshold, the rule is silently skipped (no false alarms on new devices).
- **σ = 0 (constant values):** When standard deviation is zero (all values identical), skip anomaly evaluation entirely. This is expected for binary metrics (valve open/closed) or devices reporting a fixed value. The baseline record stores `stddev = 0` and the evaluation code checks for this before dividing.

**User-facing:**
- New alert rule type: "Anomaly detection" (alongside threshold and composite)
- Configuration: select device + metric → toggle on → system auto-calculates baseline
- No threshold numbers to set — it learns from the device's own history
- Anomalies appear as highlighted points on chart widgets (orange markers)
- Alarm includes context: "Temperature 47.2°C is 3.8σ above 7-day average of 23.1°C"

**Database:**
```sql
CREATE TABLE anomaly_baselines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  device_id UUID NOT NULL,
  metric_key VARCHAR(100) NOT NULL,
  window_days INT DEFAULT 7,
  mean FLOAT NOT NULL,
  stddev FLOAT NOT NULL,
  sample_count INT NOT NULL,
  calculated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(device_id, metric_key) -- Intentionally single window per metric. window_days is hardcoded at 7; if per-metric windows are needed later, add window_days to the unique constraint.
);
```

**Baseline refresh:** Background task recalculates baselines every 6 hours using `telemetry_daily` aggregate.

### 3.2 Scheduled PDF Reports

**Report types:**
- **Daily summary** — Yesterday's KPIs, alarms triggered, device uptime %
- **Weekly digest** — Week's trends, top 5 alarms, consumption/generation totals
- **Monthly report** — Full month statistics with charts, month-over-month comparison, cost calculations (ZAR)

**Data model:**
```sql
CREATE TABLE scheduled_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  dashboard_id UUID NOT NULL,
  frequency VARCHAR(20) NOT NULL, -- 'daily', 'weekly', 'monthly'
  recipients TEXT[] NOT NULL, -- email addresses
  next_run_at TIMESTAMPTZ NOT NULL,
  last_run_at TIMESTAMPTZ,
  enabled BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE report_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id UUID REFERENCES scheduled_reports(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL,
  generated_at TIMESTAMPTZ DEFAULT NOW(),
  file_path VARCHAR(500), -- stored PDF path on mounted volume
  status VARCHAR(20) DEFAULT 'generated', -- 'generated', 'sent', 'failed'
  expires_at TIMESTAMPTZ -- auto-delete after 90 days
);
```

**PDF storage:**
- PDFs stored on a Docker-mounted volume (`/data/reports/`) — persists across container restarts and redeploys
- Path format: `/data/reports/{tenant_id}/{report_id}/{date}.pdf`
- Background task cleans up expired PDFs (deletes file + `report_history` row) daily
- Docker volume defined in `docker-compose.yml` and `docker-compose.staging.yml`

**Dependencies (add to `pyproject.toml`):**
- `fpdf2` (~1MB) — lightweight PDF generation, pure Python, no system dependencies
- `matplotlib` is NOT used — instead, generate simple data tables and sparkline-style charts via `fpdf2`'s drawing primitives
- For chart images: use the existing Recharts components rendered server-side via a lightweight API endpoint that returns chart PNG (Next.js API route using `@vercel/og`-style rendering), fetched by the report generator
- Alternative (simpler MVP): text-only reports with tabular data, no chart images — add charts in a later iteration

**Generation pipeline:**
1. APScheduler checks `scheduled_reports` every hour for due reports
2. Query telemetry aggregates for the report period
3. Generate PDF with `fpdf2` (tables, KPI summaries, optional chart images)
4. Apply tenant branding (logo from tenant metadata)
5. Send via SMTP
6. Store PDF on mounted volume, record in `report_history` for download from UI

**Branding:** Free tier includes "Generated by Gito" footer. Starter+ allows custom logo.

### 3.3 Mobile Push Notifications

**Integration:** Firebase Cloud Messaging (FCM) for both Android and iOS via Flutter app.

**Flutter app work required (not currently implemented):**
- Add `firebase_messaging` package and FCM initialization
- Implement FCM token registration on login (call `POST /api/v1/users/me/push-tokens`)
- Implement deep linking (e.g., `gito://devices/{device_id}`) using `go_router` or `uni_links`
- Add notification action handling: "Acknowledge" button calls alarm acknowledge API
- Handle token refresh (FCM tokens rotate periodically)

**Data model:**
```sql
CREATE TABLE push_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  tenant_id UUID NOT NULL,
  fcm_token VARCHAR(500) NOT NULL,
  device_info JSONB, -- { "platform": "android", "app_version": "1.2.0" }
  created_at TIMESTAMPTZ DEFAULT NOW(),
  last_used_at TIMESTAMPTZ
);
```

**Flow:**
1. Flutter app registers FCM token on login → `POST /api/v1/users/me/push-tokens`
2. When alarm triggers, notification service checks user preferences
3. If push enabled for that severity: send via FCM
4. Rich notification: device name, metric value, alarm message
5. Deep link: tap notification → opens device detail in Flutter app
6. Action button: "Acknowledge" → calls alarm acknowledge API directly

**User preferences:**
- Per-user notification settings: push on/off per severity (critical, warning, info)
- Quiet hours: no push between configurable times (e.g., 22:00-06:00)

### 3.4 Data Export & BI Integration

**CSV Export (UI):**
- Any chart widget → kebab menu → "Export CSV"
- Downloads the currently displayed time range and metrics
- Telemetry page → "Export" → select devices, metrics, time range → download

**REST API for BI tools:**
```
GET /api/v1/tenants/{id}/telemetry/export
  ?device_ids=uuid1,uuid2
  &metrics=temperature,humidity
  &from=2026-03-01T00:00:00Z
  &to=2026-03-22T00:00:00Z
  &format=csv|json
  &resolution=raw|hourly|daily
```

**API Key authentication:**
- Separate from JWT — long-lived keys for BI integrations
- `POST /api/v1/tenants/{id}/api-keys` → returns key (shown once)
- Key stored hashed in database
- Rate limited: 100 requests/hour per key

**Scheduled export (Professional tier+):**
- Auto-export daily telemetry to email as CSV attachment
- Future: webhook delivery, S3 pre-signed URL upload

### 3.5 Two-Factor Authentication (TOTP)

**Implementation:** `pyotp` library for TOTP generation/verification.

**Setup flow:**
1. User navigates to Settings → Security → "Enable 2FA"
2. Backend generates TOTP secret → returns QR code URI
3. User scans with Google Authenticator / Authy
4. User enters 6-digit code to verify → backend confirms → 2FA enabled
5. Backend generates 10 recovery codes (shown once, stored hashed)

**Login flow with 2FA:**
1. User submits email + password → backend returns `{ "requires_2fa": true, "temp_token": "..." }`
2. User enters 6-digit TOTP code → backend verifies against secret → returns full JWT
3. Recovery code accepted as alternative to TOTP

**Enforcement:**
- Tenant admin can require 2FA for all users in tenant settings
- TENANT_ADMIN and SUPER_ADMIN roles require 2FA by default on Professional+ tiers
- Grace period: 7 days after enforcement before lockout

### 3.6 Tenant Operations Dashboard

**Target:** Management tenants who oversee multiple client tenants.

**New page:** `/dashboard/operations` (visible only to management tenant users)

**Widgets/views:**
- **Tenant table** — All client tenants: name, device count, active alarms, messages/day, last activity, subscription tier
- **Health heatmap** — Grid of tenants colour-coded by health: green (all good), yellow (warnings), red (critical alarms or offline devices)
- **Usage chart** — Telemetry messages/day per tenant over time (stacked area)
- **Storage breakdown** — Disk usage per tenant (telemetry row counts × estimated size)
- **Alert feed** — Cross-tenant critical alarm stream (latest 50)

**API:**
```
GET /api/v1/admin/tenants/operations
  → { tenants: [{ id, name, device_count, alarm_count, messages_today, last_activity, health_status }] }
GET /api/v1/admin/tenants/operations/usage
  → { usage: [{ tenant_id, date, message_count }] }
```

**Drill-down:** Click any tenant → tenant switcher activates → user sees that tenant's dashboard (existing functionality).

---

## Non-Functional Requirements

### Performance Targets
- Dashboard initial load: < 2 seconds (digital twin cache enables this)
- WebSocket latency (ingest to widget): < 500ms
- Template apply: < 3 seconds
- PDF report generation: < 30 seconds for daily, < 2 minutes for monthly

### Security
- All existing RLS policies maintained
- Public dashboards bypass RLS via dedicated query path (no tenant context, dashboard-scoped only)
- API keys stored with bcrypt hash, never logged
- 2FA secrets encrypted at rest
- Rate limiting on all auth endpoints

### Scalability Considerations
- WebSocket: tenant-level channel multiplexes all devices (1 connection per dashboard, not per device)
- Digital twin cache: KeyDB hash per device — O(1) reads
- Anomaly baselines: pre-computed, not calculated on read
- Report generation: queued via background tasks, not blocking API

---

## Implementation Order

| Order | Item (matches spec section) | Dependencies |
|-------|------|-------------|
| 1.1 | Auth dependency consolidation | None |
| 1.2 | Error boundaries | None |
| 1.3 | WebSocket on dashboard widgets | Digital twin cache (1.6) |
| 1.4 | API rate limiting | None |
| 1.5 | Health check upgrade | None |
| 1.6 | Digital twin cache | None |
| 1.7 | Water template | None (can parallel with 1.1-1.6) |
| 2.1 | Solar template | Template system from 1.7 |
| 2.2 | Agriculture template | Template system from 1.7 |
| 2.3 | Public dashboards | Dashboard WebSocket (1.3) |
| 2.4 | Onboarding wizard | Templates (1.7, 2.1, 2.2) |
| 2.5 | Subscription tiers | None |
| 3.1 | Anomaly detection | Digital twin (1.6), continuous aggregates |
| 3.2 | Scheduled reports | None |
| 3.3 | Mobile push notifications | Flutter app + FCM setup (see 3.3 Flutter work) |
| 3.4 | Data export | None |
| 3.5 | Two-factor auth | None |
| 3.6 | Operations dashboard (extends `admin_tenants.py` router) | Subscription tiers (2.5) |
