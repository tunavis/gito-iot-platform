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

### Node Graphs — `@xyflow/react`

`@xyflow/react` (v12, MIT) is **the repo's one node-graph library**. Any graph,
diagram, or node-editor surface uses it — do not hand-roll SVG for a node graph
and do not add a second graph library.

All of it is wrapped in `web/src/components/flow/`, which is the only place that
imports `@xyflow/react` for chrome or layout:

- `FlowCanvas.tsx` — themed `<ReactFlow>` wrapper (fitView, controls,
  `nodesDraggable={false}`; **no minimap** — at these graph sizes it just covers
  real nodes). **Its parent must have an explicit height** — React
  Flow measures the DOM, so a zero-height parent renders blank with no error.
- `treeLayout.ts` — `layoutTree()`, `x = depth * COL_W`, `y` by leaf order.
  Deliberately no `dagre`/`elkjs`; positions are derived, never persisted.
- `hierarchyGraph.ts` / `ruleGraph.ts` — pure builders (no React), unit-tested.
- `HierarchyCanvas` (`/dashboard/hierarchy`) and `RuleCanvas`
  (`/dashboard/alert-rules`, canvas view) are the two consumers. Both are
  `next/dynamic` + `ssr: false` so the library stays out of the shared chunk.

**What the rule canvas edits.** `RuleCanvas` edits a rule's *conditions* and
*logic* in place: clicking a condition node opens `nodes/ConditionEditor.tsx` (a
popover anchored to the node — not a modal, which would cover the graph being
edited), the `AND`/`OR` pill toggles on click, and `+ Add condition`
appends. Everything goes through the one existing
`PUT /tenants/{id}/alert-rules/{id}`, and the canvas keeps **no local copy of the
rule** — after a successful write it calls `onRuleChanged()` and the page
refetches, so the list and the canvas cannot disagree.

The rule *forms* still own name, severity, description, and cooldown; clicking
the alarm node opens them. Those belong to the rule, not to a node.

`+ Add condition` on a THRESHOLD rule **converts it to COMPOSITE**, behind a
confirmation that names the effects. The conversion is **one-way** (the router
400s on COMPOSITE → THRESHOLD — collapsing N conditions into one
metric/operator/threshold has no correct answer) and it **preserves
`device_id`**, since the processor selects rules by device irrespective of rule
type. The router seeds the first condition from the stored columns itself, so the
client must not send its own copy. A converted rule keeps vestigial
`metric`/`operator`/`threshold` columns that the composite path ignores.

**Deliberately excluded:** `web/src/components/DeviceTemplates/` and
`web/src/components/visualization/` are telemetry-driven SVG *artwork* (flow
animations, pump/valve/tank digital twins), not node graphs. They stay
hand-rolled — React Flow there would be a regression. `react-grid-layout` in the
dashboard builder is also out of scope; it is a layout grid, not a graph.

---

## 🔌 Device drivers — `drivers/*.json` + `payload_codec.driver`

How the platform speaks to a class of hardware is **data on the device type**
(`device_types.driver`, JSONB, nullable), not code: transport binding, downlink
encoding, acknowledgement semantics and timing in one declaration. Adding a
vendor must require no platform source change — that is the acceptance
criterion, and `api/tests/test_device_driver.py` enforces it by onboarding a
fictional third vendor with a third header shape by declaration alone.

**A NULL driver is the compatibility guarantee, not an unconfigured state.**
Every accessor returns the pre-driver behaviour for `None`, so the live fleet
dispatches, decodes and expires exactly as it did. Never "fix" a device type by
giving it a driver it does not need.

**Drivers are file-defined and version-controlled** — they live in `drivers/`
and are applied by PUTting the JSON as a device type's `driver` field. Adding a
vendor is therefore a deploy, deliberately: byte offsets transcribed from a
vendor manual want review, diffs and history, not a text box at 5pm. The
device-type UI's *command schema* editor is a different thing and stays as it
is — it describes what a command means to a user (name, parameters, ranges),
while a driver describes how those bytes go on the wire.

The module lives in **`shared/payload_codec/payload_codec/driver.py`**, not in
the API, because the processor reads drivers too — uplink decoding and
acknowledgement correlation happen at ingest. Both Dockerfiles already install
that package. A second copy would be two readers of one declaration format,
free to drift, and the first symptom would be a command whose answer nobody
matched.

Encoding reuses the same package's `encode()`. A header is not a special
mechanism, it is fields at offsets 0..n whose values happen to be fixed, so a
B METERS IWM's 5-byte header and an RFM's 2-byte header are the same code with
different declarations. Constants win over caller-supplied parameters and a
collision **raises** — a caller must never reach the opcode byte.

