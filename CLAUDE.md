# Gito IoT Platform - Claude Project Context

**Platform**: Multi-tenant SaaS IoT Monitoring Platform
**Competition**: Cumulocity IoT, ThingsBoard
**Tech Stack**: FastAPI (Python) + Next.js 14 (TypeScript) + PostgreSQL

---

## 🎯 Core Principles

### 1. **Production-Ready Code ONLY**
- ❌ NO mock data (no `Math.random()`, no hardcoded test data)
- ❌ NO localStorage shortcuts for persistence
- ❌ NO TODO placeholders - implement fully or don't implement
- ✅ Use real PostgreSQL database
- ✅ Use real API endpoints
- ✅ Proper error handling
- ✅ Industry-standard patterns

### 2. **API Response Format**
**Backend returns data directly, NOT wrapped in `{data: ...}`**

```typescript
// ✅ CORRECT
const result = await response.json();
setDashboard(result); // result IS the dashboard object

// ❌ WRONG
const result = await response.json();
setDashboard(result.data); // result.data is undefined!
```

**Exception**: List endpoints with pagination may use `{data: [...], meta: {}}`

### 3. **Multi-Tenant Architecture**
Every protected endpoint MUST:
1. Extract `tenant_id` from JWT token
2. Validate path `tenant_id` matches token `tenant_id`
3. Call `await session.set_tenant_context(tenant_id, user_id)` before queries
4. Use PostgreSQL RLS for data isolation

```python
# Required pattern for all routers
if str(tenant_id) != str(current_tenant_id):
    raise HTTPException(status_code=403, detail="Tenant mismatch")
await session.set_tenant_context(tenant_id, current_user_id)
```

---

## 📁 Project Structure

```
/
├── api/                    # FastAPI backend
│   ├── app/
│   │   ├── routers/       # API endpoints (19 routers)
│   │   ├── models/        # SQLAlchemy models
│   │   ├── schemas/       # Pydantic request/response schemas
│   │   ├── services/      # Business logic
│   │   └── database.py    # DB connection + RLS session
│   └── tests/
├── web/                    # Next.js frontend
│   └── src/
│       ├── app/           # Next.js 14 app router
│       ├── components/    # React components
│       └── lib/           # Utilities
├── db/
│   └── migrations/        # SQL migration files (11 total)
├── docs/                  # Documentation
│   ├── setup/            # CI/CD, deployment guides
│   ├── implementation/   # Technical specs
│   ├── adr/              # Architecture Decision Records
│   └── archive/          # Old session summaries
└── scripts/              # Helper scripts
```

---

## 🔑 Key Patterns

### Device Type Schema Pattern

**Devices have types with telemetry schemas:**
```json
{
  "telemetry_schema": {
    "temperature": {
      "type": "number",
      "unit": "°C",
      "min": -40,
      "max": 85
    },
    "flow_rate": {
      "type": "number",
      "unit": "m³/hr"
    }
  }
}
```

**When configuring widgets:**
1. User selects device → Load device type
2. Show metric dropdown → From telemetry schema
3. Auto-fill unit → From schema
4. Pre-populate thresholds → From min/max in schema

### Authentication Pattern

```typescript
// Frontend - Get token and tenant
const token = localStorage.getItem("auth_token");
const payload = JSON.parse(atob(token.split(".")[1]));
const tenantId = payload.tenant_id;
const userId = payload.user_id;

// Include in API calls
headers: {
  Authorization: `Bearer ${token}`
}
```

### Widget Configuration Flow

1. User opens widget settings
2. **WidgetConfigModal** shows:
   - Widget title (editable)
   - Data sources (devices bound to widget)
   - Configuration options (color, unit, thresholds, etc.)
3. User clicks "Bind Device" → **DeviceBindingModal** opens:
   - Device dropdown (all tenant devices)
   - Metric dropdown (from device type schema)
   - Auto-fills unit, min/max from schema
