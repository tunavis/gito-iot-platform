# Cleanup TODO - Remove Mock Data & Temporary Code

## ⚠️ CRITICAL: Remove Before Production

This document tracks all mock data and temporary implementations that MUST be removed when real functionality is implemented.

---

## 🔄 Dependencies to Upgrade

### react-grid-layout Version Upgrade
**Current Version:** `1.4.4` (Intentionally using older version)
**Latest Version:** `2.x+` (Major version with breaking changes)
**Status:** 📌 PLANNED FOR LATER

**Why we're on v1.4.4:**
- Stable and tested API
- Working on both local (port 3001) and Docker (port 3000)
- Focused on completing features first

**When to Upgrade:**
- After Iteration 3 is complete
- Before production deployment
- When we have time to test thoroughly

**Upgrade Steps:**
1. Check latest version and changelog
2. Update `web/package.json`: `"react-grid-layout": "^2.x.x"`
3. Run `npm install` locally AND in Docker
4. Update `DashboardGrid.tsx` for new API (if needed)
5. Test drag, drop, resize functionality
6. Update ADR-002 with new version

**Impact:** Should be minimal - mostly import syntax changes

---

## 📊 Mock Data - CLEANED UP ✅

### 1. KPI Card Widget - Real Telemetry Data ✅
**File:** `web/src/components/Widgets/KPICard.tsx`
**Status:** ✅ **PRODUCTION-READY**

**Implemented:**
- Real API integration with `/api/v1/tenants/{id}/devices/{id}/telemetry`
- Trend calculation using historical averages
- Proper error handling and loading states
- Auto-refresh every 30 seconds

---

### 2. Chart Widget - Real Time-Series Data ✅
**File:** `web/src/components/Widgets/ChartWidget.tsx`
**Status:** ✅ **PRODUCTION-READY**

**Implemented:**
- Real API integration with telemetry endpoints
- Multi-device data merging by timestamp
- Support for line, area, and bar charts
- Proper loading and error states
- Auto-refresh every 30 seconds

---

### 3. Template Gallery - Real API Integration ✅
**File:** `web/src/app/dashboard/templates/page.tsx`
**Status:** ✅ **PRODUCTION-READY**

**Implemented:**
- Real API integration with `/api/v1/tenants/{id}/solution-templates`
- Template application creates dashboard via POST endpoint
- Auto-redirects to dashboard builder after application
- Proper authentication and error handling

---

## ✅ All Widgets Now Implemented

All 12 widget types are production-ready with real API integration:
- KPI Card, Gauge, Stat Group
- Time-Series Chart, Pie/Donut Chart, Scatter Plot  
- Activity Heatmap, Alarm Summary
- Data Table, Fleet Status Matrix, Device Map, Device Info

See the tracking table above for details.

---

## 🧪 Development Patterns to Follow

### Before Removing Mock Data - Checklist:
- [ ] Real API endpoint exists and tested
- [ ] Authentication/authorization working
- [ ] Error handling implemented
- [ ] Loading states working
- [ ] Data validation in place
- [ ] Multi-tenancy verified
- [ ] Performance acceptable
- [ ] Update this document

### Code Review Checklist:
```bash
# Search for mock data before production:
grep -r "Math.random()" web/src/components/Widgets/
grep -r "TODO: REMOVE MOCK DATA" web/src/
grep -r "TEMPORARY" web/src/
grep -r "MOCK DATA" web/src/
```

---

## 📊 Widget Status — All Widgets Implemented ✅

| Component | Mock Data? | Real API Ready? | Status | Completion Date |
|-----------|------------|-----------------|--------|-----------------|
| KPICard | ❌ No | ✅ Yes | ✅ **PRODUCTION** | 2026-01-31 |
| ChartWidget | ❌ No | ✅ Yes | ✅ **PRODUCTION** | 2026-01-31 |
| Dashboard Builder | ❌ No | ✅ Yes | ✅ **PRODUCTION** | 2026-01-31 |
| Template Gallery | ❌ No | ✅ Yes | ✅ **PRODUCTION** | 2026-02-01 |
| GaugeWidget | ❌ No | ✅ Yes | ✅ **PRODUCTION** | 2026-02-15 |
| MapWidget | ❌ No | ✅ Yes | ✅ **PRODUCTION** | 2026-02-15 |
| TableWidget | ❌ No | ✅ Yes | ✅ **PRODUCTION** | 2026-02-15 |
| PieChartWidget | ❌ No | ✅ Yes | ✅ **PRODUCTION** | 2026-02-15 |
| ScatterPlotWidget | ❌ No | ✅ Yes | ✅ **PRODUCTION** | 2026-02-15 |
| HeatmapWidget | ❌ No | ✅ Yes | ✅ **PRODUCTION** | 2026-02-15 |
| StatGroupWidget | ❌ No | ✅ Yes | ✅ **PRODUCTION** | 2026-02-15 |
| AlarmSummaryWidget | ❌ No | ✅ Yes | ✅ **PRODUCTION** | 2026-02-15 |
| StatusMatrixWidget | ❌ No | ✅ Yes | ✅ **PRODUCTION** | 2026-02-15 |

