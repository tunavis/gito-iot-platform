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

## 🔄 Future Widgets (Will Need Real Data Integration)

### 3. Gauge Widget (Not Yet Implemented)
**Status:** 🔮 FUTURE
**Will Need:**
- Latest value from device
- Min/max range from device type or configuration

### 4. Map Widget (Not Yet Implemented)
**Status:** 🔮 FUTURE
**Will Need:**
- Device location (lat/lng from device.attributes)
- Real-time status updates

### 5. Table Widget (Not Yet Implemented)
**Status:** 🔮 FUTURE
**Will Need:**
- Paginated telemetry data
- Filtering and sorting

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

## 📝 Tracking Status

| Component | Mock Data? | Real API Ready? | Status | Completion Date |
|-----------|------------|-----------------|--------|-----------------|
| KPICard | ❌ No | ✅ Yes | ✅ **PRODUCTION** | 2026-01-31 |
| ChartWidget | ❌ No | ✅ Yes | ✅ **PRODUCTION** | 2026-01-31 |
| Dashboard Builder | ❌ No | ✅ Yes | ✅ **PRODUCTION** | 2026-01-31 |
| Template Gallery | ✅ Yes | ⚠️ Partial | Iteration 2 | In Progress |
| GaugeWidget | N/A | ❌ No | Not built | Iteration 3 |
| MapWidget | N/A | ❌ No | Not built | Iteration 3 |
| TableWidget | N/A | ❌ No | Not built | Iteration 3 |

---

## 🚀 Integration Steps (When Ready)

### Step 1: Backend Prerequisites
- [ ] Telemetry API returns data for specific device + metric
- [ ] Aggregation endpoints for trends (avg over time period)
- [ ] WebSocket support for real-time updates (optional)

### Step 2: Frontend Integration
- [ ] Remove mock data from KPICard.tsx
- [ ] Uncomment real implementation code
- [ ] Add error boundaries for failed API calls
- [ ] Add retry logic for network failures

### Step 3: Testing
- [ ] Test with real devices
- [ ] Test with missing data (no telemetry)
- [ ] Test with offline devices
- [ ] Test with multiple tenants
- [ ] Performance test with many widgets

### Step 4: Cleanup
- [ ] Delete all mock data code
- [ ] Remove TODO comments
- [ ] Update this document to mark complete
- [ ] Update user documentation

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

This document can be archived when:
1. All widgets fetch real data from API
2. No `Math.random()` in widget components
3. All TODO comments removed
4. All tests pass with real data
5. Performance benchmarks met

---

**Last Updated:** 2026-01-31
**Iteration:** 2 - Charts & Templates
**Next Review:** After Iteration 3 (Advanced Widgets)