4. User saves → Updates widget via API: `PUT /tenants/{id}/dashboards/{id}/widgets/{id}`

---

## 🗄️ Database Schema

### Core Tables
- `tenants` - Multi-tenant root (no RLS)
- `users` - User accounts (RLS: tenant-scoped)
- `devices` - IoT devices (RLS: tenant-scoped)
- `device_types` - Device templates with telemetry schemas (RLS: tenant-scoped)
- `alarms` - Enterprise alarm lifecycle (RLS: tenant-scoped)
- `alert_rules` - Threshold + Composite rules (RLS: tenant-scoped)
- `dashboards` - User dashboards (RLS: user-scoped)
- `dashboard_widgets` - Widget configurations (RLS: user-scoped)
- `solution_templates` - Industry templates (no RLS - global)

### RLS Policies
**All tenant-scoped tables MUST have:**
```sql
CREATE POLICY tenant_isolation ON table_name
  USING (tenant_id = current_setting('app.current_tenant_id')::UUID);
```

**User-scoped tables (dashboards) MUST have:**
```sql
CREATE POLICY user_isolation ON dashboards
  USING (
    tenant_id = current_setting('app.current_tenant_id')::UUID AND
    user_id = current_setting('app.current_user_id')::UUID
  );
```

---

## 🚀 API Endpoints

### Dashboard Builder
- `GET /tenants/{id}/dashboards` - List user dashboards
- `POST /tenants/{id}/dashboards` - Create dashboard
- `GET /tenants/{id}/dashboards/{id}` - Get dashboard with widgets
- `PUT /tenants/{id}/dashboards/{id}` - Update dashboard
- `DELETE /tenants/{id}/dashboards/{id}` - Delete dashboard
- `POST /tenants/{id}/dashboards/{id}/widgets` - Add widget
- `PUT /tenants/{id}/dashboards/{id}/widgets/{id}` - Update widget
- `DELETE /tenants/{id}/dashboards/{id}/widgets/{id}` - Remove widget
- `PUT /tenants/{id}/dashboards/{id}/layout` - Batch update positions

### Solution Templates
- `GET /tenants/{id}/solution-templates` - List templates
- `GET /tenants/{id}/solution-templates/{id}` - Get template details
- `POST /tenants/{id}/solution-templates/{id}/apply` - Create dashboard from template

### Devices
- `GET /tenants/{id}/devices` - List devices (with pagination)
- `POST /tenants/{id}/devices` - Create device
- `GET /tenants/{id}/devices/{id}` - Get device details
- `GET /tenants/{id}/devices/{id}/telemetry` - Get telemetry data

### Device Types
- `GET /tenants/{id}/device-types` - List device types
- `GET /tenants/{id}/device-types/{id}` - Get device type with telemetry schema

---

## 🎨 Widget Types

### Implemented (12 types, `DashboardGrid.tsx`)
`kpi_card`, `chart` (line/area/bar), `gauge`, `stat_group`, `pie_chart`,
`scatter_plot`, `heatmap`, `alarm_summary`, `table`, `status_matrix`, `map`
(Leaflet), `device_info`.

**Config forms exist for only 8** of these in `WidgetConfigModal.tsx`
(`kpi_card`, `chart`, `gauge`, `pie_chart`, `stat_group`, `alarm_summary`,
`scatter_plot`, `heatmap`) — `table`, `map`, `status_matrix`, and `device_info`
fall through to a generic "No configuration available for this widget type"
message. `device_info` also has no entry in `WidgetLibrary.tsx`'s "add widget"
picker, so it's renderable but not currently addable through the UI.

---

## ⚙️ Configuration Files

### CLEANUP_TODO.md
Tracks temporary code and technical debt. Update when:
- Removing mock data
- Upgrading dependencies
- Completing planned features

### Package Versions
```json
{
  "react-grid-layout": "1.4.4"  // Intentionally old - upgrade in Iteration 3
}
```