**Acknowledgement correlates on (device, opcode)**, never on `command_id` —
no third-party device echoes ours. An IWM answers with the same `Fct` byte, an
RFM echoes the whole frame and refuses with `0x02 <Index>`; both are two bytes
read at declared offsets (`acknowledgement.response`), so a third vendor's
dialect of "yes" also needs no code. `device_commands.opcode` holds the key and
a **partial unique index** (`uq_device_commands_inflight_opcode`, migration 030)
refuses a second command on the same pair while one is in flight — two answers
to one opcode cannot be told apart. It is an index and not a router check
because two dispatches arriving together would both read "nothing outstanding".
The correlating write is `_correlate_driver_ack` in the processor.

`driver.telemetry` has absorbed `device_types.decoder` — same field keys, same
engine, so it is a move and not a translation. The column stays the fallback
and is still what every live device type uses; `get_codec()` returns both from
one row. Neither B METERS driver carries a decoder yet (the IWM manual leaves
four fields undecodable; RFM uplinks concatenate frames with no length byte,
which a fixed-offset spec cannot express) — recorded in the files themselves.

Three things phase 1 changed that live outside this module:

- `_detect_protocol` (shared with `ota_dispatch`) consults the driver, then the
  device type's `connectivity.protocol`, then a per-device
  `attributes.protocol` override — and **raises** if none of them answer or if
  the answer cannot be dispatched. **The heuristics are gone** (phase 4). They
  were not a safety net: all 68 devices have a `dev_eui` with `ttn_synced =
  false`, so `dev_eui AND ttn_synced → lorawan` missed and every LoRaWAN meter
  fell through to the MQTT default. Commands were saved by the declaration;
  **OTA was not**, because it never passed the device type — it resolved `mqtt`
  for the whole fleet. Both now read the declaration, and `routers/firmware.py`
  loads device types so OTA can.
- `DEVICE_RESPONSE_TTL_SECONDS = 60` is now only the no-driver default;
  `acknowledgement.response_window_seconds` replaces it per type. An IWM reports
  every 12 hours, NFC-settable only — 60s was wrong by three orders of magnitude.
- `delivered_unconfirmed` is a terminal command status for devices that can
  never acknowledge (IWM `RESET`, RFM `0x03 0x05`). The sweep only touches
  pending/sent/delivered, so it is excluded from expiry by construction.

`transport.mode` (`payload` | `register_map` | `edge_gateway`) is explicit from
day one and only `payload` is implemented; the others are **refused on write**.
Register/address-space protocols have no message to encode at all, and
discovering that later as a "special case" is the rewrite the discriminator
exists to prevent. See `openspec/changes/add-device-driver-model/design.md` for
the three protocol families and which one is in scope.