---

## 🔄 Remaining Work (Non-Widget)

### 1. OTA Firmware Updates
**Status:** 🔄 **IN PROGRESS — Backend ready, UI needed**

**What's done:**
- ✅ Workflow engine (`api/app/workflows/ota_update.py`)
- ✅ Activities (`api/app/activities/ota_activities.py`)
- ✅ OTA service (`api/app/services/ota_workflow.py`, `ota_execution.py`)
- ✅ Firmware models (`api/app/models/firmware.py`)
- ❌ API router for firmware management (not yet added to `api/app/main.py`)
- ❌ Frontend page `/dashboard/ota` (not yet created)

**Next steps:**
1. Create `api/app/routers/firmware.py` with firmware CRUD + OTA trigger endpoints
2. Register router in `api/app/main.py`
3. Create `web/src/app/dashboard/ota/page.tsx` frontend
4. Add "Firmware" entry to sidebar navigation

---

### 2. User Invitation Emails
**Status:** ⚠️ **Partial — User created but email not sent**

**Location:** `api/app/routers/users.py:293`

**What's done:**
- ✅ User created with `status="inactive"` and temporary password
- ✅ API returns `invitation_sent: true` (but no real email)

**Next step:**
- Integrate `api/app/services/email.py` to send actual invitation email with activation link

---

### 3. react-grid-layout Upgrade
**Status:** 📌 **PLANNED — After core features complete**

See `CLEANUP_TODO.md#react-grid-layout-version-upgrade` for full upgrade steps.

---

## ✅ Integration Steps — COMPLETED

All widget integration steps have been completed. Widgets now use real API data.

- ✅ Telemetry API returns data for specific device + metric
- ✅ Aggregation endpoints for trends (avg over time period)
- ✅ All mock data removed from widget components
- ✅ Error boundaries and loading states implemented
- ✅ Multi-tenancy verified
- ✅ WebSocket support available for real-time updates

---

## 🔍 Quick Search Commands

```bash
# Find all mock data:
grep -r "Math.random" web/src/

# Find all TODO markers:
grep -r "TODO: REMOVE MOCK DATA" web/src/

# Find demo/temporary text:
grep -r "Demo data" web/src/
grep -r "TEMPORARY" web/src/
```

---

## 🤖 Automated CI/CD Checks

### Production Protection (BLOCKING) ⛔

**Script:** `scripts/check-mock-data.sh`
**Workflow:** `.github/workflows/production-checks.yml`

**When it runs:**
- Pull Requests to `main`, `master`, `production` branches
- Push to production branches

**What it checks:**
- ❌ `Math.random()` in Widget components → **FAILS BUILD**
- ❌ Hardcoded test credentials → **FAILS BUILD**
- ⚠️  TODO markers → Warning only
- ⚠️  TEMPORARY markers → Warning only

**Result:**
- Build **FAILS** if mock data found
- Code **CANNOT** be deployed to production
- Must fix before merge allowed

### Development Warnings (NON-BLOCKING) ⚠️

**Workflow:** `.github/workflows/dev-checks.yml`

**When it runs:**
- Pull Requests to `dev`, `develop`, `feature/*` branches

**What it does:**
- Warns about mock data but doesn't block
- Posts reminder comment on PR
- Allows merge (for testing)

### Running Checks Locally

```bash
# Run the full production check
bash scripts/check-mock-data.sh

# Check specific patterns
grep -r "Math.random()" web/src/components/Widgets/

# Make script executable (first time only)
chmod +x scripts/check-mock-data.sh
```

### CI/CD Status

| Environment | Mock Data Allowed? | Build Blocks? |
|-------------|-------------------|---------------|
| Feature branches | ✅ Yes (with warning) | No |
| Dev branch | ✅ Yes (with warning) | No |
| Main/Production | ❌ No | **Yes** ⛔ |

See `.github/workflows/README.md` for full CI/CD documentation.

---

## ✅ Completion Criteria

Widget cleanup is complete. Remaining work tracked above.

1. ✅ All widgets fetch real data from API
2. ✅ No `Math.random()` in widget components
3. ⏳ OTA firmware UI (backend done, UI pending)
4. ⏳ User invitation emails (backend done, email integration pending)
5. ⏳ react-grid-layout v2 upgrade (planned after core features)

---

**Last Updated:** 2026-04-09
**Iteration:** 4 - Status & Cleanup
**Next Review:** After OTA firmware UI is complete