**Why 1.4.4?** v2.x has breaking changes. Documented in `CLEANUP_TODO.md` for future upgrade.

---

## 🐛 Common Mistakes to Avoid

### 1. API Response Handling
```typescript
// ❌ WRONG - Backend doesn't wrap in {data: ...}
const result = await response.json();
const dashboard = result.data.id; // undefined!

// ✅ CORRECT
const result = await response.json();
const dashboard = result.id; // Works!
```

### 2. Mock Data
```typescript
// ❌ NEVER DO THIS
const mockValue = Math.random() * 100;
setValue(mockValue);

// ✅ ALWAYS USE REAL API
const response = await fetch(`/api/v1/tenants/${tenantId}/devices/${deviceId}/telemetry`);
const data = await response.json();
setValue(data[0].temperature);
```

### 3. localStorage for Persistence
```typescript
// ❌ NEVER DO THIS
localStorage.setItem('dashboard', JSON.stringify(dashboard));

// ✅ ALWAYS USE DATABASE
await fetch(`/api/v1/tenants/${tenantId}/dashboards`, {
  method: 'POST',
  body: JSON.stringify(dashboard)
});
```

### 4. Missing Destructuring
```typescript
// ❌ ERROR - trend_period not destructured
const { metric, unit, color } = configuration;
// ... later using trend_period in dependency array → undefined!

// ✅ CORRECT
const { metric, unit, color, trend_period = "24h" } = configuration;
```

---

## 📋 Development Workflow

### Before Making Changes
1. Read existing code patterns
2. Check CLEANUP_TODO.md for known issues
3. Verify API endpoints exist in backend
4. Check database schema in migrations

### When Adding Features
1. ✅ Implement backend API first
2. ✅ Create database migration if needed
3. ✅ Add Pydantic schemas
4. ✅ Implement frontend with real API calls
5. ✅ Update CLEANUP_TODO.md if adding technical debt
6. ❌ Never use mock data or shortcuts

### When Fixing Bugs
1. Identify root cause (API? Database? Frontend?)
2. Fix in production-ready way (no workarounds)
3. Test end-to-end
4. Update documentation if pattern changes

---

## 🔒 Security Requirements

### Authentication
- JWT tokens required on all protected endpoints
- Token validation via `Depends(get_current_user)`
- Password hashing with bcrypt

### Authorization
- RBAC roles: SUPER_ADMIN, TENANT_ADMIN, SITE_ADMIN, CLIENT, VIEWER
- RLS policies on all tenant-scoped tables
- Cross-tenant access blocked at DB level

### Input Validation
- All inputs validated via Pydantic schemas
- No f-string SQL (use parameterized queries)
- XSS protection (React auto-escapes)

---

## 📊 Production Status

**Current State: 93% Production-Ready**

✅ Working:
- Authentication & Authorization (100%)
- Device Management (100%)
- Alert Rules & Alarms (100%)
- Notifications (100%)
- Dashboard Builder (95%)
- Multi-tenancy (100%)

⚠️ Minor Issues:
- Alert preview returns empty (backend TODO)
- User invitation email not sent (backend TODO)
- 11 duplicate database indexes (optimization opportunity)

❌ Missing (Planned):
- Grafana integration (Future) — provisioning config exists, no service deployed
- Config forms for `table`/`map`/`status_matrix`/`device_info` widgets (see Widget Types above)

Note: Gauge/Map/Table widgets and OTA firmware updates are implemented, not
planned — this section previously listed them as future work after they'd
already shipped.

---

## 🎯 Current Iteration

12 widget types and OTA firmware campaigns are implemented (see Widget Types
above and `openspec/specs/firmware-ota/spec.md`). No active iteration is
tracked here currently — check `openspec/changes/` for in-flight work.

---

**Last Updated**: 2026-07-11
**Maintained By**: Claude (AI Assistant)
**Project Status**: Active Development