Script codecs (a vendor's own `*-encoder.js`) are phase 3 and are currently
refused — the sandbox is the feature, not a hardening task, because RLS is inert
under the app's database role.

---

## 🛰️ Network server binding — `api/app/services/network_server.py`

**Uplinks and downlinks are independent, and both are declared.** ChirpStack
publishes uplinks to a broker the processor subscribes to (anonymously, to
`mqtt.cordys.co.za:2883`); there is **no direct connection to ChirpStack**.
Because its MQTT integration is bidirectional, downlinks go to the same broker
on `application/{app}/device/{eui}/command/down` — **no API token exists or is
needed** for that path.

But not every client gives broker access. So `integrations.downlink_mode` is an
**explicit discriminator** — `mqtt` | `rest` | `none` — validated on write and by
a database CHECK, never inferred from how uplinks happen to arrive. Same pattern
as the driver's `transport.mode`, same reason.

`none` is an answer, not an absence: a client who forwards uplinks and grants
nothing back. A command to such a device is **refused at issue**
(`_assert_reachable`), before a row exists — otherwise it queues, expires against
a twelve-hour window and is recorded `timed_out`, blaming a meter that was never
asked. NULL is different: it means "not configured yet".

**`devices.integration_id` names the server, and an explicit binding NEVER falls
back.** Bound and usable → dispatch; bound but missing/disabled/unconfigured →
refuse with the reason; unbound (all 67 others today) → the pre-binding order.
Falling back would send to *a* server — the wrong one — and report success.

**MQTT downlinks publish on `ChirpStackBridge`'s own connection**, fed from Redis
(`chirpstack-downlink:{integration_id}`). The API opens no broker connections.
This makes multi-instance structural rather than argued: a bridge cannot reach
another server's broker. Zero Redis subscribers is reported, not swallowed —
pub/sub does not retain.

`ota_dispatch` resolves through the **same** resolver; OTA and commands share one
transport and must not disagree about where a device is.

**The application id comes from the device's own uplinks** into
`devices.ttn_app_id` (badly named, provider-agnostic in practice), captured at
ingest. Observation wins over a hand-entered value — the device is the authority
on where it reports from. Setting it by hand only seeds a device that has not yet
spoken.

Outbound credentials use `EncryptedString` (`app/services/secrets.py`) — a column
type, not a helper, so no write path can store plaintext. Key from
`SECRET_ENCRYPTION_KEY`, no default in compose. Not needed for an anonymous
broker; needed for a REST token or a broker password.

`scripts/network_server_bindings.py` reports bound vs unbound. It proposes and
never applies — a wrong binding is silent, and a person is the check.

---

## 🤖 MCP Server — `api/app/mcp/`

Agent-facing tools live in `api/app/mcp/`, mounted at `/mcp` on the same FastAPI
app and **off by default** (`MCP_ENABLED=false` → the route is not mounted at
all). Full documentation: `docs/MCP_SERVER.md`.

Three rules, all enforced by code rather than by review:

1. **No tool may accept `tenant_id`, `user_id`, or `organization_id`.** Tenancy
   comes from the bearer credential. The registrar checks both the function
   signature and the advertised JSON schema and raises at import, so a violation
   fails the boot. This is the actual isolation boundary — **RLS is inert in this
   deployment** because the app connects as the database owner, so there is
   nothing underneath to catch a tool that took a tenant id.

2. **Tools wrap existing routers/services and add no query logic.** A tool with
   its own SELECT is a second implementation of "which devices are offline",
   free to drift from the one the UI uses, and nobody notices until an agent
   contradicts a screen. `shape.py`'s `call_route()` calls a route function
   directly and resolves its `Query(...)` defaults — note that FastAPI's
   validators do *not* run on that path, so bounded arguments must be clamped by
   the tool.

3. **Every tool is audited and every session is guarded by construction.**
   `register()` applies the audit wrapper, and `tool_session()` is the only way
   a tool gets a session (it applies the tenant guard and RLS context).
   `tools/read.py` deliberately cannot import `get_session`.

Writes are approval-gated: `send_device_command` records a command with
`status='awaiting_approval'`, dispatches nothing, and requires a `reason` that is
shown to the approver. A person decides at `/dashboard/approvals` (Approve sends
it; Reject records the refusal and sends nothing).

`get_command_status` is how an agent learns the outcome — without it the model
gets an approval reference and then knows nothing further, forever. It returns a
`meaning` string alongside the status, because the two that matter read
backwards: `sent` is not success, and `delivered_unconfirmed` is.

Every tool must declare `ToolAnnotations` — `read_only_hint` on reads,
`destructive_hint` on the write. `register()` has no default for it, so omitting
one fails app construction rather than advertising a guessed effect.

### ⚠️ Device commands are role-restricted

`POST /tenants/{id}/devices/{id}/commands` and the approve/reject endpoints
require `SUPER_ADMIN`, `TENANT_ADMIN` or `SITE_ADMIN`. **This endpoint previously
accepted any authenticated tenant user** — that assumption is in people's heads
and in older code. One definition lives in `app/dependencies.py`
(`COMMAND_ROLES` / `require_command_role`); `ToolContext.may_issue_commands`
reads it rather than keeping a second copy, because the two had already drifted
once. The frontend mirror is `web/src/lib/auth.ts` — that one is UX only, so the
UI does not offer a control the API will refuse; it is never the check.

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

⚠️ Minor Issues: none currently tracked. The three previously listed here
(alert preview returning empty, invitation email not sent, "11 duplicate
database indexes") were all stale or fixed as of 2026-07-11: alert preview
already replays telemetry through `alarm_core` and works; invite emails now
send for real with an honest `invitation_sent` result; and a real audit
against the Postgres catalog (not the SQL source) found exactly 2 duplicate
indexes, not 11 — both dropped in migration `023_drop_redundant_indexes`.

❌ Missing (Planned):
- Grafana integration (Future) — provisioning config exists, no service deployed
- Config forms for `table`/`map`/`status_matrix`/`device_info` widgets (see Widget Types above)

Note: Gauge/Map/Table widgets, the device-type command schema editor, the OTA
firmware campaign UI (`web/src/app/dashboard/firmware/versions` +
`.../firmware/campaigns`), and notification template CRUD (POST/PUT/DELETE on
`/tenants/{id}/notifications/templates` + the Templates tab on the
Notifications page) are implemented, not planned — this section previously
listed them as future work after they'd already shipped. Note also that a
template's `alert_type` is stored but not yet used to select between
templates — only one *enabled* template per `channel_type` is ever used
(`notification_dispatcher.py`), so it's for the author's own organization
today, not per-alert-type routing.

---

## 🎯 Current Iteration

12 widget types, the device-type command schema editor, OTA firmware
campaigns (versions list + campaign creation/execution wizard), and
notification template CRUD (create/edit/delete UI, backed by real
POST/PUT/DELETE endpoints) are implemented (see Widget Types above). No
active iteration is tracked here currently — check `openspec/changes/` for
in-flight work.

---

**Last Updated**: 2026-07-31
**Maintained By**: Claude (AI Assistant)
**Project Status**: Active Development
